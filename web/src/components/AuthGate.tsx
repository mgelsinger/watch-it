import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useState } from 'react';
import { api } from '../api';

interface AuthState {
  enabled: boolean;
  authenticated: boolean;
}

interface AuthContextValue extends AuthState {
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  enabled: false,
  authenticated: true,
  logout: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api<AuthState>('/api/auth/status')
      .then((result) => { if (active) setState(result); })
      .catch((err: Error) => { if (active) setError(err.message); });
    const requireLogin = () => setState((current) => current?.enabled ? { ...current, authenticated: false } : current);
    window.addEventListener('watch-it-auth-required', requireLogin);
    return () => {
      active = false;
      window.removeEventListener('watch-it-auth-required', requireLogin);
    };
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<AuthState>('/api/auth/login', { json: { password } });
      setPassword('');
      setState(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setState({ enabled: true, authenticated: false });
  };

  if (!state) {
    return <div className="login-shell"><p className="muted">{error ?? 'Opening Watch It...'}</p></div>;
  }

  if (state.enabled && !state.authenticated) {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={(event) => void login(event)}>
          <div className="login-logo">watch-it</div>
          <h1>Welcome back</h1>
          <p className="faint">Enter the password configured for this Watch It installation.</p>
          <label htmlFor="watch-it-password">Password</label>
          <input
            id="watch-it-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            required
          />
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </main>
    );
  }

  return <AuthContext.Provider value={{ ...state, logout }}>{children}</AuthContext.Provider>;
}
