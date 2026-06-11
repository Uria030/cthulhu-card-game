/**
 * G-01 引擎核心 — 規則執行引擎(薄層)
 *
 * 依第三章 §4.1 行動點六步生命週期:
 *   意圖宣告 → 合法性檢查 → 費用支付 → 效果結算 → 狀態更新 → 視覺回饋
 *
 * 本層責任:接 IntentMessage,執行合法性檢查 + 費用扣減 + 效果結算,
 *           回傳 ResultMessage 與新狀態。視覺回饋由容器處理。
 *
 * G1 階段範圍(§3.3):
 * - ✓ gain_resource(拿資源)
 * - ✓ draw_card(抽卡,含 §3.3 牌庫空懲罰)
 * - ✓ move(移動,含 §6.2 障礙物 2 行動點)
 * - ✗ play_card / attack / investigate 等(stub,後續展開)
 *
 * 規則書權威依據:02_rulebook_ch2.md §6.1 §6.2 §3.3 §7.2
 */
import type {
  IntentMessage,
  ResultMessage,
  ResultEffect,
} from './messages';
import type {
  ScenarioState,
  InvestigatorState,
  TurnState,
  LocationInstance,
} from './state';
import {
  resolveCheck,
  commitValueFor,
  visibilityModifier,
} from './checks';
import type { AttributeKey, CommitIcons } from './checks';
import { executeCardEffects, passiveTestModifier } from './effectsExecutor';
import { runFearChecks, applyAttackOfOpportunity } from './monsterActions';
import type { EnemyDataLookup, AttackCardLookup } from './monsterActions';
import { attachmentTestModifier } from './keeperAI';

// ─── 卡片實例資料(容器由 bootstrap cardIndex 餵入)──
export interface CardData {
  commit_icons?: CommitIcons;
  name_zh?: string;
  card_type?: string;
  cost?: number | null;
  combat_style?: string | null;
  attribute_modifiers?: Record<string, number>;
  subtypes?: unknown[];
  effects?: Array<{
    trigger_type: string;
    effect_code: string;
    effect_params: Record<string, unknown> | null;
    duration?: string | null;
    description_zh?: string | null;
  }>;
}
export type CardDataLookup = Record<string, CardData>;

/** 戰鬥風格卡(§8:攻擊時抽 1 張決定檢定屬性) */
export interface StyleCardData {
  code: string;
  name_zh: string;
  check_attribute: string;
  narrative_attack_zh?: string;
  narrative_success_zh?: string;
  narrative_fail_zh?: string;
}

// ─── 引擎輸入:當前狀態切片 ──────────────
export interface RuleContext {
  scenario: ScenarioState;
  /** 操作該意圖的調查員 */
  investigator: InvestigatorState;
  /** 當前回合層 */
  turn: TurnState;
  /** 全部調查員(供多人查詢) */
  investigators: Record<string, InvestigatorState>;
  /** 卡片實例資料查找(commit_icons/effects 等) */
  cardLookup?: CardDataLookup;
  /** 地點統計(調查難度 shroud;key = locationDefinitionId) */
  locationStats?: Record<string, { shroud?: number }>;
  /** 敵人定義統計(key = enemyDefinitionId,來自 bootstrap monsters) */
  enemyStats?: EnemyDataLookup;
  /** 怪物招式卡(key = mac code,來自 bootstrap monster_attack_cards) */
  attackCards?: AttackCardLookup;
  /** 戰鬥風格卡池(key = style code,如 shooting;第一層公用池) */
  stylePools?: Record<string, StyleCardData[]>;
  /** 亂數來源(測試注入,預設 Math.random) */
  rng?: () => number;
}

// ─── 加值 commit(§4.2 / ch3 §3):擲骰前投手牌圖示,卡進棄牌堆 ──
interface CommitOutcome {
  value: number;
  committedIds: string[];
  error?: string;
}

function takeCommit(intent: IntentMessage, ctx: RuleContext, attribute: AttributeKey): CommitOutcome {
  const ids = (intent.payload as { commitCardIds?: unknown }).commitCardIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return { value: 0, committedIds: [] };
  }
  const committedIds: string[] = [];
  const iconSets: CommitIcons[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !ctx.investigator.hand.includes(id)) {
      return { value: 0, committedIds: [], error: '加值卡不在手牌中:' + String(id) };
    }
    committedIds.push(id);
    iconSets.push(ctx.cardLookup?.[id]?.commit_icons ?? {});
  }
  return { value: commitValueFor(attribute, iconSets), committedIds };
}

/** commit 卡離手 → 棄牌堆(不花行動點,ch3 §3) */
function applyCommitToInvestigator(inv: InvestigatorState, committedIds: string[]): InvestigatorState {
  if (committedIds.length === 0) return inv;
  return {
    ...inv,
    hand: inv.hand.filter((id) => !committedIds.includes(id)),
    discardPile: [...inv.discardPile, ...committedIds],
  };
}

