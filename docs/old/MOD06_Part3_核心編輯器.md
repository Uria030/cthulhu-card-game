# MOD-06 戰役敘事設計器 · Claude Code 指令 Part 3:核心編輯器

> **系列**:MOD-06 實作指令 · 第 3 份 / 共 4 份
> **依據規格**:`MOD06_戰役敘事設計器_總覽規格_v0_2.md`
> **前置條件**:Part 1 + Part 2 已完成
> **本份產出**:章節編輯分頁、旗標字典、間章事件、混沌袋演變、條件表達式編輯器共用元件
> **執行角色**:Claude Code 依此文件實作檔案變更

---

## 一、任務範圍

本份指令填入 MOD-06 剩餘五個分頁中的四個(完整性檢查留給 Part 4):

- **章節編輯分頁**:章節基礎欄位、劇情演示、結果分支五槽(A–E)
- **旗標字典分頁**:旗標清單、新增/刪除、反向引用追蹤
- **間章事件分頁**:事件清單、編輯器、綁定章節、六類操作清單
- **混沌袋演變分頁**:每章每結果的演變規則 + 終局模擬器
- **共用元件**:條件表達式編輯器(供結果分支與間章事件使用)

本份實作的所有內容皆加入 `admin-campaign.html`(不拆檔)。

---

## 二、章節編輯分頁(`#tab-chapters`)

### 2.1 分頁結構

章節編輯分頁採**兩欄式佈局**:左側章節切換列、右側當前章節編輯區。

```html
<section id="tab-chapters" class="tab-content">
  <div class="chapters-layout">
    <!-- 左側:章節切換列(十章標籤) -->
    <div class="chapter-nav">
      <!-- 以 JS 動態渲染十個按鈕 -->
    </div>

    <!-- 右側:當前章節編輯區 -->
    <div class="chapter-editor" id="chapter-editor-container">
      <div class="no-chapter-placeholder">請選擇章節</div>
    </div>
  </div>
</section>
```

### 2.2 章節切換列

```javascript
function renderChapterNav() {
  if (!currentCampaign) return;
  const nav = document.querySelector('.chapter-nav');
  nav.innerHTML = '';

  currentCampaign.chapters.forEach(ch => {
    const btn = document.createElement('button');
    btn.className = 'chapter-tab-btn';
    btn.dataset.chapterId = ch.id;
    btn.innerHTML = `
      <span class="ch-num">${ch.chapter_number}</span>
      <span class="ch-name">${escapeHtml(ch.name_zh || ch.chapter_code)}</span>
      <span class="ch-status status-${ch.design_status}"></span>
    `;
    btn.onclick = () => selectChapter(ch.id);
    nav.appendChild(btn);
  });
}

async function selectChapter(chapterId) {
  if (dirty && !confirm('有未儲存變更,要放棄嗎?')) return;

  // 標記選中的章節按鈕
  document.querySelectorAll('.chapter-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.chapterId === chapterId);
  });

  // 從 API 載入章節完整資料
  const res = await adminFetch(`/api/chapters/${chapterId}`);
  currentChapter = await res.json();
  renderChapterEditor();
  clearDirty();
}
```

### 2.3 章節編輯區結構

`currentChapter` 物件載入後,渲染成三大區塊:

```html
<div class="chapter-editor">
  <!-- 區塊一:章節基礎資料 -->
  <section class="editor-section">
    <h3>基礎資料</h3>
    <label>章節縮寫 <input type="text" id="ch-code" maxlength="16"></label>
    <label>中文名稱 <input type="text" id="ch-name-zh"></label>
    <label>英文名稱 <input type="text" id="ch-name-en"></label>
    <label>敘事定位(給設計師看的摘要)
      <textarea id="ch-narrative-positioning" rows="2"></textarea>
    </label>
    <label>設計狀態
      <select id="ch-design-status">
        <option value="draft">草稿</option>
        <option value="review">審核中</option>
        <option value="published">已發佈</option>
      </select>
    </label>
  </section>

  <!-- 區塊二:劇情演示 -->
  <section class="editor-section">
    <h3>劇情演示</h3>
    <label>演示文字
      <textarea id="ch-narrative-intro" rows="6"></textarea>
      <button type="button" onclick="aiGenerateNarrativeIntro()">AI 生成</button>
    </label>
    <div class="narrative-choices-editor">
      <h4>劇情選項</h4>
      <div id="narrative-choices-list"></div>
      <button type="button" onclick="addNarrativeChoice()">＋ 新增選項</button>
    </div>
  </section>

  <!-- 區塊三:結果分支五槽 -->
  <section class="editor-section">
    <h3>結果分支 (A–E)</h3>
    <div class="outcome-slots">
      <!-- 以 JS 動態渲染五槽 -->
    </div>
  </section>

  <!-- 區塊四:關卡引用清單(唯讀) -->
  <section class="editor-section">
    <h3>掛載的關卡</h3>
    <div id="linked-stages-list">
      <!-- 從 currentChapter.linked_stages 渲染;空時顯示提示 -->
    </div>
    <p class="hint">關卡在 MOD-07 關卡編輯器中建立,此處僅顯示引用</p>
  </section>

  <!-- 底部操作列 -->
  <div class="editor-footer">
    <button class="btn-primary" onclick="saveChapter()">儲存章節</button>
  </div>
</div>
```

