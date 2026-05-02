# 克蘇魯卡牌遊戲 · AI Agent 規範索引 v0.2

- **日期碼**:26050302(2026-05-03 第 02 版)
- **適用對象**:所有 AI agent(Claude / Gemini)動工前必讀的「總覽地圖」
- **本檔角色**:列出**有哪些規範存在 / 各自管什麼 / 衝突誰勝 / 各 MOD 量產任務需讀什麼**;不重複規範內容,只當索引
- **v0.2 擴張**:從神話/遭遇卡專屬擴到**全專案 MOD-01~MOD-14 + AXIS 全模組**對照

---

## §0 為什麼有這份索引

規範文件數量已經龐大(規則書 6 章 + h 補充 10 份 + s 專項 14 份 + 多份草案 + 本機生產線規範),AI agent 沒辦法一次精讀全部。沒有索引時,即使 prompt 把全文塞進去,精讀也會洩漏細節(實證:神話卡測試「精英級」程式詞、字數 / tier 不一致都是「規範裡寫了但沒抓到」)。

**本索引解決三件事**:
1. 你知道有哪些規範存在(沒讀到的也知道在哪)
2. 衝突時誰勝(權威等級)
3. 當前任務該重點讀哪幾份(任務 → 必讀對照)

---

## §1 衝突仲裁順序(由高到低)

```
規則書 v1.0(ch1-6 第一~第六章)         ← 最高權威
  ↓
h 補充(h01-h10)                       ← 次高(若內容已被規則書吸收則作廢)
  ↓
s 專項規範(s01-s14)                   ← 高(s11-s13 V 值公式覆蓋 ch3 舊公式)
  ↓
草案 / 框架(keeper_ai_regulation 等)  ← 中
  ↓
本機生產線規範(scripts/mod-agent-local/*/regulation*.md)  ← 中(限該生產線)
  ↓
既有 DB 內容 / 既有卡片                ← 低(僅參考,不作權威)
```

**重點覆蓋規則**:
- **V 值公式**:依 s11-s13《卡片升級系統重構 v1》— ★0=0 至 ★5=-5V 線性,**不採** ch3 的 2:1 舊公式
- **威脅類型**:s14 擴增為四類(mental/physical/ritual + meta),**不採** s09 的三類
- **encounter_type**:s14 part4 §2.3 擴 13 種(passive/conditional/choice_*/test/chaos_bag + 既有 6),**新建卡採新枚舉**
- **神話卡 = 攤開選用模型**:全部 mythos_pool 攤在場上,城主每回合「選」啟用,部分卡可重複(reusable / cooldown / max_uses) — 修正「pool 抽牌」舊概念

---

## §2 規範文件分類一覽

### §2.1 規則書(最高權威,6 章)

路徑:`docs/v07_當前版本_26042606/0X_rulebook_chN.md`

| 章 | 檔名 | 管什麼 |
|---|---|---|
| ch1 | `01_rulebook_ch1.md` | 核心設計原則 / 克蘇魯氛圍 / 違和即資產 / 玩家情緒目標 |
| ch2 | `02_rulebook_ch2.md` | 遊戲規則總綱 / 神話階段 / 神話標記 / 法術結算(§5.4-5.9 神話卡觸發位置) |
| ch3 | `03_rulebook_ch3.md` | 卡片系統總綱(玩家側) — V 值舊公式已被 s11-13 覆蓋 |
| ch4 | `04_rulebook_ch4.md` | 成長系統 / XP / 升級 |
| ch5 | `05_rulebook_ch5.md` | 場景系統(章節 / Act / Agenda 賽跑 / stage 結構) |
| ch6 | `06_rulebook_ch6.md` | 數值規格(DC 範圍 / V 值上下限 / 強度數值) |

### §2.2 h 補充(次高,10 份)

路徑:`docs/v07_當前版本_26042606/h0X_*.md`

