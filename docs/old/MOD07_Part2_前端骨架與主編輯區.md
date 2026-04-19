# MOD-07 關卡編輯器 · Claude Code 指令 Part 2:前端骨架與主編輯區

> **系列**:MOD-07 實作指令 · 第 2 份 / 共 5 份
> **依據規格**:`MOD07_關卡編輯器_總覽規格_v0_2.md`
> **前置條件**:Part 1 已完成(後端 API 可用)
> **本份產出**:前端 HTML 骨架、11 個分頁切換、左側關卡列表、關卡總覽分頁、場景序列分頁、地點挑選共用對話框
> **執行角色**:Claude Code 依此文件實作檔案變更

---

## 一、任務範圍

本份完成前端骨架層:

- `admin-scenario-editor.html` 從 34 行 stub 改寫為完整單檔
- 整體三欄佈局 + 11 個分頁的 Tab 切換機制
- **關卡總覽分頁**:元資料、所屬章節、進入/通關旗標、人數縮放
- **場景序列分頁**:場景清單、起始場景配置、非起始場景備忘錄
- **地點挑選共用對話框**:支援指定/權重/替換三種模式(供多處使用)

本份**不**包含:目標/議案牌堆(Part 3)、混沌袋/遭遇卡池/神話卡池/怪物家族池(Part 4)、重返覆寫/隨機地城/AI/完整性檢查(Part 5)。

---

## 二、檔案結構總覽

修改的檔案:

- `packages/client/public/admin/admin-scenario-editor.html`(從 34 行 stub 改寫,目標約 1800–2200 行,預期比 MOD-06 更大)
- 新增:`packages/client/public/admin/data/stage-options.json`(選項資料)
- 新增:`packages/client/public/admin/data/map-operations-options.json`(供 Part 3 使用,本份先建立空檔案)

---

## 三、HTML 檔案頂部結構

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>關卡編輯器 | UG 後台</title>
  <link rel="stylesheet" href="admin-shared.css">
  <style>
    /* 本模組專屬樣式,見 §6 */
  </style>
</head>
<body>
  <nav class="admin-nav">
    <a href="index.html" class="nav-back">← 後台首頁</a>
    <h1>關卡編輯器 <span class="mod-code">MOD-07</span></h1>
    <div class="nav-right">
      <button id="ai-key-status" onclick="promptApiKey()">⚠️ 未設定</button>
      <button onclick="openModuleHelp('MOD-07')">說明</button>
      <span id="current-user"></span>
      <button onclick="adminLogout()">登出</button>
    </div>
  </nav>

  <div class="layout-container">
    <aside id="left-panel" class="left-panel">...</aside>
    <main id="main-panel" class="main-panel">...</main>
    <aside id="right-panel" class="right-panel">...</aside>
  </div>

  <div id="dialogs-root"></div>

  <script src="admin-shared.js"></script>
  <script>
    /* inline JS,見 §5 */
  </script>
</body>
</html>
```

---

## 四、左側關卡列表區

### 4.1 HTML

```html
<aside id="left-panel" class="left-panel">
  <div class="panel-header">
    <h2>關卡列表</h2>
    <button class="btn-primary" onclick="openCreateStageDialog()">＋ 新關卡</button>
  </div>

  <div class="panel-filters">
    <input type="search" id="stage-search" placeholder="搜尋關卡…" oninput="renderStageList()">
    <select id="stage-type-filter" onchange="renderStageList()">
      <option value="">全部類型</option>
      <option value="main">主線</option>
      <option value="side">預設支線</option>
      <option value="side_return">支線重返版</option>
      <option value="side_random">隨機地城</option>
    </select>
    <select id="stage-chapter-filter" onchange="renderStageList()">
      <option value="">全部章節</option>
      <!-- 動態填入 -->
    </select>
    <select id="stage-status-filter" onchange="renderStageList()">
      <option value="">全部狀態</option>
      <option value="draft">草稿</option>
      <option value="review">審核中</option>
      <option value="published">已發佈</option>
    </select>
  </div>

  <div id="stage-list" class="stage-list">
    <!-- 動態渲染,依類型分組 -->
  </div>
</aside>
```

### 4.2 建立關卡對話框

```html
<div id="dialog-create-stage" class="dialog" style="display:none">
  <div class="dialog-content">
    <h3>建立新關卡</h3>

    <label>關卡類型
      <select id="new-stage-type" onchange="onNewStageTypeChange()">
        <option value="main">主線關卡</option>
        <option value="side">預設支線</option>
        <option value="side_return">支線重返版</option>
        <option value="side_random">隨機地城</option>
      </select>
    </label>

    <label>關卡代碼(唯一,建立後不可改)
      <input type="text" id="new-stage-code" placeholder="例:ch1_arrival">
    </label>

    <label>中文名稱
      <input type="text" id="new-stage-name-zh">
    </label>

    <!-- main 才顯示 -->
    <div id="new-stage-chapter-section">
      <label>所屬章節
        <select id="new-stage-chapter">
          <!-- 動態從戰役→章節填入 -->
        </select>
      </label>
    </div>

    <!-- side_return 才顯示 -->
    <div id="new-stage-parent-section" style="display:none">
      <label>原始支線關卡
        <select id="new-stage-parent">
          <!-- 動態填入已存在的 side 類型關卡 -->
        </select>
      </label>
      <label>重返第幾次
        <input type="number" id="new-stage-return-number" min="1" value="1">
      </label>
    </div>

    <div class="dialog-footer">
      <button onclick="closeDialog('create-stage')">取消</button>
      <button class="btn-primary" onclick="confirmCreateStage()">建立</button>
    </div>
  </div>
