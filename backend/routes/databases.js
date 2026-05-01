'use strict';

const express = require('express');
const router = express.Router();
const databaseController = require('../controllers/databaseController');
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');

const guard = [auth, roleGuard('student')];

router.post('/', ...guard, databaseController.createDatabase);
router.get('/', ...guard, databaseController.listDatabases);
router.get('/:id/phpmyadmin', ...guard, databaseController.getPhpMyAdminLink);
router.delete('/:id', ...guard, databaseController.deleteDatabase);  // ✅ NEW

module.exports = router;