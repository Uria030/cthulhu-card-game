# MOD-06 戰役敘事設計器 · Claude Code 指令 Part 4:AI 整合、種子資料、完整性檢查

> **系列**:MOD-06 實作指令 · 第 4 份 / 共 4 份
> **依據規格**:`MOD06_戰役敘事設計器_總覽規格_v0_2.md`
> **前置條件**:Part 1 + Part 2 + Part 3 已完成
> **本份產出**:Gemini AI 整合、完整性檢查分頁、種子資料(示範戰役)、匯出/匯入功能
> **執行角色**:Claude Code 依此文件實作檔案變更

---

## 一、任務範圍

本份是 MOD-06 的收尾:

- **AI 整合**:Gemini 2.5 Flash 前端直接呼叫,涵蓋六個生成點 + 中譯英
- **完整性檢查分頁**:戰役與章節的可發佈檢查清單與修正提示
- **種子資料**:示範戰役「印斯茅斯陰影」完整配置(元資料、前兩章完整內容、旗標字典、混沌袋)
- **匯出/匯入**:戰役 JSON 格式、跨實例複製
- **MEMORY.md 與檔案索引更新**

實作完成後,MOD-06 整體狀態應從「尚未建置」變更為「READY」。

---

## 二、AI 整合(Gemini 2.5 Flash)

### 2.1 整合模式

沿用專案既有模式(MOD-01/02/03/08/10):**前端直接呼叫 Gemini API**,API Key 存在 `localStorage.gemini_api_key`。後端無 AI 角色。

### 2.2 API Key 管理

完全沿用 MOD-01 的實作:

```javascript
function getGeminiKey() {
  return localStorage.getItem('gemini_api_key') || '';
}

function promptApiKey() {
  const key = prompt('請輸入 Gemini API Key(儲存在瀏覽器本機):', getGeminiKey());
  if (key !== null) {
    localStorage.setItem('gemini_api_key', key.trim());
    updateApiKeyStatus();
  }
}

function updateApiKeyStatus() {
  const indicator = document.getElementById('ai-key-status');
  if (!indicator) return;
  indicator.textContent = getGeminiKey() ? '🔑 已設定' : '⚠️ 未設定';
  indicator.className = getGeminiKey() ? 'key-ok' : 'key-missing';
}
```

頁面右上角放 API Key 指示器:
```html
<button id="ai-key-status" onclick="promptApiKey()">⚠️ 未設定</button>
```

### 2.3 Gemini 呼叫封裝

```javascript
async function callGemini(systemPrompt, userPrompt) {
  const key = getGeminiKey();
  if (!key) {
    alert('請先設定 Gemini API Key');
    promptApiKey();
    throw new Error('no_api_key');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;

  const body = {
    contents: [
      { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }
    ],
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 2048
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API 錯誤:${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}
```

### 2.4 克蘇魯氛圍 System Prompt(共用底稿)

```javascript
const CTHULHU_SYSTEM_BASE = `你是一個克蘇魯神話背景的卡牌合作冒險遊戲的敘事設計助手。

專案特色:
- 背景:1920–30 年代偵探黑色電影 × 宇宙恐怖
- 情感基調:渺小感、未知的不安、真實的代價、探索的驚奇
- 敘事風格:簡潔克制、重氛圍、避免過度血腥、保留想像空間
- 術語規範:克蘇魯神話專有名詞採用台灣 TRPG/桌遊社群慣用譯名(例:「克蘇魯」「奈亞拉托提普」「印斯茅斯」「敦威治」「阿卡姆」)

設計紅線:
- 不使用過度現代的網路用語
- 不寫成恐怖片誇張式的血腥
- 不讓角色「無敵」或「樂觀」,保持克蘇魯宿命感
- 傷亡與代價要真實、有重量
`;
```

### 2.5 六個生成點的 Prompt 模板

#### 2.5.1 戰役封面敘事

```javascript
async function aiGenerateCoverNarrative() {
  if (!currentCampaign) return;

  const userPrompt = `請為以下戰役撰寫封面敘事。

戰役名稱:${currentCampaign.name_zh}
主題:${currentCampaign.theme || '(尚未設定)'}
難度:${difficultyLabel(currentCampaign.difficulty_tier)}
章節數:10 章

要求:
1. 300–500 字的中文敘事
2. 第二人稱視角,營造調查員收到線索/邀請/信件的開場氛圍
3. 提示戰役將遭遇的神話威脅,但不明示真相
4. 最後以一句開放性問句或未明結尾收束
5. 同時產出對應的英文翻譯版本

回應格式(嚴格 JSON,不加任何額外文字):
{
  "narrative_zh": "中文敘事…",
  "narrative_en": "English narrative…"
}`;

  try {
    const response = await callGemini(CTHULHU_SYSTEM_BASE, userPrompt);
    const parsed = extractJson(response);
    if (parsed.narrative_zh) {
      document.getElementById('field-cover-narrative').value = parsed.narrative_zh;
      markDirty();
      showToast('封面敘事已生成', 'success');
    }
  } catch (e) {
    showToast('AI 生成失敗:' + e.message, 'error');
  }
}
```

#### 2.5.2 章節劇情演示

```javascript
async function aiGenerateNarrativeIntro() {
  if (!currentChapter || !currentCampaign) return;

  const prevChapter = findPreviousChapter(currentChapter);
  const prevOutcomes = prevChapter?.outcomes || [];

  const userPrompt = `請為以下章節撰寫劇情演示。

