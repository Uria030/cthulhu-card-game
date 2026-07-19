# ART-CALIBRATION 八席透明覆蓋層／四席組裝 Review

- 作者／交件署名：`Othriel @ Codex Desktop / UG`
- reviewer：Hammon（HUB Claude PTY）
- 狀態：待審；禁止 push
- 工作包：`ART-CALIBRATION-OVERLAYS` 撰寫拍（3A intermediate PASS 後的八席展開）
- baseline：`af0dd6e`
- review range：`af0dd6e..HEAD`
- 上層紀錄：`docs/_codex_handoff/ART-CALIBRATION-OVERLAYS-26071327.md`
- 技術討論：`docs/_codex_handoff/ART-CALIBRATION-SEAT-LAYERS-DISCUSSION-26071901.md`

## 請 Review 的範圍

1. 七張新增 chroma sources 與八席透明人物／placement／metadata／QA composites。
2. `extract-chroma-overlay.ps1` 的 `seatLayer`、canvas-exit、shared foreground、overlap z-order Gate。
3. `build-seat-overlays.ps1` 的八席固定配置與 fail-closed batch Gate。
4. `compose-seat-sets.ps1` 的 metadata-driven 全局順序與 A/B 四席組裝。
5. `silhouette-overlays/index.html` 的校準比較入口；它只引用既有 PASS 棋子與 WARN 字卡，不修改兩者。
6. 3A 舊 per-seat foreground/QA 重複檔刪除；shared foreground 現在只有 `silhouette-overlays/shared/` 一份。

## 權威決策

- Uria：八個人物候選全部保留並嘗試在後續使用。Othriel 本步依「每個變體各使用一次」的 Gate 組為 A=`1A/2C/3A/4A`、B=`1B/2D/3B/4B`；這不是替 Uria 裁定正式輪替規則。
- 透明管線 discussion：B 差分主路徑因全圖漂移 fail，依法退 A chroma；3A A 路徑已由 Hammon intermediate PASS。
- 座位層級 discussion task `20260719053410-art-calibration-seat-depth-layer-contrac-e98f40`：`seatLayer` 必填且 fail-closed；全局 `base -> behind -> shared foreground -> front`。
- 棋子 Uria PASS，直接沿用；「轟！」Uria WARN，本輪不改，正式上線前必須去矩形邊界與透明化。

## 動過的主要檔案

- `scripts/art-calibration/extract-chroma-overlay.ps1`
- `scripts/art-calibration/build-seat-overlays.ps1`
- `scripts/art-calibration/compose-seat-sets.ps1`
- `packages/client/public/game-art/calibration-26071308/silhouette-overlays/`
- 本 review 與兩份上層工作紀錄

## 實際檢查原文

PowerShell parser：

```text
PARSE_PASS scripts\art-calibration\extract-chroma-overlay.ps1
PARSE_PASS scripts\art-calibration\build-seat-overlays.ps1
PARSE_PASS scripts\art-calibration\compose-seat-sets.ps1
```

八席 batch：

```text
seat-1A behind-foreground   -180,250,532,900 left,bottom   alphaPixels=385394 coverage=0.515147 overlap=101017 mismatch=0 PASS
seat-1B behind-foreground   -260,240,639,900 left,bottom   alphaPixels=469083 coverage=0.501798 overlap=110127 mismatch=0 PASS
seat-2C behind-foreground   755,220,370,650                 alphaPixels=467831 coverage=0.559881 overlap=65527 mismatch=0 PASS
seat-2D behind-foreground   790,215,321,620                 alphaPixels=288228 coverage=0.491635 overlap=47011 mismatch=0 PASS
seat-3A behind-foreground   1100,255,353,600                alphaPixels=200882 coverage=0.500409 overlap=26331 mismatch=0 PASS
seat-3B behind-foreground   1020,250,478,560                alphaPixels=436173 coverage=0.412081 overlap=20890 mismatch=0 PASS
seat-4A front-of-foreground 940,230,620,900 right,bottom    alphaPixels=374561 coverage=0.551464 overlap=162836 mismatch=0 PASS
seat-4B front-of-foreground 1030,250,538,900 right,bottom   alphaPixels=421893 coverage=0.460894 overlap=111669 mismatch=0 PASS
```

每席另有 `greenSpill=0`、四角透明、`basePlusForegroundEqualsBase=true`、`foregroundDerivedFromBaseExact=true`。

組裝與重現性：

```text
set-A seat-1A,seat-2C,seat-3A,seat-4A F0702D257D72C3C89ED233D09C4D28F87B7B6C3EAA2FC1B0265B38C4D1EAB588 PASS
set-B seat-1B,seat-2D,seat-3B,seat-4B EE7F1D2A1F8BBECFBEECCE090B501EB54C550F546FB51D7E96AFE0CF86B471C3 PASS
REPRO_FILES=47
REPRO_HASH_MATCH=47/47
REPRO_MISSING=0
```

靜態入口與 diff：

```text
HTML_IMAGE_REFS=7
HTML_IMAGE_MISSING=0
BATCH_ROWS=8
BATCH_PASS=8
git diff --check -> exit 0
```

## 視覺檢查

- 八張個別 QA 已原尺寸目視：無綠邊、白邊、矩形接縫、桌面洞、foreground 鬼影或錯誤桌切。
- 4A/4B 位於 shared foreground 前；1/2/3 席位於後。
- A 組人物互相遮掩較多、壓迫感較強；B 組較清楚安靜。兩者均符合 Uria「八個都保留並在後續使用」的裁定。

## 已知邊界／不做事項

- 本步仍是校準件，不接 runtime、不量產 24 席或 256 棋子、不改 `DESIGN.md`。
- 校準頁以靜態檔案交付；in-app Browser 的 URL policy 禁止直接開啟 `file:`，因此瀏覽器內頁面截圖沒有作為 Gate。PNG 原尺寸目視與靜態路徑檢查才是本輪證據。
- 任何 base SHA-256、畫布、foreground polygon 或 placement 變更都使本輪校準失效，必須重跑。
- Uria 尚未裁定 A/B 的正式輪替／資料綁定規則；本步不替他決定。

## 請 Hammon 核對

1. `seatLayer` 是否確實 fail-closed，沒有散落 seat 4 特例或靜默 fallback。
2. overlap Gate 是否能證明後席被 foreground 遮擋、前席覆蓋 foreground，且 mismatch=0。
3. shared foreground 是否仍逐像素源自 frozen base，沒有 per-seat 漂移。
4. A/B 組裝是否使用八個變體各一次，且 compositor 真正由 metadata 排序。
5. 3A 舊重複檔刪除是否安全，重現性證據是否充分。

這是工作單中間步驟 Review；即使 PASS，也只能開始下一輪討論，不能 push。
