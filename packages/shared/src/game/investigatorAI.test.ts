/**
 * G-04 調查員 AI v0 單元測試 — 人格即資料(鏡射 keeperAI 測試模式)
 */
import {
  AI_INVESTIGATOR_ROSTER,
  rosterProfileForTemplate,
  materializeAIInvestigator,
  initInvestigatorAIState,
  estimateSuccessChance,
  chooseCommitCards,
  enumerateCandidates,
  planNextAction,
  runInvestigatorAITurn,
} from './investigatorAI';
import type { InvestigatorAIProfile, InvestigatorAIContext } from './investigatorAI';
import type { ScenarioState, InvestigatorState } from './state';
import type { CardDataLookup, StyleCardData } from './ruleEngine';
import type { EnemyDataLookup } from './monsterActions';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ─── fixtures ───────────────────────────────
function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'ai-1', investigatorDefinitionId: 'd', ownerPlayerId: 'ai',
    attributes: { strength: 1, agility: 2, constitution: 2, reflex: 1, intellect: 4, willpower: 2, perception: 3, charisma: 1 },
    combatStyle: 'assassin', specializations: [], deck: ['dk1', 'dk2'], hand: [], discardPile: [], removedPile: [], assetsInPlay: [],
    hp: 7, hpMax: 7, san: 7, sanMax: 7, actionPoints: 3, resources: 2, currentLocationId: 'A',
    engagedWith: [], triggeredHorrorChecks: [], traumas: [], secretTaskState: null, permanentlyDead: false, startingXp: 0,
    ...over,
  };
}

function makeAlly(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return makeInv({ investigatorId: 'p1-inv', ownerPlayerId: 'p1', ...over });
}

function makeScenario(over: Partial<ScenarioState> = {}): ScenarioState {
  return {
    scenarioId: 's', scenarioDefinitionId: 's', campaignId: 'c',
    locations: [
      { locationDefinitionId: 'A', visibility: 'day', connectedTo: ['B'], isObstacle: false },
      { locationDefinitionId: 'B', visibility: 'day', connectedTo: ['A'], isObstacle: false },
    ],
    unlockedLocations: ['A', 'B'],
    enemies: [], tokens: [], agendaProgress: 0, objectiveProgress: 0,
    chaosBag: [], turnNumber: 2, phase: 'investigator',
    ...over,
  };
}

const ENEMY_DATA: EnemyDataLookup = {
  rev_t1: { name_zh: '深潛者亡靈', tier: 1, hp_base: 4, dc: 10, damage_physical: 1, keywords: [] },
};

const STYLE_POOL: Record<string, StyleCardData[]> = {
  assassin: [
    { code: 'as1', name_zh: '無聲匕首', check_attribute: 'reflex' },
    { code: 'as2', name_zh: '弱點直覺', check_attribute: 'intellect' },
  ],
};

const CARDS: CardDataLookup = {
  skill_per: { name_zh: '偵探的觀察', card_type: 'skill', cost: 0, commit_icons: { perception: 2 }, effects: [] },
  skill_all: { name_zh: '偵探的直覺', card_type: 'skill', cost: 0, commit_icons: { all: 1 }, effects: [] },
  weapon: {
    name_zh: '古籍裁紙刀', card_type: 'asset', cost: 1, combat_style: 'assassin',
    attribute_modifiers: { reflex: 1 },
    effects: [{ trigger_type: 'action', effect_code: 'attack', effect_params: { damage: 2 } }],
  },
  ally_card: { name_zh: '偵探的線人', card_type: 'ally', cost: 2, effects: [] },
  dmg_event: { name_zh: '隱身刺殺', card_type: 'event', cost: 2, effects: [{ trigger_type: 'action', effect_code: 'deal_damage', effect_params: { amount: 2 } }] },
};

const ELIAS = AI_INVESTIGATOR_ROSTER[0];
const MARCUS = AI_INVESTIGATOR_ROSTER[3];

function ctx(over: Partial<InvestigatorAIContext> = {}): InvestigatorAIContext {
  return {
    scenario: makeScenario(),
    investigator: makeInv(),
    allies: {},
    turnNumber: 2,
    locationStats: { A: { shroud: 10 }, B: { shroud: 10 } },
    enemyStats: ENEMY_DATA,
    cardLookup: CARDS,
    stylePools: STYLE_POOL,
    rng: () => 0.5,
    ...over,
  };
}

