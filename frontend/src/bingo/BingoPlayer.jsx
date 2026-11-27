import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { bingoApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import { bingoLines, lineLabel } from '../lib/lines';
import TileContent from './TileContent';
import LottieCanvas from './LottieCanvas';
import { ANIM, REVEAL_MAX_MS, CONFETTI_MAX_MS, INTRO_MS, loadDotLottie, prefersReducedMotion } from './animations';

// Proportions (largeur / hauteur) d'une image, pour la découper sans la déformer
function useImageRatio(url) {
  const [ratio, setRatio] = useState(null);
  useEffect(() => {
    setRatio(null);
    if (!url) return;
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight); };
    img.src = url;
    return () => { alive = false; };
  }, [url]);
  return ratio;
}
const cssUrl = (u) => `url("${String(u).replace(/"/g, '%22')}")`;

// Vue joueur (streamer ou spectateur).
//  • Grille fermée  → écran d'attente (sphère animée), aucune grille, aucun contenu.
//  • Un admin ouvre → confettis, puis les cartes apparaissent en « zoom depuis le centre ».
//  • Case révélée en direct → baguette magique, puis la case se retourne.
//  • Dos des cartes : une image découpée en casse-tête sur les cases cachées, la même image répétée sur
//    les gages, une image unique sur le toupet suprême (réglées dans Gestion → Bingo).
//  • Gages : une carte au bout de chaque ligne, sous chaque colonne, dans le coin (diagonale
//    haut-gauche → bas-droite) et, tout en bas, le « toupet suprême ». Le streamer clique sur le dos de
//    la carte pour la dévoiler, mais seulement quand TOUTES les cases de la ligne sont révélées
//    (pour la carte pleine : toutes les cases de la grille).
// Tout se met à jour en temps réel (Supabase Realtime), sans recharger la page.
// Les cases et gages cachés ne sont jamais envoyés au navigateur.
//
// readOnly : on ne peut pas dévoiler un gage (aperçu d'un admin, ou simple spectateur).
export default function BingoPlayer({ readOnly = false }) {
  const [grid, setGrid]       = useState({ cols: 5, rows: 5 });
  const [cells, setCells]     = useState({});   // position -> { position, text, image_url, revealed_at }
  const [gages, setGages]     = useState({});   // line_key -> { line_key, text, image_url, revealed_at }
  const [images, setImages]   = useState({});   // { puzzle, gage, full } : adresses des images des dos de cartes
  const [active, setActive]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [live, setLive]       = useState(false);
  const [zoom, setZoom]       = useState(null);
  const [intro, setIntro]     = useState(false);   // apparition des cartes à l'ouverture
  const [confetti, setConfetti] = useState(false);
  const [casting, setCasting] = useState({});      // cases dont la baguette joue
  const [flipped, setFlipped] = useState({});      // cases révélées en direct (retournement)
  const [gageFlip, setGageFlip] = useState({});    // gages dévoilés en direct (retournement)
  const [busyGage, setBusyGage] = useState(null);  // gage en cours de dévoilement

  const activeRef = useRef(false);
  const libReady  = useRef(false);
  const timers    = useRef({});

  const endCast = useCallback((pos, flip) => {
    clearTimeout(timers.current[`c${pos}`]);
    delete timers.current[`c${pos}`];
    setCasting(c => { if (!c[pos]) return c; const n = { ...c }; delete n[pos]; return n; });
    if (flip) setFlipped(f => ({ ...f, [pos]: true }));
  }, []);

  const startCast = useCallback((pos) => {
    if (!libReady.current || prefersReducedMotion()) return;
    setCasting(c => ({ ...c, [pos]: true }));
    clearTimeout(timers.current[`c${pos}`]);
    timers.current[`c${pos}`] = setTimeout(() => endCast(pos, true), REVEAL_MAX_MS);
  }, [endCast]);

  // Bascule ouverte / fermée. celebrate = vrai seulement quand l'ouverture arrive EN DIRECT.
  const applyActive = useCallback((next, celebrate) => {
    const was = activeRef.current;
    activeRef.current = next;
    setActive(next);
    if (next && !was) {
      setIntro(true);
      clearTimeout(timers.current.intro);
      timers.current.intro = setTimeout(() => setIntro(false), INTRO_MS);
      if (celebrate && libReady.current && !prefersReducedMotion()) {
        setConfetti(true);
        clearTimeout(timers.current.confetti);
        timers.current.confetti = setTimeout(() => setConfetti(false), CONFETTI_MAX_MS);
      }
    }
    if (!next && was) {
      setCells({}); setGages({}); setCasting({}); setFlipped({}); setGageFlip({});
      setConfetti(false); setZoom(null); setIntro(false);
    }
  }, []);

  const load = useCallback(async (celebrate = false) => {
    try {
      const d = await bingoApi.player();
      setGrid({ cols: d.cols, rows: d.rows });
      setImages(d.images || {});
      setCells(Object.fromEntries(d.cells.map(c => [c.position, c])));
      setGages(Object.fromEntries((d.gages || []).map(g => [g.line_key, g])));
      applyActive(!!d.active, celebrate);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [applyActive]);

  // Précharge le lecteur d'animations (pour que la baguette / les confettis soient prêts)
  useEffect(() => {
    let alive = true;
    loadDotLottie().then(L => { if (alive && L) libReady.current = true; });
    return () => { alive = false; Object.values(timers.current).forEach(clearTimeout); };
  }, []);

  // Un canal par table : si l'une n'est pas (encore) activée dans Supabase Realtime, les autres continuent de fonctionner.
  useEffect(() => {
    const channels = [];
    const listen = (name, table, handler, onStatus) => {
      const ch = supabase.channel(`bingo:${name}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, handler)
        .subscribe(onStatus);
      channels.push(ch);
    };

    // Ouverture / fermeture de la grille par un admin (ce canal pilote aussi l'indicateur « En direct »)
    listen('state', 'bingo_state', (payload) => {
      if (payload.new?.active) load(true);
      else applyActive(false, false);
    }, (status) => {
      setLive(status === 'SUBSCRIBED');
      // À chaque (re)connexion : on resynchronise pour ne rien rater (sans confettis)
      if (status === 'SUBSCRIBED') load(false);
    });

    // Cases révélées (ignorées tant que la grille est fermée)
    listen('cells', 'bingo_public', (payload) => {
      if (!activeRef.current) return;
      if (payload.eventType === 'DELETE') {
        const pos = payload.old?.position;
        if (pos === undefined) return;
        endCast(pos, false);
        setFlipped(f => { const n = { ...f }; delete n[pos]; return n; });
        setCells(prev => { const n = { ...prev }; delete n[pos]; return n; });
        setZoom(z => (z && z.position === pos ? null : z));
      } else if (payload.new) {
        // INSERT = nouvelle révélation → baguette ; UPDATE = contenu modifié → pas d'animation
        if (payload.eventType === 'INSERT') startCast(payload.new.position);
        setCells(prev => ({ ...prev, [payload.new.position]: payload.new }));
      }
    });

    // Gages dévoilés (par le streamer) ou remis face cachée (par un admin)
    listen('gages', 'bingo_gages_public', (payload) => {
      if (!activeRef.current) return;
      if (payload.eventType === 'DELETE') {
        const key = payload.old?.line_key;
        if (!key) return;
        setGages(prev => { const n = { ...prev }; delete n[key]; return n; });
        setGageFlip(f => { const n = { ...f }; delete n[key]; return n; });
        setZoom(z => (z && z.line_key === key ? null : z));
      } else if (payload.new) {
        if (payload.eventType === 'INSERT') setGageFlip(f => ({ ...f, [payload.new.line_key]: true }));
        setGages(prev => ({ ...prev, [payload.new.line_key]: payload.new }));
      }
    });

    load(false);
    return () => { channels.forEach(ch => supabase.removeChannel(ch)); };
  }, [load, applyActive, startCast, endCast]);

  // Lignes réalisées = toutes leurs cases sont révélées
  const lines = useMemo(() => bingoLines(grid.cols, grid.rows), [grid]);
  const lineMap = useMemo(() => Object.fromEntries(lines.map(l => [l.key, l])), [lines]);
  const isComplete = (key) => !!lineMap[key] && lineMap[key].positions.every(p => cells[p]);
  const puzzleRatio = useImageRatio(images.puzzle);   // prêt quand l'image du casse-tête est chargée

  const revealGage = async (key) => {
    if (readOnly || busyGage) return;
    setBusyGage(key);
    setError(null);
    try {
      const g = await bingoApi.revealGage(key);
      setGages(prev => ({ ...prev, [key]: g }));
      setGageFlip(f => ({ ...f, [key]: true }));
    } catch (e) { setError(e.message); }
    finally { setBusyGage(null); }
  };

  if (loading) return <div className="loading">Chargement...</div>;

  const { cols, rows } = grid;
  const total = cols * rows;
  const revealedCount = Object.keys(cells).filter(k => Number(k) < total).length;
  // Apparition : plus la carte est loin du centre de la grille (gages inclus), plus elle apparaît tard
  const cx = cols / 2, cy = (rows + 1) / 2;
  const delayAt = (r, c) => Math.round(Math.hypot(c - cx, r - cy) * 70);

  const gridStyle = {
    '--cols': cols, '--rows': rows, '--ccols': cols + 1, '--crows': rows + 1,
    ...(images.puzzle ? { '--puzzle-img': cssUrl(images.puzzle) } : {}),
    ...(puzzleRatio ? { '--ar': puzzleRatio } : {}),
    ...(images.gage ? { '--gage-img': cssUrl(images.gage) } : {}),
    ...(images.full ? { '--full-img': cssUrl(images.full) } : {}),
  };

  const renderCell = (pos, baseStyle) => {
    const c = cells[pos];
    const pz = puzzleRatio ? ' puzzle' : '';
    // --c / --r : colonne et ligne de la case → quel morceau de l'image elle montre
    const style = { ...baseStyle, '--c': pos % cols, '--r': Math.floor(pos / cols) };
    if (c && casting[pos]) {
      return (
        <div key={`${pos}-cast`} style={style} className={`bingo-tile covered casting${pz}`} aria-hidden="true">
          <div className="bingo-cast">
            <LottieCanvas src={ANIM.reveal} maxSize={500}
              onComplete={() => endCast(pos, true)} onError={() => endCast(pos, true)} />
          </div>
        </div>
      );
    }
    return c ? (
      <button key={`${pos}-${c.revealed_at}`} style={style}
        className={`bingo-tile revealed${flipped[pos] ? ' flip' : ''}`}
        onClick={() => setZoom(c)}>
        <TileContent text={c.text} image_url={c.image_url} />
      </button>
    ) : (
      <div key={pos} style={style} className={`bingo-tile covered${pz}`} aria-hidden="true">{!pz && <span>✦</span>}</div>
    );
  };

  // Carte « gage » : dos de carte (terne / prête) ou face dévoilée
  const renderGage = (key, style) => {
    if (!lineMap[key]) return <div key={key} className="bingo-spacer" aria-hidden="true" />;
    const label = lineLabel(key);
    const full = key === 'full';
    const g = gages[key];
    if (g) {
      return (
        <button key={key} style={style} title={`Gage — ${label}`}
          className={`gage-card face${full ? ' full-card' : ''}${gageFlip[key] ? ' flip' : ''}`}
          onClick={() => setZoom({ ...g, gage: true, title: `Gage — ${label}` })}>
          <span className="gage-ribbon">{full ? 'TOUPET SUPRÊME' : 'GAGE'}</span>
          <TileContent text={g.text} image_url={g.image_url} />
        </button>
      );
    }
    const ready = isComplete(key);
    const canClick = ready && !readOnly;
    const title = !ready ? `${label} : pas encore réalisée`
      : readOnly ? 'Seul le streamer peut dévoiler ce gage' : `Dévoiler le gage — ${label}`;
    return (
      <button key={key} style={style} title={title}
        className={`gage-card back${full ? ' full-card' : ''}${(full ? images.full : images.gage) ? ' img' : ''}${ready ? (readOnly ? ' preview' : ' ready') : ' dim'}${busyGage === key ? ' busy' : ''}`}
        disabled={!canClick || busyGage === key}
        onClick={() => revealGage(key)}>
        <span className="gage-emblem">
          <span className="gage-gem">♦</span>
          <span className="gage-label">{ready ? (readOnly ? label : 'Dévoiler') : (full ? 'Toupet suprême' : 'Gage')}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="bingo-wrap">
      {error && <div className="error-box" onClick={() => setError(null)}>{error}</div>}

      {!active ? (
        <div className="bingo-waiting">
          <div className="bingo-waiting-orb">
            {prefersReducedMotion()
              ? <span className="bingo-waiting-static">⏳</span>
              : <LottieCanvas src={ANIM.waiting} loop maxSize={600} />}
          </div>
        </div>
      ) : (
        <>
          <div className="bingo-status">
            <span className={`bingo-live-dot${live ? ' on' : ''}`} />
            {live ? 'En direct' : 'Connexion…'} · {revealedCount} / {total} cases révélées
          </div>

          {/* Tout tient à l'écran, sans défilement : la grille s'adapte à la place disponible.
              Cartes gage : colonne de droite (lignes), rangée du bas (colonnes), coin (diagonale),
              puis le toupet suprême sur toute la largeur, tout en bas. */}
          <div className="bingo-stage">
            <div className={`bingo-grid${intro ? ' intro' : ''}`} style={gridStyle}>
              {Array.from({ length: rows + 1 }, (_, r) =>
                Array.from({ length: cols + 1 }, (_, c) => {
                  const style = { '--d': `${delayAt(r, c)}ms` };
                  if (r < rows && c < cols) return renderCell(r * cols + c, style);
                  if (r < rows) return renderGage(`row-${r}`, style);
                  if (c < cols) return renderGage(`col-${c}`, style);
                  return renderGage('diag', style);
                })
              ).flat()}
              {renderGage('full', { '--d': `${delayAt(rows + 1, cols / 2)}ms` })}
            </div>
          </div>
        </>
      )}

      {confetti && (
        <div className="bingo-confetti" aria-hidden="true">
          <LottieCanvas src={ANIM.confetti} maxSize={1400}
            onComplete={() => setConfetti(false)} onError={() => setConfetti(false)} />
        </div>
      )}

      {zoom && (
        <div className="modal-overlay" onClick={() => setZoom(null)}>
          <div className="modal bingo-zoom" onClick={e => e.stopPropagation()}>
            {zoom.gage && <h3 className="modal-title">{zoom.title}</h3>}
            {zoom.image_url && <img src={zoom.image_url} alt="" className="bingo-zoom-img" />}
            {zoom.text && <div className="bingo-zoom-text">{zoom.text}</div>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setZoom(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
