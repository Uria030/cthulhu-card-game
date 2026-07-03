/**
 * G-01 規則引擎單元測試 — 三個基本動作的合法性與結算
 */
import { resolveIntent } from './ruleEngine';
import type { RuleContext } from './ruleEngine';
import { syncDownedState } from './dying';
import type { IntentMessage } from './messages';
import type { InvestigatorState, ScenarioState, TurnState } from './state';
import type { HiddenPoint } from './hiddenInvestigation';
import { CURRENT_MESSAGE_SCHEMA_VERSION } from './messages';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}
function assertIncludes(actual: string, expected: string, msg?: string): void {
  if (!actual.includes(expected)) throw new Error((msg ?? 'assertIncludes') + ': expected substring=' + expected + ', actual=' + actual);
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

test('瀕死者不能行動(§9)', () => {
  const ctx = makeCtx({ hp: 0, downed: true });
  const r = resolveIntent(makeIntent('investigate'), ctx);
  assertEq(r.result.outcome, 'rejected');
});

// ─── stabilize(§9.5)──────────────────
test('穩定:1 行動點,同地點瀕死隊友 +1 成功(自動成功)', () => {
  const ctx = makeCtx();
  const ally = makeInv({ investigatorId: 'inv-2', hp: 0, downed: true, deathSaveSuccesses: 0 });
  ctx.investigators['inv-2'] = ally;
  const r = resolveIntent(makeIntent('stabilize', { targetInvestigatorId: 'inv-2' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.actionPoints, 2);
  assertEq(r.newState?.updatedAllies?.['inv-2']?.deathSaveSuccesses, 1);
});

test('穩定:隊友不同地點/站著 → 駁回', () => {
  const ctx = makeCtx();
  ctx.investigators['inv-2'] = makeInv({ investigatorId: 'inv-2', hp: 0, downed: true, currentLocationId: 'loc-b' });
  ctx.investigators['inv-3'] = makeInv({ investigatorId: 'inv-3' });
  assertEq(resolveIntent(makeIntent('stabilize', { targetInvestigatorId: 'inv-2' }), ctx).result.outcome, 'rejected');
  assertEq(resolveIntent(makeIntent('stabilize', { targetInvestigatorId: 'inv-3' }), ctx).result.outcome, 'rejected');
});

test('E10:救援目標已站起時維持駁回,但回饋搶先一步敘事', () => {
  const ctx = makeCtx();
  ctx.investigators['inv-2'] = makeInv({ investigatorId: 'inv-2', hp: 3, downed: false });
  const r = resolveIntent(makeIntent('stabilize', { targetInvestigatorId: 'inv-2' }), ctx);
  assertEq(r.result.outcome, 'rejected');
  assertIncludes(r.result.rejection?.narrative ?? '', '搶先一步');
});

test('E10:指定敵人已倒下時維持駁回,但回饋目標失效敘事', () => {
  const sc = makeScenario(['loc-a']);
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'def-e1', locationId: 'loc-a', hp: 0, engagedWith: [], modifiers: [] }];
  const inv = makeInv({ currentLocationId: 'loc-a', actionPoints: 3 });
  const ctx: RuleContext = {
    scenario: sc,
    investigator: inv,
    turn: makeTurn(),
    investigators: { 'inv-1': inv },
    enemyStats: { 'def-e1': { name_zh: '裂嘴女' } },
  };
  const r = resolveIntent(makeIntent('attack', { enemyInstanceId: 'e1' }), ctx);
  assertEq(r.result.outcome, 'rejected');
  assertIncludes(r.result.rejection?.narrative ?? '', '搶先一步');
});

test('E10:共享物資已被取走時維持駁回,但回饋藏物處已空敘事', () => {
  const sc = makeScenario(['loc-a']);
  sc.discoverablePools = [{ id: 'slot-1', locationId: 'loc-a', cardInstanceId: 'c1', takenBy: 'inv-2' }];
  const inv = makeInv({ currentLocationId: 'loc-a', actionPoints: 3 });
  const ctx: RuleContext = { scenario: sc, investigator: inv, turn: makeTurn(), investigators: { 'inv-1': inv } };
  const r = resolveIntent(makeIntent('search'), ctx);
  assertEq(r.result.outcome, 'rejected');
  assertIncludes(r.result.rejection?.narrative ?? '', '搶先一步');
});

test('E10:交戰已解除時維持駁回,但回饋糾纏已解開敘事', () => {
  const ctx = makeCtx({ engagedWith: [] });
  const r = resolveIntent(makeIntent('evade'), ctx);
  assertEq(r.result.outcome, 'rejected');
  assertIncludes(r.result.rejection?.narrative ?? '', '糾纏已經被解開');
});

// ─── 倒地同步窗口回歸(review WARN 指定)──
test('同步窗口:閃避失敗扣到 0 → 引擎結算後 sync 必須抓到倒地', () => {
  // 反應 3 + roll 2 < DC 10 → 失敗受 1 傷;hp 1 → 0
  const ctx = makeCombatCtx({ roll: 2, enemyDc: 10, visibility: 'day' });
  ctx.investigator = { ...ctx.investigator, hp: 1, engagedWith: ['e1'] };
  ctx.investigators['inv-1'] = ctx.investigator;
  ctx.scenario = {
    ...ctx.scenario,
    enemies: ctx.scenario.enemies.map((e) => ({ ...e, engagedWith: ['inv-1'] })),
  };
  const r = resolveIntent(makeIntent('evade'), ctx);
  assertEq(r.result.outcome, 'accepted');
  const after = r.newState!.investigator!;
  assertEq(after.hp, 0, '失敗挨一下歸零');
  assertEq(after.downed ?? false, false, '引擎本身不立旗標 — 同步是容器責任');
  const sync = syncDownedState(after);
  assertEq(sync.investigator.downed, true, 'sync 必須抓到倒地');
  assertEq(sync.effects.some((e) => e.type === 'investigator_downed'), true);
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

test('移動:冷凍 +1 行動點花費(§6.2)', () => {
  const ctx = makeCtx({ currentLocationId: 'loc-a', actionPoints: 3, statusEffects: { frozen: 1 } });
  const r = resolveIntent(makeIntent('move', { targetLocationId: 'loc-b' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.actionPoints, 1, '基礎 1 + 冷凍 1 = 花費 2');
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

test('evade:成功敵人被絆倒 = stunned 失去下次行動;失敗不絆倒(§7.4 + ch3 stun_enemy)', () => {
  const ok = resolveIntent(makeIntent('evade'), makeCombatCtx({ roll: 15, engaged: true, visibility: 'day' }));
  assertEq(ok.newState?.scenario?.enemies[0].modifiers.includes('stunned'), true, '成功 → 絆倒標記');
  assertEq(ok.result.effects?.some((e) => e.type === 'enemy_stunned'), true, '成功 → 絆倒敘事');
  const fail = resolveIntent(makeIntent('evade'), makeCombatCtx({ roll: 2, engaged: true, enemyDamage: 2, visibility: 'day' }));
  assertEq(fail.newState?.scenario?.enemies[0].modifiers.includes('stunned'), false, '失敗 → 不絆倒');
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

// ═══ G-02 批次②:卡片結算(§6.1/ch3/§8)═══

const WEAPON_LOOKUP: RuleContext['cardLookup'] = {
  wpn: {
    name_zh: '探長左輪', card_type: 'asset', cost: 2, combat_style: 'shooting',
    attribute_modifiers: { perception: 1 },
    effects: [{ trigger_type: 'action', effect_code: 'attack', effect_params: { damage: 2 }, duration: 'instant' }],
  },
  evt: {
    name_zh: '霰彈', card_type: 'event', cost: 1,
    effects: [{ trigger_type: 'action', effect_code: 'deal_damage', effect_params: { area: true, amount: 2 }, duration: 'instant' }],
  },
  skl: {
    name_zh: '彈道解析', card_type: 'skill', cost: 0, commit_icons: { intellect: 2 },
    effects: [{ trigger_type: 'on_success', effect_code: 'draw_card', effect_params: {}, duration: 'instant' }],
  },
  obs: {
    name_zh: '探長觀察', card_type: 'skill', cost: 0, commit_icons: { perception: 2 },
    effects: [{ trigger_type: 'on_success', effect_code: 'draw_card', effect_params: {}, duration: 'instant' }],
  },
};

const SHOOTING_POOL: NonNullable<RuleContext['stylePools']> = {
  shooting: [
    { code: 'sc1', name_zh: '穩定射擊', check_attribute: 'perception', narrative_success_zh: '子彈正中目標。', narrative_fail_zh: '子彈擦過牆角。' },
  ],
};

function makeCardCtx(opts: { roll: number; hand?: string[]; assets?: string[]; resources?: number; enemyDc?: number }): RuleContext {
  const base = makeCombatCtx({ roll: opts.roll, enemyDc: opts.enemyDc ?? 10, visibility: 'day' });
  base.investigator = {
    ...base.investigator,
    hand: opts.hand ?? [],
    assetsInPlay: opts.assets ?? [],
    resources: opts.resources ?? 5,
    deck: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'],
  };
  base.investigators['inv-1'] = base.investigator;
  base.cardLookup = WEAPON_LOOKUP;
  base.stylePools = SHOOTING_POOL;
  return base;
}

test('play_card:資產進場 + 扣費用(§6.1)', () => {
  const ctx = makeCardCtx({ roll: 10, hand: ['wpn'], resources: 3 });
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'wpn' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.assetsInPlay.includes('wpn'), true);
  assertEq(r.newState?.investigator?.resources, 1);
  assertEq(r.newState?.investigator?.actionPoints, 2);
});

test('play_card:資源不足駁回', () => {
  const ctx = makeCardCtx({ roll: 10, hand: ['wpn'], resources: 1 });
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'wpn' }), ctx);
  assertEq(r.result.outcome, 'rejected');
});

test('play_card:技能卡不可打出(ch3 §3.2)', () => {
  const ctx = makeCardCtx({ roll: 10, hand: ['skl'] });
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'skl' }), ctx);
  assertEq(r.result.outcome, 'rejected');
});

test('play_card:弱點卡不可打出(ch6 §9 強制顯現物)', () => {
  const ctx = makeCardCtx({ roll: 10, hand: ['wk'], resources: 5 });
  ctx.cardLookup = { ...ctx.cardLookup, wk: { name_zh: '反追蹤', card_type: 'weakness', cost: 0, effects: [] } };
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'wk' }), ctx);
  assertEq(r.result.outcome, 'rejected');
});

