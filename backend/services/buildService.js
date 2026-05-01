'use strict';

// ============================================================
// Build Service — services/buildService.js
// Section 7.9
//
// Orchestrates the full build pipeline for student projects:
//   - Initial deployment (startBuild)
//   - Webhook-triggered rebuild (rebuildProject)
//
// Coordinates: source acquisition, Dockerfile customisation,
// image build, container creation, status tracking, SSE
// streaming, and build log cleanup.
// ============================================================

const fs           = require('fs');
const fsp          = require('fs').promises;
const path         = require('path');
const { execFile } = require('child_process');

const { EventEmitter } = require('events');

const pool          = require('../config/db');
const dockerService = require('./dockerService');
const nginxService  = require('./nginxService');
const { allocatePort } = require('../utils/portAllocator');
const { decryptPassword } = require('./databaseProvisioningService');
const zipHandler    = require('../utils/zipHandler');
const projectEnvVarService = require('./projectEnvVarService');

// ── Active-build emitter registry ────────────────────────────
// Keyed by projectId (number). Entries are removed when the build
// completes (success, failed, or timeout) or when the server restarts.
const _buildEmitters = new Map();

// ── Constants ─────────────────────────────────────────────────

const DEFAULT_BUILD_TIMEOUT_MINUTES    = 10;
const DEFAULT_MAX_CONCURRENT_BUILDS    = 4;
const DEFAULT_BUILD_LOG_RETENTION_DAYS = 7;

// Python entry point detection order (Section 7.7.3)
const PYTHON_ENTRY_POINTS = ['app.py', 'main.py', 'server.py', 'wsgi.py'];

// ── Log file timestamp ────────────────────────────────────────

/**
 * Returns a file-safe ISO 8601 timestamp string.
 * Colons and periods are replaced with underscores.
 * e.g. 2024-02-10T14_30_00_000Z.log
 */
function buildLogTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '_');
}

// ── Template helpers ──────────────────────────────────────────

/**
 * Selects the Dockerfile template filename based on projectType, runtime,
 * and — for frontend projects — whether the source is a static site
 * (no package.json) or a Node-based build (React, Vue, etc).
 *
 * @param {string} projectType — 'frontend' | 'backend' | 'combined'
 * @param {string|null} runtime — 'node' | 'python' | null
 * @param {boolean} [staticFrontend=false] — true when a frontend project
 *        has no package.json (plain HTML/CSS/JS)
 * @returns {string} template filename
 */
function selectTemplate(projectType, runtime, staticFrontend = false) {
  if (projectType === 'frontend') {
    return staticFrontend ? 'Dockerfile.frontend.static' : 'Dockerfile.frontend';
  }
  if (projectType === 'backend'  && runtime === 'node')   return 'Dockerfile.node';
  if (projectType === 'backend'  && runtime === 'python') return 'Dockerfile.python';
  if (projectType === 'combined' && runtime === 'node')   return 'Dockerfile.combined.node';
  if (projectType === 'combined' && runtime === 'python') return 'Dockerfile.combined.python';
  throw new Error(`No Dockerfile template for projectType=${projectType} runtime=${runtime}`);
}

/**
 * Detects whether a frontend project is static (plain HTML/CSS/JS) or
 * Node-based (React, Vue, etc). A project is considered static when the
 * frontend source directory contains no package.json.
 *
 * Called only for projectType === 'frontend'. Combined projects always use
 * the Node-based frontend stage.
 *
 * @param {string} frontendSourceDir — absolute path to source/frontend/
 * @returns {Promise<boolean>} true when static (no package.json present)
 */
async function isStaticFrontend(frontendSourceDir) {
  try {
    await fsp.access(path.join(frontendSourceDir, 'package.json'));
    return false;
  } catch (_) {
    return true;
  }
}

/**
 * Detects the Python entry point by checking for known filenames in order.
 *
 * @param {string} backendSourceDir
 * @returns {Promise<string>} entry point filename (defaults to 'app.py')
 */
async function detectPythonEntryPoint(backendSourceDir) {
  for (const candidate of PYTHON_ENTRY_POINTS) {
    try {
      await fsp.access(path.join(backendSourceDir, candidate));
      return candidate;
    } catch (_) {
      // not found, try next
    }
  }
  return 'app.py';
}

/**
 * Reads a Dockerfile template, replaces placeholders, and returns the
 * customised content.
 *
 * @param {string} templateFile  — filename inside backend/templates/
 * @param {string|null} runtimeVersion
 * @param {string|null} entryPoint — Python entry point (app.py etc.)
 * @returns {Promise<string>}
 */
