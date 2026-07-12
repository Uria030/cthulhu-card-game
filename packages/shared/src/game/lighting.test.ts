import { hasLineOfSight, illuminatedLocationIds } from './lighting';
import { visibilityModifierAtLocation } from './checks';
import type { ScenarioState } from './state';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function nightBoard(): ScenarioState {
  return {
    scenarioId: 's', scenarioDefinitionId: 'sd', campaignId: 'c', unlockedLocations: ['A', 'B', 'C'],
    locations: [
      { locationDefinitionId: 'A', visibility: 'night', connectedTo: ['B'], isObstacle: false },
      { locationDefinitionId: 'B', visibility: 'night', connectedTo: ['A', 'C'], isObstacle: false },
      { locationDefinitionId: 'C', visibility: 'darkness', connectedTo: ['B'], isObstacle: false },
    ],
    enemies: [], tokens: [], agendaProgress: 0, objectiveProgress: 0, chaosBag: [], turnNumber: 1, phase: 'investigator',
  };
}

test('夜間與黑暗必須由板塊光源覆蓋才有視線', () => {
  const scenario = nightBoard();
  assertEq(hasLineOfSight(scenario, 'A'), false);
  assertEq(hasLineOfSight(scenario, 'C'), false);
  assertEq(visibilityModifierAtLocation('attack', scenario, 'A'), -2);
  assertEq(visibilityModifierAtLocation('evade', scenario, 'A'), 2);
});

test('光源以物件為中心，半徑沿地圖連線展開', () => {
  const scenario: ScenarioState = {
    ...nightBoard(),
    lightSources: [{ id: 'lantern', sourceCardInstanceId: 'asset-1', locationId: 'A', radius: 1 }],
  };
  assertEq(hasLineOfSight(scenario, 'A'), true, '照亮自身');
  assertEq(hasLineOfSight(scenario, 'B'), true, '照亮相鄰地點');
  assertEq(hasLineOfSight(scenario, 'C'), false, '不跨越兩格');
  assertEq(illuminatedLocationIds(scenario).join(','), 'A,B');
  assertEq(visibilityModifierAtLocation('attack', scenario, 'B'), 0);
  assertEq(visibilityModifierAtLocation('evade', scenario, 'B'), 0);
});

test('日間與火焰維持可見，與光源物件並存', () => {
  const scenario: ScenarioState = {
    ...nightBoard(),
    locations: [
      { locationDefinitionId: 'A', visibility: 'day', connectedTo: ['B'], isObstacle: false },
      { locationDefinitionId: 'B', visibility: 'fire', connectedTo: ['A', 'C'], isObstacle: false },
      { locationDefinitionId: 'C', visibility: 'night', connectedTo: ['B'], isObstacle: false },
    ],
  };
  assertEq(hasLineOfSight(scenario, 'A'), true);
  assertEq(hasLineOfSight(scenario, 'B'), true);
  assertEq(hasLineOfSight(scenario, 'C'), false);
});

let passed = 0;
let failed = 0;
const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
