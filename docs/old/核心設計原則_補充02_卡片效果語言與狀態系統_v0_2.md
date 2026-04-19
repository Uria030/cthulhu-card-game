# 核心設計原則 補充 02：卡片效果語言與狀態系統 v0.2
## Core Design Principles Supplement 02: Card Effect Language & Status System v0.2

> **文件用途｜Purpose**
> 本文件定義卡片效果的標準化語言系統，供卡片設計器（MOD-01）與程式實作直接引用。
> 每個卡片效果由六大要素組成：**觸發時機 → 條件限制 → 費用類型 → 目標指定 → 效果動詞 → 持續時間**。
> 本文件同時定義狀態效果系統、元素屬性系統、傷害分配規則。
>
> 本文件從《核心設計原則》與《補充 01：遊戲規則與回合結構》展開，
> 是卡片設計的規則權威文件。

---

## 一、卡片效果結構｜Card Effect Structure

每個卡片效果由以下六大要素組成：

```
觸發時機（When）→ 條件限制（If）→ 費用類型（Cost）→ 目標指定（Target）→ 效果動詞（Effect）→ 持續時間（Duration）
```

**範例：**

> **.45 自動手槍 — 射擊能力**
> 觸發時機：免費行動（free_action）
> 條件限制：無
> 費用類型：1 彈藥（ammo: 1）+ 橫置此卡（exhaust_self）
> 目標指定：同板塊一個敵人（enemy_one）
> 效果動詞：攻擊（attack）+ 造成 3 點物理傷害（deal_damage: 3, element: physical）
> 持續時間：即時（instant）

```json
{
  "trigger": "free_action",
  "condition": null,
  "cost": {
    "ammo": 1,
    "exhaust_self": true
  },
  "target": "enemy_one",
  "effects": [
    {
      "effect_code": "attack",
      "params": {}
    },
    {
      "effect_code": "deal_damage",
      "params": {
        "amount": 3,
        "element": "physical"
      }
    }
  ],
  "duration": "instant"
}
```

---

## 二、效果動詞（做什麼）｜Effect Verbs

### 2.1 傷害類

| 代碼 | 中文 | 說明 |
|------|------|------|
| `deal_damage` | 造成傷害 | 造成物理傷害，需指定數量與元素屬性 |
| `deal_horror` | 造成恐懼 | 造成恐懼傷害（SAN 損失） |

### 2.2 恢復類

| 代碼 | 中文 | 說明 |
|------|------|------|
| `heal_hp` | 恢復 HP | 恢復當前生命值 |
| `heal_san` | 恢復 SAN | 恢復當前理智值 |
| `restore_hp_max` | 恢復 HP 上限 | 逆轉身體創傷，極稀有效果 |
| `restore_san_max` | 恢復 SAN 上限 | 逆轉精神創傷，極稀有效果 |
| `transfer_damage` | 轉移傷害 | 將物理傷害從 A 轉移到 B |
| `transfer_horror` | 轉移恐懼 | 將恐懼傷害從 A 轉移到 B |

### 2.3 卡牌操作類

| 代碼 | 中文 | 說明 |
|------|------|------|
| `draw_card` | 抽牌 | 從牌庫頂抽 X 張到手牌 |
| `reveal_top` | 翻開牌庫頂 | 翻開牌庫最上面 X 張公開展示 |
| `search_deck` | 搜尋牌庫 | 拿起牌庫上面 X 張，找符合條件的卡片執行指定動作 |
| `retrieve_card` | 回收卡片 | 將符合條件的卡片（從棄牌堆或移除區）加入手牌 |
| `return_to_deck` | 洗回牌庫 | 將手牌中 X 張洗回牌庫 |
| `discard_card` | 棄牌 | 從手牌棄到棄牌堆 |
| `shuffle_deck` | 洗牌庫 | 重新洗混牌庫 |
| `remove_from_game` | 移除出遊戲 | 永久移除，不進棄牌堆 |

#### search_deck 參數結構

```json
{
  "effect_code": "search_deck",
  "params": {
    "count": 3,
    "filter": {
      "keyword": "weapon",
      "card_type": "asset",
      "faction": "S",
      "cost_max": 4
    },
    "on_found": "to_hand | to_play | to_engaged",
    "on_remaining": "shuffle_back | to_bottom | to_discard"
  }
}
```

### 2.4 資源類

| 代碼 | 中文 | 說明 |
|------|------|------|
| `gain_resource` | 獲得資源 | 獲得指定類型的資源 |
| `spend_resource` | 花費資源 | 花費指定類型的資源 |
| `steal_resource` | 偷取資源 | 從敵人或其他來源偷取資源 |
| `transfer_resource` | 轉移資源 | 將資源轉給隊友 |

### 2.5 移動類

| 代碼 | 中文 | 說明 |
|------|------|------|
| `move_investigator` | 移動調查員 | 移動自己或隊友到指定板塊 |
| `move_enemy` | 移動敵人 | 推開、拉近、強制位移敵人 |
| `swap_position` | 交換位置 | 與隊友交換所在板塊 |
| `place_enemy` | 放置敵人 | 將敵人直接放到指定板塊（非移動） |
| `jump` | 跳躍移動 | 移動時不觸發交戰進入，不觸發藉機攻擊 |

