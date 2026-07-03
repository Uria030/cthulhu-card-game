/**
 * G-13 戰役進度 / 存檔骨幹測試 — 跨章保留矩陣 + 結算 + 長休息
 */
import {
  initCampaignProgress,
  registerInvestigator,
  extractCarryover,
  settleScenarioEnd,
  applyLongRest,
  scenarioRewardFromOutcome,
  preparationCardXpCost,
  canPurchasePreparationCard,
  purchasePreparationCard,
  emptyTalentProgress,
  canAcquireCardByTalent,
  canUnlockTalentNode,
  unlockTalentNode,
} from './campaignProgress';
import type { CampaignProgress, TalentTreeDefinition } from './campaignProgress';
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

function makeTalentTree(): TalentTreeDefinition {
  return {
    id: 'tree-e',
    faction_code: 'E',
    name_zh: '號令天賦',
    branches: [
      { id: 'br1', branch_index: 1, name_zh: '指揮' },
      { id: 'br2', branch_index: 2, name_zh: '外交' },
    ],
    nodes: [
      {
        id: 'n1', level: 1, is_trunk: true, node_type: 'passive',
        name_zh: '冷靜指令', talent_point_cost: 1,
        effects: [{ effect_code: 'passive_team_focus', effect_params: { amount: 1 }, effect_desc_zh: '隊伍保持冷靜。' }],
      },
      {
        id: 'n2', level: 2, is_trunk: true, node_type: 'attribute_boost',
        name_zh: '觀察訓練', boost_attribute: 'perception', boost_amount: 1, talent_point_cost: 1,
      },
      {
        id: 'b1', level: 3, branch_index: 1, node_type: 'branch_choice',
        name_zh: '選擇指揮分支', talent_point_cost: 1,
      },
      {
        id: 'b2', level: 3, branch_index: 2, node_type: 'branch_choice',
        name_zh: '選擇外交分支', talent_point_cost: 1,
      },
      {
        id: 'tc1', level: 9, branch_index: 1, node_type: 'talent_card',
        name_zh: '指揮專屬卡', talent_card_code: 'TE1-001', prerequisites: ['b1'], talent_point_cost: 1,
      },
    ],
  };
}

// ─── 註冊 + 抽取跨章保留切片 ─────────────────
test('registerInvestigator:起始牌組組成是定義 id、滿血滿智', () => {
  const p = registerInvestigator(initCampaignProgress('camp1'), {
    investigatorDefinitionId: 'elias', deck: ['def_a', 'def_b', 'def_b'], combatStyle: 'pistol', specializations: ['marksman'], hpMax: 10, sanMax: 8,
  });
  const c = p.investigators.elias;
  assertEq(c.deck.length, 3); assertEq(c.deck[0], 'def_a', '存的是定義 id');
  assertEq(c.hp, 10); assertEq(c.san, 8, '開局滿血滿智');
  assertEq(c.xp, 0); assertEq(c.talentPoints, 0);
});

test('registerInvestigator:已註冊者不覆寫(冪等,不洗掉累積進度)', () => {
  let p = registerInvestigator(initCampaignProgress('c'), { investigatorDefinitionId: 'elias', deck: ['def_a'], combatStyle: 'pistol', specializations: [], hpMax: 10, sanMax: 8 });
  p = { ...p, investigators: { ...p.investigators, elias: { ...p.investigators.elias, xp: 12, hp: 3 } } }; // 累積了進度
  p = registerInvestigator(p, { investigatorDefinitionId: 'elias', deck: ['def_zzz'], combatStyle: 'x', specializations: [], hpMax: 10, sanMax: 8 }); // 再註冊一次
  assertEq(p.investigators.elias.xp, 12, '不覆寫累積 XP');
  assertEq(p.investigators.elias.hp, 3, '不覆寫當前 HP');
  assertEq(p.investigators.elias.deck[0], 'def_a', '不覆寫牌組');
});

test('extractCarryover:創傷深拷貝,後續改 inv 不污染存檔', () => {
  const inv = makeInv({ traumas: [{ type: 'physical', amount: 1, source: 's', acquiredAt: 't' }] });
  const c = extractCarryover(inv);
  inv.traumas[0].amount = 99; // 之後玩家在新場景又受創,改動原 inv
  assertEq(c.traumas[0].amount, 1, '存檔裡的創傷不被 inv 後續變動污染');
});

