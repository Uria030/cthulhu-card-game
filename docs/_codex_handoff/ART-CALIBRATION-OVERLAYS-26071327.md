# ART-CALIBRATION-OVERLAYS 工作紀錄 / Handoff（26071327）

> `HUB_DISCUSSION`：這是透明覆蓋層製作管線的技術討論，不是 Review，不要給程式碼交付裁決，也不要替 Uria 選視覺候選。請 Hammon 與 Raviel 兩回合交叉閱讀後，回覆推薦路徑、禁止路徑、驗證 Gate 與停線條件。

- 作者：`Othriel @ Codex Desktop / UG`
- 上一步：`ART-CALIBRATION-SILHOUETTES`，Hammon `OVERALL_PASS`
- 狀態：討論拍已收斂；Uria 裁定八張全數保留；3A 差分試點因全圖漂移 Gate 失敗，依定案退到 A 純色幕隔離試點；未送審、未 push

## Uria 裁定（2026-07-13）

Uria 判定八個候選方向都正確、品質都很好，不淘汰任何一張；後續應嘗試讓八張全部被使用。

- 左側窗邊保留：`1A`、`1B`
- 後方中央保留：`2C`、`2D`
- 右側火爐保留：`3A`、`3B`
- 右下前景保留：`4A`、`4B`

這八張從「競選稿」改列為**校準通過的座位變體種子**。本步驟先保留原圖並全部抽成透明覆蓋層；未來如何由職業原型、調查員資料或輪替規則選用，另在 runtime 接線步驟討論，不能由畫面隨機決定。

比較入口：`packages/client/public/game-art/calibration-26071308/silhouette-position-tests/index.html`

## 本步驟預定範圍

依 Uria 全數保留裁定：

1. 依八個通過方向製作八張可換裝透明覆蓋層校準件；每席兩變體。
2. 背景不得烤入；人物邊緣不得有矩形接縫、綠幕殘色、白邊或發光圈。
3. 保留帽髮／肩線／衣褶層次、局部 rim light，以及人物與椅面／地面的接觸關係。
4. 產生至少兩組四席組裝，讓每個變體都在一組實際情境中被使用一次；同頁保留上一輪 PASS 棋子與 WARN 字卡。
5. 仍不接 runtime、不開 24 席或 256 棋子量產、不套正式 `DESIGN.md`。

## 技術討論狀態

2026-07-13，Othriel 依工作流程用 HUB 第一層輕量詢問向 Hammon 比較下列路徑：

- A：依選定姿勢重新產綠幕人物，再以專用 helper 去背。
- B：完整場景候選與無人 base 做差分／局部遮罩。
- C：經 Uria 明確批准後，改用 `gpt-image-1.5` native transparency。

監看 105 秒內只收到「邊界提醒」，沒有完整技術結論，因此 Othriel 依流程升級第二層正式 discussion；Hammon 後續說明第一層其實是 PTY 傳輸截斷。

依 imagegen 技能的現行安全邊界：

- built-in 預設只能先走平面 chroma-key + 本機去背。
- 髮絲與柔接觸陰影可能使 chroma-key 失敗；若驗證失敗，必須停線並取得 Uria 明確同意，才可切換需要 `OPENAI_API_KEY` 的 `gpt-image-1.5` 原生透明 fallback。
- full-scene edit 可能造成全圖像素漂移，因此 B 不得未經驗證直接當正式覆蓋層。

## 正式 HUB discussion 問題

第一層輕量詢問連續未取得完整答案，因此依 `C:\Ug\AGENTS.md` 升級第二層正式討論。請收斂：

1. 在目前只有無人 base 與 full-scene candidates、built-in imagegen 無 mask／原生 alpha 的前提下，A／B／C 哪一條應作主路徑？可否組合使用？
2. 若 A（chroma-key）為主路徑，如何保留髮／帽邊、rim light、臀-椅與腳-地的柔接觸陰影，同時避免綠邊、矩形接縫與人物漂浮？
3. B（base/candidate 差分）是否只能用作生成局部遮罩或 QA 證據？在全圖可能漂移時，哪些條件下必須禁止用它產正式 alpha？
4. 何種可量測失敗應停線，回報 Uria 並請求切換 C（`gpt-image-1.5` native transparency）？不得繞過 imagegen 技能要求的明確批准與 `OPENAI_API_KEY` 邊界。
5. 請給最小但充分的輸出驗證：alpha channel、透明角、subject coverage、邊緣污染、接觸陰影、與 base 疊合座標、背景像素零烤入，以及四席整體組裝目視檢查。

