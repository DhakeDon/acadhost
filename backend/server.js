'use strict';

// ============================================================
// Load environment variables first — before any other import
// ============================================================
require('dotenv').config();

const fs  = require('fs');
const url = require('url');

// ============================================================
// Section 3.6 — Environment Variable Validation
// Server refuses to start if any required variable is missing
// or fails its validation rule.
// ============================================================
function validateEnv() {
  const errors = [];

  // ---- Helpers -------------------------------------------------------

  function isNonEmpty(val) {
    return typeof val === 'string' && val.trim().length > 0;
  }

  function isPositiveInteger(val) {
    const n = Number(val);
    return Number.isInteger(n) && n > 0;
  }

  function isPositiveNumber(val) {
    const n = Number(val);
    return !isNaN(n) && n > 0;
  }

  function isValidUrl(val) {
    if (!isNonEmpty(val)) return false;
    try {
      new url.URL(val);
      return true;
    } catch {
      return false;
    }
  }

  function isValidEmail(val) {
    return typeof val === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  }

  // Accepts formats used by ms/jsonwebtoken: 15m, 7d, 2h, 1y, 30s, etc.
  function isValidDurationString(val) {
    return typeof val === 'string' && /^\d+[smhdwy]$/.test(val);
  }

  function isIntegerInRange(val, min, max) {
    const n = Number(val);
    return Number.isInteger(n) && n >= min && n <= max;
  }

  function isValidDomain(val) {
    return typeof val === 'string' &&
      /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z]{2,})+$/.test(val);
  }

  // ---- 3.2.1 Server Configuration ------------------------------------

  if (!['development', 'production'].includes(process.env.NODE_ENV)) {
    errors.push('NODE_ENV must be "development" or "production"');
  }

  if (!isPositiveInteger(process.env.BACKEND_PORT)) {
    errors.push('BACKEND_PORT must be a positive integer');
  }

  if (!isNonEmpty(process.env.CORS_ORIGIN)) {
    errors.push('CORS_ORIGIN must be a non-empty string (URL or comma-separated URLs)');
  } else {
    const origins = process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
    for (const origin of origins) {
      if (!isValidUrl(origin)) {
        errors.push(`CORS_ORIGIN contains invalid URL: "${origin}"`);
      }
    }
  }

  // ---- 3.2.2 Database Configuration ----------------------------------

  if (!isNonEmpty(process.env.MYSQL_HOST)) {
    errors.push('MYSQL_HOST must be a non-empty string');
  }

  if (!isPositiveInteger(process.env.MYSQL_PORT)) {
    errors.push('MYSQL_PORT must be a positive integer');
  }

  if (!isNonEmpty(process.env.MYSQL_USER)) {
    errors.push('MYSQL_USER must be a non-empty string');
  }

  if (!isNonEmpty(process.env.MYSQL_PASSWORD)) {
    errors.push('MYSQL_PASSWORD must be a non-empty string');
  }

  if (!isNonEmpty(process.env.MYSQL_DATABASE)) {
    errors.push('MYSQL_DATABASE must be a non-empty string');
  }

  if (!isNonEmpty(process.env.MYSQL_ROOT_PASSWORD)) {
    errors.push('MYSQL_ROOT_PASSWORD must be a non-empty string');
  }

  // ---- 3.2.3 Authentication & Tokens ---------------------------------

  if (!isNonEmpty(process.env.JWT_ACCESS_SECRET)) {
    errors.push('JWT_ACCESS_SECRET must be a non-empty string');
  } else if (process.env.JWT_ACCESS_SECRET.length < 32) {
    errors.push('JWT_ACCESS_SECRET must be at least 32 characters');
  }

  if (!isNonEmpty(process.env.JWT_REFRESH_SECRET)) {
    errors.push('JWT_REFRESH_SECRET must be a non-empty string');
  } else if (process.env.JWT_REFRESH_SECRET.length < 32) {
    errors.push('JWT_REFRESH_SECRET must be at least 32 characters');
  }

  if (!isNonEmpty(process.env.JWT_INVITE_SECRET)) {
    errors.push('JWT_INVITE_SECRET must be a non-empty string');
  } else if (process.env.JWT_INVITE_SECRET.length < 32) {
    errors.push('JWT_INVITE_SECRET must be at least 32 characters');
  }

  if (!isValidDurationString(process.env.ACCESS_TOKEN_EXPIRY)) {
    errors.push('ACCESS_TOKEN_EXPIRY must be a valid duration string (e.g. 15m, 1h)');
  }

  if (!isValidDurationString(process.env.REFRESH_TOKEN_EXPIRY)) {
    errors.push('REFRESH_TOKEN_EXPIRY must be a valid duration string (e.g. 7d, 24h)');
  }

  if (!isValidDurationString(process.env.INVITE_TOKEN_EXPIRY)) {
    errors.push('INVITE_TOKEN_EXPIRY must be a valid duration string (e.g. 2h, 30m)');
  }

  if (!isPositiveInteger(process.env.PASSWORD_RESET_TOKEN_EXPIRY_HOURS)) {
    errors.push('PASSWORD_RESET_TOKEN_EXPIRY_HOURS must be a positive integer');
  }

  if (!isNonEmpty(process.env.DB_ENCRYPTION_KEY)) {
    errors.push('DB_ENCRYPTION_KEY must be a non-empty string');
  } else if (Buffer.byteLength(process.env.DB_ENCRYPTION_KEY, 'utf8') !== 32) {
    errors.push(
      `DB_ENCRYPTION_KEY must be exactly 32 bytes (256 bits) for AES-256; ` +
      `current byte length: ${Buffer.byteLength(process.env.DB_ENCRYPTION_KEY, 'utf8')}`
    );
  }

  // ---- 3.2.4 File Paths ----------------------------------------------

  if (!isNonEmpty(process.env.PROJECTS_BASE_DIR)) {
    errors.push('PROJECTS_BASE_DIR must be a non-empty string');
  } else {
    try {
      fs.mkdirSync(process.env.PROJECTS_BASE_DIR, { recursive: true });
    } catch (err) {
      errors.push(
        `PROJECTS_BASE_DIR "${process.env.PROJECTS_BASE_DIR}" cannot be created: ${err.message}`
      );
    }
  }

  if (!isNonEmpty(process.env.NGINX_CONF_DIR)) {
    errors.push('NGINX_CONF_DIR must be a non-empty string');
  } else {
    try {
      fs.mkdirSync(process.env.NGINX_CONF_DIR, { recursive: true });
    } catch (err) {
      errors.push(
        `NGINX_CONF_DIR "${process.env.NGINX_CONF_DIR}" cannot be created: ${err.message}`
      );
    }
  }

  if (!isNonEmpty(process.env.STUDENT_DASHBOARD_DIST)) {
    errors.push('STUDENT_DASHBOARD_DIST must be a non-empty string');
  } else if (!fs.existsSync(process.env.STUDENT_DASHBOARD_DIST)) {
    const msg =
      `STUDENT_DASHBOARD_DIST does not exist: "${process.env.STUDENT_DASHBOARD_DIST}". ` +
      `Run "npm run build:student" from the repo root.`;
    if (process.env.NODE_ENV === 'production') {
      errors.push(msg);
    } else {
      console.warn(`[ENV WARNING] ${msg}`);
    }
  }

  if (!isNonEmpty(process.env.ADMIN_DASHBOARD_DIST)) {
    errors.push('ADMIN_DASHBOARD_DIST must be a non-empty string');
  } else if (!fs.existsSync(process.env.ADMIN_DASHBOARD_DIST)) {
    const msg =
      `ADMIN_DASHBOARD_DIST does not exist: "${process.env.ADMIN_DASHBOARD_DIST}". ` +
      `Run "npm run build:admin" from the repo root.`;
    if (process.env.NODE_ENV === 'production') {
      errors.push(msg);
    } else {
      console.warn(`[ENV WARNING] ${msg}`);
    }
  }

  // ---- 3.2.5 Docker & Build Configuration ----------------------------

  const portStart = Number(process.env.CONTAINER_PORT_RANGE_START);
  const portEnd   = Number(process.env.CONTAINER_PORT_RANGE_END);

  if (!isPositiveInteger(process.env.CONTAINER_PORT_RANGE_START)) {
    errors.push('CONTAINER_PORT_RANGE_START must be a positive integer');
  }

  if (!isPositiveInteger(process.env.CONTAINER_PORT_RANGE_END)) {
    errors.push('CONTAINER_PORT_RANGE_END must be a positive integer');
  }

  if (
    isPositiveInteger(process.env.CONTAINER_PORT_RANGE_START) &&
    isPositiveInteger(process.env.CONTAINER_PORT_RANGE_END) &&
    portStart >= portEnd
  ) {
    errors.push(
      'CONTAINER_PORT_RANGE_START must be less than CONTAINER_PORT_RANGE_END'
    );
  }

  if (!isPositiveInteger(process.env.BUILD_TIMEOUT_MINUTES)) {
    errors.push('BUILD_TIMEOUT_MINUTES must be a positive integer');
  }

  if (!isPositiveInteger(process.env.MAX_CONCURRENT_BUILDS)) {
    errors.push('MAX_CONCURRENT_BUILDS must be a positive integer');
  }

  if (!isNonEmpty(process.env.DOCKER_SOCKET_PATH)) {
    errors.push('DOCKER_SOCKET_PATH must be a non-empty string');
  } else if (!fs.existsSync(process.env.DOCKER_SOCKET_PATH)) {
    // On Windows with Docker Desktop the socket is a named pipe — warn, do not fail.
    const msg =
      `DOCKER_SOCKET_PATH "${process.env.DOCKER_SOCKET_PATH}" does not exist. ` +
      `Ensure Docker Desktop is running. On Windows the socket may be a named pipe.`;
    if (process.env.NODE_ENV === 'production') {
      errors.push(msg);
    } else {
      console.warn(`[ENV WARNING] ${msg}`);
    }
  }

  if (!isPositiveInteger(process.env.CONTAINER_INTERNAL_PORT)) {
    errors.push('CONTAINER_INTERNAL_PORT must be a positive integer');
  }

  if (!isNonEmpty(process.env.NGINX_PROXY_HOST)) {
    errors.push('NGINX_PROXY_HOST must be a non-empty string');
  }

  // ---- 3.2.6 Nginx Configuration -------------------------------------

  if (!isNonEmpty(process.env.NGINX_RELOAD_CMD)) {
    errors.push('NGINX_RELOAD_CMD must be a non-empty string');
  }

  if (!isNonEmpty(process.env.NGINX_TEST_CMD)) {
    errors.push('NGINX_TEST_CMD must be a non-empty string');
  }

  // ---- 3.2.7 Email Configuration -------------------------------------

  if (!isNonEmpty(process.env.SMTP_HOST)) {
    errors.push('SMTP_HOST must be a non-empty string');
  }

  if (!isPositiveInteger(process.env.SMTP_PORT)) {
    errors.push('SMTP_PORT must be a positive integer');
  }

  if (!isNonEmpty(process.env.SMTP_USER)) {
    errors.push('SMTP_USER must be a non-empty string');
  }

  if (!isNonEmpty(process.env.SMTP_PASSWORD)) {
    errors.push('SMTP_PASSWORD must be a non-empty string');
  }

  if (!isNonEmpty(process.env.SMTP_FROM_NAME)) {
    errors.push('SMTP_FROM_NAME must be a non-empty string');
  }

  if (!isPositiveInteger(process.env.SMTP_DAILY_LIMIT)) {
    errors.push('SMTP_DAILY_LIMIT must be a positive integer');
  }

  // ---- 3.2.8 phpMyAdmin Configuration --------------------------------

  if (!isPositiveInteger(process.env.PHPMYADMIN_PORT)) {
    errors.push('PHPMYADMIN_PORT must be a positive integer');
  }

  if (
    !isNonEmpty(process.env.PHPMYADMIN_BASE_PATH) ||
    !process.env.PHPMYADMIN_BASE_PATH.startsWith('/')
  ) {
    errors.push('PHPMYADMIN_BASE_PATH must be a non-empty string starting with "/"');
  }

  if (!isValidUrl(process.env.PHPMYADMIN_URL)) {
    errors.push('PHPMYADMIN_URL must be a valid URL');
  }

  // ---- 3.2.9 Admin Account -------------------------------------------

  if (!isValidEmail(process.env.ADMIN_EMAIL)) {
    errors.push('ADMIN_EMAIL must be a valid email address');
  }

  if (!isNonEmpty(process.env.ADMIN_DEFAULT_PASSWORD)) {
    errors.push('ADMIN_DEFAULT_PASSWORD must be a non-empty string');
  } else if (process.env.ADMIN_DEFAULT_PASSWORD.length < 8) {
    errors.push('ADMIN_DEFAULT_PASSWORD must be at least 8 characters');
  }

  // ---- 3.2.10 Resource Defaults --------------------------------------

  if (!isPositiveNumber(process.env.DEFAULT_CPU_CORES)) {
    errors.push('DEFAULT_CPU_CORES must be a positive number');
  }

  if (!isPositiveInteger(process.env.DEFAULT_RAM_MB)) {
    errors.push('DEFAULT_RAM_MB must be a positive integer');
  }

  if (!isPositiveInteger(process.env.DEFAULT_STORAGE_MB)) {
    errors.push('DEFAULT_STORAGE_MB must be a positive integer');
  }

  if (!isPositiveInteger(process.env.DEFAULT_MAX_PROJECTS)) {
    errors.push('DEFAULT_MAX_PROJECTS must be a positive integer');
  }

  if (!isPositiveInteger(process.env.DEFAULT_MAX_DATABASES)) {
    errors.push('DEFAULT_MAX_DATABASES must be a positive integer');
  }

  if (!isIntegerInRange(process.env.STORAGE_WARNING_THRESHOLD_PERCENT, 1, 100)) {
    errors.push('STORAGE_WARNING_THRESHOLD_PERCENT must be an integer between 1 and 100');
  }

  // ---- 3.2.11 Application Settings -----------------------------------

  if (!isPositiveInteger(process.env.MAX_ZIP_UPLOAD_SIZE_MB)) {
    errors.push('MAX_ZIP_UPLOAD_SIZE_MB must be a positive integer');
  }

  if (!isPositiveInteger(process.env.BUILD_LOG_RETENTION_DAYS)) {
    errors.push('BUILD_LOG_RETENTION_DAYS must be a positive integer');
  }

  if (!isNonEmpty(process.env.PLATFORM_DOMAIN) || !isValidDomain(process.env.PLATFORM_DOMAIN)) {
    errors.push('PLATFORM_DOMAIN must be a valid domain name (e.g. acadhost.com)');
  }

  if (!isValidUrl(process.env.PLATFORM_URL)) {
    errors.push('PLATFORM_URL must be a valid URL');
  }

  if (!isValidUrl(process.env.FRONTEND_URL)) {
    errors.push('FRONTEND_URL must be a valid URL');
  }

  // ---- Report --------------------------------------------------------

  if (errors.length > 0) {
    console.error('\n[FATAL] Environment variable validation failed. Server cannot start.\n');
    errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
    console.error('\nFix the above errors in your .env file and restart.\n');
    process.exit(1);
  }

  console.log('[ENV] All environment variables validated successfully.');
}

