# MOD-07 關卡編輯器 · Claude Code 指令 Part 1:資料庫與後端基礎

> **系列**:MOD-07 實作指令 · 第 1 份 / 共 5 份
> **依據規格**:`MOD07_關卡編輯器_總覽規格_v0_2.md`
> **前置條件**:MOD-06 完成、MIGRATION_017 已跑過
> **本份產出**:MIGRATION_018 資料庫遷移、後端 routes、跨模組校驗 helper、重返版合併邏輯
> **執行角色**:Claude Code 依此文件實作檔案變更

---

## 一、任務範圍

本份指令要完成 MOD-07 關卡編輯器的**資料層與後端 API 層**。實作後應達到的狀態:

- 新增九張資料表與索引
- 完整 CRUD API:關卡、場景、目標牌堆、議案牌堆、遭遇卡池、神話卡池、混沌袋、怪物家族池、隨機地城產生器
- 跨模組校驗 helper(引用 MOD-06 旗標、MOD-08 地點、MOD-03 家族、MOD-10 神話/遭遇卡)
- 重返版 `return_overrides` 合併邏輯(`GET /api/stages/:id/resolved`)
- 註冊 route plugin 到 `app.ts`

本份**不**包含:前端、AI 整合、種子資料、完整性檢查演算法、隨機地城生成演算法(後續四份處理)。

---

## 二、資料庫遷移(MIGRATION_018)

### 2.1 位置與命名

在 `packages/server/src/db/migrate.ts` 的 `MIGRATION_017` 之後追加 `MIGRATION_018`。沿用現有模式。

### 2.2 建立九張資料表

依外鍵依賴順序建立。

**表 1:`stages`(關卡)**

```sql
CREATE TABLE IF NOT EXISTS stages (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id             UUID REFERENCES chapters(id) ON DELETE CASCADE,
  code                   VARCHAR(64) NOT NULL UNIQUE,
  name_zh                VARCHAR(128) NOT NULL,
  name_en                VARCHAR(128) NOT NULL DEFAULT '',
  stage_type             VARCHAR(16) NOT NULL
                         CHECK (stage_type IN ('main','side','side_return','side_random')),
  narrative              TEXT NOT NULL DEFAULT '',
  entry_condition        JSONB,
  completion_flags       JSONB NOT NULL DEFAULT '[]'::jsonb,
  scaling_rules          JSONB NOT NULL DEFAULT '{}'::jsonb,
  return_parent_id       UUID REFERENCES stages(id) ON DELETE SET NULL,
  return_overrides       JSONB NOT NULL DEFAULT '{}'::jsonb,
  return_stage_number    INTEGER,
  side_signature_card_id UUID,
  design_status          VARCHAR(16) NOT NULL DEFAULT 'draft'
                         CHECK (design_status IN ('draft','review','published')),
  version                INTEGER NOT NULL DEFAULT 1,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stages_chapter ON stages(chapter_id);
CREATE INDEX IF NOT EXISTS idx_stages_type ON stages(stage_type);
CREATE INDEX IF NOT EXISTS idx_stages_return_parent ON stages(return_parent_id);
```

**約束**:
- `chapter_id` 僅在 `stage_type = 'main'` 時必須非 NULL(應用層校驗)
- `stage_type = 'side'` 時 `completion_flags` 必須為空陣列(應用層校驗)
- `stage_type = 'side_return'` 時 `return_parent_id` 必須非 NULL(應用層校驗)

**表 2:`scenarios`(場景)**

```sql
CREATE TABLE IF NOT EXISTS scenarios (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id                     UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  scenario_order               INTEGER NOT NULL,
  name_zh                      VARCHAR(128) NOT NULL DEFAULT '',
  name_en                      VARCHAR(128) NOT NULL DEFAULT '',
  narrative                    TEXT NOT NULL DEFAULT '',
  initial_location_codes       VARCHAR(64)[] NOT NULL DEFAULT '{}',
  initial_connections          JSONB NOT NULL DEFAULT '[]'::jsonb,
  investigator_spawn_location  VARCHAR(64),
  initial_environment          JSONB NOT NULL DEFAULT '{}'::jsonb,
  initial_enemies              JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stage_id, scenario_order)
);

CREATE INDEX IF NOT EXISTS idx_scenarios_stage ON scenarios(stage_id);
```

