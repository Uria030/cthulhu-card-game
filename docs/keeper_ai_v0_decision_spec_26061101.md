# 城主 AI v0 決策規格(實作層)

- **日期碼**:26061101(v2 補戰術風格層,同日)
- **狀態**:草案,待 Uria 過目後動工
- **上層權威**:`keeper_ai_regulation_v0_2_26050202.md`(框架)+
  `s14_monster_design_supplement_behavior_script_v0_1.md`(**怪物行為腳本/戰術風格**)+ 規則書 v1.0
- **範圍**:單人測試版的規則型城主(取代現行「臨時城主」占位);LLM 不進回合迴圈
- **驗證場**:裂嘴女關卡(12 張神話卡武器庫 + 頭目行為腳本)
- **v2 變更**:初稿漏掉行為腳本層(怪物出招只有加權隨機)——城主的戰術風格由
  「神話卡選用決策」+「棋子行為腳本」兩層共同構成,本版補齊第二層(§5A)

---

## §1 v0 目標與不做什麼

**做**:城主每回合照規範 §2.2 的順序行動——自動推進 → 攤開武器庫選卡啟用 → 怪物 AI。
選卡用「局勢評分」決策,玩家看得到整個武器庫(open-hand,規範原則 1)與城主每一步演出。

**不做(明確延後)**:
- LLM 決策 / 敘事潤色(之後可加一層 Gemini 文字皮,不影響決策)
- narrative 詐術類卡的引擎機制(假線索 / 線索篡改 / NPC 變臉 — 依賴線索真假系統與 NPC 系統,v0 這三張顯示在武器庫但標「蟄伏中」不啟用)
- 玩家反應窗(不祥預感 cancel 卡需要「響應玩家攻擊」的時點,v0 簡化:城主階段啟用後「附著」,玩家下一次攻擊自動觸發重擲)
- 多人目標選擇(§10.5 偏好系統,單人 = 唯一目標)

## §2 回合流程(對齊規範 §2.2)

```
神話階段開始
1. 自動推進(不耗行動點):本關卡無自動進度條主軸 → 略過
   (裂嘴女的毀滅來源 = 城主主動打 agenda 卡,不再有「每回合白送 1 毀滅」)
2. 持續附著卡強制結算:已附著的卡(海腥味/瘋狂攫住等)觸發其強制句型
3. 城主選卡:依行動點預算,評分→排序→貪婪選用直到點數不足
4. 怪物啟動(已完成的 §10 引擎:位階序/移動/交戰/出招/召喚失調)
神話階段結束 → 玩家回合
```

**重要變更**:臨時城主的「每回合自動 +1 毀滅」退場。毀滅改由城主打【末日推進】(+2 毀滅,3 點)
等 agenda 卡產生 — 城主有資源壓力,玩家有干擾空間,議程節奏成為真實的決策結果。

## §3 行動點預算

- 讀 `game_balance_settings`:`keeper_action_base_difficulty_N`(關卡難度 standard → N=3 檔)
  + `keeper_action_per_player` × 玩家數 + 累積規則(`keeper_action_accumulation` / 上限)
- DB 無值時 fallback:**每回合 3 點,未用點數可累積,上限 6**
- 每張卡扣其 `action_cost`(現有欄位,1-3)

## §4 選卡決策(評分制)

### 4.1 局勢快照(每回合計算)

| 訊號 | 來源 |
|---|---|
| 場上活怪數 / 總威脅 tier | scenario.enemies |
| 玩家 HP% / SAN% | investigator |
| 毀滅距下一道門檻 | agendaProgress vs front_doom_threshold |
| 幕進度危險度(玩家快達成幕目標?) | objectiveProgress / clue_threshold;幕二 = 頭目 HP% |
| 玩家所在地光照 | locations.visibility |

### 4.2 類別基礎分(規範七大類 → 卡 category)

| 情境 | 加分對象 | 理由 |
|---|---|---|
| 場上無活怪 | summon +3 | 重建壓力(A 類) |
| 玩家 SAN% < 50% | status +2 | 乘勝追擊(E 類) |
| 玩家快達成幕目標(≥80%) | agenda +3、cancel +2 | 搶節奏(C 類) |
| 玩家所在地非黑暗 | general(黑暗滲出)+1 | 攻防修正(B 類) |
| 預設 | 各類 +0,general +1 | 環境鋪陳 |

### 4.2A 戲劇曲線層(v3 補,權威:G1 交付書 Part3 示範劇本 §3 + 第七章 G4「保持戲劇性、避免單調」)

