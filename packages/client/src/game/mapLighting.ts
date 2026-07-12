import { hasLineOfSight } from '@cthulhu/shared';
import type { LightSourceInstance, ScenarioState } from '@cthulhu/shared';

/** Presentation data for one map tile. Rules stay in shared; this only selects what the map renders. */
export interface LocationLightingPresentation {
  illuminated: boolean;
  sources: LightSourceInstance[];
}

export function lightingForLocation(
  scenario: Pick<ScenarioState, 'locations' | 'lightSources'>,
  locationId: string,
): LocationLightingPresentation {
  return {
    illuminated: hasLineOfSight(scenario, locationId),
    sources: (scenario.lightSources ?? []).filter((source) => source.locationId === locationId),
  };
}
