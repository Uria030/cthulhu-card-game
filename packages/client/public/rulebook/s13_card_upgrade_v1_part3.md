# 卡片升級系統重構 v1 · Part 3 實作與遷移篇
## Card Upgrade System Refactor v1 · Part 3: Implementation & Migration

- **版本**：v1.0
- **日期**：2026-04-25
- **文件性質**：給 Claude Code 的實作指令文件
- **權威順序**：本規範 > 規則書 v1.0 > 卡片價值計算規範 v1.1
- **相關檔案**：Part 1 核心機制篇、Part 2 費用公式篇
- **適用範圍**：MOD-01 前端 UI、後端 routes、資料庫 schema、舊資料遷移、驗證測試、規則書文字替換

---

## 一、執行順序

請 Claude Code 依以下順序執行，前項完成才動下一項：

```
1. 與 Uria 確認 level 欄位改名方案（A/B/C 三選一）
2. 與 Uria 確認 Exceptional 中文卡面標籤
3. 資料庫 schema 變更（含 acquired_method 列舉擴充）
4. 舊資料遷移腳本
5. MOD-01 前端 UI 重構（拆除 LV0–LV5 六頁籤 + 新增起始投入點數欄位）
6. MOD-01 V 值計算函式調整（依 Part 2 §10）
7. AI 生成 Prompt 更新（依 Part 2 §9）
8. 規則書文字替換（依本篇第七節）
9. 驗證測試
```

---

## 二、與 Uria 確認的決策項

### 2.1 level 欄位改名

請 Claude Code 主動向 Uria 詢問，並依回覆執行：

**詢問內容（建議文字）**：
> 卡片升級系統重構 Part 1 §2.3 列出了三個方案處理 `level` 欄位：
> - A：保留 `level` 欄位名，語意改寫為「起始投入點數」
> - B：改名為 `starting_xp`
> - C：改名為 `init_points`
>
> 請問要採用哪個方案？

**對應動作**：
- 選 A：本次不做欄位改名，僅在前端顯示文字與 V 值計算註解中改寫語意。
- 選 B 或 C：建立 schema migration 腳本（見 §三）並同步替換所有引用點。

### 2.2 Exceptional 中文卡面標籤

請 Claude Code 主動向 Uria 詢問：

**詢問內容（建議文字）**：
> Exceptional 關鍵字的中文卡面顯示文字，請從以下候選擇一：
> - 「卓越」
> - 「Exceptional」（保留英文）
> - 「特例」
> - 其他自訂

**對應動作**：在 `data/card-keywords.json` 或對應位置設定 Exceptional 的中文標籤。

---

## 三、資料庫 schema 變更

### 3.1 card_definitions 表

#### 3.1.1 起始投入點數欄位（保留 level 或改名）

**情境 A（Uria 選擇保留 level）**：

```sql
-- 不需要 schema 變更
-- 在 ORM 層或註解中標記語意改寫：
-- card_definitions.level：起始投入點數，範圍 0–5
COMMENT ON COLUMN card_definitions.level IS
  '起始投入點數：設計師在卡片設計時預先投入的成長空間點數，範圍 0–5。對應 V 值公式中的「起始投入抵扣 = level × 1V」';
```

**情境 B 或 C（Uria 選擇改名）**：

```sql
-- 重命名欄位（範例使用 starting_xp，C 方案改用 init_points）
ALTER TABLE card_definitions RENAME COLUMN level TO starting_xp;
COMMENT ON COLUMN card_definitions.starting_xp IS
  '起始投入點數：設計師在卡片設計時預先投入的成長空間點數，範圍 0–5';

-- 確認 CHECK 約束（若不存在則新增）
ALTER TABLE card_definitions
  ADD CONSTRAINT chk_starting_xp_range CHECK (starting_xp BETWEEN 0 AND 5);
```

#### 3.1.2 強化菜單欄位（新增）

設計師可在卡片設計時，於卡面欄位旁掛上強化標記。本次規範**只建立資料容器**，售價計算不在本次範圍：

