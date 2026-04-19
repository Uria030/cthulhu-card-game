# MOD-07 關卡編輯器 · Claude Code 指令 Part 3:目標牌堆、議案牌堆、地圖操作指令共用元件

> **系列**:MOD-07 實作指令 · 第 3 份 / 共 5 份
> **依據規格**:`MOD07_關卡編輯器_總覽規格_v0_2.md`
> **前置條件**:Part 1 + Part 2 已完成
> **本份產出**:目標牌堆分頁、議案牌堆分頁、地圖操作指令共用元件(13 種動詞)、條件表達式編輯器引用
> **執行角色**:Claude Code 依此文件實作檔案變更

---

## 一、任務範圍

本份實作三個核心元件:

- **目標牌堆分頁**(`#tab-act-cards`):目標卡正反面編輯、五大任務類型標籤、牌序調整
- **議案牌堆分頁**(`#tab-agenda-cards`):議案卡正反面編輯、毀滅門檻、後果懲罰
- **地圖操作指令共用元件**:13 種動詞、動態參數欄位、與地點挑選對話框整合(這是本份最複雜也最關鍵的部分)
- **條件表達式編輯器**:從 MOD-06 Part 3 引用或複製到本模組(供推進條件、進入條件使用)

---

## 二、地圖操作指令共用元件

### 2.1 設計原則

指令清單以**動詞陣列**儲存,每個指令有三個核心屬性:
- `verb`:動詞代碼(13 種之一)
- `params`:該動詞的參數物件
- `disabled`(可選):是否停用

JSON 範例:

```json
[
  {
    "verb": "remove_tile",
    "params": { "location_code": "mansion_hall" }
  },
  {
    "verb": "place_tile",
    "params": { "location_code": "secret_passage", "position": "central" }
  },
  {
    "verb": "connect_tiles",
    "params": { "location_a": "secret_passage", "location_b": "hidden_chamber" }
  },
  {
    "verb": "spawn_enemy",
    "params": { "family_code": "cthulhu_spawn", "tier": "threat", "location_code": "hidden_chamber", "count": 2 }
  }
]
```

### 2.2 資料檔 `data/map-operations-options.json`

這是動態欄位的**定義檔**。每個動詞描述其參數結構與 UI 渲染規則:

