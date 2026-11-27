import { useEffect, useMemo, useRef, useState } from 'react';
import { adminApi } from '../lib/api';
import { prepareImage } from '../lib/images';
import { useAuth } from '../hooks/useAuth';
import Avatar from '../components/Avatar';
import Loading from '../components/Loading';

// Gestion. Chaque section n'apparaît que si l'un des groupes de la personne la lui accorde :
//   Profils des joueurs · Paramètres du Bingo · Paramètres du streamer   (+ « Accès aux paramètres » = la porte)
// Les groupes, leurs droits et la suppression de comptes restent réservés au super admin.
export default function ManagePage() {
  const { access, can } = useAuth();
  const isSuper = !!access?.is_superadmin;
  const [tab, setTab] = useState(null);

  const tabs = [
    can('settings.users')    && { key: 'users',    label: 'Profils des joueurs' },
    isSuper                  && { key: 'groups',   label: 'Groupes' },
    can('settings.bingo')    && { key: 'bingo',    label: 'Bingo' },
    can('settings.streamer') && { key: 'streamer', label: 'Streamer' },
  ].filter(Boolean);
  const current = tabs.some(t => t.key === tab) ? tab : tabs[0]?.key;

  if (!tabs.length) {
    return <div className="panel"><p className="muted">Aucune section de paramètres ne t'est accessible pour l'instant.</p></div>;
  }

  return (
    <div className="manage">
      <div className="auth-tabs manage-tabs">
        {tabs.map(t => (
          <button key={t.key} className={current === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {current === 'users'    && <UsersTab isSuper={isSuper} />}
      {current === 'groups'   && <GroupsTab />}
      {current === 'bingo'    && <BingoTab />}
      {current === 'streamer' && <StreamerTab />}
    </div>
  );
}

/* ─── Profils des joueurs ─────────────────────────────────────────────────── */
function UsersTab({ isSuper }) {
  const { user: me } = useAuth();
  const [data, setData] = useState(null);       // { users, groups }
  const [q, setQ]       = useState('');
  const [open, setOpen] = useState(null);       // id de l'usager déplié
  const [temp, setTemp] = useState(null);       // { username, temp_password }
  const [error, setError] = useState(null);

  useEffect(() => { adminApi.users().then(setData).catch(e => setError(e.message)); }, []);

  const users  = data?.users || [];
  const groups = data?.groups || [];
  const setUsers = (fn) => setData(d => ({ ...d, users: fn(d.users) }));

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter(u => `${u.username} ${u.display_name || ''}`.toLowerCase().includes(needle));
  }, [users, q]);
  const waiting = users.filter(u => !u.is_superadmin && u.group_ids.length === 0).length;

  if (!data) return error ? <div className="panel"><div className="error-box">{error}</div></div> : <Loading />;

  const toggleGroup = async (u, gid) => {
    const next = u.group_ids.includes(gid) ? u.group_ids.filter(x => x !== gid) : [...u.group_ids, gid];
    setUsers(prev => prev.map(x => (x.id === u.id ? { ...x, group_ids: next } : x)));   // affichage immédiat
    try { await adminApi.setUserGroups(u.id, next); setError(null); }
    catch (e) { setError(e.message); setUsers(prev => prev.map(x => (x.id === u.id ? u : x))); }
  };

  const reset = async (u) => {
    if (!confirm(`Générer un mot de passe temporaire pour ${u.username} ?`)) return;
    try { setTemp(await adminApi.resetPassword(u.id)); setError(null); }
    catch (e) { setError(e.message); }
  };

  const remove = async (u) => {
    if (!confirm(`Supprimer définitivement le compte de ${u.username} ?`)) return;
    try { await adminApi.deleteUser(u.id); setUsers(prev => prev.filter(x => x.id !== u.id)); setError(null); }
    catch (e) { setError(e.message); }
  };

  return (
    <div className="panel wide">
      <input className="input" placeholder="Rechercher un usager…" value={q} onChange={e => setQ(e.target.value)} />
      {isSuper && waiting > 0 && <div className="notice">{waiting} inscrit{waiting > 1 ? 's' : ''} sans groupe : ouvre-les pour leur donner accès.</div>}
      {error && <div className="error-box" onClick={() => setError(null)}>{error} ✕</div>}

      <div className="users-list tall">
        {list.map(u => {
          const mine = groups.filter(g => u.group_ids.includes(g.id));
          return (
            <div key={u.id} className="user-card">
              <button className="user-head" onClick={() => setOpen(open === u.id ? null : u.id)}>
                <Avatar user={u} size={36} />
                <span className="user-name">
                  <strong>{u.display_name || u.username}</strong>
                  <span className="muted small">@{u.username}</span>
                </span>
                <span className="chips">
                  {u.is_superadmin && <span className="chip chip-super">Super admin</span>}
                  {!u.is_superadmin && mine.length === 0 && <span className="chip chip-none">Sans groupe</span>}
                  {mine.map(g => <span key={g.id} className="chip" style={{ '--c': g.color }}>{g.name}</span>)}
                </span>
                <span className="caret">{open === u.id ? '▾' : '▸'}</span>
              </button>

              {open === u.id && (
                <div className="user-body">
                  {isSuper && (
                    <div className="field">
                      <label>Groupes (plusieurs possibles)</label>
                      {groups.length === 0 && <span className="muted small">Aucun groupe — crées-en dans l'onglet Groupes.</span>}
                      <div className="check-grid">
                        {groups.map(g => (
                          <label key={g.id} className="check">
                            <input type="checkbox" checked={u.group_ids.includes(g.id)} onChange={() => toggleGroup(u, g.id)} />
                            <span className="dot" style={{ background: g.color }} />{g.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="row wrap">
                    {u.can_reset
                      ? <button className="btn btn-ghost btn-sm" onClick={() => reset(u)}>🗝️ Mot de passe temporaire</button>
                      : <span className="muted small">Mot de passe : réservé (ce compte a plus de droits que toi).</span>}
                    {isSuper && !u.is_superadmin && u.id !== me.id && (
                      <button className="btn btn-ghost btn-sm danger" onClick={() => remove(u)}>Supprimer le compte</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {list.length === 0 && <p className="muted">Aucun usager.</p>}
      </div>

      {temp && (
        <div className="modal-overlay" onClick={() => setTemp(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Mot de passe temporaire</h3>
            <p className="muted small">Pour <strong>{temp.username}</strong>. Il ne sera plus affiché : transmets-le maintenant. La personne devra en choisir un nouveau à sa prochaine connexion.</p>
            <div className="temp-pw">{temp.temp_password}</div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(temp.temp_password)}>Copier</button>
              <button className="btn btn-primary" onClick={() => setTemp(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Groupes (super admin) ───────────────────────────────────────────────── */
function GroupsTab() {
  const [groups, setGroups]   = useState(null);
  const [users, setUsers]     = useState([]);
  const [modules, setModules] = useState([]);
  const [newName, setNewName]   = useState('');
  const [newColor, setNewColor] = useState('#d4af37');
  const [error, setError]       = useState(null);

  useEffect(() => {
    Promise.all([adminApi.groups(), adminApi.users(), adminApi.modules()])
      .then(([g, u, m]) => { setGroups(g); setUsers(u.users); setModules(m); })
      .catch(e => setError(e.message));
  }, []);

  if (!groups) return error ? <div className="panel"><div className="error-box">{error}</div></div> : <Loading />;

  const count = (gid) => users.filter(u => u.group_ids.includes(gid)).length;

  const create = async () => {
    if (!newName.trim()) return;
    try {
      const g = await adminApi.createGroup({ name: newName.trim(), color: newColor });
      setGroups(prev => [...prev, g].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setError(null);
    } catch (e) { setError(e.message); }
  };

  const patch = async (g, data) => {
    try {
      const upd = await adminApi.updateGroup(g.id, data);
      setGroups(prev => prev.map(x => (x.id === g.id ? upd : x)));
      setError(null);
      return true;
    } catch (e) { setError(e.message); return false; }
  };

  const remove = async (g) => {
    if (!confirm(`Supprimer le groupe « ${g.name} » ? Ses ${count(g.id)} membre(s) perdront les droits que ce groupe leur donnait.`)) return;
    try { await adminApi.deleteGroup(g.id); setGroups(prev => prev.filter(x => x.id !== g.id)); setError(null); }
    catch (e) { setError(e.message); }
  };

  return (
    <div className="panel wide">
      <p className="muted small">Un groupe décide de ce que ses membres peuvent voir et faire. Une personne peut être dans plusieurs groupes : elle a alors la somme de leurs droits. Le profil, lui, est ouvert à tout le monde.</p>
      {error && <div className="error-box" onClick={() => setError(null)}>{error} ✕</div>}

      <div className="row">
        <input type="color" className="swatch-input" value={newColor} onChange={e => setNewColor(e.target.value)} aria-label="Couleur du groupe" />
        <input className="input" placeholder="Nom du nouveau groupe" maxLength={40} value={newName}
          onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
        <button className="btn btn-primary" onClick={create} disabled={!newName.trim()}>+ Ajouter</button>
      </div>

      <div className="group-list">
        {groups.map(g => <GroupCard key={g.id} g={g} members={count(g.id)} modules={modules} patch={patch} remove={remove} />)}
        {groups.length === 0 && <p className="muted">Aucun groupe pour l'instant.</p>}
      </div>
    </div>
  );
}

function GroupCard({ g, members, modules, patch, remove }) {
  const [name, setName] = useState(g.name);
  const commitName = async () => {
    const n = name.trim();
    if (!n) return setName(g.name);
    if (n !== g.name && !(await patch(g, { name: n }))) setName(g.name);
  };

  const roles    = modules.filter(m => m.category === 'roles');
  const screens  = modules.filter(m => m.category === 'screens');
  const door     = modules.find(m => m.key === 'settings');
  const sections = modules.filter(m => m.parent === 'settings');
  const has = (k) => g.module_keys.includes(k);

  // Cocher une section coche aussi la porte ; décocher la porte décoche toutes les sections
  const toggle = (key) => {
    const next = new Set(g.module_keys);
    if (next.has(key)) {
      next.delete(key);
      if (key === 'settings') sections.forEach(s => next.delete(s.key));
    } else {
      next.add(key);
      if (key.startsWith('settings.')) next.add('settings');
    }
    patch(g, { module_keys: [...next] });
  };

  const row = (m, sub) => (
    <label key={m.key} className={`module-row${sub ? ' sub' : ''}`}>
      <input type="checkbox" checked={has(m.key)} onChange={() => toggle(m.key)} />
      <span><strong>{m.label}</strong><span className="muted small"> — {m.description}</span></span>
    </label>
  );

  return (
    <div className="group-card" style={{ '--c': g.color }}>
      <div className="group-head">
        <input type="color" className="swatch-input" value={g.color} onChange={e => patch(g, { color: e.target.value })} aria-label="Couleur" />
        <input className="input group-name" value={name} maxLength={40}
          onChange={e => setName(e.target.value)} onBlur={commitName} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
        <span className="muted small">{members} membre{members > 1 ? 's' : ''}</span>
        <button className="btn btn-ghost btn-sm danger" onClick={() => remove(g)}>Supprimer</button>
      </div>

      <div className="rights">
        <div className="rights-block">
          <div className="rights-title">Rôles dans le Bingo</div>
          {roles.map(m => row(m))}
        </div>
        {screens.length > 0 && (
          <div className="rights-block">
            <div className="rights-title">Écrans</div>
            {screens.map(m => row(m))}
          </div>
        )}
        {door && (
          <div className="rights-block">
            <div className="rights-title">Paramètres (onglet Gestion)</div>
            {row(door)}
            {sections.map(m => row(m, true))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Paramètres du Bingo : grille et images ──────────────────────────────── */
const IMAGE_SLOTS = [
  { slot: 'puzzle', label: 'Image du casse-tête',   hint: 'Découpée en morceaux : chaque case encore cachée en montre un, comme un puzzle. L\'image est toujours affichée en entier et centrée, rien n\'est coupé.' },
  { slot: 'gage',   label: 'Dos des gages',         hint: 'La même image, entière et centrée, est répétée sur chaque carte gage (lignes, colonnes, diagonale).' },
  { slot: 'full',   label: 'Dos du toupet suprême', hint: 'Une image unique, entière et centrée, pour la dernière carte (une longue bande tout en bas : une image large y est plus à l\'aise).' },
];

function BingoTab() {
  const [cfg, setCfg]     = useState(null);   // { cols, rows, images: { puzzle, gage, full } }
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { adminApi.bingoSettings().then(setCfg).catch(e => setError(e.message)); }, []);
  if (!cfg) return error ? <div className="panel"><div className="error-box">{error}</div></div> : <Loading />;

  const save = async () => {
    try {
      const upd = await adminApi.saveBingoSettings({ cols: cfg.cols, rows: cfg.rows });
      setCfg(upd);
      setSaved(true); setError(null);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="panel">
      <h2 className="panel-title">🎯 Grille du Bingo</h2>
      <div className="field">
        <label>Colonnes × lignes</label>
        <div className="row">
          <input type="number" min="1" max="10" className="input input-num" value={cfg.cols}
            onChange={e => setCfg(c => ({ ...c, cols: parseInt(e.target.value) || 1 }))} />
          <span className="times">×</span>
          <input type="number" min="1" max="10" className="input input-num" value={cfg.rows}
            onChange={e => setCfg(c => ({ ...c, rows: parseInt(e.target.value) || 1 }))} />
        </div>
        <span className="hint">La diagonale n'existe que si la grille est carrée. Les cases hors de la nouvelle grille sont masquées (pas effacées). L'image du casse-tête se redécoupe toute seule.</span>
      </div>
      {error && <div className="error-box" onClick={() => setError(null)}>{error} ✕</div>}
      <div className="modal-actions">
        {saved && <span className="saved">✓ Enregistré</span>}
        <button className="btn btn-primary" onClick={save}>Enregistrer</button>
      </div>

      <h2 className="panel-title" style={{ marginTop: 8 }}>🖼️ Dos des cartes</h2>
      <p className="muted small">Visibles par les joueurs sur les cartes encore cachées. Sans image, le style rouge et or par défaut est utilisé. Les changements sont enregistrés tout de suite.</p>
      <div className="image-slots">
        {IMAGE_SLOTS.map(s => (
          <ImageSlot key={s.slot} {...s}
            hint={s.slot === 'puzzle' ? `${s.hint} Pour qu'elle remplisse toute la grille, vise le format ${cfg.cols}:${cfg.rows}${cfg.cols === cfg.rows ? ' (carré)' : ''} ; sinon, des bandes de velours rouge complètent les bords.` : s.hint}
            url={cfg.images?.[s.slot]} onChange={(images) => setCfg(c => ({ ...c, images }))} />
        ))}
      </div>
    </div>
  );
}

function ImageSlot({ slot, label, hint, url, onChange }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const image = await prepareImage(file);
      const res = await adminApi.bingoImage(slot, { image });
      onChange(res.images);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setError(null);
    try { onChange((await adminApi.bingoImage(slot, { remove: true })).images); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="image-slot">
      {url ? <img className="image-slot-preview" src={url} alt="" /> : <div className="image-slot-preview">Aucune</div>}
      <div className="image-slot-body">
        <strong>{label}</strong>
        <div className="muted small">{hint}</div>
        {error && <div className="error-box">{error}</div>}
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? '…' : url ? 'Changer l\'image' : 'Choisir une image'}
          </button>
          {url && <button className="btn btn-ghost btn-sm danger" onClick={remove} disabled={busy}>Retirer</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </div>
    </div>
  );
}

/* ─── Paramètres du streamer ──────────────────────────────────────────────── */
function StreamerTab() {
  return (
    <div className="panel">
      <h2 className="panel-title">📺 Paramètres du streamer</h2>
      <p className="muted">Bientôt : la liaison du compte Twitch et les réglages du streamer apparaîtront ici.</p>
    </div>
  );
}
