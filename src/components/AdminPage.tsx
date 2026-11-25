import { useEffect, useState, type FormEvent } from 'react';
import {
  addUser, changeOwnPassword, listUsers, removeUser, resetPassword, uploadExtraProducts, uploadMidsummer, uploadTemplate, type User,
} from '../api';
import { ConfirmButton } from './ConfirmButton';

/** Team logins and the private data files (admins); own password (everyone). */
export function AdminPage({ me, onDataChanged }: { me: User; onDataChanged: () => void }) {
  const isAdmin = me.role === 'admin';
  const [users, setUsers] = useState<User[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', role: 'staff' as User['role'], password: '' });
  const [pw, setPw] = useState({ current: '', password: '' });
  const [resetFor, setResetFor] = useState<{ id: string; password: string } | null>(null);

  const refresh = () => { if (isAdmin) listUsers().then(setUsers).catch((e) => setError(e.message)); };
  useEffect(refresh, [isAdmin]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(ok);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const fileInput = (label: string, accept: string, fn: (f: File) => Promise<unknown>, done: (r: never) => string) => (
    <label className="upload-row">
      <span>{label}</span>
      <input type="file" accept={accept} onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setError('');
        setNotice('Uploading…');
        try {
          const r = await fn(f);
          setNotice(done(r as never));
          onDataChanged();
        } catch (err) {
          setNotice('');
          setError((err as Error).message);
        }
      }} />
    </label>
  );

  return (
    <main className="admin">
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {isAdmin && (
        <section className="card">
          <h2>Team</h2>
          <div className="scroll-x">
            <table className="lines team">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}{u.id === me.id ? ' (you)' : ''}</td>
                    <td>{u.email}</td>
                    <td>{u.role === 'admin' ? 'Admin' : 'Staff'}</td>
                    <td className="n"><div className="actions">
                      {resetFor?.id === u.id ? (
                        <form className="inline" onSubmit={(e) => { e.preventDefault(); run(() => resetPassword(u.id, resetFor.password), `New password set for ${u.name}.`).then(() => setResetFor(null)); }}>
                          <input type="text" placeholder="New password" aria-label="New password" value={resetFor.password} minLength={10}
                            onChange={(e) => setResetFor({ id: u.id, password: e.target.value })} />
                          <button className="link" type="submit">Save</button>
                          <button className="link" type="button" onClick={() => setResetFor(null)}>Cancel</button>
                        </form>
                      ) : (
                        <>
                          {u.id !== me.id && <button className="link" onClick={() => setResetFor({ id: u.id, password: '' })}>Set password</button>}
                          {u.id !== me.id && <ConfirmButton label="Remove" confirmLabel="Click again to remove" onConfirm={() => run(() => removeUser(u.id), `${u.name} removed.`)} />}
                        </>
                      )}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Add a team member</h3>
          <form className="grid" onSubmit={(e: FormEvent) => {
            e.preventDefault();
            run(() => addUser(form), `${form.name} can now sign in with ${form.email}. Give them the password you set; they can change it on this page.`)
              .then(() => setForm({ name: '', email: '', role: 'staff', password: '' }));
          }}>
            <label htmlFor="add-name">Name<input id="add-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label htmlFor="add-email">Email<input id="add-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
            <label htmlFor="add-role">Role
              <select id="add-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}>
                <option value="staff">Staff (quotes only)</option>
                <option value="admin">Admin (team and data too)</option>
              </select>
            </label>
            <label htmlFor="add-password">Temporary password<input id="add-password" type="text" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
            <div><button type="submit" className="primary">Add</button></div>
          </form>
        </section>
      )}

      {isAdmin && (
        <section className="card">
          <h2>Data files</h2>
          <p className="muted small">These are stored on the server only, never in GitHub.</p>
          {fileInput('Midsummer trade price sheet (.xlsx)', '.xlsx', uploadMidsummer,
            (r: { priceDate?: string; panels: number; inverters: number; batteries: number; bundles: number }) =>
              `Midsummer prices${r.priceDate ? ` dated ${r.priceDate}` : ''} loaded: ${r.panels} panels, ${r.inverters} inverters, ${r.batteries} batteries, ${r.bundles} bundle options.`)}
          {fileInput('Quotation template (prepared PDF)', 'application/pdf', uploadTemplate, () => 'Quotation template saved.')}
          {fileInput('Extra products (.json)', 'application/json,.json', uploadExtraProducts, (r: { products: number }) => `${r.products} extra products loaded.`)}
        </section>
      )}

      <section className="card">
        <h2>Change your password</h2>
        <form className="grid" onSubmit={(e: FormEvent) => {
          e.preventDefault();
          run(() => changeOwnPassword(pw.current, pw.password), 'Your password has been changed.').then(() => setPw({ current: '', password: '' }));
        }}>
          <label htmlFor="pw-current">Current password<input id="pw-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></label>
          <label htmlFor="pw-new">New password<input id="pw-new" type="password" autoComplete="new-password" minLength={10} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} required /></label>
          <div><button type="submit" className="primary">Change password</button></div>
        </form>
      </section>
    </main>
  );
}
