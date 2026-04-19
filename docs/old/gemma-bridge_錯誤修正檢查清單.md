# gemma-bridge 六份文件錯誤修正檢查清單
## Error Correction Checklist for gemma-bridge Delivery

> **給 Claude Code：** 以下清單是上游設計者（Claude Opus）產出的六份文件（01–06）中，與既有專案規範不符的錯誤。請依序檢查並修正已建置的 `gemma-bridge` 模組與五份 Prompt 檔案。
>
> **原始文件對應：**
> - 文件 01：`01_Ollama_Gemma4_安裝指南.md`（使用者執行，不需修改）
> - 文件 02：`02_gemma-bridge_Claude_Code_指令書.md`（已建置為 `gemma-bridge/`，需修正）
> - 文件 03：`03_使用Prompt範本與測試清單.md`（使用者文件，不需修改程式碼）
> - 文件 04：卡片設計 Prompt → `gemma-bridge/prompts/card_design.md`
> - 文件 05：天賦樹 / 敵人 / 場景 Prompt → `gemma-bridge/prompts/talent_tree.md`、`enemy_design.md`、`scenario_design.md`
> - 文件 06：Combo Prompt → `gemma-bridge/prompts/combo_design.md`
>
> **權威文件（修正依據）：** 規則書 v1.0 六章、卡片價值計算規範 v1.1 修正案、怪物家族設計草案 v2、克蘇魯神話專有名詞對照表 v0.1、資料庫結構設計 v0.1、支柱一陣營與構築、支柱五成長子系統、狀態紀錄 26041801。

---

# 一、架構層級錯誤（最高優先）

## 錯誤 A-1：Gemini API 呼叫方式違反既定架構

**錯誤內容：**
文件 02 設計 gemma-bridge 為「後端 Node.js 服務從 `.env` 讀取 `GEMINI_API_KEY`，在伺服器端呼叫 Gemini」。

**違反依據：**
狀態紀錄 26041801 §4.1 明確記載：「從 MOD-01 卡片設計器起一貫使用」的架構是「**Gemini API 為前端直接呼叫**，API Key 儲存於 `localStorage`，key 名稱：`gemini_api_key`」。

**既定的 Gemini 呼叫端點：**
`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`

**修正方向：**
gemma-bridge 作為「無瀏覽器批次任務」的執行器，屬於既定架構的**合理例外**。但應在程式註解與 README 明確標註：
- 這是針對無頭批次任務的特殊路徑
- 正常的設計器 UI 仍沿用前端直呼
- 兩條路徑共存，不互相取代

**需做的事：**
1. 在 `gemma-bridge/README.md` 新增「架構偏離說明」段落
2. `geminiClient.ts` 的註解中強調這是例外情境
3. 保留目前的 `.env` 架構（因為確實無法在 Node.js 裡用 localStorage），但文件 02 原文的「這就是標準做法」表述要更正

---

# 二、陣營系統錯誤（嚴重）

## 錯誤 B-1：`faction` 代碼完全錯誤

**錯誤內容：**
文件 04（`card_design.md`）與文件 06（`combo_design.md`）的範例 JSON 中，`faction` 欄位使用：
- `explorer`（探險家）
- `scholar`（學者）
- `fighter`（戰士）
- `rogue`（盜賊）
- `survivor`（生還者）
- `mystic`（神秘學家）
- `guardian`（守護者）
- `neutral`（中立）

**違反依據：**
支柱一《陣營與構築》v0.1 明確定義「八陣營極體系」，採用 MBTI 四個維度。代碼為**單一字母**：

| 代碼 | 中文 | 英文 |
|------|------|------|
| `E` | 號令 | The Herald |
| `I` | 深淵 | The Abyss |
| `S` | 鐵證 | The Witness |
| `N` | 天啟 | The Oracle |
| `T` | 解析 | The Cipher |
| `F` | 聖燼 | The Ember |
| `J` | 鐵壁 | The Bastion |
| `P` | 流影 | The Flux |

