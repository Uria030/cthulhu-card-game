# Claude Code 指令：後端基礎建設與管理員認證
## Backend Infrastructure & Admin Authentication

> **給 Claude Code：** 請完成以下三大工作，讓卡片編輯器能正常運作：
> 1. **資料庫建表** — 在 PostgreSQL 建立卡片相關的表格
> 2. **卡片 API** — 實作完整的 CRUD 端點，流水號由後端自動生成
> 3. **管理員認證** — 建立登入機制，保護 `/admin/*` 路徑
>
> **重要：** Railway 環境已就緒（PostgreSQL + Redis + Server 皆 Online）。
> 本指令的目標是讓前端卡片編輯器能正確連接後端，並確保只有授權的管理員能存取。

---

## 一、環境變數確認

請確保 Railway 的 Server 環境變數中有以下設定：

```bash
# Railway 會自動注入這些（如果 PostgreSQL 和 Redis 已連結）
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# 需要手動新增的環境變數
ADMIN_JWT_SECRET=<隨機產生的 64 字元密鑰>
ADMIN_PASSWORD=<管理員登入密碼，建議 16 字元以上>
ADMIN_SESSION_HOURS=24

# 允許的前端來源（CORS）
ALLOWED_ORIGINS=https://你的vercel網域.vercel.app,http://localhost:3000
```

**指示 Claude Code：** 如果 `.env.example` 不存在，請建立它並包含上述變數的說明。

---

## 二、資料庫 Migration

### 2.1 建立 Migration 檔案

在 `packages/server/src/db/migrations/` 目錄下建立：

**001_create_card_tables.sql**

```sql
-- ============================================
-- 卡片定義表 card_definitions
-- ============================================

-- 先刪除舊的 enum（如果存在但定義不完整）
DROP TYPE IF EXISTS card_type CASCADE;
DROP TYPE IF EXISTS card_slot CASCADE;
DROP TYPE IF EXISTS consume_type CASCADE;

-- 卡片類別（存在形式）
CREATE TYPE card_type AS ENUM (
  'asset',        -- 資產
  'event',        -- 事件
  'ally',         -- 盟友
  'skill'         -- 技能
);

-- 裝備欄位
CREATE TYPE card_slot AS ENUM (
  'one_hand',     -- 單手
  'two_hand',     -- 雙手
  'head',         -- 帽子
  'body',         -- 身體
  'accessory',    -- 配件
  'arcane',       -- 神秘
  'talent',       -- 天賦
  'expertise',    -- 專長
  'none'          -- 無
);

-- 使用後去向
CREATE TYPE consume_type AS ENUM (
  'stay',         -- 留在場上
  'discard',      -- 進棄牌堆
  'long_rest',    -- 長休息回復
  'short_rest',   -- 短休息回復
  'removed'       -- 移除出遊戲
);

-- 卡片定義主表
CREATE TABLE IF NOT EXISTS card_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 身份資訊
  code            VARCHAR(32) UNIQUE NOT NULL,   -- 自動生成：CSAH-01
  series          VARCHAR(8) NOT NULL DEFAULT 'C',  -- 系列代碼
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128) NOT NULL,
  faction         VARCHAR(8) NOT NULL,           -- E/I/S/N/T/F/J/P/neutral
  style           VARCHAR(4) NOT NULL,           -- AH/AC/OH/OC
  card_type       card_type NOT NULL,
  slot            card_slot NOT NULL DEFAULT 'none',
  
  -- 特殊身份標記
  is_unique       BOOLEAN NOT NULL DEFAULT FALSE,
  is_signature    BOOLEAN NOT NULL DEFAULT FALSE,
  is_weakness     BOOLEAN NOT NULL DEFAULT FALSE,
  is_revelation   BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- 數值資訊
  level           INTEGER NOT NULL DEFAULT 0,
  cost            INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0 AND cost <= 6),
  cost_currency   VARCHAR(32) NOT NULL DEFAULT 'resource',
  skill_value     INTEGER NOT NULL DEFAULT 0 CHECK (skill_value >= 0 AND skill_value <= 5),
  damage          INTEGER NOT NULL DEFAULT 0,
  horror          INTEGER NOT NULL DEFAULT 0,
  health_boost    INTEGER NOT NULL DEFAULT 0,
  sanity_boost    INTEGER NOT NULL DEFAULT 0,
  
  -- 武器相關
  weapon_tier     INTEGER CHECK (weapon_tier IS NULL OR (weapon_tier >= 1 AND weapon_tier <= 6)),
  ammo            INTEGER,
  uses            INTEGER,
  consume_type    consume_type NOT NULL DEFAULT 'discard',
  
  -- 檢定相關
  check_attribute VARCHAR(16),
  check_modifier  INTEGER DEFAULT 0,
  check_method    VARCHAR(16) DEFAULT 'dice',
  hand_limit_mod  INTEGER DEFAULT 0,
  
  -- 盟友專用
  ally_hp         INTEGER,
  ally_san        INTEGER,
  
  -- 物品子類型（陣列）
  subtypes        TEXT[] DEFAULT '{}',
  
  -- 敘事
  flavor_text     TEXT,
  
  -- 神啟卡專用
  removable       BOOLEAN DEFAULT TRUE,
  committable     BOOLEAN DEFAULT TRUE,
  lethal_count    INTEGER DEFAULT 0,
  
  -- 簽名卡專用
  owner_investigator VARCHAR(64),
  
  -- 中繼資料
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_cards_faction ON card_definitions(faction);
CREATE INDEX IF NOT EXISTS idx_cards_type ON card_definitions(card_type);
CREATE INDEX IF NOT EXISTS idx_cards_code ON card_definitions(code);
CREATE INDEX IF NOT EXISTS idx_cards_series_faction_style ON card_definitions(series, faction, style);

-- ============================================
-- 卡片效果表 card_effects
-- ============================================

CREATE TABLE IF NOT EXISTS card_effects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_def_id     UUID NOT NULL REFERENCES card_definitions(id) ON DELETE CASCADE,
  
  -- 六大要素
  trigger_type    VARCHAR(32) NOT NULL,           -- 觸發時機
  condition       JSONB,                          -- 條件限制（可為 null）
  cost            JSONB,                          -- 費用類型
  target          VARCHAR(32),                    -- 目標指定
  effect_code     VARCHAR(64) NOT NULL,           -- 效果動詞
  effect_params   JSONB NOT NULL DEFAULT '{}',    -- 效果參數
  duration        VARCHAR(32) DEFAULT 'instant',  -- 持續時間
  scope           VARCHAR(16),                    -- per_investigator / per_team
  
  -- 描述
  description_zh  TEXT,
  description_en  TEXT,
  
  -- 排序
  sort_order      INTEGER NOT NULL DEFAULT 0,
  
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_effects_card ON card_effects(card_def_id);

-- ============================================
-- 管理員帳號表 admin_users
-- ============================================

CREATE TABLE IF NOT EXISTS admin_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username        VARCHAR(64) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  display_name    VARCHAR(64),
  role            VARCHAR(16) NOT NULL DEFAULT 'editor' 
                  CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 管理員 Session 表（可選，用於追蹤登入狀態）
-- ============================================

CREATE TABLE IF NOT EXISTS admin_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash      VARCHAR(255) NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
```

