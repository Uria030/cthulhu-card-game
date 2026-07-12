> 你是守燈人代理，照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行；結論以 PASS/WARN/BLOCK 開頭回覆，並寫回本檔的 `## Review` 區段。

# VISUAL-REMAKE-P1-PREVIEW - 可部署大廳校準預覽

> 作者: Nhalor @ Codex Desktop / UG
> 起因: Uria 2026-07-12 裁定，互動與視覺改動必須在 push 後由正常測試流程驗收；未被 runtime 引用的素材不算可驗收版本。
> 範圍: 將已通過素材校準 review 的 A 大廳底圖接到正常 Lobby，供部署環境直接驗收。

## 變更摘要

- Lobby 正常路徑改用 `game-art/lobby-v4/study-base.webp`，不是新隱藏頁或孤立預覽。
- 依新書房桌面配置，重對位八個既有入口熱區：帳本、天平、香爐、鐵砧、藥瓶、厚書、封蠟文件與地圖。
- 移除舊版 `lobby-seat-token` 棋子覆蓋層及其 CSS。工單明定棋子不得出現在大廳；Phase 2 的 24 張座位人影尚未核可，故此處維持無人空間與空椅。
- Film grain 改取同一張 v4 底圖，避免背景與顆粒層不一致。

## 動過檔案

- `packages/client/src/screens/LobbyScreen.tsx`
- `packages/client/src/screens/LobbyScreen.css`

## 驗證結果

```text
# client standalone game tests
battleLogPreview.test.ts             PASS
cardLab.test.ts                      PASS
cardLabQuality.test.ts               PASS
displayName.test.ts                  PASS
investigatorRoster.test.ts           PASS
investigatorVisuals.test.ts          PASS
locationActionFeedback.test.ts       PASS
mapConnections.test.ts               PASS
selectedSave.test.ts                 PASS

packages/client/node_modules/.bin/tsc.CMD -b --pretty false
PASS

packages/client/node_modules/.bin/vite.CMD build
PASS (123 modules transformed)

node scripts/preflight.js
ALL PASS - 可推送

git diff --check
PASS
```

## 部署驗收項目

從正常登入 -> 存檔 -> 大廳確認：

1. 書房底圖確實載入，沒有舊版人物/棋子覆蓋層。
2. 八件桌上物件的 hover/click 區與實物對位，不遮擋地圖入口或其他物件。
3. 左側隊伍名冊、標題與底部提示不遮擋桌面主要入口。
4. iPad 橫向畫面下，地圖紙仍可點選並進入出發板。

## 已知限制與範圍外

- 本機 Vite 背景程序在此執行隔離環境未成功綁定 `5173`，因此沒有本機瀏覽器截圖；production build 成功，實際對位驗證交由部署後的正常 Lobby 流程。
- 沒有開始 B 座位人影、C 其餘 240 張棋子、E 儀表板切片/HTML 接線，也沒有改動引擎、規則、關卡或城主資料。
- 這是可逆的 Phase 1 實機預覽接線；Uria 回饋決定下一階段，不阻擋本次已審查版本 push。

## Review

**PASS**(守燈人代理 Hammon @ GAS Hub,2026-07-12)

依代理 review checklist:

1. **commit/清單**:`01169ce` 單筆,3 檔(Lobby tsx/css + handoff)與 handoff 一致;引擎/規則/關卡/城主/server 零觸碰。
2. **複跑**:client 9 支 standalone 測試全綠(battleLogPreview/cardLab/cardLabQuality/displayName/investigatorRoster/investigatorVisuals/locationActionFeedback/mapConnections/selectedSave)、tsc exit 0、preflight ALL PASS、vite build 成功。
3. **diff 審**:
   - 底圖切換 `lobby-v3 → lobby-v4/study-base.webp` 走正常 Lobby 路徑,非隱藏頁——符合 Uria「必須 push 後由正常流程驗收」的裁定。
   - 八個入口熱區重對位座標與 v4 底圖實際物件位置一致(香爐左下/天平左/鐵砧中左/藥瓶中/帳本與封蠟文件中下/地圖右/厚書右下,對照我上輪抽驗的底圖構圖吻合)。
   - 舊 `lobby-seat-token` 覆蓋層與 SEAT_POSITIONS 全數移除、無殘留 import——工單「棋子不得出現在大廳」+「Phase 2 人影未核可前維持無人」正確落地。
   - film grain 改取同一張 v4 底圖,顆粒與背景一致。
   - 改動可逆(單一 img src + 熱區座標),回退成本低。
4. **無自動截圖**:本機 5173 綁定失敗已誠實記載;production build 綠,實機對位驗收本來就設計為部署後由 Uria 正常流程執行——與起因裁定一致,不算缺口。

結論:接線乾淨、測試全綠、流程符合 Uria 裁定,PASS。部署後請依「部署驗收項目」四點實測(重點:八物件 hover/click 對位、iPad 橫向地圖紙可點)。
