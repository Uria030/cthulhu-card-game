import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalibrationProvider,
  CalibrationSurface,
  Hotspot,
  parseHotspotsJson,
  type HotspotClickDetail,
} from '@cthulhu/calibration';
import '@cthulhu/calibration/styles';

import hotspotsJson from '../data/surfaces/study-room/hotspots.json';
import './LobbyScreen.css';

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
