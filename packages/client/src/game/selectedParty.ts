/**
 * 入隊 AI 名單 — 大廳組隊,跨畫面沿用(localStorage 持久)
 * 存 AI 名冊 rosterCode 陣列(順序 = 入隊順序)。null/未設 → 由開局預設帶名冊前幾位。
 */
const KEY = 'ug_selected_party';

export function getPartyCodes(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
  } catch {
    return null;
  }
}

export function setPartyCodes(codes: string[]): void {
  localStorage.setItem(KEY, JSON.stringify(codes));
}
