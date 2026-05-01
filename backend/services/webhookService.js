'use strict';

// ============================================================
// Webhook Service — services/webhookService.js
// Section 6.8 — Webhook Routes
// Section 12.6 — Webhook Business Logic
//
// Handles GitHub push webhooks that trigger project rebuilds.
//
// Implementation rules (from prompt):
//   - Verify GitHub signature using WEBHOOK_SECRET (HMAC-SHA256,
//     constant-time comparison — Section 12.6.1)
//   - Only trigger rebuild if source_type = 'git'
//   - Return 200 immediately if project is deleted or
//     source_type = 'zip'  (prevents GitHub retry storms)
//
// Raw body availability:
//   server.js registers express.json() with a `verify` callback
//   that writes req.rawBody = buf.  The HMAC is computed against
//   req.rawBody — NOT the parsed req.body — so the signature
//   matches exactly what GitHub signed.
// ============================================================

const crypto       = require('crypto');
const pool         = require('../config/db');
const buildService = require('./buildService');

// ── URL normalization (Section 12.6.2) ──────────────────────

/**
 * Strips .git suffix, normalises http → https, lowercases.
 * Used to match the payload's repository URL against stored git_url fields.
 *
 * @param {string} url
 * @returns {string}
 */
function normalizeGitUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url
      .replace(/\.git$/i, '')
      .replace(/^http:/i, 'https:')
      .toLowerCase();
}

// ── Signature validation (Section 12.6.1) ───────────────────

/**
 * Validates the X-Hub-Signature-256 header against the raw request body.
 * Uses constant-time comparison (crypto.timingSafeEqual) to prevent
 * timing-based secret discovery attacks.
 *
 * @param {string} secret          — project's webhook_secret or webhook_secret_backend
 * @param {Buffer} rawBody         — req.rawBody set by server.js express.json verify callback
 * @param {string} signatureHeader — value of X-Hub-Signature-256 header
 * @returns {boolean}
 */
function validateWebhookSignature(secret, rawBody, signatureHeader) {
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;

  const expected = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

  // Buffers must be equal length for timingSafeEqual
  const sigBuf = Buffer.from(signatureHeader);
  const expBuf = Buffer.from(expected);

  if (sigBuf.length !== expBuf.length) return false;

  return crypto.timingSafeEqual(sigBuf, expBuf);
}

// ── Repository → secret matching (Section 12.6.2) ───────────

/**
 * Determines which webhook secret to use based on the repository URL
 * in the GitHub payload.
 *
 * For combined projects two Git URLs are stored:
 *   - git_url          → webhook_secret          (frontend)
 *   - git_url_backend  → webhook_secret_backend  (backend)
 *
 * @param {object} project       — projects row from the database
 * @param {string} payloadRepoUrl — repository URL from the webhook payload
 * @returns {{ secret: string, source: string }|null}
 *   Returns null if neither URL matches (→ 400 REPOSITORY_MISMATCH).
 */
function matchWebhookRepo(project, payloadRepoUrl) {
  const normalizedPayload = normalizeGitUrl(payloadRepoUrl);

  if (project.git_url && normalizeGitUrl(project.git_url) === normalizedPayload) {
    return { secret: project.webhook_secret, source: 'frontend' };
  }

  if (project.git_url_backend && normalizeGitUrl(project.git_url_backend) === normalizedPayload) {
    return { secret: project.webhook_secret_backend, source: 'backend' };
  }

  return null;
}

