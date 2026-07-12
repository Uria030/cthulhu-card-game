import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react';
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
  selectKeeperLegendaryEncounter,
  executeMythosCard,
  runAttachmentUpkeep,
  isCardExecutable,
  mythosCooldownRemaining,
  mythosMaxUses,
  mythosUseCount,
  mythosUsesRemaining,
  isMythosUsedUp,
  initInvestigatorAIState,
  runInvestigatorAITurn,
  deriveObjective,
  commandTick,
  assignRoles,
  objectiveForAssignment,
  cumulativeDoom,
  runTurnEndUpkeep,
  runTurnStartUpkeep,
  runShortRest,
  syncDownedState,
  runDeathSave,
  isDowned,
  isStanding,
  allInvestigatorsDead,
  drawAndAutoResolveEncounter,
  drawTriggeredEncounter,
  ENCOUNTER_DECK_RESHUFFLED_NARRATIVE,
  resolveEncounterOption,
  resolveEncounterWithTalisman,
  availableTalismansForEncounter,
  scenarioRewardFromOutcome,
  settleScenarioEnd,
  applyLongRest,
  preparationCardXpCost,
  canPurchasePreparationCard,
  purchasePreparationCard,
  canUnlockTalentNode,
  unlockTalentNode,
  canAdoptTeamSpirit,
  canInvestTeamSpirit,
  adoptTeamSpirit,
  investTeamSpirit,
  CURRENT_MESSAGE_SCHEMA_VERSION,
  sharedActionsForCurrentAct,
  sharedActionLimit,
  sharedActionUseCount,
  commitValueFor,
  cardMaxUses,
  discardForHandLimit,
  HAND_LIMIT,
} from '@cthulhu/shared';
import type {
  OutcomeData,
  ScenarioState,
  InvestigatorState,
  KeeperState,
  InvestigatorAIState,
  CampaignProgress,
  ScenarioReward,
  PreparationCardDefinition,
  TalentNodeDefinition,
  TeamSpiritDefinition,
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
  EncounterCardData,
  EncounterOption,
  EncounterTriggerContext,
  AttributeKey,
  CardData,
} from '@cthulhu/shared';
import { applyDamageAllocation, autoAllocateDamage } from '@cthulhu/shared';
import type { AllocatableTarget } from '@cthulhu/shared';
import {
  fetchBootstrap,
  fetchCardLabCatalogue,
  fetchCardLabManifest,
  fetchPlayerMe,
  getPlayerToken,
  markPlayerSaveDead,
  settlePlayerSaveScenario,
  updatePlayerSaveProgress,
} from '../api';
import { getSelectedInvestigator } from '../game/selectedInvestigator';
import { getPartyTemplateIds } from '../game/selectedParty';
import { buildSetupFromBootstrap } from '../game/gameSetup';
import type { GameSetup, LocationDisplay, CardDisplay } from '../game/gameSetup';
import {
  buildCardLabSetup,
  CARD_LAB_DUMMY_INSTANCE_ID,
  CARD_LAB_STAGE_ID,
  returnCardToLabHand,
} from '../game/cardLab';
import { latestActionRows } from '../game/battleLogPreview';
import { autoEncounterTransition, encounterAutoDelay } from '../game/encounterModalFlow';
import { uniqueLocationConnections } from '../game/mapConnections';
import { pawnAssetForInvestigator, playerToneForSlot } from '../game/investigatorVisuals';
import { feedbackTargetsLocation } from '../game/locationActionFeedback';
import { getSelectedSave } from '../game/selectedSave';
import { CardLabWorkbench } from './CardLabWorkbench';
import {
  ensureCampaignProgressForSetup,
  loadStoredCampaignProgressFromBootstrap,
  saveStoredCampaignProgressFor,
  saveStoredCampaignProgressFromBootstrap,
} from '../game/campaignProgressStorage';
import './TestScenarioScreen.css';

type LocationArtKind = 'lab-entrance' | 'card-lab' | 'library' | 'docks' | 'downtown' | 'alley' | 'brick-wall' | 'haunt';
type InterfaceScale = 85 | 100 | 115 | 130;

const INTERFACE_SCALES: InterfaceScale[] = [85, 100, 115, 130];
const INTERFACE_SCALE_KEY = 'ug_interface_scale';

function readInterfaceScale(): InterfaceScale {
  if (typeof window === 'undefined') return 100;
  const stored = Number(window.localStorage.getItem(INTERFACE_SCALE_KEY));
  return INTERFACE_SCALES.includes(stored as InterfaceScale) ? stored as InterfaceScale : 100;
}

export function locationArtKind(locationId: string, name?: string): LocationArtKind {
  const key = `${locationId} ${name ?? ''}`.toLowerCase();
  if (/card.lab.entrance|實驗場入口/.test(key)) return 'lab-entrance';
  if (/card.lab.workbench|卡片實驗室/.test(key)) return 'card-lab';
  if (/library|miskatonic|圖書館|密斯卡塔尼克/.test(key)) return 'library';
  if (/dock|wharf|harbor|innsmouth|碼頭|港口|印斯茅斯/.test(key)) return 'docks';
  if (/downtown|city.center|市中心|城中/.test(key)) return 'downtown';
  if (/brick|wall|磚|牆/.test(key)) return 'brick-wall';
  if (/haunt|deep.one|深潛|出沒|cellar|地窖/.test(key)) return 'haunt';
  return 'alley';
}

function compactJson(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  return text.length > 700 ? `${text.slice(0, 697)}...` : text;
}

function cardLabDiagnosticLines(input: {
  actionType: IntentMessage['actionType'];
  payload: Record<string, unknown>;
  outcome: ResultMessage['outcome'];
  rejection?: ResultMessage['rejection'];
  effects: ResultEffect[];
  beforeInvestigator: InvestigatorState;
  afterInvestigator: InvestigatorState;
  beforeScenario: ScenarioState;
  afterScenario: ScenarioState;
  setup: GameSetup;
}): string[] {
  const cardId = String(input.payload.cardInstanceId ?? '');
  const card = cardId ? input.setup.cardLookup[cardId] : undefined;
  const lines = [`[LAB][ACTION] ${input.actionType} | payload=${compactJson(input.payload)} | outcome=${input.outcome}`];
  if (card) {
    lines.push(`[LAB][CARD] ${card.name_zh ?? cardId} | 敘述=${String(card.description_zh ?? '(空白)')}`);
    lines.push(`[LAB][DECLARED] ${compactJson(card.effects ?? [])}`);
  }
  if (input.rejection) lines.push(`[LAB][REJECTED] ${compactJson(input.rejection)}`);
  input.effects.forEach((effect, index) => {
    lines.push(`[LAB][EFFECT ${index + 1}/${input.effects.length}] ${effect.type} | params=${compactJson(effect.params)} | target=${effect.targetId ?? '-'}`);
  });
  if (input.effects.length === 0) lines.push('[LAB][EFFECT] 無實際效果');

  const beforeEnemies = Object.fromEntries(input.beforeScenario.enemies.map((enemy) => [enemy.instanceId, enemy.hp]));
  const enemyDiff = input.afterScenario.enemies
    .map((enemy) => `${enemy.instanceId}:${beforeEnemies[enemy.instanceId] ?? 'new'}→${enemy.hp}`)
    .join(',') || 'none';
  lines.push('[LAB][STATE] ' + [
    `AP ${input.beforeInvestigator.actionPoints}→${input.afterInvestigator.actionPoints}`,
    `資源 ${input.beforeInvestigator.resources}→${input.afterInvestigator.resources}`,
    `HP ${input.beforeInvestigator.hp}→${input.afterInvestigator.hp}`,
    `SAN ${input.beforeInvestigator.san}→${input.afterInvestigator.san}`,
    `地點 ${input.beforeInvestigator.currentLocationId ?? '-'}→${input.afterInvestigator.currentLocationId ?? '-'}`,
    `線索 ${input.beforeScenario.objectiveProgress}→${input.afterScenario.objectiveProgress}`,
    `敵人HP ${enemyDiff}`,
  ].join(' | '));
  return lines;
}

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
    case 'spend_resource': return '🪙 花費 ' + (p.amount as number) + ' 資源';
    case 'heal_hp': return '💚 ' + ((p.narrative as string) || '回復體力') + '(HP +' + (p.amount as number) + ')';
    case 'heal_san': return '💙 ' + ((p.narrative as string) || '回復理智') + '(SAN +' + (p.amount as number) + ')';
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
    case 'shared_action_used': return '📜 ' + (p.name as string) + ':棄 ' + (p.amount as number) + ' 線索,造成 ' + (p.damage as number) + ' 傷害。' + (p.narrative ? ' ' + (p.narrative as string) : '');
    case 'clues_spent': return '棄掉 ' + (p.amount as number) + ' 線索' + (p.source ? '(' + (p.source as string) + ')' : '');
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
    case 'reveal_top': return '👁 看牌庫頂 ' + (p.count as number) + ' 張';
    case 'discard_card': return '🗑 棄 ' + (p.amount as number) + ' 張手牌';
    case 'retrieve_card': return '♻ 從棄牌堆回收 ' + (p.amount as number) + ' 張回手';
    case 'return_to_deck': return '↩ ' + (p.amount as number) + ' 張手牌放回牌庫頂';
    case 'remove_from_game': return '✖ 放逐 ' + (p.amount as number) + ' 張(' + (p.from === 'hand' ? '手牌' : '棄牌堆') + ')';
    case 'shuffle_deck': return '🔀 洗牌庫(' + (p.size as number) + ' 張)';
    case 'exhaust_card': return '↪ 橫置一張資產';
    case 'ready_card': return '↺ 轉正一張資產';
    case 'gain_use': return '🔋 資產補充 ' + (p.amount as number) + ' 次使用';
    case 'steal_resource': return '🪙 ' + ((p.narrative as string) || '奪取資源') + '(+' + (p.amount as number) + ')';
    case 'move_enemy': return '➡ 將敵人推到 ' + (locMeta[p.to as string]?.name || p.to);
    case 'engage_enemy': return '⚔ 主動纏上敵人';
    case 'disengage_enemy': return '🏃 脫離 ' + (p.count as number) + ' 個交戰';
    case 'enemy_removed': return '✖ ' + (p.narrative as string);
    case 'place_clue': return '🔎 在 ' + (locMeta[p.location as string]?.name || p.location) + ' 放下 ' + (p.amount as number) + ' 個線索';
    case 'remove_doom': return '🌟 移除 ' + (p.amount as number) + ' 個毀滅標記(剩 ' + (p.total as number) + ')';
    case 'add_keyword': return '🏷 敵人獲得詞綴「' + (p.keyword as string) + '」';
    case 'remove_keyword': return '🏷 移除敵人詞綴「' + (p.keyword as string) + '」';
    case 'place_haunting': return '👻 鬧鬼附著在 ' + (locMeta[p.location as string]?.name || p.location);
    case 'remove_haunting': return '✨ 驅散了 ' + (locMeta[p.location as string]?.name || p.location) + ' 的鬧鬼';
    case 'connect_tiles': return '🔗 打通 ' + (locMeta[p.from as string]?.name || p.from) + ' ↔ ' + (locMeta[p.to as string]?.name || p.to);
    case 'disconnect_tiles': return '⛓ 切斷 ' + (locMeta[p.from as string]?.name || p.from) + ' ✕ ' + (locMeta[p.to as string]?.name || p.to);
    case 'effect_unsupported': return 'ℹ 部分卡面效果引擎尚未支援:' + ((p.codes as string[]) ?? []).join('、');
    case 'fear_check': return '😨 恐懼檢定 vs ' + (p.enemy as string) + ':d20 ' + (p.roll as number) + ' → ' + (p.total as number) + ' vs DC ' + (p.dc as number) + '(' + (p.outcome === 'success' ? '穩住了' : '失敗') + ')';
    case 'fear_damage': return '😱 ' + (p.narrative as string) + '(SAN -' + (p.amount as number) + ')';
    case 'encounter_check': return '遭遇檢定:' + (p.attribute as string) + ' d20=' + (p.roll as number) + ' → ' + (p.total as number) + ' vs DC ' + (p.dc as number) + '(' + (p.outcome === 'success' ? '成功' : '失敗') + ')';
    case 'encounter_drawn': return '抽到遭遇「' + (p.name as string) + '」';
    case 'encounter_deck_reshuffled': return String(p.narrative ?? ENCOUNTER_DECK_RESHUFFLED_NARRATIVE);
    case 'encounter_no_options': return '遭遇「' + (p.name as string) + '」尚無可結算選項';
    case 'encounter_narrative': return String(p.narrative ?? '');
    case 'encounter_damage': return '遭遇傷害:' + ((p.narrative as string) || '') + '(HP -' + (p.amount as number) + ')';
    case 'talisman_toll_paid': return '法器「' + (p.name as string) + '」支付 ' + (p.cost as number) + ' ' + (p.resource as string) + '(剩 ' + (p.left as number) + ')';
    case 'talisman_check': return '法器檢定:' + (p.attribute as string) + ' d20=' + (p.roll as number) + ' → ' + (p.total as number) + ' vs DC ' + (p.dc as number) + '(' + (p.outcome === 'success' ? '成功' : '失敗') + ')';
    case 'talisman_break_success': return '法器「' + (p.name as string) + '」破除「' + (p.encounter as string) + '」';
    case 'talisman_break_failed': return '法器「' + (p.name as string) + '」破除失敗,遭遇照常觸發';
    case 'talisman_unavailable': return '法器不可用:' + String(p.reason ?? '');
    case 'monster_attack': return '👹 ' + (p.enemy as string) + ' 使出【' + (p.move as string) + '】— 你的' + (p.defenseAttribute as string) + '防禦:' + (p.total as number) + ' vs DC ' + (p.dc as number);
    case 'monster_attack_hit': return '💥 ' + (p.narrative as string) + '(HP -' + (p.physical as number) + (Number(p.horror) > 0 ? ' / SAN -' + (p.horror as number) : '') + ')';
    case 'monster_attack_missed': return '💨 ' + (p.narrative as string);
    case 'monster_move': return '👣 ' + (p.enemy as string) + ' 朝你逼近';
    case 'monster_engage': return '⚠ ' + (p.enemy as string) + ':' + (p.narrative as string);
    case 'attack_of_opportunity': return '🩸 藉機攻擊!' + (p.narrative as string) + '(HP -' + (p.physical as number) + ' / SAN -' + (p.horror as number) + ')';
    case 'taunt': return '🗯 ' + (p.narrative as string);
    case 'engagement_broken': return '🏃 ' + (p.narrative as string);
    case 'monster_dazed': return '💫 ' + (p.enemy as string) + ':' + (p.narrative as string);
    case 'monster_stunned': return '💫 ' + (p.enemy as string) + ':' + (p.narrative as string);
    case 'enemy_stunned': return '💫 ' + (p.narrative as string);
    case 'evade': return '🌀 ' + (p.narrative as string);
    case 'extra_attack': return '⚡ ' + (p.narrative as string) + '(行動點 +' + (p.amount as number) + ')';
    case 'counterattack_armed': return '🛡 ' + (p.narrative as string) + '(反擊 ' + (p.amount as number) + ')';
    case 'counterattack': return '↩ 反擊!' + (p.narrative as string) + '(對' + (p.enemy as string) + ' ' + (p.damage as number) + ' 點)';
    case 'transfer_damage': return '🤝 ' + (p.narrative as string) + '(替 ' + (p.ally as string) + ' 扛下 ' + (p.amount as number) + ' 傷)';
    case 'transfer_horror': return '🤝 ' + (p.narrative as string) + '(替 ' + (p.ally as string) + ' 分擔 ' + (p.amount as number) + ' 恐懼)';
    case 'doom_added': return '☄ 毀滅標記 +' + (p.amount as number) + '(累計 ' + (p.total as number) + ')' + (p.source ? ' — ' + (p.source as string) + ' 的存在加速著終局' : '');
    case 'keeper_card_activated': return '🃏 城主啟用【' + (p.name as string) + '】(' + (p.cost as number) + ' 點)— ' + (p.narrative as string);
    case 'keeper_legendary_dispatch': return '🃏 城主傳奇【' + (p.name as string) + '】指定 ' + String(p.targetId ?? '一位調查員') + '(費用 ' + (p.cost as number) + ')';
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
interface PendingEncounterTrigger {
  sourceLabel: string;
  context: EncounterTriggerContext;
  targetInvestigatorId?: string | null;
}
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
  /** 原始 effects:演出「完成」拍時才一次進 Log(方向 A 單一來源 + 與演出同步,不即時暴雷)*/
  effects: ResultEffect[];
  /** 後續行(倒地同步 + 進度/場景/結局敘事):同樣延到「完成」拍進 Log,排在主效果之後(不先於演出暴雷)*/
  cascadeLogs: string[];
  /** 進度檢查若判定結局:延到「完成」拍才覆蓋結算畫面(否則結局畫面會蓋掉沒播完的演出)*/
  pendingOutcome: OutcomeData | null;
  /** Accepted action can draw an encounter after this action modal closes. */
  pendingEncounter: PendingEncounterTrigger | null;
}

