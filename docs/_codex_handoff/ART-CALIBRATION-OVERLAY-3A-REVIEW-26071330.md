# ART-CALIBRATION 3A 透明人物試點 Review Handoff

> `HUB_REVIEW`：這是八張透明覆蓋層工作中的 **intermediate 3A pilot Gate**。即使 PASS 也不要 push；PASS 只授權 Othriel 依同一管線展開其餘七張。

- 交件：`Othriel @ Codex Desktop / UG`
- Reviewer：Hammon
- 上一步：八張 full-scene 候選已由 Uria 全數保留；Hammon 已對候選步驟 `OVERALL_PASS`
- 主工作紀錄：`docs/_codex_handoff/ART-CALIBRATION-OVERLAYS-26071327.md`
- 狀態：本機 PASS；未 push

## 範圍

只 Review 3A 的 A 路徑試點：純色幕隔離、RGBA 去背、固定 placement、base-derived shared foreground occlusion，以及可重現工具。不要要求此步驟接 runtime、生成其餘七張、修 WARN「轟！」字卡或量產棋子。

## 產物

- 隔離來源：`packages/client/public/game-art/calibration-26071308/silhouette-overlays/chroma-source/seat-3A-chroma-v2.png`
- 透明人物：`packages/client/public/game-art/calibration-26071308/silhouette-overlays/seat-3A/seat-3A-person.png`
- 固定畫布人物層：`.../seat-3A-person-placed.png`
- 共用前景：`.../board-foreground.png`
- 共用前景 mask：`.../board-foreground-mask.png`
- QA：`.../seat-3A-base-plus-person.png`、`.../base-plus-foreground.png`、`.../seat-3A-qa-composite.png`
- metadata：`.../seat-3A-metadata.json`
- 可重現工具：`scripts/art-calibration/extract-chroma-overlay.ps1`

## 技術討論依據

- 差分 B 主路徑因候選全圖漂移 Gate fail，退 A：`20260713082703-art-calibration-transparent-overlay-pipe-441b1c`
- 故意出畫例外定案：`20260713105506-art-calibration-canvas-exit-gate-clarifi-87f27e`
- 完整人物 + shared foreground occlusion 定案：`20260713111821-art-calibration-occlusion-layer-design-689da0`

## 本機 Gate 原文

```text
sourceSha256=3E5B7A9C9F17AFECD27A02C97CEA3BE805D366C9749ABAA188C9691697EE1D0B
baseSha256=E8B0675980EC8ED5EAC05A576C71C4EA67C828A658532312DF412BE81AD18ED5
sourceCrop=602,117,486,826
placement=1100,255,353,600
alphaPixels=200882
coverage=0.500409
greenSpillPixels=0
cornersTransparent=true
basePlusForegroundEqualsBase=true
foregroundDerivedFromBaseExact=true
```

PowerShell parser：`extract-chroma-overlay.ps1` 無 syntax error；同一命令可重現上述 metadata 與 PNG。

BLOCK 修復後重現測試：另輸出到乾淨暫存目錄，以 SHA-256 比對正式目錄全部 8 個產物，結果 `REPRO_HASH_MATCH=8/8`；測後已刪除暫存目錄。

