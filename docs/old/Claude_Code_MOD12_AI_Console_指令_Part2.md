# Claude Code 指令：AI 主控台 MOD-12（Part 2 / 3）
## AI Console Module — Frontend UI

> **承接 Part 1：** 本文定義 `admin-ai-console.html` 的完整版面與互動邏輯。
> 視覺風格遵循 `admin-shared.css` 的暗黑哥德色彩系統（深色背景、金色強調）。

---

## 一、整體版面結構

```
┌─────────────────────────────────────────────────────────────────────┐
│ 頂部導航列：[← 返回首頁]  [AI 主控台]  [MOD-12]  [模式指示器]        │
├──────────────┬──────────────────────────────────┬───────────────────┤
│              │                                  │                   │
│   左側欄      │           中央主區                │     右側欄        │
│  聊天視窗     │       11 模組指揮按鈕             │   任務面板        │
│              │                                  │                   │
│  (350px)     │           (彈性寬度)              │    (380px)       │
│              │                                  │                   │
└──────────────┴──────────────────────────────────┴───────────────────┘
```

**斷點：**
- 桌面（>=1400px）：三欄並列
- 中型螢幕（1024–1399px）：左欄縮為 300px，右欄縮為 320px
- 平板（<1024px）：右欄收合為抽屜（按鈕展開）
- 手機（<768px）：本模組顯示「不支援手機操作」訊息

---

## 二、頂部導航列

```html
<nav class="admin-nav console-nav">
  <a href="index.html" class="nav-back">← 返回首頁</a>
  <span class="nav-title">AI 主控台</span>
  <span class="nav-code">MOD-12</span>
  
  <div class="nav-spacer"></div>
  
  <div class="ai-mode-indicator" id="aiModeIndicator">
    <span class="mode-dot" id="modeDot"></span>
    <span class="mode-label" id="modeLabel">偵測中...</span>
    <button class="mode-refresh" onclick="redetectMode()" title="重新偵測">⟳</button>
  </div>
  
  <button class="nav-btn" onclick="openSettings()">⚙ 設定</button>
</nav>
```

**設定面板（彈出）內容：**
- Gemini API Key（顯示前 6 碼 + 後 4 碼，可重新輸入）
- 預設 AI 模式（自動偵測 / 強制本地 / 強制遠端）
- 任務歷史保留數量（預設 100 筆）
- 清空所有歷史按鈕

---

## 三、左側聊天視窗

### 3.1 結構

```
┌──────────────────────────────┐
│  聊天視窗                      │
├──────────────────────────────┤
│                              │
│   [系統]                      │
│   👋 你好，請選擇要使用的模組   │
│   並輸入指令。                  │
│                              │
│   [使用者] (附帶 1 個檔案)     │
│   依此段落設計 5 張深潛者      │
│   主題的恐懼系卡片              │
│   📎 starcolor_chapter1.txt   │
│                              │
│   [AI - 計畫]                 │
│   我將執行以下任務：            │
│   1. 設計 5 張卡片              │
│   2. 主題：深潛者              │
│   3. 機制：恐懼系               │
│   [✓ 確認執行]  [✗ 取消]      │
│                              │
│   [系統]                      │
│   ✓ 任務已開始（task_id: ...）│
│                              │
├──────────────────────────────┤
│  📎 [拖拉檔案到此或點擊上傳]   │
├──────────────────────────────┤
│  ┌────────────────────────┐  │
│  │ 請輸入指令...           │  │
│  │                        │  │
│  │                        │  │
│  └────────────────────────┘  │
│  [字數: 0]    [送出 Enter]    │
└──────────────────────────────┘
```

### 3.2 訊息類型

| 類型 | 說明 | 顯示樣式 |
|------|------|----------|
| `system` | 系統訊息（任務開始、完成、錯誤等） | 灰色背景，置中 |
| `user` | Uria 的指令 | 金色邊框，靠右 |
| `ai_plan` | AI 回傳的執行計畫（等待確認） | 深藍邊框，靠左，含確認按鈕 |
| `ai_executing` | AI 執行中的訊息 | 動畫進度條 |
| `ai_result` | AI 完成的結果摘要 | 綠色邊框（成功）或紅色邊框（失敗） |

