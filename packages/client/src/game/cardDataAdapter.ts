import type { CardData } from '@cthulhu/shared';

function normaliseCommitIcons(value: unknown): Record<string, number> {
  if (Array.isArray(value)) {
    return value.reduce<Record<string, number>>((icons, raw) => {
      const key = String(raw) === 'wild' ? 'all' : String(raw);
      if (key) icons[key] = (icons[key] ?? 0) + 1;
      return icons;
    }, {});
  }
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, amount]) => [key === 'wild' ? 'all' : key, Number(amount) || 0])
      .filter(([, amount]) => Number(amount) > 0),
  );
}

function normaliseLegacyEffects(value: unknown): NonNullable<CardData['effects']> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw === 'string' && raw.trim()) {
      return [{ trigger_type: 'action', effect_code: raw.trim(), effect_params: {} }];
    }
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const code = String(item.effect_code ?? item.code ?? '').trim();
    if (!code) return [];
    return [{
      trigger_type: String(item.trigger_type ?? 'action'),
      effect_code: code,
      effect_params: item.effect_params && typeof item.effect_params === 'object'
        ? item.effect_params as Record<string, unknown>
        : (item.params && typeof item.params === 'object' ? item.params as Record<string, unknown> : {}),
      condition: item.condition && typeof item.condition === 'object' ? item.condition as Record<string, unknown> : (item.condition ? String(item.condition) : null),
      cost: item.cost && typeof item.cost === 'object' ? item.cost as Record<string, unknown> : null,
      target: item.target ? String(item.target) : null,
      description_zh: item.description_zh ? String(item.description_zh) : null,
    }];
  });
}

/** MOD-11 特殊卡仍使用舊欄名；在容器邊界一次轉成正式 CardData。 */
export function normaliseBootstrapCardData(
  raw: Record<string, unknown>,
  name: string,
  cardType?: string,
  cost?: number | null,
): CardData {
  const standardEffects = Array.isArray(raw.effects) ? raw.effects as NonNullable<CardData['effects']> : [];
  return {
    commit_icons: normaliseCommitIcons(raw.commit_icons),
    name_zh: name, card_type: cardType, cost,
    faction_code: raw.faction_code ? String(raw.faction_code) : null,
    faction: raw.faction ? String(raw.faction) : null,
    rarity: raw.rarity ? String(raw.rarity) : null,
    description_zh: String(raw.description_zh ?? raw.ability_text_zh ?? raw.play_effect ?? ''),
    flavor_text_zh: raw.flavor_text_zh ? String(raw.flavor_text_zh) : (raw.flavor_text ? String(raw.flavor_text) : null),
    flavor_zh: raw.flavor_zh ? String(raw.flavor_zh) : (raw.flavor_text ? String(raw.flavor_text) : null),
    combat_style: raw.combat_style ? String(raw.combat_style) : null,
    primary_axis_layer: raw.primary_axis_layer ? String(raw.primary_axis_layer) : null,
    primary_axis_value: raw.primary_axis_value ? String(raw.primary_axis_value) : null,
    damage_element: raw.damage_element ? String(raw.damage_element) : null,
    ally_hp: raw.ally_hp == null ? null : Number(raw.ally_hp), ally_san: raw.ally_san == null ? null : Number(raw.ally_san), damage: raw.damage == null ? null : Number(raw.damage),
    attribute_modifiers: raw.attribute_modifiers && typeof raw.attribute_modifiers === 'object' ? raw.attribute_modifiers as Record<string, number> : {},
    subtypes: Array.isArray(raw.subtypes) ? raw.subtypes : [], ammo: raw.ammo == null ? null : Number(raw.ammo), uses: raw.uses == null ? null : Number(raw.uses),
    is_talisman: Boolean(raw.is_talisman), talisman_type: raw.talisman_type ? String(raw.talisman_type) : null,
    target_threat_types: raw.target_threat_types as CardData['target_threat_types'], break_timing: raw.break_timing as CardData['break_timing'],
    break_strength_max: raw.break_strength_max == null ? null : Number(raw.break_strength_max), break_charge_label: raw.break_charge_label ? String(raw.break_charge_label) : null,
    break_charge_max: raw.break_charge_max == null ? null : Number(raw.break_charge_max), break_test_attribute: raw.break_test_attribute as CardData['break_test_attribute'],
    stockpile_accumulation_rule: raw.stockpile_accumulation_rule ? String(raw.stockpile_accumulation_rule) : null,
    consume_enabled: Boolean(raw.consume_enabled), consume_effect: raw.consume_effect && typeof raw.consume_effect === 'object' ? raw.consume_effect as Record<string, unknown> : null,
    is_extra: Boolean(raw.is_extra),
    effects: standardEffects.length > 0 ? standardEffects : normaliseLegacyEffects(raw.play_effect_code),
  };
}
