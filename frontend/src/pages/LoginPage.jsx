import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';

// Connexion + inscription. Un nouvel inscrit arrive sur un écran vide : un super admin doit
// l'ajouter à un groupe pour qu'il voie quelque chose.
export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode]         = useState('login');   // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy]         = useState(false);
  const [slow, setSlow]         = useState(false);
  const [error, setError]       = useState(null);

  // Si ça traîne, le serveur gratuit est probablement en train de se réveiller
  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, [busy]);

  const isRegister = mode === 'register';
  const switchMode = (m) => { setMode(m); setError(null); setPassword(''); setPassword2(''); };

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    if (isRegister && password !== password2) return setError('Les deux mots de passe ne correspondent pas');
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await register(username.trim(), password);
      else await login(username.trim(), password);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-emblem">🔮</div>
        <h1 className="auth-title">Delice_TV</h1>
        <div className="auth-divider"><span>✦</span></div>

        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={!isRegister} className={!isRegister ? 'on' : ''} onClick={() => switchMode('login')}>Connexion</button>
          <button type="button" role="tab" aria-selected={isRegister} className={isRegister ? 'on' : ''} onClick={() => switchMode('register')}>Inscription</button>
        </div>

        <div className="field">
          <label htmlFor="u">Nom d'usager</label>
          <input id="u" className="input" value={username} autoComplete="username" autoCapitalize="none"
            onChange={e => setUsername(e.target.value)} autoFocus />
          {isRegister && <span className="hint">3 à 24 caractères : lettres, chiffres, _ . -</span>}
        </div>
        <div className="field">
          <label htmlFor="p">Mot de passe</label>
          <input id="p" className="input" type="password" value={password}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            onChange={e => setPassword(e.target.value)} />
          {isRegister && <span className="hint">6 caractères minimum</span>}
        </div>
        {isRegister && (
          <div className="field">
            <label htmlFor="p2">Confirmer le mot de passe</label>
            <input id="p2" className="input" type="password" value={password2} autoComplete="new-password"
              onChange={e => setPassword2(e.target.value)} />
          </div>
        )}

        {error && <div className="error-box">{error}</div>}

        <button className="btn btn-primary btn-block" type="submit"
          disabled={busy || !username.trim() || !password || (isRegister && !password2)}>
          {busy ? 'Invocation…' : isRegister ? 'Créer mon compte' : 'Entrer'}
        </button>
        {busy && slow && <div className="auth-hint">Le serveur se réveille, cela peut prendre jusqu'à une minute…</div>}
      </form>
    </div>
  );
}
