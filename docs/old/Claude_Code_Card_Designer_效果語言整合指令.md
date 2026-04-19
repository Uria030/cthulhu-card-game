# Claude Code 指令：卡片設計器效果語言整合
## Card Designer Effect Language Integration Instructions

> **給 Claude Code：** 請對已完成的卡片設計器 (MOD-01) 進行效果語言系統整合。
> 
> 本指令基於《核心設計原則 補充 02：卡片效果語言與狀態系統 v0.1》，
> 將完整的效果語言規範整合到卡片編輯器中，包含：
> 1. **效果區塊 UI 重構** — 從手動輸入改為結構化六大要素表單
> 2. **下拉選單資料系統** — 載入 `effect-language-options.json`
> 3. **Gemini Prompt 升級** — 讓 AI 能生成完全符合規範的結構化效果 JSON
> 4. **描述文字自動生成** — 根據六大要素組合中英文描述
>
> **重要：** 本文件末尾附有完整檢查清單，確保沒有遺漏任何代碼或選項。

---

## 一、效果區塊 UI 重構

### 1.1 現況問題

目前的效果區塊設計過於簡化：
```
觸發時機 (trigger) → 下拉選單（僅 10 個選項）
效果代碼 (effect_code) → 文字輸入（手動輸入，易出錯）
效果參數 (effect_params) → JSON 輸入（手動輸入，格式不統一）
```

### 1.2 新版效果區塊結構

每個效果區塊改為**六大要素的結構化表單**：

```
┌─────────────────────────────────────────────────────────────┐
│ 效果 #1                                            [✕ 刪除] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ ① 觸發時機 (trigger) ─────────────────────────────────────── │
│    [下拉選單：分組顯示，見 effect-language-options.json]     │
│                                                              │
│ ② 條件限制 (condition) ── 可選，可多選 ─────────────────── │
│    [多選下拉或勾選框群組]                                    │
│    若選擇帶參數的條件（如 hp_below_x），顯示數值輸入框       │
│                                                              │
│ ③ 費用類型 (cost) ── 可多選 ────────────────────────────── │
│    [勾選框群組 + 對應數值輸入]                               │
│    ☐ resource [__]  ☐ hp [__]  ☐ san [__]                   │
│    ☐ ammo [__]      ☐ uses [__] ☐ clue [__]                 │
│    ☐ exhaust_self   ☐ action_point [__]  ☐ doom [__]        │
│    ... 其他費用類型                                          │
│                                                              │
│ ④ 目標指定 (target) ─────────────────────────────────────── │
│    [下拉選單：分組顯示]                                      │
│                                                              │
│ ⑤ 效果動詞 (effect_code) ── 核心 ───────────────────────── │
│    [下拉選單：分組顯示，11 大分類]                           │
│                                                              │
│    [動態參數區 effect_params] ← 根據選擇的效果動詞動態顯示   │
│    ┌──────────────────────────────────────────────────────┐ │
│    │ 範例：選擇 deal_damage 後顯示：                       │ │
│    │   · 傷害數值 (amount): [__]                          │ │
│    │   · 元素屬性 (element): [physical ▼]                 │ │
│    │   · 傷害關鍵字: ☐ direct (直擊) ☐ area [__] (廣域)   │ │
│    │                                                       │ │
│    │ 範例：選擇 add_status 後顯示：                        │ │
│    │   · 狀態類型 (status): [poison ▼]                    │ │
│    │   · 狀態數值 (value): [__]                           │ │
│    │                                                       │ │
│    │ 範例：選擇 search_deck 後顯示：                       │ │
│    │   · 搜尋張數 (count): [__]                           │ │
│    │   · 篩選-關鍵字 (filter.keyword): [__]               │ │
│    │   · 篩選-卡片類型 (filter.card_type): [asset ▼]      │ │
│    │   · 篩選-陣營 (filter.faction): [S ▼]                │ │
│    │   · 篩選-費用上限 (filter.cost_max): [__]            │ │
│    │   · 找到後 (on_found): [to_hand ▼]                   │ │
│    │   · 剩餘處理 (on_remaining): [shuffle_back ▼]        │ │
│    └──────────────────────────────────────────────────────┘ │
│                                                              │
│ ⑥ 持續時間 (duration) ──────────────────────────────────── │
│    [下拉選單]                                                │
│    若選擇 x_rounds，顯示回合數輸入框                         │
│    若選擇 once_per_* 系列，顯示範圍選擇：                    │
│      ○ per_investigator (每位調查員各自計算)                │
│      ○ per_team (全團隊共用)                                │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ 中文描述 (desc_zh) ─────────────────────────────────────────│
│ [自動生成，可手動覆寫]                                       │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 花費 1 子彈，橫置：對同板塊一個敵人進行攻擊，命中造成   │ │
│ │ 3 點物理傷害。                                          │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ 英文描述 (desc_en) ─────────────────────────────────────────│
│ [自動生成，可手動覆寫]                                       │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Spend 1 ammo, exhaust: Attack an enemy at your          │ │
│ │ location. Deal 3 physical damage.                       │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│                              [🔄 重新生成描述] [✎ 手動編輯]  │
└─────────────────────────────────────────────────────────────┘

                        [+ 新增效果]
```

### 1.3 動態參數邏輯表

以下定義每個 `effect_code` 需要顯示的參數欄位：

