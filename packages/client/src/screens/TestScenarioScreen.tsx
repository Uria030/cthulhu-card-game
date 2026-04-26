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
  EnemyInstance,
} from '@cthulhu/shared';
import './TestScenarioScreen.css';

/**
 * 三地點漸進教學關卡 — G1 §3.3 教學雙重身份
 *
 * 教學流程(三地點解鎖鏈):
 *   1. alley(昏暗小巷,初始解鎖)— 驗證「調查」:點調查找線索 → 解鎖 bookshop
 *   2. bookshop(舊書店)— 驗證「遭遇」:抵達自動觸發神話卡事件 → 解鎖 backdoor
 *   3. backdoor(霧中後門,障礙物 2 行動點)— 驗證「戰鬥」:遇到怪物,點攻擊擊敗 → 教學完成
 *
 * 每個地點開啟前後鎖定狀態用視覺區分。卡片區留為視覺占位(後續里程碑接)。
 *
 * 訊息協議閉環:容器 publish IntentMessage → resolveIntent → ResultMessage
 *               → useEffect subscribe → setInvestigator/setScenario
 */

interface HandCard {
  id: string;
  name: string;
  cost: number;
  desc: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
}

const HAND_CARD_DEFS: HandCard[] = [
  { id: 'c1', name: '.45 手槍', cost: 2, desc: '武器(槍枝)— 攻擊 +2', rarity: 'uncommon' },
  { id: 'c2', name: '懷錶', cost: 1, desc: '資產 — 重擲一次當前檢定', rarity: 'common' },
  { id: 'c3', name: '街頭知識', cost: 1, desc: '技能 — 調查時 +2 感知', rarity: 'common' },
  { id: 'c4', name: '不退讓', cost: 0, desc: '事件 — 反應:取消 1 點傷害', rarity: 'rare' },
  { id: 'c5', name: '舊日筆記', cost: 1, desc: '資產(書籍)— 抽 2 張卡', rarity: 'common' },
];

const HAND_CARD_BY_ID: Record<string, HandCard> = Object.fromEntries(HAND_CARD_DEFS.map((c) => [c.id, c]));

const LOCATION_META: Record<string, { name: string; desc: string; lockedDesc: string }> = {
  alley: {
    name: '昏暗小巷',
    desc: '潮濕的鵝卵石,遠處模糊燈光。空氣裡有泥土與菸草味。',
    lockedDesc: '',
  },
  bookshop: {
    name: '舊書店',
    desc: '霉味、未拆包裹、地下室低響。',
    lockedDesc: '一道鏽蝕的鐵閘把書店與小巷隔開。你需要先在這裡找到線索,才能撬開它。',
  },
  backdoor: {
    name: '霧中後門',
    desc: '門縫透出冷氣,隱約有東西在另一側。',
    lockedDesc: '濃霧與磚牆截斷了去路。先在書店裡看看那個包裹,你才會知道門後是什麼。',
  },
};

