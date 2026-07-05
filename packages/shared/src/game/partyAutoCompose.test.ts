import {
  autoComposeParty,
  isAutoPartyHarvester,
  isAutoPartyOutput,
} from './partyAutoCompose';
import type { AutoPartyCandidate } from './partyAutoCompose';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function c(
  id: string,
  faction: string,
  over: Partial<AutoPartyCandidate> = {},
): AutoPartyCandidate {
  return {
    id,
    code: id,
    faction_code: faction,
    name_zh: id,
    title_zh: id,
    attr_perception: 2,
    proficiency_ids: [],
    ...over,
  };
}

function ids(list: AutoPartyCandidate[]): string {
  return list.map((m) => m.id).join(',');
}

test('E13 auto party prefers three AI factions distinct from player', () => {
  const player = c('p', 'E');
  const result = autoComposeParty(player, [
    c('same-e', 'E', { attr_perception: 4, proficiency_ids: ['shooting'] }),
    c('i', 'I', { attr_perception: 4 }),
    c('s', 'S', { proficiency_ids: ['shooting'] }),
    c('n', 'N'),
  ], 0);
  assertEq(result.members.length, 3);
  assert(!result.members.some((m) => m.faction_code === 'E'), 'player faction should be avoided when enough candidates exist');
  assertEq(new Set(result.members.map((m) => m.faction_code)).size, 3, 'AI factions should be distinct');
});

test('E13 auto party keeps one harvester and one output role when possible', () => {
  const player = c('p', 'E');
  const result = autoComposeParty(player, [
    c('harvester', 'I', { attr_perception: 4 }),
    c('output', 'S', { proficiency_ids: ['military'] }),
    c('flex', 'N'),
    c('other', 'T'),
  ], 0);
  assert(result.members.some(isAutoPartyHarvester), 'expected at least one perception >=4 teammate');
  assert(result.members.some(isAutoPartyOutput), 'expected at least one output teammate');
  assertEq(result.relaxed, false);
});

test('E13 auto party is deterministic for the same seed', () => {
  const player = c('p', 'E');
  const candidates = [
    c('i', 'I', { attr_perception: 4, proficiency_ids: ['shooting'] }),
    c('s', 'S', { attr_perception: 4, proficiency_ids: ['shooting'] }),
    c('n', 'N', { attr_perception: 4, proficiency_ids: ['shooting'] }),
    c('t', 'T', { attr_perception: 4, proficiency_ids: ['shooting'] }),
  ];
  assertEq(ids(autoComposeParty(player, candidates, 7).members), ids(autoComposeParty(player, candidates, 7).members));
});

test('E13 auto party seed plus one can rotate among equal best teams', () => {
  const player = c('p', 'E');
  const candidates = [
    c('i', 'I', { attr_perception: 4, proficiency_ids: ['shooting'] }),
    c('s', 'S', { attr_perception: 4, proficiency_ids: ['shooting'] }),
    c('n', 'N', { attr_perception: 4, proficiency_ids: ['shooting'] }),
    c('t', 'T', { attr_perception: 4, proficiency_ids: ['shooting'] }),
  ];
  const a = ids(autoComposeParty(player, candidates, 0).members);
  const b = ids(autoComposeParty(player, candidates, 1).members);
  assert(a !== b, `expected seed variation, got ${a}`);
});

test('E13 auto party relaxes diversity when candidate pool cannot satisfy it', () => {
  const player = c('p', 'E');
  const result = autoComposeParty(player, [
    c('e1', 'E', { attr_perception: 4 }),
    c('e2', 'E', { proficiency_ids: ['brawl'] }),
    c('i', 'I'),
  ], 0);
  assertEq(result.members.length, 3);
  assert(result.relaxed, 'expected relaxed result with insufficient faction diversity');
  assert(result.reasons.includes('diversity_relaxed'), 'expected diversity_relaxed reason');
});

let passed = 0;
let failed = 0;
const failures: string[] = [];
for (const t of tests) {
  try {
    t.fn();
    console.log('✓ ' + t.name);
    passed += 1;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('✗ ' + t.name + '\n   ' + msg);
    failed += 1;
    failures.push(t.name);
  }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
