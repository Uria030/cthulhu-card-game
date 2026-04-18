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
  model = 'gemini-2.5-flash',
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

// ─── 卡片設計 prompt（複製自 MOD-01 buildGeminiPrompt） ───────────
function buildCardDesignPrompt(userDescription) {
  return `你是一個克蘇魯神話卡牌遊戲的卡片設計師。請根據以下完整規則和使用者需求，生成一張**數值平衡**的卡片。

## 零、價值計算系統（最重要）

基礎單位：1V = 1 行動點 = 1 資源 = 抽 1 張牌 = 造成 1 點傷害

### 效果價值表（摘要）
- 直接傷害：1V/點、恐懼傷害：3V/點
- 恢復 HP/SAN：1.5V/點
- 抽牌：1V/張、搜尋牌庫找特定卡：6V
- 移動：1V/格、跳躍：2V/格
- 施加燃燒/冷凍/中毒：3V/層、施加標記/發瘋/隱蔽/護盾/再生：6V/層
- 強化/護甲：3V/層、加速：4V/層
- 快速（不用行動點）：+1V、可指定其他調查員：+2V

### 稀有度反推公式
稀有度由效果價值、等級、費用反推：
- 事件卡(1:1)：稀有度抵扣 = 效果總價值 - 等級抵扣 - 費用
- 資產卡(1:1)：稀有度抵扣 = 總輸出價值 - 1V(留場) - 消耗修正 - 等級抵扣 - 費用
- 盟友卡(1:1)：稀有度抵扣 = HP×0.5V + SAN×0.5V + 2V + 能力價值 - 等級抵扣 - 費用
- 技能卡：費用=0，不計稀有度，檢驗價值區間(LV0:2.5-3V, LV2:5-6V, LV3:7-8V, LV5:9-10V)

### 抵扣值對照表（向上進位）
≤0：隨身, 0.1~1：基礎, 1.1~2：標準, 2.1~3：進階, 3.1~4：稀有, 4.1~5：傳奇, >5：超出範圍

### 等級抵扣：0級=0, 1級=-0.5V, 2級=-1V, 3級=-2V, 4級=-3V, 5級=-4V
### 消耗類型修正：留場=-1V, 棄牌=0, 短休息=-1V, 長休息=-2V, 移除=-3V

## 一、遊戲基礎規則

### 骰子與檢定
- 骰子系統：d20
- 檢定公式：d20 + 屬性修正(0~5) + 熟練/專精修正(0~3) + 武器屬性修正(依風格卡決定)
- 自然 20：爆擊，2 倍傷害
- 自然 1：大失敗，可能傷害隊友

### 七大屬性
力量(Strength)、敏捷(Agility)、體質(Constitution)、智力(Intellect)、意志(Willpower)、感知(Perception)、魅力(Charisma)

### 數值規格
- 卡片費用範圍：0-6
- 武器傷害階層：隨身1 / 基礎2 / 標準3 / 進階4 / 稀有5 / 傳奇6
- 檢定加值範圍：0-5
- HP 公式：體質 × 2 + 5（範圍 7-25）
- SAN 公式：意志 × 2 + 5（範圍 7-25）
- 手牌上限：8 張
- 每回合行動點：3 點
- 起始資源：5 點，每回合 +1

## 二、回合結構
1. 回合開始 → 短休息決定
2. 調查員階段（3 行動點）
3. 敵人階段（城主行動 + 神話卡 + Agenda 毀滅標記）
4. 回合結束階段（每人抽 1 張、+1 資源、橫置卡轉正）

## 三、戰鬥風格卡系統

攻擊時，攻擊方抽取一張戰鬥風格卡，決定本次使用哪個屬性檢定。
武器上的屬性修正只在對應屬性被抽到時生效。

### 八種戰鬥風格
shooting（槍枝射擊）、archery（弓術）、sidearm（隨身武器）、military（軍用武器）、brawl（搏擊）、arcane（施法）、engineer（工兵）、assassin（暗殺）

### 武器屬性修正格式
武器不再固定指定檢定屬性，而是記錄對各屬性的修正值：
- 基礎武器（等級 0）通常只有一個屬性修正，例如 {"strength": 1}
- 升級武器可有多屬性修正，例如 {"strength": 2, "willpower": -1}
- 廣度路線使用 {"all": 1} 表示所有檢定 +1
- 負面修正不出現在基礎卡（等級 0）上

### 施法類例外
施法類武器的攻擊使用混沌袋而非擲骰。

## 三之二、法術卡規格
- 法術永遠命中，不擲骰，抽混沌袋決定副作用
- 法術充能（uses）遠少於武器彈藥（ammo）：Tier 1=3-4, Tier 2=3, Tier 3=3, Tier 4-5=2-3, Tier 6=1-2
- 法術傷害低於同階物理武器，但 100% 命中率補償
- 神秘（arcane）元素最強：沒有怪物抗 arcane
- 六種法術類型 spell_type: combat_destruction / investigation_prophecy / protection_evasion / spacetime_planar / summoning_binding / healing_purification
- 五種施法方式 spell_casting: ritual（+1費-1充能×1.5效果）/ incantation（標準）/ channeling（持續需橫置）/ meditation（-1費+1充能×0.8效果）/ alchemy（產出消耗品）
- 法術卡 combat_style 固定為 arcane，slot 固定為 arcane

## 三之三、卡片設計規範摘要
### 費用=價值原則
高費卡做不同的事而非更強版本。事件卡比同效資產卡便宜 1-2。條件效果 -1 費。有負面副作用 -1~-2 費。

### 盟友卡規格
- 費用 2-5，每位調查員場上限 1 盟友
- HP+SAN 預算：費用 2-3 時 ≤5，費用 4-5 時 ≤7
- 盟友攻擊自動命中但傷害 1-3（不超過同費武器）
- 五種類型：坦克(3-4HP/1SAN)、輔助(1HP/3-4SAN)、均衡(2HP/2SAN)、戰鬥(2-3HP/1-2SAN)、工具(1HP/1SAN)

### 技能卡規格
- 費用固定 0，手牌投入檢定加值，用後進棄牌堆
- 加值範圍 +1~+3 單屬性

### 消耗品三級制
- short_rest：短休息回復，標準費用
- discard：進棄牌堆，費用 -1
- removed：永久移除，費用 -2，效果最強

### 弓箭特殊彈藥
- 火箭(費1,3次,火元素,施加燃燒1)、冰箭(費1,3次,冰元素,施加冷凍1)
- 電箭(費2,3次,電元素,對潮濕+2)、毒箭(費1,3次,物理,施加中毒1)
- 銀箭(費2,2次,神秘元素,穿透物理抗性)

## 四、八陣營極定義
| 極 | 名稱 | 機制關鍵字 |
|----|------|-----------|
| E | 號令 | 團隊增益、共享資源、NPC 互動、領導光環 |
| I | 深淵 | 單獨加成、牌庫操控、自我增幅、專精強化 |
| S | 鐵證 | 裝備加成、物理攻擊、消耗品效率、環境互動 |
| N | 天啟 | 混沌袋操控、預見事件、法術強化、預知反應 |
| T | 解析 | 弱點揭露、敵人預測、檢定重擲、資源效率 |
| F | 聖燼 | 治療、替人承傷、犧牲換效果、信念計數器 |
| J | 鐵壁 | 傷害減免、回合佈局、牌組一致性、堅守強化 |
| P | 流影 | 反應行動、棄牌堆回收、隨機獎勵、逆境觸發 |

## 四、卡片分類
### 卡片風格
- AH（直接正面）：直接幫助自己或隊友
- AC（直接負面）：直接傷害或妨礙敵人
- OH（間接正面）：迂迴地創造優勢
- OC（間接負面）：迂迴地製造劣勢

### 卡片類別
- asset（資產）：打出後留在場上
- event（事件）：一次性效果，進棄牌堆
- ally（盟友）：打出後留在場上的 NPC 夥伴
- skill（技能）：專門用於檢定加值

### 特殊身份標記（可疊加）
- is_signature：簽名卡
- is_weakness：弱點
- is_revelation：神啟卡

### 裝備欄位
one_hand, two_hand, head, body, accessory, arcane, talent, expertise, none

### 使用後去向
stay, discard, long_rest, short_rest, removed

## 五、卡片效果語言（核心）
每個效果必須包含六大要素：

### 5.1 觸發時機 (trigger)
on_play, on_commit, on_consume, on_enter_play, on_leave_play, on_draw, on_success, on_failure, on_critical, on_fumble, on_take_damage, on_take_horror, before_take_damage, before_take_horror, before_downed, on_engage, on_disengage, on_move, on_enter_location, on_enemy_spawn, on_enemy_defeat, on_ally_downed, on_turn_start, on_turn_end, on_enemy_phase, reaction, passive, free_action

### 5.2 條件限制 (condition) — 可為 null
while_engaged, while_not_engaged, ally_engaged, hp_below_half, hp_below_x, san_below_half, san_below_x, in_darkness, in_light, in_fire, daytime, nighttime, hand_empty, hand_full, deck_empty, has_weapon, has_ally, has_item, has_arcane_item, has_weakness, at_location_with_clue, at_location_with_enemy, alone_at_location

### 5.3 費用類型 (cost)
resource, forbidden_insight, faith, elder_sign, hp, san, discard_hand, discard_specific, exhaust_self, exhaust_other, ammo, uses, clue, action_point, doom
範例：{ "ammo": 1, "exhaust_self": true }

### 5.4 目標指定 (target)
self, ally_one, ally_all, investigator_any, investigator_all, enemy_one, enemy_all_location, enemy_engaged, enemy_non_elite, enemy_normal, enemy_elite, ally_card, asset_card, location

### 5.5 效果動詞 (effect_code)
deal_damage, deal_horror, heal_hp, heal_san, restore_hp_max, restore_san_max, transfer_damage, transfer_horror, draw_card, reveal_top, search_deck, retrieve_card, return_to_deck, discard_card, shuffle_deck, remove_from_game, gain_resource, spend_resource, steal_resource, transfer_resource, move_investigator, move_enemy, swap_position, place_enemy, jump, engage_enemy, disengage_enemy, exhaust_card, ready_card, stun_enemy, add_status, remove_status, make_test, modify_test, reroll, auto_success, auto_fail, attack, evade, taunt, counterattack, extra_attack, place_clue, discover_clue, place_doom, remove_doom, seal_gate, spawn_enemy, remove_enemy, execute_enemy, reveal_tile, place_tile, remove_tile, place_haunting, remove_haunting, advance_act, advance_agenda, connect_tiles, disconnect_tiles, create_light, extinguish_light, create_darkness, remove_darkness, create_fire, extinguish_fire, add_keyword, remove_keyword, add_bless, add_curse, remove_bless, remove_curse, look_chaos_bag, manipulate_chaos_bag

### 5.6 效果參數 (params)
deal_damage: { amount, element: physical/fire/ice/lightning/arcane, direct?, area? }
add_status: { status, stacks }
search_deck: { count, on_found, on_remaining, filter? }
attack: { check_attribute?, check_modifier? }

### 5.7 持續時間 (duration)
instant, until_end_of_turn, until_end_of_round, until_next_turn, until_end_of_scenario, permanent, while_in_play, x_rounds, until_triggered, once_per_turn, once_per_round, once_per_scenario, until_short_rest, until_long_rest

## 六、元素屬性
physical, fire, ice, lightning, arcane

## 六之二、三合一系統
每張卡片有三種互斥用途：
1. 打出（Play）— 花費資源放到場上或發動效果
2. 加值（Commit）— 檢定前從手牌投入，提供屬性加值，自動進棄牌堆
3. 消費（Consume）— 花 1 行動點棄掉，獲得一次性輔助效果

加值：為卡片設計適合主題的屬性圖示（七大屬性各 0-5），價值不計入打出費用。
消費：從以下合法效果中選一：獲得資源、補充彈藥/充能、回復HP、回復SAN、抽牌、獲得正面狀態、移除負面狀態、取消傷害/恐懼。消費不能是移動、攻擊、調查等基本動作。

## 七、狀態效果
核心規則：所有狀態皆可堆疊。狀態在經歷完整一回合後，於該回合結束階段減少 1 層。
分為兩種：數值型（層數=效果強度）、開關型（效果固定，層數=持續回合數）。
add_status 使用 stacks 欄位表示層數：{ "status": "burning", "stacks": 1 }

數值型負面：poison, bleed, burning, frozen, doom_status, madness, marked, vulnerable, weakness_status, wet, weakened
開關型負面：darkness, disarm, fatigue, silence
數值型正面：empowered, armor, ward, haste, regeneration
特殊型正面：stealth（移動或攻擊後全部移除）

## 八、使用者需求
${userDescription}

## 九、輸出格式
請先計算效果總價值，再設定費用，最後反推稀有度。回傳完全符合以下 JSON 結構的卡片資料，不要回傳任何其他文字：
{
  "name_zh": "", "name_en": "",
  "faction": "E/I/S/N/T/F/J/P/neutral", "style": "AH/AC/OH/OC",
  "type": "asset/event/ally/skill", "slot": "one_hand/none",
  "is_unique": false, "is_signature": false, "is_weakness": false, "is_revelation": false,
  "level": 0, "cost": 3, "cost_currency": "resource",
  "consume_type": "stay/discard/long_rest/short_rest/removed",
  "skill_value": 0, "damage": 0, "horror": 0,
  "health_boost": 0, "sanity_boost": 0,
  "weapon_tier": 0, "ammo": 0, "uses": 0,
  "combat_style": "shooting/archery/sidearm/military/brawl/arcane/engineer/assassin/null",
  "attribute_modifiers": {},
  "spell_type": "combat_destruction/investigation_prophecy/protection_evasion/spacetime_planar/summoning_binding/healing_purification/null",
  "spell_casting": "ritual/incantation/channeling/meditation/alchemy/null",
  "hand_limit_mod": 0,
  "ally_hp": null, "ally_san": null,
  "xp_cost": 0,
  "subtypes": ["weapon", "item"],
  "effects": [{
    "trigger": "free_action", "condition": null,
    "cost": { "ammo": 1, "exhaust_self": true },
    "target": "enemy_one",
    "effect_code": "attack", "params": { "check_attribute": "agility", "check_modifier": 1 },
    "duration": "instant",
    "desc_zh": "中文效果描述", "desc_en": "English effect description"
  }],
  "commit_icons": { "agility": 1 },
  "consume_enabled": true,
  "consume_effect": { "effect_type": "gain_resource", "amount": 2, "value": 2.0 },
  "flavor_text": "",
  "value_calculation": {
    "effects": [{"name": "效果描述", "value": 3}],
    "total_effect_value": 6,
    "level_discount": -2,
    "cost": 2,
    "required_rarity_discount": 2,
    "calculated_rarity": "標準"
  }
}

## 十、重要提醒
1. effect_code 必須從上面的清單中選擇，不要發明新的
2. effects 是陣列，一張卡可以有多個效果
3. 數值要合理：費用 0-6、傷害符合武器階層、檢定加值 0-5
4. combat_style 只有武器卡才需要填寫，非武器卡填 null
5. attribute_modifiers 只有武器卡才需要填寫，非武器卡填 {}
6. 基礎武器（level 0）的 attribute_modifiers 通常只有一個屬性，不含負值
7. 數值要合理：費用 0-6、傷害符合武器階層
8. 風格要符合陣營：參考陣營的風格偏重
9. 武器不再指定固定的檢定屬性，檢定屬性由戰鬥風格卡決定
10. spell_type 和 spell_casting 只有法術卡（combat_style=arcane）才需要填寫
11. 法術卡 slot 固定為 arcane，combat_style 固定為 arcane
12. 盟友卡需填 ally_hp 和 ally_san，HP+SAN 預算不超過 5（低費）或 7（高費）
13. 技能卡費用固定為 0，skill_value 為 +1~+3
14. subtypes 要正確標記（weapon/weapon_melee/weapon_ranged/weapon_arcane/item/arcane_item/consumable/ammo/arrow/spell/light_source）`;
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

  if (d.attribute_modifiers && typeof d.attribute_modifiers === 'object') {
    const validKeys = ['strength','agility','constitution','intellect','willpower','perception','charisma','all'];
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

// ─── 給 MOD-12 的高階 helper：跑完「生卡片」端到端 ─────────────
async function generateCardViaDirectGemini(userDescription, { model = 'gemini-2.5-flash', apiKey } = {}) {
  if (!userDescription || typeof userDescription !== 'string') {
    throw new Error('userDescription 為空');
  }
  const prompt = buildCardDesignPrompt(userDescription);
  const { text, modelName } = await callGeminiDirect({ prompt, model, apiKey });
  const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
  let data;
  try {
    data = JSON.parse(cleanJson);
  } catch (e) {
    throw new Error('Gemini 回傳內容不是合法 JSON：' + e.message);
  }
  // Gemini 可能直接回單張物件，也可能回陣列
  const items = Array.isArray(data) ? data.map(validateAndFixCardData) : [validateAndFixCardData(data)];
  return { items, modelUsed: modelName };
}

window.generateCardViaDirectGemini = generateCardViaDirectGemini;
