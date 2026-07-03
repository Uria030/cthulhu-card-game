/**
 * G-13 戰役進度 / 存檔骨幹 — 跨場景・跨章節的狀態持續(規則書 ch5 §1 狀態持續、ch2 §1.6 長休息→整備)
 *
 * 這支只管「一場戰役要保留什麼、場景/章節結束怎麼結算進存檔」——純計算式,不碰持久層(DB/帳號)。
 * 持久化(存檔 endpoint + 玩家身份)是後續批次;此 CampaignProgress 即是被序列化的存檔內容。
 *
 * 狀態持續矩陣(ch5 §1「章節間保持狀態持續」):
 *  - 跨章節保留:HP/SAN 當前值 + 上限(含創傷侵蝕)、牌組組成、build(風格/專精)、XP、天賦點、
 *    凝聚力、劇情/結局旗標、永久死亡。
 *  - 場景內重置(不入存檔):手牌/棄牌/移除/場上資產、行動點、資源、地點、交戰、狀態效果、盟友、
 *    瀕死檢定計數(創傷才是持久後果)。
 *
 * 數值原則:長休息 +1 凝聚力是規則書明定(ch4 §6.1,固定不按人數縮放);其餘獎勵量(XP/天賦點)
 * 一律由呼叫端帶入(來自 chapter_outcomes 等資料),引擎不自創平衡數字。
 */
import type { InvestigatorState, InvestigatorTalentEffect, Trauma } from './state';
import type { ResultEffect } from './messages';
import type { HiddenPoint } from './hiddenInvestigation';
import type { OutcomeData } from './gameProgress';

/** 單一調查員跨章節保留的狀態切片 */
export interface InvestigatorCarryover {
  investigatorDefinitionId: string;
  /** 當前 HP/SAN(下一章開頭沿用;可能仍處瀕死,由下一場開局做瀕死檢定) */
  hp: number;
  san: number;
  /** 上限(含創傷侵蝕;死亡使歸零項上限 -1) */
  hpMax: number;
  sanMax: number;
  traumas: Trauma[];
  /**
   * 牌組組成 = **卡片定義 id** 清單(不是場景內的暫態實例 id)。屬戰役層資料,只在整備期變動;
   * 跨場景沿用同一份組成,下一場開局再依此實例化。**不可從場景末態的 inv.deck 推導**——
   * 那是暫態實例 id、且只剩抽牌堆(手牌/棄牌/場上資產不在內),跨章會失效。
   * (場景中探索獲卡對組成的增添 → 另批持久化,見 Task #8,非本骨幹範圍)
   */
  deck: string[];
  combatStyle: string;
  specializations: string[];
  /** 累積經驗值(整備期購卡/強化用) */
  xp: number;
  /** 累積天賦點(整備期投天賦樹用) */
  talentPoints: number;
  /** 天賦樹投資進度(跨章持續,下一場 bootstrap 注入調查員狀態) */
  talents: InvestigatorTalentProgress;
  /** 上限歸 0 → 永久死亡(角色資料刪除;ch2 §9.6) */
  permanentlyDead: boolean;
}

export interface ChapterResultRecord {
  chapterNumber: number;
  outcomeCode: string;
  nextChapterVersion: string | null;
  stageId: string | null;
  resolvedAt?: string;
}

/** 戰役存檔的完整內容(後續批次序列化此結構) */
export interface CampaignProgress {
  campaignId: string;
  /** 當前進行到第幾章(1 起算) */
  currentChapterNumber: number;
  /** key = investigatorDefinitionId */
  investigators: Record<string, InvestigatorCarryover>;
  /** 隊伍共用凝聚力(ch4 §6.1;長休息 +1) */
  cohesion: number;
  /** 跨章節劇情/結局旗標(ch5 §4 章節結束時設定) */
  flags: Record<string, unknown>;
  /** key = chapterNumber;保存各章結局與下一章版本,供戰役地圖/提要頁承接分歧 */
  chapterResults?: Record<string, ChapterResultRecord>;
}

/** 場景結束時要套到存檔的獎勵(數值來自資料:chapter_outcomes 等,引擎不自創) */
export interface ScenarioReward {
  /** 每位存活調查員獲得的 XP */
  xp?: number;
  /** 每位存活調查員獲得的天賦點 */
  talentPoints?: number;
  /** 隊伍凝聚力增減 */
  cohesion?: number;
  /** 寫入戰役旗標 */
  flagSets?: Array<{ flag_code: string; value: unknown }>;
  /** chapter_outcomes.outcome_code,用於記錄章節結局 */
  outcomeCode?: string;
  /** chapter_outcomes.next_chapter_version,用於下一章分歧 */
  nextChapterVersion?: string | null;
  /** 完成的 stage id,用於地圖標示已完成落點 */
  stageId?: string | null;
  /** 測試可注入時間;正式畫面預設 Date.now */
  resolvedAt?: string;
}

