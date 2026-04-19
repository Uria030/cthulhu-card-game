# Claude Code 指令：卡片設計器 — 三合一系統實作
## Card Designer — Triple-Use System Implementation

> **給 Claude Code：** 請對已完成的卡片設計器 (MOD-01) 進行以下改良，實作「三合一卡片用途系統」。
> 每張卡片擁有三種互斥用途：打出（Play）、加值（Commit）、消費（Consume）。
>
> **前置依賴：** 
> - 本指令假設卡片設計器改良 v3（稀有度反推、效果選擇器、平衡計算面板）已經完成。
> - 請先確認 v3 功能已就緒再開始本次改良。
>
> **核心設計文件：**
> - `docs/核心設計原則_補充05_三合一卡片用途系統_v0_1.md` — 完整設計規範
> - `docs/卡片價值計算規範_Card_Value_Spec_v0_1.md` — 效果價值表
> - `docs/卡片設計規範_Card_Design_Spec_v0_2.md` — 卡片規格

---

## 一、三合一區塊介面結構

編輯表單的主要內容區域改為三個可收合區塊：

```
┌─────────────────────────────────────────────┐
│  ▸ 身份資訊區（卡片名稱、類型、陣營、等級）  │
├─────────────────────────────────────────────┤
│  ▾ 區塊一：打出效果（Play）                  │  ← 預設展開
│    費用、消耗類型、裝備欄位、效果選擇器       │
│    平衡計算面板、稀有度反推                    │
├─────────────────────────────────────────────┤
│  ▸ 區塊二：加值數據（Commit）                 │  ← 可收合
│    屬性圖示配置、附贈效果（技能卡專用）        │
│    加值價值計算、區間檢驗提示                  │
├─────────────────────────────────────────────┤
│  ▸ 區塊三：消費功能（Consume）                │  ← 可收合
│    消費效果選擇器、價值計算                    │
│    稀有度/等級上限檢驗提示                     │
├─────────────────────────────────────────────┤
│  ▸ 即時預覽（三合一卡面）                     │
└─────────────────────────────────────────────┘
```

每個區塊右上角顯示該區塊的價值總計，方便一目了然。

---

## 二、區塊二：加值數據（Commit）

### 2.1 屬性圖示配置介面

以七大屬性為行，每行一個數值調整器（0 至 6）：

```
┌─ 屬性圖示配置 ─────────────────────────────┐
│                                             │
│  力量 (STR)    [ - ]  0  [ + ]    = 0V      │
│  敏捷 (AGI)    [ - ]  1  [ + ]    = 0.5V    │
│  體質 (CON)    [ - ]  0  [ + ]    = 0V      │
│  智力 (INT)    [ - ]  0  [ + ]    = 0V      │
│  意志 (WIL)    [ - ]  0  [ + ]    = 0V      │
│  感知 (PER)    [ - ]  0  [ + ]    = 0V      │
│  魅力 (CHA)    [ - ]  0  [ + ]    = 0V      │
│                                             │
│  ☐ 萬能加值    [ - ]  0  [ + ]    = 0V      │
│                                             │
│  ──────────────────────────────────         │
│  屬性圖示總價值：0.5V                        │
│                                             │
└─────────────────────────────────────────────┘
```

每個屬性旁即時顯示該屬性的價值（套用曲線：+1=0.5V、+2=1.5V、+3=3V、+4=5V、+5=7.5V）。
萬能加值勾選後，所有個別屬性調整器隱藏，改為單一萬能數值調整器（+1=1V、+2=3V、+3=6V）。
底部顯示屬性圖示總價值。

### 2.2 附贈效果（技能卡專用）

僅當卡片類型 = `skill` 時顯示：

```
┌─ 附贈效果（技能卡專用）────────────────────┐
│                                             │
│  成功時效果：                                │
│    [效果選擇器] ──── 價值：2.5V              │
│                                             │
│  失敗時效果：                                │
│    [效果選擇器] ──── 價值：0V                │
│                                             │
│  ──────────────────────────────────         │
│  附贈效果總價值：2.5V                        │
│                                             │
└─────────────────────────────────────────────┘
```

效果選擇器復用區塊一（打出效果）已有的效果選擇器元件。

### 2.3 加值價值檢驗面板

