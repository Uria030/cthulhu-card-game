/* ========================================
   MOD-12 — bridge output → server POST body mapper
   Handles field renames, type coercions, and subtable packing
   before sanitizeSubtask() applies the whitelist.
   ======================================== */

// ────────────────────────────────────────────
// MOD-01: card_design / combo_design
// bridge cardSchema → POST /api/cards body
// Key translations:
//   consume_effects[] (bridge) → consume_effect (jsonb, single-ish) + consume_enabled
//   play_effect_zh / on_commit_success_zh / on_commit_fail_zh → effects[] rows
//   rarity / effect_value_estimate / keywords → dropped (validator-only)
//   design_notes → kept only if caller wants; server accepts it but DB has no column
// ────────────────────────────────────────────
function mapCard(item) {
  const b = { ...item };
  const mapped = {
    ...b,
    // card_type: 遠端 Gemini 直連 prompt 用 `type`；bridge cardSchema 用 `card_type`。
    // 白名單僅保留 `card_type`，這裡必須改名否則送出 body 兩者皆無 → 500。
    card_type: b.card_type || b.type,
    // style: bridge uses combat_style for skill/asset; cards.ts expects `style` for code prefix
    style: b.style || b.combat_style || 'general',
    // subtypes fallback
    subtypes: Array.isArray(b.subtypes) ? b.subtypes : [],
  };
  delete mapped.type;

  // 過濾被 validateAndFixCardData 標記為 _invalid 的 effect（effect_code 不合法）
  if (Array.isArray(b.effects)) {
    mapped.effects = b.effects.filter((e) => e && !e._invalid);
  }

  // consume_effects (array) → server's consume_effect (single jsonb) + consume_enabled
  if (Array.isArray(b.consume_effects) && b.consume_effects.length > 0) {
    mapped.consume_enabled = true;
    // Pack first effect as primary, stash extras in .additional
    const [primary, ...rest] = b.consume_effects;
    mapped.consume_effect = rest.length
      ? { ...primary, additional: rest }
      : primary;
  }

  // Narrative → effects[] rows for card_effects subtable
  const effects = [];
  if (typeof b.play_effect_zh === 'string' && b.play_effect_zh.trim()) {
    effects.push({
      trigger_type: 'on_play',
      effect_code: 'narrative_on_play',
      description_zh: b.play_effect_zh,
      description_en: b.play_effect_en || null,
      duration: 'instant',
      sort_order: 0,
    });
  }
  if (typeof b.on_commit_success_zh === 'string' && b.on_commit_success_zh.trim()) {
    effects.push({
      trigger_type: 'on_commit_success',
      effect_code: 'narrative_commit_success',
      description_zh: b.on_commit_success_zh,
      duration: 'instant',
      sort_order: effects.length,
    });
  }
  if (typeof b.on_commit_fail_zh === 'string' && b.on_commit_fail_zh.trim()) {
    effects.push({
      trigger_type: 'on_commit_fail',
      effect_code: 'narrative_commit_fail',
      description_zh: b.on_commit_fail_zh,
      duration: 'instant',
      sort_order: effects.length,
    });
  }
  if (effects.length) mapped.effects = effects;

  // AI might forget asset_slot on resource; cards.ts expects `slot` (defaults to 'none')
  if (b.asset_slot && !mapped.slot) mapped.slot = b.asset_slot;

  return mapped;
}

// ────────────────────────────────────────────
// MOD-04: team_spirit
// Gemini output → POST /api/team-spirits (main) + PUT /api/team-spirits/{id}/depths
// 使用 __postSaveActions 讓 executeConfirmedPlan 在主 POST 成功後再送深度
// ────────────────────────────────────────────
function mapSpirit(item) {
  const b = { ...item };
  // Gemini 產出 depth_effects（使用 level 欄位）→ 伺服器 PUT /depths 期望 raw array 且欄位叫 depth
  const rawDepths = Array.isArray(b.depth_effects) ? b.depth_effects : [];
  const depths = rawDepths.map((d, idx) => ({
    depth: d.depth ?? d.level ?? (idx + 1),
    effect_name_zh: d.effect_name_zh || null,
    effect_name_en: d.effect_name_en || null,
    effect_desc_zh: d.effect_desc_zh || null,
    effect_desc_en: d.effect_desc_en || null,
    effect_value: d.effect_value ?? null,
    effect_formula: d.effect_formula || null,
  }));
  delete b.depth_effects;

  if (!b.total_value || b.total_value <= 0) {
    b.total_value = depths.reduce((s, d) => s + (parseFloat(d.effect_value) || 0), 0);
  }
  b.design_status = b.design_status || 'partial';

  if (depths.length > 0) {
    b.__postSaveActions = [
      {
        pathTemplate: '/api/team-spirits/{id}/depths',
        method: 'PUT',
        body: depths, // raw array，不包 {depths: ...}
        label: '精神深度效果（PUT /depths）',
      },
    ];
  }
  return b;
}

