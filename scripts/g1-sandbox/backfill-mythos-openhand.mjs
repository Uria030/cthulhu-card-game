// 神話卡 open-hand 回填(冪等):reusable/cooldown/max_uses + 6 張卡結構化效果
// 依 keeper_ai_v0_decision_spec §4.4/§5;值對照卡面敘述,不改敘述本身
// 用法:node backfill-mythos-openhand.mjs [--dry](--dry 只印不寫)
import { adminGet, adminPut, adminFetch } from './api.mjs';

const DRY = process.argv.includes('--dry');

const FILL = {
  '末日推進': { fields: { reusable: true, cooldown_rounds: 1 } },
  '深淵呼喚': { fields: { reusable: true, cooldown_rounds: 1 } },
  '不祥預感': { fields: { reusable: true, cooldown_rounds: 2 } },
  '瘋狂攫住': {
    fields: { reusable: false, max_uses_per_stage: 1 },
    effect: {
      action_code: 'attach_status',
      action_params: { status: 'madness', upkeep_discard: 1, release_test: 'willpower', release_dc: 3 },
      description_zh: '附著:每回合開始棄 1 張手牌;通過意志檢定(3)解除。',
    },
  },
  '黑暗滲出': {
    fields: { reusable: true, cooldown_rounds: 1 },
    effect: {
      action_code: 'set_visibility',
      action_params: { visibility: 'darkness' },
      description_zh: '將目標地點光照改為「黑暗」。',
    },
  },
  '海腥味瀰漫': {
    fields: { reusable: true, cooldown_rounds: 2 },
    effect: {
      action_code: 'test_modifier',
      action_params: { attribute: 'perception', modifier: -1 },
      description_zh: '附著:所有調查員的感知檢定 -1。',
    },
  },
  '雨勢加劇': {
    fields: { reusable: true, cooldown_rounds: 2 },
    effect: {
      action_code: 'attach_status',
      action_params: { status: 'wet', scope: 'all_locations' },
      description_zh: '附著:所有地點施加「潮濕」。',
    },
  },
  '恐懼侵襲': {
    fields: { reusable: true, cooldown_rounds: 2 },
    effect: {
      action_code: 'horror_damage',
      action_params: { amount: 2, target_rule: 'lowest_san', cap_to_one_at_limit: true },
      description_zh: '對理智最低的調查員造成 2 點恐懼;將達上限時改為 1 點。',
    },
  },
  '深潛者增援': {
    fields: { reusable: true, cooldown_rounds: 2, max_uses_per_stage: 3 },
    effect: {
      action_code: 'summon_monster',
      // 地點碼修正:原敘述「濕滑磚牆」為 G1 舊地點(已被部署清洗事故滅失),對映現行「磚牆盡頭」
      action_params: { quantity: 1, variant_code: 'G1_deep_one_revenant', location_code: 'g_slit_mouth_loc_brick_wall' },
      description_zh: '在「磚牆盡頭」生成 1 隻深潛者亡靈。',
    },
  },
  // narrative 三張(NPC 變臉/假線索散播/線索篡改):v0 蟄伏,不回填效果
};

const list = await adminGet('/api/admin/keeper/mythos-cards');
const cards = list.mythos_cards ?? list.cards ?? list.data ?? list;
let done = 0;
for (const [name, spec] of Object.entries(FILL)) {
  const hit = (Array.isArray(cards) ? cards : []).find((c) => c.name_zh === name);
  if (!hit) {
    console.log(`✗ 找不到【${name}】`);
    continue;
  }
  const full = await adminGet(`/api/admin/keeper/mythos-cards/${hit.id}`);
  const card = full.card ?? full.data ?? full;

  // PUT 全欄位(端點非 COALESCE 欄位會被覆寫,必須帶回原值)
  const body = { ...card, ...spec.fields };
  delete body.effects;
  if (DRY) {
    console.log(`[dry] PUT ${name}:`, JSON.stringify(spec.fields));
  } else {
    await adminPut(`/api/admin/keeper/mythos-cards/${hit.id}`, body);
  }

  // 結構化效果:已存在同 action_code 則跳過(冪等)
  if (spec.effect) {
    const existing = (card.effects ?? []).some((e) => e.action_code === spec.effect.action_code);
    if (!existing) {
      if (DRY) {
        console.log(`[dry] + effect ${spec.effect.action_code}:`, JSON.stringify(spec.effect.action_params));
      } else {
        const r = await adminFetch(`/api/admin/keeper/mythos-cards/${hit.id}/effects`, {
          method: 'POST',
          body: JSON.stringify(spec.effect),
        });
        console.log(`  + effect ${spec.effect.action_code} → ${r.status}`);
      }
    } else {
      console.log(`  = effect ${spec.effect.action_code} 已存在,跳過`);
    }
  }
  console.log(`✓ ${name} reusable=${spec.fields.reusable} cd=${spec.fields.cooldown_rounds ?? '-'} max=${spec.fields.max_uses_per_stage ?? '-'}`);
  done += 1;
}
console.log(`完成 ${done}/${Object.keys(FILL).length}`);
