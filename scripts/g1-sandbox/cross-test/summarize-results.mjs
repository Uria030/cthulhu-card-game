import fs from 'node:fs';
import path from 'node:path';

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
}

function wilson(wins, games, z = 1.96) {
  if (games === 0) return { low: 0, high: 0 };
  const p = wins / games;
  const denom = 1 + (z * z) / games;
  const center = (p + (z * z) / (2 * games)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / games + (z * z) / (4 * games * games))) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

const input = argValue('--input', path.join(import.meta.dirname, 'results.jsonl'));
const outPath = argValue('--out', path.join(import.meta.dirname, 'summary.md'));
const rows = fs.existsSync(input)
  ? fs.readFileSync(input, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  : [];

if (rows.length === 0) throw new Error(`${input} 沒有可彙總資料`);

const totalWins = rows.filter((r) => r.victory).length;
const overall = totalWins / rows.length;
const byInvestigator = new Map();
const byFaction = new Map();
const unsupported = new Map();

for (const row of rows) {
  for (const member of row.members ?? []) {
    const id = String(member.templateId);
    const cur = byInvestigator.get(id) ?? {
      id,
      code: member.templateCode ?? '',
      name: member.name_zh ?? '',
      title: member.title_zh ?? '',
      faction: member.factionCode ?? '',
      games: 0,
      wins: 0,
      clues: 0,
      damage: 0,
      downed: 0,
      aligned: 0,
      judged: 0,
      blueprintKnown: 0,
      blueprintFormed: 0,
    };
    cur.games += 1;
    cur.wins += row.victory ? 1 : 0;
    cur.clues += Number(member.clues ?? 0);
    cur.damage += Number(member.damage ?? 0);
    cur.downed += Number(member.downed ?? 0);
    cur.aligned += Number(member.alignmentNumerator ?? 0);
    cur.judged += Number(member.alignmentDenominator ?? 0);
    if (member.blueprintFormedTurn != null) {
      cur.blueprintKnown += 1;
      cur.blueprintFormed += 1;
    }
    for (const code of member.unsupportedEffects ?? []) unsupported.set(code, (unsupported.get(code) ?? 0) + 1);
    byInvestigator.set(id, cur);

    if (cur.faction) {
      const fac = byFaction.get(cur.faction) ?? { games: 0, wins: 0 };
      fac.games += 1;
      fac.wins += row.victory ? 1 : 0;
      byFaction.set(cur.faction, fac);
    }
  }
}

const investigators = [...byInvestigator.values()].map((x) => {
  const ci = wilson(x.wins, x.games);
  const winRate = x.games ? x.wins / x.games : 0;
  const status = ci.high < overall ? '明顯較弱' : ci.low > overall ? '明顯較強' : '無法區分';
  return { ...x, winRate, ci, status };
}).sort((a, b) => a.winRate - b.winRate || a.code.localeCompare(b.code));

const lines = [];
lines.push('# 調查員交叉測試彙總');
lines.push('');
lines.push(`來源: \`${path.relative(process.cwd(), input)}\``);
lines.push(`場數: ${rows.length}`);
lines.push(`全體勝率: ${pct(overall)} (${totalWins}/${rows.length})`);
lines.push('');
lines.push('## 勝率矩陣');
lines.push('');
lines.push('| code | 稱號 | 勝率 | 95% CI | 判定 | 場均線索 | 場均傷害 | 場均倒地 | 對齊率 |');
lines.push('|---|---|---:|---:|---|---:|---:|---:|---:|');
for (const x of investigators) {
  const align = x.judged ? x.aligned / x.judged : null;
  lines.push(`| ${x.code} | ${x.title || x.name} | ${pct(x.winRate)} (${x.wins}/${x.games}) | ${pct(x.ci.low)}-${pct(x.ci.high)} | ${x.status} | ${(x.clues / x.games).toFixed(2)} | ${(x.damage / x.games).toFixed(2)} | ${(x.downed / x.games).toFixed(2)} | ${align == null ? '-' : pct(align)} |`);
}

lines.push('');
lines.push('## 陣營彙總');
lines.push('');
lines.push('| faction | 勝率 | 樣本席次 |');
lines.push('|---|---:|---:|');
for (const [faction, v] of [...byFaction.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`| ${faction} | ${pct(v.wins / v.games)} | ${v.games} |`);
}

lines.push('');
lines.push('## effect_unsupported');
lines.push('');
if (unsupported.size === 0) {
  lines.push('無。');
} else {
  lines.push('| effect | 次數 |');
  lines.push('|---|---:|');
  for (const [code, count] of [...unsupported.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${code} | ${count} |`);
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log(`wrote summary -> ${outPath}`);