```sql
-- 新增 enhancement_slots 欄位（JSONB，存放強化菜單的設計師標記）
ALTER TABLE card_definitions
  ADD COLUMN enhancement_slots JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN card_definitions.enhancement_slots IS
  '強化菜單：設計師標記哪些欄位開放玩家用 XP 強化。' ||
  '結構：[{field: string, max_increment: int, xp_cost: int|null}, ...]。' ||
  '本次規範不定義 xp_cost 計算規則，預設為 null 待後續訂定。';
```

**enhancement_slots 結構草案**：

```json
[
  {"field": "damage", "max_increment": 2, "xp_cost": null},
  {"field": "uses", "max_increment": 1, "xp_cost": null},
  {"field": "attribute_modifiers.strength", "max_increment": 2, "xp_cost": null}
]
```

#### 3.1.3 既有 is_exceptional 欄位

`is_exceptional` 欄位（MIGRATION_006）已存在，**不變動**。新規範下其機制詳見 Part 1 §五。

#### 3.1.4 既有 is_unique 欄位

已存在，不變動。新規範下用於擋整備期重複購買（見 §四 後端邏輯）。

#### 3.1.5 既有 is_temporary 欄位

已存在（MIGRATION_014），不變動。

#### 3.1.6 移除舊 upgrades 欄位

`upgrades` 欄位（MIGRATION_005）原存放 LV0–LV5 各等級的獨立效果定義，新系統下廢除。**先標記為廢棄，不立即移除**：

```sql
COMMENT ON COLUMN card_definitions.upgrades IS
  '【已廢棄 v1 重構】舊系統下存放 LV0–LV5 各等級的獨立效果定義。' ||
  '新系統使用 enhancement_slots 取代。此欄位保留 60 天後移除，期間僅讀不寫。';
```

60 天後執行：

```sql
ALTER TABLE card_definitions DROP COLUMN upgrades;
```

#### 3.1.7 卡片來源旗標（新增）

劇情固定卡與探索獎勵卡需可區分：

```sql
ALTER TABLE card_definitions
  ADD COLUMN card_source VARCHAR(32) NOT NULL DEFAULT 'standard';

COMMENT ON COLUMN card_definitions.card_source IS
  '卡片來源類型：' ||
  '''standard''（標準卡，可由探索獲得或整備購買）、' ||
  '''story_fixed''（劇情固定發放，不受天賦鎖、不可整備購買）、' ||
  '''book_upgrade''（書籍升級版，僅由 transform 取得）、' ||
  '''relic_upgrade''（遺跡升級版，僅由 transform 取得）';

ALTER TABLE card_definitions
  ADD CONSTRAINT chk_card_source CHECK (
    card_source IN ('standard', 'story_fixed', 'book_upgrade', 'relic_upgrade')
  );
```

### 3.2 deck_cards 表

#### 3.2.1 acquired_method 列舉擴充

`deck_cards.acquired_method` 既有值為 `starting / exploration / reward / craft / trade`，新增 `purchase`：

```sql
-- 若 acquired_method 為 VARCHAR 欄位（非 ENUM）
ALTER TABLE deck_cards
  DROP CONSTRAINT IF EXISTS chk_acquired_method;

ALTER TABLE deck_cards
  ADD CONSTRAINT chk_acquired_method CHECK (
    acquired_method IN ('starting', 'exploration', 'reward', 'craft', 'trade', 'purchase')
  );

-- 若 acquired_method 為 PostgreSQL ENUM 類型
ALTER TYPE acquired_method_enum ADD VALUE IF NOT EXISTS 'purchase';
```

請 Claude Code 先檢查 `deck_cards.acquired_method` 的實際型別再執行對應指令。

#### 3.2.2 玩家投入點數欄位（新增）

每張具體的卡片實例需追蹤玩家已投入的 XP 點數：

```sql
ALTER TABLE deck_cards
  ADD COLUMN player_invested_points INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN deck_cards.player_invested_points IS
  '玩家對此卡片實例已投入的成長配額點數。' ||
  '與 card_definitions.level（起始投入）相加不得超過 5。';

ALTER TABLE deck_cards
  ADD CONSTRAINT chk_player_invested_range
  CHECK (player_invested_points BETWEEN 0 AND 5);
```

#### 3.2.3 玩家強化選擇紀錄（新增）

玩家透過強化菜單購買的具體強化內容：

