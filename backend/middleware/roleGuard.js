'use strict';

// ============================================================
// Role Guard Middleware — middleware/roleGuard.js
// Section 5.7 — Role-Based Authorization
//
// Restricts routes to specific role(s).
// Must always be applied AFTER auth.js (reads req.user.role).
//
// Usage:
//   router.get('/admin/students', auth, roleGuard('admin'), handler);
//   router.get('/student/profile', auth, roleGuard('student'), handler);
//   router.get('/shared', auth, roleGuard(['admin', 'student']), handler);
// ============================================================

function roleGuard(requiredRole) {
  const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

  return function (req, res, next) {
    if (allowed.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error:   'FORBIDDEN',
      message: 'Insufficient permissions',
    });
  };
}

module.exports = roleGuard;