**表 3:`stage_act_cards`(目標牌堆)**

```sql
CREATE TABLE IF NOT EXISTS stage_act_cards (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id                 UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  card_order               INTEGER NOT NULL,
  name_zh                  VARCHAR(128) NOT NULL DEFAULT '',
  name_en                  VARCHAR(128) NOT NULL DEFAULT '',
  front_narrative          TEXT NOT NULL DEFAULT '',
  front_objective_types    VARCHAR(32)[] NOT NULL DEFAULT '{}',
  front_advance_condition  JSONB NOT NULL DEFAULT '{}'::jsonb,
  front_scaling            JSONB NOT NULL DEFAULT '{}'::jsonb,
  back_narrative           TEXT NOT NULL DEFAULT '',
  back_flag_sets           JSONB NOT NULL DEFAULT '[]'::jsonb,
  back_rewards             JSONB NOT NULL DEFAULT '{}'::jsonb,
  back_map_operations      JSONB NOT NULL DEFAULT '[]'::jsonb,
  back_resolution_code     VARCHAR(64),
  UNIQUE (stage_id, card_order)
);

CREATE INDEX IF NOT EXISTS idx_act_cards_stage ON stage_act_cards(stage_id);
```

**表 4:`stage_agenda_cards`(議案牌堆)**

```sql
CREATE TABLE IF NOT EXISTS stage_agenda_cards (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id               UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  card_order             INTEGER NOT NULL,
  name_zh                VARCHAR(128) NOT NULL DEFAULT '',
  name_en                VARCHAR(128) NOT NULL DEFAULT '',
  front_narrative        TEXT NOT NULL DEFAULT '',
  front_doom_threshold   INTEGER NOT NULL DEFAULT 3,
  back_narrative         TEXT NOT NULL DEFAULT '',
  back_flag_sets         JSONB NOT NULL DEFAULT '[]'::jsonb,
  back_penalties         JSONB NOT NULL DEFAULT '[]'::jsonb,
  back_map_operations    JSONB NOT NULL DEFAULT '[]'::jsonb,
  back_resolution_code   VARCHAR(64),
  UNIQUE (stage_id, card_order)
);

CREATE INDEX IF NOT EXISTS idx_agenda_cards_stage ON stage_agenda_cards(stage_id);
```

**表 5:`stage_encounter_pool`(遭遇卡池引用)**

```sql
CREATE TABLE IF NOT EXISTS stage_encounter_pool (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id            UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  encounter_card_id   UUID NOT NULL,
  weight              INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0),
  UNIQUE (stage_id, encounter_card_id)
);

CREATE INDEX IF NOT EXISTS idx_encounter_pool_stage ON stage_encounter_pool(stage_id);
```

> **註**:`encounter_card_id` 引用 `encounter_cards`(MOD-10)。MOD-10 已建立此表(MIGRATION_012)。此處**不設** FK 約束,改由應用層校驗,避免跨模組刪除的連動複雜化。

**表 6:`stage_mythos_pool`(神話卡池引用)**

```sql
CREATE TABLE IF NOT EXISTS stage_mythos_pool (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id         UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  mythos_card_id   UUID NOT NULL,
  weight           INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0),
  UNIQUE (stage_id, mythos_card_id)
);

CREATE INDEX IF NOT EXISTS idx_mythos_pool_stage ON stage_mythos_pool(stage_id);
```

**表 7:`stage_chaos_bag`(關卡混沌袋配置)**

