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
  {
    code: 'MOD-05', name_zh: '戰鬥專精',
    bridgeTaskType: 'combat_spec_design',
    api: '/api/combat-styles/:styleId/specs',
    apiPathResolver: (item) =>
      `/api/combat-styles/${encodeURIComponent(item.__style_id || item.style_id || '')}/specs`,
    available: true,
    requiresContext: { key: '__style_id', label: '所屬戰鬥風格 ID', hint: '從 MOD-05 編輯器複製風格 ID' },
  },
  { code: 'MOD-06', name_zh: '戰役敘事',    api: '/api/campaigns',              available: false, reason: '待擴充 bridge 支援（第三期）' },
  { code: 'MOD-07', name_zh: '關卡編輯器',  api: '/api/stages',                 available: false, reason: '待擴充 bridge 支援（第三期）' },
  {
    code: 'MOD-08', name_zh: '地點設計器',
    bridgeTaskType: 'location_design',
    api: '/api/admin/locations',
    available: true,
  },
  {
    code: 'MOD-09', name_zh: '鍛造詞條',
    bridgeTaskType: 'affix_design',
    api: '/api/affixes',
    available: true,
  },
  { code: 'MOD-10', name_zh: '城主設計器',  bridgeTaskType: 'mythos_card_design', api: '/api/admin/keeper/mythos-cards', available: true },
  { code: 'MOD-11', name_zh: '調查員設計器', bridgeTaskType: 'investigator_design', api: '/api/admin/investigators',   available: true },
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
  try {
    updateProviderButtons();
  } catch (err) {
    console.error('[DOMContentLoaded] updateProviderButtons throw:', err);
    const ind = document.getElementById('navReadyIndicator');
    if (ind) {
      ind.classList.add('not-ready');
      // 完整錯誤訊息帶到 UI（可能很長，title 放完整字串，textContent 截到 80 字）
      const msg = (err && err.message) ? err.message : String(err);
      const stack = (err && err.stack) ? err.stack.split('\n').slice(0, 3).join(' | ') : '';
      ind.textContent = 'init err: ' + msg.slice(0, 80);
      ind.title = 'updateProviderButtons throw:\n' + msg + '\n\n' + stack;
    }
  }
  redetectBridge();
  renderTaskPanel();
  setInterval(renderTaskPanel, 3000);

  // Phase C：從主軸系列編輯器跳過來時,URL hash 帶 prefill=...
  if (location.hash && location.hash.startsWith('#prefill=')) {
    try {
      const raw = decodeURIComponent(location.hash.slice('#prefill='.length));
      onSelectModule('MOD-01');
      setTimeout(() => {
        const input = document.getElementById('chatInput');
        if (input) {
          input.value = raw;
          input.focus();
        }
        history.replaceState(null, '', location.pathname + location.search);
      }, 100);
    } catch (e) {
      console.warn('[prefill] 解析 hash 失敗:', e);
    }
  }
});

