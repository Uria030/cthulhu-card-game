/**
 * CalibrationSurface — 包住底圖 + SVG overlay 的容器。
 *
 * 負責:
 *  - 渲染 <img> 底圖(支援 srcSet)
 *  - 渲染 SVG overlay(將 ref 注入 Context)
 *  - 校準模式下:套用 calibrate-mode CSS class、禁用 native 拖曳
 *  - 點擊空白處(SVG 背景)→ 取消選取
 */
import { useCallback } from 'react';
import type { BackgroundImageProps } from '../types';
import { useCalibrationContext } from './CalibrationContext';
import styles from '../styles/calibration.module.css';

export interface CalibrationSurfaceProps {
  background: BackgroundImageProps;
  className?: string;
  children: React.ReactNode;
  /** SVG preserveAspectRatio,預設 'xMidYMid meet' */
  preserveAspectRatio?: string;
}

export function CalibrationSurface(props: CalibrationSurfaceProps) {
  const {
    background,
    className,
    children,
    preserveAspectRatio = 'xMidYMid meet',
  } = props;
  const { api, viewBox, svgRef } = useCalibrationContext();

  const onSvgPointerDown = useCallback(
    () => {
      // 只在校準模式下生效
      if (!api.isCalibrating) return;
      // 點到子元素(熱區)會 stopPropagation,所以這裡只會接到背景點擊
      api.selectHotspot(null);
    },
    [api],
  );

  const stageClass = [
    styles.surface,
    api.isCalibrating ? styles.calibrating : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={stageClass}
      style={{ aspectRatio: `${viewBox.width} / ${viewBox.height}` }}
    >
      <img
        className={styles.background}
        src={background.src}
        srcSet={background.srcSet}
        sizes={background.sizes}
        alt={background.alt}
        draggable={false}
      />
      <svg
        ref={svgRef}
        className={styles.overlay}
        viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio={preserveAspectRatio}
        onPointerDown={onSvgPointerDown}
      >
        {children}
      </svg>
    </div>
  );
}
