'use strict';

const db = require('../config/db');
const databaseProvisioningService = require('../services/databaseProvisioningService');
const quotaChecker = require('../utils/quotaChecker');

// ─── POST /api/databases ─────────────────────────────────────────────────────
async function createDatabase(req, res) {
  try {
    const studentId = req.user.id;
    const { dbName } = req.body;

    if (!dbName) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Database name is required' });
    }

    // Validate dbName format: alphanumeric and underscores, 1-64 chars
    const dbNameRegex = /^[a-zA-Z0-9_]{1,64}$/;
    if (!dbNameRegex.test(dbName)) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Database name must be alphanumeric and underscores, 1-64 characters',
      });
    }

    // Check 1: Database quota
    try {
      await quotaChecker.checkDatabaseQuota(studentId);
    } catch (quotaErr) {
      return res.status(400).json({ success: false, error: quotaErr.code, message: quotaErr.message });
    }

    // Check 2: Duplicate name for this student
    // The naming convention: actual schema name is s{user_id}_{dbName}
    // We store the schema name in db_name column (Section 9.3.1)
    const schemaName = `s${studentId}_${dbName}`;
    const [existingRows] = await db.execute(
      'SELECT id FROM `databases` WHERE user_id = ? AND db_name = ?',
      [studentId, schemaName]
    );
    if (existingRows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'DATABASE_NAME_DUPLICATE',
        message: `You already have a database named '${dbName}'`,
      });
    }

    // Provision the database (Section 9.6)
    const result = await databaseProvisioningService.provisionDatabase(studentId, dbName);

    return res.status(201).json({
      success: true,
      data: {
        id: result.id,
        dbName: dbName,
        mysqlSchemaName: result.mysqlSchemaName,
        createdAt: result.createdAt,
      },
    });
  } catch (err) {
    console.error('createDatabase error:', err);
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ success: false, error: err.code, message: err.message });
    }
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── GET /api/databases ──────────────────────────────────────────────────────
async function listDatabases(req, res) {
  try {
    const studentId = req.user.id;

    const [rows] = await db.execute(
      'SELECT id, db_name, db_user, created_at FROM `databases` WHERE user_id = ? ORDER BY created_at ASC',
      [studentId]
    );

    const [userRows] = await db.execute(
      'SELECT max_databases FROM users WHERE id = ?',
      [studentId]
    );

    const maxDatabases = userRows.length > 0 ? userRows[0].max_databases : 4;
    const phpmyadminUrl = process.env.PHPMYADMIN_URL || 'http://localhost:8080';

    const items = rows.map((row) => {
      // Derive display name from schema name: strip s{user_id}_ prefix
      const prefix = `s${studentId}_`;
      const displayName = row.db_name.startsWith(prefix)
        ? row.db_name.slice(prefix.length)
        : row.db_name;

      return {
        id: row.id,
        dbName: displayName,
        mysqlSchemaName: row.db_name,
        phpMyAdminUrl: `${phpmyadminUrl}?server=1&db=${encodeURIComponent(row.db_name)}&user=${encodeURIComponent(row.db_user)}`,
        createdAt: row.created_at,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        items,
        quota: {
          used: rows.length,
          total: maxDatabases,
        },
      },
    });
  } catch (err) {
    console.error('listDatabases error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── GET /api/databases/:id/phpmyadmin ───────────────────────────────────────
async function getPhpMyAdminLink(req, res) {
  try {
    const studentId  = req.user.id;
    const databaseId = parseInt(req.params.id, 10);

    const [rows] = await db.execute(
        'SELECT id, db_name, db_user FROM `databases` WHERE id = ? AND user_id = ?',
        [databaseId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'DATABASE_NOT_FOUND', message: 'Database not found' });
    }

    const phpmyadminUrl = process.env.PHPMYADMIN_URL || 'http://localhost:8083';

    // Get the raw access token from Authorization header
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const link = `${phpmyadminUrl}/launch.php?token=${encodeURIComponent(token)}&databaseId=${databaseId}`;
    return res.status(200).json({
      success: true,
      data: { databaseId, phpMyAdminUrl: link },
    });
  } catch (err) {
    console.error('getPhpMyAdminLink error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── DELETE /api/databases/:id ───────────────────────────────────────────────
async function deleteDatabase(req, res) {
  try {
    const studentId = req.user.id;
    const databaseId = parseInt(req.params.id, 10);

    // Fetch the database row — must belong to this student
    const [rows] = await db.execute(
        'SELECT id, db_name, db_user FROM `databases` WHERE id = ? AND user_id = ?',
        [databaseId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'DATABASE_NOT_FOUND',
        message: 'Database not found',
      });
    }

    const dbRow = rows[0];

    // Check if any project is currently attached to this database
    const [attachedProjects] = await db.execute(
        "SELECT id, title FROM projects WHERE database_id = ? AND status != 'deleted'",
        [databaseId]
    );

    if (attachedProjects.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'DATABASE_IN_USE',
        message: `Database is attached to ${attachedProjects.length} project(s). Detach it first before deleting.`,
      });
    }

    // Drop MySQL schema and user (databaseProvisioningService handles ORDER correctly:
    // REVOKE → DROP USER → DROP DATABASE → FLUSH PRIVILEGES)
    await databaseProvisioningService.dropDatabase(dbRow.db_name, dbRow.db_user);

    // Delete the platform metadata row AFTER MySQL cleanup
    await db.execute('DELETE FROM `databases` WHERE id = ?', [databaseId]);

    return res.status(200).json({
      success: true,
      data: {
        message: 'DATABASE_DELETED',
        databaseId,
      },
    });
  } catch (err) {
    console.error('deleteDatabase error:', err);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  }
}
module.exports = {
  createDatabase,
  listDatabases,
  getPhpMyAdminLink,
  deleteDatabase,
};
