# Claude Code 指令文件：MOD-11 調查員設計器（Part 2 / 3）
## Admin Module — Investigator Designer Build Instructions (Part 2 of 3)

> **模組代號：** MOD-11
> **本檔內容：** 設計器 UI 介面（三欄佈局、預設矩陣、ID 卡編輯、簽名卡/弱點編輯、起始牌組構築）
> **前置：** Part 1 的資料庫與 API 已完成
> **配套：** Part 3 將處理 Gemini AI 整合與總覽面板

---

## 零、頁面整體架構

### 0.1 檔案位置

```
admin/
├── mod-11-investigator-designer/
│   ├── index.html              # 主頁面
│   ├── investigator-designer.css  # 頁面特有樣式
│   ├── investigator-designer.js   # 頁面邏輯
│   └── components/
│       ├── preset-matrix.js    # 16×4 預設矩陣
│       ├── id-card-editor.js   # ID 卡編輯器
│       ├── signature-editor.js # 簽名卡設計器
│       ├── weakness-editor.js  # 個人弱點編輯器
│       └── deck-builder.js     # 起始牌組構築器
```

### 0.2 頁面佈局原則

本模組**沿用與 MOD-03、MOD-08、MOD-10 相同的三欄佈局**：

```
┌─────────────────────────────────────────────────────────────┐
│  頂部導航列（admin-shared 提供）                              │
├──────────┬──────────────────────────┬─────────────────────┤
│          │                          │                     │
│  左欄    │       中央欄              │      右欄           │
│          │                          │                     │
│ 模板選擇 │    分頁標籤頁內容         │   目前編輯的        │
│ 16×4 矩陣│  （依左欄選擇切換）       │   詳細區塊           │
│          │                          │                     │
│ 過濾器   │                          │                     │
│          │                          │                     │
└──────────┴──────────────────────────┴─────────────────────┘
```

**三欄寬度：** 左 20% / 中 45% / 右 35%

---

## 一、左欄：預設矩陣與導航

### 1.1 視覺設計

左欄分為兩個區塊：

**A. 過濾器區塊（頂部，固定高度約 120px）**
- 搜尋輸入框（搜尋姓名/稱號）
- 完成度過濾：`全部 / 已完成 / 未完成 / 骨架狀態`
- MBTI 群組過濾：`全部 / 分析家 / 外交家 / 守護者 / 探險家`
- 時代標籤過濾：可複選（自由文字標籤去重整理）

**B. 16×4 預設矩陣（可滾動，佔剩餘高度）**

矩陣是本模組最具辨識度的介面元素。以暗黑哥德風格呈現：

```
╔═══════════════════════════════════════╗
║  ANALYSTS（分析家）                    ║
║  ┌─────────────────────────────────┐  ║
║  │ INTJ   建築師                   │  ║
║  │ ┌────┬────┬────┬────┐          │  ║
║  │ │ 1-I│ 2-N│ 3-T│ 4-J│          │  ║
║  │ └────┴────┴────┴────┘          │  ║
║  └─────────────────────────────────┘  ║
║  ┌─────────────────────────────────┐  ║
║  │ INTP   邏輯學家                  │  ║
║  │ ┌────┬────┬────┬────┐          │  ║
║  │ │ 1-I│ 2-N│ 3-T│ 4-P│          │  ║
║  │ └────┴────┴────┴────┘          │  ║
║  └─────────────────────────────────┘  ║
║  ...                                  ║
╚═══════════════════════════════════════╝
```

**每個 4-格職業方塊的狀態呈現：**

| 狀態 | 視覺 |
|------|------|
| 骨架（未編輯） | 邊框虛線、背景色暗灰、顯示「尚未設計」 |
| 進行中 | 邊框實線、背景色陣營主色半透明、顯示職業名稱 + 部分填寫圖示 |
| 已完成 | 邊框實心金色、背景色陣營主色、顯示職業名稱 + 完成勾選圖示 |
| 目前選中 | 額外加上閃爍金色外框 |

