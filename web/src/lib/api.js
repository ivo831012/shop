// Връзка със сървъра + локален кеш, за да работи касата и без интернет.
import { get, set } from 'idb-keyval';

let token = null;
try { token = localStorage.getItem('shop.token'); } catch {}

export const auth = {
  get token() { return token; },
  set(t) { token = t; try { t ? localStorage.setItem('shop.token', t) : localStorage.removeItem('shop.token'); } catch {} },
};

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Няма връзка със сървъра', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('shop:logout'));
    throw new ApiError(data.error || 'Възникна грешка', res.status);
  }
  return data;
}

// ---------- каталог за касата ----------
export async function loadCatalog() {
  try {
    const c = await api('/catalog');
    await set('catalog', c).catch(() => {});
    return { ...c, offline: false };
  } catch (e) {
    if (e.status) throw e;
    const cached = await get('catalog').catch(() => null);
    if (cached) return { ...cached, offline: true };
    throw e;
  }
}

// ---------- офлайн опашка с продажби ----------
const listeners = new Set();
export const onQueue = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (n) => listeners.forEach((f) => f(n));

export async function queued() { return (await get('sales-queue').catch(() => null)) || []; }

export async function paySale(sale) {
  try {
    return { ...(await api('/orders/pay', { method: 'POST', body: sale })), offline: false };
  } catch (e) {
    if (e.status) throw e; // истинска грешка от сървъра
    const q = await queued();
    q.push(sale);
    await set('sales-queue', q);
    emit(q.length);
    return { ...sale, total: sale.lines.reduce((s, l) => s + l.qty * l.price, 0), offline: true };
  }
}

let flushing = false;
export async function flushQueue() {
  if (flushing) return;
  const q = await queued();
  if (!q.length) return emit(0);
  flushing = true;
  try {
    const { results } = await api('/orders/sync', { method: 'POST', body: { sales: q } });
    const sent = new Set(results.filter((r) => r.ok).map((r) => r.uid));
    const rest = (await queued()).filter((s) => !sent.has(s.uid));
    await set('sales-queue', rest);
    emit(rest.length);
  } catch {
    emit(q.length);
  } finally {
    flushing = false;
  }
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
