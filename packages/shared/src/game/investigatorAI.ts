/**
 * G-04 引擎核心 — 調查員 AI v0(規則型隊友)
 *
 * 「人格即資料」:鏡射城主 AI 的「風格即資料」架構 ——
 * 引擎只有一套「列候選 → 評分 → 執行」的決策框架,個性全部來自零件:
 * ① 牌組(取名綁定的調查員模板牌組,牌堆裡有什麼他就做什麼)
 * ② 屬性配點(評分算成功率,擅長的事自然得分高)
 * ③ 身份能力傾向(InvestigatorAIProfile 權重,對應模板能力的價值觀扭曲)
 * ④ 熟練/戰鬥風格(武器攻擊走 §8 風格卡池,與真人同一條管線)
 *
 * AI 與真人玩家完全平等:所有行動都組 IntentMessage 丟 resolveIntent,
 * 規則引擎統一裁決(行動點/費用/交戰限制/藉機攻擊一視同仁)。
 *
 * 權威依據:
 * - 02_rulebook_ch2.md §4(檢定)§6.1(行動)§7(戰鬥與交戰)
 * - 規則書 ch6 §2.2:創角 18 點 = 基底 14(8+主3+副3)+ 自由 4,上限 5
 * - 支柱一 v0.3 §1.1:偏重字母 → 戰鬥風格(I暗殺/N施法/T工兵/J軍用武器)
 * - keeper_ai_v0_decision_spec:評分制 + 避免單調 + 全參數化(對齊城主側)
 */
import type { ResultEffect, IntentMessage } from './messages';
import { CURRENT_MESSAGE_SCHEMA_VERSION } from './messages';
import type { ScenarioState, InvestigatorState, TurnState } from './state';
import type { AttributeKey } from './checks';
import { commitValueFor } from './checks';
import { resolveIntent } from './ruleEngine';
import type { RuleContext, CardDataLookup, StyleCardData } from './ruleEngine';
import type { EnemyDataLookup } from './monsterActions';
import { attachmentTestModifier } from './keeperAI';
import { hpMaxFor, sanMaxFor } from './upkeep';
import { isDowned, isStanding } from './dying';

// ─── 人格即資料:調查員 AI 設定檔 ─────────────────────
export interface InvestigatorAIProfile {
  /** 名冊代碼(穩定識別) */
  rosterCode: string;
  /** 名字 — AI 的靈魂;取名即綁定該模板的調查員牌組 */
  name_zh: string;
  name_en: string;
  title_zh: string;
  /** 綁定的調查員模板(資料庫 investigator_templates;模板本身名字留白) */
  templateCode: string;
  templateId: string;
  /**
   * 完成角色的自由配點(規則書 ch6 §2.2:模板基底 14 點 + 自由 4 點 = 18,單項上限 5)。
   * 模板是 MBTI×生涯骨架,自由 4 點屬於「這個人」— 跟名字一樣綁在名冊上。
   */
  freeAttributePoints: Partial<Record<AttributeKey, number>>;
  /** 起始戰鬥風格(支柱一 v0.3:偏重字母對應;熟練庫第二層專精) */
  combatStyle: string;
  specializations: string[];
  /** 個性權重 — 同一套評分地形,四個人各自走出四條路 */
  weights: {
    /** 調查/線索行動偏好 */
    clueFocus: number;
    /** 戰鬥行動偏好 */
    combatFocus: number;
    /** 守護隊友(攻擊纏住隊友的怪/嘲諷拉仇恨/靠近隊友) */
    protectAllies: number;
    /** 風險容忍度 0~1:成功率低於此線的檢定不出手(致命誤算式的謹慎 = 低值) */
    riskTolerance: number;
    /** 出牌傾向(資產鋪場/事件時機) */
    cardPlayAffinity: number;
  };
  /** SAN 低於此 % 轉保守(壓低進攻、拉高脫離) */
  sanRetreatPct: number;
  /** HP 低於此 % 轉保守 */
  hpRetreatPct: number;
  /**
   * 決策溫度 0~1:0 = 永遠最佳解;>0 = 偶爾選次佳(AI 會犯小錯,像個人)。
   * 馬庫斯的紀律 = 低溫;薇絲珀活在另一個頻率 = 高溫。
   */
  temperature: number;
  /** 登場台詞(一句;對白量產線接通前的最小演出) */
  introLine: string;
}

/**
 * AI 調查員名冊 — 名字在這裡綁定牌組(2026-06-12,Uria 委任取名)。
 *
 * 配點與熟練皆依規則文件推導,不是自由發揮:
 * - 自由 4 點:順著生涯敘事配(規則書 ch6 §2.2 玩家自由分配的 AI 對應物)
 * - 戰鬥風格:偏重字母 → 支柱一 v0.3 §1.1 凍結表
 */
