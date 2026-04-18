/* ========================================
   MOD-12 AI 主控台 — 主邏輯
   ======================================== */

// MOD_BUTTONS：第一期三模組可用，其餘封印
const MOD_BUTTONS = [
  {
    code: 'MOD-01', name_zh: '卡片設計器',
    bridgeTaskType: 'card_design',
    api: '/api/cards',
    available: true,
  },
  {
    code: 'MOD-02', name_zh: '天賦樹設計器',
    bridgeTaskType: 'talent_tree',
    api: '/api/talent-trees/:factionCode/nodes',
    apiPathResolver: (item) =>
      `/api/talent-trees/${encodeURIComponent(item.faction_code || '')}/nodes`,
    available: true,
  },
  {
    code: 'MOD-03', name_zh: '敵人設計器',
    bridgeTaskType: 'enemy_design',
    api: '/api/admin/monsters/variants',
    available: true,
  },
  { code: 'MOD-04', name_zh: '團隊精神',    bridgeTaskType: 'spirit_design', api: '/api/team-spirits',           available: true },
  { code: 'MOD-05', name_zh: '戰鬥風格',    api: '/api/combat-styles',          available: false, reason: '待擴充 bridge 支援（第二期）' },
  { code: 'MOD-06', name_zh: '戰役敘事',    api: null,                          available: false, reason: '模組尚未建置' },
  { code: 'MOD-07', name_zh: '關卡編輯器',  api: null,                          available: false, reason: '模組尚未建置' },
  { code: 'MOD-08', name_zh: '地點設計器',  api: '/api/admin/locations',        available: false, reason: '待擴充 bridge 支援（第二期）' },
  { code: 'MOD-09', name_zh: '鍛造製作',    api: '/api/affixes',                available: false, reason: '待擴充 bridge 支援（第二期）' },
  { code: 'MOD-10', name_zh: '城主設計器',  api: '/api/admin/keeper/mythos-cards', available: false, reason: '待擴充 bridge 支援（第二期）' },
  { code: 'MOD-11', name_zh: '調查員設計器', api: '/api/admin/investigators',   available: false, reason: '待擴充 bridge 支援（第二期）' },
];

const TASK_FILTERS = [
  { key: 'recent',    label: '近 24h' },
  { key: 'all',       label: '全部' },
  { key: 'running',   label: '執行中' },
  { key: 'completed', label: '已完成' },
  { key: 'failed',    label: '失敗' },
];

const state = {
  selectedModule: null,
  bridgeStatus: null,
  currentAiModel: null,        // 'gemma-4-e2b' | 'gemini-2.5-pro' | 'gemini-2.5-flash' | 'gemini-3.0-pro'
  taskFilter: 'recent',
  pendingPlan: null,           // { taskType, items, bridgeResult }
  // 使用者指定的 AI 提供者（送給 bridge 的 aiProvider 欄位）
  //   'gemini' = 強制走遠端 Gemini API（跳過 Ollama 階段）【預設】
  //   'gemma'  = 強制走本地 Gemma (Ollama)，失敗不 fallback
  userProviderChoice: 'gemini',
};

// ────────────────────────────────────────────
// Bootstrap — admin role guard
// ────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const userRaw = localStorage.getItem('admin_user');
  let user = null;
  try { user = userRaw ? JSON.parse(userRaw) : null; } catch { user = null; }

  if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
    document.getElementById('rootContainer').innerHTML = `
      <div class="access-denied">
        <h1>權限不足</h1>
        <p>本模組僅限管理員使用。</p>
        <p><a href="index.html">← 返回首頁</a></p>
      </div>
    `;
    return;
  }

  renderLayout();
  renderModuleButtons();
  updateModuleInfoBar();
  // 同步先跑一次 updateProviderButtons，確保 state.currentAiModel 立即有值
  // 否則使用者在 redetectBridge 的 5 秒非同步空窗期按送出會被「AI 不可用」卡住
  updateProviderButtons();
  redetectBridge();
  renderTaskPanel();
  setInterval(renderTaskPanel, 3000);
});

