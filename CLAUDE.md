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
