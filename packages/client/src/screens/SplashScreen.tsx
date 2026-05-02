import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

// 第六章 Part 1 §6.2:啟動圖騰 2.5 秒,§2.3 淡出 0.5 秒
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

      {/* 標題:Unknowable Game */}
      <h1 className="splash-title">Unknowable Game</h1>
    </div>
  );
}
