import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './SplashScreen.css';

/**
 * 啟動圖騰 + 開場敘事
 * 對應第二章 §3 啟動圖騰、§7 劇情演示(打字機式逐字浮現)
 *
 * G1 階段:極簡視覺骨架。文字會逐行浮現,完成後可點「進入大廳」。
 */
const NARRATIVE_LINES = [
  '一九二二年,新英格蘭。',
  '雨夜的書房裡,壁爐火光映在發黃的舊照片上。',
  '某個你以為已經結束的調查,留下了無法閉上的縫隙。',
  '在你還沒準備好之前,牆上的紀念照已經開始低語。',
];

export function SplashScreen() {
  const navigate = useNavigate();
  const [revealed, setRevealed] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (revealed >= NARRATIVE_LINES.length) {
      setDone(true);
      return;
    }
    const timer = setTimeout(() => setRevealed((n) => n + 1), 1800);
    return () => clearTimeout(timer);
  }, [revealed]);

  return (
    <div className="splash-root">
      <div className="splash-emblem fade-in">𓂀</div>
      <div className="splash-narrative">
        {NARRATIVE_LINES.slice(0, revealed).map((line, i) => (
          <p key={i} className="splash-line fade-in">
            {line}
          </p>
        ))}
      </div>
      {done && (
        <button
          className="splash-enter fade-in"
          onClick={() => navigate('/lobby')}
        >
          推開書房的門
        </button>
      )}
      {!done && (
        <button
          className="splash-skip"
          onClick={() => {
            setRevealed(NARRATIVE_LINES.length);
            setDone(true);
          }}
        >
          跳過
        </button>
      )}
    </div>
  );
}
