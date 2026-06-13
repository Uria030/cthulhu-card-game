/**
 * G-05 引擎核心 — 回合經濟與生命公式
 *
 * 權威依據:
 * - 02_rulebook_ch2.md §2.4 回合結束階段:每位調查員抽 1 張卡、獲得 1 資源、
 *   橫置卡片轉正、手牌超過上限(8)棄至上限
 * - 02_rulebook_ch2.md §3.3:牌庫空時抽牌 → 受 1 點恐懼,不自動重洗
 * - 06_rulebook_ch6.md §8.1-8.2:起始手牌 5 / 手牌上限 8 / 起始資源 5 / 每回合 +1
 * - 06_rulebook_ch6.md §3.1:HP 上限 = 體質 × 2 + 5;SAN 上限 = 意志 × 2 + 5(範圍 7-25)
 */
import type { ResultEffect } from './messages';
import type { InvestigatorState } from './state';

export const HAND_LIMIT = 8;
export const STARTING_RESOURCES = 5;
export const STARTING_HAND_SIZE = 5;

// ─── 生命公式(ch6 §3.1)─────────────────────
export function hpMaxFor(constitution: number): number {
  return constitution * 2 + 5;
}

export function sanMaxFor(willpower: number): number {
  return willpower * 2 + 5;
}

// ─── 回合結束階段(ch2 §2.4)──────────────────
export interface UpkeepResult {
  investigator: InvestigatorState;
  effects: ResultEffect[];
}

/**
 * 對單一調查員結算回合結束階段:抽 1 卡(空牌庫 → 1 恐懼)→ +1 資源 →
 * 手牌超過上限棄至上限(v0 簡化:由最舊的手牌開始棄;玩家自選棄牌待 UI)。
 * 橫置卡轉正在消耗品系統(G-06)接上後加入。
 */
export function runTurnEndUpkeep(inv: InvestigatorState): UpkeepResult {
  let next = inv;
  const effects: ResultEffect[] = [];

  // 倒地/死亡者不結算補給(§9 瀕死狀態不能執行任何行動)
  if (next.permanentlyDead || next.hp <= 0 || next.san <= 0) {
    return { investigator: next, effects };
  }

  // ① 抽 1 張卡(§3.3 空牌庫 → 1 恐懼,不重洗)
  if (next.deck.length === 0) {
    next = { ...next, san: Math.max(0, next.san - 1) };
    effects.push({ type: 'deck_empty_horror', params: { amount: 1 } });
  } else {
    const drawn = next.deck[0];
    next = { ...next, deck: next.deck.slice(1), hand: [...next.hand, drawn] };
    effects.push({ type: 'upkeep_draw', params: { cardInstanceId: drawn }, targetId: next.investigatorId });
  }

  // ② 獲得 1 資源(ch6 §8.2 每回合自動收入)
  next = { ...next, resources: next.resources + 1 };
  effects.push({ type: 'upkeep_income', params: { amount: 1 } });

  // ②b 橫置卡片轉正(ch2 §2.4)
  const exhaustedIds = Object.entries(next.assetState ?? {}).filter(([, s]) => s.exhausted).map(([id]) => id);
  if (exhaustedIds.length > 0) {
    const readied = { ...(next.assetState ?? {}) };
    for (const id of exhaustedIds) readied[id] = { ...readied[id], exhausted: false };
    next = { ...next, assetState: readied };
    effects.push({ type: 'assets_readied', params: { count: exhaustedIds.length } });
  }

  // ③ 手牌上限 8,棄至上限(v0:棄最舊)
  if (next.hand.length > HAND_LIMIT) {
    const discarded = next.hand.slice(0, next.hand.length - HAND_LIMIT);
    next = {
      ...next,
      hand: next.hand.slice(next.hand.length - HAND_LIMIT),
      discardPile: [...next.discardPile, ...discarded],
    };
    effects.push({ type: 'hand_limit_discard', params: { count: discarded.length, cardInstanceIds: discarded } });
  }

  return { investigator: next, effects };
}

// ─── 短休息(ch2 §3.1:個人決定,放棄本回合行動換重洗牌庫)─────
/**
 * 某位調查員選擇短休息:棄牌堆洗回牌庫、放棄本回合 3 行動點。
 * (消耗品回收 / 陣營專屬短休息效果為後續批次;v0 先做重洗 + 放棄行動)
 * 注意:短休息是「那一位」放棄行動,不跳過調查員階段——其他調查員照常行動。
 */
export function runShortRest(inv: InvestigatorState, rng: () => number = Math.random): UpkeepResult {
  if (inv.permanentlyDead || inv.hp <= 0 || inv.san <= 0) {
    return { investigator: inv, effects: [] };
  }
  // 棄牌堆洗回牌庫(Fisher–Yates)
  const merged = [...inv.deck, ...inv.discardPile];
  for (let i = merged.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [merged[i], merged[j]] = [merged[j], merged[i]];
  }
  const next: InvestigatorState = {
    ...inv,
    deck: merged,
    discardPile: [],
    actionPoints: 0, // 犧牲整回合行動
  };
  return {
    investigator: next,
    effects: [{
      type: 'short_rest',
      params: { reshuffled: inv.discardPile.length, narrative: '你退到陰影裡喘口氣,把散落的牌重新收攏。' },
      targetId: inv.investigatorId,
    }],
  };
}