戰役:${currentCampaign.name_zh}
本章:第 ${currentChapter.chapter_number} 章(${currentChapter.name_zh || currentChapter.chapter_code})
敘事定位:${document.getElementById('ch-narrative-positioning').value || '(未填)'}
前章結果:${prevOutcomes.length > 0 ? prevOutcomes.map(o => `${o.outcome_code}: ${o.narrative_text.substring(0, 80)}`).join(' / ') : '(本章為第 1 章)'}

要求:
1. 演示文字 200–400 字,第二人稱視角
2. 提供 2–3 個劇情選項,每個選項代表調查員面對的態度/行動方向
3. 選項應該對後續章節產生不同影響(設定不同旗標)
4. 選項之間必須有意義區別,不要只是措辭不同

回應格式(嚴格 JSON):
{
  "narrative": "演示文字…",
  "choices": [
    { "text_zh": "選項 1", "text_en": "Option 1", "suggested_flag": "choice.ch2_approach_direct" },
    { "text_zh": "選項 2", "text_en": "Option 2", "suggested_flag": "choice.ch2_approach_cautious" }
  ]
}`;

  // 同 2.5.1 的處理流程
  // 套用結果到 #ch-narrative-intro 與 narrative-choices-list
}
```

#### 2.5.3 章末結果敘事

```javascript
async function aiGenerateOutcomeNarrative(outcomeCode) {
  const outcome = currentChapter.outcomes.find(o => o.outcome_code === outcomeCode);
  if (!outcome) return;

  const userPrompt = `請為以下章節結果撰寫結算敘事。

戰役:${currentCampaign.name_zh}
章節:${currentChapter.name_zh}
結果代碼:${outcomeCode}
結果含義(依代碼慣例):
  A = 完美成功(目標達成、議案未推進、關鍵旗標保留)
  B = 帶代價的成功(目標達成但付出代價)
  C = 失敗(目標未達成,議案推進)
  D = 災難級失敗
  E = 隱藏路線/特殊結果

判定條件摘要:${JSON.stringify(outcome.condition_expression)}
下一章指向:${outcome.next_chapter_version || '(終局)'}

要求:
1. 結算敘事 100–200 字,帶來情緒衝擊
2. 與結果含義的基調一致
3. 暗示但不明示後續章節的變化

僅回傳繁體中文敘事文字,不需要 JSON 包裹。`;

  // ...套用到對應結果槽的 narrative_text 欄位
}
```

#### 2.5.4 間章事件敘事

```javascript
async function aiGenerateInterludeNarrative() {
  const chapterId = document.getElementById('iv-chapter').value;
  const insertionPoint = document.getElementById('iv-insertion-point').value;
  const chapter = currentCampaign.chapters.find(ch => ch.id === chapterId);

  const operations = collectInterludeOperations();
  const condition = collectInterludeCondition();

  const userPrompt = `請為以下間章事件撰寫敘事。

戰役:${currentCampaign.name_zh}
章節:第 ${chapter.chapter_number} 章 ${chapter.name_zh}
插入點:${insertionPoint === 'prologue' ? '章首(長休息後)' : '章末(關卡結束後)'}
觸發條件:${condition ? JSON.stringify(condition) : '無條件觸發'}
執行操作:${JSON.stringify(operations)}

要求:
1. 敘事文字 150–300 字,銜接前後章節
2. 章首適合探索、整備、情報收集;章末適合結算、反思、預示
3. 若有選擇操作,敘事結尾給出明確的分岔口
4. 同時產出英文翻譯

回應格式(嚴格 JSON):
{
  "narrative_zh": "中文敘事…",
  "narrative_en": "English narrative…"
}`;
  // ... 套用到 #iv-narrative-zh / #iv-narrative-en
}
```

#### 2.5.5 旗標描述

```javascript
async function aiGenerateFlagDescription() {
  const code = document.getElementById('flag-dlg-prefix').textContent
             + document.getElementById('flag-dlg-suffix').value;
  const category = document.getElementById('flag-dlg-category').value;
  const chapter = document.getElementById('flag-dlg-chapter').value;

  const userPrompt = `請為以下旗標撰寫一句中文描述(15–40 字)。

旗標代碼:${code}
類別:${category}
所屬章節:${chapter || '戰役全域'}

要求:
1. 描述該旗標所記錄的遊戲狀態
2. 使用設計師視角語氣(不是旁白)
3. 僅回傳描述文字,不加任何額外包裝`;

  // ...套用到 #flag-dlg-desc
}
```

#### 2.5.6 中譯英通用

```javascript
async function aiTranslate(sourceElId, targetElId) {
  const sourceText = document.getElementById(sourceElId).value;
  if (!sourceText.trim()) {
    showToast('請先填寫中文內容', 'warn');
    return;
  }

  const userPrompt = `請將以下繁體中文翻譯為英文。

原文:
${sourceText}

要求:
1. 採用克蘇魯神話作品的英文慣例(Lovecraftian 風格)
2. 專有名詞使用英文原名(Cthulhu, Nyarlathotep, Innsmouth, Dunwich, Arkham)
3. 保持原文段落結構與情感基調
4. 僅回傳英文翻譯,不加說明`;

  const response = await callGemini(CTHULHU_SYSTEM_BASE, userPrompt);
  document.getElementById(targetElId).value = response.trim();
  markDirty();
}
```