```sql
CREATE TABLE IF NOT EXISTS stage_chaos_bag (
  stage_id             UUID PRIMARY KEY REFERENCES stages(id) ON DELETE CASCADE,
  difficulty_preset    VARCHAR(16) NOT NULL DEFAULT 'standard'
                       CHECK (difficulty_preset IN ('easy','standard','hard','expert')),
  number_markers       JSONB NOT NULL DEFAULT '{}'::jsonb,
  scenario_markers     JSONB NOT NULL DEFAULT '{}'::jsonb,
  mythos_markers       JSONB NOT NULL DEFAULT '{}'::jsonb,
  dynamic_markers      JSONB NOT NULL DEFAULT '{"bless":0,"curse":0}'::jsonb
);
```

**表 8:`stage_monster_pool`(怪物家族池)**

```sql
CREATE TABLE IF NOT EXISTS stage_monster_pool (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id           UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  family_code        VARCHAR(32) NOT NULL,
  role               VARCHAR(16) NOT NULL
                     CHECK (role IN ('primary','secondary')),
  allowed_tiers      VARCHAR(16)[] NOT NULL DEFAULT '{}',
  fixed_boss_ids     UUID[] NOT NULL DEFAULT '{}',
  UNIQUE (stage_id, family_code)
);

CREATE INDEX IF NOT EXISTS idx_monster_pool_stage ON stage_monster_pool(stage_id);
```

**表 9:`random_dungeon_generators`(隨機地城產生器)**

```sql
CREATE TABLE IF NOT EXISTS random_dungeon_generators (
  stage_id              UUID PRIMARY KEY REFERENCES stages(id) ON DELETE CASCADE,
  location_pool         JSONB NOT NULL DEFAULT '[]'::jsonb,
  topology_rules        JSONB NOT NULL DEFAULT '{}'::jsonb,
  act_template_pool     JSONB NOT NULL DEFAULT '{}'::jsonb,
  agenda_template_pool  JSONB NOT NULL DEFAULT '{}'::jsonb,
  monster_rules         JSONB NOT NULL DEFAULT '{}'::jsonb,
  chaos_bag_rules       JSONB NOT NULL DEFAULT '{}'::jsonb,
  mythos_pool_rules     JSONB NOT NULL DEFAULT '{}'::jsonb,
  encounter_pool_rules  JSONB NOT NULL DEFAULT '{}'::jsonb,
  victory_conditions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  reward_rules          JSONB NOT NULL DEFAULT '{}'::jsonb,
  seed_verified_at      TIMESTAMPTZ
);
```

### 2.3 `runMigrations()` 調整

在 `runMigrations()` 尾端追加 `await runMigration018(client)`。

---

## 三、後端路由檔案

### 3.1 檔案位置

建立新檔:`packages/server/src/routes/stages.ts`

### 3.2 檔案開頭結構

```typescript
import { FastifyInstance } from 'fastify';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import {
  validateStageReferences,
  resolveReturnStage
} from '../utils/stage-validators';

export async function stageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // 路由實作如下節所述
}
```

### 3.3 關卡核心路由

**`GET /api/stages`**
關卡列表。支援 query:
- `chapter_id`:篩選章節
- `stage_type`:篩選類型
- `status`:篩選設計狀態
- `search`:名稱/代碼模糊搜尋

回傳欄位:基礎欄位 + `scenario_count`、`act_card_count`、`agenda_card_count`、`chapter_name`(join chapters)。

**`GET /api/stages/:id`**
單一關卡完整資料,包含:
- 關卡基本欄位(若為 `side_return`,**不**自動合併 overrides;取得原始覆寫結構供編輯)
- `scenarios` 陣列(依 `scenario_order`)
- `act_cards` / `agenda_cards` 陣列
- `encounter_pool` / `mythos_pool` 陣列(附上從 MOD-10 join 的卡名預覽)
- `chaos_bag` 物件
- `monster_pool` 陣列
- `random_generator` 物件(若為 `side_random`)

**`GET /api/stages/:id/resolved`**
單一關卡**合併後**的完整資料(給執行期使用,也給前端預覽用)。若關卡為 `side_return`,則套用 `return_overrides` 後回傳。詳見 §5。