```json
{
  "verbs": [
    {
      "code": "place_tile",
      "name_zh": "放置地點",
      "description_zh": "將地點放入當前地圖",
      "icon": "📍",
      "category": "tile",
      "params": [
        { "key": "location_code", "type": "location_picker", "label_zh": "地點", "mode": "replace", "required": true },
        { "key": "position", "type": "select", "label_zh": "放置位置", "options": [
          { "value": "central", "label_zh": "中央" },
          { "value": "adjacent_to_spawn", "label_zh": "調查員起點相鄰" },
          { "value": "unspecified", "label_zh": "未指定(由城主判斷)" }
        ], "default": "unspecified" },
        { "key": "auto_connect_to", "type": "location_picker_multi", "label_zh": "自動連接至", "required": false }
      ]
    },
    {
      "code": "remove_tile",
      "name_zh": "移除地點",
      "description_zh": "將地點從地圖移除",
      "icon": "✖",
      "category": "tile",
      "params": [
        { "key": "location_code", "type": "location_picker", "label_zh": "地點", "mode": "replace", "required": true },
        { "key": "handle_investigators", "type": "select", "label_zh": "處理站在此地的調查員", "options": [
          { "value": "move_to_spawn", "label_zh": "移至調查員起點" },
          { "value": "move_to_nearest", "label_zh": "移至最近相鄰地點" },
          { "value": "apply_damage", "label_zh": "施加傷害" }
        ], "default": "move_to_nearest" }
      ]
    },
    {
      "code": "reveal_tile",
      "name_zh": "翻開地點",
      "description_zh": "揭開地點的隱藏資訊",
      "icon": "🔍",
      "category": "tile",
      "params": [
        { "key": "location_code", "type": "location_picker", "label_zh": "地點", "mode": "replace", "required": true },
        { "key": "hidden_info_id", "type": "text", "label_zh": "揭開的隱藏資訊 ID", "required": false, "hint": "若留空則揭開全部隱藏資訊" }
      ]
    },
    {
      "code": "flip_card",
      "name_zh": "翻面卡片",
      "description_zh": "將指定卡片翻面",
      "icon": "🔄",
      "category": "card",
      "params": [
        { "key": "target_type", "type": "select", "label_zh": "翻面對象", "options": [
          { "value": "act", "label_zh": "目標卡" },
          { "value": "agenda", "label_zh": "議案卡" },
          { "value": "location", "label_zh": "地點卡" }
        ], "required": true },
        { "key": "target_id", "type": "text", "label_zh": "對象識別(卡序或地點代碼)", "required": true }
      ]
    },
    {
      "code": "connect_tiles",
      "name_zh": "建立連接",
      "description_zh": "讓兩個地點可以互相移動",
      "icon": "⇔",
      "category": "topology",
      "params": [
        { "key": "location_a", "type": "location_picker", "label_zh": "地點 A", "mode": "replace", "required": true },
        { "key": "location_b", "type": "location_picker", "label_zh": "地點 B", "mode": "replace", "required": true },
        { "key": "cost", "type": "number", "label_zh": "移動成本", "default": 1, "min": 1, "max": 5 }
      ]
    },
    {
      "code": "disconnect_tiles",
      "name_zh": "斷開連接",
      "description_zh": "阻斷兩個地點的連接",
      "icon": "⇎",
      "category": "topology",
      "params": [
        { "key": "location_a", "type": "location_picker", "label_zh": "地點 A", "mode": "replace", "required": true },
        { "key": "location_b", "type": "location_picker", "label_zh": "地點 B", "mode": "replace", "required": true }
      ]
    },
    {
      "code": "spawn_enemy",
      "name_zh": "生成敵人",
      "description_zh": "生成新敵人(會觸發生成敘事)",
      "icon": "🐙",
      "category": "enemy",
      "params": [
        { "key": "family_code", "type": "family_picker", "label_zh": "怪物家族", "required": true },
        { "key": "tier", "type": "tier_select", "label_zh": "位階", "required": true },
        { "key": "location_code", "type": "location_picker", "label_zh": "生成地點", "mode": "replace", "required": true },
        { "key": "count", "type": "number", "label_zh": "數量", "default": 1, "min": 1, "max": 6 }
      ]
    },
    {
      "code": "place_enemy",
      "name_zh": "直接放置敵人",
      "description_zh": "直接放置敵人(不觸發生成敘事)",
      "icon": "💀",
      "category": "enemy",
      "params": [
        { "key": "family_code", "type": "family_picker", "label_zh": "怪物家族", "required": true },
        { "key": "tier", "type": "tier_select", "label_zh": "位階", "required": true },
        { "key": "location_code", "type": "location_picker", "label_zh": "放置地點", "mode": "replace", "required": true },
        { "key": "count", "type": "number", "label_zh": "數量", "default": 1, "min": 1, "max": 6 }
      ]
    },
    {
      "code": "create_light",
      "name_zh": "建立光源",
      "icon": "💡",
      "category": "environment",
      "params": [
        { "key": "location_code", "type": "location_picker", "label_zh": "地點", "mode": "replace", "required": true }
      ]
    },
    {
      "code": "extinguish_light",
      "name_zh": "熄滅光源",
      "icon": "🕯",
      "category": "environment",
      "params": [
        { "key": "location_code", "type": "location_picker", "label_zh": "地點", "mode": "replace", "required": true }
      ]
    },
    {
      "code": "create_darkness",
      "name_zh": "建立黑暗",
      "icon": "🌑",
      "category": "environment",
      "params": [
        { "key": "location_code", "type": "location_picker", "label_zh": "地點", "mode": "replace", "required": true }
      ]
    },
    {
      "code": "remove_darkness",
      "name_zh": "移除黑暗",
      "icon": "☀",
      "category": "environment",
      "params": [
        { "key": "location_code", "type": "location_picker", "label_zh": "地點", "mode": "replace", "required": true }
      ]
    },
    {
      "code": "create_fire",
      "name_zh": "建立失火",
      "icon": "🔥",
      "category": "environment",
      "params": [
        { "key": "location_code", "type": "location_picker", "label_zh": "地點", "mode": "replace", "required": true }
      ]
    },
    {
      "code": "extinguish_fire",
      "name_zh": "撲滅失火",
      "icon": "💧",
      "category": "environment",
      "params": [
        { "key": "location_code", "type": "location_picker", "label_zh": "地點", "mode": "replace", "required": true }
      ]
    },
    {
      "code": "place_clue",
      "name_zh": "放置線索",
      "icon": "🔎",
      "category": "token",
      "params": [
        { "key": "location_code", "type": "location_picker", "label_zh": "地點", "mode": "replace", "required": true },
        { "key": "count", "type": "number", "label_zh": "數量", "default": 1, "min": 1, "max": 10 }
      ]
    },
    {
      "code": "advance_act",
      "name_zh": "推進目標牌堆",
      "description_zh": "強制推進目標牌堆(無視推進條件)",
      "icon": "▶",
      "category": "meta",
      "params": []
    },
    {
      "code": "advance_agenda",
      "name_zh": "推進議案牌堆",
      "description_zh": "強制推進議案牌堆(無視毀滅門檻)",
      "icon": "⏩",
      "category": "meta",
      "params": []
    }
  ]
}
```

