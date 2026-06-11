/**
 * G-02 怪物行動單元測試 — 對齊 §7.2/7.6/7.7 + §10
 */
import {
  locationDistance,
  stepToward,
  runFearChecks,
  applyAttackOfOpportunity,
  activateMonsters,
  spawnEnemy,
} from './monsterActions';
import type { EnemyDataLookup, AttackCardLookup } from './monsterActions';
import type { InvestigatorState, ScenarioState } from './state';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

const rngRoll = (roll: number) => () => (roll - 1) / 20;

function makeInv(overrides: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'inv-1', investigatorDefinitionId: 'def-1', ownerPlayerId: 'p1',
    attributes: { strength: 3, agility: 3, constitution: 3, reflex: 3, intellect: 3, willpower: 3, perception: 3, charisma: 3 },
    combatStyle: '', specializations: [], deck: [], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 7, hpMax: 7, san: 7, sanMax: 7, actionPoints: 3, resources: 0,
    currentLocationId: 'A', engagedWith: [], triggeredHorrorChecks: [], traumas: [],
    secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...overrides,
  };
}

// 線形地圖 A - B - C - D
function makeScenario(): ScenarioState {
  return {
    scenarioId: 's', scenarioDefinitionId: 's', campaignId: 'c',
    locations: [
      { locationDefinitionId: 'A', visibility: 'day', connectedTo: ['B'], isObstacle: false },
      { locationDefinitionId: 'B', visibility: 'day', connectedTo: ['A', 'C'], isObstacle: false },
      { locationDefinitionId: 'C', visibility: 'day', connectedTo: ['B', 'D'], isObstacle: false },
      { locationDefinitionId: 'D', visibility: 'day', connectedTo: ['C'], isObstacle: false },
    ],
    unlockedLocations: ['A', 'B', 'C', 'D'],
    enemies: [], tokens: [], agendaProgress: 0, objectiveProgress: 0,
    chaosBag: [], turnNumber: 1, phase: 'mythos',
  };
}

const ENEMY_DATA: EnemyDataLookup = {
  ghoul: {
    name_zh: '食屍鬼', dc: 12, damage_physical: 2, damage_horror: 1,
    fear_value: 2, fear_radius: 1, tier: 2, attacks_per_round: 1, movement_speed: 1,
    move_pool: [{ code: 'mac_bite', weight: 1 }],
    hp_base: 3,
  },
  howler: {
    name_zh: '嚎叫者', dc: 10, damage_physical: 1, damage_horror: 2,
    fear_value: 1, fear_radius: 3, tier: 1, movement_speed: 2, hp_base: 2,
  },
};
const ATTACK_CARDS: AttackCardLookup = {
  mac_bite: { code: 'mac_bite', name_zh: '撕咬', defense_attribute: 'agility', dc_override: 14, damage_physical: 3, damage_horror: 0 },
};

// ─── §10.6 距離與尋路 ─────────────────────────
test('locationDistance:BFS 跳數', () => {
  const sc = makeScenario();
  assertEq(locationDistance(sc.locations, 'A', 'A'), 0);
  assertEq(locationDistance(sc.locations, 'A', 'B'), 1);
  assertEq(locationDistance(sc.locations, 'A', 'D'), 3);
});

test('stepToward:朝目標走 1 格', () => {
  const sc = makeScenario();
  assertEq(stepToward(sc.locations, 'D', 'A', () => 0), 'C');
});

// ─── §7.6/7.7 恐懼檢定 ───────────────────────
test('恐懼半徑內觸發意志檢定,失敗扣恐懼值 SAN', () => {
  const sc = makeScenario();
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'ghoul', locationId: 'B', hp: 3, engagedWith: [], modifiers: [] }];
  const inv = makeInv({ currentLocationId: 'B' });
  // roll 5 + 意志 3 = 8 < DC 12 → fail → SAN 7-2=5
  const r = runFearChecks(inv, sc, ENEMY_DATA, rngRoll(5));
  assertEq(r.investigator.san, 5);
  assertEq(r.investigator.triggeredHorrorChecks.includes('e1'), true);
});

test('恐懼半徑外不觸發;半徑 3 遠程怪會觸發(§7.7)', () => {
  const sc = makeScenario();
  sc.enemies = [
    { instanceId: 'e1', enemyDefinitionId: 'ghoul', locationId: 'D', hp: 3, engagedWith: [], modifiers: [] },  // 距 A = 3 > 半徑1
    { instanceId: 'e2', enemyDefinitionId: 'howler', locationId: 'D', hp: 2, engagedWith: [], modifiers: [] }, // 半徑3 → 觸發
  ];
  const inv = makeInv({ currentLocationId: 'A' });
  const r = runFearChecks(inv, sc, ENEMY_DATA, rngRoll(5));
  assertEq(r.investigator.triggeredHorrorChecks.includes('e1'), false);
  assertEq(r.investigator.triggeredHorrorChecks.includes('e2'), true);
});

test('同一隻怪只觸發一次恐懼檢定(§7.6)', () => {
  const sc = makeScenario();
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'ghoul', locationId: 'B', hp: 3, engagedWith: [], modifiers: [] }];
  const inv = makeInv({ currentLocationId: 'B', triggeredHorrorChecks: ['e1'] });
  const r = runFearChecks(inv, sc, ENEMY_DATA, rngRoll(5));
  assertEq(r.investigator.san, 7);
  assertEq(r.effects.length, 0);
});

