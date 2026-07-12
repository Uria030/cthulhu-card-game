/**
 * G-01 開局包轉換器單元測試
 * fixture 形狀對齊 production 裂嘴女關卡實際資料(2026-06-11 驗過)
 */
import { buildGameFromBootstrap, buildChaosBag, mapEnvironmentToVisibility } from './bootstrap';
import type { StageBootstrap } from './bootstrap';
import { adoptTeamSpirit, emptyTalentProgress, initCampaignProgress, investTeamSpirit, registerInvestigator } from './campaignProgress';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error((msg ?? 'assertEq 失敗') + ': expected=' + String(expected) + ', actual=' + String(actual));
  }
}

function makeFixture(): StageBootstrap {
  return {
    stage: {
      id: 'stage-1',
      code: 'g_slit_mouth_legend_st1',
      name_zh: '雨夜的真相',
      narrative: '雨夜…',
      scenarios: [
        {
          id: 'scn-1',
          scenario_order: 1,
          name_zh: '裂嘴女',
          narrative: '',
          initial_location_codes: ['lib', 'pier', 'downtown'],
          initial_connections: [
            { from: 'lib', to: 'pier' },
            { from: 'pier', to: 'downtown', obstacle: true },
          ],
          investigator_spawn_location: 'lib',
          initial_environment: { main: '夜間', modifiers: ['雨'] },
          initial_enemies: [],
        },
      ],
      act_cards: [],
      agenda_cards: [],
      chaos_bag: {
        number_markers: { '0': 2, '+1': 1, '-1': 2 },
        scenario_markers: { skull: { count: 2, value: -1, effect: 'blood_sacrifice' } },
      },
    },
    campaign: { id: 'camp-1', code: 'g_slit_mouth_legend', name_zh: '裂嘴女的傳說' },
    chapter: { id: 'ch-1', name_zh: '雨夜的真相', outcomes: [] },
    locations: [
      { id: 'L1', code: 'lib', name_zh: '圖書館', clues_base: 2, clues_per_player: 1 },
      { id: 'L2', code: 'pier', name_zh: '碼頭', clues_base: 0, clues_per_player: 0 },
      { id: 'L3', code: 'downtown', name_zh: '市區', clues_base: 1, clues_per_player: 0 },
    ],
    mythos_cards: [],
    encounter_cards: [],
    monsters: [
      { id: 'M1', code: 'mv_rogue_thug', hp_base: 3, hp_per_player: 1 },
    ],
    monster_attack_cards: [],
    upgrade_cards: [
      { id: 'c2', name_zh: '老練射擊', card_type: 'skill', cost: 0, effects: [], starting_xp: 2 },
    ],
    talent_tree: null,
    talent_cards: [
      { id: 'tc1', code: 'TE1-001', name_zh: '戰術預案', card_type: 'skill', cost: 0, effects: [], starting_xp: 0 },
    ],
    investigator: {
      id: 'inv-uuid',
      code: 'istp_1',
      name_zh: '鐵證',
      attr_strength: 4,
      attr_agility: 3,
      attr_constitution: 3,
      attr_reflex: 4,
      attr_intellect: 2,
      attr_willpower: 2,
      attr_perception: 3,
      attr_charisma: 1,
      proficiency_ids: ['shooting'],
      starting_deck: [
        {
          deck_entry_id: 'd1',
          quantity: 2,
          slot_order: 1,
          card_definition_id: 'c1',
          signature_card_id: null,
          weakness_id: null,
          card: { id: 'c1', name_zh: '手電筒', card_type: 'asset', cost: 1, effects: [] },
          signature_card: null,
          weakness: null,
        },
        {
          deck_entry_id: 'd2',
          quantity: 1,
          slot_order: 2,
          card_definition_id: null,
          signature_card_id: 's1',
          weakness_id: null,
          card: null,
          signature_card: { id: 's1', name_zh: '鐵證如山', card_type: 'event', cost: 0 },
          weakness: null,
        },
        {
          deck_entry_id: 'd3',
          quantity: 1,
          slot_order: 3,
          card_definition_id: null,
          signature_card_id: null,
          weakness_id: 'w1',
          card: null,
          signature_card: null,
          weakness: { id: 'w1', name_zh: '舊傷', card_type: 'weakness' },
        },
      ],
    },
  };
}

// 固定亂數:不洗牌(回傳 0 → Fisher–Yates 全部換到最前,順序可預測但重點是穩定)
const fixedRng = () => 0;

// ─── 測試 1:地點拓撲雙向連線 ──────────────────
test('地點拓撲:連線雙向展開', () => {
  const g = buildGameFromBootstrap(makeFixture(), { rng: fixedRng });
  const lib = g.scenario.locations.find((l) => l.locationDefinitionId === 'lib')!;
  const pier = g.scenario.locations.find((l) => l.locationDefinitionId === 'pier')!;
  assertEq(lib.connectedTo.includes('pier'), true);
  assertEq(pier.connectedTo.includes('lib'), true);
  assertEq(pier.connectedTo.includes('downtown'), true);
});