async function customiseTemplate(templateFile, runtimeVersion, entryPoint) {
  const templatePath = path.join(__dirname, '..', 'templates', templateFile);
  let content = await fsp.readFile(templatePath, 'utf8');

  if (runtimeVersion) {
    content = content.replace(/\{\{RUNTIME_VERSION\}\}/g, runtimeVersion);
  }

  // Replace Python entry point placeholder if present
  if (entryPoint) {
    content = content.replace(/app\.py/g, entryPoint);
  }

  return content;
}

// ── Source acquisition helpers ────────────────────────────────

/**
 * Clones a git repository into the target directory.
 * If the directory already exists and has content, performs a git pull instead.
 *
 * @param {string} repoUrl
 * @param {string} targetDir
 * @returns {Promise<void>}
 */
function cloneOrPull(repoUrl, targetDir) {
  return new Promise(async (resolve, reject) => {
    let isExisting = false;
    try {
      await fsp.access(path.join(targetDir, '.git'));
      isExisting = true;
    } catch (_) {}

    if (isExisting) {
      execFile('git', ['-C', targetDir, 'pull'], (err, stdout, stderr) => {
        if (err) return reject(new Error(`git pull failed: ${stderr || err.message}`));
        resolve();
      });
    } else {
      execFile('git', ['clone', repoUrl, targetDir], (err, stdout, stderr) => {
        if (err) return reject(new Error(`git clone failed: ${stderr || err.message}`));
        resolve();
      });
    }
  });
}

// ── Database env vars ─────────────────────────────────────────

/**
 * Builds the DB_* environment variable map for container injection.
 * Returns null when no database is attached.
 *
 * FIX (Bug 2): Backticks added around `databases` table name.
 * `DATABASES` is a reserved keyword in MySQL; omitting backticks causes a
 * syntax error in some MySQL versions/configurations, which previously
 * threw an unhandled exception in rebuildProject and crashed the process.
 *
 * @param {number|null} databaseId
 * @returns {Promise<Object|null>}
 */


/**
 * Builds the DB_* environment variable map for container injection.
 * Returns null when no database is attached.
 */
async function buildDbEnvVars(databaseId) {
  if (!databaseId) return null;

  const [[dbRow]] = await pool.query(
      'SELECT db_name, db_user, db_password_encrypted FROM `databases` WHERE id = ? LIMIT 1',
      [databaseId]
  );
  if (!dbRow) return null;

  const plainPassword = decryptPassword(dbRow.db_password_encrypted);

  return {
    DB_HOST:     'host.docker.internal',
    DB_PORT:     process.env.MYSQL_PORT || '3306',
    DB_USER:     dbRow.db_user,
    DB_PASSWORD: plainPassword,
    DB_NAME:     dbRow.db_name,
  };
}

/**
 * Builds the FULL environment variable map for a container:
 *   - Custom project env vars (decrypted from project_env_vars)
 *   - DB_* credentials (when a database is attached)
 *
 * DB_* vars are merged LAST so they can never be overridden by custom
 * student vars (the projectEnvVarService already rejects reserved keys
 * at write time, but this ordering is a second line of defence).
 *
 * Returns null when there are no vars at all — callers pass null to
 * dockerService.createAndStartContainer to signal "no -e flags".
 *
 * @param {number} projectId
 * @param {number|null} databaseId
 * @returns {Promise<Object|null>}
 */
async function buildAllEnvVars(projectId, databaseId) {
  const custom = await projectEnvVarService.getEnvVarMap(projectId).catch((err) => {
    console.error(`[buildService] Failed to load custom env vars for project ${projectId}: ${err.message}`);
    return {};
  });

  const dbVars = await buildDbEnvVars(databaseId);

  const merged = { ...custom };
  if (dbVars) Object.assign(merged, dbVars);

  return Object.keys(merged).length > 0 ? merged : null;
}
// ── SSE emitter helper ────────────────────────────────────────

/**
 * Emits an SSE event if an emitter is provided.
 *
 * @param {Function|null} emitter — (event, data) => void
 * @param {string} event
 * @param {string|Object} data
 */
function emit(emitter, event, data) {
  if (!emitter) return;
  try {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    emitter(event, payload);
  } catch (_) { /* SSE write errors must not crash build flow */ }
}

// ── Build concurrency guard ───────────────────────────────────

/**
 * Throws BUILD_QUEUE_FULL (HTTP 429) if MAX_CONCURRENT_BUILDS is reached.
 */
async function checkConcurrency() {
  const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_BUILDS, 10) || DEFAULT_MAX_CONCURRENT_BUILDS;
  const [[row]] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM builds WHERE status = 'building'"
  );
  if (row.cnt >= maxConcurrent) {
    throw {
      code: 'BUILD_QUEUE_FULL',
      message: `Maximum concurrent builds reached (${maxConcurrent}). Please try again shortly.`,
      httpStatus: 429,
    };
  }
}

// ── rebuildProject ────────────────────────────────────────────