function commitEffects(commit: CommitOutcome): ResultEffect[] {
  if (commit.committedIds.length === 0) return [];
  return [{
    type: 'commit_cards',
    params: { cardInstanceIds: commit.committedIds, bonus: commit.value },
  }];
}

// ─── 引擎輸出:結算結果 + 新狀態切片 ──────
export interface RuleResolveOutput {
  /** 對應的 ResultMessage(供 publish 給訊息匯流排) */
  result: Omit<ResultMessage, 'id' | 'timestamp' | 'schemaVersion' | 'kind'> & { kind: 'result' };
  /** 結算後的新狀態切片(若 outcome=accepted)*/
  newState?: {
    investigator?: InvestigatorState;
    scenario?: ScenarioState;
    turn?: TurnState;
  };
}

// ─── 主入口 ─────────────────────────
export function resolveIntent(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  // 防護:已永久死亡的調查員不可動
  if (ctx.investigator.permanentlyDead) {
    return reject(intent, '[角色名] 的旅程已經結束。他們的紀念照仍在大廳牆上。');
  }

  // 階段檢查:只有調查員階段可執行主動行動(§4.2)
  if (ctx.turn.phase !== 'investigator') {
    return reject(intent, '不在調查員階段,當前階段:' + ctx.turn.phase, '等待進入調查員階段後再行動');
  }

  let out: RuleResolveOutput;
  switch (intent.actionType) {
    case 'gain_resource':
      out = resolveGainResource(intent, ctx); break;
    case 'draw_card':
      out = resolveDrawCard(intent, ctx); break;
    case 'move':
      out = resolveMove(intent, ctx); break;
    case 'investigate':
      out = resolveInvestigate(intent, ctx); break;
    case 'attack':
      out = resolveAttack(intent, ctx); break;
    case 'evade':
      out = resolveEvade(intent, ctx); break;
    case 'play_card':
      out = resolvePlayCard(intent, ctx); break;
    case 'execute_card_action':
      out = resolveExecuteCardAction(intent, ctx); break;
    case 'taunt':
      out = resolveTaunt(intent, ctx); break;
    // 以下 stub,等後續批次展開
    case 'consume':
    case 'commit_attribute_icon':
    case 'short_rest':
    case 'declare_intent':
      return reject(intent, '此行動的引擎結算尚未實作(G1 階段 stub)');
    default:
      return reject(intent, '未知的動作類型:' + (intent as { actionType: string }).actionType);
  }
  return finalizeEngagementPenalty(intent, ctx, out);
}

/**
 * §7.2 交戰限制:交戰中只能攻擊和閃避,其他行動觸發藉機攻擊(物理+恐懼雙重)。
 * 攻擊類豁免:attack / evade / 武器攻擊(execute_card_action 結果含 style_card_drawn)。
 */
function finalizeEngagementPenalty(
  intent: IntentMessage,
  ctx: RuleContext,
  out: RuleResolveOutput,
): RuleResolveOutput {
  if (out.result.outcome !== 'accepted') return out;
  if (ctx.investigator.engagedWith.length === 0) return out;
  if (intent.actionType === 'attack' || intent.actionType === 'evade') return out;
  if (
    intent.actionType === 'execute_card_action' &&
    (out.result.effects ?? []).some((e) => e.type === 'style_card_drawn')
  ) {
    return out;
  }
  let inv = out.newState?.investigator ?? ctx.investigator;
  let sc = out.newState?.scenario ?? ctx.scenario;
  // AoO 以「行動當下」的交戰清單結算(用 ctx 的清單,避免行動本身已改過狀態)
  const aoo = applyAttackOfOpportunity(
    { ...inv, engagedWith: ctx.investigator.engagedWith },
    sc,
    ctx.enemyStats ?? {},
  );
  inv = { ...aoo.investigator, engagedWith: inv.engagedWith };
  const effects = [...(out.result.effects ?? []), ...aoo.effects];

  // 移動離開 = 強行脫離:吃完 AoO 後雙向解除交戰(交戰必須同地點)
  if (intent.actionType === 'move') {
    const leftBehind = ctx.investigator.engagedWith;
    inv = { ...inv, engagedWith: [] };
    sc = {
      ...sc,
      enemies: sc.enemies.map((e) =>
        leftBehind.includes(e.instanceId)
          ? { ...e, engagedWith: e.engagedWith.filter((id) => id !== ctx.investigator.investigatorId) }
          : e,
      ),
    };
    effects.push({
      type: 'engagement_broken',
      params: { narrative: '你掙脫了糾纏,逃向另一頭。' },
    });
  }
  return {
    result: { ...out.result, effects },
    newState: { ...out.newState, investigator: inv, scenario: sc },
  };
}

// ─── 各行動結算 ──────────────────────

