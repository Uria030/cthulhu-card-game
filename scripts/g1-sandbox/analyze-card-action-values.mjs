/**
 * 卡片動作真實 V 值分析 — 讀線上 DB 四套 AI 牌組,用引擎實際公式計算(非估計)
 *
 * 對帳基準(Uria V 制):基本動作 = 1V。每張卡的「行動效果」換算成
 * 「同類基本動作的幾倍產出」= 該卡的實測倍率(取代手調 CARD_ACTION_BONUS=1.6)。
 *
 * 引擎公式來源(查證):
 * - 武器攻擊傷害 = effect_params.damage ?? 2(ruleEngine.ts:1277-1278,卡面 damage 欄位不參與!)
 * - 命中修正 = 風格池逐卡平均(屬性 + 武器 attribute_modifiers)(investigatorAI.weaponExpectedModifier)
 * - 成功率 = estimateSuccessChance(d20,天1/天20 保留)
 * - 施法 deal_damage = 必中,damage = params.damage ?? 2(ruleEngine.ts:1337)
 * - 徒手 = 力量 vs DC,傷害 1
 * 用法:node scripts/g1-sandbox/analyze-card-action-values.mjs
 */
const BASE = 'https://server-production-fc4f.up.railway.app';
const STAGE = '9ad171b3-c439-4049-b673-b929f91366ce';

// 名冊(鏡射 investigatorAI.ts AI_INVESTIGATOR_ROSTER + 玩家席鐵證偵探)
const ROSTER = [
  { label: '鐵證偵探(玩家席)', tpl: '70de5729-d553-4667-b6d6-25265d56b9c8', free: {} },
  { label: '伊萊亞斯(偵探)', tpl: 'f6ddfe04-cd49-4775-99f2-5edc873e3799', free: { perception: 2, willpower: 1, reflex: 1 } },
  { label: '薇絲珀(靈媒)', tpl: '36effa3a-5709-47fe-a710-8b6d436da2f5', free: { willpower: 2, perception: 2 } },
  { label: '艾達(密碼學家)', tpl: '1ad78b83-0b95-4337-9ae8-d935bc85db9f', free: { intellect: 1, willpower: 1, perception: 2 } },
  { label: '馬庫斯(軍官)', tpl: '77fb726a-7c12-4197-af19-12262588f475', free: { reflex: 2, constitution: 1, strength: 1 } },
];

const ATTR_KEYS = ['strength', 'agility', 'constitution', 'reflex', 'intellect', 'willpower', 'perception', 'charisma'];

function estimateSuccessChance(mod, dc) {
  const needed = dc - mod;
  return Math.min(19, Math.max(1, 21 - needed)) / 20;
}

async function bootstrap(tpl) {
  const r = await fetch(`${BASE}/api/play/stages/${STAGE}/bootstrap?investigator=${tpl}`);
  const j = await r.json();
  if (!j.success) throw new Error(`bootstrap ${tpl}: ${j.error}`);
  return j.data;
}

const first = await bootstrap(ROSTER[0].tpl);
// 場上敵人參照:boss + 城主神話卡會生的雜兵(取 tier ≤ 2 有 DC 的)
const monsters = first.monsters.map((m) => ({
  code: m.code, name: m.name_zh, dc: Number(m.dc ?? 10), tier: Number(m.tier ?? 1),
  hp: Number(m.hp_base ?? 1),
}));
const boss = monsters.find((m) => m.code === 'G1_deep_one_slit_mouth');
const minions = monsters.filter((m) => m.tier <= 2);
const minionDcAvg = minions.reduce((s, m) => s + m.dc, 0) / Math.max(1, minions.length);
const shrouds = first.locations.map((l) => ({ name: l.name_zh, shroud: Number(l.shroud ?? 10), vis: l.visibility }));
const stylePools = {};
for (const sc of first.combat_style_pools ?? []) (stylePools[sc.style_code] = stylePools[sc.style_code] ?? []).push(sc);

console.log(`══ 環境(線上 prod 即時)══`);
console.log(`boss:${boss.name} DC${boss.dc} HP${boss.hp} | 雜兵 ${minions.length} 種 DC 均值 ${minionDcAvg.toFixed(1)}(${minions.map((m) => `${m.name}${m.dc}`).join('/')})`);
console.log(`shroud:${shrouds.map((s) => `${s.name}${s.shroud}${s.vis === 'night' || s.vis === 'darkness' ? '(夜)' : ''}`).join(' ')}`);
console.log(`風格池:${Object.entries(stylePools).map(([k, v]) => `${k}×${v.length}`).join(' ')}`);