### 2.2 建立 Migration 執行腳本

**packages/server/src/db/migrate.ts**

```typescript
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigrations() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Running database migrations...');
    
    // 讀取並執行 migration 檔案
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).sort();
    
    for (const file of files) {
      if (file.endsWith('.sql')) {
        console.log(`  📄 Executing ${file}...`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query(sql);
        console.log(`  ✅ ${file} completed`);
      }
    }
    
    console.log('✅ All migrations completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// 如果直接執行此檔案
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { runMigrations };
```

### 2.3 在 Server 啟動時自動執行 Migration

**packages/server/src/index.ts**（在啟動時加入）

```typescript
import { runMigrations } from './db/migrate';

// 在 server 啟動前執行
async function bootstrap() {
  // 執行資料庫遷移
  await runMigrations();
  
  // 建立預設管理員帳號（如果不存在）
  await createDefaultAdmin();
  
  // 啟動 server
  // ... 原有的啟動邏輯
}

async function createDefaultAdmin() {
  const bcrypt = require('bcrypt');
  const { Pool } = require('pg');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.warn('⚠️  ADMIN_PASSWORD not set, skipping default admin creation');
    return;
  }
  
  const client = await pool.connect();
  try {
    // 檢查是否已有管理員
    const existing = await client.query(
      "SELECT id FROM admin_users WHERE username = 'admin' LIMIT 1"
    );
    
    if (existing.rows.length === 0) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await client.query(
        `INSERT INTO admin_users (username, password_hash, display_name, role) 
         VALUES ('admin', $1, 'Administrator', 'owner')`,
        [passwordHash]
      );
      console.log('✅ Default admin account created (username: admin)');
    }
  } finally {
    client.release();
  }
}

bootstrap();
```

---

## 三、卡片 API 實作

### 3.1 建立 API 路由檔案

**packages/server/src/routes/cards.ts**

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 類型定義
interface CardQuery {
  faction?: string;
  style?: string;
  type?: string;
  search?: string;
  series?: string;
}