| 檔 | 管什麼 |
|---|---|
| h01_design_v03 | 早期設計綱領(部分被規則書吸收) |
| h02_supp01_gameplay | 玩法補充(動作經濟 / 回合結構) |
| **h03_supp02_effects** | **效果結構六要素**(觸發時機 → 條件限制 → 費用類型 → 目標指定 → 效果動詞 → 持續時間) — 寫卡 effect schema 必看 |
| h04_supp03_dying | 死亡 / 創傷 / 復活機制 |
| **h05_supp04_chaos** | **混沌袋與法術系統** — 「法術永遠命中,代價不可控」核心氛圍宣言 |
| h06_supp05_triple | 三重資源(時間 / 行動點 / 注意力) |
| h07_supp06_forge | 鍛造系統 |
| h08_supp07_branch | 分支選擇機制 |
| h09_supp08_side | 支線設計 |
| h10_supp09_spirit | 精靈系統 |

### §2.3 s 專項規範(高,14 份)

路徑:`docs/v07_當前版本_26042606/s0X_*.md`(s14 在 `C:/Ug/docs/`)

| 檔 | 管什麼 |
|---|---|
| **s01_monster_family** | **13 個怪物家族清單**(克蘇魯眷族 / 哈斯塔眷族 / 莎布·尼古拉絲眷族 / 奈亞拉托提普眷族 / 猶格·索托斯眷族 / 克圖格亞眷族 / 伊格眷族 / ...)+ tier 範圍 — 召喚卡引用 family 必看 |
| **s02_mythos_terms** | 克蘇魯神話譯名對照表 — 命名 / 譯名統一 |
| s03_card_design_spec | 玩家卡設計規格 |
| s04_card_value_spec | V 值規格(舊版,部分被 s11-13 覆蓋) |
| **s05_faction_pillars** | **八派系定義**(E 號令 / I 深淵 / S 鐵證 / N 天啟 / T 解析 / F 聖燼 / J 鐵壁 / P 流影)+ 主屬性 + 戰鬥風格 — faction_pressure / 派系刁難必看 |
| **s06_card_text_style** | **卡片敘述文法規範 v0.3**(1467 行)— 術語統一表 / 取消-忽略-預防三分法 / 句型範本 / 簡體字 + 程式術語驗閘(必跑) |
| s07_faction_narrative | 八派系敘事氣質 / 玩家動機 |
| s08-s10_axis_dual_combat | 雙軸戰鬥 part1-3(三威脅定義 + 法器三時機 + DV 公式骨架,被 s14 擴增四類) |
| **s11-s13_card_upgrade_v1** | **V 值線性公式(★0=0 至 ★5=-5V) + 5 點配額硬上限** — 玩家側為主,神話卡 V 公式對齊 |
| **s14_encounter_card_spec_part1-4** | **遭遇卡規範草案 v0.1**(在 `C:/Ug/docs/`,4 份)— 四類威脅(含 meta)/ 五維框架 / 紅線五條 / 修飾關鍵字 / 句型範本 / 雙 DV / JSON Schema / 22 案例 |

### §2.4 城主 / 神話卡規範(草案層,中)

| 檔 | 路徑 | 管什麼 |
|---|---|---|
| **keeper_ai_regulation v0.2** | `docs/keeper_ai_regulation_v0_2_26050202.md` | §1 七大類動作 / §3 10 主軸動作 sequence / §4 神話卡庫四維度需求 30-38 張 / §5 遭遇卡庫 7 個遭遇集 34-43 張 / §7 schema 擴充 / §9 與 s14 引用矩陣 |
| **regulation_mythos v0.1** | `scripts/mod-agent-local/keeper-cards/regulation_mythos.md` | **神話卡單卡設計權威** 17 章:七大類 / open-hand 合約(reusable/cooldown/連動觸發)/ 紅線六 / action_code 標準清單 / 啟用句型 / DV 公式 / 13 項驗證清單 |
| **READING_GUIDE v0.1** | `scripts/mod-agent-local/keeper-cards/READING_GUIDE.md` | 城主卡 sub-agent 閱讀指引(本索引的下一層精細版) |

### §2.5 生產線規範(本機 only,中)

| 檔 | 路徑 | 管什麼 |
|---|---|---|
| **pipeline-story-to-stage regulation** | `scripts/mod-agent-local/pipeline-story-to-stage/regulation.md` | 12 點規範主檔:讀故事抽 outline / 寫戰役 / 寫地點 hidden_info / 綁三池 / 子 Agent 呼叫表(§13)|