不可改變的共同邊界：本步驟仍是校準，不接 runtime、不量產、不改正式憲法、不修 WARN 字卡、不重新生成 PASS 棋子；Uria 已以「八張全保留」完成視覺前置裁定。

## HUB 正式 discussion 收斂（兩回合）

- Task：`20260713082703-art-calibration-transparent-overlay-pipe-441b1c`
- 參與：Hammon（Claude）＋ Raviel（Codex）
- 狀態：`discussion_done`
- R1 分歧：Raviel 主張 A，Hammon 主張 B。
- R2 收斂：**B 作主路徑，但必須先過單席試點與漂移／貼回 Gate；A 作逐席備援；C 只有 B、A 都失敗且 Uria 明確批准後才可使用。**

### 施工順序

1. 依 Uria 裁定保留八張候選，不再進行淘汰選型。
2. 凍結 `A-study-v1.png` 與八張 candidate 的 SHA-256；overlay 只允許疊回這一版 base 的同一座標。
3. 先以光影最複雜的火爐席 `3A` 作 B 單席試點。
4. 只在該席 ROI 內做 RGB／Lab 差分，不做全圖 alpha；人物本體用較硬 alpha，接觸陰影用 soft alpha。
5. 輸出 diff heatmap、raw mask、refined alpha、RGBA overlay、固定座標 metadata 與貼回 composite。
6. 試點全綠才將同一 B 管線擴至其餘七張；每張仍獨立過 Gate。
7. 任一席 B 失敗，該席退 A（中性單色幕重生＋獨立接觸陰影層）；A 仍失敗才停線請 Uria 決定是否批准 C。

### B 試點 Gate

- **漂移前置**：在未動區與 ROI 邊界抽樣背景 patch；不得有家具邊緣位移、畫框變形、大片亮度／色相漂移或無人物區連續大面積 mask。
- **貼回斷言**：overlay 固定座標貼回 base 後，必須重建原 candidate；遮罩外逐像素差 `<= 2/255` 的比例至少 `99.5%`。不過即停線，不得用肉眼硬放行。
- **Alpha**：RGBA、四角 alpha=0、subject bbox 不碰裁片矩形邊，coverage 不得呈現空遮罩或全圖遮罩。
- **邊緣**：帽沿／肩線／椅腳三段 100% 放大，無白邊、綠邊、硬矩形、發光圈或可見背景鬼影；48px 縮圖仍可辨。
- **接觸**：臀-椅與腳-地接觸陰影必須在 soft alpha 內，貼回後人物不得漂浮。
- **整體**：四席與既有 PASS 棋子、WARN 字卡組裝後，光源方向、亮暗層次與視覺重量一致。

### 停線與資產綁定

- B 漂移或貼回 Gate 不過，不得產正式 alpha。
- A 連續兩輪仍有殘色、白邊、接縫、陰影消失、漂浮或不可重複手修，停線回報。
- 四個座位中若至少兩席的兩個變體都無法通過 B／A，視為系統性不適用，不再硬做。
- C 涉及 `OPENAI_API_KEY` 與 native transparency，沒有 Uria 明確批准不得啟用。
- 任何書房 base 改版都會使本輪 overlays 全數失效，必須重跑；正式量產前 base 必須凍結。

## Review

待本步驟產物完成後送 Hammon。

## 3A 差分試點結果（B 路徑）

Othriel 先以 `seat-3A-fullscene.png` 施工，並補上每席 include polygon，避免相鄰家具的差分被同一 connected component 帶入。人物區結果可達：

- `bboxTouchesRoi=false`
- `selectedReconstructionLe2Ratio=1`
- `selectedReconstructionMaxDiff=0`
- `compositeOutsideMaskEqualsBaseRatio=1`

但 full-scene candidate 在人物遮罩外仍有 imagegen 全圖漂移：

- `outsideRoiLe2Ratio≈0.35`
- `outsideRoiLe5Ratio≈0.69`
- `outsideRoiMeanDiff≈5.26/255`