### 2.4 劇情選項編輯

劇情選項的 JSON 結構(儲存於 `chapters.narrative_choices`):

```json
[
  {
    "id": "choice_1",
    "text_zh": "跟隨陌生人進入迷霧",
    "text_en": "Follow the stranger into the mist",
    "effect": {
      "set_flags": [{ "flag_code": "choice.ch1_followed_stranger", "value": true }]
    }
  }
]
```

編輯介面每個選項一列,含:
- 選項 ID(唯讀,自動產生 `choice_1`, `choice_2`...)
- 選項文字(中文、英文)
- 影響(設定哪些旗標——此處用旗標下拉多選,從當前戰役字典載入)

### 2.5 結果分支五槽編輯器

五個槽位固定顯示(A, B, C, D, E),每槽有「啟用/停用」開關。至少 2 槽啟用。

```javascript
function renderOutcomeSlots() {
  const container = document.querySelector('.outcome-slots');
  container.innerHTML = '';

  const codes = ['A', 'B', 'C', 'D', 'E'];
  const existingOutcomes = currentChapter.outcomes || [];
  const existingMap = {};
  existingOutcomes.forEach(o => { existingMap[o.outcome_code] = o; });

  codes.forEach(code => {
    const outcome = existingMap[code];
    const enabled = !!outcome;
    const slot = document.createElement('div');
    slot.className = `outcome-slot ${enabled ? 'enabled' : 'disabled'}`;
    slot.dataset.code = code;
    slot.innerHTML = renderOutcomeSlotHTML(code, outcome);
    container.appendChild(slot);
  });
}

function renderOutcomeSlotHTML(code, outcome) {
  const enabled = !!outcome;
  return `
    <div class="outcome-header">
      <h4>結果 ${code}</h4>
      <label class="toggle">
        <input type="checkbox" ${enabled ? 'checked' : ''}
               onchange="toggleOutcome('${code}', this.checked)">
        啟用
      </label>
    </div>
    <div class="outcome-body" style="${enabled ? '' : 'display:none'}">
      <label>判定條件
        <div class="condition-expression-editor" data-outcome="${code}">
          ${renderConditionExpressionHTML(outcome?.condition_expression)}
        </div>
      </label>
      <label>敘事文字
        <textarea rows="4" data-outcome-field="${code}_narrative"
                  onchange="markDirty()">${outcome?.narrative_text || ''}</textarea>
      </label>
      <label>下一章指向
        <select data-outcome-field="${code}_next" onchange="markDirty()">
          <option value="">(不指向/終局)</option>
          ${renderNextChapterOptions()}
        </select>
      </label>
      <label>授予旗標
        <div class="flag-multiselect" data-outcome-field="${code}_flags">
          ${renderFlagMultiSelect(outcome?.flag_sets)}
        </div>
      </label>
      <label>混沌袋演變規則
        <div class="chaos-bag-changes-editor" data-outcome-field="${code}_changes">
          ${renderChaosBagChangesHTML(outcome?.chaos_bag_changes)}
        </div>
      </label>
      <label>結算獎勵
        <div class="rewards-editor" data-outcome-field="${code}_rewards">
          ${renderRewardsHTML(outcome?.rewards)}
        </div>
      </label>
    </div>
  `;
}
```

### 2.6 啟用/停用結果槽

```javascript
function toggleOutcome(code, enabled) {
  if (enabled) {
    // 新增一筆空結果
    const newOutcome = {
      outcome_code: code,
      condition_expression: {},
      narrative_text: '',
      next_chapter_version: null,
      flag_sets: [],
      chaos_bag_changes: [],
      rewards: {}
    };
    currentChapter.outcomes.push(newOutcome);
  } else {
    // 停用即從記憶體移除(儲存時對應 DELETE)
    if (!confirm(`確定停用結果 ${code}?此槽的所有設定將在儲存後消失`)) {
      event.target.checked = true;
      return;
    }
    currentChapter.outcomes = currentChapter.outcomes.filter(o => o.outcome_code !== code);
  }
  renderOutcomeSlots();
  markDirty();
}
```