// 每 AP 基本動作基準(1V 錨點)
// 徒手攻擊 = p(力量 vs DC)×1 傷害;調查 = p(感知 vs shroud);拿資源 = 1 資源;抽卡 = 1 張
const rows = [];
const dataHoles = [];
const healInventory = [];

for (const who of ROSTER) {
  const b = who.tpl === ROSTER[0].tpl ? first : await bootstrap(who.tpl);
  const inv = b.investigator;
  const attrs = {};
  for (const k of ATTR_KEYS) attrs[k] = Math.min(5, Number(inv[`attr_${k}`] ?? 1) + Number(who.free[k] ?? 0));
  const pools = {};
  for (const sc of b.combat_style_pools ?? []) (pools[sc.style_code] = pools[sc.style_code] ?? []).push(sc);

  // 基準:此人最佳基本動作
  const bestShroud = Math.min(...shrouds.map((s) => s.shroud));
  const invBase = {
    unarmedBoss: estimateSuccessChance(attrs.strength, boss.dc) * 1,
    unarmedMinion: estimateSuccessChance(attrs.strength, minionDcAvg) * 1,
    investigate: estimateSuccessChance(attrs.perception, bestShroud) * 1,
  };

  const seen = new Set();
  for (const entry of inv.starting_deck ?? []) {
    const card = entry.card ?? entry.signature_card ?? entry.weakness;
    if (!card || seen.has(card.code)) continue;
    seen.add(card.code);
    if (card.is_weakness) continue;
    const fx = card.effects ?? [];
    const actionFx = fx.filter((f) => f.trigger_type === 'action');

    // 治療盤點(裁定 A 佐證)
    const healFx = fx.filter((f) => /heal|restore_(hp|san)|recover/i.test(String(f.effect_code)));
    if (healFx.length > 0 || Number(card.health_boost ?? 0) > 0 || Number(card.sanity_boost ?? 0) > 0) {
      healInventory.push(`${who.label}:${card.name_zh}(${healFx.map((f) => f.effect_code).join(',') || `boost hp+${card.health_boost}/san+${card.sanity_boost}`})`);
    }

    for (const f of actionFx) {
      const p = f.effect_params ?? {};
      const code = String(f.effect_code);
      let row = null;
      if (code === 'attack') {
        // 武器:引擎傷害 = params.damage ?? 2;卡面 damage 欄位若不同 → 資料洞
        const engineDmg = Number(p.damage ?? 2) + Number(p.damage_bonus ?? 0);
        if (Number(card.damage ?? 0) > 0 && Number(card.damage) !== engineDmg) {
          dataHoles.push(`${card.name_zh}(${card.code}):卡面 damage=${card.damage} 但效果 params 空 → 引擎實戰只打 ${engineDmg}`);
        }
        const pool = pools[String(card.combat_style ?? '')] ?? [];
        if (pool.length === 0) { dataHoles.push(`${card.name_zh}:風格 ${card.combat_style} 無風格池`); continue; }
        let sum = 0;
        for (const sc of pool) sum += (attrs[sc.check_attribute] ?? 0) + Number(card.attribute_modifiers?.[sc.check_attribute] ?? 0);
        const mod = sum / pool.length;
        const evBoss = estimateSuccessChance(mod, boss.dc) * engineDmg;
        const evMinion = estimateSuccessChance(mod, minionDcAvg) * engineDmg;
        row = {
          who: who.label, card: `${card.name_zh}(費${card.cost}${card.ammo ? `,彈${card.ammo}` : ''})`, kind: '武器攻擊',
          note: `修正${mod.toFixed(1)} 傷${engineDmg}`,
          evBoss, evMinion,
          multBoss: evBoss / invBase.unarmedBoss, multMinion: evMinion / invBase.unarmedMinion,
        };
      } else if (/deal_damage|deal_horror/.test(code)) {
        // 引擎查證(effectsExecutor.ts:80):deal_damage 必中免檢定,量 = params.amount ?? 1
        const dmg = Number(p.amount ?? 1) * (p.crit === true ? 2 : Math.max(1, Number(p.crit ?? 1)));
        row = {
          who: who.label, card: `${card.name_zh}(費${card.cost})`, kind: '傷害事件(必中)',
          note: `傷${dmg} params=${JSON.stringify(p)}`,
          evBoss: dmg, evMinion: dmg,
          multBoss: dmg / invBase.unarmedBoss, multMinion: dmg / invBase.unarmedMinion,
        };
      } else if (code === 'discover_clue') {
        const n = Number(p.amount ?? 1);
        row = { who: who.label, card: `${card.name_zh}(費${card.cost})`, kind: '找線索', note: `線索${n}(免檢定?看效果)`, evBoss: n, evMinion: n, multBoss: n / invBase.investigate, multMinion: n / invBase.investigate };
      } else if (/draw_card|gain_resource|search_deck/.test(code)) {
        const n = Number(p.amount ?? p.count ?? 1);
        row = { who: who.label, card: `${card.name_zh}(費${card.cost})`, kind: '經濟', note: `${code}×${n}`, evBoss: n, evMinion: n, multBoss: n / 1, multMinion: n / 1 };
      } else {
        row = { who: who.label, card: `${card.name_zh}(費${card.cost})`, kind: `其他:${code}`, note: (f.description_zh ?? '').slice(0, 30), evBoss: NaN, evMinion: NaN, multBoss: NaN, multMinion: NaN };
      }
      if (row) rows.push(row);
    }
    // 盟友卡:§10.5 攻擊力 = damage 欄位(獨立行動,不花調查員 AP → 純增量)
    if (card.card_type === 'ally' && Number(card.damage ?? 0) > 0) {
      rows.push({ who: who.label, card: `${card.name_zh}(費${card.cost})`, kind: '盟友(免AP)', note: `攻${card.damage} HP${card.ally_hp}`, evBoss: NaN, evMinion: NaN, multBoss: NaN, multMinion: NaN });
    }
  }

  console.log(`\n── ${who.label} 屬性:力${attrs.strength} 反${attrs.reflex} 智${attrs.intellect} 意${attrs.willpower} 感${attrs.perception}`);
  console.log(`   基本動作基準/AP:徒手vs boss ${invBase.unarmedBoss.toFixed(2)} | 徒手vs雜兵 ${invBase.unarmedMinion.toFixed(2)} | 調查 ${invBase.investigate.toFixed(2)} 線索`);
}

