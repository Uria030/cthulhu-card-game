// N 陣營(天啟)30 張 lv0 初始卡 — AI 全自動生成
// 五軸:4 個 card_name(靈媒 A / 符號學學者 C / 吉普賽女巫 D / 神秘學者 E)+ 1 個 combat_style(arcane)
// 規範主檔:packages/client/public/admin/admin-card-prompt.js §七之四之二 軸向設計工作流程
// Pattern 跨陣營無衝突(E=BCDE, I=ACDF, S=ABEF, N=ACDE)
import { adminFetch, adminGet } from './api.mjs';
import { generateValidatedCard, formatValidationReport } from './lib/generate-card.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `n-faction-cards-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# N 陣營 30 張 lv0 卡 AI 生成 ${stamp}`);

const existing = await adminGet('/api/cards');
const existingArr = Array.isArray(existing) ? existing : (existing.cards || existing.data || []);
const existingNameSet = new Set(existingArr.map((c) => c.name_zh));
log(`既有 ${existingArr.length} 張(將跳過同 name_zh 的卡)\n`);

const N_BRIEFS = [
  // ═══ 軸 1:card_name='靈媒' (Pattern A 資源回收) 6 張 ═══
  {
    name_zh: '通靈密室', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '靈媒',
    intent: '地點關鍵卡(asset slot=none),進場後常駐(passive)。每回合首次抽牌時,可從棄牌堆檢視 1 張「靈媒」軸卡並決定是否回手(夢中重返訊息)。Pattern A 資源回收主泵——棄牌堆是「已經被夢過的場景」,需要時讓它重新顯現。風味:厚重的紫絨布、桌中央的水晶球、四周一圈低燭。費用 2-3。',
  },
  {
    name_zh: '夢迴召返', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '靈媒',
    intent: '事件,費用 1。從棄牌堆取回 2 張「靈媒」軸卡到手牌。Pattern A 直給型。風味:你閉上眼睛,昨晚夢到的場景在腦中重新展開——你想起了那個被忽略的細節。',
  },
  {
    name_zh: '夢境日記', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '靈媒',
    intent: '資產,費用 1。持續在場(passive),每回合可棄置 1 張任意手牌 → 從棄牌堆撈 1 張同軸卡(換頁動作:棄掉現實,撿回夢境)。Pattern A 鏡像型。風味:每天醒來都得寫下還記得的片段,有些頁角已經發黃。',
  },
  {
    name_zh: '夢中啟示', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '靈媒',
    intent: '技能,費用 0。加值意志檢定 +2(對接 N 主屬性)。風味:不是你在思考,是某個聲音在告訴你答案。',
  },
  {
    name_zh: '低語感應', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '靈媒',
    intent: '技能,費用 0。加值意志檢定 +1,投入後可從棄牌堆檢視 1 張並決定抽出(回收弱版)。Pattern A 弱版。風味:那些別人聽不見的低語,從來沒有停過。',
  },
  {
    name_zh: '預言家的徒弟', card_type: 'ally', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '靈媒',
    intent: '盟友,費用 3,HP 1 SAN 2(對接 §5.7 代表盟友)。每回合首次抽牌變抽 2 張(模擬「他幫你整理夢境筆記」)。風味:年輕的神秘學學徒,話不多,但每次儀式他都站在你後面分擔副作用。',
  },

  // ═══ 軸 2:card_name='符號學學者' (Pattern C 連鎖反應) 6 張 ═══
  {
    name_zh: '符號學書房', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '符號學學者',
    intent: '地點關鍵卡(asset),進場後常駐(passive)。在你打出另一張「符號學學者」軸卡時,翻牌頂 1 張,如果是同軸卡或線索類,加入手牌(連鎖型)。Pattern C 連鎖反應主驅動——一個符號帶出另一個符號。風味:三面書牆密密麻麻,書脊上是看不懂的銘文,桌上攤開兩本古籍。費用 3。',
  },
  {
    name_zh: '古文解譯', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '符號學學者',
    intent: '事件,費用 2。在你所在地點翻牌頂 5 張,將其中所有同軸卡或線索類卡加入手牌,其餘洗回(連鎖搜尋)。Pattern C 滾雪球。風味:你盯著那行符文看了三小時,突然發現它指向另外四個你之前忽略的細節。',
  },
  {
    name_zh: '對照辭典', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '符號學學者',
    intent: '資產,費用 2。持續在場(passive),你成功進行神秘學或意志檢定時,翻牌頂 1 張,如果是同軸卡保留,否則回頂(連鎖頂牌)。Pattern C 弱版。風味:這本書比你的命還老,每一頁都是別人花了一輩子才能拼出來的對照。',
  },
  {
    name_zh: '符號學知識', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '符號學學者',
    intent: '技能,費用 0。加值智力檢定 +2,如果該檢定成功:抽 1 張牌(連鎖獎勵)。Pattern C 鏈條觸發。風味:你看到的不是字,是字背後的家族關係——這個符號和那個符號,差了三百年但同源。',
  },
  {
    name_zh: '禁忌筆記', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '符號學學者',
    intent: '資產,費用 2,法器卡(is_talisman=true)。talisman_type=scroll、target_threat_types=["ritual"]、break_timing=stockpile、break_charge_label=洞察。每回合自動 +1 洞察、最多累積 5 洞察,洞察可消耗破除儀式類遭遇卡。Pattern C 連鎖累積。風味:你在邊角寫滿了交叉索引——每一條注解都指向另一頁的另一條注解。',
  },
  {
    name_zh: '靈視', card_type: 'event', slot: 'arcane',
    combat_style: 'arcane', spell_type: 'investigation_prophecy', spell_casting: 'channeling',
    primary_axis_layer: 'card_name', primary_axis_value: '符號學學者',
    intent: '法術卡(card_type=event, combat_style=arcane, slot=arcane, spell_type=investigation_prophecy, spell_casting=channeling),費用 1。【行動】施放後翻牌頂 3 張,任意排序放回頂部(連鎖預知)。Pattern C 連鎖配合預知氣質。風味:你閉眼三秒,睜開時已經看見了下一頁。',
  },

  // ═══ 軸 3:card_name='吉普賽女巫' (Pattern D 跨時機配合) 6 張 ═══
  {
    name_zh: '占卜帳篷', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '吉普賽女巫',
    intent: '地點關鍵卡(asset),進場後常駐(passive)。【反應】在敵人進入你所在地點時:可從牌庫翻 1 張,如果是同軸卡免費打出。Pattern D 跨時機配合主驅動——別人的行動觸發你的回應。風味:紅紫帳布、銅鈴在風中作響、桌上一副被翻舊的塔羅。費用 3。',
  },
  {
    name_zh: '塔羅占卜', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '吉普賽女巫',
    intent: '事件,費用 1。【反應】在你或盟友抽混沌袋標記前:翻 2 個標記,選 1 個保留、另 1 個塞回袋裡(陣營被動的強化版)。Pattern D 跨時機。風味:你抽出一張塔羅放在桌上,圖案在燭光中似乎自己動了一下。',
  },
  {
    name_zh: '預知反應', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '吉普賽女巫',
    intent: '技能,費用 0。加值意志檢定 +1。【反應】在你即將失敗一次檢定時:可投入此卡並 reroll 1 顆骰(失敗後反應)。Pattern D 跨時機核心。風味:你的眼神在骰子落地前已經閃了一下——你早就知道結果。',
  },
  {
    name_zh: '燭光儀式', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '吉普賽女巫',
    intent: '事件,費用 1。【反應】在敵人即將攻擊你或盟友時:該攻擊改為對其進行 1 次意志檢定(DC 3),失敗則攻擊取消。Pattern D 跨時機防禦。風味:你劃了一個圈,點上 3 根蠟燭——它的爪子停在你眼前 3 公分處。',
  },
  {
    name_zh: '水晶球', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'card_name', primary_axis_value: '吉普賽女巫',
    intent: '配件型資產,費用 2,法器卡(is_talisman=true)。talisman_type=crystal、target_threat_types=["mental"]、break_timing=stockpile、break_charge_label=預兆。每回合自動 +1 預兆、最多累積 4 預兆。【反應】在你抽遭遇卡前:可消耗 1 預兆 → 改為翻 2 選 1。Pattern D 跨時機消費。風味:玻璃球體中浮著一個霧氣模糊的影子,只有你看得見它在動。',
  },
  {
    name_zh: '塔羅之刃', card_type: 'event', slot: 'arcane',
    combat_style: 'arcane', spell_type: 'combat_destruction', spell_casting: 'incantation',
    primary_axis_layer: 'card_name', primary_axis_value: '吉普賽女巫',
    intent: '法術卡(card_type=event, combat_style=arcane, slot=arcane, spell_type=combat_destruction, spell_casting=incantation),費用 2。【反應】在敵人攻擊你或盟友後:對該敵人造成 3 點傷害。Pattern D 跨時機反擊型法術。風味:你抽出「劍」逆位,影子化為刀刃,從它的背後刺穿。',
  },

  // ═══ 軸 4:card_name='神秘學者' (Pattern E 成本轉移) 6 張 ═══
  {
    name_zh: '密儀書房', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '神秘學者',
    intent: '地點關鍵卡(asset),進場後常駐(passive)。【行動】可承受 1 點恐懼 → 該回合下次法術卡費用 −2(用精神燃料降費)。Pattern E 成本轉移主驅動——施法的代價從資源換成 SAN。風味:燭光只夠照亮翻開的那一頁,牆上的影子比人還高。費用 3。',
  },
  {
    name_zh: '禁忌儀式', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '神秘學者',
    intent: '事件,費用 0。承受 2 點恐懼 → 抽 3 張牌(SAN 換情報)。Pattern E 成本轉移核心。風味:你知道讀完這段咒文會付出代價——但你還是讀了,因為你需要那個答案。',
  },
  {
    name_zh: '血祭催化', card_type: 'event', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '神秘學者',
    intent: '事件,費用 0。承受 1 點傷害 → 該回合下次施法檢定 +3(血祭增幅)。Pattern E 成本轉移。風味:刀尖劃過手心,鮮血滴在符文中央——這次的法術不會失敗。',
  },
  {
    name_zh: '儀式準備', card_type: 'skill', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '神秘學者',
    intent: '技能,費用 0。加值意志檢定 +2。如果該檢定為法術施放:可承受 1 點恐懼改為 +3(成本轉移強化)。Pattern E 弱版。風味:三天禁食、半夜不睡——你早就準備好為這個法術付出代價。',
  },
  {
    name_zh: '密教祭壇', card_type: 'asset', slot: 'none',
    primary_axis_layer: 'card_name', primary_axis_value: '神秘學者',
    intent: '資產,費用 2,法器卡(is_talisman=true)。talisman_type=scroll、target_threat_types=["ritual"]、break_timing=test、break_test_attribute=willpower、break_charge_label=信約。【消費】可消費此卡並承受 2 點恐懼 → 完全破除一張儀式類遭遇卡(代價型破除)。Pattern E 成本轉移破事軸。風味:石臺上刻滿了密密麻麻的符文,你的血滴在中央,圖案發出微光。',
  },
  {
    name_zh: '空間扭曲', card_type: 'event', slot: 'arcane',
    combat_style: 'arcane', spell_type: 'spacetime_planar', spell_casting: 'ritual',
    primary_axis_layer: 'card_name', primary_axis_value: '神秘學者',
    intent: '法術卡(card_type=event, combat_style=arcane, slot=arcane, spell_type=spacetime_planar, spell_casting=ritual),費用 2。【行動】可承受 1 點恐懼 → 移動到任意已揭露地點(SAN 換移動)。Pattern E 成本轉移。風味:你誦完最後一句,腳下的地板一陣翻轉——你已經站在三個房間外。',
  },

  // ═══ 軸 5:combat_style='arcane' (橫向法術軸) 6 張 ═══
  {
    name_zh: '預兆水晶', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'arcane',
    intent: '配件型法器卡(is_talisman=true),費用 2。talisman_type=crystal、target_threat_types=["mental"]、break_timing=stockpile、break_charge_label=預兆、break_charge_max=6。每回合自動 +1 預兆、最多累積 6 預兆。預兆可消費 → 破除精神類遭遇卡 1 張(每張卡花 1 預兆/強度)。陣營代表物件(§5.7 明示)。風味:紫色的橢圓水晶,握在手心會微微發燙——它在抓住「還沒發生的事」。',
  },
  {
    name_zh: '魔能護盾', card_type: 'event', slot: 'arcane',
    combat_style: 'arcane', spell_type: 'protection_evasion', spell_casting: 'channeling',
    primary_axis_layer: 'combat_style', primary_axis_value: 'arcane',
    intent: '法術卡(card_type=event, combat_style=arcane, slot=arcane, spell_type=protection_evasion, spell_casting=channeling),費用 1。【行動】施放後該回合受到的傷害 −2。風味:空氣在你身前凝結成一層淡紫色的薄膜,別人看不見,但碰到的會反彈。',
  },
  {
    name_zh: '心靈刺擊', card_type: 'event', slot: 'arcane',
    combat_style: 'arcane', spell_type: 'combat_destruction', spell_casting: 'incantation',
    primary_axis_layer: 'combat_style', primary_axis_value: 'arcane',
    intent: '法術卡(card_type=event, combat_style=arcane, slot=arcane, spell_type=combat_destruction, spell_casting=incantation),費用 2。【行動】對 1 個敵人進行意志檢定(DC 3),成功則造成 4 點傷害。風味:你不需要碰它——你只要想著它的名字,它的腦中就會炸開。',
  },
  {
    name_zh: '塔羅牌組', card_type: 'asset', slot: 'accessory',
    primary_axis_layer: 'combat_style', primary_axis_value: 'arcane',
    intent: '配件型資產,費用 1。【消費】可消費此卡 → 翻牌頂 3 張選 1 加入手牌,其餘洗回。陣營代表物件(§5.7 雙用途消耗品)。風味:78 張塔羅,牌背是相同的星空圖,但每一張的故事都不同。',
  },
  {
    name_zh: '驅邪儀式', card_type: 'event', slot: 'arcane',
    combat_style: 'arcane', spell_type: 'healing_purification', spell_casting: 'ritual',
    primary_axis_layer: 'combat_style', primary_axis_value: 'arcane',
    intent: '法術卡(card_type=event, combat_style=arcane, slot=arcane, spell_type=healing_purification, spell_casting=ritual),費用 2。【行動】移除 1 張你或盟友身上的恐懼/詛咒類狀態,並回復 2 點理智。風味:鹽圈、聖水、低聲誦讀——那個附著在他身上的東西終於鬆開了爪子。',
  },
  {
    name_zh: '召喚靈體', card_type: 'event', slot: 'arcane',
    combat_style: 'arcane', spell_type: 'summoning_binding', spell_casting: 'ritual',
    primary_axis_layer: 'combat_style', primary_axis_value: 'arcane',
    intent: '法術卡(card_type=event, combat_style=arcane, slot=arcane, spell_type=summoning_binding, spell_casting=ritual),費用 3。【行動】召喚 1 個靈體盟友(HP 1 SAN 1),於本場景結束前協助你進行檢定 +1。風味:你在地上畫了一個五芒星,空氣中浮現一個半透明的人影——他朝你點了點頭。',
  },
];

