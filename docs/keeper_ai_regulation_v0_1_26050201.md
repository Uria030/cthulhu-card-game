# 城主 AI 行為規範主檔 v0.1

- **日期碼**:26050201(2026-05-02 第 01 版)
- **狀態**:初版草案,待 Uria 校準
- **作用**:定義玩家對局時城主會做什麼,反推神話卡 / 遭遇卡庫需要哪些內容
- **配套閱讀**:claude.ai 並行的遭遇卡案例分析

---

## §0 前言

### 0.1 文件定位

本檔回答一個問題:**「玩家在桌上玩的時候,城主每回合會做什麼,玩家視角看到什麼?」**

從 pipeline 規範第 9 點(關卡互動設計 — 10 種劇情主軸)往下推導:
1. 每個劇情主軸對應一套**城主動作 sequence**
2. 從動作 sequence 反推**神話卡 / 遭遇卡庫需求**
3. 之後才談卡片設計準則(本檔不寫)

### 0.2 核心設計原則(三條天條)

#### 原則 1:神話卡 = 攤開選用,不是抽牌堆

整個 stage_mythos_pool(10-15 張)在關卡開始時**全部公開攤在桌面**。城主每回合**選**(不是抽)1 張或數張啟用,部分卡可重複啟用(reusable)。玩家可見產生壓力感:「我看得到威脅,但擋不完」。

#### 原則 2:雙軸正交

每張遭遇卡有兩個維度,城主可同時操作:
- `encounter_type`(thriller/choice/trade/puzzle/social/discovery)— 玩家視角的「**互動形式**」
- `threat_type`(mental/physical/ritual)— 玩家用啥「**法器**」破除

#### 原則 3:規則內建 vs 卡片驅動的分界

- **規則內建**(engine,不出卡):敵人移動 AI、自動進度推進、打斷檢定 DC 公式、勝負判定
- **卡片驅動**(從 mythos / encounter 武器庫):召喚特定怪、特定環境變化、特定狀態效果、特定敘事干擾

### 0.3 與既有規範的關係

| 規範 | 位置 | 本檔關係 |
|---|---|---|
| pipeline 規範第 9 點(10 主軸 + 10 互動形式) | `scripts/mod-agent-local/pipeline-story-to-stage/regulation.md` | **本檔的上層 source**,動作 sequence 從主軸欄「強制動作」展開 |
| pipeline 規範第 11 點(神話卡綁池) | 同上 | 本檔修正其「pool」概念為攤開武器庫 |
| pipeline 規範第 10 點(遭遇卡綁池) | 同上 | 本檔反推每主軸需要的遭遇卡分布 |
| s09 雙軸戰鬥 part2(三威脅 × 六法器) | `docs/v07_當前版本_26042606/s09_axis_dual_combat_part2.md` | 本檔威脅×法器的對應依此 |
| game_balance_settings(城主行動點) | DB MIGRATION_012 | 本檔 §2.1 的行動點預算引用此處設定 |

---

## §1 城主動作七大類框架

| 類 | 名稱 | 玩家視角體驗 | 觸發來源 | 是否常 reusable |
|---|---|---|---|---|
| **A** | 召喚 | 「又有怪冒出來!」 | 神話卡 summon | 雜兵類常 reusable,精英/Boss 一次性 |
| **B** | 環境惡化 | 「這地方變了 / 燒起來了 / 變黑了」 | 神話卡 environment + agenda | 部分 reusable(擴散型) |
| **C** | 進度施壓 | 「儀式快完了 / 標記又增加了 / 資源快沒了」 | 神話卡 global + agenda | 多為 reusable(每回合一次) |
| **D** | 敘事干擾 | 「線索好像不對勁 / 又被誤導了」 | 神話卡 narrative | 多為 reusable |
| **E** | 玩家狀態打擊 | 「我開始發瘋 / 棄牌 / 中負面狀態」 | 神話卡 status + 遭遇卡 mental 威脅 | reusable + 冷卻 |
| **F** | 敵人 AI 決策 | 「怪居然會這樣動」 | engine 內建,**不出卡** | — |
| **G** | 遭遇觸發 | 「進這地方居然遇到這個」 | engine 抽 stage_encounter_pool | — |

**A-D 是城主主動推力,主動選用神話卡執行。**
**E 是 mythos 跟 encounter 共有的玩家狀態打擊管道。**
**F-G 是規則內建,不需要卡。**

---

## §2 城主回合結構

### 2.1 行動點預算

引用 game_balance_settings:
- `keeper_action_base_difficulty_N`(N=1-5)— 每難度的基礎行動點
- `keeper_action_per_player` — 每多 1 個玩家加 X 點
- `keeper_action_accumulation` — 是否跨回合累積
- `keeper_action_max_accumulation` — 累積上限

每張神話卡的 `action_cost` 從這裡扣。預設區間 1-3 點。

### 2.2 動作優先級(每回合 sequence)

```
1. 自動推進(C 類自動部分):進度條 +1 / 標記放置 / 資源池 -1
   → 不耗行動點,規則強制執行
   
2. 城主選用神話卡(A/B/C/D/E 主動部分):依行動點預算選 1-N 張啟用
   → 從攤開武器庫挑,看當前局勢需要
   
3. 已存在敵人 AI 決策(F):依各家族 keyword 自動移動 / 攻擊
   → engine 跑,不需城主介入
   
4. 玩家階段(下回合):玩家行動觸發遭遇卡(G)
   → 進入新地點 / 採取特定行動 → 抽 1 張 encounter_pool
```

