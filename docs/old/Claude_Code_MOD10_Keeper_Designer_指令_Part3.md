# Claude Code 指令：城主設計器 MOD-10（Part 3/3）
## Keeper Designer Instructions — AI 生成 + 總覽 + 遊戲平衡

> **本文件為 Part 3/3。**
> Part 1 涵蓋：資料庫結構 + 全部 Seed Data + 後端 API。
> Part 2 涵蓋：頁面佈局 + 神話卡編輯區 + 遭遇卡編輯區。
> **Part 3 涵蓋：Gemini AI 生成完整 Prompt + 總覽面板 + 遊戲平衡設定介面。**

---

# 第十部分：Gemini AI 生成

## 10.1 三種 AI 生成模式

| 模式 | 觸發位置 | 功能 |
|------|---------|------|
| 神話卡生成 | 神話卡新增/編輯頁內 | 根據類型、時機、強度生成完整神話卡 |
| 遭遇卡生成 | 遭遇卡新增/編輯頁內 | 根據地點風格、遭遇類型生成完整情境 + 選項 |
| 批次生成 | 總覽面板 | 一次生成同主題的多張卡片 |

## 10.2 Gemini Prompt — 神話卡生成

```
你是一個克蘇魯神話 TRPG 遊戲的城主卡片設計師。請為以下參數生成一張神話卡。

## 卡片參數
- 類型：{card_category} ({category_name_zh})
- 發動時機：{activation_timing} ({timing_name_zh})
- 強度：{intensity_tag} (行動點範圍：{cost_range})
- 行動點花費：{action_cost}

## 可用動作代碼清單

以下是神話卡可使用的結構化動作代碼，請選擇合適的組合：

### 召喚類
- summon_monster: 召喚怪物
  參數：{ "family_code": "house_xxx", "quantity": N, "base_tier": 1-4, "location_rule": "..." }
- spawn_at_location: 在地點生成標記
  參數：{ "token_type": "...", "location_rule": "..." }

### 議程類
- advance_agenda: 推進議程
  參數：{ "doom_tokens": N }

### 環境類
- environment_change: 環境改變
  參數：{ "change_type": "darkness|fire|haunting|disconnect", "target_location_rule": "..." }

### 狀態類
- inflict_status: 施加狀態
  參數：{ "status_code": "...", "value": N, "target_rule": "..." }

### 全場類
- damage_all: 全場傷害
  參數：{ "damage_physical": N, "damage_horror": N, "target_rule": "..." }

### 混沌袋類
- modify_chaos_bag: 混沌袋操作
  參數：{ "operation": "add|remove", "token_type": "...", "quantity": N }

### 遭遇牌堆類
- draw_encounter: 強制抽遭遇卡
  參數：{ "count": N, "resolve_immediately": true }

### 響應取消類
- cancel_player_action: 取消玩家行動（限調查員階段響應）
  參數：{ "action_type": "attack|investigate|move", "additional_penalty": null }
- force_reroll: 強制重擲（限調查員階段響應）
  參數：{ "target_rule": "...", "use_worse_result": true }

## 可用怪物家族代碼
- house_cthulhu: 克蘇魯眷族
- house_hastur: 哈斯塔眷族
- house_shub: 莎布·尼古拉絲眷族
- house_nyarlathotep: 奈亞拉托提普眷族
- house_yog: 猶格·索托斯眷族
- house_cthugha: 克圖格亞眷族
- house_yig: 伊格眷族
- fallen: 凡人墮落者
- undying: 亡者回響
- independent: 獨立存在

## 可用狀態代碼
poison, bleed, burning, frozen, darkness, disarm, doom_status, fatigue,
madness, marked, vulnerable, silence, weakness_status, wet, weakened

## 可用目標規則
all_investigators, nearest_investigator, lowest_hp, lowest_san, most_clues,
random_investigator, all_locations, nearest_to_clue, random_location,
connected_locations, keeper_choice

## 設計原則
1. 行動點與強度要匹配：小型事件（1-2 點）通常 1 個動作，大型事件（5-6 點）可包含 2-3 個動作
2. 「召喚類」通常用 summon_monster + 可能搭配 environment_change
3. 「響應取消類」必須是 cancel_player_action 或 force_reroll
4. 「議程類」通常含 advance_agenda
5. 風味文字要有克蘇魯神話的恐怖氛圍，一至兩句話
6. 風味文字以城主朗讀的口吻寫（第二人稱對玩家說）

## 輸出格式（嚴格 JSON）
{
  "name_zh": "卡片中文名",
  "name_en": "卡片英文名",
  "description_zh": "機制描述（設計師看的，說明卡片的設計意圖）",
  "description_en": "英文機制描述",
  "flavor_text_zh": "風味文字（城主朗讀的敘事）",
  "flavor_text_en": "英文風味文字",
  "effects": [
    {
      "action_code": "動作代碼",
      "action_params": { ... 參數物件 },
      "description_zh": "此動作的人類可讀描述"
    }
  ],
  "response_trigger": "僅響應類填寫，否則為 null"
}

## 範例輸入

卡片參數：
- 類型：summon（召喚類）
- 發動時機：keeper_phase（敵人階段）
- 強度：small（小型事件）
- 行動點花費：2

## 範例輸出
{
  "name_zh": "深淵呼喚",
  "name_en": "Call of the Deep",
  "description_zh": "從深淵中召喚一隻克蘇魯眷族的怪物。",
  "description_en": "Summon a Cthulhu-kin monster from the abyss.",
  "flavor_text_zh": "鹹濕的風從遠方吹來，海浪聲中夾雜著某種古老的節奏——牠們來了。",
  "flavor_text_en": "A salty wind blows from afar, carrying with it an ancient rhythm in the waves. They are coming.",
  "effects": [
    {
      "action_code": "summon_monster",
      "action_params": {
        "family_code": "house_cthulhu",
        "quantity": 1,
        "base_tier": 1,
        "location_rule": "nearest_to_clue"
      },
      "description_zh": "從克蘇魯眷族池中召喚 1 隻雜兵級怪物於最靠近線索的地點"
    }
  ],
  "response_trigger": null
}

---

現在請為以下參數生成神話卡：

- 類型：{card_category} ({category_name_zh})
- 發動時機：{activation_timing}
- 強度：{intensity_tag}
- 行動點花費：{action_cost}
- 額外要求：{user_note}（設計師的補充需求，可能為空）
```

