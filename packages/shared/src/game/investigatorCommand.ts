/**
 * G-04 引擎核心 — 調查員 AI 指揮層(P1:第 1–3 層,純計算 + 軌跡)
 *
 * 依《調查員AI修改企畫書_v0_1_26070202》:
 * - 第 1 層 勝利條件解析:ACT 鏈 → 有序子目標鏈(五大任務類型通用分解)
 * - 第 2 層 時間預算:毀滅空間 ÷ 城主實際推進速率 → 全隊剩餘行動點預算
 * - 第 3 層 需求估算:每個子目標換算成期望行動點 + 緊急分值 U(連續值)
 *
 * P1 約束:本模組**只產出數字與軌跡,不接管 AI 行為**——第 4/5 層(指派/執行約束)
 * 在 P2/P3 才接上。輸入完全不含調查員個性(weights/temperature),只吃關卡客觀
 * 資料與隊伍客觀能力(企畫書原則二)。
 *
 * 引擎對齊(2026-07-02 原始碼查證,非快照推測):
 * - enemy_defeated 認「場上有無該代碼屍體」(gameProgress.actConditionMet),且幕推進
 *   同 tick 可連鎖 → 提前登場的目標被殺掉是算數的(屍體留著,後續幕翻面即刻判定)。
 * - 議程翻面毀滅「扣門檻進下一張」→ 判負空間 = 剩餘各張門檻總和 − 當前累積。
 */
import type { ScenarioState, InvestigatorState } from './state';
import type { AttributeKey } from './checks';
import type { CardDataLookup, StyleCardData } from './ruleEngine';
import type { EnemyDataLookup } from './monsterActions';
import type { ActCardData, AgendaCardData } from './gameProgress';
import type { AIObjective } from './investigatorAI';
import { deriveObjective, estimateSuccessChance, weaponExpectedModifier } from './investigatorAI';
import { locationDistance } from './monsterBehavior';
import { isStanding } from './dying';

// ─── 常數(企畫書 §2 第 3 層;告急/不可行為 U 的顯示分檔,U 本身是連續值)──
export const ACTIONS_PER_TURN = 3;          // 規則書 ch2 §2.2
export const POSTURE_URGENT_AT = 0.7;       // U ≥ 0.7 → 告急(留 30% 餘裕即該收斂)
export const POSTURE_INFEASIBLE_AT = 1.0;   // U > 1 → 數學上不可行(Part 8 裁定項 B 待定)

// ─── 第 1 層:勝利條件解析 ─────────────────────────
export interface VictorySubgoal {
  /** ACT 順位(card_order) */
  actOrder: number;
  actName: string;
  /** 正規化子目標(沿用 deriveObjective 的五類型分解) */
  objective: AIObjective;
  /** 原始推進條件(需求換算取細節用) */
  condition: Record<string, unknown> | null;
  /** done = 幕已翻面或條件已成立(含屍體規則);current = 當前幕;pending = 後續幕 */
  status: 'done' | 'current' | 'pending';
}

/** 把「贏」表達成有序子目標鏈:每張 ACT 一個子目標,已翻面的標 done。 */
export function deriveVictoryChain(
  actCards: ActCardData[],
  scenario: ScenarioState,
  playerCount: number,
  enemyData: EnemyDataLookup,
): VictorySubgoal[] {
  const acts = [...actCards].sort((a, b) => a.card_order - b.card_order);
  const actIdx = scenario.actIndex ?? 0;
  return acts.map((act, i) => {
    const cond = (act.front_advance_condition ?? null) as Record<string, unknown> | null;
    const objective = deriveObjective(cond, playerCount, enemyData);
    let status: VictorySubgoal['status'] = i < actIdx ? 'done' : i === actIdx ? 'current' : 'pending';
    // 屍體規則(引擎查證):kill 型目標若場上已有該代碼屍體 → 條件已成立,視同 done
    if (status !== 'done' && objective.kind === 'kill' && (objective.enemyCodes ?? []).length > 0) {
      const allDead = (objective.enemyCodes ?? []).every((code) =>
        scenario.enemies.some((e) => e.enemyDefinitionId === code && e.hp <= 0),
      );
      if (allDead) status = 'done';
    }
    return { actOrder: act.card_order, actName: act.name_zh, objective, condition: cond, status };
  });
}

