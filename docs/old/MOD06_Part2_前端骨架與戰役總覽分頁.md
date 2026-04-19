# MOD-06 戰役敘事設計器 · Claude Code 指令 Part 2：前端骨架與戰役總覽分頁

> **系列**：MOD-06 實作指令 · 第 2 份 / 共 4 份
> **依據規格**:`MOD06_戰役敘事設計器_總覽規格_v0_2.md`
> **前置條件**:Part 1 已完成(後端 API 可用)
> **本份產出**:前端 HTML 骨架、分頁切換、左側戰役列表、戰役總覽分頁的完整互動邏輯
> **執行角色**:Claude Code 依此文件實作檔案變更

---

## 一、任務範圍

本份指令要完成 MOD-06 前端的**骨架層**。實作後應達到的狀態:

- `admin-campaign.html` 從 34 行 stub 擴展為完整單檔 HTML + inline JS(沿用 MOD-01/02/03/08/10 的單檔模式)
- 整體佈局:左側戰役列表、主編輯區、右側預覽欄
- 七個分頁分區的 Tab 切換機制(僅骨架,各分頁內容於 Part 3/4 填入)
- **戰役總覽分頁**完整實作:戰役元資料編輯、起始混沌袋配置、十章骨架十格顯示
- 與 `admin-shared.js` 的認證、API 封裝完整對接

本份**不**包含:章節編輯、旗標字典、間章事件、混沌袋演變、完整性檢查(Part 3 處理)、AI 整合、種子資料(Part 4 處理)。

---

## 二、檔案結構總覽

本份修改的檔案:

- `packages/client/public/admin/admin-campaign.html`(從 34 行 stub 改寫為完整檔案,目標約 1200–1500 行)
- 可能新增資料檔:`packages/client/public/admin/data/campaign-options.json`(下拉選單的選項定義)

---

## 三、HTML 檔案結構

### 3.1 檔案頂部共用結構

沿用 MOD-10 `admin-keeper-designer.html` 或 MOD-08 `admin-location-designer.html` 的結構:

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>戰役敘事設計器 | UG 後台</title>
  <link rel="stylesheet" href="admin-shared.css">
  <style>
    /* 本模組專屬樣式:見 §4 */
  </style>
</head>
<body>
  <!-- 頂部導航列 -->
  <nav class="admin-nav">
    <a href="index.html" class="nav-back">← 後台首頁</a>
    <h1>戰役敘事設計器 <span class="mod-code">MOD-06</span></h1>
    <div class="nav-right">
      <button onclick="openModuleHelp('MOD-06')">說明</button>
      <span id="current-user"></span>
      <button onclick="adminLogout()">登出</button>
    </div>
  </nav>

  <!-- 主體三欄佈局 -->
  <div class="layout-container">
    <aside id="left-panel" class="left-panel">...</aside>
    <main id="main-panel" class="main-panel">...</main>
    <aside id="right-panel" class="right-panel">...</aside>
  </div>

  <!-- 對話框容器 -->
  <div id="dialogs-root"></div>

  <!-- 共用腳本 -->
  <script src="admin-shared.js"></script>
  <script>
    /* 本模組 inline JS:見 §5 */
  </script>
</body>
</html>
```

### 3.2 左側戰役列表區

```html
<aside id="left-panel" class="left-panel">
  <div class="panel-header">
    <h2>戰役列表</h2>
    <button class="btn-primary" onclick="openCreateCampaignDialog()">＋ 新戰役</button>
  </div>
  <div class="panel-filters">
    <input type="search" id="campaign-search" placeholder="搜尋戰役…" oninput="onSearchChange()">
    <select id="campaign-status-filter" onchange="onFilterChange()">
      <option value="">全部狀態</option>
      <option value="draft">草稿</option>
      <option value="review">審核中</option>
      <option value="published">已發佈</option>
    </select>
  </div>
  <div id="campaign-list" class="campaign-list">
    <!-- 動態渲染 -->
  </div>
