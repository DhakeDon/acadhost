'use strict';

// ============================================================
// Quota Checker — utils/quotaChecker.js
// Section 10.5
//
// Validates resource availability before resource-consuming
// operations are allowed to proceed.  All functions are async
// (they query the database).
//
// Thrown error shape: { code, message, httpStatus }
// Callers can pass these directly to res.status(e.httpStatus).json(...)
// ============================================================

const pool = require('../config/db');

const storageService = require('../services/storageService');

// ── checkProjectQuota ────────────────────────────────────────

/**
 * Validates that the student has not reached their max_projects quota.
 *
 * @param {number} userId
 * @throws {{ code: 'PROJECT_QUOTA_EXCEEDED', message: string, httpStatus: 400 }}
 */
async function checkProjectQuota(userId) {
  const [[countRow]] = await pool.query(
    "SELECT COUNT(*) AS current_count FROM projects WHERE user_id = ? AND status != 'deleted'",
    [userId]
  );
  const [[userRow]] = await pool.query(
    'SELECT max_projects FROM users WHERE id = ? LIMIT 1',
    [userId]
  );

  const currentCount = countRow.current_count;
  const maxProjects  = userRow.max_projects;

  if (currentCount >= maxProjects) {
    throw {
      code: 'PROJECT_QUOTA_EXCEEDED',
      message: `Project limit reached (${currentCount}/${maxProjects})`,
      httpStatus: 400,
    };
  }
}

// ── checkDatabaseQuota ───────────────────────────────────────

/**
 * Validates that the student has not reached their max_databases quota.
 *
 * @param {number} userId
 * @throws {{ code: 'DATABASE_QUOTA_EXCEEDED', message: string, httpStatus: 400 }}
 */
async function checkDatabaseQuota(userId) {
  const [[countRow]] = await pool.query(
      // ✅ FIX: backticks around reserved word `databases`
      'SELECT COUNT(*) AS current_count FROM `databases` WHERE user_id = ?',
      [userId]
  );
  const [[userRow]] = await pool.query(
      'SELECT max_databases FROM users WHERE id = ? LIMIT 1',
      [userId]
  );

  const currentCount = countRow.current_count;
  const maxDatabases = userRow.max_databases;

  if (currentCount >= maxDatabases) {
    throw {
      code: 'DATABASE_QUOTA_EXCEEDED',
      message: `Database limit reached (${currentCount}/${maxDatabases})`,
      httpStatus: 400,
    };
  }
}
// ── checkCpuQuota ────────────────────────────────────────────

/**
 * Validates that the requested CPU allocation does not exceed the
 * student's remaining CPU quota.
 *
 * @param {number} userId
 * @param {number} requestedCpu   — decimal cores being requested
 * @param {number|null} excludeProjectId — exclude this project's existing
 *   cpu_limit from the "in use" calculation (used for resource updates)
 * @throws {{ code: 'CPU_QUOTA_EXCEEDED', message: string, httpStatus: 400 }}
 */
async function checkCpuQuota(userId, requestedCpu, excludeProjectId = null) {
  let sql    = "SELECT COALESCE(SUM(cpu_limit), 0) AS cpu_used FROM projects WHERE user_id = ? AND status != 'deleted'";
  const params = [userId];

  if (excludeProjectId !== null) {
    sql += ' AND id != ?';
    params.push(excludeProjectId);
  }

  const [[usageRow]] = await pool.query(sql, params);
  const [[userRow]]  = await pool.query(
    'SELECT cpu_quota FROM users WHERE id = ? LIMIT 1',
    [userId]
  );

  const cpuUsed  = parseFloat(usageRow.cpu_used) || 0;
  const cpuQuota = parseFloat(userRow.cpu_quota);
  const available = cpuQuota - cpuUsed;

  if (requestedCpu > available) {
    throw {
      code: 'CPU_QUOTA_EXCEEDED',
      message: `CPU limit exceeds available quota (${available} cores remaining)`,
      httpStatus: 400,
    };
  }
}

