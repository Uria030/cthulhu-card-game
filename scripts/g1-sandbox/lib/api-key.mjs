// Gemini API Key 載入器
// 規範依據:c:\Ug\docs\Claude Code 本地 API Key 安全規範 v0.1_26042605.md
// 取用順序:
//   1. 環境變數 GEMINI_API_KEY_PERSONAL
//   2. cthulhu-card-game/.gemini-key 檔(已 .gitignore,雙擊 setup-gemini-key.bat 寫入)
// 除錯只印 boolean,絕不印 key 任何片段
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.resolve(__dirname, '../../../.gemini-key');

export function loadGeminiKey() {
  // 1. 環境變數優先
  const envKey = process.env.GEMINI_API_KEY_PERSONAL;
  if (envKey && envKey.trim()) {
    return { key: envKey.trim(), source: 'env' };
  }
  // 2. .gemini-key 檔
  if (fs.existsSync(KEY_FILE)) {
    const content = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (content) return { key: content, source: 'file' };
  }
  return null;
}

export function requireGeminiKey() {
  const r = loadGeminiKey();
  if (!r) {
    throw new Error([
      'Gemini API Key 未設定。請以下擇一:',
      '  A) 雙擊 scripts/g1-sandbox/setup-gemini-key.bat 輸入 key,寫入 .gemini-key',
      '  B) 設定環境變數 GEMINI_API_KEY_PERSONAL',
      '安全規範:不進 git(.gemini-key 已 .gitignore)、不進前端 bundle、不進產出檔',
    ].join('\n'));
  }
  return r.key;
}

export function hasGeminiKey() {
  return loadGeminiKey() !== null;
}
