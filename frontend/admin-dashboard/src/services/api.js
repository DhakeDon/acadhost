/**
 * AcadHost Admin Dashboard -- Axios API Client
 *
 * baseURL '/api' is proxied by Nginx on admin.acadhost.com to the
 * Express.js backend (Section 8.5.3 / Section 14.4.1).
 *
 * withCredentials: true is required so the browser sends the httpOnly
 * refreshToken cookie on every request (Section 5.4, Section 5.10).
 *
 * Request interceptor (attach access token) and response interceptor
 * (handle 401 with token refresh + retry) are registered by AuthContext
 * via api.interceptors — see src/context/AuthContext.js.
 */
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
