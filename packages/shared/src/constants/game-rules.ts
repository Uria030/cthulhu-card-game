/** 數值規格 — 來源：數值規格文件 v0.1 */
export const GAME_RULES = {
  // 骰子系統
  DICE: 'd20' as const,
  DICE_SIDES: 20,

  // 屬性系統
  ATTRIBUTE_MIN: 1,
  ATTRIBUTE_MAX: 10,
  ATTRIBUTE_CREATION_MAX: 5,
  CREATION_TOTAL_POINTS: 21,
  ATTRIBUTE_COUNT: 7,

  // 修正值
  getModifier: (attributeValue: number): number => Math.floor(attributeValue / 2),

  // HP / SAN
  HP_BASE: 5,
  SAN_BASE: 5,
  getMaxHP: (constitution: number): number => constitution * 2 + 5,
  getMaxSAN: (willpower: number): number => willpower * 2 + 5,

  // 行動經濟
  ACTIONS_PER_TURN: 3,
  HAND_LIMIT: 8,
  CARDS_DRAWN_PER_TURN: 1,

  // 資源經濟
  STARTING_RESOURCES: 5,
  RESOURCE_PER_TURN: 1,
  CARD_COST_MIN: 1,
  CARD_COST_MAX: 6,

  // 起始牌組
  STARTING_DECK_MIN: 15,
  STARTING_DECK_MAX: 20,
  SIGNATURE_CARDS: { min: 2, max: 3 },
  WEAKNESS_CARDS: 1,

  // 敵人 DC 階層
  ENEMY_TIERS: {
    minion: { dc: 8,  hpRange: [3, 5],   dmgRange: [1, 2],  regen: 0 },
    threat: { dc: 12, hpRange: [8, 14],  dmgRange: [2, 4],  regen: 0 },
    elite:  { dc: 16, hpRange: [18, 28], dmgRange: [3, 6],  regen: [0, 1] },
    boss:   { dc: 20, hpRange: [35, 50], dmgRange: [4, 8],  regen: [1, 3] },
    titan:  { dc: 24, hpRange: [55, 70], dmgRange: [6, 10], regen: [3, 5] },
  },

  // 武器傷害階層
  WEAPON_TIERS: {
    makeshift:  { damage: 1, cost: 0, ammo: null },
    basic:      { damage: 2, cost: 2, ammo: 1 },
    standard:   { damage: 3, cost: 3, ammo: 1 },
    advanced:   { damage: 4, cost: 4, ammo: 1 },
    rare:       { damage: 5, cost: 5, ammo: 'special' },
    legendary:  { damage: 6, cost: 6, ammo: 2 },
  },
} as const;
