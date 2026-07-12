import type { CardLabCard } from '../api';
import { filterCardLabCards, formatCardLabIssues } from './cardLabQuality';

function assertEq(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected=${String(expected)}, actual=${String(actual)}`);
}

const cards = [
  { id: '1', code: 'C-E-01', name_zh: '號令', name_en: 'Order', faction: 'E', card_type: 'event', cost: 1, description_zh: '抽牌', effects: [], review_status: 'pass', review_notes: '', reviewed_at: '', reviewed_by_username: 'creator01' },
  { id: '2', code: 'C-I-01', name_zh: '暗巷調查', name_en: 'Alley', faction: 'I', card_type: 'skill', cost: 0, description_zh: '獲得線索', effects: [], review_status: 'warn', review_notes: '實際沒有獲得線索', reviewed_at: '', reviewed_by_username: 'creator02' },
  { id: '3', code: 'C-S-01', name_zh: '鐵證', name_en: 'Proof', faction: 'S', card_type: 'asset', cost: 2, description_zh: '武器', effects: [], review_status: null, review_notes: null, reviewed_at: null, reviewed_by_username: null },
] as CardLabCard[];

assertEq(filterCardLabCards(cards, { search: '線索', faction: 'all', cardType: 'all', quality: 'all' }).length, 1, 'searches description');
assertEq(filterCardLabCards(cards, { search: '', faction: 'I', cardType: 'skill', quality: 'warn' })[0]?.id, '2', 'combines filters');
assertEq(filterCardLabCards(cards, { search: '', faction: 'all', cardType: 'all', quality: 'unreviewed' })[0]?.id, '3', 'finds unreviewed');
const report = formatCardLabIssues(cards);
assertEq(report.includes('[WARN] 暗巷調查 (C-I-01)'), true, 'report includes status and card code');
assertEq(report.includes('實際沒有獲得線索'), true, 'report includes notes');
assertEq(report.includes('號令'), false, 'report excludes PASS');

console.log('PASS card lab quality search, filters, and issue report');
