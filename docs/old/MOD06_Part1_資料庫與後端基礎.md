# MOD-06 戰役敘事設計器 · Claude Code 指令 Part 1：資料庫與後端基礎

> **系列**：MOD-06 實作指令 · 第 1 份 / 共 4 份
> **依據規格**：`MOD06_戰役敘事設計器_總覽規格_v0_2.md`
> **前置條件**：MIGRATION_016 已完成（MOD-12 為目前最後一個 migration）
> **本份產出**：MIGRATION_017 資料庫遷移、後端 routes、跨模組校驗 helper
> **執行角色**：Claude Code 依此文件實作檔案變更

---

## 一、任務範圍

本份指令要完成 MOD-06 戰役敘事設計器的**資料層與後端 API 層**。實作後應達到的狀態：

- 新增五張資料表與對應索引
- 建立戰役時**交易內自動產生十章空骨架**
- 完整 CRUD API：戰役、章節、章節結果分支、旗標字典、間章事件
- 跨模組校驗 helper：確認引用的旗標／城主／怪物家族／團隊精神代碼存在
- 註冊 route plugin 到 `app.ts`

本份**不**包含：前端 HTML／JS、AI 整合、種子資料、完成度檢查演算法（後續三份處理）。

---

## 二、資料庫遷移（MIGRATION_017）

### 2.1 位置與命名

在 `packages/server/src/db/migrate.ts` 的 `MIGRATION_016` 之後追加 `MIGRATION_017`。沿用現有 migration 的實作模式（以 SQL 字串陣列形式，包在 `async function runMigration017(client)` 內執行，並在 `runMigrations()` 呼叫序列尾端加上）。

### 2.2 建立五張資料表

依以下順序建立（因外鍵依賴）：

**表 1：`campaigns`（戰役）**

```sql
CREATE TABLE IF NOT EXISTS campaigns (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               VARCHAR(32) NOT NULL UNIQUE,
  name_zh            VARCHAR(128) NOT NULL,
  name_en            VARCHAR(128) NOT NULL DEFAULT '',
  theme              VARCHAR(64) NOT NULL DEFAULT '',
  cover_narrative    TEXT NOT NULL DEFAULT '',
  difficulty_tier    VARCHAR(16) NOT NULL DEFAULT 'standard'
                     CHECK (difficulty_tier IN ('easy','standard','hard','expert')),
  initial_chaos_bag  JSONB NOT NULL DEFAULT '{}'::jsonb,
  design_status      VARCHAR(16) NOT NULL DEFAULT 'draft'
                     CHECK (design_status IN ('draft','review','published')),
  version            INTEGER NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(design_status);
```

**表 2：`chapters`（章節）**

```sql
CREATE TABLE IF NOT EXISTS chapters (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  chapter_number     INTEGER NOT NULL CHECK (chapter_number BETWEEN 1 AND 10),
  chapter_code       VARCHAR(16) NOT NULL,
  name_zh            VARCHAR(128) NOT NULL DEFAULT '',
  name_en            VARCHAR(128) NOT NULL DEFAULT '',
  narrative_intro    TEXT NOT NULL DEFAULT '',
  narrative_choices  JSONB NOT NULL DEFAULT '[]'::jsonb,
  design_status      VARCHAR(16) NOT NULL DEFAULT 'draft'
                     CHECK (design_status IN ('draft','review','published')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, chapter_number),
  UNIQUE (campaign_id, chapter_code)
);

CREATE INDEX IF NOT EXISTS idx_chapters_campaign ON chapters(campaign_id);
```

**表 3：`chapter_outcomes`（章節結果分支）**

```sql
CREATE TABLE IF NOT EXISTS chapter_outcomes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id             UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  outcome_code           VARCHAR(1) NOT NULL
                         CHECK (outcome_code IN ('A','B','C','D','E')),
  condition_expression   JSONB NOT NULL DEFAULT '{}'::jsonb,
  narrative_text         TEXT NOT NULL DEFAULT '',
  next_chapter_version   VARCHAR(16),
  chaos_bag_changes      JSONB NOT NULL DEFAULT '[]'::jsonb,
  rewards                JSONB NOT NULL DEFAULT '{}'::jsonb,
  flag_sets              JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chapter_id, outcome_code)
);

CREATE INDEX IF NOT EXISTS idx_outcomes_chapter ON chapter_outcomes(chapter_id);
```

