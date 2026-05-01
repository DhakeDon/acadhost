'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const db = require('../config/db');
const dockerService = require('../services/dockerService');
const nginxService = require('../services/nginxService');
const buildService = require('../services/buildService');
const storageService = require('../services/storageService');
const portAllocator = require('../utils/portAllocator');
const subdomainValidator = require('../utils/subdomainValidator');
const quotaChecker = require('../utils/quotaChecker');
const zipHandler = require('../utils/zipHandler');
const containerStatsService = require('../services/containerStatsService');
const projectEnvVarService = require('../services/projectEnvVarService');

// ─── POST /api/projects ──────────────────────────────────────────────────────
async function createProject(req, res) {
  try {
    const studentId = req.user.id;
    const {
      title,
      subdomain,
      projectType,
      runtime,
      runtimeVersion,
      sourceType,
      gitUrl,
      gitUrlBackend,
      cpuLimit: cpuLimitRaw,
      ramLimitMb: ramLimitMbRaw,
      databaseId,
    } = req.body;

    // envVars may arrive as a JSON string (multipart form uploads encode
    // everything as strings) or as an already-parsed array when the request
    // is application/json.
    let envVarsInput = req.body.envVars;
    if (typeof envVarsInput === 'string' && envVarsInput.trim().length > 0) {
      try {
        envVarsInput = JSON.parse(envVarsInput);
      } catch (_) {
        return res.status(400).json({
          success: false,
          error: 'ENV_VAR_PAYLOAD_INVALID',
          message: 'envVars must be a valid JSON array',
        });
      }
    }
    if (envVarsInput === undefined || envVarsInput === null || envVarsInput === '') {
      envVarsInput = [];
    }
    if (!Array.isArray(envVarsInput)) {
      return res.status(400).json({
        success: false,
        error: 'ENV_VAR_PAYLOAD_INVALID',
        message: 'envVars must be an array of { key, value } objects',
      });
    }

    // Validate every env var up-front so we can reject before creating the
    // project row / starting a build.
    try {
      const seen = new Set();
      for (const item of envVarsInput) {
        if (!item || typeof item !== 'object') {
          const e = new Error('Each env var must be an object with key and value');
          e.code = 'ENV_VAR_PAYLOAD_INVALID';
          throw e;
        }
        projectEnvVarService.validateKeyValue(item.key, item.value);
        if (seen.has(item.key)) {
          const e = new Error(`Duplicate env var key: ${item.key}`);
          e.code = 'ENV_VAR_KEY_DUPLICATE';
          throw e;
        }
        seen.add(item.key);
      }
    } catch (envErr) {
      return res.status(400).json({
        success: false,
        error: envErr.code || 'ENV_VAR_INVALID',
        message: envErr.message,
      });
    }

    // Check 1: Student must be active
    const [userRows] = await db.execute(
        "SELECT status, cpu_quota, ram_quota_mb, max_projects FROM users WHERE id = ?",
        [studentId]
    );
    if (userRows.length === 0 || userRows[0].status !== 'active') {
      return res.status(403).json({ success: false, error: 'ACCOUNT_INACTIVE', message: 'Account is not active' });
    }

    // Basic required field validation
    if (!title || !subdomain || !projectType || !sourceType) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'title, subdomain, projectType, and sourceType are required' });
    }

    const validProjectTypes = ['frontend', 'backend', 'combined'];
    if (!validProjectTypes.includes(projectType)) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Project type must be frontend, backend, or combined' });
    }

    const validSourceTypes = ['git', 'zip'];
    if (!validSourceTypes.includes(sourceType)) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Source type must be git or zip' });
    }

    // Runtime validation for backend/combined
    if (projectType !== 'frontend') {
      if (!runtime) {
        return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Runtime is required for backend and combined projects' });
      }
      const validRuntimes = ['node', 'python'];
      if (!validRuntimes.includes(runtime)) {
        return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Runtime must be node or python' });
      }
    }

    // Runtime version validation
    const nodeVersions = ['14', '16', '18', '19', '20', '21', '22', '23', '24'];
    const pythonVersions = ['3.8', '3.9', '3.10', '3.11', '3.12', '3.13'];
    let resolvedRuntimeVersion = runtimeVersion;
    if (projectType !== 'frontend') {
      if (runtime === 'node') {
        resolvedRuntimeVersion = runtimeVersion || '20';
        if (!nodeVersions.includes(resolvedRuntimeVersion)) {
          return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid runtime version for node' });
        }
      } else if (runtime === 'python') {
        resolvedRuntimeVersion = runtimeVersion || '3.11';
        if (!pythonVersions.includes(resolvedRuntimeVersion)) {
          return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Invalid runtime version for python' });
        }
      }
    }

    // Git URL validation
    if (sourceType === 'git') {
      if (!gitUrl) {
        return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'gitUrl is required for git source type' });
      }
      if (projectType === 'combined' && !gitUrlBackend) {
        return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'gitUrlBackend is required for combined git projects' });
      }
    }

    // ZIP file validation
    if (sourceType === 'zip') {
      if (projectType === 'combined') {
        if (!req.files || !req.files.zipFileFrontend || !req.files.zipFileBackend) {
          return res.status(400).json({ success: false, error: 'SOURCE_TYPE_MISMATCH', message: 'Combined projects require both sources to use the same source type' });
        }
      } else {
        if (!req.files || !req.files.zipFile) {
          return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'zipFile is required for zip source type' });
        }
      }
    }

    const cpuLimit = cpuLimitRaw !== undefined ? parseFloat(cpuLimitRaw) : 1.00;
    const ramLimitMb = ramLimitMbRaw !== undefined ? parseInt(ramLimitMbRaw, 10) : 512;

    // Check 2: Project quota
    try {
      await quotaChecker.checkProjectQuota(studentId);
    } catch (quotaErr) {
      return res.status(400).json({ success: false, error: quotaErr.code, message: quotaErr.message });
    }

    // Check 3: Subdomain reserved
    if (subdomainValidator.isReserved(subdomain)) {
      return res.status(400).json({ success: false, error: 'SUBDOMAIN_RESERVED', message: `Subdomain '${subdomain}' is reserved` });
    }

    // Check 4: Subdomain uniqueness
    const [existingSubdomain] = await db.execute(
        "SELECT id FROM projects WHERE subdomain = ? AND status != 'deleted'",
        [subdomain]
    );
    if (existingSubdomain.length > 0) {
      let suggestion = null;
      try {
        suggestion = await subdomainValidator.generateRandomSubdomain(subdomain);
      } catch (_) { /* ignore */ }
      return res.status(409).json({
        success: false,
        error: 'SUBDOMAIN_TAKEN',
        message: `Subdomain '${subdomain}' is already in use`,
        suggestedSubdomain: suggestion,
        suggestion, // alias for frontend compatibility
      });
    }

    // Check 5: Subdomain format
    if (!subdomainValidator.isValidSubdomainFormat(subdomain)) {
      return res.status(400).json({ success: false, error: 'SUBDOMAIN_INVALID', message: 'Subdomain must be 3-63 characters, lowercase alphanumeric and hyphens' });
    }

    // Check 6: CPU quota
    try {
      await quotaChecker.checkCpuQuota(studentId, cpuLimit);
    } catch (quotaErr) {
      return res.status(400).json({ success: false, error: quotaErr.code, message: quotaErr.message });
    }

    // Check 7: RAM quota
    try {
      await quotaChecker.checkRamQuota(studentId, ramLimitMb);
    } catch (quotaErr) {
      return res.status(400).json({ success: false, error: quotaErr.code, message: quotaErr.message });
    }

    // Check 8: ZIP file size
    const maxZipMb = parseInt(process.env.MAX_ZIP_UPLOAD_SIZE_MB || '200', 10);
    if (sourceType === 'zip') {
      const filesToCheck = projectType === 'combined'
          ? [req.files.zipFileFrontend[0], req.files.zipFileBackend[0]]
          : [req.files.zipFile[0]];

      for (const f of filesToCheck) {
        if (f.size > maxZipMb * 1024 * 1024) {
          return res.status(400).json({ success: false, error: 'ZIP_TOO_LARGE', message: `ZIP file exceeds maximum size of ${maxZipMb} MB` });
        }
      }
    }

    // Check 9: Database ownership
    if (databaseId) {
      const [dbRows] = await db.execute(
          'SELECT id FROM `databases` WHERE id = ? AND user_id = ?',
          [databaseId, studentId]
      );
      if (dbRows.length === 0) {
        return res.status(404).json({ success: false, error: 'DATABASE_NOT_FOUND', message: 'Database not found' });
      }
    }

    // Check 10: Build concurrency
    const [buildingRows] = await db.execute(
        "SELECT COUNT(*) AS cnt FROM builds WHERE status = 'building'",
        []
    );
    const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_BUILDS || '4', 10);
    if (parseInt(buildingRows[0].cnt, 10) >= maxConcurrent) {
      return res.status(429).json({ success: false, error: 'BUILD_QUEUE_FULL', message: 'Build queue is full. Try again later.' });
    }

    // Allocate port
    const containerPort = await portAllocator.allocatePort();

    // Create project record
    const [insertResult] = await db.execute(
        `INSERT INTO projects
         (user_id, title, subdomain, project_type, runtime, runtime_version,
          source_type, git_url, git_url_backend, container_port,
          cpu_limit, ram_limit_mb, database_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'building')`,
        [
          studentId,
          title,
          subdomain,
          projectType,
          projectType === 'frontend' ? null : runtime,
          projectType === 'frontend' ? null : resolvedRuntimeVersion,
          sourceType,
          sourceType === 'git' ? gitUrl : null,
          sourceType === 'git' && projectType === 'combined' ? gitUrlBackend : null,
          containerPort,
          cpuLimit,
          ramLimitMb,
          databaseId || null,
        ]
    );

    const projectId = insertResult.insertId;

    // Persist custom env vars (encrypted) BEFORE starting the build so that
    // the initial container creation already has them available.
    if (envVarsInput.length > 0) {
      try {
        await projectEnvVarService.replaceAllForProject(projectId, envVarsInput);
      } catch (envErr) {
        console.error(`createProject: env var persistence failed for project ${projectId}:`, envErr);
        // Rollback: mark project as failed; it hasn't been built yet.
        try {
          await db.execute(
              "UPDATE projects SET status = 'failed' WHERE id = ?",
              [projectId]
          );
        } catch (_) {}
        return res.status(400).json({
          success: false,
          error: envErr.code || 'ENV_VAR_INVALID',
          message: envErr.message || 'Failed to save environment variables',
        });
      }
    }

    // Generate webhook secrets for git projects
    if (sourceType === 'git') {
      const webhookSecret = crypto.randomBytes(32).toString('hex');
      let webhookSecretBackend = null;
      if (projectType === 'combined') {
        webhookSecretBackend = crypto.randomBytes(32).toString('hex');
      }
      await db.execute(
          'UPDATE projects SET webhook_secret = ?, webhook_secret_backend = ? WHERE id = ?',
          [webhookSecret, webhookSecretBackend, projectId]
      );
    }

    // Prepare uploaded files map
    let uploadedFiles = null;
    if (sourceType === 'zip') {
      if (projectType === 'combined') {
        uploadedFiles = {
          frontend: req.files.zipFileFrontend[0],
          backend: req.files.zipFileBackend[0],
        };
      } else {
        uploadedFiles = { single: req.files.zipFile[0] };
      }
    }

    // Start async build (non-blocking)
    buildService.startBuild({
      projectId,
      studentId,
      projectType,
      runtime: projectType === 'frontend' ? null : runtime,
      runtimeVersion: projectType === 'frontend' ? null : resolvedRuntimeVersion,
      sourceType,
      gitUrl: sourceType === 'git' ? gitUrl : null,
      gitUrlBackend: sourceType === 'git' && projectType === 'combined' ? gitUrlBackend : null,
      uploadedFiles,
      databaseId: databaseId || null,
      containerPort,
      cpuLimit,
      ramLimitMb,
      subdomain,
    }).catch((err) => {
      console.error(`Build start error for project ${projectId}:`, err);
    });

    return res.status(202).json({
      success: true,
      data: {
        projectId,
        title,
        subdomain,
        status: 'building',
        buildStreamUrl: `/api/projects/${projectId}/build-logs/stream`,
      },
    });
  } catch (err) {
    console.error('createProject error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── GET /api/projects ───────────────────────────────────────────────────────
async function listProjects(req, res) {
  try {
    const studentId = req.user.id;

    const [projects] = await db.execute(
        `SELECT p.id, p.title, p.subdomain, p.project_type, p.runtime,
                p.runtime_version, p.source_type, p.git_url,
                p.status, p.cpu_limit, p.ram_limit_mb, p.database_id,
                p.created_at, p.updated_at
         FROM projects p
         WHERE p.user_id = ? AND p.status != 'deleted'
         ORDER BY p.created_at DESC`,
        [studentId]
    );

    const platformDomain = process.env.PLATFORM_DOMAIN || 'acadhost.com';

    const items = projects.map((p) => ({
      id: p.id,
      title: p.title,
      subdomain: p.subdomain,
      liveUrl: `https://${p.subdomain}.${platformDomain}`,
      projectType: p.project_type,
      runtime: p.runtime || null,
      runtimeVersion: p.runtime_version || null,
      sourceType: p.source_type,
      gitUrl: p.git_url || null,
      status: p.status,
      cpuLimit: parseFloat(p.cpu_limit),
      ramLimitMb: p.ram_limit_mb,
      databaseId: p.database_id || null,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));

    return res.status(200).json({ success: true, data: { items } });
  } catch (err) {
    console.error('listProjects error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── GET /api/projects/:id ───────────────────────────────────────────────────
async function getProject(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    const [rows] = await db.execute(
        `SELECT p.*, d.db_name AS database_name
         FROM projects p
                LEFT JOIN \`databases\` d ON p.database_id = d.id
         WHERE p.id = ? AND p.user_id = ?`,
        [projectId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }

    const p = rows[0];
    const platformDomain = process.env.PLATFORM_DOMAIN || 'acadhost.com';
    const appBaseUrl     = process.env.APP_BASE_URL     || process.env.PLATFORM_URL || 'http://localhost:3000';

    const webhookUrl = p.source_type === 'git' && p.webhook_secret
        ? `${appBaseUrl}/api/webhooks/github/${p.id}`
        : null;

    const webhookUrlBackend = p.source_type === 'git' && p.webhook_secret_backend
        ? `${appBaseUrl}/api/webhooks/github/${p.id}`
        : null;

    return res.status(200).json({
      success: true,
      data: {
        id: p.id,
        title: p.title,
        subdomain: p.subdomain,
        liveUrl: `https://${p.subdomain}.${platformDomain}`,
        projectType: p.project_type,
        runtime: p.runtime || null,
        runtimeVersion: p.runtime_version || null,
        sourceType: p.source_type,
        gitUrl: p.git_url || null,
        gitUrlBackend: p.git_url_backend || null,
        webhookUrl,
        webhookUrlBackend,
        webhookSecret: p.webhook_secret || null,
        webhookSecretBackend: p.webhook_secret_backend || null,
        status: p.status,
        cpuLimit: parseFloat(p.cpu_limit),
        ramLimitMb: p.ram_limit_mb,
        containerPort: p.container_port || null,
        databaseId: p.database_id || null,
        databaseName: p.database_name || null,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      },
    });
  } catch (err) {
    console.error('getProject error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── PUT /api/projects/:id/database ─────────────────────────────────────────
async function switchDatabase(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);
    const { databaseId } = req.body;

    const [rows] = await db.execute(
        'SELECT id, status, container_id, container_port, cpu_limit, ram_limit_mb FROM projects WHERE id = ? AND user_id = ?',
        [projectId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }

    const project = rows[0];

    if (project.status === 'deleted') {
      return res.status(400).json({ success: false, error: 'PROJECT_DELETED', message: 'Cannot modify a deleted project' });
    }

    // Validate database ownership if provided
    let dbRow = null;
    if (databaseId !== null && databaseId !== undefined) {
      const [dbRows] = await db.execute(
          'SELECT id, db_name, db_user, db_password_encrypted FROM `databases` WHERE id = ? AND user_id = ?',
          [databaseId, studentId]
      );
      if (dbRows.length === 0) {
        return res.status(404).json({ success: false, error: 'DATABASE_NOT_FOUND', message: 'Database not found' });
      }
      dbRow = dbRows[0];
    }

    // Update project record first so that even if the container recreation
    // below fails, the DB reflects the intended database association and a
    // subsequent webhook rebuild will pick up the correct credentials.
    await db.execute('UPDATE projects SET database_id = ? WHERE id = ?', [databaseId || null, projectId]);

    // If container is running, recreate with new credentials
    if (project.status === 'running' && project.container_id) {
      // Use buildAllEnvVars so custom project env vars are preserved across
      // the container swap. It re-reads the DB from projects (which we just
      // updated above), so it picks up the new databaseId automatically.
      const envVars = await buildService.buildAllEnvVars(projectId, databaseId || null);

      const cpuLimit   = parseFloat(project.cpu_limit);
      const ramLimitMb = parseInt(project.ram_limit_mb, 10);

      try {
        await dockerService.stopContainer(project.container_id);
        await dockerService.removeContainer(project.container_id);

        const newContainerId = await dockerService.createAndStartContainer(
            projectId,
            project.container_port,
            cpuLimit,
            ramLimitMb,
            envVars
        );

        await db.execute('UPDATE projects SET container_id = ? WHERE id = ?', [newContainerId, projectId]);

      } catch (dockerErr) {
        console.error('switchDatabase: container recreation failed:', dockerErr);
        await db.execute("UPDATE projects SET status = 'failed', container_id = NULL WHERE id = ?", [projectId]);
        return res.status(500).json({
          success: false,
          error: 'CONTAINER_ERROR',
          message: 'Failed to recreate container with new database',
        });
      }
    }

    let databaseName = null;
    if (dbRow) databaseName = dbRow.db_name;

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        databaseId: databaseId || null,
        databaseName,
        message: 'DATABASE_SWITCHED',
      },
    });
  } catch (err) {
    console.error('switchDatabase error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── PUT /api/projects/:id/resources ─────────────────────────────────────────
async function updateResources(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);
    const { cpuLimit, ramLimitMb } = req.body;

    if (cpuLimit === undefined && ramLimitMb === undefined) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'At least one resource field is required' });
    }

    const [rows] = await db.execute(
        'SELECT id, status, container_id, container_port, cpu_limit, ram_limit_mb, database_id FROM projects WHERE id = ? AND user_id = ?',
        [projectId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }

    const project = rows[0];

    if (project.status === 'deleted') {
      return res.status(400).json({ success: false, error: 'PROJECT_DELETED', message: 'Cannot modify a deleted project' });
    }

    // Quota checks with excludeProjectId
    if (cpuLimit !== undefined) {
      if (parseFloat(cpuLimit) <= 0) {
        return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'CPU limit must be positive' });
      }
      try {
        await quotaChecker.checkCpuQuota(studentId, parseFloat(cpuLimit), projectId);
      } catch (quotaErr) {
        return res.status(400).json({ success: false, error: quotaErr.code, message: quotaErr.message });
      }
    }

    if (ramLimitMb !== undefined) {
      if (parseInt(ramLimitMb, 10) <= 0) {
        return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'RAM limit must be positive' });
      }
      try {
        await quotaChecker.checkRamQuota(studentId, parseInt(ramLimitMb, 10), projectId);
      } catch (quotaErr) {
        return res.status(400).json({ success: false, error: quotaErr.code, message: quotaErr.message });
      }
    }

    const newCpuLimit = cpuLimit !== undefined ? parseFloat(cpuLimit) : parseFloat(project.cpu_limit);
    const newRamLimitMb = ramLimitMb !== undefined ? parseInt(ramLimitMb, 10) : project.ram_limit_mb;

    // Update DB record
    await db.execute(
        'UPDATE projects SET cpu_limit = ?, ram_limit_mb = ? WHERE id = ?',
        [newCpuLimit, newRamLimitMb, projectId]
    );

    // Apply to running container
    if (project.status === 'running' && project.container_id) {
      let updated = false;
      try {
        await dockerService.updateContainerResources(project.container_id, newCpuLimit, newRamLimitMb);
        updated = true;
      } catch (updateErr) {
        console.warn('docker update failed, falling back to container recreation:', updateErr.message);
      }

      if (!updated) {
        // Fallback: recreate container
        try {
          const envVars = await buildService.buildAllEnvVars(projectId, project.database_id || null);
          await dockerService.stopContainer(project.container_id);
          await dockerService.removeContainer(project.container_id);
          const newContainerId = await dockerService.createAndStartContainer(
              projectId,
              project.container_port,
              newCpuLimit,
              newRamLimitMb,
              envVars
          );
          await db.execute('UPDATE projects SET container_id = ? WHERE id = ?', [newContainerId, projectId]);
        } catch (recreateErr) {
          console.error('updateResources: container recreation failed:', recreateErr);
          await db.execute("UPDATE projects SET status = 'failed', container_id = NULL WHERE id = ?", [projectId]);
          return res.status(500).json({ success: false, error: 'CONTAINER_ERROR', message: 'Failed to recreate container with new resources' });
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        cpuLimit: newCpuLimit,
        ramLimitMb: newRamLimitMb,
        message: 'RESOURCES_UPDATED',
      },
    });
  } catch (err) {
    console.error('updateResources error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── GET /api/projects/:id/logs ──────────────────────────────────────────────
async function getLogs(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);
    const tail = parseInt(req.query.tail || '100', 10);

    const [rows] = await db.execute(
        'SELECT id, status, container_id FROM projects WHERE id = ? AND user_id = ?',
        [projectId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }

    const project = rows[0];

    if (!project.container_id) {
      return res.status(400).json({ success: false, error: 'CONTAINER_NOT_RUNNING', message: 'No running container for this project' });
    }

    const logs = await dockerService.getContainerLogs(project.container_id, tail);

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        logs,
      },
    });
  } catch (err) {
    console.error('getLogs error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── GET /api/projects/:id/build-logs/stream (SSE) ──────────────────────────
async function streamBuildLogs(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    const [rows] = await db.execute(
        'SELECT id, status FROM projects WHERE id = ? AND user_id = ?',
        [projectId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    function sendEvent(eventType, data) {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${data}\n`);
      res.write('\n');
    }

    const [buildRows] = await db.execute(
        "SELECT id, status, log_file_path FROM builds WHERE project_id = ? ORDER BY started_at DESC LIMIT 1",
        [projectId]
    );

    if (buildRows.length === 0) {
      sendEvent('complete', JSON.stringify({ status: 'no_builds', message: 'No build history found' }));
      return res.end();
    }

    const latestBuild = buildRows[0];

    if (latestBuild.status === 'building') {
      const buildEmitter = buildService.getBuildEmitter(projectId);

      if (!buildEmitter) {
        sendEvent('status', latestBuild.status);
        sendEvent('complete', JSON.stringify({ status: 'building', message: 'Build in progress but stream not available' }));
        return res.end();
      }

      const onLog = (line) => sendEvent('log', line);
      const onStatus = (status) => sendEvent('status', status);
      const onComplete = (result) => {
        sendEvent('complete', JSON.stringify(result));
        res.end();
        buildEmitter.off('log', onLog);
        buildEmitter.off('status', onStatus);
        buildEmitter.off('complete', onComplete);
      };

      buildEmitter.on('log', onLog);
      buildEmitter.on('status', onStatus);
      buildEmitter.on('complete', onComplete);

      req.on('close', () => {
        buildEmitter.off('log', onLog);
        buildEmitter.off('status', onStatus);
        buildEmitter.off('complete', onComplete);
      });
    } else {
      const logFilePath = path.join(
          process.env.PROJECTS_BASE_DIR,
          String(studentId),
          String(projectId),
          'build',
          'logs',
          latestBuild.log_file_path.split('/').pop()
      );

      try {
        if (fs.existsSync(logFilePath)) {
          const logContent = fs.readFileSync(logFilePath, 'utf8');
          const lines = logContent.split('\n');
          for (const line of lines) {
            if (line.trim()) sendEvent('log', line);
          }
        }
      } catch (fsErr) {
        sendEvent('log', 'Log file not available');
      }

      sendEvent('status', latestBuild.status);
      sendEvent('complete', JSON.stringify({ status: latestBuild.status }));
      return res.end();
    }
  } catch (err) {
    console.error('streamBuildLogs error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
    res.end();
  }
}

// ─── GET /api/projects/:id/build-logs ────────────────────────────────────────
async function getBuildLogs(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    const [projRows] = await db.execute(
        'SELECT id FROM projects WHERE id = ? AND user_id = ?',
        [projectId, studentId]
    );

    if (projRows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }

    const [buildRows] = await db.execute(
        'SELECT id, status, log_file_path, started_at, completed_at FROM builds WHERE project_id = ? ORDER BY started_at DESC LIMIT 1',
        [projectId]
    );

    if (buildRows.length === 0) {
      return res.status(404).json({ success: false, error: 'NO_BUILDS_FOUND', message: 'No build history found for this project' });
    }

    const build = buildRows[0];
    const logFileName = build.log_file_path.split('/').pop();
    const logFilePath = path.join(
        process.env.PROJECTS_BASE_DIR,
        String(studentId),
        String(projectId),
        'build',
        'logs',
        logFileName
    );

    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ success: false, error: 'BUILD_LOG_EXPIRED', message: 'Build log has expired and been removed' });
    }

    const logs = fs.readFileSync(logFilePath, 'utf8');

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        buildId: build.id,
        status: build.status,
        startedAt: build.started_at,
        completedAt: build.completed_at,
        logs,
      },
    });
  } catch (err) {
    console.error('getBuildLogs error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── GET /api/projects/:id/storage ───────────────────────────────────────────
async function getStorageUsage(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    const [rows] = await db.execute(
        'SELECT id FROM projects WHERE id = ? AND user_id = ?',
        [projectId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }

    const usage = await storageService.calculateProjectStorageUsage(studentId, projectId);

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        storageUsedMb: usage.totalMb,
        breakdown: usage.breakdown,
      },
    });
  } catch (err) {
    console.error('getStorageUsage error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/projects/:id/restart ─────────────────────────────────────────
async function restartProject(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    const [rows] = await db.execute(
        'SELECT id, status, container_id FROM projects WHERE id = ? AND user_id = ?',
        [projectId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }

    const project = rows[0];

    if (project.status === 'deleted') {
      return res.status(400).json({ success: false, error: 'PROJECT_DELETED', message: 'Cannot restart a deleted project' });
    }

    if (project.status === 'building') {
      return res.status(400).json({ success: false, error: 'PROJECT_BUILDING', message: 'Cannot restart a project that is currently building' });
    }

    if (!project.container_id) {
      return res.status(400).json({ success: false, error: 'CONTAINER_NOT_FOUND', message: 'No container exists for this project' });
    }

    await dockerService.restartContainer(project.container_id);
    await db.execute("UPDATE projects SET status = 'running' WHERE id = ?", [projectId]);

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        status: 'running',
        message: 'PROJECT_RESTARTED',
      },
    });
  } catch (err) {
    console.error('restartProject error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/projects/:id/stop ─────────────────────────────────────────────
async function stopProject(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    const [rows] = await db.execute(
        'SELECT id, status, container_id FROM projects WHERE id = ? AND user_id = ?',
        [projectId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }

    const project = rows[0];

    if (project.status === 'stopped' || project.status === 'failed') {
      return res.status(400).json({ success: false, error: 'PROJECT_ALREADY_STOPPED', message: 'Project is already stopped' });
    }

    if (project.status === 'deleted') {
      return res.status(400).json({ success: false, error: 'PROJECT_DELETED', message: 'Cannot stop a deleted project' });
    }

    if (project.status === 'building') {
      return res.status(400).json({ success: false, error: 'PROJECT_BUILDING', message: 'Cannot stop a project that is currently building' });
    }

    if (project.container_id) {
      await dockerService.stopContainer(project.container_id);
    }

    await db.execute("UPDATE projects SET status = 'stopped' WHERE id = ?", [projectId]);

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        status: 'stopped',
        message: 'PROJECT_STOPPED',
      },
    });
  } catch (err) {
    console.error('stopProject error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── DELETE /api/projects/:id ────────────────────────────────────────────────
async function deleteProject(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    const [rows] = await db.execute(
        'SELECT id, status, container_id, subdomain FROM projects WHERE id = ? AND user_id = ?',
        [projectId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }

    const project = rows[0];

    if (project.status === 'deleted') {
      return res.status(400).json({ success: false, error: 'PROJECT_ALREADY_DELETED', message: 'Project has already been deleted' });
    }

    await _performProjectCleanup(projectId, studentId, project);

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        message: 'PROJECT_DELETED',
      },
    });
  } catch (err) {
    console.error('deleteProject error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── Internal helper: perform project cleanup ────────────────────────────────
async function _performProjectCleanup(projectId, studentId, project) {
  if (project.container_id) {
    try {
      await dockerService.stopContainer(project.container_id);
    } catch (err) {
      console.warn(`Cleanup: stop container ${project.container_id} failed:`, err.message);
    }

    try {
      await dockerService.removeContainer(project.container_id);
    } catch (err) {
      console.warn(`Cleanup: remove container ${project.container_id} failed:`, err.message);
    }
  }

  try {
    await dockerService.removeImage(`acadhost/project-${projectId}:latest`);
  } catch (err) {
    console.warn(`Cleanup: remove image for project ${projectId} failed:`, err.message);
  }

  if (project.subdomain && !project.subdomain.startsWith('_deleted_')) {
    try {
      await nginxService.removeProjectConfig(project.subdomain);
    } catch (err) {
      console.warn(`Cleanup: remove nginx config for ${project.subdomain} failed:`, err.message);
    }
  }

  try {
    await storageService.deleteProjectDirectory(studentId, projectId);
  } catch (err) {
    console.warn(`Cleanup: delete project directory for ${projectId} failed:`, err.message);
  }

  // Explicitly delete custom env vars. The FK on project_env_vars is
  // ON DELETE CASCADE, and because this is a soft-delete (the projects row
  // is kept around with status='deleted'), the cascade never fires — so we
  // delete here explicitly. Belt-and-suspenders.
  try {
    const deleted = await projectEnvVarService.deleteAllForProject(projectId);
    if (deleted > 0) {
      console.info(`Cleanup: removed ${deleted} custom env var(s) for project ${projectId}`);
    }
  } catch (err) {
    console.warn(`Cleanup: delete env vars for project ${projectId} failed:`, err.message);
  }

  await db.execute(
      "UPDATE projects SET container_id = NULL, container_port = NULL, subdomain = ?, status = 'deleted' WHERE id = ?",
      [`_deleted_${projectId}`, projectId]
  );
}

// ─── GET /api/projects/check-subdomain ─────────────────────────────────────
// FIX: the frontend sends ?subdomain=... (legacy) while the backend was
// reading only ?name=. We accept BOTH parameter names. Also never return 400
// for an empty/missing value — return {available:false, reason:'empty'}
// so the UI can show a friendly hint.
async function checkSubdomainAvailability(req, res) {
  try {
    // Accept either ?name= or ?subdomain= so both old and new frontend
    // callers work without coordination.
    const raw = (req.query.name || req.query.subdomain || '').toString().trim().toLowerCase();

    if (!raw) {
      return res.status(200).json({
        success: true,
        data: { available: false, reason: 'empty' },
      });
    }

    if (subdomainValidator.isReserved(raw)) {
      return res.status(200).json({
        success: true,
        data: { available: false, reason: 'reserved' },
      });
    }

    if (!subdomainValidator.isValidSubdomainFormat(raw)) {
      return res.status(200).json({
        success: true,
        data: { available: false, reason: 'invalid_format' },
      });
    }

    const [rows] = await db.execute(
        "SELECT id FROM projects WHERE subdomain = ? AND status != 'deleted'",
        [raw]
    );

    if (rows.length > 0) {
      // Try to generate a suggestion; never let this block the response.
      let suggestion = null;
      try {
        if (typeof subdomainValidator.generateRandomSubdomain === 'function') {
          suggestion = await subdomainValidator.generateRandomSubdomain(raw);
        }
      } catch (_) { /* ignore */ }

      return res.status(200).json({
        success: true,
        data: { available: false, reason: 'taken', suggestion },
      });
    }

    return res.status(200).json({
      success: true,
      data: { available: true },
    });

  } catch (err) {
    console.error('checkSubdomainAvailability error:', err);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  }
}

function containerNameFor(projectId) {
  return `acadhost-project-${projectId}`;
}

// ─── GET /api/projects/:id/stats ─────────────────────────────────────────────
async function getStats(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid project ID',
      });
    }

    const [rows] = await db.execute(
        "SELECT id, status, container_id FROM projects WHERE id = ? AND user_id = ? AND status != 'deleted'",
        [projectId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }

    const proj = rows[0];

    if (proj.status !== 'running') {
      return res.status(200).json({
        success: true,
        data: { running: false, reason: 'CONTAINER_NOT_RUNNING' },
      });
    }

    const stats = await containerStatsService.getContainerStats(
        containerNameFor(proj.id)
    );

    return res.status(200).json({ success: true, data: stats });
  } catch (err) {
    console.error('getStats error:', err);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  }
}

// ─── GET /api/projects/:id/webhook ───────────────────────────────────────────
async function getWebhookInfo(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid project ID',
      });
    }

    const [rows] = await db.execute(
        `SELECT id, source_type, project_type,
              git_url, webhook_secret,
              git_url_backend, webhook_secret_backend
         FROM projects
        WHERE id = ? AND user_id = ? AND status != 'deleted'
        LIMIT 1`,
        [projectId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }

    const proj = rows[0];

    if (proj.source_type !== 'git') {
      return res.status(400).json({
        success: false,
        error: 'WEBHOOK_NOT_APPLICABLE',
        message: 'Webhooks are only available for Git-based projects',
      });
    }

    const ngrokUrl    = (process.env.Ngrok || '').replace(/\/$/, '');
    const platformUrl = (process.env.PLATFORM_URL || `http://localhost:${process.env.BACKEND_PORT || 3000}`).replace(/\/$/, '');
    const publicUrl   = ngrokUrl || platformUrl;

    const entries = [];

    if (proj.project_type === 'combined' && proj.git_url_backend) {
      entries.push({
        role:   'frontend',
        url:    `${publicUrl}/api/webhooks/github/${proj.id}`,
        secret: proj.webhook_secret || '',
        gitUrl: proj.git_url || '',
      });
      entries.push({
        role:   'backend',
        url:    `${publicUrl}/api/webhooks/github/${proj.id}`,
        secret: proj.webhook_secret_backend || '',
        gitUrl: proj.git_url_backend,
      });
    } else {
      entries.push({
        role:   'single',
        url:    `${publicUrl}/api/webhooks/github/${proj.id}`,
        secret: proj.webhook_secret || '',
        gitUrl: proj.git_url || '',
      });
    }

    return res.status(200).json({
      success: true,
      data: { projectId: proj.id, entries },
    });
  } catch (err) {
    console.error('getWebhookInfo error:', err);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  }
}

function dockerInspect(containerName) {
  return new Promise((resolve) => {
    const proc = spawn('docker', [
      'inspect', '-f', '{{.State.Status}}', containerName,
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString('utf8'); });
    proc.stderr.on('data', d => { stderr += d.toString('utf8'); });

    const timeout = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      resolve({ exists: false, error: 'timeout' });
    }, 5000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        return resolve({ exists: false, error: stderr.trim() });
      }
      const status = stdout.trim();
      resolve({
        exists:  true,
        status,
        running: status === 'running',
      });
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      resolve({ exists: false, error: 'docker_unavailable' });
    });
  });
}

