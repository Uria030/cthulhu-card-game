// G1 30 張玩家卡 — 全自動 AI 生成版(B2 路徑)
// 流程:綱要 → buildCardGeminiPrompt(三路徑單一來源) → Gemini → s06 驗閘 → 自動修正 → POST
// 冪等(feedback_idempotent_scripts):既有同 name_zh 卡 skip;失敗卡寫到 failed log
import { adminFetch, adminGet } from './api.mjs';
import { generateValidatedCard, formatValidationReport } from './lib/generate-card.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `g1-cards-ai-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# G1 30 玩家卡 AI 生成 ${stamp}`);
log(`規範來源:packages/client/public/admin/admin-card-prompt.js(三路徑單一來源 UMD)`);
log(`驗閘:scripts/g1-sandbox/lib/card-validator.mjs(s06 v2 規範 + effect_code 白名單 + hallucination)\n`);

// ──────── 抓既有卡(冪等檢查 + 重名 skip)────────
const existing = await adminGet('/api/cards');
const existingArr = Array.isArray(existing) ? existing : (existing.cards || existing.data || []);
const existingNameSet = new Set(existingArr.map((c) => c.name_zh));
log(`既有 ${existingArr.length} 張(將跳過同 name_zh 的卡)\n`);

// ──────── 30 張綱要(對齊 G1 沙盒關卡執行交付書 Part 2 §4.1-§4.8 + Part 3 劇本氛圍)────────
// 每筆綱要 = 一段給 Gemini 的設計敘述 + 結構鎖定欄位(series/faction 等)。
// Gemini 自由發揮:cost / commit_icons / effects / flavor_text / 名稱英譯 / V 值估算

