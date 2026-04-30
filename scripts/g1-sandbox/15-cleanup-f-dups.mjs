// 清理 F 陣營 30 張批次的重複(同 name_zh,留 created_at 早的,刪後者)
import { adminFetch, adminGet } from './api.mjs';

const r = await adminGet('/api/cards?limit=1000');
const arr = r.data || r.cards || [];
const F = arr.filter(c => c.faction === 'F');

const myNames = ['老消防隊','空氣呼吸器','緊急復返','消防斧','無畏衝鋒','消防隊長','小鎮教堂','信念之燭','佈道之力','聖經誦讀','十字架項鍊','虔誠教徒','社區拳館','反擊本能','對峙姿勢','頭部護網','老教練','拳擊手套','野戰醫帳','野戰急救包','臨終止血','冷靜手術','燃燒自己','傷兵盟友','銅指虎','護身拳套','加重拳套','繃帶','棒球棍','鋼頭工靴'];

const byName = {};
F.forEach(c => { if (myNames.includes(c.name_zh)) (byName[c.name_zh] = byName[c.name_zh] || []).push(c); });

const toDelete = [];
for (const name of Object.keys(byName)) {
  const lst = byName[name];
  if (lst.length <= 1) continue;
  // 排序:created_at 升冪(早的在前),保留第一個
  lst.sort((a, b) => {
    const da = a.created_at ? new Date(a.created_at).getTime() : 0;
    const db = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (da !== db) return da - db;
    // fallback: code 字典序
    return (a.code || '').localeCompare(b.code || '');
  });
  for (let i = 1; i < lst.length; i++) {
    toDelete.push({ name, code: lst[i].code, id: lst[i].id });
  }
}

console.log(`找到 ${toDelete.length} 張重複待刪除`);
toDelete.forEach(x => console.log(`  ${x.name} | ${x.code} | ${x.id}`));

let ok = 0, fail = 0;
for (const d of toDelete) {
  const res = await adminFetch(`/api/cards/${d.id}`, { method: 'DELETE' });
  if (res.ok) {
    console.log(`✓ DEL ${d.name} ${d.code}`);
    ok++;
  } else {
    console.log(`✗ DEL ${d.name} ${d.code} → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    fail++;
  }
}
console.log(`\n=== 清重複完成: ${ok} 刪除 / ${fail} 失敗 ===`);
