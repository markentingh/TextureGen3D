import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { jwtDecode } from 'jwt-decode';
import { UseAxios } from '@/api/Axios';
import { Auth } from '@/api/account/auth';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem('token') || null);
  const [refreshToken, setRefreshToken] = useState(() => localStorage.getItem('refreshToken') || null);
  const [isReady, setIsReady] = useState(false);
  const keepaliveRef = useRef(null);

  useEffect(() => {
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('user');
    }
  }, [user]);

  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
      try {
        const decoded = jwtDecode(token);
        const expires = decoded.exp ? decoded.exp * 1000 : 0;
        if (expires && expires < Date.now()) {
          logout();
        }
      } catch {
        logout();
      }
    } else {
      localStorage.removeItem('token');
    }
  }, [token]);

  useEffect(() => {
    if (refreshToken) {
      localStorage.setItem('refreshToken', refreshToken);
    } else {
      localStorage.removeItem('refreshToken');
    }
  }, [refreshToken]);

  useEffect(() => {
    if (!token || !refreshToken) return;

    const doKeepalive = async () => {
      try {
        const api = Auth(UseAxios({}));
        const res = await api.refreshToken(refreshToken);
        if (res.data.success && res.data.data?.token) {
          setToken(res.data.data.token);
        }
      } catch {
        // token refresh failed, will retry next interval
      }
    };

    keepaliveRef.current = setInterval(doKeepalive, 60 * 60 * 1000);
    return () => { if (keepaliveRef.current) clearInterval(keepaliveRef.current); };
  }, [token, refreshToken]);

  const login = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    if (userData.refreshToken) setRefreshToken(userData.refreshToken);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    setRefreshToken(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
  };

  const isAuthenticated = !!token && !!user;

  return (
    <SessionContext.Provider value={{ user, setUser, token, setToken, refreshToken, login, logout, isAuthenticated, isReady }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
