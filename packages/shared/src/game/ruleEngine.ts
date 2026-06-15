/**
 * G-01 引擎核心 — 規則執行引擎(薄層)
 *
 * 依第三章 §4.1 行動點六步生命週期:
 *   意圖宣告 → 合法性檢查 → 費用支付 → 效果結算 → 狀態更新 → 視覺回饋
 *
 * 本層責任:接 IntentMessage,執行合法性檢查 + 費用扣減 + 效果結算,
 *           回傳 ResultMessage 與新狀態。視覺回饋由容器處理。
 *
 * G1 階段範圍(§3.3):
 * - ✓ gain_resource(拿資源)
 * - ✓ draw_card(抽卡,含 §3.3 牌庫空懲罰)
 * - ✓ move(移動,含 §6.2 障礙物 2 行動點)
 * - ✗ play_card / attack / investigate 等(stub,後續展開)
 *
 * 規則書權威依據:02_rulebook_ch2.md §6.1 §6.2 §3.3 §7.2
 */
import type {
  IntentMessage,
  ResultMessage,
  ResultEffect,
} from './messages';
import type {
  ScenarioState,
  InvestigatorState,
  TurnState,
  LocationInstance,
} from './state';
import {
  resolveCheck,
  commitValueFor,
  visibilityModifier,
  drawChaosToken,
  resolveSpellSideEffect,
} from './checks';
import type { AttributeKey, CommitIcons } from './checks';
import { executeCardEffects, passiveTestModifier } from './effectsExecutor';
import { runFearChecks, applyAttackOfOpportunity, spawnEnemy } from './monsterActions';
import type { EnemyDataLookup, AttackCardLookup } from './monsterActions';
import { attachmentTestModifier } from './keeperAI';
import { isDowned, applyStabilize } from './dying';
import { revealOnEnter, revealOnGeneralSuccess, claimHiddenReward } from './hiddenInvestigation';

// ─── 卡片實例資料(容器由 bootstrap cardIndex 餵入)──
export interface CardData {
  commit_icons?: CommitIcons;
  name_zh?: string;
  card_type?: string;
  cost?: number | null;
  combat_style?: string | null;
  attribute_modifiers?: Record<string, number>;
  subtypes?: unknown[];
  /** 武器彈藥(ch3 §10.1:打完進棄牌堆;null = 近戰無限) */
  ammo?: number | null;
  /** 一般使用次數(消耗品/法術充能) */
  uses?: number | null;
  /** 三合一消費用途(ch3 §2.2;資料未配置時為 false/null) */
  consume_enabled?: boolean;
  consume_effect?: Record<string, unknown> | null;
  effects?: Array<{
    trigger_type: string;
    effect_code: string;
    effect_params: Record<string, unknown> | null;
    duration?: string | null;
    description_zh?: string | null;
  }>;
}

/** 卡片的使用次數上限(武器 ammo 優先,其次一般 uses;null = 無消耗) */
export function cardMaxUses(data: CardData | undefined): number | null {
  if (!data) return null;
  if (data.ammo != null) return Number(data.ammo);
  if (data.uses != null) return Number(data.uses);
  return null;
}
export type CardDataLookup = Record<string, CardData>;

/** 戰鬥風格卡(§8:攻擊時抽 1 張決定檢定屬性) */
export interface StyleCardData {
  code: string;
  name_zh: string;
  check_attribute: string;
  narrative_attack_zh?: string;
  narrative_success_zh?: string;
  narrative_fail_zh?: string;
}

// ─── 引擎輸入:當前狀態切片 ──────────────
export interface RuleContext {
  scenario: ScenarioState;
  /** 操作該意圖的調查員 */
  investigator: InvestigatorState;
  /** 當前回合層 */
  turn: TurnState;
  /** 全部調查員(供多人查詢) */
  investigators: Record<string, InvestigatorState>;
  /** 卡片實例資料查找(commit_icons/effects 等) */
  cardLookup?: CardDataLookup;
  /** 地點統計(調查難度 shroud;key = locationDefinitionId) */
  locationStats?: Record<string, { shroud?: number }>;
  /** 敵人定義統計(key = enemyDefinitionId,來自 bootstrap monsters) */
  enemyStats?: EnemyDataLookup;
  /** 怪物招式卡(key = mac code,來自 bootstrap monster_attack_cards) */
  attackCards?: AttackCardLookup;
  /** 戰鬥風格卡池(key = style code,如 shooting;第一層公用池) */
  stylePools?: Record<string, StyleCardData[]>;
  /** 混沌袋情境標記效果碼(stage.chaos_bag.scenario_markers[symbol].effect) */
  chaosMarkerEffects?: Record<string, string>;
  /** 亂數來源(測試注入,預設 Math.random) */
  rng?: () => number;
}

// ─── 加值 commit(§4.2 / ch3 §3):擲骰前投手牌圖示,卡進棄牌堆 ──
interface CommitOutcome {
  value: number;
  committedIds: string[];
  error?: string;
}

function takeCommit(intent: IntentMessage, ctx: RuleContext, attribute: AttributeKey): CommitOutcome {
  const ids = (intent.payload as { commitCardIds?: unknown }).commitCardIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return { value: 0, committedIds: [] };
  }
  const committedIds: string[] = [];
  const iconSets: CommitIcons[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !ctx.investigator.hand.includes(id)) {
      return { value: 0, committedIds: [], error: '加值卡不在手牌中:' + String(id) };
    }
    committedIds.push(id);
    iconSets.push(ctx.cardLookup?.[id]?.commit_icons ?? {});
  }
  return { value: commitValueFor(attribute, iconSets), committedIds };
}

/** commit 卡離手 → 棄牌堆(不花行動點,ch3 §3) */
function applyCommitToInvestigator(inv: InvestigatorState, committedIds: string[]): InvestigatorState {
  if (committedIds.length === 0) return inv;
  return {
    ...inv,
    hand: inv.hand.filter((id) => !committedIds.includes(id)),
    discardPile: [...inv.discardPile, ...committedIds],
  };
}

function commitEffects(commit: CommitOutcome): ResultEffect[] {
  if (commit.committedIds.length === 0) return [];
  return [{
    type: 'commit_cards',
    params: { cardInstanceIds: commit.committedIds, bonus: commit.value },
  }];
}

// ─── 使用次數(ch3 §10.1:彈藥/充能;耗盡進棄牌堆)──
interface SpendUseOutcome {
  investigator: InvestigatorState;
  effects: ResultEffect[];
  /** 次數不足,行動不可執行 */
  rejected?: string;
}

function spendAssetUse(inv: InvestigatorState, cardId: string, data: CardData | undefined): SpendUseOutcome {
  const max = cardMaxUses(data);
  if (max == null) return { investigator: inv, effects: [] }; // 無消耗(近戰/被動)
  const cur = inv.assetState?.[cardId] ?? { usesLeft: max, exhausted: false };
  if ((cur.usesLeft ?? 0) <= 0) {
    return { investigator: inv, effects: [], rejected: '「' + (data?.name_zh ?? cardId) + '」已耗盡。' };
  }
  const left = (cur.usesLeft ?? max) - 1;
  let next: InvestigatorState = {
    ...inv,
    assetState: { ...(inv.assetState ?? {}), [cardId]: { ...cur, usesLeft: left } },
  };
  const effects: ResultEffect[] = [
    { type: 'use_spent', params: { cardInstanceId: cardId, name: data?.name_zh ?? '', left } },
  ];
  if (left <= 0) {
    // 耗盡 → 進棄牌堆(ch3 §10.1「子彈打完就沒了」,需再次打出才能繼續用)
    next = {
      ...next,
      assetsInPlay: next.assetsInPlay.filter((id) => id !== cardId),
      discardPile: [...next.discardPile, cardId],
    };
    effects.push({ type: 'asset_expended', params: { cardInstanceId: cardId, name: data?.name_zh ?? '' } });
  }
  return { investigator: next, effects };
}