</aside>
```

### 3.3 主編輯區(分頁容器)

```html
<main id="main-panel" class="main-panel">
  <div id="no-campaign-placeholder" class="placeholder">
    <p>請從左側選擇戰役,或建立新戰役。</p>
  </div>

  <div id="campaign-editor" class="campaign-editor" style="display:none;">
    <!-- 戰役標題列 -->
    <div class="editor-header">
      <h2 id="editor-title"></h2>
      <div class="editor-meta">
        <span id="editor-status-badge"></span>
        <span id="editor-version"></span>
      </div>
    </div>

    <!-- 分頁標籤列 -->
    <nav class="tab-bar">
      <button class="tab-btn active" data-tab="overview">戰役總覽</button>
      <button class="tab-btn" data-tab="chapters">章節編輯</button>
      <button class="tab-btn" data-tab="flags">旗標字典</button>
      <button class="tab-btn" data-tab="interludes">間章事件</button>
      <button class="tab-btn" data-tab="chaos-evolution">混沌袋演變</button>
      <button class="tab-btn" data-tab="completeness">完整性檢查</button>
    </nav>

    <!-- 分頁內容容器 -->
    <div class="tab-content-container">
      <section id="tab-overview" class="tab-content active"><!-- 本份實作 --></section>
      <section id="tab-chapters" class="tab-content"><!-- Part 3 實作 --></section>
      <section id="tab-flags" class="tab-content"><!-- Part 3 實作 --></section>
      <section id="tab-interludes" class="tab-content"><!-- Part 3 實作 --></section>
      <section id="tab-chaos-evolution" class="tab-content"><!-- Part 3 實作 --></section>
      <section id="tab-completeness" class="tab-content"><!-- Part 4 實作 --></section>
    </div>
  </div>
</main>
```

### 3.4 右側預覽欄

```html
<aside id="right-panel" class="right-panel">
  <div class="panel-header">
    <h2>即時預覽</h2>
  </div>
  <div id="preview-content" class="preview-content">
    <!-- 依當前分頁動態顯示對應預覽 -->
  </div>
</aside>
```

---

## 四、戰役總覽分頁內容(`#tab-overview`)

### 4.1 分頁區塊劃分

戰役總覽分頁由三個摺疊區塊組成:

- 區塊一:戰役元資料(預設展開)
- 區塊二:起始混沌袋配置(預設摺疊)
- 區塊三:十章骨架十格顯示(預設展開)

使用 `<details>` 元素實作摺疊,或沿用 MOD-08 的 `toggleSection(id)` 模式。

### 4.2 區塊一:戰役元資料

欄位清單:

| 標籤 | 欄位名 | 輸入控件 | 驗證 |
|---|---|---|---|
| 戰役代碼 | `code` | text,唯讀(建立後不可改) | 建立時必填,3–32 字元 |
| 中文名稱 | `name_zh` | text | 必填,1–128 字元 |
| 英文名稱 | `name_en` | text | 可選 |
| 主題 | `theme` | text | 可選 |
| 封面敘事 | `cover_narrative` | textarea(6 行) | 可選 |
| 難度基準 | `difficulty_tier` | select | easy / standard / hard / expert |
| 設計狀態 | `design_status` | select | draft / review / published |

每個欄位 `onchange` 觸發 `markDirty()`,顯示右上角「尚未儲存」提示。

分頁底部放一個「儲存戰役」按鈕,呼叫 `saveCampaign()`。

**AI 輔助按鈕**(Part 4 實作,本份預留按鈕與空 callback):
- 「AI 生成封面敘事」按鈕,綁定 `aiGenerateCoverNarrative()`
- `name_zh` 欄位旁「中譯英」按鈕,綁定 `aiTranslate('name-zh', 'name-en')`

### 4.3 區塊二:起始混沌袋配置

混沌袋由五類標記組成(取自規則書第二章 §5.2):

- **數字標記**:`+1`, `0`, `-1`, `-2`, `-3`, `-4` 各自數量
- **情境標記**:骷髏(skull)、邪教徒(cultist)、石版(tablet)、遠古邪物(elder_thing) 各自數量 + 每類的場景效果選擇
- **神話標記**:線索(clue)、頭條(headline)、怪物(monster)、毀滅(doom)、次元門(gate) 各自數量 + 數值
- **極端標記**:觸手(tentacle)、遠古印記(elder_sign) 固定各 1 顆(唯讀顯示)
- **動態標記**:祝福(bless)、詛咒(curse) 起始通常為 0

UI 結構:

