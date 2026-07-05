import { clearSelectedSave, getSelectedSave, setSelectedSave } from './selectedSave';

type TestFn = () => void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void { tests.push({ name, fn }); }
function assertEq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected=${String(expected)}, actual=${String(actual)}`);
}

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  },
  configurable: true,
});

test('selected save persists active save identity', () => {
  clearSelectedSave();
  assertEq(getSelectedSave(), null, 'empty starts null');
  setSelectedSave({ id: 'save-1', slot: 2, template_id: 'template-1', campaign_id: 'campaign-1' });
  const save = getSelectedSave();
  assertEq(save?.id, 'save-1', 'id persisted');
  assertEq(save?.slot, 2, 'slot persisted');
  assertEq(save?.template_id, 'template-1', 'template id persisted');
  clearSelectedSave();
  assertEq(getSelectedSave(), null, 'clear removes selected save');
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log('PASS', t.name);
  } catch (e) {
    failed++;
    console.error('FAIL', t.name, e);
  }
}
if (failed > 0) throw new Error(`${failed} selectedSave tests failed`);
