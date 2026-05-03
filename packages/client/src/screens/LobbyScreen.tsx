import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalibrationProvider,
  CalibrationSurface,
  Hotspot,
  parseHotspotsJson,
  type HotspotClickDetail,
  type HotspotData,
} from '@cthulhu/calibration';
import '@cthulhu/calibration/styles';

import hotspotsJson from '../data/surfaces/study-room/hotspots.json';
import './LobbyScreen.css';

// 熱區幾何中心(SVG 座標)
function hotspotCentroid(hs: HotspotData): { cx: number; cy: number } {
  const g = hs.geometry as { x?: number; y?: number; width?: number; height?: number; cx?: number; cy?: number; points?: { x: number; y: number }[] };
  if (hs.shape === 'rect' && g.x !== undefined && g.y !== undefined && g.width && g.height) {
    return { cx: g.x + g.width / 2, cy: g.y + g.height / 2 };
  }
  if (hs.shape === 'ellipse' && g.cx !== undefined && g.cy !== undefined) {
    return { cx: g.cx, cy: g.cy };
  }
  if (hs.shape === 'polygon' && g.points && g.points.length > 0) {
    const sum = g.points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
    return { cx: sum.x / g.points.length, cy: sum.y / g.points.length };
  }
  return { cx: 0, cy: 0 };
}

// 熱區可見標籤(永久顯示,純視覺,pointer-events:none 不擋熱區點擊)
function HotspotLabel({ hs }: { hs: HotspotData }) {
  const { cx, cy } = hotspotCentroid(hs);
  const label = hs.label;
  const tooltip = hs.tooltip;
  // 估算 badge 寬:label + tooltip 較長那一行 × 字寬
  const longest = Math.max(label.length, tooltip.length);
  const w = Math.max(120, longest * 14 + 24);
  const h = 52;
  return (
    <g pointer-events="none" transform={`translate(${cx - w / 2}, ${cy - h / 2})`}>
      <rect
        x={0} y={0} width={w} height={h}
        rx={4} ry={4}
        fill="rgba(13, 13, 20, 0.85)"
        stroke="rgba(184, 137, 61, 0.9)"
        strokeWidth={1.5}
      />
      <text
        x={w / 2} y={20}
        textAnchor="middle"
        fill="#C9A84C"
        style={{ font: '700 14px "Noto Serif TC", serif', letterSpacing: '0.05em' }}
      >
        {label}
      </text>
      <text
        x={w / 2} y={40}
        textAnchor="middle"
        fill="#E8E4D9"
        style={{ font: '400 12px "Noto Sans TC", sans-serif' }}
      >
        {tooltip}
      </text>
    </g>
  );
}

/**
 * 遊戲大廳 — 1922 年偵探辦公室書房俯瞰
 * 美術:packages/client/public/surfaces/study-room/bg.webp(1408x800)
 * 熱區:hotspots.json(@cthulhu/calibration v2 schema)
 *
 * 玩家側只渲染 Provider + Surface + Hotspot,純展示+點擊事件。
 * 校準工具(Toolbar / Panel / HandleLayer)只存在於系統管理員後台
 * /admin/calibration,玩家側不可進入。
 */

const SURFACE = 'study-room';

export function LobbyScreen() {
  const navigate = useNavigate();
  const { hotspots, viewBox } = useMemo(
    () =>
      parseHotspotsJson(hotspotsJson, {
        fallbackSurface: SURFACE,
        fallbackViewBox: { width: 1408, height: 800 },
      }),
    [],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<HotspotClickDetail>).detail;
      if (detail.surface !== SURFACE) return;

      switch (detail.hotspotId) {
        case 'prep.map':
          navigate('/departure');
          break;
        case 'prep.ledger':
        case 'prep.scale':
        case 'prep.censer':
        case 'prep.parch':
        case 'prep.forge':
        case 'prep.flask':
        case 'prep.tomes':
          console.info(`[lobby] ${detail.label} — G2 開放`);
          break;
        case 'seat.head':
        case 'seat.front':
        case 'seat.left':
        case 'seat.right':
          console.info(`[lobby] 椅子 ${detail.label} — G2 開放(設定調查員/邀請隊友/召喚 AI)`);
          break;
        default:
          console.warn('[lobby] 未處理熱區', detail.hotspotId);
      }
    };
    window.addEventListener('hotspot-click', handler);
    return () => window.removeEventListener('hotspot-click', handler);
  }, [navigate]);

  return (
    <div className="lobby-root">
      <CalibrationProvider
        surface={SURFACE}
        hotspots={hotspots}
        viewBox={viewBox}
        permissionCheck={() => false}
      >
        <header className="lobby-header">
          <h1 className="lobby-title">書房</h1>
          <p className="lobby-sub">1922 年・新英格蘭・雨夜</p>
        </header>

        <CalibrationSurface
          background={{
            src: '/surfaces/study-room/bg.webp',
            alt: '書房俯瞰場景',
          }}
        >
          {hotspots.map((hs) => (
            <Hotspot key={hs.id} {...hs} />
          ))}
          {/* 永久可見的標籤層(pointer-events:none 不擋點擊)*/}
          {hotspots.map((hs) => (
            <HotspotLabel key={`label-${hs.id}`} hs={hs} />
          ))}
        </CalibrationSurface>

        <footer className="lobby-footer">
          <button className="lobby-back" onClick={() => navigate('/')}>
            ← 回啟動畫面
          </button>
          <span className="lobby-tip">
            G1 視覺骨架 — 整備七功能 / 椅子設定 / 邀請隊友 / 召喚 AI 在 G2 開放
          </span>
        </footer>
      </CalibrationProvider>
    </div>
  );
}
