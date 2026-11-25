import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [slow, setSlow]         = useState(false);
  const [error, setError]       = useState(null);

  // Si la connexion traîne, le serveur gratuit est probablement en train de se réveiller
  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, [busy]);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try { await login(username.trim(), password); }
    catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-emblem">🔮</div>
        <h1 className="auth-title">Delice_TV</h1>
        <div className="auth-divider"><span>✦</span></div>
        <p className="auth-sub">Entre dans le cercle</p>

        <div className="field">
          <label htmlFor="u">Nom d'usager</label>
          <input id="u" className="input" value={username} autoComplete="username" autoCapitalize="none"
            onChange={e => setUsername(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="p">Mot de passe</label>
          <input id="p" className="input" type="password" value={password} autoComplete="current-password"
            onChange={e => setPassword(e.target.value)} />
        </div>

        {error && <div className="error-box">{error}</div>}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? 'Invocation…' : 'Entrer'}
        </button>
        {busy && slow && <div className="auth-hint">Le serveur se réveille, cela peut prendre jusqu'à une minute…</div>}
      </form>
    </div>
  );
}