### 2.3 共用元件函式

元件入口:`renderMapOperationsEditor(containerEl, operations, onChange)`

```javascript
// 全域快取
let mapOperationsSchema = null;

async function loadMapOperationsSchema() {
  if (mapOperationsSchema) return mapOperationsSchema;
  const res = await fetch('data/map-operations-options.json');
  mapOperationsSchema = await res.json();
  return mapOperationsSchema;
}

function renderMapOperationsEditor(containerEl, operations, onChange) {
  containerEl.dataset.opsJson = JSON.stringify(operations || []);
  containerEl.classList.add('map-ops-editor');

  containerEl.innerHTML = `
    <div class="ops-list"></div>
    <div class="ops-add-row">
      <button type="button" class="btn-add-op">＋ 新增操作</button>
    </div>
  `;

  containerEl.querySelector('.btn-add-op').onclick = () => addOperation(containerEl, onChange);

  renderOpsList(containerEl, onChange);
}

function renderOpsList(containerEl, onChange) {
  const ops = JSON.parse(containerEl.dataset.opsJson || '[]');
  const listEl = containerEl.querySelector('.ops-list');
  listEl.innerHTML = '';

  if (ops.length === 0) {
    listEl.innerHTML = '<p class="empty">尚無操作指令。點擊下方按鈕新增。</p>';
    return;
  }

  ops.forEach((op, idx) => {
    const row = document.createElement('div');
    row.className = 'op-row';
    row.dataset.index = idx;
    row.innerHTML = renderOpRowHTML(op, idx, ops.length);
    listEl.appendChild(row);
    bindOpRowEvents(row, containerEl, onChange);
  });
}

function renderOpRowHTML(op, idx, total) {
  const verbDef = mapOperationsSchema.verbs.find(v => v.code === op.verb);
  if (!verbDef) {
    return `<div class="op-unknown">未知動詞:${escapeHtml(op.verb)}</div>`;
  }

  return `
    <div class="op-handle" title="拖曳調整順序">⋮⋮</div>
    <div class="op-verb-display">
      <span class="op-icon">${verbDef.icon}</span>
      <strong>${escapeHtml(verbDef.name_zh)}</strong>
    </div>
    <div class="op-params">
      ${verbDef.params.map(p => renderParamField(p, op.params?.[p.key])).join('')}
    </div>
    <div class="op-actions">
      ${idx > 0 ? `<button type="button" class="btn-move-up" data-idx="${idx}">↑</button>` : ''}
      ${idx < total - 1 ? `<button type="button" class="btn-move-down" data-idx="${idx}">↓</button>` : ''}
      <button type="button" class="btn-duplicate" data-idx="${idx}">複製</button>
      <button type="button" class="btn-remove btn-danger" data-idx="${idx}">🗑</button>
    </div>
  `;
}

function renderParamField(paramDef, currentValue) {
  const labelHtml = `<label class="param-label">${escapeHtml(paramDef.label_zh)}${paramDef.required ? ' <span class="required">*</span>' : ''}</label>`;

  switch (paramDef.type) {
    case 'text':
      return `${labelHtml}<input type="text" class="param-input" data-key="${paramDef.key}" value="${escapeHtml(currentValue || '')}">`;

    case 'number':
      return `${labelHtml}<input type="number" class="param-input" data-key="${paramDef.key}" value="${currentValue ?? paramDef.default ?? ''}" min="${paramDef.min ?? ''}" max="${paramDef.max ?? ''}">`;

    case 'select':
      return `${labelHtml}<select class="param-input" data-key="${paramDef.key}">
        ${paramDef.options.map(o => `<option value="${o.value}" ${currentValue === o.value ? 'selected' : ''}>${escapeHtml(o.label_zh)}</option>`).join('')}
      </select>`;

    case 'location_picker':
      return `${labelHtml}<div class="param-location-picker" data-key="${paramDef.key}" data-mode="${paramDef.mode || 'replace'}">
        ${renderLocationChip(currentValue)}
        <button type="button" class="btn-pick-location">挑選地點</button>
      </div>`;

    case 'location_picker_multi':
      return `${labelHtml}<div class="param-location-picker-multi" data-key="${paramDef.key}">
        ${(currentValue || []).map(code => renderLocationChip(code)).join('')}
        <button type="button" class="btn-pick-locations-multi">加入地點</button>
      </div>`;

    case 'family_picker':
      return `${labelHtml}<select class="param-input param-family-select" data-key="${paramDef.key}">
        <option value="">(選擇家族)</option>
        ${renderFamilyOptions(currentValue)}
      </select>`;

    case 'tier_select':
      return `${labelHtml}<select class="param-input" data-key="${paramDef.key}">
        <option value="">(選擇位階)</option>
        <option value="minion" ${currentValue === 'minion' ? 'selected' : ''}>雜兵</option>
        <option value="threat" ${currentValue === 'threat' ? 'selected' : ''}>威脅</option>
        <option value="elite" ${currentValue === 'elite' ? 'selected' : ''}>精英</option>
        <option value="boss" ${currentValue === 'boss' ? 'selected' : ''}>頭目</option>
        <option value="titan" ${currentValue === 'titan' ? 'selected' : ''}>巨頭</option>
      </select>`;

    default:
      return `<p>未支援的欄位類型:${paramDef.type}</p>`;
  }
}

function renderLocationChip(code) {
  if (!code) return '<span class="location-chip empty">(未選擇)</span>';
  const loc = allLocationsCache?.find(l => l.code === code);
  const label = loc ? loc.name_zh : code;
  return `<span class="location-chip"><code>${escapeHtml(code)}</code> ${escapeHtml(label)}</span>`;
}

function renderFamilyOptions(currentValue) {
  if (!allFamiliesCache) return `<option value="${currentValue || ''}">${currentValue || '(載入中)'}</option>`;
  return allFamiliesCache.map(f =>
    `<option value="${f.code}" ${currentValue === f.code ? 'selected' : ''}>${escapeHtml(f.name_zh)}</option>`
  ).join('');
}
```

