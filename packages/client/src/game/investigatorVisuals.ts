export type InvestigatorArchetype =
  | 'archivist'
  | 'healer'
  | 'craftsperson'
  | 'watchman'
  | 'performer'
  | 'mystic';

export interface InvestigatorVisualInput {
  code?: string | null;
  title_zh?: string | null;
}

const ARCHETYPE_ASSETS: Record<InvestigatorArchetype, string> = {
  archivist: '/game-art/pawns/archetypes/archivist.png',
  healer: '/game-art/pawns/archetypes/healer.png',
  craftsperson: '/game-art/pawns/archetypes/craftsperson.png',
  watchman: '/game-art/pawns/archetypes/watchman.png',
  performer: '/game-art/pawns/archetypes/performer.png',
  mystic: '/game-art/pawns/archetypes/mystic.png',
};

const CAREER_CODE_PATTERN = /^(?:[EI][NS][FT][JP])-[1-4]$/i;

const ARCHETYPE_RULES: Array<{ archetype: InvestigatorArchetype; pattern: RegExp }> = [
  { archetype: 'healer', pattern: /醫|護|藥|外科|法醫|療|急救|護士/ },
  { archetype: 'watchman', pattern: /警|巡|軍|守衛|偵探|保鑣|治安|執法/ },
  { archetype: 'craftsperson', pattern: /工|匠|鐵|機械|鍛|司機|水手|建築|修理|勞/ },
  { archetype: 'performer', pattern: /舞|演|歌|劇|魔術|社運|記者|交際|畫家|作家/ },
  { archetype: 'mystic', pattern: /神父|牧師|修士|先知|靈|巫|占|儀式|神祕|教士/ },
];

/**
 * 大廳只呈現六種匿名座位剪影；戰鬥盤則使用完整的 64 職業棋子。
 * 兩者共用這張職業到原型映射，避免換人後兩個畫面傳達互相矛盾的職業語言。
 */
export function archetypeForInvestigator(input: InvestigatorVisualInput): InvestigatorArchetype {
  const title = `${input.title_zh ?? ''} ${input.code ?? ''}`;
  return ARCHETYPE_RULES.find((rule) => rule.pattern.test(title))?.archetype ?? 'archivist';
}

function careerCodeFor(input: InvestigatorVisualInput): string | null {
  const code = input.code?.trim().toLowerCase() ?? '';
  return CAREER_CODE_PATTERN.test(code) ? code : null;
}

export function pawnAssetForInvestigator(input: InvestigatorVisualInput, playerSlot = 0): string {
  const code = careerCodeFor(input);
  if (code) {
    const color = Math.min(4, Math.max(1, playerSlot + 1));
    return `/game-art/pawns/v2/${code}-p${color}.webp`;
  }
  return ARCHETYPE_ASSETS[archetypeForInvestigator(input)];
}

export function lobbySeatAssetForInvestigator(input: InvestigatorVisualInput, seat: number): string {
  const safeSeat = Math.min(4, Math.max(1, Math.trunc(seat)));
  return `/game-art/lobby-v4/seat-${safeSeat}-${archetypeForInvestigator(input)}.webp`;
}

export function playerToneForSlot(slot: number): string {
  return [
    'var(--player-1-russet)',
    'var(--player-2-indigo)',
    'var(--player-3-moss)',
    'var(--player-4-saffron)',
  ][slot] ?? 'var(--player-1-russet)';
}