### 2.6 狀態類

| 代碼 | 中文 | 說明 |
|------|------|------|
| `engage_enemy` | 進入交戰 | 與敵人建立交戰關係 |
| `disengage_enemy` | 脫離交戰 | 安全脫離交戰，不觸發藉機攻擊 |
| `exhaust_card` | 橫置卡片 | 將卡片橫置（標記已使用） |
| `ready_card` | 轉正卡片 | 將橫置卡片恢復可用 |
| `stun_enemy` | 絆倒敵人 | 敵人失去下次行動 |
| `add_status` | 添加狀態 | 對目標施加狀態效果 |
| `remove_status` | 移除狀態 | 移除目標身上的狀態效果 |

### 2.7 檢定類

| 代碼 | 中文 | 說明 |
|------|------|------|
| `make_test` | 進行檢定 | 指定屬性和 DC 進行檢定 |
| `modify_test` | 修改檢定值 | 對檢定結果施加 +X / -X 修正 |
| `reroll` | 重擲 | 重新擲骰 |
| `auto_success` | 自動成功 | 檢定自動視為成功 |
| `auto_fail` | 自動失敗 | 檢定自動視為失敗 |

### 2.8 戰鬥類

| 代碼 | 中文 | 說明 |
|------|------|------|
| `attack` | 攻擊 | 發動攻擊（搭配 deal_damage 使用） |
| `evade` | 閃避 | 發動閃避檢定 |
| `taunt` | 嘲諷 | 將敵人拉入與自己交戰 |
| `counterattack` | 反擊 | 受到攻擊時自動回擊 |
| `extra_attack` | 額外攻擊 | 不佔行動點的追加攻擊 |

### 2.9 環境類

| 代碼 | 中文 | 說明 |
|------|------|------|
| `place_clue` | 放置線索 | 在板塊上放置線索 |
| `discover_clue` | 發現線索 | 不用檢定直接獲得線索 |
| `place_doom` | 放置毀滅標記 | 在 Agenda 上放置毀滅標記 |
| `remove_doom` | 移除毀滅標記 | 從 Agenda 移除毀滅標記 |
| `seal_gate` | 封印次元門 | 封印一個次元門 |
| `spawn_enemy` | 生成敵人 | 在指定板塊召喚敵人 |
| `remove_enemy` | 移除敵人 | 將敵人從場上移除（非擊殺） |
| `execute_enemy` | 斬殺敵人 | 直接擊殺敵人，無視 HP |
| `reveal_tile` | 翻開板塊 | 將地圖板塊翻面，揭開隱藏真相 |
| `place_tile` | 放置板塊 | 放置一個新地圖板塊進場 |
| `remove_tile` | 移除板塊 | 移除一個地圖板塊 |
| `place_haunting` | 放置鬧鬼 | 在板塊上放置鬧鬼怪物 |
| `remove_haunting` | 移除鬧鬼 | 移除板塊上的鬧鬼怪物 |
| `advance_act` | 推進行動牌堆 | 推進 Act 牌堆 |
| `advance_agenda` | 推進議程牌堆 | 推進 Agenda 牌堆 |
| `connect_tiles` | 建立連接 | 建立兩個板塊之間的連接關係 |
| `disconnect_tiles` | 斷開連接 | 斷開兩個板塊之間的連接關係 |

### 2.10 光照類

| 代碼 | 中文 | 說明 |
|------|------|------|
| `create_light` | 創造光源 | 在板塊上放置光源物件 |
| `extinguish_light` | 熄滅光源 | 移除光源物件 |
| `create_darkness` | 製造黑暗 | 將板塊設為黑暗狀態 |
| `remove_darkness` | 移除黑暗 | 解除板塊的黑暗狀態 |
| `create_fire` | 引發火災 | 將板塊設為失火狀態 |
| `extinguish_fire` | 撲滅火災 | 解除板塊的失火狀態 |

### 2.11 特殊類

| 代碼 | 中文 | 說明 |
|------|------|------|
| `add_keyword` | 添加詞綴 | 給敵人或卡片添加詞綴 |
| `remove_keyword` | 移除詞綴 | 移除敵人或卡片的詞綴 |
| `add_bless` | 放入祝福 | 在混沌袋中放入祝福標記 |
| `add_curse` | 放入詛咒 | 在混沌袋中放入詛咒標記 |
| `remove_bless` | 移除祝福 | 從混沌袋移除祝福標記 |
| `remove_curse` | 移除詛咒 | 從混沌袋移除詛咒標記 |
| `look_chaos_bag` | 窺探混沌袋 | 查看混沌袋內容但不抽取 |
| `manipulate_chaos_bag` | 操控混沌袋 | 移除、替換或重排混沌袋標記 |

---

## 三、目標指定（對誰）｜Target Types

