你是守燈人代理,照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行,結論以 PASS/WARN/BLOCK 開頭回覆。

# PLAYTEST-BATCH2-26071201 Handoff

交件者: Nhalor @ Codex Desktop / UG

> 本次請只 review，不要代為 push。Uria 已明確授權 Nhalor 在 review PASS 後執行 `git push`。

## 變更摘要

- 重製調查室大廳為單一透視、同一光源的 1930 年代暖調近黑白場景，四位調查員與座椅直接生成在完整場景內，不再疊貼人物剪影。
- 大廳八個桌面物件成為可聚焦、可點擊的入口；加入窗外閃電、壁爐火光與底片顆粒 React/CSS 效果。
- 啟動畫面先載入本地大廳/門/地圖，再讀伺服器關卡與調查員資料；載入完成後以雙門開啟過場進入大廳。
- 生成並接入放大鏡、腳印、一般怪物、頭目、訓練木人透明素材；怪物在地圖上改為桌遊棋子。
- 修正右上收攏 Log：資料與畫面固定保留玩家 + 三位 AI 各一列最新摘要；移除 `200px` 裁切，第四位調查員不再消失。不是展開每人的完整歷史。
- 地圖相連線由不可見的 `0.035px` 改為 4px；調查與移動移至地點卡左下/右下，顯示用途、AP 與不可抵達狀態，底部不再重複顯示這兩種動作。
- 動作按鈕加入處理中、拒絕、按壓回饋；抽卡成功顯示實際卡名，牌庫空時顯示實際恐懼結果。
- 調查員階段開始先二選一「進行短休息 / 開始行動」；短休息放棄整回合，選定後不再與正常動作並存。
- 新增常駐玩家經濟區：資源、手牌、牌庫、棄牌、除外、額外牌組；棄牌/除外/額外區可點開檢視。
- 城主任何來源生成新敵人時顯示「有神秘的事情發生了！」；回合結束補給顯示實際抽到的卡名；敵人階段沿既有自動收尾管線進入補給/棄牌/重置/新回合提示。
- 全站載入 Noto Serif TC / Noto Sans TC 完整字重，移除戰鬥畫面的 Ma Shan Zheng fallback，統一繁體中文卡片與遭遇敘事字型。
- `C:\Ug\docs\GamePlan\DESIGN.md` 已同步 Uria 2026-07-12 視覺裁定；該檔位於 git repo 外，不能包含在本 commit/push。

## 動過的檔案

- `packages/client/index.html`
- `packages/client/public/game-art/lobby-v2/investigator-study.jpg`
- `packages/client/public/game-art/lobby-v2/office-door.jpg`
- `packages/client/public/game-art/ui/investigate-magnifier.png`
- `packages/client/public/game-art/ui/move-footsteps.png`
- `packages/client/public/game-art/monsters/monster-common.png`
- `packages/client/public/game-art/monsters/monster-boss.png`
- `packages/client/public/game-art/monsters/training-dummy.png`
- `packages/client/src/game/battleLogPreview.test.ts`
- `packages/client/src/game/cardLab.test.ts`
- `packages/client/src/game/preloadPlan.ts`
- `packages/client/src/screens/LobbyEffects.tsx`
- `packages/client/src/screens/LobbyScreen.tsx`
- `packages/client/src/screens/LobbyScreen.css`
- `packages/client/src/screens/SplashScreen.tsx`
- `packages/client/src/screens/SplashScreen.css`
- `packages/client/src/screens/TestScenarioScreen.tsx`
- `packages/client/src/screens/TestScenarioScreen.css`
- `packages/client/src/styles/global.css`
- `packages/shared/src/game/state.ts`

## 測試結果原文

### Client game tests

```text
battleLogPreview.test.ts: 1 passed, 0 failed
cardLab.test.ts: 3 passed, 0 failed
displayName.test.ts: 4 passed, 0 failed
investigatorRoster.test.ts: 1 passed, 0 failed
mapConnections.test.ts: 1 passed, 0 failed
selectedSave.test.ts: PASS
```

