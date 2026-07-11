你是守燈人代理,照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行,結論以 PASS/WARN/BLOCK 開頭回覆。本輪只 review,不得 push;等待 Uria 明確授權後再推送。

# LOADER-CARDLAB handoff

> 作者:`Nhalor @ Codex Desktop / UG`
> 前置:本地尚有已通過 review、未 push 的 UI-IMAGEGEN commits `3883f3f` / `a6b5570`;本 handoff 只審本次新增 commit。

## 變更摘要

### 啟動載入分層

- Splash 改為 Logo → 載入中 → 真實進度條 → 完成淡出,不再用固定 2.5 秒空等。
- L1 只預載大廳底圖、出發地圖、公開關卡與調查員清單;API promise cache 讓大廳/出發版重用,失敗會清毒快取。
- L2 在瀏覽器 idle 時預熱戰鬥板、劇情、地點、Boss 與實驗場圖像;依賴 stage / investigator 的 bootstrap 維持在選關後讀取。
- L1 每項上限 8 秒,失敗仍放行,進入實際畫面可重試。載入時序已寫入 `docs/啟動與關卡載入分層_26071101.md`。

### Creator 卡片效果實驗場

- `GET /api/player/card-lab` 用 player JWT 的 username 只放行 `creator01` / `creator02`;其他帳號回 403。
- Creator 在出發地圖會多看到「卡片效果實驗場」入口;一般帳號不渲染入口,直接進 URL 仍須通過 server manifest gate。
- 實驗場沿用正式可玩 stage bootstrap 取得所選調查員真實牌組,再轉為兩地點 sandbox:實驗場入口、卡片實驗室。
- 訓練木人:HP 999、DC 10、傷害 0、恐懼 0、不移動、不攻擊;可單獨重置。
- 所有牌組卡片攤入手牌,資源/AP/HP/SAN 切為 99;可重置整個實驗環境。
- 卡片與動作仍走正式 `resolveIntent`;右側額外輸出 ACTION、卡面敘述、DECLARED effects、每個實際 EFFECT 與 AP/資源/HP/SAN/地點/線索/敵人 HP 前後差。
- Log 上限在實驗場提高到 300 行,提供複製 Log 與清空;copy 有 Clipboard API + `execCommand` fallback。
- `sandbox` 明確阻止戰役進度、存檔、死亡與結局寫回。
- 用 Imagegen 新增入口與實驗室兩張 JPEG 專圖。

## 動過的檔案

- `docs/啟動與關卡載入分層_26071101.md`
- `packages/client/public/game-art/location-lab-entrance.jpg`
- `packages/client/public/game-art/location-card-lab.jpg`
- `packages/client/src/api.ts`
- `packages/client/src/game/preload.ts`
- `packages/client/src/game/preloadPlan.ts`
- `packages/client/src/game/cardLab.ts`
- `packages/client/src/game/cardLab.test.ts`
- `packages/client/src/game/gameSetup.ts`
- `packages/client/src/screens/SplashScreen.tsx`
- `packages/client/src/screens/SplashScreen.css`
- `packages/client/src/screens/DepartureBoardScreen.tsx`
- `packages/client/src/screens/DepartureBoardScreen.css`
- `packages/client/src/screens/TestScenarioScreen.tsx`
- `packages/client/src/screens/TestScenarioScreen.css`
- `packages/server/src/services/card-lab.ts`
- `packages/server/src/routes/player-accounts.ts`
- `packages/server/src/routes/player-accounts.test.ts`

## 測試結果

```text
client tsc -b:exit 0
client vite build:112 modules transformed,built in 1.34s,exit 0
server tsc --noEmit:exit 0
player-accounts.test.ts:13 PASS
cardLab.test.ts:2 PASS
ruleEngine.test.ts:87 passed,0 failed
node scripts/preflight.js:ALL PASS
git diff --check:exit 0
```

Vite 仍只有既有警告:重複 `clues_spent` case、主 bundle >500 kB;本輪未改該既有 case。

## 畫面與行為驗證

