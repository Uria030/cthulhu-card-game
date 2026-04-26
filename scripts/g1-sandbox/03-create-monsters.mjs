import { adminFetch, adminGet } from './api.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `g1-monsters-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# G1 怪物建立 ${stamp}`);
log('');

// ── 0. 取得 family / species id
const fams = await adminGet('/api/admin/monsters/families');
const farr = fams.families || fams.data || fams;
const fallen = farr.find(f => f.code === 'fallen');
const sp = await adminGet('/api/admin/monsters/species');
const sarr = sp.species || sp.data || sp;
const deepOne = sarr.find(s => s.code === 'deep_one');
log(`fallen family id: ${fallen.id}`);
log(`deep_one species id: ${deepOne.id} (tier ${deepOne.tier_min}-${deepOne.tier_max})`);

const created = { species: [], variants: [], attackCards: [] };

async function post(url, body, label) {
  const r = await adminFetch(url, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) {
    log(`✗ ${label} 失敗 ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`);
    return null;
  }
  const data = r.body.data || r.body.species || r.body;
  log(`✓ ${label} id=${data.id}`);
  return data;
}

// 補齊 NOT NULL 預設值(routes 用 || null 但 schema 要 NOT NULL,workaround)
const VARIANT_NOT_NULL_DEFAULTS = {
  movement_speed: 3,
  movement_type: 'ground',         // CHECK enum: ground/flying/dimensional/burrowing
  fear_type: 'first_sight',        // CHECK enum: first_sight/per_round/on_reveal
  keywords: [],
  resistance_values: {},
  phase_count: 1,
  phase_rules: [],
  legendary_actions: [],
  environment_effects: [],
};
const ATTACK_NOT_NULL_DEFAULTS = {
  damage_element: 'physical',
  inflicts_status: [],
  special_effect: {},
  use_condition: {},
};
function fillVariant(b) { return { ...VARIANT_NOT_NULL_DEFAULTS, ...b }; }
function fillAttack(b) { return { ...ATTACK_NOT_NULL_DEFAULTS, ...b }; }

// ── 1. 建新 species「街頭暴徒」
log('\n── 建 species: 街頭暴徒 ──');
const thugSpecies = await post('/api/admin/monsters/species', {
  family_id: fallen.id,
  code: 'g1_street_thug',
  name_zh: '街頭暴徒',
  name_en: 'Street Thug',
  description_zh: '對深潛者的存在一無所知,只想搶你錢包的尋常街頭混混。',
  description_en: 'An ordinary alley brute who knows nothing of Deep Ones — just wants your wallet.',
  lore_zh: '凡人墮落者中最不起眼的一群:沒有信仰、沒有目的,只有拳頭與酒氣。但在 1920 年的暗巷,連一拳也可能要你的命。',
  base_attack_element: 'physical',
  base_ai_preference: 'aggressive',
  base_keywords: ['humanoid', 'mortal'],
  tier_min: 1,
  tier_max: 2,
  design_notes: 'G1 沙盒測試敵人。Part 2 §2.3 通用測試敵人,用於驗證低威脅戰鬥流程。',
  design_status: 'draft',
}, '建 street_thug species');
if (thugSpecies) created.species.push(thugSpecies);

// ── 2. 建變體深潛者裂嘴女
log('\n── 建 variant: 深潛者裂嘴女 (tier 3) ──');
const slitMouth = await post('/api/admin/monsters/variants', fillVariant({
  species_id: deepOne.id,
  code: 'G1_deep_one_slit_mouth',
  name_zh: '深潛者裂嘴女',
  name_en: 'Deep One Slit-Mouth',
  tier: 3, // 菁英,deep_one species tier_max=3
  fear_radius: 2,
  fear_value: 3,
  fear_type: 'first_sight',
  attack_element: 'physical',
  keywords: ['blindsight', 'aquatic'],
  description_zh: '她披著破舊風衣站在路燈死角,口罩之下是兩側下顎正在劇烈翕張的魚鰓。當她近身,潮汐般的恐懼如冰水傾瀉。',
  description_en: 'She stands in the dead corner of the streetlamp, draped in a tattered coat. Beneath her mask, gill-slits flex on either jaw. At close range, dread breaks over you like cold tide.',
  design_notes: 'G1 主敵。Part 2 §2.1 規格:fear_radius=2(劇本 1-2 取中),fear_value=3 SAN 傷害(劇本 2-4 取中)。物理抗性 medium 由 attack_element 處理。神秘抗性原規格寫「抗」,但規則書 validateNoArcane 禁止 arcane 進 resistances/immunities,改用敘事呈現(deep one 天生神話血脈)。',
  design_status: 'draft',
}), '建 G1_深潛者裂嘴女 variant');
if (slitMouth) created.variants.push(slitMouth);