export interface CampaignStageDescriptor {
  id: string;
  code?: string | null;
  name_zh?: string | null;
  campaign_id: string;
  chapter_number: number;
  stage_type?: string | null;
}

export type CampaignStageAccessState = 'completed' | 'current' | 'locked';

export interface CampaignStageAccess<T extends CampaignStageDescriptor = CampaignStageDescriptor> {
  stage: T;
  state: CampaignStageAccessState;
  isRecommended: boolean;
  branchMatched: boolean;
  lockedReason?: string;
  previousChapterResult?: ChapterResultRecord;
}

/** 整備期可購買的玩家卡定義切片(card_definitions row 的安全子集) */
export interface PreparationCardDefinition {
  id: string;
  code?: string | null;
  name_zh?: string | null;
  card_type?: string | null;
  faction?: string | null;
  starting_xp?: number | string | null;
  xp_cost?: number | string | null;
  cost?: number | string | null;
  description_zh?: string | null;
  card_source?: string | null;
  is_unique?: boolean | null;
  is_signature?: boolean | null;
  is_weakness?: boolean | null;
  is_revelation?: boolean | null;
  is_exceptional?: boolean | null;
  is_permanent?: boolean | null;
  is_extra?: boolean | null;
  talent_branch_lock?: string | null;
  effects?: Array<Record<string, unknown>>;
}

export interface PreparationPurchaseResult {
  ok: boolean;
  progress: CampaignProgress;
  xpCost: number;
  reason?: string;
}

export type TalentAttributeKey = keyof InvestigatorState['attributes'];

export interface TalentNodeEffectDefinition {
  id?: string | null;
  node_id?: string | null;
  effect_code: string;
  effect_params?: Record<string, unknown> | null;
  effect_desc_zh?: string | null;
  effect_desc_en?: string | null;
  effect_value?: number | string | null;
  sort_order?: number | string | null;
}

export interface TalentBranchDefinition {
  id: string;
  tree_id?: string;
  branch_index: number | string;
  name_zh?: string | null;
  description_zh?: string | null;
  theme_keywords?: string | null;
  color_hex?: string | null;
}

export interface TalentNodeDefinition {
  id: string;
  tree_id?: string;
  branch_id?: string | null;
  branch_index?: number | string | null;
  level: number | string;
  is_trunk?: boolean | null;
  node_type: string;
  name_zh?: string | null;
  description_zh?: string | null;
  boost_attribute?: string | null;
  boost_amount?: number | string | null;
  talent_card_code?: string | null;
  prerequisites?: unknown;
  talent_point_cost?: number | string | null;
  sort_order?: number | string | null;
  design_status?: string | null;
  effects?: TalentNodeEffectDefinition[];
}

export interface TalentTreeDefinition {
  id: string;
  faction_code: string;
  name_zh?: string | null;
  description_zh?: string | null;
  primary_attribute?: string | null;
  secondary_attribute?: string | null;
  branches?: TalentBranchDefinition[];
  nodes: TalentNodeDefinition[];
}

export interface InvestigatorTalentProgress {
  /** 已投資節點 id */
  unlockedNodeIds: string[];
  /** key = faction code,value = 已投資最高等級 */
  factionLevels: Record<string, number>;
  /** key = faction code,value = 已選分支 index */
  selectedBranches: Record<string, number>;
  /** 天賦樹永久屬性加成,下一場 bootstrap 套進屬性與 HP/SAN 公式 */
  attributeBonuses: Partial<Record<TalentAttributeKey, number>>;
  /** 被動/里程碑/終極/熟練等效果快照;未硬解效果碼前先掛角色供 UI/後續引擎觀察 */
  passiveEffects: InvestigatorTalentEffect[];
  /** 已由天賦節點加入跨章牌組的 card_def id */
  talentCardIds: string[];
  /** 已解鎖但資料庫尚未能對到卡面的 talent_card_code */
  talentCardCodes: string[];
}

export interface TalentUnlockResult {
  ok: boolean;
  progress: CampaignProgress;
  cost: number;
  reason?: string;
  node?: TalentNodeDefinition;
  addedCardId?: string | null;
}

