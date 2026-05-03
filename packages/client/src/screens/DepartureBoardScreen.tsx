import { useNavigate } from 'react-router-dom';
import './DepartureBoardScreen.css';

/**
 * 出發板 — 對應第二章 §6 + 第六章 Part 2 §4
 *
 * 視覺:大廳變暗為背景,前景浮出大型地圖紙(米黃舊紙質感,皺褶/咖啡漬/墨水痕跡),
 * 三類關卡以視覺位置區分:
 * - 主線章節:地圖中央一條主軸,沿線排列章節節點
 * - 預設小關卡:地圖周邊散布的小別針
 * - 隨機地城:地圖角落的「未知區域」標記
 *
 * G1 階段:只開放「三地點測試關卡」(預設小關卡型),其他標誌待後續里程碑開放。
 */

export function DepartureBoardScreen() {
  const navigate = useNavigate();

  const enterTest = () => {
    // 進入劇情提要頁(劇情提要本身就是「閱讀後決定是否進入」的橋接畫面)
    navigate('/scenario/test/briefing');
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

          {/* 主線章節 — §4.2 中央主軸沿線排列章節節點 */}
          <section className="map-mainline">
            <h2 className="line-label">主線:印斯茅斯陰影</h2>
            <div className="line-rail">
              <div className="line-track" aria-hidden />
              <div className="line-node disabled" title="第一章(G2 開放)">
                <span className="node-glyph">①</span>
                <span className="node-name">海岸來信</span>
                <span className="node-tag">G2 開放</span>
              </div>
              <div className="line-node faded" title="第二章(尚未開啟)">
                <span className="node-glyph">②</span>
                <span className="node-name">迷霧客棧</span>
                <span className="node-tag">未開啟</span>
              </div>
              <div className="line-node faded" title="第三章(尚未開啟)">
                <span className="node-glyph">③</span>
                <span className="node-name">深處的真相</span>
                <span className="node-tag">未開啟</span>
              </div>
            </div>
          </section>

          {/* 預設小關卡 — §4.2 地圖周邊散布的小別針 */}
          <section className="map-side">
            <h2 className="side-label">支線(小關卡)</h2>
            <div className="pin-area">
              <button
                className="pin pin-active"
                onClick={enterTest}
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
                <span className="pin-tooltip">舊圖書館事件(G3 開放)</span>
              </div>

              <div className="pin pin-disabled" title="尚未解鎖">
                <span className="pin-head" aria-hidden>📌</span>
                <span className="pin-tooltip">墓園的腳步聲(G3 開放)</span>
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
            G1 視覺骨架 — 只開放測試關卡入口;主線/隨機地城在 G2/G4 啟用
          </span>
        </footer>
      </div>
    </div>
  );
}