### §2.6 admin 既有 prompt 模組(本機在地化字典)

路徑:`packages/client/public/admin/`

| 檔 | 管什麼 |
|---|---|
| **admin-card-prompt.js** | 玩家卡 Gemini prompt 主檔。**§4「術語對照表 + 程式術語黑名單 + 簡繁規則」是所有 AI agent 寫文必看** |
| admin-card-ai-tools.js | AI 補欄位工具(MOD-12 批次寫卡的核心邏輯) |
| admin-shared.js | 共用模組(Gemini key 取存 / 派系字母對照 / 通用 helper) |

### §2.7 全專案 MOD 模組對照(量產任務入口)

每個 MOD 對應一類設計工作。**有量產任務的 MOD** 動工時都走本索引 §4 的任務對照查必讀規範。

| MOD | 名稱 | 入口頁面 | 量產任務(若有)| 主要規範來源 |
|---|---|---|---|---|
| MOD-01 | 卡片設計器(玩家卡)| `admin-card-designer.html` | 批次寫玩家卡(走 admin-card-prompt.js + geminiDirectClient,**已成熟生產線**) | s03/s04 卡片規格 + s06 文法 + s11-13 V 公式 + admin-card-prompt.js §4 |
| MOD-02 | 天賦樹管理 | `admin-talent-skill.html` | 批次寫天賦卡 / 天賦樹節點 | s05 八派系 + 天賦樹 schema(migrate.ts MIGRATION_005~007) |
| MOD-03 | 敵人設計器 | `admin-enemy-designer.html` | 批次寫怪物 family / species / variant / attack_card | **s01 13 family**(權威)+ 怪物 schema(MIGRATION_004) |
| MOD-04 | 團隊精神管理 | `admin-team-spirit.html` | 批次寫 32 種團隊精神(已 Agent 化完成) | `project_mod_04_done` 記憶 + 團隊精神 V 表 |
| MOD-05 | 戰鬥風格與專精 | `admin-proficiency.html` | 批次寫 30 種專精 | s09 雙軸戰鬥 part2(8 戰鬥風格 + 30 專精)+ s10 |
| MOD-06 | 戰役敘事設計器 | `admin-campaign.html` | 批次寫戰役 / 章節骨架 / 旗標 / outcome | **pipeline-story-to-stage/regulation.md**(12 點規範主檔)+ ch5 場景系統 |
| MOD-07 | 關卡編輯器 | `admin-scenario-editor.html` | 批次配置地點排列 / 混沌袋 / 怪物池 / Act/Agenda(綁三池) | pipeline-story-to-stage 第 9-12 點 + ch5 |
| MOD-08 | 地點設計器 | `admin-location-designer.html` | 批次寫地點積木 / hidden_info / 旗標 / location_style_tags | pipeline-story-to-stage 第 2/8 點 + 地點 schema |
| MOD-09 | 鍛造與製作管理 | `admin-forge-craft.html` | 批次寫素材 / 鍛造詞條 / 製作配方 | h07 鍛造補充 + 鍛造 schema(MIGRATION_014) |
| MOD-10 | 城主設計器 | `admin-keeper-designer.html` | 批次寫神話卡 + 遭遇卡(**本次 session 對接驗證完成,正式 driver 待寫**)| **regulation_mythos.md**(神話卡)+ **s14**(遭遇卡)+ keeper_ai_regulation v0.2 + READING_GUIDE.md |
| MOD-11 | 調查員設計器 | `admin-investigator-designer.html` | 批次寫調查員模板 / 簽名卡 / 弱點 / 預組牌組 | s05 八派系 + 調查員 schema(MIGRATION_013, INTP-1 row 待修) |
| MOD-12 | AI 主控台 | `admin-ai-console.html` | 透過聊天介面 AI 呼叫其他模組 API | ai-console.ts BRIDGE_URL proxy |
| MOD-14 | 卡片檢查器 | `admin-card-checker.html` | L1+L2 全 DB 健檢 + 一鍵修復 | 各 MOD 規範的驗閘規則合集 |
| AXIS | 主軸系列編輯器 | `admin-axis-series.html` | 主軸卡池檢視 + 3×3 法器矩陣 + 一鍵到 MOD-12 補寫 | s11-13 主軸 + 法器系統 |

