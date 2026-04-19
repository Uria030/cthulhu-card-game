# Claude Code 指令：地點設計器 MOD-08（Part 1/2）
## Location Designer Instructions — 資料庫 + Seed Data + API

> **給 Claude Code：** 請建立地點設計器，包含前後端兩部分：
> 1. **後端 API**：在 `packages/server/src/routes/` 新增地點相關 CRUD 端點
> 2. **前端頁面**：在 `packages/client/public/admin/admin-location-designer.html` 建立介面
>
> 本模組管理「地點庫」— 可重複使用的空間積木。
> 地點設計器的產出是一個地點資料庫，關卡編輯器（MOD-07）從中挑選地點進行排列組合。
>
> **地點不做的事：**
> - 不設連接關係（由關卡編輯器決定）
> - 不設「正反面」（電子遊戲不需要模擬實體卡片）
> - 不綁定劇情旗標（旗標屬於劇情，不屬於地點）
>
> **地點要做的事：**
> - 管理單一地點的內部屬性
> - 管理多個隱藏資訊與各自的揭露條件
> - 管理地點的視覺素材（含 SVG 生成）
>
> 資料存入 PostgreSQL。所有裝置打開同一個網址就能存取同一份資料。
>
> **視覺原則：** 與 MOD-01 卡片設計器一致 — 功能優先，樸素清楚，
> 遵守 admin-shared.css 的暗黑哥德色彩系統（深色背景、金色強調色）。
>
> **本文件為 Part 1/2，涵蓋：資料庫結構 + Seed Data + 後端 API。**
> Part 2 涵蓋：頁面佈局 + 編輯邏輯 + SVG 生成功能 + Gemini Prompt。

---

# 第一部分：資料庫結構

## 1.1 既有 Schema 的調整

原 Schema v0.1 的 `locations` 表掛在 `scenarios` 底下（每個地點屬於一個場景）。
現在需要把 `locations` 從場景底下獨立出來，成為「地點庫」。

### 步驟一：備份現有 locations 資料（若有）

```sql
-- 若既有資料需要保留，先備份
CREATE TABLE locations_backup AS SELECT * FROM locations;
```

### 步驟二：重建 locations 為地點庫主表

```sql
-- 先刪除舊的 locations 表（或改名後保留供場景模組參考）
DROP TABLE IF EXISTS locations CASCADE;

CREATE TABLE locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(64) UNIQUE NOT NULL,     -- e.g. 'library_miskatonic'
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128) NOT NULL,
  description_zh  TEXT,
  description_en  TEXT,

  -- 視覺素材
  art_url         TEXT,                            -- 上傳的圖片 URL 或生成的 SVG 資料 URL
  svg_code        TEXT,                            -- SVG 原始碼（若使用生成功能）
  art_type        VARCHAR(16) NOT NULL DEFAULT 'none'
                  CHECK (art_type IN (
                    'none',           -- 無視覺素材
                    'image_url',      -- 上傳的圖片
                    'svg_generated',  -- Gemini 生成的 SVG
                    'svg_custom'      -- 手動編寫的 SVG
                  )),

  -- 尺度標籤（非必填，可自訂）
  scale_tag       VARCHAR(32),                     -- e.g. 'room', 'block', 'city', 'country' 或自訂文字

  -- 地點屬性（來自規則書第五章 §3.4）
  shroud          INTEGER NOT NULL DEFAULT 2,      -- 調查難度 DC
  clues_base      INTEGER NOT NULL DEFAULT 1,      -- 基礎線索數
  clues_per_player BOOLEAN NOT NULL DEFAULT TRUE,  -- 按人數縮放
  travel_cost     INTEGER NOT NULL DEFAULT 1,      -- 移動費用
  travel_cost_type VARCHAR(16) NOT NULL DEFAULT 'action_point'
                  CHECK (travel_cost_type IN ('action_point', 'time')),

  -- 可發現的卡片資源（指向 card_definitions）
  discoverable_card_ids UUID[] NOT NULL DEFAULT '{}',

  -- 設計備註
  design_notes    TEXT,

  -- 中繼資料
  hidden_info_count INTEGER NOT NULL DEFAULT 0,    -- 隱藏資訊數量（自動計算）
  tag_count       INTEGER NOT NULL DEFAULT 0,      -- 標籤數量（自動計算）
  usage_count     INTEGER NOT NULL DEFAULT 0,      -- 被關卡引用次數（自動計算，供關卡編輯器統計）
  sort_order      INTEGER NOT NULL DEFAULT 0,
  design_status   VARCHAR(16) NOT NULL DEFAULT 'draft'
                  CHECK (design_status IN ('draft', 'review', 'approved')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_locations_code ON locations(code);
CREATE INDEX idx_locations_scale ON locations(scale_tag);
CREATE INDEX idx_locations_status ON locations(design_status);
```