// ─── 引擎輸出:結算結果 + 新狀態切片 ──────
export interface RuleResolveOutput {
  /** 對應的 ResultMessage(供 publish 給訊息匯流排) */
  result: Omit<ResultMessage, 'id' | 'timestamp' | 'schemaVersion' | 'kind'> & { kind: 'result' };
  /** 結算後的新狀態切片(若 outcome=accepted)*/
  newState?: {
    investigator?: InvestigatorState;
    scenario?: ScenarioState;
    turn?: TurnState;
    /** 被本行動改動的其他調查員(穩定救援等;key = investigatorId) */
    updatedAllies?: Record<string, InvestigatorState>;
  };
}

// ─── 主入口 ─────────────────────────
export function resolveIntent(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  // 防護:已永久死亡的調查員不可動
  if (ctx.investigator.permanentlyDead) {
    return reject(intent, '[角色名] 的旅程已經結束。他們的紀念照仍在大廳牆上。');
  }
  // §9:瀕死/死亡者不能執行任何行動(回合開始的瀕死檢定由容器結算)
  if (ctx.investigator.dead) {
    return reject(intent, '他們已經沒有回應了。');
  }
  if (isDowned(ctx.investigator)) {
    return reject(intent, '瀕死中 — 只能等待瀕死檢定,或等隊友救援。', '隊友可花 1 行動點「穩定」或用治療拉起');
  }

  // 階段檢查:只有調查員階段可執行主動行動(§4.2)
  if (ctx.turn.phase !== 'investigator') {
    return reject(intent, '不在調查員階段,當前階段:' + ctx.turn.phase, '等待進入調查員階段後再行動');
  }

  let out: RuleResolveOutput;
  switch (intent.actionType) {
    case 'gain_resource':
      out = resolveGainResource(intent, ctx); break;
    case 'draw_card':
      out = resolveDrawCard(intent, ctx); break;
    case 'move':
      out = resolveMove(intent, ctx); break;
    case 'investigate':
      out = resolveInvestigate(intent, ctx); break;
    case 'investigate_hidden':
      out = resolveInvestigateHidden(intent, ctx); break;
    case 'attack':
      out = resolveAttack(intent, ctx); break;
    case 'evade':
      out = resolveEvade(intent, ctx); break;
    case 'play_card':
      out = resolvePlayCard(intent, ctx); break;
    case 'execute_card_action':
      out = resolveExecuteCardAction(intent, ctx); break;
    case 'taunt':
      out = resolveTaunt(intent, ctx); break;
    case 'stabilize':
      out = resolveStabilize(intent, ctx); break;
    case 'consume':
      out = resolveConsume(intent, ctx); break;
    // 以下 stub,等後續批次展開
    case 'commit_attribute_icon':
    case 'short_rest':
    case 'declare_intent':
      return reject(intent, '此行動的引擎結算尚未實作(G1 階段 stub)');
    default:
      return reject(intent, '未知的動作類型:' + (intent as { actionType: string }).actionType);
  }
  return finalizeEngagementPenalty(intent, ctx, out);
}

/**
 * §7.2 交戰限制:交戰中只能攻擊和閃避,其他行動觸發藉機攻擊(物理+恐懼雙重)。
 * 攻擊類豁免:attack / evade / 武器攻擊(execute_card_action 結果含 style_card_drawn)。
 */
function finalizeEngagementPenalty(
  intent: IntentMessage,
  ctx: RuleContext,
  out: RuleResolveOutput,
): RuleResolveOutput {
  if (out.result.outcome !== 'accepted') return out;
  if (ctx.investigator.engagedWith.length === 0) return out;
  if (intent.actionType === 'attack' || intent.actionType === 'evade') return out;
  if (
    intent.actionType === 'execute_card_action' &&
    (out.result.effects ?? []).some((e) => e.type === 'style_card_drawn')
  ) {
    return out;
  }
  let inv = out.newState?.investigator ?? ctx.investigator;
  let sc = out.newState?.scenario ?? ctx.scenario;
  // AoO 以「行動當下」的交戰清單結算(用 ctx 的清單,避免行動本身已改過狀態)
  const aoo = applyAttackOfOpportunity(
    { ...inv, engagedWith: ctx.investigator.engagedWith },
    sc,
    ctx.enemyStats ?? {},
  );
  inv = { ...aoo.investigator, engagedWith: inv.engagedWith };
  const effects = [...(out.result.effects ?? []), ...aoo.effects];

  // 移動離開 = 強行脫離:吃完 AoO 後雙向解除交戰(交戰必須同地點)
  if (intent.actionType === 'move') {
    const leftBehind = ctx.investigator.engagedWith;
    inv = { ...inv, engagedWith: [] };
    sc = {
      ...sc,
      enemies: sc.enemies.map((e) =>
        leftBehind.includes(e.instanceId)
          ? { ...e, engagedWith: e.engagedWith.filter((id) => id !== ctx.investigator.investigatorId) }
          : e,
      ),
    };
    effects.push({
      type: 'engagement_broken',
      params: { narrative: '你掙脫了糾纏,逃向另一頭。' },
    });
  }
  return {
    result: { ...out.result, effects },
    newState: { ...out.newState, investigator: inv, scenario: sc },
  };
}

// ─── 各行動結算 ──────────────────────

/** 拿資源 — §6.1 / §4.4 步驟 3 扣行動點(1) / 步驟 4 結算 +1 資源 */
function resolveGainResource(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:拿資源需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const newInv: InvestigatorState = {
    ...ctx.investigator,
    actionPoints: ctx.investigator.actionPoints - 1,
    resources: ctx.investigator.resources + 1,
  };
  return accept(intent, [
    { type: 'spend_action_point', params: { amount: 1 } },
    { type: 'gain_resource', params: { amount: 1 } },
  ], { investigator: newInv });
}

/** 抽卡 — §6.1 / §3.3 牌庫空則受 1 恐懼 */
function resolveDrawCard(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:抽卡需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const newInv: InvestigatorState = {
    ...ctx.investigator,
    actionPoints: ctx.investigator.actionPoints - 1,
  };
  // §3.3:牌庫為空時抽牌改為承受 1 點恐懼傷害,不自動洗回
  if (ctx.investigator.deck.length === 0) {
    newInv.san = Math.max(0, ctx.investigator.san - 1);
    return accept(intent, [
      { type: 'spend_action_point', params: { amount: 1 } },
      { type: 'deck_empty_horror', params: { amount: 1 } },
    ], { investigator: newInv });
  }
  // 正常抽牌
  const drawnCard = ctx.investigator.deck[0];
  newInv.deck = ctx.investigator.deck.slice(1);
  newInv.hand = [...ctx.investigator.hand, drawnCard];
  return accept(intent, [
    { type: 'spend_action_point', params: { amount: 1 } },
    { type: 'draw_card', params: { cardInstanceId: drawnCard }, targetId: ctx.investigator.investigatorId },
  ], { investigator: newInv });
}

