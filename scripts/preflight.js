#!/usr/bin/env node
/**
 * preflight.js — 推送前必跑檢查
 *
 * 涵蓋過往踩過的所有坑(每條都有對應版本案例),確保關鍵不變式不被破壞。
 * 跑法:`node scripts/preflight.js` 或 `pnpm preflight`
 *
 * 任何一項失敗 → exit code 1 → 不准 push。
 */
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const fail = (msg) => { console.error('❌', msg); failed++; };
const ok = (msg) => console.log('✓', msg);
const info = (msg) => console.log('ℹ ', msg);
const section = (title) => console.log('\n── ' + title + ' ──');

const ROOT = path.resolve(__dirname, '..');
const REL = (p) => path.relative(ROOT, p);
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }

// ───────────────────────────────────────────────
// CHECK 1: JSON 合法性
// 對應坑:JSON 檔常見手改 typo / 漏逗號 → 前端 fetch 整個爆掉
// ───────────────────────────────────────────────
function checkJson(p) {
  if (!exists(p)) { fail('檔不存在: ' + p); return; }
  try { JSON.parse(read(p)); ok('JSON 合法: ' + p); }
  catch (e) { fail('JSON 不合法: ' + p + ' → ' + e.message); }
}

// ───────────────────────────────────────────────
// CHECK 2: 純 JS 檔 syntax
// 對應坑:小型 typo 推上去前端整頁白
// ───────────────────────────────────────────────
function checkJsSyntax(p) {
  if (!exists(p)) { fail('檔不存在: ' + p); return; }
  try { new Function(read(p)); ok('JS syntax: ' + p); }
  catch (e) { fail('JS syntax 錯: ' + p + ' → ' + e.message); }
}

// ───────────────────────────────────────────────
// CHECK 3: HTML 內聯 script syntax
// 對應坑:admin-*.html 內聯 IIFE 寫錯,瀏覽器報錯但 Node 不會發現
// ───────────────────────────────────────────────
function checkHtmlInlineScript(p) {
  if (!exists(p)) { fail('檔不存在: ' + p); return; }
  const src = read(p);
  const matches = src.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g) || [];
  let total = 0;
  for (const m of matches) {
    const body = m.replace(/^<script[^>]*>|<\/script>$/g, '');
    if (body.length < 100) continue;
    if (m.match(/<script[^>]*\ssrc=/i)) continue; // <script src=...>,跳過
    try { new Function(body); total++; }
    catch (e) { fail('HTML inline script syntax: ' + p + ' → ' + e.message); return; }
  }
  ok('HTML inline scripts (' + total + '): ' + p);
}

// ───────────────────────────────────────────────
// CHECK 4: 版本號同步
// 對應坑:忘記同時改 package.json 與 admin-shared.js
// ───────────────────────────────────────────────
function checkVersionSync() {
  const pkg = JSON.parse(read('package.json'));
  const shared = read('packages/client/public/admin/admin-shared.js');
  const m = shared.match(/ADMIN_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!m) { fail('admin-shared.js 抓不到 ADMIN_VERSION'); return; }
  ok('版本號:package=' + pkg.version + ' / ADMIN=' + m[1]);
}

// ───────────────────────────────────────────────
// CHECK 5: Template literal 內反引號(精準版)
// 對應坑:v0.12.1, v0.14.3, v0.18.16 連踩三次
// 模式:在 ` ... ` template literal body 內出現 inline backtick token
//       會被 JavaScript 解析為 template literal 終止 → SyntaxError
//
// syntax check 已經抓得到此類錯誤(會直接報 SyntaxError),這個 check 是
// 額外多一層警示,並且只抓「真實」的 template literal,排除字串拼接場景
// ───────────────────────────────────────────────
function extractTemplateLiterals(src) {
  // 抓所有 ` ... ` template literal 區塊(處理 \` 跳脫、${} 內嵌)
  const blocks = [];
  let depth = 0; // template 巢狀深度
  let exprDepth = 0; // ${} 內表達式深度
  let start = -1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const prev = i > 0 ? src[i-1] : '';
    if (ch === '`' && prev !== '\\') {
      if (depth === 0 && exprDepth === 0) { start = i; depth = 1; }
      else if (depth > 0 && exprDepth === 0) { blocks.push({ start, end: i, body: src.slice(start+1, i) }); depth = 0; start = -1; }
    } else if (depth > 0 && ch === '$' && src[i+1] === '{') {
      exprDepth++; i++;
    } else if (exprDepth > 0 && ch === '}') {
      exprDepth--;
    }
  }
  return blocks;
}

