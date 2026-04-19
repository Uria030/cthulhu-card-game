# MOD-07 關卡編輯器 · Claude Code 指令 Part 5:重返覆寫、隨機地城、AI 整合、完整性檢查

> **系列**:MOD-07 實作指令 · 第 5 份 / 共 5 份
> **依據規格**:`MOD07_關卡編輯器_總覽規格_v0_2.md`
> **前置條件**:Part 1~4 已完成
> **本份產出**:重返覆寫分頁、隨機地城規則分頁與生成演算法、AI 整合(Gemini 七個生成點)、完整性檢查分頁、MEMORY.md 與檔案索引更新
> **執行角色**:Claude Code 依此文件實作檔案變更

---

## 一、任務範圍

本份是 MOD-07 的收尾:

- **重返覆寫分頁**(`#tab-return-overrides`):差異式編輯介面,支援敘事與結構覆寫
- **隨機地城規則分頁**(`#tab-random-generator`):產生器參數配置、種子驗證器
- **隨機地城生成演算法**:後端 `POST /api/stages/:id/random-generator/generate` 的實作
- **AI 整合**:七個生成點(沿用 MOD-06 的 Gemini 模式)
- **完整性檢查分頁**(`#tab-completeness`):四種關卡類型各自的檢查規則
- **MEMORY.md 與檔案索引更新**:標註 MOD-07 為 READY

完成後,MOD-07 整體狀態應從「尚未建置」變更為「READY」。

---

## 二、重返覆寫分頁(`#tab-return-overrides`)

### 2.1 分頁進入條件

只在 `currentStage.stage_type === 'side_return'` 顯示(Part 2 的 `updateConditionalTabs()` 已處理)。

### 2.2 分頁結構

左右兩欄:左側顯示原始支線配置(唯讀)、右側編輯覆寫。

```html
<section id="tab-return-overrides" class="tab-content">
  <div class="return-intro">
    <div class="return-meta">
      <p>重返原始支線:<strong id="return-parent-name"></strong></p>
      <p>重返次數:第 <input type="number" id="return-stage-number" min="1" onchange="markDirty()"> 次</p>
    </div>
    <button onclick="previewResolvedStage()">預覽合併結果</button>
  </div>

  <div class="overrides-layout">
    <!-- 左側:原始支線配置(唯讀) -->
    <aside class="original-pane">
      <h3>原始支線配置(唯讀)</h3>
      <div id="original-config-tree"></div>
    </aside>

    <!-- 右側:覆寫編輯 -->
    <main class="overrides-pane">
      <h3>覆寫設定</h3>

      <nav class="override-subtab-bar">
        <button class="subtab-btn active" data-subtab="metadata">元資料</button>
        <button class="subtab-btn" data-subtab="act-cards">目標卡</button>
        <button class="subtab-btn" data-subtab="agenda-cards">議案卡</button>
        <button class="subtab-btn" data-subtab="monsters">怪物</button>
        <button class="subtab-btn" data-subtab="chaos-bag">混沌袋</button>
        <button class="subtab-btn" data-subtab="pools">卡池</button>
      </nav>

      <section class="override-subtab" data-subtab="metadata">
        <!-- 見 §2.4 -->
      </section>
      <section class="override-subtab hidden" data-subtab="act-cards">
        <!-- 見 §2.5 -->
      </section>
      <!-- 其他子分頁 -->
    </main>
  </div>
</section>
```

### 2.3 原始支線配置樹

唯讀顯示原始支線的主要配置摘要:

```javascript
async function renderReturnOverridesTab() {
  if (!currentStage || currentStage.stage_type !== 'side_return') return;

  // 載入原始支線完整資料
  const res = await adminFetch(`/api/stages/${currentStage.return_parent_id}`);
  currentReturnParent = await res.json();

  document.getElementById('return-parent-name').textContent =
    `${currentReturnParent.name_zh} (${currentReturnParent.code})`;
  document.getElementById('return-stage-number').value = currentStage.return_stage_number || 1;

  renderOriginalConfigTree();
  renderOverridesMetadata();
  bindOverrideSubtabs();
}

function renderOriginalConfigTree() {
  const container = document.getElementById('original-config-tree');
  const parent = currentReturnParent;

  container.innerHTML = `
    <details open>
      <summary>元資料</summary>
      <dl class="readonly-fields">
        <dt>名稱:</dt><dd>${escapeHtml(parent.name_zh)}</dd>
        <dt>敘事:</dt><dd>${escapeHtml(parent.narrative)}</dd>
      </dl>
    </details>

    <details>
      <summary>目標卡(${parent.act_cards?.length || 0} 張)</summary>
      ${(parent.act_cards || []).map(c => `
        <div class="mini-card">
          <strong>第 ${c.card_order} 張:${escapeHtml(c.name_zh)}</strong>
          <p class="snippet">${escapeHtml(c.front_narrative.substring(0, 80))}…</p>
        </div>
      `).join('')}
    </details>

    <details>
      <summary>議案卡(${parent.agenda_cards?.length || 0} 張)</summary>
      ${(parent.agenda_cards || []).map(c => `
        <div class="mini-card">
          <strong>第 ${c.card_order} 張(門檻 ${c.front_doom_threshold}):${escapeHtml(c.name_zh)}</strong>
          <p class="snippet">${escapeHtml(c.front_narrative.substring(0, 80))}…</p>
        </div>
      `).join('')}
    </details>

    <details>
      <summary>怪物家族池</summary>
      ${(parent.monster_pool || []).map(p => `
        <div class="mini-pool">
          <span class="role-badge role-${p.role}">${p.role === 'primary' ? '主' : '副'}</span>
          ${escapeHtml(p.family_code)}
          <span class="tiers">${(p.allowed_tiers || []).join(', ')}</span>
        </div>
      `).join('')}
    </details>

    <details>
      <summary>混沌袋</summary>
      <pre class="config-json">${JSON.stringify(parent.chaos_bag, null, 2)}</pre>
    </details>
  `;
}
```

### 2.4 元資料覆寫

```html
<section class="override-subtab" data-subtab="metadata">
  <h4>元資料覆寫</h4>
  <p class="hint">留白欄位表示沿用原始支線值</p>

  <label>名稱覆寫
    <input type="text" id="ov-name-zh" placeholder="(沿用原始)">
    <button class="btn-revert" onclick="revertField('ov-name-zh')">還原沿用</button>
  </label>

  <label>敘事覆寫
    <textarea id="ov-narrative" rows="4" placeholder="(沿用原始)"></textarea>
    <button class="btn-revert" onclick="revertField('ov-narrative')">還原沿用</button>
  </label>

  <label>進入條件覆寫
    <div id="ov-entry-condition">
      <!-- 條件表達式編輯器,有覆寫時啟用 -->
    </div>
  </label>
</section>
```

