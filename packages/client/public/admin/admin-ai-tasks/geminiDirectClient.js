/* ========================================
   MOD-12 / 其他 MOD 共用 — 前端直連遠端 Gemini API 的 client

   此模組複用既有 MOD-01 admin-card-designer.html 的 AI 整合模式：
     localStorage.gemini_api_key + 直接 fetch generativelanguage.googleapis.com

   目的：讓 MOD-12 在雲端部署（Vercel + Railway）環境能用遠端 Gemini API，
         不必經過 gemma-bridge（bridge 目前只部署在小黑 localhost）。

   ⚠ 債務備註：`buildCardDesignPrompt` 與 `validateAndFixCardData` 的內容
   與 MOD-01 admin-card-designer.html 行 2329-2643 目前仍是**複製**關係。
   未來應讓 MOD-01 也載入本檔並呼叫這些函式，消除雙份。
   留到 MOD-01 後續重構一併處理，本檔為單一來源的起點。
   ======================================== */

const LS_GEMINI_API_KEY = 'gemini_api_key';

// ─── API Key 管理（與 MOD-01 共用同一 localStorage key） ─────────
function getGeminiApiKey() {
  return localStorage.getItem(LS_GEMINI_API_KEY) || '';
}
function setGeminiApiKey(key) {
  if (typeof key !== 'string') return;
  localStorage.setItem(LS_GEMINI_API_KEY, key.trim());
}
function hasGeminiApiKey() {
  return !!getGeminiApiKey();
}
function promptForGeminiApiKey(messageOverride) {
  const current = getGeminiApiKey();
  const msg = messageOverride || '請輸入 Gemini API Key：';
  const key = prompt(msg, current);
  if (key === null) return null;
  setGeminiApiKey(key);
  return getGeminiApiKey();
}

window.getGeminiApiKey = getGeminiApiKey;
window.setGeminiApiKey = setGeminiApiKey;
window.hasGeminiApiKey = hasGeminiApiKey;
window.promptForGeminiApiKey = promptForGeminiApiKey;

// ─── 直接呼叫 Google Gemini generateContent ──────────────────────
async function callGeminiDirect({
  prompt,
  model = 'gemini-2.5-pro',
  temperature = 0.7,
  responseMimeType = 'application/json',
  apiKey,
}) {
  const key = apiKey || getGeminiApiKey();
  if (!key) throw new Error('Gemini API Key 未設定（localStorage.gemini_api_key）');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType, temperature },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOut) throw new Error('Gemini 回應為空');
  return { text: textOut, raw: data, modelName: model };
}

window.callGeminiDirect = callGeminiDirect;

// ============================================================
// 八陣營極詳述區塊 — 給卡片、天賦、調查員 prompt 共用
// 來源：docs/old/支柱一_陣營與構築_Pillar1_Faction_v0.1.md
// 已同步至 public/rulebook/s05_faction_pillars.md（SIM-04 specialty）
// ============================================================
const FACTION_POLES_BLOCK = `## 八陣營極詳述（設計時必讀）

玩家創角時在 E/I、S/N、T/F、J/P 四個維度各選一極，得到 4 字碼（例：ENTJ）。
設計時要讓卡片／節點／調查員能力**明確扣緊該極的核心態度與機制關鍵字**。

### E — 號令｜The Herald
- 核心態度：向外尋求力量。靠人脈、團隊、社交關係對抗恐懼
- 卡片風格偏重：O+H（間接正面）
- 機制關鍵字：給予隊友行動、共享資源、NPC 互動加成、領導光環（範圍增益）
- 角色想像：酒吧裡有 20 個線人的老刑警、能說服任何人的記者

### I — 深淵｜The Abyss
- 核心態度：向內尋求力量。在孤獨中找到別人找不到的答案，凝視深淵的人
- 卡片風格偏重：O+H + A+H 混合
- 機制關鍵字：單獨行動加成、牌庫操控（看牌頂/重排）、自我增幅、專精強化
- 角色想像：閣樓翻譯死靈之書的學者、獨自追蹤邪教的私家偵探

### S — 鐵證｜The Witness
- 核心態度：靠實證理解真相。只相信親眼所見、親手觸摸，用物理現實對抗超自然
- 卡片風格偏重：A+H（直接正面）
- 機制關鍵字：裝備加成、搜索額外發現、物理攻擊修正、消耗品效率、環境互動
- 角色想像：在犯罪現場用放大鏡找指紋的法醫、化學試劑分析液體的藥劑師

### N — 天啟｜The Oracle
- 核心態度：超越表象的洞察。看見別人看不見的東西，在混亂中辨認隱藏模式
- 卡片風格偏重：O+C + O+H 混合
- 機制關鍵字：混沌袋操控、預見下一張遭遇卡、神秘學檢定加成、法術施放強化、預知反應
- 角色想像：夢到兇案現場然後醒來發現是真的靈媒、看一眼古文就知道哪裡不對的語言學家

### T — 解析｜The Cipher
- 核心態度：以理性面對恐懼。把一切化為可分析的數據與邏輯鏈，試圖理解不可名狀之物的規則
- 卡片風格偏重：A+C（直接負面）
- 機制關鍵字：弱點揭露（+感知）、敵人行為預測、檢定重擲、戰術佈局、資源效率最大化
- 角色想像：在怪物面前冷靜計算彈道的軍事顧問、把邪教儀式當數學公式破解的密碼學家

### F — 聖燼｜The Ember
- 核心態度：以信念面對恐懼。在黑暗中燃燒自己照亮別人，靠信念、愛、使命感對抗絕望
- 卡片風格偏重：A+H（直接正面）
- 機制關鍵字：治療 HP/SAN、替隊友承傷、犧牲資源換強力效果、信念計數器（越危險越強）
- 角色想像：為了救孩子衝進燃燒建築的消防員、用信仰之力抵擋恐懼的鄉村牧師

### J — 鐵壁｜The Bastion
- 核心態度：以秩序對抗混沌。在世界崩塌時成為最後一道防線，用紀律和計畫築起堡壘
- 卡片風格偏重：A+H + O+C 混合
- 機制關鍵字：傷害減免、回合開始預設佈局、牌組一致性加成、堅守位置時強化
- 角色想像：出門前把每一發子彈編號的退伍軍人、把調查進度釘在牆上用紅線串聯的強迫症探員

### P — 流影｜The Flux
- 核心態度：順應混沌求生。像水一樣在混沌中找到縫隙，不對抗命運而是乘浪前進
- 卡片風格偏重：O+H + A+C 混合
- 機制關鍵字：反應行動數量多、棄牌堆回收、隨機效果獎勵、低 HP/SAN 觸發、即興武器加成
- 角色想像：身上只帶一把瑞士刀但什麼都能湊合的流浪者、從不按計畫走但總是活下來的幸運兒

### 設計紀律
- 設計該極的內容時，描述／效果 / flavor 必須**呼應該極的核心態度**
- 避免跨極風格（例如 F 的卡不該只講孤獨單刷）
- 中立（neutral）卡片不屬任何極，通用但無特色`;

window.FACTION_POLES_BLOCK = FACTION_POLES_BLOCK;

// ─── 卡片設計 prompt（引用共用 admin-card-prompt.js；集中維護避免副本漂移） ──
function buildCardDesignPrompt(userDescription, batchCount = 1, opts = {}) {
  if (typeof window.buildCardGeminiPrompt !== 'function') {
    throw new Error('admin-card-prompt.js 未載入，無法生成卡片 prompt');
  }
  return window.buildCardGeminiPrompt(userDescription, {
    batchCount,
    existingCardsContext: opts.existingCardsContext || '',
  });
}

window.buildCardDesignPrompt = buildCardDesignPrompt;

