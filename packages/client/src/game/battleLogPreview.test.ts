import { latestActionRows } from './battleLogPreview';

function assertEq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const rows = latestActionRows(
  [
    { id: 'p1', name: '騙子魔術師', label: '玩家' },
    { id: 'a1', name: '黑色詩人', label: 'AI' },
    { id: 'a2', name: '林業勞工', label: 'AI' },
    { id: 'a3', name: '法醫', label: 'AI' },
  ],
  [
    '[騙子魔術師] 調查',
    '  └ 獲得 1 線索',
    '[黑色詩人] 移動到磚牆盡頭',
    '[騙子魔術師] 攻擊',
  ],
);

assertEq(rows[0].line, '攻擊', 'player latest line');
assertEq(rows[1].line, '移動到磚牆盡頭', 'ai latest line');
assertEq(rows[2].line, '等待', 'missing actor waits');
assertEq(rows[2].waiting, true, 'waiting flag');
assertEq(rows.length, 4, 'collapsed summary keeps player plus three companions');
assertEq(rows[3].name, '法醫', 'fourth investigator is not clipped from data');

console.log('✓ latestActionRows returns one current row per investigator');
console.log('\n1 passed, 0 failed');
