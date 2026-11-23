import { openDb } from './db.js';
import { buildApp, hashPin } from './app.js';

process.env.TZ ||= 'Europe/Sofia';
const db = openDb();

if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) {
  db.prepare('INSERT INTO users(name, role, pin_hash) VALUES (?,?,?)').run('Администратор', 'admin', hashPin('0000'));
  console.log('Създаден е потребител „Администратор“ с ПИН 0000. Сменете го от Потребители.');
}

const app = buildApp(db, { logger: { level: process.env.LOG_LEVEL || 'warn' } });
const port = Number(process.env.PORT || 3000);
app.listen({ port, host: process.env.HOST || '0.0.0.0' }).then(() => {
  console.log(`Каса и склад: http://localhost:${port}`);
});
