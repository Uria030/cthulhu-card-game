import type { ScenarioState } from './state';

export interface SharedActAction {
  code: string;
  name_zh?: string;
  narrative?: string;
  target_variant?: string;
  ratio?: number;
  damage_type?: string;
  team_limit_per_turn?: number;
}

export interface SharedActionActCard {
  card_order: number;
  shared_actions?: unknown;
}

export interface SharedActionUseState {
  turnNumber: number;
  count: number;
}

function toPositiveNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeSharedAction(raw: unknown): SharedActAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const code = typeof src.code === 'string' ? src.code.trim() : '';
  if (!code) return null;
  return {
    code,
    name_zh: typeof src.name_zh === 'string' ? src.name_zh : undefined,
    narrative: typeof src.narrative === 'string' ? src.narrative : undefined,
    target_variant: typeof src.target_variant === 'string'
      ? src.target_variant
      : (typeof src.targetVariant === 'string' ? src.targetVariant : undefined),
    ratio: toPositiveNumber(src.ratio, 1),
    damage_type: typeof src.damage_type === 'string'
      ? src.damage_type
      : (typeof src.damageType === 'string' ? src.damageType : undefined),
    team_limit_per_turn: Math.max(
      1,
      Math.floor(toPositiveNumber(src.team_limit_per_turn ?? src.teamLimitPerTurn, 1)),
    ),
  };
}

export function normalizeSharedActions(raw: unknown): SharedActAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeSharedAction)
    .filter((action): action is SharedActAction => action !== null);
}

export function sharedActionsForCurrentAct(
  actCards: SharedActionActCard[] | undefined,
  scenario: ScenarioState,
): SharedActAction[] {
  const acts = [...(actCards ?? [])].sort((a, b) => Number(a.card_order) - Number(b.card_order));
  const active = acts[scenario.actIndex ?? 0];
  return normalizeSharedActions(active?.shared_actions);
}

export function findSharedActionForScenario(
  actCards: SharedActionActCard[] | undefined,
  scenario: ScenarioState,
  code: string,
): SharedActAction | null {
  return sharedActionsForCurrentAct(actCards, scenario).find((action) => action.code === code) ?? null;
}

export function sharedActionLimit(action: SharedActAction): number {
  return Math.max(1, Math.floor(action.team_limit_per_turn ?? 1));
}

// Usage records are scoped by turnNumber and expire by comparison instead of
// requiring an explicit reset at turn start. This keeps multiplayer retries
// deterministic even if containers process turn transitions at different times.
export function sharedActionUseCount(scenario: ScenarioState, code: string): number {
  const entry = scenario.sharedActionUses?.[code];
  if (!entry || entry.turnNumber !== scenario.turnNumber) return 0;
  return Math.max(0, Math.floor(Number(entry.count) || 0));
}

export function recordSharedActionUse(
  scenario: ScenarioState,
  code: string,
  increment = 1,
): ScenarioState {
  const current = sharedActionUseCount(scenario, code);
  return {
    ...scenario,
    sharedActionUses: {
      ...(scenario.sharedActionUses ?? {}),
      [code]: {
        turnNumber: scenario.turnNumber,
        count: current + Math.max(1, Math.floor(increment)),
      },
    },
  };
}
