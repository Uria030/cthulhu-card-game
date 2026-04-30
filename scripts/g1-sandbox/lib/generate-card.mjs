// 高階 generate-card helper
// 給 05/07/08 等腳本共用:綱要 → buildCardGeminiPrompt → Gemini → 解析 → 驗閘 → 自動修正 → 回傳
import { loadCardPromptFns } from './prompt-loader.mjs';
import { callGemini, parseGeminiCardJson } from './gemini-client.mjs';
import { fetchExistingCardsContext } from './existing-cards.mjs';
import { validateCard, autoNormalizeCard } from './card-validator.mjs';
import { requireGeminiKey } from './api-key.mjs';

/**
 * 從綱要生成一張卡(經過完整 s06 規範流程)
 * @param {Object} brief - 卡片綱要
 * @param {string} brief.userDescription - 給 Gemini 的設計敘述(必填)
 * @param {Object} [brief.existingFilter] - 既有卡 context 篩選 { faction, primary_axis_value, is_talisman, series }
 * @param {string} [brief.model='gemini-2.5-pro']
 * @param {number} [brief.maxRetry=2] - 驗閘失敗時 retry Gemini 的次數
 * @returns {Promise<{card, validation, attempts, modelUsed}>}
 */
export async function generateValidatedCard(brief) {
  const apiKey = requireGeminiKey();
  const { buildCardGeminiPrompt } = loadCardPromptFns();
  const model = brief.model || 'gemini-2.5-pro';
  const maxRetry = brief.maxRetry ?? 2;

  // 抓既有卡 context(MOD-01/MOD-12 同邏輯)
  const existingCardsContext = brief.existingFilter
    ? await fetchExistingCardsContext(brief.existingFilter)
    : '';

  let lastErr = null;
  let lastValidation = null;
  let lastCard = null;

  for (let attempt = 1; attempt <= maxRetry + 1; attempt++) {
    // 第二次以後加入「上次違規清單」給 Gemini 自我修正
    let userDesc = brief.userDescription;
    if (attempt > 1 && lastValidation) {
      const issues = [
        ...lastValidation.errors.map(e => '  ❌ ' + (e.field || '?') + ': ' + e.message),
        ...lastValidation.warnings.map(w => '  ⚠ ' + (w.field || '?') + ': ' + w.message),
      ].join('\n');
      userDesc += `\n\n## 上次嘗試的違規清單(第 ${attempt - 1} 次失敗,請修正後重新產出):\n${issues}`;
    }

    const prompt = buildCardGeminiPrompt(userDesc, { existingCardsContext });

    let card;
    try {
      const { text } = await callGemini({ prompt, apiKey, model });
      card = parseGeminiCardJson(text);
    } catch (e) {
      lastErr = e;
      continue;
    }

    // 自動修正低風險文字
    autoNormalizeCard(card);

    // 跑驗閘
    const validation = validateCard(card);
    lastCard = card;
    lastValidation = validation;

    if (validation.passed) {
      return { card, validation, attempts: attempt, modelUsed: model };
    }
  }

  // 全部 retry 都沒過,回傳最後一次結果讓 caller 決定要不要 POST
  return {
    card: lastCard,
    validation: lastValidation,
    attempts: maxRetry + 1,
    modelUsed: model,
    error: lastErr ? lastErr.message : null,
  };
}

/**
 * 把驗閘結果格式化成可讀字串(給 log 用)
 */
export function formatValidationReport(validation) {
  if (!validation) return '(no validation)';
  const lines = [];
  lines.push(`passed=${validation.passed} | errors=${validation.errors.length} | warnings=${validation.warnings.length}`);
  for (const e of validation.errors) {
    lines.push(`  ❌ [${e.type}] ${e.field || ''}: ${e.message || JSON.stringify(e)}`);
  }
  for (const w of validation.warnings) {
    lines.push(`  ⚠  [${w.type}] ${w.field || ''}: ${w.message || JSON.stringify(w)}`);
  }
  return lines.join('\n');
}