### 步驟三：更新場景運行時的地點引用

原 `scenario_play_states.location_states` 的 JSONB 格式需要調整：
關卡編輯器（MOD-07）會維護 `stage_locations` 關聯表，記錄「這關使用了哪些地點」
以及「此關卡內各地點的連接關係」。MOD-08 本模組不處理此部分，
但需在本次遷移中保留擴充空間。

## 1.2 location_hidden_info — 隱藏資訊子表

每個地點可有多個隱藏資訊，各自獨立揭露。

```sql
CREATE TABLE location_hidden_info (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id       UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  title_zh          VARCHAR(128),                     -- 隱藏資訊標題 e.g. '桌下的暗格'
  title_en          VARCHAR(128),
  description_zh    TEXT NOT NULL,                    -- 揭露後顯示的內容
  description_en    TEXT,

  -- 揭露條件類型
  reveal_condition_type VARCHAR(32) NOT NULL DEFAULT 'perception_threshold'
                    CHECK (reveal_condition_type IN (
                      'perception_threshold',  -- 感知門檻（進入地點時自動檢查）
                      'investigation_count',   -- 調查成功累積次數
                      'manual',                -- 手動揭露（關卡編輯器指定觸發條件）
                      'none'                   -- 無條件揭露（只要進入地點就顯示）
                    )),

  -- 條件參數（依類型不同）
  reveal_condition_params JSONB NOT NULL DEFAULT '{}',
  -- perception_threshold: { "threshold": 4 }
  -- investigation_count: { "count": 2 }
  -- manual: {}（關卡編輯器會追加條件覆蓋）
  -- none: {}

  -- 揭露後獎勵類型
  reward_type       VARCHAR(32) NOT NULL DEFAULT 'narrative_only'
                    CHECK (reward_type IN (
                      'narrative_only',   -- 純敘事，無機制效果
                      'clue',             -- 給予線索
                      'card',             -- 給予卡片
                      'effect'            -- 觸發其他效果
                    )),

  -- 獎勵參數（依類型不同）
  reward_params     JSONB NOT NULL DEFAULT '{}',
  -- clue: { "amount": 1 }
  -- card: { "card_def_id": "uuid" }
  -- effect: { "description": "自由文字描述" }

  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hidden_info_location ON location_hidden_info(location_id);
```

## 1.3 location_style_tags — 風格標籤主表

管理員可自訂新增的風格標籤庫。

```sql
CREATE TABLE location_style_tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(64) UNIQUE NOT NULL,      -- e.g. 'indoor_mansion'
  name_zh         VARCHAR(64) NOT NULL,              -- e.g. '宅邸'
  name_en         VARCHAR(64) NOT NULL,              -- e.g. 'Mansion'
  category        VARCHAR(16) NOT NULL DEFAULT 'custom'
                  CHECK (category IN (
                    'indoor',   -- 室內類
                    'outdoor',  -- 室外類
                    'special',  -- 特殊類
                    'custom'    -- 使用者自訂
                  )),
  description     TEXT,
  usage_count     INTEGER NOT NULL DEFAULT 0,        -- 被幾個地點使用（自動計算）
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_style_tags_category ON location_style_tags(category);
```

## 1.4 location_tag_map — 地點與標籤的多對多關聯

```sql
CREATE TABLE location_tag_map (
  location_id     UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  tag_id          UUID NOT NULL REFERENCES location_style_tags(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (location_id, tag_id)
);

CREATE INDEX idx_tag_map_location ON location_tag_map(location_id);
CREATE INDEX idx_tag_map_tag ON location_tag_map(tag_id);
```

## 1.5 admin-shared.js 新增常數

