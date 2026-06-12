// 怪物行為腳本回填(冪等):
// 1) 裂嘴女關卡低位變體 → 位階預設 move_pattern(t1 pure_random / t2 weighted)
// 2) 頭目 G1_deep_one_slit_mouth → Gemini 依 s14 補充文件 #2 §6.2 模板生成 conditional 腳本 → 驗閘 → 入庫
// 用法:node backfill-behavior-scripts.mjs [--dry](--dry 只印不寫)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminGet, adminPut } from './api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry');
const BOSS = 'G1_deep_one_slit_mouth';

// ── Gemini key(setup-gemini-key.bat 寫的本機檔)──
function geminiKey() {
  if (process.env.GEMINI_API_KEY_PERSONAL) return process.env.GEMINI_API_KEY_PERSONAL;
  const p = path.join(__dirname, 'GeminiKey.txt');
  return fs.readFileSync(p, 'utf8').trim();
}

async function callGemini(prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': geminiKey(), 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
}

// ── 取變體完整資料(PUT 全欄位需原值):走 play bootstrap(monsters = SELECT mv.* 完整列)──
const STAGE_ID = '9ad171b3-c439-4049-b673-b929f91366ce';
let BOOTSTRAP_MONSTERS = null;
async function getVariantByCode(code) {
  if (!BOOTSTRAP_MONSTERS) {
    const r = await fetch(
      `https://server-production-fc4f.up.railway.app/api/play/stages/${STAGE_ID}/bootstrap`,
    );
    const { data } = await r.json();
    BOOTSTRAP_MONSTERS = data?.monsters ?? [];
  }
  return BOOTSTRAP_MONSTERS.find((v) => v.code === code) ?? null;
}

async function putVariant(variant, patch) {
  if (DRY) {
    console.log(`[dry] PUT ${variant.code}:`, JSON.stringify(patch).slice(0, 200));
    return;
  }
  await adminPut(`/api/admin/monsters/variants/${variant.id}`, { ...variant, ...patch });
}

// ── 驗閘(補充文件 §6.3/6.4 子集)──
const SUPPORTED_TRIGGERS = new Set(['turn_count', 'hp_percent', 'san_percent', 'last_move', 'random_chance', 'and', 'or']);
function validateScript(script, validCodes) {
  const errors = [];
  const moves = script?.moves ?? [];
  if (!Array.isArray(moves) || moves.length < 3) errors.push('moves 少於 3 條');
  let hasForced = false;
  for (const m of moves) {
    if (!validCodes.has(m.code)) errors.push(`招式 ${m.code} 不在招式池`);
    if (m.forced) hasForced = true;
    const stack = m.trigger_condition ? [m.trigger_condition] : [];
    while (stack.length) {
      const c = stack.pop();
      if (!SUPPORTED_TRIGGERS.has(String(c.type))) errors.push(`不支援的觸發型別 ${c.type}(招式 ${m.code})`);
      for (const sub of c.conditions ?? []) stack.push(sub);
    }
  }
  if (!hasForced) errors.push('缺強制開場招(forced)');
  if (!moves.some((m) => !m.trigger_condition || m.trigger_condition == null)) {
    // 至少一條無條件 fallback 招,避免全部條件不滿足時每回合 fallback 加權打破腳本感
    errors.push('缺無條件 fallback 招');
  }
  return errors;
}

// ── 1) 低位變體:位階預設 ──
const LOW_TIER_DEFAULTS = [
  { code: 'G1_street_thug_basic', move_pattern: 'pure_random' },
  { code: 'mv_cultist_fanatic', move_pattern: 'pure_random' },
  { code: 'G1_deep_one_revenant', move_pattern: 'pure_random' },
  { code: 'mv_tcho_tcho_cannibal', move_pattern: 'weighted' },
];
for (const item of LOW_TIER_DEFAULTS) {
  const v = await getVariantByCode(item.code);
  if (!v) { console.log(`✗ 找不到變體 ${item.code}`); continue; }
  if (v.move_pattern === item.move_pattern) { console.log(`= ${item.code} 已是 ${item.move_pattern}`); continue; }
  await putVariant(v, { move_pattern: item.move_pattern });
  console.log(`✓ ${item.code} → ${item.move_pattern}`);
}

