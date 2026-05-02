/**
 * 長按手勢 Hook(觸控用,書房導覽 Part 5 規格:550ms 觸發刪除候選)
 *
 * 用法:
 *   const longPressProps = useLongPress({
 *     onLongPress: () => deleteHotspot(id),
 *     ms: 550,
 *     moveTolerance: 8
 *   });
 *   <element {...longPressProps} />
 *
 * 短按 / 拖曳會取消。
 */
import { useCallback, useRef } from 'react';

export interface UseLongPressOptions {
  onLongPress: (e: React.PointerEvent) => void;
  ms?: number;
  /** 移動超過此像素數則取消 */
  moveTolerance?: number;
}

interface State {
  pointerId: number;
  startX: number;
  startY: number;
  timer: number;
  triggered: boolean;
}

export function useLongPress(opts: UseLongPressOptions) {
  const { onLongPress, ms = 550, moveTolerance = 8 } = opts;
  const stateRef = useRef<State | null>(null);

  const cancel = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    window.clearTimeout(s.timer);
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleUp);
    stateRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 用 ref 包,避免 closure 過期
  const handleMoveRef = useRef<(e: PointerEvent) => void>(() => {});
  const handleUpRef = useRef<(e: PointerEvent) => void>(() => {});

  const handleMove = useCallback((e: PointerEvent) => handleMoveRef.current(e), []);
  const handleUp = useCallback((e: PointerEvent) => handleUpRef.current(e), []);

  handleMoveRef.current = (e: PointerEvent) => {
    const s = stateRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (Math.hypot(dx, dy) > moveTolerance) {
      cancel();
    }
  };

  handleUpRef.current = (e: PointerEvent) => {
    const s = stateRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    cancel();
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // 取消任何先前殘留
      const prev = stateRef.current;
      if (prev) cancel();

      const startX = e.clientX;
      const startY = e.clientY;
      const pointerId = e.pointerId;
      const reactE = e;

      const timer = window.setTimeout(() => {
        const cur = stateRef.current;
        if (!cur || cur.pointerId !== pointerId) return;
        cur.triggered = true;
        cancel();
        onLongPress(reactE);
      }, ms);

      stateRef.current = { pointerId, startX, startY, timer, triggered: false };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleUp);
    },
    [ms, onLongPress, cancel, handleMove, handleUp],
  );

  return { onPointerDown };
}