### 2.7 儲存章節

```javascript
async function saveChapter() {
  if (!currentChapter) return;

  // 先存章節主欄位
  const chapterPayload = {
    chapter_code: document.getElementById('ch-code').value,
    name_zh: document.getElementById('ch-name-zh').value,
    name_en: document.getElementById('ch-name-en').value,
    narrative_intro: document.getElementById('ch-narrative-intro').value,
    narrative_choices: collectNarrativeChoices(),
    design_status: document.getElementById('ch-design-status').value
  };

  const chRes = await adminFetch(`/api/chapters/${currentChapter.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(chapterPayload)
  });
  if (!chRes.ok) {
    const err = await chRes.json();
    showToast('儲存章節失敗:' + err.error, 'error');
    return;
  }

  // 收集目前記憶體中的結果分支
  const collectedOutcomes = collectOutcomesFromForm();

  // 現有的 outcomes(從最後一次 load 取得的 ID)
  const originalIds = (currentChapter._originalOutcomes || []).map(o => o.id);
  const currentIds = collectedOutcomes.filter(o => o.id).map(o => o.id);

  // 刪除被移除的
  const toDelete = originalIds.filter(id => !currentIds.includes(id));
  for (const id of toDelete) {
    await adminFetch(`/api/outcomes/${id}`, { method: 'DELETE' });
  }

  // 更新或新增
  for (const outcome of collectedOutcomes) {
    if (outcome.id) {
      await adminFetch(`/api/outcomes/${outcome.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outcome)
      });
    } else {
      await adminFetch(`/api/chapters/${currentChapter.id}/outcomes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outcome)
      });
    }
  }

  // 重新載入章節
  await selectChapter(currentChapter.id);
  await loadCampaignDetail(currentCampaign.id);
  renderChapterNav();

  clearDirty();
  showToast('章節已儲存', 'success');
}
```

---

## 三、旗標字典分頁(`#tab-flags`)

### 3.1 分頁結構

```html
<section id="tab-flags" class="tab-content">
  <div class="flags-toolbar">
    <input type="search" id="flag-search" placeholder="搜尋旗標代碼…" oninput="renderFlagsList()">
    <select id="flag-category-filter" onchange="renderFlagsList()">
      <option value="">全部類別</option>
      <!-- 九大類別選項 -->
    </select>
    <button class="btn-primary" onclick="openNewFlagDialog()">＋ 新增旗標</button>
  </div>

  <div class="flags-table-wrapper">
    <table class="flags-table">
      <thead>
        <tr>
          <th>旗標代碼</th>
          <th>類別</th>
          <th>章節</th>
          <th>描述</th>
          <th>可見性</th>
          <th>被引用</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="flags-tbody">
        <!-- 動態渲染 -->
      </tbody>
    </table>
  </div>
</section>
```

### 3.2 載入與渲染

```javascript
async function renderFlagsTab() {
  if (!currentCampaign) return;

  // 填入類別篩選下拉
  const catFilter = document.getElementById('flag-category-filter');
  if (catFilter.children.length === 1) {
    campaignOptions.flag_categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.code;
      opt.textContent = cat.name_zh;
      catFilter.appendChild(opt);
    });
  }

  await loadFlags();
  renderFlagsList();
}

async function loadFlags() {
  const res = await adminFetch(`/api/campaigns/${currentCampaign.id}/flags`);
  currentFlags = await res.json();
}

function renderFlagsList() {
  const search = document.getElementById('flag-search').value.toLowerCase();
  const category = document.getElementById('flag-category-filter').value;
  const tbody = document.getElementById('flags-tbody');

  const filtered = currentFlags.filter(f => {
    if (search && !f.flag_code.toLowerCase().includes(search)) return false;
    if (category && f.category !== category) return false;
    return true;
  });

  tbody.innerHTML = filtered.map(f => `
    <tr>
      <td><code>${escapeHtml(f.flag_code)}</code></td>
      <td><span class="cat-badge cat-${f.category}">${categoryLabel(f.category)}</span></td>
      <td>${escapeHtml(f.chapter_code || '—')}</td>
      <td>${escapeHtml(f.description_zh || '')}</td>
      <td>${visibilityLabel(f.visibility)}</td>
      <td>${f.reference_count || 0}</td>
      <td>
        <button onclick="openEditFlagDialog('${f.id}')">編輯</button>
        <button onclick="deleteFlag('${f.id}')" class="btn-danger">刪除</button>
      </td>
    </tr>
  `).join('');
}
```

### 3.3 新增/編輯旗標對話框

