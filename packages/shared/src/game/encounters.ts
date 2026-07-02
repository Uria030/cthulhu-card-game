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
import type { AttributeKey, CheckResult } from './checks';
import { spawnEnemy } from './monsterActions';
import type { EnemyDataLookup } from './monsterActions';
import { cardMaxUses } from './ruleEngine';
import type { CardData, CardDataLookup } from './ruleEngine';
import { TOLL_FUNCTIONS } from '../types/talisman';
import type { BreakTiming, BreakTestAttribute, EncounterSubroutine, ThreatTypeCode } from '../types/talisman';

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
  threat_type_array?: unknown;
  threat_strength?: number | null;
  designer_dv?: number | null;
  dv_average?: number | null;
  option_count?: number | null;
  subroutine_count?: number | null;
  subroutines?: EncounterSubroutine[];
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
const VALID_THREATS = new Set<ThreatTypeCode>(['mental', 'physical', 'ritual']);

export interface EncounterTalismanCandidate {
  cardInstanceId: string;
  name: string;
  timing: BreakTiming;
  tollCost: number;
  payment: 'charges' | 'action_points';
  usesLeft: number | null;
  threatTypes: ThreatTypeCode[];
  testAttribute?: BreakTestAttribute;
}

export interface TalismanCheckSummary {
  attribute: BreakTestAttribute;
  roll: number;
  total: number;
  dc: number;
  outcome: 'success' | 'fail';
}

export interface TalismanResolveResult extends EncounterResolveResult {
  outcome: 'broken' | 'failed' | 'unavailable';
  timing: BreakTiming | null;
  tollCost: number;
  check?: TalismanCheckSummary;
  reason?: string;
}

export interface ResolveEncounterWithTalismanOptions {
  /** 檢定型法器失敗時,套用此通用解的失敗/無檢定後果。 */
  fallbackOption?: EncounterOption;
  rng?: () => number;
}

interface TalismanEvaluation {
  canUse: boolean;
  reason?: string;
  timing: BreakTiming | null;
  tollCost: number;
  payment: 'charges' | 'action_points' | null;
  usesLeft: number | null;
  threatTypes: ThreatTypeCode[];
  testAttribute?: BreakTestAttribute;
}

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

function listFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
      } catch {
        return [];
      }
    }
    return trimmed.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function normaliseThreatList(value: unknown): ThreatTypeCode[] {
  return listFromUnknown(value)
    .map((s) => s.toLowerCase())
    .filter((s): s is ThreatTypeCode => VALID_THREATS.has(s as ThreatTypeCode));
}

function normaliseBreakTiming(value: unknown): BreakTiming | null {
  const v = String(value ?? '').toLowerCase();
  if (v === 'instant' || v === 'immediate') return 'instant';
  if (v === 'test' || v === 'check') return 'test';
  if (v === 'stockpile' || v === 'stored' || v === 'saving' || v === 'savings' || v === 'reserve') return 'stockpile';
  return null;
}

function normaliseBreakTestAttribute(value: unknown): BreakTestAttribute | null {
  const v = String(value ?? '') as AttributeKey;
  return VALID_ATTRS.has(v) ? (v as BreakTestAttribute) : null;
}

export function encounterThreatTypes(card: EncounterCardData): ThreatTypeCode[] {
  const arr = normaliseThreatList(card.threat_type_array);
  if (arr.length > 0) return arr;
  return normaliseThreatList(card.threat_type);
}

export function encounterThreatStrength(card: EncounterCardData): number {
  const raw = Number(card.threat_strength ?? card.dv_average ?? card.designer_dv ?? 1);
  return Math.max(1, Math.ceil(Number.isFinite(raw) ? raw : 1));
}

export function encounterSubroutineCount(card: EncounterCardData): number {
  const subroutineCount = Array.isArray(card.subroutines) ? card.subroutines.length : 0;
  const raw = subroutineCount || Number(card.subroutine_count ?? card.option_count ?? card.options?.length ?? 1);
  return Math.max(1, Math.ceil(Number.isFinite(raw) ? raw : 1));
}

export function talismanTollCost(talisman: CardData | undefined, encounter: EncounterCardData): number | null {
  const timing = normaliseBreakTiming(talisman?.break_timing);
  if (!timing) return null;
  return TOLL_FUNCTIONS[timing](encounterThreatStrength(encounter), encounterSubroutineCount(encounter));
}