### 2.6 JSON 擷取 helper

AI 回應有時會被 Markdown code fence 包裹(` ```json ... ``` `),需要清洗:

```javascript
function extractJson(text) {
  // 去除 ```json / ``` 標記
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();

  // 嘗試解析
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 嘗試找出 { ... } 區塊
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        throw new Error('AI 回應無法解析為 JSON:' + cleaned.substring(0, 100));
      }
    }
    throw new Error('AI 回應不含 JSON');
  }
}
```

---

## 三、完整性檢查分頁(`#tab-completeness`)

### 3.1 分頁結構

```html
<section id="tab-completeness" class="tab-content">
  <div class="completeness-layout">
    <!-- 頂部總摘要 -->
    <div class="completeness-summary">
      <div id="overall-status" class="overall-status">
        <h3>戰役發佈狀態</h3>
        <div id="overall-badge"></div>
        <p id="overall-message"></p>
      </div>
    </div>

    <!-- 檢查類別 -->
    <div class="checks-container">
      <section class="check-section">
        <h3>戰役層級</h3>
        <ul id="checks-campaign"></ul>
      </section>

      <section class="check-section">
        <h3>章節層級</h3>
        <div id="checks-chapters"></div>
      </section>

      <section class="check-section">
        <h3>結構完整性</h3>
        <ul id="checks-structure"></ul>
      </section>

      <section class="check-section">
        <h3>旗標字典完整性</h3>
        <ul id="checks-flags"></ul>
      </section>
    </div>

    <div class="completeness-footer">
      <button onclick="runCompletenessCheck()">重新檢查</button>
    </div>
  </div>
</section>
```

### 3.2 檢查演算法

```javascript
function runCompletenessCheck() {
  if (!currentCampaign) return;

  const report = {
    campaign: checkCampaignLevel(),
    chapters: checkAllChapters(),
    structure: checkStructuralIntegrity(),
    flags: checkFlagsIntegrity()
  };

  renderCompletenessReport(report);
}

function checkCampaignLevel() {
  const checks = [];
  checks.push({
    pass: !!currentCampaign.name_zh && currentCampaign.name_zh.length > 0,
    label: '中文名稱已填寫'
  });
  checks.push({
    pass: !!currentCampaign.cover_narrative && currentCampaign.cover_narrative.length > 50,
    label: '封面敘事已撰寫(至少 50 字)'
  });
  checks.push({
    pass: checkInitialChaosBag(currentCampaign.initial_chaos_bag),
    label: '起始混沌袋配置完整(符合難度配置)'
  });
  checks.push({
    pass: currentCampaign.chapters?.length === 10,
    label: '十章骨架齊備'
  });
  return checks;
}

function checkAllChapters() {
  return currentCampaign.chapters.map(ch => {
    const checks = [];
    checks.push({ pass: !!ch.name_zh, label: '章節名稱' });
    checks.push({ pass: !!ch.narrative_intro && ch.narrative_intro.length > 30, label: '劇情演示' });
    checks.push({
      pass: (ch.narrative_choices?.length || 0) >= 1,
      label: '至少 1 個劇情選項'
    });
    checks.push({
      pass: (ch.stage_count || 0) >= 1,
      label: '至少掛載 1 個關卡(MOD-07)'
    });
    checks.push({
      pass: (ch.outcomes?.length || 0) >= 2,
      label: '至少 2 種結果分支'
    });
    checks.push({
      pass: ch.outcomes?.every(o => o.narrative_text && o.narrative_text.length > 10),
      label: '每個結果分支有敘事'
    });

    // 第十章為終局,next_chapter_version 必須全為 null
    if (ch.chapter_number === 10) {
      checks.push({
        pass: ch.outcomes?.every(o => o.next_chapter_version === null),
        label: '終局章節不指向下一章'
      });
    } else {
      checks.push({
        pass: ch.outcomes?.every(o => o.next_chapter_version !== null),
        label: '非終局章節每個結果都有下一章指向'
      });
    }

    return {
      chapter: ch,
      checks,
      overallPass: checks.every(c => c.pass)
    };
  });
}

function checkStructuralIntegrity() {
  const checks = [];

  // 檢查章與章之間的指向不斷裂
  let brokenLinks = [];
  for (const ch of currentCampaign.chapters) {
    if (ch.chapter_number === 10) continue;
    const nextCh = currentCampaign.chapters.find(c => c.chapter_number === ch.chapter_number + 1);
    for (const outcome of (ch.outcomes || [])) {
      if (outcome.next_chapter_version && !nextCh) {
        brokenLinks.push(`第 ${ch.chapter_number} 章結果 ${outcome.outcome_code}`);
      }
    }
  }
  checks.push({
    pass: brokenLinks.length === 0,
    label: '章節結果指向無斷裂',
    details: brokenLinks.length > 0 ? `問題項:${brokenLinks.join(', ')}` : null
  });

  return checks;
}

function checkFlagsIntegrity() {
  const checks = [];

  // 遍歷所有結果分支與間章事件,收集引用的旗標代碼
  const referenced = new Set();
  for (const ch of currentCampaign.chapters) {
    for (const o of (ch.outcomes || [])) {
      collectReferencedFlags(o.condition_expression, referenced);
      (o.flag_sets || []).forEach(f => {
        const code = typeof f === 'string' ? f : f.flag_code;
        if (code) referenced.add(code);
      });
    }
  }

  const defined = new Set(currentFlags.map(f => f.flag_code));

  // 孤立旗標:定義但未被引用
  const orphaned = [...defined].filter(code => !referenced.has(code));
  checks.push({
    pass: orphaned.length === 0,
    label: '無孤立旗標(被定義但未被引用)',
    details: orphaned.length > 0 ? `孤立旗標:${orphaned.slice(0, 5).join(', ')}${orphaned.length > 5 ? '…' : ''}` : null
  });

  // 懸空引用:引用但未定義
  const dangling = [...referenced].filter(code => !defined.has(code));
  checks.push({
    pass: dangling.length === 0,
    label: '無懸空引用(被引用但未定義)',
    details: dangling.length > 0 ? `懸空引用:${dangling.slice(0, 5).join(', ')}${dangling.length > 5 ? '…' : ''}` : null
  });

  return checks;
}
```

