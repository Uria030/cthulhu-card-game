你是守燈人代理,照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行,結論以 PASS/WARN/BLOCK 開頭回覆。**本件是整張工作單的中間步驟；即使 PASS 也不得 Git push，只允許 Othriel 進入下一步。**

# ART-CALIBRATION-SILHOUETTES 工作紀錄 / Handoff（26071326）

- 作者：`Othriel @ Codex Desktop / UG`
- Reviewer：Hammon
- 上游工單：`docs/工單_ART-CALIBRATION_26071308.md`
- 上游完成紀錄：`docs/_codex_handoff/ART-CALIBRATION-26071325.md`
- 狀態：步驟 1「四席人影位置／光影校準」待送審；未 push

## 本步驟討論結論

依 Uria 2026-07-13 本串裁定，本步驟只用少量打樣快速定案整體架構、視覺原則、介面素材與視覺效果，不開啟 24 張人影或 256 顆棋子量產。

- 四個座位各製作 2 個人影候選，共 8 個。
- 現有棋子辨識度已 PASS；組裝時直接重用，不重新生成。
- 「轟！」字卡維持 WARN，本步驟不修改；正式上線前仍須去除矩形邊界。
- 人影只校準座位、透視、曝光、rim light、接觸陰影、內部層次與接縫。
- 不接 runtime、不烤入底圖、不修改正式 `DESIGN.md`、不啟動量產。

## 產出規劃

1. 以 `A-study-v1.png` 為唯一背景基準，四席各產 2 個完整情境候選，鎖住背景構圖與家具。
2. 人影一律為無臉、無手指細節的暗褐匿名坐姿；禁純黑、禁站立、禁坐桌面。
3. 每席繼承局部光源：左席窗冷光、後席檯燈頂光、右席壁爐暖光、前席桌面／壁爐混合輪廓光。
4. 將 8 個候選做成比較頁；再選出每席一個方向，與既有 PASS 棋子及 WARN 字卡組裝成整體情境。

## 驗收證據

- 四席 × 2 候選齊全。
- 四席都坐在原椅上，比例與桌面透視一致。
- 無具象臉孔、無純黑貼紙感、無矩形接縫。
- 暗部仍有衣褶／肩線層次；局部 rim light 與背景光源方向一致。
- 身體與椅面、腳與地面存在可信接觸關係。
- 背景主要家具與八入口物件沒有被新增、刪除或改位。

## 不做事項

- 不把候選宣稱為 24 張正式透明 WebP。
- 不在本步驟修訂憲法或 prompt 正式模板。
- 不改遊戲程式、資料映射或 runtime 引用。
- 不 Git push；本工作單最後一次 Review PASS 後才 push。

## 實際產物

- 比較入口：`packages/client/public/game-art/calibration-26071308/silhouette-position-tests/index.html`
- 說明：`packages/client/public/game-art/calibration-26071308/silhouette-position-tests/README.md`
- prompt 契約：`packages/client/public/game-art/calibration-26071308/silhouette-position-tests/prompt-set.md`
- 八張候選：
  - `seat-1A-fullscene.png`
  - `seat-1B-fullscene.png`
  - `seat-2C-fullscene.png`
  - `seat-2D-fullscene.png`
  - `seat-3A-fullscene.png`
  - `seat-3B-fullscene.png`
  - `seat-4A-fullscene.png`
  - `seat-4B-fullscene.png`

所有候選皆由 built-in `image_gen` 以同一張 `A-study-v1.png` 作 edit target 生成。後席最初兩個草稿產生正面黑洞臉，已重做並排除；送審件只保留帽沿完整遮臉的 2C 與背向窗景的 2D。

## 自檢結果

### 機械檢查

```text
seat-1A-fullscene.png|1536x1024
seat-1B-fullscene.png|1536x1024
seat-2C-fullscene.png|1536x1024
seat-2D-fullscene.png|1536x1024
seat-3A-fullscene.png|1536x1024
seat-3B-fullscene.png|1536x1024
seat-4A-fullscene.png|1536x1024
seat-4B-fullscene.png|1536x1024
HTML_REFS=15; MISSING=0
RUNTIME_REFS=0
git diff --check
Exit code: 0
```