/** 移動 — §6.1 普通 1 / §6.2 障礙物 2 / §7.2 交戰中觸發藉機攻擊(暫 stub) */
function resolveMove(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  const targetId = (intent.payload as { targetLocationId?: string }).targetLocationId;
  if (typeof targetId !== 'string') {
    return reject(intent, '移動意圖缺 targetLocationId');
  }
  if (targetId === ctx.investigator.currentLocationId) {
    return reject(intent, '已在該地點,無需移動');
  }
  const target = ctx.scenario.locations.find((l) => l.locationDefinitionId === targetId);
  if (!target) {
    return reject(intent, '目標地點不存在於場景:' + targetId);
  }
  // 相鄰檢查
  const current = ctx.scenario.locations.find(
    (l) => l.locationDefinitionId === ctx.investigator.currentLocationId
  );
  if (!current || !current.connectedTo.includes(targetId)) {
    return reject(intent, '目標地點與當前位置不相鄰');
  }
  // 解鎖檢查(教學關卡用)
  if (ctx.scenario.unlockedLocations.length > 0 && !ctx.scenario.unlockedLocations.includes(targetId)) {
    return reject(intent, '「' + targetId + '」這條路還沒打開', '完成當前地點的目標即可解鎖');
  }
  const cost = target.isObstacle ? 2 : 1;
  if (ctx.investigator.actionPoints < cost) {
    return reject(intent, '行動點不足:移動到「' + targetId + '」需 ' + cost + ',剩 ' + ctx.investigator.actionPoints);
  }
  // 移動本體(§7.2 交戰中移動的藉機攻擊由 finalizeEngagementPenalty 統一結算)
  let newInv: InvestigatorState = {
    ...ctx.investigator,
    actionPoints: ctx.investigator.actionPoints - cost,
    currentLocationId: targetId,
  };
  const effects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: cost } },
    { type: 'move', params: { from: ctx.investigator.currentLocationId, to: targetId } },
  ];
  // §7.6/7.7 進入新位置 → 恐懼半徑掃描(每隻怪只觸發一次)
  const fear = runFearChecks(newInv, ctx.scenario, ctx.enemyStats ?? {}, ctx.rng);
  newInv = fear.investigator;
  effects.push(...fear.effects);
  // §13.2 進新地點:感知 ≥ 門檻的隱藏調查點自動揭露給該調查員
  const reveal = revealOnEnter(ctx.scenario.hiddenPoints ?? [], newInv.investigatorId, targetId, newInv.attributes.perception);
  let movedScenario: ScenarioState | undefined;
  if (reveal.newlyRevealed.length > 0) {
    movedScenario = { ...ctx.scenario, hiddenPoints: reveal.points };
    for (const hp of reveal.newlyRevealed) {
      effects.push({ type: 'hidden_point_revealed', params: { pointId: hp.id, title: hp.title, narrative: '你注意到不對勁——' + hp.title }, targetId });
    }
  }
  return accept(
    intent,
    effects,
    movedScenario ? { investigator: newInv, scenario: movedScenario } : { investigator: newInv },
  );
}

/**
 * 消費 — 三合一第三用途(ch3 §2.2/§4):1 行動點,從手牌直接棄掉,觸發輔助效果。
 * 資料側 consume_enabled=true 且 consume_effect 配置時才可用(目前卡池尚未配置,
 * 引擎先把管線鋪通,內容跟上即生效)。
 * payload: { cardInstanceId }
 */
function resolveConsume(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:消費需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const cardId = (intent.payload as { cardInstanceId?: string }).cardInstanceId;
  if (typeof cardId !== 'string' || !ctx.investigator.hand.includes(cardId)) {
    return reject(intent, '該卡不在手牌中:' + String(cardId));
  }
  const data = ctx.cardLookup?.[cardId];
  if (!data?.consume_enabled || !data.consume_effect) {
    return reject(intent, '「' + (data?.name_zh ?? cardId) + '」沒有消費用途。');
  }
  const fx = data.consume_effect as { effect_code?: string; effect_params?: Record<string, unknown> | null };
  if (!fx.effect_code) {
    return reject(intent, '「' + (data.name_zh ?? cardId) + '」的消費效果資料不完整。');
  }
  let inv: InvestigatorState = {
    ...ctx.investigator,
    actionPoints: ctx.investigator.actionPoints - 1,
    hand: ctx.investigator.hand.filter((id) => id !== cardId),
    discardPile: [...ctx.investigator.discardPile, cardId],
  };
  const exec = executeCardEffects(
    [{ trigger_type: 'on_consume', effect_code: String(fx.effect_code), effect_params: fx.effect_params ?? null }],
    inv,
    ctx.scenario,
    ctx.cardLookup ?? {},
  );
  inv = exec.investigator;
  const effects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    { type: 'card_consumed', params: { cardInstanceId: cardId, name: data.name_zh ?? '' } },
    ...exec.effects,
  ];
  if (exec.unsupported.length > 0) {
    effects.push({ type: 'effect_unsupported', params: { codes: exec.unsupported } });
  }
  return accept(intent, effects, { investigator: inv, scenario: exec.scenario });
}

/**
 * 穩定 — §9.5:花 1 行動點,讓同地點瀕死隊友的瀕死檢定 +1 次成功(自動成功,無檢定)
 * payload: { targetInvestigatorId }
 */
function resolveStabilize(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:穩定需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const targetId = (intent.payload as { targetInvestigatorId?: string }).targetInvestigatorId;
  const target = targetId ? ctx.investigators[targetId] : undefined;
  if (!target) {
    return reject(intent, '找不到要穩定的隊友:' + String(targetId));
  }
  if (target.currentLocationId !== ctx.investigator.currentLocationId) {
    return reject(intent, '隊友不在你所在地點,搆不到他。');
  }
  if (!isDowned(target)) {
    return reject(intent, '對方還站著,不需要穩定。');
  }
  const stabilized = applyStabilize(target);
  const newInv: InvestigatorState = {
    ...ctx.investigator,
    actionPoints: ctx.investigator.actionPoints - 1,
  };
  return accept(
    intent,
    [{ type: 'spend_action_point', params: { amount: 1 } }, ...stabilized.effects],
    { investigator: newInv, updatedAllies: { [target.investigatorId]: stabilized.investigator } },
  );
}

/** 嘲諷 — §7.3:1 行動點,將同地點未與你交戰的敵人拉入交戰(無檢定) */
function resolveTaunt(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:嘲諷需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const requestedId = (intent.payload as { enemyInstanceId?: string }).enemyInstanceId;
  const candidates = ctx.scenario.enemies.filter(
    (e) =>
      e.hp > 0 &&
      e.locationId === ctx.investigator.currentLocationId &&
      !e.engagedWith.includes(ctx.investigator.investigatorId),
  );
  const enemy = requestedId
    ? candidates.find((e) => e.instanceId === requestedId)
    : candidates[0];
  if (!enemy) {
    return reject(intent, '同地點沒有未與你交戰的敵人');
  }
  // 單一持有者模型(Uria 拍板):嘲諷 = 把怪「改為」與你交戰,從前持有者手上轉走。
  // 怪的 engagedWith 永遠 ≤1(唯一持有者)。
  const prevHolders = enemy.engagedWith.filter((id) => id !== ctx.investigator.investigatorId);
  const newInv: InvestigatorState = {
    ...ctx.investigator,
    actionPoints: ctx.investigator.actionPoints - 1,
    engagedWith: [...ctx.investigator.engagedWith, enemy.instanceId],
  };
  const newScenario: ScenarioState = {
    ...ctx.scenario,
    enemies: ctx.scenario.enemies.map((e) =>
      e.instanceId === enemy.instanceId
        ? { ...e, engagedWith: [ctx.investigator.investigatorId] } // 獨佔交戰
        : e,
    ),
  };
  // 前持有者解除與這隻怪的交戰(透過 updatedAllies 回傳)
  const updatedAllies: Record<string, InvestigatorState> = {};
  for (const holderId of prevHolders) {
    const holder = ctx.investigators[holderId];
    if (holder) updatedAllies[holderId] = { ...holder, engagedWith: holder.engagedWith.filter((id) => id !== enemy.instanceId) };
  }
  return accept(
    intent,
    [
      { type: 'spend_action_point', params: { amount: 1 } },
      { type: 'taunt', params: { narrative: '你大聲叫罵,牠的注意力轉向了你。' }, targetId: enemy.instanceId },
    ],
    { investigator: newInv, scenario: newScenario, ...(Object.keys(updatedAllies).length ? { updatedAllies } : {}) },
  );
}

