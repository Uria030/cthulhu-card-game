// I 陣營(深淵)30 張 lv0 初始卡 — AI 全自動生成
// 五軸:4 個 card_name(禁忌學學者 A / 隱居翻譯家 C / 獨自追蹤邪教的私家偵探 D / 古籍商人 F)+ 1 個 proficiency(assassin_hidden)
// 規範主檔:packages/client/public/admin/admin-card-prompt.js §七之四之二 軸向設計工作流程
import { adminFetch, adminGet } from './api.mjs';
import { generateValidatedCard, formatValidationReport } from './lib/generate-card.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `i-faction-cards-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# I 陣營 30 張 lv0 卡 AI 生成 ${stamp}`);

const existing = await adminGet('/api/cards');
const existingArr = Array.isArray(existing) ? existing : (existing.cards || existing.data || []);
const existingNameSet = new Set(existingArr.map((c) => c.name_zh));
log(`既有 ${existingArr.length} 張(將跳過同 name_zh 的卡)\n`);

// ──────── 30 張綱要 ────────
// 結構鎖定:series='I'(I 陣營玩家專屬批次)、faction='I'、starting_xp=0、level=0
// Gemini 自由發揮:cost / commit_icons / effects / flavor_text / 名稱英譯 / V 值估算

const I_BRIEFS = [
  // ═══ 軸 1:card_name='禁忌學學者' (Pattern A 資源回收) 6 張 ═══
  {
    name_zh: '牆角的研究室', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '禁忌學學者',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。獨處時每回合可從棄牌堆檢視 1 張「禁忌學學者」軸卡並決定是否回手。Pattern A 資源回收主泵——棄牌堆是第二個圖書館。風味:大學閣樓、堆滿古卷、同事覺得他有點瘋。費用建議 2-3。',
  },
  {
    name_zh: '學術會議邀請函', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '禁忌學學者',
    intent: '事件,費用 1。從棄牌堆取回 2 張「禁忌學學者」軸卡到手牌。Pattern A 直給型。風味:被同行推薦去參加一場小型研討會,順便整理近年發表。',
  },
  {
    name_zh: '過期的研討會手稿', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '禁忌學學者',
    intent: '資產,費用 1。持續在場(passive),每回合可棄置 1 張任意手牌 → 從棄牌堆撈 1 張同軸卡(換書動作)。Pattern A 鏡像型。風味:櫃子深處積灰的舊手稿,內容比論文更直白。',
  },
  {
    name_zh: '圖書館深夜常客', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '禁忌學學者',
    intent: '技能,費用 0。加值智力檢定 +2,獨處時再 +1(對接陣營被動)。風味:一個人坐在圖書館最角落直到關門。',
  },
  {
    name_zh: '研究筆記', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '禁忌學學者',
    intent: '技能,費用 0。加值智力檢定 +1,投入後可從棄牌堆檢視 1 張並決定抽出。Pattern A 弱版。風味:整本筆記都是別人看不懂的速記符號。',
  },
  {
    name_zh: '不情願的同事', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '禁忌學學者',
    intent: '盟友,費用 3,HP 1 SAN 2。獨處時你每回合首次抽牌變抽 2 張(模擬「他不理你但偶爾推給你他的研究」)。風味:走廊另一端那個老學者,點頭都嫌敷衍但偶爾會留紙條。',
  },

  // ═══ 軸 2:card_name='隱居翻譯家' (Pattern C 連鎖反應) 6 張 ═══
  {
    name_zh: '山間譯室', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '隱居翻譯家',
    intent: '地點關鍵卡(asset),進場後常駐(passive)。當你打出另一張「隱居翻譯家」軸卡時,翻牌頂 3 張,將其中所有同軸卡加入手牌,其餘洗回。Pattern C 連鎖反應主驅動。費用 3。風味:山間小屋的書房,壁爐永遠燒著,窗外是濃霧。',
  },
  {
    name_zh: '未完成的草稿', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '隱居翻譯家',
    intent: '資產,費用 1。持續在場(passive),每回合首次打出同軸卡時,該卡費用 -1。Pattern C 加速型。風味:書桌上一直翻到一半的譯稿,墨跡還新。',
  },
  {
    name_zh: '古希臘語辭典', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '隱居翻譯家',
    intent: '技能,費用 0。加值智力檢定 +2,可重抽 1 顆失敗骰。風味:一本你二十年前就買的辭典,翻得書脊都散了。',
  },
  {
    name_zh: '晚禱譯解', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '隱居翻譯家',
    intent: '事件,費用 1。翻牌頂 5 張,將 1 張同軸卡加入手牌、1 張任意卡加入手牌,其餘洗回。Pattern C 主搜尋。風味:晚禱時刻外文典籍突然變得清晰可解。',
  },
  {
    name_zh: '深夜的福至心靈', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '隱居翻譯家',
    intent: '事件,費用 0。抽 1 張牌;如果該牌是同軸卡,免費打出。Pattern C 連鎖型。風味:四點鐘醒來,一段卡了三個月的譯文突然通了。',
  },
  {
    name_zh: '隱居書房的鋼筆', card_type: 'asset', slot: 'one_hand',
    combat_style: 'sidearm',
    primary_axis_layer: 'card_name', primary_axis_value: '隱居翻譯家',
    intent: '隨身武器(sidearm,sub-style assassin_hidden 也可),費用 1,weapon_tier=1。平時寫字、危急時刺。屬性修正用智力(violation 違和即資產:精緻知識器具當武器)。風味:伯父留的鋼筆,墨水暗紅得像他翻譯時不小心刺到的指尖。',
  },

  // ═══ 軸 3:card_name='獨自追蹤邪教的私家偵探' (Pattern D 跨時機配合) 6 張 ═══
  {
    name_zh: '偵探事務所', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '獨自追蹤邪教的私家偵探',
    intent: '地點關鍵卡(asset),進場後常駐(passive)。持續累計「監視標記」,每回合首次調查時 +1 標記。當累計到 3 個標記時可消費全部 → 對任意敵人造成 5 點傷害。Pattern D 三回合預備爆發完美實現 I 戰鬥哲學「研究→準備→處決」。費用 3。風味:三樓老房間,牆上貼滿剪報,紅線串起六起失蹤案。',
  },
  {
    name_zh: '觀察與耐心', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '獨自追蹤邪教的私家偵探',
    intent: '技能,費用 0。加值智力檢定 +1。這次檢定成功後在「偵探事務所」放 1 個監視標記(技能交互引擎)。風味:你不出聲也不動,只是看。三小時後對方終於做出你預期的動作。',
  },
  {
    name_zh: '定點監視', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '獨自追蹤邪教的私家偵探',
    intent: '事件(反應型,trigger=reaction),費用 1。在敵人移動時:看該敵人下回合行動,並在「偵探事務所」放 1 個監視標記。Pattern D 跨時機配合主驅動。風味:車內坐了六小時,只為了確認他下車後左轉。',
  },
  {
    name_zh: '預判出擊', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '獨自追蹤邪教的私家偵探',
    intent: '事件(反應型,trigger=reaction),費用 2。在敵人準備攻擊時:對該敵人造成 3 點傷害並施加 marked。如果「偵探事務所」有 ≥2 個監視標記,額外 +2 傷害。Pattern D 爆發核心。風味:他舉手的瞬間,你已經在他前面三步。',
  },
  {
    name_zh: '掌握行動規律', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '獨自追蹤邪教的私家偵探',
    intent: '技能,費用 0。加值智力檢定 +1,本次檢定查看牌頂 3 張並可重排(I 陣營典型牌庫操控)。風味:你不是預知未來,你只是知道他每天九點在哪扣鞋帶。',
  },
  {
    name_zh: '線人的密報', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '獨自追蹤邪教的私家偵探',
    intent: '盟友,費用 2,HP 1 SAN 1。每回合自動在「偵探事務所」放 1 個監視標記。注意:此盟友不戰鬥(I 陣營盟友是抽象「資訊管道」,不是 E 陣營的具體助拳人)。風味:他從不留電話,但你的事務所信箱每週三會多一張紙條。',
  },

  // ═══ 軸 4:card_name='古籍商人' (Pattern F 鏡像效果) 6 張 ═══
  {
    name_zh: '沒招牌的書店', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '古籍商人',
    intent: '地點關鍵卡(asset),進場後常駐(passive)。當你「消費」任意「古籍商人」軸卡時,從牌庫頂抽 1 張同軸卡到手。Pattern F 鏡像主驅動(消費 A → 抽到 B,買書動作觸發進貨)。費用 3。風味:一條從不亮燈的小巷,只有特定客人知道地下室有書架。',
  },
  {
    name_zh: '私人收藏典籍', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '古籍商人',
    intent: '資產,費用 2。持續在場(passive),每當有同軸卡進場,你智力 +1 直到回合結束(鏡像強化:卡進場↔屬性增益)。風味:店面不到十坪,你私人的收藏比店面大十倍,沒人看過全貌。',
  },
  {
    name_zh: '暗號往來', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '古籍商人',
    intent: '事件,費用 1。從牌庫頂查看 5 張,你選 2 張加入手牌。如果加入了 2 張同軸卡,該回合下次智力檢定自動成功。Pattern F 鏡像強化(進貨→雙倍命中)。風味:一封寫在書頁邊角的密信,只有同行能讀。',
  },
  {
    name_zh: '鑑定為真', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '古籍商人',
    intent: '技能,費用 0。加值智力檢定 +2。如果該檢定成功:抽 1 張牌(鏡像:鑑定真偽↔確認後得情報)。風味:你拿起書頁對著光看了三秒,放下時對方的臉色變了。',
  },
  {
    name_zh: '同好交換', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '古籍商人',
    intent: '事件,費用 1。棄置 1 張手牌,從牌庫搜尋 1 張同軸卡加入手牌(交換書↔換書,鏡像對稱)。風味:不是錢能買的書,只能拿同等級的書交換。',
  },
  {
    name_zh: '收銀機的鋼刀', card_type: 'asset', slot: 'one_hand',
    combat_style: 'sidearm',
    primary_axis_layer: 'card_name', primary_axis_value: '古籍商人',
    intent: '隨身武器(sidearm_dagger),費用 1,weapon_tier=1。造成傷害並施加 marked。違和即資產:孤僻書商×精緻冷兵器的張力。風味:櫃台底下藏的小刀,從沒拔出過,但你每天都磨。',
  },

  // ═══ 軸 5:proficiency='assassin_hidden' (毒藥/暗器,橫向武器軸) 6 張 ═══
  {
    name_zh: '劇毒小瓶', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'proficiency', primary_axis_value: 'assassin_hidden',
    intent: '配件型武器(accessory slot),費用 2,3 次使用。消費後讓敵人下次攻擊前進行體質檢定 (DC 14),失敗承受 4 點傷害並施加 poison 2 層。預先設毒(毒發在敵人身上)。風味:玻璃瓶底部沉著綠色結晶,你用蠟封口三次。',
  },
  {
    name_zh: '迷幻毒粉', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'proficiency', primary_axis_value: 'assassin_hidden',
    intent: '配件型武器(accessory),費用 1,2 次使用。消費後敵人施加 madness 1,且你下回合可在無交戰狀態下移動到任何相鄰地點(逃脫機制)。風味:倒進酒裡看不見、聞不出,只有他的瞳孔會洩底。',
  },
  {
    name_zh: '致命暗扣', card_type: 'asset', slot: 'one_hand',
    combat_style: 'assassin',
    primary_axis_layer: 'proficiency', primary_axis_value: 'assassin_hidden',
    intent: '武器(assassin_hidden + sidearm_dagger 兼容),費用 2,weapon_tier=2。造成 4 點傷害,獨處時 +2 傷害(完美對接陣營被動)。風味:袖口暗扣式機關,平時看不出是武器。',
  },
  {
    name_zh: '預備毒解', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'proficiency', primary_axis_value: 'assassin_hidden',
    intent: '技能,費用 0。加值智力檢定 +1。如果該檢定為「使用 assassin_hidden 武器」前置研究,該武器本回合 +2 傷害(I 陣營戰鬥哲學:研究→處決)。風味:你不是先動手,你是先讀過十本毒理學。',
  },
  {
    name_zh: '隱身刺殺', card_type: 'event', slot: 'none',
    primary_axis_layer: 'proficiency', primary_axis_value: 'assassin_hidden',
    intent: '事件(反應型,trigger=reaction),費用 2。獨處時消費一個 assassin_hidden 武器,該攻擊造成雙倍傷害並施加 stun_enemy。對接 I 戰鬥節奏的「處決」階段。風味:他甚至沒看見你進過房間。',
  },
  {
    name_zh: '雜物中的針頭', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'proficiency', primary_axis_value: 'assassin_hidden',
    intent: '隱藏武器(accessory),費用 1,weapon_tier=1。造成 1 點傷害 + poison 3 層(毒持續發作)。特殊機制:藏在手牌中,直到使用前不被視為武器卡(社交場合可帶,不被搜走)。風味:可能是縫衣針、可能是藥劑師的實驗工具,反正不是兇器——直到它是。',
  },
];

