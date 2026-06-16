/**
 * G-13 戰役進度 / 存檔骨幹測試 — 跨章保留矩陣 + 結算 + 長休息
 */
import { initCampaignProgress, extractCarryover, settleScenarioEnd, applyLongRest } from './campaignProgress';
import type { CampaignProgress } from './campaignProgress';
import type { InvestigatorState } from './state';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) throw new Error((msg ?? 'assertEq') + ': expected=' + String(expected) + ', actual=' + String(actual));
}

function makeInv(over: Partial<InvestigatorState> = {}): InvestigatorState {
  return {
    investigatorId: 'i1', investigatorDefinitionId: 'elias', ownerPlayerId: 'p',
    attributes: { strength: 2, agility: 2, constitution: 2, reflex: 2, intellect: 2, willpower: 2, perception: 2, charisma: 2 },
    combatStyle: 'pistol', specializations: ['marksman'],
    deck: ['c1', 'c2', 'c3'], hand: ['h1'], discardPile: ['d1'], removedPile: [], assetsInPlay: ['a1'],
    hp: 6, hpMax: 10, san: 4, sanMax: 8, actionPoints: 3, resources: 5, currentLocationId: 'B',
    engagedWith: ['e1'], triggeredHorrorChecks: ['x'], traumas: [], secretTaskState: null,
    permanentlyDead: false, startingXp: 0, statusEffects: { bleed: 2 }, allies: [],
    ...over,
  };
}

// ─── 抽取跨章保留切片 ───────────────────────
test('extractCarryover:只留持久欄位,場景內狀態不入存檔', () => {
  const c = extractCarryover(makeInv());
  assertEq(c.hp, 6); assertEq(c.san, 4);
  assertEq(c.hpMax, 10); assertEq(c.sanMax, 8);
  assertEq(c.deck.length, 3, '牌組組成保留');
  assertEq(c.combatStyle, 'pistol');
  assertEq(c.specializations[0], 'marksman');
  // 場景內欄位(手牌/資源/行動點/狀態效果/盟友)不該出現在 carryover 型別上 — 編譯期已保證,這裡確認沒被當欄位帶出
  assertEq((c as unknown as { hand?: unknown }).hand, undefined, '手牌不入存檔');
  assertEq((c as unknown as { resources?: unknown }).resources, undefined, '資源不入存檔');
});

test('extractCarryover:xp/天賦點從 prev 沿用(InvestigatorState 上沒有,屬戰役層)', () => {
  const prev = { ...extractCarryover(makeInv()), xp: 7, talentPoints: 3 };
  const c = extractCarryover(makeInv({ hp: 2 }), prev);
  assertEq(c.xp, 7, 'xp 沿用'); assertEq(c.talentPoints, 3, '天賦點沿用');
  assertEq(c.hp, 2, '當前 HP 用新值');
});

// ─── 場景結束結算 ───────────────────────────
test('settleScenarioEnd:更新存活者狀態 + 發 XP/天賦點 + 寫旗標', () => {
  const prev: CampaignProgress = { ...initCampaignProgress('camp1'), investigators: { elias: { ...extractCarryover(makeInv()), xp: 1, talentPoints: 0 } } };
  const r = settleScenarioEnd(prev, { i1: makeInv({ hp: 3 }) }, { xp: 5, talentPoints: 1, flagSets: [{ flag_code: 'outcome.victory', value: true }] });
  assertEq(r.progress.investigators.elias.hp, 3, '當前 HP 更新');
  assertEq(r.progress.investigators.elias.xp, 6, 'xp 1+5');
  assertEq(r.progress.investigators.elias.talentPoints, 1, '天賦點 0+1');
  assertEq(r.progress.flags['outcome.victory'], true, '旗標寫入');
  assertEq(r.effects.some((e) => e.type === 'campaign_reward'), true);
});

test('settleScenarioEnd:永久死亡 → 從存檔移除、不領獎、發 lost 效果', () => {
  const prev: CampaignProgress = { ...initCampaignProgress('camp1'), investigators: { elias: extractCarryover(makeInv()) } };
  const r = settleScenarioEnd(prev, { i1: makeInv({ permanentlyDead: true }) }, { xp: 5 });
  assertEq(r.progress.investigators.elias, undefined, '永久死亡者從存檔抹除');
  assertEq(r.effects.some((e) => e.type === 'campaign_investigator_lost'), true);
});

test('settleScenarioEnd:沒上場的既有調查員原樣保留', () => {
  const prev: CampaignProgress = {
    ...initCampaignProgress('camp1'),
    investigators: {
      elias: { ...extractCarryover(makeInv()), xp: 2 },
      vesper: { ...extractCarryover(makeInv({ investigatorDefinitionId: 'vesper' })), xp: 9 },
    },
  };
  // 只有 elias 上場
  const r = settleScenarioEnd(prev, { i1: makeInv({ hp: 1 }) }, { xp: 5 });
  assertEq(r.progress.investigators.elias.xp, 7, '上場者 2+5');
  assertEq(r.progress.investigators.vesper.xp, 9, '沒上場者原樣保留');
});

test('settleScenarioEnd:凝聚力獎勵套用且不為負', () => {
  const prev: CampaignProgress = { ...initCampaignProgress('camp1'), cohesion: 1, investigators: { elias: extractCarryover(makeInv()) } };
  assertEq(settleScenarioEnd(prev, { i1: makeInv() }, { cohesion: 2 }).progress.cohesion, 3);
  assertEq(settleScenarioEnd(prev, { i1: makeInv() }, { cohesion: -5 }).progress.cohesion, 0, '夾在 0');
});

// ─── 長休息 ─────────────────────────────────
test('applyLongRest:+1 凝聚力(ch4 §6.1)+ 進下一章 + 開整備訊號', () => {
  const prev: CampaignProgress = { ...initCampaignProgress('camp1'), cohesion: 2, currentChapterNumber: 1 };
  const r = applyLongRest(prev);
  assertEq(r.progress.cohesion, 3, '長休息固定 +1');
  assertEq(r.progress.currentChapterNumber, 2, '進下一章');
  assertEq(r.effects.some((e) => e.type === 'long_rest'), true);
  assertEq(r.effects.some((e) => e.type === 'provisioning_open'), true, '開整備模式');
});

// ─── runner ─────────────────────────────────
let passed = 0; let failed = 0; const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
