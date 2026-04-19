# MOD-07 關卡編輯器 · Claude Code 指令 Part 4:混沌袋、遭遇卡池、神話卡池、怪物家族池

> **系列**:MOD-07 實作指令 · 第 4 份 / 共 5 份
> **依據規格**:`MOD07_關卡編輯器_總覽規格_v0_2.md`
> **前置條件**:Part 1 + Part 2 + Part 3 已完成
> **本份產出**:混沌袋配置分頁、遭遇卡池分頁、神話卡池分頁、怪物家族池分頁
> **執行角色**:Claude Code 依此文件實作檔案變更

---

## 一、任務範圍

本份完成四個次要分頁。全部分頁的共同特性:

- 從外部模組(MOD-10 神話/遭遇卡、MOD-03 怪物家族)載入資料
- 以**引用 + 配置**的方式使用外部資料,不自己儲存外部卡片內容
- UI 以列表/表格為主,配有從庫中挑選的對話框

---

## 二、混沌袋配置分頁(`#tab-chaos-bag`)

### 2.1 分頁結構

混沌袋配置採**四區塊縱向排列**:

```html
<section id="tab-chaos-bag" class="tab-content">
  <div class="chaos-bag-intro">
    <p>設定本關卡的**起始混沌袋配置**。每次關卡開始時,按此配置填入標記。</p>
    <div class="difficulty-presets">
      <span>難度預設:</span>
      <button onclick="applyChaosBagPreset('easy')">簡單</button>
      <button onclick="applyChaosBagPreset('standard')">標準</button>
      <button onclick="applyChaosBagPreset('hard')">困難</button>
      <button onclick="applyChaosBagPreset('expert')">專家</button>
    </div>
  </div>

  <!-- 區塊一:數字標記 -->
  <section class="editor-section">
    <h3>數字標記</h3>
    <div class="number-markers-grid">
      <label>+1 顆數 <input type="number" data-marker="+1" min="0" max="10"></label>
      <label>0 顆數  <input type="number" data-marker="0"  min="0" max="10"></label>
      <label>-1 顆數 <input type="number" data-marker="-1" min="0" max="10"></label>
      <label>-2 顆數 <input type="number" data-marker="-2" min="0" max="10"></label>
      <label>-3 顆數 <input type="number" data-marker="-3" min="0" max="10"></label>
      <label>-4 顆數 <input type="number" data-marker="-4" min="0" max="10"></label>
    </div>
  </section>

  <!-- 區塊二:情境標記 -->
  <section class="editor-section">
    <h3>情境標記</h3>
    <p class="hint">依關卡主題設定四類情境標記的場景效果</p>

    <div class="scenario-markers-list">
      <!-- 骷髏 -->
      <div class="scenario-marker-row" data-marker="skull">
        <label>骷髏 顆數 <input type="number" data-field="count" min="0" max="6"></label>
        <label>場景效果
          <select data-field="effect">
            <!-- 骷髏五種效果:死亡之觸/創傷侵蝕/血祭/生命流逝/生命代價 -->
          </select>
        </label>
        <label>效果數值 <input type="number" data-field="value" min="-5" max="0"></label>
        <div class="family-suggestion"></div>
      </div>

      <!-- 邪教徒、石版、遠古邪物 同樣結構 -->
    </div>
  </section>

  <!-- 區塊三:神話標記 -->
  <section class="editor-section">
    <h3>神話標記</h3>
    <div class="mythos-markers-list">
      <!-- 五類:線索/頭條/怪物/毀滅/次元門 -->
      <div class="mythos-marker-row" data-marker="clue">
        <label>線索 顆數 <input type="number" data-field="count" min="0" max="3"></label>
        <label>效果值 <input type="number" data-field="value" min="-5" max="0"></label>
      </div>
      <!-- 其餘四類同樣 -->
    </div>
  </section>

  <!-- 區塊四:極端標記 + 動態標記 -->
  <section class="editor-section">
    <h3>極端標記與動態標記</h3>
    <div class="extreme-markers">
      <p>極端標記:觸手 ×1、遠古印記 ×1(固定,不可修改)</p>
    </div>
    <div class="dynamic-markers">
      <label>起始祝福 <input type="number" data-marker="bless" min="0" max="5" value="0"></label>
      <label>起始詛咒 <input type="number" data-marker="curse" min="0" max="5" value="0"></label>
    </div>
  </section>

  <!-- 數值摘要 -->
  <section class="editor-section">
    <h3>配置摘要</h3>
    <div class="chaos-bag-stats">
      <p>總標記數:<span id="chaos-total-count"></span></p>
      <p>期望值:<span id="chaos-expected-value"></span></p>
      <p>失敗率(DC 4):<span id="chaos-fail-rate-dc4"></span></p>
      <p>極端事件率(觸手/遠古印記):<span id="chaos-extreme-rate"></span></p>
    </div>
  </section>

  <div class="editor-footer">
    <button class="btn-primary" onclick="saveChaosBag()">儲存混沌袋</button>
  </div>
</section>
```

