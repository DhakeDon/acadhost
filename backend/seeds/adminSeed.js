'use strict';

// ============================================================
// Admin Seed — seeds/adminSeed.js
// Section 5.8 — Admin Seed
//
// Creates the single fixed admin account on first deployment.
// Idempotent: running again does not create duplicate accounts.
//
// Required environment variables:
//   ADMIN_EMAIL            — admin account email address
//   ADMIN_DEFAULT_PASSWORD — initial admin password (bcrypt-hashed before storage)
//   DEFAULT_CPU_CORES      — default cpu_quota  (default: 2.00)
//   DEFAULT_RAM_MB         — default ram_quota_mb (default: 1024)
//   DEFAULT_STORAGE_MB     — default storage_quota_mb (default: 2560)
//   DEFAULT_MAX_PROJECTS   — default max_projects (default: 4)
//   DEFAULT_MAX_DATABASES  — default max_databases (default: 4)
// ============================================================

require('dotenv').config();

const bcrypt = require('bcryptjs');
const pool   = require('../config/db');

const SALT_ROUNDS = 12;

async function seedAdmin() {
  const email           = process.env.ADMIN_EMAIL;
  const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD;

  if (!email || !defaultPassword) {
    console.error('[adminSeed] ADMIN_EMAIL and ADMIN_DEFAULT_PASSWORD must be set in environment variables.');
    process.exit(1);
  }

  const conn = await pool.getConnection();

  try {
    // Check if the admin account already exists (idempotency guard)
    const [rows] = await conn.query(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    if (rows.length > 0) {
      console.log(`[adminSeed] Admin account already exists for ${email}. No changes made.`);
      return;
    }

    const passwordHash = await bcrypt.hash(defaultPassword, SALT_ROUNDS);

    await conn.query(
      `INSERT INTO users
         (email, password_hash, name, role, batch_year, dark_mode,
          cpu_quota, ram_quota_mb, storage_quota_mb,
          max_projects, max_databases,
          must_change_password, status)
       VALUES (?, ?, 'Admin', 'admin', NULL, 0, ?, ?, ?, ?, ?, 1, 'active')`,
      [
        email,
        passwordHash,
        parseFloat(process.env.DEFAULT_CPU_CORES)   || 2.00,
        parseInt(process.env.DEFAULT_RAM_MB, 10)     || 1024,
        parseInt(process.env.DEFAULT_STORAGE_MB, 10) || 2560,
        parseInt(process.env.DEFAULT_MAX_PROJECTS, 10) || 4,
        parseInt(process.env.DEFAULT_MAX_DATABASES, 10) || 4,
      ]
    );

    console.log(`[adminSeed] Admin account created successfully for ${email}.`);
    console.log('[adminSeed] must_change_password = 1  — admin must set a new password on first login.');
  } finally {
    conn.release();
  }
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[adminSeed] Fatal error:', err);
    process.exit(1);
  });
