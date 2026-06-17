/**
 * G-02 卡片效果執行器測試 — add_status / remove_status 接 statusEffects(ch3 §6)
 */
import { executeCardEffects } from './effectsExecutor';
import type { CardEffectRow } from './effectsExecutor';
import type { InvestigatorState, ScenarioState, EnemyInstance } from './state';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'i1', investigatorDefinitionId: 'd', ownerPlayerId: 'p',
    attributes: { strength: 2, agility: 2, constitution: 2, reflex: 2, intellect: 2, willpower: 2, perception: 2, charisma: 2 },
    combatStyle: '', specializations: [], deck: [], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 9, hpMax: 9, san: 9, sanMax: 9, actionPoints: 3, resources: 0, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}
function makeEnemy(over: Partial<EnemyInstance> = {}): EnemyInstance {
  return { instanceId: 'e1', enemyDefinitionId: 'def', locationId: 'A', hp: 5, engagedWith: [], modifiers: [], ...over };
}
function makeScenario(enemies: EnemyInstance[] = []): ScenarioState {
  return {
    scenarioId: 's', scenarioDefinitionId: 'sd', campaignId: 'c',
    locations: [], unlockedLocations: [], enemies, tokens: [],
    agendaProgress: 0, objectiveProgress: 0, chaosBag: [], turnNumber: 1, phase: 'investigator',
  };
}
function fx(effect_code: string, effect_params: Record<string, unknown> = {}): CardEffectRow {
  return { trigger_type: 'action', effect_code, effect_params };
}

test('add_status target=self → 寫入自身 statusEffects', () => {
  const r = executeCardEffects([fx('add_status', { status: 'armor', layers: 2, target: 'self' })], makeInv(), makeScenario(), {});
  assertEq(r.investigator.statusEffects?.armor, 2);
  assertEq(r.effects.some((e) => e.type === 'status_applied'), true);
});

test('add_status(預設對敵) → 寫入同地點敵人 statusEffects', () => {
  const r = executeCardEffects([fx('add_status', { status: 'marked', layers: 1 })], makeInv(), makeScenario([makeEnemy()]), {});
  assertEq(r.scenario.enemies[0].statusEffects?.marked, 1);
});

test('add_status 讀 stacks 多層 + 別名收斂(真實卡面 {status:burn,stacks:3})', () => {
  const r = executeCardEffects([fx('add_status', { status: 'burn', stacks: 3 })], makeInv(), makeScenario([makeEnemy()]), {});
  assertEq(r.scenario.enemies[0].statusEffects?.burning, 3, 'stacks=3 + burn→burning');
});

test('add_status:無同地點敵人 → unsupported(不結算)', () => {
  const r = executeCardEffects([fx('add_status', { status: 'marked' })], makeInv(), makeScenario([]), {});
  assertEq(r.unsupported.some((u) => u.includes('add_status')), true);
});

test('remove_status(未指定) → 淨化所有負面,保留正面', () => {
  const r = executeCardEffects([fx('remove_status')], makeInv({ statusEffects: { poison: 2, bleed: 1, armor: 3 } }), makeScenario(), {});
  assertEq(r.investigator.statusEffects?.poison ?? 0, 0);
  assertEq(r.investigator.statusEffects?.bleed ?? 0, 0);
  assertEq(r.investigator.statusEffects?.armor, 3, '正面狀態保留');
});

test('remove_status(指定) → 只移除該狀態', () => {
  const r = executeCardEffects([fx('remove_status', { status: 'poison' })], makeInv({ statusEffects: { poison: 2, bleed: 1 } }), makeScenario(), {});
  assertEq(r.investigator.statusEffects?.poison ?? 0, 0);
  assertEq(r.investigator.statusEffects?.bleed, 1, '其他狀態保留');
});

// ─── P0 補完:治療 / 恐懼 / 資源 ─────────────
test('heal_hp:回復當前 HP,夾在上限', () => {
  const r = executeCardEffects([fx('heal_hp', { amount: 5 })], makeInv({ hp: 3, hpMax: 9 }), makeScenario(), {});
  assertEq(r.investigator.hp, 8, '3+5');
  const cap = executeCardEffects([fx('heal_hp', { amount: 5 })], makeInv({ hp: 7, hpMax: 9 }), makeScenario(), {});
  assertEq(cap.investigator.hp, 9, '夾在 hpMax');
  assertEq(r.effects.some((e) => e.type === 'heal_hp'), true);
});

test('heal_san:回復當前 SAN,夾在上限', () => {
  const r = executeCardEffects([fx('heal_san', { amount: 4 })], makeInv({ san: 2, sanMax: 9 }), makeScenario(), {});
  assertEq(r.investigator.san, 6);
  const cap = executeCardEffects([fx('heal_san', { amount: 9 })], makeInv({ san: 8, sanMax: 9 }), makeScenario(), {});
  assertEq(cap.investigator.san, 9, '夾在 sanMax');
});

test('deal_horror:對自身扣 SAN(不破 0)', () => {
  const r = executeCardEffects([fx('deal_horror', { amount: 3 })], makeInv({ san: 5 }), makeScenario(), {});
  assertEq(r.investigator.san, 2);
  assertEq(r.effects.some((e) => e.type === 'fear_damage'), true);
  const floor = executeCardEffects([fx('deal_horror', { amount: 9 })], makeInv({ san: 2 }), makeScenario(), {});
  assertEq(floor.investigator.san, 0, '夾在 0');
});

test('spend_resource:扣資源不破 0', () => {
  assertEq(executeCardEffects([fx('spend_resource', { amount: 2 })], makeInv({ resources: 5 }), makeScenario(), {}).investigator.resources, 3);
  assertEq(executeCardEffects([fx('spend_resource', { amount: 9 })], makeInv({ resources: 2 }), makeScenario(), {}).investigator.resources, 0);
});

// ─── runner ─────────────────────────
let passed = 0; let failed = 0; const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