### 2.2 情境標記場景效果選項

沿用 MOD-06 Part 2 §4.5 的對照表,共 20 種效果(四類 × 5 種)。

資料檔 `stage-options.json` 需擴充:

```json
{
  "scenario_marker_effects": {
    "skull": [ /* 同 MOD-06 §4.5 */ ],
    "cultist": [ /* … */ ],
    "tablet": [ /* … */ ],
    "elder_thing": [ /* … */ ]
  }
}
```

(若 MOD-06 已有此資料,可共用——建議由前端 init 時從 MOD-06 的 `campaign-options.json` 抓取,或複製到 MOD-07 的 `stage-options.json`。)

### 2.3 怪物家族與效果的主題對應

依規則書第六章 §13「怪物家族與混沌袋場景效果對應表」,為每個怪物家族推薦情境標記效果:

```json
{
  "family_effect_suggestions": {
    "cthulhu_spawn": {
      "skull": "death_touch",
      "cultist": "follower_response",
      "tablet": "mad_whispers",
      "elder_thing": "rift_expansion"
    },
    "deep_one": {
      "skull": "blood_sacrifice",
      "cultist": "dark_ritual",
      "tablet": "things_not_to_know",
      "elder_thing": "otherworldly_seep"
    },
    // ... 七大家族
  }
}
```

### 2.4 載入與套用建議

```javascript
function renderChaosBagTab() {
  if (!currentStage) return;

  loadChaosBag().then(bag => {
    fillChaosBagForm(bag);
    applySuggestionsBasedOnMonsterPool();
    updateChaosBagStats();
  });
}

async function loadChaosBag() {
  const res = await adminFetch(`/api/stages/${currentStage.id}/chaos-bag`);
  return await res.json();
}

function applySuggestionsBasedOnMonsterPool() {
  // 若關卡已設定主家族,在每個情境標記旁顯示推薦效果
  const primary = currentStage.monster_pool?.find(p => p.role === 'primary');
  if (!primary) return;

  const suggestions = stageOptions.family_effect_suggestions?.[primary.family_code];
  if (!suggestions) return;

  ['skull', 'cultist', 'tablet', 'elder_thing'].forEach(markerType => {
    const row = document.querySelector(`[data-marker="${markerType}"]`);
    const suggestion = suggestions[markerType];
    if (row && suggestion) {
      const label = getEffectLabel(markerType, suggestion);
      const hintEl = row.querySelector('.family-suggestion');
      hintEl.innerHTML = `
        <span class="hint">家族推薦:${label}</span>
        <button type="button" onclick="applyEffectSuggestion('${markerType}', '${suggestion}')">
          套用
        </button>
      `;
    }
  });
}
```

### 2.5 難度預設套用

依規則書第六章 §12.1–§12.2 的配置(與 MOD-06 的預設相同):

```javascript
function applyChaosBagPreset(preset) {
  if (!confirm(`套用「${preset}」預設會覆蓋目前配置,確定繼續?`)) return;

  const presets = stageOptions.difficulty_presets[preset];
  fillChaosBagForm(presets);
  markDirty();
  updateChaosBagStats();
}
```

### 2.6 數值摘要計算

