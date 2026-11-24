// Цялата бизнес логика на приложението като функции върху базата.
// Ползва се от сървъра (Fastify) и от устройствата (sql.js в браузъра).
// Всяка промяна е детерминирана: получава `now` и идентификаторите отвън,
// за да може устройствата да я повторят и да стигнат до същото състояние.
import { tx } from './schema.js';
import { postSale, reverseSale, postDocument, costOf, httpError } from './stock.js';

export const ROLES = ['admin', 'manager', 'cashier', 'stock'];
export const VAT = { А: 0, Б: 20, В: 20, Г: 9 };
const money = (n) => Math.round(n * 100) / 100;
const DOC_PREFIX = { delivery: 'Д', writeoff: 'Б', revision: 'Р' };
const PRODUCT_FIELDS = ['name', 'category_id', 'type', 'unit', 'barcode', 'code', 'price', 'vat_group', 'min_stock', 'sellable', 'on_pos', 'image', 'sort'];

export const sqlNow = (d = new Date()) => new Date(d).toISOString().replace('T', ' ').slice(0, 19);
export const localDate = () => new Date().toLocaleDateString('sv-SE');

export function createCore(db) {
  const q = (sql) => db.prepare(sql);
  const routes = [];
  const on = (method, pattern, fn) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, fn });
  };
  const need = (c, ...roles) => {
    if (c.replay || c.user?.role === 'admin' || roles.includes(c.user?.role)) return;
    throw httpError(403, 'Нямате права за това действие');
  };

  // ---------- общи заявки ----------
  const readSettings = () => Object.fromEntries(q('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  const productRows = (where = 'p.active = 1', args = []) =>
    q(`SELECT p.*, COALESCE(s.qty, 0) AS stock FROM products p LEFT JOIN stock s ON s.product_id = p.id
       WHERE ${where} ORDER BY p.sort, p.name`).all(...args);
  const withComponents = (rows) => {
    const by = new Map();
    for (const c of q('SELECT product_id, component_id, qty FROM product_components').all()) {
      if (!by.has(c.product_id)) by.set(c.product_id, []);
      by.get(c.product_id).push({ id: c.component_id, qty: c.qty });
    }
    return rows.map((p) => ({ ...p, components: by.get(p.id) || [], cost: p.type === 'goods' || p.type === 'service' ? p.cost : costOf(db, p.id) }));
  };
  const product = (id) => withComponents(productRows('p.id = ?', [id]))[0];

  // ---------- потребители ----------
  on('GET', '/auth/users', () => ({
    users: q("SELECT id, name, role FROM users WHERE active = 1 ORDER BY role = 'admin', name").all(),
    company: readSettings().company_name,
  }));
  on('GET', '/users', (c) => { need(c); return q('SELECT id, name, role, active, created_at FROM users ORDER BY active DESC, name').all(); });
  on('POST', '/users', (c) => {
    need(c);
    const { id, name, role, pin_hash } = c.body;
    if (!name?.trim()) throw httpError(400, 'Въведете име');
    if (!ROLES.includes(role)) throw httpError(400, 'Изберете роля');
    if (!pin_hash) throw httpError(400, 'Въведете ПИН код');
    const uid = id || c.newId();
    q('INSERT INTO users(id, name, role, pin_hash, created_at) VALUES (?,?,?,?,?)').run(uid, name.trim(), role, pin_hash, c.now);
    return q('SELECT id, name, role, active FROM users WHERE id = ?').get(uid);
  });
  on('PUT', '/users/:id', (c) => {
    need(c);
    const { name, role, pin_hash, active } = c.body;
    const id = c.params.id;
    if (role && !ROLES.includes(role)) throw httpError(400, 'Невалидна роля');
    if (!c.replay && (active === false || active === 0 || (role && role !== 'admin')) && id === c.user.id) throw httpError(400, 'Не можете да отнемете собствените си права');
    q('UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), active = COALESCE(?, active) WHERE id = ?')
      .run(name ?? null, role ?? null, active === undefined ? null : active ? 1 : 0, id);
    if (pin_hash) q('UPDATE users SET pin_hash = ? WHERE id = ?').run(pin_hash, id);
    return q('SELECT id, name, role, active FROM users WHERE id = ?').get(id);
  });

  // ---------- настройки и каталог ----------
  on('GET', '/settings', () => readSettings());
  on('PUT', '/settings', (c) => {
    need(c);
    const up = q('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(c.body)) up.run(k, String(v ?? ''));
    return readSettings();
  });
  on('GET', '/catalog', () => ({
    settings: readSettings(),
    categories: q('SELECT * FROM categories WHERE active = 1 ORDER BY sort, name').all(),
    products: withComponents(productRows()),
    tables: q('SELECT * FROM tables WHERE active = 1 ORDER BY sort, name').all(),
  }));

  // ---------- категории ----------
  on('GET', '/categories', () => q('SELECT * FROM categories WHERE active = 1 ORDER BY sort, name').all());
  on('POST', '/categories', (c) => {
    need(c, 'manager');
    const { id, name, color = 'stone', icon = 'box', sort = 0 } = c.body;
    if (!name?.trim()) throw httpError(400, 'Въведете име на категорията');
    const cid = id || c.newId();
    q('INSERT INTO categories(id, name, color, icon, sort) VALUES (?,?,?,?,?)').run(cid, name.trim(), color, icon, sort);
    return q('SELECT * FROM categories WHERE id = ?').get(cid);
  });
  on('PUT', '/categories/:id', (c) => {
    need(c, 'manager');
    const { name, color, icon, sort } = c.body;
    q('UPDATE categories SET name = COALESCE(?, name), color = COALESCE(?, color), icon = COALESCE(?, icon), sort = COALESCE(?, sort) WHERE id = ?')
      .run(name ?? null, color ?? null, icon ?? null, sort ?? null, c.params.id);
    return q('SELECT * FROM categories WHERE id = ?').get(c.params.id);
  });
  on('DELETE', '/categories/:id', (c) => {
    need(c, 'manager');
    q('UPDATE categories SET active = 0 WHERE id = ?').run(c.params.id);
    q('UPDATE products SET category_id = NULL WHERE category_id = ?').run(c.params.id);
    return { ok: true };
  });

  // ---------- артикули ----------
  on('GET', '/products', () => withComponents(productRows()));
  const saveProduct = (c, id) => {
    need(c, 'manager', 'stock');
    const body = c.body;
    const data = {};
    for (const f of PRODUCT_FIELDS) if (body[f] !== undefined) data[f] = body[f] === '' ? null : body[f];
    if ('name' in data && !String(data.name || '').trim()) throw httpError(400, 'Въведете име на артикула');
    if ('vat_group' in data && !(data.vat_group in VAT)) throw httpError(400, 'Невалидна ДДС група');
    for (const b of ['sellable', 'on_pos']) if (b in data) data[b] = data[b] ? 1 : 0;
    if (data.barcode != null) data.barcode = String(data.barcode);
    if (data.barcode && !c.replay) {
      const dup = q('SELECT name FROM products WHERE barcode = ? AND active = 1 AND id != ?').get(data.barcode, id || '');
      if (dup) throw httpError(409, `Баркодът вече е на „${dup.name}“`);
    }
    return tx(db, () => {
      if (!id) {
        if (!data.name) throw httpError(400, 'Въведете име на артикула');
        id = body.id || c.newId();
        data.id = id;
        data.updated_at = c.now;
        const keys = Object.keys(data);
        q(`INSERT INTO products(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => data[k]));
      } else {
        if (!q('SELECT id FROM products WHERE id = ?').get(id)) throw httpError(404, 'Няма такъв артикул');
        const keys = Object.keys(data);
        if (keys.length) q(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => data[k]), c.now, id);
      }
      if (Array.isArray(body.components)) {
        q('DELETE FROM product_components WHERE product_id = ?').run(id);
        const ins = q('INSERT OR REPLACE INTO product_components(product_id, component_id, qty) VALUES (?,?,?)');
        for (const comp of body.components) {
          if (comp.id === id) throw httpError(400, 'Артикулът не може да съдържа себе си');
          if (Number(comp.qty) > 0 && q('SELECT id FROM products WHERE id = ?').get(comp.id)) ins.run(id, comp.id, Number(comp.qty));
        }
      }
      return product(id);
    });
  };
  on('POST', '/products', (c) => saveProduct(c, null));
  on('PUT', '/products/:id', (c) => saveProduct(c, c.params.id));
  on('DELETE', '/products/:id', (c) => {
    need(c, 'manager');
    q('UPDATE products SET active = 0, barcode = NULL, updated_at = ? WHERE id = ?').run(c.now, c.params.id);
    return { ok: true };
  });

  // ---------- маси ----------
  on('GET', '/tables', () => q('SELECT * FROM tables WHERE active = 1 ORDER BY sort, name').all());
  on('POST', '/tables', (c) => {
    need(c, 'manager');
    const { id, name, zone = 'Зала' } = c.body;
    if (!name?.trim()) throw httpError(400, 'Въведете име на масата');
    const tid = id || c.newId();
    const max = q('SELECT COALESCE(MAX(sort), 0) m FROM tables').get().m;
    q('INSERT INTO tables(id, name, zone, sort) VALUES (?,?,?,?)').run(tid, name.trim(), zone, max + 1);
    return q('SELECT * FROM tables WHERE id = ?').get(tid);
  });
  on('DELETE', '/tables/:id', (c) => {
    need(c, 'manager');
    q('UPDATE tables SET active = 0 WHERE id = ?').run(c.params.id);
    return { ok: true };
  });

  // ---------- склад и документи ----------
  on('GET', '/stock', (c) => { need(c, 'manager', 'stock'); return withComponents(productRows("p.active = 1 AND p.type = 'goods'")); });
  on('GET', '/stock/:id/moves', (c) => {
    need(c, 'manager', 'stock');
    return q('SELECT * FROM stock_moves WHERE product_id = ? ORDER BY id DESC LIMIT 200').all(c.params.id);
  });

  const docWithLines = (id) => {
    const d = q('SELECT d.*, u.name AS user_name FROM documents d LEFT JOIN users u ON u.id = d.user_id WHERE d.id = ?').get(id);
    if (!d) throw httpError(404, 'Няма такъв документ');
    d.lines = q(`SELECT l.*, p.name, p.unit, p.vat_group FROM document_lines l JOIN products p ON p.id = l.product_id
                 WHERE l.document_id = ? ORDER BY l.id`).all(id);
    return d;
  };
  on('GET', '/documents', (c) => {
    need(c, 'manager', 'stock');
    const type = c.query.type;
    return q(`SELECT d.*, u.name AS user_name,
                (SELECT COALESCE(SUM(qty * price), 0) FROM document_lines WHERE document_id = d.id) AS total,
                (SELECT COUNT(*) FROM document_lines WHERE document_id = d.id) AS line_count
              FROM documents d LEFT JOIN users u ON u.id = d.user_id
              ${type ? 'WHERE d.type = ?' : ''} ORDER BY d.created_at DESC LIMIT 300`).all(...(type ? [type] : []));
  });
  on('GET', '/documents/:id', (c) => { need(c, 'manager', 'stock'); return docWithLines(c.params.id); });
  const saveDoc = (c, id) => tx(db, () => {
    need(c, 'manager', 'stock');
    const { type = 'delivery', partner = null, invoice_no = null, date, note = null, lines } = c.body;
    if (!DOC_PREFIX[type]) throw httpError(400, 'Невалиден вид документ');
    if (id) {
      const d = q('SELECT status FROM documents WHERE id = ?').get(id);
      if (!d) throw httpError(404, 'Няма такъв документ');
      if (d.status === 'posted') throw httpError(409, 'Заприходен документ не може да се променя');
      q('UPDATE documents SET partner = ?, invoice_no = ?, date = COALESCE(?, date), note = ? WHERE id = ?').run(partner, invoice_no, date ?? null, note, id);
    } else {
      id = c.body.id || c.newId();
      const number = c.body.number || `${DOC_PREFIX[type]}-${String(q('SELECT COUNT(*) n FROM documents WHERE type = ?').get(type).n + 1).padStart(6, '0')}`;
      q('INSERT INTO documents(id, type, number, partner, invoice_no, date, note, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, type, number, partner, invoice_no, date || c.now.slice(0, 10), note, c.user?.id ?? null, c.now);
    }
    if (Array.isArray(lines)) {
      q('DELETE FROM document_lines WHERE document_id = ?').run(id);
      const ins = q('INSERT INTO document_lines(document_id, product_id, qty, price) VALUES (?,?,?,?)');
      for (const l of lines) {
        if (!q('SELECT id FROM products WHERE id = ?').get(l.product_id)) continue;
        if (Number(l.qty) || type === 'revision') ins.run(id, l.product_id, Number(l.qty) || 0, Number(l.price) || 0);
      }
    }
    return docWithLines(id);
  });
  on('POST', '/documents', (c) => saveDoc(c, null));
  on('PUT', '/documents/:id', (c) => saveDoc(c, c.params.id));
  on('POST', '/documents/:id/post', (c) => {
    need(c, 'manager', 'stock');
    tx(db, () => postDocument(db, c.now, c.params.id));
    return docWithLines(c.params.id);
  });
  on('DELETE', '/documents/:id', (c) => {
    need(c, 'manager', 'stock');
    const d = q('SELECT status FROM documents WHERE id = ?').get(c.params.id);
    if (d?.status === 'posted') throw httpError(409, 'Заприходен документ не може да се изтрие');
    q('DELETE FROM documents WHERE id = ?').run(c.params.id);
    return { ok: true };
  });

  // ---------- поръчки ----------
  const orders = (where, ...args) => {
    const list = q(`SELECT o.*, o.id AS uid, t.name AS table_name, u.name AS user_name FROM orders o
                    LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN users u ON u.id = o.user_id
                    WHERE ${where} ORDER BY o.opened_at DESC LIMIT 500`).all(...args);
    const lq = q('SELECT product_id, name, qty, price, vat_group FROM order_lines WHERE order_id = ? ORDER BY id');
    return list.map((o) => ({ ...o, lines: lq.all(o.id) }));
  };
  /** Записва поръчка по uid. Цените идват от устройството, за да работи без връзка. */
  const upsertOrder = (c) => {
    const { uid, kind = 'here', table_id = null, lines = [], note = null } = c.body;
    if (!uid) throw httpError(400, 'Липсва идентификатор на поръчката');
    if (!['here', 'takeaway', 'delivery'].includes(kind)) throw httpError(400, 'Невалиден вид поръчка');
    let o = q('SELECT * FROM orders WHERE id = ?').get(uid);
    if (o && o.status !== 'open') return { order: o, done: true };
    const tableId = table_id && q('SELECT id FROM tables WHERE id = ?').get(table_id) ? table_id : null;
    if (!o) {
      const number = c.body.number || String(q('SELECT COUNT(*) n FROM orders').get().n + 1);
      q('INSERT INTO orders(id, number, status, kind, table_id, user_id, note, opened_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(uid, number, 'open', kind, tableId, c.user?.id ?? null, note, c.body.opened_at || c.now);
    } else {
      q('UPDATE orders SET kind = ?, table_id = ?, note = ? WHERE id = ?').run(kind, tableId, note, uid);
    }
    q('DELETE FROM order_lines WHERE order_id = ?').run(uid);
    const ins = q('INSERT INTO order_lines(order_id, product_id, name, qty, price, vat_group) VALUES (?,?,?,?,?,?)');
    let total = 0;
    for (const l of lines) {
      const p = q('SELECT id, name, price, vat_group FROM products WHERE id = ?').get(l.product_id);
      if (!p) { if (c.replay) continue; throw httpError(400, 'Поръчката съдържа несъществуващ артикул'); }
      const qty = Number(l.qty);
      if (!(qty > 0)) continue;
      const price = l.price != null ? Number(l.price) : p.price;
      ins.run(uid, p.id, l.name || p.name, qty, price, l.vat_group || p.vat_group);
      total += qty * price;
    }
    q('UPDATE orders SET total = ? WHERE id = ?').run(money(total), uid);
    return { order: q('SELECT * FROM orders WHERE id = ?').get(uid), done: false };
  };

  on('GET', '/orders/open', () => orders("o.status = 'open'"));
  on('GET', '/orders', (c) => {
    need(c, 'manager');
    return orders("o.status != 'open' AND date(o.closed_at, 'localtime') = ?", c.query.date || localDate());
  });
  on('POST', '/orders', (c) => {
    const { order } = tx(db, () => upsertOrder(c));
    return orders('o.id = ?', order.id)[0];
  });
  on('POST', '/orders/pay', (c) => {
    const { payment, tendered = null, closed_at } = c.body;
    if (!['cash', 'card'].includes(payment)) throw httpError(400, 'Изберете начин на плащане');
    const res = tx(db, () => {
      const { order, done } = upsertOrder(c);
      if (done) return { id: order.id, already: true };
      if (!q('SELECT COUNT(*) n FROM order_lines WHERE order_id = ?').get(order.id).n) throw httpError(400, 'Поръчката е празна');
      q("UPDATE orders SET status = 'paid', payment = ?, tendered = ?, closed_at = ? WHERE id = ?")
        .run(payment, tendered, closed_at ? sqlNow(closed_at) : c.now, order.id);
      postSale(db, c.now, order.id);
      return { id: order.id, already: false };
    });
    return { ...orders('o.id = ?', res.id)[0], already: res.already };
  });
  on('POST', '/orders/:uid/void', (c) => {
    const o = q('SELECT * FROM orders WHERE id = ?').get(c.params.uid);
    if (!o) throw httpError(404, 'Няма такава поръчка');
    if (o.status === 'paid') need(c, 'manager');
    if (o.status === 'void') return { ok: true };
    tx(db, () => {
      if (o.status === 'paid') reverseSale(db, c.now, o.id);
      q("UPDATE orders SET status = 'void', closed_at = COALESCE(closed_at, ?) WHERE id = ?").run(c.now, o.id);
    });
    return { ok: true };
  });

  // ---------- отчети ----------
  on('GET', '/reports/day', (c) => {
    need(c, 'manager');
    const date = c.query.date || localDate();
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

  /**
   * Изпълнява заявка. req = { method, path, body, query, user, now, replay, newId }.
   * Хвърля грешка със statusCode при отказ.
   */
  function handle(req) {
    const path = req.path.split('?')[0];
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return r.fn({
        ...req, params, body: req.body || {}, query: req.query || {},
        now: req.now || sqlNow(), newId: req.newId || (() => crypto.randomUUID()),
      });
    }
    throw httpError(404, 'Няма такъв адрес');
  }

  return { handle, readSettings };
}