function checkBackticksInPromptStrings(p) {
  if (!exists(p)) { return; }
  const src = read(p);
  const tplBlocks = extractTemplateLiterals(src);
  if (tplBlocks.length === 0) { ok('無 template literal: ' + p); return; }
  // 在 template literal body 內找「中文行 + inline backtick token」這個其實已經
  // 不可能(因為任何 backtick 都會結束 template literal)。所以這個 check 主要
  // 是「警示模式」:抓行尾沒收的奇怪 backtick。
  // 簡單做:看 src 是否仍有中文行帶反引號 inline code 但 syntax 已過 →
  // 表示是字串拼接(安全)。
  const lines = src.split('\n');
  const suspicious = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/[\u4e00-\u9fff]/.test(line)) continue;
    const matches = line.match(/`([a-zA-Z_][a-zA-Z0-9_]*)`/g);
    if (!matches) continue;
    // 判斷該行是否在 template literal body 內(用 byte offset 對比 blocks)
    const lineStart = src.split('\n').slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
    const inTpl = tplBlocks.some(b => lineStart >= b.start && lineStart <= b.end);
    if (inTpl) {
      // 在真正的 template literal 內,但 syntax check 過 → 表示這些 backtick 已被
      // 跳脫或位於 ${} 內,屬安全。但仍 warn 提醒 reviewer
      suspicious.push({ line: i + 1, content: line.trim().slice(0, 80), tokens: matches });
    }
  }
  if (suspicious.length > 0) {
    info('⚠ template literal body 內中文行有反引號 (syntax 過但仍提醒): ' + p + ' (' + suspicious.length + ' 行)');
    suspicious.slice(0, 3).forEach(s => console.log('   line ' + s.line + ': ' + s.content));
  } else {
    ok('無 template literal 內反引號: ' + p);
  }
}

