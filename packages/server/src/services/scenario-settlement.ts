/**
 * E18/N2b shared scenario settlement.
 *
 * Single-player and multiplayer use the same progress calculation. Multiplayer
 * commits every human seat in one database transaction so a co-op outcome can
 * never advance only part of the party.
 */
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';

export function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function evaluateOutcomeRows(outcomes: Array<Record<string, any>>, flags: Record<string, unknown>): Record<string, any> | null {
  const sorted = [...outcomes].sort((a, b) => String(a.outcome_code).localeCompare(String(b.outcome_code)));
  for (const outcome of sorted) {
    const condition = objectRecord(outcome.condition_expression);
    if (String(condition.type ?? '') !== 'flag_check') continue;
    if ((flags[String(condition.flag_code ?? '')] === true) === (condition.expected === true)) return outcome;
  }
  return null;
}

function rewardNumber(rewards: Record<string, any>, keys: string[]): number {
  for (const key of keys) {
    const value = Number(rewards[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function emptyProgress(campaignId: string): Record<string, any> {
  return {
    campaignId, currentChapterNumber: 1, investigators: {}, cohesion: 0, flags: {},
    teamSpirits: { investments: {}, effectSnapshots: [] },
  };
}

export function settleProgressOnServer(opts: {
  previous: Record<string, any>;
  campaignId: string;
  chapterNumber: number;
  templateId: string;
  investigator: Record<string, any>;
  outcome: Record<string, any>;
  stageId: string;
}): { progress: Record<string, any>; status: 'active' | 'dead' } {
  const previous = Object.keys(opts.previous).length > 0 ? opts.previous : emptyProgress(opts.campaignId);
  const progress = {
    ...previous,
    campaignId: String(previous.campaignId ?? opts.campaignId),
    currentChapterNumber: Number(previous.currentChapterNumber ?? opts.chapterNumber),
    investigators: { ...objectRecord(previous.investigators) },
    flags: { ...objectRecord(previous.flags) },
    chapterResults: { ...objectRecord(previous.chapterResults) },
    cohesion: Math.max(0, Number(previous.cohesion ?? 0)),
  };
  const existingCarry = objectRecord(progress.investigators[opts.templateId]);
  const rewards = objectRecord(opts.outcome.rewards);
  const permanentlyDead = opts.investigator.permanentlyDead === true;
  if (permanentlyDead) {
    delete progress.investigators[opts.templateId];
  } else {
    progress.investigators[opts.templateId] = {
      investigatorDefinitionId: opts.templateId,
      hp: Number(opts.investigator.hp ?? existingCarry.hp ?? opts.investigator.hpMax ?? 0),
      san: Number(opts.investigator.san ?? existingCarry.san ?? opts.investigator.sanMax ?? 0),
      hpMax: Number(opts.investigator.hpMax ?? existingCarry.hpMax ?? 0),
      sanMax: Number(opts.investigator.sanMax ?? existingCarry.sanMax ?? 0),
      traumas: Array.isArray(opts.investigator.traumas) ? opts.investigator.traumas : (Array.isArray(existingCarry.traumas) ? existingCarry.traumas : []),
      deck: Array.isArray(existingCarry.deck) ? existingCarry.deck : [],
      combatStyle: String(opts.investigator.combatStyle ?? existingCarry.combatStyle ?? ''),
      specializations: Array.isArray(opts.investigator.specializations) ? opts.investigator.specializations : (Array.isArray(existingCarry.specializations) ? existingCarry.specializations : []),
      xp: Math.max(0, Number(existingCarry.xp ?? 0) + rewardNumber(rewards, ['xp', 'experience', 'exp'])),
      talentPoints: Math.max(0, Number(existingCarry.talentPoints ?? 0) + rewardNumber(rewards, ['talentPoints', 'talent_points', 'talent_point'])),
      talents: objectRecord(existingCarry.talents),
      permanentlyDead: false,
    };
  }
  for (const set of Array.isArray(opts.outcome.flag_sets) ? opts.outcome.flag_sets : []) {
    if (set?.flag_code) progress.flags[String(set.flag_code)] = set.value;
  }
  progress.cohesion = Math.max(0, Number(progress.cohesion ?? 0) + rewardNumber(rewards, ['cohesion']));
  progress.chapterResults[String(opts.chapterNumber)] = {
    chapterNumber: opts.chapterNumber, outcomeCode: String(opts.outcome.outcome_code ?? ''),
    nextChapterVersion: opts.outcome.next_chapter_version ?? null, stageId: opts.stageId, resolvedAt: new Date().toISOString(),
  };
  progress.currentChapterNumber = Number(progress.currentChapterNumber ?? opts.chapterNumber) + 1;
  progress.cohesion += 1;
  return { progress, status: permanentlyDead ? 'dead' : 'active' };
}

export interface MultiplayerSettlementPlayer {
  playerId: string;
  saveId: string;
  investigator: Record<string, any>;
}

export async function settleMultiplayerScenario(input: {
  stageId: string;
  flags: Record<string, unknown>;
  players: MultiplayerSettlementPlayer[];
}, db: { connect(): Promise<PoolClient> } = pool): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const stageRes = await client.query(
      `SELECT s.id, ch.id AS chapter_id, ch.chapter_number, ch.campaign_id
         FROM stages s JOIN chapters ch ON ch.id = s.chapter_id WHERE s.id = $1`,
      [input.stageId],
    );
    if (stageRes.rows.length === 0) throw new Error('關卡不存在');
    const stage = stageRes.rows[0];
    const outcomeRes = await client.query('SELECT * FROM chapter_outcomes WHERE chapter_id = $1 ORDER BY outcome_code', [stage.chapter_id]);
    const outcome = evaluateOutcomeRows(outcomeRes.rows, input.flags);
    if (!outcome) throw new Error('無法依旗標判定章節結局');
    for (const player of input.players) {
      const saveRes = await client.query(
        `SELECT * FROM investigator_saves WHERE id = $1 AND player_id = $2 AND status = 'active' FOR UPDATE`,
        [player.saveId, player.playerId],
      );
      if (saveRes.rows.length === 0) throw new Error('active 存檔不存在');
      const save = saveRes.rows[0];
      if (String(save.template_id) !== String(player.investigator.investigatorDefinitionId)) {
        throw new Error('調查員狀態與存檔 template 不一致');
      }
      const settled = settleProgressOnServer({
        previous: objectRecord(save.campaign_progress), campaignId: String(stage.campaign_id),
        chapterNumber: Number(stage.chapter_number ?? 1), templateId: String(save.template_id),
        investigator: player.investigator, outcome, stageId: input.stageId,
      });
      await client.query(
        `UPDATE investigator_saves SET campaign_id = $1, campaign_progress = $2::jsonb, status = $3,
           ended_at = CASE WHEN $3 = 'dead' THEN NOW() ELSE ended_at END, updated_at = NOW() WHERE id = $4`,
        [stage.campaign_id, JSON.stringify(settled.progress), settled.status, save.id],
      );
      if (settled.status === 'dead') {
        await client.query('UPDATE players SET dead_count = dead_count + 1, updated_at = NOW() WHERE id = $1', [player.playerId]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