### 2.4 事件綁定

```javascript
function bindOpRowEvents(row, containerEl, onChange) {
  const idx = parseInt(row.dataset.index, 10);

  // 一般輸入變更
  row.querySelectorAll('.param-input').forEach(input => {
    input.onchange = () => updateOpParam(containerEl, idx, input.dataset.key, input.value, onChange);
  });

  // 地點挑選
  row.querySelectorAll('.btn-pick-location').forEach(btn => {
    btn.onclick = () => {
      const pickerContainer = btn.parentElement;
      const key = pickerContainer.dataset.key;
      const ops = JSON.parse(containerEl.dataset.opsJson);
      const currentCode = ops[idx].params?.[key];

      openLocationPicker(`map-op-${idx}-${key}`, {
        mode: 'replace',
        title: '選擇地點',
        currentSelection: currentCode ? [currentCode] : [],
        onConfirm: (selection) => {
          const code = selection[0];
          updateOpParam(containerEl, idx, key, typeof code === 'string' ? code : code.code, onChange);
          // 重新渲染該 chip
          pickerContainer.innerHTML = renderLocationChip(code) +
            '<button type="button" class="btn-pick-location">挑選地點</button>';
          bindOpRowEvents(row, containerEl, onChange);
        }
      });
    };
  });

  // 多地點挑選
  row.querySelectorAll('.btn-pick-locations-multi').forEach(btn => {
    btn.onclick = () => {
      const pickerContainer = btn.parentElement;
      const key = pickerContainer.dataset.key;
      const ops = JSON.parse(containerEl.dataset.opsJson);
      const currentCodes = ops[idx].params?.[key] || [];

      openLocationPicker(`map-op-${idx}-${key}-multi`, {
        mode: 'single_list',
        title: '選擇多個地點',
        currentSelection: currentCodes,
        onConfirm: (selection) => {
          const codes = selection.map(s => typeof s === 'string' ? s : s.code);
          updateOpParam(containerEl, idx, key, codes, onChange);
          renderOpsList(containerEl, onChange);
        }
      });
    };
  });

  // 排序按鈕
  row.querySelector('.btn-move-up')?.addEventListener('click', () => moveOp(containerEl, idx, -1, onChange));
  row.querySelector('.btn-move-down')?.addEventListener('click', () => moveOp(containerEl, idx, 1, onChange));
  row.querySelector('.btn-duplicate')?.addEventListener('click', () => duplicateOp(containerEl, idx, onChange));
  row.querySelector('.btn-remove')?.addEventListener('click', () => removeOp(containerEl, idx, onChange));
}

function updateOpParam(containerEl, idx, key, value, onChange) {
  const ops = JSON.parse(containerEl.dataset.opsJson);
  ops[idx].params = ops[idx].params || {};
  ops[idx].params[key] = value;
  containerEl.dataset.opsJson = JSON.stringify(ops);
  onChange?.(ops);
}

function moveOp(containerEl, idx, delta, onChange) {
  const ops = JSON.parse(containerEl.dataset.opsJson);
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= ops.length) return;
  [ops[idx], ops[newIdx]] = [ops[newIdx], ops[idx]];
  containerEl.dataset.opsJson = JSON.stringify(ops);
  renderOpsList(containerEl, onChange);
  onChange?.(ops);
}

function duplicateOp(containerEl, idx, onChange) {
  const ops = JSON.parse(containerEl.dataset.opsJson);
  ops.splice(idx + 1, 0, JSON.parse(JSON.stringify(ops[idx])));
  containerEl.dataset.opsJson = JSON.stringify(ops);
  renderOpsList(containerEl, onChange);
  onChange?.(ops);
}

function removeOp(containerEl, idx, onChange) {
  if (!confirm('確定刪除此操作?')) return;
  const ops = JSON.parse(containerEl.dataset.opsJson);
  ops.splice(idx, 1);
  containerEl.dataset.opsJson = JSON.stringify(ops);
  renderOpsList(containerEl, onChange);
  onChange?.(ops);
}

function addOperation(containerEl, onChange) {
  // 彈出動詞選擇對話框
  openVerbPickerDialog((verbCode) => {
    const ops = JSON.parse(containerEl.dataset.opsJson);
    const verbDef = mapOperationsSchema.verbs.find(v => v.code === verbCode);
    const defaultParams = {};
    verbDef.params.forEach(p => {
      if (p.default !== undefined) defaultParams[p.key] = p.default;
    });
    ops.push({ verb: verbCode, params: defaultParams });
    containerEl.dataset.opsJson = JSON.stringify(ops);
    renderOpsList(containerEl, onChange);
    onChange?.(ops);
  });
}
```

