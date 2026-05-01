'use strict';

const bcrypt = require('bcrypt');
const db = require('../config/db');
const tokenHelper = require('../utils/tokenHelper');
const emailService = require('../services/emailService');
const dockerService = require('../services/dockerService');
const nginxService = require('../services/nginxService');
const storageService = require('../services/storageService');
const databaseProvisioningService = require('../services/databaseProvisioningService');
const { _performProjectCleanup } = require('./projectController');

// ─── Duration string → milliseconds helper ──────────────────────────────────
// Parses jsonwebtoken duration strings like '2h', '30m', '7d' into milliseconds.
// Used to align invite_tokens.expires_at with the JWT expiry time.
function durationToMs(str) {
  const n    = parseInt(str, 10);
  const unit = str.slice(-1);
  const map  = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, y: 31536000000 };
  return n * (map[unit] || 3600000);
}

// ─── GET /api/admin/metrics ──────────────────────────────────────────────────
async function getMetrics(req, res) {
  try {
    const [liveProjects] = await db.execute(
        "SELECT COUNT(*) AS cnt FROM projects WHERE status = 'running'"
    );

    const [totalStudents] = await db.execute(
        "SELECT COUNT(*) AS cnt FROM users WHERE role = 'student' AND status = 'active'"
    );

    const [cpuRows] = await db.execute(
        "SELECT COALESCE(SUM(cpu_limit), 0) AS total FROM projects WHERE status = 'running'"
    );

    const [ramRows] = await db.execute(
        "SELECT COALESCE(SUM(ram_limit_mb), 0) AS total FROM projects WHERE status = 'running'"
    );

    const [allocCpuRows] = await db.execute(
        "SELECT COALESCE(SUM(cpu_quota), 0) AS total FROM users WHERE role = 'student' AND status = 'active'"
    );

    const [allocRamRows] = await db.execute(
        "SELECT COALESCE(SUM(ram_quota_mb), 0) AS total FROM users WHERE role = 'student' AND status = 'active'"
    );

    const [allocStorageRows] = await db.execute(
        "SELECT COALESCE(SUM(storage_quota_mb), 0) AS total FROM users WHERE role = 'student' AND status = 'active'"
    );

    const [pendingReqs] = await db.execute(
        "SELECT COUNT(*) AS cnt FROM resource_requests WHERE status = 'pending'"
    );

    // Aggregate storage from disk (per active student)
    const [activeStudents] = await db.execute(
        "SELECT id FROM users WHERE role = 'student' AND status = 'active'"
    );

    let aggregateStorageUsedMb = 0;
    for (const student of activeStudents) {
      try {
        const usage = await storageService.calculateStudentStorageUsage(student.id);
        aggregateStorageUsedMb += usage;
      } catch (_) { /* ignore individual failures */ }
    }

    return res.status(200).json({
      success: true,
      data: {
        totalLiveProjects: parseInt(liveProjects[0].cnt, 10),
        totalStudents: parseInt(totalStudents[0].cnt, 10),
        aggregateCpuUsed: parseFloat(cpuRows[0].total) || 0,
        aggregateRamUsedMb: parseInt(ramRows[0].total, 10) || 0,
        aggregateStorageUsedMb: Math.round(aggregateStorageUsedMb * 10) / 10,
        totalCpuAllocated: parseFloat(allocCpuRows[0].total) || 0,
        totalRamAllocatedMb: parseInt(allocRamRows[0].total, 10) || 0,
        totalStorageAllocatedMb: parseInt(allocStorageRows[0].total, 10) || 0,
        pendingResourceRequests: parseInt(pendingReqs[0].cnt, 10),
      },
    });
  } catch (err) {
    console.error('getMetrics error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── GET /api/admin/students ─────────────────────────────────────────────────
async function listStudents(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const { status, batchYear, search } = req.query;

    let whereClause = "WHERE u.role = 'student'";
    const params = [];

    if (status) {
      whereClause += ' AND u.status = ?';
      params.push(status);
    }
    if (batchYear) {
      whereClause += ' AND u.batch_year = ?';
      params.push(parseInt(batchYear, 10));
    }
    if (search) {
      whereClause += ' AND (u.name LIKE ? OR u.email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS cnt FROM users u ${whereClause}`,
        params
    );
    const totalItems = parseInt(countRows[0].cnt, 10);
    const safeLimit = Number.isInteger(limit) ? limit : 20;
    const safeOffset = Number.isInteger(offset) ? offset : 0;

    const [students] = await db.execute(
        `SELECT u.id, u.email, u.name, u.role, u.batch_year, u.status,
                u.cpu_quota, u.ram_quota_mb, u.storage_quota_mb, u.max_projects, u.max_databases,
                u.created_at
         FROM users u ${whereClause}
         ORDER BY u.created_at DESC
           LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        params
    );

    const items = await Promise.all(
        students.map(async (student) => {
          const [cpuRows] = await db.execute(
              "SELECT COALESCE(SUM(cpu_limit), 0) AS cpu_used FROM projects WHERE user_id = ? AND status != 'deleted'",
              [student.id]
          );
          const [ramRows] = await db.execute(
              "SELECT COALESCE(SUM(ram_limit_mb), 0) AS ram_used FROM projects WHERE user_id = ? AND status != 'deleted'",
              [student.id]
          );
          const [projRows] = await db.execute(
              "SELECT COUNT(*) AS cnt FROM projects WHERE user_id = ? AND status != 'deleted'",
              [student.id]
          );
          const [dbRows] = await db.execute(
              'SELECT COUNT(*) AS cnt FROM `databases` WHERE user_id = ?',
              [student.id]
          );

          return {
            id: student.id,
            email: student.email,
            name: student.name,
            role: student.role,
            batchYear: student.batch_year || null,
            status: student.status,
            cpuQuota: parseFloat(student.cpu_quota),
            ramQuotaMb: student.ram_quota_mb,
            storageQuotaMb: student.storage_quota_mb,
            maxProjects: student.max_projects,
            maxDatabases: student.max_databases,
            cpuUsed: parseFloat(cpuRows[0].cpu_used) || 0,
            ramUsedMb: parseInt(ramRows[0].ram_used, 10) || 0,
            projectCount: parseInt(projRows[0].cnt, 10) || 0,
            databaseCount: parseInt(dbRows[0].cnt, 10) || 0,
            createdAt: student.created_at,
          };
        })
    );

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: {
          page,
          limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit),
        },
      },
    });
  } catch (err) {
    console.error('listStudents error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── PUT /api/admin/students/:id/quota ───────────────────────────────────────
async function updateStudentQuota(req, res) {
  try {
    const studentId = parseInt(req.params.id, 10);
    const { cpuQuota, ramQuotaMb, storageQuotaMb, maxProjects, maxDatabases } = req.body;

    if (
        cpuQuota === undefined &&
        ramQuotaMb === undefined &&
        storageQuotaMb === undefined &&
        maxProjects === undefined &&
        maxDatabases === undefined
    ) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'At least one quota field is required' });
    }

    const [students] = await db.execute(
        "SELECT id, email FROM users WHERE id = ? AND role = 'student'",
        [studentId]
    );

    if (students.length === 0) {
      return res.status(404).json({ success: false, error: 'STUDENT_NOT_FOUND', message: 'Student not found' });
    }

    // QUOTA_BELOW_USAGE checks (Section 10.7.4)
    // CPU
    if (cpuQuota !== undefined) {
      if (parseFloat(cpuQuota) <= 0) {
        return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Quota values must be positive' });
      }
      const [cpuUsedRows] = await db.execute(
          "SELECT COALESCE(SUM(cpu_limit), 0) AS used FROM projects WHERE user_id = ? AND status != 'deleted'",
          [studentId]
      );
      const currentUsed = parseFloat(cpuUsedRows[0].used) || 0;
      if (parseFloat(cpuQuota) < currentUsed) {
        return res.status(400).json({
          success: false,
          error: 'QUOTA_BELOW_USAGE',
          message: `Cannot set CPU quota below current usage (${currentUsed} cores in use)`,
        });
      }
    }

    // RAM
    if (ramQuotaMb !== undefined) {
      if (parseInt(ramQuotaMb, 10) <= 0) {
        return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Quota values must be positive' });
      }
      const [ramUsedRows] = await db.execute(
          "SELECT COALESCE(SUM(ram_limit_mb), 0) AS used FROM projects WHERE user_id = ? AND status != 'deleted'",
          [studentId]
      );
      const currentUsed = parseInt(ramUsedRows[0].used, 10) || 0;
      if (parseInt(ramQuotaMb, 10) < currentUsed) {
        return res.status(400).json({
          success: false,
          error: 'QUOTA_BELOW_USAGE',
          message: `Cannot set RAM quota below current usage (${currentUsed} MB in use)`,
        });
      }
    }

    // Max projects
    if (maxProjects !== undefined) {
      if (parseInt(maxProjects, 10) <= 0) {
        return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Quota values must be positive' });
      }
      const [projRows] = await db.execute(
          "SELECT COUNT(*) AS cnt FROM projects WHERE user_id = ? AND status != 'deleted'",
          [studentId]
      );
      const currentCount = parseInt(projRows[0].cnt, 10) || 0;
      if (parseInt(maxProjects, 10) < currentCount) {
        return res.status(400).json({
          success: false,
          error: 'QUOTA_BELOW_USAGE',
          message: `Cannot set max projects below current usage (${currentCount} active projects)`,
        });
      }
    }

    // Max databases
    if (maxDatabases !== undefined) {
      if (parseInt(maxDatabases, 10) <= 0) {
        return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Quota values must be positive' });
      }
      const [dbRows] = await db.execute(
          'SELECT COUNT(*) AS cnt FROM `databases` WHERE user_id = ?',
          [studentId]
      );
      const currentCount = parseInt(dbRows[0].cnt, 10) || 0;
      if (parseInt(maxDatabases, 10) < currentCount) {
        return res.status(400).json({
          success: false,
          error: 'QUOTA_BELOW_USAGE',
          message: `Cannot set max databases below current usage (${currentCount} databases)`,
        });
      }
    }

    // NOTE: storageQuotaMb has NO QUOTA_BELOW_USAGE check (Section 10.7.4)
    if (storageQuotaMb !== undefined && parseInt(storageQuotaMb, 10) <= 0) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Quota values must be positive' });
    }

    // Build update query
    const setClauses = [];
    const updateParams = [];

    if (cpuQuota !== undefined) { setClauses.push('cpu_quota = ?'); updateParams.push(parseFloat(cpuQuota)); }
    if (ramQuotaMb !== undefined) { setClauses.push('ram_quota_mb = ?'); updateParams.push(parseInt(ramQuotaMb, 10)); }
    if (storageQuotaMb !== undefined) { setClauses.push('storage_quota_mb = ?'); updateParams.push(parseInt(storageQuotaMb, 10)); }
    if (maxProjects !== undefined) { setClauses.push('max_projects = ?'); updateParams.push(parseInt(maxProjects, 10)); }
    if (maxDatabases !== undefined) { setClauses.push('max_databases = ?'); updateParams.push(parseInt(maxDatabases, 10)); }

    await db.execute(
        `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`,
        [...updateParams, studentId]
    );

    const [updatedRows] = await db.execute(
        'SELECT id, email, cpu_quota, ram_quota_mb, storage_quota_mb, max_projects, max_databases FROM users WHERE id = ?',
        [studentId]
    );
    const updated = updatedRows[0];

    return res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        email: updated.email,
        cpuQuota: parseFloat(updated.cpu_quota),
        ramQuotaMb: updated.ram_quota_mb,
        storageQuotaMb: updated.storage_quota_mb,
        maxProjects: updated.max_projects,
        maxDatabases: updated.max_databases,
      },
    });
  } catch (err) {
    console.error('updateStudentQuota error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── DELETE /api/admin/students/:id ─────────────────────────────────────────
async function removeStudent(req, res) {
  try {
    const adminId = req.user.id;
    const studentId = parseInt(req.params.id, 10);

    if (studentId === adminId) {
      return res.status(400).json({ success: false, error: 'CANNOT_DELETE_ADMIN', message: 'Cannot delete the admin account' });
    }

    const [students] = await db.execute(
        "SELECT id, email, role FROM users WHERE id = ? AND role = 'student'",
        [studentId]
    );

    if (students.length === 0) {
      return res.status(404).json({ success: false, error: 'STUDENT_NOT_FOUND', message: 'Student not found' });
    }

    const student = students[0];

    // Full cleanup sequence (Section 4.4 / 12.4.1)
    // Step 1+2: Stop/remove all containers, Step 4: Delete nginx configs
    const [projects] = await db.execute(
        "SELECT id, status, container_id, subdomain FROM projects WHERE user_id = ? AND status != 'deleted'",
        [studentId]
    );

    const subdomainsToRemove = [];
    for (const project of projects) {
      if (project.container_id) {
        try { await dockerService.stopContainer(project.container_id); } catch (_) {}
        try { await dockerService.removeContainer(project.container_id); } catch (_) {}
      }
      try { await dockerService.removeImage(`acadhost/project-${project.id}:latest`); } catch (_) {}
      if (project.subdomain && !project.subdomain.startsWith('_deleted_')) {
        subdomainsToRemove.push(project.subdomain);
      }
    }

    if (subdomainsToRemove.length > 0) {
      try {
        await nginxService.removeMultipleProjectConfigs(subdomainsToRemove);
      } catch (err) {
        console.warn('removeStudent: nginx cleanup failed:', err.message);
      }
    }

    // Step 3: Drop all MySQL schemas/users
    try {
      await databaseProvisioningService.dropAllDatabasesForStudent(studentId);
    } catch (err) {
      console.warn('removeStudent: database cleanup failed:', err.message);
    }

    // Step 4: Delete student disk directory
    try {
      await storageService.deleteStudentDirectory(studentId);
    } catch (err) {
      console.warn('removeStudent: disk cleanup failed:', err.message);
    }

    // Step 5: Delete users row (cascades)
    await db.execute('DELETE FROM users WHERE id = ?', [studentId]);

    return res.status(200).json({
      success: true,
      data: {
        message: 'STUDENT_REMOVED',
        studentId,
        email: student.email,
      },
    });
  } catch (err) {
    console.error('removeStudent error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/admin/students/batch-remove ───────────────────────────────────
async function batchRemoveStudents(req, res) {
  try {
    const { batchYear, excludeStudentIds } = req.body;

    if (batchYear === undefined || batchYear === null) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Batch year is required' });
    }

    const parsedYear = parseInt(batchYear, 10);
    if (isNaN(parsedYear)) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Batch year must be a valid integer' });
    }

    // Normalize excludeStudentIds — accept array or undefined/null
    const excludeIds = Array.isArray(excludeStudentIds)
        ? excludeStudentIds.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id))
        : [];

    // Build the WHERE clause — we want: batch_year = ? AND status != 'removed' AND id NOT IN (...)
    let query = "SELECT id, email FROM users WHERE role = 'student' AND batch_year = ? AND status != 'removed'";
    const params = [parsedYear];

    if (excludeIds.length > 0) {
      // Use placeholders for each excluded id to keep it parameterized
      query += ` AND id NOT IN (${excludeIds.map(() => '?').join(',')})`;
      params.push(...excludeIds);
    }

    const [students] = await db.execute(query, params);

    if (students.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'NO_STUDENTS_FOUND',
        message: excludeIds.length > 0
            ? `No students remain to remove for batch year ${parsedYear} after exclusions`
            : `No students found for batch year ${parsedYear}`,
      });
    }

    let studentsRemoved = 0;
    let projectsRemoved = 0;
    let databasesRemoved = 0;
    const failed = [];

    // Synchronous processing (Section 12.15.2)
    for (const student of students) {
      try {
        const [projects] = await db.execute(
            "SELECT id, status, container_id, subdomain FROM projects WHERE user_id = ? AND status != 'deleted'",
            [student.id]
        );

        const subdomainsToRemove = [];
        for (const project of projects) {
          if (project.container_id) {
            try { await dockerService.stopContainer(project.container_id); } catch (_) {}
            try { await dockerService.removeContainer(project.container_id); } catch (_) {}
          }
          try { await dockerService.removeImage(`acadhost/project-${project.id}:latest`); } catch (_) {}
          if (project.subdomain && !project.subdomain.startsWith('_deleted_')) {
            subdomainsToRemove.push(project.subdomain);
          }
        }

        if (subdomainsToRemove.length > 0) {
          try { await nginxService.removeMultipleProjectConfigs(subdomainsToRemove); } catch (_) {}
        }

        const [dbRows] = await db.execute(
            'SELECT COUNT(*) AS cnt FROM `databases` WHERE user_id = ?',
            [student.id]
        );
        databasesRemoved += parseInt(dbRows[0].cnt, 10) || 0;

        try {
          await databaseProvisioningService.dropAllDatabasesForStudent(student.id);
        } catch (_) {}

        try {
          await storageService.deleteStudentDirectory(student.id);
        } catch (_) {}

        await db.execute('DELETE FROM users WHERE id = ?', [student.id]);

        studentsRemoved++;
        projectsRemoved += projects.length;
      } catch (err) {
        console.error(`batchRemoveStudents: failed for student ${student.id}:`, err);
        failed.push(student.id);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        message: 'BATCH_REMOVED',
        batchYear: parsedYear,
        studentsRemoved,
        projectsRemoved,
        databasesRemoved,
        excluded: excludeIds.length,
        failed,
      },
    });
  } catch (err) {
    console.error('batchRemoveStudents error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/admin/students/invite ─────────────────────────────────────────
async function inviteStudents(req, res) {
  try {
    const file = req.file;

    // ── Two input modes ──────────────────────────────────────
    // Mode 1: Manual UI entry — req.body.students is a JSON array:
    //   [ { email, name, batchYear }, ... ]
    //
    // Mode 2: Excel file upload — columns must be:
    //   Column A: email  (required)
    //   Column B: name   (optional)
    //   Column C: batchYear (optional)
    //   Row 1 is the header row and is always skipped.
    //
    // Both modes can be sent together; entries are merged and deduplicated.

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // { email → { name, batchYear } }  — preserves per-student meta
    const studentMap = new Map();

    // ── Mode 1: manual JSON array ────────────────────────────
    let studentsInput = req.body.students;
    if (studentsInput) {
      if (typeof studentsInput === 'string') {
        try { studentsInput = JSON.parse(studentsInput); } catch (_) { studentsInput = []; }
      }
      if (Array.isArray(studentsInput)) {
        for (const entry of studentsInput) {
          const email = (entry.email || '').trim().toLowerCase();
          if (email) {
            studentMap.set(email, {
              name:      (entry.name || '').trim() || null,
              batchYear: entry.batchYear ? parseInt(entry.batchYear, 10) : null,
            });
          }
        }
      }
    }

    // ── Mode 1b: legacy comma-separated emails field ─────────
    // Kept for backward compatibility; uses top-level batchYear only.
    const emailsText  = req.body.emails;
    const globalYear  = req.body.batchYear ? parseInt(req.body.batchYear, 10) : null;
    if (emailsText) {
      for (const part of emailsText.split(',')) {
        const email = part.trim().toLowerCase();
        if (email && !studentMap.has(email)) {
          studentMap.set(email, { name: null, batchYear: globalYear });
        }
      }
    }

    // ── Mode 2: Excel file ───────────────────────────────────
    // Expected columns: A=email, B=name (optional), C=batchYear (optional)
    // Row 1 is always skipped (header row).
    if (file) {
      try {
        const XLSX     = require('xlsx');
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        const sheet    = workbook.Sheets[workbook.SheetNames[0]];
        const rows     = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        // Skip row index 0 — that is the header row
        for (let i = 1; i < rows.length; i++) {
          const row   = rows[i];
          if (!row || !row[0]) continue;
          const email = String(row[0]).trim().toLowerCase();
          if (!email) continue;

          const name      = row[1] ? String(row[1]).trim() || null : null;
          const yearRaw   = row[2] ? parseInt(row[2], 10) : null;
          const batchYear = (!isNaN(yearRaw) && yearRaw) ? yearRaw : globalYear;

          if (!studentMap.has(email)) {
            studentMap.set(email, { name, batchYear });
          }
        }
      } catch (xlsxErr) {
        return res.status(400).json({ success: false, error: 'INVALID_FILE_FORMAT', message: 'File must be an Excel file (.xlsx or .xls)' });
      }
    }

    if (studentMap.size === 0) {
      return res.status(400).json({ success: false, error: 'NO_VALID_EMAILS', message: 'No valid email addresses found in the provided input' });
    }

    const invited = [];
    const skipped = [];
    const invalid = [];

    // Get quota defaults from env
    const defaultCpu          = parseFloat(process.env.DEFAULT_CPU_CORES    || '2');
    const defaultRam          = parseInt(process.env.DEFAULT_RAM_MB          || '1024', 10);
    const defaultStorage      = parseInt(process.env.DEFAULT_STORAGE_MB      || '2560', 10);
    const defaultMaxProjects  = parseInt(process.env.DEFAULT_MAX_PROJECTS    || '4',    10);
    const defaultMaxDatabases = parseInt(process.env.DEFAULT_MAX_DATABASES   || '4',    10);

    for (const [email, meta] of studentMap.entries()) {
      // Validate email format
      if (!emailRegex.test(email)) {
        invalid.push({ email, reason: 'Invalid email format' });
        continue;
      }

      // Check if already exists
      const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
      if (existing.length > 0) {
        skipped.push({ email, reason: 'Email already exists in the system' });
        continue;
      }

      const { name, batchYear } = meta;

      // Insert user row with status='invited'
      // name is stored if provided — student can update it on registration
      await db.execute(
          `INSERT INTO users
           (email, password_hash, name, role, batch_year, status,
            cpu_quota, ram_quota_mb, storage_quota_mb, max_projects, max_databases)
         VALUES (?, NULL, ?, 'student', ?, 'invited', ?, ?, ?, ?, ?)`,
          [email, name, batchYear, defaultCpu, defaultRam, defaultStorage, defaultMaxProjects, defaultMaxDatabases]
      );

      // Generate invite token
      const inviteTokenRaw  = tokenHelper.generateInviteToken(email, batchYear);
      const inviteTokenHash = tokenHelper.hashToken(inviteTokenRaw);
      const expiresAt       = new Date(Date.now() + durationToMs(process.env.INVITE_TOKEN_EXPIRY || '2h'));

      await db.execute(
          'INSERT INTO invite_tokens (email, token_hash, batch_year, expires_at, used) VALUES (?, ?, ?, ?, 0)',
          [email, inviteTokenHash, batchYear, expiresAt]
      );

      const registrationLink = `${process.env.FRONTEND_URL}/register?token=${inviteTokenRaw}`;

      // Send invitation email (non-blocking)
      try {
        await emailService.sendInvitationEmail(email, registrationLink, batchYear);
      } catch (emailErr) {
        console.warn(`inviteStudents: failed to send invite to ${email}:`, emailErr.message);
      }

      invited.push({ email, name: name || null, batchYear: batchYear || null });
    }

    if (invited.length === 0 && invalid.length === 0 && skipped.length > 0) {
      return res.status(400).json({ success: false, error: 'NO_VALID_EMAILS', message: 'No valid email addresses found in the provided input' });
    }

    return res.status(200).json({
      success: true,
      data: {
        invited,
        skipped,
        invalid,
        totalInvited: invited.length,
        totalSkipped: skipped.length,
        totalInvalid: invalid.length,
      },
    });
  } catch (err) {
    console.error('inviteStudents error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/admin/students/:id/resend-invite ──────────────────────────────
async function resendInvite(req, res) {
  try {
    const studentId = parseInt(req.params.id, 10);

    const [students] = await db.execute(
        "SELECT id, email, status, batch_year FROM users WHERE id = ?",
        [studentId]
    );

    if (students.length === 0) {
      return res.status(404).json({ success: false, error: 'STUDENT_NOT_FOUND', message: 'Student not found' });
    }

    const student = students[0];

    if (student.status !== 'invited') {
      return res.status(400).json({ success: false, error: 'ALREADY_REGISTERED', message: 'Student has already completed registration' });
    }

    // Delete all existing unused invite tokens for this email (Section 5.9.2)
    await db.execute("DELETE FROM invite_tokens WHERE email = ? AND used = 0", [student.email]);

    // Generate new token
    const inviteTokenRaw = tokenHelper.generateInviteToken(student.email, student.batch_year);
    const inviteTokenHash = tokenHelper.hashToken(inviteTokenRaw);
    const expiresAt = new Date(Date.now() + durationToMs(process.env.INVITE_TOKEN_EXPIRY || '2h'));

    await db.execute(
        'INSERT INTO invite_tokens (email, token_hash, batch_year, expires_at, used) VALUES (?, ?, ?, ?, 0)',
        [student.email, inviteTokenHash, student.batch_year, expiresAt]
    );

    const registrationLink = `${process.env.FRONTEND_URL}/register?token=${inviteTokenRaw}`;

    try {
      await emailService.sendInvitationEmail(student.email, registrationLink, student.batch_year);
    } catch (emailErr) {
      console.warn(`resendInvite: failed to send email to ${student.email}:`, emailErr.message);
    }

    return res.status(200).json({
      success: true,
      data: {
        message: 'INVITE_RESENT',
        email: student.email,
      },
    });
  } catch (err) {
    console.error('resendInvite error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}
// ── POST /api/admin/students/:id/suspend ───────────────────────
async function suspendStudent(req, res) {
  try {
    const studentId = parseInt(req.params.id, 10);
    const adminId = req.user.id;

    if (String(studentId) === String(adminId)) {
      return res.status(400).json({
        success: false, error: 'CANNOT_SUSPEND_ADMIN',
        message: 'Cannot suspend the admin account',
      });
    }

    const [[student]] = await db.execute(
        'SELECT id, email, name, status, role FROM users WHERE id = ?',
        [studentId]
    );
    if (!student) {
      return res.status(404).json({ success: false, error: 'STUDENT_NOT_FOUND', message: 'Student not found' });
    }
    if (student.role === 'admin') {
      return res.status(400).json({ success: false, error: 'CANNOT_SUSPEND_ADMIN', message: 'Cannot suspend the admin account' });
    }
    if (student.status === 'removed') {
      return res.status(400).json({ success: false, error: 'CANNOT_SUSPEND_REMOVED', message: 'Cannot suspend a removed student' });
    }
    if (student.status === 'suspended') {
      return res.status(400).json({ success: false, error: 'ALREADY_SUSPENDED', message: 'Student is already suspended' });
    }
    if (student.status === 'invited') {
      return res.status(400).json({ success: false, error: 'CANNOT_SUSPEND_INVITED', message: 'Cannot suspend a student who has not completed registration' });
    }

    // Flip status + revoke refresh tokens (forces logout on next refresh cycle)
    await db.execute("UPDATE users SET status = 'suspended' WHERE id = ?", [studentId]);
    await db.execute('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [studentId]);

    // Email (non-blocking)
    emailService.sendStudentSuspendedEmail(student.email, student.name)
        .catch((e) => console.warn(`[adminController.suspendStudent] email failed: ${e.message}`));

    return res.status(200).json({
      success: true,
      data: {
        message: 'STUDENT_SUSPENDED',
        studentId,
        email: student.email,
        notifiedStudent: student.email,
      },
    });
  } catch (err) {
    console.error('suspendStudent error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ── POST /api/admin/students/:id/unsuspend ─────────────────────
async function unsuspendStudent(req, res) {
  try {
    const studentId = parseInt(req.params.id, 10);

    const [[student]] = await db.execute(
        'SELECT id, email, name, status FROM users WHERE id = ?',
        [studentId]
    );
    if (!student) {
      return res.status(404).json({ success: false, error: 'STUDENT_NOT_FOUND', message: 'Student not found' });
    }
    if (student.status !== 'suspended') {
      return res.status(400).json({ success: false, error: 'NOT_SUSPENDED', message: 'Student is not suspended' });
    }

    await db.execute("UPDATE users SET status = 'active' WHERE id = ?", [studentId]);

    emailService.sendStudentUnsuspendedEmail(student.email, student.name)
        .catch((e) => console.warn(`[adminController.unsuspendStudent] email failed: ${e.message}`));

    return res.status(200).json({
      success: true,
      data: {
        message: 'STUDENT_UNSUSPENDED',
        studentId,
        email: student.email,
        notifiedStudent: student.email,
      },
    });
  } catch (err) {
    console.error('unsuspendStudent error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── GET /api/admin/projects ─────────────────────────────────────────────────
async function listProjects(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const { status, studentId, search } = req.query;

    let whereClause = "WHERE 1=1";
    const params = [];

    // Hard rule: admin list NEVER returns deleted projects.
    // Deleted rows are soft-deleted for audit (Section 6.4.10) but must not
    // appear in admin UIs. If the caller explicitly requests status=deleted
    // it is silently ignored — deleted is not a user-facing state.
    whereClause += " AND p.status != 'deleted'";

    if (status && status !== 'deleted') {
      whereClause += ' AND p.status = ?';
      params.push(status);
    }

    if (studentId) {
      whereClause += ' AND p.user_id = ?';
      params.push(parseInt(studentId, 10));
    }

    if (search) {
      // Search across project title, subdomain, AND the owning student's
      // name and email. Previously this was title/subdomain only.
      whereClause += ' AND (p.title LIKE ? OR p.subdomain LIKE ? OR u.name LIKE ? OR u.email LIKE ?)';
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS cnt
         FROM projects p
         JOIN users u ON p.user_id = u.id
         ${whereClause}`,
        params
    );
    const totalItems = parseInt(countRows[0].cnt, 10);

    const safeLimit = Number.isInteger(limit) ? limit : 20;
    const safeOffset = Number.isInteger(offset) ? offset : 0;

    const [projects] = await db.execute(
        `SELECT p.id, p.title, p.subdomain, p.project_type, p.runtime, p.runtime_version,
                p.source_type, p.status, p.cpu_limit, p.ram_limit_mb, p.container_port,
                p.created_at, p.updated_at,
                u.id AS student_id, u.email AS student_email, u.name AS student_name
         FROM projects p
         JOIN users u ON p.user_id = u.id
         ${whereClause}
         ORDER BY p.created_at DESC
         LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        params
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
      status: p.status,
      cpuLimit: parseFloat(p.cpu_limit),
      ramLimitMb: p.ram_limit_mb,
      containerPort: p.container_port || null,
      student: {
        id: p.student_id,
        email: p.student_email,
        name: p.student_name,
      },
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: {
          page,
          limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit),
        },
      },
    });
  } catch (err) {
    console.error('admin listProjects error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}
// ─── POST /api/admin/projects/:id/stop ───────────────────────────────────────
async function stopProject(req, res) {
  try {
    const projectId = parseInt(req.params.id, 10);

    const [rows] = await db.execute(
        `SELECT p.id, p.title, p.subdomain, p.status, p.container_id,
                u.email AS student_email
         FROM projects p
                JOIN users u ON p.user_id = u.id
         WHERE p.id = ?`,
        [projectId]
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

    // Send email notification (non-blocking)
    try {
      await emailService.sendProjectStoppedEmail(
          project.student_email,
          project.title,
          project.subdomain
      );
    } catch (emailErr) {
      console.warn(`admin stopProject: email notification failed for ${project.student_email}:`, emailErr.message);
    }

    return res.status(200).json({
      success: true,
      data: {
        message: 'PROJECT_STOPPED',
        projectId,
        title: project.title,
        notifiedStudent: project.student_email,
      },
    });
  } catch (err) {
    console.error('admin stopProject error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── POST /api/admin/projects/:id/terminate ───────────────────────────────────
async function terminateProject(req, res) {
  try {
    const projectId = parseInt(req.params.id, 10);

    const [rows] = await db.execute(
        `SELECT p.id, p.title, p.subdomain, p.status, p.container_id, p.user_id,
                u.email AS student_email
         FROM projects p
                JOIN users u ON p.user_id = u.id
         WHERE p.id = ?`,
        [projectId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'PROJECT_NOT_FOUND', message: 'Project not found' });
    }

    const project = rows[0];

    if (project.status === 'deleted') {
      return res.status(400).json({ success: false, error: 'PROJECT_ALREADY_DELETED', message: 'Project has already been terminated' });
    }

    // IMPORTANT: Capture original subdomain BEFORE soft-delete (Section 11.4.4)
    const originalSubdomain = project.subdomain;
    const studentEmail = project.student_email;
    const projectTitle = project.title;

    // Perform same cleanup as student delete (Section 12.11.2)
    await _performProjectCleanup(projectId, project.user_id, project);

    // Send email notification with ORIGINAL subdomain (Section 11.5.4)
    try {
      await emailService.sendProjectTerminatedEmail(studentEmail, projectTitle, originalSubdomain);
    } catch (emailErr) {
      console.warn(`admin terminateProject: email notification failed for ${studentEmail}:`, emailErr.message);
    }

    return res.status(200).json({
      success: true,
      data: {
        message: 'PROJECT_TERMINATED',
        projectId,
        title: projectTitle,
        notifiedStudent: studentEmail,
      },
    });
  } catch (err) {
    console.error('admin terminateProject error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}
async function deleteMultipleStudents(req, res) {

  try {

    const { studentIds } = req.body;

    if (
        !Array.isArray(studentIds) ||
        studentIds.length === 0
    ) {
      return res.status(400).json({
        success:false,
        error:"VALIDATION_ERROR",
        message:"studentIds array required"
      });
    }

    let removed = [];
    let failed = [];

    for (const studentId of studentIds) {

      try {

        const [students] = await db.execute(
            "SELECT id,email FROM users WHERE id=? AND role='student'",
            [studentId]
        );

        if (students.length === 0) {
          failed.push({
            studentId,
            reason:"Student not found"
          });
          continue;
        }

        const [projects] = await db.execute(
            "SELECT id,status,container_id,subdomain FROM projects WHERE user_id=? AND status!='deleted'",
            [studentId]
        );

        for (const project of projects) {
          await _performProjectCleanup(
              project.id,
              studentId,
              project
          );
        }

        try {
          await databaseProvisioningService
              .dropAllDatabasesForStudent(studentId);
        } catch(_) {}

        try {
          await storageService
              .deleteStudentDirectory(studentId);
        } catch(_) {}

        await db.execute(
            'DELETE FROM users WHERE id=?',
            [studentId]
        );

        removed.push(studentId);

      } catch(err) {

        failed.push({
          studentId,
          reason:"Delete failed"
        });

      }

    }

    return res.status(200).json({
      success:true,
      data:{
        removed,
        failed,
        totalRemoved: removed.length
      }
    });

  } catch(err) {

    console.error(
        'deleteMultipleStudents error:',
        err
    );

    return res.status(500).json({
      success:false,
      error:"INTERNAL_ERROR",
      message:"Internal server error"
    });

  }

}

const { exec } = require("child_process");

async function getLiveProjectUsage(req,res){

  try{

    exec(
        'docker stats --no-stream --format "{{json .}}"',
        (err,stdout)=>{

          if(err){
            return res.status(500).json({
              success:false,
              error:"DOCKER_STATS_FAILED"
            });
          }

          const lines =
              stdout
                  .trim()
                  .split("\n")
                  .filter(Boolean);

          let totalCpu = 0;
          let totalRamMb = 0;

          let projectsRunning = 0;

          lines.forEach(line=>{

            try{

              const c = JSON.parse(line);

              // ONLY your project containers
              if(
                  !c.Name.startsWith(
                      "acadhost-project-"
                  )
              ) return;

              projectsRunning++;

              // CPU %
              totalCpu +=
                  parseFloat(
                      c.CPUPerc.replace("%","")
                  ) || 0;

              // RAM parse like:
              // "47.3MiB / 512MiB"

              const memPart =
                  c.MemUsage.split("/")[0].trim();

              let ramMb=0;

              if(memPart.includes("MiB"))
                ramMb=parseFloat(memPart);

              if(memPart.includes("GiB"))
                ramMb=parseFloat(memPart)*1024;

              totalRamMb+=ramMb;

            }catch(e){}

          });

          // STORAGE
          exec(
              'docker ps -s --format "{{.Names}}|{{.Size}}"',
              (err2,stdout2)=>{

                let totalStorageMb=0;

                if(!err2){

                  stdout2
                      .split("\n")
                      .forEach(line=>{

                        if(
                            !line.startsWith(
                                "acadhost-project-"
                            )
                        ) return;

                        const parts=line.split("|");

                        if(parts.length<2) return;

                        const size=parts[1];

                        let mb=0;

                        if(size.includes("MB"))
                          mb=parseFloat(size);

                        if(size.includes("GB"))
                          mb=parseFloat(size)*1024;

                        totalStorageMb+=mb;

                      });

                }

                return res.json({

                  success:true,

                  data:{

                    projectsRunning,

                    cpuUsedPercent:
                        Number(
                            totalCpu.toFixed(2)
                        ),

                    ramUsedMb:
                        Math.round(
                            totalRamMb
                        ),

                    storageUsedMb:
                        Math.round(
                            totalStorageMb
                        ),

                    updatedAt:
                        new Date()

                  }

                });

              });

        });

  }catch(err){

    return res.status(500).json({
      success:false,
      error:"INTERNAL_ERROR"
    });

  }

}
module.exports = {
  getMetrics,
  listStudents,
  updateStudentQuota,
  removeStudent,
  batchRemoveStudents,
  inviteStudents,
  resendInvite,
  listProjects,
  stopProject,
  terminateProject,
  deleteMultipleStudents,
  getLiveProjectUsage,
  suspendStudent,
  unsuspendStudent,
};