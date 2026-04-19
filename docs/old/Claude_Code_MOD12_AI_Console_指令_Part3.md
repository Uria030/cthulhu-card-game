# Claude Code 指令：AI 主控台 MOD-12（Part 3 / 3）
## AI Console Module — Module Router & Execution Engine

> **承接 Part 1、Part 2：** 本文定義「AI 收到指令後如何理解、規劃、並呼叫對應模組 API」的完整流程。
>
> **核心機制：** 兩階段執行
> 1. **規劃階段**：AI 讀取 user prompt + 模組 system prompt + 規則書摘要 → 回傳結構化計畫 → 等 Uria 確認
> 2. **執行階段**：Uria 確認後，前端逐項呼叫對應模組 API
>
> **本 Part 不包含**：每個模組的詳細欄位 schema（這些屬於各 MOD 指令文件的職責）。本 Part 提供路由框架，實際 schema 由 Claude Code 從各 MOD 文件讀取後填入。

---

## 一、執行引擎總覽

### 1.1 完整流程圖

```
Uria 在 chat 輸入指令 + 選擇模組 + 點送出
  ↓
前端組裝 bridge 請求：
  - taskType = 模組對應的 bridgeTaskType（card_design / talent_tree / enemy_design）
  - input = Uria 的指令 + 附加文字
  - writeToDb = false（第一階段只取規劃，不寫 DB）
  ↓
呼叫 bridge → POST http://127.0.0.1:8787/task
  ↓
bridge 內部執行（taskRouter → geminiClient / gemmaOrchestrator → validator）
  ↓
回傳 TaskResult { taskId, status, items[], errors[], usage, ... }
  ↓
前端把 items 渲染為「計畫」顯示於聊天視窗 + [✓ 確認] [✗ 取消]
  ↓
        ┌──── Uria 取消 ────→ 任務狀態 = cancelled，結束
        │
   Uria 確認
        ↓
建立任務 → POST /api/ai-console/tasks → 取得 task_id
  ↓
任務狀態 = running
  ↓
前端逐項把 items 寫入對應模組 API（不再呼叫 bridge）：
  for (const item of items):
    if (cancelledTaskIds.has(task_id)) break;
    更新進度 = i / total
    cleanedItem = sanitizeSubtask(moduleCode, item)   ← §四.1 白名單過濾
    POST moduleConfig.api（或 apiPathResolver(item) 計算動態路徑）
    記錄 artifact 到 artifacts_created
  ↓
        ┌──── 全部成功 ────→ 任務狀態 = completed
        │
   有失敗 ────────────→ 任務狀態 = failed，記錄 error_message
```

### 1.2 兩階段設計的理由

**為什麼要先「規劃 → 確認 → 執行」而不是直接執行？**

| 風險 | 規劃階段攔截 | 直接執行的後果 |
|------|------------|-------------|
| AI 誤解指令 | Uria 看到計畫不對可取消 | 寫入錯誤資料到 DB |
| AI 產生過多項目 | 「設計 5 張」變「設計 50 張」可看到並取消 | 大量垃圾資料 |
| 規則違反 | Uria 可看到 plan 中違規的欄位 | 直接寫入後才發現 |
| API 額度浪費 | 確認前不消耗模組 API | 失敗仍計次 |

---

## 二、Prompt 結構（給 AI 的輸入）

### 2.1 完整 Prompt 模板

```
[SYSTEM ROLE — 模組專屬 system prompt]

你是「克蘇魯神話 TCG」遊戲設計助理，當前任務歸屬模組：MOD-XX [模組名稱]。

本模組職責：[從規則書摘要的 1-2 句話]

你必須遵守以下規則：

1. 陣營代碼必須是以下八個之一（八陣營極體系）：
   E（號令）、I（深淵）、S（鐵證）、N（天啟）、T（解析）、F（聖燼）、J（鐵壁）、P（流影）
   中立卡使用 "neutral"

2. 稀有度代碼：[依該模組相關欄位填入，從規則書與 v1.1 修正案查證]

3. 克蘇魯神話專有名詞：必須使用台灣繁中譯名（如「達貢」非「大袞」）

4. [模組專屬規則，例如：卡片三合一用途、敵人五階位階等]

[輸出格式 — 結構化 JSON]

請回傳以下 JSON 結構：
{
  "plan_summary": "1-2 句中文摘要，描述你計畫做什麼",
  "estimated_count": 數字,
  "tasks": [
    {
      "type": "create_[entity]",
      "[依該模組必填欄位]": "...",
      ...
    }
  ],
  "warnings": ["可選的警告訊息"]
}

不要回傳任何其他文字。只回傳 JSON。

[USER INPUT]

[使用者指令]:
[Uria 輸入的文字]

[附加文字內容]:
[從 attached_text 讀取的內容，如果為空則省略此區塊]
```