| effect_code | 必填參數 | 選填參數 |
|-------------|----------|----------|
| `deal_damage` | `amount` (數值), `element` (元素下拉) | `direct` (勾選), `area` (勾選+數值) |
| `deal_horror` | `amount` (數值) | `direct` (勾選), `area` (勾選+數值) |
| `heal_hp` | `amount` (數值) | — |
| `heal_san` | `amount` (數值) | — |
| `restore_hp_max` | `amount` (數值) | — |
| `restore_san_max` | `amount` (數值) | — |
| `transfer_damage` | `amount` (數值), `from` (目標), `to` (目標) | — |
| `transfer_horror` | `amount` (數值), `from` (目標), `to` (目標) | — |
| `draw_card` | `amount` (數值) | — |
| `reveal_top` | `count` (數值) | — |
| `search_deck` | `count` (數值), `on_found` (下拉), `on_remaining` (下拉) | `filter.keyword`, `filter.card_type`, `filter.faction`, `filter.cost_max` |
| `retrieve_card` | `from` (下拉: discard/removed), `filter` (同上) | — |
| `return_to_deck` | `count` (數值) | — |
| `discard_card` | `count` (數值) | `random` (勾選) |
| `shuffle_deck` | — | — |
| `remove_from_game` | — | — |
| `gain_resource` | `amount` (數值), `type` (資源類型下拉) | — |
| `spend_resource` | `amount` (數值), `type` (資源類型下拉) | — |
| `steal_resource` | `amount` (數值), `type` (資源類型下拉) | — |
| `transfer_resource` | `amount` (數值), `type` (資源類型下拉) | — |
| `move_investigator` | `distance` (數值) | `ignore_enemy` (勾選) |
| `move_enemy` | `distance` (數值), `direction` (下拉: away/toward) | — |
| `swap_position` | — | — |
| `place_enemy` | `enemy_id` (文字) | — |
| `jump` | `distance` (數值) | — |
| `engage_enemy` | — | — |
| `disengage_enemy` | — | — |
| `exhaust_card` | — | — |
| `ready_card` | — | — |
| `stun_enemy` | — | — |
| `add_status` | `status` (狀態下拉), `value` (數值) | — |
| `remove_status` | `status` (狀態下拉) | — |
| `make_test` | `attribute` (屬性下拉), `difficulty` (數值) | `modifier` (數值) |
| `modify_test` | `modifier` (數值) | `attribute` (屬性下拉, 限定特定屬性) |
| `reroll` | — | `keep_better` (勾選) |
| `auto_success` | — | — |
| `auto_fail` | — | — |
| `attack` | — | `check_attribute` (屬性下拉), `check_modifier` (數值) |
| `evade` | — | `check_modifier` (數值) |
| `taunt` | — | — |
| `counterattack` | `damage` (數值) | `element` (元素下拉) |
| `extra_attack` | — | — |
| `place_clue` | `amount` (數值) | — |
| `discover_clue` | `amount` (數值) | — |
| `place_doom` | `amount` (數值) | — |
| `remove_doom` | `amount` (數值) | — |
| `seal_gate` | — | — |
| `spawn_enemy` | `enemy_id` (文字) | `location` (文字) |
| `remove_enemy` | — | — |
| `execute_enemy` | — | `hp_threshold` (數值, 低於此 HP 才能斬殺) |
| `reveal_tile` | — | — |
| `place_tile` | `tile_id` (文字) | — |
| `remove_tile` | — | — |
| `place_haunting` | `enemy_id` (文字) | — |
| `remove_haunting` | — | — |
| `advance_act` | — | — |
| `advance_agenda` | — | — |
| `connect_tiles` | `tile_a` (文字), `tile_b` (文字) | — |
| `disconnect_tiles` | `tile_a` (文字), `tile_b` (文字) | — |
| `create_light` | `radius` (數值) | `duration` (數值, 回合數) |
| `extinguish_light` | — | — |
| `create_darkness` | — | — |
| `remove_darkness` | — | — |
| `create_fire` | — | — |
| `extinguish_fire` | — | — |
| `add_keyword` | `keyword` (文字) | — |
| `remove_keyword` | `keyword` (文字) | — |
| `add_bless` | `amount` (數值) | — |
| `add_curse` | `amount` (數值) | — |
| `remove_bless` | `amount` (數值) | — |
| `remove_curse` | `amount` (數值) | — |
| `look_chaos_bag` | `count` (數值) | — |
| `manipulate_chaos_bag` | `action` (下拉: remove/replace/reorder) | `token_type` (文字) |

---

## 二、下拉選單資料系統

### 2.1 資料檔案

建立 `/packages/client/public/admin/data/effect-language-options.json`，包含所有下拉選單的選項。

Claude Code 應根據本文件第六章的完整檢查清單，確保 JSON 檔案包含所有代碼。

### 2.2 載入方式

```javascript
// 在 admin-card-designer.html 或 admin-shared.js 中
let effectLanguageOptions = null;

async function loadEffectLanguageOptions() {
  const response = await fetch('./data/effect-language-options.json');
  effectLanguageOptions = await response.json();
}

// 頁面載入時呼叫
document.addEventListener('DOMContentLoaded', async () => {
  await loadEffectLanguageOptions();
  // ... 其他初始化
});
```

### 2.3 下拉選單渲染

```javascript
function renderGroupedSelect(selectElement, optionGroups) {
  selectElement.innerHTML = '';
  
  for (const [groupName, options] of Object.entries(optionGroups)) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = groupName;
    
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt.code;
      option.textContent = `${opt.zh} (${opt.code})`;
      optgroup.appendChild(option);
    }
    
    selectElement.appendChild(optgroup);
  }
}
```

---

## 三、Gemini Prompt 升級

### 3.1 完整 Prompt 模板

以下是升級後的完整 Gemini Prompt，包含所有效果語言規範：

```javascript
function buildGeminiPrompt(userDescription) {
  return `你是一個克蘇魯神話卡牌遊戲的卡片設計師。請根據以下完整規則和使用者需求，生成一張完全符合規範的卡片。

