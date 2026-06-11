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
function makeScenario(unlockedLocations: string[] = []): ScenarioState {
  return {
    scenarioId: 's1', scenarioDefinitionId: 'sd1', campaignId: 'c1',
    locations: [
      { locationDefinitionId: 'loc-a', visibility: 'night', connectedTo: ['loc-b'], isObstacle: false },
      { locationDefinitionId: 'loc-b', visibility: 'night', connectedTo: ['loc-a', 'loc-c'], isObstacle: false },
      { locationDefinitionId: 'loc-c', visibility: 'darkness', connectedTo: ['loc-b'], isObstacle: true },
    ],
    unlockedLocations,
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

// ─── 地點解鎖鏈 ───────────────────────
test('移動:目標未解鎖駁回', () => {
  const sc = makeScenario(['loc-a']); // 只解鎖 a
  const inv = makeInv({ currentLocationId: 'loc-a' });
  const ctx: RuleContext = { scenario: sc, investigator: inv, turn: makeTurn(), investigators: { 'inv-1': inv } };
  const r = resolveIntent(makeIntent('move', { targetLocationId: 'loc-b' }), ctx);
  assertEq(r.result.outcome, 'rejected');
});

test('移動:目標已解鎖通過', () => {
  const sc = makeScenario(['loc-a', 'loc-b']);
  const inv = makeInv({ currentLocationId: 'loc-a' });
  const ctx: RuleContext = { scenario: sc, investigator: inv, turn: makeTurn(), investigators: { 'inv-1': inv } };
  const r = resolveIntent(makeIntent('move', { targetLocationId: 'loc-b' }), ctx);
  assertEq(r.result.outcome, 'accepted');
});

// ─── investigate ─────────────────────
test('investigate:扣 1 行動點 + 擲 d20', () => {
  const ctx = makeCtx({ actionPoints: 3 });
  const r = resolveIntent(makeIntent('investigate'), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.actionPoints, 2);
  // 不論成功失敗都會扣行動點
});

test('investigate:行動點不足駁回', () => {
  const ctx = makeCtx({ actionPoints: 0 });
  const r = resolveIntent(makeIntent('investigate'), ctx);
  assertEq(r.result.outcome, 'rejected');
});

// ─── attack ──────────────────────────
test('attack:當前地點無敵人駁回', () => {
  const ctx = makeCtx({ currentLocationId: 'loc-a', actionPoints: 3 });
  const r = resolveIntent(makeIntent('attack'), ctx);
  assertEq(r.result.outcome, 'rejected');
});

test('attack:扣 1 行動點 + 結算', () => {
  const sc = makeScenario(['loc-a']);
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'def-e1', locationId: 'loc-a', hp: 3, engagedWith: [], modifiers: [] }];
  const inv = makeInv({ currentLocationId: 'loc-a', actionPoints: 3 });
  const ctx: RuleContext = { scenario: sc, investigator: inv, turn: makeTurn(), investigators: { 'inv-1': inv } };
  const r = resolveIntent(makeIntent('attack'), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.actionPoints, 2);
});

// ─── stub 動作 ───────────────────────
test('play_card stub 駁回(後續展開)', () => {
  const ctx = makeCtx();
  const r = resolveIntent(makeIntent('play_card'), ctx);
  assertEq(r.result.outcome, 'rejected');
});

// ═══ G-02 檢定管線整合(§4/§7/§12.1)═══
/** 固定骰值 rng */
const rngRoll = (roll: number) => () => (roll - 1) / 20;

function makeCombatCtx(opts: {
  roll: number;
  enemyDc?: number;
  enemyDamage?: number;
  hand?: string[];
  cardLookup?: RuleContext['cardLookup'];
  engaged?: boolean;
  visibility?: 'day' | 'night' | 'darkness' | 'fire';
} ): RuleContext {
  const sc = makeScenario(['loc-a']);
  if (opts.visibility) sc.locations[0] = { ...sc.locations[0], visibility: opts.visibility };
  sc.enemies = [{
    instanceId: 'e1', enemyDefinitionId: 'def-e1', locationId: 'loc-a', hp: 3,
    engagedWith: opts.engaged ? ['inv-1'] : [], modifiers: [],
  }];
  const inv = makeInv({
    currentLocationId: 'loc-a', actionPoints: 3,
    hand: opts.hand ?? [],
    engagedWith: opts.engaged ? ['e1'] : [],
  });
  return {
    scenario: sc, investigator: inv, turn: makeTurn(), investigators: { 'inv-1': inv },
    enemyStats: { 'def-e1': { dc: opts.enemyDc ?? 10, damage_physical: opts.enemyDamage ?? 2 } },
    cardLookup: opts.cardLookup,
    rng: rngRoll(opts.roll),
  };
}

test('investigate:DC 來自地點 shroud(locationStats)', () => {
  const ctx = { ...makeCtx({ actionPoints: 3 }), locationStats: { 'loc-a': { shroud: 14 } }, rng: rngRoll(10) };
  // roll 10 + 感知 3 = 13 < 14 → fail
  const r = resolveIntent(makeIntent('investigate'), ctx);
  assertEq(r.result.outcome, 'accepted');
  const rollEff = r.result.effects?.find((e) => e.type === 'roll_d20');
  assertEq((rollEff?.params as { dc: number }).dc, 14);
  assertEq((rollEff?.params as { outcome: string }).outcome, 'fail');
});

