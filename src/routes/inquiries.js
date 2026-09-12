/**
 * Customer Inquiries & CRM Management Routes
 */

const express = require('express');
const router = express.Router();
const dbManager = require('../db');
const { sendEmailNotificationAsync } = require('../email');
const {
  requireAuth,
  isInquiryRateLimited,
  recordInquiryAttempt,
  checkDuplicateSubmission,
  recordSubmission
} = require('../auth');
const { resolveApproxGeo, parseUserAgent } = require('../config');

// POST /api/inquiries (Public lead intake)
router.post('/inquiries', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';

  if (isInquiryRateLimited(clientIp)) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests. Please wait a few moments before submitting again.'
    });
  }

  const payload = req.body || {};
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const phone = String(payload.phone || '').trim();
  const message = String(payload.message || '').trim();

  // Validation
  if (!name || name.length < 2) {
    return res.status(400).json({ success: false, error: 'Please provide a valid name (at least 2 characters).' });
  }
  if (name.length > 120) {
    return res.status(400).json({ success: false, error: 'Name exceeds maximum length of 120 characters.' });
  }
  if (!email && !phone) {
    return res.status(400).json({ success: false, error: 'Please provide either an email address or phone number.' });
  }
  if (email && !/^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }
  if (phone && phone.replace(/[^\d+]/g, '').length < 7) {
    return res.status(400).json({ success: false, error: 'Please provide a valid phone number (at least 7 digits).' });
  }
  if (message.length > 5000) {
    return res.status(400).json({ success: false, error: 'Message exceeds maximum length of 5000 characters.' });
  }

  // Duplicate check
  const contactKey = email || phone;
  const duplicateFp = `${contactKey}::${message.slice(0, 50)}`;
  if (checkDuplicateSubmission(duplicateFp)) {
    const existing = await dbManager.getInquiries({ search: contactKey, limit: 1 });
    const lastRecord = existing.inquiries[0] || {};
    return res.status(200).json({
      success: true,
      message: 'Inquiry already received. Thank you!',
      inquiryId: lastRecord.id,
      inquiry: lastRecord,
      data: lastRecord
    });
  }

  recordInquiryAttempt(clientIp);

  // Enrich with request context if missing
  const geo = resolveApproxGeo(req);
  const ua = parseUserAgent(req.headers['user-agent']);
  payload.approx_country = payload.approx_country || geo.country;
  payload.approx_city = payload.approx_city || geo.city;
  payload.approx_geo = payload.approx_geo || `${geo.city}, ${geo.country}`;
  payload.device = payload.device || ua.device;
  payload.browser = payload.browser || ua.browser;
  payload.os = payload.os || ua.os;

  try {
    const savedRecord = await dbManager.saveInquiry(payload);
    recordSubmission(duplicateFp);

    // Record inquiry_submitted event in analytics
    dbManager.recordAnalyticsEvent({
      path: payload.source_page || '/request-quote.html',
      event_type: 'inquiry_submitted',
      client_ip: clientIp,
      user_agent: req.headers['user-agent'] || '',
      referrer: payload.referrer || payload.initial_referrer || '',
      session_id: payload.session_id || '',
      product_id: payload.equipment_type || '',
      product_name: payload.equipment_type || payload.product_context || '',
      service_id: payload.service_type || '',
      service_name: payload.service_type || payload.service_context || '',
      landing_page: payload.landing_page || '',
      utm_source: payload.utm_source || '',
      utm_medium: payload.utm_medium || '',
      utm_campaign: payload.utm_campaign || '',
      country: payload.approx_country || geo.country,
      city: payload.approx_city || geo.city,
      source: payload.lead_source || ''
    }).catch(() => {});

    // Trigger async SMTP notification
    sendEmailNotificationAsync(savedRecord);

    res.status(201).json({
      success: true,
      message: 'Inquiry successfully recorded in persistent database.',
      inquiryId: savedRecord.id,
      inquiry: savedRecord,
      data: savedRecord
    });
  } catch (err) {
    console.error('[Inquiry Error] Failed to save inquiry:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to process inquiry. Please try again or contact support.'
    });
  }
});

