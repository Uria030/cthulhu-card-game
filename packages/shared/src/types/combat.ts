export interface SkillCheckResult {
  success: boolean;
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  margin: number;
}

export type EnemyTier = 'minion' | 'threat' | 'elite' | 'boss' | 'titan';

export interface Enemy {
  id: string;
  name: string;
  tier: EnemyTier;
  hp: number;
  maxHp: number;
  dc: number;
  damage: number;
  regen: number;
}
