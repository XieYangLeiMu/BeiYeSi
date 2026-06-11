// AuthContext.tsx - 用户认证上下文
import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';

const API_BASE_URL = '/api';

interface AuthUser {
  id: number;
  username: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: () => {},
  isAuthenticated: false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('edbo_token'));
  const [loading, setLoading] = useState(true);

  // 初始化时尝试验证令牌
  useEffect(() => {
    const savedToken = localStorage.getItem('edbo_token');
    if (savedToken) {
      axios
        .get(`${API_BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        })
        .then((res) => {
          if (res.data?.success) {
            setUser(res.data.data);
            setToken(savedToken);
          } else {
            localStorage.removeItem('edbo_token');
            setToken(null);
          }
        })
        .catch(() => {
          localStorage.removeItem('edbo_token');
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/auth/login`, { username, password });
      if (res.data?.success) {
        const data = res.data.data;
        localStorage.setItem('edbo_token', data.access_token);
        setToken(data.access_token);
        setUser({ id: data.user_id, username: data.username });
        return { success: true };
      }
      return { success: false, error: '登录失败' };
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '网络错误';
      return { success: false, error: detail };
    }
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/auth/register`, { username, password });
      if (res.data?.success) {
        const data = res.data.data;
        localStorage.setItem('edbo_token', data.access_token);
        setToken(data.access_token);
        setUser({ id: data.user_id, username: data.username });
        return { success: true };
      }
      return { success: false, error: '注册失败' };
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '网络错误';
      return { success: false, error: detail };
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('edbo_token');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        logout,
        isAuthenticated: !!token && !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