### 逐張觀圖

- 1A／1B：人物確實坐在左側窗邊椅；有窗冷 rim 與檯燈暖 fill，A 偏自然、B 職業輪廓較強。
- 2C／2D：人物確實坐在後方中央椅；2C 用帽沿遮臉，2D 直接背向鏡頭，未再使用黑洞臉解法。
- 3A／3B：人物確實坐在右側火爐椅；火光 rim 與衣褶中間調可見，A 融合自然、B 姿勢差異較大。
- 4A／4B：人物確實坐在右下前景椅；A 存在感強但遮擋較多，B 留出較多地圖與桌面資訊。
- 八張都沒有矩形素材邊或白邊光暈；人影不是整塊純黑貼紙，衣物／帽髮／肩線均保留層次。

### 比較頁 QA 限制

- 檔案級檢查證明 15 個圖片引用全部存在。
- Codex in-app browser 的 URL 安全政策拒絕直接開啟本機 `file://` 頁面，因此沒有以瀏覽器截圖冒充已驗證證據，也沒有繞過限制。
- 圖片本體已在產生後逐張直接觀圖；比較頁是純靜態 HTML/CSS、無 script、無 runtime 引用。

## 已知限制 / 下一步

- 這八張是「完整場景 edit」而非透明覆蓋層；可用來判斷座位、比例、姿勢、曝光與光影語言，但不可直接接入 runtime。
- Imagegen 對完整場景的重繪可能帶來背景像素漂移；正式透明覆蓋層必須以 Uria 選定的每席方向另行製作，背景不得烤入。
- 本步驟 Review PASS 後，回到討論拍請 Uria 每席選一個方向；下一步才製作四席可換裝覆蓋層與整體組裝。
- 既有棋子仍為 PASS；既有字卡仍為 WARN，正式上線前去矩形邊界的要求沒有被本步驟解除。

## Review

**PASS**(守燈人代理 Hammon @ GAS Hub,2026-07-13;**中間步驟審查——依工單明示不得 push**,僅放行 Othriel 進入下一步)

依代理 review checklist(校準件適用面):

1. **commit/範圍**:本機 commit `181a2e8` 單筆;grep 驗證 `silhouette-position-tests` 零 runtime 引用;比較頁純靜態 HTML 無 script;preflight ALL PASS;零程式碼/憲法/prompt 正式模板變更——「不做事項」全數守住。
2. **機械複驗(我親自跑)**:8 張候選全部 1536x1024 與 handoff 一致。
3. **視覺抽驗(實際開圖 2C/4A)**:
   - 2C:後席中央椅、帽沿遮臉(帽下陰影而非黑洞臉)、檯燈頂光語言正確、衣褶層次可見、背景家具與八入口物件無增刪改位。
   - 4A:前景席背向鏡頭、壁爐輪廓光、大衣中間調豐富、無矩形接縫無白邊——與逐張觀圖自檢描述一致。
   - 兩張皆為坐姿、匿名、非純黑貼紙——無人像紅線與本步驟驗收標準符合。
4. **誠實紀律加分**:①黑洞臉草稿主動重做並排除,不送有問題件;②in-app browser 開不了 file:// 就如實記載、不用截圖冒充驗證、不繞安全政策;③明確聲明「完整場景 edit ≠ 可接 runtime 覆蓋層」、背景像素漂移風險與「正式覆蓋層不得烤入背景」——邊界比要求的還清楚。
5. **上輪 review 條件延續**:棋子 PASS 重用、字卡 WARN 未解除、A 底圖未終審——一致。

結論:八張候選齊全、視覺與機械抽驗吻合、範圍零越界,PASS。**不 push**;下一步=回到討論拍請 Uria 每席選一個方向(1A/1B、2C/2D、3A/3B、4A/4B),選定後才製作四席可換裝透明覆蓋層與整體組裝。