### 3.3 確認執行流程（Q2 確認的需求）

```
Uria 輸入指令 + 點擊送出
  ↓
前端發送 prompt 給 AI（連同 system prompt + 規則書相關章節）
  ↓
AI 回傳 JSON 計畫，例如：
{
  "plan_summary": "設計 5 張深潛者主題卡片",
  "tasks": [
    { "type": "create_card", "name_zh": "深潛者的呢喃", "faction": "I", ... },
    { "type": "create_card", "name_zh": "海水浸泡", "faction": "S", ... },
    ...
  ],
  "estimated_duration_sec": 30
}
  ↓
前端顯示計畫 + [✓ 確認執行] [✗ 取消] 按鈕
  ↓
Uria 確認後，前端開始逐項呼叫對應 API
  ↓
每完成一項，左側聊天視窗 + 右側任務面板同步更新
```

### 3.4 檔案上傳

**支援格式：** 純文字（`.txt`、`.md`）

**處理方式：**
- 前端 `FileReader` 讀取為字串
- 大小限制：10 MB（避免 prompt 爆掉）
- 多檔上傳：可同時拖拉多個檔案，串接時用 `===== filename =====` 分隔
- 上傳後在輸入區顯示「📎 檔名 (大小) [×]」標籤

**程式碼骨架：**

```javascript
const dropZone = document.getElementById('chatDropZone');
const fileInput = document.getElementById('chatFileInput');

let attachedFiles = []; // [{ name, content, size }]

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  await addFiles(files);
});

fileInput.addEventListener('change', async (e) => {
  await addFiles(Array.from(e.target.files));
});

async function addFiles(files) {
  for (const file of files) {
    if (!file.name.match(/\.(txt|md)$/i)) {
      alert(`不支援的檔案格式：${file.name}（僅接受 .txt / .md）`);
      continue;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert(`檔案過大：${file.name}（上限 10MB）`);
      continue;
    }
    const content = await file.text();
    attachedFiles.push({ name: file.name, content, size: file.size });
    renderAttachedFileTags();
  }
}

function renderAttachedFileTags() {
  const container = document.getElementById('attachedFilesContainer');
  container.innerHTML = attachedFiles.map((f, idx) => `
    <span class="file-tag">
      📎 ${f.name} (${formatBytes(f.size)})
      <button onclick="removeAttachedFile(${idx})">×</button>
    </span>
  `).join('');
}

function removeAttachedFile(idx) {
  attachedFiles.splice(idx, 1);
  renderAttachedFileTags();
}

function buildAttachedTextForPrompt() {
  if (attachedFiles.length === 0) return '';
  return '\n\n附加文字內容：\n' + attachedFiles.map(f => 
    `===== ${f.name} =====\n${f.content}`
  ).join('\n\n');
}
```

### 3.5 聊天記錄持久化

**為了避免重新整理頁面後遺失對話：**

每次新增訊息時，將整個訊息陣列寫入 `localStorage` key `ai_console_chat_history`。

**清空策略：**
- 訊息超過 200 筆時，自動移除最舊的 100 筆
- 設定面板提供「清空對話」按鈕

---

## 四、中央主區：11 模組指揮按鈕

### 4.1 結構

```
┌──────────────────────────────────────────────────────┐
│  指定執行模組（第一期僅啟用 MOD-01/02/03）           │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐│
│  │ MOD-01   │ │ MOD-02   │ │ MOD-03   │ │ MOD-04🔒││
│  │ 卡片      │ │ 天賦樹   │ │ 敵人     │ │ 團隊精神 ││
│  │ 設計器    │ │ 設計器   │ │ 設計器   │ │ 管理     ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘│
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐│
│  │ MOD-05🔒 │ │ MOD-06⚪ │ │ MOD-07⚪ │ │ MOD-08🔒││
│  │ 戰鬥     │ │ 戰役     │ │ 關卡     │ │ 地點     ││
│  │ 風格     │ │ 敘事     │ │ 編輯器   │ │ 設計器   ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘│
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │ MOD-09🔒 │ │ MOD-10🔒 │ │ MOD-11🔒 │              │
│  │ 鍛造     │ │ 城主     │ │ 調查員   │              │
│  │ 製作     │ │ 設計器   │ │ 設計器   │              │
│  └──────────┘ └──────────┘ └──────────┘              │
│                                                      │
├──────────────────────────────────────────────────────┤
│  目前選擇：MOD-01 卡片設計器                          │
│  說明：會透過 bridge 產生卡片 → 確認後 POST /api/cards│
└──────────────────────────────────────────────────────┘

⚪ = 模組未建置（MOD-06、MOD-07，disabled，hover 顯示「該模組尚未建置」）
🔒 = bridge 尚未支援（MOD-04/05/08/09/10/11，disabled，hover 顯示「待第二期擴充 gemma-bridge」）
```

