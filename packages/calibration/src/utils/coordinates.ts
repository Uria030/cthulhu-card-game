/**
 * SVG 座標轉換:把 PointerEvent 的螢幕座標轉成 SVG 內部座標。
 *
 * 不依賴第三方,直接使用 SVGSVGElement.createSVGPoint 與 getScreenCTM。
 */

export interface SvgPoint {
  x: number;
  y: number;
}

/**
 * 將螢幕事件座標轉為指定 SVG 元素內部座標。
 * 失敗時回傳 { x: 0, y: 0 }(例如 SVG 尚未掛載)。
 */
export function eventToSvgPoint(
  svg: SVGSVGElement | null,
  e: { clientX: number; clientY: number },
): SvgPoint {
  if (!svg) return { x: 0, y: 0 };
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const inv = ctm.inverse();
  const local = pt.matrixTransform(inv);
  return { x: local.x, y: local.y };
}

/**
 * 將兩個螢幕事件座標的差,轉為 SVG 內部座標的差(忽略 viewBox 偏移)。
 * 用於拖曳時計算位移,避免逐幀重算 CTM 造成抖動。
 */
export function screenDeltaToSvgDelta(
  svg: SVGSVGElement | null,
  dxScreen: number,
  dyScreen: number,
): { dx: number; dy: number } {
  if (!svg) return { dx: 0, dy: 0 };
  const ctm = svg.getScreenCTM();
  if (!ctm) return { dx: 0, dy: 0 };
  // CTM 的 a/d 是縮放比例(忽略旋轉,因為 SVG viewBox 不旋轉)
  return {
    dx: dxScreen / (ctm.a || 1),
    dy: dyScreen / (ctm.d || 1),
  };
}
