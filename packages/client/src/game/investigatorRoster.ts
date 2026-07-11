import type { PlayInvestigator } from '../api';

/** 玩家與 AI 組隊只使用正式 64 格 preset；舊 G1 範例模板不得混入。 */
export function playablePresetInvestigators(
  candidates: readonly PlayInvestigator[],
): PlayInvestigator[] {
  return candidates.filter((candidate) => candidate.is_preset !== false);
}