```
┌─ 加值價值檢驗 ─────────────────────────────┐
│                                             │
│  屬性圖示價值：    0.5V                      │
│  附贈效果價值：    2.5V  （技能卡才顯示）     │
│  ────────────────────────                   │
│  加值總價值：      3.0V                      │
│                                             │
│  [技能卡] 等級價值區間：LV0 = 2.5V - 3.0V   │
│  狀態：✓ 合格（3.0V 落在 2.5-3.0V 區間）     │
│                                             │
│  [非技能卡] 參考提示：                       │
│  稀有度「標準」對應區間 = 5.0V - 6.0V        │
│  當前加值價值 0.5V — 僅供參考                │
│                                             │
└─────────────────────────────────────────────┘
```

- 技能卡：顯示等級對應的價值區間，以綠色/紅色標示合格/超標
- 非技能卡：顯示稀有度對應的參考區間，灰色文字，不標示合格/超標

---

## 三、區塊三：消費功能（Consume）

### 3.1 消費效果選擇器

```
┌─ 消費效果配置 ──────────────────────────────┐
│                                              │
│  ☐ 啟用消費功能                               │
│                                              │
│  效果類型：[下拉選單]                          │
│    ├─ 獲得資源                                │
│    ├─ 補充彈藥/充能                           │
│    ├─ 回復 HP                                 │
│    ├─ 回復 SAN                                │
│    ├─ 抽牌                                    │
│    ├─ 獲得正面狀態                             │
│    ├─ 移除負面狀態                             │
│    └─ 取消傷害/恐懼                           │
│                                              │
│  數值：[ - ]  2  [ + ]                        │
│                                              │
│  效果描述（中文）：                            │
│  ┌──────────────────────────────────────┐    │
│  │ 消費此卡：獲得 2 點資源。              │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  效果描述（英文）：                            │
│  ┌──────────────────────────────────────┐    │
│  │ Consume: Gain 2 resources.            │    │
│  └──────────────────────────────────────┘    │
│                                              │
└──────────────────────────────────────────────┘
```

勾選「啟用消費功能」後才展開下方欄位。未啟用時，此卡片只有打出和加值兩種用途。

### 3.2 消費效果的價值對照表

根據效果類型和數值，自動計算價值：

| 效果類型 | 每單位價值 | 說明 |
|----------|----------|------|
| 獲得資源 | 1V / 資源 | |
| 補充彈藥/充能 | 0.5V / 個 | 依附場上裝備 |
| 回復 HP | 1.5V / HP | |
| 回復 SAN | 1.5V / SAN | |
| 抽牌 | 1V / 張 | |
| 獲得正面狀態 | 依狀態價值表 | 參照《卡片價值計算規範》2.6 節 |
| 移除負面狀態 | 依狀態價值表 | 參照《卡片價值計算規範》2.6 節 |
| 取消傷害/恐懼 | 0.5V / 點 | |

### 3.3 消費效果的選擇器細節

**「獲得正面狀態」選擇時：**
展開第二層下拉選單，列出所有正面狀態：
- 強化（3V）
- 護甲（3V）
- 護盾（6V）
- 加速（4V）
- 再生（6V）
- 隱蔽（6V）

並顯示施加層數調整器（預設 1 層）。

**「移除負面狀態」選擇時：**
展開第二層下拉選單，列出所有負面狀態：
- 中毒、流血、燃燒、冷凍、潮濕、發瘋、標記、脆弱、無力、弱化、黑暗、繳械、疲勞、沈默、毀滅

並顯示移除層數調整器（預設 1 層）。

### 3.4 消費價值檢驗面板

```
┌─ 消費價值檢驗 ─────────────────────────────┐
│                                             │
│  消費效果價值：     2.0V                     │
│  固定成本門檻：     1.5V                     │
│  ────────────────────────                   │
│  值得消費？ ✓ 是（2.0V > 1.5V）              │
│                                             │
│  [非技能卡] 稀有度上限：                     │
│  稀有度「標準」= 5.0V - 6.0V                 │
│  狀態：✓ 合格（2.0V ≤ 5.0V）                │
│                                             │
│  [技能卡] 等級上限：                         │
│  LV0 = 2.5V - 3.0V                          │
│  狀態：✓ 合格（2.0V ≤ 2.5V）                │
│                                             │
└─────────────────────────────────────────────┘
```

