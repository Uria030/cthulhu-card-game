> 你是守燈人代理，照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行；結論以 PASS/WARN/BLOCK 開頭回覆，並寫回本檔的 `## Review` 區段。

# VISUAL-REMAKE-P1 - Phase 1 校準輪交件

> 作者: Nhalor @ Codex Desktop / UG
> 工單: `docs/視覺重製工作計畫_調查室與戰鬥介面_26071203.md`
> 狀態: 待守燈人 review 與 Uria 視覺驗收；尚未切換 runtime 資產。

## 交件範圍

完成工單 §7 的 Phase 1 校準素材，沒有改動引擎、規則、關卡/城主資料、既有地點卡圖，亦沒有替換目前遊戲畫面引用的資產。

### A. 無人大廳底圖

- `packages/client/public/game-art/lobby-v4/study-base.webp`
- `2400 x 1600`、`381,962 B`、WebP quality 82。
- 第一人稱書桌近景；四張空椅；雨夜大窗、桌燈、右側壁爐三光源；桌面八件入口物件分離；紀念牆只使用文件、地點照與空白銘牌，無人物或肖像。

### C. 16 張棋子校準樣本

- 路徑: `packages/client/public/game-art/pawns/v2/{enfj-1,intj-3,esfj-1,istp-3}-{p1,p2,p3,p4}.webp`
- 四個職業: `ENFJ-1 社運領袖`、`INTJ-3 密碼學家`、`ESFJ-1 社區護士`、`ISTP-3 槍械工匠`。
- 四色: P1 `#A04830`、P2 `#3A4A78`、P3 `#5A6E3A`、P4 `#B07828`。
- 全部為 `512 x 768` RGBA WebP，角落 alpha=0，單張 `52,938-65,896 B`。
- 每職業先以 P1 生成母圖，再以 Imagegen edit 只重上漆色，避免跨色構圖漂移。職業差異只來自匿名雕刻的帽形、肩線與小道具；沒有可辨識臉孔。

### E. 儀表板殼校準套件

- `packages/client/public/game-art/ui-calibration/dashboard-shell-kit.webp`
- `1254 x 1254`、`195,212 B`、RGBA WebP。
- 一張透明校準板集中展示左右下木質面板、掛牆銘牌、黃銅按鈕三態、計量/計數框、頭像圓框、系統鑰匙旋鈕、設定旋鈕、紀錄頁籤、綠玻璃珠。
- 這是 Phase 1 的共同材質與比例驗收件，不是 runtime sprite sheet；個別可接線的切片只在 Uria 接受 E 的視覺語言後才進 Phase 3 製作，避免未核可前引入不可逆的 UI 實作。

## Imagegen prompt 記錄

全部素材以 built-in Imagegen (`gpt-image`) 生成。共同前綴逐字採用工單 §1：

```text
1930s archival photograph aesthetic, warm sepia-toned near-monochrome,
ivory/cream paper base tone, lifted blacks (deepest tone is dark brown,
never pure black), creamy off-white highlights (never pure white),
midtone-rich exposure like a well-lit vintage print, 5-15% residual
muted color, fine silver-halide film grain, subtle uneven fading.
NOT: dark moody render, NOT crushed shadows, NOT saturated illustration,
NOT teal-orange grading.
```

- A 補上書房構圖、無人、四空椅、八入口物件與三光源限制。
- C 補上「匿名、無臉的漆木西洋棋胸像、圓形車床底座、所有稜線的 `#8B6F3D` 磨損金邊、48px 暗底可見」；色鍵背景去背後再輸出 WebP。P2-P4 使用 P1 本圖 edit，限制只改漆色。
- E 補上「深胡桃木 `#3D2817`、黃銅 `#8B6F3D`、空白凹槽供 HTML 疊活字、無文字/數字」的實體道具攝影限制。

## 驗收紀錄

### 資產機械驗收

```text
PASS base=(2400, 1600)/381962B pawns=16 kit=(1254, 1254)/195212B
```

