'use strict';

// ============================================================
// Storage Service — services/storageService.js
// Section 10.4.3, 10.4.4
//
// Measures disk usage for student project directories.
// Docker images and MySQL storage are NOT counted.
//
// Functions:
//   calculateStudentStorageUsage(studentId)  → MB (float)
//   calculateProjectStorageUsage(studentId, projectId)
//     → { totalMb, breakdown: { sourceMb, buildLogsMb, uploadsMb, otherMb } }
// ============================================================

const fsp  = require('fs').promises;
const path = require('path');

// ── Recursive directory size ──────────────────────────────────

/**
 * Recursively sums the byte size of all files under a directory.
 * Returns 0 if the directory does not exist or cannot be read.
 *
 * @param {string} dirPath
 * @returns {Promise<number>} total bytes
 */
async function recursiveDirectorySize(dirPath) {
  let total = 0;

  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return 0;
    throw err;
  }

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await recursiveDirectorySize(entryPath);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      try {
        const stat = await fsp.stat(entryPath);
        total += stat.size;
      } catch (_) {
        // Race condition or broken symlink — skip
      }
    }
  }

  return total;
}

/**
 * Returns the byte size of a single directory (non-recursive).
 * Returns 0 if the directory does not exist.
 *
 * @param {string} dirPath
 * @returns {Promise<number>}
 */
async function directorySize(dirPath) {
  return recursiveDirectorySize(dirPath);
}

// ── calculateStudentStorageUsage ──────────────────────────────

/**
 * Measures total disk usage of the student's project directory tree.
 *
 * Scope: {PROJECTS_BASE_DIR}/{studentId}/ (recursive)
 * Excludes: Docker images, MySQL schemas (not on this path)
 *
 * @param {number|string} studentId
 * @returns {Promise<number>} usage in MB (float, rounded to 2 decimal places)
 */
async function calculateStudentStorageUsage(studentId) {
  const basePath = path.join(
    process.env.PROJECTS_BASE_DIR,
    String(studentId)
  );

  // Check existence first to avoid throwing on brand-new students
  try {
    await fsp.access(basePath);
  } catch (_) {
    return 0;
  }

  const totalBytes = await recursiveDirectorySize(basePath);
  return Math.round((totalBytes / (1024 * 1024)) * 100) / 100;
}

// ── calculateProjectStorageUsage ──────────────────────────────

/**
 * Measures disk usage for a single project directory with a breakdown
 * by sub-directory category.
 *
 * Response shape (Section 10.4.4):
 * {
 *   totalMb: number,
 *   breakdown: {
 *     sourceMb:    number,
 *     buildLogsMb: number,
 *     uploadsMb:   number,
 *     otherMb:     number,
 *   }
 * }
 *
 * @param {number|string} studentId
 * @param {number|string} projectId
 * @returns {Promise<Object>}
 */
async function calculateProjectStorageUsage(studentId, projectId) {
  const empty = {
    totalMb: 0,
    breakdown: { sourceMb: 0, buildLogsMb: 0, uploadsMb: 0, otherMb: 0 },
  };

  const projectPath = path.join(
    process.env.PROJECTS_BASE_DIR,
    String(studentId),
    String(projectId)
  );

  try {
    await fsp.access(projectPath);
  } catch (_) {
    return empty;
  }

  const toMb = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

  const [sourceBytes, buildLogsBytes, uploadsBytes, totalBytes] = await Promise.all([
    directorySize(path.join(projectPath, 'source')),
    directorySize(path.join(projectPath, 'build', 'logs')),
    directorySize(path.join(projectPath, 'uploads')),
    directorySize(projectPath),
  ]);

  const sourceMb    = toMb(sourceBytes);
  const buildLogsMb = toMb(buildLogsBytes);
  const uploadsMb   = toMb(uploadsBytes);
  const totalMb     = toMb(totalBytes);
  const otherMb     = Math.max(0, Math.round((totalMb - sourceMb - buildLogsMb - uploadsMb) * 10) / 10);

  return {
    totalMb,
    breakdown: { sourceMb, buildLogsMb, uploadsMb, otherMb },
  };
}

// ── deleteStudentDirectory ────────────────────────────────────

/**
 * Deletes the entire student directory from disk.
 * Called during student removal to reclaim all storage quota.
 *
 * Path: {PROJECTS_BASE_DIR}/{studentId}/
 * No-ops silently if the directory does not exist.
 *
 * @param {number|string} studentId
 * @returns {Promise<void>}
 */
async function deleteStudentDirectory(studentId) {
  const studentPath = path.join(
    process.env.PROJECTS_BASE_DIR,
    String(studentId)
  );

  try {
    await fsp.rm(studentPath, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// ── deleteProjectDirectory ────────────────────────────────────

/**
 * Deletes the entire project directory from disk.
 * Called during project deletion to reclaim storage quota.
 *
 * Path: {PROJECTS_BASE_DIR}/{studentId}/{projectId}/
 * No-ops silently if the directory does not exist.
 *
 * @param {number|string} studentId
 * @param {number|string} projectId
 * @returns {Promise<void>}
 */
async function deleteProjectDirectory(studentId, projectId) {
  const projectPath = path.join(
    process.env.PROJECTS_BASE_DIR,
    String(studentId),
    String(projectId)
  );

  try {
    await fsp.rm(projectPath, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = {
  calculateStudentStorageUsage,
  calculateProjectStorageUsage,
  deleteProjectDirectory,
  deleteStudentDirectory,
};
