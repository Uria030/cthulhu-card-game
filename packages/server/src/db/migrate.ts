import { pool } from './pool.js';

const MIGRATION_SQL = `
-- ============================================
-- Migration 001: Card tables + Admin tables
-- ============================================

DO $$ BEGIN
  CREATE TYPE card_type AS ENUM ('asset', 'event', 'ally', 'skill');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE card_slot AS ENUM (
    'one_hand', 'two_hand', 'head', 'body',
    'accessory', 'arcane', 'talent', 'expertise', 'none'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE consume_type AS ENUM (
    'stay', 'discard', 'long_rest', 'short_rest', 'removed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS card_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(32) UNIQUE NOT NULL,
  series          VARCHAR(8) NOT NULL DEFAULT 'C',
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128) NOT NULL,
  faction         VARCHAR(8) NOT NULL,
  style           VARCHAR(4) NOT NULL,
  card_type       card_type NOT NULL,
  slot            card_slot NOT NULL DEFAULT 'none',
  is_unique       BOOLEAN NOT NULL DEFAULT FALSE,
  is_signature    BOOLEAN NOT NULL DEFAULT FALSE,
  is_weakness     BOOLEAN NOT NULL DEFAULT FALSE,
  is_revelation   BOOLEAN NOT NULL DEFAULT FALSE,
  level           INTEGER NOT NULL DEFAULT 0,
  cost            INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0 AND cost <= 6),
  cost_currency   VARCHAR(32) NOT NULL DEFAULT 'resource',
  skill_value     INTEGER NOT NULL DEFAULT 0 CHECK (skill_value >= 0 AND skill_value <= 5),
  damage          INTEGER NOT NULL DEFAULT 0,
  horror          INTEGER NOT NULL DEFAULT 0,
  health_boost    INTEGER NOT NULL DEFAULT 0,
  sanity_boost    INTEGER NOT NULL DEFAULT 0,
  weapon_tier     INTEGER CHECK (weapon_tier IS NULL OR (weapon_tier >= 1 AND weapon_tier <= 6)),
  ammo            INTEGER,
  uses            INTEGER,
  consume_type    consume_type NOT NULL DEFAULT 'discard',
  check_attribute VARCHAR(16),
  check_modifier  INTEGER DEFAULT 0,
  check_method    VARCHAR(16) DEFAULT 'dice',
  hand_limit_mod  INTEGER DEFAULT 0,
  ally_hp         INTEGER,
  ally_san        INTEGER,
  subtypes        TEXT[] DEFAULT '{}',
  flavor_text     TEXT,
  removable       BOOLEAN DEFAULT TRUE,
  committable     BOOLEAN DEFAULT TRUE,
  lethal_count    INTEGER DEFAULT 0,
  owner_investigator VARCHAR(64),
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cards_faction ON card_definitions(faction);
CREATE INDEX IF NOT EXISTS idx_cards_type ON card_definitions(card_type);
CREATE INDEX IF NOT EXISTS idx_cards_code ON card_definitions(code);
CREATE INDEX IF NOT EXISTS idx_cards_series_faction_style ON card_definitions(series, faction, style);

CREATE TABLE IF NOT EXISTS card_effects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_def_id     UUID NOT NULL REFERENCES card_definitions(id) ON DELETE CASCADE,
  trigger_type    VARCHAR(32) NOT NULL,
  condition       JSONB,
  cost            JSONB,
  target          VARCHAR(32),
  effect_code     VARCHAR(64) NOT NULL,
  effect_params   JSONB NOT NULL DEFAULT '{}',
  duration        VARCHAR(32) DEFAULT 'instant',
  scope           VARCHAR(16),
  description_zh  TEXT,
  description_en  TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_effects_card ON card_effects(card_def_id);

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
`;

const MIGRATION_002_SQL = `
-- ============================================
-- Migration 002: Combat style & attribute modifiers
-- ============================================

-- Add new columns (idempotent)
DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN combat_style VARCHAR(32);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN attribute_modifiers JSONB NOT NULL DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Migrate old check_attribute/check_modifier data if columns exist
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='card_definitions' AND column_name='check_attribute') THEN
    UPDATE card_definitions
    SET attribute_modifiers = jsonb_build_object(check_attribute, COALESCE(check_modifier, 0))
    WHERE check_attribute IS NOT NULL AND check_attribute != ''
      AND (attribute_modifiers IS NULL OR attribute_modifiers = '{}'::jsonb);
  END IF;
END $$;

-- Drop old columns if they exist
ALTER TABLE card_definitions DROP COLUMN IF EXISTS check_attribute;
ALTER TABLE card_definitions DROP COLUMN IF EXISTS check_modifier;
ALTER TABLE card_definitions DROP COLUMN IF EXISTS check_method;

-- Index
CREATE INDEX IF NOT EXISTS idx_cards_combat_style ON card_definitions(combat_style);
`;

const MIGRATION_003_SQL = `
-- ============================================
-- Migration 003: Spell system + XP cost fields
-- ============================================

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN spell_type VARCHAR(32);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN spell_casting VARCHAR(32);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN xp_cost INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
`;

const MIGRATION_004_SQL = `
-- ============================================
-- Migration 004: Triple-use system (commit icons + consume effects)
-- ============================================

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN commit_icons JSONB NOT NULL DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN consume_enabled BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN consume_effect JSONB;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
`;

const MIGRATION_005_SQL = `
-- ============================================
-- Migration 005: Book/Relic system + Upgrade path
-- ============================================

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN is_book BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN is_relic BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN study_method VARCHAR(16);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN study_required INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN study_test_attribute VARCHAR(16);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN study_test_dc INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN study_difficulty_tier INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN study_upgrade_card VARCHAR(32);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN upgrades JSONB NOT NULL DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
`;

// Migration 006: Exceptional flag + Transform system (v1.1 修正案)
const MIGRATION_006_SQL = `
DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN is_exceptional BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN transform_to TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN transform_condition VARCHAR(64);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN transform_reversible BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
`;

export async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('Running database migrations...');
    await client.query(MIGRATION_SQL);
    await client.query(MIGRATION_002_SQL);
    await client.query(MIGRATION_003_SQL);
    await client.query(MIGRATION_004_SQL);
    await client.query(MIGRATION_005_SQL);
    await client.query(MIGRATION_006_SQL);
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