export interface TalentUnlockCheck {
  ok: boolean;
  cost: number;
  reason?: string;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nonNegativeInt(value: unknown): number {
  return Math.max(0, Math.floor(finiteNumber(value, 0)));
}

function positiveInt(value: unknown, fallback = 1): number {
  return Math.max(1, Math.floor(finiteNumber(value, fallback)));
}

const FACTION_CODES = new Set(['E', 'I', 'S', 'N', 'T', 'F', 'J', 'P']);
const ATTRIBUTE_KEYS = new Set<TalentAttributeKey>([
  'strength',
  'agility',
  'constitution',
  'reflex',
  'intellect',
  'willpower',
  'perception',
  'charisma',
]);

function normalizeFactionCode(value: unknown): string | null {
  const v = String(value ?? '').trim().toUpperCase();
  return FACTION_CODES.has(v) ? v : null;
}

function cardFactionCode(card: PreparationCardDefinition): string | null {
  const raw = String(card.faction ?? '').trim();
  const upper = raw.toUpperCase();
  if (!upper || upper === 'NEUTRAL' || upper === 'N0' || upper === 'N/A' || upper === 'NONE') return null;
  return normalizeFactionCode(raw);
}

function normalizeAttributeKey(value: unknown): TalentAttributeKey | null {
  const key = String(value ?? '').trim() as TalentAttributeKey;
  return ATTRIBUTE_KEYS.has(key) ? key : null;
}

export function emptyTalentProgress(): InvestigatorTalentProgress {
  return {
    unlockedNodeIds: [],
    factionLevels: {},
    selectedBranches: {},
    attributeBonuses: {},
    passiveEffects: [],
    talentCardIds: [],
    talentCardCodes: [],
  };
}

export function cloneTalentProgress(
  talents: Partial<InvestigatorTalentProgress> | null | undefined,
): InvestigatorTalentProgress {
  const src = talents ?? {};
  const attributeBonuses: Partial<Record<TalentAttributeKey, number>> = {};
  for (const [key, value] of Object.entries(src.attributeBonuses ?? {})) {
    const attr = normalizeAttributeKey(key);
    if (attr) attributeBonuses[attr] = finiteNumber(value, 0);
  }
  const factionLevels: Record<string, number> = {};
  for (const [key, value] of Object.entries(src.factionLevels ?? {})) {
    const faction = String(key).toUpperCase();
    if (FACTION_CODES.has(faction)) factionLevels[faction] = nonNegativeInt(value);
  }
  const selectedBranches: Record<string, number> = {};
  for (const [key, value] of Object.entries(src.selectedBranches ?? {})) {
    const faction = String(key).toUpperCase();
    const branch = nonNegativeInt(value);
    if (FACTION_CODES.has(faction) && branch >= 1 && branch <= 3) selectedBranches[faction] = branch;
  }
  return {
    unlockedNodeIds: Array.isArray(src.unlockedNodeIds) ? [...new Set(src.unlockedNodeIds.map(String))] : [],
    factionLevels,
    selectedBranches,
    attributeBonuses,
    passiveEffects: Array.isArray(src.passiveEffects)
      ? src.passiveEffects.map((e) => ({
          nodeId: String(e.nodeId),
          factionCode: String(e.factionCode),
          branchIndex: e.branchIndex ?? null,
          nodeType: String(e.nodeType),
          name_zh: e.name_zh ?? null,
          effectCode: String(e.effectCode),
          effectParams: e.effectParams && typeof e.effectParams === 'object' ? { ...e.effectParams } : {},
          description_zh: e.description_zh ?? null,
        }))
      : [],
    talentCardIds: Array.isArray(src.talentCardIds) ? [...new Set(src.talentCardIds.map(String))] : [],
    talentCardCodes: Array.isArray(src.talentCardCodes) ? [...new Set(src.talentCardCodes.map(String))] : [],
  };
}

function carryTalents(carry: InvestigatorCarryover | undefined): InvestigatorTalentProgress {
  return cloneTalentProgress(carry?.talents);
}

function nodeLevel(node: TalentNodeDefinition): number {
  return positiveInt(node.level, 1);
}

function nodeCost(node: TalentNodeDefinition): number {
  return positiveInt(node.talent_point_cost, 1);
}

function nodeBranchIndex(node: TalentNodeDefinition): number | null {
  if (node.branch_index == null) return null;
  const idx = nonNegativeInt(node.branch_index);
  return idx >= 1 && idx <= 3 ? idx : null;
}

function parseTalentBranchLock(lock: unknown): { faction: string; branchIndex: number } | null {
  const m = String(lock ?? '').trim().toUpperCase().match(/^([EISNTFJP])_([123])$/);
  return m ? { faction: m[1], branchIndex: Number(m[2]) } : null;
}

function prerequisiteNodeIds(node: TalentNodeDefinition): string[] {
  const raw = node.prerequisites;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => {
      if (typeof item === 'string') return [item];
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const id = obj.node_id ?? obj.nodeId ?? obj.id;
        return id ? [String(id)] : [];
      }
      return [];
    });
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const ids = obj.node_ids ?? obj.nodeIds ?? obj.all_of ?? obj.requires;
    if (Array.isArray(ids)) return ids.map(String);
    const id = obj.node_id ?? obj.nodeId ?? obj.id;
    return id ? [String(id)] : [];
  }
  return [];
}

