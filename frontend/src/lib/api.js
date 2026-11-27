const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function getToken() { return localStorage.getItem('token'); }

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw Object.assign(new Error(`Erreur serveur (${res.status}) : réponse invalide`), { status: res.status }); }
  if (!res.ok) {
    const err = data.error;
    throw Object.assign(new Error(typeof err === 'string' ? err : (err?.message || 'Erreur serveur')), { status: res.status });
  }
  return data;
}
const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });

export const authApi = {
  register:       (username, password) => apiFetch('/auth/register', json('POST', { username, password })),
  login:          (username, password) => apiFetch('/auth/login', json('POST', { username, password })),
  me:             ()                   => apiFetch('/auth/me'),
  changePassword: (new_password)       => apiFetch('/auth/change-password', json('POST', { new_password })),
};

export const profileApi = {
  update:       (data)                  => apiFetch('/profile', json('PUT', data)),
  uploadAvatar: (base64, contentType)   => apiFetch('/profile/avatar/upload', json('POST', { base64, contentType })),
};

export const bingoApi = {
  player:     ()              => apiFetch('/bingo/player'),
  adminCells: ()              => apiFetch('/bingo/admin'),
  setActive:  (active)        => apiFetch('/bingo/admin/active', json('POST', { active })),
  saveCell:   (pos, data)     => apiFetch(`/bingo/admin/cells/${pos}`, json('PUT', data)),
  reveal:     (pos, revealed) => apiFetch(`/bingo/admin/cells/${pos}/reveal`, json('POST', { revealed })),
  // Gages (lignes, colonnes, diagonale, carte pleine)
  saveGage:   (key, data)     => apiFetch(`/bingo/admin/gages/${key}`, json('PUT', data)),
  resetGage:  (key)           => apiFetch(`/bingo/admin/gages/${key}/reset`, json('POST')),
  revealGage: (key)           => apiFetch(`/bingo/gage/${key}/reveal`, json('POST')),
};

// Gestion (super admin)
export const adminApi = {
  modules:           ()              => apiFetch('/admin/modules'),
  users:             ()              => apiFetch('/admin/users'),
  setUserGroups:     (id, group_ids) => apiFetch(`/admin/users/${id}/groups`, json('PUT', { group_ids })),
  resetPassword:     (id)            => apiFetch(`/admin/users/${id}/reset-password`, json('POST')),
  deleteUser:        (id)            => apiFetch(`/admin/users/${id}`, { method: 'DELETE' }),
  groups:            ()              => apiFetch('/admin/groups'),
  createGroup:       (data)          => apiFetch('/admin/groups', json('POST', data)),
  updateGroup:       (id, data)      => apiFetch(`/admin/groups/${id}`, json('PUT', data)),
  deleteGroup:       (id)            => apiFetch(`/admin/groups/${id}`, { method: 'DELETE' }),
  bingoSettings:     ()              => apiFetch('/admin/bingo-settings'),
  bingoImage:        (slot, data)    => apiFetch(`/admin/bingo-images/${slot}`, json('PUT', data)),
  saveBingoSettings: (data)          => apiFetch('/admin/bingo-settings', json('PUT', data)),
};
