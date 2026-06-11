/**
 * G-03 引擎核心 — 怪物行為腳本(s14 補充文件 #2「結構化隨機」)
 *
 * 三層結構的第三層:基礎 AI(§10,monsterActions)→ 招式池(方式庫)→ 本層決定
 * 「這個情境下從招式池選哪一招」。
 *
 * v0 支援:
 * - 出招模式四種:pure_random(雜兵)/ weighted(威脅)/ conditional(精英/頭目)/
 *   phase_based(頭目)。scripted_chain / ritual_sequence 留待巨頭戰批次。
 * - 觸發條件:turn_count / hp_percent(自身)/ san_percent(目標玩家)/
 *   last_move / random_chance + and/or 組合(補充文件 §3 子集)
 * - forced 強制招優先 → priority 小者優先 → 同級加權(補充文件 §2.3)
 * - 招式冷卻(cooldown N 回合 / 'permanent' 一場一次)
 * - ai_preference 追擊偏好(§10.5):nearest / lowest_hp / lowest_san /
 *   highest_san(獵清醒者)/ lowest_attr / random;不支援值 fallback nearest
 *
 * 運行時狀態(上一招/冷卻/當前階段)編碼進 EnemyInstance.modifiers
 * (前綴 bs:),不改存檔 schema。
 */
import type { EnemyInstance, InvestigatorState, LocationInstance } from './state';
import type { AttributeKey } from './checks';

/** 招式卡形狀(與 monsterActions.AttackCardData 一致;放這裡避免循環引用) */
export interface AttackCardData {
  code: string;
  name_zh?: string;
  defense_attribute?: string;
  dc_override?: number | null;
  damage_physical?: number;
  damage_horror?: number;
}
export type AttackCardLookup = Record<string, AttackCardData>;

// ─── 地點距離與尋路(§10.6 BFS;原 monsterActions,移此避免循環引用)──
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

// ─── 行為腳本資料形狀(monster_variants.behavior_script JSONB)───
export interface TriggerCondition {
  type: 'turn_count' | 'hp_percent' | 'san_percent' | 'last_move' | 'random_chance' | 'and' | 'or';
  operator?: '=' | '!=' | '<' | '>' | '<=' | '>=';
  value?: number | string;
  /** and / or 組合用 */
  conditions?: TriggerCondition[];
}

export interface BehaviorMoveEntry {
  code: string;
  weight?: number;
  trigger_condition?: TriggerCondition | null;
  priority?: number;
  forced?: boolean;
  /** 數字 = N 回合;'permanent' = 一場一次 */
  cooldown?: number | string | null;
}

export interface BehaviorPhase {
  code: string;
  /** 進入此階段的條件(對自身,如 hp_percent <= 50);第一階段可省略 */
  transition?: TriggerCondition | null;
  moves: BehaviorMoveEntry[];
}

export interface BehaviorScript {
  moves?: BehaviorMoveEntry[];
  phases?: BehaviorPhase[];
}

export interface BehaviorContext {
  turnNumber: number;
  /** 自身當前/最大 HP(hp_percent 用) */
  selfHp: number;
  selfMaxHp: number;
  /** 目標調查員(san_percent 用) */
  target: InvestigatorState;
  rng: () => number;
}

// ─── 運行時標記(EnemyInstance.modifiers 編碼)─────
const LAST_PREFIX = 'bs:last:';
const CD_PREFIX = 'bs:cd:';
const PHASE_PREFIX = 'bs:phase:';

export function getLastMove(enemy: EnemyInstance): string | null {
  const m = enemy.modifiers.find((x) => x.startsWith(LAST_PREFIX));
  return m ? m.slice(LAST_PREFIX.length) : null;
}

export function getCurrentPhase(enemy: EnemyInstance): string | null {
  const m = enemy.modifiers.find((x) => x.startsWith(PHASE_PREFIX));
  return m ? m.slice(PHASE_PREFIX.length) : null;
}

function cooldownLeft(enemy: EnemyInstance, code: string): number {
  for (const m of enemy.modifiers) {
    if (m.startsWith(CD_PREFIX + code + ':')) {
      const v = m.slice((CD_PREFIX + code + ':').length);
      return v === 'permanent' ? Infinity : Number(v);
    }
  }
  return 0;
}

