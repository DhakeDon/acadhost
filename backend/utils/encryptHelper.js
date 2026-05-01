'use strict';

// ============================================================
// Encryption Utilities — utils/encryptHelper.js
// Section 5.11 — AES-256-CBC at-rest encryption.
//
// Used for:
//   - databases.db_password_encrypted
//   - project_env_vars.key_encrypted
//   - project_env_vars.value_encrypted
//
// Key source (default): process.env.DB_ENCRYPTION_KEY (exactly 32 bytes).
// Caller may pass an explicit key as the 2nd argument for testing.
// ============================================================

const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function _resolveKey(explicitKey) {
  const k = explicitKey || process.env.DB_ENCRYPTION_KEY;
  if (!k || k.length !== 32) {
    throw new Error('DB_ENCRYPTION_KEY must be exactly 32 characters');
  }
  return k;
}

/**
 * Encrypts plaintext using AES-256-CBC.
 * @param {string} plaintext
 * @param {string} [encryptionKey] — optional; falls back to DB_ENCRYPTION_KEY
 * @returns {string} "<hex_iv>:<hex_ciphertext>"
 */
function encryptPassword(plaintext, encryptionKey) {
  const k = _resolveKey(encryptionKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(k, 'utf8'), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypts an AES-256-CBC encrypted value.
 * @param {string} encryptedValue — "<hex_iv>:<hex_ciphertext>"
 * @param {string} [encryptionKey] — optional; falls back to DB_ENCRYPTION_KEY
 * @returns {string} plaintext
 */
function decryptPassword(encryptedValue, encryptionKey) {
  const k = _resolveKey(encryptionKey);
  const [ivHex, encryptedHex] = encryptedValue.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(k, 'utf8'), iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encryptPassword, decryptPassword };