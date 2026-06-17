/**
 * G-03 引擎核心 — 城主 AI v0(規則型)
 *
 * 權威依據:
 * - keeper_ai_regulation_v0_2:open-hand 選用(§0.2 原則1)、回合 sequence(§2.2)、
 *   行動點預算(§2.1)、七大類動作(§1)
 * - keeper_ai_v0_decision_spec_26061101(實作規格 v3):評分制選卡 + 戲劇曲線層 +
 *   避免單調 + 風格即資料(KeeperProfile 全參數化,不寫死個性)
 * - G1 交付書 Part3 劇本:三層情感曲線(鋪陳 → 升壓 → 高潮)
 * - 企劃書第七章 G4:壓力玩家 / 保持戲劇性 / 避免單調
 *
 * 「風格即資料」:本引擎是唯一決策框架;城主個性來自
 * ① 關卡綁定的神話卡池與怪物池(牌組)② KeeperProfile 權重 ③ 怪物行為腳本。
 */
import type { ResultEffect } from './messages';
import type { ScenarioState, InvestigatorState } from './state';
import { spawnEnemy } from './monsterActions';
import type { EnemyDataLookup } from './monsterActions';

// ─── 神話卡資料(bootstrap mythos_cards,MIGRATION_035 後含 open-hand 欄位)──
export interface MythosCardData {
  id: string;
  code?: string;
  name_zh: string;
  description_zh?: string | null;
  flavor_text_zh?: string | null;
  card_category: string;
  action_cost: number;
  intensity_tag: string;
  activation_timing?: string;
  reusable?: boolean;
  cooldown_rounds?: number | null;
  max_uses_per_stage?: number | null;
  effects?: Array<{ action_code: string; action_params: Record<string, unknown> | null }>;
}

// ─── 城主運行時狀態(client 持有,引擎進出)─────────
export interface KeeperState {
  actionPoints: number;
  /** cardId → 剩餘冷卻回合 */
  cooldowns: Record<string, number>;
  /** cardId → 已用次數 */
  uses: Record<string, number>;
  lastCategory: string | null;
  lastCardId: string | null;
}

export function initKeeperState(_profile: KeeperProfile): KeeperState {
  // 行動點從 0 起:每回合的回復在 selectKeeperActivations 開頭統一結算(避免首回合雙算)
  return { actionPoints: 0, cooldowns: {}, uses: {}, lastCategory: null, lastCardId: null };
}

// ─── 風格即資料:城主設定檔 ─────────────────────
export interface KeeperProfile {
  /** 每回合基礎行動點(game_balance_settings keeper_action_base_difficulty_N) */
  baseActionPoints: number;
  /** 未用累積上限(0 = 規格 fallback 6) */
  maxAccumulation: number;
  /** 每回合至多啟用張數(規範 §8.1.3) */
  maxActivationsPerTurn: number;
  /** 玩家 SAN 危險線 %(低於 → status 加分) */
  sanDangerPct: number;
  /** 玩家快贏門檻 %(高於 → agenda/cancel 加分) */
  playerWinningPct: number;
  /** 類別額外權重(關卡/城主個性微調;預設空) */
  categoryWeights: Record<string, number>;
}

export function defaultKeeperProfile(
  settings?: Record<string, unknown>,
  difficulty = 2,
): KeeperProfile {
  const base = Number(settings?.[`keeper_action_base_difficulty_${difficulty}`] ?? 3);
  const maxAcc = Number(settings?.keeper_action_max_accumulation ?? 0);
  return {
    baseActionPoints: Number.isFinite(base) && base > 0 ? base : 3,
    maxAccumulation: maxAcc > 0 ? maxAcc : 6,
    maxActivationsPerTurn: 2,
    sanDangerPct: 50,
    playerWinningPct: 80,
    categoryWeights: {},
  };
}

