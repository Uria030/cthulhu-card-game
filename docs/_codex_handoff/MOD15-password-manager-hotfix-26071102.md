你是守燈人代理,照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行,結論以 PASS/WARN/BLOCK 開頭回覆。

# MOD-15 hotfix handoff — 零設定可用帳號密碼管理器

交件者:`Nhalor @ Codex Desktop / UG`

## 問題與目標

Uria 已在遠端 iPad 配合建立 Railway 變數、輸入字串並部署兩次,MOD-15 仍以「密碼保管金鑰尚未設定」阻擋重設。原設計把基礎設施設定責任錯誤轉嫁給使用者。

本 hotfix 的完成定義:

- 不再要求 Uria 設定、記憶或輸入 vault key。
- server 自動建立並持久保存 vault key。
- 部署時自動替既有 `creator01` / `creator02` 建立兩組不同的 16 位英數密碼。
- MOD-15 可直接顯示這兩組密碼,且顯示值能通過各自 bcrypt 登入。
- server 重啟／再次部署不可旋轉既有密碼。

## 變更摘要

- 新增 `MIGRATION_044` / `server_secrets`,vault key 第一次由 server 產生並寫 DB,後續固定讀同一值。
- 若部署環境剛好已有合法舊 `PLAYER_PASSWORD_VAULT_KEY`,第一次會沿用以保持相容;缺失或格式錯誤時直接忽略並自動產生,不再回 503。
- 建立、重設、顯示三條 MOD-15 route 改讀 server-managed key,使用者不再負責設定。
- 新增 `bootstrapCreatorPasswords`:部署時針對 creator01/02 產生獨立 16 位英數密碼,同步寫 bcrypt、AES-GCM vault 與 audit。
- bootstrap 以 `creator_password_bootstrap_v2` audit marker 冪等;每個帳號個別 transaction,重啟不重設。
- 密碼不寫 log、handoff 或 API 以外位置;部署 log 只列完成的 username。
- `.env.example` 移除手動 vault key 契約。

## 動過的檔案

- `.env.example`
- `packages/server/src/db/migrate.ts`
- `packages/server/src/routes/player-accounts.ts`
- `packages/server/src/routes/player-accounts.test.ts`
- `packages/server/src/services/player-password-vault.ts`
- `packages/server/src/services/creator-password-bootstrap.ts`
- `docs/_codex_handoff/MOD15-password-manager-hotfix-26071102.md`

未碰規則書、關卡、城主、遊戲引擎與前端版面。

## 測試結果原文

```text
packages\server\node_modules\.bin\tsx.CMD packages/server/src/routes/player-accounts.test.ts
PASS normalizeEmail: trims and lowercases before unique lookup
PASS username policy: permits test account names but rejects spaces
PASS email and password policy match E15a test-phase contract
PASS settleProgressOnServer: awards DB outcome rewards and advances chapter
PASS MIGRATION_042 mirrors creator01/creator02 admin users into MOD-15 players
PASS MIGRATION_043 stores encrypted password material outside players
PASS MIGRATION_044 persists a server-managed vault key
PASS password vault round-trips independent creator passwords
PASS password vault rejects an invalid key and wrong player binding
PASS MOD-15 resets and reveals two independent creator passwords
PASS deployment bootstraps visible, login-valid creator passwords exactly once

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

git diff --check
exit 0
```

## Review 需特別確認

1. `server_secrets` 與 ciphertext 同 DB 是有意的零操作取捨:仍防止一般 players/vault 表直接讀出明文,但不宣稱防禦完整 DB compromise。
2. creator bootstrap 只由 audit marker 控制一次性;不得因 deploy 重啟持續改密碼。
3. migration 044 已落檔後,route 不應再有 `PLAYER_PASSWORD_VAULT_KEY` 缺失 503。
4. 正式部署後 smoke 必須是:MOD-15 選 creator01/02 → 顯示目前密碼 → 各自登入遊戲成功,不能再要求 Uria 手動重設。

## 自知風險

- DB 完整外洩時 key 與 ciphertext 可同時取得;這是「真正可讀密碼管理器 + Uria 零部署操作」產品裁定下的明確取捨。
- 若 `account_audit_logs` 的 bootstrap marker 被人工刪除,下次部署會重新產生 creator 密碼;正常 UI 不提供刪除此紀錄。
- Railway 實帳 smoke 必須等部署完成,本機測試不冒充 production 成功。

## Review

待守燈人填寫。
