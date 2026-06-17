/**
 * G-02 卡片效果執行器測試 — add_status / remove_status 接 statusEffects(ch3 §6)
 */
import { executeCardEffects, passiveTestModifier } from './effectsExecutor';
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

// ─── P1 批次1:牌庫/手牌/資產引擎 ─────────────
test('reveal_top:看牌頂 N 張(不改區)', () => {
  const r = executeCardEffects([fx('reveal_top', { amount: 2 })], makeInv({ deck: ['c1', 'c2', 'c3'] }), makeScenario(), {});
  assertEq((r.effects.find((e) => e.type === 'reveal_top')?.params as any).count, 2);
  assertEq(r.investigator.deck.length, 3, '牌庫不變');
});

test('discard_card:棄手牌前 N 張', () => {
  const r = executeCardEffects([fx('discard_card', { amount: 2 })], makeInv({ hand: ['h1', 'h2', 'h3'] }), makeScenario(), {});
  assertEq(r.investigator.hand.join(','), 'h3');
  assertEq(r.investigator.discardPile.join(','), 'h1,h2');
});

test('retrieve_card:棄牌堆回收最近 N 張回手(P 流影)', () => {
  const r = executeCardEffects([fx('retrieve_card', { amount: 2 })], makeInv({ discardPile: ['d1', 'd2', 'd3'] }), makeScenario(), {});
  assertEq(r.investigator.hand.join(','), 'd2,d3');
  assertEq(r.investigator.discardPile.join(','), 'd1');
  assertEq(executeCardEffects([fx('retrieve_card')], makeInv(), makeScenario(), {}).unsupported.some((u) => u.includes('retrieve_card')), true);
});

test('return_to_deck:手牌前 N 張回牌庫頂', () => {
  const r = executeCardEffects([fx('return_to_deck', { amount: 1 })], makeInv({ hand: ['h1', 'h2'], deck: ['x'] }), makeScenario(), {});
  assertEq(r.investigator.hand.join(','), 'h2');
  assertEq(r.investigator.deck.join(','), 'h1,x');
});

test('remove_from_game:優先放逐棄牌堆,空則手牌', () => {
  const a = executeCardEffects([fx('remove_from_game', { amount: 1 })], makeInv({ discardPile: ['d1', 'd2'] }), makeScenario(), {});
  assertEq(a.investigator.removedPile.join(','), 'd2');
  assertEq(a.investigator.discardPile.join(','), 'd1');
  const b = executeCardEffects([fx('remove_from_game', { amount: 1 })], makeInv({ hand: ['h1'] }), makeScenario(), {});
  assertEq(b.investigator.removedPile.join(','), 'h1');
  assertEq((b.effects.find((e) => e.type === 'remove_from_game')?.params as any).from, 'hand');
});

test('shuffle_deck:保留全部牌(注入 rng 可重現)', () => {
  const r = executeCardEffects([fx('shuffle_deck')], makeInv({ deck: ['a', 'b', 'c', 'd', 'e'] }), makeScenario(), {}, () => 0);
  assertEq(r.investigator.deck.length, 5);
  assertEq([...r.investigator.deck].sort().join(','), 'a,b,c,d,e', '多重集不變');
});

test('exhaust_card / ready_card:橫置與轉正', () => {
  const ex = executeCardEffects([fx('exhaust_card')], makeInv({ assetsInPlay: ['a1'], assetState: { a1: { usesLeft: null, exhausted: false } } }), makeScenario(), {});
  assertEq(ex.investigator.assetState?.a1.exhausted, true);
  const rd = executeCardEffects([fx('ready_card')], makeInv({ assetsInPlay: ['a1'], assetState: { a1: { usesLeft: null, exhausted: true } } }), makeScenario(), {});
  assertEq(rd.investigator.assetState?.a1.exhausted, false);
});

test('gain_use:資產補充使用次數', () => {
  const r = executeCardEffects([fx('gain_use', { amount: 3 })], makeInv({ assetsInPlay: ['a1'], assetState: { a1: { usesLeft: 2, exhausted: false } } }), makeScenario(), {});
  assertEq(r.investigator.assetState?.a1.usesLeft, 5);
});