**方塊內容：**
- 頂部：職業序號 + 偏重字母（如 "1-E"）
- 中央：職業名稱（若已填寫，否則顯示 dominant_letter 對應的陣營中文名）
- 底部：三色小點條（代表完成度：姓名、屬性、牌組）

### 1.2 陣營色彩使用

矩陣方塊的主色依 `dominant_letter` 取用 `admin-shared.js` 的 `FACTIONS[letter].color`：

| 字母 | 陣營 | 色碼 |
|------|------|------|
| E | 號令 | #C9A84C（琥珀金） |
| I | 深淵 | #3A5FA0（深靛藍） |
| S | 鐵證 | #8B5E3C（鏽銅） |
| N | 天啟 | #7B4EA3（紫羅蘭） |
| T | 解析 | #4A7C9B（冷鋼藍） |
| F | 聖燼 | #B84C4C（暖紅） |
| J | 鐵壁 | #6B6B6B（石墨灰） |
| P | 流影 | #2D8B6F（翠綠） |

### 1.3 矩陣的互動行為

- **單擊職業方塊**：在中央欄載入該模板，右欄預設顯示「基本資訊」區塊
- **右鍵方塊**：彈出脈絡選單（複製、清空、預覽完整 JSON）
- **雙擊 MBTI 標題**：摺疊/展開該 MBTI 的四個職業方塊
- **底部按鈕：「+ 新增自建模板」**（建立 `is_preset = FALSE` 的新模板）

### 1.4 過濾器邏輯範例

```javascript
// 過濾器狀態
const filterState = {
  searchText: '',
  completionFilter: 'all', // all | completed | in_progress | skeleton
  mbtiGroup: 'all',        // all | Analysts | Diplomats | Sentinels | Explorers
  eraTags: []
};

function applyFilter(templates) {
  return templates.filter(t => {
    // 搜尋
    if (filterState.searchText) {
      const q = filterState.searchText.toLowerCase();
      const matches = (t.name_zh || '').toLowerCase().includes(q) ||
                      (t.title_zh || '').toLowerCase().includes(q) ||
                      t.mbti_code.toLowerCase().includes(q);
      if (!matches) return false;
    }
    // 完成度
    if (filterState.completionFilter === 'completed' && !t.is_completed) return false;
    if (filterState.completionFilter === 'in_progress' &&
        (t.is_completed || !t.name_zh)) return false;
    if (filterState.completionFilter === 'skeleton' && t.name_zh) return false;
    // MBTI 群組
    if (filterState.mbtiGroup !== 'all') {
      const group = MBTI_TYPES[t.mbti_code]?.group;
      if (group !== filterState.mbtiGroup) return false;
    }
    // 時代標籤
    if (filterState.eraTags.length > 0) {
      const templateTags = (t.era_tags || '').split(',').map(s => s.trim());
      if (!filterState.eraTags.some(tag => templateTags.includes(tag))) return false;
    }
    return true;
  });
}
```

---

## 二、中央欄：分頁標籤頁

中央欄採用標籤頁切換，共 **5 個主要分頁**：

| 分頁 | 對應區塊 |
|------|---------|
| ① 基本資訊 | 姓名、稱號、頭像、MBTI、職業、時代標籤 |
| ② 屬性配點 | 七屬性分配（含基礎/自由/剩餘顯示） |
| ③ 戰鬥熟練 | 起始熟練選擇 + 偏重字母提示 |
| ④ 簽名卡與弱點 | 簽名卡 2–3 張 + 個人弱點 1 張（內建設計器） |
| ⑤ 起始牌組 | 牌組構築介面（15–20 張） |

每個分頁載入時，右欄會自動顯示該分頁對應的**詳細編輯區塊**。

### 2.1 分頁 ① 基本資訊

**欄位清單：**

