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
import type { InvestigatorState, ScenarioState } from './state';
import type { CardDataLookup } from './ruleEngine';
import { executeStockpileTalismanTurnStartEffects } from './effectsExecutor';
import { turnStartTick, turnEndTick, bonusActionPoints } from './statusEffects';

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
  /** 有帶入場景與卡片資料時，回合開始法器效果後的場景。 */
  scenario?: ScenarioState;
}

export interface TurnEndUpkeepOptions {
  /** 玩家容器需先讓本人選牌；AI 與模擬仍可沿用自動棄最舊。 */
  deferHandLimit?: boolean;
}

export interface TurnStartUpkeepOptions {
  /** 儲蓄型法器的 round_start 效果需要同一份場景與卡片資料。 */
  scenario?: ScenarioState;
  cardLookup?: CardDataLookup;
  rng?: () => number;
}

export interface HandLimitDiscardResult {
  ok: boolean;
  investigator: InvestigatorState;
  effect: ResultEffect | null;
  reason?: 'not_over_limit' | 'wrong_count' | 'card_not_in_hand' | 'duplicate_card';
}

/**
 * 對單一調查員結算回合結束階段:抽 1 卡(空牌庫 → 1 恐懼)→ +1 資源 →
 * 手牌超過上限棄至上限(v0 簡化:由最舊的手牌開始棄;玩家自選棄牌待 UI)。
 * 橫置卡轉正在消耗品系統(G-06)接上後加入。
 */
export function runTurnEndUpkeep(inv: InvestigatorState, options: TurnEndUpkeepOptions = {}): UpkeepResult {
  let next = inv;
  const effects: ResultEffect[] = [];

  // §10.5 盟友橫置轉正(獨立單位,不受調查員瀕死影響 → 在守門之前結算)
  const allies0 = next.allies;
  if (allies0?.some((a) => a.exhausted)) {
    next = { ...next, allies: allies0.map((a) => (a.exhausted ? { ...a, exhausted: false } : a)) };
    effects.push({ type: 'ally_readied', params: { count: allies0.length } });
  }

  // 倒地/死亡者不結算補給(§9 瀕死狀態不能執行任何行動)
  if (next.permanentlyDead || next.hp <= 0 || next.san <= 0) {
    return { investigator: next, effects };
  }

  // ⓪ 狀態效果結算(ch3 §6):流血/毀滅扣血、疲勞封鎖經濟、所有非特殊狀態減 1 層
  const st = turnEndTick(next);
  next = st.investigator;
  effects.push(...st.effects);
  // 狀態傷害可能把人打到瀕死 → 不再結算經濟補給
  if (next.hp <= 0 || next.san <= 0) {
    return { investigator: next, effects };
  }

  // ①② 抽 1 卡 + 獲得 1 資源(§6.2 疲勞 → 跳過抽牌與收入)
  if (!st.blockEconomy) {
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
  }

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
    const count = next.hand.length - HAND_LIMIT;
    if (options.deferHandLimit) {
      effects.push({ type: 'hand_limit_required', params: { count } });
    } else {
      const discarded = next.hand.slice(0, count);
      next = {
        ...next,
        hand: next.hand.slice(count),
        discardPile: [...next.discardPile, ...discarded],
      };
      effects.push({ type: 'hand_limit_discard', params: { count: discarded.length, cardInstanceIds: discarded } });
    }
  }

  return { investigator: next, effects };
}

/** 玩家確認後才執行的手牌上限棄牌；精確張數、不可重複、必須仍在手牌。 */
export function discardForHandLimit(
  inv: InvestigatorState,
  selectedCardIds: readonly string[],
): HandLimitDiscardResult {
  const required = Math.max(0, inv.hand.length - HAND_LIMIT);
  if (required === 0) return { ok: false, investigator: inv, effect: null, reason: 'not_over_limit' };
  if (selectedCardIds.length !== required) {
    return { ok: false, investigator: inv, effect: null, reason: 'wrong_count' };
  }
  if (new Set(selectedCardIds).size !== selectedCardIds.length) {
    return { ok: false, investigator: inv, effect: null, reason: 'duplicate_card' };
  }
  if (selectedCardIds.some((id) => !inv.hand.includes(id))) {
    return { ok: false, investigator: inv, effect: null, reason: 'card_not_in_hand' };
  }
  const selected = new Set(selectedCardIds);
  const investigator = {
    ...inv,
    hand: inv.hand.filter((id) => !selected.has(id)),
    discardPile: [...inv.discardPile, ...selectedCardIds],
  };
  return {
    ok: true,
    investigator,
    effect: {
      type: 'hand_limit_discard',
      params: { count: selectedCardIds.length, cardInstanceIds: [...selectedCardIds] },
      targetId: inv.investigatorId,
    },
  };
}

// ─── 回合開始階段(ch3 §6:燃燒/再生在回合開始結算)──────────
/**
 * 對單一調查員結算回合開始的狀態效果:燃燒扣 HP、再生回 HP(§6.2/§6.3)。
 * 在新回合調查員階段開頭呼叫(瀕死檢定之前 — 燃燒可能把人打到瀕死)。
 */
export function runTurnStartUpkeep(inv: InvestigatorState, options: TurnStartUpkeepOptions = {}): UpkeepResult {
  if (inv.permanentlyDead) return { investigator: inv, effects: [] };
  const st = turnStartTick(inv);
  let next = st.investigator;
  let scenario = options.scenario;
  const effects: ResultEffect[] = [...st.effects];
  // §6.3 加速:回合開始額外行動點(在 client 設好本回合 3 點之後呼叫,疊加)
  const haste = bonusActionPoints(next.statusEffects);
  if (haste > 0) {
    next = { ...next, actionPoints: next.actionPoints + haste };
    effects.push({ type: 'status_haste', params: { amount: haste, narrative: '腎上腺素湧現,你動作快了起來(行動點 +' + haste + ')。' }, targetId: next.investigatorId });
  }
  if (scenario && options.cardLookup) {
    const stockpile = executeStockpileTalismanTurnStartEffects(next, scenario, options.cardLookup, options.rng);
    next = stockpile.investigator;
    scenario = stockpile.scenario;
    effects.push(...stockpile.effects);
    if (stockpile.unsupported.length > 0) {
      effects.push({ type: 'effect_unsupported', params: { codes: stockpile.unsupported } });
    }
  }
  return { investigator: next, effects, ...(scenario ? { scenario } : {}) };
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