### 2.5 動詞選擇對話框

```html
<div id="dialog-verb-picker" class="dialog" style="display:none">
  <div class="dialog-content">
    <h3>選擇操作類型</h3>
    <div class="verb-picker-grid">
      <!-- 動態渲染,依 category 分組 -->
    </div>
    <div class="dialog-footer">
      <button onclick="closeDialog('verb-picker')">取消</button>
    </div>
  </div>
</div>
```

```javascript
function openVerbPickerDialog(onSelect) {
  const grid = document.querySelector('#dialog-verb-picker .verb-picker-grid');
  grid.innerHTML = '';

  const byCategory = {
    tile: [], card: [], topology: [], enemy: [], environment: [], token: [], meta: []
  };
  mapOperationsSchema.verbs.forEach(v => byCategory[v.category].push(v));

  const categoryLabels = {
    tile: '地點操作',
    card: '卡片操作',
    topology: '連接操作',
    enemy: '敵人操作',
    environment: '環境操作',
    token: '標記操作',
    meta: '牌堆控制'
  };

  for (const [cat, verbs] of Object.entries(byCategory)) {
    if (verbs.length === 0) continue;
    const group = document.createElement('div');
    group.className = 'verb-group';
    group.innerHTML = `
      <h4>${categoryLabels[cat]}</h4>
      <div class="verb-buttons">
        ${verbs.map(v => `
          <button type="button" class="verb-btn" data-code="${v.code}">
            <span class="verb-icon">${v.icon}</span>
            <span class="verb-name">${escapeHtml(v.name_zh)}</span>
            ${v.description_zh ? `<span class="verb-desc">${escapeHtml(v.description_zh)}</span>` : ''}
          </button>
        `).join('')}
      </div>
    `;
    grid.appendChild(group);
  }

  grid.querySelectorAll('.verb-btn').forEach(btn => {
    btn.onclick = () => {
      onSelect(btn.dataset.code);
      closeDialog('verb-picker');
    };
  });

  openDialog('verb-picker');
}
```

### 2.6 家族快取

```javascript
let allFamiliesCache = null;

async function loadAllFamilies() {
  if (allFamiliesCache) return allFamiliesCache;
  const res = await adminFetch('/api/monsters/families');
  allFamiliesCache = await res.json();
  return allFamiliesCache;
}
```

在 `init()` 中呼叫 `loadAllFamilies()` 與 `loadMapOperationsSchema()`。

---

## 三、目標牌堆分頁(`#tab-act-cards`)

### 3.1 分頁結構

兩欄佈局:左側目標卡清單、右側當前目標卡編輯。

```html
<section id="tab-act-cards" class="tab-content">
  <div class="cards-layout">
    <div class="cards-nav">
      <button class="btn-primary" onclick="addActCard()">＋ 新增目標卡</button>
      <div id="act-cards-list"></div>
    </div>
    <div class="card-editor" id="act-card-editor-container">
      <div class="placeholder">請選擇目標卡</div>
    </div>
  </div>
</section>
```

