# MOD-11 派工單 — 調查員起始量產

> 派工單規格見《生產線Agent計畫_v0_1_26070204》Part 1.3。本單是全專案第一份派工單(2026-07-02 第一批 16 位實戰定稿)。

| 欄位 | 內容 |
|---|---|
| **任務類型** | 調查員模板起始量產(核心設計+簽名卡×2+弱點×1+預組牌組 15-20)。規範索引 §4.12 |
| **master file** | `scripts/mod-agent-local/investigator-cards/master_investigator.md`(含 26070202 起新增:主屬性不得被嚴格超越(允許並列最高)/牌組須含派系池內傷害或控場手段 ≥2,池缺如實標註 design_concerns/脫困欄僅一個【行動】標籤/熟練預設遵循陣營對應,偏離須寫理由) |
| **driver** | 試跑單個:`node scripts/mod-agent-local/investigator-cards/test-gemini-investigator.mjs <MBTI-CAREER>`;批次:`node scripts/mod-agent-local/investigator-cards/run-batch-investigators.mjs <CODES 逗號分隔>`(兩階段:核心設計+預組牌組;validator gate 內建:黑名單全文字欄位+簽名卡同批唯一性+重試上限 2) |
| **批次清單格式** | `MBTI-生涯序` 逗號分隔(例:`ENFP-1,INFJ-1`)。多 Agent 並行時清單切段不重疊 |
| **成本上限** | 每位基準 $0.08;批次上限 = 位數 × $0.10 × 1.5(重試緩衝);達上限 92% 停線上報 |
| **特別盯項(給品管)** | ①熟練分布偏食(第一批教訓:sidearm 45%)②E/N 陣營位輸出手段與 design_concerns 如實 ③模板 name_zh 必須留白(null) ④能力 V 值帶 25.5~28.5,離群上報 ⑤簽名卡同批撞名 ⑥黑名單詞滲入設計文字欄(第一批教訓:「增益」在弱點 backstory) |
| **完成定義** | 清單全數入庫(或 error 有裁定紀錄)+ 逐位 `GET /api/admin/investigators/:id/starting-deck/validate` 全綠 + batch-report.md(成功/skip/error/重試/design_concerns/成本)+ 全部維持 is_completed=false 草稿態等 Uria 終審 |

## 進度紀錄

| 日期 | 批次 | 結果 |
|---|---|---|
| 2026-07-02 | 第一批 16 位(8 陣營×2) | 執行中;校準輪沉澱 6 條規則(已併入 master/validator) |
| 待排 | 剩餘 44 位全量 | 三層制全編制首跑(生產 Agent ×2 並行切片+品管 Agent) |
