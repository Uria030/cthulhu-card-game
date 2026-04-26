/**
 * G-01 規則引擎單元測試 — 三個基本動作的合法性與結算
 */
import { resolveIntent } from './ruleEngine';
import type { RuleContext } from './ruleEngine';
import type { IntentMessage } from './messages';
import type { InvestigatorState, ScenarioState, TurnState } from './state';
import { CURRENT_MESSAGE_SCHEMA_VERSION } from './messages';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

// ─── 測試固件 ────────────────────────
function makeInv(overrides: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'inv-1',
    investigatorDefinitionId: 'def-1',
    ownerPlayerId: 'p1',
    attributes: { strength: 3, agility: 3, constitution: 3, reflex: 3, intellect: 3, willpower: 3, perception: 3, charisma: 3 },
    combatStyle: 'sidearm',
    specializations: [],
    deck: ['c1', 'c2', 'c3'],
    hand: [],
    discardPile: [],
    removedPile: [],
    assetsInPlay: [],
    hp: 7, hpMax: 7, san: 7, sanMax: 7,
    actionPoints: 3,
    resources: 0,
    currentLocationId: 'loc-a',
    engagedWith: [],
    triggeredHorrorChecks: [],
    traumas: [],
    secretTaskState: null,
    permanentlyDead: false,
    startingXp: 0,
    ...overrides,
  };
}
function makeScenario(): ScenarioState {
  return {
    scenarioId: 's1', scenarioDefinitionId: 'sd1', campaignId: 'c1',
    locations: [
      { locationDefinitionId: 'loc-a', visibility: 'night', connectedTo: ['loc-b'], isObstacle: false },
      { locationDefinitionId: 'loc-b', visibility: 'night', connectedTo: ['loc-a', 'loc-c'], isObstacle: false },
      { locationDefinitionId: 'loc-c', visibility: 'darkness', connectedTo: ['loc-b'], isObstacle: true },
    ],
    enemies: [], tokens: [], agendaProgress: 0, objectiveProgress: 0,
    chaosBag: [], turnNumber: 1, phase: 'investigator',
  };
}
function makeTurn(phase: TurnState['phase'] = 'investigator'): TurnState {
  return { turnNumber: 1, phase, actionPointsSpent: {}, pendingLegendaryActions: [], triggeredReactions: [] };
}
function makeIntent(actionType: IntentMessage['actionType'], payload: Record<string, unknown> = {}): IntentMessage {
  return {
    id: 'msg-test', timestamp: '2026-04-26T00:00:00Z', schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION,
    source: 'p1', kind: 'intent', actionType, payload, playerId: 'p1', investigatorId: 'inv-1',
  };
}
function makeCtx(invOverrides: Partial<InvestigatorState> = {}): RuleContext {
  const inv = makeInv(invOverrides);
  return { scenario: makeScenario(), investigator: inv, turn: makeTurn(), investigators: { 'inv-1': inv } };
}

// ─── 階段守門 ────────────────────────
test('非調查員階段駁回', () => {
  const ctx: RuleContext = { ...makeCtx(), turn: makeTurn('mythos') };
  const r = resolveIntent(makeIntent('gain_resource'), ctx);
  assertEq(r.result.outcome, 'rejected');
});

test('永久死亡駁回', () => {
  const ctx = makeCtx({ permanentlyDead: true });
  const r = resolveIntent(makeIntent('gain_resource'), ctx);
  assertEq(r.result.outcome, 'rejected');
});

// ─── gain_resource ───────────────────
test('拿資源:扣 1 行動點 + 資源 +1', () => {
  const ctx = makeCtx({ actionPoints: 3, resources: 0 });
  const r = resolveIntent(makeIntent('gain_resource'), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.actionPoints, 2);
  assertEq(r.newState?.investigator?.resources, 1);
});

test('拿資源:行動點 0 駁回', () => {
  const ctx = makeCtx({ actionPoints: 0 });
  const r = resolveIntent(makeIntent('gain_resource'), ctx);
  assertEq(r.result.outcome, 'rejected');
});

// ─── draw_card ───────────────────────
test('抽卡:扣 1 行動點 + 牌庫 → 手牌', () => {
  const ctx = makeCtx({ deck: ['x', 'y', 'z'], hand: [] });
  const r = resolveIntent(makeIntent('draw_card'), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.actionPoints, 2);
  assertEq(r.newState?.investigator?.deck.length, 2);
  assertEq(r.newState?.investigator?.hand.length, 1);
  assertEq(r.newState?.investigator?.hand[0], 'x');
});

test('抽卡:牌庫空時受 1 恐懼(§3.3)', () => {
  const ctx = makeCtx({ deck: [], hand: [], san: 7 });
  const r = resolveIntent(makeIntent('draw_card'), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.san, 6);
  assertEq(r.newState?.investigator?.actionPoints, 2);
});

// ─── move ───────────────────────────
test('移動:相鄰地點 1 行動點', () => {
  const ctx = makeCtx({ currentLocationId: 'loc-a', actionPoints: 3 });
  const r = resolveIntent(makeIntent('move', { targetLocationId: 'loc-b' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.currentLocationId, 'loc-b');
  assertEq(r.newState?.investigator?.actionPoints, 2);
});

test('移動:障礙物地點 2 行動點', () => {
  const ctx = makeCtx({ currentLocationId: 'loc-b', actionPoints: 3 });
  const r = resolveIntent(makeIntent('move', { targetLocationId: 'loc-c' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.currentLocationId, 'loc-c');
  assertEq(r.newState?.investigator?.actionPoints, 1);
});

test('移動:非相鄰駁回', () => {
  const ctx = makeCtx({ currentLocationId: 'loc-a' });
  const r = resolveIntent(makeIntent('move', { targetLocationId: 'loc-c' }), ctx);
  assertEq(r.result.outcome, 'rejected');
});

test('移動:行動點不足駁回', () => {
  const ctx = makeCtx({ currentLocationId: 'loc-b', actionPoints: 1 });
  const r = resolveIntent(makeIntent('move', { targetLocationId: 'loc-c' }), ctx);
  assertEq(r.result.outcome, 'rejected');
});

test('移動:已在該地點駁回', () => {
  const ctx = makeCtx({ currentLocationId: 'loc-a' });
  const r = resolveIntent(makeIntent('move', { targetLocationId: 'loc-a' }), ctx);
  assertEq(r.result.outcome, 'rejected');
});

// ─── stub 動作 ───────────────────────
test('attack stub 駁回(後續展開)', () => {
  const ctx = makeCtx();
  const r = resolveIntent(makeIntent('attack'), ctx);
  assertEq(r.result.outcome, 'rejected');
});

// ─── runner ─────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed++; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed++; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
