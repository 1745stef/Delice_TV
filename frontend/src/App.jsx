import { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth, getLevel } from './hooks/useAuth';
import { bingoApi } from './lib/api';
import LoginPage from './pages/LoginPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import SettingsPage from './pages/SettingsPage';
import BingoAdmin from './bingo/BingoAdmin';
import BingoPlayer from './bingo/BingoPlayer';
import Loading from './components/Loading';

function Shell() {
  const { user, loading, logout } = useAuth();
  const [access, setAccess] = useState(undefined);   // undefined = chargement · { role, label, ... }
  const [view, setView]     = useState('bingo');     // 'bingo' | 'settings'
  const [mode, setMode]     = useState('player');    // admin : bascule vue admin / vue joueur

  const refreshAccess = useCallback(() => {
    return bingoApi.access()
      .then(r => { setAccess(r); return r; })
      .catch(e => setAccess({ role: null, error: e.message }));
  }, []);

  useEffect(() => {
    if (!user || user.must_change_password) { setAccess(undefined); return; }
    setAccess(undefined);
    setView('bingo');
    refreshAccess().then(r => { if (r?.role === 'admin') setMode('admin'); });
  }, [user?.id, user?.must_change_password, refreshAccess]);

  if (loading) return <Loading />;
  if (!user) return <LoginPage />;
  if (user.must_change_password) return <ChangePasswordPage />;

  const isSuper = getLevel(user) === 1;
  const role = access?.role;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-gem">🔮</span>
          <span className="brand-title">Delice_TV</span>
        </div>
        <div className="topbar-spacer" />
        {view === 'bingo' && role === 'admin' && (
          <button className="btn btn-ghost btn-sm" onClick={() => setMode(m => (m === 'admin' ? 'player' : 'admin'))}>
            {mode === 'admin' ? '👀 Vue joueur' : '🪄 Vue admin'}
          </button>
        )}
        {isSuper && (
          <button className="btn btn-ghost btn-sm" onClick={() => setView(v => (v === 'settings' ? 'bingo' : 'settings'))}>
            {view === 'settings' ? '← Bingo' : '⚙ Réglages'}
          </button>
        )}
        <span className="who">{user.username}</span>
        <button className="btn btn-ghost btn-sm" onClick={logout}>Quitter</button>
      </header>

      <main className="main">
        {view === 'settings' && isSuper ? (
          <SettingsPage onSaved={refreshAccess} />
        ) : access === undefined ? (
          <Loading />
        ) : !role ? (
          <div className="panel noaccess">
            <div className="noaccess-emblem">🔒</div>
            {access.error ? (
              <>
                <h2 className="panel-title">Serveur injoignable</h2>
                <p className="muted">{access.error}</p>
                <button className="btn btn-primary" onClick={() => { setAccess(undefined); refreshAccess(); }}>Réessayer</button>
              </>
            ) : (
              <>
                <h2 className="panel-title">Accès réservé</h2>
                <p className="muted">Tu n'as pas encore accès à ce Bingo. Demande à un administrateur de t'ajouter.</p>
              </>
            )}
          </div>
        ) : role === 'admin' && mode === 'admin' ? (
          <BingoAdmin />
        ) : (
          <BingoPlayer />
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
