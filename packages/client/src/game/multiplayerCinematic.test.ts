import type { MultiplayerIntentResolvedMessage } from '@cthulhu/shared';
import { advanceCinematic, cinematicFromResolved } from './multiplayerCinematic.js';

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected=${String(expected)}, actual=${String(actual)}`);
}

const targetedEncounter: MultiplayerIntentResolvedMessage = {
  type: 'intent_resolved', actorPlayerId: 'player-1', sequence: 4,
  result: {
    id: 'result-4', timestamp: 'now', schemaVersion: 1, source: 'server', kind: 'result', inResponseTo: 'intent-4', outcome: 'accepted',
    effects: [
      { type: 'encounter_drawn', targetId: 'inv-1', params: { name: '黑暗中的腳步聲' } },
      { type: 'roll_d20', params: { roll: 12, total: 15, dc: 13 } },
    ],
  },
  snapshot: { roomCode: 'ABCDEF', version: 4, phase: 'active', hostPlayerId: 'player-1', members: [], game: undefined },
};

const owner = cinematicFromResolved(targetedEncounter, 'inv-1');
const teammate = cinematicFromResolved(targetedEncounter, 'inv-2');
assertEq(owner?.blocksActor, true, '指定遭遇只暫停被指定的本地玩家');
assertEq(teammate?.blocksActor, false, '其他 client 的本地演出不可擋住行動');
assertEq(owner?.hasCheck, true, '檢定效果會進入三段演出');
const secondBeat = owner ? advanceCinematic(owner) : null;
const thirdBeat = secondBeat ? advanceCinematic(secondBeat) : null;
assertEq(secondBeat?.beat, 2, '第一拍可前進至檢定');
assertEq(thirdBeat?.beat, 3, '檢定可前進至結果');
assertEq(thirdBeat ? advanceCinematic(thirdBeat) : null, null, '結果拍可被本地關閉，不寫 server state');
console.log('multiplayer cinematic: 1 passed, 0 failed');