test('commit:加值生效 + 卡進棄牌堆(ch3 §3)', () => {
  const ctx = {
    ...makeCtx({ actionPoints: 3, hand: ['k1', 'k2'] }),
    locationStats: { 'loc-a': { shroud: 14 } },
    cardLookup: { k1: { commit_icons: { perception: 2 } }, k2: { commit_icons: { all: 1 } } },
    rng: rngRoll(10),
  };
  // roll 10 + 感知 3 + commit(2+1) = 16 ≥ 14 → success
  const r = resolveIntent(makeIntent('investigate', { commitCardIds: ['k1', 'k2'] }), ctx);
  const rollEff = r.result.effects?.find((e) => e.type === 'roll_d20');
  assertEq((rollEff?.params as { outcome: string }).outcome, 'success');
  assertEq(r.newState?.investigator?.hand.length, 0);
  assertEq(r.newState?.investigator?.discardPile.length, 2);
});

test('commit:不在手牌的卡駁回', () => {
  const ctx = { ...makeCtx({ actionPoints: 3, hand: [] }), rng: rngRoll(10) };
  const r = resolveIntent(makeIntent('investigate', { commitCardIds: ['ghost'] }), ctx);
  assertEq(r.result.outcome, 'rejected');
});

test('attack:DC 來自怪物 + 夜間 -2(§12.1)', () => {
  // roll 12 + 力量 3 - 夜間 2 = 13 < DC 14 → miss;白天則 15 ≥ 14 hit
  const night = resolveIntent(makeIntent('attack'), makeCombatCtx({ roll: 12, enemyDc: 14, visibility: 'night' }));
  const nEff = night.result.effects?.find((e) => e.type === 'roll_d20');
  assertEq((nEff?.params as { outcome: string }).outcome, 'miss');
  const day = resolveIntent(makeIntent('attack'), makeCombatCtx({ roll: 12, enemyDc: 14, visibility: 'day' }));
  const dEff = day.result.effects?.find((e) => e.type === 'roll_d20');
  assertEq((dEff?.params as { outcome: string }).outcome, 'hit');
});

test('attack:自然 20 爆擊 ×2(§7.5)', () => {
  const r = resolveIntent(makeIntent('attack'), makeCombatCtx({ roll: 20, enemyDc: 10, visibility: 'day' }));
  const hit = r.result.effects?.find((e) => e.type === 'attack_hit');
  assertEq((hit?.params as { damage: number }).damage, 2);
  assertEq(r.newState?.scenario?.enemies[0].hp, 1);
});

test('attack:自然 1 純未命中(單人無交戰隊友,§7.5)', () => {
  // roll 1 + 力量 3 + 白天 = 4,即使 DC 設 1 也判 miss(natural1 優先)
  const r = resolveIntent(makeIntent('attack'), makeCombatCtx({ roll: 1, enemyDc: 1, visibility: 'day' }));
  const miss = r.result.effects?.find((e) => e.type === 'attack_miss');
  assertEq(miss !== undefined, true);
});

test('evade:成功脫離交戰無傷(§7.4)', () => {
  // roll 15 + 反應 3 = 18 ≥ 10
  const r = resolveIntent(makeIntent('evade'), makeCombatCtx({ roll: 15, engaged: true, visibility: 'day' }));
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.engagedWith.length, 0);
  assertEq(r.newState?.investigator?.hp, 7);
  assertEq(r.newState?.scenario?.enemies[0].engagedWith.length, 0);
});

test('evade:失敗也脫離交戰但受敵人物理傷害(§7.4)', () => {
  // roll 2 + 反應 3 = 5 < 10 → fail,受 damage_physical 2
  const r = resolveIntent(makeIntent('evade'), makeCombatCtx({ roll: 2, engaged: true, enemyDamage: 2, visibility: 'day' }));
  assertEq(r.newState?.investigator?.engagedWith.length, 0);
  assertEq(r.newState?.investigator?.hp, 5);
});

test('evade:黑暗中 +2(§12.1)', () => {
  // roll 6 + 反應 3 = 9 < 10;黑暗 +2 → 11 ≥ 10 success
  const dark = resolveIntent(makeIntent('evade'), makeCombatCtx({ roll: 6, engaged: true, visibility: 'darkness' }));
  const eff = dark.result.effects?.find((e) => e.type === 'evade_success');
  assertEq(eff !== undefined, true);
});

test('evade:未交戰駁回', () => {
  const r = resolveIntent(makeIntent('evade'), makeCombatCtx({ roll: 15, engaged: false }));
  assertEq(r.result.outcome, 'rejected');
});

test('evade:多敵交戰只脫離結算的那一隻(§7.4)', () => {
  const ctx = makeCombatCtx({ roll: 15, engaged: true, visibility: 'day' });
  // 加第二隻交戰中的敵人
  ctx.scenario.enemies.push({
    instanceId: 'e2', enemyDefinitionId: 'def-e1', locationId: 'loc-a', hp: 3,
    engagedWith: ['inv-1'], modifiers: [],
  });
  ctx.investigator.engagedWith = ['e1', 'e2'];
  ctx.investigators['inv-1'] = ctx.investigator;
  const r = resolveIntent(makeIntent('evade', { enemyInstanceId: 'e1' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.engagedWith.length, 1);
  assertEq(r.newState?.investigator?.engagedWith[0], 'e2');
  const e1 = r.newState?.scenario?.enemies.find((e) => e.instanceId === 'e1');
  const e2 = r.newState?.scenario?.enemies.find((e) => e.instanceId === 'e2');
  assertEq(e1?.engagedWith.length, 0);
  assertEq(e2?.engagedWith.length, 1);
});

test('evade:指定未交戰的敵人駁回', () => {
  const ctx = makeCombatCtx({ roll: 15, engaged: true, visibility: 'day' });
  const r = resolveIntent(makeIntent('evade', { enemyInstanceId: 'ghost' }), ctx);
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
