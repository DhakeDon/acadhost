'use strict';

const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');

// All student routes require auth + student role
router.get('/profile', auth, roleGuard('student'), studentController.getProfile);
router.put(
    '/profile/name',
    auth,
    roleGuard('student'),
    studentController.updateName
);
router.put('/dark-mode', auth, roleGuard('student'), studentController.toggleDarkMode);


module.exports = router;