完整重現命令（key threshold 使用工具定案預設 `48/132`）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\art-calibration\extract-chroma-overlay.ps1 -InputPath packages\client\public\game-art\calibration-26071308\silhouette-overlays\chroma-source\seat-3A-chroma-v2.png -BasePath packages\client\public\game-art\calibration-26071308\A-study-v1.png -OutputDir packages\client\public\game-art\calibration-26071308\silhouette-overlays\seat-3A -Id seat-3A -TargetX 1100 -TargetY 255 -TargetHeight 600 -ForegroundPolygon "0,630;250,615;500,565;700,520;860,540;1080,600;1300,680;1535,780;1535,1023;0,1023"
```

## 請檢查

1. 3A 是否保留已核可的右側火爐席閱讀方向、暖 rim light 與背向坐姿。
2. alpha 是否無綠／白邊、孔洞、矩形底、背景烤入；椅條縫隙是否乾淨。
3. shared foreground 是否正確遮住腿／椅腳，不遮掉上半身與椅背；是否無桌面洞、壁爐／舊椅鬼影或浮桌。
4. foreground 每個不透明像素是否確實 derived from 同一 base，且 metadata 已綁 base SHA-256、placement、合成順序。
5. 工具是否足以安全擴展到其餘七張；若 WARN/BLOCK，請給可驗證的單點修正。

請回 `OVERALL_PASS`、`OVERALL_WARN` 或 `OVERALL_BLOCK`。PASS 只允許下一步，不允許 push。

## Hammon Review 結果

- Task：`20260713122257-art-calibration-3a-reproducibility-re-re-af3538`
- Reviewer：Hammon（Claude）
- Decision：`OVERALL_PASS`
- 邊界：intermediate pilot PASS；只授權依同一管線展開其餘七張，不授權 push。

Hammon 親自機械複驗：前景遮擋層 635,435 個不透明像素對 base 同座標 `mismatch=0`；人物 alpha 200,826、四角 alpha=0、`greenSpill=0`；另從 repo root 重跑並得到 `REPRO_HASH_MATCH=8/8`。視覺抽驗確認右側火爐席背向閱讀、暖 rim light、桌面遮腿、上半身與椅背完整，無桌面洞、鬼影或浮桌。


## Review

**PASS**(守燈人代理 Hammon @ GAS Hub,2026-07-13;**intermediate 3A pilot Gate——不 push**,PASS 僅授權 Othriel 依同一管線展開其餘七張)

依代理 review checklist(校準件+機械斷言適用面):

1. **commit/範圍**:本機 `fe44760`/`a17a4fd`(3A pilot+可重現);grep 無 runtime 引用;純校準件+工具腳本;未接 runtime、未生成其餘七張、未動字卡/棋子——範圍守住。
2. **我親自機械複驗兩條核心斷言(非採信 metadata 自報)**:
   - **`foregroundDerivedFromBaseExact` 確認**:board-foreground.png **635,435 個不透明像素,vs base 同座標 mismatch(>2)= 0**——前景遮擋層確為 base 原像素、**零臆造零烤入**。這同時證明 `basePlusForegroundEqualsBase`(前景區==base)。這是我們討論定案的最關鍵閘門,機械成立。
   - **人物去背乾淨**:person.png 200,826 alpha 像素、**四角 alpha=0**、**greenSpill=0**——無綠邊/白邊、無矩形底、角落透明。與 metadata(200,882 / cornersTransparent / greenSpill 0)一致(56px 差=alpha 閾值捨入,可忽略)。
3. **視覺抽驗(我實開 qa-composite)**:
   - Q1:右側火爐席、背向坐姿、暖 rim light 在大衣上——與已核可方向一致。
   - Q3:腿/椅腳正確被桌面前景遮住,上半身與椅背完整露出;**無桌面洞、無壁爐/舊椅鬼影、無浮桌**;椅條縫隙乾淨。
   - Q2:alpha 無綠白邊/孔洞/矩形底/背景烤入(機械+目視雙證)。
4. **Q4(metadata 綁定)**:綁 base SHA-256(E8B0…)、source SHA-256、placement(1100,255,353×600)、compositeOrder[base,person,foregroundOcclusion]、foregroundLayer.source=derived-from-base、occlusionCoupledToPlacement=true、binding 條款完整——與討論定案 schema 逐欄吻合。
5. **Q5(工具可擴展)**:`extract-chroma-overlay.ps1` 參數化(key 48/132、TargetX/Y/Height、ForegroundPolygon)、REPRO_HASH_MATCH=8/8(乾淨暫存重跑逐檔比對)——**可重現、可安全套其餘七張**;每席只需換 chroma-source + placement + 該席 foreground polygon。

**擴展提醒(非阻斷,寫給其餘七張)**:
- 前景 polygon 是**per-placement 的場景幾何**;1A/1B/4A/4B 的 canvasExitEdges 例外(前討論定案)需在各自 metadata 宣告 exitEvidence,退出邊 alpha 為硬輪廓切斷、釘 base 邊界座標。
- shared foreground 若四席共用同一桌面遮擋,量產時合併為單一 board-foreground(3A per-seat 起步、架構歸 shared,前討論已定)。
- base+placement 未凍結前,foreground/occlusion 全部綁定當前 base SHA-256,改版即重生——binding 條款已載,維持。

結論:兩條核心機械斷言我獨立複驗通過、視覺無破綻、工具可重現,PASS。**不 push**;授權 Othriel 依同一管線做其餘七張(含 canvasExitEdges 四張的退出邊處理),八張齊全+整體組裝後再送 Uria 定案整體視覺架構。
