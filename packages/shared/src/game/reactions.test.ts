import {
  findReactionCandidates,
  openReactionWindow,
  resolvePendingReaction,
} from './reactions';
import type { InvestigatorState } from './state';
import type { CardDataLookup } from './ruleEngine';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) throw new Error((message ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'i1', investigatorDefinitionId: 'd1', ownerPlayerId: 'p1',
    attributes: { strength: 2, agility: 2, constitution: 2, reflex: 2, intellect: 2, willpower: 2, perception: 2, charisma: 2 },
    combatStyle: '', specializations: [], deck: [], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 8, hpMax: 8, san: 8, sanMax: 8, actionPoints: 3, resources: 3, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}

const LOOKUP: CardDataLookup = {
  bandage: {
    name_zh: '軍醫止血', card_type: 'event', cost: 2,
    effects: [{ trigger_type: 'reaction', condition: 'before_take_damage', effect_code: 'heal_hp', effect_params: { amount: 2 } }],
  },
  charm: {
    name_zh: '護身符', card_type: 'asset', uses: 2,
    effects: [{ trigger_type: 'reaction', condition: { event: 'before_take_horror' }, cost: { uses: 1, exhaust_self: true }, effect_code: 'heal_san', effect_params: { amount: 1 } }],
  },
  extra_guard: {
    name_zh: '額外防線', card_type: 'event', cost: 1, is_extra: true,
    effects: [{ trigger_type: 'reaction', condition: 'before_take_damage', effect_code: 'heal_hp', effect_params: { amount: 1 } }],
  },
  wrong: {
    name_zh: '時機不對', card_type: 'event', cost: 0,
    effects: [{ trigger_type: 'reaction', condition: 'before_take_horror', effect_code: 'heal_san', effect_params: { amount: 9 } }],
  },
  unsupported: {
    name_zh: '不明反應', card_type: 'event', cost: 0,
    effects: [{ trigger_type: 'reaction', condition: 'before_take_damage', effect_code: 'draw_card', effect_params: { amount: 1 } }],
  },
};

test('傷害窗口:只列匹配且可預防的 reaction 卡', () => {
  const inv = makeInv({ hand: ['bandage', 'wrong', 'unsupported'] });
  const candidates = findReactionCandidates(inv, LOOKUP, { kind: 'damage', amount: 3 });
  assertEq(candidates.length, 1);
  assertEq(candidates[0].cardInstanceId, 'bandage');
  assertEq(candidates[0].resourceCost, 2);
});

test('候選資格:資源不足、用途用盡或已橫置的卡不開反應窗', () => {
  const resourceShort = makeInv({ hand: ['bandage'], resources: 1 });
  assertEq(openReactionWindow('r-short', resourceShort, LOOKUP, { kind: 'damage', amount: 3 }), null);
  const usedUp = makeInv({ assetsInPlay: ['charm'], assetState: { charm: { usesLeft: 0, exhausted: false } } });
  assertEq(openReactionWindow('r-used-up', usedUp, LOOKUP, { kind: 'horror', amount: 2 }), null);
  const exhausted = makeInv({ assetsInPlay: ['charm'], assetState: { charm: { usesLeft: 1, exhausted: true } } });
  assertEq(openReactionWindow('r-exhausted', exhausted, LOOKUP, { kind: 'horror', amount: 2 }), null);
});

test('手牌 reaction:零 AP、付資源、棄牌、先減傷後結算原 operation', () => {
  const inv = makeInv({ hand: ['bandage'] });
  const pending = openReactionWindow('r1', inv, LOOKUP, { kind: 'damage', amount: 3, source: '伏擊' });
  if (!pending) throw new Error('expected pending reaction');
  const r = resolvePendingReaction(pending, { kind: 'play', cardInstanceId: 'bandage', effectIndex: 0 }, inv);
  assertEq(r.outcome, 'played');
  assertEq(r.investigator.hp, 7, '3 傷害被防 2');
  assertEq(r.investigator.resources, 1, '支付卡片資源費');
  assertEq(r.investigator.actionPoints, 3, 'reaction 不花 AP');
  assertEq(r.investigator.hand.includes('bandage'), false);
  assertEq(r.investigator.discardPile.includes('bandage'), true);
  assertEq(r.triggeredCardInstanceId, 'bandage');
});

test('場上資產 reaction:扣 uses、橫置，且不移出場', () => {
  const inv = makeInv({ assetsInPlay: ['charm'], assetState: { charm: { usesLeft: 2, exhausted: false } } });
  const pending = openReactionWindow('r2', inv, LOOKUP, { kind: 'horror', amount: 2 });
  if (!pending) throw new Error('expected pending reaction');
  const r = resolvePendingReaction(pending, { kind: 'play', cardInstanceId: 'charm', effectIndex: 0 }, inv);
  assertEq(r.outcome, 'played');
  assertEq(r.investigator.san, 7, '2 恐懼被防 1');
  assertEq(r.investigator.assetState?.charm.usesLeft, 1);
  assertEq(r.investigator.assetState?.charm.exhausted, true);
  assertEq(r.investigator.assetsInPlay.includes('charm'), true);
});

test('額外牌組 reaction:可零 AP 打出、付費後離開額外牌組', () => {
  const inv = makeInv({ extraDeck: ['extra_guard'] });
  const pending = openReactionWindow('r-extra', inv, LOOKUP, { kind: 'damage', amount: 2 });
  if (!pending) throw new Error('expected pending reaction');
  const r = resolvePendingReaction(pending, { kind: 'play', cardInstanceId: 'extra_guard', effectIndex: 0 }, inv);
  assertEq(r.outcome, 'played');
  assertEq(r.investigator.hp, 7);
  assertEq(r.investigator.resources, 2);
  assertEq(r.investigator.extraDeck?.includes('extra_guard'), false);
  assertEq(r.investigator.discardPile.includes('extra_guard'), true);
  assertEq(r.investigator.actionPoints, 3);
});

test('reaction 結算沿用盟友分傷，direct 仍不可分配', () => {
  const ally = { cardInstanceId: 'ally-1', name: '肉盾', hp: 2, hpMax: 2, san: 1, sanMax: 1, attack: 1, exhausted: false };
  const ordinary = resolvePendingReaction(
    { id: 'r-ally', targetInvestigatorId: 'i1', trigger: 'before_take_damage', operation: { kind: 'damage', amount: 2 }, candidates: [] },
    { kind: 'pass' },
    makeInv({ allies: [ally] }),
  );
  assertEq(ordinary.effects.some((effect) => effect.type === 'damage_allocatable'), true, '非 direct 傷害保留分傷提示');
  const direct = resolvePendingReaction(
    { id: 'r-direct', targetInvestigatorId: 'i1', trigger: 'before_take_damage', operation: { kind: 'damage', amount: 2, direct: true }, candidates: [] },
    { kind: 'pass' },
    makeInv({ allies: [ally] }),
  );
  assertEq(direct.effects.some((effect) => effect.type === 'damage_allocatable'), false, 'direct 不可分配');
});

test('pass 與重送防護:pass 完整結算，已觸發卡不可重複使用', () => {
  const inv = makeInv({ hand: ['bandage'] });
  const pending = openReactionWindow('r3', inv, LOOKUP, { kind: 'damage', amount: 3 });
  if (!pending) throw new Error('expected pending reaction');
  const pass = resolvePendingReaction(pending, { kind: 'pass' }, inv);
  assertEq(pass.outcome, 'passed');
  assertEq(pass.investigator.hp, 5);
  const duplicate = resolvePendingReaction(pending, { kind: 'play', cardInstanceId: 'bandage', effectIndex: 0 }, inv, ['bandage']);
  assertEq(duplicate.outcome, 'invalid');
  assertEq(duplicate.reason, 'already_triggered');
});

let passed = 0;
let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (error: unknown) { console.error('✗ ' + t.name + '\n  ' + (error instanceof Error ? error.message : String(error))); failed += 1; }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('reaction tests failed');