## 一、遊戲基礎規則

### 骰子與檢定
- 骰子系統：d20
- 檢定公式：d20 + 屬性修正(0~5) + 熟練/專精(0~3) + 裝備/卡牌加值(0~4)
- 自然 20：爆擊，2 倍傷害
- 自然 1：大失敗，可能傷害隊友

### 七大屬性
力量(Strength)、敏捷(Agility)、體質(Constitution)、智力(Intellect)、意志(Willpower)、感知(Perception)、魅力(Charisma)

### 數值規格
- 卡片費用範圍：0–6
- 武器傷害階層：隨身1 / 基礎2 / 標準3 / 進階4 / 稀有5 / 傳奇6
- 檢定加值範圍：0–5
- HP 公式：體質 × 2 + 5（範圍 7–25）
- SAN 公式：意志 × 2 + 5（範圍 7–25）
- 手牌上限：8 張
- 每回合行動點：3 點
- 起始資源：5 點，每回合 +1

## 二、回合結構

1. 回合開始 → 短休息決定
2. 調查員階段（3 行動點，可執行：拿資源、抽牌、打牌、攻擊、移動、調查、嘲諷、閃避、執行卡片行動）
3. 敵人階段（城主行動 + 神話卡 + Agenda 毀滅標記）
4. 回合結束階段（每人抽 1 張、+1 資源、橫置卡轉正）

## 三、八陣營極定義

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

### 卡片風格（效果方向）
- A+H（直接正面）：直接幫助自己或隊友
- A+C（直接負面）：直接傷害或妨礙敵人
- O+H（間接正面）：迂迴地創造優勢
- O+C（間接負面）：迂迴地製造劣勢

### 卡片類別（存在形式）
- asset（資產）：打出後留在場上
- event（事件）：一次性效果，進棄牌堆
- ally（盟友）：打出後留在場上的 NPC 夥伴
- skill（技能）：專門用於檢定加值

### 特殊身份標記（可疊加）
- is_signature：簽名卡，調查員獨有
- is_weakness：弱點，強制納入的負面卡
- is_revelation：神啟卡，抽到即觸發的詛咒

### 裝備欄位
one_hand（單手）、two_hand（雙手）、head（帽子）、body（身體）、accessory（配件）、arcane（神秘）、talent（天賦）、expertise（專長）

### 使用後去向
stay（留在場上）、discard（進棄牌堆）、long_rest（長休息回復）、short_rest（短休息回復）、removed（移除出遊戲）

## 五、卡片效果語言（核心）

每個效果必須包含六大要素，請嚴格使用以下代碼：

### 5.1 觸發時機 (trigger)
**卡片生命週期：** on_play, on_commit, on_consume, on_enter_play, on_leave_play, on_draw
**檢定相關：** on_success, on_failure, on_critical, on_fumble
**傷害相關：** on_take_damage, on_take_horror
**交戰與移動：** on_engage, on_disengage, on_move, on_enter_location
**敵人相關：** on_enemy_spawn, on_enemy_defeat, on_ally_downed
**回合節奏：** on_turn_start, on_turn_end, on_enemy_phase
**行動模式：** reaction, passive, free_action

### 5.2 條件限制 (condition) — 可為 null
**交戰：** while_engaged, while_not_engaged, ally_engaged
**血量：** hp_below_half, hp_below_x, san_below_half, san_below_x
**光照：** in_darkness, in_light, in_fire
**時間：** daytime, nighttime
**卡牌：** hand_empty, hand_full, deck_empty, has_weapon, has_ally, has_item, has_arcane_item, has_weakness
**位置：** at_location_with_clue, at_location_with_enemy, alone_at_location, at_location_with_hidden_clue, at_location_with_hidden_info

### 5.3 費用類型 (cost) — 物件格式
resource, forbidden_insight, faith, elder_sign, hp, san, discard_hand, discard_specific, exhaust_self, exhaust_other, ammo, uses, clue, action_point, doom

範例：{ "ammo": 1, "exhaust_self": true }

### 5.4 目標指定 (target)
**調查員：** self, ally_one, ally_all, investigator_any, investigator_all
**敵人：** enemy_one, enemy_all_location, enemy_engaged, enemy_non_elite, enemy_normal, enemy_elite
**場景：** ally_card, asset_card, location

### 5.5 效果動詞 (effect_code) — 只能使用以下代碼

**傷害類：** deal_damage, deal_horror
**恢復類：** heal_hp, heal_san, restore_hp_max, restore_san_max, transfer_damage, transfer_horror
**卡牌操作：** draw_card, reveal_top, search_deck, retrieve_card, return_to_deck, discard_card, shuffle_deck, remove_from_game
**資源類：** gain_resource, spend_resource, steal_resource, transfer_resource
**移動類：** move_investigator, move_enemy, swap_position, place_enemy, jump
**狀態類：** engage_enemy, disengage_enemy, exhaust_card, ready_card, stun_enemy, add_status, remove_status
**檢定類：** make_test, modify_test, reroll, auto_success, auto_fail
**戰鬥類：** attack, evade, taunt, counterattack, extra_attack
**環境類：** place_clue, discover_clue, place_doom, remove_doom, seal_gate, spawn_enemy, remove_enemy, execute_enemy, reveal_tile, place_tile, remove_tile, place_haunting, remove_haunting, advance_act, advance_agenda, connect_tiles, disconnect_tiles
**光照類：** create_light, extinguish_light, create_darkness, remove_darkness, create_fire, extinguish_fire
**特殊類：** add_keyword, remove_keyword, add_bless, add_curse, remove_bless, remove_curse, look_chaos_bag, manipulate_chaos_bag

### 5.6 效果參數 (params) — 根據 effect_code 填寫