export const AI_INVESTIGATOR_ROSTER: InvestigatorAIProfile[] = [
  {
    rosterCode: 'elias_crane',
    name_zh: '伊萊亞斯·克雷恩',
    name_en: 'Elias Crane',
    title_zh: '私家偵探',
    templateCode: 'INTJ-1',
    templateId: 'f6ddfe04-cd49-4775-99f2-5edc873e3799',
    // 追查者:感知抓細節、意志撐執念、反射拔左輪(14+4=18)
    freeAttributePoints: { perception: 2, willpower: 1, reflex: 1 },
    combatStyle: 'assassin', // 偏重 I 深淵 → 暗殺(智力配暗殺,違和即資產)
    specializations: ['assassin_ambush'],
    weights: { clueFocus: 3.0, combatFocus: 1.2, protectAllies: 0.8, riskTolerance: 0.5, cardPlayAffinity: 1.0 },
    sanRetreatPct: 35,
    hpRetreatPct: 35,
    temperature: 0.15,
    introLine: '「這案子的方程式還沒解開——在那之前,我不會睡。」',
  },
  {
    rosterCode: 'vesper_grey',
    name_zh: '薇絲珀·格蕾',
    name_en: 'Vesper Grey',
    title_zh: '靈媒',
    templateCode: 'INTJ-2',
    templateId: '36effa3a-5709-47fe-a710-8b6d436da2f5',
    // 通靈者:意志是與彼側周旋的本錢、感知聽見低語
    freeAttributePoints: { willpower: 2, perception: 2 },
    combatStyle: 'arcane', // 偏重 N 天啟 → 施法
    specializations: ['arcane_channeling'],
    weights: { clueFocus: 2.2, combatFocus: 0.8, protectAllies: 1.2, riskTolerance: 0.4, cardPlayAffinity: 1.2 },
    sanRetreatPct: 45, // 她比誰都清楚理智見底是什麼
    hpRetreatPct: 40,
    temperature: 0.25, // 活在另一個頻率
    introLine: '「低語把我引到這裡……你們聽不見,但它一直在說。」',
  },
  {
    rosterCode: 'ada_wexler',
    name_zh: '艾達·韋克斯勒',
    name_en: 'Ada Wexler',
    title_zh: '密碼學家',
    templateCode: 'INTJ-3',
    templateId: '1ad78b83-0b95-4337-9ae8-d935bc85db9f',
    // 明星學者:智力封頂、意志抗惡意文本、感知辨符號
    freeAttributePoints: { intellect: 1, willpower: 1, perception: 2 },
    combatStyle: 'engineer', // 偏重 T 解析 → 工兵
    specializations: ['engineer_mechanic'],
    // 致命誤算懲罰失敗 → 她只做有把握的事(高風險門檻),且最愛投牌堆高勝率
    weights: { clueFocus: 2.6, combatFocus: 1.0, protectAllies: 0.7, riskTolerance: 0.3, cardPlayAffinity: 0.9 },
    sanRetreatPct: 35,
    hpRetreatPct: 40,
    temperature: 0.1,
    introLine: '「凡有系統,必有規律。給我足夠的樣本,我就能解開它。」',
  },
  {
    rosterCode: 'marcus_wainwright',
    name_zh: '馬庫斯·韋恩萊特',
    name_en: 'Marcus Wainwright',
    title_zh: '退役軍官',
    templateCode: 'INTJ-4',
    templateId: '77fb726a-7c12-4197-af19-12262588f475',
    // 戰壕老兵:反射是火線本能、體質扛傷、力量持槍
    freeAttributePoints: { reflex: 2, constitution: 1, strength: 1 },
    combatStyle: 'military', // 偏重 J 鐵壁 → 軍用武器
    specializations: ['military_defensive'],
    // 堅守陣線:他的位置永遠在隊友與怪物之間
    weights: { clueFocus: 1.4, combatFocus: 2.2, protectAllies: 2.5, riskTolerance: 0.65, cardPlayAffinity: 1.0 },
    sanRetreatPct: 25, // 紀律:防線不因恐懼後退
    hpRetreatPct: 30,
    temperature: 0.05, // 軍人的決策最少犯錯
    introLine: '「守住街角,背靠背。這場仗我打過——看不見的敵人也一樣。」',
  },
];

/** 依模板 id 找名冊(取名綁定查詢入口) */
export function rosterProfileForTemplate(templateId: string): InvestigatorAIProfile | null {
  return AI_INVESTIGATOR_ROSTER.find((p) => p.templateId === templateId) ?? null;
}

/**
 * 名冊落地:bootstrap 出來的模板調查員 + 名冊零件 → 完成的 AI 調查員。
 * 自由 4 點疊上去(單項上限 5,規則書 ch6 §2.2)、風格/專精接上、改掛 AI 席位。
 */
export function materializeAIInvestigator(
  built: InvestigatorState,
  profile: InvestigatorAIProfile,
): InvestigatorState {
  const attributes = { ...built.attributes };
  for (const [key, add] of Object.entries(profile.freeAttributePoints)) {
    const k = key as AttributeKey;
    attributes[k] = Math.min(5, (attributes[k] ?? 1) + Number(add ?? 0));
  }
  // 自由配點可能加在體質/意志 → 上限照公式重算(ch6 §3.1)
  const hpMax = hpMaxFor(attributes.constitution);
  const sanMax = sanMaxFor(attributes.willpower);
  return {
    ...built,
    investigatorId: `ai_${profile.rosterCode}`,
    ownerPlayerId: 'ai',
    attributes,
    hpMax,
    hp: hpMax,
    sanMax,
    san: sanMax,
    combatStyle: profile.combatStyle,
    specializations: [...profile.specializations],
  };
}

// ─── AI 運行時狀態(避免單調/原地打轉)─────────────────
export interface InvestigatorAIState {
  lastActionType: string | null;
  /** 上一個離開的地點(防 A↔B 來回踱步) */
  cameFromLocationId: string | null;
}

export function initInvestigatorAIState(): InvestigatorAIState {
  return { lastActionType: null, cameFromLocationId: null };
}

// ─── 成功率估算(d20:需要 roll ≥ dc - mod;天 1 必敗、天 20 必成)──
export function estimateSuccessChance(totalModifier: number, dc: number): number {
  const needed = dc - totalModifier; // 骰出 ≥ needed 即成功
  const successFaces = Math.min(19, Math.max(1, 21 - needed)); // 1~19 面(保留天 1 / 天 20)
  return successFaces / 20;
}