function evaluateTalismanForEncounter(
  cardInstanceId: string,
  talisman: CardData | undefined,
  encounter: EncounterCardData,
  investigator: InvestigatorState,
): TalismanEvaluation {
  if (!talisman?.is_talisman) {
    return { canUse: false, reason: 'not_talisman', timing: null, tollCost: 0, payment: null, usesLeft: null, threatTypes: [] };
  }
  if (!investigator.assetsInPlay.includes(cardInstanceId)) {
    return { canUse: false, reason: 'not_in_play', timing: null, tollCost: 0, payment: null, usesLeft: null, threatTypes: [] };
  }

  const timing = normaliseBreakTiming(talisman.break_timing);
  if (!timing) {
    return { canUse: false, reason: 'missing_break_timing', timing: null, tollCost: 0, payment: null, usesLeft: null, threatTypes: [] };
  }

  const encounterThreats = encounterThreatTypes(encounter);
  if (encounterThreats.length === 0) {
    return { canUse: false, reason: 'encounter_missing_threat_type', timing, tollCost: 0, payment: null, usesLeft: null, threatTypes: [] };
  }
  const targetThreats = normaliseThreatList(talisman.target_threat_types);
  if (targetThreats.length === 0) {
    return { canUse: false, reason: 'missing_target_threat_types', timing, tollCost: 0, payment: null, usesLeft: null, threatTypes: encounterThreats };
  }
  const matchesThreat = encounterThreats.some((t) => targetThreats.includes(t));
  if (!matchesThreat) {
    return { canUse: false, reason: 'threat_type_mismatch', timing, tollCost: 0, payment: null, usesLeft: null, threatTypes: encounterThreats };
  }

  const strength = encounterThreatStrength(encounter);
  const strengthMax = talisman.break_strength_max == null ? null : Number(talisman.break_strength_max);
  if (strengthMax != null && Number.isFinite(strengthMax) && strength > strengthMax) {
    return { canUse: false, reason: 'strength_too_high', timing, tollCost: 0, payment: null, usesLeft: null, threatTypes: encounterThreats };
  }

  const tollCost = TOLL_FUNCTIONS[timing](strength, encounterSubroutineCount(encounter));
  const maxUses = cardMaxUses(talisman);
  const state = investigator.assetState?.[cardInstanceId];
  const usesLeft = state?.usesLeft ?? maxUses;
  if (usesLeft != null) {
    return {
      canUse: Number(usesLeft) >= tollCost,
      reason: Number(usesLeft) >= tollCost ? undefined : 'insufficient_charges',
      timing,
      tollCost,
      payment: 'charges',
      usesLeft: Number(usesLeft),
      threatTypes: encounterThreats,
      testAttribute: normaliseBreakTestAttribute(talisman.break_test_attribute) ?? undefined,
    };
  }

  if (timing === 'test') {
    const testAttribute = normaliseBreakTestAttribute(talisman.break_test_attribute);
    if (!testAttribute) {
      return { canUse: false, reason: 'missing_test_attribute', timing, tollCost, payment: null, usesLeft: null, threatTypes: encounterThreats };
    }
    return {
      canUse: investigator.actionPoints >= tollCost,
      reason: investigator.actionPoints >= tollCost ? undefined : 'insufficient_action_points',
      timing,
      tollCost,
      payment: 'action_points',
      usesLeft: null,
      threatTypes: encounterThreats,
      testAttribute,
    };
  }

  return { canUse: false, reason: 'missing_charge_pool', timing, tollCost, payment: null, usesLeft: null, threatTypes: encounterThreats };
}

export function availableTalismansForEncounter(
  investigator: InvestigatorState,
  cardLookup: CardDataLookup,
  encounter: EncounterCardData,
): EncounterTalismanCandidate[] {
  const candidates: EncounterTalismanCandidate[] = [];
  for (const cardInstanceId of investigator.assetsInPlay) {
    const data = cardLookup[cardInstanceId];
    const ev = evaluateTalismanForEncounter(cardInstanceId, data, encounter, investigator);
    if (!ev.canUse || !ev.timing || !ev.payment) continue;
    candidates.push({
      cardInstanceId,
      name: data?.name_zh ?? cardInstanceId,
      timing: ev.timing,
      tollCost: ev.tollCost,
      payment: ev.payment,
      usesLeft: ev.usesLeft,
      threatTypes: ev.threatTypes,
      testAttribute: ev.testAttribute,
    });
  }
  return candidates;
}

function spendTalismanToll(
  investigator: InvestigatorState,
  cardInstanceId: string,
  talisman: CardData,
  ev: TalismanEvaluation,
): { investigator: InvestigatorState; effects: ResultEffect[] } {
  if (ev.payment === 'charges') {
    const state = investigator.assetState?.[cardInstanceId] ?? { usesLeft: cardMaxUses(talisman), exhausted: false };
    const left = Math.max(0, Number(state.usesLeft ?? 0) - ev.tollCost);
    return {
      investigator: {
        ...investigator,
        assetState: {
          ...(investigator.assetState ?? {}),
          [cardInstanceId]: { ...state, usesLeft: left },
        },
      },
      effects: [{
        type: 'talisman_toll_paid',
        params: {
          cardInstanceId,
          name: talisman.name_zh ?? '',
          cost: ev.tollCost,
          resource: talisman.break_charge_label ?? '充能',
          left,
        },
      }],
    };
  }

  if (ev.payment === 'action_points') {
    return {
      investigator: { ...investigator, actionPoints: Math.max(0, investigator.actionPoints - ev.tollCost) },
      effects: [{
        type: 'talisman_toll_paid',
        params: { cardInstanceId, name: talisman.name_zh ?? '', cost: ev.tollCost, resource: '行動點', left: Math.max(0, investigator.actionPoints - ev.tollCost) },
      }],
    };
  }

  return { investigator, effects: [] };
}

