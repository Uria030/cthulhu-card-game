import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { runBootPreload, scheduleDeferredGamePreload } from '../game/preload';
import './SplashScreen.css';

/**
 * 啟動圖騰 — 對應第二章 §3 + 第六章 Part 2 §2
 *
 * 黑畫面浮現 The Yellow Sign — Robert W. Chambers《The King in Yellow》的經典符號,
 * 三條螺旋觸手 120° 對稱環繞中心同心圓,亮黃色刻在石板上。
 * 圖騰下方四個字「Unknowable Game」。停留 2.5 秒後自動進入大廳。
 *
 * 不是劇情演示(§7 那是主線章節限定,從出發板進入後才出現)。
 * 啟動畫面只是「氛圍校準」,沒有按鈕、沒有跳過——這 2.5 秒是設計意圖。
 */

// Yellow Sign 三觸手共用 path,其餘兩條用 rotate(120/240) 變換
const TENTACLE_PATH =
  'M 100 86 Q 100 55, 73 50 Q 45 52, 48 80 Q 53 96, 75 90 Q 84 86, 88 80';
const YELLOW = '#F2C415';

// Logo 至少停留一拍,真正離場由必要資源載入完成決定。
const LOADING_REVEAL_MS = 450;
const MIN_SPLASH_DURATION_MS = 1800;
const COMPLETE_HOLD_MS = 350;
const FADE_OUT_MS = 500;

export function SplashScreen() {
  const navigate = useNavigate();
  const [fadingOut, setFadingOut] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadingLabel, setLoadingLabel] = useState('載入中');
  const [loadingSource, setLoadingSource] = useState<'local' | 'server'>('local');
  const [loadingVisible, setLoadingVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const revealTimer = window.setTimeout(() => setLoadingVisible(true), LOADING_REVEAL_MS);
    let fadeTimer = 0;
    let navTimer = 0;
    const minimumDelay = new Promise<void>((resolve) => window.setTimeout(resolve, MIN_SPLASH_DURATION_MS));
    Promise.all([
      runBootPreload((next) => {
        if (cancelled) return;
        setProgress(next.percent);
        setLoadingLabel(next.label);
        setLoadingSource(next.source);
      }),
      minimumDelay,
    ]).then(() => {
      if (cancelled) return;
      setProgress(100);
      setLoadingLabel('準備完成');
      scheduleDeferredGamePreload();
      fadeTimer = window.setTimeout(() => setFadingOut(true), COMPLETE_HOLD_MS);
      navTimer = window.setTimeout(() => navigate('/lobby'), COMPLETE_HOLD_MS + FADE_OUT_MS);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(revealTimer);
      window.clearTimeout(fadeTimer);
      window.clearTimeout(navTimer);
    };
  }, [navigate]);

  return (
    <div className={'splash-root' + (fadingOut ? ' fading-out' : '')}>
      {/* The Yellow Sign(刻在石板上的浮雕,亮黃色) */}
      <div className="splash-emblem" aria-label="The Yellow Sign">
        <svg viewBox="0 0 200 200" width="200" height="200">
          {/* 三條螺旋觸手,120° 對稱 */}
          <g
            fill="none"
            stroke={YELLOW}
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={TENTACLE_PATH} />
            <g transform="rotate(120 100 100)">
              <path d={TENTACLE_PATH} />
            </g>
            <g transform="rotate(240 100 100)">
              <path d={TENTACLE_PATH} />
            </g>
          </g>

          {/* 中心同心圓 */}
          <circle cx="100" cy="100" r="14" fill="none" stroke={YELLOW} strokeWidth="3" />

          {/* 中心呼吸光點(凝視感) */}
          <circle cx="100" cy="100" r="5" fill={YELLOW}>
            <animate
              attributeName="opacity"
              values="0.5;1;0.5"
              dur="1.8s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
      </div>

      <div className={'splash-loading' + (loadingVisible ? ' visible' : '')} aria-live="polite">
        <div className="splash-loading-title">載入中</div>
        <div
          className="splash-progress-track"
          role="progressbar"
          aria-label="遊戲載入進度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div className="splash-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="splash-loading-detail">
          <span>{loadingLabel}</span>
          <span>{progress}% · {loadingSource === 'server' ? '伺服器' : '本機'}</span>
        </div>
      </div>
    </div>
  );
}
