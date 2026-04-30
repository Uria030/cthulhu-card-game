// G1 既有零件批次驗閘 — 對上次入庫的 60+ 件零件全部跑 s06 驗閘
// 產出違規報告(只讀,不寫 DB)讓 Uria 看上次傷得多重
import { adminGet } from './api.mjs';
import {
  validateCard,
  normalizeCardText, autoFixSanHp, scanForbiddenTerms,
} from './lib/card-validator.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `g1-validate-existing-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# G1 既有零件批次驗閘 ${stamp}`);
log(`目的:把 production 上 G1_ 開頭(或 series=G)的零件全跑 s06 驗閘,產出違規報告\n`);

// ─── 抓 production 上的 G1_ 卡 ─────────────────────────────────
log('── 抓既有零件 ──');

const cardsResp = await adminGet('/api/cards?series=G');
const cards = Array.isArray(cardsResp) ? cardsResp : (cardsResp.data || cardsResp.cards || []);
log(`series=G 普通卡:${cards.length} 張`);

const mythResp = await adminGet('/api/admin/keeper/mythos-cards');
const myth = (mythResp.mythos_cards || mythResp.data || []).filter((c) => (c.code || '').startsWith('G1_'));
log(`G1 神話卡:${myth.length} 張`);

const encResp = await adminGet('/api/admin/keeper/encounter-cards');
const enc = (encResp.encounter_cards || encResp.data || []).filter((c) => (c.code || '').startsWith('G1_'));
log(`G1 遭遇卡:${enc.length} 張`);

// 戰鬥風格卡(從 combat-styles list 抓)
const csList = await adminGet('/api/combat-styles');
const csArr = csList.data || csList;
const styleCards = [];
for (const cs of csArr) {
  try {
    const detail = await adminGet(`/api/combat-styles/${cs.id}/cards`);
    const arr = detail.data || [];
    // G1 風格卡:只看 shooting / brawl 池內容(G1 用)
    if (cs.code === 'shooting' || cs.code === 'brawl') {
      for (const c of arr) styleCards.push({ ...c, _styleCode: cs.code });
    }
  } catch (e) {}
}
log(`G1 風格卡(shooting + brawl):${styleCards.length} 張`);

const totalCount = cards.length + myth.length + enc.length + styleCards.length;
log(`\n合計檢查 ${totalCount} 件零件\n`);

// ─── 結果統計 ──────────────────────────────────────────────────
const stats = {
  cards: { total: cards.length, passed: 0, errors: 0, warnings: 0 },
  myth: { total: myth.length, passed: 0, errors: 0, warnings: 0 },
  enc: { total: enc.length, passed: 0, errors: 0, warnings: 0 },
  style: { total: styleCards.length, passed: 0, errors: 0, warnings: 0 },
};

const violationDetail = [];

// ─── 普通卡(用完整 validateCard)──
log('\n══════ 普通卡(G1 series) ══════');
for (const c of cards) {
  // 把 admin api 回傳的 effect 結構對齊 validator 期待的 desc_zh / trigger 命名
  const effs = (c.effects || c.card_effects || []).map((e) => ({
    trigger: e.trigger_type || e.trigger,
    effect_code: e.effect_code,
    desc_zh: e.description_zh || e.desc_zh,
    desc_en: e.description_en || e.desc_en,
    duration: e.duration,
    params: e.effect_params || e.params,
    condition: e.condition,
  }));
  const cardForValidate = { ...c, effects: effs };
  const r = validateCard(cardForValidate);
  if (r.passed) {
    stats.cards.passed++;
  } else {
    stats.cards.errors += r.errors.length;
    stats.cards.warnings += r.warnings.length;
    violationDetail.push({ kind: '普通卡', code: c.code, name: c.name_zh, errors: r.errors, warnings: r.warnings });
    log(`\n  ✗ [${c.code}] ${c.name_zh}`);
    for (const e of r.errors) log(`    ❌ [${e.type}] ${e.field}: ${e.message}`);
    for (const w of r.warnings) log(`    ⚠  [${w.type}] ${w.field || ''}: ${w.message || ''}`);
  }
}

// ─── 神話卡(只跑文字級規範化檢查)──
log('\n══════ 神話卡 ══════');
for (const m of myth) {
  const fields = ['description_zh','flavor_text_zh'];
  const localWarnings = [];
  for (const f of fields) {
    const text = m[f];
    if (typeof text !== 'string') continue;
    const fixed = autoFixSanHp(normalizeCardText(text));
    if (fixed !== text) localWarnings.push({ field: f, type: 'normalize_diff', before: text.slice(0, 80), after: fixed.slice(0, 80) });
    const fterms = scanForbiddenTerms(text);
    for (const w of fterms) localWarnings.push({ field: f, type: 'forbidden_term', term: w.term, suggestion: w.suggestion });
  }
  if (localWarnings.length === 0) {
    stats.myth.passed++;
  } else {
    stats.myth.warnings += localWarnings.length;
    violationDetail.push({ kind: '神話卡', code: m.code, name: m.name_zh, warnings: localWarnings, errors: [] });
    log(`\n  ⚠ [${m.code}] ${m.name_zh}`);
    for (const w of localWarnings) {
      if (w.type === 'normalize_diff') log(`    [diff] ${w.field}: ${w.before} → ${w.after}`);
      else log(`    [warn] ${w.field}「${w.term}」→ ${w.suggestion}`);
    }
  }
}