## 10.3 Gemini Prompt — 遭遇卡生成

```
你是一個克蘇魯神話 TRPG 遊戲的遭遇事件設計師。請為以下參數生成一張遭遇卡。

## 卡片參數
- 遭遇類型：{encounter_type} ({type_name_zh})
- 地點風格標籤：{selected_tags}

## 遭遇類型說明
- thriller（驚悚）：陷阱、突發事件，節奏緊湊
- choice（選擇困境）：道德抉擇，沒有標準答案
- trade（交易）：提供交換機會，犧牲換取利益
- puzzle（謎題）：智力挑戰，需要思考
- social（社交）：NPC 互動，依賴魅力/意志
- discovery（發現）：揭露隱藏資訊，偏向正向

## 可用效果代碼

### 獲得類
- gain_clue: 獲得線索
  參數：{ "amount": N }
- gain_resource: 獲得資源
  參數：{ "amount": N }
- heal_damage: 回復 HP
  參數：{ "amount": N }
- heal_horror: 回復 SAN
  參數：{ "amount": N }
- draw_card: 抽牌
  參數：{ "amount": N }
- gain_xp: 獲得經驗值
  參數：{ "amount": N }

### 損失類
- lose_clue: 失去線索
  參數：{ "amount": N }
- lose_resource: 失去資源
  參數：{ "amount": N }
- damage: 承受物理傷害
  參數：{ "amount": N }
- horror: 承受恐懼傷害
  參數：{ "amount": N }
- discard_card: 棄牌
  參數：{ "amount": N, "rule": "random|choice" }

### 狀態類
- inflict_status: 施加狀態
  參數：{ "status_code": "...", "value": N }
- remove_status: 移除狀態
  參數：{ "status_code": "..." }

### 系統類
- set_flag: 設定劇情旗標（遭遇卡通常不用）
- advance_agenda: 推進議程
  參數：{ "doom_tokens": N }

## 七大屬性（檢定用）
strength, agility, constitution, intellect, willpower, perception, charisma

## 設計原則
1. 情境描述要有畫面感，一至兩段敘事
2. 選項 2–3 個，每個選項代表不同的應對策略
3. 至少一個選項需要檢定，製造張力
4. 成功/失敗的敘事是「故事的後半段」，要讓玩家感受到選擇的重量
5. 效果強度：
   - 小獎勵：1 線索、1 資源、1 抽牌
   - 中獎勵：2 線索、1 經驗值
   - 小懲罰：1 傷害、1 恐懼
   - 中懲罰：2 傷害 + 1 狀態、2 恐懼
6. 遭遇類型影響選項設計：
   - thriller：一個低 DC 選項（緊急應對）+ 一個高 DC 選項（英勇應對）
   - choice：兩個都有檢定，但 DC 屬性不同
   - trade：一個選項不檢定但付出代價獲益，另一個檢定選項更好
   - social：側重 charisma / willpower 檢定

## 輸出格式（嚴格 JSON）
{
  "name_zh": "遭遇卡中文名",
  "name_en": "遭遇卡英文名",
  "scenario_text_zh": "情境描述（中文）",
  "scenario_text_en": "情境描述（英文）",
  "options": [
    {
      "option_label": "A",
      "option_text_zh": "選項文字（動詞開頭）",
      "option_text_en": "英文選項文字",
      "requires_check": true,
      "check_attribute": "willpower",
      "check_dc": 4,
      "success_narrative_zh": "成功敘事（故事後半段）",
      "success_narrative_en": "英文成功敘事",
      "success_effects": [
        { "action_code": "gain_clue", "params": { "amount": 2 } }
      ],
      "failure_narrative_zh": "失敗敘事",
      "failure_narrative_en": "英文失敗敘事",
      "failure_effects": [
        { "action_code": "horror", "params": { "amount": 2 } }
      ]
    },
    {
      "option_label": "B",
      "option_text_zh": "...",
      "option_text_en": "...",
      "requires_check": false,
      "no_check_narrative_zh": "無檢定敘事",
      "no_check_narrative_en": "英文無檢定敘事",
      "no_check_effects": [
        { "action_code": "inflict_status", "params": { "status_code": "fatigue", "value": 1 } }
      ]
    }
  ]
}

---

現在請生成遭遇卡：

- 遭遇類型：{encounter_type}
- 地點風格：{selected_tags}
- 額外要求：{user_note}
```

