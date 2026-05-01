'use strict';

// ============================================================
// Database Provisioning Service — services/databaseProvisioningService.js
// Section 9
//
// Sole file that executes MySQL provisioning commands:
//   CREATE DATABASE, CREATE USER, GRANT, DROP USER, DROP DATABASE,
//   REVOKE, FLUSH PRIVILEGES
//
// Uses a dedicated root MySQL connection (separate from the
// platform connection pool in config/db.js).
// ============================================================

const mysql  = require('mysql2/promise');
const crypto = require('crypto');
const pool   = require('../config/db');

// ── Root connection ──────────────────────────────────────────

/**
 * Creates a one-off root MySQL connection for provisioning.
 * Caller must call connection.end() in a finally block.
 *
 * @returns {Promise<mysql.Connection>}
 */
async function getRootConnection() {
  return mysql.createConnection({
    host:     process.env.MYSQL_HOST     || 'localhost',
    port:     parseInt(process.env.MYSQL_PORT, 10) || 3306,
    user:     'root',
    password: process.env.MYSQL_ROOT_PASSWORD,
  });
}

// ── Password encryption / decryption ─────────────────────────

/**
 * Encrypts a plaintext database password using AES-256-CBC.
 * Returns format: <hex_iv>:<hex_ciphertext>
 *
 * Key source: DB_ENCRYPTION_KEY env var (exactly 32 UTF-8 chars = 256 bits).
 *
 * @param {string} plaintext
 * @returns {string}
 */
function encryptPassword(plaintext) {
  const key    = process.env.DB_ENCRYPTION_KEY;
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted    += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypts a stored AES-256-CBC encrypted password.
 * Input format: <hex_iv>:<hex_ciphertext>
 *
 * Called by:
 *   - dockerService.js when injecting DB_PASSWORD into containers
 *   - authController.verifyPhpMyAdminSession
 *
 * @param {string} encryptedValue
 * @returns {string} plaintext password
 */
function decryptPassword(encryptedValue) {
  const key            = process.env.DB_ENCRYPTION_KEY;
  const [ivHex, encHex] = encryptedValue.split(':');
  const iv             = Buffer.from(ivHex, 'hex');
  const decipher       = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), iv);
  let decrypted        = decipher.update(encHex, 'hex', 'utf8');
  decrypted           += decipher.final('utf8');
  return decrypted;
}

// ── provisionDatabase ────────────────────────────────────────

/**
 * Provisions a new MySQL schema and restricted user for a student database.
 *
 * Steps (Section 9.6.2):
 *   3.  Generate schema name and MySQL username.
 *   4.  Validate generated name lengths.
 *   5.  Generate random password (base64url).
 *   6.  Encrypt the password.
 *   7.  Obtain root connection.
 *   8.  CREATE DATABASE.
 *   9.  CREATE USER.
 *   10. GRANT ALL PRIVILEGES.
 *   11. FLUSH PRIVILEGES.
 *   12. INSERT row into databases table (platform pool).
 *   13. Close root connection.
 *
 * Rollback: on any MySQL failure, drops created artifacts in reverse order.
 *
 * @param {number} userId
 * @param {string} dbName — student's input display name (alphanumeric + underscores)
 * @returns {Promise<{ id: number, dbName: string, mysqlSchemaName: string, createdAt: string }>}
 */
