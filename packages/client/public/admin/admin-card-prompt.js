/* ========================================
   MOD-01 卡片設計器 — Gemini Prompt 共用模組
   ========================================
   抽出 buildGeminiPrompt 為共用函式（暴露為 window.buildCardGeminiPrompt）
   供 admin-card-designer.html（實際生成卡片）與
     admin-system-diag.html（診斷測試）共用，
   避免 prompt 內容在兩處各維護一份造成漂移。
*/
window.buildCardGeminiPrompt = function(userDescription, options) {
    var opts = options || {};
    var batchCount = Number(opts.batchCount) || 1;
    var isBatch = batchCount > 1;
    var plural = isBatch ? (batchCount + ' 張') : '一張';
    var batchOutputNote = isBatch
      ? ('\n\n## 十一、批次輸出格式（batchCount=' + batchCount + '）\n批次模式必須回傳一個 JSON 物件 `{ "cards": [ ... ] }`，陣列內放 ' + batchCount + ' 張卡片，每張卡遵循下方第九部定義的 JSON 結構。不要回傳單一卡片物件，不要外層加 markdown fence。\n')
      : '';
    var existingCardsBlock = (opts.existingCardsContext && String(opts.existingCardsContext).trim())
      ? ('\n\n## 負一、既有卡池上下文（**不要重複，不要衝突**）\n\n以下是目前資料庫內與本次需求相關的既有卡片。你生成的新卡必須：\n1. **不得重名** name_zh：新卡 name_zh 一律避開上清單出現過的卡名（包含近似名，例如「老警長的配槍」已存在時，「老警長的配槍 II」也算同名衝突，請換一個有辨識度的新名）\n2. **不得重疊軸向指認句型**：如果某張既有卡已經用「在你打出另一張 X 卡時...」觸發 A 效果，新卡就不要也寫 A 效果（要補位其他效果）\n3. **補空白而非堆疊**：以下清單的分佈已經告訴你「哪些等級/費用/類型已經飽和」，新卡要填空白（例：如果 LV2 資產卡已 3 張，優先生 LV3 或事件/技能類型）\n4. **同主軸系列要有設計呼應**：維持風味連貫，但機制切角要互補（前排/後排/支援/反應/消費...）\n\n' + String(opts.existingCardsContext).trim() + '\n')
      : '';
    return `你是一個克蘇魯神話卡牌遊戲的卡片設計師。請根據以下完整規則和使用者需求，生成${plural}**數值平衡**的卡片。${batchOutputNote}${existingCardsBlock}

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
- 資產卡(2:1)：稀有度抵扣 = 總輸出價值 - 1V(留場) - 消耗修正 - 等級抵扣 - (費用×2)
- 盟友卡(1:1)：稀有度抵扣 = HP×0.5V + SAN×0.5V + 2V + 能力價值 - 等級抵扣 - 費用
- 技能卡：費用=0，不計稀有度，檢驗價值區間(LV0:2.5-3V, LV2:5-6V, LV3:7-8V, LV5:9-10V)

### 抵扣值對照表（向上進位）
≤0：隨身, 0.1~1：基礎, 1.1~2：標準, 2.1~3：進階, 3.1~4：稀有, 4.1~5：傳奇, >5：超出範圍

### 等級抵扣：0級=0, 1級=-1V, 2級=-2V, 3級=-3V, 4級=-4V, 5級=-5V
### 消耗類型修正：留場=-1V, 棄牌=0, 短休息=-1V, 長休息=-2V, 移除=-3V

## 一、遊戲基礎規則

### 骰子與檢定
- 骰子系統：d20
- 檢定公式：d20 + 屬性修正(0~5) + 熟練/專精修正(0~3) + 武器屬性修正(依風格卡決定)
- 自然 20：爆擊，2 倍傷害
- 自然 1：大失敗，可能傷害隊友

### 八大屬性（支柱一 v0.2 起）
力量 strength、敏捷 agility、體質 constitution、**反應 reflex**、智力 intellect、意志 willpower、感知 perception、魅力 charisma

**反應（reflex）** 由敏捷切出，作用範圍：閃避、即時反應、中斷判定、應激判定、突發事件的即時處理。**本專案無「先攻值」機制**（v0.3 §12.4 勘誤）——先攻順序由反應屬性檢定決定，舊文件若出現「先攻值」字樣視為誤植。

### 八陣營主屬性一對一對應
E 魅力 charisma、I 智力 intellect、S 感知 perception、N 意志 willpower、T 敏捷 agility、F 力量 strength、J 體質 constitution、**P 反應 reflex**（原為敏捷，v0.2 改）

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
武器不再固定指定檢定屬性，而是記錄對各屬性的修正值（八屬性：strength / agility / constitution / **reflex** / intellect / willpower / perception / charisma）：
- 基礎武器（等級 0）通常只有一個屬性修正，例如 {"strength": 1}
- 升級武器可有多屬性修正，例如 {"strength": 2, "willpower": -1}
- 反應系武器（P 流影常用）例：{"reflex": 1}
- 廣度路線使用 {"all": 1} 表示所有檢定 +1
- 負面修正不出現在基礎卡（等級 0）上

### 施法類例外
施法類武器的攻擊使用混沌袋而非擲骰。

### 陣營預設戰鬥風格（支柱一 v0.3 §1.1）
| 陣營 | 預設風格 | 主屬性 | 次風格/敘事切角 |
|------|---------|--------|-----------------|
| E 號令 | **sidearm**（v0.3 由 shooting 改為 sidearm） | 魅力 | 隨身武器×團隊指揮（違和即資產：弱攻擊器 + 領袖光環的張力） |
| I 深淵 | **assassin** | 智力 | 暗殺×獨行者（違和即資產：最低調的殺法 + 最孤傲的哲學） |
| S 鐵證 | **shooting**（v0.3 由 sidearm 改為 shooting） | 感知 | 精準射擊×證據堆疊 |
| N 天啟 | arcane | 意志 | 施法×預見 |
| T 解析 | archery | 敏捷 | 弓術×弱點分析 |
| F 聖燼 | brawl | 力量 | 搏擊×替人承傷 |
| J 鐵壁 | military | 體質 | 軍用武器×堅守 |
| P 流影 | engineer | 反應 | 工兵×反應行動 |

### 違和即資產（v0.3 §11）
E 號令×隨身武器、I 深淵×暗殺 這兩組配對的張力是**刻意保留**的設計資產，不是 bug——不要試圖「修正」成更直覺的配對。設計這些陣營的卡片時要把違和感寫進敘事（例：E 陣營的隨身武器卡可強調「領袖不必親自動手，但親自動手時展現真正的份量」）。

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
- **is_permanent：永久卡**（無打出費用 cost=0、必花 EXP 購買 xp_cost>=1 且建議為對應普通卡的 2 倍、買來直接進場、所有 effects 必為 passive 觸發；可同時 is_revelation=true 表示超級副作用永久卡）
- **is_extra：額外卡**（放在額外牌組、遊戲中不可透過抽牌/檢索取得；**僅能透過【反應】或【行動】觸發「從額外牌組打出此卡」，可支付費用**；至少一條 effect.trigger 必為 reaction 或 action，且 desc_zh 必含「從額外牌組打出」；cost/xp_cost 皆可自由設計）
- **互斥規則**：is_permanent 與 is_extra 不可同時為 true

### 裝備欄位
one_hand, two_hand, head, body, accessory, arcane, talent, expertise, none

### 使用後去向
stay, discard, long_rest, short_rest, removed

## 四之二、卡片敘述文法規範 s06 v2（desc_zh 必遵）

每條 effect 的 desc_zh 都必須遵守以下規則——批次寫卡時這是硬性要求，違反會被自動拒收。

### 主詞與代名詞
- 調查員視角一律用「**你**」（不是「調查員」「玩家」「持有者」「使用者」）
- 敵人視角用「**該敵人 / 目標敵人**」（不是「牠」「他」「它」）
- 自指用「**此卡 / 此資產 / 此盟友**」（不是「本卡」「這張卡」）

### 數字與符號
- 數字全用**阿拉伯數字**：3 點傷害、2 張牌（不寫「三點傷害」「兩張牌」）
- 減號用**全形「−」**（不是半形連字號）：負值寫 −1、−2，例「受到 −1 的結果」
- 分數寫 1/2 的血量（斜線）；百分比寫 50%
- 英數與中文之間留半形空格：「造成 3 點 物理傷害」

### 禁用詞對照（Part 2 §5.1 / §3.1）
| 禁用 | 改用 | 理由 |
|------|------|------|
| 若 X（條件句開頭） | **如果 X** | 口語化一致 |
| 若失敗 / 否則 | **如果失敗…** | 同上 |
| 當 X 時 | **在 X 時** | v2 標準觸發句型 |
| 當你... | **在你...時** | 同上 |
| 本回合 | **此回合** | 指代詞一致 |
| 本卡 | **此卡** | 同上 |

### 標準句型（Part 2 §5）
- **觸發句**：「在 [條件] 時，[效果]。」（例：在你打出另一張 E 陣營卡時，抽 1 張牌。）
- **條件句**：「如果 [條件]，[效果]；否則，[備案]。」（避開「若」「當」）
- **費用句**：「花費 [費用]：[效果]。」（冒號用全形，費用單位完整寫）
- **選擇句**：「選擇一項：[A] / [B]。」（用斜線分隔）

### 掃描警告（non-blocking）
前端 「window.scanForbiddenTerms(text)」 會把違規位置掛到 「d._style_warnings」，**不會阻擋儲存**——但批次寫卡的 AI 應主動遵守以減少後續人工修正成本。

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

加值：為卡片設計適合主題的屬性圖示（**八大屬性**各 0-5，含 reflex），價值不計入打出費用。
消費：從以下合法效果中選一：獲得資源、補充彈藥/充能、回復HP、回復SAN、抽牌、獲得正面狀態、移除負面狀態、取消傷害/恐懼。消費不能是移動、攻擊、調查等基本動作。

## 七、狀態效果
核心規則：所有狀態皆可堆疊。狀態在經歷完整一回合後，於該回合結束階段減少 1 層。
分為兩種：數值型（層數=效果強度）、開關型（效果固定，層數=持續回合數）。
add_status 使用 stacks 欄位表示層數：{ "status": "burning", "stacks": 1 }

數值型負面：poison, bleed, burning, frozen, doom_status, madness, marked, vulnerable, weakness_status, wet, weakened
開關型負面：darkness, disarm, fatigue, silence
數值型正面：empowered, armor, ward, haste, regeneration
特殊型正面：stealth（移動或攻擊後全部移除）

## 七之四、軸向系統四層體系（v1.0 §2 核心骨架）

軸向是構築語言——玩家以「這副牌圍繞哪個軸向？」決定牌組主題。每張卡必須能被定位到至少一層軸向（可多層、可正交）。v0.13.0 起每張卡在 DB 強制宣告一個**主軸**（「primary_axis_layer」 + 「primary_axis_value」）。

### 四層軸向（強度由淡到強）
| 層 (primary_axis_layer) | 範圍 | 強度定位 | primary_axis_value 形式 |
|-------------------------|------|---------|-------------------------|
| **faction 陣營極軸**（第 1 層，最淡） | 同陣營卡彼此呼應 | 風味為主，+1 以內數值 | 陣營字母：「E」 / 「I」 / 「S」 / 「N」 / 「T」 / 「F」 / 「J」 / 「P」 |
| **combat_style 戰鬥風格軸**（第 2 層） | 同風格卡呼應 | 中等，+1~+2 | 風格 code：「shooting」 / 「archery」 / 「sidearm」 / 「military」 / 「brawl」 / 「arcane」 / 「engineer」 / 「assassin」 |
| **proficiency 戰鬥專精軸**（第 3 層） | 同專精卡呼應 | 較強，+2~+3 | 專精 code（參考 MOD-05） |
| **card_name 卡名軸**（第 4 層，最強） | 以特定卡名為構築核心 | 強效，可給 +2 以上或強機制 | 完整卡名字串（含書名號『』） |

### 第 5 層：法器類型軸（正交，不排序）
「primary_axis_layer='talisman_type'」，value 為 「wooden_peach / silver / steel / crystal / salt / scroll」 六選一。與前 4 層**正交**——一張卡可同時屬於「E 陣營軸 + 桃木類型軸」（在現行 schema 下主軸只能宣告一個，選構築意圖較強的那個當主軸）。

### 強度與廣度反比的設計合約
**軸向越窄，強度越高**。faction 軸涵蓋同陣營所有卡（廣），所以效果要淡；card_name 軸只指一張特定卡（窄），所以可以強。違反這條合約 = 構築崩潰（例如 faction 軸給 +3 數值會讓 8 張陣營卡全綁在一起，形成壟斷解）。

### 軸向指認句型（5 種，**所有軸向通用**，不僅限法器）
在 effect.desc_zh 中寫以下句型以指認軸向：
1. **觸發型**：在你打出/獲得/消費**另一張** [軸向] 卡時，[效果]。（必須寫「另一張」避免自指）
2. **持續型**：只要你場上有 N 張 [軸向] 卡，[效果]。
3. **強化型**：你打出的 [軸向] 卡 [修改效果]。
4. **條件型**：只有在你有 [軸向] 卡在場上時，才能 [動作]。
5. **搜尋型**：從你的牌庫搜尋 1 張 [軸向] 卡，將其加入你的手牌。

### 卡名軸命名原則（§2.4，card_name 軸專用）
當 「primary_axis_layer='card_name'」 時，primary_axis_value 為一個字串，必須遵守：
1. **含書名號『』**：「『老警長』」 而非 「老警長」
2. **字串完全匹配**：指認時 desc_zh 寫「打出另一張『老警長』卡時」，不能簡稱
3. **名詞短語**：卡名軸值是名詞（角色名 / 物品名 / 事件名），不是動作或狀態
4. **不用英文別名**：value 用中文原名，英文只作 desc_en 對照
5. **有系列感**：好的卡名軸能容納多張系列卡（例：『老警長』資產卡 / 技能卡 / 事件卡三張成系列）
6. **避開過於通用**：「『武器』」 不合格（太泛）、「『老警長』」 合格（具體角色）

### 主軸宣告義務
**每張新卡必填 primary_axis_layer**：
- 沒有明顯軸向歸屬的中立卡 → 「'none'」（primary_axis_value 同時為 null）
- 有陣營歸屬 → 選 「'faction'」（value=陣營字母）或更強的層
- 法器類型明確 → 「'talisman_type'」（value=六種物質之一）
- 系列角色 / 特定主題 → 「'card_name'」（value=『名稱』）

## 七.5、雙軸戰鬥：法器卡與威脅類型軸（草案 v1.0）

本專案引入了「破事軸」（Break Axis）與「殺敵軸」（Kill Axis）的雙軸結構。法器卡對抗「遭遇卡」（威脅類型：mental 精神侵蝕 / physical 物質異變 / ritual 儀式詛咒），武器卡對抗怪物；雙用途卡同時具備兩軸能力。

### 何時將 is_talisman 設為 true
使用者描述若包含以下關鍵字或意圖，**必須**將 is_talisman=true 並完整填入法器欄位：
- 法器、護身符、水晶、符咒、聖物、桃木劍、銀製十字架、符卷、鹽圈、印章、封印、儀式道具
- 破除遭遇卡、對抗精神侵蝕、抵擋詛咒、防禦儀式、預知反應
- 「對抗邪教」「破解儀式」「化解神秘威脅」等破事軸敘事

若使用者描述純粹是武器、純粹事件、純粹盟友且無法器性質，is_talisman=false 並把以下欄位全留 null/空陣列。

### 九宮格（3 類型 × 3 時機 = 9 個設計位置）

|           | mental 精神侵蝕    | physical 物質異變  | ritual 儀式詛咒    |
|-----------|--------------------|--------------------|--------------------|
| instant   | 銀製護身符(S/J)    | 鋼製十字架(S/J)    | 桃木劍(S/J/F)      |
| test      | 警徽(E/F)          | 鐵棍(F/T)          | 解咒儀刀(T/F)      |
| stockpile | 預兆水晶(N/I)      | 鹽圈瓶(I/N)        | 古印之卷(N/P)      |

創作新法器時，先從九宮格選一個座標，再變奏（改陣營氣質、改代價結構、改敘事外衣）。

### 三種破除時機（break_timing）與陣營氣質

- **instant（即時）**：固定費用，無擲骰、無累積。S 鐵證、J 鐵壁、F 聖燼常用。過路費函數：f(S, N) = ⌈S / 2⌉ + N 充能消耗
- **test（檢定）**：固定費用 + 屬性檢定。E 號令（魅力）、T 解析（敏捷）、F 聖燼（力量）常用。過路費函數：f(S, N) = 1 充能 + 檢定 DC = S
- **stockpile（儲蓄）**：無強度上限、無檢定、但累積速度有限。N 天啟、I 深淵、P 流影常用。過路費函數：f(S, N) = S 計量消耗

### 法器物質類型（talisman_type，六選一）
wooden_peach（桃木，驅邪）、silver（銀製）、steel（鋼製）、crystal（水晶）、salt（鹽）、scroll（符卷）。選擇要與敘事咬合。

### 三條設計合約（AI 不可違反）
1. **雙用途卡 V 值上限**：殺敵軸 V + 破事軸 V ≤ 9V（即單軸極致 6V 的 1.5 倍），不得在兩軸都達到極致
2. **軸向強度與廣度反比**：陣營極軸效果要最弱（風味為主）、戰鬥風格軸中等、戰鬥專精軸較強、卡名軸最強
3. **通用解法紅線**：法器不應設計成「僅某陣營可用才能破除」——同一威脅類型的法器必須至少有一張中立或跨陣營版本

### 軸向指認句型（寫在 effect 的 desc_zh 中）
- **觸發型**：在你打出/獲得/消費另一張 [軸向] 卡時，[效果]。（必須寫「另一張」）
- **持續型**：只要你場上有 N 張 [軸向] 卡，[效果]。
- **強化型**：你打出的 [軸向] 卡 [修改效果]。
- **條件型**：只有在你有 [軸向] 卡在場上時，才能 [動作]。
- **搜尋型**：從你的牌庫搜尋 1 張 [軸向] 卡，將其加入你的手牌。

### 充能顯示名稱（break_charge_label）
依敘事自訂：神聖度（銀製/鋼製類）、純度（鋼製）、木質（桃木）、共鳴（警徽）、預兆（水晶）、鹽、封印（符卷）、洞察（禁忌筆記）、信仰（聖物）。

### target_threat_types 規則
- 單一類型為主：["mental"]、["physical"]、["ritual"]
- 雙類型（進階稀有度以上）：["mental", "physical"] 等
- 通用法器（僅傳奇稀有度）：["mental", "physical", "ritual"]

## 八、使用者需求
${userDescription}

## 九、輸出格式
請先計算效果總價值，再設定費用，最後反推稀有度。回傳完全符合以下 JSON 結構的卡片資料，不要回傳任何其他文字：
{
  "name_zh": "", "name_en": "",
  "faction": "E/I/S/N/T/F/J/P/neutral", "style": "AH/AC/OH/OC",
  "type": "asset/event/ally/skill", "slot": "one_hand/none",
  "is_unique": false, "is_signature": false, "is_weakness": false, "is_revelation": false,
  "is_permanent": false, "is_extra": false,
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
  "is_talisman": false,
  "talisman_type": null,
  "target_threat_types": [],
  "break_timing": null,
  "break_strength_max": null,
  "break_charge_label": null,
  "break_charge_max": null,
  "break_test_attribute": null,
  "stockpile_accumulation_rule": null,
  "break_axis_value": null,
  "kill_axis_value": null,
  "leverage_modifier": null,
  "primary_axis_layer": "faction",
  "primary_axis_value": "E",
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
15. **等級 0 的卡片預設不能有消費能力**：level=0 時 consume_enabled 必須為 false、consume_effect 必須為 null。消費能力屬於進階設計元素，應由使用者升級卡片時（level ≥ 1）自行添加，AI 不可自動填入。
16. **法器卡判定**：若使用者描述符合 §七.5 的法器敘事關鍵字，is_talisman=true 並完整填入 12 個法器欄位；否則 is_talisman=false 並把 12 欄位全部設為 null / 空陣列（[] 與 false）。
17. **target_threat_types 必為陣列**：使用 ["mental"] / ["physical"] / ["ritual"] 的陣列格式，即使只有一個類型也要包陣列；雙類型與通用法器對應進階以上稀有度。
18. **break_timing='test' 時 break_test_attribute 必填**：優先使用該陣營主屬性（E=charisma、I=intellect、S=perception、N=willpower、T=agility、F=strength、J=constitution、P=reflex）。
19. **雙用途卡限制**：若同時填 break_axis_value 與 kill_axis_value，兩者相加不得 > 9，且兩者都不得 > 6（單軸極致）；leverage_modifier 限制在 0.5-2.0 範圍。
20. **chargeable 法器必填 break_charge_label**：instant 與 stockpile 時機必須填寫充能顯示名稱（例：神聖度/預兆/木質）；test 時機充能名稱可選但建議填（代表擲骰前的固定費用單位）。
21. **軸向指認句型的強度合約**：在 effect.desc_zh 寫「打出另一張 X 卡時」這類指認時，陣營極軸只給風味或 +1 以內數值；卡名軸（'X' 系列）才能給 +2 以上強效果。
22. **永久卡判定（is_permanent=true）**：使用者描述若含「永久」「買來就在場上」「不用打出」「一直生效的被動」等關鍵字，設 is_permanent=true；cost 必 0、xp_cost 至少為對應普通卡的 2 倍（例普通事件值 3V，永久版本 xp_cost 至少 6）；effects 必全部為 passive trigger；可同時 is_revelation=true 做超級副作用。
23. **額外卡判定（is_extra=true）**：使用者描述若含「額外牌組」「不能主動抽」「由某條件召喚」等關鍵字，設 is_extra=true；**額外卡可支付費用**（cost 不強制 0）；**召喚方式僅兩種：反應或行動**——至少一條 effect.trigger 必為 'reaction' 或 'action'，該條 desc_zh 必遵循 s06 Part 2 §5.1 用「在 X 時」開頭並包含「從額外牌組打出此卡」字樣。範例：
    - 【反應】在你場上有 3 張『老警長』卡時:從額外牌組打出此卡，支付 2 資源。
    - 【行動】花費 1 行動點:在你消耗 1 張主軸卡後,從額外牌組打出此卡。
    與 is_permanent 互斥。
24. **主軸必填（primary_axis_layer）**：每張卡必須宣告主軸層，六選一：「none / faction / combat_style / proficiency / card_name / talisman_type」。
    - layer='none' → primary_axis_value 必為 null
    - layer='faction' → value 為陣營字母（E/I/S/N/T/F/J/P）
    - layer='combat_style' → value 為風格 code（shooting/archery/sidearm/military/brawl/arcane/engineer/assassin）
    - layer='card_name' → value 為『卡名』字串（必含書名號）
    - layer='talisman_type' → value 為 6 種物質之一
    軸向越窄強度越高——faction 軸只給風味/+1 以內，card_name 軸才能給 +2 以上強效果。
25. **敘述文法 s06 v2 硬性要求**：所有 effect.desc_zh 必須：
    - 主詞用「你」（不是「調查員」「玩家」）、自指用「此卡」
    - 數字用阿拉伯數字、減號用全形「−」、英數中文間留半形空格
    - 觸發句用「在 X 時」（不用「當 X 時」）、條件句用「如果 X」（不用「若 X」）
    - 自指避免：寫「打出另一張 X 卡時」（加「另一張」避免觸發自己）
26. **反應屬性（reflex）**：八屬性之一，處理閃避/即時反應/中斷/應激判定。**本專案無先攻值機制**——不要在 desc_zh 寫「先攻 +N」「先攻順序」這類字樣，改寫「你的反應檢定 +N」。P 流影陣營主屬性為 reflex（非敏捷）。
27. **E/S 戰鬥風格互換（v0.3 §1.1）**：E 號令預設 sidearm（不是 shooting）、S 鐵證預設 shooting（不是 sidearm）。若生成 E 陣營卡給 combat_style，優先選 sidearm；S 陣營優先選 shooting。
28. **違和即資產（v0.3 §11）**：E 號令×隨身武器、I 深淵×暗殺 是刻意保留的張力配對——生成這兩組卡時要把違和感寫進 flavor_text，不要「修正」成更直覺的配對。`;
};

