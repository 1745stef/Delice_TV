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
  catch { throw new Error(`Erreur serveur (${res.status}) : réponse invalide`); }
  if (!res.ok) {
    const err = data.error;
    throw new Error(typeof err === 'string' ? err : (err?.message || 'Erreur serveur'));
  }
  return data;
}

export const authApi = {
  login:          (username, password) => apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me:             ()                   => apiFetch('/auth/me'),
  changePassword: (new_password)       => apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ new_password }) }),
};

export const bingoApi = {
  access:     ()              => apiFetch('/bingo/access'),
  player:     ()              => apiFetch('/bingo/player'),
  adminCells: ()              => apiFetch('/bingo/admin'),
  setActive:  (active)        => apiFetch('/bingo/admin/active', { method: 'POST', body: JSON.stringify({ active }) }),
  saveCell:   (pos, data)     => apiFetch(`/bingo/admin/cells/${pos}`, { method: 'PUT', body: JSON.stringify(data) }),
  reveal:     (pos, revealed) => apiFetch(`/bingo/admin/cells/${pos}/reveal`, { method: 'POST', body: JSON.stringify({ revealed }) }),
};

// Réglages (superadmin)
export const adminApi = {
  getUsers:          ()     => apiFetch('/admin/users'),
  getBingoAccess:    ()     => apiFetch('/admin/bingo-access'),
  updateBingoAccess: (data) => apiFetch('/admin/bingo-access', { method: 'PUT', body: JSON.stringify(data) }),
};