### 2.5 目標卡覆寫

以每張原始目標卡為一個摺疊區塊,可覆寫其任何欄位。

```html
<section class="override-subtab hidden" data-subtab="act-cards">
  <h4>目標卡覆寫</h4>
  <div id="ov-act-cards-list"></div>
  <button onclick="addNewActCard()">＋ 新增目標卡(原始支線沒有的)</button>
</section>
```

```javascript
function renderOverridesActCards() {
  const listEl = document.getElementById('ov-act-cards-list');
  const parent = currentReturnParent;
  const overrides = currentStage.return_overrides?.act_cards || {};

  listEl.innerHTML = (parent.act_cards || []).map(card => {
    const cardOverride = overrides[card.card_order.toString()] || {};
    const hasOverrides = Object.keys(cardOverride).length > 0;

    return `
      <details class="ov-card-block" ${hasOverrides ? 'open' : ''}>
        <summary>
          <span class="ov-indicator ${hasOverrides ? 'has-override' : ''}">
            ${hasOverrides ? '● 已覆寫' : '○ 沿用'}
          </span>
          第 ${card.card_order} 張:${escapeHtml(card.name_zh)}
        </summary>
        <div class="ov-card-fields" data-card-order="${card.card_order}">
          ${renderCardOverrideFields(card, cardOverride)}
        </div>
      </details>
    `;
  }).join('');

  // 新增的卡(key 以 new_X 命名)
  Object.entries(overrides).filter(([k]) => k.startsWith('new_')).forEach(([key, override]) => {
    listEl.insertAdjacentHTML('beforeend', `
      <details class="ov-card-block ov-card-new" open>
        <summary>
          <span class="ov-indicator has-override">✦ 新增卡</span>
          ${escapeHtml(override.name_zh || '(未命名)')}
        </summary>
        <div class="ov-card-fields" data-new-key="${key}">
          ${renderNewCardFields(override)}
          <button class="btn-danger" onclick="removeNewActCard('${key}')">移除此新卡</button>
        </div>
      </details>
    `);
  });
}

function renderCardOverrideFields(originalCard, override) {
  return `
    <label>正面敘事覆寫
      <textarea class="ov-field" data-field="front_narrative" rows="3">${escapeHtml(override.front_narrative || '')}</textarea>
      <p class="original-value">原始:${escapeHtml(originalCard.front_narrative.substring(0, 80))}…</p>
    </label>

    <label>推進條件覆寫
      <div class="ov-condition-editor" data-field="front_advance_condition">
        <!-- 條件表達式編輯器,有值時顯示,無值時顯示「沿用」 -->
      </div>
    </label>

    <label>背面結算敘事覆寫
      <textarea class="ov-field" data-field="back_narrative" rows="3">${escapeHtml(override.back_narrative || '')}</textarea>
    </label>

    <label>獎勵覆寫
      <div class="ov-rewards-editor" data-field="back_rewards">
        <!-- 獎勵編輯器 -->
      </div>
    </label>

    <label>地圖操作指令覆寫
      <div class="ov-map-ops" data-field="back_map_operations">
        <!-- 地圖操作指令共用元件 -->
      </div>
    </label>
  `;
}
```

### 2.6 議案卡覆寫

結構與目標卡對稱,多一個毀滅門檻欄位。

### 2.7 怪物覆寫

三個專屬區塊:主家族位階調整、固定頭目替換、整組重換。

```html
<section class="override-subtab hidden" data-subtab="monsters">
  <h4>怪物家族池覆寫</h4>

  <div class="ov-subsection">
    <h5>位階調整</h5>
    <label>主家族位階調整
      <select id="ov-primary-tier-adjust">
        <option value="">(沿用原始)</option>
        <option value="+1">+1 階</option>
        <option value="+2">+2 階</option>
        <option value="-1">-1 階</option>
      </select>
    </label>
  </div>

  <div class="ov-subsection">
    <h5>固定頭目替換</h5>
    <p class="hint">將原始支線的某個頭目替換為另一個</p>
    <div id="ov-boss-replacements"></div>
    <button onclick="addBossReplacement()">＋ 新增替換規則</button>
  </div>

  <div class="ov-subsection">
    <h5>新增額外家族</h5>
    <div id="ov-additional-families"></div>
    <button onclick="addOverrideFamily()">＋ 加入家族</button>
  </div>
</section>
```

### 2.8 混沌袋覆寫

採**只記變化**的結構:

```json
{
  "additions": [
    { "marker": "skull", "count": 2 },
    { "marker": "cultist", "count": 1 }
  ],
  "removals": [
    { "marker": "+1", "count": 1 }
  ],
  "difficulty_preset": "hard"
}
```

UI 以兩列表格呈現,第一欄選標記、第二欄輸入數量。

### 2.9 卡池覆寫

神話卡池、遭遇卡池各自獨立:

```json
{
  "mythos_pool": {
    "add_cards": [{ "mythos_card_id": "<UUID>", "weight": 3 }],
    "remove_cards": [{ "mythos_card_id": "<UUID>" }]
  },
  "encounter_pool": { ... }
}
```

UI 以「新增卡片」「移除卡片」兩區塊,新增用選取對話框(沿用 Part 4 的對話框)、移除用從原始池中選擇後加入移除清單。

### 2.10 儲存重返版

```javascript
async function saveReturnOverrides() {
  const overrides = collectAllOverrides();

  const payload = {
    return_stage_number: parseInt(document.getElementById('return-stage-number').value, 10),
    return_overrides: overrides
  };

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

  await reloadStage();
  showToast('重返覆寫已儲存', 'success');
}

function collectAllOverrides() {
  const overrides = {};

  // 元資料
  const metadata = {};
  const nameZh = document.getElementById('ov-name-zh').value.trim();
  const narrative = document.getElementById('ov-narrative').value.trim();
  if (nameZh) metadata.name_zh = nameZh;
  if (narrative) metadata.narrative = narrative;
  if (Object.keys(metadata).length > 0) overrides.stage_metadata = metadata;

  // 目標卡
  const actCards = {};
  document.querySelectorAll('.ov-card-block .ov-card-fields[data-card-order]').forEach(block => {
    const order = block.dataset.cardOrder;
    const fields = collectCardOverrideFields(block);
    if (Object.keys(fields).length > 0) actCards[order] = fields;
  });
  // 新增的目標卡
  document.querySelectorAll('.ov-card-fields[data-new-key]').forEach(block => {
    const key = block.dataset.newKey;
    actCards[key] = collectNewCardFields(block);
  });
  if (Object.keys(actCards).length > 0) overrides.act_cards = actCards;

  // ... 議案卡、怪物、混沌袋、卡池類似

  return overrides;
}
```

