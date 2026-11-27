import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { randomUUID, randomInt } from 'crypto';
import { MODULES, cleanModuleKeys, normalizeModuleKeys, computeModules, canResetPassword } from './modules.js';
import { bingoLines } from './lines.js';

dotenv.config();

// ─── Configuration ────────────────────────────────────────────────────────────
const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'].filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Variables d'environnement manquantes : ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);   // Render / Netlify : vraie adresse IP du visiteur (limitation des tentatives)

// FRONTEND_URL : une ou plusieurs adresses autorisées, séparées par des virgules
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
}));
app.use(express.json({ limit: '20mb' }));   // images (avatars, Bingo) envoyées en base64

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const JWT_SECRET = process.env.JWT_SECRET;
const BUCKET = 'avatars';   // bucket Supabase existant : avatars sous delice/, images du Bingo sous bingo/

const clampInt = (v, min, max, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

// Base pas à jour (table manquante) → message clair plutôt qu'une erreur technique
function friendlyDbError(e) {
  const msg = e?.message || String(e);
  if (e?.code === '42P01' || e?.code === 'PGRST205' || /schema cache|does not exist/i.test(msg)) {
    return "La base de données n'est pas à jour : exécute supabase_delice.sql et supabase_bingo.sql dans Supabase (SQL Editor). Détail : " + msg;
  }
  return msg;
}

// ─── Limitation des abus (en mémoire, par adresse IP) ────────────────────────
// On ne compte que ce qui compte vraiment : les comptes créés et les échecs de connexion
// (une simple faute de frappe ne bloque donc personne).
const hits = new Map();
function makeLimiter(name, max, windowMs) {
  const recent = (req) => (hits.get(`${name}:${req.ip}`) || []).filter(t => Date.now() - t < windowMs);
  return {
    guard: (req, res, next) => {
      const r = recent(req);
      hits.set(`${name}:${req.ip}`, r);
      if (r.length >= max) return res.status(429).json({ error: 'Trop de tentatives, réessaie plus tard' });
      next();
    },
    record: (req) => { const r = recent(req); r.push(Date.now()); hits.set(`${name}:${req.ip}`, r); },
  };
}
const registerLimit = makeLimiter('register', 5, 3600e3);      // 5 comptes créés par heure et par IP
const loginLimit    = makeLimiter('login', 10, 15 * 60e3);     // 10 échecs de connexion par 15 min et par IP
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some(t => now - t < 3600e3)) hits.delete(k);
}, 600e3).unref();

// ─── Utilisateurs, token, accès ───────────────────────────────────────────────
// Colonnes renvoyées au navigateur (jamais les mots de passe)
const USER_COLS = 'id, username, display_name, avatar_type, avatar_url, avatar_url_external, avatar_color, avatar_text_color, is_superadmin, must_change_password, created_at';

function makeToken(user) {
  return jwt.sign({
    id: user.id,
    username: user.username,
    must_change_password: user.must_change_password || false,
  }, JWT_SECRET, { expiresIn: '7d' });
}

function safeUser(user) {
  const { password_hash, temp_password_hash, ...safe } = user;
  return safe;
}

// Droits d'un usager : lus dans la base À CHAQUE requête (un changement de groupe s'applique tout de suite)
async function loadAccess(userId) {
  const { data: u, error } = await supabase.from('delice_users').select('id, is_superadmin').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!u) return null;
  const { data: ug, error: e2 } = await supabase.from('delice_user_groups').select('group_id').eq('user_id', userId);
  if (e2) throw e2;
  const groupIds = (ug || []).map(r => r.group_id);
  let groups = [];
  let keys = [];
  if (groupIds.length) {
    const [g, m] = await Promise.all([
      supabase.from('delice_groups').select('id, name, color').in('id', groupIds),
      supabase.from('delice_group_modules').select('module_key').in('group_id', groupIds),
    ]);
    if (g.error) throw g.error;
    if (m.error) throw m.error;
    groups = g.data || [];
    keys = (m.data || []).map(r => r.module_key);
  }
  const isSuper = !!u.is_superadmin;
  return { isSuper, groups, modules: computeModules({ isSuper, groupModuleKeys: keys }) };
}

const accessPayload = (a) => ({ is_superadmin: a.isSuper, modules: a.modules, groups: a.groups });

