# Claude Code 更改指令：補充 03 卡片設計器更新
## Change Order #01 — 2026/04/13

> **給 Claude Code：** 根據《核心設計原則 補充 03：瀕死系統、敵人 AI 與戰鬥風格卡 v0.1》的規則確認，
> 請對卡片設計器（MOD-01）、共用常數（admin-shared.js）、後端 API、Gemini Prompt 進行以下更新。
>
> **參考文件：**
> - `核心設計原則_補充03_瀕死系統與戰鬥風格卡_v0_1.md` — 本次更新的規則來源
> - `Claude_Code_Card_Designer_指令.md` — 原始卡片設計器規格
> - `Claude_Code_Card_Designer_補充指令.md` — 前次調整（代碼自動生成、消耗品三層級、裝備欄位、卡片分類）
> - `核心設計原則_補充02_卡片效果語言與狀態系統_v0_1.md` — 效果語言規範

---

## 更改一：admin-shared.js 新增常數

### 1.1 新增戰鬥風格常數

在 `admin-shared.js` 中新增：

```javascript
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
  // 槍枝射擊（4）
  shooting_rifle:   { code: 'shooting_rifle',   parent: 'shooting', zh: '步槍專精',     en: 'Rifle' },
  shooting_smg:     { code: 'shooting_smg',      parent: 'shooting', zh: '衝鋒槍專精',   en: 'Submachine Gun' },
  shooting_dual:    { code: 'shooting_dual',     parent: 'shooting', zh: '雙槍專精',     en: 'Dual Wielding' },
  shooting_pistol:  { code: 'shooting_pistol',   parent: 'shooting', zh: '手槍專精',     en: 'Pistol' },

  // 弓術（4）
  archery_hunter:   { code: 'archery_hunter',    parent: 'archery',  zh: '獵手',         en: 'Hunter' },
  archery_rapid:    { code: 'archery_rapid',     parent: 'archery',  zh: '連射',         en: 'Rapid Fire' },
  archery_poison:   { code: 'archery_poison',    parent: 'archery',  zh: '毒箭',         en: 'Poison Arrow' },
  archery_silent:   { code: 'archery_silent',    parent: 'archery',  zh: '無聲射手',     en: 'Silent Shooter' },

  // 隨身武器（4）
  sidearm_dagger:   { code: 'sidearm_dagger',    parent: 'sidearm',  zh: '匕首術',       en: 'Dagger' },
  sidearm_parry:    { code: 'sidearm_parry',     parent: 'sidearm',  zh: '護身格擋',     en: 'Parry' },
  sidearm_blunt:    { code: 'sidearm_blunt',     parent: 'sidearm',  zh: '鈍擊',         en: 'Blunt Strike' },
  sidearm_street:   { code: 'sidearm_street',    parent: 'sidearm',  zh: '街頭格鬥',     en: 'Street Fighting' },

  // 軍用武器（4）
  military_twohanded: { code: 'military_twohanded', parent: 'military', zh: '雙手武器專精', en: 'Two-Handed' },
  military_defense:   { code: 'military_defense',   parent: 'military', zh: '防禦架式',     en: 'Defensive Stance' },
  military_dual:      { code: 'military_dual',      parent: 'military', zh: '雙持專精',     en: 'Dual Wielding' },
  military_polearm:   { code: 'military_polearm',   parent: 'military', zh: '長柄武器',     en: 'Polearm' },

  // 搏擊（3）
  brawl_tavern:     { code: 'brawl_tavern',      parent: 'brawl',    zh: '酒館鬥毆者',   en: 'Tavern Brawler' },
  brawl_wrestler:   { code: 'brawl_wrestler',    parent: 'brawl',    zh: '摔角大師',     en: 'Wrestler' },
  brawl_karate:     { code: 'brawl_karate',      parent: 'brawl',    zh: '空手道',       en: 'Karate' },

  // 施法（5）
  arcane_ritual:      { code: 'arcane_ritual',      parent: 'arcane', zh: '儀式',   en: 'Ritual' },
  arcane_incantation: { code: 'arcane_incantation', parent: 'arcane', zh: '咒語',   en: 'Incantation' },
  arcane_channeling:  { code: 'arcane_channeling',  parent: 'arcane', zh: '引導',   en: 'Channeling' },
  arcane_meditation:  { code: 'arcane_meditation',  parent: 'arcane', zh: '冥想',   en: 'Meditation' },
  arcane_alchemy:     { code: 'arcane_alchemy',     parent: 'arcane', zh: '煉金',   en: 'Alchemy' },

  // 工兵（3）
  engineer_demolition: { code: 'engineer_demolition', parent: 'engineer', zh: '爆破', en: 'Demolition' },
  engineer_trap:       { code: 'engineer_trap',       parent: 'engineer', zh: '陷阱', en: 'Trap' },
  engineer_mechanic:   { code: 'engineer_mechanic',   parent: 'engineer', zh: '機械', en: 'Mechanic' },

  // 暗殺（3）
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
```

