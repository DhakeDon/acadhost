'use strict';

// ============================================================
// ResourceRequest Model — models/ResourceRequest.js
// Section 4.2.4 — resource_requests table
//
// Student requests for resource quota increases, reviewed by admin.
//
// Thin query-helper using the shared pool from config/db.js.
// No ORM — raw SQL only.
// ============================================================

const pool = require('../config/db');

const ResourceRequest = {

  // ── Single-row lookups ──────────────────────────────────────

  async findById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM resource_requests WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  },

  // ── Creation ────────────────────────────────────────────────

  async create(data) {
    const [result] = await pool.query(
      `INSERT INTO resource_requests
         (user_id, resource_type, requested_value, description, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [
        data.user_id,
        data.resource_type,
        data.requested_value,
        data.description,
      ]
    );
    return result.insertId;
  },

  // ── Partial update (admin review) ──────────────────────────

  async updateById(id, fields) {
    const allowed = ['status', 'admin_notes', 'reviewed_at'];
    const keys    = Object.keys(fields).filter(k => allowed.includes(k));
    if (keys.length === 0) return 0;

    const setClauses = keys.map(k => `\`${k}\` = ?`).join(', ');
    const values     = keys.map(k => fields[k]);
    values.push(id);

    const [result] = await pool.query(
      `UPDATE resource_requests SET ${setClauses} WHERE id = ?`,
      values
    );
    return result.affectedRows;
  },

  // ── Student: list own requests ──────────────────────────────

  async findAllByUserId(userId) {
    const [rows] = await pool.query(
      `SELECT * FROM resource_requests
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },

  // ── Admin: paginated request list ───────────────────────────

  async findAll({ page = 1, limit = 20, status } = {}) {
    const offset = (page - 1) * limit;
    const params = [];
    const where  = [];

    if (status) {
      where.push('rr.status = ?');
      params.push(status);
    }

    const whereSQL = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM resource_requests rr ${whereSQL}`,
      params
    );
    const total = countRows[0].total;

    const listParams = [...params, limit, offset];
    const [items] = await pool.query(
      `SELECT
         rr.*,
         u.email AS student_email,
         u.name  AS student_name
       FROM resource_requests rr
       INNER JOIN users u ON u.id = rr.user_id
       ${whereSQL}
       ORDER BY rr.created_at DESC
       LIMIT ? OFFSET ?`,
      listParams
    );

    return { items, total };
  },

  // ── Metrics helper ───────────────────────────────────────────

  async countPending() {
    const [[row]] = await pool.query(
      "SELECT COUNT(*) AS total FROM resource_requests WHERE status = 'pending'"
    );
    return row.total;
  },
};

module.exports = ResourceRequest;
