/**
 * G-02 引擎核心 — 檢定管線(d20 軌 + 混沌袋軌)
 *
 * 權威依據(實作逐條對齊,不自創規則):
 * - 02_rulebook_ch2.md §4.1-4.4:d20 + 屬性(1:1) + 熟練/專精 + 裝備/卡牌;
 *   自然 20 戰鬥傷害 ×2;自然 1 有交戰隊友時誤傷隊友,否則純未命中
 * - §4.2-4.3 + 03_rulebook_ch3.md §3:加值(commit)在擲骰前投入手牌屬性圖示,
 *   不花行動點,卡片直接進棄牌堆;{all: N} 為萬能圖示
 * - §5 + h05_supp04_chaos.md:法術一定命中,抽混沌袋定副作用;
 *   數字標記抽後放回 / 祝福詛咒抽後移出袋並連鎖再抽 /
 *   觸手自動最壞+SAN-1 / 遠古印記自動最高+SAN+1 /
 *   神話類標記(線索/頭條/怪物/毀滅/次元門)場景效果無視法術防禦一律發動
 * - §12.1 光照:夜間/黑暗無視線攻擊 -2、黑暗中閃避 +2
 */
import type { ChaosToken } from './state';

// ─── 八屬性 key(與 InvestigatorState.attributes 對齊)───
export type AttributeKey =
  | 'strength' | 'agility' | 'constitution' | 'reflex'
  | 'intellect' | 'willpower' | 'perception' | 'charisma';

// ─── d20 檢定 ────────────────────────────────

export interface CheckModifiers {
  /** 屬性修正(屬性值 1:1,§4.2) */
  attribute: number;
  /** 熟練/專精修正(天賦系統接通前為 0) */
  proficiency: number;
  /** 裝備/卡牌修正(武器 attribute_modifiers,只在對應屬性風格卡被抽到時生效,§8) */
  equipment: number;
  /** 加值 commit(手牌屬性圖示總和,§4.2) */
  commit: number;
  /** 情境修正(光照等,§12.1) */
  situational: number;
}

export interface CheckResult {
  roll: number;
  total: number;
  dc: number;
  outcome: 'success' | 'fail';
  natural20: boolean;
  natural1: boolean;
  breakdown: CheckModifiers;
}

export function rollD20(rng: () => number = Math.random): number {
  return Math.floor(rng() * 20) + 1;
}

export function resolveCheck(
  dc: number,
  mods: Partial<CheckModifiers>,
  rng: () => number = Math.random,
  rollMode: 'advantage' | 'disadvantage' | 'normal' = 'normal',
): CheckResult {
  const breakdown: CheckModifiers = {
    attribute: mods.attribute ?? 0,
    proficiency: mods.proficiency ?? 0,
    equipment: mods.equipment ?? 0,
    commit: mods.commit ?? 0,
    situational: mods.situational ?? 0,
  };
  // §6 強化取好的 / 弱化取差的:擲兩顆取高/低(預設 normal 向後相容)
  let roll = rollD20(rng);
  if (rollMode !== 'normal') {
    const roll2 = rollD20(rng);
    roll = rollMode === 'advantage' ? Math.max(roll, roll2) : Math.min(roll, roll2);
  }
  const total =
    roll +
    breakdown.attribute +
    breakdown.proficiency +
    breakdown.equipment +
    breakdown.commit +
    breakdown.situational;
  return {
    roll,
    total,
    dc,
    outcome: total >= dc ? 'success' : 'fail',
    natural20: roll === 20,
    natural1: roll === 1,
    breakdown,
  };
}

// ─── 加值(commit)───────────────────────────

/** commit_icons 形狀:{ strength: 2 } 或 { all: 1 }(萬能,MOD-01 寫卡器約定) */
export type CommitIcons = Record<string, number>;

/** 一批 commit 卡對「本次檢定屬性」貢獻的加值總和(萬能 all 一律生效) */
export function commitValueFor(attribute: AttributeKey, iconSets: CommitIcons[]): number {
  let sum = 0;
  for (const icons of iconSets) {
    if (!icons || typeof icons !== 'object') continue;
    sum += Number(icons[attribute] ?? 0) + Number(icons.all ?? 0);
  }
  return sum;
}

// ─── 光照情境修正(§12.1)─────────────────────

export type Visibility = 'day' | 'night' | 'darkness' | 'fire';

/**
 * 攻擊無視線 -2 / 黑暗中閃避 +2。
 * 簡化界線(光源物件系統接通前):night/darkness 視為無視線,day/fire 有視線。
 */
