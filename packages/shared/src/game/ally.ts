/**
 * G-08 引擎核心 — 盟友 + 傷害分配(ch3 §10.5 / §11)
 *
 * §11 傷害分配(Uria 拍板):調查員受傷時,若場上有可分配的卡(盟友/裝備/其他),
 * **跳傷害分配 Modal 讓玩家自己調**。引擎做法(神話階段批次結算,不阻塞):
 * 1. 傷害先全部結在調查員身上;
 * 2. 若非 direct 且有「可分配目標」→ emit `damage_allocatable`(供 client 開 Modal);
 * 3. 玩家在 Modal 選好 → 送 `allocate_damage` intent → `applyDamageAllocation` 把傷害從調查員
 *    移到選定的卡(調查員回血、卡扣血)。
 *
 * **接口保留**:direct(強制本人,不可分配)、area(全場卡)等 §11.2 關鍵字先讀,
 * 資料庫上架對應欄位後即生效(目前怪物攻擊資料無 direct/area 欄位)。
 * v0 可分配目標 = 盟友(有獨立 HP/SAN);裝備/其他卡的吸收待那些卡的吸收能力資料上架。
 */
import type { AllyState, InvestigatorState } from './state';
import type { ResultEffect } from './messages';

/** 可分配傷害的目標(供 Modal 列出);v0 = 場上盟友 */
export interface AllocatableTarget {
  cardInstanceId: string;
  name: string;
  /** 可吸收的物理上限(= 剩餘 HP) */
  physicalCapacity: number;
  /** 可吸收的恐懼上限(= 剩餘 SAN) */
  horrorCapacity: number;
}

export function allocatableTargets(inv: InvestigatorState): AllocatableTarget[] {
  return (inv.allies ?? [])
    .filter((a) => a.hp > 0 || a.san > 0)
    .map((a) => ({ cardInstanceId: a.cardInstanceId, name: a.name, physicalCapacity: a.hp, horrorCapacity: a.san }));
}

export interface IncomingDamageOpts {
  /** §11.2 直擊:強制扣調查員本人,不可分配 */
  direct?: boolean;
}

/**
 * 對調查員套用一次傷害(已過狀態修正):全部結在調查員身上;
 * 若非 direct 且有可分配目標 → emit `damage_allocatable`(client 開 Modal 重分配)。
 */
export function applyIncomingDamageToPlayer(
  inv: InvestigatorState,
  physical: number,
  horror: number,
  opts: IncomingDamageOpts = {},
): { investigator: InvestigatorState; effects: ResultEffect[] } {
  const phys = Math.max(0, physical);
  const hor = Math.max(0, horror);
  const investigator: InvestigatorState = {
    ...inv,
    hp: Math.max(0, inv.hp - phys),
    san: Math.max(0, inv.san - hor),
  };
  // 可分配量 = **本擊實際造成的損失**(夾在 0..受擊前該池值),不是完整入傷。
  // overkill(入傷 > 受擊前該池值)時超出部分無法回收 → 否則盟友 soak 會把調查員「治到比受擊前更高」。
  const physLost = inv.hp - investigator.hp;
  const horLost = inv.san - investigator.san;
  const effects: ResultEffect[] = [];
  const targets = opts.direct ? [] : allocatableTargets(inv);
  if ((physLost > 0 || horLost > 0) && targets.length > 0) {
    effects.push({
      type: 'damage_allocatable',
      params: { physical: physLost, horror: horLost, targets, narrative: '有人能替你分擔這一擊 — 要分給誰?' },
      targetId: inv.investigatorId,
    });
  }
  return { investigator, effects };
}

export interface DamageAllocation {
  cardInstanceId: string;
  physical?: number;
  horror?: number;
}

/**
 * §11 AI 隊友傷害自動分配(v0 auto-policy):隊友 AI 不跳 Modal(Modal 是玩家專屬affordance),
 * 改用貪婪策略把可分配傷害塞給自己的盟友(肉盾/精神支柱先擋),塞到盟友容量上限為止。
 * 與 applyDamageAllocation 同底層(調查員回血、盟友扣血/離場),差別只在分配方案由策略決定、非玩家選。
 */
export function autoAllocateDamage(
  inv: InvestigatorState,
  physical: number,
  horror: number,
): { investigator: InvestigatorState; effects: ResultEffect[] } {
  const targets = allocatableTargets(inv);
  let pRemain = Math.max(0, physical);
  let hRemain = Math.max(0, horror);
  if (targets.length === 0 || (pRemain <= 0 && hRemain <= 0)) return { investigator: inv, effects: [] };
  const allocations: DamageAllocation[] = [];
  for (const t of targets) {
    const p = Math.min(pRemain, t.physicalCapacity);
    const h = Math.min(hRemain, t.horrorCapacity);
    if (p > 0 || h > 0) {
      allocations.push({ cardInstanceId: t.cardInstanceId, physical: p, horror: h });
      pRemain -= p;
      hRemain -= h;
    }
    if (pRemain <= 0 && hRemain <= 0) break;
  }
  if (allocations.length === 0) return { investigator: inv, effects: [] };
  return applyDamageAllocation(inv, allocations);
}

/**
 * §11 套用玩家在 Modal 選的分配:把傷害從調查員移到選定盟友(調查員回血、盟友扣血)。
 * 每筆分配上限 = 盟友剩餘 HP/SAN 與調查員「本回合已受傷量」的較小值(由 client 控,引擎再夾一次)。
 * 任一池歸 0 → 盟友離場。
 */
export function applyDamageAllocation(
  inv: InvestigatorState,
  allocations: DamageAllocation[],
): { investigator: InvestigatorState; effects: ResultEffect[] } {
  const allies = (inv.allies ?? []).map((a) => ({ ...a }));
  const effects: ResultEffect[] = [];
  let healHp = 0;
  let healSan = 0;
  for (const alloc of allocations) {
    const ally = allies.find((a) => a.cardInstanceId === alloc.cardInstanceId);
    if (!ally) continue;
    const p = Math.min(Math.max(0, alloc.physical ?? 0), ally.hp);
    const h = Math.min(Math.max(0, alloc.horror ?? 0), ally.san);
    if (p > 0) { ally.hp -= p; healHp += p; }
    if (h > 0) { ally.san -= h; healSan += h; }
    if (p > 0 || h > 0) {
      effects.push({ type: 'ally_soak', params: { ally: ally.name, physical: p, horror: h, narrative: '「' + ally.name + '」替你擋下了(HP -' + p + ' / SAN -' + h + ')。' }, targetId: inv.investigatorId });
    }
  }
  // 分配出去的量 = 調查員回血(夾在上限內)
  const survivors: AllyState[] = [];
  for (const a of allies) {
    if (a.hp <= 0 || a.san <= 0) {
      effects.push({ type: 'ally_defeated', params: { ally: a.name, narrative: '「' + a.name + '」再也撐不住,倒了下去。' } });
    } else {
      survivors.push(a);
    }
  }
  const investigator: InvestigatorState = {
    ...inv,
    allies: survivors,
    hp: Math.min(inv.hpMax, inv.hp + healHp),
    san: Math.min(inv.sanMax, inv.san + healSan),
  };
  return { investigator, effects };
}
