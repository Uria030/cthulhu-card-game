import fs from 'node:fs';
import path from 'node:path';

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
}

function lcg(seed) {
  let state = Number(seed) || 20260702;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function readInvestigators(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`${file} 必須是 array`);
  return raw.map((x) => (typeof x === 'string' ? { id: x } : x)).filter((x) => x?.id);
}

const input = argValue('--input', path.join(import.meta.dirname, 'preset-investigators.json'));
const outPath = argValue('--out', path.join(import.meta.dirname, 'teams.json'));
const seed = Number(argValue('--seed', '20260702'));
const investigators = readInvestigators(input);
const minAppearances = Number(argValue('--min-appearances', investigators.length >= 64 ? '8' : '12'));
const teamCount = Number(argValue('--teams', String(Math.ceil((investigators.length * minAppearances) / 4))));
const rng = lcg(seed);

if (investigators.length < 4) throw new Error('至少需要 4 位調查員才能產隊伍表');

const counts = new Map(investigators.map((x) => [String(x.id), 0]));
const teams = [];
for (let teamIndex = 0; teamIndex < teamCount; teamIndex += 1) {
  const ranked = investigators
    .map((x) => ({ x, count: counts.get(String(x.id)) ?? 0, jitter: rng() }))
    .sort((a, b) => a.count - b.count || a.jitter - b.jitter);
  const picked = ranked.slice(0, 4).map(({ x }) => String(x.id));
  for (const id of picked) counts.set(id, (counts.get(id) ?? 0) + 1);
  teams.push({ teamIndex, investigatorIds: picked });
}

const payload = {
  schema: 'ug-cross-test-teams-v1',
  generatedAt: new Date().toISOString(),
  source: path.relative(process.cwd(), input),
  seed,
  minAppearances,
  teamCount,
  investigatorCount: investigators.length,
  teams,
  appearanceCounts: Object.fromEntries([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
const values = [...counts.values()];
console.log(`wrote ${teams.length} teams -> ${outPath}`);
console.log(`appearances min=${Math.min(...values)} max=${Math.max(...values)} target>=${minAppearances}`);
