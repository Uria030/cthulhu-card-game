# 克蘇魯卡牌冒險

克蘇魯神話世界觀的卡牌驅動合作冒險網頁遊戲。

## 技術架構

- **前端：** React + TypeScript + Vite
- **後端：** Fastify + TypeScript
- **資料庫：** PostgreSQL + Redis
- **Monorepo：** pnpm workspaces

## 開發

```bash
pnpm install
pnpm dev          # 同時啟動前後端
pnpm dev:client   # 僅前端 (port 5173)
pnpm dev:server   # 僅後端 (port 3001)
```

## 專案結構

```
packages/
  shared/   — 前後端共用型別與常數 (@cthulhu/shared)
  client/   — React 前端
  server/   — Fastify 後端
docs/       — 設計文件
```