```javascript
function updateChaosBagStats() {
  const bag = collectChaosBagFromForm();
  const stats = calculateChaosBagStats(bag);

  document.getElementById('chaos-total-count').textContent = stats.totalCount;
  document.getElementById('chaos-expected-value').textContent = stats.expectedValue.toFixed(2);
  document.getElementById('chaos-fail-rate-dc4').textContent = `${(stats.failRateDc4 * 100).toFixed(1)}%`;
  document.getElementById('chaos-extreme-rate').textContent = `${(stats.extremeRate * 100).toFixed(1)}%`;
}

function calculateChaosBagStats(bag) {
  let totalCount = 0;
  let weightedSum = 0;
  let failCount = 0;  // 抽到後會導致 DC 4 失敗的標記數(簡化計算)
  let extremeCount = 2;  // 觸手 + 遠古印記

  // 數字標記
  for (const [val, count] of Object.entries(bag.number_markers || {})) {
    const numVal = parseInt(val, 10);
    totalCount += count;
    weightedSum += numVal * count;
    if (numVal <= -3) failCount += count;  // 簡化:-3 以下視為 DC 4 失敗
  }

  // 情境標記
  for (const [mkr, cfg] of Object.entries(bag.scenario_markers || {})) {
    totalCount += cfg.count;
    weightedSum += (cfg.value || 0) * cfg.count;
    if ((cfg.value || 0) <= -3) failCount += cfg.count;
  }

  // 神話標記
  for (const [mkr, cfg] of Object.entries(bag.mythos_markers || {})) {
    totalCount += cfg.count;
    weightedSum += (cfg.value || 0) * cfg.count;
    if ((cfg.value || 0) <= -3) failCount += cfg.count;
  }

  // 極端標記 +2
  totalCount += 2;

  const expectedValue = totalCount > 0 ? weightedSum / totalCount : 0;
  const failRateDc4 = totalCount > 0 ? failCount / totalCount : 0;
  const extremeRate = totalCount > 0 ? extremeCount / totalCount : 0;

  return { totalCount, expectedValue, failRateDc4, extremeRate };
}
```

### 2.7 儲存混沌袋

```javascript
async function saveChaosBag() {
  const payload = collectChaosBagFromForm();

  const res = await adminFetch(`/api/stages/${currentStage.id}/chaos-bag`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    showToast('儲存失敗', 'error');
    return;
  }

  clearDirty();
  showToast('混沌袋已儲存', 'success');
}

function collectChaosBagFromForm() {
  const numberMarkers = {};
  document.querySelectorAll('.number-markers-grid input').forEach(inp => {
    numberMarkers[inp.dataset.marker] = parseInt(inp.value, 10) || 0;
  });

  const scenarioMarkers = {};
  document.querySelectorAll('.scenario-marker-row').forEach(row => {
    const marker = row.dataset.marker;
    scenarioMarkers[marker] = {
      count: parseInt(row.querySelector('[data-field="count"]').value, 10) || 0,
      effect: row.querySelector('[data-field="effect"]').value,
      value: parseInt(row.querySelector('[data-field="value"]').value, 10) || 0
    };
  });

  const mythosMarkers = {};
  document.querySelectorAll('.mythos-marker-row').forEach(row => {
    const marker = row.dataset.marker;
    mythosMarkers[marker] = {
      count: parseInt(row.querySelector('[data-field="count"]').value, 10) || 0,
      value: parseInt(row.querySelector('[data-field="value"]').value, 10) || 0
    };
  });

  const dynamicMarkers = {
    bless: parseInt(document.querySelector('[data-marker="bless"]').value, 10) || 0,
    curse: parseInt(document.querySelector('[data-marker="curse"]').value, 10) || 0
  };

  return {
    difficulty_preset: currentStage.chaos_bag?.difficulty_preset || 'standard',
    number_markers: numberMarkers,
    scenario_markers: scenarioMarkers,
    mythos_markers: mythosMarkers,
    dynamic_markers: dynamicMarkers
  };
}
```

---

## 三、遭遇卡池分頁(`#tab-encounter-pool`)

### 3.1 分頁結構