// ─── 卡片 JSON 驗證+修正（複製自 MOD-01 validateAndFixCardData） ──
const DIRECT_GEMINI_VALID_EFFECT_CODES = new Set([
  'deal_damage','deal_horror','heal_hp','heal_san','restore_hp_max','restore_san_max','transfer_damage','transfer_horror',
  'draw_card','reveal_top','search_deck','retrieve_card','return_to_deck','discard_card','shuffle_deck','remove_from_game',
  'gain_resource','spend_resource','steal_resource','transfer_resource',
  'move_investigator','move_enemy','swap_position','place_enemy','jump',
  'engage_enemy','disengage_enemy','exhaust_card','ready_card','stun_enemy','add_status','remove_status',
  'make_test','modify_test','reroll','auto_success','auto_fail',
  'attack','evade','taunt','counterattack','extra_attack',
  'place_clue','discover_clue','place_doom','remove_doom','seal_gate','spawn_enemy','remove_enemy','execute_enemy',
  'reveal_tile','place_tile','remove_tile','place_haunting','remove_haunting','advance_act','advance_agenda','connect_tiles','disconnect_tiles',
  'create_light','extinguish_light','create_darkness','remove_darkness','create_fire','extinguish_fire',
  'add_keyword','remove_keyword','add_bless','add_curse','remove_bless','remove_curse','look_chaos_bag','manipulate_chaos_bag',
  'teleport','stabilize_ally','revive_ally','fast_play','target_other','direct_deploy','gain_use','transform',
]);

function validateAndFixCardData(d) {
  if (!d || typeof d !== 'object') return d;
  d.cost = Math.max(0, Math.min(6, d.cost || 0));
  d.damage = Math.max(0, Math.min(10, d.damage || 0));
  d.horror = Math.max(0, Math.min(10, d.horror || 0));
  d.skill_value = Math.max(0, Math.min(5, d.skill_value || 0));

  if (d.check_attribute && !d.attribute_modifiers) {
    d.attribute_modifiers = { [d.check_attribute]: d.check_modifier || 0 };
  }
  delete d.check_attribute; delete d.check_modifier; delete d.check_method;

  const validStyles = ['shooting','archery','sidearm','military','brawl','arcane','engineer','assassin'];
  if (d.combat_style && !validStyles.includes(d.combat_style)) {
    console.warn('Invalid combat_style:', d.combat_style);
    d.combat_style = null;
  }

  // slot 白名單校驗：對應 DB card_slot enum。
  // 批次模式無 form 中介，必須在此攔下不合法值（例如 Gemini 偶爾會把 type="ally" 複製到 slot）。
  const validSlots = ['one_hand','two_hand','head','body','accessory','arcane','talent','expertise','none'];
  if (!d.slot || !validSlots.includes(d.slot)) {
    if (d.slot) console.warn('Invalid slot from AI, coercing:', d.slot);
    d.slot = d.combat_style === 'arcane' ? 'arcane' : 'none';
  }

  if (d.attribute_modifiers && typeof d.attribute_modifiers === 'object') {
    const validKeys = ['strength','agility','constitution','reflex','intellect','willpower','perception','charisma','all'];
    for (const key of Object.keys(d.attribute_modifiers)) {
      if (!validKeys.includes(key)) { delete d.attribute_modifiers[key]; continue; }
      const val = d.attribute_modifiers[key];
      if (typeof val !== 'number' || val < -5 || val > 5) {
        d.attribute_modifiers[key] = Math.max(-5, Math.min(5, Math.round(val || 0)));
      }
    }
    if (d.attribute_modifiers.all !== undefined && Object.keys(d.attribute_modifiers).length > 1) {
      d.attribute_modifiers = { all: d.attribute_modifiers.all };
    }
  }

  if (d.effects) {
    for (const eff of d.effects) {
      if (eff.effect_params && !eff.params) { eff.params = eff.effect_params; delete eff.effect_params; }
      if (!DIRECT_GEMINI_VALID_EFFECT_CODES.has(eff.effect_code)) {
        console.warn('Invalid effect_code from AI:', eff.effect_code);
        eff._invalid = true;
      }
    }
  }
  return d;
}

window.validateAndFixCardData = validateAndFixCardData;

// fetchExistingCardsForPromptContext 已搬到 admin-shared.js,讓 MOD-01/MOD-12/診斷頁共用
// 此處保留 function 名稱相容性 reference
const fetchExistingCardsForPromptContext = window.fetchExistingCardsForPromptContext;

// ─── 給 MOD-12 的高階 helper：跑完「生卡片」端到端 ─────────────
async function generateCardViaDirectGemini(userDescription, { model = 'gemini-2.5-pro', batchCount = 1, apiKey } = {}) {
  if (!userDescription || typeof userDescription !== 'string') {
    throw new Error('userDescription 為空');
  }
  const existingCardsContext = await fetchExistingCardsForPromptContext(userDescription);
  const prompt = buildCardDesignPrompt(userDescription, batchCount, { existingCardsContext });
  const { text, modelName } = await callGeminiDirect({ prompt, model, apiKey });
  const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
  let data;
  try {
    data = JSON.parse(cleanJson);
  } catch (e) {
    throw new Error('Gemini 回傳內容不是合法 JSON：' + e.message);
  }
  // Gemini 可能直接回單張物件（單卡），也可能回陣列（批次）
  const items = Array.isArray(data) ? data.map(validateAndFixCardData) : [validateAndFixCardData(data)];
  if (batchCount > 1 && items.length !== batchCount) {
    console.warn(`batch mismatch: requested ${batchCount}, got ${items.length}`);
  }
  return { items, modelUsed: modelName };
}

window.generateCardViaDirectGemini = generateCardViaDirectGemini;

// ============================================================
// MOD-04 團隊精神（Team Spirit）
// ============================================================

function buildSpiritDesignPrompt(userDescription) {
  return `你是克蘇魯神話合作卡牌遊戲（1920s 偵探黑色電影 × 宇宙恐怖）的系統設計師。
請為一個**團隊精神（Team Spirit）**做完整設計。團隊精神是全隊共享的被動能力，以「凝聚力投入」換取深度等級解鎖更強效果。

## 絕對規則
1. 輸出**單一 JSON object**，不要 array、不要 markdown 圍欄
2. 文字欄位使用**台灣繁體中文**
3. 嚴格遵守 JSON 欄位名稱與型別

## 分類 category（必須從這 8 種選一）
combat（戰鬥類）, investigation（調查與資訊類）, resource（資源與經濟類）, growth（成長與系統解鎖類）, knowledge（知識與神話類）, rhythm（團隊節奏類）, status（異常狀態專精類）, bestiary（怪物學類）

## 效果標籤 effect_tags（選 1-3 個）
damage_boost, damage_reduction, healing, resource_gen, card_advantage, information, system_unlock, status_offense, status_defense, chaos_control, action_economy, team_synergy

## 效果價值參考表（1V = 1 行動點 = 1 資源 = 抽 1 張 = 1 點傷害）
- 傷害：1V/點、恐懼 3V/點、攻擊 +1 = 2.5V
- 恢復：HP/SAN 1.5V/點、取消傷害 0.5V
- 卡牌：抽 1 張 1V、搜牌 6V、回收棄牌 1.5V
- 資源：1 資源 1V、1 使用次數 0.5V
- 檢定修正：單屬性 +1=0.5V, +2=1.5V, +3=3V；萬能 +1=1V, +2=3V, +3=6V
- 狀態（每層）：中毒 3V、流血 2V、燃燒 3V、冷凍 3V、護甲 3V、護盾 6V、強化 3V
- 特殊：快速 +1V、指定他人 +2V、額外攻擊 1.5V、重擲 1V、自動成功 4V

## 深度規則
- **5 個等級** (level 1 到 5)，每級效果逐級遞進、同主題
- Lv1：簡單基礎（約 1-2V）
- Lv2-3：中等強化（約 2-4V）
- Lv4：重要飛躍（約 4-6V）
- Lv5：頂級效果（約 4-8V）
- **總價值 15-25V** 之間（≈ Σ depth_effects.effect_value）

## 克蘇魯氛圍原則
- 避免太「正面英雄」的語調；偏向「代價換取」「勉強維繫」的暗色基調
- milestone 達成條件可設具體但帶絕望感（例：目睹 5 位調查員發狂）
- flavor 可引用 Lovecraft 風格，簡短不祥

## 使用者需求
${userDescription}

## 輸出格式（完整 JSON）
{
  "code": "小寫底線命名，全域唯一（如 flame_of_pledge）",
  "name_zh": "精神名稱（繁中）",
  "name_en": "English Name",
  "category": "combat",
  "description": "精神主題描述（繁中，1-2 句）",
  "description_en": "Theme description (English)",
  "adopt_effect_zh": "採納時的基礎被動效果（具體可執行）",
  "adopt_effect_en": "Adopt passive effect",
  "maxed_effect_zh": "全 5 級解鎖後的額外被動",
  "maxed_effect_en": "Maxed extra passive",
  "milestone_name_zh": "里程碑名稱",
  "milestone_name_en": "Milestone Name",
  "milestone_desc": "達成條件（具體可驗證）",
  "milestone_effect_zh": "里程碑效果（繁中）",
  "milestone_effect_en": "Milestone effect (English)",
  "effect_tags": ["damage_boost","healing"],
  "total_value": 20,
  "depth_effects": [
    { "level": 1, "effect_name_zh": "…", "effect_name_en": "…", "effect_desc_zh": "…（具體可執行）", "effect_desc_en": "…", "effect_value": 1.5, "effect_formula": "1V 抽牌" },
    { "level": 2, "effect_name_zh": "…", "effect_name_en": "…", "effect_desc_zh": "…", "effect_desc_en": "…", "effect_value": 3,   "effect_formula": "" },
    { "level": 3, "effect_name_zh": "…", "effect_name_en": "…", "effect_desc_zh": "…", "effect_desc_en": "…", "effect_value": 4,   "effect_formula": "" },
    { "level": 4, "effect_name_zh": "…", "effect_name_en": "…", "effect_desc_zh": "…", "effect_desc_en": "…", "effect_value": 5,   "effect_formula": "" },
    { "level": 5, "effect_name_zh": "…", "effect_name_en": "…", "effect_desc_zh": "…", "effect_desc_en": "…", "effect_value": 6.5, "effect_formula": "" }
  ]
}

## 重要提醒
1. depth_effects 陣列**必須剛好 5 個元素**，level 依序 1 到 5
2. total_value ≈ Σ depth_effects.effect_value，並保持在 15-25V
3. Lv5 的 effect_value 應 ≥ Lv1 的 2-3 倍
4. 所有 effect_desc 要**具體可執行**，避免「增強隊友」這種模糊描述——要寫清楚數值、範圍、觸發條件
5. adopt_effect 與 maxed_effect 語意不同：adopt 是「採納就生效」，maxed 是「5 級全滿額外加碼」`;
}