### 3.3 渲染檢查報告

```javascript
function renderCompletenessReport(report) {
  // 總體狀態
  const allPass = [
    ...report.campaign,
    ...report.chapters.flatMap(c => c.checks),
    ...report.structure,
    ...report.flags
  ].every(c => c.pass);

  const badge = document.getElementById('overall-badge');
  const message = document.getElementById('overall-message');
  if (allPass) {
    badge.innerHTML = '<span class="status-ok">✓ 可發佈</span>';
    message.textContent = '所有檢查通過,戰役可以設為「已發佈」狀態。';
  } else {
    badge.innerHTML = '<span class="status-fail">✗ 尚未就緒</span>';
    message.textContent = '以下項目未通過檢查,請先修正。';
  }

  // 戰役層級
  renderCheckList('checks-campaign', report.campaign);

  // 章節層級(每章一張摺疊卡)
  const chaptersContainer = document.getElementById('checks-chapters');
  chaptersContainer.innerHTML = report.chapters.map(item => `
    <details ${item.overallPass ? '' : 'open'}>
      <summary>
        <span class="status-${item.overallPass ? 'ok' : 'fail'}">${item.overallPass ? '✓' : '✗'}</span>
        第 ${item.chapter.chapter_number} 章 — ${escapeHtml(item.chapter.name_zh || item.chapter.chapter_code)}
      </summary>
      <ul>
        ${item.checks.map(c => `
          <li class="${c.pass ? 'pass' : 'fail'}">
            <span class="indicator">${c.pass ? '✓' : '✗'}</span>
            ${escapeHtml(c.label)}
            ${c.details ? `<div class="detail">${escapeHtml(c.details)}</div>` : ''}
          </li>
        `).join('')}
      </ul>
    </details>
  `).join('');

  renderCheckList('checks-structure', report.structure);
  renderCheckList('checks-flags', report.flags);
}

function renderCheckList(containerId, checks) {
  const container = document.getElementById(containerId);
  container.innerHTML = checks.map(c => `
    <li class="${c.pass ? 'pass' : 'fail'}">
      <span class="indicator">${c.pass ? '✓' : '✗'}</span>
      ${escapeHtml(c.label)}
      ${c.details ? `<div class="detail">${escapeHtml(c.details)}</div>` : ''}
    </li>
  `).join('');
}
```

---

## 四、種子資料:示範戰役「印斯茅斯陰影」

### 4.1 種子策略

種子資料以 JSON 形式存放,後端在 `runMigration017` 的尾部**條件式插入**(若 `campaigns` 表為空才插入)。避免覆蓋使用者已建立的戰役。

### 4.2 種子檔案位置

建立新檔:`packages/server/src/db/seeds/mod06-campaigns.json`

### 4.3 種子資料內容

