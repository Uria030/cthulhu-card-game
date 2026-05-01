// F 陣營(聖燼 The Ember)30 張 lv0 初始卡 — AI 全自動生成
// 五軸:4 個 card_name(消防員 A / 鄉村牧師 B / 退役拳擊手 D / 前線軍醫 E)+ 1 個 combat_style(brawl)
// 規範主檔:packages/client/public/admin/admin-card-prompt.js §七之四之二 軸向設計工作流程
// Pattern 跨陣營無衝突(E=BCDE, I=ACDF, S=ABEF, N=ACDE, F=ABDE)
import { adminFetch, adminGet } from './api.mjs';
import { generateValidatedCard, formatValidationReport } from './lib/generate-card.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `f-faction-cards-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# F 陣營(聖燼)30 張 lv0 卡 AI 生成 ${stamp}`);

const existing = await adminGet('/api/cards');
const existingArr = Array.isArray(existing) ? existing : (existing.cards || existing.data || []);
const existingNameSet = new Set(existingArr.map((c) => c.name_zh));
log(`既有 ${existingArr.length} 張(將跳過同 name_zh 的卡)\n`);

const F_BRIEFS = [
  // ═══ 軸 1:card_name='消防員' (Pattern A 資源回收) 6 張 ═══
  {
    name_zh: '老消防隊', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '消防員',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。【被動】在你或隊友的 HP 從滿值下降時,從你的棄牌堆查看頂 1 張「消防員」軸卡,可將其加入手牌。Pattern A 資源回收主泵——救火車回庫房補水,棄牌堆是「上一次出勤的記錄」。風味:磚紅色的老消防站,門口立著鏽蝕的鐘。費用 3。',
  },
  {
    name_zh: '空氣呼吸器', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'card_name', primary_axis_value: '消防員',
    intent: '配件型資產,費用 2。持續在場(passive),你進入有「火災/煙霧/瘴氣」標記的地點時不受該地點環境傷害,且該回合結束時可從棄牌堆取回 1 張同軸卡。Pattern A 條件回收。風味:鏽斑的鋼瓶,標籤寫著 1923 年廠造。',
  },
  {
    name_zh: '緊急復返', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '消防員',
    intent: '事件,費用 1。【行動】從你的棄牌堆取回 2 張「消防員」軸卡到手牌,且本回合下一次治療效果 +1。Pattern A 直給型。風味:警鈴一響,沒人問為什麼,所有人衝向同一個方向。',
  },
  {
    name_zh: '消防斧', card_type: 'asset', slot: 'one_hand',
    combat_style: 'brawl',
    primary_axis_layer: 'card_name', primary_axis_value: '消防員',
    intent: '隨身武器(brawl),費用 2,weapon_tier 2,造成 4 點傷害。【消費】可消費此卡 → 移除你所在地點 1 個「火災/煙霧/障礙」標記。Pattern A 弱版(資產轉用途)。風味:紅柄、磨損的刃口,劈過上百道燃燒的門。',
  },
  {
    name_zh: '無畏衝鋒', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '消防員',
    intent: '技能,費用 0。加值力量檢定 +2。如果該檢定用於救援(治療隊友、移除標記、解救被困盟友):額外從棄牌堆抽 1 張同軸卡到手牌。Pattern A 鏡像型。風味:你不是不怕,你只是把怕推到事後。',
  },
  {
    name_zh: '消防隊長', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '消防員',
    intent: '盟友,費用 3,HP 3 SAN 1。【反應】在另一名隊友受到傷害時:此卡承受 1 點該傷害(替擋),然後從你的棄牌堆查看頂 2 張,可將 1 張同軸卡加入手牌。Pattern A 替擋+回收連動。風味:他的右手只剩 3 根手指,但他從沒掛掉過任何一通急救電話。',
  },

  // ═══ 軸 2:card_name='鄉村牧師' (Pattern B 質變閾值) 6 張 ═══
  {
    name_zh: '小鎮教堂', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '鄉村牧師',
    intent: '地點關鍵卡(asset),進場後常駐(passive)。【被動】當你場上有 ≥3 張「鄉村牧師」軸卡時,你進入此卡所在地點時恢復 1 點恐懼,且本回合所有治療效果 +1。Pattern B 質變閾值主驅動——信徒聚到一定數量,神才下凡。風味:斑駁的彩色玻璃,午後陽光穿過聖母像。費用 3。',
  },
  {
    name_zh: '信念之燭', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '鄉村牧師',
    intent: '資產,費用 1。持續在場(passive),你執行治療動作時放 1 個「信念」標記在此卡上。當「信念」≥3 時,你的所有 strength 檢定 +1、敵人對你的攻擊 −1 傷害(保底 1)。Pattern B 累積型核心。風味:祭壇前的長明燭,燭芯越短,光卻越明。',
  },
  {
    name_zh: '佈道之力', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '鄉村牧師',
    intent: '事件,費用 2。【行動】如果你場上有 ≥3 張「鄉村牧師」軸卡:選擇所有隊友,他們各恢復 2 點恐懼。否則只恢復 1 點恐懼且僅你自己。Pattern B 質變回報。風味:他開口時聲音不大,但話語裡有讓人心裡發燙的東西。',
  },
  {
    name_zh: '聖經誦讀', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '鄉村牧師',
    intent: '技能,費用 0。加值意志檢定 +2。如果你場上有 ≥3 張「鄉村牧師」軸卡:額外 +1。Pattern B 質變強化。風味:不是禱詞背得熟,是真的相信。',
  },
  {
    name_zh: '十字架項鍊', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'card_name', primary_axis_value: '鄉村牧師',
    intent: '配件型資產,費用 1。法器:talisman_type=silver, target_threat_types=["mental"], break_timing=instant, break_charge_label=信仰, break_charge_max=3。【被動】你執行治療動作時累積 1 點信仰。可消耗 1 點信仰 → 即時破除一張 mental 強度 ≤2 的遭遇卡。Pattern B 累積→消耗。風味:祖母留下的銀十字,鏈節因常被緊握而磨亮。',
  },
  {
    name_zh: '虔誠教徒', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '鄉村牧師',
    intent: '盟友,費用 3,HP 2 SAN 2。【被動】只要你場上有 ≥3 張「鄉村牧師」軸卡,此盟友造成的傷害 +1、可承受傷害 +1(質變強化)。Pattern B 質變升級。風味:她跟著牧師十年,沒說過一句懷疑的話。',
  },

  // ═══ 軸 3:card_name='退役拳擊手' (Pattern D 跨時機配合) 6 張 ═══
  {
    name_zh: '社區拳館', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退役拳擊手',
    intent: '地點關鍵卡(asset),進場後常駐(passive)。【反應】在你受到傷害後:可棄置 1 張「退役拳擊手」軸卡 → 你的下一次 brawl 攻擊本回合 +2 傷害。Pattern D 跨時機配合主驅動——挨打才有反擊。風味:汗味的舊館場,沙袋掛了三十年。費用 3。',
  },
  {
    name_zh: '反擊本能', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退役拳擊手',
    intent: '事件,費用 1。【反應】在敵人對你進行攻擊後(無論命中):對該敵人進行一次 brawl 攻擊。Pattern D 反應型核心。風味:他打你一拳,你就打他兩拳——拳擊的禮儀。',
  },
  {
    name_zh: '對峙姿勢', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退役拳擊手',
    intent: '技能,費用 0。加值反應檢定 +2。如果該檢定用於閃避或反擊:額外 +1 傷害給觸發攻擊的敵人。Pattern D 跨時機強化。風味:站好。腳尖、肩膀、視線——都對齊。',
  },
  {
    name_zh: '頭部護網', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'card_name', primary_axis_value: '退役拳擊手',
    intent: '配件型資產,費用 1。【反應】在你受到傷害時:減免 1 點該傷害,然後本回合下一次 brawl 攻擊 +1 傷害。Pattern D 受擊→反擊配合。風味:練習用的舊頭盔,留著的不只是皮革味。',
  },
  {
    name_zh: '老教練', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退役拳擊手',
    intent: '盟友,費用 3,HP 2 SAN 1。【反應】在你進行 brawl 攻擊前:可消耗此盟友 1 行動 → 該攻擊 +2 傷害且不消耗你的彈藥/次數。Pattern D 跨時機助攻。風味:他在你 14 歲那年讓你戴上手套,現在 60 歲還在你身後喊「左勾、左勾」。',
  },
  {
    name_zh: '拳擊手套', card_type: 'asset', slot: 'one_hand',
    combat_style: 'brawl',
    primary_axis_layer: 'card_name', primary_axis_value: '退役拳擊手',
    intent: '隨身武器(brawl),費用 2,weapon_tier 2,造成 3 點傷害。【反應】在敵人攻擊你後:你的下一次以此武器的 brawl 攻擊 +1 傷害(連消連打)。Pattern D 跨時機。風味:磨白皮革,內襯滲出三十年的汗水。',
  },

  // ═══ 軸 4:card_name='前線軍醫' (Pattern E 成本轉移) 6 張 ═══
  {
    name_zh: '野戰醫帳', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '前線軍醫',
    intent: '地點關鍵卡(asset),進場後常駐(passive)。【行動】可承受 1 點 HP 傷害(自身) → 一名隊友恢復 2 點 HP 並抽 1 張牌。Pattern E 成本轉移主驅動——你流血,他活下來。風味:帆布上印著紅十字,帳子裡永遠有人在尖叫或道謝。費用 3。',
  },
  {
    name_zh: '野戰急救包', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'card_name', primary_axis_value: '前線軍醫',
    intent: '配件型資產,費用 1。【消費】可消費此卡並承受 1 點恐懼 → 一名隊友恢復 3 點 HP 或 2 點恐懼。Pattern E 成本轉移消費型。風味:破舊的帆布袋,血漬比繃帶多。',
  },
  {
    name_zh: '臨終止血', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '前線軍醫',
    intent: '事件,費用 0。【反應】在一名隊友因傷害將被擊倒前:你承受 2 點 HP 傷害 → 該隊友的 HP 重設為 1 並阻止擊倒。Pattern E 成本轉移核心。風味:你擋在子彈和他之間的那兩秒,什麼都沒想。',
  },
  {
    name_zh: '冷靜手術', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '前線軍醫',
    intent: '技能,費用 0。加值智力檢定 +1。【消費】可消費此卡並棄置 1 張任意手牌 → 一名隊友恢復 2 點 HP。Pattern E 成本轉移弱版。風味:他切下去的時候手不抖,因為他已經抖過太多次。',
  },
  {
    name_zh: '燃燒自己', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '前線軍醫',
    intent: '事件,費用 0。【行動】你承受 2 點 HP 傷害 + 1 點恐懼 → 直到本回合結束,你的所有 strength 檢定 +3 且攻擊 +2 傷害。Pattern E 成本轉移高槓桿。風味:他笑著對隊友說「你撐住,我還有點存貨」——其實已經沒了。',
  },
  {
    name_zh: '傷兵盟友', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '前線軍醫',
    intent: '盟友,費用 2,HP 2 SAN 1。【行動】可消耗此盟友 1 行動 + 你承受 1 點 HP → 抽 2 張牌(模擬「你照顧他,他幫你想下一步」)。Pattern E 成本轉移雙向。風味:他半條腿沒了,但腦子比誰都清醒。',
  },

  // ═══ 軸 5:combat_style='brawl' (橫向武器軸) 6 張 ═══
  {
    name_zh: '銅指虎', card_type: 'asset', slot: 'one_hand',
    combat_style: 'brawl',
    primary_axis_layer: 'combat_style', primary_axis_value: 'brawl',
    intent: '單手武器(brawl),費用 2,weapon_tier 2,造成 4 點傷害。【加值】力量檢定用此武器攻擊時 +1。風味:磨亮的銅環,扣上四指後拳頭重量翻倍。',
  },
  {
    name_zh: '護身拳套', card_type: 'asset', slot: 'one_hand',
    combat_style: 'brawl',
    primary_axis_layer: 'combat_style', primary_axis_value: 'brawl',
    intent: '單手武器(brawl),費用 2,weapon_tier 2,造成 3 點傷害。法器雙用途:talisman_type=steel, target_threat_types=["mental"], break_timing=test, break_test_attribute=strength, break_charge_label=純度, break_charge_max=2。【消費】可消耗 1 充能並進行力量檢定 → 即時破除一張 mental 強度 ≤2 的遭遇卡(揮拳打退幻覺)。風味:皮革包鋼骨,既能擋拳也能擋鬼。',
  },
  {
    name_zh: '加重拳套', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'brawl',
    intent: '配件,費用 1。持續在場(passive),你以 brawl 攻擊時 +1 傷害(保底加成)。風味:鉛塊縫進拳套襯裡,每揮一拳手腕都在抗議。',
  },
  {
    name_zh: '繃帶', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'brawl',
    intent: '配件,費用 1。持續在場(passive),你進行 brawl 攻擊時不會因該攻擊使自身 HP 受到反噬傷害(模擬「拳擊手纏帶保護指節」)。風味:白色棉繃帶,纏緊指節,血滲出來也不解開。',
  },
  {
    name_zh: '棒球棍', card_type: 'asset', slot: 'two_hand',
    combat_style: 'brawl',
    primary_axis_layer: 'combat_style', primary_axis_value: 'brawl',
    intent: '雙手武器(brawl),費用 2,weapon_tier 2,造成 5 點傷害。【加值】此武器攻擊時力量 +1。風味:楓木棒身,握把處有泥沙磨痕——不是球場帶回來的。',
  },
  {
    name_zh: '鋼頭工靴', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'brawl',
    intent: '配件,費用 1。持續在場(passive),【反應】在你受到傷害時:可減免 1 點該傷害,且本回合下一次 brawl 攻擊不消耗行動點(踹擊免費)。風味:工地鋼頭靴,鞋尖磨白,踢過鐵門也踢過怪物的下巴。',
  },
];

