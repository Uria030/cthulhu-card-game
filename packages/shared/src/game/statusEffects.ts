/**
 * G-10 引擎核心 — 狀態效果系統(規則書 ch3 §6)
 *
 * 權威依據(03_rulebook_ch3.md §6):
 * - §6.1 核心:所有狀態可堆疊;經歷完整回合後減 1 層(除非有特殊減層規則);
 *   數值型(層數=效果強度)/ 開關型(層數=持續時間)。
 * - §6.2 負面 15、§6.3 正面 6、§6.5 元素互動。
 *
 * 狀態以 `Record<code, layers>` 表示(層數 0/不存在 = 無此狀態)。
 * 本模組為純函式;tick 類操作 InvestigatorState(同 dying.ts),query 類操作狀態 map。
 * **本批次(9a)只接回合首尾 tick;傷害/檢定/移動/限制等消費端 wiring 在 9b 接(query helper 已就緒+測試)。**
 */
import type { InvestigatorState } from './state';
import type { ResultEffect } from './messages';

export type StatusMap = Record<string, number>;

/** 特殊減層的狀態:不走「回合 -1 層」標準規則(各有自己的移除觸發) */
//  - empowered/weakened:擲骰後減 1 層(decrementOnRoll)
//  - stealth:移動或攻擊後全部移除(clearStealth)
const SPECIAL_DECREMENT = new Set(['empowered', 'weakened', 'stealth']);

/** §6.2/§6.3 互抵對:標記 ↔ 隱蔽(施加一方時與另一方層數相抵) */
const MUTUAL_OFFSET: Record<string, string> = { marked: 'stealth', stealth: 'marked' };

/**
 * 狀態代碼別名 → 規則書 canonical(§6)。
 * 資料/卡面/鍛造詞綴用簡寫(burn/freeze/weaken/fragile),引擎統一收斂到規則書代碼,
 * 否則 tick/query 對不上(真實多層卡面 burn 永遠不會結算 — Raviel BLOCK)。
 */
const STATUS_ALIASES: Record<string, string> = {
  burn: 'burning',
  freeze: 'frozen',
  weaken: 'weakened',
  fragile: 'vulnerable',
  mark: 'marked',
  doom: 'doom_status',
};
/** 把任意輸入代碼收斂到規則書 canonical 代碼 */
export function normalizeStatusCode(code: string): string {
  return STATUS_ALIASES[code] ?? code;
}

/** 15 個負面狀態代碼(remove_status 淨化所有負面用) */
export const NEGATIVE_STATUSES = [
  'poison', 'bleed', 'burning', 'frozen', 'wet', 'madness', 'marked',
  'vulnerable', 'weakness_status', 'weakened', 'doom_status',
  'darkness', 'disarm', 'fatigue', 'silence',
] as const;

// ─── 基本操作 ──────────────────────────────────
export function getLayers(map: StatusMap | undefined, code: string): number {
  return Math.max(0, Number(map?.[code] ?? 0));
}

/**
 * 施加狀態(可堆疊累加)。§6.5:施加燃燒會移除潮濕(燃燒 + 潮濕 → 燃燒移除潮濕)。
 */
export function addStatus(map: StatusMap | undefined, rawCode: string, layers = 1): StatusMap {
  const code = normalizeStatusCode(rawCode);
  const next: StatusMap = { ...(map ?? {}) };
  const add = Math.max(1, layers);
  // §6.5 施加燃燒移除潮濕(單向)
  if (code === 'burning' && getLayers(next, 'wet') > 0) {
    delete next.wet;
  }
  // §6.2/§6.3 標記 ↔ 隱蔽 互抵(雙向層數相抵)
  const opp = MUTUAL_OFFSET[code];
  if (opp && getLayers(next, opp) > 0) {
    const oppLayers = getLayers(next, opp);
    if (add > oppLayers) {
      delete next[opp];
      next[code] = getLayers(next, code) + (add - oppLayers);
    } else if (add === oppLayers) {
      delete next[opp];
    } else {
      next[opp] = oppLayers - add;
    }
    return next;
  }
  next[code] = getLayers(next, code) + add;
  return next;
}

