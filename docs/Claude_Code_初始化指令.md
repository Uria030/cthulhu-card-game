# Claude Code 專案初始化指令
## Project Initialization Instructions for Claude Code

> **文件用途｜Purpose**
> 這份文件是給 Claude Code 工作階段使用的指令。Uria 只需要把這份文件的內容貼給 Claude Code，它就會自動在電腦上完成所有初始化步驟。
>
> **前置條件｜Prerequisites**
> - 已安裝 Node.js (v18+)
> - 已安裝 Git
> - 已有 GitHub 帳號並已登入
> - 已安裝 Claude Code

---

## 一、專案概述（給 Claude Code 閱讀）

這是一個克蘇魯神話世界觀的卡牌驅動合作冒險網頁遊戲。

**技術組合：**
- 前端：React + TypeScript（部署至 Vercel）
- 後端：Node.js + Fastify + TypeScript（部署至 Railway）
- 資料庫：PostgreSQL + Redis（Railway 託管）
- 單一 monorepo 結構，使用 pnpm workspaces

**專案創辦人 Uria 不具備資工背景，所有技術決策由你（Claude Code）自行判斷。**

---

## 二、請執行以下步驟

### 步驟 1：建立專案目錄結構

```
project-root/
├── README.md
├── package.json              # monorepo root
├── pnpm-workspace.yaml
├── .gitignore
├── .env.example
├── docs/                     # 設計文件
│   ├── 核心設計原則_v0.1.md
│   ├── 數值規格文件_v0.1.md
│   └── 資料庫結構設計_v0.1.md
├── packages/
│   ├── shared/               # 前後端共用型別與常數
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── types/
│   │       │   ├── investigator.ts    # 調查員相關型別
│   │       │   ├── card.ts            # 卡片相關型別
│   │       │   ├── campaign.ts        # 戰役相關型別
│   │       │   ├── combat.ts          # 戰鬥相關型別
│   │       │   └── index.ts
│   │       └── constants/
│   │           ├── attributes.ts      # 七屬性定義
│   │           ├── game-rules.ts      # 數值規格常數
│   │           └── index.ts
│   ├── client/               # React 前端
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── components/
│   │       ├── pages/
│   │       ├── hooks/
│   │       ├── stores/
│   │       └── styles/
│   └── server/               # Fastify 後端
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts          # 伺服器入口
│           ├── app.ts            # Fastify 應用設定
│           ├── routes/
│           │   ├── health.ts     # 健康檢查端點
│           │   └── index.ts
│           ├── db/
│           │   └── schema.sql    # PostgreSQL Schema
│           ├── services/
│           └── utils/
│               └── dice.ts       # d20 骰子邏輯（伺服器端擲骰）
└── CLAUDE.md                 # Claude Code 專案說明
```

### 步驟 2：初始化 monorepo

根目錄 `package.json`：
```json
{
  "name": "cthulhu-card-game",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "pnpm --parallel -r dev",
    "dev:client": "pnpm --filter client dev",
    "dev:server": "pnpm --filter server dev",
    "build": "pnpm -r build",
    "clean": "pnpm -r clean"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

`pnpm-workspace.yaml`：
```yaml
packages:
  - 'packages/*'
```

### 步驟 3：設定 shared 套件

`packages/shared/package.json`：
```json
{
  "name": "@cthulhu/shared",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist"
  }
}
```

在 `packages/shared/src/constants/attributes.ts` 中定義七大屬性：
```typescript
export const ATTRIBUTES = {
  strength:     { id: 'strength',     zh: '力量', en: 'Strength',     abbr: 'STR' },
  agility:      { id: 'agility',      zh: '敏捷', en: 'Agility',      abbr: 'DEX' },
  constitution: { id: 'constitution', zh: '體質', en: 'Constitution', abbr: 'CON' },
  intellect:    { id: 'intellect',    zh: '智力', en: 'Intellect',    abbr: 'INT' },
  willpower:    { id: 'willpower',    zh: '意志', en: 'Willpower',    abbr: 'WIL' },
  perception:   { id: 'perception',   zh: '感知', en: 'Perception',   abbr: 'PER' },
  charisma:     { id: 'charisma',     zh: '魅力', en: 'Charisma',     abbr: 'CHA' },
} as const;