function maxUnlockedLevel(tree: TalentTreeDefinition, unlocked: Set<string>): number {
  let max = 0;
  for (const n of tree.nodes) {
    if (unlocked.has(n.id)) max = Math.max(max, nodeLevel(n));
  }
  return max;
}

function talentEffectSnapshots(tree: TalentTreeDefinition, node: TalentNodeDefinition): InvestigatorTalentEffect[] {
  const factionCode = String(tree.faction_code ?? '').toUpperCase();
  const base = {
    nodeId: node.id,
    factionCode,
    branchIndex: nodeBranchIndex(node),
    nodeType: String(node.node_type),
    name_zh: node.name_zh ?? null,
    description_zh: node.description_zh ?? null,
  };
  const effects = node.effects ?? [];
  if (effects.length === 0) {
    return [{
      ...base,
      effectCode: `talent_node:${node.node_type}`,
      effectParams: {},
    }];
  }
  return effects.map((e) => ({
    ...base,
    effectCode: String(e.effect_code),
    effectParams: e.effect_params && typeof e.effect_params === 'object' ? { ...e.effect_params } : {},
    description_zh: e.effect_desc_zh ?? node.description_zh ?? null,
  }));
}

function rewardNumber(rewards: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    if (rewards[key] != null) return nonNegativeInt(rewards[key]);
  }
  return 0;
}

function outcomeText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
}

function chapterResultFor(progress: CampaignProgress, chapterNumber: number): ChapterResultRecord | undefined {
  return progress.chapterResults?.[String(chapterNumber)];
}

function stageMatchesBranch(stage: CampaignStageDescriptor, nextChapterVersion: string | null | undefined): boolean {
  const version = outcomeText(nextChapterVersion);
  if (!version) return false;
  const haystack = [stage.code, stage.name_zh, stage.id]
    .map((v) => String(v ?? '').toLowerCase())
    .join(' ');
  return haystack.includes(version.toLowerCase());
}

function recommendedStageIds<T extends CampaignStageDescriptor>(
  stages: T[],
  progress: CampaignProgress,
): Set<string> {
  const current = progress.currentChapterNumber;
  const candidates = stages
    .filter((s) => s.campaign_id === progress.campaignId && s.chapter_number === current)
    .sort((a, b) => String(a.code ?? a.id).localeCompare(String(b.code ?? b.id)));
  const ids = new Set<string>();
  if (candidates.length === 0) return ids;

  const previous = chapterResultFor(progress, current - 1);
  if (previous?.nextChapterVersion) {
    for (const stage of candidates) {
      if (stageMatchesBranch(stage, previous.nextChapterVersion)) ids.add(stage.id);
    }
    if (ids.size > 0) return ids;
  }

  ids.add(candidates[0].id);
  return ids;
}

function matchedBranchStageIds<T extends CampaignStageDescriptor>(
  stages: T[],
  progress: CampaignProgress,
): Set<string> {
  const previous = chapterResultFor(progress, progress.currentChapterNumber - 1);
  const ids = new Set<string>();
  if (!previous?.nextChapterVersion) return ids;
  for (const stage of stages) {
    if (
      stage.campaign_id === progress.campaignId &&
      stage.chapter_number === progress.currentChapterNumber &&
      stageMatchesBranch(stage, previous.nextChapterVersion)
    ) {
      ids.add(stage.id);
    }
  }
  return ids;
}

/**
 * 隱藏調查加成:只吃 reward_params 明確寫出的 XP 欄位。
 * 不因「有查到隱藏點」自創固定獎勵,避免把平衡數字寫死在引擎。
 */
export function hiddenInvestigationXpBonus(
  points: HiddenPoint[] = [],
  investigatorIds?: string[],
): number {
  const eligible = investigatorIds ? new Set(investigatorIds) : null;
  let total = 0;
  for (const point of points) {
    const claimedCount = point.claimedBy.filter((id) => !eligible || eligible.has(id)).length;
    if (claimedCount <= 0) continue;
    const params = point.rewardParams ?? {};
    const perClaim = rewardNumber(params, ['xp', 'bonus_xp', 'campaign_xp', 'hidden_xp']);
    total += perClaim * claimedCount;
  }
  return total;
}

/**
 * chapter_outcomes.rewards → ScenarioReward。
 * 支援現有種子裡的 talent_point,同時接受前端/後續資料常見的 camelCase。
 */