test('extractCarryover:變動欄位取自 inv,牌組/xp/天賦點沿用 prev(不讀場景暫態 deck)', () => {
  const prev = { ...registerInvestigator(initCampaignProgress('c'), { investigatorDefinitionId: 'elias', deck: ['def_a', 'def_b'], combatStyle: 'pistol', specializations: ['marksman'], hpMax: 10, sanMax: 8 }).investigators.elias, xp: 7, talentPoints: 3 };
  // inv.deck 是場景暫態實例 id(只剩抽牌堆 1 張)— 不該被當作組成
  const c = extractCarryover(makeInv({ hp: 2, deck: ['inst_only_1'] }), prev);
  assertEq(c.hp, 2, '當前 HP 用新值');
  assertEq(c.deck.length, 2, '牌組沿用 prev 的定義 id 組成(非場景殘留抽牌堆)');
  assertEq(c.deck[0], 'def_a', '是定義 id 不是實例 id');
  assertEq(c.xp, 7, 'xp 沿用'); assertEq(c.talentPoints, 3, '天賦點沿用');
  // 場景內欄位(手牌/資源/行動點/狀態效果/盟友)不入存檔
  assertEq((c as unknown as { hand?: unknown }).hand, undefined, '手牌不入存檔');
  assertEq((c as unknown as { resources?: unknown }).resources, undefined, '資源不入存檔');
});