type EncounterBeat = 1 | 2 | 3;
interface EncounterPlay {
  beat: EncounterBeat;
  card: EncounterCardData;
  sourceLabel: string;
  resultLines: string[];
  effects: ResultEffect[];
  pendingDamageAlloc: PendingDamageAlloc | null;
  cascadeLogs: string[];
  pendingOutcome: OutcomeData | null;
}

interface PendingCommitWindow {
  actionType: IntentMessage['actionType'];
  payload: Record<string, unknown>;
  attribute: AttributeKey | null;
  dc: number | null;
  selectedIds: string[];
  candidates: Array<{ id: string; name: string; value: number; icons: string }>;
}

interface PendingAIStep { lines: string[]; }

type RoundTransitionStep = null | 'supply' | 'discard' | 'ready' | 'new_round';

interface HandLimitSelection {
  required: number;
  selectedIds: string[];
}

type TurnOpeningChoice = 'pending' | 'actions' | 'rested';
type PilePanel = null | 'discard' | 'removed' | 'extra';

interface ActionFeedback {
  key: string;
  label: string;
  status: 'processing' | 'rejected';
  targetLocationId?: string;
}

interface ScreenToast {
  id: number;
  text: string;
  tone: 'normal' | 'warning';
}

// Phase2 B:AI 隊友計時器同時行動 — AI 起動與單一 action Log 的節奏分開控制。
const AI_ACTION_INTERVAL_MS = 1100;

// 檢定拍效果型別(擲骰/檢定);其餘效果歸結果拍
const CHECK_EFFECT_TYPES = new Set(['roll_d20', 'fear_check', 'death_save', 'talisman_check']);
// 純記帳動作不跳演出 Modal(取資源/抽卡:頻繁且無重量,跳 Modal 反而擾民)
const ACTION_PLAY_SKIP = new Set(['gain_resource', 'draw_card']);
const ACTION_PLAY_TITLE: Record<string, string> = {
  investigate: '🔎 調查', search: '🔍 搜尋', investigate_hidden: '👁 探查隱密',
  attack: '⚔ 攻擊', execute_card_action: '🃏 卡牌行動', ally_attack: '🤝 盟友攻擊',
  evade: '🌀 閃避', move: '👣 移動', taunt: '🗯 嘲諷', stabilize: '🤲 穩定隊友',
  use_shared_action: '📜 揭穿傳說', gain_resource: '拿資源', draw_card: '抽卡',
};

function monsterPieceAsset(enemyDefinitionId: string, tier = 1): string {
  if (enemyDefinitionId === 'card_lab_training_dummy') return '/game-art/monsters/training-dummy.png';
  if (tier >= 3 || /boss|slit|裂嘴|kuchisake/i.test(enemyDefinitionId)) {
    return '/game-art/monsters/monster-boss.png';
  }
  return '/game-art/monsters/monster-common.png';
}

const ATTRIBUTE_LABEL: Record<AttributeKey, string> = {
  strength: '力量',
  agility: '敏捷',
  constitution: '體魄',
  reflex: '反應',
  intellect: '智識',
  willpower: '意志',
  perception: '感知',
  charisma: '魅力',
};
const COMMIT_ATTRIBUTES: AttributeKey[] = [
  'strength',
  'agility',
  'constitution',
  'reflex',
  'intellect',
  'willpower',
  'perception',
  'charisma',
];

const CHECK_ACTION_ATTRIBUTE: Partial<Record<IntentMessage['actionType'], AttributeKey>> = {
  investigate: 'perception',
  search: 'perception',
  investigate_hidden: 'perception',
  attack: 'strength',
  evade: 'reflex',
};

/** 動作敘述拍的情境文字(結構占位,非最終 flavor;待資料/Gemini 帶入)*/
function actionNarration(actionType: string, locName: string): string {
  switch (actionType) {
    case 'investigate': return `你壓低身子,在【${locName}】仔細搜尋,留意每一處不對勁的細節……`;
    case 'search': return `你翻找【${locName}】的角落,看看有沒有能用上的東西……`;
    case 'investigate_hidden': return `你盯住那處先前察覺的異樣,湊近細看……`;
    case 'attack': return `你穩住呼吸,向眼前的威脅出手……`;
    case 'execute_card_action': return `你催動手中卡牌的力量……`;
    case 'use_shared_action': return `你把散落的線索一段段拼回去,讓傳說露出真正的輪廓……`;
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
  cascadeLogs: string[],
  pendingOutcome: OutcomeData | null,
  pendingEncounter: PendingEncounterTrigger | null,
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
    effects,
    cascadeLogs,
    pendingOutcome,
    pendingEncounter,
  };
}

const PHASE_LABEL: Record<TurnPhase, string> = {
  investigator: '調查員階段',
  mythos: '敵人階段',
  turn_end: '回合結束',
};

const PHASE_ORDER: TurnPhase[] = ['investigator', 'mythos', 'turn_end'];

const CARD_TYPE_LABEL: Record<string, string> = {
  asset: '資產',
  event: '事件',
  ally: '盟友',
  skill: '技能',
  weakness: '弱點',
};

type ModalType = null | 'keeper' | 'act' | 'team';
type PanelType = null | 'hand' | 'bag';

function purchaseBlockLabel(reason?: string): string {
  switch (reason) {
    case 'source_not_purchaseable': return '來源限制';
    case 'special_card_not_purchaseable': return '特殊卡';
    case 'unique_already_owned': return '獨特已擁有';
    case 'talent_level_locked': return '天賦等級不足';
    case 'talent_branch_locked': return '分支未解鎖';
    case 'not_enough_xp': return 'XP 不足';
    case 'investigator_not_registered': return '未建檔';
    default: return '不可購買';
  }
}

function talentUnlockBlockLabel(reason?: string): string {
  switch (reason) {
    case 'already_unlocked': return '已解鎖';
    case 'not_enough_talent_points': return '天賦點不足';
    case 'missing_prerequisite':
    case 'missing_previous_level': return '前置未滿';
    case 'talent_branch_locked': return '分支已鎖';
    case 'talent_branch_required': return '先選分支';
    case 'missing_talent_tree': return '無資料';
    case 'missing_talent_node': return '無節點';
    default: return '不可解鎖';
  }
}

function teamSpiritBlockLabel(reason?: string): string {
  switch (reason) {
    case 'missing_team_spirit': return '無資料';
    case 'already_adopted': return '已採用';
    case 'team_spirit_limit': return '已達上限';
    case 'team_spirit_not_adopted': return '先採用';
    case 'team_spirit_maxed': return '已滿';
    case 'not_enough_cohesion': return '凝聚力不足';
    default: return '不可投入';
  }
}

/**
 * 載入殼:/scenario/test 走教學寫死 setup;
 * /scenario/:stageId(UUID)打 /api/play bootstrap → buildSetupFromBootstrap。
 */
