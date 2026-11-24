import { openDb } from './db.js';
import { buildApp, directCaller } from './app.js';

process.env.TZ ||= 'Europe/Sofia';
const db = openDb();

if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) {
  await directCaller(db)('POST', '/users', { name: 'Администратор', role: 'admin', pin: '0000' });
  console.log('Създаден е потребител „Администратор“ с ПИН 0000. Сменете го от Хора.');
}

const app = buildApp(db, { logger: { level: process.env.LOG_LEVEL || 'warn' } });
const port = Number(process.env.PORT || 3000);
await app.listen({ port, host: process.env.HOST || '0.0.0.0' });
console.log(`Каса и склад: http://localhost:${port}`);
