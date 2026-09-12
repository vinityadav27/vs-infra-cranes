/**
 * VS Infra & Cranes — SMTP Email Notification Module
 * Uses Nodemailer with TLS, retries, and asynchronous background worker
 */

const nodemailer = require('nodemailer');
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  NOTIFICATION_EMAIL,
  BASE_URL
} = require('./config');
const dbManager = require('./db');

function createTransporter() {
  if (!SMTP_USER || !SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true for 465, false for 587
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    },
    tls: {
      rejectUnauthorized: true
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
  });
}

async function checkSmtpHealth() {
  if (!SMTP_USER || !SMTP_PASS) {
    return {
      configured: false,
      host: SMTP_HOST,
      port: SMTP_PORT,
      status: 'Not Configured',
      message: 'SMTP credentials (SMTP_USER/SMTP_PASS) not set in environment.'
    };
  }

  const transporter = createTransporter();
  try {
    await transporter.verify();
    return {
      configured: true,
      host: SMTP_HOST,
      port: SMTP_PORT,
      status: 'Connected',
      message: 'SMTP service authenticated and ready.'
    };
  } catch (err) {
    return {
      configured: true,
      host: SMTP_HOST,
      port: SMTP_PORT,
      status: 'Authentication/Connection Error',
      message: `SMTP connection error: ${err.message}`
    };
  }
}

