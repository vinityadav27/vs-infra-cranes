/**
 * Admin Authentication Routes (/api/admin/login, /api/admin/logout)
 */

const express = require('express');
const router = express.Router();
const { ADMIN_EMAIL, ADMIN_PASS, recordAdminAuthFailure } = require('../config');
const {
  ADMIN_PASS_HASH,
  verifyPassword,
  generateToken,
  revokeToken,
  isIpRateLimited,
  recordFailedLogin,
  clearLoginAttempts
} = require('../auth');

// POST /api/admin/login
router.post('/login', (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';

  if (isIpRateLimited(clientIp)) {
    console.warn(`[SECURITY AUDIT] Rate-limited admin login attempt from IP: ${clientIp}`);
    return res.status(429).json({
      success: false,
      error: 'Too many failed login attempts. Locked out for 15 minutes.'
    });
  }

  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '').trim();

  if (!ADMIN_PASS || !ADMIN_PASS_HASH) {
    return res.status(503).json({
      success: false,
      error: 'Admin portal authentication is not configured. Set ADMIN_PASS in server environment.'
    });
  }

  const validEmail = email === ADMIN_EMAIL.toLowerCase();
  const validPass = validEmail ? verifyPassword(password, ADMIN_PASS_HASH) : false;

  if (validEmail && validPass) {
    clearLoginAttempts(clientIp);
    const token = generateToken(ADMIN_EMAIL);
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

    res.cookie('vs_admin_token', token, {
      path: '/',
      maxAge: 86400 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps
    });

    console.log(`[SECURITY AUDIT] Successful admin login from IP: ${clientIp}`);
    return res.json({
      success: true,
      message: 'Authentication successful',
      token,
      admin: { role: 'administrator' }
    });
  }

  recordFailedLogin(clientIp);
  recordAdminAuthFailure(clientIp, 'Invalid email or password');
  console.warn(`[SECURITY AUDIT] Failed admin login attempt for '${email.slice(0, 3)}***' from IP: ${clientIp}`);
  res.status(401).json({ success: false, error: 'Invalid email or password.' });
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';
  let token = '';

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers['x-admin-token']) {
    token = req.headers['x-admin-token'].trim();
  } else if (req.cookies && req.cookies.vs_admin_token) {
    token = req.cookies.vs_admin_token;
  }

  if (token) {
    revokeToken(token);
  }

  res.clearCookie('vs_admin_token', { path: '/' });
  console.log(`[SECURITY AUDIT] Admin logout from IP: ${clientIp}`);
  res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;