// ─── 測試 2:obstacle 連線 → 目的地標障礙 ────────
test('obstacle 連線標記目的地', () => {
  const g = buildGameFromBootstrap(makeFixture(), { rng: fixedRng });
  const downtown = g.scenario.locations.find((l) => l.locationDefinitionId === 'downtown')!;
  const lib = g.scenario.locations.find((l) => l.locationDefinitionId === 'lib')!;
  assertEq(downtown.isObstacle, true);
  assertEq(lib.isObstacle, false);
});

// ─── 測試 3:環境 → 視野光照 ───────────────────
test('夜間環境映射 night', () => {
  assertEq(mapEnvironmentToVisibility({ main: '夜間' }), 'night');
  assertEq(mapEnvironmentToVisibility({ main: '白天' }), 'day');
  assertEq(mapEnvironmentToVisibility({ main: '黑暗' }), 'darkness');
  assertEq(mapEnvironmentToVisibility(null), 'day');
});

// ─── 測試 4:混沌袋展開數量與值 ─────────────────
test('混沌袋 token 展開', () => {
  const bag = buildChaosBag(makeFixture().stage.chaos_bag);
  assertEq(bag.length, 2 + 1 + 2 + 2); // 0×2, +1×1, -1×2, skull×2
  const skulls = bag.filter((t) => t.type === 'skull');
  assertEq(skulls.length, 2);
  assertEq(skulls[0].value, -1);
  const plusOne = bag.filter((t) => t.type === 'numeric' && t.value === 1);
  assertEq(plusOne.length, 1);
});

// ─── 測試 5:牌組 quantity 展開 + 手牌/牌庫分割 ───
test('牌組展開 4 張(2+1+1),手牌上限分割', () => {
  const g = buildGameFromBootstrap(makeFixture(), { rng: fixedRng, openingHandSize: 3 });
  const total = g.investigator.hand.length + g.investigator.deck.length;
  assertEq(total, 4);
  assertEq(g.investigator.hand.length, 3);
  assertEq(g.investigator.deck.length, 1);
  assertEq(Object.keys(g.cardIndex).length, 4);
});

// ─── 測試 6:cardIndex 三種來源都建檔 ───────────
test('cardIndex 含 card_definition/signature/weakness', () => {
  const g = buildGameFromBootstrap(makeFixture(), { rng: fixedRng });
  const sources = new Set(Object.values(g.cardIndex).map((c) => c.source));
  assertEq(sources.has('card_definition'), true);
  assertEq(sources.has('signature'), true);
  assertEq(sources.has('weakness'), true);
});

// ─── 測試 7:線索 token 按 clues_base + per_player ─
test('線索 token 數量(單人)', () => {
  const g = buildGameFromBootstrap(makeFixture(), { rng: fixedRng, playerCount: 1 });
  const libClue = g.scenario.tokens.find((t) => t.locationId === 'lib');
  assertEq(libClue?.amount, 3); // 2 + 1×1
  const pierClue = g.scenario.tokens.find((t) => t.locationId === 'pier');
  assertEq(pierClue, undefined); // 0 線索不放 token
});

// ─── 測試 8:出生點與屬性對映 ──────────────────
test('調查員出生點 + 八屬性', () => {
  const g = buildGameFromBootstrap(makeFixture(), { rng: fixedRng });
  assertEq(g.investigator.currentLocationId, 'lib');
  assertEq(g.investigator.attributes.strength, 4);
  assertEq(g.investigator.attributes.charisma, 1);
  assertEq(g.investigator.combatStyle, 'shooting');
});

test('開局含可持久化城主狀態', () => {
  const g = buildGameFromBootstrap(makeFixture(), { rng: fixedRng });
  assertEq(g.scenario.keeperState?.actionPoints, 0);
  assertEq(Object.keys(g.scenario.keeperState?.cooldowns ?? {}).length, 0);
  assertEq(Object.keys(g.scenario.keeperState?.uses ?? {}).length, 0);
  assertEq(g.scenario.keeperState?.lastCardId, null);
});

// ─── 測試 9:initial_enemies 形狀支援 ───────────
test('initial_enemies 展開含 hp_per_player', () => {
  const fx = makeFixture();
  fx.stage.scenarios[0].initial_enemies = [
    { variant_code: 'mv_rogue_thug', location_code: 'pier', count: 2 },
  ];
  const g = buildGameFromBootstrap(fx, { rng: fixedRng, playerCount: 2 });
  assertEq(g.scenario.enemies.length, 2);
  assertEq(g.scenario.enemies[0].locationId, 'pier');
  assertEq(g.scenario.enemies[0].hp, 4); // 3 + 1×(2-1)
});

