/**
 * G-03 怪物行為腳本單元測試 — 對齊 s14 補充文件 #2
 */
import {
  evaluateTrigger,
  pickMoveByBehavior,
  pickTargetByPreference,
  tickCooldowns,
  recordMoveUse,
} from './monsterBehavior';
import type { BehaviorScript, AttackCardLookup } from './monsterBehavior';
import type { EnemyInstance, InvestigatorState, LocationInstance } from './state';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

const CARDS: AttackCardLookup = {
  opener: { code: 'opener', name_zh: '開場招', defense_attribute: 'willpower', damage_horror: 3, damage_physical: 0 },
  hunt: { code: 'hunt', name_zh: '攻心招', defense_attribute: 'willpower', damage_horror: 4, damage_physical: 0 },
  claw: { code: 'claw', name_zh: '利爪', defense_attribute: 'reflex', damage_physical: 2, damage_horror: 0 },
  rage: { code: 'rage', name_zh: '兇暴', defense_attribute: 'strength', damage_physical: 4, damage_horror: 1 },
};

function makeEnemy(over: Partial<EnemyInstance> = {}): EnemyInstance {
  return { instanceId: 'e1', enemyDefinitionId: 'boss', locationId: 'A', hp: 20, engagedWith: [], modifiers: [], ...over };
}

function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'inv-1', investigatorDefinitionId: 'd', ownerPlayerId: 'p',
    attributes: { strength: 3, agility: 3, constitution: 3, reflex: 3, intellect: 3, willpower: 3, perception: 3, charisma: 3 },
    combatStyle: '', specializations: [], deck: [], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 7, hpMax: 7, san: 7, sanMax: 7, actionPoints: 3, resources: 0, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}

const ctx = (over: Partial<{ turnNumber: number; selfHp: number; selfMaxHp: number; target: InvestigatorState; rng: () => number }> = {}) => ({
  turnNumber: 1, selfHp: 20, selfMaxHp: 20, target: makeInv(), rng: () => 0.5, ...over,
});

// ─── 觸發條件求值(§3)─────────────────────────
test('turn_count / hp_percent / san_percent 求值', () => {
  const e = makeEnemy();
  assertEq(evaluateTrigger({ type: 'turn_count', operator: '=', value: 1 }, e, ctx()), true);
  assertEq(evaluateTrigger({ type: 'hp_percent', operator: '<=', value: 50 }, e, ctx({ selfHp: 8 })), true);
  assertEq(evaluateTrigger({ type: 'hp_percent', operator: '<=', value: 50 }, e, ctx({ selfHp: 15 })), false);
  assertEq(evaluateTrigger({ type: 'san_percent', operator: '>=', value: 80 }, e, ctx({ target: makeInv({ san: 6 }) })), true);
});

test('last_move / and-or 組合求值', () => {
  const e = makeEnemy({ modifiers: ['bs:last:claw'] });
  assertEq(evaluateTrigger({ type: 'last_move', operator: '=', value: 'claw' }, e, ctx()), true);
  assertEq(evaluateTrigger({ type: 'last_move', operator: '!=', value: 'claw' }, e, ctx()), false);
  assertEq(
    evaluateTrigger(
      { type: 'and', conditions: [{ type: 'turn_count', operator: '>=', value: 1 }, { type: 'hp_percent', operator: '>', value: 10 }] },
      e, ctx(),
    ),
    true,
  );
});

test('未知條件型別:保守不觸發', () => {
  assertEq(evaluateTrigger({ type: 'player_status' as never, value: 'x' }, makeEnemy(), ctx()), false);
});

// ─── conditional 模式(§2.3)──────────────────
const CONDITIONAL_SCRIPT: BehaviorScript = {
  moves: [
    { code: 'opener', trigger_condition: { type: 'turn_count', operator: '=', value: 1 }, forced: true, priority: 1, cooldown: 'permanent' },
    { code: 'hunt', trigger_condition: { type: 'san_percent', operator: '>=', value: 80 }, priority: 2 },
    { code: 'claw', priority: 3 },
  ],
};

test('conditional:首回合強制招優先', () => {
  const r = pickMoveByBehavior(makeEnemy(), 'conditional', CONDITIONAL_SCRIPT, [], CARDS, ctx());
  assertEq(r.card?.code, 'opener');
  // permanent 冷卻已記錄
  assertEq(r.modifiers.some((m) => m.includes('bs:cd:opener:permanent')), true);
});

test('conditional:開場招永久冷卻後,SAN 高 → 攻心招', () => {
  const e = makeEnemy({ modifiers: ['bs:cd:opener:permanent', 'bs:last:opener'] });
  const r = pickMoveByBehavior(e, 'conditional', CONDITIONAL_SCRIPT, [], CARDS, ctx({ turnNumber: 2, target: makeInv({ san: 7 }) }));
  assertEq(r.card?.code, 'hunt');
});

