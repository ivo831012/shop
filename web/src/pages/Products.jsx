import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { eur, money, dec, qty as fq, parseNum, TYPE, VAT, COLORS, catColor } from '../lib/format.js';
import Icon, { CAT_ICONS } from '../components/Icon.jsx';
import { Drawer, Modal, Field, Thumb, Empty, ProductPicker, useToast } from '../components/ui.jsx';

const UNITS = ['бр.', 'кг', 'г', 'л', 'мл', 'пак.', 'порция'];

export default function Products({ user }) {
  const toast = useToast();
  const [tab, setTab] = useState('items');
  const [products, setProducts] = useState(null);
  const [cats, setCats] = useState([]);
  const [q, setQ] = useState('');
  const [fCat, setFCat] = useState('');
  const [fType, setFType] = useState('');
  const [edit, setEdit] = useState(null);

  const load = () => Promise.all([api('/products'), api('/categories')]).then(([p, c]) => { setProducts(p); setCats(c); }).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (products || []).filter((p) =>
      (!s || p.name.toLowerCase().includes(s) || p.barcode?.includes(s) || p.code?.toLowerCase() === s) &&
      (!fCat || String(p.category_id) === fCat) && (!fType || p.type === fType));
  }, [products, q, fCat, fType]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Артикули</h1><div className="sub">Номенклатура, рецепти, комбо менюта и категории</div></div>
        <div className="grow" />
        {tab === 'items' && <button className="btn pri" onClick={() => setEdit({ type: 'goods', unit: 'бр.', vat_group: 'Б', price: 0, sellable: 1, on_pos: 1, components: [], category_id: fCat || null })}><Icon name="plus" />Нов артикул</button>}
      </div>
      <div className="tabs">
        <button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>Артикули <span className="mute">{products?.length ?? ''}</span></button>
        <button className={tab === 'cats' ? 'on' : ''} onClick={() => setTab('cats')}>Категории <span className="mute">{cats.length}</span></button>
      </div>

      {tab === 'items' ? (<>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <div className="search"><Icon name="search" /><input className="input" placeholder="Име, код или баркод" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="select" style={{ width: 'auto' }} value={fCat} onChange={(e) => setFCat(e.target.value)} aria-label="Категория">
            <option value="">Всички категории</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={fType} onChange={(e) => setFType(e.target.value)} aria-label="Вид">
            <option value="">Всички видове</option>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {products && (list.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Артикул</th><th>Вид</th><th>Баркод</th><th className="r">Себест.</th><th className="r">Цена</th><th className="r">Наличност</th></tr></thead>
              <tbody>
                {list.map((p) => {
                  const c = cats.find((x) => x.id === p.category_id);
                  const low = p.type === 'goods' && p.min_stock > 0 && p.stock < p.min_stock;
                  return (
                    <tr key={p.id} className="click" onClick={() => setEdit(p)}>
                      <td><div className="namecell"><Thumb p={p} cats={cats} /><div><div className="name">{p.name}</div><div className="mute" style={{ fontSize: 12.5 }}>{c?.name || 'Без категория'}{!p.sellable ? ' · не се продава' : ''}</div></div></div></td>
                      <td><span className={`pill ${p.type === 'goods' ? '' : 'acc'}`}>{TYPE[p.type]}</span></td>
                      <td className="num mute" style={{ fontSize: 13 }}>{p.barcode || '—'}</td>
                      <td className="r mute">{p.cost ? money(p.cost) : '—'}</td>
                      <td className="r">{p.sellable ? eur(p.price) : '—'}</td>
                      <td className="r">{p.type === 'goods' ? <span className={low ? 'pill warn' : ''}>{fq(p.stock)} {p.unit}</span> : <span className="mute">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="items" title="Няма намерени артикули">Променете търсенето или добавете нов артикул.</Empty>)}
      </>) : <Categories cats={cats} products={products || []} reload={load} />}

      {edit && <Editor item={edit} cats={cats} products={products || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} canDelete={user.role !== 'stock'} />}
    </div>
  );
}

async function resizeImage(file, max = 480) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const webp = cv.toDataURL('image/webp', 0.82);
    return webp.startsWith('data:image/webp') ? webp : cv.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

function Editor({ item, cats, products, onClose, onSaved, canDelete }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({ ...item, price: dec(item.price ?? 0), min_stock: dec(item.min_stock ?? 0), components: (item.components || []).map((c) => ({ ...c, qty: dec(c.qty) })) }));
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const fileRef = useRef();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value) : e }));
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const composite = f.type === 'recipe' || f.type === 'combo';
  const cat = cats.find((c) => c.id === f.category_id);

  const cost = composite ? f.components.reduce((s, c) => s + (byId[c.id]?.cost || 0) * parseNum(c.qty), 0) : Number(f.cost) || 0;
  const net = parseNum(f.price) / (1 + VAT[f.vat_group] / 100);
  const markup = cost > 0 ? Math.round(((net - cost) / cost) * 100) : null;
  const comboSum = f.type === 'combo' ? f.components.reduce((s, c) => s + (byId[c.id]?.price || 0) * parseNum(c.qty), 0) : 0;
  const pickable = products.filter((p) => p.id !== f.id && (f.type === 'combo' ? p.sellable : true));

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, price: parseNum(f.price), min_stock: parseNum(f.min_stock), category_id: f.category_id || null,
        components: composite ? f.components.map((c) => ({ id: c.id, qty: parseNum(c.qty) })) : [] };
      delete body.stock; delete body.cost; delete body.updated_at;
      if (f.id) await api(`/products/${f.id}`, { method: 'PUT', body }); else await api('/products', { method: 'POST', body });
      toast(f.id ? 'Артикулът е записан' : 'Артикулът е добавен');
      onSaved();
    } catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const del = async () => {
    try { await api(`/products/${f.id}`, { method: 'DELETE' }); toast('Артикулът е изтрит'); onSaved(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <Drawer title={f.id ? f.name || 'Артикул' : 'Нов артикул'} onClose={onClose} footer={<>
      {f.id && canDelete && (confirmDel
        ? <><button className="btn danger" onClick={del}>Да, изтрий</button><button className="btn ghost" onClick={() => setConfirmDel(false)}>Не</button></>
        : <button className="btn ghost" onClick={() => setConfirmDel(true)}><Icon name="trash" />Изтрий</button>)}
      <div className="grow" />
      <button className="btn" onClick={onClose}>Откажи</button>
      <button className="btn pri" onClick={save} disabled={busy || !String(f.name || '').trim()}>{busy ? 'Записва…' : 'Запиши'}</button>
    </>}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <button className="img-drop" style={{ '--c': catColor(cat?.color) }} onClick={() => fileRef.current.click()} aria-label="Снимка">
          {f.image ? <img src={f.image} alt="" /> : <Icon name={cat?.icon || 'image'} />}
          <span>{f.image ? 'Смени' : 'Снимка'}</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) { try { setF((x) => ({ ...x, image: null })); const img = await resizeImage(file); setF((x) => ({ ...x, image: img })); } catch { toast('Снимката не може да се прочете', 'err'); } }
          e.target.value = '';
        }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Field label="Име"><input className="input" value={f.name || ''} onChange={set('name')} autoFocus={!f.id} placeholder="напр. Капучино" /></Field>
          {f.image && <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setF((x) => ({ ...x, image: null }))}>Махни снимката</button>}
        </div>
      </div>

      <Field label="Вид">
        <div className="seg" style={{ display: 'grid' }}>
          {Object.entries(TYPE).map(([k, v]) => <button key={k} className={f.type === k ? 'on' : ''} onClick={() => setF((x) => ({ ...x, type: k }))}>{v}</button>)}
        </div>
        <span className="hint">{{ goods: 'Води се в склада: доставя се и се продава или влага в рецепти.', recipe: 'При продажба изписва съставките от склада.', combo: 'Няколко артикула на обща цена. Изписва всеки от тях.', service: 'Продава се, но не се води в склада.' }[f.type]}</span>
      </Field>

      <div className="grid2">
        <Field label="Категория">
          <select className="select" value={f.category_id || ''} onChange={set('category_id')}>
            <option value="">Без категория</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Мярка">
          <select className="select" value={f.unit} onChange={set('unit')}>{[...new Set([f.unit, ...UNITS])].map((u) => <option key={u}>{u}</option>)}</select>
        </Field>
        <Field label="Баркод"><input className="input num" value={f.barcode || ''} onChange={set('barcode')} placeholder="Сканирайте тук" inputMode="numeric" /></Field>
        <Field label="Код"><input className="input" value={f.code || ''} onChange={set('code')} placeholder="Вътрешен код" /></Field>
      </div>

      <div className="grid3">
        <Field label="Продажна цена с ДДС"><input className="input num" inputMode="decimal" value={f.price} onChange={set('price')} disabled={!f.sellable} /></Field>
        <Field label="ДДС група">
          <select className="select" value={f.vat_group} onChange={set('vat_group')}>{Object.entries(VAT).map(([k, v]) => <option key={k} value={k}>{k} · {v}%</option>)}</select>
        </Field>
        {f.type === 'goods' && <Field label="Мин. наличност"><input className="input num" inputMode="decimal" value={f.min_stock ?? 0} onChange={set('min_stock')} /></Field>}
      </div>

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <label className="toggle"><input type="checkbox" checked={!!f.sellable} onChange={set('sellable')} />Продава се</label>
        <label className="toggle"><input type="checkbox" checked={!!f.on_pos} onChange={set('on_pos')} disabled={!f.sellable} />Бутон в касата</label>
      </div>

      {composite && (
        <div className="card" style={{ padding: 14 }}>
          <h3 style={{ marginBottom: 10 }}>{f.type === 'recipe' ? 'Съставки за 1 порция' : 'Съдържание на менюто'}</h3>
          <ProductPicker products={pickable} showPrice={f.type === 'combo' ? 'price' : 'cost'} placeholder={f.type === 'recipe' ? 'Добави суровина' : 'Добави артикул'}
            onPick={(p) => setF((x) => x.components.some((c) => c.id === p.id) ? x : ({ ...x, components: [...x.components, { id: p.id, qty: 1 }] }))} />
          {f.components.length > 0 && (
            <table className="tbl doc-lines" style={{ marginTop: 10 }}>
              <thead><tr><th>Артикул</th><th className="r" style={{ width: 110 }}>Количество</th><th className="r">{f.type === 'combo' ? 'Цена' : 'Стойност'}</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {f.components.map((c, i) => {
                  const p = byId[c.id];
                  return (
                    <tr key={c.id}>
                      <td><div className="name">{p?.name}</div><div className="mute" style={{ fontSize: 12 }}>{p?.unit}</div></td>
                      <td><input className="input num" inputMode="decimal" value={c.qty} aria-label="Количество"
                        onChange={(e) => setF((x) => ({ ...x, components: x.components.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)) }))} /></td>
                      <td className="r">{f.type === 'combo' ? eur((p?.price || 0) * parseNum(c.qty)) : `${money((p?.cost || 0) * parseNum(c.qty))}`}</td>
                      <td><button className="btn ghost icon" aria-label="Махни" onClick={() => setF((x) => ({ ...x, components: x.components.filter((_, j) => j !== i) }))}><Icon name="x" size={16} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {f.type === 'combo' && comboSum > 0 && (
            <div className="pill ok" style={{ marginTop: 12 }}>Поотделно {eur(comboSum)} · отстъпка {eur(comboSum - parseNum(f.price))}</div>
          )}
        </div>
      )}

      {f.sellable ? (
        <div className="kpis" style={{ marginBottom: 0 }}>
          <div className="kpi"><small>Себестойност</small><b>{money(cost)}</b><span>{composite ? 'по съставките' : 'средна доставна'}</span></div>
          <div className="kpi"><small>Цена без ДДС</small><b>{money(net)}</b></div>
          <div className="kpi"><small>Надценка</small><b>{markup === null ? '—' : `${markup}%`}</b></div>
        </div>
      ) : null}
    </Drawer>
  );
}

function Categories({ cats, products, reload }) {
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const save = async () => {
    try {
      if (edit.id) await api(`/categories/${edit.id}`, { method: 'PUT', body: edit });
      else await api('/categories', { method: 'POST', body: { ...edit, sort: cats.length + 1 } });
      setEdit(null); reload(); toast('Категорията е записана');
    } catch (e) { toast(e.message, 'err'); }
  };
  const del = async () => {
    try { await api(`/categories/${edit.id}`, { method: 'DELETE' }); setEdit(null); reload(); toast('Категорията е изтрита'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const move = async (c, d) => {
    const i = cats.findIndex((x) => x.id === c.id), j = i + d;
    if (j < 0 || j >= cats.length) return;
    const order = [...cats]; [order[i], order[j]] = [order[j], order[i]];
    await Promise.all(order.map((x, k) => api(`/categories/${x.id}`, { method: 'PUT', body: { sort: k + 1 } })));
    reload();
  };
  return (<>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
      <button className="btn pri" onClick={() => setEdit({ name: '', color: COLORS[cats.length % COLORS.length], icon: 'box' })}><Icon name="plus" />Нова категория</button>
    </div>
    <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
      {cats.map((c, i) => (
        <div key={c.id} className="tile" style={{ '--c': catColor(c.color), cursor: 'default' }}>
          <span className="ic"><Icon name={c.icon} /></span>
          <b>{c.name}</b>
          <div className="row">
            <span className="u">{products.filter((p) => p.category_id === c.id).length} артикула</span>
            <span style={{ display: 'flex', gap: 2 }}>
              <button className="btn ghost icon" style={{ padding: 5 }} onClick={() => move(c, -1)} disabled={!i} aria-label="Нагоре"><Icon name="back" size={15} style={{ transform: 'rotate(90deg)' }} /></button>
              <button className="btn ghost icon" style={{ padding: 5 }} onClick={() => move(c, 1)} disabled={i === cats.length - 1} aria-label="Надолу"><Icon name="back" size={15} style={{ transform: 'rotate(-90deg)' }} /></button>
              <button className="btn ghost sm" onClick={() => setEdit(c)}>Промени</button>
            </span>
          </div>
        </div>
      ))}
    </div>
    {edit && (
      <Modal title={edit.id ? 'Категория' : 'Нова категория'} onClose={() => setEdit(null)} footer={<>
        {edit.id && <button className="btn ghost" onClick={del}><Icon name="trash" />Изтрий</button>}
        <div className="grow" />
        <button className="btn" onClick={() => setEdit(null)}>Откажи</button>
        <button className="btn pri" onClick={save} disabled={!edit.name.trim()}>Запиши</button>
      </>}>
        <Field label="Име"><input className="input" value={edit.name} autoFocus onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Цвят на бутоните">
          <div className="swatches">{COLORS.map((c) => <button key={c} className={edit.color === c ? 'on' : ''} style={{ '--c': catColor(c) }} onClick={() => setEdit({ ...edit, color: c })} aria-label={c} />)}</div>
        </Field>
        <Field label="Икона">
          <div className="icons-pick">{CAT_ICONS.map((ic) => <button key={ic} className={edit.icon === ic ? 'on' : ''} onClick={() => setEdit({ ...edit, icon: ic })} aria-label={ic}><Icon name={ic} /></button>)}</div>
        </Field>
        <div className="tile" style={{ '--c': catColor(edit.color), width: 170, cursor: 'default' }}>
          <span className="ic"><Icon name={edit.icon} /></span><b>{edit.name || 'Пример'}</b>
          <div className="row"><span className="pr">2,40 €</span><span className="u">{edit.name}</span></div>
        </div>
      </Modal>
    )}
  </>);
}
