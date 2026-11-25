import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

// Affichée quand un admin a réinitialisé le mot de passe (même règle que l'app principale)
export default function ChangePasswordPage() {
  const { changePassword, logout } = useAuth();
  const [pw, setPw]       = useState('');
  const [pw2, setPw2]     = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 6) return setError('Mot de passe trop court (6 caractères minimum)');
    if (pw !== pw2) return setError('Les deux mots de passe ne correspondent pas');
    setBusy(true);
    setError(null);
    try { await changePassword(pw); }
    catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-emblem">🗝️</div>
        <h1 className="auth-title">Nouveau sortilège</h1>
        <div className="auth-divider"><span>✦</span></div>
        <p className="auth-sub">Choisis un nouveau mot de passe pour continuer</p>

        <div className="field">
          <label htmlFor="n1">Nouveau mot de passe</label>
          <input id="n1" className="input" type="password" value={pw} autoComplete="new-password"
            onChange={e => setPw(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="n2">Confirmer</label>
          <input id="n2" className="input" type="password" value={pw2} autoComplete="new-password"
            onChange={e => setPw2(e.target.value)} />
        </div>

        {error && <div className="error-box">{error}</div>}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? '…' : 'Enregistrer'}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={logout}>Annuler</button>
      </form>
    </div>
  );
}