// ────────────────────────────────────────────
// MOD-02: talent_tree
// bridge talentNodeSchema → POST /api/talent-trees/:factionCode/nodes body
// factionCode travels via the URL (apiPathResolver), so faction_code is read
// from the item during path build and then NOT written into the POST body.
// ────────────────────────────────────────────
function mapTalentNode(item) {
  const b = { ...item };
  return {
    ...b,
    level: b.level ?? b.tier,                   // bridge: tier → server: level
    talent_point_cost: b.talent_point_cost ?? b.cost_in_points,
    branch_id: b.branch_id ?? null,             // bridge has `branch` (string label) but server expects UUID
    talent_card_code: b.talent_card_code ?? null,
    is_trunk: b.is_trunk ?? (b.node_type === 'basic' || b.node_type === 'milestone'),
    prerequisites: Array.isArray(b.prerequisites) ? b.prerequisites : [],
    boost_amount: b.boost_amount ?? (typeof b.effect_value === 'number' ? b.effect_value : 1),
    design_status: b.design_status ?? 'pending',
    sort_order: b.sort_order ?? 0,
  };
}

// ────────────────────────────────────────────
// MOD-03: enemy_design
// bridge enemySchema → POST /api/admin/monsters/variants
// Requires species_id lookup (bridge emits species_code).
// NOTE: tier enum (minion/threat/elite/boss/titan) → integer 1-5 mapping.
// ────────────────────────────────────────────
const TIER_NAME_TO_INT = { minion: 1, threat: 2, elite: 3, boss: 4, titan: 5 };

// ────────────────────────────────────────────
// MOD-10: mythos_card — POST /api/admin/keeper/mythos-cards
// 主實體，不含 effects（使用者在 MOD-10 頁面自行加效果）
// ────────────────────────────────────────────
function mapMythosCard(item) {
  const b = { ...item };
  // 若 response_trigger 在非 cancel/reaction 情境下有值，server 仍會接受（不強制清空）
  return {
    ...b,
    design_status: b.design_status || 'draft',
  };
}

// ────────────────────────────────────────────
// MOD-11: investigator_template — POST /api/admin/investigators
// 主實體，不含 signature_cards / weakness / starting_deck（使用者在 MOD-11 自行補）
// ────────────────────────────────────────────
function mapInvestigator(item) {
  const b = { ...item };
  // era_tags 伺服器期望是 text[] (PostgreSQL array)，傳 JSON 陣列即可
  return { ...b };
}

function mapEnemyVariant(item, context) {
  const b = { ...item };
  const speciesByCode = (context && context.speciesByCode) || {};
  const species_id = speciesByCode[b.species_code] || null;

  const tierInt =
    typeof b.tier === 'number'
      ? b.tier
      : TIER_NAME_TO_INT[String(b.tier).toLowerCase()] || 1;

  return {
    ...b,
    species_id,
    tier: tierInt,
    hp_base: b.hp_base ?? b.hp ?? 4,
    damage_horror: b.damage_horror ?? b.san_damage ?? 0,
    fear_radius: b.fear_radius ?? b.horror_radius ?? 0,
    fear_value: b.fear_value ?? b.horror_value ?? 0,
    weaknesses: Array.isArray(b.weaknesses) ? b.weaknesses : (b.vulnerabilities || []),
    design_status: b.design_status ?? 'draft',
  };
}

// ────────────────────────────────────────────
// Dispatch + API path resolution (dynamic route params)
// ────────────────────────────────────────────