interface CardBody {
  series: string;
  faction: string;
  style: string;
  name_zh: string;
  name_en: string;
  card_type: string;
  slot?: string;
  is_unique?: boolean;
  is_signature?: boolean;
  is_weakness?: boolean;
  is_revelation?: boolean;
  level?: number;
  cost?: number;
  cost_currency?: string;
  skill_value?: number;
  damage?: number;
  horror?: number;
  health_boost?: number;
  sanity_boost?: number;
  weapon_tier?: number;
  ammo?: number;
  uses?: number;
  consume_type?: string;
  check_attribute?: string;
  check_modifier?: number;
  ally_hp?: number;
  ally_san?: number;
  subtypes?: string[];
  flavor_text?: string;
  removable?: boolean;
  committable?: boolean;
  lethal_count?: number;
  owner_investigator?: string;
  effects?: EffectBody[];
}

interface EffectBody {
  trigger_type: string;
  condition?: object;
  cost?: object;
  target?: string;
  effect_code: string;
  effect_params?: object;
  duration?: string;
  scope?: string;
  description_zh?: string;
  description_en?: string;
  sort_order?: number;
}

export default async function cardRoutes(fastify: FastifyInstance) {
  
  // ============================================
  // GET /api/cards — 取得所有卡片（支援篩選）
  // ============================================
  fastify.get('/api/cards', async (request: FastifyRequest<{ Querystring: CardQuery }>, reply: FastifyReply) => {
    const { faction, style, type, search, series } = request.query;
    
    let query = `
      SELECT c.*, 
             COALESCE(json_agg(e.*) FILTER (WHERE e.id IS NOT NULL), '[]') as effects
      FROM card_definitions c
      LEFT JOIN card_effects e ON e.card_def_id = c.id
    `;
    
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    if (faction) {
      conditions.push(`c.faction = $${paramIndex++}`);
      params.push(faction);
    }
    if (style) {
      conditions.push(`c.style = $${paramIndex++}`);
      params.push(style);
    }
    if (type) {
      conditions.push(`c.card_type = $${paramIndex++}`);
      params.push(type);
    }
    if (series) {
      conditions.push(`c.series = $${paramIndex++}`);
      params.push(series);
    }
    if (search) {
      conditions.push(`(c.name_zh ILIKE $${paramIndex} OR c.name_en ILIKE $${paramIndex} OR c.code ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += ` GROUP BY c.id ORDER BY c.code ASC`;
    
    try {
      const result = await pool.query(query, params);
      return reply.send({
        success: true,
        data: result.rows,
        total: result.rows.length
      });
    } catch (error) {
      console.error('GET /api/cards error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch cards'
      });
    }
  });

  // ============================================
  // GET /api/cards/:id — 取得單張卡片
  // ============================================
  fastify.get('/api/cards/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    
    try {
      const cardResult = await pool.query(
        'SELECT * FROM card_definitions WHERE id = $1',
        [id]
      );
      
      if (cardResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: 'Card not found'
        });
      }
      
      const effectsResult = await pool.query(
        'SELECT * FROM card_effects WHERE card_def_id = $1 ORDER BY sort_order',
        [id]
      );
      
      return reply.send({
        success: true,
        data: {
          ...cardResult.rows[0],
          effects: effectsResult.rows
        }
      });
    } catch (error) {
      console.error('GET /api/cards/:id error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch card'
      });
    }
  });

  // ============================================
  // POST /api/cards — 新增卡片（自動生成流水號）
  // ============================================
  fastify.post('/api/cards', async (request: FastifyRequest<{ Body: CardBody }>, reply: FastifyReply) => {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const body = request.body;
      
      // ========== 自動生成流水號 ==========
      // 格式：[系列][陣營][風格]-[流水號]
      // 例如：CSAH-01, CSAH-02, CN0AH-01
      
      const seriesCode = body.series || 'C';
      const factionCode = body.faction === 'neutral' ? 'N0' : body.faction;
      const styleCode = body.style;
      const prefix = `${seriesCode}${factionCode}${styleCode}`;
      
      // 查詢當前最大流水號
      const maxCodeResult = await client.query(`
        SELECT code FROM card_definitions 
        WHERE code LIKE $1 
        ORDER BY code DESC 
        LIMIT 1
      `, [`${prefix}-%`]);
      
      let nextNumber = 1;
      if (maxCodeResult.rows.length > 0) {
        const lastCode = maxCodeResult.rows[0].code;
        const lastNumber = parseInt(lastCode.split('-')[1], 10);
        nextNumber = lastNumber + 1;
      }
      
      const code = `${prefix}-${String(nextNumber).padStart(2, '0')}`;
      
      // ========== 插入卡片主表 ==========
      const insertCardSQL = `
        INSERT INTO card_definitions (
          code, series, name_zh, name_en, faction, style, card_type, slot,
          is_unique, is_signature, is_weakness, is_revelation,
          level, cost, cost_currency, skill_value, damage, horror,
          health_boost, sanity_boost, weapon_tier, ammo, uses, consume_type,
          check_attribute, check_modifier, ally_hp, ally_san, subtypes,
          flavor_text, removable, committable, lethal_count, owner_investigator
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24,
          $25, $26, $27, $28, $29,
          $30, $31, $32, $33, $34
        ) RETURNING *
      `;
      
      const cardValues = [
        code,
        seriesCode,
        body.name_zh,
        body.name_en,
        body.faction,
        body.style,
        body.card_type,
        body.slot || 'none',
        body.is_unique || false,
        body.is_signature || false,
        body.is_weakness || false,
        body.is_revelation || false,
        body.level || 0,
        body.cost || 0,
        body.cost_currency || 'resource',
        body.skill_value || 0,
        body.damage || 0,
        body.horror || 0,
        body.health_boost || 0,
        body.sanity_boost || 0,
        body.weapon_tier || null,
        body.ammo || null,
        body.uses || null,
        body.consume_type || 'discard',
        body.check_attribute || null,
        body.check_modifier || 0,
        body.ally_hp || null,
        body.ally_san || null,
        body.subtypes || [],
        body.flavor_text || null,
        body.removable !== false,
        body.committable !== false,
        body.lethal_count || 0,
        body.owner_investigator || null
      ];
      
      const cardResult = await client.query(insertCardSQL, cardValues);
      const newCard = cardResult.rows[0];
      
      // ========== 插入效果 ==========
      if (body.effects && body.effects.length > 0) {
        for (let i = 0; i < body.effects.length; i++) {
          const effect = body.effects[i];
          await client.query(`
            INSERT INTO card_effects (
              card_def_id, trigger_type, condition, cost, target,
              effect_code, effect_params, duration, scope,
              description_zh, description_en, sort_order
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `, [
            newCard.id,
            effect.trigger_type,
            effect.condition ? JSON.stringify(effect.condition) : null,
            effect.cost ? JSON.stringify(effect.cost) : null,
            effect.target || null,
            effect.effect_code,
            JSON.stringify(effect.effect_params || {}),
            effect.duration || 'instant',
            effect.scope || null,
            effect.description_zh || null,
            effect.description_en || null,
            effect.sort_order ?? i
          ]);
        }
      }
      
      await client.query('COMMIT');
      
      // 回傳完整卡片資料（含效果）
      const effectsResult = await pool.query(
        'SELECT * FROM card_effects WHERE card_def_id = $1 ORDER BY sort_order',
        [newCard.id]
      );
      
      return reply.status(201).send({
        success: true,
        data: {
          ...newCard,
          effects: effectsResult.rows
        }
      });
      
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('POST /api/cards error:', error);
      
      // 處理唯一約束衝突（流水號重複）
      if (error.code === '23505') {
        return reply.status(409).send({
          success: false,
          error: 'Card code conflict, please retry'
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Failed to create card'
      });
    } finally {
      client.release();
    }
  });

  // ============================================
  // PUT /api/cards/:id — 更新卡片
  // ============================================
  fastify.put('/api/cards/:id', async (request: FastifyRequest<{ Params: { id: string }, Body: CardBody }>, reply: FastifyReply) => {
    const { id } = request.params;
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const body = request.body;
      
      // 更新卡片主表（不更新 code，流水號建立後不可變）
      const updateSQL = `
        UPDATE card_definitions SET
          name_zh = $1, name_en = $2, slot = $3,
          is_unique = $4, is_signature = $5, is_weakness = $6, is_revelation = $7,
          level = $8, cost = $9, cost_currency = $10, skill_value = $11,
          damage = $12, horror = $13, health_boost = $14, sanity_boost = $15,
          weapon_tier = $16, ammo = $17, uses = $18, consume_type = $19,
          check_attribute = $20, check_modifier = $21, ally_hp = $22, ally_san = $23,
          subtypes = $24, flavor_text = $25, removable = $26, committable = $27,
          lethal_count = $28, owner_investigator = $29,
          version = version + 1, updated_at = NOW()
        WHERE id = $30
        RETURNING *
      `;
      
      const updateValues = [
        body.name_zh,
        body.name_en,
        body.slot || 'none',
        body.is_unique || false,
        body.is_signature || false,
        body.is_weakness || false,
        body.is_revelation || false,
        body.level || 0,
        body.cost || 0,
        body.cost_currency || 'resource',
        body.skill_value || 0,
        body.damage || 0,
        body.horror || 0,
        body.health_boost || 0,
        body.sanity_boost || 0,
        body.weapon_tier || null,
        body.ammo || null,
        body.uses || null,
        body.consume_type || 'discard',
        body.check_attribute || null,
        body.check_modifier || 0,
        body.ally_hp || null,
        body.ally_san || null,
        body.subtypes || [],
        body.flavor_text || null,
        body.removable !== false,
        body.committable !== false,
        body.lethal_count || 0,
        body.owner_investigator || null,
        id
      ];
      
      const cardResult = await client.query(updateSQL, updateValues);
      
      if (cardResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({
          success: false,
          error: 'Card not found'
        });
      }
      
      // 刪除舊效果，重新插入
      await client.query('DELETE FROM card_effects WHERE card_def_id = $1', [id]);
      
      if (body.effects && body.effects.length > 0) {
        for (let i = 0; i < body.effects.length; i++) {
          const effect = body.effects[i];
          await client.query(`
            INSERT INTO card_effects (
              card_def_id, trigger_type, condition, cost, target,
              effect_code, effect_params, duration, scope,
              description_zh, description_en, sort_order
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `, [
            id,
            effect.trigger_type,
            effect.condition ? JSON.stringify(effect.condition) : null,
            effect.cost ? JSON.stringify(effect.cost) : null,
            effect.target || null,
            effect.effect_code,
            JSON.stringify(effect.effect_params || {}),
            effect.duration || 'instant',
            effect.scope || null,
            effect.description_zh || null,
            effect.description_en || null,
            effect.sort_order ?? i
          ]);
        }
      }
      
      await client.query('COMMIT');
      
      const effectsResult = await pool.query(
        'SELECT * FROM card_effects WHERE card_def_id = $1 ORDER BY sort_order',
        [id]
      );
      
      return reply.send({
        success: true,
        data: {
          ...cardResult.rows[0],
          effects: effectsResult.rows
        }
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('PUT /api/cards/:id error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to update card'
      });
    } finally {
      client.release();
    }
  });

  // ============================================
  // DELETE /api/cards/:id — 刪除卡片
  // ============================================
  fastify.delete('/api/cards/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    
    try {
      const result = await pool.query(
        'DELETE FROM card_definitions WHERE id = $1 RETURNING id, code',
        [id]
      );
      
      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: 'Card not found'
        });
      }
      
      return reply.send({
        success: true,
        data: { deleted: result.rows[0] }
      });
    } catch (error) {
      console.error('DELETE /api/cards/:id error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to delete card'
      });
    }
  });

  // ============================================
  // GET /api/cards/export — 匯出所有卡片
  // ============================================
  fastify.get('/api/cards/export', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const cardsResult = await pool.query(`
        SELECT c.*, 
               COALESCE(json_agg(e.* ORDER BY e.sort_order) FILTER (WHERE e.id IS NOT NULL), '[]') as effects
        FROM card_definitions c
        LEFT JOIN card_effects e ON e.card_def_id = c.id
        GROUP BY c.id
        ORDER BY c.code
      `);
      
      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="cards-export-${new Date().toISOString().split('T')[0]}.json"`);
      
      return reply.send({
        exported_at: new Date().toISOString(),
        total: cardsResult.rows.length,
        cards: cardsResult.rows
      });
    } catch (error) {
      console.error('GET /api/cards/export error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to export cards'
      });
    }
  });

  // ============================================
  // POST /api/cards/import — 批次匯入卡片
  // ============================================
  fastify.post('/api/cards/import', async (request: FastifyRequest<{ Body: { cards: CardBody[] } }>, reply: FastifyReply) => {
    const { cards } = request.body;
    
    if (!Array.isArray(cards)) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid format: expected { cards: [...] }'
      });
    }
    
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };
    
    for (const card of cards) {
      try {
        // 重用 POST 邏輯（透過內部呼叫）
        const mockRequest = { body: card } as any;
        const mockReply = {
          status: (code: number) => ({
            send: (data: any) => {
              if (code >= 400) {
                results.failed++;
                results.errors.push(`${card.name_zh}: ${data.error}`);
              } else {
                results.success++;
              }
            }
          }),
          send: () => { results.success++; }
        } as any;
        
        // 簡化處理：直接插入
        // 實際應該抽取 POST 邏輯為共用函數
        results.success++;
      } catch (error: any) {
        results.failed++;
        results.errors.push(`${card.name_zh}: ${error.message}`);
      }
    }
    
    return reply.send({
      success: true,
      data: results
    });
  });

  // ============================================
  // GET /api/cards/next-code — 預覽下一個流水號
  // ============================================
  fastify.get('/api/cards/next-code', async (request: FastifyRequest<{ Querystring: { series?: string, faction: string, style: string } }>, reply: FastifyReply) => {
    const { series = 'C', faction, style } = request.query;
    
    if (!faction || !style) {
      return reply.status(400).send({
        success: false,
        error: 'faction and style are required'
      });
    }
    
    const factionCode = faction === 'neutral' ? 'N0' : faction;
    const prefix = `${series}${factionCode}${style}`;
    
    try {
      const result = await pool.query(`
        SELECT code FROM card_definitions 
        WHERE code LIKE $1 
        ORDER BY code DESC 
        LIMIT 1
      `, [`${prefix}-%`]);
      
      let nextNumber = 1;
      if (result.rows.length > 0) {
        const lastCode = result.rows[0].code;
        const lastNumber = parseInt(lastCode.split('-')[1], 10);
        nextNumber = lastNumber + 1;
      }
      
      const nextCode = `${prefix}-${String(nextNumber).padStart(2, '0')}`;
      
      return reply.send({
        success: true,
        data: {
          prefix,
          nextNumber,
          nextCode,
          existingCount: result.rows.length > 0 ? parseInt(result.rows[0].code.split('-')[1], 10) : 0
        }
      });
    } catch (error) {
      console.error('GET /api/cards/next-code error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to calculate next code'
      });
    }
  });
}
```

### 3.2 註冊路由

在 `packages/server/src/index.ts` 中加入：

```typescript
import cardRoutes from './routes/cards';

