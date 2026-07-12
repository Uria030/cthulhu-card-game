import type { ScenarioState } from './state';

/** Returns whether a light source reaches a location through the current topology. */
function sourceReaches(
  scenario: Pick<ScenarioState, 'locations'>,
  sourceLocationId: string,
  radius: number,
  targetLocationId: string,
): boolean {
  if (sourceLocationId === targetLocationId) return true;
  if (radius <= 0) return false;
  const seen = new Set<string>([sourceLocationId]);
  let frontier = [sourceLocationId];
  for (let distance = 0; distance < radius; distance += 1) {
    const next: string[] = [];
    for (const locationId of frontier) {
      const location = scenario.locations.find((item) => item.locationDefinitionId === locationId);
      for (const neighbor of location?.connectedTo ?? []) {
        if (seen.has(neighbor)) continue;
        if (neighbor === targetLocationId) return true;
        seen.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return false;
}

/**
 * Day and fire always provide sight. Night and darkness require a light source
 * whose radius reaches the queried location; light is centred on the object,
 * never on an investigator.
 */
export function hasLineOfSight(
  scenario: Pick<ScenarioState, 'locations' | 'lightSources'>,
  locationId: string | null | undefined,
): boolean {
  if (!locationId) return false;
  const location = scenario.locations.find((item) => item.locationDefinitionId === locationId);
  if (!location) return false;
  if (location.visibility === 'day' || location.visibility === 'fire') return true;
  return (scenario.lightSources ?? []).some((source) => sourceReaches(scenario, source.locationId, source.radius, locationId));
}

/** Exposes the exact covered board locations for map presentation and tests. */
export function illuminatedLocationIds(
  scenario: Pick<ScenarioState, 'locations' | 'lightSources'>,
): string[] {
  return scenario.locations
    .filter((location) => hasLineOfSight(scenario, location.locationDefinitionId))
    .map((location) => location.locationDefinitionId);
}
