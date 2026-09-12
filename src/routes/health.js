/**
 * Health, Telemetry & System Status Routes
 */

const express = require('express');
const router = express.Router();
const dbManager = require('../db');
const { checkSmtpHealth } = require('../email');
const { verifyToken, requireAuth } = require('../auth');
const { SMTP_USER, SMTP_PASS, SMTP_HOST, SMTP_PORT } = require('../config');

// GET /api/health
router.get('/health', (req, res) => {
  let isAuth = false;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    isAuth = verifyToken(authHeader.slice(7).trim());
  } else if (req.headers['x-admin-token']) {
    isAuth = verifyToken(req.headers['x-admin-token'].trim());
  }

  if (isAuth) {
    return res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbManager.getDbStatus(),
      smtp: {
        configured: Boolean(SMTP_USER && SMTP_PASS),
        host: SMTP_HOST,
        port: SMTP_PORT
      }
    });
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// GET /api/admin/system-status
router.get('/admin/system-status', requireAuth, async (req, res) => {
  const statusData = dbManager.getDbStatus();
  statusData.smtp = await checkSmtpHealth();
  const stats = await dbManager.getStats();
  statusData.total_inquiries = stats.total;
  res.json(statusData);
});

// GET & POST /api/admin/smtp-test
router.all('/admin/smtp-test', requireAuth, async (req, res) => {
  const smtpResult = await checkSmtpHealth();
  res.json(smtpResult);
});

module.exports = router;