/** 移除狀態(預設全移除;給 layers 則減指定層,歸零即刪) */
export function removeStatus(map: StatusMap | undefined, rawCode: string, layers?: number): StatusMap {
  const code = normalizeStatusCode(rawCode);
  const next: StatusMap = { ...(map ?? {}) };
  if (layers === undefined) {
    delete next[code];
  } else {
    const remaining = getLayers(next, code) - Math.max(0, layers);
    if (remaining > 0) next[code] = remaining;
    else delete next[code];
  }
  return next;
}

/** 隱蔽:移動或攻擊後全部移除(§6.3 特殊型) */
export function clearStealth(map: StatusMap | undefined): StatusMap {
  return removeStatus(map, 'stealth');
}

/** 強化/弱化:擲骰後各減 1 層(§6.2/§6.3 特殊減層) */
export function decrementOnRoll(map: StatusMap | undefined): StatusMap {
  let next = { ...(map ?? {}) };
  if (getLayers(next, 'empowered') > 0) next = removeStatus(next, 'empowered', 1);
  if (getLayers(next, 'weakened') > 0) next = removeStatus(next, 'weakened', 1);
  return next;
}

// ─── 回合首尾結算(tick)──────────────────────────
export interface StatusTickResult {
  investigator: InvestigatorState;
  effects: ResultEffect[];
}

/** 回合開始:燃燒扣 HP、再生回 HP(§6.2/§6.3) */
export function turnStartTick(inv: InvestigatorState): StatusTickResult {
  const map = inv.statusEffects ?? {};
  const effects: StatusTickResult['effects'] = [];
  let hp = inv.hp;
  const burning = getLayers(map, 'burning');
  if (burning > 0) {
    hp = Math.max(0, hp - burning);
    effects.push({ type: 'status_burning', params: { amount: burning, narrative: '火焰仍在啃噬你的血肉(HP -' + burning + ')。' }, targetId: inv.investigatorId });
  }
  const regen = getLayers(map, 'regeneration');
  if (regen > 0) {
    const healed = Math.min(inv.hpMax, hp + regen);
    if (healed > hp) effects.push({ type: 'status_regen', params: { amount: healed - hp, narrative: '傷口以不自然的速度癒合(HP +' + (healed - hp) + ')。' }, targetId: inv.investigatorId });
    hp = healed;
  }
  return { investigator: { ...inv, hp }, effects };
}

export interface TurnEndStatusResult extends StatusTickResult {
  /** 疲勞:回合結束不能抽牌與獲得資源(§6.2) */
  blockEconomy: boolean;
}

/**
 * 回合結束:流血/毀滅狀態扣 HP、疲勞封鎖經濟,最後所有非特殊狀態減 1 層(§6.1)。
 * 減層在傷害結算之後(流血 2 先扣 2,再降為 1)。
 */
export function turnEndTick(inv: InvestigatorState): TurnEndStatusResult {
  const map = inv.statusEffects ?? {};
  const effects: StatusTickResult['effects'] = [];
  let hp = inv.hp;

  const bleed = getLayers(map, 'bleed');
  if (bleed > 0) {
    hp = Math.max(0, hp - bleed);
    effects.push({ type: 'status_bleed', params: { amount: bleed, narrative: '傷口不停滲血(HP -' + bleed + ')。' }, targetId: inv.investigatorId });
  }
  const doom = getLayers(map, 'doom_status');
  if (doom > 0) {
    hp = Math.max(0, hp - doom);
    effects.push({ type: 'status_doom', params: { amount: doom, narrative: '末日的重量壓垮著你(HP -' + doom + ')。' }, targetId: inv.investigatorId });
  }
  const blockEconomy = getLayers(map, 'fatigue') > 0;
  if (blockEconomy) {
    effects.push({ type: 'status_fatigue', params: { narrative: '精疲力竭 — 這回合無法抽牌或獲得資源。' }, targetId: inv.investigatorId });
  }

  // §6.1 經歷完整回合 → 所有非特殊狀態減 1 層
  let nextMap: StatusMap = { ...map };
  for (const code of Object.keys(nextMap)) {
    if (SPECIAL_DECREMENT.has(code)) continue;
    const remaining = getLayers(nextMap, code) - 1;
    if (remaining > 0) nextMap[code] = remaining;
    else delete nextMap[code];
  }

  return { investigator: { ...inv, hp, statusEffects: nextMap }, effects, blockEconomy };
}

