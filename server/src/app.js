// Сървърен вариант: същата логика като на устройствата (core/), изложена като HTTP API.
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createCore } from '../../core/handlers.js';
import { hashPin, verifyPin, validPin } from '../../core/pin.js';
import { httpError } from '../../core/stock.js';
import { fiscalDriver } from './fiscal.js';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(here, '../../web/dist');

/** ПИН кодът никога не се пази в явен вид: превръща се в хеш преди да стигне до логиката. */
export async function hashBodyPin(path, body) {
  if (!path.startsWith('/users') || !body || body.pin === undefined) return body;
  const { pin, ...rest } = body;
  if (pin === '' || pin == null) return rest;
  if (!validPin(pin)) throw httpError(400, 'ПИН кодът трябва да е от 4 до 8 цифри');
  return { ...rest, pin_hash: await hashPin(pin) };
}

export function buildApp(db, { logger = false } = {}) {
  const app = Fastify({ logger, bodyLimit: 8 * 1024 * 1024 });
  const core = createCore(db);
  const q = (sql) => db.prepare(sql);
  db.exec('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL)');

  app.setErrorHandler((err, req, reply) => {
    const code = err.statusCode || 500;
    if (code >= 500) req.log.error(err);
    reply.code(code).send({ error: code >= 500 ? 'Възникна грешка на сървъра' : err.message });
  });

  const userOf = (req) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const u = token && q(`SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
                          WHERE s.token = ? AND u.active = 1`).get(token);
    if (!u) throw httpError(401, 'Влезте отново');
    return { ...u };
  };

  app.post('/api/auth/login', async (req) => {
    const { userId, pin } = req.body || {};
    const u = q('SELECT * FROM users WHERE id = ? AND active = 1').get(String(userId));
    if (!u || !(await verifyPin(pin, u.pin_hash))) throw httpError(401, 'Грешен ПИН код');
    const token = randomBytes(24).toString('hex');
    q('INSERT INTO sessions(token, user_id, created_at) VALUES (?,?,?)').run(token, u.id, new Date().toISOString());
    return { token, user: { id: u.id, name: u.name, role: u.role } };
  });
  app.get('/api/auth/users', async () => core.handle({ method: 'GET', path: '/auth/users' }));
  app.post('/api/logout', async (req) => {
    q('DELETE FROM sessions WHERE token = ?').run((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    return { ok: true };
  });
  app.get('/api/me', async (req) => ({ user: userOf(req) }));

  const call = async (req, path) => {
    const user = userOf(req);
    const body = await hashBodyPin(path, req.body);
    const res = core.handle({ method: req.method, path, body, query: req.query, user });
    if (path.startsWith('/users') && body?.active === false) q('DELETE FROM sessions WHERE user_id = ?').run(req.params?.id ?? '');
    return res;
  };

  // плащане: след записа се печата касова бележка (засега без фискално устройство)
  const pay = async (req, body) => {
    const user = userOf(req);
    const order = core.handle({ method: 'POST', path: '/orders/pay', body, user });
    if (!order.already) {
      const settings = core.readSettings();
      const fr = await fiscalDriver(settings.fiscal_driver).printReceipt(order, settings);
      if (fr?.ref) q('UPDATE orders SET fiscal_ref = ? WHERE id = ?').run(fr.ref, order.id);
      order.fiscal_ref = fr?.ref;
    }
    return order;
  };
  app.post('/api/orders/pay', async (req) => pay(req, req.body || {}));
  app.post('/api/orders/sync', async (req) => {
    const results = [];
    for (const s of req.body?.sales || []) {
      try { results.push({ uid: s.uid, ok: true, number: (await pay(req, s)).number }); }
      catch (e) { results.push({ uid: s.uid, ok: false, error: e.message }); }
    }
    return { results };
  });

  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    app.route({ method, url: '/api/*', handler: async (req) => call(req, '/' + req.params['*']) });
  }

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

/** Изпълнява заявка директно (за първоначални данни и тестове). */
export function directCaller(db, user = { id: null, role: 'admin' }) {
  const core = createCore(db);
  return async (method, path, body) => core.handle({ method, path, body: await hashBodyPin(path, body), user });
}