### 2.3 必執行 vs 選擇執行

| 動作 | 執行類型 | 規則 |
|---|---|---|
| 進度推進(主軸 1/2/9) | 必執行 | 自動,每回合不可跳過 |
| Agenda 推進條件達成 | 必執行 | 條件命中即觸發 |
| 神話卡選用 | 選擇執行 | 城主依行動點預算挑 1-N 張 |
| 敵人 AI 移動 | 必執行 | 規則內建 |
| 遭遇卡觸發 | 條件執行 | 玩家動作達觸發條件才出 |

---

## §3 10 主軸 × 城主動作 sequence

每個主軸的格式:
- 玩家視角體驗
- 城主每回合動作 sequence(表格)
- 玩家階段觸發遭遇
- 勝負條件
- 反推內容(神話卡需求 / 遭遇卡需求 / 規則內建)
- 校準項

---

### 主軸 1 · 多目標封印型(Multi-Target Sealing)

#### 玩家視角

「城裡 N 個次元門/印記/儀式法陣已經開了,**越拖越糟**。我們得分頭去關,但每關一個就少一個救火位,還沒關的會繼續灌能量到最後爆掉。」

緊張感來源:**目標分散 + 倒數壓力 + 戰略選擇**(集中火力 vs 分散處理)。

#### 城主每回合 sequence

| # | 動作 | 類別 | 細節 |
|---|---|---|---|
| 1 | 進度施壓 — 每個未關閉目標放 1 個「毀滅標記」 | C | 自動,不耗行動點;標記達 N 個該目標升級成精英守護 |
| 2 | 召喚 — 從武器庫**選** 1 張 summon | A | 早期偏雜兵鋪陳、中期精英、後期(目標剩 1-2)召守護 |
| 3 | 環境惡化(Act 2 之後) — 選 1 張 environment | B | 對 1 個未關閉目標所在地施加環境效果(失火/異變/黑暗) |
| 4 | 敵人 AI 決策 | F | 雜兵朝最近目標、精英朝最近玩家、守護不離開目標地點 |

#### 玩家階段遭遇

進入「目標所在地」:觸發 1 張 encounter_pool,偏 `threat_type=ritual`,`encounter_type=thriller / discovery`。

#### 勝負條件

- 勝利:全部目標關閉 → main 旗標 flip
- 失敗:城主能量(= ⌊回合數 × 未關閉目標數 / 3⌋)達上限 → 強制啟用 epic 神話卡(末日召喚)

#### 反推內容

**神話卡 6-7 張**:
- summon × 3(雜兵 tier 1 reusable / 精英 tier 3 / 守護精英 tier 3-4 reusable cooldown 2)
- global × 1-2(毀滅標記放置 reusable / 標記達上限觸發升級)
- environment × 1(目標地環境惡化:失火/異變/黑暗 三選一)
- agenda × 1(Act 推進 + 能量累積條件)

**遭遇卡 4-6 張**(threat_type=ritual):
- thriller × 2-3(次元門異象 / 印記發光 / 儀式震波)
- discovery × 2-3(封印殘片 / 古卷碎頁 / 印記弱點線索)

**規則內建**:
- 「毀滅標記」每地點上限 / 觸發升級的數值公式
- 「城主能量」累積公式 + 觸達上限的 epic 召喚規則
- 怪物移動 AI(優先目標 vs 優先玩家 by keyword)

#### 校準項

- 動作 sequence 順序(進度施壓 → 召喚 → 環境惡化 → AI 移動)
- 「毀滅標記」「城主能量」是新引入概念,要不要正式定義
- environment 放 Act 2 才啟動 vs Act 1 就啟動

---

### 主軸 2 · 儀式打斷型(Ritual Interrupt)

#### 玩家視角

「邪教徒在某個地方做大儀式,**進度條每回合自己 +1**。完成 = 末日。我們得在進度條跑滿前殺進儀式核心,還要承受沿路守衛跟『儀式低語』削減心智。」

緊張感來源:**單一倒數計時器 + 守衛圍堵 + SAN 持續削減**。

#### 城主每回合 sequence

| # | 動作 | 類別 | 細節 |
|---|---|---|---|
| 1 | 進度推進 — 儀式進度 +1 | C | 自動,進度達 N(預設 8-10)= 失敗 |
| 2 | 召喚守衛 — 選 1 張 summon | A | 偏 tier 2-3 守衛,優先生成在儀式核心地點 |
| 3 | 儀式低語(Act 2 之後) — 選 1 張 status / global | E/C | 玩家當回合 SAN -1 / 棄 1 張手牌 / 強加迷亂狀態(reusable) |
| 4 | 敵人 AI | F | 守衛朝最近玩家逼近,核心地點守衛**不離開** |

#### 玩家階段遭遇

進入「儀式核心地點」:觸發 encounter_pool,偏 `threat_type=ritual` 或 `mental`;`encounter_type=puzzle`(解咒) / `thriller`(被守衛圍攻)。

