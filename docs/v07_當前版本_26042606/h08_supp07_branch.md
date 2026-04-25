# 核心設計原則 補充 07：分支路線與非線性敘事系統 v0.1
## Core Design Principles Supplement 07: Branching Paths & Non-Linear Narrative v0.1

> **文件用途｜Purpose**
> 本文件定義戰役的分支路線結構、章節組成、地點卡系統、ACT/Agenda 賽跑機制、
> 劇情旗標標準化用詞對照表、間章事件機制。
> 本文件是系統 D（分支路線與非線性敘事）的核心規則文件。
>
> 本文件從《核心設計原則》系統 D 展開，
> 並補充《補充 01：遊戲規則與回合結構》中關於場景結構與結果判定的機制缺口。
>
> **依賴文件：**
> - 《核心設計原則 v0.3》— 系統 D 定義、支柱 3（章節制冒險）
> - 《補充 01：遊戲規則與回合結構 v0.1》— 回合結構、長休息
> - 《資料庫結構設計 v0.1》— scenarios、story_branches、act_cards、agenda_cards、locations

---

## 一、設計哲學｜Design Philosophy

### 1.1 固定框架，動態內容

每個戰役固定十章，不因分支而增減章節數量。分支影響的是每一章「內部」的配置：

- 敵人配置與強度
- 地圖配置與地點卡
- NPC 出現與否
- 劇情文字與敘事走向
- 可獲得的資源與獎勵
- 遭遇牌堆的組成

### 1.2 設計傾向讓玩家能往下推進

過關判定不會太難。無論結果好壞，玩家都能進入下一章。不同結果影響的是後續的劇情路線和配置，而非是否能繼續遊戲。

### 1.3 ACT 與 Agenda 的賽跑

每個章節的核心張力來自兩條平行推進的軌道：

- **ACT（行動牌堆）**：調查員的目標，玩家主動推進
- **Agenda（議程牌堆）**：城主的計畫，系統自動推進

章節結束時，兩條軌道各自推進到哪裡，決定了這一章的結果分歧。

---

## 二、章節結構｜Chapter Structure

### 2.1 章節的組成

一個章節由以下元素組成：

| 元素 | 說明 |
|------|------|
| 地圖（地點卡） | 多張地點卡組成的遊玩空間 |
| ACT 牌堆 | 調查員的任務目標序列 |
| Agenda 牌堆 | 城主的倒數計時序列 |
| 遭遇牌堆 | 每回合翻開的隨機事件 |
| 章末事件（Epilogue） | 章節結束後觸發的事件（可選） |
| 章首事件（Prologue） | 下一章開始前觸發的事件（可選） |

### 2.2 章節間的完整流程

```
章節遊玩 → 結果判定（2-5 種分歧）
  ↓
章末事件（Epilogue）— 若有設定
  ↓
長休息 + 整備模式
  ↓
章首事件（Prologue）— 若有設定
  ↓
下一章節開始
```

### 2.3 章節結果判定

章節結束時，根據 ACT 進度、Agenda 進度、以及累積的劇情旗標，決定這一章的結果。

| 項目 | 規格 |
|------|------|
| 分歧數量 | 最少 2 種，最多 5 種 |
| 判定依據 | ACT 推進張數 × Agenda 推進張數 × 旗標組合 |
| 結果影響 | 下一章的版本（配置、敵人、劇情文字不同） |
| 特殊情況 | 某些旗標組合可能讓玩家跳過部分章節（敘事上「已解決」） |

---

## 三、地點卡系統｜Location Card System

### 3.1 地點卡的定位

地點卡是構成地圖的基本單元。每張地點卡代表一個可遊玩的空間，可以是一個房間、一個街區、一座城鎮、甚至一個異次元空間。

### 3.2 地點卡的尺度

地點卡的尺度決定了章節的結構和節奏：

| 尺度 | 地點卡代表 | 移動成本 |
|------|-----------|----------|
| 小 | 房間、走廊、墓穴 | 1 行動點 |
| 中 | 街區、建築物、森林區域 | 1-2 行動點 |
| 大 | 城鎮、城市區域 | 時間單位（小時） |
| 極大 | 跨城市、跨國 | 時間單位（小時/天） |

同一個章節的地圖內，所有地點卡的尺度應保持一致或相近。不會在同一張地圖上出現「房間」和「城市」混合的情況。

### 3.3 地點卡的正面與背面

