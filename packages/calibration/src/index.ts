/**
 * @cthulhu/calibration — 對外匯出
 */
export { CalibrationProvider } from './components/CalibrationProvider';
export { CalibrationSurface } from './components/CalibrationSurface';
export { Hotspot } from './components/Hotspot';
export { HandleLayer } from './components/HandleLayer';
export { CalibrationToolbar } from './components/CalibrationToolbar';
export { CalibrationPanel } from './components/CalibrationPanel';
export {
  useCalibration,
  useCalibrationContext,
} from './components/CalibrationContext';

export {
  parseHotspotsJson,
  packHotspotsJson,
  JsonSchemaError,
} from './utils/jsonSchema';

export {
  toPolygon,
  upgradeAllToPolygon,
  getCenter,
  isRect,
  isEllipse,
  isPolygon,
} from './utils/shapes';

export type {
  HotspotData,
  HotspotShape,
  HotspotGeometry,
  RectGeometry,
  EllipseGeometry,
  PolygonGeometry,
  PolygonPoint,
  TooltipDirection,
  ViewBox,
  BackgroundImageProps,
  HotspotsJsonV2,
  HotspotsJsonV1,
  HotspotsMetadata,
  HotspotClickDetail,
  CalibrationApi,
  CalibrationProviderProps,
  PermissionCheck,
  SaveJsonHandler,
} from './types';