## 10.4 Gemini Prompt — 批次生成

批次生成神話卡的 Prompt 以上述「單張神話卡 Prompt」為基礎，附加：

```
本次請生成 {count} 張同主題的神話卡，主題：{batch_theme}

範例主題：
- 「克蘇魯覺醒系列」：所有卡片都與克蘇魯眷族召喚、海洋、夢境相關
- 「黃衣之王系列」：所有卡片都與哈斯塔、黃色符號、瘋狂相關
- 「議程加速系列」：所有卡片都含 advance_agenda 動作
- 「響應取消組」：所有卡片都是調查員階段響應類

輸出格式：JSON 陣列，陣列中每個元素是單張神話卡的完整格式
```

## 10.5 AI 生成的前端流程

1. 使用者點擊「🤖 AI 生成」按鈕（在神話卡/遭遇卡編輯區的頂部）
2. 彈出生成參數對話框：

**神話卡：**
```
┌─────────────────────────────────────┐
│ AI 生成神話卡                          │
├─────────────────────────────────────┤
│ 類型：[召喚類 ▼]                      │
│ 時機：[敵人階段 ▼]                    │
│ 強度：[小型事件 ▼]                    │
│ 行動點：[2]                          │
│                                     │
│ 額外要求（選填）：                     │
│ [主題是深潛者入侵______________]      │
│                                     │
│       [取消]  [🤖 生成]              │
└─────────────────────────────────────┘
```

**遭遇卡：**
```
┌─────────────────────────────────────┐
│ AI 生成遭遇卡                          │
├─────────────────────────────────────┤
│ 遭遇類型：[選擇困境 ▼]                │
│ 地點風格：[圖書館 ×] [宅邸 ×]         │
│                                     │
│ 額外要求（選填）：                     │
│ [主題是禁忌知識誘惑_____________]     │
│                                     │
│       [取消]  [🤖 生成]              │
└─────────────────────────────────────┘
```

