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

// ─── runner ─────────────────────────
let passed = 0; let failed = 0; const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