### 2.11 預覽合併結果

```javascript
async function previewResolvedStage() {
  const res = await adminFetch(`/api/stages/${currentStage.id}/resolved`);
  const resolved = await res.json();

  // 在新分頁或模態顯示完整合併結果
  openDialog('preview-resolved');
  document.getElementById('preview-resolved-content').innerHTML = `
    <h3>重返版合併結果預覽</h3>
    <p class="hint">這是玩家實際進入本關卡時會看到的完整配置</p>

    <section>
      <h4>${escapeHtml(resolved.name_zh)}</h4>
      <p>${escapeHtml(resolved.narrative)}</p>
    </section>

    <section>
      <h4>目標卡序(${resolved.act_cards?.length || 0} 張)</h4>
      ${(resolved.act_cards || []).map(c => `
        <div class="preview-card">
          <strong>第 ${c.card_order} 張:${escapeHtml(c.name_zh)}</strong>
          <p>${escapeHtml(c.front_narrative)}</p>
        </div>
      `).join('')}
    </section>

    <!-- 議案、怪物、混沌袋、卡池 -->
  `;
}
```

---

## 三、隨機地城規則分頁(`#tab-random-generator`)

### 3.1 分頁結構

```html
<section id="tab-random-generator" class="tab-content">
  <div class="random-gen-intro">
    <p>設計此隨機地城的產生器參數。執行期每次進入時,後端依此規則即時生成新關卡。</p>
  </div>

  <div class="random-gen-layout">
    <!-- 主編輯區 -->
    <div class="gen-config">
      <nav class="gen-subtab-bar">
        <button class="subtab-btn active" data-subtab="location-pool">地點池</button>
        <button class="subtab-btn" data-subtab="topology">地圖拓撲</button>
        <button class="subtab-btn" data-subtab="act-templates">目標模板</button>
        <button class="subtab-btn" data-subtab="agenda-templates">議案模板</button>
        <button class="subtab-btn" data-subtab="monsters">怪物規則</button>
        <button class="subtab-btn" data-subtab="chaos-bag">混沌袋規則</button>
        <button class="subtab-btn" data-subtab="pools">神話/遭遇</button>
        <button class="subtab-btn" data-subtab="victory-reward">勝利/獎勵</button>
      </nav>

      <section class="gen-subtab" data-subtab="location-pool"><!-- §3.2 --></section>
      <section class="gen-subtab hidden" data-subtab="topology"><!-- §3.3 --></section>
      <section class="gen-subtab hidden" data-subtab="act-templates"><!-- §3.4 --></section>
      <!-- 其他子分頁 -->
    </div>

    <!-- 種子驗證器 -->
    <aside class="gen-seed-verifier">
      <h3>種子驗證器</h3>
      <p class="hint">輸入隨機種子預覽會生成什麼</p>
      <input type="text" id="gen-seed" placeholder="輸入種子字串">
      <button class="btn-primary" onclick="runSeedVerification()">生成預覽</button>
      <div id="gen-preview-result"></div>
    </aside>
  </div>

  <div class="editor-footer">
    <button class="btn-primary" onclick="saveRandomGenerator()">儲存產生器</button>
  </div>
</section>
```

### 3.2 地點池子分頁

```html
<section class="gen-subtab" data-subtab="location-pool">
  <h4>候選地點池</h4>
  <p class="hint">至少 5 個候選地點</p>

  <div id="gen-location-pool-list"></div>
  <button onclick="openLocationPickerForRandomGen()">＋ 挑選地點(含權重)</button>

  <div class="pool-stats">
    <p>已加入:<span id="gen-location-count">0</span> 個地點</p>
  </div>
</section>
```

呼叫地點挑選對話框用 **權重模式**:

```javascript
function openLocationPickerForRandomGen() {
  openLocationPicker('random-gen-pool', {
    mode: 'weighted_list',
    title: '隨機地城地點池',
    hint: '選擇候選地點並為每個設定權重(1-10)',
    currentSelection: currentRandomGen?.location_pool || [],
    onConfirm: (selection) => {
      currentRandomGen.location_pool = selection;
      renderRandomGenLocationPool();
      markDirty();
    }
  });
}
```

### 3.3 地圖拓撲規則

```html
<section class="gen-subtab hidden" data-subtab="topology">
  <h4>地圖拓撲</h4>

  <div class="topology-grid">
    <label>地點數量下限 <input type="number" id="topo-min-count" min="3" max="30"></label>
    <label>地點數量上限 <input type="number" id="topo-max-count" min="3" max="30"></label>
    <label>每地點平均連接數 <input type="number" id="topo-avg-degree" step="0.1" min="1.0" max="4.0"></label>

    <label>拓撲形狀偏好
      <select id="topo-shape">
        <option value="linear">線性(一路走到底)</option>
        <option value="tree">樹狀(主線 + 分岔)</option>
        <option value="mesh">網狀(多路可互通)</option>
        <option value="hub">中心輻射(核心 + 周邊)</option>
      </select>
    </label>
  </div>

  <div class="topology-subsection">
    <h5>入口地點規則</h5>
    <label>入口標籤匹配(從地點標籤中)
      <input type="text" id="topo-entry-tags" placeholder="例:entrance,doorway">
    </label>
  </div>

  <div class="topology-subsection">
    <h5>出口/目標地點規則</h5>
    <label>出口標籤匹配
      <input type="text" id="topo-exit-tags" placeholder="例:sanctum,treasure_room">
    </label>
    <label>與入口的最短距離
      <input type="number" id="topo-exit-min-distance" min="1" max="10">
    </label>
  </div>
</section>
```

### 3.4 目標模板池

目標模板是一個結構化的「目標卡藍圖」,產生器會從模板池中隨機挑一張填入對應槽位。

```html
<section class="gen-subtab hidden" data-subtab="act-templates">
  <h4>目標卡模板池</h4>

  <div class="template-slots">
    <label>目標卡槽數
      <input type="number" id="tmpl-act-slot-count" min="1" max="5">
    </label>
  </div>

  <div id="act-templates-list"></div>
  <button onclick="addActTemplate()">＋ 新增模板</button>
</section>
```

每個模板的結構:

