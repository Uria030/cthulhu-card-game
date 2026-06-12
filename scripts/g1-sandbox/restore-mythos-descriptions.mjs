// 災難恢復:backfill-mythos-openhand.mjs v1 因回應包裝鍵讀錯(mythos_card),
// PUT 時把 9 張卡的 description/flavor/design_notes/response_trigger 等
// 非 COALESCE 欄位寫成 NULL。本腳本從三個原始來源恢復敘述欄位:
//   ① write-mythos-base-26.mjs CARDS 陣列(瘋狂攫住/恐懼侵襲,含原設計 open-hand 值)
//   ② g1-sandbox/08-mythos-encounter.mjs(黑暗滲出/海腥味瀰漫/雨勢加劇/深潛者增援)
//   ③ migrate.ts seed(深淵呼喚/末日推進/不祥預感 — 含 response_trigger)
// 原則:只還原被毀欄位;action_cost 等 COALESCE 保住的現值不動;
//   ①來源同時恢復原設計 reusable/cooldown/max_uses(覆蓋我誤填的猜值)。
// 用法:node restore-mythos-descriptions.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminGet, adminPut } from './api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry');

function extractArray(file, marker) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf(marker);
  const open = src.indexOf('[', start);
  // 找到對應的關閉 ];(以 '\n];' 形式)
  const end = src.indexOf('\n];', open);
  if (start < 0 || open < 0 || end < 0) throw new Error('陣列萃取失敗:' + marker);
  return new Function('return ' + src.slice(open, end + 2))();
}

// 來源①:26 基底(含 open-hand 原設計值)
const base26 = extractArray(
  path.join(__dirname, '../mod-agent-local/keeper-cards/write-mythos-base-26.mjs'),
  'const CARDS = ',
);
// 來源②:G1 step-08(只取敘述欄位)
const g1cards = extractArray(path.join(__dirname, '08-mythos-encounter.mjs'), 'const MYTHOS = ');

// 來源③:migrate seed(手抄,對照 migrate.ts L1270-1279)
const SEEDS = [
  {
    name_zh: '深淵呼喚',
    description_zh: '從深淵中召喚一隻克蘇魯眷族的怪物。',
    flavor_text_zh: '鹹濕的風從遠方吹來，海浪聲中夾雜著某種古老的節奏——牠們來了。',
  },
  {
    name_zh: '末日推進',
    description_zh: '加速議程推進速度。',
    flavor_text_zh: '時鐘指針加速轉動，某種不祥的計畫正在成熟。',
  },
  {
    name_zh: '不祥預感',
    description_zh: '響應調查員的攻擊行動，強制其重擲並取較差結果。',
    flavor_text_zh: '就在扣下扳機的瞬間，一股寒意從脊椎竄上。時間彷彿慢了下來，你聽見了自己的心跳，以及——另一個東西的心跳。',
    response_trigger: 'investigator_attacks',
  },
];

const DESC_FIELDS = ['description_zh', 'description_en', 'flavor_text_zh', 'flavor_text_en', 'design_notes', 'response_trigger'];
const OPENHAND_FIELDS = ['reusable', 'cooldown_rounds', 'max_uses_per_stage', 'persistence_mode', 'attachment_target'];

function buildPatch(original, includeOpenhand) {
  const patch = {};
  for (const f of DESC_FIELDS) if (original[f] !== undefined) patch[f] = original[f];
  if (includeOpenhand) {
    for (const f of OPENHAND_FIELDS) if (original[f] !== undefined) patch[f] = original[f];
  }
  return patch;
}

const PLAN = [
  ...['瘋狂攫住', '恐懼侵襲'].map((n) => ({ name: n, source: base26, openhand: true })),
  ...['黑暗滲出', '海腥味瀰漫', '雨勢加劇', '深潛者增援'].map((n) => ({ name: n, source: g1cards, openhand: false })),
  ...['深淵呼喚', '末日推進', '不祥預感'].map((n) => ({ name: n, source: SEEDS, openhand: false })),
];

const list = await adminGet('/api/admin/keeper/mythos-cards');
const cards = list.mythos_cards ?? [];
let done = 0;
for (const item of PLAN) {
  const current = cards.find((c) => c.name_zh === item.name);
  const original = item.source.find((o) => o.name_zh === item.name);
  if (!current || !original) {
    console.log(`✗ 【${item.name}】 current=${!!current} original=${!!original}`);
    continue;
  }
  const patch = buildPatch(original, item.openhand);
  const body = { ...current, ...patch };
  if (DRY) {
    console.log(`[dry] ${item.name}:`, JSON.stringify(patch).slice(0, 160));
  } else {
    await adminPut(`/api/admin/keeper/mythos-cards/${current.id}`, body);
    console.log(`✓ ${item.name} 恢復 desc(${patch.description_zh?.length ?? 0}字)+flavor${item.openhand ? '+原設計 open-hand 值' : ''}`);
  }
  done += 1;
}
console.log(`完成 ${done}/${PLAN.length}`);