### 3.2 目標卡清單

```javascript
function renderActCardsList() {
  const list = document.getElementById('act-cards-list');
  if (!currentStage.act_cards?.length) {
    list.innerHTML = '<p class="empty">尚無目標卡</p>';
    return;
  }

  list.innerHTML = currentStage.act_cards.map((c, idx) => `
    <div class="card-item ${currentActCard?.id === c.id ? 'active' : ''}"
         onclick="selectActCard('${c.id}')">
      <div class="card-order">第 ${c.card_order} 張</div>
      <div class="card-name">${escapeHtml(c.name_zh || '(未命名)')}</div>
      <div class="card-types">
        ${(c.front_objective_types || []).map(t =>
          `<span class="objective-badge">${objectiveTypeLabel(t)}</span>`
        ).join('')}
      </div>
      <div class="card-actions">
        ${idx > 0 ? `<button onclick="moveActCard('${c.id}', -1); event.stopPropagation()">↑</button>` : ''}
        ${idx < currentStage.act_cards.length - 1 ? `<button onclick="moveActCard('${c.id}', 1); event.stopPropagation()">↓</button>` : ''}
        <button onclick="deleteActCard('${c.id}'); event.stopPropagation()" class="btn-danger">🗑</button>
      </div>
    </div>
  `).join('');
}

function objectiveTypeLabel(type) {
  return {
    seal_gate: '封印次元門',
    defeat_titan: '擊敗巨頭',
    uncover_truth: '發覺真相',
    escape: '逃脫',
    endurance: '撐到時間到'
  }[type] || type;
}
```

### 3.3 目標卡編輯器

```html
<div class="card-editor">
  <!-- 區塊一:基礎資料 -->
  <section class="editor-section">
    <h3>基礎資料</h3>
    <label>中文名稱 <input type="text" id="ac-name-zh"></label>
    <label>英文名稱 <input type="text" id="ac-name-en">
      <button type="button" onclick="aiTranslate('ac-name-zh', 'ac-name-en')">中譯英</button>
    </label>
  </section>

  <!-- 區塊二:正面 -->
  <section class="editor-section card-face card-front">
    <h3>🎴 正面(推進中)</h3>

    <label>任務敘事
      <textarea id="ac-front-narrative" rows="4"></textarea>
      <button type="button" onclick="aiGenerateActFrontNarrative()">AI 生成</button>
    </label>

    <label>任務類型(可複選)
      <div class="objective-types-picker">
        ${['seal_gate', 'defeat_titan', 'uncover_truth', 'escape', 'endurance'].map(t => `
          <label><input type="checkbox" value="${t}" class="ac-front-type"> ${objectiveTypeLabel(t)}</label>
        `).join('')}
      </div>
    </label>

    <label>推進條件
      <div id="ac-front-advance-condition">
        <!-- 推進條件編輯器,見 §3.4 -->
      </div>
    </label>

    <label>人數縮放
      <div class="scaling-inline">
        <label><input type="checkbox" id="ac-front-scale-enabled">
          依玩家人數縮放條件值
        </label>
        <span class="scaling-hint">啟用時,推進條件中的所有數值乘以玩家人數</span>
      </div>
    </label>
  </section>

  <!-- 區塊三:背面 -->
  <section class="editor-section card-face card-back">
    <h3>🎴 背面(結算後)</h3>

    <label>結算敘事
      <textarea id="ac-back-narrative" rows="4"></textarea>
      <button type="button" onclick="aiGenerateActBackNarrative()">AI 生成</button>
    </label>

    <label>授予旗標
      <div id="ac-back-flag-sets">
        <!-- 旗標多選(沿用 MOD-06 旗標 chip 樣式) -->
      </div>
    </label>

    <label>結算獎勵
      <div class="rewards-editor" id="ac-back-rewards">
        <!-- 見 §3.5 獎勵編輯器 -->
      </div>
    </label>

    <label>地圖操作指令
      <div id="ac-back-map-operations">
        <!-- 呼叫 renderMapOperationsEditor -->
      </div>
    </label>

    <label>結算指引代碼(給下一張目標卡或章節結算用)
      <input type="text" id="ac-back-resolution-code" placeholder="例:ch3_act1_passed">
    </label>
  </section>

  <div class="editor-footer">
    <button class="btn-primary" onclick="saveActCard()">儲存目標卡</button>
  </div>
</div>
```

### 3.4 推進條件編輯器

推進條件的 JSON 結構(與 MOD-06 的條件表達式類似,但擴充了幾種任務類型特有的節點):