```html
<section id="tab-encounter-pool" class="tab-content">
  <div class="pool-intro">
    <p>本關卡引用的遭遇卡池。遭遇卡本體由 MOD-10 城主設計器維護,此處僅做引用與權重設定。</p>
  </div>

  <div class="pool-toolbar">
    <button class="btn-primary" onclick="openEncounterCardPicker()">＋ 從 MOD-10 選取遭遇卡</button>
    <span class="pool-stats">已引用 <strong id="encounter-pool-count">0</strong> 張</span>
  </div>

  <table class="pool-table">
    <thead>
      <tr>
        <th>遭遇卡名稱</th>
        <th>類型</th>
        <th>權重</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody id="encounter-pool-tbody">
      <!-- 動態渲染 -->
    </tbody>
  </table>
</section>
```

### 3.2 載入與渲染

```javascript
async function renderEncounterPoolTab() {
  if (!currentStage) return;

  const res = await adminFetch(`/api/stages/${currentStage.id}/encounter-pool`);
  const pool = await res.json();

  currentEncounterPool = pool;  // 陣列:[{ id, encounter_card_id, weight, card_data: {...} }]
  renderEncounterPoolTable();
}

function renderEncounterPoolTable() {
  const tbody = document.getElementById('encounter-pool-tbody');
  const count = currentEncounterPool.length;
  document.getElementById('encounter-pool-count').textContent = count;

  if (count === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">尚未引用遭遇卡</td></tr>';
    return;
  }

  tbody.innerHTML = currentEncounterPool.map(item => `
    <tr data-id="${item.id}">
      <td>${escapeHtml(item.card_data?.name_zh || '(未知)')}</td>
      <td>${escapeHtml(item.card_data?.encounter_type || '—')}</td>
      <td>
        <input type="number" min="1" max="10" value="${item.weight}"
               onchange="updateEncounterWeight('${item.id}', this.value)">
      </td>
      <td>
        <button onclick="removeFromEncounterPool('${item.id}')" class="btn-danger">🗑</button>
      </td>
    </tr>
  `).join('');
}
```

### 3.3 遭遇卡選取對話框

```html
<div id="dialog-encounter-picker" class="dialog dialog-large" style="display:none">
  <div class="dialog-content">
    <h3>從 MOD-10 遭遇卡庫選取</h3>

    <div class="picker-toolbar">
      <input type="search" id="enc-picker-search" oninput="filterEncounterPicker()">
      <select id="enc-picker-type-filter" onchange="filterEncounterPicker()">
        <option value="">全部類型</option>
        <!-- encounter_type 動態填入 -->
      </select>
    </div>

    <div id="encounter-picker-list" class="picker-list">
      <!-- 遭遇卡清單 -->
    </div>

    <div class="dialog-footer">
      <span id="enc-picker-selected-count">已選 0 張</span>
      <div>
        <button onclick="closeDialog('encounter-picker')">取消</button>
        <button class="btn-primary" onclick="confirmAddEncounters()">加入選取卡片</button>
      </div>
    </div>
  </div>
</div>
```

### 3.4 API 載入 MOD-10 遭遇卡

```javascript
async function openEncounterCardPicker() {
  await loadAllEncounterCards();
  renderEncounterPickerList();
  openDialog('encounter-picker');
}

let allEncounterCardsCache = null;
let encounterPickerSelection = new Set();

async function loadAllEncounterCards() {
  if (allEncounterCardsCache) return allEncounterCardsCache;
  const res = await adminFetch('/api/admin/keeper/encounter-cards');
  allEncounterCardsCache = await res.json();
  return allEncounterCardsCache;
}

function renderEncounterPickerList() {
  const search = document.getElementById('enc-picker-search').value.toLowerCase();
  const typeFilter = document.getElementById('enc-picker-type-filter').value;

  // 排除已在 pool 中的卡
  const existingIds = new Set(currentEncounterPool.map(p => p.encounter_card_id));

  const filtered = allEncounterCardsCache.filter(card => {
    if (existingIds.has(card.id)) return false;
    if (search && !card.name_zh.toLowerCase().includes(search)) return false;
    if (typeFilter && card.encounter_type !== typeFilter) return false;
    return true;
  });

  const listEl = document.getElementById('encounter-picker-list');
  listEl.innerHTML = filtered.map(card => `
    <div class="picker-card ${encounterPickerSelection.has(card.id) ? 'selected' : ''}"
         onclick="toggleEncounterPick('${card.id}')">
      <div class="picker-card-header">
        <strong>${escapeHtml(card.name_zh)}</strong>
        <span class="badge">${escapeHtml(card.encounter_type || '')}</span>
      </div>
      <p class="picker-card-body">${escapeHtml(card.description_zh || '')}</p>
    </div>
  `).join('');
}

function toggleEncounterPick(cardId) {
  if (encounterPickerSelection.has(cardId)) {
    encounterPickerSelection.delete(cardId);
  } else {
    encounterPickerSelection.add(cardId);
  }
  document.getElementById('enc-picker-selected-count').textContent =
    `已選 ${encounterPickerSelection.size} 張`;
  renderEncounterPickerList();
}

async function confirmAddEncounters() {
  for (const cardId of encounterPickerSelection) {
    await adminFetch(`/api/stages/${currentStage.id}/encounter-pool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encounter_card_id: cardId, weight: 1 })
    });
  }

  encounterPickerSelection.clear();
  closeDialog('encounter-picker');
  await renderEncounterPoolTab();
  showToast('已加入遭遇卡', 'success');
}