| 面 | 內容 | 何時可見 |
|----|------|----------|
| 正面 | 地點名稱、基本描述、連接關係、移動成本 | 進入該地點時翻開 |
| 背面 | 隱藏資訊、隱藏線索、隱藏事件 | 滿足條件時翻開（如感知門檻、旗標條件） |

### 3.4 地點卡之間的連接

地點卡之間的連接關係定義了地圖的拓撲結構：

| 連接屬性 | 說明 |
|----------|------|
| 目標地點 | 連接到哪張地點卡 |
| 移動成本 | 行動點或時間單位 |
| 障礙類型 | 無障礙 / 需檢定 / 需鑰匙 / 單向 |
| 障礙 DC | 需檢定時的難度 |
| 條件 | 需要特定旗標才開放的連接 |

### 3.5 時間制章節

當章節使用時間作為移動成本時：

| 項目 | 規格 |
|------|------|
| 時間預算 | 章節開始時給定總時間（如 72 小時） |
| 移動消耗 | 地點卡之間的移動消耗時間而非行動點 |
| 場景內行動 | 仍使用行動點（3 點/回合），不消耗時間 |
| 時間推進 | 移動消耗時間 + 特定事件消耗時間 |
| 時間耗盡 | 等同 Agenda 跑完，觸發時限結束的後果 |

時間和行動點是兩個獨立的資源：時間管「移動於地點之間」，行動點管「在地點內做事」。

---

## 四、ACT 牌堆｜Act Deck

### 4.1 ACT 卡結構

每張 ACT 卡有正面和背面：

**正面（任務面）：**

| 欄位 | 說明 |
|------|------|
| 名稱 | ACT 卡名稱（中/英） |
| 任務描述 | 告訴玩家要做什麼 |
| 推進條件 | 需要多少線索 / 需要什麼條件才能翻面 |
| 線索是否按人數縮放 | 布林值 |

**背面（結算面）：**

| 欄位 | 說明 |
|------|------|
| 結算敘事 | 翻面後的劇情文字 |
| 結算效果 | 觸發的遊戲效果（生成敵人、改變地圖、獲得物品等） |
| 設定旗標 | 翻面時設定的劇情旗標 |
| 獎勵 | 經驗值、天賦點、物品等 |
| 指引 | 「請讀 R3」之類的敘事指引 |
| 下一張 ACT | 推進到哪張 ACT，或結束 ACT 牌堆 |

### 4.2 ACT 推進方式

| 方式 | 說明 |
|------|------|
| 線索累積 | 收集足夠線索後翻面（最常見） |
| 旗標條件 | 達成特定條件後翻面 |
| 玩家選擇 | 玩家主動決定翻面（有時提前翻面會有不同結果） |

---

## 五、Agenda 牌堆｜Agenda Deck

### 5.1 Agenda 卡結構

每張 Agenda 卡有正面和背面：

**正面（倒數面）：**

| 欄位 | 說明 |
|------|------|
| 名稱 | Agenda 卡名稱（中/英） |
| 描述 | 城主的計畫正在推進的敘事 |
| 毀滅門檻 | 累積多少毀滅標記後翻面 |

**背面（後果面）：**

| 欄位 | 說明 |
|------|------|
| 後果敘事 | 翻面後的劇情文字 |
| 後果效果 | 觸發的遊戲效果（局勢惡化、生成敵人、環境改變等） |
| 設定旗標 | 翻面時設定的劇情旗標（通常是負面的） |
| 懲罰 | 損失 HP/SAN、失去物品、NPC 死亡等 |
| 下一張 Agenda | 推進到哪張 Agenda，或結束 Agenda 牌堆 |

### 5.2 Agenda 推進方式

每回合敵人階段，自動在當前 Agenda 卡上放置 1 個毀滅標記。達到門檻時翻面結算。

特定卡片效果或場景事件也可以增加或移除毀滅標記。

---

## 六、間章事件｜Interlude Events

### 6.1 定位

間章事件是插入在章節之間的強制或條件性事件，用於推進敘事、損耗物資、設定隱藏旗標。

### 6.2 兩個插入點

| 插入點 | 代碼 | 時機 | 典型用途 |
|--------|------|------|----------|
| 章末事件 | `epilogue` | 章節結束後、長休息前 | 逃跑途中的損耗、戰後的發現、NPC 的離去 |
| 章首事件 | `prologue` | 長休息後、下一章開始前 | 旅途中的遭遇、抵達前的預兆、環境變化 |

### 6.3 間章事件的能力

間章事件可以執行以下操作：