// ─── 第 2 層:時間預算 ────────────────────────────
export interface TimeBudget {
  /** 距離判負還能吃的毀滅量(剩餘各張議程門檻總和 − 當前累積) */
  doomCapacityLeft: number;
  /** 城主實際推進速率(觀測值;無觀測資料時 null → 預算無上限) */
  doomRatePerTurn: number | null;
  /** 依速率換算的剩餘回合數(速率未知 → Infinity) */
  turnsLeft: number;
  /** 還能行動的調查員數(isStanding) */
  aliveCount: number;
  /** 全隊剩餘行動點預算 = turnsLeft × 3 × aliveCount */
  actionPointBudget: number;
}

/** 開局至今的累積毀滅總量(含已翻面議程吃掉的門檻)— 給呼叫端算觀測速率用 */
export function cumulativeDoom(scenario: ScenarioState, agendaCards: AgendaCardData[]): number {
  const agendas = [...agendaCards].sort((a, b) => a.card_order - b.card_order);
  const idx = scenario.agendaIndex ?? 0;
  let flipped = 0;
  for (let i = 0; i < idx && i < agendas.length; i += 1) flipped += Number(agendas[i].front_doom_threshold ?? 0);
  return flipped + scenario.agendaProgress;
}

export function computeTimeBudget(
  scenario: ScenarioState,
  agendaCards: AgendaCardData[],
  investigators: Record<string, InvestigatorState>,
  observedDoomRate?: number | null,
): TimeBudget {
  const agendas = [...agendaCards].sort((a, b) => a.card_order - b.card_order);
  const idx = scenario.agendaIndex ?? 0;
  let capacity = -scenario.agendaProgress;
  for (let i = idx; i < agendas.length; i += 1) capacity += Number(agendas[i].front_doom_threshold ?? 0);
  const doomCapacityLeft = Math.max(0, capacity);
  const rate = observedDoomRate != null && observedDoomRate > 0 ? observedDoomRate : null;
  const turnsLeft = rate == null ? Infinity : doomCapacityLeft / rate;
  const aliveCount = Object.values(investigators).filter((i) => !i.permanentlyDead && isStanding(i)).length;
  return {
    doomCapacityLeft,
    doomRatePerTurn: rate,
    turnsLeft,
    aliveCount,
    actionPointBudget: turnsLeft === Infinity ? Infinity : turnsLeft * ACTIONS_PER_TURN * aliveCount,
  };
}

// ─── 第 3 層:需求估算與緊急分值 ─────────────────────
export interface SubgoalDemand {
  subgoal: VictorySubgoal;
  /** 期望行動點需求(done → 0;無法換算 → Infinity 並在 detail 說明) */
  apNeeded: number;
  /** 換算依據(人讀的對帳字串:成功率/期望傷害/剩餘量) */
  detail: string;
}

export interface CommandContext {
  scenario: ScenarioState;
  /** 全隊(含玩家席;鍵 = investigatorId) */
  investigators: Record<string, InvestigatorState>;
  actCards: ActCardData[];
  agendaCards: AgendaCardData[];
  enemyData: EnemyDataLookup;
  locationStats: Record<string, { shroud?: number }>;
  cardLookup: CardDataLookup;
  stylePools: Record<string, StyleCardData[]>;
  playerCount: number;
  /** 城主毀滅觀測速率(呼叫端用 cumulativeDoom 歷史差分算;開局未知傳 null) */
  observedDoomRate?: number | null;
}

export interface CommandTrace {
  turnNumber: number;
  chain: VictorySubgoal[];
  budget: TimeBudget;
  demands: SubgoalDemand[];
  /** 未完成子目標的行動點需求總和 */
  totalApNeeded: number;
  /** 緊急分值 U = 總需求 ÷ 預算(連續值;預算無上限 → 0) */
  urgency: number;
  posture: 'calm' | 'urgent' | 'infeasible';
}

