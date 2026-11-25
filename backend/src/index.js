import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

// ─── Configuration ────────────────────────────────────────────────────────────
const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'].filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Variables d'environnement manquantes : ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();

// FRONTEND_URL : une ou plusieurs adresses autorisées, séparées par des virgules
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
}));
app.use(express.json({ limit: '20mb' }));   // images du Bingo envoyées en base64

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const JWT_SECRET = process.env.JWT_SECRET;

// Rôles (même table que l'app principale) : level bas = plus de droits
// superadmin = 1, admin = 2, captain = 3, player = 99
const ROLE_PLAYER = 99;

// ─── Middlewares ──────────────────────────────────────────────────────────────
function extractToken(req, res) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) { res.status(401).json({ error: 'Token manquant' }); return null; }
  try {
    return { token, user: jwt.verify(token, JWT_SECRET) };
  } catch {
    res.status(401).json({ error: 'Token invalide' });
    return null;
  }
}

function authMiddleware(req, res, next) {
  const result = extractToken(req, res);
  if (!result) return;
  req.user = result.user;
  req.token = result.token;
  next();
}

// requireLevel(n) : autorise si role_level <= n (superadmin = 1 passe partout)
function requireLevel(level) {
  return (req, res, next) => {
    const result = extractToken(req, res);
    if (!result) return;
    req.user = result.user;
    req.token = result.token;
    if ((req.user.role_level ?? ROLE_PLAYER) > level) {
      return res.status(403).json({ error: 'Permissions insuffisantes' });
    }
    next();
  };
}

// ─── Token / utilisateur ──────────────────────────────────────────────────────
function makeToken(user) {
  const roleLevel = user.roles?.level ?? (user.is_admin ? 2 : ROLE_PLAYER);
  return jwt.sign({
    id: user.id,
    username: user.username,
    is_admin: roleLevel <= 2,
    role_name: user.roles?.name ?? (user.is_admin ? 'admin' : 'player'),
    role_level: roleLevel,
    must_change_password: user.must_change_password || false,
  }, JWT_SECRET, { expiresIn: '7d' });
}

function safeUser(user) {
  const { password_hash, temp_password_hash, ...safe } = user;
  return safe;
}

// ─── Santé (Render health check / réveil du service) ─────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// ─── Connexion (mêmes comptes que l'app principale) ───────────────────────────
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Champs requis' });

  const { data: user } = await supabase.from('users')
    .select('*, roles(id, name, level, permissions)')
    .eq('username', String(username).trim().toLowerCase()).single();
  if (!user) return res.status(401).json({ error: 'Identifiants invalides' });

  // Mot de passe temporaire (réinitialisé par un admin) → changement obligatoire
  if (user.temp_password_hash) {
    const tempValid = await bcrypt.compare(password, user.temp_password_hash);
    if (tempValid) {
      await supabase.from('users').update({ must_change_password: true }).eq('id', user.id);
      user.must_change_password = true;
      return res.json({ token: makeToken(user), user: safeUser(user) });
    }
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

  res.json({ token: makeToken(user), user: safeUser(user) });
});

app.get('/auth/me', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('users')
    .select('*, roles(id, name, level, permissions)')
    .eq('id', req.user.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: safeUser(data), token: makeToken(data) });
});

app.post('/auth/change-password', authMiddleware, async (req, res) => {
  const { new_password } = req.body || {};
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'Mot de passe trop court (6 car. min)' });
  }
  const hash = await bcrypt.hash(new_password, 10);
  const { data, error } = await supabase.from('users')
    .update({ password_hash: hash, must_change_password: false, temp_password_hash: null })
    .eq('id', req.user.id).select('*, roles(id, name, level, permissions)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ token: makeToken(data), user: safeUser(data) });
});

// ─── Bingo ────────────────────────────────────────────────────────────────────
// Config dans la table `settings` (Supabase) : bingo_label, bingo_admins, bingo_players,
// bingo_cols, bingo_rows. Rien n'est gardé en mémoire/fichier sur le serveur.
//   • bingo_cells  : contenu complet de chaque case (admins seulement, aucune policy RLS)
//   • bingo_public : copie des cases RÉVÉLÉES seulement (lisible par les joueurs + temps réel)
// Voir supabase_bingo.sql pour créer les tables.
const BINGO_DEFAULT_ADMINS = ['stephane'];
const BINGO_BUCKET = 'avatars';   // bucket existant, images rangées sous bingo/