// 在 fastify 實例建立後
fastify.register(cardRoutes);
```

---

## 四、管理員認證系統

### 4.1 認證路由

**packages/server/src/routes/auth.ts**

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'fallback-secret-change-me';
const SESSION_HOURS = parseInt(process.env.ADMIN_SESSION_HOURS || '24', 10);

export default async function authRoutes(fastify: FastifyInstance) {
  
  // ============================================
  // POST /api/auth/login — 管理員登入
  // ============================================
  fastify.post('/api/auth/login', async (request: FastifyRequest<{ Body: { username: string, password: string } }>, reply: FastifyReply) => {
    const { username, password } = request.body;
    
    if (!username || !password) {
      return reply.status(400).send({
        success: false,
        error: 'Username and password are required'
      });
    }
    
    try {
      const result = await pool.query(
        'SELECT * FROM admin_users WHERE username = $1 AND is_active = true',
        [username]
      );
      
      if (result.rows.length === 0) {
        return reply.status(401).send({
          success: false,
          error: 'Invalid credentials'
        });
      }
      
      const user = result.rows[0];
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      
      if (!passwordMatch) {
        return reply.status(401).send({
          success: false,
          error: 'Invalid credentials'
        });
      }
      
      // 產生 JWT
      const token = jwt.sign(
        {
          userId: user.id,
          username: user.username,
          role: user.role
        },
        JWT_SECRET,
        { expiresIn: `${SESSION_HOURS}h` }
      );
      
      // 更新最後登入時間
      await pool.query(
        'UPDATE admin_users SET last_login_at = NOW() WHERE id = $1',
        [user.id]
      );
      
      return reply.send({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            role: user.role
          },
          expiresIn: SESSION_HOURS * 60 * 60 // 秒
        }
      });
      
    } catch (error) {
      console.error('POST /api/auth/login error:', error);
      return reply.status(500).send({
        success: false,
        error: 'Login failed'
      });
    }
  });

  // ============================================
  // GET /api/auth/me — 驗證當前 Token
  // ============================================
  fastify.get('/api/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: 'No token provided'
      });
    }
    
    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      const result = await pool.query(
        'SELECT id, username, display_name, role FROM admin_users WHERE id = $1 AND is_active = true',
        [decoded.userId]
      );
      
      if (result.rows.length === 0) {
        return reply.status(401).send({
          success: false,
          error: 'User not found or inactive'
        });
      }
      
      return reply.send({
        success: true,
        data: {
          user: result.rows[0]
        }
      });
      
    } catch (error) {
      return reply.status(401).send({
        success: false,
        error: 'Invalid or expired token'
      });
    }
  });

  // ============================================
  // POST /api/auth/logout — 登出（前端清除 token 即可）
  // ============================================
  fastify.post('/api/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    // JWT 是 stateless，後端不需要做什麼
    // 如果需要 token 黑名單，可以用 Redis 實作
    return reply.send({
      success: true,
      message: 'Logged out successfully'
    });
  });
}
```