### 2.2 各模組的 system prompt 對應檔案

存放在 `packages/client/public/admin/admin-ai-tasks/prompts/` 目錄：

```
prompts/
├── mod-01-card.md          # 卡片設計
├── mod-02-talent.md        # 天賦樹
├── mod-03-enemy.md         # 敵人
├── mod-04-spirit.md        # 團隊精神
├── mod-05-combat.md        # 戰鬥風格
├── mod-08-location.md      # 地點
├── mod-09-forge.md         # 鍛造製作
├── mod-10-keeper.md        # 城主
└── mod-11-investigator.md  # 調查員
```

> **給 Claude Code：** 這些檔案的具體內容**請從各 MOD 的指令文件中提取必要規則**寫入。**禁止自行推測**。每份 system prompt 應該包含：
> 1. 該模組的職責說明
> 2. 該模組必填欄位的清單與型別
> 3. 該模組相關的規則書章節摘要
> 4. JSON 輸出格式範例（從各 MOD 指令文件的 API 範例中複製）
> 5. 常見錯誤提醒
>
> 撰寫每份 prompt 時，請依序讀取對應的 MOD 指令文件，從中抽取資訊。例如撰寫 `mod-01-card.md` 時，應讀取 MOD-01 卡片設計器的 5 份指令、規則書第三章、卡片價值計算規範 v1.1。

### 2.3 Prompt 大小考量（GEMMA 8K 限制）

GEMMA 4 E2B 的上下文視窗約 8K–32K tokens。為避免超出：

**精簡策略：**
1. **system prompt 控制在 1500 tokens 內**（約 1000 中文字 + JSON schema）
2. **附加文字提示 Uria 預先切割**：聊天視窗應顯示「目前 prompt 預估 token 數」
3. **超過閾值時強制切換到 Gemini**（因為 Gemini 2.5 Pro 有 200 萬 token）

**Token 估算（前端粗估）：**

```javascript
function estimateTokens(text) {
  // 粗估：中文 1 字 ≈ 1.5 token，英文 1 詞 ≈ 1.3 token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return Math.ceil(chineseChars * 1.5 + englishWords * 1.3);
}

function checkTokenLimit(prompt) {
  const tokens = estimateTokens(prompt);
  const LOCAL_LIMIT = 6000; // GEMMA 安全上限
  
  if (currentMode === 'local' && tokens > LOCAL_LIMIT) {
    return {
      ok: false,
      message: `輸入過長（約 ${tokens} tokens，本地 GEMMA 上限約 ${LOCAL_LIMIT}）。
                請切割附加文字後重試，或切換到遠端 Gemini 2.5 Pro。`,
    };
  }
  return { ok: true, tokens };
}
```

---

## 三、AI 呼叫實作

### 3.1 統一呼叫介面

```javascript
// admin-ai-tasks/aiClient.js

async function callAI(systemPrompt, userInput, attachedText) {
  const fullPrompt = buildFullPrompt(systemPrompt, userInput, attachedText);
  
  const tokenCheck = checkTokenLimit(fullPrompt);
  if (!tokenCheck.ok) {
    throw new Error(tokenCheck.message);
  }
  
  if (currentMode === 'local') {
    return callGemmaLocal(fullPrompt);
  } else if (currentMode === 'remote') {
    return callGeminiRemote(fullPrompt);
  } else {
    throw new Error('無可用的 AI 模型');
  }
}

async function callGemmaLocal(prompt) {
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma-4-e2b',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      format: 'json',
      options: {
        temperature: 0.7,
      },
    }),
  });
  
  if (!response.ok) {
    throw new Error(`本地 GEMMA 呼叫失敗：${response.status}`);
  }
  
  const data = await response.json();
  return parseAIResponse(data.message.content);
}

async function callGeminiRemote(prompt) {
  const apiKey = localStorage.getItem('gemini_api_key');
  if (!apiKey) {
    throw new Error('未設定 Gemini API Key');
  }
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8000,
          responseMimeType: 'application/json',
        },
      }),
    }
  );
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini 呼叫失敗：${response.status} ${errText}`);
  }
  
  const data = await response.json();
  return parseAIResponse(data.candidates[0].content.parts[0].text);
}

