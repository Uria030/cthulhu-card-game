// Node 端 Gemini API client(對應 admin-ai-tasks/geminiDirectClient.js 的 callGeminiDirect)
// 規範依據:c:\Ug\docs\Claude Code 本地 API Key 安全規範 v0.1_26042605.md
// 三紅線:不進 git / 不進前端 bundle / 不進產出檔。除錯只印 boolean。

const DEFAULT_MODEL = 'gemini-2.5-pro';

export async function callGemini({
  prompt,
  apiKey,
  model = DEFAULT_MODEL,
  temperature = 0.7,
  responseMimeType = 'application/json',
}) {
  if (!apiKey) throw new Error('Gemini API Key 未提供(GEMINI_API_KEY_PERSONAL 環境變數或 .gemini-key 檔)');
  if (!prompt || typeof prompt !== 'string') throw new Error('prompt 為空');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType, temperature },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOut) {
    throw new Error('Gemini 回應為空(可能被 safety filter 擋,raw=' + JSON.stringify(data).slice(0, 300) + ')');
  }
  return { text: textOut, raw: data, modelName: model };
}

// 解析 Gemini 回傳 JSON(去除可能的 markdown fence)
export function parseGeminiCardJson(text) {
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error('Gemini 回傳不是合法 JSON: ' + e.message + '\n--- 內容前 500 字 ---\n' + cleaned.slice(0, 500));
  }
}
