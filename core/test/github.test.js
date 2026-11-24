import { test } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { createHash } from 'node:crypto';
import { createEngine } from '../engine.js';
import { createGitHub, syncOnce } from '../github.js';

const SQL = await initSqlJs();
const memStore = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => m.set(k, v), keys: async () => [...m.keys()] }; };

// Малък заместител на GitHub API: файлове в паметта, всеки запис е нов commit.
function fakeGitHub() {
  const files = new Map();
  let commit = null, n = 0, calls = 0;
  const sha = (s) => createHash('sha1').update(s).digest('hex');
  const json = (status, data, headers = {}) => new Response(data === undefined ? null : JSON.stringify(data), { status, headers });
  const fetchImpl = async (url, opt = {}) => {
    calls++;
    const u = new URL(url);
    const p = u.pathname.replace('/repos/o/r', '');
    if (p === '') return json(200, { private: true, default_branch: 'main', permissions: { push: true }, full_name: 'o/r' });
    if (p === '/git/ref/heads/main') {
      if (!commit) return json(409, { message: 'Git Repository is empty.' });
      if (opt.headers['if-none-match'] === `"${commit}"`) return new Response(null, { status: 304 });
      return json(200, { object: { sha: commit } }, { etag: `"${commit}"` });
    }
    if (p.startsWith('/git/trees/')) return json(200, { tree: [...files].map(([path, f]) => ({ path, sha: f.sha, type: 'blob' })) });
    if (p.startsWith('/git/blobs/')) {
      const f = [...files.values()].find((x) => x.sha === p.split('/').pop());
      return json(200, { content: Buffer.from(f.content).toString('base64') });
    }
    if (p.startsWith('/contents/')) {
      const path = decodeURIComponent(p.slice('/contents/'.length));
      if (opt.method === 'PUT') {
        const body = JSON.parse(opt.body);
        const cur = files.get(path);
        if (cur && cur.sha !== body.sha) return json(409, { message: 'does not match' });
        const content = Buffer.from(body.content, 'base64').toString();
        const s = sha(content);
        files.set(path, { content, sha: s });
        commit = sha(String(++n));
        return json(200, { content: { sha: s } });
      }
      const cur = files.get(path);
      return cur ? json(200, { sha: cur.sha }) : json(404, { message: 'Not Found' });
    }
    return json(404, { message: 'unknown ' + p });
  };
  return { fetchImpl, files, calls: () => calls };
}

test('синхронизация през GitHub между две устройства', async () => {
  let t = 1_800_000_000_000;
  const clock = () => (t += 1000);
  const remote = fakeGitHub();
  const gh = createGitHub({ owner: 'o', repo: 'r', token: 'x', fetchImpl: remote.fetchImpl });
  assert.equal((await gh.info()).branch, 'main');

  const A = await createEngine({ SQL, store: memStore(), deviceId: 'aaaa', clock });
  const B = await createEngine({ SQL, store: memStore(), deviceId: 'bbbb', clock });
  const sa = { shas: {}, pushed: {} }, sb = { shas: {}, pushed: {} };

  assert.deepEqual(await syncOnce({ gh, engine: A, branch: 'main', state: sa }), { pulled: 0, pushed: 0 });
  const admin = await A.request('POST', '/users', { name: 'Админ', role: 'admin', pin: '0000' }, null);
  const p = await A.request('POST', '/products', { name: 'Вода', price: 1.2, barcode: '111' }, admin);
  assert.equal((await syncOnce({ gh, engine: A, branch: 'main', state: sa })).pushed, 2);

  assert.equal((await syncOnce({ gh, engine: B, branch: 'main', state: sb })).pulled, 2);
  const u = await B.login(admin.id, '0000');
  await B.request('POST', '/orders/pay', { uid: 'x1', payment: 'cash', lines: [{ product_id: p.id, qty: 2, price: 1.2 }] }, u);
  await syncOnce({ gh, engine: B, branch: 'main', state: sb });
  assert.equal((await syncOnce({ gh, engine: A, branch: 'main', state: sa })).pulled, 1);
  const r = await A.request('GET', '/reports/day?date=' + new Date(t).toLocaleDateString('sv-SE'), null, admin);
  assert.equal(r.total, 2.4);

  // без промени: само една евтина проверка (304)
  const before = remote.calls();
  await syncOnce({ gh, engine: A, branch: 'main', state: sa });
  await syncOnce({ gh, engine: A, branch: 'main', state: sa });
  assert.ok(remote.calls() - before <= 3);
  assert.ok([...remote.files.keys()].every((k) => /^ops\/(aaaa|bbbb)\/\d{4}-\d\d-\d\d\.json$/.test(k)));
});