/**
 * 調查 — §6.1 / §13(線索系統)+ §4 檢定管線
 * 感知檢定,DC = 地點 shroud(locationStats 未提供時 fallback 10);支援加值 commit。
 * 隱藏調查點(hidden_info 揭露)後續展開。
 */
function resolveInvestigate(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:調查需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const commit = takeCommit(intent, ctx, 'perception');
  if (commit.error) return reject(intent, commit.error);

  const locId = ctx.investigator.currentLocationId || '';
  const dc = ctx.locationStats?.[locId]?.shroud ?? 10;
  const check = resolveCheck(
    dc,
    {
      attribute: ctx.investigator.attributes.perception,
      commit: commit.value,
      // 城主附著卡的全域檢定修正(海腥味瀰漫等)
      situational: attachmentTestModifier(ctx.scenario.keeperAttachments, 'perception'),
    },
    ctx.rng,
  );
  const success = check.outcome === 'success';
  const newInv: InvestigatorState = {
    ...applyCommitToInvestigator(ctx.investigator, commit.committedIds),
    actionPoints: ctx.investigator.actionPoints - 1,
  };
  const baseEffects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    ...commitEffects(commit),
    { type: 'roll_d20', params: { roll: check.roll, attribute: 'perception', modifier: check.total - check.roll, total: check.total, dc, outcome: success ? 'success' : 'fail' } },
  ];
  if (!success) {
    return accept(intent, [...baseEffects, { type: 'investigate_fail', params: { narrative: '你翻找了一圈,什麼線索都沒留下。' } }], { investigator: newInv });
  }
  // 成功:在當前地點放 1 線索
  const newScenario: ScenarioState = {
    ...ctx.scenario,
    objectiveProgress: ctx.scenario.objectiveProgress + 1,
    tokens: [
      ...ctx.scenario.tokens,
      { tokenType: 'clue', locationId: ctx.investigator.currentLocationId || '', amount: 1 },
    ],
  };
  const after = applyOnSuccessCommit(true, commit.committedIds, newInv, newScenario, ctx.cardLookup ?? {});
  // §13.4 低感知碰運氣:一般調查成功時,觸發發現該地點一個尚未揭露的隱藏調查點
  let invScenario = after.scenario;
  const discoverEffects: ResultEffect[] = [];
  const gen = revealOnGeneralSuccess(invScenario.hiddenPoints ?? [], newInv.investigatorId, locId);
  if (gen.discovered) {
    invScenario = { ...invScenario, hiddenPoints: gen.points };
    discoverEffects.push({ type: 'hidden_point_revealed', params: { pointId: gen.discovered.id, title: gen.discovered.title, narrative: '搜查時,你瞥見了被刻意藏起的東西——' + gen.discovered.title }, targetId: locId });
  }
  return accept(
    intent,
    [
      ...baseEffects,
      { type: 'investigate_success', params: { narrative: '你在塵埃裡發現了一張被遺忘的紙條。', clueAmount: 1 }, targetId: ctx.investigator.currentLocationId || undefined },
      { type: 'gain_clue', params: { amount: 1 } },
      ...after.effects,
      ...discoverEffects,
    ],
    { investigator: after.investigator, scenario: invScenario }
  );
}

/**
 * §13.3 第三層:直接調查「已揭露」的隱藏調查點 → 成功領取豐厚獎勵。
 * 分配規則(Uria 2026-06-13):每位調查員各領一次;限定品歸首位領取者(派旗標)。
 * 獎勵實體由容器依 hidden_reward 效果結算(發卡/設旗標等),引擎只更新 claimedBy。
 * 合法性檢查(不耗費用)先行,確認後才擲骰(§4.2 費用支付在合法性之後)。
 * payload: { pointId, commitInstanceIds? }
 */
function resolveInvestigateHidden(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  const pointId = (intent.payload as { pointId?: string }).pointId;
  if (typeof pointId !== 'string') {
    return reject(intent, '缺少要調查的隱藏調查點');
  }
  const locId = ctx.investigator.currentLocationId || '';
  const point = (ctx.scenario.hiddenPoints ?? []).find((p) => p.id === pointId);
  if (!point) {
    return reject(intent, '這裡沒有這個隱藏調查點');
  }
  if (point.locationId !== locId) {
    return reject(intent, '你不在這個隱藏調查點所在的地點', '先移動到「' + point.locationId + '」');
  }
  if (!point.revealedTo.includes(ctx.investigator.investigatorId)) {
    return reject(intent, '這裡還藏著什麼,但你還沒發現它', '先在這裡進行一般調查碰運氣,或讓高感知的隊友進場');
  }
  if (point.claimedBy.includes(ctx.investigator.investigatorId)) {
    return reject(intent, '你已經徹底搜查過這個地方了');
  }
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:調查隱藏內容需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const commit = takeCommit(intent, ctx, 'perception');
  if (commit.error) return reject(intent, commit.error);

  const dc = ctx.locationStats?.[locId]?.shroud ?? 10;
  const check = resolveCheck(
    dc,
    {
      attribute: ctx.investigator.attributes.perception,
      commit: commit.value,
      situational: attachmentTestModifier(ctx.scenario.keeperAttachments, 'perception'),
    },
    ctx.rng,
  );
  const success = check.outcome === 'success';
  const newInv: InvestigatorState = {
    ...applyCommitToInvestigator(ctx.investigator, commit.committedIds),
    actionPoints: ctx.investigator.actionPoints - 1,
  };
  const baseEffects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    ...commitEffects(commit),
    { type: 'roll_d20', params: { roll: check.roll, attribute: 'perception', modifier: check.total - check.roll, total: check.total, dc, outcome: success ? 'success' : 'fail' } },
  ];
  if (!success) {
    return accept(
      intent,
      [...baseEffects, { type: 'hidden_investigate_fail', params: { narrative: '你翻遍了角落,卻一無所獲——它還在那裡,等著。', pointId } }],
      { investigator: newInv },
    );
  }
  const claim = claimHiddenReward(ctx.scenario.hiddenPoints ?? [], pointId, ctx.investigator.investigatorId);
  // 前置合法性已過,正常情形 claim 必 ok;保險:claim 失敗時仍記費用,不發獎勵
  if (!claim.ok) {
    return accept(intent, baseEffects, { investigator: newInv });
  }
  const newScenario: ScenarioState = { ...ctx.scenario, hiddenPoints: claim.points };
  return accept(
    intent,
    [
      ...baseEffects,
      {
        type: 'hidden_reward',
        params: {
          pointId,
          title: point.title,
          narrative: point.description || '你的指尖觸到了某個不該存在的東西。',
          rewardType: claim.rewardType ?? 'effect',
          rewardParams: claim.rewardParams ?? {},
          gotLimited: claim.gotLimited,
          limitedFlag: claim.limitedFlag,
        },
        targetId: locId,
      },
    ],
    { investigator: newInv, scenario: newScenario },
  );
}

/**
 * 攻擊 — §6.1 / §5(完整版見第三章 §5)
 * G1 階段簡化:擲 d20 + 力量修正 vs 怪物 DC 10
 * 命中 → 怪物 hp -1
 * 未實作:戰鬥風格卡 / 武器加值 / 三層修正 / 自然 20/1 特殊處理
 */
