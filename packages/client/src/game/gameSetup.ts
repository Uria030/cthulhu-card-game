/**
 * 戰鬥板開局 setup — 兩種來源共用一個形狀:
 * - makeTestSetup():G1 三地點教學關卡(寫死,保留教學解鎖鏈)
 * - buildSetupFromBootstrap():後台 DB 開局包(裂嘴女等正式關卡)
 *
 * 戰鬥板元件只認 GameSetup,不關心資料來源。
 */
import { buildGameFromBootstrap } from '@cthulhu/shared';
import type {
  InvestigatorState,
  ScenarioState,
  StageBootstrap,
  CardDataLookup,
  StyleCardData,
  EnemyDataLookup,
  AttackCardLookup,
} from '@cthulhu/shared';

export interface CardDisplay {
  id: string;
  name: string;
  cost: number;
  desc: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
}

export interface LocationDisplay {
  name: string;
  desc: string;
  lockedDesc: string;
}

export interface ActCardDisplay {
  name: string;
  narrative: string;
  conditionDesc: string;
  progressMax: number;
}

export interface AgendaCardDisplay {
  name: string;
  narrative: string;
  doomThreshold: number;
}

export interface GameSetup {
  /** 'test' 教學關卡 / 其他 = stage UUID */
  stageId: string;
  title: string;
  investigatorName: string;
  factionLabel: string;
  /** 教學模式:解鎖鏈 + 劇本事件 hooks 只在 test 啟用 */
  tutorial: boolean;
  investigator: InvestigatorState;
  scenario: ScenarioState;
  locMeta: Record<string, LocationDisplay>;
  cardMeta: Record<string, CardDisplay>;
  actCards: ActCardDisplay[];
  agendaCards: AgendaCardDisplay[];
  introLog: string[];
  /** 引擎檢定輸入:地點調查難度(shroud) */
  locationStats: Record<string, { shroud?: number }>;
  /** 引擎怪物資料(DC/傷害/恐懼/招式池/位階) */
  enemyStats: EnemyDataLookup;
  /** 怪物招式卡(key = mac code) */
  attackCards: AttackCardLookup;
  /** 臨時城主召喚池(primary 家族變體,依位階排序;階段三由城主 AI 取代) */
  summonPool: Array<{ code: string; name_zh: string; tier: number }>;
  /** 引擎卡片資料(commit_icons/effects/cost/combat_style 等) */
  cardLookup: CardDataLookup;
  /** 戰鬥風格卡池(key = style code) */
  stylePools: Record<string, StyleCardData[]>;
}

const VALID_RARITIES = new Set(['common', 'uncommon', 'rare', 'legendary']);

function toRarity(value: unknown): CardDisplay['rarity'] {
  const v = String(value ?? '');
  return (VALID_RARITIES.has(v) ? v : 'common') as CardDisplay['rarity'];
}

// ─── 教學關卡(原 TestScenarioScreen 寫死內容原樣搬入)───
const TEST_HAND_CARDS: CardDisplay[] = [
  { id: 'c1', name: '.45 手槍', cost: 2, desc: '武器(槍枝)— 攻擊 +2', rarity: 'uncommon' },
  { id: 'c2', name: '懷錶', cost: 1, desc: '資產 — 重擲一次當前檢定', rarity: 'common' },
  { id: 'c3', name: '街頭知識', cost: 1, desc: '技能 — 調查時 +2 感知', rarity: 'common' },
  { id: 'c4', name: '不退讓', cost: 0, desc: '事件 — 反應:取消 1 點傷害', rarity: 'rare' },
  { id: 'c5', name: '舊日筆記', cost: 1, desc: '資產(書籍)— 抽 2 張卡', rarity: 'common' },
];

