你是守燈人代理,照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行,結論以 PASS/WARN/BLOCK 開頭回覆。本輪只 review,不得 push;等待 Uria 明確授權後再推送。

# UI-IMAGEGEN handoff

> 作者:`Nhalor @ Codex Desktop / UG`
> 範圍:玩家側非大廳畫面的圖像化與動效。`surfaces/study-room/bg.webp` 零修改。

## 變更摘要

- 依 `docs/GamePlan/DESIGN.md` 的 aged / brooding / handcrafted 視覺憲法,用 Imagegen 生成 14 張遊戲素材,並轉為品質 88 的 JPEG。總資產約 4.9 MB,避免原始 PNG 約數十 MB 的行動裝置負擔。
- 出發版以手繪新英格蘭羊皮地圖替換程式化陸塊,保留正式關卡別針、阿卡姆標記、羅盤與鍵盤操作。
- 劇情簡報新增雨夜偵探書桌背景、燈影與紙頁入場效果;啟動畫面新增石門背景與雨痕,保留既有 Yellow Sign SVG。
- 主遊戲板新增胡桃木調查桌背景、雨痕、暗角、線索/目前地點/敵人提示效果,並接上調查員、Boss、議程、幕與三段結算圖像。
- 現行「雨夜的真相」三地點使用專圖:密斯卡塔尼克大學圖書館、印斯茅斯碼頭、阿卡姆市中心;舊暗巷、濕滑磚牆、深潛者出沒處保留作語意 fallback。
- 顯眼的暫代插畫字樣、敵人/瀕死/手牌/背包 emoji 改為正式圖像或文字標記。加入 900px/620px 響應式規則與 `prefers-reduced-motion`。

## 動過的檔案

- `packages/client/public/game-art/*.jpg`(14 張新增素材)
- `packages/client/src/screens/DepartureBoardScreen.tsx`
- `packages/client/src/screens/DepartureBoardScreen.css`
- `packages/client/src/screens/ScenarioBriefingScreen.css`
- `packages/client/src/screens/SplashScreen.css`
- `packages/client/src/screens/TestScenarioScreen.tsx`
- `packages/client/src/screens/TestScenarioScreen.css`

## 驗證結果

### Client TypeScript

```text
> packages/client/node_modules/.bin/tsc.CMD -b
Exit code: 0
```

### Client production build

```text
vite v6.4.2 building for production...
109 modules transformed.
dist/index.html                  0.74 kB | gzip:   0.44 kB
dist/assets/index-iE7Mpyub.css  70.23 kB | gzip:  14.08 kB
dist/assets/index-MeVAIANi.js  549.67 kB | gzip: 174.23 kB
built in 1.32s
Exit code: 0
```

既有警告仍在:一個重複 `clues_spent` case 與主 bundle 超過 500 kB;本輪未修改該行為或拆包。

### Repo preflight

```text
node scripts/preflight.js
=== ALL PASS — 可推送 ===
Exit code: 0
```

### 實際畫面

- 桌機 viewport 以正式 prod 資料開啟「雨夜的真相」。
- 出發版:手繪地圖、阿卡姆標記、正式關卡別針正常,無水平/垂直溢出。
- 劇情簡報:正式敘事、背景、紙頁、兩個操作按鈕正常,文字未遮擋。
- 主遊戲板:三張地點卡、左上議程/幕、左下玩家區、右側紀錄與底部回合控制互不遮擋,正式開局成功。
- 現行三地點專圖加入後,client build 與資產尺寸/引用檢查全過;瀏覽器因本機直接關卡 URL 的安全政策拒絕再次 reload,未用替代瀏覽器規避。
- 驗證期間曾建立只寫 localStorage 的本機 `visual-setup.html`;驗證後已刪除,未留在工作樹。

## 自知風險與範圍外發現

- 目前 DB 仍沒有通用 `art_url` 欄位可讓每個未來地點資料驅動選圖;本輪先以 location code/name 語意映射六類。新增場景若不符合規則會落到暗巷 fallback。正式內容量產時應將美術 URL 納入地點資料 schema。
- 14 張 JPEG 在首次完整流程中約 4.9 MB;瀏覽器會依畫面逐張請求,後續可由 CDN/部署層轉 AVIF/WebP,本輪不新增影像工具鏈。
- 遊戲紀錄與部分既有按鈕仍含 emoji;本輪只清掉主畫面最顯眼的暫代圖示,全庫文字語言清理屬另一張 UI 工單。
- 未改大廳底圖、引擎、規則、關卡/城主資料、API、DB 或 MOD-15。

## Review

**PASS**(守燈人代理 Hammon @ GAS Hub,2026-07-11;本輪 review-only,依指示**未 push**,等 Uria 授權)

依代理 review checklist:

1. **commit/清單**:`origin/main..HEAD` 僅 `3883f3f UI-IMAGEGEN visualize game interface`,21 檔(14 JPEG + 5 screen 檔 + handoff)與 handoff 一致。
2. **範圍**:純 client 側(screens tsx/css + public/game-art 資產);`docs/v07*`、shared、server、引擎、關卡/城主資料、MOD-15 零觸碰(diff --stat 驗證為空);`surfaces/study-room/bg.webp` 未動。
3. **複跑**:`node scripts/preflight.js` ALL PASS;client `tsc --noEmit` exit 0;`vite build` 成功(1.29s)。既有警告(duplicate `clues_spent` case、bundle >500kB)為本輪未觸行為,如實記載。
4. **引擎**:未涉引擎,sim 免跑。
5. **歷史紅線**:無 setTimeout 閉包寫 state(動效走 CSS class);無多人一致性面(純渲染);`locationArtKind` 純函式且有 export 可測。
6. **程式碼審**:
   - 地點圖語意映射六類 + alley fallback,邏輯清楚;未來資料驅動 `art_url` 欄位屬 schema 工單,記載於範圍外發現——正確不越界。
   - emoji 清理(倒/牌/袋/文字按鈕)+ `role="img"`/`aria-label` 補齊,可及性有進步。
   - 資產 14 張 JPEG 共約 4.9MB、單張 ≤553KB,逐畫面載入;CDN 轉 AVIF/WebP 留部署層,合理。
   - 驗證用 `visual-setup.html` 已刪除,工作樹乾淨(git status 無殘留)。

結論:範圍嚴守、測試複跑全綠、風險誠實記載,PASS。push 等 Uria 明確授權。
