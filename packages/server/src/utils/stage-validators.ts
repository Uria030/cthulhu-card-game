// MOD-07 關卡編輯器 — 跨模組校驗 helper + 重返版合併邏輯
import { pool } from '../db/pool.js';
import type { Pool, PoolClient } from 'pg';

type PgRunner = Pool | PoolClient;

function runner(client?: PoolClient): PgRunner {
  return client ?? pool;
}

// ──────────────────────────────────────────────
// 單一類型校驗
// ──────────────────────────────────────────────

export async function validateLocationCodes(
  codes: string[],
  client?: PoolClient,
): Promise<{ valid: boolean; missing: string[] }> {
  if (!codes || codes.length === 0) return { valid: true, missing: [] };
  const uniq = [...new Set(codes)];
  const res = await runner(client).query(
    `SELECT code FROM locations WHERE code = ANY($1::varchar[])`,
    [uniq],
  );
  const exist = new Set(res.rows.map((r) => r.code));
  const missing = uniq.filter((c) => !exist.has(c));
  return { valid: missing.length === 0, missing };
}

export async function validateMonsterFamilyCodes(
  codes: string[],
  client?: PoolClient,
): Promise<{ valid: boolean; missing: string[] }> {
  if (!codes || codes.length === 0) return { valid: true, missing: [] };
  const uniq = [...new Set(codes)];
  const res = await runner(client).query(
    `SELECT code FROM monster_families WHERE code = ANY($1::varchar[])`,
    [uniq],
  );
  const exist = new Set(res.rows.map((r) => r.code));
  const missing = uniq.filter((c) => !exist.has(c));
  return { valid: missing.length === 0, missing };
}

export async function validateMonsterVariantIds(
  ids: string[],
  client?: PoolClient,
): Promise<{ valid: boolean; missing: string[] }> {
  if (!ids || ids.length === 0) return { valid: true, missing: [] };
  const uniq = [...new Set(ids)];
  const res = await runner(client).query(
    `SELECT id::text AS id FROM monster_variants WHERE id = ANY($1::uuid[])`,
    [uniq],
  );
  const exist = new Set(res.rows.map((r) => r.id));
  const missing = uniq.filter((c) => !exist.has(c));
  return { valid: missing.length === 0, missing };
}

export async function validateMythosCardIds(
  ids: string[],
  client?: PoolClient,
): Promise<{ valid: boolean; missing: string[] }> {
  if (!ids || ids.length === 0) return { valid: true, missing: [] };
  const uniq = [...new Set(ids)];
  const res = await runner(client).query(
    `SELECT id::text AS id FROM mythos_cards WHERE id = ANY($1::uuid[])`,
    [uniq],
  );
  const exist = new Set(res.rows.map((r) => r.id));
  const missing = uniq.filter((c) => !exist.has(c));
  return { valid: missing.length === 0, missing };
}

export async function validateEncounterCardIds(
  ids: string[],
  client?: PoolClient,
): Promise<{ valid: boolean; missing: string[] }> {
  if (!ids || ids.length === 0) return { valid: true, missing: [] };
  const uniq = [...new Set(ids)];
  const res = await runner(client).query(
    `SELECT id::text AS id FROM encounter_cards WHERE id = ANY($1::uuid[])`,
    [uniq],
  );
  const exist = new Set(res.rows.map((r) => r.id));
  const missing = uniq.filter((c) => !exist.has(c));
  return { valid: missing.length === 0, missing };
}

// 從 stage 的 chapter_id 找到 campaign_id，再檢查旗標代碼是否在該戰役字典中
export async function validateStageFlagCodes(
  stageId: string,
  flagCodes: string[],
  client?: PoolClient,
): Promise<{ valid: boolean; missing: string[] }> {
  if (!flagCodes || flagCodes.length === 0) return { valid: true, missing: [] };
  const uniq = [...new Set(flagCodes)];
  const r = runner(client);
  const chRes = await r.query(
    `SELECT ch.campaign_id FROM stages s
       JOIN chapters ch ON ch.id = s.chapter_id
      WHERE s.id = $1`,
    [stageId],
  );
  if (chRes.rows.length === 0) {
    // 支線/重返/隨機沒有 chapter，不校驗旗標字典
    return { valid: true, missing: [] };
  }
  const campaignId = chRes.rows[0].campaign_id;
  const fRes = await r.query(
    `SELECT flag_code FROM campaign_flags
      WHERE campaign_id = $1 AND flag_code = ANY($2::varchar[])`,
    [campaignId, uniq],
  );
  const exist = new Set(fRes.rows.map((x) => x.flag_code));
  const missing = uniq.filter((c) => !exist.has(c));
  return { valid: missing.length === 0, missing };
}

