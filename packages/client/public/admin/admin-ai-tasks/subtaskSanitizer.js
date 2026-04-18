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