/**
 * Webhook-triggered rebuild pipeline (Section 7.9.4).
 *
 * FIX (Bug 1): Dockerfile is regenerated from the current template after
 *   every git pull, exactly as startBuild does.  Previously the stale
 *   Dockerfile written during the initial deployment was reused, which
 *   meant any change in runtime/entry-point detection was silently ignored
 *   and — more critically — a database attached after the first build would
 *   cause container creation to fail because the Dockerfile was never
 *   updated (even though env vars are injected at `docker create` time,
 *   not baked into the image, the template regen step also ensures the
 *   correct template is always applied).
 *
 * FIX (Bug 2): backticks added to `databases` table name in buildDbEnvVars.
 *
 * FIX (Bug 3): database_id is re-fetched from the DB *after* the image
 *   build succeeds, not from the snapshot taken at the start of the
 *   rebuild.  This ensures that a switchDatabase call that raced with the
 *   build is honoured — the new container always gets the current DB creds.
 *
 * FIX (Bug 4 — system crash / "logs show success"): buildDbEnvVars() is now
 *   called INSIDE the container-creation try-catch block, not before it.
 *   Previously, if buildDbEnvVars threw (e.g. SQL error from the missing
 *   backticks on the `databases` table), the exception was completely
 *   unhandled: the builds row stayed in 'building' forever, the old
 *   container had already been removed, no new container was created, and
 *   in Node.js 15+ the unhandled promise rejection crashed the process.
 *   Docker's own "Successfully built / Successfully tagged" lines written
 *   to the log file made the build appear successful to the user even
 *   though the container never started.  Moving the call inside the
 *   try-catch ensures any failure is caught, the builds/projects rows are
 *   properly marked 'failed', and no crash occurs.
 *
 * FIX (status desync): projects.status is set to 'building' at the start
 *   of the container-swap so the UI never sees a "running" status pointing
 *   at a container that no longer exists.
 *
 * FIX (image removal): The old image is now captured by ID *before* the
 *   new build runs, and deleted by ID after the new container starts.
 *   Previously `oldImageName` (a tag, not an ID) was used for deletion, but
 *   `docker build -t <tag>` moves the tag to the new image — so
 *   `removeImage(oldImageName)` was silently deleting the freshly built
 *   image.  Any subsequent `switchDatabase` call would then fail at
 *   `docker create` with "No such image", crashing the project.
 *
 * @param {number}        projectId
 * @param {number}        studentId
 * @param {string}        repoUrl       — the repo URL that triggered the webhook
 * @param {Function|null} sseEmitter
 * @returns {Promise<{ skipped: boolean }>}
 */
