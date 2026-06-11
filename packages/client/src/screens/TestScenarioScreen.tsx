import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  createInMemoryMessageBus,
  createTurnLoop,
  resolveIntent,
  activateMonsters,
  spawnEnemy,
  runFearChecks,
  progressTick,
  addDoom,
  evaluateOutcome,
  applyOutcomeFlags,
  allInvestigatorsDown,
  buildGameFromBootstrap,
  CURRENT_MESSAGE_SCHEMA_VERSION,
} from '@cthulhu/shared';
import type { OutcomeData, ScenarioState, InvestigatorState } from '@cthulhu/shared';
import type {
  IntentMessage,
  ResultMessage,
  NotificationMessage,
  TurnState,
  TurnPhase,
  RuleContext,
  ResultEffect,
  EnemyInstance,
} from '@cthulhu/shared';
import { fetchBootstrap } from '../api';
import { getSelectedInvestigator } from '../game/selectedInvestigator';
import { makeTestSetup, buildSetupFromBootstrap } from '../game/gameSetup';
import type { GameSetup, LocationDisplay, CardDisplay } from '../game/gameSetup';
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

function describeEffect(eff: ResultEffect, locMeta: Record<string, LocationDisplay>): string {
  const p = eff.params as Record<string, unknown>;
  switch (eff.type) {
    case 'spend_action_point': return '扣 ' + (p.amount as number) + ' 行動點';
    case 'gain_resource': return '獲得 ' + (p.amount as number) + ' 資源';
    case 'draw_card': return '抽 1 張卡 → 手牌';
    case 'deck_empty_horror': return '⚠ 牌庫空,改受 ' + (p.amount as number) + ' 點恐懼(§3.3)';
    case 'move': return '移動 ' + (locMeta[p.from as string]?.name || p.from) + ' → ' + (locMeta[p.to as string]?.name || p.to);
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
    case 'commit_cards': return '🂠 投入 ' + ((p.cardInstanceIds as string[])?.length ?? 0) + ' 張手牌加值 +' + (p.bonus as number);
    case 'evade_success': return '🌀 ' + (p.narrative as string);
    case 'evade_fail': return '🌀 ' + (p.narrative as string) + '(受 ' + (p.damage as number) + ' 點傷害)';
    case 'play_card': return '🃏 打出「' + (p.name as string) + '」(費用 ' + (p.cost as number) + ')';
    case 'asset_enters_play': return '🛠 「' + (p.name as string) + '」進場';
    case 'card_action': return '🛠 使用「' + (p.name as string) + '」';
    case 'style_card_drawn': return '🎴 風格卡【' + (p.name as string) + '】— 本次檢定屬性:' + (p.attribute as string);
    case 'status_applied': return '🏷 施加「' + (p.status as string) + '」狀態';
    case 'search_deck': return '🔍 檢視牌庫頂 ' + (p.viewed as number) + ' 張,取走 ' + (p.taken as number) + ' 張';
    case 'effect_unsupported': return 'ℹ 部分卡面效果引擎尚未支援:' + ((p.codes as string[]) ?? []).join('、');
    case 'fear_check': return '😨 恐懼檢定 vs ' + (p.enemy as string) + ':d20 ' + (p.roll as number) + ' → ' + (p.total as number) + ' vs DC ' + (p.dc as number) + '(' + (p.outcome === 'success' ? '穩住了' : '失敗') + ')';
    case 'fear_damage': return '😱 ' + (p.narrative as string) + '(SAN -' + (p.amount as number) + ')';
    case 'monster_attack': return '👹 ' + (p.enemy as string) + ' 使出【' + (p.move as string) + '】— 你的' + (p.defenseAttribute as string) + '防禦:' + (p.total as number) + ' vs DC ' + (p.dc as number);
    case 'monster_attack_hit': return '💥 ' + (p.narrative as string) + '(HP -' + (p.physical as number) + (Number(p.horror) > 0 ? ' / SAN -' + (p.horror as number) : '') + ')';
    case 'monster_attack_missed': return '💨 ' + (p.narrative as string);
    case 'monster_move': return '👣 ' + (p.enemy as string) + ' 朝你逼近';
    case 'monster_engage': return '⚠ ' + (p.enemy as string) + ':' + (p.narrative as string);
    case 'attack_of_opportunity': return '🩸 藉機攻擊!' + (p.narrative as string) + '(HP -' + (p.physical as number) + ' / SAN -' + (p.horror as number) + ')';
    case 'taunt': return '🗯 ' + (p.narrative as string);
    case 'engagement_broken': return '🏃 ' + (p.narrative as string);
    case 'monster_dazed': return '💫 ' + (p.enemy as string) + ':' + (p.narrative as string);
    case 'doom_added': return '☄ 毀滅標記 +' + (p.amount as number) + '(累計 ' + (p.total as number) + ')';
    case 'act_advanced': return '📜 【幕推進:' + (p.name as string) + '】' + (p.narrative as string);
    case 'agenda_advanced': return '🕯 【議程翻面:' + (p.name as string) + '】' + (p.narrative as string);
    case 'flag_set': return '🚩 旗標「' + (p.flag_code as string) + '」= ' + String(p.value);
    case 'enemy_spawned': return '🌊 ' + (p.enemy as string) + ' 出現在 ' + (locMeta[p.location as string]?.name ?? (p.location as string)) + '!';
    case 'penalty_applied': return '⛈ ' + ((p.narrative as string) || (p.penalty as string));
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

/**
 * 載入殼:/scenario/test 走教學寫死 setup;
 * /scenario/:stageId(UUID)打 /api/play bootstrap → buildSetupFromBootstrap。
 */
export function TestScenarioScreen() {
  const { stageId = 'test' } = useParams();
  const [setup, setSetup] = useState<GameSetup | null>(() =>
    stageId === 'test' ? makeTestSetup() : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (stageId === 'test') {
      setSetup(makeTestSetup());
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setSetup(null);
    setLoadError(null);
    fetchBootstrap(stageId, getSelectedInvestigator()?.id)
      .then((bootstrap) => {
        if (!cancelled) setSetup(buildSetupFromBootstrap(bootstrap));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [stageId]);

  if (loadError) {
    return (
      <div className="bg-root">
        <div className="board-loading">
          <p>關卡資料載入失敗</p>
          <p className="board-loading-detail">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!setup) {
    return (
      <div className="bg-root">
        <div className="board-loading"><p>正在翻開關卡……</p></div>
      </div>
    );
  }
  return <BattleBoard key={setup.stageId} setup={setup} />;
}

function BattleBoard({ setup }: { setup: GameSetup }) {
  const navigate = useNavigate();
  const locMeta = setup.locMeta;
  const cardMeta = setup.cardMeta;

  const bus = useMemo(() => createInMemoryMessageBus(), []);
  const turnLoopRef = useRef<ReturnType<typeof createTurnLoop> | null>(null);
  if (turnLoopRef.current === null) {
    turnLoopRef.current = createTurnLoop({ bus, source: 'engine' });
  }

  const [investigator, setInvestigator] = useState(setup.investigator);
  const [scenario, setScenario] = useState(setup.scenario);
  const [phase, setPhase] = useState<TurnPhase>('short_rest_decision');
  const [turnNumber, setTurnNumber] = useState(1);
  const [keeperEnergy, setKeeperEnergy] = useState(8);
  const [log, setLog] = useState<string[]>(setup.introLog);

  // 浮層狀態
  const [modal, setModal] = useState<ModalType>(null);
  const [panel, setPanel] = useState<PanelType>(null);
  // 投入加值選擇(下一次檢定動作帶上,送出後清空)
  const [commitSelection, setCommitSelection] = useState<string[]>([]);
  // 戰役旗標(幕翻面/結局寫入)與結算
  const [flags, setFlags] = useState<Record<string, unknown>>({});
  const [outcome, setOutcome] = useState<OutcomeData | null>(null);
  const [locationBarId, setLocationBarId] = useState<string | null>(null);
  const [logCollapsed, setLogCollapsed] = useState(true);
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const [systemSub, setSystemSub] = useState<null | 'settings' | 'rules'>(null);

  // 地圖 pan / zoom
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const [zoom, setZoom] = useState(1);

  const append = (s: string) => setLog((l) => [...l.slice(-50), s]);

  /**
   * 進度檢查:每次狀態變化後跑幕/議程推進,處理場景切換與結局。
   * 回傳套用後的 (scenario, investigator);呼叫端負責 setState。
   */
  const applyProgress = (
    sc: ScenarioState,
    inv: InvestigatorState,
  ): { sc: ScenarioState; inv: InvestigatorState } => {
    if (setup.tutorial || setup.actData.length === 0) return { sc, inv };
    const tick = progressTick(sc, flags, setup.actData, setup.agendaData, setup.enemyStats);
    for (const eff of tick.effects) append('[劇情] ' + describeEffect(eff, locMeta));
    let nextSc = tick.scenario;
    let nextInv = inv;
    let nextFlags = tick.flags;

    // 幕翻面要求切換場景:用開局包重建新場景拓撲,保留進度與已生成敵人
    if (tick.switchScenario != null && setup.bootstrap) {
      const built2 = buildGameFromBootstrap(setup.bootstrap, { scenarioOrder: tick.switchScenario });
      const sceneLocs = new Set(built2.scenario.locations.map((l) => l.locationDefinitionId));
      nextSc = {
        ...built2.scenario,
        agendaProgress: nextSc.agendaProgress,
        objectiveProgress: nextSc.objectiveProgress,
        actIndex: nextSc.actIndex,
        agendaIndex: nextSc.agendaIndex,
        turnNumber: nextSc.turnNumber,
        phase: nextSc.phase,
        enemies: nextSc.enemies.filter((e) => sceneLocs.has(e.locationId)),
      };
      nextInv = {
        ...nextInv,
        currentLocationId: built2.investigator.currentLocationId,
        engagedWith: [],
      };
      append('🌧 ──── 場景轉換 ──── 你追著線索踏進了那條傳聞中的巷子。');
    }

    if (tick.victory || tick.defeat) {
      const finalOutcome = evaluateOutcome(setup.outcomes, nextFlags);
      if (finalOutcome) {
        nextFlags = applyOutcomeFlags(finalOutcome, nextFlags);
        setOutcome(finalOutcome);
      }
    }
    setFlags(nextFlags);
    return { sc: nextSc, inv: nextInv };
  };

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
        for (const eff of effects) append('[結算] ' + describeEffect(eff, locMeta));
      }
    });
    return () => { unsubNotif(); unsubResult(); };
  }, [bus, locMeta]);

  // 解鎖鏈 + 教學流程(只在教學關卡啟用;正式關卡地點預設全解鎖)
  useEffect(() => {
    if (!setup.tutorial) return;
    const cluesAtAlley = scenario.tokens.filter((t) => t.locationId === 'alley' && t.tokenType === 'clue').reduce((s, t) => s + t.amount, 0);
    if (cluesAtAlley >= 1 && !scenario.unlockedLocations.includes('bookshop')) {
      setScenario((s) => ({ ...s, unlockedLocations: [...s.unlockedLocations, 'bookshop'] }));
      append('🗝 線索拼出書店後門的位置 — 【舊書店】已解鎖,可移動。');
    }
  }, [setup.tutorial, scenario.tokens, scenario.unlockedLocations]);

  const lastLocationRef = useRef<string | null>(investigator.currentLocationId);
  useEffect(() => {
    if (!setup.tutorial) return;
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
  }, [setup.tutorial, investigator.currentLocationId, scenario.enemies, scenario.unlockedLocations]);

  // 教學完成
  const tutorialDoneRef = useRef(false);
  useEffect(() => {
    if (!setup.tutorial) return;
    const allEnemiesDown = scenario.enemies.every((e) => e.hp <= 0);
    if (allEnemiesDown && investigator.currentLocationId === 'backdoor' && !tutorialDoneRef.current) {
      tutorialDoneRef.current = true;
      append('🎉 [教學完成] 你擊敗了影潛者。三地點皆已驗證:調查 / 遭遇 / 戰鬥。');
    }
  }, [setup.tutorial, scenario.enemies, investigator.currentLocationId]);

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
    const ctx: RuleContext = {
      scenario, investigator, turn,
      investigators: { [investigator.investigatorId]: investigator },
      locationStats: setup.locationStats,
      enemyStats: setup.enemyStats,
      cardLookup: setup.cardLookup,
      stylePools: setup.stylePools,
    };
    const out = resolveIntent(intent, ctx);
    bus.publish(out.result);
    if (out.result.outcome === 'accepted') {
      // 進度檢查(幕推進/場景切換/結局)疊在引擎結算之上
      const next = applyProgress(
        out.newState?.scenario ?? scenario,
        out.newState?.investigator ?? investigator,
      );
      setScenario(next.sc);
      setInvestigator(next.inv);
      if ((intent.payload as { commitCardIds?: unknown }).commitCardIds) {
        setCommitSelection([]);
      }
    }
  }, [bus, investigator, scenario, turnNumber, phase, setup, flags]);

  /** 檢定類動作:自動帶上目前的加值選擇 */
  const submitCheckIntent = useCallback((
    actionType: IntentMessage['actionType'],
    payload: Record<string, unknown> = {}
  ) => {
    submitIntent(actionType, commitSelection.length > 0 ? { ...payload, commitCardIds: commitSelection } : payload);
  }, [submitIntent, commitSelection]);

  const toggleCommit = (cardId: string) => {
    setCommitSelection((sel) =>
      sel.includes(cardId) ? sel.filter((id) => id !== cardId) : [...sel, cardId],
    );
  };

  // 階段控制
  const startInvestigatorPhase = () => { turnLoopRef.current?.advance(); append('[階段切換] 進入調查員階段(3 行動點)'); };
  const takeShortRest = () => {
    turnLoopRef.current?.setPhase('mythos', turnNumber);
    setInvestigator((i) => ({ ...i, actionPoints: 0 }));
    append('[短休息] 本回合直接進入神話階段');
  };
  /**
   * 神話階段:臨時城主(召喚)+ 怪物啟動(§10)。
   * 臨時城主規則:場上無活怪且能量 ≥3 → 花 3 能量召喚召喚池最低位階一隻,
   * 生在玩家相鄰地點。階段三由正式城主 AI(神話卡攤開選用)取代。
   */
  const enterMythosPhase = () => {
    turnLoopRef.current?.advance();
    append('[階段切換] 進入神話階段');
    if (setup.tutorial) {
      setKeeperEnergy((e) => Math.max(0, e - 2));
      setTimeout(() => append('[城主行動] 黑暗從牆角滲出。'), 1200);
      return;
    }
    let sc = scenario;
    let inv = investigator;
    // 臨時城主:召喚
    const aliveEnemies = sc.enemies.filter((e) => e.hp > 0);
    if (aliveEnemies.length === 0 && keeperEnergy >= 3 && setup.summonPool.length > 0) {
      const pick = setup.summonPool[0];
      const here = sc.locations.find((l) => l.locationDefinitionId === inv.currentLocationId);
      const spawnLoc = here?.connectedTo[0] ?? inv.currentLocationId ?? '';
      const spawned = spawnEnemy(sc, pick.code, spawnLoc, setup.enemyStats, 1);
      sc = spawned.scenario;
      setKeeperEnergy((e) => Math.max(0, e - 3));
      append('[城主行動] 雨幕的另一頭,有什麼東西被引了過來——【' + pick.name_zh + '】出現在 ' + (setup.locMeta[spawnLoc]?.name ?? spawnLoc) + '。');
      // §7.6 怪物進入半徑 → 恐懼掃描
      const fear = runFearChecks(inv, sc, setup.enemyStats);
      inv = fear.investigator;
      for (const eff of fear.effects) append('[結算] ' + describeEffect(eff, locMeta));
    }
    // 臨時城主:每神話階段放 1 毀滅(階段三由神話卡驅動取代)
    const doomed = addDoom(sc, 1);
    sc = doomed.scenario;
    for (const eff of doomed.effects) append('[城主] ' + describeEffect(eff, locMeta));
    // §10 怪物啟動
    const act = activateMonsters(sc, { [inv.investigatorId]: inv }, setup.enemyStats, setup.attackCards);
    sc = act.scenario;
    inv = act.investigators[inv.investigatorId] ?? inv;
    for (const eff of act.effects) append('[神話階段] ' + describeEffect(eff, locMeta));
    if (act.effects.length === 0) append('[神話階段] 雨聲之外,一片死寂。');
    // 全滅檢查(§9 瀕死接通前簡化:HP 或 SAN 歸零即倒下)
    if (allInvestigatorsDown({ [inv.investigatorId]: inv })) {
      const finalOutcome = evaluateOutcome(setup.outcomes, flags);
      if (finalOutcome) {
        setFlags(applyOutcomeFlags(finalOutcome, flags));
        setOutcome(finalOutcome);
      }
      append('💀 你倒在雨裡,意識沉入黑暗……');
    }
    // 進度檢查(議程毀滅推進)
    const next = applyProgress(sc, inv);
    setScenario(next.sc);
    setInvestigator(next.inv);
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
  const handCards = investigator.hand.map((id) => cardMeta[id]).filter((x): x is CardDisplay => !!x);
  const enemyHere: EnemyInstance | undefined = scenario.enemies.find((e) => e.locationId === investigator.currentLocationId && e.hp > 0);
  const isLocationUnlocked = (id: string) => scenario.unlockedLocations.includes(id);
  const currentLocInstance = scenario.locations.find((l) => l.locationDefinitionId === investigator.currentLocationId);
  const moveTargets = currentLocInstance ? currentLocInstance.connectedTo : [];

  // 地圖 grid:依地點數動態決定列數(<=3 用 1 行,4-9 用 3×3,>9 用 4×N)
  const locCount = scenario.locations.length;
  const gridCols = locCount <= 3 ? locCount : (locCount <= 9 ? 3 : 4);

  // 議程 / 幕:依進度索引取當前卡(超出 = 最後一張)
  const agendaIdx = Math.min(scenario.agendaIndex ?? 0, Math.max(0, setup.agendaCards.length - 1));
  const actIdx = Math.min(scenario.actIndex ?? 0, Math.max(0, setup.actCards.length - 1));
  const currentAgenda = setup.agendaCards[agendaIdx] ?? null;
  const currentAct = setup.actCards[actIdx] ?? null;
  const currentAgendaData = setup.agendaData[agendaIdx] ?? null;
  const currentActData = setup.actData[actIdx] ?? null;
  const agendaMax = Number(currentAgendaData?.front_doom_threshold ?? currentAgenda?.doomThreshold ?? 6);
  const actCondition = currentActData?.front_advance_condition as { type?: string; count?: number } | null;
  const objectiveMax = actCondition?.type === 'clue_threshold'
    ? Number(actCondition.count ?? 12)
    : (currentAct?.progressMax ?? 12);
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
                  const meta = locMeta[loc.locationDefinitionId];
                  const unlocked = isLocationUnlocked(loc.locationDefinitionId);
                  const isCurr = loc.locationDefinitionId === investigator.currentLocationId;
                  const cluesHere = scenario.tokens.filter((t) => t.locationId === loc.locationDefinitionId && t.tokenType === 'clue').reduce((s, t) => s + t.amount, 0);
                  const maxClues = Math.max(2, cluesHere);
                  return (
                    <div
                      key={loc.locationDefinitionId}
                      className={'location-card' + (isCurr ? ' current-loc' : '') + (unlocked ? '' : ' locked')}
                      onClick={() => onLocationClick(loc.locationDefinitionId)}
                    >
                      {isCurr && <div className="player-token">P1</div>}
                      {scenario.enemies
                        .filter((e) => e.hp > 0 && e.locationId === loc.locationDefinitionId)
                        .map((e, ei) => (
                          <div
                            key={e.instanceId}
                            className="enemy-token"
                            style={{ right: 8 + ei * 26 }}
                            title={setup.enemyStats[e.enemyDefinitionId]?.name_zh ?? e.enemyDefinitionId}
                          >
                            👹
                          </div>
                        ))}
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
            <div className="keeper-title">議程 {agendaIdx + 1}{currentAgenda?.name ? ' · ' + currentAgenda.name : ''}</div>
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
            <div className="act-title">幕 {actIdx + 1}{currentAct?.name ? ' · ' + currentAct.name : ''}</div>
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
            <div className="quarter-name-banner">{setup.investigatorName}</div>
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
            {commitSelection.length > 0 && (
              <span className="commit-chip" title="下一次檢定將投入這些手牌加值">
                🂠 投入 {commitSelection.length} 張
              </span>
            )}
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
              <button onClick={() => submitCheckIntent('investigate')}>調查</button>
              {moveTargets.map((tid) => {
                const meta = locMeta[tid];
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
                <button className="attack" onClick={() => submitCheckIntent('attack', { enemyInstanceId: enemyHere.instanceId })}>
                  ⚔ 徒手攻擊
                </button>
              )}
              {enemyHere && investigator.assetsInPlay
                .filter((id) => (setup.cardLookup[id]?.effects ?? []).some((f) => f.trigger_type === 'action' && f.effect_code === 'attack'))
                .map((id) => (
                  <button
                    key={id}
                    className="attack"
                    onClick={() => submitCheckIntent('execute_card_action', { cardInstanceId: id, enemyInstanceId: enemyHere.instanceId })}
                  >
                    ⚔ {setup.cardLookup[id]?.name_zh ?? '武器'}
                  </button>
                ))}
              {investigator.engagedWith.length > 0 && (
                <button onClick={() => submitCheckIntent('evade')}>🌀 閃避</button>
              )}
              {enemyHere && !enemyHere.engagedWith.includes(investigator.investigatorId) && (
                <button onClick={() => submitIntent('taunt', { enemyInstanceId: enemyHere.instanceId })}>🗯 嘲諷</button>
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
        const meta = locMeta[locationBarId];
        const cluesHere = scenario.tokens.filter((t) => t.locationId === locationBarId && t.tokenType === 'clue').reduce((s, t) => s + t.amount, 0);
        const unlocked = isLocationUnlocked(locationBarId);
        return (
          <div className="location-bar active">
            <div className="loc-bar-title">{meta?.name ?? locationBarId}</div>
            <div className="loc-bar-details">
              <span>狀態: {unlocked ? '已解鎖' : '🔒 未解鎖'}</span>
              <span>線索: {cluesHere} 點</span>
              <span>{loc?.isObstacle ? '⚠ 障礙物' : '可進入'}</span>
            </div>
            {meta?.desc && <div className="loc-bar-desc">{meta.desc}</div>}
          </div>
        );
      })()}

      {/* === 底部 Panel(手牌:點卡 = 切換投入加值;「打出」= play_card)=== */}
      {panel === 'hand' && (
        <div className="bottom-panel active">
          <div className="panel-close" onClick={() => setPanel(null)}>[✕ 關閉]</div>
          <div className="panel-title">
            手牌 ({handCards.length}) · 點卡片 = 投入下次檢定加值
            {commitSelection.length > 0 && ` · 已選 ${commitSelection.length} 張`}
          </div>
          <div className="mock-cards">
            {handCards.map((card, i) => {
              const center = (handCards.length - 1) / 2;
              const offset = i - center;
              const data = setup.cardLookup[card.id];
              const playable = data?.card_type && data.card_type !== 'skill';
              const selected = commitSelection.includes(card.id);
              return (
                <div
                  key={card.id}
                  className={'mock-card rarity-' + card.rarity + (selected ? ' commit-selected' : '')}
                  style={{ transform: `rotate(${offset * 4}deg) translateY(${Math.abs(offset) * 4 - (selected ? 14 : 0)}px)` }}
                  title={card.desc}
                  onClick={() => toggleCommit(card.id)}
                >
                  <div className="mc-cost">{card.cost}</div>
                  <div className="mc-name">{card.name}</div>
                  <div className="mc-desc">{card.desc}</div>
                  {selected && <div className="mc-commit-badge">🂠 投入</div>}
                  {playable && (
                    <button
                      className="mc-play-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        submitIntent('play_card', { cardInstanceId: card.id });
                      }}
                    >
                      打出({data?.cost ?? 0} 資源)
                    </button>
                  )}
                </div>
              );
            })}
            {handCards.length === 0 && <div className="empty-note">手牌空</div>}
          </div>
        </div>
      )}

      {/* === 底部 Panel(背包:場上資產 + 行動效果按鈕)=== */}
      {panel === 'bag' && (
        <div className="bottom-panel active">
          <div className="panel-close" onClick={() => setPanel(null)}>[✕ 關閉]</div>
          <div className="panel-title">場上資產 ({investigator.assetsInPlay.length}) · 資源 {investigator.resources}</div>
          <div className="asset-list">
            {investigator.assetsInPlay.map((id) => {
              const data = setup.cardLookup[id];
              const actions = (data?.effects ?? []).filter((f) => f.trigger_type === 'action');
              const passives = (data?.effects ?? []).filter((f) => f.trigger_type === 'passive');
              return (
                <div key={id} className="asset-row">
                  <div className="asset-name">{data?.name_zh ?? id}</div>
                  {passives.length > 0 && (
                    <div className="asset-passive">{passives.map((f) => f.description_zh ?? '被動效果').join(' / ')}</div>
                  )}
                  <div className="asset-actions">
                    {actions.map((f, ai) => (
                      <button
                        key={ai}
                        onClick={() => {
                          setPanel(null);
                          submitCheckIntent('execute_card_action', {
                            cardInstanceId: id,
                            actionIndex: ai,
                            ...(enemyHere && f.effect_code === 'attack' ? { enemyInstanceId: enemyHere.instanceId } : {}),
                          });
                        }}
                      >
                        {f.effect_code === 'attack' ? '⚔ ' : '▶ '}
                        {(f.description_zh ?? f.effect_code).slice(0, 28)}
                      </button>
                    ))}
                    {actions.length === 0 && <span className="asset-no-action">(無主動行動)</span>}
                  </div>
                </div>
              );
            })}
            {investigator.assetsInPlay.length === 0 && <div className="empty-note">尚無場上資產 — 從手牌「打出」卡片</div>}
          </div>
        </div>
      )}

      {/* === Modal 議程 === */}
      {modal === 'keeper' && (
        <div className="modal-backdrop active" onClick={(e) => { if (e.target === e.currentTarget) closeAllOverlays(); }}>
          <div className="modal-frame modal-keeper">
            <button className="modal-close" onClick={closeAllOverlays}>✕</button>
            <div className="modal-title">❖ 議程 {agendaIdx + 1} · {currentAgenda?.name ?? '未知議程'} ❖</div>
            <div className="modal-illustration">議程插畫</div>
            <hr className="modal-divider" />
            <div className="modal-narrative">
              {currentAgenda?.narrative ?? '(本關卡尚未設定議程敘事)'}
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
            <div className="modal-title">❖ 幕 {actIdx + 1} · {currentAct?.name ?? '未知目標'} ❖</div>
            <div className="modal-illustration">幕插畫</div>
            <hr className="modal-divider" />
            <div className="modal-narrative">
              {currentAct?.narrative ?? '(本關卡尚未設定幕敘事)'}
            </div>
            <hr className="modal-divider" />
            <div className="cond-title">推進條件:</div>
            <div className="cond-desc">{currentAct?.conditionDesc || `收集 ${objectiveMax} 個線索,即可推進至下一張幕。`}</div>
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

      {/* === 結算畫面(結局判定後覆蓋全場)=== */}
      {outcome && (
        <div className="outcome-backdrop">
          <div className={'outcome-frame ' + (flags['outcome.victory'] === true ? 'outcome-victory' : 'outcome-defeat')}>
            <div className="outcome-eyebrow">{flags['outcome.victory'] === true ? '✦ 結局 ' + outcome.outcome_code + ' · 倖存 ✦' : '✦ 結局 ' + outcome.outcome_code + ' · 沉淪 ✦'}</div>
            <div className="outcome-title">{setup.title}</div>
            <hr className="modal-divider" />
            <div className="outcome-narrative">{outcome.narrative_text}</div>
            <hr className="modal-divider" />
            {(outcome.flag_sets ?? []).length > 0 && (
              <div className="outcome-flags">
                戰役記錄:{(outcome.flag_sets ?? []).map((f) => f.flag_code).join('、')}
              </div>
            )}
            <div className="outcome-actions">
              <button onClick={() => navigate('/lobby')}>回到大廳</button>
              <button onClick={() => window.location.reload()}>再玩一次</button>
            </div>
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
                const locName = locMeta[inv.currentLocationId || '']?.name ?? '未知';
                return (
                  <div key={inv.investigatorId} className={'team-card tc-' + (idx + 1)}>
                    <div className={'team-avatar ta-' + (idx + 1)} />
                    <div className="tc-info">
                      <div className="tc-name">{setup.investigatorName}</div>
                      <div className={'tc-faction f' + (idx + 1)}>{setup.factionLabel} · 玩家 {idx + 1}</div>
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
