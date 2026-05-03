import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
 * 戰鬥板 — Mapground V1 框架(滿版地圖 + 5 個浮層 block)
 *
 * 框架(1:1 抄 demo):
 *   block-4 底層滿版地圖 — pan/zoom 地點 grid,從 scenario.locations 動態展開
 *   block-1 左上 城主資訊 — 議程 + 城主能量 + 毀滅標記 → 點開「議程詳情」modal
 *   block-2 左上 當前幕  — 幕標題 + phase dots + 線索進度  → 點開「幕階段」modal
 *   block-3 左下 1/4 圓玩家 — 頭像 + 4 弧形按鈕(理智/體力/手牌/背包)
 *   block-5 右滿高 敘事 LOG — 可收/展;收合時顯示最後一則 preview
 *
 * Overlays:
 *   location-bar (頂部滑下,5 秒 auto-close)
 *   bottom-panel × 2 (手牌 / 背包)
 *   modal × 3 (議程 / 幕 / 隊伍)
 *
 * 內容資料接點(全部來自現有 state):
 *   scenario.locations         → 地圖 grid
 *   scenario.agendaProgress    → 城主毀滅標記 + 議程 modal 進度
 *   scenario.objectiveProgress → 線索 + 幕 modal 進度
 *   investigator.{hp,san,hand,assetsInPlay,actionPoints,currentLocationId}
 *   keeperEnergy, log, phase, turnNumber → 對應浮層
 *
 * 教學解鎖鏈邏輯保留(三地點漸進)— 是內容邏輯不是框架。
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
    unlockedLocations: ['alley'],
    enemies: [
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

const PHASE_LABEL: Record<TurnPhase, string> = {
  short_rest_decision: '短休息決定',
  investigator: '調查員階段',
  mythos: '神話階段',
  turn_end: '回合結束',
};

const PHASE_ORDER: TurnPhase[] = ['short_rest_decision', 'investigator', 'mythos', 'turn_end'];

type ModalType = null | 'keeper' | 'act' | 'team';
type PanelType = null | 'hand' | 'bag';

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
  const [log, setLog] = useState<string[]>([
    '──── 三地點教學關卡 開始 ────',
    '寫死的調查員站在【昏暗小巷】。',
    '本關目標:逐一解鎖三個地點,驗證調查、遭遇、戰鬥三個系統。',
    '進入調查員階段後,先試試「調查」找出通往書店的線索。',
  ]);

  // 浮層狀態
  const [modal, setModal] = useState<ModalType>(null);
  const [panel, setPanel] = useState<PanelType>(null);
  const [locationBarId, setLocationBarId] = useState<string | null>(null);
  const [logCollapsed, setLogCollapsed] = useState(false);
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const [systemSub, setSystemSub] = useState<null | 'settings' | 'rules'>(null);

  // 地圖 pan / zoom
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const [zoom, setZoom] = useState(1);

  const append = (s: string) => setLog((l) => [...l.slice(-50), s]);

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

  // 解鎖鏈 + 教學流程(內容邏輯,框架照舊保留)
  useEffect(() => {
    const cluesAtAlley = scenario.tokens.filter((t) => t.locationId === 'alley' && t.tokenType === 'clue').reduce((s, t) => s + t.amount, 0);
    if (cluesAtAlley >= 1 && !scenario.unlockedLocations.includes('bookshop')) {
      setScenario((s) => ({ ...s, unlockedLocations: [...s.unlockedLocations, 'bookshop'] }));
      append('🗝 線索拼出書店後門的位置 — 【舊書店】已解鎖,可移動。');
    }
  }, [scenario.tokens, scenario.unlockedLocations]);

  const lastLocationRef = useRef<string | null>(investigator.currentLocationId);
  useEffect(() => {
    const loc = investigator.currentLocationId;
    if (loc !== lastLocationRef.current) {
      lastLocationRef.current = loc;
      if (loc === 'bookshop') {
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

  // 教學完成
  const tutorialDoneRef = useRef(false);
  useEffect(() => {
    const allEnemiesDown = scenario.enemies.every((e) => e.hp <= 0);
    if (allEnemiesDown && investigator.currentLocationId === 'backdoor' && !tutorialDoneRef.current) {
      tutorialDoneRef.current = true;
      append('🎉 [教學完成] 你擊敗了影潛者。三地點皆已驗證:調查 / 遭遇 / 戰鬥。');
    }
  }, [scenario.enemies, investigator.currentLocationId]);

  // ─── 動作匯流(訊息協議閉環) ──────────────────
  const submitIntent = useCallback((
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
  }, [bus, investigator, scenario, turnNumber, phase]);

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
    append('[階段切換] 進入神話階段');
    setTimeout(() => append('[城主行動] 黑暗從牆角滲出。'), 1200);
  };
  const endTurn = () => {
    turnLoopRef.current?.advance();
    turnLoopRef.current?.advance();
    setInvestigator((i) => ({ ...i, actionPoints: 3 }));
    setKeeperEnergy((e) => Math.min(12, e + 1));
  };

  // ─── 浮層互動 ──────────────────
  const closeAllOverlays = useCallback(() => {
    setModal(null); setPanel(null); setLocationBarId(null);
    setSystemMenuOpen(false); setSystemSub(null);
  }, []);

  const openModal = (t: ModalType) => { closeAllOverlays(); setModal(t); };
  const openPanel = (t: PanelType) => { closeAllOverlays(); setPanel(t); };

  // ESC 關所有浮層
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAllOverlays(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeAllOverlays]);

  // 地點 bar 5 秒自動關
  useEffect(() => {
    if (!locationBarId) return;
    const t = setTimeout(() => setLocationBarId(null), 5000);
    return () => clearTimeout(t);
  }, [locationBarId]);

  // ─── 地圖 pan / zoom ──────────────────
  const onMapMouseDown = (e: React.MouseEvent) => {
    const v = viewportRef.current; if (!v) return;
    dragRef.current = { x: e.pageX, y: e.pageY, sl: v.scrollLeft, st: v.scrollTop, moved: false };
  };
  const onMapMouseMove = (e: React.MouseEvent) => {
    const v = viewportRef.current; const d = dragRef.current; if (!v || !d) return;
    const dx = e.pageX - d.x, dy = e.pageY - d.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) d.moved = true;
    v.scrollLeft = d.sl - dx * 1.5;
    v.scrollTop = d.st - dy * 1.5;
  };
  const onMapMouseUpOrLeave = () => { setTimeout(() => { dragRef.current = null; }, 0); };

  // touch:1 指 pan / 2 指 pinch
  const touchDist = (a: React.Touch, b: React.Touch) => {
    const dx = a.pageX - b.pageX, dy = a.pageY - b.pageY;
    return Math.hypot(dx, dy);
  };
  const onMapTouchStart = (e: React.TouchEvent) => {
    const v = viewportRef.current; if (!v) return;
    if (e.touches.length === 2) {
      // 雙指 pinch:存初始距離 + 當前 zoom
      pinchRef.current = { dist: touchDist(e.touches[0], e.touches[1]), zoom };
      dragRef.current = null;
    } else if (e.touches.length === 1) {
      // 單指 pan
      const t = e.touches[0];
      dragRef.current = { x: t.pageX, y: t.pageY, sl: v.scrollLeft, st: v.scrollTop, moved: false };
      pinchRef.current = null;
    }
  };
  const onMapTouchMove = (e: React.TouchEvent) => {
    const v = viewportRef.current; if (!v) return;
    if (e.touches.length === 2 && pinchRef.current) {
      // pinch 中:依雙指距離變化更新 zoom
      e.preventDefault();
      const d = touchDist(e.touches[0], e.touches[1]);
      const ratio = d / pinchRef.current.dist;
      const newZoom = Math.max(0.4, Math.min(2.5, pinchRef.current.zoom * ratio));
      setZoom(newZoom);
    } else if (e.touches.length === 1 && dragRef.current) {
      const t = e.touches[0];
      const dx = t.pageX - dragRef.current.x, dy = t.pageY - dragRef.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragRef.current.moved = true;
      v.scrollLeft = dragRef.current.sl - dx * 1.5;
      v.scrollTop = dragRef.current.st - dy * 1.5;
    }
  };
  const onMapTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) setTimeout(() => { dragRef.current = null; }, 0);
  };
  const onMapWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.4, Math.min(2.5, z + (e.deltaY > 0 ? -0.1 : 0.1))));
  };

  // 地圖置中(初始與每次 zoom 變化後)
  useEffect(() => {
    const v = viewportRef.current; if (!v) return;
    v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2;
    v.scrollTop = (v.scrollHeight - v.clientHeight) / 2;
  }, []);

  // iPad 雙指縮放與滑鼠滾輪縮放需 passive: false 才能 preventDefault
  // 否則 iOS Safari 會走原生雙指縮放整個頁面
  useEffect(() => {
    const v = viewportRef.current; if (!v) return;
    const nativeWheel = (e: WheelEvent) => { e.preventDefault(); };
    const nativeTouch = (e: TouchEvent) => {
      if (e.touches.length === 2) e.preventDefault();
    };
    v.addEventListener('wheel', nativeWheel, { passive: false });
    v.addEventListener('touchmove', nativeTouch, { passive: false });
    return () => {
      v.removeEventListener('wheel', nativeWheel);
      v.removeEventListener('touchmove', nativeTouch);
    };
  }, []);

  // 地點點擊
  const onLocationClick = (locId: string) => {
    if (dragRef.current?.moved) return;
    setLocationBarId(locId);
  };

  // ─── 衍生資料 ──────────────────────
  const handCards = investigator.hand.map((id) => HAND_CARD_BY_ID[id]).filter((x): x is HandCard => !!x);
  const enemyHere: EnemyInstance | undefined = scenario.enemies.find((e) => e.locationId === investigator.currentLocationId && e.hp > 0);
  const isLocationUnlocked = (id: string) => scenario.unlockedLocations.includes(id);
  const currentLocInstance = scenario.locations.find((l) => l.locationDefinitionId === investigator.currentLocationId);
  const moveTargets = currentLocInstance ? currentLocInstance.connectedTo : [];

  // 地圖 grid:依地點數動態決定列數(<=3 用 1 行,4-9 用 3×3,>9 用 4×N)
  const locCount = scenario.locations.length;
  const gridCols = locCount <= 3 ? locCount : (locCount <= 9 ? 3 : 4);

  // 議程 / 幕的進度
  const agendaMax = 6;
  const objectiveMax = 12;
  const agendaPct = Math.min(100, (scenario.agendaProgress / agendaMax) * 100);
  const objectivePct = Math.min(100, (scenario.objectiveProgress / objectiveMax) * 100);

  // 隊伍 modal:現階段單人 → [investigator]
  const teamMembers = [investigator];

  // phase dots:目前 4 階段(短休息/調查員/神話/結束)
  const phaseIdx = PHASE_ORDER.indexOf(phase);
  const lastLogText = log[log.length - 1] || '';

  return (
    <div className="bg-root">
      <div className="battle-screen">

        {/* === Block 4 底層滿版地圖 === */}
        <main className="location-map">
          <div className="map-texture" />
          <div
            className="map-viewport"
            ref={viewportRef}
            onMouseDown={onMapMouseDown}
            onMouseMove={onMapMouseMove}
            onMouseUp={onMapMouseUpOrLeave}
            onMouseLeave={onMapMouseUpOrLeave}
            onTouchStart={onMapTouchStart}
            onTouchMove={onMapTouchMove}
            onTouchEnd={onMapTouchEnd}
            onTouchCancel={onMapTouchEnd}
            onWheel={onMapWheel}
          >
            <div className="map-content">
              <div
                className="map-grid"
                style={{
                  gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                  width: gridCols * 200 + (gridCols - 1) * 40,
                  transform: `scale(${zoom})`,
                }}
              >
                {scenario.locations.map((loc) => {
                  const meta = LOCATION_META[loc.locationDefinitionId];
                  const unlocked = isLocationUnlocked(loc.locationDefinitionId);
                  const isCurr = loc.locationDefinitionId === investigator.currentLocationId;
                  const cluesHere = scenario.tokens.filter((t) => t.locationId === loc.locationDefinitionId && t.tokenType === 'clue').reduce((s, t) => s + t.amount, 0);
                  const maxClues = 2;
                  return (
                    <div
                      key={loc.locationDefinitionId}
                      className={'location-card' + (isCurr ? ' current-loc' : '') + (unlocked ? '' : ' locked')}
                      onClick={() => onLocationClick(loc.locationDefinitionId)}
                    >
                      {isCurr && <div className="player-token">P1</div>}
                      <div className="loc-name">{!unlocked && '🔒 '}{meta?.name ?? loc.locationDefinitionId}</div>
                      <div className="loc-illustration" />
                      <div className="loc-clues">
                        {Array.from({ length: maxClues }).map((_, i) => (
                          <div key={i} className={'clue-dot' + (i < cluesHere ? ' has-clue' : '')} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </main>

        {/* === 左上 UI 群組(Block 1 + Block 2)=== */}
        <div className="top-left-ui">
          <section className="block-container clickable-block keeper-info" onClick={() => openModal('keeper')}>
            <div className="keeper-title">議程 1</div>
            <div className="keeper-badges">
              <div className="badge-energy">
                <span className="badge-num">{keeperEnergy}</span>
                <span className="badge-label">城主能量</span>
              </div>
              <div className="badge-doom">
                <span className="badge-num">{scenario.agendaProgress}</span>
                <span className="badge-label">毀滅標記</span>
              </div>
            </div>
          </section>

          <section className="block-container clickable-block current-act" onClick={() => openModal('act')}>
            <div className="act-title">幕 1</div>
            <div className="act-details">
              <div className="phase-dots">
                {PHASE_ORDER.map((p, i) => (
                  <div key={p} className={'dot ' + (i <= phaseIdx ? 'done' : 'pending')} />
                ))}
              </div>
              <div className="act-progress">{scenario.objectiveProgress}/{objectiveMax} 線索</div>
            </div>
          </section>
        </div>

        {/* === Block 3 左下 1/4 圓玩家 === */}
        <div className="block-3-quarter">
          <div className="quarter-avatar-area" onClick={() => openModal('team')}>
            <div className="quarter-avatar-bg" />
            <div className="quarter-name-banner">范例調查員</div>
          </div>

          <div className="arc-btn arc-btn-san" title={`理智 ${investigator.san}/${investigator.sanMax}`}>
            <span className="arc-num">{investigator.san}</span>
            <span className="arc-label">理智</span>
          </div>
          <div className="arc-btn arc-btn-hp" title={`體力 ${investigator.hp}/${investigator.hpMax}`}>
            <span className="arc-num">{investigator.hp}</span>
            <span className="arc-label">體力</span>
          </div>
          <div className="arc-btn arc-btn-hand" onClick={() => openPanel('hand')} title="開啟手牌">
            <span className="arc-icon">🂠</span>
            <span className="arc-num">{investigator.hand.length}</span>
          </div>
          <div className="arc-btn arc-btn-bag" onClick={() => openPanel('bag')} title="開啟背包">
            <span className="arc-icon">🎒</span>
          </div>
        </div>

        {/* === Block 5 右滿高敘事 LOG === */}
        <aside className={'narrative-log' + (logCollapsed ? ' collapsed' : '')}>
          <div className="log-title" onClick={() => setLogCollapsed((v) => !v)}>
            <span>✦ 戰役紀錄 ✦</span>
            <span>{logCollapsed ? '▼' : '▲'}</span>
          </div>

          <div className="log-scroll-area">
            {log.map((line, i) => (
              <div className="log-entry" key={i}>
                <div className="log-content">{line}</div>
              </div>
            ))}
          </div>

          <div className="log-preview" onClick={() => setLogCollapsed(false)}>
            <div className="log-entry">
              <div className="log-content">{lastLogText}</div>
            </div>
          </div>
        </aside>

        {/* === 階段控制(浮在地圖上方,需要時才出現)=== */}
        <div className="phase-control">
          <div className="phase-info">
            T{turnNumber} · {PHASE_LABEL[phase]} · 行動點 {investigator.actionPoints}
          </div>
          {phase === 'short_rest_decision' && (
            <div className="phase-buttons">
              <button onClick={startInvestigatorPhase}>不休息 → 3 行動點</button>
              <button onClick={takeShortRest}>短休息 → 跳神話</button>
            </div>
          )}
          {phase === 'investigator' && (
            <div className="phase-buttons">
              <button onClick={() => submitIntent('gain_resource')}>拿資源</button>
              <button onClick={() => submitIntent('draw_card')}>抽卡</button>
              <button onClick={() => submitIntent('investigate')}>調查</button>
              {moveTargets.map((tid) => {
                const meta = LOCATION_META[tid];
                const target = scenario.locations.find((l) => l.locationDefinitionId === tid);
                const unlocked = isLocationUnlocked(tid);
                const cost = target?.isObstacle ? 2 : 1;
                return (
                  <button key={tid} disabled={!unlocked} onClick={() => submitIntent('move', { targetLocationId: tid })}>
                    {unlocked ? '' : '🔒 '}移動→{meta?.name ?? tid}({cost} AP)
                  </button>
                );
              })}
              {enemyHere && (
                <button className="attack" onClick={() => submitIntent('attack', { enemyInstanceId: enemyHere.instanceId })}>
                  ⚔ 攻擊
                </button>
              )}
              <button onClick={enterMythosPhase}>結束調查員階段 →</button>
            </div>
          )}
          {phase === 'mythos' && (
            <div className="phase-buttons">
              <button onClick={endTurn}>結束神話階段 → 下回合</button>
            </div>
          )}
        </div>

      </div>

      {/* === 地點 bar(從上滑下,5 秒 auto-close)=== */}
      {locationBarId && (() => {
        const loc = scenario.locations.find((l) => l.locationDefinitionId === locationBarId);
        const meta = LOCATION_META[locationBarId];
        const cluesHere = scenario.tokens.filter((t) => t.locationId === locationBarId && t.tokenType === 'clue').reduce((s, t) => s + t.amount, 0);
        const unlocked = isLocationUnlocked(locationBarId);
        return (
          <div className="location-bar active">
            <div className="loc-bar-title">{meta?.name ?? locationBarId}</div>
            <div className="loc-bar-details">
              <span>狀態: {unlocked ? '已解鎖' : '🔒 未解鎖'}</span>
              <span>線索: {cluesHere}/2 已收集</span>
              <span>{loc?.isObstacle ? '⚠ 障礙物' : '可進入'}</span>
            </div>
          </div>
        );
      })()}

      {/* === 底部 Panel(手牌)=== */}
      {panel === 'hand' && (
        <div className="bottom-panel active">
          <div className="panel-close" onClick={() => setPanel(null)}>[✕ 關閉]</div>
          <div className="panel-title">手牌 ({handCards.length})</div>
          <div className="mock-cards">
            {handCards.map((card, i) => {
              const center = (handCards.length - 1) / 2;
              const offset = i - center;
              return (
                <div
                  key={card.id}
                  className={'mock-card rarity-' + card.rarity}
                  style={{ transform: `rotate(${offset * 4}deg) translateY(${Math.abs(offset) * 4}px)` }}
                  title={card.desc}
                >
                  <div className="mc-cost">{card.cost}</div>
                  <div className="mc-name">{card.name}</div>
                  <div className="mc-desc">{card.desc}</div>
                </div>
              );
            })}
            {handCards.length === 0 && <div className="empty-note">手牌空</div>}
          </div>
        </div>
      )}

      {/* === 底部 Panel(背包)=== */}
      {panel === 'bag' && (
        <div className="bottom-panel active">
          <div className="panel-close" onClick={() => setPanel(null)}>[✕ 關閉]</div>
          <div className="panel-title">背包 — 場上資產 ({investigator.assetsInPlay.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
              <div className="mock-slot">左手</div>
              <div className="mock-slot">身軀</div>
              <div className="mock-slot">右手</div>
            </div>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
              <div className="mock-slot">配件</div>
              <div className="mock-slot">盟友</div>
              <div className="mock-slot">神祕</div>
              <div className="mock-slot">神祕</div>
            </div>
          </div>
        </div>
      )}

      {/* === Modal 議程 === */}
      {modal === 'keeper' && (
        <div className="modal-backdrop active" onClick={(e) => { if (e.target === e.currentTarget) closeAllOverlays(); }}>
          <div className="modal-frame modal-keeper">
            <button className="modal-close" onClick={closeAllOverlays}>✕</button>
            <div className="modal-title">❖ 議程 1 · 毀滅的腳步 ❖</div>
            <div className="modal-illustration">議程插畫</div>
            <hr className="modal-divider" />
            <div className="modal-narrative">
              「祭壇上的蠟燭一盞接一盞地熄滅。每熄滅一盞,空氣中就多一分窒息感。某種無形的東西正在這座城鎮中累積它的力量,而你們所剩的時間越來越少。」
            </div>
            <hr className="modal-divider" />
            <div className="cond-title">推進條件:</div>
            <div className="cond-desc">累積 {agendaMax} 個毀滅標記時,議程將推進到下一張。</div>
            <hr className="modal-divider" />
            <div className="modal-progress-text">當前進度: {scenario.agendaProgress} / {agendaMax} 毀滅標記</div>
            <div className="modal-progress-bar"><div className="modal-progress-fill" style={{ width: `${agendaPct}%` }} /></div>
          </div>
        </div>
      )}

      {/* === Modal 幕 === */}
      {modal === 'act' && (
        <div className="modal-backdrop active" onClick={(e) => { if (e.target === e.currentTarget) closeAllOverlays(); }}>
          <div className="modal-frame modal-act">
            <button className="modal-close" onClick={closeAllOverlays}>✕</button>
            <div className="modal-title">❖ 幕 1 · 尋找線索 ❖</div>
            <div className="modal-illustration">幕插畫</div>
            <hr className="modal-divider" />
            <div className="modal-narrative">
              「報紙上刊登了一則奇怪的訊息——關於這座城鎮的某段未公開歷史。某些線索散落在各個地點,等待有心人去拼湊出全貌。」
            </div>
            <hr className="modal-divider" />
            <div className="cond-title">推進條件:</div>
            <div className="cond-desc">收集 {objectiveMax} 個線索,即可推進至下一張幕。</div>
            <div className="modal-progress-text">當前進度: {scenario.objectiveProgress} / {objectiveMax} 線索</div>
            <div className="modal-progress-bar"><div className="modal-progress-fill" style={{ width: `${objectivePct}%` }} /></div>
            <hr className="modal-divider" />
            <div className="phase-title">✦ 階段提示 ✦</div>
            <ul>
              {PHASE_ORDER.map((p, i) => (
                <li key={p} className={i < phaseIdx ? 'done' : (i === phaseIdx ? 'active' : 'pending')}>
                  <span className="p-dot">⬤</span> {PHASE_LABEL[p]}{i === phaseIdx && ' (當前)'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* === 右下系統按鈕 + 浮動選單 === */}
      <button
        className="system-fab"
        onClick={() => setSystemMenuOpen((v) => !v)}
        title="系統選單"
      >
        <span className="system-icon">⚙</span>
        <span>系統</span>
      </button>

      {systemMenuOpen && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 25 }}
            onClick={() => setSystemMenuOpen(false)}
          />
          <div className="system-menu" onClick={(e) => e.stopPropagation()}>
            <button className="system-menu-item" onClick={() => setSystemMenuOpen(false)}>
              ▶ 繼續遊戲
            </button>
            <div className="system-menu-divider" />
            <button className="system-menu-item" onClick={() => { setSystemMenuOpen(false); setSystemSub('settings'); }}>
              ⚙ 設定
            </button>
            <button className="system-menu-item" onClick={() => { setSystemMenuOpen(false); setSystemSub('rules'); }}>
              📖 遊戲規則
            </button>
            <div className="system-menu-divider" />
            <button
              className="system-menu-item danger"
              onClick={() => {
                if (confirm('確定要回到主選單嗎?目前進度將會遺失。')) navigate('/');
              }}
            >
              ⌂ 回主選單
            </button>
          </div>
        </>
      )}

      {systemSub && (
        <div className="system-sub-modal" onClick={(e) => { if (e.target === e.currentTarget) setSystemSub(null); }}>
          <div className="system-sub-frame">
            <button className="close-btn" onClick={() => setSystemSub(null)}>✕</button>
            {systemSub === 'settings' && (
              <>
                <h3>⚙ 設定</h3>
                <p>畫面、音效、文字大小、操作偏好等設定 — 待開發。</p>
                <p style={{ marginTop: 12, color: 'var(--text-tertiary)', fontSize: 12 }}>(M-Settings 里程碑接入)</p>
              </>
            )}
            {systemSub === 'rules' && (
              <>
                <h3>📖 遊戲規則</h3>
                <p>調查員階段規則、混沌袋判定、戰鬥流程、地點互動 ... — 待從 docs/ 注入規則總覽。</p>
                <p style={{ marginTop: 12, color: 'var(--text-tertiary)', fontSize: 12 }}>(M-Rulebook 里程碑接入)</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* === Modal 隊伍 === */}
      {modal === 'team' && (
        <div className="modal-backdrop active" onClick={(e) => { if (e.target === e.currentTarget) closeAllOverlays(); }}>
          <div className="modal-frame modal-team">
            <button className="modal-close" onClick={closeAllOverlays}>✕</button>
            <div className="modal-title">❖ 調查員小隊狀況 ❖</div>
            <hr className="modal-divider" />
            <div className="team-container">
              {teamMembers.map((inv, idx) => {
                const locName = LOCATION_META[inv.currentLocationId || '']?.name ?? '未知';
                return (
                  <div key={inv.investigatorId} className={'team-card tc-' + (idx + 1)}>
                    <div className={'team-avatar ta-' + (idx + 1)} />
                    <div className="tc-info">
                      <div className="tc-name">范例調查員</div>
                      <div className={'tc-faction f' + (idx + 1)}>E 號令陣營 · 玩家 {idx + 1}</div>
                      <div className="tc-stats">
                        <span className="tc-hp">體力 {inv.hp}/{inv.hpMax}</span>
                        <span className="tc-san">理智 {inv.san}/{inv.sanMax}</span>
                      </div>
                      <div className="tc-loc">所在地點: {locName}</div>
                    </div>
                    {idx === 0 && <div className="tc-turn-badge">★ 當前回合</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