function extractToken(req, res) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) { res.status(401).json({ error: 'Token manquant' }); return null; }
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'Token invalide' });
    return null;
  }
}

// Connecté (compte existant)
function authMiddleware(req, res, next) {
  const user = extractToken(req, res);
  if (!user) return;
  req.user = user;
  next();
}

// Connecté ET possède au moins un des modules (via ses groupes). Le super admin passe toujours.
function requireModule(...keys) {
  return async (req, res, next) => {
    const user = extractToken(req, res);
    if (!user) return;
    req.user = user;
    try {
      const access = await loadAccess(user.id);
      if (!access) return res.status(401).json({ error: 'Compte introuvable' });
      req.access = access;
      if (access.isSuper || keys.some(k => access.modules.includes(k))) return next();
      res.status(403).json({ error: 'Accès refusé' });
    } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
  };
}

// Super admin seulement (gestion des usagers, groupes, réglages)
async function requireSuper(req, res, next) {
  const user = extractToken(req, res);
  if (!user) return;
  req.user = user;
  try {
    const access = await loadAccess(user.id);
    if (!access) return res.status(401).json({ error: 'Compte introuvable' });
    if (!access.isSuper) return res.status(403).json({ error: 'Réservé au super admin' });
    req.access = access;
    next();
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
}

// Connecté avec un compte qui existe — AUCUN groupe nécessaire (ex. modifier son propre profil)
async function requireUser(req, res, next) {
  const user = extractToken(req, res);
  if (!user) return;
  req.user = user;
  try {
    const access = await loadAccess(user.id);
    if (!access) return res.status(401).json({ error: 'Compte introuvable' });
    req.access = access;
    next();
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
}

// ─── Santé (Render health check / réveil du service) ─────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// ─── Inscription / connexion ──────────────────────────────────────────────────
// Un nouvel inscrit n'a AUCUN groupe : il ne voit rien tant qu'un super admin ne l'a pas ajouté à un groupe.
app.post('/auth/register', registerLimit.guard, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
      return res.status(400).json({ error: "Nom d'usager : 3 à 24 caractères (lettres, chiffres, _ . -)" });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum)' });

    const { data: existing, error: exErr } = await supabase.from('delice_users').select('id').eq('username', username).maybeSingle();
    if (exErr) return res.status(500).json({ error: friendlyDbError(exErr) });
    if (existing) return res.status(409).json({ error: "Nom d'usager déjà pris" });

    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('delice_users')
      .insert({ username, password_hash: hash }).select(USER_COLS).single();
    if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? "Nom d'usager déjà pris" : friendlyDbError(error) });

    registerLimit.record(req);
    const access = await loadAccess(data.id);
    res.json({ token: makeToken(data), user: data, access: accessPayload(access) });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

app.post('/auth/login', loginLimit.guard, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Champs requis' });

    const { data: user, error } = await supabase.from('delice_users')
      .select('*').eq('username', String(username).trim().toLowerCase()).maybeSingle();
    if (error) return res.status(500).json({ error: friendlyDbError(error) });
    if (!user) { loginLimit.record(req); return res.status(401).json({ error: 'Identifiants invalides' }); }

    // Mot de passe temporaire (réinitialisé par le super admin) → changement obligatoire
    let mustChange = false;
    let valid = false;
    if (user.temp_password_hash && await bcrypt.compare(password, user.temp_password_hash)) {
      valid = true;
      mustChange = true;
      await supabase.from('delice_users').update({ must_change_password: true }).eq('id', user.id);
      user.must_change_password = true;
    }
    if (!valid) valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) { loginLimit.record(req); return res.status(401).json({ error: 'Identifiants invalides' }); }

    const access = await loadAccess(user.id);
    res.json({ token: makeToken(user), user: safeUser(user), access: accessPayload(access), must_change_password: mustChange || !!user.must_change_password });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

app.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('delice_users').select(USER_COLS).eq('id', req.user.id).maybeSingle();
    if (error) return res.status(500).json({ error: friendlyDbError(error) });
    if (!data) return res.status(401).json({ error: 'Compte introuvable' });
    const access = await loadAccess(data.id);
    res.json({ user: data, access: accessPayload(access), token: makeToken(data) });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

