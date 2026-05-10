# CLAUDE.md — 專案指引

## 專案身份
克蘇魯神話卡牌驅動合作冒險網頁遊戲。

## 關鍵設計文件
- `docs/核心設計原則_v0.1.md` — 設計靈魂，最高權威
- `docs/數值規格文件_v0.1.md` — 所有數值參數
- `docs/資料庫結構設計_v0.1.md` — PostgreSQL + Redis Schema

## Story-to-Stage 自動生產線索引(本機 .gitignore)

**位置:** `scripts/mod-agent-local/pipeline-story-to-stage/`(從劇本 txt 自動建好 MOD-06/07/08 全部資料)

**啟動 Claude Code 時必讀:**
- 索引文件:`C:\Users\user\.claude\projects\c--Ug\memory\reference_pipeline_story_to_stage.md`
  涵蓋階段腳本、規範主檔、API 端點、三個 mod 完整性檢查項目對照
- 首次跑通記錄:`C:\Users\user\.claude\projects\c--Ug\memory\project_pipeline_story_to_stage_v1.md`
  2026-05-01 用 story01.txt 驗證 PASS=46/WARN=2/FAIL=0,已知限制(重跑非冪等等)

**遇到下列情境必先讀上述兩份:**
- Uria 提到「生產線」「Story-to-Stage」「pipeline」「劇本轉關卡」
- 接到「跑 storyXX.txt」「建一條戰役」「驗證後台全綠」這類任務
- 修改 MOD-06/07/08 的完整性檢查邏輯 / migration 028 / campaigns 表結構

## 專案結構圖譜(graphify 知識圖譜)

