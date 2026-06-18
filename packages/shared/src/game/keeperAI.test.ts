/**
 * G-03 城主 AI v0 單元測試 — 對齊 keeper_ai_v0_decision_spec(v3)
 */
import {
  defaultKeeperProfile,
  initKeeperState,
  snapshotSituation,
  scoreCard,
  selectKeeperActivations,
  executeMythosCard,
  attachmentTestModifier,
  runAttachmentUpkeep,
} from './keeperAI';
import type { MythosCardData, KeeperState, KeeperAttachment } from './keeperAI';
import type { ScenarioState, InvestigatorState } from './state';
import type { EnemyDataLookup } from './monsterActions';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'inv-1', investigatorDefinitionId: 'd', ownerPlayerId: 'p',
    attributes: { strength: 3, agility: 3, constitution: 3, reflex: 3, intellect: 3, willpower: 3, perception: 3, charisma: 3 },
    combatStyle: '', specializations: [], deck: [], hand: ['h1', 'h2'], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 7, hpMax: 7, san: 7, sanMax: 7, actionPoints: 3, resources: 0, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}

function makeScenario(over: Partial<ScenarioState> = {}): ScenarioState {
  return {
    scenarioId: 's', scenarioDefinitionId: 's', campaignId: 'c',
    locations: [
      { locationDefinitionId: 'A', visibility: 'night', connectedTo: ['B'], isObstacle: false },
      { locationDefinitionId: 'B', visibility: 'night', connectedTo: ['A'], isObstacle: false },
    ],
    unlockedLocations: ['A', 'B'],
    enemies: [], tokens: [], agendaProgress: 0, objectiveProgress: 0,
    chaosBag: [], turnNumber: 1, phase: 'mythos',
    ...over,
  };
}

const ENEMY_DATA: EnemyDataLookup = {
  rev_t1: { name_zh: '深潛者亡靈', tier: 1, family_code: 'house_cthulhu', hp_base: 4, keywords: [] },
  cultist_t1: { name_zh: '狂熱信眾', tier: 1, family_code: 'fallen', hp_base: 4, keywords: ['agenda_pusher'] },
  boss_t3: { name_zh: '深潛者裂嘴女', tier: 3, family_code: 'house_cthulhu', hp_base: 23, keywords: [] },
};

const card = (over: Partial<MythosCardData>): MythosCardData => ({
  id: over.id ?? 'c-' + (over.name_zh ?? 'x'),
  name_zh: '測試卡', card_category: 'general', action_cost: 1, intensity_tag: 'small',
  reusable: true, cooldown_rounds: null, max_uses_per_stage: null,
  effects: [{ action_code: 'set_visibility', action_params: { visibility: 'darkness' } }],
  ...over,
});

const SUMMON = card({ id: 'summon', name_zh: '深淵呼喚', card_category: 'summon', action_cost: 2, effects: [{ action_code: 'summon_monster', action_params: { quantity: 1, base_tier: 1, family_code: 'house_cthulhu', location_rule: 'nearest_to_clue' } }] });
const AGENDA = card({ id: 'agenda', name_zh: '末日推進', card_category: 'agenda', action_cost: 3, intensity_tag: 'medium', effects: [{ action_code: 'advance_agenda', action_params: { doom_tokens: 2 } }] });
const STATUS = card({ id: 'status', name_zh: '恐懼侵襲', card_category: 'status', action_cost: 2, intensity_tag: 'medium', effects: [{ action_code: 'horror_damage', action_params: { amount: 2, cap_to_one_at_limit: true } }] });
const AMBIENT = card({ id: 'ambient', name_zh: '黑暗滲出', card_category: 'general', action_cost: 1 });
const DORMANT = card({ id: 'dormant', name_zh: '線索篡改', card_category: 'narrative', action_cost: 2, effects: [] }); // 無可執行效果 = 蟄伏

function situation(over: Partial<ReturnType<typeof snapshotSituation>> = {}) {
  return { aliveEnemies: 0, sanPct: 100, hpPct: 100, playerProgressPct: 0, dramaTier: 'rising' as const, turnNumber: 3, ...over };
}

