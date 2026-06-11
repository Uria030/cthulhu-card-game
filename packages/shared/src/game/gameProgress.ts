/**
 * G-02 引擎核心 — 幕/議程推進與結局判定(§1.5 + MOD-06/07 資料驅動)
 *
 * - 幕(act):front_advance_condition 達成 → 翻面:back_narrative 演出、
 *   back_flag_sets 寫旗標、back_map_operations 執行(switch_scenario 上拋訊號/
 *   spawn_enemy 引擎生成)、back_resolution_code='stage_complete' → 勝利訊號
 * - 議程(agenda):毀滅標記 ≥ front_doom_threshold → 翻面:back_penalties 結算、
 *   毀滅歸零進下一張;back_resolution_code='investigators_defeated' → 失敗訊號
 * - 結局(chapter_outcomes):condition_expression {type:'flag_check',flag_code,expected}
 *   依旗標求值,依 outcome_code 序取第一個命中
 *
 * 毀滅標記來源:神話卡/城主行動(階段三);臨時城主每神話階段 +1(client 占位)。
 */
import type { ResultEffect } from './messages';
import type { ScenarioState, InvestigatorState } from './state';
import { spawnEnemy } from './monsterActions';
import type { EnemyDataLookup } from './monsterActions';

export interface ActCardData {
  card_order: number;
  name_zh: string;
  front_narrative?: string;
  front_advance_condition?: Record<string, unknown> | null;
  back_narrative?: string;
  back_flag_sets?: Array<{ flag_code: string; value: unknown }>;
  back_map_operations?: Array<{ verb?: string; type?: string; params?: Record<string, unknown> }>;
  back_resolution_code?: string | null;
}

export interface AgendaCardData {
  card_order: number;
  name_zh: string;
  front_narrative?: string;
  front_doom_threshold: number;
  back_narrative?: string;
  back_flag_sets?: Array<{ flag_code: string; value: unknown }>;
  back_penalties?: Array<Record<string, unknown>>;
  back_resolution_code?: string | null;
}

export interface OutcomeData {
  outcome_code: string;
  condition_expression?: Record<string, unknown> | null;
  narrative_text?: string;
  flag_sets?: Array<{ flag_code: string; value: unknown }>;
}

export type CampaignFlags = Record<string, unknown>;

export interface ProgressResult {
  scenario: ScenarioState;
  flags: CampaignFlags;
  effects: ResultEffect[];
  /** 幕翻面要求切換場景(scenario_order) */
  switchScenario: number | null;
  /** 勝利/失敗訊號(結局由 evaluateOutcome 決定文本) */
  victory: boolean;
  defeat: boolean;
}

// ─── 毀滅標記 ───────────────────────────────
export function addDoom(scenario: ScenarioState, amount: number): { scenario: ScenarioState; effects: ResultEffect[] } {
  return {
    scenario: { ...scenario, agendaProgress: scenario.agendaProgress + amount },
    effects: [{ type: 'doom_added', params: { amount, total: scenario.agendaProgress + amount } }],
  };
}

// ─── 幕推進條件求值 ───────────────────────────
function actConditionMet(
  condition: Record<string, unknown> | null | undefined,
  scenario: ScenarioState,
): boolean {
  if (!condition || typeof condition !== 'object') return false;
  switch (String(condition.type ?? '')) {
    case 'clue_threshold':
      return scenario.objectiveProgress >= Number(condition.count ?? Infinity);
    case 'enemy_defeated': {
      const code = String(condition.variant_code ?? '');
      return scenario.enemies.some((e) => e.enemyDefinitionId === code && e.hp <= 0);
    }
    default:
      return false; // 未知條件型別:不自動推進(保守)
  }
}

