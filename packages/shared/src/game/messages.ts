/**
 * G-01 引擎核心 — 訊息協議 type 定義
 *
 * 依《遊戲本體企劃書》第三章 §4(行動點六步生命週期)+ 第七章 §3.4
 *(M1 必須支援多人架構,訊息單位).
 *
 * 引擎與容器之間的所有溝通都是訊息,不是直接函式呼叫。
 * 這保證未來切換到雲端權威時不需要重構容器(規則書紅線 #5)。
 */

// ─── 動作類型(對應第三章 §4.1 六步生命週期入口) ──────────
export type ActionType =
  | 'play_card'
  | 'attack'
  | 'move'
  | 'investigate'
  | 'taunt'
  | 'evade'
  | 'execute_card_action'
  | 'consume'
  | 'gain_resource'
  | 'draw_card'
  | 'commit_attribute_icon'
  | 'short_rest'
  | 'declare_intent';

// ─── 訊息基本欄位(共用) ──────────────────────────
export interface BaseMessage {
  /** UUID,訊息去重與追蹤 */
  id: string;
  /** ISO 8601 時間戳 */
  timestamp: string;
  /** 訊息結構版本(對應存檔升級遷移機制) */
  schemaVersion: number;
  /** 來源:player ID / 'engine' / 'cloud' */
  source: string;
  /** 訊息類別 */
  kind: 'intent' | 'result' | 'notification';
}

// ─── Intent 意圖訊息(容器 → 引擎) ──────────────────
export interface IntentMessage extends BaseMessage {
  kind: 'intent';
  /** 動作類型 */
  actionType: ActionType;
  /** 該動作的所有參數(目標 ID、卡片 ID、選擇分支等) */
  payload: Record<string, unknown>;
  /** 發送該意圖的玩家 ID(連線多人時用) */
  playerId: string;
  /** 該玩家當前控制的調查員 ID */
  investigatorId: string;
}

// ─── Result 結果訊息(引擎 → 容器) ──────────────────
export interface ResultMessage extends BaseMessage {
  kind: 'result';
  /** 對應的 Intent message id */
  inResponseTo: string;
  /** 結算成功 / 駁回 */
  outcome: 'accepted' | 'rejected';
  /** 駁回時的拒絕原因(對應第三章 §4.3) */
  rejection?: {
    /** 給容器顯示用的克蘇魯敘事(不是技術腔) */
    narrative: string;
    /** 引導玩家修正的具體建議,符合 UX 準則 #3 */
    suggestion?: string;
  };
  /** 通過時引擎送回的結算結果(扣費明細、新狀態快照等) */
  effects?: ResultEffect[];
}

export interface ResultEffect {
  /** 效果類型,對應卡片設計的 effect_code */
  type: string;
  /** 效果參數 */
  params: Record<string, unknown>;
  /** 該效果作用的目標 ID */
  targetId?: string;
}

// ─── Notification 通知訊息(引擎 → 容器,廣播) ────────
export type NotificationType =
  | 'phase_changed'              // 階段切換(短休息 → 調查員 → 神話 → 回合結束)
  | 'turn_started'
  | 'turn_ended'
  | 'enemy_action'               // 怪物行動
  | 'mythos_event'               // 神話階段事件(對應第三章 §9 城主行動)
  | 'environment_change'         // 環境變化(失火 / 黑暗 / 光源)
  | 'investigator_downed'        // 調查員瀕死
  | 'investigator_permanently_dead' // 永久死亡(觸發第四章 §6 流程)
  | 'scenario_resolved'          // 場景結束(目標達成 / 議程跑完)
  | 'visibility_changed';        // 視野光照狀態變化(對應第五章 §7)

export interface NotificationMessage extends BaseMessage {
  kind: 'notification';
  notificationType: NotificationType;
  payload: Record<string, unknown>;
}

// ─── 訊息聯集 ────────────────────────────────
export type GameMessage = IntentMessage | ResultMessage | NotificationMessage;

// ─── 當前訊息結構版本 ───────────────────────────
export const CURRENT_MESSAGE_SCHEMA_VERSION = 1 as const;
