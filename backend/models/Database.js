'use strict';

// ============================================================
// Database Model — models/Database.js
// Section 4.2.3 — databases table
//
// Stores metadata for student-provisioned MySQL databases.
// Passwords are stored AES-256-CBC encrypted (Section 5.11).
//
// Thin query-helper using the shared pool from config/db.js.
// No ORM — raw SQL only.
// ============================================================

const pool = require('../config/db');

const Database = {

  // ── Single-row lookups ──────────────────────────────────────

  async findById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM `databases` WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  },

  /**
   * Finds a database by id scoped to a specific owner.
   * Used for student-facing endpoints to prevent cross-student access.
   */
  async findByIdAndUserId(id, userId) {
    const [rows] = await pool.query(
      'SELECT * FROM `databases` WHERE id = ? AND user_id = ? LIMIT 1',
      [id, userId]
    );
    return rows[0] || null;
  },

  async findByDbUser(dbUser) {
    const [rows] = await pool.query(
      'SELECT * FROM `databases` WHERE db_user = ? LIMIT 1',
      [dbUser]
    );
    return rows[0] || null;
  },

  // ── Creation ────────────────────────────────────────────────

  async create(data) {
    const [result] = await pool.query(
      `INSERT INTO \`databases\`
         (user_id, db_name, db_user, db_password_encrypted)
       VALUES (?, ?, ?, ?)`,
      [
        data.user_id,
        data.db_name,
        data.db_user,
        data.db_password_encrypted,
      ]
    );
    return result.insertId;
  },

  // ── Deletion ────────────────────────────────────────────────

  async deleteById(id) {
    const [result] = await pool.query('DELETE FROM `databases` WHERE id = ?', [id]);
    return result.affectedRows;
  },

  // ── Student: list own databases ─────────────────────────────

  async findAllByUserId(userId) {
    const [rows] = await pool.query(
      `SELECT id, user_id, db_name, db_user, created_at
       FROM \`databases\`
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },

  // ── Count ───────────────────────────────────────────────────

  async countByUserId(userId) {
    const [[row]] = await pool.query(
      'SELECT COUNT(*) AS total FROM `databases` WHERE user_id = ?',
      [userId]
    );
    return row.total;
  },

  // ── Admin: all databases for a student (cleanup) ─────────────

  async findAllByUserIdForCleanup(userId) {
    const [rows] = await pool.query(
      'SELECT id, db_name, db_user FROM `databases` WHERE user_id = ?',
      [userId]
    );
    return rows;
  },
};

module.exports = Database;