test('play_card:未知/缺漏 card_type 一律駁回(白名單制)', () => {
  const ctx = makeCardCtx({ roll: 10, hand: ['mys'], resources: 5 });
  ctx.cardLookup = { ...ctx.cardLookup, mys: { name_zh: '形狀不明', cost: 0, effects: [] } };
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'mys' }), ctx);
  assertEq(r.result.outcome, 'rejected');
});

// ─── 使用次數(ch3 §10.1)──────────────
test('彈藥:進場初始化 → 攻擊扣 1 → 耗盡進棄牌堆 → 再攻擊駁回', () => {
  const ctx = makeCardCtx({ roll: 19, hand: ['gun'], resources: 5 });
  ctx.cardLookup = {
    ...ctx.cardLookup,
    gun: {
      name_zh: '老左輪', card_type: 'asset', cost: 1, combat_style: 'shooting',
      ammo: 1, attribute_modifiers: { perception: 1 },
      effects: [{ trigger_type: 'action', effect_code: 'attack', effect_params: { damage: 2 } }],
    },
  };
  ctx.stylePools = { shooting: [{ code: 's1', name_zh: '速射', check_attribute: 'perception' }] };
  // 進場
  const played = resolveIntent(makeIntent('play_card', { cardInstanceId: 'gun' }), ctx);
  assertEq(played.result.outcome, 'accepted');
  assertEq(played.newState?.investigator?.assetState?.gun?.usesLeft, 1);
  // 攻擊:扣 1 發 → 耗盡 → 棄牌堆
  const inv2 = played.newState!.investigator!;
  const ctx2: RuleContext = { ...ctx, investigator: inv2, investigators: { 'inv-1': inv2 } };
  const shot = resolveIntent(makeIntent('execute_card_action', { cardInstanceId: 'gun', enemyInstanceId: 'e1' }), ctx2);
  assertEq(shot.result.outcome, 'accepted');
  assertEq(shot.result.effects?.some((e) => e.type === 'asset_expended'), true, '打空進棄牌堆');
  const inv3 = shot.newState!.investigator!;
  assertEq(inv3.assetsInPlay.includes('gun'), false);
  assertEq(inv3.discardPile.includes('gun'), true);
  // 再攻擊:卡已不在場上
  const ctx3: RuleContext = { ...ctx, investigator: inv3, investigators: { 'inv-1': inv3 } };
  assertEq(resolveIntent(makeIntent('execute_card_action', { cardInstanceId: 'gun' }), ctx3).result.outcome, 'rejected');
});

