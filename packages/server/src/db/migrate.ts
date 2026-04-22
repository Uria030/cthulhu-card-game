import { pool } from './pool.js';
import type { PoolClient } from 'pg';
import { innsmouthCampaignSeed } from './seeds/mod06-campaigns.js';

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

// Migration 007: Combat styles, specializations, style cards + seed data
const MIGRATION_007_SQL = `
-- ============================================
-- Migration 007: Combat styles / specializations / style cards
-- ============================================

CREATE TABLE IF NOT EXISTS combat_styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(32) UNIQUE NOT NULL,
  name_zh VARCHAR(64) NOT NULL,
  name_en VARCHAR(64) NOT NULL,
  description_zh TEXT,
  description_en TEXT,
  spec_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS combat_specializations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  style_id UUID NOT NULL REFERENCES combat_styles(id) ON DELETE CASCADE,
  code VARCHAR(64) UNIQUE NOT NULL,
  name_zh VARCHAR(64) NOT NULL,
  name_en VARCHAR(64) NOT NULL,
  description_zh TEXT,
  description_en TEXT,
  attribute VARCHAR(16) NOT NULL DEFAULT '',
  prof_bonus INTEGER NOT NULL DEFAULT 1,
  spec_bonus INTEGER NOT NULL DEFAULT 2,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS combat_style_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  style_id UUID NOT NULL REFERENCES combat_styles(id) ON DELETE CASCADE,
  code VARCHAR(64) UNIQUE NOT NULL,
  name_zh VARCHAR(64) NOT NULL,
  name_en VARCHAR(64) NOT NULL,
  check_attribute VARCHAR(16) NOT NULL,
  narrative_attack_zh TEXT NOT NULL DEFAULT '',
  narrative_attack_en TEXT,
  narrative_success_zh TEXT NOT NULL DEFAULT '',
  narrative_success_en TEXT,
  narrative_fail_zh TEXT NOT NULL DEFAULT '',
  narrative_fail_en TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_specs_style ON combat_specializations(style_id);
CREATE INDEX IF NOT EXISTS idx_style_cards_style ON combat_style_cards(style_id);

-- Seed: 8 combat styles
INSERT INTO combat_styles (code, name_zh, name_en, sort_order) VALUES
  ('shooting',  '槍枝射擊', 'Shooting',          1),
  ('archery',   '弓術',     'Archery',            2),
  ('sidearm',   '隨身武器', 'Sidearm',            3),
  ('military',  '軍用武器', 'Military Weapons',   4),
  ('brawl',     '搏擊',     'Brawl',              5),
  ('arcane',    '施法',     'Arcane',             6),
  ('engineer',  '工兵',     'Engineer',           7),
  ('assassin',  '暗殺',     'Assassination',      8)
ON CONFLICT (code) DO NOTHING;

-- Seed: 30 combat specializations
INSERT INTO combat_specializations (style_id, code, name_zh, name_en, attribute, sort_order) VALUES
  ((SELECT id FROM combat_styles WHERE code = 'shooting'),  'shooting_rifle',     '步槍',       'Rifle',              '', 1),
  ((SELECT id FROM combat_styles WHERE code = 'shooting'),  'shooting_smg',       '衝鋒槍',     'Submachine Gun',     '', 2),
  ((SELECT id FROM combat_styles WHERE code = 'shooting'),  'shooting_dual',      '雙槍',       'Dual Pistols',       '', 3),
  ((SELECT id FROM combat_styles WHERE code = 'shooting'),  'shooting_pistol',    '手槍',       'Pistol',             '', 4),
  ((SELECT id FROM combat_styles WHERE code = 'archery'),   'archery_hunter',     '獵手',       'Hunter',             '', 1),
  ((SELECT id FROM combat_styles WHERE code = 'archery'),   'archery_rapid',      '連射',       'Rapid Fire',         '', 2),
  ((SELECT id FROM combat_styles WHERE code = 'archery'),   'archery_poison',     '毒箭',       'Poison Arrow',       '', 3),
  ((SELECT id FROM combat_styles WHERE code = 'archery'),   'archery_silent',     '無聲射手',   'Silent Marksman',    '', 4),
  ((SELECT id FROM combat_styles WHERE code = 'sidearm'),   'sidearm_dagger',     '匕首術',     'Dagger Arts',        '', 1),
  ((SELECT id FROM combat_styles WHERE code = 'sidearm'),   'sidearm_parry',      '護身格擋',   'Parry Guard',        '', 2),
  ((SELECT id FROM combat_styles WHERE code = 'sidearm'),   'sidearm_blunt',      '鈍擊',       'Blunt Strike',       '', 3),
  ((SELECT id FROM combat_styles WHERE code = 'sidearm'),   'sidearm_street',     '街頭格鬥',   'Street Fighting',    '', 4),
  ((SELECT id FROM combat_styles WHERE code = 'military'),  'military_twohanded', '雙手武器',   'Two-Handed',         '', 1),
  ((SELECT id FROM combat_styles WHERE code = 'military'),  'military_defense',   '防禦架式',   'Defensive Stance',   '', 2),
  ((SELECT id FROM combat_styles WHERE code = 'military'),  'military_dual',      '雙持',       'Dual Wield',         '', 3),
  ((SELECT id FROM combat_styles WHERE code = 'military'),  'military_polearm',   '長柄武器',   'Polearm',            '', 4),
  ((SELECT id FROM combat_styles WHERE code = 'brawl'),     'brawl_tavern',       '酒館鬥毆者', 'Tavern Brawler',     '', 1),
  ((SELECT id FROM combat_styles WHERE code = 'brawl'),     'brawl_wrestler',     '摔角大師',   'Wrestler',           '', 2),
  ((SELECT id FROM combat_styles WHERE code = 'brawl'),     'brawl_karate',       '空手道',     'Karate',             '', 3),
  ((SELECT id FROM combat_styles WHERE code = 'arcane'),    'arcane_ritual',      '儀式',       'Ritual',             '', 1),
  ((SELECT id FROM combat_styles WHERE code = 'arcane'),    'arcane_incantation', '咒語',       'Incantation',        '', 2),
  ((SELECT id FROM combat_styles WHERE code = 'arcane'),    'arcane_channeling',  '引導',       'Channeling',         '', 3),
  ((SELECT id FROM combat_styles WHERE code = 'arcane'),    'arcane_meditation',  '冥想',       'Meditation',         '', 4),
  ((SELECT id FROM combat_styles WHERE code = 'arcane'),    'arcane_alchemy',     '煉金',       'Alchemy',            '', 5),
  ((SELECT id FROM combat_styles WHERE code = 'engineer'),  'engineer_demolition','爆破',       'Demolition',         '', 1),
  ((SELECT id FROM combat_styles WHERE code = 'engineer'),  'engineer_trap',      '陷阱',       'Trap',               '', 2),
  ((SELECT id FROM combat_styles WHERE code = 'engineer'),  'engineer_mechanic',  '機械',       'Mechanic',           '', 3),
  ((SELECT id FROM combat_styles WHERE code = 'assassin'),  'assassin_execute',   '無聲處決',   'Silent Execution',   '', 1),
  ((SELECT id FROM combat_styles WHERE code = 'assassin'),  'assassin_ambush',    '伏擊戰術',   'Ambush Tactics',     '', 2),
  ((SELECT id FROM combat_styles WHERE code = 'assassin'),  'assassin_hidden',    '暗器',       'Hidden Weapons',     '', 3)
ON CONFLICT (code) DO NOTHING;

-- Update spec_count
UPDATE combat_styles SET spec_count = (
  SELECT COUNT(*) FROM combat_specializations WHERE style_id = combat_styles.id
);
`;

// Migration 008: Spirit definitions + depth effects + seed data
const MIGRATION_008_SQL = `
-- ============================================
-- Migration 008: Team spirit definitions system
-- ============================================

CREATE TABLE IF NOT EXISTS spirit_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(64) UNIQUE NOT NULL,
  name_zh VARCHAR(64) NOT NULL,
  name_en VARCHAR(64) NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'combat'
    CHECK (category IN ('combat','investigation','resource','growth','knowledge','rhythm','status','bestiary')),
  description TEXT,
  description_en TEXT,
  design_notes TEXT,
  adopt_effect_zh TEXT,
  adopt_effect_en TEXT,
  maxed_effect_zh TEXT,
  maxed_effect_en TEXT,
  milestone_name_zh VARCHAR(64),
  milestone_name_en VARCHAR(64),
  milestone_desc TEXT,
  milestone_effect_zh TEXT,
  milestone_effect_en TEXT,
  total_value DECIMAL(5,1) NOT NULL DEFAULT 0,
  value_per_cohesion DECIMAL(5,2) NOT NULL DEFAULT 0,
  effect_tags JSONB NOT NULL DEFAULT '[]',
  design_status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (design_status IN ('pending','partial','complete')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spirit_depth_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spirit_def_id UUID NOT NULL REFERENCES spirit_definitions(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 5),
  effect_name_zh VARCHAR(64),
  effect_name_en VARCHAR(64),
  effect_desc_zh TEXT NOT NULL DEFAULT '',
  effect_desc_en TEXT,
  effect_value DECIMAL(5,1) NOT NULL DEFAULT 0,
  effect_formula TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (spirit_def_id, depth)
);
CREATE INDEX IF NOT EXISTS idx_spirit_depth_spirit ON spirit_depth_effects(spirit_def_id);

-- Seed: 33 team spirits
INSERT INTO spirit_definitions (code, name_zh, name_en, category, description, sort_order) VALUES
  ('ts_focus_fire',    '集火協調', 'Focus Fire',              'combat',        '多人攻擊同一目標時觸發聯動加成', 1),
  ('ts_cover',         '掩護戰術', 'Cover Tactics',           'combat',        '替隊友承受藉機攻擊或部分傷害', 2),
  ('ts_morale',        '殲滅士氣', 'Kill Morale',             'combat',        '擊殺敵人時全隊獲得增益', 3),
  ('ts_last_stand',    '死線爆發', 'Last Stand',              'combat',        '任一隊友進入瀕死時，其他隊友獲得戰鬥增幅', 4),
  ('ts_overwatch',     '輪替守望', 'Overwatch',               'combat',        '指定隊友進入守望，敵人進入其地點時觸發免費攻擊', 5),
  ('ts_vendetta',      '復仇之誓', 'Vendetta',                'combat',        '隊友被擊倒時，對擊倒者攻擊獲得額外傷害', 6),
  ('ts_clue_chain',    '線索連鎖', 'Clue Chain',              'investigation', '同一回合內於不同地點各自獲得線索時觸發額外獎勵', 7),
  ('ts_intuition',     '隱秘感知', 'Hidden Intuition',        'investigation', '降低隱藏調查點的感知門檻，強化發現機制', 8),
  ('ts_relic_read',    '遺跡解讀', 'Relic Reading',           'investigation', '解鎖研究神話遺跡的能力，5 點深度對應遺跡難度等級', 9),
  ('ts_relic_research','遺跡研究', 'Relic Research',          'investigation', '強化遺跡研究效率', 10),
  ('ts_growth',        '成長加速', 'Growth Accelerator',      'resource',      '增加經驗值、凝聚力、天賦點的獲取量', 11),
  ('ts_harvest',       '素材豐收', 'Material Harvest',        'resource',      '增加素材掉落與採集收益', 12),
  ('ts_spoils',        '戰利強化', 'Spoils of War',           'resource',      '增加關卡內即時收益（資源、抽牌等）', 13),
  ('ts_forge_unlock',  '鍛造解鎖', 'Forge Unlock',            'growth',        '開啟鍛造功能，深度點數強化鍛造能力', 14),
  ('ts_craft_unlock',  '製作解鎖', 'Craft Unlock',            'growth',        '開啟製作功能，深度點數強化製作能力', 15),
  ('ts_short_rest',    '短休息強化','Short Rest Enhancement',  'growth',        '短休息時保留部分行動力', 16),
  ('ts_chaos_control', '混沌袋控制','Chaos Bag Control',       'growth',        '混沌袋操控能力（窺探、重抽、移除標記等）', 17),
  ('ts_ancient_text',  '古文解讀', 'Ancient Text',            'knowledge',     '解鎖閱讀神話典籍的能力，5 點深度對應書籍難度等級。1 點＝初階神話文獻（入門級翻譯文本、邪教筆記）。2 點＝中階（《波納佩教典》《格拉基啟示錄》）。3 點＝高階（《伊波恩之書》《無名祭祀書》）。4 點＝頂級（《屍食教典儀》《妖蛆之秘密》）。5 點＝終極禁忌典籍（《死靈之書》）。', 18),
  ('ts_book_research', '書籍研究', 'Book Research',           'knowledge',     '強化書籍閱讀效率', 19),
  ('ts_stratagem',     '戰術預謀', 'Stratagem',               'rhythm',        '回合開始時宣告全隊戰術狀態，全隊獲得小幅加成', 20),
  ('ts_war_cry',       '戰場呼喊', 'War Cry',                 'rhythm',        '關鍵時刻觸發的強力全隊 BUFF', 21),
  ('ts_corrosion',     '腐蝕專精', 'Corrosion Mastery',       'status',        '涵蓋狀態：流血（bleed, 2V/層）、中毒（poison, 3V/層）、燃燒（burning, 3V/層）。強化施加這些狀態的效果與持續性。', 22),
  ('ts_frost',         '寒霜專精', 'Frost Mastery',           'status',        '涵蓋狀態：冷凍（frozen, 3V/層）、潮濕（wet, 1V/層）。強化冰系與水系的控場能力，利用冷凍的移動限制和潮濕的雷屬性增傷聯動。', 23),
  ('ts_suppress',      '壓制專精', 'Suppression Mastery',     'status',        '涵蓋狀態：無力（weakness_status, 2V/層）、弱化（weakened, 3V/層）、脆弱（vulnerable, 2V/層）、繳械（disarm, 4V/層）。弱化敵人輸出與防禦能力。', 24),
  ('ts_disrupt',       '瓦解專精', 'Disruption Mastery',      'status',        '涵蓋狀態：發瘋（madness, 6V/層）、疲勞（fatigue, 4V/層）、沈默（silence, 4V/層）。瓦解敵人行動能力的精神系控場。', 25),
  ('ts_purify',        '淨化專精', 'Purification Mastery',    'status',        '涵蓋：全部負面狀態（移除自身）。防禦面專精，強化隊伍的負面狀態清除與抵抗能力。', 26),
  ('ts_bestiary_cthulhu','怪物學：克蘇魯','Bestiary: Cthulhu',  'bestiary',      '克蘇魯眷族。揭露克蘇魯系怪物的弱點、行為模式與隱藏資訊。混沌袋偏好：骷髏＝血祭（流血）、邪教徒＝信徒回應（深潛者增援）、石版＝禁忌知識（恐懼傷害）、遠古邪物＝異界滲透（鬧鬼）。', 27),
  ('ts_bestiary_hastur','怪物學：哈斯塔','Bestiary: Hastur',    'bestiary',      '哈斯塔眷族。混沌袋偏好：骷髏＝生命流逝（無力）、邪教徒＝末日推進（毀滅標記）、石版＝瘋狂低語（發瘋）、遠古邪物＝時空扭曲（隨機傳送）。', 28),
  ('ts_bestiary_shub', '怪物學：莎布', 'Bestiary: Shub-Niggurath','bestiary',   '莎布·尼古拉絲眷族。混沌袋偏好：骷髏＝死亡之觸（HP 傷害）、邪教徒＝儀式共鳴（怪物回血）、石版＝精神枯竭（疲勞）、遠古邪物＝裂隙擴張（次元門）。', 29),
  ('ts_bestiary_nyar', '怪物學：奈亞', 'Bestiary: Nyarlathotep','bestiary',     '奈亞拉托提普眷族。混沌袋偏好：骷髏＝生命代價（失去盟友）、邪教徒＝暴露（失去隱蔽）、石版＝不應知曉之事（神啟卡）、遠古邪物＝空間斷裂（斷開連接）。', 30),
  ('ts_bestiary_yog',  '怪物學：猶格', 'Bestiary: Yog-Sothoth', 'bestiary',    '猶格·索托斯眷族。混沌袋偏好：骷髏＝血祭（流血）、邪教徒＝末日推進（毀滅標記）、石版＝記憶崩解（棄手牌）、遠古邪物＝時空扭曲（隨機傳送）。', 31),
  ('ts_bestiary_cthugha','怪物學：克圖格亞','Bestiary: Cthugha','bestiary',     '克圖格亞眷族。混沌袋偏好：骷髏＝死亡之觸（HP 傷害）、邪教徒＝暴露（失去隱蔽）、石版＝禁忌知識（恐懼傷害）、遠古邪物＝異界之火（失火）。', 32),
  ('ts_bestiary_yig',  '怪物學：伊格', 'Bestiary: Yig',         'bestiary',    '伊格眷族（預留擴展）。混沌袋偏好：骷髏＝血祭（流血）、邪教徒＝信徒回應（蛇人增援）、石版＝瘋狂低語（發瘋）、遠古邪物＝異界滲透（鬧鬼）。', 33)
ON CONFLICT (code) DO NOTHING;

-- Seed: ts_ancient_text depth effects (5 levels)
INSERT INTO spirit_depth_effects (spirit_def_id, depth, effect_name_zh, effect_desc_zh) VALUES
  ((SELECT id FROM spirit_definitions WHERE code='ts_ancient_text'), 1, '初階解讀', '可閱讀初階神話文獻（入門級翻譯文本、邪教筆記）'),
  ((SELECT id FROM spirit_definitions WHERE code='ts_ancient_text'), 2, '中階解讀', '可閱讀中階神話文獻（《波納佩教典》《格拉基啟示錄》）'),
  ((SELECT id FROM spirit_definitions WHERE code='ts_ancient_text'), 3, '高階解讀', '可閱讀高階神話文獻（《伊波恩之書》《無名祭祀書》）'),
  ((SELECT id FROM spirit_definitions WHERE code='ts_ancient_text'), 4, '頂級解讀', '可閱讀頂級神話文獻（《屍食教典儀》《妖蛆之秘密》）'),
  ((SELECT id FROM spirit_definitions WHERE code='ts_ancient_text'), 5, '終極禁忌', '可閱讀終極禁忌典籍（《死靈之書》）')
ON CONFLICT (spirit_def_id, depth) DO NOTHING;

-- Seed: ts_relic_read depth effects (5 levels)
INSERT INTO spirit_depth_effects (spirit_def_id, depth, effect_name_zh, effect_desc_zh) VALUES
  ((SELECT id FROM spirit_definitions WHERE code='ts_relic_read'), 1, '初階感應', '可研究初階神話遺跡'),
  ((SELECT id FROM spirit_definitions WHERE code='ts_relic_read'), 2, '中階感應', '可研究中階神話遺跡'),
  ((SELECT id FROM spirit_definitions WHERE code='ts_relic_read'), 3, '高階感應', '可研究高階神話遺跡'),
  ((SELECT id FROM spirit_definitions WHERE code='ts_relic_read'), 4, '頂級感應', '可研究頂級神話遺跡'),
  ((SELECT id FROM spirit_definitions WHERE code='ts_relic_read'), 5, '終極共鳴', '可研究終極神話遺跡')
ON CONFLICT (spirit_def_id, depth) DO NOTHING;
`;

