import { useEffect, useState } from 'react';
import { api, auth } from '../lib/api.js';
import { initials, ROLE } from '../lib/format.js';
import Icon from '../components/Icon.jsx';

export default function Login({ onLogin }) {
  const [users, setUsers] = useState(null);
  const [company, setCompany] = useState('');
  const [sel, setSel] = useState(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/auth/users').then((r) => { setUsers(r.users); setCompany(r.company); if (r.users.length === 1) setSel(r.users[0]); })
      .catch((e) => setErr(e.message));
  }, []);

  const submit = async (p) => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { userId: sel.id, pin: p } });
      auth.set(r.token);
      onLogin(r.user);
    } catch (e) {
      setErr(e.message); setShake(true); setPin('');
      setTimeout(() => setShake(false), 400);
    } finally { setBusy(false); }
  };
  const press = (k) => {
    setErr('');
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    if (k === 'ok') return submit(pin);
    setPin((p) => (p.length < 8 ? p + k : p));
  };
  useEffect(() => {
    const h = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  return (
    <div className="login">
      <div className="login-box">
        <div>
          <span className="pill acc">{company || 'Каса и склад'}</span>
          <h1 style={{ marginTop: 14 }}>Кой работи сега?</h1>
          <p className="mute" style={{ margin: 0 }}>Изберете името си и въведете ПИН кода.</p>
          <div className="people">
            {users?.map((u) => (
              <button key={u.id} className={`person ${sel?.id === u.id ? 'on' : ''}`} onClick={() => { setSel(u); setPin(''); setErr(''); }}>
                <span className="av">{initials(u.name)}</span>
                <span><b>{u.name}</b><small>{ROLE[u.role]}</small></span>
              </button>
            ))}
          </div>
        </div>
        <div className="pad">
          <div style={{ textAlign: 'center', fontWeight: 600 }}>{sel ? sel.name : 'Изберете потребител'}</div>
          <div className={`dots ${shake ? 'shake' : ''}`}>{Array.from({ length: Math.max(4, pin.length) }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
          <div className="keys">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => <button key={k} onClick={() => press(k)} disabled={!sel}>{k}</button>)}
            <button className="fn" onClick={() => press('del')}>Изтрий</button>
            <button onClick={() => press('0')} disabled={!sel}>0</button>
            <button className="fn" style={{ background: 'var(--acc)', color: '#fff' }} onClick={() => press('ok')} disabled={!sel || pin.length < 4} aria-label="Вход"><Icon name="check" size={22} stroke={2.2} /></button>
          </div>
          <div style={{ minHeight: 22, marginTop: 12, textAlign: 'center', color: 'var(--bad)', fontWeight: 600, fontSize: 13 }}>{err}</div>
        </div>
      </div>
    </div>
  );
}