export function scenarioRewardFromOutcome(
  outcome: OutcomeData | null | undefined,
  hiddenPoints: HiddenPoint[] = [],
  investigatorIds?: string[],
): ScenarioReward {
  const rewards = (outcome?.rewards && typeof outcome.rewards === 'object') ? outcome.rewards : {};
  const xp = rewardNumber(rewards, ['xp', 'experience', 'exp']) +
    hiddenInvestigationXpBonus(hiddenPoints, investigatorIds);
  const talentPoints = rewardNumber(rewards, ['talentPoints', 'talent_points', 'talent_point']);
  const cohesion = finiteNumber(rewards.cohesion, 0);
  const flagSets = outcome?.flag_sets?.filter((set) => !!set?.flag_code) ?? [];
  const outcomeCode = outcomeText(outcome?.outcome_code);
  const nextChapterVersion = outcomeText(outcome?.next_chapter_version);
  return {
    ...(xp > 0 ? { xp } : {}),
    ...(talentPoints > 0 ? { talentPoints } : {}),
    ...(cohesion !== 0 ? { cohesion } : {}),
    ...(flagSets.length > 0 ? { flagSets } : {}),
    ...(outcomeCode ? { outcomeCode } : {}),
    ...(nextChapterVersion ? { nextChapterVersion } : {}),
  };
}

/** 整備期購卡 XP:起始投入 × Exceptional 倍率;永久卡若仍只填舊 xp_cost,用 xp_cost 防止 0 費。 */
export function preparationCardXpCost(card: PreparationCardDefinition): number {
  const startingXp = nonNegativeInt(card.starting_xp);
  const permanentXp = card.is_permanent ? nonNegativeInt(card.xp_cost) : 0;
  const base = permanentXp > 0 ? permanentXp : startingXp;
  return base * (card.is_exceptional ? 2 : 1);
}

export function startingXpLimitForTalentLevel(level: number): number {
  if (level <= 0) return -1;
  if (level <= 1) return 0;
  if (level <= 3) return 1;
  if (level <= 5) return 2;
  if (level <= 7) return 3;
  if (level <= 9) return 4;
  return 5;
}

export function talentLevelForCard(carry: InvestigatorCarryover | undefined, card: PreparationCardDefinition): number {
  const talents = carryTalents(carry);
  const faction = cardFactionCode(card);
  if (faction) return talents.factionLevels[faction] ?? 0;
  return Math.max(0, ...Object.values(talents.factionLevels));
}

export function canAcquireCardByTalent(
  carry: InvestigatorCarryover | undefined,
  card: PreparationCardDefinition,
): { ok: boolean; reason?: string } {
  if (!carry) return { ok: false, reason: 'investigator_not_registered' };

  const talents = carryTalents(carry);
  const startingXp = nonNegativeInt(card.starting_xp);
  const level = talentLevelForCard(carry, card);
  if (startingXp > startingXpLimitForTalentLevel(level)) {
    return { ok: false, reason: 'talent_level_locked' };
  }

  const lock = parseTalentBranchLock(card.talent_branch_lock);
  if (lock && talents.selectedBranches[lock.faction] !== lock.branchIndex) {
    return { ok: false, reason: 'talent_branch_locked' };
  }

  return { ok: true };
}

export function canPurchasePreparationCard(
  carry: InvestigatorCarryover | undefined,
  card: PreparationCardDefinition,
  options: { enforceTalentLocks?: boolean } = {},
): { ok: boolean; reason?: string; xpCost: number } {
  const xpCost = preparationCardXpCost(card);
  const source = String(card.card_source ?? 'standard');
  if (!card.id) return { ok: false, reason: 'missing_card_id', xpCost };
  if (source === 'book_upgrade' || source === 'relic_upgrade') {
    return { ok: false, reason: 'source_not_purchaseable', xpCost };
  }
  if (card.is_signature || card.is_weakness || card.is_extra) {
    return { ok: false, reason: 'special_card_not_purchaseable', xpCost };
  }
  if (!carry) return { ok: false, reason: 'investigator_not_registered', xpCost };
  if (card.is_unique && carry.deck.includes(card.id)) {
    return { ok: false, reason: 'unique_already_owned', xpCost };
  }
  if (options.enforceTalentLocks !== false) {
    const talentCheck = canAcquireCardByTalent(carry, card);
    if (!talentCheck.ok) return { ok: false, reason: talentCheck.reason, xpCost };
  }
  if (carry.xp < xpCost) return { ok: false, reason: 'not_enough_xp', xpCost };
  return { ok: true, xpCost };
}

/** 整備期購買一張卡片副本:扣 XP,把 card_def id 加入跨章牌組組成。 */
export function purchasePreparationCard(
  prev: CampaignProgress,
  investigatorDefinitionId: string,
  card: PreparationCardDefinition,
  options: { enforceTalentLocks?: boolean } = {},
): PreparationPurchaseResult {
  const carry = prev.investigators[investigatorDefinitionId];
  const check = canPurchasePreparationCard(carry, card, options);
  if (!check.ok || !carry) return { ok: false, progress: prev, xpCost: check.xpCost, reason: check.reason };
  const nextCarry: InvestigatorCarryover = {
    ...carry,
    xp: carry.xp - check.xpCost,
    deck: [...carry.deck, card.id],
  };
  return {
    ok: true,
    progress: {
      ...prev,
      investigators: { ...prev.investigators, [investigatorDefinitionId]: nextCarry },
    },
    xpCost: check.xpCost,
  };
}