// ─── P1 批次2:資源掠奪 + 檢定時機聚合 ─────────────
test('steal_resource:自身獲得資源(單人近似)', () => {
  assertEq(executeCardEffects([fx('steal_resource', { amount: 2 })], makeInv({ resources: 1 }), makeScenario(), {}).investigator.resources, 3);
});

test('wild_attr_boost / reroll 在 action 路徑不報 unsupported(檢定時機)', () => {
  const r = executeCardEffects([fx('wild_attr_boost', { amount: 2 }), fx('reroll'), fx('auto_success')], makeInv(), makeScenario(), {});
  assertEq(r.unsupported.length, 0);
});

test('passiveTestModifier:wild_attr_boost 全屬性 + modify_test 限定屬性', () => {
  const inv = makeInv({ assetsInPlay: ['w1', 'm1'] });
  const lookup = {
    w1: { effects: [{ trigger_type: 'passive', effect_code: 'wild_attr_boost', effect_params: { amount: 2 } }] },
    m1: { effects: [{ trigger_type: 'passive', effect_code: 'modify_test', effect_params: { attribute: 'strength', modifier: 3 } }] },
  } as any;
  assertEq(passiveTestModifier(inv, lookup, 'strength'), 5, 'wild 2 + str 3');
  assertEq(passiveTestModifier(inv, lookup, 'intellect'), 2, 'wild 2 only');
});

// ─── P2 批次1:走位/敵控/任務 ─────────────
function locScenario(enemies: EnemyInstance[] = []): ScenarioState {
  return {
    ...makeScenario(enemies),
    locations: [
      { locationDefinitionId: 'A', visibility: 'day', connectedTo: ['B'], isObstacle: false },
      { locationDefinitionId: 'B', visibility: 'day', connectedTo: ['A'], isObstacle: false },
    ],
  };
}

test('move_investigator:指定地點 / 預設沿連線走 1 格 / 脫離交戰', () => {
  assertEq(executeCardEffects([fx('move_investigator')], makeInv(), locScenario(), {}).investigator.currentLocationId, 'B', '預設走第一條連線');
  assertEq(executeCardEffects([fx('move_investigator', { location: 'B' })], makeInv(), locScenario(), {}).investigator.currentLocationId, 'B');
  // 移動必脫離原地點交戰(雙向),不殘留跨地點交戰
  const eng = executeCardEffects([fx('move_investigator', { location: 'B' })], makeInv({ engagedWith: ['e1'] }), locScenario([makeEnemy({ engagedWith: ['i1'] })]), {});
  assertEq(eng.investigator.engagedWith.length, 0, '自身脫離');
  assertEq(eng.scenario.enemies[0].engagedWith.length, 0, '敵人側清除');
});

test('move_enemy:推離敵人並脫離交戰', () => {
  const r = executeCardEffects([fx('move_enemy')], makeInv({ engagedWith: ['e1'] }), locScenario([makeEnemy({ engagedWith: ['i1'] })]), {});
  assertEq(r.scenario.enemies[0].locationId, 'B');
  assertEq(r.scenario.enemies[0].engagedWith.length, 0);
  assertEq(r.investigator.engagedWith.length, 0);
});

test('engage_enemy / disengage_enemy:雙向交戰開關', () => {
  const en = executeCardEffects([fx('engage_enemy')], makeInv(), locScenario([makeEnemy()]), {});
  assertEq(en.investigator.engagedWith.join(','), 'e1');
  assertEq(en.scenario.enemies[0].engagedWith.join(','), 'i1');
  const dis = executeCardEffects([fx('disengage_enemy')], makeInv({ engagedWith: ['e1'] }), locScenario([makeEnemy({ engagedWith: ['i1'] })]), {});
  assertEq(dis.investigator.engagedWith.length, 0);
  assertEq(dis.scenario.enemies[0].engagedWith.length, 0);
});

test('remove_enemy:放逐移出場景', () => {
  const r = executeCardEffects([fx('remove_enemy')], makeInv(), locScenario([makeEnemy()]), {});
  assertEq(r.scenario.enemies.length, 0);
  assertEq(r.effects.some((e) => e.type === 'enemy_removed'), true);
});

