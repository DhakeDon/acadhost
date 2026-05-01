'use strict';

// ============================================================
// routes/projectRoutes.js
//
// All project-related API routes. Mirrors the full surface of
// projectController.js — including custom env var endpoints
// (listEnvVars, replaceEnvVars, updateEnvVar, deleteEnvVar,
// getInjectedEnv) that were previously missing from routing.
// ============================================================

const express = require('express');
const multer  = require('multer');

const projectController = require('../controllers/projectController');
const authMiddleware    = require('../middleware/auth'); // adjust path as needed

// ── Multer — memory storage; size enforced in controller ────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 200 * 1024 * 1024 }, // 200 MB hard cap
});

const zipUpload = upload.fields([
  { name: 'zipFile',         maxCount: 1 },
  { name: 'zipFileFrontend', maxCount: 1 },
  { name: 'zipFileBackend',  maxCount: 1 },
]);

const router = express.Router();

// ── All routes require authentication ────────────────────────────────────────
router.use(authMiddleware);

// ════════════════════════════════════════════════════════════════════════════
// PROJECT — CRUD
// ════════════════════════════════════════════════════════════════════════════

// POST   /api/projects            — create + trigger build
router.post('/', zipUpload, projectController.createProject);

// GET    /api/projects            — list student's projects
router.get('/', projectController.listProjects);

// GET    /api/projects/check-subdomain?name=...
//   IMPORTANT: this MUST come before /:id so Express doesn't interpret
//   "check-subdomain" as an :id param.
router.get('/check-subdomain', projectController.checkSubdomainAvailability);

// GET    /api/projects/:id
router.get('/:id', projectController.getProject);

// DELETE /api/projects/:id
router.delete('/:id', projectController.deleteProject);


// ════════════════════════════════════════════════════════════════════════════
// PROJECT — LIFECYCLE OPERATIONS
// ════════════════════════════════════════════════════════════════════════════

// POST /api/projects/:id/restart
router.post('/:id/restart', projectController.restartProject);

// POST /api/projects/:id/stop
router.post('/:id/stop', projectController.stopProject);

// POST /api/projects/:id/recover   — auto-fix health issues
router.post('/:id/recover', projectController.recoverProject);


// ════════════════════════════════════════════════════════════════════════════
// PROJECT — CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

// PUT  /api/projects/:id/database   — attach / detach a database
router.put('/:id/database', projectController.switchDatabase);

// PUT  /api/projects/:id/resources  — update CPU + RAM limits
router.put('/:id/resources', projectController.updateResources);


// ════════════════════════════════════════════════════════════════════════════
// PROJECT — MONITORING
// ════════════════════════════════════════════════════════════════════════════

// GET /api/projects/:id/stats       — live CPU / RAM / net (4 s poll)
router.get('/:id/stats', projectController.getStats);

// GET /api/projects/:id/logs        — tail runtime container logs
router.get('/:id/logs', projectController.getLogs);

// GET /api/projects/:id/storage     — storage breakdown
router.get('/:id/storage', projectController.getStorageUsage);

// GET /api/projects/:id/health      — docker vs DB state comparison
router.get('/:id/health', projectController.getProjectHealth);


// ════════════════════════════════════════════════════════════════════════════
// PROJECT — BUILD LOGS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/projects/:id/build-logs          — latest build log file
router.get('/:id/build-logs', projectController.getBuildLogs);

// GET /api/projects/:id/build-logs/stream   — SSE stream while building
//   IMPORTANT: must be registered BEFORE /:id/build-logs if Express is
//   doing prefix matching, but with exact paths it doesn't matter.
router.get('/:id/build-logs/stream', projectController.streamBuildLogs);


// ════════════════════════════════════════════════════════════════════════════
// PROJECT — GITHUB WEBHOOK INFO
// ════════════════════════════════════════════════════════════════════════════

// GET /api/projects/:id/webhook
//   Returns payload URL(s) + secret(s) for git-based projects.
//   Returns 400 WEBHOOK_NOT_APPLICABLE for zip-based projects.
router.get('/:id/webhook', projectController.getWebhookInfo);


// ════════════════════════════════════════════════════════════════════════════
// PROJECT — CUSTOM ENVIRONMENT VARIABLES
//
// All four endpoints operate on the project_env_vars table via
// projectEnvVarService (AES-256-GCM encryption at rest).
//
// The POST (bulk-replace) endpoint is the primary UI path:
//   — saves the full set, then recreates the container if running so
//     changes take effect immediately without a redeploy.
//
// PUT + DELETE single-row endpoints are available for programmatic /
// admin use; they flag appliedOnNextDeploy=true (no auto-restart).
// ════════════════════════════════════════════════════════════════════════════

// GET    /api/projects/:id/env-vars
//   List all custom env vars (values decrypted; DB_* excluded).
router.get('/:id/env-vars', projectController.listEnvVars);

// POST   /api/projects/:id/env-vars
//   Bulk replace — body: { items: [{ key, value }, …] }
//   Recreates running container so vars apply immediately.
router.post('/:id/env-vars', projectController.replaceEnvVars);

// PUT    /api/projects/:id/env-vars/:envId
//   Update a single env var. Applied on next deploy.
router.put('/:id/env-vars/:envId', projectController.updateEnvVar);

// DELETE /api/projects/:id/env-vars/:envId
//   Remove a single env var. Applied on next deploy.
router.delete('/:id/env-vars/:envId', projectController.deleteEnvVar);


// ════════════════════════════════════════════════════════════════════════════
// PROJECT — AUTO-INJECTED (PLATFORM) ENV VARS
//
// Read-only view of what the platform injects automatically.
// Currently: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD (masked), DB_NAME
// when a database is attached.  DB_PASSWORD is NEVER returned — only a
// masked placeholder so the student knows the variable name to reference.
// ════════════════════════════════════════════════════════════════════════════

// GET /api/projects/:id/injected-env
router.get('/:id/injected-env', projectController.getInjectedEnv);


module.exports = router;