function sendEmailNotificationAsync(inquiry) {
  if (!inquiry || !inquiry.id) {
    console.warn('[Email Warning] Cannot dispatch notification: inquiry or inquiry.id is missing.');
    return;
  }

  setImmediate(async () => {
    const inquiryId = inquiry.id;
    try {
      if (!SMTP_USER || !SMTP_PASS) {
        console.warn(`[Email Notice] SMTP credentials not configured. Email alert skipped for inquiry ${inquiryId}.`);
        await dbManager.updateInquiryEmailStatus(inquiryId, 'Not Configured');
        return;
      }

      const transporter = createTransporter();
      if (!transporter) {
        console.warn(`[Email Warning] SMTP transporter could not be initialized for inquiry ${inquiryId}.`);
        await dbManager.updateInquiryEmailStatus(inquiryId, 'Failed');
        return;
      }

      const inquiryType = inquiry.equipment_type || inquiry.service_type || inquiry.subject || 'Website Lead';
      const customerName = inquiry.name || 'Prospective Client';

      const textBody = `New Customer Inquiry Received on VS Infra & Cranes:

Inquiry ID: ${inquiry.id}
Date/Time: ${inquiry.created_at}
Source: ${inquiry.source_page || 'Website Form'}

Customer Details:
- Name: ${customerName}
- Company: ${inquiry.company || 'N/A'}
- Email: ${inquiry.email || 'N/A'}
- Phone: ${inquiry.phone || 'N/A'}
- Location: ${inquiry.location || 'N/A'}

Requirement Details:
- Equipment / Service: ${inquiryType}
- Capacity: ${inquiry.capacity || 'N/A'}
- Span / Lift: ${inquiry.span || 'N/A'} / ${inquiry.lift || 'N/A'}
- Duty Class: ${inquiry.duty_class || 'N/A'}

Message:
${inquiry.message || 'No message provided.'}

Open Admin Portal to manage this lead:
${BASE_URL}/admin.html
`;

      const htmlBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 20px; }
    .box { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .head { background: linear-gradient(135deg, #1A1A2E 0%, #2d1607 100%); color: #ffffff; padding: 24px; text-align: center; border-bottom: 3px solid #E8630A; }
    .head h2 { margin: 0 0 6px 0; font-size: 20px; letter-spacing: 0.5px; }
    .head p { margin: 0; font-size: 13px; opacity: 0.8; }
    .content { padding: 24px; }
    .field-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px; }
    .field-table td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
    .field-label { font-weight: 600; color: #64748b; width: 35%; }
    .field-val { color: #1e293b; font-weight: 500; }
    .message-box { background: #f8fafc; border-left: 4px solid #E8630A; padding: 12px 16px; border-radius: 4px; font-size: 13.5px; color: #334155; margin-bottom: 24px; line-height: 1.5; }
    .btn-wrap { text-align: center; padding: 12px 0 20px; }
    .btn { display: inline-block; background: #E8630A; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 700; font-size: 14px; box-shadow: 0 3px 8px rgba(232,99,10,0.3); }
    .footer { font-size: 11px; color: #94a3b8; text-align: center; padding: 16px; border-top: 1px solid #f1f5f9; }
  </style>
</head>
<body>
  <div class="box">
    <div class="head">
      <h2>VS INFRA &amp; CRANES</h2>
      <p>New Website Lead Notification</p>
    </div>
    <div class="content">
      <table class="field-table">
        <tr><td class="field-label">Customer Name</td><td class="field-val"><strong>${customerName}</strong></td></tr>
        <tr><td class="field-label">Company</td><td class="field-val">${inquiry.company || '—'}</td></tr>
        <tr><td class="field-label">Email</td><td class="field-val"><a href="mailto:${inquiry.email || ''}" style="color:#E8630A;">${inquiry.email || '—'}</a></td></tr>
        <tr><td class="field-label">Phone</td><td class="field-val"><a href="tel:${inquiry.phone || ''}" style="color:#1e293b;">${inquiry.phone || '—'}</a></td></tr>
        <tr><td class="field-label">Equipment / Service</td><td class="field-val" style="color:#E8630A; font-weight:700;">${inquiryType}</td></tr>
        <tr><td class="field-label">Capacity / Specs</td><td class="field-val">Cap: ${inquiry.capacity || '—'} | Span: ${inquiry.span || '—'}</td></tr>
        <tr><td class="field-label">Location</td><td class="field-val">${inquiry.location || '—'}</td></tr>
        <tr><td class="field-label">Inquiry ID</td><td class="field-val"><code>${inquiry.id}</code></td></tr>
      </table>

      <div style="font-size:12px; font-weight:600; text-transform:uppercase; color:#64748b; margin-bottom:6px;">Customer Requirement / Message:</div>
      <div class="message-box">
        ${inquiry.message || 'No custom message provided.'}
      </div>

      <div class="btn-wrap">
        <a href="${BASE_URL}/admin.html" class="btn" target="_blank">Open Admin Portal →</a>
      </div>
    </div>
    <div class="footer">
      Automated dispatch from VS Infra &amp; Cranes Backend Engine. Data safely preserved in MongoDB Atlas.
    </div>
  </div>
</body>
</html>`;

      let lastError = null;
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const info = await transporter.sendMail({
            from: `"VS Infra Cranes System" <${SMTP_USER}>`,
            to: NOTIFICATION_EMAIL,
            subject: `New Website Inquiry — ${inquiryType} — ${customerName}`,
            text: textBody,
            html: htmlBody
          });
          console.log(`[Email Notification] Alert sent successfully to ${NOTIFICATION_EMAIL} for inquiry ${inquiryId} (Message ID: ${info && info.messageId ? info.messageId : 'accepted'})`);
          await dbManager.updateInquiryEmailStatus(inquiryId, 'Sent');
          return;
        } catch (err) {
          lastError = err;
          console.warn(`[Email Notification Warning] Attempt ${attempt}/${maxAttempts} failed for inquiry ${inquiryId}: ${err.message}`);
          if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
          }
        }
      }

      console.error(`[Email Notification FAILED] Could not deliver email for inquiry ${inquiryId} after ${maxAttempts} attempts: ${lastError ? lastError.message : 'Unknown'}`);
      await dbManager.updateInquiryEmailStatus(inquiryId, 'Failed');
    } catch (unexpectedErr) {
      console.error(`[Email Notification Unexpected Error] Error processing email for inquiry ${inquiryId}: ${unexpectedErr ? unexpectedErr.message : 'Unknown'}`);
      try {
        await dbManager.updateInquiryEmailStatus(inquiryId, 'Failed');
      } catch (_) {}
    }
  });
}

module.exports = {
  createTransporter,
  checkSmtpHealth,
  sendEmailNotificationAsync
};
