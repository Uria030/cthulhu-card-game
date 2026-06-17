/**
 * G-02 卡片效果執行器測試 — add_status / remove_status 接 statusEffects(ch3 §6)
 */
import { executeCardEffects } from './effectsExecutor';
import type { CardEffectRow } from './effectsExecutor';
import type { InvestigatorState, ScenarioState, EnemyInstance } from './state';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'i1', investigatorDefinitionId: 'd', ownerPlayerId: 'p',
    attributes: { strength: 2, agility: 2, constitution: 2, reflex: 2, intellect: 2, willpower: 2, perception: 2, charisma: 2 },
    combatStyle: '', specializations: [], deck: [], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 9, hpMax: 9, san: 9, sanMax: 9, actionPoints: 3, resources: 0, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}
function makeEnemy(over: Partial<EnemyInstance> = {}): EnemyInstance {
  return { instanceId: 'e1', enemyDefinitionId: 'def', locationId: 'A', hp: 5, engagedWith: [], modifiers: [], ...over };
}
function makeScenario(enemies: EnemyInstance[] = []): ScenarioState {
  return {
    scenarioId: 's', scenarioDefinitionId: 'sd', campaignId: 'c',
    locations: [], unlockedLocations: [], enemies, tokens: [],
    agendaProgress: 0, objectiveProgress: 0, chaosBag: [], turnNumber: 1, phase: 'investigator',
  };
}
function fx(effect_code: string, effect_params: Record<string, unknown> = {}): CardEffectRow {
  return { trigger_type: 'action', effect_code, effect_params };
}

test('add_status target=self → 寫入自身 statusEffects', () => {
  const r = executeCardEffects([fx('add_status', { status: 'armor', layers: 2, target: 'self' })], makeInv(), makeScenario(), {});
  assertEq(r.investigator.statusEffects?.armor, 2);
  assertEq(r.effects.some((e) => e.type === 'status_applied'), true);
});

test('add_status(預設對敵) → 寫入同地點敵人 statusEffects', () => {
  const r = executeCardEffects([fx('add_status', { status: 'marked', layers: 1 })], makeInv(), makeScenario([makeEnemy()]), {});
  assertEq(r.scenario.enemies[0].statusEffects?.marked, 1);
});

test('add_status 讀 stacks 多層 + 別名收斂(真實卡面 {status:burn,stacks:3})', () => {
  const r = executeCardEffects([fx('add_status', { status: 'burn', stacks: 3 })], makeInv(), makeScenario([makeEnemy()]), {});
  assertEq(r.scenario.enemies[0].statusEffects?.burning, 3, 'stacks=3 + burn→burning');
});

test('add_status:無同地點敵人 → unsupported(不結算)', () => {
  const r = executeCardEffects([fx('add_status', { status: 'marked' })], makeInv(), makeScenario([]), {});
  assertEq(r.unsupported.some((u) => u.includes('add_status')), true);
});

test('remove_status(未指定) → 淨化所有負面,保留正面', () => {
  const r = executeCardEffects([fx('remove_status')], makeInv({ statusEffects: { poison: 2, bleed: 1, armor: 3 } }), makeScenario(), {});
  assertEq(r.investigator.statusEffects?.poison ?? 0, 0);
  assertEq(r.investigator.statusEffects?.bleed ?? 0, 0);
  assertEq(r.investigator.statusEffects?.armor, 3, '正面狀態保留');
});

test('remove_status(指定) → 只移除該狀態', () => {
  const r = executeCardEffects([fx('remove_status', { status: 'poison' })], makeInv({ statusEffects: { poison: 2, bleed: 1 } }), makeScenario(), {});
  assertEq(r.investigator.statusEffects?.poison ?? 0, 0);
  assertEq(r.investigator.statusEffects?.bleed, 1, '其他狀態保留');
});

// ─── P0 補完:治療 / 恐懼 / 資源 ─────────────
test('heal_hp:回復當前 HP,夾在上限', () => {
  const r = executeCardEffects([fx('heal_hp', { amount: 5 })], makeInv({ hp: 3, hpMax: 9 }), makeScenario(), {});
  assertEq(r.investigator.hp, 8, '3+5');
  const cap = executeCardEffects([fx('heal_hp', { amount: 5 })], makeInv({ hp: 7, hpMax: 9 }), makeScenario(), {});
  assertEq(cap.investigator.hp, 9, '夾在 hpMax');
  assertEq(r.effects.some((e) => e.type === 'heal_hp'), true);
});

test('heal_san:回復當前 SAN,夾在上限', () => {
  const r = executeCardEffects([fx('heal_san', { amount: 4 })], makeInv({ san: 2, sanMax: 9 }), makeScenario(), {});
  assertEq(r.investigator.san, 6);
  const cap = executeCardEffects([fx('heal_san', { amount: 9 })], makeInv({ san: 8, sanMax: 9 }), makeScenario(), {});
  assertEq(cap.investigator.san, 9, '夾在 sanMax');
});

test('deal_horror:對自身扣 SAN(不破 0)', () => {
  const r = executeCardEffects([fx('deal_horror', { amount: 3 })], makeInv({ san: 5 }), makeScenario(), {});
  assertEq(r.investigator.san, 2);
  assertEq(r.effects.some((e) => e.type === 'fear_damage'), true);
  const floor = executeCardEffects([fx('deal_horror', { amount: 9 })], makeInv({ san: 2 }), makeScenario(), {});
  assertEq(floor.investigator.san, 0, '夾在 0');
});