const VALID_SPIRIT_CATEGORIES = ['combat','investigation','resource','growth','knowledge','rhythm','status','bestiary'];
const VALID_SPIRIT_EFFECT_TAGS = new Set([
  'damage_boost','damage_reduction','healing','resource_gen','card_advantage','information',
  'system_unlock','status_offense','status_defense','chaos_control','action_economy','team_synergy',
]);

function validateAndFixSpiritData(d) {
  if (!d || typeof d !== 'object') return d;
  if (!VALID_SPIRIT_CATEGORIES.includes(d.category)) {
    console.warn('spirit: invalid category coerced to combat:', d.category);
    d.category = 'combat';
  }
  d.effect_tags = Array.isArray(d.effect_tags)
    ? d.effect_tags.filter((t) => VALID_SPIRIT_EFFECT_TAGS.has(t)).slice(0, 3)
    : [];

  // Ensure depth_effects is exactly 5 entries with level 1-5
  if (!Array.isArray(d.depth_effects)) d.depth_effects = [];
  for (let i = 0; i < 5; i++) {
    if (!d.depth_effects[i] || typeof d.depth_effects[i] !== 'object') {
      d.depth_effects[i] = { level: i + 1, effect_desc_zh: '', effect_value: 0 };
    }
    d.depth_effects[i].level = i + 1;
    d.depth_effects[i].effect_value = Math.max(0, Math.min(15, parseFloat(d.depth_effects[i].effect_value) || 0));
  }
  d.depth_effects = d.depth_effects.slice(0, 5);

  // Normalize main numeric
  const computedTotal = d.depth_effects.reduce((s, e) => s + (e.effect_value || 0), 0);
  const claimed = parseFloat(d.total_value);
  d.total_value = Number.isFinite(claimed) && claimed > 0 ? claimed : computedTotal;
  d.total_value = Math.max(0, Math.min(50, d.total_value));

  // Code fallback from name_en
  if (!d.code || typeof d.code !== 'string') {
    const base = (d.name_en || d.name_zh || 'spirit').toString().toLowerCase();
    d.code = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `spirit_${Date.now()}`;
  }
  return d;
}

async function generateSpiritViaDirectGemini(userDescription, { model = 'gemini-2.5-pro', apiKey } = {}) {
  if (!userDescription || typeof userDescription !== 'string') throw new Error('userDescription 為空');
  const prompt = buildSpiritDesignPrompt(userDescription);
  const { text, modelName } = await callGeminiDirect({ prompt, model, apiKey });
  const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
  let data;
  try { data = JSON.parse(cleanJson); }
  catch (e) { throw new Error('Gemini 回傳內容不是合法 JSON：' + e.message); }
  const item = validateAndFixSpiritData(data);
  return { items: [item], modelUsed: modelName };
}

window.buildSpiritDesignPrompt = buildSpiritDesignPrompt;
window.validateAndFixSpiritData = validateAndFixSpiritData;
window.generateSpiritViaDirectGemini = generateSpiritViaDirectGemini;

// ============================================================
// MOD-02 天賦樹節點（Talent Tree Node）
// ============================================================

function buildTalentNodeDesignPrompt(userDescription, batchCount = 1) {
  const isBatch = batchCount && batchCount > 1;
  const plural = isBatch ? `${batchCount} 個` : `一個`;
  return `你是克蘇魯神話合作卡牌遊戲（1920s 偵探黑色電影 × 宇宙恐怖）的系統設計師。
請為特定陣營的天賦樹設計${plural}**天賦節點**。

## 絕對規則
1. 輸出 ${isBatch ? 'JSON Array（長度 ' + batchCount + '）' : '單一 JSON object'}，不要 markdown 圍欄
2. 文字欄位使用**台灣繁體中文**
3. 所有節點的 code 必須全域唯一（小寫+底線，如 s_weapon_mastery_1）
4. faction_code 必須從 9 個合法值選一：E / I / S / N / T / F / J / P / neutral
   （詳細定義見下方「八陣營極詳述」區塊）

${FACTION_POLES_BLOCK}

## 天賦樹結構
- tier（階層）：1 到 12 的整數
- branch（分支）：字串標籤，例如 "combat" / "investigation" / "resource"（分支名可自由）
- node_type 必須從這 8 種選一：
  · basic（基礎節點，低階通用增益）
  · branch_split（分支切換點，通常在 tier 4 / 7）
  · milestone（里程碑，強力效果 + 需 milestone_type）
  · attribute_boost（屬性提升，需 boost_attribute）
  · skill_unlock（解鎖技能）
  · specialization_unlock（解鎖專精）
  · signature_card（簽名卡）
  · ultimate（終極節點，tier 12 限定）

## 條件欄位
- node_type=milestone → 必填 milestone_type（字串，例：'chapter_complete'）
- node_type=attribute_boost → 必填 boost_attribute，值從這 7 個選一：
  strength / agility / constitution / intellect / willpower / perception / charisma

## 費用
- cost_in_points：消耗的天賦點（整數，通常 1-3，boss級 ultimate 可到 5）
- prerequisites：前置節點 code 陣列（可為空陣列 []）

## 克蘇魯氛圍原則
- description 帶一絲代價、交換、污染感，避免純光明英雄語調
- milestone 常以「獲得但失去」方式呈現（例：記住全部線索但 SAN 上限 -1）

## 使用者需求
${userDescription}

## 輸出格式（單節點）
{
  "code": "s_gunslinger_tier3_1",
  "faction_code": "S",
  "tier": 3,
  "branch": "combat",
  "node_type": "attribute_boost",
  "name_zh": "穩定握持",
  "name_en": "Steady Grip",
  "description_zh": "所有射擊類檢定 +1",
  "description_en": "...",
  "prerequisites": ["s_combat_tier2_1"],
  "cost_in_points": 1,
  "effect_code": "boost_attribute",
  "effect_value": 1,
  "boost_attribute": "agility",
  "is_milestone": false,
  "is_branch_point": false,
  "is_ultimate": false
}

## 重要提醒
1. code 格式：小寫字母+數字+底線（pattern ^[a-z0-9_]+$）
2. tier ∈ [1, 12] 整數
3. cost_in_points ≥ 0 整數
4. prerequisites 必為陣列（即使空也要 []）
5. 若節點為 milestone，is_milestone: true 且有 milestone_type
6. 若節點為 ultimate，is_ultimate: true，通常 tier: 12
7. 產出內容需扣緊陣營主題（S 鐵證＝裝備物理、N 天啟＝混沌預知、I 深淵＝單獨強化 etc）`;
}