// ────────────────────────────────────────────
// Layout render
// ────────────────────────────────────────────
function renderLayout() {
  document.getElementById('rootContainer').innerHTML = `
    <div class="console-layout">
      <!-- 左欄：聊天 -->
      <div class="console-col chat-col">
        <h2>聊天</h2>
        <div class="chat-messages" id="chatMessages"></div>
        <div class="chat-input-zone">
          <textarea id="chatInput" placeholder="請先選擇模組，再輸入指令..."
            onkeydown="handleChatKeydown(event)"></textarea>
          <div class="chat-input-footer">
            <span id="chatInputHint">AI 偵測中…</span>
            <span class="spacer"></span>
            <label class="chat-inline-control" title="遠端 Gemini API 使用的模型（本地 Gemma 模式忽略此欄）">
              模型
              <select id="chatGeminiModel" onchange="updateProviderButtons()">
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview</option>
                <option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
                <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite Preview</option>
              </select>
            </label>
            <label class="chat-inline-control" title="一次產出幾張卡片（1-10）">
              批次
              <input type="number" id="chatBatchCount" min="1" max="10" value="1">
            </label>
            <button id="chatSendBtn" onclick="onSendMessage()">送出</button>
          </div>
        </div>
      </div>

      <!-- 中央：模組 -->
      <div class="console-col module-col">
        <h2>指定執行模組（第一期啟用 MOD-01/02/03）</h2>
        <div class="module-column-body">
          <div class="module-buttons-grid" id="moduleButtonsGrid"></div>
          <div class="module-info-bar" id="moduleInfoBar"></div>
        </div>
      </div>

      <!-- 右欄：任務面板 -->
      <div class="console-col task-col">
        <h2>任務面板</h2>
        <div class="task-filter-bar" id="taskFilterBar">
          ${TASK_FILTERS.map((f) =>
            `<button data-key="${f.key}" onclick="setTaskFilter('${f.key}')"
              class="${state.taskFilter === f.key ? 'active' : ''}">${f.label}</button>`,
          ).join('')}
        </div>
        <div class="task-panel-body" id="taskPanelBody">
          <div style="color:var(--text-tertiary);font-size:0.75rem;padding:10px;">載入中...</div>
        </div>
      </div>
    </div>
  `;
}

// ────────────────────────────────────────────
// Bridge mode detection
// ────────────────────────────────────────────
async function redetectBridge() {
  setModeIndicator('detecting', '偵測 bridge...');
  const result = await bridgeHealth();

  if (!result.ok) {
    state.bridgeStatus = null;
    setModeIndicator('unavailable', `bridge 不可達（${result.reason}）`);
  } else {
    state.bridgeStatus = result.upstreams;
    const { ollama, gemini } = result.upstreams;
    if (ollama === 'up' && gemini === 'up') setModeIndicator('both', 'bridge 本地 + 遠端皆可用');
    else if (gemini === 'up') setModeIndicator('remote-only', 'bridge：僅遠端 Gemini');
    else if (ollama === 'up') setModeIndicator('local-only', 'bridge：僅本地 Gemma');
    else setModeIndicator('unavailable', 'bridge 回報 upstream 全 down');
  }

  updateProviderButtons();
}

// ────────────────────────────────────────────
// AI 提供者選擇按鈕（遠端 Gemini API 直連 / 本地 Gemma via bridge）
// ────────────────────────────────────────────
// ⚠ 架構：遠端 Gemini API 走前端直連 Google（同 MOD-01 模式），不依賴 bridge
//         本地 Gemma (Ollama) 走 bridge，bridge 只在小黑 localhost 運作
function onProviderChoiceClick(provider) {
  if (provider !== 'gemini' && provider !== 'gemma') return;

  if (provider === 'gemini') {
    // 直連 Google，與 bridge 無關。切換時若無 API Key 先提示設定。
    state.userProviderChoice = 'gemini';
    if (window.hasGeminiApiKey && !window.hasGeminiApiKey()) {
      window.promptForGeminiApiKey && window.promptForGeminiApiKey(
        '請先設定 Gemini API Key（送出訊息時會使用此 key 直連 Google，與 MOD-01 共用）：',
      );
    }
    updateProviderButtons();
    return;
  }
  // gemma 需要 bridge 的 ollama
  if (state.bridgeStatus?.ollama !== 'up') {
    alert('本地 Gemma (Ollama) 目前不可用（需在小黑 localhost 環境執行 bridge 與 Ollama）');
    return;
  }
  state.userProviderChoice = 'gemma';
  updateProviderButtons();
}
window.onProviderChoiceClick = onProviderChoiceClick;

