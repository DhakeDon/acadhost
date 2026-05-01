'use strict';

// ============================================================
// User Model — models/User.js
// Section 4.2.1 — users table
//
// Thin query-helper using the shared pool from config/db.js.
// No ORM — raw SQL only.
// ============================================================

const pool = require('../config/db');

const User = {

  // ── Single-row lookups ──────────────────────────────────────

  async findById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  },

  async findByEmail(email) {
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    return rows[0] || null;
  },

  // ── Creation ────────────────────────────────────────────────

  /**
   * Inserts a new user row.
   * @param {object} data — column values; all quota defaults come from env vars at call site
   */
  async create(data) {
    const [result] = await pool.query(
      `INSERT INTO users
         (email, password_hash, name, role, batch_year, dark_mode,
          cpu_quota, ram_quota_mb, storage_quota_mb,
          max_projects, max_databases,
          must_change_password, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.email,
        data.password_hash   ?? null,
        data.name            ?? null,
        data.role            ?? 'student',
        data.batch_year      ?? null,
        data.dark_mode       ?? 0,
        data.cpu_quota       ?? 2.00,
        data.ram_quota_mb    ?? 1024,
        data.storage_quota_mb ?? 2560,
        data.max_projects    ?? 4,
        data.max_databases   ?? 4,
        data.must_change_password ?? 0,
        data.status          ?? 'invited',
      ]
    );
    return result.insertId;
  },

  // ── Partial update ──────────────────────────────────────────

  /**
   * Updates specific columns for a user by id.
   * @param {number|string} id
   * @param {object} fields — only provided keys are updated
   */
  async updateById(id, fields) {
    const allowed = [
      'email', 'password_hash', 'name', 'role', 'batch_year', 'dark_mode',
      'cpu_quota', 'ram_quota_mb', 'storage_quota_mb',
      'max_projects', 'max_databases',
      'must_change_password', 'status',
    ];
    const keys   = Object.keys(fields).filter(k => allowed.includes(k));
    if (keys.length === 0) return 0;

    const setClauses = keys.map(k => `\`${k}\` = ?`).join(', ');
    const values     = keys.map(k => fields[k]);
    values.push(id);

    const [result] = await pool.query(
      `UPDATE users SET ${setClauses} WHERE id = ?`,
      values
    );
    return result.affectedRows;
  },

  // ── Deletion ────────────────────────────────────────────────

  async deleteById(id) {
    const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
    return result.affectedRows;
  },

  // ── Admin: paginated student list ───────────────────────────

  /**
   * Returns a paginated list of students with per-student resource usage.
   * @param {object} opts — { page, limit, status, batchYear, search }
   */
  async findStudents({ page = 1, limit = 20, status, batchYear, search } = {}) {
    const offset = (page - 1) * limit;
    const params = [];
    const where  = ["u.role = 'student'"];

    if (status) {
      where.push('u.status = ?');
      params.push(status);
    }
    if (batchYear) {
      where.push('u.batch_year = ?');
      params.push(batchYear);
    }
    if (search) {
      where.push('(u.name LIKE ? OR u.email LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like);
    }

    const whereSQL = where.join(' AND ');

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM users u WHERE ${whereSQL}`,
      params
    );
    const total = countRows[0].total;

    const listParams = [...params, limit, offset];
    const [items] = await pool.query(
      `SELECT
         u.id, u.email, u.name, u.role, u.batch_year, u.status,
         u.cpu_quota, u.ram_quota_mb, u.storage_quota_mb,
         u.max_projects, u.max_databases, u.created_at,
         COALESCE(p_cpu.cpu_used, 0)      AS cpu_used,
         COALESCE(p_ram.ram_used_mb, 0)   AS ram_used_mb,
         COALESCE(p_cnt.project_count, 0) AS project_count,
         COALESCE(d_cnt.database_count, 0) AS database_count
       FROM users u
       LEFT JOIN (
         SELECT user_id, SUM(cpu_limit)    AS cpu_used
         FROM projects WHERE status != 'deleted'
         GROUP BY user_id
       ) p_cpu ON p_cpu.user_id = u.id
       LEFT JOIN (
         SELECT user_id, SUM(ram_limit_mb) AS ram_used_mb
         FROM projects WHERE status != 'deleted'
         GROUP BY user_id
       ) p_ram ON p_ram.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS project_count
         FROM projects WHERE status != 'deleted'
         GROUP BY user_id
       ) p_cnt ON p_cnt.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS database_count
         FROM databases
         GROUP BY user_id
       ) d_cnt ON d_cnt.user_id = u.id
       WHERE ${whereSQL}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      listParams
    );

    return { items, total };
  },

  // ── Admin: batch-year student list (for batch removal) ─────

  async findStudentsByBatchYear(batchYear) {
    const [rows] = await pool.query(
      `SELECT id, email FROM users
       WHERE role = 'student' AND batch_year = ? AND status != 'removed'`,
      [batchYear]
    );
    return rows;
  },

  // ── Admin: system-wide metrics ──────────────────────────────

  async getMetrics() {
    const [[metrics]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM projects  WHERE status = 'running')                           AS total_live_projects,
         (SELECT COUNT(*) FROM users     WHERE role = 'student' AND status = 'active')       AS total_students,
         (SELECT COALESCE(SUM(cpu_limit),    0) FROM projects WHERE status = 'running')      AS aggregate_cpu_used,
         (SELECT COALESCE(SUM(ram_limit_mb), 0) FROM projects WHERE status = 'running')      AS aggregate_ram_used_mb,
         (SELECT COALESCE(SUM(cpu_quota),    0) FROM users WHERE role = 'student' AND status = 'active') AS total_cpu_allocated,
         (SELECT COALESCE(SUM(ram_quota_mb), 0) FROM users WHERE role = 'student' AND status = 'active') AS total_ram_allocated_mb,
         (SELECT COALESCE(SUM(storage_quota_mb), 0) FROM users WHERE role = 'student' AND status = 'active') AS total_storage_allocated_mb,
         (SELECT COUNT(*) FROM resource_requests WHERE status = 'pending')                   AS pending_resource_requests`
    );

    // aggregate_storage_used_mb cannot be derived from SQL — it requires a filesystem scan.
    // adminController.getMetrics() must call storageService.getAggregateStorageUsed() and
    // overwrite this field before returning the API response (Section 6.4.1).
    return {
      ...metrics,
      aggregate_storage_used_mb: null,
    };
  },

  // ── Student: resource usage summary ─────────────────────────

  async getResourceUsage(userId) {
    const [[usage]] = await pool.query(
      `SELECT
         COALESCE(SUM(cpu_limit),    0) AS cpu_used,
         COALESCE(SUM(ram_limit_mb), 0) AS ram_used_mb,
         COUNT(*)                        AS project_count
       FROM projects
       WHERE user_id = ? AND status != 'deleted'`,
      [userId]
    );

    const [[dbCount]] = await pool.query(
      'SELECT COUNT(*) AS database_count FROM databases WHERE user_id = ?',
      [userId]
    );

    return {
      cpuUsed:       parseFloat(usage.cpu_used),
      ramUsedMb:     usage.ram_used_mb,
      projectCount:  usage.project_count,
      databaseCount: dbCount.database_count,
    };
  },
};

module.exports = User;
