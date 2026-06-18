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
/**
 * 幕線索門檻(原文「花費 N 線索」):需求隨人數縮放(ch1 技術原則 4「人數縮放內建」)。
 * 回傳 null = 此條件不是線索門檻型。
 */
export function clueRequirementFor(
  condition: Record<string, unknown> | null | undefined,
  playerCount: number,
): number | null {
  if (!condition || typeof condition !== 'object') return null;
  const t = String(condition.type ?? '');
  // 花費線索型:clue_threshold + §14 封印次元門(都「花掉」線索)
  if (t !== 'clue_threshold' && t !== 'seal_gate') return null;
  return Number(condition.count ?? Infinity) * Math.max(1, playerCount);
}

/**
 * §14.1 五大任務類型(+ 既有 clue_threshold/enemy_defeated)的幕推進/過關條件求值。
 * escape 需要 investigators(全員到位);endurance 看回合數;defeat_titan 看巨頭擊殺。
 */
function actConditionMet(
  condition: Record<string, unknown> | null | undefined,
  scenario: ScenarioState,
  playerCount: number,
  flags: CampaignFlags,
  enemyData: EnemyDataLookup,
  investigators?: Record<string, InvestigatorState>,
): boolean {
  if (!condition || typeof condition !== 'object') return false;
  const scaled = (n: unknown) => Number(n ?? Infinity) * Math.max(1, playerCount);
  switch (String(condition.type ?? '')) {
    case 'clue_threshold':
      return scenario.objectiveProgress >= (clueRequirementFor(condition, playerCount) ?? Infinity);
    case 'enemy_defeated': {
      const code = String(condition.variant_code ?? '');
      return scenario.enemies.some((e) => e.enemyDefinitionId === code && e.hp <= 0);
    }
    // ── §14.1 五大任務類型 ──
    case 'seal_gate': {
      // 封印次元門:花費線索(人數縮放)+ 通過檢定(以旗標表示,選填)
      const sealed = !condition.required_flag || flags[String(condition.required_flag)] === true;
      return sealed && scenario.objectiveProgress >= scaled(condition.count);
    }
    case 'defeat_titan': {
      // 擊敗巨頭:指定 variant_code,或任一巨頭(tier ≥ 5)HP 歸 0
      const code = condition.variant_code ? String(condition.variant_code) : null;
      return scenario.enemies.some((e) => e.hp <= 0 && (code ? e.enemyDefinitionId === code : Number(enemyData[e.enemyDefinitionId]?.tier ?? 0) >= 5));
    }
    case 'uncover_truth': {
      // 發覺真相:找到隱藏線索(旗標)或累積指定線索
      const flagFound = condition.truth_flag ? flags[String(condition.truth_flag)] === true : false;
      return flagFound || scenario.objectiveProgress >= scaled(condition.count);
    }
    case 'escape': {
      // 逃脫:所有存活調查員到達指定地點
      const loc = String(condition.location_code ?? '');
      const alive = Object.values(investigators ?? {}).filter((i) => !i.permanentlyDead && !i.dead);
      return alive.length > 0 && alive.every((i) => i.currentLocationId === loc);
    }
    case 'endurance':
      // 撐到時間到:存活指定回合
      return scenario.turnNumber >= Number(condition.turns ?? condition.count ?? Infinity);
    default:
      return false; // 未知條件型別:不自動推進(保守)
  }
}

// 回血量:資料 amount_rule='per_other_enemy' → 場上每隻「非目標」活怪回 1(裂嘴女靠潮水中同類補充);否則用固定 amount。
function regenAmount(pen: Record<string, unknown>, sc: ScenarioState, code: string): number {
  if (String(pen.amount_rule ?? '') === 'per_other_enemy') {
    return sc.enemies.filter((e) => e.hp > 0 && e.enemyDefinitionId !== code).length;
  }
  return Number(pen.amount ?? 1);
}

