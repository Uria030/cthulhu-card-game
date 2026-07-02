import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function readTeams(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(raw)) return raw.map((ids, teamIndex) => ({ teamIndex, investigatorIds: ids }));
  if (Array.isArray(raw?.teams)) return raw.teams;
  throw new Error(`${file} 不含 teams`);
}

const teamsPath = argValue('--teams', path.join(import.meta.dirname, 'teams.json'));
const outPath = argValue('--out', path.join(import.meta.dirname, 'results.jsonl'));
const cacheDir = argValue('--cache-dir', path.join(import.meta.dirname, '.cache', 'bootstrap'));
const stage = argValue('--stage', null);
const seeds = String(argValue('--seeds', '2026070201,2026070202,2026070203')).split(',').map((s) => s.trim()).filter(Boolean);
const limit = argValue('--limit', null);
const dryRun = hasArg('--dry-run');
const resume = !hasArg('--no-resume');

const teams = readTeams(teamsPath).slice(0, limit ? Number(limit) : undefined);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });

const completed = new Set();
if (resume && fs.existsSync(outPath)) {
  for (const line of fs.readFileSync(outPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      completed.add(`${row.teamIndex}:${row.seed}`);
    } catch {
      // 破行不視為完成,讓後續重跑補上。
    }
  }
}

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const localTsxCli = path.join(
  repoRoot,
  'packages',
  'server',
  'node_modules',
  'tsx',
  'dist',
  'cli.mjs',
);
const useLocalTsx = fs.existsSync(localTsxCli);
const command = useLocalTsx ? process.execPath : process.platform === 'win32' ? 'npx.cmd' : 'npx';
const script = path.join('scripts', 'g1-sandbox', 'sim-slit-3ai.ts');
let planned = 0;
let written = 0;

for (const team of teams) {
  for (const seed of seeds) {
    const key = `${team.teamIndex}:${seed}`;
    if (completed.has(key)) continue;
    planned += 1;
    const args = [
      ...(useLocalTsx ? [localTsxCli] : ['tsx']),
      script,
      '--team',
      team.investigatorIds.join(','),
      '--seed',
      seed,
      '--cache-dir',
      cacheDir,
      '--json',
    ];
    if (stage) args.push('--stage', stage);
    console.log(`[${key}] ${command} ${args.join(' ')}`);
    if (dryRun) continue;
    const run = spawnSync(command, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      env: {
        ...process.env,
        NODE_PATH: [
          path.join(repoRoot, 'packages', 'server', 'node_modules'),
          process.env.NODE_PATH ?? '',
        ].filter(Boolean).join(path.delimiter),
      },
    });
    if (run.status !== 0) {
      fs.appendFileSync(
        `${outPath}.err.log`,
        `\n[${key}] exit=${run.status} error=${run.error ? String(run.error.stack ?? run.error.message) : ''}\n${run.stdout}\n${run.stderr}\n`,
      );
      throw new Error(`sim failed for ${key}; see ${outPath}.err.log`);
    }
    const resultLine = run.stdout.split(/\r?\n/).findLast((line) => line.startsWith('SIM_RESULT_JSON '));
    if (!resultLine) {
      fs.appendFileSync(`${outPath}.err.log`, `\n[${key}] missing SIM_RESULT_JSON\n${run.stdout}\n${run.stderr}\n`);
      throw new Error(`sim did not emit JSON for ${key}; see ${outPath}.err.log`);
    }
    const row = JSON.parse(resultLine.slice('SIM_RESULT_JSON '.length));
    row.teamIndex = team.teamIndex;
    row.teamIds = team.investigatorIds;
    fs.appendFileSync(outPath, `${JSON.stringify(row)}\n`);
    written += 1;
  }
}

console.log(dryRun ? `dry-run planned ${planned} games` : `wrote ${written} games -> ${outPath}`);