**已成熟 Gemini 生產線**(可抄):
- MOD-01 玩家卡批次:`packages/client/public/admin/admin-ai-tasks/geminiDirectClient.js + admin-card-prompt.js`
- pipeline 階段 0 故事抽 outline:`scripts/mod-agent-local/pipeline-story-to-stage/00-parse-and-outline.mjs`
- MOD-10 城主卡對接(本次 session 驗證):`scripts/mod-agent-local/keeper-cards/test-gemini-mythos.mjs`(test 腳本,正式 driver 待 fork)

**待 Gemini 化的生產線**(技術債):
- pipeline-story-to-stage 階段 10 戰役 / 階段 20 地點 / 階段 30 stage 三池綁定 — 目前用腳本內 heuristic
- MOD-10 神話卡 / 遭遇卡正式批次 driver(test 已驗證,正式版未寫)
- 其他 MOD 若有批次需求都該走 Gemini 而非 Claude sub-agent 直寫

---

## §3 在地化字典地圖(常用清單在哪查)

| 你需要... | 去這裡查 |
|---|---|
| 八派系字母代碼 → 中文名 → 主屬性 | `s05_faction_pillars.md`(權威)+ `migrate.ts` faction_attribute_map seed(實作) |
| 八派系敘事氣質 / 玩家動機 | `s07_faction_narrative.md` |
| 13 個怪物家族中文名 + tier 範圍 | `s01_monster_family.md` |
| **怪物 species 完整清單**(具體怪物名,如「廷達洛斯獵犬」「深潛者」)| `monster_species` DB 表,GET `/api/admin/monsters/species` 拿 — **不可憑記憶虛構克蘇魯神話角色名**,即使該角色是真實神話典故。**只能用 DB 內已 seed 的 species** |
| 克蘇魯神話譯名(舊日支配者 / 古神 / 異種) | `s02_mythos_terms.md` |
| 程式術語黑名單(英文 + **中文同源詞** ⚠️) | 見下方 §3.1 黑名單表(本索引內建) |
| 簡繁規則 + 術語統一(取消/忽略/預防三分法) | `s06_card_text_style.md` + `admin-card-prompt.js` §4 |
| V 值公式(★0=0 ~ ★5=-5V 線性 / 5 點配額) | `s11-s13` |
| 雙 DV 公式(dv_average / dv_peak 多路徑) | `s14_part2 §5` |
| 12 種攻擊面(attack_surfaces 陣列值) | `s14_part1 §3.6` + `s14_part4 §2.5.5` |
| 四類威脅 + 各自定義 | `s14_part1 §2`(mental / physical / ritual / meta_personal / meta_global) |
| 13 種 encounter_type 枚舉 | `s14_part4 §2.3` |
| 五條紅線(strength 1-2 不致死 / strength 5+ 必中後期 / 雙軸 1/3 / 延遲可預測 / meta 有清除) | `s14_part1 §4.6` |
| 8 種戰鬥風格 / 30 種專精 | `s09 axis_dual_combat_part2` + `s10 axis_dual_combat_part3` |
| 6 種法器物質類型(wooden_peach / silver / steel / crystal / salt / scroll) | MIGRATION_021 talisman_types seed |
| 神話譯名(舊日支配者 / 古神 / 異種) | `s02_mythos_terms.md` |
| 章節編號 / 章節結構 / 旗標 / outcome 規格 | ch5 場景系統 + pipeline-story-to-stage §3-§7 |
| 鍛造詞條 / 素材分類 / 製作配方規格 | h07_supp06_forge + MIGRATION_014 |
| 32 種團隊精神 V 公式 / 候選池規格 | `project_mod_04_done` 記憶 |
| 12 級天賦樹結構 / 分支路線 | MIGRATION_005~007 + ch4 成長系統 |
| 簽名卡 / 弱點 / 預組牌組規格 | MIGRATION_013 + ch4 |