function onApiKeyClick() {
  if (!window.promptForGeminiApiKey) return;
  window.promptForGeminiApiKey('請輸入 Gemini API Key（與 MOD-01 共用 localStorage.gemini_api_key）：');
  updateProviderButtons();
}
window.onApiKeyClick = onApiKeyClick;

window.updateProviderButtons = function () { return updateProviderButtons(); };
function updateProviderButtons() {
  const btns = document.querySelectorAll('.ai-provider-switch .provider-btn');
  if (!btns.length) return;
  const ollamaUp = state.bridgeStatus?.ollama === 'up';
  // 遠端 Gemini API 直連：不受 bridge 影響，永遠可選（缺 key 時送出前會彈窗要求）
  const geminiAvailable = true;

  btns.forEach((btn) => {
    const p = btn.dataset.provider;
    const available = p === 'gemini' ? geminiAvailable : p === 'gemma' ? ollamaUp : false;
    btn.disabled = !available;
    btn.classList.toggle('active', state.userProviderChoice === p && available);
  });

  // 使用者目前選擇若變得不可用，自動切到可用者
  if (state.userProviderChoice === 'gemma' && !ollamaUp) {
    state.userProviderChoice = 'gemini';
    btns.forEach((b) => b.classList.toggle('active', state.userProviderChoice === b.dataset.provider && !b.disabled));
  }

  // 依最終選擇決定 currentAiModel + sendBtn + 提示
  if (state.userProviderChoice === 'gemini') {
    const sel = document.getElementById('chatGeminiModel');
    state.currentAiModel = (sel && sel.value) || 'gemini-2.5-pro';
  } else if (state.userProviderChoice === 'gemma' && ollamaUp) {
    state.currentAiModel = 'gemma-4-e2b';
  } else {
    state.currentAiModel = null;
  }

  const sendBtn = document.getElementById('chatSendBtn');
  const hint = document.getElementById('chatInputHint');
  if (sendBtn) sendBtn.disabled = !state.currentAiModel;
  if (hint) {
    if (state.userProviderChoice === 'gemini') {
      hint.textContent = `遠端 Gemini API（${state.currentAiModel} · 前端直連 Google，使用你的 API Key）`;
    } else if (state.userProviderChoice === 'gemma' && ollamaUp) {
      hint.textContent = `本地 Gemma (Ollama) · ${state.currentAiModel} · 透過 bridge`;
    } else {
      hint.textContent = 'AI 不可用（切到遠端 Gemini API 或在小黑啟動 bridge+Ollama）';
    }
  }

  // API Key 按鈕視覺狀態
  const apiKeyBtn = document.getElementById('providerApiKeyBtn');
  if (apiKeyBtn && window.hasGeminiApiKey) {
    const hasKey = window.hasGeminiApiKey();
    apiKeyBtn.classList.toggle('set', hasKey);
    apiKeyBtn.textContent = hasKey ? 'API Key ✓' : 'API Key';
    apiKeyBtn.title = hasKey
      ? 'Gemini API Key 已設定（點擊修改）'
      : '尚未設定 Gemini API Key（點擊設定）';
  }
}

function setModeIndicator(mode, label) {
  const dot = document.getElementById('modeDot');
  const lbl = document.getElementById('modeLabel');
  if (!dot || !lbl) return;
  dot.className = `mode-dot mode-${mode}`;
  lbl.textContent = label;
}

window.redetectBridge = redetectBridge;

// ────────────────────────────────────────────
// Module buttons
// ────────────────────────────────────────────
function renderModuleButtons() {
  const grid = document.getElementById('moduleButtonsGrid');
  grid.innerHTML = MOD_BUTTONS.map((m) => {
    const isSelected = state.selectedModule?.code === m.code;
    return `
      <button
        class="mod-btn ${isSelected ? 'selected' : ''}"
        ${m.available ? `onclick="onSelectModule('${m.code}')"` : 'disabled'}
        title="${m.available ? '' : (m.reason || '尚未啟用')}">
        <span class="mod-code">${m.code}</span>
        <span class="mod-name">${m.name_zh}</span>
        ${m.available ? '' : '<span class="mod-lock">🔒</span>'}
      </button>
    `;
  }).join('');
}