// ─── GET /api/projects/:id/health ────────────────────────────────────────────
async function getProjectHealth(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid project ID',
      });
    }

    const [projRows] = await db.execute(
        "SELECT id, status, container_id FROM projects WHERE id = ? AND user_id = ? AND status != 'deleted'",
        [projectId, studentId]
    );
    if (projRows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }
    const proj = projRows[0];

    const [buildRows] = await db.execute(
        "SELECT id, status, started_at, completed_at FROM builds WHERE project_id = ? ORDER BY started_at DESC LIMIT 1",
        [projectId]
    );
    const latestBuild = buildRows[0] || null;

    const containerName = `acadhost-project-${proj.id}`;
    const dockerState = await dockerInspect(containerName);

    const issues = [];
    const buildAgeSec = latestBuild && latestBuild.status === 'building'
        ? Math.round((Date.now() - new Date(latestBuild.started_at).getTime()) / 1000)
        : null;

    const timeoutMin = parseInt(process.env.BUILD_TIMEOUT_MINUTES || '10', 10);
    const stuckThresholdSec = timeoutMin * 60 * 2;

    if (latestBuild && latestBuild.status === 'building' && buildAgeSec > stuckThresholdSec) {
      issues.push({
        code:       'BUILD_STUCK',
        severity:   'error',
        message:    `Build #${latestBuild.id} has been marked "building" for ${Math.floor(buildAgeSec / 60)} minutes (timeout is ${timeoutMin}m). It likely crashed silently during container swap.`,
        canAutoFix: true,
      });
    }

    if (proj.status === 'running' && !dockerState.exists) {
      issues.push({
        code:       'CONTAINER_MISSING',
        severity:   'error',
        message:    'Database says this project is running, but no container exists on the host. The previous container was probably stopped during a rebuild that never completed.',
        canAutoFix: true,
      });
    }

    if (proj.status === 'running' && dockerState.exists && !dockerState.running) {
      issues.push({
        code:       'CONTAINER_STOPPED',
        severity:   'warning',
        message:    `Container exists but is in state "${dockerState.status}". It may have crashed.`,
        canAutoFix: false,
      });
    }

    if (proj.container_id && dockerState.exists === false) {
      issues.push({
        code:       'CONTAINER_ID_STALE',
        severity:   'info',
        message:    'The container_id stored in the database no longer exists on the host.',
        canAutoFix: true,
      });
    }

    let summary = 'healthy';
    if (issues.some(i => i.code === 'BUILD_STUCK'))            summary = 'stuck_building';
    else if (issues.some(i => i.code === 'CONTAINER_MISSING')) summary = 'container_missing';
    else if (issues.length > 0)                                summary = 'desync';

    return res.status(200).json({
      success: true,
      data: {
        db: {
          projectStatus:         proj.status,
          latestBuildStatus:     latestBuild?.status || null,
          latestBuildStartedAt:  latestBuild?.started_at || null,
          latestBuildAgeSeconds: buildAgeSec,
          containerIdOnRecord:   proj.container_id || null,
        },
        docker: {
          containerExists:  dockerState.exists,
          containerRunning: dockerState.running || false,
          containerState:   dockerState.status || null,
        },
        issues,
        summary,
      },
    });
  } catch (err) {
    console.error('getProjectHealth error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/projects/:id/recover ──────────────────────────────────────────
async function recoverProject(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid project ID',
      });
    }

    const [projRows] = await db.execute(
        "SELECT id, status, container_id FROM projects WHERE id = ? AND user_id = ? AND status != 'deleted'",
        [projectId, studentId]
    );
    if (projRows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }
    const proj = projRows[0];

    const actions = [];

    const timeoutMin = parseInt(process.env.BUILD_TIMEOUT_MINUTES || '10', 10);
    const [stuckBuilds] = await db.execute(
        `UPDATE builds
          SET status = 'failed',
              completed_at = NOW()
        WHERE project_id = ?
          AND status = 'building'
          AND started_at < NOW() - INTERVAL ? MINUTE`,
        [projectId, timeoutMin * 2]
    );
    if (stuckBuilds.affectedRows > 0) {
      actions.push(`Marked ${stuckBuilds.affectedRows} stuck build(s) as failed.`);
    }

    const containerName = `acadhost-project-${proj.id}`;
    const dockerState = await dockerInspect(containerName);

    if (proj.status === 'running' && !dockerState.exists) {
      await db.execute(
          "UPDATE projects SET status = 'stopped', container_id = NULL WHERE id = ?",
          [projectId]
      );
      actions.push('No container found on host — project status reset to "stopped". You can now click Restart to redeploy.');
    } else if (proj.container_id && !dockerState.exists) {
      await db.execute(
          'UPDATE projects SET container_id = NULL WHERE id = ?',
          [projectId]
      );
      actions.push('Cleared stale container_id from database.');
    }

    if (actions.length === 0) {
      actions.push('No recoverable issues detected. State is consistent with Docker.');
    }

    return res.status(200).json({
      success: true,
      data: { projectId, actions },
    });
  } catch (err) {
    console.error('recoverProject error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CUSTOM PROJECT ENVIRONMENT VARIABLES
// ════════════════════════════════════════════════════════════════════════════

// Resolve an accessible, non-deleted project that belongs to the student.
// Returns the project row or null.
async function _getOwnedProject(projectId, studentId, includeForModify = false) {
  const cols = includeForModify
      ? 'id, status, container_id, container_port, cpu_limit, ram_limit_mb, database_id'
      : 'id, status';
  const [rows] = await db.execute(
      `SELECT ${cols} FROM projects WHERE id = ? AND user_id = ?`,
      [projectId, studentId]
  );
  return rows.length > 0 ? rows[0] : null;
}

// ─── GET /api/projects/:id/env-vars ──────────────────────────────────────
async function listEnvVars(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    const project = await _getOwnedProject(projectId, studentId);
    if (!project) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }
    if (project.status === 'deleted') {
      return res.status(400).json({ success: false, error: 'PROJECT_DELETED', message: 'Cannot read env vars of a deleted project' });
    }

    const items = await projectEnvVarService.listForProject(projectId);
    return res.status(200).json({
      success: true,
      data: {
        projectId,
        items,
        reserved: projectEnvVarService.RESERVED_ENV_KEYS,
        maxValueLength: projectEnvVarService.MAX_VALUE_LENGTH,
      },
    });
  } catch (err) {
    console.error('listEnvVars error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/projects/:id/env-vars ─────────────────────────────────────
// Bulk replace. Body: { items: [{ key, value }, ...] }
// If the container is running, recreates it so the new vars apply immediately.
async function replaceEnvVars(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    const project = await _getOwnedProject(projectId, studentId, true);
    if (!project) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }
    if (project.status === 'deleted') {
      return res.status(400).json({ success: false, error: 'PROJECT_DELETED', message: 'Cannot modify a deleted project' });
    }
    if (project.status === 'building') {
      return res.status(400).json({ success: false, error: 'PROJECT_BUILDING', message: 'Cannot modify env vars while the project is building' });
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [];

    try {
      await projectEnvVarService.replaceAllForProject(projectId, items);
    } catch (envErr) {
      return res.status(400).json({
        success: false,
        error: envErr.code || 'ENV_VAR_INVALID',
        message: envErr.message || 'Invalid environment variables',
      });
    }

    // If the container is currently running, recreate it so the new env
    // vars take effect immediately. Same behaviour as switchDatabase.
    let containerRecreated = false;
    if (project.status === 'running' && project.container_id) {
      try {
        const envVars    = await buildService.buildAllEnvVars(projectId, project.database_id || null);
        const cpuLimit   = parseFloat(project.cpu_limit);
        const ramLimitMb = parseInt(project.ram_limit_mb, 10);

        await dockerService.stopContainer(project.container_id);
        await dockerService.removeContainer(project.container_id);

        const newContainerId = await dockerService.createAndStartContainer(
            projectId,
            project.container_port,
            cpuLimit,
            ramLimitMb,
            envVars
        );
        await db.execute('UPDATE projects SET container_id = ? WHERE id = ?', [newContainerId, projectId]);
        containerRecreated = true;
      } catch (dockerErr) {
        console.error('replaceEnvVars: container recreation failed:', dockerErr);
        await db.execute("UPDATE projects SET status = 'failed', container_id = NULL WHERE id = ?", [projectId]);
        return res.status(500).json({
          success: false,
          error: 'CONTAINER_ERROR',
          message: 'Variables were saved, but the container failed to restart. Use Recover then Restart.',
        });
      }
    }

    const latest = await projectEnvVarService.listForProject(projectId);
    return res.status(200).json({
      success: true,
      data: {
        projectId,
        items: latest,
        containerRecreated,
        appliedOnNextDeploy: !containerRecreated,
        message: 'ENV_VARS_UPDATED',
      },
    });
  } catch (err) {
    console.error('replaceEnvVars error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── PUT /api/projects/:id/env-vars/:envId ───────────────────────────────
async function updateEnvVar(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);
    const envId     = parseInt(req.params.envId, 10);
    const { key, value } = req.body;

    const project = await _getOwnedProject(projectId, studentId);
    if (!project) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }
    if (project.status === 'deleted') {
      return res.status(400).json({ success: false, error: 'PROJECT_DELETED', message: 'Cannot modify a deleted project' });
    }

    let updated;
    try {
      updated = await projectEnvVarService.updateOne(projectId, envId, key, value);
    } catch (envErr) {
      return res.status(400).json({
        success: false,
        error: envErr.code || 'ENV_VAR_INVALID',
        message: envErr.message,
      });
    }
    if (!updated) {
      return res.status(404).json({ success: false, error: 'ENV_VAR_NOT_FOUND', message: 'Environment variable not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        item: updated,
        appliedOnNextDeploy: true,
        message: 'ENV_VAR_UPDATED',
      },
    });
  } catch (err) {
    console.error('updateEnvVar error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── DELETE /api/projects/:id/env-vars/:envId ────────────────────────────
async function deleteEnvVar(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);
    const envId     = parseInt(req.params.envId, 10);

    const project = await _getOwnedProject(projectId, studentId);
    if (!project) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }
    if (project.status === 'deleted') {
      return res.status(400).json({ success: false, error: 'PROJECT_DELETED', message: 'Cannot modify a deleted project' });
    }

    const ok = await projectEnvVarService.deleteOne(projectId, envId);
    if (!ok) {
      return res.status(404).json({ success: false, error: 'ENV_VAR_NOT_FOUND', message: 'Environment variable not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        envId,
        appliedOnNextDeploy: true,
        message: 'ENV_VAR_DELETED',
      },
    });
  } catch (err) {
    console.error('deleteEnvVar error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── GET /api/projects/:id/injected-env ──────────────────────────────────
// Read-only list of env vars auto-injected by the platform.
// - DB_* (when a database is attached): real values returned (except DB_PASSWORD masked)
async function getInjectedEnv(req, res) {
  try {
    const studentId = req.user.id;
    const projectId = parseInt(req.params.id, 10);

    const [rows] = await db.execute(
        `SELECT p.id, p.database_id, d.db_name, d.db_user
           FROM projects p
           LEFT JOIN \`databases\` d ON p.database_id = d.id
          WHERE p.id = ? AND p.user_id = ? AND p.status != 'deleted'`,
        [projectId, studentId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }
    const p = rows[0];
    const attached = !!p.database_id;

    // DB_PASSWORD is NEVER returned — only shown as a masked placeholder so
    // the student knows the env var *name* to use. The real password is
    // injected into the container at runtime only.
    const injected = attached ? [
      { key: 'DB_HOST',     value: 'host.docker.internal',             sensitive: false, note: 'Reach the host MySQL server from inside the container' },
      { key: 'DB_PORT',     value: process.env.MYSQL_PORT || '3306',   sensitive: false, note: 'MySQL server port' },
      { key: 'DB_USER',     value: p.db_user,                          sensitive: false, note: 'Restricted MySQL user scoped to your database' },
      { key: 'DB_PASSWORD', value: '••••••••',                         sensitive: true,  note: 'Auto-injected at runtime; never exposed via API' },
      { key: 'DB_NAME',     value: p.db_name,                          sensitive: false, note: 'Your MySQL schema name' },
    ] : [];

    return res.status(200).json({
      success: true,
      data: {
        projectId,
        databaseAttached: attached,
        injected,
        usageExamples: {
          node:   "const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;",
          python: "import os\nDB_HOST = os.environ['DB_HOST']\nDB_PORT = os.environ['DB_PORT']\nDB_USER = os.environ['DB_USER']\nDB_PASSWORD = os.environ['DB_PASSWORD']\nDB_NAME = os.environ['DB_NAME']",
        },
      },
    });
  } catch (err) {
    console.error('getInjectedEnv error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

module.exports = {
  createProject,
  listProjects,
  getProject,
  switchDatabase,
  updateResources,
  getLogs,
  streamBuildLogs,
  getBuildLogs,
  getStorageUsage,
  restartProject,
  stopProject,
  deleteProject,
  _performProjectCleanup,
  checkSubdomainAvailability,
  getStats,
  getWebhookInfo,
  getProjectHealth,
  recoverProject,
  // Custom env vars
  listEnvVars,
  replaceEnvVars,
  updateEnvVar,
  deleteEnvVar,
  getInjectedEnv,
};