### §3.1 程式術語黑名單(英文 + 中文同源詞,**全部禁用**)

**禁用範圍**:任何 AI 產出的所有欄位內容,**包含但不限於** name_zh / description_zh / flavor_text_zh / scenario_text_zh / 選項文字 / **design_notes 全段**(設計者看到也算 — 設計記錄也應符合專案氛圍與術語標準,後續抽審 / 升級 prompt 時 design_notes 是審查對象)/ 任何其他文字欄位。**英文同源中文翻譯也算違規**(實證:Gemini 用「精英級 / 精英級別」繞過 `elite` 禁令)。

| 英文程式詞 | 中文同源禁用詞 | 替換寫法(設計強度時用敘述) |
|---|---|---|
| elite | **精英 / 精英級 / 精銳** | 用 intensity_tag='large' 標 + 文字寫「強悍」「凶猛」「異變的」具體形容 |
| boss | **頭目 / 老大 / 王 / Boss** | 用 intensity_tag='epic' 標 + 文字寫具體名稱「黑山羊母后」「深潛者首領」 |
| minion | **嘍囉 / 雜兵 / 小弟** | 用 intensity_tag='small' 標 + 文字寫「侍從」「眷族」「殘黨」具體稱謂 |
| tier | **層級 / Tier / T 級** | 不出現。tier 是後台設計用語,不寫進玩家可見文字 |
| HP / health | **血量 / HP** | 寫「生命」「生命值」(專案標準術語) |
| SAN / sanity | **理智值 / SAN** | 寫「理智」(專案標準術語) |
| DC | **DC / 難度檢定值** | 寫「難度」「檢定難度」 |
| damage | **傷害值 / DMG** | 寫「傷害」(數字 N 點傷害)|
| buff | **增益 / Buff** | 寫具體效果「該卡費用 -1」「該回合命中 +2」 |
| debuff | **減益 / Debuff / 負面狀態** | 寫具體效果「下次檢定 -2」「該回合無法移動」 |
| stack | **層數 / Stack** | 寫「累積」「疊加」具體機制 |
| cooldown | **冷卻 / CD** | reusable 卡可寫「冷卻 N 回合」(這是專案合約字眼,例外允許) |
| proc | **觸發 / Proc** | 寫「啟動」「發動」(動詞而非名詞) |
| AOE | **範圍傷害 / 群攻** | 寫「該地點所有調查員」「同地點每位調查員」 |
| respawn | **重生 / Respawn** | 寫「再次出現」「自神話卡池重新部署」 |
| dot | **持續傷害 / DoT** | 寫「每回合受 N 點傷害,直至 X」 |

**判斷原則**:遇到一個詞,自問「這是電玩 / 桌遊術語嗎?中文版讀起來像翻譯遊戲的詞嗎?」— 是 → 換成克蘇魯氛圍的具體敘述(克蘇魯系基調是「壓抑 / 哀悼 / 不可知」,不是「升級 / 打怪 / 擊敗」)。

### §3.2 角色術語(專案規定用詞,**所有欄位**)

| 通用詞 / 程式詞 | 專案規定用詞 |
|---|---|
| 玩家 / Player | **調查員**(Investigator) |
| 探員 / 偵探 / agent | **調查員** |
| 主持人 / GM / DM | **城主**(Keeper) |
| 角色 / character(指玩家方)| **調查員** |
| 道具 / item | 視 schema 而定:**法器 / 資產 / 武器** |
| 怪 / 雜兵 | **眷族 / 神話實體 / 異種**(視家族而定)|

實證:Gemini 在 design_notes 用「玩家」會被 validator 抓到。`調查員` 是專案核心術語(出現在 schema 表名 investigator_templates / investigator_signature_cards / 規則書 ch1-6),所有 AI 產出文字必須一致。

---

## §4 任務類型 → 必讀 + 可選讀對照

### §4.1 寫神話卡批次