// ─── 名冊 ───────────────────────────────────
test('名冊:四位 INTJ,自由配點各 +4,模板綁定可反查', () => {
  assertEq(AI_INVESTIGATOR_ROSTER.length, 4);
  for (const p of AI_INVESTIGATOR_ROSTER) {
    const sum = Object.values(p.freeAttributePoints).reduce((a, b) => a + Number(b ?? 0), 0);
    assertEq(sum, 4, p.name_zh + ' 自由配點必須 4 點');
    assert(p.name_zh.length > 0, '名字是 AI 的靈魂,不可空白');
    assertEq(rosterProfileForTemplate(p.templateId)?.rosterCode, p.rosterCode);
  }
});

test('名冊落地:INTJ 基底 14 + 自由 4 = 18,單項上限 5,改掛 AI 席位', () => {
  for (const p of AI_INVESTIGATOR_ROSTER) {
    // INTJ 模板基底 1/2/2/1/4/2/1/1 = 14(資料庫實值)
    const built = makeInv({
      attributes: { strength: 1, agility: 2, constitution: 2, reflex: 1, intellect: 4, willpower: 2, perception: 1, charisma: 1 },
    });
    const done = materializeAIInvestigator(built, p);
    const sum = Object.values(done.attributes).reduce((a, b) => a + b, 0);
    assertEq(sum, 18, p.name_zh + ' 屬性總和');
    assert(Object.values(done.attributes).every((v) => v <= 5), p.name_zh + ' 創角上限 5');
    assertEq(done.ownerPlayerId, 'ai');
    assertEq(done.combatStyle, p.combatStyle);
    // HP/SAN 公式(ch6 §3.1)按配點後屬性重算
    assertEq(done.hpMax, done.attributes.constitution * 2 + 5, p.name_zh + ' HP 公式');
    assertEq(done.sanMax, done.attributes.willpower * 2 + 5, p.name_zh + ' SAN 公式');
  }
});

// ─── 成功率估算 ──────────────────────────────
test('成功率:邊界保留天 1 / 天 20', () => {
  assertEq(estimateSuccessChance(0, 30), 1 / 20, '不可能的檢定也有天 20');
  assertEq(estimateSuccessChance(10, 2), 19 / 20, '必過的檢定也有天 1');
  assertEq(estimateSuccessChance(4, 14), 11 / 20, '需要 roll ≥ 10 → 11 面');
});

// ─── 投入加值 ───────────────────────────────
test('commit:成功邊緣才投,已穩不投,絕望不投', () => {
  const inv = makeInv({ hand: ['skill_per', 'skill_all'] });
  // 感知 3 vs DC 14:needed 11 → 0.5 邊緣 → 投到 ≥0.75
  const marginal = chooseCommitCards(inv, CARDS, 'perception', 3, 14);
  assert(marginal.length >= 1, '邊緣檢定要投牌');
  assertEq(marginal[0], 'skill_per', '先投圖示多的');
  // 感知 3 vs DC 6:已穩 → 不投
  assertEq(chooseCommitCards(inv, CARDS, 'perception', 3, 6).length, 0);
  // 感知 3 vs DC 25:投好投滿也不到 45% → 收回
  assertEq(chooseCommitCards(inv, CARDS, 'perception', 3, 25).length, 0);
});

// ─── 評分地形:個性分流 ────────────────────────
test('個性:同一局面,偵探選調查,軍官選攻擊', () => {
  const enemy = { instanceId: 'e1', enemyDefinitionId: 'rev_t1', locationId: 'A', hp: 4, engagedWith: [], modifiers: [] };
  const c = ctx({ scenario: makeScenario({ enemies: [enemy] }), investigator: makeInv({ attributes: { ...makeInv().attributes, strength: 3 } }) });
  const eliasPick = planNextAction(c, ELIAS, initInvestigatorAIState());
  const marcusPick = planNextAction(c, MARCUS, initInvestigatorAIState());
  assertEq(eliasPick?.actionType, 'investigate', '伊萊亞斯的執念是線索');
  assert(marcusPick?.actionType === 'attack' || marcusPick?.actionType === 'execute_card_action', '馬庫斯迎向威脅:' + marcusPick?.actionType);
});