**位置:** `C:\Ug\graphify-out\`(可擴充,目前一份)

**目前圖譜:** 2026-05-07 建,scope = `cthulhu-card-game/` 排除 `old/`
- **報告(必讀):** `C:\Ug\graphify-out\GRAPH_REPORT.md`
  1182 節點 / 2352 邊 / 97 社群人話命名,涵蓋:
  - **God Nodes** 跨群最連的核心抽象(adminFetch / adminGet / scanSimplifiedChars / requireGeminiKey / callGemini / 規則書 v07 索引)
  - **Surprising Connections** 圖譜偵測到的非顯式連結(`packages/client/public/rulebook/` 是 `docs/v07_當前版本_26042606/` 的雙寫鏡像)
  - **Communities** 97 個社群命名(DB 啟動與遷移 / Sandbox 投資者卡批次 / 校準前端套件 / 規則書核心機制 / 卡名軸與設計憲法 / Pipeline 量產 driver 等)
  - **Knowledge Gaps** 107 個 weakly-connected 節點分類(規範索引覆蓋盲點線索)
- **互動圖(視覺探索):** `C:\Ug\graphify-out\graph.html`(瀏覽器開,點節點看連結)
- **原始 JSON(程式查詢):** `C:\Ug\graphify-out\graph.json`

**用途:** 跨 session 維持專案整體認知。接任務時先 query 圖譜定位節點 / 所屬 community,再讀必要原檔,token 壓縮比 ~110×。

**主動查圖譜的情境:**
- Uria 提到沒見過的模組名 / 概念 / 卡片類型 → 看屬哪個 community
- 「改 X 會影響哪些 Y」類問題 → 看 God Nodes + 跨群橋接(bridges)
- 評估規範索引覆蓋盲點 → 看 Knowledge Gaps + Suggested Questions

**已知限制(讀圖時心理打折):**
- `packages/shared` 跨 package import 沒被 AST 抓到,tests + types 顯示為孤兒(假性)
- `read-cred-and-login.mjs` 被 sensitive filter 誤擋(下次 update 應放回)
- 規範索引部分子節點反向 cite 弱(真孤兒,GRAPH_REPORT A 類 Tier 3)

**重跑時機:**
- 增量(只重抽變更檔,~1/10 成本):`/graphify cthulhu-card-game --update`
- 完整重建(~1M tokens):`/graphify cthulhu-card-game`

## 技術決策
- Monorepo：pnpm workspaces
- 前端：React + TypeScript + Vite → Vercel
- 後端：Fastify + TypeScript → Railway
- 資料庫：PostgreSQL + Redis → Railway
- 共用型別：@cthulhu/shared

## 開發指令
- `pnpm dev` — 同時啟動前後端
- `pnpm dev:client` — 僅啟動前端（port 5173）
- `pnpm dev:server` — 僅啟動後端（port 3001）

## 協作備註
專案原創者 Uria 不具備資工背景。技術決策由開發者自行判斷，設計決策需經 Uria 確認。與 Uria 溝通時避免技術術語。

---

## 工具使用守則（來源：工具指引 V1 §B）

### 主動調用原則

Claude Code 不需要等待使用者指示，應在以下情境**主動**使用對應工具：

| 情境 | 應主動使用的工具 | 具體做法 |
|------|----------------|---------|
| 使用任何第三方 library 的 API | Context7 | prompt 加入 `use context7`，查詢該 library 最新文件 |
| 需要讀取 PDF/Word/Excel 檔案 | MarkItDown | `python -m markitdown <檔案> -o <輸出.md>` 後讀取 md |
| 產出前端 HTML/CSS 後 | Impeccable `/audit` | 交付前自動執行品質檢查 |
| 產出前端程式碼涉及無障礙 | Web Design Guidelines | `/web-design-guidelines` 合規檢查 |
| 對 Git 操作有疑問或需查歷史 | GitHub MCP | 直接使用工具函式查看 diff/history |
| 新模組的視覺設計探索 | UI-UX-Pro-Max search | 搜尋風格、配色、字體推薦 |

### Context7 強制使用場景

以下 library 因版本迭代頻繁，**必須**使用 Context7 查詢最新 API 後再寫程式碼：
- pptxgenjs（Shape Type 常數、Shadow API 格式曾因版本變更導致嚴重錯誤）
- SheetJS / xlsx-js-style（匯出格式、樣式 API 差異大）
- Bootstrap 5（Modal API、Utility classes 在不同小版本間有變化）

不需要使用 Context7：GAS 原生 API、LINE LIFF SDK、RAGIC REST API。

### MarkItDown 使用時機

```bash
# 讀取使用者提供的外部文件
python -m markitdown "<檔案路徑>" -o "<輸出路徑.md>"

# pptxgenjs 產出驗證
python -m markitdown output.pptx

# Excel 預算書結構確認
python -m markitdown "預算書樣本.xlsx" -o "預算書結構.md"
```

### 前端品質檢查流程（交付前必做）

產出或修改前端 HTML/CSS 檔案後，依序執行：

```
1. /audit          ← 無障礙 + 效能 + 響應式基本檢查
2. /polish         ← 對齊、間距、細節微調
3. /web-design-guidelines <檔案>  ← 合規性最終確認
```

若為新模組的視覺設計，在寫程式碼之前先執行：

```
1. python .claude/skills/ui-ux-pro-max/scripts/search.py "<風格關鍵字>" --domain styles
2. python .claude/skills/ui-ux-pro-max/scripts/search.py "<色彩關鍵字>" --domain colors
3. 根據搜尋結果確認設計方向後再開始實作
```

### 不適用場景

| 不應使用 | 原因 |
|---------|------|
| Context7 查 GAS API | Google 官方文件不在收錄範圍 |
| Context7 查 RAGIC API | RAGIC 為非主流平台，依設計準則為準 |
| Impeccable 審查後端程式碼 | Impeccable 專為前端 HTML/CSS 設計 |
| UI-UX-Pro-Max 在 bugfix 時 | 修 bug 時不需要設計探索 |
| MarkItDown 讀純文字 .md/.txt | 直接讀檔即可，不需要轉換 |
