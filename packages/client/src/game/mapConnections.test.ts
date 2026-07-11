import { uniqueLocationConnections } from './mapConnections';
import type { LocationInstance } from '@cthulhu/shared';

const locations: LocationInstance[] = [
  { locationDefinitionId: 'A', visibility: 'night', connectedTo: ['B'], isObstacle: false },
  { locationDefinitionId: 'B', visibility: 'night', connectedTo: ['A', 'C'], isObstacle: false },
  { locationDefinitionId: 'C', visibility: 'night', connectedTo: ['B'], isObstacle: true },
];
const result = uniqueLocationConnections(locations);
if (result.length !== 2) throw new Error('雙向相鄰被重複繪製');
if (!result.find((edge) => edge.to === 'C')?.blocked) throw new Error('障礙連線未標記');
console.log('1 passed, 0 failed');