/** 拿資源 — §6.1 / §4.4 步驟 3 扣行動點(1) / 步驟 4 結算 +1 資源 */
function resolveGainResource(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:拿資源需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const newInv: InvestigatorState = {
    ...ctx.investigator,
    actionPoints: ctx.investigator.actionPoints - 1,
    resources: ctx.investigator.resources + 1,
  };
  return accept(intent, [
    { type: 'spend_action_point', params: { amount: 1 } },
    { type: 'gain_resource', params: { amount: 1 } },
  ], { investigator: newInv });
}

/** 抽卡 — §6.1 / §3.3 牌庫空則受 1 恐懼 */
function resolveDrawCard(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:抽卡需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const newInv: InvestigatorState = {
    ...ctx.investigator,
    actionPoints: ctx.investigator.actionPoints - 1,
  };
  // §3.3:牌庫為空時抽牌改為承受 1 點恐懼傷害,不自動洗回
  if (ctx.investigator.deck.length === 0) {
    newInv.san = Math.max(0, ctx.investigator.san - 1);
    return accept(intent, [
      { type: 'spend_action_point', params: { amount: 1 } },
      { type: 'deck_empty_horror', params: { amount: 1 } },
    ], { investigator: newInv });
  }
  // 正常抽牌
  const drawnCard = ctx.investigator.deck[0];
  newInv.deck = ctx.investigator.deck.slice(1);
  newInv.hand = [...ctx.investigator.hand, drawnCard];
  return accept(intent, [
    { type: 'spend_action_point', params: { amount: 1 } },
    { type: 'draw_card', params: { cardInstanceId: drawnCard }, targetId: ctx.investigator.investigatorId },
  ], { investigator: newInv });
}

/** 移動 — §6.1 普通 1 / §6.2 障礙物 2 / §7.2 交戰中觸發藉機攻擊(暫 stub) */
function resolveMove(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  const targetId = (intent.payload as { targetLocationId?: string }).targetLocationId;
  if (typeof targetId !== 'string') {
    return reject(intent, '移動意圖缺 targetLocationId');
  }
  if (targetId === ctx.investigator.currentLocationId) {
    return reject(intent, '已在該地點,無需移動');
  }
  const target = ctx.scenario.locations.find((l) => l.locationDefinitionId === targetId);
  if (!target) {
    return reject(intent, '目標地點不存在於場景:' + targetId);
  }
  // 相鄰檢查
  const current = ctx.scenario.locations.find(
    (l) => l.locationDefinitionId === ctx.investigator.currentLocationId
  );
  if (!current || !current.connectedTo.includes(targetId)) {
    return reject(intent, '目標地點與當前位置不相鄰');
  }
  // 解鎖檢查(教學關卡用)
  if (ctx.scenario.unlockedLocations.length > 0 && !ctx.scenario.unlockedLocations.includes(targetId)) {
    return reject(intent, '「' + targetId + '」這條路還沒打開', '完成當前地點的目標即可解鎖');
  }
  const cost = target.isObstacle ? 2 : 1;
  if (ctx.investigator.actionPoints < cost) {
    return reject(intent, '行動點不足:移動到「' + targetId + '」需 ' + cost + ',剩 ' + ctx.investigator.actionPoints);
  }
  // 移動本體(§7.2 交戰中移動的藉機攻擊由 finalizeEngagementPenalty 統一結算)
  let newInv: InvestigatorState = {
    ...ctx.investigator,
    actionPoints: ctx.investigator.actionPoints - cost,
    currentLocationId: targetId,
  };
  const effects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: cost } },
    { type: 'move', params: { from: ctx.investigator.currentLocationId, to: targetId } },
  ];
  // §7.6/7.7 進入新位置 → 恐懼半徑掃描(每隻怪只觸發一次)
  const fear = runFearChecks(newInv, ctx.scenario, ctx.enemyStats ?? {}, ctx.rng);
  newInv = fear.investigator;
  effects.push(...fear.effects);
  return accept(intent, effects, { investigator: newInv });
}

/** 嘲諷 — §7.3:1 行動點,將同地點未與你交戰的敵人拉入交戰(無檢定) */
function resolveTaunt(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:嘲諷需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const requestedId = (intent.payload as { enemyInstanceId?: string }).enemyInstanceId;
  const candidates = ctx.scenario.enemies.filter(
    (e) =>
      e.hp > 0 &&
      e.locationId === ctx.investigator.currentLocationId &&
      !e.engagedWith.includes(ctx.investigator.investigatorId),
  );
  const enemy = requestedId
    ? candidates.find((e) => e.instanceId === requestedId)
    : candidates[0];
  if (!enemy) {
    return reject(intent, '同地點沒有未與你交戰的敵人');
  }
  const newInv: InvestigatorState = {
    ...ctx.investigator,
    actionPoints: ctx.investigator.actionPoints - 1,
    engagedWith: [...ctx.investigator.engagedWith, enemy.instanceId],
  };
  const newScenario: ScenarioState = {
    ...ctx.scenario,
    enemies: ctx.scenario.enemies.map((e) =>
      e.instanceId === enemy.instanceId
        ? { ...e, engagedWith: [...e.engagedWith, ctx.investigator.investigatorId] }
        : e,
    ),
  };
  return accept(
    intent,
    [
      { type: 'spend_action_point', params: { amount: 1 } },
      { type: 'taunt', params: { narrative: '你大聲叫罵,牠的注意力轉向了你。' }, targetId: enemy.instanceId },
    ],
    { investigator: newInv, scenario: newScenario },
  );
}