// Migration 009: Talent tree system (MOD-02)
const MIGRATION_009_SQL = `
-- ============================================
-- Migration 009: Talent tree system (MOD-02)
-- ============================================

CREATE TABLE IF NOT EXISTS talent_trees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faction_code      VARCHAR(2) UNIQUE NOT NULL
                    CHECK (faction_code IN ('E','I','S','N','T','F','J','P')),
  name_zh           VARCHAR(64) NOT NULL,
  name_en           VARCHAR(64) NOT NULL,
  description_zh    TEXT,
  description_en    TEXT,
  primary_attribute VARCHAR(16) NOT NULL,
  secondary_attribute VARCHAR(16),
  combat_proficiency_primary   VARCHAR(64),
  combat_proficiency_secondary VARCHAR(64),
  design_notes      TEXT,
  design_status     VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (design_status IN ('pending','partial','complete')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS talent_branches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id           UUID NOT NULL REFERENCES talent_trees(id) ON DELETE CASCADE,
  branch_index      INTEGER NOT NULL CHECK (branch_index BETWEEN 1 AND 3),
  name_zh           VARCHAR(64) NOT NULL,
  name_en           VARCHAR(64) NOT NULL,
  description_zh    TEXT,
  description_en    TEXT,
  theme_keywords    TEXT,
  color_hex         VARCHAR(7),
  design_notes      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tree_id, branch_index)
);

CREATE TABLE IF NOT EXISTS talent_nodes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id           UUID NOT NULL REFERENCES talent_trees(id) ON DELETE CASCADE,
  branch_id         UUID REFERENCES talent_branches(id) ON DELETE SET NULL,
  level             INTEGER NOT NULL CHECK (level BETWEEN 1 AND 12),
  is_trunk          BOOLEAN NOT NULL DEFAULT FALSE,
  node_type         VARCHAR(32) NOT NULL DEFAULT 'passive'
                    CHECK (node_type IN (
                      'passive','attribute_boost','proficiency',
                      'talent_card','branch_choice','milestone','ultimate'
                    )),
  name_zh           VARCHAR(64) NOT NULL,
  name_en           VARCHAR(64) NOT NULL,
  description_zh    TEXT,
  description_en    TEXT,
  boost_attribute   VARCHAR(16),
  boost_amount      INTEGER DEFAULT 1,
  talent_card_code  VARCHAR(64),
  prerequisites     JSONB NOT NULL DEFAULT '[]',
  talent_point_cost INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  design_status     VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (design_status IN ('pending','draft','complete')),
  design_notes      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_talent_nodes_tree ON talent_nodes(tree_id);
CREATE INDEX IF NOT EXISTS idx_talent_nodes_branch ON talent_nodes(branch_id);
CREATE INDEX IF NOT EXISTS idx_talent_nodes_level ON talent_nodes(tree_id, level);

CREATE TABLE IF NOT EXISTS talent_node_effects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id           UUID NOT NULL REFERENCES talent_nodes(id) ON DELETE CASCADE,
  effect_code       VARCHAR(64) NOT NULL,
  effect_params     JSONB NOT NULL DEFAULT '{}',
  effect_desc_zh    TEXT NOT NULL,
  effect_desc_en    TEXT,
  effect_value      DECIMAL(5,1) DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_talent_effects_node ON talent_node_effects(node_id);

-- Seed: 8 talent trees
INSERT INTO talent_trees (faction_code, name_zh, name_en, primary_attribute, secondary_attribute, combat_proficiency_primary, combat_proficiency_secondary, description_zh) VALUES
('E', '號令天賦樹', 'Herald Talent Tree', 'charisma', 'strength', 'sidearm', 'brawl',
 '團隊增益、共享資源、NPC 互動、領導光環。號令者是隊伍的核心，透過指揮和激勵讓全隊更強。'),
('I', '深淵天賦樹', 'Abyss Talent Tree', 'intellect', 'willpower', 'assassin', 'arcane',
 '單獨加成、牌庫操控、自我增幅、專精強化。凝視深淵的學者，在孤獨中找到別人找不到的答案。'),
('S', '鐵證天賦樹', 'Witness Talent Tree', 'perception', 'strength', 'shooting', 'sidearm',
 '裝備加成、物理攻擊、消耗品效率、環境互動。鐵證如山的調查員，用物理手段解決問題。'),
('N', '天啟天賦樹', 'Oracle Talent Tree', 'willpower', 'intellect', 'arcane', 'engineer',
 '混沌袋操控、預見事件、法術強化、預知反應。被知識選中的先知，看見別人看不見的東西。'),
('T', '解析天賦樹', 'Cipher Talent Tree', 'intellect', 'perception', 'engineer', 'archery',
 '弱點揭露、敵人預測、檢定重擲、資源效率。冷靜的分析師，將混亂化為秩序。'),
('F', '聖燼天賦樹', 'Ember Talent Tree', 'willpower', 'charisma', 'brawl', 'military',
 '治療、替人承傷、犧牲換效果、信念計數器。燃燒自己照亮他人的守護者。'),
('J', '鐵壁天賦樹', 'Bastion Talent Tree', 'constitution', 'strength', 'military', 'sidearm',
 '傷害減免、回合佈局、牌組一致性、堅守強化。不動如山的堡壘，隊伍最後的防線。'),
('P', '流影天賦樹', 'Flux Talent Tree', 'agility', 'perception', 'archery', 'assassin',
 '反應行動、棄牌堆回收、隨機獎勵、逆境觸發。在混亂中起舞的幸運兒，越絕望越強大。')
ON CONFLICT (faction_code) DO NOTHING;

-- Seed: 24 branches (3 per tree)
INSERT INTO talent_branches (tree_id, branch_index, name_zh, name_en, theme_keywords, color_hex) VALUES
((SELECT id FROM talent_trees WHERE faction_code='E'), 1, '戰場指揮', 'Field Commander', '團隊增益、行動經濟、戰術佈署', '#C9A84C'),
((SELECT id FROM talent_trees WHERE faction_code='E'), 2, '外交斡旋', 'Diplomat', 'NPC 互動、資源共享、情報交換', '#D4B85C'),
((SELECT id FROM talent_trees WHERE faction_code='E'), 3, '激勵之聲', 'Inspiring Voice', '士氣增幅、恐懼抵抗、團隊回復', '#BF9A3C'),
((SELECT id FROM talent_trees WHERE faction_code='I'), 1, '禁忌學識', 'Forbidden Scholar', '書籍研究、牌庫操控、知識解鎖', '#2A3F6F'),
((SELECT id FROM talent_trees WHERE faction_code='I'), 2, '陰影行者', 'Shadow Walker', '隱蔽、暗殺、單獨行動增益', '#1E2D5A'),
((SELECT id FROM talent_trees WHERE faction_code='I'), 3, '深淵凝視', 'Abyss Gazer', '自我增幅、代價換力量、SAN 燃燒', '#3A5090'),
((SELECT id FROM talent_trees WHERE faction_code='S'), 1, '火力至上', 'Firepower', '射擊強化、彈藥效率、遠程制壓', '#8B5E3C'),
((SELECT id FROM talent_trees WHERE faction_code='S'), 2, '裝備大師', 'Equipment Master', '鍛造增幅、裝備耐久、多槽位', '#7A4E2C'),
((SELECT id FROM talent_trees WHERE faction_code='S'), 3, '現場鑑識', 'Field Forensics', '線索發現、環境互動、消耗品回收', '#9C6E4C'),
((SELECT id FROM talent_trees WHERE faction_code='N'), 1, '星象術士', 'Astromancer', '法術強化、混沌袋操控、元素精通', '#7B4EA3'),
((SELECT id FROM talent_trees WHERE faction_code='N'), 2, '預言者', 'Prophet', '預見事件、預知反應、議程操控', '#6B3E93'),
((SELECT id FROM talent_trees WHERE faction_code='N'), 3, '次元行者', 'Dimension Walker', '空間操控、傳送、次元門互動', '#8B5EB3'),
((SELECT id FROM talent_trees WHERE faction_code='T'), 1, '弱點分析', 'Weakness Analyst', '敵人弱點揭露、增傷標記、情報收集', '#4A7C9B'),
((SELECT id FROM talent_trees WHERE faction_code='T'), 2, '資源工程', 'Resource Engineer', '資源效率、經濟引擎、抽牌優化', '#3A6C8B'),
((SELECT id FROM talent_trees WHERE faction_code='T'), 3, '戰術規劃', 'Tactical Planner', '檢定重擲、機率操控、計畫執行', '#5A8CAB'),
((SELECT id FROM talent_trees WHERE faction_code='F'), 1, '神聖治療', 'Sacred Healer', 'HP/SAN 恢復、狀態清除、創傷修復', '#B84C4C'),
((SELECT id FROM talent_trees WHERE faction_code='F'), 2, '鋼鐵守護', 'Iron Guardian', '替人承傷、護盾生成、嘲諷強化', '#A83C3C'),
((SELECT id FROM talent_trees WHERE faction_code='F'), 3, '殉道之路', 'Martyr''s Path', '犧牲換效果、信念計數器、瀕死增幅', '#C85C5C'),
((SELECT id FROM talent_trees WHERE faction_code='J'), 1, '不動堡壘', 'Immovable Fortress', '傷害減免、護甲強化、反擊', '#6B6B6B'),
((SELECT id FROM talent_trees WHERE faction_code='J'), 2, '秩序之盾', 'Shield of Order', '回合佈局、牌組一致性、計畫行動', '#5B5B5B'),
((SELECT id FROM talent_trees WHERE faction_code='J'), 3, '戰線維持', 'Front Line', '嘲諷、交戰控制、區域封鎖', '#7B7B7B'),
((SELECT id FROM talent_trees WHERE faction_code='P'), 1, '機運之子', 'Fortune''s Child', '隨機獎勵、幸運觸發、混沌袋祝福', '#2D8B6F'),
((SELECT id FROM talent_trees WHERE faction_code='P'), 2, '棄牌堆行者', 'Discard Walker', '棄牌堆回收、循環引擎、資源再生', '#1D7B5F'),
((SELECT id FROM talent_trees WHERE faction_code='P'), 3, '逆境爆發', 'Adversity Surge', '低血量增幅、逆境觸發、反應行動強化', '#3D9B7F')
ON CONFLICT (tree_id, branch_index) DO NOTHING;

-- Seed: 256 nodes (32 per tree × 8 trees) via PL/pgSQL loop
DO $seed$
DECLARE
  v_tree_id UUID;
  v_primary VARCHAR(16);
  v_b1 UUID; v_b2 UUID; v_b3 UUID;
  v_fc VARCHAR(2);
BEGIN
  FOR v_fc IN SELECT unnest(ARRAY['E','I','S','N','T','F','J','P']) LOOP
    SELECT id, primary_attribute INTO v_tree_id, v_primary
      FROM talent_trees WHERE faction_code = v_fc;
    IF v_tree_id IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM talent_nodes WHERE tree_id = v_tree_id LIMIT 1) THEN CONTINUE; END IF;

    SELECT id INTO v_b1 FROM talent_branches WHERE tree_id = v_tree_id AND branch_index = 1;
    SELECT id INTO v_b2 FROM talent_branches WHERE tree_id = v_tree_id AND branch_index = 2;
    SELECT id INTO v_b3 FROM talent_branches WHERE tree_id = v_tree_id AND branch_index = 3;

    -- Lv1: trunk passive
    INSERT INTO talent_nodes (tree_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order)
    VALUES (v_tree_id, 1, TRUE, 'passive', '基礎本能', 'Basic Instinct', '陣營的基礎被動能力，採用該陣營即獲得', 1, 1);

    -- Lv2: trunk attribute boost (auto-fill primary)
    INSERT INTO talent_nodes (tree_id, level, is_trunk, node_type, name_zh, name_en, description_zh, boost_attribute, boost_amount, talent_point_cost, sort_order)
    VALUES (v_tree_id, 2, TRUE, 'attribute_boost', '屬性覺醒 I', 'Attribute Awakening I', '第一次屬性提升（+1 陣營主屬性）', v_primary, 1, 1, 2);

    -- Lv3: branch choice ×3
    INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
    (v_tree_id, v_b1, 3, FALSE, 'branch_choice', '分支一：覺醒', 'Branch 1: Awakening', '選擇此分支路線，解鎖分支一的後續節點', 1, 3),
    (v_tree_id, v_b2, 3, FALSE, 'branch_choice', '分支二：覺醒', 'Branch 2: Awakening', '選擇此分支路線，解鎖分支二的後續節點', 1, 3),
    (v_tree_id, v_b3, 3, FALSE, 'branch_choice', '分支三：覺醒', 'Branch 3: Awakening', '選擇此分支路線，解鎖分支三的後續節點', 1, 3);

    -- Lv4: passive ×3
    INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
    (v_tree_id, v_b1, 4, FALSE, 'passive', '分支一 Lv4', 'Branch 1 Lv4', '待設計', 1, 4),
    (v_tree_id, v_b2, 4, FALSE, 'passive', '分支二 Lv4', 'Branch 2 Lv4', '待設計', 1, 4),
    (v_tree_id, v_b3, 4, FALSE, 'passive', '分支三 Lv4', 'Branch 3 Lv4', '待設計', 1, 4);

    -- Lv5: proficiency ×3
    INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
    (v_tree_id, v_b1, 5, FALSE, 'proficiency', '專精解鎖 I', 'Specialization I', '解鎖一個戰鬥專精槽位', 1, 5),
    (v_tree_id, v_b2, 5, FALSE, 'proficiency', '專精解鎖 I', 'Specialization I', '解鎖一個戰鬥專精槽位', 1, 5),
    (v_tree_id, v_b3, 5, FALSE, 'proficiency', '專精解鎖 I', 'Specialization I', '解鎖一個戰鬥專精槽位', 1, 5);

    -- Lv6: milestone ×3
    INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
    (v_tree_id, v_b1, 6, FALSE, 'milestone', '分支一：核心', 'Branch 1: Core', '分支核心能力，打法產生實質差異', 2, 6),
    (v_tree_id, v_b2, 6, FALSE, 'milestone', '分支二：核心', 'Branch 2: Core', '分支核心能力，打法產生實質差異', 2, 6),
    (v_tree_id, v_b3, 6, FALSE, 'milestone', '分支三：核心', 'Branch 3: Core', '分支核心能力，打法產生實質差異', 2, 6);

    -- Lv7: attribute boost ×3
    INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
    (v_tree_id, v_b1, 7, FALSE, 'attribute_boost', '屬性覺醒 II', 'Attribute Awakening II', '第二次屬性提升', 1, 7),
    (v_tree_id, v_b2, 7, FALSE, 'attribute_boost', '屬性覺醒 II', 'Attribute Awakening II', '第二次屬性提升', 1, 7),
    (v_tree_id, v_b3, 7, FALSE, 'attribute_boost', '屬性覺醒 II', 'Attribute Awakening II', '第二次屬性提升', 1, 7);

    -- Lv8: proficiency ×3
    INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
    (v_tree_id, v_b1, 8, FALSE, 'proficiency', '進階專精', 'Advanced Specialization', '解鎖進階戰鬥專精或強化已有專精', 1, 8),
    (v_tree_id, v_b2, 8, FALSE, 'proficiency', '進階專精', 'Advanced Specialization', '解鎖進階戰鬥專精或強化已有專精', 1, 8),
    (v_tree_id, v_b3, 8, FALSE, 'proficiency', '進階專精', 'Advanced Specialization', '解鎖進階戰鬥專精或強化已有專精', 1, 8);

    -- Lv9: talent card ×3
    INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
    (v_tree_id, v_b1, 9, FALSE, 'talent_card', '天賦卡 I', 'Talent Card I', '解鎖分支專屬天賦簽名卡', 1, 9),
    (v_tree_id, v_b2, 9, FALSE, 'talent_card', '天賦卡 I', 'Talent Card I', '解鎖分支專屬天賦簽名卡', 1, 9),
    (v_tree_id, v_b3, 9, FALSE, 'talent_card', '天賦卡 I', 'Talent Card I', '解鎖分支專屬天賦簽名卡', 1, 9);

    -- Lv10: attribute boost ×3
    INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
    (v_tree_id, v_b1, 10, FALSE, 'attribute_boost', '屬性覺醒 III', 'Attribute Awakening III', '第三次屬性提升', 1, 10),
    (v_tree_id, v_b2, 10, FALSE, 'attribute_boost', '屬性覺醒 III', 'Attribute Awakening III', '第三次屬性提升', 1, 10),
    (v_tree_id, v_b3, 10, FALSE, 'attribute_boost', '屬性覺醒 III', 'Attribute Awakening III', '第三次屬性提升', 1, 10);

    -- Lv11: passive ×3
    INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
    (v_tree_id, v_b1, 11, FALSE, 'passive', '分支一 Lv11', 'Branch 1 Lv11', '高階被動能力 + 第四次屬性提升', 2, 11),
    (v_tree_id, v_b2, 11, FALSE, 'passive', '分支二 Lv11', 'Branch 2 Lv11', '高階被動能力 + 第四次屬性提升', 2, 11),
    (v_tree_id, v_b3, 11, FALSE, 'passive', '分支三 Lv11', 'Branch 3 Lv11', '高階被動能力 + 第四次屬性提升', 2, 11);

    -- Lv12: ultimate ×3
    INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
    (v_tree_id, v_b1, 12, FALSE, 'ultimate', '終極天賦：分支一', 'Ultimate: Branch 1', '超凡入聖的終極能力，依分支不同而異', 3, 12),
    (v_tree_id, v_b2, 12, FALSE, 'ultimate', '終極天賦：分支二', 'Ultimate: Branch 2', '超凡入聖的終極能力，依分支不同而異', 3, 12),
    (v_tree_id, v_b3, 12, FALSE, 'ultimate', '終極天賦：分支三', 'Ultimate: Branch 3', '超凡入聖的終極能力，依分支不同而異', 3, 12);

  END LOOP;
END $seed$;
`;