</div>
```

### 4.3 關卡列表渲染

左側關卡依**類型分組**顯示,並支援從戰役下拉篩選章節:

```javascript
function renderStageList() {
  const search = document.getElementById('stage-search').value.toLowerCase();
  const typeFilter = document.getElementById('stage-type-filter').value;
  const chapterFilter = document.getElementById('stage-chapter-filter').value;
  const statusFilter = document.getElementById('stage-status-filter').value;

  const filtered = currentStageList.filter(s => {
    if (search && !s.name_zh.toLowerCase().includes(search)
              && !s.code.toLowerCase().includes(search)) return false;
    if (typeFilter && s.stage_type !== typeFilter) return false;
    if (chapterFilter && s.chapter_id !== chapterFilter) return false;
    if (statusFilter && s.design_status !== statusFilter) return false;
    return true;
  });

  // 依類型分組
  const groups = {
    main: [],
    side: [],
    side_return: [],
    side_random: []
  };
  filtered.forEach(s => { groups[s.stage_type].push(s); });

  const container = document.getElementById('stage-list');
  container.innerHTML = '';

  for (const [type, list] of Object.entries(groups)) {
    if (list.length === 0) continue;
    const groupEl = document.createElement('div');
    groupEl.className = 'stage-group';
    groupEl.innerHTML = `
      <h4 class="stage-group-header">${stageTypeLabel(type)} (${list.length})</h4>
      <div class="stage-group-items">
        ${list.map(renderStageListItem).join('')}
      </div>
    `;
    container.appendChild(groupEl);
  }
}

function renderStageListItem(stage) {
  const chapterLabel = stage.chapter_name
    ? `<span class="ch-label">第 ${stage.chapter_number} 章</span>`
    : '';
  const activeClass = currentStage?.id === stage.id ? 'active' : '';
  return `
    <div class="stage-item ${activeClass}" onclick="selectStage('${stage.id}')">
      <div class="stage-name">${escapeHtml(stage.name_zh)}</div>
      <div class="stage-meta">
        ${chapterLabel}
        <code>${escapeHtml(stage.code)}</code>
        <span class="status-${stage.design_status}">${statusLabel(stage.design_status)}</span>
      </div>
    </div>
  `;
}
```

---

## 五、主編輯區(11 個分頁)

### 5.1 分頁標籤列

```html
<main id="main-panel" class="main-panel">
  <div id="no-stage-placeholder" class="placeholder">
    <p>請從左側選擇關卡,或建立新關卡。</p>
  </div>

  <div id="stage-editor" class="stage-editor" style="display:none">
    <div class="editor-header">
      <h2 id="editor-title"></h2>
      <div class="editor-meta">
        <span id="editor-type-badge"></span>
        <span id="editor-status-badge"></span>
        <span id="editor-version"></span>
      </div>
    </div>

    <nav class="tab-bar">
      <button class="tab-btn active" data-tab="overview">關卡總覽</button>
      <button class="tab-btn" data-tab="scenarios">場景序列</button>
      <button class="tab-btn" data-tab="act-cards">目標牌堆</button>
      <button class="tab-btn" data-tab="agenda-cards">議案牌堆</button>
      <button class="tab-btn" data-tab="encounter-pool">遭遇卡池</button>
      <button class="tab-btn" data-tab="mythos-pool">神話卡池</button>
      <button class="tab-btn" data-tab="chaos-bag">混沌袋配置</button>
      <button class="tab-btn" data-tab="monster-pool">怪物家族池</button>
      <button class="tab-btn tab-conditional" data-tab="return-overrides" data-stage-type="side_return">重返覆寫</button>
      <button class="tab-btn tab-conditional" data-tab="random-generator" data-stage-type="side_random">隨機地城規則</button>
      <button class="tab-btn" data-tab="completeness">完整性檢查</button>
    </nav>

    <div class="tab-content-container">
      <section id="tab-overview" class="tab-content active"><!-- 本份 --></section>
      <section id="tab-scenarios" class="tab-content"><!-- 本份 --></section>
      <section id="tab-act-cards" class="tab-content"><!-- Part 3 --></section>
      <section id="tab-agenda-cards" class="tab-content"><!-- Part 3 --></section>
      <section id="tab-encounter-pool" class="tab-content"><!-- Part 4 --></section>
      <section id="tab-mythos-pool" class="tab-content"><!-- Part 4 --></section>
      <section id="tab-chaos-bag" class="tab-content"><!-- Part 4 --></section>
      <section id="tab-monster-pool" class="tab-content"><!-- Part 4 --></section>
      <section id="tab-return-overrides" class="tab-content"><!-- Part 5 --></section>
      <section id="tab-random-generator" class="tab-content"><!-- Part 5 --></section>
      <section id="tab-completeness" class="tab-content"><!-- Part 5 --></section>
    </div>
  </div>
</main>
```

### 5.2 條件式分頁顯示

```javascript
function updateConditionalTabs() {
  if (!currentStage) return;
  document.querySelectorAll('.tab-conditional').forEach(btn => {
    const requiredType = btn.dataset.stageType;
    btn.style.display = currentStage.stage_type === requiredType ? '' : 'none';
  });
}
```

每次 `selectStage()` 後呼叫 `updateConditionalTabs()`。

### 5.3 分頁切換函式

```javascript
function switchTab(tabName) {
  if (dirty && !confirm('有未儲存變更,要放棄嗎?')) return;

  currentTab = tabName;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(sec => {
    sec.classList.toggle('active', sec.id === `tab-${tabName}`);
  });

  switch (tabName) {
    case 'overview': renderOverviewTab(); break;
    case 'scenarios': renderScenariosTab(); break;
    case 'act-cards': renderActCardsTab(); break;             // Part 3
    case 'agenda-cards': renderAgendaCardsTab(); break;       // Part 3
    case 'encounter-pool': renderEncounterPoolTab(); break;   // Part 4
    case 'mythos-pool': renderMythosPoolTab(); break;         // Part 4
    case 'chaos-bag': renderChaosBagTab(); break;             // Part 4
    case 'monster-pool': renderMonsterPoolTab(); break;       // Part 4
    case 'return-overrides': renderReturnOverridesTab(); break; // Part 5
    case 'random-generator': renderRandomGeneratorTab(); break; // Part 5
    case 'completeness': renderCompletenessTab(); break;      // Part 5
  }

  updateRightPanel();
}
```

---

## 六、關卡總覽分頁(`#tab-overview`)