function makeInitialInvestigator(): InvestigatorState {
  return {
    investigatorId: 'inv-1',
    investigatorDefinitionId: 'def-范例調查員',
    ownerPlayerId: 'p1',
    attributes: {
      strength: 4, agility: 3, constitution: 3, reflex: 3,
      intellect: 3, willpower: 3, perception: 4, charisma: 3,
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
    unlockedLocations: ['alley'], // 教學:初始只解鎖 alley
    enemies: [
      // backdoor 那隻怪物先放著(spawn 時機:抵達 backdoor 才揭示在敘事中)
      { instanceId: 'e1', enemyDefinitionId: 'def-shadow-stalker', locationId: 'backdoor', hp: 3, engagedWith: [], modifiers: [] },
    ],
    tokens: [],
    agendaProgress: 0,
    objectiveProgress: 0,
    chaosBag: [],
    turnNumber: 1,
    phase: 'short_rest_decision',
  };
}

function describeEffect(eff: ResultEffect): string {
  const p = eff.params as Record<string, unknown>;
  switch (eff.type) {
    case 'spend_action_point': return '扣 ' + (p.amount as number) + ' 行動點';
    case 'gain_resource': return '獲得 ' + (p.amount as number) + ' 資源';
    case 'draw_card': return '抽 1 張卡 → 手牌';
    case 'deck_empty_horror': return '⚠ 牌庫空,改受 ' + (p.amount as number) + ' 點恐懼(§3.3)';
    case 'move': return '移動 ' + (LOCATION_META[p.from as string]?.name || p.from) + ' → ' + (LOCATION_META[p.to as string]?.name || p.to);
    case 'attack_of_opportunity_warning': return '⚠ 交戰中強行移動 — 應觸發藉機攻擊(§7.2)';
    case 'roll_d20': {
      const a = p.attribute as string;
      const attrZh: Record<string, string> = { strength: '力量', agility: '敏捷', perception: '感知' };
      return '🎲 d20 = ' + (p.roll as number) + ' + ' + (attrZh[a] || a) + ' ' + (p.modifier as number) + ' = ' + (p.total as number) + ' vs DC ' + (p.dc as number) + ' → ' + (p.outcome as string);
    }
    case 'investigate_success': return '🔎 ' + (p.narrative as string);
    case 'investigate_fail': return '🔎 ' + (p.narrative as string);
    case 'gain_clue': return '+1 線索';
    case 'attack_hit': return '⚔ 命中(' + (p.damage as number) + ' 點傷害)— ' + (p.narrative as string);
    case 'attack_miss': return '⚔ ' + (p.narrative as string);
    case 'enemy_defeated': return '☠ ' + (p.narrative as string);
    default: return eff.type;
  }
}

export function TestScenarioScreen() {
  const navigate = useNavigate();

  const bus = useMemo(() => createInMemoryMessageBus(), []);
  const turnLoopRef = useRef<ReturnType<typeof createTurnLoop> | null>(null);
  if (turnLoopRef.current === null) {
    turnLoopRef.current = createTurnLoop({ bus, source: 'engine' });
  }

  const [investigator, setInvestigator] = useState<InvestigatorState>(makeInitialInvestigator);
  const [scenario, setScenario] = useState<ScenarioState>(makeInitialScenario);
  const [phase, setPhase] = useState<TurnPhase>('short_rest_decision');
  const [turnNumber, setTurnNumber] = useState(1);
  const [keeperEnergy, setKeeperEnergy] = useState(8);
  const [activeCard, setActiveCard] = useState<HandCard | null>(null);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [tutorialDone, setTutorialDone] = useState(false);
  const [log, setLog] = useState<string[]>([
    '──── 三地點教學關卡 開始 ────',
    '寫死的調查員站在【昏暗小巷】。',
    '本關目標:逐一解鎖三個地點,驗證調查、遭遇、戰鬥三個系統。',
    '進入調查員階段後,先試試「調查」找出通往書店的線索。',
  ]);

  const append = (s: string) => setLog((l) => [...l.slice(-20), s]);

  // 訂閱訊息匯流排
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

  // 解鎖鏈邏輯:監聽 scenario / investigator 變化
  useEffect(() => {
    // 第一地點完成:在 alley 找到 1 線索 → 解鎖 bookshop
    const cluesAtAlley = scenario.tokens.filter((t) => t.locationId === 'alley' && t.tokenType === 'clue').reduce((s, t) => s + t.amount, 0);
    if (cluesAtAlley >= 1 && !scenario.unlockedLocations.includes('bookshop')) {
      setScenario((s) => ({ ...s, unlockedLocations: [...s.unlockedLocations, 'bookshop'] }));
      append('🗝 線索拼出書店後門的位置 — 【舊書店】已解鎖,可移動。');
    }
  }, [scenario.tokens, scenario.unlockedLocations]);

  // 第二地點:抵達 bookshop 時自動觸發遭遇事件 + 解鎖 backdoor
  const lastLocationRef = useRef<string | null>(investigator.currentLocationId);
  useEffect(() => {
    const loc = investigator.currentLocationId;
    if (loc !== lastLocationRef.current) {
      lastLocationRef.current = loc;
      if (loc === 'bookshop') {
        // 遭遇事件
        append('📜 [遭遇] 一張未拆封的牛皮紙包裹靜靜躺在櫃台上,寫著你的名字。');
        append('📜 你拆開包裹,裡面是一張褪色的霧中後門照片與一把鏽鑰匙。');
        if (!scenario.unlockedLocations.includes('backdoor')) {
          setScenario((s) => ({ ...s, unlockedLocations: [...s.unlockedLocations, 'backdoor'] }));
          append('🗝 你聽見遠方有什麼東西在等 — 【霧中後門】已解鎖(障礙物 2 行動點)。');
        }
      } else if (loc === 'backdoor') {
        const enemyHere = scenario.enemies.find((e) => e.locationId === 'backdoor' && e.hp > 0);
        if (enemyHere) {
          append('⚠ 你推開門,看見那東西。霧中浮現一個影子,牠開始朝你逼近。');
          append('⚠ [遭遇怪物] 影潛者(hp ' + enemyHere.hp + ')— 點「攻擊」嘗試擊敗牠。');
        }
      }
    }
  }, [investigator.currentLocationId, scenario.enemies, scenario.unlockedLocations]);

  // 教學完成:backdoor 怪物被擊敗
  useEffect(() => {
    const allEnemiesDown = scenario.enemies.every((e) => e.hp <= 0);
    if (allEnemiesDown && investigator.currentLocationId === 'backdoor' && !tutorialDone) {
      setTutorialDone(true);
      append('🎉 [教學完成] 你擊敗了影潛者。三地點皆已驗證:調查 / 遭遇 / 戰鬥。');
      append('🎉 G1 教學關卡通關 — 後續里程碑會接上完整的卡片、混沌袋、戰鬥風格卡。');
    }
  }, [scenario.enemies, investigator.currentLocationId, tutorialDone]);

  // ─── 動作:走訊息協議 ──────────────────
  const submitIntent = (
    actionType: IntentMessage['actionType'],
    payload: Record<string, unknown> = {}
  ) => {
    const intent: IntentMessage = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION,
      source: 'p1', kind: 'intent', actionType, payload,
      playerId: 'p1', investigatorId: investigator.investigatorId,
    };
    bus.publish(intent);
    const turn: TurnState = { turnNumber, phase, actionPointsSpent: {}, pendingLegendaryActions: [], triggeredReactions: [] };
    const ctx: RuleContext = { scenario, investigator, turn, investigators: { [investigator.investigatorId]: investigator } };
    const out = resolveIntent(intent, ctx);
    bus.publish(out.result);
    if (out.newState?.investigator) setInvestigator(out.newState.investigator);
    if (out.newState?.scenario) setScenario(out.newState.scenario);
  };

  // 階段控制
  const startInvestigatorPhase = () => { turnLoopRef.current?.advance(); append('[階段切換] 進入調查員階段(3 行動點)'); };
  const takeShortRest = () => {
    turnLoopRef.current?.setPhase('mythos', turnNumber);
    setInvestigator((i) => ({ ...i, actionPoints: 0 }));
    append('[短休息] 本回合直接進入神話階段');
  };
  const enterMythosPhase = () => {
    turnLoopRef.current?.advance();
    setKeeperEnergy((e) => Math.max(0, e - 2));
    append('[階段切換] 進入神話階段(2 秒色調變暗)');
    setTimeout(() => append('[城主行動] 黑暗從牆角滲出。'), 1200);
    setTimeout(() => append('[環境敘事] 窗外的雨變大了。'), 2400);
  };
  const endTurn = () => {
    turnLoopRef.current?.advance();
    turnLoopRef.current?.advance();
    setInvestigator((i) => ({ ...i, actionPoints: 3 }));
    setKeeperEnergy((e) => Math.min(12, e + 1));
  };

  // 三合一(stub)
  const usePlay = () => { if (activeCard) { submitIntent('play_card', { cardInstanceId: activeCard.id }); setActiveCard(null); } };
  const useCommit = () => { if (activeCard) { submitIntent('commit_attribute_icon', { cardInstanceId: activeCard.id }); setActiveCard(null); } };
  const useConsume = () => { if (activeCard) { submitIntent('consume', { cardInstanceId: activeCard.id }); setActiveCard(null); } };

  // ─── 衍生資料 ──────────────────────
  const currentLocation = investigator.currentLocationId;
  const actionPoints = investigator.actionPoints;
  const handCards = investigator.hand.map((id) => HAND_CARD_BY_ID[id]).filter((x): x is HandCard => !!x);
  const enemyHere: EnemyInstance | undefined = scenario.enemies.find((e) => e.locationId === currentLocation && e.hp > 0);
  const isLocationUnlocked = (id: string) => scenario.unlockedLocations.includes(id);
  const currentLocInstance = scenario.locations.find((l) => l.locationDefinitionId === currentLocation);
  const moveTargets = currentLocInstance ? currentLocInstance.connectedTo : [];

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
              <div className="ts-bar ts-bar-hp"><div className="ts-bar-fill" style={{ width: `${(investigator.hp / investigator.hpMax) * 100}%` }} /></div>
              <span className="ts-bar-num">{investigator.hp}/{investigator.hpMax}</span>
            </div>
            <div className="ts-bar-row">
              <span className="ts-bar-label">SAN</span>
              <div className="ts-bar ts-bar-san"><div className="ts-bar-fill" style={{ width: `${(investigator.san / investigator.sanMax) * 100}%` }} /></div>
              <span className="ts-bar-num">{investigator.san}/{investigator.sanMax}</span>
            </div>

            <div className="ts-ap-row">
              <span className="ts-ap-label">行動點</span>
              <div className="ts-ap-gears">
                {[0, 1, 2].map((i) => (<span key={i} className={'ts-gear' + (i < actionPoints ? ' active' : '')}>⚙</span>))}
              </div>
            </div>

            <div className="ts-loc-info">
              在 <strong>{LOCATION_META[currentLocation || '']?.name ?? '未知'}</strong>
            </div>
            <div className="ts-statuses">
              <span className="ts-status">資源 {investigator.resources}</span>
              <span className="ts-status">手牌 {investigator.hand.length}</span>
              <span className="ts-status">線索 {scenario.objectiveProgress}</span>
            </div>

            {/* 五個動作按鈕(調查員階段才出現) */}
            {phase === 'investigator' && (
              <div className="ts-actions-quick">
                <button className="ts-action-btn" onClick={() => submitIntent('gain_resource')}>拿資源(1 行動點)</button>
                <button className="ts-action-btn" onClick={() => submitIntent('draw_card')}>抽卡(1 行動點)</button>
                <button className="ts-action-btn" onClick={() => submitIntent('investigate')}>調查(1 行動點)</button>
                <button className="ts-action-btn" onClick={() => setMoveMenuOpen(true)}>移動 →</button>
                {enemyHere && (
                  <button className="ts-action-btn ts-attack-btn" onClick={() => submitIntent('attack', { enemyInstanceId: enemyHere.instanceId })}>
                    ⚔ 攻擊({enemyHere.enemyDefinitionId.replace('def-', '')})
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>

        <main className="ts-center">
          <section className="ts-locations">
            <h3 className="ts-section-title">地點區(俯瞰 — 三地點解鎖鏈)</h3>
            <div className="ts-loc-row">
              {scenario.locations.map((loc, i) => {
                const meta = LOCATION_META[loc.locationDefinitionId];
                const unlocked = isLocationUnlocked(loc.locationDefinitionId);
                return (
                  <div
                    key={loc.locationDefinitionId}
                    className={
                      'ts-loc-card' +
                      (loc.locationDefinitionId === currentLocation ? ' active' : '') +
                      (unlocked ? '' : ' locked') +
                      ' vis-' + loc.visibility
                    }
                  >
                    <div className="ts-loc-name">
                      {!unlocked && <span className="ts-loc-lock">🔒</span>}
                      {meta?.name ?? loc.locationDefinitionId}
                    </div>
                    <div className="ts-loc-desc">
                      {unlocked ? meta?.desc : meta?.lockedDesc || '尚未解鎖'}
                    </div>
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
                      <span className={'ts-loc-link' + (scenario.locations[i + 1].isObstacle ? ' obstacle' : '')} aria-hidden />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="ts-encounter">
            <h3 className="ts-section-title">遭遇區</h3>
            <div className="ts-encounter-body">
              {currentLocation === 'bookshop' ? (
                <div className="ts-encounter-event">
                  <strong>📜 牛皮紙包裹</strong>
                  <p>褪色的霧中後門照片 + 鏽鑰匙</p>
                </div>
              ) : enemyHere ? (
                <div className="ts-encounter-enemy">
                  <strong>⚠ 影潛者</strong>
                  <p>HP {enemyHere.hp} — 牠正盯著你</p>
                </div>
              ) : (
                <div className="ts-encounter-empty">
                  目前無遭遇<br /><small>(進入特定地點觸發)</small>
                </div>
              )}
            </div>
          </section>
        </main>

        <aside className="ts-right">
          <h3 className="ts-section-title">回合追蹤</h3>
          <div className="ts-turn-num">第 {turnNumber} 回合</div>
          <div className="ts-phase">階段:<strong>
            {phase === 'short_rest_decision' && '短休息決定'}
            {phase === 'investigator' && '調查員階段'}
            {phase === 'mythos' && '神話階段'}
            {phase === 'turn_end' && '回合結束'}
          </strong></div>

          {phase === 'short_rest_decision' && (
            <div className="ts-rest-buttons">
              <button className="ts-rest ts-rest-no" onClick={startInvestigatorPhase}>不休息 → 3 行動點</button>
              <button className="ts-rest ts-rest-yes" onClick={takeShortRest}>短休息 → 跳神話</button>
            </div>
          )}
          {phase === 'investigator' && <button className="ts-end-phase" onClick={enterMythosPhase}>結束調查員階段 →</button>}
          {phase === 'mythos' && <button className="ts-end-phase" onClick={endTurn}>結束神話階段 → 下回合</button>}

          <div className="ts-tracker">
            <div className="ts-tracker-row">
              <span className="ts-tracker-label">線索進度</span>
              <div className="ts-tracker-bar"><div className="ts-tracker-fill ts-clue" style={{ width: `${Math.min(scenario.objectiveProgress, 5) * 20}%` }} /></div>
              <span className="ts-tracker-num">{scenario.objectiveProgress}/5</span>
            </div>
            <div className="ts-tracker-row">
              <span className="ts-tracker-label">議程進度</span>
              <div className="ts-tracker-bar"><div className="ts-tracker-fill ts-doom" style={{ width: `${Math.min(scenario.agendaProgress, 6) * 100 / 6}%` }} /></div>
              <span className="ts-tracker-num">毀滅 {scenario.agendaProgress}/6</span>
            </div>
            <div className="ts-tracker-row">
              <span className="ts-tracker-label">教學解鎖</span>
              <span className="ts-tracker-num">{scenario.unlockedLocations.length} / 3 地點</span>
            </div>
          </div>
        </aside>
      </div>

      {/* 移動目標選擇 modal */}
      {moveMenuOpen && (
        <div className="ts-card-modal" onClick={() => setMoveMenuOpen(false)}>
          <div className="ts-card-zoom" onClick={(e) => e.stopPropagation()}>
            <h2 className="ts-zoom-name">移動到哪裡?</h2>
            <p className="ts-zoom-desc">選一個相鄰地點。障礙物地點需 2 行動點;未解鎖地點不可選。</p>
            <div className="ts-zoom-actions">
              {moveTargets.map((tid) => {
                const meta = LOCATION_META[tid];
                const target = scenario.locations.find((l) => l.locationDefinitionId === tid);
                const unlocked = isLocationUnlocked(tid);
                const cost = target?.isObstacle ? 2 : 1;
                return (
                  <button
                    key={tid}
                    className={'ts-action ts-action-' + (unlocked ? 'play' : 'consume')}
                    disabled={!unlocked}
                    onClick={() => { submitIntent('move', { targetLocationId: tid }); setMoveMenuOpen(false); }}
                  >
                    {unlocked ? '' : '🔒 '}{meta?.name ?? tid}
                    <small>{unlocked ? `相鄰 · ${cost} 行動點` : '尚未解鎖'}</small>
                  </button>
                );
              })}
            </div>
            <button className="ts-zoom-close" onClick={() => setMoveMenuOpen(false)}>取消</button>
          </div>
        </div>
      )}

      {/* 手牌區(視覺占位 — 三合一邏輯尚未接) */}
      <section className="ts-hand">
        <h3 className="ts-section-title">手牌(扇形 — 三合一邏輯後續接)</h3>
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
                title="點選查看三合一用途(stub)"
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
              <button className="ts-action ts-action-play" onClick={usePlay}>打出 <small>(stub,後續實作)</small></button>
              <button className="ts-action ts-action-commit" onClick={useCommit}>加值 <small>(stub)</small></button>
              <button className="ts-action ts-action-consume" onClick={useConsume}>消費 <small>(stub)</small></button>
            </div>
            <button className="ts-zoom-close" onClick={() => setActiveCard(null)}>取消</button>
          </div>
        </div>
      )}

      <section className="ts-log">
        <h3 className="ts-section-title">事件記錄</h3>
        <div className="ts-log-body">
          {log.map((line, i) => (<p key={i}>{line}</p>))}
        </div>
      </section>

      <footer className="ts-foot">
        <p>
          ⚠ G1 教學關卡:三地點解鎖鏈驗證 調查/遭遇/戰鬥。卡片三合一 stub,後續里程碑接。
        </p>
      </footer>
    </div>
  );
}
