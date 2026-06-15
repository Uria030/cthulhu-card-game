/**
 * G-10 狀態效果系統測試 — ch3 §6(堆疊/減層/回合首尾結算/元素互動/消費端 query)
 */
import {
  getLayers, addStatus, removeStatus, clearStealth, decrementOnRoll,
  turnStartTick, turnEndTick, elementalDamageBonus,
  incomingPhysicalBonus, incomingHorrorBonus, physicalReduction, horrorReduction,
  outgoingMeleeReduction, attackHitModifier, moveCostBonus, stealthDamageBonus,
  bonusActionPoints, canUseAssetAttack, canCastSpell, checkRollMode,
} from './statusEffects';
import type { InvestigatorState } from './state';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'inv-1', investigatorDefinitionId: 'def-1', ownerPlayerId: 'p1',
    attributes: { strength: 3, agility: 3, constitution: 3, reflex: 3, intellect: 3, willpower: 3, perception: 3, charisma: 3 },
    combatStyle: 'sidearm', specializations: [],
    deck: ['c1'], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 10, hpMax: 11, san: 10, sanMax: 11, actionPoints: 3, resources: 0,
    currentLocationId: 'loc-a', engagedWith: [], triggeredHorrorChecks: [],
    traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}

// ─── 基本操作 ──
test('addStatus 堆疊累加', () => {
  let m = addStatus({}, 'poison', 2);
  m = addStatus(m, 'poison', 1);
  assertEq(getLayers(m, 'poison'), 3);
});

test('§6.5 施加燃燒移除潮濕', () => {
  const m = addStatus({ wet: 2 }, 'burning', 1);
  assertEq(getLayers(m, 'burning'), 1);
  assertEq(getLayers(m, 'wet'), 0, '潮濕應被燃燒移除');
});

test('§6.2/§6.3 標記↔隱蔽互抵:層數相抵', () => {
  // 隱蔽 2 + 施標記 3 → 標記 1、隱蔽 0
  let m = addStatus({ stealth: 2 }, 'marked', 3);
  assertEq(getLayers(m, 'marked'), 1);
  assertEq(getLayers(m, 'stealth'), 0);
  // 標記 3 + 施隱蔽 1 → 標記 2、隱蔽 0
  m = addStatus({ marked: 3 }, 'stealth', 1);
  assertEq(getLayers(m, 'marked'), 2);
  assertEq(getLayers(m, 'stealth'), 0);
  // 等量 → 兩者皆清
  m = addStatus({ stealth: 2 }, 'marked', 2);
  assertEq(getLayers(m, 'marked'), 0);
  assertEq(getLayers(m, 'stealth'), 0);
});

test('removeStatus:減 N 與全移除', () => {
  assertEq(getLayers(removeStatus({ bleed: 3 }, 'bleed', 1), 'bleed'), 2);
  assertEq(getLayers(removeStatus({ bleed: 3 }, 'bleed'), 'bleed'), 0);
});

// ─── 回合開始 tick(§6.2/§6.3)──
test('turnStartTick:燃燒扣 HP', () => {
  const r = turnStartTick(makeInv({ hp: 10, statusEffects: { burning: 3 } }));
  assertEq(r.investigator.hp, 7);
  assertEq(r.effects.some((e) => e.type === 'status_burning'), true);
});

test('turnStartTick:再生回 HP(不超過上限)', () => {
  const r = turnStartTick(makeInv({ hp: 10, hpMax: 11, statusEffects: { regeneration: 5 } }));
  assertEq(r.investigator.hp, 11, '回復上限封頂');
});

// ─── 回合結束 tick(§6.1/§6.2)──
test('turnEndTick:流血扣 HP + 毀滅狀態扣 HP', () => {
  const r = turnEndTick(makeInv({ hp: 10, statusEffects: { bleed: 2, doom_status: 1 } }));
  assertEq(r.investigator.hp, 7);
});

test('turnEndTick:疲勞 → blockEconomy', () => {
  const r = turnEndTick(makeInv({ statusEffects: { fatigue: 1 } }));
  assertEq(r.blockEconomy, true);
});

