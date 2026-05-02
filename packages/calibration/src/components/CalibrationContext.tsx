/**
 * CalibrationContext — 把 useCalibrationCore 的結果分享給整棵子樹。
 *
 * 業務元件可用 useCalibrationContext() 讀取狀態與操作。
 */
import { createContext, useContext } from 'react';
import type { CalibrationApi, HotspotData, ViewBox } from '../types';

export interface CalibrationContextValue {
  api: CalibrationApi;
  surface: string;
  viewBox: ViewBox;
  /** 內部:Hotspot 元件用,提交一次新狀態進歷程 */
  commit: (next: HotspotData[], modifiedId?: string) => void;
  /** 當前 SVG 容器 ref(由 Surface 設定) */
  svgRef: React.RefObject<SVGSVGElement | null>;
}

export const CalibrationContext = createContext<CalibrationContextValue | null>(null);

export function useCalibrationContext(): CalibrationContextValue {
  const ctx = useContext(CalibrationContext);
  if (!ctx) {
    throw new Error(
      '[ug-calibration] useCalibrationContext 必須在 <CalibrationProvider> 內使用',
    );
  }
  return ctx;
}

/** 業務層便利 Hook:只想拿 API,不想拿內部欄位 */
export function useCalibration(): CalibrationApi {
  return useCalibrationContext().api;
}