app.post('/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { new_password } = req.body || {};
    if (!new_password || String(new_password).length < 6) {
      return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum)' });
    }
    const hash = await bcrypt.hash(String(new_password), 10);
    const { data, error } = await supabase.from('delice_users')
      .update({ password_hash: hash, must_change_password: false, temp_password_hash: null })
      .eq('id', req.user.id).select(USER_COLS).single();
    if (error) return res.status(500).json({ error: friendlyDbError(error) });
    const access = await loadAccess(data.id);
    res.json({ token: makeToken(data), user: data, access: accessPayload(access) });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

// ─── Profil : toute personne connectée peut modifier le sien, même sans groupe ──────────────────────────────────────────────
app.put('/profile', requireUser, async (req, res) => {
  try {
    const { display_name, avatar_type, avatar_color, avatar_text_color, avatar_url_external } = req.body || {};
    const updates = {};
    if (display_name !== undefined) updates.display_name = String(display_name).trim().slice(0, 32) || null;
    if (avatar_type !== undefined) {
      if (!['letter', 'upload', 'url'].includes(avatar_type)) return res.status(400).json({ error: "Type d'avatar invalide" });
      updates.avatar_type = avatar_type;
    }
    if (avatar_color !== undefined) {
      if (!isHex(avatar_color)) return res.status(400).json({ error: 'Couleur invalide' });
      updates.avatar_color = avatar_color;
    }
    if (avatar_text_color !== undefined) {
      if (!isHex(avatar_text_color)) return res.status(400).json({ error: 'Couleur invalide' });
      updates.avatar_text_color = avatar_text_color;
    }
    if (avatar_url_external !== undefined) {
      const u = String(avatar_url_external || '').trim();
      if (u && !/^https?:\/\//i.test(u)) return res.status(400).json({ error: 'Le lien doit commencer par http:// ou https://' });
      updates.avatar_url_external = u || null;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Rien à modifier' });
    const { data, error } = await supabase.from('delice_users').update(updates).eq('id', req.user.id).select(USER_COLS).single();
    if (error) return res.status(500).json({ error: friendlyDbError(error) });
    res.json({ user: data });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

// Photo de profil : l'image est recadrée dans le navigateur (cercle), puis envoyée ici
app.post('/profile/avatar/upload', requireUser, async (req, res) => {
  try {
    const { base64, contentType } = req.body || {};
    if (!base64 || !contentType) return res.status(400).json({ error: 'base64 et contentType requis' });
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
    if (!allowed.includes(contentType)) return res.status(400).json({ error: 'Format non supporté' });
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 10 * 1024 * 1024) return res.status(400).json({ error: 'Image trop grande (10 Mo max)' });

    const path = `delice/${req.user.id}/avatar.png`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
    if (upErr) return res.status(500).json({ error: upErr.message });
    const avatar_url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl + '?t=' + Date.now();

    const { data, error } = await supabase.from('delice_users')
      .update({ avatar_url, avatar_type: 'upload' }).eq('id', req.user.id).select(USER_COLS).single();
    if (error) return res.status(500).json({ error: friendlyDbError(error) });
    res.json({ user: data });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

// ─── Gestion (super admin) : usagers, groupes, modules ────────────────────────
function generateTempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sans caractères ambigus
  return Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

app.get('/admin/modules', requireSuper, (req, res) => res.json(MODULES));

// Section « Profils des joueurs » (ou super admin). Renvoie aussi la liste des groupes (nom, couleur)
// et, pour chaque usager, s'il est permis de réinitialiser son mot de passe.
app.get('/admin/users', requireModule('settings.users'), async (req, res) => {
  try {
    const [u, ug, gm, g] = await Promise.all([
      supabase.from('delice_users').select(USER_COLS).order('username'),
      supabase.from('delice_user_groups').select('user_id, group_id'),
      supabase.from('delice_group_modules').select('group_id, module_key'),
      supabase.from('delice_groups').select('id, name, color').order('name'),
    ]);
    for (const r of [u, ug, gm, g]) if (r.error) return res.status(500).json({ error: friendlyDbError(r.error) });

    const byUser = {}, byGroup = {};
    (ug.data || []).forEach(r => { (byUser[r.user_id] ||= []).push(r.group_id); });
    (gm.data || []).forEach(r => { (byGroup[r.group_id] ||= []).push(r.module_key); });

    const users = (u.data || []).map(x => {
      const groupIds = byUser[x.id] || [];
      const targetModules = computeModules({ isSuper: x.is_superadmin, groupModuleKeys: groupIds.flatMap(id => byGroup[id] || []) });
      return {
        ...x,
        group_ids: groupIds,
        can_reset: canResetPassword({
          requesterIsSuper: req.access.isSuper, requesterModules: req.access.modules,
          targetIsSuper: x.is_superadmin, targetModules,
        }),
      };
    });
    res.json({ users, groups: g.data || [] });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

// Remplace les groupes d'un usager (une personne peut être dans plusieurs groupes)
app.put('/admin/users/:id/groups', requireSuper, async (req, res) => {
  try {
    const userId = req.params.id;
    const wanted = [...new Set(Array.isArray(req.body?.group_ids) ? req.body.group_ids.map(String) : [])];
    const { data: user } = await supabase.from('delice_users').select('id').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: 'Usager introuvable' });

    const { data: groups, error: gErr } = await supabase.from('delice_groups').select('id');
    if (gErr) return res.status(500).json({ error: friendlyDbError(gErr) });
    const valid = new Set((groups || []).map(g => g.id));
    const ids = wanted.filter(id => valid.has(id));

    const { error: delErr } = await supabase.from('delice_user_groups').delete().eq('user_id', userId);
    if (delErr) return res.status(500).json({ error: friendlyDbError(delErr) });
    if (ids.length) {
      const { error } = await supabase.from('delice_user_groups').insert(ids.map(group_id => ({ user_id: userId, group_id })));
      if (error) return res.status(500).json({ error: friendlyDbError(error) });
    }
    res.json({ user_id: userId, group_ids: ids });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

// Mot de passe temporaire (affiché une seule fois) : l'usager devra le changer.
// Réinitialiser = pouvoir se connecter à sa place → refusé pour un compte qui a PLUS de droits que soi.
app.post('/admin/users/:id/reset-password', requireModule('settings.users'), async (req, res) => {
  try {
    const { data: target, error: tErr } = await supabase.from('delice_users')
      .select('id, username, is_superadmin').eq('id', req.params.id).maybeSingle();
    if (tErr) return res.status(500).json({ error: friendlyDbError(tErr) });
    if (!target) return res.status(404).json({ error: 'Usager introuvable' });

    const targetAccess = await loadAccess(target.id);
    const allowed = canResetPassword({
      requesterIsSuper: req.access.isSuper, requesterModules: req.access.modules,
      targetIsSuper: target.is_superadmin, targetModules: targetAccess?.modules || [],
    });
    if (!allowed) return res.status(403).json({ error: 'Tu ne peux pas réinitialiser ce compte : il a plus de droits que toi' });

    const temp = generateTempPassword();
    const hash = await bcrypt.hash(temp, 10);
    const { error } = await supabase.from('delice_users').update({ temp_password_hash: hash }).eq('id', target.id);
    if (error) return res.status(500).json({ error: friendlyDbError(error) });
    res.json({ username: target.username, temp_password: temp });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

app.delete('/admin/users/:id', requireSuper, async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas supprimer ton propre compte' });
    const { data: target } = await supabase.from('delice_users').select('id, is_superadmin').eq('id', req.params.id).maybeSingle();
    if (!target) return res.status(404).json({ error: 'Usager introuvable' });
    if (target.is_superadmin) return res.status(400).json({ error: 'Impossible de supprimer un super admin' });
    const { error } = await supabase.from('delice_users').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: friendlyDbError(error) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

async function listGroups() {
  const [g, gm, ug] = await Promise.all([
    supabase.from('delice_groups').select('*').order('name'),
    supabase.from('delice_group_modules').select('group_id, module_key'),
    supabase.from('delice_user_groups').select('group_id'),
  ]);
  for (const r of [g, gm, ug]) if (r.error) throw r.error;
  const mods = {}, counts = {};
  (gm.data || []).forEach(r => { (mods[r.group_id] ||= []).push(r.module_key); });
  (ug.data || []).forEach(r => { counts[r.group_id] = (counts[r.group_id] || 0) + 1; });
  return (g.data || []).map(x => ({ ...x, module_keys: normalizeModuleKeys(mods[x.id]), member_count: counts[x.id] || 0 }));
}

app.get('/admin/groups', requireSuper, async (req, res) => {
  try { res.json(await listGroups()); }
  catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

app.post('/admin/groups', requireSuper, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 40) return res.status(400).json({ error: 'Nom de groupe requis (40 caractères max)' });
    const color = isHex(req.body?.color) ? req.body.color : '#d4af37';
    const description = String(req.body?.description || '').trim().slice(0, 200) || null;
    const { data, error } = await supabase.from('delice_groups').insert({ name, color, description }).select().single();
    if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'Un groupe porte déjà ce nom' : friendlyDbError(error) });
    res.json({ ...data, module_keys: [], member_count: 0 });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

app.put('/admin/groups/:id', requireSuper, async (req, res) => {
  try {
    const id = req.params.id;
    const { name, description, color, module_keys } = req.body || {};
    const updates = {};
    if (name !== undefined) {
      const n = String(name).trim();
      if (!n || n.length > 40) return res.status(400).json({ error: 'Nom de groupe requis (40 caractères max)' });
      updates.name = n;
    }
    if (description !== undefined) updates.description = String(description || '').trim().slice(0, 200) || null;
    if (color !== undefined) {
      if (!isHex(color)) return res.status(400).json({ error: 'Couleur invalide' });
      updates.color = color;
    }
    if (Object.keys(updates).length) {
      const { error } = await supabase.from('delice_groups').update(updates).eq('id', id);
      if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'Un groupe porte déjà ce nom' : friendlyDbError(error) });
    }
    if (Array.isArray(module_keys)) {
      const keys = normalizeModuleKeys(module_keys);
      const { error: delErr } = await supabase.from('delice_group_modules').delete().eq('group_id', id);
      if (delErr) return res.status(500).json({ error: friendlyDbError(delErr) });
      if (keys.length) {
        const { error } = await supabase.from('delice_group_modules').insert(keys.map(module_key => ({ group_id: id, module_key })));
        if (error) return res.status(500).json({ error: friendlyDbError(error) });
      }
    }
    const group = (await listGroups()).find(g => g.id === id);
    if (!group) return res.status(404).json({ error: 'Groupe introuvable' });
    res.json(group);
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

app.delete('/admin/groups/:id', requireSuper, async (req, res) => {
  try {
    const { error } = await supabase.from('delice_groups').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: friendlyDbError(error) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

// ─── Bingo ────────────────────────────────────────────────────────────────────
// Accès par modules (voir ci-dessus) :
//   bingo.view   → voit la grille   · bingo.stream → voit la grille et dévoile les gages
//   bingo.admin  → prépare la grille, révèle les cases, écrit les gages, ouvre / ferme la grille
// Contenu :
//   • bingo_cells  : contenu complet de chaque case (admins seulement, aucune policy RLS)
//   • bingo_public : copie des cases RÉVÉLÉES seulement (lisible par les joueurs + temps réel)
//   • bingo_gages / bingo_gages_public : idem pour les gages (voir supabase_bingo.sql)
// Taille de la grille : table delice_settings (réglée par le super admin dans Gestion).
const BINGO_BUCKET = BUCKET;   // images rangées sous bingo/

const BINGO_IMAGE_SLOTS = {   // casse-tête (dos des cases), dos des gages, dos du toupet suprême
  puzzle: 'bingo_puzzle_url',
  gage:   'bingo_gage_back_url',
  full:   'bingo_full_back_url',
};

async function getBingoConfig() {
  const keys = ['bingo_cols', 'bingo_rows', ...Object.values(BINGO_IMAGE_SLOTS)];
  const { data } = await supabase.from('delice_settings').select('*').in('key', keys);
  const m = {};
  (data || []).forEach(r => { m[r.key] = r.value; });
  return {
    cols: clampInt(m['bingo_cols'], 1, 10, 5),
    rows: clampInt(m['bingo_rows'], 1, 10, 5),
    images: Object.fromEntries(Object.entries(BINGO_IMAGE_SLOTS).map(([slot, key]) => [slot, m[key] || null])),
  };
}

async function withBingoCfg(req, res, next) {
  try { req.bingoCfg = await getBingoConfig(); next(); }
  catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
}

// Grille ouverte aux joueurs ? (table bingo_state, ligne id=1 — voir supabase_bingo.sql)
// Tant qu'elle est fermée, bingo_public reste vide : aucun contenu n'est exposé aux joueurs.
async function getBingoActive() {
  const { data } = await supabase.from('bingo_state').select('active').eq('id', 1).maybeSingle();
  return !!data?.active;
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

// ─── Gages : une carte par ligne, par colonne, pour la diagonale et pour la carte pleine ──
// Clés : row-0 … row-N, col-0 … col-N, diag (haut-gauche → bas-droite, grille carrée seulement)
// et full (« toupet suprême » : disponible seulement quand TOUTES les cases sont révélées).
// Une ligne est « réalisée » quand TOUTES ses cases sont révélées aux joueurs.
// Le gage d'une ligne n'est connu du streamer que lorsqu'il le dévoile lui-même.
//   • bingo_gages        : tous les gages (admins seulement, aucune policy RLS)
//   • bingo_gages_public : seulement les gages déjà dévoilés (lisible + temps réel)
function bingoLineFromReq(req, res) {
  const line = bingoLines(req.bingoCfg.cols, req.bingoCfg.rows).find(l => l.key === req.params.key);
  if (!line) { res.status(400).json({ error: 'Ligne invalide' }); return null; }
  return line;
}

const bingoGageKeys = (cfg) => new Set(bingoLines(cfg.cols, cfg.rows).map(l => l.key));

// Envoie une image dans le bucket et renvoie son adresse publique (lève une erreur avec .status)
async function bingoUploadImage(prefix, image) {
  const ct = String(image.contentType || '');
  if (!ct.startsWith('image/')) {
    const e = new Error('Le fichier doit être une image'); e.status = 400; throw e;
  }
  const ext = (ct.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*$/, '').replace(/[^a-z0-9]/gi, '') || 'png';
  const path = `bingo/${prefix}-${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BINGO_BUCKET)
    .upload(path, Buffer.from(image.base64, 'base64'), { contentType: ct, upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BINGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Vue joueur : SEULEMENT les cases révélées et les gages déjà dévoilés, et seulement si la grille est ouverte
app.get('/bingo/player', requireModule('bingo.view', 'bingo.stream', 'bingo.admin'), withBingoCfg, async (req, res) => {
  const { cols, rows, images } = req.bingoCfg;
  const active = await getBingoActive();
  if (!active) return res.json({ cols, rows, images, active: false, cells: [], gages: [] });

  const [cellsRes, gagesRes] = await Promise.all([
    supabase.from('bingo_public').select('position, text, image_url, revealed_at'),
    supabase.from('bingo_gages_public').select('line_key, text, image_url, revealed_at'),
  ]);
  if (cellsRes.error) return res.status(500).json({ error: cellsRes.error.message });
  if (gagesRes.error) console.error('bingo_gages_public :', gagesRes.error.message);   // SQL pas à jour ?

  const keys = bingoGageKeys(req.bingoCfg);
  res.json({
    cols, rows, images, active: true,
    cells:  (cellsRes.data || []).filter(c => c.position < cols * rows),
    gages:  (gagesRes.data || []).filter(g => keys.has(g.line_key)),
  });
});

// Vue admin : toutes les cases
app.get('/bingo/admin', requireModule('bingo.admin'), withBingoCfg, async (req, res) => {
  const { cols, rows } = req.bingoCfg;
  const { data, error } = await supabase.from('bingo_cells').select('*');
  if (error) return res.status(500).json({ error: error.message });
  const gagesRes = await supabase.from('bingo_gages').select('*');
  if (gagesRes.error) console.error('bingo_gages :', gagesRes.error.message);   // SQL pas à jour ?
  const keys = bingoGageKeys(req.bingoCfg);
  res.json({ cols, rows, active: await getBingoActive(),
             cells:  (data || []).filter(c => c.position < cols * rows),
             gages:  (gagesRes.data || []).filter(g => keys.has(g.line_key)) });
});

// Ouvrir / fermer la grille aux joueurs (admin)
// Ouverture : on publie d'abord les cases déjà révélées, PUIS on bascule l'état
// (les joueurs reçoivent l'événement et trouvent les données prêtes).
// Fermeture : on bascule l'état, puis on vide la copie publique.
app.post('/bingo/admin/active', requireModule('bingo.admin'), withBingoCfg, async (req, res) => {
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
      // Gages déjà dévoilés : republiés à l'ouverture
      const keys = bingoGageKeys(req.bingoCfg);
      const { data: gRevealed } = await supabase.from('bingo_gages')
        .select('line_key, text, image_url, revealed_at').eq('revealed', true);
      const gRows = (gRevealed || []).filter(g => keys.has(g.line_key))
        .map(g => ({ ...g, revealed_at: g.revealed_at || now }));
      if (gRows.length) {
        const { error } = await supabase.from('bingo_gages_public').upsert(gRows, { onConflict: 'line_key' });
        if (error) return res.status(500).json({ error: error.message });
      }
    }
    const { error } = await supabase.from('bingo_state')
      .upsert({ id: 1, active, updated_by: req.user.username, updated_at: now }, { onConflict: 'id' });
    if (error) return res.status(500).json({ error: error.message });
    if (!active) {
      await supabase.from('bingo_public').delete().gte('position', 0);
      await supabase.from('bingo_gages_public').delete().neq('line_key', '');
    }
    res.json({ active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Modifier le texte / l'image d'une case (admin)
app.put('/bingo/admin/cells/:position', requireModule('bingo.admin'), withBingoCfg, async (req, res) => {
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
app.post('/bingo/admin/cells/:position/reveal', requireModule('bingo.admin'), withBingoCfg, async (req, res) => {
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

// Définir le gage d'une ligne (admin)
app.put('/bingo/admin/gages/:key', requireModule('bingo.admin'), withBingoCfg, async (req, res) => {
  try {
    const line = bingoLineFromReq(req, res);
    if (!line) return;
    const { text, image, remove_image } = req.body;

    const { data: existing } = await supabase.from('bingo_gages')
      .select('*').eq('line_key', line.key).maybeSingle();

    let image_url = existing?.image_url || null;
    if (remove_image && image_url) { await bingoRemoveImage(image_url); image_url = null; }
    if (image?.base64) {
      const url = await bingoUploadImage(line.key, image);
      if (image_url) await bingoRemoveImage(image_url);
      image_url = url;
    }

    const row = {
      line_key: line.key,
      text: text !== undefined ? (String(text).trim() || null) : (existing?.text ?? null),
      image_url,
      revealed: existing?.revealed || false,
      revealed_at: existing?.revealed_at || null,
      updated_by: req.user.username,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('bingo_gages').upsert(row, { onConflict: 'line_key' });
    if (error) return res.status(500).json({ error: error.message });

    // Gage déjà dévoilé ET grille ouverte : on met à jour la copie visible
    if (row.revealed && await getBingoActive()) {
      await supabase.from('bingo_gages_public').upsert(
        { line_key: row.line_key, text: row.text, image_url: row.image_url, revealed_at: row.revealed_at || new Date().toISOString() },
        { onConflict: 'line_key' });
    }
    res.json(row);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Remettre un gage face cachée (admin) — en cas de clic par erreur
app.post('/bingo/admin/gages/:key/reset', requireModule('bingo.admin'), withBingoCfg, async (req, res) => {
  try {
    const line = bingoLineFromReq(req, res);
    if (!line) return;
    const { data: existing } = await supabase.from('bingo_gages')
      .select('*').eq('line_key', line.key).maybeSingle();
    if (!existing) return res.json({ line_key: line.key, text: null, image_url: null, revealed: false, revealed_at: null });

    const { error: delErr } = await supabase.from('bingo_gages_public').delete().eq('line_key', line.key);
    if (delErr) return res.status(500).json({ error: delErr.message });
    const { data, error } = await supabase.from('bingo_gages')
      .update({ revealed: false, revealed_at: null, updated_by: req.user.username, updated_at: new Date().toISOString() })
      .eq('line_key', line.key).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Le streamer dévoile LUI-MÊME le gage d'une ligne.
// Refusé tant que la ligne n'est pas réalisée (= toutes ses cases révélées).
// La « toupet suprême » (key = full) n'est disponible que lorsque TOUTES les cases sont révélées.
app.post('/bingo/gage/:key/reveal', requireModule('bingo.stream'), withBingoCfg, async (req, res) => {
  try {
    const line = bingoLineFromReq(req, res);
    if (!line) return;
    if (!(await getBingoActive())) return res.status(403).json({ error: "La grille n'est pas ouverte" });

    const { data: gage, error: gageErr } = await supabase.from('bingo_gages')
      .select('*').eq('line_key', line.key).maybeSingle();
    if (gageErr) return res.status(500).json({ error: friendlyDbError(gageErr) });

    // Déjà dévoilé : on renvoie simplement le contenu
    if (gage?.revealed) {
      return res.json({ line_key: gage.line_key, text: gage.text, image_url: gage.image_url, revealed_at: gage.revealed_at });
    }

    // Ligne réalisée ? (toutes les cases de la ligne sont dans la copie publique)
    const { data: pubCells, error: cellsErr } = await supabase.from('bingo_public')
      .select('position').in('position', line.positions);
    if (cellsErr) return res.status(500).json({ error: friendlyDbError(cellsErr) });
    if ((pubCells || []).length < line.positions.length) {
      return res.status(403).json({ error: line.key === 'full' ? "Le toupet suprême n'est disponible que lorsque toutes les cases sont révélées" : "Cette ligne n'est pas encore réalisée" });
    }

    if (!gage || (!gage.text && !gage.image_url)) {
      return res.status(404).json({ error: line.key === 'full' ? "Aucun toupet suprême n'a été prévu" : "Aucun gage n'a été prévu pour cette ligne" });
    }

    const now = new Date().toISOString();
    const { error: pubErr } = await supabase.from('bingo_gages_public').upsert(
      { line_key: gage.line_key, text: gage.text, image_url: gage.image_url, revealed_at: now },
      { onConflict: 'line_key' });
    if (pubErr) return res.status(500).json({ error: friendlyDbError(pubErr) });
    await supabase.from('bingo_gages').update({ revealed: true, revealed_at: now }).eq('line_key', gage.line_key);

    res.json({ line_key: gage.line_key, text: gage.text, image_url: gage.image_url, revealed_at: now });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Section « Paramètres du Bingo » (ou super admin) : taille de la grille et images
app.get('/admin/bingo-settings', requireModule('settings.bingo'), async (req, res) => {
  try { res.json(await getBingoConfig()); }
  catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

app.put('/admin/bingo-settings', requireModule('settings.bingo'), async (req, res) => {
  try {
    const { cols, rows } = req.body || {};
    const updates = [];
    if (cols !== undefined) updates.push({ key: 'bingo_cols', value: String(clampInt(cols, 1, 10, 5)) });
    if (rows !== undefined) updates.push({ key: 'bingo_rows', value: String(clampInt(rows, 1, 10, 5)) });
    for (const u of updates) {
      const { error } = await supabase.from('delice_settings').upsert(u, { onConflict: 'key' });
      if (error) return res.status(500).json({ error: friendlyDbError(error) });
    }
    res.json(await getBingoConfig());
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

// Images : puzzle (découpée sur le dos des cases), gage (répétée sur chaque gage), full (toupet suprême)
app.put('/admin/bingo-images/:slot', requireModule('settings.bingo'), async (req, res) => {
  try {
    const slot = req.params.slot;
    const key = BINGO_IMAGE_SLOTS[slot];
    if (!key) return res.status(400).json({ error: "Emplacement d'image invalide" });
    const { image, remove } = req.body || {};
    const old = (await getBingoConfig()).images[slot];

    if (remove) {
      if (old) await bingoRemoveImage(old);
      const { error } = await supabase.from('delice_settings').delete().eq('key', key);
      if (error) return res.status(500).json({ error: friendlyDbError(error) });
    } else if (image?.base64) {
      const url = await bingoUploadImage(`back-${slot}`, image);
      const { error } = await supabase.from('delice_settings').upsert({ key, value: url }, { onConflict: 'key' });
      if (error) return res.status(500).json({ error: friendlyDbError(error) });
      if (old) await bingoRemoveImage(old);
    } else {
      return res.status(400).json({ error: 'Image requise' });
    }
    res.json(await getBingoConfig());
  } catch (e) { res.status(e.status || 500).json({ error: friendlyDbError(e) }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🎯 Delice_TV — API sur le port ${PORT}`));
