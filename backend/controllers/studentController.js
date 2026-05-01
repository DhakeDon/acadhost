'use strict';

const db = require('../config/db');
const storageService = require('../services/storageService');

// ─── GET /api/student/profile ────────────────────────────────────────────────
async function getProfile(req, res) {
  try {
    const studentId = req.user.id;

    const [users] = await db.execute(
      `SELECT id, email, name, role, batch_year, dark_mode,
              cpu_quota, ram_quota_mb, storage_quota_mb, max_projects, max_databases
       FROM users WHERE id = ?`,
      [studentId]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, error: 'USER_NOT_FOUND', message: 'User not found' });
    }

    const user = users[0];

    // Compute CPU usage: SUM of cpu_limit for all non-deleted projects
    const [cpuRows] = await db.execute(
      "SELECT COALESCE(SUM(cpu_limit), 0) AS cpu_used FROM projects WHERE user_id = ? AND status != 'deleted'",
      [studentId]
    );
    const cpuUsed = parseFloat(cpuRows[0].cpu_used) || 0;

    // Compute RAM usage
    const [ramRows] = await db.execute(
      "SELECT COALESCE(SUM(ram_limit_mb), 0) AS ram_used FROM projects WHERE user_id = ? AND status != 'deleted'",
      [studentId]
    );
    const ramUsedMb = parseInt(ramRows[0].ram_used, 10) || 0;

    // Compute storage usage from disk
    const storageUsedMb = await storageService.calculateStudentStorageUsage(studentId);

    // Project count
    const [projRows] = await db.execute(
      "SELECT COUNT(*) AS project_count FROM projects WHERE user_id = ? AND status != 'deleted'",
      [studentId]
    );
    const projectCount = parseInt(projRows[0].project_count, 10) || 0;

    // Database count
    const [dbRows] = await db.execute(
      'SELECT COUNT(*) AS db_count FROM `databases` WHERE user_id = ?',
      [studentId]
    );
    const databaseCount = parseInt(dbRows[0].db_count, 10) || 0;

    const storageWarningThreshold = parseInt(process.env.STORAGE_WARNING_THRESHOLD_PERCENT || '80', 10);
    const storageWarning =
      user.storage_quota_mb > 0 &&
      (storageUsedMb / user.storage_quota_mb) * 100 >= storageWarningThreshold;

    return res.status(200).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        batchYear: user.batch_year || null,
        darkMode: user.dark_mode === 1,
        cpuQuota: parseFloat(user.cpu_quota),
        ramQuotaMb: user.ram_quota_mb,
        storageQuotaMb: user.storage_quota_mb,
        maxProjects: user.max_projects,
        maxDatabases: user.max_databases,
        cpuUsed,
        ramUsedMb,
        storageUsedMb,
        projectCount,
        databaseCount,
        storageWarning,
      },
    });
  } catch (err) {
    console.error('getProfile error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ─── PUT /api/student/dark-mode ──────────────────────────────────────────────
async function toggleDarkMode(req, res) {
  try {
    const { darkMode } = req.body;

    if (typeof darkMode !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'darkMode must be a boolean',
      });
    }

    await db.execute('UPDATE users SET dark_mode = ? WHERE id = ?', [darkMode ? 1 : 0, req.user.id]);

    return res.status(200).json({
      success: true,
      data: { darkMode },
    });
  } catch (err) {
    console.error('toggleDarkMode error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}
async function updateName(req, res) {

  try {

    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success:false,
        error:"NAME_REQUIRED",
        message:"Name is required"
      });
    }

    await db.execute(
        'UPDATE users SET name=? WHERE id=?',
        [
          name.trim(),
          req.user.id
        ]
    );

    return res.status(200).json({
      success:true,
      data:{
        name:name.trim()
      }
    });

  } catch(err){

    console.error(
        'updateName error:',
        err
    );

    return res.status(500).json({
      success:false,
      error:"INTERNAL_ERROR"
    });

  }

}

module.exports = { getProfile, toggleDarkMode,updateName};