console.log(`\n══ 卡片行動效果實測(引擎公式)══`);
console.log('倍率 = 該卡每 AP 產出 ÷ 同人同類基本動作每 AP 產出');
for (const r of rows) {
  const mb = Number.isFinite(r.multBoss) ? r.multBoss.toFixed(1) + 'x' : '—';
  const mm = Number.isFinite(r.multMinion) ? r.multMinion.toFixed(1) + 'x' : '—';
  console.log(`  ${r.who} | ${r.card} | ${r.kind} | ${r.note} | vs boss ${Number.isFinite(r.evBoss) ? r.evBoss.toFixed(2) : '—'}(${mb}) vs 雜兵 ${Number.isFinite(r.evMinion) ? r.evMinion.toFixed(2) : '—'}(${mm})`);
}

const finite = rows.filter((r) => Number.isFinite(r.multBoss) && r.kind === '武器攻擊');
if (finite.length) {
  const ms = finite.map((r) => r.multBoss).sort((a, b) => a - b);
  const msM = finite.map((r) => r.multMinion).sort((a, b) => a - b);
  const mid = (a) => a[Math.floor(a.length / 2)];
  console.log(`\n══ 武器攻擊倍率分布(vs 徒手)══`);
  console.log(`  vs boss DC${boss.dc}:min ${ms[0].toFixed(1)}x / 中位 ${mid(ms).toFixed(1)}x / max ${ms[ms.length - 1].toFixed(1)}x(n=${ms.length})`);
  console.log(`  vs 雜兵 DC${minionDcAvg.toFixed(0)}:min ${msM[0].toFixed(1)}x / 中位 ${mid(msM).toFixed(1)}x / max ${msM[msM.length - 1].toFixed(1)}x`);
}

console.log(`\n══ 資料洞(卡面 vs 引擎不一致)══`);
for (const h of [...new Set(dataHoles)]) console.log('  ⚠ ' + h);
if (dataHoles.length === 0) console.log('  (無)');

console.log(`\n══ 治療手段盤點(裁定 A 佐證)══`);
for (const h of healInventory) console.log('  💊 ' + h);
if (healInventory.length === 0) console.log('  (四套牌組皆無治療效果 → 資料洞:救援工具鏈缺「治療拉起」選項)');