// Migration 010: Monster system (MOD-03) — 5 tables + seed data
const MIGRATION_010_SQL = `
-- ============================================
-- Migration 010: Monster system (MOD-03)
-- ============================================

CREATE TABLE IF NOT EXISTS monster_families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(64) UNIQUE NOT NULL,
  name_zh VARCHAR(64) NOT NULL,
  name_en VARCHAR(64) NOT NULL,
  patron_zh VARCHAR(64), patron_en VARCHAR(64),
  patron_title_zh VARCHAR(128), patron_title_en VARCHAR(128),
  theme_zh TEXT, theme_en TEXT,
  family_type VARCHAR(16) NOT NULL DEFAULT 'deity' CHECK (family_type IN ('deity','mortal','undead','independent')),
  chaos_bag_preferences JSONB NOT NULL DEFAULT '{}',
  attack_element VARCHAR(16), damage_focus VARCHAR(16),
  combat_tempo_zh TEXT, combat_tempo_en TEXT,
  typical_keywords JSONB NOT NULL DEFAULT '[]',
  ai_preference VARCHAR(32),
  weaknesses JSONB NOT NULL DEFAULT '[]',
  resistances JSONB NOT NULL DEFAULT '[]',
  immunities JSONB NOT NULL DEFAULT '[]',
  inflicted_statuses JSONB NOT NULL DEFAULT '[]',
  self_buffs JSONB NOT NULL DEFAULT '[]',
  status_immunities JSONB NOT NULL DEFAULT '[]',
  fear_radius_range JSONB NOT NULL DEFAULT '[1,2]',
  fear_value_range JSONB NOT NULL DEFAULT '[1,3]',
  fear_design_note_zh TEXT, fear_design_note_en TEXT,
  defense_attribute_tendency JSONB NOT NULL DEFAULT '{}',
  rival_family_codes JSONB NOT NULL DEFAULT '[]',
  rival_note_zh TEXT, rival_note_en TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expansion_note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  design_status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (design_status IN ('draft','review','approved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monster_species (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES monster_families(id) ON DELETE CASCADE,
  code VARCHAR(64) UNIQUE NOT NULL,
  name_zh VARCHAR(64) NOT NULL, name_en VARCHAR(64) NOT NULL,
  description_zh TEXT, description_en TEXT,
  lore_zh TEXT, lore_en TEXT,
  base_attack_element VARCHAR(16) DEFAULT 'physical',
  base_ai_preference VARCHAR(32),
  base_weaknesses JSONB, base_resistances JSONB, base_immunities JSONB, base_status_immunities JSONB,
  tier_min INTEGER NOT NULL DEFAULT 1 CHECK (tier_min BETWEEN 1 AND 5),
  tier_max INTEGER NOT NULL DEFAULT 3 CHECK (tier_max BETWEEN 1 AND 5),
  base_keywords JSONB NOT NULL DEFAULT '[]',
  defense_attribute_tendency JSONB,
  design_notes TEXT,
  variant_count INTEGER NOT NULL DEFAULT 0,
  art_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  design_status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (design_status IN ('draft','review','approved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_tier_range CHECK (tier_min <= tier_max)
);

CREATE TABLE IF NOT EXISTS monster_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  species_id UUID NOT NULL REFERENCES monster_species(id) ON DELETE CASCADE,
  code VARCHAR(64) UNIQUE NOT NULL,
  name_zh VARCHAR(64) NOT NULL, name_en VARCHAR(64) NOT NULL,
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
  dc INTEGER NOT NULL, hp_base INTEGER NOT NULL,
  hp_per_player INTEGER NOT NULL DEFAULT 0,
  damage_physical INTEGER NOT NULL DEFAULT 0, damage_horror INTEGER NOT NULL DEFAULT 0,
  regen_per_round INTEGER NOT NULL DEFAULT 0,
  spell_defense INTEGER NOT NULL DEFAULT 0 CHECK (spell_defense BETWEEN 0 AND 9),
  attacks_per_round INTEGER NOT NULL DEFAULT 1,
  fear_radius INTEGER NOT NULL DEFAULT 1, fear_value INTEGER NOT NULL DEFAULT 1,
  fear_type VARCHAR(16) NOT NULL DEFAULT 'first_sight' CHECK (fear_type IN ('first_sight','per_round','on_reveal')),
  movement_speed INTEGER NOT NULL DEFAULT 1,
  movement_type VARCHAR(16) NOT NULL DEFAULT 'ground' CHECK (movement_type IN ('ground','flying','dimensional','burrowing')),
  keywords JSONB NOT NULL DEFAULT '[]',
  attack_element VARCHAR(16),
  weaknesses JSONB, resistances JSONB, immunities JSONB,
  resistance_values JSONB NOT NULL DEFAULT '{}',
  inflicted_statuses JSONB, self_buffs JSONB, status_immunities JSONB,
  ai_preference VARCHAR(32), ai_preference_param VARCHAR(32), ai_behavior_notes TEXT,
  is_undefeatable BOOLEAN NOT NULL DEFAULT FALSE,
  phase_count INTEGER NOT NULL DEFAULT 1,
  phase_rules JSONB NOT NULL DEFAULT '[]',
  legendary_actions JSONB NOT NULL DEFAULT '[]',
  environment_effects JSONB NOT NULL DEFAULT '[]',
  description_zh TEXT, description_en TEXT, art_url TEXT, design_notes TEXT,
  attack_card_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  design_status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (design_status IN ('draft','review','approved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monster_attack_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  species_id UUID REFERENCES monster_species(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES monster_variants(id) ON DELETE CASCADE,
  code VARCHAR(64) UNIQUE NOT NULL,
  name_zh VARCHAR(64) NOT NULL, name_en VARCHAR(64) NOT NULL,
  defense_attribute VARCHAR(16) NOT NULL,
  dc_override INTEGER,
  damage_physical INTEGER NOT NULL DEFAULT 0, damage_horror INTEGER NOT NULL DEFAULT 0,
  damage_element VARCHAR(16) NOT NULL DEFAULT 'physical',
  inflicts_status JSONB NOT NULL DEFAULT '[]',
  special_effect JSONB NOT NULL DEFAULT '{}',
  weight INTEGER NOT NULL DEFAULT 10,
  use_condition JSONB NOT NULL DEFAULT '{}',
  narrative_attack_zh TEXT, narrative_attack_en TEXT,
  narrative_hit_zh TEXT, narrative_hit_en TEXT,
  narrative_miss_zh TEXT, narrative_miss_en TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_attack_card_owner CHECK (species_id IS NOT NULL OR variant_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS monster_status_descriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES monster_variants(id) ON DELETE CASCADE,
  hp_threshold INTEGER NOT NULL,
  description_zh TEXT NOT NULL, description_en TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (variant_id, hp_threshold)
);

CREATE INDEX IF NOT EXISTS idx_monster_species_family ON monster_species(family_id);
CREATE INDEX IF NOT EXISTS idx_monster_variants_species ON monster_variants(species_id);
CREATE INDEX IF NOT EXISTS idx_monster_variants_tier ON monster_variants(tier);
CREATE INDEX IF NOT EXISTS idx_monster_attack_species ON monster_attack_cards(species_id);
CREATE INDEX IF NOT EXISTS idx_monster_attack_variant ON monster_attack_cards(variant_id);
CREATE INDEX IF NOT EXISTS idx_monster_status_variant ON monster_status_descriptions(variant_id);

-- Seed: 10 monster families (7 deity + 3 non-deity)
INSERT INTO monster_families (code,name_zh,name_en,patron_zh,patron_en,patron_title_zh,family_type,theme_zh,attack_element,damage_focus,combat_tempo_zh,typical_keywords,ai_preference,weaknesses,resistances,immunities,inflicted_statuses,self_buffs,status_immunities,fear_radius_range,fear_value_range,fear_design_note_zh,defense_attribute_tendency,rival_family_codes,rival_note_zh,chaos_bag_preferences,sort_order,design_status) VALUES
('house_cthulhu','克蘇魯眷族','House of Cthulhu','克蘇魯','Cthulhu','沉睡者、拉萊耶之主','deity','海洋、沉睡、夢境入侵、潮汐般不可阻擋的壓迫。','physical','hp','慢但沉重 — 每一擊傷害高，攻擊頻率低','["massive","crush"]','nearest','["fire","electric"]','["ice"]','[]','[{"code":"wet","frequency":"high","note":"海水浸泡"},{"code":"vulnerable","frequency":"medium","note":"觸手纏繞"},{"code":"madness","frequency":"low","note":"夢境入侵"}]','[{"code":"armor","frequency":"high","note":"鱗片甲殼"},{"code":"regeneration","frequency":"medium","note":"肉體再生"}]','["frozen","wet"]','[1,2]','[2,4]','遠遠看不怕，近距離壓迫感極強','{"strength":"high","constitution":"high","agility":"medium","willpower":"low"}','["house_hastur"]','水 vs 風','{"skull":"blood_sacrifice","cultist":"follower_response","tablet":"forbidden_knowledge","elder_thing":"otherworld_seep"}',1,'approved'),
('house_hastur','哈斯塔眷族','House of Hastur','哈斯塔','Hastur','無以名狀者、黃衣之王','deity','風、天空、瘋狂、藝術腐化、黃色符號。','physical','san','不正面交鋒 — 從遠處持續消磨理智','["flying","curse_on_death"]','lowest_san','["physical"]','["ice"]','[]','[{"code":"madness","frequency":"very_high","note":"核心手段"},{"code":"weakened","frequency":"high","note":"精神動搖"},{"code":"silence","frequency":"medium","note":"封鎖施法"},{"code":"darkness","frequency":"medium","note":"精神迷霧"},{"code":"marked","frequency":"low","note":"黃色印記"}]','[{"code":"ward","frequency":"high","note":"精神護壁"},{"code":"stealth","frequency":"medium","note":"幻影存在"}]','["madness","darkness"]','[3,5]','[1,2]','瀰漫性，遠遠就開始侵蝕','{"willpower":"high","perception":"high","intellect":"medium","strength":"low"}','["house_cthulhu"]','風 vs 水','{"skull":"life_drain","cultist":"doom_advance","tablet":"mad_whisper","elder_thing":"spacetime_warp"}',2,'approved'),
('house_shub','莎布·尼古拉絲眷族','House of Shub-Niggurath','莎布·尼古拉絲','Shub-Niggurath','黑山羊、千子之母','deity','繁殖、森林、腐化的生命力、母性的扭曲。','physical','hp','群體壓制 — 數量多、單體不強、源源不絕','["swarm","hunter"]','nearest','["fire"]','["ice"]','[]','[{"code":"poison","frequency":"very_high","note":"核心手段"},{"code":"bleed","frequency":"high","note":"觸手撕裂"},{"code":"vulnerable","frequency":"medium","note":"酸液腐蝕"},{"code":"fatigue","frequency":"low","note":"孢子倦意"}]','[{"code":"regeneration","frequency":"very_high","note":"核心家族特色"},{"code":"armor","frequency":"medium","note":"樹皮外殼"}]','["poison","bleed"]','[2,3]','[1,3]','越來越多的恐懼，數量壓迫','{"constitution":"high","agility":"high","strength":"medium","willpower":"low"}','[]',NULL,'{"skull":"death_touch","cultist":"ritual_resonance","tablet":"mental_exhaustion","elder_thing":"rift_expand"}',3,'approved'),
('house_nyarlathotep','奈亞拉托提普眷族','House of Nyarlathotep','奈亞拉托提普','Nyarlathotep','無貌之神、伏行之混沌、千面信使','deity','欺騙、偽裝、混沌、計謀、千面神。','mixed','mixed','不可預測 — 規則改寫、陷阱、詛咒','[]','most_clues','[]','[]','[]','[{"code":"marked","frequency":"high","note":"鎖定獵物"},{"code":"madness","frequency":"high","note":"真相衝擊"},{"code":"weakened","frequency":"medium","note":"心理操縱"},{"code":"disarm","frequency":"medium","note":"精神控制"},{"code":"silence","frequency":"low","note":"封鎖認知"},{"code":"doom_status","frequency":"low","note":"詛咒"}]','[{"code":"stealth","frequency":"very_high","note":"偽裝核心"},{"code":"empowered","frequency":"medium","note":"力量湧現"},{"code":"ward","frequency":"medium","note":"精神防禦"}]','["marked","weakened"]','[0,5]','[0,5]','不固定 — 偽裝時0，真身揭露時全場最高','{"perception":"high","intellect":"high","willpower":"high","charisma":"medium","strength":"low","agility":"low"}','[]','外神信使，可客串出現在任何家族關卡','{"skull":"life_cost","cultist":"exposed","tablet":"forbidden_truth","elder_thing":"space_sever"}',4,'approved'),
('house_yog','猶格·索托斯眷族','House of Yog-Sothoth','猶格·索托斯','Yog-Sothoth','門之鑰、萬有即一','deity','維度、時空、門戶、角度、幾何恐怖。','physical','mixed','突襲型 — 憑空出現、攻擊、消失','["flying"]','lowest_attr','[]','["physical"]','[]','[{"code":"weakened","frequency":"high","note":"時空扭曲"},{"code":"madness","frequency":"high","note":"維度恐懼"},{"code":"darkness","frequency":"medium","note":"維度重疊"},{"code":"doom_status","frequency":"medium","note":"時空侵蝕"},{"code":"fatigue","frequency":"low","note":"時間扭曲"}]','[{"code":"stealth","frequency":"very_high","note":"維度跳躍"},{"code":"haste","frequency":"medium","note":"超速行動"}]','["frozen","burning"]','[1,1]','[3,5]','憑空出現的瞬間衝擊','{"perception":"high","intellect":"high","agility":"medium","willpower":"medium"}','[]',NULL,'{"skull":"blood_sacrifice","cultist":"doom_advance","tablet":"memory_collapse","elder_thing":"spacetime_warp"}',5,'approved'),
('house_cthugha','克圖格亞眷族','House of Cthugha','克圖格亞','Cthugha','爆燃者、居於火焰者','deity','火焰、爆燃、恆星、毀滅性的光與熱。','fire','hp','攻擊性極強 — 傷害高、防禦低、速戰速決','["crush","swift"]','nearest','["ice","physical"]','[]','["fire"]','[{"code":"burning","frequency":"very_high","note":"核心手段"},{"code":"vulnerable","frequency":"high","note":"灼傷削弱"},{"code":"bleed","frequency":"medium","note":"灼傷傷口"},{"code":"fatigue","frequency":"low","note":"高溫"}]','[{"code":"empowered","frequency":"medium","note":"火焰暴走"},{"code":"haste","frequency":"medium","note":"急速蔓延"}]','["burning","frozen","wet"]','[2,3]','[1,2]','恐懼來自傷害本身','{"agility":"high","constitution":"high","strength":"medium","willpower":"low"}','["house_hastur"]','克圖格亞被召喚來對抗哈斯塔','{"skull":"death_touch","cultist":"exposed","tablet":"forbidden_knowledge","elder_thing":"otherworld_fire"}',6,'approved'),
('house_yig','伊格眷族','House of Yig','伊格','Yig','蛇之父','deity','蛇、毒、古老文明、隱伏、地底、腐朽的智慧。','physical','hp','伏擊型 — 先隱藏、再突襲、帶毒素 DoT','["hunter","apathetic"]','lowest_hp','["ice","fire"]','[]','[]','[{"code":"poison","frequency":"very_high","note":"核心手段"},{"code":"bleed","frequency":"high","note":"毒牙咬傷"},{"code":"weakened","frequency":"medium","note":"蛇毒肌肉無力"},{"code":"weakness_status","frequency":"medium","note":"神經毒素"},{"code":"silence","frequency":"low","note":"封鎖咒語"}]','[{"code":"stealth","frequency":"very_high","note":"天然潛伏"},{"code":"armor","frequency":"medium","note":"蛇鱗防禦"},{"code":"empowered","frequency":"low","note":"祭司法術增幅"}]','["poison"]','[1,2]','[1,2]','伏擊的恐懼在看到的瞬間爆發','{"constitution":"high","agility":"high","perception":"medium","strength":"medium"}','[]',NULL,'{"skull":"blood_sacrifice","cultist":"follower_response","tablet":"mad_whisper","elder_thing":"otherworld_seep"}',7,'approved')
ON CONFLICT (code) DO NOTHING;

INSERT INTO monster_families (code,name_zh,name_en,family_type,theme_zh,attack_element,damage_focus,combat_tempo_zh,typical_keywords,ai_preference,inflicted_statuses,self_buffs,status_immunities,fear_radius_range,fear_value_range,fear_design_note_zh,defense_attribute_tendency,sort_order,design_status) VALUES
('fallen','凡人墮落者','The Fallen','mortal','邪教徒、瘋狂學者、丘丘人。可搭配任何主神家族出現。','physical','mixed','雜兵為主，偶有精英級祭司','[]','nearest','[]','[]','[]','[1,1]','[0,1]','人類級恐懼','{"strength":"medium","agility":"medium","constitution":"medium","intellect":"medium","willpower":"medium","perception":"medium","charisma":"medium"}',8,'approved'),
('undying','亡者回響','The Undying','undead','死而不朽的存在。食屍鬼、格拉基之僕從、蠕行者。','physical','mixed','消耗型 — 擊殺後可能復活','["haunting","curse_on_death"]','lowest_hp','[{"code":"madness","frequency":"high","note":"面對已死之物"},{"code":"poison","frequency":"medium","note":"屍毒"},{"code":"fatigue","frequency":"medium","note":"死氣侵蝕"}]','[{"code":"regeneration","frequency":"high","note":"不死再生"},{"code":"armor","frequency":"medium","note":"僵硬屍體"}]','["poison","bleed","fatigue"]','[1,2]','[2,3]','面對已死之物行走的原始恐懼','{"willpower":"high","constitution":"high","strength":"medium","agility":"low"}',9,'approved'),
('independent','獨立存在','Independent Entities','independent','不隸屬任何舊日支配者的獨立存在。修格斯、夜魘、星之彩、米·戈、古老者。','mixed','mixed','多樣化 — 每種獨立存在都有獨特的戰鬥模式','[]','random','[]','[]','[]','[1,3]','[1,4]','不可分類的未知帶來的恐懼','{}',10,'approved')
ON CONFLICT (code) DO NOTHING;

INSERT INTO monster_families (code,name_zh,name_en,patron_zh,patron_en,patron_title_zh,family_type,theme_zh,is_active,expansion_note,sort_order,design_status) VALUES
('house_tsathoggua','札特瓜眷族','House of Tsathoggua','札特瓜','Tsathoggua','簡體常用撒托古亞','deity','地底、慵懶、黑暗、無形之子、沃米人',FALSE,'待擴充',11,'draft'),
('house_shudde_mell','修德·梅爾眷族','House of Shudde M''ell','修德·梅爾','Shudde M''ell','鑽地魔蟲之主','deity','地震、鑽地、地底恐怖',FALSE,'待擴充',12,'draft'),
('house_nodens','諾登斯陣營','House of Nodens','諾登斯','Nodens','相對友善的古老存在、夜魘統領','deity','相對友善的古老存在、夜魘統領',FALSE,'待擴充 — 特殊家族，可能是盟友而非敵人',13,'draft')
ON CONFLICT (code) DO NOTHING;

-- Seed: 32 monster species
INSERT INTO monster_species (family_id,code,name_zh,name_en,description_zh,tier_min,tier_max,base_keywords,sort_order,design_status) VALUES
((SELECT id FROM monster_families WHERE code='house_cthulhu'),'deep_one','深潛者','Deep One','克蘇魯的基礎眷屬，半人半魚的海底生物。',1,3,'[]',1,'draft'),
((SELECT id FROM monster_families WHERE code='house_cthulhu'),'star_spawn','星之眷族','Star-Spawn of Cthulhu','克蘇魯的直系眷屬，巨大的類克蘇魯存在。',3,4,'["massive"]',2,'draft'),
((SELECT id FROM monster_families WHERE code='house_cthulhu'),'dagon','達貢','Dagon','父神達貢，深潛者的統帥。',4,4,'["massive","crush"]',3,'draft'),
((SELECT id FROM monster_families WHERE code='house_cthulhu'),'hydra','海德拉','Hydra','母神海德拉，與達貢並列的深潛者統帥。',4,4,'["massive","crush"]',4,'draft'),
((SELECT id FROM monster_families WHERE code='house_cthulhu'),'cthulhu','克蘇魯','Cthulhu','沉睡者。拉萊耶之主。不可擊敗。',5,5,'["massive"]',5,'draft'),
((SELECT id FROM monster_families WHERE code='house_hastur'),'yellow_acolyte','黃衣信徒','Yellow Acolyte','哈斯塔的凡人信徒，黃色符號的傳播者。',1,2,'[]',1,'draft'),
((SELECT id FROM monster_families WHERE code='house_hastur'),'byakhee','拜亞基','Byakhee','星際飛行的怪物，哈斯塔的忠實眷族。',2,3,'["flying"]',2,'draft'),
((SELECT id FROM monster_families WHERE code='house_hastur'),'lloigor_zhar','羅伊格爾與札爾','Lloigor & Zhar','雙子舊日支配者，哈斯塔的眷屬。',3,4,'[]',3,'draft'),
((SELECT id FROM monster_families WHERE code='house_hastur'),'king_in_yellow','黃衣之王','King in Yellow','哈斯塔的化身之一。精神壓制能力極強。',4,4,'["curse_on_death"]',4,'draft'),
((SELECT id FROM monster_families WHERE code='house_hastur'),'ithaqua','伊塔庫亞','Ithaqua','風行者。在暴風雪中狩獵的恐怖存在。',4,5,'["flying","swift"]',5,'draft'),
((SELECT id FROM monster_families WHERE code='house_hastur'),'hastur','哈斯塔','Hastur','無以名狀者。不可擊敗。',5,5,'[]',6,'draft'),
((SELECT id FROM monster_families WHERE code='house_shub'),'dark_young','黑山羊幼崽','Dark Young','莎布·尼古拉絲的子嗣。幼體成群出沒，成體龐大而致命。',1,4,'["swarm"]',1,'draft'),
((SELECT id FROM monster_families WHERE code='house_shub'),'shub_niggurath','莎布·尼古拉絲','Shub-Niggurath','黑山羊、千子之母。不可擊敗。',5,5,'["massive"]',2,'draft'),
((SELECT id FROM monster_families WHERE code='house_nyarlathotep'),'nyar_cultist','邪教信徒（偽裝）','Cultist (Disguised)','奈亞拉托提普的凡人信徒，各種偽裝身分。',1,2,'["apathetic"]',1,'draft'),
((SELECT id FROM monster_families WHERE code='house_nyarlathotep'),'shan','夏蓋蟲族','Insect from Shaggai','寄生型外星昆蟲，精神控制能力極強。',2,3,'[]',2,'draft'),
((SELECT id FROM monster_families WHERE code='house_nyarlathotep'),'hunting_horror','恐怖獵手','Hunting Horror','奈亞拉托提普的僕從，黑暗中的獵手。',3,3,'["flying","hunter"]',3,'draft'),
((SELECT id FROM monster_families WHERE code='house_nyarlathotep'),'nyar_avatar','奈亞拉托提普的化身','Avatar of Nyarlathotep','千面神的化身之一。每次出現形態都不同。',4,5,'[]',4,'draft'),
((SELECT id FROM monster_families WHERE code='house_nyarlathotep'),'nyarlathotep','奈亞拉托提普','Nyarlathotep','無貌之神。不可擊敗。',5,5,'[]',5,'draft'),
((SELECT id FROM monster_families WHERE code='house_yog'),'dimensional_shambler','空鬼','Dimensional Shambler','次元徘徊者，在維度之間遊蕩的恐怖存在。',2,3,'[]',1,'draft'),
((SELECT id FROM monster_families WHERE code='house_yog'),'hound_of_tindalos','廷達洛斯獵犬','Hound of Tindalos','角度中的獵手，從時空裂縫中撲出。',3,3,'["hunter","swift"]',2,'draft'),
((SELECT id FROM monster_families WHERE code='house_yog'),'yog_sothoth','猶格·索托斯','Yog-Sothoth','門之鑰、萬有即一。不可擊敗。',5,5,'[]',3,'draft'),
((SELECT id FROM monster_families WHERE code='house_cthugha'),'fire_vampire','炎之精','Fire Vampire','純火焰構成的生命體，小型但致命。',1,2,'["swift"]',1,'draft'),
((SELECT id FROM monster_families WHERE code='house_cthugha'),'flame_construct','火焰造物','Flame Construct','由克圖格亞的火焰凝聚而成的戰鬥造物。',3,3,'["crush"]',2,'draft'),
((SELECT id FROM monster_families WHERE code='house_cthugha'),'aphoom_zhah','亞弗姆·扎','Aphoom-Zhah','克圖格亞的後裔，冷焰之主。',4,4,'[]',3,'draft'),
((SELECT id FROM monster_families WHERE code='house_cthugha'),'cthugha','克圖格亞','Cthugha','爆燃者、居於火焰者。不可擊敗。',5,5,'["massive"]',4,'draft'),
((SELECT id FROM monster_families WHERE code='house_yig'),'serpent_scout','蛇人斥候','Serpent Scout','蛇人的先遣偵察兵，善於潛伏和突襲。',1,2,'["apathetic"]',1,'draft'),
((SELECT id FROM monster_families WHERE code='house_yig'),'serpent_warrior','蛇人戰士','Serpent Warrior','蛇人的正規戰鬥兵，裝備古老文明的武器。',2,3,'["hunter"]',2,'draft'),
((SELECT id FROM monster_families WHERE code='house_yig'),'serpent_priest','蛇人祭司','Serpent Priest','蛇人的祭司，掌握古老魔法和蛇毒秘術。',3,4,'[]',3,'draft'),
((SELECT id FROM monster_families WHERE code='house_yig'),'yig','伊格','Yig','蛇之父。頭目到巨頭級。',4,5,'["massive"]',4,'draft'),
((SELECT id FROM monster_families WHERE code='fallen'),'cultist','邪教徒','Cultist','各種舊日支配者的凡人崇拜者。',1,2,'[]',1,'draft'),
((SELECT id FROM monster_families WHERE code='fallen'),'mad_scholar','瘋狂學者','Mad Scholar','因鑽研禁忌知識而失去理智的學者。',2,3,'[]',2,'draft'),
((SELECT id FROM monster_families WHERE code='fallen'),'tcho_tcho','丘丘人','Tcho-Tcho','退化的人類部落，崇拜各種黑暗力量。',1,3,'["swarm"]',3,'draft'),
((SELECT id FROM monster_families WHERE code='undying'),'ghoul','食屍鬼','Ghoul','以屍體為食的地底生物，曾經是人類。',1,3,'["haunting"]',1,'draft'),
((SELECT id FROM monster_families WHERE code='undying'),'servant_of_glaaki','格拉基之僕從','Servant of Glaaki','被格拉基的棘刺刺穿後變成不死僕從。',2,3,'["haunting","curse_on_death"]',2,'draft'),
((SELECT id FROM monster_families WHERE code='undying'),'crawling_one','蠕行者','Crawling One','由無數蠕蟲構成的不死存在。',3,4,'["swarm"]',3,'draft'),
((SELECT id FROM monster_families WHERE code='independent'),'shoggoth','修格斯','Shoggoth','不定形僕從，古老者創造的生物兵器。極度危險。',3,4,'["massive"]',1,'draft'),
((SELECT id FROM monster_families WHERE code='independent'),'nightgaunt','夜魘','Nightgaunt','幻夢境生物，無面的黑色飛行生物。',2,3,'["flying"]',2,'draft'),
((SELECT id FROM monster_families WHERE code='independent'),'colour_out_of_space','星之彩','Colour out of Space','來自宇宙的顏色，非物質存在。',3,4,'[]',3,'draft'),
((SELECT id FROM monster_families WHERE code='independent'),'mi_go','米·戈','Mi-Go','猶格斯星的真菌生物，外星科學家。',2,3,'["flying"]',4,'draft'),
((SELECT id FROM monster_families WHERE code='independent'),'elder_thing','古老者','Elder Thing','又稱古老種族，南極文明的創造者。',3,4,'[]',5,'draft')
ON CONFLICT (code) DO NOTHING;
`;

