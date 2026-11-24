// Устройството: собствена база в браузъра + синхронизация с GitHub.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { createStore, get, set, keys, clear } from 'idb-keyval';
import { createEngine } from '../../../core/engine.js';
import { createGitHub, syncOnce } from '../../../core/github.js';

const CFG_KEY = 'shop.device';
const idb = createStore('shop-device', 'kv');
const store = { get: (k) => get(k, idb), set: (k, v) => set(k, v, idb), keys: () => keys(idb) };

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)); } catch { return null; }
}
export function saveConfig(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {}
}

let engine = null;
let loading = null;
export const getEngine = () => engine;

export async function startEngine(cfg = getConfig()) {
  if (engine) return engine;
  if (loading) return loading;
  loading = (async () => {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    engine = await createEngine({ SQL, store, deviceId: cfg.deviceId });
    engine.on((what) => {
      if (what === 'remote') window.dispatchEvent(new Event('shop:data'));
      if (what === 'local') scheduleSync(2500);
    });
    if (cfg.owner) startSyncLoop();
    return engine;
  })();
  return loading;
}

// ---------- синхронизация ----------
let status = { state: 'idle', at: null, message: '', pending: 0 };
const statusListeners = new Set();
export const getStatus = () => status;
export const onStatus = (fn) => { statusListeners.add(fn); return () => statusListeners.delete(fn); };
const setStatus = (s) => { status = { ...status, ...s }; statusListeners.forEach((f) => f(status)); };

let timer = null, running = false, again = false;
const pendingCount = async () => {
  const st = (await store.get('sync-state')) || { pushed: {} };
  return engine ? engine.ownFiles().reduce((n, [p, ops]) => n + Math.max(0, ops.length - (st.pushed[p] || 0)), 0) : 0;
};

export async function syncNow() {
  const cfg = getConfig();
  if (!engine || !cfg?.owner) return;
  if (running) { again = true; return; }
  running = true;
  setStatus({ state: 'syncing' });
  try {
    const gh = createGitHub({ owner: cfg.owner, repo: cfg.repo, token: cfg.token });
    const state = (await store.get('sync-state')) || { shas: {}, pushed: {} };
    const r = await syncOnce({ gh, engine, branch: cfg.branch || 'main', state, deviceName: cfg.deviceName });
    await store.set('sync-state', state);
    setStatus({ state: 'ok', at: Date.now(), message: '', pending: await pendingCount(), last: r });
  } catch (e) {
    setStatus({ state: e.status === 0 ? 'offline' : 'error', message: e.message, pending: await pendingCount() });
  } finally {
    running = false;
    if (again) { again = false; scheduleSync(500); }
  }
}

function scheduleSync(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().finally(() => scheduleSync(document.hidden ? 120000 : 20000)); }, ms);
}

function startSyncLoop() {
  scheduleSync(300);
  window.addEventListener('online', () => scheduleSync(200));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(300); });
}

/** Изтрива всичко от това устройство (базата и връзката). Данните в GitHub остават. */
export async function resetDevice() {
  await clear(idb);
  try { localStorage.removeItem(CFG_KEY); localStorage.removeItem('shop.user'); localStorage.removeItem('shop.token'); } catch {}
  location.reload();
}

export { createGitHub, syncOnce };
