'use strict';

const express = require('express');
const router = express.Router();
const resourceRequestController = require('../controllers/resourceRequestController');
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');

// Student: submit request
router.post('/', auth, roleGuard('student'), resourceRequestController.submitRequest);

// Both admin and student: list requests (controller scopes by role)
router.get('/', auth, resourceRequestController.listRequests);

// Admin only: review request
router.put('/:id', auth, roleGuard('admin'), resourceRequestController.reviewRequest);

module.exports = router;