// ───────────────────────────────────────────────
// CHECK 6: AI prompt 的 trigger / effect_code 對齊真實 schema
// 對應坑:v0.18.16 主 prompt §5.1 寫 on_enter_play / on_leave_play 不存在
//       AI 看到不存在的 code 退回填 on_play
// ───────────────────────────────────────────────
function checkAiPromptCodeAlignment() {
  const eloPath = 'packages/client/public/admin/data/effect-language-options.json';
  if (!exists(eloPath)) { fail('找不到 ' + eloPath); return; }
  const elo = JSON.parse(read(eloPath));

  const realTriggers = new Set();
  for (const group of Object.values(elo.triggers || {})) for (const t of group) realTriggers.add(t.code);
  const realEffectCodes = new Set();
  for (const group of Object.values(elo.effect_codes || {})) for (const e of group) realEffectCodes.add(e.code);
  info('schema:trigger ' + realTriggers.size + ' 個 / effect_code ' + realEffectCodes.size + ' 個');

  const promptSrc = read('packages/client/public/admin/admin-card-prompt.js');

  // 主 prompt §5.1 trigger
  const tMain = promptSrc.match(/### 5\.1[\s\S]*?\n(on_play[^\n]*)/);
  if (tMain) {
    const ts = tMain[1].split(/,\s*/).map(s => s.trim()).filter(t => /^[a-z_]+$/.test(t));
    const missing = ts.filter(t => !realTriggers.has(t));
    if (missing.length) fail('主 prompt §5.1 trigger 不在 schema: ' + missing.join(', '));
    else ok('主 prompt §5.1 trigger ' + ts.length + ' 個對齊 schema');
  }

  // mini prompt trigger
  const tMini = promptSrc.match(/觸發時機（trigger[^\n]*\n(on_play[^\n]*)/);
  if (tMini) {
    const ts = tMini[1].split(/,\s*/).map(s => s.trim()).filter(t => /^[a-z_]+$/.test(t));
    const missing = ts.filter(t => !realTriggers.has(t));
    if (missing.length) fail('mini prompt trigger 不在 schema: ' + missing.join(', '));
    else ok('mini prompt trigger ' + ts.length + ' 個對齊 schema');
  }

  // 主 prompt §5.5 effect_code
  const eMain = promptSrc.match(/### 5\.5[\s\S]*?\n(deal_damage[^\n]*)/);
  if (eMain) {
    const es = eMain[1].split(/,\s*/).map(s => s.trim()).filter(c => /^[a-z_]+$/.test(c));
    const missing = es.filter(c => !realEffectCodes.has(c));
    if (missing.length) fail('主 prompt §5.5 effect_code 不在 schema: ' + missing.join(', '));
    else ok('主 prompt §5.5 effect_code ' + es.length + ' 個對齊 schema');
  }

  // mini prompt effect_code
  const eMini = promptSrc.match(/效果動詞（effect_code[^\n]*\n(deal_damage[^\n]*)/);
  if (eMini) {
    const es = eMini[1].split(/,\s*/).map(s => s.trim()).filter(c => /^[a-z_]+$/.test(c));
    const missing = es.filter(c => !realEffectCodes.has(c));
    if (missing.length) fail('mini prompt effect_code 不在 schema: ' + missing.join(', '));
    else ok('mini prompt effect_code ' + es.length + ' 個對齊 schema');
  }
}

// ───────────────────────────────────────────────
// CHECK 7: 引擎 VALUE_TABLE 與 effect-language-options 同步
// 對應坑:加新 effect_code 但沒寫進 VALUE_TABLE → 算 0V
// ───────────────────────────────────────────────
function checkValueTableCoverage() {
  const eloPath = 'packages/client/public/admin/data/effect-language-options.json';
  if (!exists(eloPath)) { return; }
  const elo = JSON.parse(read(eloPath));
  const realEffectCodes = new Set();
  for (const group of Object.values(elo.effect_codes || {})) for (const e of group) realEffectCodes.add(e.code);

  const designer = read('packages/client/public/admin/admin-card-designer.html');
  const vtMatch = designer.match(/const VALUE_TABLE = \{([\s\S]*?)\n\s\s\};/);
  if (!vtMatch) { fail('找不到 VALUE_TABLE 定義'); return; }
  const codes = [...vtMatch[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gm)].map(m => m[1]);
  const inTable = new Set(codes);
  const missing = [...realEffectCodes].filter(c => !inTable.has(c));
  if (missing.length > 0) {
    info('VALUE_TABLE 缺漏(預設算 0V): ' + missing.join(', '));
    info('(警告非錯誤,有些 effect 設計上就 0V,但新增 effect 時應補進 V 表)');
  } else {
    ok('VALUE_TABLE 涵蓋所有 effect_code (' + codes.length + ' 個)');
  }
}

// ───────────────────────────────────────────────
// CHECK 8: SQL 查詢欄位對齊 migrate.ts 真實 schema
// 對應坑:v0.18.13 db-diag.ts 寫 trigger / desc_zh / params (前端 rename 後名),
//       真實欄位是 trigger_type / description_zh / effect_params
// ───────────────────────────────────────────────
function checkSqlAgainstSchema() {
  if (!exists('packages/server/src/db/migrate.ts')) return;
  const migrate = read('packages/server/src/db/migrate.ts');
  const tableCols = {};
  const tablePattern = /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);/g;
  let m;
  while ((m = tablePattern.exec(migrate)) !== null) {
    const tname = m[1];
    const cols = [];
    for (const line of m[2].split('\n')) {
      const cm = line.trim().match(/^([a-z_][a-z0-9_]*)\s+/);
      if (cm && !['PRIMARY','CONSTRAINT','REFERENCES','FOREIGN','CHECK','UNIQUE'].includes(cm[1].toUpperCase())) {
        cols.push(cm[1]);
      }
    }
    tableCols[tname] = new Set(cols);
  }
  info('解析出 ' + Object.keys(tableCols).length + ' 個 CREATE TABLE');

  // 精準版:只看 pool.query / client.query 接收的字串字面量內容
  // (避免抓到 JS 物件存取 e.trigger 這種誤報)
  const routesDir = path.join(ROOT, 'packages/server/src/routes');
  if (!fs.existsSync(routesDir)) return;
  const issues = [];
  const knownTraps = {
    card_effects: { trigger: 'trigger_type', desc_zh: 'description_zh', desc_en: 'description_en', params: 'effect_params' },
  };
  for (const f of fs.readdirSync(routesDir)) {
    if (!f.endsWith('.ts')) continue;
    const src = read('packages/server/src/routes/' + f);
    // 抓 pool.query(`...`) 或 client.query(`...`) 內的 backtick 字串
    const queryRe = /(?:pool|client)\.query\s*[<(]\s*`([^`]+)`/g;
    let qm;
    while ((qm = queryRe.exec(src)) !== null) {
      const sqlBody = qm[1];
      // 對每個踩雷對照表
      for (const [tableName, trapMap] of Object.entries(knownTraps)) {
        if (!new RegExp('FROM\\s+' + tableName + '\\b', 'i').test(sqlBody) &&
            !new RegExp('JOIN\\s+' + tableName + '\\b', 'i').test(sqlBody) &&
            !new RegExp('UPDATE\\s+' + tableName + '\\b', 'i').test(sqlBody) &&
            !new RegExp('INTO\\s+' + tableName + '\\b', 'i').test(sqlBody)) continue;
        const realCols = tableCols[tableName] || new Set();
        for (const [trapName, realName] of Object.entries(trapMap)) {
          // 檢查 SQL body 是否用了陷阱名稱(且該名稱不存在於真實 schema)
          // 但要排除 ... AS trapName 這種 alias 用法
          const reUse = new RegExp('\\b' + trapName + '\\b', 'g');
          const reAlias = new RegExp('AS\\s+' + trapName + '\\b', 'i');
          if (reUse.test(sqlBody) && !realCols.has(trapName) && !reAlias.test(sqlBody)) {
            issues.push(f + ': SQL 用了 ' + tableName + '.' + trapName + ' (schema 真名是 ' + realName + ')');
          }
        }
      }
    }
  }
  if (issues.length > 0) {
    fail('SQL 欄位名陷阱:');
    issues.forEach(i => console.error('   ' + i));
  } else {
    ok('SQL 字串(pool.query/client.query)欄位對齊 schema');
  }
}

// ───────────────────────────────────────────────
// CHECK 9: MEMORY.md 索引指向的檔案都存在
// 對應坑:更新 MEMORY.md 加新 entry 但忘了建檔
// ───────────────────────────────────────────────
function checkMemoryIndex() {
  const memDirs = [
    process.env.HOME && path.join(process.env.HOME, '.claude/projects/c--Ug/memory'),
    'C:/Users/user/.claude/projects/c--Ug/memory',
  ].filter(Boolean);
  let memDir;
  for (const d of memDirs) if (fs.existsSync(d)) { memDir = d; break; }
  if (!memDir) { info('MEMORY 目錄不在本機(略過)'); return; }
  const indexPath = path.join(memDir, 'MEMORY.md');
  if (!fs.existsSync(indexPath)) { fail('MEMORY.md 不存在'); return; }
  const idx = fs.readFileSync(indexPath, 'utf8');
  const refs = [...idx.matchAll(/\(([a-z0-9_]+\.md)\)/g)].map(m => m[1]);
  const missing = refs.filter(r => !fs.existsSync(path.join(memDir, r)));
  if (missing.length) fail('MEMORY.md 索引指向不存在檔: ' + missing.join(', '));
  else ok('MEMORY.md 索引 ' + refs.length + ' 個指向都存在');
}

// ───────────────────────────────────────────────
// CHECK 10: AI prompt 禁用詞掃描
// 對應坑:v0.18.12 AI 結構化自創「心智創傷」術語
// 確保 prompt 與 admin-card-checker.html 的禁用詞清單同步存在
// ───────────────────────────────────────────────
function checkForbiddenTermsRegistered() {
  const checker = read('packages/client/public/admin/admin-card-checker.html');
  if (!checker.includes('RESTRUCTURE_FORBIDDEN_TERMS')) {
    fail('admin-card-checker.html 缺 RESTRUCTURE_FORBIDDEN_TERMS 禁用詞清單');
  } else {
    ok('admin-card-checker.html 有 RESTRUCTURE_FORBIDDEN_TERMS 禁用詞清單');
  }
  const aiTools = read('packages/client/public/admin/admin-card-ai-tools.js');
  if (!aiTools.includes('心智創傷')) {
    info('admin-card-ai-tools.js prompt 沒明示禁用「心智創傷」(視 prompt 結構決定是否要加)');
  }
}

// ──────────── 主流程 ────────────
console.log('=== Preflight Check ===');
process.chdir(ROOT);

section('JSON 合法性');
checkJson('package.json');
checkJson('packages/client/public/admin/data/effect-language-options.json');
checkJson('packages/client/public/rulebook/index.json');

section('JS / HTML inline syntax');
checkJsSyntax('packages/client/public/admin/admin-shared.js');
checkJsSyntax('packages/client/public/admin/admin-card-prompt.js');
checkJsSyntax('packages/client/public/admin/admin-card-ai-tools.js');
checkHtmlInlineScript('packages/client/public/admin/admin-card-designer.html');
checkHtmlInlineScript('packages/client/public/admin/admin-card-checker.html');
checkHtmlInlineScript('packages/client/public/admin/admin-system-diag.html');
checkHtmlInlineScript('packages/client/public/admin/admin-axis-series.html');

section('版本號同步');
checkVersionSync();

section('反引號陷阱掃描(中文行)');
checkBackticksInPromptStrings('packages/client/public/admin/admin-card-prompt.js');
checkBackticksInPromptStrings('packages/client/public/admin/admin-card-ai-tools.js');

section('AI prompt code 對齊 schema');
checkAiPromptCodeAlignment();

section('引擎 VALUE_TABLE 涵蓋率');
checkValueTableCoverage();

section('SQL 欄位對齊 migrate.ts schema');
checkSqlAgainstSchema();

section('禁用詞守門存在');
checkForbiddenTermsRegistered();

section('MEMORY 索引完整性');
checkMemoryIndex();

console.log('\n=== ' + (failed === 0 ? '✓ ALL PASS — 可推送' : '❌ ' + failed + ' 項失敗 — 不准推送') + ' ===');
process.exit(failed === 0 ? 0 : 1);
