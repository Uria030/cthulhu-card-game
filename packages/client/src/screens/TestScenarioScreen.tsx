import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createInMemoryMessageBus,
  createTurnLoop,
  resolveIntent,
  CURRENT_MESSAGE_SCHEMA_VERSION,
} from '@cthulhu/shared';
import type {
  IntentMessage,
  ResultMessage,
  NotificationMessage,
  InvestigatorState,
  ScenarioState,
  TurnState,
  TurnPhase,
  RuleContext,
  ResultEffect,
} from '@cthulhu/shared';
import './TestScenarioScreen.css';

/**
 * 三地點測試關卡 — 桌面俯瞰五區塊布局 + 訊息協議接規則引擎
 *
 * 對應第二章 §9 + 第三章 §3 §4.1 §11 + 第六章 Part 2 §6.3
 *
 * v0.20.4 起:
 * - 三個基本動作(拿資源/抽卡/移動)走真實訊息協議:publish IntentMessage
 *   → resolveIntent → 收 ResultMessage → 更新 state
 * - 其他動作仍是視覺占位(會被 ruleEngine stub 駁回)
 * - turnLoop 控制階段切換,publish phase_changed notification
 */

interface HandCard {
  id: string;
  name: string;
  cost: number;
  desc: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
}

const HAND_CARD_DEFS: HandCard[] = [
  { id: 'c1', name: '.45 手槍', cost: 2, desc: '武器(槍枝)— 攻擊 +2,3 發子彈', rarity: 'uncommon' },
  { id: 'c2', name: '懷錶', cost: 1, desc: '資產(配件)— 重擲一次當前檢定', rarity: 'common' },
  { id: 'c3', name: '街頭知識', cost: 1, desc: '技能 — 調查時 +2 感知', rarity: 'common' },
  { id: 'c4', name: '不退讓', cost: 0, desc: '事件 — 反應:取消 1 點傷害', rarity: 'rare' },
  { id: 'c5', name: '舊日筆記', cost: 1, desc: '資產(書籍)— 抽 2 張卡', rarity: 'common' },
];

// 初始狀態(寫死的調查員 + 三地點 + 5 張手牌 + 牌庫 5 張)
function makeInitialInvestigator(): InvestigatorState {
  return {
    investigatorId: 'inv-1',
    investigatorDefinitionId: 'def-范例調查員',
    ownerPlayerId: 'p1',
    attributes: {
      strength: 3, agility: 3, constitution: 3, reflex: 3,
      intellect: 3, willpower: 3, perception: 3, charisma: 4,
    },
    combatStyle: 'sidearm',
    specializations: [],
    deck: ['d1', 'd2', 'd3', 'd4', 'd5'],
    hand: HAND_CARD_DEFS.map((c) => c.id),
    discardPile: [],
    removedPile: [],
    assetsInPlay: [],
    hp: 7, hpMax: 7, san: 7, sanMax: 7,
    actionPoints: 3,
    resources: 0,
    currentLocationId: 'alley',
    engagedWith: [],
    triggeredHorrorChecks: [],
    traumas: [],
    secretTaskState: null,
    permanentlyDead: false,
    startingXp: 0,
  };
}

function makeInitialScenario(): ScenarioState {
  return {
    scenarioId: 'test-3loc',
    scenarioDefinitionId: 'test-three-locations',
    campaignId: 'test',
    locations: [
      { locationDefinitionId: 'alley', visibility: 'night', connectedTo: ['bookshop'], isObstacle: false },
      { locationDefinitionId: 'bookshop', visibility: 'night', connectedTo: ['alley', 'backdoor'], isObstacle: false },
      { locationDefinitionId: 'backdoor', visibility: 'darkness', connectedTo: ['bookshop'], isObstacle: true },
    ],
    enemies: [],
    tokens: [],
    agendaProgress: 0,
    objectiveProgress: 0,
    chaosBag: [],
    turnNumber: 1,
    phase: 'short_rest_decision',
  };
}

const LOCATION_META: Record<string, { name: string; desc: string }> = {
  alley: { name: '昏暗小巷', desc: '潮濕的鵝卵石,遠處模糊燈光' },
  bookshop: { name: '舊書店', desc: '霉味 / 未拆包裹 / 地下室低響' },
  backdoor: { name: '霧中後門', desc: '門縫透出冷氣,隱約有東西在另一側' },
};

const HAND_CARD_BY_ID: Record<string, HandCard> = Object.fromEntries(HAND_CARD_DEFS.map((c) => [c.id, c]));