```html
<div id="dialog-flag-editor" class="dialog" style="display:none">
  <div class="dialog-content">
    <h3 id="flag-dialog-title">新增旗標</h3>
    <label>類別
      <select id="flag-dlg-category" onchange="updateFlagCodePrefix()">
        <!-- 九大類別 -->
      </select>
    </label>
    <label>章節(可選,若為章節範疇)
      <select id="flag-dlg-chapter">
        <option value="">(戰役全域)</option>
        <!-- ch1 ~ ch10 -->
      </select>
    </label>
    <label>旗標代碼
      <div class="code-input-wrapper">
        <span id="flag-dlg-prefix" class="code-prefix"></span>
        <input type="text" id="flag-dlg-suffix" placeholder="描述_片段">
      </div>
      <small>最終代碼:<code id="flag-dlg-preview"></code></small>
    </label>
    <label>描述
      <textarea id="flag-dlg-desc" rows="2"></textarea>
    </label>
    <label>可見性
      <select id="flag-dlg-visibility">
        <option value="visible">可見</option>
        <option value="conditional">視設計</option>
        <option value="hidden">永遠隱藏</option>
      </select>
    </label>
    <div class="dialog-footer">
      <button onclick="closeDialog('flag-editor')">取消</button>
      <button class="btn-primary" onclick="saveFlag()">儲存</button>
    </div>
  </div>
</div>
```

旗標代碼的即時預覽:`[類別].[章節縮寫]_[描述]`。例如類別 `npc`、章節 `ch5`、描述 `henry_alive` → 預覽為 `npc.ch5_henry_alive`。

### 3.4 刪除旗標

```javascript
async function deleteFlag(flagId) {
  if (!confirm('確定刪除此旗標?')) return;

  const res = await adminFetch(`/api/flags/${flagId}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json();
    // 後端回傳 referenced_by 清單時,顯示在哪被引用
    if (err.referenced_by) {
      const details = err.referenced_by.map(r => `• ${r.type}: ${r.name}`).join('\n');
      alert(`無法刪除,此旗標仍被引用:\n\n${details}`);
    } else {
      alert('刪除失敗:' + err.error);
    }
    return;
  }
  await loadFlags();
  renderFlagsList();
  showToast('旗標已刪除', 'success');
}
```

### 3.5 旗標多選元件(供結果分支、間章事件使用)

這是共用 widget,集中實作在 `renderFlagMultiSelect(selectedFlags)`:

```javascript
function renderFlagMultiSelect(selected = []) {
  const selectedCodes = new Set((selected || []).map(s =>
    typeof s === 'string' ? s : s.flag_code
  ));
  return `
    <div class="flag-ms">
      <div class="flag-ms-selected">
        ${[...selectedCodes].map(code => `
          <span class="flag-chip">
            <code>${escapeHtml(code)}</code>
            <button type="button" onclick="removeFlagChip(this, '${code}')">×</button>
          </span>
        `).join('')}
      </div>
      <button type="button" onclick="openFlagPicker(this)">＋ 加入旗標</button>
    </div>
  `;
}

function openFlagPicker(btn) {
  // 彈出對話框列出 currentFlags,多選後回填到 btn 所在的 flag-ms
}
```

---

## 四、間章事件分頁(`#tab-interludes`)

### 4.1 分頁結構

```html
<section id="tab-interludes" class="tab-content">
  <div class="interludes-layout">
    <!-- 左側:事件清單(依章節分組) -->
    <div class="interludes-nav">
      <button class="btn-primary" onclick="openNewInterludeDialog()">＋ 新事件</button>
      <div id="interludes-grouped-list"></div>
    </div>

    <!-- 右側:事件編輯器 -->
    <div class="interlude-editor" id="interlude-editor-container">
      <div class="placeholder">請選擇事件</div>
    </div>
  </div>
</section>
```

### 4.2 事件清單(依章節 × 插入點分組)

