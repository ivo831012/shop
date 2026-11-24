// Двигател на устройството: собствена база (SQLite в браузъра) + дневник на операциите.
//
// Всяка промяна (продажба, доставка, нов артикул…) се записва като операция с време,
// устройство и пореден номер. Базата е резултатът от прилагането на всички операции
// в един и същ ред. Така всички устройства, които имат едни и същи операции,
// стигат до една и съща база — независимо в какъв ред са ги получили.
//
// store: { get(k), set(k, v), keys() } — асинхронно хранилище (IndexedDB в браузъра).
import { initSchema } from './schema.js';
import { createCore, sqlNow } from './handlers.js';
import { hashPin, verifyPin, validPin } from './pin.js';
import { httpError } from './stock.js';

export const opKey = (op) => `${String(op.ts).padStart(15, '0')}|${op.d}|${String(op.s).padStart(9, '0')}`;
export const opFile = (op) => `ops/${op.d}/${new Date(op.ts).toISOString().slice(0, 10)}.json`;
const SNAP_MIN_OPS = 50;

/** Обвивка, с която sql.js се ползва като node:sqlite (prepare → run/get/all). */
export function wrapSqlJs(sdb) {
  return {
    raw: sdb,
    exec: (sql) => sdb.exec(sql),
    prepare(sql) {
      const runStmt = (params, fn) => {
        const st = sdb.prepare(sql);
        try {
          st.bind(params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)));
          return fn(st);
        } finally { st.free(); }
      };
      return {
        run: (...p) => runStmt(p, (st) => { st.step(); return { changes: sdb.getRowsModified() }; }),
        get: (...p) => runStmt(p, (st) => (st.step() ? st.getAsObject() : undefined)),
        all: (...p) => runStmt(p, (st) => { const r = []; while (st.step()) r.push(st.getAsObject()); return r; }),
      };
    },
  };
}

