import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, loadCatalog, paySale, flushQueue, queued, onQueue, uid } from '../lib/api.js';
import { eur, money, round2, parseNum, catColor, VAT, fmtTime } from '../lib/format.js';
import Icon from '../components/Icon.jsx';
import { Modal, Empty, useToast } from '../components/ui.jsx';

const KIND = [['here', 'На място'], ['takeaway', 'За вкъщи'], ['delivery', 'Доставка']];
const newOrder = () => ({ uid: uid(), kind: 'here', table_id: null, lines: [], saved: false, number: null });

export default function Pos({ user }) {
  const toast = useToast();
  const [cat, setCat] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [filter, setFilter] = useState(-1);
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState(newOrder);
  const [modal, setModal] = useState(null); // 'pay' | 'tables' | 'open'
  const [openOrders, setOpenOrders] = useState([]);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [sheet, setSheet] = useState(false);
  const [bump, setBump] = useState(null);
  const searchRef = useRef();

  const reload = useCallback(() => loadCatalog().then((c) => { setCatalog(c); setOnline(!c.offline); }).catch((e) => toast(e.message, 'err')), [toast]);
  const refreshOpen = useCallback(() => api('/orders/open').then(setOpenOrders).catch(() => {}), []);

  useEffect(() => { reload(); refreshOpen(); queued().then((q) => setPending(q.length)); }, [reload, refreshOpen]);
  useEffect(() => onQueue(setPending), []);
  useEffect(() => {
    const up = () => { setOnline(true); flushQueue(); reload(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const t = setInterval(() => { flushQueue(); }, 30000);
    flushQueue();
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); clearInterval(t); };
  }, [reload]);

  const settings = catalog?.settings || {};
  const tablesOn = settings.mode !== 'shop';
  const cats = catalog?.categories || [];
  const catById = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c])), [cats]);
  const sellable = useMemo(() => (catalog?.products || []).filter((p) => p.sellable), [catalog]);
  const onPos = useMemo(() => sellable.filter((p) => p.on_pos), [sellable]);
  const visibleCats = useMemo(() => cats.filter((c) => onPos.some((p) => p.category_id === c.id)), [cats, onPos]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (s) return sellable.filter((p) => p.name.toLowerCase().includes(s) || p.barcode === s || p.code?.toLowerCase() === s);
    if (filter >= 0) return onPos.filter((p) => p.category_id === filter);
    const rank = Object.fromEntries(cats.map((c, i) => [c.id, i]));
    return [...onPos].sort((a, b) => (rank[a.category_id] ?? 999) - (rank[b.category_id] ?? 999) || a.sort - b.sort || a.name.localeCompare(b.name, 'bg'));
  }, [search, filter, onPos, sellable, cats]);

  const qtyIn = useMemo(() => {
    const m = {};
    for (const l of order.lines) m[l.product_id] = (m[l.product_id] || 0) + l.qty;
    return m;
  }, [order.lines]);
  const total = round2(order.lines.reduce((s, l) => s + l.qty * l.price, 0));
  const vat = round2(order.lines.reduce((s, l) => s + (l.qty * l.price * VAT[l.vat_group]) / (100 + VAT[l.vat_group]), 0));
  const count = order.lines.reduce((s, l) => s + l.qty, 0);

  const add = useCallback((p, d = 1) => {
    setOrder((o) => {
      const i = o.lines.findIndex((l) => l.product_id === p.id);
      const lines = [...o.lines];
      if (i < 0) { if (d > 0) lines.push({ product_id: p.id, name: p.name, qty: d, price: p.price, vat_group: p.vat_group }); }
      else {
        const q = round2(lines[i].qty + d);
        if (q <= 0) lines.splice(i, 1); else lines[i] = { ...lines[i], qty: q };
      }
      return { ...o, lines };
    });
    if (d > 0) setBump({ id: p.id, t: Date.now() });
  }, []);

  const scan = useCallback((raw) => {
    const code = raw.trim();
    if (!code) return false;
    const p = sellable.find((x) => x.barcode === code || x.code === code);
    if (p) { add(p); toast(`${p.name} · ${eur(p.price)}`); return true; }
    return false;
  }, [sellable, add, toast]);

  // баркод скенерът „пише“ бързо и завършва с Enter; хващаме го, дори фокусът да не е в полето
  useEffect(() => {
    let buf = '', last = 0;
    const h = (e) => {
      if (modal) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const now = Date.now();
      if (now - last > 80) buf = '';
      last = now;
      if (e.key === 'Enter') {
        if (buf.length >= 4 && !scan(buf)) toast(`Няма артикул с баркод ${buf}`, 'err');
        buf = '';
      } else if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [scan, modal, toast]);

  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    if (scan(search)) { setSearch(''); return; }
    if (shown.length === 1) { add(shown[0]); setSearch(''); return; }
    if (/^\d{4,}$/.test(search.trim())) toast(`Няма артикул с баркод ${search.trim()}`, 'err');
  };

  const clear = async () => {
    if (order.saved && order.lines.length === 0) await api(`/orders/${order.uid}/void`, { method: 'POST' }).catch(() => {});
    setOrder(newOrder());
    refreshOpen();
  };

  const park = async () => {
    try {
      await api('/orders', { method: 'POST', body: order });
      const t = catalog.tables.find((x) => x.id === order.table_id);
      toast(t ? `Сметката на ${t.name} е запазена` : 'Сметката е запазена');
      setOrder(newOrder());
      setSheet(false);
      refreshOpen();
    } catch (e) { toast(e.message, 'err'); }
  };

  const resume = (o) => {
    setOrder({ uid: o.uid, kind: o.kind, table_id: o.table_id, number: o.number, saved: true,
      lines: o.lines.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, price: l.price, vat_group: l.vat_group })) });
    setModal(null);
  };

  const pickTable = (t) => {
    const existing = openOrders.find((o) => o.table_id === t.id && o.uid !== order.uid);
    if (existing && !order.lines.length) return resume(existing);
    if (existing) { toast(`${t.name} вече има отворена сметка`, 'err'); return; }
    setOrder((o) => ({ ...o, table_id: t.id, kind: 'here' }));
    setModal(null);
  };

  const finish = async (payment, tendered) => {
    const sale = { ...order, payment, tendered, closed_at: new Date().toISOString() };
    const r = await paySale(sale);
    setOrder(newOrder());
    setSheet(false);
    refreshOpen();
    if (r.offline) setOnline(false); else reload();
    return r;
  };

  if (!catalog) return <div className="page"><Empty icon="pos" title="Зареждане на касата…" /></div>;
  const table = catalog.tables.find((t) => t.id === order.table_id);
  const openCount = openOrders.filter((o) => o.uid !== order.uid).length;

  return (
    <div className="pos">
      <section className="pos-main">
        {!online && <div className="offline-bar">Няма връзка със сървъра. Продажбите се пазят на това устройство{pending ? ` (${pending})` : ''} и ще се изпратят автоматично.</div>}
        <div className="pos-top">
          <div>
            <h1>Продажба</h1>
            <div className="sub">{user.name} · <span className={`net ${online ? '' : 'off'}`}><i />{online ? (pending ? `изпраща ${pending}` : 'на линия') : 'офлайн'}</span></div>
          </div>
          <label className="scan">
            <Icon name="barcode" />
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey}
              placeholder="Сканирайте баркод или търсете по име" autoComplete="off" aria-label="Баркод или име" />
            {search ? <button className="btn ghost icon" style={{ padding: 4 }} onClick={() => setSearch('')} aria-label="Изчисти"><Icon name="x" size={16} /></button> : <kbd>Enter</kbd>}
          </label>
          {tablesOn && (
            <button className="btn" onClick={() => { refreshOpen(); setModal('open'); }}>
              <Icon name="doc" />Сметки{openCount ? <span className="pill acc" style={{ padding: '1px 7px' }}>{openCount}</span> : null}
            </button>
          )}
        </div>
        {!search && (
          <div className="cats">
            <button className={`chip ${filter < 0 ? 'on' : ''}`} onClick={() => setFilter(-1)}>Всички <em>{onPos.length}</em></button>
            {visibleCats.map((c) => (
              <button key={c.id} className={`chip ${filter === c.id ? 'on' : ''}`} onClick={() => setFilter(c.id)} style={{ '--c': catColor(c.color) }}>
                <span className="dot" />{c.name} <em>{onPos.filter((p) => p.category_id === c.id).length}</em>
              </button>
            ))}
          </div>
        )}
        <div className="tiles-wrap">
          {shown.length ? (
            <div className="tiles">
              {shown.map((p) => {
                const c = catById[p.category_id];
                const q = qtyIn[p.id];
                const low = p.type === 'goods' && p.min_stock > 0 && p.stock <= p.min_stock;
                return (
                  <button key={p.id} className={`tile ${p.image ? 'has-img' : ''} ${low ? 'low' : ''}`} style={{ '--c': catColor(c?.color) }}
                    onClick={() => add(p)} title={low ? `Остават ${p.stock} ${p.unit}` : undefined}>
                    {p.image ? <div className="img" style={{ backgroundImage: `url(${p.image})` }} /> : <span className="ic"><Icon name={c?.icon || 'box'} /></span>}
                    {q ? <span key={bump?.id === p.id ? bump.t : 'q'} className={`q ${bump?.id === p.id ? 'pop' : ''}`}>{q}</span> : null}
                    <b>{p.name}</b>
                    <div className="row"><span className="pr">{eur(p.price)}</span><span className="u">{c?.name || p.unit}</span></div>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty icon="search" title={search ? 'Няма такъв артикул' : 'Няма артикули за продажба'}>
              {search ? 'Проверете баркода или името.' : 'Добавете артикули от „Артикули“.'}
            </Empty>
          )}
        </div>
        <button className="cartbar" onClick={() => setSheet(true)}>
          <span>{count ? `Поръчка · ${money(count).replace(/,00$/, '')} арт.` : 'Поръчката е празна'}{table ? ` · ${table.name}` : ''}</span>
          <span className="num">{eur(total)}</span>
        </button>
      </section>

      {sheet && <div className="sheet-bg" onClick={() => setSheet(false)} />}
      <aside className={`cart ${sheet ? 'open' : ''}`} aria-label="Поръчка">
        <div className="cart-h">
          <div className="t">
            <div style={{ flex: 1 }}>
              <h2>{order.number ? `Сметка № ${order.number}` : 'Нова поръчка'}</h2>
              <div className="no">{count ? `${money(count).replace(/,00$/, '')} артикула` : 'Няма маркирани артикули'}</div>
            </div>
            {order.lines.length > 0 && <button className="btn ghost sm" onClick={() => setOrder((o) => ({ ...o, lines: [] }))}><Icon name="trash" />Изчисти</button>}
            <button className="btn ghost icon close" onClick={() => setSheet(false)} aria-label="Затвори"><Icon name="x" /></button>
          </div>
          <div className="seg" role="group" aria-label="Вид поръчка">
            {KIND.map(([k, l]) => (
              <button key={k} className={order.kind === k ? 'on' : ''} onClick={() => setOrder((o) => ({ ...o, kind: k, table_id: k === 'here' ? o.table_id : null }))}>{l}</button>
            ))}
          </div>
          {tablesOn && order.kind === 'here' && (
            <button className={`table-btn ${table ? 'set' : ''}`} onClick={() => { refreshOpen(); setModal('tables'); }}>
              <Icon name="table" />{table ? table.name : 'Изберете маса'}{table && <span style={{ marginLeft: 'auto', fontWeight: 500 }}>смени</span>}
            </button>
          )}
        </div>
        <div className="lines">
          {order.lines.length ? order.lines.map((l) => {
            const p = sellable.find((x) => x.id === l.product_id) || { id: l.product_id, name: l.name, price: l.price, vat_group: l.vat_group };
            const c = catById[p.category_id];
            return (
              <div className="line" key={l.product_id}>
                <div className="thumb" style={{ '--c': catColor(c?.color), width: 40, height: 40 }}>{p.image ? <img src={p.image} alt="" /> : <Icon name={c?.icon || 'box'} />}</div>
                <div style={{ minWidth: 0 }}><b>{l.name}</b><small className="num">{eur(l.price)} × {money(l.qty).replace(/,00$/, '')}</small></div>
                <div className="r">
                  <span className="sum">{eur(l.qty * l.price)}</span>
                  <div className="step">
                    <button onClick={() => add(p, -1)} aria-label="По-малко"><Icon name={l.qty <= 1 ? 'trash' : 'minus'} stroke={2.2} /></button>
                    <span>{money(l.qty).replace(/,00$/, '')}</span>
                    <button onClick={() => add(p, 1)} aria-label="Повече"><Icon name="plus" stroke={2.2} /></button>
                  </div>
                </div>
              </div>
            );
          }) : <Empty icon="barcode" title="Празна поръчка">Докоснете артикул или сканирайте баркод.</Empty>}
        </div>
        <div className="totals">
          <div><span>в т.ч. ДДС</span><span className="num">{eur(vat)}</span></div>
          <div className="big"><span>Общо</span><span className="num">{eur(total)}</span></div>
        </div>
        <div className="pay-row">
          {tablesOn && (order.table_id || order.saved) && (
            <button className="btn full" onClick={park} disabled={!order.lines.length}><Icon name="park" />Запази сметката</button>
          )}
          <button className="btn big" onClick={() => setModal({ pay: 'cash' })} disabled={!order.lines.length}><Icon name="cash" />В брой</button>
          <button className="btn pri big" onClick={() => setModal({ pay: 'card' })} disabled={!order.lines.length}><Icon name="card" />С карта</button>
          {order.saved && !order.lines.length && <button className="btn danger full" onClick={clear}>Анулирай празната сметка</button>}
        </div>
      </aside>

      {modal?.pay && <PayModal method={modal.pay} total={total} onClose={() => setModal(null)} onPay={finish} />}
      {modal === 'tables' && <TablesModal tables={catalog.tables} open={openOrders} current={order} onPick={pickTable} onClose={() => setModal(null)} />}
      {modal === 'open' && <OpenModal orders={openOrders} current={order} onResume={resume} onClose={() => setModal(null)} />}
    </div>
  );
}

function PayModal({ method: initial, total, onClose, onPay }) {
  const toast = useToast();
  const [method, setMethod] = useState(initial);
  const [given, setGiven] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const tendered = given === '' ? total : parseNum(given);
  const change = round2(tendered - total);
  const quick = [...new Set([Math.ceil(total), Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, Math.ceil(total / 20) * 20, 50, 100].filter((v) => v >= total))].slice(0, 5);

  const go = async () => {
    if (method === 'cash' && change < 0) return toast('Получената сума е по-малка от дължимата', 'err');
    setBusy(true);
    try {
      const r = await onPay(method, method === 'cash' ? tendered : null);
      setDone({ ...r, change: method === 'cash' ? change : 0 });
    } catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    const h = (e) => { if (e.key === 'Enter' && !busy) { e.preventDefault(); done ? onClose() : go(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  useEffect(() => { if (done) { const t = setTimeout(onClose, 6000); return () => clearTimeout(t); } }, [done, onClose]);

  if (done) return (
    <Modal title="Продажбата е приключена" onClose={onClose} footer={<button className="btn pri big" style={{ flex: 1 }} onClick={onClose} autoFocus>Нова продажба</button>}>
      <div className="done-ic"><Icon name="check" stroke={2.4} /></div>
      {done.change > 0 ? (
        <div className="change"><div className="lbl">Ресто</div><div className="v num">{eur(done.change)}</div></div>
      ) : (
        <div className="change"><div className="lbl">{method === 'card' ? 'Платено с карта' : 'Платено в брой'}</div><div className="v num">{eur(done.total)}</div></div>
      )}
      <p className="mute" style={{ textAlign: 'center', margin: 0, fontSize: 13 }}>
        {done.offline ? 'Записана на това устройство. Ще се изпрати, щом има връзка.' : `Бележка № ${done.number}. Касовият апарат ще се свърже в следващ етап.`}
      </p>
    </Modal>
  );

  return (
    <Modal title="Плащане" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Назад</button>
      <button className="btn pri big" style={{ flex: 1 }} onClick={go} disabled={busy || (method === 'cash' && change < 0)}>
        <Icon name={method === 'cash' ? 'cash' : 'card'} />{busy ? 'Обработва…' : `Приключи ${eur(total)}`}
      </button>
    </>}>
      <div className="seg" style={{ display: 'grid' }}>
        <button className={method === 'cash' ? 'on' : ''} onClick={() => setMethod('cash')}>В брой</button>
        <button className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}>С карта</button>
      </div>
      <div className="change"><div className="lbl">За плащане</div><div className="v num">{eur(total)}</div></div>
      {method === 'cash' ? (<>
        <div className="field">
          <label htmlFor="given">Получени</label>
          <input id="given" className="input num" inputMode="decimal" autoFocus value={given} placeholder={money(total)}
            onChange={(e) => setGiven(e.target.value)} style={{ fontSize: 22, padding: '12px 14px' }} />
        </div>
        <div className="cash-keys">
          <button className={given === '' ? 'on' : ''} onClick={() => setGiven('')}>Точно</button>
          {quick.map((v) => <button key={v} className={parseNum(given) === v && given !== '' ? 'on' : ''} onClick={() => setGiven(String(v))}>{v} €</button>)}
        </div>
        <div className="totals" style={{ border: 'none', padding: 0 }}>
          <div className="big" style={{ fontSize: 20, color: change < 0 ? 'var(--bad)' : 'var(--ink)' }}>
            <span>{change < 0 ? 'Не достигат' : 'Ресто'}</span><span className="num">{eur(Math.abs(change))}</span>
          </div>
        </div>
      </>) : (
        <p className="mute" style={{ margin: 0, textAlign: 'center' }}>Прекарайте картата през банковия терминал и потвърдете, когато плащането е одобрено.</p>
      )}
    </Modal>
  );
}

function TablesModal({ tables, open, current, onPick, onClose }) {
  const zones = [...new Set(tables.map((t) => t.zone))];
  return (
    <Modal title="Изберете маса" onClose={onClose} wide>
      {!tables.length && <Empty icon="table" title="Няма въведени маси">Добавете маси от „Настройки“.</Empty>}
      {zones.map((z) => (
        <div key={z} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="zone">{z}</div>
          <div className="tables-grid">
            {tables.filter((t) => t.zone === z).map((t) => {
              const o = open.find((x) => x.table_id === t.id && x.uid !== current.uid);
              const mine = current.table_id === t.id;
              return (
                <button key={t.id} className={`tbl-tile ${o || mine ? 'busy' : ''}`} onClick={() => onPick(t)}>
                  <b>{t.name}</b>
                  <small>{mine ? 'текуща' : o ? `${eur(o.total)} · ${fmtTime(o.opened_at)}` : 'свободна'}</small>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </Modal>
  );
}

function OpenModal({ orders, current, onResume, onClose }) {
  const list = orders.filter((o) => o.uid !== current.uid);
  return (
    <Modal title="Отворени сметки" onClose={onClose} wide>
      {list.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Сметка</th><th>Маса</th><th>Отворена</th><th>Сервира</th><th className="r">Сума</th></tr></thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.uid} className="click" onClick={() => onResume(o)}>
                  <td className="name num">№ {o.number}</td><td>{o.table_name || (o.kind === 'takeaway' ? 'За вкъщи' : 'Доставка')}</td>
                  <td className="num">{fmtTime(o.opened_at)}</td><td>{o.user_name}</td><td className="r">{eur(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon="doc" title="Няма отворени сметки">Изберете маса и натиснете „Запази сметката“.</Empty>}
    </Modal>
  );
}
