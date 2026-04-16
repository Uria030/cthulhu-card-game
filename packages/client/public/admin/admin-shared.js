/* ========================================
   Admin Module — Shared JavaScript
   遊戲規則常數 & 工具函數
   ======================================== */

// ============================================
// 版本號
// ============================================
const ADMIN_VERSION = '0.6.1';

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
document.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
  // 在 nav 標題列注入版本號
  const nav = document.querySelector('.admin-nav');
  if (nav && !nav.querySelector('.nav-version')) {
    const ver = document.createElement('span');
    ver.className = 'nav-version';
    ver.textContent = 'v' + ADMIN_VERSION;
    ver.style.cssText = 'font-family:"JetBrains Mono",monospace;font-size:0.625rem;color:var(--text-tertiary);margin-left:auto;opacity:0.6;';
    nav.appendChild(ver);
  }
});

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
  CREATION_TOTAL_POINTS: 18,  // GDD05: 18 點創角，差額 5 點由天賦樹補回
  ATTRIBUTE_COUNT: 7,
  HP_BASE: 5,
  SAN_BASE: 5,
  getMaxHP: (con) => con * 2 + 5,
  getMaxSAN: (wil) => wil * 2 + 5,
  getModifier: (attr) => attr,  // 1:1 — 屬性值 = 修正值
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
  1: { name: '雜兵', en: 'Minion', dc: 12, hpRange: [3, 5],   dmgRange: [1, 2],  regen: 0,     spellDef: [0, 1], attacks: 1 },
  2: { name: '威脅', en: 'Threat', dc: 16, hpRange: [8, 14],  dmgRange: [2, 4],  regen: 0,     spellDef: [1, 3], attacks: 1 },
  3: { name: '精英', en: 'Elite',  dc: 20, hpRange: [18, 28], dmgRange: [3, 6],  regen: [0,1], spellDef: [3, 5], attacks: 1 },
  4: { name: '頭目', en: 'Boss',   dc: 24, hpRange: [35, 50], dmgRange: [4, 8],  regen: [1,3], spellDef: [5, 7], attacks: [2, 3] },
  5: { name: '巨頭', en: 'Titan',  dc: 28, hpRange: [55, 70], dmgRange: [6, 10], regen: [3,5], spellDef: [7, 9], attacks: [2, 3] },
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
  on_success:       { zh: '檢定成功時', en: 'On Success' },
  on_fail:          { zh: '檢定失敗時', en: 'On Fail' },
  round_start:      { zh: '回合開始時', en: 'Round Start' },
  round_end:        { zh: '回合結束時', en: 'Round End' },
  action:           { zh: '行動',       en: 'Action' },
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
  combat:       { code: 'combat',       zh: '戰鬥與毀滅', en: 'Combat & Destruction' },
  investigation:{ code: 'investigation',zh: '調查與預言', en: 'Investigation & Prophecy' },
  protection:   { code: 'protection',   zh: '防護與迴避', en: 'Protection & Evasion' },
  spacetime:    { code: 'spacetime',    zh: '時空與位面', en: 'Spacetime & Planar' },
  summoning:    { code: 'summoning',    zh: '召喚與束縛', en: 'Summoning & Binding' },
  healing:      { code: 'healing',      zh: '治療與淨化', en: 'Healing & Purification' },
};

const SPELL_CASTINGS = {
  ritual:       { code: 'ritual',       zh: '儀式', en: 'Ritual',       note: '+1費用, -1充能, ×1.5效果, 需額外行動點' },
  incantation:  { code: 'incantation',  zh: '咒語', en: 'Incantation',  note: '標準施法' },
  channeling:   { code: 'channeling',   zh: '引導', en: 'Channeling',   note: '持續施法, 需橫置維持' },
  meditation:   { code: 'meditation',   zh: '冥想', en: 'Meditation',   note: '-1費用, +1充能, ×0.8效果' },
  alchemy:      { code: 'alchemy',      zh: '煉金', en: 'Alchemy',      note: '產出消耗品形式法術效果' },
};

