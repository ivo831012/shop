import { useEffect, useState } from 'react';
import { api, STANDALONE } from '../lib/api.js';
import { getConfig, getStatus, onStatus, syncNow, resetDevice } from '../lib/device.js';
import { fmtTime } from '../lib/format.js';
import Icon from '../components/Icon.jsx';
import { Field, useToast } from '../components/ui.jsx';

const MODES = [['shop', 'Магазин'], ['restaurant', 'Заведение'], ['both', 'И двете']];

export default function Settings({ logout }) {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [tables, setTables] = useState([]);
  const [tName, setTName] = useState('');
  const [tZone, setTZone] = useState('Зала');
  const loadTables = () => api('/tables').then(setTables);
  useEffect(() => { api('/settings').then(setS).catch((e) => toast(e.message, 'err')); loadTables(); }, []);
  if (!s) return null;
  const set = (k) => (e) => setS({ ...s, [k]: e.target ? e.target.value : e });

  const save = async () => {
    try { setS(await api('/settings', { method: 'PUT', body: s })); toast('Настройките са записани'); } catch (e) { toast(e.message, 'err'); }
  };
  const addTable = async () => {
    try { await api('/tables', { method: 'POST', body: { name: tName, zone: tZone } }); setTName(''); loadTables(); } catch (e) { toast(e.message, 'err'); }
  };
  const delTable = async (t) => { await api(`/tables/${t.id}`, { method: 'DELETE' }); loadTables(); };
  const zones = [...new Set(tables.map((t) => t.zone))];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Настройки</h1><div className="sub">Обект, режим на работа, маси и устройства</div></div>
        <div className="grow" />
        <button className="btn" onClick={logout}><Icon name="logout" />Изход</button>
        <button className="btn pri" onClick={save}><Icon name="check" />Запиши</button>
      </div>
      <div className="two">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <h3>Обект</h3>
            <div className="grid2">
              <Field label="Име на обекта"><input className="input" value={s.company_name} onChange={set('company_name')} /></Field>
              <Field label="ЕИК"><input className="input num" value={s.company_eik} onChange={set('company_eik')} /></Field>
              <Field label="Адрес" style={{ gridColumn: '1 / -1' }}><input className="input" value={s.company_address} onChange={set('company_address')} /></Field>
              <Field label="Текст в края на бележката" style={{ gridColumn: '1 / -1' }}><input className="input" value={s.receipt_footer} onChange={set('receipt_footer')} /></Field>
            </div>
          </div>
          <div className="card">
            <h3>Режим на работа</h3>
            <div className="seg" style={{ display: 'grid' }}>{MODES.map(([k, v]) => <button key={k} className={s.mode === k ? 'on' : ''} onClick={() => setS({ ...s, mode: k })}>{v}</button>)}</div>
            <p className="mute" style={{ margin: '10px 0 0', fontSize: 13 }}>
              {s.mode === 'shop' ? 'Касата е за бързо маркиране. Масите и отворените сметки са скрити.' : 'В касата има маси и отворени сметки, които се плащат по-късно.'}
            </p>
          </div>
          <div className="card">
            <h3>Устройства</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[['printer', 'Фискален принтер Елтрейд', 'Свързва се в следващия етап. Дотогава продажбите се записват без касов бон.'],
                ['card', 'Банков ПОС терминал', 'Свързва се в следващия етап. Дотогава плащането с карта се потвърждава ръчно.'],
                ['barcode', 'Баркод скенер', 'Работи веднага. Всеки USB или Bluetooth скенер, който „пише“ като клавиатура.']].map(([ic, t, d], i) => (
                <div key={t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div className="thumb" style={{ background: 'var(--panel)' }}><Icon name={ic} /></div>
                  <div style={{ flex: 1 }}><div className="name" style={{ fontWeight: 600 }}>{t}</div><div className="mute" style={{ fontSize: 13 }}>{d}</div></div>
                  <span className={`pill ${i === 2 ? 'ok' : 'warn'}`}>{i === 2 ? 'готов' : 'предстои'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {STANDALONE && <DeviceCard />}
        <div className="card">
          <h3>Маси <span className="mute" style={{ fontWeight: 500, fontSize: 13 }}>{tables.length}</span></h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 2, minWidth: 120 }} placeholder="Име, напр. Маса 9" value={tName} onChange={(e) => setTName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tName.trim() && addTable()} />
            <input className="input" style={{ flex: 1, minWidth: 90 }} placeholder="Зона" value={tZone} onChange={(e) => setTZone(e.target.value)} list="zones" />
            <datalist id="zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
            <button className="btn pri" onClick={addTable} disabled={!tName.trim()}><Icon name="plus" />Добави</button>
          </div>
          {zones.map((z) => (
            <div key={z} style={{ marginBottom: 12 }}>
              <div className="zone" style={{ marginBottom: 8 }}>{z}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tables.filter((t) => t.zone === z).map((t) => (
                  <span key={t.id} className="chip" style={{ paddingRight: 6 }}>{t.name}
                    <button className="btn ghost icon" style={{ padding: 3 }} onClick={() => delTable(t)} aria-label={`Изтрий ${t.name}`}><Icon name="x" size={14} /></button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}

function DeviceCard() {
  const cfg = getConfig() || {};
  const [s, setS] = useState(getStatus);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => onStatus(setS), []);
  const row = (k, v) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, padding: '5px 0' }}><span className="mute">{k}</span><span style={{ textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span></div>;
  return (
    <div className="card">
      <h3>Това устройство</h3>
      {row('Име', cfg.deviceName || '—')}
      {cfg.owner ? <>
        {row('Хранилище', `${cfg.owner}/${cfg.repo}`)}
        {row('Синхронизация', s.state === 'ok' ? `успешна в ${fmtTime(new Date(s.at).toISOString().replace('T', ' ').slice(0, 19))}` : s.state === 'syncing' ? 'в момента…' : s.message || '—')}
        {row('Неизпратени операции', s.pending || 0)}
      </> : row('Синхронизация', 'няма, само на това устройство')}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {cfg.owner && <button className="btn sm" onClick={syncNow}><Icon name="undo" />Синхронизирай сега</button>}
        {confirm
          ? <><button className="btn danger sm" onClick={resetDevice}>Да, изключи</button><button className="btn ghost sm" onClick={() => setConfirm(false)}>Не</button></>
          : <button className="btn ghost sm" onClick={() => setConfirm(true)}>Изключи устройството</button>}
      </div>
      {confirm && <p className="mute" style={{ fontSize: 12.5, margin: '10px 0 0' }}>{cfg.owner ? `Базата на това устройство ще се изтрие. Данните в GitHub остават${s.pending ? `, но ${s.pending} неизпратени операции ще се загубят` : ''}.` : 'Всички данни на това устройство ще се изтрият.'}</p>}
    </div>
  );
}
