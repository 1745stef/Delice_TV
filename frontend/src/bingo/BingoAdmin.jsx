import { useState, useEffect, useCallback, useMemo } from 'react';
import { bingoApi } from '../lib/api';
import { bingoLines, lineLabel } from '../lib/lines';
import TileContent from './TileContent';

function readImage(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({
      base64: String(r.result).split(',')[1],
      contentType: file.type || 'image/png',
      preview: r.result,
    });
    r.onerror = () => reject(new Error('Lecture du fichier impossible'));
    r.readAsDataURL(file);
  });
}

// Vue admin : toutes les cases + les gages (une carte par ligne, colonne, diagonale, et le toupet suprême),
// édition (texte et/ou image) et révélation des cases.
// Les gages, eux, sont dévoilés par le streamer lui-même quand la ligne est réalisée.
// Tout tient à l'écran, sans défilement.
export default function BingoAdmin({ onPreview }) {
  const [grid, setGrid]       = useState({ cols: 5, rows: 5 });
  const [active, setActive]   = useState(false);   // grille ouverte aux joueurs ?
  const [toggling, setToggling] = useState(false);
  const [cells, setCells]     = useState({});
  const [gages, setGages]     = useState({});       // line_key -> gage
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [editing, setEditing] = useState(null);    // { kind: 'cell' | 'gage', id }
  const [form, setForm]       = useState(null);
  const [saving, setSaving]   = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await bingoApi.adminCells();
      setGrid({ cols: d.cols, rows: d.rows });
      setActive(!!d.active);
      setCells(Object.fromEntries(d.cells.map(c => [c.position, c])));
      setGages(Object.fromEntries((d.gages || []).map(g => [g.line_key, g])));
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Rafraîchit toutes les 10 s (plusieurs admins, gages dévoilés par le joueur) — sauf pendant une édition
  useEffect(() => {
    if (editing !== null) return;
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [editing, load]);

  const lines = useMemo(() => bingoLines(grid.cols, grid.rows), [grid]);
  const lineMap = useMemo(() => Object.fromEntries(lines.map(l => [l.key, l])), [lines]);
  // Ligne réalisée = toutes ses cases sont révélées aux joueurs
  const lineDone = (key) => !!lineMap[key] && lineMap[key].positions.every(p => cells[p]?.revealed);
  const hasContent = (x) => !!x && !!(x.text || x.image_url);

  const openEdit = (kind, id) => {
    const src = kind === 'cell' ? cells[id] : gages[id];
    setForm({
      text: src?.text || '',
      image_url: src?.image_url || null,
      newImage: null,
      removeImage: false,
      revealed: kind === 'cell' ? !!src?.revealed : false,
    });
    setEditing({ kind, id });
    setError(null);
  };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const img = await readImage(file);
      setForm(f => ({ ...f, newImage: img, removeImage: false }));
    } catch (err) { setError(err.message); }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = { text: form.text };
      if (form.newImage) payload.image = { base64: form.newImage.base64, contentType: form.newImage.contentType };
      else if (form.removeImage) payload.remove_image = true;

      if (editing.kind === 'cell') {
        let saved = await bingoApi.saveCell(editing.id, payload);
        if (form.revealed !== !!saved.revealed) saved = await bingoApi.reveal(editing.id, form.revealed);
        setCells(prev => ({ ...prev, [editing.id]: saved }));
      } else {
        const saved = await bingoApi.saveGage(editing.id, payload);
        setGages(prev => ({ ...prev, [editing.id]: saved }));
      }
      setEditing(null);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  // Gage dévoilé par erreur : on le remet face cachée
  const resetGage = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await bingoApi.resetGage(editing.id);
      setGages(prev => ({ ...prev, [editing.id]: r }));
      setEditing(null);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const toggleActive = async () => {
    if (active && !confirm("Fermer la grille ? Les joueurs reviendront à l'écran d'attente.")) return;
    setToggling(true);
    try {
      const r = await bingoApi.setActive(!active);
      setActive(!!r.active);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setToggling(false); }
  };

  const toggleReveal = async (pos, e) => {
    e.stopPropagation();
    try {
      const r = await bingoApi.reveal(pos, !cells[pos]?.revealed);
      setCells(prev => ({ ...prev, [pos]: r }));
      setError(null);
    } catch (err) { setError(err.message); }
  };

  if (loading) return <div className="loading">Chargement...</div>;

  const { cols, rows } = grid;
  const total = cols * rows;
  const revealedCount = Object.values(cells).filter(c => c.revealed && c.position < total).length;
  const gagesSet = lines.filter(l => hasContent(gages[l.key])).length;
  const preview = form && !form.removeImage ? (form.newImage?.preview || form.image_url) : null;

  const renderCell = (pos) => {
    const c = cells[pos];
    const has = hasContent(c);
    return (
      <div key={pos}
        className={`bingo-tile admin${c?.revealed ? ' revealed' : ''}${has ? '' : ' empty'}`}
        onClick={() => openEdit('cell', pos)}>
        {has ? <TileContent text={c.text} image_url={c.image_url} /> : <span className="bingo-tile-plus">+</span>}
        <span className="bingo-tile-num">{pos + 1}</span>
        {has && (
          <button className={`bingo-eye${c.revealed ? ' on' : ''}`}
            title={c.revealed ? 'Cacher aux joueurs' : 'Révéler aux joueurs'}
            onClick={(e) => toggleReveal(pos, e)}>
            {c.revealed ? '👁' : '🔒'}
          </button>
        )}
      </div>
    );
  };

  // Carte gage : l'admin voit toujours le contenu ; le joueur ne le dévoile qu'une fois la ligne réalisée
  const renderGage = (key) => {
    if (!lineMap[key]) return <div key={key} className="bingo-spacer" aria-hidden="true" />;
    const g = gages[key];
    const has = hasContent(g);
    const done = lineDone(key);
    return (
      <div key={key} title={lineLabel(key)}
        className={`gage-card admin${key === 'full' ? ' full-card' : ''}${has ? ' face' : ' empty'}${g?.revealed ? ' unveiled' : ''}`}
        onClick={() => openEdit('gage', key)}>
        <span className="gage-ribbon">{key === 'full' ? 'TOUPET SUPRÊME' : 'GAGE'}</span>
        {has ? <TileContent text={g.text} image_url={g.image_url} /> : <span className="bingo-tile-plus">+</span>}
        {g?.revealed ? <span className="gage-badge done">Dévoilé</span>
          : done && !has ? <span className="gage-badge warn">Gage manquant !</span>
          : done ? <span className="gage-badge ready">Réalisée</span>
          : null}
      </div>
    );
  };

  const editingGage = editing?.kind === 'gage';

  return (
    <div className="bingo-wrap">
      {error && editing === null && <div className="error-box" onClick={() => setError(null)}>{error} ✕</div>}
      <div className="bingo-adminbar">
        <span className={`bingo-state-badge${active ? ' on' : ''}`}>
          {active ? '🟢 Grille ouverte aux joueurs' : '🔴 Grille fermée — les joueurs attendent'}
        </span>
        <div className="row wrap">
          {onPreview && <button className="btn btn-ghost btn-sm" onClick={onPreview}>👀 Vue joueur</button>}
          <button className={active ? 'btn btn-ghost' : 'btn btn-primary'} onClick={toggleActive} disabled={toggling}>
            {toggling ? '...' : active ? 'Fermer la grille' : '🎉 Ouvrir la grille'}
          </button>
        </div>
      </div>
      <div className="bingo-status">
        {revealedCount} / {total} cases {active ? 'révélées aux joueurs' : 'marquées (visibles pour les joueurs à l\'ouverture)'}
        {' · '}{gagesSet} / {lines.length} gages définis · clique une carte pour la modifier
      </div>

      {/* Grille étendue : gages à droite (lignes), en bas (colonnes), coin bas-droit (diagonale),
          puis le toupet suprême sur toute la largeur. S'adapte à la place disponible : aucun défilement. */}
      <div className="bingo-stage">
        <div className="bingo-grid" style={{ '--cols': cols, '--rows': rows, '--ccols': cols + 1, '--crows': rows + 1 }}>
          {Array.from({ length: rows + 1 }, (_, r) =>
            Array.from({ length: cols + 1 }, (_, c) => {
              if (r < rows && c < cols) return renderCell(r * cols + c);
              if (r < rows) return renderGage(`row-${r}`);
              if (c < cols) return renderGage(`col-${c}`);
              return renderGage('diag');
            })
          ).flat()}
          {renderGage('full')}
        </div>
      </div>

      {editing !== null && form && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">
              {editingGage ? `Gage — ${lineLabel(editing.id)}` : `Case ${editing.id + 1}`}
            </h3>

            {editingGage && (
              <p className="muted small">
                {editing.id === 'full'
                  ? 'Le streamer pourra dévoiler le toupet suprême seulement quand TOUTES les cases de la grille seront révélées.'
                  : 'Le streamer dévoilera ce gage lui-même, en cliquant sur la carte, une fois la ligne réalisée (toutes ses cases révélées).'}
              </p>
            )}

            <div className="field">
              <label>Texte</label>
              <textarea className="input textarea" rows={4} value={form.text}
                onChange={e => setForm(f => ({ ...f, text: e.target.value }))} autoFocus />
            </div>

            <div className="field">
              <label>Image</label>
              {preview && <img src={preview} alt="" className="bingo-edit-preview" />}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
                  {preview ? 'Changer l\'image' : 'Choisir une image'}
                  <input type="file" accept="image/*" hidden onChange={onPickFile} />
                </label>
                {preview && (
                  <button className="btn btn-ghost"
                    onClick={() => setForm(f => ({ ...f, newImage: null, removeImage: true }))}>
                    Retirer l'image
                  </button>
                )}
              </div>
            </div>

            {editingGage ? (
              <div className="muted small">
                {editing.id === 'full' ? 'Grille' : 'Ligne'} : {lineDone(editing.id) ? (editing.id === 'full' ? 'pleine ✓' : 'réalisée ✓') : (editing.id === 'full' ? 'pas encore pleine' : 'pas encore réalisée')}
                {' · '}Gage : {gages[editing.id]?.revealed ? 'dévoilé par le joueur' : 'face cachée'}
                {gages[editing.id]?.revealed && (
                  <div style={{ marginTop: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={resetGage} disabled={saving}>
                      Remettre face cachée
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: '0.95rem' }}>
                <input type="checkbox" checked={form.revealed}
                  onChange={e => setForm(f => ({ ...f, revealed: e.target.checked }))} />
                Révélée aux joueurs
              </label>
            )}

            {error && <div className="error-box">{error}</div>}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