3. 按下生成後，前端呼叫後端 AI API（詳見 Part 1 §3.8）
4. 後端組裝 Prompt 呼叫 Gemini，解析回應後回傳
5. 前端將結果填入編輯表單的對應欄位
6. **不自動儲存** — 設計師檢視後手動修改和儲存

---

# 第十一部分：總覽面板（標籤頁二）

## 11.1 佈局結構

```
┌─────────────────────────────────────────────────────────────┐
│ 📊 城主卡片庫總覽                                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ 神話卡統計 ──────────────────────────────────────┐     │
│  │  總數：5 張                                         │     │
│  │  草稿 0 · 審核 0 · 定稿 5                          │     │
│  │  ████████████ 100%                                │     │
│  └─────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 神話卡類型分佈（長條圖）─────────────────────────┐     │
│  │  召喚類      ██ 1                                   │     │
│  │  環境類      ██ 1                                   │     │
│  │  全場類      ██ 1                                   │     │
│  │  議程類      ██ 1                                   │     │
│  │  響應取消類  ██ 1                                   │     │
│  │  ...（顯示所有類型，無卡片者顯示 0）                │     │
│  └─────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 神話卡強度分佈 ─────────────────────────────────┐     │
│  │  小型（1-2 點）   ██████ 3                         │     │
│  │  中型（3-4 點）   ████ 2                           │     │
│  │  大型（5-6 點）   0                                 │     │
│  │  史詩（7+ 點）    0                                 │     │
│  └─────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 發動時機分佈 ───────────────────────────────────┐     │
│  │  調查員階段響應  ██ 1                               │     │
│  │  敵人階段        ████████ 4                        │     │
│  │  兩者皆可        0                                  │     │
│  └─────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 遭遇卡統計 ──────────────────────────────────────┐     │
│  │  總數：2 張                                         │     │
│  │  草稿 0 · 審核 0 · 定稿 2                          │     │
│  │  ████████████ 100%                                │     │
│  └─────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 遭遇卡類型分佈 ──────────────────────────────────┐     │
│  │  驚悚         ██ 1                                  │     │
│  │  選擇困境     ██ 1                                  │     │
│  │  交易         0                                     │     │
│  │  謎題         0                                     │     │
│  │  社交         0                                     │     │
│  │  發現         0                                     │     │
│  └─────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 地點風格覆蓋（遭遇卡）─────────────────────────┐     │
│  │  室內類：                                          │     │
│  │   圖書館     ██ 1                                   │     │
│  │   宅邸       ██ 1                                   │     │
│  │   實驗室     0                                      │     │
│  │   ...                                              │     │
│  │  室外類：                                          │     │
│  │   墓地       ██ 1                                   │     │
│  │   ...                                              │     │
│  │  特殊類：                                          │     │
│  │   ...                                              │     │
│  └─────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 品質檢查 ────────────────────────────────────────┐     │
│  │  ⚠ 無大型神話卡（5+ 點）                            │     │
│  │  ⚠ 無史詩神話卡（7+ 點）                            │     │
│  │  ⚠ 13 個地點風格標籤尚無對應遭遇卡                  │     │
│  │  ⚠ 1 張神話卡無風味文字                             │     │
│  │  ✓ 所有遭遇卡都有至少 2 個選項                      │     │
│  └─────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 批次 AI 生成 ──────────────────────────────────┐     │
│  │                                                   │     │
│  │  想快速擴充卡片庫嗎？                              │     │
│  │                                                   │     │
│  │  [🤖 批次生成神話卡] [🤖 批次生成遭遇卡]          │     │
│  │                                                   │     │
│  └───────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 11.2 資料來源

- 神話卡資料：`GET /api/admin/keeper/stats/overview`
- 遭遇卡資料：同上
- 地點風格覆蓋：`GET /api/admin/keeper/stats/encounter-coverage`

## 11.3 品質檢查規則

| 檢查項目 | 觸發條件 |
|---------|---------|
| 類型覆蓋不足 | 某個神話卡類型 0 張 |
| 強度分佈失衡 | 某個強度 0 張 |
| 地點風格缺遭遇卡 | 某個啟用的風格標籤無對應遭遇卡 |
| 缺失風味文字 | 神話卡 `flavor_text_zh` 為 NULL 或空 |
| 選項數量不足 | 遭遇卡只有 1 個選項（正常應 2–3 個） |
| 響應類缺觸發 | 響應類神話卡未設定 `response_trigger` |

## 11.4 批次 AI 生成對話框

點擊「批次生成神話卡」：

```
┌─────────────────────────────────────────────────┐
│ 批次生成神話卡                                     │
├─────────────────────────────────────────────────┤
│ 主題：                                            │
│ [克蘇魯覺醒系列_____________________]              │
│                                                 │
│ 數量：[5]（最多 10 張）                           │
│                                                 │
│ 類型限制（可選，留空則 AI 自由決定）：              │
│ [召喚類 ×] [環境類 ×]                            │
│                                                 │
│ 強度分佈（可選）：                                │
│ 小型 [2]  中型 [2]  大型 [1]  史詩 [0]           │
│                                                 │
│ ⚠ 批次生成需要較長時間（約 30 秒）                │
│                                                 │
│           [取消]  [🤖 開始生成]                    │
└─────────────────────────────────────────────────┘
```

生成完成後彈出結果確認視窗：

```
┌─────────────────────────────────────────────────┐
│ 批次生成完成                                       │
├─────────────────────────────────────────────────┤
│ 成功生成 5 張神話卡：                              │
│                                                 │
│ [✓] 1. 深淵呼喚 (summon, small)                  │
│ [✓] 2. 腐蝕之潮 (environment, small)             │
│ [✓] 3. 夢境入侵 (summon, medium)                 │
│ [✓] 4. 海之低語 (environment, medium)            │
│ [✓] 5. 克蘇魯之怒 (global, large)                │
│                                                 │
│ 取消勾選不想保留的卡片，按「儲存」後批次寫入資料庫。 │
│                                                 │
│         [取消]  [儲存勾選的卡片]                   │
└─────────────────────────────────────────────────┘
```

---

# 第十二部分：遊戲平衡設定面板（標籤頁三）

## 12.1 佈局結構

```
┌─────────────────────────────────────────────────────────────┐
│ ⚙ 遊戲平衡設定                                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ⚠ 警告：這些參數影響整個遊戲的平衡。修改前請先用模擬器驗證。│
│                                                             │
│  ┌─ 城主行動點公式 ──────────────────────────────────┐     │
│  │                                                     │     │
│  │ 難度 1（簡單）基礎點數：    [2]                       │     │
│  │ 難度 2（標準）基礎點數：    [3]                       │     │
│  │ 難度 3（困難）基礎點數：    [4]                       │     │
│  │ 難度 4（專家）基礎點數：    [5]                       │     │
│  │ 難度 5（噩夢）基礎點數：    [6]                       │     │
│  │                                                     │     │
│  │ 人數加成（每多一名玩家）：   [2]                      │     │
│  │                                                     │     │
│  │ 跨回合累積：[✓]                                       │     │
│  │                                                     │     │
│  │ 累積上限：[0]（0 = 無上限）                           │     │
│  │                                                     │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 怪物升階成本 ────────────────────────────────────┐     │
│  │                                                     │     │
│  │ 雜兵 → 威脅：   [2] 點                              │     │
│  │ 威脅 → 精英：   [3] 點                              │     │
│  │ 精英 → 頭目：   [4] 點                              │     │
│  │ 頭目 → 巨頭：   [5] 點（關卡設計允許時才適用）        │     │
│  │                                                     │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 行動點模擬器 ────────────────────────────────────┐     │
│  │                                                     │     │
│  │ 模擬計算當前公式下的城主行動點：                      │     │
│  │                                                     │     │
│  │ 關卡難度：[3 ▼]                                      │     │
│  │ 玩家人數：[4 ▼]                                      │     │
│  │ 模擬回合數：[5]                                      │     │
│  │                                                     │     │
│  │ [▶ 計算]                                            │     │
│  │                                                     │     │
│  │ ─────────────── 結果 ───────────────                │     │
│  │ 基礎點數：4（難度 3）                                │     │
│  │ 人數加成：6（4 人，加成 2 × 3）                      │     │
│  │ 每回合總計：10 點                                    │     │
│  │                                                     │     │
│  │ 跨回合累積模擬（若不花費）：                          │     │
│  │  第 1 回合結束：10 點                                │     │
│  │  第 2 回合結束：20 點                                │     │
│  │  第 3 回合結束：30 點                                │     │
│  │  第 4 回合結束：40 點                                │     │
│  │  第 5 回合結束：50 點                                │     │
│  │                                                     │     │
│  │ ⚠ 50 點夠城主在第 5 回合打出 25 張 2 點神話卡，     │     │
│  │   或 1 張 6 點大型神話卡 + 召喚 1 隻頭目級怪物       │     │
│  │   （成本 2 點 + 升階 2+3+4=9 點 = 11 點）           │     │
│  │                                                     │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 套用與重置 ───────────────────────────────────────┐     │
│  │                                                     │     │
│  │ [💾 儲存所有變更]  [🔄 重置為預設值]                 │     │
│  │                                                     │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 12.2 資料來源與儲存