// ─── 局勢快照(規格 §4.1)───────────────────────
export interface KeeperSituation {
  aliveEnemies: number;
  sanPct: number;
  hpPct: number;
  /** 玩家幕目標完成度 %(幕一線索 / 幕二頭目剩餘 HP 反向) */
  playerProgressPct: number;
  /** 戲劇節奏期(劇本三層曲線) */
  dramaTier: 'setup' | 'rising' | 'climax';
  turnNumber: number;
}

export function snapshotSituation(
  scenario: ScenarioState,
  investigator: InvestigatorState,
  actClueTarget: number | null,
  bossMaxHp: number | null,
): KeeperSituation {
  const aliveEnemies = scenario.enemies.filter((e) => e.hp > 0).length;
  const actIdx = scenario.actIndex ?? 0;
  let playerProgressPct = 0;
  if (actIdx === 0 && actClueTarget && actClueTarget > 0) {
    playerProgressPct = (scenario.objectiveProgress / actClueTarget) * 100;
  } else if (actIdx >= 1 && bossMaxHp && bossMaxHp > 0) {
    const boss = scenario.enemies.find((e) => e.hp > 0);
    playerProgressPct = boss ? ((bossMaxHp - boss.hp) / bossMaxHp) * 100 : 100;
  }
  const dramaTier: KeeperSituation['dramaTier'] =
    actIdx >= 1 ? 'climax' : scenario.turnNumber <= 2 ? 'setup' : 'rising';
  return {
    aliveEnemies,
    sanPct: investigator.sanMax > 0 ? (investigator.san / investigator.sanMax) * 100 : 0,
    hpPct: investigator.hpMax > 0 ? (investigator.hp / investigator.hpMax) * 100 : 0,
    playerProgressPct,
    dramaTier,
    turnNumber: scenario.turnNumber,
  };
}

// ─── 強度 → 數值(效益比用)───────────────────────
const INTENSITY_VALUE: Record<string, number> = { small: 1, medium: 2, large: 3, epic: 4 };

/** v0 引擎可執行的 action_code(其餘卡顯示為蟄伏) */
export const SUPPORTED_MYTHOS_ACTIONS = new Set([
  'advance_agenda', 'summon_monster', 'horror_damage',
  'set_visibility', 'test_modifier', 'attach_status', 'force_reroll',
]);

export function isCardExecutable(card: MythosCardData): boolean {
  const fx = card.effects ?? [];
  return fx.length > 0 && fx.some((f) => SUPPORTED_MYTHOS_ACTIONS.has(f.action_code));
}

// ─── 評分(規格 §4.2 + §4.2A 戲劇曲線 + 避免單調)────
export function scoreCard(
  card: MythosCardData,
  situation: KeeperSituation,
  state: KeeperState,
  profile: KeeperProfile,
): number | null {
  // 不可用判定
  if (!isCardExecutable(card)) return null;
  if (card.action_cost > state.actionPoints) return null;
  if ((state.cooldowns[card.id] ?? 0) > 0) return null;
  const used = state.uses[card.id] ?? 0;
  if (!card.reusable && used >= 1) return null;
  if (card.max_uses_per_stage != null && used >= card.max_uses_per_stage) return null;

  // 戲劇曲線守門(§4.2A):鋪陳期只放小強度「氛圍類」;升壓期 small/medium;高潮全開
  const intensity = String(card.intensity_tag ?? 'small');
  const cat = String(card.card_category ?? 'general');
  const AMBIENT_CATEGORIES = new Set(['general', 'environment', 'narrative', 'cancel']);
  if (situation.dramaTier === 'setup' && (intensity !== 'small' || !AMBIENT_CATEGORIES.has(cat))) {
    return null; // 鋪陳期不召喚、不施壓 — 「世界開始不對勁」靠氛圍卡
  }
  if (situation.dramaTier === 'rising' && (intensity === 'large' || intensity === 'epic')) return null;

  let score = 0;

  // 類別 × 局勢基礎分(§4.2)
  if (situation.aliveEnemies === 0 && cat === 'summon') score += 3;
  if (situation.sanPct < profile.sanDangerPct && cat === 'status') score += 2;
  if (situation.playerProgressPct >= profile.playerWinningPct) {
    if (cat === 'agenda') score += 3;
    if (cat === 'cancel') score += 2;
  }
  if (cat === 'general') score += 1; // 環境鋪陳預設小加分
  if (situation.dramaTier === 'climax' && (intensity === 'large' || intensity === 'epic')) score += 1;

  // 效益比(強度/費用)
  score += INTENSITY_VALUE[intensity] / Math.max(1, card.action_cost);

  // 避免單調(G4 驗收)
  if (state.lastCategory === cat) score -= 3;
  if (state.lastCardId === card.id) score -= 2;

  // 個性權重(風格即資料)
  score += Number(profile.categoryWeights[cat] ?? 0);

  return score;
}