// Migration 011: Location library system (MOD-08)
const MIGRATION_011_SQL = `
-- ============================================
-- Migration 011: Location library system (MOD-08)
-- ============================================

-- 重建 locations：從 v0.1 schema 掛在 scenarios 底下，獨立成「地點庫」
DROP TABLE IF EXISTS locations CASCADE;

CREATE TABLE locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(64) UNIQUE NOT NULL,
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128) NOT NULL DEFAULT '',
  description_zh  TEXT,
  description_en  TEXT,

  -- 視覺素材
  art_url         TEXT,
  svg_code        TEXT,
  art_type        VARCHAR(16) NOT NULL DEFAULT 'none'
                  CHECK (art_type IN ('none','image_url','svg_generated','svg_custom')),

  -- 尺度標籤
  scale_tag       VARCHAR(32),

  -- 地點屬性
  shroud          INTEGER NOT NULL DEFAULT 2,
  clues_base      INTEGER NOT NULL DEFAULT 1,
  clues_per_player BOOLEAN NOT NULL DEFAULT TRUE,
  travel_cost     INTEGER NOT NULL DEFAULT 1,
  travel_cost_type VARCHAR(16) NOT NULL DEFAULT 'action_point'
                  CHECK (travel_cost_type IN ('action_point','time')),

  -- 可發現的卡片資源
  discoverable_card_ids UUID[] NOT NULL DEFAULT '{}',

  -- 設計備註
  design_notes    TEXT,

  -- 中繼資料
  hidden_info_count INTEGER NOT NULL DEFAULT 0,
  tag_count       INTEGER NOT NULL DEFAULT 0,
  usage_count     INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  design_status   VARCHAR(16) NOT NULL DEFAULT 'draft'
                  CHECK (design_status IN ('draft','review','approved')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_code ON locations(code);
CREATE INDEX IF NOT EXISTS idx_locations_scale ON locations(scale_tag);
CREATE INDEX IF NOT EXISTS idx_locations_status ON locations(design_status);

-- 隱藏資訊子表
CREATE TABLE IF NOT EXISTS location_hidden_info (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id       UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  title_zh          VARCHAR(128),
  title_en          VARCHAR(128),
  description_zh    TEXT NOT NULL DEFAULT '',
  description_en    TEXT,
  reveal_condition_type VARCHAR(32) NOT NULL DEFAULT 'perception_threshold'
                    CHECK (reveal_condition_type IN ('perception_threshold','investigation_count','manual','none')),
  reveal_condition_params JSONB NOT NULL DEFAULT '{}',
  reward_type       VARCHAR(32) NOT NULL DEFAULT 'narrative_only'
                    CHECK (reward_type IN ('narrative_only','clue','card','effect')),
  reward_params     JSONB NOT NULL DEFAULT '{}',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hidden_info_location ON location_hidden_info(location_id);

-- 風格標籤主表
CREATE TABLE IF NOT EXISTS location_style_tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(64) UNIQUE NOT NULL,
  name_zh         VARCHAR(64) NOT NULL,
  name_en         VARCHAR(64) NOT NULL DEFAULT '',
  category        VARCHAR(16) NOT NULL DEFAULT 'custom'
                  CHECK (category IN ('indoor','outdoor','special','custom')),
  description     TEXT,
  usage_count     INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_style_tags_category ON location_style_tags(category);

-- 地點 ↔ 標籤多對多
CREATE TABLE IF NOT EXISTS location_tag_map (
  location_id     UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  tag_id          UUID NOT NULL REFERENCES location_style_tags(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (location_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_tag_map_location ON location_tag_map(location_id);
CREATE INDEX IF NOT EXISTS idx_tag_map_tag ON location_tag_map(tag_id);

-- Seed: 23 預設風格標籤（室內 9 + 室外 8 + 特殊 6）
INSERT INTO location_style_tags (code, name_zh, name_en, category, sort_order) VALUES
  ('indoor_mansion',    '宅邸',     'Mansion',         'indoor',  1),
  ('indoor_library',    '圖書館',   'Library',         'indoor',  2),
  ('indoor_lab',        '實驗室',   'Laboratory',      'indoor',  3),
  ('indoor_church',     '教堂',     'Church',          'indoor',  4),
  ('indoor_tavern',     '酒館',     'Tavern',          'indoor',  5),
  ('indoor_theater',    '劇院',     'Theater',         'indoor',  6),
  ('indoor_basement',   '地下室',   'Basement',        'indoor',  7),
  ('indoor_hospital',   '醫院',     'Hospital',        'indoor',  8),
  ('indoor_museum',     '博物館',   'Museum',          'indoor',  9),
  ('outdoor_street',    '街道',     'Street',          'outdoor', 10),
  ('outdoor_forest',    '森林',     'Forest',          'outdoor', 11),
  ('outdoor_seaside',   '海邊',     'Seaside',         'outdoor', 12),
  ('outdoor_graveyard', '墓地',     'Graveyard',       'outdoor', 13),
  ('outdoor_farmland',  '農田',     'Farmland',        'outdoor', 14),
  ('outdoor_mountain',  '山區',     'Mountain',        'outdoor', 15),
  ('outdoor_harbor',    '港口',     'Harbor',          'outdoor', 16),
  ('outdoor_pier',      '碼頭',     'Pier',            'outdoor', 17),
  ('special_gate',      '次元門',   'Dimensional Gate','special', 18),
  ('special_ritual',    '儀式場',   'Ritual Site',     'special', 19),
  ('special_dreamland', '幻夢境',   'Dreamland',       'special', 20),
  ('special_ruins',     '遺跡',     'Ruins',           'special', 21),
  ('special_ship',      '船上',     'Ship',            'special', 22),
  ('special_dream',     '夢境',     'Dream',           'special', 23)
ON CONFLICT (code) DO NOTHING;

-- Seed: 3 範例地點
INSERT INTO locations (code, name_zh, name_en, description_zh, scale_tag, shroud, clues_base, clues_per_player, travel_cost, travel_cost_type, art_type, design_status) VALUES
('miskatonic_library', '密斯卡塔尼克大學圖書館', 'Miskatonic University Library',
 '阿卡姆最古老的學術機構，藏有無數禁忌典籍。圖書館的深處據說有只有少數人知道的秘密書庫。',
 'room', 3, 2, TRUE, 1, 'action_point', 'none', 'draft'),
('innsmouth_pier', '印斯茅斯碼頭', 'Innsmouth Pier',
 '腐朽的木板在海風中發出呻吟。遠處的礁石上，隱約可見類人生物的輪廓在月光下移動。',
 'block', 2, 1, TRUE, 1, 'action_point', 'none', 'draft'),
('arkham_downtown', '阿卡姆市中心', 'Arkham Downtown',
 '麻州東北部最古老的城鎮，充斥著殖民時期的老建築與現代文明的奇異混合。',
 'city', 2, 1, FALSE, 1, 'time', 'none', 'draft')
ON CONFLICT (code) DO NOTHING;

-- 為範例地點掛上標籤
INSERT INTO location_tag_map (location_id, tag_id)
SELECT (SELECT id FROM locations WHERE code='miskatonic_library'), id
FROM location_style_tags WHERE code IN ('indoor_library','indoor_mansion')
ON CONFLICT DO NOTHING;

INSERT INTO location_tag_map (location_id, tag_id)
SELECT (SELECT id FROM locations WHERE code='innsmouth_pier'), id
FROM location_style_tags WHERE code IN ('outdoor_pier','outdoor_seaside','outdoor_harbor')
ON CONFLICT DO NOTHING;

INSERT INTO location_tag_map (location_id, tag_id)
SELECT (SELECT id FROM locations WHERE code='arkham_downtown'), id
FROM location_style_tags WHERE code='outdoor_street'
ON CONFLICT DO NOTHING;

-- 範例隱藏資訊
INSERT INTO location_hidden_info (location_id, title_zh, description_zh, reveal_condition_type, reveal_condition_params, reward_type, reward_params)
SELECT id, '禁書區的暗門',
  '你在書架最深處發現一塊與周圍不同的磚石。輕輕按下，一道暗門緩緩開啟，露出通往地下的石階。',
  'perception_threshold', '{"threshold": 4}'::jsonb,
  'clue', '{"amount": 2}'::jsonb
FROM locations WHERE code='miskatonic_library'
  AND NOT EXISTS (SELECT 1 FROM location_hidden_info WHERE location_id = locations.id AND title_zh='禁書區的暗門');

INSERT INTO location_hidden_info (location_id, title_zh, description_zh, reveal_condition_type, reveal_condition_params, reward_type, reward_params)
SELECT id, '漂流瓶中的紙條',
  '你在礁石縫隙中發現一個發黃的漂流瓶，裡面是一張用血跡斑斑的字跡寫成的求救信。',
  'investigation_count', '{"count": 2}'::jsonb,
  'narrative_only', '{}'::jsonb
FROM locations WHERE code='innsmouth_pier'
  AND NOT EXISTS (SELECT 1 FROM location_hidden_info WHERE location_id = locations.id AND title_zh='漂流瓶中的紙條');

-- 同步中繼計數
UPDATE locations SET
  hidden_info_count = (SELECT COUNT(*) FROM location_hidden_info WHERE location_id = locations.id),
  tag_count = (SELECT COUNT(*) FROM location_tag_map WHERE location_id = locations.id);

UPDATE location_style_tags SET
  usage_count = (SELECT COUNT(*) FROM location_tag_map WHERE tag_id = location_style_tags.id);
`;