因此無法通過正式 discussion 的權威 Gate「合成圖對原候選，遮罩外逐像素差 `<=2/255` 比例至少 `99.5%`」。B 路徑判定 **FAIL**，不得擴展到另外七張，也不得把數學上可貼回但含 base-lock 色彩反解的 overlay 當正式 alpha。

下一步依既定 fallback 轉 A：以各候選為姿勢／光線參考，產純色幕人物隔離稿，再去背並獨立驗證接觸陰影。C 仍未批准、不得啟用。

## canvas-exit Gate 補充討論

- Task：`20260713105506-art-calibration-canvas-exit-gate-clarifi-87f27e`
- 參與：Hammon（Claude）＋ Raviel（Codex）
- 結論：兩回合一致 `ACCEPT` 嚴格 `canvasExitEdges` 例外。

1. `1A`／`1B` 可依來源證據宣告 `left`、`bottom`；`4A`／`4B` 可依來源證據宣告 `right`、`bottom`。
2. 只有宣告的出畫邊可讓 alpha bbox 接觸 base 畫布絕對邊界；非出畫邊仍須至少 4px 透明 padding。
3. 每條出畫邊需 `exitEvidence` 與 source crop；不得用 tight-crop 假裝出畫。
4. 出畫邊只豁免 padding，不豁免貼回斷言、背景零烤入、接縫、白／綠邊、接觸陰影或 base SHA-256 綁定。

## 前景遮擋層補充討論

- Task：`20260713111821-art-calibration-occlusion-layer-design-689da0`
- 參與：Hammon（Claude）＋ Raviel（Codex）
- 結論：兩回合一致採完整人物 cutout + base-derived foreground restore。

定案合成順序為 `base -> person(s) -> shared foreground occlusion`。人物保留完整坐姿、椅子與接觸陰影；桌面／道具遮擋層逐像素取自同一 base，優先作全盤 shared scene layer，不複製成每人資產。任何 foreground 不透明像素若不等於 base 同座標像素即 fail。

3A 首次純色幕稿已能乾淨去背，sampled key RGB=`[4,248,11]`，裁片 `618x885`、alpha coverage `0.458633`。第一版前景 polygon 過高，將壁爐／舊椅像素切入新椅背，目視 fail；第二版依真實桌緣下修後消除鬼影，`base + foreground == base` 的結構成立。

第二版仍發現隔離稿左膝比原 3A 候選橫向突出，屬姿勢忠實度 fail，不以遮擋 mask 掩蓋。A 路徑最後一次定向重生已將雙腿收在椅下，保留上半身、椅背與光線；貼回後不再突出桌面。

3A 最終本機 Gate：

- source SHA-256：`3E5B7A9C9F17AFECD27A02C97CEA3BE805D366C9749ABAA188C9691697EE1D0B`
- base SHA-256：`E8B0675980EC8ED5EAC05A576C71C4EA67C828A658532312DF412BE81AD18ED5`
- person crop：`486x826`；placement：`x=1100,y=255,w=353,h=600`
- `greenSpillPixels=0`
- `cornersTransparent=true`
- `basePlusForegroundEqualsBase=true`
- `foregroundDerivedFromBaseExact=true`
- 目視：無綠邊、白邊、矩形接縫、桌面洞、壁爐鬼影或左膝突出；人物、椅背與桌面遮擋關係成立。

狀態：3A A 路徑試點本機 PASS，待 Hammon intermediate Review；Review PASS 前不展開其餘七張、不 push。

首次 review task `20260713115916-art-calibration-3a-transparent-overlay-p-69c705` 被秘書誤派 Raviel（非指定 Hammon），回 `BLOCK`：成品視覺／遮擋可接受，但工具預設 threshold 與實際定案值不同，無法保證照 handoff 重現同一 crop／metadata。Othriel 接受此技術 blocker：將預設改為 `48/132`、metadata 明記 threshold，並補完整重現命令與 hash 對照；修復後才送 Hammon 再審。

Hammon 再審 task `20260713122257-art-calibration-3a-reproducibility-re-re-af3538` 已 `OVERALL_PASS`。他獨立驗證 foreground 635,435 pixels 對 base mismatch=0、人物 alpha 200,826、`greenSpill=0`、透明四角與 `REPRO_HASH_MATCH=8/8`，並目視確認桌面遮擋與火爐席構圖。依 intermediate Gate，現在可展開其餘七張；仍不可 push。
