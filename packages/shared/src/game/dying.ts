/**
 * G-07 引擎核心 — 瀕死與救援系統(三層死亡的第三層 + 第一層創傷侵蝕)
 *
 * 權威依據:
 * - 02_rulebook_ch2.md §9:HP 或 SAN 歸零 → 瀕死;留在原地、交戰維持、不能行動;
 *   回合開始以瀕死檢定取代行動(d20 DC10;3 成功自行穩定站起、歸零值恢復 1;
 *   3 失敗死亡、歸零項上限永久 -1;天 20 直接站起;天 1 算 2 次失敗;
 *   被怪物命中每次算 1 次失敗;HP/SAN 同時歸零只做 1 組檢定,站起雙恢復、死亡雙 -1)
 * - §9.5 隊友救援:任何量治療立即脫離瀕死;穩定 = 1 行動點 +1 次成功(自動成功)
 * - §9.6:上限 -1 後歸 0 → 永久死亡(角色資料刪除;引擎僅立旗標,刪檔由容器層處理)
 * - 01_rulebook_ch1.md 支柱 4:創傷侵蝕 — 緩慢磨損的恐懼
 */
import type { ResultEffect } from './messages';
import type { InvestigatorState, Trauma } from './state';
import { rollD20 } from './checks';

export const DEATH_SAVE_DC = 10;
export const DEATH_SAVE_TARGET = 3;

/** 是否倒地(HP 或 SAN 歸零且未死亡) */
export function isDowned(inv: InvestigatorState): boolean {
  return !inv.dead && !inv.permanentlyDead && (inv.hp <= 0 || inv.san <= 0);
}

/** 是否還能行動(站著且活著) */
export function isStanding(inv: InvestigatorState): boolean {
  return !inv.dead && !inv.permanentlyDead && inv.hp > 0 && inv.san > 0;
}

export interface DyingResult {
  investigator: InvestigatorState;
  effects: ResultEffect[];
}

/**
 * 倒地狀態同步:HP/SAN 歸零但尚未標記 downed → 進入瀕死(敘事一次)。
 * 治療使兩值都 > 0 → 解除瀕死(§9.5 任何量治療立即脫離)。
 * 容器在每次狀態變化後呼叫(冪等)。
 */
export function syncDownedState(inv: InvestigatorState): DyingResult {
  if (inv.dead || inv.permanentlyDead) return { investigator: inv, effects: [] };
  const shouldBeDowned = inv.hp <= 0 || inv.san <= 0;
  if (shouldBeDowned && !inv.downed) {
    return {
      investigator: { ...inv, downed: true, deathSaveSuccesses: 0, deathSaveFailures: 0 },
      effects: [{
        type: 'investigator_downed',
        params: { narrative: inv.hp <= 0 ? '腿一軟跪進泥水裡,視野邊緣開始發黑。' : '世界的縫隙張開了,意識正在往裡墜。' },
        targetId: inv.investigatorId,
      }],
    };
  }
  if (!shouldBeDowned && inv.downed) {
    // 治療拉起(§9.5):脫離瀕死,計數歸零
    return {
      investigator: { ...inv, downed: false, deathSaveSuccesses: 0, deathSaveFailures: 0 },
      effects: [{ type: 'investigator_revived', params: { narrative: '一口氣回到肺裡——還活著。' }, targetId: inv.investigatorId }],
    };
  }
  return { investigator: inv, effects: [] };
}

/** 站起(3 成功 / 天 20):歸零項恢復 1(同時歸零雙恢復,§9.4) */
function standUp(inv: InvestigatorState, narrative: string): DyingResult {
  const next: InvestigatorState = {
    ...inv,
    hp: inv.hp <= 0 ? 1 : inv.hp,
    san: inv.san <= 0 ? 1 : inv.san,
    downed: false,
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
  };
  return {
    investigator: next,
    effects: [{ type: 'death_save_stand', params: { narrative }, targetId: inv.investigatorId }],
  };
}

