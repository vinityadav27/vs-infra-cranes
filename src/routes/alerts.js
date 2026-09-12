/**
 * Operational Alerts Routes
 */

const express = require('express');
const router = express.Router();
const dbManager = require('../db');
const { requireAuth } = require('../auth');

// GET /api/admin/alerts
router.get('/admin/alerts', requireAuth, async (req, res) => {
  const status = req.query.status || req.query.resolved || 'all';
  const alerts = await dbManager.getAlerts(status);
  res.json({ success: true, alerts });
});

// POST /api/admin/alerts/resolve-all
router.post('/admin/alerts/resolve-all', requireAuth, async (req, res) => {
  const count = await dbManager.resolveAllAlerts();
  res.json({ success: true, resolved_count: count });
});

// PUT & PATCH /api/admin/alerts/:id
const resolveAlertHandler = async (req, res) => {
  const success = await dbManager.resolveAlert(req.params.id);
  if (success) {
    res.json({ success: true, message: 'Alert marked as resolved' });
  } else {
    res.status(404).json({ success: false, error: 'Alert not found or already resolved' });
  }
};

router.put('/admin/alerts/:id', requireAuth, resolveAlertHandler);
router.patch('/admin/alerts/:id', requireAuth, resolveAlertHandler);

module.exports = router;
