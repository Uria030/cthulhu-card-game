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

const ARCHETYPE_RULES: Array<{ archetype: InvestigatorArchetype; pattern: RegExp }> = [
  { archetype: 'healer', pattern: /醫|護|藥|外科|法醫|療|急救|護士/ },
  { archetype: 'watchman', pattern: /警|巡|軍|守衛|偵探|保鑣|治安|執法/ },
  { archetype: 'craftsperson', pattern: /工|匠|鐵|機械|鍛|司機|水手|建築|修理|勞/ },
  { archetype: 'performer', pattern: /舞|演|歌|劇|魔術|社運|記者|交際|畫家|作家/ },
  { archetype: 'mystic', pattern: /神父|牧師|修士|先知|靈|巫|占|儀式|神祕|教士/ },
];

/**
 * 調查員模板的職業名稱是穩定的 64 格資料；畫面以它映射有限的匿名棋子原型，
 * 避免把臉孔或 MBTI 當作可辨識的角色肖像。
 */
export function archetypeForInvestigator(input: InvestigatorVisualInput): InvestigatorArchetype {
  const title = `${input.title_zh ?? ''} ${input.code ?? ''}`;
  return ARCHETYPE_RULES.find((rule) => rule.pattern.test(title))?.archetype ?? 'archivist';
}

export function pawnAssetForInvestigator(input: InvestigatorVisualInput): string {
  return ARCHETYPE_ASSETS[archetypeForInvestigator(input)];
}

export function playerToneForSlot(slot: number): string {
  return [
    'var(--player-1-russet)',
    'var(--player-2-indigo)',
    'var(--player-3-moss)',
    'var(--player-4-saffron)',
  ][slot] ?? 'var(--player-1-russet)';
}