const G1_BRIEFS = [
  // ── §4.1 武器資產 4 張(鐵證偵探氛圍)──
  { name_zh: '.45 自動手槍', card_type: 'asset', combat_style: 'shooting', slot: 'one_hand',
    intent: '鐵證偵探的標準配備:.45 自動手槍。中等傷害、6 發彈藥、需要彈匣補充。打出時佔一手槽,可消費攻擊。風味:沉重鋼鐵、冷藍反光、印斯茅斯海腥味的反襯。系列軸 cardname=「鐵證偵探」' },
  { name_zh: '黃銅指虎', card_type: 'asset', combat_style: 'brawl', slot: 'one_hand',
    intent: '近距搏擊武器,費用 1。簡單直接的傷害武器,無彈藥但近身肉搏強度高。風味:當禮貌話講不通時的直接辦法。系列軸 cardname=「鐵證偵探」' },
  { name_zh: '隨身短刀', card_type: 'asset', combat_style: 'brawl', slot: 'one_hand',
    intent: '隱藏武器,費用 1,搏擊風格。隨身攜帶不起眼但永遠在身邊。風味:口袋裡的最後保險。系列軸 cardname=「鐵證偵探」' },
  { name_zh: '備用彈匣', card_type: 'asset', slot: 'accessory',
    intent: '配件,費用 1。用於補充手槍彈藥(消費效果為 reload_weapon 6 發)。風味:多餘的子彈是命的延長線。系列軸 cardname=「鐵證偵探」' },

  // ── §4.2 防具/護身符 2 張 ──
  { name_zh: '皮製大衣', card_type: 'asset', slot: 'body',
    intent: '輕度防具,費用 2。減免少量物理傷害,提供隱藏感。風味:磨破的皮夾克吸過太多雨水。faction=S' },
  { name_zh: '銀色十字', card_type: 'asset', slot: 'accessory', is_talisman: true, talisman_type: 'silver',
    intent: '法器:銀製,instant 破除,對抗精神侵蝕(mental)。費用 2。充能 3。每次破除花 1 充能。風味:外婆給的舊十字架。faction=S' },

  // ── §4.3 工具 4 張 ──
  { name_zh: '便攜燈', card_type: 'asset', slot: 'accessory',
    intent: '光源工具,費用 1。可在地點施加「光照」狀態(create_light)。電池有限。風味:暗巷裡的微弱救命光。faction=S' },
  { name_zh: '老式相機', card_type: 'asset', slot: 'accessory',
    intent: '證據蒐集工具,費用 2。可消費以調查地點(discover_clue)。鐵證偵探拿手裝備。風味:快門按下後就有交代。faction=S 系列軸 cardname=「鐵證偵探」' },
  { name_zh: '撬鎖工具', card_type: 'asset', slot: 'accessory',
    intent: '工具,費用 1。對「鎖」類遭遇進行檢定加值或自動成功。風味:有時候門就只是道門。faction=S' },
  { name_zh: '醫療包', card_type: 'asset', slot: 'accessory',
    intent: '消耗品,費用 2,3 次使用。每次治癒 2 點傷害。風味:總要有人記得帶這個。faction=S' },

  // ── §4.4 盟友 2 張 ──
  { name_zh: '碼頭線人', card_type: 'ally',
    intent: '盟友:碼頭裡的線人。費用 3。HP 2 SAN 2。可消費取得地點線索資訊。風味:他知道誰昨晚從深水區游上岸。faction=S' },
  { name_zh: '同行警員', card_type: 'ally',
    intent: '盟友:警局舊同事。費用 4。HP 3 SAN 2。攻擊輔助(自動造成少量傷害)。風味:他欠你一條命,不過他不知道。faction=S' },

  // ── §4.5 一般技能 4 張 ──
  { name_zh: '機警', card_type: 'skill',
    intent: '技能卡,費用 0。加值感知檢定 +2。風味:多看一眼,多活一天。faction=S' },
  { name_zh: '不動聲色', card_type: 'skill',
    intent: '技能卡,費用 0。加值意志檢定 +2,對抗 SAN 損失。風味:臉是面具,眼睛才會洩底。faction=S' },
  { name_zh: '逐線索查', card_type: 'skill',
    intent: '技能卡,費用 0。加值智力檢定 +1,並可重抽 1 顆失敗骰。風味:案子都是這樣解開的——一條一條繩子拉。faction=S' },
  { name_zh: '鎮定射擊', card_type: 'skill',
    intent: '技能卡,費用 0。加值反應檢定 +2,僅限 shooting 風格攻擊。風味:呼氣,等心跳間隔,扣板機。faction=S' },

  // ── §4.6 戰鬥技能 4 張 ──
  { name_zh: '近距精確', card_type: 'skill',
    intent: '戰鬥技能,費用 0。加值力量檢定 +2,僅限 brawl/sidearm 風格。風味:臉前 30 公分內的一切細節。faction=S' },
  { name_zh: '反擊姿態', card_type: 'skill',
    intent: '戰鬥技能,費用 0。在你被攻擊時可消費為反應,對攻擊者進行 1 次反擊判定。風味:你打我,我打回去。faction=S' },
  { name_zh: '蹲低瞄準', card_type: 'skill',
    intent: '戰鬥技能,費用 0。加值感知檢定 +1 並讓本次 shooting 攻擊 +1 傷害。風味:子彈不講話,姿勢講話。faction=S' },
  { name_zh: '埋伏優勢', card_type: 'skill',
    intent: '戰鬥技能,費用 0。本回合首次攻擊命中時自動爆擊。風味:他從來不知道你已經到了。faction=S' },

  // ── §4.7 事件 6 張 ──
  { name_zh: '緊急撤退', card_type: 'event',
    intent: '事件,費用 1。立即移動到相鄰地點,且該回合內你不會被任何敵人交戰。風味:打不過,跑就是了。faction=S' },
  { name_zh: '電話一通', card_type: 'event',
    intent: '事件,費用 0。獲得 2 資源並抽 1 張牌。風味:條子的人脈值錢。faction=S' },
  { name_zh: '臨時包紮', card_type: 'event',
    intent: '事件,費用 1。治癒自己 2 點傷害。風味:用襯衫撕條繃帶,這已經不是第一次。faction=S' },
  { name_zh: '緊急冷靜', card_type: 'event',
    intent: '事件,費用 1。治癒自己 2 點恐懼,並在本回合 +1 意志檢定。風味:深呼吸,數到三。faction=S' },
  { name_zh: '線索匯整', card_type: 'event',
    intent: '事件,費用 1。在你所在地點獲得 2 點線索。風味:把所有零碎拼上來,圖才會完整。faction=S' },
  { name_zh: '一發逆轉', card_type: 'event',
    intent: '事件,費用 2。本回合下次 shooting 攻擊自動成功且 +2 傷害。風味:有些子彈是為這一刻準備的。faction=S' },

  // ── §4.8 短休息事件 4 張 ──
  { name_zh: '熱咖啡', card_type: 'event',
    intent: '事件,費用 0,僅短休息可打。獲得 2 資源。風味:苦的,但能撐過下一條街。faction=S' },
  { name_zh: '事務所筆記', card_type: 'event',
    intent: '事件,費用 0,僅短休息可打。抽 2 張牌。風味:十年的案子都記在這上面。faction=S' },
  { name_zh: '臨機應變', card_type: 'event',
    intent: '事件,費用 0。選擇一項:獲得 1 資源 / 抽 1 張牌。風味:計畫永遠趕不上變化,那就放棄計畫。faction=S' },
  { name_zh: '一夜未眠', card_type: 'event',
    intent: '事件,費用 0,僅短休息可打。治癒 1 點傷害並抽 1 張牌。風味:燈下又是一夜,案子近了。faction=S' },
];

