import { createContext, useContext, useState, useEffect } from 'react';
import { authApi } from '../lib/api';

const AuthContext = createContext(null);

// Niveau de rôle : 1 = superadmin, 2 = admin, 3 = capitaine, 99 = joueur
export const getLevel = (user) => user?.roles?.level ?? 99;

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem('token')) { setLoading(false); return; }
    authApi.me()
      .then(d => { localStorage.setItem('token', d.token); setUser(d.user); })
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const d = await authApi.login(username, password);
    localStorage.setItem('token', d.token);
    setUser(d.user);
    return d;
  };

  const changePassword = async (newPassword) => {
    const d = await authApi.changePassword(newPassword);
    localStorage.setItem('token', d.token);
    setUser(d.user);
  };

  const logout = () => { localStorage.removeItem('token'); setUser(null); };

  return (
    <AuthContext.Provider value={{ user, loading, login, changePassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
