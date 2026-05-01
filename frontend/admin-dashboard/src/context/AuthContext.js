/**
 * AcadHost Admin Dashboard — AuthContext
 *
 * Token storage strategy (Section 5.4):
 *   - Access token: in-memory only (React state + ref); NEVER localStorage
 *   - Refresh token: httpOnly cookie, rotated on every use
 *
 * Critical: because refresh tokens rotate on every use (Section 5.4),
 * two concurrent POST /auth/refresh calls will cause the second one to
 * fail with an invalidated token. The `refreshPromise` module-level
 * singleton below ensures only ONE refresh is in flight at a time —
 * every other caller awaits the same promise. This covers:
 *   - React 18 StrictMode double-invoking the mount effect in dev
 *   - Multiple API calls 401'ing concurrently on first page load
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

// ---------------------------------------------------------------------------
// Module-level singleton: dedupes concurrent /auth/refresh calls
// ---------------------------------------------------------------------------
let refreshPromise = null;

function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = api
      .post('auth/refresh')
      .finally(() => {
        // Clear the singleton AFTER the awaiting callers have read it.
        // Using a microtask-level reset keeps the promise reusable for the
        // next, independent refresh cycle — but prevents a permanent lock
        // if the call rejected.
        refreshPromise = null;
      });
  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function decodeJwt(token) {
  try {
    const base64Payload = token.split('.')[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    return JSON.parse(atob(base64Payload));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AuthProvider
// ---------------------------------------------------------------------------
export function AuthProvider({ children }) {
  const [accessToken, setAccessToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const accessTokenRef = useRef(null);

  // Guard against StrictMode double-invoking the mount effect
  const didInitRef = useRef(false);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  // ---------------------------------------------------------------------------
  // Axios interceptors (Section 14.4.2 and 14.4.3)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const reqId = api.interceptors.request.use((config) => {
      const token = accessTokenRef.current;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    const resId = api.interceptors.response.use(
        (response) => response,
        async (error) => {
          const original = error.config;
          const isAuthEndpoint =
              original?.url?.includes('auth/refresh') ||
              original?.url?.includes('auth/logout');

          if (
              error.response?.status === 401 &&
              !original._retry &&
              !isAuthEndpoint
          ) {
            original._retry = true;
            try {
              // Deduped — all concurrent 401s share one refresh
              const res = await refreshAccessToken();
              const newToken = res.data.data.accessToken;
              setAccessToken(newToken);
              accessTokenRef.current = newToken;
              original.headers.Authorization = `Bearer ${newToken}`;
              return api(original);
            } catch {
              setAccessToken(null);
              accessTokenRef.current = null;
              setUser(null);
              sessionStorage.removeItem('acadhost_admin_user');
              sessionStorage.removeItem('acadhost_admin_mcp');
            }
          }

          return Promise.reject(error);
        }
    );

    return () => {
      api.interceptors.request.eject(reqId);
      api.interceptors.response.eject(resId);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Token refresh on page load (Section 14.3.3)
  // Guarded so StrictMode's double-mount in dev doesn't race against itself.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    async function initSession() {
      try {
        const res = await refreshAccessToken();
        const newToken = res.data.data.accessToken;
        const decoded = decodeJwt(newToken);

        if (!decoded) throw new Error('Unable to decode access token');

        const storedUser = JSON.parse(
            sessionStorage.getItem('acadhost_admin_user') || 'null'
        );
        const mustChangePassword =
            sessionStorage.getItem('acadhost_admin_mcp') === '1';

        setAccessToken(newToken);
        accessTokenRef.current = newToken;
        setUser({
          id: decoded.sub,
          email: decoded.email,
          role: decoded.role,
          name: storedUser?.name ?? decoded.email,
          mustChangePassword,
        });
      } catch {
        setAccessToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    initSession();
  }, []);

  // ---------------------------------------------------------------------------
  // Proactive token refresh (Section 14.3.4)
  // Refresh 60s before the access token expires.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!accessToken) return;

    const decoded = decodeJwt(accessToken);
    if (!decoded?.exp) return;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const secondsUntilExpiry = decoded.exp - nowSeconds;
    const delayMs = Math.max((secondsUntilExpiry - 60) * 1000, 0);

    const timer = setTimeout(async () => {
      try {
        const res = await refreshAccessToken();
        const newToken = res.data.data.accessToken;
        setAccessToken(newToken);
        accessTokenRef.current = newToken;
      } catch {
        setAccessToken(null);
        accessTokenRef.current = null;
        setUser(null);
        sessionStorage.removeItem('acadhost_admin_user');
        sessionStorage.removeItem('acadhost_admin_mcp');
      }
    }, delayMs);

    return () => clearTimeout(timer);
  }, [accessToken]);

  // ---------------------------------------------------------------------------
  // login()
  // ---------------------------------------------------------------------------
  const login = useCallback(async (email, password) => {
    const res = await api.post('auth/login', { email, password });
    const { accessToken: newToken, user: userData } = res.data.data;

    setAccessToken(newToken);
    accessTokenRef.current = newToken;
    setUser(userData);

    sessionStorage.setItem(
        'acadhost_admin_user',
        JSON.stringify({ name: userData.name, email: userData.email })
    );
    if (userData.mustChangePassword) {
      sessionStorage.setItem('acadhost_admin_mcp', '1');
    } else {
      sessionStorage.removeItem('acadhost_admin_mcp');
    }

    return userData;
  }, []);

  // ---------------------------------------------------------------------------
  // logout()
  // ---------------------------------------------------------------------------
  const logout = useCallback(async () => {
    try {
      await api.post('auth/logout');
    } catch {
      // Idempotent — Section 6.2.4
    } finally {
      setAccessToken(null);
      accessTokenRef.current = null;
      setUser(null);
      sessionStorage.removeItem('acadhost_admin_user');
      sessionStorage.removeItem('acadhost_admin_mcp');
    }
  }, []);

  const value = {
    accessToken,
    user,
    setUser,
    loading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export const useAuthContext = useAuth;