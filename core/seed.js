// Примерни данни за кафе-магазин. Минават през обикновените операции,
// за да работят еднакво на сървъра и на устройствата (и да се синхронизират).
// call(method, path, body) → резултат.

export async function seedDemo(call) {
  await call('PUT', '/settings', { company_name: 'Кафе „Ъгъла“' });
  for (const [name, role, pin] of [['Мария Петрова', 'cashier', '1111'], ['Георги Иванов', 'manager', '2222'], ['Деси Колева', 'stock', '3333']]) {
    await call('POST', '/users', { name, role, pin });
  }

  const C = {};
  for (const [n, color, icon, sort] of [['Кафе', 'latte', 'cup', 1], ['Напитки', 'sage', 'glass', 2], ['Закуски', 'wheat', 'bread', 3], ['Десерти', 'rose', 'cake', 4],
    ['Менюта', 'slate', 'set', 5], ['Магазин', 'stone', 'box', 6], ['Суровини', 'stone', 'box', 9]]) {
    C[n] = (await call('POST', '/categories', { name: n, color, icon, sort })).id;
  }

  const P = {};
  const add = async (key, name, cat, type, unit, barcode, price, min = 0, sellable = 1, sort = 0) => {
    P[key] = (await call('POST', '/products', { name, category_id: C[cat], type, unit, barcode, price, vat_group: 'Б', min_stock: min, sellable, on_pos: sellable, sort })).id;
  };
  for (const [k, n, u, min] of [['beans', 'Кафе на зърна Арабика', 'кг', 3], ['milk', 'Прясно мляко 3,5%', 'л', 20], ['cup', 'Чаша 12 oz с капак', 'бр.', 200],
    ['sugar', 'Захар на пакетче 5 г', 'бр.', 300], ['tea', 'Чай пакетче', 'бр.', 30], ['honey', 'Мед', 'кг', 1], ['orange', 'Портокали', 'кг', 10],
    ['lemon', 'Лимони', 'кг', 3], ['bread', 'Хляб за тост', 'бр.', 4], ['avocado', 'Авокадо', 'бр.', 6], ['turkey', 'Пуешко филе', 'кг', 1]]) {
    await add(k, n, 'Суровини', 'goods', u, null, 0, min, 0);
  }
  const items = [
    ['espresso', 'Еспресо', 'Кафе', 'recipe', '3800501000011', 1.6], ['cappuccino', 'Капучино', 'Кафе', 'recipe', '3800501000028', 2.4],
    ['latte', 'Лате', 'Кафе', 'recipe', '3800501000035', 2.6], ['flatwhite', 'Флат уайт', 'Кафе', 'recipe', '3800501000042', 2.8],
    ['teacup', 'Чай с мед', 'Кафе', 'recipe', '3800501000059', 1.8],
    ['fresh', 'Фреш портокал', 'Напитки', 'recipe', '3800501000066', 3.2], ['lemonade', 'Домашна лимонада', 'Напитки', 'recipe', '3800501000073', 2.9],
    ['water', 'Минерална вода 0,5 л', 'Напитки', 'goods', '3800048200118', 1.2, 24], ['cola', 'Кока-Кола 0,33 л', 'Напитки', 'goods', '5449000000996', 1.8, 24],
    ['icetea', 'Студен чай 0,5 л', 'Напитки', 'goods', '5449000234636', 2.1, 12],
    ['croissant', 'Кроасан с масло', 'Закуски', 'goods', '3800501000103', 1.9, 20], ['sandwich', 'Сандвич с пуешко', 'Закуски', 'recipe', '3800501000110', 4.5],
    ['banitsa', 'Баничка със сирене', 'Закуски', 'goods', '3800501000127', 1.7, 10], ['avotoast', 'Авокадо тост', 'Закуски', 'recipe', '3800501000134', 5.4],
    ['cheesecake', 'Чийзкейк', 'Десерти', 'goods', '3800501000141', 3.8, 6], ['muffin', 'Шоколадов мъфин', 'Десерти', 'goods', '3800501000158', 2.2, 8],
    ['cookie', 'Бисквитка с шоколад', 'Десерти', 'goods', '3800501000165', 1.1, 20],
    ['beans250', 'Кафе на зърна 250 г', 'Магазин', 'goods', '3800501000202', 8.9, 5], ['mug', 'Термочаша 350 мл', 'Магазин', 'goods', '3800501000219', 14.9, 3],
    ['combo1', 'Закуска комбо', 'Менюта', 'combo', '3800501000172', 6.9], ['combo2', 'Обедно меню', 'Менюта', 'combo', '3800501000189', 8.9],
  ];
  let sort = 0;
  for (const [k, n, cat, type, bc, price, min = 0] of items) await add(k, n, cat, type, 'бр.', bc, price, min, 1, ++sort);

  const R = {
    espresso: [['beans', 0.009], ['cup', 1], ['sugar', 1]], cappuccino: [['beans', 0.018], ['milk', 0.15], ['cup', 1], ['sugar', 1]],
    latte: [['beans', 0.018], ['milk', 0.22], ['cup', 1], ['sugar', 1]], flatwhite: [['beans', 0.027], ['milk', 0.13], ['cup', 1]],
    teacup: [['tea', 1], ['honey', 0.015], ['cup', 1]], fresh: [['orange', 0.45], ['cup', 1]], lemonade: [['lemon', 0.08], ['sugar', 3], ['cup', 1]],
    sandwich: [['bread', 0.25], ['turkey', 0.06]], avotoast: [['bread', 0.15], ['avocado', 1]],
    combo1: [['croissant', 1], ['cappuccino', 1], ['fresh', 1]], combo2: [['sandwich', 1], ['lemonade', 1], ['cookie', 1]],
  };
  for (const [p, comps] of Object.entries(R)) {
    await call('PUT', `/products/${P[p]}`, { components: comps.map(([c, qty]) => ({ id: P[c], qty })) });
  }

  for (let i = 1; i <= 8; i++) await call('POST', '/tables', { name: `Маса ${i}`, zone: 'Зала' });
  for (let i = 1; i <= 4; i++) await call('POST', '/tables', { name: `Тераса ${i}`, zone: 'Тераса' });

  const lines = [['beans', 6, 18.5], ['milk', 24, 1.15], ['cup', 500, 0.06], ['sugar', 1000, 0.012], ['tea', 100, 0.09], ['honey', 2, 9.8],
    ['orange', 20, 1.6], ['lemon', 4, 2.9], ['bread', 10, 1.4], ['avocado', 12, 0.95], ['turkey', 2, 14.5], ['water', 48, 0.42], ['cola', 48, 0.78],
    ['icetea', 24, 0.95], ['croissant', 60, 0.55], ['banitsa', 30, 0.65], ['cheesecake', 12, 1.6], ['muffin', 24, 0.8], ['cookie', 40, 0.35],
    ['beans250', 15, 4.2], ['mug', 6, 7.5]].map(([k, qty, price]) => ({ product_id: P[k], qty, price }));
  const doc = await call('POST', '/documents', { type: 'delivery', partner: 'Кафе Импорт ООД', invoice_no: '0000038817', lines });
  await call('POST', `/documents/${doc.id}/post`, {});
}