```json
{
  "campaign": {
    "code": "innsmouth_shadow",
    "name_zh": "印斯茅斯陰影",
    "name_en": "The Shadow Over Innsmouth",
    "theme": "印斯茅斯、深潛者、克蘇魯眷族",
    "cover_narrative": "你收到一封舊識的信,來自麻州海岸的一個小鎮——印斯茅斯。信紙上有海水的鹹味,字跡顫抖:「求你,來這裡找我。那些人……不是人。他們的眼睛……」\n\n舊識署名的下方,有一行被墨水劃掉的字,但你仍能辨認出:「深潛者」。\n\n火車站的列車員提醒你,印斯茅斯這種地方,去了就未必能回來。你摸了摸口袋裡的手槍,只剩六發子彈。\n\n迷霧已經從海上爬了上來。你要走進去嗎?",
    "difficulty_tier": "standard",
    "initial_chaos_bag": {
      "number_markers": { "+1": 1, "0": 2, "-1": 2, "-2": 2 },
      "scenario_markers": {
        "skull": { "count": 2, "effect": "blood_sacrifice", "value": -1 },
        "cultist": { "count": 1, "effect": "follower_response", "value": -2 },
        "tablet": { "count": 1, "effect": "forbidden_knowledge", "value": -2 },
        "elder_thing": { "count": 1, "effect": "otherworldly_seep", "value": -3 }
      },
      "mythos_markers": {
        "clue": { "count": 1, "value": -1 },
        "headline": { "count": 1, "value": -1 },
        "monster": { "count": 1, "value": -2 },
        "doom": { "count": 1, "value": -3 }
      },
      "extreme_markers": { "tentacle": 1, "elder_sign": 1 },
      "dynamic_markers": { "bless": 0, "curse": 0 }
    }
  },

  "chapter_1_full": {
    "chapter_number": 1,
    "chapter_code": "ch1",
    "name_zh": "抵達印斯茅斯",
    "name_en": "Arrival at Innsmouth",
    "narrative_intro": "巴士在泥濘的路上顛簸了兩個小時。司機告訴你,這是今天唯一一班進鎮的車,也是明天唯一一班出鎮的車。巴士站是一間塗漆剝落的小屋,鎮上的空氣帶著魚腥味與你無法形容的甜膩。\n\n街上的人們遠遠盯著你,他們的脖子有奇怪的皮褶。一個雜貨店老闆壓低聲音說:「Gilman House Hotel,今晚別住那裡。」但他沒說要住哪裡,也沒說為什麼。\n\n你有三件事可做:找旅館、打聽那封信、或者,趁天還沒黑,先去警察局。",
    "narrative_choices": [
      {
        "id": "choice_1",
        "text_zh": "立刻去找旅館安頓",
        "text_en": "Find lodging immediately",
        "effect": {
          "set_flags": [{ "flag_code": "choice.ch1_went_to_hotel", "value": true }]
        }
      },
      {
        "id": "choice_2",
        "text_zh": "先向路人打聽舊識的下落",
        "text_en": "Ask locals about your contact",
        "effect": {
          "set_flags": [{ "flag_code": "choice.ch1_asked_locals", "value": true }]
        }
      },
      {
        "id": "choice_3",
        "text_zh": "直奔警察局報告",
        "text_en": "Go straight to the police station",
        "effect": {
          "set_flags": [{ "flag_code": "choice.ch1_went_to_police", "value": true }]
        }
      }
    ],
    "design_status": "published"
  },

  "chapter_1_outcomes": [
    {
      "outcome_code": "A",
      "condition_expression": {
        "type": "and",
        "conditions": [
          { "type": "flag_set", "flag_code": "npc.ch1_contact_alive" },
          { "type": "agenda_progress_gte", "value": 1 }
        ]
      },
      "narrative_text": "你找到了舊識。他的手在顫抖,眼神望向窗外的海。「他們今晚就要來了。」他塞給你一把鑰匙:「這個鎮的真相藏在 Marsh 家族的地下室。你必須——」話還沒說完,窗外傳來一陣腥臭的風。",
      "next_chapter_version": "ch2_contact_alive",
      "flag_sets": [{ "flag_code": "npc.ch1_contact_alive", "value": true }],
      "chaos_bag_changes": [],
      "rewards": { "xp": 2, "talent_point": 1 }
    },
    {
      "outcome_code": "C",
      "condition_expression": {
        "type": "agenda_progress_gte", "value": 3
      },
      "narrative_text": "你在 Gilman House Hotel 的一樓大廳找到了他——只剩下半個身體。牆上用他自己的血寫著四個字:「他們來了。」你必須盡快離開這個房間,因為外面的走廊,已經有濕漉漉的腳步聲。",
      "next_chapter_version": "ch2_contact_dead",
      "flag_sets": [{ "flag_code": "npc.ch1_contact_dead", "value": true }],
      "chaos_bag_changes": [
        { "op": "add", "marker": "skull", "count": 1 },
        { "op": "add", "marker": "elder_thing", "count": 1 }
      ],
      "rewards": { "xp": 1 }
    }
  ],

  "chapter_1_flags": [
    {
      "flag_code": "choice.ch1_went_to_hotel",
      "category": "choice",
      "description_zh": "調查員選擇先找旅館安頓",
      "visibility": "visible",
      "chapter_code": "ch1"
    },
    {
      "flag_code": "choice.ch1_asked_locals",
      "category": "choice",
      "description_zh": "調查員選擇先向路人打聽",
      "visibility": "visible",
      "chapter_code": "ch1"
    },
    {
      "flag_code": "choice.ch1_went_to_police",
      "category": "choice",
      "description_zh": "調查員選擇直奔警察局",
      "visibility": "visible",
      "chapter_code": "ch1"
    },
    {
      "flag_code": "npc.ch1_contact_alive",
      "category": "npc",
      "description_zh": "舊識 Robert Olmstead 在第一章結束時仍存活",
      "visibility": "visible",
      "chapter_code": "ch1"
    },
    {
      "flag_code": "npc.ch1_contact_dead",
      "category": "npc",
      "description_zh": "舊識 Robert Olmstead 在第一章結束時死亡",
      "visibility": "visible",
      "chapter_code": "ch1"
    },
    {
      "flag_code": "item.ch1_marsh_key",
      "category": "item",
      "description_zh": "取得 Marsh 家族地下室鑰匙",
      "visibility": "visible",
      "chapter_code": "ch1"
    },
    {
      "flag_code": "hidden.ch1_cult_alerted",
      "category": "hidden",
      "description_zh": "邪教徒察覺調查員抵達,提升敵人階段強度",
      "visibility": "hidden",
      "chapter_code": "ch1"
    }
  ],

  "chapter_1_interludes": [
    {
      "event_code": "ch1_prologue_arrival",
      "name_zh": "深夜的敲門聲",
      "name_en": "Knocking at Midnight",
      "insertion_point": "prologue",
      "trigger_condition": null,
      "operations": [
        {
          "type": "trigger_test",
          "params": {
            "attribute": "perception",
            "dc": 4,
            "on_success": {
              "rewards": { "xp": 1 },
              "set_flags": [{ "flag_code": "hidden.ch1_cult_alerted", "value": false }]
            },
            "on_fail": {
              "penalty": { "san_damage": 1 },
              "set_flags": [{ "flag_code": "hidden.ch1_cult_alerted", "value": true }]
            }
          }
        }
      ],
      "narrative_text_zh": "凌晨三點,有人在敲你的房門。不是禮貌性的敲門,是急促的、指節摳門板的那種。門縫下滲進來一道微弱的光——走廊的燈被關掉了。\n\n你聽見自己的呼吸聲,也聽見門外有第二個人的呼吸聲。\n\n你屏住氣,試著從貓眼看出去。",
      "narrative_text_en": "At 3 AM, someone is knocking at your door...",
      "choices": []
    }
  ],

  "chapter_2_full": {
    "chapter_number": 2,
    "chapter_code": "ch2",
    "name_zh": "Marsh 家族的秘密",
    "name_en": "Secrets of the Marsh Family",
    "narrative_intro": "(範例省略,實際種子檔案要填入 200–400 字完整內容)",
    "narrative_choices": [
      { "id": "choice_1", "text_zh": "…", "effect": {} }
    ],
    "design_status": "published"
  },

  "chapter_2_outcomes": [
    {
      "outcome_code": "A",
      "condition_expression": { "type": "flag_set", "flag_code": "item.ch2_tome_obtained" },
      "narrative_text": "(第二章 A 結果敘事)",
      "next_chapter_version": "ch3_standard",
      "flag_sets": [{ "flag_code": "item.ch2_tome_obtained", "value": true }],
      "chaos_bag_changes": [{ "op": "add", "marker": "tablet", "count": 1 }],
      "rewards": { "xp": 2 }
    },
    {
      "outcome_code": "B",
      "condition_expression": { "type": "agenda_progress_gte", "value": 2 },
      "narrative_text": "(第二章 B 結果敘事)",
      "next_chapter_version": "ch3_standard",
      "flag_sets": [],
      "chaos_bag_changes": [{ "op": "add", "marker": "skull", "count": 1 }],
      "rewards": { "xp": 1 }
    }
  ]
}
```