// ============================================
// 團隊精神常數 (MOD-04)
// ============================================
const SPIRIT_CATEGORIES = {
  combat:        { code: 'combat',        zh: '戰鬥類',         en: 'Combat',               count: 6 },
  investigation: { code: 'investigation', zh: '調查與資訊類',    en: 'Investigation & Intel', count: 4 },
  resource:      { code: 'resource',      zh: '資源與經濟類',    en: 'Resource & Economy',    count: 3 },
  growth:        { code: 'growth',        zh: '成長與系統解鎖類', en: 'Growth & Unlock',       count: 4 },
  knowledge:     { code: 'knowledge',     zh: '知識與神話類',    en: 'Knowledge & Mythos',    count: 2 },
  rhythm:        { code: 'rhythm',        zh: '團隊節奏類',     en: 'Team Rhythm',           count: 2 },
  status:        { code: 'status',        zh: '異常狀態專精類',  en: 'Status Specialization', count: 5 },
  bestiary:      { code: 'bestiary',      zh: '怪物學類',       en: 'Bestiary',              count: 7 },
};

const EFFECT_TAGS = {
  damage_boost:     { zh: '增傷',     en: 'Damage Boost' },
  damage_reduction: { zh: '減傷',     en: 'Damage Reduction' },
  healing:          { zh: '恢復',     en: 'Healing' },
  resource_gen:     { zh: '資源產出', en: 'Resource Generation' },
  card_advantage:   { zh: '卡牌優勢', en: 'Card Advantage' },
  information:      { zh: '資訊獲取', en: 'Information' },
  system_unlock:    { zh: '系統解鎖', en: 'System Unlock' },
  status_offense:   { zh: '狀態攻擊', en: 'Status Offense' },
  status_defense:   { zh: '狀態防禦', en: 'Status Defense' },
  chaos_control:    { zh: '混沌操控', en: 'Chaos Control' },
  action_economy:   { zh: '行動經濟', en: 'Action Economy' },
  team_synergy:     { zh: '團隊協作', en: 'Team Synergy' },
};

const TEAM_SPIRIT_RULES = {
  MAX_SELECTED: 7,
  MAX_DEPTH: 5,
  ADOPT_COST: 1,
  DEPTH_COST: 1,
  TOTAL_COST_PER_SPIRIT: 6,
  CANDIDATE_POOL: 32,
};

// ============================================
// 怪物系統常數 (MOD-03)
// ============================================
const MONSTER_TIERS = {
  1: { code: 'minion', name_zh: '雜兵', name_en: 'Minion', color: '#5A5A52' },
  2: { code: 'threat', name_zh: '威脅', name_en: 'Threat', color: '#4A7C9B' },
  3: { code: 'elite',  name_zh: '精英', name_en: 'Elite',  color: '#C9A84C' },
  4: { code: 'boss',   name_zh: '頭目', name_en: 'Boss',   color: '#B84C4C' },
  5: { code: 'titan',  name_zh: '巨頭', name_en: 'Titan',  color: '#7B4EA3' },
};

const MONSTER_KEYWORDS = {
  swift:              { category:'movement',    name_zh:'快速',     name_en:'Swift',             effect_zh:'每回合移動 2 格' },
  flying:             { category:'movement',    name_zh:'飛行',     name_en:'Flying',            effect_zh:'下回合直接出現在目標地點' },
  hunter:             { category:'engagement',  name_zh:'獵手',     name_en:'Hunter',            effect_zh:'移動進入交戰後立刻額外攻擊一次' },
  massive:            { category:'engagement',  name_zh:'巨大',     name_en:'Massive',           effect_zh:'與地點中所有調查員交戰' },
  apathetic:          { category:'engagement',  name_zh:'冷漠',     name_en:'Apathetic',         effect_zh:'不主動與調查員交戰' },
  crush:              { category:'death_effect', name_zh:'壓垮',    name_en:'Crush',             effect_zh:'被擊敗後同地點閃避檢定，失敗受傷' },
  curse_on_death:     { category:'death_effect', name_zh:'詛咒',    name_en:'Curse on Death',    effect_zh:'被擊敗後意志檢定，失敗受恐懼' },
  haunting:           { category:'death_effect', name_zh:'鬧鬼',    name_en:'Haunting',          effect_zh:'死亡後附著地點，調查失敗復活' },
  physical_resistance:{ category:'defense',     name_zh:'物理抗性', name_en:'Physical Resistance', effect_zh:'減免物理傷害' },
  physical_immunity:  { category:'defense',     name_zh:'物理免疫', name_en:'Physical Immunity',   effect_zh:'不受物理傷害' },
  fire_resistance:    { category:'defense',     name_zh:'火屬性抗性', name_en:'Fire Resistance',   effect_zh:'減免火屬性傷害' },
  ice_resistance:     { category:'defense',     name_zh:'冰屬性抗性', name_en:'Ice Resistance',    effect_zh:'減免冰屬性傷害' },
  electric_resistance:{ category:'defense',     name_zh:'雷屬性抗性', name_en:'Electric Resistance',effect_zh:'減免雷屬性傷害' },
  swarm:              { category:'special',     name_zh:'群體',     name_en:'Swarm',             effect_zh:'指定數量的分身一起行動' },
};

