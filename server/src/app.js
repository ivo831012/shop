import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { tx } from './db.js';
import { postSale, reverseSale, postDocument, costOf, httpError, addMove } from './stock.js';
import { fiscalDriver } from './fiscal.js';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(here, '../../web/dist');

export const ROLES = ['admin', 'manager', 'cashier', 'stock'];
const VAT = { А: 0, Б: 20, В: 20, Г: 9 };
const money = (n) => Math.round(n * 100) / 100;

export function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(String(pin), salt, 32).toString('hex')}`;
}
function checkPin(pin, stored) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(String(pin), salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}
const toSqlTime = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 19) : null);

export function buildApp(db, { logger = false } = {}) {
  const app = Fastify({ logger, bodyLimit: 8 * 1024 * 1024 });
  const q = (sql) => db.prepare(sql);

  app.setErrorHandler((err, req, reply) => {
    const code = err.statusCode || 500;
    if (code >= 500) req.log.error(err);
    reply.code(code).send({ error: code >= 500 ? 'Възникна грешка на сървъра' : err.message });
  });

  // ---------- auth ----------
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/auth/')) return;
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const row = token && q(`SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
                            WHERE s.token = ? AND u.active = 1`).get(token);
    if (!row) throw httpError(401, 'Влезте отново');
    req.user = { ...row };
  });
  const need = (req, ...roles) => {
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return;
    throw httpError(403, 'Нямате права за това действие');
  };

  app.get('/api/auth/users', async () => ({
    users: q("SELECT id, name, role FROM users WHERE active = 1 ORDER BY role = 'admin', name").all(),
    company: q("SELECT value FROM settings WHERE key = 'company_name'").get()?.value,
  }));

  app.post('/api/auth/login', async (req) => {
    const { userId, pin } = req.body || {};
    const u = q('SELECT * FROM users WHERE id = ? AND active = 1').get(Number(userId));
    if (!u || !checkPin(pin, u.pin_hash)) throw httpError(401, 'Грешен ПИН код');
    const token = randomBytes(24).toString('hex');
    q('INSERT INTO sessions(token, user_id) VALUES (?, ?)').run(token, u.id);
    return { token, user: { id: u.id, name: u.name, role: u.role } };
  });

  app.post('/api/logout', async (req) => {
    q('DELETE FROM sessions WHERE token = ?').run((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    return { ok: true };
  });

  app.get('/api/me', async (req) => ({ user: req.user }));

  // ---------- settings ----------
  const readSettings = () => Object.fromEntries(q('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  app.get('/api/settings', async () => readSettings());
  app.put('/api/settings', async (req) => {
    need(req);
    const up = q('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(req.body || {})) up.run(k, String(v ?? ''));
    return readSettings();
  });

  // ---------- catalogue (cached by POS for offline use) ----------
  const productRows = (where = 'p.active = 1') =>
    q(`SELECT p.*, COALESCE(s.qty, 0) AS stock FROM products p LEFT JOIN stock s ON s.product_id = p.id
       WHERE ${where} ORDER BY p.sort, p.name`).all();
  const withComponents = (rows) => {
    const comps = q('SELECT product_id, component_id, qty FROM product_components').all();
    const by = new Map();
    for (const c of comps) (by.get(c.product_id) || by.set(c.product_id, []).get(c.product_id)).push({ id: c.component_id, qty: c.qty });
    return rows.map((p) => ({ ...p, components: by.get(p.id) || [], cost: p.type === 'goods' || p.type === 'service' ? p.cost : costOf(db, p.id) }));
  };

  app.get('/api/catalog', async () => ({
    settings: readSettings(),
    categories: q('SELECT * FROM categories WHERE active = 1 ORDER BY sort, name').all(),
    products: withComponents(productRows()),
    tables: q('SELECT * FROM tables WHERE active = 1 ORDER BY sort, name').all(),
    at: new Date().toISOString(),
  }));

  // ---------- categories ----------
  app.get('/api/categories', async () => q('SELECT * FROM categories WHERE active = 1 ORDER BY sort, name').all());
  app.post('/api/categories', async (req) => {
    need(req, 'manager');
    const { name, color = 'stone', icon = 'box', sort = 0 } = req.body || {};
    if (!name?.trim()) throw httpError(400, 'Въведете име на категорията');
    const r = q('INSERT INTO categories(name, color, icon, sort) VALUES (?,?,?,?)').run(name.trim(), color, icon, sort);
    return q('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid);
  });
  app.put('/api/categories/:id', async (req) => {
    need(req, 'manager');
    const { name, color, icon, sort } = req.body || {};
    q('UPDATE categories SET name = COALESCE(?, name), color = COALESCE(?, color), icon = COALESCE(?, icon), sort = COALESCE(?, sort) WHERE id = ?')
      .run(name ?? null, color ?? null, icon ?? null, sort ?? null, req.params.id);
    return q('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  });
  app.delete('/api/categories/:id', async (req) => {
    need(req, 'manager');
    q('UPDATE categories SET active = 0 WHERE id = ?').run(req.params.id);
    q('UPDATE products SET category_id = NULL WHERE category_id = ?').run(req.params.id);
    return { ok: true };
  });

  // ---------- products ----------
  app.get('/api/products', async () => withComponents(productRows()));

  const PRODUCT_FIELDS = ['name', 'category_id', 'type', 'unit', 'barcode', 'code', 'price', 'vat_group', 'cost', 'min_stock', 'sellable', 'on_pos', 'image', 'sort'];
  const saveProduct = (id, body) => {
    const data = {};
    for (const f of PRODUCT_FIELDS) if (body[f] !== undefined) data[f] = body[f] === '' ? null : body[f];
    if ('name' in data && !String(data.name || '').trim()) throw httpError(400, 'Въведете име на артикула');
    if ('vat_group' in data && !(data.vat_group in VAT)) throw httpError(400, 'Невалидна ДДС група');
    for (const b of ['sellable', 'on_pos']) if (b in data) data[b] = data[b] ? 1 : 0;
    if (data.barcode) {
      const dup = q('SELECT id, name FROM products WHERE barcode = ? AND active = 1 AND id != ?').get(String(data.barcode), id || 0);
      if (dup) throw httpError(409, `Баркодът вече е на „${dup.name}“`);
    }
    return tx(db, () => {
      if (!id) {
        if (!data.name) throw httpError(400, 'Въведете име на артикула');
        const keys = Object.keys(data);
        const r = q(`INSERT INTO products(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => data[k]));
        id = Number(r.lastInsertRowid);
      } else if (Object.keys(data).length) {
        const keys = Object.keys(data);
        q(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map((k) => data[k]), id);
      }
      if (Array.isArray(body.components)) {
        q('DELETE FROM product_components WHERE product_id = ?').run(id);
        const ins = q('INSERT INTO product_components(product_id, component_id, qty) VALUES (?,?,?)');
        for (const c of body.components) {
          if (Number(c.id) === id) throw httpError(400, 'Артикулът не може да съдържа себе си');
          if (Number(c.qty) > 0) ins.run(id, Number(c.id), Number(c.qty));
        }
      }
      return withComponents(productRows(`p.id = ${Number(id)}`))[0];
    });
  };
  app.post('/api/products', async (req) => { need(req, 'manager', 'stock'); return saveProduct(null, req.body || {}); });
  app.put('/api/products/:id', async (req) => { need(req, 'manager', 'stock'); return saveProduct(Number(req.params.id), req.body || {}); });
  app.delete('/api/products/:id', async (req) => {
    need(req, 'manager');
    q("UPDATE products SET active = 0, barcode = NULL, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    return { ok: true };
  });

  // ---------- users ----------
  app.get('/api/users', async (req) => {
    need(req);
    return q('SELECT id, name, role, active, created_at FROM users ORDER BY active DESC, name').all();
  });
  app.post('/api/users', async (req) => {
    need(req);
    const { name, role, pin } = req.body || {};
    if (!name?.trim()) throw httpError(400, 'Въведете име');
    if (!ROLES.includes(role)) throw httpError(400, 'Изберете роля');
    if (!/^\d{4,8}$/.test(String(pin || ''))) throw httpError(400, 'ПИН кодът трябва да е от 4 до 8 цифри');
    const r = q('INSERT INTO users(name, role, pin_hash) VALUES (?,?,?)').run(name.trim(), role, hashPin(pin));
    return q('SELECT id, name, role, active FROM users WHERE id = ?').get(r.lastInsertRowid);
  });
  app.put('/api/users/:id', async (req) => {
    need(req);
    const { name, role, pin, active } = req.body || {};
    const id = Number(req.params.id);
    if (role && !ROLES.includes(role)) throw httpError(400, 'Невалидна роля');
    if (pin && !/^\d{4,8}$/.test(String(pin))) throw httpError(400, 'ПИН кодът трябва да е от 4 до 8 цифри');
    if ((active === false || (role && role !== 'admin')) && id === req.user.id) throw httpError(400, 'Не можете да отнемете собствените си права');
    q('UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), active = COALESCE(?, active) WHERE id = ?')
      .run(name ?? null, role ?? null, active === undefined ? null : active ? 1 : 0, id);
    if (pin) q('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(pin), id);
    if (active === false) q('DELETE FROM sessions WHERE user_id = ?').run(id);
    return q('SELECT id, name, role, active FROM users WHERE id = ?').get(id);
  });

  // ---------- tables ----------
  app.get('/api/tables', async () => q('SELECT * FROM tables WHERE active = 1 ORDER BY sort, name').all());
  app.post('/api/tables', async (req) => {
    need(req, 'manager');
    const { name, zone = 'Зала' } = req.body || {};
    if (!name?.trim()) throw httpError(400, 'Въведете име на масата');
    const max = q('SELECT COALESCE(MAX(sort), 0) m FROM tables').get().m;
    const r = q('INSERT INTO tables(name, zone, sort) VALUES (?,?,?)').run(name.trim(), zone, max + 1);
    return q('SELECT * FROM tables WHERE id = ?').get(r.lastInsertRowid);
  });
  app.delete('/api/tables/:id', async (req) => {
    need(req, 'manager');
    q('UPDATE tables SET active = 0 WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // ---------- stock & documents ----------
  app.get('/api/stock', async (req) => {
    need(req, 'manager', 'stock');
    return withComponents(productRows("p.active = 1 AND p.type = 'goods'"));
  });
  app.get('/api/stock/:id/moves', async (req) => {
    need(req, 'manager', 'stock');
    return q('SELECT * FROM stock_moves WHERE product_id = ? ORDER BY id DESC LIMIT 200').all(req.params.id);
  });

  const docWithLines = (id) => {
    const d = q('SELECT d.*, u.name AS user_name FROM documents d LEFT JOIN users u ON u.id = d.user_id WHERE d.id = ?').get(id);
    if (!d) throw httpError(404, 'Няма такъв документ');
    d.lines = q(`SELECT l.*, p.name, p.unit, p.vat_group FROM document_lines l JOIN products p ON p.id = l.product_id
                 WHERE l.document_id = ? ORDER BY l.id`).all(id);
    return d;
  };
  const DOC_PREFIX = { delivery: 'Д', writeoff: 'Б', revision: 'Р' };

  app.get('/api/documents', async (req) => {
    need(req, 'manager', 'stock');
    const type = req.query.type;
    return q(`SELECT d.*, u.name AS user_name,
                (SELECT COALESCE(SUM(qty * price), 0) FROM document_lines WHERE document_id = d.id) AS total,
                (SELECT COUNT(*) FROM document_lines WHERE document_id = d.id) AS line_count
              FROM documents d LEFT JOIN users u ON u.id = d.user_id
              ${type ? 'WHERE d.type = ?' : ''} ORDER BY d.id DESC LIMIT 300`).all(...(type ? [type] : []));
  });
  app.get('/api/documents/:id', async (req) => { need(req, 'manager', 'stock'); return docWithLines(req.params.id); });

  const saveDoc = (id, body, user) => tx(db, () => {
    const { type = 'delivery', partner = null, invoice_no = null, date, note = null, lines } = body;
    if (!DOC_PREFIX[type]) throw httpError(400, 'Невалиден вид документ');
    if (id) {
      const d = q('SELECT status FROM documents WHERE id = ?').get(id);
      if (!d) throw httpError(404, 'Няма такъв документ');
      if (d.status === 'posted') throw httpError(409, 'Заприходен документ не може да се променя');
      q('UPDATE documents SET partner = ?, invoice_no = ?, date = COALESCE(?, date), note = ? WHERE id = ?').run(partner, invoice_no, date ?? null, note, id);
    } else {
      const n = q('SELECT COUNT(*) c FROM documents WHERE type = ?').get(type).c + 1;
      const number = `${DOC_PREFIX[type]}-${String(n).padStart(6, '0')}`;
      id = Number(q('INSERT INTO documents(type, number, partner, invoice_no, date, note, user_id) VALUES (?,?,?,?,?,?,?)')
        .run(type, number, partner, invoice_no, date || new Date().toISOString().slice(0, 10), note, user.id).lastInsertRowid);
    }
    if (Array.isArray(lines)) {
      q('DELETE FROM document_lines WHERE document_id = ?').run(id);
      const ins = q('INSERT INTO document_lines(document_id, product_id, qty, price) VALUES (?,?,?,?)');
      for (const l of lines) if (Number(l.qty) || type === 'revision') ins.run(id, Number(l.product_id), Number(l.qty) || 0, Number(l.price) || 0);
    }
    return docWithLines(id);
  });
  app.post('/api/documents', async (req) => { need(req, 'manager', 'stock'); return saveDoc(null, req.body || {}, req.user); });
  app.put('/api/documents/:id', async (req) => { need(req, 'manager', 'stock'); return saveDoc(Number(req.params.id), req.body || {}, req.user); });
  app.post('/api/documents/:id/post', async (req) => {
    need(req, 'manager', 'stock');
    tx(db, () => postDocument(db, Number(req.params.id)));
    return docWithLines(req.params.id);
  });
  app.delete('/api/documents/:id', async (req) => {
    need(req, 'manager', 'stock');
    const d = q('SELECT status FROM documents WHERE id = ?').get(req.params.id);
    if (d?.status === 'posted') throw httpError(409, 'Заприходен документ не може да се изтрие');
    q('DELETE FROM documents WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // ---------- orders ----------
  const orderWithLines = (where, ...args) => {
    const orders = q(`SELECT o.*, t.name AS table_name, u.name AS user_name FROM orders o
                      LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN users u ON u.id = o.user_id
                      WHERE ${where} ORDER BY o.id DESC LIMIT 500`).all(...args);
    const lq = q('SELECT product_id, name, qty, price, vat_group FROM order_lines WHERE order_id = ? ORDER BY id');
    return orders.map((o) => ({ ...o, lines: lq.all(o.id) }));
  };

  /** Записва поръчка по uid (създава или подменя редовете). Цените идват от клиента, за да работи офлайн. */
  const upsertOrder = (body, user) => {
    const { uid, kind = 'here', table_id = null, lines = [], note = null } = body;
    if (!uid) throw httpError(400, 'Липсва идентификатор на поръчката');
    if (!['here', 'takeaway', 'delivery'].includes(kind)) throw httpError(400, 'Невалиден вид поръчка');
    let o = q('SELECT * FROM orders WHERE uid = ?').get(uid);
    if (o && o.status !== 'open') return { order: o, done: true };
    if (!o) {
      const number = q('SELECT COALESCE(MAX(number), 0) + 1 n FROM orders').get().n;
      const id = q('INSERT INTO orders(uid, number, status, kind, table_id, user_id, note) VALUES (?,?,?,?,?,?,?)')
        .run(uid, number, 'open', kind, table_id, user.id, note).lastInsertRowid;
      o = q('SELECT * FROM orders WHERE id = ?').get(id);
    } else {
      q('UPDATE orders SET kind = ?, table_id = ?, note = ? WHERE id = ?').run(kind, table_id, note, o.id);
    }
    q('DELETE FROM order_lines WHERE order_id = ?').run(o.id);
    const ins = q('INSERT INTO order_lines(order_id, product_id, name, qty, price, vat_group) VALUES (?,?,?,?,?,?)');
    let total = 0;
    for (const l of lines) {
      const p = q('SELECT id, name, price, vat_group FROM products WHERE id = ?').get(Number(l.product_id));
      if (!p) throw httpError(400, 'Поръчката съдържа несъществуващ артикул');
      const qty = Number(l.qty);
      if (!(qty > 0)) continue;
      const price = l.price != null ? Number(l.price) : p.price;
      ins.run(o.id, p.id, l.name || p.name, qty, price, l.vat_group || p.vat_group);
      total += qty * price;
    }
    q('UPDATE orders SET total = ? WHERE id = ?').run(money(total), o.id);
    return { order: q('SELECT * FROM orders WHERE id = ?').get(o.id), done: false };
  };

  app.get('/api/orders/open', async () => orderWithLines("o.status = 'open'"));
  app.get('/api/orders', async (req) => {
    need(req, 'manager');
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    return orderWithLines("o.status != 'open' AND date(o.closed_at, 'localtime') = ?", date);
  });

  app.post('/api/orders', async (req) => {
    const { order } = tx(db, () => upsertOrder(req.body || {}, req.user));
    return orderWithLines('o.id = ?', order.id)[0];
  });

  const payOrder = async (body, user) => {
    const { payment, tendered = null, closed_at } = body;
    if (!['cash', 'card'].includes(payment)) throw httpError(400, 'Изберете начин на плащане');
    const res = tx(db, () => {
      const { order, done } = upsertOrder(body, user);
      if (done) return { id: order.id, already: true };
      const count = q('SELECT COUNT(*) c FROM order_lines WHERE order_id = ?').get(order.id).c;
      if (!count) throw httpError(400, 'Поръчката е празна');
      q("UPDATE orders SET status = 'paid', payment = ?, tendered = ?, closed_at = COALESCE(?, datetime('now')) WHERE id = ?")
        .run(payment, tendered, toSqlTime(closed_at), order.id);
      postSale(db, order.id);
      return { id: order.id, already: false };
    });
    const full = orderWithLines('o.id = ?', res.id)[0];
    if (!res.already) {
      const settings = readSettings();
      const fr = await fiscalDriver(settings.fiscal_driver).printReceipt(full, settings);
      if (fr?.ref) q('UPDATE orders SET fiscal_ref = ? WHERE id = ?').run(fr.ref, res.id);
      full.fiscal_ref = fr?.ref;
    }
    return full;
  };

  app.post('/api/orders/pay', async (req) => payOrder(req.body || {}, req.user));

  // Офлайн продажби: касата ги трупа локално и ги изпраща накуп. Повторно изпращане е безопасно (uid).
  app.post('/api/orders/sync', async (req) => {
    const results = [];
    for (const s of req.body?.sales || []) {
      try {
        const o = await payOrder(s, req.user);
        results.push({ uid: s.uid, ok: true, number: o.number });
      } catch (e) {
        results.push({ uid: s.uid, ok: false, error: e.message });
      }
    }
    return { results };
  });

  app.post('/api/orders/:uid/void', async (req) => {
    const o = q('SELECT * FROM orders WHERE uid = ?').get(req.params.uid);
    if (!o) throw httpError(404, 'Няма такава поръчка');
    if (o.status === 'paid') need(req, 'manager');
    if (o.status === 'void') return { ok: true };
    tx(db, () => {
      if (o.status === 'paid') reverseSale(db, o.id);
      q("UPDATE orders SET status = 'void', closed_at = COALESCE(closed_at, datetime('now')) WHERE id = ?").run(o.id);
    });
    return { ok: true };
  });

  // ---------- reports ----------
  app.get('/api/reports/day', async (req) => {
    need(req, 'manager');
    const date = req.query.date || new Date().toLocaleDateString('sv-SE');
    const W = "o.status = 'paid' AND date(o.closed_at, 'localtime') = ?";
    const sum = q(`SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total,
                     COALESCE(SUM(CASE WHEN payment = 'cash' THEN total END), 0) AS cash,
                     COALESCE(SUM(CASE WHEN payment = 'card' THEN total END), 0) AS card
                   FROM orders o WHERE ${W}`).get(date);
    const byHour = q(`SELECT CAST(strftime('%H', o.closed_at, 'localtime') AS INTEGER) AS hour, SUM(total) AS total, COUNT(*) AS count
                      FROM orders o WHERE ${W} GROUP BY hour ORDER BY hour`).all(date);
    const top = q(`SELECT l.product_id, l.name, SUM(l.qty) AS qty, SUM(l.qty * l.price) AS total
                   FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE ${W}
                   GROUP BY l.product_id ORDER BY total DESC LIMIT 10`).all(date);
    const byUser = q(`SELECT u.name, COUNT(*) AS count, SUM(o.total) AS total FROM orders o JOIN users u ON u.id = o.user_id
                      WHERE ${W} GROUP BY u.id ORDER BY total DESC`).all(date);
    const vat = q(`SELECT l.vat_group, SUM(l.qty * l.price) AS total FROM order_lines l JOIN orders o ON o.id = l.order_id
                   WHERE ${W} GROUP BY l.vat_group`).all(date)
      .map((r) => ({ ...r, vat: money((r.total * VAT[r.vat_group]) / (100 + VAT[r.vat_group])) }));
    const cost = q(`SELECT l.product_id, SUM(l.qty) AS qty FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE ${W} GROUP BY l.product_id`)
      .all(date).reduce((s, r) => s + r.qty * costOf(db, r.product_id), 0);
    const low = q(`SELECT COUNT(*) c FROM products p LEFT JOIN stock s ON s.product_id = p.id
                   WHERE p.active = 1 AND p.type = 'goods' AND p.min_stock > 0 AND COALESCE(s.qty, 0) < p.min_stock`).get().c;
    const open = q("SELECT COUNT(*) c, COALESCE(SUM(total), 0) t FROM orders WHERE status = 'open'").get();
    return { date, ...sum, cost: money(cost), byHour, top, byUser, vat, lowStock: low, openOrders: open.c, openTotal: open.t };
  });

  // ---------- web app ----------
  if (existsSync(WEB_DIST)) {
    app.register(fastifyStatic, { root: WEB_DIST });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0];
      if (path.startsWith('/api/') || /\.[a-z0-9]+$/i.test(path)) return reply.code(404).send({ error: 'Няма такъв адрес' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}

export { addMove };