test('守護:怪纏住隊友 → 嘲諷/攻擊加權浮現', () => {
  const enemy = { instanceId: 'e1', enemyDefinitionId: 'rev_t1', locationId: 'A', hp: 4, engagedWith: ['p1-inv'], modifiers: [] };
  const ally = makeAlly({ currentLocationId: 'A', engagedWith: ['e1'] });
  const c = ctx({ scenario: makeScenario({ enemies: [enemy] }), allies: { 'p1-inv': ally } });
  const candidates = enumerateCandidates(c, MARCUS, initInvestigatorAIState());
  const taunt = candidates.find((x) => x.actionType === 'taunt');
  assert(!!taunt, '鐵壁要會拉仇恨');
  assert((taunt?.score ?? 0) >= MARCUS.weights.protectAllies, '守護權重要進分數');
});

test('退守:HP 低 → 壓攻擊、抬閃避', () => {
  const enemy = { instanceId: 'e1', enemyDefinitionId: 'rev_t1', locationId: 'A', hp: 4, engagedWith: ['ai-1'], modifiers: [] };
  const c = ctx({
    scenario: makeScenario({ enemies: [enemy] }),
    investigator: makeInv({ hp: 1, engagedWith: ['e1'], attributes: { ...makeInv().attributes, strength: 3 } }),
  });
  const pick = planNextAction(c, MARCUS, initInvestigatorAIState());
  assertEq(pick?.actionType, 'evade', '瀕危的老兵也知道何時撤(實際:' + pick?.actionType + ')');
});

test('風險容忍:艾達(0.3)不碰絕望檢定,黑暗高 DC 攻擊直接出局', () => {
  const ada = AI_INVESTIGATOR_ROSTER[2];
  const enemy = { instanceId: 'e1', enemyDefinitionId: 'hard', locationId: 'A', hp: 4, engagedWith: [], modifiers: [] };
  const c = ctx({
    scenario: makeScenario({
      enemies: [enemy],
      locations: [
        { locationDefinitionId: 'A', visibility: 'darkness', connectedTo: ['B'], isObstacle: false },
        { locationDefinitionId: 'B', visibility: 'darkness', connectedTo: ['A'], isObstacle: false },
      ],
    }),
    enemyStats: { hard: { name_zh: '硬殼', dc: 22, hp_base: 4 } },
    investigator: makeInv({ hand: [] }),
  });
  const candidates = enumerateCandidates(c, ada, initInvestigatorAIState());
  assert(!candidates.some((x) => x.actionType === 'attack'), '徒手打 DC22 是致命誤算,她不做');
});

test('出牌:有威脅且沒武器 → 武器鋪場優先於盟友', () => {
  const enemy = { instanceId: 'e1', enemyDefinitionId: 'rev_t1', locationId: 'B', hp: 4, engagedWith: [], modifiers: [] };
  const c = ctx({
    scenario: makeScenario({ enemies: [enemy] }),
    investigator: makeInv({ hand: ['weapon', 'ally_card'], resources: 3 }),
  });
  const candidates = enumerateCandidates(c, ELIAS, initInvestigatorAIState());
  const weapon = candidates.find((x) => x.actionType === 'play_card' && (x.payload.cardInstanceId === 'weapon'));
  const ally = candidates.find((x) => x.actionType === 'play_card' && (x.payload.cardInstanceId === 'ally_card'));
  assert(!!weapon && !!ally, '兩張都該是候選');
  assert((weapon?.score ?? 0) > (ally?.score ?? 0), '威脅在場,先亮刀');
});