function parseNameList(raw, fallback = []) {
  if (raw === undefined || raw === null) return fallback;
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.map(u => String(u).trim().toLowerCase()).filter(Boolean) : fallback;
  } catch { return fallback; }
}
const clampInt = (v, min, max, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

async function getBingoConfig() {
  const { data } = await supabase.from('settings').select('*')
    .in('key', ['bingo_label', 'bingo_admins', 'bingo_players', 'bingo_cols', 'bingo_rows']);
  const m = {};
  (data || []).forEach(s => { m[s.key] = s.value; });
  return {
    label:   m['bingo_label'] || 'Bingo',
    admins:  parseNameList(m['bingo_admins'], BINGO_DEFAULT_ADMINS),
    players: parseNameList(m['bingo_players'], []),
    cols:    clampInt(m['bingo_cols'], 1, 10, 5),
    rows:    clampInt(m['bingo_rows'], 1, 10, 5),
  };
}

// Grille ouverte aux joueurs ? (table bingo_state, ligne id=1 — voir supabase_bingo.sql)
// Tant qu'elle est fermée, bingo_public reste vide : aucun contenu n'est exposé aux joueurs.
async function getBingoActive() {
  const { data } = await supabase.from('bingo_state').select('active').eq('id', 1).maybeSingle();
  return !!data?.active;
}

function bingoRoleOf(username, cfg) {
  const me = String(username || '').trim().toLowerCase();
  if (cfg.admins.includes(me)) return 'admin';
  if (cfg.players.includes(me)) return 'player';
  return null;
}

// À placer APRÈS authMiddleware : requireBingo('admin') ou requireBingo('player', 'admin')
function requireBingo(...allowed) {
  return async (req, res, next) => {
    try {
      const cfg = await getBingoConfig();
      const role = bingoRoleOf(req.user?.username, cfg);
      if (!role || !allowed.includes(role)) return res.status(403).json({ error: 'Accès refusé' });
      req.bingoCfg = cfg;
      req.bingoRole = role;
      next();
    } catch (e) { res.status(500).json({ error: e.message }); }
  };
}

function bingoPosition(req, res) {
  const p = parseInt(req.params.position, 10);
  const max = req.bingoCfg.cols * req.bingoCfg.rows;
  if (!Number.isInteger(p) || p < 0 || p >= max) {
    res.status(400).json({ error: 'Position invalide' });
    return null;
  }
  return p;
}

function bingoStoragePath(url) {
  const marker = `/object/public/${BINGO_BUCKET}/`;
  const i = (url || '').indexOf(marker);
  if (i < 0) return null;
  return decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
}
async function bingoRemoveImage(url) {
  const path = bingoStoragePath(url);
  if (!path || !path.startsWith('bingo/')) return;
  try { await supabase.storage.from(BINGO_BUCKET).remove([path]); } catch {}
}

// Mon accès (rôle) — sert à afficher ou non le bouton
app.get('/bingo/access', authMiddleware, async (req, res) => {
  try {
    const cfg = await getBingoConfig();
    const role = bingoRoleOf(req.user.username, cfg);
    res.json(role ? { role, label: cfg.label, cols: cfg.cols, rows: cfg.rows } : { role: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Vue joueur : SEULEMENT les cases révélées, et seulement si la grille est ouverte
app.get('/bingo/player', authMiddleware, requireBingo('player', 'admin'), async (req, res) => {
  const { cols, rows, label } = req.bingoCfg;
  const active = await getBingoActive();
  if (!active) return res.json({ cols, rows, label, active: false, cells: [] });
  const { data, error } = await supabase.from('bingo_public')
    .select('position, text, image_url, revealed_at');
  if (error) return res.status(500).json({ error: error.message });
  const cells = (data || []).filter(c => c.position < cols * rows);
  res.json({ cols, rows, label, active: true, cells });
});

// Vue admin : toutes les cases
app.get('/bingo/admin', authMiddleware, requireBingo('admin'), async (req, res) => {
  const { cols, rows, label } = req.bingoCfg;
  const { data, error } = await supabase.from('bingo_cells').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ cols, rows, label, active: await getBingoActive(),
             cells: (data || []).filter(c => c.position < cols * rows) });
});

// Ouvrir / fermer la grille aux joueurs (admin)
// Ouverture : on publie d'abord les cases déjà révélées, PUIS on bascule l'état
// (les joueurs reçoivent l'événement et trouvent les données prêtes).
// Fermeture : on bascule l'état, puis on vide la copie publique.
app.post('/bingo/admin/active', authMiddleware, requireBingo('admin'), async (req, res) => {
  try {
    const active = !!req.body.active;
    const now = new Date().toISOString();
    if (active) {
      const total = req.bingoCfg.cols * req.bingoCfg.rows;
      const { data: revealed } = await supabase.from('bingo_cells')
        .select('position, text, image_url').eq('revealed', true).lt('position', total);
      if (revealed?.length) {
        const { error } = await supabase.from('bingo_public')
          .upsert(revealed.map(c => ({ ...c, revealed_at: now })), { onConflict: 'position' });
        if (error) return res.status(500).json({ error: error.message });
      }
    }
    const { error } = await supabase.from('bingo_state')
      .upsert({ id: 1, active, updated_by: req.user.username, updated_at: now }, { onConflict: 'id' });
    if (error) return res.status(500).json({ error: error.message });
    if (!active) await supabase.from('bingo_public').delete().gte('position', 0);
    res.json({ active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Modifier le texte / l'image d'une case (admin)
app.put('/bingo/admin/cells/:position', authMiddleware, requireBingo('admin'), async (req, res) => {
  try {
    const position = bingoPosition(req, res);
    if (position === null) return;
    const { text, image, remove_image } = req.body;

    const { data: existing } = await supabase.from('bingo_cells')
      .select('*').eq('position', position).maybeSingle();

    let image_url = existing?.image_url || null;
    if (remove_image && image_url) { await bingoRemoveImage(image_url); image_url = null; }

    if (image?.base64) {
      const ct = String(image.contentType || '');
      if (!ct.startsWith('image/')) return res.status(400).json({ error: 'Le fichier doit être une image' });
      const ext = (ct.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*$/, '').replace(/[^a-z0-9]/gi, '') || 'png';
      const path = `bingo/${position}-${randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BINGO_BUCKET)
        .upload(path, Buffer.from(image.base64, 'base64'), { contentType: ct, upsert: false });
      if (upErr) return res.status(500).json({ error: upErr.message });
      const { data: pub } = supabase.storage.from(BINGO_BUCKET).getPublicUrl(path);
      if (image_url) await bingoRemoveImage(image_url);
      image_url = pub.publicUrl;
    }

    const row = {
      position,
      text: text !== undefined ? (String(text).trim() || null) : (existing?.text ?? null),
      image_url,
      revealed: existing?.revealed || false,
      updated_by: req.user.username,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('bingo_cells').upsert(row, { onConflict: 'position' });
    if (error) return res.status(500).json({ error: error.message });

    // Case déjà révélée ET grille ouverte : on met à jour la copie visible par les joueurs
    if (row.revealed && await getBingoActive()) {
      await supabase.from('bingo_public').upsert(
        { position, text: row.text, image_url: row.image_url, revealed_at: new Date().toISOString() },
        { onConflict: 'position' });
    }
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Révéler / cacher une case (admin)
app.post('/bingo/admin/cells/:position/reveal', authMiddleware, requireBingo('admin'), async (req, res) => {
  try {
    const position = bingoPosition(req, res);
    if (position === null) return;
    const revealed = !!req.body.revealed;

    const { data: cell } = await supabase.from('bingo_cells')
      .select('*').eq('position', position).maybeSingle();
    if (revealed && !cell?.text && !cell?.image_url) {
      return res.status(400).json({ error: 'Ajoute du texte ou une image avant de révéler cette case' });
    }
    if (!cell) return res.json({ position, text: null, image_url: null, revealed: false });

    if (revealed) {
      // Grille fermée : la case est marquée « révélée » mais n'est publiée qu'à l'ouverture
      if (await getBingoActive()) {
        const { error } = await supabase.from('bingo_public').upsert(
          { position, text: cell.text, image_url: cell.image_url, revealed_at: new Date().toISOString() },
          { onConflict: 'position' });
        if (error) return res.status(500).json({ error: error.message });
      }
    } else {
      const { error } = await supabase.from('bingo_public').delete().eq('position', position);
      if (error) return res.status(500).json({ error: error.message });
    }
    const { data: updated, error } = await supabase.from('bingo_cells')
      .update({ revealed, updated_by: req.user.username, updated_at: new Date().toISOString() })
      .eq('position', position).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Paramètres : qui voit quoi, taille de la grille (superadmin)
app.get('/admin/bingo-access', requireLevel(1), async (req, res) => {
  try { res.json(await getBingoConfig()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/bingo-access', requireLevel(1), async (req, res) => {
  try {
    const { label, admins, players, cols, rows } = req.body;
    const clean = list => JSON.stringify((list || []).map(u => String(u).trim().toLowerCase()).filter(Boolean));
    const updates = [];
    if (label !== undefined)   updates.push({ key: 'bingo_label',   value: String(label).trim().slice(0, 40) || 'Bingo' });
    if (Array.isArray(admins))  updates.push({ key: 'bingo_admins',  value: clean(admins) });
    if (Array.isArray(players)) updates.push({ key: 'bingo_players', value: clean(players) });
    if (cols !== undefined)    updates.push({ key: 'bingo_cols',    value: String(clampInt(cols, 1, 10, 5)) });
    if (rows !== undefined)    updates.push({ key: 'bingo_rows',    value: String(clampInt(rows, 1, 10, 5)) });
    for (const u of updates) await supabase.from('settings').upsert(u, { onConflict: 'key' });
    res.json(await getBingoConfig());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Liste minimale des usagers, pour attribuer les rôles Bingo (superadmin seulement)
app.get('/admin/users', requireLevel(1), async (req, res) => {
  const { data, error } = await supabase.from('users').select('id, username').order('username');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🎯 Delice_TV — API sur le port ${PORT}`));
