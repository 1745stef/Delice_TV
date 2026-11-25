import { useEffect, useState } from 'react';
import { adminApi } from '../lib/api';
import Loading from '../components/Loading';

// Réglages du Bingo (superadmin) : taille de la grille, rôle de chaque usager.
// Tout est enregistré dans la base (table `settings`), partagée avec l'app principale.
export default function SettingsPage({ onSaved }) {
  const [cfg, setCfg]       = useState(null);   // { label, cols, rows, admins[], players[] }
  const [users, setUsers]   = useState([]);
  const [error, setError]   = useState(null);
  const [saved, setSaved]   = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([adminApi.getBingoAccess(), adminApi.getUsers()])
      .then(([c, u]) => { setCfg(c); setUsers(u); })
      .catch(e => setError(e.message));
  }, []);

  if (!cfg) return error ? <div className="error-box">{error}</div> : <Loading />;

  // Une personne est soit Admin, soit Joueur, soit sans accès (Admin l'emporte)
  const roleOf = (name) => {
    const k = name.toLowerCase();
    return cfg.admins.includes(k) ? 'admin' : cfg.players.includes(k) ? 'player' : 'none';
  };
  const setRole = (name, role) => {
    const k = name.toLowerCase();
    setCfg(c => ({
      ...c,
      admins:  c.admins.filter(u => u !== k).concat(role === 'admin'  ? [k] : []),
      players: c.players.filter(u => u !== k).concat(role === 'player' ? [k] : []),
    }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await adminApi.updateBingoAccess(cfg);
      setCfg(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onSaved?.();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="panel settings">
      <h2 className="panel-title">⚙ Réglages du Bingo</h2>
      <p className="muted">Enregistré en base de données, partagé avec l'app principale.</p>

      <div className="field">
        <label>Grille (colonnes × lignes)</label>
        <div className="row">
          <input type="number" min="1" max="10" className="input input-num" value={cfg.cols}
            onChange={e => setCfg(c => ({ ...c, cols: parseInt(e.target.value) || 1 }))} />
          <span className="times">×</span>
          <input type="number" min="1" max="10" className="input input-num" value={cfg.rows}
            onChange={e => setCfg(c => ({ ...c, rows: parseInt(e.target.value) || 1 }))} />
        </div>
      </div>

      <div className="field">
        <label>Accès par usager</label>
        <div className="users-list">
          {users.map(u => (
            <div key={u.id} className="user-row">
              <span>{u.username}</span>
              <select className="input input-select" value={roleOf(u.username)}
                onChange={e => setRole(u.username, e.target.value)}>
                <option value="none">— Aucun —</option>
                <option value="player">Joueur</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          ))}
        </div>
        <p className="muted small">Admin : modifie et révèle les cases · Joueur : voit les cases révélées en direct.</p>
      </div>

      {error && <div className="error-box">{error}</div>}
      <div className="modal-actions">
        {saved && <span className="saved">✓ Enregistré</span>}
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '…' : 'Enregistrer'}</button>
      </div>
    </div>
  );
}