// ─── 消費(三合一第三用途,ch3 §2.2)─────
test('消費:1 行動點 + 棄掉 → 觸發輔助效果;未配置消費的卡駁回', () => {
  const ctx = makeCardCtx({ roll: 10, hand: ['snack', 'plain'], resources: 0 });
  ctx.cardLookup = {
    ...ctx.cardLookup,
    snack: { name_zh: '威士忌', card_type: 'event', cost: 1, consume_enabled: true, consume_effect: { effect_code: 'gain_resource', effect_params: { amount: 2 } }, effects: [] },
    plain: { name_zh: '普通卡', card_type: 'event', cost: 1, effects: [] },
  };
  const r = resolveIntent(makeIntent('consume', { cardInstanceId: 'snack' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.resources, 2);
  assertEq(r.newState?.investigator?.discardPile.includes('snack'), true);
  assertEq(resolveIntent(makeIntent('consume', { cardInstanceId: 'plain' }), ctx).result.outcome, 'rejected');
});

// ─── 混沌袋施法軌(ch2 §5 + §8.4)──────
function makeSpellCtx(opts: { chaos: Array<{ type: string; value: number | null }>; spellDefense?: number; markers?: Record<string, string> }): RuleContext {
  const sc = makeScenario(['loc-a']);
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'def-boss', locationId: 'loc-a', hp: 5, engagedWith: [], modifiers: [] }];
  sc.chaosBag = opts.chaos.map((t, i) => ({ tokenId: 'ct' + i, type: t.type, value: t.value }));
  const inv = makeInv({ currentLocationId: 'loc-a', actionPoints: 3, hand: ['spell'], san: 7, sanMax: 11, resources: 5 });
  return {
    scenario: sc, investigator: inv, turn: makeTurn(), investigators: { 'inv-1': inv },
    enemyStats: { 'def-boss': { dc: 14, spell_defense: opts.spellDefense ?? 0 } },
    cardLookup: {
      spell: {
        name_zh: '心靈刺擊', card_type: 'event', cost: 2, combat_style: 'arcane',
        effects: [{ trigger_type: 'action', effect_code: 'deal_damage(single-target)', effect_params: { amount: 3 }, duration: 'instant' }],
      },
    },
    chaosMarkerEffects: opts.markers ?? {},
    rng: () => 0, // 抽袋取索引 0
  };
}

