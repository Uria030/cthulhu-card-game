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
('E', '號令天賦樹', 'Herald Talent Tree', 'charisma', 'strength', 'military', 'brawl',
 '團隊增益、共享資源、NPC 互動、領導光環。號令者是隊伍的核心，透過指揮和激勵讓全隊更強。'),
('I', '深淵天賦樹', 'Abyss Talent Tree', 'intellect', 'willpower', 'arcane', 'assassin',
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
('P', '流影天賦樹', 'Flux Talent Tree', 'agility', 'perception', 'assassin', 'archery',
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
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
