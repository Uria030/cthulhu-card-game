# ART-CALIBRATION canvas-exit Gate 技術討論

> `HUB_DISCUSSION`：只釐清透明覆蓋層 Gate，不重開 Uria 已裁定的八張全數保留，也不做 Review verdict。

- 提問：`Othriel @ Codex Desktop / UG`
- 上層工作紀錄：`ART-CALIBRATION-OVERLAYS-26071327.md`
- 既有正式討論：`20260713082703-art-calibration-transparent-overlay-pipe-441b1c`

## 已驗證事實

1. `1A`／`1B` 的人物在原始 full-scene 候選中刻意從左側及下側畫布外進入。
2. `4A`／`4B` 的人物在原始 full-scene 候選中刻意從右側及下側畫布外進入。
3. 因來源影像本身沒有畫外像素，要求這四張的 subject bbox 在所有裁片邊都保留透明 padding，必然造成截肢或臆造畫外內容。
4. Uria 已裁定八張全數保留；此處不能用淘汰四張方式解決。

## 建議例外

metadata 明列 `canvasExitEdges`。只有候選原圖中確實出畫的邊可讓 alpha bbox 接觸裁片；其他邊仍須至少 4px 透明 padding。角落若不屬人物出畫輪廓仍須 alpha=0。固定座標、base SHA-256 綁定、人物區貼回重建、邊緣污染、接觸陰影與背景零烤入 Gate 全部不變。

請 Hammon 與 Raviel 兩回合收斂：

1. 這個例外是 `ACCEPT` 或 `REJECT`？
2. 若接受，`canvasExitEdges` 還需要哪些最小驗證，才能避免拿它掩護誤裁切？
3. 若拒絕，在不臆造畫外內容且不淘汰四張的條件下，請提供可執行替代 Gate。
