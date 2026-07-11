你是守燈人代理,照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行,結論以 PASS/WARN/BLOCK 開頭回覆。本輪只 review,不得 push;等待 Uria 明確授權後再推送。

# PLAYTEST-BATCH1 handoff

> 作者:`Nhalor @ Codex Desktop / UG`
> 範圍:Uria 五張 iPad 截圖提出的第一批大廳、簡報、地圖、卡片與回合流程缺陷。遭遇階段其餘問題明確留待下一批。

## 變更摘要

### 大廳與存檔分離

- 新增 `/saves`:登入、存檔建立/選擇/退休與正式 64 人名冊都在此完成。
- 大廳固定為玩家一席加三名隊友,不再混入存檔格;最左席固定為玩家,不顯示 MBTI。
- `is_preset=false` 的舊 G1「無名鐵證偵探」不進建立名冊;舊存檔會標示不可使用,可退休但不可開局。
- 四席人物與四種棋子改用本輪 Imagegen PNG 資產;hotspot 只保留可讀入口文字,隱藏校準框。

### 簡報、地圖與卡片

- 簡報正文改為可讀的繁體中文襯線字;MIGRATION_045 只在舊句仍存在時移除「身為 S 鐵證」固定假設。
- 地點依真實 `connectedTo` 畫線,障礙連線用虛線;新增純函式與測試。
- 卡片類型中文化,關閉移至右上角。
- legacy 簽名卡 adapter 將 `play_effect` / `play_effect_code` / commit icon 正規化。
- MIGRATION_045 為 ESFJ-1「鼓舞士氣」補正式效果碼;引擎實作同地點全員治療 2 SAN 並讓出牌者抽 1 張。

### Log 與回合流程

- AI 每次行動完成即把完整 step 寫入 Log,不再等可能落後的顯示佇列。
- AP 大於 0 時不顯示結束階段;AP 歸零後只保留結束階段按鈕。
- 結束後依序顯示城主提示,自動結算敵人,進入補給提示。
- 玩家手牌超限改為延後棄牌:選到精確張數、中央預覽、確認後才寫入棄牌堆;AI/模擬仍沿用自動棄牌。
- 補給後顯示重整與新回合提示,再恢復 AP、狀態與 AI 行動。

完整逐項對照:`docs/實玩缺陷修正批次1_26071103.md`。

## 動過的檔案

- `docs/實玩缺陷修正批次1_26071103.md`
- `packages/client/public/game-art/lobby-seats/*.png`
- `packages/client/public/game-art/pawns/*.png`
- `packages/client/src/App.tsx`
- `packages/client/src/game/cardDataAdapter.ts`
- `packages/client/src/game/cardLab.test.ts`
- `packages/client/src/game/gameSetup.ts`
- `packages/client/src/game/investigatorRoster.ts`
- `packages/client/src/game/investigatorRoster.test.ts`
- `packages/client/src/game/mapConnections.ts`
- `packages/client/src/game/mapConnections.test.ts`
- `packages/client/src/screens/LobbyScreen.tsx`
- `packages/client/src/screens/LobbyScreen.css`
- `packages/client/src/screens/SaveManagementScreen.tsx`
- `packages/client/src/screens/SaveManagementScreen.css`
- `packages/client/src/screens/ScenarioBriefingScreen.css`
- `packages/client/src/screens/TestScenarioScreen.tsx`
- `packages/client/src/screens/TestScenarioScreen.css`
- `packages/server/src/db/migrate.ts`
- `packages/shared/src/game/ruleEngine.ts`
- `packages/shared/src/game/ruleEngine.test.ts`
- `packages/shared/src/game/upkeep.ts`
- `packages/shared/src/game/upkeep.test.ts`

## 測試結果

```text
client tsc -b:exit 0
server tsc --noEmit:exit 0
client vite build:117 modules transformed,built in 1.39s,exit 0
ruleEngine.test.ts:88 passed,0 failed
upkeep.test.ts:13 passed,0 failed
turnLoop.test.ts:6 passed,0 failed
cardLab.test.ts:3 PASS
investigatorRoster.test.ts:1 PASS
mapConnections.test.ts:1 PASS
battleLogPreview.test.ts:1 PASS
node scripts/preflight.js:ALL PASS
git diff --check:exit 0
```

Vite 仍只有既有警告:重複 `clues_spent` case、主 bundle >500 kB;本輪未新增重複 case,也未做範圍外拆包。