// ── checkRamQuota ────────────────────────────────────────────

/**
 * Validates that the requested RAM allocation does not exceed the
 * student's remaining RAM quota.
 *
 * @param {number} userId
 * @param {number} requestedRam   — MB being requested
 * @param {number|null} excludeProjectId — exclude this project's existing
 *   ram_limit_mb from the "in use" calculation (used for resource updates)
 * @throws {{ code: 'RAM_QUOTA_EXCEEDED', message: string, httpStatus: 400 }}
 */
async function checkRamQuota(userId, requestedRam, excludeProjectId = null) {
  let sql    = "SELECT COALESCE(SUM(ram_limit_mb), 0) AS ram_used FROM projects WHERE user_id = ? AND status != 'deleted'";
  const params = [userId];

  if (excludeProjectId !== null) {
    sql += ' AND id != ?';
    params.push(excludeProjectId);
  }

  const [[usageRow]] = await pool.query(sql, params);
  const [[userRow]]  = await pool.query(
    'SELECT ram_quota_mb FROM users WHERE id = ? LIMIT 1',
    [userId]
  );

  const ramUsed  = parseInt(usageRow.ram_used, 10) || 0;
  const ramQuota = parseInt(userRow.ram_quota_mb, 10);
  const available = ramQuota - ramUsed;

  if (requestedRam > available) {
    throw {
      code: 'RAM_QUOTA_EXCEEDED',
      message: `RAM limit exceeds available quota (${available} MB remaining)`,
      httpStatus: 400,
    };
  }
}

// ── getResourceUsageSummary ──────────────────────────────────

/**
 * Returns the complete resource usage summary for a student.
 * Used by GET /api/student/profile and admin student list.
 *
 * @param {number} userId
 * @returns {Promise<Object>}
 */
async function getResourceUsageSummary(userId) {
  const [[usageRow]] = await pool.query(
      `SELECT
       COALESCE(SUM(cpu_limit),    0) AS cpu_used,
       COALESCE(SUM(ram_limit_mb), 0) AS ram_used,
       COUNT(*)                        AS project_count
     FROM projects
     WHERE user_id = ? AND status != 'deleted'`,
      [userId]
  );

  // ✅ FIX: backticks around reserved word `databases`
  const [[dbCountRow]] = await pool.query(
      'SELECT COUNT(*) AS database_count FROM `databases` WHERE user_id = ?',
      [userId]
  );

  const [[userRow]] = await pool.query(
      'SELECT cpu_quota, ram_quota_mb, storage_quota_mb, max_projects, max_databases FROM users WHERE id = ? LIMIT 1',
      [userId]
  );

  const storageUsedMb = await storageService.calculateStudentStorageUsage(userId);

  const cpuUsed      = parseFloat(usageRow.cpu_used) || 0;
  const ramUsedMb    = parseInt(usageRow.ram_used, 10) || 0;
  const projectCount = usageRow.project_count;
  const databaseCount = dbCountRow.database_count;

  const storageQuotaMb               = parseInt(userRow.storage_quota_mb, 10);
  const storageWarningThresholdPercent =
      parseFloat(process.env.STORAGE_WARNING_THRESHOLD_PERCENT) || 80;
  const storageWarning = storageQuotaMb > 0
      ? (storageUsedMb / storageQuotaMb * 100) >= storageWarningThresholdPercent
      : false;

  return {
    cpuUsed,
    ramUsedMb,
    storageUsedMb,
    projectCount,
    databaseCount,
    cpuQuota:     parseFloat(userRow.cpu_quota),
    ramQuotaMb:   parseInt(userRow.ram_quota_mb, 10),
    storageQuotaMb,
    maxProjects:  userRow.max_projects,
    maxDatabases: userRow.max_databases,
    storageWarning,
  };
}
module.exports = {
  checkProjectQuota,
  checkDatabaseQuota,
  checkCpuQuota,
  checkRamQuota,
  getResourceUsageSummary,
};