評分之上疊一層**節奏約束**——城主不是純最優化機器,是恐怖片導演。
對應劇本三層情感曲線(好奇懷疑 → 認知崩塌 → 理性的小勝):

| 關卡節奏期 | 判定 | 城主選卡傾向 |
|---|---|---|
| 鋪陳期(幕一前段,回合 1-2) | actIndex=0 且回合 ≤2 | 只選 intensity=small 的氛圍卡(海腥味瀰漫/雨勢加劇/黑暗滲出)——「世界開始不對勁」 |
| 升壓期(幕一後段) | actIndex=0 且回合 ≥3 | small/medium 解禁:召喚、恐懼侵襲——「牠們注意到你了」 |
| 高潮期(幕二,頭目在場) | actIndex ≥1 | 全強度解禁,large 加分 +1:瘋狂攫住/末日推進/增援——「潮水壓過來」 |

**避免單調**(G4 驗收項):不連續兩回合啟用同一 category;同一張 reusable 卡連用第二次 -2 分。

### 4.3 卡內排序與扣除

- 同分依「強度/費用比」(intensity small=1/medium=2/large=3 ÷ action_cost)
- 不可用即跳過:冷卻中 / 用盡 max_uses / 引擎不支援(v0 三張 narrative)/ 點數不足
- 每回合至多啟用 **2 張**(規範 §8.1.3 校準項,v0 預設;避免一回合連環重壓)

### 4.4 reusable / cooldown(schema 補欄 + 12 張卡回填)

照規範 §7.1 開 **MIGRATION_035**:`reusable BOOLEAN / cooldown_rounds INT / max_uses_per_stage INT / axis_tag JSONB`。
裂嘴女 12 張回填值(依規範 §1 表的「是否常 reusable」):

| 卡 | reusable | cooldown | max_uses |
|---|---|---|---|
| 深淵呼喚(summon t1) | ✓ | 1 | — |
| 深潛者增援 | ✓ | 2 | 3 |
| 末日推進(agenda) | ✓ | 1 | — |
| 恐懼侵襲(status) | ✓ | 2 | — |
| 瘋狂攫住(status 附著) | ✗ | — | 1 |
| 黑暗滲出 / 海腥味瀰漫 / 雨勢加劇(general) | ✓ | 1-2 | — |
| 不祥預感(cancel) | ✓ | 2 | — |
| 三張 narrative | v0 蟄伏 | — | — |

## §5 神話卡效果執行器(首批支援碼)

現況:12 張僅 3 張有結構化效果,**6 張機制簡單需回填結構**(資料修正,同武器傷害債的處理方式),3 張 narrative v0 蟄伏。

| action_code | 卡 | 引擎落點 |
|---|---|---|
| advance_agenda {doom_tokens} | 末日推進 | addDoom(已有) |
| summon_monster {family/tier/location_rule} | 深淵呼喚 | spawnEnemy(已有)+ location_rule 解析(nearest_to_clue → 距線索最近地點) |
| summon_monster {variant/location}(回填) | 深潛者增援 | spawnEnemy 指定變體於指定地點(地點碼修正:濕滑磚牆→磚牆盡頭,G1 舊地點已不存在) |
| horror_damage {amount, target_rule}(回填) | 恐懼侵襲 | SAN 傷害(含「達上限改 1」護欄 = 紅線一) |
| set_visibility {visibility:'darkness'}(回填) | 黑暗滲出 | LocationInstance.visibility(已有,攻 -2 生效) |
| test_modifier {attribute, modifier, persistent}(回填) | 海腥味瀰漫 | 附著全域感知 -1(接進檢定管線 situational) |
| attach_status {status}(回填) | 雨勢加劇 / 瘋狂攫住 | v0 附著標記+敘事;瘋狂攫住的強制棄牌接回合開始結算 |
| force_reroll(附著版) | 不祥預感 | 附著後玩家下次攻擊自動重擲取差 |

## §5A 城主棋子的戰術風格 — 行為腳本層(v2 補,對應補充文件 #2)

行為腳本系統 = 「基礎 AI(§10,已實作)→ 招式池(方式庫,已實作)→ **行為腳本(本層)**」
的第三層:決定「這個情境下從招式池選哪一招」。設計哲學 = 結構化隨機(可讀招,但讀招有代價)。

### 5A.1 v0 支援的出招模式(六種光譜取前四)

