import { adminFetch, adminGet } from './api.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `g1-locations-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# G1 三地點建立 ${stamp}`);
log('');

// 取得 outdoor_street tag id
const tagsRes = await adminFetch('/api/admin/locations/tags');
const allTags = [];
for (const cat of Object.keys(tagsRes.body.tags)) {
  for (const t of tagsRes.body.tags[cat]) allTags.push(t);
}
const streetTag = allTags.find(t => t.code === 'outdoor_street');
if (!streetTag) throw new Error('outdoor_street tag not found');
log(`✓ 找到風格標籤 outdoor_street id=${streetTag.id}`);

// 三地點規格(對齊 Part 2 §1)
const locations = [
  {
    code: 'G1_alley_entrance',
    name_zh: '暗巷入口',
    name_en: 'Alley Entrance',
    description_zh: '冷雨敲打著鐵皮屋簷,煤氣燈在街角投下昏黃的光暈。空氣中飄著一絲不該屬於這條街的味道——海腥味,從巷子深處滲出來,像潮水般慢慢爬上你的鞋底。',
    description_en: 'Cold rain drums on the tin awnings; gaslight casts a sickly amber pool at the corner. A briny stench drifts from the alley\'s depths — sea-rot where no sea should be, creeping toward your boots like a slow tide.',
    scale_tag: 'block',
    shroud: 3,
    clues_base: 1,
    clues_per_player: false,
    travel_cost: 1,
    travel_cost_type: 'action_point',
    art_type: 'none',
    design_status: 'draft',
    design_notes: 'G1 沙盒關卡入口地點。劇本第一段敘事核心:鐵證調查員進場,雨夜煤氣燈,海腥味鋪墊。clues_base=1 對應劇本「地上有海水的痕跡延伸向暗巷深處」初始可見線索。',
    tags: [streetTag.id],
    hidden_info: [],
  },
  {
    code: 'G1_slimy_brick_wall',
    name_zh: '濕滑磚牆',
    name_en: 'Slimy Brick Wall',
    description_zh: '磚牆滲出黏稠的液體,混雜著海水與某種未知腺體的分泌物。月光下,黏液彷彿在緩慢蠕動。靠近,你會聞到鹹腥與血鏽的氣味。',
    description_en: 'The brick wall weeps a viscous slime — seawater fused with secretions from some glands no human possesses. In the moonlight the ooze seems to crawl. Up close it smells of brine and rusted blood.',
    scale_tag: 'block',
    shroud: 3,
    clues_base: 0,
    clues_per_player: false,
    travel_cost: 2,
    travel_cost_type: 'action_point',
    art_type: 'none',
    design_status: 'draft',
    design_notes: 'G1 中段地點。劇本「磚牆隱藏調查點」核心:玩家用感知檢定揭露印斯茅斯印記。travel_cost=2 對應 Part 2 §1.2「障礙物相鄰」(從 A→B 1 點,B→C 2 點)。clues_base=0,所有資訊都在 hidden_info。',
    tags: [streetTag.id],
    hidden_info: [
      {
        title_zh: '印斯茅斯的印記',
        title_en: 'The Innsmouth Mark',
        description_zh: '你撥開黏液,在磚牆深處看見一個刻痕——那不是日本怪談的符號,而是來自印斯茅斯。三道波紋包圍著一隻睜開的魚眼,代表深潛者血脈的識別印記。這條街的某處,有那種血脈的東西在等待。',
        description_en: 'You scrape away the slime and find an etching beneath — not the kanji of an urban legend, but the Innsmouth Mark: three waves encircling an opened fish-eye, the sigil of those who carry Deep One blood. Something of that lineage waits, somewhere on this street.',
        reveal_condition_type: 'investigation_count',
        reveal_condition_params: { count: 1 },
        reward_type: 'narrative_only',
        reward_params: {},
        sort_order: 0,
      },
    ],
  },
  {
    code: 'G1_deep_one_haunt',
    name_zh: '深潛者出沒處',
    name_en: 'Deep One Haunt',
    description_zh: '巷弄盡頭的死角,路燈的光照不到這裡。牆上有抓痕,長度與深度都不像人類所能造成。地上積著一灘看不出邊界的水漬,水面偶爾會出現一道細微的漣漪——彷彿底下有什麼正在呼吸。',
    description_en: 'The dead corner at the alley\'s end, where the streetlamp cannot reach. Claw marks score the wall — too long, too deep for any human hand. A pool of water spreads across the ground without visible edges, and now and then a faint ripple crosses its surface, as if something beneath is breathing.',
    scale_tag: 'block',
    shroud: 4,
    clues_base: 0,
    clues_per_player: false,
    travel_cost: 1,
    travel_cost_type: 'action_point',
    art_type: 'none',
    design_status: 'draft',
    design_notes: 'G1 終戰地點。劇本「深潛者裂嘴女出沒」核心。shroud=4 對應「黑暗」狀態(規則書 §12.1 最高隱蔽級)。clues_base=0 — 這裡只有怪物,沒線索。怪物配置由 stage 層處理。',
    tags: [streetTag.id],
    hidden_info: [],
  },
];

const results = [];
for (const loc of locations) {
  log(`\n── 建立 ${loc.name_zh} (${loc.code}) ──`);
  try {
    // 1. POST location
    const { tags, hidden_info, ...body } = loc;
    const r = await adminFetch('/api/admin/locations', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      log(`✗ POST 失敗 ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
      results.push({ code: loc.code, ok: false, error: r.body });
      continue;
    }
    const id = r.body.location.id;
    log(`✓ 建立成功 id=${id}`);

    // 2. PUT tags
    const tr = await adminFetch(`/api/admin/locations/${id}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tag_ids: tags }),
    });
    if (!tr.ok) {
      log(`⚠ PUT tags 失敗 ${tr.status}: ${JSON.stringify(tr.body).slice(0, 200)}`);
    } else {
      log(`✓ 套用 ${tags.length} 個 tag`);
    }

    // 3. POST hidden_info
    for (const hi of hidden_info) {
      const hr = await adminFetch(`/api/admin/locations/${id}/hidden-info`, {
        method: 'POST',
        body: JSON.stringify(hi),
      });
      if (!hr.ok) {
        log(`⚠ POST hidden-info 失敗 ${hr.status}: ${JSON.stringify(hr.body).slice(0, 200)}`);
      } else {
        log(`✓ 隱藏調查點建立: ${hi.title_zh}`);
      }
    }

    results.push({ code: loc.code, name_zh: loc.name_zh, id, ok: true, hidden_info_count: hidden_info.length });
  } catch (e) {
    log(`✗ 例外: ${e.message}`);
    results.push({ code: loc.code, ok: false, error: e.message });
  }
}

log('\n=== 結果摘要 ===');
for (const r of results) {
  log(r.ok ? `✓ ${r.name_zh} (${r.code}) id=${r.id}` : `✗ ${r.code} 失敗: ${JSON.stringify(r.error).slice(0, 200)}`);
}

fs.writeFileSync(logPath, lines.join('\n'));
log(`\nlog: ${logPath}`);