// Migration 012: Keeper Designer system (MOD-10)
const MIGRATION_012_SQL = `
-- ============================================
-- Migration 012: Keeper Designer system (MOD-10)
-- ============================================

-- 神話卡主表
CREATE TABLE IF NOT EXISTS mythos_cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(64) UNIQUE NOT NULL,
  name_zh           VARCHAR(128) NOT NULL,
  name_en           VARCHAR(128) NOT NULL DEFAULT '',
  description_zh    TEXT,
  description_en    TEXT,
  action_cost       INTEGER NOT NULL DEFAULT 1 CHECK (action_cost >= 0 AND action_cost <= 10),
  activation_timing VARCHAR(32) NOT NULL DEFAULT 'keeper_phase'
                    CHECK (activation_timing IN ('investigator_phase_reaction','keeper_phase','both')),
  card_category     VARCHAR(32) NOT NULL DEFAULT 'general'
                    CHECK (card_category IN (
                      'summon','environment','status','global','agenda',
                      'chaos_bag','encounter','cancel','narrative','general'
                    )),
  intensity_tag     VARCHAR(16) NOT NULL DEFAULT 'small'
                    CHECK (intensity_tag IN ('small','medium','large','epic')),
  response_trigger  VARCHAR(64),
  flavor_text_zh    TEXT,
  flavor_text_en    TEXT,
  art_url           TEXT,
  design_notes      TEXT,
  effect_count      INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  design_status     VARCHAR(16) NOT NULL DEFAULT 'draft'
                    CHECK (design_status IN ('draft','review','approved')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mythos_category ON mythos_cards(card_category);
CREATE INDEX IF NOT EXISTS idx_mythos_timing ON mythos_cards(activation_timing);
CREATE INDEX IF NOT EXISTS idx_mythos_intensity ON mythos_cards(intensity_tag);
CREATE INDEX IF NOT EXISTS idx_mythos_status ON mythos_cards(design_status);

-- 神話卡動作子表
CREATE TABLE IF NOT EXISTS mythos_card_effects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mythos_card_id    UUID NOT NULL REFERENCES mythos_cards(id) ON DELETE CASCADE,
  action_code       VARCHAR(64) NOT NULL,
  action_params     JSONB NOT NULL DEFAULT '{}',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  description_zh    TEXT,
  description_en    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mythos_effects_card ON mythos_card_effects(mythos_card_id);
CREATE INDEX IF NOT EXISTS idx_mythos_effects_action ON mythos_card_effects(action_code);

-- 遭遇卡主表
CREATE TABLE IF NOT EXISTS encounter_cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(64) UNIQUE NOT NULL,
  name_zh           VARCHAR(128) NOT NULL,
  name_en           VARCHAR(128) NOT NULL DEFAULT '',
  scenario_text_zh  TEXT NOT NULL DEFAULT '',
  scenario_text_en  TEXT,
  encounter_type    VARCHAR(32) NOT NULL DEFAULT 'choice'
                    CHECK (encounter_type IN ('thriller','choice','trade','puzzle','social','discovery')),
  art_url           TEXT,
  design_notes      TEXT,
  option_count      INTEGER NOT NULL DEFAULT 0,
  tag_count         INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  design_status     VARCHAR(16) NOT NULL DEFAULT 'draft'
                    CHECK (design_status IN ('draft','review','approved')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_encounter_type ON encounter_cards(encounter_type);
CREATE INDEX IF NOT EXISTS idx_encounter_status ON encounter_cards(design_status);

-- 遭遇卡選項子表
CREATE TABLE IF NOT EXISTS encounter_card_options (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_card_id UUID NOT NULL REFERENCES encounter_cards(id) ON DELETE CASCADE,
  option_label      VARCHAR(4) NOT NULL,
  option_text_zh    TEXT NOT NULL DEFAULT '',
  option_text_en    TEXT,
  requires_check    BOOLEAN NOT NULL DEFAULT TRUE,
  check_attribute   VARCHAR(16),
  check_dc          INTEGER,
  success_narrative_zh  TEXT,
  success_narrative_en  TEXT,
  success_effects       JSONB NOT NULL DEFAULT '[]',
  failure_narrative_zh  TEXT,
  failure_narrative_en  TEXT,
  failure_effects       JSONB NOT NULL DEFAULT '[]',
  no_check_narrative_zh TEXT,
  no_check_narrative_en TEXT,
  no_check_effects      JSONB NOT NULL DEFAULT '[]',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (encounter_card_id, option_label)
);

CREATE INDEX IF NOT EXISTS idx_encounter_options_card ON encounter_card_options(encounter_card_id);

-- 遭遇卡 ↔ 地點風格標籤多對多（FK 到 MOD-08 的 location_style_tags）
CREATE TABLE IF NOT EXISTS encounter_card_tag_map (
  encounter_card_id UUID NOT NULL REFERENCES encounter_cards(id) ON DELETE CASCADE,
  tag_id            UUID NOT NULL REFERENCES location_style_tags(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (encounter_card_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_encounter_tag_map_card ON encounter_card_tag_map(encounter_card_id);
CREATE INDEX IF NOT EXISTS idx_encounter_tag_map_tag ON encounter_card_tag_map(tag_id);

-- 全域遊戲平衡參數
CREATE TABLE IF NOT EXISTS game_balance_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key     VARCHAR(64) UNIQUE NOT NULL,
  setting_group   VARCHAR(32) NOT NULL,
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128),
  description_zh  TEXT,
  description_en  TEXT,
  value           JSONB NOT NULL,
  value_type      VARCHAR(16) NOT NULL DEFAULT 'number'
                  CHECK (value_type IN ('number','formula','table','text','boolean')),
  is_editable     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balance_group ON game_balance_settings(setting_group);

-- ============================================
-- Seed: 12 平衡參數
-- ============================================
INSERT INTO game_balance_settings (setting_key, setting_group, name_zh, description_zh, value, value_type, sort_order) VALUES
  ('keeper_action_base_difficulty_1', 'keeper_action_points', '難度 1（簡單）基礎點數', '關卡難度為 1 時，城主每回合獲得的基礎行動點', '{"value": 2}'::jsonb, 'number', 1),
  ('keeper_action_base_difficulty_2', 'keeper_action_points', '難度 2（標準）基礎點數', '關卡難度為 2 時，城主每回合獲得的基礎行動點', '{"value": 3}'::jsonb, 'number', 2),
  ('keeper_action_base_difficulty_3', 'keeper_action_points', '難度 3（困難）基礎點數', '關卡難度為 3 時，城主每回合獲得的基礎行動點', '{"value": 4}'::jsonb, 'number', 3),
  ('keeper_action_base_difficulty_4', 'keeper_action_points', '難度 4（專家）基礎點數', '關卡難度為 4 時，城主每回合獲得的基礎行動點', '{"value": 5}'::jsonb, 'number', 4),
  ('keeper_action_base_difficulty_5', 'keeper_action_points', '難度 5（噩夢）基礎點數', '關卡難度為 5 時，城主每回合獲得的基礎行動點', '{"value": 6}'::jsonb, 'number', 5),
  ('keeper_action_per_player', 'keeper_action_points', '人數加成', '每多一名玩家（從第 2 人開始），城主每回合額外獲得的行動點', '{"value": 2}'::jsonb, 'number', 6),
  ('keeper_action_accumulation', 'keeper_action_points', '跨回合累積', '城主未花費的行動點是否可跨回合累積', '{"value": true}'::jsonb, 'boolean', 7),
  ('keeper_action_max_accumulation', 'keeper_action_points', '累積上限', '城主行動點的累積上限（0 = 無上限）', '{"value": 0}'::jsonb, 'number', 8),
  ('monster_upgrade_minion_to_threat', 'monster_upgrade_costs', '雜兵 → 威脅', '將召喚的怪物從雜兵升階為威脅，需額外支付的行動點', '{"value": 2}'::jsonb, 'number', 1),
  ('monster_upgrade_threat_to_elite', 'monster_upgrade_costs', '威脅 → 精英', '將召喚的怪物從威脅升階為精英，需額外支付的行動點', '{"value": 3}'::jsonb, 'number', 2),
  ('monster_upgrade_elite_to_boss', 'monster_upgrade_costs', '精英 → 頭目', '將召喚的怪物從精英升階為頭目，需額外支付的行動點', '{"value": 4}'::jsonb, 'number', 3),
  ('monster_upgrade_boss_to_titan', 'monster_upgrade_costs', '頭目 → 巨頭', '將召喚的怪物從頭目升階為巨頭，需額外支付的行動點（巨頭級需關卡設計允許）', '{"value": 5}'::jsonb, 'number', 4)
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================
-- Seed: 5 範例神話卡
-- ============================================
INSERT INTO mythos_cards (code, name_zh, name_en, description_zh, action_cost, activation_timing, card_category, intensity_tag, flavor_text_zh, design_status) VALUES
  ('mc_deep_call', '深淵呼喚', 'Call of the Deep', '從深淵中召喚一隻克蘇魯眷族的怪物。', 2, 'keeper_phase', 'summon', 'small', '鹹濕的風從遠方吹來，海浪聲中夾雜著某種古老的節奏——牠們來了。', 'approved'),
  ('mc_doom_advance', '末日推進', 'Doom Advance', '加速議程推進速度。', 1, 'keeper_phase', 'agenda', 'small', '時鐘指針加速轉動，某種不祥的計畫正在成熟。', 'approved'),
  ('mc_darkness_falls', '黑暗降臨', 'Darkness Falls', '全場地點陷入黑暗，並對理智最低的調查員施加發瘋狀態。', 3, 'keeper_phase', 'environment', 'medium', '光源一個接一個熄滅，彷彿被無形之物吞噬。有人開始聽見不該聽見的聲音。', 'approved'),
  ('mc_creeping_madness', '瀰漫的瘋狂', 'Creeping Madness', '所有調查員承受 1 點恐懼傷害。', 4, 'keeper_phase', 'global', 'medium', '某種不可名狀的低語同時在每個人的耳邊響起，用的是他們最親近之人的聲音。', 'approved')
ON CONFLICT (code) DO NOTHING;

INSERT INTO mythos_cards (code, name_zh, name_en, description_zh, action_cost, activation_timing, card_category, intensity_tag, response_trigger, flavor_text_zh, design_status) VALUES
  ('mc_ill_omen', '不祥預感', 'Ill Omen', '響應調查員的攻擊行動，強制其重擲並取較差結果。', 2, 'investigator_phase_reaction', 'cancel', 'small', 'investigator_attacks', '就在扣下扳機的瞬間，一股寒意從脊椎竄上。時間彷彿慢了下來，你聽見了自己的心跳，以及——另一個東西的心跳。', 'approved')
ON CONFLICT (code) DO NOTHING;

-- 神話卡的動作（用 SELECT WHERE NOT EXISTS 確保冪等）
INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, description_zh, sort_order)
SELECT id, 'summon_monster', '{"family_code":"house_cthulhu","quantity":1,"base_tier":1,"location_rule":"nearest_to_clue"}'::jsonb,
  '從克蘇魯眷族池中召喚 1 隻雜兵級怪物於最靠近線索的地點', 0
FROM mythos_cards WHERE code='mc_deep_call'
  AND NOT EXISTS (SELECT 1 FROM mythos_card_effects WHERE mythos_card_id = mythos_cards.id);

INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, description_zh, sort_order)
SELECT id, 'advance_agenda', '{"doom_tokens":2}'::jsonb, '議程牌堆放置 2 個毀滅標記', 0
FROM mythos_cards WHERE code='mc_doom_advance'
  AND NOT EXISTS (SELECT 1 FROM mythos_card_effects WHERE mythos_card_id = mythos_cards.id);

INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, description_zh, sort_order)
SELECT id, 'environment_change', '{"change_type":"darkness","target_location_rule":"all_locations"}'::jsonb, '所有地點進入黑暗狀態', 0
FROM mythos_cards WHERE code='mc_darkness_falls'
  AND NOT EXISTS (SELECT 1 FROM mythos_card_effects WHERE mythos_card_id = mythos_cards.id);

INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, description_zh, sort_order)
SELECT id, 'inflict_status', '{"status_code":"madness","value":1,"target_rule":"lowest_san"}'::jsonb, '對理智最低的調查員施加 1 點發瘋狀態', 1
FROM mythos_cards WHERE code='mc_darkness_falls'
  AND NOT EXISTS (SELECT 1 FROM mythos_card_effects WHERE mythos_card_id = mythos_cards.id AND sort_order=1);

INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, description_zh, sort_order)
SELECT id, 'damage_all', '{"damage_physical":0,"damage_horror":1,"target_rule":"all_investigators"}'::jsonb, '所有調查員承受 1 點恐懼傷害', 0
FROM mythos_cards WHERE code='mc_creeping_madness'
  AND NOT EXISTS (SELECT 1 FROM mythos_card_effects WHERE mythos_card_id = mythos_cards.id);

INSERT INTO mythos_card_effects (mythos_card_id, action_code, action_params, description_zh, sort_order)
SELECT id, 'force_reroll', '{"target_rule":"last_attacker","use_worse_result":true}'::jsonb, '強制攻擊方重擲，取較差結果', 0
FROM mythos_cards WHERE code='mc_ill_omen'
  AND NOT EXISTS (SELECT 1 FROM mythos_card_effects WHERE mythos_card_id = mythos_cards.id);

-- ============================================
-- Seed: 2 範例遭遇卡（依賴 MOD-08 的 location_style_tags 已 seed 過 23 個標籤）
-- ============================================
INSERT INTO encounter_cards (code, name_zh, name_en, scenario_text_zh, encounter_type, design_status) VALUES
  ('ec_library_whispers', '書架間的低語', 'Whispers Between the Shelves',
   '你正在書架之間尋找線索，忽然從深處傳來若有似無的低語。仔細一聽，那聲音用的是你某位已故親人的口吻。',
   'choice', 'approved'),
  ('ec_graveyard_call', '墓地的呼喚', 'Call from the Grave',
   '當你走過墓碑之間，一座新翻的墳墓突然開始震動。泥土從墓碑旁滑落，某種東西正從下方掙扎著要出來。',
   'thriller', 'approved')
ON CONFLICT (code) DO NOTHING;

-- 標籤關聯
INSERT INTO encounter_card_tag_map (encounter_card_id, tag_id)
SELECT (SELECT id FROM encounter_cards WHERE code='ec_library_whispers'), id
FROM location_style_tags WHERE code IN ('indoor_library','indoor_mansion')
ON CONFLICT DO NOTHING;

INSERT INTO encounter_card_tag_map (encounter_card_id, tag_id)
SELECT (SELECT id FROM encounter_cards WHERE code='ec_graveyard_call'), id
FROM location_style_tags WHERE code='outdoor_graveyard'
ON CONFLICT DO NOTHING;

-- 選項：書架間的低語（A/B/C）
INSERT INTO encounter_card_options (encounter_card_id, option_label, option_text_zh, requires_check, check_attribute, check_dc,
  success_narrative_zh, success_effects, failure_narrative_zh, failure_effects, sort_order)
SELECT id, 'A', '上前傾聽聲音的來源', TRUE, 'willpower', 4,
  '你穩住心神，靠近那個聲音。在書架最深處的地上，你發現了一張泛黃的紙條——上面記載著某個你一直在追查的線索。',
  '[{"action_code":"gain_clue","params":{"amount":2}}]'::jsonb,
  '那聲音越來越清晰，開始呼喚你的名字。你試圖逃離，但某種無形的存在已經在你心裡扎根。',
  '[{"action_code":"horror","params":{"amount":2}},{"action_code":"inflict_status","params":{"status_code":"madness","value":1}}]'::jsonb,
  0
FROM encounter_cards WHERE code='ec_library_whispers'
  AND NOT EXISTS (SELECT 1 FROM encounter_card_options WHERE encounter_card_id=encounter_cards.id AND option_label='A');

INSERT INTO encounter_card_options (encounter_card_id, option_label, option_text_zh, requires_check, check_attribute, check_dc,
  success_narrative_zh, success_effects, failure_narrative_zh, failure_effects, sort_order)
SELECT id, 'B', '大聲念出驅魔咒文，驅趕這個幻象', TRUE, 'willpower', 6,
  '你的聲音響徹圖書館，低語戛然而止。你感覺到某種東西被迫退去，同時你的精神也得到了鍛鍊。',
  '[{"action_code":"heal_horror","params":{"amount":1}},{"action_code":"gain_xp","params":{"amount":1}}]'::jsonb,
  '你的咒文失敗了，而那個聲音現在在笑。笑聲充滿整個圖書館，其他調查員也聽見了。',
  '[{"action_code":"advance_agenda","params":{"doom_tokens":1}}]'::jsonb,
  1
FROM encounter_cards WHERE code='ec_library_whispers'
  AND NOT EXISTS (SELECT 1 FROM encounter_card_options WHERE encounter_card_id=encounter_cards.id AND option_label='B');

INSERT INTO encounter_card_options (encounter_card_id, option_label, option_text_zh, requires_check,
  no_check_narrative_zh, no_check_effects, sort_order)
SELECT id, 'C', '什麼都不聽，立刻離開這區域', FALSE,
  '你強迫自己轉身離開，耳邊的低語逐漸遠去。你感到一陣疲憊，但至少保住了理智。',
  '[{"action_code":"inflict_status","params":{"status_code":"fatigue","value":1}}]'::jsonb,
  2
FROM encounter_cards WHERE code='ec_library_whispers'
  AND NOT EXISTS (SELECT 1 FROM encounter_card_options WHERE encounter_card_id=encounter_cards.id AND option_label='C');

-- 選項：墓地的呼喚（A/B）
INSERT INTO encounter_card_options (encounter_card_id, option_label, option_text_zh, requires_check, check_attribute, check_dc,
  success_narrative_zh, success_effects, failure_narrative_zh, failure_effects, sort_order)
SELECT id, 'A', '拿起武器準備戰鬥', TRUE, 'agility', 4,
  '你迅速抽出武器擺好架式。從墳墓爬出的食屍鬼被你的氣勢震懾，轉身逃入夜色中。',
  '[{"action_code":"gain_xp","params":{"amount":1}}]'::jsonb,
  '你的反應太慢了。食屍鬼撲上來給了你一下，然後遁入地底。',
  '[{"action_code":"damage","params":{"amount":2}}]'::jsonb,
  0
FROM encounter_cards WHERE code='ec_graveyard_call'
  AND NOT EXISTS (SELECT 1 FROM encounter_card_options WHERE encounter_card_id=encounter_cards.id AND option_label='A');

INSERT INTO encounter_card_options (encounter_card_id, option_label, option_text_zh, requires_check, check_attribute, check_dc,
  success_narrative_zh, success_effects, failure_narrative_zh, failure_effects, sort_order)
SELECT id, 'B', '嘗試與它溝通', TRUE, 'charisma', 5,
  '令人意外地，它對你的話語有了反應。它用破碎的語言告訴你一些這片墓地的秘密。',
  '[{"action_code":"gain_clue","params":{"amount":2}},{"action_code":"horror","params":{"amount":1}}]'::jsonb,
  '它對你發出刺耳的嘶吼，然後撲向你的臉。',
  '[{"action_code":"damage","params":{"amount":1}},{"action_code":"horror","params":{"amount":2}}]'::jsonb,
  1
FROM encounter_cards WHERE code='ec_graveyard_call'
  AND NOT EXISTS (SELECT 1 FROM encounter_card_options WHERE encounter_card_id=encounter_cards.id AND option_label='B');

-- 同步計數
UPDATE mythos_cards SET effect_count = (SELECT COUNT(*) FROM mythos_card_effects WHERE mythos_card_id = mythos_cards.id);
UPDATE encounter_cards SET
  option_count = (SELECT COUNT(*) FROM encounter_card_options WHERE encounter_card_id = encounter_cards.id),
  tag_count = (SELECT COUNT(*) FROM encounter_card_tag_map WHERE encounter_card_id = encounter_cards.id);
`;

