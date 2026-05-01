// S 陣營(鐵證)30 張 lv0 初始卡 — AI 全自動生成
// 五軸:4 個 card_name(法醫 A / 私人偵探 B / 邊疆警長 E / 彈道專家 F)+ 1 個 combat_style(shooting)
// 規範主檔:packages/client/public/admin/admin-card-prompt.js §七之四之二 軸向設計工作流程
// Pattern 跨陣營無衝突(E=BCDE, I=ACDF, S=ABEF)
import { adminFetch, adminGet } from './api.mjs';
import { generateValidatedCard, formatValidationReport } from './lib/generate-card.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `s-faction-cards-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# S 陣營 30 張 lv0 卡 AI 生成 ${stamp}`);

const existing = await adminGet('/api/cards');
const existingArr = Array.isArray(existing) ? existing : (existing.cards || existing.data || []);
const existingNameSet = new Set(existingArr.map((c) => c.name_zh));
log(`既有 ${existingArr.length} 張(將跳過同 name_zh 的卡)\n`);

const S_BRIEFS = [
  // ═══ 軸 1:card_name='法醫' (Pattern A 資源回收) 6 張 ═══
  {
    name_zh: '解剖室', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '法醫',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。獨處時每回合可從棄牌堆檢視 1 張「法醫」軸卡並決定是否回手。Pattern A 資源回收主泵——棄牌堆是「過去解剖過的記錄」,需要時撈回。風味:冷光燈、不鏽鋼解剖台、福馬林氣味。費用建議 2-3。',
  },
  {
    name_zh: '檔案調閱', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '法醫',
    intent: '事件,費用 1。從棄牌堆取回 2 張「法醫」軸卡到手牌。Pattern A 直給型。風味:警局檔案室,翻出 1947 年那起未解的解剖報告。',
  },
  {
    name_zh: '舊案卷宗', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '法醫',
    intent: '資產,費用 1。持續在場(passive),每回合可棄置 1 張任意手牌 → 從棄牌堆撈 1 張同軸卡(換書動作)。Pattern A 鏡像型。風味:堆在桌角的舊案卷,有些封面早已泛黃。',
  },
  {
    name_zh: '解剖學知識', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '法醫',
    intent: '技能,費用 0。加值智力檢定 +2,獨處時再 +1(對接陣營「搜索額外發現」氣質的內向版)。風味:你不是讀書讀的,是切過上千具屍體切出來的。',
  },
  {
    name_zh: '採樣紀錄', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '法醫',
    intent: '技能,費用 0。加值感知檢定 +1,投入後可從棄牌堆檢視 1 張並決定抽出。Pattern A 弱版。風味:每一次採樣都標號、每一個樣本都歸檔。',
  },
  {
    name_zh: '法醫助手', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '法醫',
    intent: '盟友,費用 3,HP 1 SAN 2(對接 §4.7 代表盟友)。每回合首次抽牌變抽 2 張(模擬「他幫你整理現場記錄」)。風味:話不多,但永遠記得每一份報告的編號。',
  },

  // ═══ 軸 2:card_name='私人偵探' (Pattern B 質變閾值) 6 張 ═══
  {
    name_zh: '偵探辦公室', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '私人偵探',
    intent: '地點關鍵卡(asset),進場後常駐(passive)。當你場上有 ≥3 張「私人偵探」軸資產卡時,你進入新地點時 +1 線索,且本回合所有搜索行動 +2 額外發現。Pattern B 質變閾值主驅動——堆裝備到位質變。風味:磨亮的木桌、半空的威士忌、牆上釘滿剪報。費用 3。',
  },
  {
    name_zh: '辦公室標本櫃', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '私人偵探',
    intent: '資產,費用 2。持續在場(passive),你進入新地點時放 1 個「證物」標記在此卡上。當「證物」≥3 時,你的所有 perception 檢定 +1。Pattern B 累積型。風味:標本櫃裡有蝴蝶標本、毒草、染血手帕——全是案件證物。',
  },
  {
    name_zh: '犯罪現場重建', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '私人偵探',
    intent: '事件,費用 2。在你所在地點翻牌頂 5 張,將其中所有同軸卡或線索類卡加入手牌,其餘洗回。風味:你在現場站了 20 分鐘,然後突然開始說話,把整個案件還原給警方聽。',
  },
  {
    name_zh: '隱藏相機', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'card_name', primary_axis_value: '私人偵探',
    intent: '配件型資產,費用 2。持續在場(passive),在敵人進入你所在地點時自動放 1 個 marked 標記。風味:藏在書架第三層、看似裝飾的小盒子。',
  },
  {
    name_zh: '觀察入微', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '私人偵探',
    intent: '技能,費用 0。加值感知檢定 +2(對接 S 主屬性)。風味:三秒鐘掃過房間,你已記下 47 個細節。',
  },
  {
    name_zh: '私家警員左輪', card_type: 'asset', slot: 'one_hand',
    combat_style: 'shooting',
    primary_axis_layer: 'card_name', primary_axis_value: '私人偵探',
    intent: '隨身武器(shooting),費用 2,weapon_tier 2,6 發。獨立偵探的標準配備,造成 4 點傷害並消耗 1 彈。風味:不是警局配給,是自己掏錢買的。',
  },

  // ═══ 軸 3:card_name='邊疆警長' (Pattern E 成本轉移) 6 張 ═══
  {
    name_zh: '小鎮警局', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '邊疆警長',
    intent: '地點關鍵卡(asset),進場後常駐(passive)。【行動】可棄置 1 張任意手牌 → 該回合下次裝備類資產卡費用 -2。Pattern E 成本轉移主驅動——你動用的是「警局公權力」這種槓桿。風味:鳥不生蛋小鎮的單層警局,門口拴著一條狗。費用 3。',
  },
  {
    name_zh: '老式左輪', card_type: 'asset', slot: 'one_hand',
    combat_style: 'shooting',
    primary_axis_layer: 'card_name', primary_axis_value: '邊疆警長',
    intent: '隨身武器(shooting),費用 2,weapon_tier 2,6 發。經典警長配槍(§4.7 + §4.8 多次明示)。造成 4 點傷害+消耗 1 彈。風味:祖父留下來的點 38 左輪,擊錘磨得發亮。',
  },
  {
    name_zh: '警長徽章', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'card_name', primary_axis_value: '邊疆警長',
    intent: '配件型資產,費用 1。持續在場(passive),你進入新地點時可棄置 1 張任意手牌 → 在該地點獲得 1 個線索。Pattern E 成本轉移弱版。風味:磨損的銅質徽章,號數比你的鬍子還老。',
  },
  {
    name_zh: '連發補射', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '邊疆警長',
    intent: '事件,費用 1。【反應】在你完成一次 shooting 攻擊後:可棄置 1 張任意手牌 → 對該敵人進行 1 次額外 shooting 攻擊(無需消耗彈藥)。Pattern E 成本轉移核心。風味:扣完第一發後,你沒停。',
  },
  {
    name_zh: '警局密室', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '邊疆警長',
    intent: '事件,費用 0。棄置 1 張任意陣營卡(可以是 E/I/N/T/F/J/P)→ 抽 2 張牌(模擬「動用其他派系線人」,跨派系借力的成本轉移)。風味:警局後面那間沒有窗的房間,放著你不願意正式建檔的東西。',
  },
  {
    name_zh: '冷靜瞄準', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '邊疆警長',
    intent: '技能,費用 0。加值感知檢定 +1。如果該檢定用於 shooting 攻擊,額外 +1 傷害。風味:呼氣,等心跳間隔——這套你練了 30 年。',
  },

  // ═══ 軸 4:card_name='彈道專家' (Pattern F 鏡像效果) 6 張 ═══
  {
    name_zh: '彈道實驗室', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '彈道專家',
    intent: '地點關鍵卡(asset),進場後常駐(passive)。當你以 shooting 攻擊造成傷害時,你抽 1 張牌(鏡像:射擊→彈痕記錄→情報)。Pattern F 鏡像主驅動。風味:牆上掛著 200 顆不同口徑彈頭,每顆都有編號。費用 3。',
  },
  {
    name_zh: '比對顯微鏡', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '彈道專家',
    intent: '資產,費用 2。持續在場(passive),當你獲得線索時,該回合所有 shooting 攻擊 +1 傷害(鏡像:證據累積↔火力增強)。風味:你能從彈痕的旋轉紋路推斷出射手的握槍習慣。',
  },
  {
    name_zh: '彈殼採集袋', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'card_name', primary_axis_value: '彈道專家',
    intent: '配件型,費用 1。你成功 shooting 攻擊敵人時,放 1 個「彈痕」標記在此卡上。當「彈痕」≥3 時可消費 → 抽 2 張牌並在所在地點獲得 1 個線索。Pattern F 鏡像觸發。風味:每顆撿來的彈殼都裝小袋編號,案件結案後歸檔。',
  },
  {
    name_zh: '熟練解析', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '彈道專家',
    intent: '技能,費用 0。加值智力檢定 +2。如果該檢定成功:抽 1 張牌(鏡像:解析→確認→獎勵)。風味:你不需要儀器,光看就能辨型號。',
  },
  {
    name_zh: '彈道測試', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '彈道專家',
    intent: '事件,費用 1。對你所在地點的 1 個敵人放置 1 個 marked 標記,該回合對該敵人的 shooting 攻擊 +2 傷害(鏡像:標記→火力)。風味:你拿起一顆過期子彈往牆上射,聽聲音判斷他的肌肉組織密度。',
  },
  {
    name_zh: '比對紀錄筆記', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '彈道專家',
    intent: '資產,費用 2。【被動】只要棄牌堆有 ≥3 張同軸卡,此卡費用 -2(打出時若條件達成,實際費用 0)。Pattern F 鏡像降本。風味:你翻過去的每一頁都成了下一頁的索引。',
  },

  // ═══ 軸 5:combat_style='shooting' (橫向武器軸) 6 張 ═══
  {
    name_zh: '雙管獵槍', card_type: 'asset', slot: 'two_hand',
    combat_style: 'shooting',
    primary_axis_layer: 'combat_style', primary_axis_value: 'shooting',
    intent: '雙手武器(shooting),費用 3,weapon_tier 3,2 發,造成 6 點傷害(高傷高消耗)。風味:狩獵夜行性動物時的標準裝備,雙管齊發的瞬間什麼都活不過。',
  },
  {
    name_zh: '消音器', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'shooting',
    intent: '配件,費用 1。持續在場(passive),你以 shooting 攻擊時,該攻擊不會驚動該地點的其他敵人(暗中作業)。風味:旋上槍口的瞬間,世界突然變得安靜。',
  },
  {
    name_zh: '子彈夾', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'shooting',
    intent: '配件,費用 1。【消費】可消費此卡 → 為一把 shooting 武器補充 6 發彈藥。風味:多一個彈夾,多一條命。',
  },
  {
    name_zh: '瞄準鏡', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'shooting',
    intent: '配件,費用 2。持續在場(passive),你以 shooting 攻擊時感知 +1。風味:十字線壓上目標的一刻,全世界都慢下來。',
  },
  {
    name_zh: '卡賓步槍', card_type: 'asset', slot: 'two_hand',
    combat_style: 'shooting',
    primary_axis_layer: 'combat_style', primary_axis_value: 'shooting',
    intent: '雙手武器(shooting),費用 3,weapon_tier 3,8 發,造成 5 點傷害。比手槍精準,比獵槍便攜。風味:M1 卡賓的小巧曲線,軍隊退役後流到民間的好物。',
  },
  {
    name_zh: '霰彈', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'shooting',
    intent: '配件型彈藥,費用 1。【消費】可消費此卡 → 為一把 shooting 武器替換為「霰彈」狀態,該武器下次攻擊時對地點所有敵人造成 2 點傷害(範圍轟擊)。風味:打鳥的子彈,打人也行。',
  },
];