- 讀取：`GET /api/admin/keeper/balance`
- 儲存：`PUT /api/admin/keeper/balance/:setting_key`
- 模擬：`POST /api/admin/keeper/balance/simulate`

每個參數獨立儲存，避免一次性大批次更新時出錯。

## 12.3 模擬器邏輯

前端送出 `POST /balance/simulate`，後端依當前資料庫中的參數計算：

```javascript
function simulateKeeperPoints(difficulty, playerCount, rounds) {
  const basePoints = db.get(`keeper_action_base_difficulty_${difficulty}`).value;
  const perPlayer = db.get('keeper_action_per_player').value;
  const accumulation = db.get('keeper_action_accumulation').value;

  const playerBonus = perPlayer * Math.max(0, playerCount - 1);
  const perRoundTotal = basePoints + playerBonus;

  const accumulatedAfterRounds = [];
  let accumulated = 0;
  for (let i = 1; i <= rounds; i++) {
    accumulated += perRoundTotal;
    accumulatedAfterRounds.push(accumulated);
  }

  return {
    base_points: basePoints,
    player_bonus: playerBonus,
    per_round_total: perRoundTotal,
    accumulated_after_rounds: accumulatedAfterRounds,
    formula_text: `基礎 ${basePoints} 點 + 人數加成 ${playerBonus} 點 = 每回合 ${perRoundTotal} 點`
  };
}
```

