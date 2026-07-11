import type { CardLabManifest } from '../api';
import type { GameSetup } from './gameSetup';

export const CARD_LAB_STAGE_ID = 'card-lab';
export const CARD_LAB_DUMMY_INSTANCE_ID = 'card-lab-dummy-1';

export function buildCardLabSetup(base: GameSetup, manifest: CardLabManifest): GameSetup {
  const [entrance, laboratory] = manifest.locations;
  if (!entrance || !laboratory) throw new Error('實驗場 manifest 必須包含入口與實驗室');

  const allCardIds = Object.keys(base.cardLookup);
  const investigator = {
    ...base.investigator,
    hp: Math.max(base.investigator.hpMax, 99),
    hpMax: Math.max(base.investigator.hpMax, 99),
    san: Math.max(base.investigator.sanMax, 99),
    sanMax: Math.max(base.investigator.sanMax, 99),
    actionPoints: 99,
    resources: 99,
    currentLocationId: entrance.code,
    engagedWith: [],
    deck: [],
    hand: allCardIds,
    discardPile: [],
    removedPile: [],
    assetsInPlay: [],
  };

  return {
    ...base,
    stageId: CARD_LAB_STAGE_ID,
    title: manifest.title,
    tutorial: false,
    sandbox: true,
    investigator,
    scenario: {
      ...base.scenario,
      scenarioId: CARD_LAB_STAGE_ID,
      scenarioDefinitionId: CARD_LAB_STAGE_ID,
      campaignId: CARD_LAB_STAGE_ID,
      locations: [
        { locationDefinitionId: entrance.code, visibility: 'day', connectedTo: [laboratory.code], isObstacle: false },
        { locationDefinitionId: laboratory.code, visibility: 'day', connectedTo: [entrance.code], isObstacle: false },
      ],
      unlockedLocations: [entrance.code, laboratory.code],
      enemies: [{
        instanceId: CARD_LAB_DUMMY_INSTANCE_ID,
        enemyDefinitionId: manifest.enemy.code,
        locationId: laboratory.code,
        hp: manifest.enemy.hp,
        engagedWith: [],
        modifiers: [],
      }],
      tokens: [],
      agendaProgress: 0,
      objectiveProgress: 0,
      turnNumber: 1,
      phase: 'investigator',
    },
    locMeta: {
      [entrance.code]: { name: entrance.name_zh, desc: entrance.description_zh, lockedDesc: '' },
      [laboratory.code]: { name: laboratory.name_zh, desc: laboratory.description_zh, lockedDesc: '' },
    },
    locationStats: {
      [entrance.code]: { shroud: entrance.shroud },
      [laboratory.code]: { shroud: laboratory.shroud },
    },
    enemyStats: {
      [manifest.enemy.code]: {
        name_zh: manifest.enemy.name_zh,
        hp_base: manifest.enemy.hp,
        hp_per_player: 0,
        dc: manifest.enemy.dc,
        damage_physical: manifest.enemy.damage_physical,
        damage_horror: manifest.enemy.damage_horror,
        fear_value: manifest.enemy.fear_value,
        fear_radius: 0,
        attacks_per_round: 0,
        movement_speed: manifest.enemy.movement_speed,
        tier: 1,
        move_pool: [],
        keywords: ['training_target'],
      },
    },
    attackCards: {},
    summonPool: [],
    actCards: [{
      name: '逐項驗證',
      narrative: '每個動作都會留下卡面、效果與狀態差異。',
      conditionDesc: '本實驗場沒有勝負條件。',
      progressMax: 999,
    }],
    agendaCards: [{
      name: '測試暫停',
      narrative: '實驗場不推進毀滅。',
      doomThreshold: 999,
    }],
    actData: [],
    agendaData: [],
    mythosCards: [],
    encounterCards: [],
    encounterTriggerConfig: {},
    outcomes: [],
    bootstrap: null,
    aiMembers: [],
    campaignProgress: null,
    introLog: [
      '──── 卡片效果實驗場 ────',
      `${base.investigatorName} 進入【${entrance.name_zh}】。`,
      `【${laboratory.name_zh}】配置訓練木人:HP ${manifest.enemy.hp} / 傷害 0 / 恐懼 0。`,
      '所有牌組卡片已放入手牌;資源、行動點、體力與理智已切換為測試值。',
      '打出卡片或執行動作後,右側會記錄卡面敘述、宣告效果、實際效果與狀態差。',
    ],
  };
}

export function resetCardLabDummy(setup: GameSetup, hp: number): GameSetup['scenario']['enemies'][number] {
  return {
    instanceId: CARD_LAB_DUMMY_INSTANCE_ID,
    enemyDefinitionId: Object.keys(setup.enemyStats)[0] ?? 'card_lab_training_dummy',
    locationId: Object.keys(setup.locMeta)[1] ?? Object.keys(setup.locMeta)[0] ?? 'card_lab_workbench',
    hp,
    engagedWith: [],
    modifiers: [],
  };
}