```
┌── 基本資訊 ─────────────────────────────┐
│                                         │
│  姓名（中文）   [________________]       │
│  姓名（英文）   [________________]       │
│                                         │
│  稱號（中文）   [________________]       │
│  稱號（英文）   [________________]       │
│                                         │
│  頭像          [上傳圖片 | URL 輸入]    │
│                [預覽：圖片縮圖 150×150]  │
│                                         │
│  MBTI 四字碼    [ENTJ ▼]（預設模板不可改）│
│  職業序號      [2 ▼]（預設模板不可改）   │
│  偏重字母      [N（天啟）]（自動計算）   │
│                                         │
│  時代標籤      [自由輸入，逗號分隔]      │
│                例：1925, 紐約, 私家偵探  │
│                                         │
│  [✨ AI 生成敘事] （詳見 Part 3）        │
│  背景故事     [大文字框，支援 Markdown] │
│  能力文字     [文字框]                  │
│                                         │
└────────────────────────────────────────┘
```

**欄位約束：**
- 預設模板（`is_preset = TRUE`）的 `mbti_code`、`career_index`、`dominant_letter` 為唯讀
- 玩家自建模板的上述欄位可修改

### 2.2 分頁 ② 屬性配點

**核心設計：** 屬性配點介面必須**清楚呈現三段式結構**：基礎 7 點 + 陣營加成 6 點 + 自由 5 點 = 18 點。

**版面：**

```
┌── 屬性配點 ──────────────────────────────────────┐
│                                                  │
│  剩餘可分配：  [█████░░░░░] 5 / 5 點             │
│  已分配：     [█████████████] 13 / 18 點         │
│                                                  │
│  ┌──────────┬──────┬──────┬──────┬──────┬─────┐  │
│  │  屬性     │ 基礎 │ 陣營 │ 自由 │ 總計 │ 修正│  │
│  ├──────────┼──────┼──────┼──────┼──────┼─────┤  │
│  │  力量 STR│  +1  │  +0  │ [+0]│  1   │ +1  │  │
│  │  敏捷 AGI│  +1  │  +0  │ [+0]│  1   │ +1  │  │
│  │  體質 CON│  +1  │  +1  │ [+0]│  2   │ +2  │  │
│  │  智力 INT│  +1  │  +1  │ [+0]│  2   │ +2  │  │
│  │  意志 WIL│  +1  │  +1  │ [+0]│  2   │ +2  │  │
│  │  感知 PER│  +1  │  +0  │ [+0]│  1   │ +1  │  │
│  │  魅力 CHA│  +1  │  +3  │ [+0]│  4   │ +4  │  │
│  └──────────┴──────┴──────┴──────┴──────┴─────┘  │
│                                                  │
│  HP 上限：   9（體質 × 2 + 5）                   │
│  SAN 上限：  9（意志 × 2 + 5）                   │
│                                                  │
│  ⚠ 智力已達創角上限 5（INTJ 模板的數學後果）      │
│                                                  │
└─────────────────────────────────────────────────┘
```

**互動細節：**
- 「自由」欄位以 +/- 按鈕調整，每點 1 分
- 點到某屬性的自由欄若會讓總計超過 5（創角上限），按鈕變灰不可按
- 剩餘點數 = 0 時所有 + 按鈕變灰
- 自動計算並即時顯示 HP、SAN 上限
- 若有「已達上限」情況，在底部顯示提示

**陣營加成欄位說明：**
- 基礎 +1：七屬性皆有
- 陣營 +3：該模板的主陣營主屬性
- 陣營 +1（最多 +2）：副陣營的主屬性（若有共享如 INTJ 的智力會累加）

### 2.3 分頁 ③ 戰鬥熟練

**核心邏輯：** 戰鬥熟練依偏重字母（`dominant_letter`）自動推薦對應的熟練，但設計者可自由更改。

**支柱五 §4 陣營對應熟練：**

| 陣營 | 推薦起始熟練 |
|------|------------|
| E 號令 | 槍枝射擊（Shooting） |
| I 深淵 | 暗殺（Assassination） |
| S 鐵證 | 隨身武器（Sidearm） |
| N 天啟 | 施法（Arcane） |
| T 解析 | 工兵（Engineer） |
| F 聖燼 | 搏擊（Brawl） |
| J 鐵壁 | 軍用武器（Military） |
| P 流影 | 弓術（Archery） |