#### 打斷機制(規則內建)

- 玩家在儀式核心地點花 X 行動點 + 智力檢定
- DC = 8 + 已推進進度
- 成功 → 進度 -1
- 失敗 → 進度 +1(被儀式反噬,可校準為「失敗無事」)
- Act 3 開放最終打斷:DC = 14 + 已推進進度,成功 → main 旗標 flip 勝利

#### 勝負條件

- 勝利:儀式進度歸 0 OR Act 3 最終打斷成功
- 失敗:儀式進度達 N

#### 反推內容

**神話卡 5-6 張**:
- summon × 2-3(中階守衛 tier 2 reusable / 儀式核心守衛 tier 3 / 召喚增援 reusable cooldown 2)
- global / status × 2(儀式低語 SAN -1 reusable / 儀式震波強加迷亂)
- agenda × 1(Act 推進 + 進度 +N 加速條件)

**遭遇卡 4-5 張**:
- puzzle × 2(咒語破解 / 法陣解構)— threat_type=ritual
- thriller × 2(守衛圍攻 / 儀式震波 SAN 衝擊)— threat_type=ritual / mental
- 可選 discovery × 1(發現儀式弱點)— threat_type=ritual

**規則內建**:
- 儀式進度公式(基礎 +1/回合 + Act 加速)
- 打斷檢定 DC 公式
- 進度反噬機制
- 「迷亂狀態」效果定義(連動既有狀態系統)

#### 校準項

- 「儀式低語」「儀式震波」是否正式定為神話卡名(目前佔位用)
- 進度反噬會不會太狠
- Act 推進條件具體判定

---

### 主軸 3 · 守護陣地型(Defend Position)

#### 玩家視角

「我們要守住這個地點 N 回合,等援軍/儀式完成。**敵潮一波接一波**,而且越後面越強。陣地外圍會逐漸黑暗、失火、視野受限。」

緊張感來源:**守住一點 + 敵潮升級 + 環境包圍**。

#### 城主每回合 sequence

| # | 動作 | 類別 | 細節 |
|---|---|---|---|
| 1 | 召喚敵潮 — 選 1-2 張 summon | A | 雜兵潮 reusable,每回合至少 1 張;Act 推進後升級 tier |
| 2 | 環境包圍(Act 2 之後) — 選 1 張 environment | B | 陣地外圍地點施加黑暗/失火/視野削減(reusable 擴散) |
| 3 | 敵潮升級觸發(Act 3 或第 5/10 回合) | A+C | 強制召喚 epic 增援(精英 + 1-2 雜兵) |
| 4 | 敵人 AI | F | 全部敵人朝陣地中心移動,優先攻陣地內玩家 |

#### 玩家階段遭遇

進入「陣地外圍地點」(若有):觸發 encounter_pool,偏 `threat_type=physical`(敵潮物理威脅) / `mental`(包圍恐懼);`encounter_type=thriller`(敵襲)/ `choice`(援軍選擇 / 工事選擇)。

#### 勝負條件

- 勝利:守滿 N 回合(Act 3 完成)→ main 旗標 flip
- 失敗:陣地中心被敵人佔領 / 全員陣亡

#### 反推內容

**神話卡 6-7 張**:
- summon × 4(雜兵潮 tier 1 reusable / 雜兵潮 tier 2 reusable / 精英增援 / 後波 epic 增援)
- environment × 2(陣地外圍黑暗 reusable 擴散 / 陣地外圍失火 reusable 擴散)
- agenda × 1(每 5 回合升級敵 tier)

**遭遇卡 4-5 張**:
- thriller × 3(敵潮突進 / 包圍幻覺 / 援軍延誤)— threat_type=physical / mental
- choice × 1-2(援軍選擇 / 工事修復取捨)— threat_type=physical

**規則內建**:
- 「敵潮升級」對應 Act / 回合的觸發條件
- 「陣地中心被佔領」判定條件(敵人數量達 N)
- 工事修復機制(連動素材消耗)

#### 校準項

- 敵潮數量上限(避免場上 20+ 怪卡頓)
- 援軍是否化為「玩家陣營 NPC」加入戰鬥
- 工事修復屬於「修復型互動」對應底層第 10 種

---

### 主軸 4 · 保護目標型(Protect Target)

#### 玩家視角

「有個脆弱目標(NPC / 神器 / 儀式進行中),HP 有限。城主**全力摧毀它**,每一波敵人都先打它,還會觸發環境效果傷它。我們得擋。」

緊張感來源:**目標 HP 持續流失 + 敵人鎖定目標 + 環境連帶傷害**。

#### 城主每回合 sequence

| # | 動作 | 類別 | 細節 |
|---|---|---|---|
| 1 | 召喚 — 選 1 張 summon | A | 雜兵/精英,**全部優先攻擊目標**(不攻玩家除非阻擋) |
| 2 | 目標受傷觸發負面事件 — 條件啟用 status | E | 目標 HP -1 = 玩家全員 SAN -1(同步減損 reusable) |
| 3 | 環境傷目標(Act 2 之後) — 選 environment | B | 火焰 / 毒氣 / 倒塌物對目標所在地造成持續 -1 HP |
| 4 | 敵人 AI | F | 全部敵人路徑優先朝目標,玩家擋路才停下攻玩家 |