/** 隊上最佳調查成功率(最高感知 vs 場上最好查的地點 shroud)。 */
function bestInvestigateChance(
  standing: InvestigatorState[],
  scenario: ScenarioState,
  locationStats: Record<string, { shroud?: number }>,
): { p: number; shroud: number; perception: number } {
  let shroud = Infinity;
  for (const loc of scenario.locations) {
    const s = locationStats[loc.locationDefinitionId]?.shroud;
    if (s != null && s < shroud) shroud = s;
  }
  if (shroud === Infinity) shroud = 10;
  let perception = 0;
  for (const inv of standing) perception = Math.max(perception, inv.attributes.perception ?? 0);
  return { p: estimateSuccessChance(perception, shroud), shroud, perception };
}

/** 單一調查員對指定 DC 的最佳「每行動點期望傷害」(武器含手上未鋪的;徒手墊底)。 */
function bestDamagePerAction(
  inv: InvestigatorState,
  dc: number,
  cardLookup: CardDataLookup,
  stylePools: Record<string, StyleCardData[]>,
): number {
  let best = estimateSuccessChance(inv.attributes.strength ?? 0, dc) * 1; // 徒手:傷害 1
  for (const id of [...inv.assetsInPlay, ...inv.hand]) {
    const data = cardLookup[id];
    const hasAttack = (data?.effects ?? []).some((f) => f.trigger_type === 'action' && f.effect_code === 'attack');
    if (!hasAttack) continue;
    const usesLeft = inv.assetState?.[id]?.usesLeft;
    if (usesLeft != null && usesLeft <= 0) continue;
    const expect = weaponExpectedModifier(inv, id, cardLookup, stylePools);
    if (!expect) continue;
    best = Math.max(best, estimateSuccessChance(expect.modifier, dc) * expect.damage);
  }
  return best;
}

/** 把一個子目標換算成期望行動點需求(企畫書 §2 第 3 層換算式)。 */
export function estimateSubgoalDemand(subgoal: VictorySubgoal, ctx: CommandContext): SubgoalDemand {
  const { scenario, locationStats, enemyData, cardLookup, stylePools } = ctx;
  if (subgoal.status === 'done') return { subgoal, apNeeded: 0, detail: '已達成' };
  const standing = Object.values(ctx.investigators).filter((i) => !i.permanentlyDead && isStanding(i));
  const obj = subgoal.objective;

  switch (obj.kind) {
    case 'clues': {
      const target = obj.clueTarget ?? 0;
      // 當前幕:扣已累積進度;後續幕:線索翻面時花掉 → 需求全額
      const remaining = subgoal.status === 'current'
        ? Math.max(0, target - scenario.objectiveProgress)
        : target;
      if (remaining <= 0) return { subgoal, apNeeded: 0, detail: '線索已達標' };
      const { p, shroud, perception } = bestInvestigateChance(standing, scenario, locationStats);
      const ap = p > 0 ? remaining / p : Infinity;
      return { subgoal, apNeeded: ap, detail: `缺${remaining}線索÷成功率${(p * 100).toFixed(0)}%(感知${perception} vs shroud${shroud})` };
    }
    case 'kill': {
      const codes = obj.enemyCodes ?? [];
      if (codes.length === 0) return { subgoal, apNeeded: Infinity, detail: 'kill 型但無目標代碼(資料洞)' };
      let totalAp = 0;
      const parts: string[] = [];
      for (const code of codes) {
        const alive = scenario.enemies.filter((e) => e.enemyDefinitionId === code && e.hp > 0);
        const data = enemyData[code] ?? {};
        // 尚未生成 → 用資料面滿血估(hp_base + hp_per_player×(人數-1))
        const hpLeft = alive.length > 0
          ? alive.reduce((s, e) => s + e.hp, 0)
          : Number(data.hp_base ?? 0) + Number(data.hp_per_player ?? 0) * (ctx.playerCount - 1);
        if (hpLeft <= 0) { parts.push(`${code}:已倒`); continue; }
        const dc = Number(data.dc ?? 10);
        let dmgPerAp = 0;
        for (const inv of standing) dmgPerAp = Math.max(dmgPerAp, bestDamagePerAction(inv, dc, cardLookup, stylePools));
        const ap = dmgPerAp > 0 ? hpLeft / dmgPerAp : Infinity;
        totalAp += ap;
        parts.push(`${String(data.name_zh ?? code)}HP${hpLeft}÷期望傷害${dmgPerAp.toFixed(2)}/AP(DC${dc})`);
      }
      return { subgoal, apNeeded: totalAp, detail: parts.join(';') };
    }
    case 'escape': {
      const loc = obj.locationCode ?? '';
      const stepCost = 1 + (scenario.globalMoveCostBonus ?? 0);
      let steps = 0;
      for (const inv of standing) {
        if (!inv.currentLocationId || inv.currentLocationId === loc) continue;
        const d = locationDistance(scenario.locations, inv.currentLocationId, loc);
        if (d === Infinity) return { subgoal, apNeeded: Infinity, detail: `逃脫點 ${loc} 不可達` };
        steps += d;
      }
      return { subgoal, apNeeded: steps * stepCost, detail: `全員步數${steps}×移動成本${stepCost}` };
    }
    case 'survive':
      // 撐回合型:不花行動點推進,靠預算面(活著等)— 存活壓力在 P2 指派層處理
      return { subgoal, apNeeded: 0, detail: '撐時間型(無主動需求)' };
    default:
      return { subgoal, apNeeded: 0, detail: '無幕資料(教學/無 ACT)' };
  }
}