### 6.1 分頁結構

```html
<section id="tab-overview" class="tab-content">
  <section class="editor-section">
    <h3>基礎資料</h3>
    <label>關卡代碼 <input type="text" id="stage-code" readonly></label>
    <label>中文名稱 <input type="text" id="stage-name-zh"></label>
    <label>英文名稱 <input type="text" id="stage-name-en">
      <button type="button" onclick="aiTranslate('stage-name-zh', 'stage-name-en')">中譯英</button>
    </label>
    <label>敘事定位
      <textarea id="stage-narrative" rows="4"></textarea>
    </label>
    <label>設計狀態
      <select id="stage-design-status">
        <option value="draft">草稿</option>
        <option value="review">審核中</option>
        <option value="published">已發佈</option>
      </select>
    </label>
  </section>

  <!-- 主線才顯示 -->
  <section class="editor-section" id="section-chapter-binding">
    <h3>章節綁定</h3>
    <label>戰役
      <select id="stage-campaign" onchange="onCampaignChangeForStage()">
        <option value="">(選擇戰役)</option>
      </select>
    </label>
    <label>所屬章節
      <select id="stage-chapter">
        <option value="">(先選擇戰役)</option>
      </select>
    </label>
  </section>

  <!-- 主線才顯示:進入所需旗標 -->
  <section class="editor-section" id="section-entry-condition">
    <h3>進入所需旗標</h3>
    <label class="checkbox-label">
      <input type="checkbox" id="has-entry-condition" onchange="toggleEntryCondition()">
      有進入條件(否則無條件可進入)
    </label>
    <div id="entry-condition-editor" style="display:none">
      <!-- 條件表達式編輯器(共用元件,MOD-06 Part 3 已有實作;本模組引用或複製) -->
    </div>
  </section>

  <!-- 主線才顯示:通關授予旗標 -->
  <section class="editor-section" id="section-completion-flags">
    <h3>通關授予旗標</h3>
    <p class="hint">通關時將以下旗標寫入戰役 Campaign Log</p>
    <div id="completion-flags-multiselect">
      <!-- 從戰役旗標字典多選 -->
    </div>
  </section>

  <!-- 支線才顯示:簽名卡 -->
  <section class="editor-section" id="section-side-signature">
    <h3>支線專屬簽名卡</h3>
    <p class="hint">首次通關時授予;重返時不再給予</p>
    <select id="stage-signature-card">
      <option value="">(無簽名卡)</option>
      <!-- 從 MOD-01 卡片庫篩選簽名卡類別 -->
    </select>
  </section>

  <!-- 人數縮放 -->
  <section class="editor-section">
    <h3>人數縮放規則</h3>
    <div class="scaling-grid">
      <label>每玩家加成敵人 HP
        <input type="number" id="scale-enemy-hp" step="0.1" min="0" max="2" value="0">
      </label>
      <label>線索縮放倍數
        <input type="number" id="scale-clues" step="0.1" min="0" max="2" value="1">
      </label>
      <label>遭遇卡抽取數(1/2/3/4 人)
        <div class="encounter-draws-grid">
          <input type="number" id="scale-enc-1p" min="0" max="5" value="1" placeholder="1P">
          <input type="number" id="scale-enc-2p" min="0" max="5" value="1" placeholder="2P">
          <input type="number" id="scale-enc-3p" min="0" max="5" value="2" placeholder="3P">
          <input type="number" id="scale-enc-4p" min="0" max="5" value="2" placeholder="4P">
        </div>
      </label>
    </div>
  </section>

  <div class="editor-footer">
    <button class="btn-primary" onclick="saveStage()">儲存關卡</button>
    <button onclick="exportStageJSON()">匯出 JSON</button>
    <button class="btn-danger" onclick="deleteStage()">刪除關卡</button>
  </div>
</section>
```

### 6.2 條件顯示區塊

依 `currentStage.stage_type` 顯示/隱藏:

```javascript
function applySectionVisibility() {
  if (!currentStage) return;
  const type = currentStage.stage_type;

  document.getElementById('section-chapter-binding').style.display =
    (type === 'main') ? '' : 'none';
  document.getElementById('section-entry-condition').style.display =
    (type === 'main' || type === 'side' || type === 'side_random') ? '' : 'none';
  document.getElementById('section-completion-flags').style.display =
    (type === 'main') ? '' : 'none';
  document.getElementById('section-side-signature').style.display =
    (type === 'side') ? '' : 'none';
}
```

### 6.3 戰役→章節聯動下拉

```javascript
async function loadCampaignsForStageDropdown() {
  const res = await adminFetch('/api/campaigns');
  const campaigns = await res.json();
  const select = document.getElementById('stage-campaign');
  select.innerHTML = '<option value="">(選擇戰役)</option>';
  campaigns.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name_zh} (${c.code})`;
    select.appendChild(opt);
  });
}