/**
 * 調查 — §6.1 / §13(線索系統)+ §4 檢定管線
 * 感知檢定,DC = 地點 shroud(locationStats 未提供時 fallback 10);支援加值 commit。
 * 隱藏調查點(hidden_info 揭露)後續展開。
 */
function resolveInvestigate(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:調查需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const commit = takeCommit(intent, ctx, 'perception');
  if (commit.error) return reject(intent, commit.error);

  const locId = ctx.investigator.currentLocationId || '';
  const dc = ctx.locationStats?.[locId]?.shroud ?? 10;
  const check = resolveCheck(
    dc,
    {
      attribute: ctx.investigator.attributes.perception,
      commit: commit.value,
      // 城主附著卡的全域檢定修正(海腥味瀰漫等)
      situational: attachmentTestModifier(ctx.scenario.keeperAttachments, 'perception'),
    },
    ctx.rng,
  );
  const success = check.outcome === 'success';
  const newInv: InvestigatorState = {
    ...applyCommitToInvestigator(ctx.investigator, commit.committedIds),
    actionPoints: ctx.investigator.actionPoints - 1,
  };
  const baseEffects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    ...commitEffects(commit),
    { type: 'roll_d20', params: { roll: check.roll, attribute: 'perception', modifier: check.total - check.roll, total: check.total, dc, outcome: success ? 'success' : 'fail' } },
  ];
  if (!success) {
    return accept(intent, [...baseEffects, { type: 'investigate_fail', params: { narrative: '你翻找了一圈,什麼線索都沒留下。' } }], { investigator: newInv });
  }
  // 成功:在當前地點放 1 線索
  const newScenario: ScenarioState = {
    ...ctx.scenario,
    objectiveProgress: ctx.scenario.objectiveProgress + 1,
    tokens: [
      ...ctx.scenario.tokens,
      { tokenType: 'clue', locationId: ctx.investigator.currentLocationId || '', amount: 1 },
    ],
  };
  const after = applyOnSuccessCommit(true, commit.committedIds, newInv, newScenario, ctx.cardLookup ?? {});
  return accept(
    intent,
    [
      ...baseEffects,
      { type: 'investigate_success', params: { narrative: '你在塵埃裡發現了一張被遺忘的紙條。', clueAmount: 1 }, targetId: ctx.investigator.currentLocationId || undefined },
      { type: 'gain_clue', params: { amount: 1 } },
      ...after.effects,
    ],
    { investigator: after.investigator, scenario: after.scenario }
  );
}

/**
 * 攻擊 — §6.1 / §5(完整版見第三章 §5)
 * G1 階段簡化:擲 d20 + 力量修正 vs 怪物 DC 10
 * 命中 → 怪物 hp -1
 * 未實作:戰鬥風格卡 / 武器加值 / 三層修正 / 自然 20/1 特殊處理
 */
function resolveAttack(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:攻擊需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const targetEnemyId = (intent.payload as { enemyInstanceId?: string }).enemyInstanceId;
  if (!targetEnemyId) {
    // 自動鎖定當前地點第一隻活著的怪物
    const enemyHere = ctx.scenario.enemies.find((e) => e.locationId === ctx.investigator.currentLocationId && e.hp > 0);
    if (!enemyHere) {
      return reject(intent, '當前地點沒有可攻擊的目標');
    }
    return performAttack(intent, ctx, enemyHere.instanceId);
  }
  return performAttack(intent, ctx, targetEnemyId);
}

/**
 * 攻擊結算 — §4 檢定管線 + §7.5 + §12.1 光照
 * DC = 怪物 dc(enemyStats 未提供時 fallback 10);夜間/黑暗攻擊 -2;
 * 自然 20 爆擊傷害 ×2;自然 1 無交戰隊友 → 純未命中(誤傷隊友屬多人,後續)。
 * 基礎傷害 1(武器卡面傷害等 play_card 落地後接上,§7.5)。
 * 屬性暫用力量(戰鬥風格卡抽取屬性在下一批接上,§8)。
 */
