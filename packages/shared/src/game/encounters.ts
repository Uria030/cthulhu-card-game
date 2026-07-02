/**
 * G-08 引擎核心 — 遭遇卡觸發與結算(最小版)
 *
 * 權威依據:
 * - s14 §1.2 / 城主規範 §2.2:遭遇卡四條觸發途徑(本版實作「進入新地點」途徑,
 *   技術債_遭遇卡觸發系統 §結論指定的最快解鎖路,client 層觸發不動 schema)
 * - s09:遭遇卡三威脅類型(mental/physical/ritual)× 強度 × 子程式;
 *   選項型互動(每張 2-3 選項,可帶檢定)
 * - 02_rulebook_ch2.md §4:選項檢定走 d20 管線
 *
 * 重要現況(2026-06-13 查證):全庫 46 張遭遇卡選項文字與效果**皆空**——
 * 本引擎讀結構化效果結算,內容由 Gemini 量產線補上後即生效;本版以合成內容測試。
 */
import type { ResultEffect } from './messages';
import type { ScenarioState, InvestigatorState } from './state';
import { resolveCheck } from './checks';
import { modifyIncomingDamage, applyCheckStatus } from './statusEffects';
import { applyIncomingDamageToPlayer } from './ally';
import type { AttributeKey } from './checks';
import { spawnEnemy } from './monsterActions';
import type { EnemyDataLookup } from './monsterActions';

// ─── 遭遇卡資料(bootstrap encounter_cards rows + options)────
export interface EncounterEffect {
  /** 效果碼(支援 deal_horror/deal_damage/place_doom/spawn_enemy/draw_card/discover_clue) */
  effect_code?: string;
  type?: string; // 容錯:部分資料用 type 命名
  amount?: number;
  variant_code?: string;
  location_code?: string;
  [key: string]: unknown;
}

export interface EncounterOption {
  option_label?: string;
  option_text_zh?: string | null;
  requires_check?: boolean;
  check_attribute?: string | null;
  check_dc?: number | null;
  success_narrative_zh?: string | null;
  failure_narrative_zh?: string | null;
  no_check_narrative_zh?: string | null;
  success_effects?: EncounterEffect[];
  failure_effects?: EncounterEffect[];
  no_check_effects?: EncounterEffect[];
}

export interface EncounterCardData {
  id: string;
  name_zh: string;
  scenario_text_zh?: string | null;
  encounter_type?: string;
  threat_type?: string | null;
  threat_strength?: number | null;
  options: EncounterOption[];
}

export type EncounterTriggerPath =
  | 'turn_end'
  | 'chaos_headline'
  | 'keeper_mythos'
  | 'player_action';

export interface EncounterTriggerConfig {
  /** Draw one encounter when the round moves through turn_end. */
  draw_on_turn_end?: boolean;
  /** Location codes that draw after a player enters them. */
  trigger_locations?: string[];
  /** Player action codes that draw after accepted resolution. */
  trigger_actions?: string[];
  /** Draw when a spell chaos token resolves as headline. Defaults to true for headline tokens. */
  chaos_headline?: boolean;
  /** Draw when the keeper activates a mythos card with card_category='encounter'. Defaults to true. */
  keeper_mythos?: boolean;
}

export interface EncounterTriggerContext {
  path: EncounterTriggerPath;
  locationId?: string | null;
  actionType?: string | null;
  mythosCardCategory?: string | null;
  chaosTokenType?: string | null;
}

