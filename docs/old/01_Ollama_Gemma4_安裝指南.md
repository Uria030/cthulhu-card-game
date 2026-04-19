# 文件 01：Ollama + Gemma 4 E2B 安裝指南
## Installation Guide for Ollama + Gemma 4 E2B (Windows)

> **對象：** Uria 本人執行
> **預計時間：** 30–45 分鐘（含模型下載）
> **硬體需求：** 已符合（GTX 1650 4GB + 16GB RAM + i5-12400）
> **產出目標：** 本地 HTTP API（`http://127.0.0.1:11434`）可接受請求並回傳 Gemma 4 E2B 的回應

---

## 角色定位提醒

在開始安裝之前，請務必記住本架構中 GEMMA 的職責：

> **GEMMA 不負責「思考」，只負責「執行動作」。**
> 真正的創意、文字創作、規則推理由雲端 Gemini API 處理。
> 因此即使 E2B（2.3B 參數）是 Gemma 4 家族中最小的模型，對我們的工作流完全足夠。

---

## 第一部分：Ollama 安裝

### 步驟 1.1：下載 Ollama

打開瀏覽器，前往 Ollama 官方網站：

```
https://ollama.com/download
```

點選 **「Download for Windows」** 按鈕，下載 `OllamaSetup.exe`（檔案約 500–700 MB）。

### 步驟 1.2：執行安裝程式

1. 雙擊 `OllamaSetup.exe`
2. 若 Windows Defender SmartScreen 彈出警告，點選「其他資訊」→「仍要執行」
3. 接受授權條款
4. 使用預設安裝路徑（通常是 `C:\Users\<你的使用者名稱>\AppData\Local\Programs\Ollama`）
5. 完成安裝後，Ollama 會自動啟動背景服務並在系統工作列（右下角）顯示一個羊駝圖示

### 步驟 1.3：驗證 Ollama 已啟動

打開 **PowerShell**（Win + R，輸入 `powershell` 按 Enter）。

執行下列指令：

```powershell
ollama --version
```

**預期輸出**（版本號可能略有不同）：

```
ollama version 0.20.x
```

若顯示「無法辨識 'ollama' 詞彙」，請重開 PowerShell 或重新啟動電腦後再試一次。

### 步驟 1.4：驗證 Ollama HTTP API

在同一個 PowerShell 視窗執行：

```powershell
curl http://127.0.0.1:11434
```

**預期輸出**：

```
Ollama is running
```

若看到此訊息，表示本地 HTTP API 已就緒，即可進入下一階段。

---

## 第二部分：下載 Gemma 4 E2B 模型

### 步驟 2.1：執行模型拉取指令

在 PowerShell 執行：

```powershell
ollama pull gemma4:e2b
```

**預期行為**：
- 系統會開始下載模型（約 2–3 GB）
- 依照網速不同，需 5–20 分鐘
- 下載過程會顯示進度條（例如 `pulling manifest...`、`downloading...` 等）

### 步驟 2.2：驗證模型已安裝

下載完成後，執行：

```powershell
ollama list
```

**預期輸出**（大小數值可能略有不同）：

```
NAME              ID              SIZE      MODIFIED
gemma4:e2b        abc123def456    2.1 GB    2 minutes ago
```

### 步驟 2.3：快速測試模型

執行互動式對話測試：

```powershell
ollama run gemma4:e2b
```

進入互動模式後，輸入以下測試指令並按 Enter：

```
Respond with exactly this JSON: {"status": "ok", "model": "gemma4-e2b"}
```

**預期行為**：
- Gemma 4 E2B 應該回傳類似 `{"status": "ok", "model": "gemma4-e2b"}` 的 JSON
- 第一次回應會稍慢（約 5–15 秒），因為模型正在載入 VRAM
- 之後的回應會快很多（每秒 15–25 tokens）

輸入 `/bye` 並按 Enter 退出互動模式。

> **如果第一次回應時間超過 60 秒或無回應：** 你的 GTX 1650 可能遇到 VRAM 分配問題。請先關閉其他吃 GPU 的應用程式（瀏覽器、遊戲、影像處理軟體），然後重試。

---

## 第三部分：驗證 Ollama API 可接受橋接程式呼叫

這一步驟確認 Ollama 的 HTTP API 格式正確，因為 `gemma-bridge` 橋接程式（文件 02）會透過這個 API 與 GEMMA 溝通。

### 步驟 3.1：以 PowerShell 發送 API 請求

在 PowerShell 執行下列指令（**一整段一起貼上**）：

```powershell
$body = @{
  model = "gemma4:e2b"
  prompt = "Reply only with: {""test"": ""passed""}"
  stream = $false
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/generate" -Method Post -Body $body -ContentType "application/json"
```

**預期輸出**（response 欄位內容可能略有不同）：

```
model       : gemma4:e2b
created_at  : 2026-04-18T...
response    : {"test": "passed"}
done        : True
```

若看到 `response` 欄位內有 JSON 內容，即代表 Ollama API 已就緒，橋接程式可以透過此接口與 GEMMA 溝通。

### 步驟 3.2：檢查 Tool Use 能力

Gemma 4 原生支援 Function Calling（工具呼叫），這是我們讓 GEMMA 「執行動作」的關鍵機制。執行以下測試：

```powershell
$body = @{
  model = "gemma4:e2b"
  messages = @(
    @{
      role = "user"
      content = "Call the test_tool with parameter x=5"
    }
  )
  tools = @(
    @{
      type = "function"
      function = @{
        name = "test_tool"
        description = "A test function"
        parameters = @{
          type = "object"
          properties = @{
            x = @{ type = "integer" }
          }
        }
      }
    }
  )
  stream = $false
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/chat" -Method Post -Body $body -ContentType "application/json"
```

