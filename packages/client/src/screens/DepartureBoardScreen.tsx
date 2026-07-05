import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveCampaignStageAccess } from '@cthulhu/shared';
import type { CampaignProgress, CampaignStageAccess } from '@cthulhu/shared';
import { fetchPlayerMe, fetchPlayStages, getPlayerToken } from '../api';
import type { PlayStageListItem } from '../api';
import { getSelectedInvestigator } from '../game/selectedInvestigator';
import { loadStoredCampaignProgressFor, saveStoredCampaignProgressFor } from '../game/campaignProgressStorage';
import { getSelectedSave } from '../game/selectedSave';
import './DepartureBoardScreen.css';

/**
 * 世界地圖選關 — 以阿卡姆(美國新英格蘭)為中心的世界地圖,關卡以地點別針落在地圖上。
 *
 * 美術:目前用 SVG 程式化羊皮地圖(海/陸/經緯線/羅盤 + 阿卡姆中心),
 * 之後可換成委製的「阿卡姆世界地圖」圖檔(同 study-room/bg.webp 模式)。
 * 關卡座標:stage 資料暫無 map_x/map_y,先依索引散布在阿卡姆周邊;補欄位後改讀資料。
 */

const VB_W = 1000;
const VB_H = 620;
const ARKHAM = { x: 470, y: 300 };

// 主線章節在地圖上的暫定落點(阿卡姆周邊;之後由 stage.map_x/map_y 取代)
const MAINLINE_SPOTS = [
  { x: 470, y: 300 }, { x: 545, y: 262 }, { x: 612, y: 312 }, { x: 565, y: 380 },
  { x: 430, y: 372 }, { x: 372, y: 304 }, { x: 408, y: 232 }, { x: 506, y: 200 },
  { x: 648, y: 240 }, { x: 690, y: 356 },
];

