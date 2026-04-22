/* ========================================
   Admin Module — Shared JavaScript
   遊戲規則常數 & 工具函數
   ======================================== */

// ============================================
// 版本號
// ============================================
const ADMIN_VERSION = '0.15.1+b30';

// ============================================
// 僅 admin / owner 可見的模組
// ============================================
const ADMIN_ONLY_MODULES = ['MOD-12'];

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
  CREATION_TOTAL_POINTS: 18,  // 支柱五 v0.2: 8 基礎 + 3 主陣營 + 3 副陣營 + 4 自由 = 18
  CREATION_FREE_POINTS: 4,    // 支柱五 v0.2: 八屬性化後自由分配由 5 調整為 4
  ATTRIBUTE_COUNT: 8,
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
  strength:     { id: 'strength',     zh: '力量', en: 'Strength',     abbr: 'STR', category: 'physical' },
  agility:      { id: 'agility',      zh: '敏捷', en: 'Agility',      abbr: 'DEX', category: 'physical' },
  constitution: { id: 'constitution', zh: '體質', en: 'Constitution', abbr: 'CON', category: 'physical' },
  reflex:       { id: 'reflex',       zh: '反應', en: 'Reflex',       abbr: 'REF', category: 'physical' },
  intellect:    { id: 'intellect',    zh: '智力', en: 'Intellect',    abbr: 'INT', category: 'mental'   },
  willpower:    { id: 'willpower',    zh: '意志', en: 'Willpower',    abbr: 'WIL', category: 'mental'   },
  perception:   { id: 'perception',   zh: '感知', en: 'Perception',   abbr: 'PER', category: 'mental'   },
  charisma:     { id: 'charisma',     zh: '魅力', en: 'Charisma',     abbr: 'CHA', category: 'mental'   },
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

// 支柱一 v0.2：八陣營主屬性與八屬性一對一對應，T 智力→敏捷、P 敏捷→反應，全部 isShared:false
const FACTION_ATTRIBUTE_MAP = {
  E: { attribute: 'charisma',     isShared: false },
  I: { attribute: 'intellect',    isShared: false },
  S: { attribute: 'perception',   isShared: false },
  N: { attribute: 'willpower',    isShared: false },
  T: { attribute: 'agility',      isShared: false },
  F: { attribute: 'strength',     isShared: false },
  J: { attribute: 'constitution', isShared: false },
  P: { attribute: 'reflex',       isShared: false },
};

const MBTI_TYPES = {
  INTJ: { code: 'INTJ', zh: '建築師',   en: 'Architect',    group: 'Analysts' },
  INTP: { code: 'INTP', zh: '邏輯學家', en: 'Logician',     group: 'Analysts' },
  ENTJ: { code: 'ENTJ', zh: '指揮官',   en: 'Commander',    group: 'Analysts' },
  ENTP: { code: 'ENTP', zh: '辯論家',   en: 'Debater',      group: 'Analysts' },
  INFJ: { code: 'INFJ', zh: '提倡者',   en: 'Advocate',     group: 'Diplomats' },
  INFP: { code: 'INFP', zh: '調停者',   en: 'Mediator',     group: 'Diplomats' },
  ENFJ: { code: 'ENFJ', zh: '主人公',   en: 'Protagonist',  group: 'Diplomats' },
  ENFP: { code: 'ENFP', zh: '競選者',   en: 'Campaigner',   group: 'Diplomats' },
  ISTJ: { code: 'ISTJ', zh: '物流師',   en: 'Logistician',  group: 'Sentinels' },
  ISFJ: { code: 'ISFJ', zh: '守衛者',   en: 'Defender',     group: 'Sentinels' },
  ESTJ: { code: 'ESTJ', zh: '總經理',   en: 'Executive',    group: 'Sentinels' },
  ESFJ: { code: 'ESFJ', zh: '執政官',   en: 'Consul',       group: 'Sentinels' },
  ISTP: { code: 'ISTP', zh: '鑑賞家',   en: 'Virtuoso',     group: 'Explorers' },
  ISFP: { code: 'ISFP', zh: '探險家',   en: 'Adventurer',   group: 'Explorers' },
  ESTP: { code: 'ESTP', zh: '企業家',   en: 'Entrepreneur', group: 'Explorers' },
  ESFP: { code: 'ESFP', zh: '表演者',   en: 'Entertainer',  group: 'Explorers' },
};