async function onCampaignChangeForStage() {
  const campaignId = document.getElementById('stage-campaign').value;
  const chapterSelect = document.getElementById('stage-chapter');
  chapterSelect.innerHTML = '<option value="">(先選擇戰役)</option>';
  if (!campaignId) return;

  const res = await adminFetch(`/api/campaigns/${campaignId}/chapters`);
  const chapters = await res.json();
  chapters.forEach(ch => {
    const opt = document.createElement('option');
    opt.value = ch.id;
    opt.textContent = `第 ${ch.chapter_number} 章 — ${ch.name_zh}`;
    chapterSelect.appendChild(opt);
  });

  // 載入該戰役旗標字典(供進入條件、通關授予旗標使用)
  await loadCampaignFlags(campaignId);
}

async function loadCampaignFlags(campaignId) {
  const res = await adminFetch(`/api/campaigns/${campaignId}/flags`);
  currentCampaignFlags = await res.json();
  // 重新渲染依賴此字典的區塊
  renderCompletionFlagsMultiselect();
  renderEntryConditionEditor();
}
```

---

## 七、場景序列分頁(`#tab-scenarios`)

### 7.1 分頁結構

```html
<section id="tab-scenarios" class="tab-content">
  <div class="scenarios-layout">
    <!-- 左側:場景清單 -->
    <div class="scenarios-nav">
      <button class="btn-primary" onclick="addScenario()">＋ 新增場景</button>
      <div id="scenarios-list"></div>
    </div>

    <!-- 右側:當前場景編輯 -->
    <div class="scenario-editor" id="scenario-editor-container">
      <div class="placeholder">請選擇場景</div>
    </div>
  </div>
</section>
```

### 7.2 場景清單項目

每個場景一列,顯示:
- 場景順序 + 名稱
- 「起始場景」徽章(`scenario_order = 1`)
- 「備忘錄」徽章(`scenario_order > 1`)
- 操作按鈕:編輯、上下移、刪除

```javascript
function renderScenariosList() {
  const list = document.getElementById('scenarios-list');
  if (!currentStage.scenarios?.length) {
    list.innerHTML = '<p class="empty">尚未新增場景,請點擊上方「＋ 新增場景」</p>';
    return;
  }

  list.innerHTML = currentStage.scenarios.map((s, idx) => `
    <div class="scenario-item ${currentScenario?.id === s.id ? 'active' : ''}"
         onclick="selectScenario('${s.id}')">
      <div class="scenario-header">
        <span class="scenario-order">#${s.scenario_order}</span>
        ${s.scenario_order === 1
          ? '<span class="badge badge-starting">起始場景</span>'
          : '<span class="badge badge-memo">備忘錄</span>'}
        <span class="scenario-name">${escapeHtml(s.name_zh || '(未命名)')}</span>
      </div>
      <div class="scenario-actions">
        ${idx > 0 ? `<button onclick="moveScenario('${s.id}', -1); event.stopPropagation()">↑</button>` : ''}
        ${idx < currentStage.scenarios.length - 1 ? `<button onclick="moveScenario('${s.id}', 1); event.stopPropagation()">↓</button>` : ''}
        <button onclick="deleteScenario('${s.id}'); event.stopPropagation()" class="btn-danger">🗑</button>
      </div>
    </div>
  `).join('');
}
```

### 7.3 場景編輯區

```html
<div class="scenario-editor">
  <section class="editor-section">
    <h3>場景基本資料</h3>
    <label>場景名稱(中文)
      <input type="text" id="sc-name-zh">
    </label>
    <label>場景名稱(英文)
      <input type="text" id="sc-name-en">
    </label>
    <label>場景敘事
      <textarea id="sc-narrative" rows="4"></textarea>
      <button type="button" onclick="aiGenerateSceneNarrative()">AI 生成</button>
    </label>
  </section>

  <!-- 僅起始場景顯示 -->
  <section class="editor-section" id="sc-starting-section">
    <h3>起始場景配置</h3>

    <div class="sc-subsection">
      <h4>初始地點</h4>
      <div id="sc-initial-locations-list"></div>
      <button type="button" onclick="openLocationPicker('scenario-initial')">
        ＋ 挑選地點
      </button>
    </div>

    <div class="sc-subsection">
      <h4>初始連接關係</h4>
      <p class="hint">覆寫地點自身的 connections,在此定義關卡中的連接</p>
      <div id="sc-initial-connections-editor"></div>
      <button type="button" onclick="addConnection()">＋ 新增連接</button>
    </div>

    <div class="sc-subsection">
      <h4>調查員進場地點</h4>
      <select id="sc-spawn-location">
        <option value="">(選擇地點)</option>
        <!-- 僅顯示 initial_location_codes 中的地點 -->
      </select>
    </div>

    <div class="sc-subsection">
      <h4>初始環境</h4>
      <div class="environment-editor">
        <label>預設光照
          <select id="sc-env-default-light">
            <option value="day">白天(全亮)</option>
            <option value="night">夜間(僅光源照明)</option>
          </select>
        </label>
        <div id="sc-env-lights"></div>
        <button type="button" onclick="addLightSource()">＋ 指定光源地點</button>
        <div id="sc-env-fires"></div>
        <button type="button" onclick="addFireLocation()">＋ 指定失火地點</button>
      </div>
    </div>

    <div class="sc-subsection">
      <h4>初始怪物</h4>
      <div id="sc-initial-enemies-editor"></div>
      <button type="button" onclick="addInitialEnemy()">＋ 新增怪物</button>
    </div>
  </section>

  <!-- 非起始場景顯示 -->
  <section class="editor-section" id="sc-memo-section" style="display:none">
    <h3>場景備忘錄</h3>
    <p class="hint">此場景代表關卡推進後的地圖狀態快照,供設計師與 AI 參考。
    實際切換由目標卡或議案卡背面的地圖操作指令觸發。</p>

    <div class="sc-subsection">
      <h4>預期地點組合</h4>
      <div id="sc-memo-locations-list"></div>
      <button type="button" onclick="openLocationPicker('scenario-memo')">
        ＋ 加入地點(預期)
      </button>
    </div>

    <div class="sc-subsection">
      <h4>預期怪物配置</h4>
      <p class="hint">僅為備忘,實際生成由目標/議案背面指令指定</p>
      <div id="sc-memo-enemies-editor"></div>
    </div>
  </section>

  <div class="editor-footer">
    <button class="btn-primary" onclick="saveScenario()">儲存場景</button>
  </div>
</div>
```

