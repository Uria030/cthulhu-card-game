import type { ResultEffect } from './messages';
import type { InvestigatorState } from './state';
import type { CardData, CardDataLookup } from './ruleEngine';
import { applyIncomingDamageToPlayer } from './ally';

export type ReactionTrigger = 'before_take_damage' | 'before_take_horror';

export interface ReactionOperation {
  kind: 'damage' | 'horror';
  amount: number;
  source?: string;
  direct?: boolean;
}

export interface ReactionCandidate {
  cardInstanceId: string;
  effectIndex: number;
  zone: 'hand' | 'extra' | 'asset';
  name: string;
  preventAmount: number;
  resourceCost: number;
  useCost: number;
  exhaustSelf: boolean;
}

/**
 * 供容器保存的 reaction 交易，不包含 closure；多人重連時可重建同一窗口。
 * candidates 只可經私有狀態端點送給 targetInvestigatorId 的控制者。
 */
export interface PendingReaction {
  id: string;
  targetInvestigatorId: string;
  trigger: ReactionTrigger;
  operation: ReactionOperation;
  candidates: ReactionCandidate[];
}

export type ReactionDecision =
  | { kind: 'pass' }
  | { kind: 'play'; cardInstanceId: string; effectIndex: number };

export interface ReactionResolution {
  investigator: InvestigatorState;
  effects: ResultEffect[];
  outcome: 'passed' | 'played' | 'invalid';
  triggeredCardInstanceId?: string;
  reason?: string;
}

type CardReactionEffect = NonNullable<CardData['effects']>[number];

