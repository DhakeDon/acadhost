import axios from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// AcadHost API client
//
// baseURL: /api  — Nginx on acadhost.com proxies /api/* to the Express backend.
//                  REACT_APP_API_URL can override in development if needed.
// withCredentials: true — required so the browser sends the httpOnly
//                         refreshToken cookie on every request.
//
// Request interceptor: attaches the access token (from AuthContext memory store)
//   as an Authorization: Bearer header on every request.
//
// Response interceptor: on 401, attempts a token refresh (POST /api/auth/refresh)
//   and retries the original request exactly once. On second 401 (refresh failed)
//   the user is logged out and redirected to /login.
// ─────────────────────────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api',
  withCredentials: true,          // send httpOnly refreshToken cookie
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Token registry ────────────────────────────────────────────────────────────
// Because api.js cannot directly import AuthContext (circular dep), AuthContext
// registers a getter and a setter here after it mounts.
let _getAccessToken  = () => null;
let _updateToken     = () => {};
let _clearAuth       = () => {};

export function registerAuthHandlers({ getAccessToken, updateToken, clearAuth }) {
  _getAccessToken  = getAccessToken;
  _updateToken     = updateToken;
  _clearAuth       = clearAuth;
}

// ── Request interceptor ───────────────────────────────────────────────────────
api.interceptors.request.use(
  (config) => {
    const token = _getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor ──────────────────────────────────────────────────────
// On 401: attempt refresh once, retry original request.
// On second 401 (or refresh failure): clear auth state, redirect to /login.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Only intercept 401 responses.
    // Guard: don't retry if this IS the refresh call, or the login call,
    // or we've already retried.
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh') &&
      !originalRequest.url?.includes('/auth/login')
    ) {
      originalRequest._retry = true;

      try {
        // Attempt refresh. The httpOnly cookie is sent automatically.
        const refreshRes = await axios.post(
          `${process.env.REACT_APP_API_URL || '/api'}/auth/refresh`,
          {},
          { withCredentials: true }
        );

        if (refreshRes.data?.success && refreshRes.data?.data?.accessToken) {
          const newToken = refreshRes.data.data.accessToken;

          // Update in-memory token via the registered setter.
          _updateToken(newToken);

          // Retry the original request with the new token.
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        }
      } catch {
        // Refresh failed — fall through to clear auth.
      }

      // Clear all in-memory auth state and redirect to login.
      _clearAuth();

      // Redirect only if we're in a browser context.
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);
// Convenience helpers for the database page
export const deleteDatabaseApi = (id) => api.delete(`/databases/${id}`);
export default api;