**表 4：`campaign_flags`（旗標字典）**

```sql
CREATE TABLE IF NOT EXISTS campaign_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  flag_code       VARCHAR(128) NOT NULL,
  category        VARCHAR(16) NOT NULL
                  CHECK (category IN (
                    'act','agenda','npc','item','location',
                    'choice','outcome','time','hidden'
                  )),
  description_zh  TEXT NOT NULL DEFAULT '',
  visibility      VARCHAR(16) NOT NULL DEFAULT 'visible'
                  CHECK (visibility IN ('visible','conditional','hidden')),
  chapter_code    VARCHAR(16),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, flag_code)
);

CREATE INDEX IF NOT EXISTS idx_flags_campaign ON campaign_flags(campaign_id);
CREATE INDEX IF NOT EXISTS idx_flags_category ON campaign_flags(campaign_id, category);
```

**表 5：`interlude_events`（間章事件）**

```sql
CREATE TABLE IF NOT EXISTS interlude_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id          UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  event_code          VARCHAR(64) NOT NULL,
  name_zh             VARCHAR(128) NOT NULL,
  name_en             VARCHAR(128) NOT NULL DEFAULT '',
  insertion_point     VARCHAR(16) NOT NULL
                      CHECK (insertion_point IN ('prologue','epilogue')),
  trigger_condition   JSONB,
  operations          JSONB NOT NULL DEFAULT '[]'::jsonb,
  narrative_text_zh   TEXT NOT NULL DEFAULT '',
  narrative_text_en   TEXT NOT NULL DEFAULT '',
  choices             JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chapter_id, event_code)
);

CREATE INDEX IF NOT EXISTS idx_interlude_chapter
  ON interlude_events(chapter_id, insertion_point);
```

### 2.3 觸發器：自動更新 `updated_at`

本專案其他表未使用觸發器自動更新 `updated_at`（由後端程式碼負責）。沿用此慣例，**不建立觸發器**。後端 UPDATE 時顯式 `SET updated_at = NOW()`。

### 2.4 `runMigrations()` 調整

在 `runMigrations()` 函式尾端追加 `await runMigration017(client)`，確認 migration 註冊順序正確。

---

## 三、後端路由檔案

### 3.1 檔案位置

建立新檔：`packages/server/src/routes/campaigns.ts`

### 3.2 檔案開頭結構（沿用現有 route 檔案模式）

```typescript
import { FastifyInstance } from 'fastify';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

export async function campaignRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // 路由實作如下節所述
}
```

### 3.3 戰役路由

**`GET /api/campaigns`**
回傳戰役列表。支援 query 參數：
- `status`：篩選 `design_status`（`draft` / `review` / `published`）
- `search`：名稱模糊搜尋（`name_zh` 或 `code`）

回傳欄位：`id`, `code`, `name_zh`, `name_en`, `theme`, `difficulty_tier`, `design_status`, `version`, `created_at`, `updated_at`, `chapter_count`（子查詢 `chapters` 計數）。

**`GET /api/campaigns/:id`**
回傳單一戰役完整資料，包含：
- 戰役基本欄位
- `chapters` 陣列（依 `chapter_number` 排序，每項含基本欄位與 `outcome_count`、`interlude_count`）
- `flag_count`（旗標字典總數）

**`POST /api/campaigns`**
建立戰役。**必須在同一個 PG 交易內**完成以下兩件事：

1. 插入 `campaigns` 主紀錄（`code`、`name_zh` 為必填；其餘使用預設值或請求體提供的值）
2. 插入**十筆** `chapters` 紀錄，每筆的欄位為：
   - `campaign_id` = 剛建立的戰役 ID
   - `chapter_number` = 1 到 10
   - `chapter_code` = `ch1` 到 `ch10`
   - `name_zh` = `第 N 章`（N 為中文數字，例：`第一章`、`第二章`、…、`第十章`）
   - 其餘使用預設值

交易失敗則 rollback。成功回傳戰役完整資料（同 `GET /api/campaigns/:id` 格式）。

**`PUT /api/campaigns/:id`**
更新戰役欄位。可更新：`name_zh`, `name_en`, `theme`, `cover_narrative`, `difficulty_tier`, `initial_chaos_bag`, `design_status`。每次更新 `version += 1`，`updated_at = NOW()`。