function nonNegative(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function reactionTriggerFor(operation: ReactionOperation): ReactionTrigger {
  return operation.kind === 'damage' ? 'before_take_damage' : 'before_take_horror';
}

function conditionValue(condition: CardReactionEffect['condition']): string | null {
  if (typeof condition === 'string' && condition.trim()) return condition.trim().toLowerCase();
  if (!condition || typeof condition !== 'object') return null;
  for (const key of ['trigger', 'event', 'when', 'type']) {
    const value = condition[key];
    if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  }
  return null;
}

function preventionAmount(effect: CardReactionEffect, operation: ReactionOperation): number {
  const code = String(effect.effect_code ?? '');
  const amount = nonNegative(effect.effect_params?.amount);
  if (operation.kind === 'damage' && code === 'heal_hp') return amount;
  if (operation.kind === 'horror' && code === 'heal_san') return amount;
  return 0;
}

function candidateFor(
  investigator: InvestigatorState,
  cardInstanceId: string,
  zone: ReactionCandidate['zone'],
  card: CardData | undefined,
  effect: CardReactionEffect,
  effectIndex: number,
  operation: ReactionOperation,
): ReactionCandidate | null {
  if (!card || String(effect.trigger_type ?? '').toLowerCase() !== 'reaction') return null;
  if (conditionValue(effect.condition) !== reactionTriggerFor(operation)) return null;
  const preventAmount = preventionAmount(effect, operation);
  if (preventAmount <= 0) return null;
  const cost = effect.cost ?? {};
  const candidate: ReactionCandidate = {
    cardInstanceId,
    effectIndex,
    zone,
    name: card.name_zh ?? cardInstanceId,
    preventAmount,
    resourceCost: nonNegative(cost.resource ?? (zone === 'asset' ? 0 : card.cost)),
    useCost: nonNegative(cost.uses ?? cost.ammo),
    exhaustSelf: cost.exhaust_self === true,
  };
  if (investigator.resources < candidate.resourceCost) return null;
  if (candidate.zone !== 'asset') return candidate;
  const assetState = investigator.assetState?.[cardInstanceId];
  if (candidate.useCost > 0 && (assetState?.usesLeft == null || assetState.usesLeft < candidate.useCost)) return null;
  if (candidate.exhaustSelf && assetState?.exhausted === true) return null;
  return candidate;
}

/** Returns only reaction cards that can actually reduce the pending operation. */
export function findReactionCandidates(
  investigator: InvestigatorState,
  cardLookup: CardDataLookup,
  operation: ReactionOperation,
): ReactionCandidate[] {
  const candidates: ReactionCandidate[] = [];
  const zones: Array<[ReactionCandidate['zone'], string[]]> = [
    ['hand', investigator.hand],
    ['extra', investigator.extraDeck ?? []],
    ['asset', investigator.assetsInPlay],
  ];
  for (const [zone, ids] of zones) {
    for (const cardInstanceId of ids) {
      const card = cardLookup[cardInstanceId];
      if ((zone === 'hand' || zone === 'extra') && card?.card_type !== 'event') continue;
      for (const [effectIndex, effect] of (card?.effects ?? []).entries()) {
        const candidate = candidateFor(investigator, cardInstanceId, zone, card, effect, effectIndex, operation);
        if (candidate) candidates.push(candidate);
      }
    }
  }
  return candidates;
}

export function openReactionWindow(
  id: string,
  investigator: InvestigatorState,
  cardLookup: CardDataLookup,
  operation: ReactionOperation,
): PendingReaction | null {
  const candidates = findReactionCandidates(investigator, cardLookup, operation);
  if (candidates.length === 0) return null;
  return { id, targetInvestigatorId: investigator.investigatorId, trigger: reactionTriggerFor(operation), operation, candidates };
}

/**
 * Applies the original operation through the existing ally-allocation path.
 * A reaction changes the amount first; it must not bypass the shared damage
 * rules merely because it was opened before the hit lands.
 */
export function settleReactionOperation(
  investigator: InvestigatorState,
  operation: ReactionOperation,
  effects: ResultEffect[] = [],
): InvestigatorState {
  const amount = nonNegative(operation.amount);
  const applied = operation.kind === 'damage'
    ? applyIncomingDamageToPlayer(investigator, amount, 0, { direct: operation.direct === true })
    : applyIncomingDamageToPlayer(investigator, 0, amount, { direct: operation.direct === true });
  if (operation.kind === 'damage') {
    effects.push({ type: 'reaction_damage_applied', params: { amount, source: operation.source ?? '', direct: operation.direct === true }, targetId: investigator.investigatorId });
  } else {
    effects.push({ type: 'reaction_horror_applied', params: { amount, source: operation.source ?? '', direct: operation.direct === true }, targetId: investigator.investigatorId });
  }
  effects.push(...applied.effects);
  return applied.investigator;
}

function removePlayedCard(investigator: InvestigatorState, candidate: ReactionCandidate): InvestigatorState {
  if (candidate.zone === 'asset') return investigator;
  if (candidate.zone === 'hand') {
    return {
      ...investigator,
      hand: investigator.hand.filter((id) => id !== candidate.cardInstanceId),
      discardPile: [...investigator.discardPile, candidate.cardInstanceId],
    };
  }
  return {
    ...investigator,
    extraDeck: (investigator.extraDeck ?? []).filter((id) => id !== candidate.cardInstanceId),
    discardPile: [...investigator.discardPile, candidate.cardInstanceId],
  };
}

/**
 * Resolves one pending reaction and always settles the original operation once.
 * The room service owns sequence de-duplication and writes triggeredCardInstanceId
 * into TurnState; this pure function deliberately has no mutable closure/state.
 */
export function resolvePendingReaction(
  pending: PendingReaction,
  decision: ReactionDecision,
  investigator: InvestigatorState,
  alreadyTriggeredCardIds: readonly string[] = [],
): ReactionResolution {
  const effects: ResultEffect[] = [];
  if (decision.kind === 'pass') {
    const settled = settleReactionOperation(investigator, pending.operation, effects);
    effects.unshift({ type: 'reaction_passed', params: { reactionId: pending.id, trigger: pending.trigger }, targetId: investigator.investigatorId });
    return { investigator: settled, effects, outcome: 'passed' };
  }

  const candidate = pending.candidates.find((item) => item.cardInstanceId === decision.cardInstanceId && item.effectIndex === decision.effectIndex);
  if (!candidate) return { investigator, effects, outcome: 'invalid', reason: 'candidate_not_available' };
  if (alreadyTriggeredCardIds.includes(candidate.cardInstanceId)) return { investigator, effects, outcome: 'invalid', reason: 'already_triggered' };
  const inZone = candidate.zone === 'hand'
    ? investigator.hand.includes(candidate.cardInstanceId)
    : candidate.zone === 'extra'
      ? (investigator.extraDeck ?? []).includes(candidate.cardInstanceId)
      : investigator.assetsInPlay.includes(candidate.cardInstanceId);
  if (!inZone) return { investigator, effects, outcome: 'invalid', reason: 'card_moved' };
  if (investigator.resources < candidate.resourceCost) return { investigator, effects, outcome: 'invalid', reason: 'insufficient_resources' };

  let next = { ...investigator, resources: investigator.resources - candidate.resourceCost };
  if (candidate.useCost > 0) {
    const state = next.assetState?.[candidate.cardInstanceId];
    if (candidate.zone !== 'asset' || !state) {
      return { investigator, effects, outcome: 'invalid', reason: 'insufficient_uses' };
    }
    const usesLeft = state.usesLeft;
    if (usesLeft == null || usesLeft < candidate.useCost) return { investigator, effects, outcome: 'invalid', reason: 'insufficient_uses' };
    const assetState = state;
    next = {
      ...next,
      assetState: {
        ...(next.assetState ?? {}),
        [candidate.cardInstanceId]: { ...assetState, usesLeft: usesLeft - candidate.useCost, exhausted: candidate.exhaustSelf || assetState.exhausted },
      },
    };
  } else if (candidate.zone === 'asset' && candidate.exhaustSelf) {
    const state = next.assetState?.[candidate.cardInstanceId] ?? { usesLeft: null, exhausted: false };
    next = { ...next, assetState: { ...(next.assetState ?? {}), [candidate.cardInstanceId]: { ...state, exhausted: true } } };
  }

  next = removePlayedCard(next, candidate);
  const prevented = Math.min(nonNegative(pending.operation.amount), candidate.preventAmount);
  const operation = { ...pending.operation, amount: Math.max(0, nonNegative(pending.operation.amount) - prevented) };
  effects.push({
    type: 'reaction_played',
    params: { reactionId: pending.id, cardInstanceId: candidate.cardInstanceId, name: candidate.name, trigger: pending.trigger, resourceCost: candidate.resourceCost, useCost: candidate.useCost },
    targetId: next.investigatorId,
  });
  effects.push({ type: 'reaction_prevented', params: { amount: prevented, kind: pending.operation.kind }, targetId: next.investigatorId });
  next = settleReactionOperation(next, operation, effects);
  return { investigator: next, effects, outcome: 'played', triggeredCardInstanceId: candidate.cardInstanceId };
}