async function updateEncounterWeight(poolItemId, weight) {
  await adminFetch(`/api/encounter-pool/${poolItemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weight: parseInt(weight, 10) })
  });
  showToast('權重已更新', 'success');
}

async function removeFromEncounterPool(poolItemId) {
  if (!confirm('從池中移除此遭遇卡?')) return;
  await adminFetch(`/api/encounter-pool/${poolItemId}`, { method: 'DELETE' });
  await renderEncounterPoolTab();
}
```

---

## 四、神話卡池分頁(`#tab-mythos-pool`)

### 4.1 結構

與遭遇卡池**幾乎完全對稱**,僅以下差異:

- API 端點改為 `/api/stages/:stageId/mythos-pool`、`/api/admin/keeper/mythos-cards`
- 表格欄位:名稱、**神話類型**(如「傳奇行動」「劇情事件」「持續效果」)、權重、操作
- 對話框篩選用 `mythos_type` 或 `mythos_category`

### 4.2 神話卡類型顯示

MOD-10 的 `mythos_cards` 可能有多種類型(例如:`legendary_action`、`narrative_event`、`ongoing_effect`)。依 MOD-10 實際欄位顯示,若不確定,通用顯示為純文字欄位。

```javascript
async function loadAllMythosCards() {
  if (allMythosCardsCache) return allMythosCardsCache;
  const res = await adminFetch('/api/admin/keeper/mythos-cards');
  allMythosCardsCache = await res.json();
  return allMythosCardsCache;
}

// 其餘函式與遭遇卡池完全對稱
```

### 4.3 警示:無神話卡的主線關卡

主線關卡必須至少引用 1 張神話卡(完整性檢查會檢查)。若神話卡池為空,分頁頂部顯示警示:

```html
<div class="warning-banner" id="mythos-empty-warning" style="display:none">
  ⚠ 主線關卡需要至少 1 張神話卡才能發佈
</div>
```

---

## 五、怪物家族池分頁(`#tab-monster-pool`)

### 5.1 分頁結構

```html
<section id="tab-monster-pool" class="tab-content">
  <div class="monster-pool-intro">
    <p>指定本關卡可能出現的怪物家族池。執行期由城主依池選擇具體怪物。</p>
  </div>

  <div class="pool-toolbar">
    <button class="btn-primary" onclick="openFamilyPicker('primary')">＋ 加入主家族</button>
    <button onclick="openFamilyPicker('secondary')">＋ 加入副家族</button>
  </div>

  <div id="monster-pool-list"></div>

  <!-- 家族下的頭目指定 -->
  <div id="monster-pool-boss-section" class="editor-section">
    <h3>固定頭目/巨頭</h3>
    <p class="hint">若本關卡要有特定的頭目戰,可直接指定具體怪物(非家族)</p>
    <div id="fixed-boss-list"></div>
    <button type="button" onclick="openBossPicker()">＋ 指定固定頭目</button>
  </div>
</section>
```

### 5.2 家族列表渲染

```javascript
async function renderMonsterPoolTab() {
  if (!currentStage) return;
  const res = await adminFetch(`/api/stages/${currentStage.id}/monster-pool`);
  currentMonsterPool = await res.json();

  await loadAllFamilies();

  renderMonsterPoolList();
  renderFixedBossList();
}

function renderMonsterPoolList() {
  const listEl = document.getElementById('monster-pool-list');

  if (currentMonsterPool.length === 0) {
    listEl.innerHTML = '<p class="empty">尚未指派家族</p>';
    return;
  }

  listEl.innerHTML = currentMonsterPool.map(item => {
    const family = allFamiliesCache.find(f => f.code === item.family_code);
    const familyName = family?.name_zh || item.family_code;

    return `
      <div class="family-pool-row ${item.role}" data-id="${item.id}">
        <div class="family-info">
          <span class="role-badge role-${item.role}">${item.role === 'primary' ? '主家族' : '副家族'}</span>
          <strong>${escapeHtml(familyName)}</strong>
          <code>${escapeHtml(item.family_code)}</code>
        </div>
        <div class="family-tiers">
          <label>允許位階:</label>
          ${['minion', 'threat', 'elite', 'boss', 'titan'].map(tier => `
            <label class="tier-chip">
              <input type="checkbox" value="${tier}" ${item.allowed_tiers?.includes(tier) ? 'checked' : ''}
                     onchange="updatePoolTier('${item.id}', '${tier}', this.checked)">
              ${tierLabel(tier)}
            </label>
          `).join('')}
        </div>
        <div class="family-actions">
          <button onclick="removeFamilyFromPool('${item.id}')" class="btn-danger">移除</button>
        </div>
      </div>
    `;
  }).join('');
}
```

### 5.3 家族挑選對話框

```html
<div id="dialog-family-picker" class="dialog" style="display:none">
  <div class="dialog-content">
    <h3 id="family-picker-title">選擇家族</h3>

    <div class="family-picker-list">
      <!-- 動態渲染家族卡 -->
    </div>

    <div class="dialog-footer">
      <button onclick="closeDialog('family-picker')">取消</button>
    </div>
  </div>
</div>
```

```javascript
function openFamilyPicker(role) {
  document.getElementById('family-picker-title').textContent =
    role === 'primary' ? '選擇主家族' : '選擇副家族';

  const existingCodes = new Set(currentMonsterPool.map(p => p.family_code));
  const available = allFamiliesCache.filter(f => !existingCodes.has(f.code));

  const listEl = document.querySelector('.family-picker-list');
  listEl.innerHTML = available.map(f => `
    <div class="family-card" onclick="addFamilyToPool('${f.code}', '${role}'); closeDialog('family-picker')">
      <strong>${escapeHtml(f.name_zh)}</strong>
      <code>${escapeHtml(f.code)}</code>
      <p>${escapeHtml(f.description_zh || '')}</p>
    </div>
  `).join('');

  openDialog('family-picker');
}

async function addFamilyToPool(familyCode, role) {
  // 主家族限制 1–2 個
  const existingPrimary = currentMonsterPool.filter(p => p.role === 'primary').length;
  if (role === 'primary' && existingPrimary >= 2) {
    alert('主家族已達 2 個上限');
    return;
  }

  await adminFetch(`/api/stages/${currentStage.id}/monster-pool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      family_code: familyCode,
      role,
      allowed_tiers: ['minion', 'threat']  // 預設位階
    })
  });

  await renderMonsterPoolTab();
  // 更新混沌袋的家族建議
  applySuggestionsBasedOnMonsterPool();
}
```

### 5.4 固定頭目指定

固定頭目從 MOD-03 的 `monster_variants` 選取(位階為 `boss` 或 `titan` 的變體)。

```html
<div id="dialog-boss-picker" class="dialog dialog-large" style="display:none">
  <div class="dialog-content">
    <h3>指定固定頭目/巨頭</h3>

    <div class="picker-toolbar">
      <input type="search" id="boss-picker-search" oninput="filterBossPicker()">
      <select id="boss-picker-tier-filter" onchange="filterBossPicker()">
        <option value="">全部位階</option>
        <option value="boss">頭目</option>
        <option value="titan">巨頭</option>
      </select>
      <select id="boss-picker-family-filter" onchange="filterBossPicker()">
        <option value="">全部家族</option>
        <!-- 動態填入 -->
      </select>
    </div>

    <div id="boss-picker-list" class="picker-list"></div>

    <div class="dialog-footer">
      <button onclick="closeDialog('boss-picker')">取消</button>
    </div>
  </div>
