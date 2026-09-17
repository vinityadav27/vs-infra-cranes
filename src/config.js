/**
 * VS Infra & Cranes — Configuration & Utility Module
 */

const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = (process.env.HOST || '0.0.0.0').trim();
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CERTIFICATES_DIR = path.join(ROOT_DIR, 'assets', 'documents', 'certificates');
const CMS_FILE = path.join(DATA_DIR, 'cms_content.json');
const JSON_FILE = path.join(DATA_DIR, 'inquiries.json');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics_events.json');

const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
const MONGODB_DB_NAME = (process.env.MONGODB_DB_NAME || 'vs_infra_cranes').trim();

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'vsinfracranes@gmail.com').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || '').trim();
const SECRET_KEY = (process.env.SECRET_KEY || '').trim() || crypto.randomBytes(32).toString('hex');

const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const CORS_ORIGINS_RAW = (process.env.CORS_ORIGINS || '').trim();
const CORS_ORIGINS = CORS_ORIGINS_RAW
  ? CORS_ORIGINS_RAW.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  : [];

// Standard origins always permitted
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost',
  'http://127.0.0.1',
  'https://vsinfracranes.com',
  'https://www.vsinfracranes.com'
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const o = origin.toLowerCase().replace(/\/+$/, '');
  for (const allowed of DEFAULT_ALLOWED_ORIGINS) {
    if (o === allowed || o.startsWith(allowed + ':')) return true;
  }
  for (const custom of CORS_ORIGINS) {
    if (o === custom || o.startsWith(custom + ':')) return true;
  }
  if (o.endsWith('.onrender.com') || o.endsWith('.vercel.app')) return true;
  return false;
}

const SMTP_HOST = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10) || 587;
const SMTP_USER = (process.env.SMTP_USER || '').trim();
const SMTP_PASS = (process.env.SMTP_PASS || '').trim();
const NOTIFICATION_EMAIL = (process.env.NOTIFICATION_EMAIL || ADMIN_EMAIL).trim();

// Metrics tracking in-memory
const SERVER_START_TIME = Date.now();
let TOTAL_REQUESTS = 0;
const HTTP_METRICS = {
  '2xx': 0,
  '3xx': 0,
  '4xx': 0,
  '5xx': 0,
  by_path: {}
};
const API_LATENCY_SAMPLES = [];
const MAX_LATENCY_SAMPLES = 1000;
const RECENT_ERRORS = [];
const MAX_RECENT_ERRORS = 50;
const ADMIN_AUTH_FAILURES = [];
const MAX_AUTH_FAILURES = 100;
const ACTIVE_SESSIONS = new Map(); // sessionId -> timestamp

function recordHttpMetric(statusCode, pathUrl, latencyMs) {
  TOTAL_REQUESTS++;
  const group = `${Math.floor(statusCode / 100)}xx`;
  if (HTTP_METRICS[group] !== undefined) {
    HTTP_METRICS[group]++;
  }
  const cleanPath = (pathUrl || '/').split('?')[0].slice(0, 100);
  HTTP_METRICS.by_path[cleanPath] = (HTTP_METRICS.by_path[cleanPath] || 0) + 1;

  if (typeof latencyMs === 'number') {
    API_LATENCY_SAMPLES.push(latencyMs);
    if (API_LATENCY_SAMPLES.length > MAX_LATENCY_SAMPLES) {
      API_LATENCY_SAMPLES.shift();
    }
  }
}

function recordAppError(pathUrl, method, status, error) {
  RECENT_ERRORS.push({
    timestamp: new Date().toISOString(),
    path: String(pathUrl || '').slice(0, 100),
    method: String(method || '').slice(0, 10),
    status: parseInt(status, 10) || 500,
    error: error instanceof Error ? error.message : String(error)
  });
  if (RECENT_ERRORS.length > MAX_RECENT_ERRORS) {
    RECENT_ERRORS.shift();
  }
}

function recordAdminAuthFailure(ip, reason) {
  ADMIN_AUTH_FAILURES.push({
    timestamp: new Date().toISOString(),
    ip: String(ip || '').slice(0, 50),
    reason: String(reason || '').slice(0, 100)
  });
  if (ADMIN_AUTH_FAILURES.length > MAX_AUTH_FAILURES) {
    ADMIN_AUTH_FAILURES.shift();
  }
}