const AI_PREFERENCES = {
  nearest:      { name_zh:'最近',     name_en:'Nearest',       desc_zh:'追蹤最近的調查員' },
  lowest_hp:    { name_zh:'血量最低', name_en:'Lowest HP',     desc_zh:'追蹤 HP 最低的調查員' },
  lowest_san:   { name_zh:'理智最低', name_en:'Lowest SAN',    desc_zh:'追蹤 SAN 最低的調查員' },
  most_clues:   { name_zh:'線索最多', name_en:'Most Clues',    desc_zh:'追蹤持有最多線索的調查員' },
  last_attacker:{ name_zh:'仇恨',     name_en:'Last Attacker', desc_zh:'追蹤上回合攻擊過牠的調查員' },
  lowest_attr:  { name_zh:'屬性最低', name_en:'Lowest Attr',   desc_zh:'追蹤指定屬性最低的調查員' },
  random:       { name_zh:'隨機',     name_en:'Random',        desc_zh:'隨機選擇' },
};

const ATTACK_ELEMENTS = {
  physical: { name_zh:'物理', name_en:'Physical', color:'#8A8778' },
  fire:     { name_zh:'火',   name_en:'Fire',     color:'#B84C4C' },
  ice:      { name_zh:'冰',   name_en:'Ice',      color:'#4A7C9B' },
  electric: { name_zh:'雷',   name_en:'Electric',  color:'#C9A84C' },
  arcane:   { name_zh:'神秘', name_en:'Arcane',    color:'#7B4EA3' },
};

const NEGATIVE_STATUSES = {
  poison:          { name_zh:'中毒', name_en:'Poison' },
  bleed:           { name_zh:'流血', name_en:'Bleed' },
  burning:         { name_zh:'燃燒', name_en:'Burning' },
  frozen:          { name_zh:'冷凍', name_en:'Frozen' },
  darkness:        { name_zh:'黑暗', name_en:'Darkness' },
  disarm:          { name_zh:'繳械', name_en:'Disarm' },
  doom_status:     { name_zh:'毀滅', name_en:'Doom' },
  fatigue:         { name_zh:'疲勞', name_en:'Fatigue' },
  madness:         { name_zh:'發瘋', name_en:'Madness' },
  marked:          { name_zh:'標記', name_en:'Marked' },
  vulnerable:      { name_zh:'脆弱', name_en:'Vulnerable' },
  silence:         { name_zh:'沈默', name_en:'Silence' },
  weakness_status: { name_zh:'無力', name_en:'Weakness' },
  wet:             { name_zh:'潮濕', name_en:'Wet' },
  weakened:        { name_zh:'弱化', name_en:'Weakened' },
};

const POSITIVE_STATUSES = {
  empowered:    { name_zh:'強化', name_en:'Empowered' },
  armor:        { name_zh:'護甲', name_en:'Armor' },
  ward:         { name_zh:'護盾', name_en:'Ward' },
  stealth:      { name_zh:'隱蔽', name_en:'Stealth' },
  haste:        { name_zh:'加速', name_en:'Haste' },
  regeneration: { name_zh:'再生', name_en:'Regeneration' },
};

const FEAR_TYPES = {
  first_sight: { name_zh:'初見', name_en:'First Sight' },
  per_round:   { name_zh:'每回合', name_en:'Per Round' },
  on_reveal:   { name_zh:'揭露時', name_en:'On Reveal' },
};

const MOVEMENT_TYPES = {
  ground:      { name_zh:'地面', name_en:'Ground' },
  flying:      { name_zh:'飛行', name_en:'Flying' },
  dimensional: { name_zh:'維度跳躍', name_en:'Dimensional' },
  burrowing:   { name_zh:'地底鑽行', name_en:'Burrowing' },
};

