// Node 端「既有卡 context 抓取」(對應 admin-shared.js fetchExistingCardsForPromptContext)
// 從 admin api 抓符合條件的既有卡,組成 prompt context block
import { adminGet } from '../api.mjs';

export async function fetchExistingCardsContext({ faction, primary_axis_value, is_talisman, series } = {}) {
  const params = new URLSearchParams();
  if (faction) params.set('faction', faction);
  if (primary_axis_value) {
    params.set('primary_axis_layer', 'card_name');
    params.set('primary_axis_value', primary_axis_value);
  }
  if (is_talisman) params.set('is_talisman', 'true');
  if (series) params.set('series', series);
  if (!params.toString()) return '';

  let payload;
  try {
    payload = await adminGet('/api/cards?' + params.toString());
  } catch (e) {
    console.warn('[context fetch] 既有卡查詢失敗:', e.message);
    return '';
  }

  // adminGet 既可能回 array 也可能回 { cards: [], data: [] } 視 endpoint shape
  const arr = Array.isArray(payload) ? payload : (payload?.data || payload?.cards || []);
  if (!arr.length) return '';

  const lines = arr.slice(0, 30).map((c) => {
    const parts = [
      '  - [' + (c.code || '?') + ']',
      c.name_zh || '(無名)',
      '｜faction=' + (c.faction || '?'),
      c.style ? 'style=' + c.style : '',
      c.card_type ? 'type=' + c.card_type : '',
      ((c.starting_xp ?? c.level) != null) ? '★' + (c.starting_xp ?? c.level) : '',
      c.cost != null ? 'cost=' + c.cost : '',
      c.primary_axis_layer && c.primary_axis_layer !== 'none'
        ? '軸=' + c.primary_axis_layer + '/' + (c.primary_axis_value || '')
        : '',
      c.is_talisman ? '[法器]' : '',
    ].filter(Boolean);
    return parts.join(' ');
  });

  const header = '本次篩選條件:' + params.toString().replace(/&/g, '、') + '｜符合 ' + arr.length + ' 張';
  const footer = arr.length > 30 ? '(只顯示前 30 張;完整共 ' + arr.length + ' 張)' : '';
  return header + '\n' + lines.join('\n') + (footer ? '\n' + footer : '');
}
