# 測試關卡 — ACT / AGENDA / 勝負判別(Opus 判讀用)

> 產出日期:2026-06-30(v2 修正版:更正 AGENDA2 潮汐的「生成」分支誤解)
> 用途:**調查員 AI 改良**判讀用。本文 = 「這關到底要怎樣才贏 / 怎樣會輸」的完整規則快照。
> **資料來源**:ACT/AGENDA/boss/地點皆為 **2026-06-30 線上 prod DB 即時拉取**(非 backfill 腳本推測);判別邏輯為引擎原始碼 `packages/shared/src/game/gameProgress.ts`,並已追讀呼叫端 `TestScenarioScreen.tsx` 的勝負落地流程。

---

## 1. 關卡身份

| 項目 | 值 |
|------|----|
| 戰役 | 裂嘴女的傳說(`g_slit_mouth_legend`) |
| 關卡 stage_id | `9ad171b3-c439-4049-b673-b929f91366ce` |
| 關卡名(線上) | **雨夜的真相** |
| 場景數 | 2(場景1 巷弄調查 → 場景2 雨夜暗巷對決) |
| 結構 | 2 張幕卡(ACT)+ 3 張議程卡(AGENDA),雙軌賽跑 |

---

## 2. 一句話勝負(先講結論)

**調查員湊滿線索(ACT1)→ 把裂嘴女拉上台 → 殺死她(ACT2)→ 當場勝利、關卡結束。**

殺死裂嘴女的那一刻關卡就贏了並結束,**沒有「死後復活」這回事**(見 §5.5 引擎流程證明)。

---

## 3. 勝負判別引擎(`gameProgress.ts` → `progressTick`)

每次狀態變化後呼叫 `progressTick`,**同一 tick 內先跑 ACT 軌(`:186`)、再跑 AGENDA 軌(`:237`)**:

- **幕(ACT)= 調查員進度軌**:`front_advance_condition` 達成 → 翻面執行背面 → `back_resolution_code === 'stage_complete'` → **`victory = true`**。
- **議程(AGENDA)= 城主毀滅軌**:毀滅標記 `agendaProgress` ≥ 當前議程門檻 → 翻面結算 `back_penalties`,毀滅扣門檻進下一張 → penalty `investigators_defeated` → **`defeat = true`**。
- 呼叫端 `applyProgress`(`TestScenarioScreen.tsx:554`):`tick.victory || tick.defeat` 任一為真 → `evaluateOutcome` → 設結局畫面、關卡結束。

> 另有獨立全滅判定 `allInvestigatorsDown`:與議程軌無關,所有調查員 **HP ≤ 0 或 SAN ≤ 0**(每人任一歸零即倒)。

---

## 4. ACT 幕卡(調查員勝利軌)— 線上現況

| # | 名稱 | 推進條件 | 翻面背面 | resolution |
|---|------|---------|---------|-----------|
| **1** | 牆上的真相 | `clue_threshold` **count = 2**(實際需求 = 2 × 人數;達標時**扣除**該量) | ① 切到場景2 ② 在磚牆盡頭生成深潛者裂嘴女 | null(不結束關卡) |
| **2** | 終結傳說 | `enemy_defeated` **G1_deep_one_slit_mouth**(boss HP ≤ 0) | 寫旗標 `outcome.victory=true` | **`stage_complete` → 勝利** |

**ACT 要點:**
- **線索人數縮放**:需求 = count × `max(1,人數)`。**單人 2 條;3 人隊伍(1 玩家＋2 AI)= 6 條**——你說的「湊齊六個線索」就是 3 人隊伍下的 ACT1 門檻,與資料 count=2 一致。
- **線索是花掉不是累積**:ACT1 翻面時 `objectiveProgress -= 需求量`(`progressTick:191-195`)。
- ACT1 推進**不結束關卡**,只把戰場推到場景2 並把 boss 放上台;唯一勝利出口 = **ACT2 殺死裂嘴女**。

---

## 5. AGENDA 議程卡(城主毀滅軌)— 線上現況

| # | 名稱 | 毀滅門檻 | 翻面背面懲罰 | resolution |
|---|------|---------|-------------|-----------|
| **1** | 滂沱 | **4** | `heavy_rain` → 全域移動成本 +1(持續) | null |
| **2** | 潮汐 | **4** | `enemy_regen_or_spawn`(見下) | null |
| **3** | 包圍 | **6** | `investigators_defeated` | **失敗** |

**累計毀滅門檻 = 4 + 4 + 6 = 14** → 毀滅標記累積到 14,AGENDA3「包圍」翻面 → 全隊失敗。

### 5.1 潮汐(AGENDA2)正解 —— `enemy_regen_or_spawn`

翻面**一次性**結算(規則書 ch2 §2.3「翻面結算背面效果」,非每回合),依裂嘴女**當下是否在場**二擇一:

