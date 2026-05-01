import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// AuthContext
//
// Access token is stored IN MEMORY ONLY (React state).
// It is NEVER written to localStorage, sessionStorage, or cookies.
// The refresh token lives in an httpOnly cookie (set by the backend).
// On every page load the app calls POST /api/auth/refresh to restore session.
// ─────────────────────────────────────────────────────────────────────────────

const AuthContext = createContext(null);

// Decode JWT payload (base64) without verifying signature.
// Server is the authority for verification; we just read claims.
function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  // ── State ───────────────────────────────────────────────────────────────
  const [accessToken, setAccessToken] = useState(null);  // MEMORY ONLY
  const [user, setUser]               = useState(null);
  const [isLoading, setIsLoading]     = useState(true);  // true while initial refresh runs
  const refreshTimerRef               = useRef(null);

  // ── Helpers ─────────────────────────────────────────────────────────────

  // Store a new access token and derive user from its claims.
  const storeToken = useCallback((token) => {
    setAccessToken(token);
    const decoded = decodeJwt(token);
    if (decoded) {
      setUser({
        id:                parseInt(decoded.sub, 10),
        email:             decoded.email,
        role:              decoded.role,
        mustChangePassword: false,  // will be overridden by login response if needed
      });
    }
  }, []);

  // Clear all in-memory auth state.
  const clearAuth = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  // ── Proactive token refresh ──────────────────────────────────────────────
  // Schedule a refresh 60 seconds before the access token's `exp` claim.
  const scheduleProactiveRefresh = useCallback((token) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    const decoded = decodeJwt(token);
    if (!decoded || !decoded.exp) return;

    const expiresAt  = decoded.exp * 1000;           // milliseconds
    const now        = Date.now();
    const refreshIn  = expiresAt - now - 60_000;     // 60 s before expiry

    if (refreshIn <= 0) {
      // Already expired or about to expire — refresh immediately.
      doRefresh();
      return;
    }

    refreshTimerRef.current = setTimeout(() => {
      doRefresh();
    }, refreshIn);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Core refresh function ────────────────────────────────────────────────
  // Calls POST /api/auth/refresh; the httpOnly refreshToken cookie is sent
  // automatically by the browser (withCredentials is set in api.js).
  const doRefresh = useCallback(async () => {
    try {
      // Avoid circular import by using fetch directly here.
      // api.js interceptor also calls this, but that uses a different path.
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        clearAuth();
        return null;
      }

      const body = await res.json();
      if (!body.success || !body.data?.accessToken) {
        clearAuth();
        return null;
      }

      const token = body.data.accessToken;
      storeToken(token);
      scheduleProactiveRefresh(token);
      return token;
    } catch {
      clearAuth();
      return null;
    }
  }, [clearAuth, storeToken, scheduleProactiveRefresh]);

  // ── On app mount: restore session via refresh ───────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const token = await doRefresh();
        if (!cancelled && !token) {
          // No valid session — not an error, user just needs to log in.
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup timer on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // ── login() ─────────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const body = await res.json();

    if (!res.ok || !body.success) {
      const err = new Error(body.message || 'Login failed');
      err.code = body.error;
      throw err;
    }

    const token = body.data.accessToken;
    const userData = body.data.user;

    setAccessToken(token);
    setUser({
      id:                parseInt(userData.id, 10),
      email:             userData.email,
      name:              userData.name,
      role:              userData.role,
      mustChangePassword: userData.mustChangePassword || false,
    });

    scheduleProactiveRefresh(token);

    return body.data;
  }, [scheduleProactiveRefresh]);

  // ── register() ──────────────────────────────────────────────────────────
  const register = useCallback(async (token, name, password) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name, password }),
    });

    const body = await res.json();

    if (!res.ok || !body.success) {
      const err = new Error(body.message || 'Registration failed');
      err.code  = body.error;
      err.canResend = body.canResend || false;
      throw err;
    }

    const accessTokenNew = body.data.accessToken;
    const userData       = body.data.user;

    setAccessToken(accessTokenNew);
    setUser({
      id:                parseInt(userData.id, 10),
      email:             userData.email,
      name:              userData.name,
      role:              userData.role,
      mustChangePassword: false,
    });

    scheduleProactiveRefresh(accessTokenNew);

    return body.data;
  }, [scheduleProactiveRefresh]);

  // ── logout() ─────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
    } catch {
      // Logout is idempotent — always clear local state regardless of network.
    } finally {
      clearAuth();
    }
  }, [accessToken, clearAuth]);

  // ── setMustChangePassword helper ─────────────────────────────────────────
  // Called by Profile after a successful password change to clear the flag.
  const clearMustChangePassword = useCallback(() => {
    setUser((prev) => prev ? { ...prev, mustChangePassword: false } : prev);
  }, []);

  // ── Update access token from interceptor ─────────────────────────────────
  // api.js calls this when it successfully refreshes a token mid-request.
  const updateAccessToken = useCallback((token) => {
    setAccessToken(token);
    scheduleProactiveRefresh(token);
  }, [scheduleProactiveRefresh]);

  // ── Context value ─────────────────────────────────────────────────────────
  const value = {
    accessToken,
    user,
    isLoading,
    login,
    register,
    logout,
    doRefresh,
    updateAccessToken,
    clearMustChangePassword,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default AuthContext;