```json
{
  "template_id": "tmpl_truth_investigation",
  "name_zh": "真相調查",
  "objective_type": "uncover_truth",
  "advance_condition_template": {
    "type": "spend_clues",
    "count_range": [6, 10]
  },
  "narrative_theme": "神秘學派的秘密手記"
}
```

### 3.5 議案模板池、怪物規則、混沌袋規則

結構類似,此處不重複展開——設計意圖是設計師輸入**範圍參數**(如毀滅門檻範圍 3-6、怪物家族權重分佈等),產生器在範圍內隨機選。

### 3.6 勝利條件與獎勵

```html
<section class="gen-subtab hidden" data-subtab="victory-reward">
  <h4>勝利條件組合</h4>
  <p class="hint">從五大任務類型中選擇可能的組合</p>
  <div class="victory-checkboxes">
    ${['seal_gate', 'defeat_titan', 'uncover_truth', 'escape', 'endurance'].map(t => `
      <label><input type="checkbox" value="${t}"> ${objectiveTypeLabel(t)}</label>
    `).join('')}
  </div>

  <h4>獎勵規則</h4>
  <div class="reward-rules-grid">
    <label>基礎經驗值 <input type="number" id="reward-base-xp" min="0" max="10"></label>
    <label>基礎天賦點 <input type="number" id="reward-base-tp" min="0" max="5"></label>
    <label>基礎凝聚力 <input type="number" id="reward-base-cohesion" min="0" max="5"></label>
    <label>難度加乘(簡單) <input type="number" id="reward-mult-easy" step="0.1" min="0.5" max="2.0" value="1.0"></label>
    <label>難度加乘(困難) <input type="number" id="reward-mult-hard" step="0.1" min="0.5" max="2.0" value="1.5"></label>
  </div>
</section>
```

### 3.7 種子驗證器

呼叫後端 `POST /api/stages/:id/random-generator/generate`,傳入 `seed` 參數,取得一份預覽關卡配置,渲染到右側。

```javascript
async function runSeedVerification() {
  const seed = document.getElementById('gen-seed').value.trim()
            || Math.random().toString(36).substring(2, 10);
  document.getElementById('gen-seed').value = seed;

  try {
    const res = await adminFetch(
      `/api/stages/${currentStage.id}/random-generator/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed })
      }
    );

    if (!res.ok) {
      const err = await res.json();
      alert('產生預覽失敗:' + err.error);
      return;
    }

    const result = await res.json();
    renderGenerationPreview(result);
  } catch (e) {
    alert('錯誤:' + e.message);
  }
}

function renderGenerationPreview(result) {
  const container = document.getElementById('gen-preview-result');
  container.innerHTML = `
    <div class="preview-result">
      <h4>生成結果(種子:${result.seed})</h4>

      <section>
        <h5>地圖(${result.locations.length} 個地點)</h5>
        <ul>${result.locations.map(l =>
          `<li>${escapeHtml(l.name_zh)} <code>${l.code}</code></li>`
        ).join('')}</ul>
        <p>連接數:${result.connections.length}</p>
      </section>

      <section>
        <h5>目標卡(${result.act_cards.length} 張)</h5>
        ${result.act_cards.map(c =>
          `<div><strong>${c.card_order}. ${escapeHtml(c.name_zh)}</strong></div>`
        ).join('')}
      </section>

      <section>
        <h5>議案卡(${result.agenda_cards.length} 張)</h5>
        ${result.agenda_cards.map(c =>
          `<div><strong>${c.card_order}. ${escapeHtml(c.name_zh)}</strong>(門檻 ${c.front_doom_threshold})</div>`
        ).join('')}
      </section>

      <section>
        <h5>怪物池</h5>
        ${result.monster_pool.map(p =>
          `<div>${p.role} - ${p.family_code} (${p.allowed_tiers.join(',')})</div>`
        ).join('')}
      </section>
    </div>
  `;
}
```

---

## 四、隨機地城生成演算法(後端)

### 4.1 位置

在 `packages/server/src/routes/stages.ts` 的 `POST /api/stages/:id/random-generator/generate` 端點,呼叫新建立的服務模組 `packages/server/src/services/random-dungeon-generator.ts`。

### 4.2 服務模組骨架

```typescript
import seedrandom from 'seedrandom';
import { PoolClient } from 'pg';

export interface GenerationResult {
  seed: string;
  stage_metadata: any;
  locations: any[];
  connections: any[];
  scenarios: any[];
  act_cards: any[];
  agenda_cards: any[];
  monster_pool: any[];
  chaos_bag: any;
  mythos_pool: any[];
  encounter_pool: any[];
}

export async function generateRandomDungeon(
  stageId: string,
  seed: string,
  client: PoolClient
): Promise<GenerationResult> {
  const rng = seedrandom(seed);

  // 1. 讀取產生器配置
  const genRes = await client.query(
    `SELECT * FROM random_dungeon_generators WHERE stage_id = $1`,
    [stageId]
  );
  if (genRes.rowCount === 0) throw new Error('產生器未建立');
  const gen = genRes.rows[0];

  // 2. 產生地圖
  const { locations, connections } = await generateMap(gen, rng, client);

  // 3. 產生目標牌堆
  const actCards = generateActCards(gen, rng);

  // 4. 產生議案牌堆
  const agendaCards = generateAgendaCards(gen, rng);

  // 5. 產生怪物池
  const monsterPool = generateMonsterPool(gen, rng);

  // 6. 產生混沌袋
  const chaosBag = generateChaosBag(gen, rng);

  // 7. 神話 / 遭遇卡池取樣
  const mythosPool = sampleMythosPool(gen, rng);
  const encounterPool = sampleEncounterPool(gen, rng);

  // 8. 組合起始場景
  const scenarios = [{
    scenario_order: 1,
    name_zh: '起始場景',
    initial_location_codes: locations.map(l => l.code),
    initial_connections: connections,
    investigator_spawn_location: findEntryLocation(locations, connections, gen).code,
    initial_environment: {},
    initial_enemies: []
  }];

  return {
    seed,
    stage_metadata: {
      name_zh: `隨機地城(${seed})`,
      narrative: '隨機生成的地城'
    },
    locations,
    connections,
    scenarios,
    act_cards: actCards,
    agenda_cards: agendaCards,
    monster_pool: monsterPool,
    chaos_bag: chaosBag,
    mythos_pool: mythosPool,
    encounter_pool: encounterPool
  };
}

// ----- 子函式 -----

function weightedSample<T>(items: { item: T, weight: number }[], rng: () => number): T {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = rng() * total;
  for (const x of items) {
    r -= x.weight;
    if (r <= 0) return x.item;
  }
  return items[items.length - 1].item;
}