test('牌組組成跨「打一場 → 結算」不縮水(回歸 BLOCK:只保留抽牌堆會跨章失效)', () => {
  const p0 = registerInvestigator(initCampaignProgress('c'), { investigatorDefinitionId: 'elias', deck: ['def_a', 'def_b', 'def_c', 'def_d'], combatStyle: 'pistol', specializations: [], hpMax: 10, sanMax: 8 });
  // 場景結束時這位手上只剩抽牌堆 1 張(其餘散在手牌/棄牌/場上),若從 inv.deck 推導會掉成 1 張
  const r = settleScenarioEnd(p0, { i1: makeInv({ deck: ['inst_x'], hp: 5 }) }, { xp: 3 });
  assertEq(r.progress.investigators.elias.deck.length, 4, '組成仍是 4 張(沒被場景末態縮水)');
  assertEq(r.progress.investigators.elias.hp, 5, '當前 HP 更新');
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

// ─── E4:XP 結算 + 整備購卡 ─────────────────────
test('scenarioRewardFromOutcome:讀 chapter_outcomes.rewards + outcome flag_sets', () => {
  const reward = scenarioRewardFromOutcome({
    outcome_code: 'A',
    rewards: { xp: 2, talent_point: 1, cohesion: 1 },
    flag_sets: [{ flag_code: 'outcome.victory', value: true }],
  });
  assertEq(reward.xp, 2);
  assertEq(reward.talentPoints, 1);
  assertEq(reward.cohesion, 1);
  assertEq(reward.flagSets?.[0].flag_code, 'outcome.victory');
});

test('scenarioRewardFromOutcome:隱藏調查只吃明確 XP 欄位,可依調查員過濾', () => {
  const reward = scenarioRewardFromOutcome(
    { outcome_code: 'B', rewards: { xp: 1 } },
    [
      {
        id: 'hp1', locationId: 'loc', title: '暗門', description: '', threshold: 4,
        revealedTo: ['inv-1'], claimedBy: ['inv-1', 'inv-2'], limitedClaimedBy: null,
        hasLimited: false, rewardType: 'effect', rewardParams: { xp: 1 },
      },
      {
        id: 'hp2', locationId: 'loc', title: '紙條', description: '', threshold: 4,
        revealedTo: ['inv-1'], claimedBy: ['inv-1'], limitedClaimedBy: null,
        hasLimited: false, rewardType: 'clue', rewardParams: { amount: 2 },
      },
    ],
    ['inv-1'],
  );
  assertEq(reward.xp, 2, 'outcome 1 + hidden xp 1; clue amount 不當 XP');
});

test('preparationCardXpCost:starting_xp × Exceptional 倍率', () => {
  assertEq(preparationCardXpCost({ id: 'c1', starting_xp: 3 }), 3);
  assertEq(preparationCardXpCost({ id: 'c2', starting_xp: 3, is_exceptional: true }), 6);
});

test('purchasePreparationCard:扣 XP 並加入跨章牌組組成', () => {
  const prev = registerInvestigator(initCampaignProgress('c'), {
    investigatorDefinitionId: 'elias', deck: ['def_a'], combatStyle: 'pistol', specializations: [], hpMax: 10, sanMax: 8,
  });
  const talents = emptyTalentProgress();
  talents.factionLevels.E = 6;
  const withXp: CampaignProgress = { ...prev, investigators: { elias: { ...prev.investigators.elias, xp: 4, talents } } };
  const r = purchasePreparationCard(withXp, 'elias', { id: 'def_b', name_zh: '升級卡', faction: 'E', starting_xp: 3, card_source: 'standard' });
  assertEq(r.ok, true);
  assertEq(r.progress.investigators.elias.xp, 1);
  assertEq(r.progress.investigators.elias.deck.includes('def_b'), true);
});

test('canPurchasePreparationCard:獨特已擁有與書籍/遺跡升級版不可購買', () => {
  const prev = registerInvestigator(initCampaignProgress('c'), {
    investigatorDefinitionId: 'elias', deck: ['def_unique'], combatStyle: 'pistol', specializations: [], hpMax: 10, sanMax: 8,
  });
  const carry = { ...prev.investigators.elias, xp: 10 };
  assertEq(canPurchasePreparationCard(carry, { id: 'def_unique', starting_xp: 1, is_unique: true }).ok, false);
  assertEq(canPurchasePreparationCard(carry, { id: 'book_up', starting_xp: 5, card_source: 'book_upgrade' }).ok, false);
});

// ─── E5:天賦樹接入 ───────────────────────────
test('unlockTalentNode:解鎖節點會扣天賦點、掛被動效果、套屬性加成', () => {
  let p = registerInvestigator(initCampaignProgress('c'), {
    investigatorDefinitionId: 'elias', deck: ['def_a'], combatStyle: 'pistol', specializations: [], hpMax: 10, sanMax: 8,
  });
  p = { ...p, investigators: { elias: { ...p.investigators.elias, talentPoints: 3 } } };
  const tree = makeTalentTree();
  const r1 = unlockTalentNode(p, 'elias', tree, 'n1');
  assertEq(r1.ok, true);
  assertEq(r1.progress.investigators.elias.talentPoints, 2);
  assertEq(r1.progress.investigators.elias.talents.passiveEffects[0].effectCode, 'passive_team_focus');

  const r2 = unlockTalentNode(r1.progress, 'elias', tree, 'n2');
  assertEq(r2.ok, true);
  assertEq(r2.progress.investigators.elias.talents.attributeBonuses.perception, 1);
  assertEq(r2.progress.investigators.elias.talents.factionLevels.E, 2);
});

test('unlockTalentNode:分支選擇後會鎖住其他分支', () => {
  let p = registerInvestigator(initCampaignProgress('c'), {
    investigatorDefinitionId: 'elias', deck: ['def_a'], combatStyle: 'pistol', specializations: [], hpMax: 10, sanMax: 8,
  });
  p = { ...p, investigators: { elias: { ...p.investigators.elias, talentPoints: 4 } } };
  const tree = makeTalentTree();
  p = unlockTalentNode(p, 'elias', tree, 'n1').progress;
  p = unlockTalentNode(p, 'elias', tree, 'n2').progress;
  const b1 = unlockTalentNode(p, 'elias', tree, 'b1');
  assertEq(b1.ok, true);
  assertEq(b1.progress.investigators.elias.talents.selectedBranches.E, 1);
  const b2Check = canUnlockTalentNode(b1.progress.investigators.elias, tree, tree.nodes.find((n) => n.id === 'b2'));
  assertEq(b2Check.ok, false);
  assertEq(b2Check.reason, 'talent_branch_locked');
});

test('unlockTalentNode:talent_card 節點會把對應卡定義加入跨章牌組', () => {
  let p = registerInvestigator(initCampaignProgress('c'), {
    investigatorDefinitionId: 'elias', deck: ['def_a'], combatStyle: 'pistol', specializations: [], hpMax: 10, sanMax: 8,
  });
  p = { ...p, investigators: { elias: { ...p.investigators.elias, talentPoints: 4 } } };
  const tree = makeTalentTree();
  for (const nodeId of ['n1', 'n2', 'b1']) p = unlockTalentNode(p, 'elias', tree, nodeId).progress;
  const r = unlockTalentNode(p, 'elias', tree, 'tc1', [{ id: 'talent-card-1', code: 'TE1-001', faction: 'E', starting_xp: 0 }]);
  assertEq(r.ok, true);
  assertEq(r.addedCardId, 'talent-card-1');
  assertEq(r.progress.investigators.elias.deck.includes('talent-card-1'), true);
});

test('canAcquireCardByTalent:天賦等級鎖與分支鎖疊加', () => {
  const base = registerInvestigator(initCampaignProgress('c'), {
    investigatorDefinitionId: 'elias', deck: [], combatStyle: 'pistol', specializations: [], hpMax: 10, sanMax: 8,
  });
  const noTalent = base.investigators.elias;
  assertEq(canAcquireCardByTalent(noTalent, { id: 'c0', faction: 'E', starting_xp: 0 }).ok, false, '0XP 派系卡也需要至少等級 1');

  const talents = emptyTalentProgress();
  talents.factionLevels.E = 4;
  talents.selectedBranches.E = 1;
  const carry = { ...noTalent, talents };
  assertEq(canAcquireCardByTalent(carry, { id: 'c1', faction: 'E', starting_xp: 2, talent_branch_lock: 'E_1' }).ok, true);
  assertEq(canAcquireCardByTalent(carry, { id: 'c2', faction: 'E', starting_xp: 3 }).reason, 'talent_level_locked');
  assertEq(canAcquireCardByTalent(carry, { id: 'c3', faction: 'E', starting_xp: 2, talent_branch_lock: 'E_2' }).reason, 'talent_branch_locked');
});

// ─── runner ─────────────────────────────────
let passed = 0; let failed = 0; const failures: string[] = [];
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); passed += 1; }
  catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); console.error('✗ ' + t.name + '\n   ' + msg); failed += 1; failures.push(t.name); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error('Tests failed: ' + failures.join(', '));