</div>
```

```javascript
async function openBossPicker() {
  await loadBossVariants();
  renderBossPickerList();
  openDialog('boss-picker');
}

let allBossVariantsCache = null;

async function loadBossVariants() {
  if (allBossVariantsCache) return;
  // 取得所有 tier 為 boss 或 titan 的變體
  const res = await adminFetch('/api/monsters/variants?tiers=boss,titan');
  allBossVariantsCache = await res.json();
}

function renderBossPickerList() {
  const search = document.getElementById('boss-picker-search').value.toLowerCase();
  const tierFilter = document.getElementById('boss-picker-tier-filter').value;
  const familyFilter = document.getElementById('boss-picker-family-filter').value;

  const filtered = allBossVariantsCache.filter(v => {
    if (search && !v.name_zh.toLowerCase().includes(search)) return false;
    if (tierFilter && v.tier !== tierFilter) return false;
    if (familyFilter && v.family_code !== familyFilter) return false;
    return true;
  });

  const listEl = document.getElementById('boss-picker-list');
  listEl.innerHTML = filtered.map(v => `
    <div class="boss-card" onclick="addFixedBoss('${v.id}')">
      <strong>${escapeHtml(v.name_zh)}</strong>
      <span class="tier-badge tier-${v.tier}">${tierLabel(v.tier)}</span>
      <p>家族:${escapeHtml(v.family_name_zh)}</p>
      <p class="stats">HP ${v.hp} / DMG ${v.damage}</p>
    </div>
  `).join('');
}