#### 玩家階段遭遇

進入「目標所在地」 / 玩家行動「治療目標」:觸發 encounter_pool,偏 `threat_type=mental`(目標 SAN 連動) / `physical`(攻擊壓力);`encounter_type=thriller`(敵襲) / `social`(NPC 對話 / 目標求救)。

#### 勝負條件

- 勝利:撐到 main 旗標 flip(任務完成 / 援軍到達)
- 失敗:目標 HP 歸零

#### 反推內容

**神話卡 5-6 張**:
- summon × 3(優先攻目標的雜兵 reusable / 精英刺客 / 自爆雜兵 一次性)
- status × 1-2(目標傷害連動 SAN reusable / 目標瀕死強加恐慌)
- environment × 1(火焰擴散 / 毒氣擴散 持續傷目標 reusable)
- agenda × 1(每 N 回合目標 HP 自動 -1 — 持久壓力)

**遭遇卡 4-5 張**:
- thriller × 2(敵襲目標 / 環境效果反噬)— threat_type=physical
- social × 1-2(NPC 求救對話 / 目標傳授線索)— threat_type=mental
- choice × 1(救目標 vs 救戰友 取捨)— threat_type=mental

**規則內建**:
- 敵人 AI「優先攻目標」keyword
- 目標 HP 公式(基礎 N + 任務難度修正)
- 目標 SAN 同步連動規則

#### 校準項

- 目標 HP 起始值(預設 8-10)
- 「目標 HP 自動 -1」是不是太狠 — 也許改為「目標只有受到攻擊才扣」
- 目標被擊倒是否可復活(獻祭素材 / 玩家儀式 / 援軍救援)

---

### 主軸 5 · 逃離求生型(Escape)

#### 玩家視角

「這個地方要塌了/燒了/淹了。我們有 N 回合到出口。**走過的地點會崩塌不能回頭**,環境效果(火焰/水位)也會在地點間擴散追上我們。」

緊張感來源:**單向倒數 + 不可回頭 + 環境追擊**。

#### 城主每回合 sequence

| # | 動作 | 類別 | 細節 |
|---|---|---|---|
| 1 | 倒數推進 — 災難計時 -1 | C | 自動,歸零 = 失敗 |
| 2 | 地點崩塌 — 起始/經過地點 -1 行動容量 | B | 自動規則 + 強制環境神話卡(reusable) |
| 3 | 環境擴散 — 選 environment 卡 | B | 火焰/水位向相鄰未崩塌地點蔓延(reusable) |
| 4 | 召喚追兵 — 選 summon(數量隨倒數遞增) | A | 後期出現精英追兵 |
| 5 | 敵人 AI | F | 追兵朝離出口最遠的玩家追擊 |

#### 玩家階段遭遇

進入新地點 / 「地點崩塌」效果觸發時:遭遇 encounter_pool,偏 `threat_type=physical`(環境傷害) / `mental`(恐懼);`encounter_type=thriller`(險境)/ `choice`(路徑選擇)。

#### 勝負條件

- 勝利:全員(或 main 旗標規定的最少數)抵達出口
- 失敗:倒數歸零 / 全員陷在崩塌地點

#### 反推內容

**神話卡 5-6 張**:
- summon × 2(雜兵追兵 reusable / 精英追兵 後期啟用)
- environment × 3(火焰擴散 reusable / 水位上升 reusable / 崩塌擴大 reusable)
- agenda × 1(倒數加速 / 出口位置變更)

**遭遇卡 4-5 張**:
- thriller × 2-3(地面塌陷 / 火焰逼近 / 追兵突襲)— threat_type=physical
- choice × 2(路徑分岔 / 拋下夥伴 vs 同行)— threat_type=mental

**規則內建**:
- 「地點崩塌」單向移動規則
- 「環境擴散」相鄰地點蔓延邏輯
- 倒數計時與 Act 推進連動

#### 校準項

- 「拋下夥伴」抉擇是否觸發 SAN -X 強烈代價
- 倒數重置機制(找到救援路線是否能 +N 回合)
- 已崩塌地點是否仍可作為「捷徑」(冒險型互動代價穿越)

---

### 主軸 6 · 追擊狙殺型(Hunt)

#### 玩家視角

「有 1 個 Boss 在這個區域裡到處跑,**每回合移動到相鄰地點**。我們得追蹤它的痕跡,跟丟太久就失敗。它會階段轉換、有時還會召喚守衛阻擋我們。」

緊張感來源:**移動目標 + 痕跡有時效 + 階段轉換**。

#### 城主每回合 sequence

| # | 動作 | 類別 | 細節 |
|---|---|---|---|
| 1 | Boss 移動 — 規則內建 | F | Boss 隨機移動到相鄰地點,留下痕跡標記 |
| 2 | 痕跡消散 — 規則內建 | F | 每個痕跡標記倒數 -1,歸零自動消失;全消 = 失敗 |
| 3 | 召喚守衛 — 選 summon | A | 數量低,放在 Boss 當前/上一個地點 |
| 4 | Boss 階段轉換(HP 50%/25%) — 強制神話卡 | A+B | 觸發 epic 環境變化(地形改變/濃霧覆蓋/吼聲震懾) |
| 5 | 敵人 AI | F | 守衛朝最近玩家逼近,Boss 不主動攻玩家(除非被圍住) |

