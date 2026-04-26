import { useNavigate } from 'react-router-dom';
import './LobbyScreen.css';

/**
 * 遊戲大廳 — 1920 年代偵探辦公室書房俯瞰
 * 對應第二章 §4-§5 + 第六章 Part 2 §3
 *
 * 視覺骨架:
 * - 中央書桌(深胡桃木)+ 七物件 + 地圖紙(出發)+ 綠罩檯燈
 * - 4 張椅子圍繞書桌(主位 + 三側)
 * - 三面牆:壁爐 + 紀念照牆 + 書櫃/地球儀
 * - 窗外雨景(持續動效)
 *
 * 規則書權威:02_rulebook_ch2.md §1.2(大廳是戰役起點與終點) + §1.6(整備七項)
 */

interface DeskItem {
  id: string;
  glyph: string;
  zh: string;
  desc: string;
  enabled: boolean;
}

// 七整備物件 — 第六章 Part 2 §3.3.2 規格
const DESK_ITEMS: DeskItem[] = [
  { id: 'ledger', glyph: '📒', zh: '帳本', desc: '黑色皮革精裝,金色燙字 — 調整下一關牌組', enabled: false },
  { id: 'scale', glyph: '⚖', zh: '銀色天平', desc: '黃銅天平兩托盤 — 花費經驗值購買/強化', enabled: false },
  { id: 'parch', glyph: '📜', zh: '發黃文件', desc: '紅繩綁住的舊信紙 — 花費天賦點', enabled: false },
  { id: 'censer', glyph: '🪔', zh: '黃銅香爐', desc: '圓肚香爐,煙霧上升 — 花費凝聚力', enabled: false },
  { id: 'forge', glyph: '🔨', zh: '鐵錘砧板', desc: '微縮鐵砧+小鐵錘 — 鍛造(需解鎖)', enabled: false },
  { id: 'flask', glyph: '⚗', zh: '玻璃藥瓶', desc: '三只透明玻璃瓶,不同色液體 — 製作(需解鎖)', enabled: false },
  { id: 'tomes', glyph: '📚', zh: '厚書', desc: '兩三本厚重古籍,書脊金字 — 購買升級版', enabled: false },
];

// 4 張椅子(規則書 1-4 人)— 第六章 Part 2 §3.3.3
const CHAIRS = [
  { id: 'main', label: '主位', occupied: false, position: 'top' },
  { id: 'left', label: '左側', occupied: false, position: 'left' },
  { id: 'right', label: '右側', occupied: false, position: 'right' },
  { id: 'bottom', label: '前位', occupied: false, position: 'bottom' },
];

export function LobbyScreen() {
  const navigate = useNavigate();

  return (
    <div className="lobby-root">
      {/* 窗外雨景(§3.3.7) */}
      <div className="lobby-window" aria-hidden>
        <div className="lobby-rain" />
      </div>

      <div className="lobby-frame">
        <header className="lobby-header">
          <h1 className="lobby-title">書房</h1>
          <p className="lobby-sub">1922 年・新英格蘭・雨夜</p>
        </header>

        <div className="lobby-room">
          {/* 三面牆(背景層) */}
          <aside className="lobby-wall lobby-wall-fireplace">
            <div className="wall-label">壁爐</div>
            <div className="wall-detail">石砌,牆上掛著舊獵槍剪影,火焰跳動 4-5 秒週期</div>
            <div className="fire-glow" aria-hidden />
          </aside>

          <aside className="lobby-wall lobby-wall-memorial">
            <div className="wall-label">紀念照牆</div>
            <div className="wall-detail">
              壁爐上方,1920 年代黑白攝影,木質相框,土黃上光燈
              <br />
              <span className="wall-empty">(殞落者名冊空白 — G6 永久死亡完整流程啟用後寫入)</span>
            </div>
          </aside>

          <aside className="lobby-wall lobby-wall-bookshelf">
            <div className="wall-label">書櫃 與 地球儀</div>
            <div className="wall-detail">
              整面深胡桃木書櫃,書脊顏色多樣(舊紅/墨綠/土黃)
              <br />
              桌邊銅製地球儀緩慢自轉
            </div>
            <div className="globe" aria-hidden>🌐</div>
          </aside>

          {/* 中央:書桌 */}
          <section className="lobby-desk">
            <div className="lamp" aria-hidden title="綠罩檯燈(主光源)" />
            <h2 className="desk-title">書桌</h2>
            <p className="desk-desc">深胡桃木,有縱向木紋 — 桌面散落整備七物件 + 地圖紙</p>

            <div className="desk-items">
              {DESK_ITEMS.map((item) => (
                <button
                  key={item.id}
                  className={'desk-item' + (item.enabled ? '' : ' disabled')}
                  disabled={!item.enabled}
                  title={item.desc}
                >
                  <div className="desk-glyph">{item.glyph}</div>
                  <div className="desk-zh">{item.zh}</div>
                  <div className="desk-state">{item.enabled ? '可用' : 'G2 開放'}</div>
                </button>
              ))}
            </div>

            {/* 地圖紙 — 出發按鈕,第六章 Part 2 §3.3.1 + 第二章 §5.4 */}
            <button
              className="desk-map"
              onClick={() => navigate('/departure')}
              title="點地圖紙 — 出發"
            >
              <div className="map-glyph">🗺</div>
              <div className="map-label">地圖紙</div>
              <div className="map-hint">出發 →</div>
            </button>
          </section>

          {/* 4 張椅子(圍繞書桌) */}
          <div className="chairs-layer">
            {CHAIRS.map((chair) => (
              <button
                key={chair.id}
                className={'chair chair-' + chair.position + (chair.occupied ? ' occupied' : ' empty')}
                disabled
                title={chair.occupied ? `已坐定 — ${chair.label}` : `空椅子 — ${chair.label}(G2 開放:設定調查員/邀請隊友/召喚 AI)`}
              >
                <div className="chair-glyph">🪑</div>
                <div className="chair-label">{chair.label}</div>
                <div className="chair-state">空</div>
              </button>
            ))}
          </div>
        </div>

        <footer className="lobby-footer">
          <button className="lobby-back" onClick={() => navigate('/')}>
            ← 回啟動畫面
          </button>
          <span className="lobby-tip">
            G1 視覺骨架 — 美術完整化在 G8;椅子設定/邀請隊友/召喚 AI/整備七功能在 G2 開放
          </span>
        </footer>
      </div>
    </div>
  );
}