---

## 更改二：卡片設計器表單更新

### 2.1 移除的欄位

從編輯表單中移除以下三個欄位：

| 移除欄位 | 原位置 | 移除原因 |
|---------|--------|---------|
| `check_attribute`（檢定屬性） | 數值資訊區 | 檢定屬性改由戰鬥風格卡決定 |
| `check_modifier`（檢定修正） | 數值資訊區 | 改為多屬性修正結構 |
| `check_method`（檢定方式） | 數值資訊區 | 改由攻擊方式類型決定（施法 → 混沌袋） |

### 2.2 新增的欄位

#### 2.2.1 戰鬥風格（combat_style）

| 項目 | 說明 |
|------|------|
| 欄位名 | `combat_style` |
| 類型 | 下拉選單 |
| 選項 | 從 `COMBAT_STYLES` 常數載入（8 個 + 「無」） |
| 顯示條件 | 僅當卡片的 subtypes 包含 `weapon`、`weapon_melee`、`weapon_ranged`、`weapon_arcane` 時顯示 |
| 位置 | 身份資訊區，在裝備欄位下方 |
| 驗證 | 武器卡必填 |

#### 2.2.2 屬性修正（attribute_modifiers）

| 項目 | 說明 |
|------|------|
| 欄位名 | `attribute_modifiers` |
| 類型 | 動態表單區塊 |
| 位置 | 數值資訊區，取代原本的 check_attribute / check_modifier |
| 顯示條件 | 僅當卡片的 subtypes 包含武器類型時顯示 |

介面結構：

```
┌─────────────────────────────────────────────────────┐
│ 屬性修正                                              │
│                                                       │
│  模式：○ 單一屬性   ○ 多屬性   ○ 全屬性              │
│                                                       │
│  [單一屬性模式]                                       │
│  屬性：[力量 ▼]  修正值：[+1]                        │
│                                                       │
│  [多屬性模式]                                         │
│  力量：[+2]   敏捷：[+0]   體質：[——]                │
│  智力：[——]   意志：[-1]   感知：[+0]   魅力：[——]   │
│  （空白 = 不列入，0 = 明確無修正）                    │
│                                                       │
│  [全屬性模式]                                         │
│  所有檢定：[+1]                                       │
└─────────────────────────────────────────────────────┘
```

- **單一屬性模式**：等級 0 基礎武器的預設模式。選一個屬性，填一個修正值。
- **多屬性模式**：升級後武器使用。可對多個屬性分別設定不同修正值（含負值）。
- **全屬性模式**：「所有攻擊檢定 +X」的廣度路線。
- 存入資料庫的格式為 JSONB：

```json
// 單一屬性
{ "strength": 1 }

// 多屬性
{ "strength": 2, "willpower": -1 }

// 全屬性
{ "all": 1 }
```

### 2.3 即時預覽更新

卡片預覽中的顯示變更：

- 移除原本的「檢定屬性」和「檢定修正」顯示。
- 新增「戰鬥風格」標籤（使用 `COMBAT_STYLES` 的顏色或文字標示）。
- 新增「屬性修正」區域，以有顏色的文字顯示各屬性修正值。
  - 正值顯示綠色，負值顯示紅色，零不顯示。
  - 測試階段用文字（例如 `STR+1`），正式版改為圖案。

---

## 更改三：資料庫 Schema 調整

### 3.1 card_definitions 表