// ─── 選卡(貪婪,至多 N 張)──────────────────────
export interface KeeperSelection {
  activations: MythosCardData[];
  state: KeeperState;
}

export function selectKeeperActivations(
  cards: MythosCardData[],
  situation: KeeperSituation,
  prevState: KeeperState,
  profile: KeeperProfile,
  rng: () => number = Math.random,
): KeeperSelection {
  // 回合開始:行動點回復(可累積至上限)+ 冷卻 -1
  const cooldowns: Record<string, number> = {};
  for (const [id, n] of Object.entries(prevState.cooldowns)) {
    if (n - 1 > 0) cooldowns[id] = n - 1;
  }
  let state: KeeperState = {
    ...prevState,
    cooldowns,
    actionPoints: Math.min(profile.maxAccumulation, prevState.actionPoints + profile.baseActionPoints),
  };

  const activations: MythosCardData[] = [];

  // #21 強制毀滅時鐘(Uria 裁定):每回合至少推進一次議程,否則敗局倒數永遠停在 0。
  // 議程推進=基準敗局時鐘,繞過戲劇曲線守門與「快贏才加分」評分,但仍尊重 uses/cooldown/reusable。
  // 取費用最低的可用 advance_agenda 卡(時鐘要穩定能放);不夠費用也放(夾 0),可被後續貪婪多放。
  const doomReady = (c: MythosCardData): boolean => {
    if (!(c.effects ?? []).some((f) => f.action_code === 'advance_agenda')) return false;
    if ((state.cooldowns[c.id] ?? 0) > 0) return false;
    const used = state.uses[c.id] ?? 0;
    if (!c.reusable && used >= 1) return false;
    if (c.max_uses_per_stage != null && used >= c.max_uses_per_stage) return false;
    return true;
  };
  const doomPool = cards.filter(doomReady);
  if (doomPool.length > 0) {
    const minCost = Math.min(...doomPool.map((c) => c.action_cost));
    const cheapest = doomPool.filter((c) => c.action_cost === minCost);
    const pick = cheapest[Math.floor(rng() * cheapest.length)];
    activations.push(pick);
    state = {
      actionPoints: Math.max(0, state.actionPoints - pick.action_cost),
      cooldowns: {
        ...state.cooldowns,
        ...(pick.reusable && Number(pick.cooldown_rounds ?? 0) > 0 ? { [pick.id]: Number(pick.cooldown_rounds) } : {}),
      },
      uses: { ...state.uses, [pick.id]: (state.uses[pick.id] ?? 0) + 1 },
      lastCategory: String(pick.card_category ?? 'general'),
      lastCardId: pick.id,
    };
  }

  for (let i = activations.length; i < profile.maxActivationsPerTurn; i += 1) {
    const scored = cards
      .map((c) => ({ card: c, score: scoreCard(c, situation, state, profile) }))
      .filter((x): x is { card: MythosCardData; score: number } => x.score !== null);
    if (scored.length === 0) break;
    const best = Math.max(...scored.map((x) => x.score));
    const top = scored.filter((x) => x.score >= best - 1e-9);
    const pick = top[Math.floor(rng() * top.length)].card;

    activations.push(pick);
    state = {
      actionPoints: state.actionPoints - pick.action_cost,
      cooldowns: {
        ...state.cooldowns,
        ...(pick.reusable && Number(pick.cooldown_rounds ?? 0) > 0
          ? { [pick.id]: Number(pick.cooldown_rounds) }
          : {}),
      },
      uses: { ...state.uses, [pick.id]: (state.uses[pick.id] ?? 0) + 1 },
      lastCategory: String(pick.card_category ?? 'general'),
      lastCardId: pick.id,
    };
  }
  return { activations, state };
}

