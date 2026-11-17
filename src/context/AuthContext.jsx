/**
 * Authentication & Tenant Context — SBM-040 & SBM-041
 * Manages authenticated merchant identity, RS256 token lifecycle,
 * session versioning, and active tenant business switching.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getShopId } from '../utils/shopIdentity.js';

const AuthContext = createContext(null);

const STORAGE_KEY_TOKEN = 'msme_auth_token';
const STORAGE_KEY_USER = 'msme_auth_user';
const STORAGE_KEY_TENANT = 'msme_active_tenant';

export function AuthProvider({ children, initialUser = null, initialToken = null, initialBusinessId = null }) {
  const [token, setToken] = useState(() => initialToken || localStorage.getItem(STORAGE_KEY_TOKEN) || null);
  const [user, setUser] = useState(() => {
    if (initialUser) return initialUser;
    const stored = localStorage.getItem(STORAGE_KEY_USER);
    if (stored) {
      try { return JSON.parse(stored); } catch { return null; }
    }
    return null;
  });

  const [currentBusinessId, setCurrentBusinessId] = useState(() => {
    return initialBusinessId || localStorage.getItem(STORAGE_KEY_TENANT) || user?.defaultBusinessId || getShopId();
  });

  const [memberships, setMemberships] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [currentRole, setCurrentRole] = useState('owner');

  const apiUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
    ? import.meta.env.VITE_API_URL
    : (typeof process !== 'undefined' && process.env?.VITE_API_URL
      ? process.env.VITE_API_URL
      : 'http://localhost:3000');

  // Sync state to localStorage
  useEffect(() => {
    if (token) {
      localStorage.setItem(STORAGE_KEY_TOKEN, token);
    } else {
      localStorage.removeItem(STORAGE_KEY_TOKEN);
    }
  }, [token]);

  useEffect(() => {
    if (user) {
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY_USER);
    }
  }, [user]);

  useEffect(() => {
    if (currentBusinessId) {
      localStorage.setItem(STORAGE_KEY_TENANT, currentBusinessId);
      // Update role based on memberships
      const currentMembership = memberships.find(m => m.businessId === currentBusinessId);
      if (currentMembership) {
        setCurrentRole(currentMembership.role);
      }
    }
  }, [currentBusinessId, memberships]);

  const switchBusiness = useCallback((bizId) => {
    if (!bizId) return;
    setCurrentBusinessId(bizId);
    const m = memberships.find(item => item.businessId === bizId);
    if (m) {
      setCurrentRole(m.role);
    }
  }, [memberships]);

  const login = useCallback(async ({ email, password }) => {
    const res = await fetch(`${apiUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Login failed.');
    }

    setToken(data.accessToken);
    setUser(data.user);
    const bizId = data.user.defaultBusinessId || currentBusinessId;
    setCurrentBusinessId(bizId);
    return data;
  }, [apiUrl, currentBusinessId]);

  const register = useCallback(async ({ email, password, fullName, businessName }) => {
    const res = await fetch(`${apiUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, fullName, businessName })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Registration failed.');
    }

    setToken(data.accessToken);
    setUser(data.user);
    if (data.user.defaultBusinessId) {
      setCurrentBusinessId(data.user.defaultBusinessId);
    }
    return data;
  }, [apiUrl]);

  const logout = useCallback(async () => {
    try {
      if (token) {
        await fetch(`${apiUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Business-ID': currentBusinessId
          }
        });
      }
    } catch {
      // Ignore network errors on logout
    } finally {
      setToken(null);
      setUser(null);
      localStorage.removeItem(STORAGE_KEY_TOKEN);
      localStorage.removeItem(STORAGE_KEY_USER);
    }
  }, [apiUrl, token, currentBusinessId]);

  const value = {
    token,
    user,
    isAuthenticated: Boolean(token && user),
    currentBusinessId,
    currentRole,
    memberships,
    businesses,
    switchBusiness,
    login,
    register,
    logout,
    setToken,
    setUser,
    setMemberships,
    setBusinesses
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    // Return fallback safe object for tests or non-wrapped components
    const shopId = getShopId();
    return {
      token: null,
      user: null,
      isAuthenticated: false,
      currentBusinessId: shopId,
      currentRole: 'owner',
      memberships: [],
      businesses: [],
      switchBusiness: () => {},
      login: async () => {},
      register: async () => {},
      logout: async () => {}
    };
  }
  return context;
}