// 依四字碼計算屬性基礎 14 點：基礎 8（八屬性各 1）+ 主陣營主屬性 +3 + 三副陣營各 +1
// 回傳：{ attrs, totalAllocated, freePoints } — freePoints 為剩餘自由分配點數（目標 18）
function calculateBaseAttributes(mbti) {
  if (!mbti || mbti.length !== 4) return null;
  const attrs = {
    strength: 1, agility: 1, constitution: 1, reflex: 1,
    intellect: 1, willpower: 1, perception: 1, charisma: 1
  };
  const letters = mbti.split('');
  const mainAttr = FACTION_ATTRIBUTE_MAP[letters[0]]?.attribute;
  if (mainAttr) attrs[mainAttr] += 3;
  for (let i = 1; i < 4; i++) {
    const subAttr = FACTION_ATTRIBUTE_MAP[letters[i]]?.attribute;
    if (subAttr) attrs[subAttr] += 1;
  }
  const totalAllocated = Object.values(attrs).reduce((a, b) => a + b, 0);
  const freePoints = 18 - totalAllocated;
  return { attrs, totalAllocated, freePoints };
}

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

// ============================================
// 地點設計器常數 (MOD-08)
// ============================================
const LOCATION_SCALES = {
  room:    { name_zh: '房間級', name_en: 'Room',    example: '宅邸的各個房間' },
  block:   { name_zh: '街區級', name_en: 'Block',   example: '城鎮的各個區域' },
  city:    { name_zh: '城市級', name_en: 'City',    example: '不同城鎮之間' },
  country: { name_zh: '跨國級', name_en: 'Country', example: '不同國家之間' },
};

const TRAVEL_COST_TYPES = {
  action_point: { name_zh: '行動點', name_en: 'Action Point', note: '地點內行動' },
  time:         { name_zh: '時間',   name_en: 'Time',         note: '大尺度場景的地點間移動' },
};

const LOCATION_ART_TYPES = {
  none:          { name_zh: '無視覺素材',     name_en: 'None' },
  image_url:     { name_zh: '上傳圖片',       name_en: 'Uploaded Image' },
  svg_generated: { name_zh: 'AI 生成 SVG',   name_en: 'AI Generated SVG' },
  svg_custom:    { name_zh: '自訂 SVG',      name_en: 'Custom SVG' },
};

const REVEAL_CONDITION_TYPES = {
  perception_threshold: { name_zh: '感知門檻',     name_en: 'Perception Threshold', note: '進入地點時自動檢查' },
  investigation_count:  { name_zh: '調查次數',     name_en: 'Investigation Count',  note: '累積調查成功 N 次' },
  manual:               { name_zh: '手動揭露',     name_en: 'Manual',               note: '關卡編輯器指定觸發條件' },
  none:                 { name_zh: '無條件',       name_en: 'None',                 note: '進入地點即顯示' },
};

const REVEAL_REWARD_TYPES = {
  narrative_only: { name_zh: '純敘事', name_en: 'Narrative Only', note: '無機制效果' },
  clue:           { name_zh: '線索',   name_en: 'Clue',           note: '給予線索' },
  card:           { name_zh: '卡片',   name_en: 'Card',           note: '給予特定卡片' },
  effect:         { name_zh: '效果',   name_en: 'Effect',         note: '觸發其他效果' },
};

const TAG_CATEGORY_LABELS = {
  indoor:  { name_zh: '室內類', name_en: 'Indoor' },
  outdoor: { name_zh: '室外類', name_en: 'Outdoor' },
  special: { name_zh: '特殊類', name_en: 'Special' },
  custom:  { name_zh: '自訂類', name_en: 'Custom' },
};

// ============================================
// 城主設計器常數 (MOD-10)
// ============================================
const MYTHOS_ACTIVATION_TIMINGS = {
  investigator_phase_reaction: { name_zh: '調查員階段響應', name_en: 'Investigator Phase Reaction', note: '只能在調查員行動時響應觸發' },
  keeper_phase:                { name_zh: '敵人階段使用',   name_en: 'Keeper Phase',                note: '城主在敵人階段主動打出' },
  both:                        { name_zh: '兩者皆可',       name_en: 'Both',                        note: '任一階段都可使用' },
};