const MIGRATION_013_SQL = `
-- ============================================
-- Migration 013: Investigator Designer (MOD-11)
-- Part 1 基礎表 + 64 預設模板 seed + Part 4 V 值系統
-- ============================================

-- 0. 陣營主屬性對照表（支柱五 §1.2 修正案）
CREATE TABLE IF NOT EXISTS faction_attribute_map (
  faction_code    VARCHAR(1) PRIMARY KEY,
  faction_name_zh VARCHAR(16) NOT NULL,
  main_attribute  VARCHAR(16) NOT NULL,
  is_shared       BOOLEAN NOT NULL DEFAULT FALSE,
  note            TEXT
);

INSERT INTO faction_attribute_map (faction_code, faction_name_zh, main_attribute, is_shared, note) VALUES
  ('E', '號令', 'charisma',     FALSE, '領導者靠社交影響力'),
  ('I', '深淵', 'intellect',    TRUE,  '凝視深淵需要深邃思維；與 T 共享智力'),
  ('S', '鐵證', 'perception',   FALSE, '實證派靠觀察、搜索、敵人觀察'),
  ('N', '天啟', 'willpower',    FALSE, '法術施放、精神防禦、神秘學家核心'),
  ('T', '解析', 'intellect',    TRUE,  '純粹智力運用；與 I 共享智力'),
  ('F', '聖燼', 'strength',     FALSE, '燃燒肉身的魄力，替人擋傷害的身體本錢'),
  ('J', '鐵壁', 'constitution', FALSE, '成為防線、承受傷害的肉體堡壘'),
  ('P', '流影', 'agility',      FALSE, '在縫隙中穿梭、反應與閃避')
ON CONFLICT (faction_code) DO NOTHING;

-- 1. 輔助函數：判斷 MBTI 主陣營主屬性
CREATE OR REPLACE FUNCTION main_attr_is(target_attr TEXT, mbti TEXT) RETURNS BOOLEAN AS $$
DECLARE
  main_letter CHAR(1);
  main_attr TEXT;
BEGIN
  main_letter := SUBSTRING(mbti, 1, 1);
  SELECT main_attribute INTO main_attr FROM faction_attribute_map WHERE faction_code = main_letter;
  RETURN main_attr = target_attr;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 輔助函數：計算副陣營主屬性出現次數（I 與 T 共享時會累加）
CREATE OR REPLACE FUNCTION sub_attr_count(target_attr TEXT, mbti TEXT) RETURNS INTEGER AS $$
DECLARE
  c INTEGER := 0;
  sl CHAR(1);
  sa TEXT;
  i INTEGER;
BEGIN
  FOR i IN 2..4 LOOP
    sl := SUBSTRING(mbti, i, 1);
    SELECT main_attribute INTO sa FROM faction_attribute_map WHERE faction_code = sl;
    IF sa = target_attr THEN c := c + 1; END IF;
  END LOOP;
  RETURN c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. investigator_templates 主表（新建，直接含 Part 4 V 值欄位）
CREATE TABLE IF NOT EXISTS investigator_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(32) UNIQUE NOT NULL,
  name_zh               VARCHAR(64),
  name_en               VARCHAR(64),
  title_zh              VARCHAR(64),
  title_en              VARCHAR(64),
  faction_code          VARCHAR(2) CHECK (faction_code IS NULL OR faction_code IN ('E','I','S','N','T','F','J','P')),
  mbti_code             VARCHAR(4),
  career_index          INTEGER CHECK (career_index IS NULL OR (career_index BETWEEN 1 AND 4)),
  dominant_letter       VARCHAR(1),
  attr_strength         INTEGER NOT NULL DEFAULT 1 CHECK (attr_strength BETWEEN 1 AND 5),
  attr_agility          INTEGER NOT NULL DEFAULT 1 CHECK (attr_agility BETWEEN 1 AND 5),
  attr_constitution     INTEGER NOT NULL DEFAULT 1 CHECK (attr_constitution BETWEEN 1 AND 5),
  attr_intellect        INTEGER NOT NULL DEFAULT 1 CHECK (attr_intellect BETWEEN 1 AND 5),
  attr_willpower        INTEGER NOT NULL DEFAULT 1 CHECK (attr_willpower BETWEEN 1 AND 5),
  attr_perception       INTEGER NOT NULL DEFAULT 1 CHECK (attr_perception BETWEEN 1 AND 5),
  attr_charisma         INTEGER NOT NULL DEFAULT 1 CHECK (attr_charisma BETWEEN 1 AND 5),
  proficiency_ids       UUID[] NOT NULL DEFAULT '{}',
  backstory             TEXT,
  ability_text_zh       TEXT,
  ability_text_en       TEXT,
  era_tags              TEXT,
  portrait_url          TEXT,
  is_preset             BOOLEAN NOT NULL DEFAULT FALSE,
  is_completed          BOOLEAN NOT NULL DEFAULT FALSE,

  -- Part 4 V 值欄位
  attribute_value       DECIMAL(6,1) NOT NULL DEFAULT 0,
  hp_value              DECIMAL(6,1) NOT NULL DEFAULT 0,
  san_value             DECIMAL(6,1) NOT NULL DEFAULT 0,
  baseline_value        DECIMAL(6,1) NOT NULL DEFAULT 0,
  proficiency_value     DECIMAL(6,1) NOT NULL DEFAULT 0,
  ability_text_value    DECIMAL(6,1) NOT NULL DEFAULT 0,
  ability_value         DECIMAL(6,1) NOT NULL DEFAULT 0,
  signature_total_value DECIMAL(6,1) NOT NULL DEFAULT 0,
  weakness_value        DECIMAL(6,1) NOT NULL DEFAULT 0,
  total_value           DECIMAL(6,1) NOT NULL DEFAULT 0,
  value_grade           VARCHAR(16)
                        CHECK (value_grade IS NULL OR value_grade IN
                          ('underpowered','below_average','balanced','above_average','overpowered','incomplete')),
  value_last_calculated TIMESTAMPTZ,
  ability_value_source  VARCHAR(16) DEFAULT 'manual'
                        CHECK (ability_value_source IN ('manual','ai_estimated','ai_confirmed')),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- CHECK 約束：完成時 7 屬性總和必須 18；骨架狀態允許 13-18
  CONSTRAINT chk_inv_total_points CHECK (
    CASE WHEN is_completed THEN
      (attr_strength + attr_agility + attr_constitution + attr_intellect +
       attr_willpower + attr_perception + attr_charisma) = 18
    ELSE
      (attr_strength + attr_agility + attr_constitution + attr_intellect +
       attr_willpower + attr_perception + attr_charisma) BETWEEN 13 AND 18
    END
  )
);

CREATE INDEX IF NOT EXISTS idx_inv_templates_mbti ON investigator_templates(mbti_code);
CREATE INDEX IF NOT EXISTS idx_inv_templates_preset ON investigator_templates(is_preset);
CREATE INDEX IF NOT EXISTS idx_inv_templates_completed ON investigator_templates(is_completed);
CREATE INDEX IF NOT EXISTS idx_inv_templates_faction ON investigator_templates(faction_code);
CREATE INDEX IF NOT EXISTS idx_inv_total_value ON investigator_templates(total_value);
CREATE INDEX IF NOT EXISTS idx_inv_value_grade ON investigator_templates(value_grade);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_mbti_career
  ON investigator_templates(mbti_code, career_index)
  WHERE is_preset = TRUE;

-- 3. investigator_signature_cards 表
CREATE TABLE IF NOT EXISTS investigator_signature_cards (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigator_id    UUID NOT NULL REFERENCES investigator_templates(id) ON DELETE CASCADE,
  card_order         INTEGER NOT NULL CHECK (card_order BETWEEN 1 AND 3),
  name_zh            VARCHAR(64) NOT NULL,
  name_en            VARCHAR(64),
  card_type          VARCHAR(16) NOT NULL CHECK (card_type IN ('asset','event','ally','skill')),
  card_style         VARCHAR(8),
  rarity             VARCHAR(16) DEFAULT 'signature',
  cost               INTEGER DEFAULT 0 CHECK (cost BETWEEN 0 AND 6),
  commit_icons       JSONB DEFAULT '[]',
  consume_effect     TEXT,
  play_effect        TEXT,
  play_effect_code   JSONB DEFAULT '[]',
  flavor_text        TEXT,
  illustration_url   TEXT,
  effect_value       DECIMAL(5,1) NOT NULL DEFAULT 0,
  value_breakdown    JSONB NOT NULL DEFAULT '[]',
  value_source       VARCHAR(16) DEFAULT 'manual'
                     CHECK (value_source IN ('manual','ai_estimated','ai_confirmed')),
  value_last_updated TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (investigator_id, card_order)
);

CREATE INDEX IF NOT EXISTS idx_sig_cards_investigator ON investigator_signature_cards(investigator_id);

-- 4. investigator_weaknesses 表
CREATE TABLE IF NOT EXISTS investigator_weaknesses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigator_id     UUID NOT NULL UNIQUE REFERENCES investigator_templates(id) ON DELETE CASCADE,
  name_zh             VARCHAR(64) NOT NULL,
  name_en             VARCHAR(64),
  weakness_type       VARCHAR(32) NOT NULL,
  trigger_condition   TEXT NOT NULL,
  negative_effect     TEXT NOT NULL,
  removal_condition   TEXT,
  backstory           TEXT,
  flavor_text         TEXT,
  effect_value        DECIMAL(5,1) NOT NULL DEFAULT 0,
  trigger_probability DECIMAL(4,3) NOT NULL DEFAULT 0.067,
  expected_rounds     INTEGER NOT NULL DEFAULT 5,
  final_value         DECIMAL(5,1) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weakness_investigator ON investigator_weaknesses(investigator_id);

-- 5. investigator_starting_deck 表
CREATE TABLE IF NOT EXISTS investigator_starting_deck (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigator_id    UUID NOT NULL REFERENCES investigator_templates(id) ON DELETE CASCADE,
  card_definition_id UUID REFERENCES card_definitions(id),
  signature_card_id  UUID REFERENCES investigator_signature_cards(id) ON DELETE CASCADE,
  weakness_id        UUID REFERENCES investigator_weaknesses(id) ON DELETE CASCADE,
  quantity           INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  slot_order         INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_exactly_one_source CHECK (
    (CASE WHEN card_definition_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN signature_card_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN weakness_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);

CREATE INDEX IF NOT EXISTS idx_starting_deck_investigator ON investigator_starting_deck(investigator_id);

-- 6. investigator_value_config — V 值計算參數表
CREATE TABLE IF NOT EXISTS investigator_value_config (
  key            VARCHAR(64) PRIMARY KEY,
  value_numeric  DECIMAL(8,3),
  value_text     TEXT,
  description    TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO investigator_value_config (key, value_numeric, description) VALUES
  ('attribute_per_point_v',       2.0,   '每點屬性值換算 V 值（0.5V × 每屬性 4 次檢定）'),
  ('hp_per_point_v',              1.5,   'HP 上限每點 V 值（heal_hp 基準）'),
  ('san_per_point_v',             1.5,   'SAN 上限每點 V 值（heal_san 基準）'),
  ('proficiency_per_slot_v',      7.5,   '每個戰鬥熟練 V 值（+1 × 15 次戰鬥檢定 × 0.5V）'),
  ('hp_base',                     7.0,   'HP 基礎值（不計入 V 值）'),
  ('san_base',                    7.0,   'SAN 基礎值（不計入 V 值）'),
  ('weakness_default_prob',       0.067, '弱點預設抽到機率（1/15 牌組）'),
  ('weakness_default_rounds',     5.0,   '弱點預設預期觸發回合數'),
  ('zscore_threshold_warn',       1.5,   '過強/過弱的 z-score 閾值（黃色警告）'),
  ('zscore_threshold_alert',      2.0,   '嚴重過強/過弱的 z-score 閾值（紅色警告）'),
  ('faction_imbalance_threshold', 0.10,  '偏重字母分組平均偏離整體的閾值（10%）')
ON CONFLICT (key) DO NOTHING;

-- 7. V 值計算函數
CREATE OR REPLACE FUNCTION calc_attribute_value(
  p_str INT, p_agi INT, p_con INT, p_int INT,
  p_wil INT, p_per INT, p_cha INT
) RETURNS DECIMAL(6,1) AS $$
DECLARE coeff DECIMAL;
BEGIN
  SELECT value_numeric INTO coeff FROM investigator_value_config WHERE key='attribute_per_point_v';
  RETURN (p_str + p_agi + p_con + p_int + p_wil + p_per + p_cha) * COALESCE(coeff, 2.0);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION calc_hp_value(p_con INT) RETURNS DECIMAL(6,1) AS $$
DECLARE coeff DECIMAL;
BEGIN
  SELECT value_numeric INTO coeff FROM investigator_value_config WHERE key='hp_per_point_v';
  RETURN (p_con * 2) * COALESCE(coeff, 1.5);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION calc_san_value(p_wil INT) RETURNS DECIMAL(6,1) AS $$
DECLARE coeff DECIMAL;
BEGIN
  SELECT value_numeric INTO coeff FROM investigator_value_config WHERE key='san_per_point_v';
  RETURN (p_wil * 2) * COALESCE(coeff, 1.5);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION calc_proficiency_value(p_inv_id UUID) RETURNS DECIMAL(6,1) AS $$
DECLARE prof_count INT; coeff DECIMAL;
BEGIN
  SELECT COALESCE(array_length(proficiency_ids, 1), 0) INTO prof_count
    FROM investigator_templates WHERE id = p_inv_id;
  SELECT value_numeric INTO coeff FROM investigator_value_config WHERE key='proficiency_per_slot_v';
  RETURN prof_count * COALESCE(coeff, 7.5);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION calc_signature_total_value(p_inv_id UUID) RETURNS DECIMAL(6,1) AS $$
DECLARE total DECIMAL(6,1);
BEGIN
  SELECT COALESCE(SUM(effect_value), 0) INTO total
    FROM investigator_signature_cards WHERE investigator_id = p_inv_id;
  RETURN total;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION calc_weakness_final_value(p_inv_id UUID) RETURNS DECIMAL(6,1) AS $$
DECLARE ev DECIMAL(5,1); prob DECIMAL(4,3); rnds INT;
BEGIN
  SELECT effect_value, trigger_probability, expected_rounds
    INTO ev, prob, rnds
    FROM investigator_weaknesses WHERE investigator_id = p_inv_id;
  IF ev IS NULL THEN RETURN 0; END IF;
  RETURN ev * prob * rnds;
END;
$$ LANGUAGE plpgsql STABLE;

-- 分級計算（z-score）
CREATE OR REPLACE FUNCTION recalculate_value_grade(p_inv_id UUID) RETURNS VOID AS $$
DECLARE
  t_value DECIMAL(6,1); mean_v DECIMAL(6,1); stddev_v DECIMAL(6,1);
  warn_t DECIMAL(3,2); alert_t DECIMAL(3,2); z DECIMAL(6,2);
  grade_val VARCHAR(16); is_complete BOOLEAN; completed_count INT;
BEGIN
  SELECT total_value, is_completed INTO t_value, is_complete
    FROM investigator_templates WHERE id = p_inv_id;
  IF NOT is_complete THEN
    UPDATE investigator_templates SET value_grade='incomplete' WHERE id = p_inv_id;
    RETURN;
  END IF;
  SELECT COUNT(*) INTO completed_count FROM investigator_templates WHERE is_completed = TRUE;
  IF completed_count < 5 THEN
    UPDATE investigator_templates SET value_grade='balanced' WHERE id = p_inv_id;
    RETURN;
  END IF;
  SELECT AVG(total_value), STDDEV(total_value) INTO mean_v, stddev_v
    FROM investigator_templates WHERE is_completed = TRUE;
  IF stddev_v > 0 THEN z := (t_value - mean_v) / stddev_v; ELSE z := 0; END IF;
  SELECT value_numeric INTO warn_t FROM investigator_value_config WHERE key='zscore_threshold_warn';
  SELECT value_numeric INTO alert_t FROM investigator_value_config WHERE key='zscore_threshold_alert';
  IF z >= alert_t THEN grade_val := 'overpowered';
  ELSIF z >= warn_t THEN grade_val := 'above_average';
  ELSIF z <= -alert_t THEN grade_val := 'underpowered';
  ELSIF z <= -warn_t THEN grade_val := 'below_average';
  ELSE grade_val := 'balanced';
  END IF;
  UPDATE investigator_templates SET value_grade = grade_val WHERE id = p_inv_id;
END;
$$ LANGUAGE plpgsql;

-- 綜合 V 值計算（主函數）
CREATE OR REPLACE FUNCTION calc_total_investigator_value(p_inv_id UUID) RETURNS VOID AS $$
DECLARE
  t RECORD;
  v_attr DECIMAL(6,1); v_hp DECIMAL(6,1); v_san DECIMAL(6,1); v_baseline DECIMAL(6,1);
  v_prof DECIMAL(6,1); v_abtext DECIMAL(6,1); v_ability DECIMAL(6,1);
  v_sig DECIMAL(6,1); v_weak DECIMAL(6,1); v_total DECIMAL(6,1);
BEGIN
  SELECT * INTO t FROM investigator_templates WHERE id = p_inv_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_attr := calc_attribute_value(t.attr_strength, t.attr_agility, t.attr_constitution,
    t.attr_intellect, t.attr_willpower, t.attr_perception, t.attr_charisma);
  v_hp := calc_hp_value(t.attr_constitution);
  v_san := calc_san_value(t.attr_willpower);
  v_baseline := v_attr + v_hp + v_san;
  v_prof := calc_proficiency_value(p_inv_id);
  v_abtext := COALESCE(t.ability_text_value, 0);
  v_ability := v_prof + v_abtext;
  v_sig := calc_signature_total_value(p_inv_id);
  v_weak := calc_weakness_final_value(p_inv_id);
  v_total := v_baseline + v_ability + v_sig + v_weak;
  UPDATE investigator_templates SET
    attribute_value = v_attr,
    hp_value = v_hp,
    san_value = v_san,
    baseline_value = v_baseline,
    proficiency_value = v_prof,
    ability_value = v_ability,
    signature_total_value = v_sig,
    weakness_value = v_weak,
    total_value = v_total,
    value_last_calculated = NOW()
  WHERE id = p_inv_id;
  PERFORM recalculate_value_grade(p_inv_id);
END;
$$ LANGUAGE plpgsql;

-- 全庫重算
CREATE OR REPLACE FUNCTION recalculate_all_investigator_values() RETURNS INTEGER AS $$
DECLARE inv_id UUID; cnt INT := 0;
BEGIN
  FOR inv_id IN SELECT id FROM investigator_templates LOOP
    PERFORM calc_total_investigator_value(inv_id);
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$ LANGUAGE plpgsql;

-- 8. 觸發器
CREATE OR REPLACE FUNCTION trigger_recalc_investigator_value() RETURNS TRIGGER AS $$
BEGIN
  PERFORM calc_total_investigator_value(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inv_recalc_on_update ON investigator_templates;
CREATE TRIGGER trg_inv_recalc_on_update
  AFTER UPDATE OF
    attr_strength, attr_agility, attr_constitution, attr_intellect,
    attr_willpower, attr_perception, attr_charisma,
    proficiency_ids, ability_text_value, is_completed
  ON investigator_templates
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalc_investigator_value();

CREATE OR REPLACE FUNCTION trigger_recalc_from_signature_card() RETURNS TRIGGER AS $$
DECLARE inv_id UUID;
BEGIN
  inv_id := COALESCE(NEW.investigator_id, OLD.investigator_id);
  PERFORM calc_total_investigator_value(inv_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sig_card_recalc ON investigator_signature_cards;
CREATE TRIGGER trg_sig_card_recalc
  AFTER INSERT OR UPDATE OR DELETE ON investigator_signature_cards
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalc_from_signature_card();

CREATE OR REPLACE FUNCTION trigger_recalc_from_weakness() RETURNS TRIGGER AS $$
DECLARE inv_id UUID;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    NEW.final_value := NEW.effect_value * NEW.trigger_probability * NEW.expected_rounds;
  END IF;
  inv_id := COALESCE(NEW.investigator_id, OLD.investigator_id);
  PERFORM calc_total_investigator_value(inv_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_weakness_recalc_bi ON investigator_weaknesses;
CREATE TRIGGER trg_weakness_recalc_bi
  BEFORE INSERT OR UPDATE ON investigator_weaknesses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalc_from_weakness();

DROP TRIGGER IF EXISTS trg_weakness_recalc_ad ON investigator_weaknesses;
CREATE TRIGGER trg_weakness_recalc_ad
  AFTER DELETE ON investigator_weaknesses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalc_from_weakness();

-- 9. 64 筆預設模板骨架 seed
WITH mbti_list AS (
  SELECT unnest(ARRAY[
    'INTJ','INTP','ENTJ','ENTP',
    'INFJ','INFP','ENFJ','ENFP',
    'ISTJ','ISFJ','ESTJ','ESFJ',
    'ISTP','ISFP','ESTP','ESFP'
  ]) AS mbti_code
),
career_numbers AS (
  SELECT generate_series(1, 4) AS career_index
),
skeleton AS (
  SELECT
    m.mbti_code,
    c.career_index,
    SUBSTRING(m.mbti_code, c.career_index, 1) AS dominant_letter
  FROM mbti_list m CROSS JOIN career_numbers c
)
INSERT INTO investigator_templates (
  code, faction_code, mbti_code, career_index, dominant_letter,
  attr_strength, attr_agility, attr_constitution,
  attr_intellect, attr_willpower, attr_perception, attr_charisma,
  is_preset, is_completed
)
SELECT
  s.mbti_code || '-' || s.career_index::text,
  SUBSTRING(s.mbti_code, 1, 1),
  s.mbti_code,
  s.career_index,
  s.dominant_letter,
  1 + CASE WHEN main_attr_is('strength',     s.mbti_code) THEN 3 ELSE 0 END + sub_attr_count('strength',     s.mbti_code),
  1 + CASE WHEN main_attr_is('agility',      s.mbti_code) THEN 3 ELSE 0 END + sub_attr_count('agility',      s.mbti_code),
  1 + CASE WHEN main_attr_is('constitution', s.mbti_code) THEN 3 ELSE 0 END + sub_attr_count('constitution', s.mbti_code),
  1 + CASE WHEN main_attr_is('intellect',    s.mbti_code) THEN 3 ELSE 0 END + sub_attr_count('intellect',    s.mbti_code),
  1 + CASE WHEN main_attr_is('willpower',    s.mbti_code) THEN 3 ELSE 0 END + sub_attr_count('willpower',    s.mbti_code),
  1 + CASE WHEN main_attr_is('perception',   s.mbti_code) THEN 3 ELSE 0 END + sub_attr_count('perception',   s.mbti_code),
  1 + CASE WHEN main_attr_is('charisma',     s.mbti_code) THEN 3 ELSE 0 END + sub_attr_count('charisma',     s.mbti_code),
  TRUE,
  FALSE
FROM skeleton s
ON CONFLICT (code) DO NOTHING;

-- Seed 完成後對 64 筆預設模板跑一次初始 V 值計算
DO $seed$
DECLARE inv_id UUID;
BEGIN
  FOR inv_id IN SELECT id FROM investigator_templates WHERE is_preset = TRUE AND value_last_calculated IS NULL LOOP
    PERFORM calc_total_investigator_value(inv_id);
  END LOOP;
END $seed$;
`;

