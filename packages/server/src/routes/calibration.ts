/**
 * /api/admin/calibration/save
 *
 * 接收 admin 校準完的 hotspots JSON,直接 commit 進 GitHub repo 的
 * `packages/client/src/data/surfaces/<surface>/hotspots.json`。
 * Vercel 偵測到 main 變動 → 1-2 分鐘後玩家側看到新熱區。
 *
 * 必要環境變數:
 *  - GITHUB_TOKEN  Fine-grained PAT,Repository: cthulhu-card-game,Permissions: Contents Read & Write
 *  - GITHUB_OWNER  預設 'Uria030'
 *  - GITHUB_REPO   預設 'cthulhu-card-game'
 *  - GITHUB_BRANCH 預設 'main'
 */
import type { FastifyInstance } from 'fastify';
import { requireAdminRole } from '../middleware/auth.js';

const ALLOWED_SURFACES = new Set(['study-room']);

interface SaveBody {
  surface?: string;
  json?: unknown;
}

export async function calibrationRoutes(app: FastifyInstance) {
  app.post(
    '/api/admin/calibration/save',
    { preHandler: requireAdminRole },
    async (request, reply) => {
      const body = (request.body ?? {}) as SaveBody;
      const surface = body.surface;
      const json = body.json;

      if (!surface || !ALLOWED_SURFACES.has(surface)) {
        return reply.status(400).send({
          success: false,
          error: `surface 不合法。允許值:${[...ALLOWED_SURFACES].join(', ')}`,
        });
      }
      if (!json || typeof json !== 'object') {
        return reply.status(400).send({
          success: false,
          error: 'body.json 缺失或格式錯誤',
        });
      }

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return reply.status(500).send({
          success: false,
          error: '伺服器未設定 GITHUB_TOKEN 環境變數,無法寫入 repo',
        });
      }
      const owner = process.env.GITHUB_OWNER ?? 'Uria030';
      const repo = process.env.GITHUB_REPO ?? 'cthulhu-card-game';
      const branch = process.env.GITHUB_BRANCH ?? 'main';

      const path = `packages/client/src/data/surfaces/${surface}/hotspots.json`;
      const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

      const githubHeaders = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'cthulhu-calibration-server',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };

      // 1. 拿當前檔案 SHA(更新檔案 PUT 必須帶舊 SHA)
      let currentSha: string | null = null;
      try {
        const getRes = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, {
          headers: githubHeaders,
        });
        if (getRes.status === 200) {
          const data = (await getRes.json()) as { sha?: string };
          currentSha = data.sha ?? null;
        } else if (getRes.status === 404) {
          currentSha = null; // 新檔案
        } else {
          const text = await getRes.text();
          return reply.status(502).send({
            success: false,
            error: `GitHub GET 失敗 (${getRes.status}): ${text.slice(0, 300)}`,
          });
        }
      } catch (err) {
        return reply.status(502).send({
          success: false,
          error: `GitHub GET 連線失敗: ${(err as Error).message}`,
        });
      }

      // 2. 把新 JSON 編成 base64,PUT 到 repo
      const jsonText = JSON.stringify(json, null, 2) + '\n';
      const contentB64 = Buffer.from(jsonText, 'utf-8').toString('base64');
      const user = (request as { user?: { username?: string } }).user;
      const username = user?.username ?? 'admin';
      const message = `chore(calibration): 更新 ${surface} hotspots.json (by ${username})`;

      try {
        const putRes = await fetch(apiBase, {
          method: 'PUT',
          headers: { ...githubHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            content: contentB64,
            branch,
            ...(currentSha ? { sha: currentSha } : {}),
            committer: {
              name: 'Calibration Bot',
              email: 'calibration@cthulhu.local',
            },
          }),
        });
        if (putRes.status !== 200 && putRes.status !== 201) {
          const text = await putRes.text();
          return reply.status(502).send({
            success: false,
            error: `GitHub PUT 失敗 (${putRes.status}): ${text.slice(0, 300)}`,
          });
        }
        const data = (await putRes.json()) as {
          commit?: { sha?: string; html_url?: string };
        };
        return reply.send({
          success: true,
          surface,
          commitSha: data.commit?.sha ?? null,
          commitUrl: data.commit?.html_url ?? null,
          message: 'hotspots.json 已寫入 main,Vercel 約 1-2 分鐘後部署完成',
        });
      } catch (err) {
        return reply.status(502).send({
          success: false,
          error: `GitHub PUT 連線失敗: ${(err as Error).message}`,
        });
      }
    },
  );
}
