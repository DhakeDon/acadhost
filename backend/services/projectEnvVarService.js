'use strict';

// ============================================================
// Project Environment Variable Service
// services/projectEnvVarService.js
//
// Manages per-project custom environment variables.
// Both keys and values are encrypted at rest using AES-256-CBC
// with DB_ENCRYPTION_KEY (same key used for database passwords).
//
// Reserved keys (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME)
// are blocked at the service layer — these are auto-injected by
// dockerService when a database is attached, and student-defined
// values must never override them.
// ============================================================

const pool = require('../config/db');
const { encryptPassword, decryptPassword } = require('../utils/encryptHelper');

// Reserved environment variable keys that students may NOT set.
// These are auto-injected by dockerService when projects.database_id
// is not null (Section 7.6).
const RESERVED_ENV_KEYS = new Set([
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
]);

// POSIX-ish env var key format: [A-Z_][A-Z0-9_]*
// Must start with uppercase letter or underscore, then uppercase/digit/underscore.
// Max length 128 chars (matches column).
const KEY_REGEX = /^[A-Z_][A-Z0-9_]{0,127}$/;

// Max value length (bytes of plaintext). 2048 chars is plenty for secrets,
// API keys, connection strings. Keeps encrypted output under the 4096-char
// value_encrypted column.
const MAX_VALUE_LENGTH = 2048;

function _getKey() {
    const k = process.env.DB_ENCRYPTION_KEY;
    if (!k || k.length !== 32) {
        throw new Error('DB_ENCRYPTION_KEY must be exactly 32 characters');
    }
    return k;
}

/**
 * Validates an env var key and value. Throws an Error with `.code` and
 * `.message` on validation failure so callers can map to HTTP errors.
 */
function validateKeyValue(key, value) {
    if (typeof key !== 'string' || key.length === 0) {
        const e = new Error('Environment variable key is required');
        e.code = 'ENV_VAR_KEY_REQUIRED';
        throw e;
    }
    if (!KEY_REGEX.test(key)) {
        const e = new Error(
            'Key must start with an uppercase letter or underscore and contain only uppercase letters, digits, and underscores (e.g. API_KEY, MY_SECRET_1)'
        );
        e.code = 'ENV_VAR_KEY_INVALID';
        throw e;
    }
    if (RESERVED_ENV_KEYS.has(key)) {
        const e = new Error(
            `"${key}" is reserved — it is auto-injected when a database is attached to this project`
        );
        e.code = 'ENV_VAR_KEY_RESERVED';
        throw e;
    }
    if (typeof value !== 'string') {
        const e = new Error('Environment variable value must be a string');
        e.code = 'ENV_VAR_VALUE_INVALID';
        throw e;
    }
    if (value.length > MAX_VALUE_LENGTH) {
        const e = new Error(
            `Environment variable value must not exceed ${MAX_VALUE_LENGTH} characters`
        );
        e.code = 'ENV_VAR_VALUE_TOO_LONG';
        throw e;
    }
}

/**
 * List all custom env vars for a project (decrypted).
 *
 * @param {number} projectId
 * @returns {Promise<Array<{id:number,key:string,value:string,createdAt:Date,updatedAt:Date}>>}
 */
async function listForProject(projectId) {
    const key = _getKey();
    const [rows] = await pool.query(
        `SELECT id, key_plain, value_encrypted, created_at, updated_at
           FROM project_env_vars
          WHERE project_id = ?
          ORDER BY key_plain ASC`,
        [projectId]
    );
    return rows.map((r) => ({
        id: r.id,
        key: r.key_plain,
        value: decryptPassword(r.value_encrypted, key),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    }));
}

/**
 * Returns a plain { KEY: value } map of all custom env vars for a project.
 * Used by dockerService callers when building `docker create -e` flags.
 *
 * @param {number} projectId
 * @returns {Promise<Object>}
 */
async function getEnvVarMap(projectId) {
    const items = await listForProject(projectId);
    const out = {};
    for (const it of items) out[it.key] = it.value;
    return out;
}

/**
 * Bulk replace: deletes all existing env vars for the project, then inserts
 * the provided list. Used during project creation and when the student
 * submits the full env-var list from Project Settings.
 *
 * Validates every item before any DB writes — if one is invalid, nothing
 * is written.
 *
 * @param {number} projectId
 * @param {Array<{key:string,value:string}>} items
 * @returns {Promise<void>}
 */