// 議程「潮汐」翻面一次性結算:boss 在場 → 瞬間回 N HP(封頂 spawn 最大 HP)。
// 規則書 ch2 §2.3:毀滅達門檻「翻面結算背面效果」= 翻面當下一次性,非每回合。
function healEnemyOnce(
  sc: ScenarioState,
  code: string,
  amount: number,
  enemyData: EnemyDataLookup,
  playerCount: number,
  effects: ResultEffect[],
): ScenarioState {
  const data = enemyData[code] ?? {};
  const maxHp = Number(data.hp_base ?? 0) + Number(data.hp_per_player ?? 0) * (playerCount - 1);
  let healed = 0;
  const enemies = sc.enemies.map((e) => {
    if (e.enemyDefinitionId !== code || e.hp <= 0) return e;
    const cap = maxHp > 0 ? maxHp : e.hp + amount;
    const nh = Math.min(cap, e.hp + amount);
    if (nh > e.hp) healed = nh - e.hp;
    return { ...e, hp: nh };
  });
  effects.push({ type: 'penalty_applied', params: { penalty: 'enemy_regen', narrative: healed > 0 ? '深海的潮汐裡,牠的傷口瞬間癒合(HP +' + healed + ')。' : '牠的傷口開始癒合。' } });
  return { ...sc, enemies };
}

// ─── 主入口:每次狀態變化後呼叫 ─────────────────
export function progressTick(
  scenario: ScenarioState,
  flags: CampaignFlags,
  actCards: ActCardData[],
  agendaCards: AgendaCardData[],
  enemyData: EnemyDataLookup,
  playerCount = 1,
  investigators?: Record<string, InvestigatorState>,
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
  while (actIdx < acts.length && actConditionMet(acts[actIdx].front_advance_condition, sc, playerCount, fl, enemyData, investigators)) {
    const act = acts[actIdx];
    // 線索消費(ch5 §2.3 推進條件「花費線索」):達標翻面時扣除需求量,線索是花掉不是累積
    const spent = clueRequirementFor(act.front_advance_condition, playerCount);
    if (spent != null && spent > 0) {
      sc = { ...sc, objectiveProgress: Math.max(0, sc.objectiveProgress - spent) };
      effects.push({ type: 'clues_spent', params: { amount: spent } });
    }
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
      if (type === 'heavy_rain') {
        // 滂沱暴雨:翻面後全域移動成本 +N(持續效果,移動結算讀 scenario.globalMoveCostBonus)
        const add = Number(pen.amount ?? 1);
        sc = { ...sc, globalMoveCostBonus: (sc.globalMoveCostBonus ?? 0) + add };
        effects.push({ type: 'penalty_applied', params: { penalty: type, narrative: '暴雨封路,移動更加艱難(移動成本 +' + add + ')。' } });
      } else if (type === 'enemy_regen') {
        // 規則書:翻面一次性結算 → boss 瞬間回血(量見 regenAmount;潮汐 = 場上非目標活怪數)
        const code = String(pen.variant_code ?? '');
        sc = healEnemyOnce(sc, code, regenAmount(pen, sc, code), enemyData, playerCount, effects);
      } else if (type === 'enemy_regen_or_spawn') {
        // AGENDA2 但書(Uria):怪在場 → 回血;不在場 → 生成在指定地點(裂嘴女不在場補位)
        const code = String(pen.variant_code ?? '');
        const present = sc.enemies.some((e) => e.enemyDefinitionId === code && e.hp > 0);
        if (present) {
          // 規則書:翻面一次性結算 → boss 瞬間回血(潮汐 = 場上非目標活怪數)
          sc = healEnemyOnce(sc, code, regenAmount(pen, sc, code), enemyData, playerCount, effects);
        } else {
          const loc = String(pen.location_code ?? sc.locations[sc.locations.length - 1]?.locationDefinitionId ?? '');
          if (code && loc) {
            const spawned = spawnEnemy(sc, code, loc, enemyData, playerCount);
            sc = spawned.scenario;
            effects.push({ type: 'enemy_spawned', params: { enemy: enemyData[code]?.name_zh ?? code, code, location: loc }, targetId: spawned.enemy.instanceId });
          }
        }
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