async function generateMap(gen: any, rng: () => number, client: PoolClient) {
  const topo = gen.topology_rules;
  const pool = gen.location_pool as any[];
  const count = Math.floor(rng() * (topo.max_count - topo.min_count + 1)) + topo.min_count;

  // 從池中取樣 count 個地點
  const poolSource = pool.map(p => ({ item: p, weight: p.weight }));
  const selectedCodes = new Set<string>();
  while (selectedCodes.size < count && selectedCodes.size < pool.length) {
    selectedCodes.add(weightedSample(poolSource, rng).code);
  }

  // 查 locations 表取得完整資料
  const locRes = await client.query(
    `SELECT * FROM locations WHERE code = ANY($1)`, [[...selectedCodes]]
  );

  const locations = locRes.rows;

  // 建立連接(依 topology shape)
  const connections = buildConnections(locations, topo, rng);

  return { locations, connections };
}

function buildConnections(locations: any[], topo: any, rng: () => number): any[] {
  const shape = topo.shape || 'mesh';
  const avgDegree = topo.avg_degree || 2.0;

  if (shape === 'linear') {
    // 鏈狀:1 → 2 → 3 → ... → n
    return locations.slice(0, -1).map((loc, i) => ({
      from: loc.code,
      to: locations[i + 1].code,
      cost: 1
    }));
  }

  if (shape === 'tree') {
    // 樹狀:每個節點連到一個父節點
    const connections = [];
    for (let i = 1; i < locations.length; i++) {
      const parent = locations[Math.floor(rng() * i)];
      connections.push({ from: parent.code, to: locations[i].code, cost: 1 });
    }
    return connections;
  }

  if (shape === 'mesh') {
    // 網狀:每個節點連到 avgDegree 個隨機鄰居
    const connections = [];
    const seen = new Set<string>();
    for (const loc of locations) {
      const edgesNeeded = Math.round(avgDegree);
      const others = locations.filter(l => l.code !== loc.code);
      for (let i = 0; i < edgesNeeded && i < others.length; i++) {
        const target = others[Math.floor(rng() * others.length)];
        const key = [loc.code, target.code].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        connections.push({ from: loc.code, to: target.code, cost: 1 });
      }
    }
    return connections;
  }

  // hub: 第一個節點連所有其他節點
  return locations.slice(1).map(loc => ({
    from: locations[0].code,
    to: loc.code,
    cost: 1
  }));
}

function generateActCards(gen: any, rng: () => number): any[] {
  const templates = gen.act_template_pool?.templates || [];
  const slotCount = gen.act_template_pool?.slot_count || 3;
  const result = [];

  for (let i = 1; i <= slotCount; i++) {
    const templateChoice = templates[Math.floor(rng() * templates.length)];
    if (!templateChoice) continue;

    const advanceRange = templateChoice.advance_condition_template?.count_range || [5, 10];
    const count = Math.floor(rng() * (advanceRange[1] - advanceRange[0] + 1)) + advanceRange[0];

    result.push({
      card_order: i,
      name_zh: templateChoice.name_zh,
      front_objective_types: [templateChoice.objective_type],
      front_narrative: templateChoice.narrative_theme,
      front_advance_condition: {
        type: templateChoice.advance_condition_template.type,
        count
      },
      back_narrative: '(自動生成)',
      back_rewards: {}
    });
  }

  return result;
}

