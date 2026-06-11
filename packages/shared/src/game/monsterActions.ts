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
import type { InvestigatorState, ScenarioState, EnemyInstance, LocationInstance } from './state';
import { resolveCheck } from './checks';
import type { AttributeKey } from './checks';

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
  move_pool?: Array<{ code: string; weight?: number }>;
  hp_base?: number;
  hp_per_player?: number;
}
export type EnemyDataLookup = Record<string, EnemyData>;

export interface AttackCardData {
  code: string;
  name_zh?: string;
  defense_attribute?: string;
  dc_override?: number | null;
  damage_physical?: number;
  damage_horror?: number;
}
export type AttackCardLookup = Record<string, AttackCardData>;

const VALID_ATTRS = new Set([
  'strength', 'agility', 'constitution', 'reflex',
  'intellect', 'willpower', 'perception', 'charisma',
]);

function asAttr(value: unknown, fallback: AttributeKey): AttributeKey {
  const v = String(value ?? '');
  return (VALID_ATTRS.has(v) ? v : fallback) as AttributeKey;
}

// ─── 地點距離(§10.6 最短路徑,BFS 跳數)─────────
export function locationDistance(
  locations: LocationInstance[],
  from: string,
  to: string,
): number {
  if (from === to) return 0;
  const adjacency = new Map(locations.map((l) => [l.locationDefinitionId, l.connectedTo]));
  const seen = new Set([from]);
  let frontier = [from];
  let dist = 0;
  while (frontier.length > 0) {
    dist += 1;
    const next: string[] = [];
    for (const cur of frontier) {
      for (const n of adjacency.get(cur) ?? []) {
        if (seen.has(n)) continue;
        if (n === to) return dist;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return Infinity;
}

/** §10.6:朝目標最短路徑走 1 格;多條等距隨機選一 */
export function stepToward(
  locations: LocationInstance[],
  from: string,
  to: string,
  rng: () => number,
): string {
  if (from === to) return from;
  const current = locations.find((l) => l.locationDefinitionId === from);
  if (!current) return from;
  let best: string[] = [];
  let bestDist = Infinity;
  for (const n of current.connectedTo) {
    const d = locationDistance(locations, n, to);
    if (d < bestDist) {
      bestDist = d;
      best = [n];
    } else if (d === bestDist) {
      best.push(n);
    }
  }
  if (best.length === 0 || bestDist === Infinity) return from;
  return best[Math.floor(rng() * best.length)];
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
    const check = resolveCheck(dc, { attribute: inv.attributes.willpower }, rng);
    inv = { ...inv, triggeredHorrorChecks: [...inv.triggeredHorrorChecks, enemy.instanceId] };
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
      const fear = Number(data.fear_value ?? 1);
      inv = { ...inv, san: Math.max(0, inv.san - fear) };
      effects.push({
        type: 'fear_damage',
        params: { amount: fear, narrative: '那形體烙進你的腦海,理智發出抗議。' },
        targetId: enemy.instanceId,
      });
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
    const phys = Number(data.damage_physical ?? 1);
    const horror = Number(data.damage_horror ?? 0);
    inv = {
      ...inv,
      hp: Math.max(0, inv.hp - phys),
      san: Math.max(0, inv.san - horror),
    };
    effects.push({
      type: 'attack_of_opportunity',
      params: {
        physical: phys, horror,
        narrative: '你轉身的瞬間,' + (data.name_zh ?? '牠') + '的攻擊落在你身上。',
      },
      targetId: enemyId,
    });
  }
  return { investigator: inv, effects };
}

// ─── 怪物攻擊(玩家擲防禦,§10.1)─────────────────
function weightedPickMove(
  movePool: Array<{ code: string; weight?: number }>,
  attackCards: AttackCardLookup,
  rng: () => number,
): AttackCardData | null {
  const entries = movePool.filter((m) => attackCards[m.code]);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, m) => s + Number(m.weight ?? 1), 0);
  let pick = rng() * total;
  for (const m of entries) {
    pick -= Number(m.weight ?? 1);
    if (pick <= 0) return attackCards[m.code];
  }
  return attackCards[entries[entries.length - 1].code];
}

