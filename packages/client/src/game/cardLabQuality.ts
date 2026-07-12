import type { CardLabCard, CardLabReviewStatus } from '../api';

export type CardLabQualityFilter = 'all' | 'unreviewed' | CardLabReviewStatus;

export interface CardLabFilters {
  search: string;
  faction: string;
  cardType: string;
  quality: CardLabQualityFilter;
}

export function filterCardLabCards(cards: CardLabCard[], filters: CardLabFilters): CardLabCard[] {
  const needle = filters.search.trim().toLocaleLowerCase('zh-Hant');
  return cards.filter((card) => {
    if (filters.faction !== 'all' && card.faction !== filters.faction) return false;
    if (filters.cardType !== 'all' && card.card_type !== filters.cardType) return false;
    if (filters.quality === 'unreviewed' && card.review_status) return false;
    if (filters.quality !== 'all' && filters.quality !== 'unreviewed' && card.review_status !== filters.quality) return false;
    if (!needle) return true;
    return [
      card.name_zh,
      card.name_en,
      card.code,
      card.description_zh,
      card.flavor_text,
      ...card.effects.flatMap((effect) => [effect.description_zh, effect.effect_code]),
    ]
      .some((value) => String(value ?? '').toLocaleLowerCase('zh-Hant').includes(needle));
  });
}

export function formatCardLabIssues(cards: CardLabCard[]): string {
  const issues = cards.filter((card) => card.review_status === 'warn' || card.review_status === 'block');
  if (issues.length === 0) return '';
  return [
    '# 卡片良率檢驗紀錄',
    '',
    ...issues.flatMap((card) => [
      `## [${card.review_status?.toUpperCase()}] ${card.name_zh || card.code} (${card.code})`,
      card.review_notes?.trim() || '(未填寫紀錄)',
      '',
    ]),
  ].join('\n').trim();
}
