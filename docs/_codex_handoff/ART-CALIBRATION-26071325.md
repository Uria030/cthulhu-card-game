你是守燈人代理,照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行,結論以 PASS/WARN/BLOCK 開頭回覆。

# ART-CALIBRATION 工作紀錄 / Handoff (26071325)

- 現任作者:`Othriel @ Codex Desktop / UG`
- 原作者:`Nhalor @ Codex Desktop / UG`
- 狀態:PASS 待 push(Hammon HUB review 已通過)
- 工單:`docs/工單_ART-CALIBRATION_26071308.md`
- baseline:`5e77cc8` (`main == origin/main`;建立本紀錄前工作樹乾淨)
- HUB task:`20260713063703-art-calibration-review-請求-dfb9b1`

## 交接與所有權

- 原工單收件人為 Nhalor。
- 2026-07-13,Uria 明示告知 Othriel:「你可以往工作單的下一個階段進行」,因此本工作包由 Nhalor 正式交接給 Othriel。
- 保留 Nhalor 既有產物與署名;後續變更由 Othriel 追加紀錄,不改寫歷史作者。

## Nhalor 已完成產物

本機校準件目錄:`C:\Ug\docs\sample\ART-CALIBRATION_26071308\`

Othriel 已將送審必要素材無损整理到工單指定 repo 目錄:`packages/client/public/game-art/calibration-26071308/`。原始本機目錄保留不改,二進位素材經 SHA-256 逐檔對照一致。

- A:書房/調查室底圖小樣。
- B:2 職業 x 4 玩家色棋子與 48px 辨識列。
- C:2 張老電視打擊字卡。
- D:棋子置於地點圖片區的盤面比例合成。
- 總覽:`00-ALL-samples.png`。
- 組裝頁:`index.html`。

## Uria 視覺裁定(2026-07-13)

1. **棋子辨識度:PASS**
   - 本輪棋子方向可以接受。
   - 後續校準預覽重用這批改色棋子,不重複生成。
   - 當前目標是快速定案整體架構、視覺原則、介面素材與視覺效果,不開啟 256 顆棋子全量生產。
2. **「轟！」打擊字卡:WARN**
   - 本階段暫不修改,可留作方向校準。
   - 正式 runtime 素材不得保留矩形邊界;上線前必須修整為獨立、去背、非矩形外形的素材。

## 新階段邊界

- Uria 放行「四個座位各產生少量人影測試」,取代原工單「座位人影本輪不做」的限制。
- 新階段是**人影位置/光影/接縫校準**,不是 ART-PRODUCTION 全量量產。
- 四席各先產生少量候選,重點檢查透視、曝光、rim light、接觸陰影、人影內部層次與無矩形接縫。
- 棋子直接重用 PASS 小樣;打擊字卡保留 WARN 註記,本輪不花生成額度重做。
- 四席人影校準與整體組裝通過後,才修訂並凍結視覺憲法/prompt/介面素材合約;不以「做滿 24 張人影或 256 顆棋子」當作當前完成條件。

## 立即續作順序

1. [已完成] 整理本輪 A/B/C/D 產物清單與 Uria 裁定,完成 ART-CALIBRATION handoff。
2. [已完成] 已送 HUB Hammon review;正式裁決 `OVERALL_PASS`。
3. [已放行] Hammon PASS 後,進入四席人影校準小樣;本階段不接 runtime、不開全量量產。
4. 將人影候選、PASS 棋子與 WARN 打擊字卡組裝成實際使用情境,交 Uria 定案整體視覺架構。

## 已知風險 / 待補證據

- 已將送審必要的 22 檔整理進 repo `packages/client/public/game-art/calibration-26071308/`;未納入 Nhalor 的 8 張未去背棋子中間檔、本機去背 helper 與 `.vite` cache,因為它們不是交付/檢視必要件。
- 當前是視覺校準 PNG,不是正式 WebP 生產件:A 為 `1536x1024`;B 去背檔約 `1024x1492` 至 `1054x1536`;C 為 `1448x1086` RGB。README 已明記「方向裁定後才進行最終 WebP 尺寸、壓縮與 runtime 整合」;不得將本次 review 誤解為放行這些 PNG 直接上線。
- 歷史 `00-A/00-D/00-ALL` 預覽 PNG 上的區塊標籤仍是舊名「調查室」;可交互 `index.html` 與 `README.md` 已統一為工單正式名「書房」。A 底圖藝術本體無烤字,歷史預覽只作溯源,不是最終 UI 文案。
- A 底圖的最終 PASS/WARN/BLOCK 未在本次 Uria 回覆中明示;四席人影可先作「位置校準」,但不宣稱為可量產最終底圖素材。
- 本輪尚無程式碼變更,因此此時不觸發 Code review-before-push;但工單要求的視覺/範圍 review 仍必須送 Hammon。

## 動過的檔案

- `docs/_codex_handoff/ART-CALIBRATION-26071325.md`
- `packages/client/public/game-art/calibration-26071308/README.md`
- `packages/client/public/game-art/calibration-26071308/index.html`
- `packages/client/public/game-art/calibration-26071308/` 內 20 個原始二進位校準/參考檔(A/B/C/D 預覽、總覽、A 底圖、8 張透明棋子、2 張字卡底圖、4 張盤面/地點參考圖)。

## 測試 / 驗證

本包未修改程式,不需要 package test/tsc;已執行下列交付專用檢查:

```text
BINARY_HASH_MATCH=20/20
HTML_REFS_OK=15/15
RUNTIME_REFERENCES=0
git diff --check
Exit code: 0
```

影像機械檢查:

```text
A-study-v1.png: 1536x1024, Format24bppRgb
B-*-cutout.png: 8/8 為 Format32bppArgb,四角 alpha=0
C-impact-*-bg.png: 2/2 為 1448x1086 Format24bppRgb
```

解讀:B 去背棋子的透明通道與外圍透明符合校準用途;C 目前是矩形 RGB 底圖,與 Uria WARN 一致,未偽裝成可上線 alpha 素材。

人工觀圖自檢(`00-ALL-samples.png`):

- A 為無人對角書房,可見四張空椅、窗外冷光、檯燈暖池與壁爐橘光,紀念牆無具象人像。
- B 四色在透明背景、48px 列與暗色地點圖上都能區分;無發光圈或白邊光曈,Uria 已裁定辨識度 PASS。
- D 棋子是地點圖片區內的獨立疊圖,未烤入地點原圖,未遮擋地點名稱/線索/操作區。
- C 的色彩/字卡語彙可先作方向校準,但矩形邊界明顯,維持 Uria WARN,不列為可上線素材。

## Review

**PASS**(守燈人代理 Hammon @ GAS Hub,2026-07-13;校準封裝包——PASS 範圍=本輪交件與新階段邊界,**不等於放行 PNG 上線或 A 底圖最終定案**)

依代理 review checklist:

1. **commit/清單**:`3af35b8` 單筆,handoff+22 檔校準素材進工單指定 repo 目錄;**grep 驗證 `calibration-26071308` 零 runtime 引用**——純檢視件,上線零行為影響;preflight ALL PASS;零程式碼變更,test/tsc 面不適用(交付專用檢查:20/20 hash 對照、15/15 HTML 引用、diff --check 綠,採信)。
2. **交接程序**:Nhalor→Othriel 依 Uria 明示交接、保留原作者署名不改寫歷史——正確。
3. **視覺抽驗(我實際開總覽圖)**:
   - A:無人對角書房、四空椅、三光源(窗冷光/檯燈暖池/壁爐橘)、紀念牆無人像——與描述一致;**A 的最終裁定確實未出**,handoff 誠實標注「只作人影位置校準基準、不宣稱可量產」——邊界正確。
   - B:兩職業×四色高彩棋子,四色在透明/暗底/48px 列均可辨,無發光圈——與 Uria PASS 裁定一致,且已對齊視覺總單 §1「主角高彩」新方向。
   - C:兩張字卡確為矩形 RGB 底圖——**WARN 如實保留未偽裝**(機械檢查 Format24bppRgb 自證),上線前去背非矩形的條件已記錄。
   - D:棋子為地點圖上獨立疊層、未烤入原圖、未遮名稱/線索/操作區——合成方式正確。
4. **範圍紀律**:新階段=四席人影**少量校準**(Uria 放行,取代舊「本輪不做」限制),非 24 張量產;棋子重用不重生成;字卡不花額度重做;「人影+組裝通過後才凍結憲法/prompt」——不可逆步驟全部後置,與視覺總單討論收斂一致。
5. **誠實記載加分**:PNG 非生產件(WebP 尺寸壓縮後置)、歷史預覽殘留「調查室」舊名(README/index 已統一「書房」)、A 未終審——三處都主動聲明,無誇大。

結論:交件完整、邊界誠實、視覺抽驗與裁定一致、零 runtime 影響,PASS。Othriel 可進四席人影校準小樣;提醒:人影校準以 A 底圖現版為位置基準,但 A 終審前不做任何「烤入底圖」的不可逆合成。
