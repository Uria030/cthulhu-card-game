import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

export const talentTreeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // ════════════════════════════════════════════
  //  批次操作 — 必須在 /:param 之前定義
  // ════════════════════════════════════════════

  // ── GET /api/talent-trees/export ──
  app.get('/api/talent-trees/export', async (request, reply) => {
    try {
      const trees = await pool.query('SELECT * FROM talent_trees ORDER BY faction_code');
      const branches = await pool.query('SELECT * FROM talent_branches ORDER BY tree_id, branch_index');
      const nodes = await pool.query('SELECT * FROM talent_nodes ORDER BY tree_id, level, sort_order');
      const effects = await pool.query('SELECT * FROM talent_node_effects ORDER BY node_id, sort_order');

      const data = trees.rows.map((t: any) => ({
        ...t,
        branches: branches.rows.filter((b: any) => b.tree_id === t.id),
        nodes: nodes.rows
          .filter((n: any) => n.tree_id === t.id)
          .map((n: any) => ({
            ...n,
            effects: effects.rows
              .filter((e: any) => e.node_id === n.id)
              .map((e: any) => ({ ...e, effect_value: e.effect_value != null ? parseFloat(e.effect_value) : null })),
          })),
      }));

      reply.header('Content-Disposition', `attachment; filename="talent-trees-export-${new Date().toISOString().split('T')[0]}.json"`);
      return reply.send({ exported_at: new Date().toISOString(), total: data.length, data });
    } catch (error) {
      request.log.error(error, 'Export talent-trees error');
      return reply.status(500).send({ success: false, error: 'Failed to export' });
    }
  });

  // ── POST /api/talent-trees/import ──
  app.post('/api/talent-trees/import', async (request, reply) => {
    try {
      const { data } = request.body as any;
      if (!Array.isArray(data)) return reply.status(400).send({ success: false, error: 'Invalid import format' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let importedTrees = 0;

        for (const tree of data) {
          // Upsert tree
          const treeResult = await client.query(`
            INSERT INTO talent_trees (faction_code, name_zh, name_en, description_zh, description_en,
              primary_attribute, secondary_attribute, combat_proficiency_primary, combat_proficiency_secondary,
              design_notes, design_status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT (faction_code) DO UPDATE SET
              name_zh=EXCLUDED.name_zh, name_en=EXCLUDED.name_en,
              description_zh=EXCLUDED.description_zh, description_en=EXCLUDED.description_en,
              primary_attribute=EXCLUDED.primary_attribute, secondary_attribute=EXCLUDED.secondary_attribute,
              combat_proficiency_primary=EXCLUDED.combat_proficiency_primary,
              combat_proficiency_secondary=EXCLUDED.combat_proficiency_secondary,
              design_notes=EXCLUDED.design_notes, design_status=EXCLUDED.design_status,
              updated_at=NOW()
            RETURNING id
          `, [tree.faction_code, tree.name_zh, tree.name_en, tree.description_zh, tree.description_en,
              tree.primary_attribute, tree.secondary_attribute,
              tree.combat_proficiency_primary, tree.combat_proficiency_secondary,
              tree.design_notes, tree.design_status || 'pending']);

          const treeId = treeResult.rows[0].id;

          // Upsert branches
          if (tree.branches) {
            for (const b of tree.branches) {
              await client.query(`
                INSERT INTO talent_branches (tree_id, branch_index, name_zh, name_en, description_zh, description_en, theme_keywords, color_hex, design_notes)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                ON CONFLICT (tree_id, branch_index) DO UPDATE SET
                  name_zh=EXCLUDED.name_zh, name_en=EXCLUDED.name_en,
                  description_zh=EXCLUDED.description_zh, description_en=EXCLUDED.description_en,
                  theme_keywords=EXCLUDED.theme_keywords, color_hex=EXCLUDED.color_hex,
                  design_notes=EXCLUDED.design_notes, updated_at=NOW()
              `, [treeId, b.branch_index, b.name_zh, b.name_en, b.description_zh, b.description_en,
                  b.theme_keywords, b.color_hex, b.design_notes]);
            }
          }

          // Replace nodes + effects
          if (tree.nodes) {
            await client.query('DELETE FROM talent_nodes WHERE tree_id = $1', [treeId]);
            for (const n of tree.nodes) {
              let branchId = null;
              if (n.branch_id && n.branch_index != null) {
                const br = await client.query('SELECT id FROM talent_branches WHERE tree_id=$1 AND branch_index=$2', [treeId, n.branch_index]);
                branchId = br.rows[0]?.id || null;
              } else if (!n.is_trunk && n.branch_id) {
                branchId = n.branch_id;
              }

              const nodeRes = await client.query(`
                INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en,
                  description_zh, description_en, boost_attribute, boost_amount, talent_card_code,
                  prerequisites, talent_point_cost, sort_order, design_status, design_notes)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                RETURNING id
              `, [treeId, branchId, n.level, n.is_trunk, n.node_type, n.name_zh, n.name_en,
                  n.description_zh, n.description_en, n.boost_attribute, n.boost_amount || 1,
                  n.talent_card_code, JSON.stringify(n.prerequisites || []),
                  n.talent_point_cost || 1, n.sort_order || 0, n.design_status || 'pending', n.design_notes]);

              const nodeId = nodeRes.rows[0].id;
              if (n.effects) {
                for (const e of n.effects) {
                  await client.query(`
                    INSERT INTO talent_node_effects (node_id, effect_code, effect_params, effect_desc_zh, effect_desc_en, effect_value, sort_order)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)
                  `, [nodeId, e.effect_code, JSON.stringify(e.effect_params || {}),
                      e.effect_desc_zh, e.effect_desc_en, e.effect_value || 0, e.sort_order || 0]);
                }
              }
            }
          }
          importedTrees++;
        }

        await client.query('COMMIT');
        return reply.send({ success: true, imported: importedTrees });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (error) {
      request.log.error(error, 'Import talent-trees error');
      return reply.status(500).send({ success: false, error: 'Failed to import' });
    }
  });

  // ── GET /api/talent-trees/compare ──
  app.get('/api/talent-trees/compare', async (request, reply) => {
    try {
      const trees = await pool.query(`
        SELECT tt.id, tt.faction_code, tt.name_zh, tt.primary_attribute, tt.secondary_attribute,
               tt.combat_proficiency_primary, tt.combat_proficiency_secondary, tt.design_status
        FROM talent_trees tt ORDER BY tt.faction_code
      `);

      const data = [];
      for (const t of trees.rows as any[]) {
        const nodesRes = await pool.query(`
          SELECT tn.id, tn.node_type, tn.branch_id, tn.design_status,
                 tb.branch_index
          FROM talent_nodes tn
          LEFT JOIN talent_branches tb ON tb.id = tn.branch_id
          WHERE tn.tree_id = $1
        `, [t.id]);

        const nodes = nodesRes.rows as any[];
        const totalNodes = nodes.length;
        const designedNodes = nodes.filter((n: any) => n.design_status === 'complete' || n.design_status === 'draft').length;

        // Node type distribution
        const dist: Record<string, number> = {};
        for (const n of nodes) { dist[n.node_type] = (dist[n.node_type] || 0) + 1; }

        // Branch stats
        const branchStats: any[] = [];
        for (let bi = 1; bi <= 3; bi++) {
          const branchNodes = nodes.filter((n: any) => n.branch_index === bi);
          const branchRes = await pool.query('SELECT name_zh FROM talent_branches WHERE tree_id=$1 AND branch_index=$2', [t.id, bi]);
          branchStats.push({
            index: bi,
            name_zh: branchRes.rows[0]?.name_zh || '',
            designed: branchNodes.filter((n: any) => n.design_status === 'complete' || n.design_status === 'draft').length,
            total: branchNodes.length,
          });
        }

        // Sum effect values per branch
        const valueRes = await pool.query(`
          SELECT tb.branch_index, COALESCE(SUM(tne.effect_value), 0) AS total_value
          FROM talent_nodes tn
          JOIN talent_branches tb ON tb.id = tn.branch_id
          LEFT JOIN talent_node_effects tne ON tne.node_id = tn.id
          WHERE tn.tree_id = $1
          GROUP BY tb.branch_index ORDER BY tb.branch_index
        `, [t.id]);

        data.push({
          faction_code: t.faction_code,
          name_zh: t.name_zh,
          primary_attribute: t.primary_attribute,
          secondary_attribute: t.secondary_attribute,
          combat_proficiency_primary: t.combat_proficiency_primary,
          combat_proficiency_secondary: t.combat_proficiency_secondary,
          design_status: t.design_status,
          completion_rate: totalNodes > 0 ? designedNodes / totalNodes : 0,
          total_value_branch_1: parseFloat(valueRes.rows.find((r: any) => r.branch_index === 1)?.total_value || '0'),
          total_value_branch_2: parseFloat(valueRes.rows.find((r: any) => r.branch_index === 2)?.total_value || '0'),
          total_value_branch_3: parseFloat(valueRes.rows.find((r: any) => r.branch_index === 3)?.total_value || '0'),
          node_type_distribution: dist,
          branches: branchStats,
        });
      }

      return reply.send({ success: true, data });
    } catch (error) {
      request.log.error(error, 'Compare talent-trees error');
      return reply.status(500).send({ success: false, error: 'Failed to compare' });
    }
  });

  // ════════════════════════════════════════════
  //  天賦樹 CRUD
  // ════════════════════════════════════════════

  // ── GET /api/talent-trees ── 取得所有（含摘要）
  app.get('/api/talent-trees', async (request, reply) => {
    try {
      const trees = await pool.query('SELECT * FROM talent_trees ORDER BY faction_code');
      const data = [];

      for (const t of trees.rows as any[]) {
        const nodesRes = await pool.query(`
          SELECT tn.design_status, tn.branch_id, tb.branch_index, tb.name_zh AS branch_name_zh
          FROM talent_nodes tn
          LEFT JOIN talent_branches tb ON tb.id = tn.branch_id
          WHERE tn.tree_id = $1
        `, [t.id]);

        const nodes = nodesRes.rows as any[];
        const designed = nodes.filter((n: any) => n.design_status === 'complete' || n.design_status === 'draft').length;

        const branchStats: any[] = [];
        for (let bi = 1; bi <= 3; bi++) {
          const bn = nodes.filter((n: any) => n.branch_index === bi);
          const branchRes = await pool.query('SELECT name_zh FROM talent_branches WHERE tree_id=$1 AND branch_index=$2', [t.id, bi]);
          branchStats.push({
            index: bi,
            name_zh: branchRes.rows[0]?.name_zh || '',
            designed: bn.filter((n: any) => n.design_status === 'complete' || n.design_status === 'draft').length,
            total: bn.length,
          });
        }

        data.push({
          ...t,
          stats: {
            total_nodes: nodes.length,
            designed_nodes: designed,
            pending_nodes: nodes.length - designed,
            branches: branchStats,
          },
        });
      }

      return reply.send({ success: true, data, total: data.length });
    } catch (error) {
      request.log.error(error, 'GET talent-trees error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch talent trees' });
    }
  });

  // ── GET /api/talent-trees/:factionCode ── 取得單棵（含全部）
  app.get<{ Params: { factionCode: string } }>('/api/talent-trees/:factionCode', async (request, reply) => {
    try {
      const { factionCode } = request.params;
      const treeRes = await pool.query('SELECT * FROM talent_trees WHERE faction_code = $1', [factionCode.toUpperCase()]);
      if (treeRes.rows.length === 0) return reply.status(404).send({ success: false, error: 'Tree not found' });
      const tree = treeRes.rows[0] as any;

      const branchesRes = await pool.query(
        'SELECT * FROM talent_branches WHERE tree_id = $1 ORDER BY branch_index', [tree.id]);

      const nodesRes = await pool.query(
        'SELECT * FROM talent_nodes WHERE tree_id = $1 ORDER BY level, sort_order', [tree.id]);

      const nodeIds = (nodesRes.rows as any[]).map((n: any) => n.id);
      let effectsRows: any[] = [];
      if (nodeIds.length > 0) {
        const effectsRes = await pool.query(
          `SELECT * FROM talent_node_effects WHERE node_id = ANY($1) ORDER BY sort_order`, [nodeIds]);
        effectsRows = effectsRes.rows;
      }

      const nodes = (nodesRes.rows as any[]).map((n: any) => ({
        ...n,
        effects: effectsRows
          .filter((e: any) => e.node_id === n.id)
          .map((e: any) => ({ ...e, effect_value: e.effect_value != null ? parseFloat(e.effect_value) : null })),
      }));

      return reply.send({
        success: true,
        data: { ...tree, branches: branchesRes.rows, nodes },
      });
    } catch (error) {
      request.log.error(error, 'GET talent-tree detail error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch tree' });
    }
  });

  // ── PUT /api/talent-trees/:factionCode ── 更新天賦樹基本資訊
  app.put<{ Params: { factionCode: string } }>('/api/talent-trees/:factionCode', async (request, reply) => {
    try {
      const { factionCode } = request.params;
      const body = request.body as any;

      const result = await pool.query(`
        UPDATE talent_trees SET
          name_zh = COALESCE($2, name_zh),
          name_en = COALESCE($3, name_en),
          description_zh = $4,
          description_en = $5,
          primary_attribute = COALESCE($6, primary_attribute),
          secondary_attribute = $7,
          combat_proficiency_primary = $8,
          combat_proficiency_secondary = $9,
          design_notes = $10,
          design_status = COALESCE($11, design_status),
          updated_at = NOW()
        WHERE faction_code = $1
        RETURNING *
      `, [factionCode.toUpperCase(), body.name_zh, body.name_en, body.description_zh, body.description_en,
          body.primary_attribute, body.secondary_attribute,
          body.combat_proficiency_primary, body.combat_proficiency_secondary,
          body.design_notes, body.design_status]);

      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Tree not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT talent-tree error');
      return reply.status(500).send({ success: false, error: 'Failed to update tree' });
    }
  });

  // ── GET /api/talent-trees/:factionCode/stats ──
  app.get<{ Params: { factionCode: string } }>('/api/talent-trees/:factionCode/stats', async (request, reply) => {
    try {
      const { factionCode } = request.params;
      const treeRes = await pool.query('SELECT id FROM talent_trees WHERE faction_code = $1', [factionCode.toUpperCase()]);
      if (treeRes.rows.length === 0) return reply.status(404).send({ success: false, error: 'Tree not found' });
      const treeId = (treeRes.rows[0] as any).id;

      const byType = await pool.query(`
        SELECT node_type, COUNT(*)::int AS count FROM talent_nodes WHERE tree_id=$1 GROUP BY node_type
      `, [treeId]);
      const byStatus = await pool.query(`
        SELECT design_status, COUNT(*)::int AS count FROM talent_nodes WHERE tree_id=$1 GROUP BY design_status
      `, [treeId]);
      const totalValue = await pool.query(`
        SELECT COALESCE(SUM(tne.effect_value), 0) AS total
        FROM talent_nodes tn
        JOIN talent_node_effects tne ON tne.node_id = tn.id
        WHERE tn.tree_id = $1
      `, [treeId]);

      return reply.send({
        success: true,
        data: {
          by_type: byType.rows,
          by_status: byStatus.rows,
          total_effect_value: parseFloat((totalValue.rows[0] as any).total),
        },
      });
    } catch (error) {
      request.log.error(error, 'GET talent-tree stats error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch stats' });
    }
  });

  // ════════════════════════════════════════════
  //  分支路線
  // ════════════════════════════════════════════

  // ── GET /api/talent-trees/:factionCode/branches ──
  app.get<{ Params: { factionCode: string } }>('/api/talent-trees/:factionCode/branches', async (request, reply) => {
    try {
      const { factionCode } = request.params;
      const treeRes = await pool.query('SELECT id FROM talent_trees WHERE faction_code = $1', [factionCode.toUpperCase()]);
      if (treeRes.rows.length === 0) return reply.status(404).send({ success: false, error: 'Tree not found' });

      const result = await pool.query(
        'SELECT * FROM talent_branches WHERE tree_id = $1 ORDER BY branch_index',
        [(treeRes.rows[0] as any).id]);
      return reply.send({ success: true, data: result.rows });
    } catch (error) {
      request.log.error(error, 'GET branches error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch branches' });
    }
  });

  // ── PUT /api/talent-trees/:factionCode/branches/:index ──
  app.put<{ Params: { factionCode: string; index: string } }>('/api/talent-trees/:factionCode/branches/:index', async (request, reply) => {
    try {
      const { factionCode, index } = request.params;
      const body = request.body as any;

      const treeRes = await pool.query('SELECT id FROM talent_trees WHERE faction_code = $1', [factionCode.toUpperCase()]);
      if (treeRes.rows.length === 0) return reply.status(404).send({ success: false, error: 'Tree not found' });

      const result = await pool.query(`
        UPDATE talent_branches SET
          name_zh = COALESCE($3, name_zh),
          name_en = COALESCE($4, name_en),
          description_zh = $5,
          description_en = $6,
          theme_keywords = $7,
          color_hex = $8,
          design_notes = $9,
          updated_at = NOW()
        WHERE tree_id = $1 AND branch_index = $2
        RETURNING *
      `, [(treeRes.rows[0] as any).id, parseInt(index), body.name_zh, body.name_en,
          body.description_zh, body.description_en, body.theme_keywords, body.color_hex, body.design_notes]);

      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Branch not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT branch error');
      return reply.status(500).send({ success: false, error: 'Failed to update branch' });
    }
  });

  // ════════════════════════════════════════════
  //  天賦節點
  // ════════════════════════════════════════════

  // ── GET /api/talent-trees/:factionCode/nodes ──
  app.get<{ Params: { factionCode: string } }>('/api/talent-trees/:factionCode/nodes', async (request, reply) => {
    try {
      const { factionCode } = request.params;
      const treeRes = await pool.query('SELECT id FROM talent_trees WHERE faction_code = $1', [factionCode.toUpperCase()]);
      if (treeRes.rows.length === 0) return reply.status(404).send({ success: false, error: 'Tree not found' });

      const result = await pool.query(
        'SELECT * FROM talent_nodes WHERE tree_id = $1 ORDER BY level, sort_order',
        [(treeRes.rows[0] as any).id]);
      return reply.send({ success: true, data: result.rows });
    } catch (error) {
      request.log.error(error, 'GET nodes error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch nodes' });
    }
  });

  // ── GET /api/talent-trees/:factionCode/nodes/:nodeId ──
  app.get<{ Params: { factionCode: string; nodeId: string } }>('/api/talent-trees/:factionCode/nodes/:nodeId', async (request, reply) => {
    try {
      const { nodeId } = request.params;
      const nodeRes = await pool.query('SELECT * FROM talent_nodes WHERE id = $1', [nodeId]);
      if (nodeRes.rows.length === 0) return reply.status(404).send({ success: false, error: 'Node not found' });

      const effectsRes = await pool.query(
        'SELECT * FROM talent_node_effects WHERE node_id = $1 ORDER BY sort_order', [nodeId]);

      return reply.send({
        success: true,
        data: {
          ...(nodeRes.rows[0] as any),
          effects: effectsRes.rows.map((e: any) => ({
            ...e, effect_value: e.effect_value != null ? parseFloat(e.effect_value) : null,
          })),
        },
      });
    } catch (error) {
      request.log.error(error, 'GET node detail error');
      return reply.status(500).send({ success: false, error: 'Failed to fetch node' });
    }
  });

  // ── PUT /api/talent-trees/:factionCode/nodes/:nodeId ──
  app.put<{ Params: { factionCode: string; nodeId: string } }>('/api/talent-trees/:factionCode/nodes/:nodeId', async (request, reply) => {
    try {
      const { nodeId } = request.params;
      const body = request.body as any;

      const result = await pool.query(`
        UPDATE talent_nodes SET
          name_zh = COALESCE($2, name_zh),
          name_en = COALESCE($3, name_en),
          description_zh = $4,
          description_en = $5,
          node_type = COALESCE($6, node_type),
          boost_attribute = $7,
          boost_amount = COALESCE($8, boost_amount),
          talent_card_code = $9,
          prerequisites = COALESCE($10, prerequisites),
          talent_point_cost = COALESCE($11, talent_point_cost),
          design_status = COALESCE($12, design_status),
          design_notes = $13,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [nodeId, body.name_zh, body.name_en, body.description_zh, body.description_en,
          body.node_type, body.boost_attribute, body.boost_amount,
          body.talent_card_code, body.prerequisites ? JSON.stringify(body.prerequisites) : null,
          body.talent_point_cost, body.design_status, body.design_notes]);

      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Node not found' });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'PUT node error');
      return reply.status(500).send({ success: false, error: 'Failed to update node' });
    }
  });

  // ── POST /api/talent-trees/:factionCode/nodes ── 新增節點（備用）
  app.post<{ Params: { factionCode: string } }>('/api/talent-trees/:factionCode/nodes', async (request, reply) => {
    try {
      const { factionCode } = request.params;
      const body = request.body as any;

      const treeRes = await pool.query('SELECT id FROM talent_trees WHERE faction_code = $1', [factionCode.toUpperCase()]);
      if (treeRes.rows.length === 0) return reply.status(404).send({ success: false, error: 'Tree not found' });
      const treeId = (treeRes.rows[0] as any).id;

      const result = await pool.query(`
        INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en,
          description_zh, description_en, boost_attribute, boost_amount, talent_card_code,
          prerequisites, talent_point_cost, sort_order, design_status, design_notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        RETURNING *
      `, [treeId, body.branch_id || null, body.level, body.is_trunk || false,
          body.node_type || 'passive', body.name_zh, body.name_en,
          body.description_zh, body.description_en, body.boost_attribute, body.boost_amount || 1,
          body.talent_card_code, JSON.stringify(body.prerequisites || []),
          body.talent_point_cost || 1, body.sort_order || 0,
          body.design_status || 'pending', body.design_notes]);

      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (error) {
      request.log.error(error, 'POST node error');
      return reply.status(500).send({ success: false, error: 'Failed to create node' });
    }
  });

  // ── DELETE /api/talent-trees/:factionCode/nodes/:nodeId ──
  app.delete<{ Params: { factionCode: string; nodeId: string } }>('/api/talent-trees/:factionCode/nodes/:nodeId', async (request, reply) => {
    try {
      const { nodeId } = request.params;
      const result = await pool.query('DELETE FROM talent_nodes WHERE id = $1 RETURNING id', [nodeId]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: 'Node not found' });
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, 'DELETE node error');
      return reply.status(500).send({ success: false, error: 'Failed to delete node' });
    }
  });

  // ════════════════════════════════════════════
  //  節點效果
  // ════════════════════════════════════════════

  // ── PUT /api/talent-trees/:factionCode/nodes/:nodeId/effects ── 批次覆寫
  app.put<{ Params: { factionCode: string; nodeId: string } }>('/api/talent-trees/:factionCode/nodes/:nodeId/effects', async (request, reply) => {
    try {
      const { nodeId } = request.params;
      const { effects } = request.body as any;
      if (!Array.isArray(effects)) return reply.status(400).send({ success: false, error: 'effects must be an array' });

      const nodeCheck = await pool.query('SELECT id FROM talent_nodes WHERE id = $1', [nodeId]);
      if (nodeCheck.rows.length === 0) return reply.status(404).send({ success: false, error: 'Node not found' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM talent_node_effects WHERE node_id = $1', [nodeId]);

        const inserted: any[] = [];
        for (let i = 0; i < effects.length; i++) {
          const e = effects[i];
          const res = await client.query(`
            INSERT INTO talent_node_effects (node_id, effect_code, effect_params, effect_desc_zh, effect_desc_en, effect_value, sort_order)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *
          `, [nodeId, e.effect_code, JSON.stringify(e.effect_params || {}),
              e.effect_desc_zh, e.effect_desc_en, e.effect_value || 0, i]);
          inserted.push({ ...res.rows[0], effect_value: res.rows[0].effect_value != null ? parseFloat(res.rows[0].effect_value) : null });
        }

        await client.query('COMMIT');
        return reply.send({ success: true, data: inserted });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (error) {
      request.log.error(error, 'PUT node effects error');
      return reply.status(500).send({ success: false, error: 'Failed to update effects' });
    }
  });
};
