import { useEffect, useMemo, useState } from 'react';
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
import { fetchPlayInvestigators } from '../api';
import type { PlayInvestigator } from '../api';
import {
  getSelectedInvestigator,
  setSelectedInvestigator,
} from '../game/selectedInvestigator';
import './LobbyScreen.css';

const ATTR_LABELS: Array<[keyof PlayInvestigator, string]> = [
  ['attr_strength', '力量'],
  ['attr_agility', '敏捷'],
  ['attr_constitution', '體質'],
  ['attr_reflex', '反應'],
  ['attr_intellect', '智力'],
  ['attr_willpower', '意志'],
  ['attr_perception', '感知'],
  ['attr_charisma', '魅力'],
];

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

// 熱區可見標籤(文字直接浮在熱區形狀上,背景由熱區形狀本身上色 — CSS 覆蓋)
function HotspotLabel({ hs }: { hs: HotspotData }) {
  const { cx, cy } = hotspotCentroid(hs);
  return (
    <g pointer-events="none" className="hotspot-label-group" transform={`translate(${cx}, ${cy})`}>
      <text
        x={0} y={-4}
        textAnchor="middle"
        fill="#C9A84C"
        style={{ font: '700 14px "Noto Serif TC", serif', letterSpacing: '0.05em', paintOrder: 'stroke', stroke: 'rgba(13,13,20,0.9)', strokeWidth: 3 }}
      >
        {hs.label}
      </text>
      <text
        x={0} y={16}
        textAnchor="middle"
        fill="#E8E4D9"
        style={{ font: '400 12px "Noto Sans TC", sans-serif', paintOrder: 'stroke', stroke: 'rgba(13,13,20,0.9)', strokeWidth: 3 }}
      >
        {hs.tooltip}
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<PlayInvestigator[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [selected, setSelected] = useState(getSelectedInvestigator());

  // 開面板時才撈候選名單(設計完成的調查員)
  useEffect(() => {
    if (!pickerOpen || candidates !== null) return;
    fetchPlayInvestigators()
      .then(setCandidates)
      .catch((e: unknown) => setPickerError(e instanceof Error ? e.message : String(e)));
  }, [pickerOpen, candidates]);

  const pickInvestigator = (inv: PlayInvestigator) => {
    const sel = {
      id: inv.id,
      name_zh: inv.name_zh,
      mbti_code: inv.mbti_code,
      faction_code: inv.faction_code,
    };
    setSelectedInvestigator(sel);
    setSelected(sel);
    setPickerOpen(false);
  };

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
          // 椅子取消點擊(改由左上組隊名單管理;椅上只放「在席人形影子」意象)
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
          {/* 熱區 + 標籤成對包在 wrapper g,讓 hover 能同步觸發兩者顯示 */}
          {hotspots.map((hs) => (
            <g key={hs.id} className="hotspot-wrap">
              <Hotspot {...hs} />
              <HotspotLabel hs={hs} />
            </g>
          ))}
        </CalibrationSurface>

        <footer className="lobby-footer">
          <button className="lobby-back" onClick={() => navigate('/')}>
            ← 回啟動畫面
          </button>
          <button className="lobby-investigator-chip" onClick={() => setPickerOpen(true)}>
            {selected ? `🕵 ${selected.name_zh}(${selected.mbti_code ?? ''})` : '🕵 點椅子選擇調查員'}
          </button>
          <span className="lobby-tip">
            整備七功能 / 邀請隊友 / 召喚 AI 在 G2 開放
          </span>
        </footer>

        {pickerOpen && (
          <div
            className="inv-picker-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) setPickerOpen(false); }}
          >
            <div className="inv-picker-frame">
              <button className="inv-picker-close" onClick={() => setPickerOpen(false)}>✕</button>
              <div className="inv-picker-title">❖ 選擇你的調查員 ❖</div>
              <div className="inv-picker-sub">只列出設計完成的調查員;選定後出發板與關卡都會帶上這位。</div>

              {pickerError && <div className="inv-picker-error">名單載入失敗:{pickerError}</div>}
              {!pickerError && candidates === null && <div className="inv-picker-loading">翻閱人事檔案……</div>}
              {candidates !== null && candidates.length === 0 && (
                <div className="inv-picker-loading">(後台尚無設計完成的調查員)</div>
              )}

              <div className="inv-picker-grid">
                {(candidates ?? []).map((inv) => (
                  <button
                    key={inv.id}
                    className={'inv-card' + (selected?.id === inv.id ? ' inv-card-selected' : '')}
                    onClick={() => pickInvestigator(inv)}
                  >
                    <div className="inv-card-name">{inv.name_zh}</div>
                    <div className="inv-card-meta">{inv.mbti_code} · {inv.title_zh ?? inv.faction_code}</div>
                    {inv.ability_text_zh && <div className="inv-card-ability">{inv.ability_text_zh}</div>}
                    <div className="inv-card-attrs">
                      {ATTR_LABELS.map(([key, label]) => (
                        <span key={key} className="inv-attr">
                          {label} {Number(inv[key] ?? 0)}
                        </span>
                      ))}
                    </div>
                    {selected?.id === inv.id && <div className="inv-card-badge">✓ 目前選用</div>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </CalibrationProvider>
    </div>
  );
}
