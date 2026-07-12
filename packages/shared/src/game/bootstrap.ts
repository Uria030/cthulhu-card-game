/**
 * G-01 引擎核心 — 開局包轉換器
 *
 * 把後端 GET /api/play/stages/:id/bootstrap 回傳的 DB 零件(snake_case rows)
 * 轉成引擎可吃的遊戲狀態(CampaignState / ScenarioState / InvestigatorState)。
 *
 * 對應關係:
 * - scenarios.initial_location_codes + initial_connections → LocationInstance[](拓撲)
 * - scenarios.initial_environment.main → visibility(夜間/白天/黑暗 → night/day/darkness)
 * - stage_chaos_bag.number_markers + scenario_markers → ChaosToken[]
 * - locations.clues_base + clues_per_player → clue tokens(規則書 §13)
 * - investigator_starting_deck(quantity 展開)→ 卡片實例 + cardIndex 查找表
 *
 * HP/SAN 基礎值 7 對齊 DB investigator_value_config 的 hp_base / san_base。
 */
import type {
  CampaignState,
  ScenarioState,
  InvestigatorState,
  LocationInstance,
  EnemyInstance,
  TokenInstance,
  ChaosToken,
  DiscoverableSlot,
} from './state';
import { hpMaxFor, sanMaxFor, STARTING_RESOURCES, STARTING_HAND_SIZE } from './upkeep';
import { hiddenPointFromRow } from './hiddenInvestigation';
import type { HiddenPoint } from './hiddenInvestigation';
import { cloneTalentProgress, cloneTeamSpiritProgress } from './campaignProgress';
import type { CampaignProgress, PreparationCardDefinition, TalentTreeDefinition, TeamSpiritDefinition } from './campaignProgress';

// ─── 開局包型別(對齊 /api/play bootstrap 回傳,DB row 原樣 snake_case)──
export interface BootstrapScenarioRow {
  id: string;
  scenario_order: number;
  name_zh: string;
  narrative: string;
  initial_location_codes: string[];
  initial_connections: Array<{
    from: string;
    to: string;
    obstacle?: boolean;
    travel_cost?: number;
  }>;
  investigator_spawn_location: string | null;
  initial_environment: { main?: string; modifiers?: string[] };
  initial_enemies: Array<{
    variant_code?: string;
    location_code?: string;
    count?: number;
  }>;
  [key: string]: unknown;
}

