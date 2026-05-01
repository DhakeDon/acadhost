'use strict';

// ============================================================
// Project Model — models/Project.js
// Section 4.2.2 — projects table
//
// Thin query-helper using the shared pool from config/db.js.
// No ORM — raw SQL only.
// ============================================================

const pool = require('../config/db');

const Project = {

  // ── Single-row lookups ──────────────────────────────────────

  async findById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM projects WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  },

  /**
   * Finds a project by id scoped to a specific owner.
   * Used for student-facing endpoints to prevent cross-student access.
   */
  async findByIdAndUserId(id, userId) {
    const [rows] = await pool.query(
      'SELECT * FROM projects WHERE id = ? AND user_id = ? LIMIT 1',
      [id, userId]
    );
    return rows[0] || null;
  },

  async findBySubdomain(subdomain) {
    const [rows] = await pool.query(
      "SELECT id FROM projects WHERE subdomain = ? AND status != 'deleted' LIMIT 1",
      [subdomain]
    );
    return rows[0] || null;
  },

  // ── Creation ────────────────────────────────────────────────

  async create(data) {
    const [result] = await pool.query(
      `INSERT INTO projects
         (user_id, title, subdomain, project_type, runtime, runtime_version,
          source_type, git_url, git_url_backend,
          webhook_secret, webhook_secret_backend,
          container_id, container_port,
          cpu_limit, ram_limit_mb, database_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.user_id,
        data.title,
        data.subdomain,
        data.project_type,
        data.runtime              ?? null,
        data.runtime_version      ?? null,
        data.source_type,
        data.git_url              ?? null,
        data.git_url_backend      ?? null,
        data.webhook_secret       ?? null,
        data.webhook_secret_backend ?? null,
        data.container_id         ?? null,
        data.container_port       ?? null,
        data.cpu_limit,
        data.ram_limit_mb,
        data.database_id          ?? null,
        data.status               ?? 'building',
      ]
    );
    return result.insertId;
  },

  // ── Partial update ──────────────────────────────────────────

  async updateById(id, fields) {
    const allowed = [
      'title', 'subdomain', 'project_type', 'runtime', 'runtime_version',
      'source_type', 'git_url', 'git_url_backend',
      'webhook_secret', 'webhook_secret_backend',
      'container_id', 'container_port',
      'cpu_limit', 'ram_limit_mb', 'database_id', 'status',
    ];
    const keys = Object.keys(fields).filter(k => allowed.includes(k));
    if (keys.length === 0) return 0;

    const setClauses = keys.map(k => `\`${k}\` = ?`).join(', ');
    const values     = keys.map(k => fields[k]);
    values.push(id);

    const [result] = await pool.query(
      `UPDATE projects SET ${setClauses} WHERE id = ?`,
      values
    );
    return result.affectedRows;
  },

  // ── Deletion ────────────────────────────────────────────────

  async deleteById(id) {
    const [result] = await pool.query('DELETE FROM projects WHERE id = ?', [id]);
    return result.affectedRows;
  },

  // ── Student: list own projects (non-deleted) ─────────────────

  async findAllByUserId(userId) {
    const [rows] = await pool.query(
      `SELECT p.*,
              d.db_name AS database_name
       FROM projects p
       LEFT JOIN databases d ON d.id = p.database_id
       WHERE p.user_id = ? AND p.status != 'deleted'
       ORDER BY p.created_at DESC`,
      [userId]
    );
    return rows;
  },

  // ── Student: resource usage (for quota checks) ──────────────

  async getUsedResourcesByUserId(userId) {
    const [[row]] = await pool.query(
      `SELECT
         COALESCE(SUM(cpu_limit),    0) AS cpu_used,
         COALESCE(SUM(ram_limit_mb), 0) AS ram_used_mb,
         COUNT(*)                        AS project_count
       FROM projects
       WHERE user_id = ? AND status != 'deleted'`,
      [userId]
    );
    return {
      cpuUsed:      parseFloat(row.cpu_used),
      ramUsedMb:    row.ram_used_mb,
      projectCount: row.project_count,
    };
  },

  // ── Admin: paginated project list ───────────────────────────

  async findAll({ page = 1, limit = 20, status, studentId, search } = {}) {
    const offset = (page - 1) * limit;
    const params = [];
    const where  = [];

    if (status) {
      where.push('p.status = ?');
      params.push(status);
    } else {
      where.push("p.status != 'deleted'");
    }

    if (studentId) {
      where.push('p.user_id = ?');
      params.push(studentId);
    }

    if (search) {
      where.push('(p.title LIKE ? OR p.subdomain LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like);
    }

    const whereSQL = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM projects p ${whereSQL}`,
      params
    );
    const total = countRows[0].total;

    const listParams = [...params, limit, offset];
    const [items] = await pool.query(
      `SELECT
         p.id, p.title, p.subdomain, p.project_type,
         p.runtime, p.runtime_version, p.source_type,
         p.container_port, p.cpu_limit, p.ram_limit_mb,
         p.status, p.created_at, p.updated_at,
         u.id AS student_id, u.email AS student_email, u.name AS student_name
       FROM projects p
       INNER JOIN users u ON u.id = p.user_id
       ${whereSQL}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      listParams
    );

    return { items, total };
  },

  // ── Admin: all non-deleted projects for a student (cleanup) ─

  async findAllByUserIdForCleanup(userId) {
    const [rows] = await pool.query(
      `SELECT id, container_id, container_port, subdomain, status
       FROM projects
       WHERE user_id = ? AND status != 'deleted'`,
      [userId]
    );
    return rows;
  },

  // ── Port allocation: find next free port in range ───────────

  async getUsedPorts() {
    const [rows] = await pool.query(
      'SELECT container_port FROM projects WHERE container_port IS NOT NULL'
    );
    return rows.map(r => r.container_port);
  },
};

module.exports = Project;