```sql
-- 移除舊欄位
ALTER TABLE card_definitions DROP COLUMN IF EXISTS check_attribute;
ALTER TABLE card_definitions DROP COLUMN IF EXISTS check_modifier;
ALTER TABLE card_definitions DROP COLUMN IF EXISTS check_method;

-- 新增欄位
ALTER TABLE card_definitions ADD COLUMN combat_style VARCHAR(32)
  CHECK (combat_style IN ('shooting', 'archery', 'sidearm', 'military', 'brawl', 'arcane', 'engineer', 'assassin'));

ALTER TABLE card_definitions ADD COLUMN attribute_modifiers JSONB NOT NULL DEFAULT '{}';

-- 索引
CREATE INDEX idx_cards_combat_style ON card_definitions(combat_style);
```

### 3.2 遷移備註

- 如果現有卡片資料中有 `check_attribute` 和 `check_modifier` 的值，遷移時自動轉換：
  - 例如 `check_attribute: "agility", check_modifier: 1` → `attribute_modifiers: {"agility": 1}`
- 如果沒有現有資料，直接移除舊欄位即可。

---

## 更改四：後端 API 調整

### 4.1 POST / PUT /api/cards

- 接受新的 `combat_style` 和 `attribute_modifiers` 欄位。
- 不再接受 `check_attribute`、`check_modifier`、`check_method`。
- `attribute_modifiers` 驗證邏輯：
  - 必須是合法的 JSON 物件。
  - key 只能是七大屬性的 id（strength / agility / constitution / intellect / willpower / perception / charisma）或 `all`。
  - value 必須是整數，範圍 -5 到 +5。
  - `all` 不可與其他 key 共存。

### 4.2 GET /api/cards

- 查詢參數新增 `?combat_style=shooting`，支援依戰鬥風格篩選。
- 回傳中包含新欄位，不包含已移除的舊欄位。

### 4.3 GET/POST /api/cards/export 和 /api/cards/import

- 匯出格式使用新結構。
- 匯入時若偵測到舊格式（含 check_attribute / check_modifier），自動轉換為新格式。

---

## 更改五：新增觸發時機

### 5.1 effect-language-options.json 更新

在觸發時機（triggers）的「傷害相關」分類中，新增三個選項：

```json
{
  "damage_related": [
    { "code": "on_take_damage",     "zh": "受到傷害時",     "en": "On Take Damage" },
    { "code": "on_take_horror",     "zh": "受到恐懼時",     "en": "On Take Horror" },
    { "code": "before_take_damage", "zh": "將要受到傷害時", "en": "Before Take Damage" },
    { "code": "before_take_horror", "zh": "將要受到恐懼時", "en": "Before Take Horror" },
    { "code": "before_downed",      "zh": "將要倒地時",     "en": "Before Downed" }
  ]
}
```

### 5.2 卡片效果表單

觸發時機下拉選單需包含新增的三個選項。

### 5.3 Gemini Prompt 更新

在 Prompt 的觸發時機清單中加入新的三個代碼。

---

## 更改六：卡片設計器篩選工具列更新

在左側面板的篩選區新增：

| 篩選項 | 選項 |
|--------|------|
| 戰鬥風格 | 槍枝射擊 / 弓術 / 隨身武器 / 軍用武器 / 搏擊 / 施法 / 工兵 / 暗殺 / 全部 |

---

## 更改七：Gemini Prompt 完整升級

### 7.1 替換原有 Prompt

將 `Claude_Code_Card_Designer_指令.md` 第九章第四節的 Prompt 範例，替換為以下完整版本。

此 Prompt 需由 `admin-shared.js` 中的常數動態組合，以確保與常數定義保持同步。以下為最終組合後的完整 Prompt 內容：

```javascript
function buildGeminiPrompt(userDescription) {
  return `你是一個克蘇魯神話卡牌遊戲的卡片設計師。請根據以下完整規則和使用者需求，生成一張完全符合規範的卡片。

## 一、遊戲基礎規則

### 骰子與檢定
- 骰子系統：d20
- 檢定公式：d20 + 屬性修正(0~5) + 熟練/專精修正(0~3) + 武器屬性修正(依風格卡決定)
- 自然 20：爆擊，2 倍傷害
- 自然 1：大失敗，可能傷害隊友