### 4.2 按鈕狀態

| 狀態 | 視覺 | 互動 |
|------|------|------|
| 未選擇（第一期 MOD-01/02/03） | 深底金邊 | hover 微亮 |
| 已選擇 | 金底深字 + 發光邊框 | 再點取消選擇 |
| bridge 未支援（MOD-04/05/08/09/10/11） | 灰底灰字 + 鎖頭 🔒 icon | 不可點，hover 顯示「待第二期擴充 gemma-bridge」 |
| 模組未建置（MOD-06 / MOD-07） | 灰底灰字 + 空心圓 ⚪ icon | 不可點，hover 顯示「該模組尚未建置」 |
| bridge 不可達 | 所有按鈕紅底 + 警告 icon | 所有按鈕可點但送出會失敗，提示使用者啟動 bridge |

### 4.3 程式碼骨架

`MOD_BUTTONS` 需同時記錄：`bridgeTaskType`（送給 bridge 的任務類型）、`api`（MOD-12 確認後自己 POST 的目標路徑）、`apiPathResolver`（若路徑含動態片段）。第一期僅 MOD-01/02/03 可用。

```javascript
const MOD_BUTTONS = [
  // ━━━ 第一期：透過 gemma-bridge 執行 ━━━
  {
    code: 'MOD-01',
    name_zh: '卡片設計器',
    bridgeTaskType: 'card_design',       // 送給 bridge 的 taskType（Uria 指令含 "combo" 時動態改 combo_design）
    api: '/api/cards',                    // MOD-12 確認後自己逐項 POST
    available: true,
  },
  {
    code: 'MOD-02',
    name_zh: '天賦樹設計器',
    bridgeTaskType: 'talent_tree',
    api: '/api/talent-trees/:factionCode/nodes',
    apiPathResolver: (item) =>
      `/api/talent-trees/${encodeURIComponent(item.faction_code)}/nodes`,
    available: true,
  },
  {
    code: 'MOD-03',
    name_zh: '敵人設計器',
    bridgeTaskType: 'enemy_design',
    api: '/api/admin/monsters/variants',
    available: true,
  },

  // ━━━ 第二期：bridge 尚未支援（按鈕顯示 🔒）━━━
  { code: 'MOD-04', name_zh: '團隊精神',
    api: '/api/team-spirits',
    available: false, reason: '待擴充 bridge 支援（第二期）' },
  { code: 'MOD-05', name_zh: '戰鬥風格',
    api: '/api/combat-styles',
    available: false, reason: '待擴充 bridge 支援（第二期）' },
  { code: 'MOD-06', name_zh: '戰役敘事',
    api: null,
    available: false, reason: '模組尚未建置' },
  { code: 'MOD-07', name_zh: '關卡編輯器',
    api: null,
    available: false, reason: '模組尚未建置' },
  { code: 'MOD-08', name_zh: '地點設計器',
    api: '/api/admin/locations',
    available: false, reason: '待擴充 bridge 支援（第二期）' },
  { code: 'MOD-09', name_zh: '鍛造製作',
    api: '/api/affixes',  // 多端點：另有 /recipes、/materials
    available: false, reason: '待擴充 bridge 支援（第二期）' },
  { code: 'MOD-10', name_zh: '城主設計器',
    api: '/api/admin/keeper/mythos-cards',  // 多端點：另有 /encounter-cards
    available: false, reason: '待擴充 bridge 支援（第二期）' },
  { code: 'MOD-11', name_zh: '調查員設計器',
    api: '/api/admin/investigators',
    available: false, reason: '待擴充 bridge 支援（第二期）' },
];
```