function resolveAttack(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:攻擊需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const targetEnemyId = (intent.payload as { enemyInstanceId?: string }).enemyInstanceId;
  if (!targetEnemyId) {
    // 自動鎖定當前地點第一隻活著的怪物
    const enemyHere = ctx.scenario.enemies.find((e) => e.locationId === ctx.investigator.currentLocationId && e.hp > 0);
    if (!enemyHere) {
      return reject(intent, '當前地點沒有可攻擊的目標');
    }
    return performAttack(intent, ctx, enemyHere.instanceId);
  }
  return performAttack(intent, ctx, targetEnemyId);
}

/**
 * 攻擊結算 — §4 檢定管線 + §7.5 + §12.1 光照
 * DC = 怪物 dc(enemyStats 未提供時 fallback 10);夜間/黑暗攻擊 -2;
 * 自然 20 爆擊傷害 ×2;自然 1 無交戰隊友 → 純未命中(誤傷隊友屬多人,後續)。
 * 基礎傷害 1(武器卡面傷害等 play_card 落地後接上,§7.5)。
 * 屬性暫用力量(戰鬥風格卡抽取屬性在下一批接上,§8)。
 */
function performAttack(intent: IntentMessage, ctx: RuleContext, enemyInstanceId: string): RuleResolveOutput {
  const enemy = ctx.scenario.enemies.find((e) => e.instanceId === enemyInstanceId);
  if (!enemy || enemy.hp <= 0) {
    return reject(intent, '目標已倒下或不存在');
  }
  if (enemy.locationId !== ctx.investigator.currentLocationId) {
    return reject(intent, '目標不在你所在地點');
  }
  const commit = takeCommit(intent, ctx, 'strength');
  if (commit.error) return reject(intent, commit.error);

  const here = ctx.scenario.locations.find(
    (l) => l.locationDefinitionId === ctx.investigator.currentLocationId,
  );
  const situational = here ? visibilityModifier('attack', here.visibility) : 0;
  const dc = ctx.enemyStats?.[enemy.enemyDefinitionId]?.dc ?? 10;
  const check = resolveCheck(
    dc,
    { attribute: ctx.investigator.attributes.strength, commit: commit.value, situational },
    ctx.rng,
  );
  const newInv: InvestigatorState = {
    ...applyCommitToInvestigator(ctx.investigator, commit.committedIds),
    actionPoints: ctx.investigator.actionPoints - 1,
  };
  const baseEffects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    ...commitEffects(commit),
    { type: 'roll_d20', params: { roll: check.roll, attribute: 'strength', modifier: check.total - check.roll, total: check.total, dc, outcome: check.outcome === 'success' ? 'hit' : 'miss', natural20: check.natural20, natural1: check.natural1 }, targetId: enemyInstanceId },
  ];
  // §7.5 自然 1:有交戰隊友時誤傷;單人無隊友 → 純未命中
  if (check.outcome !== 'success' || check.natural1) {
    return accept(intent, [...baseEffects, { type: 'attack_miss', params: { narrative: check.natural1 ? '你的攻擊完全落空,差點傷到自己。' : '你的攻擊擦身而過,牠仍站在那裡。' }, targetId: enemyInstanceId }], { investigator: newInv });
  }
  // 命中:基礎 1 點;自然 20 爆擊 ×2(§7.5)
  const damage = check.natural20 ? 2 : 1;
  const newHp = enemy.hp - damage;
  const newScenario: ScenarioState = {
    ...ctx.scenario,
    enemies: ctx.scenario.enemies.map((e) => (e.instanceId === enemyInstanceId ? { ...e, hp: newHp } : e)),
  };
  const effects: ResultEffect[] = [
    ...baseEffects,
    { type: 'attack_hit', params: { damage, critical: check.natural20, narrative: (check.natural20 ? '【爆擊】' : '') + hpToNarrative(newHp, enemy.hp) }, targetId: enemyInstanceId },
  ];
  if (newHp <= 0) {
    effects.push({ type: 'enemy_defeated', params: { narrative: '牠倒下了,空氣裡只剩下血腥與沉默。' }, targetId: enemyInstanceId });
  }
  return accept(intent, effects, { investigator: newInv, scenario: newScenario });
}

/**
 * 閃避 — §7.4:成敗都脫離交戰;失敗受敵人物理傷害一次;成功敵人被絆倒。
 * 反應檢定(支柱一 v0.3 §12.4:閃避屬反應屬性影響範圍);DC = 敵人 dc fallback 10;
 * §12.1 黑暗中閃避 +2。
 */
function resolveEvade(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:閃避需 1,剩 ' + ctx.investigator.actionPoints);
  }
  if (ctx.investigator.engagedWith.length === 0) {
    return reject(intent, '你沒有與任何敵人交戰,無需閃避');
  }
  const commit = takeCommit(intent, ctx, 'reflex');
  if (commit.error) return reject(intent, commit.error);

  // 一次閃避結算一隻:payload 可指定,預設交戰清單第一隻(多敵交戰要逐隻閃避)
  const requestedId = (intent.payload as { enemyInstanceId?: string }).enemyInstanceId;
  const enemyId = requestedId ?? ctx.investigator.engagedWith[0];
  if (!ctx.investigator.engagedWith.includes(enemyId)) {
    return reject(intent, '你沒有與該敵人交戰:' + enemyId);
  }
  const enemy = ctx.scenario.enemies.find((e) => e.instanceId === enemyId);
  const here = ctx.scenario.locations.find(
    (l) => l.locationDefinitionId === ctx.investigator.currentLocationId,
  );
  const situational = here ? visibilityModifier('evade', here.visibility) : 0;
  const dc = enemy ? ctx.enemyStats?.[enemy.enemyDefinitionId]?.dc ?? 10 : 10;
  const check = resolveCheck(
    dc,
    { attribute: ctx.investigator.attributes.reflex, commit: commit.value, situational },
    ctx.rng,
  );
  const success = check.outcome === 'success';
  const damageTaken = success
    ? 0
    : (enemy ? ctx.enemyStats?.[enemy.enemyDefinitionId]?.damage_physical ?? 1 : 1);

  // §7.4 成敗都脫離交戰 — 只脫離本次結算的這一隻,其他交戰維持
  const newInv: InvestigatorState = {
    ...applyCommitToInvestigator(ctx.investigator, commit.committedIds),
    actionPoints: ctx.investigator.actionPoints - 1,
    engagedWith: ctx.investigator.engagedWith.filter((id) => id !== enemyId),
    hp: Math.max(0, ctx.investigator.hp - damageTaken),
  };
  const newScenario: ScenarioState = {
    ...ctx.scenario,
    enemies: ctx.scenario.enemies.map((e) =>
      e.instanceId === enemyId
        ? { ...e, engagedWith: e.engagedWith.filter((id) => id !== ctx.investigator.investigatorId) }
        : e,
    ),
  };
  const effects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    ...commitEffects(commit),
    { type: 'roll_d20', params: { roll: check.roll, attribute: 'reflex', modifier: check.total - check.roll, total: check.total, dc, outcome: success ? 'success' : 'fail' } },
    success
      ? { type: 'evade_success', params: { narrative: '你側身一滾,牠撲空絆倒。你脫離了交戰。' }, targetId: enemyId }
      : { type: 'evade_fail', params: { damage: damageTaken, narrative: '你掙脫了,但牠的爪子在你身上留下一道口子。' }, targetId: enemyId },
  ];
  return accept(intent, effects, { investigator: newInv, scenario: newScenario });
}


/**
 * 打出卡片 — §6.1:1 行動點 + 支付卡片費用(資源)
 * 事件卡:立即結算 action 觸發效果 → 棄牌堆
 * 資產/武器/盟友:進場(assetsInPlay),passive 效果由檢定時聚合
 * 技能卡:不可打出(用於加值 commit,ch3 §3.2)
 */
