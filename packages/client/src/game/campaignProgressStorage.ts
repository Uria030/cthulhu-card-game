import {
  initCampaignProgress,
  registerInvestigator,
} from '@cthulhu/shared';
import type {
  CampaignProgress,
  StageBootstrap,
} from '@cthulhu/shared';
import type { GameSetup } from './gameSetup';

export function campaignProgressStorageKeyFor(
  campaignId: string | null | undefined,
  investigatorId: string | null | undefined,
): string | null {
  return campaignId && investigatorId ? `ug_campaign_progress:${campaignId}:${investigatorId}` : null;
}

export function campaignProgressStorageKeyFromBootstrap(bootstrap: StageBootstrap | null | undefined): string | null {
  return campaignProgressStorageKeyFor(
    bootstrap?.campaign?.id ?? bootstrap?.stage?.id,
    bootstrap?.investigator?.id,
  );
}

export function loadStoredCampaignProgressFor(
  campaignId: string | null | undefined,
  investigatorId: string | null | undefined,
): CampaignProgress | null {
  const key = campaignProgressStorageKeyFor(campaignId, investigatorId);
  if (!key) return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as CampaignProgress : null;
  } catch {
    return null;
  }
}

export function saveStoredCampaignProgressFor(
  campaignId: string | null | undefined,
  investigatorId: string | null | undefined,
  progress: CampaignProgress,
): void {
  const key = campaignProgressStorageKeyFor(campaignId, investigatorId);
  if (!key) return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(progress));
  } catch {
    // sessionStorage may be blocked; playable flow still works in memory.
  }
}

export function loadStoredCampaignProgressFromBootstrap(bootstrap: StageBootstrap): CampaignProgress | null {
  return loadStoredCampaignProgressFor(
    bootstrap.campaign?.id ?? bootstrap.stage?.id,
    bootstrap.investigator?.id,
  );
}

export function saveStoredCampaignProgressFromBootstrap(
  bootstrap: StageBootstrap | null,
  progress: CampaignProgress,
): void {
  saveStoredCampaignProgressFor(
    bootstrap?.campaign?.id ?? bootstrap?.stage?.id,
    bootstrap?.investigator?.id,
    progress,
  );
}

export function deckDefinitionIdsFromBootstrap(bootstrap: StageBootstrap | null): string[] {
  const ids: string[] = [];
  for (const entry of bootstrap?.investigator?.starting_deck ?? []) {
    if (!entry.card_definition_id) continue;
    for (let i = 0; i < (entry.quantity ?? 1); i += 1) ids.push(String(entry.card_definition_id));
  }
  return ids;
}

export function ensureCampaignProgressForSetup(setup: GameSetup): CampaignProgress {
  const inv = setup.bootstrap?.investigator;
  const base = setup.campaignProgress ?? initCampaignProgress(setup.bootstrap?.campaign?.id ?? setup.stageId);
  if (!inv) return base;
  return registerInvestigator(base, {
    investigatorDefinitionId: inv.id,
    deck: deckDefinitionIdsFromBootstrap(setup.bootstrap),
    combatStyle: setup.investigator.combatStyle,
    specializations: setup.investigator.specializations,
    hpMax: setup.investigator.hpMax,
    sanMax: setup.investigator.sanMax,
  });
}
