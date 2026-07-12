你是守燈人代理，照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行，結論以 PASS/WARN/BLOCK 開頭回覆。

# PLAYTEST-BATCH3-26071202 Handoff

交件者：Nhalor @ Codex Desktop / UG

> 本次請只 review，不要代為 push。Uria 尚未在本工作包明示授權 push；review PASS 後由 Nhalor 回報等待授權。

## 需求與完成結果

1. **無具象人像的大廳與載入畫面**
   - 新增 Imagegen 產生的無人調查室底圖；大廳與 Splash 的底圖／L1 preload 不再引用舊有人像畫面。
   - 移除先前錯誤的 React 閃電、爐火效果，保留靜態膠片顆粒。
   - 大廳四席使用六種匿名桌遊棋子原型，依調查員職業名稱做決定性映射；最左席仍是玩家，換人後與 AI 組隊同步換棋子。
   - 大廳物件改為圓形命中區與無框線回饋，入口名稱恆常可讀；不再以矩形輪廓提示點擊區。
2. **匿名棋子原型貫穿戰鬥**
   - 新增 archivist/healer/craftsperson/watchman/performer/mystic 六種透明 PNG 棋子。
   - `investigatorVisuals.ts` 以職業關鍵字映射原型，並用隊伍槽位提供玩家代表色；不以 MBTI 或臉孔作身份識別。
   - 地圖棋子移入地點插圖內；左下調查員狀態區與隊伍 modal 同樣使用該原型，避免不同畫面出現不同角色符號。
3. **地點互動與 HUD 收斂**
   - 地點卡加高，線索移至最下方；圓形調查按鈕固定左下、移動按鈕固定右下。
   - 只有當動作合法才顯示按鈕；動作處理中保留該按鈕呈現既有 feedback，完成後依合法性重新判定顯隱。
   - 移除下方重複的移動／調查入口，地圖連線保留。
   - 玩家資源、手牌、牌庫、棄牌、除外、額外牌組搬至右下，和系統按鈕形成同一組木質／黃銅控制區；左下玩家狀態區改為無人像的木質棋子框。
4. **關卡開場說明**
   - 正式關卡 bootstrap 後先彈出開場卡，並列當前 Act 與 Agenda 的名稱、敘事、目標／危險；關閉「開始調查」前不開放玩家地圖行動。
   - 卡片檢驗所為 sandbox，維持不彈此開場卡。
5. **視覺權威與規劃**
   - 新增 `docs/實玩回饋改動規劃_大廳與戰鬥盤面_26071202.md`，列出本批範圍、驗收與不處理項目。
   - 已同步更新工作區外的權威 `C:\Ug\docs\GamePlan\DESIGN.md`：禁止具象人像、匿名棋子與座位同源、紀念相框不再使用人像。

## 動過的檔案

- `docs/實玩回饋改動規劃_大廳與戰鬥盤面_26071202.md`
- `packages/client/public/game-art/lobby-v3/investigator-study-empty.png`
- `packages/client/public/game-art/pawns/archetypes/{archivist,healer,craftsperson,watchman,performer,mystic}.png`
- `packages/client/src/game/gameSetup.ts`
- `packages/client/src/game/investigatorVisuals.ts`
- `packages/client/src/game/investigatorVisuals.test.ts`
- `packages/client/src/game/preloadPlan.ts`
- `packages/client/src/screens/LobbyEffects.tsx`
- `packages/client/src/screens/LobbyScreen.tsx`
- `packages/client/src/screens/LobbyScreen.css`
- `packages/client/src/screens/SplashScreen.css`
- `packages/client/src/screens/TestScenarioScreen.tsx`
- `packages/client/src/screens/TestScenarioScreen.css`

## 測試結果原文

### Client game tests

```text
battleLogPreview.test.ts: 1 passed, 0 failed
cardLab.test.ts: PASS card lab setup uses two locations, a harmless dummy, and no save mode
cardLabQuality.test.ts: PASS card lab quality search, filters, and issue report
displayName.test.ts: 4 passed, 0 failed
investigatorRoster.test.ts: 1 passed, 0 failed
investigatorVisuals.test.ts: 7 passed, 0 failed
locationActionFeedback.test.ts: 4 passed, 0 failed
mapConnections.test.ts: 1 passed, 0 failed
selectedSave.test.ts: PASS selected save persists active save identity
```

### TypeScript / build / static gates

