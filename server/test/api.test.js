import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildApp, directCaller } from '../src/app.js';

async function setup() {
  const db = openDb(':memory:');
  const direct = directCaller(db);
  const ids = [(await direct('POST', '/users', { name: 'Админ', role: 'admin', pin: '0000' })).id,
    (await direct('POST', '/users', { name: 'Касиер', role: 'cashier', pin: '1111' })).id];
  const app = buildApp(db);
  const login = async (userId, pin) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { userId, pin } })).json().token;
  const admin = await login(ids[0], '0000');
  const call = (method, url, payload, token = admin) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } }).then((r) => ({ status: r.statusCode, body: r.json() }));
  return { app, db, call, login, ids };
}

test('грешен ПИН се отказва', async () => {
  const { app, ids } = await setup();
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { userId: ids[0], pin: '9999' } });
  assert.equal(r.statusCode, 401);
});

test('продажба по рецепта изписва суровините, комбо разгъва рекурсивно', async () => {
  const { call } = await setup();
  const beans = (await call('POST', '/api/products', { name: 'Зърна', unit: 'кг', sellable: 0 })).body;
  const milk = (await call('POST', '/api/products', { name: 'Мляко', unit: 'л', sellable: 0 })).body;
  const crois = (await call('POST', '/api/products', { name: 'Кроасан', price: 1.9, barcode: '111' })).body;
  const capp = (await call('POST', '/api/products', { name: 'Капучино', type: 'recipe', price: 2.4,
    components: [{ id: beans.id, qty: 0.018 }, { id: milk.id, qty: 0.15 }] })).body;
  const combo = (await call('POST', '/api/products', { name: 'Комбо', type: 'combo', price: 4,
    components: [{ id: capp.id, qty: 1 }, { id: crois.id, qty: 1 }] })).body;

  const doc = (await call('POST', '/api/documents', { type: 'delivery', partner: 'Доставчик',
    lines: [{ product_id: beans.id, qty: 1, price: 20 }, { product_id: milk.id, qty: 10, price: 1 }, { product_id: crois.id, qty: 10, price: 0.5 }] })).body;
  assert.equal((await call('POST', `/api/documents/${doc.id}/post`)).status, 200);
  assert.equal((await call('POST', `/api/documents/${doc.id}/post`)).status, 409);

  const sale = await call('POST', '/api/orders/pay', { uid: 'u1', payment: 'cash', tendered: 20,
    lines: [{ product_id: capp.id, qty: 2 }, { product_id: combo.id, qty: 1 }] });
  assert.equal(sale.status, 200);
  assert.equal(sale.body.total, 8.8);

  const stock = Object.fromEntries((await call('GET', '/api/stock')).body.map((p) => [p.name, p.stock]));
  assert.equal(stock['Зърна'], 1 - 0.054);
  assert.equal(stock['Мляко'], 10 - 0.45);
  assert.equal(stock['Кроасан'], 9);

  // повторно изпращане на същата продажба (офлайн синхронизация) не изписва втори път
  await call('POST', '/api/orders/sync', { sales: [{ uid: 'u1', payment: 'cash', lines: [{ product_id: capp.id, qty: 2 }] }] });
  const again = Object.fromEntries((await call('GET', '/api/stock')).body.map((p) => [p.name, p.stock]));
  assert.equal(again['Кроасан'], 9);

  // сторно връща наличностите
  await call('POST', '/api/orders/u1/void');
  const back = Object.fromEntries((await call('GET', '/api/stock')).body.map((p) => [p.name, p.stock]));
  assert.equal(back['Кроасан'], 10);
  assert.equal(back['Зърна'], 1);
});

test('касиер не може да променя артикули и да сторнира', async () => {
  const { call, login, ids } = await setup();
  const cashier = await login(ids[1], '1111');
  assert.equal((await call('POST', '/api/products', { name: 'X' }, cashier)).status, 403);
  const p = (await call('POST', '/api/products', { name: 'Вода', price: 1 })).body;
  await call('POST', '/api/orders/pay', { uid: 'z', payment: 'card', lines: [{ product_id: p.id, qty: 1 }] }, cashier);
  assert.equal((await call('POST', '/api/orders/z/void', null, cashier)).status, 403);
});

test('дублиран баркод се отказва', async () => {
  const { call } = await setup();
  await call('POST', '/api/products', { name: 'А', barcode: '123' });
  const r = await call('POST', '/api/products', { name: 'Б', barcode: '123' });
  assert.equal(r.status, 409);
});

test('отворена сметка по маса и дневен отчет', async () => {
  const { call } = await setup();
  const p = (await call('POST', '/api/products', { name: 'Бира', price: 3 })).body;
  const t = (await call('POST', '/api/tables', { name: 'Маса 1' })).body;
  await call('POST', '/api/orders', { uid: 'o1', table_id: t.id, lines: [{ product_id: p.id, qty: 2 }] });
  const open = (await call('GET', '/api/orders/open')).body;
  assert.equal(open.length, 1);
  assert.equal(open[0].table_name, 'Маса 1');
  await call('POST', '/api/orders/pay', { uid: 'o1', table_id: t.id, payment: 'card', lines: [{ product_id: p.id, qty: 3 }] });
  const rep = (await call('GET', '/api/reports/day')).body;
  assert.equal(rep.total, 9);
  assert.equal(rep.card, 9);
  assert.equal(rep.openOrders, 0);
});
