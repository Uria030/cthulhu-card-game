你是守燈人代理,照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行,結論以 PASS/WARN/BLOCK 開頭回覆。

# CARD-LAB-QC-26071202 Handoff

交件者: Nhalor @ Codex Desktop / UG

> 本次請只 review，不要代為 push。Uria 已授權 Nhalor 在 review PASS 後執行 `git push`。

## 需求與完成結果

1. **入口移到主畫面**
   - Creator01/02 登入調查室後，桌上「玻璃藥瓶」改為可點擊的「卡片檢驗所」。
   - 非 Creator 仍看到原本未開放的製作入口，不暴露檢驗所。
   - 世界地圖上的實驗場標記與專用 CSS 已移除；實驗場返回按鈕改回調查室。
2. **取消固定牌組，改讀完整資料庫卡片**
   - 實驗場起始手牌改為空。
   - Creator API 回傳 `card_definitions + card_effects` 全卡目錄，以及全部戰鬥風格卡池。
   - 點選卡片後可「加入我的手牌」；若卡已在棄牌、除外、場上或盟友區，會先清除舊實例狀態再回手牌，避免同一卡同時存在多區。
3. **每卡持久化 PASS/WARN/BLOCK 紀錄**
   - `MIGRATION_046` 新增 `card_lab_reviews`，`card_id` 為主鍵，每張 DB 卡共用一份現行評價。
   - Creator01/02 共用評價；記錄狀態、備註、最後評價帳號與時間。
   - WARN/BLOCK 強制備註，PASS 可選填；可清除回尚未評價。
4. **搜尋、篩選與評價可見性**
   - 支援卡名、英文名、卡號、卡面／效果敘述搜尋。
   - 支援陣營、卡片類型、全部／未評／PASS／WARN／BLOCK 組合篩選。
   - 每列直接顯示評價徽記，頂端顯示已評價數量。
   - 可一鍵複製所有 WARN/BLOCK 為含卡號的 Markdown，供 Uria 回貼給 Codex 修正。

## API 與資料契約

- `GET /api/player/card-lab/cards`：Creator 專用完整卡目錄、評價、戰鬥風格池。
- `PUT /api/player/card-lab/cards/:cardId/review`：寫入或覆蓋現行評價。
- `DELETE /api/player/card-lab/cards/:cardId/review`：恢復尚未評價。
- `MIGRATION_046`：冪等建表與索引；Railway 部署先完成 migration/API 後，Vercel 面板才可載入。

## 動過的檔案

- `packages/client/src/api.ts`
- `packages/client/src/game/cardLab.ts`
- `packages/client/src/game/cardLab.test.ts`
- `packages/client/src/game/cardLabQuality.ts`
- `packages/client/src/game/cardLabQuality.test.ts`
- `packages/client/src/game/gameSetup.ts`
- `packages/client/src/screens/CardLabWorkbench.tsx`
- `packages/client/src/screens/CardLabWorkbench.css`
- `packages/client/src/screens/LobbyScreen.tsx`
- `packages/client/src/screens/DepartureBoardScreen.tsx`
- `packages/client/src/screens/DepartureBoardScreen.css`
- `packages/client/src/screens/TestScenarioScreen.tsx`
- `packages/server/src/services/card-lab.ts`
- `packages/server/src/routes/player-accounts.ts`
- `packages/server/src/routes/player-accounts.test.ts`
- `packages/server/src/db/migrate.ts`

## 測試結果原文

### Client card-lab tests

```text
PASS card lab setup uses two locations, a harmless dummy, and no save mode
PASS boot preload plan separates local shell assets and public server data
PASS adding a catalogue card returns its single instance to hand for retesting
PASS legacy signature card fields become playable card data
PASS card lab quality search, filters, and issue report
```

### 其他 client game tests