function performAttack(intent: IntentMessage, ctx: RuleContext, enemyInstanceId: string): RuleResolveOutput {
  const enemy = ctx.scenario.enemies.find((e) => e.instanceId === enemyInstanceId);
  if (!enemy || enemy.hp <= 0) {
    return reject(intent, '目標已倒下或不存在');
  }
  if (enemy.locationId !== ctx.investigator.currentLocationId) {
    return reject(intent, '目標不在你所在地點');
  }
  const commit = takeCommit(intent, ctx, 'strength');
  if (commit.error) return reject(intent, commit.error);

  const here = ctx.scenario.locations.find(
    (l) => l.locationDefinitionId === ctx.investigator.currentLocationId,
  );
  const situational = here ? visibilityModifier('attack', here.visibility) : 0;
  const dc = ctx.enemyStats?.[enemy.enemyDefinitionId]?.dc ?? 10;
  const check = resolveCheck(
    dc,
    { attribute: ctx.investigator.attributes.strength, commit: commit.value, situational },
    ctx.rng,
  );
  const newInv: InvestigatorState = {
    ...applyCommitToInvestigator(ctx.investigator, commit.committedIds),
    actionPoints: ctx.investigator.actionPoints - 1,
  };
  const baseEffects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    ...commitEffects(commit),
    { type: 'roll_d20', params: { roll: check.roll, attribute: 'strength', modifier: check.total - check.roll, total: check.total, dc, outcome: check.outcome === 'success' ? 'hit' : 'miss', natural20: check.natural20, natural1: check.natural1 }, targetId: enemyInstanceId },
  ];
  // §7.5 自然 1:有交戰隊友時誤傷;單人無隊友 → 純未命中
  if (check.outcome !== 'success' || check.natural1) {
    return accept(intent, [...baseEffects, { type: 'attack_miss', params: { narrative: check.natural1 ? '你的攻擊完全落空,差點傷到自己。' : '你的攻擊擦身而過,牠仍站在那裡。' }, targetId: enemyInstanceId }], { investigator: newInv });
  }
  // 命中:基礎 1 點;自然 20 爆擊 ×2(§7.5)
  const damage = check.natural20 ? 2 : 1;
  const newHp = enemy.hp - damage;
  const newScenario: ScenarioState = {
    ...ctx.scenario,
    enemies: ctx.scenario.enemies.map((e) => (e.instanceId === enemyInstanceId ? { ...e, hp: newHp } : e)),
  };
  const effects: ResultEffect[] = [
    ...baseEffects,
    { type: 'attack_hit', params: { damage, critical: check.natural20, narrative: (check.natural20 ? '【爆擊】' : '') + hpToNarrative(newHp, enemy.hp) }, targetId: enemyInstanceId },
  ];
  if (newHp <= 0) {
    effects.push({ type: 'enemy_defeated', params: { narrative: '牠倒下了,空氣裡只剩下血腥與沉默。' }, targetId: enemyInstanceId });
  }
  return accept(intent, effects, { investigator: newInv, scenario: newScenario });
}

/**
 * 閃避 — §7.4:成敗都脫離交戰;失敗受敵人物理傷害一次;成功敵人被絆倒。
 * 反應檢定(支柱一 v0.3 §12.4:閃避屬反應屬性影響範圍);DC = 敵人 dc fallback 10;
 * §12.1 黑暗中閃避 +2。
 */
function resolveEvade(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:閃避需 1,剩 ' + ctx.investigator.actionPoints);
  }
  if (ctx.investigator.engagedWith.length === 0) {
    return reject(intent, '你沒有與任何敵人交戰,無需閃避');
  }
  const commit = takeCommit(intent, ctx, 'reflex');
  if (commit.error) return reject(intent, commit.error);

  // 一次閃避結算一隻:payload 可指定,預設交戰清單第一隻(多敵交戰要逐隻閃避)
  const requestedId = (intent.payload as { enemyInstanceId?: string }).enemyInstanceId;
  const enemyId = requestedId ?? ctx.investigator.engagedWith[0];
  if (!ctx.investigator.engagedWith.includes(enemyId)) {
    return reject(intent, '你沒有與該敵人交戰:' + enemyId);
  }
  const enemy = ctx.scenario.enemies.find((e) => e.instanceId === enemyId);
  const here = ctx.scenario.locations.find(
    (l) => l.locationDefinitionId === ctx.investigator.currentLocationId,
  );
  const situational = here ? visibilityModifier('evade', here.visibility) : 0;
  const dc = enemy ? ctx.enemyStats?.[enemy.enemyDefinitionId]?.dc ?? 10 : 10;
  const check = resolveCheck(
    dc,
    { attribute: ctx.investigator.attributes.reflex, commit: commit.value, situational },
    ctx.rng,
  );
  const success = check.outcome === 'success';
  const damageTaken = success
    ? 0
    : (enemy ? ctx.enemyStats?.[enemy.enemyDefinitionId]?.damage_physical ?? 1 : 1);

  // §7.4 成敗都脫離交戰 — 只脫離本次結算的這一隻,其他交戰維持
  const newInv: InvestigatorState = {
    ...applyCommitToInvestigator(ctx.investigator, commit.committedIds),
    actionPoints: ctx.investigator.actionPoints - 1,
    engagedWith: ctx.investigator.engagedWith.filter((id) => id !== enemyId),
    hp: Math.max(0, ctx.investigator.hp - damageTaken),
  };
  const newScenario: ScenarioState = {
    ...ctx.scenario,
    enemies: ctx.scenario.enemies.map((e) =>
      e.instanceId === enemyId
        ? { ...e, engagedWith: e.engagedWith.filter((id) => id !== ctx.investigator.investigatorId) }
        : e,
    ),
  };
  const effects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    ...commitEffects(commit),
    { type: 'roll_d20', params: { roll: check.roll, attribute: 'reflex', modifier: check.total - check.roll, total: check.total, dc, outcome: success ? 'success' : 'fail' } },
    success
      ? { type: 'evade_success', params: { narrative: '你側身一滾,牠撲空絆倒。你脫離了交戰。' }, targetId: enemyId }
      : { type: 'evade_fail', params: { damage: damageTaken, narrative: '你掙脫了,但牠的爪子在你身上留下一道口子。' }, targetId: enemyId },
  ];
  return accept(intent, effects, { investigator: newInv, scenario: newScenario });
}