```sql
ALTER TABLE deck_cards
  ADD COLUMN enhancement_choices JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN deck_cards.enhancement_choices IS
  '玩家對此卡片實例已購買的強化選項清單。' ||
  '結構：[{slot_field: string, increment: int, xp_paid: int}, ...]';
```

### 3.3 卡片庫概念（暫不建表）

依 Part 1 §2.4，卡片庫的具體容器規格與 UI 在後續迭代定義。**本次不建立 cards_library 資料表**。

實作上，玩家「擁有的所有卡片」可透過查詢「`deck_cards` 中該玩家擁有過的所有 card_def_id 的 distinct 集合」推導，暫不需獨立資料表。

---

## 四、後端 routes 變更

### 4.1 cards.ts

#### 4.1.1 移除舊 upgrades 處理邏輯

`packages/server/src/routes/cards.ts` 中所有讀寫 `upgrades` 欄位的程式碼**先註解保留**，標記 `// DEPRECATED: removed in upgrade-system-refactor-v1`，60 天後移除。

#### 4.1.2 新增 enhancement_slots 處理

`POST /api/cards` 與 `PUT /api/cards/:id` 接收 enhancement_slots 欄位，依 §3.1.2 的結構驗證。`xp_cost` 預設 `null`（待規則訂定）。

#### 4.1.3 新增 card_source 處理

CRUD 路由接收 `card_source` 欄位，預設 `standard`。

### 4.2 整備期購買的後端驗證（新增）

整備期購買卡片副本與購買強化的後端動作尚未有對應路由。**本次不實作具體路由**（屬於玩家端 SPA 範圍），但需建立後端驗證函式供未來路由使用：

```typescript
// packages/server/src/services/cardPurchase.ts （新建檔案）

/**
 * 驗證玩家是否可購買此卡片副本進牌組
 *
 * @returns { valid: boolean, reason?: string, xp_cost?: number }
 */
export function validateCardPurchase(
  investigatorState: InvestigatorState,
  cardDef: CardDefinition
): PurchaseValidation {
  // 1. 檢查 card_source 是否允許購買
  if (cardDef.card_source === 'book_upgrade' || cardDef.card_source === 'relic_upgrade') {
    return { valid: false, reason: '升級版卡片不可由整備期購買' };
  }

  // 2. 檢查獨特性（已有同名卡時不可再買）
  if (cardDef.is_unique) {
    const alreadyOwned = investigatorState.deckCards.some(
      dc => dc.card_def_id === cardDef.id
    );
    if (alreadyOwned) {
      return { valid: false, reason: '獨特卡僅可擁有一張' };
    }
  }

  // 3. 檢查天賦等級鎖（依 Part 1 §6.2）
  const factionTalentLevel = getFactionTalentLevel(
    investigatorState,
    cardDef.faction_id
  );
  const maxStartingPoints = getMaxStartingPointsByTalentLevel(factionTalentLevel);
  if (cardDef.level > maxStartingPoints) {
    return {
      valid: false,
      reason: `天賦等級 ${factionTalentLevel} 不足以購買起始投入 ${cardDef.level} 點的卡片`
    };
  }

  // 4. 計算 XP 費用
  const exceptionalMultiplier = cardDef.is_exceptional ? 2 : 1;
  const xpCost = cardDef.level * exceptionalMultiplier;

  // 5. 檢查玩家 XP 餘額
  if (investigatorState.experience < xpCost) {
    return { valid: false, reason: `XP 不足，需要 ${xpCost} XP` };
  }

  return { valid: true, xp_cost: xpCost };
}

/**
 * 天賦等級對應的可購買起始投入點數上限（依 Part 1 §6.2）
 */
function getMaxStartingPointsByTalentLevel(talentLevel: number): number {
  if (talentLevel === 0) return -1;  // 不可獲取
  if (talentLevel === 1) return 0;
  if (talentLevel <= 3) return 1;
  if (talentLevel <= 5) return 2;
  if (talentLevel <= 7) return 3;
  if (talentLevel <= 9) return 4;
  return 5;  // 10–12 級
}
```

---

## 五、MOD-01 前端 UI 重構

### 5.1 拆除舊 LV0–LV5 六頁籤

**檔案**：`packages/client/public/admin/admin-card-designer.html`

**移除的函式（標記為廢棄保留 60 天，之後刪除）**：