// generateAgendaCards, generateMonsterPool, generateChaosBag, sampleMythosPool, sampleEncounterPool,
// findEntryLocation 的實作類似,依 gen 參數產生對應的配置
```

### 4.3 後端路由呼叫

```typescript
app.post('/api/stages/:id/random-generator/generate', async (req, reply) => {
  const { id } = req.params as { id: string };
  const { seed } = req.body as { seed?: string };

  const stageRes = await pool.query('SELECT stage_type FROM stages WHERE id = $1', [id]);
  if (stageRes.rowCount === 0) return reply.status(404).send({ error: '關卡不存在' });
  if (stageRes.rows[0].stage_type !== 'side_random') {
    return reply.status(400).send({ error: '此關卡非隨機地城類型' });
  }

  const client = await pool.connect();
  try {
    const result = await generateRandomDungeon(
      id,
      seed || Math.random().toString(36).substring(2, 12),
      client
    );

    // 記錄最後驗證時間
    await client.query(
      'UPDATE random_dungeon_generators SET seed_verified_at = NOW() WHERE stage_id = $1',
      [id]
    );

    return reply.send(result);
  } catch (e) {
    return reply.status(500).send({ error: (e as Error).message });
  } finally {
    client.release();
  }
});
```

### 4.4 安裝 `seedrandom` 套件

在 `packages/server/package.json` 新增依賴:

```bash
cd packages/server
pnpm add seedrandom
pnpm add -D @types/seedrandom
```

---

## 五、AI 整合(Gemini 七個生成點)

### 5.1 共用設定

沿用 MOD-06 的 `getGeminiKey()`、`promptApiKey()`、`callGemini()`、`extractJson()`、`CTHULHU_SYSTEM_BASE`。可直接複製到本模組,或抽出至 `admin-shared-ai.js`。

### 5.2 七個生成點

#### 5.2.1 目標卡敘事

```javascript
async function aiGenerateActFrontNarrative() {
  if (!currentActCard || !currentStage) return;

  const types = collectSelectedObjectiveTypes('ac-front-type');
  const userPrompt = `請為以下目標卡撰寫正面敘事。

關卡:${currentStage.name_zh}
關卡敘事定位:${currentStage.narrative}
本目標卡任務類型:${types.map(objectiveTypeLabel).join(' + ')}
推進條件概要:${JSON.stringify(currentActCard.front_advance_condition)}

要求:
1. 正面敘事 80–150 字,向玩家說明當前目標與情境張力
2. 第二人稱,有氛圍鋪陳
3. 同時生成背面結算敘事(50–100 字,描寫完成目標後的轉折)
4. 回傳 JSON:{ "front_narrative": "…", "back_narrative": "…" }`;

  try {
    const response = await callGemini(CTHULHU_SYSTEM_BASE, userPrompt);
    const parsed = extractJson(response);
    if (parsed.front_narrative) {
      document.getElementById('ac-front-narrative').value = parsed.front_narrative;
    }
    if (parsed.back_narrative) {
      document.getElementById('ac-back-narrative').value = parsed.back_narrative;
    }
    markDirty();
    showToast('敘事已生成', 'success');
  } catch (e) {
    showToast('AI 生成失敗:' + e.message, 'error');
  }
}
```

#### 5.2.2 議案卡敘事

```javascript
async function aiGenerateAgendaFrontNarrative() {
  const threshold = document.getElementById('agc-front-doom-threshold').value;
  const userPrompt = `請為以下議案卡撰寫正面敘事。

關卡:${currentStage.name_zh}
毀滅門檻:${threshold}(回合數越接近此值,越應營造迫近感)
關卡敘事:${currentStage.narrative}

要求:
1. 正面敘事 80–150 字,描寫敵人計畫正在推進
2. 同時生成背面結算敘事(50–100 字,描寫若玩家未能及時阻止的後果)
3. 回傳 JSON:{ "front_narrative": "…", "back_narrative": "…" }`;
  // ...
}
```

#### 5.2.3 場景轉換敘事

```javascript
async function aiGenerateSceneNarrative() {
  if (!currentScenario) return;

  const userPrompt = `請為以下場景撰寫敘事。

關卡:${currentStage.name_zh}
場景順序:第 ${currentScenario.scenario_order} 個場景
初始地點:${(currentScenario.initial_location_codes || []).join(', ') || '(未設定)'}

要求:
1. 場景敘事 100–200 字
2. 若為起始場景,營造進入關卡的開場氛圍
3. 若為後續場景,敘述從前場景轉換的戲劇轉折

僅回傳敘事文字,不用 JSON 包裹。`;

  const response = await callGemini(CTHULHU_SYSTEM_BASE, userPrompt);
  document.getElementById('sc-narrative').value = response.trim();
  markDirty();
}
```

#### 5.2.4 地圖佈局建議

```javascript
async function aiSuggestMapLayout() {
  const userPrompt = `請為以下關卡建議地圖佈局。

關卡主題:${currentStage.name_zh}
預期地點數:${document.getElementById('topo-min-count').value}–${document.getElementById('topo-max-count').value}
可選地點池:${currentRandomGen.location_pool.map(p => p.code).join(', ')}

要求:
1. 從地點池中建議 6–10 個地點的組合
2. 提出連接關係建議(哪些地點應互通)
3. 建議調查員入口地點與目標地點
4. 回傳 JSON:{ "locations": [...], "connections": [...], "entry": "...", "goal": "..." }`;
  // ...
}
```

#### 5.2.5 重返版覆寫建議

```javascript
async function aiSuggestReturnOverrides() {
  const parent = currentReturnParent;
  const returnNum = document.getElementById('return-stage-number').value;

  const userPrompt = `請為以下支線重返版建議覆寫方案。

原始支線:${parent.name_zh}
原始敘事:${parent.narrative}
重返次數:第 ${returnNum} 次
原始怪物家族:${(parent.monster_pool || []).map(p => p.family_code).join(', ')}

要求:
1. 建議難度遞增方案(第 ${returnNum} 次應該比前一次更難)
2. 建議敘事微調(為何玩家要再次挑戰、環境有何變化)
3. 可選的怪物替換(升級到更高位階)
4. 回傳 JSON:{ "narrative_override": "…", "monster_adjustments": {…}, "chaos_bag_additions": […], "suggested_summary": "…" }`;
  // ...
}
```

#### 5.2.6 隨機地城主題描述

```javascript
async function aiGenerateRandomDungeonTheme() {
  const userPrompt = `請為以下隨機地城產生器撰寫主題描述。

候選地點(${currentRandomGen.location_pool.length} 個):${currentRandomGen.location_pool.map(p => p.code).slice(0, 5).join(', ')}
主怪物家族:${currentRandomGen.monster_rules?.primary_family || '(未設定)'}

要求:
1. 撰寫 150–250 字的關卡敘事主題
2. 設定這是一個怎樣的地城(禁忌圖書館、邪教地下室、深海遺跡等)
3. 玩家進入的動機鋪陳

僅回傳敘事文字。`;
  // ...
}
```

#### 5.2.7 中譯英通用

沿用 MOD-06 的 `aiTranslate()` 函式。

---

## 六、完整性檢查分頁(`#tab-completeness`)

### 6.1 分頁結構

```html
<section id="tab-completeness" class="tab-content">
  <div class="completeness-summary">
    <div id="overall-badge"></div>
    <p id="overall-message"></p>
  </div>

  <div class="checks-container">
    <section class="check-section">
      <h3>基礎資料</h3>
      <ul id="checks-metadata"></ul>
    </section>

    <section class="check-section">
      <h3>場景與地圖</h3>
      <ul id="checks-scenarios"></ul>
    </section>

    <section class="check-section">
      <h3>牌堆</h3>
      <ul id="checks-decks"></ul>
    </section>

    <section class="check-section">
      <h3>資源池(混沌袋/家族/神話/遭遇)</h3>
      <ul id="checks-pools"></ul>
    </section>

    <section class="check-section">
      <h3>跨模組引用完整性</h3>
      <ul id="checks-references"></ul>
    </section>

    <section class="check-section" id="checks-type-specific-section">
      <h3 id="type-specific-heading">類型特定檢查</h3>
      <ul id="checks-type-specific"></ul>
    </section>
  </div>

  <div class="editor-footer">
    <button onclick="runCompletenessCheck()">重新檢查</button>
  </div>
</section>
```

### 6.2 四種關卡類型的檢查規則

依 `currentStage.stage_type` 動態套用:

```javascript
function runCompletenessCheck() {
  const report = {
    metadata: checkMetadata(),
    scenarios: checkScenarios(),
    decks: checkDecks(),
    pools: checkPools(),
    references: checkReferences(),
    typeSpecific: checkTypeSpecific()
  };

  renderCompletenessReport(report);
}

function checkTypeSpecific() {
  switch (currentStage.stage_type) {
    case 'main': return checkMainStage();
    case 'side': return checkSideStage();
    case 'side_return': return checkSideReturnStage();
    case 'side_random': return checkSideRandomStage();
  }
}

function checkMainStage() {
  const checks = [];
  checks.push({ pass: !!currentStage.chapter_id, label: '已綁定章節' });
  checks.push({
    pass: (currentStage.completion_flags?.length || 0) > 0,
    label: '至少授予 1 個通關旗標'
  });
  checks.push({
    pass: (currentStage.mythos_pool?.length || 0) > 0,
    label: '神話卡池至少 1 張(主線需要)'
  });
  return checks;
}

function checkSideStage() {
  const checks = [];
  checks.push({
    pass: (currentStage.completion_flags?.length || 0) === 0,
    label: '不產生任何旗標(支線規則)'
  });
  return checks;
}

function checkSideReturnStage() {
  const checks = [];
  checks.push({
    pass: !!currentStage.return_parent_id,
    label: '已指定原始支線關卡'
  });
  checks.push({
    pass: currentStage.return_overrides &&
          Object.keys(currentStage.return_overrides).length > 0,
    label: 'Overrides 中至少有一項變化'
  });
  return checks;
}

function checkSideRandomStage() {
  const checks = [];
  const gen = currentStage.random_generator;
  checks.push({
    pass: gen && (gen.location_pool?.length || 0) >= 5,
    label: '地點池至少 5 個候選地點'
  });
  checks.push({
    pass: gen?.topology_rules?.min_count >= 3,
    label: '拓撲規則地點數量下限 ≥ 3'
  });
  checks.push({
    pass: (gen?.act_template_pool?.templates?.length || 0) >= 1,
    label: '目標模板池至少 1 套'
  });
  checks.push({
    pass: !!gen?.seed_verified_at,
    label: '種子驗證器至少執行過 1 次'
  });
  return checks;
}
```

