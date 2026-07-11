import { playablePresetInvestigators } from './investigatorRoster';
import type { PlayInvestigator } from '../api';

const base = {
  id: '', code: '', mbti_code: 'ISTP', faction_code: 'S', name_zh: '', name_en: '',
  title_zh: '私家偵探', backstory: null, ability_text_zh: null, portrait_url: null,
  is_completed: true, attr_strength: 1, attr_agility: 1, attr_constitution: 1,
  attr_reflex: 1, attr_intellect: 1, attr_willpower: 1, attr_perception: 1, attr_charisma: 1,
} satisfies PlayInvestigator;

const rows: PlayInvestigator[] = [
  { ...base, id: 'preset', code: 'ISTP-1', is_preset: true },
  { ...base, id: 'legacy', code: 'G1_iron_witness_detective', name_zh: '無名鐵證偵探', is_preset: false },
];

const result = playablePresetInvestigators(rows);
if (result.length !== 1 || result[0].code !== 'ISTP-1') {
  throw new Error('舊 G1 非 preset 調查員仍混入 64 位名冊');
}
console.log('1 passed, 0 failed');
