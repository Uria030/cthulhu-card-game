import { useNavigate } from 'react-router-dom';
import './DepartureBoardScreen.css';

/**
 * 出發板 — 三類關卡選擇
 * 對應第二章 §6:主線章節 / 預設小關卡 / 隨機地城
 *
 * G1 階段:只開放「測試關卡(教學)」一個入口。
 * G2 補主線、G5 補隨機地城、G7 補連線房間。
 */
export function DepartureBoardScreen() {
  const navigate = useNavigate();

  return (
    <div className="dep-root">
      <div className="dep-frame">
        <header className="dep-header">
          <h1 className="dep-title">出發板</h1>
          <p className="dep-sub">今夜要去哪裡?</p>
        </header>

        <div className="dep-cards">
          <button
            className="dep-card dep-card-active"
            onClick={() => navigate('/scenario/test')}
          >
            <div className="dep-card-tag">G1 · 教學</div>
            <h2 className="dep-card-title">三地點測試關卡</h2>
            <p className="dep-card-desc">
              一條昏暗的小巷、一間散著霉味的書店、與一處掩在霧中的後門。
              <br />
              它沒有標題,只有等待你走進的三扇門。
            </p>
            <div className="dep-card-meta">建議調查員:1 · 建議時長:30 分鐘</div>
          </button>

          <div className="dep-card disabled">
            <div className="dep-card-tag">G2 開放</div>
            <h2 className="dep-card-title">主線章節</h2>
            <p className="dep-card-desc">印斯茅斯陰影 — 第一章</p>
            <div className="dep-card-meta">尚未解鎖</div>
          </div>

          <div className="dep-card disabled">
            <div className="dep-card-tag">G4 開放</div>
            <h2 className="dep-card-title">隨機地城</h2>
            <p className="dep-card-desc">每次內容皆不同的支線地城</p>
            <div className="dep-card-meta">尚未解鎖</div>
          </div>
        </div>

        <footer className="dep-footer">
          <button className="dep-back" onClick={() => navigate('/lobby')}>
            ← 回大廳
          </button>
        </footer>
      </div>
    </div>
  );
}