**版面：**

```
┌── 戰鬥熟練 ──────────────────────────────────┐
│                                              │
│  偏重字母推薦：N 天啟 → 施法（Arcane）       │
│  [套用推薦] 按鈕                              │
│                                              │
│  已選熟練（目前 1 個，建議 1–2 個）：         │
│                                              │
│  ┌─────────────────────────────────┐        │
│  │ ✓ 施法（Arcane）                │ [移除] │
│  │   屬性: 意志                    │        │
│  │   熟練加成: +1                  │        │
│  └─────────────────────────────────┘        │
│                                              │
│  從 MOD-05 熟練庫加入：                       │
│  ┌──────────────┐                            │
│  │ [選擇熟練 ▼] │  [加入]                    │
│  └──────────────┘                            │
│                                              │
└─────────────────────────────────────────────┘
```

**互動邏輯：**
- 下拉選單讀取 `proficiency_definitions` 表的所有項目
- 已選熟練不會出現在下拉選單中
- 建議 1–2 個熟練（超過 2 個顯示警告但不禁止）

### 2.4 分頁 ④ 簽名卡與弱點

**版面分為兩個子區塊：**

```
┌── 簽名卡 ────────────────────────────────────┐
│                                              │
│  目前 0 / 3 張（建議 2–3 張）                 │
│                                              │
│  ┌────────────────┐  ┌────────────────┐      │
│  │ [+ 新增簽名卡] │  │ [+ 新增簽名卡] │      │
│  │  第 1 槽       │  │  第 2 槽       │      │
│  └────────────────┘  └────────────────┘      │
│  ┌────────────────┐                          │
│  │ [+ 新增簽名卡] │                          │
│  │  第 3 槽       │                          │
│  └────────────────┘                          │
│                                              │
├── 個人弱點 ─────────────────────────────────┤
│                                              │
│  [+ 設計個人弱點]                             │
│  （尚未設計，玩家牌組必定包含 1 張弱點）       │
│                                              │
└─────────────────────────────────────────────┘
```

當設計者點擊「新增簽名卡」或「設計個人弱點」時，**右欄會載入對應的編輯器**（見第三章、第四章）。

### 2.5 分頁 ⑤ 起始牌組

這是本模組最複雜的介面，單獨在第五章詳述。

---

## 三、右欄：簽名卡設計器（內建）

### 3.1 設計原則

簽名卡設計器是**內建於 MOD-11 的微型卡片設計器**，其欄位結構與 MOD-01 卡片設計器的「資產/事件/盟友/技能」核心欄位一致，但：
- **不進入 MOD-01 卡池**（專屬於該調查員）
- **稀有度固定為 `signature`**（不顯示在稀有度下拉）
- **保存在 `investigator_signature_cards` 表**

### 3.2 版面設計

```
┌── 簽名卡設計器（第 1 槽） ──────────────────┐
│                                             │
│  ▼ 基本資訊                                  │
│    名稱（中）  [________________]           │
│    名稱（英）  [________________]           │
│    類型        [資產 ▼]                      │
│    風格        [A+H ▼]                       │
│    費用        [ 3 ]                         │
│                                             │
│  ▼ 三合一屬性                                │
│    加值圖示   [意志 ▼] × [1]                 │
│              [智力 ▼] × [1]                 │
│              [+ 新增加值]                    │
│    消費效果   [文字框]                       │
│                                             │
│  ▼ 打出效果                                  │
│    效果文字   [大文字框]                    │
│    ⚠ 效果代碼（結構化，預留給未來效果引擎）  │
│                                             │
│  ▼ 敘事                                      │
│    [✨ AI 生成傳敘] （詳見 Part 3）          │
│    傳敘文字   [文字框]                       │
│    插圖 URL  [________________]             │
│                                             │
│  [💾 儲存]  [🗑 刪除]  [預覽卡面]           │
│                                             │
└────────────────────────────────────────────┘
```

