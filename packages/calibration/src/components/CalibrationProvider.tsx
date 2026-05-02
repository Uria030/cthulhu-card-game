/**
 * CalibrationProvider — 對外最外層元件。
 *
 * 用法:
 *   <CalibrationProvider
 *     surface="study-room"
 *     hotspots={initialHotspots}
 *     viewBox={{ width: 1408, height: 800 }}
 *     permissionCheck={() => user.role === 'admin'}
 *   >
 *     <CalibrationSurface ...>
 *       {hotspots.map(hs => <Hotspot key={hs.id} {...hs} />)}
 *     </CalibrationSurface>
 *   </CalibrationProvider>
 */
import { useRef } from 'react';
import type { CalibrationProviderProps } from '../types';
import { useCalibrationCore } from '../hooks/useCalibration';
import { CalibrationContext } from './CalibrationContext';

export function CalibrationProvider(props: CalibrationProviderProps) {
  const {
    surface,
    hotspots,
    viewBox,
    onSaveJson,
    permissionCheck,
    enableKeyboardShortcut,
    enableUrlTrigger,
    children,
  } = props;

  const svgRef = useRef<SVGSVGElement | null>(null);

  const { api, commit } = useCalibrationCore({
    surface,
    initialHotspots: hotspots,
    viewBox,
    onSaveJson,
    permissionCheck,
    enableKeyboardShortcut,
    enableUrlTrigger,
  });

  return (
    <CalibrationContext.Provider
      value={{ api, surface, viewBox, commit, svgRef }}
    >
      {children}
    </CalibrationContext.Provider>
  );
}
