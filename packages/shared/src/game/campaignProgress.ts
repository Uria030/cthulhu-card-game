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
import type { InvestigatorState, Trauma } from './state';
import type { ResultEffect } from './messages';

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
  /** 上限歸 0 → 永久死亡(角色資料刪除;ch2 §9.6) */
  permanentlyDead: boolean;
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
}

/** 建空白戰役存檔(開新戰役用;investigators 由 registerInvestigator 逐位加入) */
export function initCampaignProgress(campaignId: string): CampaignProgress {
  return { campaignId, currentChapterNumber: 1, investigators: {}, cohesion: 0, flags: {} };
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

  return { progress: { ...prev, investigators: nextInvestigators, cohesion, flags }, effects };
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
