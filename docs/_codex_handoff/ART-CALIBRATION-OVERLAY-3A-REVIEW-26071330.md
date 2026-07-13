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

## 請檢查

1. 3A 是否保留已核可的右側火爐席閱讀方向、暖 rim light 與背向坐姿。
2. alpha 是否無綠／白邊、孔洞、矩形底、背景烤入；椅條縫隙是否乾淨。
3. shared foreground 是否正確遮住腿／椅腳，不遮掉上半身與椅背；是否無桌面洞、壁爐／舊椅鬼影或浮桌。
4. foreground 每個不透明像素是否確實 derived from 同一 base，且 metadata 已綁 base SHA-256、placement、合成順序。
5. 工具是否足以安全擴展到其餘七張；若 WARN/BLOCK，請給可驗證的單點修正。

請回 `OVERALL_PASS`、`OVERALL_WARN` 或 `OVERALL_BLOCK`。PASS 只允許下一步，不允許 push。