export function visibilityModifier(kind: 'attack' | 'evade', visibility: Visibility): number {
  const noSight = visibility === 'night' || visibility === 'darkness';
  if (kind === 'attack') return noSight ? -2 : 0;
  return noSight ? 2 : 0;
}

// ─── 混沌袋(§5 + supp04)─────────────────────

/** 神話類標記:場景效果無視法術防禦一律發動(supp04 §5.5) */
const MYTHOS_TOKEN_TYPES = new Set(['clue', 'headline', 'monster', 'doom', 'gate']);
/** 動態標記:抽後移出袋 + 連鎖再抽(supp04) */
const CHAIN_TOKEN_TYPES = new Set(['bless', 'curse']);

export interface ChaosDrawResult {
  /** 抽出序列(含祝福/詛咒連鎖鏈,最後一顆為結算標記) */
  drawn: ChaosToken[];
  /** 結算標記(非 bless/curse 的最終那顆) */
  finalToken: ChaosToken;
  /** 數值合計(bless +1 / curse -1 累加 + 最終標記數值;觸手/遠古印記另走 auto 路徑) */
  value: number;
  /** 'tentacle' 自動最壞 / 'elder_sign' 自動最高 / null 一般 */
  auto: 'worst' | 'best' | null;
  /** 抽後應從袋中移出的 tokenId(bless/curse) */
  removedTokenIds: string[];
}

export function drawChaosToken(
  bag: ChaosToken[],
  rng: () => number = Math.random,
): ChaosDrawResult {
  if (bag.length === 0) {
    throw new Error('混沌袋為空,無法抽取');
  }
  const remaining = [...bag];
  const drawn: ChaosToken[] = [];
  const removedTokenIds: string[] = [];
  let chainValue = 0;

  // 祝福/詛咒:抽後移出袋,連鎖再抽(理論上有限,袋中 bless/curse 抽完即止)
  for (;;) {
    const idx = Math.floor(rng() * remaining.length);
    const token = remaining[idx];
    drawn.push(token);
    if (CHAIN_TOKEN_TYPES.has(token.type) && remaining.length > 1) {
      chainValue += token.type === 'bless' ? 1 : -1;
      removedTokenIds.push(token.tokenId);
      remaining.splice(idx, 1);
      continue;
    }
    const auto =
      token.type === 'tentacle' ? ('worst' as const)
      : token.type === 'elder_sign' ? ('best' as const)
      : null;
    return {
      drawn,
      finalToken: token,
      value: chainValue + Number(token.value ?? 0),
      auto,
      removedTokenIds,
    };
  }
}

// ─── 法術副作用分級(§5.6 + supp04 §5)──────────

export interface SpellSideEffect {
  /** 場景效果是否發動 */
  sceneEffectFires: boolean;
  /** 施法者 SAN 變化(負 = 損失) */
  casterSanDelta: number;
  /** 分級說明(給敘事 log) */
  tier: 'immune' | 'cancelled_with_strain' | 'full' | 'full_with_strain' | 'tentacle' | 'elder_sign';
}

export function resolveSpellSideEffect(
  draw: ChaosDrawResult,
  spellDefense: number,
): SpellSideEffect {
  // 觸手:自動最壞 — 場景效果全額發動 + SAN-1
  if (draw.auto === 'worst') {
    return { sceneEffectFires: true, casterSanDelta: -1, tier: 'tentacle' };
  }
  // 遠古印記:自動最高 — 副作用全免 + SAN+1
  if (draw.auto === 'best') {
    return { sceneEffectFires: false, casterSanDelta: 1, tier: 'elder_sign' };
  }
  // 神話類標記:場景效果無視法術防禦一律發動,數值部分仍走防禦比較(§5.5 註)
  const isMythos = MYTHOS_TOKEN_TYPES.has(draw.finalToken.type);

  // §5.7:最終數值與法術防禦值比較。數值 ≥ 防禦 → 全免;
  // 數值 < 防禦 → 差值 = 防禦 - 數值(防禦越高施法越危險)
  const diff = spellDefense - draw.value;
  if (diff <= 0) {
    return {
      sceneEffectFires: isMythos,
      casterSanDelta: 0,
      tier: 'immune',
    };
  }
  if (diff <= 2) {
    return {
      sceneEffectFires: isMythos, // 一般標記場景效果取消;神話標記仍發動
      casterSanDelta: -1,
      tier: 'cancelled_with_strain',
    };
  }
  if (diff <= 4) {
    return { sceneEffectFires: true, casterSanDelta: 0, tier: 'full' };
  }
  return { sceneEffectFires: true, casterSanDelta: -1, tier: 'full_with_strain' };
}