| 必讀(全文) | 可選(按需引用) |
|---|---|
| `regulation_mythos.md`(神話卡單卡權威) | `s11-s13`(V 公式細節) |
| `keeper_ai_regulation v0.2` §1/§3/§4(框架 + 主軸 + 庫需求) | `h05`(法術氛圍宣言) |
| `s05_faction_pillars` + `s07_faction_narrative`(派系) | `h03`(效果結構六要素) |
| `s01_monster_family`(召喚卡引用 family) | `s02_mythos_terms`(神話命名) |
| `s06_card_text_style`(文法 / 程式術語驗閘) | `01_rulebook_ch1` / `02_rulebook_ch2` §5(神話階段) |
| `admin-card-prompt.js` §4(術語對照 / 簡繁 / 程式術語黑名單) | `06_rulebook_ch6`(數值規格) |

### §4.2 寫遭遇卡批次

| 必讀(全文) | 可選 |
|---|---|
| `s14_part1-4`(遭遇卡權威) | `keeper_ai_regulation v0.2` §5/§9 |
| `s05_faction_pillars` + `s07_faction_narrative` | `s09 axis_dual_combat`(三威脅定義) |
| `s06_card_text_style` | `h03`(效果結構)|
| `admin-card-prompt.js` §4 | `01_rulebook_ch1` |

### §4.3 寫玩家卡(MOD-01 / MOD-12 批次,**已成熟生產線**)

| 必讀 | 可選 |
|---|---|
| **既有 admin-card-prompt.js + geminiDirectClient.js**(主生產線,直接抄/用)| s03 卡片規格 / s04 V 規格 |
| s05_faction_pillars + s07_faction_narrative(派系)| s11-s13 卡片升級系統 |
| s06_card_text_style(文法)| 03_rulebook_ch3(玩家卡系統) |
| 02_rulebook_ch2(遊戲規則)| s09-s10(戰鬥風格)|

### §4.4 寫戰役 / 章節 / outcome / 旗標(MOD-06)

| 必讀 | 可選 |
|---|---|
| **pipeline-story-to-stage/regulation.md**(12 點主檔)| keeper_ai_regulation v0.2 §3(主軸跟章節對齊) |
| 05_rulebook_ch5(場景系統)| 01_rulebook_ch1(克蘇魯氛圍) |
| s05_faction_pillars + s07_faction_narrative | s02_mythos_terms |

### §4.5 寫關卡 / 三池綁定(MOD-07,**待 Gemini 化**)

| 必讀 | 可選 |
|---|---|
| pipeline-story-to-stage/regulation.md §9-§12 | keeper_ai_regulation v0.2 §3 主軸 |
| 05_rulebook_ch5(場景系統 / Act/Agenda 賽跑) | s14 part4(遭遇卡綁池規範) |
| s01_monster_family(怪物池)| regulation_mythos.md(神話池)|

### §4.6 寫地點 / hidden_info / 旗標(MOD-08)

| 必讀 | 可選 |
|---|---|
| pipeline-story-to-stage/regulation.md 第 2/8 點 | 05_rulebook_ch5 |
| s07_faction_narrative(地點氛圍 ↔ 陣營氣質)| 01_rulebook_ch1 |
| location_style_tags 既有 seed(MIGRATION_???)| h05(混沌袋對地點觸發)|

### §4.7 寫怪物 family / species / variant / attack_card(MOD-03)

| 必讀 | 可選 |
|---|---|
| **s01_monster_family**(權威 13 family)| keeper_ai_regulation v0.2 §3(主軸召喚需求)|
| 既有 admin-enemy-designer.html 邏輯 | s14 紅線一/二(strength × 章節)|
| s06_card_text_style(命名 / 攻擊文)| s09 三威脅(physical/mental/ritual)|

### §4.8 寫天賦樹 / 天賦卡(MOD-02)

| 必讀 | 可選 |
|---|---|
| ch4 成長系統(12 級結構 / XP 公式)| s11-s13 V 公式 |
| s05_faction_pillars(每派系主屬性 / 戰鬥風格)| s07_faction_narrative |
| MIGRATION_005~007 schema | s09-s10 雙軸戰鬥 |

### §4.9 寫戰鬥風格與專精(MOD-05)

