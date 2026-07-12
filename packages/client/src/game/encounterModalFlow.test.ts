import { autoEncounterTransition, encounterAutoDelay } from './encounterModalFlow';

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

assertEq(autoEncounterTransition(1), 'advance', 'narration beat advances automatically');
assertEq(autoEncounterTransition(2), null, 'choice beat waits for the player');
assertEq(autoEncounterTransition(3), 'complete', 'result beat completes automatically');
assertEq(encounterAutoDelay(1), 1_150, 'narration delay stays paced');
assertEq(encounterAutoDelay(2), null, 'choice beat has no timer');
assertEq(encounterAutoDelay(3), 1_450, 'result delay stays readable');

console.log('6 passed, 0 failed');
