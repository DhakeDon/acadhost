'use strict';

// ============================================================
// Token Utilities — utils/tokenHelper.js
// Section 5.5 — Token Utility Functions
//
// Provides all token generation, verification, and hashing
// functions used across the authentication system.
//
// Token types:
//   Access token   — JWT, 15 min, signed with JWT_ACCESS_SECRET
//   Refresh token  — JWT, 7 days, signed with JWT_REFRESH_SECRET
//   Invite token   — JWT, 2 hrs,  signed with JWT_INVITE_SECRET
//   Password reset — 32 random bytes hex-encoded (not a JWT)
// ============================================================

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// ── Access token ─────────────────────────────────────────────

/**
 * Generates a JWT access token.
 * Payload: sub (users.id as string), email, role
 * Expiry:  ACCESS_TOKEN_EXPIRY env var (default '15m')
 */
function generateAccessToken(user) {
  return jwt.sign(
    {
      sub:   String(user.id),
      email: user.email,
      role:  user.role,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '15m' }
  );
}

/**
 * Verifies a JWT access token using JWT_ACCESS_SECRET.
 * Returns decoded payload or throws a JsonWebTokenError / TokenExpiredError.
 */
function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

// ── Refresh token ─────────────────────────────────────────────

/**
 * Generates a JWT refresh token.
 * Payload: sub (users.id as string), jti (UUID v4)
 * Expiry:  REFRESH_TOKEN_EXPIRY env var (default '7d')
 */
function generateRefreshToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      jti: uuidv4(),
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d' }
  );
}

/**
 * Verifies a JWT refresh token using JWT_REFRESH_SECRET.
 * Returns decoded payload or throws on invalid/expired.
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

// ── Invite token ──────────────────────────────────────────────

/**
 * Generates a JWT invite token.
 * Payload: email, batch_year (number or null)
 * Expiry:  INVITE_TOKEN_EXPIRY env var (default '2h')
 */
function generateInviteToken(email, batchYear) {
  return jwt.sign(
    {
      email,
      batch_year: batchYear ?? null,
    },
    process.env.JWT_INVITE_SECRET,
    { expiresIn: process.env.INVITE_TOKEN_EXPIRY || '2h' }
  );
}

/**
 * Verifies a JWT invite token using JWT_INVITE_SECRET.
 * Returns decoded payload or throws on invalid/expired.
 */
function verifyInviteToken(token) {
  return jwt.verify(token, process.env.JWT_INVITE_SECRET);
}

// ── Password reset token ──────────────────────────────────────

/**
 * Generates a cryptographically random password reset token.
 * Returns a 64-character hex string (32 random bytes).
 */
function generatePasswordResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── Token hashing ─────────────────────────────────────────────

/**
 * Computes SHA-256 hash of a raw token string.
 * Used before storing any token in the database — raw tokens are never persisted.
 */
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateInviteToken,
  verifyInviteToken,
  generatePasswordResetToken,
  hashToken,
};
