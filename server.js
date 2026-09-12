/**
 * VS Infra & Cranes — Hardened Production Node.js & Express Backend Server
 *
 * Supports:
 * - MongoDB Atlas (via MONGODB_URI) with dual-tier local JSON mirror
 * - Customer Form Inquiries API (/api/inquiries) for Quotes, Contact, Services, AMC, Modernization
 * - Asynchronous SMTP Email Notifications to Site Administrator via Nodemailer
 * - Secure Admin Authentication (PBKDF2 Password Hashing, HMAC Bearer & Cookie Sessions, Rate-Limiting)
 * - Full Inquiries CRM (Status, Priority, Notes, Follow-Up, CSV Export)
 * - Lightweight CMS for Products, Services, Gallery, Projects, Map Pins, Contact Info, Blog, Catalog, Certificates
 * - Production Security Headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const {
  PORT,
  HOST,
  ROOT_DIR,
  MONGODB_DB_NAME,
  SMTP_HOST,
  SMTP_PORT,
  isAllowedOrigin,
  recordHttpMetric,
  recordAppError
} = require('./src/config');

const dbManager = require('./src/db');
const { checkSmtpHealth } = require('./src/email');

const healthRoutes = require('./src/routes/health');
const authRoutes = require('./src/routes/auth');
const inquiriesRoutes = require('./src/routes/inquiries');
const cmsRoutes = require('./src/routes/cms');
const analyticsRoutes = require('./src/routes/analytics');
const alertsRoutes = require('./src/routes/alerts');

const app = express();

// Trust proxy for secure headers & correct client IPs on cloud platforms (Render, Heroku, etc.)
app.set('trust proxy', 1);

// 1. Telemetry & Metrics Tracking Middleware
app.use((req, res, next) => {
  const start = Date.now();
  const originalEnd = res.end;

  res.end = function (...args) {
    const latencyMs = Date.now() - start;
    recordHttpMetric(res.statusCode, req.path, latencyMs);

    // Track HTML page views in analytics
    if (
      req.method === 'GET' &&
      !req.path.startsWith('/api/') &&
      (req.path === '/' || req.path.endsWith('.html') || !path.extname(req.path))
    ) {
      const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';
      const ua = req.headers['user-agent'] || '';
      const ref = req.headers.referer || '';
      dbManager.recordPageView(req.path, clientIp, ua, ref, req);
    }

    return originalEnd.apply(this, args);
  };
  next();
});

// 2. Production Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  const csp =
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.cartocdn.com https://server.arcgisonline.com https://*.arcgisonline.com https://raw.githubusercontent.com https://cdnjs.cloudflare.com; " +
    "media-src 'self' data: blob:; " +
    "connect-src 'self' https://*.tile.openstreetmap.org https://*.cartocdn.com https://server.arcgisonline.com https://*.arcgisonline.com; " +
    "frame-src 'self' https://www.google.com https://maps.google.com; " +
    "frame-ancestors 'self'; " +
    "worker-src 'self' blob:; " +
    "object-src 'none';";
  res.setHeader('Content-Security-Policy', csp);

  next();
});

// 3. Sensitive File Access Blocker Middleware
const DISALLOWED_FILES = new Set([
  'package.json',
  'package-lock.json',
  'server.py',
  'server.js',
  'procfile',
  'requirements.txt',
  'deployment.md',
  'project_state.md',
  'prompt_extract.txt',
  'vs_cranes_local.db'
]);

const DISALLOWED_EXTENSIONS = new Set([
  '.env', '.key', '.pem', '.py', '.pyc', '.pyo',
  '.db', '.sqlite', '.sqlite3', '.log', '.bak', '.swp', '.sh'
]);

app.use((req, res, next) => {
  const reqPath = decodeURIComponent(req.path);
  const cleanPathLower = reqPath.toLowerCase();

  // Traversal check
  if (reqPath.includes('..') || reqPath.includes('//') || reqPath.includes('\\')) {
    return res.status(403).send('Forbidden: Path traversal blocked.');
  }

  // Hidden files (.env, .git, etc.)
  const parts = cleanPathLower.split('/').filter(Boolean);
  for (const p of parts) {
    if (p.startsWith('.')) {
      return res.status(404).send('Not Found');
    }
  }

  // Blocked directory prefixes
  if (
    cleanPathLower.startsWith('/data') ||
    cleanPathLower.startsWith('/src') ||
    cleanPathLower.startsWith('/node_modules') ||
    cleanPathLower.startsWith('/.venv') ||
    cleanPathLower.startsWith('/lib')
  ) {
    return res.status(403).send('Forbidden: Direct access disallowed.');
  }

  // Blocked file extensions and file names
  const ext = path.extname(cleanPathLower);
  if (DISALLOWED_EXTENSIONS.has(ext)) {
    return res.status(404).send('Not Found');
  }

  const baseName = path.basename(cleanPathLower);
  if (DISALLOWED_FILES.has(baseName) || baseName.startsWith('test_') || baseName.startsWith('fix_')) {
    return res.status(404).send('Not Found');
  }

  next();
});

// 4. CORS Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true
  })
);

// 5. Body Parsing
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// 6. Cookie Parser Helper
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const list = cookieHeader.split(';');
    for (const item of list) {
      const [k, v] = item.trim().split('=');
      if (k && v) {
        req.cookies[k] = decodeURIComponent(v);
      }
    }
  }
  next();
});

// 7. API Routes
app.use('/api', healthRoutes);
app.use('/api/admin', authRoutes);
app.use('/api', inquiriesRoutes);
app.use('/api', cmsRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', alertsRoutes);

// 8. Static File Serving
// Root index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

// Static assets (HTML, CSS, JS, Images, PDFs, 3D GLTF models)
app.use(
  express.static(ROOT_DIR, {
    dotfiles: 'deny',
    index: false,
    maxAge: '1h'
  })
);

// 9. 404 Fallback Handler
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  const notFoundPath = path.join(ROOT_DIR, '404.html');
  if (fs.existsSync(notFoundPath)) {
    res.status(404).sendFile(notFoundPath);
  } else {
    res.status(404).send('404 Not Found');
  }
});

// 10. Global Error Handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err && req.path === '/api/analytics/event') {
    return res.status(200).json({ success: true, message: 'Malformed event payload safely handled' });
  }
  recordAppError(req.path, req.method, 500, err);
  console.error(`[Server Error] ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: 'Internal server error occurred.' });
});

// 11. Server Start
async function startServer() {
  await dbManager.connect();
  const smtpStatus = await checkSmtpHealth();

  console.log('============================================================');
  console.log('VS INFRA & CRANES — PRODUCTION NODE.JS / EXPRESS SERVER');
  console.log('============================================================');
  console.log(`Server Status:     RUNNING on http://${HOST}:${PORT}`);
  console.log(`MongoDB Primary:   ${dbManager.getDbStatus().database} (Target DB: '${MONGODB_DB_NAME}')`);
  console.log(`SMTP Service:      ${smtpStatus.status} (${SMTP_HOST}:${SMTP_PORT})`);
  console.log('Admin Security:    ACTIVE (PBKDF2-HMAC-SHA256 Auth & Rate Limiting)');
  console.log('============================================================');

  const server = app.listen(PORT, HOST, () => {
    console.log(`Express server listening on ${HOST}:${PORT}`);
  });

  const shutdown = () => {
    console.log('\nGracefully shutting down Node.js server...');
    server.close(() => {
      console.log('HTTP server closed.');
      if (dbManager.client) {
        dbManager.client.close().then(() => {
          console.log('MongoDB connection closed.');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = app;
