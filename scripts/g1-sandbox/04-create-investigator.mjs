import { adminFetch, adminGet } from './api.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `g1-investigator-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# G1 鐵證調查員建立 ${stamp}`);
log('');

const TARGET_CODE = 'G1_iron_witness_detective';

// ── 1. GET 既有 investigators 看是否已存在(冪等)
const allInv = await adminGet('/api/admin/investigators');
const items = allInv.items || allInv.data || [];
let inv = items.find(i => i.code === TARGET_CODE);

if (inv) {
  log(`✓ 既有調查員找到 id=${inv.id} (重跑模式,直接 PATCH)`);
} else {
  // POST 新建(送 mbti=ISTP,DB 自動算 base attrs)
  const r = await adminFetch('/api/admin/investigators', {
    method: 'POST',
    body: JSON.stringify({
      code: TARGET_CODE,
      mbti_code: 'ISTP',
      faction_code: 'S',
      career_index: null,
      dominant_letter: 'S',
    }),
  });
  if (!r.ok) {
    log(`✗ POST 失敗 ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    process.exit(1);
  }
  inv = r.body;
  log(`✓ POST 成功 id=${inv.id}`);
  log(`  MBTI base 屬性: 力${inv.attr_strength} 敏${inv.attr_agility} 體${inv.attr_constitution} 反${inv.attr_reflex} 智${inv.attr_intellect} 意${inv.attr_willpower} 感${inv.attr_perception} 魅${inv.attr_charisma}`);
}

// ── 2. 取 combat_styles id (shooting + brawl)
const csList = await adminGet('/api/combat-styles');
const csArr = csList.data || csList;
const shooting = csArr.find(s => s.code === 'shooting');
const brawl = csArr.find(s => s.code === 'brawl');
if (!shooting || !brawl) {
  log(`✗ 找不到戰鬥風格: shooting=${!!shooting} brawl=${!!brawl}`);
  log(`  既有: ${csArr.map(s => s.code).join(', ')}`);
  process.exit(1);
}
log(`✓ shooting id=${shooting.id} / brawl id=${brawl.id}`);

// ── 3. PATCH 屬性 + 戰鬥風格 + 敘事(對齊 Uria 拍板 ISTP 配置 + Part 3 劇本氛圍)
const patchBody = {
  // 屬性:感知 5(主+自由 1)/ 反應 4(副 P+自由 2)/ 智力 2(副 I)/ 敏捷 2(副 T)/ 意志 2(自由 1)/ 力 1 / 體 1 / 魅 1 = 18
  attr_strength: 1,
  attr_agility: 2,
  attr_constitution: 1,
  attr_reflex: 4,
  attr_intellect: 2,
  attr_willpower: 2,
  attr_perception: 5,
  attr_charisma: 1,

  // 敘事
  name_zh: '無名鐵證偵探',
  name_en: 'Nameless Iron Witness',
  title_zh: '私家偵探',
  title_en: 'Private Investigator',

  backstory: '他不掛招牌，事務所的門上只有一塊磨損的銅銘:「鐵證」。三年前的霧夜，他追查一樁失蹤案進到港口的廢倉庫——那裡有不該存在的東西。同行的搭檔再也沒走出來，他帶著一身海腥味的傷回到事務所，把所有的「神秘」報告都鎖進保險箱。從此他只接他能用放大鏡解開的案子。直到這個下著冷雨的夜晚，「裂嘴女」的傳聞從鄰里傳到他的案頭——熟悉的海腥味，熟悉的不對勁。他從抽屜深處取出那把 .45 自動手槍，走進暗巷:這次不會再讓搭檔白白消失。',

  ability_text_zh: '【鐵證直覺】當你進行感知檢定時，可額外重擲 1 顆失敗的骰子(每場一次)。當你看見任何超自然徵兆，先試圖找出物理解釋——成功時你獲得 1 個線索，失敗時你承受 1 點 SAN 傷害(因為你不得不承認某些東西無法被解釋)。',
  ability_text_en: '【Iron-Witness Instinct】On a Perception check, reroll one failed die (once per scenario). Whenever a supernatural sign appears, you must first attempt to find a physical explanation — on success gain 1 clue, on failure suffer 1 SAN damage (because you must finally admit something cannot be explained).',

  // 戰鬥風格:槍枝射擊(主)+ 搏擊(副)
  proficiency_ids: [shooting.id, brawl.id],
};

const pr = await adminFetch(`/api/admin/investigators/${inv.id}`, {
  method: 'PATCH',
  body: JSON.stringify(patchBody),
});
if (!pr.ok) {
  log(`✗ PATCH 失敗 ${pr.status}: ${JSON.stringify(pr.body).slice(0, 400)}`);
  process.exit(1);
}
const updated = pr.body;
const sum = ['attr_strength','attr_agility','attr_constitution','attr_reflex','attr_intellect','attr_willpower','attr_perception','attr_charisma'].reduce((a, k) => a + Number(updated[k] || 0), 0);
log(`✓ PATCH 完成`);
log(`  屬性: 力${updated.attr_strength} 敏${updated.attr_agility} 體${updated.attr_constitution} 反${updated.attr_reflex} 智${updated.attr_intellect} 意${updated.attr_willpower} 感${updated.attr_perception} 魅${updated.attr_charisma} (合計 ${sum})`);
log(`  戰鬥風格: ${(updated.proficiency_ids || []).length} 個 (shooting + brawl)`);
log(`  is_completed: ${updated.is_completed} (FALSE 因簽名卡/弱點/起始牌組待 30 卡建立後補)`);

log('\n=== 結果 ===');
log(`✓ G1_iron_witness_detective id=${inv.id}`);
log(`  下一步:30 卡建立完後補簽名卡 ≥2 / 弱點 ≥1 / 起始牌組 15-20 張 → is_completed 自動轉 true`);

fs.writeFileSync(logPath, lines.join('\n'));
log(`\nlog: ${logPath}`);