async function addFixedBoss(variantId) {
  // 將此 boss 加到對應家族的 fixed_boss_ids
  const variant = allBossVariantsCache.find(v => v.id === variantId);
  let targetPool = currentMonsterPool.find(p => p.family_code === variant.family_code);

  if (!targetPool) {
    // 若此家族尚未在池中,先加入
    await adminFetch(`/api/stages/${currentStage.id}/monster-pool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family_code: variant.family_code,
        role: 'primary',
        allowed_tiers: [variant.tier]
      })
    });
    await renderMonsterPoolTab();
    targetPool = currentMonsterPool.find(p => p.family_code === variant.family_code);
  }

  const newBossIds = [...(targetPool.fixed_boss_ids || []), variantId];
  await adminFetch(`/api/monster-pool/${targetPool.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fixed_boss_ids: newBossIds })
  });

  closeDialog('boss-picker');
  await renderMonsterPoolTab();
}
```

### 5.5 固定頭目列表

```javascript
function renderFixedBossList() {
  const listEl = document.getElementById('fixed-boss-list');
  const allBosses = [];

  for (const pool of currentMonsterPool) {
    for (const bossId of (pool.fixed_boss_ids || [])) {
      const variant = allBossVariantsCache?.find(v => v.id === bossId);
      if (variant) allBosses.push({ pool, variant });
    }
  }

  if (allBosses.length === 0) {
    listEl.innerHTML = '<p class="empty">尚未指定固定頭目</p>';
    return;
  }

  listEl.innerHTML = allBosses.map(item => `
    <div class="fixed-boss-row">
      <span class="tier-badge tier-${item.variant.tier}">${tierLabel(item.variant.tier)}</span>
      <strong>${escapeHtml(item.variant.name_zh)}</strong>
      <span>家族:${escapeHtml(item.variant.family_name_zh)}</span>
      <button onclick="removeFixedBoss('${item.pool.id}', '${item.variant.id}')" class="btn-danger">移除</button>
    </div>
  `).join('');
}