**`GET /api/stages/by-chapter/:chapter_id`**
某章節的所有關卡。

**`POST /api/stages`**
建立關卡。請求體:
- `code`、`name_zh`、`stage_type` 必填
- 依 `stage_type` 校驗 `chapter_id` / `completion_flags` / `return_parent_id` 規則(見 §2.2)
- 建立時在同一交易內:
  - 插入 `stages` 主紀錄
  - 插入一筆預設 `stage_chaos_bag`(依 `scaling_rules.difficulty_preset` 或 `standard`)
  - 若為 `side_random`,插入一筆空 `random_dungeon_generators`

**`PUT /api/stages/:id`**
更新關卡。可更新所有欄位,除 `code`、`stage_type`(建立後不可改)。每次 `version += 1`,`updated_at = NOW()`。

**`DELETE /api/stages/:id`**
刪除關卡。**校驗**:若此關卡是某 `side_return` 的 `return_parent_id`,拒絕刪除並列出依賴的重返版。

### 3.4 場景路由

**`GET /api/stages/:stageId/scenarios`**
該關卡所有場景,依 `scenario_order`。

**`POST /api/stages/:stageId/scenarios`**
新增場景。`scenario_order` 若未提供則自動為 `max(current) + 1`。

**`PUT /api/scenarios/:id`**
更新場景。

**`DELETE /api/scenarios/:id`**
刪除場景。若刪除 `scenario_order = 1` 的起始場景,拒絕(每關至少需要一個起始場景)。

**`POST /api/scenarios/:id/reorder`**
調整場景順序。請求體:`{ new_order: number }`。若與既有衝突,整個關卡的 `scenario_order` 重新排序。

### 3.5 目標牌堆路由

**`GET /api/stages/:stageId/act-cards`**
該關卡所有目標卡,依 `card_order`。

**`POST /api/stages/:stageId/act-cards`**
新增目標卡。`card_order` 自動為 `max + 1`。

**`PUT /api/act-cards/:id`**
更新目標卡。**校驗**:
- `back_flag_sets` 中的旗標代碼必須在戰役字典中存在(若 `stage_type = 'main'` 才校驗;支線應為空)
- `back_map_operations` 中引用的地點代碼、怪物家族代碼存在

**`DELETE /api/act-cards/:id`**
刪除。

**`POST /api/act-cards/:id/reorder`**
調整順序。

### 3.6 議案牌堆路由

結構與目標牌堆對稱。

**`GET /api/stages/:stageId/agenda-cards`**
**`POST /api/stages/:stageId/agenda-cards`**
**`PUT /api/agenda-cards/:id`**
**`DELETE /api/agenda-cards/:id`**
**`POST /api/agenda-cards/:id/reorder`**

### 3.7 遭遇卡池路由

**`GET /api/stages/:stageId/encounter-pool`**
該關卡引用的遭遇卡清單。每筆 join MOD-10 的 `encounter_cards` 取得 `name_zh`、`encounter_type`。

**`POST /api/stages/:stageId/encounter-pool`**
加入遭遇卡到池中。請求體:`{ encounter_card_id, weight }`。**校驗** `encounter_card_id` 在 MOD-10 存在。

**`PUT /api/encounter-pool/:id`**
調整權重。

**`DELETE /api/encounter-pool/:id`**
從池中移除。

### 3.8 神話卡池路由

結構對稱遭遇卡池。

**`GET /api/stages/:stageId/mythos-pool`**
**`POST /api/stages/:stageId/mythos-pool`**
**`PUT /api/mythos-pool/:id`**
**`DELETE /api/mythos-pool/:id`**

### 3.9 混沌袋路由

**`GET /api/stages/:stageId/chaos-bag`**
該關卡的混沌袋配置。若尚未建立(理論上建立關卡時已自動建立),回傳預設物件。

