export type PreloadSource = 'local' | 'server';

export const BOOT_ASSETS = [
  { id: 'lobby-surface', label: '準備調查室', url: '/surfaces/study-room/bg.webp' },
  { id: 'departure-map', label: '展開世界地圖', url: '/game-art/departure-map.jpg' },
] as const;

export const DEFERRED_GAME_ASSETS = [
  '/game-art/briefing-desk.jpg',
  '/game-art/game-board.jpg',
  '/game-art/investigator-fallback.jpg',
  '/game-art/keeper-agenda.jpg',
  '/game-art/act-investigation.jpg',
  '/game-art/location-library.jpg',
  '/game-art/location-docks.jpg',
  '/game-art/location-downtown.jpg',
  '/game-art/location-lab-entrance.jpg',
  '/game-art/location-card-lab.jpg',
  '/game-art/slit-mouth-boss.jpg',
] as const;

export function bootPreloadPlan(): ReadonlyArray<{
  id: string;
  label: string;
  source: PreloadSource;
}> {
  return [
    ...BOOT_ASSETS.map((asset) => ({ id: asset.id, label: asset.label, source: 'local' as const })),
    { id: 'stages', label: '讀取可用關卡', source: 'server' as const },
    { id: 'investigators', label: '讀取調查員名冊', source: 'server' as const },
  ];
}