- Splash DOM 實際顯示 `載入中`、progressbar、工作標籤、百分比與本機/伺服器來源。
- 桌機實驗場:兩張地點、木人、狀態列、展開 Log 與底部正式動作列無溢出。
- iPad 1024×768:兩張地點卡完整落在右側 Log 左方;`overflowX=false`,`overflowY=false`。
- 實際按「拿資源」後 Log 產生:
  - `[LAB][ACTION] gain_resource ... outcome=accepted`
  - `spend_action_point` / `gain_resource` 兩筆 EFFECT
  - `[LAB][STATE] AP 99→98 | 資源 99→100 | ... | 敵人HP 999→999`
- 本機 DEV 視覺 fixture 已移除,`preview=1` / `makeTestSetup` 無殘留。

## 自知風險與部署順序

- client 的實驗場要等新 server endpoint 部署後才能正式進入;未部署期間會明確顯示 endpoint 失敗,不是引擎缺陷。
- 正式環境尚未 smoke Creator 真實牌組,因 server commit 尚未部署。部署後需用 Creator01/02 各登入一次,確認出發版入口、兩地點與至少一張實際卡的完整 Log。
- 本機 in-app browser 不授權 clipboard,因此只能驗證按鈕與 fallback 無 console error;Railway HTTPS 環境應走標準 Clipboard API,部署後列入 smoke。
- 實驗場目前使用第一個可玩主線 bootstrap 當牌組資料載體;不讀其地點、敵人、議程或結局。未來若有專用「全卡牌測試包」再替換 base stage 選擇策略。
- 實驗場不提供管理員或 Creator 以外帳號;白名單是有意的硬編碼產品規則。

## Review

**PASS**(守燈人代理 Hammon @ GAS Hub,2026-07-11;本輪 review-only,依指示**未 push**,等 Uria 授權)

依代理 review checklist:

1. **commit/清單**:本次新增 commit `87e60a1`(前置 `3883f3f`/`a6b5570` 為已過審 UI-IMAGEGEN,不重審),19 檔與 handoff 一致。
2. **範圍**:client 載入分層+實驗場、server 僅新增 card-lab manifest route(唯讀 SELECT)+ 白名單 service;規則書/關卡/城主資料/引擎/DB schema/MOD-15 vault 零觸碰。
3. **複跑**:player-accounts.test.ts **13/13 PASS**、cardLab.test.ts **2/2 PASS**、server/client tsc exit 0、preflight ALL PASS。與 handoff 原文相符。
4. **引擎**:引擎/shared 未動,實驗場走正式 `resolveIntent` 消費端;sim 免跑(handoff 附 ruleEngine 87 綠)。
5. **歷史紅線**:preload `withTimeout` 正確清 timer、無 setTimeout 閉包寫 state;API promise cache 失敗清毒(防 poisoned cache);sandbox 寫回阻斷驗證屬實——`setup.sandbox` 於 TestScenarioScreen 822/842 兩處 early-return,戰役進度/存檔/死亡/結局不寫回。
6. **安全審**:
   - `/api/player/card-lab`:player JWT preHandler + server 端 `isCardLabCreator` username 白名單(trim+lowercase),非白名單 403;client 入口不渲染只是 UX,權威在 server gate——正確。
   - 白名單硬編碼=明示的產品規則,記載於自知風險,接受。
   - manifest SQL 唯讀 LIMIT 1,無寫入面;無 secret 落 client。
7. **實驗場資料面**:`buildCardLabSetup` 純函式轉換、木人 0 傷 0 恐 0 攻速、act/agenda 閾值 999 不推進;基座 stage 只借牌組不讀其地點/敵人/結局——與 handoff 描述一致。

**部署順序提醒**(handoff 已自知):client 需等 server endpoint 部署後實驗場才可進;部署後 smoke=creator01/02 各登入→出發版入口→兩地點→至少一張實卡完整 Log+clipboard。

結論:分層載入契約清楚、實驗場權限 server 端守住、sandbox 阻寫回驗證屬實、測試複跑全綠,PASS。push 等 Uria 授權。
