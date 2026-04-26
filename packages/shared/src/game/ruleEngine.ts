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

// ─── 引擎輸入:當前狀態切片 ──────────────
export interface RuleContext {
  scenario: ScenarioState;
  /** 操作該意圖的調查員 */
  investigator: InvestigatorState;
  /** 當前回合層 */
  turn: TurnState;
  /** 全部調查員(供多人查詢) */
  investigators: Record<string, InvestigatorState>;
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
  };
}

// ─── 主入口 ─────────────────────────
export function resolveIntent(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  // 防護:已永久死亡的調查員不可動
  if (ctx.investigator.permanentlyDead) {
    return reject(intent, '[角色名] 的旅程已經結束。他們的紀念照仍在大廳牆上。');
  }

  // 階段檢查:只有調查員階段可執行主動行動(§4.2)
  if (ctx.turn.phase !== 'investigator') {
    return reject(intent, '不在調查員階段,當前階段:' + ctx.turn.phase, '等待進入調查員階段後再行動');
  }

  switch (intent.actionType) {
    case 'gain_resource':
      return resolveGainResource(intent, ctx);
    case 'draw_card':
      return resolveDrawCard(intent, ctx);
    case 'move':
      return resolveMove(intent, ctx);
    // 以下 stub,等後續里程碑展開
    case 'play_card':
    case 'attack':
    case 'investigate':
    case 'taunt':
    case 'evade':
    case 'execute_card_action':
    case 'consume':
    case 'commit_attribute_icon':
    case 'short_rest':
    case 'declare_intent':
      return reject(intent, '此行動的引擎結算尚未實作(G1 階段 stub)');
    default:
      return reject(intent, '未知的動作類型:' + (intent as { actionType: string }).actionType);
  }
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
  const cost = target.isObstacle ? 2 : 1;
  if (ctx.investigator.actionPoints < cost) {
    return reject(intent, '行動點不足:移動到「' + targetId + '」需 ' + cost + ',剩 ' + ctx.investigator.actionPoints);
  }
  // §7.2 交戰中執行非攻擊/閃避會觸發藉機攻擊 — G1 階段先 stub
  if (ctx.investigator.engagedWith.length > 0) {
    // 仍允許移動但提醒(完整藉機攻擊邏輯待 attack 結算實作)
    return accept(
      intent,
      [
        { type: 'spend_action_point', params: { amount: cost } },
        { type: 'move', params: { from: ctx.investigator.currentLocationId, to: targetId } },
        { type: 'attack_of_opportunity_warning', params: { engagedWith: ctx.investigator.engagedWith } },
      ],
      {
        investigator: {
          ...ctx.investigator,
          actionPoints: ctx.investigator.actionPoints - cost,
          currentLocationId: targetId,
        },
      }
    );
  }
  return accept(
    intent,
    [
      { type: 'spend_action_point', params: { amount: cost } },
      { type: 'move', params: { from: ctx.investigator.currentLocationId, to: targetId } },
    ],
    {
      investigator: {
        ...ctx.investigator,
        actionPoints: ctx.investigator.actionPoints - cost,
        currentLocationId: targetId,
      },
    }
  );
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
