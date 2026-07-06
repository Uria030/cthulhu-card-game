# 派工單待辦(backlog)

> 有 driver 但**尚未落派工單**的生產線——依操作手冊第 6 節規則,派工單未落檔前不開放操作員啟動。落檔工作由 Claude 主 session(品質主管)執行,每線落檔前需過校準輪(生產線Agent計畫 Part 5)。

| 線 | driver | 派工單狀態 | 備註 |
|---|---|---|---|
| MOD-02 天賦樹 | `scripts/mod-agent-local/talent-trees/` | ❌ 待寫 | 8 棵已完量,派工單供增補用 |
| MOD-03 怪物 | `scripts/mod-agent-local/monsters/run-batch-monster.mjs` | ❌ 待寫 | 哈斯塔家族模式已驗證 |
| MOD-06 戰役敘事 | `scripts/mod-agent-local/pipeline-story-to-stage/` | ❌ 待寫 | pipeline 階段參數化 |
| MOD-07 關卡三池 | 同上 + `lib/gemini-pool-picker.mjs` | ❌ 待寫 | |
| MOD-08 地點 | pipeline 第 2/8 點 | ❌ 待寫 | |
| MOD-10 神話/遭遇卡 | `scripts/mod-agent-local/keeper-cards/run-batch-*.mjs` | ❌ 待寫 | |

另兩個更早期的缺口(要的不只是派工單):
- MOD-01/12 玩家卡:瀏覽器端生產線,**無頭入口待建**
- MOD-09 鍛造:**無 driver**

登記:2026-07-02(Codex grep 盤點 + Uria 指示記錄)

## MOD-09 進度更新(26070601)
- 生產線已建:`scripts/mod-agent-local/forge-content/`(master_forge.md + run-forge-batch.mjs,含四層閘)——backlog「無 driver」狀態解除。
- **初版內容已入庫(Uria 放行)**:素材 40/40 具名(fish/insect/mineral/wood 各十級)+ 配方 12 個(手續費標 draft 待裁);總成本 $0.14。
- 未產:怪物類素材(綁怪物家族,隨 MOD-03)、臨時卡配方(需產卡片本體,走卡片線)。配方 unlock_ref 為設計占位,M4 鍛造引擎實裝時對表。
