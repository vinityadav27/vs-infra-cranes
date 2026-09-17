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

    // Secure Client IP extraction: Use Express req.ip with configured trust proxy (1 hop for MilesWeb reverse proxy)
    const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';

    if (isAnalyticsRateLimited(clientIp)) {
      return res.status(429).json({ success: false, error: 'Analytics rate limit exceeded' });
    }

    const geo = await resolveApproxGeo(req, clientIp);
    const uaRaw = String(req.headers['user-agent'] || '');
    const uaLower = uaRaw.toLowerCase();
    const pathStr = String(payload.path || '/index.html').trim();

    // Determine internal/test/bot traffic sources
    let sourceTag = String(payload.source || '').trim();
    const cleanIp = clientIp.replace(/^::ffff:/, '');
    const isLoopback = ['127.0.0.1', '::1', '0.0.0.0', 'localhost'].includes(cleanIp);

    const BOT_REGEX = /bot|crawl|spider|slurp|mediapartners|googlebot|bingbot|yandex|duckduckbot|baiduspider|sogou|ahrefs|semrush|dotbot|mj12bot|screaming frog|petalbot|curl|wget|python|httpie|node-fetch|axios|go-http-client|postman|headlesschrome|phantomjs|selenium|puppeteer|lighthouse|uptime|pingdom|freshping|uptimerobot|statuscake/i;

    if (isLoopback) {
      sourceTag = sourceTag || 'dev_local';
    } else if (pathStr === '/admin.html' || pathStr.startsWith('/admin')) {
      sourceTag = 'admin';
    } else if (BOT_REGEX.test(uaLower)) {
      sourceTag = 'bot';
    } else if (req.headers['x-test-mode'] || sourceTag === 'test') {
      sourceTag = 'test';
    } else if (req.headers['x-purpose'] === 'health-check' || pathStr === '/health') {
      sourceTag = 'health_check';
    }

    // Geolocation is resolved server-side from proxy headers, never guessed or hardcoded
    const country = geo.country || 'Unknown / Not Available';
    const city = geo.city || 'Unknown / Not Available';

    const eventData = {
      path: pathStr || '/index.html',
      event_type: String(payload.event_type || payload.event || 'page_view').trim().slice(0, 50),
      visitor_id: String(payload.visitor_id || '').trim().slice(0, 64),
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
      country: country,
      city: city,
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