中立卡使用 `neutral` 或對應 Schema 的處理方式（`faction_id = NULL`）。

**修正動作：**
1. 修改 `gemma-bridge/prompts/card_design.md`：
   - 所有範例卡片的 `faction` 欄位改為 `E / I / S / N / T / F / J / neutral` 其中之一
   - 在 Prompt 的「陣營說明」段落加入八陣營極的完整對照表（參見支柱一 §1.2）
   - 移除錯誤的「陣營風格」段落，改為正確的「八陣營主題關鍵字」：
     * E 號令：社交、共享、NPC 加成
     * I 深淵：孤獨、牌庫操控、自我增幅
     * S 鐵證：裝備、搜索、物理
     * N 天啟：混沌袋操控、預知、神秘學
     * T 解析:弱點揭露、數據、重擲
     * F 聖燼：治療、犧牲、信念
     * J 鐵壁：傷害減免、秩序、防禦
     * P 流影：反應、棄牌回收、隨機

2. 修改 `gemma-bridge/prompts/combo_design.md`：
   - 範例卡片的 `faction` 同上修正
   - 移除錯誤的「陣營 Combo 風格」表格，依上列八陣營重寫

3. 修改 `gemma-bridge/prompts/talent_tree.md`：
   - 範例 `faction_code: "explorer"` 改為 `"E"`（或其他合法代碼）
   - 移除錯誤的陣營清單對照

4. 修改 `gemma-bridge/src/schemas/cardSchema.ts`：
   - `faction` 欄位的 enum 限定為 `["E", "I", "S", "N", "T", "F", "J", "neutral"]`

---

## 錯誤 B-2：陣營主屬性對應

**參考依據：** 支柱五 §1.2 修正版（已在狀態紀錄 26041801 確認）：

| 陣營 | 主屬性 |
|------|--------|
| E 號令 | 魅力 (charisma) |
| I 深淵 | 智力 (intellect) |
| S 鐵證 | 感知 (perception) |
| N 天啟 | 意志 (willpower) |
| T 解析 | 智力 (intellect) |
| F 聖燼 | **力量 (strength)** — 這是修正後的正確值（原錯誤版為意志） |
| J 鐵壁 | 體質 (constitution) |
| P 流影 | 敏捷 (agility) |

**修正動作：**
- 若 Prompt 中有提及陣營與屬性的關聯（特別是 `talent_tree.md` 的 `attribute_boost` 範例），必須使用上表對應關係。

---

# 三、稀有度與代碼錯誤

## 錯誤 C-1：稀有度代碼「pocket」

**錯誤內容：**
文件 04 稀有度表使用：
```
pocket / basic / standard / advanced / rare / legendary
```

**違反依據：**
卡片價值計算規範 v1.1 §5 稀有度反推表確實使用 `pocket`，但需要對照資料庫 Schema 的實際 enum 定義。規則書第一章 §7.4 列出的稀有度中文名為「隨身 / 基礎 / 標準 / 進階 / 稀有 / 傳奇」。

**修正動作：**
1. Claude Code 請**自行檢查資料庫 Schema**（`packages/server/` 或 migration 檔案）中 `card_definitions` 表的 `rarity` 欄位實際使用的 enum 值是什麼
2. 以**實際 Schema 為準**修正 `prompts/card_design.md` 的稀有度代碼
3. 同步修正 `src/schemas/cardSchema.ts` 的 `rarity` enum

---

## 錯誤 C-2：等級抵扣數值過時

**錯誤內容：**
文件 04 列出的等級抵扣：
```
LV0 | 0
LV1 | -0.5V
LV2 | -1V
...
```

**違反依據：**
卡片價值計算規範 v1.1 §6「等級抵扣（不變）」：

| 等級 | 抵扣 |
|------|------|
| LV0 | 0 |
| LV1 | -1V |
| LV2 | -2V |
| LV3 | -3V |
| LV4 | -4V |
| LV5 | -5V |