| 函式 | 行號 | 處理方式 |
|---|---|---|
| `switchUpgradeTab(lv)` | L1403 | 註解廢棄 |
| `saveUpgradeLevelSilent(lv)` | L1420 | 註解廢棄 |
| `saveUpgradeLevel(lv)` | L1439 | 註解廢棄 |
| `clearUpgradeLevel(lv)` | L1444 | 註解廢棄 |
| `updateUpgradeTabIndicators()` | L1454 | 註解廢棄 |
| `loadUpgrades(upgrades)` | L1462 | 註解廢棄 |

**移除的 DOM 元素**：

- 卡片設計器主表單上方的 LV0–LV5 六個頁籤按鈕
- 對應的頁籤切換邏輯與資料儲存邏輯

### 5.2 新增起始投入點數欄位

在主表單上新增一個欄位：

```html
<!-- 在卡片基本資訊區塊內 -->
<div class="form-group">
  <label for="card-starting-xp">起始投入點數 <span class="hint">(0–5)</span></label>
  <input
    type="number"
    id="card-starting-xp"
    min="0"
    max="5"
    value="0"
    class="form-input"
  />
  <p class="form-help">
    設計師預先投入的成長空間點數。每點對應 1V 效果預算。
    玩家可在剩餘配額（5 - 起始投入）內以 XP 自行強化。
  </p>
</div>
```

對應的 collectForm() 與 loadCard() 函式（L1255、L1188）需加入此欄位的讀寫邏輯。

### 5.3 新增強化菜單編輯區塊

在主表單下方新增一個區塊，讓設計師勾選哪些卡面欄位開放強化：

```html
<section class="card-section" id="enhancement-slots-section">
  <h3>強化菜單（玩家可購買的強化選項）</h3>
  <p class="section-help">
    勾選哪些卡面欄位開放玩家用 XP 強化。
    售價計算規則待後續訂定，目前 xp_cost 預設為待定。
  </p>
  <!-- 動態渲染各欄位的勾選與最大強化幅度 -->
  <div id="enhancement-slots-list"></div>
  <button type="button" onclick="addEnhancementSlot()">＋ 新增強化標記</button>
</section>
```

需新增的函式：

| 函式 | 職責 |
|---|---|
| `renderEnhancementSlots()` | 從 `card.enhancement_slots` 渲染 DOM |
| `addEnhancementSlot()` | 新增一個強化標記 |
| `removeEnhancementSlot(idx)` | 移除指定強化標記 |
| `collectEnhancementSlots()` | 從表單蒐集為 JSONB 格式 |
| `loadEnhancementSlots(slots)` | 從卡片資料載入到表單 |

### 5.4 新增 card_source 欄位

在卡片基本資訊區塊新增下拉選單：

```html
<div class="form-group">
  <label for="card-source">卡片來源</label>
  <select id="card-source" class="form-input">
    <option value="standard">標準卡（可探索獲得 / 整備購買）</option>
    <option value="story_fixed">劇情固定卡（不受天賦鎖、不可購買）</option>
    <option value="book_upgrade">書籍升級版（僅 transform 取得）</option>
    <option value="relic_upgrade">遺跡升級版（僅 transform 取得）</option>
  </select>
</div>
```

當選擇 `book_upgrade` 或 `relic_upgrade` 時，前端自動：
- 鎖定起始投入點數為 5、不可修改
- 鎖定 Exceptional 為 false、不可勾選
- 鎖定強化菜單為空、不可編輯
- 提示「升級版卡片由 transform 取得，費用恆為 0」

### 5.5 平衡面板更新（updateBalancePanel L962）

平衡面板需顯示：

| 顯示項目 | 替換方式 |
|---|---|
| 「等級抵扣」 | 改為「起始投入抵扣」 |
| 數值來源 | 從 `card.level × 1V` 計算（取代舊查表） |
| Exceptional 抵扣 | 不變，沿用 -2V |
| 「LV5」標示 | 改為「★5」或對應符號 |

### 5.6 預覽（updatePreview L2187）

右側即時預覽需更新顯示邏輯：
- 卡片左上角的等級顯示由 LV0–LV5 改為 ★0–★5（或對應視覺符號）
- 預覽不再嘗試切換到不同等級的版本

---

## 六、舊資料遷移

### 6.1 既有卡片的 level 欄位處理