// ─── 設定檔 ─────────────────────────────────
test('defaultKeeperProfile:每回合能量=人數+1,上限=6+2×人數(Uria 2026-06-18)', () => {
  const solo = defaultKeeperProfile(undefined, 1);
  assertEq(solo.baseActionPoints, 2);  // 人數1 + 1
  assertEq(solo.maxAccumulation, 8);   // 6 + 2×1
  const four = defaultKeeperProfile({ keeper_action_per_player: 2 }, 4);
  assertEq(four.baseActionPoints, 5);  // 人數4 + 1
  assertEq(four.maxAccumulation, 14);  // 6 + 2×4
});

// ─── 局勢快照 ───────────────────────────────
test('snapshot:戲劇期判定(setup/rising/climax)', () => {
  const inv = makeInv();
  assertEq(snapshotSituation(makeScenario({ turnNumber: 1 }), inv, 2, null).dramaTier, 'setup');
  assertEq(snapshotSituation(makeScenario({ turnNumber: 4 }), inv, 2, null).dramaTier, 'rising');
  assertEq(snapshotSituation(makeScenario({ actIndex: 1 }), inv, 2, 23).dramaTier, 'climax');
});

test('snapshot:幕一玩家進度 = 線索 %;幕二 = 頭目失血 %', () => {
  const inv = makeInv();
  const s1 = snapshotSituation(makeScenario({ objectiveProgress: 1 }), inv, 2, null);
  assertEq(s1.playerProgressPct, 50);
  const sc2 = makeScenario({ actIndex: 1, enemies: [{ instanceId: 'b', enemyDefinitionId: 'boss_t3', locationId: 'B', hp: 5, engagedWith: [], modifiers: [] }] });
  const s2 = snapshotSituation(sc2, inv, null, 20);
  assertEq(s2.playerProgressPct, 75);
});

// ─── 評分守門 ───────────────────────────────
/** 評分測試用:有行動點的狀態(initKeeperState 從 0 起,回復發生在選卡開頭) */
const funded = (p: ReturnType<typeof defaultKeeperProfile>): KeeperState => ({
  ...initKeeperState(p),
  actionPoints: 6,
});

test('戲劇曲線守門:鋪陳期擋 medium,高潮全開', () => {
  const p = defaultKeeperProfile();
  const st = funded(p);
  assertEq(scoreCard(AGENDA, situation({ dramaTier: 'setup' }), st, p), null);
  assertEq(scoreCard(AGENDA, situation({ dramaTier: 'climax' }), st, p) !== null, true);
});

test('戲劇曲線守門:鋪陳期連 small 召喚也不放(只准氛圍類)', () => {
  const p = defaultKeeperProfile();
  const st = funded(p);
  assertEq(scoreCard(SUMMON, situation({ dramaTier: 'setup', aliveEnemies: 0 }), st, p), null);
  assertEq(scoreCard(AMBIENT, situation({ dramaTier: 'setup' }), st, p) !== null, true);
  assertEq(scoreCard(SUMMON, situation({ dramaTier: 'rising', aliveEnemies: 0 }), st, p) !== null, true);
});

test('無怪 → summon +3;蟄伏卡不可選;冷卻中不可選', () => {
  const p = defaultKeeperProfile();
  const st = funded(p);
  const sSummon = scoreCard(SUMMON, situation({ aliveEnemies: 0 }), st, p)!;
  const sSummonWithEnemies = scoreCard(SUMMON, situation({ aliveEnemies: 2 }), st, p)!;
  assertEq(sSummon > sSummonWithEnemies, true);
  assertEq(scoreCard(DORMANT, situation(), st, p), null, '無可執行效果 = 蟄伏');
  const cooled: KeeperState = { ...st, cooldowns: { summon: 2 } };
  assertEq(scoreCard(SUMMON, situation(), cooled, p), null);
});

test('避免單調:同類別連用扣分', () => {
  const p = defaultKeeperProfile();
  const st = funded(p);
  const fresh = scoreCard(AMBIENT, situation(), st, p)!;
  const repeat = scoreCard(AMBIENT, situation(), { ...st, lastCategory: 'general', lastCardId: 'other' }, p)!;
  assertEq(repeat < fresh, true);
});