**deal_damage 必填：** amount (數值), element (physical/fire/ice/lightning/arcane)
**deal_damage 選填：** direct (布林), area (數值)
**add_status 必填：** status (狀態代碼), value (數值)
**search_deck 必填：** count, on_found (to_hand/to_play/to_engaged), on_remaining (shuffle_back/to_bottom/to_discard)
**search_deck 選填：** filter.keyword, filter.card_type, filter.faction, filter.cost_max

### 5.7 持續時間 (duration)
instant, until_end_of_turn, until_end_of_round, until_next_turn, until_end_of_scenario, permanent, while_in_play, x_rounds, until_triggered, once_per_turn, once_per_round, once_per_scenario, until_short_rest, until_long_rest

若為 once_per_* 系列，需額外指定 scope: per_investigator 或 per_team

## 六、元素屬性
physical（物理）、fire（火）、ice（冰）、lightning（電）、arcane（神秘）

## 七、狀態效果

### 負面狀態
poison（中毒）、bleed（流血）、burning（燃燒）、frozen（冷凍）、darkness（黑暗）、disarm（繳械）、doom_status（毀滅）、fatigue（疲勞）、madness（發瘋）、marked（標記）、vulnerable（脆弱）、silence（沈默）、weakness_status（無力）、wet（潮濕）、weakened（弱化）

### 正面狀態
empowered（強化）、armor（護甲）、ward（護盾）、stealth（隱蔽）、haste（加速）、regeneration（再生）

## 八、使用者需求

${userDescription}

## 九、輸出格式

請回傳完全符合以下 JSON 結構的卡片資料，**不要回傳任何其他文字**：

