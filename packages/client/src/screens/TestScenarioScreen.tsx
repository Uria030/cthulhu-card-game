import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  createInMemoryMessageBus,
  createTurnLoop,
  resolveIntent,
  activateMonsters,
  runFearChecks,
  progressTick,
  evaluateOutcome,
  applyOutcomeFlags,
  buildGameFromBootstrap,
  initKeeperState,
  snapshotSituation,
  selectKeeperActivations,
  executeMythosCard,
  runAttachmentUpkeep,
  isCardExecutable,
  AI_INVESTIGATOR_ROSTER,
  initInvestigatorAIState,
  runInvestigatorAITurn,
  runTurnEndUpkeep,
  runTurnStartUpkeep,
  runShortRest,
  syncDownedState,
  runDeathSave,
  isDowned,
  allInvestigatorsDead,
  CURRENT_MESSAGE_SCHEMA_VERSION,
} from '@cthulhu/shared';
import type {
  OutcomeData,
  ScenarioState,
  InvestigatorState,
  KeeperState,
  InvestigatorAIState,
} from '@cthulhu/shared';
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
import { applyDamageAllocation } from '@cthulhu/shared';
import type { AllocatableTarget } from '@cthulhu/shared';
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
    case 'doom_added': return '☄ 毀滅標記 +' + (p.amount as number) + '(累計 ' + (p.total as number) + ')' + (p.source ? ' — ' + (p.source as string) + ' 的存在加速著終局' : '');
    case 'keeper_card_activated': return '🃏 城主啟用【' + (p.name as string) + '】(' + (p.cost as number) + ' 點)— ' + (p.narrative as string);
    case 'keeper_attachment': return '🕸 【' + (p.name as string) + '】的影響附著在這場雨上,揮之不去。';
    case 'visibility_changed': return '🌑 ' + (locMeta[p.location as string]?.name ?? (p.location as string)) + ' 陷入' + (p.visibility === 'darkness' ? '黑暗' : (p.visibility as string)) + '。';
    case 'attachment_upkeep': return '🕸 ' + (p.narrative as string);
    case 'attachment_released': return '✨ 【' + (p.name as string) + '】' + (p.narrative as string);
    case 'attachment_release_failed': return '🕸 【' + (p.name as string) + '】仍纏著你(意志 ' + (p.total as number) + ' vs DC ' + (p.dc as number) + ')';
    case 'monster_phase_change': return '🔥 ' + (p.enemy as string) + ':' + (p.narrative as string);
    case 'act_advanced': return '📜 【幕推進:' + (p.name as string) + '】' + (p.narrative as string);
    case 'agenda_advanced': return '🕯 【議程翻面:' + (p.name as string) + '】' + (p.narrative as string);
    case 'flag_set': return '🚩 旗標「' + (p.flag_code as string) + '」= ' + String(p.value);
    case 'enemy_spawned': return '🌊 ' + (p.enemy as string) + ' 出現在 ' + (locMeta[p.location as string]?.name ?? (p.location as string)) + '!';
    case 'penalty_applied': return '⛈ ' + ((p.narrative as string) || (p.penalty as string));
    case 'clues_spent': return '🔎 花費 ' + (p.amount as number) + ' 個線索拼出真相';
    case 'investigator_downed': return '🩸 ' + (p.narrative as string) + '【瀕死】';
    case 'investigator_revived': return '💚 ' + (p.narrative as string);
    case 'death_save': return '🎲 瀕死檢定 d20=' + (p.roll as number) + ' → ' + (p.outcome === 'success' ? '穩住(' + (p.successes as number) + '/3)' : (p.outcome === 'critical_fail' ? '天 1!雙倍惡化' : '惡化') + '(' + (p.failures as number) + '/3)');
    case 'death_save_stand': return '✊ ' + (p.narrative as string);
    case 'investigator_died': return '💀 ' + (p.narrative as string);
    case 'investigator_permanently_dead': return '⚰ ' + (p.narrative as string);
    case 'stabilized': return '🤲 ' + (p.narrative as string) + '(穩定 ' + (p.successes as number) + '/3)';
    case 'use_spent': return '🔻 「' + (p.name as string) + '」消耗 1(剩 ' + (p.left as number) + ')';
    case 'asset_expended': return '🫳 「' + (p.name as string) + '」耗盡,進入棄牌堆';
    case 'card_consumed': return '♻ 消費「' + (p.name as string) + '」';
    case 'assets_readied': return '🔄 整裝:' + (p.count as number) + ' 張卡轉正';
    case 'short_rest': return '💤 ' + (p.narrative as string) + '(' + (p.reshuffled as number) + ' 張洗回牌庫)';
    case 'spell_cast': return '🔮 施放「' + (p.name as string) + '」— ' + (p.narrative as string) + '(造成 ' + (p.damage as number) + ' 點傷害)';
    case 'chaos_token_drawn': return '🌑 混沌袋:' + (p.sequence as string);
    case 'spell_strain': return ((p.delta as number) < 0 ? '😖' : '✨') + ' ' + (p.narrative as string) + '(SAN ' + ((p.delta as number) > 0 ? '+' : '') + (p.delta as number) + ')';
    case 'chaos_scene_effect': return '🕳 場景效果:' + (p.narrative as string);
    case 'chaos_bag_empty': return 'ℹ ' + (p.narrative as string);
    case 'headline_drawn': return '📰 ' + (p.narrative as string);
    case 'status_cleansed': return '🧼 ' + (p.narrative as string);
    case 'upkeep_draw': return '🂠 整裝:抽 1 張牌';
    case 'upkeep_income': return '🪙 整裝:獲得 ' + (p.amount as number) + ' 資源';
    case 'hand_limit_discard': return '🂠 手牌超過上限,棄掉 ' + (p.count as number) + ' 張';
    case 'hidden_point_revealed': return '👁 ' + (p.narrative as string);
    case 'hidden_investigate_fail': return '🔎 ' + (p.narrative as string);
    case 'hidden_reward': return '🗝 ' + (p.narrative as string) + ((p.gotLimited as boolean) ? '(限定獎勵!)' : '');
    case 'search_fail': return '🔍 ' + (p.narrative as string);
    case 'discover_card': return '🎴 ' + (p.narrative as string);
    case 'status_burning': return '🔥 ' + (p.narrative as string);
    case 'status_regen': return '💚 ' + (p.narrative as string);
    case 'status_bleed': return '🩸 ' + (p.narrative as string);
    case 'status_doom': return '☄ ' + (p.narrative as string);
    case 'status_fatigue': return '😪 ' + (p.narrative as string);
    case 'status_haste': return '⚡ ' + (p.narrative as string);
    case 'status_enemy_tick': return '🔥 ' + (p.narrative as string);
    case 'crush_damage': return '🪨 ' + (p.narrative as string) + '(HP -' + (p.amount as number) + ')';
    case 'curse_damage': return '👁 ' + (p.narrative as string) + '(SAN -' + (p.amount as number) + ')';
    case 'death_keyword_evaded': return '🌀 ' + (p.narrative as string);
    case 'monster_apathetic': return '😐 ' + (p.narrative as string);
    case 'monster_fly': return '🦇 ' + (p.narrative as string);
    case 'hunter_strike': return '🐾 ' + (p.narrative as string);
    case 'haunting_revive': return '👻 ' + (p.narrative as string);
    case 'ally_enters_play': return '🤝 ' + (p.narrative as string) + '(HP ' + (p.hp as number) + '/SAN ' + (p.san as number) + '/攻 ' + (p.attack as number) + ')';
    case 'ally_attack': return '🤝 ' + (p.narrative as string) + '(' + (p.damage as number) + ' 點)';
    case 'ally_readied': return '🤝 盟友轉正(' + (p.count as number) + ' 位回復行動)';
    case 'ally_soak': return '🛡 ' + (p.narrative as string);
    case 'ally_defeated': return '💔 ' + (p.narrative as string);
    default: return eff.type;
  }
}

