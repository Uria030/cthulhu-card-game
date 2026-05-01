// J 陣營(鐵壁 The Bastion)30 張 lv0 初始卡 — AI 全自動生成
// 五軸:4 個 card_name(退伍軍人 B / 重裝警察 D / 老保鏢 F / 工廠領班 C)+ 1 個 combat_style(military)
// 規範主檔:packages/client/public/admin/admin-card-prompt.js §七之四之二 軸向設計工作流程
// Pattern 跨陣營無衝突(E=BCDE, I=ACDF, S=ABEF, N=ACDE, J=BCDF)
// 一句話:我不是最強的,但我是最不會倒下的
// 核心策略:靜態防禦塔——傷害減免、堅守佈局、一致性加成、預先佈局
// 主屬性:constitution(體質),預設 combat_style:military
import { adminFetch, adminGet } from './api.mjs';
import { generateValidatedCard, formatValidationReport } from './lib/generate-card.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `j-faction-cards-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# J 陣營 30 張 lv0 卡 AI 生成 ${stamp}`);

const existing = await adminGet('/api/cards');
const existingArr = Array.isArray(existing) ? existing : (existing.cards || existing.data || []);
const existingNameSet = new Set(existingArr.map((c) => c.name_zh));
log(`既有 ${existingArr.length} 張(將跳過同 name_zh 的卡)\n`);