### 3.1 調查員目標

| 代碼 | 中文 | 說明 |
|------|------|------|
| `self` | 自己 | 使用此卡的調查員本人 |
| `ally_one` | 一位隊友 | 選擇一位隊友（不含自己） |
| `ally_all` | 同板塊所有隊友 | 同板塊的所有隊友（不含自己） |
| `investigator_any` | 任一調查員 | 選擇任一調查員（含自己） |
| `investigator_all` | 所有調查員 | 場上所有調查員 |

### 3.2 敵人目標

| 代碼 | 中文 | 說明 |
|------|------|------|
| `enemy_one` | 一個敵人 | 選擇同板塊一個敵人 |
| `enemy_all_location` | 同板塊所有敵人 | 同板塊的所有敵人 |
| `enemy_engaged` | 交戰中的敵人 | 與你交戰中的敵人 |
| `enemy_non_elite` | 精英以下敵人 | 雜兵（Minion）和威脅（Threat）等級的敵人 |
| `enemy_normal` | 普通敵人 | 非巨頭、非頭目的敵人 |
| `enemy_elite` | 精英以上敵人 | 精英（Elite）以上等級的敵人 |

### 3.3 卡片與場景目標

| 代碼 | 中文 | 說明 |
|------|------|------|
| `ally_card` | 盟友卡 | 場上一張盟友卡 |
| `asset_card` | 資產卡 | 場上一張資產卡 |
| `location` | 地圖板塊 | 一個地圖板塊 |

---

## 四、費用類型（花什麼）｜Cost Types

| 代碼 | 中文 | 說明 |
|------|------|------|
| `resource` | 資源 | 通用資源點數 |
| `forbidden_insight` | 禁忌洞察 | 特殊貨幣 |
| `faith` | 信仰 | 特殊貨幣 |
| `elder_sign` | 遠古印記 | 稀有資源 |
| `hp` | 生命值 | 以自身 HP 為代價 |
| `san` | 理智值 | 以自身 SAN 為代價 |
| `discard_hand` | 棄手牌 | 從手牌棄指定數量的牌 |
| `discard_specific` | 棄指定牌 | 棄符合特定條件的手牌 |
| `exhaust_self` | 橫置此卡 | 將此卡橫置 |
| `exhaust_other` | 橫置其他卡 | 橫置場上另一張卡 |
| `ammo` | 彈藥 | 消耗卡片上的子彈標記 |
| `uses` | 使用次數 | 消耗卡片上的通用次數標記 |
| `clue` | 線索 | 交出已蒐集的線索 |
| `action_point` | 行動點 | 額外花費行動點 |
| `doom` | 毀滅標記 | 放置毀滅標記到 Agenda（以推進敵人計畫為代價） |

---

## 五、條件限制（什麼情況下能用）｜Conditions

### 5.1 交戰相關

| 代碼 | 中文 | 說明 |
|------|------|------|
| `while_engaged` | 交戰中 | 你正與敵人交戰 |
| `while_not_engaged` | 未交戰 | 你沒有與任何敵人交戰 |
| `ally_engaged` | 隊友交戰中 | 至少一位隊友正在交戰 |

### 5.2 血量相關

| 代碼 | 中文 | 說明 |
|------|------|------|
| `hp_below_half` | HP 低於一半 | 當前 HP 低於上限的一半 |
| `hp_below_x` | HP 低於 X | 當前 HP 低於指定值 |
| `san_below_half` | SAN 低於一半 | 當前 SAN 低於上限的一半 |
| `san_below_x` | SAN 低於 X | 當前 SAN 低於指定值 |

### 5.3 光照相關

| 代碼 | 中文 | 說明 |
|------|------|------|
| `in_darkness` | 黑暗中 | 所在板塊處於黑暗狀態 |
| `in_light` | 光照中 | 所在板塊處於光照狀態 |
| `in_fire` | 失火中 | 所在板塊處於失火狀態 |

### 5.4 時間相關

| 代碼 | 中文 | 說明 |
|------|------|------|
| `daytime` | 白天 | 場景處於白天 |
| `nighttime` | 夜間 | 場景處於夜間 |

### 5.5 卡牌相關

| 代碼 | 中文 | 說明 |
|------|------|------|
| `hand_empty` | 手牌為零 | 手牌數量為 0 |
| `hand_full` | 手牌達上限 | 手牌數量達到上限（8 張） |
| `deck_empty` | 牌庫為空 | 牌庫中沒有卡片 |
| `has_weapon` | 有武器 | 場上裝備有武器類資產 |
| `has_ally` | 有盟友 | 場上有盟友卡 |
| `has_item` | 有一般物品 | 場上有一般物品類資產 |
| `has_arcane_item` | 有魔法物品 | 場上有魔法物品類資產 |
| `has_weakness` | 有弱點 | 場上有弱點卡 |

### 5.6 位置相關

