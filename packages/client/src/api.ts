/**
 * 玩家側 API helper — 打後端 /api/play 唯讀端點
 *
 * API base 與 admin-shared.js 同策略:固定指向 Railway,
 * 本機開發可用 VITE_API_BASE 覆寫(.env.local)。
 */
import type {
  CampaignProgress,
  StageBootstrap,
  CardData,
  StyleCardData,
  MultiplayerPrivateState,
  MultiplayerRoomSnapshot,
} from '@cthulhu/shared';

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

export interface PlayerAccount {
  id: string;
  email: string;
  username: string;
  save_slots_max: number;
  dead_count: number;
  retired_count: number;
  is_disabled: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface PlayerSave {
  id: string;
  player_id: string;
  slot: number;
  template_id: string;
  campaign_id: string | null;
  status: 'active' | 'dead' | 'retired';
  campaign_progress: CampaignProgress | Record<string, never>;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  investigator_code: string;
  mbti_code: string;
  faction_code: string;
  name_zh: string;
  name_en: string;
  title_zh: string | null;
  is_completed: boolean;
  campaign_code: string | null;
  campaign_name: string | null;
}

export interface CardLabManifest {
  id: 'card-lab';
  version: number;
  title: string;
  baseStageId: string;
  locations: Array<{
    code: string;
    name_zh: string;
    description_zh: string;
    shroud: number;
  }>;
  enemy: {
    code: string;
    name_zh: string;
    hp: number;
    dc: number;
    damage_physical: number;
    damage_horror: number;
    fear_value: number;
    movement_speed: number;
  };
}

export type CardLabReviewStatus = 'pass' | 'warn' | 'block';

export interface CardLabReview {
  card_id: string;
  status: CardLabReviewStatus;
  notes: string;
  reviewed_by?: string;
  reviewed_at: string;
  reviewed_by_username: string;
}

export interface CardLabCard extends Record<string, unknown> {
  id: string;
  code: string;
  name_zh: string;
  name_en?: string | null;
  card_type: string;
  faction: string;
  cost: number;
  rarity?: string | null;
  description_zh?: string | null;
  effects: NonNullable<CardData['effects']>;
  review_status: CardLabReviewStatus | null;
  review_notes: string | null;
  reviewed_at: string | null;
  reviewed_by_username: string | null;
}

export interface CardLabCatalogue {
  cards: CardLabCard[];
  style_pools: Record<string, StyleCardData[]>;
}

export interface PlayerMe {
  player: PlayerAccount;
  saves: PlayerSave[];
}

const PLAYER_TOKEN_KEY = 'ug_player_token';

export function getPlayerToken(): string | null {
  try {
    return localStorage.getItem(PLAYER_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setPlayerToken(token: string): void {
  localStorage.setItem(PLAYER_TOKEN_KEY, token);
}

export function clearPlayerToken(): void {
  localStorage.removeItem(PLAYER_TOKEN_KEY);
}

async function requestJson<T>(path: string, options: RequestInit = {}, playerAuth = false): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (playerAuth) {
    const token = getPlayerToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(`${options.method ?? 'GET'} ${path} 失敗(${res.status}):${body?.error ?? '未知錯誤'}`);
  }
  return body.data as T;
}

async function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path);
}

let playStagesCache: Promise<PlayStageListItem[]> | null = null;
const playInvestigatorsCache = new Map<string, Promise<PlayInvestigator[]>>();

export function fetchPlayStages(options: { refresh?: boolean } = {}): Promise<PlayStageListItem[]> {
  if (options.refresh) playStagesCache = null;
  if (!playStagesCache) {
    playStagesCache = getJson<PlayStageListItem[]>('/api/play/stages');
    playStagesCache.catch(() => { playStagesCache = null; });
  }
  return playStagesCache;
}

export function fetchPlayInvestigators(options: { includeDraft?: boolean; refresh?: boolean } = {}): Promise<PlayInvestigator[]> {
  const qs = options.includeDraft ? '?includeDraft=true' : '';
  const key = options.includeDraft ? 'draft' : 'completed';
  if (options.refresh) playInvestigatorsCache.delete(key);
  let cached = playInvestigatorsCache.get(key);
  if (!cached) {
    cached = getJson<PlayInvestigator[]>(`/api/play/investigators${qs}`);
    cached.catch(() => playInvestigatorsCache.delete(key));
    playInvestigatorsCache.set(key, cached);
  }
  return cached;
}

export async function loginPlayer(login: string, password: string): Promise<PlayerMe> {
  const data = await requestJson<PlayerMe & { token: string }>('/api/player/login', {
    method: 'POST',
    body: JSON.stringify({ login, password }),
  });
  setPlayerToken(data.token);
  return { player: data.player, saves: data.saves };
}

export async function logoutPlayer(): Promise<void> {
  try {
    await requestJson('/api/player/logout', { method: 'POST' }, true);
  } finally {
    clearPlayerToken();
  }
}

export function fetchPlayerMe(): Promise<PlayerMe> {
  return requestJson<PlayerMe>('/api/player/me', {}, true);
}

export function fetchCardLabManifest(): Promise<CardLabManifest> {
  return requestJson<CardLabManifest>('/api/player/card-lab', {}, true);
}

export function fetchCardLabCatalogue(): Promise<CardLabCatalogue> {
  return requestJson<CardLabCatalogue>('/api/player/card-lab/cards', {}, true);
}

export function saveCardLabReview(
  cardId: string,
  input: { status: CardLabReviewStatus; notes: string },
): Promise<CardLabReview> {
  return requestJson<CardLabReview>(`/api/player/card-lab/cards/${encodeURIComponent(cardId)}/review`, {
    method: 'PUT',
    body: JSON.stringify(input),
  }, true);
}

export function clearCardLabReview(cardId: string): Promise<{ card_id: string }> {
  return requestJson<{ card_id: string }>(`/api/player/card-lab/cards/${encodeURIComponent(cardId)}/review`, {
    method: 'DELETE',
  }, true);
}

export function createPlayerSave(input: {
  slot: number;
  template_id: string;
  campaign_id?: string | null;
  campaign_progress?: CampaignProgress | Record<string, never>;
}): Promise<PlayerSave> {
  return requestJson<PlayerSave>('/api/player/saves', {
    method: 'POST',
    body: JSON.stringify(input),
  }, true);
}

export function updatePlayerSaveProgress(
  saveId: string,
  campaignProgress: CampaignProgress,
  campaignId?: string | null,
): Promise<PlayerSave> {
  return requestJson<PlayerSave>(`/api/player/saves/${saveId}/progress`, {
    method: 'PUT',
    body: JSON.stringify({ campaign_id: campaignId ?? campaignProgress.campaignId, campaign_progress: campaignProgress }),
  }, true);
}

export function retirePlayerSave(saveId: string): Promise<PlayerMe> {
  return requestJson<PlayerMe>(`/api/player/saves/${saveId}/retire`, { method: 'POST' }, true);
}

export function markPlayerSaveDead(saveId: string, campaignProgress: CampaignProgress): Promise<PlayerMe> {
  return requestJson<PlayerMe>(`/api/player/saves/${saveId}/mark-dead`, {
    method: 'POST',
    body: JSON.stringify({ campaign_progress: campaignProgress }),
  }, true);
}

export function settlePlayerSaveScenario(input: {
  saveId: string;
  stageId: string;
  flags: Record<string, unknown>;
  investigator: unknown;
}): Promise<PlayerSave> {
  return requestJson<PlayerSave>(`/api/player/saves/${input.saveId}/settle-scenario`, {
    method: 'POST',
    body: JSON.stringify({
      stage_id: input.stageId,
      flags: input.flags,
      investigator: input.investigator,
    }),
  }, true);
}

export function createMultiplayerRoom(): Promise<MultiplayerRoomSnapshot> {
  return requestJson<MultiplayerRoomSnapshot>('/api/multiplayer/rooms', { method: 'POST' }, true);
}

export function fetchMultiplayerRoom(roomCode: string): Promise<MultiplayerRoomSnapshot> {
  return requestJson<MultiplayerRoomSnapshot>(`/api/multiplayer/rooms/${encodeURIComponent(roomCode)}`, {}, true);
}

export function fetchMultiplayerPrivateState(roomCode: string): Promise<MultiplayerPrivateState> {
  return requestJson<MultiplayerPrivateState>(`/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/private-state`, {}, true);
}

export function joinMultiplayerRoom(roomCode: string): Promise<MultiplayerRoomSnapshot> {
  return requestJson<MultiplayerRoomSnapshot>(`/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/join`, { method: 'POST' }, true);
}

export function selectMultiplayerInvestigator(roomCode: string, investigatorTemplateId: string, saveId: string): Promise<MultiplayerRoomSnapshot> {
  return requestJson<MultiplayerRoomSnapshot>(`/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/select-investigator`, {
    method: 'POST',
    body: JSON.stringify({ investigator_template_id: investigatorTemplateId, save_id: saveId }),
  }, true);
}

export function setMultiplayerReady(roomCode: string, ready: boolean): Promise<MultiplayerRoomSnapshot> {
  return requestJson<MultiplayerRoomSnapshot>(`/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/ready`, {
    method: 'POST',
    body: JSON.stringify({ ready }),
  }, true);
}

export function startMultiplayerRoom(roomCode: string, stageId: string): Promise<MultiplayerRoomSnapshot> {
  return requestJson<MultiplayerRoomSnapshot>(`/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/start`, {
    method: 'POST',
    body: JSON.stringify({ stage_id: stageId }),
  }, true);
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