// ── 3. 裂嘴女 3 張招式
const slitMouthCards = [
  {
    species_id: deepOne.id, variant_id: slitMouth?.id, code: 'G1_atk_slitmouth_tentacle',
    name_zh: '觸手撕扯', name_en: 'Tentacle Tear',
    defense_attribute: 'reflex', dc_override: 12,
    damage_physical: 4, damage_element: 'physical',
    weight: 2,
    narrative_attack_zh: '冰冷的觸鬚從黑暗中纏上你的手腕,像水草卻硬得多。',
    narrative_attack_en: 'A cold tendril snakes from the dark and coils your wrist, like seaweed but harder.',
    narrative_hit_zh: '觸鬚收緊,將你拖向她張開的鰓口。一道濕滑的冰冷拉過你的手臂,那不是任何人類該有的觸感。',
    narrative_hit_en: 'It tightens, dragging you toward her gill-opened mouth. A wet cold scrapes your arm — no human grip ever felt like this.',
    narrative_miss_zh: '觸鬚滑過你的雨衣,你在最後一刻將自己甩向牆邊。',
    narrative_miss_en: 'The tendril slithers off your raincoat — at the last instant you fling yourself toward the wall.',
    sort_order: 1,
  },
  {
    species_id: deepOne.id, variant_id: slitMouth?.id, code: 'G1_atk_slitmouth_claw',
    name_zh: '利爪割裂', name_en: 'Talon Rend',
    defense_attribute: 'reflex', dc_override: 13,
    damage_physical: 3, damage_element: 'physical',
    inflicts_status: [{ code: 'vulnerable', duration: 1 }],
    weight: 2,
    narrative_attack_zh: '她那不該屬於人類的指甲,在路燈反光下閃著腥黏的光。',
    narrative_attack_en: 'Her nails — too long, too curved for a human — gleam with viscous slime under the lamplight.',
    narrative_hit_zh: '爪痕劃過你的胸口,皮肉間滲出血珠,身體的防禦力似乎也被切開了一道口。',
    narrative_hit_en: 'The talons rake across your chest, blood beads up — and something in your body\'s defense feels split open too.',
    narrative_miss_zh: '你險險側身,只感到爪風掠過頸側的寒意。',
    narrative_miss_en: 'You twist aside; only the chill of her swipe brushes your neck.',
    sort_order: 2,
  },
  {
    species_id: deepOne.id, variant_id: slitMouth?.id, code: 'G1_atk_slitmouth_slime',
    name_zh: '黏液噴吐', name_en: 'Brine Spit',
    defense_attribute: 'constitution', dc_override: 12,
    damage_physical: 1, damage_horror: 1, damage_element: 'physical',
    inflicts_status: [{ code: 'wet', duration: 2 }],
    weight: 1,
    narrative_attack_zh: '她張開那不可名狀的鰓口,喉嚨深處發出咕嘟咕嘟的聲響。',
    narrative_attack_en: 'She yawns open the unnameable gill-mouth; deep in her throat something gurgles.',
    narrative_hit_zh: '腥臭的黏液噴濺在你身上,海的味道滲入鼻腔,衣服變得沉重,意識也跟著潮濕了一塊。',
    narrative_hit_en: 'Reeking ooze sprays across you. The sea-stench floods your sinuses; your clothes turn leaden, and a damp patch settles inside your mind.',
    narrative_miss_zh: '黏液噴在腳邊的磚地上,發出嘶嘶的腐蝕聲。',
    narrative_miss_en: 'The slime hits the brick at your feet, hissing as it eats into the stone.',
    sort_order: 3,
  },
];
for (const c of slitMouthCards) {
  const r = await post('/api/admin/monsters/attack-cards', fillAttack(c), `招式: ${c.name_zh}`);
  if (r) created.attackCards.push(r);
}

// ── 4. 建變體深潛者亡靈
log('\n── 建 variant: 深潛者亡靈 (tier 1) ──');
const ghoul = await post('/api/admin/monsters/variants', fillVariant({
  species_id: deepOne.id,
  code: 'G1_deep_one_revenant',
  name_zh: '深潛者亡靈',
  name_en: 'Deep One Revenant',
  tier: 1,
  fear_radius: 1,
  fear_value: 1,
  fear_type: 'first_sight',
  attack_element: 'physical',
  keywords: ['blindsight', 'undead'],
  description_zh: '一具被海水浸透的深潛者屍體,鱗片大半剝落。它的動作緩慢,但仍記得如何撕咬。',
  description_en: 'A Deep One corpse, sea-soaked, scales half flaked away. Slow now — but still remembers how to tear.',
  design_notes: 'G1 中段測試敵人。Part 2 §2.3.2 規格:tier 1、fear 1/1。配置在地點 B 濕滑磚牆,讓玩家在調查時被打斷,體驗「調查中遇襲」的緊張節奏。死亡時應掉落線索物件「深潛者鱗片」(實作層在 stage/loot 處理)。',
  design_status: 'draft',
}), '建 G1_深潛者亡靈 variant');
if (ghoul) created.variants.push(ghoul);

