/**
 * 玩家側 API helper — 打後端 /api/play 唯讀端點
 *
 * API base 與 admin-shared.js 同策略:固定指向 Railway,
 * 本機開發可用 VITE_API_BASE 覆寫(.env.local)。
 */
import type { StageBootstrap } from '@cthulhu/shared';

export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? 'https://server-production-fc4f.up.railway.app';

export interface PlayStageListItem {
  id: string;
  code: string;
  name_zh: string;
  stage_type: string;
  narrative: string | null;
  design_status: string;
  is_hidden: boolean;
  chapter_number: number;
  chapter_code: string;
  chapter_name: string;
  campaign_id: string;
  campaign_code: string;
  campaign_name: string;
  theme: string;
  cover_narrative: string;
  difficulty_tier: string;
  scenario_count: number;
}

export interface PlayInvestigator {
  id: string;
  code: string;
  mbti_code: string;
  faction_code: string;
  name_zh: string;
  name_en: string;
  title_zh: string | null;
  backstory: string | null;
  ability_text_zh: string | null;
  portrait_url: string | null;
  is_completed: boolean;
  is_preset?: boolean;
  proficiency_ids?: string[] | null;
  attr_strength: number;
  attr_agility: number;
  attr_constitution: number;
  attr_reflex: number;
  attr_intellect: number;
  attr_willpower: number;
  attr_perception: number;
  attr_charisma: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(`GET ${path} 失敗(${res.status}):${body?.error ?? '未知錯誤'}`);
  }
  return body.data as T;
}

export function fetchPlayStages(): Promise<PlayStageListItem[]> {
  return getJson<PlayStageListItem[]>('/api/play/stages');
}

export function fetchPlayInvestigators(options: { includeDraft?: boolean } = {}): Promise<PlayInvestigator[]> {
  const qs = options.includeDraft ? '?includeDraft=true' : '';
  return getJson<PlayInvestigator[]>(`/api/play/investigators${qs}`);
}

// 開局包 promise cache:劇情提要頁先暖,進戰鬥板直接重用,不重打
// key 含調查員 id(換人選 → 重新取開局包)
const bootstrapCache = new Map<string, Promise<StageBootstrap>>();

export function fetchBootstrap(
  stageId: string,
  investigatorId?: string,
  options: { crossTest?: boolean } = {},
): Promise<StageBootstrap> {
  const key = `${stageId}|${investigatorId ?? ''}|${options.crossTest ? 'crossTest' : ''}`;
  let p = bootstrapCache.get(key);
  if (!p) {
    const params = new URLSearchParams();
    if (investigatorId) params.set('investigator', investigatorId);
    if (options.crossTest) params.set('crossTest', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    p = getJson<StageBootstrap>(`/api/play/stages/${stageId}/bootstrap${qs}`);
    // 失敗不留毒快取,下次重試
    p.catch(() => bootstrapCache.delete(key));
    bootstrapCache.set(key, p);
  }
  return p;
}