/**
 * 打出卡片 — §6.1:1 行動點 + 支付卡片費用(資源)
 * 事件卡:立即結算 action 觸發效果 → 棄牌堆
 * 資產/武器/盟友:進場(assetsInPlay),passive 效果由檢定時聚合
 * 技能卡:不可打出(用於加值 commit,ch3 §3.2)
 */
function resolvePlayCard(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:打出卡片需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const cardId = (intent.payload as { cardInstanceId?: string }).cardInstanceId;
  if (typeof cardId !== 'string' || !ctx.investigator.hand.includes(cardId)) {
    return reject(intent, '該卡不在手牌中:' + String(cardId));
  }
  const data = ctx.cardLookup?.[cardId];
  if (!data) {
    return reject(intent, '查無卡片資料:' + cardId);
  }
  if (data.card_type === 'skill') {
    return reject(intent, '技能卡不打出 — 在檢定時投入加值(ch3 §3.2)');
  }
  const cost = Number(data.cost ?? 0);
  if (ctx.investigator.resources < cost) {
    return reject(intent, '資源不足:「' + (data.name_zh ?? cardId) + '」需 ' + cost + ',剩 ' + ctx.investigator.resources);
  }

  let inv: InvestigatorState = {
    ...ctx.investigator,
    actionPoints: ctx.investigator.actionPoints - 1,
    resources: ctx.investigator.resources - cost,
    hand: ctx.investigator.hand.filter((id) => id !== cardId),
  };
  const baseEffects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    { type: 'play_card', params: { cardInstanceId: cardId, name: data.name_zh ?? '', cost } },
  ];

  if (data.card_type === 'event') {
    // 事件卡:結算 action 效果 → 棄牌堆
    const actionFx = (data.effects ?? []).filter((f) => f.trigger_type === 'action');
    const exec = executeCardEffects(actionFx, inv, ctx.scenario, ctx.cardLookup ?? {});
    inv = { ...exec.investigator, discardPile: [...exec.investigator.discardPile, cardId] };
    const effects = [...baseEffects, ...exec.effects];
    if (exec.unsupported.length > 0) {
      effects.push({ type: 'effect_unsupported', params: { codes: exec.unsupported } });
    }
    return accept(intent, effects, { investigator: inv, scenario: exec.scenario });
  }

  // 資產/武器/盟友:進場
  inv = { ...inv, assetsInPlay: [...inv.assetsInPlay, cardId] };
  return accept(intent, [...baseEffects, { type: 'asset_enters_play', params: { cardInstanceId: cardId, name: data.name_zh ?? '' } }], { investigator: inv });
}

/**
 * 執行卡片行動 — §6.1 use_card:場上資產的 action 效果,1 行動點
 * 武器 attack 效果走 §8 風格卡抽取路徑;其餘走效果執行器。
 * payload: { cardInstanceId, actionIndex?(同卡多段行動,預設 0), enemyInstanceId?, commitCardIds? }
 */
