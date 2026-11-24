import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema } from '../../core/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.SHOP_DATA_DIR || resolve(here, '../data');

export function openDb(file = resolve(DATA_DIR, 'shop.db')) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  initSchema(db);
  return db;
}