async function provisionDatabase(userId, dbName) {
  const schemaName = `s${userId}_${dbName}`;
  const mysqlUser  = `u${userId}_${dbName}`;

  if (schemaName.length > 64) {
    throw {
      code: 'VALIDATION_ERROR',
      message: 'Generated database name exceeds maximum length',
      httpStatus: 400,
    };
  }
  if (mysqlUser.length > 32) {
    throw {
      code: 'VALIDATION_ERROR',
      message: 'Generated username exceeds maximum length',
      httpStatus: 400,
    };
  }

  const password          = crypto.randomBytes(24).toString('base64url');
  const encryptedPassword = encryptPassword(password);

  const connection = await getRootConnection();

  let schemaCreated = false;
  let userCreated   = false;

  try {
    await connection.execute(
        `CREATE DATABASE \`${schemaName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    schemaCreated = true;

    await connection.execute(
        `CREATE USER '${mysqlUser}'@'%' IDENTIFIED BY '${password}'`
    );
    userCreated = true;

    await connection.execute(
        `GRANT ALL PRIVILEGES ON \`${schemaName}\`.* TO '${mysqlUser}'@'%'`
    );

    await connection.execute('FLUSH PRIVILEGES');

    // ✅ FIX: backticks around reserved word `databases`
    const [result] = await pool.query(
        'INSERT INTO `databases` (user_id, db_name, db_user, db_password_encrypted) VALUES (?, ?, ?, ?)',
        [userId, schemaName, mysqlUser, encryptedPassword]
    );

    const insertId = result.insertId;

    // ✅ FIX: backticks around reserved word `databases`
    const [[row]] = await pool.query(
        'SELECT created_at FROM `databases` WHERE id = ? LIMIT 1',
        [insertId]
    );

    return {
      id:              insertId,
      dbName,
      mysqlSchemaName: schemaName,
      createdAt:       row.created_at,
    };

  } catch (err) {
    if (userCreated) {
      try {
        await connection.execute(`DROP USER IF EXISTS '${mysqlUser}'@'%'`);
      } catch (dropUserErr) {
        console.error(`[databaseProvisioning] Rollback: failed to drop user ${mysqlUser}: ${dropUserErr.message}`);
      }
    }
    if (schemaCreated) {
      try {
        await connection.execute(`DROP DATABASE IF EXISTS \`${schemaName}\``);
      } catch (dropDbErr) {
        console.error(`[databaseProvisioning] Rollback: failed to drop schema ${schemaName}: ${dropDbErr.message}`);
      }
    }
    throw err;

  } finally {
    await connection.end().catch((e) =>
        console.error(`[databaseProvisioning] Error closing root connection: ${e.message}`)
    );
  }
}
// ── dropDatabase ─────────────────────────────────────────────

/**
 * Tears down a MySQL schema and its restricted user.
 * Best-effort: logs errors but continues to the next step.
 *
 * Teardown order (Section 9.8.3):
 *   1. REVOKE ALL PRIVILEGES, GRANT OPTION FROM user
 *   2. DROP USER IF EXISTS
 *   3. DROP DATABASE IF EXISTS
 *   4. FLUSH PRIVILEGES
 *
 * @param {string} dbNameColumn — value from databases.db_name (e.g. 's42_mydb')
 * @param {string} dbUser       — value from databases.db_user (e.g. 'u42_mydb')
 */
async function dropDatabase(dbNameColumn, dbUser) {
  const connection = await getRootConnection();

  try {
    try {
      await connection.execute(
          `REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${dbUser}'@'%'`
      );
    } catch (revokeErr) {
      console.warn(`[databaseProvisioning] REVOKE failed for ${dbUser} (may not exist): ${revokeErr.message}`);
    }

    try {
      await connection.execute(`DROP USER IF EXISTS '${dbUser}'@'%'`);
    } catch (dropUserErr) {
      console.error(`[databaseProvisioning] DROP USER failed for ${dbUser}: ${dropUserErr.message}`);
    }

    try {
      await connection.execute(`DROP DATABASE IF EXISTS \`${dbNameColumn}\``);
    } catch (dropDbErr) {
      console.error(`[databaseProvisioning] DROP DATABASE failed for ${dbNameColumn}: ${dropDbErr.message}`);
      throw dropDbErr;
    }

    await connection.execute('FLUSH PRIVILEGES');

  } finally {
    await connection.end().catch((e) =>
        console.error(`[databaseProvisioning] Error closing root connection: ${e.message}`)
    );
  }
}
// ── dropAllDatabasesForStudent ───────────────────────────────

/**
 * Drops all MySQL schemas and restricted users for a student.
 * Called during student removal (Section 9.9).
 *
 * Continues processing remaining databases if one fails.
 *
 * @param {number} userId
 * @returns {Promise<{ totalDatabases: number, droppedSuccessfully: number, failed: string[] }>}
 */
async function dropAllDatabasesForStudent(userId) {
  // ✅ FIX: backticks around reserved word `databases`
  const [rows] = await pool.query(
      'SELECT db_name, db_user FROM `databases` WHERE user_id = ?',
      [userId]
  );

  let droppedSuccessfully = 0;
  const failed = [];

  for (const record of rows) {
    try {
      await dropDatabase(record.db_name, record.db_user);
      droppedSuccessfully += 1;
    } catch (err) {
      console.error(
          `[databaseProvisioning] Failed to drop database ${record.db_name} ` +
          `(user ${record.db_user}): ${err.message || err}`
      );
      failed.push(record.db_name);
    }
  }

  return {
    totalDatabases: rows.length,
    droppedSuccessfully,
    failed,
  };
}

module.exports = {
  provisionDatabase,
  dropDatabase,
  dropAllDatabasesForStudent,
  encryptPassword,
  decryptPassword,
};
