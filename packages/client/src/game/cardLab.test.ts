import type { CardLabManifest } from '../api';
import { buildCardLabSetup, CARD_LAB_STAGE_ID } from './cardLab';
import type { GameSetup } from './gameSetup';
import { normaliseBootstrapCardData } from './cardDataAdapter';
import { bootPreloadPlan } from './preloadPlan';

type TestFn = () => void;
const tests: Array<{ name: string; fn: TestFn }> = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) throw new Error(`${message ?? 'assertEq'}: expected=${String(expected)}, actual=${String(actual)}`);
}

const manifest: CardLabManifest = {
  id: 'card-lab',
  version: 1,
  title: '卡片效果實驗場',
  baseStageId: 'stage-base',
  locations: [
    { code: 'card_lab_entrance', name_zh: '實驗場入口', description_zh: '入口', shroud: 0 },
    { code: 'card_lab_workbench', name_zh: '卡片實驗室', description_zh: '實驗室', shroud: 0 },
  ],
  enemy: {
    code: 'card_lab_training_dummy',
    name_zh: '訓練木人',
    hp: 999,
    dc: 10,
    damage_physical: 0,
    damage_horror: 0,
    fear_value: 0,
    movement_speed: 0,
  },
};

test('card lab setup uses two locations, a harmless dummy, and no save mode', () => {
  const source = {
    stageId: 'source',
    title: 'source',
    investigatorName: '測試者',
    tutorial: false,
    investigator: {
      investigatorId: 'inv-1',
      investigatorDefinitionId: 'def-1',
      hp: 7,
      hpMax: 7,
      san: 7,
      sanMax: 7,
      actionPoints: 3,
      resources: 5,
      currentLocationId: 'source-location',
      engagedWith: [],
      deck: ['c1', 'c2'],
      hand: [],
      discardPile: [],
      removedPile: [],
      assetsInPlay: [],
    },
    scenario: {
      scenarioId: 'source',
      scenarioDefinitionId: 'source',
      campaignId: 'source',
      locations: [],
      unlockedLocations: [],
      enemies: [],
      tokens: [],
      agendaProgress: 0,
      objectiveProgress: 0,
      turnNumber: 1,
      phase: 'investigator',
    },
    cardLookup: {
      c1: { name_zh: '測試卡一', card_type: 'event', cost: 0, effects: [] },
      c2: { name_zh: '測試卡二', card_type: 'asset', cost: 1, effects: [] },
    },
    locMeta: {},
    enemyStats: {},
  } as unknown as GameSetup;
  const setup = buildCardLabSetup(source, manifest);
  assertEq(setup.stageId, CARD_LAB_STAGE_ID);
  assertEq(setup.sandbox, true);
  assertEq(setup.scenario.locations.length, 2);
  assertEq(setup.scenario.enemies.length, 1);
  assertEq(setup.scenario.enemies[0]?.hp, 999);
  assertEq(setup.enemyStats.card_lab_training_dummy?.damage_physical, 0);
  assertEq(setup.enemyStats.card_lab_training_dummy?.damage_horror, 0);
  assertEq(setup.enemyStats.card_lab_training_dummy?.fear_value, 0);
  assertEq(setup.investigator.hand.join(','), 'c1,c2');
  assertEq(setup.investigator.resources, 99);
  assertEq(setup.investigator.actionPoints, 99);
  assertEq(setup.bootstrap, null);
});

test('boot preload plan separates local shell assets and public server data', () => {
  const plan = bootPreloadPlan();
  assertEq(plan.length, 4);
  assertEq(plan.filter((task) => task.source === 'local').length, 2);
  assertEq(plan.filter((task) => task.source === 'server').length, 2);
  assertEq(plan.some((task) => task.id === 'stages'), true);
  assertEq(plan.some((task) => task.id === 'investigators'), true);
});

test('legacy signature card fields become playable card data', () => {
  const signature = normaliseBootstrapCardData({
    play_effect: '你與同地點調查員各治療 2 點理智,然後抽 1 張卡。',
    play_effect_code: [
      { effect_code: 'heal_san_at_location', effect_params: { amount: 2 } },
      { effect_code: 'draw_card', effect_params: { amount: 1 } },
    ],
    commit_icons: ['charisma', 'charisma'],
  }, '鼓舞士氣', 'event', 1);
  assertEq(signature.description_zh?.includes('治療 2 點理智'), true);
  assertEq(signature.effects?.length, 2);
  assertEq(signature.commit_icons?.charisma, 2);
});

let failed = 0;
for (const entry of tests) {
  try {
    entry.fn();
    console.log('PASS', entry.name);
  } catch (error) {
    failed += 1;
    console.error('FAIL', entry.name, error);
  }
}
if (failed > 0) throw new Error(`${failed} card lab test(s) failed`);