## 畫面與行為驗證

- 桌機 1280x720:大廳四席、四個 Imagegen 人物、文字入口都可見;地圖有 2 條連線與 4 枚不同色棋子。
- iPad 1024x768:大廳與遊戲桌面 `document.scrollWidth === innerWidth`;棋子、地點、右側 Log 與底部操作列沒有互相遮蔽。
- 實跑 AP 3→0:一般動作按鈕隱藏,只剩「結束調查員階段」。
- 實跑完整轉場:「有神秘的事情發生了！」→ 敵人自動結束 → 回合補給 → 重整 → 新回合,T2 AP 回到 3。
- 實跑手牌 9 張:未選牌時確認停用;選中 `.45 手槍` 後卡片移到中央,確認啟用;確認後才棄牌並進新回合。
- AI Log 實際包含伊萊亞斯、薇絲珀、艾達三名隊友各三次調查的完整骰值、結果與效果。
- 本機 DEV `/lobby?preview=1` 與 `/scenario/preview` fixture 已移除,未進 commit。

## 自知風險與部署順序

- MIGRATION_045 必須先由 server 部署執行,正式環境才會看到新版簡報與「鼓舞士氣」正式效果碼;client adapter 可讀舊資料,但空效果碼無法憑空決定玩法。
- 部署後 smoke:Creator01/02 登入 `/saves`→舊測試存檔不可點→建立/選擇 64 人存檔→大廳四席→雨夜簡報無 S 鐵證句→打出鼓舞士氣確認同地點全員 SAN 與抽牌 Log。
- 回合轉場使用 1.5 秒提示。若 encounter 或傷害分配 modal 尚未完成,自動結算會等待 blocker 清除後再繼續。
- 本輪依 Uria 指示不處理尚未截圖說明的遭遇階段缺陷。

## Review

**PASS**(守燈人代理 Hammon @ GAS Hub,2026-07-11;本輪 review-only,依指示**未 push**,等 Uria 授權)

依代理 review checklist:

1. **commit/清單**:`a420d25` 單筆,30 檔與 handoff 一致;規則書/docs/v07*/關卡/城主凍結資料零觸碰。
2. **複跑**:ruleEngine **88/88**、upkeep **13/13**、turnLoop **6/6**、cardLab 3/3、investigatorRoster 1/1、mapConnections 1/1、server/client tsc exit 0、preflight ALL PASS。
3. **涉引擎 → sim 已跑**:`sim-slit-3ai.ts` 完整跑完不崩(3 AI 指派對齊、城主啟用 28 次、遭遇 42 次,流程完整結束)。
4. **歷史紅線逐條**:
   - **updatedAllies 管線**:`heal_san_at_location` 的隊友治療走 `partyUpdatedAllies` 併入 `cardKillAllies` 管線回寫,不是只改本地快照——多人一致性正確。actor 治療 clamp(min(sanMax)) 正確,跳過 permanentlyDead 與異地者正確。
   - **計時器競態**:回合轉場提示為顯示層,結算等待 blocker modal 清除後續行(handoff 明載);未見 setTimeout 閉包寫 state。
   - **腳本冪等**:MIGRATION_045 兩段 UPDATE 都有 guard(cover_narrative LIKE 舊句才改;play_effect_code IS NULL/空陣列才補)——重跑零副作用,code-addressed 正確。
5. **手牌延後棄牌**:`discardForHandLimit` 驗證完備(精確張數/不重複/必在手牌/未超限拒絕),`deferHandLimit` 只發 `hand_limit_required` 事件不動狀態;AI/模擬沿用自動棄——玩家/AI 雙軌分離乾淨。
6. **一個非阻斷 nit(記錄不擋)**:`{...post.updatedAllies, ...partyUpdatedAllies}` 合併順序在「同一張事件卡同時治療與擊殺波及同一隊友」時 party 版本會覆蓋 post 版本;現行只有鼓舞士氣使用此效果碼、無擊殺面,實際不可觸發。未來新增同時含 heal_san_at_location+傷害效果的卡時需改為疊加合併。

**部署順序**(handoff 已載):MIGRATION_045 先上 server;部署後 smoke=creator 登入 /saves→舊存檔不可開局→64 人名冊→簡報無 S 鐵證句→鼓舞士氣同地點全員 SAN+抽牌 Log。

結論:引擎改動測試+sim 全綠、紅線逐條過、migration 冪等,PASS。push 等 Uria 授權。