**Combo 判斷（MOD-01 特殊處理）：** 使用者在 MOD-01 聊天框輸入指令若包含「combo」或「組合」關鍵字，送 bridge 時把 `bridgeTaskType` 改為 `combo_design`。若判斷不準，可在聊天輸入區加一個下拉選「單張 / 批次 / Combo」讓 Uria 明確指定。

let selectedModule = null;

function renderModuleButtons() {
  const container = document.getElementById('moduleButtonsGrid');
  container.innerHTML = MOD_BUTTONS.map(mod => `
    <button 
      class="mod-btn ${mod.available ? '' : 'disabled'} ${selectedModule?.code === mod.code ? 'selected' : ''}"
      ${mod.available ? `onclick="selectModule('${mod.code}')"` : 'disabled'}
      title="${mod.available ? '' : mod.reason}"
    >
      <div class="mod-code">${mod.code}</div>
      <div class="mod-name">${mod.name_zh}</div>
      ${mod.available ? '' : '<div class="mod-lock">🔒</div>'}
    </button>
  `).join('');
}

function selectModule(code) {
  if (selectedModule?.code === code) {
    selectedModule = null; // 取消選擇
  } else {
    selectedModule = MOD_BUTTONS.find(m => m.code === code);
  }
  renderModuleButtons();
  updateChatPlaceholder();
  updateModuleInfoBar();
}

function updateChatPlaceholder() {
  const input = document.getElementById('chatInput');
  if (selectedModule) {
    input.placeholder = `（指定使用 ${selectedModule.code} ${selectedModule.name_zh}）請輸入指令...`;
  } else {
    input.placeholder = '請先選擇上方模組，再輸入指令...';
  }
}

function updateModuleInfoBar() {
  const bar = document.getElementById('moduleInfoBar');
  if (selectedModule) {
    bar.innerHTML = `
      <strong>目前選擇：</strong>${selectedModule.code} ${selectedModule.name_zh}
      <br><strong>說明：</strong>會呼叫 <code>${selectedModule.api}</code> 建立新項目
    `;
  } else {
    bar.innerHTML = '<em style="color: var(--text-tertiary)">尚未選擇模組</em>';
  }
}
```

### 4.4 「未選擇模組」的限制

如果 Uria 沒選任何模組就按送出：
- 訊息不送出
- 跳出提示：「請先選擇要使用的模組」
- 中央按鈕區域整個發光 1 秒提醒

---

## 五、右側任務面板

### 5.1 結構

```
┌────────────────────────────────────┐
│  任務面板                           │
├────────────────────────────────────┤
│  [全部] [待執行] [執行中] [已完成]  │
│  [失敗] [清空歷史]                  │
├────────────────────────────────────┤
│                                    │
│  ▼ 執行中（1）                      │
│  ┌──────────────────────────────┐  │
│  │ MOD-01 設計 5 張深潛者卡片    │  │
│  │ ████████░░░░ 3/5             │  │
│  │ ⏱ 已耗時 23 秒                │  │
│  │ [取消]                        │  │
│  └──────────────────────────────┘  │
│                                    │
│  ▼ 待執行（2）                      │
│  ┌──────────────────────────────┐  │
│  │ MOD-03 設計 3 個哈斯塔怪物    │  │
│  │ 排隊中...                     │  │
│  │ [取消]                        │  │
│  └──────────────────────────────┘  │
│                                    │
│  ▼ 已完成（最近 10 筆）              │
│  ┌──────────────────────────────┐  │
│  │ ✓ MOD-01 設計鐵證系卡片 ×3    │  │
│  │ 09:45 完成 (耗時 45 秒)        │  │
│  │ 產出：洛克菲勒的調查、...     │  │
│  │ [展開] [複製設定重做]          │  │
│  └──────────────────────────────┘  │
│                                    │
│  ▼ 失敗（最近 5 筆）                │
│  ┌──────────────────────────────┐  │
│  │ ✗ MOD-04 團隊精神深度設計     │  │
│  │ 09:30 失敗                   │  │
│  │ 錯誤：JSON 格式不符 schema    │  │
│  │ [展開錯誤] [重試]             │  │
│  └──────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