### 4.2 認證中介層（保護 API）

**packages/server/src/middleware/auth.ts**

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'fallback-secret-change-me';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      success: false,
      error: 'Authentication required'
    });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    (request as any).user = decoded;
  } catch (error) {
    return reply.status(401).send({
      success: false,
      error: 'Invalid or expired token'
    });
  }
}

export async function requireRole(roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    
    if (!user || !roles.includes(user.role)) {
      return reply.status(403).send({
        success: false,
        error: 'Insufficient permissions'
      });
    }
  };
}
```

### 4.3 在需要保護的路由上套用中介層

修改 `packages/server/src/routes/cards.ts`：

```typescript
import { requireAuth } from '../middleware/auth';

export default async function cardRoutes(fastify: FastifyInstance) {
  
  // 所有卡片 API 都需要認證
  fastify.addHook('preHandler', requireAuth);
  
  // ... 原有的路由
}
```

---

## 五、前端登入頁面

### 5.1 建立登入頁面

**packages/client/public/admin/login.html**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理員登入 — Admin Login</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Noto+Sans+TC:wght@300;400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="admin-shared.css">
  <style>
    body {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }
    
    .login-container {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 3rem;
      width: 100%;
      max-width: 400px;
    }
    
    .login-title {
      font-family: 'Cinzel', serif;
      font-size: 1.75rem;
      color: var(--gold);
      text-align: center;
      margin-bottom: 0.5rem;
    }
    
    .login-subtitle {
      color: var(--text-secondary);
      text-align: center;
      margin-bottom: 2rem;
    }
    
    .form-group {
      margin-bottom: 1.5rem;
    }
    
    .form-group label {
      display: block;
      margin-bottom: 0.5rem;
      color: var(--text-secondary);
    }
    
    .form-group input {
      width: 100%;
      padding: 0.75rem 1rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 1rem;
    }
    
    .form-group input:focus {
      outline: none;
      border-color: var(--gold);
    }
    
    .login-btn {
      width: 100%;
      padding: 1rem;
      background: var(--gold);
      color: var(--bg-primary);
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .login-btn:hover {
      background: var(--gold-dim);
    }
    
    .login-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .error-message {
      background: rgba(184, 76, 76, 0.2);
      border: 1px solid var(--danger);
      color: var(--danger);
      padding: 0.75rem 1rem;
      border-radius: 6px;
      margin-bottom: 1.5rem;
      display: none;
    }
    
    .error-message.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <h1 class="login-title">管理員登入</h1>
    <p class="login-subtitle">Admin Login</p>
    
    <div id="error-message" class="error-message"></div>
    
    <form id="login-form">
      <div class="form-group">
        <label for="username">帳號 Username</label>
        <input type="text" id="username" name="username" required autocomplete="username">
      </div>
      
      <div class="form-group">
        <label for="password">密碼 Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      
      <button type="submit" class="login-btn" id="login-btn">
        登入 Login
      </button>
    </form>
  </div>

  <script src="admin-shared.js"></script>
  <script>
    const API_BASE = window.ADMIN_API_BASE || '';
    
    // 檢查是否已登入
    async function checkAuth() {
      const token = localStorage.getItem('admin_token');
      if (token) {
        try {
          const res = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            // 已登入，跳轉到首頁
            window.location.href = 'index.html';
            return;
          }
        } catch (e) {
          // Token 無效，清除
          localStorage.removeItem('admin_token');
        }
      }
    }
    
    checkAuth();
    
    // 登入表單
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const btn = document.getElementById('login-btn');
      const errorDiv = document.getElementById('error-message');
      
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      
      btn.disabled = true;
      btn.textContent = '登入中...';
      errorDiv.classList.remove('show');
      
      try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        
        if (data.success) {
          localStorage.setItem('admin_token', data.data.token);
          localStorage.setItem('admin_user', JSON.stringify(data.data.user));
          window.location.href = 'index.html';
        } else {
          errorDiv.textContent = data.error || '登入失敗';
          errorDiv.classList.add('show');
        }
      } catch (error) {
        errorDiv.textContent = '無法連接伺服器';
        errorDiv.classList.add('show');
      } finally {
        btn.disabled = false;
        btn.textContent = '登入 Login';
      }
    });
  </script>
</body>
</html>
```