test('spend_resource:扣資源不破 0', () => {
  assertEq(executeCardEffects([fx('spend_resource', { amount: 2 })], makeInv({ resources: 5 }), makeScenario(), {}).investigator.resources, 3);
  assertEq(executeCardEffects([fx('spend_resource', { amount: 9 })], makeInv({ resources: 2 }), makeScenario(), {}).investigator.resources, 0);
});

// ─── P0 批次2:元素/暴擊傷害 + 控場/閃避/額外行動 ─────────────
test('deal_damage element=fire:對帶燃燒的敵人 +該層數(§6.5)', () => {
  const r = executeCardEffects([fx('deal_damage', { amount: 3, element: 'fire' })], makeInv(), makeScenario([makeEnemy({ hp: 5, statusEffects: { burning: 2 } })]), {});
  assertEq(r.scenario.enemies[0].hp, 0, '3+2 燃燒 = 5,擊殺');
  assertEq(r.effects.some((e) => e.type === 'enemy_defeated'), true);
  const hit = r.effects.find((e) => e.type === 'attack_hit');
  assertEq((hit?.params as any).damage, 5);
});

test('deal_damage crit:暴擊倍率 ×2', () => {
  const r = executeCardEffects([fx('deal_damage', { amount: 3, crit: true })], makeInv(), makeScenario([makeEnemy({ hp: 10 })]), {});
  assertEq(r.scenario.enemies[0].hp, 4, '10 - 3×2');
  assertEq((r.effects.find((e) => e.type === 'attack_hit')?.params as any).crit, true);
});

test('deal_damage 無元素:行為不變(回歸)', () => {
  const r = executeCardEffects([fx('deal_damage', { amount: 2 })], makeInv(), makeScenario([makeEnemy({ hp: 5 })]), {});
  assertEq(r.scenario.enemies[0].hp, 3);
});

test('stun_enemy:對目標敵人加 stunned 修飾', () => {
  const r = executeCardEffects([fx('stun_enemy')], makeInv(), makeScenario([makeEnemy()]), {});
  assertEq(r.scenario.enemies[0].modifiers.includes('stunned'), true);
  assertEq(r.effects.some((e) => e.type === 'enemy_stunned'), true);
  // 無敵人 → unsupported
  assertEq(executeCardEffects([fx('stun_enemy')], makeInv(), makeScenario([]), {}).unsupported.some((u) => u.includes('stun_enemy')), true);
});

test('evade:雙向清除交戰', () => {
  const r = executeCardEffects([fx('evade')], makeInv({ engagedWith: ['e1'] }), makeScenario([makeEnemy({ engagedWith: ['i1'] })]), {});
  assertEq(r.investigator.engagedWith.length, 0, '自身脫離');
  assertEq(r.scenario.enemies[0].engagedWith.length, 0, '敵人脫離');
  assertEq((r.effects.find((e) => e.type === 'evade')?.params as any).disengaged, 1);
});

test('extra_attack:+行動點', () => {
  const r = executeCardEffects([fx('extra_attack', { amount: 2 })], makeInv({ actionPoints: 3 }), makeScenario(), {});
  assertEq(r.investigator.actionPoints, 5);
});

// ─── P0 批次3:反擊 + 盟友分傷 ─────────────
function makeAlly(over: Partial<import('./state').AllyState> = {}): import('./state').AllyState {
  return { cardInstanceId: 'a1', name: '老獵犬', hp: 5, hpMax: 5, san: 5, sanMax: 5, attack: 1, exhausted: false, ...over };
}

test('counterattack:在自身掛 counter 層', () => {
  const r = executeCardEffects([fx('counterattack', { amount: 2 })], makeInv(), makeScenario(), {});
  assertEq(r.investigator.statusEffects?.counter, 2);
  assertEq(r.effects.some((e) => e.type === 'counterattack_armed'), true);
});

test('transfer_damage:盟友傷勢移到自身(夾在缺口與 amount)', () => {
  const r = executeCardEffects([fx('transfer_damage', { amount: 2 })], makeInv({ hp: 9, allies: [makeAlly({ hp: 1, hpMax: 5 })] }), makeScenario(), {});
  assertEq(r.investigator.allies?.[0].hp, 3, '盟友回 2');
  assertEq(r.investigator.hp, 7, '自身承受 2');
  // 無盟友 → unsupported
  assertEq(executeCardEffects([fx('transfer_damage', { amount: 2 })], makeInv(), makeScenario(), {}).unsupported.some((u) => u.includes('transfer_damage')), true);
});

test('transfer_horror:盟友理智耗損移到自身', () => {
  const r = executeCardEffects([fx('transfer_horror', { amount: 3 })], makeInv({ san: 9, allies: [makeAlly({ san: 1, sanMax: 5 })] }), makeScenario(), {});
  assertEq(r.investigator.allies?.[0].san, 4, '盟友回 3');
  assertEq(r.investigator.san, 6, '自身承受 3');
});

// ─── runner ─────────────────────────
let passed = 0; let failed = 0; const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