function parseAIResponse(rawText) {
  // 嘗試直接 parse
  try {
    return JSON.parse(rawText);
  } catch (e) {
    // 嘗試從 markdown code block 中萃取
    const match = rawText.match(/```json\s*([\s\S]*?)\s*```/);
    if (match) {
      return JSON.parse(match[1]);
    }
    throw new Error(`AI 回傳不是合法 JSON：${rawText.substring(0, 200)}`);
  }
}

function buildFullPrompt(systemPrompt, userInput, attachedText) {
  let prompt = systemPrompt + '\n\n[USER INPUT]\n\n[使用者指令]:\n' + userInput;
  if (attachedText && attachedText.trim()) {
    prompt += '\n\n[附加文字內容]:\n' + attachedText;
  }
  return prompt;
}
```

---

## 四、執行引擎

### 4.1 執行流程程式碼

```javascript
// admin-ai-tasks/taskExecutor.js

const cancelledTaskIds = new Set();

async function executeTask(taskId) {
  try {
    // 1. 取得任務詳情
    const task = await fetchTask(taskId);
    
    // 2. 標記為 running
    await updateTaskStatus(taskId, 'running');
    
    // 3. 取得對應模組的 system prompt
    const moduleConfig = MOD_BUTTONS.find(m => m.code === task.module_code);
    if (!moduleConfig.available) {
      throw new Error(`模組 ${task.module_code} 尚未建置`);
    }
    
    const systemPrompt = await fetchModulePrompt(task.module_code);
    
    // 4. 呼叫 AI 取得計畫（這一步在 sendChatMessage 已完成，task.ai_response 已存在）
    const plan = task.ai_response;
    
    // 5. 逐項執行子任務
    const artifacts = [];
    const total = plan.tasks.length;
    
    for (let i = 0; i < total; i++) {
      // 檢查取消
      if (cancelledTaskIds.has(taskId)) {
        await updateTaskStatus(taskId, 'cancelled', { artifacts_created: artifacts });
        return;
      }
      
      const subtask = plan.tasks[i];
      
      // 更新進度
      updateTaskProgress(taskId, i, total);
      
      try {
        // 呼叫對應模組 API
        const artifact = await callModuleApi(moduleConfig, subtask);
        artifacts.push(artifact);
      } catch (subErr) {
        // 單個子任務失敗：記錄但繼續執行其他
        artifacts.push({ 
          type: 'error', 
          subtask: subtask, 
          error: subErr.message 
        });
      }
    }
    
    // 6. 完成
    const hasErrors = artifacts.some(a => a.type === 'error');
    await updateTaskStatus(
      taskId, 
      hasErrors ? 'failed' : 'completed',
      { 
        artifacts_created: artifacts,
        error_message: hasErrors ? '部分子任務失敗' : null,
      }
    );
    
  } catch (err) {
    await updateTaskStatus(taskId, 'failed', { error_message: err.message });
  }
}

async function callModuleApi(moduleConfig, subtask) {
  const response = await fetch(moduleConfig.api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subtask),
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 呼叫失敗 (${response.status})：${errText}`);
  }
  
  const result = await response.json();
  return {
    type: subtask.type || 'unknown',
    id: result.data?.id,
    name: result.data?.name_zh || result.data?.code || '已建立',
  };
}

async function updateTaskStatus(taskId, status, extras = {}) {
  await fetch(`/api/ai-console/tasks/${taskId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, ...extras }),
  });
}
```

### 4.2 並發控制

**同時執行的任務上限：1 個**

理由：
- 多個任務同時呼叫 Gemini 會超出 free tier rate limit
- 本地 GEMMA 的硬體（GTX 1650 4GB）也只能跑一個
- Uria 的工作流程是「一次想清楚再下一個」，不會真的需要平行

**實作方式：**

```javascript
let runningTaskId = null;