test('turnEndTick:所有非特殊狀態減 1 層', () => {
  const r = turnEndTick(makeInv({ statusEffects: { poison: 2, burning: 1 } }));
  assertEq(getLayers(r.investigator.statusEffects, 'poison'), 1);
  assertEq(getLayers(r.investigator.statusEffects, 'burning'), 0, '燃燒 1 → 0 移除');
});

test('turnEndTick:特殊減層狀態(強化/弱化/隱蔽)不在回合末減', () => {
  const r = turnEndTick(makeInv({ statusEffects: { empowered: 2, weakened: 2, stealth: 1 } }));
  assertEq(getLayers(r.investigator.statusEffects, 'empowered'), 2);
  assertEq(getLayers(r.investigator.statusEffects, 'weakened'), 2);
  assertEq(getLayers(r.investigator.statusEffects, 'stealth'), 1);
});

test('decrementOnRoll:強化/弱化擲骰後各減 1', () => {
  const m = decrementOnRoll({ empowered: 2, weakened: 1, poison: 3 });
  assertEq(getLayers(m, 'empowered'), 1);
  assertEq(getLayers(m, 'weakened'), 0);
  assertEq(getLayers(m, 'poison'), 3, '其他狀態不受擲骰減層');
});

test('clearStealth:移動/攻擊後全移除', () => {
  assertEq(getLayers(clearStealth({ stealth: 3 }), 'stealth'), 0);
});

// ─── 元素互動(§6.5)──
test('elementalDamageBonus:火 vs 燃燒 / 雷 vs 潮濕 / 冰 vs 冷凍', () => {
  assertEq(elementalDamageBonus({ burning: 2 }, 'fire'), 2);
  assertEq(elementalDamageBonus({ wet: 3 }, 'lightning'), 3);
  assertEq(elementalDamageBonus({ frozen: 1 }, 'ice'), 1);
  assertEq(elementalDamageBonus({ burning: 2 }, 'physical'), 0, '不對應元素無增傷');
  assertEq(elementalDamageBonus({ wet: 3 }, '雷'), 3, '中文元素名也認');
});

// ─── 消費端 query(9b wiring 用)──
test('傷害修正:物理加成=中毒+脆弱+標記;恐懼加成=發瘋+標記', () => {
  assertEq(incomingPhysicalBonus({ poison: 1, vulnerable: 2, marked: 1 }), 4);
  assertEq(incomingHorrorBonus({ madness: 2, marked: 1 }), 3);
});

test('傷害減免:護甲(物理)/ 護盾(恐懼)', () => {
  assertEq(physicalReduction({ armor: 3 }), 3);
  assertEq(horrorReduction({ ward: 2 }), 2);
});

test('其他 query:無力/黑暗/冷凍/隱蔽/加速', () => {
  assertEq(outgoingMeleeReduction({ weakness_status: 2 }), 2);
  assertEq(attackHitModifier({ darkness: 1 }), -2);
  assertEq(attackHitModifier({}), 0);
  assertEq(moveCostBonus({ frozen: 1 }), 1);
  assertEq(stealthDamageBonus({ stealth: 3 }), 3);
  assertEq(bonusActionPoints({ haste: 2 }), 2);
});

test('行動限制:繳械封資產攻擊 / 沈默封施法', () => {
  assertEq(canUseAssetAttack({ disarm: 1 }), false);
  assertEq(canUseAssetAttack({}), true);
  assertEq(canCastSpell({ silence: 1 }), false);
  assertEq(canCastSpell({}), true);
});

test('checkRollMode:強化取好/弱化取差/並存抵消', () => {
  assertEq(checkRollMode({ empowered: 1 }), 'advantage');
  assertEq(checkRollMode({ weakened: 1 }), 'disadvantage');
  assertEq(checkRollMode({ empowered: 1, weakened: 1 }), 'normal', '並存互相抵消');
  assertEq(checkRollMode({}), 'normal');
});

// ─── runner ─────────────────────────
let passed = 0; let failed = 0; const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
