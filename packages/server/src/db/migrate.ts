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
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