const MYTHOS_CATEGORIES = {
  summon:      { name_zh: '召喚類',     name_en: 'Summon',      icon: '👁' },
  environment: { name_zh: '環境類',     name_en: 'Environment', icon: '🌫' },
  status:      { name_zh: '狀態類',     name_en: 'Status',      icon: '☠' },
  global:      { name_zh: '全場類',     name_en: 'Global',      icon: '🌀' },
  agenda:      { name_zh: '議程類',     name_en: 'Agenda',      icon: '⏰' },
  chaos_bag:   { name_zh: '混沌袋類',   name_en: 'Chaos Bag',   icon: '🎲' },
  encounter:   { name_zh: '遭遇牌堆類', name_en: 'Encounter',   icon: '🃏' },
  cancel:      { name_zh: '響應取消類', name_en: 'Cancel',      icon: '✋' },
  narrative:   { name_zh: '純敘事',     name_en: 'Narrative',   icon: '📖' },
  general:     { name_zh: '其他/混合',  name_en: 'General',     icon: '❓' },
};

const MYTHOS_INTENSITIES = {
  small:  { name_zh: '小型事件', name_en: 'Small',  cost_range: '1-2', color: '#5A5A52' },
  medium: { name_zh: '中型事件', name_en: 'Medium', cost_range: '3-4', color: '#4A7C9B' },
  large:  { name_zh: '大型事件', name_en: 'Large',  cost_range: '5-6', color: '#C9A84C' },
  epic:   { name_zh: '史詩事件', name_en: 'Epic',   cost_range: '7+',  color: '#B84C4C' },
};

const ENCOUNTER_TYPES = {
  thriller:  { name_zh: '驚悚',     name_en: 'Thriller',  desc_zh: '陷阱、突發事件' },
  choice:    { name_zh: '選擇困境', name_en: 'Choice',    desc_zh: '道德抉擇' },
  trade:     { name_zh: '交易',     name_en: 'Trade',     desc_zh: '提供交換機會' },
  puzzle:    { name_zh: '謎題',     name_en: 'Puzzle',    desc_zh: '智力挑戰' },
  social:    { name_zh: '社交',     name_en: 'Social',    desc_zh: 'NPC 互動' },
  discovery: { name_zh: '發現',     name_en: 'Discovery', desc_zh: '揭露隱藏資訊' },
};

// 神話卡動作代碼（每個動作有自己的 params 結構）
const MYTHOS_ACTION_CODES = {
  // 召喚類
  summon_monster:         { category: 'summon',      name_zh: '召喚怪物',          params: ['family_code','quantity','base_tier','location_rule'] },
  spawn_at_location:      { category: 'summon',      name_zh: '在地點生成標記',     params: ['token_type','location_rule'] },
  // 議程類
  advance_agenda:         { category: 'agenda',      name_zh: '推進議程',          params: ['doom_tokens'] },
  reveal_act:             { category: 'agenda',      name_zh: '強制翻面目標牌堆',   params: [] },
  // 環境類
  environment_change:     { category: 'environment', name_zh: '環境改變',          params: ['change_type','target_location_rule'] },
  disconnect_location:    { category: 'environment', name_zh: '斷開地點連接',      params: ['location_rule'] },
  // 狀態類
  inflict_status:         { category: 'status',      name_zh: '施加狀態',          params: ['status_code','value','target_rule'] },
  remove_buff:            { category: 'status',      name_zh: '移除正面狀態',      params: ['buff_code','target_rule'] },
  // 全場類
  damage_all:             { category: 'global',      name_zh: '全場傷害',          params: ['damage_physical','damage_horror','target_rule'] },
  force_check_all:        { category: 'global',      name_zh: '全場強制檢定',      params: ['check_attribute','check_dc','failure_effect'] },
  // 混沌袋類
  modify_chaos_bag:       { category: 'chaos_bag',   name_zh: '混沌袋操作',        params: ['operation','token_type','quantity'] },
  // 遭遇牌堆類
  draw_encounter:         { category: 'encounter',   name_zh: '強制抽遭遇卡',      params: ['count','resolve_immediately'] },
  shuffle_encounter_deck: { category: 'encounter',   name_zh: '重洗遭遇牌堆',      params: [] },
  // 響應取消類
  cancel_player_action:   { category: 'cancel',      name_zh: '取消玩家行動',      params: ['action_type','additional_penalty'] },
  force_reroll:           { category: 'cancel',      name_zh: '強制重擲',          params: ['target_rule','use_worse_result'] },
  // 敘事類
  narrative_only:         { category: 'narrative',   name_zh: '純敘事',            params: ['text'] },
  set_flag:               { category: 'narrative',   name_zh: '設定旗標',          params: ['flag_key','flag_value'] },
};