> **註**:本指令文件僅列出結構與代表性內容。Claude Code 實作時,第二章的完整敘事與剩餘八章的骨架(chapter_3 到 chapter_10 僅需 `chapter_number`、`chapter_code`、`name_zh`,其他欄位為空)在實際種子 JSON 檔中補齊。

### 4.4 種子插入邏輯

在 `migrate.ts` 的 `runMigration017` 尾部加入:

```typescript
async function seedInnsmouthCampaign(client: PoolClient) {
  // 檢查是否已有戰役
  const existing = await client.query('SELECT COUNT(*) FROM campaigns');
  if (parseInt(existing.rows[0].count) > 0) return;

  const seedPath = path.join(__dirname, 'seeds/mod06-campaigns.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

  // 插入 campaigns
  const campaignResult = await client.query(`
    INSERT INTO campaigns (code, name_zh, name_en, theme, cover_narrative,
                           difficulty_tier, initial_chaos_bag, design_status)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'published')
    RETURNING id
  `, [
    seed.campaign.code, seed.campaign.name_zh, seed.campaign.name_en,
    seed.campaign.theme, seed.campaign.cover_narrative,
    seed.campaign.difficulty_tier, JSON.stringify(seed.campaign.initial_chaos_bag)
  ]);
  const campaignId = campaignResult.rows[0].id;

  // 插入十章(第 1–2 章完整,第 3–10 章僅骨架)
  const chapterIds = {};
  for (let i = 1; i <= 10; i++) {
    const chKey = `chapter_${i}_full`;
    const chData = seed[chKey] || {
      chapter_number: i, chapter_code: `ch${i}`,
      name_zh: `第 ${chineseDigit(i)} 章(待設計)`, name_en: '',
      narrative_intro: '', narrative_choices: [], design_status: 'draft'
    };

    const chResult = await client.query(`
      INSERT INTO chapters (campaign_id, chapter_number, chapter_code, name_zh, name_en,
                            narrative_intro, narrative_choices, design_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      RETURNING id
    `, [
      campaignId, chData.chapter_number, chData.chapter_code,
      chData.name_zh, chData.name_en,
      chData.narrative_intro, JSON.stringify(chData.narrative_choices || []),
      chData.design_status
    ]);
    chapterIds[chData.chapter_code] = chResult.rows[0].id;
  }

  // 插入旗標字典(包含第 1–2 章的旗標)
  const allFlags = [...(seed.chapter_1_flags || []), ...(seed.chapter_2_flags || [])];
  for (const flag of allFlags) {
    await client.query(`
      INSERT INTO campaign_flags (campaign_id, flag_code, category,
                                  description_zh, visibility, chapter_code)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [campaignId, flag.flag_code, flag.category, flag.description_zh,
        flag.visibility, flag.chapter_code]);
  }

  // 插入第 1–2 章結果分支
  for (const [chCode, outcomes] of [['ch1', seed.chapter_1_outcomes || []],
                                     ['ch2', seed.chapter_2_outcomes || []]]) {
    for (const o of outcomes) {
      await client.query(`
        INSERT INTO chapter_outcomes (chapter_id, outcome_code, condition_expression,
                                      narrative_text, next_chapter_version,
                                      chaos_bag_changes, rewards, flag_sets)
        VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
      `, [
        chapterIds[chCode], o.outcome_code,
        JSON.stringify(o.condition_expression),
        o.narrative_text, o.next_chapter_version,
        JSON.stringify(o.chaos_bag_changes || []),
        JSON.stringify(o.rewards || {}),
        JSON.stringify(o.flag_sets || [])
      ]);
    }
  }

  // 插入間章事件
  for (const event of (seed.chapter_1_interludes || [])) {
    await client.query(`
      INSERT INTO interlude_events (chapter_id, event_code, name_zh, name_en,
                                    insertion_point, trigger_condition, operations,
                                    narrative_text_zh, narrative_text_en, choices)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb)
    `, [
      chapterIds['ch1'], event.event_code, event.name_zh, event.name_en,
      event.insertion_point,
      event.trigger_condition ? JSON.stringify(event.trigger_condition) : null,
      JSON.stringify(event.operations || []),
      event.narrative_text_zh, event.narrative_text_en,
      JSON.stringify(event.choices || [])
    ]);
  }

  console.log('[MOD-06 seed] 示範戰役「印斯茅斯陰影」已建立');
}