// ─── 測試 10:無場景丟明確錯誤 ──────────────────
test('無場景時丟錯', () => {
  const fx = makeFixture();
  fx.stage.scenarios = [];
  let threw = false;
  try {
    buildGameFromBootstrap(fx, { rng: fixedRng });
  } catch {
    threw = true;
  }
  assertEq(threw, true);
});

// ─── 測試 11:E4 CampaignProgress 牌組組成進下一場 ───
test('CampaignProgress carryover deck 重建一般牌組,並保留簽名/弱點', () => {
  const fx = makeFixture();
  let progress = registerInvestigator(initCampaignProgress('camp-1'), {
    investigatorDefinitionId: 'inv-uuid',
    deck: ['c1', 'c2'],
    combatStyle: 'shooting',
    specializations: [],
    hpMax: 11,
    sanMax: 9,
  });
  progress = { ...progress, investigators: { 'inv-uuid': { ...progress.investigators['inv-uuid'], xp: 1 } } };
  const g = buildGameFromBootstrap(fx, { rng: fixedRng, openingHandSize: 20, campaignProgress: progress });
  const cards = Object.values(g.cardIndex);
  assertEq(cards.filter((c) => c.sourceId === 'c1').length, 1, 'carryover deck 控制一般卡副本數');
  assertEq(cards.filter((c) => c.sourceId === 'c2').length, 1, '購買卡可由 upgrade_cards 卡池實例化');
  assertEq(cards.some((c) => c.source === 'signature'), true, '簽名卡仍保留');
  assertEq(cards.some((c) => c.source === 'weakness'), true, '弱點仍保留');
});

// ─── 測試 12:E5 天賦 carryover 生效 ────────────
test('CampaignProgress talents 注入下一場:屬性加成、被動快照、天賦卡卡面', () => {
  const fx = makeFixture();
  const talents = emptyTalentProgress();
  talents.unlockedNodeIds = ['n1', 'n2'];
  talents.factionLevels.E = 2;
  talents.attributeBonuses.constitution = 1;
  talents.passiveEffects = [{
    nodeId: 'n1',
    factionCode: 'E',
    branchIndex: null,
    nodeType: 'passive',
    name_zh: '冷靜指令',
    effectCode: 'passive_team_focus',
    effectParams: { amount: 1 },
    description_zh: '隊伍保持冷靜。',
  }];
  let progress = registerInvestigator(initCampaignProgress('camp-1'), {
    investigatorDefinitionId: 'inv-uuid',
    deck: ['c1', 'tc1'],
    combatStyle: 'shooting',
    specializations: [],
    hpMax: 11,
    sanMax: 9,
  });
  progress = { ...progress, investigators: { 'inv-uuid': { ...progress.investigators['inv-uuid'], talents } } };
  const g = buildGameFromBootstrap(fx, { rng: fixedRng, openingHandSize: 20, campaignProgress: progress });
  assertEq(g.investigator.attributes.constitution, 4, '體質 3 + 天賦 1');
  assertEq(g.investigator.hpMax, 13, 'HP 上限吃 boosted constitution');
  assertEq(g.investigator.talentNodeIds?.includes('n2'), true);
  assertEq(g.investigator.talentEffects?.[0].effectCode, 'passive_team_focus');
  assertEq(Object.values(g.cardIndex).some((c) => c.sourceId === 'tc1'), true, '天賦卡由 talent_cards 卡池補卡面');
});

// ─── 測試 13:E8 團隊精神 carryover 生效 ─────────
test('CampaignProgress teamSpirits 注入下一場:已採用精神、深度、效果快照', () => {
  const spirit = {
    id: 'spirit-1',
    code: 'ts_focus_fire',
    name_zh: '集火協調',
    category: 'combat',
    adopt_effect_zh: '隊伍開始演練集火節奏。',
    depth_effects: [
      { id: 'd1', depth: 1, effect_desc_zh: '攻擊同一目標時更容易協調。', effect_value: 1 },
    ],
  };
  let progress = adoptTeamSpirit({ ...initCampaignProgress('camp-1'), cohesion: 3 }, spirit).progress;
  progress = investTeamSpirit(progress, spirit).progress;
  const g = buildGameFromBootstrap(makeFixture(), { rng: fixedRng, campaignProgress: progress });
  assertEq(g.campaign.cohesion, 1);
  assertEq(g.campaign.unlockedTeamSpirits.includes('ts_focus_fire'), true);
  assertEq(g.campaign.teamSpiritInvestments?.ts_focus_fire.points, 1);
  assertEq(g.campaign.teamSpiritEffects?.some((e) => e.effectCode === 'team_spirit:depth:1'), true);
});

// ─── runner ─────────────────────────────────
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