我在文件 04 中誤寫為 -0.5V 遞增。

**修正動作：**
修正 `gemma-bridge/prompts/card_design.md` 的等級抵扣表，改為上列 v1.1 的正確數值。

---

## 錯誤 C-3：資產卡換算比例

**錯誤內容：**
文件 04 註記「資產卡 1:1 比例」可能與原規則書 v1.0 第三章的 2:1 混淆。

**違反依據：**
卡片價值計算規範 v1.1 §3.1 明確：**資產卡比例已從 2:1 改為 1:1**。這是 v1.1 最重大的變更。

**修正動作：**
確認 `gemma-bridge/prompts/card_design.md` 的資產卡費用公式為：
```
費用 = 效果價值 - 1V（行動點成本）- 1V（留場修正）- 等級抵扣 - 稀有度抵扣 - 負面副作用
```
（**沒有 ÷2**）

---

# 四、敵人與家族系統錯誤

## 錯誤 D-1：家族清單不完整

**錯誤內容：**
文件 05（`enemy_design.md`）列出的家族清單僅 7 組神話家族 + 3 組通用分類 = 10 組，但其中細節有疏漏。

**違反依據：**
依據《怪物家族設計草案 v2》與克蘇魯神話專有名詞對照表 v0.1 §6，**完整的 10 組家族代碼**為：

| 代碼 | 中文 | 類型 |
|------|------|------|
| `house_cthulhu` | 克蘇魯眷族 | 神話家族 |
| `house_hastur` | 哈斯塔眷族 | 神話家族 |
| `house_shub` | 莎布·尼古拉絲眷族 | 神話家族 |
| `house_nyarlathotep` | 奈亞拉托提普眷族 | 神話家族 |
| `house_yog` | 猶格·索托斯眷族 | 神話家族 |
| `house_cthugha` | 克圖格亞眷族 | 神話家族 |
| `house_yig` | 伊格眷族 | 神話家族 |
| `fallen` | 凡人墮落者 | 通用 |
| `undying` | 亡者回響 | 通用 |
| `independent` | 獨立存在 | 通用 |

**預留未來擴充：** `house_tsathoggua`、`house_shudde_mell`、`house_nodens`（目前 Schema 不需包含）

**修正動作：**
1. 修改 `gemma-bridge/prompts/enemy_design.md` 的家族清單表，補齊上述 10 組
2. 修改 `src/schemas/enemySchema.ts` 的 `family_code` enum

---

## 錯誤 D-2：家族戰鬥特色對照表可能簡化過頭

**錯誤內容：**
文件 05 的「家族戰鬥特色」表可能與怪物家族設計草案 v2 細節不符。

**修正動作：**
Claude Code 請以《怪物家族設計草案 v2》的完整規格為準，重新核對每個家族的：
- 攻擊元素
- 傷害偏重
- 弱點 / 抗性 / 免疫
- 施放的負面狀態（頻率）
- 使用的正面狀態
- 狀態免疫
- AI 偏好
- 恐懼特色

若 `enemy_design.md` 的對照表有簡化或遺漏，以草案 v2 為準補齊。

---

## 錯誤 D-3：位階代碼英文名稱

**錯誤內容：**
文件 05 位階表使用：
```
minion / threat / elite / boss / titan
```

**違反依據：**
規則書第一章 §7.2 與資料庫 Schema 使用的正是這五個代碼，**此項正確**。但需確認對應的中文名：

| 代碼 | 中文 |
|------|------|
| `minion` | 雜兵 |
| `threat` | 威脅 |
| `elite` | 精英 |
| `boss` | 頭目 |
| `titan` | 巨頭 |

**修正動作：**
確認 Prompt 中沒有把「精英」寫成「菁英」等變體寫法。

---

## 錯誤 D-4：ENEMY_TIERS DC 值

**錯誤內容：**
文件 05 可能引用了舊版 DC 值（8/12/16/20/24）。

**違反依據：**
規則書第六章 §5.1 明確：**DC 全面 +4**，正確值為：

