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

import { autoComposeParty } from '@cthulhu/shared';
import hotspotsJson from '../data/surfaces/study-room/hotspots.json';
import {
  fetchPlayerMe,
  fetchPlayInvestigators,
  getPlayerToken,
} from '../api';
import type { PlayInvestigator, PlayerSave } from '../api';
import {
  getSelectedInvestigator,
  setSelectedInvestigator,
} from '../game/selectedInvestigator';
import { getSelectedSave } from '../game/selectedSave';
import { setPartyTemplateIds } from '../game/selectedParty';
import { displayNameFor } from '../game/displayName';
import { playablePresetInvestigators } from '../game/investigatorRoster';
import './LobbyScreen.css';

const SURFACE = 'study-room';
const SEAT_ORDER = ['seat.left', 'seat.head', 'seat.right', 'seat.front'];
const SEAT_ASSETS = [
  '/game-art/lobby-seats/seat-player.png',
  '/game-art/lobby-seats/seat-companion-head.png',
  '/game-art/lobby-seats/seat-companion-right.png',
  '/game-art/lobby-seats/seat-companion-front.png',
];
const SEAT_BOXES = [
  { x: -92, y: -170, width: 184, height: 242 },
  { x: -68, y: -120, width: 136, height: 170 },
  { x: -72, y: -126, width: 144, height: 180 },
  { x: -104, y: -184, width: 208, height: 270 },
];

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

function HotspotLabel({ hs }: { hs: HotspotData }) {
  const { cx, cy } = hotspotCentroid(hs);
  return (
    <g pointerEvents="none" className="hotspot-label-group" transform={`translate(${cx}, ${cy})`}>
      <text
        x={0}
        y={-4}
        textAnchor="middle"
        fill="#C9A84C"
        style={{ font: '700 14px "Noto Serif TC", serif', letterSpacing: '0.05em', paintOrder: 'stroke', stroke: 'rgba(13,13,20,0.9)', strokeWidth: 3 }}
      >
        {hs.label}
      </text>
      <text
        x={0}
        y={16}
        textAnchor="middle"
        fill="#E8E4D9"
        style={{ font: '400 12px "Noto Sans TC", sans-serif', paintOrder: 'stroke', stroke: 'rgba(13,13,20,0.9)', strokeWidth: 3 }}
      >
        {hs.tooltip}
      </text>
    </g>
  );
}

function selectedFromSave(save: PlayerSave) {
  return {
    id: save.template_id,
    name_zh: save.name_zh,
    title_zh: save.title_zh,
    mbti_code: save.mbti_code,
    faction_code: save.faction_code,
    is_completed: save.is_completed,
  };
}

