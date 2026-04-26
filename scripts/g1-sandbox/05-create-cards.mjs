import { adminFetch, adminGet } from './api.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `g1-cards-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# G1 30 玩家卡建立 ${stamp}`);

const existing = await adminGet('/api/cards');
const existingArr = Array.isArray(existing) ? existing : (existing.cards || existing.data || []);
const existingNameSet = new Set(existingArr.map(c => c.name_zh));
log(`既有 ${existingArr.length} 張`);

// ──────── 30 張規格(對齊 Part 2 §4.1-§4.8 + Part 3 劇本氛圍)────────
// card_type ∈ {asset, event, ally, skill};slot ∈ {one_hand, two_hand, head, body, accessory, arcane, talent, expertise, none}
// 法術用 card_type='event' + spell_type/spell_casting 欄位區分;style ∈ AH/AC/OH/OC

const G1_CARDS = [
  // ── §4.1 武器資產 4 張(對齊鐵證偵探氛圍)──
  {
    series: 'G', name_zh: '.45 自動手槍', name_en: '.45 Automatic',
    faction: 'S', style: 'AC', card_type: 'asset', slot: 'one_hand',
    cost: 3, weapon_tier: 2, ammo: 6, combat_style: 'shooting',
    primary_axis_layer: 'card_name', primary_axis_value: '.45 自動手槍',
    commit_icons: { perception: 1, agility: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'attack', params: { damage: 5 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '沉重的鋼鐵在你掌心，槍口閃著冷藍的反光。子彈打在牆上不會留下海腥味。',
    effects: [{ sort_order: 0, effect_code: 'attach_to_self', trigger_type: 'on_play', duration: 'while_in_play',
      description_zh: '進入場上作為武器，以「槍枝射擊」風格進行攻擊時依此武器計算傷害。彈藥用盡後棄置。',
      description_en: 'Enters play as a weapon. When attacking with Shooting style, deal damage based on this weapon. Discard when out of ammo.',
      effect_params: { weapon_tier: 2, ammo: 6 } }],
  },
  {
    series: 'G', name_zh: '黃銅指虎', name_en: 'Brass Knuckles',
    faction: 'S', style: 'AC', card_type: 'asset', slot: 'one_hand',
    cost: 1, weapon_tier: 1, combat_style: 'brawl',
    commit_icons: { strength: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'attack', params: { damage: 3 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '當禮貌話講不通時，總有更直接的辦法。',
    effects: [{ sort_order: 0, effect_code: 'attach_to_self', trigger_type: 'on_play', duration: 'while_in_play',
      description_zh: '進入場上作為武器，以「搏擊」風格進行攻擊時依此武器計算傷害。',
      description_en: 'Enters play as a weapon. When attacking with Brawl style, deal damage based on this weapon.',
      effect_params: { weapon_tier: 1 } }],
  },
  {
    series: 'G', name_zh: '隨身短刀', name_en: 'Concealed Knife',
    faction: 'S', style: 'AC', card_type: 'asset', slot: 'one_hand',
    cost: 1, weapon_tier: 1, combat_style: 'brawl',
    commit_icons: { agility: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'attack', params: { damage: 4 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '不顯眼，但永遠在口袋裡。',
    effects: [{ sort_order: 0, effect_code: 'attach_to_self', trigger_type: 'on_play', duration: 'while_in_play',
      description_zh: '進入場上作為武器，以「搏擊」風格的近距檢定 +1。',
      description_en: 'Enters play as a weapon. Close-range Brawl tests gain +1.',
      effect_params: { weapon_tier: 1 } }],
  },
  {
    series: 'G', name_zh: '備用彈匣', name_en: 'Spare Magazine',
    faction: 'S', style: 'AH', card_type: 'asset', slot: 'accessory',
    cost: 1,
    commit_icons: { perception: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'reload_weapon', params: { ammo: 6 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '一發子彈不夠，那就再六發。',
    effects: [{ sort_order: 0, effect_code: 'noop', trigger_type: 'passive', duration: 'while_in_play',
      description_zh: '進入場上。可消費以為手槍類武器補充 6 發彈藥。',
      description_en: 'Enters play. Consume to reload 6 ammo for a pistol weapon.',
      effect_params: {} }],
  },

  // ── §4.2 防具 / 護身符 2 張 ──
  {
    series: 'G', name_zh: '厚雨衣', name_en: 'Heavy Raincoat',
    faction: 'S', style: 'AH', card_type: 'asset', slot: 'body',
    cost: 2,
    commit_icons: { constitution: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'cancel_damage', params: { amount: 5, type: 'physical' }, trigger: 'reaction', duration: 'instant' },
    flavor_text: '雨水打在風衣上，暫時擋住了不該屬於這個世界的東西。',
    effects: [{ sort_order: 0, effect_code: 'damage_reduction', trigger_type: 'passive', duration: 'while_in_play',
      description_zh: '進入場上提供物理 1 減傷。',
      description_en: 'Provides 1 physical damage reduction while in play.',
      effect_params: { amount: 1, type: 'physical' } }],
  },
  {
    series: 'G', name_zh: '搭檔遺物·懷錶', name_en: "Partner's Pocket Watch",
    faction: 'S', style: 'AH', card_type: 'asset', slot: 'accessory',
    cost: 2,
    commit_icons: { willpower: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'recover_san', params: { amount: 3 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '錶面停在三年前那個霧夜。每次你需要勇氣，就摸一摸這道刻痕。',
    effects: [{ sort_order: 0, effect_code: 'modify_test', trigger_type: 'passive', duration: 'while_in_play',
      description_zh: '進入場上。意志檢定 +1。',
      description_en: 'Enters play. +1 to Willpower tests.',
      effect_params: { attribute: 'willpower', modifier: 1 } }],
  },

  // ── §4.3 一次性事件 4 張 ──
  {
    series: 'G', name_zh: '緊急閃避', name_en: 'Emergency Dodge',
    faction: 'S', style: 'AH', card_type: 'event', slot: 'none',
    cost: 1,
    commit_icons: { reflex: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'evade_next_attack', params: {}, trigger: 'reaction', duration: 'instant' },
    flavor_text: '你險險側身，只感到爪風掠過頸側的寒意。',
    effects: [{ sort_order: 0, effect_code: 'modify_test', trigger_type: 'on_play', duration: 'instant',
      description_zh: '立即執行閃避行動，不消耗行動點;此次閃避反應檢定 +3。',
      description_en: 'Immediately perform an evade action without spending an action point. This evade reflex test gains +3.',
      effect_params: { attribute: 'reflex', modifier: 3 } }],
  },
  {
    series: 'G', name_zh: '冷靜推理', name_en: 'Cold Deduction',
    faction: 'S', style: 'OH', card_type: 'event', slot: 'none',
    cost: 0,
    commit_icons: { intellect: 1, perception: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'gain_clue', params: { amount: 1 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '在這個城市裡，最好的偵探從來不靠運氣。',
    effects: [{ sort_order: 0, effect_code: 'modify_test', trigger_type: 'on_play', duration: 'instant',
      description_zh: '本回合下次調查檢定 +2 智力。',
      description_en: 'Your next investigation check this turn gains +2 Intellect.',
      effect_params: { attribute: 'intellect', modifier: 2 } }],
  },
  {
    series: 'G', name_zh: '凝視深淵', name_en: 'Gaze the Abyss',
    faction: 'S', style: 'OC', card_type: 'event', slot: 'none',
    cost: 1,
    commit_icons: { willpower: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'gain_clue', params: { amount: 2 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '你決定看一眼。代價就是你之後再也忘不掉。',
    effects: [{ sort_order: 0, effect_code: 'modify_test', trigger_type: 'on_play', duration: 'instant',
      description_zh: '進行意志檢定 DC 12;成功時獲得 1 個線索，失敗時承受 1 點 SAN。',
      description_en: 'Make a Willpower DC 12 test. On success gain 1 clue; on failure suffer 1 SAN.',
      effect_params: { attribute: 'willpower', modifier: 0, dc: 12 } }],
  },
  {
    series: 'G', name_zh: '街角情報', name_en: 'Street Tip',
    faction: 'S', style: 'OH', card_type: 'event', slot: 'none',
    cost: 1,
    commit_icons: { charisma: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'reveal_hidden_clue', params: {}, trigger: 'on_play', duration: 'instant' },
    flavor_text: '這個街區沒有秘密，只有你還沒問對人。',
    effects: [{ sort_order: 0, effect_code: 'gain_clue', trigger_type: 'on_play', duration: 'instant',
      description_zh: '從場上任一地點獲得 1 個線索（必須有可見線索）。',
      description_en: 'Gain 1 clue from any location on the board (must have a visible clue).',
      effect_params: { amount: 1 } }],
  },

  // ── §4.4 法術 4 張(card_type='event' + spell_type)──
  {
    series: 'G', name_zh: '窺視印記', name_en: 'Mark Glimpse',
    faction: 'S', style: 'OC', card_type: 'event', slot: 'none',
    cost: 2, spell_type: 'divination', spell_casting: 'instant',
    commit_icons: { willpower: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'reveal_all_enemies', params: {}, trigger: 'on_play', duration: 'instant' },
    flavor_text: '你違背原則地閉上眼睛，試圖看見不該看的東西。',
    effects: [{ sort_order: 0, effect_code: 'modify_test', trigger_type: 'on_play', duration: 'instant',
      description_zh: '進行意志檢定 DC 13，成功時揭露目標敵人的詞綴與抗性。',
      description_en: 'Make a Willpower DC 13 test. On success, reveal target enemy keywords and resistances.',
      effect_params: { attribute: 'willpower', modifier: 0, dc: 13 } }],
  },
  {
    series: 'G', name_zh: '禁忌詞語', name_en: 'Forbidden Word',
    faction: 'S', style: 'AC', card_type: 'event', slot: 'none',
    cost: 2, spell_type: 'attack', spell_casting: 'chant',
    commit_icons: { willpower: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'attack', params: { damage: 4, element: 'arcane' }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '你不知道你怎麼會的，但這個詞自己從喉嚨裡擠出來了。',
    effects: [{ sort_order: 0, effect_code: 'attack', trigger_type: 'on_play', duration: 'instant',
      description_zh: '走混沌袋軌道，對目標造成 2 點神秘傷害;如抽到失敗標記，自身承受 1 SAN。',
      description_en: 'Resolve via chaos bag. Deal 2 arcane damage to target; on failure token, you suffer 1 SAN.',
      effect_params: { damage: 2, element: 'arcane' } }],
  },
  {
    series: 'G', name_zh: '止血咒文', name_en: 'Stanching Cantrip',
    faction: 'S', style: 'AH', card_type: 'event', slot: 'none',
    cost: 1, spell_type: 'support', spell_casting: 'gesture',
    commit_icons: { willpower: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'heal_hp', params: { amount: 4 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '搭檔教過你的，當時你笑說一輩子也用不到。',
    effects: [{ sort_order: 0, effect_code: 'heal_hp', trigger_type: 'on_play', duration: 'instant',
      description_zh: '走混沌袋軌道;成功時治癒 1 名調查員 2 點 HP。',
      description_en: 'Resolve via chaos bag. On success, heal an investigator 2 HP.',
      effect_params: { amount: 2 } }],
  },
  {
    series: 'G', name_zh: '鎮神之呼', name_en: 'Calling of the Ward',
    faction: 'S', style: 'OH', card_type: 'event', slot: 'none',
    cost: 2, spell_type: 'buff', spell_casting: 'ritual',
    commit_icons: { willpower: 1 },
    consume_enabled: true,
    consume_effect: { effect_code: 'apply_status', params: { status: 'empowered', duration: 2 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '不是禱告。是命令。',
    effects: [{ sort_order: 0, effect_code: 'apply_status', trigger_type: 'on_play', duration: 'instant',
      description_zh: '走混沌袋軌道;成功時對自己施加「神啟（empowered）」1 回合，所有檢定 +1。',
      description_en: 'Resolve via chaos bag. On success, apply Empowered to self for 1 round (+1 to all tests).',
      effect_params: { status: 'empowered', duration: 1 } }],
  },

  // ── §4.5 加值專用(屬性圖示)6 張 ──
  {
    series: 'G', name_zh: '蠻力', name_en: 'Brute Force',
    faction: 'S', style: 'AH', card_type: 'skill', slot: 'none',
    cost: 0,
    commit_icons: { strength: 2 },
    flavor_text: '說不通的，搬就對了。',
    effects: [{ sort_order: 0, effect_code: 'noop', trigger_type: 'on_play', duration: 'instant',
      description_zh: '加值用技能卡。打出時抽 1 張卡。',
      description_en: 'Skill card for committing. When played, draw 1 card.',
      effect_params: {} }],
  },
  {
    series: 'G', name_zh: '迅捷身手', name_en: 'Nimble Reflex',
    faction: 'S', style: 'AH', card_type: 'skill', slot: 'none',
    cost: 0,
    commit_icons: { agility: 2, reflex: 1 },
    flavor_text: '在這個城市，慢一秒就是死。',
    effects: [{ sort_order: 0, effect_code: 'noop', trigger_type: 'on_play', duration: 'instant',
      description_zh: '加值用技能卡。打出時拿 1 個資源。',
      description_en: 'Skill card for committing. When played, gain 1 resource.',
      effect_params: {} }],
  },
  {
    series: 'G', name_zh: '硬底子', name_en: 'Tough Body',
    faction: 'S', style: 'AH', card_type: 'skill', slot: 'none',
    cost: 0,
    commit_icons: { constitution: 2 },
    flavor_text: '一拳兩拳的，年輕時就習慣了。',
    effects: [{ sort_order: 0, effect_code: 'heal_hp', trigger_type: 'on_play', duration: 'instant',
      description_zh: '加值用技能卡。打出時治癒自己 1 HP。',
      description_en: 'Skill card for committing. When played, heal self 1 HP.',
      effect_params: { amount: 1 } }],
  },
  {
    series: 'G', name_zh: '冷靜頭腦', name_en: 'Cool Mind',
    faction: 'S', style: 'OH', card_type: 'skill', slot: 'none',
    cost: 0,
    commit_icons: { intellect: 2, willpower: 1 },
    flavor_text: '當別人慌的時候，這就是優勢。',
    effects: [{ sort_order: 0, effect_code: 'noop', trigger_type: 'on_play', duration: 'instant',
      description_zh: '加值用技能卡。打出時抽 1 張卡。',
      description_en: 'Skill card for committing. When played, draw 1 card.',
      effect_params: {} }],
  },
  {
    series: 'G', name_zh: '不屈意志', name_en: 'Iron Will',
    faction: 'S', style: 'AH', card_type: 'skill', slot: 'none',
    cost: 0,
    commit_icons: { willpower: 2, perception: 1 },
    flavor_text: '搭檔的死沒打倒他。這個小東西不行。',
    effects: [{ sort_order: 0, effect_code: 'recover_san', trigger_type: 'on_play', duration: 'instant',
      description_zh: '加值用技能卡。打出時恢復自己 1 SAN。',
      description_en: 'Skill card for committing. When played, recover self 1 SAN.',
      effect_params: { amount: 1 } }],
  },
  {
    series: 'G', name_zh: '街頭直覺', name_en: 'Street Instinct',
    faction: 'S', style: 'OH', card_type: 'skill', slot: 'none',
    cost: 0,
    commit_icons: { perception: 1, intellect: 1, charisma: 1 },
    flavor_text: '不是運氣，是十年的事務所經驗。',
    effects: [{ sort_order: 0, effect_code: 'noop', trigger_type: 'on_play', duration: 'instant',
      description_zh: '加值用技能卡（萬用感知卡）。打出時可看牌庫頂 2 張，依任意順序放回。',
      description_en: 'Skill card (versatile perception). When played, look at top 2 cards of your deck and put them back in any order.',
      effect_params: {} }],
  },

  // ── §4.6 消費強卡 4 張 ──
  {
    series: 'G', name_zh: '賭命一發', name_en: 'Last Bullet',
    faction: 'S', style: 'AC', card_type: 'event', slot: 'none',
    cost: 1,
    commit_icons: { perception: 1 },
    consume_enabled: true, consume_type: 'removed',
    consume_effect: { effect_code: 'attack', params: { damage: 8 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '只剩這一發，但你看著她的鰓笑了。',
    effects: [{ sort_order: 0, effect_code: 'attack', trigger_type: 'on_play', duration: 'instant',
      description_zh: '對目標造成 2 點傷害。可消費（移除堆）改造成 8 點傷害。',
      description_en: 'Deal 2 damage to target. Can be consumed (removed) to deal 8 damage instead.',
      effect_params: { damage: 2 } }],
  },
  {
    series: 'G', name_zh: '深呼吸', name_en: 'Deep Breath',
    faction: 'S', style: 'AH', card_type: 'event', slot: 'none',
    cost: 0,
    commit_icons: { willpower: 1 },
    consume_enabled: true, consume_type: 'removed',
    consume_effect: { effect_code: 'recover_san', params: { amount: 5 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '吸氣，數到三，吐氣。世界還在。',
    effects: [{ sort_order: 0, effect_code: 'recover_san', trigger_type: 'on_play', duration: 'instant',
      description_zh: '恢復自己 1 SAN。可消費（移除堆）改恢復 5 SAN。',
      description_en: 'Recover 1 SAN. Can be consumed (removed) to recover 5 SAN instead.',
      effect_params: { amount: 1 } }],
  },
  {
    series: 'G', name_zh: '案卷檢索', name_en: 'File Cabinet',
    faction: 'S', style: 'OH', card_type: 'event', slot: 'none',
    cost: 1,
    commit_icons: { intellect: 1 },
    consume_enabled: true, consume_type: 'removed',
    consume_effect: { effect_code: 'draw_card', params: { amount: 3 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '事務所地下室那個鐵櫃，每張紙都可能是線索。',
    effects: [{ sort_order: 0, effect_code: 'draw_card', trigger_type: 'on_play', duration: 'instant',
      description_zh: '抽 1 張卡。可消費（移除堆）改抽 3 張。',
      description_en: 'Draw 1 card. Can be consumed (removed) to draw 3 instead.',
      effect_params: { amount: 1 } }],
  },
  {
    series: 'G', name_zh: '鹽圈', name_en: 'Salt Circle',
    faction: 'S', style: 'AH', card_type: 'event', slot: 'none',
    cost: 1, spell_type: 'support', spell_casting: 'ritual',
    commit_icons: { willpower: 1 },
    consume_enabled: true, consume_type: 'removed',
    consume_effect: { effect_code: 'add_chaos_token', params: { token: 'bless', amount: 2 }, trigger: 'on_play', duration: 'instant' },
    flavor_text: '老搭檔留下的小本子裡寫的。沒想到真有用。',
    effects: [{ sort_order: 0, effect_code: 'noop', trigger_type: 'on_play', duration: 'instant',
      description_zh: '進行意志檢定 DC 11;成功獲得 1 個線索。可消費（移除堆）改加入 2 張祝福標記到混沌袋。',
      description_en: 'Make Willpower DC 11; on success gain 1 clue. Can be consumed to add 2 Bless tokens to the chaos bag.',
      effect_params: {} }],
  },

  // ── §4.7 條件式 3 張 ──
  {
    series: 'G', name_zh: '一網打盡', name_en: 'Round-Up',
    faction: 'S', style: 'AC', card_type: 'event', slot: 'none',
    cost: 2,
    commit_icons: { strength: 1 },
    consume_enabled: false,
    flavor_text: '一個人不好對付，三個一起就有節奏了。',
    effects: [{ sort_order: 0, effect_code: 'attack', trigger_type: 'on_play', duration: 'instant',
      description_zh: '對目標造成 3 點傷害;若場上敵人 ≥2 隻，改對所有敵人造成 3 點傷害。',
      description_en: 'Deal 3 damage to target. If 2+ enemies on the board, deal 3 to all enemies instead.',
      effect_params: { damage: 3 } }],
  },
  {
    series: 'G', name_zh: '夜眼', name_en: 'Night Eye',
    faction: 'S', style: 'OH', card_type: 'event', slot: 'none',
    cost: 1,
    commit_icons: { perception: 2 },
    consume_enabled: false,
    flavor_text: '路燈死角才是真相藏的地方。',
    effects: [{ sort_order: 0, effect_code: 'modify_test', trigger_type: 'on_play', duration: 'instant',
      description_zh: '本回合感知檢定 +1;若所在地點為「黑暗」狀態，改 +3。',
      description_en: 'This turn, Perception tests +1. If your location is "Dark", +3 instead.',
      effect_params: { attribute: 'perception', modifier: 1 } }],
  },
  {
    series: 'G', name_zh: '抓住把柄', name_en: 'Catch the Slip',
    faction: 'S', style: 'AC', card_type: 'event', slot: 'none',
    cost: 1,
    commit_icons: { agility: 1 },
    consume_enabled: false,
    flavor_text: '濕的東西一抓就是兩倍痛。',
    effects: [{ sort_order: 0, effect_code: 'attack', trigger_type: 'on_play', duration: 'instant',
      description_zh: '對目標造成 2 點傷害;若目標有「潮濕（wet）」狀態，改造成 4 點。',
      description_en: 'Deal 2 damage to target. If target has Wet status, deal 4 instead.',
      effect_params: { damage: 2 } }],
  },

  // ── §4.8 補充類 3 張 ──
  {
    series: 'G', name_zh: '街角熱咖啡', name_en: 'Street Corner Coffee',
    faction: 'S', style: 'AH', card_type: 'event', slot: 'none',
    cost: 0,
    commit_icons: { constitution: 1 },
    consume_enabled: false,
    flavor_text: '苦的，但能撐過下一條街。',
    effects: [{ sort_order: 0, effect_code: 'gain_resource', trigger_type: 'on_play', duration: 'instant',
      description_zh: '獲得 2 個資源。',
      description_en: 'Gain 2 resources.',
      effect_params: { amount: 2 } }],
  },
  {
    series: 'G', name_zh: '事務所筆記', name_en: 'Office Notepad',
    faction: 'S', style: 'OH', card_type: 'event', slot: 'none',
    cost: 0,
    commit_icons: { intellect: 1 },
    consume_enabled: false,
    flavor_text: '十年的案子都記在這上面。',
    effects: [{ sort_order: 0, effect_code: 'draw_card', trigger_type: 'on_play', duration: 'instant',
      description_zh: '抽 2 張卡。',
      description_en: 'Draw 2 cards.',
      effect_params: { amount: 2 } }],
  },
  {
    series: 'G', name_zh: '臨機應變', name_en: 'Adapt',
    faction: 'S', style: 'AH', card_type: 'event', slot: 'none',
    cost: 0,
    commit_icons: { reflex: 1 },
    consume_enabled: false,
    flavor_text: '計畫永遠趕不上變化，那就放棄計畫。',
    effects: [{ sort_order: 0, effect_code: 'choose_one', trigger_type: 'on_play', duration: 'instant',
      description_zh: '二選一:獲得 1 個資源 / 抽 1 張卡。',
      description_en: 'Choose one: gain 1 resource / draw 1 card.',
      effect_params: {} }],
  },
];

log(`目標 ${G1_CARDS.length} 張`);
const results = { created: [], skipped: [], failed: [] };

for (const card of G1_CARDS) {
  if (existingNameSet.has(card.name_zh)) {
    log(`⊙ skip: ${card.name_zh}`);
    results.skipped.push(card.name_zh);
    continue;
  }
  const r = await adminFetch('/api/cards', { method: 'POST', body: JSON.stringify(card) });
  if (!r.ok) {
    log(`✗ ${card.name_zh}: ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
    results.failed.push({ name: card.name_zh, status: r.status, body: r.body });
    continue;
  }
  log(`✓ ${card.name_zh} → ${r.body.data.code}`);
  results.created.push({ name: card.name_zh, code: r.body.data.code, id: r.body.data.id });
}

log(`\n=== 結果 ===\n✓ 新建 ${results.created.length} / ⊙ 跳過 ${results.skipped.length} / ✗ 失敗 ${results.failed.length}`);
fs.writeFileSync(logPath, lines.join('\n'));
log(`log: ${logPath}`);
