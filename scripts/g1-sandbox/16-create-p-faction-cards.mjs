// P 陣營(流影 The Flux)30 張 lv0 初始卡 — AI 全自動生成
// 五軸:4 個 card_name(山間獵人 A / 流浪冒險家 B / 跳車記者 D / 馬戲團雜耍 F)+ 1 個 proficiency(archery_explosive)
// 規範主檔:packages/client/public/admin/admin-card-prompt.js §七之四之二 軸向設計工作流程
// 規則書:packages/client/public/rulebook/s07_faction_narrative.md 第九章
// Pattern 跨陣營無衝突(已用 E=BCDE, I=ACDF, S=ABEF, N=ACDE,本批 P=ABDF)
import { adminFetch, adminGet } from './api.mjs';
import { generateValidatedCard, formatValidationReport } from './lib/generate-card.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `p-faction-cards-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# P 陣營 30 張 lv0 卡 AI 生成 ${stamp}`);

const existing = await adminGet('/api/cards');
const existingArr = Array.isArray(existing) ? existing : (existing.cards || existing.data || []);
const existingNameSet = new Set(existingArr.map((c) => c.name_zh));
log(`既有 ${existingArr.length} 張(將跳過同 name_zh 的卡)\n`);

const P_BRIEFS = [
  // ═══ 軸 1:card_name='山間獵人' (Pattern A 資源回收) 6 張 ═══
  // 玩感:棄牌堆是「打過的彈藥/設過的陷阱」,獵人的本事是把用過的東西撿回來再用一次
  {
    name_zh: '山徑獵屋', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '山間獵人',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。Pattern A 資源回收主泵——【被動】只要此卡在場,你的反應檢定 +1;【免費行動】每回合 1 次:從棄牌堆檢視 1 張「山間獵人」軸卡,可將其回手。風味:森林深處用木頭與石頭搭的小屋,獵人歸途必經之地。費用 3。',
  },
  {
    name_zh: '熟悉的足跡', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '山間獵人',
    intent: '事件,費用 1。【行動】從你的棄牌堆中取回 2 張「山間獵人」軸卡到手牌(Pattern A 直給型)。風味:你蹲下來,指尖摸過泥土上的壓痕——這條路你走過上百次,每一道印記都是舊夥伴。',
  },
  {
    name_zh: '舊獵人筆記', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '山間獵人',
    intent: '資產,費用 2。持續在場(passive)。【免費行動】每回合 1 次:棄置 1 張任意手牌 → 從棄牌堆撈 1 張「山間獵人」軸卡到手(換書動作,Pattern A 鏡像)。風味:封皮已經泛黃,記著每一條山路、每一個動物窩點、每一場暴雨的時辰。',
  },
  {
    name_zh: '追蹤直覺', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '山間獵人',
    intent: '技能,費用 0。投入後加值反應檢定 +2(對接 P 主屬性 reflex)。【加值】如果該檢定失敗,可從棄牌堆中找回此卡到手(Pattern A 軟回收,失敗也不浪費)。風味:你不是在看,是在感覺——風向偏了 2 度,前方有東西。',
  },
  {
    name_zh: '野外求生', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '山間獵人',
    intent: '技能,費用 0。投入後加值體質檢定 +1。【加值】如果你的棄牌堆有 ≥3 張「山間獵人」軸卡,該檢定額外 +1(經驗累積型)。風味:你睡在松針上、喝過融雪水、嚼過樹皮——身體比書本記得更牢。',
  },
  {
    name_zh: '老獵犬', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '山間獵人',
    intent: '盟友,費用 3,ally_hp 2,ally_san 1。【被動】只要此盟友在場,你的反應檢定 +1。【反應】在你打出另一張「山間獵人」軸卡時:此盟友獲得 1 點 empowered。風味:跟你 12 年了,聽不見遠處的腳步,但聞得到三百碼外的血。',
  },

  // ═══ 軸 2:card_name='流浪冒險家' (Pattern B 質變閾值) 6 張 ═══
  // 玩感:背包裡什麼都有一點,場上湊到 N 張「流浪冒險家」軸卡質變解鎖能力
  {
    name_zh: '破舊背包', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '流浪冒險家',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。Pattern B 質變閾值主驅動——【被動】只要你場上有 ≥3 張「流浪冒險家」軸卡,你的所有 P 陣營卡費用 −1。【行動】可消費此卡 → 從牌庫搜尋 1 張「流浪冒險家」軸卡加入手牌。風味:跨過大半個地球的破背包,裡面什麼都有一點——但永遠少一樣你最需要的。費用 2。',
  },
  {
    name_zh: '萬用瑞士刀', card_type: 'asset', slot: 'one_hand',
    combat_style: 'sidearm',
    primary_axis_layer: 'card_name', primary_axis_value: '流浪冒險家',
    intent: '隨身武器(sidearm),費用 1,weapon_tier 1,uses 3,造成 2 點傷害(對應 §9.7 流影代表物件)。【加值】如果你場上有 ≥3 張「流浪冒險家」軸卡,此卡攻擊 +1 傷害且不消耗 uses(Pattern B 質變閾值)。風味:獵人有獵刀、士兵有刺刀,你只有這把瑞士刀——但它什麼都能湊合著用。',
  },
  {
    name_zh: '舊地圖冊', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '流浪冒險家',
    intent: '資產,費用 1。持續在場(passive)。【加值】如果你場上有 ≥3 張「流浪冒險家」軸卡,你進入新地點時抽 1 張牌(Pattern B 閾值觸發抽牌)。風味:皺褶的紙頁邊角寫滿你自己的註記——這條路 1923 年走過、那座山 1928 年差點沒下來。',
  },
  {
    name_zh: '路人甲乙', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '流浪冒險家',
    intent: '盟友,費用 2,ally_hp 1,ally_san 2。【被動】只要你場上有 ≥3 張「流浪冒險家」軸卡,此盟友的攻擊不會消耗你的行動點(Pattern B 閾值質變)。風味:陌生城鎮裡跟你喝過一杯酒的傢伙,叫什麼名字你已經忘了——但他願意陪你走這一段。',
  },
  {
    name_zh: '機智應對', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '流浪冒險家',
    intent: '技能,費用 0。投入後加值反應檢定 +1。【加值】如果你場上有 ≥3 張「流浪冒險家」軸卡,該檢定改為 +3(Pattern B 質變)。風味:你被警察盤問過、被劫匪堵過、被狼追過——什麼狀況都遇過,大腦比嘴巴更早反應。',
  },
  {
    name_zh: '路上見招拆招', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '流浪冒險家',
    intent: '事件,費用 0。【行動】從你的牌庫頂翻 3 張,你可以將其中 1 張「流浪冒險家」軸卡加入手牌,其餘洗回。如果你場上有 ≥3 張「流浪冒險家」軸卡,改為翻 5 張並選 2 張(Pattern B 閾值升級)。風味:鐵壁花三天準備裝備,你直接出發——路上的事,路上再說。',
  },

  // ═══ 軸 3:card_name='跳車記者' (Pattern D 跨時機配合) 6 張 ═══
  // 玩感:反應導向。在敵人攻擊時/在事件揭露時/在隊友倒下時——記者的牌都是「在 X 時」觸發
  {
    name_zh: '戰地相機', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'card_name', primary_axis_value: '跳車記者',
    intent: '配件型資產,費用 2。持續在場(passive)。【反應】在你完成一次反應檢定時:在所在地點放 1 個線索(Pattern D 跨時機配合主驅動——別人動的瞬間,你按下快門)。風味:漆已經剝落的老相機,鏡頭看過比克蘇魯還可怕的人類。',
  },
  {
    name_zh: '刺探報導', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '跳車記者',
    intent: '事件,費用 1。【反應】在敵人進入你所在地點時:在該敵人身上放 1 個 marked 標記,並抽 1 張牌(Pattern D 在敵人動作時觸發)。風味:他們以為你只是來拍照,但你筆記本背面早就畫好了他們的位置圖。',
  },
  {
    name_zh: '採訪筆記本', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '跳車記者',
    intent: '資產,費用 1。持續在場(passive)。【反應】在你或盟友失敗一次檢定時:抽 1 張牌(Pattern D 跨時機型——把別人的失敗變成你的素材)。風味:你寫滿了所有人的失誤——那些是你下一篇報導的脊椎。',
  },
  {
    name_zh: '老編輯', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '跳車記者',
    intent: '盟友,費用 3,ally_hp 1,ally_san 3。【反應】在你打出另一張「跳車記者」軸卡時:此盟友獲得 1 點 empowered。【行動】可消費此盟友 → 從棄牌堆中取回 1 張「跳車記者」軸事件卡到手。風味:辦公室常常空著,但你打電話他永遠接,然後罵你三分鐘——再幫你寫頭條。',
  },
  {
    name_zh: '搶先發稿', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '跳車記者',
    intent: '事件,費用 0。【反應】在另一名調查員揭露線索時:你抽 1 張牌(Pattern D 跨時機,搶在所有人之前)。風味:他們還沒走出案發現場,你的稿子已經傳到報社。',
  },
  {
    name_zh: '敏銳直覺', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '跳車記者',
    intent: '技能,費用 0。投入後加值感知檢定 +2。【加值】如果該檢定為反應觸發的檢定(reaction trigger),額外 +1(Pattern D 跨時機加成)。風味:其他人聽見的是聲音,你聽見的是聲音背後的故事。',
  },

  // ═══ 軸 4:card_name='馬戲團雜耍' (Pattern F 鏡像效果) 6 張 ═══
  // 玩感:你的攻擊與你的閃避互為鏡像、棄牌與抽牌互為鏡像、傷害與線索互為鏡像
  {
    name_zh: '馬戲團舊帳棚', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '馬戲團雜耍',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。Pattern F 鏡像效果主驅動——【被動】只要此卡在場,你成功進行一次反應檢定時,放 1 個線索;你失敗一次反應檢定時,抽 1 張牌(成功/失敗互為鏡像,兩端都有產出)。風味:褪色紅白條紋的圓頂帳棚,廢棄了 5 年——但你閉上眼還能聽見鼓聲。費用 3。',
  },
  {
    name_zh: '雜耍棍', card_type: 'asset', slot: 'one_hand',
    combat_style: 'sidearm',
    primary_axis_layer: 'card_name', primary_axis_value: '馬戲團雜耍',
    intent: '隨身武器(sidearm),費用 2,weapon_tier 2,造成 3 點傷害。【反應】在你以此武器擊中敵人時:你的下一次反應檢定 +1(攻擊→閃避鏡像)。【反應】在你閃避一次攻擊後:此武器下次攻擊 +1 傷害(閃避→攻擊鏡像)。Pattern F 雙向鏡像。風味:四節銅棍,馬戲團裡耍了八年——重量、慣性、距離都長在你手上了。',
  },
  {
    name_zh: '即興表演', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '馬戲團雜耍',
    intent: '事件,費用 1。【行動】棄置 1 張任意手牌 → 抽 2 張牌;之後從棄牌堆中將剛剛被棄的那張卡放回牌庫頂(Pattern F 棄→抽→還的鏡像循環,過手不流失)。風味:鋸開的箱子裡其實沒有人——觀眾看見的是奇蹟,你做的是換手。',
  },
  {
    name_zh: '雙人配合', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '馬戲團雜耍',
    intent: '盟友,費用 3,ally_hp 2,ally_san 1。【反應】在你受到 1 點傷害時:此盟友承擔 1 點傷害,你抽 1 張牌(傷害鏡像給夥伴,得到資訊)。【反應】在此盟友受到 1 點傷害時:你抽 1 張牌。風味:走鋼絲時你們一前一後,落地時誰先誰後不重要——重要的是兩人都活著。',
  },
  {
    name_zh: '空中翻越', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '馬戲團雜耍',
    intent: '技能,費用 0。投入後加值反應檢定 +2。【加值】如果該檢定成功:你可以將此卡放回手牌(成功→回手的鏡像,失敗則正常棄置)。Pattern F 鏡像。風味:鋼索離地 30 呎,你不會掉——不是因為平衡好,是因為你接受了會掉。',
  },
  {
    name_zh: '翻倒的板凳', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '馬戲團雜耍',
    intent: '資產(即興武器,§9.7 流影獨有機制),費用 0,uses 1(消耗品)。【行動】可消費此卡 → 對所在地點 1 個敵人造成 2 點傷害並施加 1 層 weakened(Pattern F 物件鏡像——板凳既是地形又是武器)。風味:不是設計來打人的東西,在你手裡都能打人。',
  },

  // ═══ 軸 5:proficiency='archery_explosive' (橫向武器軸) 6 張 ═══
  // 玩感:爆裂箭/特殊箭矢的箭矢配件群,任何 P 陣營角色都可放幾張當武器配件
  // P 預設 combat_style=archery,proficiency 衍生為「爆裂類箭矢」
  {
    name_zh: '反曲弓', card_type: 'asset', slot: 'two_hand',
    combat_style: 'archery',
    primary_axis_layer: 'proficiency', primary_axis_value: 'archery_explosive',
    intent: '雙手武器(archery),費用 3,weapon_tier 3,造成 4 點傷害,需消耗 1 支箭(箭由 ammo 配件供應)。對接 §9.4 反應+弓術。【加值】如果此次攻擊消耗的是「archery_explosive」軸的特殊箭矢,額外 +1 傷害。風味:獵人手裡的反曲弓,弦是用獸筋反覆刷蠟做的——不需要彈夾,只需要箭。',
  },
  {
    name_zh: '爆裂箭', card_type: 'asset', slot: 'accessory',
    combat_style: 'archery',
    primary_axis_layer: 'proficiency', primary_axis_value: 'archery_explosive',
    intent: '配件型彈藥(arrow subtype),費用 2,uses 2。【行動】可消費 1 use → 進行 1 次 archery 攻擊,該攻擊對所在地點所有敵人造成 2 點傷害(範圍轟擊)。風味:箭頭裡塞了打獵用的雷管——打中之後會炸,獵物連同三呎內的草都會燒起來。',
  },
  {
    name_zh: '碎甲箭', card_type: 'asset', slot: 'accessory',
    combat_style: 'archery',
    primary_axis_layer: 'proficiency', primary_axis_value: 'archery_explosive',
    intent: '配件型彈藥(arrow subtype),費用 1,uses 2。【行動】可消費 1 use → 進行 1 次 archery 攻擊,造成 3 點傷害並對該敵人施加 1 層 vulnerable(下次受到傷害 +1)。風味:箭頭是熔了舊鋼軌打出來的——重、硬、無情。',
  },
  {
    name_zh: '燃燒箭', card_type: 'asset', slot: 'accessory',
    combat_style: 'archery',
    primary_axis_layer: 'proficiency', primary_axis_value: 'archery_explosive',
    intent: '配件型彈藥(arrow subtype),費用 1,uses 2。【行動】可消費 1 use → 進行 1 次 archery 攻擊,造成 2 點傷害並施加 1 層 burning。風味:箭桿綁著浸了油的破布,放出去是流星,落下去是火。',
  },
  {
    name_zh: '響箭', card_type: 'asset', slot: 'accessory',
    combat_style: 'archery',
    primary_axis_layer: 'proficiency', primary_axis_value: 'archery_explosive',
    intent: '配件型彈藥(arrow subtype),費用 0,uses 1。【行動】可消費此卡 → 進行 1 次 archery 攻擊,造成 1 點傷害並抽 1 張牌(資訊型箭矢)。風味:中空的箭桿在飛的時候會吱吱叫——獵人之間用來通訊的古早法子。',
  },
  {
    name_zh: '備用箭袋', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'proficiency', primary_axis_value: 'archery_explosive',
    intent: '配件,費用 2。持續在場(passive)。【免費行動】每回合 1 次:可從棄牌堆中找回 1 張「archery_explosive」軸的箭矢卡到手(箭矢回收,Pattern A 變奏)。風味:皮革背帶磨得發黑,箭袋底有十幾個沒射出去的箭頭——下回合就需要它們。',
  },
];