**`DELETE /api/campaigns/:id`**
刪除戰役。靠 ON DELETE CASCADE 連帶刪除所有章節、結果分支、旗標、間章事件。

### 3.4 章節路由

**`GET /api/campaigns/:id/chapters`**
回傳該戰役所有章節列表，依 `chapter_number` 排序。

**`GET /api/chapters/:id`**
回傳單一章節完整資料：
- 章節基本欄位
- `outcomes` 陣列（該章節所有結果分支）
- `interlude_events` 陣列（該章節所有間章事件）
- `linked_stages` 陣列：查詢 `stages` 表中 `chapter_id` 對應的關卡（若 `stages` 表尚未建立則回空陣列——此處要容錯處理，因 MOD-07 尚未建置）

**`PUT /api/chapters/:id`**
更新章節欄位。可更新：`chapter_code`, `name_zh`, `name_en`, `narrative_intro`, `narrative_choices`, `design_status`。

**不提供 `POST /api/chapters`**——章節只能由建立戰役時自動產生，禁止手動新增第 11 章。

**不提供 `DELETE /api/chapters/:id`**——同上理由，章節不可單獨刪除。

### 3.5 章節結果分支路由

**`GET /api/chapters/:chapterId/outcomes`**
回傳該章節所有結果分支，依 `outcome_code` 排序（A→B→C→D→E）。

**`POST /api/chapters/:chapterId/outcomes`**
新增一個結果分支。請求體需提供 `outcome_code`、`condition_expression`、`narrative_text`、`next_chapter_version`、`chaos_bag_changes`、`rewards`、`flag_sets`。

**校驗**：
- `outcome_code` 必須是 A–E 之一
- 同一章節內 `outcome_code` 不可重複（DB 唯一鍵會檢查，但在應用層也先檢查並回傳友善錯誤訊息）
- `flag_sets` 中的旗標代碼必須存在於同一戰役的 `campaign_flags`（詳見 §4 校驗 helper）
- `next_chapter_version`：若非 NULL，驗證下一章存在（可用該戰役下 `chapter_number = 當前章節 + 1` 的章節代碼清單驗證；第十章的 `next_chapter_version` 必須為 NULL）

**`PUT /api/outcomes/:id`**
更新結果分支。校驗同 POST。

**`DELETE /api/outcomes/:id`**
刪除結果分支。

### 3.6 旗標字典路由

**`GET /api/campaigns/:id/flags`**
回傳該戰役所有旗標。支援 query：
- `category`：篩選類別
- `search`：`flag_code` 模糊搜尋

**`GET /api/flags/:id`**
回傳單一旗標，並附加**反向引用資訊**：
- `referenced_by_outcomes`：哪些章節結果分支的 `condition_expression` 或 `flag_sets` 引用此旗標
- `referenced_by_events`：哪些間章事件的 `trigger_condition` 或 `operations` 引用此旗標
- `referenced_by_stages`：（預留）哪些關卡的 `entry_condition` 或 `completion_flags` 引用此旗標

反向引用以 JSON 欄位內的字串搜尋實作（`WHERE condition_expression::text LIKE '%flag_code%'`）。

**`POST /api/campaigns/:id/flags`**
新增旗標。請求體：`flag_code`, `category`, `description_zh`, `visibility`, `chapter_code`（可選）。

**校驗 `flag_code` 格式**：必須符合正則 `^[a-z_]+\.[a-z0-9_]+$`（類別前綴 + 點號 + 內容）。類別前綴必須與 `category` 欄位一致。例：`category = 'npc'` 時 `flag_code` 必須以 `npc.` 開頭。

**`PUT /api/flags/:id`**
更新旗標。`flag_code` 不可修改（會破壞引用完整性）；若要改名，刪除後重建。其他欄位可改。

**`DELETE /api/flags/:id`**
刪除旗標。**刪除前校驗**：若該旗標被任何結果分支或間章事件引用，拒絕刪除並回傳引用清單。

### 3.7 間章事件路由

**`GET /api/chapters/:chapterId/interlude-events`**
回傳該章節所有間章事件，依 `insertion_point`（章首在前、章末在後）與 `created_at` 排序。