```json
{
  "type": "all",
  "conditions": [
    { "type": "spend_clues", "count": 8 },
    { "type": "investigators_at_location", "location_code": "ritual_chamber", "count": "all" }
  ]
}
```

新增的節點類型:

| 類型 | 參數 | 含義 |
|---|---|---|
| `spend_clues` | `count` | 花費指定數量線索 |
| `investigators_at_location` | `location_code`, `count`(`all` 或數字) | 調查員到達指定地點 |
| `defeat_enemy` | `enemy_id` 或 `family_code + tier` | 擊敗特定敵人 |
| `rounds_survived` | `count` | 存活指定回合數 |
| `flag_set` | `flag_code` | 特定旗標已設定 |
| `all` / `any` | `conditions[]` | 子條件組合 |

介面類似 MOD-06 的條件表達式編輯器,但下拉多了前四種類型。

```javascript
function renderAdvanceConditionEditor(containerEl, condition, onChange) {
  containerEl.dataset.conditionJson = JSON.stringify(condition || {});
  containerEl.innerHTML = renderAdvanceConditionHTML(condition);
  bindAdvanceConditionEvents(containerEl, onChange);
}

function renderAdvanceConditionHTML(condition, depth = 0) {
  if (!condition || Object.keys(condition).length === 0) {
    return `
      <div class="cond-empty">
        <button type="button" onclick="startAdvanceCondition(this, 'all')">全部達成 (ALL)</button>
        <button type="button" onclick="startAdvanceCondition(this, 'spend_clues')">花費線索</button>
        <button type="button" onclick="startAdvanceCondition(this, 'investigators_at_location')">調查員到達地點</button>
        <button type="button" onclick="startAdvanceCondition(this, 'defeat_enemy')">擊敗敵人</button>
      </div>
    `;
  }
  // 依 type 渲染
  // ... (結構與 MOD-06 條件表達式類似)
}
```

### 3.5 獎勵編輯器

獎勵 JSON 結構:

```json
{
  "xp": 2,
  "talent_point": 1,
  "cohesion": 0,
  "resources": 0,
  "materials": { "common": 2, "rare": 1 },
  "card_grants": [
    { "card_id": "<UUID>", "reason_zh": "破解密碼後從桌上取得" }
  ]
}
```

UI:

```html
<div class="rewards-editor-grid">
  <label>經驗值 <input type="number" data-key="xp" min="0" max="10"></label>
  <label>天賦點 <input type="number" data-key="talent_point" min="0" max="10"></label>
  <label>凝聚力 <input type="number" data-key="cohesion" min="0" max="10"></label>
  <label>資源 <input type="number" data-key="resources" min="0" max="20"></label>
</div>
<div class="materials-subsection">
  <h5>素材</h5>
  <!-- 依素材類別動態欄位 -->
</div>
<div class="cards-subsection">
  <h5>授予卡片</h5>
  <div id="ac-card-grants-list"></div>
  <button type="button" onclick="addCardGrant()">＋ 加入卡片</button>
</div>
```

### 3.6 儲存目標卡

```javascript
async function saveActCard() {
  if (!currentActCard) return;

  const payload = {
    name_zh: document.getElementById('ac-name-zh').value,
    name_en: document.getElementById('ac-name-en').value,
    front_narrative: document.getElementById('ac-front-narrative').value,
    front_objective_types: collectSelectedObjectiveTypes('ac-front-type'),
    front_advance_condition: JSON.parse(document.getElementById('ac-front-advance-condition').dataset.conditionJson || '{}'),
    front_scaling: {
      scaling_enabled: document.getElementById('ac-front-scale-enabled').checked
    },
    back_narrative: document.getElementById('ac-back-narrative').value,
    back_flag_sets: collectFlagSets('ac-back-flag-sets'),
    back_rewards: collectRewards('ac-back-rewards'),
    back_map_operations: JSON.parse(document.getElementById('ac-back-map-operations').dataset.opsJson || '[]'),
    back_resolution_code: document.getElementById('ac-back-resolution-code').value
  };

  const res = await adminFetch(`/api/act-cards/${currentActCard.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.json();
    if (err.details) {
      const msgs = [];
      if (err.details.missing_flags?.length) msgs.push('缺漏旗標:' + err.details.missing_flags.join(', '));
      if (err.details.missing_locations?.length) msgs.push('缺漏地點:' + err.details.missing_locations.join(', '));
      if (err.details.missing_families?.length) msgs.push('缺漏怪物家族:' + err.details.missing_families.join(', '));
      alert('儲存失敗:\n' + msgs.join('\n'));
    } else {
      alert('儲存失敗:' + err.error);
    }
    return;
  }

  await reloadStage();
  showToast('目標卡已儲存', 'success');
}
```

---

## 四、議案牌堆分頁(`#tab-agenda-cards`)

