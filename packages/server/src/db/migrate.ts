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
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
