export type EncounterModalBeat = 1 | 2 | 3;
export type EncounterAutoTransition = 'advance' | 'complete' | null;

export const ENCOUNTER_AUTO_DELAY_MS: Readonly<Record<1 | 3, number>> = {
  1: 1_150,
  3: 1_450,
};

/** The choice beat remains player-driven; narration and result beats are paced automatically. */
export function autoEncounterTransition(beat: EncounterModalBeat): EncounterAutoTransition {
  if (beat === 1) return 'advance';
  if (beat === 3) return 'complete';
  return null;
}

export function encounterAutoDelay(beat: EncounterModalBeat): number | null {
  return beat === 2 ? null : ENCOUNTER_AUTO_DELAY_MS[beat];
}
