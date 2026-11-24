import { test } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { createEngine } from '../engine.js';
import { seedDemo } from '../seed.js';

const SQL = await initSqlJs();
const memStore = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => m.set(k, v), keys: async () => [...m.keys()], m }; };
let t = 1_800_000_000_000;
const clock = () => (t += 1000);
const allOps = (e) => e.ownFiles().flatMap(([, ops]) => ops);
const stockOf = (e, name) => e._db().prepare('SELECT s.qty FROM stock s JOIN products p ON p.id = s.product_id WHERE p.name = ?').get(name)?.qty;

test('две каси продават без връзка и след синхронизация имат еднакъв склад', async () => {
  const A = await createEngine({ SQL, store: memStore(), deviceId: 'aaaa-1', clock });
  const admin = (await A.request('POST', '/users', { name: 'Админ', role: 'admin', pin: '0000' }, null));
  const call = (m, p, b) => A.request(m, p, b, admin);
  await seedDemo(call);
  const storeB = memStore();
  const B = await createEngine({ SQL, store: storeB, deviceId: 'bbbb-2', clock });
  await B.merge(allOps(A));
  assert.equal(stockOf(B, 'Кроасан с масло'), 60);

  const cat = await A.request('GET', '/catalog');
  const crois = cat.products.find((p) => p.name === 'Кроасан с масло');
  const capp = cat.products.find((p) => p.name === 'Капучино');
  const user = await B.login(admin.id, '0000');
  // двете продават едновременно, без да се виждат
  const sA = await A.request('POST', '/orders/pay', { uid: 'u-a', payment: 'cash', lines: [{ product_id: crois.id, qty: 2, price: 1.9 }] }, admin);
  const sB = await B.request('POST', '/orders/pay', { uid: 'u-b', payment: 'card', lines: [{ product_id: crois.id, qty: 3, price: 1.9 }, { product_id: capp.id, qty: 1, price: 2.4 }] }, user);
  assert.match(sA.number, /^AAA-/);
  assert.match(sB.number, /^BBB-/);
  assert.equal(stockOf(A, 'Кроасан с масло'), 58);
  assert.equal(stockOf(B, 'Кроасан с масло'), 57);

  await A.merge(allOps(B));
  await B.merge(allOps(A));
  for (const e of [A, B]) {
    assert.equal(stockOf(e, 'Кроасан с масло'), 55);
    assert.equal(Math.round(stockOf(e, 'Кафе на зърна Арабика') * 1000), 5982);
    const r = await e.request('GET', '/reports/day?date=' + new Date(t).toLocaleDateString('sv-SE'));
    assert.equal(r.count, 2);
  }
  // повторното получаване не променя нищо
  assert.equal(await A.merge(allOps(B)), 0);

  // ново стартиране от същото хранилище възстановява същото състояние
  const B2 = await createEngine({ SQL, store: storeB, deviceId: 'bbbb-2', clock });
  assert.equal(stockOf(B2, 'Кроасан с масло'), 55);
  assert.equal(B2.size, B.size);
});

test('ПИН кодът не се пази в явен вид в операциите', async () => {
  const A = await createEngine({ SQL, store: memStore(), deviceId: 'cccc-3', clock });
  await A.request('POST', '/users', { name: 'Админ', role: 'admin', pin: '4321' }, null);
  const json = JSON.stringify(allOps(A));
  assert.ok(!json.includes('4321'));
  assert.ok(json.includes('pbkdf2$'));
});

test('операциите на касиер без права се отказват', async () => {
  const A = await createEngine({ SQL, store: memStore(), deviceId: 'dddd-4', clock });
  await A.request('POST', '/users', { name: 'Админ', role: 'admin', pin: '0000' }, null);
  const cashier = await A.request('POST', '/users', { name: 'Касиер', role: 'cashier', pin: '1111' }, null);
  await assert.rejects(A.request('POST', '/products', { name: 'X' }, cashier), /права/);
  assert.equal(allOps(A).length, 2);
});
