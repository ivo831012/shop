import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.SHOP_DATA_DIR || resolve(here, '../data');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','cashier','stock')),
  pin_hash      TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  color  TEXT NOT NULL DEFAULT 'stone',
  icon   TEXT NOT NULL DEFAULT 'box',
  sort   INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- type: goods (стока), recipe (по рецепта), combo (комбо меню), service (услуга, без склад)
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  type        TEXT NOT NULL DEFAULT 'goods' CHECK (type IN ('goods','recipe','combo','service')),
  unit        TEXT NOT NULL DEFAULT 'бр.',
  barcode     TEXT,
  code        TEXT,
  price       REAL NOT NULL DEFAULT 0,
  vat_group   TEXT NOT NULL DEFAULT 'Б',
  cost        REAL NOT NULL DEFAULT 0,
  min_stock   REAL NOT NULL DEFAULT 0,
  sellable    INTEGER NOT NULL DEFAULT 1,
  on_pos      INTEGER NOT NULL DEFAULT 1,
  image       TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS products_barcode ON products(barcode);

CREATE TABLE IF NOT EXISTS product_components (
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty          REAL NOT NULL,
  PRIMARY KEY (product_id, component_id)
);

CREATE TABLE IF NOT EXISTS stock (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  qty        REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_moves (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty        REAL NOT NULL,
  reason     TEXT NOT NULL,
  ref_type   TEXT,
  ref_id     INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- type: delivery (доставка), writeoff (брак), revision (ревизия)
CREATE TABLE IF NOT EXISTS documents (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('delivery','writeoff','revision')),
  number     TEXT NOT NULL,
  partner    TEXT,
  invoice_no TEXT,
  date       TEXT NOT NULL,
  note       TEXT,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  posted_at  TEXT
);

CREATE TABLE IF NOT EXISTS document_lines (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty         REAL NOT NULL,
  price       REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tables (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  zone   TEXT NOT NULL DEFAULT 'Зала',
  sort   INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- status: open (отворена сметка), paid, void
CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY,
  uid         TEXT NOT NULL UNIQUE,
  number      INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('open','paid','void')),
  kind        TEXT NOT NULL DEFAULT 'here' CHECK (kind IN ('here','takeaway','delivery')),
  table_id    INTEGER REFERENCES tables(id),
  user_id     INTEGER REFERENCES users(id),
  payment     TEXT CHECK (payment IN ('cash','card')),
  total       REAL NOT NULL DEFAULT 0,
  tendered    REAL,
  note        TEXT,
  fiscal_ref  TEXT,
  opened_at   TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at   TEXT
);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS orders_closed ON orders(closed_at);

CREATE TABLE IF NOT EXISTS order_lines (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name       TEXT NOT NULL,
  qty        REAL NOT NULL,
  price      REAL NOT NULL,
  vat_group  TEXT NOT NULL
);
`;

const DEFAULT_SETTINGS = {
  company_name: 'Моят обект',
  company_eik: '',
  company_address: '',
  mode: 'both',           // shop | restaurant | both
  currency: 'EUR',
  receipt_footer: 'Благодарим ви!',
  fiscal_driver: 'none',  // none | eltrade (по-късно)
  card_terminal: 'none',
};

export function openDb(file = resolve(DATA_DIR, 'shop.db')) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  return db;
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