#### 玩家階段遭遇

進入「有痕跡的地點」:觸發 encounter_pool,偏 `threat_type=physical` / `ritual`;`encounter_type=discovery`(線索) / `social`(NPC 目擊情報)。

#### 勝負條件

- 勝利:Boss HP 歸零(可能多階段)
- 失敗:Boss 痕跡全消散(玩家追丟)

#### 反推內容

**神話卡 5-6 張**:
- summon × 2(Boss 守衛 tier 2 / 場景內雜兵 reusable)
- environment × 2(階段轉換霧氣覆蓋 一次性 / Boss 嚎叫震懾全員 SAN -1 reusable)
- narrative × 1(假痕跡誤導 — Boss 製造假線索 reusable)
- agenda × 1(Boss 移動加速 / 痕跡消散加速)

**遭遇卡 4-5 張**:
- discovery × 2-3(痕跡解讀 / 巢穴發現 / 殘骸線索)— threat_type=ritual / physical
- social × 1-2(NPC 目擊情報 / 受害者證詞)— threat_type=mental
- thriller × 1(Boss 突襲)— threat_type=physical

**規則內建**:
- Boss 移動 AI(隨機 vs 朝最少守衛地點)
- 痕跡消散規則(每痕跡獨立倒數)
- Boss 階段轉換 HP 觸發點

#### 校準項

- Boss 是否完全不攻擊(純逃)— 還是被圍住才反擊
- 痕跡消散倒數預設值(預設 3-4 回合)
- 「假痕跡」遊戲體驗是否會挫折玩家

---

### 主軸 7 · 真相揭露型(Truth Revelation)

#### 玩家視角

「我們得蒐集 N 個線索揭露真相。揭出真相會改變關卡規則(打開新區域 / 解鎖弱點)。**但城主在揭真相前會偷偷篡改未揭露的線索**,還會散播假線索誤導我們。」

緊張感來源:**訊息戰 + 假情報 + 時間壓力**。

#### 城主每回合 sequence

| # | 動作 | 類別 | 細節 |
|---|---|---|---|
| 1 | 篡改線索 — 選 narrative 卡 | D | 隨機 1 個未揭露線索變假 / 真假反轉(reusable) |
| 2 | 散播假線索 — 選 narrative 卡 | D | 場上新增 1 個「可疑線索點」(可能真可能假)(reusable cooldown 2) |
| 3 | NPC 對抗 — 選 status 卡 | E | 關鍵 NPC 變反派 / 給玩家假情報後消失 |
| 4 | 召喚不重點 — 選 summon(低頻) | A | 1-2 隻雜兵製造干擾 |

#### 玩家階段遭遇

進入「有線索點的地點」 / 玩家「驗證線索」行動:觸發 encounter_pool,偏 `threat_type=mental`(誤導);`encounter_type=discovery`(線索) / `social`(NPC 對話)。

#### 勝負條件

- 勝利:蒐集到至少 ⌈N×0.7⌉ 個真線索 → 揭真相 → main 旗標 flip
- 失敗:線索全被篡改 / 玩家依假線索做關鍵抉擇導致戰役失敗

#### 反推內容

**神話卡 5-6 張**:
- narrative × 3-4(篡改線索 reusable / 散播假線索 reusable cooldown 2 / NPC 變臉 / 規則微改)
- status × 1(玩家迷亂 reusable cooldown 3)
- summon × 1(干擾雜兵 reusable cooldown 2,低頻)
- agenda × 1(篡改加速 / 真相揭露時間限制)

**遭遇卡 5-6 張**:
- discovery × 3-4(線索解讀 / 真假驗證 / 關鍵物件揭露)— threat_type=ritual
- social × 2-3(NPC 對話 / 證人證詞 / 邪教滲透)— threat_type=mental
- 可選 puzzle × 1(密碼破解)— threat_type=ritual

**規則內建**:
- 線索的真假狀態(隱藏屬性)
- 「驗證線索」行動的檢定 DC
- 真相揭露對關卡規則的影響(打開新地點 / 解鎖 Boss 弱點)

#### 校準項

- 「線索被篡改」玩家會不會挫折(可改為「篡改後仍有跡象提示」)
- 假線索比例上限(避免全假變猜謎)
- 真相揭露的具體效果(改變什麼規則)

---

### 主軸 8 · 多階決戰型(Multi-Phase Boss)

#### 玩家視角

「這是 1 個會變身 N 次的 Boss。每階段不同攻擊模式、不同弱點、不同強制效果。**第三形態最強**,我們得在哪個階段消耗最多資源是戰略選擇。」

緊張感來源:**單怪戰但機制變化 + 階段轉換衝擊 + 後期高威脅**。

#### 城主每回合 sequence

| # | 動作 | 類別 | 細節 |
|---|---|---|---|
| 1 | Boss 行動(規則內建) | F | 依當前階段執行特定攻擊模式(攻最弱 / AOE / 召喚輔助等) |
| 2 | 階段轉換 — Boss HP 達 66% / 33% 強制神話卡 | A+B | 觸發階段專屬卡(epic 強度,通常 status + environment 連發) |
| 3 | 召喚輔助元素 — 選 summon | A | 場上產出可破壞元素(能量水晶 / 觸手等),破壞可削弱 Boss |
| 4 | 第三形態強壓 — 每回合選 1 張 epic | A+E | 第三形態時必選 1 張高威脅卡 |

