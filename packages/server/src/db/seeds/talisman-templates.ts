import type { PoolClient } from 'pg';

/**
 * 雙軸戰鬥草案 v1.0 §5.5：9 張範本法器卡
 *
 * 這些是**座標錨點**，不是最終成品卡。讓創作者在 MOD-01 中能以這 9 張變奏。
 * 九宮格 = 3 威脅類型（mental / physical / ritual） × 3 破除時機（instant / test / stockpile）
 *
 * 條件式插入：僅在 card_definitions 表沒有任何 is_talisman=true 的卡片時才 seed。
 */

type TalismanTemplate = {
  code: string;
  name_zh: string;
  name_en: string;
  faction: string;
  style: string;          // A+H / A+C / O+H / O+C → 儲存為 AH/AC/OH/OC
  card_type: string;      // 'asset' / 'event' 等
  slot: string;
  cost: number;
  damage: number;         // 0 表純法器
  talisman_type: string;
  target_threat_types: string[];
  break_timing: 'instant' | 'test' | 'stockpile';
  break_strength_max: number | null;
  break_charge_label: string;
  break_charge_max: number;
  break_test_attribute: string | null;
  stockpile_accumulation_rule: string | null;
  break_axis_value: number;
  kill_axis_value: number;
  leverage_modifier: number;
  flavor_text: string;
};

const TEMPLATES: TalismanTemplate[] = [
  {
    code: 'CS0AH-T01', name_zh: '銀製護身符', name_en: 'Silver Amulet',
    faction: 'S', style: 'AH', card_type: 'asset', slot: 'accessory',
    cost: 2, damage: 0,
    talisman_type: 'silver', target_threat_types: ['mental'],
    break_timing: 'instant', break_strength_max: 5, break_charge_label: '神聖度', break_charge_max: 5,
    break_test_attribute: null, stockpile_accumulation_rule: null,
    break_axis_value: 3.5, kill_axis_value: 0, leverage_modifier: 0,
    flavor_text: '「它的冷意隔著皮膚貼著你的心。無聲的低語退去了。」',
  },
  {
    code: 'CJ0AH-T02', name_zh: '鋼製十字架', name_en: 'Steel Crucifix',
    faction: 'J', style: 'AH', card_type: 'asset', slot: 'one_hand',
    cost: 2, damage: 1,
    talisman_type: 'steel', target_threat_types: ['physical'],
    break_timing: 'instant', break_strength_max: 4, break_charge_label: '純度', break_charge_max: 4,
    break_test_attribute: null, stockpile_accumulation_rule: null,
    break_axis_value: 3.0, kill_axis_value: 1.0, leverage_modifier: 1.0,
    flavor_text: '「它擋下的不是刀鋒，是那些從地板底下伸上來的東西。」',
  },
  {
    code: 'CS0AH-T03', name_zh: '桃木劍', name_en: 'Peachwood Sword',
    faction: 'S', style: 'AH', card_type: 'asset', slot: 'one_hand',
    cost: 1, damage: 2,
    talisman_type: 'wooden_peach', target_threat_types: ['ritual'],
    break_timing: 'instant', break_strength_max: 6, break_charge_label: '木質', break_charge_max: 6,
    break_test_attribute: null, stockpile_accumulation_rule: '每次破除後，此卡傷害永久 -1',
    break_axis_value: 3.5, kill_axis_value: 2.0, leverage_modifier: 1.0,
    flavor_text: '「每一次劃開邪術的紋路，劍身就碎掉一塊。」',
  },
  {
    code: 'CE0OH-T04', name_zh: '警徽', name_en: 'Police Badge',
    faction: 'E', style: 'OH', card_type: 'asset', slot: 'accessory',
    cost: 1, damage: 0,
    talisman_type: 'steel', target_threat_types: ['mental'],
    break_timing: 'test', break_strength_max: null, break_charge_label: '共鳴', break_charge_max: 3,
    break_test_attribute: 'charisma', stockpile_accumulation_rule: null,
    break_axis_value: 3.0, kill_axis_value: 0, leverage_modifier: 0,
    flavor_text: '「他亮出徽章的瞬間，那些耳語退到了更深的夜裡。」',
  },
  {
    code: 'CF0AH-T05', name_zh: '鐵棍', name_en: 'Iron Rod',
    faction: 'F', style: 'AH', card_type: 'asset', slot: 'one_hand',
    cost: 1, damage: 2,
    talisman_type: 'steel', target_threat_types: ['physical'],
    break_timing: 'test', break_strength_max: null, break_charge_label: '行動點', break_charge_max: 0,
    break_test_attribute: 'strength', stockpile_accumulation_rule: null,
    break_axis_value: 2.5, kill_axis_value: 2.0, leverage_modifier: 1.0,
    flavor_text: '「沒有充能、沒有儀式——有的只是肌肉與意志。」',
  },
  {
    code: 'CT0AC-T06', name_zh: '解咒儀刀', name_en: 'Ritual Breaker',
    faction: 'T', style: 'AC', card_type: 'asset', slot: 'one_hand',
    cost: 2, damage: 1,
    talisman_type: 'steel', target_threat_types: ['ritual'],
    break_timing: 'test', break_strength_max: null, break_charge_label: '裂痕', break_charge_max: 3,
    break_test_attribute: 'agility', stockpile_accumulation_rule: '每次失敗在此卡上放置 1 裂痕（3 即斷裂）',
    break_axis_value: 3.0, kill_axis_value: 1.0, leverage_modifier: 1.0,
    flavor_text: '「刀身上每一道裂痕，都是一個你沒辦法忘掉的夜晚。」',
  },
  {
    code: 'CN0OH-T07', name_zh: '預兆水晶', name_en: 'Omen Crystal',
    faction: 'N', style: 'OH', card_type: 'asset', slot: 'accessory',
    cost: 3, damage: 0,
    talisman_type: 'crystal', target_threat_types: ['mental'],
    break_timing: 'stockpile', break_strength_max: 6, break_charge_label: '預兆', break_charge_max: 6,
    break_test_attribute: null, stockpile_accumulation_rule: '每回合開始時 +1 預兆（上限 6）',
    break_axis_value: 4.0, kill_axis_value: 0, leverage_modifier: 0,
    flavor_text: '「水晶裡映著的不是你的臉，是你還沒遇到的那個房間。」',
  },
  {
    code: 'CI0OC-T08', name_zh: '鹽圈瓶', name_en: 'Salt Circle Flask',
    faction: 'I', style: 'OC', card_type: 'asset', slot: 'accessory',
    cost: 2, damage: 0,
    talisman_type: 'salt', target_threat_types: ['physical'],
    break_timing: 'stockpile', break_strength_max: 5, break_charge_label: '鹽', break_charge_max: 8,
    break_test_attribute: null, stockpile_accumulation_rule: '每次研究遺跡或閱讀書籍時 +1 鹽（上限 8，鹽用完後此卡移出遊戲）',
    break_axis_value: 3.5, kill_axis_value: 0, leverage_modifier: 0,
    flavor_text: '「他在地板上畫了一圈鹽。圈裡面的世界，還能算是世界。」',
  },
  {
    code: 'CP0OH-T09', name_zh: '古印之卷', name_en: 'Ancient Seal Scroll',
    faction: 'P', style: 'OH', card_type: 'asset', slot: 'accessory',
    cost: 2, damage: 0,
    talisman_type: 'scroll', target_threat_types: ['ritual'],
    break_timing: 'stockpile', break_strength_max: 8, break_charge_label: '封印', break_charge_max: 4,
    break_test_attribute: null, stockpile_accumulation_rule: '每次完成關卡或解謎成功時 +1 封印（上限 4；滿格時本回合所有檢定 +1）',
    break_axis_value: 4.0, kill_axis_value: 0, leverage_modifier: 0,
    flavor_text: '「封印寫在你不認識的文字裡。但你隱約知道，它記得你。」',
  },
];