async function replaceAllForProject(projectId, items) {
    if (!Array.isArray(items)) {
        const e = new Error('envVars must be an array');
        e.code = 'ENV_VAR_PAYLOAD_INVALID';
        throw e;
    }

    // Validate all first; collect duplicates.
    const seen = new Set();
    for (const it of items) {
        if (!it || typeof it !== 'object') {
            const e = new Error('Each env var must be an object with key and value');
            e.code = 'ENV_VAR_PAYLOAD_INVALID';
            throw e;
        }
        validateKeyValue(it.key, it.value);
        if (seen.has(it.key)) {
            const e = new Error(`Duplicate env var key: ${it.key}`);
            e.code = 'ENV_VAR_KEY_DUPLICATE';
            throw e;
        }
        seen.add(it.key);
    }

    const key = _getKey();
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM project_env_vars WHERE project_id = ?', [projectId]);
        for (const it of items) {
            await conn.query(
                `INSERT INTO project_env_vars
                   (project_id, key_plain, key_encrypted, value_encrypted)
                 VALUES (?, ?, ?, ?)`,
                [
                    projectId,
                    it.key,
                    encryptPassword(it.key, key),
                    encryptPassword(it.value, key),
                ]
            );
        }
        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Upsert a single env var (create if missing, update if key already exists
 * for this project).
 *
 * @param {number} projectId
 * @param {string} k
 * @param {string} v
 * @returns {Promise<{id:number,key:string,value:string}>}
 */
async function upsertOne(projectId, k, v) {
    validateKeyValue(k, v);
    const key = _getKey();
    const keyEnc = encryptPassword(k, key);
    const valEnc = encryptPassword(v, key);

    await pool.query(
        `INSERT INTO project_env_vars
           (project_id, key_plain, key_encrypted, value_encrypted)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           key_encrypted   = VALUES(key_encrypted),
           value_encrypted = VALUES(value_encrypted)`,
        [projectId, k, keyEnc, valEnc]
    );

    const [[row]] = await pool.query(
        `SELECT id, key_plain, value_encrypted
           FROM project_env_vars
          WHERE project_id = ? AND key_plain = ?
          LIMIT 1`,
        [projectId, k]
    );
    return {
        id: row.id,
        key: row.key_plain,
        value: decryptPassword(row.value_encrypted, key),
    };
}

/**
 * Update an existing env var row by its id. Allows renaming (change of key)
 * and/or updating the value. Enforces project ownership at the controller
 * layer — this service only checks row existence scoped to projectId.
 *
 * @param {number} projectId
 * @param {number} envId
 * @param {string} newKey
 * @param {string} newValue
 * @returns {Promise<{id:number,key:string,value:string}|null>}  null when not found
 */
async function updateOne(projectId, envId, newKey, newValue) {
    validateKeyValue(newKey, newValue);
    const key = _getKey();

    const [[existing]] = await pool.query(
        'SELECT id FROM project_env_vars WHERE id = ? AND project_id = ? LIMIT 1',
        [envId, projectId]
    );
    if (!existing) return null;

    // If the key is changing, ensure no other row in this project already uses it.
    const [[conflict]] = await pool.query(
        `SELECT id FROM project_env_vars
          WHERE project_id = ? AND key_plain = ? AND id != ?
          LIMIT 1`,
        [projectId, newKey, envId]
    );
    if (conflict) {
        const e = new Error(`Duplicate env var key: ${newKey}`);
        e.code = 'ENV_VAR_KEY_DUPLICATE';
        throw e;
    }

    await pool.query(
        `UPDATE project_env_vars
            SET key_plain       = ?,
                key_encrypted   = ?,
                value_encrypted = ?
          WHERE id = ? AND project_id = ?`,
        [
            newKey,
            encryptPassword(newKey, key),
            encryptPassword(newValue, key),
            envId,
            projectId,
        ]
    );

    return { id: envId, key: newKey, value: newValue };
}

/**
 * Delete a single env var scoped to a project. Returns true when a row
 * was deleted, false when it did not exist.
 *
 * @param {number} projectId
 * @param {number} envId
 * @returns {Promise<boolean>}
 */
async function deleteOne(projectId, envId) {
    const [result] = await pool.query(
        'DELETE FROM project_env_vars WHERE id = ? AND project_id = ?',
        [envId, projectId]
    );
    return result.affectedRows > 0;
}

/**
 * Delete all env vars for a project. Called by project cleanup — note that
 * the FK cascade already does this, but an explicit call is kept for
 * belt-and-suspenders cleanup logging.
 *
 * @param {number} projectId
 * @returns {Promise<number>}  number of rows deleted
 */
async function deleteAllForProject(projectId) {
    const [result] = await pool.query(
        'DELETE FROM project_env_vars WHERE project_id = ?',
        [projectId]
    );
    return result.affectedRows;
}

module.exports = {
    RESERVED_ENV_KEYS: Array.from(RESERVED_ENV_KEYS),
    MAX_VALUE_LENGTH,
    validateKeyValue,
    listForProject,
    getEnvVarMap,
    replaceAllForProject,
    upsertOne,
    updateOne,
    deleteOne,
    deleteAllForProject,
};