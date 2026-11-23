import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { initials, ROLE, fmtDate } from '../lib/format.js';
import Icon from '../components/Icon.jsx';
import { Modal, Field, useToast } from '../components/ui.jsx';

const ROLE_HINT = {
  admin: 'Всичко, включително потребители и настройки.',
  manager: 'Каса, склад, артикули, отчети и сторно.',
  cashier: 'Само каса.',
  stock: 'Склад и артикули.',
};

export default function Users({ user: me }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [edit, setEdit] = useState(null);
  const load = () => api('/users').then(setUsers).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      const body = { name: edit.name, role: edit.role, ...(edit.pin ? { pin: edit.pin } : {}), ...(edit.id ? { active: !!edit.active } : {}) };
      if (edit.id) await api(`/users/${edit.id}`, { method: 'PUT', body }); else await api('/users', { method: 'POST', body });
      toast('Потребителят е записан'); setEdit(null); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Потребители</h1><div className="sub">Кой има достъп и до какво. Всеки влиза със свой ПИН код.</div></div>
        <div className="grow" />
        <button className="btn pri" onClick={() => setEdit({ name: '', role: 'cashier', pin: '', active: 1 })}><Icon name="plus" />Нов потребител</button>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Име</th><th>Роля</th><th>Права</th><th>Добавен</th><th>Статус</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="click" onClick={() => setEdit({ ...u, pin: '' })} style={u.active ? undefined : { opacity: 0.55 }}>
                <td><div className="namecell"><div className="thumb" style={{ borderRadius: '50%', background: 'var(--acc-soft)', color: 'var(--acc)', fontWeight: 600, fontSize: 13 }}>{initials(u.name)}</div><span className="name">{u.name}{u.id === me.id ? <span className="mute"> (вие)</span> : ''}</span></div></td>
                <td>{ROLE[u.role]}</td>
                <td className="mute" style={{ fontSize: 13 }}>{ROLE_HINT[u.role]}</td>
                <td className="num mute">{fmtDate(u.created_at)}</td>
                <td><span className={`pill ${u.active ? 'ok' : ''}`}>{u.active ? 'активен' : 'спрян'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? edit.name : 'Нов потребител'} onClose={() => setEdit(null)} footer={<>
          <button className="btn" onClick={() => setEdit(null)}>Откажи</button>
          <button className="btn pri" onClick={save} disabled={!edit.name.trim() || (!edit.id && edit.pin.length < 4)}>Запиши</button>
        </>}>
          <Field label="Име и фамилия"><input className="input" value={edit.name} autoFocus onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Роля" hint={ROLE_HINT[edit.role]}>
            <div className="seg" style={{ display: 'grid' }}>
              {Object.entries(ROLE).map(([k, v]) => <button key={k} className={edit.role === k ? 'on' : ''} onClick={() => setEdit({ ...edit, role: k })} disabled={edit.id === me.id && k !== 'admin'}>{v}</button>)}
            </div>
          </Field>
          <Field label={edit.id ? 'Нов ПИН код' : 'ПИН код'} hint={edit.id ? 'Оставете празно, за да не се сменя.' : 'От 4 до 8 цифри.'}>
            <input className="input num" inputMode="numeric" maxLength={8} value={edit.pin} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '') })} />
          </Field>
          {edit.id && edit.id !== me.id && <label className="toggle"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} />Може да влиза</label>}
        </Modal>
      )}
    </div>
  );
}