\`\`\`json
{
  "code": "自動生成，留空",
  "name_zh": "中文名稱",
  "name_en": "English Name",
  "faction": "E/I/S/N/T/F/J/P/neutral",
  "style": "AH/AC/OH/OC",
  "type": "asset/event/ally/skill",
  "slot": "one_hand/two_hand/head/body/accessory/arcane/talent/expertise/none",
  "is_unique": false,
  "is_signature": false,
  "is_weakness": false,
  "is_revelation": false,
  "level": 0,
  "cost": 3,
  "cost_currency": "resource",
  "skill_value": 1,
  "damage": 0,
  "horror": 0,
  "health_boost": 0,
  "sanity_boost": 0,
  "weapon_tier": null,
  "ammo": null,
  "uses": null,
  "consume_type": "stay/discard/long_rest/short_rest/removed",
  "check_attribute": "agility/strength/intellect/willpower/perception/charisma/constitution/none",
  "check_modifier": 0,
  "ally_hp": null,
  "ally_san": null,
  "effects": [
    {
      "trigger": "觸發時機代碼",
      "condition": null,
      "cost": { "費用類型": 數值 },
      "target": "目標代碼",
      "effect_code": "效果動詞代碼",
      "params": { "參數名": "參數值" },
      "duration": "持續時間代碼",
      "scope": "per_investigator/per_team（僅 once_per_* 需要）",
      "desc_zh": "中文效果描述",
      "desc_en": "English effect description"
    }
  ],
  "flavor_text": "風味文字",
  "subtypes": ["weapon", "weapon_ranged", "item"]
}
\`\`\`

## 十、重要提醒

1. **effect_code 必須從上面的清單中選擇**，不要發明新的代碼
2. **所有代碼使用小寫和底線**
3. **effects 是陣列**，一張卡可以有多個效果
4. **params 的結構取決於 effect_code**
5. **condition 可以是 null**
6. **cost 是物件格式**，如 { "ammo": 1, "exhaust_self": true }
7. **數值要合理**：費用 0-6、傷害符合武器階層、檢定加值 0-5
8. **風格要符合陣營**：參考陣營的風格偏重
`;
}
```

### 3.2 API 呼叫更新

```javascript
async function generateCardWithGemini(userDescription) {
  const apiKey = localStorage.getItem('gemini_api_key');
  if (!apiKey) {
    alert('請先設定 Gemini API Key');
    return null;
  }

  const prompt = buildGeminiPrompt(userDescription);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7
          }
        })
      }
    );

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      throw new Error('Gemini 未回傳內容');
    }

    // 清理並解析 JSON
    const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
    const cardData = JSON.parse(cleanJson);

    // 驗證並修正
    return validateAndFixCardData(cardData);

  } catch (error) {
    console.error('Gemini API 錯誤:', error);
    alert('生成失敗：' + error.message);
    return null;
  }
}
```

### 3.3 後處理驗證

```javascript
function validateAndFixCardData(cardData) {
  // 驗證 effect_code 是否在合法清單中
  const validEffectCodes = new Set([
    // 傷害類
    'deal_damage', 'deal_horror',
    // 恢復類
    'heal_hp', 'heal_san', 'restore_hp_max', 'restore_san_max', 'transfer_damage', 'transfer_horror',
    // 卡牌操作類
    'draw_card', 'reveal_top', 'search_deck', 'retrieve_card', 'return_to_deck', 'discard_card', 'shuffle_deck', 'remove_from_game',
    // 資源類
    'gain_resource', 'spend_resource', 'steal_resource', 'transfer_resource',
    // 移動類
    'move_investigator', 'move_enemy', 'swap_position', 'place_enemy', 'jump',
    // 狀態類
    'engage_enemy', 'disengage_enemy', 'exhaust_card', 'ready_card', 'stun_enemy', 'add_status', 'remove_status',
    // 檢定類
    'make_test', 'modify_test', 'reroll', 'auto_success', 'auto_fail',
    // 戰鬥類
    'attack', 'evade', 'taunt', 'counterattack', 'extra_attack',
    // 環境類
    'place_clue', 'discover_clue', 'place_doom', 'remove_doom', 'seal_gate', 'spawn_enemy', 'remove_enemy', 'execute_enemy', 'reveal_tile', 'place_tile', 'remove_tile', 'place_haunting', 'remove_haunting', 'advance_act', 'advance_agenda', 'connect_tiles', 'disconnect_tiles',
    // 光照類
    'create_light', 'extinguish_light', 'create_darkness', 'remove_darkness', 'create_fire', 'extinguish_fire',
    // 特殊類
    'add_keyword', 'remove_keyword', 'add_bless', 'add_curse', 'remove_bless', 'remove_curse', 'look_chaos_bag', 'manipulate_chaos_bag'
  ]);

  // 驗證每個效果
  if (cardData.effects) {
    for (const effect of cardData.effects) {
      if (!validEffectCodes.has(effect.effect_code)) {
        console.warn(`無效的 effect_code: ${effect.effect_code}，已標記待修正`);
        effect._invalid = true;
      }
    }
  }

  // 數值範圍修正
  if (cardData.cost < 0) cardData.cost = 0;
  if (cardData.cost > 6) cardData.cost = 6;
  if (cardData.skill_value < 0) cardData.skill_value = 0;
  if (cardData.skill_value > 5) cardData.skill_value = 5;

  return cardData;
}
```

---

## 四、描述文字自動生成

### 4.1 生成邏輯

```javascript
function generateEffectDescription(effect, lang = 'zh') {
  const templates = {
    zh: {
      // 費用模板
      cost: {
        ammo: (n) => `消耗 ${n} 彈藥`,
        uses: (n) => `消耗 ${n} 次使用`,
        resource: (n) => `花費 ${n} 資源`,
        hp: (n) => `支付 ${n} 點 HP`,
        san: (n) => `支付 ${n} 點 SAN`,
        exhaust_self: () => `橫置此卡`,
        action_point: (n) => `花費 ${n} 行動點`,
        clue: (n) => `花費 ${n} 線索`,
        doom: (n) => `放置 ${n} 毀滅標記`
      },
      // 目標模板
      target: {
        self: '你',
        ally_one: '一位隊友',
        ally_all: '同板塊所有隊友',
        investigator_any: '任一調查員',
        investigator_all: '所有調查員',
        enemy_one: '同板塊一個敵人',
        enemy_all_location: '同板塊所有敵人',
        enemy_engaged: '與你交戰的敵人',
        location: '你所在的板塊'
      },
      // 效果模板
      effect: {
        deal_damage: (p) => `造成 ${p.amount} 點${elementName(p.element, 'zh')}傷害`,
        deal_horror: (p) => `造成 ${p.amount} 點恐懼傷害`,
        heal_hp: (p) => `恢復 ${p.amount} 點 HP`,
        heal_san: (p) => `恢復 ${p.amount} 點 SAN`,
        draw_card: (p) => `抽 ${p.amount} 張卡`,
        gain_resource: (p) => `獲得 ${p.amount} 資源`,
        add_status: (p) => `施加${statusName(p.status, 'zh')} ${p.value || ''}`,
        attack: (p) => `進行攻擊${p.check_modifier ? `（${p.check_attribute || ''}+${p.check_modifier}）` : ''}`,
        evade: (p) => `進行閃避檢定`,
        move_investigator: (p) => `移動最多 ${p.distance} 個板塊`,
        jump: (p) => `跳躍移動 ${p.distance} 個板塊（不觸發交戰）`
        // ... 其他效果模板
      },
      // 持續時間模板
      duration: {
        instant: '',
        until_end_of_turn: '直到回合結束',
        until_end_of_round: '直到輪結束',
        while_in_play: '只要此卡在場上',
        once_per_turn: '每回合一次',
        until_short_rest: '直到短休息'
      }
    },
    en: {
      // 英文模板（結構同上）
      // ...
    }
  };

  const t = templates[lang];
  const parts = [];

  // 組合費用
  if (effect.cost) {
    const costParts = [];
    for (const [type, value] of Object.entries(effect.cost)) {
      if (t.cost[type]) {
        costParts.push(typeof t.cost[type] === 'function' ? t.cost[type](value) : t.cost[type]());
      }
    }
    if (costParts.length > 0) {
      parts.push(costParts.join('，') + '：');
    }
  }

  // 組合效果
  if (t.effect[effect.effect_code]) {
    const effectText = t.effect[effect.effect_code](effect.params || {});
    const targetText = t.target[effect.target] || '';
    parts.push(`對${targetText}${effectText}`);
  }

  // 組合持續時間
  if (effect.duration && t.duration[effect.duration]) {
    parts.push(t.duration[effect.duration]);
  }

  return parts.join('').replace(/^對你/, '');
}

function elementName(code, lang) {
  const names = {
    zh: { physical: '物理', fire: '火焰', ice: '冰冷', lightning: '電擊', arcane: '神秘' },
    en: { physical: 'physical', fire: 'fire', ice: 'ice', lightning: 'lightning', arcane: 'arcane' }
  };
  return names[lang][code] || code;
}

function statusName(code, lang) {
  const names = {
    zh: {
      poison: '中毒', bleed: '流血', burning: '燃燒', frozen: '冷凍',
      empowered: '強化', armor: '護甲', stealth: '隱蔽'
      // ... 其他狀態
    }
  };
  return names[lang]?.[code] || code;
}
```

---

## 五、資料庫欄位補充

### 5.1 card_effects 表結構調整

現有的 `card_effects` 表可能需要擴充以支援完整的六大要素：

```sql
-- 若原本結構過於簡化，建議調整為：
ALTER TABLE card_effects ADD COLUMN IF NOT EXISTS condition JSONB;
ALTER TABLE card_effects ADD COLUMN IF NOT EXISTS cost JSONB;
ALTER TABLE card_effects ADD COLUMN IF NOT EXISTS target VARCHAR(32);
ALTER TABLE card_effects ADD COLUMN IF NOT EXISTS duration VARCHAR(32);
ALTER TABLE card_effects ADD COLUMN IF NOT EXISTS scope VARCHAR(16);

