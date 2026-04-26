import { adminFetch, adminGet } from './api.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `g1-mythos-encounter-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# G1 神話 + 遭遇卡建立 ${stamp}`);

const exMyth = await adminGet('/api/admin/keeper/mythos-cards');
const exEnc = await adminGet('/api/admin/keeper/encounter-cards');
const exMythNames = new Set((exMyth.mythos_cards || []).map(c => c.name_zh));
const exEncNames = new Set((exEnc.encounter_cards || []).map(c => c.name_zh));
log(`既有神話 ${exMythNames.size} / 遭遇 ${exEncNames.size}`);

const MYTHOS = [
  {
    code: 'G1_myth_slitmouth_appears', name_zh: '裂嘴女現身', name_en: 'Slit-Mouth Appears',
    description_zh: '場上的深潛者裂嘴女出現對話泡泡，說「我...漂亮嗎?」(對話泡泡 5-7 秒);所有調查員強制進行意志檢定 DC 13，失敗承受 3 點 SAN。',
    description_en: 'The Slit-Mouth Deep One on the board displays a speech bubble: "Am I... pretty?" (5-7 seconds). All investigators must make a Willpower DC 13 test; on failure suffer 3 SAN.',
    activation_timing: 'keeper_phase', card_category: 'general', intensity_tag: 'major',
    flavor_text_zh: '沙啞、彷彿肺部積滿水的聲音從你身後傳來:「我...漂亮嗎?」',
    flavor_text_en: 'A hoarse voice — water in the lungs — comes from behind you: "Am I... pretty?"',
    design_notes: 'G1 §6.1 關鍵卡。三段式時序:(1) 對話泡泡浮現於螢幕邊緣 (2) 怪物揭露 (3) 強制 SAN 檢定。對話泡泡引擎尚未實作,當前資料層先存。',
  },
  {
    code: 'G1_myth_dark_seep', name_zh: '黑暗滲出', name_en: 'Darkness Seeps',
    description_zh: '選擇一個地點，將其光照狀態改為「黑暗」。',
    description_en: 'Choose a location; change its light state to Dark.',
    activation_timing: 'keeper_phase', card_category: 'general', intensity_tag: 'small',
    flavor_text_zh: '黑暗從牆角滲出，吞沒了走廊。',
    flavor_text_en: 'Darkness seeps from the corner, swallowing the hallway.',
  },
  {
    code: 'G1_myth_gaslamp_shot', name_zh: '煤氣燈被擊落', name_en: 'Gaslamp Struck',
    description_zh: '移除「暗巷入口」的煤氣燈光源，觸發失火狀態。',
    description_en: "Remove the gaslamp from Alley Entrance; trigger Fire status.",
    activation_timing: 'keeper_phase', card_category: 'general', intensity_tag: 'small',
    flavor_text_zh: '煤氣燈被某種力量打落，玻璃碎裂，火焰在濕地上燃起一片詭異的藍光。',
    flavor_text_en: 'Something strikes the gaslamp down; the glass shatters and a strange blue flame rises on the wet stones.',
  },
  {
    code: 'G1_myth_brine_smell', name_zh: '海腥味瀰漫', name_en: 'Brine Pervades',
    description_zh: '留場期間所有調查員的感知檢定 -1。',
    description_en: 'While in play, all investigators suffer -1 to Perception tests.',
    activation_timing: 'keeper_phase', card_category: 'general', intensity_tag: 'small',
    flavor_text_zh: '濃烈的海水味壓過了一切，你的鼻子已經分辨不出其他氣息。',
    flavor_text_en: 'A heavy brine smothers every other smell; your nose can no longer pick anything else apart.',
  },
  {
    code: 'G1_myth_tide_heart', name_zh: '潮汐心跳', name_en: 'Tide Pulse',
    description_zh: '留場期間所有調查員每回合損失 1 SAN。',
    description_en: 'While in play, every investigator loses 1 SAN each round.',
    activation_timing: 'keeper_phase', card_category: 'general', intensity_tag: 'major',
    flavor_text_zh: '某種比心跳更慢的節奏從遠方傳來——潮汐的呼喚。',
    flavor_text_en: 'A rhythm slower than a heartbeat reaches you from afar — the tide is calling.',
  },
  {
    code: 'G1_myth_revenant_arrives', name_zh: '深潛者增援', name_en: 'Revenant Reinforcement',
    description_zh: '在「濕滑磚牆」生成 1 隻深潛者亡靈到場上。',
    description_en: 'Spawn 1 Deep One Revenant on Slimy Brick Wall.',
    activation_timing: 'keeper_phase', card_category: 'general', intensity_tag: 'major',
    flavor_text_zh: '水溝蓋下傳來緩慢的拖行聲，越來越近。',
    flavor_text_en: 'From beneath the storm grate, a slow dragging — closer, closer.',
  },
  {
    code: 'G1_myth_nightmare_echo', name_zh: '惡夢迴響', name_en: 'Nightmare Echo',
    description_zh: '任一調查員手牌中隨機 1 張變為詛咒卡(進棄牌堆觸發 1 SAN)。',
    description_en: "Random 1 card in any investigator's hand becomes Cursed (1 SAN when discarded).",
    activation_timing: 'keeper_phase', card_category: 'general', intensity_tag: 'major',
    flavor_text_zh: '夢境的東西不再只屬於夢境。它跟著你回家了。',
    flavor_text_en: 'What belongs to dreams no longer stays in dreams. It came home with you.',
  },
  {
    code: 'G1_myth_rain_intensifies', name_zh: '雨勢加劇', name_en: 'Rain Intensifies',
    description_zh: '所有地點施加「潮濕」狀態。',
    description_en: 'Apply Wet status to all locations.',
    activation_timing: 'keeper_phase', card_category: 'general', intensity_tag: 'small',
    flavor_text_zh: '雨突然變大。鞋裡灌進了冷水，你開始懷疑自己今晚的判斷。',
    flavor_text_en: 'The rain redoubles. Cold water floods your shoes; you begin to doubt the choices that brought you here.',
  },
  {
    code: 'G1_myth_mark_whisper', name_zh: '印記低語', name_en: 'Mark Whispers',
    description_zh: '已揭露印斯茅斯印記的調查員強制 SAN 檢定 DC 12，失敗 1 SAN。',
    description_en: 'Investigators who have revealed the Innsmouth Mark must make Willpower DC 12; on failure 1 SAN.',
    activation_timing: 'keeper_phase', card_category: 'general', intensity_tag: 'small',
    flavor_text_zh: '那個符號還在你眼前漂浮。它在叫你的名字——它怎麼會知道你的名字。',
    flavor_text_en: 'The sigil floats behind your eyes. It is calling your name — how does it know your name.',
  },
  {
    code: 'G1_myth_abyss_glance', name_zh: '深淵窺視', name_en: 'Abyss Glance',
    description_zh: '翻開混沌袋袋頂查看 3 個標記;隨後決定是否將其放回袋底或抽到頂。',
    description_en: 'Look at the top 3 chaos bag tokens; decide to keep their order or move any to bottom.',
    activation_timing: 'keeper_phase', card_category: 'general', intensity_tag: 'small',
    flavor_text_zh: '你以為你在看著它。其實是它在看著你。',
    flavor_text_en: 'You thought you were looking into it. In truth, it is looking into you.',
  },
];