| 代碼 | 中文 | 說明 |
|------|------|------|
| `at_location_with_clue` | 板塊有線索 | 所在板塊有可蒐集的線索 |
| `at_location_with_enemy` | 板塊有敵人 | 所在板塊有敵人存在 |
| `alone_at_location` | 獨自在板塊 | 板塊上只有你一個調查員 |
| `at_location_with_hidden_clue` | 板塊有隱藏線索 | 所在板塊有未發現的隱藏調查點 |
| `at_location_with_hidden_info` | 板塊有隱藏資訊 | 所在板塊背面有未翻開的隱藏資訊 |

---

## 六、持續時間（效果維持多久）｜Durations

| 代碼 | 中文 | 說明 |
|------|------|------|
| `instant` | 即時 | 一次性生效，不持續 |
| `until_end_of_turn` | 到回合結束 | 持續到本回合結束 |
| `until_end_of_round` | 到輪結束 | 持續到本輪結束（含敵人階段和回合結束階段） |
| `until_next_turn` | 到下回合開始 | 持續到你的下一個回合開始 |
| `until_end_of_scenario` | 到場景結束 | 持續到本場景結束 |
| `permanent` | 永久 | 整場戰役持續 |
| `while_in_play` | 在場期間 | 只要此卡在場上就持續 |
| `x_rounds` | X 回合 | 持續指定回合數後消失 |
| `until_triggered` | 到條件觸發 | 持續到特定條件滿足時消失 |
| `once_per_turn` | 每回合一次 | 每回合限用一次（搭配橫置） |
| `once_per_round` | 每輪一次 | 每輪限用一次 |
| `once_per_scenario` | 每場景一次 | 每場景限用一次 |
| `until_short_rest` | 到短休息 | 持續到短休息時消失 |
| `until_long_rest` | 到長休息 | 持續到長休息時消失 |

### 6.1 使用限制範圍（Scope）

當效果有使用次數限制（`once_per_turn`、`once_per_round`、`once_per_scenario`）時，需搭配 scope 參數指定計算範圍：

| 代碼 | 中文 | 說明 |
|------|------|------|
| `per_investigator` | 每位調查員 | 每位調查員各自獨立計算使用次數 |
| `per_team` | 全團隊 | 全團隊共用使用次數，一人用過其他人也不能用 |

---

## 七、觸發時機（什麼時候觸發）｜Trigger Types

### 7.1 卡片生命週期

| 代碼 | 中文 | 說明 |
|------|------|------|
| `on_play` | 打出時 | 卡片從手牌打出時 |
| `on_commit` | 加值投入時 | 卡片投入檢定作為加值時 |
| `on_consume` | 消費時 | 消費卡上資源時（開槍、喝藥等） |
| `on_enter_play` | 進場時 | 資產卡放到場上時 |
| `on_leave_play` | 離場時 | 卡片被摧毀、棄牌、移除時 |
| `on_draw` | 被抽到時 | 卡片從牌庫被抽到時（神啟卡/弱點卡用） |

### 7.2 檢定相關

| 代碼 | 中文 | 說明 |
|------|------|------|
| `on_success` | 檢定成功時 | 檢定結果為成功時 |
| `on_failure` | 檢定失敗時 | 檢定結果為失敗時 |
| `on_critical` | 大成功時 | 擲出自然 20 時 |
| `on_fumble` | 大失敗時 | 擲出自然 1 時 |

### 7.3 傷害相關

| 代碼 | 中文 | 說明 |
|------|------|------|
| `on_take_damage` | 受到傷害時 | 受到物理傷害時 |
| `on_take_horror` | 受到恐懼時 | 受到恐懼傷害時 |

### 7.4 交戰與移動

| 代碼 | 中文 | 說明 |
|------|------|------|
| `on_engage` | 進入交戰時 | 與敵人建立交戰關係時 |
| `on_disengage` | 脫離交戰時 | 與敵人解除交戰關係時 |
| `on_move` | 移動時 | 調查員移動時 |
| `on_enter_location` | 進入板塊時 | 進入新的地圖板塊時 |

### 7.5 敵人相關

| 代碼 | 中文 | 說明 |
|------|------|------|
| `on_enemy_spawn` | 敵人出現時 | 新敵人出現在場上時 |
| `on_enemy_defeat` | 敵人被擊敗時 | 敵人被擊敗時 |
| `on_ally_downed` | 隊友倒地時 | 隊友 HP 或 SAN 歸零時 |

### 7.6 回合節奏

| 代碼 | 中文 | 說明 |
|------|------|------|
| `on_turn_start` | 回合開始時 | 調查員階段開始時 |
| `on_turn_end` | 回合結束時 | 回合結束階段時 |
| `on_enemy_phase` | 敵人階段時 | 敵人階段進行時 |

### 7.7 行動模式

| 代碼 | 中文 | 說明 |
|------|------|------|
| `reaction` | 反應 | 特定條件滿足時即時觸發，不佔行動點 |
| `passive` | 被動 | 持續生效的效果 |
| `free_action` | 免費行動 | 主動使用，不佔行動點 |

---

## 八、元素屬性系統｜Elemental Attributes