| 位階 | DC |
|------|-----|
| `minion` | 12 |
| `threat` | 16 |
| `elite` | 20 |
| `boss` | 24 |
| `titan` | 28 |

狀態紀錄 26041801 §7.4 亦記載 `admin-shared.js` 中 `ENEMY_TIERS` 的 DC 需全面 +4，此修正**尚未套用**。

**修正動作：**
1. Claude Code 請**自行檢查** `admin-shared.js` 中 `ENEMY_TIERS` 的 DC 值是否已修正
2. 若未修正，此不屬於 gemma-bridge 的職責範圍，**不應修改**，但應在 `enemy_design.md` 的 Prompt 中使用正確的 DC 值（12/16/20/24/28）
3. 若 Claude Code 發現這應該是 MOD-03 或 MOD-11 建置時的任務，請記錄但不修改

---

# 五、場景層級術語錯誤

## 錯誤 E-1：Stage 與 Scenario 混用

**錯誤內容：**
文件 02、03、05 中，我用 `scenario_design` 作為 taskType 名稱，但處理的實際上是規則書定義的 **Stage（關卡）**。

**違反依據：**
規則書第五章 §1.1 的層級明確：

```
戰役（Campaign）
  └ 章節（Chapter）
      └ 關卡（Stage）← 這是日常設計的主要單元
          └ 場景（Scenario）← 是 Stage 內的子空間
```

Stage 與 Scenario 是**兩個不同層級**，不能混用。

**修正動作：**
1. Claude Code 請**自行判斷**：gemma-bridge 應該支援什麼層級的產出？
   - 僅支援 `stage_design`（最常用）
   - 僅支援 `scenario_design`（細部）
   - 兩者都支援

2. 根據判斷結果：
   - 若只保留一種：修正 `prompts/scenario_design.md` 的內容、檔名、對應 taskType 枚舉
   - 若兩種都要：新增 `prompts/stage_design.md`，並在 `types.ts` 的 `TaskType` 加入對應項

3. Admin API 的對應 endpoint 同步修正：
   - 實際 API endpoint 名稱應查 MOD-06（戰役管理）與 MOD-07（關卡編輯器）的規格文件
   - MOD-07 尚未建置，endpoint 可能不存在——gemma-bridge 應先保留抽象接口，實際路徑以 Claude Code 判斷的合理方向命名

---

## 錯誤 E-2：目標牌堆與議程牌堆術語

**錯誤內容：**
文件 05 的 `scenario_design.md` Prompt 使用了術語 `act_deck` 與 `agenda_deck`。

**違反依據：**
規則書第五章 §2 使用「目標牌堆（ACT）」與「議程牌堆（Agenda）」這兩個中文名，而程式代碼保留 `act` / `agenda`。資料庫 Schema 中的表名為 `act_cards` 與 `agenda_cards`。

**修正動作：**
此處**正確**，但 Prompt 中的中文敘述應使用「目標牌堆」而非「行動牌堆」、「議程牌堆」而非「倒數牌堆」。檢查 Prompt 中所有中文出現的地方。

---

# 六、資料庫 Schema 對應錯誤

## 錯誤 F-1：Admin API endpoint 路徑猜測

**錯誤內容：**
文件 02 第十部分的 `ENDPOINT_MAP` 我自行猜測：

```typescript
const ENDPOINT_MAP = {
  card_design: '/api/cards',
  talent_tree: '/api/talent-tree/nodes',
  enemy_design: '/api/monster-variants',
  scenario_design: '/api/scenarios',
  combo_design: '/api/cards',
};
```

**問題：**
這些路徑是我**自行推測**，**實際可能與 MOD-01 / MOD-02 / MOD-03 指令文件建置的路徑不符**。

**修正動作：**
Claude Code 請**自行讀取以下模組的指令文件**，查出真實的 API endpoint：
- MOD-01 卡片設計器（5 份舊指令）
- MOD-02 天賦樹設計器（3 份指令）
- MOD-03 敵人設計器（3 份指令，`Part1.md` 有後端 API 定義）
- MOD-11 調查員設計器（若有卡片相關 endpoint）