| 模式 | 位階 | v0 | 引擎行為 |
|---|---|---|---|
| pure_random | 雜兵預設 | ✓ | 等機率抽招(忽略 weight) |
| weighted | 威脅預設 | ✓(= 現行為) | 加權抽招 |
| conditional | 精英/頭目預設 | ✓ | 依 trigger_condition 篩可用招 → forced 優先 → priority 小者優先 → 同級加權 |
| phase_based | 頭目 | ✓ | phases[] 切換條件(hp_percent 等)換招式池,接既有 phase_rules |
| scripted_chain / ritual_sequence | 巨頭/萬象 | ✗ 後續 | 裂嘴女關卡無巨頭,留待哈斯塔/克蘇魯戰 |

### 5A.2 觸發條件子集(v0 實作補充文件 §3 的常用六種)

`turn_count / hp_percent / san_percent / player_status / last_move / random_chance`
(+ 比較子 = < > <= >= / and-or 組合;`location_status / global_variable / nearby_monsters / distance` 後續)

### 5A.3 資料落點(沿用方式庫模型,不開新表)

- **MIGRATION_036**:`monster_variants` 加 `move_pattern VARCHAR(32) DEFAULT 'weighted'` +
  `behavior_script JSONB DEFAULT '{}'`(補充文件 §6.1.1)
- 招式級參數(trigger_condition / priority / forced / cooldown)放在 **behavior_script.moves[]**
  內引用 mac code,不動 move_pool 既有形狀(向下相容:無 script → 照 move_pattern 預設行為)
- 位階×模式紀律照 §6.3 禁止組合,寫進 driver 驗閘

### 5A.4 裂嘴女關卡的腳本配置(v0 內容)

- 深潛者亡靈(t1 雜兵):pure_random(7 招等機率,符合「烏合之眾」)
- 召喚池其他低位:照位階預設(t1 pure_random / t2 weighted)
- **深潛者裂嘴女(t3 頭目級體驗)**:conditional 腳本——照補充文件 §6.2 Gemini 模板生成
  + §6.3/6.4 驗閘(克蘇魯家族風味:壓迫感累積)。示意結構:首回合強制開場招(敘事鎮場)/
  玩家 SAN 高 → 攻心招 / 自身 HP < 50% → 兇暴招 / 其餘加權。實際內容由 Gemini 產出後入 behavior_script

## §6 玩家側 UI(open-hand + 演出)

- 戰鬥板新增「**城主威脅區**」面板(點議程區塊展開):12 張卡攤開全可見
  (卡名+類別+費用+敘述 — 規範原則 1「看得到威脅,但擋不完」),冷卻中 / 蟄伏中的卡標灰
- 城主啟用卡時:log 演出「🃏 城主啟用【末日推進】——(卡面敘述)」+ 效果結算逐條
- 城主能量條改顯示「行動點 N(累積上限 6)」
- **頭目登場三段式演出**(劇本 Part3 §2.4 設計意圖:先聽聲 → 見人 → 揭真相):
  幕一翻面生成裂嘴女時,log 分三拍推送——
  ①「沙啞、彷彿肺部積滿水的聲音從雨幕後傳來:『我……漂亮嗎?』」
  ②「一個穿著破舊風衣的身影,站在路燈的死角。」
  ③「她扯下口罩——那不是傷口,是兩側下顎劇烈翕張的魚鰓。【深潛者裂嘴女】現身磚牆盡頭。」
  (效果不擠同一瞬間;v0 以 log 序列呈現,動畫節拍 G8)

## §7 實作切片(預估 2 個工作日,v2 加入行為腳本層)

1. MIGRATION_035(神話卡 reusable/cooldown/max_uses/axis_tag)+ MIGRATION_036
   (怪物 move_pattern/behavior_script)+ 12 張神話卡回填 + 6 張卡效果結構回填(冪等腳本)
2. shared `keeperAI.ts`:局勢快照 / 評分 / 選卡 / 神話效果執行器(+測試)
3. shared `monsterBehavior.ts`:四種出招模式 + 觸發條件求值器,接進 activateMonsters
   取代單一加權抽招(+測試,含 §6.3 禁止組合的防衛)
4. 裂嘴女頭目 conditional 腳本:Gemini 用補充文件 §6.2 模板生成 + 驗閘入庫
5. client:神話階段接 keeperAI(撤掉臨時城主)、城主威脅區面板、演出 log
6. E2E:裂嘴女整關 — 城主有節奏地施壓、頭目戰可讀招(首回合鎮場/攻心/兇暴轉換)

## §8 自決事項備案(Uria 可改,改一處生效)

- 每回合至多 2 張、預算 3 點累積上限 6 — 全在 balance settings / 常數,試玩後可調
- 「玩家快贏」門檻 80%、SAN 危險線 50% — 評分常數
- v0 評分不看 axis_tag(裂嘴女未綁主軸);10 主軸 sequence 待 pipeline 產關時帶入

# 文件結束