const VALID_TALENT_NODE_TYPES = new Set([
  'basic','branch_split','milestone','attribute_boost',
  'skill_unlock','specialization_unlock','signature_card','ultimate',
]);
const VALID_TALENT_FACTION_CODES = new Set(['E','I','S','N','T','F','J','P','neutral']);
const VALID_ATTRIBUTES_TALENT = new Set(['strength','agility','constitution','intellect','willpower','perception','charisma']);

function validateAndFixTalentNodeData(d) {
  if (!d || typeof d !== 'object') return d;
  if (!VALID_TALENT_FACTION_CODES.has(d.faction_code)) {
    console.warn('talent: invalid faction_code coerced to neutral:', d.faction_code);
    d.faction_code = 'neutral';
  }
  if (!VALID_TALENT_NODE_TYPES.has(d.node_type)) {
    console.warn('talent: invalid node_type coerced to basic:', d.node_type);
    d.node_type = 'basic';
  }
  d.tier = Math.max(1, Math.min(12, parseInt(d.tier, 10) || 1));
  d.cost_in_points = Math.max(0, Math.min(5, parseInt(d.cost_in_points, 10) || 1));
  if (!Array.isArray(d.prerequisites)) d.prerequisites = [];
  if (d.node_type === 'attribute_boost' && !VALID_ATTRIBUTES_TALENT.has(d.boost_attribute)) {
    d.boost_attribute = 'strength';
  }
  if (d.node_type === 'milestone' && !d.milestone_type) {
    d.milestone_type = 'generic';
  }
  if (!d.code || !/^[a-z0-9_]+$/.test(String(d.code))) {
    const base = (d.name_en || d.name_zh || 'talent').toString().toLowerCase();
    d.code = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `talent_${Date.now()}`;
  }
  return d;
}

async function generateTalentNodeViaDirectGemini(userDescription, { model = 'gemini-2.5-pro', batchCount = 1, apiKey } = {}) {
  if (!userDescription || typeof userDescription !== 'string') throw new Error('userDescription 為空');
  const prompt = buildTalentNodeDesignPrompt(userDescription, batchCount);
  const { text, modelName } = await callGeminiDirect({ prompt, model, apiKey });
  const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
  let data;
  try { data = JSON.parse(cleanJson); }
  catch (e) { throw new Error('Gemini 回傳內容不是合法 JSON：' + e.message); }
  const items = Array.isArray(data) ? data.map(validateAndFixTalentNodeData) : [validateAndFixTalentNodeData(data)];
  return { items, modelUsed: modelName };
}

window.buildTalentNodeDesignPrompt = buildTalentNodeDesignPrompt;
window.validateAndFixTalentNodeData = validateAndFixTalentNodeData;
window.generateTalentNodeViaDirectGemini = generateTalentNodeViaDirectGemini;

// ============================================================
// MOD-03 敵人/怪物變體（Enemy Variant）
// ============================================================

function buildEnemyDesignPrompt(userDescription, batchCount = 1) {
  const isBatch = batchCount && batchCount > 1;
  const plural = isBatch ? `${batchCount} 隻` : `一隻`;
  return `你是克蘇魯神話合作卡牌遊戲（1920s 偵探黑色電影 × 宇宙恐怖）的敵人設計師。
請設計${plural}**怪物變體**，與指定家族與位階相符。

## 絕對規則
1. 輸出 ${isBatch ? 'JSON Array（長度 ' + batchCount + '）' : '單一 JSON object'}，不要 markdown 圍欄
2. 文字欄位使用**台灣繁體中文**
3. code 小寫+底線+數字（^[a-z0-9_]+$），全域唯一
4. **神秘（arcane）元素絕對不可出現在 vulnerabilities / resistances / immunities**
   （攻擊元素 attack_element 可以是 arcane，但抗性三項只限 physical / fire / ice / electric）
5. 克蘇魯譯名使用台灣社群慣用譯法，禁止自創（參考對照表）

## 家族 family_code（選一）
- house_cthulhu（克蘇魯家族，深潛者、深潛巨人、星之眷族）
- house_hastur（哈斯塔家族，拜亞基、黃衣之王僕人）
- house_shub（莎布家族，黑山羊幼崽、森林靈）
- house_nyarlathotep（奈亞家族，黑法老、混沌化身、夜魘）
- house_yog（猶格家族，星之彩、污染生命）
- house_cthugha（克圖格亞家族，火焰之靈）
- house_yig（伊格家族，蛇人、爬行族）
- fallen（墮落者，發瘋的調查員、神秘學家）
- undying（不死者，食屍鬼、屍化者）
- independent（獨立存在，鳥頭巫、黑暗之主）

## 位階 tier（選一，依實力由弱到強）
minion（雜兵）/ threat（威脅）/ elite（精英）/ boss（頭目）/ titan（巨頭）

## HP 範圍建議（tier → hp）
- minion: 3-8
- threat: 8-15
- elite: 15-28
- boss: 30-60
- titan: 80-150

## 攻擊元素 attack_element
physical / fire / ice / electric / arcane（arcane 最稀少，僅主要施法者）

## 恐懼 horror
- horror_radius（範圍，0-5 格）
- horror_value（每圈造成 SAN 傷害點數）

## 使用者需求
${userDescription}

## 輸出格式
{
  "code": "deep_one_hybrid_tier2_01",
  "species_code": "deep_one",
  "family_code": "house_cthulhu",
  "name_zh": "深潛混種",
  "name_en": "Deep One Hybrid",
  "tier": "threat",
  "hp": 12,
  "san_damage": 1,
  "horror_radius": 1,
  "horror_value": 1,
  "attack_element": "physical",
  "vulnerabilities": ["fire"],
  "resistances": ["ice"],
  "immunities": [],
  "inflicted_statuses": ["wet"],
  "design_notes": "..."
}

## 重要提醒
1. species_code 是既有物種代碼，若 Gemini 不確定，用合理英文 snake_case 生成（例 shoggoth、nightgaunt、byakhee）
2. vulnerabilities / resistances / immunities **三者不可重疊**且不可包含 arcane
3. HP 值要符合 tier 區間
4. 克蘇魯氛圍：描述帶觸感噁心 / 形體錯亂 / 非歐幾里得 / 讓調查員失智的視覺
5. 若是施法類敵人（巫師、拜亞基主教），attack_element 可 arcane`;
}

const VALID_ENEMY_FAMILIES = new Set([
  'house_cthulhu','house_hastur','house_shub','house_nyarlathotep',
  'house_yog','house_cthugha','house_yig','fallen','undying','independent',
]);
const VALID_ENEMY_TIERS = new Set(['minion','threat','elite','boss','titan']);
const VALID_ELEMENTS_WITH_ARCANE = new Set(['physical','fire','ice','electric','arcane']);
const VALID_ELEMENTS_NO_ARCANE = new Set(['physical','fire','ice','electric']);