| 操作 | 說明 |
|------|------|
| 顯示敘事文字 | 劇情演出 |
| 給予選擇 | 2-5 個選項，影響旗標 |
| 觸發檢定 | 成功/失敗有不同後果 |
| 損耗物資 | 強制移除特定類型的卡片、扣除資源 |
| 給予獎勵 | 給予卡片、資源、經驗值 |
| 設定旗標 | 設定可見或隱藏的旗標 |
| 修改混沌袋 | 加入或移除混沌袋標記 |

### 6.4 間章事件的觸發條件

間章事件不一定每次都觸發。可以設定觸發條件：

| 條件類型 | 範例 |
|----------|------|
| 無條件 | 每次都觸發 |
| 旗標條件 | 只在 `npc.warren_alive: true` 時觸發 |
| 章節結果條件 | 只在上一章結果為 "A" 時觸發 |
| 物品條件 | 只在玩家持有特定物品時觸發 |

---

## 七、劇情旗標系統｜Story Flag System

### 7.1 旗標的定位

劇情旗標是串連章節內分支和章節間分支的核心資料。所有條件判定、分支選擇、間章事件觸發，都讀取旗標來決定。

### 7.2 旗標類別對照表

| 類別代碼 | 中文 | 說明 | 值類型 | 預設可見性 |
|----------|------|------|--------|-----------|
| `act` | 行動進度 | ACT 牌堆推進狀態與結算結果 | 數字/字串 | 可見 |
| `agenda` | 議程進度 | Agenda 牌堆推進狀態與後果 | 數字/布林 | 可見 |
| `npc` | NPC 狀態 | 關鍵 NPC 的存亡與關係 | 布林/字串 | 視設計決定 |
| `item` | 物品取得 | 關鍵物品的獲取狀態 | 布林 | 可見 |
| `location` | 地點探索 | 關鍵地點的發現與狀態 | 布林/字串 | 視設計決定 |
| `choice` | 玩家選擇 | 劇情分歧點的選擇紀錄 | 字串 | 可見 |
| `outcome` | 章節結果 | 每章的最終結果代碼 | 字串 | 可見 |
| `time` | 時間狀態 | 時間制章節的時間消耗紀錄 | 數字 | 可見 |
| `hidden` | 隱藏旗標 | 玩家不可見的系統旗標 | 任意 | 永遠隱藏 |

### 7.3 旗標命名規則

```
[類別].[章節縮寫]_[描述]
```

範例：
- `act.ch1_completed` — 第一章 ACT 完成進度
- `act.ch1_solution` — 第一章 ACT 最終結算代碼
- `agenda.ch1_ritual_done` — 第一章 Agenda 儀式是否完成
- `npc.ch2_warren_alive` — 第二章 Warren 教授是否存活
- `item.ch3_necronomicon` — 第三章是否取得死靈之書
- `location.ch4_hidden_chamber` — 第四章是否發現密室
- `choice.ch5_trust_stranger` — 第五章是否信任陌生人
- `outcome.ch1` — 第一章結果（"A" / "B" / "C"）
- `time.ch6_hours_spent` — 第六章消耗的時間（小時）
- `hidden.ch2_curse_level` — 第二章隱藏的詛咒等級

### 7.4 旗標的可見性

| 可見性 | 代碼 | 說明 |
|--------|------|------|
| 可見 | `visible` | 玩家可以在戰役日誌中查看 |
| 隱藏 | `hidden` | 玩家完全看不到，只有系統讀取 |

每個旗標在設計時標註可見性。`hidden` 類別下的旗標強制為隱藏。其他類別的旗標預設可見，但可個別設為隱藏。

### 7.5 旗標的生命週期

| 範圍 | 說明 |
|------|------|
| 章節內 | 僅在當前章節有效，章節結束後清除 |
| 戰役內 | 整個戰役期間持續，直到戰役結束 |
| 永久 | 跨戰役持續（極罕見，如角色層級的永久標記） |

預設為戰役內。章節內旗標用於章節內部的分支邏輯。

### 7.6 旗標的 JSON 結構

旗標儲存在 `campaign_states.story_flags` JSONB 欄位中：

```json
{
  "act": {
    "ch1_completed": 3,
    "ch1_solution": "R3"
  },
  "agenda": {
    "ch1_reached": 2,
    "ch1_ritual_done": false
  },
  "npc": {
    "ch2_warren_alive": true,
    "ch2_warren_relation": "allied"
  },
  "item": {
    "ch3_necronomicon": true
  },
  "location": {
    "ch4_hidden_chamber": true
  },
  "choice": {
    "ch5_trust_stranger": true
  },
  "outcome": {
    "ch1": "A",
    "ch2": "B"
  },
  "time": {
    "ch6_hours_spent": 48
  },
  "hidden": {
    "ch2_curse_level": 3,
    "ch7_betrayal_count": 2
  }
}
```

