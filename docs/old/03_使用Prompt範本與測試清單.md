# 文件 03：使用 Prompt 範本與三階段測試清單
## Usage Prompt Templates & Three-Stage Test Checklist

> **對象：** Uria 本人執行
> **前置條件：** 文件 01 安裝完成、文件 02 由 Claude Code 執行完成、文件 04–06 的 System Prompt 已填入 `gemma-bridge/prompts/`
> **目標：** 學會向 `gemma-bridge` 下達各種任務指令，並依照三階段驗收品質

---

## 第一部分：基本請求格式

所有任務透過 POST `http://127.0.0.1:8787/task` 送出，Body 為 JSON：

```json
{
  "taskType": "...",
  "input": "...",
  "complexity": "simple | complex（可省略）",
  "writeToDb": true | false,
  "batchCount": 1,
  "contextTags": ["..."]
}
```

| 欄位 | 必填 | 說明 |
|------|------|------|
| `taskType` | 是 | `card_design` / `talent_tree` / `enemy_design` / `scenario_design` / `combo_design` |
| `input` | 是 | 自然語言指令，可短可長 |
| `complexity` | 否 | 省略時由系統自動判斷，`complex` 強制使用 Gemini Pro |
| `writeToDb` | 否 | 預設 `true`；測試階段建議設為 `false` 先檢視產出再決定是否入庫 |
| `batchCount` | 否 | 批次產出的數量，預設 1 |
| `contextTags` | 否 | 輔助標籤，例如陣營、家族、主題 |

---

## 第二部分：情境 A — 短輸入（靈感展開）

### 使用情境

你腦中有一個模糊靈感，希望 GEMMA 幫你展開成卡片或敵人。

### 範例 A-1：三張 Combo 卡片

```json
{
  "taskType": "combo_design",
  "input": "三張卡片的互動 COMBO：玩家操控一名精神瀕臨崩潰的學者，手中有一本禁忌之書。想要的機制感：書籍消費 → 學者獲得瞬間力量 → 但必須觸發一張神話卡",
  "batchCount": 3,
  "contextTags": ["faction_scholar", "theme_forbidden_knowledge"],
  "writeToDb": false
}
```

### 範例 A-2：一張調查員能力

```json
{
  "taskType": "card_design",
  "input": "設計一張『探險家陣營的簽名資產卡』，能力主題：讓調查員可以把場景中任何地點的感知門檻降低 1。LV0 版本，偏低費用",
  "batchCount": 1,
  "contextTags": ["faction_explorer", "rarity_basic"],
  "writeToDb": false
}
```

### 範例 A-3：一隻敵人變體

```json
{
  "taskType": "enemy_design",
  "input": "設計一隻深潛者家族的精英位階變體，主題是『懷抱古老羅盤的深潛者祭司』，偏重 SAN 傷害，使用潮濕狀態與恐懼聯動",
  "contextTags": ["house_cthulhu", "tier_elite"],
  "writeToDb": false
}
```

### 短輸入的品質期待

- Gemini Flash 即可處理，回應時間約 5–15 秒
- Combo 類任務可能升級到 Pro（因為需要跨卡片互動推理）
- 第一次產出可能不完美，可以：
  - 把產出結果 + 修改意見再送一次請求（把原始產出貼進 `input` 一起送）
  - 手動微調後再寫入 DB

---

## 第三部分：情境 B — 長輸入（整本小說展開為 Campaign）

### 使用情境

你有一篇小說 / 短篇文本（例如 Lovecraft 原作），希望 GEMMA 幫你設計成完整的關卡結構。

### 工作流程

**重要：** 由於 GEMMA 本地模型的 context 限制，**長文處理由 Gemini Pro 直接承擔**，GEMMA 只負責協調。

```
Uria 準備整本星之彩全文（假設 2 萬字中譯）
       ↓
POST /task（taskType=scenario_design, complexity=complex）
       ↓
gemma-bridge 偵測輸入長度 → 自動路由到 Gemini Pro
       ↓
Gemini Pro 一次性讀取全文 → 回傳 Campaign 骨架 JSON
       ↓
GEMMA 接收骨架 → 逐 Chapter / Stage 呼叫 Gemini 產出細節
       ↓
GEMMA 驗證每個產出 → 分批寫入 DB
       ↓
Uria 早上打開設計器檢視完整 Campaign
```

