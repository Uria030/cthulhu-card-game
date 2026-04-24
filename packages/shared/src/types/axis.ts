/**
 * 主軸（Primary Axis）— 雙軸戰鬥草案 s08 §2.1 軸向系統的實作落地
 *
 * 每張卡片在設計時需宣告一個「主軸」——這是該卡設計意圖最強的軸向。
 * 軸向有五層（由粗到細），強度合約與層數成反比：
 * - faction（陣營極軸）：最廣，效果要最淡
 * - combat_style（戰鬥風格軸）：中等
 * - proficiency（戰鬥專精軸）：較強
 * - card_name（卡名軸）：最細，效果可最強
 * - talisman_type（法器物質軸）：與其他層正交
 *
 * 未指定主軸的卡片填 'none'（單純工具卡，不參與軸向協同）。
 */

export type PrimaryAxisLayer =
  | 'none'
  | 'faction'
  | 'combat_style'
  | 'proficiency'
  | 'card_name'
  | 'talisman_type';

export interface PrimaryAxisFields {
  /** 主軸層：宣告此卡設計時心中最強的軸向層級 */
  primary_axis_layer: PrimaryAxisLayer;
  /** 主軸值：依 layer 型別而異（例 'E' / 'shooting' / '老警長' / 'wooden_peach'）；layer='none' 時為 null */
  primary_axis_value: string | null;
}

/** 軸向層級的中文標籤（UI 顯示用） */
export const PRIMARY_AXIS_LAYER_LABELS: Record<PrimaryAxisLayer, string> = {
  none: '無軸向',
  faction: '陣營極軸',
  combat_style: '戰鬥風格軸',
  proficiency: '戰鬥專精軸',
  card_name: '卡名軸',
  talisman_type: '法器類型軸',
};

/** 軸向層級的強度暗示（給 UI 呈現提示色） */
export const PRIMARY_AXIS_LAYER_STRENGTH: Record<PrimaryAxisLayer, string> = {
  none: '#6a6a6a',
  faction: '#c62828',       // 最廣 → 紅（警告效果要淡）
  combat_style: '#ef6c00',  // 次廣 → 橙
  proficiency: '#f9a825',   // 中細 → 黃
  card_name: '#2e7d32',     // 最細 → 綠（效果可強）
  talisman_type: '#6D4C41', // 正交 → 棕褐
};