### 5.2 任務卡片內容

**待執行任務：**
- 模組編號 + 任務摘要
- 「排隊中」字樣
- 取消按鈕

**執行中任務：**
- 模組編號 + 任務摘要
- 進度條（X / Y 子任務完成）
- 已耗時計時器
- 取消按鈕（按下會中止當前 API 呼叫）

**已完成任務：**
- ✓ + 模組編號 + 任務摘要
- 完成時間 + 耗時
- 產出物件清單（前 3 個 + 「...」）
- 展開按鈕（顯示完整產出）
- 複製設定重做按鈕

**失敗任務：**
- ✗ + 模組編號 + 任務摘要
- 失敗時間
- 錯誤訊息摘要
- 展開錯誤詳情
- 重試按鈕

### 5.3 篩選與操作

```javascript
let taskFilter = 'all'; // 'all' | 'queued' | 'running' | 'completed' | 'failed'

async function fetchTasks() {
  const params = taskFilter === 'all' ? '' : `?status=${taskFilter}`;
  const response = await fetch(`/api/ai-console/tasks${params}`);
  const result = await response.json();
  return result.data;
}

async function renderTaskPanel() {
  const tasks = await fetchTasks();
  const grouped = groupTasksByStatus(tasks);
  
  const container = document.getElementById('taskPanel');
  container.innerHTML = `
    ${renderTaskGroup('執行中', grouped.running, 'running')}
    ${renderTaskGroup('待執行', grouped.queued, 'queued')}
    ${renderTaskGroup('已完成（最近 10 筆）', grouped.completed.slice(0, 10), 'completed')}
    ${renderTaskGroup('失敗（最近 5 筆）', grouped.failed.slice(0, 5), 'failed')}
  `;
}

function renderTaskGroup(label, tasks, status) {
  if (tasks.length === 0) return '';
  return `
    <div class="task-group">
      <h3>▼ ${label}（${tasks.length}）</h3>
      <div class="task-list">
        ${tasks.map(t => renderTaskCard(t, status)).join('')}
      </div>
    </div>
  `;
}

function renderTaskCard(task, status) {
  const moduleInfo = MOD_BUTTONS.find(m => m.code === task.module_code);
  
  let buttons = '';
  switch (status) {
    case 'queued':
    case 'running':
      buttons = `<button onclick="cancelTask('${task.id}')">取消</button>`;
      break;
    case 'completed':
      buttons = `
        <button onclick="expandTask('${task.id}')">展開</button>
        <button onclick="duplicateTask('${task.id}')">複製設定重做</button>
      `;
      break;
    case 'failed':
      buttons = `
        <button onclick="expandError('${task.id}')">展開錯誤</button>
        <button onclick="retryTask('${task.id}')">重試</button>
      `;
      break;
  }
  
  return `
    <div class="task-card task-${status}">
      <div class="task-header">
        ${getStatusIcon(status)}
        <span class="task-module">${task.module_code}</span>
        <span class="task-summary">${truncate(task.user_prompt, 40)}</span>
      </div>
      ${renderTaskBody(task, status)}
      <div class="task-actions">${buttons}</div>
    </div>
  `;
}

// 即時更新：每 2 秒輪詢一次（WebSocket 為未來優化）
setInterval(renderTaskPanel, 2000);
```

### 5.4 取消執行中任務

```javascript
async function cancelTask(taskId) {
  if (!confirm('確定取消此任務？已完成的子任務不會回滾。')) return;
  
  // 1. 標記為取消中（前端立即停止後續呼叫）
  cancelledTaskIds.add(taskId);
  
  // 2. 通知後端
  await fetch(`/api/ai-console/tasks/${taskId}/cancel`, { method: 'POST' });
  
  // 3. 重新渲染
  renderTaskPanel();
}
```

### 5.5 重試失敗任務