### 3.3 與起始牌組的聯動

簽名卡儲存後：
- 自動出現在分頁 ⑤ 起始牌組的「簽名卡」區塊
- 自動以 1 張納入起始牌組（設計者不可從牌組移除，但可刪除簽名卡本身）
- 刪除簽名卡時，同步清除起始牌組中的對應紀錄

### 3.4 驗證邏輯

- `card_order` 1–3，不可重複
- `cost` 0–6
- `commit_icons` 至少 0 個（可以是空陣列，代表無加值）
- 名稱非空
- 效果文字或消費效果至少填寫一項

---

## 四、右欄：個人弱點編輯器

### 4.1 版面設計

```
┌── 個人弱點 ───────────────────────────────┐
│                                           │
│  名稱（中）  [________________]           │
│  名稱（英）  [________________]           │
│                                           │
│  弱點類型    [性格缺陷 ▼]                  │
│              選項：                        │
│              · flaw        性格缺陷        │
│              · trauma      舊傷            │
│              · curse       詛咒            │
│              · obsession   執念            │
│              · debt        債務            │
│              · secret      秘密            │
│                                           │
│  觸發條件    [文字框]                      │
│              例：抽到此卡時                │
│                                           │
│  負面效果    [文字框]                      │
│              例：本回合損失 2 點 SAN      │
│                                           │
│  解除條件    [文字框，可留空]              │
│              例：花 3 XP 移除（留空=無法解除）│
│                                           │
│  ▼ 敘事                                    │
│    [✨ AI 生成背景]                         │
│    背景故事   [大文字框]                   │
│    傳敘       [文字框]                     │
│                                           │
│  [💾 儲存]  [🗑 刪除]                       │
│                                           │
└──────────────────────────────────────────┘
```

### 4.2 重要設計原則

- **每個調查員僅一張弱點**（DB 的 UNIQUE 約束）
- 儲存後自動加入起始牌組（數量 1，不可調整）
- 刪除弱點 = 該調查員模板會被標記為 `is_completed = FALSE`（不完整）

---

## 五、分頁 ⑤：起始牌組構築介面

### 5.1 設計定位

這是 MOD-11 的**核心構築介面**。採用**左中右三欄的內部子佈局**，讓設計者可以同時看到：

1. **可用卡池**（來自 MOD-01 卡片設計器的該調查員四字碼卡池）
2. **已選牌組**（15–20 張）
3. **牌組分析**（統計、費用曲線、類型分佈）

### 5.2 整體版面