export interface EncounterTriggerDecision {
  shouldDraw: boolean;
  reason: string;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export function normaliseEncounterTriggerConfig(raw: unknown): EncounterTriggerConfig {
  if (!raw || typeof raw !== 'object') return {};
  const src = raw as Record<string, unknown>;
  const out: EncounterTriggerConfig = {};
  if (typeof src.draw_on_turn_end === 'boolean') out.draw_on_turn_end = src.draw_on_turn_end;
  if (typeof src.chaos_headline === 'boolean') out.chaos_headline = src.chaos_headline;
  if (typeof src.keeper_mythos === 'boolean') out.keeper_mythos = src.keeper_mythos;
  const locations = stringList(src.trigger_locations);
  const actions = stringList(src.trigger_actions);
  if (locations.length > 0) out.trigger_locations = locations;
  if (actions.length > 0) out.trigger_actions = actions;
  return out;
}

export function mergeEncounterTriggerConfigs(
  ...configs: Array<EncounterTriggerConfig | null | undefined>
): EncounterTriggerConfig {
  const merged: EncounterTriggerConfig = {};
  for (const cfg of configs) {
    if (!cfg) continue;
    if (cfg.draw_on_turn_end !== undefined) merged.draw_on_turn_end = cfg.draw_on_turn_end;
    if (cfg.chaos_headline !== undefined) merged.chaos_headline = cfg.chaos_headline;
    if (cfg.keeper_mythos !== undefined) merged.keeper_mythos = cfg.keeper_mythos;
    if (cfg.trigger_locations) {
      merged.trigger_locations = [...new Set([...(merged.trigger_locations ?? []), ...cfg.trigger_locations])];
    }
    if (cfg.trigger_actions) {
      merged.trigger_actions = [...new Set([...(merged.trigger_actions ?? []), ...cfg.trigger_actions])];
    }
  }
  return merged;
}

export function shouldDrawEncounter(
  config: EncounterTriggerConfig,
  context: EncounterTriggerContext,
): EncounterTriggerDecision {
  switch (context.path) {
    case 'turn_end':
      return { shouldDraw: config.draw_on_turn_end === true, reason: 'turn_end' };
    case 'chaos_headline':
      return {
        shouldDraw: context.chaosTokenType === 'headline' && config.chaos_headline !== false,
        reason: 'chaos_headline',
      };
    case 'keeper_mythos':
      return {
        shouldDraw: context.mythosCardCategory === 'encounter' && config.keeper_mythos !== false,
        reason: 'keeper_mythos',
      };
    case 'player_action': {
      const byLocation = !!context.locationId && (config.trigger_locations ?? []).includes(context.locationId);
      const byAction = !!context.actionType && (config.trigger_actions ?? []).includes(context.actionType);
      return {
        shouldDraw: byLocation || byAction,
        reason: byLocation ? 'player_action_location' : 'player_action_code',
      };
    }
    default:
      return { shouldDraw: false, reason: 'unsupported_trigger' };
  }
}

// ─── 觸發:進入新地點抽 1 張(技術債最快解鎖路)────
export interface EncounterDraw {
  card: EncounterCardData | null;
  /** 抽走後剩餘的牌堆(不洗回,抽完即無) */
  remaining: EncounterCardData[];
}

export interface TriggeredEncounterDraw extends EncounterDraw {
  triggered: boolean;
  reason: string;
}

/**
 * 抽一張遭遇卡。優先抽威脅類型能對上玩家破除手段的(s09 破除軸精神),
 * v0 簡化為依序抽(牌堆已是設計者排序);牌堆空回 null。
 */
export function drawEncounter(deck: EncounterCardData[], rng: () => number = Math.random): EncounterDraw {
  if (deck.length === 0) return { card: null, remaining: [] };
  const idx = Math.floor(rng() * deck.length);
  const card = deck[idx];
  return { card, remaining: deck.filter((_, i) => i !== idx) };
}

export function drawTriggeredEncounter(
  deck: EncounterCardData[],
  config: EncounterTriggerConfig,
  context: EncounterTriggerContext,
  rng: () => number = Math.random,
): TriggeredEncounterDraw {
  const decision = shouldDrawEncounter(config, context);
  if (!decision.shouldDraw) {
    return { triggered: false, reason: decision.reason, card: null, remaining: deck };
  }
  const draw = drawEncounter(deck, rng);
  return { triggered: draw.card !== null, reason: decision.reason, ...draw };
}

// ─── 結算:選一個選項,跑檢定(若需要),施加結構化效果 ────
export interface EncounterResolveResult {
  investigator: InvestigatorState;
  scenario: ScenarioState;
  effects: ResultEffect[];
}

const VALID_ATTRS = new Set<AttributeKey>([
  'strength', 'agility', 'constitution', 'reflex', 'intellect', 'willpower', 'perception', 'charisma',
]);

function applyEncounterEffects(
  list: EncounterEffect[] | undefined,
  investigator: InvestigatorState,
  scenario: ScenarioState,
  enemyData: EnemyDataLookup,
): EncounterResolveResult {
  let inv = investigator;
  let sc = scenario;
  const effects: ResultEffect[] = [];
  for (const fx of list ?? []) {
    const code = String(fx.effect_code ?? fx.type ?? '');
    const amount = Number(fx.amount ?? 1);
    switch (code) {
      case 'deal_horror':
      case 'san_damage': {
        const dmg = modifyIncomingDamage(inv.statusEffects, 0, amount).horror; // §6 發瘋/標記 + / 護盾 −
        const ad = applyIncomingDamageToPlayer(inv, 0, dmg); // §11 盟友先吸
        inv = ad.investigator;
        effects.push({ type: 'fear_damage', params: { amount: dmg, narrative: '某種東西擦過了你的神智。' }, targetId: inv.investigatorId });
        effects.push(...ad.effects);
        break;
      }
      case 'deal_damage':
      case 'hp_damage': {
        const dmg = modifyIncomingDamage(inv.statusEffects, amount, 0).physical; // §6 脆弱/標記 + / 護甲 −
        const ad = applyIncomingDamageToPlayer(inv, dmg, 0); // §11 盟友先吸
        inv = ad.investigator;
        effects.push({ type: 'encounter_damage', params: { amount: dmg, narrative: '你受了傷。' }, targetId: inv.investigatorId });
        effects.push(...ad.effects);
        break;
      }
      case 'place_doom':
        sc = { ...sc, agendaProgress: sc.agendaProgress + amount };
        effects.push({ type: 'doom_added', params: { amount, total: sc.agendaProgress } });
        break;
      case 'discover_clue':
        sc = { ...sc, objectiveProgress: sc.objectiveProgress + amount, tokens: [...sc.tokens, { tokenType: 'clue', locationId: inv.currentLocationId || '', amount }] };
        effects.push({ type: 'gain_clue', params: { amount } });
        break;
      case 'draw_card':
        if (inv.deck.length > 0) {
          const drawn = inv.deck[0];
          inv = { ...inv, deck: inv.deck.slice(1), hand: [...inv.hand, drawn] };
          effects.push({ type: 'draw_card', params: { cardInstanceId: drawn } });
        }
        break;
      case 'spawn_enemy': {
        const variant = fx.variant_code ? String(fx.variant_code) : null;
        const loc = fx.location_code ? String(fx.location_code) : inv.currentLocationId ?? '';
        if (variant && enemyData[variant]) {
          const spawned = spawnEnemy(sc, variant, loc, enemyData, 1);
          sc = spawned.scenario;
          effects.push({ type: 'enemy_spawned', params: { enemy: enemyData[variant]?.name_zh ?? variant, code: variant, location: loc }, targetId: spawned.enemy.instanceId });
        }
        break;
      }
      default:
        if (code) effects.push({ type: 'effect_unsupported', params: { codes: [code] } });
    }
  }
  return { investigator: inv, scenario: sc, effects };
}

/**
 * 結算一個遭遇卡選項。requires_check 時跑檢定,成功施 success_effects、
 * 失敗施 failure_effects;不需檢定施 no_check_effects。
 */
export function resolveEncounterOption(
  option: EncounterOption,
  investigator: InvestigatorState,
  scenario: ScenarioState,
  enemyData: EnemyDataLookup,
  rng: () => number = Math.random,
): EncounterResolveResult {
  const effects: ResultEffect[] = [];

  if (option.requires_check && option.check_attribute) {
    const attr = String(option.check_attribute) as AttributeKey;
    const attrVal = VALID_ATTRS.has(attr) ? investigator.attributes[attr] : 0;
    const dc = Number(option.check_dc ?? 10);
    // §6 強化取好/弱化取差 + 擲骰後減層
    const cs = applyCheckStatus(investigator.statusEffects);
    const check = resolveCheck(dc, { attribute: attrVal }, rng, cs.rollMode);
    const success = check.outcome === 'success';
    effects.push({
      type: 'encounter_check',
      params: { attribute: attr, roll: check.roll, total: check.total, dc, outcome: success ? 'success' : 'fail' },
    });
    const narrative = success ? option.success_narrative_zh : option.failure_narrative_zh;
    if (narrative) effects.push({ type: 'encounter_narrative', params: { narrative } });
    const applied = applyEncounterEffects(success ? option.success_effects : option.failure_effects, { ...investigator, statusEffects: cs.statusEffects }, scenario, enemyData);
    return { investigator: applied.investigator, scenario: applied.scenario, effects: [...effects, ...applied.effects] };
  }

  // 無檢定選項
  if (option.no_check_narrative_zh) effects.push({ type: 'encounter_narrative', params: { narrative: option.no_check_narrative_zh } });
  const applied = applyEncounterEffects(option.no_check_effects, investigator, scenario, enemyData);
  return { investigator: applied.investigator, scenario: applied.scenario, effects: [...effects, ...applied.effects] };
}

/**
 * AI 選項啟發式:估每個選項的「淨損益」,挑損失最小的(調查員都想活)。
 * 檢定型選項依成功率加權;有正面效果(線索/抽卡)的選項加分。
 */
export function chooseEncounterOption(
  card: EncounterCardData,
  investigator: InvestigatorState,
): number {
  let bestIdx = 0;
  let bestScore = -Infinity;
  card.options.forEach((opt, i) => {
    let score = 0;
    const evalEffects = (list: EncounterEffect[] | undefined, weight: number) => {
      for (const fx of list ?? []) {
        const code = String(fx.effect_code ?? fx.type ?? '');
        const amt = Number(fx.amount ?? 1);
        if (/horror|san_damage|deal_damage|hp_damage|place_doom|spawn_enemy/.test(code)) score -= amt * weight;
        if (/discover_clue|draw_card/.test(code)) score += amt * weight;
      }
    };
    if (opt.requires_check && opt.check_attribute) {
      const attr = String(opt.check_attribute) as AttributeKey;
      const attrVal = VALID_ATTRS.has(attr) ? investigator.attributes[attr] : 0;
      const dc = Number(opt.check_dc ?? 10);
      const pSuccess = Math.min(0.95, Math.max(0.05, (21 - (dc - attrVal)) / 20));
      evalEffects(opt.success_effects, pSuccess);
      evalEffects(opt.failure_effects, 1 - pSuccess);
    } else {
      evalEffects(opt.no_check_effects, 1);
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });
  return bestIdx;
}