#### 玩家階段遭遇

進入「Boss 戰場地點」 / 階段轉換時:觸發 encounter_pool,偏 `threat_type=physical / mental`;`encounter_type=thriller`(戰鬥變奏) / `trade`(消耗資源換戰力)。

#### 勝負條件

- 勝利:Boss HP 歸零(三階段累計)
- 失敗:全員陣亡 / SAN 全崩

#### 反推內容

**神話卡 6-7 張**:
- summon × 2(輔助元素 phase 1 / 觸手召喚 phase 2)
- status × 2(phase 2 玩家瘋狂 / phase 3 全員 -1 HP/回合 reusable)
- environment × 2(phase 1 地形變化 / phase 3 黑暗包圍 reusable)
- epic × 1-2(末日吼叫 phase 3 一次性 / 強制 SAN -3 phase 3)
- agenda × 1(階段轉換 HP 觸發判定)

**遭遇卡 4-5 張**:
- thriller × 3(戰鬥變奏 / 觸手揮擊 / Boss 怒吼)— threat_type=physical / mental
- trade × 1-2(獻祭素材換戰力 / 消耗卡換暴擊)— threat_type=ritual

**規則內建**:
- Boss 多階段 HP 區段定義
- 各階段攻擊模式 keyword
- 「輔助元素破壞 → Boss 削弱」連動規則

#### 校準項

- Boss HP 三階段分配(預設 33% / 33% / 34% 或 50% / 30% / 20%)
- 第三形態強度(會不會 TPK)
- 輔助元素破壞的削弱幅度

---

### 主軸 9 · 資源累積型(Resource Accumulation)

#### 玩家視角

「我們得累積 N 點特定資源(魔力石/淨化能量/禁忌知識)觸發勝利。**資源每回合自動 -1**,城主還會召喚怪攻擊我們的產出點。多種產出方式並行 vs 集中防守一點是戰略選擇。」

緊張感來源:**資源流失 + 產出點被攻擊 + 多路 vs 單路**。

#### 城主每回合 sequence

| # | 動作 | 類別 | 細節 |
|---|---|---|---|
| 1 | 資源池 -1(規則內建) | C | 自動,資源歸零 = 失敗 |
| 2 | 召喚產出點殺手 — 選 summon | A | 雜兵/精英,優先攻擊「產出點地點」 |
| 3 | 環境阻礙產出(Act 2 之後) — 選 environment | B | 失火/異變使產出點本回合無法產出(reusable) |
| 4 | 敵人 AI | F | 朝最近產出點逼近,優先攻擊產出點(若無玩家擋) |

#### 玩家階段遭遇

進入「產出點地點」 / 「採集 / 儀式 / 戰鬥」產出行動:觸發 encounter_pool,偏 `threat_type=physical / ritual`;`encounter_type=trade`(資源交易) / `choice`(產出方式選擇)。

#### 勝負條件

- 勝利:資源池達 N 點 → main 旗標 flip
- 失敗:資源池歸零 / 全員陣亡

#### 反推內容

**神話卡 5-6 張**:
- summon × 2(產出點殺手 reusable / 雜兵潮 reusable)
- global × 1-2(資源流失加速 reusable / 產出點癱瘓 cooldown 3)
- environment × 1(失火/異變阻礙產出 reusable)
- agenda × 1(資源衰減加速)

**遭遇卡 5-6 張**:
- trade × 2-3(資源交易 / 素材換能量 / 神祕商人)— threat_type=ritual
- choice × 2(產出方式選擇 / 防守 vs 進攻)— threat_type=physical
- thriller × 1-2(產出點突襲)— threat_type=physical

**規則內建**:
- 資源池累積/流失公式
- 產出點數量與位置(連動地點規範)
- 「產出方式」對應底層互動形式(採集型 / 儀式型 / 戰鬥型)

#### 校準項

- 資源池起始值與目標值(預設起始 3 / 目標 15)
- 「產出點癱瘓」對玩家的挫折感
- 多種產出方式是否平衡(避免某種 OP)

---

### 主軸 10 · 抉擇分歧型(Branching Choice)

#### 玩家視角

「這關有幾個關鍵抉擇點(救誰 / 信誰 / 走哪條路)。**每抉擇開啟不同分支**,規則跟劇情都會變。最終結局多分支,影響戰役級旗標。」

緊張感來源:**選擇焦慮 + 不可逆 + 戰役級影響**。

#### 城主每回合 sequence

| # | 動作 | 類別 | 細節 |
|---|---|---|---|
| 1 | 抉擇推進(規則內建) | C | Act 推進到關鍵節點時自動觸發抉擇對話 |
| 2 | 抉擇後規則改變 — 選 narrative + agenda | D | 依玩家選擇,啟用對應分支的規則修正卡 |
| 3 | 分支壓力 — 選 status / summon | A/E | 不同分支不同壓力(社交分支 NPC 對抗 / 戰鬥分支召怪) |
| 4 | NPC 動向 — 選 narrative | D | 關鍵 NPC 依分支表現不同態度 |
| 5 | 敵人 AI(若戰鬥分支) | F | 依分支調整 |