### 8.1 五大元素

| 代碼 | 中文 | 說明 |
|------|------|------|
| `physical` | 物理 | 拳頭、刀劍、槍械等 |
| `fire` | 火 | 火焰、燃燒 |
| `ice` | 冰 | 冰冷、凍結 |
| `lightning` | 電 | 電擊 |
| `arcane` | 神秘 | 法術、超自然力量 |

### 8.2 元素與狀態的互動

- **火屬性攻擊** → 可施加燃燒狀態，對已燃燒目標增加傷害。
- **冰屬性攻擊** → 可施加冷凍狀態，對已冷凍目標增加傷害。
- **電屬性攻擊** → 對潮濕目標增加傷害。
- **燃燒與潮濕互斥** — 燃燒會移除潮濕。

### 8.3 元素抗性與免疫

每個怪物可針對五種元素各自設定抗性或免疫：

| 代碼 | 說明 |
|------|------|
| `physical_resistance(X)` | 物理傷害減免 X 點 |
| `physical_immunity` | 物理傷害免疫 |
| `fire_resistance(X)` | 火焰傷害減免 X 點 |
| `fire_immunity` | 火焰傷害免疫 |
| `ice_resistance(X)` | 冰冷傷害減免 X 點 |
| `ice_immunity` | 冰冷傷害免疫 |
| `lightning_resistance(X)` | 電擊傷害減免 X 點 |
| `lightning_immunity` | 電擊傷害免疫 |
| `arcane_resistance(X)` | 神秘傷害減免 X 點 |
| `arcane_immunity` | 神秘傷害免疫 |

---

## 九、傷害分配規則｜Damage Assignment Rules

### 9.1 預設規則

- 調查員受到傷害或恐懼時，玩家可以**自行分配**傷害到自己或場上的盟友身上。
- 這是預設行為，不需要特定卡片。

### 9.2 傷害關鍵字

| 關鍵字 | 代碼 | 效果 |
|--------|------|------|
| **直擊** | `direct` | 傷害強制扣在調查員本人身上，不能分配到盟友 |
| **廣域（數字）** | `area(X)` | 對該調查員桌上所有卡片（盟友、裝備等有 HP/SAN 的資產）都造成 X 點傷害 |

### 9.3 設計意圖

- **直擊** — 繞過盟友保護，直接威脅調查員本人。高階敵人的殺手鐧。
- **廣域** — 摧毀整個場面。一次把盟友、裝備全部炸一遍，讓調查員失去所有依靠。

---

## 十、狀態效果系統｜Status Effect System

### 10.0 狀態核心規則｜Core Status Rules

> **所有狀態皆可堆疊。狀態在經歷完整一回合後，於該回合結束階段減少 1 層。**
>
> （回合中途獲得的狀態，該回合結束時不減層，須等到下一個回合結束才減少。）

**範例：**

| 情境 | 結果 |
|------|------|
| A 玩家在第 3 回合對 B 施放加速 1 層 | B 在第 3 回合獲得 +1 行動點。第 3 回合結束不減層（未經歷完整回合）。第 4 回合 B 再獲得 +1 行動點。第 4 回合結束減 1 層，加速消失。**實際賺到 2 個行動點。** |
| 中毒 3 層 | 受傷時 +3 傷害。經歷完整回合後，回合結束減至 2 層。 |
| 護甲 1 層 | 受傷時減免 1 傷害。經歷完整回合後，回合結束減至 0 層，護甲消失。 |

**狀態分為兩種類型：**

1. **數值型狀態** — 層數 = 效果強度。例如：護甲 3 層 = 減免 3 點傷害。
2. **開關型狀態** — 效果固定，層數 = 持續回合數。例如：繳械 2 層 = 持續 2 個完整回合。

---

### 10.1 負面狀態（Debuff）

#### 數值型負面狀態

| 狀態 | 代碼 | 效果 |
|------|------|------|
| 中毒 | `poison` | 受到的傷害 +X（X = 層數） |
| 流血 | `bleed` | 回合結束時扣 X 點 HP（X = 層數） |
| 燃燒 | `burning` | 回合開始時扣 X 點 HP。被火屬性攻擊時傷害 +X。獲得燃燒時移除所有潮濕（X = 層數） |
| 冷凍 | `frozen` | 移動花費 2 行動點（開關效果）。被冰屬性攻擊時傷害 +X（X = 層數） |
| 毀滅 | `doom_status` | 回合結束時受到 X 點傷害（X = 層數） |
| 發瘋 | `madness` | 受到的恐懼 +X（X = 層數） |
| 標記 | `marked` | 受到的傷害和恐懼都 +X（X = 層數） |
| 脆弱 | `vulnerable` | 受到的物理傷害 +X（X = 層數） |
| 無力 | `weakness_status` | 近戰傷害降低 X 點（X = 層數） |
| 潮濕 | `wet` | 被電擊屬性攻擊時傷害 +X（X = 層數） |
| 弱化 | `weakened` | 擲骰時丟兩次取差的，擲骰後減少 1 層 |

