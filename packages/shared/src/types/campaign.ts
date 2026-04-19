// MOD-06 戰役敘事設計器 — 完整型別定義

export type CampaignDifficulty = 'easy' | 'standard' | 'hard' | 'expert';
export type DesignStatus = 'draft' | 'review' | 'published';
export type FlagCategory =
  | 'act' | 'agenda' | 'npc' | 'item' | 'location'
  | 'choice' | 'outcome' | 'time' | 'hidden';
export type FlagVisibility = 'visible' | 'conditional' | 'hidden';
export type OutcomeCode = 'A' | 'B' | 'C' | 'D' | 'E';
export type InsertionPoint = 'prologue' | 'epilogue';

export interface Campaign {
  id: string;
  code: string;
  name_zh: string;
  name_en: string;
  theme: string;
  cover_narrative: string;
  difficulty_tier: CampaignDifficulty;
  initial_chaos_bag: Record<string, unknown>;
  design_status: DesignStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: string;
  campaign_id: string;
  chapter_number: number;
  chapter_code: string;
  name_zh: string;
  name_en: string;
  narrative_intro: string;
  narrative_choices: unknown[];
  design_status: DesignStatus;
  created_at: string;
  updated_at: string;
}

export interface ChapterOutcome {
  id: string;
  chapter_id: string;
  outcome_code: OutcomeCode;
  condition_expression: Record<string, unknown>;
  narrative_text: string;
  next_chapter_version: string | null;
  chaos_bag_changes: unknown[];
  rewards: Record<string, unknown>;
  flag_sets: unknown[];
}

export interface CampaignFlag {
  id: string;
  campaign_id: string;
  flag_code: string;
  category: FlagCategory;
  description_zh: string;
  visibility: FlagVisibility;
  chapter_code: string | null;
}

export interface InterludeEvent {
  id: string;
  chapter_id: string;
  event_code: string;
  name_zh: string;
  name_en: string;
  insertion_point: InsertionPoint;
  trigger_condition: Record<string, unknown> | null;
  operations: unknown[];
  narrative_text_zh: string;
  narrative_text_en: string;
  choices: unknown[];
}