#### 玩家階段遭遇

抉擇點觸發時 / 進入分支獨立地點:觸發 encounter_pool,偏 `threat_type=mental`(抉擇焦慮);`encounter_type=choice`(劇情抉擇) / `social`(NPC 對話)。

#### 勝負條件

- 勝利:依分支抵達結局 A/B/C(可能多種勝利)
- 失敗:抉擇全錯導致戰役級 main 旗標 flip 為失敗結局

#### 反推內容

**神話卡 5-6 張**:
- narrative × 3-4(抉擇規則改變 / NPC 變態度 / 分支劇情干擾 reusable)
- status × 1(抉擇焦慮玩家迷亂 reusable cooldown 3)
- summon × 1(戰鬥分支才用)
- agenda × 1(抉擇節點觸發)

**遭遇卡 5-6 張**:
- choice × 3-4(劇情抉擇)— threat_type=mental
- social × 2-3(NPC 對話 / 信任建立 / 背叛揭露)— threat_type=mental
- 可選 trade × 1(用素材/卡換 NPC 好感)— threat_type=ritual

**規則內建**:
- 抉擇節點的觸發條件(連動 Act 推進)
- 抉擇結果對戰役級旗標的影響(連動 flag system)
- 分支地點的解鎖機制

#### 校準項

- 一關幾個抉擇節點(預設 3-5)
- 抉擇是否可重做(原則上不可,但能否「贖罪型」修補)
- 多結局數量(預設 3 種:好/中/壞)

---

## §4 神話卡庫總需求(從 10 主軸彙總)

### 4.1 共用基底卡(跨主軸通用,**只挑不建之前要先填這層**)

| Category | 數量 | 用途 |
|---|---|---|
| summon | 8-10 | 雜兵 tier 1 reusable / 雜兵 tier 2 reusable / 精英 tier 3 / 守護 tier 3-4 reusable / 追兵 / 增援 / 自爆雜兵 / 召喚輔助元素 / 後波 epic |
| environment | 5-6 | 失火擴散 reusable / 黑暗加深 reusable / 水位上升 reusable / 異變擴散 reusable / 地點崩塌 / 視野削減 |
| global | 4-5 | 毀滅標記放置 reusable / 資源流失加速 reusable / 倒數加速 / 規則微改 / 強制效果 |
| status | 4-5 | 玩家全員 SAN -1 reusable / 棄手牌 reusable / 強加迷亂 / 強加恐慌 / 目標連動傷害 |
| narrative | 4-5 | 篡改線索 reusable / 散播假線索 reusable / NPC 變臉 / 假痕跡誤導 / 規則改變 |
| agenda | 3-4 | Act 推進 / 進度加速 / 階段轉換觸發 / 衰減加速 |
| epic | 2-3 | 末日召喚 / 末日吼叫 / SAN -3 全員 |
| **小計** | **30-38 張** | 基底庫至少這個量才夠 10 主軸覆蓋 |

### 4.2 主軸專屬卡(關卡才產的劇情強綁定卡,**之後 pipeline 第 11 點實際要求是「只挑不建」**)

按第 11 點規範,神話卡只挑不建,所以 4.1 基底庫一旦填滿就不再增加。

但若某些主軸特別缺(例如「真相揭露型」needs narrative 多),可分批補建基底庫直到所有主軸都能挑到對應 category。

### 4.3 當前庫存對照(2026-05-02 盤點)

| Category | 當前 | 目標 4.1 | 缺口 |
|---|---|---|---|
| summon | 1 | 8-10 | -7 至 -9 |
| environment | 1 | 5-6 | -4 至 -5 |
| global | 1 | 4-5 | -3 至 -4 |
| status | 0 | 4-5 | -4 至 -5 |
| narrative | 0 | 4-5 | -4 至 -5 |
| agenda | 1 | 3-4 | -2 至 -3 |
| chaos_bag | 0 | (主軸需求外,後續評估) | — |
| cancel | 1 | (主軸需求外) | — |
| general | 10 | (可分配到上述 category) | — |
| epic | 0 | 2-3 | -2 至 -3 |
| **總缺口** | — | — | **-26 至 -34 張** |

10 張 general 可拆解後重歸類,實際需新建 16-24 張。

---

## §5 遭遇卡庫總需求(從 10 主軸彙總)

### 5.1 encounter_type × threat_type 矩陣(基底覆蓋目標)

行 = encounter_type,列 = threat_type,格內 = 建議基底卡數。

| | mental(精神) | physical(物質) | ritual(儀式) | 小計 |
|---|---|---|---|---|
| **thriller**(驚悚) | 3 | 4 | 3 | **10** |
| **discovery**(發現) | 2 | 2 | 4 | **8** |
| **choice**(抉擇) | 4 | 2 | 2 | **8** |
| **puzzle**(解謎) | 1 | 1 | 4 | **6** |
| **social**(社交) | 4 | 1 | 1 | **6** |
| **trade**(交易) | 1 | 2 | 3 | **6** |
| **小計** | **15** | **12** | **17** | **44** |

### 5.2 主軸對應映射(從 §3 反推)