export function DepartureBoardScreen() {
  const navigate = useNavigate();
  const [stages, setStages] = useState<PlayStageListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [progressVersion, setProgressVersion] = useState(0);
  const selectedInvestigatorId = getSelectedInvestigator()?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    fetchPlayStages()
      .then((list) => { if (!cancelled) setStages(list); })
      .catch((e: unknown) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const selectedSaveId = getSelectedSave()?.id;
    if (!selectedSaveId || !getPlayerToken()) return;
    let cancelled = false;
    fetchPlayerMe()
      .then((me) => {
        if (cancelled) return;
        const save = me.saves.find((s) => s.id === selectedSaveId && s.status === 'active');
        const progress = save?.campaign_progress as CampaignProgress | undefined;
        if (save && progress?.campaignId) {
          saveStoredCampaignProgressFor(progress.campaignId, save.template_id, progress);
          setProgressVersion((v) => v + 1);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const mainline = useMemo(
    () => (stages ?? [])
      .filter((s) => s.stage_type === 'main' && !s.is_hidden)
      .sort((a, b) =>
        a.campaign_code.localeCompare(b.campaign_code) ||
        a.chapter_number - b.chapter_number ||
        a.code.localeCompare(b.code),
      ),
    [stages],
  );

  const accessByStageId = useMemo(() => {
    const grouped = new Map<string, PlayStageListItem[]>();
    for (const stage of mainline) {
      const list = grouped.get(stage.campaign_id) ?? [];
      list.push(stage);
      grouped.set(stage.campaign_id, list);
    }
    const out = new Map<string, CampaignStageAccess<PlayStageListItem>>();
    for (const [campaignId, list] of grouped) {
      const progress = loadStoredCampaignProgressFor(campaignId, selectedInvestigatorId);
      for (const access of resolveCampaignStageAccess(list, progress)) out.set(access.stage.id, access);
    }
    return out;
  }, [mainline, selectedInvestigatorId, progressVersion]);

  const progressSummary = useMemo(() => {
    const byCampaign = new Map<string, CampaignProgress | null>();
    for (const stage of mainline) {
      if (!byCampaign.has(stage.campaign_id)) {
        byCampaign.set(stage.campaign_id, loadStoredCampaignProgressFor(stage.campaign_id, selectedInvestigatorId));
      }
    }
    const current = mainline.find((s) => accessByStageId.get(s.id)?.isRecommended);
    const progress = current ? byCampaign.get(current.campaign_id) : null;
    if (!selectedInvestigatorId) return '選擇調查員後會顯示戰役進度';
    if (current && progress) return `${current.campaign_name} · 第 ${progress.currentChapterNumber} 章`;
    if (current) return `${current.campaign_name} · 尚未開始`;
    return '尚無可進行主線';
  }, [accessByStageId, mainline, selectedInvestigatorId, progressVersion]);

  const enterStage = (stageId: string) => navigate(`/scenario/${stageId}/briefing`);

  return (
    <div className="wm-root">
      <header className="wm-header">
        <h1 className="wm-title">世界地圖</h1>
        <p className="wm-sub">今夜要去哪裡?</p>
      </header>

      <div className="wm-canvas">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="wm-svg" preserveAspectRatio="xMidYMid slice">
          {/* 海 */}
          <rect x={0} y={0} width={VB_W} height={VB_H} className="wm-sea" />
          {/* 經緯線(世界地圖感)*/}
          <g className="wm-grat">
            {[120, 240, 360, 480, 620, 760, 880].map((x) => (
              <path key={'v' + x} d={`M ${x} 0 Q ${x + (x < 500 ? 18 : -18)} ${VB_H / 2} ${x} ${VB_H}`} />
            ))}
            {[90, 180, 270, 360, 450, 540].map((y) => (
              <path key={'h' + y} d={`M 0 ${y} Q ${VB_W / 2} ${y + (y < 310 ? 14 : -14)} ${VB_W} ${y}`} />
            ))}
          </g>
          {/* 程式化陸塊(新英格蘭海岸 + 周邊;待委製地圖替換)*/}
          <g className="wm-land">
            <path d="M 250 120 C 360 90 470 110 560 150 C 640 185 700 180 760 230 C 800 265 790 330 740 360 C 690 388 640 360 590 392 C 540 422 470 410 410 392 C 350 374 300 392 270 350 C 235 300 250 250 252 210 C 252 175 220 150 250 120 Z" />
            <path d="M 820 150 C 880 140 930 170 940 220 C 948 270 910 300 860 296 C 818 292 800 250 806 210 C 810 180 790 160 820 150 Z" className="wm-land-far" />
            <path d="M 120 420 C 175 405 220 430 232 470 C 242 510 205 540 160 534 C 120 528 96 488 104 452 C 108 432 96 430 120 420 Z" className="wm-land-far" />
          </g>
          {/* 羅盤 */}
          <g className="wm-compass" transform="translate(890 520)">
            <circle r={34} className="wm-compass-ring" />
            <path d="M 0 -30 L 7 0 L 0 30 L -7 0 Z" className="wm-compass-needle" />
            <path d="M -30 0 L 0 -6 L 30 0 L 0 6 Z" className="wm-compass-needle2" />
            <text x={0} y={-40} textAnchor="middle" className="wm-compass-n">N</text>
          </g>

          {/* 阿卡姆 — 中心 */}
          <g transform={`translate(${ARKHAM.x} ${ARKHAM.y})`} className="wm-arkham">
            <circle r={5} className="wm-arkham-dot" />
            <circle r={13} className="wm-arkham-ring" />
            <text x={0} y={-20} textAnchor="middle" className="wm-arkham-label">阿卡姆 ARKHAM</text>
          </g>

          {/* 主線關卡別針 */}
          {mainline.map((s, i) => {
            const spot = MAINLINE_SPOTS[i] ?? { x: 480 + (i % 3) * 60, y: 300 + ((i % 4) - 2) * 50 };
            const access = accessByStageId.get(s.id);
            const locked = access?.state === 'locked';
            const statusLabel = access?.isRecommended
              ? (access.branchMatched ? '分歧' : '下一章')
              : access?.state === 'completed' ? '完成'
                : locked ? '未解鎖' : '可進行';
            return (
              <g key={s.id}
                className={[
                  'wm-pin',
                  access ? `wm-pin-${access.state}` : '',
                  access?.isRecommended ? 'wm-pin-recommended' : '',
                  hover === s.id ? 'wm-pin-hover' : '',
                ].filter(Boolean).join(' ')}
                transform={`translate(${spot.x} ${spot.y})`}
                onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}
                onClick={() => { if (!locked) enterStage(s.id); }}
                onKeyDown={(e) => { if (!locked && (e.key === 'Enter' || e.key === ' ')) enterStage(s.id); }}
                role="button"
                aria-disabled={locked}
                tabIndex={locked ? -1 : 0}>
                <path d="M 0 0 C -12 -22 12 -22 0 0 M 0 -14 a 7 7 0 1 0 0.01 0" className="wm-pin-shape" />
                <circle cx={0} cy={-15} r={4} className="wm-pin-num-bg" />
                <text x={0} y={-12} textAnchor="middle" className="wm-pin-num">{s.chapter_number}</text>
                <text x={0} y={16} textAnchor="middle" className="wm-pin-name">{s.name_zh}</text>
                <text x={0} y={31} textAnchor="middle" className="wm-pin-status">{statusLabel}</text>
              </g>
            );
          })}

          {stages === null && !loadError && <text x={VB_W / 2} y={VB_H / 2} textAnchor="middle" className="wm-loading">正在攤開地圖……</text>}
          {loadError && <text x={VB_W / 2} y={VB_H / 2} textAnchor="middle" className="wm-loading">地圖載入失敗:{loadError}</text>}
        </svg>
      </div>

      <footer className="wm-footer">
        <button className="wm-back" onClick={() => navigate('/lobby')}>← 回大廳</button>
        <span className="wm-tip">{progressSummary}</span>
      </footer>
    </div>
  );
}