#### 開關型負面狀態（層數 = 持續回合數）

| 狀態 | 代碼 | 效果 |
|------|------|------|
| 黑暗 | `darkness` | 攻擊命中檢定 -2 |
| 繳械 | `disarm` | 不能用資產進行攻擊 |
| 疲勞 | `fatigue` | 結束階段不能抽牌和獲得資源 |
| 沈默 | `silence` | 無法施法 |

---

### 10.2 正面狀態（Buff）

#### 數值型正面狀態

| 狀態 | 代碼 | 效果 |
|------|------|------|
| 強化 | `empowered` | 擲骰時丟兩次取好的，擲骰後減少 1 層 |
| 護甲 | `armor` | 降低 X 點物理傷害（X = 層數） |
| 護盾 | `ward` | 降低 X 點恐懼傷害（X = 層數） |
| 加速 | `haste` | 獲得 +X 行動點（X = 層數） |
| 再生 | `regeneration` | 回合開始時恢復 X 點 HP（X = 層數） |

#### 特殊型正面狀態

| 狀態 | 代碼 | 效果 |
|------|------|------|
| 隱蔽 | `stealth` | 不觸發藉機攻擊。攻擊命中時傷害 +X（X = 層數）。**移動後或攻擊後全部移除。** |

---

### 10.3 混沌袋狀態

| 狀態 | 代碼 | 效果 |
|------|------|------|
| 祝福 | `bless` | 混沌袋中放入祝福標記（+1，再抽一顆） |
| 詛咒 | `curse` | 混沌袋中放入詛咒標記（-1，再抽一顆） |

- 抽袋時同時抽到祝福和詛咒 → **互相抵消，兩者都移除**。
- 強化與弱化**不影響混沌袋抽取** — 混沌袋代表命運，不可操控。

---

## 十一、資源貨幣系統｜Resource Currency System

### 11.1 三種關卡中貨幣

| 代碼 | 中文 | 起始值 | 獲取方式 | 用途 |
|------|------|--------|----------|------|
| `resource` | 資源 | 5 | 每回合 +1、行動獲取、卡片效果 | 打牌費用、各種行動費用 |
| `forbidden_insight` | 禁忌洞察 | 0 | 待設計 | 解鎖副陣營、待設計其他用途 |
| `faith` | 信仰 | 0 | 待設計 | 待設計 |

### 11.2 特殊資源

| 代碼 | 中文 | 說明 |
|------|------|------|
| `elder_sign` | 遠古印記 | 稀有魔法道具（卡片形式），可直接封印次元門，也可作為強力卡片的費用 |

---

## 十二、物品子類型標籤｜Item Subtypes

資產卡需要標註物品子類型，供條件限制篩選使用：

| 代碼 | 中文 | 說明 |
|------|------|------|
| `item` | 一般物品 | 普通的物理道具（手電筒、繩索、急救箱等） |
| `arcane_item` | 魔法物品 | 超自然道具（護符、咒文卷軸、遠古印記等） |
| `weapon` | 武器 | 可用於攻擊的裝備 |
| `weapon_melee` | 近戰武器 | 刀劍、棍棒等近戰武器 |
| `weapon_ranged` | 遠程武器 | 槍械、弓弩等遠程武器 |
| `weapon_arcane` | 法術武器 | 施法媒介、魔法武器 |
| `consumable` | 消耗品 | 使用後移除的一次性物品 |
| `light_source` | 光源 | 提供照明的物品（火把、油燈、手電筒等） |

---

## 十三、卡片效果完整範例｜Complete Effect Examples

### 範例一：.45 自動手槍（標準武器）

```json
{
  "card_code": "core_45_automatic",
  "name_zh": ".45 自動手槍",
  "card_type": "asset",
  "subtypes": ["weapon", "weapon_ranged", "item"],
  "slot": "hand",
  "cost": 3,
  "ammo": 4,
  "damage": 3,
  "element": "physical",
  "effects": [
    {
      "trigger": "free_action",
      "condition": null,
      "cost": { "ammo": 1, "exhaust_self": true },
      "target": "enemy_one",
      "effect_code": "attack",
      "params": { "damage": 3, "element": "physical", "check_attribute": "agility", "check_modifier": 1 },
      "duration": "instant",
      "description_zh": "花費 1 子彈，橫置：對同板塊一個敵人進行攻擊（敏捷 +1），命中造成 3 點物理傷害。",
      "description_en": "Spend 1 ammo, exhaust: Attack an enemy at your location (Agility +1). Deal 3 physical damage."
    }
  ]
}
```

### 範例二：急救箱（治療道具）

```json
{
  "card_code": "core_first_aid_kit",
  "name_zh": "急救箱",
  "card_type": "asset",
  "subtypes": ["item", "consumable"],
  "slot": "none",
  "cost": 2,
  "uses": 3,
  "effects": [
    {
      "trigger": "free_action",
      "condition": null,
      "cost": { "uses": 1, "exhaust_self": true },
      "target": "investigator_any",
      "effect_code": "heal_hp",
      "params": { "amount": 2 },
      "duration": "instant",
      "description_zh": "花費 1 次使用，橫置：恢復一位調查員 2 點 HP。",
      "description_en": "Spend 1 use, exhaust: Heal 2 HP from an investigator at your location."
    }
  ]
}
```

