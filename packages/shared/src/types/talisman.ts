/**
 * 雙軸戰鬥草案 v1.0：法器卡與遭遇卡威脅類型的 shared 型別
 *
 * 命名說明：既有 encounter_cards.encounter_type 已代表「交互類型」（thriller/choice/trade/...）。
 * 草案 v1.0 的「遭遇卡威脅類型」改以 threat_type 命名（mental/physical/ritual），
 * 與交互類型正交並存。
 */

export type ThreatTypeCode = 'mental' | 'physical' | 'ritual';

export type BreakTiming = 'instant' | 'test' | 'stockpile';

/** 檢定型法器指定的檢定屬性；與 constants/attributes.ts 的 AttributeId 語意等價，取別名避免 index barrel 重複 export */
export type BreakTestAttribute =
  | 'strength' | 'agility' | 'constitution' | 'reflex'
  | 'intellect' | 'willpower' | 'perception' | 'charisma';

export interface ThreatType {
  code: ThreatTypeCode;
  name_zh: string;
  name_en?: string;
  description?: string;
  narrative_archetype?: string;
}

export interface TalismanType {
  code: string;
  name_zh: string;
  name_en?: string;
  description?: string;
}

/**
 * 法器卡的擴充欄位（疊加在 card_definitions 上）。
 * 僅在 is_talisman=true 時有意義。
 */
export interface TalismanFields {
  is_talisman: boolean;
  talisman_type?: string | null;
  target_threat_types: ThreatTypeCode[];
  break_timing?: BreakTiming | null;
  break_strength_max?: number | null;
  break_charge_label?: string | null;
  break_charge_max?: number | null;
  break_test_attribute?: BreakTestAttribute | null;
  stockpile_accumulation_rule?: string | null;
  break_axis_value?: number | null;
  kill_axis_value?: number | null;
  leverage_modifier?: number | null;
}

/**
 * 遭遇卡子程式（subroutine）—— 單張遭遇卡 1-4 條獨立的負面效果。
 * 玩家可逐條選擇破除。
 */
export interface EncounterSubroutine {
  id: string;
  encounter_card_id: string;
  sub_order: number;
  effect_description: string;
  mechanics: Record<string, unknown>;
}

/**
 * 遭遇卡的威脅類型擴充欄位（疊加在 encounter_cards 上）。
 * 與既有 encounter_type（交互類型）並存。
 */
export interface ThreatTypingFields {
  threat_type?: ThreatTypeCode | null;
  threat_strength?: number | null;
  designer_dv?: number | null;
  subroutines?: EncounterSubroutine[];
}

/**
 * 三種破除時機的預設過路費函數（玩家視角 V 值）。
 */
export const TOLL_FUNCTIONS = {
  instant:   (s: number, n: number) => Math.ceil(s / 2) + n,
  test:      (_s: number, _n: number) => 1,
  stockpile: (s: number, _n: number) => s,
} as const;

/**
 * 軸向指認句型範本（s06 卡片敘述文法規範擴充預留）。
 */
export const AXIS_REFERENCE_TEMPLATES = {
  trigger:     '在你打出/獲得/消費另一張 [軸向指認] 卡時，[效果]。',
  persistent:  '只要你場上有 N 張 [軸向指認] 卡，[效果]。',
  enhance:     '你打出的 [軸向指認] 卡 [修改效果]。',
  conditional: '只有在你有 [軸向指認] 卡在場上時，才能 [動作]。',
  search:      '從你的牌庫搜尋 1 張 [軸向指認] 卡，將其加入你的手牌，然後洗牌。',
} as const;