**`PUT /api/stages/:stageId/chaos-bag`**
整筆覆寫混沌袋配置(UPSERT 語意,用 `INSERT ... ON CONFLICT (stage_id) DO UPDATE`)。

### 3.10 怪物家族池路由

**`GET /api/stages/:stageId/monster-pool`**
**`POST /api/stages/:stageId/monster-pool`**
**`PUT /api/monster-pool/:id`**
**`DELETE /api/monster-pool/:id`**

**校驗**:
- `family_code` 在 `monster_families`(MOD-03)存在
- `allowed_tiers` 內的位階代碼合法(`minion`, `threat`, `elite`, `boss`, `titan`)
- `fixed_boss_ids` 中的 ID 在 `monster_variants`(MOD-03)存在

### 3.11 隨機地城產生器路由

**`GET /api/stages/:stageId/random-generator`**
該隨機地城的產生器配置。僅 `stage_type = 'side_random'` 有效。

**`PUT /api/stages/:stageId/random-generator`**
整筆覆寫產生器配置。

**`POST /api/stages/:stageId/random-generator/generate`**
執行產生器(傳入 `seed` 參數),回傳一份預覽用的關卡配置(**此端點在 Part 5 實作具體演算法**,本份先建立路由骨架回傳 `501 Not Implemented`)。

### 3.12 匯出路由

**`GET /api/stages/:id/export`**
匯出單一關卡的完整 JSON(含所有子表)。

---

## 四、跨模組校驗 helper

### 4.1 檔案位置

建立新檔:`packages/server/src/utils/stage-validators.ts`

### 4.2 函式清單

```typescript
import { pool } from '../db/pool';
import { PoolClient } from 'pg';

// 校驗關卡儲存時的所有外部引用
export async function validateStageReferences(
  stageData: any,
  client?: PoolClient
): Promise<{
  valid: boolean;
  missing: {
    flags: string[];
    locations: string[];
    families: string[];
    boss_ids: string[];
    mythos_cards: string[];
    encounter_cards: string[];
  };
}> {
  // 1. 收集所有引用的代碼
  // 2. 並行查詢各表確認存在
  // 3. 回傳缺漏清單
}

// 校驗單一地點代碼
export async function validateLocationCodes(
  codes: string[],
  client?: PoolClient
): Promise<{ valid: boolean; missing: string[] }> {
  // SELECT code FROM locations WHERE code = ANY($1)
}

// 校驗怪物家族代碼
export async function validateMonsterFamilyCodes(
  codes: string[],
  client?: PoolClient
): Promise<{ valid: boolean; missing: string[] }>;

// 校驗怪物變體 ID(用於 fixed_boss_ids)
export async function validateMonsterVariantIds(
  ids: string[],
  client?: PoolClient
): Promise<{ valid: boolean; missing: string[] }>;

// 校驗神話卡 ID
export async function validateMythosCardIds(
  ids: string[],
  client?: PoolClient
): Promise<{ valid: boolean; missing: string[] }>;

// 校驗遭遇卡 ID
export async function validateEncounterCardIds(
  ids: string[],
  client?: PoolClient
): Promise<{ valid: boolean; missing: string[] }>;

// 校驗旗標代碼(依戰役 ID)
// 透過 stage.chapter_id → chapter.campaign_id 查詢
export async function validateStageFlagCodes(
  stageId: string,
  flagCodes: string[],
  client?: PoolClient
): Promise<{ valid: boolean; missing: string[] }>;
```

### 4.3 地圖操作指令中的代碼抽取

