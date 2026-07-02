/**
 * G-04 指揮層 P1 單元測試 — 第 1–3 層數字對帳
 * 依《調查員AI修改企畫書_v0_1_26070202》驗證計畫(乙):子目標鏈/預算/需求/U 值
 * 全部與人工推算對帳(關卡形狀鏡射「雨夜的真相」:2 ACT + 3 AGENDA 4/4/6)。
 */
import {
  deriveVictoryChain,
  computeTimeBudget,
  cumulativeDoom,
  estimateSubgoalDemand,
  commandTick,
  formatCommandTrace,
  assignRoles,
  objectiveForAssignment,
} from './investigatorCommand';
import type { CommandContext } from './investigatorCommand';
import type { ScenarioState, InvestigatorState } from './state';
import type { ActCardData, AgendaCardData } from './gameProgress';
import type { CardDataLookup, StyleCardData } from './ruleEngine';
import type { EnemyDataLookup } from './monsterActions';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}
function assertClose(actual: number, expected: number, eps = 0.01, msg?: string): void {
  if (Math.abs(actual - expected) > eps) throw new Error((msg ?? 'assertClose') + ': expected≈' + expected + ', actual=' + actual);
}
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

// ─── fixtures(鏡射測試關形狀)──────────────────────
function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'ai-1', investigatorDefinitionId: 'd', ownerPlayerId: 'ai',
    attributes: { strength: 1, agility: 2, constitution: 2, reflex: 1, intellect: 4, willpower: 2, perception: 3, charisma: 1 },
    combatStyle: 'assassin', specializations: [], deck: [], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 7, hpMax: 7, san: 7, sanMax: 7, actionPoints: 3, resources: 2, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}

function makeScenario(over: Partial<ScenarioState> = {}): ScenarioState {
  return {
    scenarioId: 's', scenarioDefinitionId: 's', campaignId: 'c',
    locations: [
      { locationDefinitionId: 'A', visibility: 'day', connectedTo: ['B'], isObstacle: false },
      { locationDefinitionId: 'B', visibility: 'day', connectedTo: ['A', 'C'], isObstacle: false },
      { locationDefinitionId: 'C', visibility: 'day', connectedTo: ['B'], isObstacle: false },
    ],
    unlockedLocations: ['A', 'B', 'C'],
    enemies: [], tokens: [], agendaProgress: 0, objectiveProgress: 0,
    chaosBag: [], turnNumber: 3, phase: 'investigator',
    ...over,
  };
}

const BOSS = 'G1_boss';
const ENEMY_DATA: EnemyDataLookup = {
  [BOSS]: { name_zh: '裂嘴女(測試)', tier: 3, hp_base: 23, hp_per_player: 0, dc: 20, damage_physical: 4, keywords: [] },
};

const ACTS: ActCardData[] = [
  { card_order: 1, name_zh: '牆上的真相', front_advance_condition: { type: 'clue_threshold', count: 2 } },
  { card_order: 2, name_zh: '終結傳說', front_advance_condition: { type: 'enemy_defeated', variant_code: BOSS }, back_resolution_code: 'stage_complete' },
];
const AGENDAS: AgendaCardData[] = [
  { card_order: 1, name_zh: '滂沱', front_doom_threshold: 4 },
  { card_order: 2, name_zh: '潮汐', front_doom_threshold: 4 },
  { card_order: 3, name_zh: '包圍', front_doom_threshold: 6, back_resolution_code: 'investigators_defeated' },
];

const STYLE_POOL: Record<string, StyleCardData[]> = {
  military: [
    { code: 'm1', name_zh: '瞄準射擊', check_attribute: 'reflex' },
    { code: 'm2', name_zh: '壓制火力', check_attribute: 'strength' },
  ],
};
const CARDS: CardDataLookup = {
  rifle: {
    name_zh: '軍用步槍', card_type: 'asset', cost: 2, combat_style: 'military',
    attribute_modifiers: { reflex: 2, strength: 2 },
    effects: [{ trigger_type: 'action', effect_code: 'attack', effect_params: { damage: 3 } }],
  },
};

function baseCtx(over: Partial<CommandContext> = {}): CommandContext {
  const inv1 = makeInv({ investigatorId: 'i1' });
  const inv2 = makeInv({ investigatorId: 'i2', attributes: { ...makeInv().attributes, perception: 4 } });
  const inv3 = makeInv({ investigatorId: 'i3', combatStyle: 'military', attributes: { ...makeInv().attributes, reflex: 3, strength: 3 }, assetsInPlay: ['rifle'] });
  return {
    scenario: makeScenario(),
    investigators: { i1: inv1, i2: inv2, i3: inv3 },
    actCards: ACTS,
    agendaCards: AGENDAS,
    enemyData: ENEMY_DATA,
    locationStats: { A: { shroud: 13 }, B: { shroud: 11 }, C: { shroud: 14 } },
    cardLookup: CARDS,
    stylePools: STYLE_POOL,
    playerCount: 3,
    observedDoomRate: 1,
    ...over,
  };
}

