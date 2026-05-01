import { useNavigate } from 'react-router-dom';
import './LobbyScreen.css';

/**
 * 遊戲大廳 — 1920 年代偵探辦公室書房俯瞰
 * 美術:Gemini 生成圖 lobby-bg.png(/images/lobby-bg.png)
 *
 * 視覺骨架(全部疊在背景圖上,absolute % 定位):
 * - 中央書桌(圖內已含)+ 七物件 + 地圖紙(出發)+ 綠罩檯燈(圖內已含)
 * - 四張椅子在桌子四邊:主位(後)/ 前位(前)/ 左 / 右(地圖右邊)
 * - 三面牆(壁爐 / 紀念照牆 / 書櫃地球儀)圖內已含,不再用 CSS 拼
 *
 * 規則書權威:02_rulebook_ch2.md §1.2(大廳是戰役起點與終點) + §1.6(整備七項)
 */

interface DeskItem {
  id: string;
  glyph: string;
  zh: string;
  desc: string;
  enabled: boolean;
  /** 在背景圖上的 % 定位(left/top) */
  pos: { left: string; top: string };
}

// 七整備物件 — 第六章 Part 2 §3.3.2 規格
// 位置對應背景圖桌面物件
const DESK_ITEMS: DeskItem[] = [
  { id: 'ledger', glyph: '📒', zh: '帳本',     desc: '黑色皮革精裝,金色燙字 — 調整下一關牌組',  enabled: false, pos: { left: '24%', top: '70%' } },
  { id: 'scale',  glyph: '⚖',  zh: '銀色天平', desc: '黃銅天平兩托盤 — 花費經驗值購買/強化',     enabled: false, pos: { left: '34%', top: '57%' } },
  { id: 'parch',  glyph: '📜', zh: '發黃文件', desc: '紅繩綁住的舊信紙 — 花費天賦點',            enabled: false, pos: { left: '44%', top: '72%' } },
  { id: 'censer', glyph: '🪔', zh: '黃銅香爐', desc: '圓肚香爐,煙霧上升 — 花費凝聚力',          enabled: false, pos: { left: '40%', top: '55%' } },
  { id: 'forge',  glyph: '🔨', zh: '鐵錘砧板', desc: '微縮鐵砧+小鐵錘 — 鍛造(需解鎖)',         enabled: false, pos: { left: '52%', top: '60%' } },
  { id: 'flask',  glyph: '⚗',  zh: '玻璃藥瓶', desc: '三只透明玻璃瓶,不同色液體 — 製作(需解鎖)', enabled: false, pos: { left: '64%', top: '57%' } },
  { id: 'tomes',  glyph: '📚', zh: '厚書',     desc: '兩三本厚重古籍,書脊金字 — 購買升級版',     enabled: false, pos: { left: '70%', top: '50%' } },
];

// 4 張椅子 — 桌子四個邊各一張(Uria 確認)
// top=主位(桌後)、bottom=前位(桌前)、left=左側、right=右側(在地圖的右邊)
const CHAIRS = [
  { id: 'main',   label: '主位',     position: 'top',    pos: { left: '50%', top: '32%' } },
  { id: 'bottom', label: '前位',     position: 'bottom', pos: { left: '50%', top: '92%' } },
  { id: 'left',   label: '左側',     position: 'left',   pos: { left: '14%', top: '64%' } },
  { id: 'right',  label: '右側',     position: 'right',  pos: { left: '86%', top: '64%' } },
];

export function LobbyScreen() {
  const navigate = useNavigate();

  return (
    <div className="lobby-root">
      {/* 背景圖層 */}
      <div className="lobby-bg" aria-hidden />

      <div className="lobby-frame">
        <header className="lobby-header">
          <h1 className="lobby-title">書房</h1>
          <p className="lobby-sub">1922 年・新英格蘭・雨夜</p>
        </header>

        {/* 互動舞台 — 16:9 容器,所有 hot zone % 定位 */}
        <section className="lobby-stage" aria-label="書房互動區">
          {/* 七整備物件 */}
          {DESK_ITEMS.map((item) => (
            <button
              key={item.id}
              className={'desk-item' + (item.enabled ? '' : ' disabled')}
              disabled={!item.enabled}
              title={item.desc}
              style={{ left: item.pos.left, top: item.pos.top }}
            >
              <span className="desk-glyph" aria-hidden>{item.glyph}</span>
              <span className="desk-zh">{item.zh}</span>
              <span className="desk-state">{item.enabled ? '可用' : 'G2 開放'}</span>
            </button>
          ))}

          {/* 地圖紙 — 出發按鈕(右下展開的地圖) */}
          <button
            className="desk-map"
            onClick={() => navigate('/departure')}
            title="點地圖紙 — 出發"
            style={{ left: '80%', top: '76%' }}
          >
            <span className="map-glyph" aria-hidden>🗺</span>
            <span className="map-label">地圖紙</span>
            <span className="map-hint">出發 →</span>
          </button>

          {/* 4 張椅子 */}
          {CHAIRS.map((chair) => (
            <button
              key={chair.id}
              className={'chair chair-' + chair.position + ' empty'}
              disabled
              title={`空椅子 — ${chair.label}(G2 開放:設定調查員/邀請隊友/召喚 AI)`}
              style={{ left: chair.pos.left, top: chair.pos.top }}
            >
              <span className="chair-glyph" aria-hidden>🪑</span>
              <span className="chair-label">{chair.label}</span>
              <span className="chair-state">空</span>
            </button>
          ))}
        </section>

        <footer className="lobby-footer">
          <button className="lobby-back" onClick={() => navigate('/')}>
            ← 回啟動畫面
          </button>
          <span className="lobby-tip">
            G1 視覺骨架 — 椅子設定/邀請隊友/召喚 AI/整備七功能在 G2 開放
          </span>
        </footer>
      </div>
    </div>
  );
}
