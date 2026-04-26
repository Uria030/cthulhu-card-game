import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './TestScenarioScreen.css';

/**
 * 三地點測試關卡(教學) — 視覺骨架
 * 對應 G1 §3.3 的「三個地點 + 寫死的調查員 + 完整動作驗證」
 *
 * G1 第一階段:只放地點視覺骨架 + 玩家狀態列 + 行動類型按鈕(尚未接邏輯),
 * 點按鈕只 console.log,不觸發實際引擎結算。
 *
 * 後續逐步接 messageBus → 規則引擎 → 結果展示。
 */

interface Location {
  id: string;
  name: string;
  desc: string;
  visibility: 'day' | 'night' | 'darkness' | 'fire';
  isObstacle: boolean;
}

const LOCATIONS: Location[] = [
  { id: 'alley', name: '昏暗小巷', desc: '潮濕的鵝卵石與遠處模糊的燈光', visibility: 'night', isObstacle: false },
  { id: 'bookshop', name: '舊書店', desc: '霉味、未拆封的包裹、地下室的低響', visibility: 'night', isObstacle: false },
  { id: 'backdoor', name: '霧中後門', desc: '門縫透出冷氣,隱約有東西在另一側', visibility: 'darkness', isObstacle: true },
];

const ACTIONS = [
  { id: 'gain_resource', zh: '拿資源', cost: 1 },
  { id: 'draw_card', zh: '抽卡', cost: 1 },
  { id: 'play_card', zh: '打出', cost: 1 },
  { id: 'attack', zh: '攻擊', cost: 1 },
  { id: 'move', zh: '移動', cost: 1 },
  { id: 'investigate', zh: '調查', cost: 1 },
  { id: 'taunt', zh: '嘲諷', cost: 1 },
  { id: 'evade', zh: '閃避', cost: 1 },
  { id: 'execute', zh: '執行卡片行動', cost: 1 },
  { id: 'consume', zh: '消費', cost: 0 },
];

export function TestScenarioScreen() {
  const navigate = useNavigate();
  const [currentLocation, setCurrentLocation] = useState('alley');
  const [actionPoints, setActionPoints] = useState(3);
  const [log, setLog] = useState<string[]>(['關卡開始 — 你站在昏暗小巷的入口。']);

  const tryAction = (actionId: string, cost: number, zh: string) => {
    if (actionPoints < cost) {
      setLog((l) => [...l, `[駁回] 行動點不足:需 ${cost},剩 ${actionPoints}`]);
      return;
    }
    setActionPoints((p) => p - cost);
    setLog((l) => [...l, `[執行] ${zh}(花 ${cost} 行動點)`]);
    // TODO: 接 messageBus → publish IntentMessage
    console.log('[Intent]', { actionType: actionId, cost });
  };

  const moveTo = (locId: string) => {
    if (locId === currentLocation) return;
    const target = LOCATIONS.find((l) => l.id === locId);
    if (!target) return;
    const cost = target.isObstacle ? 2 : 1;
    if (actionPoints < cost) {
      setLog((l) => [...l, `[駁回] 移動到 ${target.name} 需 ${cost} 行動點,剩 ${actionPoints}`]);
      return;
    }
    setActionPoints((p) => p - cost);
    setCurrentLocation(locId);
    setLog((l) => [...l, `[移動] → ${target.name}(花 ${cost} 行動點)`]);
  };

  const endTurn = () => {
    setActionPoints(3);
    setLog((l) => [...l, '── 回合結束 ── 新回合開始']);
  };

  return (
    <div className="ts-root">
      <header className="ts-header">
        <div>
          <h1 className="ts-title">三地點測試關卡</h1>
          <p className="ts-sub">教學關卡 — G1 視覺骨架</p>
        </div>
        <button className="ts-back" onClick={() => navigate('/departure')}>
          ← 回出發板
        </button>
      </header>

      <div className="ts-board">
        {LOCATIONS.map((loc) => (
          <button
            key={loc.id}
            className={
              'ts-loc' +
              (loc.id === currentLocation ? ' active' : '') +
              ' vis-' + loc.visibility
            }
            onClick={() => moveTo(loc.id)}
            title={loc.isObstacle ? '障礙物連接(2 行動點)' : '相鄰連接(1 行動點)'}
          >
            <div className="ts-loc-name">{loc.name}</div>
            <div className="ts-loc-desc">{loc.desc}</div>
            <div className="ts-loc-meta">
              {loc.visibility === 'darkness' && '🌑 黑暗'}
              {loc.visibility === 'night' && '🌙 夜間'}
              {loc.visibility === 'day' && '☀ 白天'}
              {loc.visibility === 'fire' && '🔥 失火'}
              {loc.isObstacle && ' · ⚠ 障礙物'}
            </div>
          </button>
        ))}
      </div>

      <section className="ts-investigator">
        <h2 className="ts-sec-title">調查員(寫死)</h2>
        <div className="ts-stats">
          <span>HP 7/7</span>
          <span>SAN 7/7</span>
          <span className="ts-ap">⏱ 行動點 {actionPoints}/3</span>
          <span>陣營 E 號令</span>
          <span>戰鬥風格 sidearm</span>
        </div>
      </section>

      <section className="ts-actions">
        <h2 className="ts-sec-title">行動(規則書 §6.1)</h2>
        <div className="ts-action-grid">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              className="ts-action-btn"
              onClick={() => tryAction(a.id, a.cost, a.zh)}
            >
              {a.zh}
              <span className="ts-action-cost">{a.cost}</span>
            </button>
          ))}
        </div>
        <button className="ts-end-turn" onClick={endTurn}>
          結束回合(行動點重設 3)
        </button>
      </section>

      <section className="ts-log">
        <h2 className="ts-sec-title">事件記錄</h2>
        <div className="ts-log-body">
          {log.slice(-12).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </section>

      <footer className="ts-foot">
        <p className="ts-disclaimer">
          ⚠ G1 視覺骨架 — 行動只記錄,不觸發實際引擎結算。
          引擎邏輯尚在實作:訊息協議 ✓ / 回合狀態機 ✓ / 規則引擎(下一步) / 戰鬥風格卡 / 混沌袋 / 三合一用途。
        </p>
      </footer>
    </div>
  );
}