export async function seedTalismanTemplates(client: PoolClient): Promise<void> {
  const existing = await client.query(
    `SELECT COUNT(*)::int AS c FROM card_definitions WHERE is_talisman = TRUE`
  );
  if (((existing.rows[0] as any).c) > 0) {
    console.log('[talisman seed] 既有法器卡片存在，略過 seed');
    return;
  }

  for (const t of TEMPLATES) {
    try {
      await client.query(
        `INSERT INTO card_definitions (
          code, series, name_zh, name_en, faction, style, card_type, slot,
          level, cost, cost_currency, damage,
          flavor_text,
          is_talisman, talisman_type, target_threat_types, break_timing, break_strength_max,
          break_charge_label, break_charge_max, break_test_attribute, stockpile_accumulation_rule,
          break_axis_value, kill_axis_value, leverage_modifier
        ) VALUES (
          $1,'C',$2,$3,$4,$5,$6,$7,
          0,$8,'resource',$9,
          $10,
          TRUE,$11,$12,$13,$14,
          $15,$16,$17,$18,
          $19,$20,$21
        ) ON CONFLICT (code) DO NOTHING`,
        [
          t.code, t.name_zh, t.name_en, t.faction, t.style, t.card_type, t.slot,
          t.cost, t.damage,
          t.flavor_text,
          t.talisman_type, JSON.stringify(t.target_threat_types), t.break_timing, t.break_strength_max,
          t.break_charge_label, t.break_charge_max, t.break_test_attribute, t.stockpile_accumulation_rule,
          t.break_axis_value, t.kill_axis_value, t.leverage_modifier,
        ]
      );
    } catch (err) {
      console.warn(`[talisman seed] ${t.code} 插入失敗：`, (err as Error).message);
    }
  }
  console.log(`[talisman seed] 已 seed ${TEMPLATES.length} 張範本法器卡`);
}