```html
<div class="chaos-bag-editor">
  <div class="marker-group">
    <h4>數字標記</h4>
    <div class="marker-row">
      <label>+1 <input type="number" min="0" max="10" data-marker="number_+1"></label>
      <label>0 <input type="number" min="0" max="10" data-marker="number_0"></label>
      <!-- … -->
    </div>
  </div>

  <div class="marker-group">
    <h4>情境標記</h4>
    <!-- 每類標記:數量 + 場景效果下拉 -->
    <div class="marker-row">
      <label>骷髏 <input type="number" min="0" max="6" data-marker="skull_count"></label>
      <select data-marker="skull_effect">
        <option value="death_touch">死亡之觸 (HP 傷害)</option>
        <option value="trauma_erosion">創傷侵蝕 (HP 上限 -1)</option>
        <!-- … 五大類完整選項見 §4.5 -->
      </select>
    </div>
    <!-- 其他三類同上 -->
  </div>

  <div class="marker-group">
    <h4>神話標記</h4>
    <!-- 每類:數量 + 數值 -->
  </div>

  <div class="marker-group readonly">
    <h4>極端標記(固定)</h4>
    <p>觸手 ×1、遠古印記 ×1</p>
  </div>

  <div class="marker-summary">
    <p>總標記數:<span id="chaos-bag-total"></span></p>
    <p>預期值:<span id="chaos-bag-expected-value"></span></p>
  </div>
</div>
```

### 4.4 難度預設套用

提供四個按鈕「簡單」「標準」「困難」「專家」,點擊後依規則書第六章 §12.1–§12.2 的配置一鍵填入。

配置對應(取自規則書第六章):

- **簡單**:數字 `+1 ×2`, `0 ×3`, `-1 ×2`;神話 線索 ×2、頭條 ×1、怪物 ×1
- **標準**:數字 `+1 ×1`, `0 ×2`, `-1 ×2`, `-2 ×2`;神話 線索 ×1、頭條 ×1、怪物 ×1、毀滅 ×1
- **困難**:數字 `+1 ×1`, `0 ×1`, `-1 ×2`, `-2 ×2`, `-3 ×1`;神話 線索 ×1、怪物 ×1、毀滅 ×1、次元門 ×1
- **專家**:數字 `0 ×1`, `-1 ×2`, `-2 ×2`, `-3 ×2`, `-4 ×1`;神話 怪物 ×1、毀滅 ×1、次元門 ×1

### 4.5 情境標記場景效果選項

從規則書第二章 §5.4 取出,以資料檔 `data/campaign-options.json` 維護:

```json
{
  "scenario_marker_effects": {
    "skull": [
      { "code": "death_touch", "name_zh": "死亡之觸", "desc": "施法者受 HP 傷害" },
      { "code": "trauma_erosion", "name_zh": "創傷侵蝕", "desc": "HP 上限 -1" },
      { "code": "blood_sacrifice", "name_zh": "血祭", "desc": "流血狀態" },
      { "code": "life_drain", "name_zh": "生命流逝", "desc": "無力狀態" },
      { "code": "life_cost", "name_zh": "生命代價", "desc": "失去盟友或資產" }
    ],
    "cultist": [
      { "code": "doom_advance", "name_zh": "末日推進", "desc": "放置毀滅標記" },
      { "code": "follower_response", "name_zh": "信徒回應", "desc": "生成敵人" },
      { "code": "ritual_resonance", "name_zh": "儀式共鳴", "desc": "怪物回血" },
      { "code": "exposure", "name_zh": "暴露", "desc": "失去隱蔽" },
      { "code": "dark_ritual", "name_zh": "黑暗儀式", "desc": "地點進入黑暗" }
    ],
    "tablet": [
      { "code": "forbidden_knowledge", "name_zh": "禁忌知識", "desc": "SAN 傷害" },
      { "code": "mad_whispers", "name_zh": "瘋狂低語", "desc": "發瘋狀態" },
      { "code": "memory_collapse", "name_zh": "記憶崩解", "desc": "隨機棄手牌" },
      { "code": "mental_exhaustion", "name_zh": "精神枯竭", "desc": "疲勞狀態" },
      { "code": "things_not_to_know", "name_zh": "不應知曉之事", "desc": "神啟卡洗入牌庫" }
    ],
    "elder_thing": [
      { "code": "rift_expansion", "name_zh": "裂隙擴張", "desc": "開啟次元門" },
      { "code": "spacetime_distortion", "name_zh": "時空扭曲", "desc": "隨機傳送" },
      { "code": "otherworldly_seep", "name_zh": "異界滲透", "desc": "放置鬧鬼" },
      { "code": "space_rupture", "name_zh": "空間斷裂", "desc": "斷開地點連接" },
      { "code": "otherworldly_fire", "name_zh": "異界之火", "desc": "地點失火" },
      { "code": "void_chill", "name_zh": "虛空寒流", "desc": "冷凍狀態" }
    ]
  }
}
```