const ghoulCards = [
  {
    species_id: deepOne.id, variant_id: ghoul?.id, code: 'G1_atk_ghoul_lunge',
    name_zh: '緩慢撲擊', name_en: 'Slow Lunge',
    defense_attribute: 'reflex', dc_override: 11,
    damage_physical: 1, damage_element: 'physical',
    weight: 2,
    narrative_attack_zh: '它拖著腐爛的腳步朝你撲來,動作緩慢卻帶著無法阻擋的重量。',
    narrative_attack_en: 'It drags its rotting legs into a lunge — slow, but with the unstoppable weight of a thing past pain.',
    narrative_hit_zh: '它的指甲刮過你的手臂,留下一道帶著海水鹹味的傷口。',
    narrative_hit_en: 'Its nails rake your arm, leaving a wound that already smells of brine.',
    narrative_miss_zh: '你輕鬆閃過,它撞在牆上發出濕悶的聲響。',
    narrative_miss_en: 'You sidestep; it slams into the wall with a wet, hollow thud.',
    sort_order: 1,
  },
  {
    species_id: deepOne.id, variant_id: ghoul?.id, code: 'G1_atk_ghoul_growl',
    name_zh: '低吼', name_en: 'Sea-Throat Growl',
    defense_attribute: 'willpower', dc_override: 10,
    damage_horror: 1, damage_element: 'physical',
    weight: 1,
    narrative_attack_zh: '它從喉嚨深處發出一陣彷彿從海溝傳來的低吼,空氣震動著鹹濕的味道。',
    narrative_attack_en: 'A low growl rumbles up from its throat as if rising from the ocean trench, the air vibrating with brine.',
    narrative_hit_zh: '那聲音擠進你的腦袋,有那麼一瞬間你以為自己也聽見了海。',
    narrative_hit_en: 'The sound presses into your skull — for a moment you think you hear the sea calling, too.',
    narrative_miss_zh: '你咬緊牙關擋住那聲音,只剩下耳後一絲冰涼的不適。',
    narrative_miss_en: 'You set your teeth against it; only a cold tingle behind your ear remains.',
    sort_order: 2,
  },
];
for (const c of ghoulCards) {
  const r = await post('/api/admin/monsters/attack-cards', fillAttack(c), `招式: ${c.name_zh}`);
  if (r) created.attackCards.push(r);
}

// ── 5. 街頭流氓
log('\n── 建 variant: 街頭流氓 (tier 1) ──');
let thug = null;
if (thugSpecies) {
  thug = await post('/api/admin/monsters/variants', fillVariant({
    species_id: thugSpecies.id,
    code: 'G1_street_thug_basic',
    name_zh: '街頭流氓',
    name_en: 'Street Thug',
    tier: 1,
    fear_radius: 0,
    fear_value: 0,
    attack_element: 'physical',
    description_zh: '一個只想搶你錢包的街頭混混,喝了酒、握緊拳頭、不知道暗巷裡還有別的東西。',
    description_en: 'A neighborhood brute who only wants your wallet — drunk, fists clenched, oblivious to what else hunts the alley.',
    design_notes: 'G1 熱身敵人。Part 2 §2.3.1 規格:tier 1、無恐懼威脅,讓玩家進場熱身一場低風險戰鬥再向磚牆推進。',
    design_status: 'draft',
  }), '建 G1_街頭流氓 variant');
  if (thug) created.variants.push(thug);
}

if (thug) {
  await post('/api/admin/monsters/attack-cards', fillAttack({
    species_id: thugSpecies.id, variant_id: thug.id, code: 'G1_atk_thug_punch',
    name_zh: '粗暴拳擊', name_en: 'Brutish Punch',
    defense_attribute: 'reflex', dc_override: 10,
    damage_physical: 1, damage_element: 'physical',
    weight: 1,
    narrative_attack_zh: '他罵了一句髒話,握緊拳頭朝你揮來。',
    narrative_attack_en: 'He spits a curse and swings a fist at your jaw.',
    narrative_hit_zh: '拳頭砸上你的肋骨,你的呼吸亂了半拍。',
    narrative_hit_en: 'The fist lands on your ribs — your breath skips a beat.',
    narrative_miss_zh: '他重心不穩,拳頭從你耳邊掠過,自己反而跌了個踉蹌。',
    narrative_miss_en: 'He overshoots; the punch whiffs past your ear, and he stumbles forward.',
    sort_order: 1,
  }), '招式: 粗暴拳擊').then(r => r && created.attackCards.push(r));
}

log('\n=== 結果摘要 ===');
log(`新建 species ${created.species.length}: ${created.species.map(s => s.name_zh).join(', ')}`);
log(`新建 variant ${created.variants.length}: ${created.variants.map(v => v.name_zh).join(', ')}`);
log(`新建 attack-card ${created.attackCards.length}: ${created.attackCards.map(a => a.name_zh).join(', ')}`);

fs.writeFileSync(logPath, lines.join('\n'));
log(`\nlog: ${logPath}`);
