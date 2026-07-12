import { feedbackTargetsLocation } from './locationActionFeedback';

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

const moving = { key: 'move', targetLocationId: 'downtown' };
assertEq(feedbackTargetsLocation(moving, 'move', 'downtown'), true, 'movement feedback stays on destination');
assertEq(feedbackTargetsLocation(moving, 'move', 'library'), false, 'movement feedback does not reveal unreachable location');
assertEq(feedbackTargetsLocation(moving, 'investigate', 'downtown'), false, 'different action does not match');
assertEq(feedbackTargetsLocation({ key: 'investigate' }, 'investigate', 'library'), true, 'investigate feedback remains at current location');

console.log('4 passed, 0 failed');