function validateAndFixEnemyData(d) {
  if (!d || typeof d !== 'object') return d;
  if (!VALID_ENEMY_FAMILIES.has(d.family_code)) {
    console.warn('enemy: invalid family_code coerced to independent:', d.family_code);
    d.family_code = 'independent';
  }
  if (!VALID_ENEMY_TIERS.has(d.tier)) {
    console.warn('enemy: invalid tier coerced to threat:', d.tier);
    d.tier = 'threat';
  }
  if (!VALID_ELEMENTS_WITH_ARCANE.has(d.attack_element)) {
    d.attack_element = 'physical';
  }
  d.hp = Math.max(1, Math.min(200, parseInt(d.hp, 10) || 10));
  d.san_damage = Math.max(0, Math.min(10, parseInt(d.san_damage, 10) || 0));
  d.horror_radius = Math.max(0, Math.min(5, parseInt(d.horror_radius, 10) || 0));
  d.horror_value = Math.max(0, Math.min(10, parseInt(d.horror_value, 10) || 0));

  // 三抗性陣列：過濾 arcane 和重複值
  for (const key of ['vulnerabilities','resistances','immunities']) {
    if (!Array.isArray(d[key])) d[key] = [];
    d[key] = [...new Set(d[key].filter((e) => VALID_ELEMENTS_NO_ARCANE.has(e)))];
  }
  // 三抗性不可重疊（以 vulnerabilities > resistances > immunities 優先順序去重）
  d.resistances = d.resistances.filter((e) => !d.vulnerabilities.includes(e));
  d.immunities = d.immunities.filter((e) => !d.vulnerabilities.includes(e) && !d.resistances.includes(e));

  if (!d.code || !/^[a-z0-9_]+$/.test(String(d.code))) {
    const base = (d.name_en || d.species_code || 'enemy').toString().toLowerCase();
    d.code = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `enemy_${Date.now()}`;
  }
  return d;
}

async function generateEnemyViaDirectGemini(userDescription, { model = 'gemini-2.5-pro', batchCount = 1, apiKey } = {}) {
  if (!userDescription || typeof userDescription !== 'string') throw new Error('userDescription 為空');
  const prompt = buildEnemyDesignPrompt(userDescription, batchCount);
  const { text, modelName } = await callGeminiDirect({ prompt, model, apiKey });
  const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
  let data;
  try { data = JSON.parse(cleanJson); }
  catch (e) { throw new Error('Gemini 回傳內容不是合法 JSON：' + e.message); }
  const items = Array.isArray(data) ? data.map(validateAndFixEnemyData) : [validateAndFixEnemyData(data)];
  return { items, modelUsed: modelName };
}

window.buildEnemyDesignPrompt = buildEnemyDesignPrompt;
window.validateAndFixEnemyData = validateAndFixEnemyData;
window.generateEnemyViaDirectGemini = generateEnemyViaDirectGemini;

// ============================================================
// MOD-10 城主設計器 — 神話卡（Mythos Card）
// ============================================================

function buildMythosCardDesignPrompt(userDescription, batchCount = 1) {
  const isBatch = batchCount && batchCount > 1;
  const plural = isBatch ? `${batchCount} 張` : `一張`;
  return `你是克蘇魯神話合作卡牌遊戲（1920s 偵探黑色電影 × 宇宙恐怖）的城主（Keeper）設計師。
請設計${plural}**神話卡**（Mythos Card）——城主對抗調查員的主力卡片，在敵人階段由城主打出。

## 絕對規則
1. 輸出 ${isBatch ? 'JSON Array（長度 ' + batchCount + '）' : '單一 JSON object'}，不要 markdown 圍欄
2. 文字欄位使用**台灣繁體中文**
3. code 小寫+底線+數字（^[a-z0-9_]+$），全域唯一
4. 克蘇魯譯名使用台灣社群慣用譯法

## 卡片類別 card_category（選一）
summon（召喚類，新怪物降臨）/ environment（環境類，地形、氣候、天氣異常）/
status（狀態類，調查員受身心影響）/ global（全場類，影響整場） /
agenda（議程類，推進毀滅倒數） / chaos_bag（混沌袋類，污染混沌袋）/
encounter（遭遇牌堆類，影響遭遇堆）/ cancel（響應取消類，抵消調查員動作）/
narrative（純敘事，氣氛渲染）/ general（混合/其他）

## 啟動時機 activation_timing（選一）
keeper_phase（敵人階段使用，最常見）/
investigator_phase_reaction（調查員階段響應，需指定觸發條件 response_trigger）/
both（兩者皆可）

## 強度 intensity_tag（選一，依影響範圍）
small（1-2 行動成本，小事件）/ medium（3-4 成本，中規模打擊）/
large（5-6 成本，大型威脅）/ epic（7+ 成本，史詩級災難）

## action_cost（城主行動成本）
小事件 1-2、中事件 3-4、大事件 5-6、史詩 7-9。action_cost 應與 intensity_tag 一致。

## response_trigger
僅當 card_category='cancel' 或 activation_timing='investigator_phase_reaction' 時必填。
描述觸發條件（例：'調查員執行調查行動時'、'調查員抽牌階段'）。

## 使用者需求
${userDescription}

## 輸出格式
{
  "code": "deep_one_ambush_01",
  "name_zh": "深潛者伏擊",
  "name_en": "Deep One Ambush",
  "description_zh": "從最近的水域召喚一隻深潛者，立即攻擊該地點的所有調查員。",
  "description_en": "Summon a Deep One from the nearest water source...",
  "action_cost": 3,
  "activation_timing": "keeper_phase",
  "card_category": "summon",
  "intensity_tag": "medium",
  "response_trigger": null,
  "flavor_text_zh": "潮濕的拍打聲從下水道傳來——那不是水聲。",
  "flavor_text_en": "Wet slapping sounds echo from the sewer...",
  "design_notes": "summon × medium",
  "design_status": "draft"
}

## 克蘇魯氛圍原則
- description 具體可執行（機制 + 數值），flavor_text 詩意不祥
- 避免正面光明語調；偏絕望、代價、不可逃脫感
- 小事件仍要有存在感（煙霧、幻聽、陰影移動），不該是「什麼都沒發生」

## 重要提醒
1. activation_timing='investigator_phase_reaction' 或 card_category='cancel' 時，response_trigger 必填
2. action_cost 必須落在 intensity_tag 建議區間
3. 不同卡類應有明顯區別：summon 帶出怪物、environment 改變地形、status 施加負面狀態、agenda 推進毀滅
4. design_status 固定為 'draft'`;
}

const VALID_MYTHOS_CATEGORIES = new Set(['summon','environment','status','global','agenda','chaos_bag','encounter','cancel','narrative','general']);
const VALID_MYTHOS_TIMINGS = new Set(['keeper_phase','investigator_phase_reaction','both']);
const VALID_MYTHOS_INTENSITIES = new Set(['small','medium','large','epic']);

function validateAndFixMythosCardData(d) {
  if (!d || typeof d !== 'object') return d;
  if (!VALID_MYTHOS_CATEGORIES.has(d.card_category)) d.card_category = 'general';
  if (!VALID_MYTHOS_TIMINGS.has(d.activation_timing)) d.activation_timing = 'keeper_phase';
  if (!VALID_MYTHOS_INTENSITIES.has(d.intensity_tag)) d.intensity_tag = 'small';
  d.action_cost = Math.max(0, Math.min(10, parseInt(d.action_cost, 10) || 1));
  if ((d.card_category === 'cancel' || d.activation_timing === 'investigator_phase_reaction') && !d.response_trigger) {
    d.response_trigger = '（未指定觸發條件——請使用者手動補充）';
  }
  if (!d.code || !/^[a-z0-9_]+$/.test(String(d.code))) {
    const base = (d.name_en || d.name_zh || 'mythos').toString().toLowerCase();
    d.code = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `mythos_${Date.now()}`;
  }
  d.design_status = d.design_status || 'draft';
  return d;
}

async function generateMythosCardViaDirectGemini(userDescription, { model = 'gemini-2.5-pro', batchCount = 1, apiKey } = {}) {
  if (!userDescription || typeof userDescription !== 'string') throw new Error('userDescription 為空');
  const prompt = buildMythosCardDesignPrompt(userDescription, batchCount);
  const { text, modelName } = await callGeminiDirect({ prompt, model, apiKey });
  const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
  let data;
  try { data = JSON.parse(cleanJson); }
  catch (e) { throw new Error('Gemini 回傳內容不是合法 JSON：' + e.message); }
  const items = Array.isArray(data) ? data.map(validateAndFixMythosCardData) : [validateAndFixMythosCardData(data)];
  return { items, modelUsed: modelName };
}

