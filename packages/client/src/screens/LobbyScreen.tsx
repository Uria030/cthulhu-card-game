import { useNavigate } from 'react-router-dom';
import './LobbyScreen.css';

/**
 * 遊戲大廳 — 1920 年代偵探辦公室書房
 * 對應第二章 §4 大廳場景:書桌、椅子、紀念照牆、壁爐、雨景、書櫃
 *
 * G1/G2 階段:佔位視覺骨架。場景以文字描述呈現,點選書桌物件進出發板。
 * 美術完整化 → G8。
 */

interface DeskItem {
  id: string;
  glyph: string;
  zh: string;
  hint: string;
  enabled: boolean;
}

const DESK_ITEMS: DeskItem[] = [
  { id: 'depart', glyph: '✉', zh: '出發板', hint: '今夜要去哪裡?', enabled: true },
  { id: 'ledger', glyph: '📒', zh: '帳本', hint: '調整你的牌組(G2 開放)', enabled: false },
  { id: 'scale', glyph: '⚖', zh: '銀色天平', hint: '花費經驗值(G2 開放)', enabled: false },
  { id: 'parch', glyph: '📜', zh: '發黃文件', hint: '花費天賦點(G2 開放)', enabled: false },
  { id: 'censer', glyph: '🪔', zh: '黃銅香爐', hint: '花費凝聚力(G2 開放)', enabled: false },
  { id: 'forge', glyph: '🔨', zh: '鐵錘砧板', hint: '鍛造(G2 開放)', enabled: false },
  { id: 'flask', glyph: '⚗', zh: '玻璃藥瓶', hint: '製作(G2 開放)', enabled: false },
];

export function LobbyScreen() {
  const navigate = useNavigate();

  const handleClick = (item: DeskItem) => {
    if (!item.enabled) return;
    if (item.id === 'depart') navigate('/departure');
  };

  return (
    <div className="lobby-root">
      <div className="lobby-rain" aria-hidden />
      <div className="lobby-frame">
        <header className="lobby-header">
          <h1 className="lobby-title">書房</h1>
          <p className="lobby-sub">1922 年・新英格蘭・雨夜</p>
        </header>

        <section className="lobby-walls">
          <div className="lobby-wall lobby-wall-fireplace">
            <div className="wall-label">壁爐</div>
            <div className="wall-detail">火光在牆上跳動,把舊紙照得溫暖</div>
          </div>
          <div className="lobby-wall lobby-wall-memorial">
            <div className="wall-label">紀念照牆</div>
            <div className="wall-detail">尚無照片(殞落者名冊空白)</div>
          </div>
          <div className="lobby-wall lobby-wall-bookshelf">
            <div className="wall-label">書櫃</div>
            <div className="wall-detail">書脊上覆蓋著薄塵,有些書名已不可辨識</div>
          </div>
        </section>

        <section className="lobby-desk">
          <h2 className="desk-title">書桌</h2>
          <div className="desk-items">
            {DESK_ITEMS.map((item) => (
              <button
                key={item.id}
                className={'desk-item' + (item.enabled ? '' : ' disabled')}
                onClick={() => handleClick(item)}
                disabled={!item.enabled}
                title={item.hint}
              >
                <div className="desk-glyph">{item.glyph}</div>
                <div className="desk-zh">{item.zh}</div>
                <div className="desk-hint">{item.hint}</div>
              </button>
            ))}
          </div>
        </section>

        <footer className="lobby-footer">
          <button className="lobby-back" onClick={() => navigate('/')}>
            ← 回啟動畫面
          </button>
        </footer>
      </div>
    </div>
  );
}
