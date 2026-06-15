/**
 * G-08 引擎核心 — 盟友傷害分配(ch3 §11)
 *
 * 規格:調查員受到傷害/恐懼時,可分配到場上盟友卡(direct 強制本人、area 全場)。
 * **v0 簡化(Uria 待覆核)**:沒有互動層之前,改「盟友自動吸收」——
 * 物理由最高 HP 的盟友(肉盾)吸、恐懼由最高 SAN 的盟友(精神支柱)吸,封頂後 overflow 給調查員。
 * 真正的「玩家選擇分配多少/分給誰」需演出/互動層(Phase 2);direct/area 待資料補欄位。
 */
import type { AllyState, InvestigatorState } from './state';
import type { ResultEffect } from './messages';

export interface AllocateResult {
  allies: AllyState[];
  /** 吸收後仍打到調查員的傷害 */
  toInvestigator: { physical: number; horror: number };
  effects: ResultEffect[];
}

/**
 * 把一次傷害(已過狀態修正)分配到盟友,回傳吸收後剩給調查員的量 + 更新後盟友(陣亡者移除)。
 * v0:單一最佳盟友吸收(物理→最高HP / 恐懼→最高SAN);任一池歸 0 → 盟友離場。
 */
export function allocateIncomingDamage(
  allies: AllyState[] | undefined,
  physical: number,
  horror: number,
): AllocateResult {
  const list = (allies ?? []).map((a) => ({ ...a }));
  const effects: ResultEffect[] = [];
  let phys = Math.max(0, physical);
  let hor = Math.max(0, horror);
  if (list.length === 0) {
    return { allies: list, toInvestigator: { physical: phys, horror: hor }, effects };
  }

  // 物理 → 最高 HP 的盟友(肉盾)吸,overflow 給調查員
  if (phys > 0) {
    const tank = list.filter((a) => a.hp > 0).sort((a, b) => b.hp - a.hp)[0];
    if (tank) {
      const soak = Math.min(phys, tank.hp);
      tank.hp -= soak;
      phys -= soak;
      effects.push({ type: 'ally_soak', params: { ally: tank.name, amount: soak, kind: 'physical', narrative: '「' + tank.name + '」替你擋下攻擊(HP -' + soak + ')。' } });
    }
  }
  // 恐懼 → 最高 SAN 的盟友(精神支柱)吸
  if (hor > 0) {
    const pillar = list.filter((a) => a.san > 0).sort((a, b) => b.san - a.san)[0];
    if (pillar) {
      const soak = Math.min(hor, pillar.san);
      pillar.san -= soak;
      hor -= soak;
      effects.push({ type: 'ally_soak', params: { ally: pillar.name, amount: soak, kind: 'horror', narrative: '「' + pillar.name + '」為你穩住心神(SAN -' + soak + ')。' } });
    }
  }

  // 任一池歸 0 → 盟友離場(§10.5)
  const survivors: AllyState[] = [];
  for (const a of list) {
    if (a.hp <= 0 || a.san <= 0) {
      effects.push({ type: 'ally_defeated', params: { ally: a.name, narrative: '「' + a.name + '」再也撐不住,倒了下去。' } });
    } else {
      survivors.push(a);
    }
  }
  return { allies: survivors, toInvestigator: { physical: phys, horror: hor }, effects };
}

/**
 * 對單一調查員套用一次傷害(已過狀態修正):盟友先吸,剩餘打調查員。
 * 回傳更新後調查員(allies + hp/san)+ 盟友吸收/陣亡效果(主傷害效果由呼叫端另推,顯示總量)。
 */
export function applyDamageWithAllies(inv: InvestigatorState, physical: number, horror: number): { investigator: InvestigatorState; effects: ResultEffect[] } {
  const alloc = allocateIncomingDamage(inv.allies, physical, horror);
  const investigator: InvestigatorState = {
    ...inv,
    allies: alloc.allies,
    hp: Math.max(0, inv.hp - alloc.toInvestigator.physical),
    san: Math.max(0, inv.san - alloc.toInvestigator.horror),
  };
  return { investigator, effects: alloc.effects };
}
