import { useState } from 'react';
import { saveConfig, startEngine, syncNow, getStatus, createGitHub } from '../lib/device.js';
import { seedDemo } from '../../../core/seed.js';
import Icon from '../components/Icon.jsx';
import { Field } from '../components/ui.jsx';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export default function Connect({ onReady }) {
  const [step, setStep] = useState('choose'); // choose | github | first
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState('');
  const [admin, setAdmin] = useState({ name: '', pin: '', demo: true });

  const connect = async () => {
    setErr(''); setWarn('');
    const m = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').split('/');
    if (m.length !== 2 || !m[0] || !m[1]) return setErr('Въведете хранилището във вида потребител/име, напр. ivan/shop-data');
    setBusy(true);
    try {
      const gh = createGitHub({ owner: m[0], repo: m[1], token: token.trim() });
      const info = await gh.info();
      if (!info.canPush) throw new Error('Ключът няма право да пише в хранилището. Дайте му „Contents: Read and write“.');
      const cfg = { owner: m[0], repo: m[1], token: token.trim(), branch: info.branch, deviceId: crypto.randomUUID(), deviceName: name.trim() || 'Устройство' };
      saveConfig(cfg);
      const engine = await startEngine(cfg);
      await syncNow();
      if (getStatus().state === 'error') throw new Error(getStatus().message);
      if (!info.private) setWarn('Хранилището е публично и всеки може да види данните. Направете го частно от Settings → General → Danger Zone в GitHub.');
      if (engine.isEmpty()) setStep('first'); else onReady();
    } catch (e) {
      setErr(e.message);
      try { localStorage.removeItem('shop.device'); } catch {}
    } finally { setBusy(false); }
  };

  const tryLocal = async () => {
    setBusy(true);
    const cfg = { local: true, deviceId: crypto.randomUUID(), deviceName: 'Пробно устройство' };
    saveConfig(cfg);
    const engine = await startEngine(cfg);
    const a = await engine.request('POST', '/users', { name: 'Администратор', role: 'admin', pin: '0000' }, null);
    await seedDemo((m, p, b) => engine.request(m, p, b, a));
    setBusy(false);
    onReady();
  };

  const createAdmin = async () => {
    setErr('');
    if (!admin.name.trim()) return setErr('Въведете име');
    if (!/^\d{4,8}$/.test(admin.pin)) return setErr('ПИН кодът трябва да е от 4 до 8 цифри');
    setBusy(true);
    try {
      const engine = await startEngine();
      const a = await engine.request('POST', '/users', { name: admin.name.trim(), role: 'admin', pin: admin.pin }, null);
      if (admin.demo) await seedDemo((m, p, b) => engine.request(m, p, b, a));
      await syncNow();
      onReady();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div style={{ width: 'min(560px, 100%)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <span className="pill acc">Каса и склад</span>
          <h1 style={{ fontSize: 28, marginTop: 14 }}>
            {step === 'first' ? 'Първо устройство' : 'Свързване на устройство'}
          </h1>
          <p className="mute" style={{ margin: '6px 0 0', lineHeight: 1.55 }}>
            {step === 'first'
              ? 'Хранилището е празно. Създайте администратора, който ще управлява приложението.'
              : 'Всяко устройство има своя база и работи без интернет. Когато има връзка, данните се синхронизират с вашето частно хранилище в GitHub.'}
          </p>
        </div>

        {step === 'choose' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <button className="person" onClick={() => setStep('github')} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <span className="av" style={{ background: 'var(--acc)', color: '#fff' }}><Icon name="stock" size={20} /></span>
              <span><b>Свържи с GitHub</b><small>За истинска работа. Данните се синхронизират между всички устройства.</small></span>
            </button>
            <button className="person" onClick={tryLocal} disabled={busy} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <span className="av"><Icon name="pos" size={20} /></span>
              <span><b>{busy ? 'Подготвя…' : 'Пробвай с примерни данни'}</b><small>Само на това устройство, без синхронизация. Вход с ПИН 0000.</small></span>
            </button>
          </div>
        )}

        {step === 'github' && (
          <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Хранилище с данните" hint="Частно хранилище, напр. потребител/shop-data">
              <input className="input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="потребител/shop-data" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </Field>
            <Field label="Ключ за достъп (token)">
              <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" />
            </Field>
            <details className="mute" style={{ fontSize: 13, lineHeight: 1.6 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--acc)' }}>Как да създам ключ?</summary>
              <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                <li>Отворете <a href={TOKEN_URL} target="_blank" rel="noreferrer">github.com/settings/personal-access-tokens/new</a></li>
                <li><b>Token name:</b> напр. „Каса 1“. <b>Expiration:</b> до 1 година.</li>
                <li><b>Repository access:</b> Only select repositories → изберете хранилището с данните.</li>
                <li><b>Permissions → Repository permissions → Contents:</b> Read and write.</li>
                <li>Натиснете <b>Generate token</b> и копирайте ключа тук.</li>
              </ol>
            </details>
            <Field label="Име на устройството" hint="Вижда се в историята на синхронизацията">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="напр. Каса 1, Телефон Мария" />
            </Field>
            {err && <div style={{ color: 'var(--bad)', fontWeight: 600, fontSize: 13.5 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setStep('choose')}>Назад</button>
              <button className="btn pri" onClick={connect} disabled={busy || !repo.trim() || !token.trim()}>{busy ? 'Свързване…' : 'Свържи'}</button>
            </div>
          </div>
        )}

        {step === 'first' && (
          <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {warn && <div className="pill warn" style={{ whiteSpace: 'normal', borderRadius: 8, padding: '10px 12px', lineHeight: 1.5 }}>{warn}</div>}
            <Field label="Име на администратора"><input className="input" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} autoFocus /></Field>
            <Field label="ПИН код" hint="От 4 до 8 цифри. С него ще влизате в приложението.">
              <input className="input num" inputMode="numeric" maxLength={8} value={admin.pin} onChange={(e) => setAdmin({ ...admin, pin: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <label className="toggle"><input type="checkbox" checked={admin.demo} onChange={(e) => setAdmin({ ...admin, demo: e.target.checked })} />Добави примерни артикули, маси и служители</label>
            {err && <div style={{ color: 'var(--bad)', fontWeight: 600, fontSize: 13.5 }}>{err}</div>}
            <button className="btn pri big" onClick={createAdmin} disabled={busy}>{busy ? 'Създаване…' : 'Създай и започни'}</button>
          </div>
        )}
        {warn && step !== 'first' && <div className="pill warn" style={{ whiteSpace: 'normal' }}>{warn}</div>}
      </div>
    </div>
  );
}