// ─── 選卡 ───────────────────────────────────
test('選卡:行動點預算+累積上限+至多 2 張', () => {
  const p = defaultKeeperProfile({ keeper_action_per_player: 2 }, 4); // base 5, cap 14
  // 前回合剩 11 點 → 回復 +5 = 16 夾上限 14
  const prev: KeeperState = { actionPoints: 11, cooldowns: {}, uses: {}, lastCategory: null, lastCardId: null };
  const r = selectKeeperActivations([SUMMON, AGENDA, STATUS, AMBIENT], situation({ aliveEnemies: 0, dramaTier: 'climax' }), prev, p, () => 0);
  assertEq(r.activations.length, 2); // 每回合至多 2 張
  const spent = r.activations.reduce((s, c) => s + c.action_cost, 0);
  assertEq(r.state.actionPoints, 14 - spent); // 16 夾 14 後再扣
});

test('選卡:首回合行動點 = 基礎值,不雙算(BLOCK 回歸)', () => {
  const p = defaultKeeperProfile(undefined, 1); // 人數1:base 2, cap 8
  const fresh = initKeeperState(p);
  assertEq(fresh.actionPoints, 0);
  // 首回合:0 + 2 = 2(不雙算);#21 強制 AGENDA(費3)夾 0,買不起第二張
  const r = selectKeeperActivations([SUMMON, AGENDA, AMBIENT], situation({ aliveEnemies: 0, dramaTier: 'climax' }), fresh, p, () => 0);
  assertEq(r.activations.some((c) => c.id === 'agenda'), true);
  assertEq(r.state.actionPoints, 0, '首回合 2 點被費 3 議程夾 0');
});

test('人數加成:4 人隊城主在末日推進外還能再放一張(不再 AP 餓死)', () => {
  const p = defaultKeeperProfile({ keeper_action_per_player: 2 }, 4); // base 5
  // 首回合 5 點:#21 強制 AGENDA(3) + 剩 2 點 → 貪婪再放一張 cost≤2
  const r = selectKeeperActivations([SUMMON, AGENDA, STATUS, AMBIENT], situation({ aliveEnemies: 2, dramaTier: 'climax' }), initKeeperState(p), p, () => 0);
  assertEq(r.activations.length, 2, '末日推進 + 1 張');
  assertEq(r.activations.some((c) => c.id === 'agenda'), true, '末日推進仍每回合強制');
});

test('選卡:非 reusable 用過即不再選', () => {
  const p = defaultKeeperProfile();
  const oneShot = card({ id: 'once', name_zh: '一次卡', reusable: false, action_cost: 1 });
  const prev: KeeperState = { actionPoints: 0, cooldowns: {}, uses: { once: 1 }, lastCategory: null, lastCardId: null };
  const r = selectKeeperActivations([oneShot], situation(), prev, p, () => 0);
  assertEq(r.activations.length, 0);
});

test('#21 強制毀滅時鐘:鋪陳期/未快贏也保證放 advance_agenda(繞守門)', () => {
  const p = defaultKeeperProfile();
  const fresh = initKeeperState(p); // 0 → +3
  // setup tier + 玩家沒快贏 → scoreCard(AGENDA) 正常會被守門擋成 null;強制時鐘仍須放
  const r = selectKeeperActivations([AMBIENT, AGENDA], situation({ dramaTier: 'setup', playerProgressPct: 0 }), fresh, p, () => 0);
  assertEq(r.activations.some((c) => c.id === 'agenda'), true, '繞守門強制放議程卡');
  assertEq((r.state.uses['agenda'] ?? 0) >= 1, true, '記 uses');
});