### 範例三：護身符（反應型防禦）

```json
{
  "card_code": "core_protective_charm",
  "name_zh": "護身符",
  "card_type": "asset",
  "subtypes": ["arcane_item"],
  "slot": "accessory",
  "cost": 2,
  "uses": 4,
  "effects": [
    {
      "trigger": "reaction",
      "condition": "on_take_horror",
      "cost": { "uses": 1 },
      "target": "self",
      "effect_code": "heal_san",
      "params": { "amount": 1 },
      "duration": "instant",
      "description_zh": "當你受到恐懼傷害時，花費 1 次使用：抵消 1 點恐懼傷害。",
      "description_en": "When you take horror, spend 1 use: Cancel 1 horror."
    }
  ]
}
```

### 範例四：火焰瓶（攻擊 + 狀態附加）

```json
{
  "card_code": "core_molotov_cocktail",
  "name_zh": "火焰瓶",
  "card_type": "event",
  "subtypes": ["item", "consumable"],
  "cost": 3,
  "effects": [
    {
      "trigger": "on_play",
      "condition": null,
      "cost": { "action_point": 1 },
      "target": "enemy_all_location",
      "effect_code": "deal_damage",
      "params": { "amount": 2, "element": "fire" },
      "duration": "instant",
      "description_zh": "對同板塊所有敵人造成 2 點火焰傷害。",
      "description_en": "Deal 2 fire damage to all enemies at your location."
    },
    {
      "trigger": "on_play",
      "condition": null,
      "cost": null,
      "target": "enemy_all_location",
      "effect_code": "add_status",
      "params": { "status": "burning", "stacks": 1 },
      "duration": "instant",
      "description_zh": "所有受影響的敵人獲得燃燒 1 層。",
      "description_en": "All affected enemies gain 1 stack of Burning."
    },
    {
      "trigger": "on_play",
      "condition": null,
      "cost": null,
      "target": "location",
      "effect_code": "create_fire",
      "params": {},
      "duration": "permanent",
      "description_zh": "你所在的板塊進入失火狀態。",
      "description_en": "Your location catches fire."
    }
  ]
}
```

### 範例五：暗影步（跳躍移動 + 隱蔽）

```json
{
  "card_code": "abyss_shadow_step",
  "name_zh": "暗影步",
  "card_type": "event",
  "subtypes": ["arcane_item"],
  "faction": "I",
  "cost": 2,
  "effects": [
    {
      "trigger": "on_play",
      "condition": null,
      "cost": { "action_point": 1 },
      "target": "self",
      "effect_code": "jump",
      "params": { "distance": 2 },
      "duration": "instant",
      "description_zh": "移動最多 2 個板塊，不觸發交戰或藉機攻擊。",
      "description_en": "Move up to 2 locations without triggering engagement or attacks of opportunity."
    },
    {
      "trigger": "on_play",
      "condition": "nighttime",
      "cost": null,
      "target": "self",
      "effect_code": "add_status",
      "params": { "status": "stealth", "stacks": 2 },
      "duration": "instant",
      "description_zh": "若為夜間，你獲得隱蔽 2 層。",
      "description_en": "If it is nighttime, gain 2 stacks of Stealth."
    }
  ]
}
```

---

## 十四、術語定義補充｜Glossary Supplement

以下術語為本文件新增，應追加至《核心設計原則》詞彙表：

