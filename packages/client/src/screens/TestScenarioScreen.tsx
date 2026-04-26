import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './TestScenarioScreen.css';

/**
 * 三地點測試關卡 — 桌面俯瞰五區塊布局
 * 對應第二章 §9 + 第三章 §3 §11 + 第六章 Part 2 §6.3
 *
 * 五區塊:
 * - 上方角落:城主能量條(§6.3.6)
 * - 左側:調查員區(§6.3.4)— 頭像 + HP/SAN + 行動點 + 狀態
 * - 中央上半:地點區(§6.3.1)— 三個地點卡 + 手繪墨線連接
 * - 中央下半:遭遇區(§6.3.2)— 剛翻開的神話卡
 * - 下方:手牌區(§6.3.3)— 扇形展開
 * - 右側:回合追蹤器(§6.3.5)— 當前回合 / 階段 / 目標牌堆 / 議程牌堆
 *
 * 卡片三合一用途(§8.2):點選手牌 → 卡片放大顯示 [打出/加值/消費] 三按鈕
 * 短休息決定(§10):回合開始時頭像旁出現 [不休息/短休息]
 *
 * G1 階段:視覺骨架 + 點卡片彈三合一按鈕,業務邏輯尚未接(d20 / 混沌袋 / 規則引擎下一步)。
 */

interface Location {
  id: string;
  name: string;
  desc: string;
  visibility: 'day' | 'night' | 'darkness' | 'fire';
  isObstacle: boolean;
  enemies: string[];
}

interface HandCard {
  id: string;
  name: string;
  cost: number;
  desc: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
}

const LOCATIONS: Location[] = [
  { id: 'alley', name: '昏暗小巷', desc: '潮濕的鵝卵石,遠處模糊燈光', visibility: 'night', isObstacle: false, enemies: [] },
  { id: 'bookshop', name: '舊書店', desc: '霉味 / 未拆包裹 / 地下室低響', visibility: 'night', isObstacle: false, enemies: ['深潛者(陰影)'] },
  { id: 'backdoor', name: '霧中後門', desc: '門縫透出冷氣,隱約有東西在另一側', visibility: 'darkness', isObstacle: true, enemies: [] },
];

const HAND_CARDS: HandCard[] = [
  { id: 'c1', name: '.45 手槍', cost: 2, desc: '武器(槍枝)— 攻擊 +2,3 發子彈', rarity: 'uncommon' },
  { id: 'c2', name: '懷錶', cost: 1, desc: '資產(配件)— 重擲一次當前檢定', rarity: 'common' },
  { id: 'c3', name: '街頭知識', cost: 1, desc: '技能 — 調查時 +2 感知', rarity: 'common' },
  { id: 'c4', name: '不退讓', cost: 0, desc: '事件 — 反應:取消 1 點傷害', rarity: 'rare' },
  { id: 'c5', name: '舊日筆記', cost: 1, desc: '資產(書籍)— 抽 2 張卡', rarity: 'common' },
];

type Phase = 'short_rest_decision' | 'investigator' | 'mythos' | 'turn_end';

