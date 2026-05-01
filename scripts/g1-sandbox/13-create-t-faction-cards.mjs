// T 陣營(解析 The Cipher)30 張 lv0 初始卡 — AI 全自動生成
// 五軸:4 個 card_name(軍事顧問 D / 密碼學家 C / 退伍工兵 F / 資料分析師 A)+ 1 個 combat_style(archery)
// 規範主檔:packages/client/public/admin/admin-card-prompt.js §七之四之二 軸向設計工作流程
// Pattern 跨陣營無衝突(E=BCDE, I=ACDF, S=ABEF, N=ACDE, T=ACDF)
import { adminFetch, adminGet } from './api.mjs';
import { generateValidatedCard, formatValidationReport } from './lib/generate-card.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `t-faction-cards-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# T 陣營 30 張 lv0 卡 AI 生成 ${stamp}`);

const existing = await adminGet('/api/cards');
const existingArr = Array.isArray(existing) ? existing : (existing.cards || existing.data || []);
const existingNameSet = new Set(existingArr.map((c) => c.name_zh));
log(`既有 ${existingArr.length} 張(將跳過同 name_zh 的卡)\n`);

const T_BRIEFS = [
  // ═══ 軸 1:card_name='軍事顧問' (Pattern D 跨時機配合) 6 張 ═══
  {
    name_zh: '前線指揮帳', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '軍事顧問',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。【反應】在敵人對你發動攻擊時:你的反應檢定 +2,且若反應檢定成功,該攻擊傷害 −1。Pattern D 跨時機配合主驅動——在「敵人動作時」插入計算。風味:摺疊行軍桌、戰術地圖釘滿紅藍標,還沒來得及擦掉戰役編號。費用 3。',
  },
  {
    name_zh: '彈道計算', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '軍事顧問',
    intent: '技能,費用 0。加值敏捷檢定 +1。【加值】如果該檢定用於 archery 或 shooting 攻擊,額外 +1 傷害。Pattern D 跨時機配合(把技能投入時機跨到攻擊解算時)。風味:風速、距離、目標的呼吸節奏——三秒內全部跑完一遍。',
  },
  {
    name_zh: '預判走位', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '軍事顧問',
    intent: '事件,費用 1。【反應】在敵人移動進入你所在地點時:對該敵人放置 1 個 marked 標記,且本回合對該敵人的攻擊 +1 傷害。Pattern D 跨時機配合核心(在敵人動作中段插入)。風味:他的左腳先動了——你已經知道他要繞到你的盲點,但你的箭會更快。',
  },
  {
    name_zh: '戰術重擲', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '軍事顧問',
    intent: '技能,費用 0。加值敏捷檢定 +1(對接 T 主屬性)。【加值】此技能投入到一個檢定後,如果該檢定失敗,你可以重擲該檢定 1 次(對接陣營基礎被動「重擲 1 次」的卡名強化版)。風味:第一次失誤是運氣,第二次,是計算。',
  },
  {
    name_zh: '老參謀', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '軍事顧問',
    intent: '盟友,費用 3,HP 1 SAN 2。【反應】在你進行任何檢定前:此盟友可加值該檢定 +1,且如果該檢定為 archery 攻擊,額外 +1 傷害。Pattern D 跨時機配合(時機在檢定觸發前)。風味:你年輕時的指揮官,現在退休住在湖邊,但只要你開口,他還會穿上舊大衣出門。',
  },
  {
    name_zh: '指揮官左輪', card_type: 'asset', slot: 'one_hand',
    combat_style: 'shooting',
    primary_axis_layer: 'card_name', primary_axis_value: '軍事顧問',
    intent: '隨身武器(shooting),費用 2,weapon_tier 2,6 發,造成 4 點傷害。經典軍官配槍。【反應】在你以此武器完成一次成功攻擊後:你下次反應檢定 +1。Pattern D 跨時機配合(攻擊後加成跨到下次反應)。風味:配發的點 38 左輪,槍把磨出包漿,扳機卻比新槍還順。',
  },

  // ═══ 軸 2:card_name='密碼學家' (Pattern C 連鎖反應) 6 張 ═══
  {
    name_zh: '解碼工作室', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '密碼學家',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。【被動】在你獲得 1 個線索時:翻牌頂 1 張,如果是「密碼學家」軸卡或事件卡,加入手牌,否則洗回。Pattern C 連鎖反應主驅動——線索觸發抽牌,抽到同軸再連鎖。風味:三台打字機、滿牆釘的密文紙條、半空咖啡杯。費用 3。',
  },
  {
    name_zh: '頻譜分析儀', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '密碼學家',
    intent: '資產,費用 2。持續在場(passive)。【被動】在你打出另一張「密碼學家」軸卡時:在你所在地點放置 1 個線索。Pattern C 連鎖反應(同軸打牌→生線索→其他卡再觸發)。風味:綠色示波器螢幕上的波形,在你眼裡都是字母。',
  },
  {
    name_zh: '截獲密文', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '密碼學家',
    intent: '事件,費用 1。在你所在地點獲得 1 個線索。【加值】如果你場上有「解碼工作室」或「頻譜分析儀」,翻牌頂 2 張,將其中所有同軸卡加入手牌,其餘洗回。Pattern C 連鎖反應(條件觸發鏈式抽牌)。風味:電報員昏厥前的最後一段亂碼,你看了三秒就笑了。',
  },
  {
    name_zh: '模式辨識', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '密碼學家',
    intent: '技能,費用 0。加值智力檢定 +2。【加值】如果該檢定成功,在你所在地點獲得 1 個線索(連鎖型——成功觸發資源)。Pattern C 連鎖反應弱版。風味:邪教徒的禱詞、儀式手勢的節奏、屍體的擺位——全部都在說同一個句子。',
  },
  {
    name_zh: '加密電報', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '密碼學家',
    intent: '事件,費用 0。【行動】從你的牌庫搜尋 1 張「密碼學家」軸卡,展示後加入手牌,然後洗牌。Pattern C 連鎖反應(搜尋型,同軸觸發鏈)。風味:不是用筆寫的,是用 5 種顏色的線在紙上織出來的。',
  },
  {
    name_zh: '助理譯員', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '密碼學家',
    intent: '盟友,費用 3,HP 1 SAN 2。【被動】在你獲得 1 個線索時:此盟友本回合可加值你下次智力檢定 +1。Pattern C 連鎖反應(線索→盟友被動→下次檢定加成)。風味:她比你年輕 30 歲,打字速度是你的兩倍,而且不會因為密文太瘋狂而吐。',
  },

  // ═══ 軸 3:card_name='退伍工兵' (Pattern F 鏡像效果) 6 張 ═══
  {
    name_zh: '工兵作業所', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退伍工兵',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。【被動】在你以 archery 或 engineer 攻擊造成傷害時:翻牌頂 1 張,如果是「退伍工兵」軸卡,加入手牌,否則洗回(鏡像:出力→回收)。Pattern F 鏡像效果主驅動。風味:車庫改的工作間,牆上掛著拆解圖、桌上躺著半成品陷阱機構。費用 3。',
  },
  {
    name_zh: '陷阱觸發器', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'card_name', primary_axis_value: '退伍工兵',
    intent: '配件型資產,費用 2。持續在場(passive)。【反應】在敵人進入你所在地點時:對該敵人造成 2 點傷害並施加 weakened 1 層(鏡像:敵人動作→你的反擊)。Pattern F 鏡像效果(敵人前進與你的反擊互為鏡)。風味:踩線、繃簧、旋轉刃——靈魂全裝在這 30 公分的小盒子裡。',
  },
  {
    name_zh: '爆破預備', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退伍工兵',
    intent: '事件,費用 2。對你所在地點的所有敵人造成 2 點傷害(鏡像:同地點同效果)。【加值】如果你場上有「工兵作業所」,額外對所有敵人施加 marked 1 層。Pattern F 鏡像效果(範圍對等傷害)。風味:你預先埋好的炸藥不是為了殺,是為了讓他們知道——這條路是你劃出來的。',
  },
  {
    name_zh: '機械手感', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退伍工兵',
    intent: '技能,費用 0。加值敏捷檢定 +1。【加值】如果該檢定成功:你下次 archery 攻擊 +1 傷害(鏡像:檢定成功↔攻擊增強)。Pattern F 鏡像效果。風味:你的手指比眼睛快,不需要看也知道齒輪有沒有歸位。',
  },
  {
    name_zh: '拆彈直覺', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退伍工兵',
    intent: '技能,費用 0。加值敏捷檢定 +2(對接 T 主屬性)。【加值】如果該檢定為破除遭遇卡或解除陷阱類動作,額外 +1。風味:不是膽大,是你已經拆過 200 顆,知道哪一條線會殺你。',
  },
  {
    name_zh: '老式長弓', card_type: 'asset', slot: 'two_hand',
    combat_style: 'archery',
    primary_axis_layer: 'card_name', primary_axis_value: '退伍工兵',
    intent: '雙手武器(archery),費用 2,weapon_tier 2,8 支箭,造成 3 點傷害。【加值】在你以此武器命中敵人時,如果該敵人有 marked 標記,額外 +2 傷害(鏡像:標記↔火力)。Pattern F 鏡像效果。風味:當年在工兵連學的不只是炸,還有最古老的、安靜的殺人方式。',
  },

  // ═══ 軸 4:card_name='資料分析師' (Pattern A 資源回收) 6 張 ═══
  {
    name_zh: '檔案分析室', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '資料分析師',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。【被動】每回合首次抽牌時:可從棄牌堆檢視 1 張「資料分析師」軸卡並決定是否回手(資料庫永遠在重建索引)。Pattern A 資源回收主泵——棄牌堆是「已查過的卷宗」。風味:三台打孔卡讀卡機、幾十個檔案櫃、永遠不關的日光燈。費用 3。',
  },
  {
    name_zh: '舊資料夾', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '資料分析師',
    intent: '事件,費用 1。從棄牌堆取回 2 張「資料分析師」軸卡到手牌。Pattern A 資源回收直給型。風味:檔案室最底層、貼著 1923 年標籤的資料夾,你以為早歸檔了。',
  },
  {
    name_zh: '索引筆記', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '資料分析師',
    intent: '資產,費用 1。持續在場(passive)。【被動】每回合可棄置 1 張任意手牌 → 從棄牌堆撈 1 張「資料分析師」軸卡到手牌(換頁:棄掉舊資料、撿回更舊的資料)。Pattern A 鏡像型。風味:你的索引比檔案本身還厚,因為你習慣標註自己的批註。',
  },
  {
    name_zh: '交叉比對', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '資料分析師',
    intent: '技能,費用 0。加值智力檢定 +2。【加值】投入後可從棄牌堆檢視 1 張並決定抽出(回收弱版)。Pattern A 弱版。風味:單一線索是雜訊,3 條交叉就是訊號。',
  },
  {
    name_zh: '統計直覺', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '資料分析師',
    intent: '技能,費用 0。加值敏捷檢定 +1(對接 T 主屬性)。【加值】如果你的棄牌堆有 ≥3 張「資料分析師」軸卡,額外 +1。風味:你不需要算,你只需要看一眼分布,就知道答案在右上角第三格。',
  },
  {
    name_zh: '檔案室助手', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '資料分析師',
    intent: '盟友,費用 3,HP 1 SAN 2。【被動】在你從棄牌堆取回任何 1 張卡時:此盟友本回合可加值你下次智力檢定 +1。Pattern A 資源回收(回收動作觸發盟友光環)。風味:他叫得出每一份檔案的編號,但記不住自己昨晚吃了什麼。',
  },

  // ═══ 軸 5:combat_style='archery' (橫向武器軸) 6 張 ═══
  {
    name_zh: '反曲弓', card_type: 'asset', slot: 'two_hand',
    combat_style: 'archery',
    primary_axis_layer: 'combat_style', primary_axis_value: 'archery',
    intent: '雙手武器(archery),費用 3,weapon_tier 3,10 支箭,造成 4 點傷害。比長弓便攜、比短弓有力。風味:現代運動弓,輕、快、力學設計到極致——你帶它調查比帶手槍更安心。',
  },
  {
    name_zh: '十字弓', card_type: 'asset', slot: 'two_hand',
    combat_style: 'archery',
    primary_axis_layer: 'combat_style', primary_axis_value: 'archery',
    intent: '雙手武器(archery),費用 3,weapon_tier 3,5 支箭,造成 5 點傷害。【加值】此武器命中時,對該敵人施加 marked 1 層。風味:扣板機才能擊發,所以慢——但任何穿透的東西都不會再站起來。',
  },
  {
    name_zh: '穿甲箭', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'archery',
    intent: '配件型彈藥,費用 1。【消費】可消費此卡 → 為一把 archery 武器補充 5 支「穿甲箭」狀態,該武器下次攻擊時無視敵人 armor 並 +1 傷害。風味:鋼芯穿甲、菱形彈頭——對付穿著儀式鎧甲的邪教徒專用。',
  },
  {
    name_zh: '輕量箭袋', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'archery',
    intent: '配件,費用 1。【消費】可消費此卡 → 為一把 archery 武器補充 8 支標準箭。風味:背在腰側,跑步時不會晃。',
  },
  {
    name_zh: '弓手戒指', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'archery',
    intent: '配件,費用 2。持續在場(passive)。【加值】你以 archery 攻擊時敏捷 +1。風味:傳統射箭運動員的拇指扣戒,皮製、磨得發亮。',
  },
  {
    name_zh: '火光箭', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'archery',
    intent: '配件型彈藥,費用 1。【消費】可消費此卡 → 為一把 archery 武器替換為「火光箭」狀態,該武器下次攻擊時對該敵人造成 burning 2 層,且該地點本回合 darkness 解除。風味:箭頭包油布、點燃就射——既能燒,也能照亮。',
  },
];