### 4.6 區塊三:十章骨架十格顯示

十格網格,每格顯示一章的摘要。本份僅實作「顯示」,不進入章節編輯(Part 3 處理)。

```html
<div class="chapter-grid">
  <!-- 十格,以 JS 動態渲染 -->
</div>
```

每格內容:
- 章節編號(大字)
- 章節縮寫(`ch1` ~ `ch10`)
- 章節名稱
- 設計狀態徽章(草稿/審核/已發佈)
- 關卡數量(查詢 `linked_stages`)
- 結果分支數量
- 間章事件數量

點擊某格 → 切換到「章節編輯」分頁並選定該章節(Part 3 處理這個切換)。

本份先實作:點擊 → `switchTab('chapters')` + 呼叫 `selectChapter(chapterId)` 的空 stub。

---

## 五、inline JS 骨架

### 5.1 狀態變數

```javascript
// 全域狀態
let currentCampaign = null;        // 當前選中的戰役完整資料
let currentCampaignList = [];      // 左側列表資料
let currentTab = 'overview';       // 當前分頁
let campaignOptions = null;        // 載入的選項資料(情境標記效果等)
let dirty = false;                 // 是否有未儲存變更
```

### 5.2 初始化流程

```javascript
async function init() {
  if (!checkAdminAuth()) return;  // 來自 admin-shared.js
  displayCurrentUser();

  // 載入選項資料
  await loadCampaignOptions();

  // 載入戰役列表
  await loadCampaignList();

  // 綁定全域事件
  bindTabSwitcher();
  bindBeforeUnloadWarning();
}

window.addEventListener('DOMContentLoaded', init);
```

### 5.3 戰役列表相關函式

```javascript
// 從 /api/campaigns 載入
async function loadCampaignList() { ... }

// 渲染左側列表(過濾 + 排序)
function renderCampaignList() { ... }

// 搜尋／篩選變更時重新渲染(不重新請求)
function onSearchChange() { ... }
function onFilterChange() { ... }

// 點擊戰役項目
async function selectCampaign(id) {
  if (dirty && !confirm('有未儲存變更,要放棄嗎?')) return;
  await loadCampaignDetail(id);
  renderEditor();
}

// 載入單一戰役詳情
async function loadCampaignDetail(id) {
  const res = await adminFetch(`/api/campaigns/${id}`);
  currentCampaign = await res.json();
  dirty = false;
}
```

### 5.4 建立戰役對話框

```javascript
function openCreateCampaignDialog() {
  // 彈出對話框要求輸入 code, name_zh
  // 其他欄位建立後再編輯
  // 確認後 POST /api/campaigns,成功後 selectCampaign(newId)
}

async function confirmCreateCampaign() {
  const code = document.getElementById('new-campaign-code').value.trim();
  const nameZh = document.getElementById('new-campaign-name-zh').value.trim();

  // 基本驗證
  if (!code || !/^[a-z0-9_]{3,32}$/.test(code)) {
    alert('戰役代碼格式錯誤(3–32 字元,小寫英數底線)');
    return;
  }
  if (!nameZh) {
    alert('中文名稱為必填');
    return;
  }

  try {
    const res = await adminFetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name_zh: nameZh })
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || '建立失敗');
      return;
    }
    const newCampaign = await res.json();
    await loadCampaignList();
    await selectCampaign(newCampaign.id);
    closeDialog('create-campaign');
  } catch (e) {
    alert('網路錯誤:' + e.message);
  }
}
```

### 5.5 分頁切換

```javascript
function bindTabSwitcher() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
}

function switchTab(tabName) {
  if (dirty && !confirm('有未儲存變更,要放棄嗎?')) return;

  currentTab = tabName;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(sec => {
    sec.classList.toggle('active', sec.id === `tab-${tabName}`);
  });

  // 依分頁執行對應渲染
  switch (tabName) {
    case 'overview': renderOverviewTab(); break;
    case 'chapters': renderChaptersTab(); break;     // Part 3
    case 'flags': renderFlagsTab(); break;           // Part 3
    case 'interludes': renderInterludesTab(); break; // Part 3
    case 'chaos-evolution': renderChaosEvolutionTab(); break; // Part 3
    case 'completeness': renderCompletenessTab(); break;      // Part 4
  }

  updateRightPanel();
}
```