### 七大屬性
力量(STR)、敏捷(DEX)、體質(CON)、智力(INT)、意志(WIL)、感知(PER)、魅力(CHA)

### 數值規格
- 卡片費用範圍：0–6
- 武器傷害階層：隨身1 / 基礎2 / 標準3 / 進階4 / 稀有5 / 傳奇6
- HP 公式：體質 × 2 + 5（範圍 7–25）
- SAN 公式：意志 × 2 + 5（範圍 7–25）
- 手牌上限：8 張
- 每回合行動點：3 點
- 起始資源：5 點，每回合 +1

## 二、戰鬥風格卡系統

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

## 三、回合結構

1. 回合開始 → 短休息決定
2. 調查員階段（3 行動點：拿資源、抽牌、打牌、攻擊、移動、調查、嘲諷、閃避、執行卡片行動）
3. 敵人階段（城主行動 + 神話卡 + Agenda 毀滅標記）
4. 回合結束階段（每人抽 1 張、+1 資源、橫置卡轉正）

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

## 五、卡片分類

### 卡片風格（效果方向）
A+H（直接正面）、A+C（直接負面）、O+H（間接正面）、O+C（間接負面）

### 卡片類別（存在形式）
asset（資產）、event（事件）、ally（盟友）、skill（技能）

### 特殊身份標記（可疊加）
is_signature（簽名卡）、is_weakness（弱點）、is_revelation（神啟卡）

### 裝備欄位
one_hand、two_hand、head、body、accessory、arcane、talent、expertise、none

### 使用後去向
stay、discard、long_rest、short_rest、removed

## 六、卡片效果語言

每個效果必須包含六大要素，請嚴格使用以下代碼：

### 觸發時機
卡片生命週期：on_play, on_commit, on_consume, on_enter_play, on_leave_play, on_draw
檢定相關：on_success, on_failure, on_critical, on_fumble
傷害相關：on_take_damage, on_take_horror, before_take_damage, before_take_horror, before_downed
交戰與移動：on_engage, on_disengage, on_move, on_enter_location
敵人相關：on_enemy_spawn, on_enemy_defeat, on_ally_downed
回合節奏：on_turn_start, on_turn_end, on_enemy_phase
行動模式：reaction, passive, free_action

### 條件限制（可為 null）
交戰：while_engaged, while_not_engaged, ally_engaged
血量：hp_below_half, hp_below_x, san_below_half, san_below_x
光照：in_darkness, in_light, in_fire
時間：daytime, nighttime
卡牌：hand_empty, hand_full, deck_empty, has_weapon, has_ally, has_item, has_arcane_item, has_weakness
位置：at_location_with_clue, at_location_with_enemy, alone_at_location, at_location_with_hidden_clue, at_location_with_hidden_info

### 費用類型（物件格式）
resource, forbidden_insight, faith, elder_sign, hp, san, discard_hand, discard_specific, exhaust_self, exhaust_other, ammo, uses, clue, action_point, doom

### 目標指定
調查員：self, ally_one, ally_all, investigator_any, investigator_all
敵人：enemy_one, enemy_all_location, enemy_engaged, enemy_non_elite, enemy_normal, enemy_elite
卡片與場景：ally_card, asset_card, location

### 效果動詞
傷害類：deal_damage, deal_horror
恢復類：heal_hp, heal_san, restore_hp_max, restore_san_max, transfer_damage, transfer_horror
卡牌操作：draw_card, reveal_top, search_deck, retrieve_card, return_to_deck, discard_card, shuffle_deck, remove_from_game
資源類：gain_resource, spend_resource, steal_resource, transfer_resource
移動類：move_investigator, move_enemy, swap_position, place_enemy, jump
狀態類：engage_enemy, disengage_enemy, exhaust_card, ready_card, stun_enemy, add_status, remove_status
檢定類：make_test, modify_test, reroll, auto_success, auto_fail
戰鬥類：attack, evade, taunt, counterattack, extra_attack
環境類：place_clue, discover_clue, place_doom, remove_doom, seal_gate, spawn_enemy, remove_enemy, execute_enemy, reveal_tile, place_tile, remove_tile, place_haunting, remove_haunting, advance_act, advance_agenda, connect_tiles, disconnect_tiles
光照類：create_light, extinguish_light, create_darkness, remove_darkness, create_fire, extinguish_fire
特殊類：add_keyword, remove_keyword, add_bless, add_curse, remove_bless, remove_curse, look_chaos_bag, manipulate_chaos_bag

