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

// ─── 卡片設計 prompt（複製自 MOD-01 buildGeminiPrompt；新增 batchCount 支援） ──
function buildCardDesignPrompt(userDescription, batchCount = 1) {
  const isBatch = batchCount && batchCount > 1;
  const plural = isBatch ? `${batchCount} 張` : `一張`;
  return `你是一個克蘇魯神話卡牌遊戲的卡片設計師。請根據以下完整規則和使用者需求，生成${plural}**數值平衡**的卡片。

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
14. subtypes 要正確標記（weapon/weapon_melee/weapon_ranged/weapon_arcane/item/arcane_item/consumable/ammo/arrow/spell/light_source）
15. **等級 0 的卡片預設不能有消費能力**：level=0 時 consume_enabled 必須為 false、consume_effect 必須為 null。消費能力屬於進階設計元素，應由使用者升級卡片時（level ≥ 1）自行添加，AI 不可自動填入。${isBatch ? `

## 十一、批次要求（本次為批次模式）
使用者要一次設計 **${batchCount} 張**卡片。嚴格遵守：
1. **回傳 JSON Array**（不是單一 object），陣列長度**必須剛好為 ${batchCount}**
2. 每個元素都是完整的單張卡片 JSON（結構同上面範例）
3. 所有卡片圍繞使用者描述的**同一主題**，彼此之間要有**設計呼應**：
   - 可以是同一陣營極的不同機制切面
   - 可以是互補配合（例如前排坦克 + 後排輸出 + 支援）
   - 可以是費用由低到高的成長階梯
4. 同批次內嚴禁完全重複：費用、等級、效果動詞、卡片類別至少要有變化
5. flavor_text 可有連貫敘事（例如同一事件的不同切角）` : ''}`;
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
async function generateCardViaDirectGemini(userDescription, { model = 'gemini-2.5-pro', batchCount = 1, apiKey } = {}) {
  if (!userDescription || typeof userDescription !== 'string') {
    throw new Error('userDescription 為空');
  }
  const prompt = buildCardDesignPrompt(userDescription, batchCount);
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
   （E=號令、I=深淵、S=鐵證、N=天啟、T=解析、F=聖燼、J=鐵壁、P=流影、neutral=中立）

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
若使用者指定某陣營，就用那個；否則由 MBTI 首字母推導（E→號令極 / I→深淵極 / ...）。

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