```javascript
async function renderInterludesTab() {
  if (!currentCampaign) return;
  await loadAllInterludes();
  renderInterludesGrouped();
}

async function loadAllInterludes() {
  // 呼叫每章的 /api/chapters/:id/interlude-events
  const promises = currentCampaign.chapters.map(ch =>
    adminFetch(`/api/chapters/${ch.id}/interlude-events`).then(r => r.json())
      .then(events => ({ chapter: ch, events }))
  );
  currentInterludeGroups = await Promise.all(promises);
}

function renderInterludesGrouped() {
  const container = document.getElementById('interludes-grouped-list');
  container.innerHTML = currentInterludeGroups.map(group => `
    <div class="interlude-group">
      <h4>${group.chapter.chapter_number}. ${escapeHtml(group.chapter.name_zh || group.chapter.chapter_code)}</h4>
      <div class="interlude-subgroup">
        <h5>章首 (Prologue)</h5>
        ${group.events.filter(e => e.insertion_point === 'prologue')
          .map(renderInterludeListItem).join('') || '<p class="empty">無</p>'}
      </div>
      <div class="interlude-subgroup">
        <h5>章末 (Epilogue)</h5>
        ${group.events.filter(e => e.insertion_point === 'epilogue')
          .map(renderInterludeListItem).join('') || '<p class="empty">無</p>'}
      </div>
    </div>
  `).join('');
}

function renderInterludeListItem(event) {
  return `
    <div class="interlude-item" onclick="selectInterlude('${event.id}')">
      <code>${escapeHtml(event.event_code)}</code>
      <span>${escapeHtml(event.name_zh)}</span>
    </div>
  `;
}
```

### 4.3 事件編輯器

```html
<div class="interlude-editor">
  <section class="editor-section">
    <h3>基礎資料</h3>
    <label>事件代碼 <input type="text" id="iv-event-code" maxlength="64"></label>
    <label>中文名稱 <input type="text" id="iv-name-zh"></label>
    <label>英文名稱 <input type="text" id="iv-name-en"></label>
    <label>綁定章節
      <select id="iv-chapter">
        <!-- 十章選項 -->
      </select>
    </label>
    <label>插入點
      <select id="iv-insertion-point">
        <option value="prologue">章首</option>
        <option value="epilogue">章末</option>
      </select>
    </label>
  </section>

  <section class="editor-section">
    <h3>觸發條件</h3>
    <label class="checkbox-label">
      <input type="checkbox" id="iv-has-condition" onchange="toggleInterludeCondition()">
      有觸發條件(否則無條件觸發)
    </label>
    <div id="iv-condition-editor" style="display:none">
      <!-- 使用共用條件表達式編輯器 -->
    </div>
  </section>

  <section class="editor-section">
    <h3>執行操作</h3>
    <div id="iv-operations-list"></div>
    <button type="button" onclick="addInterludeOperation()">＋ 新增操作</button>
  </section>

  <section class="editor-section">
    <h3>敘事文字</h3>
    <label>中文敘事 <textarea id="iv-narrative-zh" rows="6"></textarea>
      <button type="button" onclick="aiGenerateInterludeNarrative()">AI 生成</button>
    </label>
    <label>英文敘事 <textarea id="iv-narrative-en" rows="6"></textarea>
      <button type="button" onclick="aiTranslate('iv-narrative-zh', 'iv-narrative-en')">中譯英</button>
    </label>
  </section>

  <section class="editor-section">
    <h3>選項(若事件含選擇)</h3>
    <div id="iv-choices-list"></div>
    <button type="button" onclick="addInterludeChoice()">＋ 新增選項</button>
  </section>

  <div class="editor-footer">
    <button class="btn-primary" onclick="saveInterludeEvent()">儲存事件</button>
    <button class="btn-danger" onclick="deleteInterludeEvent()">刪除</button>
  </div>
</div>
```

### 4.4 執行操作六類

操作清單的 JSON 結構:

```json
[
  {
    "type": "consume_resource",
    "params": { "resource": "hp", "amount": 2, "target": "all_investigators" }
  },
  {
    "type": "set_flag",
    "params": { "flag_code": "npc.ch3_priest_killed", "value": true }
  },
  {
    "type": "trigger_test",
    "params": {
      "attribute": "willpower", "dc": 4,
      "on_success": { "rewards": { "xp": 1 } },
      "on_fail": { "set_flags": [/* … */] }
    }
  },
  {
    "type": "give_choice",
    "params": { "choices": [/* … */] }
  },
  {
    "type": "grant_reward",
    "params": { "xp": 2, "talent_point": 1 }
  },
  {
    "type": "apply_penalty",
    "params": { "san_damage": 1 }
  }
]
```

UI 每個操作一列,點擊「類型」下拉後動態顯示對應參數欄位。類似 MOD-01 效果編輯器的動態欄模式。

六類操作代碼:`consume_resource` / `set_flag` / `trigger_test` / `give_choice` / `grant_reward` / `apply_penalty`。

### 4.5 儲存事件