export function LobbyScreen() {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<PlayInvestigator[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [selected, setSelected] = useState(getSelectedInvestigator());
  const [partySeed, setPartySeed] = useState(0);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!authChecked || !selected || candidates !== null) return;
    fetchPlayInvestigators({ includeDraft: true })
      .then((rows) => setCandidates(playablePresetInvestigators(rows)))
      .catch((e: unknown) => setPickerError(e instanceof Error ? e.message : String(e)));
  }, [authChecked, candidates, selected]);

  useEffect(() => {
    let cancelled = false;
    if (!getPlayerToken()) {
      navigate('/saves', { replace: true });
      return;
    }
    fetchPlayerMe()
      .then((me) => {
        if (cancelled) return;
        const selectedSaveId = getSelectedSave()?.id;
        const active = me.saves.find((s) => s.status === 'active' && s.id === selectedSaveId) ?? null;
        if (!active) {
          navigate('/saves', { replace: true });
          return;
        }
        const sel = selectedFromSave(active);
        setSelectedInvestigator(sel);
        setSelected(sel);
      })
      .catch(() => {
        if (!cancelled) navigate('/saves', { replace: true });
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => { cancelled = true; };
  }, [navigate]);

  const selectedCandidate = useMemo(
    () => candidates?.find((inv) => inv.id === selected?.id) ?? null,
    [candidates, selected?.id],
  );

  const autoParty = useMemo(
    () => selectedCandidate && candidates
      ? autoComposeParty(selectedCandidate, candidates, partySeed)
      : null,
    [selectedCandidate, candidates, partySeed],
  );
  const partyMembers = autoParty?.members ?? [];

  useEffect(() => {
    if (partyMembers.length === 3) {
      setPartyTemplateIds(partyMembers.map((inv) => inv.id));
    }
  }, [partyMembers]);


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
          console.info(`[lobby] ${detail.label} is reserved for G2`);
          break;
        default:
          break;
      }
    };
    window.addEventListener('hotspot-click', handler);
    return () => window.removeEventListener('hotspot-click', handler);
  }, [navigate]);

  if (!authChecked) {
    return (
      <div className="lobby-root">
        <div className="lobby-auth-panel">
          <div className="lobby-auth-title">讀取帳號</div>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby-root">
      <CalibrationProvider
        surface={SURFACE}
        hotspots={hotspots}
        viewBox={viewBox}
        permissionCheck={() => false}
      >
        <header className="lobby-header">
          <h1 className="lobby-title">大廳</h1>
          <p className="lobby-sub">四人調查隊伍</p>
        </header>

        <CalibrationSurface
          background={{
            src: '/surfaces/study-room/bg.webp',
            alt: '大廳書房背景',
          }}
        >
          {hotspots.map((hs) => (
            <g key={hs.id} className="hotspot-wrap">
              <Hotspot {...hs} />
              {hs.id === 'prep.map' && <HotspotLabel hs={hs} />}
            </g>
          ))}
          {SEAT_ORDER.map((seatId, i) => {
            const member = i === 0
              ? (selected ? { name: '玩家' } : null)
              : (partyMembers[i - 1] ? { name: displayNameFor(partyMembers[i - 1]) } : null);
            if (!member) return null;
            const hs = hotspots.find((h) => h.id === seatId);
            if (!hs) return null;
            const { cx, cy } = hotspotCentroid(hs);
            const box = SEAT_BOXES[i];
            return (
              <g key={seatId} className={`seat-occupant seat-occupant-${i + 1}`} transform={`translate(${cx}, ${cy})`} pointerEvents="none">
                <image className="seat-figure" href={SEAT_ASSETS[i]} {...box} preserveAspectRatio="xMidYMax meet" />
                <text x={0} y={86} textAnchor="middle" fill="#F0D48A" style={{ font: '700 14px "Noto Serif TC", serif', paintOrder: 'stroke', stroke: 'rgba(13,13,20,0.95)', strokeWidth: 4 }}>{member.name}</text>
              </g>
            );
          })}
        </CalibrationSurface>

        <div className="lobby-roster">
          <div className="lr-title">調查隊伍</div>
          <div className="lr-slot lr-player-slot">
            <span className="lr-role">玩家</span>
            <span className="lr-name">{displayNameFor(selected, '尚未選擇存檔')}</span>
          </div>
          <div className="lr-party-shelf">
            {[0, 1, 2].map((i) => {
              const member = partyMembers[i];
              return (
                <div key={i} className="lr-slot lr-ai">
                  <span className="lr-role">隊友 {i + 1}</span>
                  <span className="lr-name">{displayNameFor(member, '等待組隊')}</span>
                </div>
              );
            })}
          </div>

          <button
            className="lr-reroll"
            disabled={!selectedCandidate || (candidates?.length ?? 0) < 4}
            onClick={() => setPartySeed((v) => v + 1)}
          >
            換一組
          </button>
          <button className="lr-manage-saves" onClick={() => navigate('/saves')}>管理調查員存檔</button>
          {pickerError && <div className="lr-note">名冊載入失敗:{pickerError}</div>}
        </div>

        <footer className="lobby-footer">
          <button className="lobby-back" onClick={() => navigate('/saves')}>
            返回存檔
          </button>
          <span className="lobby-tip">前往地圖開始關卡，隊伍會自動帶入戰鬥板。</span>
        </footer>

      </CalibrationProvider>
    </div>
  );
}
