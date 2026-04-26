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
    case 'investigate':
      return resolveInvestigate(intent, ctx);
    case 'attack':
      return resolveAttack(intent, ctx);
    // 以下 stub,等後續里程碑展開
    case 'play_card':
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
  // 解鎖檢查(教學關卡用)
  if (ctx.scenario.unlockedLocations.length > 0 && !ctx.scenario.unlockedLocations.includes(targetId)) {
    return reject(intent, '「' + targetId + '」這條路還沒打開', '完成當前地點的目標即可解鎖');
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

/**
 * 調查 — §6.1 / §13(線索系統)
 * G1 階段簡化:扣 1 行動點,擲 d20 + 感知,DC 10 → 成功則找到 1 線索
 * 完整版需含隱藏調查點、感知檢定、難度由地點定義(後續展開)
 */
function resolveInvestigate(intent: IntentMessage, ctx: RuleContext): RuleResolveOutput {
  if (ctx.investigator.actionPoints < 1) {
    return reject(intent, '行動點不足:調查需 1,剩 ' + ctx.investigator.actionPoints);
  }
  const perception = ctx.investigator.attributes.perception;
  const roll = rollD20();
  const total = roll + perception;
  const dc = 10;
  const success = total >= dc;
  const newInv: InvestigatorState = { ...ctx.investigator, actionPoints: ctx.investigator.actionPoints - 1 };
  const baseEffects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    { type: 'roll_d20', params: { roll, attribute: 'perception', modifier: perception, total, dc, outcome: success ? 'success' : 'fail' } },
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
  return accept(
    intent,
    [
      ...baseEffects,
      { type: 'investigate_success', params: { narrative: '你在塵埃裡發現了一張被遺忘的紙條。', clueAmount: 1 }, targetId: ctx.investigator.currentLocationId || undefined },
      { type: 'gain_clue', params: { amount: 1 } },
    ],
    { investigator: newInv, scenario: newScenario }
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

function performAttack(intent: IntentMessage, ctx: RuleContext, enemyInstanceId: string): RuleResolveOutput {
  const enemy = ctx.scenario.enemies.find((e) => e.instanceId === enemyInstanceId);
  if (!enemy || enemy.hp <= 0) {
    return reject(intent, '目標已倒下或不存在');
  }
  if (enemy.locationId !== ctx.investigator.currentLocationId) {
    return reject(intent, '目標不在你所在地點');
  }
  const strength = ctx.investigator.attributes.strength;
  const roll = rollD20();
  const total = roll + strength;
  const dc = 10;
  const newInv: InvestigatorState = { ...ctx.investigator, actionPoints: ctx.investigator.actionPoints - 1 };
  const baseEffects: ResultEffect[] = [
    { type: 'spend_action_point', params: { amount: 1 } },
    { type: 'roll_d20', params: { roll, attribute: 'strength', modifier: strength, total, dc, outcome: total >= dc ? 'hit' : 'miss' }, targetId: enemyInstanceId },
  ];
  if (total < dc) {
    return accept(intent, [...baseEffects, { type: 'attack_miss', params: { narrative: '你的攻擊擦身而過,牠仍站在那裡。' }, targetId: enemyInstanceId }], { investigator: newInv });
  }
  // 命中:1 點傷害(簡化版)
  const newHp = enemy.hp - 1;
  const newScenario: ScenarioState = {
    ...ctx.scenario,
    enemies: ctx.scenario.enemies.map((e) => (e.instanceId === enemyInstanceId ? { ...e, hp: newHp } : e)),
  };
  const effects: ResultEffect[] = [
    ...baseEffects,
    { type: 'attack_hit', params: { damage: 1, narrative: hpToNarrative(newHp, enemy.hp) }, targetId: enemyInstanceId },
  ];
  if (newHp <= 0) {
    effects.push({ type: 'enemy_defeated', params: { narrative: '牠倒下了,空氣裡只剩下血腥與沉默。' }, targetId: enemyInstanceId });
  }
  return accept(intent, effects, { investigator: newInv, scenario: newScenario });
}

function rollD20(): number {
  return 1 + Math.floor(Math.random() * 20);
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