test('execute_enemy:處決 HP 歸 0', () => {
  const r = executeCardEffects([fx('execute_enemy')], makeInv(), locScenario([makeEnemy({ hp: 99 })]), {});
  assertEq(r.scenario.enemies[0].hp, 0);
  assertEq(r.effects.some((e) => e.type === 'enemy_defeated'), true);
});

test('place_clue:地點放線索標記', () => {
  const r = executeCardEffects([fx('place_clue', { amount: 2 })], makeInv(), locScenario(), {});
  assertEq(r.scenario.tokens.some((t) => t.tokenType === 'clue' && t.amount === 2 && t.locationId === 'A'), true);
});

test('place_doom / remove_doom:議程進度增減(夾 0)', () => {
  assertEq(executeCardEffects([fx('place_doom', { amount: 3 })], makeInv(), makeScenario(), {}).scenario.agendaProgress, 3);
  const sc = { ...makeScenario(), agendaProgress: 2 };
  assertEq(executeCardEffects([fx('remove_doom', { amount: 5 })], makeInv(), sc, {}).scenario.agendaProgress, 0, '夾 0');
});

test('add_keyword / remove_keyword:敵人詞綴增減', () => {
  const add = executeCardEffects([fx('add_keyword', { keyword: 'vulnerable_mark' })], makeInv(), locScenario([makeEnemy()]), {});
  assertEq(add.scenario.enemies[0].modifiers.includes('vulnerable_mark'), true);
  const rm = executeCardEffects([fx('remove_keyword', { keyword: 'flying' })], makeInv(), locScenario([makeEnemy({ modifiers: ['flying'] })]), {});
  assertEq(rm.scenario.enemies[0].modifiers.includes('flying'), false);
});

// ─── P3 批次1:環境(光照/火/鬧鬼/連線)─────────────
test('create_darkness / create_fire / create_light:改地點視野', () => {
  assertEq(executeCardEffects([fx('create_darkness')], makeInv(), locScenario(), {}).scenario.locations[0].visibility, 'darkness');
  assertEq(executeCardEffects([fx('create_fire')], makeInv(), locScenario(), {}).scenario.locations[0].visibility, 'fire');
  assertEq(executeCardEffects([fx('extinguish_light')], makeInv(), locScenario(), {}).scenario.locations[0].visibility, 'night');
  // 還原類 → day
  const dark = { ...locScenario(), locations: [{ locationDefinitionId: 'A', visibility: 'darkness' as const, connectedTo: ['B'], isObstacle: false }, { locationDefinitionId: 'B', visibility: 'day' as const, connectedTo: ['A'], isObstacle: false }] };
  assertEq(executeCardEffects([fx('remove_darkness')], makeInv(), dark, {}).scenario.locations[0].visibility, 'day');
});

test('place_haunting / remove_haunting:鬧鬼附著與移除', () => {
  const r = executeCardEffects([fx('place_haunting', { enemy: 'ghoul' })], makeInv(), locScenario(), {});
  assertEq(r.scenario.hauntings?.[0]?.enemyDefinitionId, 'ghoul');
  assertEq(r.scenario.hauntings?.[0]?.locationId, 'A');
  assertEq(executeCardEffects([fx('place_haunting')], makeInv(), locScenario(), {}).unsupported.some((u) => u.includes('place_haunting')), true);
  const rm = executeCardEffects([fx('remove_haunting')], makeInv(), { ...locScenario(), hauntings: [{ locationId: 'A', enemyDefinitionId: 'ghoul' }] }, {});
  assertEq((rm.scenario.hauntings ?? []).length, 0);
});

test('connect_tiles / disconnect_tiles:雙向連線增減', () => {
  const sc3: ScenarioState = { ...makeScenario(), locations: [
    { locationDefinitionId: 'A', visibility: 'day', connectedTo: ['B'], isObstacle: false },
    { locationDefinitionId: 'B', visibility: 'day', connectedTo: ['A'], isObstacle: false },
    { locationDefinitionId: 'C', visibility: 'day', connectedTo: [], isObstacle: false },
  ] };
  const c = executeCardEffects([fx('connect_tiles', { from: 'A', to: 'C' })], makeInv(), sc3, {});
  assertEq(c.scenario.locations.find((l) => l.locationDefinitionId === 'A')!.connectedTo.includes('C'), true);
  assertEq(c.scenario.locations.find((l) => l.locationDefinitionId === 'C')!.connectedTo.includes('A'), true);
  const d = executeCardEffects([fx('disconnect_tiles', { from: 'A', to: 'B' })], makeInv(), sc3, {});
  assertEq(d.scenario.locations.find((l) => l.locationDefinitionId === 'A')!.connectedTo.includes('B'), false);
  assertEq(d.scenario.locations.find((l) => l.locationDefinitionId === 'B')!.connectedTo.includes('A'), false);
});

