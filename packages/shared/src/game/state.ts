/**
 * G-01 引擎核心 — 遊戲狀態 type 定義
 *
 * 依《遊戲本體企劃書》第三章 §11(遊戲狀態四層)+ 第四章 §2(三層存檔分離).
 *
 * 四層結構:
 * - 戰役層(CampaignState):戰役全程持久,跨場景
 * - 場景層(ScenarioState):場景進行中暫存,場景結束清空
 * - 調查員層(InvestigatorState):調查員存活全程,死亡時刪除(規則書紅線 #4)
 * - 回合層(TurnState):純記憶體,回合結束即丟,不入存檔
 *
 * 本檔只定義 type 骨架,不含業務邏輯。
 */

// ─── 戰役層 ──────────────────────────────────
export interface CampaignState {
  campaignId: string;
  campaignDefinitionId: string; // 對應後台 MOD-06 戰役定義
  /** 戰役旗標(主線進度的關鍵旗標,對應第四章 §2.2) */
  flags: Record<string, unknown>;
  /** 凝聚力(每章結束 +1,規則書 §1.6) */
  cohesion: number;
  /** 已解鎖的團隊精神(對應 MOD-04) */
  unlockedTeamSpirits: string[];
  /** 已解鎖的支線(規則書 §7.2) */
  unlockedSidequests: string[];
  /** 當前章節 ID */
  currentChapterId: string | null;
  /** 上次離開時的章節狀態(讓接續更精確) */
  lastSessionEndedAt: string | null;
  /** 殞落者事件記錄(第四章 §6.5) */
  fallenEvents: FallenEvent[];
}

export interface FallenEvent {
  investigatorId: string;
  investigatorName: string;
  chapterId: string;
  fellAt: string; // ISO 8601
  finalNarrative: string;
}

// ─── 場景層 ──────────────────────────────────
export interface ScenarioState {
  scenarioId: string;
  scenarioDefinitionId: string; // 對應後台 MOD-07 場景定義
  campaignId: string; // 屬於哪個戰役
  /** 當前所有地點(對應 MOD-08 地點定義 + 動態狀態) */
  locations: LocationInstance[];
  /** 已解鎖的地點 ID(教學關卡用,逐步解鎖三地點;一般戰役預設全解鎖) */
  unlockedLocations: string[];
  /** 場上敵人(對應 MOD-03 敵人定義 + 當下血量、位置) */
  enemies: EnemyInstance[];
  /** 場上標記(線索、毀滅、隱藏調查點等,規則書 §13) */
  tokens: TokenInstance[];
  /** 議程進度(規則書 §1.5 多分支結算依據) */
  agendaProgress: number;
  /** 目標進度 */
  objectiveProgress: number;
  /** 混沌袋當前組成(規則書 §5,動態變動) */
  chaosBag: ChaosToken[];
  /** 當前回合數 */
  turnNumber: number;
  /** 當前階段(對應第三章 §3 回合四階段) */
  phase: 'short_rest_decision' | 'investigator' | 'mythos' | 'turn_end';
}

export interface LocationInstance {
  locationDefinitionId: string;
  /** 視野光照狀態(對應第五章 §7) */
  visibility: 'day' | 'night' | 'darkness' | 'fire';
  /** 連接到哪些其他地點(雙向) */
  connectedTo: string[];
  /** 是否需要障礙物移動(2 行動點) */
  isObstacle: boolean;
}

export interface EnemyInstance {
  instanceId: string;
  enemyDefinitionId: string;
  locationId: string;
  hp: number;
  /** 與哪些調查員處於交戰(規則書 §7.2) */
  engagedWith: string[];
  /** 動態詞綴(規則書 §11) */
  modifiers: string[];
}

export interface TokenInstance {
  tokenType: 'clue' | 'doom' | 'hidden_investigation_point' | 'haunting' | 'bless' | 'curse';
  locationId: string;
  amount: number;
}

export interface ChaosToken {
  tokenId: string;
  /** 例:numeric / symbol / bless / curse 等(具體列表依規則書 §5) */
  type: string;
  value: number | null;
}

// ─── 調查員層 ────────────────────────────────
export interface InvestigatorState {
  investigatorId: string;
  investigatorDefinitionId: string; // 對應後台 MOD-11
  ownerPlayerId: string; // 屬於哪個玩家帳號
  /** 八屬性當前值 */
  attributes: {
    strength: number;
    agility: number;
    constitution: number;
    reflex: number;
    intellect: number;
    willpower: number;
    perception: number;
    charisma: number;
  };
  /** 戰鬥風格與專精(規則書 §8.9) */
  combatStyle: string;
  specializations: string[];
  /** 牌組相關 */
  deck: string[]; // 卡片實例 ID 陣列
  hand: string[];
  discardPile: string[];
  removedPile: string[];
  /** 場上資產(武器、護身符、其他持續卡) */
  assetsInPlay: string[];
  /** 當下血量、理智、行動點、資源 */
  hp: number;
  hpMax: number;
  san: number;
  sanMax: number;
  actionPoints: number;
  resources: number;
  /** 當前所在地點 */
  currentLocationId: string | null;
  /** 交戰狀態(規則書 §7.2) */
  engagedWith: string[];
  /** 已觸發過恐懼檢定的怪物(避免重複觸發) */
  triggeredHorrorChecks: string[];
  /** 創傷記錄(規則書支柱 4 第一層) */
  traumas: Trauma[];
  /** 個人秘密任務狀態(規則書 §1.4) */
  secretTaskState: SecretTaskState | null;
  /** 是否已永久死亡(防護用,觸發後該調查員不可被讀寫) */
  permanentlyDead: boolean;
  /** 起始投入點數(對應卡片升級系統 v1) */
  startingXp: number;
}

export interface Trauma {
  type: 'physical' | 'mental';
  /** 累積扣的上限值 */
  amount: number;
  /** 來自哪個事件 */
  source: string;
  acquiredAt: string;
}

export interface SecretTaskState {
  /** 任務內容只該玩家可見(雲端加密儲存,容器決定何時揭曉) */
  taskDefinitionId: string;
  status: 'in_progress' | 'achieved' | 'failed';
  progress: Record<string, unknown>;
}

// ─── 回合層(純記憶體,不入存檔) ──────────────────
export interface TurnState {
  turnNumber: number;
  phase: 'short_rest_decision' | 'investigator' | 'mythos' | 'turn_end';
  /** 本回合內已被使用的行動點(供前端顯示) */
  actionPointsSpent: Record<string, number>; // investigatorId → spent
  /** 城主待觸發的傳奇行動佇列(對應第三章 §9) */
  pendingLegendaryActions: string[];
  /** 本回合內已觸發過的反應卡(避免重複) */
  triggeredReactions: string[];
}

// ─── 完整遊戲狀態快照(用於存檔讀檔) ──────────────
export interface GameStateSnapshot {
  campaign: CampaignState;
  scenario: ScenarioState | null; // 不在場景中時為 null
  investigators: Record<string, InvestigatorState>;
  /** 回合層不入快照,讀檔時從新回合開始 */
  schemaVersion: number;
  capturedAt: string;
}

// ─── 當前狀態結構版本 ───────────────────────────
export const CURRENT_STATE_SCHEMA_VERSION = 1 as const;