若實際 endpoint 與 gemma-bridge 的 `ENDPOINT_MAP` 不符，以實際為準修正。

---

## 錯誤 F-2：`commit_icons` vs `attribute_modifiers` 分離

**此處沒錯誤，但要確保強化：**
文件 04 已強調這是「高風險分離點」，正確。

**修正動作：**
Claude Code 請**加強驗證**：
1. `src/schemas/cardSchema.ts` 中，`commit_icons` 與 `attribute_modifiers` 必須是**獨立欄位**
2. Validator 應該主動檢查：若兩者有任一屬性值重複且等值，發出警告（可能是 LLM 混淆）
3. 測試案例中加入「反例」（刻意混用）確認 validator 會拒絕

---

# 七、克蘇魯譯名錯誤

## 錯誤 G-1：部分神話生物譯名可能錯誤

**錯誤內容：**
文件 04 的「克蘇魯譯名對照」表中，可能有譯名與台灣慣用不符。

**修正動作：**
Claude Code 請以《克蘇魯神話專有名詞對照表 v0.1》為**絕對權威**，檢查 Prompt 中出現的所有克蘇魯專有名詞：
- 外神 10 項
- 舊日支配者 28 項
- 神話生物 36 項
- 地名 10 項
- 典籍 6 項

特別注意易錯點（對照表已標註）：
- Dagon → **達貢**（非「大袞」）
- Tsathoggua → **札特瓜**（非「撒托古亞」）
- Miskatonic → **密斯卡塔尼克**（非「米斯卡塔尼克」）

---

# 八、三合一用途系統細節

## 錯誤 H-1：消費效果的固定成本

**此處 Prompt 內容正確，但需要確認實作：**
文件 04 已寫：「消費效果的固定成本 = 1 行動點（1V）+ 棄 1 手牌（0.5V）= 1.5V」——此為規則書第三章 §4.1 的原文，正確。

**修正動作：**
Claude Code 的 Validator 應主動檢查：
- `consume_effects[].value` 必須 > 1.5V
- `consume_effects[].value` 必須 ≤ 對應稀有度的消費效果上限

若 Prompt 產出違反此規則的卡片，validator 應拒絕並觸發重試。

---

## 錯誤 H-2：稀有度反推只看打出效果

**此處 Prompt 內容正確，但需要確認實作：**

**修正動作：**
Validator 檢查邏輯：
1. 計算 `play_effect` 的效果價值
2. 查稀有度反推表，得出應該的稀有度
3. 與卡片 JSON 中宣告的 `rarity` 比對
4. 不符則拒絕並觸發重試
5. `consume_effects` 的價值**不計入**稀有度反推

---

# 九、天賦樹結構錯誤

## 錯誤 I-1：天賦樹 12 級結構細節

**錯誤內容：**
文件 05 的 `talent_tree.md` 列出 12 級結構，但某些細節可能與支柱五 v0.1 不符。

**違反依據：**
支柱五《成長子系統設計》v0.1 §3 天賦樹核心結構：

- **12 級 = 滿等**
- 每級花費 1 天賦點
- **3 級**：選擇分支（第一個質變點）
- **5 級**：第一個專精上線
- **6 級**：分支核心能力（第二個質變點）
- **8 級**：第二個專精
- **12 級**：超凡入聖，能與克蘇魯正面對抗

**修正動作：**
核對 `talent_tree.md` 中列出的節奏表，修正與支柱五 v0.1 §3 不符的部分。

---

## 錯誤 I-2：起始屬性總點數

**錯誤內容：**
文件 05 `talent_tree.md` 提到「起始屬性 18 點」——此為正確值。

**違反依據：**
支柱五 §1.1 與狀態紀錄 26041801 §3.2 確認：**總點數 18**（原 21 的差額透過天賦樹 5 次屬性提升補回）。