### 5.6 戰役總覽分頁渲染

```javascript
function renderOverviewTab() {
  if (!currentCampaign) return;

  // 區塊一:元資料
  document.getElementById('field-code').value = currentCampaign.code;
  document.getElementById('field-code').readOnly = true;  // 建立後不可改
  document.getElementById('field-name-zh').value = currentCampaign.name_zh;
  document.getElementById('field-name-en').value = currentCampaign.name_en;
  document.getElementById('field-theme').value = currentCampaign.theme;
  document.getElementById('field-cover-narrative').value = currentCampaign.cover_narrative;
  document.getElementById('field-difficulty-tier').value = currentCampaign.difficulty_tier;
  document.getElementById('field-design-status').value = currentCampaign.design_status;

  // 區塊二:起始混沌袋
  renderChaosBagEditor(currentCampaign.initial_chaos_bag);

  // 區塊三:十章骨架
  renderChapterGrid(currentCampaign.chapters);
}
```

### 5.7 混沌袋編輯器渲染

```javascript
function renderChaosBagEditor(bagData) {
  // 將 bagData 填入對應的 input / select
  // bagData 結構範例:
  // {
  //   number_markers: { "+1": 1, "0": 2, "-1": 2, "-2": 2 },
  //   scenario_markers: {
  //     skull: { count: 2, effect: 'blood_sacrifice', value: -1 },
  //     cultist: { count: 1, effect: 'follower_response', value: -2 },
  //     ...
  //   },
  //   mythos_markers: {
  //     clue: { count: 1, value: -1 },
  //     ...
  //   }
  // }
}

function collectChaosBagFromForm() {
  // 反向:從表單收集資料,組成 bagData 物件
  // 用於儲存時
}

function applyDifficultyPreset(preset) {
  // 依 preset (easy/standard/hard/expert) 填入標準配置
  const presets = {
    easy: {
      number_markers: { "+1": 2, "0": 3, "-1": 2 },
      mythos_markers: {
        clue: { count: 2, value: 0 },
        headline: { count: 1, value: -1 },
        monster: { count: 1, value: -2 }
      }
    },
    // ... 其他三檔
  };
  // 套用後渲染
}

function updateChaosBagSummary() {
  // 計算並顯示總標記數、期望值
}
```

### 5.8 十章骨架網格渲染

```javascript
function renderChapterGrid(chapters) {
  const grid = document.querySelector('.chapter-grid');
  grid.innerHTML = '';

  chapters.forEach(ch => {
    const card = document.createElement('div');
    card.className = 'chapter-card';
    card.onclick = () => jumpToChapter(ch.id);
    card.innerHTML = `
      <div class="chapter-num">${ch.chapter_number}</div>
      <div class="chapter-code">${ch.chapter_code}</div>
      <div class="chapter-name">${escapeHtml(ch.name_zh)}</div>
      <div class="chapter-badges">
        <span class="status-${ch.design_status}">${statusLabel(ch.design_status)}</span>
        <span>關卡 ${ch.stage_count || 0}</span>
        <span>結果 ${ch.outcome_count || 0}</span>
        <span>事件 ${ch.interlude_count || 0}</span>
      </div>
    `;
    grid.appendChild(card);
  });
}

function jumpToChapter(chapterId) {
  switchTab('chapters');
  selectChapter(chapterId);  // Part 3 實作
}
```

### 5.9 儲存戰役