// ── Safety-net cleanup (fix for CONTAINER_MISSING desync) ───
//
// If rebuildProject throws for any reason not already handled inside its
// own try/catch blocks (unexpected DB error, process hiccup, etc.), the
// project could be left with status='building' or status='running' while
// no container actually exists. This helper forces a sane DB state so the
// UI never lies about reality.
//
// Rules:
//   - Any open 'building' build rows for this project → 'failed'.
//   - If projects.status is still 'building' (set at start of rebuild)
//     → set to 'failed' and clear container_id.
//   - If projects.status is 'running' but the stored container_id no
//     longer exists on the host → set to 'failed' and clear container_id.
//
// The dockerService.inspectContainer check is best-effort; a network
// timeout is treated as "container gone" to bias toward truth over
// optimism.
async function _reconcileAfterRebuildCrash(projectId) {
  try {
    // Mark any stuck build rows as failed.
    await pool.query(
        `UPDATE builds
          SET status = 'failed',
              completed_at = NOW()
        WHERE project_id = ?
          AND status = 'building'`,
        [projectId]
    );

    const [[row]] = await pool.query(
        'SELECT status, container_id FROM projects WHERE id = ? LIMIT 1',
        [projectId]
    );
    if (!row) return;

    // If we left the project in 'building' state, it definitely needs to
    // be recovered — the rebuild never finished.
    if (row.status === 'building') {
      await pool.query(
          "UPDATE projects SET status = 'failed', container_id = NULL WHERE id = ?",
          [projectId]
      );
      return;
    }

    // If still 'running' but container is gone, sync the DB to reality.
    if (row.status === 'running' && row.container_id) {
      const dockerService = require('./dockerService');
      let containerGone = false;
      try {
        await dockerService.inspectContainer(row.container_id);
      } catch (_) {
        containerGone = true;
      }
      if (containerGone) {
        await pool.query(
            "UPDATE projects SET status = 'failed', container_id = NULL WHERE id = ?",
            [projectId]
        );
      }
    }
  } catch (reconcileErr) {
    console.error(`[webhookService] Reconcile after rebuild crash failed for project ${projectId}: ${reconcileErr.message}`);
  }
}

// ── handleGithubWebhook ──────────────────────────────────────