async function rebuildProject({ projectId, studentId, repoUrl, sseEmitter }) {
  // Step 1a: concurrency guard — skip if build already in progress
  const [[inProgressRow]] = await pool.query(
      "SELECT id FROM builds WHERE project_id = ? AND status = 'building' LIMIT 1",
      [projectId]
  );
  if (inProgressRow) {
    console.info(`[buildService] Webhook for project ${projectId}: build already in progress. Skipping.`);
    return { skipped: true, reason: 'BUILD_ALREADY_IN_PROGRESS' };
  }

  // Fetch project record
  const [[project]] = await pool.query(
      'SELECT * FROM projects WHERE id = ? LIMIT 1',
      [projectId]
  );
  if (!project) throw new Error(`Project ${projectId} not found`);

  // Remember the prior status so failure paths can restore it accurately.
  const priorStatus = project.status;

  const baseDir    = process.env.PROJECTS_BASE_DIR;
  const projectDir = path.join(baseDir, String(studentId), String(projectId));

  // Step 2: determine which source directory to update
  let sourceDir;
  if (project.project_type === 'combined') {
    if (repoUrl === project.git_url_backend) {
      sourceDir = path.join(projectDir, 'source', 'backend');
    } else {
      sourceDir = path.join(projectDir, 'source', 'frontend');
    }
  } else if (project.project_type === 'frontend') {
    sourceDir = path.join(projectDir, 'source', 'frontend');
  } else {
    sourceDir = path.join(projectDir, 'source', 'backend');
  }

  // Step 3: pull new code
  await cloneOrPull(repoUrl, sourceDir);

  // ── FIX (Bug 1): Regenerate Dockerfile from current template ──────────
  // startBuild always writes a fresh Dockerfile (steps 5–7).  rebuildProject
  // previously skipped this, reusing the stale file from the initial deploy.
  // Consequences:
  //   • If a database was attached after the first build, the next webhook
  //     rebuild would still succeed at the image level but fail at docker
  //     create because the old container name was never properly cleared AND
  //     because the env-var injection path in createAndStartContainer expects
  //     a clean container slot.  More subtly, if the source tree changed in
  //     a way that affects template selection (e.g. package.json added to a
  //     previously-static frontend), the wrong Dockerfile would be used.
  //   • For Python projects, a changed entry point would silently be ignored.
  //
  // We re-run the same template-selection + customisation logic here so that
  // every rebuild is always built from a freshly generated Dockerfile.
  try {
    const effectiveRuntime  = project.runtime;
    const runtimeVersion    = project.runtime_version;

    let staticFrontend = false;
    if (project.project_type === 'frontend') {
      staticFrontend = await isStaticFrontend(path.join(projectDir, 'source', 'frontend'));
    }

    const templateFile = selectTemplate(project.project_type, effectiveRuntime, staticFrontend);

    let entryPoint = null;
    if (effectiveRuntime === 'python') {
      entryPoint = await detectPythonEntryPoint(path.join(projectDir, 'source', 'backend'));
    }

    const dockerfileContent = await customiseTemplate(templateFile, runtimeVersion, entryPoint);
    await fsp.writeFile(path.join(projectDir, 'Dockerfile'), dockerfileContent, 'utf8');
  } catch (templateErr) {
    // Template regeneration failure is fatal — we cannot build without a
    // valid Dockerfile.  Mark the build as failed immediately.
    console.error(`[buildService] rebuildProject: Dockerfile regeneration failed for project ${projectId}: ${templateErr.message}`);
    const timestamp  = buildLogTimestamp();
    const logRelPath = `${studentId}/${projectId}/build/logs/${timestamp}.log`;
    await pool.query(
        `INSERT INTO builds (project_id, status, log_file_path, started_at, completed_at)
         VALUES (?, 'failed', ?, NOW(), NOW())`,
        [projectId, logRelPath]
    );
    // Restore prior status so the UI is accurate
    await pool.query(
        'UPDATE projects SET status = ? WHERE id = ?',
        [priorStatus || 'failed', projectId]
    );
    emit(sseEmitter, 'status', 'failed');
    emit(sseEmitter, 'complete', { status: 'failed', message: `Dockerfile template error: ${templateErr.message}` });
    return { skipped: false };
  }
  // ── End Bug 1 fix ──────────────────────────────────────────────────────

  // Step 4: record old container info and old image ID.
  //
  // ── FIX (image removal): Capture the old image ID by content hash NOW,
  // before docker build runs.  After `docker build -t <tag>` the tag moves
  // to the new image and the old one becomes dangling/untagged — we can no
  // longer reference it by tag.  Storing the ID here lets us delete exactly
  // the right (old) image after the new container is confirmed running,
  // without touching the newly built image.
  const oldContainerId = project.container_id;
  const currentImageTag = `acadhost/project-${projectId}:latest`;
  const oldImageId = await dockerService.getImageId(currentImageTag);

  // Step 5: insert new builds row
  const timestamp  = buildLogTimestamp();
  const logRelPath = `${studentId}/${projectId}/build/logs/${timestamp}.log`;
  const logAbsPath = path.join(baseDir, logRelPath);

  await fsp.mkdir(path.dirname(logAbsPath), { recursive: true });
  const logStream = fs.createWriteStream(logAbsPath, { flags: 'a' });

  const [buildInsert] = await pool.query(
      `INSERT INTO builds (project_id, status, log_file_path, started_at)
       VALUES (?, 'building', ?, NOW())`,
      [projectId, logRelPath]
  );
  const buildId = buildInsert.insertId;

  // ── Mark project as 'building' during the rebuild swap ──────────────
  // While the image is being rebuilt and containers are being swapped the
  // project status accurately reflects "work in progress" rather than
  // lying about a non-existent running container.
  await pool.query(
      "UPDATE projects SET status = 'building' WHERE id = ?",
      [projectId]
  );

  const onLogLine = (line) => emit(sseEmitter, 'log', line);

  const timeoutMinutes  = parseInt(process.env.BUILD_TIMEOUT_MINUTES, 10) || DEFAULT_BUILD_TIMEOUT_MINUTES;
  const abortController = new AbortController();
  let timedOut = false;

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMinutes * 60 * 1000);

  // Step 6: rebuild image
  try {
    await dockerService.buildImage(projectId, studentId, logStream, onLogLine, abortController.signal);
    clearTimeout(timeoutHandle);
  } catch (buildErr) {
    clearTimeout(timeoutHandle);
    logStream.end();

    // Build failed — old container may still be running.  Restore to
    // priorStatus only if the old container still exists; otherwise 'failed'.
    let statusAfterFailure = 'failed';
    if (oldContainerId) {
      try {
        await dockerService.inspectContainer(oldContainerId);
        statusAfterFailure = priorStatus || 'running';
      } catch (_) {
        statusAfterFailure = 'failed';
      }
    }
    await pool.query(
        'UPDATE projects SET status = ? WHERE id = ?',
        [statusAfterFailure, projectId]
    );
    await pool.query(
        "UPDATE builds SET status = 'failed', completed_at = NOW() WHERE id = ?",
        [buildId]
    );
    emit(sseEmitter, 'status', 'failed');
    emit(sseEmitter, 'complete', { status: 'failed', message: buildErr.message || 'Rebuild failed' });
    return { skipped: false };
  }

  logStream.end();

  // Step 7: successful rebuild — hot-swap container.
  // Stop and remove old container.
  if (oldContainerId) {
    try {
      await dockerService.stopContainer(oldContainerId);
      await dockerService.removeContainer(oldContainerId);
    } catch (stopErr) {
      console.error(`[buildService] Failed to stop/remove old container ${oldContainerId}: ${stopErr.message}`);
      // Non-fatal: createAndStartContainer will force-remove by name anyway
      // (Bug 2 fix in dockerService).
    }
  }

  // ── FIX (Bug 3): Re-fetch project row for current database_id ─────────
  // The snapshot in `project` was taken before the build started.  If
  // switchDatabase was called while the image was building, the old
  // database_id would be used and the new container would start without the
  // correct DB credentials.  Re-reading from the DB here ensures we always
  // use the most up-to-date values.
  const [[freshProject]] = await pool.query(
      'SELECT database_id, container_port, cpu_limit, ram_limit_mb FROM projects WHERE id = ? LIMIT 1',
      [projectId]
  );

  const cpuLimit   = parseFloat(freshProject.cpu_limit);
  const ramLimitMb = parseInt(freshProject.ram_limit_mb, 10);
  // Use the persisted container_port; fall back to the snapshot value if
  // somehow the row disappeared (should never happen but be defensive).
  const containerPort = freshProject.container_port || project.container_port;
  // ── End Bug 3 fix ──────────────────────────────────────────────────────

  // ── FIX (Bug 4 — system crash): buildDbEnvVars() moved INSIDE try-catch ──
  // Previously buildDbEnvVars was called here, BEFORE the try-catch block.
  // If it threw (SQL error, DB connection issue, etc.), the exception was
  // completely unhandled: the builds row stayed in 'building' forever, the
  // old container had already been removed, no new container was created,
  // and in Node.js 15+ the unhandled promise rejection crashed the server
  // process.  Moving the call inside the try-catch ensures any failure here
  // is caught and handled identically to a container creation failure.
  let newContainerId;
  try {
    // buildDbEnvVars is now inside the try-catch so any SQL/network error
    // during credential lookup is handled and marked as a build failure
    // rather than crashing the process.
    // Load full env var set (custom + DB_*). Inside try-catch so any SQL
    // / network error during credential lookup is handled and the build
    // is marked 'failed' rather than crashing the process.
    const allEnvVars = await buildAllEnvVars(projectId, freshProject.database_id);

    newContainerId = await dockerService.createAndStartContainer(
        projectId,
        containerPort,
        cpuLimit,
        ramLimitMb,
        allEnvVars
    );
  } catch (containerErr) {
    // Container creation failure after successful rebuild — at this point
    // the old container is already gone, so mark 'failed' with container_id
    // cleared so the UI and health endpoint are truthful.
    await pool.query(
        "UPDATE projects SET status = 'failed', container_id = NULL WHERE id = ?",
        [projectId]
    );
    await pool.query(
        "UPDATE builds SET status = 'failed', completed_at = NOW() WHERE id = ?",
        [buildId]
    );
    console.error(`[buildService] rebuildProject: container creation failed after successful build for project ${projectId}: ${containerErr.message}`);

    dockerService.removeImage(`acadhost/project-${projectId}:latest`).catch((e) =>
        console.error(`[buildService] Post-rebuild image removal failed: ${e.message}`)
    );

    emit(sseEmitter, 'status', 'failed');
    emit(sseEmitter, 'complete', { status: 'failed', message: 'Container creation failed after rebuild' });
    return { skipped: false };
  }
  // ── End Bug 4 fix ──────────────────────────────────────────────────────

  // ── FIX (image removal): Delete old image by its captured ID, not by tag.
  //
  // The previous code did:
  //   await dockerService.removeImage(oldImageName)   // oldImageName = "acadhost/project-N:latest"
  //
  // This was wrong because `docker build -t acadhost/project-N:latest` moves
  // the `:latest` tag to the newly built image.  By the time this line ran,
  // `acadhost/project-N:latest` referred to the NEW image, not the old one.
  // `docker rmi -f` would untag (and effectively delete) the freshly built
  // image while the running container still held an anonymous reference to it.
  // The container itself kept running, but `acadhost/project-N:latest` no
  // longer existed as a named image — so any subsequent `docker create`
  // referencing that tag (e.g. from switchDatabase) would fail with
  // "No such image", crashing the project.
  //
  // Fix: we captured `oldImageId` (the image ID hash) before the build ran.
  // Deleting by ID is precise — it targets only the old image, never the new one.
  if (oldImageId) {
    await dockerService.removeImage(oldImageId).catch((e) =>
        console.error(`[buildService] Old image removal failed: ${e.message}`)
    );
  }
  // ── End image removal fix ──────────────────────────────────────────────

  // Update projects row with new container ID; status → 'running'
  await pool.query(
      "UPDATE projects SET container_id = ?, status = 'running' WHERE id = ?",
      [newContainerId, projectId]
  );
  await pool.query(
      "UPDATE builds SET status = 'success', completed_at = NOW() WHERE id = ?",
      [buildId]
  );

  // No Nginx reconfiguration needed — same port, same subdomain

  emit(sseEmitter, 'status', 'success');
  emit(sseEmitter, 'complete', { status: 'success' });

  return { skipped: false };
}

