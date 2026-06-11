import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { StageBootstrap } from '@cthulhu/shared';
import { fetchBootstrap } from '../api';
import { getSelectedInvestigator } from '../game/selectedInvestigator';
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
}

const TEST_SCENARIO_BRIEFING: BriefingContent = {
  title: '三地點測試關卡',
  subtitle: 'G1 教學 · 預計 30 分鐘 · 推薦 1 人',
  paragraphs: [
    '雨水順著瓦片滑落,敲在牆上的鐵皮排水槽,發出空洞的聲響。',
    '剛才那封信仍在你口袋裡——「請於今晚到鎮南那條鵝卵石街,找到那家舊書店。我們需要你的眼睛。」',
    '你不認識寄信人。地址沒有店名,只有街角的描述。但你還是來了——你向來如此。',
    '街口的煤氣燈在霧氣裡昏黃地亮著。三條路在你眼前展開:那條陰冷無人的小巷、街尾那扇半掩的書店門、還有遠處被濃霧吞沒的後門。',
    '你深吸一口氣,把領子拉高。今晚要弄清楚,到底是誰——或什麼——在等你。',
  ],
  meta: '結算:通過 / 失敗 · 不產生戰役旗標 · 可重玩',
};

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: '輕鬆',
  standard: '標準',
  hard: '困難',
  expert: '專家',
};

function briefingFromBootstrap(bootstrap: StageBootstrap): BriefingContent {
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
  return {
    title: bootstrap.stage.name_zh,
    subtitle: `${bootstrap.campaign?.name_zh ?? ''} · ${bootstrap.chapter?.name_zh ?? ''} · 難度:${difficulty}`,
    paragraphs: paragraphs.length > 0 ? paragraphs : ['(本關卡尚未填寫前置劇情。)'],
    meta: outcomeCount > 1 ? `本章有 ${outcomeCount} 種結局 · 你的選擇將決定走向` : '',
  };
}

export function ScenarioBriefingScreen() {
  const navigate = useNavigate();
  const { stageId = 'test' } = useParams();
  const isTest = stageId === 'test';

  const [content, setContent] = useState<BriefingContent | null>(
    isTest ? TEST_SCENARIO_BRIEFING : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (isTest) {
      setContent(TEST_SCENARIO_BRIEFING);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setContent(null);
    setLoadError(null);
    fetchBootstrap(stageId, getSelectedInvestigator()?.id)
      .then((b) => { if (!cancelled) setContent(briefingFromBootstrap(b)); })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [stageId, isTest]);

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

            <footer className="brief-footer">
              <button className="brief-back" onClick={() => navigate('/departure')}>
                ← 返回出發板
              </button>
              <button className="brief-enter" onClick={() => navigate(`/scenario/${stageId}`)}>
                進入關卡 →
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
