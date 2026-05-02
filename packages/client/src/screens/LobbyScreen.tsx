import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalibrationProvider,
  CalibrationSurface,
  CalibrationToolbar,
  CalibrationPanel,
  HandleLayer,
  Hotspot,
  parseHotspotsJson,
  type HotspotClickDetail,
} from '@cthulhu/calibration';
import '@cthulhu/calibration/styles';

import hotspotsJson from '../data/surfaces/study-room/hotspots.json';
import { useCalibrationPermission } from '../admin/useCalibrationPermission';
import './LobbyScreen.css';

/**
 * 遊戲大廳 — 1922 年偵探辦公室書房俯瞰
 * 美術:packages/client/public/surfaces/study-room/bg.webp(1408x800)
 * 熱區:hotspots.json(@cthulhu/calibration v2 schema)
 *
 * 12 個熱區:
 *   prep.ledger / prep.scale / prep.censer / prep.forge /
 *   prep.flask / prep.tomes / prep.parch — 整備七物件
 *   prep.map — 地圖紙(出發)
 *   seat.head / seat.front / seat.left / seat.right — 四椅子
 *
 * 校準:管理員從後台 /admin/calibration 進入,或 URL 加 ?calibrate=1
 */

const SURFACE = 'study-room';

export function LobbyScreen() {
  const navigate = useNavigate();
  const canCalibrate = useCalibrationPermission();
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
      (window as unknown as { __ugCalibrationHandled?: boolean }).__ugCalibrationHandled = true;

      switch (detail.hotspotId) {
        case 'prep.map':
          navigate('/departure');
          break;
        case 'prep.ledger':
        case 'prep.scale':
        case 'prep.censer':
        case 'prep.parch':
          // G2 開放:整備四項可動作
          console.info(`[lobby] ${detail.label} — G2 開放`);
          break;
        case 'prep.forge':
        case 'prep.flask':
        case 'prep.tomes':
          // G2/G3 開放:鍛造/製作/升級
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
        permissionCheck={() => canCalibrate}
      >
        <CalibrationToolbar />
        <CalibrationPanel />

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
          <HandleLayer />
        </CalibrationSurface>

        <footer className="lobby-footer">
          <button className="lobby-back" onClick={() => navigate('/')}>
            ← 回啟動畫面
          </button>
          <span className="lobby-tip">
            G1 視覺骨架 — 整備七功能 / 椅子設定 / 邀請隊友 / 召喚 AI 在 G2 開放
            {canCalibrate && '(管理員可按 Shift+C 進入校準)'}
          </span>
        </footer>
      </CalibrationProvider>
    </div>
  );
}