export function makeTestSetup(): GameSetup {
  return {
    stageId: 'test',
    title: '三地點教學關卡',
    investigatorName: '范例調查員',
    factionLabel: 'E 號令陣營',
    tutorial: true,
    investigator: {
      investigatorId: 'inv-1',
      investigatorDefinitionId: 'def-范例調查員',
      ownerPlayerId: 'p1',
      attributes: {
        strength: 4, agility: 3, constitution: 3, reflex: 3,
        intellect: 3, willpower: 3, perception: 4, charisma: 3,
      },
      combatStyle: 'sidearm',
      specializations: [],
      deck: ['d1', 'd2', 'd3', 'd4', 'd5'],
      hand: TEST_HAND_CARDS.map((c) => c.id),
      discardPile: [],
      removedPile: [],
      assetsInPlay: [],
      hp: 7, hpMax: 7, san: 7, sanMax: 7,
      actionPoints: 3,
      resources: 0,
      currentLocationId: 'alley',
      engagedWith: [],
      triggeredHorrorChecks: [],
      traumas: [],
      secretTaskState: null,
      permanentlyDead: false,
      startingXp: 0,
    },
    scenario: {
      scenarioId: 'test-3loc',
      scenarioDefinitionId: 'test-three-locations',
      campaignId: 'test',
      locations: [
        { locationDefinitionId: 'alley', visibility: 'night', connectedTo: ['bookshop'], isObstacle: false },
        { locationDefinitionId: 'bookshop', visibility: 'night', connectedTo: ['alley', 'backdoor'], isObstacle: false },
        { locationDefinitionId: 'backdoor', visibility: 'darkness', connectedTo: ['bookshop'], isObstacle: true },
      ],
      unlockedLocations: ['alley'],
      enemies: [
        { instanceId: 'e1', enemyDefinitionId: 'def-shadow-stalker', locationId: 'backdoor', hp: 3, engagedWith: [], modifiers: [] },
      ],
      tokens: [],
      agendaProgress: 0,
      objectiveProgress: 0,
      chaosBag: [],
      turnNumber: 1,
      phase: 'short_rest_decision',
    },
    locMeta: {
      alley: {
        name: '昏暗小巷',
        desc: '潮濕的鵝卵石,遠處模糊燈光。空氣裡有泥土與菸草味。',
        lockedDesc: '',
      },
      bookshop: {
        name: '舊書店',
        desc: '霉味、未拆包裹、地下室低響。',
        lockedDesc: '一道鏽蝕的鐵閘把書店與小巷隔開。你需要先在這裡找到線索,才能撬開它。',
      },
      backdoor: {
        name: '霧中後門',
        desc: '門縫透出冷氣,隱約有東西在另一側。',
        lockedDesc: '濃霧與磚牆截斷了去路。先在書店裡看看那個包裹,你才會知道門後是什麼。',
      },
    },
    cardMeta: Object.fromEntries(TEST_HAND_CARDS.map((c) => [c.id, c])),
    actCards: [
      {
        name: '尋找線索',
        narrative: '「報紙上刊登了一則奇怪的訊息——關於這座城鎮的某段未公開歷史。某些線索散落在各個地點,等待有心人去拼湊出全貌。」',
        conditionDesc: '收集 12 個線索,即可推進至下一張幕。',
        progressMax: 12,
      },
    ],
    agendaCards: [
      {
        name: '毀滅的腳步',
        narrative: '「祭壇上的蠟燭一盞接一盞地熄滅。每熄滅一盞,空氣中就多一分窒息感。某種無形的東西正在這座城鎮中累積它的力量,而你們所剩的時間越來越少。」',
        doomThreshold: 6,
      },
    ],
    introLog: [
      '──── 三地點教學關卡 開始 ────',
      '寫死的調查員站在【昏暗小巷】。',
      '本關目標:逐一解鎖三個地點,驗證調查、遭遇、戰鬥三個系統。',
      '進入調查員階段後,先試試「調查」找出通往書店的線索。',
    ],
    locationStats: {},
    enemyStats: {},
    attackCards: {},
    summonPool: [],
    cardLookup: {},
    stylePools: {},
  };
}

// ─── 正式關卡:開局包 → GameSetup ──────────────
const FACTION_LABEL: Record<string, string> = {
  E: 'E 號令陣營', I: 'I 深淵陣營', S: 'S 鐵證陣營', N: 'N 直覺陣營',
  T: 'T 理性陣營', F: 'F 聖燼陣營', J: 'J 秩序陣營', P: 'P 流變陣營',
};