const J_BRIEFS = [
  // ═══ 軸 1:card_name='退伍軍人' (Pattern B 質變閾值) 6 張 ═══
  {
    name_zh: '老兵的軍械庫', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退伍軍人',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。當你場上有 ≥3 張「退伍軍人」軸資產卡時,你的所有 military 攻擊 +1 傷害,且你的傷害減免 +1。Pattern B 質變閾值主驅動——堆裝備到位質變,呼應 §8.6「牌組一致性加成」。風味:退伍軍人地下室,牆上掛著三把獵槍、軍規鐵箱、子彈整齊排列。費用 3。',
  },
  {
    name_zh: '編號彈藥箱', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退伍軍人',
    intent: '資產,費用 2。持續在場(passive),你每打出 1 張「退伍軍人」軸卡時放 1 個「編號」標記在此卡上。當「編號」≥3 時,你的所有 military 武器 +1 傷害(出門前每一發都編號的強迫症)。Pattern B 累積閾值。風味:每一發子彈都用奇異筆寫上編號,擺成標準陣列。',
  },
  {
    name_zh: '行動前清點', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退伍軍人',
    intent: '事件,費用 1。檢視你的牌庫頂 5 張,將其中所有「退伍軍人」軸卡加入手牌,其餘按原順序放回(預先佈局)。風味:出發前你把所有裝備擺一遍,缺什麼補什麼,從不靠運氣。',
  },
  {
    name_zh: '紀律訓練', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退伍軍人',
    intent: '技能,費用 0。加值體質檢定 +2(對接 J 主屬性)。如果你連續第 2 回合停留在同一地點,額外 +1。風味:三十年前部隊裡學的事,身體還記得。',
  },
  {
    name_zh: '老兵的指引', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退伍軍人',
    intent: '技能,費用 0。加值體質檢定 +1。如果你場上有 ≥2 張「退伍軍人」軸卡,額外 +1(Pattern B 弱版閾值)。風味:不用講太多,看一眼就知道下一步。',
  },
  {
    name_zh: '退伍老友', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '退伍軍人',
    intent: '盟友,費用 3,HP 3 SAN 1(對接 §8.7 代表盟友——HP 極高、攻擊穩定)。【行動】此盟友可代替你進行 1 次 military 攻擊,造成 2 點傷害。風味:當年並肩走過戰場的弟兄,話不多,但叫得動。',
  },

  // ═══ 軸 2:card_name='重裝警察' (Pattern D 跨時機配合) 6 張 ═══
  {
    name_zh: '特勤指揮車', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '重裝警察',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。【反應】在敵人進入你所在地點時:你抽 1 張牌,且該敵人本回合行動 −1 點(預警機制)。Pattern D 跨時機配合主驅動——對手動作觸發你的反應。風味:車頂的紅藍燈閃爍,車內無線電持續呼叫指揮中心。費用 3。',
  },
  {
    name_zh: '全套防彈裝', card_type: 'asset', slot: 'body',
    primary_axis_layer: 'card_name', primary_axis_value: '重裝警察',
    intent: '裝甲(body slot 全身防具),費用 2。持續在場(passive),你受到傷害時,先扣除 2 點傷害(傷害減免 2)。【反應】在你被攻擊時:你獲得 1 個 armor 狀態(疊加保護)。Pattern D 反應觸發。風味:從頭盔到靴子的全套凱夫拉與陶瓷板,全套裝起來重 22 公斤。',
  },
  {
    name_zh: '突擊破門', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '重裝警察',
    intent: '事件,費用 2。【行動】移動到相鄰地點並對該地點 1 個敵人造成 3 點傷害,該敵人下回合無法行動(weakened 狀態)。風味:破門槌一擊,門框碎成兩半,你已經在屋內。',
  },
  {
    name_zh: '掩護射擊', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '重裝警察',
    intent: '事件,費用 1。【反應】在你的隊友受到攻擊時:你進行 1 次 military 攻擊,該攻擊命中時讓該敵人下次攻擊 −2 傷害(壓制火力)。Pattern D 跨時機配合核心。風味:你不是去殺敵,你是讓他抬不起頭。',
  },
  {
    name_zh: '戰術指揮', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '重裝警察',
    intent: '技能,費用 0。加值體質檢定 +1。【加值】如果該檢定是反應檢定,額外 +2。風味:你在無線電裡冷靜下達指令,就算耳邊還在開槍。',
  },
  {
    name_zh: '突擊步槍', card_type: 'asset', slot: 'two_hand',
    combat_style: 'military',
    primary_axis_layer: 'card_name', primary_axis_value: '重裝警察',
    intent: '雙手武器(military),費用 3,weapon_tier 3,30 發,造成 5 點傷害。【反應】在敵人進入你所在地點時:可消耗 2 發進行 1 次 military 攻擊。Pattern D 反應攻擊。風味:特勤隊的標準配槍,槍身上還有編號漆。',
  },

  // ═══ 軸 3:card_name='老保鏢' (Pattern F 鏡像效果) 6 張 ═══
  {
    name_zh: '安全屋', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '老保鏢',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。當你受到傷害時,你獲得 1 點資源(鏡像:被打→補資源)。Pattern F 鏡像主驅動——每一次受傷都轉換成下一次站起來的本錢。風味:沒有窗、只有一扇厚鋼門的小公寓,客戶交託的人都在這裡撐過危機。費用 3。',
  },
  {
    name_zh: '客戶名冊', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '老保鏢',
    intent: '資產,費用 2。持續在場(passive),當你的隊友受到傷害時,你抽 1 張牌(鏡像:隊友受傷↔你獲得情報)。風味:每個客戶的習慣、敵人、罩門你都記在小本子上。',
  },
  {
    name_zh: '貼身護衛', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '老保鏢',
    intent: '事件,費用 2。【反應】在你的隊友受到傷害時:你替他承擔該次傷害,並獲得 1 個 armor 狀態(鏡像:替隊友擋傷→獲得護甲)。Pattern F 鏡像核心——傷害轉移後反饋。風味:三十年來從沒讓客戶在你手上出過事。',
  },
  {
    name_zh: '反擊本能', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '老保鏢',
    intent: '技能,費用 0。加值反應檢定 +2。如果你本回合受過傷害,額外 +1(鏡像:受傷→反應變鋒利)。風味:被打過的肉體記得疼,所以下一拳會更快。',
  },
  {
    name_zh: '危機判讀', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '老保鏢',
    intent: '技能,費用 0。加值感知檢定 +1。【加值】如果你所在地點有敵人,額外 +1(鏡像:有威脅↔感知變敏銳)。風味:危險來臨前那一秒,空氣會變,你聽得出來。',
  },
  {
    name_zh: '隨身鋼盾', card_type: 'asset', slot: 'one_hand',
    combat_style: 'military',
    primary_axis_layer: 'card_name', primary_axis_value: '老保鏢',
    intent: '單手武器(military 防禦架式),費用 2,weapon_tier 1,造成 1 點傷害。持續在場(passive),你受到傷害時減免 1 點。【反應】在你被攻擊時:可對攻擊者造成 1 點傷害(鏡像:被打→反擊)。風味:不是真的盾,是強化過的公事包,平時看不出來。',
  },

  // ═══ 軸 4:card_name='工廠領班' (Pattern C 連鎖反應) 6 張 ═══
  {
    name_zh: '老工廠', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '工廠領班',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。【行動】可派遣此地點的 1 名盟友 → 從牌庫頂翻 3 張,將其中第一張「工廠領班」軸卡加入手牌(連鎖召喚同伴)。Pattern C 連鎖反應主驅動。風味:水泥地、老式機台、頭頂的鐵桁架,工人的午餐盒還在角落。費用 3。',
  },
  {
    name_zh: '工人輪班表', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '工廠領班',
    intent: '資產,費用 2。持續在場(passive),你打出「工廠領班」軸盟友卡時,從牌庫頂翻 3 張,將其中第一張同軸卡加入手牌,其餘洗回(連鎖招集)。Pattern C 連鎖核心。風味:每個工人的班表都釘在鐵板上,你知道誰隨叫隨到。',
  },
  {
    name_zh: '緊急集結', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '工廠領班',
    intent: '事件,費用 2。從棄牌堆撿回 1 張「工廠領班」軸盟友卡到手牌,且本回合該盟友卡費用 −1。Pattern C 連鎖召集。風味:你拍了三下鐵桶,五分鐘內全廠都到齊了。',
  },
  {
    name_zh: '對手下負責', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '工廠領班',
    intent: '技能,費用 0。加值體質檢定 +1。【加值】如果你場上有 1 張以上盟友,額外 +1(連鎖:同伴在場↔士氣鼓舞)。風味:你不是為自己撐住,是為了那群跟著你的人。',
  },
  {
    name_zh: '機械夥計', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '工廠領班',
    intent: '盟友,費用 2,HP 2 SAN 1。【被動】在此盟友進場時,你從棄牌堆撿回 1 張「工廠領班」軸卡到手牌(連鎖反應:招來一個帶來下一個)。Pattern C 連鎖入場。風味:跟你做了二十年的老技工,扳手不離手。',
  },
  {
    name_zh: '老廠房工頭', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '工廠領班',
    intent: '盟友,費用 3,HP 2 SAN 2。【被動】只要此盟友在場,你的所有「工廠領班」軸盟友卡費用 −1(連鎖降費)。風味:他比你更早進這家工廠,沒他你連大門鑰匙都拿不到。',
  },

  // ═══ 軸 5:combat_style='military' (橫向武器軸) 6 張 ═══
  {
    name_zh: '軍規霰彈槍', card_type: 'asset', slot: 'two_hand',
    combat_style: 'military',
    primary_axis_layer: 'combat_style', primary_axis_value: 'military',
    intent: '雙手武器(military),費用 3,weapon_tier 3,6 發,造成 5 點傷害。對地點所有敵人造成 1 點額外傷害(範圍轟擊)。風味:軍方制式 12 號口徑霰彈槍,槍身有部隊編號。',
  },
  {
    name_zh: '長柄戰斧', card_type: 'asset', slot: 'two_hand',
    combat_style: 'military',
    primary_axis_layer: 'combat_style', primary_axis_value: 'military',
    intent: '雙手武器(military 長柄),費用 3,weapon_tier 3,造成 6 點傷害(無彈藥消耗)。【加值】如果你連續第 2 回合停留在同一地點,額外 +1 傷害(對接 J 陣營基礎被動)。風味:警察特勤隊的破門斧,既能砍也能砸。',
  },
  {
    name_zh: '防禦架式', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'combat_style', primary_axis_value: 'military',
    intent: '技能,費用 0。加值體質檢定 +1。【加值】如果你本回合未移動,額外 +1,且你的傷害減免 +1(防禦架式核心:站定不動)。風味:雙腳分立,重心壓低,武器舉到肩高——這個姿勢你站過上千次。',
  },
  {
    name_zh: '戰術頭盔', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'military',
    intent: '配件型資產(對接 §8.7 陣營代表物件——軍用裝備),費用 1。持續在場(passive),你受到精神傷害時減免 1 點(頭盔保護大腦)。風味:特勤頭盔,內襯吸震墊,通話器貼在耳旁。',
  },
  {
    name_zh: '雙持戰術刀', card_type: 'asset', slot: 'two_hand',
    combat_style: 'military',
    primary_axis_layer: 'combat_style', primary_axis_value: 'military',
    intent: '雙手武器(military 雙持),費用 2,weapon_tier 2,造成 3 點傷害。【加值】此武器攻擊命中後,可立即進行 1 次額外攻擊,造成 2 點傷害(雙持連擊)。風味:特勤隊配備的 KA-BAR 戰術刀,一手一把同步揮砍。',
  },
  {
    name_zh: '防毒面具', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'military',
    intent: '配件型消耗品(對接 §8.7 陣營代表物件),費用 1。【消費】可消費此卡 → 完全豁免該回合的環境傷害或毒素類型傷害。風味:橡膠味嗆鼻,呼吸聲變得空洞,但你知道空氣裡的東西碰不到你。',
  },
];