### 持續時間
instant, until_end_of_turn, until_end_of_round, until_next_turn, until_end_of_scenario, permanent, while_in_play, x_rounds, until_triggered, once_per_turn, once_per_round, once_per_scenario, until_short_rest, until_long_rest

### 元素屬性
physical, fire, ice, lightning, arcane

### 狀態效果
負面：poison, bleed, burning, frozen, darkness, disarm, doom_status, fatigue, madness, marked, vulnerable, silence, weakness_status, wet, weakened
正面：empowered, armor, ward, stealth, haste, regeneration

### 物品子類型
item, arcane_item, weapon, weapon_melee, weapon_ranged, weapon_arcane, consumable, light_source

## 七、使用者需求

\${userDescription}

## 八、輸出格式

請回傳完全符合以下 JSON 結構的卡片資料，不要回傳任何其他文字：

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
  "combat_style": "shooting/archery/sidearm/military/brawl/arcane/engineer/assassin/null",
  "attribute_modifiers": {},
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

## 九、重要提醒

1. effect_code 必須從上面的清單中選擇，不要發明新的代碼
2. 所有代碼使用小寫和底線
3. effects 是陣列，一張卡可以有多個效果
4. combat_style 只有武器卡才需要填寫，非武器卡填 null
5. attribute_modifiers 只有武器卡才需要填寫，非武器卡填 {}
6. 基礎武器（level 0）的 attribute_modifiers 通常只有一個屬性，不含負值
7. 數值要合理：費用 0-6、傷害符合武器階層
8. 風格要符合陣營：參考陣營的風格偏重
9. 武器不再指定固定的檢定屬性，檢定屬性由戰鬥風格卡決定
`;
}
```

### 7.2 後處理驗證更新

```javascript
function validateAndFixCardData(cardData) {
  // 原有的 effect_code 驗證保持不變

  // 新增：attribute_modifiers 驗證
  if (cardData.attribute_modifiers && typeof cardData.attribute_modifiers === 'object') {
    const validKeys = ['strength', 'agility', 'constitution', 'intellect',
                       'willpower', 'perception', 'charisma', 'all'];
    for (const key of Object.keys(cardData.attribute_modifiers)) {
      if (!validKeys.includes(key)) {
        console.warn(`無效的 attribute_modifiers key: ${key}，已移除`);
        delete cardData.attribute_modifiers[key];
      }
      const val = cardData.attribute_modifiers[key];
      if (typeof val !== 'number' || val < -5 || val > 5) {
        console.warn(`attribute_modifiers[${key}] 數值超出範圍，已修正`);
        cardData.attribute_modifiers[key] = Math.max(-5, Math.min(5, Math.round(val)));
      }
    }
    // all 不可與其他 key 共存
    if (cardData.attribute_modifiers.all !== undefined && Object.keys(cardData.attribute_modifiers).length > 1) {
      const allVal = cardData.attribute_modifiers.all;
      cardData.attribute_modifiers = { all: allVal };
      console.warn('attribute_modifiers 中 all 不可與其他 key 共存，已清除其他 key');
    }
  }

  // 新增：combat_style 驗證
  const validStyles = ['shooting', 'archery', 'sidearm', 'military',
                       'brawl', 'arcane', 'engineer', 'assassin'];
  if (cardData.combat_style && !validStyles.includes(cardData.combat_style)) {
    console.warn(`無效的 combat_style: ${cardData.combat_style}，已清除`);
    cardData.combat_style = null;
  }

  // 新增：觸發時機驗證（追加 before_ 系列）
  const validTriggers = new Set([
    // 原有的觸發時機...
    'on_play', 'on_commit', 'on_consume', 'on_enter_play', 'on_leave_play', 'on_draw',
    'on_success', 'on_failure', 'on_critical', 'on_fumble',
    'on_take_damage', 'on_take_horror',
    'before_take_damage', 'before_take_horror', 'before_downed',  // ← 新增
    'on_engage', 'on_disengage', 'on_move', 'on_enter_location',
    'on_enemy_spawn', 'on_enemy_defeat', 'on_ally_downed',
    'on_turn_start', 'on_turn_end', 'on_enemy_phase',
    'reaction', 'passive', 'free_action'
  ]);

  if (cardData.effects) {
    for (const effect of cardData.effects) {
      if (effect.trigger && !validTriggers.has(effect.trigger)) {
        console.warn(`無效的 trigger: ${effect.trigger}，已標記待修正`);
        effect._invalid_trigger = true;
      }
    }
  }

  // 原有的數值範圍修正保持不變
  if (cardData.cost < 0) cardData.cost = 0;
  if (cardData.cost > 6) cardData.cost = 6;
  if (cardData.skill_value < 0) cardData.skill_value = 0;
  if (cardData.skill_value > 5) cardData.skill_value = 5;

  return cardData;
}
```