const MIGRATION_014_SQL = `
-- ============================================
-- Migration 014: MOD-09 鍛造與製作 — 資料表 + 函數
-- ============================================

-- 擴充 card_definitions.is_temporary（Part 2 §8.1）
DO $$ BEGIN
  ALTER TABLE card_definitions ADD COLUMN is_temporary BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 1.1 素材類別
CREATE TABLE IF NOT EXISTS material_categories (
  code              VARCHAR(16) PRIMARY KEY,
  name_zh           VARCHAR(16) NOT NULL,
  name_en           VARCHAR(32) NOT NULL,
  theme_description TEXT,
  source_type       VARCHAR(16) NOT NULL,
  display_color     VARCHAR(8),
  icon_code         VARCHAR(32),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.2 具體素材
CREATE TABLE IF NOT EXISTS material_definitions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code     VARCHAR(16) NOT NULL REFERENCES material_categories(code),
  material_level    INTEGER NOT NULL CHECK (material_level BETWEEN 1 AND 10),
  name_zh           VARCHAR(32) NOT NULL,
  name_en           VARCHAR(64),
  material_value    INTEGER NOT NULL DEFAULT 1,
  monster_family_id UUID,
  description       TEXT,
  flavor_text       TEXT,
  icon_url          TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_materials_category ON material_definitions(category_code);
CREATE INDEX IF NOT EXISTS idx_materials_level ON material_definitions(material_level);
CREATE INDEX IF NOT EXISTS idx_materials_family ON material_definitions(monster_family_id)
  WHERE monster_family_id IS NOT NULL;

-- 依等級自動填入 material_value
CREATE OR REPLACE FUNCTION auto_fill_material_value() RETURNS TRIGGER AS $fn$
BEGIN
  NEW.material_value := CASE
    WHEN NEW.material_level BETWEEN 1 AND 2 THEN 1
    WHEN NEW.material_level BETWEEN 3 AND 4 THEN 2
    WHEN NEW.material_level BETWEEN 5 AND 6 THEN 3
    WHEN NEW.material_level BETWEEN 7 AND 8 THEN 5
    WHEN NEW.material_level BETWEEN 9 AND 10 THEN 8
    ELSE 1
  END;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_fill_material_value ON material_definitions;
CREATE TRIGGER trg_auto_fill_material_value
  BEFORE INSERT OR UPDATE OF material_level ON material_definitions
  FOR EACH ROW EXECUTE FUNCTION auto_fill_material_value();

-- 1.3 鍛造詞條
CREATE TABLE IF NOT EXISTS forging_affixes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(48) UNIQUE NOT NULL,
  name_zh           VARCHAR(32) NOT NULL,
  name_en           VARCHAR(64),
  category_code     VARCHAR(16) NOT NULL REFERENCES material_categories(code),
  effect_description_zh TEXT NOT NULL,
  effect_description_en TEXT,
  applicable_subtypes JSONB NOT NULL DEFAULT '[]',
  tier_mode         VARCHAR(16) NOT NULL DEFAULT 'scaling'
                    CHECK (tier_mode IN ('scaling', 'fixed', 'choice')),
  design_status     VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (design_status IN ('pending', 'partial', 'complete')),
  notes             TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affixes_category ON forging_affixes(category_code);
CREATE INDEX IF NOT EXISTS idx_affixes_status ON forging_affixes(design_status);

-- 1.4 詞條階級
CREATE TABLE IF NOT EXISTS forging_affix_tiers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affix_id          UUID NOT NULL REFERENCES forging_affixes(id) ON DELETE CASCADE,
  tier_label        VARCHAR(32) NOT NULL,
  tier_order        INTEGER NOT NULL DEFAULT 0,
  affix_value       DECIMAL(5,1) NOT NULL DEFAULT 0,
  effect_detail_zh  TEXT,
  effect_detail_en  TEXT,
  choice_payload    JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (affix_id, tier_label)
);

CREATE INDEX IF NOT EXISTS idx_affix_tiers_affix ON forging_affix_tiers(affix_id);

-- 1.5 製作配方
CREATE TABLE IF NOT EXISTS crafting_recipes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(64) UNIQUE NOT NULL,
  name_zh           VARCHAR(64) NOT NULL,
  name_en           VARCHAR(128),
  description       TEXT,
  output_card_id    UUID REFERENCES card_definitions(id),
  output_is_temporary BOOLEAN NOT NULL DEFAULT FALSE,
  output_quantity   INTEGER NOT NULL DEFAULT 1 CHECK (output_quantity >= 1),
  unlock_narrative  TEXT,
  unlock_type       VARCHAR(32),
  design_status     VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (design_status IN ('pending', 'partial', 'complete')),
  notes             TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recipes_output ON crafting_recipes(output_card_id);
CREATE INDEX IF NOT EXISTS idx_recipes_unlock ON crafting_recipes(unlock_type);
CREATE INDEX IF NOT EXISTS idx_recipes_status ON crafting_recipes(design_status);

-- 1.6 配方素材需求
CREATE TABLE IF NOT EXISTS crafting_recipe_materials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id         UUID NOT NULL REFERENCES crafting_recipes(id) ON DELETE CASCADE,
  category_code     VARCHAR(16) REFERENCES material_categories(code),
  specific_material_id UUID REFERENCES material_definitions(id),
  min_material_level INTEGER CHECK (min_material_level BETWEEN 1 AND 10),
  quantity          INTEGER NOT NULL CHECK (quantity >= 1),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT chk_material_specification CHECK (
    (category_code IS NOT NULL AND specific_material_id IS NULL) OR
    (category_code IS NULL AND specific_material_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_recipe_materials_recipe ON crafting_recipe_materials(recipe_id);

-- 二、鍛造費用計算函數：V ÷ SV，向上進位
CREATE OR REPLACE FUNCTION calc_forging_material_quantity(
  p_affix_value DECIMAL,
  p_material_level INTEGER
) RETURNS INTEGER AS $fn$
DECLARE
  sv INTEGER;
BEGIN
  sv := CASE
    WHEN p_material_level BETWEEN 1 AND 2 THEN 1
    WHEN p_material_level BETWEEN 3 AND 4 THEN 2
    WHEN p_material_level BETWEEN 5 AND 6 THEN 3
    WHEN p_material_level BETWEEN 7 AND 8 THEN 5
    WHEN p_material_level BETWEEN 9 AND 10 THEN 8
    ELSE 1
  END;
  RETURN CEIL(p_affix_value / sv);
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION preview_forging_cost(
  p_affix_tier_id UUID,
  p_material_level INTEGER
) RETURNS TABLE (
  affix_name TEXT,
  tier_label TEXT,
  affix_value DECIMAL,
  material_sv INTEGER,
  required_quantity INTEGER
) AS $fn$
BEGIN
  RETURN QUERY
  SELECT
    fa.name_zh::TEXT,
    fat.tier_label::TEXT,
    fat.affix_value,
    (CASE
      WHEN p_material_level BETWEEN 1 AND 2 THEN 1
      WHEN p_material_level BETWEEN 3 AND 4 THEN 2
      WHEN p_material_level BETWEEN 5 AND 6 THEN 3
      WHEN p_material_level BETWEEN 7 AND 8 THEN 5
      WHEN p_material_level BETWEEN 9 AND 10 THEN 8
      ELSE 1
    END)::INTEGER,
    calc_forging_material_quantity(fat.affix_value, p_material_level)
  FROM forging_affix_tiers fat
  JOIN forging_affixes fa ON fa.id = fat.affix_id
  WHERE fat.id = p_affix_tier_id;
END;
$fn$ LANGUAGE plpgsql STABLE;
`;

const MIGRATION_015_SQL = `
-- ============================================
-- Migration 015: MOD-09 鍛造與製作 — Seed Data
-- ============================================

-- 2.1 五個素材類別
INSERT INTO material_categories (code, name_zh, name_en, theme_description, source_type, display_color, sort_order) VALUES
  ('mineral', '礦物',     'Mineral',      '堅硬、鋒利、防護',    'exploration',  '#8B7355', 1),
  ('wood',    '木材',     'Wood',         '結構、支撐、效率',    'exploration',  '#6B4423', 2),
  ('insect',  '蟲類',     'Insect',       '毒素、寄生、腐蝕',    'exploration',  '#556B2F', 3),
  ('fish',    '魚類',     'Fish',         '滑溜、適應、恢復',    'exploration',  '#4A7C9B', 4),
  ('monster', '怪物素材', 'Monster Part', '超自然、力量、恐懼',  'monster_drop', '#7B4EA3', 5)
ON CONFLICT (code) DO NOTHING;

-- 2.2 40 筆非怪物素材骨架（僅於首次 seed 時插入）
DO $seed$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM material_definitions
    WHERE monster_family_id IS NULL AND name_zh = '' LIMIT 1
  ) THEN
    INSERT INTO material_definitions (category_code, material_level, name_zh, name_en, sort_order)
    SELECT c.code, lv.level, '', '', lv.level
    FROM (SELECT code FROM material_categories WHERE source_type = 'exploration') c
    CROSS JOIN (SELECT generate_series(1, 10) AS level) lv;
  END IF;
END
$seed$;

-- 3.x 23 個鍛造詞條
INSERT INTO forging_affixes (code, name_zh, name_en, category_code, effect_description_zh, applicable_subtypes, tier_mode, design_status, notes) VALUES
  ('blade',          '利刃',       'Blade',           'mineral', '傷害 +X',                    '["weapon_melee","weapon_ranged"]'::JSONB,             'scaling', 'complete', NULL),
  ('sturdy',         '堅固',       'Sturdy',          'mineral', '資產 HP +X',                 '["all_asset"]'::JSONB,                                'scaling', 'complete', NULL),
  ('armor_forge',    '護甲鍛造',   'Armor Forging',   'mineral', '使用時獲得護甲 X 層',        '["all_asset"]'::JSONB,                                'scaling', 'complete', NULL),
  ('counter_strike', '反擊',       'Counter Strike',  'mineral', '被攻擊時攻擊者受 X 點傷害',  '["weapon_melee","weapon_ranged"]'::JSONB,             'scaling', 'complete', NULL),
  ('multi_attack',   '多重攻擊',   'Multi Attack',    'mineral', '額外攻擊 X 次',              '["weapon_melee","weapon_ranged"]'::JSONB,             'scaling', 'complete', NULL),
  ('supply',         '補給',       'Supply',          'wood',    '使用次數 +X',                '["weapon_ranged","weapon_arcane","item","arcane_item"]'::JSONB, 'scaling', 'complete', NULL),
  ('lightweight',    '輕量化',     'Lightweight',     'wood',    '費用 -X',                    '["all_asset"]'::JSONB,                                'scaling', 'complete', NULL),
  ('swift',          '快速',       'Swift',           'wood',    '打出時不用行動點',           '["all_asset"]'::JSONB,                                'fixed',   'complete', NULL),
  ('extra_draw',     '附加：抽牌', 'Added: Draw',     'wood',    '使用時抽 X 張卡',            '["all_asset"]'::JSONB,                                'scaling', 'complete', NULL),
  ('extra_recycle',  '附加：回收', 'Added: Recycle',  'wood',    '進入棄牌堆時回收 X 張棄牌堆的卡', '["all_asset"]'::JSONB,                           'scaling', 'complete', NULL),
  ('insect_venom_1', '蟲淬 I',     'Insect Venom I',  'insect',  '攻擊時施加指定的 1 層負面狀態', '["weapon_melee","weapon_ranged","weapon_arcane"]'::JSONB, 'choice', 'complete', '選項：流血、脆弱、潮濕'),
  ('insect_venom_2', '蟲淬 II',    'Insect Venom II', 'insect',  '攻擊時施加指定的 1 層負面狀態', '["weapon_melee","weapon_ranged","weapon_arcane"]'::JSONB, 'choice', 'complete', '選項：中毒、燃燒、冷凍、弱化'),
  ('insect_venom_3', '蟲淬 III',   'Insect Venom III','insect',  '攻擊時施加指定的 1 層負面狀態', '["weapon_melee","weapon_ranged","weapon_arcane"]'::JSONB, 'choice', 'complete', '選項：繳械、疲勞、沈默'),
  ('mend',           '修補',       'Mend',            'fish',    '使用時回復 X HP',            '["all_asset"]'::JSONB,                                'scaling', 'complete', NULL),
  ('soothe',         '安撫',       'Soothe',          'fish',    '使用時回復 X SAN',           '["all_asset"]'::JSONB,                                'scaling', 'complete', NULL),
  ('resilience',     '韌性',       'Resilience',      'fish',    '使用時取消 X 點傷害',        '["all_asset"]'::JSONB,                                'scaling', 'complete', NULL),
  ('extra_shield',   '附加：護盾', 'Added: Shield',   'fish',    '使用時獲得護盾 X 層',        '["all_asset"]'::JSONB,                                'scaling', 'complete', NULL),
  ('extra_regen',    '附加：再生', 'Added: Regen',    'fish',    '使用時獲得再生 X 層',        '["all_asset"]'::JSONB,                                'scaling', 'complete', NULL),
  ('sharpen',        '銳化',       'Sharpen',         'monster', '單屬性檢定 +X',              '["weapon_melee","weapon_ranged","weapon_arcane"]'::JSONB, 'scaling', 'complete', NULL),
  ('intimidate',     '恐嚇',       'Intimidate',      'monster', '命中時造成 X 點恐懼傷害',    '["weapon_melee","weapon_ranged","weapon_arcane"]'::JSONB, 'scaling', 'complete', NULL),
  ('element_enchant','元素附魔',   'Element Enchant', 'monster', '攻擊額外附加指定元素傷害',   '["weapon_melee","weapon_ranged","weapon_arcane"]'::JSONB, 'choice',  'complete', NULL),
  ('extra_stealth',  '附加：隱蔽', 'Added: Stealth',  'monster', '使用時獲得隱蔽 1 層',        '["all_asset"]'::JSONB,                                'fixed',   'complete', NULL),
  ('extra_empower',  '附加：強化', 'Added: Empower',  'monster', '使用時獲得強化 X 層',        '["all_asset"]'::JSONB,                                'scaling', 'complete', NULL)
ON CONFLICT (code) DO NOTHING;

-- 3.x tier：非 choice 模式（scaling + fixed）
WITH tier_data(code, tier_label, tier_order, affix_value, effect_detail_zh) AS (
  VALUES
    ('blade',          '+1', 1, 1.0, '傷害 +1'),
    ('blade',          '+2', 2, 2.0, '傷害 +2'),
    ('blade',          '+3', 3, 3.0, '傷害 +3'),
    ('sturdy',         '+1', 1, 0.5, '資產 HP +1'),
    ('sturdy',         '+2', 2, 1.0, '資產 HP +2'),
    ('sturdy',         '+3', 3, 1.5, '資產 HP +3'),
    ('armor_forge',    '+1', 1, 3.0, '使用時獲得護甲 1 層'),
    ('armor_forge',    '+2', 2, 6.0, '使用時獲得護甲 2 層'),
    ('armor_forge',    '+3', 3, 9.0, '使用時獲得護甲 3 層'),
    ('counter_strike', '+1', 1, 1.0, '被攻擊時攻擊者受 1 點傷害'),
    ('counter_strike', '+2', 2, 2.0, '被攻擊時攻擊者受 2 點傷害'),
    ('counter_strike', '+3', 3, 3.0, '被攻擊時攻擊者受 3 點傷害'),
    ('multi_attack',   '+1', 1, 1.5, '額外攻擊 1 次'),
    ('multi_attack',   '+2', 2, 3.0, '額外攻擊 2 次'),
    ('multi_attack',   '+3', 3, 4.5, '額外攻擊 3 次'),
    ('supply',         '+1', 1, 0.5, '使用次數 +1'),
    ('supply',         '+2', 2, 1.0, '使用次數 +2'),
    ('supply',         '+3', 3, 1.5, '使用次數 +3'),
    ('lightweight',    '+1', 1, 1.0, '費用 -1'),
    ('lightweight',    '+2', 2, 2.0, '費用 -2'),
    ('lightweight',    '+3', 3, 3.0, '費用 -3'),
    ('swift',          'fixed', 1, 1.0, '打出時不用行動點'),
    ('extra_draw',     '+1', 1, 1.0, '使用時抽 1 張卡'),
    ('extra_draw',     '+2', 2, 2.0, '使用時抽 2 張卡'),
    ('extra_draw',     '+3', 3, 3.0, '使用時抽 3 張卡'),
    ('extra_recycle',  '+1', 1, 1.5, '進入棄牌堆時回收 1 張棄牌堆的卡'),
    ('extra_recycle',  '+2', 2, 3.0, '進入棄牌堆時回收 2 張棄牌堆的卡'),
    ('extra_recycle',  '+3', 3, 4.5, '進入棄牌堆時回收 3 張棄牌堆的卡'),
    ('mend',           '+1', 1, 1.5, '使用時回復 1 HP'),
    ('mend',           '+2', 2, 3.0, '使用時回復 2 HP'),
    ('mend',           '+3', 3, 4.5, '使用時回復 3 HP'),
    ('soothe',         '+1', 1, 1.5, '使用時回復 1 SAN'),
    ('soothe',         '+2', 2, 3.0, '使用時回復 2 SAN'),
    ('soothe',         '+3', 3, 4.5, '使用時回復 3 SAN'),
    ('resilience',     '+1', 1, 0.5, '使用時取消 1 點傷害'),
    ('resilience',     '+2', 2, 1.0, '使用時取消 2 點傷害'),
    ('resilience',     '+3', 3, 1.5, '使用時取消 3 點傷害'),
    ('extra_shield',   '+1', 1,  6.0, '使用時獲得護盾 1 層'),
    ('extra_shield',   '+2', 2, 12.0, '使用時獲得護盾 2 層'),
    ('extra_shield',   '+3', 3, 18.0, '使用時獲得護盾 3 層'),
    ('extra_regen',    '+1', 1,  6.0, '使用時獲得再生 1 層'),
    ('extra_regen',    '+2', 2, 12.0, '使用時獲得再生 2 層'),
    ('extra_regen',    '+3', 3, 18.0, '使用時獲得再生 3 層'),
    ('sharpen',        '+1', 1, 0.5, '單屬性檢定 +1'),
    ('sharpen',        '+2', 2, 1.5, '單屬性檢定 +2'),
    ('sharpen',        '+3', 3, 3.0, '單屬性檢定 +3'),
    ('intimidate',     '+1', 1, 3.0, '命中時造成 1 點恐懼傷害'),
    ('intimidate',     '+2', 2, 6.0, '命中時造成 2 點恐懼傷害'),
    ('intimidate',     '+3', 3, 9.0, '命中時造成 3 點恐懼傷害'),
    ('extra_stealth',  'fixed', 1, 6.0, '使用時獲得隱蔽 1 層'),
    ('extra_empower',  '+1', 1, 3.0, '使用時獲得強化 1 層'),
    ('extra_empower',  '+2', 2, 6.0, '使用時獲得強化 2 層'),
    ('extra_empower',  '+3', 3, 9.0, '使用時獲得強化 3 層')
)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh)
SELECT fa.id, td.tier_label, td.tier_order, td.affix_value::DECIMAL(5,1), td.effect_detail_zh
FROM tier_data td
JOIN forging_affixes fa ON fa.code = td.code
ON CONFLICT (affix_id, tier_label) DO NOTHING;

-- 3.x tier：choice 模式（蟲類 + 元素附魔）
WITH choice_data(code, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload) AS (
  VALUES
    ('insect_venom_1', 'bleed',   1, 2.0, '命中施加流血 1 層', '{"status":"bleed","stacks":1}'::JSONB),
    ('insect_venom_1', 'fragile', 2, 2.0, '命中施加脆弱 1 層', '{"status":"fragile","stacks":1}'::JSONB),
    ('insect_venom_1', 'wet',     3, 1.0, '命中施加潮濕 1 層', '{"status":"wet","stacks":1}'::JSONB),
    ('insect_venom_2', 'poison',  1, 3.0, '命中施加中毒 1 層', '{"status":"poison","stacks":1}'::JSONB),
    ('insect_venom_2', 'burn',    2, 3.0, '命中施加燃燒 1 層', '{"status":"burn","stacks":1}'::JSONB),
    ('insect_venom_2', 'freeze',  3, 3.0, '命中施加冷凍 1 層', '{"status":"freeze","stacks":1}'::JSONB),
    ('insect_venom_2', 'weaken',  4, 3.0, '命中施加弱化 1 層', '{"status":"weaken","stacks":1}'::JSONB),
    ('insect_venom_3', 'disarm',  1, 4.0, '命中施加繳械 1 層', '{"status":"disarm","stacks":1}'::JSONB),
    ('insect_venom_3', 'fatigue', 2, 4.0, '命中施加疲勞 1 層', '{"status":"fatigue","stacks":1}'::JSONB),
    ('insect_venom_3', 'silence', 3, 4.0, '命中施加沈默 1 層', '{"status":"silence","stacks":1}'::JSONB),
    ('element_enchant','fire',     1, 2.0, '攻擊額外附加火元素傷害',   '{"element":"fire"}'::JSONB),
    ('element_enchant','ice',      2, 2.0, '攻擊額外附加冰元素傷害',   '{"element":"ice"}'::JSONB),
    ('element_enchant','electric', 3, 2.0, '攻擊額外附加雷元素傷害',   '{"element":"electric"}'::JSONB),
    ('element_enchant','arcane',   4, 3.0, '攻擊額外附加神秘元素傷害', '{"element":"arcane"}'::JSONB)
)
INSERT INTO forging_affix_tiers (affix_id, tier_label, tier_order, affix_value, effect_detail_zh, choice_payload)
SELECT fa.id, cd.tier_label, cd.tier_order, cd.affix_value::DECIMAL(5,1), cd.effect_detail_zh, cd.choice_payload
FROM choice_data cd
JOIN forging_affixes fa ON fa.code = cd.code
ON CONFLICT (affix_id, tier_label) DO NOTHING;
`;