**`POST /api/chapters/:chapterId/interlude-events`**
新增間章事件。請求體：`event_code`, `name_zh`, `name_en`, `insertion_point`, `trigger_condition`, `operations`, `narrative_text_zh`, `narrative_text_en`, `choices`。

**校驗**：
- `event_code` 在同一章節內唯一
- `trigger_condition` 中引用的旗標必須存在於同一戰役
- `operations` 中引用的旗標（若操作類型為「設定旗標」）必須存在
- `operations` 中引用的城主模板代碼（若操作類型涉及城主介入）必須存在於 `mythos_cards`（從 MOD-10 查）
- `operations` 中引用的怪物家族代碼必須存在於 `monster_families`（從 MOD-03 查）
- `operations` 中引用的團隊精神代碼必須存在於 `spirit_definitions`（從 MOD-04 查）

**`PUT /api/interlude-events/:id`**
更新間章事件。校驗同 POST。

**`DELETE /api/interlude-events/:id`**
刪除。

---

## 四、跨模組校驗 helper

### 4.1 檔案位置

建立新檔：`packages/server/src/utils/campaign-validators.ts`

### 4.2 函式清單

每個函式都是 `async` 函式，接受一個 `client: PoolClient`（或直接用 `pool.query`）與代碼清單，回傳一個物件 `{ valid: boolean, missing: string[] }`。

```typescript
import { pool } from '../db/pool';
import { PoolClient } from 'pg';

type ValidatorResult = { valid: boolean; missing: string[] };

// 校驗一組旗標代碼在指定戰役的字典中存在
export async function validateFlagCodes(
  campaignId: string,
  flagCodes: string[],
  client?: PoolClient
): Promise<ValidatorResult> {
  // SELECT flag_code FROM campaign_flags
  // WHERE campaign_id = $1 AND flag_code = ANY($2)
  // 回傳缺漏的代碼清單
}

// 校驗一組怪物家族代碼在 MOD-03 中存在
export async function validateMonsterFamilyCodes(
  familyCodes: string[],
  client?: PoolClient
): Promise<ValidatorResult> {
  // SELECT code FROM monster_families WHERE code = ANY($1)
}

// 校驗一組神話卡代碼（或 ID）在 MOD-10 中存在
export async function validateMythosCardCodes(
  cardCodes: string[],
  client?: PoolClient
): Promise<ValidatorResult> {
  // SELECT code FROM mythos_cards WHERE code = ANY($1)
}

// 校驗一組團隊精神代碼在 MOD-04 中存在
export async function validateTeamSpiritCodes(
  spiritCodes: string[],
  client?: PoolClient
): Promise<ValidatorResult> {
  // SELECT code FROM spirit_definitions WHERE code = ANY($1)
}
```

### 4.3 從 `operations` / `condition_expression` JSON 中抽取代碼的 helper

建立輔助函式 `extractFlagCodesFromExpression(expr: any): string[]`，遞迴走訪條件表達式結構，收集所有 `flag_code` 欄位的值。

建立輔助函式 `extractReferencedCodes(operations: any[]): { flags: string[], families: string[], mythos: string[], spirits: string[] }`，走訪操作清單抽出所有引用的代碼。

這兩個 helper 在間章事件與結果分支的 POST／PUT 路由中使用：抽出代碼 → 呼叫對應 validator → 若有缺漏回傳 400。

### 4.4 回傳格式

校驗失敗時，API 回傳：

```json
{
  "error": "驗證失敗",
  "details": {
    "missing_flags": ["npc.ch5_henry_alive"],
    "missing_families": [],
    "missing_mythos": ["ritual_of_awakening"],
    "missing_spirits": []
  }
}
```

HTTP 狀態碼 400。

---

## 五、註冊 route plugin

### 5.1 修改 `packages/server/src/routes/index.ts`

匯出新的 route plugin：

```typescript
export { campaignRoutes } from './campaigns';
```

### 5.2 修改 `packages/server/src/app.ts`

在 `buildApp()` 的 route plugin 註冊區塊新增：

```typescript
import { campaignRoutes } from './routes';
// ...
await app.register(campaignRoutes);
```

放在既有 route 註冊的尾端（第 12 個 route plugin 之後、MOD-12 `aiConsole` 之前或之後皆可，建議依模組編號順序：放在 `locationRoutes` 之後、`keeperRoutes` 之前，以維持 MOD 順序的視覺一致）。