| 必讀 | 可選 |
|---|---|
| **s09_axis_dual_combat_part2 + s10_part3**(8 風格 + 30 專精權威)| s11-s13 V 公式 |
| s05_faction_pillars(派系 ↔ 風格配對)| ch4 成長系統 |

### §4.10 寫鍛造詞條 / 素材 / 配方(MOD-09)

| 必讀 | 可選 |
|---|---|
| **h07_supp06_forge**(鍛造系統權威)| 03_rulebook_ch3(卡片系統)|
| MIGRATION_014 schema | s04 V 規格 |

### §4.11 寫團隊精神(MOD-04,**已 Agent 化完成**)

| 必讀 | 可選 |
|---|---|
| `project_mod_04_done` 記憶(核心設計原則 + V 表)| keeper_ai_regulation v0.2 |
| ch4 成長系統 | s11-s13 V 公式 |

### §4.12 寫調查員模板 / 簽名卡 / 弱點 / 預組牌組(MOD-11)

| 必讀 | 可選 |
|---|---|
| s05_faction_pillars + s07_faction_narrative(每派系主屬性 / 動機)| ch4 成長系統 |
| MIGRATION_013 + MIGRATION_019 + MIGRATION_030(若有)schema | s11-s13 V 公式 |
| admin-card-prompt.js §4(術語對照)| ch3 卡片系統(預組牌組組成)|

### §4.13 一般批次量產(若沒在上面對照表)

走 SKILL `skill_quality_lead_for_gemini_production_v0_1.md` §4 五階段 SOP:
1. 規範化(找必讀 .md)
2. 對齊會議(寫 test 腳本 + 索引導向 prompt + Gemini 試跑 + 品管 review)
3. 規格化(fork 成正式 driver)
4. 量產(Gemini 跑 + Claude 抽查)
5. 升級協調(prompt 改版時所有入口同步)

---

## §5 給 AI agent 的使用指引(動手前必跑)

1. **本索引一定讀完**(§0-§4),確保你知道:
   - 有哪些規範存在
   - 衝突誰勝
   - 你當前任務該精讀哪幾份
   - 你當前任務對應的 MOD 入口 / 量產 driver 在哪(§2.7)

2. **本次任務的「必讀全文」會跟在本索引後面附上**(orchestrator 已經按 §4 對照表挑好)。你要逐份精讀。

3. **「可選讀」沒附全文**,但你知道**它存在**(在 §X 文件 §Y 段)— 寫卡時若需要該層細節,在 `design_notes` 或回應 metadata 註明「需引用 X 文件 Y 段」,**不要憑記憶虛構**。

4. **衝突時依 §1 仲裁順序** — 高層(規則書)勝低層(草案 / 既有卡)。同層衝突優先選**較新版本**(看 v0.X 號或日期碼)。

5. **在地化(§3 + §3.1)永遠不能繞過** — 派系字母 / 13 family / 程式術語黑名單(含中文同源詞)/ 簡繁是硬合約,不可自創、不可音譯、不可意譯。

6. **不要塞超出本任務的內容**:本次只生 N 個 X,就只生 N 個 X,不要順便寫 N+1 個其他類型。

7. **如果你是品質主管(Claude)**:啟動量產生產線前,一律先讀 SKILL `skill_quality_lead_for_gemini_production_v0_1.md`,該 SKILL 是本索引的執行手冊。

---

## §6 本索引維護紀錄

| 版本 | 日期碼 | 變更 |
|---|---|---|
| v0.1 | 26050301 | 初版 — 涵蓋規則書 / h / s / 草案 / 本機生產線 / admin 既有 prompt 模組,任務類型對照含寫神話卡 / 遭遇卡 / 關卡 |
| v0.2 | 26050302 | 擴張到全專案:§2.7 全 MOD 模組對照(MOD-01~14 + AXIS)/ §3 在地化字典擴(戰鬥風格 / 法器 / 章節 / 鍛造 / 團隊精神 / 天賦樹)/ §4 任務對照擴 13 類(覆蓋 MOD-01 ~ MOD-12) |

未來新增規範文件 / 新生產線時,補進 §2 對應分類 + §4 任務對照,版本號遞增。