### 7.4 起始/備忘錄切換顯示

```javascript
function applyScenarioMode() {
  if (!currentScenario) return;
  const isStarting = currentScenario.scenario_order === 1;
  document.getElementById('sc-starting-section').style.display = isStarting ? '' : 'none';
  document.getElementById('sc-memo-section').style.display = isStarting ? 'none' : '';
}
```

### 7.5 連接關係編輯

連接關係的 JSON 結構:

```json
[
  { "from": "mansion_hall", "to": "mansion_library", "cost": 1 },
  { "from": "mansion_library", "to": "secret_passage", "cost": 2 }
]
```

每條連接一列,三個欄位:地點 A 下拉、地點 B 下拉、移動成本。

### 7.6 初始怪物配置

```json
[
  { "family_code": "cthulhu_spawn", "tier": "threat", "location_code": "mansion_hall", "count": 2 },
  { "family_code": "deep_one", "tier": "minion", "location_code": "mansion_library", "count": 1 }
]
```

每筆一列,四個欄位:家族下拉、位階下拉、地點下拉、數量。

### 7.7 場景儲存

```javascript
async function saveScenario() {
  if (!currentScenario) return;

  const payload = {
    name_zh: document.getElementById('sc-name-zh').value,
    name_en: document.getElementById('sc-name-en').value,
    narrative: document.getElementById('sc-narrative').value,
    initial_location_codes: collectInitialLocationCodes(),
    initial_connections: collectConnections(),
    investigator_spawn_location: document.getElementById('sc-spawn-location').value || null,
    initial_environment: collectEnvironment(),
    initial_enemies: collectInitialEnemies()
  };

  const res = await adminFetch(`/api/scenarios/${currentScenario.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json();
    showToast('儲存失敗:' + err.error, 'error');
    return;
  }
  await reloadStage();
  showToast('場景已儲存', 'success');
}
```

---

## 八、地點挑選共用對話框

### 8.1 三種模式

- **指定模式(`mode: 'single_list'`)**:選擇多個具體地點(用於場景初始地點)
- **權重模式(`mode: 'weighted_list'`)**:選擇地點 + 為每個設定權重(用於隨機地城地點池)
- **替換模式(`mode: 'replace'`)**:選定一個原地點,指定替換為哪個新地點(用於重返覆寫)

### 8.2 HTML 對話框

```html
<div id="dialog-location-picker" class="dialog dialog-large" style="display:none">
  <div class="dialog-content">
    <h3 id="loc-picker-title">挑選地點</h3>
    <p id="loc-picker-hint" class="hint"></p>

    <div class="loc-picker-toolbar">
      <input type="search" id="loc-picker-search" placeholder="搜尋地點…" oninput="filterLocationPicker()">
      <select id="loc-picker-scale-filter" onchange="filterLocationPicker()">
        <option value="">全部尺度</option>
        <option value="room">房間級</option>
        <option value="block">街區級</option>
        <option value="city">城市級</option>
        <option value="intercontinental">跨國級</option>
      </select>
      <select id="loc-picker-tag-filter" onchange="filterLocationPicker()">
        <option value="">全部標籤</option>
        <!-- 動態填入 -->
      </select>
    </div>

    <div id="loc-picker-list" class="loc-picker-list">
      <!-- 動態渲染地點卡 -->
    </div>

    <div class="loc-picker-footer">
      <div id="loc-picker-selected-summary"></div>
      <div>
        <button onclick="closeDialog('location-picker')">取消</button>
        <button class="btn-primary" onclick="confirmLocationPicker()">確認挑選</button>
      </div>
    </div>
  </div>
</div>
```

### 8.3 呼叫 API

```javascript
let locPickerContext = null;  // 記錄當前呼叫者

function openLocationPicker(context, options = {}) {
  locPickerContext = {
    caller: context,      // 例:'scenario-initial', 'random-dungeon-pool', 'return-override'
    mode: options.mode || 'single_list',
    currentSelection: options.currentSelection || [],
    onConfirm: options.onConfirm   // 回調函式
  };

  // 設定 UI
  document.getElementById('loc-picker-title').textContent = options.title || '挑選地點';
  document.getElementById('loc-picker-hint').textContent = options.hint || '';

  loadAllLocations().then(() => {
    renderLocationPickerList();
    openDialog('location-picker');
  });
}

async function loadAllLocations() {
  if (allLocationsCache) return allLocationsCache;
  const res = await adminFetch('/api/admin/locations');
  allLocationsCache = await res.json();
  return allLocationsCache;
}

function renderLocationPickerList() {
  const mode = locPickerContext.mode;
  const selected = new Set(locPickerContext.currentSelection.map(s =>
    typeof s === 'string' ? s : s.code
  ));

  const filtered = applyLocationPickerFilters(allLocationsCache);
  const list = document.getElementById('loc-picker-list');
  list.innerHTML = filtered.map(loc => `
    <div class="loc-card ${selected.has(loc.code) ? 'selected' : ''}"
         onclick="toggleLocationPick('${loc.code}')">
      ${renderLocationCardContent(loc, mode, selected.has(loc.code))}
    </div>
  `).join('');
}