```typescript
// 從地圖操作指令清單中抽出所有引用的代碼
export function extractReferencedCodes(
  operations: any[]
): {
  locations: string[];
  families: string[];
  flags: string[];
} {
  const locations = new Set<string>();
  const families = new Set<string>();
  const flags = new Set<string>();

  for (const op of operations || []) {
    const params = op.params || {};
    // 依動詞類型抽代碼
    switch (op.verb || op.type) {
      case 'place_tile':
      case 'remove_tile':
      case 'reveal_tile':
        if (params.location_code) locations.add(params.location_code);
        break;
      case 'connect_tiles':
      case 'disconnect_tiles':
        if (params.location_a) locations.add(params.location_a);
        if (params.location_b) locations.add(params.location_b);
        break;
      case 'spawn_enemy':
      case 'place_enemy':
        if (params.family_code) families.add(params.family_code);
        if (params.location_code) locations.add(params.location_code);
        break;
      case 'create_light':
      case 'extinguish_light':
      case 'create_darkness':
      case 'remove_darkness':
      case 'create_fire':
      case 'extinguish_fire':
      case 'place_clue':
        if (params.location_code) locations.add(params.location_code);
        break;
      // flag 類操作:在 back_flag_sets 或 set_flag 中抽取
    }
  }

  return {
    locations: [...locations],
    families: [...families],
    flags: [...flags]
  };
}
```

### 4.4 校驗失敗回傳格式

與 MOD-06 一致:

```json
{
  "error": "驗證失敗",
  "details": {
    "missing_flags": ["act.ch3_sealed_gate"],
    "missing_locations": ["abandoned_mansion"],
    "missing_families": [],
    "missing_boss_ids": [],
    "missing_mythos_cards": ["<UUID>"],
    "missing_encounter_cards": []
  }
}
```

HTTP 狀態碼 400。

---

## 五、重返版合併邏輯

### 5.1 `GET /api/stages/:id/resolved` 的職責

此端點回傳一份**已套用 overrides 後的完整關卡配置**。前端預覽、執行期引擎皆呼叫此端點取得「實際要執行的關卡配置」。

- 若 `stage_type !== 'side_return'`:直接回傳 `GET /api/stages/:id` 的結果
- 若 `stage_type === 'side_return'`:
  1. 載入原始支線關卡的完整資料(`return_parent_id`)
  2. 套用 `return_overrides` 的 JSON Merge Patch
  3. 回傳合併後的完整配置

### 5.2 合併演算法

`resolveReturnStage(returnStage, parentStage)`:

```typescript
export function resolveReturnStage(returnStage: any, parentStage: any): any {
  const overrides = returnStage.return_overrides || {};
  const resolved = deepClone(parentStage);

  // 1. 關卡元資料覆寫
  if (overrides.stage_metadata) {
    Object.assign(resolved, overrides.stage_metadata);
  }

  // 2. 目標卡覆寫(依 card_order 定位)
  if (overrides.act_cards) {
    resolved.act_cards = mergeCardOverrides(parentStage.act_cards, overrides.act_cards);
  }

  // 3. 議案卡覆寫
  if (overrides.agenda_cards) {
    resolved.agenda_cards = mergeCardOverrides(parentStage.agenda_cards, overrides.agenda_cards);
  }

  // 4. 怪物家族池覆寫
  if (overrides.monster_pool) {
    resolved.monster_pool = applyMonsterPoolOverride(
      parentStage.monster_pool,
      overrides.monster_pool
    );
  }

  // 5. 混沌袋覆寫
  if (overrides.chaos_bag) {
    resolved.chaos_bag = applyChaosBagOverride(
      parentStage.chaos_bag,
      overrides.chaos_bag
    );
  }

  // 6. 神話卡池、遭遇卡池覆寫
  if (overrides.mythos_pool) {
    resolved.mythos_pool = applyPoolOverride(parentStage.mythos_pool, overrides.mythos_pool);
  }
  if (overrides.encounter_pool) {
    resolved.encounter_pool = applyPoolOverride(
      parentStage.encounter_pool,
      overrides.encounter_pool
    );
  }

  // 標記為重返版(供前端辨識)
  resolved._is_return_resolved = true;
  resolved._return_parent_id = parentStage.id;
  resolved._return_stage_number = returnStage.return_stage_number;

  return resolved;
}
```

### 5.3 卡片覆寫合併

