'use strict';

const express = require('express');
const router = express.Router();
const webhookService = require('../services/webhookService');

// ─── Webhook route — no JWT auth, authenticated via webhook secret ────────────
// Raw body must be preserved for HMAC-SHA256 signature validation.
// This middleware captures the raw body before express.json() processes it.
router.post(
  '/github/:projectId',
  express.raw({ type: 'application/json', limit: '10mb' }),
  (req, res, next) => {
    // Preserve raw body for signature validation and parse JSON manually
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body;
      try {
        req.body = JSON.parse(req.body.toString('utf8'));
      } catch (_) {
        req.body = {};
      }
    }
    next();
  },
  webhookService.handleGithubWebhook
);

module.exports = router;