function onSelectModule(code) {
  const mod = MOD_BUTTONS.find((m) => m.code === code);
  state.selectedModule = state.selectedModule?.code === code ? null : mod;
  renderModuleButtons();
  updateModuleInfoBar();
  updateChatPlaceholder();
}
window.onSelectModule = onSelectModule;

function updateModuleInfoBar() {
  const bar = document.getElementById('moduleInfoBar');
  if (!bar) return;
  if (!state.selectedModule) {
    bar.innerHTML = '<em style="color:var(--text-tertiary)">尚未選擇模組</em>';
    return;
  }
  const m = state.selectedModule;
  bar.innerHTML = `
    <strong style="color:var(--gold)">已選擇：${m.code} ${m.name_zh}</strong><br>
    bridge taskType：<code>${m.bridgeTaskType}</code><br>
    寫入目標 API：<code>${m.api}</code>
  `;
}

function updateChatPlaceholder() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  if (state.selectedModule) {
    input.placeholder = `（${state.selectedModule.code} ${state.selectedModule.name_zh}）輸入指令...（Ctrl+Enter 送出）`;
  } else {
    input.placeholder = '請先選擇模組，再輸入指令...';
  }
}

// ────────────────────────────────────────────
// Chat
// ────────────────────────────────────────────
function appendChatMessage(type, html, meta) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg msg-${type}`;
  div.innerHTML = (meta ? `<div class="meta">${meta}</div>` : '') + html;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    onSendMessage();
  }
}
window.handleChatKeydown = handleChatKeydown;

async function onSendMessage() {
  const input = document.getElementById('chatInput');
  const text = (input.value || '').trim();
  if (!text) {
    alert('請先輸入指令');
    return;
  }
  if (!state.selectedModule) {
    alert('請先選擇要使用的模組');
    return;
  }
  if (!state.currentAiModel) {
    alert('AI 目前不可用：請切換到「遠端 Gemini API」（直連，需 API Key），或在小黑環境啟動 bridge + Ollama 以使用本地 Gemma');
    return;
  }

  appendChatMessage('user', escapeHtml(text), `[${state.selectedModule.code} ${state.selectedModule.name_zh}]`);
  input.value = '';

  const sendBtn = document.getElementById('chatSendBtn');
  sendBtn.disabled = true;
  const thinking = appendChatMessage('thinking', 'AI 規劃中...（首次呼叫遠端 Gemini 可能需 5~20 秒）');

  try {
    const historyBlock = await fetchRecentHistoryBlock(state.selectedModule.code);
    const batchEl = document.getElementById('chatBatchCount');
    const batchCount = Math.max(1, Math.min(10, parseInt(batchEl?.value || '1', 10) || 1));
    const modelEl = document.getElementById('chatGeminiModel');
    const geminiModel = modelEl?.value || 'gemini-2.5-pro';
    const plan = state.userProviderChoice === 'gemini'
      ? await planWithDirectGemini({
          moduleConfig: state.selectedModule,
          userPrompt: text,
          attachedText: '',
          historyBlock,
          batchCount,
          geminiModel,
        })
      : await planWithBridge({
          moduleConfig: state.selectedModule,
          userPrompt: text,
          attachedText: '',
          contextTags: [],
          historyBlock,
          aiProvider: 'gemma',
        });
    thinking.remove();

    if (!plan.items || plan.items.length === 0) {
      appendChatMessage('error',
        'bridge 沒有回傳任何項目（可能 validator 失敗或 Gemini 輸出格式錯誤）。<br>'
        + `<details><summary>bridge 原始回傳</summary><pre style="font-size:0.6875rem;white-space:pre-wrap">${
          escapeHtml(JSON.stringify(plan.bridgeResult, null, 2))
        }</pre></details>`);
      return;
    }

    state.pendingPlan = { ...plan, userPrompt: text };
    renderPlanForConfirmation(plan, text);
  } catch (err) {
    thinking.remove();
    appendChatMessage('error', '呼叫 bridge 失敗：' + escapeHtml(err.message || String(err)));
  } finally {
    sendBtn.disabled = !state.currentAiModel;
  }
}
window.onSendMessage = onSendMessage;

function renderPlanForConfirmation(plan, userPrompt) {
  const items = plan.items;
  const listHtml = items.slice(0, 10).map((it, i) => {
    const name = it.name_zh || it.code || `#${i + 1}`;
    return `<li>${escapeHtml(String(name))}</li>`;
  }).join('');
  const moreNote = items.length > 10 ? `<div style="font-size:0.6875rem;color:var(--text-tertiary);margin-top:4px;">（僅顯示前 10 項，共 ${items.length} 項）</div>` : '';

  const html = `
    <div class="plan-summary">AI 計畫：產出 ${items.length} 項</div>
    <div class="plan-count">模型：${plan.bridgeResult.modelUsed} · 任務類型：${plan.taskType}</div>
    <ol class="plan-item-list">${listHtml}</ol>
    ${moreNote}
    <div class="plan-actions">
      <button class="btn-confirm" onclick="onConfirmPlan()">✓ 確認執行</button>
      <button class="btn-cancel" onclick="onCancelPlan()">✗ 取消</button>
    </div>
  `;
  appendChatMessage('plan', html, `[AI 計畫 · ${new Date().toLocaleTimeString()}]`);
}