// ─── 第 1 層:子目標鏈 ─────────────────────────────
test('鏈:ACT1 current(clues 2×3=6)→ ACT2 pending(kill boss)', () => {
  const c = baseCtx();
  const chain = deriveVictoryChain(c.actCards, c.scenario, c.playerCount, c.enemyData);
  assertEq(chain.length, 2);
  assertEq(chain[0].status, 'current');
  assertEq(chain[0].objective.kind, 'clues');
  assertEq(chain[0].objective.clueTarget, 6, '線索需求 = count×人數');
  assertEq(chain[1].status, 'pending');
  assertEq(chain[1].objective.kind, 'kill');
});

test('鏈:actIndex=1 → ACT1 done、ACT2 current', () => {
  const c = baseCtx({ scenario: makeScenario({ actIndex: 1 }) });
  const chain = deriveVictoryChain(c.actCards, c.scenario, c.playerCount, c.enemyData);
  assertEq(chain[0].status, 'done');
  assertEq(chain[1].status, 'current');
});

test('鏈:屍體規則 — 提前登場的 boss 被殺,pending kill 視同 done(引擎查證行為)', () => {
  const sc = makeScenario({
    enemies: [{ instanceId: 'e1', enemyDefinitionId: BOSS, hp: 0, locationId: 'C', engagedWith: [], statusEffects: [] } as any],
  });
  const c = baseCtx({ scenario: sc });
  const chain = deriveVictoryChain(c.actCards, c.scenario, c.playerCount, c.enemyData);
  assertEq(chain[1].status, 'done', 'boss 屍體在場 → ACT2 條件已成立');
});

// ─── 第 2 層:時間預算 ─────────────────────────────
test('預算:毀滅空間 = 4+4+6 − 已累積;速率 1 → 回合數 = 空間', () => {
  const c = baseCtx({ scenario: makeScenario({ agendaProgress: 3 }) });
  const b = computeTimeBudget(c.scenario, c.agendaCards, c.investigators, 1);
  assertEq(b.doomCapacityLeft, 11, '14−3');
  assertClose(b.turnsLeft, 11);
  assertEq(b.aliveCount, 3);
  assertClose(b.actionPointBudget, 11 * 3 * 3, 0.01, '回合×3AP×3人');
});

test('預算:議程已翻一張(agendaIndex=1)→ 空間只剩後續門檻', () => {
  const c = baseCtx({ scenario: makeScenario({ agendaIndex: 1, agendaProgress: 2 }) });
  const b = computeTimeBudget(c.scenario, c.agendaCards, c.investigators, 1);
  assertEq(b.doomCapacityLeft, 8, '(4+6)−2');
  assertEq(cumulativeDoom(c.scenario, c.agendaCards), 6, '已翻 4 + 現累積 2');
});

test('預算:速率未知 → 預算無上限、U=0 從容', () => {
  const c = baseCtx({ observedDoomRate: null });
  const t = commandTick(c);
  assertEq(t.budget.actionPointBudget, Infinity);
  assertEq(t.urgency, 0);
  assertEq(t.posture, 'calm');
});

test('預算:倒地者不計入人數', () => {
  const c = baseCtx();
  c.investigators.i1 = makeInv({ investigatorId: 'i1', hp: 0 });
  const b = computeTimeBudget(c.scenario, c.agendaCards, c.investigators, 1);
  assertEq(b.aliveCount, 2);
});

// ─── 第 3 層:需求估算 ─────────────────────────────
test('需求(clues):缺 6 線索、最佳感知 4 vs 最低 shroud 11 → 6÷0.65', () => {
  const c = baseCtx();
  const chain = deriveVictoryChain(c.actCards, c.scenario, c.playerCount, c.enemyData);
  const d = estimateSubgoalDemand(chain[0], c);
  // estimateSuccessChance(4, 11):needed=7 → faces=14 → p=0.7
  assertClose(d.apNeeded, 6 / 0.7, 0.01);
});

test('需求(clues):進度扣抵 — 已有 4 線索只缺 2', () => {
  const c = baseCtx({ scenario: makeScenario({ objectiveProgress: 4 }) });
  const chain = deriveVictoryChain(c.actCards, c.scenario, c.playerCount, c.enemyData);
  const d = estimateSubgoalDemand(chain[0], c);
  assertClose(d.apNeeded, 2 / 0.7, 0.01);
});

test('需求(kill):boss 未生成用滿血 23;最佳輸出 = 步槍手', () => {
  const c = baseCtx();
  const chain = deriveVictoryChain(c.actCards, c.scenario, c.playerCount, c.enemyData);
  const d = estimateSubgoalDemand(chain[1], c);
  // 步槍手:風格池平均修正 = ((3+2)+(3+2))/2 = 5;DC20 → estimateSuccessChance(5,20):needed=15 → faces=6 → p=0.3
  // 期望傷害 = 3×0.3 = 0.9/AP → 23/0.9 ≈ 25.56
  assertClose(d.apNeeded, 23 / 0.9, 0.05);
});