```javascript
async function saveInterludeEvent() {
  const payload = {
    event_code: document.getElementById('iv-event-code').value,
    name_zh: document.getElementById('iv-name-zh').value,
    name_en: document.getElementById('iv-name-en').value,
    insertion_point: document.getElementById('iv-insertion-point').value,
    trigger_condition: collectInterludeCondition(),  // null 或物件
    operations: collectInterludeOperations(),
    narrative_text_zh: document.getElementById('iv-narrative-zh').value,
    narrative_text_en: document.getElementById('iv-narrative-en').value,
    choices: collectInterludeChoices()
  };

  const chapterId = document.getElementById('iv-chapter').value;
  const isNew = !currentInterlude?.id;

  const url = isNew
    ? `/api/chapters/${chapterId}/interlude-events`
    : `/api/interlude-events/${currentInterlude.id}`;

  const res = await adminFetch(url, {
    method: isNew ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.json();
    if (err.details) {
      const msgs = [];
      if (err.details.missing_flags?.length) msgs.push('缺漏旗標:' + err.details.missing_flags.join(', '));
      if (err.details.missing_families?.length) msgs.push('缺漏怪物家族:' + err.details.missing_families.join(', '));
      if (err.details.missing_mythos?.length) msgs.push('缺漏神話卡:' + err.details.missing_mythos.join(', '));
      alert('儲存失敗:\n' + msgs.join('\n'));
    } else {
      alert('儲存失敗:' + err.error);
    }
    return;
  }

  await renderInterludesTab();
  showToast('事件已儲存', 'success');
}
```

---

## 五、混沌袋演變分頁(`#tab-chaos-evolution`)

### 5.1 分頁結構

此分頁**唯讀顯示各章各結果的演變規則**(實際編輯在章節編輯分頁的結果分支中),並提供**終局模擬器**。

```html
<section id="tab-chaos-evolution" class="tab-content">
  <div class="evolution-layout">
    <!-- 左側:矩陣顯示 -->
    <div class="evolution-matrix">
      <h3>演變規則矩陣</h3>
      <table>
        <thead>
          <tr>
            <th>章節</th>
            <th>結果 A</th>
            <th>結果 B</th>
            <th>結果 C</th>
            <th>結果 D</th>
            <th>結果 E</th>
          </tr>
        </thead>
        <tbody id="evolution-matrix-body"></tbody>
      </table>
    </div>

    <!-- 右側:終局模擬器 -->
    <div class="evolution-simulator">
      <h3>終局混沌袋模擬</h3>
      <div class="simulator-controls">
        <label>模擬路徑
          <select id="sim-path-mode" onchange="runSimulation()">
            <option value="best">最好路徑(全選最佳結果)</option>
            <option value="worst">最壞路徑(全選最差結果)</option>
            <option value="average">平均路徑(加權平均)</option>
            <option value="custom">自訂路徑</option>
          </select>
        </label>
        <div id="sim-custom-path" style="display:none">
          <!-- 自訂模式:每章選擇結果 -->
        </div>
      </div>
      <div class="simulator-result">
        <h4>第十章結束時的混沌袋</h4>
        <div id="sim-result-display"></div>
      </div>
    </div>
  </div>
</section>
```

### 5.2 矩陣渲染

```javascript
function renderEvolutionMatrix() {
  if (!currentCampaign) return;
  const tbody = document.getElementById('evolution-matrix-body');
  tbody.innerHTML = currentCampaign.chapters.map(ch => `
    <tr>
      <td>第 ${ch.chapter_number} 章 (${escapeHtml(ch.name_zh || ch.chapter_code)})</td>
      ${['A', 'B', 'C', 'D', 'E'].map(code => {
        const outcome = ch.outcomes?.find(o => o.outcome_code === code);
        if (!outcome) return '<td class="empty">—</td>';
        return `<td>${renderChaosBagChangesSummary(outcome.chaos_bag_changes)}</td>`;
      }).join('')}
    </tr>
  `).join('');
}

function renderChaosBagChangesSummary(changes) {
  if (!changes || changes.length === 0) return '—';
  return changes.map(c => {
    const sign = c.op === 'add' ? '+' : '−';
    return `${sign}${c.count} ${markerLabel(c.marker)}`;
  }).join('<br>');
}
```

### 5.3 終局模擬

```javascript
function runSimulation() {
  const mode = document.getElementById('sim-path-mode').value;
  let path;

  if (mode === 'best') {
    path = currentCampaign.chapters.map(ch => pickBestOutcome(ch));
  } else if (mode === 'worst') {
    path = currentCampaign.chapters.map(ch => pickWorstOutcome(ch));
  } else if (mode === 'average') {
    // 對每章所有結果取平均混沌袋變化(近似)
    path = currentCampaign.chapters.map(ch => ({ averaged: true, chapter: ch }));
  } else {
    path = collectCustomPath();
  }

  const finalBag = applyAllChanges(currentCampaign.initial_chaos_bag, path);
  renderSimulationResult(finalBag);
}

function applyAllChanges(initialBag, path) {
  const bag = JSON.parse(JSON.stringify(initialBag));  // deep copy
  for (const step of path) {
    if (step.averaged) {
      applyAveragedChanges(bag, step.chapter.outcomes);
    } else if (step.chaos_bag_changes) {
      applyChanges(bag, step.chaos_bag_changes);
    }
  }
  return bag;
}

function applyChanges(bag, changes) {
  for (const change of changes) {
    // op: add / remove
    // marker: skull / cultist / tablet / elder_thing / clue / headline / monster / doom / gate / bless / curse
    // count: 數量
    const targetPath = resolveMarkerPath(change.marker);
    if (change.op === 'add') {
      targetPath.count = (targetPath.count || 0) + change.count;
    } else if (change.op === 'remove') {
      targetPath.count = Math.max(0, (targetPath.count || 0) - change.count);
    }
  }
}
```