/** 死亡(3 失敗):歸零項上限 -1(同時歸零雙 -1);上限歸 0 → 永久死亡 */
function die(inv: InvestigatorState, nowIso: string): DyingResult {
  const effects: ResultEffect[] = [];
  let hpMax = inv.hpMax;
  let sanMax = inv.sanMax;
  const traumas: Trauma[] = [...inv.traumas];
  if (inv.hp <= 0) {
    hpMax -= 1;
    traumas.push({ type: 'physical', amount: 1, source: 'death_save_failed', acquiredAt: nowIso });
  }
  if (inv.san <= 0) {
    sanMax -= 1;
    traumas.push({ type: 'mental', amount: 1, source: 'death_save_failed', acquiredAt: nowIso });
  }
  const permanent = hpMax <= 0 || sanMax <= 0;
  effects.push({
    type: 'investigator_died',
    params: {
      narrative: '掙扎停止了。雨水繼續落在那張不再回應的臉上。',
      trauma: inv.hp <= 0 && inv.san <= 0 ? 'both' : inv.hp <= 0 ? 'physical' : 'mental',
    },
    targetId: inv.investigatorId,
  });
  if (permanent) {
    effects.push({
      type: 'investigator_permanently_dead',
      params: { narrative: '這個故事在此結束。沒有檔案會記得這一頁。' },
      targetId: inv.investigatorId,
    });
  }
  return {
    investigator: { ...inv, hpMax, sanMax, traumas, dead: true, downed: false, permanentlyDead: permanent },
    effects,
  };
}

/**
 * 瀕死檢定(§9.3):倒地者回合開始時執行,取代正常行動。
 * d20 vs DC10;天 20 直接站起;天 1 算 2 次失敗;3 成功站起;3 失敗死亡。
 */
export function runDeathSave(
  inv: InvestigatorState,
  rng: () => number = Math.random,
  nowIso = new Date().toISOString(),
): DyingResult {
  if (!isDowned(inv)) return { investigator: inv, effects: [] };
  const roll = rollD20(rng);
  const effects: ResultEffect[] = [];

  if (roll === 20) {
    const up = standUp(inv, '不知道哪來的力氣——猛地撐起身,站住了。(自然 20)');
    return { investigator: up.investigator, effects: [...effects, ...up.effects] };
  }

  if (roll >= DEATH_SAVE_DC) {
    const successes = (inv.deathSaveSuccesses ?? 0) + 1;
    effects.push({
      type: 'death_save',
      params: { roll, outcome: 'success', successes, failures: inv.deathSaveFailures ?? 0 },
      targetId: inv.investigatorId,
    });
    if (successes >= DEATH_SAVE_TARGET) {
      const up = standUp({ ...inv, deathSaveSuccesses: successes }, '靠著一口不肯斷的氣,自己撐了回來。');
      return { investigator: up.investigator, effects: [...effects, ...up.effects] };
    }
    return { investigator: { ...inv, deathSaveSuccesses: successes }, effects };
  }

  const failures = (inv.deathSaveFailures ?? 0) + (roll === 1 ? 2 : 1);
  effects.push({
    type: 'death_save',
    params: { roll, outcome: roll === 1 ? 'critical_fail' : 'fail', successes: inv.deathSaveSuccesses ?? 0, failures },
    targetId: inv.investigatorId,
  });
  if (failures >= DEATH_SAVE_TARGET) {
    const dead = die({ ...inv, deathSaveFailures: failures }, nowIso);
    return { investigator: dead.investigator, effects: [...effects, ...dead.effects] };
  }
  return { investigator: { ...inv, deathSaveFailures: failures }, effects };
}

/** 穩定(§9.5):隊友花 1 行動點,瀕死者 +1 次成功,自動成功不需檢定 */
export function applyStabilize(target: InvestigatorState): DyingResult {
  if (!isDowned(target)) return { investigator: target, effects: [] };
  const successes = (target.deathSaveSuccesses ?? 0) + 1;
  const effects: ResultEffect[] = [{
    type: 'stabilized',
    params: { successes, narrative: '壓住傷口、貼著耳朵說話——「撐住,看著我。」' },
    targetId: target.investigatorId,
  }];
  if (successes >= DEATH_SAVE_TARGET) {
    const up = standUp({ ...target, deathSaveSuccesses: successes }, '在隊友的攙扶下站了起來。');
    return { investigator: up.investigator, effects: [...effects, ...up.effects] };
  }
  return { investigator: { ...target, deathSaveSuccesses: successes }, effects };
}

/** 全滅判定(取代簡化版):全員死亡(本場)即敗北;倒地者仍有瀕死檢定機會,不算敗 */
export function allInvestigatorsDead(investigators: Record<string, InvestigatorState>): boolean {
  const list = Object.values(investigators);
  if (list.length === 0) return true;
  return list.every((i) => i.dead || i.permanentlyDead);
}