test('conditional:SAN 低 → 落到標準招', () => {
  const e = makeEnemy({ modifiers: ['bs:cd:opener:permanent'] });
  const r = pickMoveByBehavior(e, 'conditional', CONDITIONAL_SCRIPT, [], CARDS, ctx({ turnNumber: 3, target: makeInv({ san: 2 }) }));
  assertEq(r.card?.code, 'claw');
});

// ─── phase_based 模式(§2.4)──────────────────
const PHASE_SCRIPT: BehaviorScript = {
  phases: [
    { code: 'calm', moves: [{ code: 'claw' }] },
    { code: 'enraged', transition: { type: 'hp_percent', operator: '<=', value: 50 }, moves: [{ code: 'rage' }] },
  ],
};

test('phase_based:HP 過半用第一階段,低於 50% 切換兇暴並回報', () => {
  const e = makeEnemy();
  const calm = pickMoveByBehavior(e, 'phase_based', PHASE_SCRIPT, [], CARDS, ctx({ selfHp: 18 }));
  assertEq(calm.card?.code, 'claw');
  const e2 = makeEnemy({ modifiers: ['bs:phase:calm'] });
  const enraged = pickMoveByBehavior(e2, 'phase_based', PHASE_SCRIPT, [], CARDS, ctx({ selfHp: 8 }));
  assertEq(enraged.card?.code, 'rage');
  assertEq(enraged.phaseChanged, 'enraged');
});

// ─── pure_random / fallback ─────────────────
test('pure_random:等機率取池(忽略 weight)', () => {
  const pool = [{ code: 'claw', weight: 100 }, { code: 'hunt', weight: 1 }];
  // rng 0.9 → 取第二個(等機率下 idx=1);加權下幾乎必為 claw
  const r = pickMoveByBehavior(makeEnemy(), 'pure_random', null, pool, CARDS, ctx({ rng: () => 0.9 }));
  assertEq(r.card?.code, 'hunt');
});

test('conditional 無可用招 → fallback 加權招式池', () => {
  const script: BehaviorScript = { moves: [{ code: 'opener', trigger_condition: { type: 'turn_count', operator: '=', value: 99 } }] };
  const r = pickMoveByBehavior(makeEnemy(), 'conditional', script, [{ code: 'claw', weight: 1 }], CARDS, ctx());
  assertEq(r.card?.code, 'claw');
});

// ─── 冷卻簿記 ───────────────────────────────
test('tickCooldowns:數字遞減歸零移除,permanent 不動', () => {
  const m = tickCooldowns(['bs:cd:hunt:2', 'bs:cd:claw:1', 'bs:cd:opener:permanent', 'other']);
  assertEq(m.includes('bs:cd:hunt:1'), true);
  assertEq(m.some((x) => x.startsWith('bs:cd:claw:')), false);
  assertEq(m.includes('bs:cd:opener:permanent'), true);
  assertEq(m.includes('other'), true);
});

test('tickCooldown=false:多段攻擊不重複遞減(BLOCK 回歸)', () => {
  const e = makeEnemy({ modifiers: ['bs:cd:hunt:2'] });
  // 第二擊(tick=false):hunt 冷卻維持 2,不遞減
  const r = pickMoveByBehavior(e, 'weighted', null, [{ code: 'claw', weight: 1 }], CARDS, ctx(), false);
  assertEq(r.modifiers.includes('bs:cd:hunt:2'), true, '冷卻不動');
  assertEq(r.card?.code, 'claw');
});

test('recordMoveUse:覆寫上一招', () => {
  const m = recordMoveUse(['bs:last:claw'], 'hunt', 2);
  assertEq(m.includes('bs:last:hunt'), true);
  assertEq(m.includes('bs:last:claw'), false);
  assertEq(m.includes('bs:cd:hunt:2'), true);
});

// ─── 追擊偏好(§10.5)─────────────────────────
test('追擊偏好:lowest_san / highest_san(獵清醒者)/ nearest', () => {
  const locations: LocationInstance[] = [
    { locationDefinitionId: 'A', visibility: 'day', connectedTo: ['B'], isObstacle: false },
    { locationDefinitionId: 'B', visibility: 'day', connectedTo: ['A', 'C'], isObstacle: false },
    { locationDefinitionId: 'C', visibility: 'day', connectedTo: ['B'], isObstacle: false },
  ];
  const a = makeInv({ investigatorId: 'a', san: 2, currentLocationId: 'C' });
  const b = makeInv({ investigatorId: 'b', san: 7, currentLocationId: 'B' });
  const e = makeEnemy({ locationId: 'A' });
  assertEq(pickTargetByPreference('lowest_san', null, e, [a, b], locations, () => 0)?.investigatorId, 'a');
  assertEq(pickTargetByPreference('highest_san', null, e, [a, b], locations, () => 0)?.investigatorId, 'b');
  assertEq(pickTargetByPreference('nearest', null, e, [a, b], locations, () => 0)?.investigatorId, 'b');
  assertEq(pickTargetByPreference('未知偏好', null, e, [a, b], locations, () => 0)?.investigatorId, 'b', '不支援值 fallback nearest');
});

// ─── runner ─────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
