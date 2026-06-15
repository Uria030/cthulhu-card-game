/**
 * G-02 引擎核心 — 怪物行動(§7.2/7.6/7.7 + §10 敵人 AI 行為)
 *
 * 權威依據:
 * - §10.1 所有檢定由玩家擲骰(怪物攻擊 = 玩家擲防禦檢定)
 * - §10.2 行動順序:位階高→低(titan→boss→elite→threat→minion),同位階依生成順序
 * - §10.3 已交戰 → 攻擊;未交戰 → 朝目標移動 1 格,到達有調查員地點 → 交戰
 * - §10.4 攻擊次數 attacks_per_round / §10.5 偏好(單人簡化為唯一目標) / §10.6 最短路徑
 * - §7.6 恐懼檢定:第一次看到怪物(互相進入),意志檢定,失敗受恐懼值 SAN 傷害
 * - §7.7 恐懼半徑與恐懼值獨立;每隻怪對每位調查員只觸發一次(triggeredHorrorChecks)
 * - §7.2 藉機攻擊:交戰中執行非攻擊/閃避 → 物理 + 恐懼雙重傷害
 * - 招式:怪物從 move_pool 加權抽 1 張招式卡(defense_attribute + dc_override + 傷害),
 *   玩家擲 d20 + 防禦屬性 vs DC;無招式池時用怪物本體數值(防禦屬性 fallback reflex)
 *
 * 瀕死系統(§9)未接:HP/SAN 夾 0,歸零先以敘事呈現,瀕死檢定後續批次。
 */
import type { ResultEffect } from './messages';
import type { InvestigatorState, ScenarioState, EnemyInstance } from './state';
import { resolveCheck } from './checks';
import type { AttributeKey } from './checks';
import { modifyIncomingDamage, applyCheckStatus, tickEnemyStatus, normalizeElement } from './statusEffects';
import { applyIncomingDamageToPlayer } from './ally';
import {
  locationDistance,
  stepToward,
  pickMoveByBehavior,
  pickTargetByPreference,
} from './monsterBehavior';
import type { AttackCardData, AttackCardLookup, BehaviorScript } from './monsterBehavior';

// 尋路工具與招式卡型別移居 monsterBehavior(避免循環引用),這裡 re-export 維持既有 import 路徑
export { locationDistance, stepToward } from './monsterBehavior';
export type { AttackCardData, AttackCardLookup } from './monsterBehavior';

// ─── 資料形狀(bootstrap monsters / monster_attack_cards 餵入)───
export interface EnemyData {
  name_zh?: string;
  dc?: number;
  damage_physical?: number;
  damage_horror?: number;
  fear_value?: number;
  fear_radius?: number;
  fear_type?: string;
  tier?: number;
  attacks_per_round?: number;
  movement_speed?: number;
  ai_preference?: string;
  ai_preference_param?: string;
  move_pool?: Array<{ code: string; weight?: number }>;
  hp_base?: number;
  hp_per_player?: number;
  /** 行為腳本層(s14 補充文件 #2):出招模式 + 腳本 */
  move_pattern?: string;
  behavior_script?: BehaviorScript | null;
  /** 功能標籤(agenda_pusher 存在即推毀滅等) */
  keywords?: unknown[];
  /** 家族代碼(召喚決策用) */
  family_code?: string;
  /** 法術防禦值(ch2 §5.3：0-9，決定施法副作用嚴重度；不影響法術傷害) */
  spell_defense?: number;
  /** §11.4 防禦詞綴:免疫元素(歸 0)/ 抗性元素清單 / 各元素抗性減免點數 */
  immunities?: string[];
  resistances?: string[];
  resistance_values?: Record<string, number>;
}
export type EnemyDataLookup = Record<string, EnemyData>;

/**
 * §11.3 死亡效果詞綴:怪物被擊敗後,**同地點其他調查員**做閃避檢定(reflex vs 怪 DC),
 * 失敗則 crush → 物理傷害 / curse_on_death → 恐懼傷害(各走 modifyIncomingDamage)。
 * v0 簡化:不含擊殺者本人(其狀態在攻擊路徑已結算);回傳更新後的調查員(供 updatedAllies)+ 效果。
 */