function resolvePlayCard(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:打出卡片需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const cardId = (intent.payload as { cardInstanceId?: string }).cardInstanceId;
  if (typeof cardId !== 'string' || !ctx.investigator.hand.includes(cardId)) {
    return reject(intent, '該卡不在手牌中:' + String(cardId));
  }
  const data = ctx.cardLookup?.[cardId];
  if (!data) {
    return reject(intent, '查無卡片資料:' + cardId);
  }
  if (data.card_type === 'skill') {
    return reject(intent, '技能卡不打出 — 在檢定時投入加值(ch3 §3.2)');
  }
  if (data.card_type === 'weakness') {
    // 弱點是強制納入的顯現物(ch6 §9),不是可主動打出的資產
    return reject(intent, '「' + (data.name_zh ?? cardId) + '」是個人弱點 — 它會自己找上你,不由你打出');
  }
  // 可打出類型白名單:未知/缺漏 card_type 一律不進場(資料不明就不裁決)
  if (!['asset', 'event', 'ally'].includes(String(data.card_type ?? ''))) {
    return reject(intent, '「' + (data.name_zh ?? cardId) + '」的卡片類型不明(' + String(data.card_type ?? '空') + '),引擎不受理');
  }
  const cost = Number(data.cost ?? 0);
  if (ctx.investigator.resources < cost) {
    return reject(intent, '資源不足:「' + (data.name_zh ?? cardId) + '」需 ' + cost + ',剩 ' + ctx.investigator.resources);
  }

  let inv: InvestigatorState = {
    ...ctx.investigator,
    actionPoints: ctx.investigator.actionPoints - 1,
    resources: ctx.investigator.resources - cost,
    hand: ctx.investigator.hand.filter((id) => id !== cardId),
  };
  const baseEffects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    { type: 'play_card', params: { cardInstanceId: cardId, name: data.name_zh ?? '', cost } },
  ];

  if (data.card_type === 'event') {
    // 事件卡:結算 action 效果 → 棄牌堆
    const actionFx = (data.effects ?? []).filter((f) => f.trigger_type === 'action');
    const exec = executeCardEffects(actionFx, inv, ctx.scenario, ctx.cardLookup ?? {});
    inv = { ...exec.investigator, discardPile: [...exec.investigator.discardPile, cardId] };
    let sc = exec.scenario;
    const effects = [...baseEffects, ...exec.effects];
    if (exec.unsupported.length > 0) {
      effects.push({ type: 'effect_unsupported', params: { codes: exec.unsupported } });
    }
    // 施法軌(ch2 §8.4):arcane 事件結算後抽混沌袋定副作用(法術一定命中,代價在袋裡)
    if (String(data.combat_style ?? '') === 'arcane') {
      const targetDef = sc.enemies.find((e) => e.locationId === inv.currentLocationId)?.enemyDefinitionId ?? null;
      effects.push({ type: 'spell_cast', params: { name: data.name_zh ?? '', damage: 0, narrative: '咒文離手 — 力量必中,代價未知。' } });
      const chaos = applySpellChaos(ctx, inv, sc, targetDef);
      inv = chaos.investigator;
      sc = chaos.scenario;
      effects.push(...chaos.effects);
    }
    return accept(intent, effects, { investigator: inv, scenario: sc });
  }

  // 資產/武器/盟友:進場(有使用次數的初始化彈藥/充能,ch3 §10.1)
  const maxUses = cardMaxUses(data);
  inv = {
    ...inv,
    assetsInPlay: [...inv.assetsInPlay, cardId],
    ...(maxUses != null
      ? { assetState: { ...(inv.assetState ?? {}), [cardId]: { usesLeft: maxUses, exhausted: false } } }
      : {}),
  };
  return accept(intent, [...baseEffects, { type: 'asset_enters_play', params: { cardInstanceId: cardId, name: data.name_zh ?? '', uses: maxUses } }], { investigator: inv });
}

/**
 * 執行卡片行動 — §6.1 use_card:場上資產的 action 效果,1 行動點
 * 武器 attack 效果走 §8 風格卡抽取路徑;其餘走效果執行器。
 * payload: { cardInstanceId, actionIndex?(同卡多段行動,預設 0), enemyInstanceId?, commitCardIds? }
 */
function resolveExecuteCardAction(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:執行卡片行動需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const p = intent.payload as { cardInstanceId?: string; actionIndex?: number };
  const cardId = p.cardInstanceId;
  if (typeof cardId !== 'string' || !ctx.investigator.assetsInPlay.includes(cardId)) {
    return reject(intent, '該卡不在場上:' + String(cardId));
  }
  const data = ctx.cardLookup?.[cardId];
  const actionFx = (data?.effects ?? []).filter((f) => f.trigger_type === 'action');
  if (actionFx.length === 0) {
    return reject(intent, '「' + (data?.name_zh ?? cardId) + '」沒有可執行的行動效果');
  }
  const idx = Math.min(Math.max(0, Number(p.actionIndex ?? 0)), actionFx.length - 1);
  const fx = actionFx[idx];

  if (fx.effect_code === 'attack') {
    return performWeaponAttack(intent, ctx, cardId, fx);
  }

  // 一般卡片行動也吃使用次數(霰彈/充能類消耗品,ch3 §10.1)
  const spend = spendAssetUse(ctx.investigator, cardId, data);
  if (spend.rejected) return reject(intent, spend.rejected);
  const inv: InvestigatorState = { ...spend.investigator, actionPoints: ctx.investigator.actionPoints - 1 };
  const exec = executeCardEffects([fx], inv, ctx.scenario, ctx.cardLookup ?? {});
  const effects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    { type: 'card_action', params: { cardInstanceId: cardId, name: data?.name_zh ?? '' } },
    ...spend.effects,
    ...exec.effects,
  ];
  if (exec.unsupported.length > 0) {
    effects.push({ type: 'effect_unsupported', params: { codes: exec.unsupported } });
  }
  return accept(intent, effects, { investigator: exec.investigator, scenario: exec.scenario });
}

/**
 * 武器攻擊 — §8 戰鬥風格卡系統:
 * 武器 combat_style 決定抽哪個風格池 → 抽 1 張風格卡指定檢定屬性 →
 * d20 + 該屬性 + 武器 attribute_modifiers(僅對應屬性,§8)+ 場上被動 + commit + 光照
 * 命中傷害 = 效果 params.damage(資料未填時 fallback 2)+ params.damage_bonus
 */
