/* ========================================
   Admin Module — Shared JavaScript
   遊戲規則常數 & 工具函數
   ======================================== */

const GAME_RULES = {
  DICE_SIDES: 20,
  ATTRIBUTE_MIN: 1,
  ATTRIBUTE_MAX: 10,
  ATTRIBUTE_CREATION_MAX: 5,
  CREATION_TOTAL_POINTS: 21,
  ATTRIBUTE_COUNT: 7,
  HP_BASE: 5,
  SAN_BASE: 5,
  getMaxHP: (con) => con * 2 + 5,
  getMaxSAN: (wil) => wil * 2 + 5,
  getModifier: (attr) => Math.floor(attr / 2),
  ACTIONS_PER_TURN: 3,
  HAND_LIMIT: 8,
  CARDS_DRAWN_PER_TURN: 1,
  STARTING_RESOURCES: 5,
  RESOURCE_PER_TURN: 1,
  CARD_COST_MIN: 1,
  CARD_COST_MAX: 6,
};

const ATTRIBUTES = {
  strength:     { id: 'strength',     zh: '力量', en: 'Strength',     abbr: 'STR' },
  agility:      { id: 'agility',      zh: '敏捷', en: 'Agility',      abbr: 'DEX' },
  constitution: { id: 'constitution', zh: '體質', en: 'Constitution', abbr: 'CON' },
  intellect:    { id: 'intellect',    zh: '智力', en: 'Intellect',    abbr: 'INT' },
  willpower:    { id: 'willpower',    zh: '意志', en: 'Willpower',    abbr: 'WIL' },
  perception:   { id: 'perception',   zh: '感知', en: 'Perception',   abbr: 'PER' },
  charisma:     { id: 'charisma',     zh: '魅力', en: 'Charisma',     abbr: 'CHA' },
};

const FACTIONS = {
  E: { code: 'E', zh: '號令', en: 'The Herald', color: '#C9A84C' },
  I: { code: 'I', zh: '深淵', en: 'The Abyss',  color: '#3A5FA0' },
  S: { code: 'S', zh: '鐵證', en: 'The Witness', color: '#8B5E3C' },
  N: { code: 'N', zh: '天啟', en: 'The Oracle',  color: '#7B4EA3' },
  T: { code: 'T', zh: '解析', en: 'The Cipher',  color: '#4A7C9B' },
  F: { code: 'F', zh: '聖燼', en: 'The Ember',   color: '#B84C4C' },
  J: { code: 'J', zh: '鐵壁', en: 'The Bastion', color: '#6B6B6B' },
  P: { code: 'P', zh: '流影', en: 'The Flux',    color: '#2D8B6F' },
};

const ENEMY_TIERS = {
  1: { name: '雜兵', en: 'Minion', dc: 8,  hpRange: [3, 5],   dmgRange: [1, 2] },
  2: { name: '威脅', en: 'Threat', dc: 12, hpRange: [8, 14],  dmgRange: [2, 4] },
  3: { name: '精英', en: 'Elite',  dc: 16, hpRange: [18, 28], dmgRange: [3, 6] },
  4: { name: '頭目', en: 'Boss',   dc: 20, hpRange: [35, 50], dmgRange: [4, 8] },
  5: { name: '巨頭', en: 'Titan',  dc: 24, hpRange: [55, 70], dmgRange: [6, 10] },
};

const WEAPON_TIERS = {
  1: { name: '隨身', en: 'Makeshift',  damage: 1, cost: 0 },
  2: { name: '基礎', en: 'Basic',      damage: 2, cost: 2 },
  3: { name: '標準', en: 'Standard',   damage: 3, cost: 3 },
  4: { name: '進階', en: 'Advanced',   damage: 4, cost: 4 },
  5: { name: '稀有', en: 'Rare',       damage: 5, cost: 5 },
  6: { name: '傳奇', en: 'Legendary',  damage: 6, cost: 6 },
};

const CARD_STYLES = {
  AH: { code: 'A+H', zh: '直接正面', en: 'Direct Positive' },
  AC: { code: 'A+C', zh: '直接負面', en: 'Direct Negative' },
  OH: { code: 'O+H', zh: '間接正面', en: 'Indirect Positive' },
  OC: { code: 'O+C', zh: '間接負面', en: 'Indirect Negative' },
};

const CARD_TYPES = {
  asset:      { zh: '資產', en: 'Asset' },
  event:      { zh: '事件', en: 'Event' },
  ally:       { zh: '盟友', en: 'Ally' },
  skill:      { zh: '技能', en: 'Skill' },
  weakness:   { zh: '弱點', en: 'Weakness' },
  revelation: { zh: '神啟卡', en: 'Revelation' },
  signature:  { zh: '簽名卡', en: 'Signature' },
};

const SLOTS = {
  hand:      { zh: '手持', en: 'Hand' },
  body:      { zh: '身體', en: 'Body' },
  accessory: { zh: '配件', en: 'Accessory' },
  arcane:    { zh: '神秘', en: 'Arcane' },
  ally:      { zh: '盟友', en: 'Ally' },
  none:      { zh: '無',   en: 'None' },
};

const TRIGGERS = {
  on_play:          { zh: '打出時',     en: 'On Play' },
  on_commit:        { zh: '加值投入時', en: 'On Commit' },
  on_consume:       { zh: '消費時',     en: 'On Consume' },
  on_enter:         { zh: '進場時',     en: 'On Enter' },
  on_leave:         { zh: '離場時',     en: 'On Leave' },
  on_draw:          { zh: '抽到時',     en: 'On Draw' },
  on_check_success: { zh: '檢定成功時', en: 'On Check Success' },
  on_check_fail:    { zh: '檢定失敗時', en: 'On Check Fail' },
  reaction:         { zh: '反應',       en: 'Reaction' },
  passive:          { zh: '被動',       en: 'Passive' },
  free_action:      { zh: '免費行動',   en: 'Free Action' },
};

const CHECK_METHODS = {
  dice:      { zh: '擲骰', en: 'Dice' },
  chaos_bag: { zh: '混沌袋', en: 'Chaos Bag' },
};

const COST_CURRENCIES = {
  resource:         { zh: '資源', en: 'Resource' },
  forbidden_insight:{ zh: '禁忌洞察', en: 'Forbidden Insight' },
  faith:            { zh: '信仰', en: 'Faith' },
};

/* ── 工具函數 ── */

/**
 * 計算命中率：d20 >= (DC - modifier) 的機率
 * @param {number} modifier - 屬性修正值
 * @param {number} dc - 難度等級
 * @returns {number} 0~1 之間的命中率
 */
function hitRate(modifier, dc) {
  const need = dc - modifier;
  if (need <= 1) return 1;
  if (need > 20) return 0;
  return (20 - need + 1) / 20;
}

/**
 * 格式化百分比
 * @param {number} rate - 0~1
 * @returns {string}
 */
function fmtPercent(rate) {
  return (rate * 100).toFixed(1) + '%';
}

/**
 * 範圍內隨機整數
 */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 擲 d20
 */
function rollD20() {
  return randInt(1, 20);
}