export function resolveDeathKeywords(
  defeated: EnemyInstance,
  enemyData: EnemyData | undefined,
  others: Record<string, InvestigatorState>,
  rng: () => number = Math.random,
): { investigators: Record<string, InvestigatorState>; effects: ResultEffect[] } {
  const effects: ResultEffect[] = [];
  const updated: Record<string, InvestigatorState> = {};
  const keywords = (enemyData?.keywords ?? []).map((k) => String(k));
  const hasCrush = keywords.includes('crush');
  const hasCurse = keywords.includes('curse_on_death');
  if (!hasCrush && !hasCurse) return { investigators: updated, effects };

  const dc = Number(enemyData?.dc ?? 10);
  const name = enemyData?.name_zh ?? defeated.enemyDefinitionId;
  for (const id of Object.keys(others)) {
    const inv = others[id];
    if (!inv || inv.hp <= 0 || inv.currentLocationId !== defeated.locationId) continue;
    const cs = applyCheckStatus(inv.statusEffects);
    const check = resolveCheck(dc, { attribute: inv.attributes.reflex }, rng, cs.rollMode);
    let next: InvestigatorState = { ...inv, statusEffects: cs.statusEffects };
    if (check.outcome === 'fail') {
      if (hasCrush) {
        const dmg = modifyIncomingDamage(next.statusEffects, Number(enemyData?.damage_physical ?? 1), 0).physical;
        const ad = applyIncomingDamageToPlayer(next, dmg, 0); // §11 盟友先吸
        next = ad.investigator;
        effects.push({ type: 'crush_damage', params: { amount: dmg, narrative: name + '崩塌的軀體壓了下來。' }, targetId: id });
        effects.push(...ad.effects);
      }
      if (hasCurse) {
        const dmg = modifyIncomingDamage(next.statusEffects, 0, Number(enemyData?.damage_horror ?? 1)).horror;
        const ad = applyIncomingDamageToPlayer(next, 0, dmg); // §11 盟友先吸
        next = ad.investigator;
        effects.push({ type: 'curse_damage', params: { amount: dmg, narrative: name + '的死亡詛咒鑽進你的腦海。' }, targetId: id });
        effects.push(...ad.effects);
      }
    } else {
      effects.push({ type: 'death_keyword_evaded', params: { narrative: '你及時退開了。' }, targetId: id });
    }
    updated[id] = next;
  }
  return { investigators: updated, effects };
}

/**
 * §11.3 鬧鬼(haunting):怪物被擊敗時,若帶 haunting 詞綴 → 在其地點留下附著記錄。
 * 之後該地點調查失敗時由 reviveHaunting 復活(任何致死手段都附著)。
 */
export function applyHaunting(scenario: ScenarioState, enemy: EnemyInstance, enemyData: EnemyData | undefined): ScenarioState {
  const kw = (enemyData?.keywords ?? []).map((k) => String(k));
  if (!kw.includes('haunting')) return scenario;
  return {
    ...scenario,
    hauntings: [...(scenario.hauntings ?? []), { locationId: enemy.locationId, enemyDefinitionId: enemy.enemyDefinitionId }],
  };
}

/**
 * §11.3 鬧鬼復活:在某地點調查失敗時,若該地點有 haunting 附著 → 復活一隻(取第一筆)。
 * 復活的怪帶召喚失調(當回合不行動);移除該筆附著。
 */
export function reviveHaunting(
  scenario: ScenarioState,
  locationId: string,
  enemyData: EnemyDataLookup,
  playerCount = 1,
): { scenario: ScenarioState; effects: ResultEffect[] } {
  const hauntings = scenario.hauntings ?? [];
  const idx = hauntings.findIndex((h) => h.locationId === locationId);
  if (idx < 0) return { scenario, effects: [] };
  const h = hauntings[idx];
  const spawned = spawnEnemy(scenario, h.enemyDefinitionId, locationId, enemyData, playerCount);
  const name = enemyData[h.enemyDefinitionId]?.name_zh ?? h.enemyDefinitionId;
  return {
    scenario: { ...spawned.scenario, hauntings: hauntings.filter((_, i) => i !== idx) },
    effects: [{ type: 'haunting_revive', params: { enemy: name, narrative: '你的搜查驚擾了什麼——' + name + '從陰影裡重新凝聚。' }, targetId: spawned.enemy.instanceId }],
  };
}