| 中文 | English | 定義 |
|------|---------|------|
| 效果動詞 | Effect Verb | 卡片效果的標準化動作代碼 |
| 目標指定 | Target Type | 卡片效果的作用對象分類 |
| 費用類型 | Cost Type | 觸發卡片效果所需支付的代價種類 |
| 條件限制 | Condition | 卡片效果觸發前必須滿足的前置條件 |
| 持續時間 | Duration | 卡片效果維持的時間長度 |
| 觸發時機 | Trigger Type | 卡片效果被啟動的時間點 |
| 元素屬性 | Element | 攻擊和法術所帶的屬性標籤（物理/火/冰/電/神秘） |
| 直擊 | Direct | 傷害關鍵字，強制扣在調查員本人，不可分配到盟友 |
| 廣域 | Area | 傷害關鍵字，對調查員桌上所有卡片都造成傷害 |
| 狀態層數 | Status Stacks | 狀態的堆疊數量，影響效果強度或持續時間 |
| 數值型狀態 | Scaling Status | 層數 = 效果強度的狀態類型 |
| 開關型狀態 | Toggle Status | 效果固定、層數 = 持續時間的狀態類型 |
| 中毒 | Poison | 負面狀態，受到的傷害增加（數值型） |
| 流血 | Bleed | 負面狀態，回合結束時扣 HP（數值型） |
| 燃燒 | Burning | 負面狀態，回合開始時扣 HP，火屬性攻擊增傷，移除潮濕（數值型） |
| 冷凍 | Frozen | 負面狀態，移動花費增加（開關），冰屬性攻擊增傷（數值型） |
| 繳械 | Disarm | 負面狀態，不能用資產進行攻擊（開關型） |
| 毀滅狀態 | Doom Status | 負面狀態，回合結束時受到傷害（數值型） |
| 疲勞 | Fatigue | 負面狀態，不能抽牌和獲得資源（開關型） |
| 發瘋 | Madness | 負面狀態，受到的恐懼增加（數值型） |
| 標記 | Marked | 負面狀態，受到的傷害和恐懼都增加（數值型） |
| 脆弱 | Vulnerable | 負面狀態，受到的物理傷害增加（數值型） |
| 沈默 | Silence | 負面狀態，無法施法（開關型） |
| 無力 | Weakness Status | 負面狀態，近戰傷害降低（數值型） |
| 潮濕 | Wet | 負面狀態，被電擊攻擊時傷害增加（數值型） |
| 黑暗 | Darkness | 負面狀態，攻擊命中檢定 -2（開關型） |
| 弱化 | Weakened | 負面狀態，擲骰取差的，使用後減 1 層（數值型） |
| 強化 | Empowered | 正面狀態，擲骰取好的，使用後減 1 層（數值型） |
| 護甲 | Armor | 正面狀態，降低物理傷害（數值型） |
| 護盾 | Ward | 正面狀態，降低恐懼傷害（數值型） |
| 隱蔽 | Stealth | 正面狀態，不觸發藉機攻擊，攻擊增傷，移動或攻擊後全部移除（特殊型） |
| 加速 | Haste | 正面狀態，獲得額外行動點（數值型） |
| 再生 | Regeneration | 正面狀態，回合開始時恢復 HP（數值型） |
| 祝福 | Bless | 混沌袋標記，+1 並再抽一顆 |
| 詛咒 | Curse | 混沌袋標記，-1 並再抽一顆 |
| 一般物品 | Item | 物品子類型，普通物理道具 |
| 魔法物品 | Arcane Item | 物品子類型，超自然道具 |
| 資源 | Resource | 通用貨幣，起始 5 點，每回合 +1 |
| 禁忌洞察 | Forbidden Insight | 特殊貨幣，用途待設計 |
| 信仰 | Faith | 特殊貨幣，用途待設計 |
| 遠古印記 | Elder Sign | 稀有魔法道具，可直接封印次元門 |

---

## 十五、文件版本紀錄｜Version History

| 版本 | 日期 | 變更內容 |
|------|------|----------|
| v0.1 | 2026/04/12 | 初版建立 — 卡片效果六大要素（觸發時機、條件限制、費用類型、目標指定、效果動詞、持續時間）、元素屬性系統（物理/火/冰/電/神秘）、傷害分配規則（直擊/廣域）、狀態效果系統（15 種負面 + 6 種正面 + 2 種混沌袋）、資源貨幣系統（資源/禁忌洞察/信仰/遠古印記）、物品子類型標籤、使用限制範圍（per_investigator/per_team）、動態板塊連接（connect_tiles/disconnect_tiles）、完整 JSON 範例 |
| v0.2 | 2026/04/14 | 狀態系統重構 — 新增狀態核心規則（所有狀態可堆疊，經歷完整回合後減 1 層）、區分數值型與開關型狀態、修正強化/弱化為「使用後減 1 層」、修正加速/再生為數值型（層數 = 效果量）、重新設計隱蔽（攻擊增傷 +X，移動或攻擊後全部移除）、更新術語表新增狀態層數相關定義 |

---

> **給未來 Claude 實例的備註｜Note to Future Claude Instances**
>
> 本文件是卡片設計器（MOD-01）的規則基礎。所有卡片的 JSON 結構必須遵循本文件定義的語法。
>
> 重要設計精神：
> 1. **每個效果代碼都對應一段程式邏輯** — 不要發明文件中未定義的 effect_code。
> 2. **元素互動是有意設計的** — 燃燒移除潮濕、電擊對潮濕增傷，這些都是戰術深度的來源。
> 3. **傷害分配是玩家選擇** — 預設可以分配到盟友，直擊和廣域是例外。
> 4. **強化/弱化不影響混沌袋** — 混沌袋代表命運，不可操控。
> 5. **正面狀態刻意稀少** — 這是克蘇魯遊戲，不是英雄奇幻。
> 6. **祝福和詛咒互相抵消** — 這在混沌袋中創造了有趣的策略：故意放詛咒來消除對手放的詛咒？
> 7. **狀態堆疊是核心機制** — 所有狀態可堆疊，經歷完整回合後減 1 層。這創造了「預先施放」的戰術價值。
> 8. **隱蔽是特殊狀態** — 隱蔽不遵循標準減層規則，移動或攻擊後全部移除。這是刻意的設計，讓暗殺型角色有明確的決策點。