const ENCOUNTERS = [
  {
    code: 'G1_enc_brick_creak', name_zh: '磚牆異響', name_en: 'Brick Creak',
    scenario_text_zh: '進入濕滑磚牆時，你聽見牆內有刮擦聲——某種有指甲的東西，從另一側。',
    scenario_text_en: 'As you enter Slimy Brick Wall, a scraping sound comes from inside the wall — something with nails, from the other side.',
    encounter_type: 'choice', threat_type: 'mental', threat_strength: 2,
    design_notes: '進入磚牆地點時觸發,感知檢定 DC 11 揭露額外線索。',
  },
  {
    code: 'G1_enc_deep_one_tracks', name_zh: '深潛者腳印', name_en: 'Deep One Tracks',
    scenario_text_zh: '雨中的水漬不太對勁。腳印的形狀，腳趾之間有蹼。',
    scenario_text_en: 'The puddles in the rain are wrong. The footprints — the toes are webbed.',
    encounter_type: 'thriller', threat_type: 'mental', threat_strength: 1,
    design_notes: '進入任一地點時可能觸發。提示玩家深潛者最近出沒方向。',
  },
  {
    code: 'G1_enc_fog_lost', name_zh: '迷霧迷路', name_en: 'Fog Lost',
    scenario_text_zh: '霧瞬間濃了。你迷了路，走到自己以為去過的地方，發現完全不一樣。',
    scenario_text_en: 'The fog thickens in a heartbeat. You lose your way, arrive at a place you thought you knew, and it is not the same.',
    encounter_type: 'thriller', threat_type: 'mental', threat_strength: 2,
    design_notes: '地點之間移動時可能觸發,額外消耗 1 行動點。',
  },
  {
    code: 'G1_enc_neighbor_peek', name_zh: '鄰居窺視', name_en: 'Neighbor Peeks',
    scenario_text_zh: '二樓的窗簾動了一下。一張臉縮回去——但你看清了。那張臉認得這條街上發生的事。',
    scenario_text_en: 'A curtain shifts on the second floor. A face draws back — but you saw it. That face knows what is happening on this street.',
    encounter_type: 'choice', threat_type: 'mental', threat_strength: 1,
    design_notes: '玩家進場時觸發一次,獲得「街頭情報」線索。',
  },
  {
    code: 'G1_enc_siren_recede', name_zh: '警笛遠去', name_en: 'Sirens Recede',
    scenario_text_zh: '遠方的警笛聲響起，又遠去——朝相反方向。沒有救援會來了。',
    scenario_text_en: 'A distant siren sounds, then fades — going the opposite way. No rescue is coming.',
    encounter_type: 'thriller', threat_type: 'mental', threat_strength: 2,
    design_notes: '進場時觸發,氛圍鋪墊「沒有任何救援會來」。',
  },
];

let mAdded = 0, mSkipped = 0;
log('\n── 神話卡 ──');
for (const m of MYTHOS) {
  if (exMythNames.has(m.name_zh)) { log(`⊙ skip: ${m.name_zh}`); mSkipped++; continue; }
  const r = await adminFetch('/api/admin/keeper/mythos-cards', { method: 'POST', body: JSON.stringify(m) });
  if (!r.ok) { log(`✗ ${m.name_zh}: ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`); continue; }
  log(`✓ ${m.name_zh}`); mAdded++;
}

let eAdded = 0, eSkipped = 0;
log('\n── 遭遇卡 ──');
for (const e of ENCOUNTERS) {
  if (exEncNames.has(e.name_zh)) { log(`⊙ skip: ${e.name_zh}`); eSkipped++; continue; }
  const r = await adminFetch('/api/admin/keeper/encounter-cards', { method: 'POST', body: JSON.stringify(e) });
  if (!r.ok) { log(`✗ ${e.name_zh}: ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`); continue; }
  log(`✓ ${e.name_zh}`); eAdded++;
}

log(`\n=== 結果 === 神話 ${mAdded}+${mSkipped} skip / 遭遇 ${eAdded}+${eSkipped} skip`);
fs.writeFileSync(logPath, lines.join('\n'));
log(`log: ${logPath}`);
