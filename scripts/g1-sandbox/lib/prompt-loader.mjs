// vm sandbox 載入 admin-card-prompt.js（規範主檔，三路徑單一來源）
// 不能用 require：packages/client 是 "type": "module"，Node 會以 ESM 載入導致 module.exports 失效
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = path.resolve(__dirname, '../../../packages/client/public/admin/admin-card-prompt.js');

let cached = null;

export function loadCardPromptFns() {
  if (cached) return cached;
  if (!fs.existsSync(PROMPT_FILE)) {
    throw new Error(`admin-card-prompt.js not found: ${PROMPT_FILE}`);
  }
  const code = fs.readFileSync(PROMPT_FILE, 'utf8');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'admin-card-prompt.js' });
  if (typeof ctx.window.buildCardGeminiPrompt !== 'function') {
    throw new Error('buildCardGeminiPrompt 未在 sandbox 內被定義 — admin-card-prompt.js 結構異常');
  }
  cached = {
    buildCardGeminiPrompt: ctx.window.buildCardGeminiPrompt,
    buildMiniCardGeminiPrompt: ctx.window.buildMiniCardGeminiPrompt,
    sourceFile: PROMPT_FILE,
  };
  return cached;
}