## 12.4 智慧分析提示

模擬器底部根據結果顯示設計師友善的分析：

- 提示「50 點夠城主打出 X 張中型卡」等比對性資訊
- 提示「若現有神話卡庫中最高花費是 6 點，城主有 8 點時就能多張組合連打」
- 警告：若人數加成過高可能導致 4 人關卡過難

---

# 第十三部分：快捷鍵與互動細節

## 13.1 標籤頁切換快捷鍵

| 快捷鍵 | 功能 |
|--------|------|
| `1` | 切換到卡片編輯標籤頁 |
| `2` | 切換到總覽標籤頁 |
| `3` | 切換到遊戲平衡設定標籤頁 |
| `Tab` | 卡片編輯頁內切換神話卡 / 遭遇卡 |

## 13.2 AI 生成的 Loading 狀態

AI 生成期間：
- 按鈕變為「🤖 生成中...」並 disabled
- 顯示進度提示（連到 Gemini / 解析回應 / 填入表單）
- 超時機制：30 秒無回應顯示「生成超時，請重試」
- 失敗處理：若 Gemini 回傳非預期格式，顯示原始回應供除錯

## 13.3 批次生成的並行處理

批次生成不要一次送 5 個請求到 Gemini，而是：
- 請求序列化（一張一張生成）
- 每張之間間隔 1 秒（避免 API rate limit）
- 前端顯示進度：「生成中 2/5」

---

# 第十四部分：設計狀態追蹤

## 14.1 神話卡完整度檢查

底部動態顯示：

```
設計完整度檢查：
  ✅ 基本資訊完整
  ✅ 機制屬性已設定
  ✅ 至少一個動作
  ✅ 動作參數完整
  ⚠ 無風味文字（建議補上）
  ⚠ 無視覺素材
```

