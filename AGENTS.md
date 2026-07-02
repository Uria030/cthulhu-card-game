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