window.buildMythosCardDesignPrompt = buildMythosCardDesignPrompt;
window.validateAndFixMythosCardData = validateAndFixMythosCardData;
window.generateMythosCardViaDirectGemini = generateMythosCardViaDirectGemini;

// ============================================================
// MOD-11 調查員設計器 — 調查員模板（Investigator Template）
// ============================================================

function buildInvestigatorDesignPrompt(userDescription, batchCount = 1) {
  const isBatch = batchCount && batchCount > 1;
  const plural = isBatch ? `${batchCount} 位` : `一位`;
  return `你是克蘇魯神話合作卡牌遊戲（1920s 偵探黑色電影 × 宇宙恐怖）的角色設計師。
請設計${plural}**調查員（玩家角色）**——1920-30 年代的凡人，即將踏入宇宙恐怖。

## 絕對規則
1. 輸出 ${isBatch ? 'JSON Array（長度 ' + batchCount + '）' : '單一 JSON object'}，不要 markdown 圍欄
2. 文字欄位使用**台灣繁體中文**
3. code 小寫+底線（^[a-z0-9_]+$），全域唯一
4. 名字要有 1920 年代美國/歐洲氛圍（避免現代或亞洲名，除非使用者指定）

## 屬性系統（簡化）
- 屬性由 MBTI 自動推導，**不要手動填 attr_\***
- 必填 mbti_code（4 字大寫，如 INTJ、ESFP、ENTJ...）
- 系統會根據 MBTI 主次屬性給 1-5 分配

## 陣營對應（由 MBTI 推導，但可強制指定）
faction_code 9 個極（E / I / S / N / T / F / J / P / neutral）。
若使用者指定某陣營，就用那個；否則由 MBTI 首字母推導。
**背景、能力、title 必須扣緊所選極的核心態度與角色想像，詳見下方詳述**。

${FACTION_POLES_BLOCK}

## 職業指標 career_index
整數（seed 庫有 16 種 MBTI × 多個職業）。若 Gemini 不確定就用 0。

## 主導字母 dominant_letter
MBTI 4 字中最強的一個（E/I/S/N/T/F/J/P）。可從 mbti_code 推（例如 INTJ 主導 N 或 T）。

## 時代標籤 era_tags（陣列）
例：['detective', 'occultist', 'professor', 'journalist', 'soldier', 'psychic']。

## 使用者需求
${userDescription}

## 輸出格式
{
  "code": "harvey_walters_01",
  "mbti_code": "INTJ",
  "faction_code": "I",
  "career_index": 0,
  "dominant_letter": "N",
  "name_zh": "哈維·沃特斯",
  "name_en": "Harvey Walters",
  "title_zh": "密大教授",
  "title_en": "Miskatonic Professor",
  "backstory": "深夜的密大圖書館，他在書架深處發現一本從未列冊的古籍——那是他人生最後的平靜夜晚。",
  "ability_text_zh": "每當你進行智力檢定，可棄一張手牌獲得 +1。若此檢定成功，抽 1 張牌。",
  "ability_text_en": "Whenever you make an intellect test, you may discard a card to gain +1...",
  "era_tags": ["professor", "occultist"]
}

## 克蘇魯氛圍原則
- backstory 不要寫成完整傳記，**寫出一個決定性的瞬間**（發現、失去、被侵入）
- ability_text 是遊戲機制，但描述要扣緊角色特質
- 避免太陽光向上的語調；調查員都在被什麼吞噬

## 重要提醒
1. mbti_code 必須是合法 4 字組合（E/I + S/N + T/F + J/P）
2. 不要自己填 attr_* 欄位——伺服器會根據 MBTI 自動推
3. code 和 name_en 若有設應保持風格一致（harvey_walters 對 Harvey Walters）
4. 單次產出避免重複 code`;
}

const MBTI_PATTERN = /^[EI][SN][TF][JP]$/;
const VALID_TALENT_FACTION_CODES_INV = new Set(['E','I','S','N','T','F','J','P','neutral']);

function validateAndFixInvestigatorData(d) {
  if (!d || typeof d !== 'object') return d;
  if (typeof d.mbti_code === 'string') d.mbti_code = d.mbti_code.toUpperCase();
  if (!MBTI_PATTERN.test(d.mbti_code || '')) {
    console.warn('investigator: invalid mbti coerced to INTJ:', d.mbti_code);
    d.mbti_code = 'INTJ';
  }
  if (!VALID_TALENT_FACTION_CODES_INV.has(d.faction_code)) {
    d.faction_code = d.mbti_code[0]; // fallback 由 MBTI 首字母推
  }
  d.career_index = parseInt(d.career_index, 10) || 0;
  if (typeof d.dominant_letter !== 'string' || !/^[EISNTFJP]$/.test(d.dominant_letter)) {
    d.dominant_letter = d.mbti_code[3]; // fallback 取 MBTI 第四字（通常主導 J/P 差異）
  }
  if (!Array.isArray(d.era_tags)) d.era_tags = [];
  if (!d.code || !/^[a-z0-9_]+$/.test(String(d.code))) {
    const base = (d.name_en || d.name_zh || 'investigator').toString().toLowerCase();
    d.code = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `investigator_${Date.now()}`;
  }
  return d;
}

async function generateInvestigatorViaDirectGemini(userDescription, { model = 'gemini-2.5-pro', batchCount = 1, apiKey } = {}) {
  if (!userDescription || typeof userDescription !== 'string') throw new Error('userDescription 為空');
  const prompt = buildInvestigatorDesignPrompt(userDescription, batchCount);
  const { text, modelName } = await callGeminiDirect({ prompt, model, apiKey });
  const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
  let data;
  try { data = JSON.parse(cleanJson); }
  catch (e) { throw new Error('Gemini 回傳內容不是合法 JSON：' + e.message); }
  const items = Array.isArray(data) ? data.map(validateAndFixInvestigatorData) : [validateAndFixInvestigatorData(data)];
  return { items, modelUsed: modelName };
}

window.buildInvestigatorDesignPrompt = buildInvestigatorDesignPrompt;
window.validateAndFixInvestigatorData = validateAndFixInvestigatorData;
window.generateInvestigatorViaDirectGemini = generateInvestigatorViaDirectGemini;