```typescript
function mergeCardOverrides(originalCards: any[], overrides: Record<string, any>): any[] {
  const result = [...originalCards.map(deepClone)];
  const byOrder = new Map(result.map(c => [c.card_order, c]));

  for (const [key, overrideCard] of Object.entries(overrides)) {
    if (key.startsWith('new_')) {
      // 新增原始支線沒有的卡
      const newOrder = (Math.max(...result.map(c => c.card_order), 0)) + 1;
      result.push({ ...overrideCard, card_order: newOrder });
    } else {
      const orderNum = parseInt(key, 10);
      const existing = byOrder.get(orderNum);
      if (existing) {
        // JSON Merge Patch:逐欄位覆寫
        Object.assign(existing, overrideCard);
      }
    }
  }

  return result.sort((a, b) => a.card_order - b.card_order);
}
```

### 5.4 怪物池覆寫(特殊處理)

```typescript
function applyMonsterPoolOverride(original: any[], override: any): any[] {
  const result = original.map(deepClone);

  // 主家族位階上調
  if (override.primary_family_tier_adjustment) {
    const primary = result.find(p => p.role === 'primary');
    if (primary) {
      primary.allowed_tiers = adjustTiers(
        primary.allowed_tiers,
        override.primary_family_tier_adjustment
      );
    }
  }

  // 固定頭目替換
  if (override.fixed_boss_replacement) {
    for (const pool of result) {
      const idx = pool.fixed_boss_ids.indexOf(override.fixed_boss_replacement.original_boss_id);
      if (idx >= 0) {
        pool.fixed_boss_ids[idx] = override.fixed_boss_replacement.new_boss_id;
      }
    }
  }

  return result;
}

function adjustTiers(tiers: string[], adjustment: string): string[] {
  const order = ['minion', 'threat', 'elite', 'boss', 'titan'];
  const delta = parseInt(adjustment, 10); // "+1" → 1, "-1" → -1
  return tiers.map(t => {
    const idx = order.indexOf(t);
    const newIdx = Math.max(0, Math.min(order.length - 1, idx + delta));
    return order[newIdx];
  });
}
```

### 5.5 混沌袋覆寫

```typescript
function applyChaosBagOverride(original: any, override: any): any {
  const result = deepClone(original);

  if (override.additions) {
    for (const change of override.additions) {
      const path = resolveMarkerPath(result, change.marker);
      if (path) path.count = (path.count || 0) + change.count;
    }
  }
  if (override.removals) {
    for (const change of override.removals) {
      const path = resolveMarkerPath(result, change.marker);
      if (path) path.count = Math.max(0, (path.count || 0) - change.count);
    }
  }
  if (override.difficulty_preset) {
    result.difficulty_preset = override.difficulty_preset;
  }

  return result;
}
```

### 5.6 池覆寫(神話、遭遇通用)

```typescript
function applyPoolOverride(original: any[], override: any): any[] {
  let result = [...original.map(deepClone)];

  if (override.remove_cards) {
    const toRemove = new Set(override.remove_cards.map((c: any) => c.card_id || c.mythos_card_id || c.encounter_card_id));
    result = result.filter(p => !toRemove.has(p.card_id || p.mythos_card_id || p.encounter_card_id));
  }
  if (override.add_cards) {
    for (const add of override.add_cards) {
      result.push(add);
    }
  }

  return result;
}
```

---

## 六、註冊 route plugin

### 6.1 修改 `packages/server/src/routes/index.ts`

```typescript
export { stageRoutes } from './stages';
```

### 6.2 修改 `packages/server/src/app.ts`

在 route 註冊區塊新增(建議放在 `campaignRoutes` 之後):

```typescript
import { stageRoutes } from './routes';
// ...
await app.register(stageRoutes);
```

---

## 七、共用型別新增

### 7.1 修改 `packages/shared/src/types/scenario.ts`(若不存在則新增)