---

## 更改八：卡片資料結構更新

### 8.1 完整的卡片 JSON 結構（取代舊版）

```javascript
{
  id: crypto.randomUUID(),
  code: "CSAH-01",               // 自動生成
  name_zh: ".45 自動手槍",
  name_en: ".45 Automatic",
  faction: "S",
  style: "AH",
  type: "asset",
  slot: "one_hand",
  is_unique: false,
  is_signature: false,
  is_weakness: false,
  is_revelation: false,
  level: 0,

  cost: 3,
  cost_currency: "resource",
  skill_value: 1,
  damage: 3,
  horror: 0,
  health_boost: 0,
  sanity_boost: 0,
  weapon_tier: 3,
  ammo: 4,
  uses: null,
  consume_type: "stay",

  // ===== 新欄位（取代 check_attribute / check_modifier / check_method）=====
  combat_style: "shooting",       // 戰鬥風格（8 種之一）
  attribute_modifiers: {           // 武器屬性修正
    "strength": 1                  // 等級 0：只有力量 +1
  },
  // ===== 新欄位結束 =====

  hand_limit_mod: 0,
  ally_hp: null,
  ally_san: null,

  effects: [
    {
      trigger: "free_action",
      condition: null,
      cost: { ammo: 1, exhaust_self: true },
      target: "enemy_one",
      effect_code: "attack",
      params: { damage: 3, element: "physical" },
      duration: "instant",
      desc_zh: "花費 1 子彈，橫置：進行一次攻擊。命中造成 3 點物理傷害。",
      desc_en: "Spend 1 ammo, exhaust: Attack an enemy at your location. Deal 3 physical damage."
    }
  ],

  flavor_text: "沉甸甸的握把傳來冰冷的金屬觸感。在這個世界裡，這可能是你最可靠的朋友。",

  subtypes: ["weapon", "weapon_ranged", "item"],

  // 特殊欄位（神啟卡用）
  removable: true,
  committable: true,
  lethal_count: 0,

  // 特殊欄位（簽名卡用）
  owner_investigator: null,

  // 中繼資料
  version: 1,
  created_at: "2026-04-13T...",
  updated_at: "2026-04-13T..."
}
```

---

## 完成後

1. Git commit：`feat: update card designer for combat style cards — add combat_style, attribute_modifiers, remove legacy check fields, upgrade Gemini prompt, add before_ triggers`
2. Push 到 GitHub
3. 確認所有已建立的卡片資料在遷移後格式正確

---

## 文件版本紀錄

| 版本 | 日期 | 變更內容 |
|------|------|----------|
| CO#01 | 2026/04/13 | 初版建立 — admin-shared.js 新增 COMBAT_STYLES / COMBAT_SPECIALIZATIONS / ENEMY_PREFERENCES 常數、卡片設計器表單移除 check_attribute / check_modifier / check_method 並新增 combat_style / attribute_modifiers、資料庫 Schema 調整、API 端點更新、Gemini Prompt 完整升級（含戰鬥風格卡系統與 before_ 觸發時機）、卡片 JSON 結構更新 |
