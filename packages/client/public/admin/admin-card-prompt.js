/* ========================================
   MOD-01 卡片設計器 — Gemini Prompt 共用模組
   ========================================
   雙環境 UMD：browser 端透過 <script> 載入暴露到 window；
   Node 端透過 createRequire / require 拿到 module.exports。

   三路徑共用單一來源（避免規範漂移）：
     - MOD-01 自由輸入（admin-card-designer.html → buildCardGeminiPrompt）
     - MOD-01 快速輸入（admin-card-designer.html → buildMiniCardGeminiPrompt）
     - MOD-12 批次寫卡（geminiDirectClient.js → buildCardDesignPrompt → buildCardGeminiPrompt）
     - G1 全自動腳本（scripts/g1-sandbox/lib/prompt-loader.mjs，Node 端載入）
*/
var __cardPromptGlobal = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
__cardPromptGlobal.buildCardGeminiPrompt = function(userDescription, options) {
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
- 事件卡(1:1)：稀有度抵扣 = 效果總價值 - 起始投入抵扣 - 費用 - Exceptional 抵扣
- 資產卡(1:1)：稀有度抵扣 = 總輸出價值 - 1V(留場) - 起始投入抵扣 - 費用 - Exceptional 抵扣
- 盟友卡(1:1)：稀有度抵扣 = HP×0.5V + SAN×0.5V + 2V + 能力價值 - 起始投入抵扣 - 費用 - Exceptional 抵扣
- 技能卡：費用=0，不計稀有度，檢驗價值區間(★0:2.5-3V, ★2:5-6V, ★3:7-8V, ★5:9-10V)

### 抵扣值對照表（向上進位）
≤0：隨身, 0.1~1：基礎, 1.1~2：標準, 2.1~3：進階, 3.1~4：稀有, 4.1~5：傳奇, >5：超出範圍

### 起始投入抵扣(取代舊版等級抵扣,卡片升級系統重構 v1):starting_xp 點數 × 1V 線性
### ★0=0, ★1=-1V, ★2=-2V, ★3=-3V, ★4=-4V, ★5=-5V
### Exceptional(卓越)標記:額外 -2V(沿用 v1.1)+ 玩家購買 XP ×2 倍率
### 5 點配額硬上限:設計師起始投入 + 玩家後續投入 ≤ 5
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

### 八種戰鬥風格（依本專案 s07 §2.4 定義，武器歸類必須遵守）

| 風格 code | 中文 | **涵蓋武器**（AI 判斷卡片歸類的依據） | **明確不屬於此風格** |
|---|---|---|---|
| **shooting** | 槍枝射擊 | **所有槍械**：手槍 / 左輪 / 步槍 / 衝鋒槍 / 霰彈槍（含截短霰彈槍） / 卡賓槍 / 狙擊槍 | 弓箭、投擲武器 |
| **archery** | 弓術 | 長弓 / 短弓 / 十字弓 / 複合弓 / 弩；投擲武器（飛刀/標槍/擲斧）也算 | 槍械 |
| **sidearm** | 隨身武器 | **冷兵器/鈍器**：警棍 / 短刀 / 匕首 / 摺疊刀 / 指虎 / 拐杖 / 棒球棒 / 短劍 / 護身短刃;四個專精 sidearm_dagger / sidearm_parry / sidearm_blunt / sidearm_street | **絕對不含任何槍械**(手槍也不行——本專案 sidearm ≠ 英文 side-arm 副手槍) |
| **military** | 軍用武器 | 機槍 / 火焰噴射器 / 重型自動武器 / 榴彈發射器 / 反坦克武器 / 手榴彈；需要軍事訓練/重裝備才能使用 | 民用槍械 |
| **brawl** | 搏擊 | 徒手 / 拳套 / 格鬥術 / 摔技；身體本身即武器 | 任何持握武器 |
| **arcane** | 施法 | 法杖 / 魔典 / 符卷 / 儀式工具；spell_type 必填,combat_style 與 slot 皆固定為 arcane | 物理武器 |
| **engineer** | 工兵 | 陷阱 / 地雷 / 手工改造武器 / 即興爆破;依賴器械和環境互動 | 制式武器 |
| **assassin** | 暗殺 | 毒針 / 絞索 / 暗器 / 消音武器 / 投擲飛刀;依賴偷襲與一擊必殺 | 正面交鋒武器 |

**關鍵判斷原則**：
1. **任何能發射子彈的武器 = shooting**(左輪、霰彈槍、手槍全都是 shooting,不是 sidearm)
2. **sidearm 只給冷兵器/鈍器**(警棍、匕首、指虎、拐杖、棒球棒等);若使用者描述含「手槍/左輪/霰彈」等字樣,**禁止**寫成 sidearm
3. **陣營預設風格 ≠ 強制該陣營只能有該風格武器**:每張卡的 combat_style 由**武器本體**決定,不由陣營決定。E 陣營的卡可以配 shooting(例如『酒館老闆』抽出的截短霰彈槍),但那張卡的 faction 就要改成 S(或讓該卡 combat_style=sidearm 改成警棍類武器)
4. 生成後自我檢查:**武器卡的 combat_style 是否符合武器本體的物理性質**?若不符必須修正。

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
on_play, on_commit, on_consume, on_enter, on_leave, on_draw, on_success, on_fail, on_critical, on_fumble, on_take_damage, on_take_horror, before_take_damage, before_take_horror, before_downed, on_engage, on_disengage, on_move, on_enter_location, on_enemy_spawn, on_enemy_defeat, on_ally_downed, round_start, round_end, on_enemy_phase, action, reaction, passive, free_action

**自然語言 → trigger 對應表(避免錯填 trigger)**：
- 「打出時 / 出牌時」→ on_play
- 「進場時」→ on_enter
- **「離場時 / 離去時 / 移除時 / 從場上移除時」→ on_leave**(常被誤填為 on_play)
- 「被抽到時」→ on_draw
- 「檢定成功時」→ on_success / 「檢定失敗時」→ on_fail
- 「將要承受恐懼時」→ before_take_horror / 「承受恐懼時」→ on_take_horror
- 「將要承受傷害時」→ before_take_damage / 「承受傷害時」→ on_take_damage
- 「回合開始」→ round_start / 「回合結束」→ round_end
- 「只要 X 在場 / 持續在場 / 永久 / 被動」→ passive(不是 on_play)

### 5.2 條件限制 (condition) — 可為 null
while_engaged, while_not_engaged, ally_engaged, hp_below_half, hp_below_x, san_below_half, san_below_x, in_darkness, in_light, in_fire, daytime, nighttime, hand_empty, hand_full, deck_empty, has_weapon, has_ally, has_item, has_arcane_item, has_weakness, at_location_with_clue, at_location_with_enemy, alone_at_location

### 5.3 費用類型 (cost)
resource, forbidden_insight, faith, elder_sign, hp, san, discard_hand, discard_specific, exhaust_self, exhaust_other, ammo, uses, clue, action_point, doom
範例：{ "ammo": 1, "exhaust_self": true }

### 5.4 目標指定 (target)
self, ally_one, ally_all, investigator_any, investigator_all, enemy_one, enemy_all_location, enemy_engaged, enemy_non_elite, enemy_normal, enemy_elite, ally_card, asset_card, location

### 5.5 效果動詞 (effect_code)
deal_damage, deal_horror, heal_hp, heal_san, restore_hp_max, restore_san_max, transfer_damage, transfer_horror, draw_card, reveal_top, search_deck, retrieve_card, return_to_deck, discard_card, shuffle_deck, remove_from_game, gain_resource, spend_resource, steal_resource, transfer_resource, move_investigator, move_enemy, swap_position, place_enemy, jump, engage_enemy, disengage_enemy, exhaust_card, ready_card, stun_enemy, add_status, remove_status, make_test, modify_test, wild_attr_boost, reroll, auto_success, auto_fail, attack, evade, taunt, counterattack, extra_attack, place_clue, discover_clue, place_doom, remove_doom, seal_gate, spawn_enemy, remove_enemy, execute_enemy, reveal_tile, place_tile, remove_tile, place_haunting, remove_haunting, advance_act, advance_agenda, connect_tiles, disconnect_tiles, create_light, extinguish_light, create_darkness, remove_darkness, create_fire, extinguish_fire, add_keyword, remove_keyword, add_bless, add_curse, remove_bless, remove_curse, look_chaos_bag, manipulate_chaos_bag

**modify_test vs wild_attr_boost 區分(重要)**:modify_test 用於「指定屬性檢定 +N」(如「智力檢定 +2」),params.modifier 數值 + 可選 params.attribute 限定屬性;wild_attr_boost 用於「所有屬性檢定 +N / 全技能檢定 +N」(如 Key of Ys 的「+1 to each of your skills」),params.amount 1-5。永久 wild_attr_boost 套 §4.4b 持續性權重 ×8,V 值極高,慎用。

**🔴 成長型 effect 的 amount 必填「最終可達狀態」(s04 §4.4b 約定,極重要)**

當效果是「每 X 獲得 Y / 每點 X 加 Y / 隨 X 累積成長」這類 scaling 描述時,**params.amount 不是寫敘述裡的單位增量(1),而是寫卡片可達到的最終最強狀態**。引擎會用最終狀態 × 持續性權重算 V 值(§4.4b)。

判斷上限的依據(依優先序):
1. 卡片 SAN(神智值):「卡上每 1 點恐懼...」→ amount = SAN-1(因第 N 個 horror 達到 SAN 即觸發離場;SAN 4 → amount=3)
2. 卡片 HP:「此卡每受 1 點傷害...」→ amount = HP-1
3. 卡片內顯式上限:「(此卡最多 N 點 X)」→ amount = N
4. 若無上限敘述但有「每 1 X」scaling,預設 amount = 3(保守估計常見遊戲狀態)

**範例 — Key of Ys**:
- 卡面:「只要此卡上每有 1 點恐懼,你的所有檢定獲得 +1」+「(此卡最多承受 4 點恐懼)」+ SAN 4
- 第 4 個 horror 進來就觸發離場 → 最大可達 3 horror
- effects[]:「effect_code: wild_attr_boost / params: { amount: 3 } / duration: while_in_play / trigger: passive / desc_zh: 只要此卡上每有 1 點恐懼,你的所有檢定獲得 +1」
- 同步:「將其中 1 點恐懼放置在此卡上」 transfer_horror 的 amount 也填總可發生次數 3(不是 1)

**反例(常見錯誤)**:
- ❌ amount=1(誤把單位增量當最終值,結果 V 值嚴重低估)
- ❌ duration=instant(成長型必為 while_in_play 或 permanent)

**transfer_damage / transfer_horror 也同**:amount = 卡片可吸收的總點數(對 Key of Ys 是 3,因 SAN 4 上限),不是敘述的單次 1 點。

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

### 軸內 COMBO 設計範例庫（**重要**,批次寫卡必須產出有趣互動,不能只做 +1/+2 數值加值)

**鐵律**：軸內互動必須至少用以下 6 種 pattern 其中一種,**禁止**只寫「另一張 X 卡時,+1 攻擊/檢定」這類機械加值。

#### Pattern A｜資源回收(從棄牌堆/移除區撈同軸卡)
範例:「【消費】棄置 1 張手牌：從棄牌堆取回 1 張『老警長』系列卡到手牌。」
— 讓同軸卡形成循環,玩起來像「角色的工具用過還能再用」

#### Pattern B｜質變閾值(場上 N 張同軸卡解鎖新能力)
範例:「【被動】只要你場上有 3 張或以上『酒館老闆』系列卡,你免疫「混亂」狀態,且消費能力檢定獲得 +2 加值。」
— 獎勵「鋪好角色扮演場景」的玩家,質變而非線性加值

#### Pattern C｜連鎖反應(打 A 抽 B,B 回手下回合再打)
範例:「【觸發】在你打出另一張『熱心記者』系列卡時,翻開牌庫頂 3 張,將其中一張『熱心記者』系列卡加入手牌,其餘洗回牌庫。」
— 自我增強的檢索,讓卡組形成引擎

#### Pattern D｜跨時機配合(反應時機打出 → 下回合開始觸發)
範例:「【反應】在敵人攻擊你時:從額外牌組打出此卡。在下一個回合開始階段,若此卡仍在場,對該敵人進行 1 次『老警長』主屬性的反擊判定。」
— 延遲爆發,創造「設局」的感覺

#### Pattern E｜成本轉移(這張卡可用同軸卡當燃料降費)
範例:「【打出】此卡打出時,你可棄置 1 張『酒館老闆』系列卡,若如此:此卡費用 -2 且獲得快速。」
— 讓玩家做「現在花掉哪張卡最划算」的抉擇

#### Pattern F｜鏡像效果(同軸 A 卡啟用時,B 卡反過來觸發)
範例:「【被動】在另一張『熱心記者』系列卡被消費時:你立即進行一次感知檢定,成功則抽 1 張牌並放置 1 個線索在你所在地點。」
— 消費行為產生額外價值,互動豐富

### COMBO 設計檢查清單(生成後自問)
- [ ] 這張卡有沒有用到上述 6 種 pattern 之一? 沒有就重寫
- [ ] 這張卡的互動效果**是否依賴與其他卡的關係**? 只有單卡數值就太無趣
- [ ] 我是在寫「加 1」還是在寫「玩家的選擇」? 選擇比數字有趣
- [ ] 這張卡跟同軸其他卡**合起來能否說出一個故事**?(例:老警長掏槍→開火→動員線人→拷問→結案)

### 卡名軸的核心哲學（**最重要**,違反會造成設計崩潰)
**卡名軸是「玩家扮演的 RPG 角色原型」代號,不是「一張實體核心卡的名字」。**

錯誤理解(AI 最常犯)：先做一張叫『老警長』的盟友卡,讓其他卡「依附於這張盟友卡」(如「此武器在『老警長』在場時 +1 傷害」)。這是把軸當「主僕結構」,**本專案禁止**。

正確理解：primary_axis_value='老警長' 意味著「這張卡設計給**扮演老警長這個角色原型**的玩家使用」。玩家本人就是老警長,卡組內容是他的裝備(左輪、徽章)、技能(直覺、命令)、盟友(副警長)、事件(動員令)。**整個軸向內不該有一張卡的 name_zh 等於 primary_axis_value**——玩家不會「擁有老警長這張卡」,玩家「就是老警長」。

### 軸值命名原則
1. **primary_axis_value 必為純名,不加書名號『』**:DB 存 「老警長」而非「『老警長』」。書名號只在 effect.desc_zh 內文指認其他同軸卡時才用(例:「在你打出另一張『老警長』系列卡時」)
2. **必為角色原型/主題代號**(名詞短語):老警長、酒館老闆、熱心記者、大學教授——都是玩家扮演的角色類型
3. **禁止將角色本人做成實體卡**:不要生成 name_zh='老警長' 的盟友卡
4. **有系列感要求**:好的卡名軸必須能容納 5+ 張不同類型卡(資產/技能/事件/盟友)成完整 RPG 配置
5. **避開過於通用**:「武器」「刑警」太泛,用具體角色名如「老警長」

### 單卡禁掛 card_name 軸(硬規則)
- 若此卡為單張孤立卡、DB 無其他同值卡呼應、也不預計成系列 → **禁止** primary_axis_layer='card_name'
- 單卡正確主軸：'faction'(有陣營歸屬)或 'none'(中立)
- 批次模式下,若使用者要求「為 X 軸寫 N 張卡」,N 必須 ≥ 3 才能用 card_name 軸;否則降級為 faction 軸

### 主軸宣告義務
**每張新卡必填 primary_axis_layer**：
- 沒有明顯軸向歸屬的中立卡 → 「'none'」（primary_axis_value 同時為 null）
- 有陣營歸屬 → 選 「'faction'」（value=陣營字母）或更強的層
- 法器類型明確 → 「'talisman_type'」（value=六種物質之一）
- 系列角色 / 特定主題 → 「'card_name'」（value=『名稱』）

## 七之四之二、軸向設計工作流程（**設計師動工前必讀**）

設計一個陣營的完整起始牌組或卡池時,**禁止**直接從「來幾張武器」「來幾張技能」開始發想。必須走以下四步流程,確保軸向真的承載陣營氣質,而不是把通用機制隨便冠上陣營字母。

### 流程四步

**Step 1：從陣營特色與核心策略出發**

讀規則書 s07_faction_narrative.md 對應陣營章節,抽出三件事:
- 一句話定義(這個陣營「是誰」)
- 核心策略(機制上的「資源放大器/孤獨壓制流/裝備堆疊/混沌操控/弱點解析/犧牲信念/堅守傷免/反應回收」哪一種)
- 機制關鍵字(5 條左右)

**Step 2：列陣營角色原型範例**

從 s07 的「角色原型範例」清單拉 5-8 個原型(例:E 號令的酒館老闆、熱心記者、老刑警、退休外交官、戰時情報員...)。這是 card_name 軸的候選池。

**Step 3：原型 × COMBO Pattern → 軸向差異化**

從 6 種 COMBO Pattern(A 資源回收 / B 質變閾值 / C 連鎖反應 / D 跨時機配合 / E 成本轉移 / F 鏡像效果)中,**為每個原型挑一個不同的 Pattern**,讓不同 card_name 軸有不同玩感。同陣營的兩個 card_name 軸如果都用 Pattern B,玩起來會雷同——必須區分。

**Step 4：為每個軸規劃起始牌組大致樣貌**

每個 card_name 軸的起始牌組應涵蓋:
- 1-2 張地點/資產關鍵卡(角色的「世界」)
- 1-2 張盟友(角色的「人脈」)
- 2-3 張技能(角色的「能力」,加值對應主屬性的檢定)
- 2-3 張事件(角色的「行動」)
- 1 張隨身武器(對應陣營預設 combat_style)
- (可選) 1 張法器(對應陣營氣質的 talisman_type)

加上一個橫向**武器軸**(proficiency 層,例:sidearm_blunt / shooting_precision / archery_explosive),作為跨原型通用零件池。任何 card_name 軸玩家都可放幾張武器軸卡當配件。

### 完整範例:E 陣營五軸規劃(範本)

依以上流程跑出 E 陣營(號令)的設計成果,**未來其他陣營批次寫卡時應以此為對照樣板**。

#### Step 1 抽出
- 一句話:你不是最強的人,但你是身邊每個人都願意為你賣命的人
- 核心策略:**資源放大器**(透過給隊友額外行動、共享資源、領導光環,把整支隊伍的行動經濟乘上係數)
- 機制關鍵字:給予隊友額外行動 / 共享資源 / NPC 互動加成 / 領導光環 / 隨身武器威懾
- 主屬性:魅力 / 預設戰鬥風格:sidearm

#### Step 2 角色原型(從 s07 §2.8 拉)
酒館老闆、熱心記者、老刑警、退休外交官、戰時情報員、能說服任何人的記者、酒吧裡有 20 個線人的老刑警、三代經營酒館的老闆、退休外交官現任邪教調查聯絡人、戰時情報員戰後成為知名作家。

#### Step 3 + Step 4:四個 card_name 軸 + 一個 proficiency 武器軸

##### 軸 1 — card_name='酒館老闆'(Pattern B 質變閾值)
- 玩感:慢慢鋪設場景、中後期爆發。場上湊到 3 張以上同軸卡 → 解鎖「酒吧開場」狀態,所有 E 陣營卡費用 -1,該地點隊友恐懼檢定 +2
- 起始牌組大樣:酒吧吧台(地點)/ 酒保夥計(盟友)/ 欠帳本(技能)/ 留客話術(技能,魅力 +2)/ 存酒老瓶(資產)/ 緊急開瓶(事件,叫線人)/ 老闆的手杖(sidearm 武器)

##### 軸 2 — card_name='熱心記者'(Pattern C 連鎖反應)
- 玩感:抽牌引擎驅動。每揭露一條線索 → 翻牌頂 N 張 → 看見「熱心記者」軸卡就拿到手。滾雪球的調查機器
- 起始牌組大樣:採訪筆記本(資產,常駐)/ 老編輯(盟友)/ 跑線直覺(技能,感知 + reroll)/ 追蹤報導(技能)/ 揭露真相(事件,翻牌頂 5)/ 緊急截稿(事件,棄牌換抽)/ 老式相機(資產,discover_clue)/ 鋼筆(sidearm 武器)

##### 軸 3 — card_name='老刑警'(Pattern D 跨時機配合)
- 玩感:反應導向。在敵人攻擊時、隊友被撲倒時、邪教徒念完咒文時——老刑警的牌都是「在 X 時」觸發,設局比進攻多
- 起始牌組大樣:老警長警徽(法器,silver,反精神威脅)/ 退休警員夥伴(盟友,反應型)/ 刑警直覺(技能,失敗後 reroll)/ 線人通報(事件,看牌頂 3)/ 突襲逮捕(反應)/ 警棍(sidearm_blunt 武器)/ 夜班配槍(資產,違和即資產的 E×手槍)/ 老搭檔(盟友)

##### 軸 4 — card_name='退休外交官'(Pattern E 成本轉移 + 跟 talisman_type='scroll' 綁定)
- 玩感:契約型法器路線。用文書條約破解儀式詛咒。可棄置其他陣營卡當燃料降費,模擬「跨派系借力」
- 起始牌組大樣:外交委任狀(scroll 法器,stockpile,充能標籤「信約」)/ 領事館聯繫人(盟友)/ 外交辭令(技能,魅力 +2 + reroll)/ 文化破譯(事件)/ 舊家書(資產,儲蓄信約)/ 跨派系借力(事件,棄置任意陣營卡 → 該陣營本回合費用 -2)/ 禮儀短刃(sidearm_dagger 武器)

##### 軸 5 — proficiency='sidearm_blunt'(橫向武器軸)
- 玩感:威懾型武器路線。傷害不爆,但每次擊中附加 weakened/marked,讓被打中的敵人下回合動作受限。配合 E 隊友被動 = 你打一棒+隊友動作多+敵人動作少,三段加乘
- 不掛 card_name,任何 card_name 軸玩家都可放幾張當武器配件:警棍 / 加重棒身 / 制服姿勢 / 職業的勳章 / 棒球棒 / 拐杖 / 最後一擊

### 五軸關係結構(這就是「陣營構築健康度」的判斷標準)

- 4 個 card_name 軸 = **縱向專屬構築**(每個玩家挑一個當人設)
- 1 個 proficiency 武器軸 = **橫向通用零件**(任何角色都能放)
- 4 個 card_name 用 4 種不同 COMBO Pattern → 玩感真的差異化
- 剩下 2 種 Pattern(A 資源回收、F 鏡像效果)留給未來新增角色軸

**完整起始牌組 = 6-8 張 card_name 主軸卡 + 2-3 張 proficiency 武器軸卡 + 少量 faction='E' 通用基底卡 = 18 張**

### 設計健康度檢查

寫陣營批次時,自問以下:
- [ ] 每個 card_name 軸有沒有對應一個獨特 COMBO Pattern? 多個軸用同 Pattern → 玩感重疊,要重設計
- [ ] 每個軸的角色原型是「玩家扮演的人」,不是「實體核心卡」? name_zh 不能等於 primary_axis_value
- [ ] 起始牌組涵蓋地點/盟友/技能/事件/武器五類? 全是技能或全是武器 → 構築不平衡
- [ ] 武器軸是否「橫向通用」可被多個 card_name 軸共用? 武器軸綁死單一原型 → 過度收斂
- [ ] 該陣營的核心策略(資源放大器/孤獨壓制等)有沒有被起始牌組機制具體實現? 看不出陣營氣質 → 退回 Step 1

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
15. **★0 (起始投入 0 點) 的卡片預設不能有消費能力**：starting_xp=0 時 consume_enabled 必須為 false、consume_effect 必須為 null。消費能力屬於進階設計元素,應由玩家後續投入強化(starting_xp ≥ 1)後再添加,AI 不可自動填入。
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
    - layer='card_name' → value 為**純字串**(不加書名號『』,例寫 「老警長」不寫 「『老警長』」);**且必須同時滿足**:(a)此卡設計為 RPG 角色原型的一員、(b)同批次或 DB 已有 ≥2 張同 value 的其他卡呼應、(c)此卡的 name_zh 不等於 primary_axis_value 本身
    - layer='talisman_type' → value 為 6 種物質之一
    軸向越窄強度越高——faction 軸只給風味/+1 以內，card_name 軸才能給 +2 以上強效果。
25. **敘述文法 s06 v2 硬性要求**：所有 effect.desc_zh 必須：
    - 主詞用「你」（不是「調查員」「玩家」）、自指用「此卡」
    - 數字用阿拉伯數字、減號用全形「−」、英數中文間留半形空格
    - 觸發句用「在 X 時」（不用「當 X 時」）、條件句用「如果 X」（不用「若 X」）
    - 自指避免：寫「打出另一張 X 卡時」（加「另一張」避免觸發自己）
26. **反應屬性（reflex）**：八屬性之一，處理閃避/即時反應/中斷/應激判定。**本專案無先攻值機制**——不要在 desc_zh 寫「先攻 +N」「先攻順序」這類字樣，改寫「你的反應檢定 +N」。P 流影陣營主屬性為 reflex（非敏捷）。
27. **E/S 戰鬥風格互換（v0.3 §1.1）**：E 號令預設 sidearm（不是 shooting）、S 鐵證預設 shooting（不是 sidearm）。若生成 E 陣營卡給 combat_style，優先選 sidearm；S 陣營優先選 shooting。
28. **違和即資產（v0.3 §11）**：E 號令×隨身武器、I 深淵×暗殺 是刻意保留的張力配對——生成這兩組卡時要把違和感寫進 flavor_text，不要「修正」成更直覺的配對。
29. **武器風格必須符合武器本體物理性質**(s07 §2.4):
    - 所有槍械(左輪/手槍/霰彈/步槍/衝鋒槍)→ combat_style='shooting',faction 應為 S 鐵證
    - 所有冷兵器/鈍器(警棍/匕首/指虎/棒球棒/拐杖)→ combat_style='sidearm',faction 可為 E 號令
    - **禁止**給 E 陣營卡配 combat_style='shooting'(除非設計意圖明確為違和即資產張力,且 flavor_text 論證)
    - **禁止**將手槍/左輪寫成 combat_style='sidearm'(英文 side-arm≠本專案 sidearm,本專案 sidearm 不含任何槍械)
30. **卡名軸硬規則(單卡禁掛)**：
    - 生成前自問:DB 或同批次是否有 ≥ 2 張其他卡會與這張共享同一 primary_axis_value? 若答否,layer 必須降為 'faction' 或 'none'
    - 批次生成時,若使用者要求「為 X 角色寫 N 張」,N < 3 時改用 faction 軸
    - primary_axis_value **禁止**包含書名號『』「」 或任何引號(純字串,DB 端比對)
    - **name_zh 也禁止包含書名號**:卡名以純文字儲存(例「老警長的徽章」不寫「『老警長的徽章』」);書名號**只在 effect.desc_zh 內文指認其他同軸卡時使用**(例:「在你打出另一張『老警長』系列卡時」)
    - 禁止生成「name_zh = primary_axis_value」的核心實體卡(例不要做一張叫 『老警長』 的盟友卡)
31. **軸內 COMBO 必須有趣(禁機械加值)**:生成同軸系列卡時,至少一張卡要使用 §七之四 的 COMBO Pattern A~F 其中一種(資源回收/質變閾值/連鎖反應/跨時機配合/成本轉移/鏡像效果)。**禁止**整批 6 張全是「另一張 X 卡時 +1 檢定/+1 傷害」這類機械線性加值。COMBO 的設計本質是**創造玩家抉擇**,不是堆數字。
32. **🚨 嚴禁發明關鍵字、狀態、術語**：
    - **合法「關鍵字」僅 2 個**：「fast_play」(快速／不使用行動點)、「target_other」(可指定其他調查員)
    - **合法「狀態」清單**：poison, bleed, burning, frozen, doom_status, madness, marked, vulnerable, weakness_status, wet, weakened（數值型負面）／ darkness, disarm, fatigue, silence（開關型負面）／ empowered, armor, ward, haste, regeneration（數值型正面）／ stealth（特殊正面）
    - **絕對禁止**在 desc_zh 寫「獲得『反擊』關鍵字」「施加『眩暈』狀態」「賦予『命中』標記」這類**發明的術語**。所有術語必須從上方清單選,**不能音譯、不能意譯、不能混用中文代稱**
    - \「counterattack\」、\「taunt\」、\「extra_attack\」 這些是 **effect_code(動詞,要寫進 effects 陣列)**,不是關鍵字。如果要做「敵人打你時反擊」,寫一條 effect:trigger=on_take_damage、effect_code=counterattack、params={amount:N},而不是寫「獲得反擊關鍵字」
    - 若需要的概念不在清單內,用敘述性描述代替(例「此武器被攻擊時自動反擊 1 點傷害」),**但絕不加書名號/引號當成正式術語**`;
};

/**
 * 精簡版 prompt — 供快速輸入模式使用
 * 前端已 parse 出結構化欄位（faction/style/type/level/cost/slot/axis/talisman 欄位），
 * Gemini 只負責創意層：name_en、effects 陣列、attribute_modifiers、flavor_text、V 值估算。
 */
__cardPromptGlobal.buildMiniCardGeminiPrompt = function(parsed) {
  const p = parsed || {};
  const ud = p.userDescription || '';
  const existingCardsBlock = (p.existingCardsContext && String(p.existingCardsContext).trim())
    ? ('\n\n## 既有卡池上下文(**不得重名/不得重軸效果/補空白/系列呼應**)\n\n' + String(p.existingCardsContext).trim() + '\n')
    : '';
  const known = [
    p.name_zh && ('卡名:' + p.name_zh),
    p.faction && ('陣營:' + p.faction),
    p.style && ('風格:' + p.style),
    p.card_type && ('類型:' + p.card_type),
    p.level != null && ('起始投入:★' + p.level),
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

  const needNameZh = !p.name_zh;
  const needAxis = !p.primary_axis_layer || p.primary_axis_layer === 'none';
  return `你是克蘇魯神話卡牌遊戲的卡片設計師。下面的結構化欄位已由前端決定，你**不要覆蓋這些值**；你只需要產出創意層的 JSON 欄位。

## 已確定欄位（請照抄回 JSON，勿改）
${known || '（無）'}

## 你要產出的欄位（JSON 形式回傳）
${needNameZh ? '- **name_zh**: 中文卡名(使用者未提供,你必須根據 userDescription 發想一個符合氛圍的中文名);**禁止加書名號**,例寫「老警長的警棍」不是「『老警長的警棍』」(書名號只在 desc_zh 內文指認其他卡時用)\n' : ''}- name_en: 英譯卡名
- attribute_modifiers: 物件，例 {"charisma": 1}（武器卡才需要；其他類型留 {}）
- effects: 陣列，每個元素為 {trigger, condition, cost, target, effect_code, params, duration, desc_zh, desc_en}
- flavor_text: 風味文字（一句話，不含機制用語，符合克蘇魯氛圍）
${needAxis ? '- **primary_axis_layer** + **primary_axis_value**: 使用者未指定軸向,你必須根據 userDescription 推斷:\n    · 若描述含『X』或「X」的角色名(且情境為系列卡),設 primary_axis_layer=\'card_name\',primary_axis_value=X(**純名,不含書名號**)\n    · 若是法器卡,設 primary_axis_layer=\'talisman_type\',value=六種物質之一\n    · 若有明確陣營歸屬(E/I/S/N/T/F/J/P 其一),設 primary_axis_layer=\'faction\',value=陣營字母\n    · 單張孤立卡無系列呼應時,設 primary_axis_layer=\'none\',value=null(**禁止**單張卡就掛 card_name 軸)\n' : ''}- break_axis_value: 法器的破事軸 V 值估算（僅 is_talisman=true 時填；範圍 0-6）
- kill_axis_value: 殺敵軸 V 值（純法器為 0；雙用途卡依傷害 × 使用次數估）
- leverage_modifier: 雙用途卡的槓桿修正（單用途為 0；雙用途 0.5-2.0）
- value_calculation: {effects: [{name, value}], total_effect_value, level_discount, cost, required_rarity_discount, calculated_rarity}

## V 值公式（摘要）
- 1V = 1 行動點 = 1 資源 = 抽 1 張牌 = 造成 1 點傷害
- 恐懼傷害 3V/點；恢復 HP/SAN 1.5V/點；抽牌 1V/張；搜尋 6V；移動 1V/格
- 施加正面狀態 3-6V/層；快速 +1V；可指定他人 +2V
- **起始投入抵扣**(卡片升級系統重構 v1):starting_xp × 1V 線性。★0=0, ★1=-1V, ★2=-2V, ★3=-3V, ★4=-4V, ★5=-5V
- **Exceptional(卓越)**:額外 -2V + 玩家購買 XP ×2 倍率(雙重特性)
- **5 點配額硬上限**:設計師起始投入 + 玩家後續投入 ≤ 5
- **所有卡型 1:1**(含資產卡;原 2:1 已廢):稀有度抵扣 = 總效果 V - 起始投入抵扣 - 費用 - Exceptional 抵扣
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
**卡名軸命名**:primary_axis_value 必為**純名**(不含書名號『』),例寫「老警長」不寫「『老警長』」;書名號只在 effect.desc_zh 內文指認其他同軸卡時使用(例:「在你打出另一張『老警長』系列卡時」)。單張孤立卡(無其他同名軸卡呼應)**禁止**使用 card_name 軸。

## 雙軸戰鬥 / 法器（is_talisman=true 時適用）
威脅類型（target_threat_types）：mental 精神 / physical 物質 / ritual 儀式（陣列，允許多值）
破除時機（break_timing）：
- instant 即時：過路費 f(S,N) = ⌈S/2⌉ + N 充能消耗
- test 檢定：f(S,N) = 1 充能 + 屬性檢定 DC=S（break_test_attribute 必填）
- stockpile 儲蓄：f(S,N) = S 計量消耗
物質類型（talisman_type）：wooden_peach/silver/steel/crystal/salt/scroll

## 效果動詞（effect_code，必從以下選）
deal_damage, deal_horror, heal_hp, heal_san, draw_card, search_deck, retrieve_card, return_to_deck, discard_card, gain_resource, spend_resource, transfer_damage, transfer_horror, move_investigator, swap_position, engage_enemy, disengage_enemy, exhaust_card, ready_card, stun_enemy, add_status, remove_status, make_test, modify_test, wild_attr_boost, reroll, auto_success, attack, evade, taunt, counterattack, place_clue, discover_clue, place_doom, remove_doom, spawn_enemy, remove_enemy, look_chaos_bag, manipulate_chaos_bag, fast_play, target_other, add_bless, add_curse, remove_bless, remove_curse

**modify_test vs wild_attr_boost**:指定屬性 +N → modify_test (params.modifier);全屬性 / 全技能 +N → wild_attr_boost (params.amount)

**🔴 成長型 effect amount 必填最終可達狀態(s04 §4.4b)**:當效果是「每 X 獲得 Y / 隨 X 累積成長」,params.amount **不是**單位增量,而是卡片可達的最終最強狀態(優先依卡片 SAN-1 / HP-1 / 顯式上限推斷)。例 Key of Ys SAN 4 → wild_attr_boost amount=3 + transfer_horror amount=3 + duration=while_in_play。寫成 amount=1 是嚴重錯誤。

## 觸發時機（trigger，必從以下選）
on_play, on_commit, on_consume, on_enter, on_leave, on_draw, on_success, on_fail, on_take_damage, on_take_horror, before_take_damage, before_take_horror, before_downed, round_start, round_end, action, reaction, passive, free_action

**自然語言 → trigger 對應(避免錯填)**:「離場時/離去時/移除時」→ on_leave(不是 on_play);「進場時」→ on_enter;「將要承受恐懼」→ before_take_horror;「持續在場/被動/只要 X 在場」→ passive(不是 on_play)。

## 軸向指認句型（寫入 effect.desc_zh 時使用）
- 觸發型：在你打出/獲得/消費另一張 [軸向] 卡時，[效果]
- 持續型：只要你場上有 N 張 [軸向] 卡，[效果]
- 強化型：你打出的 [軸向] 卡 [修改效果]
- 強度與廣度反比：faction 軸要淡、card_name 軸可強

## 敘事輸入
${ud || '（使用者未提供額外敘事，請依結構化欄位合理推斷）'}${existingCardsBlock}

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

// ─── Node 端載入方式 ────────────────────────────────────────────────
// 因 packages/client 為 "type": "module"（ESM），CommonJS module.exports 不可用。
// Node 端腳本（scripts/g1-sandbox/lib/prompt-loader.mjs）以 vm.runInNewContext
// 在 fake window 環境執行本檔,從 context 取出 buildCardGeminiPrompt + buildMiniCardGeminiPrompt。
// 三路徑共用單一來源:任何規範升級僅需改本檔。