// ─── 神話卡效果執行器 ───────────────────────────
export interface KeeperAttachment {
  cardId: string;
  name: string;
  action_code: string;
  action_params: Record<string, unknown>;
}

export interface MythosExecutionResult {
  scenario: ScenarioState;
  investigator: InvestigatorState;
  effects: ResultEffect[];
  /** 需要附著的持續效果(client 存入 scenario.keeperAttachments) */
  attachments: KeeperAttachment[];
  /** 多人局:被本卡改動的其他調查員(key = investigatorId) */
  updatedInvestigators?: Record<string, InvestigatorState>;
}

/** 召喚落點:nearest_to_clue → 有線索的地點;adjacent_to_player → 玩家相鄰;fallback 玩家相鄰 */
function resolveSummonLocation(
  rule: string | undefined,
  explicit: string | undefined,
  scenario: ScenarioState,
  investigator: InvestigatorState,
): string {
  if (explicit && scenario.locations.some((l) => l.locationDefinitionId === explicit)) return explicit;
  if (rule === 'nearest_to_clue') {
    const clueLoc = scenario.tokens.find((t) => t.tokenType === 'clue' && t.amount > 0)?.locationId;
    if (clueLoc && scenario.locations.some((l) => l.locationDefinitionId === clueLoc)) return clueLoc;
  }
  const here = scenario.locations.find(
    (l) => l.locationDefinitionId === investigator.currentLocationId,
  );
  return here?.connectedTo[0] ?? investigator.currentLocationId ?? scenario.locations[0]?.locationDefinitionId ?? '';
}

/** 召喚對象:指定變體優先;否則家族 × 位階篩選,功能互補(場上全戰鬥型時偏好非戰鬥型) */
function resolveSummonVariant(
  params: Record<string, unknown>,
  scenario: ScenarioState,
  enemyData: EnemyDataLookup,
  rng: () => number,
): string | null {
  const explicit = params.variant_code ? String(params.variant_code) : null;
  if (explicit && enemyData[explicit]) return explicit;
  const family = params.family_code ? String(params.family_code) : null;
  const tier = Number(params.base_tier ?? 1);
  const candidates = Object.entries(enemyData)
    .filter(([, d]) => Number(d.tier ?? 1) === tier)
    .filter(([, d]) => !family || String(d.family_code ?? '') === family);
  if (candidates.length === 0) return null;
  // 功能互補(s14 部署指引):場上活怪全無功能標籤時,偏好帶功能標籤的候選
  const aliveFns = new Set(
    scenario.enemies
      .filter((e) => e.hp > 0)
      .flatMap((e) => (Array.isArray(enemyData[e.enemyDefinitionId]?.keywords) ? enemyData[e.enemyDefinitionId]!.keywords! : []))
      .map(String),
  );
  const FN_TAGS = ['agenda_pusher', 'controller', 'summoner', 'environmental'];
  const complementary = candidates.filter(([, d]) =>
    Array.isArray(d.keywords) && d.keywords.some((k) => FN_TAGS.includes(String(k)) && !aliveFns.has(String(k))),
  );
  const pool = complementary.length > 0 && scenario.enemies.some((e) => e.hp > 0) ? complementary : candidates;
  return pool[Math.floor(rng() * pool.length)][0];
}

