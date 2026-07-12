import {
  archetypeForInvestigator,
  lobbySeatAssetForInvestigator,
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
  'missing career code falls back to anonymous archetype',
);

assertEq(
  pawnAssetForInvestigator({ code: 'ENFJ-1', title_zh: '社區護士' }),
  '/game-art/pawns/v2/enfj-1-p1.webp',
  'career code selects the player-one pawn',
);

assertEq(
  pawnAssetForInvestigator({ code: 'istp-4' }, 3),
  '/game-art/pawns/v2/istp-4-p4.webp',
  'career code and player slot select the fourth pawn color',
);

assertEq(
  lobbySeatAssetForInvestigator({ title_zh: '巡警' }, 2),
  '/game-art/lobby-v4/seat-2-watchman.webp',
  'lobby seat uses the shared anonymous archetype',
);

console.log('10 passed, 0 failed');