export function TestScenarioScreen() {
  const navigate = useNavigate();
  const [currentLocation, setCurrentLocation] = useState('alley');
  const [actionPoints, setActionPoints] = useState(3);
  const [phase, setPhase] = useState<Phase>('short_rest_decision');
  const [turnNumber, setTurnNumber] = useState(1);
  const [hp] = useState(7);
  const [san] = useState(7);
  const [keeperEnergy, setKeeperEnergy] = useState(8);
  const [doomTokens] = useState(0);
  const [clueTokens] = useState(0);
  const [activeCard, setActiveCard] = useState<HandCard | null>(null);
  const [log, setLog] = useState<string[]>([
    '第 1 回合開始 — 短休息決定階段',
    '你站在昏暗小巷。挑「不休息」進入調查員階段。',
  ]);

  const append = (s: string) => setLog((l) => [...l.slice(-15), s]);

  const startInvestigatorPhase = () => {
    setPhase('investigator');
    append('[階段切換] 進入調查員階段(3 行動點)');
  };

  const takeShortRest = () => {
    setPhase('mythos');
    setActionPoints(0);
    append('[短休息] 本回合結束於短休息 — 直接進入神話階段');
  };

  const tryAction = (label: string, cost: number) => {
    if (phase !== 'investigator') {
      append('[駁回] 不在調查員階段,無法執行行動');
      return;
    }
    if (actionPoints < cost) {
      append(`[駁回] 行動點不足:需 ${cost},剩 ${actionPoints}`);
      return;
    }
    setActionPoints((p) => p - cost);
    append(`[執行] ${label}(花 ${cost} 行動點)`);
  };

  const moveTo = (locId: string) => {
    if (phase !== 'investigator') {
      append('[駁回] 不在調查員階段');
      return;
    }
    if (locId === currentLocation) return;
    const target = LOCATIONS.find((l) => l.id === locId);
    if (!target) return;
    const cost = target.isObstacle ? 2 : 1;
    if (actionPoints < cost) {
      append(`[駁回] 移動到「${target.name}」需 ${cost} 行動點`);
      return;
    }
    setActionPoints((p) => p - cost);
    setCurrentLocation(locId);
    append(`[移動] → ${target.name}(花 ${cost})`);
  };

  const usePlay = () => {
    if (!activeCard) return;
    tryAction(`打出「${activeCard.name}」`, activeCard.cost);
    setActiveCard(null);
  };

  const useCommit = () => {
    if (!activeCard) return;
    append(`[加值] 「${activeCard.name}」貢獻屬性圖示給當前檢定 → 棄牌堆`);
    setActiveCard(null);
  };

  const useConsume = () => {
    if (!activeCard) return;
    append(`[消費] 「${activeCard.name}」永久移除 → 觸發更強效果`);
    setActiveCard(null);
  };

  const enterMythosPhase = () => {
    setPhase('mythos');
    setKeeperEnergy((e) => Math.max(0, e - 2));
    // 第三章 §9.7 三層敘事:環境 / 城主行動 / 傳奇行動
    append('[階段切換] 進入神話階段(2 秒色調變暗,§6.2)');
    setTimeout(() => append('[城主行動] 黑暗從牆角滲出,吞沒了走廊。'), 1200);
    setTimeout(() => append('[環境敘事] 窗外的雨變大了。'), 2400);
  };

  const endTurn = () => {
    setPhase('short_rest_decision');
    setTurnNumber((n) => n + 1);
    setActionPoints(3);
    setKeeperEnergy((e) => Math.min(12, e + 1));
    append(`── 第 ${turnNumber + 1} 回合開始 ── 短休息決定階段`);
  };

  return (
    <div className={'ts-root phase-' + phase}>
      {/* 上方角落:城主能量條(§6.3.6) */}
      <header className="ts-topbar">
        <button className="ts-back" onClick={() => navigate('/departure')}>
          ← 回出發板
        </button>
        <div className="ts-keeper">
          <span className="ts-keeper-label">城主能量</span>
          <div className="ts-keeper-bar">
            <div className="ts-keeper-fill" style={{ width: `${(keeperEnergy / 12) * 100}%` }} />
          </div>
          <span className="ts-keeper-num">{keeperEnergy} / 12</span>
        </div>
      </header>

      {/* 主版面:左側調查員區 + 中央地點/遭遇 + 右側回合追蹤 */}
      <div className="ts-main">
        {/* 左側:調查員區(§6.3.4) */}
        <aside className="ts-left">
          <h3 className="ts-section-title">調查員</h3>
          <div className="ts-investigator">
            <div className="ts-avatar" data-faction="herald">E</div>
            <div className="ts-inv-name">范例調查員</div>
            <div className="ts-inv-faction">E 號令 · sidearm</div>

            <div className="ts-bar-row">
              <span className="ts-bar-label">HP</span>
              <div className="ts-bar ts-bar-hp">
                <div className="ts-bar-fill" style={{ width: `${(hp / 7) * 100}%` }} />
              </div>
              <span className="ts-bar-num">{hp}/7</span>
            </div>

            <div className="ts-bar-row">
              <span className="ts-bar-label">SAN</span>
              <div className="ts-bar ts-bar-san">
                <div className="ts-bar-fill" style={{ width: `${(san / 7) * 100}%` }} />
              </div>
              <span className="ts-bar-num">{san}/7</span>
            </div>

            <div className="ts-ap-row">
              <span className="ts-ap-label">行動點</span>
              <div className="ts-ap-gears">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={'ts-gear' + (i < actionPoints ? ' active' : '')}>⚙</span>
                ))}
              </div>
            </div>

            <div className="ts-loc-info">
              在 <strong>{LOCATIONS.find((l) => l.id === currentLocation)?.name}</strong>
            </div>

            <div className="ts-statuses">
              <span className="ts-status">無狀態</span>
            </div>
          </div>
        </aside>

        {/* 中央:地點區(上)+ 遭遇區(下) */}
        <main className="ts-center">
          {/* 地點區 — §6.3.1 */}
          <section className="ts-locations">
            <h3 className="ts-section-title">地點區(俯瞰)</h3>
            <div className="ts-loc-row">
              {LOCATIONS.map((loc, i) => (
                <button
                  key={loc.id}
                  className={
                    'ts-loc-card' +
                    (loc.id === currentLocation ? ' active' : '') +
                    ' vis-' + loc.visibility
                  }
                  onClick={() => moveTo(loc.id)}
                  title={loc.isObstacle ? '障礙物連接(2 行動點)' : '相鄰連接(1 行動點)'}
                >
                  <div className="ts-loc-name">{loc.name}</div>
                  <div className="ts-loc-desc">{loc.desc}</div>
                  <div className="ts-loc-foot">
                    <span className="ts-loc-vis">
                      {loc.visibility === 'darkness' && '🌑 黑暗'}
                      {loc.visibility === 'night' && '🌙 夜間'}
                      {loc.visibility === 'day' && '☀ 白天'}
                      {loc.visibility === 'fire' && '🔥 失火'}
                    </span>
                    {loc.enemies.length > 0 && <span className="ts-loc-enemy">⚔ {loc.enemies.length}</span>}
                  </div>
                  {/* 連接線 — 簡化:相鄰 = 實線 / 障礙 = 虛線(箭頭由布局自然展示) */}
                  {i < LOCATIONS.length - 1 && (
                    <span className={'ts-loc-link' + (LOCATIONS[i + 1].isObstacle ? ' obstacle' : '')} aria-hidden />
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* 遭遇區 — §6.3.2 */}
          <section className="ts-encounter">
            <h3 className="ts-section-title">遭遇區</h3>
            <div className="ts-encounter-body">
              <div className="ts-encounter-empty">
                等待第一張神話卡翻開
                <br />
                <small>(進入神話階段時自動翻開)</small>
              </div>
            </div>
          </section>
        </main>

        {/* 右側:回合追蹤器 — §6.3.5 */}
        <aside className="ts-right">
          <h3 className="ts-section-title">回合追蹤</h3>
          <div className="ts-turn-num">第 {turnNumber} 回合</div>
          <div className="ts-phase">
            階段:
            <strong>
              {phase === 'short_rest_decision' && '短休息決定'}
              {phase === 'investigator' && '調查員階段'}
              {phase === 'mythos' && '神話階段'}
              {phase === 'turn_end' && '回合結束'}
            </strong>
          </div>

          {/* 短休息決定 — §10 */}
          {phase === 'short_rest_decision' && (
            <div className="ts-rest-buttons">
              <button className="ts-rest ts-rest-no" onClick={startInvestigatorPhase}>
                不休息 → 3 行動點
              </button>
              <button className="ts-rest ts-rest-yes" onClick={takeShortRest}>
                短休息 → 跳神話
              </button>
            </div>
          )}

          {phase === 'investigator' && (
            <button className="ts-end-phase" onClick={enterMythosPhase}>
              結束調查員階段 →
            </button>
          )}

          {phase === 'mythos' && (
            <button className="ts-end-phase" onClick={endTurn}>
              結束神話階段 → 下回合
            </button>
          )}

          <div className="ts-tracker">
            <div className="ts-tracker-row">
              <span className="ts-tracker-label">目標牌堆</span>
              <div className="ts-tracker-bar">
                <div className="ts-tracker-fill ts-clue" style={{ width: `${Math.min(clueTokens, 5) * 20}%` }} />
              </div>
              <span className="ts-tracker-num">線索 {clueTokens}/5</span>
            </div>
            <div className="ts-tracker-row">
              <span className="ts-tracker-label">議程牌堆</span>
              <div className="ts-tracker-bar">
                <div className="ts-tracker-fill ts-doom" style={{ width: `${Math.min(doomTokens, 6) * 100 / 6}%` }} />
              </div>
              <span className="ts-tracker-num">毀滅 {doomTokens}/6</span>
            </div>
          </div>
        </aside>
      </div>

      {/* 下方:手牌區(§6.3.3 扇形展開)*/}
      <section className="ts-hand">
        <h3 className="ts-section-title">手牌(扇形)</h3>
        <div className="ts-hand-fan">
          {HAND_CARDS.map((card, i) => {
            const center = (HAND_CARDS.length - 1) / 2;
            const offset = i - center;
            const rot = offset * 4;
            const ty = Math.abs(offset) * 4;
            return (
              <button
                key={card.id}
                className={'ts-card rarity-' + card.rarity}
                style={{ transform: `rotate(${rot}deg) translateY(${ty}px)` }}
                onClick={() => setActiveCard(card)}
                title="點選查看三合一用途"
              >
                <div className="ts-card-cost">{card.cost}</div>
                <div className="ts-card-name">{card.name}</div>
                <div className="ts-card-desc">{card.desc}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 卡片三合一用途彈出 — §8.2 */}
      {activeCard && (
        <div className="ts-card-modal" onClick={() => setActiveCard(null)}>
          <div className="ts-card-zoom" onClick={(e) => e.stopPropagation()}>
            <div className="ts-zoom-cost">費用 {activeCard.cost}</div>
            <h2 className="ts-zoom-name">{activeCard.name}</h2>
            <p className="ts-zoom-desc">{activeCard.desc}</p>
            <div className="ts-zoom-actions">
              <button className="ts-action ts-action-play" onClick={usePlay}>
                打出
                <small>花 {activeCard.cost} 行動點 + 費用,效果觸發</small>
              </button>
              <button className="ts-action ts-action-commit" onClick={useCommit}>
                加值
                <small>貢獻屬性圖示給檢定 → 棄牌堆</small>
              </button>
              <button className="ts-action ts-action-consume" onClick={useConsume}>
                消費
                <small>永久移除 → 觸發更強效果</small>
              </button>
            </div>
            <button className="ts-zoom-close" onClick={() => setActiveCard(null)}>
              取消(關閉)
            </button>
          </div>
        </div>
      )}

      {/* 事件記錄 */}
      <section className="ts-log">
        <h3 className="ts-section-title">事件記錄</h3>
        <div className="ts-log-body">
          {log.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </section>

      <footer className="ts-foot">
        <p>
          ⚠ G1 視覺骨架 — 五區塊布局已對齊第六章 Part 2 §6.3。
          引擎邏輯已備:訊息協議 ✓ / 回合狀態機 ✓。
          下一步接:d20 擲骰 / 混沌袋 / 戰鬥風格卡 / 卡片效果結算。
        </p>
      </footer>
    </div>
  );
}
