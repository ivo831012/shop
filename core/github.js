// Синхронизация с частно хранилище в GitHub.
// Всяко устройство пише само свои файлове: ops/<устройство>/<ден>.json.
// Така две устройства никога не пишат в един и същ файл и няма конфликти.

const API = 'https://api.github.com';
const b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

export class SyncError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function explain(status, text) {
  if (status === 401) return 'Ключът за достъп е невалиден или е изтекъл';
  if (status === 403 && /rate limit/i.test(text)) return 'GitHub временно ограничи заявките. Ще опитаме пак след малко';
  if (status === 403) return 'Ключът няма право да пише в хранилището';
  if (status === 404) return 'Хранилището не е намерено или ключът няма достъп до него';
  return `GitHub отговори с грешка ${status}`;
}

export function createGitHub({ owner, repo, token, fetchImpl = globalThis.fetch }) {
  const base = `${API}/repos/${owner}/${repo}`;
  const req = async (path, { method = 'GET', body, etag } = {}) => {
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          ...(etag ? { 'if-none-match': etag } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new SyncError('Няма интернет', 0);
    }
    if (res.status === 304) return { status: 304 };
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) return { status: res.status, error: data?.message || text };
    return { status: res.status, data, etag: res.headers.get('etag') };
  };
  const must = (r) => { if (r.error !== undefined) throw new SyncError(explain(r.status, r.error), r.status); return r; };

  return {
    async info() {
      const r = must(await req(''));
      return { private: r.data.private, branch: r.data.default_branch || 'main', canPush: !!r.data.permissions?.push, fullName: r.data.full_name };
    },
    /** Хешът на последния commit; null при празно хранилище; 'same' ако нищо не е променено. */
    async head(branch, etag) {
      const r = await req(`/git/ref/heads/${branch}`, { etag });
      if (r.status === 304) return { same: true };
      if (r.status === 409 || r.status === 404) return { sha: null };
      must(r);
      return { sha: r.data.object.sha, etag: r.etag };
    },
    async tree(sha) {
      const r = must(await req(`/git/trees/${sha}?recursive=1`));
      return r.data.tree.filter((x) => x.type === 'blob').map((x) => ({ path: x.path, sha: x.sha }));
    },
    async blob(sha) {
      const r = must(await req(`/git/blobs/${sha}`));
      return b64decode(r.data.content);
    },
    /** Записва файл. Връща новия sha на файла. */
    async put(path, content, sha, branch, message) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await req(`/contents/${path}`, { method: 'PUT', body: { message, content: b64encode(content), branch, ...(sha ? { sha } : {}) } });
        if (!r.error) return r.data.content.sha;
        if (r.status === 409 || r.status === 422) {
          // друго устройство е записало точно сега, или нямаме актуалния sha на файла
          const cur = await req(`/contents/${path}?ref=${branch}`);
          sha = cur.data?.sha;
          await new Promise((ok) => setTimeout(ok, 400 * (attempt + 1)));
          continue;
        }
        must(r);
      }
      throw new SyncError('GitHub не прие записа. Ще опитаме пак', 409);
    },
  };
}

/**
 * Една синхронизация: изтегля новите операции на другите устройства и качва своите.
 * state се пази между пусканията: { etag, shas: { path: sha }, pushed: { path: брой } }.
 */
export async function syncOnce({ gh, engine, branch, state, deviceName = '' }) {
  let pulled = 0, pushed = 0;
  const head = await gh.head(branch, state.etag);
  if (!head.same && head.sha) {
    const files = await gh.tree(head.sha);
    for (const f of files) {
      if (!f.path.startsWith('ops/') || !f.path.endsWith('.json')) continue;
      const mine = f.path.startsWith(`ops/${engine.deviceId}/`);
      if (state.shas[f.path] === f.sha) continue;
      if (!mine) {
        const ops = JSON.parse(await gh.blob(f.sha));
        pulled += await engine.merge(ops);
      }
      state.shas[f.path] = f.sha;
    }
    state.etag = head.etag;
  }
  for (const [path, ops] of engine.ownFiles()) {
    if ((state.pushed[path] || 0) >= ops.length) continue;
    state.shas[path] = await gh.put(path, JSON.stringify(ops), state.shas[path], branch, `${deviceName || engine.code}: ${ops.length} операции`);
    pushed += ops.length - (state.pushed[path] || 0);
    state.pushed[path] = ops.length;
    state.etag = null; // нашият запис промени хранилището
  }
  return { pulled, pushed };
}