export async function createEngine({ SQL, store, deviceId, clock = () => Date.now(), uuid = () => crypto.randomUUID() }) {
  const code = deviceId.replace(/-/g, '').slice(0, 3).toUpperCase();
  const files = new Map(); // path → [op]
  const known = new Set(); // op.id
  let log = []; // всички операции, подредени
  let db, core, lastKey = '', snapKey = '';
  let counters = (await store.get('counters')) || { seq: 0, order: 0, doc: 0 };
  const listeners = new Set();
  const emit = (what) => listeners.forEach((f) => f(what));

  const fresh = (bytes) => {
    db?.raw.close();
    db = wrapSqlJs(bytes ? new SQL.Database(bytes) : new SQL.Database());
    initSchema(db);
    core = createCore(db);
  };

  const applyOp = (op) => {
    try {
      core.handle({ method: op.m, path: op.p, body: structuredClone(op.b), user: op.u, now: sqlNow(op.ts), replay: true });
    } catch {
      // операцията е отказана еднакво на всички устройства (напр. изтрит артикул) — продължаваме
    }
    lastKey = opKey(op);
  };

  /** Докъде всички устройства са „сигурни“: никое няма да прати по-стара операция. */
  const watermark = () => {
    const last = new Map();
    for (const op of log) last.set(op.d, opKey(op));
    const others = [...last].filter(([d]) => d !== deviceId).map(([, k]) => k);
    return others.length ? others.sort()[0] : lastKey;
  };

  const rebuild = async () => {
    const snap = await store.get('snap');
    const base = snap && log.some((o) => opKey(o) === snap.key) ? snap : null;
    fresh(base?.data);
    lastKey = base?.key || '';
    snapKey = lastKey;
    const w = watermark();
    let since = 0;
    for (const op of log) {
      const k = opKey(op);
      if (k <= lastKey) continue;
      applyOp(op);
      since++;
      if (k === w && since >= SNAP_MIN_OPS) {
        await store.set('snap', { key: k, data: db.raw.export() });
        snapKey = k;
        since = 0;
      }
    }
  };

  const addToLog = (ops) => {
    const added = [];
    for (const op of ops) {
      if (known.has(op.id)) continue;
      known.add(op.id);
      const f = opFile(op);
      if (!files.has(f)) files.set(f, []);
      files.get(f).push(op);
      added.push(op);
    }
    if (added.length) log = [...log, ...added].sort((a, b) => (opKey(a) < opKey(b) ? -1 : 1));
    return added;
  };

  // ---------- зареждане ----------
  for (const k of await store.keys()) {
    if (typeof k === 'string' && k.startsWith('ops/')) addToLog((await store.get(k)) || []);
  }
  await rebuild();

  const persist = async (paths) => { for (const p of paths) await store.set(p, files.get(p)); };

  // ---------- локални промени ----------
  const prepare = async (method, path, body = {}) => {
    const b = { ...body };
    if (path.startsWith('/users') && b.pin !== undefined) {
      const { pin, ...rest } = b;
      if (pin !== '' && pin != null) {
        if (!validPin(pin)) throw httpError(400, 'ПИН кодът трябва да е от 4 до 8 цифри');
        Object.assign(rest, { pin_hash: await hashPin(pin) });
      }
      Object.keys(b).forEach((k) => delete b[k]);
      Object.assign(b, rest);
    }
    if (method === 'POST' && ['/users', '/categories', '/products', '/tables', '/documents'].includes(path)) b.id ||= uuid();
    if (method === 'POST' && path === '/documents' && !b.number) {
      counters.doc++;
      b.number = `${{ delivery: 'Д', writeoff: 'Б', revision: 'Р' }[b.type || 'delivery']}-${code}-${String(counters.doc).padStart(4, '0')}`;
    }
    if (method === 'POST' && (path === '/orders' || path === '/orders/pay') && b.uid) {
      const exists = db.prepare('SELECT number FROM orders WHERE id = ?').get(b.uid);
      if (exists) b.number = exists.number;
      else if (!b.number) { counters.order++; b.number = `${code}-${counters.order}`; }
    }
    return b;
  };

  async function mutate(method, path, body, user) {
    const b = await prepare(method, path, body);
    const ts = Math.max(clock(), Number(lastKey.slice(0, 15)) + 1 || 0);
    const op = { id: uuid(), d: deviceId, s: ++counters.seq, ts, u: user ? { id: user.id, role: user.role } : null, m: method, p: path, b };
    const result = core.handle({ method, path, body: structuredClone(b), user: user || { id: null, role: 'admin' }, now: sqlNow(ts) });
    lastKey = opKey(op);
    addToLog([op]);
    await persist([opFile(op)]);
    await store.set('counters', counters);
    emit('local');
    return result;
  }

  // ---------- вход ----------
  async function login(userId, pin) {
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(String(userId));
    if (!u || !(await verifyPin(pin, u.pin_hash))) throw httpError(401, 'Грешен ПИН код');
    return { id: u.id, name: u.name, role: u.role };
  }

  return {
    deviceId, code,
    get files() { return files; },
    get size() { return log.length; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    login,
    userActive: (id) => !!db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(String(id)),
    isEmpty: () => !db.prepare('SELECT COUNT(*) n FROM users').get().n,

    /** Изпълнява заявка като API-то на сървъра. */
    async request(method, path, body, user) {
      const [p, qs] = path.split('?');
      if (method === 'GET') return core.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs || '')), user: user || { role: 'admin' } });
      return mutate(method, p, body, user);
    },

    /** Приема операции от другите устройства. Връща броя на новите. */
    async merge(ops) {
      const added = addToLog(ops.filter((o) => o && o.id && o.d !== deviceId));
      if (!added.length) return 0;
      const touched = new Set(added.map(opFile));
      await persist(touched);
      const minKey = added.map(opKey).sort()[0];
      if (snapKey && minKey <= snapKey) { await store.set('snap', null); snapKey = ''; }
      if (minKey > lastKey) for (const op of added.sort((a, b) => (opKey(a) < opKey(b) ? -1 : 1))) applyOp(op);
      else await rebuild();
      emit('remote');
      return added.length;
    },

    /** Операциите на това устройство, групирани по файлове (за качване). */
    ownFiles() { return [...files].filter(([p]) => p.startsWith(`ops/${deviceId}/`)); },

    // за тестове
    _db: () => db,
    _snapKey: () => snapKey,
  };
}