export function canUnlockTalentNode(
  carry: InvestigatorCarryover | undefined,
  tree: TalentTreeDefinition | null | undefined,
  node: TalentNodeDefinition | null | undefined,
): TalentUnlockCheck {
  const cost = node ? nodeCost(node) : 0;
  if (!carry) return { ok: false, cost, reason: 'investigator_not_registered' };
  if (!tree) return { ok: false, cost, reason: 'missing_talent_tree' };
  if (!node) return { ok: false, cost, reason: 'missing_talent_node' };
  if (!tree.nodes.some((n) => n.id === node.id)) return { ok: false, cost, reason: 'node_not_in_tree' };

  const talents = carryTalents(carry);
  const unlocked = new Set(talents.unlockedNodeIds);
  if (unlocked.has(node.id)) return { ok: false, cost, reason: 'already_unlocked' };
  if (carry.talentPoints < cost) return { ok: false, cost, reason: 'not_enough_talent_points' };

  const factionCode = String(tree.faction_code ?? '').toUpperCase();
  const branchIndex = nodeBranchIndex(node);
  const selectedBranch = talents.selectedBranches[factionCode];
  if (branchIndex && !node.is_trunk) {
    if (node.node_type === 'branch_choice') {
      if (selectedBranch != null && selectedBranch !== branchIndex) {
        return { ok: false, cost, reason: 'talent_branch_locked' };
      }
    } else if (selectedBranch !== branchIndex) {
      return { ok: false, cost, reason: 'talent_branch_required' };
    }
  }

  const prereqs = prerequisiteNodeIds(node);
  if (prereqs.length > 0 && prereqs.some((id) => !unlocked.has(id))) {
    return { ok: false, cost, reason: 'missing_prerequisite' };
  }
  if (prereqs.length === 0 && nodeLevel(node) > 1 && maxUnlockedLevel(tree, unlocked) < nodeLevel(node) - 1) {
    return { ok: false, cost, reason: 'missing_previous_level' };
  }

  return { ok: true, cost };
}

export function unlockTalentNode(
  prev: CampaignProgress,
  investigatorDefinitionId: string,
  tree: TalentTreeDefinition,
  nodeId: string,
  talentCards: PreparationCardDefinition[] = [],
): TalentUnlockResult {
  const carry = prev.investigators[investigatorDefinitionId];
  const node = tree.nodes.find((n) => n.id === nodeId);
  const check = canUnlockTalentNode(carry, tree, node);
  if (!check.ok || !carry || !node) {
    return { ok: false, progress: prev, cost: check.cost, reason: check.reason, node };
  }

  const talents = carryTalents(carry);
  const factionCode = String(tree.faction_code ?? '').toUpperCase();
  const branchIndex = nodeBranchIndex(node);
  talents.unlockedNodeIds.push(node.id);
  talents.factionLevels[factionCode] = Math.max(talents.factionLevels[factionCode] ?? 0, nodeLevel(node));
  if (node.node_type === 'branch_choice' && branchIndex) talents.selectedBranches[factionCode] = branchIndex;

  const attr = normalizeAttributeKey(node.boost_attribute);
  if (node.node_type === 'attribute_boost' && attr) {
    talents.attributeBonuses[attr] = (talents.attributeBonuses[attr] ?? 0) + positiveInt(node.boost_amount, 1);
  }

  const existingEffectKeys = new Set(talents.passiveEffects.map((e) => `${e.nodeId}:${e.effectCode}`));
  for (const effect of talentEffectSnapshots(tree, node)) {
    const key = `${effect.nodeId}:${effect.effectCode}`;
    if (!existingEffectKeys.has(key)) talents.passiveEffects.push(effect);
  }

  let addedCardId: string | null = null;
  const talentCardCode = String(node.talent_card_code ?? '').trim();
  if (node.node_type === 'talent_card' && talentCardCode) {
    if (!talents.talentCardCodes.includes(talentCardCode)) talents.talentCardCodes.push(talentCardCode);
    const card = talentCards.find((c) => String(c.code ?? '').trim() === talentCardCode);
    if (card?.id && !talents.talentCardIds.includes(card.id)) {
      talents.talentCardIds.push(card.id);
      addedCardId = card.id;
    }
  }

  const nextDeck = addedCardId && !carry.deck.includes(addedCardId)
    ? [...carry.deck, addedCardId]
    : [...carry.deck];
  const nextCarry: InvestigatorCarryover = {
    ...carry,
    talentPoints: carry.talentPoints - check.cost,
    talents,
    deck: nextDeck,
  };

  return {
    ok: true,
    progress: {
      ...prev,
      investigators: { ...prev.investigators, [investigatorDefinitionId]: nextCarry },
    },
    cost: check.cost,
    node,
    addedCardId,
  };
}