log(`目標 ${S_BRIEFS.length} 張\n`);

const results = { created: [], skipped: [], failed: [] };

for (let i = 0; i < S_BRIEFS.length; i++) {
  const brief = S_BRIEFS[i];
  log(`\n─── [${i + 1}/${S_BRIEFS.length}] ${brief.name_zh} ───`);

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
  lockHints.push(`series:S(S 陣營批次)`);
  lockHints.push(`faction:S(鐵證)`);
  lockHints.push(`star/level:0(基礎卡)`);

  const userDescription = [
    `## 綱要(設計意圖)`,
    brief.intent,
    ``,
    `## 結構鎖定(必須照填)`,
    lockHints.map((s) => '- ' + s).join('\n'),
    ``,
    `## S 陣營(鐵證)氣質提醒`,
    `- 一句話:我只相信我親眼看到、親手摸到、親自驗證的東西。`,
    `- 核心策略:裝備與線索的物質派(裝備堆疊、消耗品效率、搜索額外發現)`,
    `- 陣營基礎被動:搜索行動時額外發現 +1(線索、物品、證據)— 設計時可加成這個被動`,
    `- 戰鬥節奏:槍械精準射擊,感知為主屬性`,
    `- 風味:鏽銅色,金屬、工具、實驗室器材、大地的質感`,
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
      existingFilter: { faction: 'S', primary_axis_value: brief.primary_axis_value },
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
  card.series = 'S';
  if (card.starting_xp == null) card.starting_xp = 0;
  if (card.level == null) card.level = 0;
  if (!card.faction) card.faction = 'S';
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
