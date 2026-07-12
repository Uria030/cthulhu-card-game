import {
  archetypeForInvestigator,
  pawnAssetForInvestigator,
} from './investigatorVisuals';

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

const cases = [
  ['密碼學家', 'archivist'],
  ['社區護士', 'healer'],
  ['機械修理工', 'craftsperson'],
  ['巡警', 'watchman'],
  ['流浪舞者', 'performer'],
  ['神祕學者', 'mystic'],
] as const;

for (const [title_zh, expected] of cases) {
  assertEq(archetypeForInvestigator({ title_zh }), expected, title_zh);
}

assertEq(
  pawnAssetForInvestigator({ title_zh: '社區護士' }),
  '/game-art/pawns/archetypes/healer.png',
  'archetype asset is deterministic',
);

console.log('7 passed, 0 failed');