// ─── 主入口:每次狀態變化後呼叫 ─────────────────
export function progressTick(
  scenario: ScenarioState,
  flags: CampaignFlags,
  actCards: ActCardData[],
  agendaCards: AgendaCardData[],
  enemyData: EnemyDataLookup,
  playerCount = 1,
): ProgressResult {
  let sc = scenario;
  let fl = { ...flags };
  const effects: ResultEffect[] = [];
  let switchScenario: number | null = null;
  let victory = false;
  let defeat = false;

  // ── 幕推進(可連鎖,但常態一次一張)──
  const acts = [...actCards].sort((a, b) => a.card_order - b.card_order);
  let actIdx = sc.actIndex ?? 0;
  while (actIdx < acts.length && actConditionMet(acts[actIdx].front_advance_condition, sc)) {
    const act = acts[actIdx];
    effects.push({
      type: 'act_advanced',
      params: { name: act.name_zh, narrative: act.back_narrative ?? '' },
    });
    for (const set of act.back_flag_sets ?? []) {
      if (set?.flag_code) {
        fl[set.flag_code] = set.value;
        effects.push({ type: 'flag_set', params: { flag_code: set.flag_code, value: set.value } });
      }
    }
    for (const op of act.back_map_operations ?? []) {
      const verb = String(op.verb ?? op.type ?? '');
      const params = op.params ?? {};
      if (verb === 'switch_scenario') {
        switchScenario = Number(params.scenario_order ?? 2);
      } else if (verb === 'spawn_enemy') {
        const code = String(params.variant_code ?? '');
        const loc = String(params.location_code ?? '');
        if (code && loc) {
          const spawned = spawnEnemy(sc, code, loc, enemyData, playerCount);
          sc = spawned.scenario;
          effects.push({
            type: 'enemy_spawned',
            params: {
              enemy: enemyData[code]?.name_zh ?? code,
              code,
              location: loc,
            },
            targetId: spawned.enemy.instanceId,
          });
        }
      }
    }
    if (act.back_resolution_code === 'stage_complete') victory = true;
    actIdx += 1;
  }
  if (actIdx !== (sc.actIndex ?? 0)) {
    sc = { ...sc, actIndex: actIdx };
  }

  // ── 議程推進(毀滅 ≥ 門檻 → 翻面,毀滅扣除門檻進下一張)──
  const agendas = [...agendaCards].sort((a, b) => a.card_order - b.card_order);
  let agendaIdx = sc.agendaIndex ?? 0;
  let doom = sc.agendaProgress;
  while (agendaIdx < agendas.length && doom >= Number(agendas[agendaIdx].front_doom_threshold ?? Infinity)) {
    const agenda = agendas[agendaIdx];
    doom -= Number(agenda.front_doom_threshold);
    effects.push({
      type: 'agenda_advanced',
      params: { name: agenda.name_zh, narrative: agenda.back_narrative ?? '' },
    });
    for (const set of agenda.back_flag_sets ?? []) {
      if (set?.flag_code) {
        fl[set.flag_code] = set.value;
        effects.push({ type: 'flag_set', params: { flag_code: set.flag_code, value: set.value } });
      }
    }
    for (const pen of agenda.back_penalties ?? []) {
      const type = String(pen.type ?? '');
      if (type === 'enemy_regen') {
        const code = String(pen.variant_code ?? '');
        sc = {
          ...sc,
          enemies: sc.enemies.map((e) =>
            e.enemyDefinitionId === code ? { ...e, modifiers: [...e.modifiers, 'regen_boost'] } : e,
          ),
        };
        effects.push({ type: 'penalty_applied', params: { penalty: type, narrative: '牠的傷口開始癒合。' } });
      } else if (type === 'investigators_defeated') {
        defeat = true;
      } else {
        effects.push({ type: 'penalty_applied', params: { penalty: type, narrative: String(pen._note ?? '') } });
      }
    }
    if (agenda.back_resolution_code === 'investigators_defeated') defeat = true;
    agendaIdx += 1;
  }
  if (agendaIdx !== (sc.agendaIndex ?? 0) || doom !== sc.agendaProgress) {
    sc = { ...sc, agendaIndex: agendaIdx, agendaProgress: doom };
  }

  return { scenario: sc, flags: fl, effects, switchScenario, victory, defeat };
}

// ─── 結局判定 ───────────────────────────────
export function evaluateOutcome(
  outcomes: OutcomeData[],
  flags: CampaignFlags,
): OutcomeData | null {
  const sorted = [...outcomes].sort((a, b) => a.outcome_code.localeCompare(b.outcome_code));
  for (const o of sorted) {
    const cond = o.condition_expression;
    if (!cond || typeof cond !== 'object') continue;
    if (String(cond.type ?? '') !== 'flag_check') continue;
    const actual = flags[String(cond.flag_code ?? '')] === true;
    const expected = cond.expected === true;
    if (actual === expected) return o;
  }
  return null;
}

/** 結局 flag_sets 寫回戰役旗標(結算時呼叫) */
export function applyOutcomeFlags(outcome: OutcomeData, flags: CampaignFlags): CampaignFlags {
  const fl = { ...flags };
  for (const set of outcome.flag_sets ?? []) {
    if (set?.flag_code) fl[set.flag_code] = set.value;
  }
  return fl;
}

/** 調查員全滅檢查(HP 與 SAN 雙歸零視為倒下;§9 瀕死系統接通前的簡化) */
export function allInvestigatorsDown(investigators: Record<string, InvestigatorState>): boolean {
  const list = Object.values(investigators).filter((i) => !i.permanentlyDead);
  if (list.length === 0) return true;
  return list.every((i) => i.hp <= 0 || i.san <= 0);
}