// ─── 動作三段演出(Phase2 C:敘述 → 檢定 → 結果)──────────────
// 玩家自己的動作拆三拍跳 Modal;其他調查員的動作只進 Log(見設計記憶 action-timing-pacing)。
// 純演出層:引擎/狀態/Log 流程不變(效果照舊經 bus 進 Log),Modal 只重播同批效果讓動作有重量感。
type ActionBeat = 1 | 2 | 3;
interface PendingDamageAlloc { physical: number; horror: number; targets: AllocatableTarget[] }
interface ActionPlay {
  beat: ActionBeat;
  title: string;
  /** 敘述拍情境文字(結構占位;敘事插圖與 flavor 之後由資料/美術帶入)*/
  narration: string;
  /** 檢定拍要顯示的擲骰/檢定行 */
  checkLines: string[];
  /** 結果拍要顯示的結果行 */
  resultLines: string[];
  /** 此動作是否含檢定拍(無檢定 → 敘述直接到結果,2 拍)*/
  hasCheck: boolean;
  /** 檢定拍擲骰動畫中(節奏窗口:遮蔽延遲載入 + 重量感)*/
  rolling: boolean;
  /** 演出走完(完成鍵)後才跳的傷害分配 Modal(避免兩 Modal 疊)*/
  pendingDamageAlloc: PendingDamageAlloc | null;
}

// Phase2 B:AI 隊友計時器同時行動 — 每位 AI 行動的間隔(節奏化、不瞬間連發)
const AI_ACTION_INTERVAL_MS = 1600;

// 檢定拍效果型別(擲骰/檢定);其餘效果歸結果拍
const CHECK_EFFECT_TYPES = new Set(['roll_d20', 'fear_check', 'death_save']);
// 純記帳動作不跳演出 Modal(取資源/抽卡:頻繁且無重量,跳 Modal 反而擾民)
const ACTION_PLAY_SKIP = new Set(['gain_resource', 'draw_card']);
const ACTION_PLAY_TITLE: Record<string, string> = {
  investigate: '🔎 調查', search: '🔍 搜尋', investigate_hidden: '👁 探查隱密',
  attack: '⚔ 攻擊', execute_card_action: '🃏 卡牌行動', ally_attack: '🤝 盟友攻擊',
  evade: '🌀 閃避', move: '👣 移動', taunt: '🗯 嘲諷', stabilize: '🤲 穩定隊友',
};

/** 動作敘述拍的情境文字(結構占位,非最終 flavor;待資料/Gemini 帶入)*/
function actionNarration(actionType: string, locName: string): string {
  switch (actionType) {
    case 'investigate': return `你壓低身子,在【${locName}】仔細搜尋,留意每一處不對勁的細節……`;
    case 'search': return `你翻找【${locName}】的角落,看看有沒有能用上的東西……`;
    case 'investigate_hidden': return `你盯住那處先前察覺的異樣,湊近細看……`;
    case 'attack': return `你穩住呼吸,向眼前的威脅出手……`;
    case 'execute_card_action': return `你催動手中卡牌的力量……`;
    case 'ally_attack': return `你的盟友會意,撲向那東西……`;
    case 'evade': return `你壓低重心,準備閃開逼近的攻擊……`;
    case 'move': return `你離開【${locName}】,往下一處推進……`;
    case 'taunt': return `你高聲挑釁,把怪物的注意力引向自己……`;
    case 'stabilize': return `你跪到倒下的同伴身旁,設法穩住他的傷勢……`;
    default: return `你在【${locName}】採取行動……`;
  }
}

/** 把一次動作的效果拆成兩/三拍(敘述/檢定/結果);費用等背景結算不入演出拍 */
function buildActionPlay(
  actionType: string,
  effects: ResultEffect[],
  locName: string,
  locMeta: Record<string, LocationDisplay>,
  pendingDamageAlloc: PendingDamageAlloc | null,
): ActionPlay {
  const checkLines: string[] = [];
  const resultLines: string[] = [];
  for (const eff of effects) {
    if (eff.type === 'spend_action_point' || eff.type === 'damage_allocatable') continue;
    if (CHECK_EFFECT_TYPES.has(eff.type)) checkLines.push(describeEffect(eff, locMeta));
    else resultLines.push(describeEffect(eff, locMeta));
  }
  return {
    beat: 1,
    title: ACTION_PLAY_TITLE[actionType] ?? '行動',
    narration: actionNarration(actionType, locName),
    checkLines,
    resultLines,
    hasCheck: checkLines.length > 0,
    rolling: false,
    pendingDamageAlloc,
  };
}