function renderLocationCardContent(loc, mode, isSelected) {
  let extra = '';
  if (mode === 'weighted_list' && isSelected) {
    const currentWeight = getLocationWeight(loc.code) || 1;
    extra = `
      <label class="weight-input" onclick="event.stopPropagation()">
        權重 <input type="number" min="1" max="10" value="${currentWeight}"
          onchange="setLocationWeight('${loc.code}', this.value)">
      </label>
    `;
  }
  return `
    <div class="loc-card-header">
      <strong>${escapeHtml(loc.name_zh)}</strong>
      <code>${escapeHtml(loc.code)}</code>
    </div>
    <div class="loc-card-body">
      <span>尺度:${scaleLabel(loc.scale)}</span>
      <span>DC:${loc.shroud}</span>
      <span>線索:${loc.clues_base}</span>
    </div>
    ${extra}
  `;
}

function toggleLocationPick(code) {
  const mode = locPickerContext.mode;
  if (mode === 'replace') {
    // 替換模式:單選
    locPickerContext.currentSelection = [{ code, weight: 1 }];
  } else {
    // 多選
    const existing = locPickerContext.currentSelection.find(s =>
      (typeof s === 'string' ? s : s.code) === code
    );
    if (existing) {
      locPickerContext.currentSelection = locPickerContext.currentSelection.filter(s =>
        (typeof s === 'string' ? s : s.code) !== code
      );
    } else {
      if (mode === 'weighted_list') {
        locPickerContext.currentSelection.push({ code, weight: 1 });
      } else {
        locPickerContext.currentSelection.push(code);
      }
    }
  }
  renderLocationPickerList();
  updateLocationPickerSummary();
}

function confirmLocationPicker() {
  if (locPickerContext.onConfirm) {
    locPickerContext.onConfirm(locPickerContext.currentSelection);
  }
  closeDialog('location-picker');
}
```

### 8.4 場景初始地點的使用範例

```javascript
function openLocationPickerForScenarioInitial() {
  openLocationPicker('scenario-initial', {
    mode: 'single_list',
    title: '挑選場景初始地點',
    hint: '選擇此場景開始時上桌的地點(可多選)',
    currentSelection: currentScenario.initial_location_codes || [],
    onConfirm: (selection) => {
      currentScenario.initial_location_codes = selection;
      renderSelectedLocations();
      markDirty();
    }
  });
}
```

---

## 九、inline JS 狀態管理

### 9.1 全域狀態變數

```javascript
let currentStageList = [];        // 左側關卡列表
let currentStage = null;          // 當前選中的關卡
let currentScenario = null;       // 當前選中的場景
let currentTab = 'overview';      // 當前分頁
let currentCampaignFlags = [];    // 當前關卡所屬戰役的旗標字典
let allLocationsCache = null;     // 地點快取(首次載入後保留)
let stageOptions = null;          // 選項資料
let dirty = false;
```

### 9.2 初始化

```javascript
async function init() {
  if (!checkAdminAuth()) return;
  displayCurrentUser();

  await loadStageOptions();
  await loadStageList();
  await loadCampaignsForStageDropdown();

  bindTabSwitcher();
  bindBeforeUnloadWarning();

  updateApiKeyStatus();
}

window.addEventListener('DOMContentLoaded', init);
```

### 9.3 關卡載入與選擇

```javascript
async function loadStageList() {
  const res = await adminFetch('/api/stages');
  currentStageList = await res.json();
  renderStageList();
}

async function selectStage(stageId) {
  if (dirty && !confirm('有未儲存變更,要放棄嗎?')) return;
  const res = await adminFetch(`/api/stages/${stageId}`);
  currentStage = await res.json();

  // 若為主線,載入對應章節所屬戰役的旗標字典
  if (currentStage.stage_type === 'main' && currentStage.chapter_id) {
    const chRes = await adminFetch(`/api/chapters/${currentStage.chapter_id}`);
    const chapter = await chRes.json();
    await loadCampaignFlags(chapter.campaign_id);
  }

  // 顯示編輯區
  document.getElementById('no-stage-placeholder').style.display = 'none';
  document.getElementById('stage-editor').style.display = '';
  document.getElementById('editor-title').textContent = currentStage.name_zh;
  document.getElementById('editor-type-badge').textContent = stageTypeLabel(currentStage.stage_type);

  updateConditionalTabs();
  applySectionVisibility();
  switchTab('overview');
  renderStageList();
  updateRightPanel();
}