// 目標規則
const TARGET_RULES = {
  all_investigators:      { name_zh: '所有調查員',           scope: 'investigator' },
  nearest_investigator:   { name_zh: '最近的調查員',         scope: 'investigator' },
  lowest_hp:              { name_zh: '血量最低的調查員',      scope: 'investigator' },
  lowest_san:             { name_zh: '理智最低的調查員',      scope: 'investigator' },
  most_clues:             { name_zh: '線索最多的調查員',      scope: 'investigator' },
  random_investigator:    { name_zh: '隨機調查員',           scope: 'investigator' },
  last_attacker:          { name_zh: '最後攻擊者',           scope: 'investigator' },
  all_locations:          { name_zh: '所有地點',             scope: 'location' },
  nearest_to_clue:        { name_zh: '最靠近線索的地點',      scope: 'location' },
  random_location:        { name_zh: '隨機地點',             scope: 'location' },
  connected_locations:    { name_zh: '所有相連地點',         scope: 'location' },
  keeper_choice:          { name_zh: '城主選擇',             scope: 'both' },
};

// 遭遇卡選項效果代碼
const ENCOUNTER_EFFECT_CODES = {
  gain_clue:       { name_zh: '獲得線索',       params: ['amount'] },
  lose_clue:       { name_zh: '失去線索',       params: ['amount'] },
  gain_resource:   { name_zh: '獲得資源',       params: ['amount'] },
  lose_resource:   { name_zh: '失去資源',       params: ['amount'] },
  damage:          { name_zh: '承受物理傷害',   params: ['amount'] },
  horror:          { name_zh: '承受恐懼傷害',   params: ['amount'] },
  heal_damage:     { name_zh: '回復 HP',       params: ['amount'] },
  heal_horror:     { name_zh: '回復 SAN',      params: ['amount'] },
  draw_card:       { name_zh: '抽牌',           params: ['amount'] },
  discard_card:    { name_zh: '棄牌',           params: ['amount','rule'] },
  gain_card:       { name_zh: '獲得特定卡片',   params: ['card_def_id'] },
  inflict_status:  { name_zh: '施加狀態',       params: ['status_code','value'] },
  remove_status:   { name_zh: '移除狀態',       params: ['status_code'] },
  set_flag:        { name_zh: '設定劇情旗標',   params: ['flag_key','flag_value'] },
  advance_agenda:  { name_zh: '推進議程',       params: ['doom_tokens'] },
  gain_xp:         { name_zh: '獲得經驗值',     params: ['amount'] },
  custom:          { name_zh: '自訂效果',       params: ['description'] },
};

// 環境改變類型
const ENVIRONMENT_CHANGE_TYPES = {
  darkness:   { name_zh: '黑暗',     name_en: 'Darkness' },
  fire:       { name_zh: '失火',     name_en: 'Fire' },
  haunting:   { name_zh: '鬧鬼',     name_en: 'Haunting' },
  disconnect: { name_zh: '斷開連接', name_en: 'Disconnect' },
  flood:      { name_zh: '淹水',     name_en: 'Flood' },
  collapse:   { name_zh: '崩塌',     name_en: 'Collapse' },
};