// ═══════════════════════════════════════════════════════
// MOD-08 地點設計器 — Location
// ═══════════════════════════════════════════════════════
function buildLocationDesignPrompt(userDescription, batchCount = 1) {
  const isBatch = batchCount > 1;
  return `你是克蘇魯神話卡牌冒險遊戲的地點設計助手。請依使用者描述產出地點資料。

## 一、術語規範
克蘇魯神話專有名詞採用台灣 TRPG/桌遊社群慣用譯名（克蘇魯、奈亞拉托提普、印斯茅斯、敦威治、阿卡姆）。情感基調：渺小感、未知的不安、真實代價。

## 二、地點欄位
- code：小寫英數底線，唯一代碼（例：gilman_house_hotel、marsh_basement）
- name_zh / name_en：中文/英文名稱
- description_zh / description_en：場所描述（80-200 字），第二人稱或旁觀視角
- scale_tag：room（房間級）/ block（街區級）/ city（城市級）/ intercontinental（跨國級）
- shroud：遮蔽難度 0-8，越高調查越難（一般房間 2-3、神秘場所 4-6、禁地 7-8）
- clues_base：基礎線索數 1-5
- clues_per_player：true / false（是否隨玩家人數縮放）
- travel_cost：進入/移動成本 1-3（action_point 類型下通常為 1）
- travel_cost_type：action_point / time
- art_type：none（預設留空）
- design_status：draft（預設）
- design_notes：設計備註（可選，給設計師看的）

## 三、隱藏資訊（選填）
若場景需要隱藏資訊（可被調查揭露的秘密），填 hidden_info 陣列：
[{
  "title_zh": "短標題",
  "description_zh": "揭露時呈現的敘事文字（50-150 字）",
  "reveal_condition_type": "perception_threshold",
  "reveal_condition_params": { "threshold": 3 },
  "reward_type": "narrative_only",
  "reward_params": {}
}]
- reveal_condition_type：perception_threshold（感知門檻 1-10）/ investigation_count（調查次數 1-10）/ manual / none
- reward_type：narrative_only / clue / card / effect（預設 narrative_only 安全，其他型別的 params 交給設計師補）

## 四、使用者需求
${userDescription}

## 五、輸出格式
請回傳嚴格的 JSON${isBatch ? `（陣列長度必須為 ${batchCount}）` : ''}，不要加任何額外文字或 Markdown 標記：

${isBatch ? '[' : ''}{
  "code": "",
  "name_zh": "",
  "name_en": "",
  "description_zh": "",
  "description_en": "",
  "scale_tag": "block",
  "shroud": 3,
  "clues_base": 2,
  "clues_per_player": true,
  "travel_cost": 1,
  "travel_cost_type": "action_point",
  "art_type": "none",
  "design_status": "draft",
  "design_notes": null,
  "hidden_info": []
}${isBatch ? `, ... 共 ${batchCount} 筆]` : ''}

## 六、注意事項
1. 每個地點的 code 必須唯一，批次模式下互不重複
2. shroud 要與場所氛圍一致：公共場所 1-3、半禁區 4-6、禁地 7-8
3. hidden_info 非必填，預設空陣列。有主題暗示時才加
4. description_zh 要有氛圍但不過度血腥
5. 不要使用現代網路用語
${isBatch ? `\n## 七、批次模式\n- 陣列長度嚴格等於 ${batchCount}\n- 所有地點圍繞使用者描述的同一主題，彼此有地理或情境呼應\n- code 必須互不重複` : ''}`;
}

function validateAndFixLocationData(d) {
  if (!d || typeof d !== 'object') return d;
  const validScales = ['room', 'block', 'city', 'intercontinental'];
  if (!validScales.includes(d.scale_tag)) d.scale_tag = 'block';
  d.shroud = Math.max(0, Math.min(8, parseInt(d.shroud, 10) || 2));
  d.clues_base = Math.max(0, Math.min(10, parseInt(d.clues_base, 10) || 1));
  d.travel_cost = Math.max(1, Math.min(5, parseInt(d.travel_cost, 10) || 1));
  const validArtTypes = ['none', 'image_url', 'svg_generated', 'svg_custom'];
  if (!validArtTypes.includes(d.art_type)) d.art_type = 'none';
  const validStatuses = ['draft', 'review', 'approved'];
  if (!validStatuses.includes(d.design_status)) d.design_status = 'draft';
  const validTravelTypes = ['action_point', 'time'];
  if (!validTravelTypes.includes(d.travel_cost_type)) d.travel_cost_type = 'action_point';

  if (Array.isArray(d.hidden_info)) {
    const validReveal = ['perception_threshold', 'investigation_count', 'manual', 'none'];
    const validReward = ['narrative_only', 'clue', 'card', 'effect'];
    d.hidden_info = d.hidden_info.map((h) => {
      if (!h || typeof h !== 'object') return null;
      if (!validReveal.includes(h.reveal_condition_type)) h.reveal_condition_type = 'perception_threshold';
      if (!validReward.includes(h.reward_type)) h.reward_type = 'narrative_only';
      if (h.reveal_condition_type === 'perception_threshold') {
        const t = h.reveal_condition_params?.threshold;
        h.reveal_condition_params = { threshold: Math.max(1, Math.min(10, parseInt(t, 10) || 3)) };
      } else if (h.reveal_condition_type === 'investigation_count') {
        const c = h.reveal_condition_params?.count;
        h.reveal_condition_params = { count: Math.max(1, Math.min(10, parseInt(c, 10) || 2)) };
      } else {
        h.reveal_condition_params = h.reveal_condition_params || {};
      }
      h.reward_params = h.reward_params || {};
      return h;
    }).filter(Boolean);
  } else {
    d.hidden_info = [];
  }
  return d;
}

async function generateLocationViaDirectGemini(userDescription, { model = 'gemini-2.5-pro', batchCount = 1, apiKey } = {}) {
  if (!userDescription || typeof userDescription !== 'string') throw new Error('userDescription 為空');
  const prompt = buildLocationDesignPrompt(userDescription, batchCount);
  const { text, modelName } = await callGeminiDirect({ prompt, model, apiKey });
  const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
  let data;
  try { data = JSON.parse(cleanJson); }
  catch (e) { throw new Error('Gemini 回傳內容不是合法 JSON：' + e.message); }
  const items = Array.isArray(data) ? data.map(validateAndFixLocationData) : [validateAndFixLocationData(data)];
  return { items, modelUsed: modelName };
}

window.buildLocationDesignPrompt = buildLocationDesignPrompt;
window.validateAndFixLocationData = validateAndFixLocationData;
window.generateLocationViaDirectGemini = generateLocationViaDirectGemini;

// ═══════════════════════════════════════════════════════
// MOD-05 戰鬥風格專精 — Combat Specialization
// 設計目標：為「某個風格（8 種固定）」新增一個專精。本模組的 8 風格與 30 固定專精
// 已預建，但使用者可以為特定風格新增額外專精或命名尚未填寫的骨架。
// ═══════════════════════════════════════════════════════
function buildCombatSpecDesignPrompt(userDescription, batchCount = 1) {
  const isBatch = batchCount > 1;
  return `你是克蘇魯卡牌遊戲的戰鬥專精設計助手。為指定的戰鬥風格產出專精資料。

## 一、戰鬥風格體系
遊戲有 8 種戰鬥風格（固定）：
- shooting（射擊）、archery（弓術）、sidearm（手槍）、military（軍武）
- brawl（格鬥）、arcane（奧術）、engineer（工程）、assassin（暗殺）

每種風格下有 3-5 種專精（如射擊下的「精準射手」「狙擊手」「散彈專家」）。

## 二、七大屬性
strength（力）、agility（敏）、constitution（體）、intellect（智）、willpower（志）、perception（感）、charisma（魅）

## 三、專精欄位
- code：小寫英數底線（例：precision_marksman、demolitions_expert）
- name_zh / name_en：中文/英文名稱
- description_zh：專精說明（30-80 字），描述此路線的戰鬥風格取向
- description_en：英文對應
- attribute：主屬性（七大之一，決定檢定骨幹）
- prof_bonus：熟練加值 1-3（基本精通）
- spec_bonus：專精加值 2-5（達到專精境界）

## 四、使用者需求
${userDescription}

## 五、輸出格式
${isBatch ? `陣列，長度嚴格等於 ${batchCount}：` : '單一 JSON 物件：'}
${isBatch ? '[' : ''}{
  "code": "",
  "name_zh": "",
  "name_en": "",
  "description_zh": "",
  "description_en": "",
  "attribute": "agility",
  "prof_bonus": 1,
  "spec_bonus": 3
}${isBatch ? ', ...]' : ''}

## 六、注意事項
1. code 小寫英數底線、唯一、批次內互不重複
2. attribute 必須是七大屬性之一
3. prof_bonus < spec_bonus（專精加值必大於熟練）
4. description_zh 要描述「這條路的人物形象與打法傾向」，不是單純的機制文字
5. 不要填 style_id / combat_style_id（由呼叫端依路徑決定所屬風格）`;
}

function validateAndFixCombatSpecData(d) {
  if (!d || typeof d !== 'object') return d;
  const validAttrs = ['strength', 'agility', 'constitution', 'intellect', 'willpower', 'perception', 'charisma'];
  if (!validAttrs.includes(d.attribute)) d.attribute = 'agility';
  d.prof_bonus = Math.max(1, Math.min(3, parseInt(d.prof_bonus, 10) || 1));
  d.spec_bonus = Math.max(2, Math.min(5, parseInt(d.spec_bonus, 10) || 3));
  if (d.prof_bonus >= d.spec_bonus) d.spec_bonus = d.prof_bonus + 1;
  return d;
}