// ──────────────────────────────────────────────
// 從地圖操作指令抽取引用的代碼
// ──────────────────────────────────────────────

export function extractReferencedCodes(operations: any[]): {
  locations: string[];
  families: string[];
  flags: string[];
} {
  const locations = new Set<string>();
  const families = new Set<string>();
  const flags = new Set<string>();

  for (const op of operations || []) {
    const params = op?.params || {};
    const verb = op?.verb || op?.type;
    switch (verb) {
      case 'place_tile':
      case 'remove_tile':
      case 'reveal_tile':
      case 'create_light':
      case 'extinguish_light':
      case 'create_darkness':
      case 'remove_darkness':
      case 'create_fire':
      case 'extinguish_fire':
      case 'place_clue':
        if (params.location_code) locations.add(params.location_code);
        if (Array.isArray(params.auto_connect_to)) {
          for (const c of params.auto_connect_to) locations.add(c);
        }
        break;
      case 'connect_tiles':
      case 'disconnect_tiles':
        if (params.location_a) locations.add(params.location_a);
        if (params.location_b) locations.add(params.location_b);
        break;
      case 'spawn_enemy':
      case 'place_enemy':
        if (params.family_code) families.add(params.family_code);
        if (params.location_code) locations.add(params.location_code);
        break;
      default:
        break;
    }
    if (params.flag_code) flags.add(params.flag_code);
  }

  return {
    locations: [...locations],
    families: [...families],
    flags: [...flags],
  };
}

export function extractFlagCodesFromSets(flagSets: any[]): string[] {
  const out = new Set<string>();
  for (const s of flagSets || []) {
    if (typeof s === 'string') out.add(s);
    else if (s && typeof s.flag_code === 'string') out.add(s.flag_code);
  }
  return [...out];
}

// ──────────────────────────────────────────────
// 統整校驗：依 stage 完整配置收集所有引用，並行查詢
// ──────────────────────────────────────────────