```javascript
// 尺度標籤預設選項（非必填，可自訂）
const LOCATION_SCALES = {
  room:    { name_zh: '房間級', name_en: 'Room',    example: '宅邸的各個房間' },
  block:   { name_zh: '街區級', name_en: 'Block',   example: '城鎮的各個區域' },
  city:    { name_zh: '城市級', name_en: 'City',    example: '不同城鎮之間' },
  country: { name_zh: '跨國級', name_en: 'Country', example: '不同國家之間' },
};

// 移動費用類型
const TRAVEL_COST_TYPES = {
  action_point: { name_zh: '行動點', name_en: 'Action Point', note: '地點內行動' },
  time:         { name_zh: '時間',   name_en: 'Time',         note: '大尺度場景的地點間移動' },
};

// 視覺素材類型
const LOCATION_ART_TYPES = {
  none:          { name_zh: '無視覺素材',     name_en: 'None' },
  image_url:     { name_zh: '上傳圖片',       name_en: 'Uploaded Image' },
  svg_generated: { name_zh: 'AI 生成 SVG',   name_en: 'AI Generated SVG' },
  svg_custom:    { name_zh: '自訂 SVG',      name_en: 'Custom SVG' },
};

// 隱藏資訊揭露條件類型
const REVEAL_CONDITION_TYPES = {
  perception_threshold: { name_zh: '感知門檻',     name_en: 'Perception Threshold', note: '進入地點時自動檢查' },
  investigation_count:  { name_zh: '調查次數',     name_en: 'Investigation Count',  note: '累積調查成功 N 次' },
  manual:               { name_zh: '手動揭露',     name_en: 'Manual',               note: '關卡編輯器指定觸發條件' },
  none:                 { name_zh: '無條件',       name_en: 'None',                 note: '進入地點即顯示' },
};

// 隱藏資訊獎勵類型
const REVEAL_REWARD_TYPES = {
  narrative_only: { name_zh: '純敘事', name_en: 'Narrative Only', note: '無機制效果' },
  clue:           { name_zh: '線索',   name_en: 'Clue',           note: '給予線索' },
  card:           { name_zh: '卡片',   name_en: 'Card',           note: '給予特定卡片' },
  effect:         { name_zh: '效果',   name_en: 'Effect',         note: '觸發其他效果' },
};
```

---

# 第二部分：Seed Data

## 2.1 風格標籤預設清單

建立資料表後，灌入以下預設標籤。管理員可在設計器中新增更多。

```sql
-- 室內類（9 個）
INSERT INTO location_style_tags (code, name_zh, name_en, category, sort_order) VALUES
  ('indoor_mansion',    '宅邸',     'Mansion',         'indoor', 1),
  ('indoor_library',    '圖書館',   'Library',         'indoor', 2),
  ('indoor_lab',        '實驗室',   'Laboratory',      'indoor', 3),
  ('indoor_church',     '教堂',     'Church',          'indoor', 4),
  ('indoor_tavern',     '酒館',     'Tavern',          'indoor', 5),
  ('indoor_theater',    '劇院',     'Theater',         'indoor', 6),
  ('indoor_basement',   '地下室',   'Basement',        'indoor', 7),
  ('indoor_hospital',   '醫院',     'Hospital',        'indoor', 8),
  ('indoor_museum',     '博物館',   'Museum',          'indoor', 9);

-- 室外類（8 個）
INSERT INTO location_style_tags (code, name_zh, name_en, category, sort_order) VALUES
  ('outdoor_street',    '街道',     'Street',          'outdoor', 10),
  ('outdoor_forest',    '森林',     'Forest',          'outdoor', 11),
  ('outdoor_seaside',   '海邊',     'Seaside',         'outdoor', 12),
  ('outdoor_graveyard', '墓地',     'Graveyard',       'outdoor', 13),
  ('outdoor_farmland',  '農田',     'Farmland',        'outdoor', 14),
  ('outdoor_mountain',  '山區',     'Mountain',        'outdoor', 15),
  ('outdoor_harbor',    '港口',     'Harbor',          'outdoor', 16),
  ('outdoor_pier',      '碼頭',     'Pier',            'outdoor', 17);

-- 特殊類（6 個）
INSERT INTO location_style_tags (code, name_zh, name_en, category, sort_order) VALUES
  ('special_gate',      '次元門',   'Dimensional Gate', 'special', 18),
  ('special_ritual',    '儀式場',   'Ritual Site',      'special', 19),
  ('special_dreamland', '幻夢境',   'Dreamland',        'special', 20),
  ('special_ruins',     '遺跡',     'Ruins',            'special', 21),
  ('special_ship',      '船上',     'Ship',             'special', 22),
  ('special_dream',     '夢境',     'Dream',            'special', 23);
```

## 2.2 地點範例 Seed Data（測試用）

建立三個範例地點供管理員參考設計方向。**這些範例可在生產環境刪除。**

