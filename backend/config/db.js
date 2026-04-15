'use strict';

// ============================================================
// MySQL Connection Pool — Platform Database
//
// Connects to the platform's own database (MYSQL_DATABASE) using
// the MYSQL_USER / MYSQL_PASSWORD credentials defined in Section 3.2.2.
//
// Used by all controllers and services for platform metadata:
//   users, projects, databases, resource_requests, refresh_tokens,
//   invite_tokens, builds, password_reset_tokens.
//
// DISTINCT from the root connection created per-call by
// databaseProvisioningService.js (Section 9.2.1), which uses
// MYSQL_ROOT_PASSWORD for CREATE DATABASE / CREATE USER operations.
//
// Environment variables read:
//   MYSQL_HOST     — hostname (docker-compose: "mysql" service name)
//   MYSQL_PORT     — port (default 3306)
//   MYSQL_USER     — platform database user
//   MYSQL_PASSWORD — platform database password
//   MYSQL_DATABASE — platform database schema name
// ============================================================

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.MYSQL_HOST,
  port:     parseInt(process.env.MYSQL_PORT, 10),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,

  // Character set — matches schema definition (Section 4.2.x)
  charset: 'utf8mb4',

  // Connection pool settings
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,

  // Return DATE/DATETIME columns as strings to avoid timezone conversion.
  dateStrings: true,

  // Keep idle connections alive to avoid "connection lost" errors on long gaps.
  enableKeepAlive:        true,
  keepAliveInitialDelay:  0,
});

module.exports = pool;