async function onConfirmPlan() {
  const pending = state.pendingPlan;
  if (!pending) return;
  state.pendingPlan = null;

  const moduleConfig = state.selectedModule;
  if (!moduleConfig) {
    appendChatMessage('error', '模組狀態遺失，請重新選擇並再試一次');
    return;
  }

  disablePlanButtons();

  try {
    const taskRecord = await createTaskRecord({
      moduleCode: moduleConfig.code,
      userPrompt: pending.userPrompt,
      attachedText: '',
      contextTags: [],
      aiModel: state.currentAiModel,
      aiResponse: pending.bridgeResult,
    });
    appendChatMessage('system', `✓ 任務已建立（${taskRecord.id.slice(0, 8)}…），開始寫入...`);
    await updateTaskStatus(taskRecord.id, { status: 'running' });

    const result = await executeConfirmedPlan({
      taskRecordId: taskRecord.id,
      moduleConfig,
      items: pending.items,
      onProgress: (i, total) => {
        // 以簡化方式顯示進度
        const msgs = document.getElementById('chatMessages');
        const last = msgs.lastElementChild;
        if (last && last.dataset.progressFor === taskRecord.id) {
          last.innerHTML = `<div class="meta">[執行中]</div>進度 ${i + 1}/${total}...`;
        } else {
          const el = appendChatMessage('system', `進度 ${i + 1}/${total}...`, '[執行中]');
          el.dataset.progressFor = taskRecord.id;
        }
      },
    });

    const okCount = result.artifacts.filter((a) => a.type !== 'error').length;
    const errCount = result.artifacts.length - okCount;
    appendChatMessage(
      result.status === 'completed' ? 'ok' : 'error',
      `任務結束：${okCount} 成功 / ${errCount} 失敗`
      + (errCount > 0
        ? `<details style="margin-top:6px;"><summary>錯誤詳情</summary><pre style="font-size:0.6875rem;white-space:pre-wrap">${
          escapeHtml(JSON.stringify(result.artifacts.filter((a) => a.type === 'error'), null, 2))
        }</pre></details>`
        : ''),
      `[${new Date().toLocaleTimeString()}]`);
    renderTaskPanel();
  } catch (err) {
    appendChatMessage('error', '執行失敗：' + escapeHtml(err.message || String(err)));
  }
}
window.onConfirmPlan = onConfirmPlan;

function onCancelPlan() {
  state.pendingPlan = null;
  disablePlanButtons();
  appendChatMessage('system', '已取消計畫');
}
window.onCancelPlan = onCancelPlan;

function disablePlanButtons() {
  document.querySelectorAll('.plan-actions button').forEach((b) => { b.disabled = true; });
}

// ────────────────────────────────────────────
// Task panel
// ────────────────────────────────────────────
function setTaskFilter(key) {
  state.taskFilter = key;
  document.querySelectorAll('#taskFilterBar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.key === key);
  });
  renderTaskPanel();
}
window.setTaskFilter = setTaskFilter;