export interface BootstrapLocationRow {
  id: string;
  code: string;
  name_zh: string;
  description_zh?: string | null;
  svg_code?: string | null;
  art_url?: string | null;
  art_type?: string;
  shroud?: number;
  clues_base?: number;
  clues_per_player?: number;
  hidden_info?: Array<Record<string, unknown>>;
  tags?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface BootstrapDeckEntry {
  deck_entry_id: string;
  quantity: number;
  slot_order: number | null;
  card_definition_id: string | null;
  signature_card_id: string | null;
  weakness_id: string | null;
  card: Record<string, any> | null;
  signature_card: Record<string, any> | null;
  weakness: Record<string, any> | null;
}

export interface BootstrapInvestigatorRow {
  id: string;
  code: string;
  name_zh: string;
  mbti_code?: string;
  faction_code?: string;
  attr_strength: number;
  attr_agility: number;
  attr_constitution: number;
  attr_reflex: number;
  attr_intellect: number;
  attr_willpower: number;
  attr_perception: number;
  attr_charisma: number;
  proficiency_ids?: string[];
  starting_deck?: BootstrapDeckEntry[];
  [key: string]: unknown;
}

export interface StageBootstrap {
  stage: {
    id: string;
    code: string;
    name_zh: string;
    narrative?: string | null;
    completion_flags?: unknown;
    scenarios: BootstrapScenarioRow[];
    act_cards: Array<Record<string, unknown>>;
    agenda_cards: Array<Record<string, unknown>>;
    chaos_bag: {
      number_markers?: Record<string, number>;
      scenario_markers?: Record<string, { count: number; value: number; effect?: string }>;
    } | null;
    [key: string]: unknown;
  };
  campaign: { id: string; code: string; name_zh: string; [key: string]: unknown } | null;
  chapter: { id: string; name_zh: string; outcomes?: Array<Record<string, unknown>>; [key: string]: unknown } | null;
  locations: BootstrapLocationRow[];
  mythos_cards: Array<Record<string, unknown>>;
  encounter_cards: Array<Record<string, unknown>>;
  monsters: Array<Record<string, unknown>>;
  monster_attack_cards: Array<Record<string, unknown>>;
  investigator: BootstrapInvestigatorRow | null;
  /** 戰鬥風格卡池(第一層,§8 攻擊抽卡用;依牌組武器風格 + 調查員熟練撈) */
  combat_style_pools?: Array<{
    code: string;
    name_zh: string;
    check_attribute: string;
    style_code: string;
    narrative_attack_zh?: string;
    narrative_success_zh?: string;
    narrative_fail_zh?: string;
  }>;
  /** 城主行動點設定(game_balance_settings keeper_action_points 群) */
  keeper_settings?: Record<string, unknown>;
  /** 可發現卡片資源的卡面(地點 discoverable_card_ids 指向的 card_definitions;支柱6+8 探索獲卡) */
  discoverable_cards?: Array<Record<string, any>>;
  /** 整備期可購買的玩家卡池(唯讀卡面;D5 池可後續回填,引擎先接組成) */
  upgrade_cards?: Array<Record<string, any>>;
  /** 玩家調查員所屬陣營的天賦樹(唯讀;整備期投資用) */
  talent_tree?: TalentTreeDefinition | null;
  /** 天賦樹可能解鎖/引用的卡面(唯讀;用於 talent_card 入牌組與下一場實例化) */
  talent_cards?: PreparationCardDefinition[];
  /** 團隊精神候選池(唯讀;整備期採用/投入用) */
  team_spirits?: TeamSpiritDefinition[];
}

// ─── 卡片實例查找表(state 只存實例 id,畫面靠這張表顯示卡面)──
export interface CardInstanceInfo {
  instanceId: string;
  /** card_definition / signature / weakness 三選一的來源 */
  source: 'card_definition' | 'signature' | 'weakness';
  sourceId: string;
  name_zh: string;
  card_type?: string;
  cost?: number | null;
  /** 完整原始卡資料(含 effects[],階段二結算用) */
  data: Record<string, any>;
}

export interface BuiltGameState {
  campaign: CampaignState;
  scenario: ScenarioState;
  investigator: InvestigatorState;
  cardIndex: Record<string, CardInstanceInfo>;
}

export interface BuildOptions {
  /** 用第幾個場景開局(scenario_order,預設 1) */
  scenarioOrder?: number;
  /** 玩家數(影響線索 clues_per_player,預設 1) */
  playerCount?: number;
  /** 開局手牌數(預設 5) */
  openingHandSize?: number;
  /** 洗牌亂數來源(可注入做測試,預設 Math.random) */
  rng?: () => number;
  /** 卡片實例 id 前綴(多調查員同場時防撞;預設空 = 'ci_N') */
  cardInstancePrefix?: string;
  /** 戰役存檔;若有該調查員 carryover deck,下一場用它重建一般牌組並保留簽名/弱點 */
  campaignProgress?: CampaignProgress | null;
}

// ─── 環境敘述 → 視野光照 ──────────────────────
const ENV_VISIBILITY: Record<string, LocationInstance['visibility']> = {
  白天: 'day',
  日間: 'day',
  夜間: 'night',
  夜晚: 'night',
  黑暗: 'darkness',
  火光: 'fire',
};

export function mapEnvironmentToVisibility(
  env: { main?: string; modifiers?: string[] } | null | undefined,
): LocationInstance['visibility'] {
  if (!env || !env.main) return 'day';
  return ENV_VISIBILITY[env.main] ?? 'day';
}

// ─── 混沌袋 rows → ChaosToken[] ───────────────
export function buildChaosBag(
  chaosBag: StageBootstrap['stage']['chaos_bag'],
): ChaosToken[] {
  const tokens: ChaosToken[] = [];
  let seq = 0;
  const numberMarkers = chaosBag?.number_markers ?? {};
  for (const [face, count] of Object.entries(numberMarkers)) {
    const value = parseInt(face, 10);
    for (let i = 0; i < count; i += 1) {
      tokens.push({
        tokenId: `chaos_num_${face}_${(seq += 1)}`,
        type: 'numeric',
        value: Number.isNaN(value) ? null : value,
      });
    }
  }
  const scenarioMarkers = chaosBag?.scenario_markers ?? {};
  for (const [symbol, spec] of Object.entries(scenarioMarkers)) {
    for (let i = 0; i < (spec?.count ?? 0); i += 1) {
      tokens.push({
        tokenId: `chaos_${symbol}_${(seq += 1)}`,
        type: symbol,
        value: spec?.value ?? null,
      });
    }
  }
  return tokens;
}

// ─── Fisher–Yates(rng 可注入)──────────────────
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─── 主入口 ─────────────────────────────────
export function buildGameFromBootstrap(
  bootstrap: StageBootstrap,
  options: BuildOptions = {},
): BuiltGameState {
  const {
    scenarioOrder = 1,
    playerCount = 1,
    openingHandSize = STARTING_HAND_SIZE,
    rng = Math.random,
    cardInstancePrefix = '',
  } = options;

  const scenarioRow =
    bootstrap.stage.scenarios.find((s) => s.scenario_order === scenarioOrder) ??
    bootstrap.stage.scenarios[0];
  if (!scenarioRow) {
    throw new Error(`開局包沒有任何場景(stage=${bootstrap.stage.code})`);
  }

  // ── 地點拓撲:codes + connections → LocationInstance[] ──
  const visibility = mapEnvironmentToVisibility(scenarioRow.initial_environment);
  const connectedMap = new Map<string, Set<string>>();
  const obstacleCodes = new Set<string>();
  for (const code of scenarioRow.initial_location_codes) {
    connectedMap.set(code, new Set());
  }
  for (const conn of scenarioRow.initial_connections ?? []) {
    connectedMap.get(conn.from)?.add(conn.to);
    connectedMap.get(conn.to)?.add(conn.from);
    // 連線標 obstacle → 通往的目的地視為障礙地點(移動 2 行動點,§6.2)
    if (conn.obstacle) obstacleCodes.add(conn.to);
  }
  const locations: LocationInstance[] = scenarioRow.initial_location_codes.map((code) => ({
    locationDefinitionId: code,
    visibility,
    connectedTo: [...(connectedMap.get(code) ?? [])],
    isObstacle: obstacleCodes.has(code),
  }));

  // ── 場上敵人(裂嘴女初始為空;形狀支援 variant_code/location_code/count)──
  const enemies: EnemyInstance[] = [];
  let enemySeq = 0;
  for (const spec of scenarioRow.initial_enemies ?? []) {
    if (!spec?.variant_code) continue;
    const variant = bootstrap.monsters.find((m) => m.code === spec.variant_code) as
      | Record<string, any>
      | undefined;
    for (let i = 0; i < (spec.count ?? 1); i += 1) {
      enemies.push({
        instanceId: `enemy_${(enemySeq += 1)}`,
        enemyDefinitionId: spec.variant_code,
        locationId: spec.location_code ?? scenarioRow.initial_location_codes[0],
        hp: Number(variant?.hp_base ?? 1) + Number(variant?.hp_per_player ?? 0) * (playerCount - 1),
        engagedWith: [],
        modifiers: [],
      });
    }
  }

  // ── 線索標記:clues_base + clues_per_player × 玩家數(規則書 §13)──
  const tokens: TokenInstance[] = [];
  const locByCode = new Map(bootstrap.locations.map((l) => [l.code, l]));
  for (const code of scenarioRow.initial_location_codes) {
    const loc = locByCode.get(code);
    const clues = Number(loc?.clues_base ?? 0) + Number(loc?.clues_per_player ?? 0) * playerCount;
    if (clues > 0) {
      tokens.push({ tokenType: 'clue', locationId: code, amount: clues });
    }
  }

  // ── 隱藏調查點:從地點 hidden_info 建 HiddenPoint[](規則書 §13)──
  const hiddenPoints: HiddenPoint[] = [];
  for (const code of scenarioRow.initial_location_codes) {
    const loc = locByCode.get(code);
    for (const row of (loc?.hidden_info ?? []) as Array<Record<string, unknown>>) {
      hiddenPoints.push(hiddenPointFromRow(row as Record<string, any>, code));
    }
  }

  const scenario: ScenarioState = {
    scenarioId: scenarioRow.id,
    scenarioDefinitionId: scenarioRow.id,
    campaignId: bootstrap.campaign?.id ?? '',
    locations,
    // 一般戰役預設全解鎖(教學關卡才逐步解鎖)
    unlockedLocations: scenarioRow.initial_location_codes,
    enemies,
    tokens,
    hiddenPoints,
    agendaProgress: 0,
    objectiveProgress: 0,
    chaosBag: buildChaosBag(bootstrap.stage.chaos_bag),
    turnNumber: 1,
    phase: 'investigator',
    keeperState: { actionPoints: 0, cooldowns: {}, uses: {}, lastCategory: null, lastCardId: null },
  };

  // ── 戰役層 ──
  const teamSpirits = cloneTeamSpiritProgress(options.campaignProgress?.teamSpirits);
  const campaign: CampaignState = {
    campaignId: bootstrap.campaign?.id ?? '',
    campaignDefinitionId: bootstrap.campaign?.code ?? '',
    flags: { ...(options.campaignProgress?.flags ?? {}) },
    cohesion: options.campaignProgress?.cohesion ?? 0,
    unlockedTeamSpirits: Object.keys(teamSpirits.investments),
    teamSpiritInvestments: Object.fromEntries(
      Object.entries(teamSpirits.investments).map(([code, investment]) => [
        code,
        { points: investment.points, milestoneUnlocked: investment.milestoneUnlocked },
      ]),
    ),
    teamSpiritEffects: teamSpirits.effectSnapshots,
    unlockedSidequests: [],
    currentChapterId: bootstrap.chapter?.id ?? null,
    lastSessionEndedAt: null,
    fallenEvents: [],
  };

  // ── 調查員 + 牌組展開 ──
  const inv = bootstrap.investigator;
  if (!inv) {
    throw new Error('開局包沒有調查員(後台需至少一位 is_completed 的調查員)');
  }

  const cardIndex: Record<string, CardInstanceInfo> = {};
  const allInstances: string[] = [];
  let cardSeq = 0;
  const carry = options.campaignProgress?.investigators?.[String(inv.id)];
  const cardDataByDefId = new Map<string, Record<string, any>>();
  for (const entry of inv.starting_deck ?? []) {
    if (entry.card_definition_id && entry.card) cardDataByDefId.set(String(entry.card_definition_id), entry.card);
  }
  for (const src of [
    ...(bootstrap.discoverable_cards ?? []),
    ...(bootstrap.upgrade_cards ?? []),
    ...(bootstrap.talent_cards ?? []),
  ]) {
    if (src?.id) cardDataByDefId.set(String(src.id), src);
  }
  const specialEntries = (inv.starting_deck ?? []).filter((entry) => entry.signature_card_id || entry.weakness_id);
  const deckEntries = carry?.deck?.length
    ? [
        ...carry.deck.map((cardDefId, i): BootstrapDeckEntry => ({
          deck_entry_id: `carry_${i}`,
          quantity: 1,
          slot_order: i,
          card_definition_id: cardDefId,
          signature_card_id: null,
          weakness_id: null,
          card: cardDataByDefId.get(String(cardDefId)) ?? null,
          signature_card: null,
          weakness: null,
        })),
        ...specialEntries,
      ]
    : (inv.starting_deck ?? []);
  for (const entry of deckEntries) {
    const src = entry.card ?? entry.signature_card ?? entry.weakness;
    if (!src) continue;
    const source: CardInstanceInfo['source'] = entry.card
      ? 'card_definition'
      : entry.signature_card
        ? 'signature'
        : 'weakness';
    for (let i = 0; i < (entry.quantity ?? 1); i += 1) {
      const instanceId = `${cardInstancePrefix}ci_${(cardSeq += 1)}`;
      cardIndex[instanceId] = {
        instanceId,
        source,
        sourceId: String(src.id),
        name_zh: String(src.name_zh ?? ''),
        // 弱點列(investigator_weaknesses)沒有 card_type 欄位 → 補 'weakness'
        // (否則會被當一般資產打出;2026-06-12 三 AI 模擬抓到的洞)
        card_type: src.card_type ? String(src.card_type) : source === 'weakness' ? 'weakness' : undefined,
        cost: src.cost ?? null,
        data: src,
      };
      allInstances.push(instanceId);
    }
  }

  // ── 可發現卡片資源池:地點 discoverable_card_ids 預先實例化(支柱6 探索 + 支柱8 動態牌組)──
  // 預先實例化並註冊進 cardIndex(→ cardLookup),搜尋成功時引擎只把 instance 移進牌組,容器零實例化邏輯。
  const discData = new Map<string, Record<string, any>>(
    (bootstrap.discoverable_cards ?? []).map((c) => [String(c.id), c]),
  );
  const discoverablePools: DiscoverableSlot[] = [];
  for (const code of scenarioRow.initial_location_codes) {
    const loc = locByCode.get(code);
    const ids = (loc?.discoverable_card_ids ?? []) as string[];
    ids.forEach((cardDefId, idx) => {
      const src = discData.get(String(cardDefId));
      if (!src) return; // 沒撈到卡面的 dangling id 略過(防呆)
      const instanceId = `${cardInstancePrefix}ci_${(cardSeq += 1)}`;
      cardIndex[instanceId] = {
        instanceId,
        source: 'card_definition',
        sourceId: String(src.id),
        name_zh: String(src.name_zh ?? ''),
        card_type: src.card_type ? String(src.card_type) : undefined,
        cost: src.cost ?? null,
        data: src,
      };
      discoverablePools.push({ id: `${code}__disc__${idx}`, locationId: code, cardInstanceId: instanceId, takenBy: null });
    });
  }
  scenario.discoverablePools = discoverablePools;

  const shuffled = shuffle(allInstances, rng);
  const hand = shuffled.slice(0, openingHandSize);
  const deck = shuffled.slice(openingHandSize);

  const spawn = scenarioRow.investigator_spawn_location ?? scenarioRow.initial_location_codes[0];

  const talentProgress = cloneTalentProgress(carry?.talents);
  const attributes: InvestigatorState['attributes'] = {
    strength: Number(inv.attr_strength ?? 0) + (talentProgress.attributeBonuses.strength ?? 0),
    agility: Number(inv.attr_agility ?? 0) + (talentProgress.attributeBonuses.agility ?? 0),
    constitution: Number(inv.attr_constitution ?? 0) + (talentProgress.attributeBonuses.constitution ?? 0),
    reflex: Number(inv.attr_reflex ?? 0) + (talentProgress.attributeBonuses.reflex ?? 0),
    intellect: Number(inv.attr_intellect ?? 0) + (talentProgress.attributeBonuses.intellect ?? 0),
    willpower: Number(inv.attr_willpower ?? 0) + (talentProgress.attributeBonuses.willpower ?? 0),
    perception: Number(inv.attr_perception ?? 0) + (talentProgress.attributeBonuses.perception ?? 0),
    charisma: Number(inv.attr_charisma ?? 0) + (talentProgress.attributeBonuses.charisma ?? 0),
  };

  // HP/SAN 公式(ch6 §3.1):體質 × 2 + 5 / 意志 × 2 + 5(舊版寫死 7 是 bug,
  // ISTP 體質 1 恰好算出 7 把它藏住了)
  const BASE_HP = hpMaxFor(Number(attributes.constitution ?? 1));
  const BASE_SAN = sanMaxFor(Number(attributes.willpower ?? 1));

  const investigator: InvestigatorState = {
    investigatorId: `pinv_${inv.code}`,
    investigatorDefinitionId: inv.id,
    ownerPlayerId: 'p1',
    attributes,
    combatStyle: inv.proficiency_ids?.[0] ?? '',
    specializations: [],
    talentNodeIds: talentProgress.unlockedNodeIds,
    talentBranches: talentProgress.selectedBranches,
    talentEffects: talentProgress.passiveEffects,
    deck,
    hand,
    discardPile: [],
    removedPile: [],
    assetsInPlay: [],
    hp: BASE_HP,
    hpMax: BASE_HP,
    san: BASE_SAN,
    sanMax: BASE_SAN,
    actionPoints: 3,
    resources: STARTING_RESOURCES, // ch6 §8.2 起始 5
    currentLocationId: spawn,
    engagedWith: [],
    triggeredHorrorChecks: [],
    traumas: [],
    secretTaskState: null,
    permanentlyDead: false,
    startingXp: 0,
  };

  return { campaign, scenario, investigator, cardIndex };
}