log(`目標 ${J_BRIEFS.length} 張\n`);

const results = { created: [], skipped: [], failed: [] };

for (let i = 0; i < J_BRIEFS.length; i++) {
  const brief = J_BRIEFS[i];
  log(`\n─── [${i + 1}/${J_BRIEFS.length}] ${brief.name_zh} ───`);

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
  lockHints.push(`series:J(J 陣營批次)`);
  lockHints.push(`faction:J(鐵壁)`);
  lockHints.push(`star/level:0(基礎卡)`);

  const userDescription = [
    `## 綱要(設計意圖)`,
    brief.intent,
    ``,
    `## 結構鎖定(必須照填)`,
    lockHints.map((s) => '- ' + s).join('\n'),
    ``,
    `## J 陣營(鐵壁 The Bastion)氣質提醒`,
    `- 一句話:我不是最強的,但我是最不會倒下的。`,
    `- 核心策略:靜態防禦塔(傷害減免、堅守位置加成、預先佈局、牌組一致性加成)`,
    `- 陣營基礎被動:連續兩回合停留同一地點時,該地點你的檢定 +1 — 設計時可加成這個被動`,
    `- 主屬性:constitution(體質);預設戰鬥風格:military(軍用武器:雙手/防禦架式/雙持/長柄)`,
    `- 戰鬥節奏:不追求速度、不追求靈巧——追求厚度。身體厚、裝備厚、準備厚。`,
    `- 風味:石墨灰,城牆、盾牌、鋼筋混凝土、不可動搖的存在`,
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
      existingFilter: { faction: 'J', primary_axis_value: brief.primary_axis_value },
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
  card.series = 'J';
  if (card.starting_xp == null) card.starting_xp = 0;
  if (card.level == null) card.level = 0;
  if (!card.faction) card.faction = 'J';
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