export async function validateStageReferences(
  stageData: any,
  client?: PoolClient,
): Promise<{
  valid: boolean;
  missing: {
    flags: string[];
    locations: string[];
    families: string[];
    boss_ids: string[];
    mythos_cards: string[];
    encounter_cards: string[];
  };
}> {
  const r = runner(client);

  // 收集地點代碼
  const locationSet = new Set<string>();
  for (const sc of stageData.scenarios || []) {
    for (const c of sc.initial_location_codes || []) locationSet.add(c);
    for (const conn of sc.initial_connections || []) {
      if (conn.from) locationSet.add(conn.from);
      if (conn.to) locationSet.add(conn.to);
    }
    if (sc.investigator_spawn_location) locationSet.add(sc.investigator_spawn_location);
    for (const e of sc.initial_enemies || []) {
      if (e.location_code) locationSet.add(e.location_code);
    }
  }

  // 收集旗標代碼 + 地點/家族（從牌堆的 back 指令）
  const flagSet = new Set<string>();
  const familySet = new Set<string>();
  const bossIdSet = new Set<string>();

  for (const ac of stageData.act_cards || []) {
    for (const f of extractFlagCodesFromSets(ac.back_flag_sets)) flagSet.add(f);
    const refs = extractReferencedCodes(ac.back_map_operations);
    refs.locations.forEach((c) => locationSet.add(c));
    refs.families.forEach((c) => familySet.add(c));
  }
  for (const ag of stageData.agenda_cards || []) {
    for (const f of extractFlagCodesFromSets(ag.back_flag_sets)) flagSet.add(f);
    const refs = extractReferencedCodes(ag.back_map_operations);
    refs.locations.forEach((c) => locationSet.add(c));
    refs.families.forEach((c) => familySet.add(c));
    for (const p of ag.back_penalties || []) {
      for (const sp of p.spawn_monsters || []) {
        if (sp.family_code) familySet.add(sp.family_code);
        if (sp.location_code) locationSet.add(sp.location_code);
      }
    }
  }
  for (const c of stageData.completion_flags || []) {
    if (typeof c === 'string') flagSet.add(c);
    else if (c && typeof c.flag_code === 'string') flagSet.add(c.flag_code);
  }

  // 家族池、固定頭目
  for (const mp of stageData.monster_pool || []) {
    if (mp.family_code) familySet.add(mp.family_code);
    for (const id of mp.fixed_boss_ids || []) bossIdSet.add(id);
  }

  // 神話 / 遭遇卡池
  const mythosIds = (stageData.mythos_pool || []).map((m: any) => m.mythos_card_id).filter(Boolean);
  const encounterIds = (stageData.encounter_pool || [])
    .map((m: any) => m.encounter_card_id)
    .filter(Boolean);

  const [locV, famV, bossV, mythosV, encV] = await Promise.all([
    validateLocationCodes([...locationSet], client),
    validateMonsterFamilyCodes([...familySet], client),
    validateMonsterVariantIds([...bossIdSet], client),
    validateMythosCardIds(mythosIds, client),
    validateEncounterCardIds(encounterIds, client),
  ]);

  // 旗標只對主線校驗
  let flagMissing: string[] = [];
  if (stageData.stage_type === 'main' && stageData.id) {
    const v = await validateStageFlagCodes(stageData.id, [...flagSet], client);
    flagMissing = v.missing;
  } else if (stageData.chapter_id) {
    const chRes = await r.query(`SELECT campaign_id FROM chapters WHERE id = $1`, [
      stageData.chapter_id,
    ]);
    if (chRes.rows.length > 0) {
      const flags = [...flagSet];
      if (flags.length > 0) {
        const fRes = await r.query(
          `SELECT flag_code FROM campaign_flags
            WHERE campaign_id = $1 AND flag_code = ANY($2::varchar[])`,
          [chRes.rows[0].campaign_id, flags],
        );
        const exist = new Set(fRes.rows.map((x: any) => x.flag_code));
        flagMissing = flags.filter((c) => !exist.has(c));
      }
    }
  }

  const missing = {
    flags: flagMissing,
    locations: locV.missing,
    families: famV.missing,
    boss_ids: bossV.missing,
    mythos_cards: mythosV.missing,
    encounter_cards: encV.missing,
  };
  const valid = Object.values(missing).every((a) => a.length === 0);
  return { valid, missing };
}

// ──────────────────────────────────────────────
// 重返版 overrides 合併
// ──────────────────────────────────────────────

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

const TIER_ORDER = ['minion', 'threat', 'elite', 'boss', 'titan'];

function adjustTiers(tiers: string[], adjustment: string): string[] {
  const delta = parseInt(adjustment, 10) || 0;
  return (tiers || []).map((t) => {
    const idx = TIER_ORDER.indexOf(t);
    if (idx < 0) return t;
    const newIdx = Math.max(0, Math.min(TIER_ORDER.length - 1, idx + delta));
    return TIER_ORDER[newIdx];
  });
}

function mergeCardOverrides(
  originalCards: any[],
  overrides: Record<string, any>,
): any[] {
  const result = (originalCards || []).map(deepClone);
  const byOrder = new Map<number, any>(result.map((c: any) => [c.card_order, c]));

  let maxOrder = result.reduce((m: number, c: any) => Math.max(m, c.card_order), 0);

  for (const [key, overrideCard] of Object.entries(overrides)) {
    if (key.startsWith('new_')) {
      maxOrder += 1;
      result.push({ ...overrideCard, card_order: maxOrder });
    } else {
      const orderNum = parseInt(key, 10);
      const existing = byOrder.get(orderNum);
      if (existing) Object.assign(existing, overrideCard);
    }
  }

  return result.sort((a, b) => a.card_order - b.card_order);
}

function applyMonsterPoolOverride(original: any[], override: any): any[] {
  const result = (original || []).map(deepClone);

  if (override.primary_family_tier_adjustment) {
    const primary = result.find((p: any) => p.role === 'primary');
    if (primary) {
      primary.allowed_tiers = adjustTiers(
        primary.allowed_tiers || [],
        override.primary_family_tier_adjustment,
      );
    }
  }

  if (override.fixed_boss_replacement) {
    const { original_boss_id, new_boss_id } = override.fixed_boss_replacement;
    for (const pool of result) {
      const idx = (pool.fixed_boss_ids || []).indexOf(original_boss_id);
      if (idx >= 0) pool.fixed_boss_ids[idx] = new_boss_id;
    }
  }

  if (Array.isArray(override.add_families)) {
    for (const add of override.add_families) result.push(deepClone(add));
  }

  return result;
}