/** 指揮層主入口:每 tick 呼叫,回傳第 1–3 層完整軌跡(P1 只記錄,不接管行為)。 */
export function commandTick(ctx: CommandContext): CommandTrace {
  const chain = deriveVictoryChain(ctx.actCards, ctx.scenario, ctx.playerCount, ctx.enemyData);
  const budget = computeTimeBudget(ctx.scenario, ctx.agendaCards, ctx.investigators, ctx.observedDoomRate);
  const demands = chain.map((sg) => estimateSubgoalDemand(sg, ctx));
  const totalApNeeded = demands.reduce((s, d) => s + (Number.isFinite(d.apNeeded) ? d.apNeeded : 0), 0)
    + (demands.some((d) => !Number.isFinite(d.apNeeded)) ? Infinity : 0);
  const urgency = budget.actionPointBudget === Infinity
    ? 0
    : budget.actionPointBudget > 0
      ? totalApNeeded / budget.actionPointBudget
      : Infinity;
  const posture: CommandTrace['posture'] =
    urgency > POSTURE_INFEASIBLE_AT ? 'infeasible' : urgency >= POSTURE_URGENT_AT ? 'urgent' : 'calm';
  return { turnNumber: ctx.scenario.turnNumber, chain, budget, demands, totalApNeeded, urgency, posture };
}

/** 軌跡 → 人讀字串(sim/戰役紀錄對帳用;驗證計畫乙項) */
export function formatCommandTrace(t: CommandTrace): string {
  const chainStr = t.chain
    .map((sg) => {
      const mark = sg.status === 'done' ? '✓' : sg.status === 'current' ? '▶' : '…';
      return `${mark}${sg.actName}(${sg.objective.kind})`;
    })
    .join(' → ');
  const demandStr = t.demands
    .filter((d) => d.subgoal.status !== 'done')
    .map((d) => `${d.subgoal.actName}:${Number.isFinite(d.apNeeded) ? d.apNeeded.toFixed(1) : '∞'}AP[${d.detail}]`)
    .join(' | ');
  const b = t.budget;
  const budgetStr = b.actionPointBudget === Infinity
    ? `預算∞(速率未知,毀滅空間${b.doomCapacityLeft})`
    : `預算${b.actionPointBudget.toFixed(0)}AP(毀滅空間${b.doomCapacityLeft}÷速率${(b.doomRatePerTurn ?? 0).toFixed(2)}=${b.turnsLeft.toFixed(1)}回合×${b.aliveCount}人×3)`;
  const uStr = t.budget.actionPointBudget === Infinity ? 'U=0.00' : `U=${Number.isFinite(t.urgency) ? t.urgency.toFixed(2) : '∞'}`;
  return `⚑ 指揮層 T${t.turnNumber}:${chainStr}\n   需求 ${demandStr || '(無)'}\n   ${budgetStr} → ${uStr}(${t.posture === 'calm' ? '從容' : t.posture === 'urgent' ? '告急' : '不可行'})`;
}