async function renderTaskPanel() {
  const body = document.getElementById('taskPanelBody');
  if (!body) return;

  const params = { limit: 100 };
  if (state.taskFilter === 'recent')    params.since = '24h';
  if (state.taskFilter === 'running')   params.status = 'running';
  if (state.taskFilter === 'completed') params.status = 'completed';
  if (state.taskFilter === 'failed')    params.status = 'failed';

  const result = await fetchTaskList(params);
  const tasks = result.data || [];
  if (tasks.length === 0) {
    body.innerHTML = `<div style="color:var(--text-tertiary);font-size:0.75rem;padding:10px;">（無任務）</div>`;
    return;
  }

  const groups = { running: [], queued: [], completed: [], failed: [], cancelled: [] };
  for (const t of tasks) (groups[t.status] || groups.failed).push(t);

  const parts = [];
  const order = ['running', 'queued', 'completed', 'failed', 'cancelled'];
  const labels = { running: '執行中', queued: '待執行', completed: '已完成', failed: '失敗', cancelled: '已取消' };
  for (const key of order) {
    if (!groups[key].length) continue;
    parts.push(`<div class="task-group-title">${labels[key]}（${groups[key].length}）</div>`);
    for (const t of groups[key]) parts.push(renderTaskCard(t));
  }
  body.innerHTML = parts.join('');
}

function renderTaskCard(t) {
  const arts = Array.isArray(t.artifacts_created) ? t.artifacts_created : [];
  const okArts = arts.filter((a) => a.type !== 'error');
  const errArts = arts.filter((a) => a.type === 'error');
  const time = t.completed_at || t.started_at || t.created_at;
  const timeStr = time ? new Date(time).toLocaleString() : '';

  let artBlock = '';
  if (okArts.length) {
    const names = okArts.slice(0, 3).map((a) => escapeHtml(a.name || '')).join('、');
    const more = okArts.length > 3 ? `…+${okArts.length - 3}` : '';
    artBlock = `<div class="task-artifacts">✓ ${names}${more}</div>`;
  }
  let errBlock = '';
  if (errArts.length) {
    const first = errArts[0];
    errBlock = `<div class="task-error">✗ ${escapeHtml(first.error || '').slice(0, 120)}${errArts.length > 1 ? ` …+${errArts.length - 1}` : ''}</div>`;
  }

  let actions = '';
  if (t.status === 'queued' || t.status === 'running') {
    actions = `<button onclick="onCancelTask('${t.id}')">取消</button>`;
  } else if (t.status === 'failed') {
    actions = `<button onclick="onRetryTask('${t.id}')">重試</button>`;
  }

  return `
    <div class="task-card task-${t.status}">
      <div class="task-header">
        <span class="task-module">${t.module_code}</span>
        <span class="task-summary">${escapeHtml(t.user_prompt.slice(0, 50))}</span>
      </div>
      <div class="task-time">${timeStr}</div>
      ${artBlock}
      ${errBlock}
      ${actions ? `<div class="task-actions">${actions}</div>` : ''}
    </div>
  `;
}

async function onCancelTask(taskId) {
  if (!confirm('確定取消此任務？已完成的子項目不會回滾。')) return;
  await cancelTaskOnServer(taskId);
  renderTaskPanel();
}
window.onCancelTask = onCancelTask;

async function onRetryTask(taskId) {
  // 修正：舊版只呼叫 server 端 /retry 建立 queued row，但無任何執行引擎消化
  // queued，任務永遠停住。改為前端 re-invoke 完整流程（plan → confirm → execute）
  try {
    const res = await adminFetch(`/api/ai-console/tasks/${taskId}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      alert('無法讀取原任務：' + (json.error || `HTTP ${res.status}`));
      return;
    }
    const t = json.data;
    if (!t || !t.module_code || !t.user_prompt) {
      alert('原任務資料不完整，無法重試');
      return;
    }

    // 1. 選回原模組
    onSelectModule(t.module_code);
    // 2. 把原 prompt 塞回輸入欄（使用者可先改再送）
    const input = document.getElementById('chatInput');
    if (input) input.value = t.user_prompt;
    // 3. 切到「近 24h」filter 讓使用者看到新任務進度
    if (state.taskFilter !== 'recent' && state.taskFilter !== 'all') {
      state.taskFilter = 'recent';
      renderTaskPanel();
    }
    // 4. 直接觸發送出（plan UI 還會彈出讓使用者確認，不會真的直衝寫入）
    await onSendMessage();
  } catch (err) {
    alert('重試失敗：' + (err.message || String(err)));
  }
}
window.onRetryTask = onRetryTask;

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