export function executeMythosCard(
  card: MythosCardData,
  scenario: ScenarioState,
  investigator: InvestigatorState,
  enemyData: EnemyDataLookup,
  rng: () => number = Math.random,
  playerCount = 1,
  /** 多人局全隊(供 target_rule 選目標;未傳 = 單人,全部打 investigator) */
  party?: Record<string, InvestigatorState>,
): MythosExecutionResult {
  let sc = scenario;
  let inv = investigator;
  const effects: ResultEffect[] = [];
  const attachments: KeeperAttachment[] = [];
  const updatedInvestigators: Record<string, InvestigatorState> = {};
  // 站立成員(倒地者不再追打 — 城主的目標是讓更多人倒下)
  const standing = (): InvestigatorState[] => {
    const pool = party ? Object.values(party) : [inv];
    return pool
      .map((p) => (p.investigatorId === inv.investigatorId ? inv : updatedInvestigators[p.investigatorId] ?? p))
      .filter((p) => !p.dead && !p.permanentlyDead && p.hp > 0 && p.san > 0);
  };
  const applyTo = (target: InvestigatorState) => {
    if (target.investigatorId === inv.investigatorId) inv = target;
    else updatedInvestigators[target.investigatorId] = target;
  };

  effects.push({
    type: 'keeper_card_activated',
    params: {
      name: card.name_zh,
      cost: card.action_cost,
      category: card.card_category,
      narrative: card.flavor_text_zh || card.description_zh || '',
    },
  });

  for (const fx of card.effects ?? []) {
    const p = (fx.action_params ?? {}) as Record<string, any>;
    switch (fx.action_code) {
      case 'advance_agenda': {
        const amount = Number(p.doom_tokens ?? 1);
        sc = { ...sc, agendaProgress: sc.agendaProgress + amount };
        effects.push({ type: 'doom_added', params: { amount, total: sc.agendaProgress } });
        break;
      }
      case 'summon_monster': {
        const quantity = Math.max(1, Number(p.quantity ?? 1));
        for (let i = 0; i < quantity; i += 1) {
          const code = resolveSummonVariant(p, sc, enemyData, rng);
          if (!code) {
            effects.push({ type: 'effect_unsupported', params: { codes: ['summon_monster(無候選)'] } });
            break;
          }
          const loc = resolveSummonLocation(p.location_rule ? String(p.location_rule) : undefined, p.location_code ? String(p.location_code) : undefined, sc, inv);
          const spawned = spawnEnemy(sc, code, loc, enemyData, playerCount);
          sc = spawned.scenario;
          effects.push({
            type: 'enemy_spawned',
            params: { enemy: enemyData[code]?.name_zh ?? code, code, location: loc },
            targetId: spawned.enemy.instanceId,
          });
        }
        break;
      }
      case 'horror_damage': {
        const amount = Number(p.amount ?? 1);
        // 目標選擇:卡面 target_rule(lowest_san 等)在站立成員中挑;單人局即玩家
        const pool = standing();
        if (pool.length === 0) break;
        const rule = String(p.target_rule ?? 'lowest_san');
        const target =
          rule === 'lowest_san'
            ? pool.reduce((a, b) => (b.san < a.san ? b : a))
            : rule === 'random'
              ? pool[Math.floor(rng() * pool.length)]
              : pool.find((x) => x.investigatorId === inv.investigatorId) ?? pool[0];
        // 紅線一護欄:資料可帶 cap_to_one_at_limit(恐懼將達上限改 1)
        const wouldHitLimit = target.san - amount <= 0;
        const dealt = p.cap_to_one_at_limit && wouldHitLimit ? 1 : amount;
        applyTo({ ...target, san: Math.max(0, target.san - dealt) });
        effects.push({
          type: 'fear_damage',
          params: { amount: dealt, narrative: '冰冷的低語擠進腦縫。' },
          targetId: target.investigatorId,
        });
        break;
      }
      case 'set_visibility': {
        const vis = String(p.visibility ?? 'darkness') as ScenarioState['locations'][number]['visibility'];
        const targetLoc = p.location_code
          ? String(p.location_code)
          : inv.currentLocationId ?? sc.locations[0]?.locationDefinitionId;
        sc = {
          ...sc,
          locations: sc.locations.map((l) =>
            l.locationDefinitionId === targetLoc ? { ...l, visibility: vis } : l,
          ),
        };
        effects.push({ type: 'visibility_changed', params: { location: targetLoc, visibility: vis } });
        break;
      }
      case 'test_modifier':
      case 'attach_status':
      case 'force_reroll': {
        // 持續附著類:交給容器存入 keeperAttachments,結算於對應時點
        attachments.push({
          cardId: card.id,
          name: card.name_zh,
          action_code: fx.action_code,
          action_params: p,
        });
        effects.push({ type: 'keeper_attachment', params: { name: card.name_zh, kind: fx.action_code } });
        break;
      }
      default:
        effects.push({ type: 'effect_unsupported', params: { codes: [fx.action_code] } });
    }
  }
  return { scenario: sc, investigator: inv, effects, attachments, updatedInvestigators };
}

