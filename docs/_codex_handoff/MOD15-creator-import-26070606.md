你是守燈人代理,照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的「代理 review checklist」執行,結論以 PASS/WARN/BLOCK 開頭回覆。

# MOD-15 handoff — 匯入舊 creator01/creator02 到玩家帳號

## 變更摘要

- 需求:Uria 已在舊系統管理員後台建立 `creator01` / `creator02`,需要讓這兩個帳號出現在 MOD-15 帳號管理。
- 現況判讀:舊後台 `admin-system-diag.html` 的 seed-user 寫入 `admin_users`;MOD-15 管理的是 E15-E19 新玩家帳號表 `players`。
- 實作:新增 `MIGRATION_042`,部署跑 migration 時:
  - 從 `admin_users` 找 `creator01` / `creator02`。
  - 若存在,建立或更新同名 `players`。
  - 沿用舊帳號 `password_hash`,所以不需要知道明文密碼。
  - email 使用測試期保留域名:`creator01@ug.local` / `creator02@ug.local`。
  - 舊帳號若 `is_active=false`,MOD-15 player 也標為停用。
  - 寫入 `account_audit_logs` action=`legacy_creator_import`,且冪等避免重複 audit。
- 若 prod 上沒有這兩個舊 admin user,此 migration 會 no-op,不會建立空帳號。

## 動過檔案

- `packages/server/src/db/migrate.ts`
- `packages/server/src/routes/player-accounts.test.ts`

## 測試結果

### Player account tests

```text
> packages\server\node_modules\.bin\tsx.CMD packages\server\src\routes\player-accounts.test.ts

PASS normalizeEmail: trims and lowercases before unique lookup
PASS username policy: permits test account names but rejects spaces
PASS email and password policy match E15a test-phase contract
PASS settleProgressOnServer: awards DB outcome rewards and advances chapter
PASS MIGRATION_042 mirrors creator01/creator02 admin users into MOD-15 players
```

### Server TypeScript

```text
> packages\server\node_modules\.bin\tsc.CMD --noEmit -p packages\server\tsconfig.json
exit 0
```

### Diff check

```text
> git -c safe.directory=C:/Ug/cthulhu-card-game diff --check
exit 0
```

## 自知風險與範圍外

- 本包只做舊 `admin_users` → MOD-15 `players` 的一次性橋接,不開放自助註冊、不改登入 UI。
- `admin_users` 沒有 email 欄位,所以採測試期保留域名 `@ug.local`;若正式期需要真 email,可在 MOD-15 手動改。
- 匯入沿用舊 bcrypt password hash;若舊帳號密碼不符合玩家密碼政策,不影響登入驗證,但後續改密碼會受 MOD-15 的 8 碼規則約束。
- Reviewer 放行後可 push;Railway 部署並跑 migration 後,MOD-15 才會看到 `creator01` / `creator02`。
- 部署前仍需確認 `PLAYER_JWT_SECRET` 與 `ADMIN_JWT_SECRET` 已在 Railway 設定;這是 E15-E19 帳號系統既有 rollout 注意事項。

## Review

待 Hub / 守燈人代理 review。