```text
packages/client: tsc -b --pretty false: exit 0
packages/client: vite build: 122 modules transformed; built in 1.40s
node scripts/preflight.js: ALL PASS
git diff --check: exit 0 (only existing CRLF conversion warnings)
```

## 自知風險與範圍外發現

- 內建 Browser 可啟動，但其隔離網路無法連到此工作階段的 `127.0.0.1:5173`，回報 `ERR_CONNECTION_REFUSED`；因此未取得自動 iPad 截圖。素材已逐張檢視、透明棋子角落 alpha 驗證為 0，並完成 Vite production build。仍需 Uria 在 iPad 橫向實機確認命中區與文字密度。
- 64 格目前是以職業名稱的決定性規則歸類六種原型，而不是逐人獨立資料表；符合「有限原型、不可用臉孔」裁定，但未來新增職業名稱若不命中規則會落到 archivist fallback，應在新增職業時補測試。
- 右上戰役紀錄的四人摘要既有 `battleLogPreview.test.ts` 已驗證四名 actor 不被裁切；本批未改 Log 引擎或 AI 行動排程。
- Vite 既有單一 bundle 約 586 kB 警告仍存在；本批只換 L1 大廳圖與 L2 匿名棋子，不擴張至 code splitting。
- 本批未改 Act／Agenda 資料、城主 AI、規則書 `docs/v07*`、關卡或城主凍結資料。

## Review

**WARN**(守燈人代理,2026-07-12;程式碼審查本身無阻擋級缺陷,WARN 主因是本代理環境無法複跑測試 + 一項小型 UI 規格偏差,詳下)

### Checklist 執行結果

1. **commit 對賬:PASS** — `git log origin/main..HEAD` 僅 da8c187;`git show --stat` 19 檔與 handoff 清單一致(多出 handoff 檔本身,合理)。
2. **範圍與禁碰區:PASS** — 全部變更在 client 套件 + 兩份規劃文件;`docs/v07*`、凍結關卡/城主資料、引擎(shared)零觸碰。與《實玩回饋改動規劃_大廳與戰鬥盤面_26071202.md》工作範圍 A–E 逐項對得上;「不在本批」清單(閃電/壁爐不重做、不改規則資料)也守住了。
3. **複跑測試:BLOCKED(留守燈人本尊複核)** — 本代理 session 權限層擋下所有 node/tsx/tsc 執行(含子代理),八個測試與 `tsc -b` 無法獨立複跑。靜態核對:`investigatorVisuals.test.ts` 確為 6+1 個斷言,與貼上的「7 passed」相符;`templateCode`/`title_zh` 在 `InvestigatorAIProfile` 上存在、`cardLab.ts` 以 `...base` 繼承新增的 `investigatorVisualCode/Title` 欄位,型別面看不出會炸的點。**請本尊或 Uria 在互動 session 補跑一次確認全綠。**
4. **引擎 sim:N/A** — 未動 shared/引擎,免跑。
5. **歷史紅線:PASS** — 未觸 updatedAllies 管線;移除的 LobbyLightningEffect 反而消掉了一組 setTimeout 寫 state 的舊模式,新程式無新增計時器;無腳本。
6. **素材目視查驗:PASS** — 大廳底圖為無人空景(四椅 + 天平/香爐/鐵砧/藥瓶/帳本/厚書/封蠟信/地圖,與八個入口座標逐一對位吻合);六顆棋子為透明底匿名木質棋具,mystic 兜帽內無臉,符合「禁止具象人像」裁定。舊 `lobby-v2/investigator-study.jpg` 與 `investigator-fallback.jpg` 在 src 已無殘留引用。

### 發現事項

- **[WARN-1] 移動回饋期間按鈕顯隱違反 C.5「不可行動時不顯示」**(`TestScenarioScreen.tsx:2474`):`showMove = !isCurr && (canMoveHere || actionFeedback?.key === 'move')` — 玩家點移動後的處理期間(約 1 秒),**所有**非當前地點(含鎖定、不可達的)都會短暫冒出「移動中…」按鈕,而非只保留被點的那顆。修法建議:actionFeedback 記下目標 locationId,顯示條件改成比對該地點。屬瞬時視覺瑕疵,不擋主流程,可併下批修。
- **[WARN-2] 素材重量**:大廳底圖從 305KB jpg 換成 2.34MB png,且屬 L1 開機 preload,iPad 行動網路下 splash 會明顯變慢;六顆棋子共約 6.4MB(L2 deferred)。建議下批壓成 webp/有損 jpg 或縮尺寸,不必改本批程式。
- **[Note-1] 教學關卡也會彈開場卡**:`openingBriefing = !isCardLab`,故 `/scenario/test` 教學關同樣彈出(handoff 寫「正式關卡 bootstrap 後」)。教學關有幕/議程資料、內容顯示正常,行為無害,但與敘述不完全一致,記錄備查。
- **[Note-2] focus 指示**:`.lobby-prop:focus-visible { outline: none }` 以圓形微光取代矩形 outline,符合 2.2「不得露出矩形框線」裁定,但鍵盤焦點指示對比偏弱,留給日後 a11y audit。
- **[Note-3] 未驗證項**:工作區外的 `C:\Ug\docs\GamePlan\DESIGN.md` 更新(代理無讀取權限)與 iPad 實機截圖(handoff 已自報)——維持 handoff 原標記,待 Uria 實機確認。