function describeEffect(eff: ResultEffect): string {
  switch (eff.type) {
    case 'spend_action_point': return '扣 ' + (eff.params as { amount: number }).amount + ' 行動點';
    case 'gain_resource': return '獲得 ' + (eff.params as { amount: number }).amount + ' 資源';
    case 'draw_card': return '抽 1 張卡 → 手牌';
    case 'deck_empty_horror': return '⚠ 牌庫空,改受 ' + (eff.params as { amount: number }).amount + ' 點恐懼(§3.3)';
    case 'move': {
      const p = eff.params as { from: string; to: string };
      return '移動 ' + (LOCATION_META[p.from]?.name || p.from) + ' → ' + (LOCATION_META[p.to]?.name || p.to);
    }
    case 'attack_of_opportunity_warning': return '⚠ 交戰中強行移動 — 應觸發藉機攻擊(§7.2,完整邏輯待 attack 實作)';
    default: return eff.type;
  }
}

export function TestScenarioScreen() {
  const navigate = useNavigate();

  // 訊息匯流排與回合狀態機:單次建立,跨重渲染保留
  const bus = useMemo(() => createInMemoryMessageBus(), []);
  const turnLoopRef = useRef<ReturnType<typeof createTurnLoop> | null>(null);
  if (turnLoopRef.current === null) {
    turnLoopRef.current = createTurnLoop({ bus, source: 'engine' });
  }

  // React state — 驅動畫面
  const [investigator, setInvestigator] = useState<InvestigatorState>(makeInitialInvestigator);
  const [scenario, setScenario] = useState<ScenarioState>(makeInitialScenario);
  const [phase, setPhase] = useState<TurnPhase>('short_rest_decision');
  const [turnNumber, setTurnNumber] = useState(1);
  const [keeperEnergy, setKeeperEnergy] = useState(8);
  const [activeCard, setActiveCard] = useState<HandCard | null>(null);
  const [log, setLog] = useState<string[]>([
    '第 1 回合開始 — 短休息決定階段',
    '寫死的調查員站在昏暗小巷。挑「不休息」進入調查員階段。',
  ]);

  const append = (s: string) => setLog((l) => [...l.slice(-15), s]);

  // 訂閱訊息匯流排:notification 階段切換 + result 顯示
  useEffect(() => {
    const unsubNotif = bus.subscribe('notification', (m: NotificationMessage) => {
      if (m.notificationType === 'phase_changed') {
        const p = m.payload as { newPhase: TurnPhase; newTurnNumber: number };
        setPhase(p.newPhase);
        setTurnNumber(p.newTurnNumber);
      }
    });
    const unsubResult = bus.subscribe('result', (m: ResultMessage) => {
      if (m.outcome === 'rejected') {
        append('[駁回] ' + (m.rejection?.narrative ?? '未知原因'));
        if (m.rejection?.suggestion) append('   建議:' + m.rejection.suggestion);
      } else {
        const effects = m.effects ?? [];
        for (const eff of effects) append('[結算] ' + describeEffect(eff));
      }
    });
    return () => { unsubNotif(); unsubResult(); };
  }, [bus]);

  // ─── 動作:走訊息協議 ──────────────────
  const submitIntent = (
    actionType: IntentMessage['actionType'],
    payload: Record<string, unknown> = {}
  ) => {
    const intent: IntentMessage = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION,
      source: 'p1',
      kind: 'intent',
      actionType,
      payload,
      playerId: 'p1',
      investigatorId: investigator.investigatorId,
    };
    // 先 publish 給訊息匯流排(供記錄/觀察)
    bus.publish(intent);

    // 走規則引擎結算
    const turn: TurnState = {
      turnNumber,
      phase,
      actionPointsSpent: {},
      pendingLegendaryActions: [],
      triggeredReactions: [],
    };
    const ctx: RuleContext = {
      scenario,
      investigator,
      turn,
      investigators: { [investigator.investigatorId]: investigator },
    };
    const out = resolveIntent(intent, ctx);

    // publish ResultMessage → useEffect 訂閱會記 log
    bus.publish(out.result);

    // 套用 newState
    if (out.newState?.investigator) setInvestigator(out.newState.investigator);
    if (out.newState?.scenario) setScenario(out.newState.scenario);
  };

  // ─── 階段控制 ──────────────────────
  const startInvestigatorPhase = () => {
    turnLoopRef.current?.advance(); // short_rest_decision → investigator
    append('[階段切換] 進入調查員階段(3 行動點)');
  };
  const takeShortRest = () => {
    turnLoopRef.current?.setPhase('mythos', turnNumber);
    setInvestigator((i) => ({ ...i, actionPoints: 0 }));
    append('[短休息] 本回合結束於短休息 — 直接進入神話階段');
  };
  const enterMythosPhase = () => {
    turnLoopRef.current?.advance(); // investigator → mythos
    setKeeperEnergy((e) => Math.max(0, e - 2));
    append('[階段切換] 進入神話階段(2 秒色調變暗,§6.2)');
    setTimeout(() => append('[城主行動] 黑暗從牆角滲出,吞沒了走廊。'), 1200);
    setTimeout(() => append('[環境敘事] 窗外的雨變大了。'), 2400);
  };
  const endTurn = () => {
    turnLoopRef.current?.advance(); // mythos → turn_end
    turnLoopRef.current?.advance(); // turn_end → short_rest_decision(下一回合)
    setInvestigator((i) => ({ ...i, actionPoints: 3 }));
    setKeeperEnergy((e) => Math.min(12, e + 1));
  };

  // ─── 卡片三合一(視覺占位,結算 stub)─
  const usePlay = () => {
    if (!activeCard) return;
    submitIntent('play_card', { cardInstanceId: activeCard.id, cost: activeCard.cost });
    setActiveCard(null);
  };
  const useCommit = () => {
    if (!activeCard) return;
    submitIntent('commit_attribute_icon', { cardInstanceId: activeCard.id });
    setActiveCard(null);
  };
  const useConsume = () => {
    if (!activeCard) return;
    submitIntent('consume', { cardInstanceId: activeCard.id });
    setActiveCard(null);
  };

  // ─── 衍生資料 ──────────────────────
  const currentLocation = investigator.currentLocationId;
  const actionPoints = investigator.actionPoints;
  const hp = investigator.hp;
  const san = investigator.san;
  const handCards = investigator.hand.map((id) => HAND_CARD_BY_ID[id]).filter((x): x is HandCard => !!x);

  return (
    <div className={'ts-root phase-' + phase}>
      <header className="ts-topbar">
        <button className="ts-back" onClick={() => navigate('/departure')}>← 回出發板</button>
        <div className="ts-keeper">
          <span className="ts-keeper-label">城主能量</span>
          <div className="ts-keeper-bar">
            <div className="ts-keeper-fill" style={{ width: `${(keeperEnergy / 12) * 100}%` }} />
          </div>
          <span className="ts-keeper-num">{keeperEnergy} / 12</span>
        </div>
      </header>

      <div className="ts-main">
        <aside className="ts-left">
          <h3 className="ts-section-title">調查員</h3>
          <div className="ts-investigator">
            <div className="ts-avatar" data-faction="herald">E</div>
            <div className="ts-inv-name">范例調查員</div>
            <div className="ts-inv-faction">E 號令 · sidearm</div>

            <div className="ts-bar-row">
              <span className="ts-bar-label">HP</span>
              <div className="ts-bar ts-bar-hp">
                <div className="ts-bar-fill" style={{ width: `${(hp / investigator.hpMax) * 100}%` }} />
              </div>
              <span className="ts-bar-num">{hp}/{investigator.hpMax}</span>
            </div>

            <div className="ts-bar-row">
              <span className="ts-bar-label">SAN</span>
              <div className="ts-bar ts-bar-san">
                <div className="ts-bar-fill" style={{ width: `${(san / investigator.sanMax) * 100}%` }} />
              </div>
              <span className="ts-bar-num">{san}/{investigator.sanMax}</span>
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
              在 <strong>{LOCATION_META[currentLocation || '']?.name ?? '未知'}</strong>
            </div>

            <div className="ts-statuses">
              <span className="ts-status">資源 {investigator.resources}</span>
              <span className="ts-status">手牌 {investigator.hand.length}</span>
              <span className="ts-status">牌庫 {investigator.deck.length}</span>
            </div>

            {/* 行動按鈕:走真實訊息協議的三個基本動作 */}
            {phase === 'investigator' && (
              <div className="ts-actions-quick">
                <button className="ts-action-btn" onClick={() => submitIntent('gain_resource')}>
                  拿資源
                </button>
                <button className="ts-action-btn" onClick={() => submitIntent('draw_card')}>
                  抽卡
                </button>
              </div>
            )}
          </div>
        </aside>

        <main className="ts-center">
          <section className="ts-locations">
            <h3 className="ts-section-title">地點區(俯瞰)</h3>
            <div className="ts-loc-row">
              {scenario.locations.map((loc, i) => {
                const meta = LOCATION_META[loc.locationDefinitionId];
                return (
                  <button
                    key={loc.locationDefinitionId}
                    className={
                      'ts-loc-card' +
                      (loc.locationDefinitionId === currentLocation ? ' active' : '') +
                      ' vis-' + loc.visibility
                    }
                    onClick={() => submitIntent('move', { targetLocationId: loc.locationDefinitionId })}
                    title={loc.isObstacle ? '障礙物連接(2 行動點)' : '相鄰連接(1 行動點)'}
                  >
                    <div className="ts-loc-name">{meta?.name ?? loc.locationDefinitionId}</div>
                    <div className="ts-loc-desc">{meta?.desc ?? ''}</div>
                    <div className="ts-loc-foot">
                      <span className="ts-loc-vis">
                        {loc.visibility === 'darkness' && '🌑 黑暗'}
                        {loc.visibility === 'night' && '🌙 夜間'}
                        {loc.visibility === 'day' && '☀ 白天'}
                        {loc.visibility === 'fire' && '🔥 失火'}
                        {loc.isObstacle && ' · ⚠ 障礙物'}
                      </span>
                    </div>
                    {i < scenario.locations.length - 1 && (
                      <span
                        className={'ts-loc-link' + (scenario.locations[i + 1].isObstacle ? ' obstacle' : '')}
                        aria-hidden
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="ts-encounter">
            <h3 className="ts-section-title">遭遇區</h3>
            <div className="ts-encounter-body">
              <div className="ts-encounter-empty">
                等待第一張神話卡翻開
                <br />
                <small>(進入神話階段時自動翻開,G1 階段尚未實作神話卡池)</small>
              </div>
            </div>
          </section>
        </main>

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
                <div className="ts-tracker-fill ts-clue" style={{ width: `${Math.min(scenario.objectiveProgress, 5) * 20}%` }} />
              </div>
              <span className="ts-tracker-num">線索 {scenario.objectiveProgress}/5</span>
            </div>
            <div className="ts-tracker-row">
              <span className="ts-tracker-label">議程牌堆</span>
              <div className="ts-tracker-bar">
                <div className="ts-tracker-fill ts-doom" style={{ width: `${Math.min(scenario.agendaProgress, 6) * 100 / 6}%` }} />
              </div>
              <span className="ts-tracker-num">毀滅 {scenario.agendaProgress}/6</span>
            </div>
          </div>
        </aside>
      </div>

      <section className="ts-hand">
        <h3 className="ts-section-title">手牌(扇形)</h3>
        <div className="ts-hand-fan">
          {handCards.map((card, i) => {
            const center = (handCards.length - 1) / 2;
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

      {activeCard && (
        <div className="ts-card-modal" onClick={() => setActiveCard(null)}>
          <div className="ts-card-zoom" onClick={(e) => e.stopPropagation()}>
            <div className="ts-zoom-cost">費用 {activeCard.cost}</div>
            <h2 className="ts-zoom-name">{activeCard.name}</h2>
            <p className="ts-zoom-desc">{activeCard.desc}</p>
            <div className="ts-zoom-actions">
              <button className="ts-action ts-action-play" onClick={usePlay}>
                打出
                <small>花 {activeCard.cost} 行動點 + 費用,效果觸發(規則引擎尚未實作)</small>
              </button>
              <button className="ts-action ts-action-commit" onClick={useCommit}>
                加值
                <small>貢獻屬性圖示給檢定 → 棄牌堆(尚未實作)</small>
              </button>
              <button className="ts-action ts-action-consume" onClick={useConsume}>
                消費
                <small>永久移除 → 觸發更強效果(尚未實作)</small>
              </button>
            </div>
            <button className="ts-zoom-close" onClick={() => setActiveCard(null)}>
              取消(關閉)
            </button>
          </div>
        </div>
      )}

      <section className="ts-log">
        <h3 className="ts-section-title">事件記錄(訊息匯流排輸出)</h3>
        <div className="ts-log-body">
          {log.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </section>

      <footer className="ts-foot">
        <p>
          ⚠ G1 階段:訊息協議已接(拿資源/抽卡/移動 三個動作走規則引擎結算);
          其他動作仍是 stub。下一步接 d20 / 混沌袋 / 戰鬥風格卡 / 視野光照。
        </p>
      </footer>
    </div>
  );
}
