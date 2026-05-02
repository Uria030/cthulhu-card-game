/**
 * localStorage 草稿管理 — 校準中途的暫存。
 *
 * key 規則:`ug-calibration:draft:{surface}` — 每個 surface 各自獨立。
 */
import type { HotspotData } from '../types';

const KEY_PREFIX = 'ug-calibration:draft:';

export interface DraftPayload {
  hotspots: HotspotData[];
  savedAt: string; // ISO
}

const safeStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

export function saveDraft(surface: string, hotspots: HotspotData[]): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    const payload: DraftPayload = { hotspots, savedAt: new Date().toISOString() };
    ls.setItem(KEY_PREFIX + surface, JSON.stringify(payload));
  } catch {
    // quota / private mode → 忽略
  }
}

export function loadDraft(surface: string): DraftPayload | null {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(KEY_PREFIX + surface);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftPayload;
    if (!Array.isArray(parsed.hotspots)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(surface: string): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.removeItem(KEY_PREFIX + surface);
  } catch {
    // ignore
  }
}
