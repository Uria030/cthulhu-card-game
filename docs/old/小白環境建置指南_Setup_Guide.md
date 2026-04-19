# 小白電腦環境建置指南
## New Machine Setup Guide

> **文件用途｜Purpose**
> 這份文件讓你在小白電腦上從零開始接手小黑的所有進度。
> 按照步驟順序執行即可，不需要任何技術知識。

---

## 前置確認：小白需要什麼

在開始之前，確認小白上已經安裝以下軟體：

| 軟體 | 用途 | 下載位置 |
|------|------|----------|
| **Node.js** (v18 以上) | 執行程式碼 | https://nodejs.org/ → 下載 LTS 版本 |
| **Git** | 版本管理 | https://git-scm.com/downloads |
| **pnpm** | 套件管理 | Node.js 裝好後，開命令提示字元輸入 `npm install -g pnpm` |
| **Claude Code** | AI 開發助手 | 你應該已經有了 |

### 怎麼確認已經裝好

開啟命令提示字元（CMD）或 PowerShell，輸入以下指令，每個都應該顯示版本號：

```
node --version
git --version
pnpm --version
```

如果任何一個顯示「不是內部或外部命令」，就表示還沒裝好。

---

## 步驟一：從 GitHub 下載專案

1. 開啟命令提示字元
2. 切換到你想放專案的目錄（例如 D 槽）：
   ```
   D:
   ```
3. 從 GitHub 複製專案：
   ```
   git clone https://github.com/你的GitHub帳號/cthulhu-card-game.git
   ```
4. 進入專案目錄：
   ```
   cd cthulhu-card-game
   ```

> **注意：** 把 `你的GitHub帳號` 替換成你實際的 GitHub 帳號名稱。
> 如果你忘了 repo 名稱，登入 https://github.com 就能在首頁看到。

---

## 步驟二：安裝專案依賴

在專案目錄下執行：

```
pnpm install
```

等它跑完。這會安裝所有需要的套件。

---

## 步驟三：設定 GitHub 認證

讓小白可以推送程式碼到 GitHub：

1. 到 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. 產生新的 Token：
   - Repository access → All repositories
   - Permissions → **Administration**: Read and write
   - Permissions → **Contents**: Read and write
   - 其他全部不用勾
3. 按 Generate token
4. **重要：** Token 只會顯示一次，複製後安全保存（不要貼在對話中）
5. 在命令提示字元設定認證（Claude Code 會引導你完成這步）

---

## 步驟四：驗證本地開發環境

在專案目錄下測試：

```
pnpm dev:client
```

打開瀏覽器到 `http://localhost:5173`，應該看到遊戲前端頁面。
按 `Ctrl+C` 停止。

```
pnpm dev:server
```

打開瀏覽器到 `http://localhost:3001/health`，應該看到 `{"status":"ok","version":"0.1.0"}`。
按 `Ctrl+C` 停止。

如果兩個都正常，本地環境就完成了。

---

## 步驟五：用 Claude Code 接手開發

1. 打開 Claude Code
2. 切換到專案目錄：
   ```
   cd D:\cthulhu-card-game
   ```
   （或你在步驟一放專案的實際路徑）
3. Claude Code 會自動讀取專案中的 `CLAUDE.md`，了解整個專案結構
4. 你可以直接開始工作，例如：
   - 「請按照 Claude_Code_Admin_Module_指令.md 建立系統管理員後台」
   - 「幫我建立 SIM-01 骰子機率分析器的完整功能」

---

## 目前的部署環境

以下是已經設好的雲端服務，你不需要重新設定 — 它們跟著 GitHub repo 走：

| 服務 | 用途 | 網址 | 狀態 |
|------|------|------|------|
| **GitHub** | 程式碼存放 | https://github.com/你的帳號/cthulhu-card-game | ✅ 已建立 |
| **Vercel** | 前端部署 | cthulhu-card-game-client.vercel.app | ✅ 已上線 |
| **Railway** | 後端 + 資料庫 | server-production-xxxx.up.railway.app | ✅ 已上線 |

只要你在小白上推送程式碼到 GitHub（`git push`），Vercel 和 Railway 會自動重新部署。

---

## 目前專案進度總覽

### 已完成的設計文件（在 Project Knowledge 中）

| 文件 | 內容 |
|------|------|
| 核心設計原則 v0.2 | 八大支柱 + 五個補充系統 + 戰鬥系統 E1–E4 |
| 數值規格文件 v0.1 | d20、7 屬性、21 點創角、HP/SAN 公式、敵人五階、武器六階、卡牌經濟 |
| 資料庫結構設計 v0.1 | PostgreSQL + Redis 完整 Schema |
| 支柱一詳細設計 v0.1 | 八陣營極（MBTI）、卡池結構、卡片三層標籤 |
| Claude Code Admin Module 指令 | 系統管理員後台 14 模組建置指令 |

### 已確認的數值系統

- 骰子：d20
- 屬性：7 項（力量、敏捷、體質、智力、意志、感知、魅力），範圍 1–10
- 修正值：屬性 ÷ 2 無條件捨去
- 創角：21 點，每項 1–5
- HP = 體質 × 2 + 5，SAN = 意志 × 2 + 5
- 行動經濟：每回合 3 行動點
- 固定傷害，武器 6 階（1–6 傷害）
- 敵人 5 階（DC 8–24）
- 三層修正疊加：巔峰 +12（屬性 +5 / 熟練 +3 / 裝備 +4）
- 手牌上限 8，每回合抽 1 張
- 起始資源 5，每回合 +1，費用 1–6
- 巨頭錨點：DC 24 / HP 60 / 回血 4 / 每回合扣意志上限 2

### 已確認的陣營系統

八陣營極（MBTI 四維度）：
- E 號令 / I 深淵 / S 鐵證 / N 天啟 / T 解析 / F 聖燼 / J 鐵壁 / P 流影
- 玩家選四個極組成人格原型（16 種組合）
- 副陣營 = 翻轉一個維度
- 卡片三層標籤：陣營極 × 風格（AH/AC/OH/OC）× 類別（資產/事件/盟友/技能）

### 技術基礎設施

- 前端：React + TypeScript + Vite → Vercel ✅
- 後端：Node.js + Fastify + TypeScript → Railway ✅
- 資料庫：PostgreSQL ✅ + Redis ✅ → Railway
- Monorepo：pnpm workspaces
- 前後端已串接（CORS + 環境變數）

### 下一步待辦

1. **建立系統管理員後台** — 用 Claude_Code_Admin_Module_指令.md 建立 14 個模組骨架
2. **填充模擬器模組** — 把今天在 Claude.ai 做的六個互動模擬器轉成正式版
3. **填充內容管理模組** — 從卡片設計器開始，逐步建立遊戲內容
4. **建立創角器** — 內容管理模組有東西後才能做

---

## 常用指令速查

| 指令 | 用途 |
|------|------|
| `pnpm dev` | 同時啟動前後端 |
| `pnpm dev:client` | 僅啟動前端（localhost:5173） |
| `pnpm dev:server` | 僅啟動後端（localhost:3001） |
| `git pull` | 從 GitHub 拉最新程式碼 |
| `git add .` | 暫存所有變更 |
| `git commit -m "描述"` | 提交變更 |
| `git push` | 推送到 GitHub（自動觸發部署） |

---

> **提醒：** 如果在小白上遇到任何問題，直接把錯誤訊息貼給 Claude Code 或回到 Claude.ai 問我。