function performWeaponAttack(
  intent: IntentMessage,
  ctx: RuleContext,
  weaponId: string,
  fx: { effect_params: Record<string, unknown> | null },
): RuleResolveOutput {
  const weapon = ctx.cardLookup?.[weaponId];
  const style = String(weapon?.combat_style ?? '');
  // 神秘攻擊例外(ch2 §8.4):施法不擲骰、不抽風格卡 — 一定命中,抽混沌袋定代價
  if (style === 'arcane') {
    return performSpellAttack(intent, ctx, weaponId, fx);
  }
  const pool = ctx.stylePools?.[style] ?? [];
  if (pool.length === 0) {
    return reject(intent, '「' + (weapon?.name_zh ?? weaponId) + '」的風格池(' + style + ')為空,無法抽風格卡');
  }
  const requestedEnemy = (intent.payload as { enemyInstanceId?: string }).enemyInstanceId;
  const enemy = requestedEnemy
    ? ctx.scenario.enemies.find((e) => e.instanceId === requestedEnemy)
    : ctx.scenario.enemies.find((e) => e.locationId === ctx.investigator.currentLocationId && e.hp > 0);
  if (!enemy || enemy.hp <= 0) {
    return reject(intent, '當前地點沒有可攻擊的目標');
  }
  if (enemy.locationId !== ctx.investigator.currentLocationId) {
    return reject(intent, '目標不在你所在地點');
  }

  const rng = ctx.rng ?? Math.random;
  const styleCard = pool[Math.floor(rng() * pool.length)];
  const attr = styleCard.check_attribute as AttributeKey;
  if (!(attr in ctx.investigator.attributes)) {
    return reject(intent, '風格卡「' + styleCard.name_zh + '」檢定屬性不合法:' + styleCard.check_attribute);
  }
  // 彈藥消耗(ch3 §10.1):攻擊先花 1 發,不夠不能打;打空進棄牌堆
  const spend = spendAssetUse(ctx.investigator, weaponId, weapon);
  if (spend.rejected) return reject(intent, spend.rejected, '再次打出同名武器,或改用其他手段');
  const ctxAfterSpend: RuleContext = { ...ctx, investigator: spend.investigator };
  const commit = takeCommit(intent, ctxAfterSpend, attr);
  if (commit.error) return reject(intent, commit.error);

  const here = ctx.scenario.locations.find(
    (l) => l.locationDefinitionId === ctx.investigator.currentLocationId,
  );
  const situational =
    (here ? visibilityModifier('attack', here.visibility) : 0) +
    attachmentTestModifier(ctx.scenario.keeperAttachments, attr);
  // §8:武器修正只在對應屬性風格卡被抽到時生效 + 場上被動(瞄準鏡等)
  const equipment =
    Number(weapon?.attribute_modifiers?.[attr] ?? 0) +
    passiveTestModifier(ctx.investigator, ctx.cardLookup ?? {}, attr);
  const dc = ctx.enemyStats?.[enemy.enemyDefinitionId]?.dc ?? 10;
  const check = resolveCheck(
    dc,
    { attribute: ctx.investigator.attributes[attr], equipment, commit: commit.value, situational },
    ctx.rng,
  );

  let inv: InvestigatorState = {
    ...applyCommitToInvestigator(spend.investigator, commit.committedIds),
    actionPoints: ctx.investigator.actionPoints - 1,
  };
  const baseEffects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    ...spend.effects,
    { type: 'style_card_drawn', params: { style, name: styleCard.name_zh, attribute: attr, narrative: styleCard.narrative_attack_zh ?? '' } },
    ...commitEffects(commit),
    { type: 'roll_d20', params: { roll: check.roll, attribute: attr, modifier: check.total - check.roll, total: check.total, dc, outcome: check.outcome === 'success' ? 'hit' : 'miss', natural20: check.natural20, natural1: check.natural1 }, targetId: enemy.instanceId },
  ];

  if (check.outcome !== 'success' || check.natural1) {
    const miss = [...baseEffects, { type: 'attack_miss', params: { narrative: styleCard.narrative_fail_zh || '你的攻擊落空了。' }, targetId: enemy.instanceId }];
    const after = applyOnSuccessCommit(false, commit.committedIds, inv, ctx.scenario, ctx.cardLookup ?? {});
    return accept(intent, [...miss, ...after.effects], { investigator: after.investigator, scenario: after.scenario });
  }

  const params = (fx.effect_params ?? {}) as Record<string, any>;
  // 武器卡面傷害(§7.5):params.damage 未填時 fallback 2(資料補齊中)
  const base = Number(params.damage ?? 2) + Number(params.damage_bonus ?? 0);
  const damage = check.natural20 ? base * 2 : base;
  const newHp = enemy.hp - damage;
  let sc: ScenarioState = {
    ...ctx.scenario,
    enemies: ctx.scenario.enemies.map((e) => (e.instanceId === enemy.instanceId ? { ...e, hp: newHp } : e)),
  };
  const effects: ResultEffect[] = [
    ...baseEffects,
    { type: 'attack_hit', params: { damage, critical: check.natural20, weapon: weapon?.name_zh ?? '', narrative: (check.natural20 ? '【爆擊】' : '') + (styleCard.narrative_success_zh || hpToNarrative(newHp, enemy.hp)) }, targetId: enemy.instanceId },
  ];
  if (newHp <= 0) {
    effects.push({ type: 'enemy_defeated', params: { narrative: '牠倒下了,空氣裡只剩下血腥與沉默。' }, targetId: enemy.instanceId });
  }
  const after = applyOnSuccessCommit(true, commit.committedIds, inv, sc, ctx.cardLookup ?? {});
  inv = after.investigator;
  sc = after.scenario;
  return accept(intent, [...effects, ...after.effects], { investigator: inv, scenario: sc });
}

/**
 * 法術攻擊(ch2 §5.8 完整結算流程):
 * 宣告 → 費用(充能)→ 法術效果一定生效(卡面傷害)→ 抽混沌袋 →
 * 與目標法術防禦值比較 → 依 §5.7 處理副作用 → 場景效果。
 * 無擲骰、無風格卡、無爆擊 — 不確定性全在袋子裡。
 */
function performSpellAttack(
  intent: IntentMessage,
  ctx: RuleContext,
  weaponId: string,
  fx: { effect_params: Record<string, unknown> | null },
): RuleResolveOutput {
  const weapon = ctx.cardLookup?.[weaponId];
  const requestedEnemy = (intent.payload as { enemyInstanceId?: string }).enemyInstanceId;
  const enemy = requestedEnemy
    ? ctx.scenario.enemies.find((e) => e.instanceId === requestedEnemy)
    : ctx.scenario.enemies.find((e) => e.locationId === ctx.investigator.currentLocationId && e.hp > 0);
  if (!enemy || enemy.hp <= 0) {
    return reject(intent, '當前地點沒有可施法的目標');
  }
  if (enemy.locationId !== ctx.investigator.currentLocationId) {
    return reject(intent, '目標不在你所在地點');
  }
  // 充能消耗
  const spend = spendAssetUse(ctx.investigator, weaponId, weapon);
  if (spend.rejected) return reject(intent, spend.rejected, '再次打出此法術,或改用其他手段');
  let inv: InvestigatorState = { ...spend.investigator, actionPoints: ctx.investigator.actionPoints - 1 };

  // 法術一定命中(§5.1):卡面傷害直接造成
  const params = (fx.effect_params ?? {}) as Record<string, any>;
  const damage = Number(params.damage ?? 2) + Number(params.damage_bonus ?? 0);
  const newHp = enemy.hp - damage;
  let sc: ScenarioState = {
    ...ctx.scenario,
    enemies: ctx.scenario.enemies.map((e) => (e.instanceId === enemy.instanceId ? { ...e, hp: newHp } : e)),
  };
  const effects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    ...spend.effects,
    {
      type: 'spell_cast',
      params: { name: weapon?.name_zh ?? '', damage, narrative: '力量循著咒文離手 — 它必中,但代價未知。' },
      targetId: enemy.instanceId,
    },
    { type: 'attack_hit', params: { damage, critical: false, weapon: weapon?.name_zh ?? '', narrative: hpToNarrative(newHp, enemy.hp) }, targetId: enemy.instanceId },
  ];
  if (newHp <= 0) {
    effects.push({ type: 'enemy_defeated', params: { narrative: '牠在神秘的光焰中崩解。' }, targetId: enemy.instanceId });
  }
  // 混沌袋副作用
  const chaos = applySpellChaos(ctx, inv, sc, enemy.enemyDefinitionId);
  inv = chaos.investigator;
  sc = chaos.scenario;
  effects.push(...chaos.effects);
  return accept(intent, effects, { investigator: inv, scenario: sc });
}

