'use strict';

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');

// Public routes — no auth middleware
router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/refresh', authController.refresh);
router.get('/invite/validate', authController.validateInvite);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Internal-only route: Nginx blocks external access via `deny all; return 403;`
// phpMyAdmin signon.php calls this directly via host.docker.internal:{BACKEND_PORT}
router.post('/phpmyadmin/verify', authController.verifyPhpMyAdminSession);

// Protected routes — require valid JWT access token
router.post('/logout', auth, authController.logout);
router.put('/password', auth, authController.changePassword);

module.exports = router;