async function startTaskExecution(taskId) {
  if (runningTaskId) {
    // 已有任務在跑：將新任務加入佇列
    await updateTaskStatus(taskId, 'queued');
    return;
  }
  
  runningTaskId = taskId;
  try {
    await executeTask(taskId);
  } finally {
    runningTaskId = null;
    
    // 處理下一個排隊的
    const nextQueued = await fetchNextQueuedTask();
    if (nextQueued) {
      startTaskExecution(nextQueued.id);
    }
  }
}
```

---

## 五、聊天主流程整合

### 5.1 送出訊息的完整邏輯

```javascript
// admin-ai-console.js

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const userText = input.value.trim();
  
  // 守門
  if (!userText) {
    alert('請輸入指令');
    return;
  }
  if (!selectedModule) {
    alert('請先選擇要使用的模組');
    flashModuleButtons();
    return;
  }
  if (!currentMode) {
    alert('當前無可用 AI 模型');
    return;
  }
  
  // 渲染使用者訊息
  appendChatMessage('user', userText, attachedFiles);
  
  // 清空輸入
  input.value = '';
  const filesSnapshot = [...attachedFiles];
  attachedFiles = [];
  renderAttachedFileTags();
  
  // 組合附加文字
  const attachedText = filesSnapshot.map(f => 
    `===== ${f.name} =====\n${f.content}`
  ).join('\n\n');
  
  // 顯示「AI 思考中」
  const thinkingId = appendChatMessage('ai_thinking', '思考中...');
  
  try {
    // 取得對應模組的 system prompt
    const systemPrompt = await fetchModulePrompt(selectedModule.code);
    
    // 呼叫 AI 取得計畫
    const plan = await callAI(systemPrompt, userText, attachedText);
    
    // 移除「思考中」
    removeChatMessage(thinkingId);
    
    // 渲染計畫
    appendChatMessage('ai_plan', formatPlan(plan), null, {
      onConfirm: () => confirmAndExecute(plan, userText, attachedText, filesSnapshot),
      onCancel: () => appendChatMessage('system', '已取消'),
    });
    
  } catch (err) {
    removeChatMessage(thinkingId);
    appendChatMessage('system', `❌ AI 呼叫失敗：${err.message}`);
  }
}

