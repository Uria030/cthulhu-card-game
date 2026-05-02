/**
 * 通用 Pointer 拖曳 Hook(滑鼠 + 觸控統一)
 *
 * 用法:
 *   const onPointerDown = usePointerDrag({
 *     onStart: (e) => { ... },
 *     onMove: (e, delta) => { ... },   // delta 為螢幕像素
 *     onEnd: () => { ... }
 *   });
 *   <div onPointerDown={onPointerDown} />
 *
 * 自動處理 setPointerCapture / 移除全域監聽。
 */
import { useCallback, useRef } from 'react';

export interface DragDelta {
  /** 累計位移(從 onStart 起算) */
  dx: number;
  dy: number;
  /** 自上一次 move 的增量 */
  ddx: number;
  ddy: number;
}

export interface UsePointerDragOptions {
  onStart?: (e: React.PointerEvent) => void;
  onMove?: (e: PointerEvent, delta: DragDelta) => void;
  onEnd?: (e: PointerEvent) => void;
  /** 啟用條件:回傳 false 則不啟動拖曳(例如非主鍵) */
  filter?: (e: React.PointerEvent) => boolean;
}

export function usePointerDrag(opts: UsePointerDragOptions) {
  const stateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  } | null>(null);

  const handleMove = useCallback(
    (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      const ddx = e.clientX - s.lastX;
      const ddy = e.clientY - s.lastY;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      opts.onMove?.(e, { dx, dy, ddx, ddy });
    },
    [opts],
  );

  const handleUp = useCallback(
    (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      stateRef.current = null;
      opts.onEnd?.(e);
    },
    [opts, handleMove],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (opts.filter && !opts.filter(e)) return;
      // 攔下事件:避免 SVG 預設拖曳
      e.preventDefault();
      const target = e.currentTarget as Element;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // 某些瀏覽器(如 firefox 對 SVG)可能拋錯,忽略
      }
      stateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleUp);
      opts.onStart?.(e);
    },
    [opts, handleMove, handleUp],
  );

  return onPointerDown;
}