log(`目標 ${I_BRIEFS.length} 張\n`);

const results = { created: [], skipped: [], failed: [] };

for (let i = 0; i < I_BRIEFS.length; i++) {
  const brief = I_BRIEFS[i];
  log(`\n─── [${i + 1}/${I_BRIEFS.length}] ${brief.name_zh} ───`);

  // 冪等:既有同 name_zh 跳過
  if (existingNameSet.has(brief.name_zh)) {
    log(`⊙ skip(既有):${brief.name_zh}`);
    results.skipped.push(brief.name_zh);
    continue;
  }

  // 組 userDescription:綱要 + 結構鎖定提示(對齊規範主檔 §七之四之二 設計流程)
  const lockHints = [];
  lockHints.push(`卡名:「${brief.name_zh}」(必須使用此名,不要修改)`);
  if (brief.card_type) lockHints.push(`類型:${brief.card_type}`);
  if (brief.slot) lockHints.push(`配件欄:${brief.slot}`);
  if (brief.combat_style) lockHints.push(`戰鬥風格:${brief.combat_style}`);
  if (brief.primary_axis_layer) lockHints.push(`primary_axis_layer:${brief.primary_axis_layer}`);
  if (brief.primary_axis_value) lockHints.push(`primary_axis_value:${brief.primary_axis_value}(純名,DB 不存書名號)`);
  lockHints.push(`series:I(I 陣營批次)`);
  lockHints.push(`faction:I(深淵)`);
  lockHints.push(`star/level:0(基礎卡)`);

  const userDescription = [
    `## 綱要(設計意圖)`,
    brief.intent,
    ``,
    `## 結構鎖定(必須照填)`,
    lockHints.map((s) => '- ' + s).join('\n'),
    ``,
    `## I 陣營(深淵)氣質提醒`,
    `- 一句話:你知道的越多,你就越孤獨。但你也越強。`,
    `- 核心策略:手牌精準度大師(牌庫操控、看牌頂、重新排列)`,
    `- 陣營基礎被動:獨處時(同地點無隊友)所有檢定 +1 — 設計時可加成這個被動`,
    `- 戰鬥節奏:研究→準備→處決,慢節奏一擊致命`,
    `- 風味:深靛藍,深夜、深海、獨處的寧靜與危險`,
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
      existingFilter: { faction: 'I', primary_axis_value: brief.primary_axis_value },
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

  // 強制鎖定欄位
  const card = r.card;
  card.series = 'I';
  if (card.starting_xp == null) card.starting_xp = 0;
  if (card.level == null) card.level = 0;
  if (!card.faction) card.faction = 'I';
  if (brief.card_type) card.card_type = brief.card_type;
  if (brief.slot) card.slot = brief.slot;
  if (brief.combat_style) card.combat_style = brief.combat_style;
  if (brief.primary_axis_layer) card.primary_axis_layer = brief.primary_axis_layer;
  if (brief.primary_axis_value) card.primary_axis_value = brief.primary_axis_value;
  if (!card.name_zh || card.name_zh !== brief.name_zh) card.name_zh = brief.name_zh;

  // shape 對齊後台 API:effects[].description_zh / description_en / effect_params(舊欄位)
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

  // POST
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