function applyChaosBagOverride(original: any, override: any): any {
  const result = deepClone(original || {});

  if (Array.isArray(override.additions)) {
    for (const ch of override.additions) {
      result.number_markers = result.number_markers || {};
      // 優先更新 number_markers 的同名鍵；否則新增到 scenario_markers 的 count
      if (ch.marker && ch.marker.startsWith('+') || ch.marker === '0' ||
          (ch.marker && ch.marker.startsWith('-'))) {
        result.number_markers[ch.marker] =
          (result.number_markers[ch.marker] || 0) + (ch.count || 0);
      } else if (result.scenario_markers && result.scenario_markers[ch.marker]) {
        result.scenario_markers[ch.marker].count =
          (result.scenario_markers[ch.marker].count || 0) + (ch.count || 0);
      } else if (result.mythos_markers && result.mythos_markers[ch.marker]) {
        result.mythos_markers[ch.marker].count =
          (result.mythos_markers[ch.marker].count || 0) + (ch.count || 0);
      }
    }
  }

  if (Array.isArray(override.removals)) {
    for (const ch of override.removals) {
      if (result.number_markers && result.number_markers[ch.marker] !== undefined) {
        result.number_markers[ch.marker] = Math.max(
          0,
          (result.number_markers[ch.marker] || 0) - (ch.count || 0),
        );
      } else if (result.scenario_markers && result.scenario_markers[ch.marker]) {
        result.scenario_markers[ch.marker].count = Math.max(
          0,
          (result.scenario_markers[ch.marker].count || 0) - (ch.count || 0),
        );
      }
    }
  }

  if (override.difficulty_preset) result.difficulty_preset = override.difficulty_preset;

  return result;
}

function applyPoolOverride(
  original: any[],
  override: any,
  idKey: 'mythos_card_id' | 'encounter_card_id',
): any[] {
  let result = (original || []).map(deepClone);

  if (Array.isArray(override.remove_cards)) {
    const toRemove = new Set(
      override.remove_cards.map((c: any) => c[idKey] || c.card_id).filter(Boolean),
    );
    result = result.filter((p: any) => !toRemove.has(p[idKey]));
  }
  if (Array.isArray(override.add_cards)) {
    for (const add of override.add_cards) result.push(deepClone(add));
  }
  return result;
}

export function resolveReturnStage(returnStage: any, parentStage: any): any {
  const overrides = returnStage.return_overrides || {};
  const resolved = deepClone(parentStage);

  if (overrides.stage_metadata) Object.assign(resolved, overrides.stage_metadata);

  if (overrides.act_cards) {
    resolved.act_cards = mergeCardOverrides(parentStage.act_cards || [], overrides.act_cards);
  }
  if (overrides.agenda_cards) {
    resolved.agenda_cards = mergeCardOverrides(
      parentStage.agenda_cards || [],
      overrides.agenda_cards,
    );
  }
  if (overrides.monster_pool) {
    resolved.monster_pool = applyMonsterPoolOverride(
      parentStage.monster_pool || [],
      overrides.monster_pool,
    );
  }
  if (overrides.chaos_bag) {
    resolved.chaos_bag = applyChaosBagOverride(parentStage.chaos_bag || {}, overrides.chaos_bag);
  }
  if (overrides.mythos_pool) {
    resolved.mythos_pool = applyPoolOverride(
      parentStage.mythos_pool || [],
      overrides.mythos_pool,
      'mythos_card_id',
    );
  }
  if (overrides.encounter_pool) {
    resolved.encounter_pool = applyPoolOverride(
      parentStage.encounter_pool || [],
      overrides.encounter_pool,
      'encounter_card_id',
    );
  }

  resolved._is_return_resolved = true;
  resolved._return_parent_id = parentStage.id;
  resolved._return_stage_number = returnStage.return_stage_number;
  resolved._original_stage_id = returnStage.id;
  resolved._original_code = returnStage.code;
  resolved._original_name_zh = returnStage.name_zh;

  return resolved;
}
