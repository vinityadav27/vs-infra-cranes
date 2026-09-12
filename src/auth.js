/**
 * VS Infra & Cranes — Authentication, Security & Rate Limiting Module
 */

const crypto = require('crypto');
const {
  ADMIN_EMAIL,
  ADMIN_PASS,
  SECRET_KEY,
  recordAdminAuthFailure
} = require('./config');

// In-Memory Rate Limiting & Revocation Tables
const REVOKED_TOKENS = new Map(); // token -> revokedTimestamp
const LOGIN_ATTEMPTS = new Map(); // ip -> [timestamps]
const INQUIRY_ATTEMPTS = new Map(); // ip -> [timestamps]
const RECENT_SUBMISSIONS = new Map(); // fingerprint -> timestamp
const ANALYTICS_ATTEMPTS = new Map(); // ip -> [timestamps]
const UPLOAD_ATTEMPTS = new Map(); // ip -> [timestamps]
const ADMIN_MUTATION_ATTEMPTS = new Map(); // ip -> [timestamps]

const LOGIN_LOCKOUT_MINUTES = 15;
const MAX_LOGIN_ATTEMPTS = 5;

// Password Hashing (PBKDF2-HMAC-SHA256, 100,000 iterations)
function hashPassword(password, saltHex = null) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return `pbkdf2:sha256:100000$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, hashedStr) {
  if (!hashedStr || !password) return false;
  if (!hashedStr.startsWith('pbkdf2:')) {
    try {
      return crypto.timingSafeEqual(Buffer.from(password), Buffer.from(hashedStr));
    } catch {
      return false;
    }
  }

  try {
    const parts = hashedStr.split('$');
    if (parts.length !== 3) return false;
    const [, saltHex, keyHex] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const expectedKey = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    const actualKey = Buffer.from(keyHex, 'hex');
    if (expectedKey.length !== actualKey.length) return false;
    return crypto.timingSafeEqual(expectedKey, actualKey);
  } catch (err) {
    return false;
  }
}

// Global precomputed admin hash
let ADMIN_PASS_HASH = ADMIN_PASS ? hashPassword(ADMIN_PASS) : '';
if (!ADMIN_PASS) {
  console.warn('[SECURITY WARNING] ADMIN_PASS is not set in environment. Admin portal login will remain locked.');
}

// Token Handling
function generateToken(email) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.createHash('sha256').update(crypto.randomBytes(16)).digest('hex').slice(0, 8);
  const payload = `${email}:${timestamp}:${nonce}`;
  const sig = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex');
  return `${email}:${timestamp}:${nonce}:${sig}`;
}

function verifyToken(tokenStr) {
  if (!tokenStr) return false;
  const nowSec = Math.floor(Date.now() / 1000);

  if (REVOKED_TOKENS.has(tokenStr)) {
    return false;
  }

  const parts = tokenStr.split(':');
  let email, timestamp, nonce, sig, payload;
  if (parts.length === 4) {
    [email, timestamp, nonce, sig] = parts;
    payload = `${email}:${timestamp}:${nonce}`;
  } else if (parts.length === 3) {
    [email, timestamp, sig] = parts;
    payload = `${email}:${timestamp}`;
  } else {
    return false;
  }

  try {
    const tokenTime = parseInt(timestamp, 10);
    // Valid for 24 hours (86400s)
    if (nowSec - tokenTime > 86400 || tokenTime > nowSec + 300) {
      return false;
    }

    const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return false;
    }

    return email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  } catch {
    return false;
  }
}

function revokeToken(tokenStr) {
  if (!tokenStr) return;
  const now = Date.now();
  // Prune expired (> 24h)
  for (const [t, ts] of REVOKED_TOKENS.entries()) {
    if (now - ts > 86400000) {
      REVOKED_TOKENS.delete(t);
    }
  }
  REVOKED_TOKENS.set(tokenStr, now);
}

// Rate Limiting Functions
function isIpRateLimited(ip) {
  const now = Date.now();
  const attempts = (LOGIN_ATTEMPTS.get(ip) || []).filter(ts => now - ts < LOGIN_LOCKOUT_MINUTES * 60000);
  LOGIN_ATTEMPTS.set(ip, attempts);
  return attempts.length >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const attempts = (LOGIN_ATTEMPTS.get(ip) || []).filter(ts => now - ts < LOGIN_LOCKOUT_MINUTES * 60000);
  attempts.push(now);
  LOGIN_ATTEMPTS.set(ip, attempts);
}

function clearLoginAttempts(ip) {
  LOGIN_ATTEMPTS.delete(ip);
}

function isInquiryRateLimited(ip) {
  const now = Date.now();
  const attempts = (INQUIRY_ATTEMPTS.get(ip) || []).filter(ts => now - ts < 3600000);
  INQUIRY_ATTEMPTS.set(ip, attempts);
  return attempts.length >= 10;
}

function recordInquiryAttempt(ip) {
  const now = Date.now();
  const attempts = (INQUIRY_ATTEMPTS.get(ip) || []).filter(ts => now - ts < 3600000);
  attempts.push(now);
  INQUIRY_ATTEMPTS.set(ip, attempts);
}

function checkDuplicateSubmission(fingerprint) {
  const now = Date.now();
  for (const [fp, ts] of RECENT_SUBMISSIONS.entries()) {
    if (now - ts > 120000) {
      RECENT_SUBMISSIONS.delete(fp);
    }
  }
  if (RECENT_SUBMISSIONS.has(fingerprint)) {
    const lastTs = RECENT_SUBMISSIONS.get(fingerprint);
    if (now - lastTs < 60000) {
      return true;
    }
  }
  return false;
}

function recordSubmission(fingerprint) {
  RECENT_SUBMISSIONS.set(fingerprint, Date.now());
}

function isAnalyticsRateLimited(ip) {
  const now = Date.now();
  const attempts = (ANALYTICS_ATTEMPTS.get(ip) || []).filter(ts => now - ts < 60000);
  ANALYTICS_ATTEMPTS.set(ip, attempts);
  if (attempts.length >= 120) return true;
  attempts.push(now);
  return false;
}

function isUploadRateLimited(ip) {
  const now = Date.now();
  const attempts = (UPLOAD_ATTEMPTS.get(ip) || []).filter(ts => now - ts < 600000);
  UPLOAD_ATTEMPTS.set(ip, attempts);
  if (attempts.length >= 20) return true;
  attempts.push(now);
  return false;
}

function isAdminMutationRateLimited(ip) {
  const now = Date.now();
  const attempts = (ADMIN_MUTATION_ATTEMPTS.get(ip) || []).filter(ts => now - ts < 60000);
  ADMIN_MUTATION_ATTEMPTS.set(ip, attempts);
  if (attempts.length >= 60) return true;
  attempts.push(now);
  return false;
}

// Express Auth Middleware
function requireAuth(req, res, next) {
  let token = '';

  // Check Authorization Header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers['x-admin-token']) {
    token = req.headers['x-admin-token'].trim();
  } else if (req.headers.cookie) {
    // Parse cookies
    const cookies = req.headers.cookie.split(';');
    for (const cookie of cookies) {
      const [k, v] = cookie.trim().split('=');
      if ((k === 'vs_admin_token' || k === 'admin_session') && v) {
        token = decodeURIComponent(v);
        break;
      }
    }
  }

  if (!token || !verifyToken(token)) {
    const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';
    recordAdminAuthFailure(clientIp, 'Invalid or missing authentication token');
    return res.status(401).json({ error: 'Unauthorized. Valid admin session required.' });
  }

  req.adminToken = token;
  req.adminEmail = ADMIN_EMAIL;
  next();
}

module.exports = {
  ADMIN_PASS_HASH,
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  revokeToken,
  isIpRateLimited,
  recordFailedLogin,
  clearLoginAttempts,
  isInquiryRateLimited,
  recordInquiryAttempt,
  checkDuplicateSubmission,
  recordSubmission,
  isAnalyticsRateLimited,
  isUploadRateLimited,
  isAdminMutationRateLimited,
  requireAuth
};
