import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchPlayStages } from '../api';
import type { PlayStageListItem } from '../api';
import './DepartureBoardScreen.css';

/**
 * 出發板 — 對應第二章 §6 + 第六章 Part 2 §4
 *
 * 視覺:大廳變暗為背景,前景浮出大型地圖紙(米黃舊紙質感,皺褶/咖啡漬/墨水痕跡),
 * 三類關卡以視覺位置區分:
 * - 主線章節:地圖中央一條主軸,沿線排列章節節點(從 /api/play/stages 動態載入)
 * - 預設小關卡:地圖周邊散布的小別針(教學關卡 + 未來支線)
 * - 隨機地城:地圖角落的「未知區域」標記(G4 開放)
 */

interface CampaignGroup {
  campaignId: string;
  campaignName: string;
  stages: PlayStageListItem[];
}

export function DepartureBoardScreen() {
  const navigate = useNavigate();
  const [stages, setStages] = useState<PlayStageListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPlayStages()
      .then((list) => { if (!cancelled) setStages(list); })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, []);

  // 依戰役分組,沿主軸排章節節點
  const campaigns: CampaignGroup[] = useMemo(() => {
    const groups = new Map<string, CampaignGroup>();
    for (const s of stages ?? []) {
      let g = groups.get(s.campaign_id);
      if (!g) {
        g = { campaignId: s.campaign_id, campaignName: s.campaign_name, stages: [] };
        groups.set(s.campaign_id, g);
      }
      g.stages.push(s);
    }
    return [...groups.values()];
  }, [stages]);

  const enterStage = (stageId: string) => {
    navigate(`/scenario/${stageId}/briefing`);
  };

  return (
    <div className="dep-root">
      {/* 大廳變暗為背景 — §4.2 */}
      <div className="dep-backdrop" aria-hidden />

      <div className="dep-paper">
        <header className="dep-header">
          <h1 className="dep-title">出發板</h1>
          <p className="dep-sub">今夜要去哪裡?</p>
        </header>

        {/* 地圖板主體 — §4.2 米黃舊紙質感 + 皺褶 + 咖啡漬 + 墨水痕跡 */}
        <div className="dep-map">
          {/* 咖啡漬 + 墨水痕跡裝飾 */}
          <div className="map-stain stain-coffee" aria-hidden />
          <div className="map-stain stain-ink-1" aria-hidden />
          <div className="map-stain stain-ink-2" aria-hidden />

          {/* 主線章節 — §4.2 中央主軸沿線排列章節節點(DB 動態) */}
          {stages === null && !loadError && (
            <section className="map-mainline">
              <h2 className="line-label">主線</h2>
              <p className="line-loading">正在攤開地圖……</p>
            </section>
          )}

          {loadError && (
            <section className="map-mainline">
              <h2 className="line-label">主線</h2>
              <p className="line-loading">地圖載入失敗:{loadError}</p>
            </section>
          )}

          {campaigns.map((camp) => (
            <section className="map-mainline" key={camp.campaignId}>
              <h2 className="line-label">主線:{camp.campaignName}</h2>
              <div className="line-rail">
                <div className="line-track" aria-hidden />
                {camp.stages.map((s) => (
                  <button
                    key={s.id}
                    className="line-node"
                    title={s.chapter_name}
                    onClick={() => enterStage(s.id)}
                  >
                    <span className="node-glyph">{'①②③④⑤⑥⑦⑧⑨⑩'[s.chapter_number - 1] ?? s.chapter_number}</span>
                    <span className="node-name">{s.name_zh}</span>
                    <span className="node-tag">{s.scenario_count} 場景</span>
                  </button>
                ))}
              </div>
            </section>
          ))}

          {campaigns.length === 0 && stages !== null && !loadError && (
            <section className="map-mainline">
              <h2 className="line-label">主線</h2>
              <p className="line-loading">(後台尚未發布任何主線關卡)</p>
            </section>
          )}

          {/* 預設小關卡 — §4.2 地圖周邊散布的小別針 */}
          <section className="map-side">
            <h2 className="side-label">支線(小關卡)</h2>
            <div className="pin-area">
              <button
                className="pin pin-active"
                onClick={() => enterStage('test')}
                title="點此進入"
              >
                <span className="pin-head" aria-hidden>📍</span>
                <span className="pin-tooltip">
                  <strong>三地點測試關卡</strong>
                  <br />
                  G1 教學 · 預計 30 分鐘
                  <br />
                  <em>結算:通過/失敗 · 不產生戰役旗標 · 可重玩</em>
                </span>
              </button>

              <div className="pin pin-disabled" title="尚未解鎖">
                <span className="pin-head" aria-hidden>📌</span>
                <span className="pin-tooltip">支線關卡(後台發布後出現)</span>
              </div>
            </div>
          </section>

          {/* 隨機地城 — §4.2 地圖角落「未知區域」 */}
          <section className="map-unknown">
            <div className="unknown-mark" aria-hidden>?</div>
            <div className="unknown-text">
              <h3>未知區域</h3>
              <p>神秘事件 · 異常傳言</p>
              <p className="unknown-state">G4 開放隨機地城</p>
            </div>
          </section>
        </div>

        <footer className="dep-footer">
          <button className="dep-back" onClick={() => navigate('/lobby')}>
            ← 回大廳
          </button>
          <span className="dep-tip">
            主線關卡由後台即時供應;隨機地城在 G4 啟用
          </span>
        </footer>
      </div>
    </div>
  );
}
