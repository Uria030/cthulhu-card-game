import type { AttributeKey } from './checks';

export interface AutoPartyCandidate {
  id: string;
  code?: string | null;
  mbti_code?: string | null;
  faction_code?: string | null;
  dominant_letter?: string | null;
  title_zh?: string | null;
  name_zh?: string | null;
  attr_perception?: number | null;
  perception?: number | null;
  attributes?: Partial<Record<AttributeKey, number>> | null;
  proficiency_ids?: readonly string[] | null;
  proficiency_codes?: readonly string[] | null;
  specializations?: readonly string[] | null;
  combatStyle?: string | null;
  combat_style?: string | null;
  deck_effect_codes?: readonly string[] | null;
  card_effect_codes?: readonly string[] | null;
  starting_deck_effect_codes?: readonly string[] | null;
}

export interface AutoComposePartyResult<T extends AutoPartyCandidate> {
  player: T;
  members: T[];
  seed: number;
  relaxed: boolean;
  reasons: string[];
}

interface ScoredCombo<T extends AutoPartyCandidate> {
  members: T[];
  score: number;
  diversityOk: boolean;
  roleOk: boolean;
  hasHarvester: boolean;
  hasOutput: boolean;
}

const OUTPUT_PROFICIENCIES = new Set(['shooting', 'military', 'brawl', 'assassin']);
const DAMAGE_HINTS = ['attack', 'damage', 'deal_damage', 'direct_damage', 'weapon'];

function stableId(c: AutoPartyCandidate): string {
  return String(c.id || c.code || c.mbti_code || c.title_zh || c.name_zh || '');
}

function positiveMod(n: number, mod: number): number {
  if (mod <= 0) return 0;
  return ((n % mod) + mod) % mod;
}

function factionOf(c: AutoPartyCandidate): string {
  const raw = String(c.dominant_letter ?? c.faction_code ?? '').trim().toUpperCase();
  return raw ? raw[0] : '';
}

function perceptionOf(c: AutoPartyCandidate): number {
  return Number(c.attr_perception ?? c.perception ?? c.attributes?.perception ?? 0);
}

function stringTokens(c: AutoPartyCandidate): string[] {
  return [
    ...(c.proficiency_ids ?? []),
    ...(c.proficiency_codes ?? []),
    ...(c.specializations ?? []),
    c.combatStyle ?? '',
    c.combat_style ?? '',
  ]
    .map((x) => String(x).toLowerCase())
    .filter(Boolean);
}

export function isAutoPartyHarvester(c: AutoPartyCandidate): boolean {
  return perceptionOf(c) >= 4;
}

export function isAutoPartyOutput(c: AutoPartyCandidate): boolean {
  const tokens = stringTokens(c);
  if (tokens.some((token) => OUTPUT_PROFICIENCIES.has(token))) return true;
  const effectCodes = [
    ...(c.deck_effect_codes ?? []),
    ...(c.card_effect_codes ?? []),
    ...(c.starting_deck_effect_codes ?? []),
  ].map((x) => String(x).toLowerCase());
  return effectCodes.some((code) => DAMAGE_HINTS.some((hint) => code.includes(hint)));
}

function scoreCombo<T extends AutoPartyCandidate>(
  members: T[],
  playerFaction: string,
): ScoredCombo<T> {
  const factions = members.map(factionOf).filter(Boolean);
  const distinctFactionCount = new Set(factions).size;
  const allAiDistinct = distinctFactionCount === members.length;
  const allDifferentFromPlayer = playerFaction
    ? members.every((m) => factionOf(m) !== playerFaction)
    : true;
  const hasHarvester = members.some(isAutoPartyHarvester);
  const hasOutput = members.some(isAutoPartyOutput);
  const diversityOk = members.length === 3 && allAiDistinct && allDifferentFromPlayer;
  const roleOk = hasHarvester && hasOutput;
  const score =
    (diversityOk ? 400 : 0)
    + (roleOk ? 300 : 0)
    + distinctFactionCount * 20
    + members.filter((m) => !playerFaction || factionOf(m) !== playerFaction).length * 8
    + (hasHarvester ? 20 : 0)
    + (hasOutput ? 20 : 0);
  return { members, score, diversityOk, roleOk, hasHarvester, hasOutput };
}

function allCombos<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [[]];
  if (items.length < size) return [];
  const out: T[][] = [];
  const pick = (start: number, current: T[]) => {
    if (current.length === size) {
      out.push([...current]);
      return;
    }
    for (let i = start; i <= items.length - (size - current.length); i += 1) {
      current.push(items[i]);
      pick(i + 1, current);
      current.pop();
    }
  };
  pick(0, []);
  return out;
}

function chooseBest<T extends AutoPartyCandidate>(scored: ScoredCombo<T>[], seed: number): ScoredCombo<T> {
  const hard = scored.filter((s) => s.diversityOk && s.roleOk);
  const roleFirst = hard.length > 0 ? hard : scored.filter((s) => s.roleOk);
  const pool = roleFirst.length > 0
    ? roleFirst
    : (scored.filter((s) => s.diversityOk).length > 0 ? scored.filter((s) => s.diversityOk) : scored);
  const maxScore = Math.max(...pool.map((s) => s.score));
  const tied = pool
    .filter((s) => s.score === maxScore)
    .sort((a, b) => a.members.map(stableId).join('|').localeCompare(b.members.map(stableId).join('|')));
  return tied[positiveMod(seed, tied.length)];
}

export function autoComposeParty<T extends AutoPartyCandidate>(
  player: T,
  candidates: readonly T[],
  seed = 0,
): AutoComposePartyResult<T> {
  const pool = candidates
    .filter((c) => stableId(c) !== stableId(player))
    .filter((c, idx, arr) => arr.findIndex((other) => stableId(other) === stableId(c)) === idx)
    .sort((a, b) => stableId(a).localeCompare(stableId(b)));

  if (pool.length <= 3) {
    const members = pool.slice(0, 3);
    return {
      player,
      members,
      seed,
      relaxed: members.length < 3 || !scoreCombo(members, factionOf(player)).diversityOk,
      reasons: members.length < 3 ? ['not_enough_candidates'] : ['diversity_relaxed'],
    };
  }

  const playerFaction = factionOf(player);
  const scored = allCombos(pool, 3).map((combo) => scoreCombo(combo, playerFaction));
  const picked = chooseBest(scored, seed);
  const reasons: string[] = [];
  if (!picked.diversityOk) reasons.push('diversity_relaxed');
  if (!picked.hasHarvester) reasons.push('missing_harvester');
  if (!picked.hasOutput) reasons.push('missing_output');
  return {
    player,
    members: picked.members,
    seed,
    relaxed: reasons.length > 0,
    reasons,
  };
}