/**
 * 混沌袋施法副作用結算(ch2 §5,雙軌檢定的第二軌)。
 * 法術一定命中(傷害已在呼叫端結算);本函式抽袋、與法術防禦值比較、
 * 施放副作用與固定場景效果。bless/curse 抽後移出袋(supp04,持久化)。
 */
function applySpellChaos(
  ctx: RuleContext,
  investigator: InvestigatorState,
  scenario: ScenarioState,
  targetEnemyDefId: string | null,
): { investigator: InvestigatorState; scenario: ScenarioState; effects: ResultEffect[] } {
  let inv = investigator;
  let sc = scenario;
  const effects: ResultEffect[] = [];
  if (sc.chaosBag.length === 0) {
    effects.push({ type: 'chaos_bag_empty', params: { narrative: '混沌袋空空如也 — 命運暫時沉默。' } });
    return { investigator: inv, scenario: sc, effects };
  }
  const rng = ctx.rng ?? Math.random;
  const draw = drawChaosToken(sc.chaosBag, rng);
  // bless/curse 抽後移出袋(supp04)
  if (draw.removedTokenIds.length > 0) {
    sc = { ...sc, chaosBag: sc.chaosBag.filter((t) => !draw.removedTokenIds.includes(t.tokenId)) };
  }
  effects.push({
    type: 'chaos_token_drawn',
    params: {
      sequence: draw.drawn.map((t) => t.type + (t.value != null ? `(${t.value})` : '')).join(' → '),
      finalType: draw.finalToken.type,
      value: draw.value,
    },
  });
  const spellDefense = targetEnemyDefId
    ? Number(ctx.enemyStats?.[targetEnemyDefId]?.spell_defense ?? 0)
    : 0;
  const side = resolveSpellSideEffect(draw, spellDefense);
  // 施法者 SAN 變化(觸手 -1 / 遠古印記 +1 / 差值分級 ±)
  if (side.casterSanDelta !== 0) {
    inv = { ...inv, san: Math.max(0, Math.min(inv.sanMax, inv.san + side.casterSanDelta)) };
    effects.push({
      type: 'spell_strain',
      params: {
        delta: side.casterSanDelta,
        tier: side.tier,
        narrative: side.casterSanDelta < 0 ? '力量的反饋擦過心智的邊緣。' : '遠古印記的光短暫驅散了陰影。',
      },
    });
  }
  // 固定場景效果(§5.5 神話標記無視法術防禦;情境標記依 stage 配置碼)
  if (side.sceneEffectFires) {
    const here = inv.currentLocationId ?? '';
    const tokenType = draw.finalToken.type;
    const markerEffect = ctx.chaosMarkerEffects?.[tokenType];
    if (tokenType === 'clue') {
      sc = { ...sc, objectiveProgress: sc.objectiveProgress + 1, tokens: [...sc.tokens, { tokenType: 'clue', locationId: here, amount: 1 }] };
      effects.push({ type: 'gain_clue', params: { amount: 1 } });
    } else if (tokenType === 'doom') {
      sc = { ...sc, agendaProgress: sc.agendaProgress + 1 };
      effects.push({ type: 'doom_added', params: { amount: 1, total: sc.agendaProgress } });
    } else if (tokenType === 'monster' || markerEffect === 'follower_response') {
      const code = Object.entries(ctx.enemyStats ?? {}).find(([, d]) => Number(d.tier ?? 1) === 1)?.[0];
      if (code) {
        const spawned = spawnEnemy(sc, code, here, ctx.enemyStats ?? {}, 1);
        sc = spawned.scenario;
        effects.push({ type: 'enemy_spawned', params: { enemy: ctx.enemyStats?.[code]?.name_zh ?? code, code, location: here }, targetId: spawned.enemy.instanceId });
      }
    } else if (tokenType === 'headline') {
      effects.push({ type: 'headline_drawn', params: { narrative: '雨夜的報童叫賣著不該存在的頭條……(遭遇系統接通後結算)' } });
    } else if (markerEffect === 'forbidden_knowledge') {
      inv = { ...inv, san: Math.max(0, inv.san - 2) };
      effects.push({ type: 'fear_damage', params: { amount: 2, narrative: '你讀懂了不該讀懂的東西。' }, targetId: inv.investigatorId });
    } else if (markerEffect === 'otherworld_infiltration') {
      sc = { ...sc, tokens: [...sc.tokens, { tokenType: 'haunting', locationId: here, amount: 1 }] };
      effects.push({ type: 'status_applied', params: { status: 'haunting', narrative: '異界的薄膜滲進了這個地點。' } });
    } else {
      effects.push({
        type: 'chaos_scene_effect',
        params: { code: markerEffect ?? tokenType, narrative: '場景效果(' + (markerEffect ?? tokenType) + ')待對應系統接通。' },
      });
    }
  }
  return { investigator: inv, scenario: sc, effects };
}

/**
 * 投入檢定的卡片 on_success 效果(ch3 §3.2 技能卡附贈):
 * 檢定成功後,結算所有被 commit 卡片的 on_success 觸發效果(如:成功後抽 1 張)。
 */
function applyOnSuccessCommit(
  success: boolean,
  committedIds: string[],
  investigator: InvestigatorState,
  scenario: ScenarioState,
  cardLookup: CardDataLookup,
): { investigator: InvestigatorState; scenario: ScenarioState; effects: ResultEffect[] } {
  if (!success || committedIds.length === 0) {
    return { investigator, scenario, effects: [] };
  }
  let inv = investigator;
  let sc = scenario;
  const effects: ResultEffect[] = [];
  for (const id of committedIds) {
    const onSuccess = (cardLookup[id]?.effects ?? []).filter((f) => f.trigger_type === 'on_success');
    if (onSuccess.length === 0) continue;
    const exec = executeCardEffects(onSuccess, inv, sc, cardLookup);
    inv = exec.investigator;
    sc = exec.scenario;
    effects.push(...exec.effects);
  }
  return { investigator: inv, scenario: sc, effects };
}

/** §7.8 隱藏資訊:敵人血量轉敘事性狀態(簡化:依絕對 hp 不依百分比)*/
function hpToNarrative(newHp: number, prevHp: number): string {
  if (newHp <= 0) return '牠倒下了';
  if (newHp <= 1) return '牠瀕臨倒下,呼吸像是漏氣的風箱';
  if (newHp <= 2) return '牠拖著斷裂的肢體,動作明顯遲緩';
  if (prevHp >= 5 && newHp < 5) return '牠的動作慢了下來,有幾道傷口';
  return '牠看起來幾乎毫髮無傷';
}

// ─── 輔助:接受 / 駁回 構造 ResultMessage ──
function accept(
  intent: IntentMessage,
  effects: ResultEffect[],
  newState: RuleResolveOutput['newState']
): RuleResolveOutput {
  return {
    result: {
      kind: 'result',
      source: 'engine',
      inResponseTo: intent.id,
      outcome: 'accepted',
      effects,
    },
    newState,
  };
}

function reject(intent: IntentMessage, narrative: string, suggestion?: string): RuleResolveOutput {
  return {
    result: {
      kind: 'result',
      source: 'engine',
      inResponseTo: intent.id,
      outcome: 'rejected',
      rejection: { narrative, suggestion },
    },
  };
}

// ─── 簡易工廠:套訊息匯流排用 ──────────
/**
 * 把 ResolveOutput 的 result 轉成可丟給 messageBus.publish 的 PartialMessage
 * (補上 schemaVersion / id / timestamp 由 bus 自動補)
 */
export function buildResultMessage(output: RuleResolveOutput): Omit<ResultMessage, 'id' | 'timestamp' | 'schemaVersion'> {
  return output.result;
}

// 確保 LocationInstance 在型別表面被引用(供 IDE 跳轉)
export type { LocationInstance };
