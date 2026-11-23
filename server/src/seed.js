// Примерни данни за кафе-магазин: суровини, стоки, рецепти, комбо меню, маси и потребители.
import { openDb, tx } from './db.js';
import { hashPin } from './app.js';
import { postDocument } from './stock.js';

process.env.TZ ||= 'Europe/Sofia';
const db = openDb();
if (db.prepare('SELECT COUNT(*) c FROM products').get().c) {
  console.log('Базата вече има артикули. Примерните данни не са добавени.');
  process.exit(0);
}

tx(db, () => {
  const user = db.prepare('INSERT INTO users(name, role, pin_hash) VALUES (?,?,?)');
  if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) user.run('Администратор', 'admin', hashPin('0000'));
  user.run('Мария Петрова', 'cashier', hashPin('1111'));
  user.run('Георги Иванов', 'manager', hashPin('2222'));
  user.run('Деси Колева', 'stock', hashPin('3333'));

  const cat = db.prepare('INSERT INTO categories(name, color, icon, sort) VALUES (?,?,?,?)');
  const C = {};
  [['Кафе', 'latte', 'cup', 1], ['Напитки', 'sage', 'glass', 2], ['Закуски', 'wheat', 'bread', 3], ['Десерти', 'rose', 'cake', 4],
   ['Менюта', 'slate', 'set', 5], ['Магазин', 'stone', 'box', 6], ['Суровини', 'stone', 'box', 9]]
    .forEach(([n, c, i, s]) => { C[n] = Number(cat.run(n, c, i, s).lastInsertRowid); });

  const prod = db.prepare(`INSERT INTO products(name, category_id, type, unit, barcode, price, vat_group, min_stock, sellable, on_pos, sort)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const P = {};
  const add = (key, name, c, type, unit, barcode, price, min = 0, sellable = 1, onPos = 1, sort = 0) => {
    P[key] = Number(prod.run(name, C[c], type, unit, barcode, price, 'Б', min, sellable, onPos, sort).lastInsertRowid);
  };
  // суровини (не се продават)
  add('beans', 'Кафе на зърна Арабика', 'Суровини', 'goods', 'кг', null, 0, 3, 0, 0);
  add('milk', 'Прясно мляко 3,5%', 'Суровини', 'goods', 'л', null, 0, 20, 0, 0);
  add('cup', 'Чаша 12 oz с капак', 'Суровини', 'goods', 'бр.', null, 0, 200, 0, 0);
  add('sugar', 'Захар на пакетче 5 г', 'Суровини', 'goods', 'бр.', null, 0, 300, 0, 0);
  add('tea', 'Чай пакетче', 'Суровини', 'goods', 'бр.', null, 0, 30, 0, 0);
  add('honey', 'Мед', 'Суровини', 'goods', 'кг', null, 0, 1, 0, 0);
  add('orange', 'Портокали', 'Суровини', 'goods', 'кг', null, 0, 10, 0, 0);
  add('lemon', 'Лимони', 'Суровини', 'goods', 'кг', null, 0, 3, 0, 0);
  add('bread', 'Хляб за тост', 'Суровини', 'goods', 'бр.', null, 0, 4, 0, 0);
  add('avocado', 'Авокадо', 'Суровини', 'goods', 'бр.', null, 0, 6, 0, 0);
  add('turkey', 'Пуешко филе', 'Суровини', 'goods', 'кг', null, 0, 1, 0, 0);
  // кафе по рецепта
  add('espresso', 'Еспресо', 'Кафе', 'recipe', 'бр.', '3800501000011', 1.60, 0, 1, 1, 1);
  add('cappuccino', 'Капучино', 'Кафе', 'recipe', 'бр.', '3800501000028', 2.40, 0, 1, 1, 2);
  add('latte', 'Лате', 'Кафе', 'recipe', 'бр.', '3800501000035', 2.60, 0, 1, 1, 3);
  add('flatwhite', 'Флат уайт', 'Кафе', 'recipe', 'бр.', '3800501000042', 2.80, 0, 1, 1, 4);
  add('teacup', 'Чай с мед', 'Кафе', 'recipe', 'бр.', '3800501000059', 1.80, 0, 1, 1, 5);
  // напитки
  add('fresh', 'Фреш портокал', 'Напитки', 'recipe', 'бр.', '3800501000066', 3.20, 0, 1, 1, 1);
  add('lemonade', 'Домашна лимонада', 'Напитки', 'recipe', 'бр.', '3800501000073', 2.90, 0, 1, 1, 2);
  add('water', 'Минерална вода 0,5 л', 'Напитки', 'goods', 'бр.', '3800048200118', 1.20, 24, 1, 1, 3);
  add('cola', 'Кока-Кола 0,33 л', 'Напитки', 'goods', 'бр.', '5449000000996', 1.80, 24, 1, 1, 4);
  add('icetea', 'Студен чай 0,5 л', 'Напитки', 'goods', 'бр.', '5449000234636', 2.10, 12, 1, 1, 5);
  // закуски и десерти
  add('croissant', 'Кроасан с масло', 'Закуски', 'goods', 'бр.', '3800501000103', 1.90, 20, 1, 1, 1);
  add('sandwich', 'Сандвич с пуешко', 'Закуски', 'recipe', 'бр.', '3800501000110', 4.50, 0, 1, 1, 2);
  add('banitsa', 'Баничка със сирене', 'Закуски', 'goods', 'бр.', '3800501000127', 1.70, 10, 1, 1, 3);
  add('avotoast', 'Авокадо тост', 'Закуски', 'recipe', 'бр.', '3800501000134', 5.40, 0, 1, 1, 4);
  add('cheesecake', 'Чийзкейк', 'Десерти', 'goods', 'бр.', '3800501000141', 3.80, 6, 1, 1, 1);
  add('muffin', 'Шоколадов мъфин', 'Десерти', 'goods', 'бр.', '3800501000158', 2.20, 8, 1, 1, 2);
  add('cookie', 'Бисквитка с шоколад', 'Десерти', 'goods', 'бр.', '3800501000165', 1.10, 20, 1, 1, 3);
  // магазин
  add('beans250', 'Кафе на зърна 250 г', 'Магазин', 'goods', 'бр.', '3800501000202', 8.90, 5, 1, 1, 1);
  add('mug', 'Термочаша 350 мл', 'Магазин', 'goods', 'бр.', '3800501000219', 14.90, 3, 1, 1, 2);
  // комбо менюта
  add('combo1', 'Закуска комбо', 'Менюта', 'combo', 'бр.', '3800501000172', 6.90, 0, 1, 1, 1);
  add('combo2', 'Обедно меню', 'Менюта', 'combo', 'бр.', '3800501000189', 8.90, 0, 1, 1, 2);

  const comp = db.prepare('INSERT INTO product_components(product_id, component_id, qty) VALUES (?,?,?)');
  const R = {
    espresso: [['beans', 0.009], ['cup', 1], ['sugar', 1]],
    cappuccino: [['beans', 0.018], ['milk', 0.15], ['cup', 1], ['sugar', 1]],
    latte: [['beans', 0.018], ['milk', 0.22], ['cup', 1], ['sugar', 1]],
    flatwhite: [['beans', 0.027], ['milk', 0.13], ['cup', 1]],
    teacup: [['tea', 1], ['honey', 0.015], ['cup', 1]],
    fresh: [['orange', 0.45], ['cup', 1]],
    lemonade: [['lemon', 0.08], ['sugar', 3], ['cup', 1]],
    sandwich: [['bread', 0.25], ['turkey', 0.06]],
    avotoast: [['bread', 0.15], ['avocado', 1]],
    combo1: [['croissant', 1], ['cappuccino', 1], ['fresh', 1]],
    combo2: [['sandwich', 1], ['lemonade', 1], ['cookie', 1]],
  };
  for (const [p, items] of Object.entries(R)) for (const [c, q] of items) comp.run(P[p], P[c], q);

  const tbl = db.prepare('INSERT INTO tables(name, zone, sort) VALUES (?,?,?)');
  for (let i = 1; i <= 8; i++) tbl.run(`Маса ${i}`, 'Зала', i);
  for (let i = 1; i <= 4; i++) tbl.run(`Тераса ${i}`, 'Тераса', 10 + i);

  const docId = Number(db.prepare(`INSERT INTO documents(type, number, partner, invoice_no, date, user_id)
    VALUES ('delivery', 'Д-000001', 'Кафе Импорт ООД', '0000038817', date('now'), 1)`).run().lastInsertRowid);
  const line = db.prepare('INSERT INTO document_lines(document_id, product_id, qty, price) VALUES (?,?,?,?)');
  [['beans', 6, 18.5], ['milk', 24, 1.15], ['cup', 500, 0.06], ['sugar', 1000, 0.012], ['tea', 100, 0.09], ['honey', 2, 9.8],
   ['orange', 20, 1.6], ['lemon', 4, 2.9], ['bread', 10, 1.4], ['avocado', 12, 0.95], ['turkey', 2, 14.5],
   ['water', 48, 0.42], ['cola', 48, 0.78], ['icetea', 24, 0.95], ['croissant', 60, 0.55], ['banitsa', 30, 0.65],
   ['cheesecake', 12, 1.6], ['muffin', 24, 0.8], ['cookie', 40, 0.35], ['beans250', 15, 4.2], ['mug', 6, 7.5]]
    .forEach(([k, q, p]) => line.run(docId, P[k], q, p));
  postDocument(db, docId);
});

console.log('Добавени са примерни данни. ПИН кодове: Администратор 0000, Мария 1111, Георги 2222, Деси 3333.');
