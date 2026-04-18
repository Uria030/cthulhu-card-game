/* ========================================
   MOD-12 — Task Executor
   Two-phase flow: plan (bridge, writeToDb:false) → confirm → per-item POST.
   MOD-12 does NOT let bridge write to DB; we map+sanitize each item ourselves.
   ======================================== */

const cancelledTaskIds = new Set();

// ────────────────────────────────────────────
// Phase 1: Planning — call bridge, return items[]
// ────────────────────────────────────────────
async function planWithBridge({ moduleConfig, userPrompt, attachedText, contextTags, historyBlock, aiProvider }) {
  const taskType = deriveTaskType(moduleConfig, userPrompt);

  const composedInput = [
    historyBlock && historyBlock.trim(),
    '[使用者指令]',
    userPrompt,
    attachedText && `[附加文字]\n${attachedText}`,
  ].filter(Boolean).join('\n\n');

  const result = await bridgeRunTask({
    taskType,
    input: composedInput,
    writeToDb: false,
    contextTags: contextTags || [],
    aiProvider,
  });

  return {
    taskType,
    bridgeResult: result,
    items: Array.isArray(result.items) ? result.items : [],
  };
}

function deriveTaskType(moduleConfig, userPrompt) {
  // MOD-01 can produce either card_design or combo_design based on user intent.
  if (moduleConfig.code === 'MOD-01') {
    if (/combo|組合|連攜/i.test(userPrompt)) return 'combo_design';
    return 'card_design';
  }
  return moduleConfig.bridgeTaskType;
}

// ────────────────────────────────────────────
// Phase 2: Confirmation → per-item POST via admin API
// ────────────────────────────────────────────
async function executeConfirmedPlan({ taskRecordId, moduleConfig, items, onProgress }) {
  const context = await buildMapperContext(moduleConfig.code);
  const artifacts = [];
  const total = items.length;

  for (let i = 0; i < total; i++) {
    if (cancelledTaskIds.has(taskRecordId)) {
      await updateTaskStatus(taskRecordId, {
        status: 'cancelled',
        artifacts_created: artifacts,
      });
      return { status: 'cancelled', artifacts };
    }

    onProgress && onProgress(i, total, items[i]);

    try {
      const mapped = mapItem(moduleConfig.code, items[i], context);
      const cleaned = sanitizeSubtask(moduleConfig.code, mapped);
      const path = resolveApiPath(moduleConfig, mapped);

      const res = await adminFetch(path, {
        method: 'POST',
        body: JSON.stringify(cleaned),
      });
      const resText = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(resText); } catch { /* keep null */ }

      if (!res.ok) {
        artifacts.push({
          type: 'error',
          subtask_index: i,
          name: items[i]?.name_zh || items[i]?.code || `#${i}`,
          status: res.status,
          error: (parsed && parsed.error) || resText.slice(0, 300),
        });
      } else {
        const data = (parsed && parsed.data) || {};
        artifacts.push({
          type: moduleConfig.code,
          subtask_index: i,
          id: data.id || null,
          name: data.name_zh || data.code || items[i]?.name_zh || `#${i}`,
          code: data.code || null,
        });
      }
    } catch (mapErr) {
      artifacts.push({
        type: 'error',
        subtask_index: i,
        name: items[i]?.name_zh || `#${i}`,
        error: `mapping/sanitize failed: ${mapErr.message}`,
      });
    }
  }

  const hasErrors = artifacts.some((a) => a.type === 'error');
  await updateTaskStatus(taskRecordId, {
    status: hasErrors ? 'failed' : 'completed',
    artifacts_created: artifacts,
    error_message: hasErrors ? '部分子任務失敗，請展開檢視' : null,
  });
  return { status: hasErrors ? 'failed' : 'completed', artifacts };
}

// ────────────────────────────────────────────
// History context (for AI: last 24h same module to avoid duplicates)
// ────────────────────────────────────────────
async function fetchRecentHistoryBlock(moduleCode) {
  try {
    const res = await adminFetch(
      `/api/ai-console/tasks?module=${encodeURIComponent(moduleCode)}&status=completed&since=24h&limit=30`,
    );
    if (!res.ok) return '';
    const json = await res.json();
    const tasks = json.data || [];
    const flat = [];
    for (const t of tasks) {
      const arts = Array.isArray(t.artifacts_created) ? t.artifacts_created : [];
      for (const a of arts) {
        if (a.type === 'error' || !a.name) continue;
        flat.push(a.code ? `${a.name}（${a.code}）` : a.name);
        if (flat.length >= 30) break;
      }
      if (flat.length >= 30) break;
    }
    if (flat.length === 0) return '';
    return [
      '[近 24 小時已建立的項目，請避開重複]',
      flat.map((n, i) => `${i + 1}. ${n}`).join('\n'),
    ].join('\n');
  } catch {
    return '';
  }
}

// ────────────────────────────────────────────
// Task record CRUD (admin API)
// ────────────────────────────────────────────
async function createTaskRecord({ moduleCode, userPrompt, attachedText, contextTags, aiModel, aiResponse }) {
  const res = await adminFetch('/api/ai-console/tasks', {
    method: 'POST',
    body: JSON.stringify({
      module_code: moduleCode,
      user_prompt: userPrompt,
      attached_text: attachedText || null,
      context_tags: contextTags || [],
      ai_model: aiModel,
      ai_response: aiResponse,
    }),
  });
  if (!res.ok) throw new Error(`Failed to create task record (${res.status})`);
  const json = await res.json();
  return json.data;
}

async function updateTaskStatus(taskId, patch) {
  const res = await adminFetch(`/api/ai-console/tasks/${taskId}/status`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    console.error('updateTaskStatus failed', res.status, await res.text());
  }
}

async function fetchTaskList(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  const res = await adminFetch(`/api/ai-console/tasks?${qs.toString()}`);
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

async function cancelTaskOnServer(taskId) {
  cancelledTaskIds.add(taskId);
  await adminFetch(`/api/ai-console/tasks/${taskId}/cancel`, { method: 'POST' });
}

window.planWithBridge = planWithBridge;
window.executeConfirmedPlan = executeConfirmedPlan;
window.fetchRecentHistoryBlock = fetchRecentHistoryBlock;
window.createTaskRecord = createTaskRecord;
window.updateTaskStatus = updateTaskStatus;
window.fetchTaskList = fetchTaskList;
window.cancelTaskOnServer = cancelTaskOnServer;
window.cancelledTaskIds = cancelledTaskIds;