const FAMILY_EMOJIS = {
  house_cthulhu:'🐙', house_hastur:'👁', house_shub:'🐐', house_nyarlathotep:'🎭',
  house_yog:'🌀', house_cthugha:'🔥', house_yig:'🐍', fallen:'🕯', undying:'💀', independent:'⚡',
};

const TIER_DEFAULTS = {
  1: { dc:12, hp_base:4,  damage_physical:1, spell_defense:0, attacks_per_round:1 },
  2: { dc:16, hp_base:11, damage_physical:3, spell_defense:2, attacks_per_round:1 },
  3: { dc:20, hp_base:23, damage_physical:4, spell_defense:4, attacks_per_round:1 },
  4: { dc:24, hp_base:42, damage_physical:6, spell_defense:6, attacks_per_round:2 },
  5: { dc:28, hp_base:62, damage_physical:8, spell_defense:8, attacks_per_round:2 },
};

const DEFAULT_STATUS_DESCRIPTIONS = [
  { hp_threshold:100, description_zh:'牠看起來毫髮無傷。', sort_order:5 },
  { hp_threshold:75,  description_zh:'牠似乎受了一些傷，但行動不受影響。', sort_order:4 },
  { hp_threshold:50,  description_zh:'牠的動作開始遲緩，傷口清晰可見。', sort_order:3 },
  { hp_threshold:25,  description_zh:'牠拖著殘破的身軀，每一步都在顫抖。', sort_order:2 },
  { hp_threshold:0,   description_zh:'牠轟然倒下，不再動彈。', sort_order:1 },
];

// ============================================
// 天賦樹常數 (MOD-02)
// ============================================
const TALENT_TREE_RULES = {
  MAX_LEVEL: 12,
  BRANCHES_PER_TREE: 3,
  TREES_COUNT: 8,
  BRANCH_CHOICE_LEVEL: 3,
  MILESTONE_LEVELS: [3, 6],
  PROFICIENCY_LEVELS: [5, 8],
  ATTRIBUTE_BOOST_LEVELS: [2, 7, 10, 11, 12],
  TALENT_CARD_LEVEL: 9,
  ULTIMATE_LEVEL: 12,
  TOTAL_TALENT_POINTS_PER_BRANCH: 16,
  STARTING_ATTRIBUTE_POINTS: 18,
  ATTRIBUTE_BOOSTS_COUNT: 5,
};

const NODE_TYPES = {
  passive:         { zh: '被動能力',   en: 'Passive',         color: '#C9A84C' },
  attribute_boost: { zh: '屬性提升',   en: 'Attribute Boost', color: '#4A7C9B' },
  proficiency:     { zh: '專精解鎖',   en: 'Proficiency',     color: '#B84C4C' },
  talent_card:     { zh: '天賦卡解鎖', en: 'Talent Card',     color: '#7B4EA3' },
  branch_choice:   { zh: '分支選擇',   en: 'Branch Choice',   color: '#2D8B6F' },
  milestone:       { zh: '質變能力',   en: 'Milestone',       color: '#C9A84C' },
  ultimate:        { zh: '終極天賦',   en: 'Ultimate',        color: '#FFD700' },
};

const FACTION_ATTRIBUTES = {
  E: { primary: 'charisma',     secondary: 'strength',   zh: '號令', en: 'Herald',  color: '#C9A84C' },
  I: { primary: 'intellect',    secondary: 'willpower',  zh: '深淵', en: 'Abyss',   color: '#3A5FA0' },
  S: { primary: 'perception',   secondary: 'strength',   zh: '鐵證', en: 'Witness', color: '#8B5E3C' },
  N: { primary: 'willpower',    secondary: 'intellect',  zh: '天啟', en: 'Oracle',  color: '#7B4EA3' },
  T: { primary: 'intellect',    secondary: 'perception', zh: '解析', en: 'Cipher',  color: '#4A7C9B' },
  F: { primary: 'willpower',    secondary: 'charisma',   zh: '聖燼', en: 'Ember',   color: '#B84C4C' },
  J: { primary: 'constitution', secondary: 'strength',   zh: '鐵壁', en: 'Bastion', color: '#6B6B6B' },
  P: { primary: 'agility',      secondary: 'perception', zh: '流影', en: 'Flux',    color: '#2D8B6F' },
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