log(`目標 ${P_BRIEFS.length} 張\n`);

const results = { created: [], skipped: [], failed: [] };

for (let i = 0; i < P_BRIEFS.length; i++) {
  const brief = P_BRIEFS[i];
  log(`\n─── [${i + 1}/${P_BRIEFS.length}] ${brief.name_zh} ───`);

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
  lockHints.push(`series:P(P 陣營批次)`);
  lockHints.push(`faction:P(流影)`);
  lockHints.push(`star/level:0(基礎卡)`);

  const userDescription = [
    `## 綱要(設計意圖)`,
    brief.intent,
    ``,
    `## 結構鎖定(必須照填)`,
    lockHints.map((s) => '- ' + s).join('\n'),
    ``,
    `## P 陣營(流影 The Flux)氣質提醒`,
    `- 一句話:計畫永遠趕不上變化。那就乾脆不做計畫。`,
    `- 核心策略:反應行動專家——額外反應行動、棄牌堆回收、隨機效果加成、即興武器`,
    `- 主屬性:reflex(反應,非敏捷),預設戰鬥風格:archery(弓術)`,
    `- 陣營基礎被動:每回合額外 1 次反應行動機會 — 設計時可加成這個被動`,
    `- 機制關鍵字:反應行動數量多/棄牌堆回收利用/隨機效果額外獎勵/低 HP-SAN 觸發/即興武器`,
    `- 風味:翠綠色,流水/藤蔓/適應性、在廢墟中生長的生命`,
    `- 角色原型(§9.8):山間獵人、流浪冒險家、跳車記者、馬戲團雜耍、瑞士刀流浪者`,
    ``,
    `## s06 文法硬性要求`,
    `- 每條 effect 的 desc_zh 必含【行動】/【免費行動】/【反應】/【被動】/【強制】/【加值】/【消費】其中之一框架`,
    `- 主詞用「你」,自指用「此卡」`,
    `- 阿拉伯數字 + 全形減號「−」`,
    `- 觸發句「在 X 時」(不用「當 X 時」),條件句「如果 X」(不用「若 X」)`,
    `- 「抽 X 張牌」(不寫「卡」)、「獲得 X 資源」(不寫「個」)、「X 點恐懼」(不寫「X SAN」)`,
    `- 反應屬性檢定寫「反應檢定 +N」(本專案無先攻機制,禁止寫先攻)`,
  ].join('\n');

  let r;
  try {
    r = await generateValidatedCard({
      userDescription,
      existingFilter: { faction: 'P', primary_axis_value: brief.primary_axis_value },
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
  card.series = 'P';
  if (card.starting_xp == null) card.starting_xp = 0;
  if (card.level == null) card.level = 0;
  if (!card.faction) card.faction = 'P';
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