test('#21 強制毀滅時鐘:不夠費用也放(夾 0),且非 reusable 用完不重放', () => {
  const p = defaultKeeperProfile();
  const oneShotDoom = card({ id: 'doomonce', name_zh: '一次推進', card_category: 'agenda', action_cost: 5, reusable: false, effects: [{ action_code: 'advance_agenda', action_params: { doom_tokens: 1 } }] });
  // 首回合只有 3 點 < 5,仍強制放(夾 0)
  const r1 = selectKeeperActivations([oneShotDoom], situation({ dramaTier: 'setup' }), initKeeperState(p), p, () => 0);
  assertEq(r1.activations.some((c) => c.id === 'doomonce'), true, '不夠費用也放');
  assertEq(r1.state.actionPoints, 0, '費用夾 0');
  // 下一回合該一次性議程卡已用完 → 不再強制(無其他議程卡 → 不放)
  const r2 = selectKeeperActivations([oneShotDoom], situation({ dramaTier: 'rising' }), r1.state, p, () => 0);
  assertEq(r2.activations.some((c) => c.id === 'doomonce'), false, '一次性用完不重放');
});

// ─── 效果執行 ───────────────────────────────
test('advance_agenda / horror cap / set_visibility 結算', () => {
  const sc = makeScenario();
  const inv = makeInv({ san: 1 });
  const r1 = executeMythosCard(AGENDA, sc, inv, ENEMY_DATA, () => 0);
  assertEq(r1.scenario.agendaProgress, 2);
  // 紅線一護欄:SAN 1 受 2 點會歸零 → cap 改 1
  const r2 = executeMythosCard(STATUS, sc, inv, ENEMY_DATA, () => 0);
  assertEq(r2.investigator.san, 0); // 1 - 1(capped)
  const r3 = executeMythosCard(AMBIENT, sc, makeInv(), ENEMY_DATA, () => 0);
  assertEq(r3.scenario.locations[0].visibility, 'darkness');
});

test('summon:家族×位階篩選 + nearest_to_clue 落點 + 功能互補', () => {
  const sc = makeScenario({
    tokens: [{ tokenType: 'clue', locationId: 'B', amount: 1 }],
    enemies: [{ instanceId: 'e0', enemyDefinitionId: 'rev_t1', locationId: 'A', hp: 4, engagedWith: [], modifiers: [] }],
  });
  // family house_cthulhu tier1 → rev_t1(cultist 是 fallen 不入選)
  const r = executeMythosCard(SUMMON, sc, makeInv(), ENEMY_DATA, () => 0);
  assertEq(r.scenario.enemies.length, 2);
  const spawned = r.scenario.enemies[1];
  assertEq(spawned.enemyDefinitionId, 'rev_t1');
  assertEq(spawned.locationId, 'B', 'nearest_to_clue 落在有線索的地點');
  assertEq(spawned.modifiers.includes('summon_sickness'), true);
});

test('持續附著類回傳 attachments + 檢定修正查詢', () => {
  const smell = card({ id: 'smell', name_zh: '海腥味瀰漫', effects: [{ action_code: 'test_modifier', action_params: { attribute: 'perception', modifier: -1 } }] });
  const r = executeMythosCard(smell, makeScenario(), makeInv(), ENEMY_DATA, () => 0);
  assertEq(r.attachments.length, 1);
  assertEq(attachmentTestModifier(r.attachments, 'perception'), -1);
  assertEq(attachmentTestModifier(r.attachments, 'strength'), 0);
});

test('附著 upkeep:瘋狂攫住強制棄牌,意志檢定過 → 解除', () => {
  const madness: KeeperAttachment = {
    cardId: 'mad', name: '瘋狂攫住', action_code: 'attach_status',
    action_params: { status: 'madness', upkeep_discard: 1, release_test: 'willpower', release_dc: 3 },
  };
  // roll 15 + 意志 3 = 18 ≥ 13 → 解除
  const pass = runAttachmentUpkeep([madness], makeInv(), () => 14 / 20);
  assertEq(pass.investigator.hand.length, 1, '先棄 1 張');
  assertEq(pass.attachments.length, 0, '檢定過 → 解除');
  // roll 2 + 3 = 5 < 13 → 留著
  const fail = runAttachmentUpkeep([madness], makeInv(), () => 1 / 20);
  assertEq(fail.attachments.length, 1);
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