`battleLogPreview.test.ts` 新增驗收：

```text
✓ latestActionRows returns one current row per investigator
1 passed, 0 failed
```

### Shared regression tests

```text
upkeep.test.ts: 13 passed, 0 failed
turnLoop.test.ts: 6 passed, 0 failed
keeperAI.test.ts: 23 passed, 0 failed
encounters.test.ts: 16 passed, 0 failed
```

### TypeScript / build

```text
packages/client/node_modules/.bin/tsc.CMD -b --pretty false
Exit code: 0

packages/server/node_modules/.bin/tsc.CMD --noEmit --pretty false
Exit code: 0

packages/client/node_modules/.bin/vite.CMD build
118 modules transformed
✓ built in 1.33s
```

### Headless simulation

```text
sim-slit-3ai.ts --team elias_crane,vesper_grey,ada_wexler,marcus_wainwright --seed 2026071201
Exit code: 0
14 回合正常結束；四位調查員皆有完整行動與六項統計；城主啟用 28 次。
```

## 自知風險與範圍外發現

- 本機 in-app Browser 本輪回報沒有可用瀏覽器分頁，因此未能完成自動 iPad/desktop 截圖驗證；已完成 TypeScript、production build、行為測試與靜態響應尺寸檢查。Review 請優先實際開啟 `/lobby` 與正式關卡確認遮擋。
- Vite 仍提示單一 JS chunk 約 573 kB，屬既有拆包問題，本輪未擴張到路由 code splitting。
- `C:\Ug\docs\GamePlan\DESIGN.md` 不在 `cthulhu-card-game` git repository，內容已落檔但無法隨本 commit 推送。
- 遭遇階段尚未由 Uria 截圖列出的其他問題明確排除於本輪。

## Review

**PASS**(守燈人代理 Hammon @ GAS Hub,2026-07-12;本輪只審查不代 push——Uria 已授權 Nhalor 於 PASS 後自行 `git push`)

依代理 review checklist:

1. **commit/清單**:`9048fd2` 單筆,21 檔與 handoff 一致;規則書/docs/v07*/關卡/城主資料/server 零觸碰(僅 shared/state.ts 加一個 optional `extraDeck?` 欄位,向下相容)。
2. **複跑**:ruleEngine **88/88**、battleLogPreview 1/1、cardLab 3/3、雙 tsc exit 0、preflight ALL PASS、vite build 成功(既有 573kB chunk 警告如實記載)。
3. **涉 shared → sim 已跑**:`sim-slit-3ai.ts` 完整 14 回合不崩,四調查員完整行動,城主啟用 28 次——`extraDeck?` optional 欄位對引擎零影響驗證屬實。
4. **歷史紅線**:
   - 計時器:LobbyEffects 閃電/TestScenarioScreen toast 與 action feedback 的 setTimeout 均只寫**視覺層 state**(flash/toast/feedback),非遊戲 state,且 cleanup/ref 管理正確(clearTimeout 齊全);遊戲結算仍走既有管線。
   - 多人一致性:Log 收攏修正為「資料層固定保留玩家+三 AI 各一列最新摘要」,非顯示層裁切——第四位消失的根因(200px 裁切)已除。
   - 無腳本/migration 變更,冪等面不適用。
5. **審查註記**:
   - 本輪未能自動截圖(in-app browser 無分頁),handoff 已誠實記載並請 review 側實測——**建議 Nhalor push 後由 Uria 在 iPad 實際開 `/lobby` 與正式關卡驗遮擋**(桌機/響應尺寸已有靜態檢查)。
   - `C:/Ug/docs/GamePlan/DESIGN.md` 在 repo 外無法隨 commit 推送——記載正確,不影響本 commit 完整性。

結論:純 client 視覺/回饋層重製+一個向下相容 shared 欄位,測試/sim/build 複跑全綠,PASS。依 Uria 授權由 Nhalor 執行 push;push 後請 Uria 實機驗收大廳與戰場遮擋。
