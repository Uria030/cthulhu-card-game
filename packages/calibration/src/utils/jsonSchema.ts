/**
 * hotspots.json schema 驗證與 v1 → v2 自動轉換。
 *
 * 沒有引入 JSON schema 套件:純手寫驗證,保持零依賴。
 */
import type {
  HotspotData,
  HotspotsJsonV1,
  HotspotsJsonV2,
  ViewBox,
} from '../types';

export class JsonSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonSchemaError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function assertHotspotShape(hs: unknown, idx: number): asserts hs is HotspotData {
  if (!isObj(hs)) throw new JsonSchemaError(`hotspots[${idx}] 不是物件`);
  const required = ['id', 'group', 'label', 'tooltip', 'direction', 'shape', 'geometry'];
  for (const k of required) {
    if (!(k in hs)) throw new JsonSchemaError(`hotspots[${idx}] 缺少欄位 ${k}`);
  }
  const shape = hs.shape;
  if (shape !== 'rect' && shape !== 'ellipse' && shape !== 'polygon') {
    throw new JsonSchemaError(`hotspots[${idx}].shape 不合法: ${String(shape)}`);
  }
  const dir = hs.direction;
  if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') {
    throw new JsonSchemaError(`hotspots[${idx}].direction 不合法: ${String(dir)}`);
  }
  // 不深查 geometry — 由 SDK 渲染時若不合法會自然失敗,且容錯比嚴格驗證重要
}

function assertViewBox(vb: unknown): asserts vb is ViewBox {
  if (!isObj(vb)) throw new JsonSchemaError('viewBox 缺失或格式錯誤');
  if (typeof vb.width !== 'number' || typeof vb.height !== 'number') {
    throw new JsonSchemaError('viewBox.width / viewBox.height 必須為數字');
  }
}

/**
 * 解析任意輸入,轉為 v2 格式。
 * - v2 直接驗證後回傳
 * - v1 自動補齊 surface / viewBox(由呼叫端注入)
 * - 其他 → 拋 JsonSchemaError
 */
export interface ParseOptions {
  /** v1 沒有 surface,須由呼叫端注入 */
  fallbackSurface: string;
  /** v1 沒有 viewBox,須由呼叫端注入 */
  fallbackViewBox: ViewBox;
}

export function parseHotspotsJson(
  raw: unknown,
  opts: ParseOptions,
): HotspotsJsonV2 {
  if (!isObj(raw)) throw new JsonSchemaError('JSON 根層不是物件');

  const schema = raw.schema;
  const hotspots = raw.hotspots;
  if (!Array.isArray(hotspots)) throw new JsonSchemaError('hotspots 必須為陣列');
  hotspots.forEach((hs, i) => assertHotspotShape(hs, i));

  // v2
  if (schema === 'ug-hotspots') {
    if (raw.version !== '2.0') {
      throw new JsonSchemaError(`不支援的 version: ${String(raw.version)}`);
    }
    if (typeof raw.surface !== 'string') {
      throw new JsonSchemaError('v2 必須有 surface 欄位');
    }
    assertViewBox(raw.viewBox);
    return {
      schema: 'ug-hotspots',
      version: '2.0',
      surface: raw.surface,
      viewBox: raw.viewBox as ViewBox,
      background: (raw.background as HotspotsJsonV2['background']) ?? undefined,
      hotspots: hotspots as HotspotData[],
      metadata: (raw.metadata as HotspotsJsonV2['metadata']) ?? undefined,
    };
  }

  // v1 — 自動轉換
  if (schema === 'ug-study-room-hotspots') {
    return {
      schema: 'ug-hotspots',
      version: '2.0',
      surface: opts.fallbackSurface,
      viewBox: opts.fallbackViewBox,
      hotspots: hotspots as HotspotData[],
      metadata: { notes: '由 v1 (ug-study-room-hotspots) 自動升級' },
    };
  }

  throw new JsonSchemaError(`未知的 schema: ${String(schema)}`);
}

/**
 * 從目前狀態打包成 v2 JSON。
 */
export function packHotspotsJson(args: {
  surface: string;
  viewBox: ViewBox;
  hotspots: HotspotData[];
  background?: HotspotsJsonV2['background'];
  metadata?: HotspotsJsonV2['metadata'];
}): HotspotsJsonV2 {
  return {
    schema: 'ug-hotspots',
    version: '2.0',
    surface: args.surface,
    viewBox: args.viewBox,
    background: args.background,
    hotspots: args.hotspots,
    metadata: args.metadata,
  };
}

// v1 / v2 都接受
export type AnyHotspotsJson = HotspotsJsonV1 | HotspotsJsonV2;