```javascript
async function retryTask(taskId) {
  // 取得原任務的 user_prompt + module_code + attached_text
  const response = await fetch(`/api/ai-console/tasks/${taskId}`);
  const original = (await response.json()).data;
  
  // 建立新任務（複製設定）
  const newTaskResponse = await fetch('/api/ai-console/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module_code: original.module_code,
      user_prompt: original.user_prompt,
      attached_text: original.attached_text,
      ai_model: currentMode === 'local' ? 'gemma-4-e2b' : 'gemini-2.5-pro',
    }),
  });
  
  // 開始執行新任務
  const newTask = (await newTaskResponse.json()).data;
  await executeTask(newTask.id);
}
```

---

## 六、CSS 樣式（admin-ai-console.css）

### 6.1 主要 Class 與顏色

```css
/* 三欄主版面 */
.console-layout {
  display: grid;
  grid-template-columns: 350px 1fr 380px;
  gap: 16px;
  height: calc(100vh - 64px);
  padding: 16px;
}

@media (max-width: 1399px) {
  .console-layout {
    grid-template-columns: 300px 1fr 320px;
  }
}

@media (max-width: 1023px) {
  .console-layout {
    grid-template-columns: 300px 1fr;
  }
  .task-panel {
    position: fixed;
    right: -380px;
    transition: right 0.3s;
  }
  .task-panel.open {
    right: 0;
  }
}

/* 模式指示器 */
.ai-mode-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.mode-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.mode-dot.mode-local       { background: var(--success); }
.mode-dot.mode-remote      { background: var(--gold); }
.mode-dot.mode-detecting   { background: var(--text-tertiary); animation: pulse 1s infinite; }
.mode-dot.mode-unavailable { background: var(--danger); }

/* 模組按鈕格 */
.module-buttons-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.mod-btn {
  background: var(--bg-card);
  border: 2px solid var(--border);
  border-radius: 6px;
  padding: 16px 8px;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.mod-btn:hover:not(.disabled) {
  border-color: var(--gold-dim);
  background: var(--bg-card-hover);
}

.mod-btn.selected {
  background: var(--gold);
  color: var(--bg-primary);
  border-color: var(--gold);
  box-shadow: 0 0 12px var(--gold-glow);
}

.mod-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  position: relative;
}

.mod-btn .mod-code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-secondary);
}

.mod-btn .mod-name {
  font-family: 'Cinzel', serif;
  font-size: 14px;
  margin-top: 4px;
}

/* 任務卡片 */
.task-card {
  background: var(--bg-card);
  border-left: 3px solid var(--border);
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 4px;
}

.task-card.task-running   { border-left-color: var(--info); }
.task-card.task-queued    { border-left-color: var(--text-tertiary); }
.task-card.task-completed { border-left-color: var(--success); }
.task-card.task-failed    { border-left-color: var(--danger); }

/* 進度條 */
.task-progress {
  height: 6px;
  background: var(--bg-secondary);
  border-radius: 3px;
  margin: 8px 0;
  overflow: hidden;
}

.task-progress-bar {
  height: 100%;
  background: var(--info);
  transition: width 0.3s;
}
```

### 6.2 字型與圖示

- 標題使用 `Cinzel`
- 模組編號使用 `JetBrains Mono`
- 系統訊息使用 `Noto Sans TC`
- 圖示使用 emoji（不引入額外圖示庫）

---

## 七、Part 2 完成檢查項

- [ ] `admin-ai-console.html` 已建立並可在瀏覽器開啟
- [ ] 三欄版面在桌面、平板、手機（顯示不支援）正確切換
- [ ] 模式指示器可顯示四種狀態
- [ ] 設定面板可開關，可重新輸入 API Key
- [ ] 聊天視窗可接收檔案拖拉上傳
- [ ] 11 個模組按鈕正確渲染：MOD-01/02/03 可用；MOD-04/05/08/09/10/11 顯示 🔒 待擴充；MOD-06/07 顯示 ⚪ 未建置
- [ ] 任務面板可顯示四種狀態的任務
- [ ] 任務面板每 2 秒自動更新
- [ ] 取消、重試、複製重做按鈕都能正常觸發

---

## 八、文件版本

| 版本 | 日期 | 變更 |
|------|------|------|
| v1.0 | 2026/04/18 | Part 2 初版 — 三欄版面、聊天視窗、模組按鈕、任務面板 |
