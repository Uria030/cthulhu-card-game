export interface LocationActionFeedback {
  key: string;
  targetLocationId?: string;
}

/** Processing feedback must stay on its source location, never reveal unavailable map actions elsewhere. */
export function feedbackTargetsLocation(
  feedback: LocationActionFeedback | null,
  actionKey: string,
  locationId: string,
): boolean {
  if (feedback?.key !== actionKey) return false;
  return actionKey !== 'move' || feedback.targetLocationId === locationId;
}