// ─── §7.2 藉機攻擊 ───────────────────────────
test('藉機攻擊:物理+恐懼雙重傷害', () => {
  const sc = makeScenario();
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'ghoul', locationId: 'A', hp: 3, engagedWith: ['inv-1'], modifiers: [] }];
  const inv = makeInv({ engagedWith: ['e1'] });
  const r = applyAttackOfOpportunity(inv, sc, ENEMY_DATA);
  assertEq(r.investigator.hp, 5);  // -2 物理
  assertEq(r.investigator.san, 6); // -1 恐懼
});

// ─── §10.3 怪物啟動 ──────────────────────────
test('已交戰 → 用招式卡攻擊,玩家防禦失敗受卡面傷害', () => {
  const sc = makeScenario();
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'ghoul', locationId: 'A', hp: 3, engagedWith: ['inv-1'], modifiers: [] }];
  const inv = makeInv({ engagedWith: ['e1'] });
  // 防禦 roll 5 + 敏捷 3 = 8 < 撕咬 DC 14 → 中,物理 3
  const r = activateMonsters(sc, { 'inv-1': inv }, ENEMY_DATA, ATTACK_CARDS, rngRoll(5));
  assertEq(r.investigators['inv-1'].hp, 4);
  const atk = r.effects.find((e) => e.type === 'monster_attack');
  assertEq((atk?.params as { move: string }).move, '撕咬');
  assertEq((atk?.params as { dc: number }).dc, 14);
});

test('已交戰 → 玩家防禦成功不受傷', () => {
  const sc = makeScenario();
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'ghoul', locationId: 'A', hp: 3, engagedWith: ['inv-1'], modifiers: [] }];
  const inv = makeInv({ engagedWith: ['e1'] });
  // roll 15 + 3 = 18 ≥ 14 → 閃過
  const r = activateMonsters(sc, { 'inv-1': inv }, ENEMY_DATA, ATTACK_CARDS, rngRoll(15));
  assertEq(r.investigators['inv-1'].hp, 7);
});

test('未交戰 → 移動 1 格;到達 → 交戰 + 恐懼檢定(§10.3/§7.6)', () => {
  const sc = makeScenario();
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'ghoul', locationId: 'C', hp: 3, engagedWith: [], modifiers: [] }];
  const inv = makeInv({ currentLocationId: 'B' });
  const r = activateMonsters(sc, { 'inv-1': inv }, ENEMY_DATA, ATTACK_CARDS, rngRoll(5));
  const e1 = r.scenario.enemies[0];
  assertEq(e1.locationId, 'B');
  assertEq(e1.engagedWith.includes('inv-1'), true);
  assertEq(r.investigators['inv-1'].engagedWith.includes('e1'), true);
  // 到點觸發恐懼:roll 5 + 3 = 8 < 12 → SAN -2
  assertEq(r.investigators['inv-1'].san, 5);
});

test('movement_speed 2 一回合走兩格', () => {
  const sc = makeScenario();
  sc.enemies = [{ instanceId: 'e2', enemyDefinitionId: 'howler', locationId: 'D', hp: 2, engagedWith: [], modifiers: [] }];
  const inv = makeInv({ currentLocationId: 'B' });
  const r = activateMonsters(sc, { 'inv-1': inv }, ENEMY_DATA, ATTACK_CARDS, rngRoll(15));
  assertEq(r.scenario.enemies[0].locationId, 'B');
});

test('§10.2 位階高的先動', () => {
  const sc = makeScenario();
  sc.enemies = [
    { instanceId: 'low', enemyDefinitionId: 'howler', locationId: 'C', hp: 2, engagedWith: [], modifiers: [] },
    { instanceId: 'high', enemyDefinitionId: 'ghoul', locationId: 'C', hp: 3, engagedWith: [], modifiers: [] },
  ];
  const inv = makeInv({ currentLocationId: 'A' });
  const r = activateMonsters(sc, { 'inv-1': inv }, ENEMY_DATA, ATTACK_CARDS, rngRoll(15));
  const firstMove = r.effects.find((e) => e.type === 'monster_move');
  assertEq(firstMove?.targetId, 'high'); // ghoul tier 2 先動
});

test('跨地點殘留交戰 → 防衛清理,怪物改為移動(交戰必同地點)', () => {
  const sc = makeScenario();
  sc.enemies = [{ instanceId: 'e1', enemyDefinitionId: 'ghoul', locationId: 'C', hp: 3, engagedWith: ['inv-1'], modifiers: [] }];
  const inv = makeInv({ currentLocationId: 'A', engagedWith: ['e1'] });
  const r = activateMonsters(sc, { 'inv-1': inv }, ENEMY_DATA, ATTACK_CARDS, rngRoll(15));
  // 不會隔空攻擊:HP 不變,改為朝玩家移動
  assertEq(r.investigators['inv-1'].hp, 7);
  assertEq(r.scenario.enemies[0].locationId, 'B');
  assertEq(r.investigators['inv-1'].engagedWith.length, 0, '殘留交戰被清理');
});

// ─── spawnEnemy ─────────────────────────────
test('spawnEnemy:依 hp_base + per_player 生成', () => {
  const sc = makeScenario();
  const r = spawnEnemy(sc, 'ghoul', 'D', ENEMY_DATA, 1);
  assertEq(r.scenario.enemies.length, 1);
  assertEq(r.enemy.hp, 3);
  assertEq(r.enemy.locationId, 'D');
});

// ─── runner ─────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