// ─── 元素互動(§6.5)──────────────────────────────
const FIRE = new Set(['fire', '火']);
const LIGHTNING = new Set(['lightning', 'electric', '雷', '電']);
const ICE = new Set(['ice', 'cold', 'frost', '冰']);

/**
 * 元素對「帶對應狀態的目標」的增傷(§6.5):
 * 火 vs 燃燒、雷 vs 潮濕、冰 vs 冷凍,各 +該狀態層數。
 */
export function elementalDamageBonus(map: StatusMap | undefined, element: string | undefined | null): number {
  if (!element) return 0;
  const e = String(element).toLowerCase();
  if (FIRE.has(e) || FIRE.has(element)) return getLayers(map, 'burning');
  if (LIGHTNING.has(e) || LIGHTNING.has(element)) return getLayers(map, 'wet');
  if (ICE.has(e) || ICE.has(element)) return getLayers(map, 'frozen');
  return 0;
}

// ─── 消費端 query helper(9b wiring 用;此批已測試)──────
/** 受到的物理傷害加成:中毒(攻擊傷害)+ 脆弱(物理)+ 標記(傷害和恐懼)(§6.2) */
export function incomingPhysicalBonus(map: StatusMap | undefined): number {
  return getLayers(map, 'poison') + getLayers(map, 'vulnerable') + getLayers(map, 'marked');
}
/** 受到的恐懼傷害加成:發瘋 + 標記(§6.2) */
export function incomingHorrorBonus(map: StatusMap | undefined): number {
  return getLayers(map, 'madness') + getLayers(map, 'marked');
}
/** 物理傷害減免:護甲(§6.3) */
export function physicalReduction(map: StatusMap | undefined): number {
  return getLayers(map, 'armor');
}
/** 恐懼傷害減免:護盾(§6.3) */
export function horrorReduction(map: StatusMap | undefined): number {
  return getLayers(map, 'ward');
}
/**
 * 受到傷害時套用狀態修正:物理 = +中毒+脆弱+標記 −護甲;恐懼 = +發瘋+標記 −護盾。
 * 各自不低於 0。傷害套用點(怪物攻擊/藉機攻擊/恐懼/閃避失敗)統一走這裡(§6.2/§6.3)。
 */
export function modifyIncomingDamage(
  map: StatusMap | undefined,
  physical: number,
  horror: number,
): { physical: number; horror: number } {
  return {
    physical: Math.max(0, physical + incomingPhysicalBonus(map) - physicalReduction(map)),
    horror: Math.max(0, horror + incomingHorrorBonus(map) - horrorReduction(map)),
  };
}
/** 造成的近戰傷害減免:無力(§6.2) */
export function outgoingMeleeReduction(map: StatusMap | undefined): number {
  return getLayers(map, 'weakness_status');
}
/** 攻擊命中檢定修正:黑暗 -2(§6.2 開關型) */
export function attackHitModifier(map: StatusMap | undefined): number {
  return getLayers(map, 'darkness') > 0 ? -2 : 0;
}
/** 移動花費加成:冷凍 +1(§6.2) */
export function moveCostBonus(map: StatusMap | undefined): number {
  return getLayers(map, 'frozen') > 0 ? 1 : 0;
}
/** 攻擊命中傷害加成:隱蔽 +X(§6.3) */
export function stealthDamageBonus(map: StatusMap | undefined): number {
  return getLayers(map, 'stealth');
}
/** 額外行動點:加速 +X(§6.3) */
export function bonusActionPoints(map: StatusMap | undefined): number {
  return getLayers(map, 'haste');
}
/** 能否用資產攻擊:繳械封鎖(§6.2) */
export function canUseAssetAttack(map: StatusMap | undefined): boolean {
  return getLayers(map, 'disarm') === 0;
}
/** 能否施法:沈默封鎖(§6.2) */
export function canCastSpell(map: StatusMap | undefined): boolean {
  return getLayers(map, 'silence') === 0;
}
/**
 * 擲骰模式:強化取好的 / 弱化取差的(§6.2/§6.3);兩者並存互相抵消為一般。
 */
export function checkRollMode(map: StatusMap | undefined): 'advantage' | 'disadvantage' | 'normal' {
  const emp = getLayers(map, 'empowered') > 0;
  const weak = getLayers(map, 'weakened') > 0;
  if (emp && weak) return 'normal';
  if (emp) return 'advantage';
  if (weak) return 'disadvantage';
  return 'normal';
}