// ────────────────────────────────────────────
// MOD-08: location
// 主 POST /api/admin/locations；hidden_info 透過 __postSaveActions 獨立送出
// ────────────────────────────────────────────
function mapLocation(item) {
  const b = { ...item };
  const hiddenInfo = Array.isArray(b.hidden_info) ? b.hidden_info : [];
  delete b.hidden_info;

  if (hiddenInfo.length > 0) {
    b.__postSaveActions = hiddenInfo.map((h, idx) => ({
      label: `hidden_info[${idx}]`,
      method: 'POST',
      pathTemplate: '/api/admin/locations/{id}/hidden-info',
      body: {
        title_zh: h.title_zh || null,
        title_en: h.title_en || null,
        description_zh: h.description_zh || '',
        description_en: h.description_en || null,
        reveal_condition_type: h.reveal_condition_type || 'perception_threshold',
        reveal_condition_params: h.reveal_condition_params || { threshold: 3 },
        reward_type: h.reward_type || 'narrative_only',
        reward_params: h.reward_params || {},
      },
    }));
  }
  return b;
}

// ────────────────────────────────────────────
// MOD-05: combat specialization
// 主 POST /api/combat-styles/:styleId/specs（styleId 由 apiPathResolver 帶入）
// ────────────────────────────────────────────
function mapCombatSpec(item) {
  const b = { ...item };
  // style_id 由使用者在 UI 層選定；若 AI 填了就清掉（以路徑為準）
  delete b.style_id;
  delete b.combat_style_id;
  return b;
}

// ────────────────────────────────────────────
// MOD-09: forging affix
// 主 POST /api/affixes；tiers 透過 __postSaveActions 逐筆 POST /api/affixes/:id/tiers
// ────────────────────────────────────────────
function mapAffix(item) {
  const b = { ...item };
  const tiers = Array.isArray(b.tiers) ? b.tiers : [];
  delete b.tiers;

  if (tiers.length > 0) {
    b.__postSaveActions = tiers.map((t, idx) => ({
      label: `tier[${t.tier_label || idx}]`,
      method: 'POST',
      pathTemplate: '/api/affixes/{id}/tiers',
      body: {
        tier_label: t.tier_label,
        tier_order: t.tier_order ?? idx + 1,
        affix_value: t.affix_value ?? 0,
        effect_detail_zh: t.effect_detail_zh || null,
        effect_detail_en: t.effect_detail_en || null,
        choice_payload: t.choice_payload || null,
      },
    }));
  }
  return b;
}

function mapItem(moduleCode, item, context) {
  if (!item || typeof item !== 'object') {
    throw new Error('mapItem: item must be object');
  }
  switch (moduleCode) {
    case 'MOD-01': return mapCard(item);
    case 'MOD-02': return mapTalentNode(item);
    case 'MOD-03': return mapEnemyVariant(item, context);
    case 'MOD-04': return mapSpirit(item);
    case 'MOD-05': return mapCombatSpec(item);
    case 'MOD-08': return mapLocation(item);
    case 'MOD-09': return mapAffix(item);
    case 'MOD-10': return mapMythosCard(item);
    case 'MOD-11': return mapInvestigator(item);
    default:
      throw new Error(`mapItem: no mapper for ${moduleCode}`);
  }
}

function resolveApiPath(moduleConfig, item) {
  if (moduleConfig.apiPathResolver) return moduleConfig.apiPathResolver(item);
  return moduleConfig.api;
}

// Pre-fetch supporting lookup tables needed by mappers.
// For MOD-03 we need species_code → species_id mapping (AI emits species_code strings).
async function buildMapperContext(moduleCode) {
  if (moduleCode !== 'MOD-03') return {};
  try {
    const res = await adminFetch('/api/admin/monsters/species?family_code=');
    if (!res.ok) return { speciesByCode: {} };
    const json = await res.json();
    const byCode = {};
    for (const s of json.data || []) {
      if (s.code) byCode[s.code] = s.id;
    }
    return { speciesByCode: byCode };
  } catch {
    return { speciesByCode: {} };
  }
}

window.mapItem = mapItem;
window.resolveApiPath = resolveApiPath;
window.buildMapperContext = buildMapperContext;
