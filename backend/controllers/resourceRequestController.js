'use strict';

// ============================================================
// Resource Request Controller — controllers/resourceRequestController.js
// Section 6.7
//
// Handles student resource request submission and admin review.
//
// Email notifications:
//   - On submit  → admin receives notification with request details
//   - On review  → student receives approval or denial with admin notes
// ============================================================

const db           = require('../config/db');
const emailService = require('../services/emailService');

// ── POST /api/resource-requests ─────────────────────────────
async function submitRequest(req, res) {
  try {
    const studentId = req.user.id;
    const { resourceType, requestedValue, description } = req.body;

    // Validate required fields
    if (!resourceType) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'resourceType is required' });
    }
    if (!requestedValue) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'requestedValue is required' });
    }
    if (!description) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'description is required' });
    }

    const validTypes = ['cpu', 'ram', 'storage', 'projects', 'databases'];
    if (!validTypes.includes(resourceType)) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Resource type must be one of: cpu, ram, storage, projects, databases',
      });
    }

    // Insert request
    const [result] = await db.execute(
      `INSERT INTO resource_requests (user_id, resource_type, requested_value, description, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [studentId, resourceType, String(requestedValue), description]
    );

    const requestId = result.insertId;

    // Fetch created_at for response
    const [[inserted]] = await db.execute(
      'SELECT created_at FROM resource_requests WHERE id = ?',
      [requestId]
    );

    // ── Email admin (non-blocking) ──────────────────────────
    // Fetch student name + email and admin email in parallel
    try {
      const [[student]] = await db.execute(
        'SELECT name, email FROM users WHERE id = ?',
        [studentId]
      );
      const [[admin]] = await db.execute(
        "SELECT email FROM users WHERE role = 'admin' LIMIT 1"
      );

      if (student && admin) {
        emailService.sendResourceRequestSubmittedEmail(
          admin.email,
          student.name,
          student.email,
          resourceType,
          String(requestedValue),
          description
        ).catch((emailErr) => {
          console.warn(`[resourceRequestController] Failed to notify admin of new request: ${emailErr.message || emailErr}`);
        });
      }
    } catch (lookupErr) {
      // Email lookup failure must never block the API response
      console.warn(`[resourceRequestController] Could not look up admin email: ${lookupErr.message}`);
    }

    return res.status(201).json({
      success: true,
      data: {
        id:             requestId,
        resourceType,
        requestedValue: String(requestedValue),
        description,
        status:         'pending',
        createdAt:      inserted.created_at,
      },
    });
  } catch (err) {
    console.error('submitRequest error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ── GET /api/resource-requests ──────────────────────────────
async function listRequests(req, res) {
  try {
    const userId = req.user.id;
    const role   = req.user.role;

    const page   = parseInt(req.query.page  || '1',  10);
    const limit  = parseInt(req.query.limit || '20', 10);
    const offset = (page - 1) * limit;

    const validStatus = ['pending', 'approved', 'denied'];
    const statusFilter = req.query.status && validStatus.includes(req.query.status)
      ? req.query.status
      : null;

    // Build WHERE clause
    let whereClause = '';
    const params    = [];

    if (role === 'student') {
      whereClause = 'WHERE rr.user_id = ?';
      params.push(userId);
      if (statusFilter) {
        whereClause += ' AND rr.status = ?';
        params.push(statusFilter);
      }
    } else {
      // admin — all requests
      if (statusFilter) {
        whereClause = 'WHERE rr.status = ?';
        params.push(statusFilter);
      }
    }

    // Total count
    const [[{ total }]] = await db.execute(
      `SELECT COUNT(*) AS total
       FROM resource_requests rr
       JOIN users u ON rr.user_id = u.id
       ${whereClause}`,
      params
    );

    // Paginated rows
    const [rows] = await db.execute(
      `SELECT rr.id, rr.resource_type, rr.requested_value, rr.description,
              rr.status, rr.admin_notes, rr.reviewed_at, rr.created_at,
              u.id AS student_id, u.email AS student_email, u.name AS student_name
       FROM resource_requests rr
       JOIN users u ON rr.user_id = u.id
       ${whereClause}
       ORDER BY rr.created_at DESC
       LIMIT ${parseInt(limit, 10)} OFFSET ${parseInt(offset, 10)}`,
      [...params]
    );

    const items = rows.map((r) => {
      const base = {
        id:             r.id,
        resourceType:   r.resource_type,
        requestedValue: r.requested_value,
        description:    r.description,
        status:         r.status,
        adminNotes:     r.admin_notes || null,
        reviewedAt:     r.reviewed_at || null,
        createdAt:      r.created_at,
      };
      // Include student object only for admin
      if (role === 'admin') {
        base.student = {
          id:    r.student_id,
          email: r.student_email,
          name:  r.student_name,
        };
      }
      return base;
    });

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: {
          page,
          limit,
          totalItems: total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('listRequests error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

// ── PUT /api/resource-requests/:id ──────────────────────────
async function reviewRequest(req, res) {
  try {
    const requestId = parseInt(req.params.id, 10);
    const { status, adminNotes } = req.body;

    if (!status || !['approved', 'denied'].includes(status)) {
      return res.status(400).json({
        success: false,
        error:   'VALIDATION_ERROR',
        message: 'Status must be approved or denied',
      });
    }

    // Fetch the request + student details in one query
    const [[request]] = await db.execute(
      `SELECT rr.*, u.email AS student_email, u.name AS student_name
       FROM resource_requests rr
       JOIN users u ON rr.user_id = u.id
       WHERE rr.id = ? LIMIT 1`,
      [requestId]
    );

    if (!request) {
      return res.status(404).json({ success: false, error: 'REQUEST_NOT_FOUND', message: 'Resource request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'REQUEST_ALREADY_REVIEWED', message: 'This request has already been reviewed' });
    }

    // Update the request
    await db.execute(
      `UPDATE resource_requests
       SET status = ?, admin_notes = ?, reviewed_at = NOW()
       WHERE id = ?`,
      [status, adminNotes || null, requestId]
    );

    // Auto-apply quota if approved
    let quotaApplied = false;
    if (status === 'approved') {
      const quotaColumnMap = {
        cpu:       'cpu_quota',
        ram:       'ram_quota_mb',
        storage:   'storage_quota_mb',
        projects:  'max_projects',
        databases: 'max_databases',
      };
      const column = quotaColumnMap[request.resource_type];
      if (column) {
        await db.execute(
          `UPDATE users SET ${column} = ? WHERE id = ?`,
          [request.requested_value, request.user_id]
        );
        quotaApplied = true;
      }
    }

    // Fetch reviewed_at for response
    const [[reviewed]] = await db.execute(
      'SELECT reviewed_at FROM resource_requests WHERE id = ?',
      [requestId]
    );

    // ── Email student (non-blocking) ────────────────────────
    emailService.sendResourceRequestReviewedEmail(
      request.student_email,
      request.student_name,
      request.resource_type,
      request.requested_value,
      status,
      adminNotes || null
    ).catch((emailErr) => {
      console.warn(`[resourceRequestController] Failed to notify student of review: ${emailErr.message || emailErr}`);
    });

    return res.status(200).json({
      success: true,
      data: {
        id:           requestId,
        status,
        adminNotes:   adminNotes || null,
        reviewedAt:   reviewed.reviewed_at,
        quotaApplied,
      },
    });
  } catch (err) {
    console.error('reviewRequest error:', err);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
}

module.exports = {
  submitRequest,
  listRequests,
  reviewRequest,
};
