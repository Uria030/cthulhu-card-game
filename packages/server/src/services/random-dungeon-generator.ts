// MOD-07 隨機地城生成服務
// 決定論：相同 seed 產生相同結果（使用可重現的 hash-based PRNG）
import type { PoolClient } from 'pg';

export interface GenerationResult {
  seed: string;
  stage_metadata: { name_zh: string; narrative: string };
  locations: any[];
  connections: any[];
  scenarios: any[];
  act_cards: any[];
  agenda_cards: any[];
  monster_pool: any[];
  chaos_bag: any;
  mythos_pool: any[];
  encounter_pool: any[];
}

// ──────────────────────────────────────────────
// 簡易可重現 PRNG（無須外部依賴）
// mulberry32 — 32-bit, 狀態可由字串雜湊初始化
// ──────────────────────────────────────────────
function seedFromString(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed: string): () => number {
  return mulberry32(seedFromString(seed));
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function weightedSample<T>(
  items: { item: T; weight: number }[],
  rng: () => number,
): T | null {
  if (!items.length) return null;
  const total = items.reduce((s, x) => s + (x.weight || 1), 0);
  if (total <= 0) return items[0].item;
  let r = rng() * total;
  for (const x of items) {
    r -= x.weight || 1;
    if (r <= 0) return x.item;
  }
  return items[items.length - 1].item;
}

// ──────────────────────────────────────────────
// 主函式
// ──────────────────────────────────────────────

export async function generateRandomDungeon(
  stageId: string,
  seed: string,
  client: PoolClient,
): Promise<GenerationResult> {
  const rng = makeRng(seed);

  const genRes = await client.query(
    `SELECT * FROM random_dungeon_generators WHERE stage_id = $1`,
    [stageId],
  );
  if (genRes.rows.length === 0) throw new Error('產生器未建立');
  const gen = genRes.rows[0];

  const { locations, connections, entryCode } = await generateMap(gen, rng, client);
  const actCards = generateActCards(gen, rng);
  const agendaCards = generateAgendaCards(gen, rng);
  const monsterPool = generateMonsterPool(gen, rng);
  const chaosBag = generateChaosBag(gen, rng);
  const mythosPool = sampleMythosPool(gen, rng);
  const encounterPool = sampleEncounterPool(gen, rng);

  const scenarios = [
    {
      scenario_order: 1,
      name_zh: '起始場景',
      initial_location_codes: locations.map((l: any) => l.code),
      initial_connections: connections,
      investigator_spawn_location: entryCode,
      initial_environment: {},
      initial_enemies: [],
    },
  ];

  return {
    seed,
    stage_metadata: {
      name_zh: `隨機地城(${seed})`,
      narrative: '隨機生成的地城',
    },
    locations,
    connections,
    scenarios,
    act_cards: actCards,
    agenda_cards: agendaCards,
    monster_pool: monsterPool,
    chaos_bag: chaosBag,
    mythos_pool: mythosPool,
    encounter_pool: encounterPool,
  };
}

async function generateMap(
  gen: any,
  rng: () => number,
  client: PoolClient,
): Promise<{ locations: any[]; connections: any[]; entryCode: string | null }> {
  const topo = gen.topology_rules || {};
  const pool: any[] = gen.location_pool || [];
  if (!pool.length) return { locations: [], connections: [], entryCode: null };

  const minCount = Math.max(3, topo.min_count ?? 5);
  const maxCount = Math.max(minCount, topo.max_count ?? 8);
  const targetCount = randInt(rng, minCount, Math.min(maxCount, pool.length));

  const poolSource = pool.map((p: any) => ({ item: p, weight: p.weight || 1 }));
  const selectedCodes = new Set<string>();
  let guard = 0;
  while (selectedCodes.size < targetCount && guard < pool.length * 4) {
    const pick = weightedSample(poolSource, rng);
    if (pick && pick.code) selectedCodes.add(pick.code);
    guard += 1;
  }

  if (selectedCodes.size < Math.min(3, pool.length)) {
    for (const p of pool) {
      selectedCodes.add(p.code);
      if (selectedCodes.size >= targetCount) break;
    }
  }

  const codes = [...selectedCodes];
  const locRes = await client.query(
    `SELECT code, name_zh, name_en, shroud, clues_base, scale_tag
       FROM locations WHERE code = ANY($1::varchar[])`,
    [codes],
  );
  // 保留原順序
  const byCode = new Map(locRes.rows.map((r: any) => [r.code, r]));
  const locations = codes.map((c) => byCode.get(c)).filter(Boolean);

  if (locations.length === 0) {
    return { locations: [], connections: [], entryCode: null };
  }

  const connections = buildConnections(locations, topo, rng);
  const entryCode = locations[0].code;

  return { locations, connections, entryCode };
}

function buildConnections(locations: any[], topo: any, rng: () => number): any[] {
  const shape = topo.shape || 'mesh';

  if (shape === 'linear') {
    return locations.slice(0, -1).map((loc: any, i: number) => ({
      from: loc.code,
      to: locations[i + 1].code,
      cost: 1,
    }));
  }

  if (shape === 'tree') {
    const result: any[] = [];
    for (let i = 1; i < locations.length; i++) {
      const parent = locations[Math.floor(rng() * i)];
      result.push({ from: parent.code, to: locations[i].code, cost: 1 });
    }
    return result;
  }

  if (shape === 'hub') {
    return locations.slice(1).map((loc: any) => ({
      from: locations[0].code,
      to: loc.code,
      cost: 1,
    }));
  }

  // mesh
  const avgDegree = topo.avg_degree || 2.0;
  const seen = new Set<string>();
  const result: any[] = [];
  for (const loc of locations) {
    const edgesNeeded = Math.max(1, Math.round(avgDegree));
    const others = locations.filter((l: any) => l.code !== loc.code);
    for (let i = 0; i < edgesNeeded && i < others.length; i++) {
      const target = others[Math.floor(rng() * others.length)];
      const key = [loc.code, target.code].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ from: loc.code, to: target.code, cost: 1 });
    }
  }
  return result;
}