/** 回合開始:冷卻 -1(permanent 不動),回傳新 modifiers */
export function tickCooldowns(modifiers: string[]): string[] {
  const out: string[] = [];
  for (const m of modifiers) {
    if (!m.startsWith(CD_PREFIX)) {
      out.push(m);
      continue;
    }
    const rest = m.slice(CD_PREFIX.length);
    const idx = rest.lastIndexOf(':');
    const code = rest.slice(0, idx);
    const val = rest.slice(idx + 1);
    if (val === 'permanent') {
      out.push(m);
    } else {
      const left = Number(val) - 1;
      if (left > 0) out.push(CD_PREFIX + code + ':' + left);
    }
  }
  return out;
}

/** 出招後:記上一招 + 設冷卻,回傳新 modifiers */
export function recordMoveUse(
  modifiers: string[],
  code: string,
  cooldown: number | string | null | undefined,
): string[] {
  const out = modifiers.filter((m) => !m.startsWith(LAST_PREFIX));
  out.push(LAST_PREFIX + code);
  if (cooldown === 'permanent') {
    out.push(CD_PREFIX + code + ':permanent');
  } else if (Number(cooldown) > 0) {
    out.push(CD_PREFIX + code + ':' + Number(cooldown));
  }
  return out;
}

// ─── 觸發條件求值(補充文件 §3)──────────────────
function compare(actual: number, operator: string | undefined, expected: number): boolean {
  switch (operator ?? '=') {
    case '=': return actual === expected;
    case '!=': return actual !== expected;
    case '<': return actual < expected;
    case '>': return actual > expected;
    case '<=': return actual <= expected;
    case '>=': return actual >= expected;
    default: return false;
  }
}

export function evaluateTrigger(
  cond: TriggerCondition | null | undefined,
  enemy: EnemyInstance,
  ctx: BehaviorContext,
): boolean {
  if (!cond) return true; // 無條件 = 恆可用
  switch (cond.type) {
    case 'turn_count':
      return compare(ctx.turnNumber, cond.operator, Number(cond.value));
    case 'hp_percent': {
      const pct = ctx.selfMaxHp > 0 ? (ctx.selfHp / ctx.selfMaxHp) * 100 : 0;
      return compare(pct, cond.operator, Number(cond.value));
    }
    case 'san_percent': {
      const pct = ctx.target.sanMax > 0 ? (ctx.target.san / ctx.target.sanMax) * 100 : 0;
      return compare(pct, cond.operator, Number(cond.value));
    }
    case 'last_move': {
      const last = getLastMove(enemy);
      return cond.operator === '!=' ? last !== String(cond.value) : last === String(cond.value);
    }
    case 'random_chance':
      return ctx.rng() * 100 < Number(cond.value);
    case 'and':
      return (cond.conditions ?? []).every((c) => evaluateTrigger(c, enemy, ctx));
    case 'or':
      return (cond.conditions ?? []).some((c) => evaluateTrigger(c, enemy, ctx));
    default:
      return false; // 未知條件型別:保守不觸發
  }
}

// ─── 加權挑選(共用)──────────────────────────
function weightedPick<T extends { weight?: number }>(entries: T[], rng: () => number): T | null {
  if (entries.length === 0) return null;
  const total = entries.reduce((s, e) => s + Math.max(0, Number(e.weight ?? 1)), 0);
  if (total <= 0) return entries[Math.floor(rng() * entries.length)];
  let pick = rng() * total;
  for (const e of entries) {
    pick -= Math.max(0, Number(e.weight ?? 1));
    if (pick <= 0) return e;
  }
  return entries[entries.length - 1];
}

// ─── 主入口:依出招模式選招 ─────────────────────
export interface MovePickResult {
  card: AttackCardData | null;
  /** 出招後應寫回的 modifiers(含上一招/冷卻/階段標記) */
  modifiers: string[];
  /** 階段切換演出(剛切入新階段時) */
  phaseChanged: string | null;
}