log(`目標 ${F_BRIEFS.length} 張\n`);

const results = { created: [], skipped: [], failed: [] };

for (let i = 0; i < F_BRIEFS.length; i++) {
  const brief = F_BRIEFS[i];
  log(`\n─── [${i + 1}/${F_BRIEFS.length}] ${brief.name_zh} ───`);

  if (existingNameSet.has(brief.name_zh)) {
    log(`⊙ skip(既有):${brief.name_zh}`);
    results.skipped.push(brief.name_zh);
    continue;
  }

  const lockHints = [];
  lockHints.push(`卡名:「${brief.name_zh}」(必須使用此名,不要修改)`);
  if (brief.card_type) lockHints.push(`類型:${brief.card_type}`);
  if (brief.slot) lockHints.push(`配件欄:${brief.slot}`);
  if (brief.combat_style) lockHints.push(`戰鬥風格:${brief.combat_style}`);
  if (brief.primary_axis_layer) lockHints.push(`primary_axis_layer:${brief.primary_axis_layer}`);
  if (brief.primary_axis_value) lockHints.push(`primary_axis_value:${brief.primary_axis_value}(純名,DB 不存書名號)`);
  lockHints.push(`series:F(F 陣營批次)`);
  lockHints.push(`faction:F(聖燼)`);
  lockHints.push(`star/level:0(基礎卡)`);

  const userDescription = [
    `## 綱要(設計意圖)`,
    brief.intent,
    ``,
    `## 結構鎖定(必須照填)`,
    lockHints.map((s) => '- ' + s).join('\n'),
    ``,
    `## F 陣營(聖燼 The Ember)氣質提醒`,
    `- 一句話:黑暗中能照亮別人的光,來自燃燒自己的勇氣。`,
    `- 核心策略:以身擋傷的犧牲者(治療隊友、替隊友承受傷害、燃燒自己 HP/SAN 換取強力效果、信念計數器越危險越強)`,
    `- 陣營基礎被動:當隊友 HP 或 SAN 低於一半時,你的攻擊 +1 傷害 — 設計時可加成這個被動`,
    `- 戰鬥節奏:近身肉搏,主屬性 strength,預設 combat_style=brawl`,
    `- 風味:暖紅色,燭火餘燼、心臟跳動、最後一絲溫暖`,
    `- 風格偏向:A+H(直接正面)為主`,
    ``,
    `## s06 文法硬性要求`,
    `- 每條 effect 的 desc_zh 必含【行動】/【免費行動】/【反應】/【被動】/【強制】/【加值】/【消費】其中之一框架`,
    `- 主詞用「你」,自指用「此卡」`,
    `- 阿拉伯數字 + 全形減號「−」`,
    `- 觸發句「在 X 時」(不用「當 X 時」),條件句「如果 X」(不用「若 X」)`,
    `- 「抽 X 張牌」(不寫「卡」)、「獲得 X 資源」(不寫「個」)、「X 點恐懼」(不寫「X SAN」)`,
  ].join('\n');

  let r;
  try {
    r = await generateValidatedCard({
      userDescription,
      existingFilter: { faction: 'F', primary_axis_value: brief.primary_axis_value },
      maxRetry: 2,
    });
  } catch (e) {
    log(`✗ Gemini call failed: ${e.message}`);
    results.failed.push({ name: brief.name_zh, reason: e.message });
    continue;
  }

  log(`Gemini 嘗試 ${r.attempts} 次,模型 ${r.modelUsed}`);
  log(formatValidationReport(r.validation));

  if (!r.validation.passed) {
    log(`✗ 驗閘未通過(${r.validation.errors.length} errors),不 POST,留待人工審查`);
    results.failed.push({ name: brief.name_zh, reason: 'validation_failed', card: r.card, validation: r.validation });
    continue;
  }

  const card = r.card;
  card.series = 'F';
  if (card.starting_xp == null) card.starting_xp = 0;
  if (card.level == null) card.level = 0;
  if (!card.faction) card.faction = 'F';
  if (brief.card_type) card.card_type = brief.card_type;
  if (brief.slot) card.slot = brief.slot;
  if (brief.combat_style) card.combat_style = brief.combat_style;
  if (brief.primary_axis_layer) card.primary_axis_layer = brief.primary_axis_layer;
  if (brief.primary_axis_value) card.primary_axis_value = brief.primary_axis_value;
  if (!card.name_zh || card.name_zh !== brief.name_zh) card.name_zh = brief.name_zh;

  if (Array.isArray(card.effects)) {
    card.effects = card.effects.map((e, idx) => ({
      sort_order: idx,
      effect_code: e.effect_code,
      trigger_type: e.trigger,
      duration: e.duration || 'instant',
      description_zh: e.desc_zh,
      description_en: e.desc_en || '',
      effect_params: e.params || {},
      condition: e.condition || null,
      cost: e.cost || null,
      target: e.target || null,
    }));
  }

  const post = await adminFetch('/api/cards', { method: 'POST', body: JSON.stringify(card) });
  if (!post.ok) {
    log(`✗ POST 失敗 ${post.status}: ${JSON.stringify(post.body).slice(0, 250)}`);
    results.failed.push({ name: brief.name_zh, reason: 'post_failed', status: post.status, body: post.body });
    continue;
  }
  log(`✓ ${brief.name_zh} → ${post.body.data.code}`);
  results.created.push({ name: brief.name_zh, code: post.body.data.code, id: post.body.data.id });
}

log(`\n=== 結果 ===\n✓ 新建 ${results.created.length} / ⊙ 跳過 ${results.skipped.length} / ✗ 失敗 ${results.failed.length}`);
if (results.failed.length) {
  log(`\n失敗清單(留待人工審查):`);
  for (const f of results.failed) log(`  - ${f.name}: ${f.reason}`);
}
fs.writeFileSync(logPath, lines.join('\n'));
log(`\nlog: ${logPath}`);