async function reloadStage() {
  if (!currentStage) return;
  const res = await adminFetch(`/api/stages/${currentStage.id}`);
  currentStage = await res.json();
  clearDirty();
  const currentTabName = currentTab;
  switchTab(currentTabName);
}
```

### 9.4 儲存關卡

```javascript
async function saveStage() {
  if (!currentStage) return;

  const payload = {
    name_zh: document.getElementById('stage-name-zh').value,
    name_en: document.getElementById('stage-name-en').value,
    narrative: document.getElementById('stage-narrative').value,
    design_status: document.getElementById('stage-design-status').value,
    scaling_rules: collectScalingRules()
  };

  if (currentStage.stage_type === 'main') {
    payload.chapter_id = document.getElementById('stage-chapter').value;
    payload.entry_condition = collectEntryCondition();
    payload.completion_flags = collectCompletionFlags();
  } else if (currentStage.stage_type === 'side') {
    payload.entry_condition = collectEntryCondition();
    payload.side_signature_card_id = document.getElementById('stage-signature-card').value || null;
  }

  const res = await adminFetch(`/api/stages/${currentStage.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json();
    alert('儲存失敗:' + (err.error || '未知錯誤'));
    return;
  }
  await loadStageList();
  await reloadStage();
  showToast('關卡已儲存', 'success');
}
```

### 9.5 刪除關卡

```javascript
async function deleteStage() {
  if (!currentStage) return;
  if (!confirm(`確定刪除關卡「${currentStage.name_zh}」?此操作無法還原`)) return;

  const res = await adminFetch(`/api/stages/${currentStage.id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json();
    if (err.dependent_returns) {
      alert(`無法刪除,有以下重返版依賴此關卡:\n\n${err.dependent_returns.map(r => `• ${r.name_zh}`).join('\n')}`);
    } else {
      alert('刪除失敗:' + err.error);
    }
    return;
  }
  currentStage = null;
  document.getElementById('no-stage-placeholder').style.display = '';
  document.getElementById('stage-editor').style.display = 'none';
  await loadStageList();
  showToast('關卡已刪除', 'success');
}
```

---

## 十、右側預覽欄(本份基礎)

```html
<aside id="right-panel" class="right-panel">
  <div class="panel-header">
    <h2>即時預覽</h2>
  </div>
  <div id="preview-content" class="preview-content">
    <p class="placeholder">選擇關卡後顯示預覽</p>
  </div>
</aside>
```

```javascript
function updateRightPanel() {
  const container = document.getElementById('preview-content');
  if (!currentStage) {
    container.innerHTML = '<p class="placeholder">選擇關卡後顯示預覽</p>';
    return;
  }

  switch (currentTab) {
    case 'overview':
      renderStagePreviewCard(container);
      break;
    case 'scenarios':
      renderScenarioMapPreview(container);
      break;
    default:
      container.innerHTML = '<p class="placeholder">此分頁暫無預覽</p>';
  }
}

function renderStagePreviewCard(container) {
  container.innerHTML = `
    <div class="preview-card">
      <h3>${escapeHtml(currentStage.name_zh)}</h3>
      <p class="stage-type">${stageTypeLabel(currentStage.stage_type)}</p>
      <div class="preview-meta">
        <p><strong>代碼:</strong> ${escapeHtml(currentStage.code)}</p>
        ${currentStage.chapter_id ? `<p><strong>章節:</strong> 第 ${currentStage.chapter_number} 章</p>` : ''}
        <p><strong>狀態:</strong> ${statusLabel(currentStage.design_status)}</p>
        <p><strong>版本:</strong> v${currentStage.version}</p>
      </div>
      <hr>
      <p class="narrative">${escapeHtml(currentStage.narrative || '(尚未撰寫敘事)')}</p>
      <hr>
      <h4>結構摘要</h4>
      <ul>
        <li>場景數量:${currentStage.scenarios?.length || 0}</li>
        <li>目標卡:${currentStage.act_cards?.length || 0}</li>
        <li>議案卡:${currentStage.agenda_cards?.length || 0}</li>
        <li>怪物家族:${currentStage.monster_pool?.length || 0}</li>
      </ul>
    </div>
  `;
}
```

### 10.1 SVG 地圖預覽(場景序列分頁時)

```javascript
function renderScenarioMapPreview(container) {
  if (!currentScenario) {
    container.innerHTML = '<p class="placeholder">選擇場景後顯示地圖</p>';
    return;
  }

  const locations = (currentScenario.initial_location_codes || [])
    .map(code => allLocationsCache.find(l => l.code === code))
    .filter(Boolean);

  if (locations.length === 0) {
    container.innerHTML = '<p class="placeholder">場景尚未配置地點</p>';
    return;
  }

  container.innerHTML = `
    <div class="map-preview">
      <h4>場景 #${currentScenario.scenario_order} 地圖</h4>
      <svg id="map-svg" viewBox="0 0 400 400"></svg>
      <p class="hint">節點:地點 · 邊:連接</p>
    </div>
  `;

  const svg = document.getElementById('map-svg');
  drawMapPreview(svg, locations, currentScenario.initial_connections || [],
                 currentScenario.investigator_spawn_location);
}

function drawMapPreview(svg, locations, connections, spawnCode) {
  // 簡單的 Force-directed layout 或環形排列
  const positions = layoutLocations(locations);

  // 畫邊
  connections.forEach(c => {
    const fromPos = positions[c.from];
    const toPos = positions[c.to];
    if (!fromPos || !toPos) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', fromPos.x);
    line.setAttribute('y1', fromPos.y);
    line.setAttribute('x2', toPos.x);
    line.setAttribute('y2', toPos.y);
    line.setAttribute('stroke', '#8b7355');
    line.setAttribute('stroke-width', '2');
    svg.appendChild(line);
  });

  // 畫節點
  locations.forEach(loc => {
    const pos = positions[loc.code];
    const isSpawn = loc.code === spawnCode;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${pos.x},${pos.y})`);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', 20);
    circle.setAttribute('fill', isSpawn ? '#d97706' : '#374151');
    circle.setAttribute('stroke', '#a78b5a');
    circle.setAttribute('stroke-width', '2');
    g.appendChild(circle);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dy', 35);
    text.setAttribute('fill', '#e5e7eb');
    text.setAttribute('font-size', '10');
    text.textContent = loc.name_zh;
    g.appendChild(text);

    svg.appendChild(g);
  });
}

function layoutLocations(locations) {
  // 環形排列最簡單
  const positions = {};
  const count = locations.length;
  const radius = 140;
  const cx = 200, cy = 200;

  locations.forEach((loc, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    positions[loc.code] = {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius
    };
  });
  return positions;
}
```

---

## 十一、CSS 樣式要點

```css
/* 三欄佈局 */
.layout-container {
  display: grid;
  grid-template-columns: 320px 1fr 360px;
  height: calc(100vh - 60px);
}

/* 左側關卡分組 */
.stage-group {
  margin-bottom: 1rem;
}

.stage-group-header {
  padding: 0.5rem 0.75rem;
  background: var(--bg-highlight);
  color: var(--text-muted);
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stage-item {
  padding: 0.75rem;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
}

.stage-item.active {
  background: var(--bg-selected);
  border-left: 3px solid var(--accent-color);
}

/* 分頁標籤支援換行(11 個分頁較多) */
.tab-bar {
  display: flex;
  flex-wrap: wrap;
  border-bottom: 2px solid var(--border-color);
  gap: 0;
}

.tab-btn {
  padding: 0.6rem 1rem;
  font-size: 0.9rem;
}

/* 場景清單兩欄佈局 */
.scenarios-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 1.5rem;
}

.scenario-item {
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin-bottom: 0.5rem;
  cursor: pointer;
}

.scenario-item.active {
  border-color: var(--accent-color);
  background: var(--bg-selected);
}

.badge-starting {
  background: #10b981;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.7rem;
}

.badge-memo {
  background: #6b7280;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.7rem;
}

/* 地點挑選對話框 */
.dialog-large .dialog-content {
  width: 80vw;
  max-width: 900px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.loc-picker-list {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  padding: 1rem 0;
}

.loc-card {
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
}

.loc-card.selected {
  border-color: var(--accent-color);
  background: var(--bg-selected);
}

/* SVG 地圖 */
.map-preview svg {
  width: 100%;
  height: auto;
  background: var(--bg-card);
  border-radius: 6px;
}
```

---

## 十二、資料檔 `data/stage-options.json`

```json
{
  "stage_types": [
    { "code": "main", "name_zh": "主線關卡" },
    { "code": "side", "name_zh": "預設支線" },
    { "code": "side_return", "name_zh": "支線重返版" },
    { "code": "side_random", "name_zh": "隨機地城" }
  ],
  "design_statuses": [
    { "code": "draft", "name_zh": "草稿" },
    { "code": "review", "name_zh": "審核中" },
    { "code": "published", "name_zh": "已發佈" }
  ],
  "location_scales": [
    { "code": "room", "name_zh": "房間級" },
    { "code": "block", "name_zh": "街區級" },
    { "code": "city", "name_zh": "城市級" },
    { "code": "intercontinental", "name_zh": "跨國級" }
  ],
  "enemy_tiers": [
    { "code": "minion", "name_zh": "雜兵" },
    { "code": "threat", "name_zh": "威脅" },
    { "code": "elite", "name_zh": "精英" },
    { "code": "boss", "name_zh": "頭目" },
    { "code": "titan", "name_zh": "巨頭" }
  ],
  "environment_states": [
    { "code": "day", "name_zh": "白天" },
    { "code": "night", "name_zh": "夜間" },
    { "code": "darkness", "name_zh": "黑暗" },
    { "code": "fire", "name_zh": "失火" }
  ]
}
```

---

## 十三、驗收清單

- [ ] 啟動後造訪 `/admin/admin-scenario-editor.html` 顯示完整介面
- [ ] 左側關卡列表依類型分組顯示,支援搜尋/篩選
- [ ] 點擊「＋ 新關卡」開啟對話框,依類型動態顯示對應欄位
- [ ] 建立主線關卡需選擇章節,建立支線重返版需選擇原始支線
- [ ] 建立 `side_random` 關卡顯示「隨機地城規則」分頁,其他類型不顯示
- [ ] 建立 `side_return` 關卡顯示「重返覆寫」分頁,其他類型不顯示
- [ ] 關卡總覽分頁:主線顯示章節與通關旗標區塊,支線不顯示
- [ ] 戰役下拉選擇後,章節下拉與旗標字典同步載入
- [ ] 人數縮放參數可編輯並儲存
- [ ] 場景序列分頁:可新增/刪除場景,可調整順序
- [ ] 起始場景(`scenario_order = 1`)顯示初始配置欄位
- [ ] 非起始場景顯示備忘錄提示與備忘欄位
- [ ] 地點挑選對話框可從完整地點庫挑選,支援搜尋與篩選
- [ ] 挑選後回填到場景初始地點清單
- [ ] 連接關係與初始怪物可新增/編輯
- [ ] 右側預覽欄顯示關卡摘要;場景分頁顯示 SVG 地圖預覽
- [ ] 儲存關卡成功後,列表更新,dirty 狀態清除

---

## 十四、實作注意事項

1. **地點挑選對話框是關鍵共用元件**,後續多處呼叫(隨機地城、重返覆寫、地圖操作指令參數),必須穩固可擴充
2. **場景清單項目點擊與按鈕點擊要正確隔離**,使用 `event.stopPropagation()` 防止冒泡
3. **戰役→章節聯動下拉**要處理「更換戰役時清空章節選擇」,避免跨戰役錯誤關聯
4. **旗標字典快取**跟著當前關卡的戰役載入,切換關卡時若戰役不同要重新載入
5. **SVG 地圖排列**先用簡單環形,後續可擴充 Force-directed
6. **離頁偵測 dirty**,有未儲存變更時警告

---

## 十五、下一份指令

Part 3 將產出目標牌堆、議案牌堆編輯器,以及**最關鍵的地圖操作指令共用元件**(13 種動詞、動態參數欄、與地點挑選對話框整合)。