結構與目標牌堆幾乎對稱,以下僅列出差異。

### 4.1 HTML 結構

兩欄佈局,左側議案卡清單(顯示卡序、名稱、毀滅門檻),右側編輯區。

### 4.2 議案卡編輯器差異

**正面欄位**:
- 中文/英文名稱
- 劇情敘事
- 毀滅門檻(數字輸入,預設 3)

**背面欄位**:
- 後果結算敘事
- 授予旗標(陣營視角的旗標,例如「邪教儀式完成」)
- **懲罰**(取代目標卡的「獎勵」)
- 地圖操作指令
- 結算指引代碼

### 4.3 懲罰編輯器

懲罰 JSON 結構:

```json
{
  "hp_damage": 0,
  "san_damage": 1,
  "clue_removal": 2,
  "resource_loss": 0,
  "spawn_monsters": [
    { "family_code": "deep_one", "tier": "threat", "location_code": "entrance", "count": 1 }
  ],
  "doom_tokens_added": 1
}
```

UI:

```html
<div class="penalties-editor">
  <div class="penalties-grid">
    <label>HP 傷害(全體) <input type="number" data-key="hp_damage" min="0" max="5"></label>
    <label>SAN 傷害(全體) <input type="number" data-key="san_damage" min="0" max="5"></label>
    <label>移除線索 <input type="number" data-key="clue_removal" min="0" max="10"></label>
    <label>資源損失(全體) <input type="number" data-key="resource_loss" min="0" max="10"></label>
    <label>毀滅標記 +X <input type="number" data-key="doom_tokens_added" min="0" max="5"></label>
  </div>

  <div class="spawn-section">
    <h5>生成怪物</h5>
    <div id="spawn-monsters-list"></div>
    <button type="button" onclick="addPenaltySpawn()">＋ 新增生成</button>
  </div>
</div>
```

### 4.4 議案儲存

與目標卡 API 對稱,端點為 `PUT /api/agenda-cards/:id`。

---

## 五、驗收清單

- [ ] 目標牌堆分頁:可新增/刪除/排序目標卡
- [ ] 目標卡編輯器:正反面欄位齊全,任務類型可多選
- [ ] 推進條件編輯器:可建立巢狀 ALL/ANY,支援花費線索、調查員位置、擊敗敵人、回合數、旗標檢查
- [ ] 獎勵編輯器:XP/天賦點/凝聚力/資源/素材/授予卡片皆可編輯
- [ ] 地圖操作指令編輯器(共用):顯示 13 種動詞分類
- [ ] 點擊「＋ 新增操作」彈出動詞選擇對話框,依 category 分組
- [ ] 每條指令的動態參數欄位依動詞類型正確渲染
- [ ] 地點參數欄:點擊「挑選地點」呼叫地點挑選對話框,挑選後正確回填 chip
- [ ] 家族參數欄:從 MOD-03 載入的家族下拉
- [ ] 位階參數欄:五階下拉
- [ ] 指令可上下移、複製、刪除
- [ ] 目標卡儲存:引用不存在的地點/家族/旗標時,後端回傳 400 並顯示缺漏清單
- [ ] 議案牌堆分頁:與目標牌堆對稱,差異在正面為毀滅門檻、背面為懲罰
- [ ] 懲罰編輯器:HP/SAN 傷害、線索移除、生成怪物、毀滅標記均可編輯
- [ ] 議案卡儲存成功後,議案列表更新

---

## 六、實作注意事項

1. **地圖操作指令編輯器是本份核心**,穩固後後續會在多處使用(重返覆寫、其他卡片背面)。優先確保渲染與事件正確
2. **動態參數欄位的渲染要單一入口**(`renderParamField`),新增動詞類型只需擴充 schema 與新增一個 case
3. **條件表達式編輯器**若完全與 MOD-06 一致,建議抽出成共用函式庫(例如 `admin-shared-widgets.js`);若不想新增共用檔,複製到本模組即可
4. **目標卡的 objective_types 可多選**,規則書 §14.1 明確支援混搭
5. **推進條件的 JSON 結構**與一般條件表達式不同,有專屬節點(spend_clues、investigators_at_location 等),不要混用
6. **所有卡片儲存前做前端校驗**:必填欄位、數值範圍、objective_types 至少選 1 種
7. **儲存後立即重新載入關卡**,避免 UI 與資料不同步

---

## 七、下一份指令

Part 4 將產出混沌袋配置、遭遇卡池、神話卡池、怪物家族池四個分頁。遭遇卡池與神話卡池要從 MOD-10 既有資料庫讀取並顯示選擇介面。
