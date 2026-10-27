import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // The same account was opened on another device: this one is signed out straight away.
  useEffect(() => {
    const onReplaced = () => {
      setUser(null);
      setNotice('You were signed out because this account was opened on another device.');
    };
    window.addEventListener('session-replaced', onReplaced);
    return () => window.removeEventListener('session-replaced', onReplaced);
  }, []);

  const login = useCallback(async (b) => {
    setNotice('');
    setUser(await api.login(b));
  }, []);
  const signup = useCallback(async (b) => {
    setNotice('');
    setUser(await api.signup(b));
  }, []);
  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, notice, login, signup, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
