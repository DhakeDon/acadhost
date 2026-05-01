'use strict';

// ============================================================
// Auth Middleware — middleware/auth.js
// Section 5.6 — JWT Access Token Verification
//
// Validates JWT access tokens on all protected routes.
// Attaches req.user = { id, email, role } on success.
//
// Token extraction priority:
//   1. Authorization: Bearer <token>  (standard API requests)
//   2. ?token=<token> query parameter (SSE endpoints)
// ============================================================

const { verifyAccessToken } = require('../utils/tokenHelper');

function auth(req, res, next) {
  let token = null;

  // Priority 1: Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'ACCESS_TOKEN_MALFORMED', message: 'Authorization header must use Bearer scheme' });
    }
    token = authHeader.slice(7); // strip "Bearer "
  }

  // Priority 2: query parameter (SSE — EventSource cannot set custom headers)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'ACCESS_TOKEN_REQUIRED', message: 'Access token is required' });
  }

  try {
    const decoded = verifyAccessToken(token);

    req.user = {
      id:    decoded.sub,   // string representation of users.id
      email: decoded.email,
      role:  decoded.role,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'ACCESS_TOKEN_EXPIRED', message: 'Access token has expired' });
    }
    return res.status(401).json({ success: false, error: 'ACCESS_TOKEN_INVALID', message: 'Access token is invalid' });
  }
}

module.exports = auth;