test('目標導向:幕目標 boss 在場 → 攻擊壓過搜線索(否則悠哉搜到全滅都不打 boss)', () => {
  const boss = { instanceId: 'b1', enemyDefinitionId: 'rev_t1', locationId: 'A', hp: 12, engagedWith: [], modifiers: [] };
  const base = { scenario: makeScenario({ enemies: [boss] }), investigator: makeInv({ attributes: { ...makeInv().attributes, strength: 3 } }) };
  // 無目標:clueFocus 3.0 的 Elias 傾向搜線索
  const without = enumerateCandidates(ctx(base), ELIAS, initInvestigatorAIState());
  const wInv = without.find((c) => c.actionType === 'investigate');
  // 有目標(同隻 boss 設為幕目標)→ 攻擊分數壓過搜線索,且搜線索被壓低
  const withObj = enumerateCandidates(ctx({ ...base, objectiveEnemyCodes: ['rev_t1'] }), ELIAS, initInvestigatorAIState());
  const oInv = withObj.find((c) => c.actionType === 'investigate');
  const oAtk = withObj.find((c) => c.actionType === 'attack');
  assert(!!oAtk, '該有攻擊候選');
  assert((oAtk?.score ?? 0) > (oInv?.score ?? 0), '目標在場:攻擊 > 搜線索');
  assert((oInv?.score ?? 99) < (wInv?.score ?? 0), '目標在場時搜線索分數被壓低');
});

test('決策溫度:0 永遠最佳;觸發時選次佳(會犯小錯)', () => {
  const enemy = { instanceId: 'e1', enemyDefinitionId: 'rev_t1', locationId: 'A', hp: 4, engagedWith: [], modifiers: [] };
  const base = ctx({ scenario: makeScenario({ enemies: [enemy] }) });
  const cold: InvestigatorAIProfile = { ...ELIAS, temperature: 0 };
  const hot: InvestigatorAIProfile = { ...ELIAS, temperature: 1 };
  const best = planNextAction({ ...base, rng: () => 0.99 }, cold, initInvestigatorAIState());
  const slip = planNextAction({ ...base, rng: () => 0.0 }, hot, initInvestigatorAIState());
  assert(best !== null && slip !== null, '都要有解');
  assert(best!.score >= slip!.score, '溫度觸發時分數不高於最佳');
});

// ─── 回合執行(與真人同管線)────────────────────
test('AI 回合:行動點花好花滿,步步合法,行動點歸零停', () => {
  const c = ctx({ investigator: makeInv({ hand: ['skill_per'], deck: ['dk1', 'dk2', 'dk3'] }) });
  const r = runInvestigatorAITurn(c, ELIAS, initInvestigatorAIState());
  assert(r.steps.length >= 3, '3 行動點要做 3 件事(實際 ' + r.steps.length + ')');
  assert(r.steps.every((s) => s.outcome === 'accepted'), '全部要過規則引擎');
  assertEq(r.investigator.actionPoints, 0, '行動點花完');
});

test('AI 回合:調查成功會放線索(走真引擎結算,不是自己改狀態)', () => {
  // rng 固定 0.9 → d20 = 19 → 必過 shroud 10
  const c = ctx({ rng: () => 0.9, investigator: makeInv({ hand: [] }) });
  const r = runInvestigatorAITurn(c, ELIAS, initInvestigatorAIState());
  const investigated = r.steps.filter((s) => s.actionType === 'investigate');
  assert(investigated.length > 0, '偵探要調查');
  assert(r.scenario.objectiveProgress > 0, '線索進度要進場景層');
});

test('AI 回合:防呆 — 駁回即停,不跟規則吵架', () => {
  // 行動點 0 開局 → 第一個候選就被駁回 → steps 至多 1 筆 rejected
  const c = ctx({ investigator: makeInv({ actionPoints: 0 }) });
  const r = runInvestigatorAITurn(c, ELIAS, initInvestigatorAIState());
  assertEq(r.steps.length, 0, '沒行動點不該嘗試');
});

test('弱點卡與無類型卡都不進出牌候選(模擬抓洞回歸)', () => {
  const lookup = {
    ...CARDS,
    wk_card: { name_zh: '反追蹤', card_type: 'weakness', cost: 0, effects: [] },
    untyped: { name_zh: '形狀不明', cost: 0, effects: [] }, // card_type undefined(弱點列原始形狀)
  };
  const c = ctx({ cardLookup: lookup, investigator: makeInv({ hand: ['wk_card', 'untyped'], resources: 5 }) });
  const candidates = enumerateCandidates(c, ELIAS, initInvestigatorAIState());
  assert(!candidates.some((x) => x.actionType === 'play_card'), '弱點/無類型不該被打出');
});

