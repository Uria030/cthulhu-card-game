import type { LocationInstance } from '@cthulhu/shared';

export interface LocationConnection {
  from: string;
  to: string;
  blocked: boolean;
}

export function uniqueLocationConnections(
  locations: readonly LocationInstance[],
): LocationConnection[] {
  const byId = new Map(locations.map((location) => [location.locationDefinitionId, location]));
  const seen = new Set<string>();
  const result: LocationConnection[] = [];
  for (const location of locations) {
    for (const targetId of location.connectedTo) {
      if (!byId.has(targetId)) continue;
      const pair = [location.locationDefinitionId, targetId].sort();
      const key = pair.join('::');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        from: pair[0],
        to: pair[1],
        blocked: Boolean(byId.get(pair[0])?.isObstacle || byId.get(pair[1])?.isObstacle),
      });
    }
  }
  return result;
}