### 7.7 旗標條件判定語法

分支判定時使用條件表達式讀取旗標：

| 運算子 | 說明 | 範例 |
|--------|------|------|
| `eq` | 等於 | `{"flag": "outcome.ch1", "op": "eq", "value": "A"}` |
| `neq` | 不等於 | `{"flag": "npc.ch2_warren_alive", "op": "neq", "value": true}` |
| `gt` | 大於 | `{"flag": "hidden.ch2_curse_level", "op": "gt", "value": 2}` |
| `gte` | 大於等於 | `{"flag": "act.ch1_completed", "op": "gte", "value": 3}` |
| `lt` | 小於 | `{"flag": "time.ch6_hours_spent", "op": "lt", "value": 48}` |
| `lte` | 小於等於 | 同上 |
| `exists` | 存在 | `{"flag": "item.ch3_necronomicon", "op": "exists"}` |
| `not_exists` | 不存在 | `{"flag": "item.ch3_necronomicon", "op": "not_exists"}` |

多條件組合使用 `and` / `or`：

```json
{
  "and": [
    {"flag": "outcome.ch1", "op": "eq", "value": "A"},
    {"flag": "npc.ch2_warren_alive", "op": "eq", "value": true}
  ]
}
```

```json
{
  "or": [
    {"flag": "outcome.ch3", "op": "eq", "value": "A"},
    {"flag": "outcome.ch3", "op": "eq", "value": "B"}
  ]
}
```

---

## 八、場景設計流程｜Scenario Design Workflow

### 8.1 設計一個章節的步驟

```
步驟 1：決定章節的敘事主題與尺度
  ↓ 房間級？城鎮級？跨國級？
步驟 2：設計地點卡
  ↓ 繪製地圖、標註連接關係與移動成本
步驟 3：設計 ACT 牌堆
  ↓ 玩家的目標序列、每張的推進條件與背面結算
步驟 4：設計 Agenda 牌堆
  ↓ 城主的倒數序列、每張的毀滅門檻與背面後果
步驟 5：設計遭遇牌堆
  ↓ 敵人、詭計、環境事件的組成
步驟 6：設定劇情旗標
  ↓ 哪些行為產生哪些旗標、可見性標記
步驟 7：設定章節結果分歧
  ↓ 根據旗標組合定義 2-5 種結果
步驟 8：設計間章事件（如需要）
  ↓ 章末事件和/或章首事件
步驟 9：連接到下一章
  ↓ 每種結果導向下一章的哪個版本
```

### 8.2 分支路線設計範例

**第三章的三種分歧範例：**

| 結果 | 條件 | 下一章版本 | 影響 |
|------|------|-----------|------|
| 3A | ACT 全部完成 + Agenda 未翻面 | 第四章標準版 | Warren 教授存活，提供後續線索 |
| 3B | ACT 部分完成 + Agenda 翻過 1 張 | 第四章困難版 | Warren 受傷，線索不完整 |
| 3C | ACT 未完成 + Agenda 翻過 2 張以上 | 第四章危機版 | Warren 死亡，邪教勢力壯大 |

---

## 九、對資料庫結構的補充建議｜Database Schema Supplements

### 9.1 ACT 卡補充背面欄位

```sql
-- act_cards 表需補充：
back_narrative_zh  TEXT,           -- 背面敘事文字（中文）
back_narrative_en  TEXT,           -- 背面敘事文字（英文）
back_effects       JSONB NOT NULL DEFAULT '[]',  -- 背面結算效果
set_flags          JSONB NOT NULL DEFAULT '{}',  -- 翻面時設定的旗標
rewards            JSONB NOT NULL DEFAULT '{}',  -- 獎勵（經驗值、天賦點等）
resolution_key     VARCHAR(32),    -- 結算指引代碼（如 "R3"）
```

### 9.2 Agenda 卡補充背面欄位

```sql
-- agenda_cards 表需補充：
back_narrative_zh  TEXT,           -- 背面後果敘事（中文）
back_narrative_en  TEXT,           -- 背面後果敘事（英文）
back_effects       JSONB NOT NULL DEFAULT '[]',  -- 背面後果效果
set_flags          JSONB NOT NULL DEFAULT '{}',  -- 翻面時設定的旗標
penalties          JSONB NOT NULL DEFAULT '{}',  -- 懲罰
```

### 9.3 地點卡補充欄位