// ── Small DB helpers ──────────────────────────────────────────

/**
 * Returns [cpuLimit, ramLimitMb] for a project.
 * @param {number} projectId
 * @returns {Promise<[number, number]>}
 */
async function getProjectLimits(projectId) {
  const [[row]] = await pool.query(
      'SELECT cpu_limit, ram_limit_mb FROM projects WHERE id = ? LIMIT 1',
      [projectId]
  );
  return [parseFloat(row.cpu_limit), parseInt(row.ram_limit_mb, 10)];
}

/**
 * Returns the subdomain for a project.
 * @param {number} projectId
 * @returns {Promise<string>}
 */
async function getProjectSubdomain(projectId) {
  const [[row]] = await pool.query(
      'SELECT subdomain FROM projects WHERE id = ? LIMIT 1',
      [projectId]
  );
  return row.subdomain;
}

// ── Build log retention cleanup ───────────────────────────────

/**
 * Deletes expired build log files from disk and removes their
 * builds rows from the database.
 *
 * Runs on a 24-hour setInterval started at module load.
 * Section 7.9.6
 */
async function cleanupOldBuildLogs() {
  const retentionDays = parseInt(process.env.BUILD_LOG_RETENTION_DAYS, 10) || DEFAULT_BUILD_LOG_RETENTION_DAYS;
  const baseDir       = process.env.PROJECTS_BASE_DIR;

  try {
    const [expiredBuilds] = await pool.query(
        `SELECT id, log_file_path FROM builds
         WHERE started_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [retentionDays]
    );

    let cleaned = 0;
    for (const build of expiredBuilds) {
      if (build.log_file_path) {
        const absPath = path.join(baseDir, build.log_file_path);
        try {
          await fsp.unlink(absPath);
        } catch (fileErr) {
          if (fileErr.code !== 'ENOENT') {
            console.warn(`[buildService] Could not delete log file ${absPath}: ${fileErr.message}`);
          }
        }
      }
      await pool.query('DELETE FROM builds WHERE id = ?', [build.id]);
      cleaned++;
    }

    if (cleaned > 0) {
      console.info(`[buildService] Build log cleanup: removed ${cleaned} expired build(s).`);
    }
  } catch (err) {
    console.error(`[buildService] Build log cleanup error: ${err.message}`);
  }
}

// Start the 24-hour cleanup timer when the module is loaded.
setInterval(cleanupOldBuildLogs, 24 * 60 * 60 * 1000);

// ── getBuildEmitter ───────────────────────────────────────────

/**
 * Returns the live EventEmitter for an in-progress build, or null if no
 * active build exists for the given project.
 *
 * Used by the SSE streaming endpoint in projectController.
 *
 * @param {number} projectId
 * @returns {EventEmitter|null}
 */
function getBuildEmitter(projectId) {
  return _buildEmitters.get(projectId) || null;
}

// ── startBuild ────────────────────────────────────────────────

/**
 * Async build pipeline for initial project deployment triggered by the
 * create-project API route (Section 7.9.3).
 *
 * Unlike rebuildProject, the caller pre-allocates containerPort, cpuLimit,
 * ramLimitMb, and subdomain.  ZIP files are extracted here when
 * sourceType === 'zip'.
 *
 * An EventEmitter is registered in _buildEmitters for SSE streaming via
 * getBuildEmitter().  It is removed when the build completes.
 *
 * FIX (build log accuracy): _finish('success') is now called AFTER
 *   createAndStartContainer succeeds, not before.  Previously the builds
 *   row was marked 'success' the moment the image compiled, so a subsequent
 *   container creation failure would leave the DB reporting a successful
 *   build even though no container ever started.
 *
 * @param {Object} params
 * @param {number}      params.projectId
 * @param {number}      params.studentId
 * @param {string}      params.projectType     — 'frontend' | 'backend' | 'combined'
 * @param {string|null} params.runtime         — 'node' | 'python' | null
 * @param {string|null} params.runtimeVersion
 * @param {string}      params.sourceType      — 'git' | 'zip'
 * @param {string|null} params.gitUrl
 * @param {string|null} params.gitUrlBackend
 * @param {Object|null} params.uploadedFiles   — multer file objects
 * @param {number|null} params.databaseId
 * @param {number}      params.containerPort
 * @param {number}      params.cpuLimit
 * @param {number}      params.ramLimitMb
 * @param {string}      params.subdomain
 * @returns {Promise<void>}
 */
async function startBuild({
                            projectId,
                            studentId,
                            projectType,
                            runtime,
                            runtimeVersion,
                            sourceType,
                            gitUrl,
                            gitUrlBackend,
                            uploadedFiles,
                            databaseId,
                            containerPort,
                            cpuLimit,
                            ramLimitMb,
                            subdomain,
                          }) {
  // Register an EventEmitter so the SSE endpoint can subscribe
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  _buildEmitters.set(projectId, emitter);

  const sseEmitter = (event, data) => emitter.emit(event, data);

  const baseDir    = process.env.PROJECTS_BASE_DIR;
  const projectDir = path.join(baseDir, String(studentId), String(projectId));
  const timestamp  = buildLogTimestamp();
  const logRelPath = `${studentId}/${projectId}/build/logs/${timestamp}.log`;
  const logAbsPath = path.join(baseDir, logRelPath);

  // Step 1: concurrency check
  await checkConcurrency();

  // Step 2: create directory structure
  const dirs = [
    path.join(projectDir, 'build', 'logs'),
    path.join(projectDir, 'uploads'),
  ];
  if (projectType === 'frontend' || projectType === 'combined') {
    dirs.push(path.join(projectDir, 'source', 'frontend'));
  }
  if (projectType === 'backend' || projectType === 'combined') {
    dirs.push(path.join(projectDir, 'source', 'backend'));
  }
  for (const dir of dirs) {
    await fsp.mkdir(dir, { recursive: true });
  }

  // Step 3: insert builds row
  await fsp.mkdir(path.dirname(logAbsPath), { recursive: true });
  const [buildInsert] = await pool.query(
      `INSERT INTO builds (project_id, status, log_file_path, started_at)
       VALUES (?, 'building', ?, NOW())`,
      [projectId, logRelPath]
  );
  const buildId = buildInsert.insertId;

  // Open log stream
  const logStream = fs.createWriteStream(logAbsPath, { flags: 'a' });
  const onLogLine = (line) => {
    emit(sseEmitter, 'log', line);
    logStream.write(line + '\n');
  };

  const timeoutMinutes = parseInt(process.env.BUILD_TIMEOUT_MINUTES, 10) || DEFAULT_BUILD_TIMEOUT_MINUTES;
  const abortController = new AbortController();
  let timedOut = false;

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMinutes * 60 * 1000);

  // _finish closes the log stream, removes the emitter, and updates the
  // builds row.  It must only be called once per build.
  const _finish = async (status) => {
    clearTimeout(timeoutHandle);
    logStream.end();
    _buildEmitters.delete(projectId);
    const buildStatus = status === 'timeout' ? 'timeout' : status;
    await pool.query(
        'UPDATE builds SET status = ?, completed_at = NOW() WHERE id = ?',
        [buildStatus, buildId]
    );
  };

  try {
    // Step 4: acquire source
    if (sourceType === 'git') {
      if (projectType === 'frontend') {
        await cloneOrPull(gitUrl, path.join(projectDir, 'source', 'frontend'));
      } else if (projectType === 'backend') {
        await cloneOrPull(gitUrl, path.join(projectDir, 'source', 'backend'));
      } else if (projectType === 'combined') {
        await cloneOrPull(gitUrl, path.join(projectDir, 'source', 'frontend'));
        await cloneOrPull(gitUrlBackend || gitUrl, path.join(projectDir, 'source', 'backend'));
      }
    } else if (sourceType === 'zip' && uploadedFiles) {
      if (projectType === 'combined') {
        await zipHandler.extractZip(
            // FIX: fall back to .buffer when .path is undefined (memoryStorage)
            uploadedFiles.frontend.path || uploadedFiles.frontend.buffer,
            path.join(projectDir, 'source', 'frontend')
        );
        await zipHandler.extractZip(
            // FIX: fall back to .buffer when .path is undefined (memoryStorage)
            uploadedFiles.backend.path || uploadedFiles.backend.buffer,
            path.join(projectDir, 'source', 'backend')
        );
      } else if (projectType === 'frontend') {
        await zipHandler.extractZip(
            // FIX: fall back to .buffer when .path is undefined (memoryStorage)
            uploadedFiles.single.path || uploadedFiles.single.buffer,
            path.join(projectDir, 'source', 'frontend')
        );
      } else {
        await zipHandler.extractZip(
            // FIX: fall back to .buffer when .path is undefined (memoryStorage)
            uploadedFiles.single.path || uploadedFiles.single.buffer,
            path.join(projectDir, 'source', 'backend')
        );
      }
    }

    // Step 5: auto-detect runtime
    let effectiveRuntime = runtime;
    if (projectType !== 'frontend' && !effectiveRuntime) {
      const backendDir = path.join(projectDir, 'source', 'backend');
      try {
        await fsp.access(path.join(backendDir, 'package.json'));
        effectiveRuntime = 'node';
      } catch (_) {}
      if (!effectiveRuntime) {
        try {
          await fsp.access(path.join(backendDir, 'requirements.txt'));
          effectiveRuntime = 'python';
        } catch (_) {}
      }
    }

    // Steps 6–7: select and customise Dockerfile
    let staticFrontend = false;
    if (projectType === 'frontend') {
      staticFrontend = await isStaticFrontend(path.join(projectDir, 'source', 'frontend'));
    }
    const templateFile = selectTemplate(projectType, effectiveRuntime, staticFrontend);
    let entryPoint = null;
    if (effectiveRuntime === 'python') {
      entryPoint = await detectPythonEntryPoint(path.join(projectDir, 'source', 'backend'));
    }
    const dockerfileContent = await customiseTemplate(templateFile, runtimeVersion, entryPoint);
    await fsp.writeFile(path.join(projectDir, 'Dockerfile'), dockerfileContent, 'utf8');

    // Step 8: docker build
    await dockerService.buildImage(projectId, studentId, logStream, onLogLine, abortController.signal);

    clearTimeout(timeoutHandle);
    if (timedOut) throw new Error('BUILD_TIMEOUT');

  } catch (buildErr) {
    if (timedOut || buildErr.message === 'BUILD_TIMEOUT') {
      await pool.query("UPDATE projects SET status = 'failed' WHERE id = ?", [projectId]);
      await _finish('timeout');
      dockerService.removeImage(`acadhost/project-${projectId}:latest`).catch(() => {});
      emit(sseEmitter, 'status', 'timeout');
      emit(sseEmitter, 'complete', { status: 'timeout', message: 'Build exceeded time limit' });
      emitter.emit('complete', { status: 'timeout', message: 'Build exceeded time limit' });
      return;
    }

    await pool.query("UPDATE projects SET status = 'failed' WHERE id = ?", [projectId]);
    await _finish('failed');
    emit(sseEmitter, 'status', 'failed');
    emitter.emit('status', 'failed');
    emitter.emit('complete', { status: 'failed', message: buildErr.message || 'Build failed' });
    return;
  }

  // Step 9: build succeeded — store pre-allocated port, create container.
  //
  // FIX (build log accuracy): _finish('success') is called AFTER the
  // container starts successfully.  Previously it was called at the top of
  // this try block, so a docker create failure would still mark the builds
  // row as 'success' — misleading because no container ever ran.
  try {
    await pool.query(
        'UPDATE projects SET container_port = ? WHERE id = ?',
        [containerPort, projectId]
    );

    const allEnvVars = await buildAllEnvVars(projectId, databaseId);
    const containerId = await dockerService.createAndStartContainer(
        projectId, containerPort, cpuLimit, ramLimitMb, allEnvVars
    );

    await pool.query(
        "UPDATE projects SET status = 'running', container_id = ? WHERE id = ?",
        [containerId, projectId]
    );

    // ── Moved here (was before createAndStartContainer) ───────────────
    // Only mark the build as 'success' once the container is confirmed
    // running.  If createAndStartContainer throws above we fall into the
    // catch block and _finish('failed') is called instead.
    await _finish('success');

    // Write Nginx config
    try {
      await nginxService.addProjectConfig(subdomain, containerPort);
    } catch (nginxErr) {
      console.error(`[buildService] Nginx config write failed after successful build: ${nginxErr.message}`);
    }

    emitter.emit('status', 'success');
    emitter.emit('complete', { status: 'success' });

  } catch (containerErr) {
    await pool.query("UPDATE projects SET status = 'failed' WHERE id = ?", [projectId]);
    await _finish('failed');
    dockerService.removeImage(`acadhost/project-${projectId}:latest`).catch(() => {});
    emitter.emit('status', 'failed');
    emitter.emit('complete', { status: 'failed', message: 'Container creation failed after successful build' });
  }
}

module.exports = {
  rebuildProject,
  cleanupOldBuildLogs,  // exported for testing / manual invocation
  startBuild,
  getBuildEmitter,
  buildAllEnvVars,
};