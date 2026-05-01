'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const tokenHelper = require('../utils/tokenHelper');
const emailService = require('../services/emailService');
const databaseProvisioningService = require('../services/databaseProvisioningService');

// ─── Cookie configuration (Section 5.10) ────────────────────────────────────
// In development (NODE_ENV !== 'production') the frontend runs on http://localhost:3001
// and the backend on http://localhost:3000. Browsers DROP secure:true cookies on plain
// HTTP and DROP sameSite:'Strict' cookies on cross-origin requests — which is why the
// refresh cookie disappears on reload. We relax both flags only outside production.
const IS_PROD = process.env.NODE_ENV === 'production';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   IS_PROD,                    // false in dev (http://localhost)
  sameSite: IS_PROD ? 'Strict' : 'Lax', // Lax allows top-level navigation + same-site XHR in dev
  path:     '/api/auth',
  maxAge:   7 * 24 * 60 * 60 * 1000,    // 7 days in ms
};

function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: IS_PROD ? 'Strict' : 'Lax',
    path:     '/api/auth',
  });
}
// ─── POST /api/auth/login ────────────────────────────────────────────────────
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Email and password are required',
      });
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid email format',
      });
    }

    const [users] = await db.execute(
      'SELECT id, email, password_hash, name, role, status, must_change_password FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    const user = users[0];

    if (user.status === 'invited') {
      return res.status(401).json({
        success: false,
        error: 'REGISTRATION_INCOMPLETE',
        message: 'Please complete registration using your invitation link',
      });
    }
    if (user.status === 'suspended') {
      return res.status(401).json({
        success: false,
        error: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended. Contact the administrator.',
      });
    }

    if (user.status === 'removed') {
      return res.status(401).json({
        success: false,
        error: 'ACCOUNT_REMOVED',
        message: 'This account has been deactivated',
      });
    }
    if (user.status === 'removed') {
      return res.status(401).json({
        success: false,
        error: 'ACCOUNT_REMOVED',
        message: 'This account has been deactivated',
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    const accessToken = tokenHelper.generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    const refreshTokenRaw = tokenHelper.generateRefreshToken({ id: user.id });
    const refreshTokenHash = tokenHelper.hashToken(refreshTokenRaw);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.execute(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked) VALUES (?, ?, ?, 0)',
      [user.id, refreshTokenHash, expiresAt]
    );

    res.cookie('refreshToken', refreshTokenRaw, REFRESH_COOKIE_OPTIONS);

    const responseUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    if (user.must_change_password) {
      responseUser.mustChangePassword = true;
    }

    return res.status(200).json({
      success: true,
      data: {
        accessToken,
        user: responseUser,
      },
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────
async function register(req, res) {
  try {
    const { token, name, password } = req.body;

    if (!token || !name || !password) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Token, name, and password are required',
      });
    }

    // Verify JWT signature
    let decoded;
    try {
      decoded = tokenHelper.verifyInviteToken(token);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'INVITE_INVALID',
        message: 'Invalid invitation token',
      });
    }

    // Look up token hash in DB
    const tokenHash = tokenHelper.hashToken(token);
    const [rows] = await db.execute(
      'SELECT id, email, used, expires_at FROM invite_tokens WHERE token_hash = ?',
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVITE_INVALID',
        message: 'Invalid invitation token',
      });
    }

    const inviteRow = rows[0];

    if (inviteRow.used) {
      return res.status(400).json({
        success: false,
        error: 'INVITE_ALREADY_USED',
        message: 'This invitation has already been used',
      });
    }

    if (new Date(inviteRow.expires_at) < new Date()) {
      return res.status(410).json({
        success: false,
        error: 'INVITE_EXPIRED',
        message: 'This invitation has expired',
        canResend: true,
      });
    }

    if (!name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'NAME_REQUIRED',
        message: 'Name is required',
      });
    }

    if (name.length > 255) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Name must not exceed 255 characters',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'PASSWORD_TOO_SHORT',
        message: 'Password must be at least 8 characters',
      });
    }

    if (password.length > 128) {
      return res.status(400).json({
        success: false,
        error: 'PASSWORD_TOO_LONG',
        message: 'Password must not exceed 128 characters',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Update the user row
    await db.execute(
      "UPDATE users SET password_hash = ?, name = ?, status = 'active' WHERE email = ?",
      [passwordHash, name.trim(), inviteRow.email]
    );

    // Mark token as used
    await db.execute('UPDATE invite_tokens SET used = 1 WHERE id = ?', [inviteRow.id]);

    // Get the updated user
    const [updatedUsers] = await db.execute(
      'SELECT id, email, name, role FROM users WHERE email = ?',
      [inviteRow.email]
    );
    const user = updatedUsers[0];

    // Issue tokens
    const accessToken = tokenHelper.generateAccessToken({ id: user.id, email: user.email, role: user.role });
    const refreshTokenRaw = tokenHelper.generateRefreshToken({ id: user.id });
    const refreshTokenHash = tokenHelper.hashToken(refreshTokenRaw);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.execute(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked) VALUES (?, ?, ?, 0)',
      [user.id, refreshTokenHash, expiresAt]
    );

    res.cookie('refreshToken', refreshTokenRaw, REFRESH_COOKIE_OPTIONS);

    return res.status(201).json({
      success: true,
      data: {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/auth/refresh ──────────────────────────────────────────────────
async function refresh(req, res) {
  try {
    const rawToken = req.cookies && req.cookies.refreshToken;

    if (!rawToken) {
      return res.status(401).json({
        success: false,
        error: 'REFRESH_TOKEN_REQUIRED',
        message: 'Refresh token is required',
      });
    }

    // Verify JWT signature
    let decoded;
    try {
      decoded = tokenHelper.verifyRefreshToken(rawToken);
    } catch (e) {
      return res.status(401).json({
        success: false,
        error: 'REFRESH_TOKEN_INVALID',
        message: 'Invalid refresh token',
      });
    }

    const tokenHash = tokenHelper.hashToken(rawToken);
    const [rows] = await db.execute(
      'SELECT id, user_id, revoked, expires_at FROM refresh_tokens WHERE token_hash = ?',
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'REFRESH_TOKEN_INVALID',
        message: 'Invalid refresh token',
      });
    }

    const tokenRow = rows[0];

    if (tokenRow.revoked) {
      return res.status(401).json({
        success: false,
        error: 'REFRESH_TOKEN_REVOKED',
        message: 'Refresh token has been revoked',
      });
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      return res.status(401).json({
        success: false,
        error: 'REFRESH_TOKEN_EXPIRED',
        message: 'Refresh token has expired',
      });
    }

    // Check user is still active
    const [users] = await db.execute(
      "SELECT id, email, role, status FROM users WHERE id = ?",
      [tokenRow.user_id]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'ACCOUNT_INACTIVE',
        message: 'Account not found',
      });
    }

    const user = users[0];

    if (user.status !== 'active') {
      await db.execute(
          'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?',
          [user.id]
      );

      if (user.status === 'suspended') {
        return res.status(401).json({
          success: false,
          error: 'ACCOUNT_SUSPENDED',
          message: 'Your account has been suspended. Contact the administrator.',
        });
      }

      return res.status(401).json({
        success: false,
        error: 'ACCOUNT_INACTIVE',
        message: 'Account is not active',
      });
    }

    // Token rotation: revoke old token
    await db.execute('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', [tokenRow.id]);

    // Issue new tokens
    const newAccessToken = tokenHelper.generateAccessToken({ id: user.id, email: user.email, role: user.role });
    const newRefreshTokenRaw = tokenHelper.generateRefreshToken({ id: user.id });
    const newRefreshTokenHash = tokenHelper.hashToken(newRefreshTokenRaw);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.execute(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked) VALUES (?, ?, ?, 0)',
      [user.id, newRefreshTokenHash, expiresAt]
    );

    res.cookie('refreshToken', newRefreshTokenRaw, REFRESH_COOKIE_OPTIONS);

    return res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (err) {
    console.error('refresh error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
async function logout(req, res) {
  try {
    const rawToken = req.cookies && req.cookies.refreshToken;

    if (rawToken) {
      const tokenHash = tokenHelper.hashToken(rawToken);
      await db.execute(
        'UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?',
        [tokenHash]
      );
    }

    clearRefreshCookie(res);

    return res.status(200).json({
      success: true,
      data: { message: 'LOGGED_OUT' },
    });
  } catch (err) {
    console.error('logout error:', err);
    // Logout is idempotent — clear cookie regardless
    clearRefreshCookie(res);
    return res.status(200).json({
      success: true,
      data: { message: 'LOGGED_OUT' },
    });
  }
}

// ─── GET /api/auth/invite/validate ──────────────────────────────────────────
async function validateInvite(req, res) {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Token is required',
      });
    }

    // Verify JWT signature
    let decoded;
    try {
      decoded = tokenHelper.verifyInviteToken(token);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'INVITE_INVALID',
        message: 'Invalid invitation token',
      });
    }

    const tokenHash = tokenHelper.hashToken(token);
    const [rows] = await db.execute(
      'SELECT id, email, batch_year, used, expires_at FROM invite_tokens WHERE token_hash = ?',
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVITE_INVALID',
        message: 'Invalid invitation token',
      });
    }

    const inviteRow = rows[0];

    if (inviteRow.used) {
      return res.status(400).json({
        success: false,
        error: 'INVITE_ALREADY_USED',
        message: 'This invitation has already been used',
      });
    }

    if (new Date(inviteRow.expires_at) < new Date()) {
      return res.status(410).json({
        success: false,
        error: 'INVITE_EXPIRED',
        message: 'This invitation has expired',
        canResend: true,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        valid: true,
        email: inviteRow.email,
        batchYear: inviteRow.batch_year || null,
      },
    });
  } catch (err) {
    console.error('validateInvite error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/auth/forgot-password ─────────────────────────────────────────
// ALWAYS returns 200 OK regardless of email existence (Section 5.9.8)
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Email is required',
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid email format',
      });
    }

    // Look up user silently
    const [users] = await db.execute(
      "SELECT id, email, status FROM users WHERE email = ?",
      [email]
    );

    if (users.length > 0 && users[0].status === 'active') {
      const user = users[0];

      // Generate reset token: 32 random bytes hex-encoded
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = tokenHelper.hashToken(rawToken);
      const expiresAt = new Date(
        Date.now() + parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRY_HOURS || '1', 10) * 60 * 60 * 1000
      );

      await db.execute(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used) VALUES (?, ?, ?, 0)',
        [user.id, tokenHash, expiresAt]
      );

      const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}`;
      try {
        await emailService.sendPasswordResetEmail(user.email, resetLink);
      } catch (emailErr) {
        console.warn('forgotPassword: failed to send reset email:', emailErr.message);
        // Non-blocking — token still created
      }
    }

    // Always return 200 OK
    return res.status(200).json({
      success: true,
      data: { message: 'PASSWORD_RESET_EMAIL_SENT' },
    });
  } catch (err) {
    console.error('forgotPassword error:', err);
    return res.status(200).json({
      success: true,
      data: { message: 'PASSWORD_RESET_EMAIL_SENT' },
    });
  }
}

// ─── POST /api/auth/reset-password ──────────────────────────────────────────
async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Token and new password are required',
      });
    }

    const tokenHash = tokenHelper.hashToken(token);
    const [rows] = await db.execute(
      'SELECT id, user_id, used, expires_at FROM password_reset_tokens WHERE token_hash = ?',
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'TOKEN_INVALID',
        message: 'Invalid password reset token',
      });
    }

    const resetRow = rows[0];

    if (resetRow.used) {
      return res.status(400).json({
        success: false,
        error: 'TOKEN_USED',
        message: 'This reset token has already been used',
      });
    }

    if (new Date(resetRow.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'TOKEN_EXPIRED',
        message: 'This reset token has expired',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'PASSWORD_TOO_SHORT',
        message: 'Password must be at least 8 characters',
      });
    }

    if (newPassword.length > 128) {
      return res.status(400).json({
        success: false,
        error: 'PASSWORD_TOO_LONG',
        message: 'Password must not exceed 128 characters',
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update user password
    await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, resetRow.user_id]);

    // Mark token as used
    await db.execute('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetRow.id]);

    // Revoke ALL refresh tokens for this user (Section 5.9.9)
    await db.execute(
      'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?',
      [resetRow.user_id]
    );

    return res.status(200).json({
      success: true,
      data: { message: 'PASSWORD_RESET_SUCCESSFUL' },
    });
  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── PUT /api/auth/password ──────────────────────────────────────────────────
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Current password and new password are required',
      });
    }

    const [users] = await db.execute(
      'SELECT id, password_hash, must_change_password FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, error: 'USER_NOT_FOUND', message: 'User not found' });
    }

    const user = users[0];

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return res.status(401).json({
        success: false,
        error: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Current password is incorrect',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'PASSWORD_TOO_SHORT',
        message: 'Password must be at least 8 characters',
      });
    }

    if (newPassword.length > 128) {
      return res.status(400).json({
        success: false,
        error: 'PASSWORD_TOO_LONG',
        message: 'Password must not exceed 128 characters',
      });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    const updates = ['password_hash = ?'];
    const params = [newHash];

    if (user.must_change_password) {
      updates.push('must_change_password = 0');
    }

    await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...params, user.id]);

    // Revoke all refresh tokens EXCEPT current session (Section 5.9.7)
    const rawToken = req.cookies && req.cookies.refreshToken;
    if (rawToken) {
      const currentHash = tokenHelper.hashToken(rawToken);
      await db.execute(
        'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND token_hash != ?',
        [user.id, currentHash]
      );
    } else {
      // No current session cookie found — revoke all
      await db.execute(
        'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?',
        [user.id]
      );
    }

    return res.status(200).json({
      success: true,
      data: { message: 'PASSWORD_CHANGED' },
    });
  } catch (err) {
    console.error('changePassword error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/auth/phpmyadmin/verify (internal only) ───────────────────────
// Nginx blocks external access. phpMyAdmin signon.php calls this via host.docker.internal.
async function verifyPhpMyAdminSession(req, res) {
  try {
    const { token, databaseId } = req.body;

    if (!token || !databaseId) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Token and databaseId are required',
      });
    }

    // Verify access token
    let decoded;
    try {
      decoded = tokenHelper.verifyAccessToken(token);
    } catch (e) {
      return res.status(401).json({
        success: false,
        error: 'TOKEN_INVALID',
        message: 'Invalid or expired token',
      });
    }

    const userId = parseInt(decoded.sub, 10);

    // Verify ownership
    const [rows] = await db.execute(
      'SELECT id, db_name, db_user, db_password_encrypted FROM `databases` WHERE id = ? AND user_id = ?',
      [databaseId, userId]
    );

    if (rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_DENIED',
        message: 'Access denied to this database',
      });
    }

    const dbRow = rows[0];

    // Decrypt password (Section 5.11)
    const plainPassword = databaseProvisioningService.decryptPassword(dbRow.db_password_encrypted);

    return res.status(200).json({
      valid: true,
      dbUser: dbRow.db_user,
      dbPassword: plainPassword,
      dbHost: '127.0.0.1',
      dbName: dbRow.db_name,
    });
  } catch (err) {
    console.error('verifyPhpMyAdminSession error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

module.exports = {
  login,
  register,
  refresh,
  logout,
  validateInvite,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyPhpMyAdminSession,
};