/**
 * 精簡版 prompt — 供快速輸入模式使用
 * 前端已 parse 出結構化欄位（faction/style/type/level/cost/slot/axis/talisman 欄位），
 * Gemini 只負責創意層：name_en、effects 陣列、attribute_modifiers、flavor_text、V 值估算。
 */
window.buildMiniCardGeminiPrompt = function(parsed) {
  const p = parsed || {};
  const ud = p.userDescription || '';
  const known = [
    p.name_zh && ('卡名:' + p.name_zh),
    p.faction && ('陣營:' + p.faction),
    p.style && ('風格:' + p.style),
    p.card_type && ('類型:' + p.card_type),
    p.level != null && ('等級:' + p.level),
    p.cost != null && ('費用:' + p.cost),
    p.slot && ('配件欄:' + p.slot),
    p.combat_style && ('戰鬥風格:' + p.combat_style),
    p.primary_axis_layer && p.primary_axis_layer !== 'none' && ('主軸:' + p.primary_axis_layer + '/' + (p.primary_axis_value || '')),
    p.is_talisman && ('法器:true'),
    p.is_permanent && ('永久:true'),
    p.is_extra && ('額外:true'),
    p.talisman_type && ('物質:' + p.talisman_type),
    Array.isArray(p.target_threat_types) && p.target_threat_types.length > 0 && ('威脅類型:' + p.target_threat_types.join(',')),
    p.break_timing && ('破除時機:' + p.break_timing),
    p.break_charge_label && ('充能標籤:' + p.break_charge_label),
    p.break_charge_max != null && ('充能上限:' + p.break_charge_max),
    p.break_test_attribute && ('檢定屬性:' + p.break_test_attribute),
  ].filter(Boolean).join(' | ');

  return `你是克蘇魯神話卡牌遊戲的卡片設計師。下面的結構化欄位已由前端決定，你**不要覆蓋這些值**；你只需要產出創意層的 JSON 欄位。

## 已確定欄位（請照抄回 JSON，勿改）
${known || '（無）'}

## 你要產出的欄位（JSON 形式回傳）
- name_en: 英譯卡名
- attribute_modifiers: 物件，例 {"charisma": 1}（武器卡才需要；其他類型留 {}）
- effects: 陣列，每個元素為 {trigger, condition, cost, target, effect_code, params, duration, desc_zh, desc_en}
- flavor_text: 風味文字（一句話，不含機制用語，符合克蘇魯氛圍）
- break_axis_value: 法器的破事軸 V 值估算（僅 is_talisman=true 時填；範圍 0-6）
- kill_axis_value: 殺敵軸 V 值（純法器為 0；雙用途卡依傷害 × 使用次數估）
- leverage_modifier: 雙用途卡的槓桿修正（單用途為 0；雙用途 0.5-2.0）
- value_calculation: {effects: [{name, value}], total_effect_value, level_discount, cost, required_rarity_discount, calculated_rarity}

## V 值公式（摘要）
- 1V = 1 行動點 = 1 資源 = 抽 1 張牌 = 造成 1 點傷害
- 恐懼傷害 3V/點；恢復 HP/SAN 1.5V/點；抽牌 1V/張；搜尋 6V；移動 1V/格
- 施加正面狀態 3-6V/層；快速 +1V；可指定他人 +2V
- **等級抵扣**（支柱五 v0.2）：LV0=0, LV1=-0.5V, LV2=-1V, LV3=-2V, LV4=-3V, LV5=-4V
- **所有卡型 1:1**（含資產卡；原 2:1 已廢）：稀有度抵扣 = 總效果 V - 等級抵扣 - 費用
- 稀有度：≤0 隨身 / 0.1~1 基礎 / 1.1~2 標準 / 2.1~3 進階 / 3.1~4 稀有 / 4.1~5 傳奇
- 雙用途卡合約：破事 V + 殺敵 V ≤ 9，單軸不得 > 6

## 八屬性（v0.2）與陣營主屬性
八屬性：strength / agility / constitution / **reflex 反應** / intellect / willpower / perception / charisma
主屬性對應：E 魅力 / I 智力 / S 感知 / N 意志 / T 敏捷 / F 力量 / J 體質 / **P 反應**（非敏捷）
**無先攻值機制**——不要寫「先攻 +N」，改寫「反應檢定 +N」。

## 八陣營氣質與預設戰鬥風格（v0.3 §1.1）
| 陣營 | 主屬性 | 預設風格 | 一句話 |
|------|--------|---------|--------|
| E 號令 | 魅力 | **sidearm**（v0.3 改）| 團隊增益×領袖光環（違和即資產：弱攻擊器+指揮） |
| I 深淵 | 智力 | assassin | 牌庫操控×獨處強化（違和即資產：暗殺×哲學） |
| S 鐵證 | 感知 | **shooting**（v0.3 改）| 精準射擊×證據堆疊 |
| N 天啟 | 意志 | arcane | 混沌袋×預知 |
| T 解析 | 敏捷 | archery | 弱點揭露×弓術 |
| F 聖燼 | 力量 | brawl | 治療×以身擋傷 |
| J 鐵壁 | 體質 | military | 傷害減免×軍用武器 |
| P 流影 | **反應** | engineer | 反應行動×棄牌堆回收 |

## 軸向系統 4 層（v1.0，強度由淡到強）
faction（陣營）→ combat_style（風格）→ proficiency（專精）→ card_name（卡名，最強）
第 5 層正交：talisman_type（法器物質）
**強度廣度反比**：faction 軸只給 +1 以內，card_name 軸才能給 +2 以上強效果。
**軸向指認 5 句型**（所有軸向通用）：觸發「在你打出**另一張** X 時」/ 持續「只要場上有 N 張 X」/ 強化「你打出的 X [修改]」/ 條件「只有在有 X 時才能…」/ 搜尋「從牌庫搜尋 1 張 X」。
**卡名軸命名**：value 必含書名號（例 「『老警長』」），字串完全匹配，避開過於通用的名詞。

## 雙軸戰鬥 / 法器（is_talisman=true 時適用）
威脅類型（target_threat_types）：mental 精神 / physical 物質 / ritual 儀式（陣列，允許多值）
破除時機（break_timing）：
- instant 即時：過路費 f(S,N) = ⌈S/2⌉ + N 充能消耗
- test 檢定：f(S,N) = 1 充能 + 屬性檢定 DC=S（break_test_attribute 必填）
- stockpile 儲蓄：f(S,N) = S 計量消耗
物質類型（talisman_type）：wooden_peach/silver/steel/crystal/salt/scroll

## 效果動詞（effect_code，必從以下選）
deal_damage, deal_horror, heal_hp, heal_san, draw_card, search_deck, retrieve_card, return_to_deck, discard_card, gain_resource, spend_resource, move_investigator, swap_position, engage_enemy, disengage_enemy, exhaust_card, ready_card, stun_enemy, add_status, remove_status, make_test, modify_test, reroll, auto_success, attack, evade, taunt, counterattack, place_clue, discover_clue, place_doom, remove_doom, spawn_enemy, remove_enemy, look_chaos_bag, manipulate_chaos_bag, fast_play, target_other, add_bless, add_curse, remove_bless, remove_curse

## 觸發時機（trigger，必從以下選）
on_play, on_commit, on_consume, on_enter, on_leave, on_draw, on_success, on_fail, on_take_damage, on_take_horror, before_take_damage, before_take_horror, before_downed, round_start, round_end, action, reaction, passive, free_action

## 軸向指認句型（寫入 effect.desc_zh 時使用）
- 觸發型：在你打出/獲得/消費另一張 [軸向] 卡時，[效果]
- 持續型：只要你場上有 N 張 [軸向] 卡，[效果]
- 強化型：你打出的 [軸向] 卡 [修改效果]
- 強度與廣度反比：faction 軸要淡、card_name 軸可強

## 敘事輸入
${ud || '（使用者未提供額外敘事，請依結構化欄位合理推斷）'}

## 輸出格式
只回傳 JSON，不加 markdown 圍欄、不加任何解釋。範本（請保留所有欄位、值照實際填）：
{
  "name_en": "...",
  "attribute_modifiers": {},
  "effects": [
    {"trigger": "passive", "condition": null, "cost": null, "target": "self", "effect_code": "...", "params": {}, "duration": "permanent", "desc_zh": "...", "desc_en": "..."}
  ],
  "flavor_text": "...",
  "break_axis_value": 0,
  "kill_axis_value": 0,
  "leverage_modifier": 0,
  "value_calculation": {"effects": [], "total_effect_value": 0, "level_discount": 0, "cost": 0, "required_rarity_discount": 0, "calculated_rarity": "..."}
}

## 重要提醒
1. **不要覆蓋已確定欄位**：上方「已確定欄位」的值前端會覆蓋你的輸出，但請你照抄過去避免 JSON 不完整。
2. **effect.desc_zh 必遵循 s06 v2 規範**：主詞「你」（不用「調查員」）、自指「此卡」（不用「本卡」）、數字阿拉伯、減號全形「−」、英數中文間留半形空格、觸發句用「在 X 時」（不用「當 X 時」）、條件句用「如果 X」（不用「若 X」）、指認他卡寫「**另一張** X 卡」避免自觸發。
3. **軸向指認**：若主軸為 card_name，請在 effects 中至少一條觸發型 desc_zh 明確寫「打出另一張『${p.primary_axis_value || 'X'}』卡時」。
4. **法器 desc_zh**：instant 型「花費 X 充能:對應強度 X 的 [類型] 類遭遇卡，立即破除」；test 型「花費 1 充能：對應一張 [類型] 類遭遇卡，進行 [屬性] 檢定 (DC 為其強度)」；stockpile 型「花費 X 計量：...」。
5. **attribute_modifiers 僅武器卡填**；純法器/事件/盟友/技能留 {}。
6. **永久卡（is_permanent=true）**：所有 effects.trigger 必為 "passive"；cost=0（由前端鎖定）；建議 xp_cost 為普通版本的 2 倍（前端會帶已確認值）；可與 is_revelation 疊加成超級副作用永久卡。
7. **額外卡（is_extra=true）**：**僅兩種召喚方式 — reaction 或 action**。至少一條 effect.trigger 必為 'reaction' 或 'action'，對應 desc_zh 用 s06 Part 2 §5.1 的「在 X 時」句型，並含「從額外牌組打出此卡」字樣；可支付費用。範例：「【反應】在你場上有 3 張『老警長』卡時:從額外牌組打出此卡，支付 2 資源。」或「【行動】花費 1 行動點:在你消耗 1 張主軸卡後,從額外牌組打出此卡。」`;
};