### 範例 B-1：星之彩完整展開

將整本《星之彩》中文全文存為 `starry_color.txt`，然後準備請求 JSON：

```json
{
  "taskType": "scenario_design",
  "input": "<此處貼入整本星之彩全文，約 15000–20000 字>",
  "complexity": "complex",
  "writeToDb": false,
  "contextTags": ["house_independent", "color_out_of_space"]
}
```

**執行方式**（PowerShell）：

```powershell
$content = Get-Content -Path "D:\novels\starry_color.txt" -Raw

$body = @{
  taskType = "scenario_design"
  input = $content
  complexity = "complex"
  writeToDb = $false
  contextTags = @("house_independent", "color_out_of_space")
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "http://127.0.0.1:8787/task" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10 | Out-File "starry_color_result.json"
```

### 範例 B-2：只要 Campaign 骨架，不做細節

```json
{
  "taskType": "scenario_design",
  "input": "<星之彩全文>",
  "complexity": "complex",
  "writeToDb": false,
  "contextTags": ["skeleton_only"]
}
```

`skeleton_only` 標籤告訴 System Prompt 只要產出 Chapter / Stage 清單，不展開細節。這樣可以先檢查結構是否合理，再決定要不要花時間展開。

### 長輸入的預期時間

| 階段 | 時間 |
|------|------|
| Gemini Pro 讀取全文 + 產出骨架 | 30–60 秒 |
| GEMMA 協調逐 Stage 產出細節（假設 9 個 Stage） | 9 × 30–60 秒 = 5–10 分鐘 |
| 每個 Stage 產出 15–20 張卡片 + 敵人 + 場景 | 每 Stage 再 5–10 分鐘 |
| **完整 Campaign** | **1–3 小時** |

**建議：** 長輸入任務安排在晚上睡前執行，隔日檢視結果。

---

## 第四部分：情境 C — 需要決策的複雜任務

### 使用情境

你對某個設計感到卡關，不是要產出資料，而是要問「這樣設計合理嗎？」。

### 目前的做法（階段 1）

依照前述討論，情境 C 的決策任務**暫時交給 Gemini Pro 處理**（透過 `complexity: 'complex'` 強制路由）。未來可擴展為呼叫 Claude API。

### 範例 C-1：詢問數值平衡

```json
{
  "taskType": "card_design",
  "input": "我設計了一張法術卡，效果是『消耗 1 使用次數，對一個地點的所有敵人造成 3 點神秘傷害』。請幫我計算 V-value，判斷合理的稀有度與費用，並指出這張卡與現有陣營卡池的衝突點",
  "complexity": "complex",
  "writeToDb": false
}
```

### 範例 C-2：詢問規則邏輯

```json
{
  "taskType": "card_design",
  "input": "我想要一個機制：玩家主動獲得一個負面狀態，換取抽牌。這違反克蘇魯『正面狀態稀少』原則嗎？",
  "complexity": "complex",
  "writeToDb": false
}
```

### 未來擴展（預留）

gemma-bridge 已預留 `claudeClient.ts` 檔案。若 Gemini Pro 的決策品質不足以滿足設計辯論需求，可在未來加入 `"modelPreference": "claude"` 欄位，直接呼叫 Claude API。

---

## 第五部分：三階段驗收測試

### 階段 1：單一任務測試（第 1 週）

**目標：** 確認整條流程（GEMMA → Gemini → 驗證 → DB 寫入）全部跑得通。

**測試清單：**