function generateActCards(gen: any, rng: () => number): any[] {
  const pool = gen.act_template_pool || {};
  const templates: any[] = pool.templates || [];
  const slotCount = Math.max(1, pool.slot_count || 3);
  const result: any[] = [];

  for (let i = 1; i <= slotCount; i++) {
    if (!templates.length) {
      result.push({
        card_order: i,
        name_zh: `目標 ${i}`,
        front_objective_types: ['uncover_truth'],
        front_narrative: '(隨機生成)',
        front_advance_condition: { type: 'spend_clues', count: 6 },
        back_narrative: '',
        back_rewards: { xp: 1 },
      });
      continue;
    }
    const tmpl = pick(templates, rng);
    const adv = tmpl.advance_condition_template || {};
    const range = adv.count_range || [5, 10];
    const count = randInt(rng, range[0], range[1]);
    result.push({
      card_order: i,
      name_zh: tmpl.name_zh || `目標 ${i}`,
      front_objective_types: [tmpl.objective_type || 'uncover_truth'],
      front_narrative: tmpl.narrative_theme || '',
      front_advance_condition: { type: adv.type || 'spend_clues', count },
      back_narrative: '',
      back_rewards: tmpl.rewards || { xp: 1 },
    });
  }
  return result;
}

function generateAgendaCards(gen: any, rng: () => number): any[] {
  const pool = gen.agenda_template_pool || {};
  const templates: any[] = pool.templates || [];
  const slotCount = Math.max(1, pool.slot_count || 3);
  const result: any[] = [];

  for (let i = 1; i <= slotCount; i++) {
    if (!templates.length) {
      result.push({
        card_order: i,
        name_zh: `議案 ${i}`,
        front_narrative: '(隨機生成)',
        front_doom_threshold: randInt(rng, 3, 5),
        back_narrative: '',
        back_penalties: [],
      });
      continue;
    }
    const tmpl = pick(templates, rng);
    const threshRange = tmpl.doom_threshold_range || [3, 5];
    result.push({
      card_order: i,
      name_zh: tmpl.name_zh || `議案 ${i}`,
      front_narrative: tmpl.narrative_theme || '',
      front_doom_threshold: randInt(rng, threshRange[0], threshRange[1]),
      back_narrative: '',
      back_penalties: tmpl.penalties || [],
    });
  }
  return result;
}

function generateMonsterPool(gen: any, rng: () => number): any[] {
  const rules = gen.monster_rules || {};
  const result: any[] = [];
  if (rules.primary_family) {
    result.push({
      family_code: rules.primary_family,
      role: 'primary',
      allowed_tiers: rules.primary_tiers || ['minion', 'threat'],
      fixed_boss_ids: [],
    });
  }
  for (const sec of rules.secondary_families || []) {
    result.push({
      family_code: typeof sec === 'string' ? sec : sec.code,
      role: 'secondary',
      allowed_tiers: (typeof sec === 'object' && sec.tiers) || ['minion'],
      fixed_boss_ids: [],
    });
  }
  // 避免未使用 rng 警告
  void rng;
  return result;
}

function generateChaosBag(gen: any, rng: () => number): any {
  const rules = gen.chaos_bag_rules || {};
  if (rules.fixed) return rules.fixed;

  // 依範圍隨機產生
  const nm = rules.number_markers_range || {
    '+1': [1, 1],
    '0': [2, 2],
    '-1': [2, 2],
    '-2': [2, 2],
  };
  const number_markers: Record<string, number> = {};
  for (const [k, r] of Object.entries(nm)) {
    const [lo, hi] = r as [number, number];
    number_markers[k] = randInt(rng, lo, hi);
  }
  return {
    difficulty_preset: rules.difficulty_preset || 'standard',
    number_markers,
    scenario_markers: rules.scenario_markers || {},
    mythos_markers: rules.mythos_markers || {},
    dynamic_markers: { bless: 0, curse: 0 },
  };
}

function sampleMythosPool(gen: any, rng: () => number): any[] {
  const rules = gen.mythos_pool_rules || {};
  const sources: any[] = rules.sources || [];
  const count = rules.sample_count || Math.min(sources.length, 4);
  const result: any[] = [];
  const remaining = [...sources];
  for (let i = 0; i < count && remaining.length; i++) {
    const idx = Math.floor(rng() * remaining.length);
    const [picked] = remaining.splice(idx, 1);
    result.push({ mythos_card_id: picked.id, weight: picked.weight || 1 });
  }
  return result;
}

function sampleEncounterPool(gen: any, rng: () => number): any[] {
  const rules = gen.encounter_pool_rules || {};
  const sources: any[] = rules.sources || [];
  const count = rules.sample_count || Math.min(sources.length, 8);
  const result: any[] = [];
  const remaining = [...sources];
  for (let i = 0; i < count && remaining.length; i++) {
    const idx = Math.floor(rng() * remaining.length);
    const [picked] = remaining.splice(idx, 1);
    result.push({ encounter_card_id: picked.id, weight: picked.weight || 1 });
  }
  return result;
}
