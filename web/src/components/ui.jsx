import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { eur, qty as fq } from '../lib/format.js';
import { getStatus, onStatus, getConfig } from '../lib/device.js';

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'err' ? 4200 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}><i><Icon name={t.kind === 'err' ? 'x' : 'check'} stroke={2.6} /></i>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function useEsc(onClose) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEsc(onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><h2>{title}</h2>{onClose && <button className="btn ghost icon" onClick={onClose} aria-label="Затвори"><Icon name="x" /></button>}</div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, footer }) {
  useEsc(onClose);
  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><h2>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label="Затвори"><Icon name="x" /></button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, style }) {
  return <div className="field" style={style}><label>{label}</label>{children}{hint && <span className="hint">{hint}</span>}</div>;
}

export function Thumb({ p, cats }) {
  const c = cats?.find((x) => x.id === p.category_id);
  return (
    <div className="thumb" style={{ '--c': `var(--cat-${c?.color || 'stone'})` }}>
      {p.image ? <img src={p.image} alt="" /> : <Icon name={c?.icon || 'box'} />}
    </div>
  );
}

/** Състояние на синхронизацията на устройството. */
export function SyncBadge() {
  const [s, setS] = useState(getStatus);
  useEffect(() => onStatus(setS), []);
  const cfg = getConfig();
  if (!cfg?.owner) return <span className="net off" style={{ color: 'var(--mute)' }}><i />само на устройството</span>;
  const text = { idle: 'свързва…', syncing: 'синхронизира…', ok: s.pending ? `чака ${s.pending}` : 'синхронизирано', offline: 'офлайн', error: 'грешка при синхронизация' }[s.state];
  return <span className={`net ${s.state === 'ok' || s.state === 'syncing' || s.state === 'idle' ? '' : 'off'}`} title={s.message || ''}><i />{text}</span>;
}

/** Презарежда данни, когато дойдат промени от други устройства. */
export function useDataRefresh(fn) {
  useEffect(() => {
    window.addEventListener('shop:data', fn);
    return () => window.removeEventListener('shop:data', fn);
  }, [fn]);
}

export function Empty({ icon = 'box', title, children }) {
  return <div className="empty"><Icon name={icon} /><b>{title}</b>{children}</div>;
}

/** Търсене на артикул по име, код или баркод. Enter избира първия; баркод избира точното съвпадение. */
export function ProductPicker({ products, onPick, placeholder = 'Артикул: име или баркод', autoFocus, showPrice = 'cost' }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const ref = useRef();
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const exact = products.filter((p) => p.barcode === s || p.code?.toLowerCase() === s);
    if (exact.length) return exact;
    return products.filter((p) => p.name.toLowerCase().includes(s)).slice(0, 30);
  }, [q, products]);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const pick = (p) => { onPick(p); setQ(''); setOpen(false); setIdx(0); };
  return (
    <div className="combo" ref={ref}>
      <div className="search" style={{ maxWidth: 'none' }}>
        <Icon name="search" />
        <input className="input" value={q} placeholder={placeholder} autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setIdx(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, list.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            if (e.key === 'Enter' && list[idx]) { e.preventDefault(); pick(list[idx]); }
          }} />
      </div>
      {open && list.length > 0 && (
        <div className="combo-list">
          {list.map((p, i) => (
            <button key={p.id} className={i === idx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
              <span>{p.name}</span>
              <small>{showPrice === 'cost' ? `${fq(p.stock)} ${p.unit}` : eur(p.price)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
