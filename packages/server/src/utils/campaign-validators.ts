// MOD-06 跨模組校驗 helper
// 驗證戰役／章節／間章事件中引用的代碼（旗標、怪物家族、神話卡、團隊精神）都存在

import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';

export type ValidatorResult = { valid: boolean; missing: string[] };

type Queryable = PoolClient | typeof pool;

function runner(client?: PoolClient): Queryable {
  return client ?? pool;
}

// ──────────────────────────────────────────────
// 單一代碼表的校驗（共用模式）
// ──────────────────────────────────────────────

async function validateCodes(
  tableSql: string,
  codes: string[],
  client?: PoolClient,
): Promise<ValidatorResult> {
  const unique = [...new Set(codes.filter((c) => typeof c === 'string' && c.length > 0))];
  if (unique.length === 0) return { valid: true, missing: [] };
  const q = runner(client);
  const res = await q.query<{ code: string }>(tableSql, [unique]);
  const found = new Set(res.rows.map((r) => r.code));
  const missing = unique.filter((c) => !found.has(c));
  return { valid: missing.length === 0, missing };
}

export async function validateFlagCodes(
  campaignId: string,
  flagCodes: string[],
  client?: PoolClient,
): Promise<ValidatorResult> {
  const unique = [...new Set(flagCodes.filter((c) => typeof c === 'string' && c.length > 0))];
  if (unique.length === 0) return { valid: true, missing: [] };
  const q = runner(client);
  const res = await q.query<{ flag_code: string }>(
    `SELECT flag_code FROM campaign_flags
      WHERE campaign_id = $1 AND flag_code = ANY($2)`,
    [campaignId, unique],
  );
  const found = new Set(res.rows.map((r) => r.flag_code));
  const missing = unique.filter((c) => !found.has(c));
  return { valid: missing.length === 0, missing };
}

export async function validateMonsterFamilyCodes(
  familyCodes: string[],
  client?: PoolClient,
): Promise<ValidatorResult> {
  return validateCodes(
    `SELECT code FROM monster_families WHERE code = ANY($1)`,
    familyCodes,
    client,
  );
}

export async function validateMythosCardCodes(
  cardCodes: string[],
  client?: PoolClient,
): Promise<ValidatorResult> {
  return validateCodes(
    `SELECT code FROM mythos_cards WHERE code = ANY($1)`,
    cardCodes,
    client,
  );
}

export async function validateTeamSpiritCodes(
  spiritCodes: string[],
  client?: PoolClient,
): Promise<ValidatorResult> {
  return validateCodes(
    `SELECT code FROM spirit_definitions WHERE code = ANY($1)`,
    spiritCodes,
    client,
  );
}

// ──────────────────────────────────────────────
// JSON 結構遞迴抽取 helpers
// ──────────────────────────────────────────────

/**
 * 從條件表達式 JSON 中遞迴抽取所有 flag_code 欄位。
 * 支援 type: and/or/not/flag_set/flag_not_set/flag_equals + act_progress_gte/agenda_progress_gte
 */
export function extractFlagCodesFromExpression(expr: unknown): string[] {
  if (!expr || typeof expr !== 'object') return [];
  const e = expr as Record<string, unknown>;
  const codes: string[] = [];

  if (typeof e.flag_code === 'string') codes.push(e.flag_code);

  if (Array.isArray(e.conditions)) {
    for (const c of e.conditions) codes.push(...extractFlagCodesFromExpression(c));
  }
  if (e.condition && typeof e.condition === 'object') {
    codes.push(...extractFlagCodesFromExpression(e.condition));
  }
  return codes;
}

type ReferencedCodes = {
  flags: string[];
  families: string[];
  mythos: string[];
  spirits: string[];
};

/**
 * 從間章事件 / 結果分支的 operations 陣列與 flag_sets 中抽取所有引用的代碼。
 * Operations 六類型：consume_resource / set_flag / trigger_test / give_choice / grant_reward / apply_penalty
 */
export function extractReferencedCodes(
  operations: unknown[] | null | undefined,
  flagSets?: unknown[],
): ReferencedCodes {
  const result: ReferencedCodes = { flags: [], families: [], mythos: [], spirits: [] };

  const pushFlagsFrom = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    const o = obj as Record<string, unknown>;
    if (typeof o.flag_code === 'string') result.flags.push(o.flag_code);
    if (Array.isArray(o.set_flags)) {
      for (const f of o.set_flags) {
        if (typeof f === 'string') result.flags.push(f);
        else if (f && typeof f === 'object' && typeof (f as any).flag_code === 'string') {
          result.flags.push((f as any).flag_code);
        }
      }
    }
  };

  if (Array.isArray(operations)) {
    for (const op of operations) {
      if (!op || typeof op !== 'object') continue;
      const o = op as Record<string, unknown>;
      const type = typeof o.type === 'string' ? o.type : '';
      const params = (o.params && typeof o.params === 'object')
        ? (o.params as Record<string, unknown>)
        : {};

      switch (type) {
        case 'set_flag':
          if (typeof params.flag_code === 'string') result.flags.push(params.flag_code);
          break;
        case 'trigger_test':
          pushFlagsFrom(params.on_success);
          pushFlagsFrom(params.on_fail);
          break;
        case 'give_choice':
          if (Array.isArray(params.choices)) {
            for (const c of params.choices) pushFlagsFrom(c);
          }
          break;
        case 'grant_reward':
        case 'apply_penalty':
        case 'consume_resource':
          pushFlagsFrom(params);
          break;
      }

      // 額外欄位：怪物家族 / 神話卡 / 團隊精神代碼
      if (typeof params.family_code === 'string') result.families.push(params.family_code);
      if (typeof params.mythos_code === 'string') result.mythos.push(params.mythos_code);
      if (typeof params.spirit_code === 'string') result.spirits.push(params.spirit_code);
    }
  }

  if (Array.isArray(flagSets)) {
    for (const f of flagSets) {
      if (typeof f === 'string') result.flags.push(f);
      else if (f && typeof f === 'object' && typeof (f as any).flag_code === 'string') {
        result.flags.push((f as any).flag_code);
      }
    }
  }

  result.flags = [...new Set(result.flags)];
  result.families = [...new Set(result.families)];
  result.mythos = [...new Set(result.mythos)];
  result.spirits = [...new Set(result.spirits)];
  return result;
}