function sanitizeText(val) {
  if (!val) return '';
  return String(val)
    .replace(/\0/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function parseUserAgent(ua) {
  if (!ua || typeof ua !== 'string' || !ua.trim()) {
    return { device: 'Unknown', browser: 'Unknown', os: 'Unknown' };
  }
  const u = ua.toLowerCase();

  // 1. Device detection (Desktop, Mobile, Tablet, or Unknown)
  let device = 'Desktop';
  const isTablet = /ipad|tablet|(android(?!.*mobile))|silk|playbook|kindle/i.test(u);
  const isMobile = /mobile|iphone|ipod|blackberry|phone|iemobile|opera mini|android.*mobile/i.test(u);

  if (isTablet) {
    device = 'Tablet';
  } else if (isMobile) {
    device = 'Mobile';
  } else if (/windows|macintosh|linux|cros|x11/i.test(u)) {
    device = 'Desktop';
  } else {
    device = 'Desktop';
  }

  // 2. OS detection (macOS, Windows, Android, iOS, Linux, Other, Unknown)
  let os = 'Other';
  if (/windows nt|windows/i.test(u)) {
    os = 'Windows';
  } else if (/iphone|ipad|ipod/i.test(u)) {
    os = 'iOS';
  } else if (/android/i.test(u)) {
    os = 'Android';
  } else if (/macintosh|mac os x/i.test(u)) {
    os = 'macOS';
  } else if (/cros/i.test(u)) {
    os = 'ChromeOS';
  } else if (/linux|x11/i.test(u)) {
    os = 'Linux';
  }

  // 3. Browser detection (Chrome, Safari, Firefox, Edge, Opera, Internet Explorer, Other, Unknown)
  let browser = 'Other';
  if (/edg\/|edge\/|edgios\/|edga\//i.test(u)) {
    browser = 'Edge';
  } else if (/opr\/|opera/i.test(u)) {
    browser = 'Opera';
  } else if (/chrome\/|crios\/|crmo\//i.test(u)) {
    browser = 'Chrome';
  } else if (/firefox\/|fxios\//i.test(u)) {
    browser = 'Firefox';
  } else if (/safari\//i.test(u) && !/chrome\/|crios\/|edg\/|opr\//i.test(u)) {
    browser = 'Safari';
  } else if (/msie|trident/i.test(u)) {
    browser = 'Internet Explorer';
  }

  return { device, browser, os };
}

function categorizeLeadSource({ referrer = '', utm_source = '', utm_medium = '' } = {}) {
  const s = String(utm_source || '').toLowerCase();
  const m = String(utm_medium || '').toLowerCase();
  const r = String(referrer || '').toLowerCase();

  if (s.includes('google') && (m.includes('cpc') || m.includes('ppc') || m.includes('ad'))) return 'Google Ads';
  if (s.includes('facebook') || s.includes('meta') || s.includes('instagram')) return 'Social Media';
  if (s.includes('linkedin')) return 'LinkedIn';
  if (s.includes('newsletter') || m.includes('email')) return 'Email Marketing';

  if (r) {
    if (r.includes('google.')) return 'Google Organic';
    if (r.includes('bing.') || r.includes('yahoo.')) return 'Search Engine';
    if (r.includes('indiamart.') || r.includes('tradeindia.') || r.includes('justdial.')) return 'B2B Portal';
    if (r.includes('linkedin.')) return 'LinkedIn';
    if (r.includes('whatsapp') || r.includes('wa.me')) return 'WhatsApp';
    return 'Referral';
  }

  return 'Direct Traffic';
}

const GEO_CACHE = new Map();
const MAX_GEO_CACHE = 5000;

function cacheGeoResult(ip, result) {
  if (!ip) return;
  if (GEO_CACHE.size >= MAX_GEO_CACHE) {
    const firstKey = GEO_CACHE.keys().next().value;
    GEO_CACHE.delete(firstKey);
  }
  GEO_CACHE.set(ip, result);
}

async function resolveApproxGeo(req, clientIp = '') {
  if (!req && !clientIp) {
    return { country: 'Unknown / Not Available', city: 'Unknown / Not Available', region: 'Unknown / Not Available' };
  }

  const rawIp = String(clientIp || (req && req.ip) || '').replace(/^::ffff:/, '').trim();
  if (!rawIp) {
    return { country: 'Unknown / Not Available', city: 'Unknown / Not Available', region: 'Unknown / Not Available' };
  }

  if (GEO_CACHE.has(rawIp)) {
    return GEO_CACHE.get(rawIp);
  }

  // 1. Private / Loopback IPs: Never query external provider
  const isPrivate =
    ['127.0.0.1', '::1', '0.0.0.0', 'localhost'].includes(rawIp) ||
    rawIp.startsWith('10.') ||
    rawIp.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(rawIp) ||
    rawIp.startsWith('169.254.') ||
    rawIp.startsWith('fc') ||
    rawIp.startsWith('fe80');

  if (isPrivate) {
    const loopResult = {
      country: 'Unknown / Not Available',
      city: 'Unknown / Not Available',
      region: 'Unknown / Not Available'
    };
    cacheGeoResult(rawIp, loopResult);
    return loopResult;
  }

  // 2. Upstream Proxy Geolocation Headers (if present)
  const headerCountry = req && req.headers ? (req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || '') : '';
  const headerCity = req && req.headers ? (req.headers['cf-ipcity'] || req.headers['x-vercel-ip-city'] || '') : '';
  const headerRegion = req && req.headers ? (req.headers['cf-ipregion'] || req.headers['x-vercel-ip-country-region'] || '') : '';

  if (headerCountry && headerCountry.trim() && headerCountry.trim() !== 'XX' && headerCountry.trim() !== 'T1') {
    const result = {
      country: headerCountry.trim(),
      city: headerCity.trim() || 'Unknown / Not Available',
      region: headerRegion.trim() || 'Unknown / Not Available'
    };
    cacheGeoResult(rawIp, result);
    return result;
  }

  // 3. MilesWeb Server-Side Geolocation Lookup
  // Uses server-side HTTPS lookup without any client-side exposure.
  // Supports optional process.env.GEOLOCATION_API_KEY / process.env.IPINFO_TOKEN,
  // or falls back to keyless HTTPS IP geolocation (ipwho.is).
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    let apiUrl = '';
    const apiKey = process.env.GEOLOCATION_API_KEY || process.env.IPINFO_TOKEN || '';
    if (apiKey) {
      apiUrl = `https://ipinfo.io/${encodeURIComponent(rawIp)}?token=${encodeURIComponent(apiKey)}`;
    } else {
      apiUrl = `https://ipwho.is/${encodeURIComponent(rawIp)}`;
    }

    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      let country = '';
      let city = '';
      let region = '';

      if (apiKey && data.country) {
        country = data.country || '';
        city = data.city || '';
        region = data.region || '';
      } else if (data && data.success) {
        country = data.country || '';
        city = data.city || '';
        region = data.region || '';
      }

      const cleanCountry = country.trim();
      const cleanCity = city.trim();
      const cleanRegion = region.trim();

      if (cleanCountry && cleanCountry !== 'Unknown') {
        const result = {
          country: cleanCountry,
          city: cleanCity || 'Unknown / Not Available',
          region: cleanRegion || 'Unknown / Not Available'
        };
        cacheGeoResult(rawIp, result);
        return result;
      }
    }
  } catch (err) {
    // Network isolation, provider timeout, or connection error safely handled
  }

  const fallbackResult = {
    country: 'Unknown / Not Available',
    city: 'Unknown / Not Available',
    region: 'Unknown / Not Available'
  };
  cacheGeoResult(rawIp, fallbackResult);
  return fallbackResult;
}

module.exports = {
  PORT,
  HOST,
  ROOT_DIR,
  DATA_DIR,
  CERTIFICATES_DIR,
  CMS_FILE,
  JSON_FILE,
  ANALYTICS_FILE,
  MONGODB_URI,
  MONGODB_DB_NAME,
  ADMIN_EMAIL,
  ADMIN_PASS,
  SECRET_KEY,
  BASE_URL,
  isAllowedOrigin,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  NOTIFICATION_EMAIL,
  SERVER_START_TIME,
  TOTAL_REQUESTS,
  HTTP_METRICS,
  API_LATENCY_SAMPLES,
  RECENT_ERRORS,
  ADMIN_AUTH_FAILURES,
  ACTIVE_SESSIONS,
  recordHttpMetric,
  recordAppError,
  recordAdminAuthFailure,
  sanitizeText,
  parseUserAgent,
  categorizeLeadSource,
  resolveApproxGeo
};