顯示兩項檢驗：
1. 是否 > 1.5V（否則橙色提示「此消費效果價值不足，玩家可能不會使用」）
2. 是否 ≤ 稀有度/等級對應的上限（超標時紅色警告）

---

## 四、資料結構變更

### 4.1 新增屬性圖示欄位

在 `card_definitions` 表中新增：

```sql
-- 加值用屬性圖示（Commit 時提供的檢定加值）
commit_icons JSONB NOT NULL DEFAULT '{}',
-- 範例：{"strength": 1, "agility": 2}
-- 萬能加值：{"all": 1}
```

### 4.2 新增消費效果欄位

在 `card_definitions` 表中新增：

```sql
-- 消費功能
consume_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
consume_effect   JSONB,
-- 範例：
-- {"effect_type": "gain_resource", "amount": 2, "value": 2.0}
-- {"effect_type": "heal_hp", "amount": 2, "value": 3.0}
-- {"effect_type": "add_status", "status": "empowered", "layers": 1, "value": 3.0}
-- {"effect_type": "remove_status", "status": "poison", "layers": 1, "value": 3.0}
-- {"effect_type": "cancel_damage", "amount": 2, "value": 1.0}
```

### 4.3 新增加值附贈效果（技能卡用）

在 `card_effects` 表的 `trigger_type` ENUM 中確認已有以下值：

```sql
'on_commit',    -- 當加值投入時（技能卡附贈效果的觸發器）
'on_success',   -- 檢定成功時
'on_failure',   -- 檢定失敗時
```

技能卡的附贈效果使用 `card_effects` 表，`trigger_type` 為 `on_success` 或 `on_failure`。

### 4.4 consume_effect 的合法 effect_type 值

| effect_type | 說明 | 必要參數 |
|-------------|------|----------|
| `gain_resource` | 獲得資源 | `amount` |
| `gain_ammo` | 補充彈藥 | `amount` |
| `gain_charges` | 補充充能 | `amount` |
| `heal_hp` | 回復 HP | `amount` |
| `heal_san` | 回復 SAN | `amount` |
| `draw_card` | 抽牌 | `amount` |
| `add_status` | 獲得正面狀態 | `status`, `layers` |
| `remove_status` | 移除負面狀態 | `status`, `layers` |
| `cancel_damage` | 取消傷害 | `amount` |
| `cancel_horror` | 取消恐懼 | `amount` |

### 4.5 完整卡片資料結構範例

```javascript
{
  // ... 既有欄位（身份、打出效果、費用等）

  // 區塊二：加值數據（Commit）
  commit_icons: {
    "strength": 0,
    "agility": 1,
    "constitution": 0,
    "intellect": 0,
    "willpower": 0,
    "perception": 0,
    "charisma": 0
  },
  // commit_icons_value 由前端即時計算，不存入資料庫
  // 技能卡的附贈效果存在 card_effects 表中

  // 區塊三：消費功能（Consume）
  consume_enabled: true,
  consume_effect: {
    "effect_type": "gain_resource",
    "amount": 2,
    "value": 2.0
  },

  // ... 既有欄位（中繼資料等）
}
```

---

## 五、前端價值計算邏輯

### 5.1 屬性圖示價值計算函數

```javascript
// 單屬性加值的曲線價值表
const SINGLE_ATTR_VALUE = {
  0: 0, 1: 0.5, 2: 1.5, 3: 3, 4: 5, 5: 7.5, 6: 10
};

// 萬能加值的價值表
const WILD_ATTR_VALUE = {
  0: 0, 1: 1, 2: 3, 3: 6
};

function calculateCommitValue(commitIcons) {
  if (commitIcons.all) {
    return WILD_ATTR_VALUE[commitIcons.all] || 0;
  }
  let total = 0;
  for (const [attr, value] of Object.entries(commitIcons)) {
    total += SINGLE_ATTR_VALUE[value] || 0;
  }
  return total;
}
```

### 5.2 消費效果價值計算函數