```javascript
async function saveCampaign() {
  if (!currentCampaign) return;

  const payload = {
    name_zh: document.getElementById('field-name-zh').value,
    name_en: document.getElementById('field-name-en').value,
    theme: document.getElementById('field-theme').value,
    cover_narrative: document.getElementById('field-cover-narrative').value,
    difficulty_tier: document.getElementById('field-difficulty-tier').value,
    design_status: document.getElementById('field-design-status').value,
    initial_chaos_bag: collectChaosBagFromForm()
  };

  try {
    const res = await adminFetch(`/api/campaigns/${currentCampaign.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      showToast('儲存失敗:' + (err.error || '未知錯誤'), 'error');
      return;
    }
    const updated = await res.json();
    currentCampaign = { ...currentCampaign, ...updated };
    dirty = false;
    showToast('已儲存', 'success');
    await loadCampaignList();  // 重新整理左側列表
  } catch (e) {
    showToast('網路錯誤:' + e.message, 'error');
  }
}
```

### 5.10 共用輔助函式

```javascript
function markDirty() {
  dirty = true;
  document.getElementById('editor-status-badge').textContent = '● 未儲存';
  document.getElementById('editor-status-badge').className = 'badge-dirty';
}

function clearDirty() {
  dirty = false;
  document.getElementById('editor-status-badge').textContent = '';
  document.getElementById('editor-status-badge').className = '';
}

function bindBeforeUnloadWarning() {
  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function escapeHtml(str) { /* 標準轉義 */ }
function statusLabel(status) {
  return { draft: '草稿', review: '審核中', published: '已發佈' }[status] || status;
}

function showToast(msg, type) {
  // 右上角顯示提示訊息,3 秒後消失
}

async function loadCampaignOptions() {
  const res = await fetch('data/campaign-options.json');
  campaignOptions = await res.json();
}
```

### 5.11 右側預覽欄

```javascript
function updateRightPanel() {
  const container = document.getElementById('preview-content');
  if (!currentCampaign) {
    container.innerHTML = '<p class="placeholder">選擇戰役後顯示預覽</p>';
    return;
  }

  switch (currentTab) {
    case 'overview':
      renderCampaignOverviewPreview(container);
      break;
    // 其他分頁的預覽於後續 Part 實作
    default:
      container.innerHTML = '<p class="placeholder">此分頁暫無預覽</p>';
  }
}

function renderCampaignOverviewPreview(container) {
  // 渲染戰役資訊卡(封面敘事、主題、難度徽章、十章狀態總覽、混沌袋摘要)
  container.innerHTML = `
    <div class="preview-card">
      <h3>${escapeHtml(currentCampaign.name_zh)}</h3>
      <p class="theme">${escapeHtml(currentCampaign.theme || '—')}</p>
      <div class="difficulty-badge">${difficultyLabel(currentCampaign.difficulty_tier)}</div>
      <p class="cover-narrative">${escapeHtml(currentCampaign.cover_narrative)}</p>
      <hr>
      <h4>章節進度</h4>
      <div class="chapter-mini-grid">${renderChapterMiniGrid()}</div>
      <hr>
      <h4>起始混沌袋</h4>
      <div class="chaos-bag-mini">${renderChaosBagMini()}</div>
    </div>
  `;
}

function difficultyLabel(tier) {
  return { easy: '簡單', standard: '標準', hard: '困難', expert: '專家' }[tier];
}
```

---

## 六、CSS 樣式要點

### 6.1 三欄佈局

```css
.layout-container {
  display: grid;
  grid-template-columns: 280px 1fr 340px;
  height: calc(100vh - 60px);
  overflow: hidden;
}

.left-panel, .right-panel {
  background: var(--bg-panel);
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
}

.right-panel {
  border-right: none;
  border-left: 1px solid var(--border-color);
}

.main-panel {
  overflow-y: auto;
  padding: 1.5rem;
}
```

### 6.2 十章網格

```css
.chapter-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 1rem;
  margin-top: 1rem;
}

.chapter-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1rem;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.chapter-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  border-color: var(--accent-color);
}

.chapter-num {
  font-size: 2rem;
  font-weight: bold;
  color: var(--accent-color);
}
```

### 6.3 分頁標籤

```css
.tab-bar {
  display: flex;
  border-bottom: 2px solid var(--border-color);
  margin-bottom: 1.5rem;
}

.tab-btn {
  padding: 0.75rem 1.25rem;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.95rem;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  color: var(--accent-color);
  border-bottom-color: var(--accent-color);
}

.tab-content {
  display: none;
}