---

## 六、共用型別新增

### 6.1 修改 `packages/shared/src/types/campaign.ts`

既有檔案中已有 `Campaign` interface（可能為舊版草稿），以完整版覆寫：

```typescript
export type CampaignDifficulty = 'easy' | 'standard' | 'hard' | 'expert';
export type DesignStatus = 'draft' | 'review' | 'published';
export type FlagCategory =
  | 'act' | 'agenda' | 'npc' | 'item' | 'location'
  | 'choice' | 'outcome' | 'time' | 'hidden';
export type FlagVisibility = 'visible' | 'conditional' | 'hidden';
export type OutcomeCode = 'A' | 'B' | 'C' | 'D' | 'E';
export type InsertionPoint = 'prologue' | 'epilogue';

export interface Campaign {
  id: string;
  code: string;
  name_zh: string;
  name_en: string;
  theme: string;
  cover_narrative: string;
  difficulty_tier: CampaignDifficulty;
  initial_chaos_bag: Record<string, unknown>;
  design_status: DesignStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: string;
  campaign_id: string;
  chapter_number: number;
  chapter_code: string;
  name_zh: string;
  name_en: string;
  narrative_intro: string;
  narrative_choices: unknown[];
  design_status: DesignStatus;
  created_at: string;
  updated_at: string;
}

export interface ChapterOutcome {
  id: string;
  chapter_id: string;
  outcome_code: OutcomeCode;
  condition_expression: Record<string, unknown>;
  narrative_text: string;
  next_chapter_version: string | null;
  chaos_bag_changes: unknown[];
  rewards: Record<string, unknown>;
  flag_sets: unknown[];
}

export interface CampaignFlag {
  id: string;
  campaign_id: string;
  flag_code: string;
  category: FlagCategory;
  description_zh: string;
  visibility: FlagVisibility;
  chapter_code: string | null;
}

export interface InterludeEvent {
  id: string;
  chapter_id: string;
  event_code: string;
  name_zh: string;
  name_en: string;
  insertion_point: InsertionPoint;
  trigger_condition: Record<string, unknown> | null;
  operations: unknown[];
  narrative_text_zh: string;
  narrative_text_en: string;
  choices: unknown[];
}
```

---

## 七、驗收清單

完成本份指令後，以下應為 `true`：

- [ ] `pnpm dev:server` 啟動無錯誤
- [ ] 啟動時 MIGRATION_017 自動執行，五張表皆建立
- [ ] `curl -H "Authorization: Bearer <token>" http://localhost:3001/api/campaigns` 回傳空陣列
- [ ] `POST /api/campaigns` 建立一個戰役後，`SELECT COUNT(*) FROM chapters WHERE campaign_id = ...` 回傳 10
- [ ] `POST /api/campaigns/:id/flags` 新增 `flag_code = "act.ch3_gate_sealed"` 成功；但 `flag_code = "wrongformat"` 回傳 400
- [ ] `POST /api/chapters/:chapterId/outcomes` 中 `flag_sets` 引用不存在的旗標時回傳 400 並列出 missing
- [ ] `DELETE /api/flags/:id` 刪除被引用的旗標時回傳 400 並列出引用清單
- [ ] 健康檢查 `GET /health` 回傳新增的表格在 `tables` 清單中

---

## 八、實作注意事項

1. **所有錯誤訊息使用繁體中文**（沿用既有路由的慣例，例：`'戰役不存在'`、`'旗標代碼格式錯誤'`）
2. **所有 JSONB 欄位在後端統一用物件／陣列傳遞**，不接受字串形式
3. **`version` 欄位每次 PUT 都 +1**，GET 回傳時一併返回供前端衝突偵測
4. **DELETE 之前一律先檢查引用**，拒絕刪除時回傳清晰的 `referenced_by` 清單
5. **交易內建立十章失敗要完整 rollback**，不允許產生「只有 5 章的戰役」這種中間狀態
6. **跨模組校驗 helper 使用 `code = ANY($1)` 的方式**，避免多次單獨查詢

---

## 九、下一份指令

Part 2 將產出 MOD-06 前端骨架：HTML 結構、分頁切換、左側戰役列表、與 `admin-shared.js` 對接、戰役總覽分頁的渲染。
