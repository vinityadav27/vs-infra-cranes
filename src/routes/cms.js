/**
 * CMS Content & Certificate Management Routes
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const dbManager = require('../db');
const { requireAuth, isUploadRateLimited, isAdminMutationRateLimited } = require('../auth');
const { ROOT_DIR, CERTIFICATES_DIR, sanitizeText } = require('../config');

const ALLOWED_CMS_SECTIONS = new Set([
  'contact', 'products', 'services', 'gallery',
  'projects', 'map_pins', 'blog', 'catalog', 'certificates'
]);

// GET /api/content/certificates (Public active certificates)
router.get('/content/certificates', async (req, res) => {
  const allCerts = await dbManager.getCmsContent('certificates');
  const today = new Date().toISOString().slice(0, 10);
  const publicCerts = [];

  if (Array.isArray(allCerts)) {
    for (const c of allCerts) {
      if (!c.is_public && c.status !== 'public') continue;
      if (!c.file_url) continue;
      if (c.expiry_date && c.expiry_date < today) continue;
      const pubCopy = { ...c };
      delete pubCopy.notes;
      publicCerts.push(pubCopy);
    }
  }

  res.json({ section: 'certificates', data: publicCerts });
});

// GET /api/content/:section (Public CMS items)
router.get('/content/:section', async (req, res) => {
  const section = req.params.section.trim().replace(/-/g, '_');
  if (!ALLOWED_CMS_SECTIONS.has(section)) {
    return res.status(404).json({ error: 'Invalid content section' });
  }
  const content = await dbManager.getCmsContent(section);
  res.json({ section, data: content });
});

// GET /api/admin/content/:section (Admin view with drafts/all items)
router.get('/admin/content/:section', requireAuth, async (req, res) => {
  const section = req.params.section.trim().replace(/-/g, '_');
  if (!ALLOWED_CMS_SECTIONS.has(section)) {
    return res.status(404).json({ error: 'Invalid content section' });
  }
  const content = await dbManager.getCmsContent(section);
  res.json({ section, data: content });
});

// POST /api/admin/content/:section (Create new item or update object)
router.post('/admin/content/:section', requireAuth, async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';
  if (isAdminMutationRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many mutation requests. Please wait a moment.' });
  }

  const section = req.params.section.trim().replace(/-/g, '_');
  if (!ALLOWED_CMS_SECTIONS.has(section)) {
    return res.status(404).json({ error: 'Invalid content section' });
  }

  const payload = req.body || {};
  let currentContent = await dbManager.getCmsContent(section);

  if (section === 'contact' || section === 'catalog') {
    // Single object section
    const updated = await dbManager.updateCmsContent(section, payload);
    return res.json({ success: true, message: 'Content saved', data: updated });
  }

  // Array sections
  if (!Array.isArray(currentContent)) {
    currentContent = [];
  }

  const newItem = {
    ...payload,
    id: payload.id || `${section.slice(0, 4)}_${crypto.randomBytes(4).toString('hex')}`,
    created_at: payload.created_at || new Date().toISOString()
  };

  currentContent.unshift(newItem);
  await dbManager.updateCmsContent(section, currentContent);
  res.status(201).json({ success: true, message: 'Item created', item: newItem, data: newItem });
});

// PUT & PATCH /api/admin/content/:section/:id
const updateCmsItemHandler = async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';
  if (isAdminMutationRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many mutation requests. Please wait a moment.' });
  }

  const section = req.params.section.trim().replace(/-/g, '_');
  const itemId = req.params.id.trim();

  if (!ALLOWED_CMS_SECTIONS.has(section)) {
    return res.status(404).json({ error: 'Invalid content section' });
  }

  let currentContent = await dbManager.getCmsContent(section);
  if (!Array.isArray(currentContent)) {
    return res.status(400).json({ error: 'Section does not support item updates' });
  }

  const idx = currentContent.findIndex(item => String(item.id) === itemId);
  if (idx < 0) {
    return res.status(404).json({ error: 'Content item not found' });
  }

  const updatedItem = {
    ...currentContent[idx],
    ...req.body,
    id: itemId,
    updated_at: new Date().toISOString()
  };

  currentContent[idx] = updatedItem;
  await dbManager.updateCmsContent(section, currentContent);
  res.json({ success: true, message: 'Item updated', item: updatedItem, data: updatedItem });
};

router.put('/admin/content/:section/:id', requireAuth, updateCmsItemHandler);
router.patch('/admin/content/:section/:id', requireAuth, updateCmsItemHandler);

// DELETE /api/admin/content/:section/:id
router.delete('/admin/content/:section/:id', requireAuth, async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';
  if (isAdminMutationRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many mutation requests. Please wait a moment.' });
  }

  const section = req.params.section.trim().replace(/-/g, '_');
  const itemId = req.params.id.trim();

  if (!ALLOWED_CMS_SECTIONS.has(section)) {
    return res.status(404).json({ error: 'Invalid content section' });
  }

  let currentContent = await dbManager.getCmsContent(section);
  if (!Array.isArray(currentContent)) {
    return res.status(400).json({ error: 'Section does not support item deletion' });
  }

  const originalLength = currentContent.length;
  currentContent = currentContent.filter(item => String(item.id) !== itemId);

  if (currentContent.length === originalLength) {
    return res.status(404).json({ error: 'Content item not found' });
  }

  await dbManager.updateCmsContent(section, currentContent);
  res.json({ success: true, message: 'Item deleted' });
});

// POST /api/admin/certificates/upload
router.post('/admin/certificates/upload', requireAuth, async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';
  if (isUploadRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Upload rate limit reached. Please wait a few minutes.' });
  }

  const payload = req.body || {};
  const certId = String(payload.cert_id || '').trim();
  const fileName = String(payload.file_name || '').trim();
  let fileData = String(payload.file_data || '').trim();

  if (!fileName || !fileData) {
    return res.status(400).json({ error: 'Missing file name or file content data.' });
  }

  const cleanName = path.basename(fileName);
  const ext = path.extname(cleanName).toLowerCase();
  const allowedExts = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);

  if (!allowedExts.has(ext)) {
    return res.status(400).json({ error: `Invalid file extension '${ext}'. Allowed formats: PDF, JPG, JPEG, PNG, WEBP.` });
  }

  if (fileData.includes(',')) {
    fileData = fileData.split(',')[1];
  }

  let rawBytes;
  try {
    rawBytes = Buffer.from(fileData, 'base64');
  } catch (err) {
    return res.status(400).json({ error: 'Corrupted or invalid base64 file data.' });
  }

  const MAX_CERT_SIZE = 15 * 1024 * 1024;
  if (rawBytes.length > MAX_CERT_SIZE) {
    return res.status(400).json({ error: 'File size exceeds 15 MB limit.' });
  }
  if (rawBytes.length < 10) {
    return res.status(400).json({ error: 'File content is empty or invalid.' });
  }

  // Magic bytes check
  let validSig = false;
  if (ext === '.pdf' && rawBytes.subarray(0, 4).toString() === '%PDF') {
    validSig = true;
  } else if ((ext === '.jpg' || ext === '.jpeg') && rawBytes[0] === 0xff && rawBytes[1] === 0xd8 && rawBytes[2] === 0xff) {
    validSig = true;
  } else if (ext === '.png' && rawBytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    validSig = true;
  } else if (ext === '.webp' && rawBytes.subarray(0, 4).toString() === 'RIFF' && rawBytes.subarray(8, 12).toString() === 'WEBP') {
    validSig = true;
  }

  if (!validSig) {
    console.warn(`[SECURITY AUDIT] Invalid file signature rejected for '${cleanName}' from IP: ${clientIp}`);
    return res.status(400).json({ error: 'File signature validation failed. Content does not match allowed format.' });
  }

  if (!fs.existsSync(CERTIFICATES_DIR)) {
    fs.mkdirSync(CERTIFICATES_DIR, { recursive: true });
  }

  const safePrefix = certId.replace(/[^a-zA-Z0-9_-]/g, '') || 'cert';
  const fileHash = crypto.createHash('sha256').update(rawBytes).digest('hex').slice(0, 8);
  const storedFilename = `${safePrefix}_${Math.floor(Date.now() / 1000)}_${fileHash}${ext}`;
  const destPath = path.join(CERTIFICATES_DIR, storedFilename);

  // Remove old orphan file if any
  let certs = await dbManager.getCmsContent('certificates');
  if (!Array.isArray(certs)) certs = [];
  for (const c of certs) {
    if (c.id === certId && c.file_url) {
      const oldPath = path.join(ROOT_DIR, c.file_url);
      if (fs.existsSync(oldPath) && oldPath.startsWith(CERTIFICATES_DIR)) {
        try {
          fs.unlinkSync(oldPath);
        } catch {}
      }
    }
  }

  try {
    fs.writeFileSync(destPath, rawBytes);
  } catch (err) {
    console.error('Storage error writing upload:', err.message);
    return res.status(500).json({ error: 'Failed to save document on server due to a storage error.' });
  }

  const relUrl = `assets/documents/certificates/${storedFilename}`;
  const targetCert = certs.find(c => c.id === certId);
  if (targetCert) {
    targetCert.file_url = relUrl;
    targetCert.file_name = cleanName;
    targetCert.file_size = rawBytes.length;
    targetCert.updated_at = new Date().toISOString();
    await dbManager.updateCmsContent('certificates', certs);
  }

  res.json({
    success: true,
    message: 'Certificate document uploaded and verified successfully.',
    file_url: relUrl,
    file_name: cleanName,
    stored_filename: storedFilename,
    file_size: rawBytes.length,
    certificate: targetCert || null
  });
});

// POST /api/admin/certificates/remove-file
router.post('/admin/certificates/remove-file', requireAuth, async (req, res) => {
  const certId = String(req.body.cert_id || '').trim();
  let certs = await dbManager.getCmsContent('certificates');
  if (!Array.isArray(certs)) certs = [];

  const targetCert = certs.find(c => c.id === certId);
  if (!targetCert) {
    return res.status(404).json({ error: 'Certificate record not found.' });
  }

  if (targetCert.file_url) {
    const filePath = path.join(ROOT_DIR, targetCert.file_url);
    if (fs.existsSync(filePath) && filePath.startsWith(CERTIFICATES_DIR)) {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    }
    targetCert.file_url = '';
    targetCert.file_name = '';
    targetCert.file_size = 0;
    targetCert.updated_at = new Date().toISOString();
    await dbManager.updateCmsContent('certificates', certs);
  }

  res.json({ success: true, message: 'Certificate file removed successfully.', certificate: targetCert });
});

// POST /api/admin/certificates/toggle-status
router.post('/admin/certificates/toggle-status', requireAuth, async (req, res) => {
  const certId = String(req.body.cert_id || '').trim();
  let certs = await dbManager.getCmsContent('certificates');
  if (!Array.isArray(certs)) certs = [];

  const targetCert = certs.find(c => c.id === certId);
  if (!targetCert) {
    return res.status(404).json({ error: 'Certificate record not found.' });
  }

  const currentStatus = targetCert.status || 'draft';
  targetCert.status = currentStatus === 'public' ? 'draft' : 'public';
  targetCert.is_public = targetCert.status === 'public';
  targetCert.updated_at = new Date().toISOString();

  await dbManager.updateCmsContent('certificates', certs);
  res.json({ success: true, message: 'Status updated successfully.', certificate: targetCert });
});

module.exports = router;