**遷移原則**：
- 既有卡片的 `level` 欄位值（0–5）直接視為新系統下的「設計師起始投入點數」
- 因為 LV5 = 抵扣 5V、起始投入 5 點 = 抵扣 5V，數值上一致
- 但 LV1–LV4 區間舊階梯為 -0.5V/-1V/-2V/-3V，新公式為 -1V/-2V/-3V/-4V，**抵扣值有差異**

### 6.2 LV1–LV4 卡片的費用重算

執行以下 SQL 找出所有受影響的卡片：

```sql
SELECT id, code, name_zh, level, cost
FROM card_definitions
WHERE level BETWEEN 1 AND 4
ORDER BY level, code;
```

對這批卡片，請 Claude Code 執行以下檢查流程：
1. 重算每張卡的效果價值（依 v1.1 §4 規則）
2. 套用新公式計算新費用
3. 與舊 `cost` 比對，差距超過 1 的卡片列入人工複核清單
4. 不主動覆寫 `cost` 欄位，由 Uria 人工逐張確認

### 6.3 既有 upgrades 欄位資料的處理

對於 `upgrades` 欄位非空的舊卡片，遷移策略：

| 情境 | 處理 |
|---|---|
| 卡片設計理念是「逐級成長」 | 取 LV5 版本作為「起始投入 5 點」的版本，丟棄 LV0–LV4 中間版本 |
| 卡片設計理念是「LV0 為基本、LV5 為強版」 | 保留兩張獨立卡片：基本版（起始投入 0）與強版（起始投入 5），互為「替代品」 |
| 不確定 | 列入人工複核清單，由 Uria 決定 |

**遷移腳本骨架**：

```typescript
// scripts/migrate-upgrades.ts
async function migrateUpgrades() {
  const cards = await db.query(
    `SELECT id, code, level, upgrades FROM card_definitions WHERE upgrades IS NOT NULL AND upgrades != '[]'`
  );

  const results = {
    auto_keep_lv5: [],      // LV5 直接保留為起始投入 5 點
    needs_split: [],        // 需要拆分為兩張卡
    needs_review: []        // 人工複核
  };

  for (const card of cards.rows) {
    // 分析 upgrades 結構，分流到三類
    // ...
  }

  console.log('遷移結果：', results);
  console.log('需人工複核：', results.needs_review.length, '張');
}
```

### 6.4 既有 deck_cards 的玩家投入點數

既有 `deck_cards` 沒有 `player_invested_points` 欄位的概念，新增此欄位時所有現有資料的預設值為 0。

```sql
-- 在 §3.2.2 新增欄位時 DEFAULT 0 已處理此情境
-- 確認：既有 deck_cards 的 player_invested_points 一律為 0
SELECT COUNT(*) FROM deck_cards WHERE player_invested_points != 0;
-- 預期結果：0
```

### 6.5 既有 deck_cards 的 acquired_method

`deck_cards.acquired_method` 既有值不需變動。新值 `purchase` 用於本次重構後的整備期購買動作。

---

## 七、規則書與文件文字替換

### 7.1 規則書 v1.0 第三章 §8 等級抵扣

**檔案**：`packages/client/public/rulebook/03_rulebook_ch3.md`

**§8.5 等級抵扣表替換為**：

```markdown
### 8.5 起始投入抵扣

| 起始投入點數 | 抵扣 |
|---|---|
| 0 | 0 |
| 1 | -1V |
| 2 | -2V |
| 3 | -3V |
| 4 | -4V |
| 5 | -5V |

> **設計師起始投入** 由設計師在卡片設計時決定（範圍 0–5），代表該卡出廠時已預先投入幾點成長空間。每點對應 1V 效果預算。
> **玩家後續投入** 在整備期透過花費 XP 對牌組內卡片購買強化，累積投入到該卡上。
> 設計師起始投入 + 玩家後續投入不得超過 5 點。
```

### 7.2 規則書第三章 §8.6 消耗類型修正

**§8.6 消耗類型修正（暫定）**這節整個移除，由 v1.1 的「預期使用次數」吸收，新規範不重新引入。

### 7.3 規則書第四章 §1.1 五條成長路徑

**檔案**：`packages/client/public/rulebook/04_rulebook_ch4.md`

**§1.1 表格第一條替換為**：