function monsterAttackOnce(
  enemy: EnemyInstance,
  data: EnemyData,
  investigator: InvestigatorState,
  attackCards: AttackCardLookup,
  rng: () => number,
): { investigator: InvestigatorState; effects: ResultEffect[] } {
  const card = data.move_pool?.length ? weightedPickMove(data.move_pool, attackCards, rng) : null;
  const defAttr = asAttr(card?.defense_attribute, 'reflex');
  const dc = Number(card?.dc_override ?? data.dc ?? 10);
  const phys = Number(card?.damage_physical ?? data.damage_physical ?? 1);
  const horror = Number(card?.damage_horror ?? data.damage_horror ?? 0);

  const check = resolveCheck(dc, { attribute: investigator.attributes[defAttr] }, rng);
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
  let inv = investigator;
  if (check.outcome === 'fail') {
    inv = {
      ...inv,
      hp: Math.max(0, inv.hp - phys),
      san: Math.max(0, inv.san - horror),
    };
    effects.push({
      type: 'monster_attack_hit',
      params: { physical: phys, horror, narrative: '你沒能躲開。' },
      targetId: enemy.instanceId,
    });
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

    // 目標:單人 = 唯一活著的調查員(§10.5 偏好系統多人時展開)
    const target = Object.values(invs).find((i) => !i.permanentlyDead && (i.hp > 0 || i.san > 0));
    if (!target) break;

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
      // §10.3 已交戰 → 攻擊(§10.4 attacks_per_round)
      const times = Math.max(1, Number(data.attacks_per_round ?? 1));
      let inv = engagedTarget;
      for (let i = 0; i < times; i += 1) {
        if (inv.hp <= 0) break;
        const r = monsterAttackOnce(enemy, data, inv, attackCards, rng);
        inv = r.investigator;
        effects.push(...r.effects);
      }
      invs[inv.investigatorId] = inv;
      continue;
    }

    // §10.3 未交戰 → 朝目標移動(movement_speed 格),到達 → 交戰
    const speed = Math.max(1, Number(data.movement_speed ?? 1));
    let pos = enemy.locationId;
    for (let step = 0; step < speed && pos !== target.currentLocationId; step += 1) {
      pos = stepToward(sc.locations, pos, target.currentLocationId ?? pos, rng);
    }
    if (pos !== enemy.locationId) {
      sc = {
        ...sc,
        enemies: sc.enemies.map((e) =>
          e.instanceId === enemy.instanceId ? { ...e, locationId: pos } : e,
        ),
      };
      effects.push({
        type: 'monster_move',
        params: { enemy: data.name_zh ?? enemy.enemyDefinitionId, to: pos },
        targetId: enemy.instanceId,
      });
    }
    if (pos === target.currentLocationId) {
      // 進入交戰 + 恐懼檢定(§7.6 怪物進入你的地點)
      sc = {
        ...sc,
        enemies: sc.enemies.map((e) =>
          e.instanceId === enemy.instanceId
            ? { ...e, engagedWith: [...e.engagedWith, target.investigatorId] }
            : e,
        ),
      };
      let inv = {
        ...invs[target.investigatorId],
        engagedWith: [...invs[target.investigatorId].engagedWith, enemy.instanceId],
      };
      effects.push({
        type: 'monster_engage',
        params: { enemy: data.name_zh ?? enemy.enemyDefinitionId, narrative: '牠纏上了你。' },
        targetId: enemy.instanceId,
      });
      const fear = runFearChecks(inv, sc, enemyData, rng);
      inv = fear.investigator;
      effects.push(...fear.effects);
      invs[inv.investigatorId] = inv;
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