const PHASE_LABEL: Record<TurnPhase, string> = {
  investigator: '調查員階段',
  mythos: '敵人階段',
  turn_end: '回合結束',
};

const PHASE_ORDER: TurnPhase[] = ['investigator', 'mythos', 'turn_end'];

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
    const playerTemplateId = getSelectedInvestigator()?.id;
    // AI 隊友(v0:一位):名冊上第一位不與玩家撞模板的成員
    const aiProfile = AI_INVESTIGATOR_ROSTER.find((p) => p.templateId !== playerTemplateId) ?? null;
    Promise.all([
      fetchBootstrap(stageId, playerTemplateId),
      aiProfile
        ? fetchBootstrap(stageId, aiProfile.templateId).catch(() => null) // AI 拉不到 → 單人照常開局
        : Promise.resolve(null),
    ])
      .then(([bootstrap, aiBootstrap]) => {
        if (!cancelled) setSetup(buildSetupFromBootstrap(bootstrap, aiBootstrap ? [aiBootstrap] : []));
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
  // AI 隊友(調查員 AI v0):狀態與玩家平行,行動走同一條 resolveIntent 管線
  const [aiMembers, setAiMembers] = useState<InvestigatorState[]>(
    () => setup.aiMembers.map((m) => m.investigator),
  );
  const aiStatesRef = useRef<InvestigatorAIState[]>(setup.aiMembers.map(() => initInvestigatorAIState()));
  // Phase2 B:本回合已行動過的 AI 隊友(計時器同時行動用;新回合在 endTurn 清空)
  const [aiActedThisTurn, setAiActedThisTurn] = useState<string[]>([]);
  // AI 計時器「該動了」訊號;executor effect 監聽此值,在 fresh 閉包裡跑一位 AI(競態防護見下方 effect)
  const [aiTick, setAiTick] = useState(0);
  const [phase, setPhase] = useState<TurnPhase>('investigator');
  // 本回合玩家是否已選短休息(放棄行動;每回合開頭重置)
  const [playerShortRested, setPlayerShortRested] = useState(false);
  const [turnNumber, setTurnNumber] = useState(1);
  // 城主運行時狀態(行動點/冷卻/使用次數;教學關卡不用)
  const [keeperState, setKeeperState] = useState<KeeperState>(() => initKeeperState(setup.keeperProfile));
  const [keeperEnergy, setKeeperEnergy] = useState(8); // 教學關卡舊顯示用
  const [log, setLog] = useState<string[]>(setup.introLog);

  // 浮層狀態
  const [modal, setModal] = useState<ModalType>(null);
  // §11 傷害分配 Modal:受傷且場上有可分配卡時跳出讓玩家分配
  const [damageAlloc, setDamageAlloc] = useState<{ physical: number; horror: number; targets: AllocatableTarget[] } | null>(null);
  // Phase2 C:玩家自己動作的三段演出 Modal(敘述→檢定→結果);其他人動作只進 Log
  const [actionPlay, setActionPlay] = useState<ActionPlay | null>(null);
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
    // §14 escape 等任務看全員位置/存活;setAiMembers 非同步,呼叫端須傳「這次更新後」的最新 AI 陣列,
    // 不可讀閉包 aiMembers(會是上一輪 render 的舊狀態)。預設值僅為無更新時的後援。
    partyAIs: InvestigatorState[] = aiMembers,
  ): { sc: ScenarioState; inv: InvestigatorState } => {
    if (setup.tutorial || setup.actData.length === 0) return { sc, inv };
    // 人數縮放(ch1 技術原則 4):幕線索門檻 × 隊伍人數(玩家 + AI 隊友)
    const partySize = 1 + setup.aiMembers.length;
    // §14 escape 等任務需全員位置 → 組隊伍 map(玩家 + 現役 AI 隊友的最新狀態)
    const party: Record<string, InvestigatorState> = { [inv.investigatorId]: inv };
    for (const ai of partyAIs) if (ai) party[ai.investigatorId] = ai;
    const tick = progressTick(sc, flags, setup.actData, setup.agendaData, setup.enemyStats, partySize, party);
    for (const eff of tick.effects) {
      // 頭目登場三段式演出(劇本 Part3 §2.4:先聽聲 → 見人 → 揭真相)
      const introLines = eff.type === 'enemy_spawned'
        ? setup.bossIntro[String((eff.params as { code?: string }).code ?? '')]
        : undefined;
      if (introLines) {
        for (const line of introLines) append('[劇情] ' + line);
      } else {
        append('[劇情] ' + describeEffect(eff, locMeta));
      }
    }
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
      // AI 隊友跟著轉場(同出生點,解除交戰)
      setAiMembers((ms) => ms.map((ai) => ({
        ...ai,
        currentLocationId: built2.investigator.currentLocationId,
        engagedWith: [],
      })));
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

  // 跑單一 AI 隊友的一回合(邏輯同 enterMythosPhase ⓪;抽出供「計時器同時行動」與「結束階段補跑」共用)。
  // 純計算式:吃 (idx, sc, inv, aiArr) 回新的三者,只 append Log、不直接 setState(commit 由呼叫端負責)。
  const stepAITeammate = (
    idx: number,
    sc0: ScenarioState,
    inv0: InvestigatorState,
    aiArr0: InvestigatorState[],
  ): { sc: ScenarioState; inv: InvestigatorState; aiArr: InvestigatorState[] } => {
    const m = setup.aiMembers[idx];
    const ai = aiArr0[idx];
    if (!m || !ai || ai.dead || ai.permanentlyDead || isDowned(ai)) return { sc: sc0, inv: inv0, aiArr: aiArr0 };
    let sc = sc0;
    let inv = inv0;
    const aiArr = [...aiArr0];
    const allies: Record<string, InvestigatorState> = { [inv.investigatorId]: inv };
    for (const [j, other] of aiArr.entries()) if (j !== idx && other) allies[other.investigatorId] = other;
    const r = runInvestigatorAITurn(
      {
        scenario: sc, investigator: ai, allies, turnNumber,
        locationStats: setup.locationStats, enemyStats: setup.enemyStats,
        cardLookup: setup.cardLookup, stylePools: setup.stylePools,
      },
      m.profile,
      aiStatesRef.current[idx],
    );
    aiStatesRef.current[idx] = r.aiState;
    sc = r.scenario;
    aiArr[idx] = r.investigator;
    // 穩定救援改動到的隊友(可能是玩家或其他 AI)
    for (const [allyId, allyState] of Object.entries(r.updatedAllies)) {
      if (allyId === inv.investigatorId) inv = allyState;
      else { const j = aiArr.findIndex((x) => x?.investigatorId === allyId); if (j >= 0) aiArr[j] = allyState; }
    }
    for (const step of r.steps) {
      if (step.outcome === 'rejected') continue; // AI 被駁回不上戰役紀錄
      append(`[${m.profile.name_zh}] ${step.intentNarrative}`);
      for (const eff of step.effects) append('  └ ' + describeEffect(eff, locMeta).split('你').join(m.profile.name_zh));
    }
    if (r.steps.length === 0) append(`[${m.profile.name_zh}] 按兵不動,觀察著四周。`);
    return { sc, inv, aiArr };
  };

  // Phase2 B:AI 隊友計時器同時行動 — 調查員階段中,每隔 AI_ACTION_INTERVAL_MS 讓一位「本回合還沒
  // 行動」的 AI 隊友跑一回合,結果流進 Log(非阻塞玩家、無強制玩家→AI 先後)。
  // granularity v0 = 每位 AI 一整回合(非逐動作)。
  //
  // 競態防護(Raviel BLOCK 修正):**絕不在 setTimeout 回呼裡用閉包狀態寫遊戲 state**
  // (閉包會是舊值 → lost update;phaseRef 這種 ref 又因 post-render 更新而落後 → 仍有競態)。
  // 改用標準 React 模式:計時器只發「該動了」訊號(setAiTick),真正跑 AI 在另一支 effect 裡做,
  // 那支 effect 在 tick 觸發的 render 後才跑,讀到的是「已 commit 的最新 state」(fresh 閉包),
  // 連階段判斷都用 fresh 閉包(不靠落後的 ref)。單執行緒下無交錯,故無 lost update。
  const aiHasUnacted = aiMembers.some((ai) =>
    !!ai && !ai.dead && !ai.permanentlyDead && !isDowned(ai) && !aiActedThisTurn.includes(ai.investigatorId));
  const aiPaused = !!(setup.tutorial || phase !== 'investigator' || outcome || actionPlay || damageAlloc);
  // 計時器:只發訊號,不碰遊戲狀態。aiActedThisTurn 入 deps → 每位 AI 行動完都重新武裝下一個計時器
  // (否則 aiHasUnacted 仍為 true 時 deps 不變,序列會在第一位之後停住)。
  useEffect(() => {
    if (aiPaused || !aiHasUnacted) return;
    const id = setTimeout(() => setAiTick((t) => t + 1), AI_ACTION_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [aiPaused, aiHasUnacted, turnNumber, aiActedThisTurn]);
  // 執行:tick 變動 → 用「當下已 commit 的最新 state」跑一位 AI(fresh 閉包,杜絕舊值寫入)
  useEffect(() => {
    if (aiTick === 0) return;
    if (setup.tutorial || phase !== 'investigator' || outcome || actionPlay || damageAlloc) return;
    const idx = aiMembers.findIndex((ai) =>
      !!ai && !ai.dead && !ai.permanentlyDead && !isDowned(ai) && !aiActedThisTurn.includes(ai.investigatorId));
    if (idx < 0) return;
    const actedId = aiMembers[idx]?.investigatorId;
    const res = stepAITeammate(idx, scenario, investigator, aiMembers);
    const next = applyProgress(res.sc, res.inv, res.aiArr);
    setScenario(next.sc);
    setInvestigator(next.inv);
    setAiMembers(res.aiArr);
    if (actedId) setAiActedThisTurn((s) => (s.includes(actedId) ? s : [...s, actedId]));
    // 僅依 aiTick 觸發;其餘狀態刻意讀 fresh 閉包(這正是杜絕舊值寫入的關鍵)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiTick]);

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
      chaosMarkerEffects: setup.chaosMarkerEffects,
    };
    const out = resolveIntent(intent, ctx);
    bus.publish(out.result);
    if (out.result.outcome === 'accepted') {
      // 倒地同步(閃避失敗/藉機攻擊可能把自己打趴)
      const sync = syncDownedState(out.newState?.investigator ?? investigator);
      for (const eff of sync.effects) append('[結算] ' + describeEffect(eff, locMeta));
      // 穩定救援改動到的隊友
      const allies = out.newState?.updatedAllies ?? {};
      // 進度檢查要用「本次更新後」的 AI 陣列(setAiMembers 非同步,閉包 aiMembers 仍是舊值)
      const freshAIs = Object.keys(allies).length > 0
        ? aiMembers.map((ai) => allies[ai.investigatorId] ?? ai)
        : aiMembers;
      if (Object.keys(allies).length > 0) {
        setAiMembers((ms) => ms.map((ai) => allies[ai.investigatorId] ?? ai));
      }
      // 進度檢查(幕推進/場景切換/結局)疊在引擎結算之上
      const next = applyProgress(
        out.newState?.scenario ?? scenario,
        sync.investigator,
        freshAIs,
      );
      setScenario(next.sc);
      setInvestigator(next.inv);
      // §11 受傷且有可分配卡 → 傷害分配 Modal(只認玩家本人的傷害,排除隊友)。
      // 走演出的動作:延後到演出「完成」才跳(避免兩 Modal 疊);否則立即跳。
      const da = (out.result.effects ?? []).find((e) => e.type === 'damage_allocatable' && e.targetId === investigator.investigatorId);
      const dp = da?.params as { physical?: number; horror?: number; targets?: AllocatableTarget[] } | undefined;
      const pendingDamageAlloc: PendingDamageAlloc | null = dp
        ? { physical: Number(dp.physical ?? 0), horror: Number(dp.horror ?? 0), targets: dp.targets ?? [] }
        : null;
      if ((intent.payload as { commitCardIds?: unknown }).commitCardIds) {
        setCommitSelection([]);
      }
      // Phase2 C:玩家自己的動作跳三段演出 Modal(敘述→檢定→結果)。純演出 —
      // 效果已照舊經 bus 進 Log、狀態也已套用,Modal 只重播這批效果讓動作有重量感。
      // 純記帳動作(取資源/抽卡)不跳,維持輕快。
      if (!ACTION_PLAY_SKIP.has(actionType)) {
        const locId = investigator.currentLocationId;
        const locName = (locId && setup.locMeta[locId]?.name) || locId || '此地';
        setActionPlay(buildActionPlay(actionType, out.result.effects ?? [], locName, locMeta, pendingDamageAlloc));
      } else if (pendingDamageAlloc) {
        setDamageAlloc(pendingDamageAlloc);
      }
    }
  }, [bus, investigator, scenario, turnNumber, phase, setup, flags, locMeta]);

  /** 檢定類動作:自動帶上目前的加值選擇 */
  const submitCheckIntent = useCallback((
    actionType: IntentMessage['actionType'],
    payload: Record<string, unknown> = {}
  ) => {
    submitIntent(actionType, commitSelection.length > 0 ? { ...payload, commitCardIds: commitSelection } : payload);
  }, [submitIntent, commitSelection]);

  // §11 把這次傷害分配給選定的卡(目前 v0 = 盟友;一鍵讓它擋下能擋的部分)
  const allocateDamageTo = useCallback((target: AllocatableTarget) => {
    if (!damageAlloc) return;
    const r = applyDamageAllocation(investigator, [{
      cardInstanceId: target.cardInstanceId,
      physical: Math.min(damageAlloc.physical, target.physicalCapacity),
      horror: Math.min(damageAlloc.horror, target.horrorCapacity),
    }]);
    for (const eff of r.effects) append('[傷害分配] ' + describeEffect(eff, locMeta));
    // 分配回血可能把玩家拉出瀕死 → 重新同步瀕死狀態(§9.5)
    const sync = syncDownedState(r.investigator);
    for (const eff of sync.effects) append('[結算] ' + describeEffect(eff, locMeta));
    setInvestigator(sync.investigator);
    setDamageAlloc(null);
  }, [damageAlloc, investigator, locMeta]);

  // Phase2 C:三段演出進拍 + 完成。完成後若有待跳的傷害分配 Modal,接著跳。
  const advanceActionPlay = () => {
    setActionPlay((ap) => {
      if (!ap) return ap;
      if (ap.beat === 1) return ap.hasCheck ? { ...ap, beat: 2, rolling: true } : { ...ap, beat: 3 };
      if (ap.beat === 2) return { ...ap, beat: 3 };
      return ap;
    });
  };
  const completeActionPlay = () => {
    const pending = actionPlay?.pendingDamageAlloc ?? null;
    setActionPlay(null);
    if (pending) setDamageAlloc(pending);
  };
  // 檢定拍擲骰動畫(節奏窗口 ~700ms:重量感 + 遮蔽未來延遲載入)
  useEffect(() => {
    if (!actionPlay || actionPlay.beat !== 2 || !actionPlay.rolling) return;
    const id = setTimeout(() => {
      setActionPlay((ap) => (ap && ap.beat === 2 && ap.rolling ? { ...ap, rolling: false } : ap));
    }, 700);
    return () => clearTimeout(id);
  }, [actionPlay]);

  const toggleCommit = (cardId: string) => {
    setCommitSelection((sel) =>
      sel.includes(cardId) ? sel.filter((id) => id !== cardId) : [...sel, cardId],
    );
  };

  // 階段控制
  // 短休息(ch2 §3.1):調查員階段開頭的個人決定 — 放棄本回合行動換重洗牌庫,
  // 不跳過階段(其他調查員照常),做完仍要按「結束調查員階段」進敵人階段。
  const takePlayerShortRest = () => {
    const r = runShortRest(investigator);
    setInvestigator(r.investigator);
    setPlayerShortRested(true);
    for (const eff of r.effects) append('[短休息] ' + describeEffect(eff, locMeta));
  };
  /**
   * 神話階段 — 城主 AI v0(keeper_ai_regulation §2.2 sequence):
   * ① 附著卡強制結算 ② 城主選用神話卡(行動點預算+戲劇曲線)③ 怪物啟動 ④ 進度/全滅檢查
   */
  const enterMythosPhase = () => {
    let sc = scenario;
    let inv = investigator;

    // ⓪ 結束調查員階段:把本回合「計時器還沒輪到」的 AI 隊友補跑完,保證每位都行動到、不損失回合。
    //    (玩家逗留時計時器已讓 AI 陸續行動;玩家提前結束就在這裡補齊 — 同時/自由順序的數位形態)
    let updatedAIs = [...aiMembers];
    if (!setup.tutorial) {
      for (let idx = 0; idx < updatedAIs.length; idx += 1) {
        const aiId = updatedAIs[idx]?.investigatorId;
        if (aiId && aiActedThisTurn.includes(aiId)) continue; // 已由計時器跑過
        const res = stepAITeammate(idx, sc, inv, updatedAIs);
        sc = res.sc;
        inv = res.inv;
        updatedAIs = res.aiArr;
      }
    }

    turnLoopRef.current?.advance();
    append('[階段切換] 進入敵人階段');
    if (setup.tutorial) {
      setKeeperEnergy((e) => Math.max(0, e - 2));
      setTimeout(() => append('[城主行動] 黑暗從牆角滲出。'), 1200);
      return;
    }

    // ① 附著卡強制結算(瘋狂攫住棄牌/解除檢定等)
    if ((sc.keeperAttachments ?? []).length > 0) {
      const upkeep = runAttachmentUpkeep(sc.keeperAttachments ?? [], inv);
      inv = upkeep.investigator;
      sc = { ...sc, keeperAttachments: upkeep.attachments };
      for (const eff of upkeep.effects) append('[附著] ' + describeEffect(eff, locMeta));
    }

    // ② 城主選卡(open-hand,評分+戲劇曲線+避免單調)
    const actCondition0 = setup.actData[0]?.front_advance_condition as { type?: string; count?: number } | null;
    const bossCode = Object.keys(setup.bossIntro)[0];
    const situation = snapshotSituation(
      sc, inv,
      actCondition0?.type === 'clue_threshold'
        ? Number(actCondition0.count ?? 0) * (1 + setup.aiMembers.length) // 與幕門檻同步人數縮放
        : null,
      bossCode ? Number(setup.enemyStats[bossCode]?.hp_base ?? 0) : null,
    );
    const selection = selectKeeperActivations(setup.mythosCards, situation, keeperState, setup.keeperProfile);
    setKeeperState(selection.state);
    for (const card of selection.activations) {
      const keeperParty: Record<string, InvestigatorState> = { [inv.investigatorId]: inv };
      for (const ai of updatedAIs) if (ai) keeperParty[ai.investigatorId] = ai;
      const exec = executeMythosCard(card, sc, inv, setup.enemyStats, undefined, 1 + setup.aiMembers.length, keeperParty);
      sc = exec.scenario;
      inv = exec.investigator;
      for (const [id, after] of Object.entries(exec.updatedInvestigators ?? {})) {
        const j = updatedAIs.findIndex((x) => x?.investigatorId === id);
        if (j >= 0) updatedAIs[j] = after;
      }
      if (exec.attachments.length > 0) {
        // 同卡再啟用 = 刷新不疊加(自我去重,s14 修飾關鍵字精神)
        const newIds = new Set(exec.attachments.map((a) => a.cardId));
        sc = {
          ...sc,
          keeperAttachments: [
            ...(sc.keeperAttachments ?? []).filter((a) => !newIds.has(a.cardId)),
            ...exec.attachments,
          ],
        };
      }
      for (const eff of exec.effects) append('[城主] ' + describeEffect(eff, locMeta));
      // 召喚後恐懼掃描(§7.6 怪物進入半徑;玩家與 AI 隊友都掃)
      if (exec.effects.some((e) => e.type === 'enemy_spawned')) {
        const fear = runFearChecks(inv, sc, setup.enemyStats);
        inv = fear.investigator;
        for (const eff of fear.effects) append('[結算] ' + describeEffect(eff, locMeta));
        updatedAIs.forEach((ai, idx) => {
          if (!ai || ai.hp <= 0 || ai.san <= 0) return;
          const aiFear = runFearChecks(ai, sc, setup.enemyStats);
          updatedAIs[idx] = aiFear.investigator;
          const aiName = setup.aiMembers[idx]?.profile.name_zh ?? 'AI';
          for (const eff of aiFear.effects) append('  └ ' + describeEffect(eff, locMeta).split('你').join(aiName));
        });
      }
    }
    if (selection.activations.length === 0) append('[城主] 雨聲之外,某種注視沉默地積蓄著。');

    // ③ §10 怪物啟動(行為腳本層選招;目標含 AI 隊友 — 對怪物而言獵物平等)
    const partyMap: Record<string, InvestigatorState> = { [inv.investigatorId]: inv };
    for (const ai of updatedAIs) if (ai && ai.hp > 0 && ai.san > 0) partyMap[ai.investigatorId] = ai;
    const act = activateMonsters(sc, partyMap, setup.enemyStats, setup.attackCards);
    sc = act.scenario;
    inv = act.investigators[inv.investigatorId] ?? inv;
    updatedAIs.forEach((ai, idx) => {
      if (!ai) return;
      const after = act.investigators[ai.investigatorId];
      if (after) updatedAIs[idx] = after;
    });
    for (const eff of act.effects) append('[神話階段] ' + describeEffect(eff, locMeta));
    // §11 玩家受傷且有可分配卡 → 跳傷害分配 Modal(神話階段批次結算後)
    const mythosDa = act.effects.find((e) => e.type === 'damage_allocatable' && e.targetId === inv.investigatorId);
    if (mythosDa) {
      const dp = mythosDa.params as { physical?: number; horror?: number; targets?: AllocatableTarget[] };
      setDamageAlloc({ physical: Number(dp.physical ?? 0), horror: Number(dp.horror ?? 0), targets: dp.targets ?? [] });
    }

    // 倒地狀態同步(§9:歸零 → 瀕死,不是直接出局)
    {
      const syncP = syncDownedState(inv);
      inv = syncP.investigator;
      for (const eff of syncP.effects) append('[結算] ' + describeEffect(eff, locMeta));
      updatedAIs.forEach((ai, idx) => {
        if (!ai) return;
        const s = syncDownedState(ai);
        updatedAIs[idx] = s.investigator;
        const name = setup.aiMembers[idx]?.profile.name_zh ?? 'AI';
        for (const eff of s.effects) append(`[結算] ` + describeEffect(eff, locMeta).split('你').join(name));
      });
    }
    setAiMembers(updatedAIs);

    // ④ 全滅檢查(§9:全員死亡才終局;倒地者還有瀕死檢定的機會)
    const party: Record<string, InvestigatorState> = { [inv.investigatorId]: inv };
    for (const ai of updatedAIs) if (ai) party[ai.investigatorId] = ai;
    if (allInvestigatorsDead(party)) {
      const finalOutcome = evaluateOutcome(setup.outcomes, flags);
      if (finalOutcome) {
        setFlags(applyOutcomeFlags(finalOutcome, flags));
        setOutcome(finalOutcome);
      }
      append('💀 雨聲蓋過了最後的呼吸。沒有人再站起來。');
    }
    // 進度檢查(議程毀滅推進)— 傳本次神話階段更新後的 AI 陣列(escape 等任務看最新位置/存活)
    const next = applyProgress(sc, inv, updatedAIs);
    setScenario(next.sc);
    setInvestigator(next.inv);
  };
  const endTurn = () => {
    // 敵人階段 → 回合結束 → 下一回合的調查員階段(三階段:advance ×2)
    turnLoopRef.current?.advance();
    turnLoopRef.current?.advance();
    setPlayerShortRested(false); // 新回合開頭重置短休息決定
    setAiActedThisTurn([]); // 新回合:AI 隊友計時器重新開放(同時行動)
    // 回合結束階段(ch2 §2.4):每人抽 1 卡 + 1 資源 + 手牌上限 8(教學關卡跳過)
    if (!setup.tutorial) {
      setInvestigator((i) => {
        const up = runTurnEndUpkeep(i);
        for (const eff of up.effects) append('[回合結束] ' + describeEffect(eff, locMeta));
        let next = { ...up.investigator, actionPoints: 3 };
        // 新回合開始:狀態結算(燃燒/再生/加速,§6;燃燒可能打到瀕死)
        const start = runTurnStartUpkeep(next);
        for (const eff of start.effects) append('[回合開始] ' + describeEffect(eff, locMeta));
        next = syncDownedState(start.investigator).investigator;
        // 新回合調查員階段開頭:瀕死者做瀕死檢定取代行動(§9.3)
        if (isDowned(next)) {
          const save = runDeathSave(next);
          next = { ...save.investigator, actionPoints: 0 };
          for (const eff of save.effects) append('[瀕死] ' + describeEffect(eff, locMeta));
        }
        return next;
      });
      // AI 隊友:回合結束補給 + 回合開始狀態 + 瀕死檢定(與玩家同一時點,§9.3 時序一致)
      setAiMembers((ms) => ms.map((ai, idx) => {
        const aiName = setup.aiMembers[idx]?.profile.name_zh ?? 'AI';
        let next = { ...runTurnEndUpkeep(ai).investigator, actionPoints: 3 };
        const start = runTurnStartUpkeep(next);
        for (const eff of start.effects) append('[回合開始] ' + describeEffect(eff, locMeta).split('你').join(aiName));
        next = syncDownedState(start.investigator).investigator;
        if (isDowned(next)) {
          const save = runDeathSave(next);
          next = { ...save.investigator, actionPoints: 0 };
          for (const eff of save.effects) append(`[瀕死] ` + describeEffect(eff, locMeta).split('你').join(aiName));
        }
        return next;
      }));
    } else {
      setInvestigator((i) => ({ ...i, actionPoints: 3 }));
      setAiMembers((ms) => ms.map((ai) => ({ ...ai, actionPoints: 3 })));
    }
    // 場景回合數同步(戲劇曲線/行為腳本 turn_count 觸發都依賴它)
    setScenario((s) => ({ ...s, turnNumber: s.turnNumber + 1 }));
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
    ? Number(actCondition.count ?? 12) * (1 + setup.aiMembers.length) // 人數縮放
    : (currentAct?.progressMax ?? 12);
  const agendaPct = Math.min(100, (scenario.agendaProgress / agendaMax) * 100);
  const objectivePct = Math.min(100, (scenario.objectiveProgress / objectiveMax) * 100);

  // 隊伍 modal:玩家 + AI 隊友
  const teamMembers: Array<{ inv: InvestigatorState; name: string; label: string }> = [
    { inv: investigator, name: setup.investigatorName, label: setup.factionLabel + ' · 玩家' },
    ...aiMembers.map((ai, idx) => ({
      inv: ai,
      name: setup.aiMembers[idx]?.profile.name_zh ?? 'AI',
      label: (setup.aiMembers[idx]?.profile.title_zh ?? '') + ' · AI 隊友',
    })),
  ];

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
                      {aiMembers.map((ai, aiIdx) =>
                        !ai.dead && !ai.permanentlyDead && ai.currentLocationId === loc.locationDefinitionId ? (
                          <div
                            key={ai.investigatorId}
                            className="player-token ai-token"
                            style={{ left: -12 + aiIdx * 26, opacity: isDowned(ai) ? 0.45 : 1 }}
                            title={(setup.aiMembers[aiIdx]?.profile.name_zh ?? '') + (isDowned(ai) ? '(瀕死)' : '')}
                          >
                            {isDowned(ai) ? '🩸' : (setup.aiMembers[aiIdx]?.profile.name_zh ?? 'A').slice(0, 1)}
                          </div>
                        ) : null,
                      )}
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
                <span className="badge-num">{setup.tutorial ? keeperEnergy : keeperState.actionPoints}</span>
                <span className="badge-label">{setup.tutorial ? '城主能量' : '城主行動點'}</span>
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
          {phase === 'investigator' && isDowned(investigator) && (
            <div className="phase-buttons">
              <span className="commit-chip">🩸 瀕死中(穩定 {investigator.deathSaveSuccesses ?? 0}/3・惡化 {investigator.deathSaveFailures ?? 0}/3)— 等待隊友救援</span>
              <button onClick={enterMythosPhase}>結束調查員階段 →</button>
            </div>
          )}
          {phase === 'investigator' && playerShortRested && !isDowned(investigator) && !investigator.dead && (
            <div className="phase-buttons">
              <span className="commit-chip">💤 你已短休息(本回合放棄行動,牌庫已重洗)</span>
              <button onClick={enterMythosPhase}>結束調查員階段 →</button>
            </div>
          )}
          {phase === 'investigator' && !playerShortRested && !isDowned(investigator) && !investigator.dead && (
            <div className="phase-buttons">
              {!setup.tutorial && investigator.actionPoints === 3 && (
                <button onClick={takePlayerShortRest} title="放棄本回合行動,將棄牌堆洗回牌庫">💤 短休息</button>
              )}
              {aiMembers.map((ai, idx) =>
                isDowned(ai) && ai.currentLocationId === investigator.currentLocationId ? (
                  <button
                    key={'stab-' + ai.investigatorId}
                    className="attack"
                    onClick={() => submitIntent('stabilize', { targetInvestigatorId: ai.investigatorId })}
                  >
                    🤲 穩定 {setup.aiMembers[idx]?.profile.name_zh ?? '隊友'}
                  </button>
                ) : null,
              )}
              <button onClick={() => submitIntent('gain_resource')}>拿資源</button>
              <button onClick={() => submitIntent('draw_card')}>抽卡</button>
              <button onClick={() => submitCheckIntent('investigate')}>調查</button>
              {(scenario.discoverablePools ?? []).some(
                (s) => s.locationId === investigator.currentLocationId && s.takenBy === null,
              ) && (
                <button onClick={() => submitCheckIntent('search')}>🔍 搜尋</button>
              )}
              {(scenario.hiddenPoints ?? [])
                .filter(
                  (p) =>
                    p.locationId === investigator.currentLocationId &&
                    p.revealedTo.includes(investigator.investigatorId) &&
                    !p.claimedBy.includes(investigator.investigatorId),
                )
                .map((p) => (
                  <button key={p.id} onClick={() => submitCheckIntent('investigate_hidden', { pointId: p.id })}>
                    🔎 調查隱藏內容:{p.title}
                  </button>
                ))}
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
              {enemyHere && (investigator.allies ?? [])
                .filter((a) => !a.exhausted && a.attack > 0)
                .map((a) => (
                  <button
                    key={a.cardInstanceId}
                    className="attack"
                    onClick={() => submitIntent('ally_attack', { allyInstanceId: a.cardInstanceId, enemyInstanceId: enemyHere.instanceId })}
                  >
                    🤝 {a.name}攻擊（{a.attack}）
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
              <button onClick={endTurn}>結束敵人階段 → 下回合</button>
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
              const usesLeft = investigator.assetState?.[id]?.usesLeft;
              return (
                <div key={id} className="asset-row">
                  <div className="asset-name">
                    {data?.name_zh ?? id}
                    {usesLeft != null && <span> ・🔻{usesLeft}</span>}
                  </div>
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

      {/* === Modal 動作三段演出(Phase2 C:敘述 → 檢定 → 結果)=== */}
      {actionPlay && (
        <div className="modal-backdrop active">
          <div className="modal-frame modal-action-play">
            <div className="modal-title">{actionPlay.title} · {actionPlay.beat === 1 ? '敘述' : actionPlay.beat === 2 ? '檢定' : '結果'}</div>
            {actionPlay.beat === 1 && (
              <>
                <div className="modal-illustration">敘事插圖(待美術／資料)</div>
                <hr className="modal-divider" />
                <div className="modal-narrative">{actionPlay.narration}</div>
                <hr className="modal-divider" />
                <div className="action-row">
                  <button onClick={advanceActionPlay}>{actionPlay.hasCheck ? '🎲 擲骰檢定 →' : '繼續 →'}</button>
                </div>
              </>
            )}
            {actionPlay.beat === 2 && (
              <>
                <div className="modal-illustration">{actionPlay.rolling ? '🎲 擲骰中…' : '🎲 擲骰'}</div>
                <hr className="modal-divider" />
                <div className="modal-narrative">
                  {actionPlay.rolling
                    ? <div>骰子還在桌上滾動……</div>
                    : actionPlay.checkLines.map((l, i) => <div key={i}>{l}</div>)}
                </div>
                <hr className="modal-divider" />
                <div className="action-row">
                  <button disabled={actionPlay.rolling} onClick={advanceActionPlay}>👁 看結果 →</button>
                </div>
              </>
            )}
            {actionPlay.beat === 3 && (
              <>
                <div className="modal-illustration">結果</div>
                <hr className="modal-divider" />
                <div className="modal-narrative">
                  {actionPlay.resultLines.length > 0
                    ? actionPlay.resultLines.map((l, i) => <div key={i}>{l}</div>)
                    : <div>(無額外結果)</div>}
                </div>
                <hr className="modal-divider" />
                <div className="action-row">
                  <button onClick={completeActionPlay}>✓ 完成</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* === Modal 議程 === */}
      {damageAlloc && (
        <div className="modal-backdrop active">
          <div className="modal-frame">
            <div className="modal-title">🩹 傷害分配（§11）</div>
            <div className="modal-narrative">
              這一擊造成
              {damageAlloc.physical > 0 ? ` ${damageAlloc.physical} 物理` : ''}
              {damageAlloc.physical > 0 && damageAlloc.horror > 0 ? ' /' : ''}
              {damageAlloc.horror > 0 ? ` ${damageAlloc.horror} 恐懼` : ''}
              。要讓誰替你擋下?
            </div>
            <hr className="modal-divider" />
            <div className="action-row">
              {damageAlloc.targets.map((t) => (
                <button key={t.cardInstanceId} onClick={() => allocateDamageTo(t)}>
                  🤝 {t.name}（可擋 HP {t.physicalCapacity} / SAN {t.horrorCapacity}）
                </button>
              ))}
              <button onClick={() => setDamageAlloc(null)}>🧍 我自己扛</button>
            </div>
          </div>
        </div>
      )}
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

            {/* 城主威脅區:open-hand 武器庫全攤開(規範原則 1「看得到威脅,但擋不完」) */}
            {!setup.tutorial && setup.mythosCards.length > 0 && (
              <>
                <hr className="modal-divider" />
                <div className="cond-title">✦ 城主威脅區(神話卡武器庫)✦</div>
                <div className="threat-grid">
                  {setup.mythosCards.map((mc) => {
                    const onCooldown = (keeperState.cooldowns[mc.id] ?? 0) > 0;
                    const usedUp =
                      (!mc.reusable && (keeperState.uses[mc.id] ?? 0) >= 1) ||
                      (mc.max_uses_per_stage != null && (keeperState.uses[mc.id] ?? 0) >= mc.max_uses_per_stage);
                    const dormant = !isCardExecutable(mc);
                    const stateLabel = dormant ? '蟄伏' : usedUp ? '已用盡' : onCooldown ? `冷卻 ${keeperState.cooldowns[mc.id]}` : null;
                    return (
                      <div key={mc.id} className={'threat-card' + (dormant || usedUp || onCooldown ? ' threat-card-inactive' : '')}>
                        <div className="threat-card-head">
                          <span className="threat-card-name">{mc.name_zh}</span>
                          <span className="threat-card-cost">{mc.action_cost} 點</span>
                        </div>
                        <div className="threat-card-meta">{mc.card_category} · {mc.intensity_tag}{stateLabel ? ' · ' + stateLabel : ''}</div>
                        {mc.description_zh && <div className="threat-card-desc">{mc.description_zh}</div>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
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
              {teamMembers.map((member, idx) => {
                const inv = member.inv;
                const locName = locMeta[inv.currentLocationId || '']?.name ?? '未知';
                return (
                  <div key={inv.investigatorId} className={'team-card tc-' + (idx + 1)}>
                    <div className={'team-avatar ta-' + (idx + 1)} />
                    <div className="tc-info">
                      <div className="tc-name">{member.name}</div>
                      <div className={'tc-faction f' + (idx + 1)}>{member.label}</div>
                      <div className="tc-stats">
                        <span className="tc-hp">體力 {inv.hp}/{inv.hpMax}</span>
                        <span className="tc-san">理智 {inv.san}/{inv.sanMax}</span>
                        {inv.dead || inv.permanentlyDead ? <span>💀 死亡</span> : isDowned(inv) ? <span>🩸 瀕死 {(inv.deathSaveSuccesses ?? 0)}/3</span> : null}
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