export type AttributeId = keyof typeof ATTRIBUTES;
```

在 `packages/shared/src/constants/game-rules.ts` 中定義數值規格常數：
```typescript
/** 數值規格 — 來源：數值規格文件 v0.1 */
export const GAME_RULES = {
  // 骰子系統
  DICE: 'd20' as const,
  DICE_SIDES: 20,

  // 屬性系統
  ATTRIBUTE_MIN: 1,
  ATTRIBUTE_MAX: 10,
  ATTRIBUTE_CREATION_MAX: 5,
  CREATION_TOTAL_POINTS: 21,
  ATTRIBUTE_COUNT: 7,

  // 修正值
  getModifier: (attributeValue: number): number => Math.floor(attributeValue / 2),

  // HP / SAN
  HP_BASE: 5,
  SAN_BASE: 5,
  getMaxHP: (constitution: number): number => constitution * 2 + 5,
  getMaxSAN: (willpower: number): number => willpower * 2 + 5,

  // 行動經濟
  ACTIONS_PER_TURN: 3,
  HAND_LIMIT: 8,
  CARDS_DRAWN_PER_TURN: 1,

  // 資源經濟
  STARTING_RESOURCES: 5,
  RESOURCE_PER_TURN: 1,
  CARD_COST_MIN: 1,
  CARD_COST_MAX: 6,

  // 起始牌組
  STARTING_DECK_MIN: 15,
  STARTING_DECK_MAX: 20,
  SIGNATURE_CARDS: { min: 2, max: 3 },
  WEAKNESS_CARDS: 1,

  // 敵人 DC 階層
  ENEMY_TIERS: {
    minion: { dc: 8,  hpRange: [3, 5],   dmgRange: [1, 2],  regen: 0 },
    threat: { dc: 12, hpRange: [8, 14],  dmgRange: [2, 4],  regen: 0 },
    elite:  { dc: 16, hpRange: [18, 28], dmgRange: [3, 6],  regen: [0, 1] },
    boss:   { dc: 20, hpRange: [35, 50], dmgRange: [4, 8],  regen: [1, 3] },
    titan:  { dc: 24, hpRange: [55, 70], dmgRange: [6, 10], regen: [3, 5] },
  },

  // 武器傷害階層
  WEAPON_TIERS: {
    makeshift:  { damage: 1, cost: 0, ammo: null },
    basic:      { damage: 2, cost: 2, ammo: 1 },
    standard:   { damage: 3, cost: 3, ammo: 1 },
    advanced:   { damage: 4, cost: 4, ammo: 1 },
    rare:       { damage: 5, cost: 5, ammo: 'special' },
    legendary:  { damage: 6, cost: 6, ammo: 2 },
  },
} as const;
```

### 步驟 4：設定 client（React + Vite）

使用 Vite 建立 React + TypeScript 專案。
安裝依賴：`react`, `react-dom`, `react-router-dom`
開發依賴：`vite`, `@vitejs/plugin-react`, `typescript`

建立一個最小的首頁，顯示專案名稱和基本資訊即可。

### 步驟 5：設定 server（Fastify）

安裝依賴：`fastify`, `@fastify/cors`, `@fastify/websocket`
開發依賴：`typescript`, `tsx`, `@types/node`

建立最小的伺服器，包含：
- `/health` 端點回傳 `{ status: 'ok', version: '0.1.0' }`
- CORS 設定允許 localhost 開發
- 伺服器啟動在 port 3001

在 `packages/server/src/utils/dice.ts` 中實作伺服器端擲骰：
```typescript
/** 伺服器端 d20 擲骰 — 所有骰子結果必須由伺服器產生（反作弊） */
export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

export function skillCheck(
  roll: number,
  modifier: number,
  dc: number
): { success: boolean; total: number; margin: number } {
  const total = roll + modifier;
  return {
    success: total >= dc,
    total,
    margin: total - dc,
  };
}
```

### 步驟 6：建立 CLAUDE.md

在專案根目錄建立 `CLAUDE.md`，這是 Claude Code 的專案說明檔：

```markdown
# CLAUDE.md — 專案指引

## 專案身份
克蘇魯神話卡牌驅動合作冒險網頁遊戲。

## 關鍵設計文件
- `docs/核心設計原則_v0.1.md` — 設計靈魂，最高權威
- `docs/數值規格文件_v0.1.md` — 所有數值參數
- `docs/資料庫結構設計_v0.1.md` — PostgreSQL + Redis Schema

## 技術決策
- Monorepo：pnpm workspaces
- 前端：React + TypeScript + Vite → Vercel
- 後端：Fastify + TypeScript → Railway
- 資料庫：PostgreSQL + Redis → Railway
- 共用型別：@cthulhu/shared

## 開發指令
- `pnpm dev` — 同時啟動前後端
- `pnpm dev:client` — 僅啟動前端（port 5173）
- `pnpm dev:server` — 僅啟動後端（port 3001）

## 協作備註
專案原創者 Uria 不具備資工背景。技術決策由開發者自行判斷，設計決策需經 Uria 確認。與 Uria 溝通時避免技術術語。
```

### 步驟 7：Git 初始化與推送

1. `git init`
2. 建立 `.gitignore`（包含 node_modules, dist, .env, .DS_Store 等）
3. `git add .`
4. `git commit -m "feat: project initialization — monorepo structure, shared types, client + server skeleton"`
5. 在 GitHub 建立新的 repository
6. `git remote add origin <repo-url>`
7. `git push -u origin main`

---

## 三、驗證清單

完成後請確認：
- [ ] `pnpm install` 成功
- [ ] `pnpm dev:client` 啟動後瀏覽器能看到首頁
- [ ] `pnpm dev:server` 啟動後 `curl localhost:3001/health` 回傳 ok
- [ ] `@cthulhu/shared` 的型別和常數在 client 和 server 都能引用
- [ ] Git 已推送至 GitHub

---

## 四、後續步驟（完成初始化後）

1. **Vercel 部署** — 登入 vercel.com，Import GitHub repo，Root Directory 設為 `packages/client`
2. **Railway 部署** — 登入 railway.app，New Project → Deploy from GitHub repo，Root Directory 設為 `packages/server`，同時在 Railway 中建立 PostgreSQL 和 Redis 服務
3. 設定環境變數串接前後端