// ── 2) 頭目 conditional 腳本 ──
const boss = await getVariantByCode(BOSS);
if (!boss) throw new Error('找不到頭目變體 ' + BOSS);
if (boss.move_pattern === 'conditional' && boss.behavior_script?.moves?.length) {
  console.log('= 頭目腳本已存在,跳過(冪等)');
  process.exit(0);
}
if (DRY) {
  console.log(`[dry] 將為 ${BOSS} 呼叫 Gemini 生成 conditional 腳本(dry 模式不打 Gemini、不寫入)`);
  process.exit(0);
}

// 招式池資料(給 Gemini 看真實 mac code 與內容)
const lib = await adminGet('/api/admin/monsters/attack-cards/library');
const allCards = lib.data ?? lib.cards ?? [];
const poolCodes = (boss.move_pool ?? []).map((m) => m.code);
const poolCards = allCards.filter((c) => poolCodes.includes(c.code));
console.log(`頭目招式池 ${poolCodes.length} 招`);

const prompt = `你是一名克蘇魯神話卡牌冒險遊戲的怪物行為設計師。請為頭目設計 conditional(條件觸發)行為腳本。

【怪物】深潛者裂嘴女(House of Cthulhu,tier 3,雨夜暗巷頭目)
家族風味:克蘇魯家族 = 潮汐般的壓迫感累積;劇本設定:都市傳說「裂嘴女」真身,
開場問「我...漂亮嗎?」,玩家理智高時攻心、自身重傷時轉入兇暴的深海本性。

【招式池(只能引用這些 code)】
${poolCards.map((c) => `- ${c.code}:${c.name_zh}(防禦屬性 ${c.defense_attribute},物理 ${c.damage_physical}/恐懼 ${c.damage_horror})`).join('\n')}

【輸出 JSON 格式(嚴格遵守)】
{
  "moves": [
    { "code": "<mac code>", "trigger_condition": {"type":"turn_count","operator":"=","value":1}, "forced": true, "priority": 1, "cooldown": "permanent" },
    { "code": "<mac code>", "trigger_condition": {"type":"san_percent","operator":">=","value":70}, "priority": 2 },
    { "code": "<mac code>", "trigger_condition": {"type":"hp_percent","operator":"<=","value":50}, "priority": 2, "weight": 2 },
    { "code": "<mac code>", "priority": 5 }
  ]
}

【設計紀律】
1. 觸發型別只准用:turn_count / hp_percent(怪物自身)/ san_percent(目標玩家)/ last_move / random_chance / and / or
2. 第一回合必須有 forced 開場招(cooldown "permanent",敘事鎮場)
3. 玩家 san_percent 高(>=70)時要有攻心向招式(恐懼傷害高者)
4. 自身 hp_percent <= 50 時轉兇暴(物理傷害高者,priority 提前)
5. 必須至少一條「無 trigger_condition」的 fallback 招(priority 最大)
6. 5-7 條 moves,全部引用上面的真實 code,禁止虛構
只輸出 JSON,不要其他文字。`;

console.log('呼叫 Gemini 2.5 Pro 生成頭目腳本...');
const script = await callGemini(prompt);
const errors = validateScript(script, new Set(poolCodes));
if (errors.length > 0) {
  console.error('驗閘失敗:', errors);
  console.error('產出:', JSON.stringify(script, null, 1));
  process.exit(1);
}
console.log('驗閘通過,腳本:');
for (const m of script.moves) {
  console.log(`  ${m.forced ? '[強制]' : ''}${m.code} pri=${m.priority ?? '-'} cond=${JSON.stringify(m.trigger_condition ?? null)}`);
}
await putVariant(boss, { move_pattern: 'conditional', behavior_script: script });
console.log(`✓ ${BOSS} → conditional 腳本入庫`);