### 6.3 通用檢查

```javascript
function checkMetadata() {
  return [
    { pass: !!currentStage.name_zh, label: '中文名稱' },
    { pass: !!currentStage.narrative && currentStage.narrative.length > 30, label: '敘事定位(≥ 30 字)' }
  ];
}

function checkScenarios() {
  const checks = [];
  checks.push({
    pass: (currentStage.scenarios?.length || 0) >= 1,
    label: '至少 1 個場景'
  });
  const starting = currentStage.scenarios?.find(s => s.scenario_order === 1);
  checks.push({
    pass: !!starting && (starting.initial_location_codes?.length || 0) >= 1,
    label: '起始場景至少 1 個初始地點'
  });
  checks.push({
    pass: !!starting?.investigator_spawn_location,
    label: '起始場景有指定調查員進場地點'
  });
  return checks;
}

function checkDecks() {
  return [
    {
      pass: (currentStage.act_cards?.length || 0) >= 2,
      label: '至少 2 張目標卡'
    },
    {
      pass: (currentStage.agenda_cards?.length || 0) >= 2,
      label: '至少 2 張議案卡'
    }
  ];
}

function checkPools() {
  const checks = [];
  checks.push({
    pass: !!currentStage.chaos_bag?.number_markers,
    label: '混沌袋數字標記已配置'
  });
  checks.push({
    pass: (currentStage.monster_pool?.filter(p => p.role === 'primary').length || 0) >= 1,
    label: '至少 1 個主家族'
  });
  return checks;
}

async function checkReferences() {
  // 呼叫後端校驗 API 取得完整引用報告
  const res = await adminFetch(`/api/stages/${currentStage.id}/references-check`);
  const report = await res.json();

  return [
    {
      pass: report.missing_flags.length === 0,
      label: '所有引用的旗標都存在',
      details: report.missing_flags.length > 0 ? `缺漏:${report.missing_flags.join(', ')}` : null
    },
    {
      pass: report.missing_locations.length === 0,
      label: '所有引用的地點都存在',
      details: report.missing_locations.length > 0 ? `缺漏:${report.missing_locations.join(', ')}` : null
    },
    {
      pass: report.missing_families.length === 0,
      label: '所有引用的怪物家族都存在',
      details: report.missing_families.length > 0 ? `缺漏:${report.missing_families.join(', ')}` : null
    }
    // ... 神話卡、遭遇卡
  ];
}
```

### 6.4 後端 references-check 端點

補到 `stages.ts`:

```typescript
app.get('/api/stages/:id/references-check', async (req, reply) => {
  const { id } = req.params as { id: string };
  const result = await validateStageReferences(await loadFullStage(id), pool);
  return reply.send(result.missing);
});
```

---

## 七、MEMORY.md 與檔案索引更新

### 7.1 更新 `檔案索引_v01_26041801.md`

找到 §7 MOD-07 關卡編輯器,改寫:

```markdown
## §7 MOD-07 關卡編輯器

### 前端 `packages/client/public/admin/admin-scenario-editor.html`
**關卡列表與選擇**
- `loadStageList()` / `renderStageList()` / `selectStage(id)`
- `openCreateStageDialog()` / `confirmCreateStage()`

**關卡總覽分頁**
- `renderOverviewTab()` / `applySectionVisibility()` / `saveStage()`
- `loadCampaignsForStageDropdown()` / `onCampaignChangeForStage()`

**場景序列分頁**
- `renderScenariosTab()` / `addScenario()` / `selectScenario(id)`
- `saveScenario()` / `applyScenarioMode()`

**目標牌堆分頁**
- `renderActCardsTab()` / `addActCard()` / `selectActCard(id)` / `saveActCard()`
- `renderAdvanceConditionEditor(el, cond, onChange)`

**議案牌堆分頁**
- `renderAgendaCardsTab()` / 同目標但對稱為議案
- `renderPenaltiesEditor(el, penalties)`

**地圖操作指令(共用元件)**
- `renderMapOperationsEditor(el, ops, onChange)` / `renderOpsList()` / `renderParamField(p, val)`
- `openVerbPickerDialog(onSelect)` / `updateOpParam()` / `moveOp()` / `duplicateOp()`

**地點挑選對話框(共用)**
- `openLocationPicker(context, options)` / `renderLocationPickerList()` / `toggleLocationPick(code)`

**混沌袋分頁**
- `renderChaosBagTab()` / `applyChaosBagPreset(preset)` / `calculateChaosBagStats(bag)`
- `applySuggestionsBasedOnMonsterPool()`

**遭遇/神話卡池分頁**
- `renderEncounterPoolTab()` / `openEncounterCardPicker()` / `confirmAddEncounters()`
- `renderMythosPoolTab()` / 對稱函式

**怪物家族池分頁**
- `renderMonsterPoolTab()` / `addFamilyToPool(code, role)` / `openBossPicker()`
- `addFixedBoss(variantId)` / `removeFixedBoss(poolId, variantId)`

**重返覆寫分頁**
- `renderReturnOverridesTab()` / `renderOverridesActCards()` / `renderOverridesMetadata()`
- `collectAllOverrides()` / `saveReturnOverrides()` / `previewResolvedStage()`

**隨機地城分頁**
- `renderRandomGeneratorTab()` / `saveRandomGenerator()` / `runSeedVerification()`

**AI 整合**
- `aiGenerateActFrontNarrative()` / `aiGenerateAgendaFrontNarrative()` / `aiGenerateSceneNarrative()`
- `aiSuggestMapLayout()` / `aiSuggestReturnOverrides()` / `aiGenerateRandomDungeonTheme()`
- `aiTranslate(src, tgt)` / `callGemini()` / `extractJson()`

**完整性檢查**
- `runCompletenessCheck()` / `checkMetadata()` / `checkScenarios()` / `checkDecks()`
- `checkTypeSpecific()` / `checkMainStage()` / `checkSideStage()` / `checkSideReturnStage()` / `checkSideRandomStage()`

### 後端 `packages/server/src/routes/stages.ts`
- 關卡 CRUD:`GET/POST/PUT/DELETE /api/stages[/:id]`
- 解析重返版:`GET /api/stages/:id/resolved`
- 場景:`GET/POST /api/stages/:stageId/scenarios` / `PUT/DELETE /api/scenarios/:id`
- 目標牌堆:`GET/POST /api/stages/:stageId/act-cards` / `PUT/DELETE /api/act-cards/:id`
- 議案牌堆:`GET/POST /api/stages/:stageId/agenda-cards` / `PUT/DELETE /api/agenda-cards/:id`
- 遭遇卡池:`GET/POST /api/stages/:stageId/encounter-pool` / `PUT/DELETE /api/encounter-pool/:id`
- 神話卡池:`GET/POST /api/stages/:stageId/mythos-pool` / `PUT/DELETE /api/mythos-pool/:id`
- 混沌袋:`GET/PUT /api/stages/:stageId/chaos-bag`
- 怪物家族池:`GET/POST /api/stages/:stageId/monster-pool` / `PUT/DELETE /api/monster-pool/:id`
- 隨機地城:`GET/PUT /api/stages/:stageId/random-generator` / `POST /api/stages/:id/random-generator/generate`
- 引用檢查:`GET /api/stages/:id/references-check`
- 匯出:`GET /api/stages/:id/export`

### 後端 helper
- `packages/server/src/utils/stage-validators.ts` — 跨模組校驗 + overrides 合併
- `packages/server/src/services/random-dungeon-generator.ts` — 隨機地城生成服務

### 資料庫(MIGRATION_018)
- `stages` / `scenarios` / `stage_act_cards` / `stage_agenda_cards`
- `stage_encounter_pool` / `stage_mythos_pool` / `stage_chaos_bag` / `stage_monster_pool`
- `random_dungeon_generators`
```

