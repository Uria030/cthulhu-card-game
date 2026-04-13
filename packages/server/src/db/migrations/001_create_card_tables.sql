-- ============================================
-- 卡片定義表 card_definitions
-- ============================================

DROP TYPE IF EXISTS card_type CASCADE;
DROP TYPE IF EXISTS card_slot CASCADE;
DROP TYPE IF EXISTS consume_type CASCADE;

CREATE TYPE card_type AS ENUM ('asset', 'event', 'ally', 'skill');

CREATE TYPE card_slot AS ENUM (
  'one_hand', 'two_hand', 'head', 'body',
  'accessory', 'arcane', 'talent', 'expertise', 'none'
);

CREATE TYPE consume_type AS ENUM (
  'stay', 'discard', 'long_rest', 'short_rest', 'removed'
);

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

-- ============================================
-- 卡片效果表 card_effects
-- ============================================

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
-- 管理員 Session 表
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