```javascript
const CONSUME_VALUE_TABLE = {
  'gain_resource':  (amount) => amount * 1,
  'gain_ammo':      (amount) => amount * 0.5,
  'gain_charges':   (amount) => amount * 0.5,
  'heal_hp':        (amount) => amount * 1.5,
  'heal_san':       (amount) => amount * 1.5,
  'draw_card':      (amount) => amount * 1,
  'cancel_damage':  (amount) => amount * 0.5,
  'cancel_horror':  (amount) => amount * 0.5,
  // add_status 和 remove_status 需要查狀態價值表
};

const STATUS_VALUE = {
  'empowered': 3, 'armor': 3, 'ward': 6,
  'haste': 4, 'regeneration': 6, 'stealth': 6,
  'poison': 3, 'bleed': 2, 'burning': 3,
  'frozen': 3, 'wet': 1, 'madness': 6,
  'marked': 6, 'vulnerable': 2, 'weakness_status': 2,
  'weakened': 3, 'darkness': 2, 'disarm': 4,
  'fatigue': 4, 'silence': 4, 'doom_status': 2
};

function calculateConsumeValue(consumeEffect) {
  if (!consumeEffect) return 0;
  const { effect_type, amount, status, layers } = consumeEffect;

  if (effect_type === 'add_status' || effect_type === 'remove_status') {
    return (STATUS_VALUE[status] || 0) * (layers || 1);
  }

  const calculator = CONSUME_VALUE_TABLE[effect_type];
  return calculator ? calculator(amount || 0) : 0;
}
```

### 5.3 技能卡等級價值區間 / 稀有度消費上限

```javascript
// 技能卡等級 → 價值區間（同時用於加值檢驗和消費上限）
const SKILL_LEVEL_RANGE = {
  0: { min: 2.5, max: 3 },
  1: { min: 2.5, max: 3 },
  2: { min: 5, max: 6 },
  3: { min: 7, max: 8 },
  4: { min: 8, max: 9 },
  5: { min: 9, max: 10 }
};

// 稀有度 → 消費價值上限（非技能卡用）
const RARITY_CONSUME_RANGE = {
  'common':    { min: 2.5, max: 3 },   // 隨身
  'basic':     { min: 2.5, max: 3 },   // 基礎
  'standard':  { min: 5, max: 6 },     // 標準
  'advanced':  { min: 7, max: 8 },     // 進階
  'rare':      { min: 8, max: 9 },     // 稀有
  'legendary': { min: 9, max: 10 }     // 傳奇
};

const CONSUME_MINIMUM_THRESHOLD = 1.5;  // 消費效果最低有效價值
```

---

## 六、即時預覽更新

卡面預覽需要新增顯示：

### 6.1 屬性圖示區域

在卡面底部顯示屬性圖示，以小圖示方式排列：

```
┌─────────────────────┐
│  .45 自動手槍        │
│  費用：3 · 標準      │
│  ────────────────── │
│  [打出效果文字]      │
│  ────────────────── │
│  消費：獲得 2 資源   │
│  ────────────────── │
│  [敏] ×1             │  ← 屬性圖示
└─────────────────────┘
```

- 每個屬性用對應的縮寫或小圖示表示
- 數字顯示在圖示旁
- 技能卡額外顯示附贈效果的摘要文字

### 6.2 消費效果區域

在打出效果文字下方，獨立一行顯示消費效果的摘要：
- 格式：`消費：[效果摘要]`
- 未啟用消費功能時不顯示此行

---

## 七、API 端點調整

### 7.1 POST / PUT /api/cards

請求 body 新增欄位：

```javascript
{
  // ... 既有欄位

  commit_icons: { "agility": 1 },
  consume_enabled: true,
  consume_effect: { "effect_type": "gain_resource", "amount": 2, "value": 2.0 }
}
```

### 7.2 後端驗證

儲存時後端應進行以下驗證：

1. `commit_icons` 的每個屬性值必須在 0-6 之間
2. `commit_icons` 若含 `all` 鍵，則不能同時有其他屬性鍵
3. `consume_effect` 的 `effect_type` 必須在合法清單內
4. `consume_effect` 的 `amount` / `layers` 必須 > 0
5. 技能卡：加值總價值必須落在等級價值區間內（硬性約束）
6. 非技能卡：加值總價值超出參考區間時，回傳 warning（非 error）
7. 消費效果超出稀有度/等級上限時，回傳 warning（非 error）

---

## 八、AI 生成 Prompt 更新

在 AI 卡片生成的 Prompt 中加入三合一系統說明：

