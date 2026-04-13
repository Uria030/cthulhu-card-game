/* ========================================
   Admin Module — Shared JavaScript
   遊戲規則常數 & 工具函數
   ======================================== */

// ============================================
// API 設定
// ============================================
const ADMIN_API_BASE = (() => {
  if (window.location.hostname === 'localhost') return 'http://localhost:3001';
  return 'https://server-production-fc4f.up.railway.app';
})();
window.ADMIN_API_BASE = ADMIN_API_BASE;

// ============================================
// 認證檢查（在非登入頁面執行）
// ============================================
function checkAdminAuth() {
  if (window.location.pathname.includes('login.html')) return;
  const token = localStorage.getItem('admin_token');
  if (!token) { window.location.href = 'login.html'; return; }
  fetch(`${ADMIN_API_BASE}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(res => { if (!res.ok) throw new Error(); }).catch(() => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.location.href = 'login.html';
  });
}
document.addEventListener('DOMContentLoaded', checkAdminAuth);

// ============================================
// API 請求輔助函數（自動帶 token）
// ============================================
async function adminFetch(url, options = {}) {
  const token = localStorage.getItem('admin_token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${ADMIN_API_BASE}${url}`, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.location.href = 'login.html';
    throw new Error('Unauthorized');
  }
  return response;
}
window.adminFetch = adminFetch;

// ============================================
// 登出函數
// ============================================
function adminLogout() {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
  window.location.href = 'login.html';
}
window.adminLogout = adminLogout;

const GAME_RULES = {
  DICE_SIDES: 20,
  ATTRIBUTE_MIN: 1,
  ATTRIBUTE_MAX: 10,
  ATTRIBUTE_CREATION_MAX: 5,
  CREATION_TOTAL_POINTS: 18,  // 18 at creation + 5 via talent tree = 23 effective
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
  CARD_COST_MIN: 0,  // Skill cards cost 0
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
  asset: { zh: '資產', en: 'Asset' },
  event: { zh: '事件', en: 'Event' },
  ally:  { zh: '盟友', en: 'Ally' },
  skill: { zh: '技能', en: 'Skill' },
};

const SLOTS = {
  one_hand:  { zh: '單手',   en: 'One Hand',  category: 'physical', note: '佔 1 手持格' },
  two_hand:  { zh: '雙手',   en: 'Two Hand',  category: 'physical', note: '佔滿 2 手持格' },
  head:      { zh: '帽子',   en: 'Head',      category: 'physical', note: '1 格' },
  body:      { zh: '身體',   en: 'Body',      category: 'physical', note: '1 格' },
  accessory: { zh: '配件',   en: 'Accessory', category: 'physical', note: '' },
  arcane:    { zh: '神秘',   en: 'Arcane',    category: 'physical', note: '2 格（待定）' },
  talent:    { zh: '天賦',   en: 'Talent',    category: 'non_physical', note: '無限制' },
  expertise: { zh: '專長',   en: 'Expertise',  category: 'non_physical', note: '無限制' },
};

const SERIES = {
  C:  { zh: '核心', en: 'Core' },
};