## 14.2 遭遇卡完整度檢查

```
設計完整度檢查：
  ✅ 情境描述完整
  ✅ 至少一個地點風格標籤
  ✅ 至少 2 個選項
  ✅ 所有選項的敘事文字已填寫
  ⚠ 所有選項都不需檢定（建議至少一個檢定選項）
  ⚠ 無視覺素材
```

---

# 第十五部分：admin-shared.js 修正提醒

以下修正需與 MOD-10 建置同時完成（若 MOD-03、MOD-08 尚未執行的話）：

| 項目 | 修正內容 | 來源 |
|------|---------|------|
| `getModifier` | `Math.floor(attr/2)` → `attr` | 規則書 v1.0 |
| `ENEMY_TIERS` DC | 全面 +4 | 規則書 v1.0 |
| `CREATION_TOTAL_POINTS` | 21 → 18 | GDD05 天賦樹設計修正 |

MOD-10 本身不新增修正項目，但若前述修正尚未完成，需一併處理。

---

# 第十六部分：與其他模組的整合點

## 16.1 與 MOD-03 敵人設計器的整合

- 神話卡的 `summon_monster` 動作需讀取 `monster_families` 表的家族清單
- 設計器中的家族下拉選單應即時從 `GET /api/admin/monsters/families?is_active=true` 取得
- 家族的 `is_active=false` 時不應出現在召喚動作的選項中

## 16.2 與 MOD-08 地點設計器的整合

- 遭遇卡的地點風格標籤直接讀取 `location_style_tags` 表
- 管理員在 MOD-08 新增自訂標籤後，MOD-10 即可使用
- 不能在 MOD-10 本模組中新增地點風格標籤（保持單一資料來源）

## 16.3 與 MOD-07 關卡編輯器的整合（未來）

關卡編輯器（尚未建置）使用城主卡片庫時：

- 關卡難度（1–5）→ 對應 `game_balance_settings` 的基礎行動點
- 關卡選擇神話卡庫：可選「所有神話卡」或「按類型篩選」或「按主題 tag 篩選」
- 關卡的遭遇牌堆：根據關卡地點風格自動篩選可用遭遇卡
- 此部分在 MOD-07 撰寫時會詳細定義

---

> **MOD-10 城主設計器指令文件全部完成。**
>
> 三份文件摘要：
> - **Part 1**（923 行）：6 張資料表 + 神話卡 5 張範例 + 遭遇卡 2 張範例 + 全域平衡參數 12 條 Seed Data + 後端 API 25+ 端點
> - **Part 2**（674 行）：三欄佈局 + 三標籤頁 + 神話卡編輯 5 區塊（含結構化動作編輯器）+ 遭遇卡編輯 5 區塊（含選項編輯器）
> - **Part 3**（本文件）：3 種 AI 生成模式含完整 Prompt + 總覽面板 4 個統計區 + 遊戲平衡設定介面含模擬器
>
> **給 Claude Code 的執行順序建議：**
> 1. 先建立 6 張資料表並灌入所有 Seed Data（Part 1 §1–§2）
> 2. 建立後端 API（Part 1 §3）— 城主卡片 CRUD + 動作管理 + 選項管理 + 平衡設定
> 3. 建立前端頁面骨架（Part 2 §4 佈局）+ 卡片庫切換邏輯
> 4. 實作神話卡編輯區的 5 個區塊（Part 2 §5）— 重點是結構化動作編輯器
> 5. 實作遭遇卡編輯區的 5 個區塊（Part 2 §6）— 重點是選項與效果編輯器
> 6. 實作總覽面板（Part 3 §11）
> 7. 實作遊戲平衡設定面板（Part 3 §12）— 含模擬器
> 8. 實作 AI 生成功能（Part 3 §10）— 三種模式
> 9. 細節優化：快捷鍵、完整度檢查、批次生成
>
> **與其他模組的依賴關係：**
> - 依賴 MOD-03 的 `monster_families` 表（用於 summon_monster 動作的家族選擇）
> - 依賴 MOD-08 的 `location_style_tags` 表（用於遭遇卡的地點風格標籤）
> - 被 MOD-07 關卡編輯器依賴（關卡會配置神話卡庫與遭遇牌堆）
