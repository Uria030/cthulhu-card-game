-- ============================================
-- 002: 新增書籍/遺跡欄位、升級系統、缺失欄位
-- ============================================

-- 書籍/遺跡系統欄位
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS is_book BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS is_relic BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS study_method VARCHAR(16) CHECK (study_method IN ('count_only', 'count_and_test'));
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS study_required INTEGER;
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS study_test_attribute VARCHAR(16);
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS study_test_dc INTEGER;
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS study_difficulty_tier INTEGER CHECK (study_difficulty_tier IS NULL OR (study_difficulty_tier >= 1 AND study_difficulty_tier <= 5));
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS study_upgrade_card VARCHAR(32);

-- 升級系統（LV0~5 差異存在同一筆）
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS upgrades JSONB DEFAULT '{}';

-- 缺失的 JSONB 欄位（可能已存在，用 IF NOT EXISTS）
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS commit_icons JSONB DEFAULT '{}';
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS consume_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS consume_effect JSONB;
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS attribute_modifiers JSONB DEFAULT '{}';
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS spell_type VARCHAR(32);
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS spell_casting VARCHAR(32);
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS combat_style VARCHAR(32);
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS xp_cost INTEGER NOT NULL DEFAULT 0;
