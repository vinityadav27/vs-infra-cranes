/**
 * Analytics & Traffic Telemetry Routes
 */

const express = require('express');
const router = express.Router();
const dbManager = require('../db');
const { requireAuth, isAnalyticsRateLimited } = require('../auth');
const { resolveApproxGeo, parseUserAgent } = require('../config');
const { checkSmtpHealth } = require('../email');

// POST /api/analytics/event (Public telemetry tracking)
router.post('/analytics/event', async (req, res) => {
  try {
    let payload = req.body;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        payload = {};
      }
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      payload = {};
    }

    const clientIp =
      req.headers['cf-connecting-ip'] ||
      (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : '') ||
      req.ip ||
      req.connection?.remoteAddress ||
      '127.0.0.1';

    if (isAnalyticsRateLimited(clientIp)) {
      return res.status(429).json({ success: false, error: 'Analytics rate limit exceeded' });
    }

    const geo = resolveApproxGeo(req);
    const uaRaw = String(req.headers['user-agent'] || '');
    const uaLower = uaRaw.toLowerCase();
    const pathStr = String(payload.path || '/index.html').trim();

    // Determine internal/test traffic sources
    let sourceTag = String(payload.source || '').trim();
    const cleanIp = clientIp.replace(/^::ffff:/, '');
    const isLoopback = ['127.0.0.1', '::1', '0.0.0.0', 'localhost'].includes(cleanIp);

    if (isLoopback) {
      sourceTag = sourceTag || 'dev_local';
    } else if (pathStr === '/admin.html' || pathStr.startsWith('/admin')) {
      sourceTag = 'admin';
    } else if (uaLower.includes('bot') || uaLower.includes('crawl') || uaLower.includes('spider') || uaLower.includes('curl') || uaLower.includes('wget') || uaLower.includes('python') || uaLower.includes('httpie')) {
      sourceTag = 'bot';
    } else if (req.headers['x-test-mode'] || sourceTag === 'test') {
      sourceTag = 'test';
    } else if (req.headers['x-purpose'] === 'health-check' || pathStr === '/health') {
      sourceTag = 'health_check';
    }

    // Ensure approximate location never uses fake data
    let country = String(payload.country || '').trim();
    let city = String(payload.city || '').trim();
    if (!country || country === 'Unknown' || country === 'India') {
      country = geo.country;
    }
    if (!city || city === 'Unknown' || city === 'Faridabad') {
      city = geo.city;
    }

    const eventData = {
      path: pathStr || '/index.html',
      event_type: String(payload.event_type || payload.event || 'page_view').trim().slice(0, 50),
      client_ip: clientIp,
      user_agent: uaRaw.slice(0, 300),
      referrer: String(payload.referrer || req.headers.referer || '').trim().slice(0, 300),
      session_id: String(payload.session_id || '').trim().slice(0, 64),
      product_id: String(payload.product_id || '').trim().slice(0, 64),
      product_name: String(payload.product_name || '').trim().slice(0, 100),
      service_id: String(payload.service_id || '').trim().slice(0, 64),
      service_name: String(payload.service_name || '').trim().slice(0, 100),
      landing_page: String(payload.landing_page || pathStr || '').trim().slice(0, 150),
      utm_source: String(payload.utm_source || '').trim().slice(0, 60),
      utm_medium: String(payload.utm_medium || '').trim().slice(0, 60),
      utm_campaign: String(payload.utm_campaign || '').trim().slice(0, 60),
      country: country || 'Unknown / Not Available',
      city: city || 'Unknown / Not Available',
      source: sourceTag,
      meta: payload.meta || payload.data || {}
    };

    await dbManager.recordAnalyticsEvent(eventData);
    res.json({ success: true, message: 'Event tracked' });
  } catch (err) {
    console.warn('Analytics event ingestion handled error:', err.message);
    res.status(200).json({ success: true, message: 'Event handled' });
  }
});

// GET /api/admin/analytics/summary (Dashboard summary by period)
router.get('/admin/analytics/summary', requireAuth, async (req, res) => {
  const period = req.query.period || '7d';
  const summary = await dbManager.getAnalyticsSummary(period);
  res.json(summary);
});

// GET /api/admin/analytics/health (System operational telemetry)
router.get('/admin/analytics/health', requireAuth, async (req, res) => {
  const health = await dbManager.getAnalyticsHealth();
  health.smtp = await checkSmtpHealth();
  res.json(health);
});

module.exports = router;