test('卡片優先 + 存錢買刀(Uria 裁定:卡片價值永遠比單純動作高)', () => {
  const enemy = { instanceId: 'e1', enemyDefinitionId: 'rev_t1', locationId: 'B', hp: 4, engagedWith: [], modifiers: [] };
  // 口袋空空 + 手上有 2 費武器 + 場上有威脅 → 第一優先是存錢(繼承武器折扣分)
  const broke = ctx({
    scenario: makeScenario({ enemies: [enemy] }),
    investigator: makeInv({ hand: ['weapon'], resources: 0 }),
  });
  const savePick = planNextAction(broke, MARCUS, initInvestigatorAIState());
  assertEq(savePick?.actionType, 'gain_resource', '沒錢先存錢(實際:' + savePick?.actionType + ')');
  // 存夠了 → 打出武器壓過單純動作
  const funded = ctx({
    scenario: makeScenario({ enemies: [enemy] }),
    investigator: makeInv({ hand: ['weapon'], resources: 2 }),
  });
  const playPick = planNextAction(funded, MARCUS, initInvestigatorAIState());
  assertEq(playPick?.actionType, 'play_card', '買得起就亮刀(實際:' + playPick?.actionType + ')');
});

test('交戰低血時不站著存錢(Raviel BLOCK 回歸):閃避壓過存錢', () => {
  const enemy = { instanceId: 'e1', enemyDefinitionId: 'rev_t1', locationId: 'A', hp: 4, engagedWith: ['ai-1'], modifiers: [] };
  const c = ctx({
    scenario: makeScenario({ enemies: [enemy] }),
    // 低血 + 被纏 + 手上有買不起的武器:存錢繼承分必須被掐掉
    investigator: makeInv({ hp: 1, engagedWith: ['e1'], hand: ['weapon'], resources: 0 }),
  });
  for (const p of AI_INVESTIGATOR_ROSTER) {
    const pick = planNextAction({ ...c, rng: () => 0.99 }, { ...p, temperature: 0 }, initInvestigatorAIState());
    assertEq(pick?.actionType, 'evade', p.name_zh + ' 該逃命不該購物(實際:' + pick?.actionType + ')');
  }
});

test('救援優先:同地點隊友瀕死 → 全員放下手邊事先穩定', () => {
  const downedAlly = makeAlly({ currentLocationId: 'A', hp: 0, downed: true });
  const enemy = { instanceId: 'e1', enemyDefinitionId: 'rev_t1', locationId: 'A', hp: 4, engagedWith: [], modifiers: [] };
  const c = ctx({
    scenario: makeScenario({ enemies: [enemy] }),
    allies: { 'p1-inv': downedAlly },
  });
  for (const p of AI_INVESTIGATOR_ROSTER) {
    const pick = planNextAction({ ...c, rng: () => 0.99 }, { ...p, temperature: 0 }, initInvestigatorAIState());
    assertEq(pick?.actionType, 'stabilize', p.name_zh + ' 該先救人(實際:' + pick?.actionType + ')');
  }
});

test('救援移動:隊友在隔壁倒地 → 趕過去', () => {
  const downedAlly = makeAlly({ currentLocationId: 'B', hp: 0, downed: true });
  const c = ctx({ allies: { 'p1-inv': downedAlly } });
  const pick = planNextAction({ ...c, rng: () => 0.99 }, { ...MARCUS, temperature: 0 }, initInvestigatorAIState());
  assertEq(pick?.actionType, 'move', '馬庫斯該衝過去(實際:' + pick?.actionType + ')');
  assertEq(pick?.payload.targetLocationId, 'B');
});

test('防踱步:剛離開的地點吃回頭罰', () => {
  const c = ctx();
  const state = { lastActionType: 'move', cameFromLocationId: 'B' };
  const candidates = enumerateCandidates(c, ELIAS, state);
  const back = candidates.find((x) => x.actionType === 'move' && x.payload.targetLocationId === 'B');
  // B 沒有任何誘因 + 回頭罰 → 不該成為候選(分數 ≤ 0.2 被濾掉)
  assert(!back, '不來回踱步');
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
