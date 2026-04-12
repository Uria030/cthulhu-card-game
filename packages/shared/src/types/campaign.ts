export interface Campaign {
  id: string;
  name: string;
  description: string;
  currentScenario: number;
  playerIds: string[];
}