.tab-content.active {
  display: block;
}
```

### 6.4 混沌袋編輯器

```css
.chaos-bag-editor {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.marker-group {
  background: var(--bg-card);
  padding: 1rem;
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.marker-group h4 {
  margin-top: 0;
  color: var(--accent-color);
}

.marker-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
}

.marker-row input[type=number] {
  width: 60px;
}

.marker-summary {
  background: var(--bg-highlight);
  padding: 1rem;
  border-radius: 6px;
}
```

### 6.5 狀態徽章

```css
.status-draft { background: #6b7280; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }
.status-review { background: #eab308; color: black; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }
.status-published { background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }

.badge-dirty {
  color: #f59e0b;
  font-weight: bold;
}
```

---

## 七、資料檔 `data/campaign-options.json`

完整結構:

```json
{
  "difficulty_tiers": [
    { "code": "easy", "name_zh": "簡單" },
    { "code": "standard", "name_zh": "標準" },
    { "code": "hard", "name_zh": "困難" },
    { "code": "expert", "name_zh": "專家" }
  ],
  "design_statuses": [
    { "code": "draft", "name_zh": "草稿" },
    { "code": "review", "name_zh": "審核中" },
    { "code": "published", "name_zh": "已發佈" }
  ],
  "scenario_marker_effects": {
    "skull": [ /* §4.5 完整清單 */ ],
    "cultist": [ /* … */ ],
    "tablet": [ /* … */ ],
    "elder_thing": [ /* … */ ]
  },
  "difficulty_presets": {
    "easy": { /* §4.4 完整配置 */ },
    "standard": { /* … */ },
    "hard": { /* … */ },
    "expert": { /* … */ }
  },
  "flag_categories": [
    { "code": "act", "name_zh": "行動進度", "visibility": "visible" },
    { "code": "agenda", "name_zh": "議程進度", "visibility": "visible" },
    { "code": "npc", "name_zh": "NPC 狀態", "visibility": "conditional" },
    { "code": "item", "name_zh": "物品取得", "visibility": "visible" },
    { "code": "location", "name_zh": "地點探索", "visibility": "conditional" },
    { "code": "choice", "name_zh": "玩家選擇", "visibility": "visible" },
    { "code": "outcome", "name_zh": "章節結果", "visibility": "visible" },
    { "code": "time", "name_zh": "時間狀態", "visibility": "visible" },
    { "code": "hidden", "name_zh": "隱藏旗標", "visibility": "hidden" }
  ]
}
```

---

## 八、驗收清單

完成本份指令後,以下應為 `true`:

- [ ] `pnpm dev` 啟動後,造訪 `/admin/admin-campaign.html` 顯示完整介面(不是 34 行 stub)
- [ ] 未選取戰役時,主編輯區顯示佔位文字
- [ ] 點擊「新戰役」開啟對話框,填寫 `code` 與 `name_zh` 後能建立戰役
- [ ] 建立成功後,戰役自動出現在左側列表,點擊後進入編輯
- [ ] 戰役總覽分頁顯示十章骨架十格,每格顯示章節編號、縮寫、預設名稱、狀態
- [ ] 元資料欄位可編輯,變更後右上角顯示「未儲存」
- [ ] 點擊「儲存戰役」成功儲存,頁面重新整理後資料持久化
- [ ] 起始混沌袋的難度預設按鈕可一鍵套用四種配置
- [ ] 情境標記的場景效果下拉顯示正確的中文選項
- [ ] 切換分頁(章節/旗標/間章/混沌袋演變/完整性)時,對應區塊顯示空 stub
- [ ] 右側預覽欄在戰役總覽分頁時顯示戰役資訊卡

---

## 九、實作注意事項

1. **沿用既有模式**:參考 `admin-location-designer.html`、`admin-keeper-designer.html` 的 inline JS 結構與 CSS 變數命名
2. **所有 fetch 呼叫使用 `adminFetch()`**,不要自己寫 `fetch` 並手動附加 token
3. **離開頁面前偵測 dirty 狀態**,有未儲存變更時跳出確認
4. **錯誤訊息繁體中文**,具體說明錯在哪(不是「發生錯誤」這種籠統訊息)
5. **狀態徽章、標籤用 CSS 變數**,與其他模組視覺一致
6. **不使用 localStorage 記憶當前選中的戰役**,重整頁面回到初始狀態(避免狀態汙染)
7. **確保既有 `admin-shared.js` 函式可直接呼叫**(`checkAdminAuth`, `adminFetch`, `adminLogout`, `openModuleHelp`)

---

## 十、下一份指令

Part 3 將產出 MOD-06 核心編輯器:章節編輯分頁、旗標字典、間章事件、混沌袋演變規則、條件表達式編輯器共用元件。