| # | 測試項目 | 期望結果 | 紅線（必須通過） |
|---|---------|---------|----------------|
| 1.1 | 單張基礎資產卡（Flash） | 成功產出合法 JSON | 通過驗證器，V-value 合理 |
| 1.2 | 單張技能卡（Flash） | 成功產出合法 JSON | `commit_icons` 與 `attribute_modifiers` 正確分離 |
| 1.3 | 單隻深潛者變體（Flash） | 成功產出合法 JSON | `immunities` 不含 `arcane` |
| 1.4 | 單一天賦節點（Flash） | 成功產出合法 JSON | tier 值合法，attribute_boost 位置正確 |
| 1.5 | 3 張 Combo（Flash） | 產出 3 張有互動關聯的卡片 | 每張都過驗證 |
| 1.6 | 1 個簡單場景骨架（Pro） | 產出 Stage + Act + Agenda 結構 | 層級關係正確 |
| 1.7 | writeToDb 開啟後的完整寫入測試 | DB 成功寫入 | 設計器可查詢到新資料 |
| 1.8 | 驗證失敗時的重試 | Gemini 在第 2 或第 3 次成功 | 日誌記錄重試過程 |
| 1.9 | Admin API 錯誤處理 | 錯誤訊息清晰 | 不吞掉錯誤，回傳完整錯誤資訊 |
| 1.10 | GET /health 檢查 | 三個上游全顯示 up | 任何一個 down 要能明確指出 |

**通過標準：** 10 項中至少 9 項通過，且紅線全部滿足。

---

### 階段 2：小批次測試（第 2 週）

**目標：** 驗證批次產出的品質與效率。

**測試清單：**

| # | 測試項目 | 數量 | 期望通過率 |
|---|---------|------|-----------|
| 2.1 | 批次基礎卡片產出（同陣營） | 10 張 | ≥ 80% 通過驗證 |
| 2.2 | 批次卡片產出（混合類型） | 10 張 | ≥ 70% 通過驗證 |
| 2.3 | 批次天賦節點產出（單樹） | 32 節點 | ≥ 90% 通過驗證 |
| 2.4 | 批次敵人變體產出（單家族） | 10 變體 | ≥ 80% 通過驗證 |
| 2.5 | 3 個 Combo 主題，每主題 5 張卡 | 共 15 張 | ≥ 70% 通過驗證 |

**效能檢查：**

- 單張卡片平均產出時間 ≤ 20 秒（Flash）
- 批次 10 張卡片總時間 ≤ 5 分鐘
- 每日 Gemini API 成本估算 ≤ $0.50 美元（以每日測試 100 次 Flash 請求為基準）

**品質抽檢：**

隨機抽 20% 的產出，Uria 本人檢視：
- 克蘇魯氛圍是否合格
- 繁體中文用詞是否正確
- 克蘇魯專有名詞譯名是否符合對照表
- V-value 計算是否與公式吻合

---

### 階段 3：長輸入測試（第 3 週）

**目標：** 驗證「丟整本星之彩 → 完整 Campaign」的旗艦情境。

**測試清單：**

| # | 測試項目 | 期望結果 |
|---|---------|---------|
| 3.1 | 整本星之彩 → Campaign 骨架 | 3 Chapter × 3 Stage 結構，敘事主線合理 |
| 3.2 | 骨架展開為完整 Scenario（9 個） | 每個 Stage 有 Act + Agenda + 地點 |
| 3.3 | 每 Scenario 產出卡片 15–20 張 | 全部過驗證，風格一致 |
| 3.4 | 每 Scenario 產出敵人 3–5 隻 | 符合家族設定（獨立存在 — 星之彩） |
| 3.5 | 整體寫入 DB 後可在設計器播放 | 可從戰役管理 → 章節 → 關卡一路檢視 |
| 3.6 | 總 Gemini API 成本 | ≤ $5 美元（使用 2.5 Pro + Flash 混合） |
| 3.7 | 整體執行時間 | ≤ 3 小時（夜間跑） |

**紅線：** 產出的星之彩 Campaign 必須有以下特徵——
- 場景逐漸揭露「顏色」的來源（與 Lovecraft 原作敘事節奏一致）
- SAN 傷害比 HP 傷害高（星之彩主打精神污染）
- 不該出現與星之彩無關的克蘇魯家族怪物
- 最終關卡有明確的決戰感（非只是疊加小怪）

---

## 第六部分：錯誤處理與日誌查閱

### 6.1 查看單次任務的詳細日誌

每次任務產生一個 `logs/task-<taskId>.log`，內含完整生命週期：

```bash
cd gemma-bridge
type logs\task-abc123.log
```