| 主軸 | 偏好 encounter_type × threat_type |
|---|---|
| 1 多目標封印 | thriller×ritual / discovery×ritual |
| 2 儀式打斷 | puzzle×ritual / thriller×ritual+mental |
| 3 守護陣地 | thriller×physical+mental / choice×physical |
| 4 保護目標 | thriller×physical / social×mental / choice×mental |
| 5 逃離求生 | thriller×physical / choice×mental |
| 6 追擊狙殺 | discovery×ritual+physical / social×mental / thriller×physical |
| 7 真相揭露 | discovery×ritual / social×mental / puzzle×ritual |
| 8 多階決戰 | thriller×physical+mental / trade×ritual |
| 9 資源累積 | trade×ritual / choice×physical / thriller×physical |
| 10 抉擇分歧 | choice×mental / social×mental / trade×ritual |

### 5.3 當前庫存對照(2026-05-02 盤點)

| encounter_type | 當前 | 目標 5.1 | 缺口 |
|---|---|---|---|
| thriller | 4 | 10 | -6 |
| discovery | 0 | 8 | -8 |
| choice | 3 | 8 | -5 |
| puzzle | 0 | 6 | -6 |
| social | 0 | 6 | -6 |
| trade | 0 | 6 | -6 |
| **總缺口** | **7** | **44** | **-37 張** |

threat_type 維度的缺口要等 5.1 矩陣展開後才能精算,但因目前 7 張全為 NULL threat_type(MIGRATION_022 之前建的),也要回填。

---

## §6 規則內建 vs 卡片驅動分界(總表)

| 動作 | 規則內建 | 卡片驅動 |
|---|---|---|
| 進度條 +1(主軸 1/2/9) | ✓ | — |
| 倒數 -1(主軸 5) | ✓ | — |
| 資源池 ±N(主軸 9) | ✓(自動衰減) | ✓(額外加速用 global 卡) |
| 召喚怪 | — | ✓(summon 卡) |
| 環境變化 | ✓(地點崩塌等規則) | ✓(environment 卡升級/擴散) |
| 玩家狀態 | — | ✓(status 卡) |
| 敵人移動 AI | ✓ | — |
| Boss 移動 / 階段轉換 | ✓(觸發點 HP) | ✓(階段觸發專屬神話卡) |
| 線索篡改 | — | ✓(narrative 卡) |
| 抉擇結果 flip 旗標 | ✓ | ✓(後續規則改變用 narrative 卡) |
| 遭遇觸發 | ✓(玩家動作觸發) | — |
| 遭遇卡執行 | — | ✓(encounter 卡選項+結果) |

---

## §7 神話卡 schema 變更需求(待 migration)

當前 `mythos_cards` 表欄位:code / name / description / action_cost / activation_timing / card_category / intensity_tag / response_trigger / flavor_text / art_url / design_notes / design_status

**缺以下欄位**(配合 open hand 模型):

```sql
ALTER TABLE mythos_cards
  ADD COLUMN reusable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cooldown_rounds INTEGER,
  ADD COLUMN max_uses_per_stage INTEGER,
  ADD COLUMN axis_tag VARCHAR(32);  -- 對應主軸 1-10 的標記(可多選 JSONB)
```

`stage_mythos_pool.weight` 語意改:不是「抽到機率」,改為「**啟用優先建議順序**」(UI 提示用,規則上城主可任選,不影響可選性)。

---

## §8 校準項清單(待 Uria 拍板)

### 跨主軸共通

1. **action_cost 預設區間** — 各 category 的 action_cost 下限/上限(連動 game_balance_settings 平衡)
2. **reusable / cooldown 的預設規則** — 哪些 category 預設 reusable(目前我建議 environment 多 reusable、summon 雜兵 reusable、epic 一次性)
3. **「每回合城主選 N 張」的 N 值** — 跟 keeper_action_base_difficulty 連動,但 N 預設多少
4. **玩家可見性 UI** — 神話卡攤開後玩家可看到全部卡名 + flavor_text 嗎?還是只能看「卡背 + 強度標籤」?

### 各主軸校準項彙總(已散在 §3 各主軸)

- 主軸 1:「毀滅標記」「城主能量」是否正式定義
- 主軸 2:進度反噬機制是否太狠
- 主軸 3:敵潮數量上限、援軍化為 NPC 加入戰鬥
- 主軸 4:目標 HP 自動 -1 是否太狠、目標復活機制
- 主軸 5:「拋下夥伴」抉擇 SAN 代價、已崩塌地點作為捷徑
- 主軸 6:Boss 是否完全不攻擊、假痕跡挫折感
- 主軸 7:篡改後線索的提示機制、假線索比例上限
- 主軸 8:Boss HP 三階段分配、第三形態 TPK 風險
- 主軸 9:產出點癱瘓挫折感、多種產出方式平衡
- 主軸 10:每關抉擇節點數量、抉擇是否可贖罪修補

### 內容生成優先級

- **Phase A**(必須):基底神話卡 30-38 張(§4.1)+ 基底遭遇卡 44 張(§5.1)
- **Phase B**(後續):補主軸 1-10 的「主軸關鍵卡」epic 等
- **Phase C**(設計準則):每張卡的 V 表、敘述語法、效果動詞 — 屬下一份規範主檔範圍

---

# 文件結束
