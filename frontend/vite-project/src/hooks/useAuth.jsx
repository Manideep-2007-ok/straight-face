import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  const [waking, setWaking] = useState(false); // the server is asleep and starting up

  // Ask who is logged in. If the server is still waking up, keep trying (up to ~70 s) instead of deciding "logged out".
  useEffect(() => {
    let dead = false;
    (async () => {
      for (let i = 0; i < 14 && !dead; i++) {
        try {
          const u = await api.me();
          if (!dead) setUser(u);
          break;
        } catch (e) {
          if (e.code === 'WAKING' || e.code === 'OFFLINE') {
            if (!dead) setWaking(true);
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 5000));
          } else {
            if (!dead) setUser(null);
            break;
          }
        }
      }
      if (!dead) {
        setWaking(false);
        setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
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

  return <AuthContext.Provider value={{ user, loading, waking, notice, login, signup, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