async function generateCombatSpecViaDirectGemini(userDescription, { model = 'gemini-2.5-pro', batchCount = 1, apiKey } = {}) {
  if (!userDescription || typeof userDescription !== 'string') throw new Error('userDescription 為空');
  const prompt = buildCombatSpecDesignPrompt(userDescription, batchCount);
  const { text, modelName } = await callGeminiDirect({ prompt, model, apiKey });
  const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
  let data;
  try { data = JSON.parse(cleanJson); }
  catch (e) { throw new Error('Gemini 回傳內容不是合法 JSON：' + e.message); }
  const items = Array.isArray(data) ? data.map(validateAndFixCombatSpecData) : [validateAndFixCombatSpecData(data)];
  return { items, modelUsed: modelName };
}

window.buildCombatSpecDesignPrompt = buildCombatSpecDesignPrompt;
window.validateAndFixCombatSpecData = validateAndFixCombatSpecData;
window.generateCombatSpecViaDirectGemini = generateCombatSpecViaDirectGemini;

// ═══════════════════════════════════════════════════════
// MOD-09 鍛造詞條 — Forging Affix
// ═══════════════════════════════════════════════════════
function buildAffixDesignPrompt(userDescription, batchCount = 1) {
  const isBatch = batchCount > 1;
  return `你是克蘇魯卡牌遊戲的鍛造詞條設計助手。為武器/裝備設計新的鍛造詞條。

## 一、五大素材類別（category_code）
- ore（礦物）— 適合護甲、鈍器、金屬武器
- wood（木材）— 適合箭、杖、木盾
- insect（蟲類）— 適合異化詞條（中毒/燃燒/冷凍）
- fish（魚類）— 適合水生/深潛詞條
- monster（怪物素材）— 適合高階 / 奧術詞條

## 二、詞條階級模式（tier_mode）
- scaling：有 +1/+2/+3 三階，V 值遞增（例：利刃 +1/+2/+3 = 傷害 +1/+2/+3）
- fixed：固定效果，無階級（例：快速 — 不消耗行動點）
- choice：玩家從清單選一個（例：蟲淬 II 選中毒/燃燒/冷凍/弱化）

## 三、適用卡片子類型（applicable_subtypes 陣列）
weapon / weapon_melee / weapon_ranged / weapon_arcane / item / arcane_item / consumable / ammo / arrow / spell / light_source / armor / accessory
留空陣列代表通用。

## 四、詞條欄位
- code：小寫英數底線（例：keen_edge、venom_coat）
- name_zh / name_en：詞條中文/英文名稱（簡短 2-6 字）
- category_code：五大素材類別之一
- effect_description_zh / effect_description_en：效果敘述（30-60 字）
- applicable_subtypes：適用卡片子類型陣列
- tier_mode：scaling / fixed / choice
- design_status：pending（預設）
- notes：設計備註（可選）

## 五、tiers 子結構（依 tier_mode 產出對應數量）
- scaling：陣列 3 筆，tier_label 為 "+1"/"+2"/"+3"，affix_value 遞增
- fixed：陣列 1 筆，tier_label 為 "fixed"
- choice：陣列 2-4 筆，每筆 tier_label 為選項名稱，須有 choice_payload

範例 tiers 結構：
"tiers": [
  { "tier_label": "+1", "tier_order": 1, "affix_value": 3, "effect_detail_zh": "傷害 +1", "choice_payload": null },
  { "tier_label": "+2", "tier_order": 2, "affix_value": 6, "effect_detail_zh": "傷害 +2", "choice_payload": null },
  { "tier_label": "+3", "tier_order": 3, "affix_value": 9, "effect_detail_zh": "傷害 +3", "choice_payload": null }
]

## 六、V 值（affix_value）參考
- scaling +1 通常 2-4、+2 為 5-8、+3 為 9-14
- fixed 固定效果通常 5-10
- choice 每個選項 3-6（選擇性由玩家）

## 七、使用者需求
${userDescription}

## 八、輸出格式
${isBatch ? `陣列，長度嚴格等於 ${batchCount}：` : '單一 JSON 物件：'}
${isBatch ? '[' : ''}{
  "code": "",
  "name_zh": "",
  "name_en": "",
  "category_code": "ore",
  "effect_description_zh": "",
  "effect_description_en": "",
  "applicable_subtypes": ["weapon"],
  "tier_mode": "scaling",
  "design_status": "pending",
  "notes": null,
  "tiers": []
}${isBatch ? ', ...]' : ''}

## 九、注意事項
1. tier_mode 與 tiers 結構必須一致（scaling=3 筆、fixed=1 筆、choice=2-4 筆）
2. choice 模式的每筆 tier 要有 choice_payload（例 {"status":"bleed","stacks":1}）
3. V 值要合理（不要給 scaling +1 超過 5 的數值）
4. effect_description_zh 要明確描述「這詞條做什麼」`;
}

function validateAndFixAffixData(d) {
  if (!d || typeof d !== 'object') return d;
  const validCats = ['ore', 'wood', 'insect', 'fish', 'monster'];
  if (!validCats.includes(d.category_code)) d.category_code = 'ore';
  const validModes = ['scaling', 'fixed', 'choice'];
  if (!validModes.includes(d.tier_mode)) d.tier_mode = 'scaling';
  const validStatuses = ['pending', 'partial', 'complete'];
  if (!validStatuses.includes(d.design_status)) d.design_status = 'pending';
  if (!Array.isArray(d.applicable_subtypes)) d.applicable_subtypes = [];

  // tiers 結構校驗
  if (!Array.isArray(d.tiers)) d.tiers = [];
  if (d.tier_mode === 'scaling') {
    // 強制 3 筆
    while (d.tiers.length < 3) {
      d.tiers.push({ tier_label: `+${d.tiers.length + 1}`, tier_order: d.tiers.length + 1, affix_value: (d.tiers.length + 1) * 3, effect_detail_zh: '', choice_payload: null });
    }
    d.tiers = d.tiers.slice(0, 3);
    d.tiers.forEach((t, i) => { t.tier_order = i + 1; t.tier_label = `+${i + 1}`; t.choice_payload = null; });
  } else if (d.tier_mode === 'fixed') {
    if (d.tiers.length === 0) d.tiers = [{ tier_label: 'fixed', tier_order: 1, affix_value: 5, effect_detail_zh: '', choice_payload: null }];
    d.tiers = d.tiers.slice(0, 1);
    d.tiers[0].tier_order = 1;
    d.tiers[0].tier_label = 'fixed';
    d.tiers[0].choice_payload = null;
  } else if (d.tier_mode === 'choice') {
    if (d.tiers.length < 2) {
      // 補足至 2 筆
      while (d.tiers.length < 2) d.tiers.push({ tier_label: `option_${d.tiers.length + 1}`, tier_order: d.tiers.length + 1, affix_value: 4, effect_detail_zh: '', choice_payload: {} });
    }
    d.tiers = d.tiers.slice(0, 4);
    d.tiers.forEach((t, i) => { t.tier_order = i + 1; if (!t.choice_payload) t.choice_payload = {}; });
  }
  d.tiers.forEach((t) => {
    const v = parseFloat(t.affix_value);
    t.affix_value = Number.isFinite(v) ? v : 0;
  });

  return d;
}

async function generateAffixViaDirectGemini(userDescription, { model = 'gemini-2.5-pro', batchCount = 1, apiKey } = {}) {
  if (!userDescription || typeof userDescription !== 'string') throw new Error('userDescription 為空');
  const prompt = buildAffixDesignPrompt(userDescription, batchCount);
  const { text, modelName } = await callGeminiDirect({ prompt, model, apiKey });
  const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
  let data;
  try { data = JSON.parse(cleanJson); }
  catch (e) { throw new Error('Gemini 回傳內容不是合法 JSON：' + e.message); }
  const items = Array.isArray(data) ? data.map(validateAndFixAffixData) : [validateAndFixAffixData(data)];
  return { items, modelUsed: modelName };
}

window.buildAffixDesignPrompt = buildAffixDesignPrompt;
window.validateAndFixAffixData = validateAndFixAffixData;
window.generateAffixViaDirectGemini = generateAffixViaDirectGemini;
