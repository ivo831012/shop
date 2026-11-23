// Складова логика: движения, изписване при продажба (рецепти и комбо менюта), документи.

const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export function addMove(db, productId, qty, reason, refType = null, refId = null) {
  if (!qty) return;
  db.prepare('INSERT INTO stock(product_id, qty) VALUES (?, 0) ON CONFLICT(product_id) DO NOTHING').run(productId);
  db.prepare('UPDATE stock SET qty = round(qty + ?, 4) WHERE product_id = ?').run(qty, productId);
  db.prepare('INSERT INTO stock_moves(product_id, qty, reason, ref_type, ref_id) VALUES (?,?,?,?,?)')
    .run(productId, round(qty), reason, refType, refId);
}

/**
 * Разгъва продаден артикул до складовите артикули, които трябва да се изпишат.
 * goods → самият артикул; recipe/combo → съставките (рекурсивно); service → нищо.
 * Връща Map(productId → количество).
 */
export function expandForStock(db, productId, qty, out = new Map(), depth = 0) {
  if (depth > 8) throw new Error('Рецептата съдържа сама себе си');
  const p = db.prepare('SELECT id, type FROM products WHERE id = ?').get(productId);
  if (!p) throw new Error(`Няма артикул ${productId}`);
  if (p.type === 'service') return out;
  if (p.type === 'goods') {
    out.set(p.id, round((out.get(p.id) || 0) + qty));
    return out;
  }
  const comps = db.prepare('SELECT component_id, qty FROM product_components WHERE product_id = ?').all(p.id);
  for (const c of comps) expandForStock(db, c.component_id, c.qty * qty, out, depth + 1);
  return out;
}

/** Себестойност на артикул: goods → средна доставна цена; recipe/combo → сума от съставките. */
export function costOf(db, productId, depth = 0) {
  if (depth > 8) return 0;
  const p = db.prepare('SELECT id, type, cost FROM products WHERE id = ?').get(productId);
  if (!p) return 0;
  if (p.type === 'goods' || p.type === 'service') return p.cost;
  const comps = db.prepare('SELECT component_id, qty FROM product_components WHERE product_id = ?').all(p.id);
  return round(comps.reduce((s, c) => s + c.qty * costOf(db, c.component_id, depth + 1), 0));
}

export function postSale(db, orderId) {
  const lines = db.prepare('SELECT product_id, qty FROM order_lines WHERE order_id = ?').all(orderId);
  const need = new Map();
  for (const l of lines) expandForStock(db, l.product_id, l.qty, need);
  for (const [pid, q] of need) addMove(db, pid, -q, 'sale', 'order', orderId);
}

export function reverseSale(db, orderId) {
  const moves = db.prepare("SELECT product_id, qty FROM stock_moves WHERE ref_type='order' AND ref_id=? AND reason='sale'").all(orderId);
  for (const m of moves) addMove(db, m.product_id, -m.qty, 'void', 'order', orderId);
}

export function postDocument(db, docId) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
  if (!doc) throw httpError(404, 'Няма такъв документ');
  if (doc.status === 'posted') throw httpError(409, 'Документът вече е заприходен');
  const lines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(docId);
  if (!lines.length) throw httpError(400, 'Документът няма редове');
  for (const l of lines) {
    const p = db.prepare('SELECT type FROM products WHERE id = ?').get(l.product_id);
    if (p.type !== 'goods') throw httpError(400, 'В склада се водят само стоки, не рецепти и менюта');
  }
  for (const l of lines) {
    if (doc.type === 'delivery') {
      // средно претеглена доставна цена
      const cur = db.prepare('SELECT qty FROM stock WHERE product_id = ?').get(l.product_id)?.qty || 0;
      const p = db.prepare('SELECT cost FROM products WHERE id = ?').get(l.product_id);
      const base = Math.max(cur, 0);
      const cost = base + l.qty > 0 ? (base * p.cost + l.qty * l.price) / (base + l.qty) : l.price;
      db.prepare("UPDATE products SET cost = ?, updated_at = datetime('now') WHERE id = ?").run(round(cost), l.product_id);
      addMove(db, l.product_id, l.qty, 'delivery', 'document', docId);
    } else if (doc.type === 'writeoff') {
      addMove(db, l.product_id, -l.qty, 'writeoff', 'document', docId);
    } else if (doc.type === 'revision') {
      const cur = db.prepare('SELECT qty FROM stock WHERE product_id = ?').get(l.product_id)?.qty || 0;
      addMove(db, l.product_id, round(l.qty - cur), 'revision', 'document', docId);
    }
  }
  db.prepare("UPDATE documents SET status='posted', posted_at=datetime('now') WHERE id=?").run(docId);
}

export function httpError(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}