export function buildSetupFromBootstrap(bootstrap: StageBootstrap): GameSetup {
  const built = buildGameFromBootstrap(bootstrap);

  const locMeta: Record<string, LocationDisplay> = {};
  for (const loc of bootstrap.locations) {
    locMeta[loc.code] = {
      name: loc.name_zh,
      desc: String(loc.description_zh ?? ''),
      lockedDesc: '',
    };
  }

  const cardMeta: Record<string, CardDisplay> = {};
  for (const [instanceId, info] of Object.entries(built.cardIndex)) {
    cardMeta[instanceId] = {
      id: instanceId,
      name: info.name_zh,
      cost: Number(info.cost ?? 0),
      desc: String(info.data.description_zh ?? info.data.ability_text_zh ?? ''),
      rarity: toRarity(info.data.rarity),
    };
  }

  const actCards: ActCardDisplay[] = (bootstrap.stage.act_cards ?? []).map((ac: any) => ({
    name: String(ac.name_zh ?? ''),
    narrative: String(ac.front_narrative ?? ''),
    conditionDesc: typeof ac.front_advance_condition === 'object' && ac.front_advance_condition
      ? Object.entries(ac.front_advance_condition)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join(' / ')
      : '',
    progressMax: Number((ac.front_advance_condition as any)?.count ?? 12),
  }));

  const agendaCards: AgendaCardDisplay[] = (bootstrap.stage.agenda_cards ?? []).map((ag: any) => ({
    name: String(ag.name_zh ?? ''),
    narrative: String(ag.front_narrative ?? ''),
    doomThreshold: Number(ag.front_doom_threshold ?? 6),
  }));

  const inv = bootstrap.investigator;
  const spawnName =
    locMeta[built.investigator.currentLocationId ?? '']?.name ??
    built.investigator.currentLocationId ?? '';

  // 引擎檢定輸入三張查找表
  const locationStats: GameSetup['locationStats'] = {};
  for (const loc of bootstrap.locations) {
    locationStats[loc.code] = { shroud: Number(loc.shroud ?? 10) };
  }
  const enemyStats: GameSetup['enemyStats'] = {};
  for (const mv of bootstrap.monsters as Array<Record<string, any>>) {
    enemyStats[String(mv.code)] = {
      name_zh: String(mv.name_zh ?? mv.code),
      dc: Number(mv.dc ?? 10),
      damage_physical: Number(mv.damage_physical ?? 1),
      damage_horror: Number(mv.damage_horror ?? 0),
      fear_value: Number(mv.fear_value ?? 1),
      fear_radius: Number(mv.fear_radius ?? 1),
      fear_type: String(mv.fear_type ?? 'first_sight'),
      tier: Number(mv.tier ?? 1),
      attacks_per_round: Number(mv.attacks_per_round ?? 1),
      movement_speed: Number(mv.movement_speed ?? 1),
      ai_preference: String(mv.ai_preference ?? 'nearest'),
      move_pool: Array.isArray(mv.move_pool) ? mv.move_pool : [],
      hp_base: Number(mv.hp_base ?? 1),
      hp_per_player: Number(mv.hp_per_player ?? 0),
    };
  }
  const attackCards: GameSetup['attackCards'] = {};
  for (const mac of bootstrap.monster_attack_cards as Array<Record<string, any>>) {
    attackCards[String(mac.code)] = {
      code: String(mac.code),
      name_zh: String(mac.name_zh ?? mac.code),
      defense_attribute: String(mac.defense_attribute ?? 'reflex'),
      dc_override: mac.dc_override == null ? null : Number(mac.dc_override),
      damage_physical: Number(mac.damage_physical ?? 0),
      damage_horror: Number(mac.damage_horror ?? 0),
    };
  }
  // 臨時城主召喚池:primary 家族變體,低位階優先(階段三換正式城主 AI)
  const primaryFamily = (bootstrap.stage.monster_pool as Array<Record<string, any>> | undefined)
    ?.find((p) => p.role === 'primary')?.family_code;
  const summonPool: GameSetup['summonPool'] = (bootstrap.monsters as Array<Record<string, any>>)
    .filter((mv) => !primaryFamily || mv.family_code === primaryFamily)
    .map((mv) => ({ code: String(mv.code), name_zh: String(mv.name_zh ?? mv.code), tier: Number(mv.tier ?? 1) }))
    .sort((a, b) => a.tier - b.tier);
  const cardLookup: GameSetup['cardLookup'] = {};
  for (const [instanceId, info] of Object.entries(built.cardIndex)) {
    const d = info.data;
    const icons = d.commit_icons;
    cardLookup[instanceId] = {
      commit_icons: icons && typeof icons === 'object' && !Array.isArray(icons) ? icons : {},
      name_zh: info.name_zh,
      card_type: info.card_type,
      cost: info.cost,
      combat_style: d.combat_style ?? null,
      attribute_modifiers:
        d.attribute_modifiers && typeof d.attribute_modifiers === 'object'
          ? d.attribute_modifiers
          : {},
      subtypes: Array.isArray(d.subtypes) ? d.subtypes : [],
      effects: Array.isArray(d.effects) ? d.effects : [],
    };
  }
  const stylePools: GameSetup['stylePools'] = {};
  for (const sc of bootstrap.combat_style_pools ?? []) {
    (stylePools[sc.style_code] = stylePools[sc.style_code] ?? []).push(sc);
  }

  return {
    stageId: bootstrap.stage.id,
    title: bootstrap.stage.name_zh,
    investigatorName: inv?.name_zh ?? '調查員',
    factionLabel: FACTION_LABEL[String(inv?.faction_code ?? '')] ?? String(inv?.faction_code ?? ''),
    tutorial: false,
    investigator: built.investigator,
    scenario: built.scenario,
    locMeta,
    cardMeta,
    actCards,
    agendaCards,
    introLog: [
      `──── ${bootstrap.campaign?.name_zh ?? ''}:${bootstrap.stage.name_zh} ────`,
      `${inv?.name_zh ?? '調查員'} 站在【${spawnName}】。`,
      '調查各地點、收集線索,在議程推進前達成幕目標。',
    ],
    locationStats,
    enemyStats,
    attackCards,
    summonPool,
    cardLookup,
    stylePools,
  };
}