```sql
-- 範例一：密斯卡塔尼克大學圖書館
INSERT INTO locations (code, name_zh, name_en, description_zh,
  scale_tag, shroud, clues_base, clues_per_player,
  travel_cost, travel_cost_type, art_type, design_status)
VALUES (
  'miskatonic_library', '密斯卡塔尼克大學圖書館', 'Miskatonic University Library',
  '阿卡姆最古老的學術機構，藏有無數禁忌典籍。圖書館的深處據說有只有少數人知道的秘密書庫。',
  'room', 3, 2, TRUE,
  1, 'action_point', 'none', 'draft'
);

-- 為該地點附加風格標籤
INSERT INTO location_tag_map (location_id, tag_id)
SELECT
  (SELECT id FROM locations WHERE code = 'miskatonic_library'),
  id FROM location_style_tags WHERE code IN ('indoor_library', 'indoor_mansion');

-- 為該地點附加一個隱藏資訊
INSERT INTO location_hidden_info (location_id, title_zh, description_zh,
  reveal_condition_type, reveal_condition_params, reward_type, reward_params)
VALUES (
  (SELECT id FROM locations WHERE code = 'miskatonic_library'),
  '禁書區的暗門',
  '你在書架最深處發現一塊與周圍不同的磚石。輕輕按下，一道暗門緩緩開啟，露出通往地下的石階。',
  'perception_threshold', '{"threshold": 4}',
  'clue', '{"amount": 2}'
);

-- 範例二：印斯茅斯碼頭
INSERT INTO locations (code, name_zh, name_en, description_zh,
  scale_tag, shroud, clues_base, clues_per_player,
  travel_cost, travel_cost_type, art_type, design_status)
VALUES (
  'innsmouth_pier', '印斯茅斯碼頭', 'Innsmouth Pier',
  '腐朽的木板在海風中發出呻吟。遠處的礁石上，隱約可見類人生物的輪廓在月光下移動。',
  'block', 2, 1, TRUE,
  1, 'action_point', 'none', 'draft'
);

INSERT INTO location_tag_map (location_id, tag_id)
SELECT
  (SELECT id FROM locations WHERE code = 'innsmouth_pier'),
  id FROM location_style_tags WHERE code IN ('outdoor_pier', 'outdoor_seaside', 'outdoor_harbor');

INSERT INTO location_hidden_info (location_id, title_zh, description_zh,
  reveal_condition_type, reveal_condition_params, reward_type, reward_params)
VALUES (
  (SELECT id FROM locations WHERE code = 'innsmouth_pier'),
  '漂流瓶中的紙條',
  '你在礁石縫隙中發現一個發黃的漂流瓶，裡面是一張用血跡斑斑的字跡寫成的求救信。',
  'investigation_count', '{"count": 2}',
  'card', '{"card_def_id": null}'
);

-- 範例三：阿卡姆市中心（城市級示範）
INSERT INTO locations (code, name_zh, name_en, description_zh,
  scale_tag, shroud, clues_base, clues_per_player,
  travel_cost, travel_cost_type, art_type, design_status)
VALUES (
  'arkham_downtown', '阿卡姆市中心', 'Arkham Downtown',
  '麻州東北部最古老的城鎮，充斥著殖民時期的老建築與現代文明的奇異混合。',
  'city', 2, 1, FALSE,
  1, 'time', 'none', 'draft'
);

INSERT INTO location_tag_map (location_id, tag_id)
SELECT
  (SELECT id FROM locations WHERE code = 'arkham_downtown'),
  id FROM location_style_tags WHERE code = 'outdoor_street';
```

---

# 第三部分：後端 API

在 `packages/server/src/routes/` 新增以下端點。
所有端點前綴：`/api/admin/locations`

## 3.1 地點 CRUD

| 方法 | 路徑 | 功能 |
|------|------|------|
| GET | `/` | 列出所有地點（支援多條件篩選） |
| GET | `/:id` | 取得單一地點完整資料（含隱藏資訊、標籤） |
| POST | `/` | 新增地點 |
| PUT | `/:id` | 更新地點基本資訊 |
| DELETE | `/:id` | 刪除地點（連同隱藏資訊、標籤關聯） |
| POST | `/:id/duplicate` | 複製地點 |

### GET / 查詢參數

| 參數 | 類型 | 說明 |
|------|------|------|
| `scale_tag` | string | 按尺度篩選 |
| `style_tag_code` | string | 按風格標籤篩選（可多值） |
| `design_status` | string | 按設計狀態篩選 |
| `search` | string | 名稱/描述關鍵字搜尋 |

### GET /:id 回傳格式