```
┌── 起始牌組構築 ─────────────────────────────────────────────┐
│                                                             │
│  牌組大小: 16 / 15–20  [正常]  費用平均: 2.4                │
│                                                             │
│ ┌─────────────┬─────────────────────┬─────────────────────┐│
│ │ 可用卡池    │    已選牌組          │   牌組分析           ││
│ │             │                     │                     ││
│ │ 過濾器：    │ 【簽名卡 3 張】      │  費用曲線：          ││
│ │ 類型 [▼]   │ × 命運召喚 (簽)     │  ▁▄██▆▃▁           ││
│ │ 費用 [1-3]  │ × 老戰友 (簽)       │  0 1 2 3 4 5 6      ││
│ │ 陣營 [E,N]  │ × 最後彈藥 (簽)     │                     ││
│ │             │                     │  類型分佈：          ││
│ │ ┌─────────┐ │ 【弱點 1 張】        │  資產 ████████ 8    ││
│ │ │.45手槍  │ │ × 舊傷復發 (弱)     │  事件 ████ 4        ││
│ │ │   費2   │ │                     │  技能 ██ 2          ││
│ │ │ [+]     │ │ 【一般卡 12 張】     │  盟友 ██ 2          ││
│ │ └─────────┘ │ 2×.45 手槍 [-] [+]  │                     ││
│ │ ┌─────────┐ │ 1×急救包  [-] [+]   │  陣營分佈：          ││
│ │ │ 急救包  │ │ 3×線索研究 [-][+]   │  E 號令  ████ 4     ││
│ │ │   費1   │ │ ...                 │  N 天啟  ██ 2       ││
│ │ │ [+]     │ │                     │  T 解析  ██ 2       ││
│ │ └─────────┘ │                     │  J 鐵壁  ██ 2       ││
│ │ ...         │                     │  中立    ████ 4     ││
│ │             │                     │                     ││
│ │ [清除過濾]  │ [匯出 JSON]          │  ⚠ 建議: 增加       ││
│ │             │                     │     低費牌比例       ││
│ └─────────────┴─────────────────────┴─────────────────────┘│
│                                                             │
│  [💾 儲存牌組]  [🔄 重新載入]  [🎲 AI 推薦組合]               │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

### 5.3 可用卡池（子欄一）

**資料來源：** `/api/admin/investigators/:id/available-cards`

**過濾器：**
- 卡片類型（資產/事件/技能/盟友）
- 費用範圍（0–6）
- 陣營（該調查員的四字碼 + 中立；可多選）
- 稀有度（pocket/basic/standard/advanced/rare/legendary）
- 搜尋（姓名/標籤）

**每張卡片的呈現：**
- 卡片縮圖（來自 MOD-01 的插圖 URL）
- 名稱 + 費用 + 稀有度色標
- `[+]` 按鈕：加入牌組（預設數量 1）
- 懸停：顯示完整卡面預覽

### 5.4 已選牌組（子欄二）

分三個區塊顯示：
1. **簽名卡區塊**（自動填入該調查員的簽名卡，不可移除）
2. **弱點區塊**（自動填入個人弱點，不可移除）
3. **一般卡區塊**（從可用卡池加入的卡，可調整數量）

每張卡的呈現：
- 數量 × 卡名
- `[-]` 和 `[+]` 按鈕調整數量
- 數量歸零時自動移除

### 5.5 牌組分析（子欄三）

即時計算並顯示：

**費用曲線：** 橫軸 0–6，縱軸張數，用 ASCII 字元或簡單 SVG 柱狀圖呈現。

**類型分佈：** 資產/事件/技能/盟友各幾張。

**陣營分佈：** 四個主副陣營 + 中立各幾張。

**建議警告：**
- 總張數不在 15–20 → 紅色警告
- 費用平均 > 3.5 → 黃色提示「建議增加低費卡比例」
- 某類型超過 50% → 黃色提示「類型過於單一」
- 沒有任何盟友卡 → 藍色建議「可考慮加入一張盟友卡」

### 5.6 驗證邏輯（前端）

儲存前檢查：
```javascript
function validateDeck(deck, investigator) {
  const errors = [];
  const warnings = [];

  const totalCards = deck.reduce((sum, slot) => sum + slot.quantity, 0);

  // 錯誤（阻擋儲存）
  if (totalCards < 15) errors.push(`牌組張數過少（${totalCards} < 15）`);
  if (totalCards > 20) errors.push(`牌組張數過多（${totalCards} > 20）`);

  // 必備項目
  const sigCount = deck.filter(s => s.signature_card_id).length;
  if (sigCount < 2) errors.push(`至少需要 2 張簽名卡（目前 ${sigCount}）`);

  const hasWeakness = deck.some(s => s.weakness_id);
  if (!hasWeakness) errors.push('必須包含個人弱點');

  // 警告（僅提示，不阻擋）
  const avgCost = calculateAvgCost(deck);
  if (avgCost > 3.5) warnings.push(`費用平均偏高（${avgCost.toFixed(1)}）`);

  const typeDistribution = calculateTypeDistribution(deck);
  for (const [type, pct] of Object.entries(typeDistribution)) {
    if (pct > 0.5) warnings.push(`${type} 類型占比過高（${(pct * 100).toFixed(0)}%）`);
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
```

---

## 六、頂部狀態列與進度指示器

在中央欄頂部有一條**水平狀態列**，呈現當前模板的完成度：

```
╔═══════════════════════════════════════════════════════════╗
║ ENTJ-2 · 偏重 N · 狀態：進行中（4/9 必要欄位）             ║
║ ─────────────────────────────────────────────────────────║
║ ✓ 姓名   ✓ 稱號   ○ 背景   ✓ 屬性   ○ 熟練                ║
║ ○ 簽名卡  ○ 弱點   ○ 牌組   ○ 能力文字                    ║
╚═══════════════════════════════════════════════════════════╝
```

- 勾選（✓）：該欄位已填寫
- 空圈（○）：該欄位尚未填寫或不完整
- 點擊任一欄位名可快速跳轉到對應分頁

---

## 七、樣式規範（extends admin-shared.css）

本模組的特有樣式檔 `investigator-designer.css` 需包含：

### 7.1 預設矩陣

```css
.preset-matrix {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;
  padding: 1rem;
  overflow-y: auto;
}

.mbti-group-header {
  font-family: 'Cinzel', serif;
  color: #C9A84C;
  border-bottom: 1px solid #4a3a2a;
  padding-bottom: 0.25rem;
  margin-top: 1rem;
  font-size: 0.75rem;
  letter-spacing: 0.2em;
}

.mbti-card {
  background: #1a1410;
  border: 1px solid #3a2e20;
  border-radius: 4px;
  padding: 0.5rem;
}

.mbti-code-label {
  font-family: 'Cinzel', serif;
  color: #d4a574;
  font-size: 0.875rem;
}

.career-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.career-cell {
  aspect-ratio: 1 / 1;
  border: 1px dashed #4a3a2a;
  border-radius: 3px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.career-cell.in-progress {
  border-style: solid;
  border-color: var(--faction-color);
  background: color-mix(in srgb, var(--faction-color) 15%, transparent);
}

.career-cell.completed {
  border-color: #d4a574;
  background: color-mix(in srgb, var(--faction-color) 30%, transparent);
  box-shadow: 0 0 4px rgba(212, 165, 116, 0.4);
}

.career-cell.selected {
  box-shadow: 0 0 0 2px #d4a574, 0 0 12px rgba(212, 165, 116, 0.6);
}

.career-cell .letter-indicator {
  font-family: 'Cinzel', serif;
  font-weight: 700;
  color: var(--faction-color);
}

.career-cell .completion-dots {
  display: flex;
  gap: 2px;
  margin-top: 2px;
}

.career-cell .completion-dots .dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #3a2e20;
}

.career-cell .completion-dots .dot.filled {
  background: #d4a574;
}
```

### 7.2 屬性配點表格

```css
.attribute-table {
  width: 100%;
  border-collapse: collapse;
}

.attribute-table th,
.attribute-table td {
  padding: 0.5rem;
  text-align: center;
  border-bottom: 1px solid #3a2e20;
}

.attribute-table th {
  background: #1a1410;
  color: #d4a574;
  font-family: 'Cinzel', serif;
  font-size: 0.75rem;
  letter-spacing: 0.1em;
}

.attribute-table td.base-col { color: #888; }
.attribute-table td.faction-col { color: #B84C4C; font-weight: 600; }
.attribute-table td.free-col input {
  width: 3rem;
  text-align: center;
  background: #0f0b07;
  border: 1px solid #3a2e20;
  color: #d4a574;
  padding: 0.25rem;
}

.attribute-table td.total-col {
  font-weight: 700;
  color: #d4a574;
  font-size: 1.1rem;
}

.attribute-bar {
  height: 6px;
  background: #1a1410;
  border-radius: 3px;
  overflow: hidden;
  margin-top: 0.25rem;
}

.attribute-bar .fill {
  height: 100%;
  background: linear-gradient(90deg, #8b5e3c, #d4a574);
  transition: width 0.3s;
}

.attribute-cap-warning {
  color: #C9A84C;
  font-size: 0.75rem;
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: rgba(201, 168, 76, 0.1);
  border-left: 3px solid #C9A84C;
}
```

### 7.3 牌組構築介面

```css
.deck-builder {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1rem;
  height: calc(100vh - 300px);
}

.deck-builder-column {
  background: #15100c;
  border: 1px solid #3a2e20;
  border-radius: 4px;
  overflow-y: auto;
  padding: 0.75rem;
}

.card-pool-item {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  border: 1px solid #2a2016;
  border-radius: 3px;
  margin-bottom: 0.5rem;
  cursor: pointer;
  transition: border-color 0.2s;
}

.card-pool-item:hover {
  border-color: #d4a574;
}

.deck-slot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0.6rem;
  background: #0f0b07;
  border: 1px solid #2a2016;
  margin-bottom: 0.25rem;
  font-size: 0.875rem;
}

.deck-slot.signature {
  border-left: 3px solid #d4a574;
}

.deck-slot.weakness {
  border-left: 3px solid #B84C4C;
}

.deck-slot .qty-controls button {
  width: 20px;
  height: 20px;
  background: #2a2016;
  border: 1px solid #3a2e20;
  color: #d4a574;
  cursor: pointer;
}

.cost-curve {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 80px;
  margin-top: 0.5rem;
}

.cost-curve .bar {
  flex: 1;
  background: linear-gradient(180deg, #d4a574, #8b5e3c);
  min-height: 2px;
  border-radius: 2px 2px 0 0;
}

.cost-curve .bar-label {
  text-align: center;
  font-size: 0.7rem;
  color: #888;
}
```

### 7.4 簽名卡編輯器

```css
.signature-editor section {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #2a2016;
}

.signature-editor section h3 {
  font-family: 'Cinzel', serif;
  color: #d4a574;
  font-size: 0.85rem;
  letter-spacing: 0.15em;
  margin-bottom: 0.75rem;
  text-transform: uppercase;
}

.commit-icon-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.25rem;
}

.commit-icon-row select {
  flex: 2;
}

.commit-icon-row input[type=number] {
  flex: 1;
  width: 50px;
}
```

---

## 八、Part 2 交付確認清單

實作 Part 2 後應達成以下狀態：

- [ ] 三欄主佈局完成（左 20% / 中 45% / 右 35%）
- [ ] 左欄 16×4 預設矩陣渲染正確（含陣營色彩、完成度視覺）
- [ ] 左欄過濾器正常運作（搜尋、完成度、MBTI 群組、時代標籤）
- [ ] 中央欄 5 個分頁切換順暢
- [ ] 分頁 ① 基本資訊完整（含預設模板 MBTI 欄位唯讀）
- [ ] 分頁 ② 屬性配點三段式顯示（基礎/陣營/自由）
- [ ] 分頁 ② 自由點數分配含上限檢查
- [ ] 分頁 ③ 戰鬥熟練含偏重字母推薦
- [ ] 分頁 ④ 簽名卡與弱點的卡槽顯示
- [ ] 分頁 ⑤ 起始牌組構築三欄子佈局（可用卡池/已選/分析）
- [ ] 右欄簽名卡設計器完整（與 MOD-01 欄位一致）
- [ ] 右欄個人弱點編輯器完整
- [ ] 頂部進度指示器含跳轉功能
- [ ] `investigator-designer.css` 暗黑哥德風格一致
- [ ] 前端驗證邏輯（牌組大小、必備項目、費用曲線警告）

---

## 九、文件版本紀錄

| 版本 | 日期 | 變更內容 |
|------|------|---------|
| v1.0 | 2026/04/16 | 初版建立 — 三欄佈局、16×4 預設矩陣、ID 卡 5 分頁編輯、內建簽名卡設計器、個人弱點編輯器、起始牌組三欄構築介面、完整 CSS 規範 |

---

> **接續文件：** `Claude_Code_MOD11_Investigator_Designer_指令_Part3.md`
>
> **Part 3 內容預告：** Gemini AI 三種敘事生成模式（背景/能力/引文）完整 Prompt、總覽面板（64 矩陣統計、完成度追蹤、時代標籤分佈）、與其他模組的整合點說明、規則書回寫清單（支柱五 §1.2 修正案、陣營等級待定設計空間）
