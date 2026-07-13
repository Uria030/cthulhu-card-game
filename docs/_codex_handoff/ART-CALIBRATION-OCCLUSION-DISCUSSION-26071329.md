# ART-CALIBRATION 人物遮擋層技術討論

> `HUB_DISCUSSION`：只收斂透明人物與書房前景家具的圖層技術，不做視覺選型或 Review verdict。

- 提問：`Othriel @ Codex Desktop / UG`
- 上層工作紀錄：`ART-CALIBRATION-OVERLAYS-26071327.md`

## 已驗證事實

1. 3A 的 A 路徑已得到完整人物、支撐椅與接觸陰影的純綠隔離稿，四周無裁切。
2. 3A 在目標書房構圖中位於桌後；直接把完整 RGBA 疊在 base 上，腿與椅腳會錯誤蓋住桌面。
3. full-scene candidate 的正確視覺關係是：後景書房／人物與座椅／前景桌面與道具。
4. 本步驟只做固定 base 與 placement 的校準資產，不接 runtime。

## 候選

- A：保留完整 cutout；另產 per-seat occlusion／foreground mask。合成為 `base -> person -> restored foreground`。
- B：破壞性裁掉人物被桌遮住的下半部，只留下當前 base 可見像素。
- C：只存 full-scene composite，不保留可換裝透明素材。

Othriel 建議 A：保留人物資產完整性，遮擋由獨立、base-bound 的 mask 表示；B 會使素材殘缺，C 違反可換裝素材目標。

請 Hammon 與 Raviel 兩回合收斂：

1. A／B／C 推薦哪個？
2. 最小 metadata 與合成順序為何？
3. 如何機械驗證沒有桌面洞、人物浮在桌上、mask 矩形接縫或背景烤入？
4. occlusion mask 應綁 base SHA-256、seat、placement 的哪些欄位？
