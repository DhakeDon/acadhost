'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();
const adminController = require('../controllers/adminController');
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');

// ─── Multer configuration for Excel uploads (Section 6.12.2) ────────────────
const excelStorage = multer.memoryStorage();

function excelFileFilter(req, file, cb) {
  const allowedMimes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
  ];
  const allowedExts = ['.xlsx', '.xls'];
  const ext = require('path').extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname);
    err.code = 'INVALID_FILE_TYPE';
    err.message = 'Invalid file type. Expected: .xlsx or .xls';
    cb(err);
  }
}

const uploadExcel = multer({
  storage: excelStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: excelFileFilter,
});

function handleExcelUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'FILE_TOO_LARGE', message: 'File exceeds maximum size' });
    }
    if (err.code === 'INVALID_FILE_TYPE') {
      return res.status(400).json({ success: false, error: 'INVALID_FILE_FORMAT', message: 'File must be an Excel file (.xlsx or .xls)' });
    }
  }
  next(err);
}

// ─── All admin routes require auth + admin role ───────────────────────────────
const guard = [auth, roleGuard('admin')];

// Dashboard metrics
router.get('/metrics', ...guard, adminController.getMetrics);

// Student management
router.get('/students', ...guard, adminController.listStudents);
router.put('/students/:id/quota', ...guard, adminController.updateStudentQuota);
router.delete('/students/:id', ...guard, adminController.removeStudent);
router.post('/students/batch-remove', ...guard, adminController.batchRemoveStudents);
router.post(
  '/students/invite',
  ...guard,
  uploadExcel.single('file'),
  handleExcelUploadError,
  adminController.inviteStudents
);
router.post(
    '/students/delete-multiple',
    ...guard,
    adminController.deleteMultipleStudents
);
router.post('/students/:id/resend-invite', ...guard, adminController.resendInvite);
router.post('/students/:id/suspend', ...guard, adminController.suspendStudent);
router.post('/students/:id/unsuspend', ...guard, adminController.unsuspendStudent);

// Project management
router.get('/projects', ...guard, adminController.listProjects);
router.post('/projects/:id/stop', ...guard, adminController.stopProject);
router.post('/projects/:id/terminate', ...guard, adminController.terminateProject);
router.get(
    '/live-project-usage',
    ...guard,
    adminController.getLiveProjectUsage
);
module.exports = router;