### 7.2 更新 MOD → 檔案對應總表

將 MOD-07 狀態從「尚未建置」改為「READY」。

### 7.3 更新檔案索引頂部日期碼

改為今日。

### 7.4 更新 `MEMORY.md`

在適當位置加入 MOD-07 完成的紀錄。

---

## 八、驗收清單

完成本份後:

- [ ] 重返覆寫分頁(`side_return` 關卡):左側顯示原始支線配置,右側編輯覆寫
- [ ] 元資料覆寫可設定並儲存
- [ ] 目標卡覆寫:每張原始卡可獨立覆寫任何欄位
- [ ] 新增原始支線沒有的新目標卡可運作
- [ ] 議案卡覆寫對稱
- [ ] 怪物覆寫:位階調整、頭目替換、新增家族皆可配置
- [ ] 混沌袋覆寫:僅記變化的結構可編輯
- [ ] 卡池覆寫:新增卡、移除卡的配置可儲存
- [ ] 「預覽合併結果」呼叫 `/api/stages/:id/resolved` 顯示合併後配置
- [ ] 隨機地城規則分頁(`side_random` 關卡):八個子分頁皆可編輯
- [ ] 地點池採用權重模式挑選
- [ ] 種子驗證器:輸入種子 → 呼叫後端產生 → 右側顯示預覽關卡
- [ ] 後端 `/api/stages/:id/random-generator/generate` 能依規則產生一份合理的關卡配置
- [ ] AI 生成按鈕:七個生成點皆可呼叫 Gemini
- [ ] 完整性檢查分頁:依關卡類型套用對應檢查規則
- [ ] `main` 關卡檢查:章節綁定、通關旗標、神話卡池
- [ ] `side` 關卡檢查:不產生旗標
- [ ] `side_return` 關卡檢查:有 parent、有覆寫
- [ ] `side_random` 關卡檢查:地點池、拓撲、模板、種子驗證
- [ ] 跨模組引用完整性檢查:缺漏的地點/家族/旗標/卡片會具體列出
- [ ] 檔案索引更新:MOD-07 狀態為 READY
- [ ] MEMORY.md 補上 MOD-07 完成紀錄

---

## 九、實作注意事項

1. **重返覆寫的 UI 是本份最複雜的部分**,建議先實作元資料覆寫 → 驗證合併 → 再依序擴充到目標/議案/怪物/混沌袋/卡池。分階段交付避免一次性錯誤太多
2. **地圖操作指令編輯器在重返覆寫內也要能使用**——這印證了 Part 3 把它做成共用元件的價值
3. **種子驗證器與執行期共用同一個生成邏輯**——這是 Part 1 裁決的關鍵原則,確保設計師看到的預覽就是玩家將玩到的
4. **隨機地城生成演算法骨架可運作即可**,細節演算法(加權取樣、拓撲生成)可後續優化,不阻擋 MOD-07 收工
5. **AI 生成按鈕的上下文資料要充足**:Prompt 中包含關卡敘事、當前配置、前後關聯,才能產出高品質內容
6. **完整性檢查對 `side_return` 的引用**:要遞迴檢查 overrides 中新增的地點/家族/卡片是否存在
7. **匯出/匯入支援重返版**:匯出時一併帶上 `return_parent_id` 與 `return_overrides`,匯入時若 parent 不存在要提示

---

## 十、MOD-07 完成聲明

完成本份後,MOD-07 應達到以下狀態:

- 11 個分頁可依關卡類型動態顯示/隱藏
- 四種關卡類型(主線/支線/重返版/隨機地城)皆可完整建立與編輯
- 後端所有端點可用,含重返版合併邏輯、隨機地城生成
- AI 整合七個生成點
- 完整性檢查涵蓋所有類型
- 檔案索引標註 READY

至此,MOD-06 + MOD-07 兩個模組完全建置完成,戰役與關卡的完整設計流程可以跑通:**戰役骨架 → 章節分支 → 關卡實作 → 場景序列 → 牌堆設計 → 隨機地城產生器**。

---

## 十一、後續工作

MOD-06 與 MOD-07 完成後,剩餘待建置的模組是 MOD-13 個人秘密任務編輯器(新增)。現有的 MOD-01 到 MOD-11 皆已 READY,可進入整合測試階段。