```typescript
export type StageType = 'main' | 'side' | 'side_return' | 'side_random';
export type MonsterRole = 'primary' | 'secondary';
export type DifficultyPreset = 'easy' | 'standard' | 'hard' | 'expert';

export interface Stage {
  id: string;
  chapter_id: string | null;
  code: string;
  name_zh: string;
  name_en: string;
  stage_type: StageType;
  narrative: string;
  entry_condition: Record<string, unknown> | null;
  completion_flags: unknown[];
  scaling_rules: Record<string, unknown>;
  return_parent_id: string | null;
  return_overrides: Record<string, unknown>;
  return_stage_number: number | null;
  side_signature_card_id: string | null;
  design_status: 'draft' | 'review' | 'published';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Scenario {
  id: string;
  stage_id: string;
  scenario_order: number;
  name_zh: string;
  name_en: string;
  narrative: string;
  initial_location_codes: string[];
  initial_connections: unknown[];
  investigator_spawn_location: string | null;
  initial_environment: Record<string, unknown>;
  initial_enemies: unknown[];
}

export interface StageActCard { /* 對應 §3.5 所有欄位 */ }
export interface StageAgendaCard { /* 對應 §3.6 所有欄位 */ }
export interface StageEncounterPoolEntry { /* … */ }
export interface StageMythosPoolEntry { /* … */ }
export interface StageChaosBag { /* … */ }
export interface StageMonsterPool { /* … */ }
export interface RandomDungeonGenerator { /* … */ }
```

在 `packages/shared/src/index.ts` 加:
```typescript
export * from './types/scenario';
```

---

## 八、驗收清單

完成本份指令後,以下應為 `true`:

- [ ] `pnpm dev:server` 啟動無錯誤
- [ ] 啟動時 MIGRATION_018 自動執行,九張表皆建立
- [ ] `curl -H "Authorization: Bearer <token>" http://localhost:3001/api/stages` 回傳空陣列
- [ ] `POST /api/stages` 建立主線關卡(需帶 `chapter_id`)成功;不帶 `chapter_id` 時回傳 400
- [ ] 建立關卡後,`stage_chaos_bag` 同步建立一筆預設配置
- [ ] `POST /api/stages` 建立支線關卡時 `completion_flags` 非空則回傳 400
- [ ] `POST /api/stages` 建立 `side_return` 時 `return_parent_id` 未提供則回傳 400
- [ ] 建立 `side_random` 時同步建立 `random_dungeon_generators` 紀錄
- [ ] 目標卡儲存時,`back_map_operations` 引用不存在的地點回傳 400 並列出缺漏
- [ ] 怪物家族池儲存時,不存在的家族代碼回傳 400
- [ ] 遭遇卡池加入不存在的遭遇卡 ID 回傳 400
- [ ] `GET /api/stages/:id/resolved` 對非重返版直接回傳原始資料
- [ ] `GET /api/stages/:id/resolved` 對重返版套用 overrides 後回傳合併結果
- [ ] 健康檢查 `GET /health` 的 `tables` 清單包含新增的九張表

---

## 九、實作注意事項

1. **所有錯誤訊息使用繁體中文**,具體指出問題欄位
2. **地圖操作指令的 JSON 結構**採用 `{ verb, params }` 或 `{ type, params }`(沿用 MOD-01 效果編輯器慣例,建議用 `verb` 以區別於其他概念)。本份統一用 `verb` 欄位
3. **`GET /api/stages/:id` 與 `GET /api/stages/:id/resolved` 不同**,前端編輯使用前者(看原始 overrides),執行期與預覽使用後者(看合併結果)
4. **pool 類跨表校驗**盡量用 `code = ANY($1)` 批次查詢,避免 N+1
5. **重返版合併發生在讀取時**,儲存時只存 `return_overrides`,永遠不修改原始支線資料
6. **關卡刪除前檢查依賴**:若為 `side` 關卡且有 `side_return` 指向它,拒絕刪除

---

## 十、下一份指令

Part 2 將產出前端骨架:HTML 結構、11 個分頁切換、關卡列表、關卡總覽分頁、場景序列編輯器、地點挑選共用對話框。