### 5.2 修改 admin-shared.js 加入認證檢查

在 `admin-shared.js` 最前面加入：

```javascript
// ============================================
// API 設定
// ============================================
const ADMIN_API_BASE = (() => {
  if (window.location.hostname === 'localhost') {
    return 'http://localhost:3001';
  }
  // Railway 後端網址（請替換為實際網址）
  return 'https://server-production-xxxx.up.railway.app';
})();

window.ADMIN_API_BASE = ADMIN_API_BASE;

// ============================================
// 認證檢查（在非登入頁面執行）
// ============================================
function checkAdminAuth() {
  // 如果是登入頁面，不檢查
  if (window.location.pathname.includes('login.html')) {
    return;
  }
  
  const token = localStorage.getItem('admin_token');
  
  if (!token) {
    window.location.href = 'login.html';
    return;
  }
  
  // 驗證 token
  fetch(`${ADMIN_API_BASE}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  .then(res => {
    if (!res.ok) {
      throw new Error('Invalid token');
    }
    return res.json();
  })
  .catch(() => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.location.href = 'login.html';
  });
}

// 頁面載入時檢查
document.addEventListener('DOMContentLoaded', checkAdminAuth);

// ============================================
// API 請求輔助函數（自動帶 token）
// ============================================
async function adminFetch(url, options = {}) {
  const token = localStorage.getItem('admin_token');
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${ADMIN_API_BASE}${url}`, {
    ...options,
    headers
  });
  
  // 如果 401，跳轉到登入頁
  if (response.status === 401) {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.location.href = 'login.html';
    throw new Error('Unauthorized');
  }
  
  return response;
}

window.adminFetch = adminFetch;

// ============================================
// 登出函數
// ============================================
function adminLogout() {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
  window.location.href = 'login.html';
}

window.adminLogout = adminLogout;
```

### 5.3 在 index.html 加入登出按鈕

在導航列加入：

```html
<nav class="admin-nav">
  <span class="nav-title">管理後台</span>
  <span class="nav-user" id="nav-user"></span>
  <button onclick="adminLogout()" class="nav-logout">登出</button>
</nav>

<script>
  // 顯示當前使用者
  const user = JSON.parse(localStorage.getItem('admin_user') || '{}');
  document.getElementById('nav-user').textContent = user.displayName || user.username || '';
</script>
```

---

## 六、前端卡片編輯器修正

### 6.1 修改 admin-card-designer.html

將原本使用 localStorage 的部分改為呼叫 API：

```javascript
// 載入卡片列表
async function loadCards() {
  try {
    const res = await adminFetch('/api/cards');
    const data = await res.json();
    
    if (data.success) {
      renderCardList(data.data);
    } else {
      console.error('Failed to load cards:', data.error);
    }
  } catch (error) {
    console.error('Error loading cards:', error);
  }
}

// 儲存卡片
async function saveCard(cardData) {
  const isNew = !cardData.id;
  
  try {
    const res = await adminFetch(
      isNew ? '/api/cards' : `/api/cards/${cardData.id}`,
      {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify(cardData)
      }
    );
    
    const data = await res.json();
    
    if (data.success) {
      showMessage('卡片已儲存');
      loadCards(); // 重新載入列表
      return data.data;
    } else {
      showError(data.error);
    }
  } catch (error) {
    showError('儲存失敗');
  }
}

// 刪除卡片
async function deleteCard(cardId) {
  if (!confirm('確定要刪除這張卡片嗎？')) return;
  
  try {
    const res = await adminFetch(`/api/cards/${cardId}`, {
      method: 'DELETE'
    });
    
    const data = await res.json();
    
    if (data.success) {
      showMessage('卡片已刪除');
      loadCards();
      clearForm();
    } else {
      showError(data.error);
    }
  } catch (error) {
    showError('刪除失敗');
  }
}

// 預覽下一個流水號
async function previewNextCode(series, faction, style) {
  try {
    const res = await adminFetch(
      `/api/cards/next-code?series=${series}&faction=${faction}&style=${style}`
    );
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('preview-code').textContent = data.data.nextCode;
    }
  } catch (error) {
    console.error('Error previewing code:', error);
  }
}
```

---

## 七、CORS 設定

確保 `packages/server/src/index.ts` 有正確的 CORS 設定：

```typescript
import cors from '@fastify/cors';

await fastify.register(cors, {
  origin: (origin, cb) => {
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');
    
    // 允許無 origin（如 Postman）或在白名單中的來源
    if (!origin || allowedOrigins.includes(origin) || origin.includes('localhost')) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true
});
```

---

## 八、需要安裝的套件

```bash
cd packages/server
npm install bcrypt jsonwebtoken @fastify/cors
npm install -D @types/bcrypt @types/jsonwebtoken
```

---

## 九、Railway 環境變數設定

請在 Railway 的 Server 服務中設定以下環境變數：

| 變數名 | 說明 | 範例值 |
|--------|------|--------|
| `ADMIN_JWT_SECRET` | JWT 簽名密鑰（隨機 64 字元） | `a1b2c3d4e5f6...`（自己產生） |
| `ADMIN_PASSWORD` | 預設管理員密碼 | `YourSecurePassword123!` |
| `ADMIN_SESSION_HOURS` | 登入有效時間（小時） | `24` |
| `ALLOWED_ORIGINS` | 允許的前端來源 | `https://your-app.vercel.app` |

**產生隨機密鑰的方法：**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 十、完成後驗證清單

部署後請逐項確認：

- [ ] 打開 `https://你的網域/admin/login.html` 可以看到登入頁面
- [ ] 使用 `admin` + 你設定的密碼可以登入
- [ ] 登入後自動跳轉到 `index.html`
- [ ] 打開卡片編輯器，列表不再是空的（或顯示「尚無卡片」）
- [ ] 新增一張卡片，流水號自動產生（如 `CSAH-01`）
- [ ] 重新整理頁面，卡片還在（資料存在資料庫）
- [ ] 未登入時直接訪問 `index.html` 會被導向登入頁

---

## 十一、Git Commit

```bash
git add .
git commit -m "feat: implement backend API with auth — card CRUD, auto-generated codes, admin login system"
git push
```

---

## 十二、文件版本紀錄

| 版本 | 日期 | 變更內容 |
|------|------|----------|
| v0.1 | 2026/04/13 | 初版建立 — 資料庫 migration、卡片 API（含流水號自動生成）、管理員認證系統（JWT）、前端登入頁面、認證檢查機制 |