test('需求(kill):boss 在場用當前 HP', () => {
  const sc = makeScenario({
    actIndex: 1,
    enemies: [{ instanceId: 'e1', enemyDefinitionId: BOSS, hp: 9, locationId: 'C', engagedWith: [], statusEffects: [] } as any],
  });
  const c = baseCtx({ scenario: sc });
  const chain = deriveVictoryChain(c.actCards, c.scenario, c.playerCount, c.enemyData);
  const d = estimateSubgoalDemand(chain[1], c);
  assertClose(d.apNeeded, 9 / 0.9, 0.05);
});

test('需求:手上未鋪的武器也算能力(投資窗口的客觀基礎)', () => {
  const c = baseCtx();
  const i3 = c.investigators.i3;
  c.investigators.i3 = { ...i3, assetsInPlay: [], hand: ['rifle'] };
  const chain = deriveVictoryChain(c.actCards, c.scenario, c.playerCount, c.enemyData);
  const d = estimateSubgoalDemand(chain[1], c);
  assertClose(d.apNeeded, 23 / 0.9, 0.05, '手上有槍 = 隊伍有此輸出能力');
});

// ─── 緊急分值與整合 ────────────────────────────────
test('U 值:總需求÷預算;從容/告急/不可行分檔', () => {
  // 從容:速率 1、空間 14 → 預算 126;需求 ≈ 8.57+25.56 ≈ 34.1 → U≈0.27
  const calm = commandTick(baseCtx());
  assertClose(calm.urgency, (6 / 0.7 + 23 / 0.9) / 126, 0.01);
  assertEq(calm.posture, 'calm');
  // 告急:毀滅 10(空間 4)、速率 1 → 預算 36;U≈0.95
  const urgent = commandTick(baseCtx({ scenario: makeScenario({ agendaProgress: 10 }) }));
  assertEq(urgent.posture, 'urgent');
  // 不可行:速率 3 → 預算 12;U>1
  const doomed = commandTick(baseCtx({ scenario: makeScenario({ agendaProgress: 10 }), observedDoomRate: 3 }));
  assertEq(doomed.posture, 'infeasible');
});

test('U 值:子目標 done 不計需求 — 屍體規則下只剩線索需求', () => {
  const sc = makeScenario({
    enemies: [{ instanceId: 'e1', enemyDefinitionId: BOSS, hp: 0, locationId: 'C', engagedWith: [], statusEffects: [] } as any],
  });
  const t = commandTick(baseCtx({ scenario: sc }));
  assertClose(t.totalApNeeded, 6 / 0.7, 0.01, 'kill 已 done,只剩湊線索');
});

test('formatCommandTrace:含鏈/需求/預算/U(人讀對帳)', () => {
  const s = formatCommandTrace(commandTick(baseCtx()));
  assert(s.includes('牆上的真相'), '鏈含 ACT1');
  assert(s.includes('U='), '含 U 值');
  assert(s.includes('從容'), '含姿態');
});

// ─── 第 4 層:隊伍指派(P2)──────────────────────────
test('指派:從容的線索幕 → 梯隊分工(感知優勢者收割,武器手為 ACT2 組陣)', () => {
  const c = baseCtx();
  const t = commandTick(c);
  const roles = assignRoles(t, c);
  assertEq(roles.length, 3);
  const byId = Object.fromEntries(roles.map((r) => [r.investigatorId, r]));
  assertEq(byId.i2.kind, 'clues', '感知 4 → 收割線索');
  assertEq(byId.i2.role, 'harvest');
  assertEq(byId.i3.kind, 'kill', '步槍手 → 為殺 boss 組陣');
  assertEq(byId.i3.role, 'prepare');
  const obj = objectiveForAssignment(byId.i3, t.chain);
  assertEq(obj?.kind, 'kill', '指派可換出第 5 層用的 objective');
});

test('指派:告急 → 梯隊收攏,全員壓當前幕', () => {
  const c = baseCtx({ scenario: makeScenario({ agendaProgress: 10 }) });
  const t = commandTick(c);
  assertEq(t.posture, 'urgent');
  const roles = assignRoles(t, c);
  assert(roles.every((r) => r.kind === 'clues' && r.role === 'harvest'), '告急時無人組陣');
});

test('指派:當前幕是 kill → 全員集火;指派不讀個性(輸入根本沒有 weights)', () => {
  const c = baseCtx({ scenario: makeScenario({ actIndex: 1 }) });
  const t = commandTick(c);
  const roles = assignRoles(t, c);
  assert(roles.every((r) => r.kind === 'kill'), '殺敵幕全員 kill');
  // 決定性:同輸入兩次結果一致(平手用 id 定序)
  const again = assignRoles(t, c);
  assertEq(JSON.stringify(roles), JSON.stringify(again));
});

// ─── runner ───────────────────────────────────
let passed = 0; let failed = 0; const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✅ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('❌ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
