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
import { fetchPlayInvestigators } from '../api';
import type { PlayInvestigator } from '../api';
import {
  getSelectedInvestigator,
  setSelectedInvestigator,
} from '../game/selectedInvestigator';
import { setPartyTemplateIds } from '../game/selectedParty';
import { displayNameFor } from '../game/displayName';
import './LobbyScreen.css';

const SURFACE = 'study-room';
const SEAT_ORDER = ['seat.head', 'seat.front', 'seat.left', 'seat.right'];

const ATTR_LABELS: Array<[keyof PlayInvestigator, string]> = [
  ['attr_strength', '力量'],
  ['attr_agility', '敏捷'],
  ['attr_constitution', '體魄'],
  ['attr_reflex', '反應'],
  ['attr_intellect', '智識'],
  ['attr_willpower', '意志'],
  ['attr_perception', '感知'],
  ['attr_charisma', '魅力'],
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

function factionKey(inv: PlayInvestigator): string {
  return String(inv.faction_code || inv.mbti_code?.[0] || '?').toUpperCase();
}

export function LobbyScreen() {
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<PlayInvestigator[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [selected, setSelected] = useState(getSelectedInvestigator());
  const [partySeed, setPartySeed] = useState(0);

  useEffect(() => {
    if (candidates !== null) return;
    fetchPlayInvestigators({ includeDraft: true })
      .then(setCandidates)
      .catch((e: unknown) => setPickerError(e instanceof Error ? e.message : String(e)));
  }, [candidates]);

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

  const candidatesByFaction = useMemo(() => {
    const groups = new Map<string, PlayInvestigator[]>();
    for (const inv of candidates ?? []) {
      const key = factionKey(inv);
      groups.set(key, [...(groups.get(key) ?? []), inv]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [candidates]);

  useEffect(() => {
    if (partyMembers.length === 3) {
      setPartyTemplateIds(partyMembers.map((inv) => inv.id));
    }
  }, [partyMembers]);

  const pickInvestigator = (inv: PlayInvestigator) => {
    const sel = {
      id: inv.id,
      name_zh: inv.name_zh,
      title_zh: inv.title_zh,
      mbti_code: inv.mbti_code,
      faction_code: inv.faction_code,
      is_completed: inv.is_completed,
    };
    setSelectedInvestigator(sel);
    setSelected(sel);
    setPartySeed(0);
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
          console.info(`[lobby] ${detail.label} is reserved for G2`);
          break;
        default:
          break;
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
          <h1 className="lobby-title">大廳</h1>
          <p className="lobby-sub">選擇調查員與短期測試隊伍</p>
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
              <HotspotLabel hs={hs} />
            </g>
          ))}
          {SEAT_ORDER.map((seatId, i) => {
            const member = i === 0
              ? (selected ? { name: displayNameFor(selected) } : null)
              : (partyMembers[i - 1] ? { name: displayNameFor(partyMembers[i - 1]) } : null);
            if (!member) return null;
            const hs = hotspots.find((h) => h.id === seatId);
            if (!hs) return null;
            const { cx, cy } = hotspotCentroid(hs);
            return (
              <g key={seatId} className="seat-occupant" transform={`translate(${cx}, ${cy})`} pointerEvents="none">
                <ellipse cx={0} cy={-22} rx={22} ry={26} fill="rgba(8,8,14,0.6)" />
                <path d="M -40 58 Q -34 -6 0 -6 Q 34 -6 40 58 Z" fill="rgba(8,8,14,0.6)" />
                <text x={0} y={80} textAnchor="middle" fill="#C9A84C" style={{ font: '700 14px "Noto Serif TC", serif', paintOrder: 'stroke', stroke: 'rgba(13,13,20,0.92)', strokeWidth: 4 }}>{member.name}</text>
              </g>
            );
          })}
        </CalibrationSurface>

        <div className="lobby-roster">
          <div className="lr-title">調查隊</div>
          <button className="lr-slot lr-me" onClick={() => setPickerOpen(true)}>
            <span className="lr-role">我</span>
            <span className="lr-name">{displayNameFor(selected, '選擇調查員')}</span>
            {selectedCandidate?.is_completed === false && <span className="lr-meta">草稿</span>}
          </button>

          <div className="lr-party-shelf">
            {[0, 1, 2].map((i) => {
              const member = partyMembers[i];
              return (
                <div key={i} className="lr-slot lr-ai">
                  <span className="lr-role">AI {i + 1}</span>
                  <span className="lr-name">{displayNameFor(member, '等待組隊')}</span>
                  {member && <span className="lr-meta">{member.faction_code} / {member.title_zh ?? member.mbti_code}</span>}
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
          {autoParty?.relaxed && <div className="lr-note">已放寬條件: {autoParty.reasons.join(', ')}</div>}
        </div>

        <footer className="lobby-footer">
          <button className="lobby-back" onClick={() => navigate('/')}>
            返回
          </button>
          <span className="lobby-tip">前往地圖開始關卡，隊伍會自動帶入戰鬥板。</span>
        </footer>

        {pickerOpen && (
          <div
            className="inv-picker-backdrop"
            onClick={(e) => { if (e.target === e.currentTarget) setPickerOpen(false); }}
          >
            <div className="inv-picker-frame">
              <button className="inv-picker-close" onClick={() => setPickerOpen(false)}>×</button>
              <div className="inv-picker-title">選擇調查員</div>
              <div className="inv-picker-sub">64 位 preset 皆可選用；草稿會以 crossTest 模式開局。</div>

              {pickerError && <div className="inv-picker-error">名單載入失敗: {pickerError}</div>}
              {!pickerError && candidates === null && <div className="inv-picker-loading">載入調查員名單...</div>}
              {candidates !== null && candidates.length === 0 && (
                <div className="inv-picker-loading">目前沒有可選調查員。</div>
              )}

              <div className="inv-picker-groups">
                {candidatesByFaction.map(([faction, list]) => (
                  <section key={faction} className="inv-picker-group">
                    <div className="inv-picker-group-title">{faction}</div>
                    <div className="inv-picker-grid">
                      {list.map((inv) => (
                        <button
                          key={inv.id}
                          className={'inv-card' + (selected?.id === inv.id ? ' inv-card-selected' : '')}
                          onClick={() => pickInvestigator(inv)}
                        >
                          <div className="inv-card-name">
                            {displayNameFor(inv)}
                            {inv.is_completed === false && <span className="inv-draft-pill">草稿</span>}
                          </div>
                          <div className="inv-card-meta">{inv.mbti_code} / {inv.title_zh ?? inv.faction_code}</div>
                          {inv.ability_text_zh && <div className="inv-card-ability">{inv.ability_text_zh}</div>}
                          <div className="inv-card-attrs">
                            {ATTR_LABELS.map(([key, label]) => (
                              <span key={key} className="inv-attr">
                                {label} {Number(inv[key] ?? 0)}
                              </span>
                            ))}
                          </div>
                          {selected?.id === inv.id && <div className="inv-card-badge">使用中</div>}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        )}
      </CalibrationProvider>
    </div>
  );
}