test('施法:arcane 事件一定命中造成傷害 + 抽混沌袋(§8.4)', () => {
  // 數字 0:無副作用(防禦 0,差值 ≤0 → 全免)
  const ctx = makeSpellCtx({ chaos: [{ type: 'numeric', value: 0 }] });
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'spell' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  const enemy = r.newState?.scenario?.enemies[0];
  assertEq(enemy?.hp, 2, '髒效果碼 deal_damage(single-target) 仍正確扣 3');
  assertEq(r.result.effects?.some((e) => e.type === 'chaos_token_drawn'), true);
});

test('施法:觸手 → 場景效果 + SAN 反噬(§5.6)', () => {
  const ctx = makeSpellCtx({ chaos: [{ type: 'tentacle', value: null }] });
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'spell' }), ctx);
  assertEq(r.newState?.investigator?.san, 6, '觸手 SAN -1');
  assertEq(r.result.effects?.some((e) => e.type === 'spell_strain'), true);
});

test('施法:遠古印記 → 副作用全免 + SAN +1(§5.6)', () => {
  const ctx = makeSpellCtx({ chaos: [{ type: 'elder_sign', value: null }] });
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'spell' }), ctx);
  assertEq(r.newState?.investigator?.san, 8, '遠古印記 SAN +1');
});

test('施法:石版(forbidden_knowledge)場景效果 SAN -2;法防高放大副作用', () => {
  // 石版 value -2,法防 4 → 差值 6 → full_with_strain;場景效果發動
  const ctx = makeSpellCtx({ chaos: [{ type: 'tablet', value: -2 }], spellDefense: 4, markers: { tablet: 'forbidden_knowledge' } });
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'spell' }), ctx);
  // 場景效果 -2 SAN + full_with_strain 額外 -1 = 7 → 4
  const sanEff = r.result.effects?.filter((e) => e.type === 'fear_damage' || e.type === 'spell_strain') ?? [];
  assertEq(sanEff.length >= 1, true);
  assertEq((r.newState?.investigator?.san ?? 99) < 7, true, 'SAN 有損失');
});

test('施法:bless 抽後移出袋(supp04)', () => {
  const ctx = makeSpellCtx({ chaos: [{ type: 'bless', value: 1 }, { type: 'numeric', value: 0 }] });
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'spell' }), ctx);
  assertEq(r.newState?.scenario?.chaosBag.some((t) => t.type === 'bless'), false, 'bless 已移出');
});

test('play_card:事件卡結算範圍傷害後進棄牌堆', () => {
  const ctx = makeCardCtx({ roll: 10, hand: ['evt'] });
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'evt' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.scenario?.enemies[0].hp, 1); // 3 - 2
  assertEq(r.newState?.investigator?.discardPile.includes('evt'), true);
});