function applyTalismanFailureFallback(
  option: EncounterOption | undefined,
  investigator: InvestigatorState,
  scenario: ScenarioState,
  enemyData: EnemyDataLookup,
): EncounterResolveResult {
  if (!option) return { investigator, scenario, effects: [] };
  const effects: ResultEffect[] = [];
  const narrative = option.requires_check ? option.failure_narrative_zh : option.no_check_narrative_zh;
  if (narrative) effects.push({ type: 'encounter_narrative', params: { narrative } });
  const applied = applyEncounterEffects(option.requires_check ? option.failure_effects : option.no_check_effects, investigator, scenario, enemyData);
  return { investigator: applied.investigator, scenario: applied.scenario, effects: [...effects, ...applied.effects] };
}

function talismanCheckSummary(attr: BreakTestAttribute, check: CheckResult): TalismanCheckSummary {
  return {
    attribute: attr,
    roll: check.roll,
    total: check.total,
    dc: check.dc,
    outcome: check.outcome,
  };
}

export function resolveEncounterWithTalisman(
  cardInstanceId: string,
  talisman: CardData | undefined,
  encounter: EncounterCardData,
  investigator: InvestigatorState,
  scenario: ScenarioState,
  enemyData: EnemyDataLookup,
  options: ResolveEncounterWithTalismanOptions = {},
): TalismanResolveResult {
  const ev = evaluateTalismanForEncounter(cardInstanceId, talisman, encounter, investigator);
  if (!ev.canUse || !ev.timing || !talisman) {
    return {
      investigator,
      scenario,
      effects: [{
        type: 'talisman_unavailable',
        params: { cardInstanceId, name: talisman?.name_zh ?? cardInstanceId, reason: ev.reason ?? 'unavailable' },
      }],
      outcome: 'unavailable',
      timing: ev.timing,
      tollCost: ev.tollCost,
      reason: ev.reason,
    };
  }

  const paid = spendTalismanToll(investigator, cardInstanceId, talisman, ev);
  let inv = paid.investigator;
  let sc = scenario;
  const effects: ResultEffect[] = [...paid.effects];
  let checkSummary: TalismanCheckSummary | undefined;

  if (ev.timing === 'test') {
    const attr = ev.testAttribute;
    if (!attr) {
      return {
        investigator,
        scenario,
        effects: [{ type: 'talisman_unavailable', params: { cardInstanceId, name: talisman.name_zh ?? cardInstanceId, reason: 'missing_test_attribute' } }],
        outcome: 'unavailable',
        timing: ev.timing,
        tollCost: ev.tollCost,
        reason: 'missing_test_attribute',
      };
    }
    const cs = applyCheckStatus(inv.statusEffects);
    const check = resolveCheck(encounterThreatStrength(encounter), { attribute: inv.attributes[attr] ?? 0 }, options.rng ?? Math.random, cs.rollMode);
    inv = { ...inv, statusEffects: cs.statusEffects };
    checkSummary = talismanCheckSummary(attr, check);
    effects.push({
      type: 'talisman_check',
      params: {
        cardInstanceId,
        name: talisman.name_zh ?? '',
        attribute: attr,
        roll: check.roll,
        total: check.total,
        dc: check.dc,
        outcome: check.outcome,
      },
    });
    if (check.outcome !== 'success') {
      effects.push({
        type: 'talisman_break_failed',
        params: { cardInstanceId, name: talisman.name_zh ?? '', timing: ev.timing, encounter: encounter.name_zh },
      });
      const fallback = applyTalismanFailureFallback(options.fallbackOption, inv, sc, enemyData);
      return {
        investigator: fallback.investigator,
        scenario: fallback.scenario,
        effects: [...effects, ...fallback.effects],
        outcome: 'failed',
        timing: ev.timing,
        tollCost: ev.tollCost,
        check: checkSummary,
      };
    }
  }

  effects.push({
    type: 'talisman_break_success',
    params: {
      cardInstanceId,
      name: talisman.name_zh ?? '',
      timing: ev.timing,
      encounter: encounter.name_zh,
      threatStrength: encounterThreatStrength(encounter),
      subroutines: encounterSubroutineCount(encounter),
    },
  });

  return {
    investigator: inv,
    scenario: sc,
    effects,
    outcome: 'broken',
    timing: ev.timing,
    tollCost: ev.tollCost,
    check: checkSummary,
  };
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