-- 或者保持 effect_params 為 JSONB，將所有額外資訊存入其中
```

### 5.2 物品子類型欄位

`card_definitions` 表需要支援 `subtypes` 陣列：

```sql
ALTER TABLE card_definitions ADD COLUMN IF NOT EXISTS subtypes TEXT[];
```

合法的子類型代碼：
- `item`（一般物品）
- `arcane_item`（魔法物品）
- `weapon`（武器）
- `weapon_melee`（近戰武器）
- `weapon_ranged`（遠程武器）
- `weapon_arcane`（法術武器）
- `consumable`（消耗品）
- `light_source`（光源）

---

## 六、完整檢查清單

### 6.1 觸發時機 (trigger) — 共 23 項

**卡片生命週期（6 項）：**
- [ ] `on_play` — 打出時
- [ ] `on_commit` — 加值投入時
- [ ] `on_consume` — 消費時
- [ ] `on_enter_play` — 進場時
- [ ] `on_leave_play` — 離場時
- [ ] `on_draw` — 被抽到時

**檢定相關（4 項）：**
- [ ] `on_success` — 檢定成功時
- [ ] `on_failure` — 檢定失敗時
- [ ] `on_critical` — 大成功時
- [ ] `on_fumble` — 大失敗時

**傷害相關（2 項）：**
- [ ] `on_take_damage` — 受到傷害時
- [ ] `on_take_horror` — 受到恐懼時

**交戰與移動（4 項）：**
- [ ] `on_engage` — 進入交戰時
- [ ] `on_disengage` — 脫離交戰時
- [ ] `on_move` — 移動時
- [ ] `on_enter_location` — 進入板塊時

**敵人相關（3 項）：**
- [ ] `on_enemy_spawn` — 敵人出現時
- [ ] `on_enemy_defeat` — 敵人被擊敗時
- [ ] `on_ally_downed` — 隊友倒地時

**回合節奏（3 項）：**
- [ ] `on_turn_start` — 回合開始時
- [ ] `on_turn_end` — 回合結束時
- [ ] `on_enemy_phase` — 敵人階段時

**行動模式（3 項）：**
- [ ] `reaction` — 反應
- [ ] `passive` — 被動
- [ ] `free_action` — 免費行動

---

### 6.2 條件限制 (condition) — 共 21 項

**交戰相關（3 項）：**
- [ ] `while_engaged` — 交戰中
- [ ] `while_not_engaged` — 未交戰
- [ ] `ally_engaged` — 隊友交戰中

**血量相關（4 項）：**
- [ ] `hp_below_half` — HP 低於一半
- [ ] `hp_below_x` — HP 低於 X
- [ ] `san_below_half` — SAN 低於一半
- [ ] `san_below_x` — SAN 低於 X

**光照相關（3 項）：**
- [ ] `in_darkness` — 黑暗中
- [ ] `in_light` — 光照中
- [ ] `in_fire` — 失火中

**時間相關（2 項）：**
- [ ] `daytime` — 白天
- [ ] `nighttime` — 夜間

**卡牌相關（8 項）：**
- [ ] `hand_empty` — 手牌為零
- [ ] `hand_full` — 手牌達上限
- [ ] `deck_empty` — 牌庫為空
- [ ] `has_weapon` — 有武器
- [ ] `has_ally` — 有盟友
- [ ] `has_item` — 有一般物品
- [ ] `has_arcane_item` — 有魔法物品
- [ ] `has_weakness` — 有弱點

**位置相關（5 項）：**
- [ ] `at_location_with_clue` — 板塊有線索
- [ ] `at_location_with_enemy` — 板塊有敵人
- [ ] `alone_at_location` — 獨自在板塊
- [ ] `at_location_with_hidden_clue` — 板塊有隱藏線索
- [ ] `at_location_with_hidden_info` — 板塊有隱藏資訊

---

### 6.3 費用類型 (cost) — 共 15 項

- [ ] `resource` — 資源
- [ ] `forbidden_insight` — 禁忌洞察
- [ ] `faith` — 信仰
- [ ] `elder_sign` — 遠古印記
- [ ] `hp` — 生命值
- [ ] `san` — 理智值
- [ ] `discard_hand` — 棄手牌
- [ ] `discard_specific` — 棄指定牌
- [ ] `exhaust_self` — 橫置此卡
- [ ] `exhaust_other` — 橫置其他卡
- [ ] `ammo` — 彈藥
- [ ] `uses` — 使用次數
- [ ] `clue` — 線索
- [ ] `action_point` — 行動點
- [ ] `doom` — 毀滅標記

---

### 6.4 目標指定 (target) — 共 14 項

**調查員目標（5 項）：**
- [ ] `self` — 自己
- [ ] `ally_one` — 一位隊友
- [ ] `ally_all` — 同板塊所有隊友
- [ ] `investigator_any` — 任一調查員
- [ ] `investigator_all` — 所有調查員

**敵人目標（6 項）：**
- [ ] `enemy_one` — 一個敵人
- [ ] `enemy_all_location` — 同板塊所有敵人
- [ ] `enemy_engaged` — 交戰中的敵人
- [ ] `enemy_non_elite` — 精英以下敵人
- [ ] `enemy_normal` — 普通敵人
- [ ] `enemy_elite` — 精英以上敵人

**卡片與場景目標（3 項）：**
- [ ] `ally_card` — 盟友卡
- [ ] `asset_card` — 資產卡
- [ ] `location` — 地圖板塊

---

### 6.5 效果動詞 (effect_code) — 共 62 項

**傷害類（2 項）：**
- [ ] `deal_damage` — 造成傷害
- [ ] `deal_horror` — 造成恐懼

**恢復類（6 項）：**
- [ ] `heal_hp` — 恢復 HP
- [ ] `heal_san` — 恢復 SAN
- [ ] `restore_hp_max` — 恢復 HP 上限
- [ ] `restore_san_max` — 恢復 SAN 上限
- [ ] `transfer_damage` — 轉移傷害
- [ ] `transfer_horror` — 轉移恐懼

**卡牌操作類（8 項）：**
- [ ] `draw_card` — 抽牌
- [ ] `reveal_top` — 翻開牌庫頂
- [ ] `search_deck` — 搜尋牌庫
- [ ] `retrieve_card` — 回收卡片
- [ ] `return_to_deck` — 洗回牌庫
- [ ] `discard_card` — 棄牌
- [ ] `shuffle_deck` — 洗牌庫
- [ ] `remove_from_game` — 移除出遊戲

**資源類（4 項）：**
- [ ] `gain_resource` — 獲得資源
- [ ] `spend_resource` — 花費資源
- [ ] `steal_resource` — 偷取資源
- [ ] `transfer_resource` — 轉移資源

**移動類（5 項）：**
- [ ] `move_investigator` — 移動調查員
- [ ] `move_enemy` — 移動敵人
- [ ] `swap_position` — 交換位置
- [ ] `place_enemy` — 放置敵人
- [ ] `jump` — 跳躍移動

**狀態類（7 項）：**
- [ ] `engage_enemy` — 進入交戰
- [ ] `disengage_enemy` — 脫離交戰
- [ ] `exhaust_card` — 橫置卡片
- [ ] `ready_card` — 轉正卡片
- [ ] `stun_enemy` — 絆倒敵人
- [ ] `add_status` — 添加狀態
- [ ] `remove_status` — 移除狀態

**檢定類（5 項）：**
- [ ] `make_test` — 進行檢定
- [ ] `modify_test` — 修改檢定值
- [ ] `reroll` — 重擲
- [ ] `auto_success` — 自動成功
- [ ] `auto_fail` — 自動失敗

**戰鬥類（5 項）：**
- [ ] `attack` — 攻擊
- [ ] `evade` — 閃避
- [ ] `taunt` — 嘲諷
- [ ] `counterattack` — 反擊
- [ ] `extra_attack` — 額外攻擊

**環境類（17 項）：**
- [ ] `place_clue` — 放置線索
- [ ] `discover_clue` — 發現線索
- [ ] `place_doom` — 放置毀滅標記
- [ ] `remove_doom` — 移除毀滅標記
- [ ] `seal_gate` — 封印次元門
- [ ] `spawn_enemy` — 生成敵人
- [ ] `remove_enemy` — 移除敵人
- [ ] `execute_enemy` — 斬殺敵人
- [ ] `reveal_tile` — 翻開板塊
- [ ] `place_tile` — 放置板塊
- [ ] `remove_tile` — 移除板塊
- [ ] `place_haunting` — 放置鬧鬼
- [ ] `remove_haunting` — 移除鬧鬼
- [ ] `advance_act` — 推進行動牌堆
- [ ] `advance_agenda` — 推進議程牌堆
- [ ] `connect_tiles` — 建立連接
- [ ] `disconnect_tiles` — 斷開連接

**光照類（6 項）：**
- [ ] `create_light` — 創造光源
- [ ] `extinguish_light` — 熄滅光源
- [ ] `create_darkness` — 製造黑暗
- [ ] `remove_darkness` — 移除黑暗
- [ ] `create_fire` — 引發火災
- [ ] `extinguish_fire` — 撲滅火災

**特殊類（8 項）：**
- [ ] `add_keyword` — 添加詞綴
- [ ] `remove_keyword` — 移除詞綴
- [ ] `add_bless` — 放入祝福
- [ ] `add_curse` — 放入詛咒
- [ ] `remove_bless` — 移除祝福
- [ ] `remove_curse` — 移除詛咒
- [ ] `look_chaos_bag` — 窺探混沌袋
- [ ] `manipulate_chaos_bag` — 操控混沌袋

---

### 6.6 持續時間 (duration) — 共 14 項

- [ ] `instant` — 即時
- [ ] `until_end_of_turn` — 到回合結束
- [ ] `until_end_of_round` — 到輪結束
- [ ] `until_next_turn` — 到下回合開始
- [ ] `until_end_of_scenario` — 到場景結束
- [ ] `permanent` — 永久
- [ ] `while_in_play` — 在場期間
- [ ] `x_rounds` — X 回合
- [ ] `until_triggered` — 到條件觸發
- [ ] `once_per_turn` — 每回合一次
- [ ] `once_per_round` — 每輪一次
- [ ] `once_per_scenario` — 每場景一次
- [ ] `until_short_rest` — 到短休息
- [ ] `until_long_rest` — 到長休息

**使用限制範圍 (scope)（2 項）：**
- [ ] `per_investigator` — 每位調查員
- [ ] `per_team` — 全團隊

---

### 6.7 元素屬性 (element) — 共 5 項

- [ ] `physical` — 物理
- [ ] `fire` — 火
- [ ] `ice` — 冰
- [ ] `lightning` — 電
- [ ] `arcane` — 神秘

---

### 6.8 狀態效果 (status) — 共 21 項

**負面狀態（15 項）：**
- [ ] `poison` — 中毒
- [ ] `bleed` — 流血
- [ ] `burning` — 燃燒
- [ ] `frozen` — 冷凍
- [ ] `darkness` — 黑暗
- [ ] `disarm` — 繳械
- [ ] `doom_status` — 毀滅
- [ ] `fatigue` — 疲勞
- [ ] `madness` — 發瘋
- [ ] `marked` — 標記
- [ ] `vulnerable` — 脆弱
- [ ] `silence` — 沈默
- [ ] `weakness_status` — 無力
- [ ] `wet` — 潮濕
- [ ] `weakened` — 弱化

**正面狀態（6 項）：**
- [ ] `empowered` — 強化
- [ ] `armor` — 護甲
- [ ] `ward` — 護盾
- [ ] `stealth` — 隱蔽
- [ ] `haste` — 加速
- [ ] `regeneration` — 再生

---

### 6.9 物品子類型 (subtypes) — 共 8 項

- [ ] `item` — 一般物品
- [ ] `arcane_item` — 魔法物品
- [ ] `weapon` — 武器
- [ ] `weapon_melee` — 近戰武器
- [ ] `weapon_ranged` — 遠程武器
- [ ] `weapon_arcane` — 法術武器
- [ ] `consumable` — 消耗品
- [ ] `light_source` — 光源

---

### 6.10 資源貨幣類型 (resource_type) — 共 4 項

- [ ] `resource` — 資源
- [ ] `forbidden_insight` — 禁忌洞察
- [ ] `faith` — 信仰
- [ ] `elder_sign` — 遠古印記

---

### 6.11 傷害關鍵字 (damage_keyword) — 共 2 項

- [ ] `direct` — 直擊（強制扣調查員本人）
- [ ] `area` — 廣域（對桌上所有卡片造成傷害）

---

### 6.12 search_deck 專用參數

**on_found 選項（3 項）：**
- [ ] `to_hand` — 加入手牌
- [ ] `to_play` — 直接進場
- [ ] `to_engaged` — 放入交戰區

**on_remaining 選項（3 項）：**
- [ ] `shuffle_back` — 洗回牌庫
- [ ] `to_bottom` — 放到牌庫底
- [ ] `to_discard` — 棄到棄牌堆

---

### 6.13 其他枚舉檢查

**陣營極 (faction)（9 項）：**
- [ ] `E` — 號令
- [ ] `I` — 深淵
- [ ] `S` — 鐵證
- [ ] `N` — 天啟
- [ ] `T` — 解析
- [ ] `F` — 聖燼
- [ ] `J` — 鐵壁
- [ ] `P` — 流影
- [ ] `neutral` — 中立

**卡片風格 (style)（4 項）：**
- [ ] `AH` — 直接正面
- [ ] `AC` — 直接負面
- [ ] `OH` — 間接正面
- [ ] `OC` — 間接負面

**卡片類別 (type)（4 項）：**
- [ ] `asset` — 資產
- [ ] `event` — 事件
- [ ] `ally` — 盟友
- [ ] `skill` — 技能

**裝備欄位 (slot)（9 項）：**
- [ ] `one_hand` — 單手
- [ ] `two_hand` — 雙手
- [ ] `head` — 帽子
- [ ] `body` — 身體
- [ ] `accessory` — 配件
- [ ] `arcane` — 神秘
- [ ] `talent` — 天賦
- [ ] `expertise` — 專長
- [ ] `none` — 無

**使用後去向 (consume_type)（5 項）：**
- [ ] `stay` — 留在場上
- [ ] `discard` — 進棄牌堆
- [ ] `long_rest` — 長休息回復
- [ ] `short_rest` — 短休息回復
- [ ] `removed` — 移除出遊戲

**七大屬性 (attribute)（7 項）：**
- [ ] `strength` — 力量
- [ ] `agility` — 敏捷
- [ ] `constitution` — 體質
- [ ] `intellect` — 智力
- [ ] `willpower` — 意志
- [ ] `perception` — 感知
- [ ] `charisma` — 魅力

**武器階層 (weapon_tier)（6 項）：**
- [ ] `1` — 隨身（傷害 1）
- [ ] `2` — 基礎（傷害 2）
- [ ] `3` — 標準（傷害 3）
- [ ] `4` — 進階（傷害 4）
- [ ] `5` — 稀有（傷害 5）
- [ ] `6` — 傳奇（傷害 6）

---

## 七、完成後

1. Git commit：`feat: integrate effect language system into card designer — structured effect form, Gemini prompt upgrade, auto-description generation`
2. 確保 `effect-language-options.json` 包含所有第六章檢查清單的代碼
3. 測試 Gemini 生成是否能產出符合規範的 JSON
4. Push 到 GitHub

---

## 八、文件版本紀錄

| 版本 | 日期 | 變更內容 |
|------|------|----------|
| v0.1 | 2026/04/13 | 初版建立 — 效果區塊 UI 重構規格、動態參數邏輯表、Gemini Prompt 完整版、描述文字自動生成邏輯、完整檢查清單（觸發時機 23 項、條件限制 21 項、費用類型 15 項、目標指定 14 項、效果動詞 62 項、持續時間 14 項、元素 5 項、狀態 21 項、物品子類型 8 項） |

---

> **給 Claude Code 的備註**
> 
> 本文件第六章的檢查清單是**規範權威**。在建立 `effect-language-options.json` 時，
> 必須逐項核對，確保每個代碼都有對應的選項。
> 
> Gemini Prompt 中的代碼清單也必須與檢查清單完全一致，否則 AI 可能生成無效代碼。
> 
> 如果發現檢查清單有遺漏，請回報給專案負責人 Uria 進行補充。
