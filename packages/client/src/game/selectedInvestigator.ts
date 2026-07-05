/**
 * 已選調查員 — 大廳選人,跨畫面沿用(localStorage 持久,重整不丟)
 */
const KEY = 'ug_selected_investigator';

export interface SelectedInvestigator {
  id: string;
  name_zh: string;
  mbti_code?: string;
  faction_code?: string;
  is_completed?: boolean;
}

export function getSelectedInvestigator(): SelectedInvestigator | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v.id === 'string' ? (v as SelectedInvestigator) : null;
  } catch {
    return null;
  }
}

export function setSelectedInvestigator(inv: SelectedInvestigator): void {
  localStorage.setItem(KEY, JSON.stringify(inv));
}