/**
 * §11.4 怪物防禦詞綴:免疫該元素 → 傷害歸 0;否則減免 resistance_values[元素] 點(夾 0)。
 * 神秘(arcane)鐵則:任何怪物都不抗/免疫,原樣穿透(設計原則,server validateNoArcane 已擋資料)。
 * resistance_values 為內容缺口時當 0(無減免),機制不壞。
 */
export function enemyDamageAfterDefense(enemy: EnemyData | undefined, element: string | undefined | null, damage: number): number {
  if (!enemy) return damage;
  const el = normalizeElement(element);
  if (el === 'arcane') return damage;
  const immunities = (enemy.immunities ?? []).map((e) => normalizeElement(String(e)));
  if (immunities.includes(el)) return 0;
  const val = Number((enemy.resistance_values ?? {})[el] ?? 0);
  return Math.max(0, damage - val);
}

const VALID_ATTRS = new Set([
  'strength', 'agility', 'constitution', 'reflex',
  'intellect', 'willpower', 'perception', 'charisma',
]);

function asAttr(value: unknown, fallback: AttributeKey): AttributeKey {
  const v = String(value ?? '');
  return (VALID_ATTRS.has(v) ? v : fallback) as AttributeKey;
}

// ─── 恐懼檢定(§7.6/7.7)───────────────────────
export interface FearCheckOutcome {
  investigator: InvestigatorState;
  effects: ResultEffect[];
}

/**
 * 對調查員當前位置掃描所有活著的怪物:
 * 距離 ≤ 恐懼半徑且未對此調查員觸發過 → 意志檢定 vs 怪物 DC,失敗 SAN -恐懼值。
 */
export function runFearChecks(
  investigator: InvestigatorState,
  scenario: ScenarioState,
  enemyData: EnemyDataLookup,
  rng: () => number = Math.random,
): FearCheckOutcome {
  let inv = investigator;
  const effects: ResultEffect[] = [];
  const here = inv.currentLocationId;
  if (!here) return { investigator: inv, effects };

  for (const enemy of scenario.enemies) {
    if (enemy.hp <= 0) continue;
    if (inv.triggeredHorrorChecks.includes(enemy.instanceId)) continue;
    const data = enemyData[enemy.enemyDefinitionId] ?? {};
    const radius = Number(data.fear_radius ?? 1);
    const dist = locationDistance(scenario.locations, here, enemy.locationId);
    if (dist > radius) continue;

    const dc = Number(data.dc ?? 10);
    // §6 強化取好/弱化取差 + 擲骰後減層(玩家防禦擲骰)
    const cs = applyCheckStatus(inv.statusEffects);
    const check = resolveCheck(dc, { attribute: inv.attributes.willpower }, rng, cs.rollMode);
    inv = { ...inv, triggeredHorrorChecks: [...inv.triggeredHorrorChecks, enemy.instanceId], statusEffects: cs.statusEffects };
    effects.push({
      type: 'fear_check',
      params: {
        enemy: data.name_zh ?? enemy.enemyDefinitionId,
        roll: check.roll, total: check.total, dc,
        outcome: check.outcome,
      },
      targetId: enemy.instanceId,
    });
    if (check.outcome === 'fail') {
      // 恐懼=恐懼傷害:套用發瘋/標記(+)、護盾(−)(§6.2/§6.3)
      const { horror: fear } = modifyIncomingDamage(inv.statusEffects, 0, Number(data.fear_value ?? 1));
      const ad = applyIncomingDamageToPlayer(inv, 0, fear); // §11 盟友(精神支柱)先吸
      inv = ad.investigator;
      effects.push({
        type: 'fear_damage',
        params: { amount: fear, narrative: '那形體烙進你的腦海,理智發出抗議。' },
        targetId: enemy.instanceId,
      });
      effects.push(...ad.effects);
    }
  }
  return { investigator: inv, effects };
}