**預期輸出**：回應中應包含 `tool_calls` 欄位，內含 `test_tool` 的呼叫資訊。

若此步驟成功，代表 GEMMA 可以正確擔任「動作執行層」的角色。

---

## 第四部分：效能調校（選用）

### 4.1 限制併行請求數

你的 GTX 1650 只有 4GB VRAM，同時處理多個請求會爆記憶體。建議設定環境變數限制併行數。

**設定方式：**

1. 開啟 Windows 開始選單，搜尋「環境變數」，點選「編輯系統環境變數」
2. 點選「環境變數」按鈕
3. 在「使用者變數」區塊點選「新增」
4. 輸入：
   - 變數名稱：`OLLAMA_NUM_PARALLEL`
   - 變數值：`1`
5. 再新增一個：
   - 變數名稱：`OLLAMA_MAX_LOADED_MODELS`
   - 變數值：`1`
6. 全部儲存後，**重新啟動電腦**讓設定生效

### 4.2 關閉不必要的背景程式

建議在執行 `gemma-bridge` 批次任務時關閉：
- 瀏覽器（Chrome、Edge 吃 GPU）
- Discord（GPU 加速渲染）
- Steam / Epic Games 客戶端
- 影像處理軟體（Photoshop、Premiere）

---

## 第五部分：常見問題排除

### 問題 5.1：Ollama 指令無法執行

**症狀：** PowerShell 顯示「無法辨識 'ollama' 詞彙」

**解決方式：**
1. 重新啟動 PowerShell
2. 若仍失敗，重新啟動電腦
3. 若仍失敗，手動將 Ollama 安裝路徑加入 PATH 環境變數

### 問題 5.2：模型下載極慢或中斷

**症狀：** `ollama pull gemma4:e2b` 卡住或顯示網路錯誤

**解決方式：**
1. 確認網路連線穩定
2. 取消（Ctrl+C）後重新執行指令——Ollama 會從中斷處繼續
3. 若公司或學校網路有限制，改用手機熱點重試

### 問題 5.3：模型回應極慢（超過 60 秒/次）

**症狀：** 執行 `ollama run gemma4:e2b` 後，簡單問題需要 1 分鐘以上才回應

**解決方式：**
1. 關閉瀏覽器等吃 GPU 的程式
2. 在工作管理員「效能」頁籤確認 GPU 記憶體使用狀況
3. 若 GPU 記憶體長期滿載，在 PowerShell 執行 `ollama stop gemma4:e2b` 後重試
4. 若仍失敗，改用純 CPU 模式：設定環境變數 `OLLAMA_GPU_LAYERS=0`（但速度會再變慢）

### 問題 5.4：HTTP API 無法連線

**症狀：** `curl http://127.0.0.1:11434` 顯示連線被拒

**解決方式：**
1. 確認系統工作列右下角有羊駝圖示
2. 若無圖示，執行 PowerShell：`Start-Process "C:\Users\$env:USERNAME\AppData\Local\Programs\Ollama\ollama app.exe"`
3. Windows 防火牆可能阻擋，首次啟動時若彈出允許視窗請勾選「允許」

### 問題 5.5：Windows Defender 隔離 Ollama

**症狀：** 安裝或執行時，Windows Defender 標記為可疑檔案

**解決方式：**
1. 開啟「Windows 安全性」→「病毒與威脅防護」→「管理設定」
2. 在「排除項目」新增 Ollama 安裝資料夾路徑
3. 重新安裝或重試

---

## 第六部分：驗收檢查清單

完成安裝後，請逐項確認下列全部達成：

| 項目 | 檢查方式 | 預期結果 |
|------|---------|---------|
| Ollama 服務運行中 | 工作列右下角 | 有羊駝圖示 |
| Ollama 指令可執行 | `ollama --version` | 顯示版本號 |
| HTTP API 回應 | `curl http://127.0.0.1:11434` | 回傳 "Ollama is running" |
| Gemma 4 E2B 已下載 | `ollama list` | 清單中有 `gemma4:e2b` |
| 模型可互動對話 | `ollama run gemma4:e2b` | 可回傳 JSON |
| API Generate 端點可用 | 第 3.1 步驟的 PowerShell 指令 | 回傳 response |
| Tool Use 能力確認 | 第 3.2 步驟的 PowerShell 指令 | 回傳含 `tool_calls` |
| 環境變數設定完成 | 系統環境變數 | `OLLAMA_NUM_PARALLEL=1`、`OLLAMA_MAX_LOADED_MODELS=1` |

全部勾選完成後，即可進入下一階段——**文件 02：gemma-bridge Claude Code 指令書**，由 Claude Code 為你建立橋接程式。

---

## 附錄：Ollama 常用指令備忘

| 指令 | 說明 |
|------|------|
| `ollama list` | 列出已下載的模型 |
| `ollama pull <model>` | 下載模型 |
| `ollama run <model>` | 執行互動對話 |
| `ollama stop <model>` | 停止模型（釋放 VRAM） |
| `ollama rm <model>` | 刪除模型 |
| `ollama ps` | 查看目前載入中的模型 |
| `ollama serve` | 手動啟動 HTTP API 服務（正常不需要） |

---

## 文件版本紀錄

| 版本 | 日期 | 變更內容 |
|------|------|---------|
| v1.0 | 2026/04/18 | 初版建立 — Windows 平台 Ollama + Gemma 4 E2B 安裝指引 |
