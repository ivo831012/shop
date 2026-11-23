import { useCallback, useEffect, useState } from 'react';
import { api, auth } from './lib/api.js';
import { initials, ROLE } from './lib/format.js';
import Icon from './components/Icon.jsx';
import Login from './pages/Login.jsx';
import Pos from './pages/Pos.jsx';
import Stock from './pages/Stock.jsx';
import Products from './pages/Products.jsx';
import Reports from './pages/Reports.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';

const PAGES = [
  { id: 'pos', label: 'Каса', icon: 'pos', roles: ['admin', 'manager', 'cashier'], C: Pos },
  { id: 'stock', label: 'Склад', icon: 'stock', roles: ['admin', 'manager', 'stock'], C: Stock },
  { id: 'items', label: 'Артикули', icon: 'items', roles: ['admin', 'manager', 'stock'], C: Products },
  { id: 'reports', label: 'Отчети', icon: 'chart', roles: ['admin', 'manager'], C: Reports },
  { id: 'users', label: 'Хора', icon: 'users', roles: ['admin'], C: Users },
  { id: 'settings', label: 'Настройки', icon: 'settings', roles: ['admin'], C: Settings },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState(() => location.hash.slice(1) || 'pos');

  useEffect(() => {
    if (!auth.token) return setReady(true);
    api('/me').then((r) => setUser(r.user)).catch((e) => {
      // без връзка: пазим последния потребител, за да може касата да работи офлайн
      if (!e.status) { try { setUser(JSON.parse(localStorage.getItem('shop.user'))); } catch {} }
    }).finally(() => setReady(true));
  }, []);

  const logout = useCallback(() => {
    api('/logout', { method: 'POST' }).catch(() => {});
    auth.set(null);
    try { localStorage.removeItem('shop.user'); } catch {}
    setUser(null);
  }, []);
  useEffect(() => {
    const h = () => { auth.set(null); setUser(null); };
    window.addEventListener('shop:logout', h);
    return () => window.removeEventListener('shop:logout', h);
  }, []);
  useEffect(() => {
    const h = () => setPage(location.hash.slice(1) || 'pos');
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  if (!ready) return null;
  if (!user) return <Login onLogin={(u) => { setUser(u); try { localStorage.setItem('shop.user', JSON.stringify(u)); } catch {} }} />;

  const allowed = PAGES.filter((p) => p.roles.includes(user.role));
  const cur = allowed.find((p) => p.id === page) || allowed[0];
  const go = (id) => { location.hash = id; setPage(id); };

  return (
    <div className="shell">
      <nav className="rail" aria-label="Меню">
        <div className="logo"><Icon name="pos" stroke={2} /></div>
        {allowed.map((p) => (
          <button key={p.id} className={`nav-btn ${p.id === cur.id ? 'on' : ''}`} onClick={() => go(p.id)} aria-current={p.id === cur.id}>
            <Icon name={p.icon} />{p.label}
          </button>
        ))}
        <div className="grow" />
        <button className="avatar" title={`${user.name} · ${ROLE[user.role]}. Натиснете за изход`} onClick={logout} aria-label="Изход">{initials(user.name)}</button>
      </nav>
      <main className="content"><cur.C user={user} go={go} logout={logout} /></main>
    </div>
  );
}