test('武器攻擊:風格卡指定屬性 + 武器修正生效(§8)', () => {
  // roll 10 + 感知 3 + 武器修正 1 = 14 ≥ DC 14 → hit;傷害 2
  const ctx = makeCardCtx({ roll: 10, assets: ['wpn'], enemyDc: 14 });
  const r = resolveIntent(makeIntent('execute_card_action', { cardInstanceId: 'wpn' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  const drawn = r.result.effects?.find((e) => e.type === 'style_card_drawn');
  assertEq((drawn?.params as { attribute: string }).attribute, 'perception');
  const hit = r.result.effects?.find((e) => e.type === 'attack_hit');
  assertEq((hit?.params as { damage: number }).damage, 2);
  assertEq(r.newState?.scenario?.enemies[0].hp, 1);
});

test('武器攻擊:commit 卡 on_success 抽牌(ch3 §3.2)', () => {
  // roll 8 + 感知 3 + 武器 1 + commit obs 2 = 14 ≥ 14 hit → on_success 抽 1
  const ctx = makeCardCtx({ roll: 8, hand: ['obs'], assets: ['wpn'], enemyDc: 14 });
  const r = resolveIntent(
    makeIntent('execute_card_action', { cardInstanceId: 'wpn', commitCardIds: ['obs'] }),
    ctx,
  );
  assertEq(r.result.outcome, 'accepted');
  const hit = r.result.effects?.find((e) => e.type === 'attack_hit');
  assertEq(hit !== undefined, true, '應命中');
  // obs 進棄牌堆 + on_success 抽 1 張(d1 入手)
  assertEq(r.newState?.investigator?.discardPile.includes('obs'), true);
  assertEq(r.newState?.investigator?.hand.includes('d1'), true);
});

test('武器攻擊:風格池為空駁回', () => {
  const ctx = makeCardCtx({ roll: 10, assets: ['wpn'] });
  ctx.stylePools = {};
  const r = resolveIntent(makeIntent('execute_card_action', { cardInstanceId: 'wpn' }), ctx);
  assertEq(r.result.outcome, 'rejected');
});

test('execute_card_action:不在場上駁回', () => {
  const ctx = makeCardCtx({ roll: 10, hand: ['wpn'] });
  const r = resolveIntent(makeIntent('execute_card_action', { cardInstanceId: 'wpn' }), ctx);
  assertEq(r.result.outcome, 'rejected');
});

// ═══ G-02 批次③:交戰懲罰與脫離(§7.2)═══

test('交戰中移動:吃 AoO + 雙向解除交戰(§7.2)', () => {
  const ctx = makeCombatCtx({ roll: 10, engaged: true, enemyDamage: 2, visibility: 'day' });
  ctx.scenario.unlockedLocations = ['loc-a', 'loc-b'];
  const r = resolveIntent(makeIntent('move', { targetLocationId: 'loc-b' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  const aoo = r.result.effects?.find((e) => e.type === 'attack_of_opportunity');
  assertEq(aoo !== undefined, true, '應觸發藉機攻擊');
  assertEq(r.newState?.investigator?.hp, 5); // -2 物理
  assertEq(r.newState?.investigator?.engagedWith.length, 0, '移動後解除交戰');
  assertEq(r.newState?.scenario?.enemies[0].engagedWith.length, 0, '敵方也解除');
  assertEq(r.newState?.investigator?.currentLocationId, 'loc-b');
});

test('交戰中調查:吃 AoO 但交戰維持(§7.2)', () => {
  const ctx = makeCombatCtx({ roll: 15, engaged: true, enemyDamage: 2, visibility: 'day' });
  const r = resolveIntent(makeIntent('investigate'), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.hp, 5);
  assertEq(r.newState?.investigator?.engagedWith.length, 1, '調查不脫離交戰');
});

test('交戰中攻擊/閃避:不吃 AoO(§7.2 豁免)', () => {
  const atk = resolveIntent(makeIntent('attack'), makeCombatCtx({ roll: 15, engaged: true, visibility: 'day' }));
  assertEq(atk.result.effects?.some((e) => e.type === 'attack_of_opportunity'), false);
  const evd = resolveIntent(makeIntent('evade'), makeCombatCtx({ roll: 15, engaged: true, visibility: 'day' }));
  assertEq(evd.result.effects?.some((e) => e.type === 'attack_of_opportunity'), false);
});

test('taunt:拉同地點未交戰敵人入交戰(§7.3)', () => {
  const ctx = makeCombatCtx({ roll: 10, engaged: false, visibility: 'day' });
  const r = resolveIntent(makeIntent('taunt'), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.engagedWith.length, 1);
  assertEq(r.newState?.scenario?.enemies[0].engagedWith.includes('inv-1'), true);
});

test('taunt:單一持有者 — 從前持有者手上轉走(Uria 拍板)', () => {
  const ctx = makeCombatCtx({ roll: 10, engaged: false, visibility: 'day' });
  // 怪 e1 原本被隊友 inv-2 固定
  ctx.scenario.enemies[0].engagedWith = ['inv-2'];
  const ally = makeInv({ investigatorId: 'inv-2', engagedWith: ['e1'], currentLocationId: 'loc-a' });
  ctx.investigators['inv-2'] = ally;
  const r = resolveIntent(makeIntent('taunt', { enemyInstanceId: 'e1' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  // 怪改為只被 inv-1 固定(獨佔)
  assertEq(r.newState?.scenario?.enemies[0].engagedWith.length, 1);
  assertEq(r.newState?.scenario?.enemies[0].engagedWith[0], 'inv-1');
  // 前持有者 inv-2 解除與這隻怪的交戰
  assertEq(r.newState?.updatedAllies?.['inv-2']?.engagedWith.includes('e1'), false);
});

test('§11.2 massive:taunt 不覆寫單一持有者,保留其他交戰者(Uria 例外)', () => {
  const ctx = makeCombatCtx({ roll: 10, engaged: false, visibility: 'day' });
  ctx.enemyStats!['def-e1'] = { ...ctx.enemyStats!['def-e1'], keywords: ['massive'] };
  ctx.scenario.enemies[0].engagedWith = ['inv-2'];
  ctx.investigators['inv-2'] = makeInv({ investigatorId: 'inv-2', engagedWith: ['e1'], currentLocationId: 'loc-a' });
  const r = resolveIntent(makeIntent('taunt', { enemyInstanceId: 'e1' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  const eng = r.newState?.scenario?.enemies[0].engagedWith ?? [];
  assertEq(eng.includes('inv-2'), true, 'massive 保留原交戰者');
  assertEq(eng.includes('inv-1'), true, 'taunter 加入交戰');
  assertEq(r.newState?.updatedAllies?.['inv-2'], undefined, '不從 inv-2 手上轉走');
});

// ─── 隱藏調查點接線(§13 wiring)──────────
function mkHP(over: Partial<HiddenPoint> = {}): HiddenPoint {
  return {
    id: 'hp1', locationId: 'loc-a', title: '牆後的暗格', description: '一道幾乎看不見的縫隙。',
    threshold: 2, revealedTo: [], claimedBy: [], limitedClaimedBy: null,
    hasLimited: false, rewardType: 'effect', rewardParams: {},
    ...over,
  };
}
function ctxWithHidden(points: HiddenPoint[], invOverrides: Partial<InvestigatorState> = {}, rng?: () => number): RuleContext {
  const base = makeCtx(invOverrides);
  return { ...base, scenario: { ...base.scenario, hiddenPoints: points }, rng };
}

test('§13.2 移動進地點:感知 ≥ 門檻 → 自動揭露 + hidden_point_revealed', () => {
  const ctx = ctxWithHidden([mkHP({ locationId: 'loc-b', threshold: 3 })], { currentLocationId: 'loc-a', actionPoints: 3 });
  const r = resolveIntent(makeIntent('move', { targetLocationId: 'loc-b' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq((r.result.effects ?? []).some((e) => e.type === 'hidden_point_revealed'), true, '應揭露');
  assertEq(r.newState?.scenario?.hiddenPoints?.[0].revealedTo.includes('inv-1'), true);
});

test('§13.2 移動進地點:感知不足 → 看不見,不更新 scenario', () => {
  const ctx = ctxWithHidden([mkHP({ locationId: 'loc-b', threshold: 9 })], { currentLocationId: 'loc-a', actionPoints: 3 });
  const r = resolveIntent(makeIntent('move', { targetLocationId: 'loc-b' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq((r.result.effects ?? []).some((e) => e.type === 'hidden_point_revealed'), false, '感知不足不揭露');
});

test('§13.4 一般調查成功 → 觸發發現未揭露隱藏點', () => {
  const ctx = ctxWithHidden([mkHP({ locationId: 'loc-a', threshold: 9 })], { currentLocationId: 'loc-a', actionPoints: 3 }, () => 0.95);
  const r = resolveIntent(makeIntent('investigate'), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq((r.result.effects ?? []).some((e) => e.type === 'hidden_point_revealed'), true, '一般調查成功應觸發發現');
  assertEq(r.newState?.scenario?.hiddenPoints?.[0].revealedTo.includes('inv-1'), true);
});

test('§13.3 investigate_hidden:未揭露 → 駁回,不耗行動點', () => {
  const ctx = ctxWithHidden([mkHP({ locationId: 'loc-a', revealedTo: [] })], { currentLocationId: 'loc-a', actionPoints: 3 });
  const r = resolveIntent(makeIntent('investigate_hidden', { pointId: 'hp1' }), ctx);
  assertEq(r.result.outcome, 'rejected');
  assertEq(r.newState, undefined, '駁回不產生新狀態(未扣行動點)');
});

test('§13.3 investigate_hidden:已揭露 + 檢定成功 → hidden_reward + claimedBy 更新', () => {
  const ctx = ctxWithHidden([mkHP({ locationId: 'loc-a', revealedTo: ['inv-1'] })], { currentLocationId: 'loc-a', actionPoints: 3 }, () => 0.95);
  const r = resolveIntent(makeIntent('investigate_hidden', { pointId: 'hp1' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.actionPoints, 2);
  assertEq((r.result.effects ?? []).some((e) => e.type === 'hidden_reward'), true);
  assertEq(r.newState?.scenario?.hiddenPoints?.[0].claimedBy.includes('inv-1'), true);
});

test('§13.3 investigate_hidden:限定品首位拿旗標', () => {
  const ctx = ctxWithHidden(
    [mkHP({ locationId: 'loc-a', revealedTo: ['inv-1'], hasLimited: true, rewardParams: { limited_flag: 'story.diary' } })],
    { currentLocationId: 'loc-a', actionPoints: 3 }, () => 0.95,
  );
  const r = resolveIntent(makeIntent('investigate_hidden', { pointId: 'hp1' }), ctx);
  const reward = (r.result.effects ?? []).find((e) => e.type === 'hidden_reward');
  assertEq(reward?.params.gotLimited, true);
  assertEq(reward?.params.limitedFlag, 'story.diary');
});

test('§13.3 investigate_hidden:同一人重領 → 駁回', () => {
  const ctx = ctxWithHidden([mkHP({ locationId: 'loc-a', revealedTo: ['inv-1'], claimedBy: ['inv-1'] })], { currentLocationId: 'loc-a', actionPoints: 3 }, () => 0.95);
  const r = resolveIntent(makeIntent('investigate_hidden', { pointId: 'hp1' }), ctx);
  assertEq(r.result.outcome, 'rejected');
});

// ─── 搜尋/探索獲卡(支柱6+8 wiring)──────────
function ctxWithPools(slots: ScenarioState['discoverablePools'], invOverrides: Partial<InvestigatorState> = {}, rng?: () => number): RuleContext {
  const base = makeCtx(invOverrides);
  return { ...base, scenario: { ...base.scenario, discoverablePools: slots }, rng };
}

test('搜尋:地點無可發現資源 → 駁回,不耗行動點', () => {
  const ctx = ctxWithPools([], { currentLocationId: 'loc-a', actionPoints: 3 });
  const r = resolveIntent(makeIntent('search'), ctx);
  assertEq(r.result.outcome, 'rejected');
  assertEq(r.newState, undefined);
});

test('搜尋:成功 → discover_card + 卡進棄牌堆 + 槽位標記已拿', () => {
  const ctx = ctxWithPools(
    [{ id: 'loc-a__disc__0', locationId: 'loc-a', cardInstanceId: 'disc1', takenBy: null }],
    { currentLocationId: 'loc-a', actionPoints: 3, discardPile: [] }, () => 0.95,
  );
  const r = resolveIntent(makeIntent('search'), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.actionPoints, 2);
  assertEq((r.result.effects ?? []).some((e) => e.type === 'discover_card'), true);
  assertEq(r.newState?.investigator?.discardPile.includes('disc1'), true);
  assertEq(r.newState?.scenario?.discoverablePools?.[0].takenBy, 'inv-1');
});

test('搜尋:失敗 → search_fail,不獲卡(仍耗行動點)', () => {
  const ctx = ctxWithPools(
    [{ id: 'loc-a__disc__0', locationId: 'loc-a', cardInstanceId: 'disc1', takenBy: null }],
    { currentLocationId: 'loc-a', actionPoints: 3, discardPile: [] }, () => 0,
  );
  const r = resolveIntent(makeIntent('search'), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.actionPoints, 2);
  assertEq((r.result.effects ?? []).some((e) => e.type === 'search_fail'), true);
  assertEq(r.newState?.investigator?.discardPile.includes('disc1'), false);
});

test('搜尋:該地點資源已耗盡(takenBy 已設) → 駁回', () => {
  const ctx = ctxWithPools(
    [{ id: 'loc-a__disc__0', locationId: 'loc-a', cardInstanceId: 'disc1', takenBy: 'inv-9' }],
    { currentLocationId: 'loc-a', actionPoints: 3 },
  );
  const r = resolveIntent(makeIntent('search'), ctx);
  assertEq(r.result.outcome, 'rejected');
});

// ─── §10.5 盟友卡 ──────────────────────
const mkAlly = (over: Partial<import('./state').AllyState> = {}) => ({ cardInstanceId: 'a1', name: '老兵', hp: 3, hpMax: 3, san: 1, sanMax: 1, attack: 2, exhausted: false, ...over });
test('盟友:打出 → 獨立 HP/SAN/攻擊力進 allies 陣列', () => {
  const ctx = makeCtx({ hand: ['ally1'], resources: 5 });
  ctx.cardLookup = { ally1: { card_type: 'ally', name_zh: '老兵', ally_hp: 3, ally_san: 1, damage: 2, cost: 2 } };
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'ally1' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.allies?.[0]?.hp, 3);
  assertEq(r.newState?.investigator?.allies?.[0]?.sanMax, 1);
  assertEq(r.newState?.investigator?.allies?.[0]?.attack, 2);
});

test('盟友欄:基準容量 1 → 第二位駁回', () => {
  const ctx = makeCtx({ hand: ['ally2'], resources: 5, allies: [mkAlly({ cardInstanceId: 'a0', name: '舊友' })] });
  ctx.cardLookup = { ally2: { card_type: 'ally', name_zh: '新人', ally_hp: 3, ally_san: 1, cost: 2 } };
  assertEq(resolveIntent(makeIntent('play_card', { cardInstanceId: 'ally2' }), ctx).result.outcome, 'rejected');
});

test('盟友欄:場上「盟友欄+1」卡 → 容量 2,可帶第二位', () => {
  const ctx = makeCtx({ hand: ['ally2'], resources: 5, assetsInPlay: ['banner'], allies: [mkAlly({ cardInstanceId: 'a0' })] });
  ctx.cardLookup = {
    ally2: { card_type: 'ally', name_zh: '新人', ally_hp: 2, ally_san: 2, cost: 2 },
    banner: { card_type: 'asset', effects: [{ trigger_type: 'passive', effect_code: 'ally_slot', effect_params: { amount: 1 } }] },
  };
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'ally2' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.investigator?.allies?.length, 2);
});

test('盟友攻擊:橫置自動命中,扣怪 HP + 該盟友橫置', () => {
  const ctx = makeCtx({ currentLocationId: 'loc-a', actionPoints: 3, allies: [mkAlly()] });
  ctx.scenario.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'def-e1', locationId: 'loc-a', hp: 5, engagedWith: [], modifiers: [] }];
  const r = resolveIntent(makeIntent('ally_attack'), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState?.scenario?.enemies[0].hp, 3, '5 - 攻擊力 2');
  assertEq(r.newState?.investigator?.allies?.[0]?.exhausted, true, '橫置');
  assertEq((r.result.effects ?? []).some((e) => e.type === 'ally_attack'), true);
});

test('盟友攻擊:都橫置 → 駁回', () => {
  const ctx = makeCtx({ currentLocationId: 'loc-a', allies: [mkAlly({ exhausted: true })] });
  ctx.scenario.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'def-e1', locationId: 'loc-a', hp: 5, engagedWith: [], modifiers: [] }];
  assertEq(resolveIntent(makeIntent('ally_attack'), ctx).result.outcome, 'rejected');
});

// ─── G-02 卡片效果擊殺 → 死亡詞綴(Raviel BLOCK 回歸)───
test('事件卡擊殺觸發死亡詞綴(crush 結到非擊殺隊友,排除出牌者)', () => {
  const sc = makeScenario(['loc-a']);
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'def-e1', locationId: 'loc-a', hp: 3, engagedWith: ['inv-1'], modifiers: [] }];
  const inv1 = makeInv({ currentLocationId: 'loc-a', hand: ['ev1'], engagedWith: ['e1'] });
  const inv2 = makeInv({ investigatorId: 'inv-2', currentLocationId: 'loc-a', hp: 7 });
  const ctx: RuleContext = {
    scenario: sc, investigator: inv1, turn: makeTurn(), investigators: { 'inv-1': inv1, 'inv-2': inv2 },
    enemyStats: { 'def-e1': { dc: 10, damage_physical: 3, keywords: ['crush'] } },
    cardLookup: { ev1: { name_zh: '爆裂符', card_type: 'event', cost: 0, effects: [{ trigger_type: 'action', effect_code: 'deal_damage', effect_params: { amount: 3 } }] } },
    rng: rngRoll(2),
  };
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'ev1' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.result.effects!.some((e) => e.type === 'enemy_defeated'), true, '卡片擊殺');
  assertEq(r.result.effects!.some((e) => e.type === 'crush_damage'), true, '死亡詞綴觸發');
  assertEq(r.newState!.updatedAllies?.['inv-2']?.hp, 4, 'inv-2 受 crush 3');
  assertEq(r.newState!.updatedAllies?.['inv-1'], undefined, '出牌者(擊殺者)不被自己擊殺的詞綴誤傷');
});

test('卡片敵控(remove_enemy)對帳多人交戰一致性(Raviel BLOCK 回歸)', () => {
  const sc = makeScenario(['loc-a']);
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'def-e1', locationId: 'loc-a', hp: 5, engagedWith: ['inv-1', 'inv-2'], modifiers: [] }];
  const inv1 = makeInv({ currentLocationId: 'loc-a', hand: ['ev1'], engagedWith: ['e1'] });
  const inv2 = makeInv({ investigatorId: 'inv-2', currentLocationId: 'loc-a', engagedWith: ['e1'] });
  const ctx: RuleContext = {
    scenario: sc, investigator: inv1, turn: makeTurn(), investigators: { 'inv-1': inv1, 'inv-2': inv2 },
    enemyStats: { 'def-e1': { dc: 10 } },
    cardLookup: { ev1: { name_zh: '放逐術', card_type: 'event', cost: 0, effects: [{ trigger_type: 'action', effect_code: 'remove_enemy', effect_params: {} }] } },
    rng: rngRoll(10),
  };
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'ev1' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  assertEq(r.newState!.scenario!.enemies.length, 0, '敵人被放逐');
  assertEq(r.newState!.updatedAllies?.['inv-2']?.engagedWith.length, 0, 'inv-2 殘留交戰被對帳清除');
});

test('卡片 engage_enemy 拉怪:單一交戰,原交戰者被對帳脫離(Raviel BLOCK 回歸)', () => {
  const sc = makeScenario(['loc-a']);
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'def-e1', locationId: 'loc-a', hp: 5, engagedWith: ['inv-2'], modifiers: [] }];
  const inv1 = makeInv({ currentLocationId: 'loc-a', hand: ['ev1'], engagedWith: [] });
  const inv2 = makeInv({ investigatorId: 'inv-2', currentLocationId: 'loc-a', engagedWith: ['e1'] });
  const ctx: RuleContext = {
    scenario: sc, investigator: inv1, turn: makeTurn(), investigators: { 'inv-1': inv1, 'inv-2': inv2 },
    enemyStats: { 'def-e1': { dc: 10 } },
    cardLookup: { ev1: { name_zh: '挑釁', card_type: 'event', cost: 0, effects: [{ trigger_type: 'action', effect_code: 'engage_enemy', effect_params: {} }] } },
    rng: rngRoll(10),
  };
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'ev1' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  const e1 = r.newState!.scenario!.enemies[0];
  assertEq(e1.engagedWith.length, 1, '敵人維持單一交戰');
  assertEq(e1.engagedWith[0], 'inv-1', '改與拉怪者交戰');
  assertEq(r.newState!.updatedAllies?.['inv-2']?.engagedWith.length, 0, '原交戰者 inv-2 被對帳脫離');
});

test('卡片 engage_enemy 對 massive:不誤清多人交戰(Raviel BLOCK 回歸)', () => {
  const sc = makeScenario(['loc-a']);
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'def-big', locationId: 'loc-a', hp: 9, engagedWith: ['inv-2', 'inv-3'], modifiers: [] }];
  const inv1 = makeInv({ currentLocationId: 'loc-a', hand: ['ev1'], engagedWith: [] });
  const inv2 = makeInv({ investigatorId: 'inv-2', currentLocationId: 'loc-a', engagedWith: ['e1'] });
  const inv3 = makeInv({ investigatorId: 'inv-3', currentLocationId: 'loc-a', engagedWith: ['e1'] });
  const ctx: RuleContext = {
    scenario: sc, investigator: inv1, turn: makeTurn(), investigators: { 'inv-1': inv1, 'inv-2': inv2, 'inv-3': inv3 },
    enemyStats: { 'def-big': { dc: 10, keywords: ['massive'] } },
    cardLookup: { ev1: { name_zh: '挑釁', card_type: 'event', cost: 0, effects: [{ trigger_type: 'action', effect_code: 'engage_enemy', effect_params: {} }] } },
    rng: rngRoll(10),
  };
  const r = resolveIntent(makeIntent('play_card', { cardInstanceId: 'ev1' }), ctx);
  assertEq(r.result.outcome, 'accepted');
  const e1 = r.newState!.scenario!.enemies[0];
  assertEq(e1.engagedWith.includes('inv-2'), true, 'massive 保留 inv-2');
  assertEq(e1.engagedWith.includes('inv-3'), true, 'massive 保留 inv-3');
  assertEq(e1.engagedWith.includes('inv-1'), true, 'massive 也納入拉怪者');
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
