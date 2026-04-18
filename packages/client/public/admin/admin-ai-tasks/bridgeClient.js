/* ========================================
   MOD-12 — bridge client (via admin server proxy)
   改造：不再直打 bridge:8787，改走 admin server `/api/ai-console/bridge/*`
   - 受 JWT 認證保護（admin server 已有 requireAdmin）
   - 支援遠端存取（iPad/手機/Railway 部署後只要 admin server 可達即可）
   - Gemma/Gemini 切換在 admin server 的 BRIDGE_URL env 一處決定
   ======================================== */

async function bridgeHealth(timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await adminFetch('/api/ai-console/bridge/health', { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      return { ok: false, reason: data.error || `HTTP ${res.status}`, bridgeUrl: data.bridgeUrl };
    }
    const inner = data.data || {};
    return {
      ok: true,
      upstreams: inner.upstreams,
      config: inner.config,
      bridgeUrl: data.bridgeUrl,
      raw: inner,
    };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}

async function bridgeRunTask({ taskType, input, writeToDb = false, batchCount, contextTags }) {
  const body = { taskType, input, writeToDb };
  if (batchCount != null) body.batchCount = batchCount;
  if (contextTags && contextTags.length) body.contextTags = contextTags;

  const res = await adminFetch('/api/ai-console/bridge/run-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`bridge run-task failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return res.json();
}

window.bridgeHealth = bridgeHealth;
window.bridgeRunTask = bridgeRunTask;