// GET /api/admin/inquiries (Authenticated list)
router.get('/admin/inquiries', requireAuth, async (req, res) => {
  const result = await dbManager.getInquiries({
    search: req.query.search || '',
    type: req.query.type || '',
    status: req.query.status || '',
    priority: req.query.priority || '',
    page: req.query.page || 1,
    limit: req.query.limit || 20
  });
  res.json({ success: true, ...result });
});

// GET /api/admin/inquiries/export (CSV export)
router.get('/admin/inquiries/export', requireAuth, async (req, res) => {
  const { inquiries } = await dbManager.getInquiries({ limit: 5000 });
  const headers = [
    'Inquiry ID', 'Date & Time', 'Customer Name', 'Company', 'Email', 'Phone',
    'Subject', 'Service Type', 'Equipment Type', 'Capacity', 'Span', 'Lift',
    'Duty Class', 'Location', 'Message', 'Status', 'Priority', 'Admin Notes',
    'Follow-up Date', 'Source Page', 'Lead Acquisition Channel', 'Initial Referrer', 'Landing Page',
    'UTM Source', 'UTM Medium', 'UTM Campaign', 'Product Context', 'Approx Country', 'Approx City', 'Approx Geo',
    'Device', 'Browser', 'OS'
  ];

  function escapeCsv(val) {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
    return `"${s}"`;
  }

  const rows = [headers.map(escapeCsv).join(',')];
  for (const inq of inquiries) {
    const row = [
      inq.id || '',
      inq.created_at || '',
      inq.name || '',
      inq.company || '',
      inq.email || '',
      inq.phone || '',
      inq.subject || '',
      inq.service_type || '',
      inq.equipment_type || '',
      inq.capacity || '',
      inq.span || '',
      inq.lift || '',
      inq.duty_class || '',
      inq.location || '',
      inq.message || '',
      inq.status || '',
      inq.priority || 'Normal',
      inq.admin_notes || '',
      inq.follow_up_date || '',
      inq.source_page || '',
      inq.lead_source || 'Direct',
      inq.referrer || '',
      inq.landing_page || '',
      inq.utm_source || '',
      inq.utm_medium || '',
      inq.utm_campaign || '',
      inq.product_context || '',
      inq.approx_country || '',
      inq.approx_city || '',
      inq.approx_geo || '',
      inq.device || '',
      inq.browser || '',
      inq.os || ''
    ];
    rows.push(row.map(escapeCsv).join(','));
  }

  const csvContent = rows.join('\r\n');
  const filename = `inquiries_export_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvContent);
});

// GET /api/admin/stats
router.get('/admin/stats', requireAuth, async (req, res) => {
  const stats = await dbManager.getStats({
    search: req.query.search || '',
    type: req.query.type || '',
    status: req.query.status || '',
    priority: req.query.priority || ''
  });
  res.json(stats);
});

// GET /api/admin/inquiries/:id
router.get('/admin/inquiries/:id', requireAuth, async (req, res) => {
  const item = await dbManager.getInquiryById(req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, error: 'Inquiry not found' });
  }
  res.json({ success: true, inquiry: item, data: item });
});

// PUT & PATCH /api/admin/inquiries/:id
const updateInquiryHandler = async (req, res) => {
  const updated = await dbManager.updateInquiry(req.params.id, req.body || {});
  if (!updated) {
    return res.status(404).json({ success: false, error: 'Inquiry not found' });
  }
  res.json({ success: true, message: 'Inquiry updated', inquiry: updated, data: updated });
};

router.put('/admin/inquiries/:id', requireAuth, updateInquiryHandler);
router.patch('/admin/inquiries/:id', requireAuth, updateInquiryHandler);

// DELETE /api/admin/inquiries/:id
router.delete('/admin/inquiries/:id', requireAuth, async (req, res) => {
  const success = await dbManager.deleteInquiry(req.params.id);
  if (!success) {
    return res.status(404).json({ success: false, error: 'Inquiry not found or already deleted' });
  }
  res.json({ success: true, message: 'Inquiry deleted successfully' });
});

module.exports = router;