// Run validation immediately — before any other module is loaded.
validateEnv();

// ============================================================
// Module imports (after env is validated)
// ============================================================
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const nodemailer   = require('nodemailer');

const authRoutes            = require('./routes/auth');
const studentRoutes         = require('./routes/student');
const adminRoutes           = require('./routes/admin');
const projectRoutes         = require('./routes/projects');
const databaseRoutes        = require('./routes/databases');
const resourceRequestRoutes = require('./routes/resourceRequests');
const webhookRoutes         = require('./routes/webhooks');

// ============================================================
// Express application
// ============================================================
const app = express();

// ---- Security headers ------------------------------------------------------
// Disable contentSecurityPolicy — React SPAs manage their own CSP.
// Disable crossOriginEmbedderPolicy — required by some frontend tooling.
app.use(
  helmet({
    contentSecurityPolicy:     false,
    crossOriginEmbedderPolicy: false,
  })
);

// ---- CORS ------------------------------------------------------------------
// CORS_ORIGIN may be a comma-separated list of allowed origins.
const allowedOrigins = process.env.CORS_ORIGIN
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no origin (same-origin, curl, server-to-server).
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin "${origin}" is not allowed`));
    },
    credentials: true,  // Required for httpOnly SameSite=Strict refresh token cookie
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ---- Request logging -------------------------------------------------------
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ---- Body parsers ----------------------------------------------------------
// The `verify` callback captures the raw body buffer on every request and
// attaches it as req.rawBody. This is required by the GitHub webhook handler
// (routes/webhooks.js) to compute HMAC-SHA256 over the exact bytes GitHub
// signed — Section 12.6.1. Without req.rawBody the signature comparison is
// impossible and every webhook delivery would fail validation.
app.use(
  express.json({
    limit: '10mb',
    verify(req, _res, buf) {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---- Cookie parser ---------------------------------------------------------
// Required to read req.cookies.refreshToken (httpOnly, SameSite=Strict cookie).
app.use(cookieParser());

// ---- Global rate limiter ---------------------------------------------------
// Applied to all /api routes. Individual sensitive endpoints (e.g. login) may
// have tighter per-route limiters defined in their route files.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15-minute window
  max: 500,                   // max 500 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'TOO_MANY_REQUESTS',
    message: 'Too many requests from this IP. Please try again later.',
  },
});

app.use('/api', globalLimiter);

// ============================================================
// Route mounting
// ============================================================
app.use('/api/auth',              authRoutes);
app.use('/api/student',           studentRoutes);
app.use('/api/admin',             adminRoutes);
app.use('/api/projects',          projectRoutes);
app.use('/api/databases',         databaseRoutes);
app.use('/api/resource-requests', resourceRequestRoutes);
app.use('/api/webhooks',          webhookRoutes);

// ---- Health check (unauthenticated) ----------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', env: process.env.NODE_ENV } });
});

// ---- 404 for unmatched /api/* routes ---------------------------------------
app.use('/api/*', (_req, res) => {
  res.status(404).json({
    success: false,
    error: 'NOT_FOUND',
    message: 'API endpoint not found',
  });
});

// ============================================================
// Global error handler
// ============================================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({
      success: false,
      error: 'CORS_ERROR',
      message: err.message,
    });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: 'INVALID_JSON',
      message: 'Request body contains invalid JSON',
    });
  }

  console.error('[UNHANDLED ERROR]', err);

  return res.status(err.status || 500).json({
    success: false,
    error: err.code || 'INTERNAL_SERVER_ERROR',
    message:
      process.env.NODE_ENV === 'development'
        ? err.message
        : 'An unexpected error occurred',
  });
});

// ============================================================
// SMTP connection verification (Section 11.2.1)
// Non-blocking — email is a notification mechanism, not a hard
// server dependency. Failure logs a warning and continues.
// ============================================================
async function verifySmtp() {
  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT, 10),
    secure: false,  // port 587 uses STARTTLS — not implicit TLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  try {
    await transporter.verify();
    console.log('[SMTP] Connection verified successfully.');
  } catch (err) {
    console.warn(`[SMTP WARNING] Could not verify SMTP connection: ${err.message}`);
    console.warn('[SMTP WARNING] Email sending may fail. Check SMTP_* environment variables.');
  }
}

// ============================================================
// Database connection test (blocking)
// If the platform cannot reach MySQL it cannot serve any request,
// so a failed connection causes process.exit(1).
// ============================================================
async function testDatabaseConnection() {
  const db = require('./config/db');
  try {
    await db.query('SELECT 1');
    console.log('[DB] MySQL connection pool verified successfully.');
  } catch (err) {
    console.error(`[DB FATAL] Cannot connect to MySQL: ${err.message}`);
    console.error(
      '[DB FATAL] Check MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.'
    );
    process.exit(1);
  }
}

// ============================================================
// Nginx config sync on startup (Section 8.6.1)
// Ensures per-project .conf files are in sync with the database.
// Non-blocking — if nginxService is not yet available (early dev)
// a warning is logged and startup continues.
// ============================================================
async function syncNginxConfigs() {
  try {
    const nginxService = require('./services/nginxService');
    await nginxService.initializeOnStartup();
    console.log('[NGINX] Configuration sync completed.');
  } catch (err) {
    console.warn(`[NGINX WARNING] Could not sync Nginx configs: ${err.message}`);
  }
}

// ============================================================
// Startup sequence
// ============================================================
async function startup() {
  const PORT = parseInt(process.env.BACKEND_PORT, 10);

  // 1. Database — blocking; server cannot function without it.
  await testDatabaseConnection();

  // 2. SMTP — non-blocking warning on failure.
  await verifySmtp();

  // 3. Nginx config sync — non-blocking warning on failure.
  await syncNginxConfigs();

  // 4. Begin accepting requests.
  app.listen(PORT, () => {
    console.log(`\n[SERVER] AcadHost backend running on port ${PORT} (${process.env.NODE_ENV})`);
    console.log(`[SERVER] Platform domain : ${process.env.PLATFORM_DOMAIN}`);
    console.log(`[SERVER] Projects base   : ${process.env.PROJECTS_BASE_DIR}`);
    console.log(`[SERVER] Nginx conf dir  : ${process.env.NGINX_CONF_DIR}\n`);
  });
}

startup().catch(err => {
  console.error('[STARTUP FATAL]', err);
  process.exit(1);
});

module.exports = app;  // exported for testing