// ────────────────────────────────────────────
// Layout render
// ────────────────────────────────────────────
function renderLayout() {
  document.getElementById('rootContainer').innerHTML = `
    <div class="console-layout">
      <!-- 左欄：聊天（純對話視窗） -->
      <div class="console-col chat-col">
        <h2>聊天</h2>
        <div class="chat-messages" id="chatMessages"></div>
      </div>

      <!-- 中央：模組 + 輸入欄（輸入欄從左欄搬來，讓左欄保持完整對話） -->
      <div class="console-col module-col">
        <h2>指定執行模組（第一期啟用 MOD-01/02/03）</h2>
        <div class="module-column-body">
          <div class="module-buttons-grid" id="moduleButtonsGrid"></div>
          <div class="module-info-bar" id="moduleInfoBar"></div>
        </div>
        <div class="chat-input-zone">
          <textarea id="chatInput" placeholder="請先選擇模組，再輸入指令..."
            onkeydown="handleChatKeydown(event)"></textarea>
          <div class="chat-input-footer">
            <span id="chatInputHint">&nbsp;</span>
            <span class="spacer"></span>
            <button id="chatSendBtn" onclick="onSendMessage()">送出</button>
          </div>
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
  // 自包含實作:不再依賴 window.promptForGeminiApiKey(geminiDirectClient.js 若載入失敗會讓按鈕靜默無效)
  // 與 MOD-01 admin-card-designer 共用同一 localStorage key 'gemini_api_key'
  const LS_KEY = 'gemini_api_key';
  const current = localStorage.getItem(LS_KEY) || '';
  const key = prompt('請輸入 Gemini API Key(與 MOD-01 共用 localStorage.gemini_api_key):', current);
  if (key === null) return; // 使用者按取消
  localStorage.setItem(LS_KEY, String(key).trim());
  // 若 geminiDirectClient.js 已載入,同步通知它(雖然它直接讀 localStorage 也會正確)
  if (typeof window.setGeminiApiKey === 'function') {
    try { window.setGeminiApiKey(String(key).trim()); } catch (e) { /* ignore */ }
  }
  updateProviderButtons();
}
window.onApiKeyClick = onApiKeyClick;

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

  // 判斷目前提供者的**可送出狀態**：gemini 需 key、gemma 需 ollama up
  // hasKey 優先用 geminiDirectClient.js 的 hasGeminiApiKey,fallback 直接讀 localStorage(讓 MOD-12 不依賴 geminiDirectClient.js 載入成功)
  const hasKey = !!(
    (window.hasGeminiApiKey && window.hasGeminiApiKey()) ||
    (localStorage.getItem('gemini_api_key') || '').trim()
  );
  const geminiReady = state.userProviderChoice === 'gemini' && hasKey;
  const gemmaReady = state.userProviderChoice === 'gemma' && ollamaUp;
  const ready = geminiReady || gemmaReady;

  const sendBtn = document.getElementById('chatSendBtn');
  const hint = document.getElementById('chatInputHint');
  if (sendBtn) sendBtn.disabled = !ready;

  // 底部 hint 簡化為「次要提示」——主要狀態改在頂部 navReadyIndicator
  if (hint) {
    if (!ready) {
      hint.textContent = state.userProviderChoice === 'gemini'
        ? '請先在上方設定 API Key'
        : '本地 Gemma 不可用，請切換到遠端 Gemini API';
    } else {
      hint.textContent = ''; // 就緒時清空，留白
    }
  }

  // 頂部 nav 的就緒狀態指示（短文字 + 點擊看完整）
  const navInd = document.getElementById('navReadyIndicator');
  if (navInd) {
    navInd.classList.remove('ready', 'not-ready');
    let shortTxt, fullTxt;
    if (ready) {
      navInd.classList.add('ready');
      shortTxt = state.userProviderChoice === 'gemini' ? 'GEMINI 就緒' : 'GEMMA 就緒';
      fullTxt = `${state.userProviderChoice === 'gemini' ? '遠端 Gemini API' : '本地 Gemma (Ollama)'} · 模型：${state.currentAiModel} · 可送出任務`;
    } else {
      navInd.classList.add('not-ready');
      shortTxt = state.userProviderChoice === 'gemini' ? 'API Key 未設定' : 'GEMMA 不可用';
      fullTxt = state.userProviderChoice === 'gemini'
        ? 'AI 尚未就緒：請點頂部「設定 API Key」輸入你的 Gemini API Key'
        : 'AI 尚未就緒：本地 Gemma 需要在小黑環境啟動 bridge + Ollama。雲端部署請切到「遠端」。';
    }
    navInd.textContent = shortTxt;
    navInd.title = fullTxt;
    navInd.dataset.detail = fullTxt;
    navInd.style.cursor = 'pointer';
    navInd.onclick = () => alert('AI 狀態\n\n' + fullTxt);
  }

  // API Key 按鈕視覺狀態（仿 MOD-01：已設定綠色 / 未設定灰色）
  const apiKeyBtn = document.getElementById('providerApiKeyBtn');
  if (apiKeyBtn) {
    apiKeyBtn.classList.toggle('set', hasKey);
    apiKeyBtn.textContent = hasKey ? 'API Key 已設定' : '設定 API Key';
    apiKeyBtn.title = hasKey
      ? 'Gemini API Key 已設定（點擊修改）'
      : '尚未設定 Gemini API Key（點擊設定）';
  }
}
// 直接把函式本體暴露到 window 供 inline onchange 呼叫（不能用 wrapper，會遞迴）
window.updateProviderButtons = updateProviderButtons;

function setModeIndicator(mode, label) {
  const dot = document.getElementById('modeDot');
  const lbl = document.getElementById('modeLabel');
  if (!dot || !lbl) return;
  dot.className = `mode-dot mode-${mode}`;
  // 短標籤顯示；完整 label 放 title + 點擊彈窗（iPad 沒有 hover）
  const shortMap = {
    'detecting': 'BRIDGE 偵測中',
    'unavailable': 'BRIDGE 未連接',
    'both': 'BRIDGE 連線',
    'remote-only': 'BRIDGE 連線',
    'local-only': 'BRIDGE 連線',
  };
  const shortTxt = shortMap[mode] || 'BRIDGE';
  lbl.textContent = shortTxt;
  lbl.title = label;
  lbl.dataset.detail = label;
  lbl.style.cursor = 'pointer';
  lbl.onclick = () => alert('Bridge 狀態\n\n' + label);
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
  // 提供者就緒檢查：gemini 需 API Key、gemma 需 ollama up
  // hasKey 優先用 geminiDirectClient.js 的 hasGeminiApiKey,fallback 直接讀 localStorage(讓 MOD-12 不依賴 geminiDirectClient.js 載入成功)
  const hasKey = !!(
    (window.hasGeminiApiKey && window.hasGeminiApiKey()) ||
    (localStorage.getItem('gemini_api_key') || '').trim()
  );
  const geminiReady = state.userProviderChoice === 'gemini' && hasKey;
  const gemmaReady = state.userProviderChoice === 'gemma' && state.bridgeStatus?.ollama === 'up';
  if (!geminiReady && !gemmaReady) {
    if (state.userProviderChoice === 'gemini' && !hasKey) {
      // 缺 key 時直接彈設定對話框
      const k = window.promptForGeminiApiKey && window.promptForGeminiApiKey('請先設定 Gemini API Key 才能使用遠端直連：');
      if (!k) return; // 使用者取消
      updateProviderButtons();
      // 設完 key 繼續送（不 return）
    } else {
      alert('本地 Gemma 目前不可用：請切到「遠端 Gemini API」並設定 API Key，或在小黑啟動 bridge + Ollama');
      return;
    }
  }
  if (!state.currentAiModel) {
    alert('內部狀態異常：currentAiModel 為空，請重整頁面');
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
    await renderPlanForConfirmation(plan, text);
  } catch (err) {
    thinking.remove();
    appendChatMessage('error', '呼叫 bridge 失敗：' + escapeHtml(err.message || String(err)));
  } finally {
    sendBtn.disabled = !state.currentAiModel;
  }
}
window.onSendMessage = onSendMessage;

// Phase B：MOD-01 寫卡預覽階段，檢查 name_zh 是否與資料庫或批次內重名
async function checkCardNameCollisions(items, moduleCode) {
  if (moduleCode !== 'MOD-01') return items.map(() => null);
  let dbNames = new Map();
  try {
    const res = await window.adminFetch('/api/cards');
    const payload = await res.json();
    if (payload && payload.success && Array.isArray(payload.data)) {
      for (const c of payload.data) {
        if (c.name_zh) dbNames.set(String(c.name_zh).trim(), c.code || c.id);
      }
    }
  } catch (e) {
    console.warn('[collision check] 查既有卡片失敗，略過 DB 碰撞檢查：', e.message || e);
  }

  // 批次內名字出現次數（找自家 6 張裡互撞）
  const batchCounts = new Map();
  for (const it of items) {
    const n = (it && it.name_zh ? String(it.name_zh).trim() : '');
    if (n) batchCounts.set(n, (batchCounts.get(n) || 0) + 1);
  }

  return items.map((it) => {
    const name = (it && it.name_zh ? String(it.name_zh).trim() : '');
    if (!name) return null;
    const warnings = [];
    const dbHit = dbNames.get(name);
    if (dbHit) warnings.push('DB 已有同名 [' + dbHit + ']');
    if ((batchCounts.get(name) || 0) > 1) warnings.push('批次內重複 ×' + batchCounts.get(name));
    return warnings.length ? warnings.join('；') : null;
  });
}

async function renderPlanForConfirmation(plan, userPrompt) {
  const items = plan.items;
  const moduleCode = (window.state && state.selectedModule && state.selectedModule.code) || '';
  const collisions = await checkCardNameCollisions(items, moduleCode);

  // Phase D-1：hallucination 掃描(僅 MOD-01 卡片)
  const hallucinations = moduleCode === 'MOD-01' && typeof window.scanCardDescForHallucinations === 'function'
    ? items.map(it => window.scanCardDescForHallucinations(it) || [])
    : items.map(() => []);

  const listHtml = items.slice(0, 10).map((it, i) => {
    const name = it.name_zh || it.code || `#${i + 1}`;
    const warn = collisions[i];
    const halluc = hallucinations[i] || [];
    const parts = [];
    if (warn) parts.push('<span style="color:#ff9a6a;font-size:0.7rem;">⚠ ' + escapeHtml(warn) + '</span>');
    if (halluc.length > 0) {
      const termList = halluc.slice(0, 3).map(h => '「' + h.term + '」').join('、');
      const moreTag = halluc.length > 3 ? ' +' + (halluc.length - 3) : '';
      parts.push('<span style="color:#ffd666;font-size:0.7rem;" title="' + escapeHtml(halluc.map(h => h.field + ': ' + h.hint).join('\n')) + '">🚨 疑似發明術語 ' + termList + moreTag + '</span>');
    }
    const warnHtml = parts.length ? ' ' + parts.join(' / ') : '';
    return `<li>${escapeHtml(String(name))}${warnHtml}</li>`;
  }).join('');
  const moreNote = items.length > 10 ? `<div style="font-size:0.6875rem;color:var(--text-tertiary);margin-top:4px;">（僅顯示前 10 項，共 ${items.length} 項）</div>` : '';

  const collisionCount = collisions.filter(Boolean).length;
  const hallucCount = hallucinations.filter(h => h.length > 0).length;
  const banners = [];
  if (collisionCount > 0) {
    banners.push('<div style="background:#3a1e12;border:1px solid #ff9a6a;color:#ffc89a;padding:0.5rem 0.75rem;border-radius:4px;margin:0.5rem 0;font-size:0.8rem;">⚠ 有 ' + collisionCount + ' 張與 DB 或批次內重名。執行後同名 POST 會觸發 code UNIQUE 衝突,建議先取消並請 AI 改名。</div>');
  }
  if (hallucCount > 0) {
    const totalTerms = hallucinations.reduce((a, h) => a + h.length, 0);
    banners.push('<div style="background:#3a2e0a;border:1px solid #ffd666;color:#ffe9a0;padding:0.5rem 0.75rem;border-radius:4px;margin:0.5rem 0;font-size:0.8rem;">🚨 偵測到 ' + hallucCount + ' 張卡的 desc_zh 含疑似 AI 發明術語,共 ' + totalTerms + ' 筆(例「反擊」關鍵字、「眩暈」狀態等不在合法清單)。寫入後這些術語不會被遊戲引擎識別,建議取消並請 AI 改用合法術語或拆成獨立 effect。滑鼠移到 🚨 看詳情。</div>');
  }

  const html = `
    <div class="plan-summary">AI 計畫：產出 ${items.length} 項</div>
    <div class="plan-count">模型：${plan.bridgeResult.modelUsed} · 任務類型：${plan.taskType}</div>
    ${banners.join('')}
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