// ─── 藉機攻擊(§7.2)───────────────────────────
export function applyAttackOfOpportunity(
  investigator: InvestigatorState,
  scenario: ScenarioState,
  enemyData: EnemyDataLookup,
): FearCheckOutcome {
  let inv = investigator;
  const effects: ResultEffect[] = [];
  for (const enemyId of investigator.engagedWith) {
    const enemy = scenario.enemies.find((e) => e.instanceId === enemyId && e.hp > 0);
    if (!enemy) continue;
    const data = enemyData[enemy.enemyDefinitionId] ?? {};
    // 受傷狀態修正(中毒/脆弱/標記 + / 護甲/護盾 −,§6)
    const dmg = modifyIncomingDamage(inv.statusEffects, Number(data.damage_physical ?? 1), Number(data.damage_horror ?? 0));
    const ad = applyIncomingDamageToPlayer(inv, dmg.physical, dmg.horror); // §11 盟友先吸
    inv = ad.investigator;
    effects.push({
      type: 'attack_of_opportunity',
      params: {
        physical: dmg.physical, horror: dmg.horror,
        narrative: '你轉身的瞬間,' + (data.name_zh ?? '牠') + '的攻擊落在你身上。',
      },
      targetId: enemyId,
    });
    effects.push(...ad.effects);
  }
  return { investigator: inv, effects };
}

// ─── 怪物攻擊(玩家擲防禦,§10.1;選招交給行為腳本層)──
function monsterAttackOnce(
  enemy: EnemyInstance,
  data: EnemyData,
  card: AttackCardData | null,
  investigator: InvestigatorState,
  rng: () => number,
): { investigator: InvestigatorState; effects: ResultEffect[] } {
  const defAttr = asAttr(card?.defense_attribute, 'reflex');
  const dc = Number(card?.dc_override ?? data.dc ?? 10);
  const phys = Number(card?.damage_physical ?? data.damage_physical ?? 1);
  const horror = Number(card?.damage_horror ?? data.damage_horror ?? 0);

  // §6 強化取好/弱化取差 + 擲骰後減層(玩家防禦擲骰)
  const cs = applyCheckStatus(investigator.statusEffects);
  const check = resolveCheck(dc, { attribute: investigator.attributes[defAttr] }, rng, cs.rollMode);
  const effects: ResultEffect[] = [
    {
      type: 'monster_attack',
      params: {
        enemy: data.name_zh ?? enemy.enemyDefinitionId,
        move: card?.name_zh ?? '撲擊',
        defenseAttribute: defAttr,
        roll: check.roll, total: check.total, dc,
        outcome: check.outcome,
      },
      targetId: enemy.instanceId,
    },
  ];
  let inv: InvestigatorState = { ...investigator, statusEffects: cs.statusEffects };
  if (check.outcome === 'fail') {
    // 受傷狀態修正(§6)
    const dmg = modifyIncomingDamage(inv.statusEffects, phys, horror);
    const ad = applyIncomingDamageToPlayer(inv, dmg.physical, dmg.horror); // §11 盟友先吸
    inv = ad.investigator;
    effects.push({
      type: 'monster_attack_hit',
      params: { physical: dmg.physical, horror: dmg.horror, narrative: '你沒能躲開。' },
      targetId: enemy.instanceId,
    });
    effects.push(...ad.effects);
  } else {
    effects.push({
      type: 'monster_attack_missed',
      params: { narrative: '你在千鈞一髮之際避開了。' },
      targetId: enemy.instanceId,
    });
  }
  return { investigator: inv, effects };
}

// ─── 神話階段怪物啟動(§10.2/10.3)────────────────
export interface ActivationResult {
  scenario: ScenarioState;
  investigators: Record<string, InvestigatorState>;
  effects: ResultEffect[];
}