function chineseDigit(n: number): string {
  return ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][n];
}
```

在 `runMigration017` 最末呼叫 `await seedInnsmouthCampaign(client)`。

---

## 五、匯出/匯入功能

### 5.1 匯出戰役

```javascript
async function exportCampaignJSON() {
  if (!currentCampaign) return;

  // 呼叫後端產出完整戰役 JSON
  const res = await adminFetch(`/api/campaigns/${currentCampaign.id}/export`);
  const data = await res.json();

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `campaign_${currentCampaign.code}_v${currentCampaign.version}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
```

### 5.2 後端匯出端點

在 `campaigns.ts` 加:

```typescript
app.get('/api/campaigns/:id/export', async (req, reply) => {
  const { id } = req.params as { id: string };
  const client = await pool.connect();
  try {
    const campaign = await client.query('SELECT * FROM campaigns WHERE id = $1', [id]);
    if (campaign.rowCount === 0) return reply.status(404).send({ error: '戰役不存在' });

    const chapters = await client.query(
      'SELECT * FROM chapters WHERE campaign_id = $1 ORDER BY chapter_number', [id]
    );
    const chapterIds = chapters.rows.map(c => c.id);

    const outcomes = await client.query(
      'SELECT * FROM chapter_outcomes WHERE chapter_id = ANY($1) ORDER BY chapter_id, outcome_code',
      [chapterIds]
    );
    const flags = await client.query(
      'SELECT * FROM campaign_flags WHERE campaign_id = $1 ORDER BY flag_code', [id]
    );
    const interludes = await client.query(
      'SELECT * FROM interlude_events WHERE chapter_id = ANY($1) ORDER BY chapter_id, insertion_point',
      [chapterIds]
    );

    reply.header('Content-Disposition',
      `attachment; filename="campaign_${campaign.rows[0].code}.json"`);
    return {
      format_version: '1.0',
      exported_at: new Date().toISOString(),
      campaign: campaign.rows[0],
      chapters: chapters.rows,
      outcomes: outcomes.rows,
      flags: flags.rows,
      interludes: interludes.rows
    };
  } finally {
    client.release();
  }
});
```

### 5.3 匯入戰役

```javascript
async function importCampaignJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const text = await file.text();
  const data = JSON.parse(text);

  if (!confirm(`將匯入戰役「${data.campaign.name_zh}」(代碼 ${data.campaign.code})。若代碼已存在將覆蓋,確定繼續?`)) {
    return;
  }

  const res = await adminFetch('/api/campaigns/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json();
    alert('匯入失敗:' + err.error);
    return;
  }

  await loadCampaignList();
  showToast('戰役已匯入', 'success');
}
```

### 5.4 後端匯入端點

處理邏輯:
1. 若 `code` 已存在 → 先 DELETE(CASCADE 自動清空子表)
2. 以相同流程插入戰役、章節、旗標、結果、間章事件
3. 全程在單一交易內完成

```typescript
app.post('/api/campaigns/import', async (req, reply) => {
  const data = req.body as any;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 刪除舊資料(若存在)
    await client.query('DELETE FROM campaigns WHERE code = $1', [data.campaign.code]);

    // 插入戰役(重用建立邏輯,但不自動建章)
    // 然後插入章節、旗標、結果、間章事件
    // ...

    await client.query('COMMIT');
    reply.send({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    reply.status(500).send({ error: '匯入失敗:' + (e as Error).message });
  } finally {
    client.release();
  }
});
```

---

## 六、最終文件更新

### 6.1 更新 `檔案索引_v01_26041801.md`

找到 §6 MOD-06 戰役敘事,改寫整段:

```markdown
## §6 MOD-06 戰役敘事設計器

### 前端 `packages/client/public/admin/admin-campaign.html`
**戰役列表與總覽**
- `loadCampaignList()` / `renderCampaignList()` / `selectCampaign(id)`
- `openCreateCampaignDialog()` / `confirmCreateCampaign()`
- `saveCampaign()` / `renderOverviewTab()`
- `renderChaosBagEditor(bag)` / `collectChaosBagFromForm()` / `applyDifficultyPreset(preset)`

**章節編輯**
- `selectChapter(id)` / `renderChapterEditor()` / `saveChapter()`
- `renderOutcomeSlots()` / `toggleOutcome(code, enabled)` / `collectOutcomesFromForm()`

**旗標字典**
- `loadFlags()` / `renderFlagsList()` / `saveFlag()` / `deleteFlag(id)`
- `renderFlagMultiSelect(selected)` / `openFlagPicker(btn)`

**間章事件**
- `loadAllInterludes()` / `renderInterludesGrouped()` / `selectInterlude(id)`
- `saveInterludeEvent()` / `deleteInterludeEvent()`
- `collectInterludeOperations()` / `collectInterludeChoices()`

**混沌袋演變**
- `renderEvolutionMatrix()` / `runSimulation()` / `applyAllChanges(bag, path)`

**條件表達式編輯器**
- `renderConditionExpressionHTML(expr, depth)` / `collectConditionExpression(el)`

**完整性檢查**
- `runCompletenessCheck()` / `checkCampaignLevel()` / `checkAllChapters()`

**AI 整合**
- `callGemini(systemPrompt, userPrompt)` / `extractJson(text)`
- `aiGenerateCoverNarrative()` / `aiGenerateNarrativeIntro()` / `aiGenerateOutcomeNarrative(code)`
- `aiGenerateInterludeNarrative()` / `aiGenerateFlagDescription()` / `aiTranslate(src, tgt)`

**匯出匯入**
- `exportCampaignJSON()` / `importCampaignJSON(event)`

### 後端 `packages/server/src/routes/campaigns.ts`
- 戰役 CRUD:`GET/POST/PUT/DELETE /api/campaigns[/:id]`
- 章節:`GET /api/campaigns/:id/chapters` / `GET/PUT /api/chapters/:id`
- 結果分支:`GET/POST /api/chapters/:chapterId/outcomes` / `PUT/DELETE /api/outcomes/:id`
- 旗標:`GET /api/campaigns/:id/flags` / `GET/POST/PUT/DELETE /api/flags/:id`
- 間章事件:`GET/POST /api/chapters/:chapterId/interlude-events` / `PUT/DELETE /api/interlude-events/:id`
- 匯出匯入:`GET /api/campaigns/:id/export` / `POST /api/campaigns/import`

### 後端 helper `packages/server/src/utils/campaign-validators.ts`
- `validateFlagCodes()` / `validateMonsterFamilyCodes()` / `validateMythosCardCodes()` / `validateTeamSpiritCodes()`
- `extractFlagCodesFromExpression()` / `extractReferencedCodes()`

### 資料庫(MIGRATION_017)
- `campaigns` / `chapters` / `chapter_outcomes` / `campaign_flags` / `interlude_events`

### 種子資料
- `packages/server/src/db/seeds/mod06-campaigns.json`
- 示範戰役「印斯茅斯陰影」:第 1–2 章完整,第 3–10 章骨架
```

### 6.2 同時更新 MOD → 檔案對應總表

將 MOD-06 的狀態從「尚未建置」改為「READY」。

### 6.3 更新檔案索引頂部日期碼

日期碼改為今日(`26041902` 或目前實作日期)。

---

## 七、驗收清單

完成本份後,以下應為 `true`:

- [ ] 頁面右上角顯示 API Key 指示器,點擊可設定
- [ ] 戰役總覽分頁「AI 生成封面敘事」按鈕可產出符合克蘇魯氛圍的敘事
- [ ] 章節編輯分頁各 AI 生成按鈕皆可運作
- [ ] 任何中文欄位旁的「中譯英」按鈕可產出英文翻譯
- [ ] 完整性檢查分頁顯示四大類檢查項目
- [ ] 示範戰役「印斯茅斯陰影」在首次啟動時自動載入
- [ ] 示範戰役的第 1 章完整,第 2 章有基本內容,第 3–10 章為骨架
- [ ] 匯出戰役產生 JSON 檔,格式符合 §5.2 結構
- [ ] 匯入 JSON 檔後戰役出現在列表中
- [ ] 檔案索引中 MOD-06 狀態顯示 READY

---

## 八、實作注意事項

1. **AI 生成的 JSON 解析要容錯**,模型偶爾會包 Markdown code fence
2. **所有 AI 呼叫失敗要有清晰錯誤訊息**,不可靜默失敗
3. **種子資料的第 2 章完整內容**(§4.3 僅示意)要在實作時補足
4. **完整性檢查是預警,不是硬阻擋**——即使檢查失敗,使用者仍可將 `design_status` 設為 `published`,但 UI 顯示警告
5. **匯出/匯入 JSON 格式要明確標註 `format_version`**,未來格式變動時可向後相容
6. **種子條件式插入**:只在 `campaigns` 表為空時才插入示範資料,避免覆蓋使用者資料

---

## 九、MOD-06 完成聲明

完成本份後,MOD-06 應達到以下狀態:

- 所有六個分頁可正常操作
- 後端 18 個端點全部可用
- AI 整合六個生成點 + 中譯英全部可用
- 示範戰役可供設計師參考
- 完整性檢查可預先發現設計問題
- 匯出/匯入支援戰役移植
- 檔案索引更新為 READY

---

## 十、後續工作

MOD-06 完成後,進入 MOD-07 關卡編輯器實作(共五份指令文件)。MOD-07 會引用 MOD-06 的章節下拉、旗標字典、戰役結構,因此 MOD-06 必須先穩定。
