import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './SplashScreen.css';

/**
 * 啟動圖騰 — 對應第二章 §3 + 第六章 Part 2 §2
 *
 * 黑畫面浮現一個古老圖騰(刻在石板上的觸手紋章,舊銀色 + 墨綠微光),
 * 圖騰下方四個字「Unknowable Game」。停留 2.5 秒後自動進入大廳。
 *
 * 不是劇情演示(§7 那是主線章節限定,從出發板進入後才出現)。
 * 啟動畫面只是「氛圍校準」,沒有按鈕、沒有跳過——這 2.5 秒是設計意圖。
 */

const SPLASH_DURATION_MS = 2500;
const FADE_OUT_MS = 500;

export function SplashScreen() {
  const navigate = useNavigate();
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadingOut(true), SPLASH_DURATION_MS);
    const navTimer = setTimeout(() => navigate('/lobby'), SPLASH_DURATION_MS + FADE_OUT_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(navTimer);
    };
  }, [navigate]);

  return (
    <div className={'splash-root' + (fadingOut ? ' fading-out' : '')}>
      {/* 觸手紋章(刻在石板上的浮雕,舊銀色 + 墨綠呼吸微光) */}
      <div className="splash-emblem" aria-label="觸手紋章">
        <svg viewBox="0 0 200 200" width="200" height="200">
          {/* 中央眼狀核心 */}
          <ellipse cx="100" cy="100" rx="14" ry="10" fill="#2D3D2A" opacity="0.7">
            <animate attributeName="opacity" values="0.4;0.9;0.4" dur="1.5s" repeatCount="indefinite" />
          </ellipse>
          <ellipse cx="100" cy="100" rx="6" ry="4" fill="#6E6864" />

          {/* 八支觸手環繞 */}
          {Array.from({ length: 8 }).map((_, i) => {
            const angle = (i * 45 * Math.PI) / 180;
            const x1 = 100 + Math.cos(angle) * 16;
            const y1 = 100 + Math.sin(angle) * 12;
            const cx1 = 100 + Math.cos(angle) * 35;
            const cy1 = 100 + Math.sin(angle) * 35;
            const cx2 = 100 + Math.cos(angle + 0.5) * 60;
            const cy2 = 100 + Math.sin(angle + 0.5) * 60;
            const x2 = 100 + Math.cos(angle + 0.3) * 75;
            const y2 = 100 + Math.sin(angle + 0.3) * 75;
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`}
                stroke="#6E6864"
                strokeWidth="2.5"
                fill="none"
                opacity="0.85"
              />
            );
          })}

          {/* 凹陷縫隙的呼吸微光 */}
          <circle cx="100" cy="100" r="40" fill="none" stroke="#2D3D2A" strokeWidth="0.5" opacity="0.3">
            <animate attributeName="opacity" values="0.15;0.45;0.15" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>

      {/* 標題:Unknowable Game */}
      <h1 className="splash-title">Unknowable Game</h1>
    </div>
  );
}
