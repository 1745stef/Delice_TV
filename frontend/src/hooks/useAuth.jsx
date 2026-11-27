import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [access, setAccess]   = useState(null);   // { is_superadmin, modules: [...], groups: [...] }
  const [loading, setLoading] = useState(true);

  const apply = (d) => {
    if (d.token) localStorage.setItem('token', d.token);
    if (d.user) setUser(d.user);
    if (d.access) setAccess(d.access);
  };

  useEffect(() => {
    if (!localStorage.getItem('token')) { setLoading(false); return; }
    authApi.me()
      .then(apply)
      .catch(e => { if (e.status === 401) localStorage.removeItem('token'); })   // serveur injoignable : on garde la session
      .finally(() => setLoading(false));
  }, []);

  // Relit les droits (ex. un super admin vient d'ajouter la personne à un groupe)
  const refresh = useCallback(async () => {
    try { apply(await authApi.me()); }
    catch (e) { if (e.status === 401) { localStorage.removeItem('token'); setUser(null); setAccess(null); } }
  }, []);

  const register = async (username, password) => { const d = await authApi.register(username, password); apply(d); return d; };
  const login    = async (username, password) => { const d = await authApi.login(username, password); apply(d); return d; };
  const changePassword = async (pw) => { apply(await authApi.changePassword(pw)); };
  const logout = () => { localStorage.removeItem('token'); setUser(null); setAccess(null); };

  // can('bingo.admin') / can('bingo.stream', 'bingo.view') : au moins un des modules (le super admin a tout)
  const can = (...keys) => !!access && (access.is_superadmin || keys.some(k => access.modules.includes(k)));

  return (
    <AuthContext.Provider value={{ user, setUser, access, loading, register, login, changePassword, logout, refresh, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