- 大廳底圖符合 `>=2400 x 1600` 且 `<=450KB`。
- 16 張棋子均為 `512 x 768`、RGBA、四角 alpha=0、`<=150KB`。
- 儀表板校準套件左上角 alpha=0。
- 以深色底圖縮至 48px 高的人工對照，四色、金邊與四種職業輪廓均可辨。

### 工程 Gate

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
```

Vite 僅報既有的主 bundle 大於 500KB 警告，與本次只新增 public assets 無關。

## 自知風險與後續邊界

1. Phase 1 是設計校準，不可在未經 Uria 視覺驗收前將 `lobby-v4` 或 `pawns/v2` 接入 Lobby/戰鬥盤面。
2. 大廳座位人影 24 張依工單必須等待 A 底圖定稿後再裁片/inpaint；本輪刻意未開工。
3. 儀表板套件先驗收共同語言。接受後才產出 individual shell assets，並進入 §5/§6 的尺寸合約、HTML 活字接線與可調 UI 縮放。
4. 64 職業其餘 240 張棋子仍未開始；需 Uria 核准本輪四職業四色的材質、匿名規則與暗底可見性後才量產。

## 建議 review / Uria 驗收點

1. 大廳是否符合「我的書房」而非檔案室，以及桌面八個入口是否可作為下一輪可點擊對位基準。
2. 棋子的漆木、金邊、匿名化與四色對比是否可鎖為 256 張量產配方。
3. 儀表板的胡桃木/黃銅語言、實體零件比例及「殼與 HTML 活字分離」是否可進入切片與工程接線。

## Review

**PASS**(守燈人代理 Hammon @ GAS Hub,2026-07-12;純資產校準輪,未 push——等 Uria 視覺驗收後依授權處理)

依代理 review checklist:

1. **commit/清單**:`bc33781` 單筆,19 檔(1 底圖+16 棋子+1 校準板+handoff)與 handoff 一致;零程式碼變更。
2. **範圍**:引擎/規則/關卡/城主/既有地點卡圖零觸碰;**已 grep 驗證 `lobby-v4`/`pawns/v2`/`ui-calibration` 無任何 runtime 引用**——「尚未切換 runtime 資產」屬實,本輪上線零行為影響。
3. **複跑**:preflight ALL PASS(無程式碼變更,測試/tsc 面不適用)。
4. **視覺抽驗**(我實際開圖檢查):
   - **A 底圖**:第一人稱書桌近景成立;空椅無人;桌燈/壁爐/窗外街燈三光源齊;桌面入口物件(檯燈、天平、鐵砧+鎚、藥瓶組、地圖、筆記本、文件捆、厚書、香爐)分離可對位;暖調 sepia、無死黑死白,符合工單 §1 視覺憲法。牆面為文件/地點照,無人物肖像。註:窗外街景有極小遠景行人與車,屬街景氛圍、非室內人物——留 Uria 視覺驗收判定是否接受。
   - **C 棋子**(抽驗 enfj-1-p1):匿名無臉漆木胸像、車床圓底座、稜線金邊、alpha 去背乾淨,符合匿名規則;暗底可見性(48px)建議 Uria 在實際戰鬥盤面深色底上驗一次。
   - **E 校準板**:胡桃木/黃銅語言一致、凹槽全空白無文字數字、按鈕三態/銘牌/計量框/鑰匙/旋鈕/頁籤/玻璃珠齊——「殼與 HTML 活字分離」的前提成立。
5. **流程紀律**:E 先驗語言、接受後才切片接線;24 張座位人影等 A 定稿;240 張棋子等配方核准——不可逆步驟全部後置,順序正確。

結論:機械驗收與視覺語言抽驗均過,PASS。後續由 Uria 做視覺驗收(建議點:①窗外遠景行人是否接受②棋子 48px 暗底實測③八入口物件對位是否如預期),核可後才進 Phase 3 切片與量產。
