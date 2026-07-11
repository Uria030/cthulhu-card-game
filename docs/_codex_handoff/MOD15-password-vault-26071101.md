你是守燈人代理,照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行,結論以 PASS/WARN/BLOCK 開頭回覆。

本輪權限為 review-only:請把結論寫回本檔,但不要 push;正式 push 等 Uria 明確放行。

# MOD-15 handoff — 可顯示的帳號密碼保管

交件者:`Nhalor @ Codex Desktop / UG`

## 變更摘要

- 根因不是前端漏欄位:既有 `players.password_hash` 是不可逆 bcrypt,後端沒有可供 MOD-15 顯示的目前密碼。
- 新增 `MIGRATION_043` 與獨立 `player_password_vault` 表。登入仍只比對 bcrypt;可讀副本以 AES-256-GCM 加密,用 player id + key version 作 AAD 綁定。
- 新增必要環境變數 `PLAYER_PASSWORD_VAULT_KEY`。未設定或格式錯誤時,建立帳號、重設密碼、顯示密碼均 fail closed,不會靜默留下不可管理的新帳號。
- MOD-15 建立／重設改為 transaction:玩家 bcrypt、vault、audit 三者同成同敗。
- 新增 admin-only `POST /api/admin/players/:id/password/reveal`;成功回應帶 `Cache-Control: no-store` / `Pragma: no-cache`,每次顯示寫 `password_reveal` audit。
- MOD-15 UI 新增目前密碼的顯示／隱藏／複製控制。切換帳號、刷新資料或頁面隱藏時會清除已讀明文;舊帳號沒有 vault 時明示必須先設定新密碼。
- 補上 CORS `PATCH`,讓 Vercel admin 到 Railway 的跨網域密碼重設能通過預檢。
- 以 Fastify inject 模擬 `creator01` / `creator02` 各自重設不同英數密碼,再由 reveal endpoint 讀回;兩筆密文不同。測試值只存在測試碼,不是正式帳號密碼。

## 動過的檔案

- `.env.example`
- `packages/client/public/admin/admin-account-manager.html`
- `packages/server/src/app.ts`
- `packages/server/src/db/migrate.ts`
- `packages/server/src/routes/player-accounts.ts`
- `packages/server/src/routes/player-accounts.test.ts`
- `packages/server/src/services/player-password-vault.ts`
- `docs/_codex_handoff/MOD15-password-vault-26071101.md`

未碰 `docs/v07_當前版本_26042606/`、關卡、城主與遊戲引擎。

## 測試結果原文

```text
node inline-script syntax check
PASS MOD-15 inline script syntax

packages\server\node_modules\.bin\tsx.CMD packages/server/src/routes/player-accounts.test.ts
PASS normalizeEmail: trims and lowercases before unique lookup
PASS username policy: permits test account names but rejects spaces
PASS email and password policy match E15a test-phase contract
PASS settleProgressOnServer: awards DB outcome rewards and advances chapter
PASS MIGRATION_042 mirrors creator01/creator02 admin users into MOD-15 players
PASS MIGRATION_043 stores encrypted password material outside players
PASS password vault round-trips independent creator passwords
PASS password vault rejects an invalid key and wrong player binding
PASS MOD-15 resets and reveals two independent creator passwords

packages\server\node_modules\.bin\tsc.CMD --noEmit -p packages/server/tsconfig.json
exit 0

packages\client\node_modules\.bin\tsc.CMD --noEmit -p packages/client/tsconfig.json
exit 0

packages\server\node_modules\.bin\tsc.CMD --noEmit -p packages/shared/tsconfig.json
exit 0

packages\server\node_modules\.bin\tsx.CMD packages/client/src/game/selectedSave.test.ts
PASS selected save persists active save identity

packages\server\node_modules\.bin\tsx.CMD packages/shared/src/game/campaignProgress.test.ts
26 passed, 0 failed

packages\client\node_modules\.bin\vite.CMD build (cwd packages/client)
109 modules transformed
built in 1.32s
既有警告:TestScenarioScreen.tsx duplicate case、bundle >500 kB;本單未改該區。

git diff --check
exit 0
```

### 瀏覽器 QA

- 桌面 viewport:內容 clientWidth=1250 / scrollWidth=1250;密碼工具 682/682,無水平溢位。
- 手機 viewport 390x844:內容 clientWidth=360 / scrollWidth=360;密碼工具 302/302,無水平溢位。
- accessibility snapshot 可辨識「目前密碼」textbox、「顯示目前密碼」、「複製目前密碼」與狀態文字。

## 部署與 creator01/02 驗證

- 部署前 Railway 必須新增永久 `PLAYER_PASSWORD_VAULT_KEY`:32-byte random key 的標準 base64 字串。這把 key 與 `PLAYER_JWT_SECRET` / `ADMIN_JWT_SECRET` 用途不同,不可互用或遺失。
- migration 上線前,既有 `creator01` / `creator02` 只有 bcrypt,無法還原舊密碼,UI 會顯示「舊密碼未納入保管」。
- 部署後由 MOD-15 分別替 `creator01`、`creator02` 設定不同的正式英數密碼,各自按「顯示」讀回並用遊戲登入 smoke。正式密碼不得寫入本檔、commit、log 或 review 回覆。
- 本機已驗證上述雙帳號 API 流程;Railway 實帳重設屬部署後 smoke,目前未宣稱完成。

## 自知風險與範圍外發現

- 這是依 Uria 明確產品裁定提供可讀密碼。相較只存 bcrypt,admin session 或 vault key 遭竊的影響更高;本單以 admin-only、AES-GCM、AAD、no-store、稽核與明文自動清除縮小風險。
- `key_version` 已入 schema,但尚未做線上 key rotation／批次重加密工具。換 key 前必須先規劃 rotation,直接覆蓋 env 會讓舊 vault 無法解密,但不影響 bcrypt 登入。
- `PLAYER_JWT_SECRET` 仍有既有 production fallback 技術債;本單只在 `.env.example` 補齊部署契約,未改登入 token 行為。
- `CORS origin` 現行 callback 仍暫時 allow all,是既有範圍外安全債;本單只補缺少的 `PATCH` method。

## Review

待守燈人填寫。
