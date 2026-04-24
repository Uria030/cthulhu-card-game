/* ========================================
   MOD-12 — subtask whitelist sanitizer
   Removes AI control fields (type, design_notes, effect_value_estimate, etc.)
   so POST body only contains real DB columns.
   Called AFTER itemMapper has done field renaming.
   ======================================== */

const API_FIELD_WHITELIST = {
  // POST /api/cards — card_definitions columns (+ `effects` array for card_effects subtable)
  'MOD-01': [
    'series', 'name_zh', 'name_en', 'faction', 'style', 'card_type', 'slot',
    'is_unique', 'is_signature', 'is_weakness', 'is_revelation', 'is_exceptional',
    'is_permanent', 'is_extra',
    'level', 'cost', 'cost_currency', 'skill_value',
    'damage', 'horror', 'health_boost', 'sanity_boost',
    'weapon_tier', 'ammo', 'uses', 'consume_type',
    'combat_style', 'attribute_modifiers', 'spell_type', 'spell_casting', 'hand_limit_mod',
    'ally_hp', 'ally_san', 'xp_cost', 'subtypes',
    'flavor_text', 'removable', 'committable', 'lethal_count', 'owner_investigator',
    'commit_icons', 'consume_enabled', 'consume_effect',
    'is_book', 'is_relic', 'study_method', 'study_required',
    'study_test_attribute', 'study_test_dc', 'study_difficulty_tier', 'study_upgrade_card',
    'upgrades', 'transform_to', 'transform_condition', 'transform_reversible',
    // 雙軸戰鬥 v1.0（支柱一 v0.3+）：talisman 11 欄 + 軸向 1 欄
    'is_talisman', 'talisman_type', 'target_threat_types',
    'break_timing', 'break_strength_max', 'break_charge_label', 'break_charge_max',
    'break_test_attribute', 'stockpile_accumulation_rule',
    'break_axis_value', 'kill_axis_value', 'leverage_modifier',
    // 主軸宣告（MOD-01 快速輸入 + 預覽彈窗）
    'primary_axis_layer', 'primary_axis_value',
    'effects',
  ],

  // POST /api/talent-trees/:factionCode/nodes — talent_nodes columns (factionCode is in path)
  'MOD-02': [
    'branch_id', 'level', 'is_trunk', 'node_type',
    'name_zh', 'name_en', 'description_zh', 'description_en',
    'boost_attribute', 'boost_amount', 'talent_card_code',
    'prerequisites', 'talent_point_cost', 'sort_order',
    'design_status', 'design_notes',
  ],

  // POST /api/team-spirits — spirit_definitions columns
  //   depth_effects 由 __postSaveActions 獨立送出，不在本 whitelist
  'MOD-04': [
    'code', 'name_zh', 'name_en', 'category',
    'description', 'description_en', 'design_notes',
    'adopt_effect_zh', 'adopt_effect_en',
    'maxed_effect_zh', 'maxed_effect_en',
    'milestone_name_zh', 'milestone_name_en', 'milestone_desc',
    'milestone_effect_zh', 'milestone_effect_en',
    'effect_tags', 'total_value', 'value_per_cohesion',
    'design_status', 'sort_order',
  ],

  // POST /api/admin/keeper/mythos-cards — mythos_cards columns
  'MOD-10': [
    'code', 'name_zh', 'name_en',
    'description_zh', 'description_en',
    'action_cost', 'activation_timing', 'card_category', 'intensity_tag',
    'response_trigger',
    'flavor_text_zh', 'flavor_text_en',
    'art_url', 'design_notes', 'design_status',
  ],

  // POST /api/admin/investigators — investigator_templates 主體欄位
  //   signature_cards / weakness / starting_deck 為子資源，不在此
  //   attr_* 不由使用者填，伺服器依 mbti_code 自動推算
  'MOD-11': [
    'code', 'faction_code', 'mbti_code', 'career_index', 'dominant_letter',
    'name_zh', 'name_en', 'title_zh', 'title_en',
    'backstory', 'ability_text_zh', 'ability_text_en',
    'era_tags', 'portrait_url',
  ],

  // POST /api/combat-styles/:styleId/specs — specializations columns
  //   style_id 由路徑決定，不在 body
  'MOD-05': [
    'code', 'name_zh', 'name_en', 'attribute',
    'prof_bonus', 'spec_bonus',
    'description_zh', 'description_en',
  ],

  // POST /api/admin/locations — locations columns
  //   hidden_info 由 __postSaveActions 獨立送出，不在本 whitelist
  'MOD-08': [
    'code', 'name_zh', 'name_en',
    'description_zh', 'description_en',
    'scale_tag', 'shroud', 'clues_base', 'clues_per_player',
    'travel_cost', 'travel_cost_type', 'art_type',
    'design_status', 'design_notes',
  ],

  // POST /api/affixes — forging_affixes columns
  //   tiers 由 __postSaveActions 獨立送出，不在本 whitelist
  'MOD-09': [
    'code', 'name_zh', 'name_en',
    'category_code',
    'effect_description_zh', 'effect_description_en',
    'applicable_subtypes',
    'tier_mode', 'design_status', 'notes', 'sort_order',
  ],

  // POST /api/admin/monsters/variants — monster_variants columns
  'MOD-03': [
    'species_id', 'code', 'name_zh', 'name_en', 'tier',
    'dc', 'hp_base', 'hp_per_player', 'damage_physical', 'damage_horror',
    'regen_per_round', 'spell_defense', 'attacks_per_round',
    'fear_radius', 'fear_value', 'fear_type',
    'movement_speed', 'movement_type', 'keywords',
    'attack_element', 'weaknesses', 'resistances', 'immunities', 'resistance_values',
    'inflicted_statuses', 'self_buffs', 'status_immunities',
    'ai_preference', 'ai_preference_param', 'ai_behavior_notes',
    'is_undefeatable', 'phase_count', 'phase_rules', 'legendary_actions', 'environment_effects',
    'description_zh', 'description_en', 'art_url', 'design_notes',
    'attack_card_count', 'sort_order', 'design_status',
  ],
};

function sanitizeSubtask(moduleCode, subtask) {
  const whitelist = API_FIELD_WHITELIST[moduleCode];
  if (!whitelist) throw new Error(`No whitelist defined for module: ${moduleCode}`);
  if (!subtask || typeof subtask !== 'object') throw new Error('subtask must be an object');
  const clean = {};
  for (const key of whitelist) {
    if (subtask[key] !== undefined) clean[key] = subtask[key];
  }
  return clean;
}

window.sanitizeSubtask = sanitizeSubtask;
window.API_FIELD_WHITELIST = API_FIELD_WHITELIST;
