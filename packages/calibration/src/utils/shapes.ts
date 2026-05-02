/**
 * 幾何運算:形狀升級、座標 clamp、頂點操作等
 */
import type {
  HotspotData,
  HotspotGeometry,
  PolygonPoint,
  RectGeometry,
  EllipseGeometry,
  PolygonGeometry,
  ViewBox,
} from '../types';

export const clamp = (v: number, mn: number, mx: number): number =>
  Math.max(mn, Math.min(mx, v));

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ─── Type guards ────────────────────────────────────────

export const isRect = (g: HotspotGeometry): g is RectGeometry =>
  'width' in g && 'height' in g;

export const isEllipse = (g: HotspotGeometry): g is EllipseGeometry =>
  'cx' in g && 'rx' in g;

export const isPolygon = (g: HotspotGeometry): g is PolygonGeometry =>
  'points' in g;

// ─── 中心點 ────────────────────────────────────────────

export function getCenter(hs: HotspotData): { x: number; y: number } {
  if (hs.shape === 'rect' && isRect(hs.geometry)) {
    return {
      x: hs.geometry.x + hs.geometry.width / 2,
      y: hs.geometry.y + hs.geometry.height / 2,
    };
  }
  if (hs.shape === 'ellipse' && isEllipse(hs.geometry)) {
    return { x: hs.geometry.cx, y: hs.geometry.cy };
  }
  if (hs.shape === 'polygon' && isPolygon(hs.geometry)) {
    const pts = hs.geometry.points;
    const sx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const sy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return { x: sx, y: sy };
  }
  return { x: 0, y: 0 };
}

// ─── 升級為多邊形(無副作用) ─────────────────────────

/**
 * 把 rect / ellipse 轉成 polygon。回傳新的 hotspot(不變動原物件)。
 * 若已是 polygon 則原樣回傳。
 */
export function toPolygon(hs: HotspotData, ellipseSegments = 8): HotspotData {
  if (hs.shape === 'polygon') return hs;
  const next = clone(hs);
  if (hs.shape === 'rect' && isRect(hs.geometry)) {
    const g = hs.geometry;
    const cx = g.x + g.width / 2;
    const cy = g.y + g.height / 2;
    const rot = ((g.rotation ?? 0) * Math.PI) / 180;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const corners: PolygonPoint[] = [
      { x: g.x, y: g.y },
      { x: g.x + g.width, y: g.y },
      { x: g.x + g.width, y: g.y + g.height },
      { x: g.x, y: g.y + g.height },
    ];
    const pts = corners.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return {
        x: Math.round(cx + dx * cs - dy * sn),
        y: Math.round(cy + dx * sn + dy * cs),
      };
    });
    next.shape = 'polygon';
    next.geometry = { points: pts };
  } else if (hs.shape === 'ellipse' && isEllipse(hs.geometry)) {
    const g = hs.geometry;
    const N = ellipseSegments;
    const pts: PolygonPoint[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push({
        x: Math.round(g.cx + g.rx * Math.cos(a)),
        y: Math.round(g.cy + g.ry * Math.sin(a)),
      });
    }
    next.shape = 'polygon';
    next.geometry = { points: pts };
  }
  return next;
}

/** 批次:把整組熱區的非多邊形全部升級 */
export function upgradeAllToPolygon(
  hotspots: HotspotData[],
  ellipseSegments = 8,
): HotspotData[] {
  return hotspots.map((hs) => toPolygon(hs, ellipseSegments));
}

// ─── 整體位移 ──────────────────────────────────────────

export function applyMove(
  hs: HotspotData,
  origGeometry: HotspotGeometry,
  dx: number,
  dy: number,
  vb: ViewBox,
): HotspotData {
  const next = clone(hs);
  if (hs.shape === 'rect' && isRect(origGeometry) && isRect(next.geometry)) {
    next.geometry.x = clamp(origGeometry.x + dx, 0, vb.width - origGeometry.width);
    next.geometry.y = clamp(origGeometry.y + dy, 0, vb.height - origGeometry.height);
  } else if (hs.shape === 'ellipse' && isEllipse(origGeometry) && isEllipse(next.geometry)) {
    next.geometry.cx = clamp(origGeometry.cx + dx, origGeometry.rx, vb.width - origGeometry.rx);
    next.geometry.cy = clamp(origGeometry.cy + dy, origGeometry.ry, vb.height - origGeometry.ry);
  } else if (hs.shape === 'polygon' && isPolygon(origGeometry) && isPolygon(next.geometry)) {
    next.geometry.points = origGeometry.points.map((p) => ({
      x: clamp(p.x + dx, 0, vb.width),
      y: clamp(p.y + dy, 0, vb.height),
    }));
  }
  return next;
}

// ─── SVG path 字串生成 ─────────────────────────────────

export function polygonPointsAttr(points: PolygonPoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}