async function removeFixedBoss(poolId, variantId) {
  const pool = currentMonsterPool.find(p => p.id === poolId);
  const newIds = (pool.fixed_boss_ids || []).filter(id => id !== variantId);

  await adminFetch(`/api/monster-pool/${poolId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fixed_boss_ids: newIds })
  });

  await renderMonsterPoolTab();
}
```

---

## 六、右側預覽欄更新

各分頁的預覽內容:

```javascript
function updateRightPanel() {
  // ...延伸 Part 2 的 switch

  switch (currentTab) {
    case 'chaos-bag':
      renderChaosBagMiniPreview(container);
      break;
    case 'encounter-pool':
    case 'mythos-pool':
      renderPoolMiniPreview(container, currentTab);
      break;
    case 'monster-pool':
      renderMonsterPoolMiniPreview(container);
      break;
  }
}

function renderChaosBagMiniPreview(container) {
  const bag = collectChaosBagFromForm();
  const stats = calculateChaosBagStats(bag);
  container.innerHTML = `
    <div class="preview-card">
      <h4>混沌袋摘要</h4>
      <p>總數:${stats.totalCount}</p>
      <p>期望值:${stats.expectedValue.toFixed(2)}</p>
      <p>失敗率:${(stats.failRateDc4 * 100).toFixed(1)}%</p>

      <h5>標記分佈(視覺化)</h5>
      <div class="marker-bars">
        ${renderMarkerBars(bag)}
      </div>
    </div>
  `;
}

function renderMonsterPoolMiniPreview(container) {
  if (!currentMonsterPool?.length) {
    container.innerHTML = '<p class="placeholder">尚未指派家族</p>';
    return;
  }

  container.innerHTML = `
    <div class="preview-card">
      <h4>怪物家族池摘要</h4>
      ${currentMonsterPool.map(p => `
        <div class="mini-family">
          <strong>${escapeHtml(allFamiliesCache?.find(f => f.code === p.family_code)?.name_zh || p.family_code)}</strong>
          <span class="role-badge role-${p.role}">${p.role === 'primary' ? '主' : '副'}</span>
          <p>位階:${(p.allowed_tiers || []).map(tierLabel).join(', ')}</p>
        </div>
      `).join('')}
    </div>
  `;
}
```

---

## 七、驗收清單

- [ ] 混沌袋配置分頁:四類標記完整可編輯
- [ ] 難度預設按鈕可一鍵套用 4 種配置
- [ ] 情境標記的場景效果下拉顯示對應四類的效果選項
- [ ] 指派主家族後,情境標記旁顯示家族推薦效果,可一鍵套用
- [ ] 配置摘要顯示總數、期望值、失敗率、極端事件率
- [ ] 儲存混沌袋成功
- [ ] 遭遇卡池分頁:顯示已引用卡清單,可調整權重、移除
- [ ] 遭遇卡選取對話框從 MOD-10 載入完整卡庫,支援搜尋與類型篩選
- [ ] 多選加入後,對話框關閉,主表格更新
- [ ] 神話卡池分頁:結構與遭遇卡池對稱
- [ ] 主線關卡神話卡池為空時顯示警示橫幅
- [ ] 怪物家族池分頁:可加入主家族(上限 2 個)與副家族
- [ ] 每個家族可勾選允許的位階
- [ ] 指定固定頭目對話框從 MOD-03 載入 boss/titan 變體
- [ ] 選定頭目後自動加入對應家族池(若家族不在池中則自動建立)
- [ ] 右側預覽顯示各分頁的對應摘要

---

## 八、實作注意事項

1. **混沌袋計算公式簡化合理**:精確計算混沌袋期望值需考慮修正與重抽規則,本份用加權平均近似即可(真實模擬留給後端或未來的模擬器工具)
2. **MOD-10 資料的欄位名稱以實際 API 為準**:遭遇卡的 `encounter_type`、神話卡的 `mythos_type` 可能與本份假設不同,實作時查驗 API 回應
3. **家族資料從 MOD-03 載入**:`/api/monsters/families` 是否存在需確認;若端點不存在,使用 `/api/admin/monster-families` 或其他實際路徑
4. **固定頭目挑選**的過濾邏輯要防止跨家族混亂——例如只在 primary 家族中放主家族的頭目
5. **家族池更新時觸發混沌袋建議重新計算**,讓設計師即時看到家族切換的影響
6. **所有分頁切換時才載入對應資料**(lazy load),避免初始化過重

---

## 九、下一份指令

Part 5 將產出最後三個分頁:重返覆寫(`side_return`)、隨機地城規則(`side_random`)、完整性檢查;以及 AI 整合(Gemini Prompt 模板)、MEMORY.md 與檔案索引更新。