async function confirmAndExecute(plan, userText, attachedText, filesSnapshot) {
  // 建立任務
  const response = await fetch('/api/ai-console/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module_code: selectedModule.code,
      user_prompt: userText,
      attached_text: attachedText,
      ai_model: currentMode === 'local' ? 'gemma-4-e2b' : 'gemini-2.5-pro',
    }),
  });
  
  const newTask = (await response.json()).data;
  
  // 將 plan 寫入 task.ai_response
  await fetch(`/api/ai-console/tasks/${newTask.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'queued',
      ai_response: plan,
    }),
  });
  
  appendChatMessage('system', `✓ 任務已建立（${newTask.id}），開始執行...`);
  
  // 開始執行
  startTaskExecution(newTask.id);
}

function formatPlan(plan) {
  let html = `<div class="plan-summary"><strong>${plan.plan_summary}</strong></div>`;
  html += `<div class="plan-count">預計建立：${plan.estimated_count} 項</div>`;
  
  if (plan.warnings && plan.warnings.length > 0) {
    html += '<div class="plan-warnings">';
    plan.warnings.forEach(w => {
      html += `<div class="warning">⚠ ${w}</div>`;
    });
    html += '</div>';
  }
  
  html += '<details class="plan-details"><summary>查看詳細任務清單</summary><ol>';
  plan.tasks.forEach(t => {
    html += `<li>${t.name_zh || t.type}</li>`;
  });
  html += '</ol></details>';
  
  return html;
}
```

---

## 六、錯誤處理策略

### 6.1 錯誤分類

| 錯誤類型 | 處理方式 |
|---------|---------|
| AI 不可達（本地/遠端皆失敗） | 顯示錯誤訊息 + 提示重新偵測 |
| AI 回傳非 JSON | 顯示原始回傳前 200 字 + 提示重試 |
| AI 回傳 JSON 但 schema 不符 | 顯示具體缺失欄位 + 提示重試 |
| 模組 API 4xx 錯誤 | 記錄到任務的 error_message，繼續其他子任務 |
| 模組 API 5xx 錯誤 | 同上，但提示「伺服器暫時錯誤，建議重試」 |
| Token 超限 | 阻止送出 + 提示切割文字或切換 Gemini |
| 並發限制 | 自動排隊，不顯示錯誤 |

### 6.2 失敗任務的處理

失敗任務不會自動重試（避免無限迴圈）。Uria 必須：
1. 點開錯誤訊息查看原因
2. 自行決定是否「重試」（會建立新任務複製設定）
3. 或直接刪除任務

### 6.3 部分成功的處理

如果一個任務有 5 個子任務，其中 3 個成功 2 個失敗：
- 任務狀態：`failed`（任何失敗都標 failed，避免假象）
- `artifacts_created` 包含成功的 3 個 + 失敗的 2 個錯誤紀錄
- 任務卡片顯示「3 / 5 成功，2 個失敗」
- 重試按鈕只重試失敗的部分（進階功能，可選實作）

---

## 七、給 Claude Code 的最終提醒

### 7.1 撰寫各模組 system prompt 時必須做的事

**對每個模組：**

1. 讀取對應的 MOD 指令文件（Part 1 / Part 2 / Part 3）
2. 從 Schema 章節抄出**必填欄位清單**
3. 從規則書找到對應章節，摘要**該模組相關的規則**（控制在 500 字內）
4. 從 API 章節抄出**JSON 輸出格式範例**
5. 列出該模組的**常見錯誤點**（例如 commit_icons vs attribute_modifiers）

**禁止：**
- 自行推測欄位名稱
- 自行推測 enum 值
- 自行推測 API endpoint
- 將「通用 TCG 知識」寫進 system prompt

### 7.2 完成後的整體驗證

- [ ] 三份 prompts 檔案（mod-01 到 mod-11）都已建立
- [ ] 每份 prompt 都引用了具體的規則書章節
- [ ] 範例 JSON 中的 enum 值都與資料庫 Schema 一致
- [ ] 端到端測試：在 chat 輸入「設計一張深潛者主題卡片」→ AI 回傳合法 plan → 確認執行 → 卡片成功寫入 DB → 在 MOD-01 卡片設計器看得到
- [ ] 端到端測試（失敗情境）：故意輸入「設計一張 explorer 陣營卡片」→ AI 應該拒絕或矯正為合法陣營
- [ ] 取消按鈕能在執行中停止
- [ ] 重試按鈕能複製設定建立新任務

### 7.3 不在本三份指令文件範圍內的事

- **不需要建置 MOD-06 / MOD-07**：這兩個按鈕顯示為 disabled
- **不需要修改既有 11 個模組的 API**：本模組是消費者，沿用既有端點
- **不需要實作即時 WebSocket**：每 2 秒輪詢已足夠
- **不需要支援檔案以外的附件**：純文字即可，圖片留待未來

---

## 八、Part 3 完成檢查項

- [ ] 9 份 system prompt 檔案（mod-01/02/03/04/05/08/09/10/11）已建立
- [ ] AI 呼叫統一介面（`callAI`）支援本地與遠端兩種模式
- [ ] 兩階段執行（規劃 → 確認 → 執行）流程完整
- [ ] 並發控制：同時只跑一個任務
- [ ] 取消、重試、複製重做三個按鈕都能正常運作
- [ ] 錯誤處理涵蓋 7 種錯誤類型
- [ ] Token 估算與超限檢查可運作
- [ ] 端到端測試通過（至少 MOD-01 / MOD-04 兩個模組）

---

## 九、文件版本

| 版本 | 日期 | 變更 |
|------|------|------|
| v1.0 | 2026/04/18 | Part 3 初版 — 模組路由 Prompt、AI 呼叫實作、執行引擎、錯誤處理 |

---

> **本三份指令文件到此結束。**
>
> Claude Code 應依序讀完 Part 1、Part 2、Part 3 後再開始實作。實作順序建議：
> 1. 資料表 + 後端 API（Part 1）
> 2. 前端版面 + 模式偵測（Part 1 + Part 2）
> 3. 任務面板（Part 2）
> 4. AI 呼叫 + 執行引擎（Part 3）
> 5. 9 份 system prompt 撰寫（Part 3，需大量讀取既有 MOD 指令文件）
> 6. 端到端測試
