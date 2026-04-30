import { adminFetch, adminGet } from './api.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `g1-deck-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# G1 鐵證起始牌組建立 ${stamp}`);

// ── 取鐵證 + 既有狀態
const allInv = await adminGet('/api/admin/investigators');
const inv = (allInv.items || []).find(i => i.code === 'G1_iron_witness_detective');
if (!inv) { log('✗ 找不到鐵證調查員'); process.exit(1); }
const invId = inv.id;
log(`鐵證 id: ${invId}`);

const detail = await adminGet(`/api/admin/investigators/${invId}`);
const existingSigs = detail.signature_cards || [];
const existingWk = detail.weakness;
const existingDeck = detail.starting_deck || [];
log(`既有簽名 ${existingSigs.length} / 弱點 ${existingWk ? 'yes' : 'no'} / 牌組 ${existingDeck.length}`);

// ── 1. 簽名卡 2 張
const SIGS = [
  {
    card_order: 1,
    name_zh: '鐵證之眼', name_en: 'Iron-Witness Lens',
    card_type: 'asset', card_style: 'AH', cost: 0,
    commit_icons: { perception: 2, intellect: 1 },
    play_effect: '進入場上。在你進行調查檢定時，可選擇將此卡轉橫——本次檢定改用此卡的圖示組合而非手牌加值。',
    play_effect_code: [{ effect_code: 'modify_test', trigger: 'on_play', duration: 'while_in_play' }],
    flavor_text: '一塊看似普通的放大鏡，但鏡身刻著只有他懂的記號。',
  },
  {
    card_order: 2,
    name_zh: '.45 銀色子彈', name_en: '.45 Silver Round',
    card_type: 'asset', card_style: 'AC', cost: 0,
    commit_icons: { perception: 1 },
    play_effect: '進入場上作為武器附件。下次以 .45 自動手槍進行的攻擊忽略目標的物理抗性，傷害 +2。',
    play_effect_code: [{ effect_code: 'attack_buff', trigger: 'on_play', duration: 'while_in_play' }],
    flavor_text: '搭檔死後第二天，他自己手刻的。從沒想過真會用上。',
  },
];

for (const s of SIGS) {
  const exists = existingSigs.find(e => e.name_zh === s.name_zh);
  if (exists) { log(`⊙ 簽名 skip: ${s.name_zh}`); continue; }
  const r = await adminFetch(`/api/admin/investigators/${invId}/signature-cards`, {
    method: 'POST', body: JSON.stringify(s),
  });
  if (!r.ok) { log(`✗ 簽名 ${s.name_zh}: ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`); continue; }
  log(`✓ 簽名 ${s.name_zh} id=${r.body.id}`);
}

// ── 2. 弱點 1 張
const WEAK = {
  name_zh: '無法忘記的事', name_en: 'What He Cannot Forget',
  weakness_type: 'trauma',
  trigger_condition: '當你進入「黑暗」狀態的地點，或目睹隊友 SAN 歸零時觸發。',
  negative_effect: '進行意志檢定 DC 12;失敗時承受 2 SAN 並抽出此卡，本回合無法主動行動(只能反應)。',
  removal_condition: '完成「印斯茅斯陰影」戰役且揭露三年前霧夜真相後可移除。',
  backstory: '三年前的霧夜，搭檔在港口廢倉庫被某種東西拖進水裡。他帶著一身海腥味的傷回到事務所，從此每次聞到鹹腥味，那一夜的尖叫就會在腦中重播。',
  flavor_text: '海腥味從巷弄深處傳來。他握緊槍把，告訴自己這次不會再遲到。',
  effect_value: -3,
  trigger_probability: 0.067,
  expected_rounds: 5,
};
if (existingWk) {
  log(`⊙ 弱點 skip(既有: ${existingWk.name_zh})`);
} else {
  const r = await adminFetch(`/api/admin/investigators/${invId}/weakness`, {
    method: 'PUT', body: JSON.stringify(WEAK),
  });
  if (!r.ok) log(`✗ 弱點: ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  else log(`✓ 弱點 ${WEAK.name_zh} id=${r.body.id}`);
}

// ── 3. 起始牌組:15 張普通卡(簽名 2 + 弱點 1 自動加,共 18 張)
const STARTING_DECK_NAMES = [
  '.45 自動手槍', '黃銅指虎', '厚雨衣', '搭檔遺物·懷錶',
  '緊急閃避', '冷靜推理', '凝視深淵', '街角情報',
  '蠻力', '迅捷身手', '不屈意志', '街頭直覺',
  '街角熱咖啡', '事務所筆記', '臨機應變',
];

const allCards = await adminGet('/api/cards');
const cardArr = Array.isArray(allCards) ? allCards : (allCards.cards || allCards.data || []);

// 既有牌組的 card_definition_id 集合
const existingDefIds = new Set(existingDeck.filter(d => d.card_definition_id).map(d => d.card_definition_id));

let added = 0, skipped = 0, missing = [];
for (const name of STARTING_DECK_NAMES) {
  const card = cardArr.find(c => c.name_zh === name);
  if (!card) { missing.push(name); continue; }
  if (existingDefIds.has(card.id)) { skipped++; continue; }
  const r = await adminFetch(`/api/admin/investigators/${invId}/starting-deck/cards`, {
    method: 'POST',
    body: JSON.stringify({ card_definition_id: card.id, quantity: 1 }),
  });
  if (!r.ok) {
    log(`✗ 牌組 ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
    continue;
  }
  added++;
}
log(`✓ 牌組: 新加 ${added} / 既有 ${skipped} / 找不到 ${missing.length}${missing.length ? ' ('+missing.join(',')+')' : ''}`);

// ── 最終狀態
const finalDetail = await adminGet(`/api/admin/investigators/${invId}`);
const total = (finalDetail.starting_deck || []).reduce((a, d) => a + (d.quantity || 1), 0);
log(`\n=== 鐵證最終狀態 ===`);
log(`簽名卡: ${(finalDetail.signature_cards || []).length}`);
log(`弱點: ${finalDetail.weakness ? finalDetail.weakness.name_zh : 'none'}`);
log(`起始牌組總張數: ${total} (規範 15-20)`);
log(`is_completed: ${finalDetail.is_completed}`);

fs.writeFileSync(logPath, lines.join('\n'));
log(`log: ${logPath}`);
