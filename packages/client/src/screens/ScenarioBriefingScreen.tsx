import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { StageBootstrap } from '@cthulhu/shared';
import type { CampaignProgress, ChapterResultRecord } from '@cthulhu/shared';
import { fetchBootstrap, fetchPlayerMe, getPlayerToken } from '../api';
import { getSelectedInvestigator } from '../game/selectedInvestigator';
import { loadStoredCampaignProgressFromBootstrap, saveStoredCampaignProgressFor } from '../game/campaignProgressStorage';
import { getSelectedSave } from '../game/selectedSave';
import './ScenarioBriefingScreen.css';

/**
 * 劇情提要 — 出發板與戰鬥板之間的橋接畫面
 *
 * 顯示關卡的前置劇情敘事,讓玩家進入戰鬥前先建立氛圍。
 * /scenario/test/briefing 用教學寫死文字;
 * /scenario/:stageId/briefing 打 /api/play bootstrap(同時暖快取,進戰鬥板不重打)。
 *
 * 流程:出發板選關 → 本畫面 → 「進入關卡」→ 戰鬥板
 */

interface BriefingContent {
  title: string;
  subtitle: string;
  paragraphs: string[];
  meta: string;
  branchMeta?: string;
  locked?: boolean;
}

const RETIRED_TEST_SCENARIO_BRIEFING: BriefingContent = {
  title: '三地點測試關卡已下架',
  subtitle: '請改從世界地圖選擇「雨夜的真相」',
  paragraphs: [
    '這個早期教學關卡已被「雨夜的真相」取代,目前不再從世界地圖開放。',
    '舊連結仍會停在此頁,避免進入已下架測試內容。',
  ],
  meta: '狀態:已下架',
  locked: true,
};

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: '輕鬆',
  standard: '標準',
  hard: '困難',
  expert: '專家',
};

function chapterNumberFromBootstrap(bootstrap: StageBootstrap): number {
  const n = Number(bootstrap.chapter?.chapter_number ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function previousChapterResult(
  progress: CampaignProgress | null | undefined,
  chapterNumber: number,
): ChapterResultRecord | undefined {
  return progress?.chapterResults?.[String(chapterNumber - 1)];
}

function briefingFromBootstrap(bootstrap: StageBootstrap, progress: CampaignProgress | null = null): BriefingContent {
  // 戰役封面敘事 + 關卡敘事都切段顯示(空行/換行都當段落界)
  const text = [bootstrap.campaign?.cover_narrative, bootstrap.stage.narrative]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join('\n');
  const paragraphs = text
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const difficulty = DIFFICULTY_LABEL[String(bootstrap.campaign?.difficulty_tier ?? '')] ?? '標準';
  const outcomeCount = bootstrap.chapter?.outcomes?.length ?? 0;
  const chapterNumber = chapterNumberFromBootstrap(bootstrap);
  const prevResult = previousChapterResult(progress, chapterNumber);
  const currentChapterNumber = progress?.currentChapterNumber ?? 1;
  const locked = chapterNumber > currentChapterNumber;
  const meta = [
    outcomeCount > 1 ? `本章有 ${outcomeCount} 種結局` : '',
    locked ? '尚未解鎖' : '',
  ].filter(Boolean).join(' · ');
  return {
    title: bootstrap.stage.name_zh,
    subtitle: `${bootstrap.campaign?.name_zh ?? ''} · ${bootstrap.chapter?.name_zh ?? ''} · 難度:${difficulty}`,
    paragraphs: paragraphs.length > 0 ? paragraphs : ['(本關卡尚未填寫前置劇情。)'],
    meta,
    branchMeta: prevResult
      ? `上一章結局 ${prevResult.outcomeCode}${prevResult.nextChapterVersion ? ` · 分歧:${prevResult.nextChapterVersion}` : ''}`
      : undefined,
    locked,
  };
}

export function ScenarioBriefingScreen() {
  const navigate = useNavigate();
  const { stageId = 'test' } = useParams();
  const isTest = stageId === 'test';

  const [content, setContent] = useState<BriefingContent | null>(
    isTest ? RETIRED_TEST_SCENARIO_BRIEFING : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (isTest) {
      setContent(RETIRED_TEST_SCENARIO_BRIEFING);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setContent(null);
    setLoadError(null);
    const selectedInvestigator = getSelectedInvestigator();
    if (!selectedInvestigator) {
      navigate('/lobby', { replace: true });
      return;
    }
    fetchBootstrap(stageId, selectedInvestigator?.id, { crossTest: selectedInvestigator?.is_completed === false })
      .then(async (b) => {
        let progress = loadStoredCampaignProgressFromBootstrap(b);
        const selectedSaveId = getSelectedSave()?.id;
        if (selectedSaveId && getPlayerToken()) {
          try {
            const me = await fetchPlayerMe();
            const save = me.saves.find((s) => s.id === selectedSaveId && s.status === 'active');
            const serverProgress = save?.campaign_progress as CampaignProgress | undefined;
            if (save && serverProgress?.campaignId) {
              saveStoredCampaignProgressFor(serverProgress.campaignId, save.template_id, serverProgress);
              progress = serverProgress;
            }
          } catch {
            // Fall back to local progress; briefing remains usable while offline.
          }
        }
        if (!cancelled) setContent(briefingFromBootstrap(b, progress));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [stageId, isTest, navigate]);

  return (
    <div className="brief-root">
      <div className="brief-backdrop" aria-hidden />
      <div className="brief-paper">
        {loadError && (
          <>
            <header className="brief-header">
              <div className="brief-eyebrow">前置劇情</div>
              <h1 className="brief-title">載入失敗</h1>
              <p className="brief-subtitle">{loadError}</p>
            </header>
            <footer className="brief-footer">
              <button className="brief-back" onClick={() => navigate('/departure')}>
                ← 返回出發板
              </button>
            </footer>
          </>
        )}

        {!loadError && !content && (
          <header className="brief-header">
            <div className="brief-eyebrow">前置劇情</div>
            <h1 className="brief-title">翻開卷宗……</h1>
          </header>
        )}

        {!loadError && content && (
          <>
            <header className="brief-header">
              <div className="brief-eyebrow">前置劇情</div>
              <h1 className="brief-title">{content.title}</h1>
              <p className="brief-subtitle">{content.subtitle}</p>
            </header>

            <hr className="brief-divider" />

            <div className="brief-narrative">
              {content.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>

            <hr className="brief-divider" />

            {content.meta && <div className="brief-meta">{content.meta}</div>}
            {content.branchMeta && <div className="brief-branch">{content.branchMeta}</div>}

            <footer className="brief-footer">
              <button className="brief-back" onClick={() => navigate('/departure')}>
                ← 返回出發板
              </button>
              <button
                className="brief-enter"
                disabled={content.locked}
                onClick={() => navigate(`/scenario/${stageId}`)}
              >
                {content.locked ? (isTest ? '此關卡已下架' : '尚未解鎖') : '進入關卡 →'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
