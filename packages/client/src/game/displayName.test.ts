import { displayNameFor } from './displayName';

function assertEq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const tests: Array<{ name: string; fn: () => void }> = [
  {
    name: 'displayNameFor prefers non-empty name_zh',
    fn: () => assertEq(displayNameFor({ name_zh: '鐵證', title_zh: '巡警' }), '鐵證', 'name wins'),
  },
  {
    name: 'displayNameFor falls back to title_zh for draft investigators',
    fn: () => assertEq(displayNameFor({ name_zh: ' ', title_zh: '騙子魔術師', mbti_code: 'ENTP-4' }), '騙子魔術師', 'title fallback'),
  },
  {
    name: 'displayNameFor uses mbti_code before generic fallback',
    fn: () => assertEq(displayNameFor({ name_zh: '', title_zh: '', mbti_code: 'INFJ-2' }), 'INFJ-2', 'mbti fallback'),
  },
  {
    name: 'displayNameFor returns explicit fallback for null',
    fn: () => assertEq(displayNameFor(null, '未選擇'), '未選擇', 'null fallback'),
  },
];

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log('✓ ' + t.name);
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error('✗ ' + t.name);
    console.error(error);
  }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) throw new Error(`${failed} displayNameFor tests failed`);