// ─── 附著效果查詢(檢定管線引用)──────────────────
/** 全域檢定修正(海腥味瀰漫:感知 -1 等) */
export function attachmentTestModifier(
  attachments: KeeperAttachment[] | null | undefined,
  attribute: string,
): number {
  let sum = 0;
  for (const a of attachments ?? []) {
    if (a.action_code !== 'test_modifier') continue;
    if (String(a.action_params.attribute ?? '') === attribute) {
      sum += Number(a.action_params.modifier ?? 0);
    }
  }
  return sum;
}

/** 附著卡回合強制結算(§2.2 步驟 2):瘋狂攫住的棄牌 + 解除檢定 */
export function runAttachmentUpkeep(
  attachments: KeeperAttachment[],
  investigator: InvestigatorState,
  rng: () => number = Math.random,
): { attachments: KeeperAttachment[]; investigator: InvestigatorState; effects: ResultEffect[] } {
  let inv = investigator;
  const effects: ResultEffect[] = [];
  const remaining: KeeperAttachment[] = [];
  for (const a of attachments) {
    if (a.action_code === 'attach_status' && a.action_params.upkeep_discard) {
      const n = Number(a.action_params.upkeep_discard ?? 1);
      const discarded = inv.hand.slice(0, n);
      if (discarded.length > 0) {
        inv = {
          ...inv,
          hand: inv.hand.filter((id) => !discarded.includes(id)),
          discardPile: [...inv.discardPile, ...discarded],
        };
        effects.push({ type: 'attachment_upkeep', params: { name: a.name, narrative: '瘋狂攫住你的手——你被迫鬆開了 ' + discarded.length + ' 張牌。' } });
      }
      // 解除檢定(意志,DC = 10 + release_dc;『檢定(3)』解讀為 +3,待 Uria 校準)
      if (a.action_params.release_test === 'willpower') {
        const dc = 10 + Number(a.action_params.release_dc ?? 3);
        const roll = Math.floor(rng() * 20) + 1;
        const total = roll + inv.attributes.willpower;
        if (total >= dc) {
          effects.push({ type: 'attachment_released', params: { name: a.name, roll, total, dc, narrative: '你咬住舌尖,把瘋狂從腦中擠了出去。' } });
          continue; // 不放回 = 解除
        }
        effects.push({ type: 'attachment_release_failed', params: { name: a.name, roll, total, dc } });
      }
    }
    remaining.push(a);
  }
  return { attachments: remaining, investigator: inv, effects };
}