```
## 三合一系統
每張卡片有三種互斥用途：
1. 打出（Play）— 放到場上或發動效果
2. 加值（Commit）— 檢定前從手牌投入，提供屬性加值
3. 消費（Consume）— 花 1 行動點棄掉，獲得一次性輔助效果

請為生成的卡片設計這三種用途。

加值：選擇適合卡片主題的屬性圖示（七大屬性各 0-5）。
消費：從以下七種效果中選一：獲得資源、補充彈藥/充能、回復 HP、回復 SAN、抽牌、獲得正面狀態、移除負面狀態、取消傷害/恐懼。
消費效果不能是移動、攻擊、調查等基本動作。

在回傳的 JSON 中加入：
  commit_icons: { 屬性: 加值數字 },
  consume_enabled: true/false,
  consume_effect: { effect_type: "...", amount: N }
```

---

## 九、風險檢查清單

### ⚠️ 高風險：JSON 欄位衝突

**問題描述：**
卡片目前已有 `check_modifier` 和 `attribute_modifiers` 欄位，用於描述「場上資產使用能力時的檢定加值」（例如：.45 手槍開槍時敏捷 +1）。新增的 `commit_icons` 描述的是「從手牌 commit 到檢定時的屬性加值」。

這兩個概念完全不同：
- `attribute_modifiers` / `check_modifier` = 場上能力的一部分，已計入打出效果的價值
- `commit_icons` = 手牌加值，不計入打出效果的價值

**風險：** 
如果前端或後端在任何地方混淆這兩組欄位，會導致價值計算錯誤。

**檢查項目：**
- [ ] 確認 `commit_icons` 與 `attribute_modifiers` / `check_modifier` 在資料結構中完全獨立
- [ ] 確認前端介面中，區塊一（打出效果）的檢定修正和區塊二（加值數據）的屬性圖示是完全分開的 UI 元件
- [ ] 確認價值計算邏輯中，`commit_icons` 不被計入打出效果的費用公式
- [ ] 確認 `attribute_modifiers` 不被計入加值（Commit）的價值計算
- [ ] 確認 AI 生成的 JSON 中，這兩組欄位不會互相覆蓋
- [ ] 確認即時預覽中，場上能力的「攻擊時 +X」和卡片底部的「屬性圖示」視覺上明確區分

### ⚠️ 中風險：技能卡的特殊流程

**問題描述：**
技能卡沒有打出效果、費用固定為 0、不反推稀有度。它的設計流程和價值檢驗邏輯與其他卡片類型不同。

**檢查項目：**
- [ ] 當卡片類型 = `skill` 時，區塊一（打出效果）應隱藏或灰化大部分欄位（費用強制為 0）
- [ ] 技能卡的加值檢驗使用等級價值區間，不使用稀有度
- [ ] 技能卡的消費上限使用等級價值區間，不使用稀有度
- [ ] 技能卡的附贈效果 UI 區塊只在 type = `skill` 時顯示

### ⚠️ 低風險：消費效果的合法性

**檢查項目：**
- [ ] 消費效果的 `effect_type` 下拉選單只包含七種合法效果
- [ ] 不能選擇移動、攻擊、調查等基本動作類效果
- [ ] 消費效果價值 ≤ 1.5V 時顯示橙色警告（提示不值得設計）
- [ ] 消費效果價值超出稀有度/等級上限時顯示紅色警告

---

## 十、完成後

1. Git commit：`feat: card designer — triple-use system (commit icons, consume effects, value validation)`
2. 更新即時預覽，顯示屬性圖示和消費效果摘要
3. Push 到 GitHub
4. 測試項目：
   - 建立一張非技能卡，配置三合一數據，確認三個區塊獨立運作
   - 建立一張技能卡，確認附贈效果和等級區間檢驗正確
   - 確認 `commit_icons` 和 `attribute_modifiers` 在資料庫中完全獨立
   - 確認 AI 生成功能正確回傳三合一數據

---

## 十一、相關文件索引

| 文件 | 用途 |
|------|------|
| `docs/核心設計原則_補充05_三合一卡片用途系統_v0_1.md` | 三合一系統完整設計規範 |
| `docs/卡片價值計算規範_Card_Value_Spec_v0_1.md` | 效果價值表、費用公式 |
| `docs/卡片設計規範_Card_Design_Spec_v0_2.md` | 各類卡片規格 |
| `docs/核心設計原則_補充02_卡片效果語言與狀態系統_v0_2.md` | 合法效果代碼、狀態定義 |
| `docs/Claude_Code_Card_Designer_改良指令_v3.md` | 前置依賴：稀有度反推、效果選擇器 |
