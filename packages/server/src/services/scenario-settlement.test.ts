import { settleMultiplayerScenario } from './scenario-settlement.js';

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected=${String(expected)}, actual=${String(actual)}`);
}

const calls: Array<{ sql: string; params?: unknown[] }> = [];
const client = {
  async query(sql: string, params?: unknown[]) {
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM stages s JOIN chapters')) return { rows: [{ id: 'stage-1', chapter_id: 'chapter-1', chapter_number: 1, campaign_id: 'campaign-1' }] };
    if (sql.includes('FROM chapter_outcomes')) return { rows: [{ outcome_code: 'A', condition_expression: { type: 'flag_check', flag_code: 'victory', expected: true }, rewards: { xp: 2 }, flag_sets: [{ flag_code: 'victory', value: true }] }] };
    if (sql.includes('FROM investigator_saves')) {
      const id = String(params?.[0]);
      return { rows: [{ id, player_id: params?.[1], template_id: id === 'save-1' ? 'template-1' : 'template-2', campaign_progress: {} }] };
    }
    if (sql.includes('UPDATE investigator_saves')) return { rows: [] };
    if (sql.includes('UPDATE players')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  },
  release() {},
};

await settleMultiplayerScenario({
  stageId: 'stage-1', flags: { victory: true },
  players: [
    { playerId: 'player-1', saveId: 'save-1', investigator: { investigatorDefinitionId: 'template-1', hp: 5, hpMax: 7, san: 6, sanMax: 7, traumas: [] } },
    { playerId: 'player-2', saveId: 'save-2', investigator: { investigatorDefinitionId: 'template-2', hp: 4, hpMax: 7, san: 5, sanMax: 7, traumas: [] } },
  ],
}, { async connect() { return client as any; } });

assertEq(calls.filter((call) => call.sql.includes('UPDATE investigator_saves')).length, 2, 'one outcome writes both human saves');
assertEq(calls[calls.length - 1]?.sql, 'COMMIT', 'co-op settlement commits only after every player write');

const rollbackCalls: Array<{ sql: string; params?: unknown[] }> = [];
let lockedSaves = 0;
const rollbackClient = {
  async query(sql: string, params?: unknown[]) {
    rollbackCalls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM stages s JOIN chapters')) return { rows: [{ id: 'stage-1', chapter_id: 'chapter-1', chapter_number: 1, campaign_id: 'campaign-1' }] };
    if (sql.includes('FROM chapter_outcomes')) return { rows: [{ outcome_code: 'A', condition_expression: { type: 'flag_check', flag_code: 'victory', expected: true } }] };
    if (sql.includes('FROM investigator_saves')) {
      lockedSaves += 1;
      if (lockedSaves === 2) return { rows: [] };
      return { rows: [{ id: 'save-1', player_id: 'player-1', template_id: 'template-1', campaign_progress: {} }] };
    }
    if (sql.includes('UPDATE investigator_saves')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  },
  release() {},
};

let rejected = false;
try {
  await settleMultiplayerScenario({
    stageId: 'stage-1', flags: { victory: true },
    players: [
      { playerId: 'player-1', saveId: 'save-1', investigator: { investigatorDefinitionId: 'template-1', hp: 5, san: 6 } },
      { playerId: 'player-2', saveId: 'save-2', investigator: { investigatorDefinitionId: 'template-2', hp: 4, san: 5 } },
    ],
  }, { async connect() { return rollbackClient as any; } });
} catch {
  rejected = true;
}
assertEq(rejected, true, '任一席位失去 active 存檔時整個結算必須失敗');
assertEq(rollbackCalls.some((call) => call.sql === 'ROLLBACK'), true, '半隊寫入必須 rollback');
assertEq(rollbackCalls.some((call) => call.sql === 'COMMIT'), false, '半隊寫入不得 commit');
console.log('scenario settlement: 2 passed, 0 failed');