export function activateMonsters(
  scenario: ScenarioState,
  investigators: Record<string, InvestigatorState>,
  enemyData: EnemyDataLookup,
  attackCards: AttackCardLookup,
  rng: () => number = Math.random,
): ActivationResult {
  let sc = scenario;
  const invs = { ...investigators };
  const effects: ResultEffect[] = [];

  // §10.2:位階高→低,同位階依生成順序(enemies 陣列序即生成序)
  const order = [...sc.enemies]
    .filter((e) => e.hp > 0)
    .sort((a, b) => Number(enemyData[b.enemyDefinitionId]?.tier ?? 1) - Number(enemyData[a.enemyDefinitionId]?.tier ?? 1));

  for (const snapshot of order) {
    const enemy = sc.enemies.find((e) => e.instanceId === snapshot.instanceId);
    if (!enemy || enemy.hp <= 0) continue;
    const data = enemyData[enemy.enemyDefinitionId] ?? {};
    const kw = (data.keywords ?? []).map((k) => String(k)); // §11 詞綴(純字串)

    // §6 怪物狀態結算(燃燒/流血/毀滅持續傷害 + 減層);死亡則不行動
    if (enemy.statusEffects && Object.keys(enemy.statusEffects).length > 0) {
      const tick = tickEnemyStatus(enemy.hp, enemy.statusEffects);
      sc = {
        ...sc,
        enemies: sc.enemies.map((e) =>
          e.instanceId === enemy.instanceId ? { ...e, hp: tick.hp, statusEffects: tick.statusEffects } : e,
        ),
      };
      for (const eff of tick.effects) effects.push({ ...eff, targetId: enemy.instanceId });
      if (tick.hp <= 0) {
        effects.push({ type: 'enemy_defeated', params: { narrative: '牠在持續效果中崩解了。' }, targetId: enemy.instanceId });
        // §11.3 持續效果擊殺也觸發死亡詞綴(crush/curse,與致死手段無關;此處無擊殺者,全地點調查員結算)
        const dk = resolveDeathKeywords(enemy, data, invs, rng);
        for (const [id, updatedInv] of Object.entries(dk.investigators)) invs[id] = updatedInv;
        effects.push(...dk.effects);
        sc = applyHaunting(sc, enemy, data); // §11.3 鬧鬼附著
        continue;
      }
    }

    // 召喚失調(Uria 裁定 2026-06-11):剛被召喚的怪物本回合不啟動,標記用掉即除
    if (enemy.modifiers.includes(SUMMON_SICKNESS)) {
      sc = {
        ...sc,
        enemies: sc.enemies.map((e) =>
          e.instanceId === enemy.instanceId
            ? { ...e, modifiers: e.modifiers.filter((m) => m !== SUMMON_SICKNESS) }
            : e,
        ),
      };
      effects.push({
        type: 'monster_dazed',
        params: {
          enemy: data.name_zh ?? enemy.enemyDefinitionId,
          narrative: '牠剛被拽入這個世界,還在適應雨夜的空氣——本回合不會行動。',
        },
        targetId: enemy.instanceId,
      });
      continue;
    }

    // 目標:依家族追擊偏好(§10.5 + s14 Part2 家族對應;單人 = 唯一目標)
    const target = pickTargetByPreference(
      data.ai_preference,
      data.ai_preference_param,
      enemy,
      Object.values(invs),
      sc.locations,
      rng,
    );
    if (!target) break;

    // 議程型怪物:存在即推進毀滅(s14 功能分類「靠存在推進敗局倒數」)
    if (Array.isArray(data.keywords) && data.keywords.includes('agenda_pusher')) {
      sc = { ...sc, agendaProgress: sc.agendaProgress + 1 };
      effects.push({
        type: 'doom_added',
        params: { amount: 1, total: sc.agendaProgress, source: data.name_zh ?? enemy.enemyDefinitionId },
        targetId: enemy.instanceId,
      });
    }

    // 交戰必須同地點:殘留的跨地點交戰視為已脫離(防衛性清理)
    const staleIds = enemy.engagedWith.filter(
      (id) => !invs[id] || invs[id].currentLocationId !== enemy.locationId,
    );
    if (staleIds.length > 0) {
      sc = {
        ...sc,
        enemies: sc.enemies.map((e) =>
          e.instanceId === enemy.instanceId
            ? { ...e, engagedWith: e.engagedWith.filter((id) => !staleIds.includes(id)) }
            : e,
        ),
      };
      for (const id of staleIds) {
        if (invs[id]) {
          invs[id] = {
            ...invs[id],
            engagedWith: invs[id].engagedWith.filter((eid) => eid !== enemy.instanceId),
          };
        }
      }
    }
    const liveEnemy = sc.enemies.find((e) => e.instanceId === enemy.instanceId) ?? enemy;
    const engagedTarget = liveEnemy.engagedWith
      .map((id) => invs[id])
      .find((i) => i && i.hp > 0 && i.currentLocationId === liveEnemy.locationId);

    if (engagedTarget) {
      // §10.3 已交戰 → 攻擊(§10.4 attacks_per_round);選招走行為腳本層
      // §11.2 巨大 massive:與全地點交戰 → 對每位交戰調查員各攻擊一輪(非 massive 仍只打主目標)
      const attackTargets = kw.includes('massive')
        ? liveEnemy.engagedWith.map((id) => invs[id]).filter((i) => i && i.hp > 0 && i.currentLocationId === liveEnemy.locationId)
        : [engagedTarget];
      const times = Math.max(1, Number(data.attacks_per_round ?? 1));
      for (const t0 of attackTargets) {
        let inv = invs[t0.investigatorId] ?? t0;
        for (let i = 0; i < times; i += 1) {
          if (inv.hp <= 0) break;
          const current = sc.enemies.find((e) => e.instanceId === enemy.instanceId) ?? liveEnemy;
          const pick = pickMoveByBehavior(
            current,
            String(data.move_pattern ?? 'weighted'),
            data.behavior_script ?? null,
            data.move_pool ?? [],
            attackCards,
            {
              turnNumber: sc.turnNumber,
              selfHp: current.hp,
              selfMaxHp: Number(data.hp_base ?? current.hp),
              target: inv,
              rng,
            },
            i === 0, // 冷卻一回合 tick 一次,多段攻擊後續擊不重複遞減
          );
          // 寫回運行時標記(上一招/冷卻/階段)
          sc = {
            ...sc,
            enemies: sc.enemies.map((e) =>
              e.instanceId === enemy.instanceId ? { ...e, modifiers: pick.modifiers } : e,
            ),
          };
          if (pick.phaseChanged) {
            effects.push({
              type: 'monster_phase_change',
              params: {
                enemy: data.name_zh ?? enemy.enemyDefinitionId,
                phase: pick.phaseChanged,
                narrative: '牠的氣息變了——某種更深的東西浮上表面。',
              },
              targetId: enemy.instanceId,
            });
          }
          const r = monsterAttackOnce(enemy, data, pick.card, inv, rng);
          inv = r.investigator;
          effects.push(...r.effects);
        }
        invs[inv.investigatorId] = inv;
      }
      continue;
    }

    // §11.2 冷漠:不主動與調查員交戰 → 未交戰時不逼近
    if (kw.includes('apathetic')) {
      effects.push({ type: 'monster_apathetic', params: { enemy: data.name_zh ?? enemy.enemyDefinitionId, narrative: '牠對你毫無興趣,自顧自地存在著。' }, targetId: enemy.instanceId });
      continue;
    }

    // §11.1 飛行:目標改為敏捷最低的調查員,不走地圖直接放置其地點(「下回合放置」v0 簡化為即時)
    const flying = kw.includes('flying');
    let moveTarget = target;
    if (flying) {
      const lowestAgi = Object.values(invs)
        .filter((i) => i.hp > 0)
        .sort((a, b) => a.attributes.agility - b.attributes.agility)[0];
      if (lowestAgi) moveTarget = lowestAgi;
    }

    // §10.3 未交戰 → 朝目標移動(movement_speed 格;§11.1 快速 swift 移 2 格 / 飛行直接放置),到達 → 交戰
    const speed = Math.max(kw.includes('swift') ? 2 : 1, Number(data.movement_speed ?? 1));
    let pos = enemy.locationId;
    if (flying) {
      pos = moveTarget.currentLocationId ?? pos;
    } else {
      for (let step = 0; step < speed && pos !== moveTarget.currentLocationId; step += 1) {
        pos = stepToward(sc.locations, pos, moveTarget.currentLocationId ?? pos, rng);
      }
    }
    if (pos !== enemy.locationId) {
      sc = {
        ...sc,
        enemies: sc.enemies.map((e) =>
          e.instanceId === enemy.instanceId ? { ...e, locationId: pos } : e,
        ),
      };
      effects.push({
        type: flying ? 'monster_fly' : 'monster_move',
        params: { enemy: data.name_zh ?? enemy.enemyDefinitionId, to: pos, narrative: flying ? '牠展開了不該存在的翼,憑空出現在你面前。' : undefined },
        targetId: enemy.instanceId,
      });
    }
    if (pos === moveTarget.currentLocationId) {
      // 進入交戰 + 恐懼檢定(§7.6)。§11.2 巨大 massive:與地點所有調查員交戰(單一持有者例外,Uria 拍板)
      const isMassive = kw.includes('massive');
      const engagedIds = isMassive
        ? Object.values(invs).filter((i) => i.hp > 0 && i.currentLocationId === pos).map((i) => i.investigatorId)
        : [moveTarget.investigatorId];
      sc = {
        ...sc,
        enemies: sc.enemies.map((e) =>
          e.instanceId === enemy.instanceId ? { ...e, engagedWith: engagedIds } : e,
        ),
      };
      effects.push({
        type: 'monster_engage',
        params: { enemy: data.name_zh ?? enemy.enemyDefinitionId, narrative: isMassive ? '牠龐大的身軀籠罩了整個地點,所有人都被捲入交戰。' : '牠纏上了你。' },
        targetId: enemy.instanceId,
      });
      for (const id of engagedIds) {
        if (!invs[id]) continue;
        let inv = { ...invs[id], engagedWith: [...invs[id].engagedWith, enemy.instanceId] };
        const fear = runFearChecks(inv, sc, enemyData, rng);
        inv = fear.investigator;
        effects.push(...fear.effects);
        invs[id] = inv;
      }
      // §11.2 獵手 hunter:移動後進入交戰 → 立刻額外攻擊一次(對主目標)
      if (kw.includes('hunter') && invs[moveTarget.investigatorId]?.hp > 0) {
        const liveE = sc.enemies.find((e) => e.instanceId === enemy.instanceId) ?? enemy;
        const pick = pickMoveByBehavior(
          liveE, String(data.move_pattern ?? 'weighted'), data.behavior_script ?? null,
          data.move_pool ?? [], attackCards,
          { turnNumber: sc.turnNumber, selfHp: liveE.hp, selfMaxHp: Number(data.hp_base ?? liveE.hp), target: invs[moveTarget.investigatorId], rng }, true,
        );
        sc = { ...sc, enemies: sc.enemies.map((e) => e.instanceId === enemy.instanceId ? { ...e, modifiers: pick.modifiers } : e) };
        effects.push({ type: 'hunter_strike', params: { enemy: data.name_zh ?? enemy.enemyDefinitionId, narrative: '牠撲上來的同時就咬了下去。' }, targetId: enemy.instanceId });
        const hr = monsterAttackOnce(enemy, data, pick.card, invs[moveTarget.investigatorId], rng);
        invs[moveTarget.investigatorId] = hr.investigator;
        effects.push(...hr.effects);
      }
    }
  }
  return { scenario: sc, investigators: invs, effects };
}

/** 召喚失調標記(Uria 裁定:被召喚當回合不啟動) */
export const SUMMON_SICKNESS = 'summon_sickness';

// ─── 生成怪物(城主召喚/初始敵人共用;城主 AI 在階段三接上)──
export function spawnEnemy(
  scenario: ScenarioState,
  variantCode: string,
  locationCode: string,
  enemyData: EnemyDataLookup,
  playerCount = 1,
): { scenario: ScenarioState; enemy: EnemyInstance } {
  const data = enemyData[variantCode] ?? {};
  const hp = Number(data.hp_base ?? 1) + Number(data.hp_per_player ?? 0) * (playerCount - 1);
  const enemy: EnemyInstance = {
    instanceId: 'enemy_' + variantCode + '_' + scenario.enemies.length,
    enemyDefinitionId: variantCode,
    locationId: locationCode,
    hp,
    engagedWith: [],
    modifiers: [SUMMON_SICKNESS],
  };
  return {
    scenario: { ...scenario, enemies: [...scenario.enemies, enemy] },
    enemy,
  };
}
