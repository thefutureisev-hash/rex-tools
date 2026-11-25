import { useEffect, useState } from 'react';
import App from './App';
import { authEvents, getMe, IS_STATIC, signOut, type User } from './api';
import { SignIn } from './components/SignIn';

const TEST_USER: User = { id: 'test', email: '', name: 'Test', role: 'admin', createdAt: '' };

/** Shows the sign-in (or first-time setup) screen until someone is signed in. */
export function Root() {
  const [state, setState] = useState<{ loading: boolean; user: User | null; setupNeeded: boolean }>(
    IS_STATIC ? { loading: false, user: TEST_USER, setupNeeded: false } : { loading: true, user: null, setupNeeded: false },
  );

  useEffect(() => {
    if (IS_STATIC) return;
    getMe()
      .then((r) => setState({ loading: false, ...r }))
      .catch(() => setState({ loading: false, user: null, setupNeeded: false }));
    const ended = () => setState((s) => ({ ...s, user: null }));
    authEvents.addEventListener('unauthorized', ended);
    return () => authEvents.removeEventListener('unauthorized', ended);
  }, []);

  if (state.loading) return <div className="signin-wrap"><p className="muted">Loading…</p></div>;
  if (!state.user) {
    return <SignIn setupNeeded={state.setupNeeded} onSignedIn={(user) => setState({ loading: false, user, setupNeeded: false })} />;
  }
  return (
    <App
      key={state.user.id}
      user={state.user}
      onSignOut={() => { signOut().finally(() => setState({ loading: false, user: null, setupNeeded: false })); }}
    />
  );
}