const CONSUME_TYPES = {
  stay:       { zh: '留在場上',     en: 'Stay in Play' },
  discard:    { zh: '進入棄牌堆',   en: 'Discard' },
  long_rest:  { zh: '長休息回復',   en: 'Long Rest Recovery' },
  short_rest: { zh: '短休息回復',   en: 'Short Rest Recovery' },
  removed:    { zh: '移除出遊戲',   en: 'Remove from Game' },
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

const COMBAT_STYLES = {
  shooting:  { code: 'shooting',  zh: '槍枝射擊', en: 'Shooting' },
  archery:   { code: 'archery',   zh: '弓術',     en: 'Archery' },
  sidearm:   { code: 'sidearm',   zh: '隨身武器', en: 'Sidearm' },
  military:  { code: 'military',  zh: '軍用武器', en: 'Military Weapons' },
  brawl:     { code: 'brawl',     zh: '搏擊',     en: 'Brawl' },
  arcane:    { code: 'arcane',    zh: '施法',     en: 'Arcane' },
  engineer:  { code: 'engineer',  zh: '工兵',     en: 'Engineer' },
  assassin:  { code: 'assassin',  zh: '暗殺',     en: 'Assassination' },
};

const COMBAT_SPECIALIZATIONS = {
  shooting_rifle:   { code: 'shooting_rifle',   parent: 'shooting', zh: '步槍專精',     en: 'Rifle' },
  shooting_smg:     { code: 'shooting_smg',     parent: 'shooting', zh: '衝鋒槍專精',   en: 'Submachine Gun' },
  shooting_dual:    { code: 'shooting_dual',    parent: 'shooting', zh: '雙槍專精',     en: 'Dual Wielding' },
  shooting_pistol:  { code: 'shooting_pistol',  parent: 'shooting', zh: '手槍專精',     en: 'Pistol' },
  archery_hunter:   { code: 'archery_hunter',   parent: 'archery',  zh: '獵手',         en: 'Hunter' },
  archery_rapid:    { code: 'archery_rapid',    parent: 'archery',  zh: '連射',         en: 'Rapid Fire' },
  archery_poison:   { code: 'archery_poison',   parent: 'archery',  zh: '毒箭',         en: 'Poison Arrow' },
  archery_silent:   { code: 'archery_silent',   parent: 'archery',  zh: '無聲射手',     en: 'Silent Shooter' },
  sidearm_dagger:   { code: 'sidearm_dagger',   parent: 'sidearm',  zh: '匕首術',       en: 'Dagger' },
  sidearm_parry:    { code: 'sidearm_parry',    parent: 'sidearm',  zh: '護身格擋',     en: 'Parry' },
  sidearm_blunt:    { code: 'sidearm_blunt',    parent: 'sidearm',  zh: '鈍擊',         en: 'Blunt Strike' },
  sidearm_street:   { code: 'sidearm_street',   parent: 'sidearm',  zh: '街頭格鬥',     en: 'Street Fighting' },
  military_twohanded: { code: 'military_twohanded', parent: 'military', zh: '雙手武器專精', en: 'Two-Handed' },
  military_defense:   { code: 'military_defense',   parent: 'military', zh: '防禦架式',     en: 'Defensive Stance' },
  military_dual:      { code: 'military_dual',      parent: 'military', zh: '雙持專精',     en: 'Dual Wielding' },
  military_polearm:   { code: 'military_polearm',   parent: 'military', zh: '長柄武器',     en: 'Polearm' },
  brawl_tavern:     { code: 'brawl_tavern',     parent: 'brawl',    zh: '酒館鬥毆者',   en: 'Tavern Brawler' },
  brawl_wrestler:   { code: 'brawl_wrestler',   parent: 'brawl',    zh: '摔角大師',     en: 'Wrestler' },
  brawl_karate:     { code: 'brawl_karate',     parent: 'brawl',    zh: '空手道',       en: 'Karate' },
  arcane_ritual:      { code: 'arcane_ritual',      parent: 'arcane', zh: '儀式',   en: 'Ritual' },
  arcane_incantation: { code: 'arcane_incantation', parent: 'arcane', zh: '咒語',   en: 'Incantation' },
  arcane_channeling:  { code: 'arcane_channeling',  parent: 'arcane', zh: '引導',   en: 'Channeling' },
  arcane_meditation:  { code: 'arcane_meditation',  parent: 'arcane', zh: '冥想',   en: 'Meditation' },
  arcane_alchemy:     { code: 'arcane_alchemy',     parent: 'arcane', zh: '煉金',   en: 'Alchemy' },
  engineer_demolition: { code: 'engineer_demolition', parent: 'engineer', zh: '爆破', en: 'Demolition' },
  engineer_trap:       { code: 'engineer_trap',       parent: 'engineer', zh: '陷阱', en: 'Trap' },
  engineer_mechanic:   { code: 'engineer_mechanic',   parent: 'engineer', zh: '機械', en: 'Mechanic' },
  assassin_execute:  { code: 'assassin_execute',  parent: 'assassin', zh: '無聲處決',   en: 'Silent Execution' },
  assassin_ambush:   { code: 'assassin_ambush',   parent: 'assassin', zh: '伏擊戰術',   en: 'Ambush' },
  assassin_hidden:   { code: 'assassin_hidden',   parent: 'assassin', zh: '暗器',       en: 'Hidden Weapon' },
};

const ENEMY_PREFERENCES = {
  nearest:      { code: 'nearest',      zh: '最近',     en: 'Nearest' },
  lowest_hp:    { code: 'lowest_hp',    zh: '血量最低', en: 'Lowest HP' },
  lowest_san:   { code: 'lowest_san',   zh: '理智最低', en: 'Lowest SAN' },
  most_clues:   { code: 'most_clues',   zh: '線索最多', en: 'Most Clues' },
  last_attacker:{ code: 'last_attacker',zh: '仇恨',     en: 'Last Attacker' },
  lowest_attr:  { code: 'lowest_attr',  zh: '屬性最低', en: 'Lowest Attribute' },
  random:       { code: 'random',       zh: '隨機',     en: 'Random' },
};

const SPELL_TYPES = {
  combat_destruction:    { code: 'combat_destruction',    zh: '戰鬥與毀滅', en: 'Combat & Destruction' },
  investigation_prophecy:{ code: 'investigation_prophecy',zh: '調查與預言', en: 'Investigation & Prophecy' },
  protection_evasion:    { code: 'protection_evasion',    zh: '防護與迴避', en: 'Protection & Evasion' },
  spacetime_planar:      { code: 'spacetime_planar',      zh: '時空與位面', en: 'Spacetime & Planar' },
  summoning_binding:     { code: 'summoning_binding',     zh: '召喚與束縛', en: 'Summoning & Binding' },
  healing_purification:  { code: 'healing_purification',  zh: '治療與淨化', en: 'Healing & Purification' },
};

const SPELL_CASTINGS = {
  ritual:       { code: 'ritual',       zh: '儀式', en: 'Ritual',       note: '+1費用, -1充能, ×1.5效果, 需額外行動點' },
  incantation:  { code: 'incantation',  zh: '咒語', en: 'Incantation',  note: '標準施法' },
  channeling:   { code: 'channeling',   zh: '引導', en: 'Channeling',   note: '持續施法, 需橫置維持' },
  meditation:   { code: 'meditation',   zh: '冥想', en: 'Meditation',   note: '-1費用, +1充能, ×0.8效果' },
  alchemy:      { code: 'alchemy',      zh: '煉金', en: 'Alchemy',      note: '產出消耗品形式法術效果' },
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
