import { normalisePlayerNarrative, validatePlayerNarrative } from './narrativeStyle';

type TestFn = () => void;
const tests: Array<{ name: string; fn: TestFn }> = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected=${String(expected)}, actual=${String(actual)}`);
}

test('s06 玩家敘事驗證抓出技術縮寫與半形負號', () => {
  const violations = validatePlayerNarrative('HP -2，SAN -1，花費 1 AP，總值 14 vs DC 15');
  assertEq(violations.map((item) => item.token).join(','), 'HP,SAN,AP,DC,vs,-', '所有違例都應被辨識');
});

test('s06 玩家敘事正規化保留數字語意', () => {
  const result = normalisePlayerNarrative('HP -2，SAN -1，花費 1 AP，總值 14 vs DC 15');
  assertEq(result, '生命 −2，恐懼 −1，花費 1 行動點，總值 14 對 檢定目標 15', '玩家術語與負號應正確替換');
  assertEq(validatePlayerNarrative(result).length, 0, '正規化結果必須通過閘門');
});

test('一般敘事與卡名中的連字號不被誤改', () => {
  const result = normalisePlayerNarrative('M-12 的陰影在第 1-3 區徘徊。');
  assertEq(result, 'M-12 的陰影在第 1-3 區徘徊。', '非負數連字號不應被改寫');
});

for (const { fn } of tests) fn();
console.log(`✓ narrativeStyle: ${tests.length} passed, 0 failed`);
