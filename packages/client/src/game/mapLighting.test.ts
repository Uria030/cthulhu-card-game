import { lightingForLocation } from './mapLighting';
import type { ScenarioState } from '@cthulhu/shared';

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected=${String(expected)}, actual=${String(actual)}`);
}

const scenario: Pick<ScenarioState, 'locations' | 'lightSources'> = {
  locations: [
    { locationDefinitionId: 'A', visibility: 'night', connectedTo: ['B'], isObstacle: false },
    { locationDefinitionId: 'B', visibility: 'darkness', connectedTo: ['A', 'C'], isObstacle: false },
    { locationDefinitionId: 'C', visibility: 'night', connectedTo: ['B'], isObstacle: false },
  ],
  lightSources: [{ id: 'lamp-a', sourceCardInstanceId: 'asset-1', locationId: 'A', radius: 1 }],
};

const ownTile = lightingForLocation(scenario, 'A');
assertEq(ownTile.illuminated, true, '來源地點應標示已照明');
assertEq(ownTile.sources.length, 1, '來源地點應顯示實體光源標記');
assertEq(ownTile.sources[0].radius, 1, '地圖應保留既有半徑資料');

const coveredTile = lightingForLocation(scenario, 'B');
assertEq(coveredTile.illuminated, true, '相鄰地點應顯示被光源覆蓋');
assertEq(coveredTile.sources.length, 0, '被照亮不等於有光源物件');

const darkTile = lightingForLocation(scenario, 'C');
assertEq(darkTile.illuminated, false, '半徑外地點不可誤標為照明');

console.log('3 passed, 0 failed');