```sql
-- locations 表需補充：
back_description_zh TEXT,          -- 背面描述（中文）
back_description_en TEXT,          -- 背面描述（英文）
back_effects       JSONB NOT NULL DEFAULT '[]',  -- 翻面時觸發的效果
back_reveal_condition JSONB,       -- 翻面條件（旗標、感知門檻等）
travel_cost_type   VARCHAR(16) NOT NULL DEFAULT 'action_point',
                   -- 'action_point' 或 'time'
travel_cost_time   INTEGER,        -- 時間制移動成本（分鐘/小時），travel_cost_type = 'time' 時使用
```

### 9.4 新增間章事件表

```sql
CREATE TYPE interlude_type AS ENUM (
  'epilogue',       -- 章末事件
  'prologue'        -- 章首事件
);

CREATE TABLE interlude_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id       UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  interlude_type    interlude_type NOT NULL,
  sequence          INTEGER NOT NULL DEFAULT 0,    -- 同一插入點的排序

  -- 觸發條件（NULL = 無條件觸發）
  trigger_condition JSONB,

  -- 內容
  narrative_zh      TEXT,
  narrative_en      TEXT,

  -- 選擇（NULL = 無選擇，純敘事）
  choices           JSONB,
  -- 格式: [{"key": "A", "text_zh": "...", "text_en": "...", "effects": {...}, "set_flags": {...}}]

  -- 檢定（NULL = 無檢定）
  skill_check       JSONB,
  -- 格式: {"attribute": "willpower", "dc": 12, "success_effects": {...}, "failure_effects": {...}}

  -- 效果
  effects           JSONB NOT NULL DEFAULT '[]',   -- 無條件觸發的效果
  set_flags         JSONB NOT NULL DEFAULT '{}',   -- 設定的旗標
  flag_visibility   VARCHAR(16) NOT NULL DEFAULT 'visible',
                    -- 'visible' 或 'hidden'

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interlude_scenario ON interlude_events(scenario_id);
```

### 9.5 旗標可見性欄位

`campaign_states.story_flags` 的 JSON 結構中，`hidden` 類別下的旗標自動為隱藏。其他類別的旗標可在設計時個別標記可見性，但在 `story_flags` 本身不儲存可見性（可見性由場景定義檔控制）。

---

## 十、待補充的效果關鍵字｜Pending Effect Keywords

以下效果關鍵字在本文件的設計中被需要，但尚未加入《補充 02：卡片效果語言》。待統一更新時一併處理：

| 代碼 | 中文 | 說明 | 來源 |
|------|------|------|------|
| `flip_card` | 翻面卡片 | 將指定卡片翻到背面，觸發背面效果 | 本文件（ACT/Agenda/地點卡翻面） |
| `forge_item` | 鍛造物品 | 對資產卡附加強化詞條 | 補充 06（鍛造系統） |
| `craft_item` | 製作物品 | 從配方創造新卡片 | 補充 06（製作系統） |

---

## 十一、文件版本紀錄｜Version History

| 版本 | 日期 | 變更內容 |
|------|------|----------|
| v0.1 | 2026/04/14 | 初版建立 — 章節結構定義、地點卡系統（尺度、正反面、連接、時間制）、ACT/Agenda 卡結構（正反面、推進方式）、間章事件機制（章末/章首兩個插入點）、劇情旗標系統（九大類別、命名規則、可見性、生命週期、條件判定語法）、場景設計流程、資料庫結構補充建議 |

---

> **給未來 Claude 實例的備註｜Note to Future Claude Instances**
>
> 本文件的所有設計均經過與專案原創者 Uria 的逐項討論確認。
> 特別注意以下設計精神：
>
> 1. **戰役固定十章** — 分支不會增減章節數，只影響章節內部配置。
> 2. **ACT 和 Agenda 是賽跑** — 玩家推 ACT，系統推 Agenda，兩者的進度組合決定結果。
> 3. **地點卡的尺度決定結構** — 不需要預設「線性/自由/時間制」，地點卡的設計自然決定。
> 4. **時間和行動點是獨立資源** — 時間管地點間移動，行動點管地點內行動。
> 5. **間章事件有兩個插入點** — 章末（epilogue）和章首（prologue），都可以有。
> 6. **隱藏旗標玩家完全看不到** — 用於系統內部判定，創造意料之外的劇情轉折。
> 7. **設計傾向讓玩家往下走** — 結果影響配置，不影響是否能繼續。
> 8. **旗標命名規則** — `[類別].[章節縮寫]_[描述]`，統一格式方便場景編輯器使用。