// ─── 投入加值挑選(ch3 §3:技能卡圖示;成功邊緣才投,不浪費)──
export function chooseCommitCards(
  inv: InvestigatorState,
  cardLookup: CardDataLookup,
  attribute: AttributeKey,
  baseModifier: number,
  dc: number,
): string[] {
  const without = estimateSuccessChance(baseModifier, dc);
  if (without >= 0.75) return []; // 已穩,不浪費手牌
  // 候選:手牌中有對應圖示的技能卡(skill 卡本來就是投入用,ch3 §3.2)
  const candidates = inv.hand
    .map((id) => ({ id, data: cardLookup[id] }))
    .filter(({ data }) => data?.card_type === 'skill')
    .map(({ id, data }) => ({ id, value: commitValueFor(attribute, [data?.commit_icons ?? {}]) }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);
  const picked: string[] = [];
  let mod = baseModifier;
  for (const c of candidates) {
    if (estimateSuccessChance(mod, dc) >= 0.75 || picked.length >= 2) break;
    picked.push(c.id);
    mod += c.value;
  }
  // 投了還是远低於五成 → 不值得,收回(資源保護)
  if (picked.length > 0 && estimateSuccessChance(mod, dc) < 0.45) return [];
  return picked;
}

// ─── 行動候選 ─────────────────────────────────
export interface AIPlannedAction {
  actionType: IntentMessage['actionType'];
  payload: Record<string, unknown>;
  score: number;
  /** 給戰役紀錄的意圖描述(名字由容器加) */
  intentNarrative: string;
}

export interface InvestigatorAIContext {
  scenario: ScenarioState;
  investigator: InvestigatorState;
  /** 其他調查員(含玩家;守護隊友評分用) */
  allies: Record<string, InvestigatorState>;
  turnNumber: number;
  locationStats: Record<string, { shroud?: number }>;
  enemyStats: EnemyDataLookup;
  cardLookup: CardDataLookup;
  stylePools: Record<string, StyleCardData[]>;
  /** 混沌袋情境標記效果碼(施法軌場景效果用;傳給 resolveIntent) */
  chaosMarkerEffects?: Record<string, string>;
  /**
   * 當前幕的「該擊敗目標」enemyDefinitionId 清單(來自 front_advance_condition 為擊敗型時)。
   * 設了之後:AI 不再悠哉搜線索,改向目標 boss 聚攏並集火(目標導向,人格權重不變)。
   */
  objectiveEnemyCodes?: string[];
  rng: () => number;
}

/** 武器攻擊的期望屬性修正:對風格池逐卡平均(屬性 + 武器對應屬性加成) */
function weaponExpectedModifier(
  inv: InvestigatorState,
  weaponId: string,
  cardLookup: CardDataLookup,
  stylePools: Record<string, StyleCardData[]>,
): { modifier: number; damage: number } | null {
  const weapon = cardLookup[weaponId];
  const style = String(weapon?.combat_style ?? '');
  const pool = stylePools[style] ?? [];
  if (pool.length === 0) return null;
  let sum = 0;
  for (const sc of pool) {
    const attr = sc.check_attribute as AttributeKey;
    const attrVal = inv.attributes[attr] ?? 0;
    sum += attrVal + Number(weapon?.attribute_modifiers?.[attr] ?? 0);
  }
  const attackFx = (weapon?.effects ?? []).find(
    (f) => f.trigger_type === 'action' && f.effect_code === 'attack',
  );
  const p = (attackFx?.effect_params ?? {}) as Record<string, unknown>;
  const damage = Number(p.damage ?? 2) + Number(p.damage_bonus ?? 0);
  return { modifier: sum / pool.length, damage };
}

/** 退守判定:HP/SAN 任一低於名冊線 → 保守模式 */
function isRetreating(inv: InvestigatorState, profile: InvestigatorAIProfile): boolean {
  const hpPct = inv.hpMax > 0 ? (inv.hp / inv.hpMax) * 100 : 0;
  const sanPct = inv.sanMax > 0 ? (inv.san / inv.sanMax) * 100 : 0;
  return hpPct < profile.hpRetreatPct || sanPct < profile.sanRetreatPct;
}

/**
 * 列出本行動點的所有合法候選並評分。
 * 評分地形 = 成功率 × 個性權重 × 局勢;不寫死「偵探該像偵探」——
 * 牌組與屬性自然分工,權重只是把同一張地圖照出不同的等高線。
 */
export function enumerateCandidates(
  ctx: InvestigatorAIContext,
  profile: InvestigatorAIProfile,
  aiState: InvestigatorAIState,
): AIPlannedAction[] {
  const { scenario, investigator: inv, allies, locationStats, enemyStats, cardLookup, stylePools } = ctx;
  const out: AIPlannedAction[] = [];
  const retreating = isRetreating(inv, profile);
  const here = scenario.locations.find((l) => l.locationDefinitionId === inv.currentLocationId);
  const enemiesHere = scenario.enemies.filter((e) => e.hp > 0 && e.locationId === inv.currentLocationId);
  const aliveEnemies = scenario.enemies.filter((e) => e.hp > 0);
  // 目標導向:幕條件是「擊敗某 boss」時,該 boss 還活著 → 全隊向它聚攏集火、別再悠哉搜線索
  const objectiveCodes = ctx.objectiveEnemyCodes ?? [];
  const isObjective = (e: { enemyDefinitionId: string }) => objectiveCodes.includes(e.enemyDefinitionId);
  const objectiveAlive = aliveEnemies.some(isObjective);
  const engaged = inv.engagedWith
    .map((id) => scenario.enemies.find((e) => e.instanceId === id))
    .filter((e): e is NonNullable<typeof e> => !!e && e.hp > 0);
  const otherAllies = Object.values(allies).filter((a) => a.investigatorId !== inv.investigatorId && !a.permanentlyDead);

  // ── 調查(感知 vs shroud)──
  {
    const dc = locationStats[inv.currentLocationId ?? '']?.shroud ?? 10;
    const mod = inv.attributes.perception + attachmentTestModifier(scenario.keeperAttachments, 'perception');
    const commit = chooseCommitCards(inv, cardLookup, 'perception', mod, dc);
    const p = estimateSuccessChance(mod + commitValueFor('perception', commit.map((id) => cardLookup[id]?.commit_icons ?? {})), dc);
    if (p >= profile.weights.riskTolerance * 0.6) {
      // 交戰中調查會吃藉機攻擊(§7.2)→ 重罰
      const engagedPenalty = engaged.length > 0 ? 0.2 : 1;
      out.push({
        actionType: 'investigate',
        // 目標 boss 還活著:搜線索退居其次(否則悠哉搜到全滅也不打 boss)
        payload: commit.length > 0 ? { commitCardIds: commit } : {},
        score: profile.weights.clueFocus * p * engagedPenalty * (objectiveAlive ? 0.2 : 1),
        intentNarrative: '在這裡仔細搜查',
      });
    }
  }

  // ── 攻擊(武器優先,徒手墊底)──
  // 卡片優先(Uria 裁定):「用場上的卡」(武器攻擊/施法)是卡片動作,價值遠高於基本動作(1V),
  // 拿卡片級優先分,不再被當廉價基本動作低估 → 打出來的武器一定會開火,不會擱著去搜線索。
  const CARD_ACTION_BONUS = 1.6;
  for (const enemy of enemiesHere) {
    const stats = enemyStats[enemy.enemyDefinitionId];
    const dc = stats?.dc ?? 10;
    const vis = here?.visibility === 'night' || here?.visibility === 'darkness' ? -2 : 0;
    const engagedWithAlly = otherAllies.some((a) => enemy.engagedWith.includes(a.investigatorId));
    const protectBonus = engagedWithAlly ? profile.weights.protectAllies : 0;
    const finishBonus = enemy.hp <= 2 ? 0.8 : 0; // 補刀:差一口氣的怪優先清掉
    const objectiveBonus = isObjective(enemy) ? 3.5 : 0; // 幕目標 boss:集火(壓過搜線索)
    const retreatMul = retreating ? 0.4 : 1;

    // 武器攻擊(場上有 attack 行動效果的資產;彈藥耗盡的略過)
    for (const weaponId of inv.assetsInPlay) {
      const hasAttack = (cardLookup[weaponId]?.effects ?? []).some(
        (f) => f.trigger_type === 'action' && f.effect_code === 'attack',
      );
      if (!hasAttack) continue;
      const usesLeft = inv.assetState?.[weaponId]?.usesLeft;
      if (usesLeft != null && usesLeft <= 0) continue;
      const expect = weaponExpectedModifier(inv, weaponId, cardLookup, stylePools);
      if (!expect) continue;
      const p = estimateSuccessChance(expect.modifier + vis, dc);
      if (p < profile.weights.riskTolerance * 0.5) continue;
      out.push({
        actionType: 'execute_card_action',
        payload: { cardInstanceId: weaponId, enemyInstanceId: enemy.instanceId },
        // 卡片動作:基底 CARD_ACTION_BONUS(>1V)+ 戰意×命中×傷害 + 護援/補刀/目標集火
        score: (CARD_ACTION_BONUS + profile.weights.combatFocus * p * (1 + expect.damage * 0.3) + protectBonus + finishBonus + objectiveBonus) * retreatMul,
        intentNarrative: `舉起${cardLookup[weaponId]?.name_zh ?? '武器'}攻擊`,
      });
    }
    // 徒手(力量,傷害 1)— 沒武器時的下策
    {
      const mod = inv.attributes.strength;
      const p = estimateSuccessChance(mod + vis, dc);
      if (p >= profile.weights.riskTolerance * 0.5) {
        out.push({
          actionType: 'attack',
          payload: { enemyInstanceId: enemy.instanceId },
          score: (profile.weights.combatFocus * p * 0.9 + protectBonus + finishBonus + objectiveBonus) * retreatMul,
          intentNarrative: '徒手撲向那東西',
        });
      }
    }
  }

  // ── 閃避(交戰中;退守時權重大增)──
  if (engaged.length > 0) {
    const target = engaged[0];
    const dc = enemyStats[target.enemyDefinitionId]?.dc ?? 10;
    const vis = here?.visibility === 'night' || here?.visibility === 'darkness' ? 2 : 0;
    const p = estimateSuccessChance(inv.attributes.reflex + vis, dc);
    const urgency = retreating ? 2.5 : 0.6; // 健康時傾向打贏而不是逃
    out.push({
      actionType: 'evade',
      payload: { enemyInstanceId: target.instanceId },
      score: urgency * (0.4 + p * 0.6),
      intentNarrative: '側身脫離糾纏',
    });
  }

  // ── 穩定救援(§9.5):同地點有瀕死隊友 → 最高優先級之一(見死不救不是選項)──
  for (const ally of otherAllies) {
    if (!isDowned(ally)) continue;
    if (ally.currentLocationId === inv.currentLocationId) {
      out.push({
        actionType: 'stabilize',
        payload: { targetInvestigatorId: ally.investigatorId },
        // 基礎分高到壓過日常行動;守護型(馬庫斯)再往上疊
        score: 2.5 + profile.weights.protectAllies * 1.5,
        intentNarrative: '撲到倒下的隊友身邊壓住傷勢',
      });
    }
  }

  // ── 嘲諷(把纏住隊友的怪拉到自己身上;鐵壁的本能)──
  if (!retreating) {
    for (const enemy of enemiesHere) {
      if (enemy.engagedWith.includes(inv.investigatorId)) continue;
      const harassingAlly = otherAllies.some((a) => enemy.engagedWith.includes(a.investigatorId));
      if (!harassingAlly) continue;
      out.push({
        actionType: 'taunt',
        payload: { enemyInstanceId: enemy.instanceId },
        score: profile.weights.protectAllies * 1.2,
        intentNarrative: '吼出聲把怪物的注意力拉向自己',
      });
    }
  }

  // ── 出牌(資產鋪場/相關事件)──
  // 設計裁定(Uria 2026-06-12):卡片的價值永遠比單純動作高 —
  // 打得出的卡加固定優先分;打不起的好卡讓「拿資源」繼承折扣分(存錢買刀)。
  const CARD_FIRST_BONUS = 1.0;
  let bestUnaffordable = 0;
  for (const cardId of inv.hand) {
    const data = cardLookup[cardId];
    // 技能(投入用)/弱點(強制顯現物)/無類型(資料不明)都不打
    if (!data || !data.card_type || data.card_type === 'skill' || data.card_type === 'weakness') continue;
    const cost = Number(data.cost ?? 0);
    const fx = data.effects ?? [];
    let value = 0;
    let narrative = `打出「${data.name_zh ?? ''}」`;
    const isArcaneSpell = String(data.combat_style ?? '') === 'arcane';
    if (fx.some((f) => f.trigger_type === 'action' && f.effect_code === 'attack')) {
      // 武器:場上沒武器且場上有威脅時鋪場價值高
      const armed = inv.assetsInPlay.some((id) =>
        (cardLookup[id]?.effects ?? []).some((f) => f.trigger_type === 'action' && f.effect_code === 'attack'),
      );
      value = aliveEnemies.length > 0 && !armed ? 2.4 : 0.8;
    } else if (isArcaneSpell) {
      // 施法事件(ch2 §8.4 神秘攻擊):一定命中、穿透抗性,但抽混沌袋有 SAN 風險。
      // 有目標才打;戰意權重 × 命中保證(法術不擲骰),SAN 低時謹慎(玩火不玩命)。
      const hasDamage = fx.some((f) => /deal_(damage|horror)/.test(String(f.effect_code)));
      const sanPct = inv.sanMax > 0 ? (inv.san / inv.sanMax) * 100 : 0;
      const sanCaution = sanPct < profile.sanRetreatPct + 15 ? 0.5 : 1;
      value = hasDamage && enemiesHere.length > 0 ? profile.weights.combatFocus * 1.6 * sanCaution : 0;
    } else if (data.card_type === 'event') {
      // 事件:效果碼相關性(打傷害要有目標/補給通用)
      const codes = new Set(fx.filter((f) => f.trigger_type === 'action').map((f) => String(f.effect_code).replace(/\(.*\)$/, '')));
      if (codes.has('deal_damage')) value = enemiesHere.length > 0 ? 1.8 : 0;
      else if (codes.has('discover_clue')) value = profile.weights.clueFocus * 0.6;
      else if (codes.has('draw_card') || codes.has('gain_resource') || codes.has('search_deck')) value = 1.0;
      else if (codes.size > 0) value = 0.7;
    } else {
      // 資產/盟友:鋪場通用價值(被動會在檢定管線自動聚合)
      value = 1.2;
    }
    if (value <= 0) continue;
    // 整回合三行動價值鏈(Uria #1):打出有「行動效果」的資產後,本回合還能用它(每次 ≥ CARD_ACTION_BONUS=1.6V > 1V 基本動作)。
    // 「一動打牌鋪場 + 後續用牌」整回合產出 > 3 個基本動作 → AI 為了 combo 而鋪場(通用,不限武器;武器是其特例)。
    const usableActions = fx.filter((f) => f.trigger_type === 'action');
    if (usableActions.length > 0 && data.card_type !== 'event') {
      const usesThisTurn = Math.min(Math.max(0, inv.actionPoints - 1), 2); // 鋪場花 1AP,剩餘可用次數(本回合上限 2)
      const needsEnemy = usableActions.every((f) => /attack|deal_damage|stun_enemy|taunt/.test(String(f.effect_code)));
      if (usesThisTurn > 0 && (!needsEnemy || enemiesHere.length > 0)) {
        value += usesThisTurn * CARD_ACTION_BONUS;
        narrative += '(接著就能用它)';
      }
    }
    const score = (value + CARD_FIRST_BONUS) * profile.weights.cardPlayAffinity;
    if (cost > inv.resources) {
      bestUnaffordable = Math.max(bestUnaffordable, score);
      continue;
    }
    out.push({
      actionType: 'play_card',
      payload: { cardInstanceId: cardId },
      score,
      intentNarrative: narrative,
    });
  }

  // ── 移動(評分逐相鄰地點;交戰中移動吃藉機攻擊 → 重罰)──
  if (here) {
    for (const targetId of here.connectedTo) {
      if (scenario.unlockedLocations.length > 0 && !scenario.unlockedLocations.includes(targetId)) continue;
      const target = scenario.locations.find((l) => l.locationDefinitionId === targetId);
      const cost = target?.isObstacle ? 2 : 1;
      if (inv.actionPoints < cost) continue;
      let value = 0.3; // 基礎好奇心
      // 守護:隊友在隔壁被怪纏住 → 過去支援
      const allyInDanger = otherAllies.some(
        (a) => a.currentLocationId === targetId && a.engagedWith.length > 0,
      );
      if (allyInDanger) value += profile.weights.protectAllies * 1.5;
      // 救援:隊友在隔壁倒地 → 趕過去(比纏鬥支援更急)
      const allyDownedThere = otherAllies.some(
        (a) => isDowned(a) && a.currentLocationId === targetId,
      );
      if (allyDownedThere) value += 2.0 + profile.weights.protectAllies * 1.2;
      // 調查:隔壁更好查(shroud 更低)
      const hereShroud = locationStats[inv.currentLocationId ?? '']?.shroud ?? 10;
      const thereShroud = locationStats[targetId]?.shroud ?? 10;
      if (thereShroud < hereShroud) value += profile.weights.clueFocus * 0.25;
      // 戰意:有怪的地點(健康且好戰才湊過去)
      const enemyThere = scenario.enemies.some((e) => e.hp > 0 && e.locationId === targetId);
      if (enemyThere && !retreating) value += profile.weights.combatFocus * 0.4;
      // 目標導向:幕目標 boss 在隔壁 → 強烈聚攏過去集火(壓過搜線索的好奇心)
      const objectiveThere = scenario.enemies.some((e) => e.hp > 0 && e.locationId === targetId && isObjective(e));
      if (objectiveThere && !retreating) value += 3.0 + profile.weights.combatFocus * 0.6;
      if (enemyThere && retreating) value -= 1.5;
      // 退守:離開有怪的地點
      if (retreating && enemiesHere.length > 0 && !enemyThere) value += 1.8;
      // 防踱步:剛從那裡過來
      if (targetId === aiState.cameFromLocationId) value -= 1.2;
      // 交戰中移動 = 吃藉機攻擊(§7.2)— 想脫身先閃避,不硬走
      if (engaged.length > 0) value -= 2.0;
      if (value <= 0.2) continue;
      out.push({
        actionType: 'move',
        payload: { targetLocationId: targetId },
        score: value,
        intentNarrative: '移動過去',
      });
    }
  }

  // ── 補給(拿資源/抽卡)──
  {
    // 存錢買刀:打不起的最好那張卡,讓拿資源繼承 85% 折扣分
    // (連續存兩回合就買得起 2-3 費武器;比漫無目的翻找有方向)
    // 守則:交戰中或退守時不購物(Raviel BLOCK 回歸)— 先活下來,錢之後再存
    const calm = engaged.length === 0 && !retreating;
    const resourceValue = Math.max(0.4, calm ? bestUnaffordable * 0.85 : 0);
    out.push({ actionType: 'gain_resource', payload: {}, score: resourceValue, intentNarrative: '整理隨身物資' });
    if (inv.deck.length > 0) {
      const drawValue = inv.hand.length < 3 ? 1.0 : 0.35;
      out.push({ actionType: 'draw_card', payload: {}, score: drawValue, intentNarrative: '翻找更多手段' });
    }
  }

  // 避免單調:補給類連發遞減(調查/攻擊連發是正常戰術,不罰)
  for (const c of out) {
    if (c.actionType === aiState.lastActionType && (c.actionType === 'gain_resource' || c.actionType === 'draw_card')) {
      c.score -= 0.5;
    }
  }
  return out;
}

/**
 * 挑一個行動:最佳解為主,依決策溫度偶爾選次佳(會犯小錯,像個人)。
 * 全部候選都低於行動門檻 → null(本行動點不硬做事,留給回合結束)。
 */
export function planNextAction(
  ctx: InvestigatorAIContext,
  profile: InvestigatorAIProfile,
  aiState: InvestigatorAIState,
): AIPlannedAction | null {
  const candidates = enumerateCandidates(ctx, profile, aiState)
    .filter((c) => c.score > 0.25)
    .sort((a, b) => b.score - a.score);
  if (candidates.length === 0) return null;
  if (candidates.length > 1 && ctx.rng() < profile.temperature) {
    return candidates[1]; // 小錯:次佳解
  }
  return candidates[0];
}

// ════════════════════════════════════════════════════════════════
// #2 模擬-評分 整回合規劃器(Uria 2026-06-17 設計)
// 不定義 combo:模擬卡序的真實效果 + 評分 + beam search,combo 自動浮現。
// 一台引擎解三件事:#1 整回合價值鏈 / #2(a) 牌組覺察 / #2(b) 軸向 combo。
// ════════════════════════════════════════════════════════════════
const PLAN_BEAM_WIDTH = 4; // 每層保留前 K 條序列
const PLAN_BRANCH = 5;     // 每個狀態最多展開 M 個候選(依即時分剪枝)
const ACTION_POTENTIAL = 1.6; // 一個未兌現卡片動作的潛在價值(= CARD_ACTION_BONUS)

function axisKeyOf(id: string, cl: CardDataLookup): string {
  const d = cl[id];
  const v = String(d?.primary_axis_value ?? '');
  return v ? String(d?.primary_axis_layer ?? '') + ':' + v : '';
}

/** 2(a) 牌組覺察:場上+手上的主軸 vs 牌組同軸濃度 → 構築方向潛力(越厚越值錢) */
function deckAxisPotential(inv: InvestigatorState, cl: CardDataLookup): number {
  const counts: Record<string, number> = {};
  for (const id of [...inv.assetsInPlay, ...inv.hand]) {
    const a = axisKeyOf(id, cl);
    if (a) counts[a] = (counts[a] ?? 0) + 1;
  }
  let best = 0;
  for (const [axis, n] of Object.entries(counts)) {
    if (n < 2) continue; // 至少手上/場上 2 張同軸才算在構築
    const inDeck = inv.deck.filter((id) => axisKeyOf(id, cl) === axis).length;
    best = Math.max(best, (n + inDeck) * 0.15);
  }
  return best;
}

/** 潛力項(關鍵):未兌現的價值。讓 combo 的「鋪陳步」不被當廢步剪掉。 */
function statePotential(inv: InvestigatorState, cl: CardDataLookup): number {
  let p = 0;
  for (const id of inv.assetsInPlay) {
    const hasAction = (cl[id]?.effects ?? []).some((f) => f.trigger_type === 'action');
    const usesLeft = inv.assetState?.[id]?.usesLeft;
    if (hasAction && (usesLeft == null || usesLeft > 0)) p += ACTION_POTENTIAL; // 場上資產還能用 = 潛在卡片動作
  }
  for (const id of inv.hand) {
    const d = cl[id];
    if (d && d.card_type && d.card_type !== 'skill' && d.card_type !== 'weakness') p += 0.4; // 手牌潛力
  }
  p += deckAxisPotential(inv, cl);
  return p;
}

/** 一把尺:把狀態壓成一個分數(AI 唯一的價值觀)。所有規劃繞它。 */
export function scoreState(
  inv: InvestigatorState,
  scenario: ScenarioState,
  ctx: InvestigatorAIContext,
  profile: InvestigatorAIProfile,
): number {
  const w = profile.weights;
  const objectiveCodes = ctx.objectiveEnemyCodes ?? [];
  let s = 0;
  // 戰鬥推進:敵人活著扣分(目標 boss 加重)→ 清怪/集火加分
  for (const e of scenario.enemies) {
    if (e.hp <= 0) continue;
    const isObj = objectiveCodes.includes(e.enemyDefinitionId);
    s -= e.hp * w.combatFocus * (isObj ? 1.2 : 0.4);
  }
  // 線索/目標推進
  s += scenario.objectiveProgress * w.clueFocus * 2;
  // 自身存活(低血/低 SAN 陡降)
  const hpPct = inv.hpMax > 0 ? inv.hp / inv.hpMax : 0;
  const sanPct = inv.sanMax > 0 ? inv.san / inv.sanMax : 0;
  s += (hpPct + sanPct) * 3;
  if (hpPct < 0.34) s -= 4;
  if (sanPct < 0.34) s -= 4;
  // 潛力(手牌/場上/牌組)— combo 鋪陳步靠這項保住
  s += statePotential(inv, ctx.cardLookup);
  s += inv.resources * 0.2;
  return s;
}

/** 模擬器:把一個行動丟進真引擎跑,回傳新狀態(被駁回回 null)。借真引擎 → 模擬 = 實戰。 */
function simulateStep(
  ctx: InvestigatorAIContext,
  inv: InvestigatorState,
  scenario: ScenarioState,
  allies: Record<string, InvestigatorState>,
  action: AIPlannedAction,
): { inv: InvestigatorState; scenario: ScenarioState; allies: Record<string, InvestigatorState> } | null {
  const intent: IntentMessage = {
    id: 'sim', timestamp: '1970-01-01T00:00:00Z', schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION,
    source: 'ai', kind: 'intent', actionType: action.actionType, payload: action.payload,
    playerId: 'ai', investigatorId: inv.investigatorId,
  };
  const ruleCtx: RuleContext = {
    scenario, investigator: inv,
    turn: { turnNumber: ctx.turnNumber, phase: 'investigator', actionPointsSpent: {}, pendingLegendaryActions: [], triggeredReactions: [] },
    investigators: { ...allies, [inv.investigatorId]: inv },
    cardLookup: ctx.cardLookup, locationStats: ctx.locationStats, enemyStats: ctx.enemyStats,
    stylePools: ctx.stylePools, chaosMarkerEffects: ctx.chaosMarkerEffects, rng: ctx.rng,
  };
  const r = resolveIntent(intent, ruleCtx);
  if (r.result.outcome === 'rejected') return null;
  const nextAllies = { ...allies };
  for (const [id, a] of Object.entries(r.newState?.updatedAllies ?? {})) nextAllies[id] = a;
  return {
    inv: r.newState?.investigator ?? inv,
    scenario: r.newState?.scenario ?? scenario,
    allies: nextAllies,
  };
}

interface PlanNode {
  inv: InvestigatorState;
  scenario: ScenarioState;
  allies: Record<string, InvestigatorState>;
  aiState: InvestigatorAIState;
  first: AIPlannedAction | null; // 這條序列的第一步(AI 真正會執行的)
  score: number;
}

/**
 * 整回合前瞻:beam search 模擬卡序,回傳最佳「第一步」。取代 planNextAction。
 * combo 自動浮現:打 A 再打 B 的終局分 > 各自獨立 → 搜尋自然選它。
 */
export function planTurn(
  ctx: InvestigatorAIContext,
  profile: InvestigatorAIProfile,
  aiState: InvestigatorAIState,
): AIPlannedAction | null {
  const start: PlanNode = { inv: ctx.investigator, scenario: ctx.scenario, allies: ctx.allies, aiState, first: null, score: 0 };
  let beam: PlanNode[] = [start];
  const depth = Math.min(3, Math.max(1, ctx.investigator.actionPoints));
  let anyExpanded = false;
  for (let d = 0; d < depth; d += 1) {
    const next: PlanNode[] = [];
    for (const node of beam) {
      if (node.inv.actionPoints <= 0 || !isStanding(node.inv)) { next.push(node); continue; } // 不能再動 → 原狀態帶到底
      const subCtx: InvestigatorAIContext = { ...ctx, investigator: node.inv, scenario: node.scenario, allies: node.allies };
      const cands = enumerateCandidates(subCtx, profile, node.aiState)
        .filter((c) => c.score > 0.25)
        .sort((a, b) => b.score - a.score)
        .slice(0, PLAN_BRANCH); // 即時分剪枝:只模擬最有希望的 M 個
      if (cands.length === 0) { next.push(node); continue; }
      for (const c of cands) {
        const sim = simulateStep(ctx, node.inv, node.scenario, node.allies, c);
        if (!sim) continue;
        anyExpanded = true;
        const simCtx: InvestigatorAIContext = { ...ctx, investigator: sim.inv, scenario: sim.scenario, allies: sim.allies };
        next.push({
          inv: sim.inv, scenario: sim.scenario, allies: sim.allies,
          aiState: { lastActionType: c.actionType, cameFromLocationId: c.actionType === 'move' ? (node.inv.currentLocationId ?? node.aiState.cameFromLocationId) : node.aiState.cameFromLocationId },
          first: node.first ?? c,
          score: scoreState(sim.inv, sim.scenario, simCtx, profile),
        });
      }
    }
    if (next.length === 0) break;
    beam = next.sort((a, b) => b.score - a.score).slice(0, PLAN_BEAM_WIDTH); // beam:留終局分前 K
  }
  if (!anyExpanded) return null;
  const ranked = beam.filter((n) => n.first).sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  // 溫度:偶爾選次佳序列(像人,會小失誤)
  if (ranked.length > 1 && ctx.rng() < profile.temperature) return ranked[1].first;
  return ranked[0].first;
}

// ─── AI 回合執行(與真人同管線:組 Intent → resolveIntent)──
export interface AITurnStep {
  actionType: string;
  intentNarrative: string;
  outcome: 'accepted' | 'rejected';
  effects: ResultEffect[];
  rejection?: string;
}

export interface AITurnResult {
  investigator: InvestigatorState;
  scenario: ScenarioState;
  aiState: InvestigatorAIState;
  steps: AITurnStep[];
  /** 本回合被 AI 改動的其他調查員(穩定救援;key = investigatorId) */
  updatedAllies: Record<string, InvestigatorState>;
}

export function runInvestigatorAITurn(
  ctx: Omit<InvestigatorAIContext, 'rng'> & { rng?: () => number },
  profile: InvestigatorAIProfile,
  aiState: InvestigatorAIState,
): AITurnResult {
  const rng = ctx.rng ?? Math.random;
  let inv = ctx.investigator;
  let scenario = ctx.scenario;
  let state = aiState;
  let allies = { ...ctx.allies };
  const steps: AITurnStep[] = [];
  const updatedAllies: Record<string, InvestigatorState> = {};

  // 安全上限:行動點 3 + 障礙誤差;一次被駁回就停(防呆迴圈)
  for (let guard = 0; guard < 8 && inv.actionPoints > 0; guard += 1) {
    if (!isStanding(inv)) break; // 瀕死/死亡不行動(§9)
    const fullCtx: InvestigatorAIContext = { ...ctx, scenario, investigator: inv, allies, rng };
    // 整回合前瞻規劃(模擬卡序 + 評分 + beam search):回最佳第一步,執行後滾動重算
    const plan = planTurn(fullCtx, profile, state);
    if (!plan) break;

    const intent: IntentMessage = {
      id: `ai-${profile.rosterCode}-t${ctx.turnNumber}-${guard}`,
      timestamp: new Date().toISOString(),
      schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION,
      source: 'ai',
      kind: 'intent',
      actionType: plan.actionType,
      payload: plan.payload,
      playerId: 'ai',
      investigatorId: inv.investigatorId,
    };
    const turn: TurnState = {
      turnNumber: ctx.turnNumber,
      phase: 'investigator',
      actionPointsSpent: {},
      pendingLegendaryActions: [],
      triggeredReactions: [],
    };
    const ruleCtx: RuleContext = {
      scenario,
      investigator: inv,
      turn,
      investigators: { ...allies, [inv.investigatorId]: inv },
      cardLookup: ctx.cardLookup,
      locationStats: ctx.locationStats,
      enemyStats: ctx.enemyStats,
      stylePools: ctx.stylePools,
      chaosMarkerEffects: ctx.chaosMarkerEffects,
      rng,
    };
    const resolved = resolveIntent(intent, ruleCtx);
    if (resolved.result.outcome === 'rejected') {
      steps.push({
        actionType: plan.actionType,
        intentNarrative: plan.intentNarrative,
        outcome: 'rejected',
        effects: [],
        rejection: resolved.result.rejection?.narrative,
      });
      break; // 引擎說不行就停手 — 不跟規則吵架
    }
    const prevLocation = inv.currentLocationId;
    inv = resolved.newState?.investigator ?? inv;
    scenario = resolved.newState?.scenario ?? scenario;
    // 穩定救援等改動到的隊友:更新本地視野 + 回傳給容器
    for (const [id, ally] of Object.entries(resolved.newState?.updatedAllies ?? {})) {
      allies[id] = ally;
      updatedAllies[id] = ally;
    }
    state = {
      lastActionType: plan.actionType,
      cameFromLocationId:
        plan.actionType === 'move' ? prevLocation ?? state.cameFromLocationId : state.cameFromLocationId,
    };
    steps.push({
      actionType: plan.actionType,
      intentNarrative: plan.intentNarrative,
      outcome: 'accepted',
      effects: resolved.result.effects ?? [],
    });
  }
  return { investigator: inv, scenario, aiState: state, steps, updatedAllies };
}