**日誌中可看到：**
- 任務路由決策（使用 Flash 還是 Pro，原因）
- Gemini API 每次呼叫的 input/output tokens
- JSON 驗證結果（通過 / 失敗原因）
- Admin API 寫入結果（成功 / 失敗項目）
- 總耗時

### 6.2 查看錯誤日誌

```bash
type logs\errors.log
```

### 6.3 常見錯誤對照

| 錯誤類別 | 可能原因 | 處理方式 |
|---------|---------|---------|
| `ollama: connection refused` | Ollama 沒啟動 | 檢查系統工作列，重啟 Ollama |
| `gemini: 401 Unauthorized` | API Key 錯誤或過期 | 檢查 `.env` 的 `GEMINI_API_KEY` |
| `gemini: 429 Resource Exhausted` | 免費額度用完 | 等待重置或升級付費 |
| `validation: commit_icons must not overlap with attribute_modifiers` | Gemini 產出違反分離規則 | 系統會自動重試；若 3 次都失敗，需調整 Prompt |
| `admin_api: 500 Internal Server Error` | Admin Module 後端有 bug | 檢查 Admin Module 的日誌 |
| `admin_api: ECONNREFUSED` | Admin Module 沒啟動 | 啟動 Admin Module 服務 |

---

## 第七部分：成本監控

### 7.1 每日成本估算範例

假設一天：
- 50 次 Flash 卡片產出（平均 2K input + 1K output）
- 5 次 Pro 場景展開（平均 20K input + 5K output）

**Flash 成本：**
- 50 × 2K × $0.30/M = $0.03（input）
- 50 × 1K × $2.50/M = $0.125（output）
- 合計 ≈ $0.15

**Pro 成本：**
- 5 × 20K × $1.25/M = $0.125（input）
- 5 × 5K × $10/M = $0.25（output）
- 合計 ≈ $0.375

**每日總計：約 $0.50 美元（約台幣 16 元）**

### 7.2 省錢機制

依照文件 02 的實作，gemma-bridge 已啟用：

1. **Context Caching**：System Prompt 重複讀取只收 10% 費用
2. **Flash 優先路由**：只有必要時升級 Pro
3. **JSON Mode**：減少不必要的文字生成

若要更省，可在 `.env` 新增：

```env
# 啟用 Batch API（非即時任務 50% 折扣，但需等 24 小時）
USE_BATCH_API_FOR_NIGHTLY=true
```

---

## 第八部分：與既有設計器的整合模式

### 8.1 並行運作

`gemma-bridge`（port 8787）與 Admin Module（port 3000）**同時運行**，互不干擾：

```
Uria 的工作方式有兩種：

方式 A：直接在設計器 UI 操作（人類思考）
  瀏覽器 → http://localhost:3000/admin/admin-card-editor.html
  → 手動填寫 → 儲存

方式 B：透過 GEMMA 批次產出（自動化）
  PowerShell / 腳本 → POST http://localhost:8787/task
  → gemma-bridge 自動呼叫 → 寫入相同的 DB
```

兩種方式都寫入同一個 PostgreSQL，所以 GEMMA 產出的結果會立刻出現在設計器中。

### 8.2 審核工作流建議

1. **日間模式**（手動為主）：Uria 在設計器做關鍵設計
2. **夜間模式**（批次為主）：丟長文讓 GEMMA 跑
3. **隔日檢視**：在設計器上對 GEMMA 產出的卡片 / 敵人 / 場景加上「已審核」標記
4. **淘汰不合格的**：在設計器上直接刪除或標記為不使用

---

## 第九部分：驗收完成後

當三階段測試全部通過，即可進入正式生產使用。建議 Uria：

1. 將 `gemma-bridge` 加入開機自動啟動（Windows 工作排程器）
2. 建立個人的 prompt 常用範本庫（例如「陣營 X 的 LV0 卡片批次」「家族 Y 的精英變體批次」）
3. 每週檢查 Gemini API 使用量，避免意外超支
4. 定期備份 `gemma-bridge/logs/` 以便日後追蹤設計決策歷程

---

## 文件版本紀錄

| 版本 | 日期 | 變更內容 |
|------|------|---------|
| v1.0 | 2026/04/18 | 初版建立 — 三情境使用範本與三階段測試清單 |
