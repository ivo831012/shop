import { openDb } from './db.js';
import { directCaller } from './app.js';
import { seedDemo } from '../../core/seed.js';

process.env.TZ ||= 'Europe/Sofia';
const db = openDb();
if (db.prepare('SELECT COUNT(*) c FROM products').get().c) {
  console.log('Базата вече има артикули. Примерните данни не са добавени.');
  process.exit(0);
}
const call = directCaller(db);
if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) await call('POST', '/users', { name: 'Администратор', role: 'admin', pin: '0000' });
await seedDemo(call);
console.log('Добавени са примерни данни. ПИН кодове: Администратор 0000, Мария 1111, Георги 2222, Деси 3333.');