/**
 * POST /api/webhooks/github/:projectId
 *
 * Processing flow:
 *   1.  Look up project by projectId.
 *   2a. Project not found                 → 404
 *   2b. Project deleted or zip-based      → 200 immediately (prompt rule)
 *   3.  Match payload repo URL to project's git_url(s); pick secret.
 *   4.  Validate X-Hub-Signature-256.
 *   5.  Handle ping event (→ 200 pong).
 *   6.  Handle push event:
 *         a. Check for in-progress build  → 200 BUILD_ALREADY_IN_PROGRESS
 *         b. Trigger rebuild asynchronously via buildService.rebuildProject
 *         c. Return 200 REBUILD_TRIGGERED immediately
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function handleGithubWebhook(req, res) {
  try {
    const projectId = parseInt(req.params.projectId, 10);

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error:   'VALIDATION_ERROR',
        message: 'Invalid project ID',
      });
    }

    // ── Step 1: look up project ──────────────────────────────

    const [[project]] = await pool.query(
        'SELECT * FROM projects WHERE id = ? LIMIT 1',
        [projectId]
    );

    if (!project) {
      return res.status(404).json({
        success: false,
        error:   'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }

    // ── Step 2b: return 200 for deleted projects ─────────────
    // Returning 200 prevents GitHub from retrying the delivery.
    if (project.status === 'deleted') {
      return res.status(200).json({
        success: true,
        data: { message: 'PROJECT_DELETED_IGNORED', projectId },
      });
    }

    // ── Step 2b: return 200 for zip-based projects ───────────
    // Webhooks are not meaningful for ZIP-sourced projects; return 200
    // so GitHub does not mark the delivery as failed and retry.
    // (Prompt rule: return 200 immediately for zip. MRD Section 6.8.1
    // error table says 400, but 200 prevents retry storms.)
    if (project.source_type !== 'git') {
      return res.status(200).json({
        success: true,
        data: { message: 'WEBHOOK_NOT_APPLICABLE', projectId },
      });
    }

    // ── Step 3: match repository URL to pick webhook secret ──

    const payloadRepoUrl =
        (req.body && req.body.repository)
            ? (req.body.repository.clone_url || req.body.repository.html_url || '')
            : '';

    const match = matchWebhookRepo(project, payloadRepoUrl);

    if (!match) {
      return res.status(400).json({
        success: false,
        error:   'REPOSITORY_MISMATCH',
        message: 'Repository URL does not match this project',
      });
    }

    if (!match.secret) {
      return res.status(500).json({
        success: false,
        error:   'WEBHOOK_SECRET_MISSING',
        message: 'Webhook secret is not configured for this project',
      });
    }

    // ── Step 4: validate HMAC-SHA256 signature ───────────────

    const signatureHeader = req.headers['x-hub-signature-256'] || '';
    const rawBody         = req.rawBody; // set by server.js express.json verify callback

    if (!rawBody) {
      console.error(`[webhookService] req.rawBody is missing for project ${projectId}. Check server.js express.json verify config.`);
      return res.status(500).json({
        success: false,
        error:   'RAW_BODY_UNAVAILABLE',
        message: 'Cannot validate webhook signature: raw body not available',
      });
    }

    const signatureValid = validateWebhookSignature(match.secret, rawBody, signatureHeader);
    if (!signatureValid) {
      return res.status(401).json({
        success: false,
        error:   'WEBHOOK_SIGNATURE_INVALID',
        message: 'Webhook signature validation failed',
      });
    }

    // ── Step 5: ping event ───────────────────────────────────

    const githubEvent = req.headers['x-github-event'] || '';

    if (githubEvent === 'ping') {
      return res.status(200).json({
        success: true,
        data: { message: 'pong' },
      });
    }

    // ── Step 6: push event ───────────────────────────────────

    if (githubEvent !== 'push') {
      // Unknown event type — acknowledge and ignore
      return res.status(200).json({
        success: true,
        data: { message: 'EVENT_IGNORED', event: githubEvent },
      });
    }

    // ── Step 6a: check for in-progress build (Section 12.5.2) ─
    // Return 200 so GitHub does not retry; the ongoing build will
    // eventually deploy the latest code pulled during that build.

    const [[inProgressBuild]] = await pool.query(
        "SELECT id FROM builds WHERE project_id = ? AND status = 'building' LIMIT 1",
        [projectId]
    );

    if (inProgressBuild) {
      return res.status(200).json({
        success: true,
        data: {
          message:   'BUILD_ALREADY_IN_PROGRESS',
          projectId,
        },
      });
    }

    // ── Step 6b: respond 200 immediately, then rebuild async ──
    // GitHub considers any non-2xx response a delivery failure and
    // will retry.  We acknowledge first, then rebuild in the background.

    res.status(200).json({
      success: true,
      data: {
        message:   'REBUILD_TRIGGERED',
        projectId,
      },
    });

    // ── Step 6c: async rebuild ───────────────────────────────
    // rebuildProject handles: git pull, image build, container swap.
    // Errors are caught here so they don't propagate past the handler.
    //
    // SAFETY NET (fix for CONTAINER_MISSING desync):
    //   rebuildProject has its own failure-path try/catches for the build
    //   step and the container-swap step, but *anything* unexpected (DB
    //   hiccup, unforeseen exception, process signal) that escapes those
    //   blocks would leave the project in an inconsistent state with no
    //   one to clean up — the HTTP response was already sent.
    //   The outer catch + _reconcileAfterRebuildCrash guarantees the DB is
    //   brought back in sync with Docker reality no matter what fails.

    const repoUrl = match.source === 'backend'
        ? project.git_url_backend
        : project.git_url;

    setImmediate(async () => {
      try {
        const result = await buildService.rebuildProject({
          projectId,
          studentId: project.user_id,
          repoUrl,
          sseEmitter: null, // no SSE for webhook-triggered rebuilds
        });
        if (result && result.skipped) {
          console.info(`[webhookService] Project ${projectId} rebuild skipped: ${result.reason}`);
        } else {
          console.info(`[webhookService] Project ${projectId} rebuild completed.`);
        }
      } catch (rebuildErr) {
        console.error(`[webhookService] Rebuild crashed for project ${projectId}: ${rebuildErr.message || rebuildErr}`);
        // Force DB back to a sane state so the UI doesn't lie about a
        // container that no longer exists.
        await _reconcileAfterRebuildCrash(projectId);
      }
    });

  } catch (err) {
    console.error('[webhookService.handleGithubWebhook]', err);
    // Only send a response if headers haven't been sent yet
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error:   'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      });
    }
  }
}

module.exports = {
  handleGithubWebhook,
};