test('reveal_tile:G4 tile 系統未建模 → unsupported', () => {
  assertEq(executeCardEffects([fx('reveal_tile')], makeInv(), locScenario(), {}).unsupported.includes('reveal_tile'), true);
});

// ─── #2 軸向 COMBO:用既有 card_effects.condition 欄位(in_play)─────────────
const IN_PLAY = (axis_value: string, min: number) => ({ type: 'same_axis_in_play', axis_value, min });
const dmgCombo = (amount: number, condition: Record<string, unknown>): CardEffectRow => ({ trigger_type: 'action', effect_code: 'deal_damage', effect_params: { amount }, condition });

test('軸向 combo:condition 欄位 in_play 同軸卡達門檻 → combo 結算', () => {
  const lookup = { a1: { primary_axis_value: '老警長' }, a2: { primary_axis_value: '老警長' } } as any;
  const r = executeCardEffects([dmgCombo(3, IN_PLAY('老警長', 2))], makeInv({ assetsInPlay: ['a1', 'a2'] }), makeScenario([makeEnemy({ hp: 5 })]), lookup);
  assertEq(r.scenario.enemies[0].hp, 2, 'combo 生效,扣 3');
  assertEq(r.effects.some((e) => e.type === 'combo_inactive'), false);
});

test('軸向 combo:同軸卡不足門檻 → combo_inactive,效果不結算', () => {
  const lookup = { a1: { primary_axis_value: '老警長' } } as any;
  const r = executeCardEffects([dmgCombo(3, IN_PLAY('老警長', 2))], makeInv({ assetsInPlay: ['a1'] }), makeScenario([makeEnemy({ hp: 5 })]), lookup);
  assertEq(r.scenario.enemies[0].hp, 5, '未達門檻,不扣血');
  assertEq(r.effects.some((e) => e.type === 'combo_inactive'), true);
});

test('軸向 combo:base(無 condition)照常 + combo entry 分開 gate', () => {
  const lookup = { a1: { primary_axis_value: '老警長' } } as any;
  const r = executeCardEffects([fx('draw_card', { amount: 1 }), dmgCombo(3, IN_PLAY('老警長', 2))], makeInv({ assetsInPlay: ['a1'], deck: ['d1'] }), makeScenario([makeEnemy({ hp: 5 })]), lookup);
  assertEq(r.investigator.hand.length, 1, 'base 抽牌照常');
  assertEq(r.scenario.enemies[0].hp, 5, 'combo 被 gate');
});

test('軸向 combo:§5.2 字串條件不擋(非本系統)/ played_this_turn 暫不啟用', () => {
  // 字串條件(§5.2)→ axisConditionMet 回 true,effect 照常結算
  const strCond = executeCardEffects([{ trigger_type: 'action', effect_code: 'deal_damage', effect_params: { amount: 2 }, condition: 'while_engaged' }], makeInv(), makeScenario([makeEnemy({ hp: 5 })]), {});
  assertEq(strCond.scenario.enemies[0].hp, 3, '§5.2 字串條件不擋');
  // played_this_turn → Phase A-2,暫不生效
  const ptt = executeCardEffects([dmgCombo(3, { type: 'same_axis_played_this_turn', axis_value: 'X', min: 1 })], makeInv(), makeScenario([makeEnemy({ hp: 5 })]), {});
  assertEq(ptt.scenario.enemies[0].hp, 5, 'played_this_turn 暫不生效');
  assertEq(ptt.effects.some((e) => e.type === 'combo_inactive'), true);
});

// ─── runner ─────────────────────────
let passed = 0; let failed = 0; const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
