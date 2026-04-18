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
// Phase 1 替代路徑：前端直連遠端 Gemini API（不經 bridge，與 MOD-01 同模式）
// 僅支援 MOD-01 card_design；MOD-02/03 需透過 bridge（本地 Gemma 路徑）
// ────────────────────────────────────────────
// 遠端 Gemini 直連支援的 MOD 清單（每擴充一個 MOD 這裡加一行）
const DIRECT_GEMINI_SUPPORTED_MODULES = new Set(['MOD-01', 'MOD-04']);

async function planWithDirectGemini({ moduleConfig, userPrompt, attachedText, historyBlock, batchCount = 1, geminiModel = 'gemini-2.5-pro' }) {
  if (!DIRECT_GEMINI_SUPPORTED_MODULES.has(moduleConfig.code)) {
    throw new Error(
      `遠端 Gemini API 直連目前僅支援：${[...DIRECT_GEMINI_SUPPORTED_MODULES].join(', ')}。${moduleConfig.code} 尚未掛上。`,
    );
  }
  if (!window.hasGeminiApiKey || !window.hasGeminiApiKey()) {
    const k = window.promptForGeminiApiKey && window.promptForGeminiApiKey('需先設定 Gemini API Key 才能使用遠端直連：');
    if (!k) throw new Error('未設定 Gemini API Key，取消');
  }

  const taskType = deriveTaskType(moduleConfig, userPrompt);
  const composedInput = [
    historyBlock && historyBlock.trim(),
    '[使用者指令]',
    userPrompt,
    attachedText && `[附加文字]\n${attachedText}`,
  ].filter(Boolean).join('\n\n');

  const t0 = Date.now();
  let items, modelUsed;
  if (moduleConfig.code === 'MOD-01') {
    ({ items, modelUsed } = await window.generateCardViaDirectGemini(composedInput, { model: geminiModel, batchCount }));
  } else if (moduleConfig.code === 'MOD-04') {
    // MOD-04 目前設計為單筆（團隊精神含 5 深度已是完整實體），暫不支援批次
    if (batchCount > 1) console.warn('MOD-04 暫不支援批次，忽略 batchCount', batchCount);
    ({ items, modelUsed } = await window.generateSpiritViaDirectGemini(composedInput, { model: geminiModel }));
  } else {
    throw new Error(`internal: unhandled module ${moduleConfig.code} in planWithDirectGemini`);
  }
  const elapsedMs = Date.now() - t0;

  // 組出跟 bridgeResult 形狀相容的結構，plan UI 可以沿用
  const bridgeResult = {
    taskId: `direct-${Date.now()}`,
    status: items.length > 0 ? 'success' : 'failed',
    modelUsed,
    itemsGenerated: items.length,
    itemsWritten: 0,
    errors: [],
    items,
    logs: [`direct-gemini path (no bridge), model=${modelUsed}, batch=${batchCount}, ${elapsedMs}ms`],
    startedAt: new Date(t0).toISOString(),
    completedAt: new Date().toISOString(),
  };

  return { taskType, bridgeResult, items };
}

window.planWithDirectGemini = planWithDirectGemini;

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
      // 抽離 __postSaveActions（主 POST 成功後才跑），避免被 sanitize 當成 body 欄位
      const postSaveActions = Array.isArray(mapped.__postSaveActions) ? mapped.__postSaveActions : [];
      if (mapped.__postSaveActions) delete mapped.__postSaveActions;

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
        const dbErr = parsed && parsed.dbError;
        const dbErrSummary = dbErr
          ? ` | DB ${dbErr.code || ''}: ${dbErr.message || ''}${dbErr.detail ? ' (' + dbErr.detail + ')' : ''}${dbErr.column ? ' [col=' + dbErr.column + ']' : ''}`
          : '';
        artifacts.push({
          type: 'error',
          subtask_index: i,
          name: items[i]?.name_zh || items[i]?.code || `#${i}`,
          status: res.status,
          error: ((parsed && parsed.error) || resText.slice(0, 300)) + dbErrSummary,
          sentBody: cleaned, // 留原始送出內容供除錯
        });
      } else {
        const data = (parsed && parsed.data) || {};
        const mainId = data.id || null;
        const artifact = {
          type: moduleConfig.code,
          subtask_index: i,
          id: mainId,
          name: data.name_zh || data.code || items[i]?.name_zh || `#${i}`,
          code: data.code || null,
        };

        // 執行 post-save actions（如 MOD-04 精神的 depths PUT）
        if (postSaveActions.length > 0 && mainId) {
          const subResults = [];
          for (const action of postSaveActions) {
            const subPath = String(action.pathTemplate || '').replace('{id}', mainId);
            try {
              const subRes = await adminFetch(subPath, {
                method: action.method || 'POST',
                body: JSON.stringify(action.body || {}),
              });
              const subText = await subRes.text();
              let subParsed = null;
              try { subParsed = JSON.parse(subText); } catch { /* keep null */ }
              subResults.push({
                label: action.label || subPath,
                ok: subRes.ok && (!subParsed || subParsed.success !== false),
                status: subRes.status,
                error: subRes.ok ? null : ((subParsed && subParsed.error) || subText.slice(0, 200)),
              });
            } catch (subErr) {
              subResults.push({
                label: action.label || subPath,
                ok: false,
                error: subErr.message || String(subErr),
              });
            }
          }
          artifact.postSaveResults = subResults;
          const anyFailed = subResults.some((r) => !r.ok);
          if (anyFailed) {
            artifact.partial = true;
            artifact.warning = '主實體已建立，但部分延伸資料寫入失敗：'
              + subResults.filter((r) => !r.ok).map((r) => `${r.label} - ${r.error}`).join('; ');
          }
        } else if (postSaveActions.length > 0 && !mainId) {
          artifact.partial = true;
          artifact.warning = '主 POST 成功但未回傳 id，post-save actions 已跳過';
        }

        artifacts.push(artifact);
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