log(`目標 ${T_BRIEFS.length} 張\n`);

const results = { created: [], skipped: [], failed: [] };

for (let i = 0; i < T_BRIEFS.length; i++) {
  const brief = T_BRIEFS[i];
  log(`\n─── [${i + 1}/${T_BRIEFS.length}] ${brief.name_zh} ───`);

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
  lockHints.push(`series:T(T 陣營批次)`);
  lockHints.push(`faction:T(解析)`);
  lockHints.push(`star/level:0(基礎卡)`);

  const userDescription = [
    `## 綱要(設計意圖)`,
    brief.intent,
    ``,
    `## 結構鎖定(必須照填)`,
    lockHints.map((s) => '- ' + s).join('\n'),
    ``,
    `## T 陣營(解析 The Cipher)氣質提醒`,
    `- 一句話:給我時間,我能把任何混亂簡化為一個公式。`,
    `- 核心策略:戰場計算者(弱點揭露、敵人行為預測、檢定重擲、戰術佈局、資源效率最大化)`,
    `- 陣營基礎被動:戰鬥中可重擲 1 次檢定(每回合 1 次)— 設計時可加成這個被動`,
    `- 戰鬥節奏:archery 弓術(冷靜瞄準、計算彈道),敏捷為主屬性`,
    `- 風味:冷鋼藍,手術刀、精密儀器、戰術地圖、計算尺、密碼紙條的質感`,
    `- 角色原型不是書齋學者(那是 I 深淵),是「戰場上還能冷靜計算的實作者」`,
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
      existingFilter: { faction: 'T', primary_axis_value: brief.primary_axis_value },
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
  card.series = 'T';
  if (card.starting_xp == null) card.starting_xp = 0;
  if (card.level == null) card.level = 0;
  if (!card.faction) card.faction = 'T';
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
