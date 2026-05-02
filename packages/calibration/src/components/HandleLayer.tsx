/**
 * HandleLayer — 校準模式下,為「已選取的熱區」渲染把手與輔助線。
 *
 * 三種形狀各有不同把手:
 *  - rect:四角 + 邊中點(8 個),拖曳調整 size
 *  - ellipse:四端點(4 個),拖曳調整 rx/ry
 *  - polygon:每個頂點一個把手,可拖曳;另外提供「整體位移」由 Hotspot 處理
 *
 * 為了 v1 控制範圍:本層只實作「拖曳頂點 / 端點」,
 * 矩形旋轉、頂點刪除等延後到 v2。
 */
import { useRef } from 'react';
import type { HotspotGeometry } from '../types';
import { useCalibrationContext } from './CalibrationContext';
import { usePointerDrag } from '../hooks/usePointerDrag';
import { isEllipse, isPolygon, isRect, clamp } from '../utils/shapes';
import { screenDeltaToSvgDelta } from '../utils/coordinates';
import styles from '../styles/calibration.module.css';

const HANDLE_R = 8;

interface DragOriginRef {
  geom: HotspotGeometry;
}

interface HandleProps {
  cx: number;
  cy: number;
  onDrag: (dx: number, dy: number) => void;
  onStart: () => void;
  cursor?: string;
}

function Handle({ cx, cy, onDrag, onStart, cursor }: HandleProps) {
  const onPointerDown = usePointerDrag({
    onStart: (e) => {
      e.stopPropagation();
      onStart();
    },
    onMove: (_e, d) => onDrag(d.dx, d.dy),
  });
  return (
    <circle
      className={styles.handle}
      cx={cx}
      cy={cy}
      r={HANDLE_R}
      style={cursor ? { cursor } : undefined}
      onPointerDown={onPointerDown}
    />
  );
}

export function HandleLayer() {
  const { api, viewBox, commit, svgRef } = useCalibrationContext();
  const selected = api.hotspots.find((h) => h.id === api.selectedId);
  const originRef = useRef<DragOriginRef | null>(null);

  if (!api.isCalibrating || !selected) return null;

  const startDrag = () => {
    originRef.current = {
      geom: JSON.parse(JSON.stringify(selected.geometry)) as HotspotGeometry,
    };
  };

  // ─── 矩形:四角 ─────────────────────────────────
  if (selected.shape === 'rect' && isRect(selected.geometry)) {
    const g = selected.geometry;
    const corners = [
      { key: 'tl', cx: g.x, cy: g.y, sx: -1, sy: -1, cursor: 'nwse-resize' },
      { key: 'tr', cx: g.x + g.width, cy: g.y, sx: 1, sy: -1, cursor: 'nesw-resize' },
      { key: 'br', cx: g.x + g.width, cy: g.y + g.height, sx: 1, sy: 1, cursor: 'nwse-resize' },
      { key: 'bl', cx: g.x, cy: g.y + g.height, sx: -1, sy: 1, cursor: 'nesw-resize' },
    ];
    return (
      <g className={styles.handleLayer}>
        {corners.map((c) => (
          <Handle
            key={c.key}
            cx={c.cx}
            cy={c.cy}
            cursor={c.cursor}
            onStart={startDrag}
            onDrag={(sdx, sdy) => {
              const orig = originRef.current?.geom;
              if (!orig || !isRect(orig)) return;
              const { dx, dy } = screenDeltaToSvgDelta(svgRef.current, sdx, sdy);
              let nx = orig.x;
              let ny = orig.y;
              let nw = orig.width;
              let nh = orig.height;
              if (c.sx === -1) {
                nx = clamp(orig.x + dx, 0, orig.x + orig.width - 10);
                nw = orig.x + orig.width - nx;
              } else {
                nw = clamp(orig.width + dx, 10, viewBox.width - orig.x);
              }
              if (c.sy === -1) {
                ny = clamp(orig.y + dy, 0, orig.y + orig.height - 10);
                nh = orig.y + orig.height - ny;
              } else {
                nh = clamp(orig.height + dy, 10, viewBox.height - orig.y);
              }
              const next = api.hotspots.map((h) =>
                h.id === selected.id
                  ? { ...h, geometry: { ...orig, x: nx, y: ny, width: nw, height: nh } }
                  : h,
              );
              commit(next, selected.id);
            }}
          />
        ))}
      </g>
    );
  }

  // ─── 橢圓:四端點 ───────────────────────────────
  if (selected.shape === 'ellipse' && isEllipse(selected.geometry)) {
    const g = selected.geometry;
    const handles = [
      { key: 'r', cx: g.cx + g.rx, cy: g.cy, axis: 'rx' as const, sign: 1 },
      { key: 'l', cx: g.cx - g.rx, cy: g.cy, axis: 'rx' as const, sign: -1 },
      { key: 'b', cx: g.cx, cy: g.cy + g.ry, axis: 'ry' as const, sign: 1 },
      { key: 't', cx: g.cx, cy: g.cy - g.ry, axis: 'ry' as const, sign: -1 },
    ];
    return (
      <g className={styles.handleLayer}>
        {handles.map((h) => (
          <Handle
            key={h.key}
            cx={h.cx}
            cy={h.cy}
            cursor={h.axis === 'rx' ? 'ew-resize' : 'ns-resize'}
            onStart={startDrag}
            onDrag={(sdx, sdy) => {
              const orig = originRef.current?.geom;
              if (!orig || !isEllipse(orig)) return;
              const { dx, dy } = screenDeltaToSvgDelta(svgRef.current, sdx, sdy);
              const next = { ...orig };
              if (h.axis === 'rx') {
                next.rx = clamp(orig.rx + dx * h.sign, 5, Math.min(orig.cx, viewBox.width - orig.cx));
              } else {
                next.ry = clamp(orig.ry + dy * h.sign, 5, Math.min(orig.cy, viewBox.height - orig.cy));
              }
              const nextList = api.hotspots.map((hs) =>
                hs.id === selected.id ? { ...hs, geometry: next } : hs,
              );
              commit(nextList, selected.id);
            }}
          />
        ))}
      </g>
    );
  }

  // ─── 多邊形:每個頂點 ───────────────────────────
  if (selected.shape === 'polygon' && isPolygon(selected.geometry)) {
    const g = selected.geometry;
    return (
      <g className={styles.handleLayer}>
        {g.points.map((p, idx) => (
          <Handle
            key={idx}
            cx={p.x}
            cy={p.y}
            cursor="grab"
            onStart={startDrag}
            onDrag={(sdx, sdy) => {
              const orig = originRef.current?.geom;
              if (!orig || !isPolygon(orig)) return;
              const { dx, dy } = screenDeltaToSvgDelta(svgRef.current, sdx, sdy);
              const nextPts = orig.points.map((pt, i) =>
                i === idx
                  ? {
                      x: clamp(pt.x + dx, 0, viewBox.width),
                      y: clamp(pt.y + dy, 0, viewBox.height),
                    }
                  : pt,
              );
              const nextList = api.hotspots.map((hs) =>
                hs.id === selected.id
                  ? { ...hs, geometry: { points: nextPts } }
                  : hs,
              );
              commit(nextList, selected.id);
            }}
          />
        ))}
      </g>
    );
  }

  return null;
}