```markdown
| 卡片升級 | 經驗值 | 起始投入 + 玩家強化（5 點配額） | 無，基礎功能 |
```

### 7.4 規則書第二章 §1.6 整備模式

**檔案**：`packages/client/public/rulebook/02_rulebook_ch2.md`

**§1.6 第三項「花費經驗值 → 購買升級版卡片」替換為**：

```markdown
- 花費**經驗值** → 從卡片庫購買卡片副本進牌組，或對牌組內卡片購買強化（升級版書籍/遺跡走 transform 路徑，不在此項中）
```

### 7.5 卡片價值計算規範 v1.1

**檔案**：`packages/client/public/rulebook/s04_card_value_spec.md`

**§3 各費用公式中**：將「等級抵扣」一律替換為「起始投入抵扣」，並在 §6 等級抵扣表處註明：

```markdown
## 六、起始投入抵扣（取代舊版等級抵扣）

| 起始投入點數 | 抵扣 |
|---|---|
| 0 | 0 |
| 1 | -1V |
| 2 | -2V |
| 3 | -3V |
| 4 | -4V |
| 5 | -5V |

> **本表取代** v1.1 原 §6 等級抵扣（LV1 -1V 至 LV5 -5V）與規則書索引 §4 覆蓋規則（LV1 -0.5V 至 LV5 -4V）。
> 詳見《卡片升級系統重構 v1》Part 1 與 Part 2。
```

### 7.6 支柱五 v0.1 §2.4 與 §5.2

**檔案**：`packages/client/public/rulebook/支柱五_成長子系統設計_Pillar5_Growth_Subsystem_v0_1.md`（或對應路徑）

**§2.4 卡片等級上限對照表替換為**：

```markdown
### 2.4 卡片獲取門檻規則（v1 重構）

**玩家可獲取的該陣營卡片，其起始投入點數上限受該陣營天賦等級限制。**

| 該陣營天賦等級 | 玩家可獲取的該陣營卡，其起始投入點數上限 |
|---|---|
| 0（未投資） | 不可獲取該陣營卡片 |
| 1 | 起始投入 0 點 |
| 2–3 | 起始投入 0–1 點 |
| 4–5 | 起始投入 0–2 點 |
| 6–7 | 起始投入 0–3 點 |
| 8–9 | 起始投入 0–4 點 |
| 10–12 | 起始投入 0–5 點 |

> **設計意圖：** 天賦鎖管獲取資格，不管強化過程。卡片進入牌組後，玩家可在 5 點配額內自由投入 XP 強化，不再受天賦等級限制。
>
> **中立卡的上限** 取調查員所有已投資陣營中最高的天賦等級。
```

**§5.2 卡片數值強化費用表整節廢除**，替換為：

```markdown
### 5.2 卡片強化費用（v1 重構）

卡片強化費用由《卡片升級系統重構 v1》定義：

- **整備期購買卡片副本**：XP 成本 = 該卡起始投入點數 × Exceptional 倍率
- **整備期購買強化菜單**：售價計算規則待後續訂定
- **強化過程不受天賦鎖限制**：卡片進入牌組後，玩家可在 5 點配額內自由投資

詳細規則見《卡片升級系統重構 v1 · Part 1》§四、§六。
```

### 7.7 規則書索引 §4 覆蓋規則

**檔案**：`packages/client/public/rulebook/規則書索引_v01_26041901.md`

**§4 第三條等級抵扣新階梯整條刪除**，因新規範下已統一為線性 1:1，不再需要覆蓋規則。

---

## 八、驗證測試清單

請 Claude Code 在實作完成後執行以下驗證：

### 8.1 資料庫層驗證

- [ ] `card_definitions.level`（或改名後欄位）的 CHECK 約束範圍 0–5
- [ ] `card_definitions.enhancement_slots` 預設值為 `[]`
- [ ] `card_definitions.card_source` CHECK 約束包含四個合法值
- [ ] `deck_cards.acquired_method` 接受新值 `purchase`
- [ ] `deck_cards.player_invested_points` 預設 0、CHECK 範圍 0–5
- [ ] 既有卡片資料的 `level` 值未被異動

### 8.2 V 值計算驗證

請 Claude Code 用以下案例測試新公式：