// ─── 遭遇卡 ──
log('\n══════ 遭遇卡 ══════');
for (const e of enc) {
  const fields = ['scenario_text_zh','design_notes'];
  const localWarnings = [];
  for (const f of fields) {
    const text = e[f];
    if (typeof text !== 'string') continue;
    const fixed = autoFixSanHp(normalizeCardText(text));
    if (fixed !== text) localWarnings.push({ field: f, type: 'normalize_diff', before: text.slice(0, 80), after: fixed.slice(0, 80) });
    const fterms = scanForbiddenTerms(text);
    for (const w of fterms) localWarnings.push({ field: f, type: 'forbidden_term', term: w.term, suggestion: w.suggestion });
  }
  if (localWarnings.length === 0) {
    stats.enc.passed++;
  } else {
    stats.enc.warnings += localWarnings.length;
    violationDetail.push({ kind: '遭遇卡', code: e.code, name: e.name_zh, warnings: localWarnings, errors: [] });
    log(`\n  ⚠ [${e.code}] ${e.name_zh}`);
    for (const w of localWarnings) {
      if (w.type === 'normalize_diff') log(`    [diff] ${w.field}: ${w.before} → ${w.after}`);
      else log(`    [warn] ${w.field}「${w.term}」→ ${w.suggestion}`);
    }
  }
}

// ─── 戰鬥風格卡 ──
log('\n══════ 戰鬥風格卡(G1 shooting + brawl) ══════');
for (const c of styleCards) {
  const fields = ['narrative_attack_zh','narrative_success_zh','narrative_fail_zh'];
  const localWarnings = [];
  for (const f of fields) {
    const text = c[f];
    if (typeof text !== 'string') continue;
    const fixed = autoFixSanHp(normalizeCardText(text));
    if (fixed !== text) localWarnings.push({ field: f, type: 'normalize_diff', before: text.slice(0, 80), after: fixed.slice(0, 80) });
    const fterms = scanForbiddenTerms(text);
    for (const w of fterms) localWarnings.push({ field: f, type: 'forbidden_term', term: w.term, suggestion: w.suggestion });
  }
  if (localWarnings.length === 0) {
    stats.style.passed++;
  } else {
    stats.style.warnings += localWarnings.length;
    violationDetail.push({ kind: '風格卡', code: c.code, name: c.name_zh, warnings: localWarnings, errors: [] });
    log(`\n  ⚠ [${c.code}] ${c.name_zh}(${c._styleCode})`);
    for (const w of localWarnings) {
      if (w.type === 'normalize_diff') log(`    [diff] ${w.field}: ${w.before} → ${w.after}`);
      else log(`    [warn] ${w.field}「${w.term}」→ ${w.suggestion}`);
    }
  }
}

// ─── 總結 ─────────────────────────────────────────────────────
log('\n\n══════════════════ 總結 ══════════════════');
log(`普通卡 : ${stats.cards.passed}/${stats.cards.total} pass | errors=${stats.cards.errors} | warnings=${stats.cards.warnings}`);
log(`神話卡 : ${stats.myth.passed}/${stats.myth.total} pass | warnings=${stats.myth.warnings}`);
log(`遭遇卡 : ${stats.enc.passed}/${stats.enc.total} pass | warnings=${stats.enc.warnings}`);
log(`風格卡 : ${stats.style.passed}/${stats.style.total} pass | warnings=${stats.style.warnings}`);
log(`────────────────────`);
const overallPass = stats.cards.passed + stats.myth.passed + stats.enc.passed + stats.style.passed;
const overallTotal = stats.cards.total + stats.myth.total + stats.enc.total + stats.style.total;
log(`合計 : ${overallPass}/${overallTotal} pass(${(100 * overallPass / Math.max(1, overallTotal)).toFixed(1)}%)`);

const reportPath = path.join(LOG_DIR, `g1-validate-existing-${stamp}.json`);
fs.writeFileSync(reportPath, JSON.stringify({ stamp, stats, violations: violationDetail }, null, 2));
log(`\n詳細違規 JSON: ${reportPath}`);
fs.writeFileSync(logPath, lines.join('\n'));
log(`log: ${logPath}`);