// 混沌袋標記類型（用於 modify_chaos_bag）
const CHAOS_BAG_TOKENS = {
  cultist:        { name_zh: '邪教徒',     name_en: 'Cultist' },
  skull:          { name_zh: '骷髏',       name_en: 'Skull' },
  tablet:         { name_zh: '石版',       name_en: 'Tablet' },
  elder_thing:    { name_zh: '遠古邪物',   name_en: 'Elder Thing' },
  elder_sign:     { name_zh: '遠古印記',   name_en: 'Elder Sign' },
  auto_fail:      { name_zh: '自動失敗',   name_en: 'Auto Fail' },
  bless:          { name_zh: '祝福',       name_en: 'Bless' },
  curse:          { name_zh: '詛咒',       name_en: 'Curse' },
  zero:           { name_zh: '0',          name_en: '0' },
  minus_one:      { name_zh: '-1',         name_en: '-1' },
  minus_two:      { name_zh: '-2',         name_en: '-2' },
  minus_three:    { name_zh: '-3',         name_en: '-3' },
  minus_four:     { name_zh: '-4',         name_en: '-4' },
  minus_five:     { name_zh: '-5',         name_en: '-5' },
};

// 響應觸發條件
const RESPONSE_TRIGGERS = {
  investigator_attacks:    { name_zh: '調查員攻擊時' },
  investigator_moves:      { name_zh: '調查員移動時' },
  investigator_investigates:{ name_zh: '調查員調查時' },
  investigator_draws_card: { name_zh: '調查員抽牌時' },
  investigator_succeeds:   { name_zh: '調查員檢定成功時' },
  investigator_fails:      { name_zh: '調查員檢定失敗時' },
  monster_defeated:        { name_zh: '怪物被擊敗時' },
  agenda_advance:          { name_zh: '議程推進時' },
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

// ============================================
// MOD-09 鍛造與製作
// ============================================

const MATERIAL_CATEGORIES = {
  mineral: { code: 'mineral', zh: '礦物',     en: 'Mineral',      color: '#8B7355', icon: '🪨', theme: '堅硬、鋒利、防護' },
  wood:    { code: 'wood',    zh: '木材',     en: 'Wood',         color: '#6B4423', icon: '🪵', theme: '結構、支撐、效率' },
  insect:  { code: 'insect',  zh: '蟲類',     en: 'Insect',       color: '#556B2F', icon: '🐛', theme: '毒素、寄生、腐蝕' },
  fish:    { code: 'fish',    zh: '魚類',     en: 'Fish',         color: '#4A7C9B', icon: '🐟', theme: '滑溜、適應、恢復' },
  monster: { code: 'monster', zh: '怪物素材', en: 'Monster Part', color: '#7B4EA3', icon: '👁', theme: '超自然、力量、恐懼' },
};

const MATERIAL_VALUE_TABLE = [
  { levelMin: 1,  levelMax: 2,  sv: 1 },
  { levelMin: 3,  levelMax: 4,  sv: 2 },
  { levelMin: 5,  levelMax: 6,  sv: 3 },
  { levelMin: 7,  levelMax: 8,  sv: 5 },
  { levelMin: 9,  levelMax: 10, sv: 8 },
];

/**
 * 依素材等級取得 SV（素材價值）
 * @param {number} level - 素材等級 1~10
 * @returns {number}
 */
function getMaterialSV(level) {
  const entry = MATERIAL_VALUE_TABLE.find(e => level >= e.levelMin && level <= e.levelMax);
  return entry ? entry.sv : 1;
}

/**
 * 鍛造費用計算：V ÷ SV，向上進位
 * @param {number} affixValue - 詞條 V 值
 * @param {number} materialLevel - 素材等級 1~10
 * @returns {number} 所需素材數量
 */
function calcForgingQuantity(affixValue, materialLevel) {
  const sv = getMaterialSV(materialLevel);
  return Math.ceil(affixValue / sv);
}

const APPLICABLE_SUBTYPES = {
  weapon_melee:  { zh: '近戰武器',     en: 'Melee Weapon' },
  weapon_ranged: { zh: '遠程物理武器', en: 'Ranged Weapon' },
  weapon_arcane: { zh: '戰鬥法術',     en: 'Arcane Weapon' },
  arcane_item:   { zh: '魔法道具',     en: 'Arcane Item' },
  item:          { zh: '一般道具',     en: 'Item' },
  consumable:    { zh: '消耗品',       en: 'Consumable' },
  light_source:  { zh: '光源',         en: 'Light Source' },
  all_asset:     { zh: '全資產（通用）', en: 'All Asset' },
};

const RECIPE_UNLOCK_TYPES = {
  default:        { zh: '初始已知',       en: 'Default' },
  exploration:    { zh: '場景探索',       en: 'Exploration' },
  faction_talent: { zh: '陣營天賦',       en: 'Faction Talent' },
  story_event:    { zh: '劇情事件',       en: 'Story Event' },
  quest_reward:   { zh: '任務獎勵',       en: 'Quest Reward' },
  hidden:         { zh: '隱藏（待解鎖）', en: 'Hidden' },
};

const AFFIX_TIER_MODES = {
  scaling: { zh: '階級式（+1/+2/+3）', en: 'Scaling' },
  fixed:   { zh: '固定效果',            en: 'Fixed' },
  choice:  { zh: '選一選項',            en: 'Choice' },
};

const AFFIX_DESIGN_STATUS = {
  pending:  { zh: '待設計', en: 'Pending',  color: '#8b6b3a' },
  partial:  { zh: '部分完成', en: 'Partial', color: '#c9a84c' },
  complete: { zh: '已完成', en: 'Complete', color: '#6b9c5a' },
};

// ============================================
// 模組使用說明 Modal
// ============================================

let _moduleHelpData = null;

async function _loadModuleHelp() {
  if (_moduleHelpData) return _moduleHelpData;
  try {
    const res = await fetch('data/module-help.json', { cache: 'no-cache' });
    _moduleHelpData = await res.json();
    return _moduleHelpData;
  } catch (e) {
    console.error('載入 module-help.json 失敗', e);
    return {};
  }
}

function _ensureHelpModalDOM() {
  if (document.getElementById('moduleHelpModal')) return;
  const overlay = document.createElement('div');
  overlay.className = 'help-modal-overlay';
  overlay.id = 'moduleHelpModal';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModuleHelp(); });
  overlay.innerHTML = `
    <div class="help-modal">
      <div class="help-modal-header">
        <span class="h-code" id="helpModalCode">—</span>
        <h2 id="helpModalTitle">—</h2>
        <button class="h-close" onclick="closeModuleHelp()" aria-label="關閉">×</button>
      </div>
      <div class="help-modal-tabs" id="helpModalTabs"></div>
      <div class="help-modal-body" id="helpModalBody"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  // ESC 關閉
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('show')) closeModuleHelp();
  });
}

/**
 * 開啟指定模組的使用說明
 * @param {string} code - 如 'MOD-09' 或 'SIM-01'
 */
async function openModuleHelp(code) {
  _ensureHelpModalDOM();
  const data = await _loadModuleHelp();
  const info = data[code];
  const overlay = document.getElementById('moduleHelpModal');
  const titleEl = document.getElementById('helpModalTitle');
  const codeEl = document.getElementById('helpModalCode');
  const tabsEl = document.getElementById('helpModalTabs');
  const bodyEl = document.getElementById('helpModalBody');

  codeEl.textContent = code;
  if (!info) {
    titleEl.textContent = '使用說明';
    tabsEl.innerHTML = '';
    bodyEl.innerHTML = `<div class="placeholder">尚未撰寫此模組的使用說明（${code}）。</div>`;
    overlay.classList.add('show');
    return;
  }

  titleEl.textContent = info.title || code;
  const sections = info.sections || [];
  tabsEl.innerHTML = sections.map((s, i) => `<button class="help-modal-tab${i === 0 ? ' active' : ''}" data-idx="${i}" onclick="_switchHelpTab(${i})">${s.label}</button>`).join('');
  _renderHelpSection(sections, 0);
  overlay.classList.add('show');
}

function _switchHelpTab(idx) {
  const data = _moduleHelpData;
  const code = document.getElementById('helpModalCode').textContent;
  const sections = (data && data[code] && data[code].sections) || [];
  document.querySelectorAll('.help-modal-tab').forEach(t => t.classList.toggle('active', parseInt(t.dataset.idx, 10) === idx));
  _renderHelpSection(sections, idx);
}

function _renderHelpSection(sections, idx) {
  const s = sections[idx];
  const bodyEl = document.getElementById('helpModalBody');
  if (!s) { bodyEl.innerHTML = ''; return; }
  bodyEl.innerHTML = s.html || `<div class="placeholder">（空）</div>`;
  bodyEl.scrollTop = 0;
}

function closeModuleHelp() {
  const overlay = document.getElementById('moduleHelpModal');
  if (overlay) overlay.classList.remove('show');
}

window.openModuleHelp = openModuleHelp;
window.closeModuleHelp = closeModuleHelp;
window._switchHelpTab = _switchHelpTab;

// ============================================
// 卡片敘述文法規範 v0.2（s06）：低風險自動修正 + 禁用詞掃描
// ============================================
// 規範依據：rulebook/s06_card_text_style.md Part 3 §7.1（低風險自動修正）+ Part 1 §3-5（禁用詞）。
// 原則：只對「明確句型邊界」做替換；不碰可能是卡名/風味/目標用語的情境（例如「一位調查員」中的「調查員」是目標詞，禁止替換）。

const CARD_TEXT_FORBIDDEN_TERMS = {
  // 主詞錯誤（明確語境才替換；「調查員」作為 target 是合法的，故不列入）
  '該玩家': '你',
  '我方': '你的',
  '我的': '你的',
  // 連接詞（句型重構類）
  '否則': '請改用「如果失敗,...」獨立句',
  '反之': '請改用另起獨立「如果 X,...」句',
  '及': '和',
  '跟': '和',
  // 傷害/恢復動詞
  '打他': '造成',
  '扣血': '造成 N 點傷害',
  '扣掉': '造成',
  '補血': '治癒 N 點傷害',
  '補理智': '治癒 N 點恐懼',
  '療傷': '治癒 N 點傷害',
  // 狀態操作
  '橫置': '消耗',
  '冷卻': '消耗',
  // 八屬性化前的殘留術語
  '七屬性': '八屬性',
  '七大屬性': '八大屬性',
  '反射神經': '反應',
  // 取消/忽略/預防混用
  '無視該次': '（Cancel 用「取消」/Ignore 用「忽略」/Prevent 用「預防」,視語意選擇）',
};

/**
 * 低風險自動修正（規範 Part 3 §7.1）：僅做「風險低」類替換,不碰句型結構。
 * @param {string} text
 * @returns {string}
 */
function normalizeCardText(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;

  // 1. 半形減號「-」→ 全形減號「−」(規範 Part 3 §2.4)
  //    僅限「空白或標點 + 減號 + 數字」的明確修正值情境,避免誤動英文專有名詞
  out = out.replace(/([\s:：,，(（+\-])-(\d)/g, (_m, pre, d) => pre + '−' + d);
  out = out.replace(/^-(\d)/g, '−$1');

  // 2. 中文數字量詞 → 阿拉伯數字（規範 Part 3 §2.1 / §2.2）
  //    僅限「數字 + 點/張/次/個」的明確量詞情境
  const CJK_NUM = { '零': '0', '一': '1', '兩': '2', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };
  out = out.replace(/([零一兩二三四五六七八九十])(點|張|次|個|名|位)/g, (_m, n, u) => (CJK_NUM[n] || n) + ' ' + u);

  // 3. 全形阿拉伯數字 → 半形阿拉伯數字（規範 Part 3 §2.1）
  out = out.replace(/[0-9]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));

  return out;
}

/**
 * 掃描卡片敘述中的禁用詞（規範 Part 1 §3-5),回傳警告清單。
 * 不修改原文,由呼叫端決定要不要顯示 / 阻擋儲存。
 * @param {string} text
 * @returns {Array<{term: string, suggestion: string, index: number}>}
 */
function scanForbiddenTerms(text) {
  if (!text || typeof text !== 'string') return [];
  const warnings = [];
  for (const [bad, good] of Object.entries(CARD_TEXT_FORBIDDEN_TERMS)) {
    let idx = text.indexOf(bad);
    while (idx !== -1) {
      warnings.push({ term: bad, suggestion: good, index: idx });
      idx = text.indexOf(bad, idx + bad.length);
    }
  }
  return warnings;
}

window.normalizeCardText = normalizeCardText;
window.scanForbiddenTerms = scanForbiddenTerms;
window.CARD_TEXT_FORBIDDEN_TERMS = CARD_TEXT_FORBIDDEN_TERMS;
