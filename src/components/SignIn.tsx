import { useState, type FormEvent } from 'react';
import { runSetup, signIn, type User } from '../api';

/** Sign-in screen, or the one-time setup of the first admin account. */
export function SignIn({ setupNeeded, onSignedIn }: { setupNeeded: boolean; onSignedIn: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = setupNeeded ? await runSetup({ code: code.trim(), name, email, password }) : await signIn(email, password);
      onSignedIn(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin-wrap">
      <form className="signin card" onSubmit={submit}>
        <div className="brand-mark">Rexperts <span>Quote Builder</span></div>
        <h2>{setupNeeded ? 'Create the admin account' : 'Sign in'}</h2>
        {setupNeeded && (
          <>
            <p className="muted small">This is a one-time step. Use the setup code you were given; afterwards you can add your team from the admin page.</p>
            <label htmlFor="setup-code">Setup code<input id="setup-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required /></label>
            <label htmlFor="setup-name">Your name<input id="setup-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>
          </>
        )}
        <label htmlFor="signin-email">Email<input id="signin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label htmlFor="signin-password">Password
          <input id="signin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={setupNeeded ? 'new-password' : 'current-password'} minLength={setupNeeded ? 10 : undefined} required />
        </label>
        {setupNeeded && <p className="muted small">At least 10 characters.</p>}
        {error && <p className="warn">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Please wait…' : setupNeeded ? 'Create account and sign in' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