```json
{
  "location": {
    "id": "uuid",
    "code": "miskatonic_library",
    "name_zh": "密斯卡塔尼克大學圖書館",
    "name_en": "Miskatonic University Library",
    "description_zh": "...",
    "description_en": null,
    "art_url": null,
    "svg_code": null,
    "art_type": "none",
    "scale_tag": "room",
    "shroud": 3,
    "clues_base": 2,
    "clues_per_player": true,
    "travel_cost": 1,
    "travel_cost_type": "action_point",
    "discoverable_card_ids": [],
    "design_notes": null,
    "design_status": "draft",
    "hidden_info_count": 1,
    "tag_count": 2,
    "usage_count": 0,
    "tags": [
      {
        "id": "uuid",
        "code": "indoor_library",
        "name_zh": "圖書館",
        "category": "indoor"
      },
      {
        "id": "uuid",
        "code": "indoor_mansion",
        "name_zh": "宅邸",
        "category": "indoor"
      }
    ],
    "hidden_info": [
      {
        "id": "uuid",
        "title_zh": "禁書區的暗門",
        "description_zh": "...",
        "reveal_condition_type": "perception_threshold",
        "reveal_condition_params": { "threshold": 4 },
        "reward_type": "clue",
        "reward_params": { "amount": 2 },
        "sort_order": 0
      }
    ]
  }
}
```

## 3.2 隱藏資訊管理 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| POST | `/:id/hidden-info` | 為地點新增隱藏資訊 |
| PUT | `/hidden-info/:info_id` | 更新隱藏資訊 |
| DELETE | `/hidden-info/:info_id` | 刪除隱藏資訊 |
| PUT | `/:id/hidden-info/reorder` | 批次調整隱藏資訊排序 |

## 3.3 風格標籤管理 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| GET | `/tags` | 列出所有風格標籤（按分類分組） |
| POST | `/tags` | 新增自訂標籤 |
| PUT | `/tags/:tag_id` | 更新標籤（名稱、描述） |
| DELETE | `/tags/:tag_id` | 刪除標籤（若有地點使用則拒絕） |
| PUT | `/:id/tags` | 批次設定地點的標籤（整組覆寫） |

### GET /tags 回傳格式

```json
{
  "tags": {
    "indoor": [ {...}, {...} ],
    "outdoor": [ {...}, {...} ],
    "special": [ {...} ],
    "custom": [ {...} ]
  },
  "total": 23
}
```

### DELETE /tags/:tag_id 行為

若有地點正在使用此標籤，回傳 409 Conflict：

```json
{
  "error": "tag_in_use",
  "message": "此標籤被 5 個地點使用，請先移除這些地點的標籤再刪除。",
  "usage_count": 5,
  "using_locations": [
    { "id": "uuid", "name_zh": "..." }
  ]
}
```

## 3.4 SVG 生成 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| POST | `/:id/ai/generate-svg` | 呼叫 Gemini 生成 SVG 俯視圖 |
| PUT | `/:id/svg` | 直接儲存 SVG 程式碼（手動編寫或生成後的修改） |

### POST /:id/ai/generate-svg 請求格式

```json
{
  "prompt": "圖書館，有大量書架、一張書桌、一個壁爐",
  "scale": "room",
  "style": "sketch"
}
```

回傳格式：

```json
{
  "svg_code": "<svg viewBox=\"0 0 600 400\">...</svg>",
  "generation_note": "Gemini 回傳的生成備註"
}
```

後端會呼叫 Gemini API（詳細 Prompt 見 Part 2 §9），解析回應後回傳 SVG 程式碼。
**不自動儲存** — 前端顯示給設計師確認後，由設計師按「儲存」才寫入資料庫。

## 3.5 統計 API

| 方法 | 路徑 | 功能 |
|------|------|------|
| GET | `/stats/overview` | 全域統計 |

### GET /stats/overview 回傳格式

```json
{
  "total_locations": 3,
  "by_status": {
    "draft": 3,
    "review": 0,
    "approved": 0
  },
  "by_scale": {
    "room": 1,
    "block": 1,
    "city": 1,
    "country": 0,
    "unset": 0
  },
  "by_tag_category": {
    "indoor": 2,
    "outdoor": 3,
    "special": 0,
    "custom": 0
  },
  "total_tags": 23,
  "total_hidden_info": 2,
  "locations_without_art": 3,
  "locations_without_hidden_info": 1
}
```

## 3.6 後端驗證規則

1. **Code 唯一性**：所有地點 code 全域唯一
2. **標籤至少一個分類**：地點至少要有一個風格標籤（建立時可暫時為空，但 `design_status` 改為 `review` 或 `approved` 時強制檢查）
3. **隱藏資訊揭露條件參數驗證**：
   - `perception_threshold`: 必須含 `threshold` 且為 1–10 整數
   - `investigation_count`: 必須含 `count` 且為 1–10 整數
4. **刪除警告**：刪除被關卡引用的地點時（`usage_count > 0`），回傳警告而非直接刪除

---

> **Part 1 結束。**
> Part 2 將涵蓋：頁面佈局 + 編輯邏輯 + SVG 生成功能 + Gemini Prompt 完整設計。