function resolveExecuteCardAction(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:執行卡片行動需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const p = intent.payload as { cardInstanceId?: string; actionIndex?: number };
  const cardId = p.cardInstanceId;
  if (typeof cardId !== 'string' || !ctx.investigator.assetsInPlay.includes(cardId)) {
    return reject(intent, '該卡不在場上:' + String(cardId));
  }
  const data = ctx.cardLookup?.[cardId];
  const actionFx = (data?.effects ?? []).filter((f) => f.trigger_type === 'action');
  if (actionFx.length === 0) {
    return reject(intent, '「' + (data?.name_zh ?? cardId) + '」沒有可執行的行動效果');
  }
  const idx = Math.min(Math.max(0, Number(p.actionIndex ?? 0)), actionFx.length - 1);
  const fx = actionFx[idx];

  if (fx.effect_code === 'attack') {
    return performWeaponAttack(intent, ctx, cardId, fx);
  }

  const inv: InvestigatorState = { ...ctx.investigator, actionPoints: ctx.investigator.actionPoints - 1 };
  const exec = executeCardEffects([fx], inv, ctx.scenario, ctx.cardLookup ?? {});
  const effects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    { type: 'card_action', params: { cardInstanceId: cardId, name: data?.name_zh ?? '' } },
    ...exec.effects,
  ];
  if (exec.unsupported.length > 0) {
    effects.push({ type: 'effect_unsupported', params: { codes: exec.unsupported } });
  }
  return accept(intent, effects, { investigator: exec.investigator, scenario: exec.scenario });
}

/**
 * 武器攻擊 — §8 戰鬥風格卡系統:
 * 武器 combat_style 決定抽哪個風格池 → 抽 1 張風格卡指定檢定屬性 →
 * d20 + 該屬性 + 武器 attribute_modifiers(僅對應屬性,§8)+ 場上被動 + commit + 光照
 * 命中傷害 = 效果 params.damage(資料未填時 fallback 2)+ params.damage_bonus
 */
function performWeaponAttack(
  intent: IntentMessage,
  ctx: RuleContext,
  weaponId: string,
  fx: { effect_params: Record<string, unknown> | null },
): RuleResolveOutput {
  const weapon = ctx.cardLookup?.[weaponId];
  const style = String(weapon?.combat_style ?? '');
  const pool = ctx.stylePools?.[style] ?? [];
  if (pool.length === 0) {
    return reject(intent, '「' + (weapon?.name_zh ?? weaponId) + '」的風格池(' + style + ')為空,無法抽風格卡');
  }
  const requestedEnemy = (intent.payload as { enemyInstanceId?: string }).enemyInstanceId;
  const enemy = requestedEnemy
    ? ctx.scenario.enemies.find((e) => e.instanceId === requestedEnemy)
    : ctx.scenario.enemies.find((e) => e.locationId === ctx.investigator.currentLocationId && e.hp > 0);
  if (!enemy || enemy.hp <= 0) {
    return reject(intent, '當前地點沒有可攻擊的目標');
  }
  if (enemy.locationId !== ctx.investigator.currentLocationId) {
    return reject(intent, '目標不在你所在地點');
  }

  const rng = ctx.rng ?? Math.random;
  const styleCard = pool[Math.floor(rng() * pool.length)];
  const attr = styleCard.check_attribute as AttributeKey;
  if (!(attr in ctx.investigator.attributes)) {
    return reject(intent, '風格卡「' + styleCard.name_zh + '」檢定屬性不合法:' + styleCard.check_attribute);
  }
  const commit = takeCommit(intent, ctx, attr);
  if (commit.error) return reject(intent, commit.error);

  const here = ctx.scenario.locations.find(
    (l) => l.locationDefinitionId === ctx.investigator.currentLocationId,
  );
  const situational =
    (here ? visibilityModifier('attack', here.visibility) : 0) +
    attachmentTestModifier(ctx.scenario.keeperAttachments, attr);
  // §8:武器修正只在對應屬性風格卡被抽到時生效 + 場上被動(瞄準鏡等)
  const equipment =
    Number(weapon?.attribute_modifiers?.[attr] ?? 0) +
    passiveTestModifier(ctx.investigator, ctx.cardLookup ?? {}, attr);
  const dc = ctx.enemyStats?.[enemy.enemyDefinitionId]?.dc ?? 10;
  const check = resolveCheck(
    dc,
    { attribute: ctx.investigator.attributes[attr], equipment, commit: commit.value, situational },
    ctx.rng,
  );

  let inv: InvestigatorState = {
    ...applyCommitToInvestigator(ctx.investigator, commit.committedIds),
    actionPoints: ctx.investigator.actionPoints - 1,
  };
  const baseEffects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    { type: 'style_card_drawn', params: { style, name: styleCard.name_zh, attribute: attr, narrative: styleCard.narrative_attack_zh ?? '' } },
    ...commitEffects(commit),
    { type: 'roll_d20', params: { roll: check.roll, attribute: attr, modifier: check.total - check.roll, total: check.total, dc, outcome: check.outcome === 'success' ? 'hit' : 'miss', natural20: check.natural20, natural1: check.natural1 }, targetId: enemy.instanceId },
  ];

  if (check.outcome !== 'success' || check.natural1) {
    const miss = [...baseEffects, { type: 'attack_miss', params: { narrative: styleCard.narrative_fail_zh || '你的攻擊落空了。' }, targetId: enemy.instanceId }];
    const after = applyOnSuccessCommit(false, commit.committedIds, inv, ctx.scenario, ctx.cardLookup ?? {});
    return accept(intent, [...miss, ...after.effects], { investigator: after.investigator, scenario: after.scenario });
  }

  const params = (fx.effect_params ?? {}) as Record<string, any>;
  // 武器卡面傷害(§7.5):params.damage 未填時 fallback 2(資料補齊中)
  const base = Number(params.damage ?? 2) + Number(params.damage_bonus ?? 0);
  const damage = check.natural20 ? base * 2 : base;
  const newHp = enemy.hp - damage;
  let sc: ScenarioState = {
    ...ctx.scenario,
    enemies: ctx.scenario.enemies.map((e) => (e.instanceId === enemy.instanceId ? { ...e, hp: newHp } : e)),
  };
  const effects: ResultEffect[] = [
    ...baseEffects,
    { type: 'attack_hit', params: { damage, critical: check.natural20, weapon: weapon?.name_zh ?? '', narrative: (check.natural20 ? '【爆擊】' : '') + (styleCard.narrative_success_zh || hpToNarrative(newHp, enemy.hp)) }, targetId: enemy.instanceId },
  ];
  if (newHp <= 0) {
    effects.push({ type: 'enemy_defeated', params: { narrative: '牠倒下了,空氣裡只剩下血腥與沉默。' }, targetId: enemy.instanceId });
  }
  const after = applyOnSuccessCommit(true, commit.committedIds, inv, sc, ctx.cardLookup ?? {});
  inv = after.investigator;
  sc = after.scenario;
  return accept(intent, [...effects, ...after.effects], { investigator: inv, scenario: sc });
}

