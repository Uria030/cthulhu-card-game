/**
 * s06 玩家敘事閘門。
 *
 * 卡面文法另有完整的 validator；這裡只處理引擎送到容器的事件摘要，
 * 避免把卡面專屬句型強加到戰役 Log 與多人演出。
 */
export interface PlayerNarrativeViolation {
  token: string;
  replacement: string;
}

const FORBIDDEN_TERMS: ReadonlyArray<{ pattern: RegExp; token: string; replacement: string }> = [
  { pattern: /\bHP\b/, token: 'HP', replacement: '生命' },
  { pattern: /\bSAN\b/, token: 'SAN', replacement: '恐懼' },
  { pattern: /\bAP\b/, token: 'AP', replacement: '行動點' },
  // s06 將 DC 列為禁用縮寫；戰鬥、遭遇與恐懼檢定共用此欄位，因此不用只適用調查的「調查難度」。
  { pattern: /\bDC\b/, token: 'DC', replacement: '檢定目標' },
  { pattern: /\bvs\b/i, token: 'vs', replacement: '對' },
];

const ASCII_NEGATIVE = /(^|[\s(（])-([0-9])/;

/** 回傳玩家可見敘事中違反 s06 基礎術語/數字格式的項目。 */
export function validatePlayerNarrative(text: string): PlayerNarrativeViolation[] {
  const violations = FORBIDDEN_TERMS
    .filter((rule) => rule.pattern.test(text))
    .map(({ token, replacement }) => ({ token, replacement }));
  if (ASCII_NEGATIVE.test(text)) violations.push({ token: '-', replacement: '−' });
  return violations;
}

/**
 * 將可安全自動修正的 s06 違例轉為玩家術語。
 * 這是顯示邊界的防線；引擎狀態欄位與效果碼維持原名，避免改動規則邏輯。
 */
export function normalisePlayerNarrative(text: string): string {
  return text
    .replace(/\bHP\b/g, '生命')
    .replace(/\bSAN\b/g, '恐懼')
    .replace(/\bAP\b/g, '行動點')
    .replace(/\bDC\b/g, '檢定目標')
    .replace(/\bvs\b/gi, '對')
    .replace(/(^|[\s(（])-([0-9])/g, '$1−$2');
}
