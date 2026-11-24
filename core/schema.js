// Обща схема на базата: еднаква на сървъра (node:sqlite) и на устройствата (sql.js).
// Идентификаторите са текстови (UUID), за да могат устройствата да създават записи без връзка.
export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','cashier','stock')),
  pin_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'stone',
  icon TEXT NOT NULL DEFAULT 'box', sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'goods' CHECK (type IN ('goods','recipe','combo','service')),
  unit TEXT NOT NULL DEFAULT 'бр.', barcode TEXT, code TEXT,
  price REAL NOT NULL DEFAULT 0, vat_group TEXT NOT NULL DEFAULT 'Б', cost REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0, sellable INTEGER NOT NULL DEFAULT 1, on_pos INTEGER NOT NULL DEFAULT 1,
  image TEXT, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS products_barcode ON products(barcode);

CREATE TABLE IF NOT EXISTS product_components (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES products(id),
  qty REAL NOT NULL, PRIMARY KEY (product_id, component_id)
);

CREATE TABLE IF NOT EXISTS stock (product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE, qty REAL NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty REAL NOT NULL, reason TEXT NOT NULL, ref_type TEXT, ref_id TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('delivery','writeoff','revision')),
  number TEXT NOT NULL, partner TEXT, invoice_no TEXT, date TEXT NOT NULL, note TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL, posted_at TEXT
);

CREATE TABLE IF NOT EXISTS document_lines (
  id INTEGER PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id), qty REAL NOT NULL, price REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, zone TEXT NOT NULL DEFAULT 'Зала',
  sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','paid','void')),
  kind TEXT NOT NULL DEFAULT 'here' CHECK (kind IN ('here','takeaway','delivery')),
  table_id TEXT REFERENCES tables(id), user_id TEXT REFERENCES users(id),
  payment TEXT CHECK (payment IN ('cash','card')), total REAL NOT NULL DEFAULT 0, tendered REAL,
  note TEXT, fiscal_ref TEXT, opened_at TEXT NOT NULL, closed_at TEXT
);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS orders_closed ON orders(closed_at);

CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id), name TEXT NOT NULL,
  qty REAL NOT NULL, price REAL NOT NULL, vat_group TEXT NOT NULL
);
`;

export const DEFAULT_SETTINGS = {
  company_name: 'Моят обект',
  company_eik: '',
  company_address: '',
  mode: 'both',
  currency: 'EUR',
  receipt_footer: 'Благодарим ви!',
  fiscal_driver: 'none',
  card_terminal: 'none',
};

export function initSchema(db) {
  db.exec(SCHEMA);
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
