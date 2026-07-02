# AGENTS.md — 給 AI 操作員(Codex / 其他 CLI / 低階模型)

本專案的內容量產走「Agent 化生產線」。你(操作員)的入口只有一個:

## 👉 開工前必讀

1. **`docs/生產線操作手冊_v0_1_26070205.md`** — 你的完整操作手冊(前置檢查/啟動指令/監看/停手上報規則/完成檢核)。照著做,不需要判斷力;手冊沒寫的狀況一律停手上報。
2. **`docs/production_orders/`** — 派工單目錄。**只有標「✅ 可用」的生產線允許啟動**(目前:MOD-11 調查員起始)。

## 兩種啟動方式

- **有 Claude Code CLI**:用手冊第 2 節的 `claude -p` 指令派 Agent(定義在 `C:\Ug\.claude\agents\`:production-runner 生產 / qc-production 品管),判斷力外包給 Agent。
- **無 Claude Code(如 Codex 直接操作)**:用手冊第 3 節直接跑 node driver——validator 品質閘內建在 driver 裡,你只負責啟動、監看、上報。

## 鐵則(任何操作員一體適用)

1. 內容一律由 driver 內的 Gemini 產;**你絕不自己寫遊戲內容**。
2. 不手改產出、不跳過 validator、不修改 driver/master/規範文件。
3. 腳本冪等:已存在 = skip,重跑不疊加。
4. 成本上限見各派工單;逼近 92% 停線。
5. 產出一律維持草稿態(is_completed=false),終審權在專案擁有者 Uria。
6. 遇到手冊沒寫的狀況:停手,照手冊第 5 節格式上報。**寧可誤報,不可自作主張。**

## 體制文件(想理解全貌再讀,操作不需要)

- `C:\Ug\docs\生產線Agent計畫_v0_1_26070204.md` — 兩個 Agent 定義 × N 份派工單的架構
- `C:\Ug\docs\品管三層制_Agent化量產品管計畫_v0_1_26070203.md` — validator/品管 Agent/主 context 三層權限
- `docs/regulation_index_v0_2_26050302.md` — 全專案規範地圖(§3.1 術語黑名單必看)

---

# 工程協作 Gate(Codex 寫碼 × Claude review)

M1 起,遊戲本體程式碼由 Codex 實作、Claude 主 session review。這不是參考流程,而是 E 系列 / 本體工作包交付的必過 Gate。未通過 Gate 前,不得宣稱工作包完成。

## 必過 Gate(Codex 遵守)

1. **讀權威文件**:先讀本檔、`docs/工作分軌_資料庫填補×本體工作包_v0_1_26070209.md` 或指定工作包規格、相關 docs / tests。舊 M1 規劃只能作背景,不得推翻較新的分軌文件。
2. **鎖定範圍**:只做工單範圍。範圍外問題記進 handoff 的風險/後續,不得順手改。
3. **實作紀律**:
   - 測試先行或同行:改引擎必附回歸測試(測試檔模式照 `packages/shared/src/game/*.test.ts` 既有自跑式風格)
   - 跑過:受影響 package 的測試 + `tsc --noEmit`(shared/server/client 視影響範圍都要過)
   - 本機 `pnpm.cmd` / `npx` 不可假設可用;優先使用各 package `node_modules\.bin\*.CMD` 工具
   - 禁碰:`docs/v07_當前版本_26042606/`(規則書)、凍結期的關卡/城主資料、任何 Uria 裁定範圍外的行為變更
4. **Codex 交件 Gate**:本機 commit(**不 push**,commit message 註明工作包編號),並寫 handoff 檔 `docs/_codex_handoff/<工作包>-<日期碼>.md`:變更摘要/動過的檔案/測試結果貼上/自知的風險與範圍外發現。
5. **Review 送審 Gate**:交件後必須送守燈人 review。Codex 可用 `docs/_codex_handoff/README.md` 的絕對路徑 `claude.cmd` 指令呼叫;若 session 正在使用或不可呼叫,就把精確的 handoff 路徑與 review 指令回報給 Uria 接手。
6. **完成定義**:Codex 端完成只等於「實作 + 測試 + 本機 commit + handoff + 已送審/可送審」。專案完成必須等守燈人 review PASS 並 push;若 review 回 BLOCK/WARN,Codex 依同一 handoff 修訂後重跑 Gate。

## Review 關卡(Claude 執行)

diff 逐檔審 + 測試全綠複跑 + sim 行為驗證(涉引擎時)+ 規則書條文對賬 + 既有回歸紅線(多人一致性/競態防護/冪等)。通過 → push;退回 → review 意見寫進同一 handoff 檔,Codex 修訂再交。

E11 已確立的 workflow 修正一併納入 Gate:

- prod smoke 若依賴尚未部署的 server 變更,屬部署順序問題,需在 handoff / review 中標明,不得誤判成程式缺陷或偷改 smoke。
- `crossTest=true` 暫時可走 public route,但 M5 真人上線前必須收斂。
- 守燈人呼叫使用 `C:\Users\user\AppData\Roaming\npm\claude.cmd`;此機 PowerShell 的 PATH 不保證找到裸 `claude`。