/** 建空白戰役存檔(開新戰役用;investigators 由 registerInvestigator 逐位加入) */
export function initCampaignProgress(campaignId: string): CampaignProgress {
  return { campaignId, currentChapterNumber: 1, investigators: {}, cohesion: 0, flags: {} };
}

export function resolveCampaignStageAccess<T extends CampaignStageDescriptor>(
  stages: T[],
  progress: CampaignProgress | null | undefined,
): Array<CampaignStageAccess<T>> {
  if (!progress) {
    const firstByCampaign = new Map<string, number>();
    for (const stage of stages) {
      const current = firstByCampaign.get(stage.campaign_id);
      if (current == null || stage.chapter_number < current) firstByCampaign.set(stage.campaign_id, stage.chapter_number);
    }
    return stages.map((stage) => {
      const first = firstByCampaign.get(stage.campaign_id) ?? 1;
      const current = stage.chapter_number === first;
      return {
        stage,
        state: current ? 'current' : 'locked',
        isRecommended: current,
        branchMatched: false,
        lockedReason: current ? undefined : 'future_chapter',
      };
    });
  }

  const recommended = recommendedStageIds(stages, progress);
  const branchMatchedIds = matchedBranchStageIds(stages, progress);
  const previous = chapterResultFor(progress, progress.currentChapterNumber - 1);
  return stages.map((stage) => {
    if (stage.campaign_id !== progress.campaignId) {
      return {
        stage,
        state: 'locked',
        isRecommended: false,
        branchMatched: false,
        lockedReason: 'different_campaign',
      };
    }

    let state: CampaignStageAccessState =
      stage.chapter_number < progress.currentChapterNumber ? 'completed'
        : stage.chapter_number === progress.currentChapterNumber ? 'current'
          : 'locked';
    let lockedReason = state === 'locked' ? 'future_chapter' : undefined;
    if (state === 'current' && branchMatchedIds.size > 0 && !branchMatchedIds.has(stage.id)) {
      state = 'locked';
      lockedReason = 'branch_not_selected';
    }
    const branchMatched = state === 'current' && stageMatchesBranch(stage, previous?.nextChapterVersion);
    return {
      stage,
      state,
      isRecommended: recommended.has(stage.id),
      branchMatched,
      previousChapterResult: previous,
      lockedReason,
    };
  });
}

/**
 * 開新戰役時把一位調查員註冊進存檔:帶起始牌組組成(**定義 id**)、build、滿血滿智。
 * 這是牌組組成(定義 id)進存檔的唯一來源;之後只在整備期變動。
 */
export function registerInvestigator(
  progress: CampaignProgress,
  init: {
    investigatorDefinitionId: string;
    deck: string[]; // 卡片定義 id
    combatStyle: string;
    specializations: string[];
    hpMax: number;
    sanMax: number;
  },
): CampaignProgress {
  // 防呆:已註冊者不覆寫(重複註冊會洗掉累積的 HP/XP/天賦點/創傷)。冪等。
  if (progress.investigators[init.investigatorDefinitionId]) return progress;
  const carry: InvestigatorCarryover = {
    investigatorDefinitionId: init.investigatorDefinitionId,
    hp: init.hpMax,
    san: init.sanMax,
    hpMax: init.hpMax,
    sanMax: init.sanMax,
    traumas: [],
    deck: [...init.deck],
    combatStyle: init.combatStyle,
    specializations: [...init.specializations],
    xp: 0,
    talentPoints: 0,
    talents: emptyTalentProgress(),
    permanentlyDead: false,
  };
  return { ...progress, investigators: { ...progress.investigators, [init.investigatorDefinitionId]: carry } };
}

/**
 * 從一位場景結束的調查員抽出「跨章保留切片」。
 * 變動的(場景中會改的):HP/SAN、創傷、永久死亡 → 取自 inv。
 * 不變的戰役層資料(牌組組成/xp/天賦點)→ 由 prev 沿用。
 * **牌組刻意不讀 inv.deck**:那是場景暫態實例 id 且只剩抽牌堆,沿用 prev 的定義 id 組成才正確。
 */
export function extractCarryover(
  inv: InvestigatorState,
  prev?: InvestigatorCarryover,
): InvestigatorCarryover {
  return {
    investigatorDefinitionId: inv.investigatorDefinitionId,
    hp: inv.hp,
    san: inv.san,
    hpMax: inv.hpMax,
    sanMax: inv.sanMax,
    traumas: inv.traumas.map((t) => ({ ...t })), // 深拷貝避免與 inv 共用參照(存檔被後續 inv 變動污染)
    deck: prev ? [...prev.deck] : [],
    combatStyle: inv.combatStyle,
    specializations: [...inv.specializations],
    xp: prev?.xp ?? 0,
    talentPoints: prev?.talentPoints ?? 0,
    talents: carryTalents(prev),
    permanentlyDead: inv.permanentlyDead,
  };
}

