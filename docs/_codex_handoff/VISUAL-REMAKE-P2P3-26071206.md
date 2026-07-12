你是守燈人代理，照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行，結論以 PASS/WARN/BLOCK 開頭回覆。

# VISUAL-REMAKE P2/P3 Handoff (26071206)

署名：Nhalor @ Codex Desktop / UG

## 範圍

依 `docs/視覺重製工作計畫_調查室與戰鬥介面_26071203.md` 完成：

- Phase 2：64 職業 x 4 玩家色棋子（256 張）與 4 席 x 6 匿名職業原型座位圖（24 張）。
- Phase 3：大廳、戰鬥盤的資料驅動接線；固定 HUD 的木質儀表板；介面大小設定。

未修改引擎規則、關卡/城主資料、地點卡圖、規則書或 server。

## 變更摘要

1. `investigatorVisuals.ts` 現以有效的 64 格 career code 解析棋子路徑；戰鬥盤依玩家座位選擇 `p1` 至 `p4`。缺少或歷史格式的 code 仍退回既有匿名原型素材。
2. 大廳以同一職業→六原型映射挑選座位覆蓋素材。四張座椅各自使用鎖定底圖裁片合成，隊伍成員變更時座位人影與紙牌名籤同步更新；棋子不進大廳。
3. 新增 256 張 512x768、帶 alpha 的 WebP 棋子與 24 張座位 WebP，並將已核准儀表板校準素材裁成 runtime shell。
4. 戰鬥盤左下改為調查員木質儀表（隊伍、體力、理智、手牌），右下改為帳房木質儀表（資源、牌庫/棄牌/除外/額外、背包、系統）。動態數字均保留 HTML 活字；棄牌等檢視入口依目前手牌面板頁籤規劃保留，未新增規則行為。
5. 設定選單新增固定 HUD 縮放：85/100/115/130%，以 `localStorage` 持久化；地圖自身縮放狀態不受影響。

## 動過檔案

- `packages/client/public/game-art/pawns/v2/`：新增其餘 240 張四色職業棋子（既有 16 張不改）。
- `packages/client/public/game-art/lobby-v4/seat-*.webp`：新增 24 張座位覆蓋素材。
- `packages/client/public/game-art/ui-shells/`：新增 7 張裁切後的 HUD 外殼素材。
- `packages/client/src/game/investigatorVisuals.ts`
- `packages/client/src/game/investigatorVisuals.test.ts`
- `packages/client/src/screens/LobbyScreen.tsx`
- `packages/client/src/screens/LobbyScreen.css`
- `packages/client/src/screens/TestScenarioScreen.tsx`
- `packages/client/src/screens/TestScenarioScreen.css`

## 素材驗收

| 項目 | 結果 |
|---|---|
| 職業棋子 | `256` 張，均為 `512x768`、有 alpha、每張 `<=150KB` |
| 座位人影 | `24` 張，4 席 x 6 原型、每張 `<=120KB` |
| 棋子使用層 | 僅戰鬥盤與儀表板頭像；大廳改用匿名座位人影 |
| 大廳座位 | 以鎖定 `study-base.webp` 的實際座椅裁片合成，非通用貼紙 |

## 測試結果原文

```text
packages/client: node_modules\\.bin\\tsc.CMD -b --pretty false
Exit code: 0

packages/client: node_modules\\.bin\\tsx.CMD src\\game\\investigatorVisuals.test.ts
10 passed, 0 failed

packages/client: all src\\game\\*.test.ts
9 client game test files passed

packages/client: node_modules\\.bin\\vite.CMD build
✓ 123 modules transformed.
✓ built in 1.48s
(!) existing chunk-size warning: index JS 586.90 kB (>500 kB)

repo: node scripts\\preflight.js
=== ✓ ALL PASS — 可推送 ===

asset verifier
{'pawns': 256, 'seats': 24, 'issues': []}
```

## 自知風險與範圍外

- 此交件不做登入態實玩驗收；依 Uria 的部署規則，HUB PASS 後會 push，讓 Uria 以正常帳號與 iPad 確認實際素材融合、點擊區與文字比例。
- 大廳座位覆蓋採「與底圖座椅裁片同尺寸的 WebP patch」而非純 alpha cutout，以保留生成時的椅面接觸陰影與局部光向。前端以與 `object-fit: cover` 等價的 3:2 stage 計算位置，避免不同 viewport 造成 patch 漂移；仍需實機目視確認。
- 依工作包範圍，未動地點卡、怪物素材、戰役紀錄資料結構，亦未調整核心遊戲行為。

## Review

待守燈人代理填寫。