### 5.4 終局結果顯示

```javascript
function renderSimulationResult(finalBag) {
  const container = document.getElementById('sim-result-display');
  container.innerHTML = `
    <div class="bag-summary">
      <div class="bag-group">
        <h5>數字標記</h5>
        ${renderNumberMarkersSummary(finalBag.number_markers)}
      </div>
      <div class="bag-group">
        <h5>情境標記</h5>
        ${renderScenarioMarkersSummary(finalBag.scenario_markers)}
      </div>
      <div class="bag-group">
        <h5>神話標記</h5>
        ${renderMythosMarkersSummary(finalBag.mythos_markers)}
      </div>
      <div class="bag-stats">
        <p>總標記數:${countTotalMarkers(finalBag)}</p>
        <p>期望值:${calculateExpectedValue(finalBag).toFixed(2)}</p>
        <p>變化幅度:${calculateVariance(finalBag).toFixed(2)}</p>
      </div>
    </div>
  `;
}
```

---

## 六、條件表達式編輯器(共用元件)

### 6.1 支援的表達式結構

JSON 結構(與總覽規格 §4.4 一致):

```json
{
  "type": "and",
  "conditions": [
    { "type": "flag_set", "flag_code": "npc.ch5_henry_alive" },
    {
      "type": "or",
      "conditions": [
        { "type": "flag_equals", "flag_code": "choice.ch5_path", "value": "dark" },
        { "type": "agenda_progress_gte", "value": 2 }
      ]
    }
  ]
}
```

支援的節點類型:

| 類型 | 結構 | 說明 |
|---|---|---|
| `and` | `{ type, conditions[] }` | 全部成立 |
| `or` | `{ type, conditions[] }` | 任一成立 |
| `not` | `{ type, condition }` | 單一子條件的反向 |
| `flag_set` | `{ type, flag_code }` | 旗標已設定 |
| `flag_not_set` | `{ type, flag_code }` | 旗標未設定 |
| `flag_equals` | `{ type, flag_code, value }` | 旗標值等於 |
| `act_progress_gte` | `{ type, value }` | 目標牌堆進度 ≥ |
| `agenda_progress_gte` | `{ type, value }` | 議案牌堆進度 ≥ |

### 6.2 渲染函式

```javascript
function renderConditionExpressionHTML(expr, depth = 0) {
  if (!expr || Object.keys(expr).length === 0) {
    return `
      <div class="cond-empty" data-depth="${depth}">
        <button type="button" onclick="startCondition(this, 'and')">AND</button>
        <button type="button" onclick="startCondition(this, 'or')">OR</button>
        <button type="button" onclick="startCondition(this, 'flag_set')">旗標檢查</button>
        <button type="button" onclick="startCondition(this, 'agenda_progress_gte')">議案進度</button>
      </div>
    `;
  }

  switch (expr.type) {
    case 'and':
    case 'or':
      return renderGroupNode(expr, depth);
    case 'not':
      return renderNotNode(expr, depth);
    case 'flag_set':
    case 'flag_not_set':
      return renderFlagCheckNode(expr, depth);
    case 'flag_equals':
      return renderFlagEqualsNode(expr, depth);
    case 'act_progress_gte':
    case 'agenda_progress_gte':
      return renderProgressNode(expr, depth);
  }
}

function renderGroupNode(expr, depth) {
  return `
    <div class="cond-node cond-group" data-type="${expr.type}" data-depth="${depth}">
      <div class="cond-group-header">
        <select onchange="changeGroupType(this)">
          <option value="and" ${expr.type === 'and' ? 'selected' : ''}>全部符合 (AND)</option>
          <option value="or" ${expr.type === 'or' ? 'selected' : ''}>任一符合 (OR)</option>
        </select>
        <button type="button" onclick="removeCondNode(this)" class="btn-danger">移除</button>
      </div>
      <div class="cond-children">
        ${(expr.conditions || []).map(c => renderConditionExpressionHTML(c, depth + 1)).join('')}
        <div class="cond-add-row">
          <button type="button" onclick="addCondChild(this, 'flag_set')">＋ 加入旗標條件</button>
          <button type="button" onclick="addCondChild(this, 'and')">＋ 加入 AND 群組</button>
        </div>
      </div>
    </div>
  `;
}
```