// ============================================
// Migration 016: AI Console tasks (MOD-12)
// ============================================
const MIGRATION_016_SQL = `
CREATE TABLE IF NOT EXISTS ai_console_tasks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,

  module_code        VARCHAR(16) NOT NULL,
  user_prompt        TEXT NOT NULL,
  attached_text      TEXT,
  context_tags       TEXT[] NOT NULL DEFAULT '{}',

  ai_model           VARCHAR(32) NOT NULL,
  ai_response        JSONB,

  status             VARCHAR(16) NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),

  artifacts_created  JSONB NOT NULL DEFAULT '[]',
  error_message      TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_user    ON ai_console_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status  ON ai_console_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_module  ON ai_console_tasks(module_code);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_created ON ai_console_tasks(created_at DESC);
`;

// ============================================
// Migration 017: 戰役敘事設計器 (MOD-06)
//   campaigns / chapters / chapter_outcomes / campaign_flags / interlude_events
// ============================================
const MIGRATION_017_SQL = `
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
`;

// ============================================
// Migration 018: 關卡編輯器 (MOD-07)
//   stages / scenarios / stage_act_cards / stage_agenda_cards
//   stage_encounter_pool / stage_mythos_pool / stage_chaos_bag
//   stage_monster_pool / random_dungeon_generators
// ============================================
const MIGRATION_018_SQL = `
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
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stage_id, card_order)
);
CREATE INDEX IF NOT EXISTS idx_act_cards_stage ON stage_act_cards(stage_id);

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
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stage_id, card_order)
);
CREATE INDEX IF NOT EXISTS idx_agenda_cards_stage ON stage_agenda_cards(stage_id);

CREATE TABLE IF NOT EXISTS stage_encounter_pool (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id            UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  encounter_card_id   UUID NOT NULL,
  weight              INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0),
  UNIQUE (stage_id, encounter_card_id)
);
CREATE INDEX IF NOT EXISTS idx_encounter_pool_stage ON stage_encounter_pool(stage_id);

CREATE TABLE IF NOT EXISTS stage_mythos_pool (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id         UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  mythos_card_id   UUID NOT NULL,
  weight           INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0),
  UNIQUE (stage_id, mythos_card_id)
);
CREATE INDEX IF NOT EXISTS idx_mythos_pool_stage ON stage_mythos_pool(stage_id);

CREATE TABLE IF NOT EXISTS stage_chaos_bag (
  stage_id             UUID PRIMARY KEY REFERENCES stages(id) ON DELETE CASCADE,
  difficulty_preset    VARCHAR(16) NOT NULL DEFAULT 'standard'
                       CHECK (difficulty_preset IN ('easy','standard','hard','expert')),
  number_markers       JSONB NOT NULL DEFAULT '{}'::jsonb,
  scenario_markers     JSONB NOT NULL DEFAULT '{}'::jsonb,
  mythos_markers       JSONB NOT NULL DEFAULT '{}'::jsonb,
  dynamic_markers      JSONB NOT NULL DEFAULT '{"bless":0,"curse":0}'::jsonb
);

CREATE TABLE IF NOT EXISTS stage_monster_pool (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id           UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  family_code        VARCHAR(64) NOT NULL,
  role               VARCHAR(16) NOT NULL
                     CHECK (role IN ('primary','secondary')),
  allowed_tiers      VARCHAR(16)[] NOT NULL DEFAULT '{}',
  fixed_boss_ids     UUID[] NOT NULL DEFAULT '{}',
  UNIQUE (stage_id, family_code)
);
CREATE INDEX IF NOT EXISTS idx_monster_pool_stage ON stage_monster_pool(stage_id);

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
`;

// ============================================
// Migration 019: 支柱一 v0.2 八屬性化連動
// - 新增「反應」屬性 (reflex, 肉體類)
// - 八陣營主屬性一對一對應：T 智力→敏捷、P 敏捷→反應（I、T 不再共享智力）
// - investigator_templates 新增 attr_reflex 欄
// - 骨架模板依新 faction_attribute_map 重算八屬性
// - 總和約束改為八屬性總和（NOT VALID 避開既有資料）
// ============================================
const MIGRATION_019_SQL = `
-- 0. 更新 faction_attribute_map：T→agility、P→reflex、I/F/T 全部 is_shared=FALSE
UPDATE faction_attribute_map
   SET main_attribute='agility', is_shared=FALSE,
       note='戰場流體智力：即時計算彈道、瞬間判斷（v0.2 由 intellect 改為 agility）'
 WHERE faction_code='T';

UPDATE faction_attribute_map
   SET main_attribute='reflex', is_shared=FALSE,
       note='對外界刺激的瞬間應對，直接呼應陣營被動「每回合額外 1 次反應行動」（v0.2 由 agility 改為 reflex）'
 WHERE faction_code='P';

UPDATE faction_attribute_map
   SET is_shared=FALSE,
       note='凝視深淵需要深邃思維（結晶智力：累積的禁忌知識）'
 WHERE faction_code='I';

-- 1. 既有 CHECK 約束移除（將被八屬性版本取代）
ALTER TABLE investigator_templates DROP CONSTRAINT IF EXISTS chk_inv_total_points;

-- 2. 新增 attr_reflex 欄位（DEFAULT 1，與八屬性基礎值一致）
ALTER TABLE investigator_templates
  ADD COLUMN IF NOT EXISTS attr_reflex INTEGER NOT NULL DEFAULT 1
  CHECK (attr_reflex BETWEEN 1 AND 5);

-- 3. 對「骨架」預設模板（is_preset=TRUE AND is_completed=FALSE）以新 faction_attribute_map 重算八屬性
UPDATE investigator_templates SET
  attr_strength     = 1 + CASE WHEN main_attr_is('strength',     mbti_code) THEN 3 ELSE 0 END + sub_attr_count('strength',     mbti_code),
  attr_agility      = 1 + CASE WHEN main_attr_is('agility',      mbti_code) THEN 3 ELSE 0 END + sub_attr_count('agility',      mbti_code),
  attr_constitution = 1 + CASE WHEN main_attr_is('constitution', mbti_code) THEN 3 ELSE 0 END + sub_attr_count('constitution', mbti_code),
  attr_reflex       = 1 + CASE WHEN main_attr_is('reflex',       mbti_code) THEN 3 ELSE 0 END + sub_attr_count('reflex',       mbti_code),
  attr_intellect    = 1 + CASE WHEN main_attr_is('intellect',    mbti_code) THEN 3 ELSE 0 END + sub_attr_count('intellect',    mbti_code),
  attr_willpower    = 1 + CASE WHEN main_attr_is('willpower',    mbti_code) THEN 3 ELSE 0 END + sub_attr_count('willpower',    mbti_code),
  attr_perception   = 1 + CASE WHEN main_attr_is('perception',   mbti_code) THEN 3 ELSE 0 END + sub_attr_count('perception',   mbti_code),
  attr_charisma     = 1 + CASE WHEN main_attr_is('charisma',     mbti_code) THEN 3 ELSE 0 END + sub_attr_count('charisma',     mbti_code)
WHERE is_preset = TRUE AND is_completed = FALSE;

-- 4. 加回總和約束（八屬性版）
--    完成時總和必為 18；骨架允許 14-18
--    使用 NOT VALID 避免既有自建/已完成模板（如有）被擋下；新操作仍會被檢查。
ALTER TABLE investigator_templates
  ADD CONSTRAINT chk_inv_total_points CHECK (
    CASE WHEN is_completed THEN
      (attr_strength + attr_agility + attr_constitution + attr_reflex +
       attr_intellect + attr_willpower + attr_perception + attr_charisma) = 18
    ELSE
      (attr_strength + attr_agility + attr_constitution + attr_reflex +
       attr_intellect + attr_willpower + attr_perception + attr_charisma) BETWEEN 14 AND 18
    END
  ) NOT VALID;
`;

// ============================================
// Migration 020: 支柱一 v0.3 配對修訂（E/I/P 戰鬥風格主熟練）
// 依據：支柱一 v0.3 §1.1 八陣營×戰鬥風格完整配對表
// - E 號令 primary: military → sidearm (配對修訂)
// - I 深淵 primary: arcane → assassin (配對修訂)
// - P 流影 primary: assassin → archery (v0.2 應為敏捷=敏捷型弓術，v0.3 改反應=反應型弓術)
// 條件式 UPDATE：僅在當前 primary 為舊預設值時才更新，避免覆蓋設計者手動修改
// ============================================
const MIGRATION_020_SQL = `
UPDATE talent_trees
   SET combat_proficiency_primary = 'sidearm',
       combat_proficiency_secondary = 'brawl'
 WHERE faction_code = 'E'
   AND combat_proficiency_primary = 'military'
   AND combat_proficiency_secondary = 'brawl';

UPDATE talent_trees
   SET combat_proficiency_primary = 'assassin',
       combat_proficiency_secondary = 'arcane'
 WHERE faction_code = 'I'
   AND combat_proficiency_primary = 'arcane'
   AND combat_proficiency_secondary = 'assassin';

UPDATE talent_trees
   SET combat_proficiency_primary = 'archery',
       combat_proficiency_secondary = 'assassin'
 WHERE faction_code = 'P'
   AND combat_proficiency_primary = 'assassin'
   AND combat_proficiency_secondary = 'archery';
`;

// ============================================
// MOD-06 示範戰役種子（條件式插入，僅在 campaigns 表為空時）
// ============================================
const CHINESE_DIGITS_ARR = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

async function seedInnsmouthCampaign(client: PoolClient) {
  const existing = await client.query('SELECT COUNT(*)::int AS n FROM campaigns');
  if ((existing.rows[0].n as number) > 0) return;

  const seed: any = innsmouthCampaignSeed;

  const campaignRes = await client.query(
    `INSERT INTO campaigns (code, name_zh, name_en, theme, cover_narrative,
                            difficulty_tier, initial_chaos_bag, design_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'published')
     RETURNING id`,
    [
      seed.campaign.code,
      seed.campaign.name_zh,
      seed.campaign.name_en || '',
      seed.campaign.theme || '',
      seed.campaign.cover_narrative || '',
      seed.campaign.difficulty_tier || 'standard',
      JSON.stringify(seed.campaign.initial_chaos_bag || {}),
    ],
  );
  const campaignId: string = campaignRes.rows[0].id;

  // 建章骨架：第 1、2 章用完整資料；第 3–10 章使用 chapters_skeleton 或自動生成
  const chapterIdByCode: Record<string, string> = {};
  const skeletons: any[] = Array.isArray(seed.chapters_skeleton) ? seed.chapters_skeleton : [];
  for (let n = 1; n <= 10; n++) {
    const fullKey = `chapter_${n}_full`;
    const full = seed[fullKey];
    let ch: any;
    if (full) {
      ch = full;
    } else {
      const sk = skeletons.find((s) => s.chapter_number === n);
      ch = {
        chapter_number: n,
        chapter_code: sk?.chapter_code || `ch${n}`,
        name_zh: sk?.name_zh || `第${CHINESE_DIGITS_ARR[n]}章（待設計）`,
        name_en: sk?.name_en || '',
        narrative_intro: '',
        narrative_choices: [],
        design_status: 'draft',
      };
    }
    const chRes = await client.query(
      `INSERT INTO chapters (campaign_id, chapter_number, chapter_code, name_zh, name_en,
                             narrative_intro, narrative_choices, design_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       RETURNING id`,
      [
        campaignId,
        ch.chapter_number,
        ch.chapter_code,
        ch.name_zh || '',
        ch.name_en || '',
        ch.narrative_intro || '',
        JSON.stringify(ch.narrative_choices || []),
        ch.design_status || 'draft',
      ],
    );
    chapterIdByCode[ch.chapter_code] = chRes.rows[0].id;
  }

  // 旗標
  const allFlags: any[] = [
    ...(seed.chapter_1_flags || []),
    ...(seed.chapter_2_flags || []),
  ];
  for (const f of allFlags) {
    await client.query(
      `INSERT INTO campaign_flags (campaign_id, flag_code, category, description_zh,
                                   visibility, chapter_code)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (campaign_id, flag_code) DO NOTHING`,
      [
        campaignId,
        f.flag_code,
        f.category,
        f.description_zh || '',
        f.visibility || 'visible',
        f.chapter_code || null,
      ],
    );
  }

  // 結果分支
  const outcomeGroups: Array<[string, any[]]> = [
    ['ch1', seed.chapter_1_outcomes || []],
    ['ch2', seed.chapter_2_outcomes || []],
  ];
  for (const [chCode, outcomes] of outcomeGroups) {
    const chapterId = chapterIdByCode[chCode];
    if (!chapterId) continue;
    for (const o of outcomes) {
      await client.query(
        `INSERT INTO chapter_outcomes (chapter_id, outcome_code, condition_expression,
                                       narrative_text, next_chapter_version,
                                       chaos_bag_changes, rewards, flag_sets)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)
         ON CONFLICT (chapter_id, outcome_code) DO NOTHING`,
        [
          chapterId,
          o.outcome_code,
          JSON.stringify(o.condition_expression || {}),
          o.narrative_text || '',
          o.next_chapter_version || null,
          JSON.stringify(o.chaos_bag_changes || []),
          JSON.stringify(o.rewards || {}),
          JSON.stringify(o.flag_sets || []),
        ],
      );
    }
  }

  // 間章事件
  for (const e of (seed.chapter_1_interludes || [])) {
    const chapterId = chapterIdByCode['ch1'];
    if (!chapterId) continue;
    await client.query(
      `INSERT INTO interlude_events (chapter_id, event_code, name_zh, name_en,
                                     insertion_point, trigger_condition, operations,
                                     narrative_text_zh, narrative_text_en, choices)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb)
       ON CONFLICT (chapter_id, event_code) DO NOTHING`,
      [
        chapterId,
        e.event_code,
        e.name_zh,
        e.name_en || '',
        e.insertion_point,
        e.trigger_condition ? JSON.stringify(e.trigger_condition) : null,
        JSON.stringify(e.operations || []),
        e.narrative_text_zh || '',
        e.narrative_text_en || '',
        JSON.stringify(e.choices || []),
      ],
    );
  }

  console.log('[MOD-06 seed] 示範戰役「印斯茅斯陰影」已建立');
}

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
    await client.query(MIGRATION_007_SQL);
    await client.query(MIGRATION_008_SQL);
    await client.query(MIGRATION_009_SQL);
    await client.query(MIGRATION_010_SQL);
    await client.query(MIGRATION_011_SQL);
    await client.query(MIGRATION_012_SQL);
    await client.query(MIGRATION_013_SQL);
    await client.query(MIGRATION_014_SQL);
    await client.query(MIGRATION_015_SQL);
    await client.query(MIGRATION_016_SQL);
    await client.query(MIGRATION_017_SQL);
    await client.query(MIGRATION_018_SQL);
    await client.query(MIGRATION_019_SQL);
    await client.query(MIGRATION_020_SQL);
    try {
      await seedInnsmouthCampaign(client);
    } catch (seedErr) {
      console.warn('[MOD-06 seed] 種子資料插入失敗（不影響 migration）:', seedErr);
    }
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