export function pickMoveByBehavior(
  enemy: EnemyInstance,
  movePattern: string,
  script: BehaviorScript | null | undefined,
  movePool: Array<{ code: string; weight?: number }>,
  attackCards: AttackCardLookup,
  ctx: BehaviorContext,
  /** 冷卻遞減一回合一次:同回合多段攻擊(attacks_per_round)只在第一擊 tick */
  tickCooldown = true,
): MovePickResult {
  let modifiers = tickCooldown ? tickCooldowns(enemy.modifiers) : [...enemy.modifiers];
  const enemyTicked: EnemyInstance = { ...enemy, modifiers };
  let phaseChanged: string | null = null;

  // 取本回合可用的腳本招式清單
  let entries: BehaviorMoveEntry[] | null = null;

  if (movePattern === 'phase_based' && script?.phases?.length) {
    // 階段判定:依序求值 transition,最後一個符合者為當前階段(單調切換,不回頭)
    let phase = script.phases[0];
    for (const p of script.phases) {
      if (!p.transition || evaluateTrigger(p.transition, enemyTicked, ctx)) phase = p;
    }
    const prevPhase = getCurrentPhase(enemyTicked);
    if (prevPhase !== phase.code) {
      modifiers = modifiers.filter((m) => !m.startsWith(PHASE_PREFIX));
      modifiers.push(PHASE_PREFIX + phase.code);
      if (prevPhase !== null) phaseChanged = phase.code;
    }
    entries = phase.moves;
  } else if (movePattern === 'conditional' && script?.moves?.length) {
    entries = script.moves;
  }

  let chosen: BehaviorMoveEntry | null = null;

  if (entries) {
    // conditional 邏輯(phase 內也走同規則):條件符合 + 不在冷卻 + 卡存在
    const usable = entries.filter(
      (e) =>
        attackCards[e.code] &&
        cooldownLeft({ ...enemyTicked, modifiers }, e.code) <= 0 &&
        evaluateTrigger(e.trigger_condition, { ...enemyTicked, modifiers }, ctx),
    );
    if (usable.length > 0) {
      const forced = usable.filter((e) => e.forced);
      const pool2 = forced.length > 0 ? forced : usable;
      const minPriority = Math.min(...pool2.map((e) => Number(e.priority ?? 99)));
      const top = pool2.filter((e) => Number(e.priority ?? 99) === minPriority);
      chosen = weightedPick(top, ctx.rng);
    }
  }

  if (!chosen) {
    // pure_random / weighted / 腳本無可用招時的 fallback:回到招式池
    const poolEntries = movePool.filter((m) => attackCards[m.code]);
    if (poolEntries.length === 0) {
      return { card: null, modifiers, phaseChanged };
    }
    if (movePattern === 'pure_random') {
      const m = poolEntries[Math.floor(ctx.rng() * poolEntries.length)];
      chosen = { code: m.code };
    } else {
      const m = weightedPick(poolEntries, ctx.rng);
      chosen = m ? { code: m.code } : null;
    }
  }

  if (!chosen) return { card: null, modifiers, phaseChanged };
  modifiers = recordMoveUse(modifiers, chosen.code, chosen.cooldown);
  return { card: attackCards[chosen.code] ?? null, modifiers, phaseChanged };
}

// ─── 追擊偏好(§10.5 + s14 Part2 家族對應)─────────
export function pickTargetByPreference(
  preference: string | null | undefined,
  preferenceParam: string | null | undefined,
  enemy: EnemyInstance,
  investigators: InvestigatorState[],
  locations: LocationInstance[],
  rng: () => number,
): InvestigatorState | null {
  const alive = investigators.filter((i) => !i.permanentlyDead && (i.hp > 0 || i.san > 0));
  if (alive.length === 0) return null;
  if (alive.length === 1) return alive[0];

  switch (String(preference ?? 'nearest')) {
    case 'lowest_hp':
      return [...alive].sort((a, b) => a.hp - b.hp)[0];
    case 'lowest_san':
      return [...alive].sort((a, b) => a.san - b.san)[0];
    case 'highest_san': // 獵清醒者(哈斯塔巨頭)
      return [...alive].sort((a, b) => b.san - a.san)[0];
    case 'lowest_attr': {
      const attr = (preferenceParam ?? 'perception') as AttributeKey;
      return [...alive].sort((a, b) => (a.attributes[attr] ?? 0) - (b.attributes[attr] ?? 0))[0];
    }
    case 'random':
      return alive[Math.floor(rng() * alive.length)];
    case 'nearest':
    default:
      return [...alive].sort(
        (a, b) =>
          locationDistance(locations, enemy.locationId, a.currentLocationId ?? '') -
          locationDistance(locations, enemy.locationId, b.currentLocationId ?? ''),
      )[0];
  }
}