log(`目標 ${N_BRIEFS.length} 張\n`);

const results = { created: [], skipped: [], failed: [] };

for (let i = 0; i < N_BRIEFS.length; i++) {
  const brief = N_BRIEFS[i];
  log(`\n─── [${i + 1}/${N_BRIEFS.length}] ${brief.name_zh} ───`);

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
  if (brief.spell_type) lockHints.push(`spell_type:${brief.spell_type}`);
  if (brief.spell_casting) lockHints.push(`spell_casting:${brief.spell_casting}`);
  if (brief.primary_axis_layer) lockHints.push(`primary_axis_layer:${brief.primary_axis_layer}`);
  if (brief.primary_axis_value) lockHints.push(`primary_axis_value:${brief.primary_axis_value}(純名,DB 不存書名號)`);
  lockHints.push(`series:N(N 陣營批次)`);
  lockHints.push(`faction:N(天啟)`);
  lockHints.push(`star/level:0(基礎卡)`);

  const userDescription = [
    `## 綱要(設計意圖)`,
    brief.intent,
    ``,
    `## 結構鎖定(必須照填)`,
    lockHints.map((s) => '- ' + s).join('\n'),
    ``,
    `## N 陣營(天啟)氣質提醒`,
    `- 一句話:我看見的不是未來,是被世界藏起來的現在。`,
    `- 核心策略:混沌袋與未來資訊操控者(預知遭遇卡、預見敵人行動、操作混沌袋標記,把不確定性變成可控資源)`,
    `- 陣營基礎被動:混沌袋抽取時可看 2 選 1 — 設計時可加成這個被動`,
    `- 戰鬥節奏:施法(arcane)為主,意志為主屬性,法術為主要傷害途徑`,
    `- 風味:紫羅蘭色,夢境、預兆、塔羅、水晶球、古文符號的神秘學氣質`,
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
      existingFilter: { faction: 'N', primary_axis_value: brief.primary_axis_value },
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
  card.series = 'N';
  if (card.starting_xp == null) card.starting_xp = 0;
  if (card.level == null) card.level = 0;
  if (!card.faction) card.faction = 'N';
  if (brief.card_type) card.card_type = brief.card_type;
  if (brief.slot) card.slot = brief.slot;
  if (brief.combat_style) card.combat_style = brief.combat_style;
  if (brief.spell_type) card.spell_type = brief.spell_type;
  if (brief.spell_casting) card.spell_casting = brief.spell_casting;
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