### 結論

程式碼與素材審查通過,範圍乾淨、紅線無虞;但依 checklist 第 6 條「任何不確定 → 不 push」:測試複跑受權限限制未能獨立執行,標**留守燈人本尊複核**。本次依工作包指示**不 push**(Uria 未授權)。WARN-1 可與下批一併修,不要求單獨返工重送;本尊(或互動 session)補跑測試全綠後,本包即可視同 PASS 進入等待 push 授權狀態。

### Codex 修訂：WARN-1（待再審）

- `ActionFeedback` 新增 `targetLocationId`；`submitIntent('move')` 將點擊的目標地點寫入 feedback。
- 地圖的處理中移動按鈕改為以 `feedbackTargetsLocation(...)` 比對當前地點，因此只有被點擊的目的地保留回饋；其他不可達／鎖定地點仍完全隱藏。
- 新增 `locationActionFeedback.test.ts`，覆蓋「目的地可見、其他地點不可見、不同動作不互相匹配」四個斷言。
- 修訂後複跑：`locationActionFeedback.test.ts` 4 passed、`investigatorVisuals.test.ts` 7 passed、`battleLogPreview.test.ts` 1 passed、client `tsc -b` exit 0、Vite build exit 0、preflight ALL PASS。

此修訂將 amend 至同一筆未推送 commit；請守燈人代理只複核 WARN-1 是否已消除，並保留原本「測試獨立複跑受代理權限限制」的註記。

### 再審結論：WARN-1（守燈人代理，2026-07-12）

**PASS** — WARN-1 已消除。本次再審僅核對 WARN-1 修正，靜態審查未推送 commit `39cd79f`（已含 amend 修訂），逐項確認：

1. **targetLocationId 貫穿完整**：`ActionFeedback` 介面已加 `targetLocationId?`（`TestScenarioScreen.tsx:438`）；`submitIntent` 於 move 動作時自 payload 取出目標地點（1478–1480），**processing 與 rejected 兩條路徑**（`holdActionFeedback` 1481、`rejectActionFeedback` 1595）都有帶入——失敗回饋不會因缺 target 而全域消失。
2. **顯示條件已限定被點地點**：`showMove` 改為 `canMoveHere || feedbackTargetsLocation(actionFeedback, 'move', loc.locationDefinitionId)`（2479–2481）。處理期間 `canUseMapActions` 含 `!actionFeedback` 使 `canMoveHere` 全為 false，故只有 `targetLocationId` 相符的那一格保留「移動中…」按鈕；鎖定／不可達地點不再短暫冒出按鈕。全檔僅一處 `submitIntent('move', ...)` 呼叫（2551）且必帶 `targetLocationId`，無漏網入口。`showInvestigate`（2478）雖未走新函式，但受 `isCurr` 限定於當前地點，無同類外洩。
3. **回歸測試覆蓋確認**：`locationActionFeedback.test.ts` 四個斷言與宣稱一致——目的地可見、其他地點不可見、跨動作不匹配、非 move 動作（investigate）不受 targetLocationId 限制。`feedbackTargetsLocation` 為純函式抽出（`locationActionFeedback.ts`），`ActionFeedback` 對 `LocationActionFeedback` 結構相容，型別面無疑點。

**保留註記**：本代理環境權限層仍擋下 node/tsx 執行，八個測試與 `tsc -b` 依然無法獨立複跑；Codex 自報「4 passed / tsc exit 0 / build exit 0 / preflight ALL PASS」以靜態核對佐證後採信，維持原「留守燈人本尊（或 Uria 互動 session）補跑確認全綠」的條件。WARN-2（素材重量）、Note-1～3 不在本次再審範圍，維持原記錄。本次依工作包指示**不 push**。