/**
 * 場景結束結算:把各調查員的結束狀態更新進存檔,套上獎勵,合併旗標。
 * - 永久死亡者(角色刪除)從存檔移除;不領獎勵。
 * - XP/天賦點獎勵發給「未永久死亡」的調查員(在場存活才算數)。
 * - 凝聚力是隊伍級;旗標寫入戰役旗標。
 * 不自動進章(進章/長休息由 applyLongRest 負責);本函式是「一個場景打完」的結算。
 */
export function settleScenarioEnd(
  prev: CampaignProgress,
  investigators: Record<string, InvestigatorState>,
  reward: ScenarioReward = {},
): { progress: CampaignProgress; effects: ResultEffect[] } {
  const effects: ResultEffect[] = [];
  const nextInvestigators: Record<string, InvestigatorCarryover> = {};
  const playedDefIds = new Set<string>(); // 這場上場過的(無論存活或永久死亡),第二迴圈不可再從 prev 復活

  for (const inv of Object.values(investigators)) {
    playedDefIds.add(inv.investigatorDefinitionId);
    if (inv.permanentlyDead) {
      effects.push({
        type: 'campaign_investigator_lost',
        params: { investigator: inv.investigatorDefinitionId, narrative: '這位調查員的故事在此終結,資料自戰役中抹去。' },
      });
      continue; // 永久死亡 → 不留存、不領獎
    }
    const carry = extractCarryover(inv, prev.investigators[inv.investigatorDefinitionId]);
    if (reward.xp) carry.xp += reward.xp;
    if (reward.talentPoints) carry.talentPoints += reward.talentPoints;
    nextInvestigators[inv.investigatorDefinitionId] = carry;
  }

  // 保留「這場沒上場但先前存在」的調查員(上場過的已在上面處理,永久死亡的不復活)
  for (const [id, carry] of Object.entries(prev.investigators)) {
    if (!playedDefIds.has(id) && !carry.permanentlyDead) nextInvestigators[id] = carry;
  }

  const flags = { ...prev.flags };
  for (const set of reward.flagSets ?? []) {
    if (set?.flag_code) {
      flags[set.flag_code] = set.value;
      effects.push({ type: 'flag_set', params: { flag_code: set.flag_code, value: set.value } });
    }
  }

  const cohesion = Math.max(0, prev.cohesion + (reward.cohesion ?? 0));
  if (reward.xp || reward.talentPoints) {
    effects.push({ type: 'campaign_reward', params: { xp: reward.xp ?? 0, talentPoints: reward.talentPoints ?? 0 } });
  }

  let chapterResults = prev.chapterResults;
  if (reward.outcomeCode) {
    const result: ChapterResultRecord = {
      chapterNumber: prev.currentChapterNumber,
      outcomeCode: reward.outcomeCode,
      nextChapterVersion: reward.nextChapterVersion ?? null,
      stageId: reward.stageId ?? null,
      resolvedAt: reward.resolvedAt ?? new Date().toISOString(),
    };
    chapterResults = {
      ...(prev.chapterResults ?? {}),
      [String(prev.currentChapterNumber)]: result,
    };
    effects.push({
      type: 'chapter_result_recorded',
      params: {
        chapter: result.chapterNumber,
        outcomeCode: result.outcomeCode,
        nextChapterVersion: result.nextChapterVersion,
      },
    });
  }

  return { progress: { ...prev, investigators: nextInvestigators, cohesion, flags, chapterResults }, effects };
}

/**
 * 長休息(ch2 §1.6:章節結束 → 長休息 → 整備模式)。
 * 規則書明定:長休息固定 +1 凝聚力(ch4 §6.1,不按人數縮放)。本函式推進章節序號並開放整備。
 * 注意:長休息本身不直接回復 HP/SAN(回復走整備期卡片/效果);此處只做凝聚力 + 進章 + 開整備訊號。
 */
export function applyLongRest(prev: CampaignProgress): { progress: CampaignProgress; effects: ResultEffect[] } {
  const progress: CampaignProgress = {
    ...prev,
    cohesion: prev.cohesion + 1,
    currentChapterNumber: prev.currentChapterNumber + 1,
  };
  const effects: ResultEffect[] = [
    { type: 'long_rest', params: { cohesion: progress.cohesion, narrative: '隊伍在篝火旁喘息,彼此的默契又深了一分。' } },
    { type: 'provisioning_open', params: { chapter: progress.currentChapterNumber, narrative: '是時候整備了 — 花用你們這一路換來的東西。' } },
  ];
  return { progress, effects };
}
