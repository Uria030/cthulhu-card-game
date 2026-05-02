/**
 * @cthulhu/calibration — 公共型別
 *
 * 所有對外公開的 API 型別都集中在此。
 * 嚴格 TypeScript:零 any。
 */

// ─── 幾何 ───────────────────────────────────────────────

export interface RectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 旋轉角度(度),預設 0 */
  rotation?: number;
}

export interface EllipseGeometry {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface PolygonPoint {
  x: number;
  y: number;
}

export interface PolygonGeometry {
  points: PolygonPoint[];
}

export type HotspotShape = 'rect' | 'ellipse' | 'polygon';
export type HotspotGeometry = RectGeometry | EllipseGeometry | PolygonGeometry;

// ─── 熱區 ───────────────────────────────────────────────

/** 浮動提示出現的方向 */
export type TooltipDirection = 'up' | 'down' | 'left' | 'right';

export interface HotspotData {
  /** 唯一 id,例如 'prep.deck' */
  id: string;
  /** 分類,例如 'prep' / 'depart' / 'seat' */
  group: string;
  /** 中文簡稱(除錯與清單顯示用) */
  label: string;
  /** 浮動提示文字 */
  tooltip: string;
  /** 提示出現方向 */
  direction: TooltipDirection;
  /** 椅子用:座位上的玩家暱稱(可選) */
  player?: string;
  /** 形狀類型 */
  shape: HotspotShape;
  /** 對應形狀的幾何資料 */
  geometry: HotspotGeometry;
}

// ─── ViewBox ────────────────────────────────────────────

export interface ViewBox {
  width: number;
  height: number;
}

// ─── 背景圖 ─────────────────────────────────────────────

export interface BackgroundImageProps {
  src: string;
  srcSet?: string;
  sizes?: string;
  alt: string;
  /** 原圖天然寬,可選(僅供記錄) */
  naturalWidth?: number;
  /** 原圖天然高,可選(僅供記錄) */
  naturalHeight?: number;
}

// ─── JSON Schema ────────────────────────────────────────

export interface HotspotsJsonV2 {
  schema: 'ug-hotspots';
  version: '2.0';
  surface: string;
  viewBox: ViewBox;
  background?: BackgroundImageProps;
  hotspots: HotspotData[];
  metadata?: HotspotsMetadata;
}

export interface HotspotsMetadata {
  calibratedBy?: string;
  /** ISO-8601 時間字串 */
  calibratedAt?: string;
  appVersion?: string;
  notes?: string;
}

/** v1.0 schema(僅讀取相容用) */
export interface HotspotsJsonV1 {
  schema: 'ug-study-room-hotspots';
  hotspots: HotspotData[];
  /** v1 沒有 surface 欄位,讀入時由呼叫端指定 */
}

// ─── CustomEvent ─────────────────────────────────────────

export interface HotspotClickDetail {
  surface: string;
  hotspotId: string;
  group: string;
  label: string;
  originalEvent: PointerEvent | MouseEvent;
}

declare global {
  interface WindowEventMap {
    'hotspot-click': CustomEvent<HotspotClickDetail>;
  }
}

// ─── 校準狀態(Hook 對外回傳) ───────────────────────────

export interface CalibrationApi {
  isCalibrating: boolean;
  enterCalibration: () => void;
  exitCalibration: () => void;
  toggleCalibration: () => void;
  hotspots: HotspotData[];
  selectedId: string | null;
  selectHotspot: (id: string | null) => void;
  downloadJson: () => void;
  loadJson: (file: File) => Promise<void>;
  resetToDefault: () => void;
  /** 已修改的熱區 id 集合 */
  modifiedIds: Set<string>;
  /** 是否可 Undo */
  canUndo: boolean;
  /** 是否可 Redo */
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

// ─── Provider 設定 ───────────────────────────────────────

export interface SaveJsonHandler {
  (json: HotspotsJsonV2): void | Promise<void>;
}

export interface PermissionCheck {
  (): boolean;
}

export interface CalibrationProviderProps {
  /** 介面 ID,例如 'study-room' */
  surface: string;
  /** 初始熱區資料(出廠預設) */
  hotspots: HotspotData[];
  /** SVG viewBox 尺寸 */
  viewBox: ViewBox;
  /**
   * 自訂 JSON 儲存處理。未提供時走預設(瀏覽器下載)。
   * 例如後台版本可改成 POST 到伺服器。
   */
  onSaveJson?: SaveJsonHandler;
  /**
   * 是否允許進入校準模式。預設 () => false。
   * 由業務層注入(例如檢查 user.role === 'admin')。
   */
  permissionCheck?: PermissionCheck;
  /** 是否啟用鍵盤快捷鍵 Shift+C 切換校準。預設 true。 */
  enableKeyboardShortcut?: boolean;
  /** 是否啟用 URL 參數 ?calibrate=1 觸發。預設 true。 */
  enableUrlTrigger?: boolean;
  children: React.ReactNode;
}