| 測試案例 | 預期費用 |
|---|---|
| The Red Clock（15V，起始 5，Exceptional，稀有） | 2 |
| Gold Pocket Watch（14V，起始 5，Exceptional，進階） | 2 |
| Antikythera（13V，起始 5，無 Exceptional，進階） | 3 |
| 純基本卡（6V，起始 0，標準） | 2 |
| 中階強卡（13V，起始 3，進階） | 5 |

對每個案例，呼叫 `calcBalanceInfo()` 驗證計算結果。

### 8.3 MOD-01 前端驗證

- [ ] 主表單顯示「起始投入點數」欄位（0–5）
- [ ] 主表單顯示「強化菜單」編輯區塊
- [ ] 主表單顯示「卡片來源」下拉選單
- [ ] 選擇 `book_upgrade` / `relic_upgrade` 時，相關欄位被自動鎖定
- [ ] LV0–LV5 六頁籤已從 UI 移除
- [ ] 平衡面板顯示「起始投入抵扣」（不再顯示「等級抵扣」）
- [ ] AI 生成 prompt 不再包含「LV0–LV5 各設計一份」的引導

### 8.4 後端購買驗證函式測試

請 Claude Code 為 `validateCardPurchase()` 撰寫單元測試，涵蓋：

- [ ] 嘗試購買 `book_upgrade` 卡片 → 回傳 `valid: false`
- [ ] 嘗試購買已擁有的獨特卡 → 回傳 `valid: false`
- [ ] 天賦 1 級嘗試購買起始投入 2 點的卡 → 回傳 `valid: false`
- [ ] 天賦 6 級購買起始投入 3 點的標準卡 → 回傳 `valid: true, xp_cost: 3`
- [ ] 天賦 6 級購買起始投入 3 點的 Exceptional 卡 → 回傳 `valid: true, xp_cost: 6`
- [ ] XP 不足時 → 回傳 `valid: false`

### 8.5 文件一致性驗證

- [ ] 規則書第三章 §8.5 已替換為起始投入抵扣
- [ ] 規則書第三章 §8.6 消耗類型修正已移除
- [ ] 規則書第四章 §1.1 第一條已更新
- [ ] 規則書第二章 §1.6 整備模式說明已擴大語意
- [ ] 卡片價值計算規範 v1.1 §6 已更新
- [ ] 支柱五 §2.4、§5.2 已更新
- [ ] 規則書索引 §4 第三條已刪除

---

## 九、待確認項目清單（送回 Uria）

| 項目 | 狀態 | 處理時機 |
|---|---|---|
| `level` 欄位改名方案 A/B/C | 待 Uria 決定 | 執行步驟 1 |
| Exceptional 中文卡面標籤（卓越/Exceptional/特例） | 待 Uria 決定 | 執行步驟 2 |
| 玩家強化菜單的 XP 售價推算公式 | 待 Uria 後續訂定 | 後續迭代 |
| 卡片庫的具體容器規格與 UI | 後續迭代 | 後續迭代 |
| 強化菜單上某些「特殊強化」是否走不同匯率 | 待強化菜單規則訂定後 | 後續迭代 |
| LV1–LV4 既有卡片的費用是否需重算 | 由 §6.2 流程產出清單後請 Uria 確認 | 步驟 4 後 |
| 既有 upgrades 欄位資料的拆分 / 保留決策 | 由 §6.3 流程產出清單後請 Uria 確認 | 步驟 4 後 |
| 60 天後是否真的移除 upgrades 欄位 | 階段性回顧 | 60 天後 |

---

## 十、版本紀錄

| 版本 | 日期 | 變更內容 |
|---|---|---|
| v1.0 | 2026-04-25 | 初版建立 — 執行順序、與 Uria 確認決策項、資料庫 schema 變更（level / enhancement_slots / card_source / acquired_method 擴充 / player_invested_points / enhancement_choices）、MOD-01 前端 UI 重構指令（拆除六頁籤、新增起始投入欄位、強化菜單編輯區塊）、後端購買驗證函式骨架、舊資料遷移腳本骨架、規則書七處文字替換指令、驗證測試清單 |

---

> **Part 3 到此結束。三份規範文件構成完整的卡片升級系統重構 v1 指令集，請 Claude Code 依 §一 執行順序逐項實作。**