**修正動作：**
此處**正確**，但需確認 `attribute_boost` 節點總共 5 個的規則在 Prompt 中明確寫明。

---

## 錯誤 I-3：陣營天賦樹主屬性

**修正動作：**
`talent_tree.md` 若範例中使用了某個陣營，其 `boost_attribute` 必須符合支柱五 §1.2 修正版的對照表（見本清單錯誤 B-2）。

---

# 十、給 Claude Code 的總結執行順序

## 執行優先順序

| 優先級 | 項目 | 影響範圍 |
|--------|------|---------|
| P0 | 錯誤 A-1：架構偏離說明（文件註解） | `README.md`、`geminiClient.ts` |
| P0 | 錯誤 B-1：陣營代碼全面改為 E/I/S/N/T/F/J | 所有 Prompt + Schema |
| P0 | 錯誤 F-1：Admin API endpoint 對齊實際路徑 | `adminApiClient.ts` |
| P1 | 錯誤 C-1:稀有度代碼對齊 Schema | `cardSchema.ts` + `card_design.md` |
| P1 | 錯誤 C-2：等級抵扣修正為 -1/-2/-3/-4/-5 | `card_design.md` |
| P1 | 錯誤 D-1:家族代碼補齊 10 組 | `enemySchema.ts` + `enemy_design.md` |
| P1 | 錯誤 D-4：敵人 DC 值更新為 +4 版 | `enemy_design.md` |
| P1 | 錯誤 E-1：Stage vs Scenario 分離 | 多處 |
| P2 | 錯誤 B-2：F 聖燼主屬性改為力量 | `talent_tree.md` |
| P2 | 錯誤 D-2：家族戰鬥特色對齊草案 v2 | `enemy_design.md` |
| P2 | 錯誤 G-1：克蘇魯譯名全面校對 | 所有 Prompt |
| P2 | 錯誤 I-1：天賦樹 12 級節奏對齊支柱五 | `talent_tree.md` |
| P3 | 錯誤 H-1 / H-2：Validator 強化 | `validator.ts` |
| P3 | 錯誤 F-2：commit_icons 反例測試 | `tests/validator.test.ts` |

## 檢查完成後的驗證

Claude Code 修正完畢後，請自行執行下列驗證：

1. `npm run build` 無錯誤
2. 所有 `.md` Prompt 檔案中不再出現以下錯誤代碼：
   - `explorer`、`scholar`、`fighter`、`rogue`、`survivor`、`mystic`、`guardian`（舊錯陣營名）
   - `large` 等非規則書定義的稀有度
   - 舊的 DC 值（8、12、16、20、24）
3. `src/schemas/*.ts` 中的 enum 與實際資料庫 Schema 的 enum 一致
4. `GET /health` 仍能正常回應（基本功能未被破壞）

## 不屬於 gemma-bridge 職責的項目

以下項目**不要**在 gemma-bridge 中處理，即使發現也只記錄不修改：

- `admin-shared.js` 的 `getModifier`、`ENEMY_TIERS`、`CREATION_TOTAL_POINTS` 修正（屬於 MOD-03 / MOD-11 範疇）
- 規則書文字本身的回寫
- 其他 MOD-XX 指令文件的修正

## 回報格式

修正完成後，請以下列格式回報：

```
已修正項目：
- [錯誤編號] 修正內容摘要
- ...

已檢查但未發現問題的項目：
- [錯誤編號] 為何沒問題
- ...

發現但超出職責範圍、僅記錄的項目：
- [錯誤編號] 需後續由誰處理
- ...

驗證結果：
- npm run build: pass/fail
- /health: up/down
- Prompt 檔案錯誤關鍵字掃描: pass/fail
```

---

## 文件版本紀錄

| 版本 | 日期 | 變更 |
|------|------|------|
| v1.0 | 2026/04/18 | 初版建立 — 六份文件的錯誤檢查清單，分為 10 大類 |
