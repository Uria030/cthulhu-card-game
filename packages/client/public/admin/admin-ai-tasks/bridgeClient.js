/* ========================================
   MOD-12 — gemma-bridge HTTP client
   ======================================== */

const BRIDGE_URL = 'http://127.0.0.1:8787';

async function bridgeHealth(timeoutMs = 3000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, upstreams: data.upstreams, config: data.config, raw: data };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}

async function bridgeRunTask({ taskType, input, writeToDb = false, batchCount, contextTags }) {
  const body = { taskType, input, writeToDb };
  if (batchCount != null) body.batchCount = batchCount;
  if (contextTags && contextTags.length) body.contextTags = contextTags;

  const res = await fetch(`${BRIDGE_URL}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`bridge /task failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return res.json();
}

window.bridgeHealth = bridgeHealth;
window.bridgeRunTask = bridgeRunTask;
