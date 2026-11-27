import { useEffect } from 'react';
import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import BingoPage from './pages/BingoPage';
import ProfilePage from './pages/ProfilePage';
import TwitchPage from './pages/TwitchPage';
import ManagePage from './pages/ManagePage';
import Loading from './components/Loading';
import Avatar from './components/Avatar';

// Ce que chaque usager voit dépend de ses groupes (modules) — voir Gestion.
// Le profil est ouvert à TOUTE personne connectée, même sans groupe (c'est tout ce qu'elle voit au début).
const NAV = [
  { key: 'bingo',   label: '🎯 Bingo',   show: (can) => can('bingo.view', 'bingo.stream', 'bingo.admin') },
  { key: 'profile', label: '👤 Profil',  show: () => true },
  { key: 'twitch',  label: '📺 Twitch',  show: (can) => can('twitch') },
  { key: 'manage',  label: '⚙ Gestion',  show: (can) => can('settings') },   // la porte d'entrée des paramètres
];

function Shell() {
  const { user, loading, logout, refresh, can } = useAuth();
  const [view, setView] = useState(null);

  // Relit les droits quand on revient sur l'onglet (ex. on vient d'être ajouté à un groupe)
  useEffect(() => {
    if (!user) return;
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [user?.id, refresh]);

  if (loading) return <Loading />;
  if (!user) return <LoginPage />;
  if (user.must_change_password) return <ChangePasswordPage />;

  const items = NAV.filter(n => n.show(can));
  const current = items.some(n => n.key === view) ? view : items[0].key;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-gem">🔮</span>
          <span className="brand-title">Delice_TV</span>
        </div>
        <nav className="nav">
          {items.map(n => (
            <button key={n.key} className={`nav-btn${current === n.key ? ' on' : ''}`} onClick={() => setView(n.key)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="topbar-spacer" />
        <button className="me" title="Mon profil" onClick={() => setView('profile')}>
          <Avatar user={user} size={30} />
          <span className="who">{user.display_name || user.username}</span>
        </button>
        <button className="btn btn-ghost btn-sm" onClick={logout}>Quitter</button>
      </header>

      <main className={`main${current === 'bingo' ? ' main-fit' : ''}`}>
        {current === 'bingo'   && <BingoPage />}
        {current === 'profile' && <ProfilePage />}
        {current === 'twitch'  && <TwitchPage />}
        {current === 'manage'  && <ManagePage />}
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