### 6.3 從 DOM 收集為 JSON

```javascript
function collectConditionExpression(containerEl) {
  const rootNode = containerEl.querySelector(':scope > .cond-node');
  if (!rootNode) return {};
  return parseConditionNode(rootNode);
}

function parseConditionNode(node) {
  const type = node.dataset.type;
  switch (type) {
    case 'and':
    case 'or':
      return {
        type,
        conditions: [...node.querySelectorAll(':scope > .cond-children > .cond-node')]
          .map(parseConditionNode)
      };
    case 'flag_set':
    case 'flag_not_set':
      return {
        type,
        flag_code: node.querySelector('.flag-select').value
      };
    case 'flag_equals':
      return {
        type,
        flag_code: node.querySelector('.flag-select').value,
        value: node.querySelector('.flag-value-input').value
      };
    case 'act_progress_gte':
    case 'agenda_progress_gte':
      return {
        type,
        value: parseInt(node.querySelector('.progress-input').value, 10)
      };
  }
}
```

### 6.4 旗標下拉從當前戰役字典載入

```javascript
function renderFlagSelect(currentCode) {
  return `
    <select class="flag-select">
      <option value="">(選擇旗標)</option>
      ${currentFlags.map(f => `
        <option value="${f.flag_code}" ${f.flag_code === currentCode ? 'selected' : ''}>
          ${escapeHtml(f.flag_code)} — ${escapeHtml(f.description_zh || '')}
        </option>
      `).join('')}
    </select>
  `;
}
```

---

## 七、驗收清單

完成本份指令後,以下應為 `true`:

- [ ] 章節編輯分頁:十章導覽列顯示,點擊切換章節
- [ ] 章節基礎欄位可編輯與儲存
- [ ] 劇情演示可新增/刪除選項,選項可綁定旗標
- [ ] 結果分支 A–E 五槽可啟用/停用,至少 2 槽啟用可儲存
- [ ] 每個啟用的結果槽可編輯判定條件、敘事、下一章指向、授予旗標、混沌袋演變、獎勵
- [ ] 旗標字典分頁:顯示戰役所有旗標,可搜尋/依類別篩選
- [ ] 新增旗標時,代碼前綴依類別與章節自動組合
- [ ] 刪除被引用的旗標時,彈出引用清單並拒絕刪除
- [ ] 間章事件分頁:事件依章節 × 插入點分組顯示
- [ ] 新增/編輯事件:基礎資料、觸發條件、執行操作六類、敘事、選項均可編輯
- [ ] 事件儲存時,引用不存在的旗標/怪物家族/神話卡會收到 400 並列出缺漏
- [ ] 混沌袋演變分頁:演變規則矩陣顯示每章每結果的變化
- [ ] 終局模擬器:選擇最好/最壞/平均路徑後,顯示第十章結束時的混沌袋組成
- [ ] 條件表達式編輯器:可建立巢狀 AND/OR/NOT,可插入旗標條件與議案進度條件
- [ ] 所有編輯區塊的 dirty 狀態正確追蹤,離頁時有提示

---

## 八、實作注意事項

1. **章節結果儲存時的刪除/更新/新增**:前端必須追蹤原始的 outcome IDs,對比儲存時的清單,正確呼叫對應的 DELETE/PUT/POST
2. **條件表達式編輯器複雜度高**,建議先做最簡層級(單一 flag_set 或 agenda_progress_gte),巢狀 AND/OR 可延後微調
3. **旗標下拉要動態更新**:新增旗標後,章節編輯與間章事件的旗標下拉應重新載入
4. **混沌袋演變規則 JSON** 與 Part 1 校驗 helper 的結構一致,`{ op, marker, count }` 三欄位
5. **終局模擬器**的「平均路徑」計算方式:對每章每種結果,取其 chaos_bag_changes 的平均值(加權 1/N)
6. **所有對話框使用 `openDialog(id)` / `closeDialog(id)`**(沿用現有模式)
7. **防止巢狀過深**:條件表達式建議限制最多 3 層 AND/OR(避免 UI 失控)

---

## 九、下一份指令

Part 4 將產出:完整性檢查分頁、AI 整合(Gemini Prompt 模板)、種子資料(示範戰役「印斯茅斯陰影」)、匯出/匯入功能。