/**
 * 投入檢定的卡片 on_success 效果(ch3 §3.2 技能卡附贈):
 * 檢定成功後,結算所有被 commit 卡片的 on_success 觸發效果(如:成功後抽 1 張)。
 */
function applyOnSuccessCommit(
  success: boolean,
  committedIds: string[],
  investigator: InvestigatorState,
  scenario: ScenarioState,
  cardLookup: CardDataLookup,
): { investigator: InvestigatorState; scenario: ScenarioState; effects: ResultEffect[] } {
  if (!success || committedIds.length === 0) {
    return { investigator, scenario, effects: [] };
  }
  let inv = investigator;
  let sc = scenario;
  const effects: ResultEffect[] = [];
  for (const id of committedIds) {
    const onSuccess = (cardLookup[id]?.effects ?? []).filter((f) => f.trigger_type === 'on_success');
    if (onSuccess.length === 0) continue;
    const exec = executeCardEffects(onSuccess, inv, sc, cardLookup);
    inv = exec.investigator;
    sc = exec.scenario;
    effects.push(...exec.effects);
  }
  return { investigator: inv, scenario: sc, effects };
}

/** §7.8 隱藏資訊:敵人血量轉敘事性狀態(簡化:依絕對 hp 不依百分比)*/
function hpToNarrative(newHp: number, prevHp: number): string {
  if (newHp <= 0) return '牠倒下了';
  if (newHp <= 1) return '牠瀕臨倒下,呼吸像是漏氣的風箱';
  if (newHp <= 2) return '牠拖著斷裂的肢體,動作明顯遲緩';
  if (prevHp >= 5 && newHp < 5) return '牠的動作慢了下來,有幾道傷口';
  return '牠看起來幾乎毫髮無傷';
}

// ─── 輔助:接受 / 駁回 構造 ResultMessage ──
function accept(
  intent: IntentMessage,
  effects: ResultEffect[],
  newState: RuleResolveOutput['newState']
): RuleResolveOutput {
  return {
    result: {
      kind: 'result',
      source: 'engine',
      inResponseTo: intent.id,
      outcome: 'accepted',
      effects,
    },
    newState,
  };
}

function reject(intent: IntentMessage, narrative: string, suggestion?: string): RuleResolveOutput {
  return {
    result: {
      kind: 'result',
      source: 'engine',
      inResponseTo: intent.id,
      outcome: 'rejected',
      rejection: { narrative, suggestion },
    },
  };
}

// ─── 簡易工廠:套訊息匯流排用 ──────────
/**
 * 把 ResolveOutput 的 result 轉成可丟給 messageBus.publish 的 PartialMessage
 * (補上 schemaVersion / id / timestamp 由 bus 自動補)
 */
export function buildResultMessage(output: RuleResolveOutput): Omit<ResultMessage, 'id' | 'timestamp' | 'schemaVersion'> {
  return output.result;
}

// 確保 LocationInstance 在型別表面被引用(供 IDE 跳轉)
export type { LocationInstance };
