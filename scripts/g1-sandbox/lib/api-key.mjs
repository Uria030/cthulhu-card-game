// Gemini API Key 載入器
// 規範依據:
//   - c:\Ug\docs\Claude Code 本地 API Key 安全規範 v0.1_26042605.md(三紅線:不進 git/不進前端 bundle/不進產出檔)
//   - feedback_no_bat_files.md 天條(連續第 2 次):不寫 .bat/.ps1,改用「Uria 記事本建 .txt 自動讀」最簡解
// 取用順序:
//   1. 環境變數 GEMINI_API_KEY_PERSONAL
//   2. scripts/g1-sandbox/GeminiKey.txt(Uria 用記事本建,腳本自動讀)
//   3. cthulhu-card-game/.gemini-key(舊路徑,向後相容)
// 除錯只印 boolean,絕不印 key 任何片段
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIMARY_KEY_FILE = path.resolve(__dirname, '../GeminiKey.txt');     // 首選:Uria 記事本建檔
const LEGACY_KEY_FILE = path.resolve(__dirname, '../../../.gemini-key');  // 向後相容

export function loadGeminiKey() {
  // 1. 環境變數優先
  const envKey = process.env.GEMINI_API_KEY_PERSONAL;
  if (envKey && envKey.trim()) {
    return { key: envKey.trim(), source: 'env' };
  }
  // 2. GeminiKey.txt(Uria 記事本建檔)
  if (fs.existsSync(PRIMARY_KEY_FILE)) {
    const content = fs.readFileSync(PRIMARY_KEY_FILE, 'utf8').trim();
    if (content) return { key: content, source: 'GeminiKey.txt' };
  }
  // 3. .gemini-key(向後相容)
  if (fs.existsSync(LEGACY_KEY_FILE)) {
    const content = fs.readFileSync(LEGACY_KEY_FILE, 'utf8').trim();
    if (content) return { key: content, source: '.gemini-key (legacy)' };
  }
  return null;
}

export function requireGeminiKey() {
  const r = loadGeminiKey();
  if (!r) {
    throw new Error([
      'Gemini API Key 未設定。請:',
      '  在 scripts/g1-sandbox/ 底下新增 GeminiKey.txt(右鍵→新增→文字文件)',
      '  把 Gemini key 貼進去存檔,腳本會自動讀取。',
      '安全規範:GeminiKey.txt 已 .gitignore,不會進 git。',
    ].join('\n'));
  }
  return r.key;
}

export function hasGeminiKey() {
  return loadGeminiKey() !== null;
}
