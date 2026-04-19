// MOD-07 關卡編輯器型別
export type StageType = 'main' | 'side' | 'side_return' | 'side_random';
export type MonsterRole = 'primary' | 'secondary';
export type DifficultyPreset = 'easy' | 'standard' | 'hard' | 'expert';
export type StageDesignStatus = 'draft' | 'review' | 'published';
export type ObjectiveType =
  | 'seal_gate'
  | 'defeat_titan'
  | 'uncover_truth'
  | 'escape'
  | 'endurance';

export interface Stage {
  id: string;
  chapter_id: string | null;
  code: string;
  name_zh: string;
  name_en: string;
  stage_type: StageType;
  narrative: string;
  entry_condition: Record<string, unknown> | null;
  completion_flags: unknown[];
  scaling_rules: Record<string, unknown>;
  return_parent_id: string | null;
  return_overrides: Record<string, unknown>;
  return_stage_number: number | null;
  side_signature_card_id: string | null;
  design_status: StageDesignStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Scenario {
  id: string;
  stage_id: string;
  scenario_order: number;
  name_zh: string;
  name_en: string;
  narrative: string;
  initial_location_codes: string[];
  initial_connections: { from: string; to: string; cost?: number }[];
  investigator_spawn_location: string | null;
  initial_environment: Record<string, unknown>;
  initial_enemies: unknown[];
}

export interface StageActCard {
  id: string;
  stage_id: string;
  card_order: number;
  name_zh: string;
  name_en: string;
  front_narrative: string;
  front_objective_types: ObjectiveType[];
  front_advance_condition: Record<string, unknown>;
  front_scaling: Record<string, unknown>;
  back_narrative: string;
  back_flag_sets: unknown[];
  back_rewards: Record<string, unknown>;
  back_map_operations: MapOperation[];
  back_resolution_code: string | null;
}

export interface StageAgendaCard {
  id: string;
  stage_id: string;
  card_order: number;
  name_zh: string;
  name_en: string;
  front_narrative: string;
  front_doom_threshold: number;
  back_narrative: string;
  back_flag_sets: unknown[];
  back_penalties: unknown[];
  back_map_operations: MapOperation[];
  back_resolution_code: string | null;
}

export interface MapOperation {
  verb: string;
  params: Record<string, unknown>;
  disabled?: boolean;
}

export interface StageChaosBag {
  stage_id: string;
  difficulty_preset: DifficultyPreset;
  number_markers: Record<string, number>;
  scenario_markers: Record<string, { count: number; effect?: string; value?: number }>;
  mythos_markers: Record<string, { count: number; value?: number }>;
  dynamic_markers: { bless: number; curse: number };
}

export interface StageMonsterPoolEntry {
  id: string;
  stage_id: string;
  family_code: string;
  role: MonsterRole;
  allowed_tiers: string[];
  fixed_boss_ids: string[];
}

export interface StageEncounterPoolEntry {
  id: string;
  stage_id: string;
  encounter_card_id: string;
  weight: number;
}

export interface StageMythosPoolEntry {
  id: string;
  stage_id: string;
  mythos_card_id: string;
  weight: number;
}

export interface RandomDungeonGenerator {
  stage_id: string;
  location_pool: { code: string; weight: number }[];
  topology_rules: Record<string, unknown>;
  act_template_pool: Record<string, unknown>;
  agenda_template_pool: Record<string, unknown>;
  monster_rules: Record<string, unknown>;
  chaos_bag_rules: Record<string, unknown>;
  mythos_pool_rules: Record<string, unknown>;
  encounter_pool_rules: Record<string, unknown>;
  victory_conditions: unknown[];
  reward_rules: Record<string, unknown>;
  seed_verified_at: string | null;
}
