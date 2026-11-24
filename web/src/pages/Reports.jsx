import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { eur, money, qty as fq, fmtTime, today } from '../lib/format.js';
import Icon from '../components/Icon.jsx';
import { Modal, Empty, useToast, useDataRefresh } from '../components/ui.jsx';

export default function Reports() {
  const toast = useToast();
  const [date, setDate] = useState(today());
  const [r, setR] = useState(null);
  const [orders, setOrders] = useState([]);
  const [view, setView] = useState(null);
  const [confirm, setConfirm] = useState(false);

  const load = () => Promise.all([api(`/reports/day?date=${date}`), api(`/orders?date=${date}`)])
    .then(([a, b]) => { setR(a); setOrders(b); }).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, [date]);
  useDataRefresh(useCallback(() => load(), [date]));

  const shift = (d) => { const x = new Date(date); x.setDate(x.getDate() + d); setDate(x.toLocaleDateString('sv-SE')); };
  const hours = Array.from({ length: 17 }, (_, i) => i + 6);
  const maxH = Math.max(1, ...(r?.byHour || []).map((h) => h.total));
  const avg = r?.count ? r.total / r.count : 0;
  const profit = r ? r.total - r.vat.reduce((s, v) => s + v.vat, 0) - r.cost : 0;

  const voidOrder = async () => {
    try { await api(`/orders/${view.uid}/void`, { method: 'POST' }); toast(`Бележка № ${view.number} е сторнирана`); setView(null); setConfirm(false); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Отчети</h1><div className="sub">Оборот, плащания и най-продавани артикули за деня</div></div>
        <div className="grow" />
        <button className="btn icon" onClick={() => shift(-1)} aria-label="Предишен ден"><Icon name="back" /></button>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto' }} aria-label="Дата" />
        <button className="btn icon" onClick={() => shift(1)} disabled={date >= today()} aria-label="Следващ ден"><Icon name="back" style={{ transform: 'scaleX(-1)' }} /></button>
      </div>
      {r && (<>
        <div className="kpis">
          <div className="kpi"><small>Оборот</small><b>{eur(r.total)}</b><span>{r.count} бележки</span></div>
          <div className="kpi"><small>Среден бон</small><b>{eur(avg)}</b></div>
          <div className="kpi"><small>В брой</small><b>{eur(r.cash)}</b><span>в касата</span></div>
          <div className="kpi"><small>С карта</small><b>{eur(r.card)}</b></div>
          <div className="kpi"><small>Брутна печалба</small><b>{eur(profit)}</b><span>оборот без ДДС − себестойност</span></div>
          {r.openOrders > 0 && <div className="kpi"><small>Отворени сметки</small><b>{r.openOrders}</b><span>{eur(r.openTotal)}</span></div>}
          {r.lowStock > 0 && <div className="kpi"><small>Под минимума</small><b style={{ color: 'var(--warn)' }}>{r.lowStock}</b><span>артикула в склада</span></div>}
        </div>
        <div className="two" style={{ marginBottom: 16 }}>
          <div className="card">
            <h3>Оборот по часове</h3>
            <div className="bars">
              {hours.map((h) => {
                const v = r.byHour.find((x) => x.hour === h)?.total || 0;
                return <div key={h} className={`b ${v ? '' : 'zero'}`} title={`${h}:00 · ${eur(v)}`}><i style={{ height: `${(v / maxH) * 100}%` }} /><span>{h}</span></div>;
              })}
            </div>
          </div>
          <div className="card">
            <h3>Най-продавани</h3>
            {r.top.length ? r.top.map((t, i) => (
              <div key={t.product_id} style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5 }}>
                  <span><span className="mute num">{i + 1}.</span> {t.name} <span className="mute">× {fq(t.qty)}</span></span><span className="num">{eur(t.total)}</span>
                </div>
                <div className="meter"><i style={{ width: `${(t.total / r.top[0].total) * 100}%` }} /></div>
              </div>
            )) : <p className="mute" style={{ margin: 0 }}>Няма продажби за деня.</p>}
          </div>
        </div>
        <div className="two" style={{ marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 15, margin: '4px 0 12px' }}>Бележки</h3>
            {orders.length ? (
              <div className="tbl-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
                <table className="tbl">
                  <thead><tr><th>№</th><th>Час</th><th>Касиер</th><th>Плащане</th><th className="r">Сума</th></tr></thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.uid} className="click" onClick={() => setView(o)} style={o.status === 'void' ? { opacity: 0.5 } : undefined}>
                        <td className="num name">{o.number}</td><td className="num">{fmtTime(o.closed_at)}</td><td>{o.user_name}</td>
                        <td>{o.status === 'void' ? <span className="pill bad">сторно</span> : o.payment === 'card' ? 'Карта' : 'В брой'}</td>
                        <td className="r">{eur(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="card"><Empty icon="doc" title="Няма бележки за деня" /></div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <h3>По служители</h3>
              {r.byUser.length ? r.byUser.map((u) => (
                <div key={u.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14 }}><span>{u.name} <span className="mute">· {u.count}</span></span><span className="num">{eur(u.total)}</span></div>
              )) : <p className="mute" style={{ margin: 0 }}>—</p>}
            </div>
            <div className="card">
              <h3>ДДС по групи</h3>
              {r.vat.length ? r.vat.map((v) => (
                <div key={v.vat_group} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14 }}><span>Група {v.vat_group} <span className="mute">· оборот {eur(v.total)}</span></span><span className="num">{eur(v.vat)}</span></div>
              )) : <p className="mute" style={{ margin: 0 }}>—</p>}
            </div>
          </div>
        </div>
      </>)}
      {view && (
        <Modal title={`Бележка № ${view.number}`} onClose={() => { setView(null); setConfirm(false); }} footer={view.status === 'paid' ? (confirm
          ? <><span className="mute" style={{ marginRight: 'auto' }}>Сторно връща артикулите в склада.</span><button className="btn" onClick={() => setConfirm(false)}>Не</button><button className="btn danger" onClick={voidOrder}>Да, сторнирай</button></>
          : <button className="btn ghost" onClick={() => setConfirm(true)}><Icon name="undo" />Сторнирай</button>) : null}>
          <div className="mute" style={{ fontSize: 13 }}>{fmtTime(view.closed_at)} · {view.user_name}{view.table_name ? ` · ${view.table_name}` : ''} · {view.payment === 'card' ? 'карта' : 'в брой'}{view.status === 'void' ? ' · СТОРНИРАНА' : ''}</div>
          <table className="tbl">
            <tbody>
              {view.lines.map((l, i) => <tr key={i}><td>{l.name}</td><td className="r mute">{fq(l.qty)} × {money(l.price)}</td><td className="r">{eur(l.qty * l.price)}</td></tr>)}
              <tr><td className="name">Общо</td><td /><td className="r name">{eur(view.total)}</td></tr>
              {view.tendered ? <tr><td className="mute">Получени / ресто</td><td /><td className="r mute">{money(view.tendered)} / {money(view.tendered - view.total)}</td></tr> : null}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}
