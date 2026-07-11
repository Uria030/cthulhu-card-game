import { fetchPlayInvestigators, fetchPlayStages } from '../api';
import { BOOT_ASSETS, DEFERRED_GAME_ASSETS } from './preloadPlan';
import type { PreloadSource } from './preloadPlan';
export { bootPreloadPlan } from './preloadPlan';
export type { PreloadSource } from './preloadPlan';

export interface PreloadProgress {
  completed: number;
  total: number;
  percent: number;
  label: string;
  source: PreloadSource;
  failures: string[];
}

interface PreloadTask {
  id: string;
  label: string;
  source: PreloadSource;
  run: () => Promise<unknown>;
}

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`asset failed: ${url}`));
    image.src = url;
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('preload timeout')), timeoutMs);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error: unknown) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

export async function runBootPreload(
  onProgress: (progress: PreloadProgress) => void,
): Promise<{ failures: string[] }> {
  const tasks: PreloadTask[] = [
    ...BOOT_ASSETS.map((asset) => ({
      id: asset.id,
      label: asset.label,
      source: 'local' as const,
      run: () => preloadImage(asset.url),
    })),
    { id: 'stages', label: '讀取可用關卡', source: 'server', run: () => fetchPlayStages() },
    { id: 'investigators', label: '讀取調查員名冊', source: 'server', run: () => fetchPlayInvestigators() },
  ];
  const failures: string[] = [];
  let completed = 0;
  onProgress({ completed, total: tasks.length, percent: 0, label: '載入中', source: 'local', failures });
  await Promise.all(tasks.map(async (task) => {
    try {
      await withTimeout(task.run(), 8_000);
    } catch {
      failures.push(task.id);
    } finally {
      completed += 1;
      onProgress({
        completed,
        total: tasks.length,
        percent: Math.round((completed / tasks.length) * 100),
        label: task.label,
        source: task.source,
        failures: [...failures],
      });
    }
  }));
  return { failures };
}

export function scheduleDeferredGamePreload(): void {
  const run = () => {
    for (const url of DEFERRED_GAME_ASSETS) void preloadImage(url).catch(() => {});
  };
  const requestIdle = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof requestIdle === 'function') {
    requestIdle(run, { timeout: 3_000 });
  } else {
    globalThis.setTimeout(run, 500);
  }
}