log(`目標 ${G1_BRIEFS.length} 張\n`);

const results = { created: [], skipped: [], failed: [] };

for (let i = 0; i < G1_BRIEFS.length; i++) {
  const brief = G1_BRIEFS[i];
  log(`\n─── [${i + 1}/${G1_BRIEFS.length}] ${brief.name_zh} ───`);

  // 冪等:既有同 name_zh 跳過
  if (existingNameSet.has(brief.name_zh)) {
    log(`⊙ skip(既有):${brief.name_zh}`);
    results.skipped.push(brief.name_zh);
    continue;
  }

  // 組 userDescription:綱要 + 結構鎖定提示
  const lockHints = [];
  lockHints.push(`卡名:「${brief.name_zh}」(必須使用此名,不要修改)`);
  if (brief.card_type) lockHints.push(`類型:${brief.card_type}`);
  if (brief.slot) lockHints.push(`配件欄:${brief.slot}`);
  if (brief.combat_style) lockHints.push(`戰鬥風格:${brief.combat_style}`);
  if (brief.is_talisman) lockHints.push(`is_talisman:true`);
  if (brief.talisman_type) lockHints.push(`talisman_type:${brief.talisman_type}`);
  lockHints.push(`series:G(G1 沙盒關卡)`);
  lockHints.push(`faction:S(鐵證,除非綱要明示其他陣營)`);
  lockHints.push(`star/level:0(基礎卡)`);

  const userDescription = [
    `## 綱要(設計意圖)`,
    brief.intent,
    ``,
    `## 結構鎖定(必須照填)`,
    lockHints.map((s) => '- ' + s).join('\n'),
    ``,
    `## s06 文法硬性要求`,
    `- 每條 effect 的 desc_zh 必含【行動】/【免費行動】/【反應】/【被動】/【強制】/【加值】/【消費】其中之一框架`,
    `- 主詞用「你」,自指用「此卡」`,
    `- 阿拉伯數字 + 全形減號「−」`,
    `- 觸發句「在 X 時」(不用「當 X 時」),條件句「如果 X」(不用「若 X」)`,
    `- 「抽 X 張牌」(不寫「卡」)、「獲得 X 資源」(不寫「個」)`,
  ].join('\n');

  let r;
  try {
    r = await generateValidatedCard({
      userDescription,
      existingFilter: { faction: 'S', series: 'G' },
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

  // 強制鎖定欄位:Gemini 可能漏填或亂改 series/star,後驗強制覆寫
  const card = r.card;
  card.series = 'G';
  if (card.starting_xp == null) card.starting_xp = 0;
  if (card.level == null) card.level = 0;
  if (!card.faction) card.faction = 'S';
  if (brief.card_type) card.card_type = brief.card_type;
  if (brief.slot) card.slot = brief.slot;
  if (brief.combat_style) card.combat_style = brief.combat_style;
  if (brief.is_talisman != null) card.is_talisman = !!brief.is_talisman;
  if (brief.talisman_type) card.talisman_type = brief.talisman_type;
  if (!card.name_zh || card.name_zh !== brief.name_zh) card.name_zh = brief.name_zh;

  // shape 對齊後台 API:effects[].description_zh / description_en / effect_params(舊欄位)
  // 後台 cards.ts 接受新舊兩種,這邊統一用新版(desc_zh / desc_en / params)
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