```text
battleLogPreview.test.ts: 1 passed, 0 failed
displayName.test.ts: 4 passed, 0 failed
investigatorRoster.test.ts: 1 passed, 0 failed
mapConnections.test.ts: 1 passed, 0 failed
selectedSave.test.ts: PASS
```

### Server routes / migration tests

```text
16 tests PASS
含：Creator whitelist、manifest、完整卡目錄、評價寫入、WARN/BLOCK 備註 gate、MIGRATION_046、MOD-15 密碼回歸。
```

### Rule engine

```text
packages/shared/src/game/ruleEngine.test.ts
88 passed, 0 failed
```

### TypeScript / build / preflight

```text
client tsc -b: exit 0
server tsc --noEmit: exit 0
vite build: 121 modules transformed; built in 1.34s
node scripts/preflight.js: ALL PASS
```

## 自知風險與範圍外發現

- 本機 in-app Browser 仍無可用瀏覽器分頁，未能自動產生 iPad 截圖；已以穩定 grid、固定 modal 尺寸與 820/620px responsive 斷點處理，push 後需 Uria 實機確認操作密度。
- 首次部署有 server/client 順序窗口：Vercel 若先完成，品管目錄會暫時收到 404；Railway 完成 `MIGRATION_046` 後恢復。這是部署順序，不應以 client fallback 掩蓋。
- 此目錄目前涵蓋 `card_definitions` 玩家卡；神話卡、遭遇卡、怪物招式卡不在本輪需求與資料表範圍。
- Vite 既有單 bundle 約 582 kB 警告仍存在，本輪未擴張至路由 code splitting。

## Review

**PASS**(守燈人代理 Hammon @ GAS Hub,2026-07-12;只審查不代 push——Uria 已授權 Nhalor 於 PASS 後自行 `git push`)

依代理 review checklist:

1. **commit/清單**:`531efc3` 單筆,17 檔與 handoff 一致;規則書/docs/v07*/關卡/城主/引擎(shared)零觸碰。
2. **複跑**:server player-accounts 全綠(含 MIGRATION_046 持久評價測試)、client cardLab 5/5 + cardLabQuality 1/1、雙 tsc exit 0、preflight ALL PASS。
3. **引擎**:未涉 shared/引擎,sim 免跑(實驗場仍為 resolveIntent 消費端)。
4. **API 安全審**:
   - 三條新 route(GET 目錄/PUT 評價/DELETE 評價)全部 player JWT + `isCardLabCreator` server 端白名單,非 Creator 403——與既有 card-lab gate 同構,權威在 server。
   - `parseCardLabReview`:status 白名單、notes 5000 上限、WARN/BLOCK 強制備註——與 DB CHECK(`chk_card_lab_review_notes`)雙層一致,API 層擋、DB 層兜底。
   - PUT 用 `INSERT ... SELECT id FROM card_definitions WHERE id=$1` + RETURNING 空→404——未知 cardId 不會產生孤兒列,寫法正確。
   - DELETE 冪等;卡目錄 SELECT 唯讀。
5. **MIGRATION_046**:CREATE TABLE/INDEX IF NOT EXISTS 冪等;card_id PK+CASCADE、status CHECK、notes CHECK 齊。
6. **歷史紅線**:無計時器寫 state;「加入手牌前先清除該卡在棄牌/除外/場上/盟友區的舊實例」由測試覆蓋(single instance 測試),防同卡多區。
7. **非阻斷註記**:①`reviewed_by ... ON DELETE RESTRICT`——未來若刪除 creator 玩家帳號會被此表擋住,需先清評價或改 SET NULL;creator 帳號為永久帳號,現階段無實際影響。②部署順序:Railway(MIGRATION_046+API)先、Vercel 後,否則品管目錄暫 404——handoff 已明載,不以 client fallback 掩蓋是正確決定。

結論:權限、驗證、冪等、測試齊備,PASS。依 Uria 授權由 Nhalor 執行 push;部署順序 Railway 先行。
