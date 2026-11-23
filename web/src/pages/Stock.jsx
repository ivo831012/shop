import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { eur, money, dec, qty as fq, parseNum, fmtDate, today } from '../lib/format.js';
import Icon from '../components/Icon.jsx';
import { Field, Thumb, Empty, ProductPicker, useToast } from '../components/ui.jsx';

const DOC = {
  delivery: { label: 'Доставка', many: 'Доставки', verb: 'Заприходи', priceLabel: 'Доставна цена', hint: 'Увеличава наличността и обновява средната доставна цена.' },
  writeoff: { label: 'Брак', many: 'Брак', verb: 'Изпиши', priceLabel: 'Себестойност', hint: 'Намалява наличността: развалена, счупена или изгубена стока.' },
  revision: { label: 'Ревизия', many: 'Ревизии', verb: 'Приключи ревизията', priceLabel: 'Себестойност', hint: 'Въведете преброеното количество. Наличността става равна на него.' },
};

export default function Stock() {
  const toast = useToast();
  const [tab, setTab] = useState('stock');
  const [stock, setStock] = useState(null);
  const [cats, setCats] = useState([]);
  const [docs, setDocs] = useState(null);
  const [doc, setDoc] = useState(null);
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);

  const load = () => Promise.all([api('/stock'), api('/categories'), api('/documents')])
    .then(([s, c, d]) => { setStock(s); setCats(c); setDocs(d); }).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []);

  const low = (p) => p.min_stock > 0 && p.stock < p.min_stock;
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (stock || []).filter((p) => (!s || p.name.toLowerCase().includes(s) || p.barcode === s) && (!onlyLow || low(p)));
  }, [stock, q, onlyLow]);
  const lowCount = (stock || []).filter(low).length;
  const value = (stock || []).reduce((s, p) => s + Math.max(p.stock, 0) * p.cost, 0);

  const open = async (id) => { try { setDoc(await api(`/documents/${id}`)); } catch (e) { toast(e.message, 'err'); } };
  const startDoc = (type, prefill = []) => setDoc({ type, date: today(), partner: '', invoice_no: '', note: '', status: 'draft', lines: prefill });

  if (doc) return <DocEditor doc={doc} stock={stock || []} onClose={() => { setDoc(null); load(); }} />;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Склад</h1><div className="sub">Наличности, доставки, брак и ревизии</div></div>
        <div className="grow" />
        <button className="btn" onClick={() => startDoc('revision')}><Icon name="check" />Ревизия</button>
        <button className="btn" onClick={() => startDoc('writeoff')}><Icon name="trash" />Брак</button>
        <button className="btn pri" onClick={() => startDoc('delivery')}><Icon name="plus" />Нова доставка</button>
      </div>

      <div className="kpis">
        <div className="kpi"><small>Стойност на склада</small><b>{eur(value)}</b><span>по средна доставна цена</span></div>
        <div className="kpi"><small>Складови артикули</small><b>{stock?.length ?? '—'}</b></div>
        <div className="kpi"><small>Под минимума</small><b style={{ color: lowCount ? 'var(--warn)' : undefined }}>{lowCount}</b><span>{lowCount ? 'за поръчка' : 'всичко е наред'}</span></div>
        <div className="kpi"><small>Чернови</small><b>{docs?.filter((d) => d.status === 'draft').length ?? '—'}</b><span>незаприходени документа</span></div>
      </div>

      <div className="tabs">
        <button className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>Наличности</button>
        <button className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>Документи</button>
      </div>

      {tab === 'stock' ? (<>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <div className="search"><Icon name="search" /><input className="input" placeholder="Търсене" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <label className="toggle"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />Само под минимума</label>
          <div className="grow" style={{ flex: 1 }} />
          {lowCount > 0 && <button className="btn sm" onClick={() => startDoc('delivery', stock.filter(low).map((p) => ({ product_id: p.id, name: p.name, unit: p.unit, qty: Math.ceil(p.min_stock * 2 - p.stock), price: p.cost })))}>
            <Icon name="doc" />Доставка за липсващите
          </button>}
        </div>
        {stock && (list.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Артикул</th><th style={{ minWidth: 160 }}>Наличност</th><th className="r">Минимум</th><th className="r">Ср. доставна</th><th className="r">Стойност</th></tr></thead>
              <tbody>
                {list.map((p) => {
                  const ratio = p.min_stock > 0 ? Math.min(p.stock / (p.min_stock * 3), 1) : 1;
                  return (
                    <tr key={p.id}>
                      <td><div className="namecell"><Thumb p={p} cats={cats} /><div className="name">{p.name}</div></div></td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <span className="num" style={{ fontWeight: 600, color: p.stock < 0 ? 'var(--bad)' : undefined }}>{fq(p.stock)} {p.unit}</span>
                          {p.min_stock > 0 && <div className="meter"><i className={p.stock < p.min_stock ? (p.stock <= 0 ? 'bad' : 'warn') : ''} style={{ width: `${Math.max(ratio, 0) * 100}%` }} /></div>}
                        </div>
                      </td>
                      <td className="r mute">{p.min_stock ? fq(p.min_stock) : '—'}</td>
                      <td className="r">{money(p.cost)}</td>
                      <td className="r">{eur(Math.max(p.stock, 0) * p.cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="stock" title={onlyLow ? 'Нищо не е под минимума' : 'Няма складови артикули'}>{onlyLow ? '' : 'Добавете артикули от вид „Стока“.'}</Empty>)}
      </>) : (
        docs && (docs.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Документ</th><th>Вид</th><th>Дата</th><th>Доставчик</th><th>Статус</th><th className="r">Сума</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="click" onClick={() => open(d.id)}>
                    <td className="name num">{d.number}</td>
                    <td>{DOC[d.type].label}</td>
                    <td className="num">{fmtDate(d.date)}</td>
                    <td>{d.partner || <span className="mute">—</span>}{d.invoice_no ? <span className="mute"> · ф-ра {d.invoice_no}</span> : ''}</td>
                    <td><span className={`pill ${d.status === 'posted' ? 'ok' : 'warn'}`}>{d.status === 'posted' ? 'заприходен' : 'чернова'}</span></td>
                    <td className="r">{d.type === 'revision' ? '—' : eur(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="doc" title="Няма документи">Започнете с „Нова доставка“.</Empty>)
      )}
    </div>
  );
}

function DocEditor({ doc: initial, stock, onClose }) {
  const toast = useToast();
  const [d, setD] = useState(() => ({ ...initial, lines: initial.lines.map((l) => ({ ...l, qty: dec(l.qty), price: dec(l.price) })) }));
  const [busy, setBusy] = useState(false);
  const meta = DOC[d.type];
  const ro = d.status === 'posted';
  const byId = useMemo(() => Object.fromEntries(stock.map((p) => [p.id, p])), [stock]);
  const sum = d.lines.reduce((s, l) => s + parseNum(l.qty) * parseNum(l.price), 0);
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
  const setLine = (i, k, v) => setD((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));

  const addProduct = (p) => setD((x) => {
    const i = x.lines.findIndex((l) => l.product_id === p.id);
    if (i >= 0 && x.type !== 'revision') return { ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, qty: dec(parseNum(l.qty) + 1) } : l)) };
    if (i >= 0) return x;
    return { ...x, lines: [...x.lines, { product_id: p.id, name: p.name, unit: p.unit, qty: x.type === 'revision' ? dec(p.stock) : '1', price: dec(p.cost || 0) }] };
  });

  const payload = () => ({ ...d, lines: d.lines.map((l) => ({ product_id: l.product_id, qty: parseNum(l.qty), price: parseNum(l.price) })) });
  const save = async (post) => {
    setBusy(true);
    try {
      let saved = d.id ? await api(`/documents/${d.id}`, { method: 'PUT', body: payload() }) : await api('/documents', { method: 'POST', body: payload() });
      if (post) saved = await api(`/documents/${saved.id}/post`, { method: 'POST' });
      toast(post ? `${saved.number} е ${d.type === 'delivery' ? 'заприходен' : 'приключен'}` : 'Черновата е записана');
      onClose();
    } catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    try { await api(`/documents/${d.id}`, { method: 'DELETE' }); toast('Черновата е изтрита'); onClose(); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <button className="btn ghost icon" onClick={onClose} aria-label="Назад"><Icon name="back" /></button>
        <div>
          <h1>{d.number ? `${meta.label} ${d.number}` : `Нова ${meta.label.toLowerCase()}`}</h1>
          <div className="sub">{ro ? `Заприходен${d.user_name ? ` от ${d.user_name}` : ''}` : meta.hint}</div>
        </div>
        <div className="grow" />
        {!ro && d.id && <button className="btn ghost" onClick={remove}><Icon name="trash" />Изтрий</button>}
        {!ro && <button className="btn" onClick={() => save(false)} disabled={busy}>Запиши чернова</button>}
        {!ro && <button className="btn pri" onClick={() => save(true)} disabled={busy || !d.lines.length}><Icon name="check" />{meta.verb}</button>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="grid4">
          {d.type === 'delivery' && <Field label="Доставчик"><input className="input" value={d.partner || ''} onChange={set('partner')} disabled={ro} placeholder="Име на фирмата" /></Field>}
          {d.type === 'delivery' && <Field label="Фактура №"><input className="input num" value={d.invoice_no || ''} onChange={set('invoice_no')} disabled={ro} /></Field>}
          <Field label="Дата"><input className="input" type="date" value={d.date || ''} onChange={set('date')} disabled={ro} /></Field>
          <Field label="Бележка" style={d.type === 'delivery' ? {} : { gridColumn: 'span 3' }}><input className="input" value={d.note || ''} onChange={set('note')} disabled={ro} /></Field>
        </div>
      </div>

      {!ro && <div style={{ marginBottom: 12, maxWidth: 520 }}><ProductPicker products={stock} onPick={addProduct} autoFocus placeholder="Добави артикул: сканирайте баркод или търсете" /></div>}

      {d.lines.length ? (
        <div className="tbl-wrap doc-lines">
          <table className="tbl">
            <thead><tr>
              <th>Артикул</th>
              {d.type === 'revision' && <th className="r">По система</th>}
              <th className="r" style={{ width: 130 }}>{d.type === 'revision' ? 'Преброено' : 'Количество'}</th>
              {d.type === 'revision' ? <th className="r">Разлика</th> : <th className="r" style={{ width: 130 }}>{meta.priceLabel}</th>}
              {d.type !== 'revision' && <th className="r">Сума</th>}
              {!ro && <th style={{ width: 44 }} />}
            </tr></thead>
            <tbody>
              {d.lines.map((l, i) => {
                const p = byId[l.product_id];
                const diff = parseNum(l.qty) - (p?.stock || 0);
                return (
                  <tr key={l.product_id}>
                    <td><div className="name">{l.name || p?.name}</div><div className="mute" style={{ fontSize: 12 }}>{l.unit || p?.unit}</div></td>
                    {d.type === 'revision' && <td className="r mute">{fq(p?.stock)}</td>}
                    <td>{ro ? <div className="r num">{fq(l.qty)}</div> : <input className="input num" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} aria-label="Количество" />}</td>
                    {d.type === 'revision'
                      ? <td className="r" style={{ color: diff < 0 ? 'var(--bad)' : diff > 0 ? 'var(--ok)' : undefined }}>{ro ? '—' : `${diff > 0 ? '+' : ''}${fq(diff)}`}</td>
                      : <td>{ro ? <div className="r num">{money(l.price)}</div> : <input className="input num" inputMode="decimal" value={l.price} onChange={(e) => setLine(i, 'price', e.target.value)} aria-label="Цена" />}</td>}
                    {d.type !== 'revision' && <td className="r">{eur(parseNum(l.qty) * parseNum(l.price))}</td>}
                    {!ro && <td><button className="btn ghost icon" onClick={() => setD((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))} aria-label="Махни"><Icon name="x" size={16} /></button></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="card"><Empty icon="barcode" title="Няма редове">Сканирайте баркод или потърсете артикул по име.</Empty></div>}

      {d.type === 'delivery' && d.lines.length > 0 && (
        <div className="doc-total">
          <span>Без ДДС <b>{eur(sum)}</b></span>
          <span>ДДС 20% <b>{eur(sum * 0.2)}</b></span>
          <span className="g">Общо <b>{eur(sum * 1.2)}</b></span>
        </div>
      )}
      {d.type === 'writeoff' && d.lines.length > 0 && <div className="doc-total"><span className="g">Стойност на брака <b>{eur(sum)}</b></span></div>}
    </div>
  );
}