| 情境 | 動作 |
|------|------|
| 裂嘴女**在場且存活**(= 戰鬥中) | 一次性**回血**,量 = 場上「非裂嘴女」活怪數(`per_other_enemy`),封頂她的最大 HP |
| 裂嘴女**尚未登場**(= 還在 ACT1 線索階段,boss 只在 ACT1 翻面才生成) | 把她**生成出場**在磚牆盡頭(潮水提早把她帶來,當額外壓力) |

> **「生成」分支服務的是「她還沒出現」,不是「她死了」**。因為殺死她 = ACT2 達標 = 即時勝利 = 關卡結束(§5.5),不存在「死後還能被潮汐生回來」的時間窗。先前 v1 把這分支誤寫成「死後復活/最陰險反制」,**為錯誤,已更正**。

### 5.5 為何「殺死 = 結束、無復活窗」(引擎流程證明)

1. `progressTick` 同一 tick **ACT 軌先於 AGENDA 軌**。
2. 裂嘴女 HP 歸 0 的那一 tick,ACT2 的 `enemy_defeated` 立刻成立 → ACT2 翻面 → `victory=true`。
3. 呼叫端 `applyProgress` 看到 `tick.victory` → 設結局、關卡結束。
4. 即使同 tick AGENDA 軌也想跑潮汐生成,`victory` 已定、關卡已收;玩家不會再回到一個「boss 復活、繼續打」的局面。

---

## 6. 勝負條件總表

- **勝利(唯一路徑)**:湊線索 → ACT1 推進(切場景2＋生 boss)→ 殺死裂嘴女 → ACT2 `stage_complete`。
- **失敗 A(議程軌)**:毀滅累積到 **14**(4+4+6)→ AGENDA3 翻面 → `investigators_defeated`。
- **失敗 B(全滅軌,獨立)**:全體調查員 HP≤0 或 SAN≤0(`allInvestigatorsDown`)。
- **結局文本**:`evaluateOutcome` 依 `chapter_outcomes` 的 `flag_check` 取文本。**線上此關 stage 層 `chapter_outcomes` 為空** → victory/defeat 訊號照常觸發,但**無對應結局敘事文字(待補資料洞)**。

---

## 7. 與舊 backfill 腳本的差異(honesty 標註)

本文為線上即時拉取。對照 `scripts/g1-sandbox/backfill-slit-act-agenda.mjs`(2026-05),線上已被後續調校覆蓋:

| 項目 | backfill(舊) | 線上現況 |
|------|--------------|---------|
| AGENDA2 潮汐 penalty | `enemy_regen`(只回血) | `enemy_regen_or_spawn`(在場回血 / 未登場才生成) |
| AGENDA2 回血量 | 固定 1 | `per_other_enemy`(場上其他活怪數) |
| AGENDA3 包圍 門檻 | 4 | **6** |
| AGENDA1 滂沱 門檻 | 4 | 4(記憶曾記「4→2」,**線上未套用**,以線上為準) |

---

## 8. Boss 與地點參照(判難度用)

### 深潛者裂嘴女(ACT2 勝利目標)
| HP | HP/人 | 防禦 DC | 物理傷害 | 恐怖傷害 | tier |
|----|------|---------|---------|---------|------|
| **23** | 0 | **20** | 4 | 0 | 3 |

> DC 20 = d20 刻度高門檻;這是 `planTurn` 用中位骰會把 boss 攻擊模擬成 miss、需 `FIRST_STEP_BIAS` 補償的根源。HP 23 不隨人數縮放。

### 地點 shroud(調查 DC)
| 場景 | 地點 | shroud |
|------|------|--------|
| 共用 | miskatonic_library / innsmouth_pier / arkham_downtown | 13 / 12 / 12 |
| 1 | g_slit_mouth_loc_dark_alley / street_corner | 13 / 11 |
| 2 | g_slit_mouth_loc_brick_wall(boss 出生點) | 14 |

---

## 9. Opus 判讀速記

- **這是一場賽跑**:調查員軌(湊線索 → 殺 boss)vs 城主毀滅軌(累積到 14)。
- **AI 目標切換點**:ACT1 階段 `deriveObjective` 回 `clues`(target = 2×人數),達標後線索零價值;ACT2 階段回 `kill`(集火 boss)。
- **潮汐(AGENDA2)對 AI 的真實影響**:**戰鬥中**若場上還有雜兵,潮汐翻面會讓裂嘴女回血(回血量=雜兵數)→ AI 改良要權衡「先清雜兵壓低潮汐回血」vs「速殺 boss 趕在潮汐翻面前」。(注意:這是回血,不是復活。)
- **DC 20 boss**:命中率低,AI 需靠武器＋投入＋combo 疊修正,徒手幾乎打不動。