export function TestScenarioScreen() {
  const navigate = useNavigate();
  const { stageId = 'test' } = useParams();
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (stageId === 'test') {
      setSetup(null);
      setLoadError('此關卡已下架;請從世界地圖選擇「雨夜的真相」。');
      return;
    }
    let cancelled = false;
    setSetup(null);
    setLoadError(null);
    const selectedInvestigator = getSelectedInvestigator();
    if (!selectedInvestigator) {
      navigate('/lobby', { replace: true });
      return;
    }
    const playerTemplateId = selectedInvestigator?.id;
    if (stageId === CARD_LAB_STAGE_ID) {
      if (!getPlayerToken()) {
        setLoadError('請先使用 Creator 帳號登入，再從調查室進入卡片檢驗所。');
        return;
      }
      Promise.all([fetchCardLabManifest(), fetchCardLabCatalogue()])
        .then(async ([manifest, catalogue]) => {
          const bootstrap = await fetchBootstrap(manifest.baseStageId, playerTemplateId, {
            crossTest: selectedInvestigator?.is_completed === false,
          });
          if (!cancelled) setSetup(buildCardLabSetup(buildSetupFromBootstrap(bootstrap), manifest, catalogue));
        })
        .catch((e: unknown) => {
          if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
        });
      return () => { cancelled = true; };
    }
    // AI 隊友:讀大廳組隊名單(rosterCode);未設則預設名冊前 3 位不與玩家撞模板
    const partyTemplateIds = (getPartyTemplateIds() ?? [])
      .filter((id) => id !== playerTemplateId)
      .slice(0, 3);
    type Boot = Awaited<ReturnType<typeof fetchBootstrap>>;
    Promise.all([
      fetchBootstrap(stageId, playerTemplateId, { crossTest: selectedInvestigator?.is_completed === false }),
      Promise.all(partyTemplateIds.map((id) => fetchBootstrap(stageId, id, { crossTest: true }).catch(() => null))),
    ])
      .then(async ([bootstrap, aiBoots]) => {
        let progress = loadStoredCampaignProgressFromBootstrap(bootstrap);
        const selectedSaveId = getSelectedSave()?.id;
        if (selectedSaveId && getPlayerToken()) {
          try {
            const me = await fetchPlayerMe();
            const save = me.saves.find((s) => s.id === selectedSaveId && s.status === 'active');
            const serverProgress = save?.campaign_progress as CampaignProgress | undefined;
            if (save && serverProgress?.campaignId) {
              saveStoredCampaignProgressFor(serverProgress.campaignId, save.template_id, serverProgress);
              progress = serverProgress;
            }
          } catch {
            // Local fallback keeps the single-player board usable if the save API is unreachable.
          }
        }
        if (!cancelled) {
          setSetup(buildSetupFromBootstrap(
            bootstrap,
            aiBoots.filter((b): b is Boot => b != null),
            progress,
          ));
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [stageId, navigate]);

  if (loadError) {
    return (
      <div className="bg-root">
        <div className="board-loading">
          <p>關卡資料載入失敗</p>
          <p className="board-loading-detail">{loadError}</p>
          <div className="board-loading-actions">
            <button onClick={() => navigate('/departure')}>返回世界地圖</button>
            <button onClick={() => navigate('/lobby')}>返回大廳</button>
          </div>
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

/** Uria 六項檢查數據(關卡結束在結算畫面顯示;定義同 headless 模擬 sim-slit-3ai,數字一致):
 *  線索 / 造成傷害 / 賺取資源(不含起始 5)/ 抽卡(不含起手)= 行動效果累計;
 *  承受傷害 / 承受恐懼 = 每回合邊界 HP/SAN 淨損。*/
type SixMetric = { clues: number; damage: number; resources: number; draws: number; hp: number; san: number };
const makeSixMetric = (): SixMetric => ({ clues: 0, damage: 0, resources: 0, draws: 0, hp: 0, san: 0 });
type CampaignSettlement = { reward: ScenarioReward; effects: ResultEffect[]; progress: CampaignProgress };

function BattleBoard({ setup }: { setup: GameSetup }) {
  const navigate = useNavigate();
  const locMeta = setup.locMeta;
  const cardMeta = setup.cardMeta;
  const isCardLab = setup.stageId === CARD_LAB_STAGE_ID;

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
  const [turnOpeningChoice, setTurnOpeningChoice] = useState<TurnOpeningChoice>(
    () => (setup.tutorial || isCardLab ? 'actions' : 'pending'),
  );
  // 本回合玩家是否已選短休息(放棄行動;每回合開頭重置)
  const [playerShortRested, setPlayerShortRested] = useState(false);
  const [turnEndEncounterCheckpoint, setTurnEndEncounterCheckpoint] = useState<'pending' | 'player_done' | 'done'>('pending');
  const [enemyResolutionComplete, setEnemyResolutionComplete] = useState(false);
  const [keeperNoticeVisible, setKeeperNoticeVisible] = useState(false);
  const [roundTransition, setRoundTransition] = useState<RoundTransitionStep>(null);
  const [lastUpkeepCardName, setLastUpkeepCardName] = useState<string | null>(null);
  const [handLimitSelection, setHandLimitSelection] = useState<HandLimitSelection | null>(null);
  const [turnNumber, setTurnNumber] = useState(1);
  // 城主運行時狀態(行動點/冷卻/使用次數;教學關卡不用)
  const [keeperState, setKeeperState] = useState<KeeperState>(() => initKeeperState(setup.keeperProfile));
  const [keeperEnergy, setKeeperEnergy] = useState(8); // 教學關卡舊顯示用
  const [log, setLog] = useState<string[]>(setup.introLog);
  // 開局先說清楚目標與危險；實驗場不屬於戰役流程，不阻擋卡片檢驗。
  const [openingBriefing, setOpeningBriefing] = useState(() => !isCardLab);

  // 浮層狀態
  const [modal, setModal] = useState<ModalType>(null);
  // §11 傷害分配 Modal:受傷且場上有可分配卡時跳出讓玩家分配
  const [damageAlloc, setDamageAlloc] = useState<{ physical: number; horror: number; targets: AllocatableTarget[] } | null>(null);
  // Phase2 C:玩家自己動作的三段演出 Modal(敘述→檢定→結果);其他人動作只進 Log
  const [actionPlay, setActionPlay] = useState<ActionPlay | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [screenToast, setScreenToast] = useState<ScreenToast | null>(null);
  const [encounterDeck, setEncounterDeck] = useState<EncounterCardData[]>(() => setup.encounterCards);
  const [encounterPlay, setEncounterPlay] = useState<EncounterPlay | null>(null);
  const [encounterAutoSignal, setEncounterAutoSignal] = useState<{ cardId: string; beat: EncounterBeat } | null>(null);
  // 手牌放大檢視:點手牌卡 → 放大看內容,下方打出/消耗按鈕
  const [zoomCard, setZoomCard] = useState<CardDisplay | null>(null);
  const [panel, setPanel] = useState<PanelType>(null);
  const [pilePanel, setPilePanel] = useState<PilePanel>(null);
  const [commitWindow, setCommitWindow] = useState<PendingCommitWindow | null>(null);
  const [sharedActionAmount, setSharedActionAmount] = useState(1);
  // 戰役旗標(幕翻面/結局寫入)與結算
  const [flags, setFlags] = useState<Record<string, unknown>>({});
  const [outcome, setOutcome] = useState<OutcomeData | null>(null);
  const [campaignProgress, setCampaignProgress] = useState<CampaignProgress>(() => ensureCampaignProgressForSetup(setup));
  const [campaignSettlement, setCampaignSettlement] = useState<CampaignSettlement | null>(null);
  const [preparationOpen, setPreparationOpen] = useState(false);
  const [talentPanelOpen, setTalentPanelOpen] = useState(false);
  const [teamSpiritPanelOpen, setTeamSpiritPanelOpen] = useState(false);
  const [locationBarId, setLocationBarId] = useState<string | null>(null);
  const [logCollapsed, setLogCollapsed] = useState(!isCardLab);
  const [cardLabWorkbenchOpen, setCardLabWorkbenchOpen] = useState(false);
  const [logCopied, setLogCopied] = useState(false);
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const [systemSub, setSystemSub] = useState<null | 'settings' | 'rules'>(null);
  const [interfaceScale, setInterfaceScale] = useState<InterfaceScale>(readInterfaceScale);
  const deathReportedRef = useRef(false);
  const settlementReportedRef = useRef(false);
  const actionFeedbackTimerRef = useRef(0);
  const toastTimerRef = useRef(0);
  const knownEnemyIdsRef = useRef(new Set(setup.scenario.enemies.map((enemy) => enemy.instanceId)));

  // 地圖 pan / zoom
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    window.localStorage.setItem(INTERFACE_SCALE_KEY, String(interfaceScale));
  }, [interfaceScale]);

  const appendLines = useCallback((lines: string[]) => {
    if (lines.length === 0) return;
    setLog((l) => [...l, ...lines].slice(isCardLab ? -300 : -50));
  }, [isCardLab]);
  const append = useCallback((s: string) => appendLines([s]), [appendLines]);
  const queueAISteps = useCallback((steps: PendingAIStep[]) => {
    appendLines(steps.flatMap((step) => step.lines));
  }, [appendLines]);

  const showScreenToast = useCallback((text: string, tone: ScreenToast['tone'] = 'normal', duration = 1_800) => {
    window.clearTimeout(toastTimerRef.current);
    setScreenToast({ id: Date.now(), text, tone });
    toastTimerRef.current = window.setTimeout(() => setScreenToast(null), duration);
  }, []);

  const holdActionFeedback = useCallback((key: string, label: string, targetLocationId?: string, duration = 1_800) => {
    window.clearTimeout(actionFeedbackTimerRef.current);
    setActionFeedback({ key, label, status: 'processing', targetLocationId });
    actionFeedbackTimerRef.current = window.setTimeout(() => setActionFeedback(null), duration);
  }, []);

  const rejectActionFeedback = useCallback((key: string, label: string, targetLocationId?: string) => {
    window.clearTimeout(actionFeedbackTimerRef.current);
    setActionFeedback({ key, label, status: 'rejected', targetLocationId });
    actionFeedbackTimerRef.current = window.setTimeout(() => setActionFeedback(null), 720);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(actionFeedbackTimerRef.current);
    window.clearTimeout(toastTimerRef.current);
  }, []);

  const copyCardLabLog = useCallback(async () => {
    const text = log.join('\n');
    const fallbackCopy = (): boolean => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    };
    let copied = fallbackCopy();
    if (!copied && navigator.clipboard?.writeText) {
      try {
        await Promise.race([
          navigator.clipboard.writeText(text).then(() => true),
          new Promise<false>((resolve) => window.setTimeout(() => resolve(false), 800)),
        ]).then((result) => { copied = result; });
      } catch {
        copied = false;
      }
    }
    if (!copied) return;
    setLogCopied(true);
    window.setTimeout(() => setLogCopied(false), 1_600);
  }, [log]);

  const resetTrainingDummy = useCallback(() => {
    const hp = Number(setup.enemyStats.card_lab_training_dummy?.hp_base ?? 999);
    setScenario((current) => ({
      ...current,
      enemies: [{
        instanceId: CARD_LAB_DUMMY_INSTANCE_ID,
        enemyDefinitionId: 'card_lab_training_dummy',
        locationId: 'card_lab_workbench',
        hp,
        engagedWith: [],
        modifiers: [],
      }],
    }));
    setInvestigator((current) => ({
      ...current,
      engagedWith: current.engagedWith.filter((id) => id !== CARD_LAB_DUMMY_INSTANCE_ID),
    }));
    append(`[LAB][RESET] 訓練木人恢復至 HP ${hp}`);
  }, [append, setup.enemyStats]);

  const resetCardLab = useCallback(() => {
    setInvestigator(setup.investigator);
    setScenario(setup.scenario);
    setAiMembers([]);
    setPhase('investigator');
    setTurnOpeningChoice('actions');
    setTurnNumber(1);
    setOutcome(null);
    setActionPlay(null);
    setActionFeedback(null);
    setScreenToast(null);
    setEncounterPlay(null);
    setEncounterAutoSignal(null);
    setDamageAlloc(null);
    setEnemyResolutionComplete(false);
    setKeeperNoticeVisible(false);
    setRoundTransition(null);
    setHandLimitSelection(null);
    setPanel(null);
    setPilePanel(null);
    setModal(null);
    setCardLabWorkbenchOpen(false);
    setLog([...setup.introLog, '[LAB][RESET] 實驗環境、牌組與訓練木人已還原。']);
  }, [setup]);

  const addCardToLabHand = useCallback((cardId: string) => {
    const card = setup.cardMeta[cardId];
    if (!card) return;
    setInvestigator((current) => returnCardToLabHand(current, cardId));
    append(`[LAB][CATALOGUE] 「${card.name}」已加入手牌。`);
    showScreenToast(`「${card.name}」已加入手牌`);
  }, [append, setup.cardMeta, showScreenToast]);

  useEffect(() => {
    if (setup.sandbox) return;
    saveStoredCampaignProgressFromBootstrap(setup.bootstrap, campaignProgress);
    const selectedSave = getSelectedSave();
    if (!selectedSave || !getPlayerToken()) return;
    if (outcome && settlementReportedRef.current && !preparationOpen) return;
    if (investigator.permanentlyDead && !deathReportedRef.current) {
      deathReportedRef.current = true;
      markPlayerSaveDead(selectedSave.id, campaignProgress).catch(() => {
        deathReportedRef.current = false;
      });
      return;
    }
    updatePlayerSaveProgress(
      selectedSave.id,
      campaignProgress,
      setup.bootstrap?.campaign?.id ?? campaignProgress.campaignId,
    ).catch(() => {});
  }, [setup.bootstrap, setup.sandbox, campaignProgress, investigator.permanentlyDead, outcome, preparationOpen]);

  useEffect(() => {
    if (setup.sandbox) return;
    if (!outcome || campaignSettlement) return;
    const reward = {
      ...scenarioRewardFromOutcome(outcome, scenario.hiddenPoints ?? [], [investigator.investigatorId]),
      stageId: setup.stageId,
    };
    const settled = settleScenarioEnd(
      campaignProgress,
      { [investigator.investigatorId]: investigator },
      reward,
    );
    const rested = applyLongRest(settled.progress);
    const effects = [...settled.effects, ...rested.effects];
    setCampaignProgress(rested.progress);
    setCampaignSettlement({ reward, effects, progress: rested.progress });
    const selectedSave = getSelectedSave();
    if (selectedSave && getPlayerToken() && !settlementReportedRef.current) {
      settlementReportedRef.current = true;
      settlePlayerSaveScenario({
        saveId: selectedSave.id,
        stageId: setup.stageId,
        flags,
        investigator,
      })
        .then((save) => {
          const serverProgress = save.campaign_progress as CampaignProgress | undefined;
          if (serverProgress?.campaignId) {
            saveStoredCampaignProgressFor(serverProgress.campaignId, save.template_id, serverProgress);
            setCampaignProgress(serverProgress);
            setCampaignSettlement((prev) => prev ? { ...prev, progress: serverProgress } : prev);
          }
        })
        .catch(() => {
          settlementReportedRef.current = false;
        });
    }
  }, [outcome, campaignSettlement, campaignProgress, investigator, scenario.hiddenPoints, setup.sandbox]);

  // === Uria 六項檢查數據:累計於 ref,結局時在結算畫面渲染(不觸發 re-render;outcome set 時讀到的即最終值) ===
  const statsRef = useRef<Record<string, SixMetric>>({});
  const prevVitalRef = useRef<Record<string, { hp: number; san: number }>>({});
  if (Object.keys(statsRef.current).length === 0) {
    const seed = (inv: InvestigatorState) => {
      statsRef.current[inv.investigatorId] = makeSixMetric();
      prevVitalRef.current[inv.investigatorId] = { hp: inv.hp, san: inv.san };
    };
    seed(setup.investigator);
    for (const m of setup.aiMembers) seed(m.investigator);
  }
  // 本人行動產生的效果:線索 / 造成傷害 / 賺取資源(不含起始 5)/ 抽卡(不含起手)。承受量不在此(走 checkpointVitals)。
  const tallyActor = (id: string, effects: ResultEffect[]) => {
    const s = statsRef.current[id];
    if (!s) return;
    for (const eff of effects) {
      const p = eff.params as Record<string, unknown>;
      if (eff.type === 'gain_clue') s.clues += Number(p.amount ?? 1);
      else if (eff.type === 'attack_hit') s.damage += Number(p.damage ?? 0);
      else if (eff.type === 'gain_resource' || eff.type === 'upkeep_income') s.resources += Number(p.amount ?? 1);
      else if (eff.type === 'draw_card' || eff.type === 'upkeep_draw') s.draws += 1;
    }
  };
  // 承受傷害 / 恐懼:每回合邊界 HP/SAN 淨損(來源不拘——怪攻 / 恐懼 / 燃燒都算;場內被救回血會略低估,與模擬同口徑)
  const checkpointVitals = (inv: InvestigatorState, aiArr: (InvestigatorState | null)[]) => {
    for (const m of [inv, ...aiArr]) {
      if (!m) continue;
      const s = statsRef.current[m.investigatorId];
      const prev = prevVitalRef.current[m.investigatorId];
      if (!s || !prev) continue;
      s.hp += Math.max(0, prev.hp - m.hp);
      s.san += Math.max(0, prev.san - m.san);
      prev.hp = m.hp;
      prev.san = m.san;
    }
  };

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
  ): { sc: ScenarioState; inv: InvestigatorState; aiArr: InvestigatorState[]; logs: string[]; outcome: OutcomeData | null } => {
    // 回傳「最終 AI 陣列」(場景轉換會重置落點);呼叫端一律用這個 setAiMembers,
    // 不可在 applyProgress 之後再 setAiMembers(舊陣列)蓋掉(否則轉場後隊友落點/token 會掉)。
    // 進度敘事不在此直接 append:改收集進 logs 回傳,讓「演出動作」延到完成拍才放(不先於演出暴雷);
    // 結局同理改回傳 outcome,由呼叫端決定何時覆蓋結算畫面。
    const logs: string[] = [];
    let pendingOutcome: OutcomeData | null = null;
    if (setup.tutorial || setup.actData.length === 0) return { sc, inv, aiArr: partyAIs, logs, outcome: pendingOutcome };
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
        for (const line of introLines) logs.push('[劇情] ' + line);
      } else {
        logs.push('[劇情] ' + describeEffect(eff, locMeta));
      }
    }
    let nextSc = tick.scenario;
    let nextInv = inv;
    let nextFlags = tick.flags;
    let nextAIs = partyAIs;

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
        globalMoveCostBonus: nextSc.globalMoveCostBonus, // 議程滂沱暴雨等持續效果跨場景保留
        enemies: nextSc.enemies.filter((e) => sceneLocs.has(e.locationId)),
      };
      nextInv = {
        ...nextInv,
        currentLocationId: built2.investigator.currentLocationId,
        engagedWith: [],
      };
      // AI 隊友跟著轉場(同出生點,解除交戰)— 寫進回傳的 nextAIs,由呼叫端一次 setAiMembers,
      // 不在此 setAiMembers(否則呼叫端後續 setAiMembers(舊陣列)會蓋掉落點)。
      nextAIs = partyAIs.map((ai) => ({
        ...ai,
        currentLocationId: built2.investigator.currentLocationId,
        engagedWith: [],
      }));
      logs.push('🌧 ──── 場景轉換 ──── 你追著線索踏進了那條傳聞中的巷子。');
    }

    if (tick.victory || tick.defeat) {
      const finalOutcome = evaluateOutcome(setup.outcomes, nextFlags);
      if (finalOutcome) {
        nextFlags = applyOutcomeFlags(finalOutcome, nextFlags);
        pendingOutcome = finalOutcome; // 不在此 setOutcome:演出動作要等完成拍才覆蓋畫面(見呼叫端)
      }
    }
    setFlags(nextFlags);
    return { sc: nextSc, inv: nextInv, aiArr: nextAIs, logs, outcome: pendingOutcome };
  };

  // §11 v0 AI auto-policy:對 effects 內所有「指向 AI 隊友」的 damage_allocatable,自動把傷害塞給
  // 該 AI 的盟友(隊友 AI 不跳 Modal — Modal 是玩家專屬)。就地更新傳入的 aiArr,逐筆寫 Log。
  // 玩家本人的 damage_allocatable 不在此處理(走 setDamageAlloc Modal)。
  const settleAITeamAllocatable = (
    effects: ResultEffect[],
    aiArr: InvestigatorState[],
    playerId: string,
    emit: (line: string) => void = append,
  ): void => {
    for (const eff of effects) {
      if (eff.type !== 'damage_allocatable' || eff.targetId === playerId) continue;
      const j = aiArr.findIndex((ai) => ai?.investigatorId === eff.targetId);
      if (j < 0) continue;
      const cur = aiArr[j];
      if (!cur) continue;
      const pp = eff.params as { physical?: number; horror?: number };
      const auto = autoAllocateDamage(cur, Number(pp.physical ?? 0), Number(pp.horror ?? 0));
      if (auto.effects.length === 0) continue;
      aiArr[j] = auto.investigator;
      const aiName = setup.aiMembers[j]?.profile.name_zh ?? 'AI';
      for (const e of auto.effects) emit('  └ ' + describeEffect(e, locMeta).split('你').join(aiName));
    }
  };

  const triggerEncounter = useCallback((pending: PendingEncounterTrigger | null): boolean => {
    if (!pending || encounterPlay || setup.encounterCards.length === 0) return false;
    const targetId = pending.targetInvestigatorId ?? investigator.investigatorId;
    if (targetId !== investigator.investigatorId) {
      const idx = aiMembers.findIndex((ai) => ai.investigatorId === targetId);
      const target = idx >= 0 ? aiMembers[idx] : null;
      if (!target) return false;
      const resolved = drawAndAutoResolveEncounter(
        encounterDeck,
        setup.encounterTriggerConfig,
        pending.context,
        target,
        scenario,
        setup.enemyStats,
        undefined,
        setup.encounterCards,
      );
      if (!resolved.triggered || !resolved.card) return false;
      const nextDeck = resolved.remaining;
      const nextAIs = [...aiMembers];
      nextAIs[idx] = resolved.investigator;
      settleAITeamAllocatable(resolved.effects, nextAIs, investigator.investigatorId);
      const sync = syncDownedState(nextAIs[idx]);
      nextAIs[idx] = sync.investigator;
      const next = applyProgress(resolved.scenario, investigator, nextAIs);
      setEncounterDeck(nextDeck);
      setScenario(next.sc);
      setAiMembers(next.aiArr);
      const aiName = setup.aiMembers[idx]?.profile.name_zh ?? 'AI';
      if (resolved.reshuffled) append('[遭遇] ' + ENCOUNTER_DECK_RESHUFFLED_NARRATIVE);
      append('[遭遇] ' + pending.sourceLabel + '指定' + aiName + '抽到「' + resolved.card.name_zh + '」。');
      for (const eff of resolved.effects.filter((e) => e.type !== 'encounter_drawn' && e.type !== 'encounter_deck_reshuffled')) {
        append('[遭遇] ' + describeEffect(eff, locMeta).split('你').join(aiName));
      }
      for (const eff of sync.effects) append('[結算] ' + describeEffect(eff, locMeta).split('你').join(aiName));
      for (const l of next.logs) append(l);
      if (next.outcome) { checkpointVitals(next.inv, next.aiArr); setOutcome(next.outcome); }
      return true;
    }
    const draw = drawTriggeredEncounter(
      encounterDeck,
      setup.encounterTriggerConfig,
      pending.context,
      Math.random,
      setup.encounterCards,
    );
    if (!draw.triggered || !draw.card) return false;
    setEncounterDeck(draw.remaining);
    setEncounterPlay({
      beat: 1,
      card: draw.card,
      sourceLabel: pending.sourceLabel,
      resultLines: [],
      effects: [],
      pendingDamageAlloc: null,
      cascadeLogs: [],
      pendingOutcome: null,
    });
    if (draw.reshuffled) append('[遭遇] ' + ENCOUNTER_DECK_RESHUFFLED_NARRATIVE);
    append('[遭遇] ' + pending.sourceLabel + '抽到「' + draw.card.name_zh + '」。');
    return true;
  }, [aiMembers, encounterDeck, encounterPlay, investigator, scenario, setup, locMeta]);

  const triggerKeeperLegendaryEncounter = useCallback((): boolean => {
    if (phase !== 'investigator' || outcome || encounterPlay || damageAlloc || setup.encounterCards.length === 0) return false;
    if (setup.encounterTriggerConfig.keeper_mythos === false) return false;
    const selection = selectKeeperLegendaryEncounter(
      setup.mythosCards,
      [investigator, ...aiMembers],
      keeperState,
    );
    if (!selection.card || !selection.target) return false;
    setKeeperState(selection.state);
    for (const eff of selection.effects) append('[城主傳奇派發] ' + describeEffect(eff, locMeta));
    return triggerEncounter({
      sourceLabel: '城主傳奇派發',
      context: { path: 'keeper_mythos', mythosCardCategory: 'encounter' },
      targetInvestigatorId: selection.target.investigatorId,
    });
  }, [aiMembers, damageAlloc, encounterPlay, investigator, keeperState, locMeta, outcome, phase, setup, triggerEncounter]);

  const advanceEncounterPlay = () => {
    setEncounterPlay((ep) => {
      if (!ep) return ep;
      if (ep.beat === 1) return { ...ep, beat: 2 };
      return ep;
    });
  };

  const chooseEncounterOption = (option: EncounterOption) => {
    if (!encounterPlay) return;
    const r = resolveEncounterOption(option, investigator, scenario, setup.enemyStats);
    tallyActor(investigator.investigatorId, r.effects);
    const sync = syncDownedState(r.investigator);
    const syncLogs = sync.effects.map((eff) => '[結算] ' + describeEffect(eff, locMeta));
    const next = applyProgress(r.scenario, sync.investigator, aiMembers);
    setScenario(next.sc);
    setInvestigator(next.inv);
    setAiMembers(next.aiArr);
    const da = r.effects.find((e) => e.type === 'damage_allocatable' && e.targetId === investigator.investigatorId);
    const dp = da?.params as { physical?: number; horror?: number; targets?: AllocatableTarget[] } | undefined;
    const pendingDamageAlloc: PendingDamageAlloc | null = dp
      ? { physical: Number(dp.physical ?? 0), horror: Number(dp.horror ?? 0), targets: dp.targets ?? [] }
      : null;
    setEncounterPlay({
      ...encounterPlay,
      beat: 3,
      resultLines: r.effects.filter((e) => e.type !== 'damage_allocatable').map((e) => describeEffect(e, locMeta)),
      effects: r.effects,
      pendingDamageAlloc,
      cascadeLogs: [...syncLogs, ...next.logs],
      pendingOutcome: next.outcome,
    });
  };

  const chooseEncounterTalisman = (cardInstanceId: string) => {
    if (!encounterPlay) return;
    const r = resolveEncounterWithTalisman(
      cardInstanceId,
      setup.cardLookup[cardInstanceId],
      encounterPlay.card,
      investigator,
      scenario,
      setup.enemyStats,
      { fallbackOption: encounterPlay.card.options[0] },
    );
    tallyActor(investigator.investigatorId, r.effects);
    const sync = syncDownedState(r.investigator);
    const syncLogs = sync.effects.map((eff) => '[結算] ' + describeEffect(eff, locMeta));
    const next = applyProgress(r.scenario, sync.investigator, aiMembers);
    setScenario(next.sc);
    setInvestigator(next.inv);
    setAiMembers(next.aiArr);
    const da = r.effects.find((e) => e.type === 'damage_allocatable' && e.targetId === investigator.investigatorId);
    const dp = da?.params as { physical?: number; horror?: number; targets?: AllocatableTarget[] } | undefined;
    const pendingDamageAlloc: PendingDamageAlloc | null = dp
      ? { physical: Number(dp.physical ?? 0), horror: Number(dp.horror ?? 0), targets: dp.targets ?? [] }
      : null;
    setEncounterPlay({
      ...encounterPlay,
      beat: 3,
      resultLines: r.effects.filter((e) => e.type !== 'damage_allocatable').map((e) => describeEffect(e, locMeta)),
      effects: r.effects,
      pendingDamageAlloc,
      cascadeLogs: [...syncLogs, ...next.logs],
      pendingOutcome: next.outcome,
    });
  };

  const completeEncounterPlay = () => {
    const pending = encounterPlay?.pendingDamageAlloc ?? null;
    const pendingOutcome = encounterPlay?.pendingOutcome ?? null;
    if (encounterPlay) {
      for (const eff of encounterPlay.effects) append('[遭遇] ' + describeEffect(eff, locMeta));
      for (const l of encounterPlay.cascadeLogs) append(l);
    }
    setEncounterPlay(null);
    if (pendingOutcome) { checkpointVitals(investigator, aiMembers); setOutcome(pendingOutcome); }
    if (pending) setDamageAlloc(pending);
  };

  // Timer only signals a finished presentation beat. The effect below reads committed state before advancing it.
  useEffect(() => {
    if (!encounterPlay) return;
    const delay = encounterAutoDelay(encounterPlay.beat);
    if (delay === null) return;
    const { id: cardId } = encounterPlay.card;
    const beat = encounterPlay.beat;
    const id = window.setTimeout(() => setEncounterAutoSignal({ cardId, beat }), delay);
    return () => window.clearTimeout(id);
  }, [encounterPlay?.beat, encounterPlay?.card.id]);

  useEffect(() => {
    if (!encounterPlay || !encounterAutoSignal) return;
    if (encounterAutoSignal.cardId !== encounterPlay.card.id || encounterAutoSignal.beat !== encounterPlay.beat) return;
    const transition = autoEncounterTransition(encounterPlay.beat);
    setEncounterAutoSignal(null);
    if (transition === 'advance') {
      advanceEncounterPlay();
      return;
    }
    if (transition === 'complete') completeEncounterPlay();
  }, [encounterAutoSignal, encounterPlay]);

  // 跑單一 AI 隊友的一回合(邏輯同 enterMythosPhase ⓪;抽出供「計時器同時行動」與「結束階段補跑」共用)。
  // 純計算式:吃 (idx, sc, inv, aiArr) 回新的三者與待播放 Log,不直接 setState。
  const stepAITeammate = (
    idx: number,
    sc0: ScenarioState,
    inv0: InvestigatorState,
    aiArr0: InvestigatorState[],
  ): { sc: ScenarioState; inv: InvestigatorState; aiArr: InvestigatorState[]; steps: PendingAIStep[] } => {
    const m = setup.aiMembers[idx];
    const ai = aiArr0[idx];
    if (!m || !ai || ai.dead || ai.permanentlyDead || isDowned(ai)) return { sc: sc0, inv: inv0, aiArr: aiArr0, steps: [] };
    let sc = sc0;
    let inv = inv0;
    const aiArr = [...aiArr0];
    const aiSteps: PendingAIStep[] = [];
    const allies: Record<string, InvestigatorState> = { [inv.investigatorId]: inv };
    for (const [j, other] of aiArr.entries()) if (j !== idx && other) allies[other.investigatorId] = other;
    // 指揮層接管目標(企畫書 P2/P3):勝利解析 → 時間預算 → 緊急分值 U → 隊伍指派。
    // 玩家席也在指派矩陣裡(能力入帳、梯隊假設玩家配合;AI 拿自己的指派行動,不指揮玩家)。
    const partySize = 1 + setup.aiMembers.length;
    const party: Record<string, InvestigatorState> = { [inv.investigatorId]: inv };
    for (const other of aiArr) if (other) party[other.investigatorId] = other;
    const cmdCtx = {
      scenario: sc, investigators: party,
      actCards: setup.actData, agendaCards: setup.agendaData,
      enemyData: setup.enemyStats, locationStats: setup.locationStats,
      cardLookup: setup.cardLookup, stylePools: setup.stylePools,
      playerCount: partySize,
      // 城主毀滅速率 = 累積毀滅 ÷ 已過回合(動態觀測,不寫死;開局未知 → 預算無上限)
      observedDoomRate: turnNumber > 1 ? cumulativeDoom(sc, setup.agendaData) / (turnNumber - 1) : null,
    };
    const trace = commandTick(cmdCtx);
    const myRole = assignRoles(trace, cmdCtx).find((rr) => rr.investigatorId === ai.investigatorId);
    // 回退:指揮層無指派(全幕完成/無 ACT 資料)→ 沿用當前幕條件推導
    const curAct = [...setup.actData].sort((a, b) => a.card_order - b.card_order)[sc.actIndex ?? 0];
    const objective = objectiveForAssignment(myRole, trace.chain) ?? deriveObjective(
      curAct?.front_advance_condition as Record<string, unknown> | undefined,
      partySize,
      setup.enemyStats,
    );
    // 軌跡進戰役紀錄(驗證計畫乙:dry run 時看得到每個 AI 為什麼做那件事)
    if (myRole) {
      const kindLabel = { clues: '湊線索', kill: '殺敵', escape: '撤離', survive: '撐住', none: '自由' }[myRole.kind] ?? myRole.kind;
      const postureLabel = trace.posture === 'calm' ? '從容' : trace.posture === 'urgent' ? '告急' : '背水';
      aiSteps.push({
        lines: [`[${m.profile.name_zh}] 指揮: ${kindLabel}${myRole.role === 'prepare' ? '(組陣備戰)' : ''} | U=${Number.isFinite(trace.urgency) ? trace.urgency.toFixed(2) : '∞'}(${postureLabel})`],
      });
    }
    const r = runInvestigatorAITurn(
      {
        scenario: sc, investigator: ai, allies, turnNumber,
        locationStats: setup.locationStats, enemyStats: setup.enemyStats,
        cardLookup: setup.cardLookup, stylePools: setup.stylePools,
        actCards: setup.actData,
        objective,
        urgency: Number.isFinite(trace.urgency) ? trace.urgency : 1,
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
      const lines = [`[${m.profile.name_zh}] ${step.intentNarrative}`];
      for (const eff of step.effects) {
        if (eff.type === 'damage_allocatable') continue; // Modal 提示不對 AI 顯示;改下方自動分配
        lines.push('  └ ' + describeEffect(eff, locMeta).split('你').join(m.profile.name_zh));
      }
      aiSteps.push({ lines });
    }
    // 六項:AI 本人這回合的線索/傷害/資源/抽卡(被駁回的動作不計)
    tallyActor(ai.investigatorId, r.steps.filter((s) => s.outcome !== 'rejected').flatMap((s) => s.effects));
    // v0 AI auto-policy:把 AI 本回合自身受到的可分配傷害自動塞給自己的盟友(不跳 Modal)
    const autoLines: string[] = [];
    settleAITeamAllocatable(r.steps.flatMap((s) => s.effects), aiArr, inv0.investigatorId, (line) => autoLines.push(line));
    if (autoLines.length > 0) aiSteps.push({ lines: autoLines });
    if (aiSteps.length === 0) aiSteps.push({ lines: [`[${m.profile.name_zh}] 按兵不動,觀察著四周。`] });
    return { sc, inv, aiArr, steps: aiSteps };
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
  const aiPaused = !!(setup.tutorial || phase !== 'investigator' || turnOpeningChoice === 'pending' || outcome || actionPlay || encounterPlay || damageAlloc);
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
    if (setup.tutorial || phase !== 'investigator' || turnOpeningChoice === 'pending' || outcome || actionPlay || encounterPlay || damageAlloc) return;
    const idx = aiMembers.findIndex((ai) =>
      !!ai && !ai.dead && !ai.permanentlyDead && !isDowned(ai) && !aiActedThisTurn.includes(ai.investigatorId));
    if (idx < 0) return;
    const actedId = aiMembers[idx]?.investigatorId;
    const res = stepAITeammate(idx, scenario, investigator, aiMembers);
    const next = applyProgress(res.sc, res.inv, res.aiArr);
    setScenario(next.sc);
    setInvestigator(next.inv);
    setAiMembers(next.aiArr); // 用 applyProgress 回傳的最終陣列(含場景轉場落點),非 res.aiArr
    queueAISteps([...res.steps, ...next.logs.map((line) => ({ lines: [line] }))]); // AI 動作逐步進 Log
    if (next.outcome) { checkpointVitals(next.inv, next.aiArr); setOutcome(next.outcome); }
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
      }
      // 方向 A:accepted 的 effects 不在此即時 append(會先於演出暴雷 + 與 modal 重複)。
      // 改由「演出完成拍」一次進 Log(completeActionPlay);無演出的純記帳動作在 submitIntent 直接進。
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
    if (actionFeedback || actionPlay || encounterPlay || damageAlloc) return;
    const feedbackLabel = (ACTION_PLAY_TITLE[actionType] ?? actionType).replace(/^[^\p{L}\p{N}]+/u, '');
    const feedbackTargetLocationId = actionType === 'move' && typeof payload.targetLocationId === 'string'
      ? payload.targetLocationId
      : undefined;
    holdActionFeedback(actionType, feedbackLabel, feedbackTargetLocationId);
    const intent: IntentMessage = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION,
      source: 'p1', kind: 'intent', actionType, payload,
      playerId: 'p1', investigatorId: investigator.investigatorId,
    };
    bus.publish(intent);
    const turn: TurnState = { turnNumber, phase, actionPointsSpent: {}, pendingLegendaryActions: [], triggeredReactions: [] };
    const ruleInvestigators: Record<string, InvestigatorState> = { [investigator.investigatorId]: investigator };
    for (const ai of aiMembers) ruleInvestigators[ai.investigatorId] = ai;
    const ctx: RuleContext = {
      scenario, investigator, turn,
      investigators: ruleInvestigators,
      locationStats: setup.locationStats,
      enemyStats: setup.enemyStats,
      cardLookup: setup.cardLookup,
      stylePools: setup.stylePools,
      chaosMarkerEffects: setup.chaosMarkerEffects,
      actCards: setup.actData,
    };
    const out = resolveIntent(intent, ctx);
    bus.publish(out.result);
    if (isCardLab) {
      appendLines(cardLabDiagnosticLines({
        actionType,
        payload,
        outcome: out.result.outcome,
        rejection: out.result.rejection,
        effects: out.result.effects ?? [],
        beforeInvestigator: investigator,
        afterInvestigator: out.newState?.investigator ?? investigator,
        beforeScenario: scenario,
        afterScenario: out.newState?.scenario ?? scenario,
        setup,
      }));
    }
    if (out.result.outcome === 'accepted') {
      tallyActor(investigator.investigatorId, out.result.effects ?? []); // 六項:玩家本動作的線索/傷害/資源/抽卡
      // 倒地同步(閃避失敗/藉機攻擊可能把自己打趴)— 不即時 append,收成 syncLogs 排在主效果之後
      const sync = syncDownedState(out.newState?.investigator ?? investigator);
      const syncLogs = sync.effects.map((eff) => '[結算] ' + describeEffect(eff, locMeta));
      // 穩定救援改動到的隊友
      const allies = out.newState?.updatedAllies ?? {};
      // 進度檢查要用「本次更新後」的 AI 陣列(setAiMembers 非同步,閉包 aiMembers 仍是舊值)
      const freshAIs = Object.keys(allies).length > 0
        ? aiMembers.map((ai) => allies[ai.investigatorId] ?? ai)
        : aiMembers;
      // 進度檢查(幕推進/場景切換/結局)疊在引擎結算之上 — 進度敘事與結局都改回傳,不在內部即時生效
      const next = applyProgress(
        out.newState?.scenario ?? scenario,
        sync.investigator,
        freshAIs,
      );
      setScenario(next.sc);
      setInvestigator(next.inv);
      setAiMembers(next.aiArr); // 含救援盟友更新 + 場景轉場落點(freshAIs 已疊 allies,applyProgress 再轉場)
      // §11 受傷且有可分配卡 → 傷害分配 Modal(只認玩家本人的傷害,排除隊友)。
      // 走演出的動作:延後到演出「完成」才跳(避免兩 Modal 疊);否則立即跳。
      const da = (out.result.effects ?? []).find((e) => e.type === 'damage_allocatable' && e.targetId === investigator.investigatorId);
      const dp = da?.params as { physical?: number; horror?: number; targets?: AllocatableTarget[] } | undefined;
      const pendingDamageAlloc: PendingDamageAlloc | null = dp
        ? { physical: Number(dp.physical ?? 0), horror: Number(dp.horror ?? 0), targets: dp.targets ?? [] }
        : null;
      // 後續行(倒地同步 + 進度/場景/結局敘事):一律排在主效果「之後」。
      const cascadeLogs = [...syncLogs, ...next.logs];
      const effects = out.result.effects ?? [];
      const drawnNames = effects
        .filter((effect) => effect.type === 'draw_card')
        .map((effect) => cardMeta[String((effect.params as { cardInstanceId?: unknown }).cardInstanceId ?? '')]?.name)
        .filter((name): name is string => Boolean(name));
      if (drawnNames.length > 0) showScreenToast(`抽到了「${drawnNames.join('」、「')}」`);
      if (effects.some((effect) => effect.type === 'deck_empty_horror')) {
        showScreenToast('牌庫已空，受到 1 點恐懼', 'warning');
      }
      const moveEff = effects.find((e) => e.type === 'move');
      const moveTo = moveEff ? String((moveEff.params as { to?: unknown }).to ?? '') : '';
      const headlinePending = effects.some((e) => e.type === 'headline_drawn');
      const pendingEncounter: PendingEncounterTrigger = headlinePending
        ? {
            sourceLabel: '混沌頭條',
            context: { path: 'chaos_headline', chaosTokenType: 'headline' },
          }
        : {
            sourceLabel: actionType === 'move' ? '進入地點' : '行動條件',
            context: {
              path: 'player_action',
              actionType,
              locationId: moveTo || next.inv.currentLocationId || investigator.currentLocationId,
            },
          };
      // Phase2 C:玩家自己的動作跳三段演出 Modal(敘述→檢定→結果)。方向 A 完整收斂 —
      // 主效果 + 後續行(cascadeLogs)+ 結局(outcome)全部延到演出「完成」拍才生效:
      // 演出期間 Log 不暴雷、結局畫面不蓋掉沒播完的演出。純記帳動作(取資源/抽卡)不跳,維持輕快。
      if (!ACTION_PLAY_SKIP.has(actionType)) {
        window.clearTimeout(actionFeedbackTimerRef.current);
        setActionFeedback(null);
        const locId = investigator.currentLocationId;
        const locName = (locId && setup.locMeta[locId]?.name) || locId || '此地';
        setActionPlay(buildActionPlay(actionType, effects, locName, locMeta, pendingDamageAlloc, cascadeLogs, next.outcome, pendingEncounter));
      } else {
        // 純記帳動作(拿資源/抽卡)不跳演出 → 主效果 + 後續行即時進 Log(無演出可同步)
        append(`[${setup.investigatorName}] ${ACTION_PLAY_TITLE[actionType] ?? actionType}`);
        for (const eff of effects) append('[結算] ' + describeEffect(eff, locMeta));
        for (const l of cascadeLogs) append(l);
        if (next.outcome) { checkpointVitals(next.inv, next.aiArr); setOutcome(next.outcome); }
        if (pendingDamageAlloc) setDamageAlloc(pendingDamageAlloc);
        if (!next.outcome && !pendingDamageAlloc) {
          const opened = triggerEncounter(pendingEncounter);
          if (!opened) triggerKeeperLegendaryEncounter();
        }
      }
    } else {
      rejectActionFeedback(actionType, feedbackLabel, feedbackTargetLocationId);
      showScreenToast(out.result.rejection?.narrative ?? '動作無法執行', 'warning', 1_500);
    }
  }, [actionFeedback, actionPlay, encounterPlay, damageAlloc, holdActionFeedback, rejectActionFeedback, showScreenToast, bus, investigator, scenario, aiMembers, turnNumber, phase, setup, flags, locMeta, triggerEncounter, triggerKeeperLegendaryEncounter, isCardLab, appendLines, cardMeta]);

  const iconLabel = (key: string): string => key === 'all'
    ? '萬用'
    : (ATTRIBUTE_LABEL[key as AttributeKey] ?? key);

  const commitIconText = (data: CardData | undefined): string => {
    const icons = data?.commit_icons ?? {};
    const parts = Object.entries(icons)
      .filter(([, value]) => Number(value) > 0)
      .map(([key, value]) => `${iconLabel(key)} +${Number(value)}`);
    return parts.length > 0 ? parts.join(' / ') : '無投入圖示';
  };

  const commitCandidateValue = (data: CardData | undefined, attribute: AttributeKey | null): number => {
    const icons = data?.commit_icons ?? {};
    if (attribute) return commitValueFor(attribute, [icons]);
    return Math.max(0, ...COMMIT_ATTRIBUTES.map((attr) => commitValueFor(attr, [icons])));
  };

  const commitCandidatesFor = (attribute: AttributeKey | null): PendingCommitWindow['candidates'] => investigator.hand
    .map((id) => {
      const data = setup.cardLookup[id];
      const value = commitCandidateValue(data, attribute);
      return {
        id,
        name: data?.name_zh ?? id,
        value,
        icons: commitIconText(data),
      };
    })
    .filter((card) => card.value > 0);

  const inferCheckAttribute = (
    actionType: IntentMessage['actionType'],
  ): AttributeKey | null => {
    if (actionType === 'execute_card_action') return null;
    return CHECK_ACTION_ATTRIBUTE[actionType] ?? null;
  };

  const inferCheckDc = (
    actionType: IntentMessage['actionType'],
    payload: Record<string, unknown>,
  ): number | null => {
    if (actionType === 'investigate' || actionType === 'search' || actionType === 'investigate_hidden') {
      return setup.locationStats[investigator.currentLocationId ?? '']?.shroud ?? 10;
    }
    if (actionType === 'attack' || actionType === 'evade' || actionType === 'execute_card_action') {
      const requestedEnemyId = String(payload.enemyInstanceId ?? '');
      const enemy = scenario.enemies.find((e) => e.instanceId === requestedEnemyId)
        ?? scenario.enemies.find((e) => e.locationId === investigator.currentLocationId && e.hp > 0);
      return enemy ? (setup.enemyStats[enemy.enemyDefinitionId]?.dc ?? 10) : null;
    }
    return null;
  };

  const estimateChance = (dc: number | null, modifier: number | null): string | null => {
    if (dc == null || modifier == null) return null;
    const required = dc - modifier;
    const hits = required <= 1 ? 20 : required > 20 ? 0 : 21 - required;
    return Math.round((hits / 20) * 100) + '%';
  };

  /** 檢定類動作:宣告後才開投入時機,確認後送 shared rule engine。 */
  const submitCheckIntent = (
    actionType: IntentMessage['actionType'],
    payload: Record<string, unknown> = {},
  ) => {
    const attribute = inferCheckAttribute(actionType);
    const candidates = commitCandidatesFor(attribute);
    if (candidates.length === 0) {
      submitIntent(actionType, payload);
      return;
    }
    setCommitWindow({
      actionType,
      payload,
      attribute,
      dc: inferCheckDc(actionType, payload),
      selectedIds: [],
      candidates,
    });
  };

  const togglePendingCommit = (cardId: string) => {
    setCommitWindow((win) => win
      ? {
          ...win,
          selectedIds: win.selectedIds.includes(cardId)
            ? win.selectedIds.filter((id) => id !== cardId)
            : [...win.selectedIds, cardId],
        }
      : win);
  };

  const confirmCommitWindow = (selectedIdsOverride?: string[]) => {
    if (!commitWindow) return;
    const selectedIds = selectedIdsOverride ?? commitWindow.selectedIds;
    const payload = selectedIds.length > 0
      ? { ...commitWindow.payload, commitCardIds: selectedIds }
      : commitWindow.payload;
    const actionType = commitWindow.actionType;
    setCommitWindow(null);
    submitIntent(actionType, payload);
  };

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
    const pendingOutcome = actionPlay?.pendingOutcome ?? null;
    const pendingEncounter = actionPlay?.pendingEncounter ?? null;
    // 方向 A 完整收斂:演出走完才一次放 Log — 主效果 → 後續行(倒地同步 + 進度/場景/結局敘事),
    // 順序固定、單一來源、不先於演出暴雷。結局畫面也等到此刻才覆蓋(不蓋掉沒播完的演出)。
    if (actionPlay) {
      append(`[${setup.investigatorName}] ${actionPlay.title}`);
      for (const eff of actionPlay.effects) append('[結算] ' + describeEffect(eff, locMeta));
      for (const l of actionPlay.cascadeLogs) append(l);
    }
    setActionPlay(null);
    if (pendingOutcome) { checkpointVitals(investigator, aiMembers); setOutcome(pendingOutcome); }
    if (pending) setDamageAlloc(pending);
    if (!pendingOutcome && !pending) {
      const opened = triggerEncounter(pendingEncounter);
      if (!opened) triggerKeeperLegendaryEncounter();
    }
  };
  // 檢定拍擲骰動畫(節奏窗口 ~700ms:重量感 + 遮蔽未來延遲載入)
  useEffect(() => {
    if (!actionPlay || actionPlay.beat !== 2 || !actionPlay.rolling) return;
    const id = setTimeout(() => {
      setActionPlay((ap) => (ap && ap.beat === 2 && ap.rolling ? { ...ap, rolling: false } : ap));
    }, 700);
    return () => clearTimeout(id);
  }, [actionPlay]);

  // 階段控制
  // 短休息(ch2 §3.1):調查員階段開頭的個人決定 — 放棄本回合行動換重洗牌庫,
  // 不跳過階段(其他調查員照常),做完仍要按「結束調查員階段」進敵人階段。
  const takePlayerShortRest = () => {
    const r = runShortRest(investigator);
    setInvestigator(r.investigator);
    setPlayerShortRested(true);
    setTurnOpeningChoice('rested');
    for (const eff of r.effects) append('[短休息] ' + describeEffect(eff, locMeta));
  };

  const beginPlayerActions = () => {
    setTurnOpeningChoice('actions');
    showScreenToast('開始行動');
  };
  /**
   * 神話階段 — 城主 AI v0(keeper_ai_regulation §2.2 sequence):
   * ① 附著卡強制結算 ② 城主選用神話卡(行動點預算+戲劇曲線)③ 怪物啟動 ④ 進度/全滅檢查
   */
  const enterMythosPhase = () => {
    if (phase !== 'investigator' || (investigator.actionPoints > 0 && !playerShortRested)) return;
    setEnemyResolutionComplete(false);
    setKeeperNoticeVisible(true);
    let sc = scenario;
    let inv = investigator;

    // ⓪ 結束調查員階段:把本回合「計時器還沒輪到」的 AI 隊友補跑完,保證每位都行動到、不損失回合。
    //    (玩家逗留時計時器已讓 AI 陸續行動;玩家提前結束就在這裡補齊 — 同時/自由順序的數位形態)
    let updatedAIs = [...aiMembers];
    const catchupSteps: PendingAIStep[] = [];
    if (!setup.tutorial) {
      for (let idx = 0; idx < updatedAIs.length; idx += 1) {
        const aiId = updatedAIs[idx]?.investigatorId;
        if (aiId && aiActedThisTurn.includes(aiId)) continue; // 已由計時器跑過
        const res = stepAITeammate(idx, sc, inv, updatedAIs);
        sc = res.sc;
        inv = res.inv;
        updatedAIs = res.aiArr;
        catchupSteps.push(...res.steps);
      }
    }
    queueAISteps(catchupSteps);

    turnLoopRef.current?.advance();
    append('[階段切換] 進入敵人階段');
    if (setup.tutorial) {
      setKeeperEnergy((e) => Math.max(0, e - 2));
      setTimeout(() => append('[城主行動] 黑暗從牆角滲出。'), 1200);
      setEnemyResolutionComplete(true);
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
    let pendingKeeperEncounter: PendingEncounterTrigger | null = null;
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
      if (!pendingKeeperEncounter && String(card.card_category ?? '') === 'encounter') {
        pendingKeeperEncounter = {
          sourceLabel: '城主遭遇',
          context: { path: 'keeper_mythos', mythosCardCategory: String(card.card_category ?? '') },
        };
      }
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
          for (const eff of aiFear.effects) {
            if (eff.type === 'damage_allocatable') continue; // Modal 提示不對 AI 顯示;改下方自動分配
            append('  └ ' + describeEffect(eff, locMeta).split('你').join(aiName));
          }
          // v0 AI auto-policy:恐懼造成的可分配傷害 → 自動塞給該 AI 的盟友
          settleAITeamAllocatable(aiFear.effects, updatedAIs, inv.investigatorId);
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
    // §11 v0 AI auto-policy:神話階段對 AI 隊友造成的可分配傷害 → 自動塞給該 AI 的盟友(玩家才跳 Modal)
    settleAITeamAllocatable(act.effects, updatedAIs, inv.investigatorId);

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

    // 六項:回合邊界 HP/SAN 淨損結算(調查員階段 + 神話階段全部傷害,救人回血後的淨值)— 每回合一次,落在結局判定前
    checkpointVitals(inv, updatedAIs);

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
    setAiMembers(next.aiArr); // 一律用 applyProgress 回傳的最終陣列(含可能的轉場落點)
    next.logs.forEach((l) => append(l)); // 神話階段無玩家演出 → 進度敘事即時進 Log
    if (next.outcome) setOutcome(next.outcome);
    if (!next.outcome) triggerEncounter(pendingKeeperEncounter);
    setEnemyResolutionComplete(true);
  };
  const beginTurnEnd = () => {
    if (!setup.tutorial && turnEndEncounterCheckpoint !== 'done') {
      if (turnEndEncounterCheckpoint === 'pending') {
        setTurnEndEncounterCheckpoint('player_done');
        if (isStanding(investigator)) {
          const opened = triggerEncounter({
            sourceLabel: '回合結束遭遇',
            context: { path: 'turn_end', locationId: investigator.currentLocationId },
            targetInvestigatorId: investigator.investigatorId,
          });
          if (opened) return;
        }
      }

      let nextDeck = encounterDeck;
      let sc = scenario;
      const nextAIs = [...aiMembers];
      for (let idx = 0; idx < nextAIs.length; idx += 1) {
        const ai = nextAIs[idx];
        if (!isStanding(ai)) continue;
        const enc = drawAndAutoResolveEncounter(
          nextDeck,
          setup.encounterTriggerConfig,
          { path: 'turn_end', locationId: ai.currentLocationId },
          ai,
          sc,
          setup.enemyStats,
          undefined,
          setup.encounterCards,
        );
        if (!enc.triggered || !enc.card) continue;
        nextDeck = enc.remaining;
        sc = enc.scenario;
        nextAIs[idx] = syncDownedState(enc.investigator).investigator;
        const aiName = setup.aiMembers[idx]?.profile.name_zh ?? 'AI';
        if (enc.reshuffled) append('[遭遇] ' + ENCOUNTER_DECK_RESHUFFLED_NARRATIVE);
        append(`[回合結束遭遇] ${aiName} 抽到「${enc.card.name_zh}」。`);
        for (const eff of enc.effects.filter((e) => e.type !== 'encounter_drawn' && e.type !== 'encounter_deck_reshuffled')) {
          append('[遭遇] ' + describeEffect(eff, locMeta).split('你').join(aiName));
        }
      }
      const next = applyProgress(sc, investigator, nextAIs);
      setEncounterDeck(nextDeck);
      setScenario(next.sc);
      setAiMembers(next.aiArr);
      next.logs.forEach((l) => append(l));
      setTurnEndEncounterCheckpoint('done');
      if (next.outcome) { checkpointVitals(next.inv, next.aiArr); setOutcome(next.outcome); return; }
    }

    // 敵人階段完成後只進入回合結束；補給、手牌上限與轉正提示完成後才開下一回合。
    turnLoopRef.current?.advance();
    setEnemyResolutionComplete(false);
    if (!setup.tutorial) {
      const playerUpkeep = runTurnEndUpkeep(investigator, { deferHandLimit: true });
      const upkeepDraw = playerUpkeep.effects.find((effect) => effect.type === 'upkeep_draw');
      const upkeepCardId = String(upkeepDraw?.params?.cardInstanceId ?? '');
      setLastUpkeepCardName(upkeepCardId ? (cardMeta[upkeepCardId]?.name ?? upkeepCardId) : null);
      tallyActor(investigator.investigatorId, playerUpkeep.effects);
      setInvestigator(playerUpkeep.investigator);
      for (const eff of playerUpkeep.effects.filter((effect) => effect.type !== 'hand_limit_required')) {
        append('[回合結束] ' + describeEffect(eff, locMeta));
      }
      setAiMembers(aiMembers.map((ai, idx) => {
        const aiName = setup.aiMembers[idx]?.profile.name_zh ?? 'AI';
        const upkeep = runTurnEndUpkeep(ai);
        tallyActor(ai.investigatorId, upkeep.effects);
        for (const eff of upkeep.effects) {
          append(`[回合結束][${aiName}] ` + describeEffect(eff, locMeta).split('你').join(aiName));
        }
        return upkeep.investigator;
      }));
    } else {
      setInvestigator(investigator);
    }
    setRoundTransition('supply');
  };

  const startNextRound = useCallback(() => {
    turnLoopRef.current?.advance();
    setPlayerShortRested(false);
    setTurnOpeningChoice(setup.tutorial || isCardLab ? 'actions' : 'pending');
    setTurnEndEncounterCheckpoint('pending');
    setAiActedThisTurn([]);
    setInvestigator((current) => {
      let next = { ...current, actionPoints: 3 };
      const start = runTurnStartUpkeep(next);
      for (const eff of start.effects) append('[回合開始] ' + describeEffect(eff, locMeta));
      next = syncDownedState(start.investigator).investigator;
      if (isDowned(next)) {
        const save = runDeathSave(next);
        next = { ...save.investigator, actionPoints: 0 };
        for (const eff of save.effects) append('[瀕死] ' + describeEffect(eff, locMeta));
      }
      return next;
    });
    setAiMembers((members) => members.map((ai, idx) => {
      const aiName = setup.aiMembers[idx]?.profile.name_zh ?? 'AI';
      let next = { ...ai, actionPoints: 3 };
      const start = runTurnStartUpkeep(next);
      for (const eff of start.effects) append(`[回合開始][${aiName}] ` + describeEffect(eff, locMeta).split('你').join(aiName));
      next = syncDownedState(start.investigator).investigator;
      if (isDowned(next)) {
        const save = runDeathSave(next);
        next = { ...save.investigator, actionPoints: 0 };
        for (const eff of save.effects) append(`[瀕死][${aiName}] ` + describeEffect(eff, locMeta).split('你').join(aiName));
      }
      return next;
    }));
    setScenario((current) => ({ ...current, turnNumber: current.turnNumber + 1 }));
    setKeeperEnergy((energy) => Math.min(12, energy + 1));
    setRoundTransition('new_round');
    setLastUpkeepCardName(null);
  }, [append, locMeta, setup.aiMembers, setup.tutorial, isCardLab]);

  const toggleHandLimitCard = (cardId: string) => {
    setHandLimitSelection((selection) => selection
      ? {
          ...selection,
          selectedIds: selection.selectedIds.includes(cardId)
            ? selection.selectedIds.filter((id) => id !== cardId)
            : selection.selectedIds.length < selection.required
              ? [...selection.selectedIds, cardId]
              : selection.selectedIds,
        }
      : selection);
  };

  const confirmHandLimitDiscard = () => {
    if (!handLimitSelection) return;
    const result = discardForHandLimit(investigator, handLimitSelection.selectedIds);
    if (!result.ok) return;
    setInvestigator(result.investigator);
    if (result.effect) append('[回合結束] ' + describeEffect(result.effect, locMeta));
    setHandLimitSelection(null);
    setPanel(null);
    setRoundTransition('ready');
  };

  useEffect(() => {
    if (keeperNoticeVisible) {
      const id = window.setTimeout(() => setKeeperNoticeVisible(false), 1_500);
      return () => window.clearTimeout(id);
    }
  }, [keeperNoticeVisible]);

  useEffect(() => {
    const newlySpawned = scenario.enemies.filter((enemy) => !knownEnemyIdsRef.current.has(enemy.instanceId));
    for (const enemy of scenario.enemies) knownEnemyIdsRef.current.add(enemy.instanceId);
    if (newlySpawned.length > 0) setKeeperNoticeVisible(true);
  }, [scenario.enemies]);

  useEffect(() => {
    if (phase !== 'mythos' || !enemyResolutionComplete || outcome || encounterPlay || damageAlloc || actionPlay || roundTransition) return;
    const id = window.setTimeout(beginTurnEnd, 0);
    return () => window.clearTimeout(id);
  });

  useEffect(() => {
    if (roundTransition === 'supply') {
      const id = window.setTimeout(() => {
        const required = Math.max(0, investigator.hand.length - HAND_LIMIT);
        if (required > 0) {
          setHandLimitSelection({ required, selectedIds: [] });
          setPanel('hand');
          setRoundTransition('discard');
        } else {
          setRoundTransition('ready');
        }
      }, 1_500);
      return () => window.clearTimeout(id);
    }
    if (roundTransition === 'ready') {
      const id = window.setTimeout(startNextRound, 1_500);
      return () => window.clearTimeout(id);
    }
    if (roundTransition === 'new_round') {
      const id = window.setTimeout(() => setRoundTransition(null), 1_500);
      return () => window.clearTimeout(id);
    }
  }, [investigator.hand.length, roundTransition, startNextRound]);

  // ─── 浮層互動 ──────────────────
  const closeAllOverlays = useCallback(() => {
    setModal(null); setPanel(null); setPilePanel(null); setLocationBarId(null);
    setCardLabWorkbenchOpen(false);
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

  const buyPreparationCard = useCallback((card: PreparationCardDefinition) => {
    const result = purchasePreparationCard(campaignProgress, investigator.investigatorDefinitionId, card);
    if (!result.ok) {
      append('[整備] 無法購買「' + String(card.name_zh ?? card.code ?? card.id) + '」:' + purchaseBlockLabel(result.reason));
      return;
    }
    setCampaignProgress(result.progress);
    append('[整備] 花費 ' + result.xpCost + ' XP 購買「' + String(card.name_zh ?? card.code ?? card.id) + '」。');
  }, [campaignProgress, investigator.investigatorDefinitionId]);

  const investTalentNode = useCallback((nodeId: string) => {
    if (!setup.talentTree) {
      append('[整備] 此調查員尚無可用天賦樹資料。');
      return;
    }
    const result = unlockTalentNode(
      campaignProgress,
      investigator.investigatorDefinitionId,
      setup.talentTree,
      nodeId,
      setup.talentCards,
    );
    if (!result.ok) {
      append('[整備] 無法解鎖天賦:' + talentUnlockBlockLabel(result.reason));
      return;
    }
    setCampaignProgress(result.progress);
    append(
      '[整備] 花費 ' + result.cost + ' 天賦點解鎖「' +
      String(result.node?.name_zh ?? result.node?.node_type ?? nodeId) + '」' +
      (result.addedCardId ? ',天賦卡已加入牌組。' : '。'),
    );
  }, [campaignProgress, investigator.investigatorDefinitionId, setup.talentCards, setup.talentTree]);

  const adoptSpirit = useCallback((spirit: TeamSpiritDefinition) => {
    const result = adoptTeamSpirit(campaignProgress, spirit);
    if (!result.ok) {
      append('[整備] 無法採用團隊精神「' + String(spirit.name_zh ?? spirit.code) + '」:' + teamSpiritBlockLabel(result.reason));
      return;
    }
    setCampaignProgress(result.progress);
    append('[整備] 花費 1 凝聚力採用團隊精神「' + String(spirit.name_zh ?? spirit.code) + '」。');
  }, [campaignProgress]);

  const investSpirit = useCallback((spirit: TeamSpiritDefinition) => {
    const result = investTeamSpirit(campaignProgress, spirit);
    if (!result.ok) {
      append('[整備] 無法投入團隊精神「' + String(spirit.name_zh ?? spirit.code) + '」:' + teamSpiritBlockLabel(result.reason));
      return;
    }
    const points = result.progress.teamSpirits?.investments?.[spirit.code]?.points ?? 0;
    setCampaignProgress(result.progress);
    append('[整備] 花費 1 凝聚力強化「' + String(spirit.name_zh ?? spirit.code) + '」至 ' + points + ' 點。');
  }, [campaignProgress]);

  // ─── 衍生資料 ──────────────────────
  const handCards = investigator.hand.map((id) => cardMeta[id]).filter((x): x is CardDisplay => !!x);
  const playerPawnAsset = pawnAssetForInvestigator({
    code: setup.investigatorVisualCode,
    title_zh: setup.investigatorVisualTitle,
  }, 0);
  const enemyHere: EnemyInstance | undefined = scenario.enemies.find((e) => e.locationId === investigator.currentLocationId && e.hp > 0);
  const isLocationUnlocked = (id: string) => scenario.unlockedLocations.includes(id);
  const currentLocInstance = scenario.locations.find((l) => l.locationDefinitionId === investigator.currentLocationId);
  const moveTargets = currentLocInstance ? currentLocInstance.connectedTo : [];
  const visiblePile = pilePanel === 'discard'
    ? investigator.discardPile
    : pilePanel === 'removed'
      ? investigator.removedPile
      : pilePanel === 'extra'
        ? (investigator.extraDeck ?? [])
        : [];
  const visiblePileTitle = pilePanel === 'discard'
    ? '棄牌堆'
    : pilePanel === 'removed'
      ? '除外區'
      : '額外牌組';
  const encounterTalismanOptions = encounterPlay
    ? availableTalismansForEncounter(investigator, setup.cardLookup, encounterPlay.card)
    : [];

  // 地圖 grid:依地點數動態決定列數(<=3 用 1 行,4-9 用 3×3,>9 用 4×N)
  const locCount = scenario.locations.length;
  const gridCols = locCount <= 3 ? locCount : (locCount <= 9 ? 3 : 4);
  const gridRows = Math.max(1, Math.ceil(locCount / Math.max(1, gridCols)));
  const mapConnections = uniqueLocationConnections(scenario.locations);
  const locationIndex = new Map(scenario.locations.map((location, index) => [location.locationDefinitionId, index]));

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
  const currentSharedAction = sharedActionsForCurrentAct(setup.actData, scenario)[0] ?? null;
  const sharedActionTarget = currentSharedAction?.target_variant
    ? scenario.enemies.find((e) => e.hp > 0 && e.enemyDefinitionId === currentSharedAction.target_variant)
    : undefined;
  const sharedActionRatio = Math.max(0.0001, Number(currentSharedAction?.ratio ?? 1) || 1);
  const sharedActionLimitCount = currentSharedAction ? sharedActionLimit(currentSharedAction) : 0;
  const sharedActionUsed = currentSharedAction ? sharedActionUseCount(scenario, currentSharedAction.code) : 0;
  const sharedActionMaxAmount = currentSharedAction && sharedActionTarget
    ? Math.max(0, Math.min(scenario.objectiveProgress, Math.ceil(sharedActionTarget.hp / sharedActionRatio)))
    : 0;
  const canUseSharedAction = !!currentSharedAction
    && !!sharedActionTarget
    && sharedActionMaxAmount > 0
    && sharedActionUsed < sharedActionLimitCount
    && investigator.actionPoints > 0;
  const chosenSharedActionAmount = Math.max(1, Math.min(sharedActionAmount, Math.max(1, sharedActionMaxAmount)));

  useEffect(() => {
    if (sharedActionMaxAmount <= 0) return;
    setSharedActionAmount((v) => Math.max(1, Math.min(v, sharedActionMaxAmount)));
  }, [sharedActionMaxAmount]);

  // 隊伍 modal:玩家 + AI 隊友
  const teamMembers: Array<{ inv: InvestigatorState; name: string; label: string }> = [
    { inv: investigator, name: setup.investigatorName, label: setup.factionLabel + ' · 玩家' },
    ...aiMembers.map((ai, idx) => ({
      inv: ai,
      name: setup.aiMembers[idx]?.profile.name_zh ?? 'AI',
      label: (setup.aiMembers[idx]?.profile.title_zh ?? '') + ' · AI 隊友',
    })),
  ];
  const logStatusRows = latestActionRows(
    teamMembers.map((member) => ({
      id: member.inv.investigatorId,
      name: member.name,
      label: member.label,
    })),
    log,
  );
  const labDummyHp = scenario.enemies.find((enemy) => enemy.instanceId === CARD_LAB_DUMMY_INSTANCE_ID)?.hp ?? 0;

  // phase dots:目前 4 階段(短休息/調查員/神話/結束)
  const phaseIdx = PHASE_ORDER.indexOf(phase);
  const playerCarry = campaignProgress.investigators[investigator.investigatorDefinitionId];
  const rewardPreview: ScenarioReward = outcome
    ? (campaignSettlement?.reward ?? scenarioRewardFromOutcome(outcome, scenario.hiddenPoints ?? [], [investigator.investigatorId]))
    : {};
  const visibleUpgradeCards = setup.upgradeCards.slice(0, 24);
  const visibleTalentNodes: TalentNodeDefinition[] = (setup.talentTree?.nodes ?? [])
    .slice()
    .sort((a, b) =>
      Number(a.level ?? 0) - Number(b.level ?? 0) ||
      Number(a.branch_index ?? 0) - Number(b.branch_index ?? 0) ||
      Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0),
    );
  const teamSpiritProgress = campaignProgress.teamSpirits;
  const adoptedSpiritCount = Object.keys(teamSpiritProgress?.investments ?? {}).length;
  const visibleTeamSpirits = setup.teamSpirits
    .slice()
    .sort((a, b) =>
      Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
      String(a.code).localeCompare(String(b.code)),
    )
    .slice(0, 33);

  return (
    <div className="bg-root" style={{ '--hud-scale': String(interfaceScale / 100) } as CSSProperties}>
      <div className={'battle-screen' + (isCardLab ? ' card-lab-screen' : '')}>

        {isCardLab && (
          <section className="lab-status-strip" aria-label="實驗場狀態">
            <div>
              <strong>卡片良率檢驗所</strong>
              <span>訓練木人 HP {labDummyHp} · 傷害 0 · 恐懼 0</span>
            </div>
            <div className="lab-status-actions">
              <button onClick={() => setCardLabWorkbenchOpen(true)}>卡片品管目錄</button>
              <button onClick={resetTrainingDummy}>重置木人</button>
              <button onClick={resetCardLab}>重置實驗</button>
              <button onClick={() => navigate('/lobby')}>返回大廳</button>
            </div>
          </section>
        )}

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
                  width: gridCols * 220 + (gridCols - 1) * 48,
                  transform: `scale(${zoom})`,
                }}
              >
                <svg className="map-connections" viewBox={`0 0 ${gridCols} ${gridRows}`} preserveAspectRatio="none" aria-hidden>
                  {mapConnections.map((connection) => {
                    const fromIndex = locationIndex.get(connection.from) ?? 0;
                    const toIndex = locationIndex.get(connection.to) ?? 0;
                    return (
                      <line
                        key={`${connection.from}-${connection.to}`}
                        className={connection.blocked ? 'blocked' : ''}
                        x1={(fromIndex % gridCols) + 0.5}
                        y1={Math.floor(fromIndex / gridCols) + 0.5}
                        x2={(toIndex % gridCols) + 0.5}
                        y2={Math.floor(toIndex / gridCols) + 0.5}
                      />
                    );
                  })}
                </svg>
                {scenario.locations.map((loc) => {
                  const meta = locMeta[loc.locationDefinitionId];
                  const artKind = locationArtKind(loc.locationDefinitionId, meta?.name);
                  const unlocked = isLocationUnlocked(loc.locationDefinitionId);
                  const isCurr = loc.locationDefinitionId === investigator.currentLocationId;
                  const isMoveTarget = moveTargets.includes(loc.locationDefinitionId);
                  const moveCost = (loc.isObstacle ? 2 : 1) + (scenario.globalMoveCostBonus ?? 0);
                  const canUseMapActions = phase === 'investigator'
                    && turnOpeningChoice === 'actions'
                    && !playerShortRested
                    && !isDowned(investigator)
                    && !investigator.dead
                    && !openingBriefing
                    && !actionFeedback;
                  const canInvestigateHere = isCurr && canUseMapActions && investigator.actionPoints >= 1;
                  const canMoveHere = !isCurr
                    && canUseMapActions
                    && unlocked
                    && isMoveTarget
                    && investigator.actionPoints >= moveCost;
                  const showInvestigate = isCurr && (canInvestigateHere || actionFeedback?.key === 'investigate');
                  const showMove = !isCurr && (
                    canMoveHere || feedbackTargetsLocation(actionFeedback, 'move', loc.locationDefinitionId)
                  );
                  const cluesHere = scenario.tokens.filter((t) => t.locationId === loc.locationDefinitionId && t.tokenType === 'clue').reduce((s, t) => s + t.amount, 0);
                  const maxClues = Math.max(2, cluesHere);
                  return (
                    <div
                      key={loc.locationDefinitionId}
                      className={'location-card' + (isCurr ? ' current-loc' : '') + (unlocked ? '' : ' locked')}
                      onClick={() => onLocationClick(loc.locationDefinitionId)}
                    >
                      <div className="loc-name">{!unlocked && <span className="loc-lock-mark">鎖定 · </span>}{meta?.name ?? loc.locationDefinitionId}</div>
                      <div className={`loc-illustration loc-art-${artKind}`} role="img" aria-label={`${meta?.name ?? loc.locationDefinitionId}地點插畫`}>
                        <div className="location-occupants">
                          {isCurr && (
                            <img
                              className="investigator-pawn pawn-player"
                              src={playerPawnAsset}
                              style={{ '--pawn-tone': playerToneForSlot(0), opacity: isDowned(investigator) ? 0.45 : 1 } as CSSProperties}
                              alt="玩家棋子"
                            />
                          )}
                          {aiMembers.map((ai, aiIdx) =>
                            !ai.dead && !ai.permanentlyDead && ai.currentLocationId === loc.locationDefinitionId ? (
                              <img
                                key={ai.investigatorId}
                                className={`investigator-pawn pawn-companion pawn-slot-${aiIdx + 1}`}
                                src={pawnAssetForInvestigator({
                                  code: setup.aiMembers[aiIdx]?.profile.templateCode,
                                  title_zh: setup.aiMembers[aiIdx]?.profile.title_zh,
                                }, aiIdx + 1)}
                                style={{ '--pawn-tone': playerToneForSlot(aiIdx + 1), opacity: isDowned(ai) ? 0.45 : 1 } as CSSProperties}
                                title={(setup.aiMembers[aiIdx]?.profile.name_zh ?? '') + (isDowned(ai) ? '(瀕死)' : '')}
                                alt={`${setup.aiMembers[aiIdx]?.profile.name_zh ?? '隊友'}棋子`}
                              />
                            ) : null,
                          )}
                          {scenario.enemies
                            .filter((e) => e.hp > 0 && e.locationId === loc.locationDefinitionId)
                            .map((e, ei) => {
                              const enemyData = setup.enemyStats[e.enemyDefinitionId];
                              const enemyName = enemyData?.name_zh ?? e.enemyDefinitionId;
                              return (
                                <div
                                  key={e.instanceId}
                                  className="monster-piece"
                                  style={{ '--occupant-offset': `${ei * 26}px` } as CSSProperties}
                                  title={`${enemyName} · HP ${e.hp}`}
                                >
                                  <img src={monsterPieceAsset(e.enemyDefinitionId, Number(enemyData?.tier ?? 1))} alt={`${enemyName}棋子`} />
                                  <span>HP {e.hp}</span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                      <div className="loc-footer">
                        <div className="location-actions" aria-label={`${meta?.name ?? loc.locationDefinitionId}可用動作`}>
                          {showInvestigate && (
                          <button
                            className={'location-action investigate-action' + (actionFeedback?.key === 'investigate' ? ` ${actionFeedback.status}` : '')}
                            disabled={!canInvestigateHere}
                            onClick={(event) => { event.stopPropagation(); submitCheckIntent('investigate'); }}
                          >
                            <img src="/game-art/ui/investigate-magnifier.png" alt="" />
                            <span>{actionFeedback?.key === 'investigate' ? `${actionFeedback.label}${actionFeedback.status === 'processing' ? '中…' : '失敗'}` : '調查此地點'}</span>
                          </button>
                        )}
                          {showMove && (
                          <button
                            className={'location-action move-action' + (actionFeedback?.key === 'move' ? ` ${actionFeedback.status}` : '')}
                            disabled={!canMoveHere}
                            onClick={(event) => { event.stopPropagation(); submitIntent('move', { targetLocationId: loc.locationDefinitionId }); }}
                          >
                            <img src="/game-art/ui/move-footsteps.png" alt="" />
                            <span>{actionFeedback?.key === 'move' ? `${actionFeedback.label}${actionFeedback.status === 'processing' ? '中…' : '失敗'}` : `移動到此 · ${moveCost} AP`}</span>
                          </button>
                        )}
                        </div>
                        <div className="loc-clues" aria-label={`此地點有 ${cluesHere} 個線索`}>
                          {Array.from({ length: maxClues }).map((_, i) => (
                            <div key={i} className={'clue-dot' + (i < cluesHere ? ' has-clue' : '')} />
                          ))}
                        </div>
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
          <section className="block-container clickable-block keeper-info hud-plaque agenda-plaque" onClick={() => openModal('keeper')}>
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

          <section className="block-container clickable-block current-act hud-plaque act-plaque" onClick={() => openModal('act')}>
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

        {/* 左下：調查員儀表。所有數字皆為 HTML，木質殼只負責外觀。 */}
        <section className="investigator-dashboard" aria-label="調查員狀態">
          <button className="dashboard-team-button" onClick={() => openModal('team')} title="檢視調查隊伍">
            <img src={playerPawnAsset} alt="" />
            <span>{setup.investigatorName}</span>
          </button>
          <div className="dashboard-vitals">
            <div className="dashboard-meter dashboard-meter-hp" title={`體力 ${investigator.hp}/${investigator.hpMax}`}>
              <span>體力</span>
              <div><i style={{ width: `${Math.max(0, Math.min(100, investigator.hp / investigator.hpMax * 100))}%` }} /></div>
              <strong>{investigator.hp}/{investigator.hpMax}</strong>
            </div>
            <div className="dashboard-meter dashboard-meter-san" title={`理智 ${investigator.san}/${investigator.sanMax}`}>
              <span>理智</span>
              <div><i style={{ width: `${Math.max(0, Math.min(100, investigator.san / investigator.sanMax * 100))}%` }} /></div>
              <strong>{investigator.san}/{investigator.sanMax}</strong>
            </div>
          </div>
          <button className="dashboard-hand-button" onClick={() => openPanel('hand')} title="開啟手牌">
            <span>手牌</span><strong>{investigator.hand.length}</strong>
          </button>
        </section>

        {/* === Block 5 右滿高敘事 LOG === */}
        <aside className={'narrative-log' + (isCardLab ? ' lab-log' : '') + (logCollapsed ? ' collapsed' : '')}>
          <div className="log-title">
            <button className="log-title-toggle" onClick={() => setLogCollapsed((v) => !v)}>
              <span>{isCardLab ? '實驗紀錄' : '戰役紀錄'}</span>
              <span>{logCollapsed ? '▼' : '▲'}</span>
            </button>
            {isCardLab && (
              <div className="lab-log-actions">
                <button onClick={() => void copyCardLabLog()}>{logCopied ? '已複製' : '複製 Log'}</button>
                <button onClick={() => setLog(['──── 卡片良率檢驗所 Log 已清空 ────'])}>清空</button>
              </div>
            )}
          </div>

          <div className="log-scroll-area">
            {log.map((line, i) => (
              <div className="log-entry" key={i}>
                <div className="log-content">{line}</div>
              </div>
            ))}
          </div>

          <div className="log-preview" onClick={() => setLogCollapsed(false)}>
            {logStatusRows.map((row) => (
              <div className={'log-status-row' + (row.waiting ? ' waiting' : '')} key={row.id}>
                <div className="log-status-name">{row.name}</div>
                <div className="log-status-line">{row.line}</div>
              </div>
            ))}
          </div>
        </aside>

        {/* === 階段控制(浮在地圖上方,需要時才出現)=== */}
        <div className="phase-control">
          <div className="phase-info">
            T{turnNumber} · {PHASE_LABEL[phase]} · 行動點 {investigator.actionPoints}
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
          {phase === 'investigator' && turnOpeningChoice === 'pending' && !isDowned(investigator) && !investigator.dead && (
            <div className="phase-buttons turn-opening-choice">
              <button onClick={takePlayerShortRest} title="放棄本回合全部行動，將棄牌堆洗回牌庫">進行短休息</button>
              <button onClick={beginPlayerActions}>開始行動</button>
            </div>
          )}
          {phase === 'investigator' && turnOpeningChoice === 'actions' && investigator.actionPoints > 0 && !playerShortRested && !isDowned(investigator) && !investigator.dead && (
            <div className="phase-buttons">
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
              <button
                className={actionFeedback?.key === 'gain_resource' ? actionFeedback.status : ''}
                disabled={Boolean(actionFeedback)}
                onClick={() => submitIntent('gain_resource')}
              >{actionFeedback?.key === 'gain_resource' ? `${actionFeedback.label}${actionFeedback.status === 'processing' ? '中…' : '失敗'}` : '拿資源'}</button>
              <button
                className={actionFeedback?.key === 'draw_card' ? actionFeedback.status : ''}
                disabled={Boolean(actionFeedback)}
                onClick={() => submitIntent('draw_card')}
              >{actionFeedback?.key === 'draw_card' ? `${actionFeedback.label}${actionFeedback.status === 'processing' ? '中…' : '失敗'}` : '抽卡'}</button>
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
              {currentSharedAction && sharedActionTarget && (
                <>
                  <span className="commit-chip">
                    {currentSharedAction.name_zh ?? currentSharedAction.code}・線索池 {scenario.objectiveProgress}・本回合 {sharedActionUsed}/{sharedActionLimitCount}
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={Math.max(1, sharedActionMaxAmount)}
                    value={chosenSharedActionAmount}
                    disabled={sharedActionMaxAmount <= 0 || sharedActionUsed >= sharedActionLimitCount}
                    onChange={(e) => setSharedActionAmount(Number(e.target.value))}
                    title="選擇要棄掉的線索數"
                  />
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, sharedActionMaxAmount)}
                    value={chosenSharedActionAmount}
                    disabled={sharedActionMaxAmount <= 0 || sharedActionUsed >= sharedActionLimitCount}
                    onChange={(e) => setSharedActionAmount(Number(e.target.value))}
                    title="選擇要棄掉的線索數"
                  />
                  <button
                    className="attack"
                    disabled={!canUseSharedAction}
                    onClick={() => submitIntent('use_shared_action', {
                      code: currentSharedAction.code,
                      amount: chosenSharedActionAmount,
                    })}
                  >
                    📜 {currentSharedAction.name_zh ?? '揭穿傳說'}({chosenSharedActionAmount} 線索→{Math.round(chosenSharedActionAmount * sharedActionRatio * 100) / 100} 傷害)
                  </button>
                </>
              )}
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
            </div>
          )}
          {phase === 'investigator' && turnOpeningChoice === 'actions' && investigator.actionPoints === 0 && !playerShortRested && !isDowned(investigator) && !investigator.dead && (
            <div className="phase-buttons phase-buttons-end-only">
              <button onClick={enterMythosPhase}>結束調查員階段 →</button>
            </div>
          )}
          {phase === 'mythos' && (
            <div className="phase-buttons">
              <span className="commit-chip">敵人與城主正在結算...</span>
            </div>
          )}
        </div>

      </div>

      {(keeperNoticeVisible || roundTransition === 'supply' || roundTransition === 'ready' || roundTransition === 'new_round') && (
        <div className="phase-notice" role="status" aria-live="assertive">
          <div className="phase-notice-mark" aria-hidden />
          <strong>
            {keeperNoticeVisible
              ? '有神秘的事情發生了！'
              : roundTransition === 'supply'
                ? lastUpkeepCardName
                  ? `抽到了「${lastUpkeepCardName}」，獲得一個資源`
                  : '抽一張牌，獲得一個資源'
                : roundTransition === 'ready'
                  ? '所有已橫置的卡片恢復可使用'
                  : '新的回合開始了！'}
          </strong>
        </div>
      )}

      {screenToast && (
        <div className={`screen-toast ${screenToast.tone}`} role="status" aria-live="assertive" key={screenToast.id}>
          {screenToast.text}
        </div>
      )}

      {isCardLab && cardLabWorkbenchOpen && (
        <CardLabWorkbench
          initialCards={setup.cardLabCatalog ?? []}
          handIds={investigator.hand}
          onAddCard={addCardToLabHand}
          onClose={() => setCardLabWorkbenchOpen(false)}
        />
      )}

      {pilePanel && (
        <div className="modal-backdrop active" onClick={(event) => { if (event.target === event.currentTarget) setPilePanel(null); }}>
          <section className="modal-frame pile-panel" aria-label={visiblePileTitle}>
            <button className="card-detail-close" aria-label="關閉" onClick={() => setPilePanel(null)}>×</button>
            <div className="modal-title">{visiblePileTitle} · {visiblePile.length} 張</div>
            <div className="pile-card-grid">
              {visiblePile.map((id, index) => {
                const card = cardMeta[id];
                return (
                  <article className="pile-card" key={`${id}-${index}`}>
                    <strong>{card?.name ?? id}</strong>
                    <small>{card?.desc || '目前沒有可顯示的卡片敘述'}</small>
                  </article>
                );
              })}
              {visiblePile.length === 0 && <div className="empty-note">此區目前沒有卡片。</div>}
            </div>
          </section>
        </div>
      )}

      {handLimitSelection && (
        <div className="modal-backdrop active hand-limit-backdrop">
          <section className="modal-frame hand-limit-modal" aria-label="選擇棄牌">
            <div className="modal-title">手牌超過上限</div>
            <p>目前 {investigator.hand.length} 張，請選擇 {handLimitSelection.required} 張棄掉。</p>
            <div className="hand-limit-selected" aria-label="待棄牌">
              {handLimitSelection.selectedIds.length === 0 && <span>點選下方卡片，選中的牌會移到這裡。</span>}
              {handLimitSelection.selectedIds.map((id) => {
                const card = cardMeta[id];
                return <button key={id} onClick={() => toggleHandLimitCard(id)}><strong>{card?.name ?? id}</strong><small>取消選擇</small></button>;
              })}
            </div>
            <div className="hand-limit-grid">
              {handCards.filter((card) => !handLimitSelection.selectedIds.includes(card.id)).map((card) => (
                <button key={card.id} onClick={() => toggleHandLimitCard(card.id)}>
                  <span>{card.cost}</span><strong>{card.name}</strong><small>{card.desc || '查看卡片內容'}</small>
                </button>
              ))}
            </div>
            <div className="action-row">
              <span>已選 {handLimitSelection.selectedIds.length}/{handLimitSelection.required}</span>
              <button disabled={handLimitSelection.selectedIds.length !== handLimitSelection.required} onClick={confirmHandLimitDiscard}>確認棄牌</button>
            </div>
          </section>
        </div>
      )}

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

      {/* === 底部 Panel(手牌:點卡 → 放大檢視 + 打出/消耗/投入)=== */}
      {panel === 'hand' && (
        <div className="bottom-panel active">
          <div className="panel-close" onClick={() => setPanel(null)}>[✕ 關閉]</div>
          <div className="panel-title">手牌 ({handCards.length}) · 點卡片 = 放大查看</div>
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
                  onClick={() => setZoomCard(card)}
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

      {/* === 卡片放大檢視(點手牌卡 → 放大看內容 + 打出/消耗/投入加值)=== */}
      {zoomCard && (() => {
        const d: CardData | undefined = setup.cardLookup[zoomCard.id];
        const playable = !!(d?.card_type && d.card_type !== 'skill');
        const consumable = !!d?.consume_enabled;
        const effects = d?.effects ?? [];
        const effectGroups = [
          { key: 'action', title: '行動效果', items: effects.filter((f) => f.trigger_type === 'action') },
          { key: 'passive', title: '被動效果', items: effects.filter((f) => f.trigger_type === 'passive') },
          { key: 'reaction', title: '反應效果', items: effects.filter((f) => f.trigger_type === 'reaction') },
          { key: 'other', title: '其他效果', items: effects.filter((f) => !['action', 'passive', 'reaction'].includes(String(f.trigger_type))) },
        ].filter((group) => group.items.length > 0);
        const maxUses = cardMaxUses(d);
        const usesLeft = investigator.assetState?.[zoomCard.id]?.usesLeft;
        const subtypeText = Array.isArray(d?.subtypes) ? d.subtypes.map(String).filter(Boolean).join(' / ') : '';
        const isWeaponLike = !!d?.combat_style
          || (d?.card_type === 'asset' && d?.damage != null && Number(d.damage) > 0);
        const weaponBits = isWeaponLike
          ? [
              d?.combat_style ? `風格 ${d.combat_style}` : '',
              d?.damage != null && Number(d.damage) > 0 ? `傷害 ${d.damage}` : '',
              d?.damage_element ? `元素 ${d.damage_element}` : '',
            ].filter(Boolean)
          : [];
        const allyBits = [
          d?.ally_hp != null ? `HP ${d.ally_hp}` : '',
          d?.ally_san != null ? `SAN ${d.ally_san}` : '',
          d?.damage != null && d.card_type === 'ally' ? `攻擊 ${d.damage}` : '',
        ].filter(Boolean);
        const flavor = d?.flavor_text_zh ?? d?.flavor_zh ?? '';
        return (
          <div className="modal-backdrop active" onClick={(e) => { if (e.target === e.currentTarget) setZoomCard(null); }}>
            <div className="modal-frame card-detail-modal">
              <button className="card-detail-close" aria-label="關閉卡片" title="關閉" onClick={() => setZoomCard(null)}>×</button>
              <div className={'card-detail rarity-' + zoomCard.rarity}>
                <div className="card-detail-head">
                  <div>
                    <div className="card-detail-name">{zoomCard.name}</div>
                    <div className="card-detail-meta">
                      <span>{CARD_TYPE_LABEL[String(d?.card_type ?? '')] ?? '未知類型'}</span>
                      <span>{d?.faction_code ?? d?.faction ?? '無陣營'}</span>
                      {subtypeText && <span>{subtypeText}</span>}
                    </div>
                  </div>
                  <div className="card-detail-cost">{zoomCard.cost}</div>
                </div>
                <div className="card-detail-desc">{d?.description_zh ?? zoomCard.desc}</div>
                <div className="card-chip-row">
                  <span className="card-chip">投入: {commitIconText(d)}</span>
                  {maxUses != null && (
                    <span className="card-chip">
                      {d?.ammo != null ? '彈藥' : d?.is_talisman ? (d.break_charge_label ?? '充能') : '使用'}:
                      {' '}{usesLeft ?? maxUses}/{maxUses}
                    </span>
                  )}
                  {allyBits.length > 0 && <span className="card-chip">盟友 {allyBits.join(' / ')}</span>}
                  {weaponBits.length > 0 && <span className="card-chip">武器 {weaponBits.join(' / ')}</span>}
                </div>
                <div className="card-detail-body">
                  {effectGroups.length > 0
                    ? effectGroups.map((group) => (
                        <section className="card-effect-section" key={group.key}>
                          <div className="card-effect-title">{group.title}</div>
                          {group.items.map((effect, index) => (
                            <div className="card-effect-line" key={index}>
                              {effect.description_zh ?? effect.effect_code}
                            </div>
                          ))}
                        </section>
                      ))
                    : <div className="card-empty-effect">此卡目前沒有可顯示的效果條目。</div>}
                </div>
                {d?.card_type === 'skill' && (
                  <div className="card-empty-effect">技能卡不能直接打出;檢定時會自動進入投入時機。</div>
                )}
                {flavor && <div className="card-flavor">{flavor}</div>}
              </div>
              <hr className="modal-divider" />
              <div className="action-row">
                {playable && (
                  <button onClick={() => { submitIntent('play_card', { cardInstanceId: zoomCard.id }); setZoomCard(null); }}>
                    🃏 打出({zoomCard.cost} 資源)
                  </button>
                )}
                {consumable && (
                  <button onClick={() => { submitIntent('consume', { cardInstanceId: zoomCard.id }); setZoomCard(null); }}>
                    ♻ 消耗
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {commitWindow && (() => {
        const selectedBonus = commitWindow.candidates
          .filter((candidate) => commitWindow.selectedIds.includes(candidate.id))
          .reduce((sum, candidate) => sum + candidate.value, 0);
        const baseModifier = commitWindow.attribute
          ? Number(investigator.attributes[commitWindow.attribute] ?? 0)
          : null;
        const beforeChance = estimateChance(commitWindow.dc, baseModifier);
        const afterChance = estimateChance(
          commitWindow.dc,
          baseModifier == null ? null : baseModifier + selectedBonus,
        );
        return (
          <div className="modal-backdrop active">
            <div className="modal-frame commit-window">
              <div className="modal-title">投入加值 · {ACTION_PLAY_TITLE[commitWindow.actionType] ?? commitWindow.actionType}</div>
              <div className="commit-summary">
                <span>檢定: {commitWindow.attribute ? ATTRIBUTE_LABEL[commitWindow.attribute] : '由卡牌/風格決定'}</span>
                <span>DC: {commitWindow.dc ?? '未知'}</span>
                {baseModifier != null && <span>基礎修正: +{baseModifier}</span>}
                {beforeChance && <span>目前估算: {beforeChance}</span>}
                {afterChance && <span>投入後: {afterChance}</span>}
              </div>
              <div className="commit-card-list">
                {commitWindow.candidates.map((candidate) => {
                  const selected = commitWindow.selectedIds.includes(candidate.id);
                  return (
                    <button
                      type="button"
                      key={candidate.id}
                      className={'commit-card-option' + (selected ? ' selected' : '')}
                      onClick={() => togglePendingCommit(candidate.id)}
                    >
                      <span className="commit-card-name">{candidate.name}</span>
                      <span className="commit-card-icons">{candidate.icons}</span>
                      <span className="commit-card-value">+{candidate.value}</span>
                    </button>
                  );
                })}
              </div>
              <hr className="modal-divider" />
              <div className="action-row">
                <button onClick={() => setCommitWindow(null)}>取消行動</button>
                <button onClick={() => confirmCommitWindow([])}>不投入並擲骰</button>
                <button onClick={() => confirmCommitWindow()}>
                  確認投入 {commitWindow.selectedIds.length > 0 ? `+${selectedBonus}` : ''} 並擲骰
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
                <div className="modal-illustration modal-art-alley" role="img" aria-label="雨夜暗巷" />
                <hr className="modal-divider" />
                <div className="modal-narrative">{actionPlay.narration}</div>
                <hr className="modal-divider" />
                <div className="action-row">
                  <button onClick={advanceActionPlay}>{actionPlay.hasCheck ? '開始檢定 →' : '繼續 →'}</button>
                </div>
              </>
            )}
            {actionPlay.beat === 2 && (
              <>
                <div className={'modal-illustration modal-roll' + (actionPlay.rolling ? ' is-rolling' : '')} aria-label={actionPlay.rolling ? '檢定進行中' : '準備檢定'}>
                  <span className="dice-face" aria-hidden><i /><i /><i /></span>
                </div>
                <hr className="modal-divider" />
                <div className="modal-narrative">
                  {actionPlay.rolling
                    ? <div>骰子還在桌上滾動……</div>
                    : actionPlay.checkLines.map((l, i) => <div key={i}>{l}</div>)}
                </div>
                <hr className="modal-divider" />
                <div className="action-row">
                  <button disabled={actionPlay.rolling} onClick={advanceActionPlay}>查看結果 →</button>
                </div>
              </>
            )}
            {actionPlay.beat === 3 && (
              <>
                <div className="modal-illustration modal-result" aria-hidden><span className="result-seal">結</span></div>
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

      {encounterPlay && (
        <div className="modal-backdrop active">
          <div className="modal-frame modal-action-play">
            <div className="modal-title">遭遇 · {encounterPlay.card.name_zh} · {encounterPlay.beat === 1 ? '敘事' : encounterPlay.beat === 2 ? '選項' : '結算'}</div>
            {encounterPlay.beat === 1 && (
              <>
                <div className="modal-illustration modal-art-haunt" role="img" aria-label="深潛者出沒處" />
                <hr className="modal-divider" />
                <div className="modal-narrative">
                  <div>{encounterPlay.sourceLabel}</div>
                  <div>{encounterPlay.card.scenario_text_zh || '一段不該在此刻出現的異常插入了調查。'}</div>
                </div>
                <hr className="modal-divider" />
                <div className="action-row">
                  <span className="encounter-auto-progress">異象正在逼近……</span>
                </div>
              </>
            )}
            {encounterPlay.beat === 2 && (
              <>
                <div className="modal-illustration modal-art-brick" role="img" aria-label="濕滑磚牆上的異常記號" />
                <hr className="modal-divider" />
                <div className="action-row encounter-option-row">
                  {encounterPlay.card.options.map((opt, i) => (
                    <button key={i} onClick={() => chooseEncounterOption(opt)}>
                      {(opt.option_label ? opt.option_label + ' · ' : '') + (opt.option_text_zh || '面對它')}
                    </button>
                  ))}
                </div>
                {encounterTalismanOptions.length > 0 && (
                  <>
                    <hr className="modal-divider" />
                    <div className="action-row encounter-option-row">
                      {encounterTalismanOptions.map((opt) => (
                        <button key={opt.cardInstanceId} onClick={() => chooseEncounterTalisman(opt.cardInstanceId)}>
                          {'法器 · ' + opt.name + ' · ' + (opt.timing === 'instant' ? '即時' : opt.timing === 'test' ? '檢定' : '儲蓄') + ' · 費用 ' + opt.tollCost}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {encounterPlay.beat === 3 && (
              <>
                <div className="modal-illustration modal-result" aria-hidden><span className="result-seal">決</span></div>
                <hr className="modal-divider" />
                <div className="modal-narrative">
                  {encounterPlay.resultLines.length > 0
                    ? encounterPlay.resultLines.map((l, i) => <div key={i}>{l}</div>)
                    : <div>(無額外結果)</div>}
                </div>
                <hr className="modal-divider" />
                <div className="action-row">
                  <span className="encounter-auto-progress">結果已記錄，流程即將繼續……</span>
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
            <div className="modal-illustration modal-art-agenda" role="img" aria-label="城主議程" />
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
                    const cooldownLeft = mythosCooldownRemaining(mc, keeperState);
                    const onCooldown = cooldownLeft > 0;
                    const usedUp = isMythosUsedUp(mc, keeperState);
                    const dormant = !isCardExecutable(mc);
                    const used = mythosUseCount(mc, keeperState);
                    const maxUses = mythosMaxUses(mc);
                    const remaining = mythosUsesRemaining(mc, keeperState);
                    const stateParts = [String(mc.card_category ?? 'general'), String(mc.intensity_tag ?? 'small')];
                    if (dormant) stateParts.push('蟄伏');
                    else if (usedUp) stateParts.push('已用盡');
                    else if (onCooldown) stateParts.push(`冷卻 ${cooldownLeft}`);
                    if (maxUses !== null) stateParts.push(`剩餘 ${remaining}/${maxUses}`);
                    else if (!mc.reusable) stateParts.push(`剩餘 ${remaining}/1`);
                    else if (used > 0) stateParts.push(`已用 ${used}`);
                    else stateParts.push('可重複');
                    return (
                      <div key={mc.id} className={'threat-card' + (dormant || usedUp || onCooldown ? ' threat-card-inactive' : '')}>
                        <div className="threat-card-head">
                          <span className="threat-card-name">{mc.name_zh}</span>
                          <span className="threat-card-cost">{mc.action_cost} 點</span>
                        </div>
                        <div className="threat-card-meta">{stateParts.join(' · ')}</div>
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
            <div className="modal-illustration modal-art-act" role="img" aria-label="調查幕線索板" />
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

      {openingBriefing && (
        <div className="modal-backdrop active opening-briefing-backdrop" role="dialog" aria-modal="true" aria-label="關卡目標說明">
          <section className="modal-frame opening-briefing">
            <div className="opening-eyebrow">關卡開場</div>
            <div className="modal-title">{setup.title}</div>
            <p className="opening-intro">在第一個回合開始前，先確認你們必須完成的目標，以及逼近中的危險。</p>
            <div className="opening-columns">
              <section className="opening-card opening-act-card">
                <div className="opening-card-label">幕 {actIdx + 1} · 調查目標</div>
                <h2>{currentAct?.name ?? '未知目標'}</h2>
                <p>{currentAct?.narrative ?? '本關卡尚未設定幕敘事。'}</p>
                <strong>{currentAct?.conditionDesc || `收集 ${objectiveMax} 個線索，推進下一張幕。`}</strong>
              </section>
              <section className="opening-card opening-agenda-card">
                <div className="opening-card-label">議程 {agendaIdx + 1} · 逼近的危險</div>
                <h2>{currentAgenda?.name ?? '未知議程'}</h2>
                <p>{currentAgenda?.narrative ?? '本關卡尚未設定議程敘事。'}</p>
                <strong>累積 {agendaMax} 個毀滅標記時，議程將推進。</strong>
              </section>
            </div>
            <div className="action-row opening-actions"><button onClick={() => setOpeningBriefing(false)}>開始調查</button></div>
          </section>
        </div>
      )}

      {/* === 右下系統按鈕 + 浮動選單 === */}
      <div className="board-controls">
        <section className="player-economy" aria-label="玩家卡牌與資源資訊">
          <div className="economy-resource"><span>資源</span><strong>{investigator.resources}</strong></div>
          <div className="economy-pile"><span>牌庫</span><strong>{investigator.deck.length}</strong></div>
          <div className="economy-pile"><span>棄牌</span><strong>{investigator.discardPile.length}</strong></div>
          <div className="economy-pile"><span>除外</span><strong>{investigator.removedPile.length}</strong></div>
          <div className="economy-pile"><span>額外</span><strong>{investigator.extraDeck?.length ?? 0}</strong></div>
          <button className="economy-bag" onClick={() => openPanel('bag')} title="開啟背包"><span>背包</span></button>
        </section>
        <button
          className="system-fab"
          onClick={() => setSystemMenuOpen((v) => !v)}
          title="系統選單"
        >
          <span className="system-icon" aria-hidden="true">⌘</span>
          <span>系統</span>
        </button>
      </div>

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
                <h3>設定</h3>
                <p>介面大小只影響固定儀表板、流程控制與戰役紀錄；地圖維持自己的雙指縮放。</p>
                <div className="interface-scale-options" role="group" aria-label="介面大小">
                  {INTERFACE_SCALES.map((scale) => (
                    <button
                      key={scale}
                      className={interfaceScale === scale ? 'selected' : ''}
                      onClick={() => setInterfaceScale(scale)}
                    >
                      {scale === 85 ? '小' : scale === 100 ? '標準' : scale === 115 ? '大' : '特大'} {scale}%
                    </button>
                  ))}
                </div>
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
            <div className="outcome-campaign">
              <div className="outcome-stats-title">戰役結算</div>
              <div className="campaign-reward-grid">
                <div><span>XP</span><strong>+{rewardPreview.xp ?? 0}</strong></div>
                <div><span>天賦點</span><strong>+{rewardPreview.talentPoints ?? 0}</strong></div>
                <div><span>凝聚力</span><strong>{campaignProgress.cohesion}</strong></div>
                <div><span>下一章</span><strong>{campaignProgress.currentChapterNumber}</strong></div>
              </div>
              {rewardPreview.nextChapterVersion && (
                <div className="campaign-settlement-note">
                  分歧版本:{rewardPreview.nextChapterVersion}
                </div>
              )}
              {campaignSettlement && (
                <div className="campaign-settlement-note">
                  長休息完成,整備模式已開放。{playerCarry ? `目前可用 XP:${playerCarry.xp}` : ''}
                </div>
              )}
            </div>
            <hr className="modal-divider" />
            <div className="outcome-stats">
              <div className="outcome-stats-title">調查員數據統計</div>
              <table className="outcome-stats-table">
                <thead>
                  <tr>
                    <th>調查員</th><th>線索</th><th>造成傷害</th><th>賺取資源</th><th>抽卡</th><th>承受傷害</th><th>承受恐懼</th>
                  </tr>
                </thead>
                <tbody>
                  {[{ id: setup.investigator.investigatorId, name: setup.investigatorName },
                    ...setup.aiMembers.map((m) => ({ id: m.investigator.investigatorId, name: m.profile.name_zh })),
                  ].map((row) => {
                    const s = statsRef.current[row.id] ?? makeSixMetric();
                    return (
                      <tr key={row.id}>
                        <td className="outcome-stats-name">{row.name}</td>
                        <td>{s.clues}</td>
                        <td>{s.damage}</td>
                        <td>{s.resources}</td>
                        <td>{s.draws}</td>
                        <td>{s.hp}</td>
                        <td>{s.san}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <hr className="modal-divider" />
            {(outcome.flag_sets ?? []).length > 0 && (
              <div className="outcome-flags">
                戰役記錄:{(outcome.flag_sets ?? []).map((f) => f.flag_code).join('、')}
              </div>
            )}
            <div className="outcome-actions">
              <button disabled={!campaignSettlement} onClick={() => setPreparationOpen(true)}>進入整備</button>
              <button onClick={() => navigate('/lobby')}>回到大廳</button>
              <button onClick={() => window.location.reload()}>再玩一次</button>
            </div>
          </div>
        </div>
      )}

      {preparationOpen && (
        <div className="preparation-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setPreparationOpen(false); }}>
          <div className="preparation-frame">
            <button className="modal-close" onClick={() => setPreparationOpen(false)}>✕</button>
            <div className="modal-title">❖ 整備模式 ❖</div>
            <div className="preparation-summary">
              <div><span>可用 XP</span><strong>{playerCarry?.xp ?? 0}</strong></div>
              <div><span>天賦點</span><strong>{playerCarry?.talentPoints ?? 0}</strong></div>
              <div><span>牌組組成</span><strong>{playerCarry?.deck.length ?? 0}</strong></div>
              <div><span>凝聚力</span><strong>{campaignProgress.cohesion}</strong></div>
            </div>
            <div className="preparation-entry-row">
              <button
                disabled={!setup.talentTree}
                className={talentPanelOpen ? 'active' : ''}
                onClick={() => setTalentPanelOpen((v) => !v)}
              >
                天賦樹
              </button>
              <button
                disabled={visibleTeamSpirits.length === 0}
                className={teamSpiritPanelOpen ? 'active' : ''}
                onClick={() => setTeamSpiritPanelOpen((v) => !v)}
              >
                團隊精神
              </button>
            </div>
            {talentPanelOpen && (
              <div className="talent-panel">
                <div className="talent-panel-head">
                  <div>
                    <div className="talent-panel-title">{setup.talentTree?.name_zh ?? '天賦樹'}</div>
                    <div className="talent-panel-meta">
                      已解鎖 {playerCarry?.talents?.unlockedNodeIds?.length ?? 0} / {visibleTalentNodes.length}
                    </div>
                  </div>
                </div>
                <div className="talent-node-list">
                  {visibleTalentNodes.length === 0 && (
                    <div className="preparation-empty">目前沒有天賦節點資料。</div>
                  )}
                  {visibleTalentNodes.map((node) => {
                    const unlocked = playerCarry?.talents?.unlockedNodeIds?.includes(node.id) ?? false;
                    const check = canUnlockTalentNode(playerCarry, setup.talentTree, node);
                    const branchLabel = node.branch_index ? `分支 ${node.branch_index}` : '主幹';
                    return (
                      <div
                        className={'talent-node-card' + (unlocked ? ' talent-node-unlocked' : '')}
                        key={node.id}
                      >
                        <div>
                          <div className="talent-node-name">{node.name_zh ?? node.node_type}</div>
                          <div className="talent-node-meta">
                            Lv.{node.level} · {branchLabel} · {node.node_type} · {node.talent_point_cost ?? 1} 點
                          </div>
                          {node.description_zh && <div className="talent-node-desc">{node.description_zh}</div>}
                        </div>
                        <button disabled={!check.ok} onClick={() => investTalentNode(node.id)}>
                          {check.ok ? '解鎖' : talentUnlockBlockLabel(check.reason)}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {teamSpiritPanelOpen && (
              <div className="talent-panel team-spirit-panel">
                <div className="talent-panel-head">
                  <div>
                    <div className="talent-panel-title">團隊精神</div>
                    <div className="talent-panel-meta">
                      已採用 {adoptedSpiritCount} / 7 · 效果 {teamSpiritProgress?.effectSnapshots?.length ?? 0}
                    </div>
                  </div>
                </div>
                <div className="talent-node-list">
                  {visibleTeamSpirits.length === 0 && (
                    <div className="preparation-empty">目前沒有團隊精神資料。</div>
                  )}
                  {visibleTeamSpirits.map((spirit) => {
                    const investment = teamSpiritProgress?.investments?.[spirit.code];
                    const adopted = !!investment;
                    const points = investment?.points ?? 0;
                    const adoptCheck = canAdoptTeamSpirit(campaignProgress, spirit);
                    const investCheck = canInvestTeamSpirit(campaignProgress, spirit);
                    const depthEffect = (spirit.depth_effects ?? []).find((d) => Number(d.depth) === Math.min(5, points + 1));
                    return (
                      <div
                        className={'talent-node-card team-spirit-card' + (adopted ? ' talent-node-unlocked' : '')}
                        key={spirit.id}
                      >
                        <div>
                          <div className="talent-node-name">{spirit.name_zh ?? spirit.code}</div>
                          <div className="talent-node-meta">
                            {spirit.category ?? 'team'} · {adopted ? `${points}/5` : '未採用'}
                            {points >= 5 ? ' · 里程碑' : ''}
                          </div>
                          <div className="talent-node-desc">
                            {depthEffect?.effect_desc_zh ?? spirit.description ?? spirit.adopt_effect_zh ?? ''}
                          </div>
                        </div>
                        {!adopted ? (
                          <button disabled={!adoptCheck.ok} onClick={() => adoptSpirit(spirit)}>
                            {adoptCheck.ok ? '採用 1' : teamSpiritBlockLabel(adoptCheck.reason)}
                          </button>
                        ) : (
                          <button disabled={!investCheck.ok} onClick={() => investSpirit(spirit)}>
                            {investCheck.ok ? '投入 1' : teamSpiritBlockLabel(investCheck.reason)}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <hr className="modal-divider" />
            <div className="preparation-list">
              {visibleUpgradeCards.length === 0 && (
                <div className="preparation-empty">目前沒有可購買的升級卡池資料。</div>
              )}
              {visibleUpgradeCards.map((card) => {
                const check = canPurchasePreparationCard(playerCarry, card);
                const cost = preparationCardXpCost(card);
                return (
                  <div className="preparation-card" key={card.id}>
                    <div>
                      <div className="preparation-card-name">{card.name_zh ?? card.code ?? card.id}</div>
                      <div className="preparation-card-meta">
                        {card.faction ?? 'N'} · {card.card_type ?? 'card'} · ★{card.starting_xp ?? 0}{card.is_exceptional ? ' · 卓越' : ''}
                      </div>
                    </div>
                    <button disabled={!check.ok} onClick={() => buyPreparationCard(card)}>
                      {check.ok ? `${cost} XP` : purchaseBlockLabel(check.reason)}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="outcome-actions">
              <button onClick={() => setPreparationOpen(false)}>完成整備</button>
              <button onClick={() => navigate('/departure')}>前往世界地圖</button>
              <button onClick={() => navigate('/lobby')}>前往大廳</button>
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
                const pawnAsset = idx === 0
                  ? playerPawnAsset
                  : pawnAssetForInvestigator({
                    code: setup.aiMembers[idx - 1]?.profile.templateCode,
                    title_zh: setup.aiMembers[idx - 1]?.profile.title_zh,
                  }, idx);
                return (
                  <div key={inv.investigatorId} className={'team-card tc-' + (idx + 1)}>
                    <div className={'team-avatar ta-' + (idx + 1)}><img src={pawnAsset} alt="" /></div>
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
