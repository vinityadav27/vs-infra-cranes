/**
 * VS Infra & Cranes — Database Management Module
 * Primary: MongoDB Atlas
 * Resilient Mirror / Fallback: Local JSON (cms_content.json, inquiries.json)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const {
  DATA_DIR,
  CMS_FILE,
  JSON_FILE,
  ANALYTICS_FILE,
  MONGODB_URI,
  MONGODB_DB_NAME,
  SECRET_KEY,
  SERVER_START_TIME,
  TOTAL_REQUESTS,
  HTTP_METRICS,
  API_LATENCY_SAMPLES,
  RECENT_ERRORS,
  ACTIVE_SESSIONS,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  parseUserAgent,
  categorizeLeadSource,
  resolveApproxGeo,
  recordAppError
} = require('./config');

class DatabaseManager {
  constructor() {
    this.client = null;
    this.db = null;
    this.connected = false;
    this.error = null;
    this.pingLatencyMs = null;

    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      } catch (err) {
        console.error('Failed to create DATA_DIR:', err.message);
      }
    }
  }

  async connect() {
    if (!MONGODB_URI) {
      this.connected = false;
      this.error = 'MONGODB_URI not configured in .env';
      console.log('[MongoDB Atlas Diagnostic] MONGODB_URI not configured. Using local JSON mirror.');
      return;
    }

    console.log('[MongoDB Atlas Diagnostic] Connecting to Atlas cluster...');
    console.log(`[MongoDB Atlas Diagnostic] Target database: '${MONGODB_DB_NAME}'`);

    try {
      this.client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        retryWrites: true
      });

      await this.client.connect();
      const startPing = Date.now();
      const pingResult = await this.client.db('admin').command({ ping: 1 });
      this.pingLatencyMs = Date.now() - startPing;
      this.db = this.client.db(MONGODB_DB_NAME);
      this.connected = true;
      this.error = null;

      console.log(`[MongoDB Atlas Diagnostic] SUCCESS: Connected to MongoDB Atlas. Database: '${MONGODB_DB_NAME}' (latency: ${this.pingLatencyMs}ms).`);

      // Ensure Indexes
      await this.db.collection('inquiries').createIndex({ id: 1 }, { unique: true });
      await this.db.collection('inquiries').createIndex({ created_at: -1 });
      await this.db.collection('inquiries').createIndex({ status: 1 });
      await this.db.collection('analytics_events').createIndex({ timestamp: -1 });
      await this.db.collection('system_alerts').createIndex({ created_at: -1 });

      await this.syncMirrorToMongo();
    } catch (err) {
      this.connected = false;
      const sanitized = String(err.message || err).replace(/:\/\/([^:]+):([^@]+)@/, '://$1:*****@');
      this.error = `${err.name || 'Error'}: ${sanitized}`;
      console.error(`[MongoDB Atlas Diagnostic] FAILED: Could not connect to Atlas [${err.name}]. Local JSON fallback active.`);
      console.error(`  → Details: ${sanitized.slice(0, 300)}`);
      if (/TLSV1_ALERT_INTERNAL_ERROR|tlsv1 alert internal error/i.test(sanitized)) {
        console.error('  → Action required: Atlas rejected the TLS handshake. Ensure the hosting outbound IP (e.g. 0.0.0.0/0 for Render) is added to MongoDB Atlas Network Access > IP Access List.');
      }
    }
  }

  async ensureConnected() {
    if (this.connected && this.client && this.db) {
      return true;
    }
    if (!MONGODB_URI) return false;
    try {
      if (!this.client) {
        this.client = new MongoClient(MONGODB_URI, {
          serverSelectionTimeoutMS: 10000,
          connectTimeoutMS: 10000,
          retryWrites: true
        });
        await this.client.connect();
      }
      await this.client.db('admin').command({ ping: 1 });
      this.db = this.client.db(MONGODB_DB_NAME);
      this.connected = true;
      this.error = null;
      return true;
    } catch (err) {
      this.connected = false;
      const sanitized = String(err.message || err).replace(/:\/\/([^:]+):([^@]+)@/, '://$1:*****@');
      this.error = `${err.name || 'Error'}: ${sanitized}`;
      return false;
    }
  }

  async syncMirrorToMongo() {
    if (!this.connected || !this.db) return;
    try {
      // Sync inquiries from local JSON if Mongo collection is empty
      const inqCol = this.db.collection('inquiries');
      const count = await inqCol.countDocuments();
      if (count === 0 && fs.existsSync(JSON_FILE)) {
        try {
          const raw = fs.readFileSync(JSON_FILE, 'utf-8');
          const list = JSON.parse(raw);
          if (Array.isArray(list) && list.length > 0) {
            for (const item of list) {
              await inqCol.updateOne({ id: item.id }, { $set: item }, { upsert: true });
            }
          }
        } catch (e) {
          // ignore
        }
      }

      // Sync CMS sections if empty
      if (fs.existsSync(CMS_FILE)) {
        const cmsData = JSON.parse(fs.readFileSync(CMS_FILE, 'utf-8'));
        for (const [sec, secVal] of Object.entries(cmsData)) {
          const col = this.db.collection(`cms_${sec}`);
          const colCount = await col.countDocuments();
          if (colCount === 0) {
            if (Array.isArray(secVal) && secVal.length > 0) {
              await col.insertMany(secVal);
            } else if (secVal && typeof secVal === 'object' && Object.keys(secVal).length > 0) {
              await col.insertOne(secVal);
            }
          }
        }
      }
      console.log('MongoDB Atlas: Synchronized inquiries and CMS collections.');
    } catch (err) {
      console.log('MongoDB Atlas Sync Note:', err.message);
    }
  }

  getDbStatus() {
    if (this.connected && this.db) {
      return {
        status: 'ONLINE',
        primary: 'MongoDB Atlas',
        database: 'MongoDB Atlas',
        active_database: MONGODB_DB_NAME,
        latency_ms: this.pingLatencyMs || 40.0,
        mongo: {
          configured: true,
          connected: true,
          target_database: MONGODB_DB_NAME,
          error: null,
          diagnosis: null,
          latency_ms: this.pingLatencyMs || 40.0
        },
        timestamp: new Date().toISOString()
      };
    }
    return {
      status: 'FALLBACK',
      primary: 'Local JSON Mirror',
      database: 'Local JSON Mirror',
      active_database: 'inquiries.json (JSON)',
      latency_ms: null,
      mongo: {
        configured: Boolean(MONGODB_URI),
        connected: false,
        target_database: MONGODB_DB_NAME,
        error: this.error || 'Disconnected',
        diagnosis: this.error ? 'MongoDB Atlas connection failed. Local JSON mirror active.' : 'MONGODB_URI not configured.'
      },
      timestamp: new Date().toISOString()
    };
  }

  // --- CMS Content Methods ---

  async getCmsContent(section = null) {
    let fallbackData = {};
    if (fs.existsSync(CMS_FILE)) {
      try {
        fallbackData = JSON.parse(fs.readFileSync(CMS_FILE, 'utf-8'));
      } catch (e) {
        fallbackData = {};
      }
    }

    if (this.connected && this.db && section) {
      try {
        const col = this.db.collection(`cms_${section}`);
        const docs = await col.find({}, { projection: { _id: 0 } }).toArray();
        if (docs && docs.length > 0) {
          if (section === 'contact' || section === 'catalog') {
            return docs[0];
          }
          return docs;
        }
      } catch (err) {
        // Fall back to local JSON
      }
    }

    if (section) {
      return fallbackData[section] || (section === 'contact' || section === 'catalog' ? {} : []);
    }
    return fallbackData;
  }

  async updateCmsContent(section, payload) {
    let data = await this.getCmsContent();
    data[section] = payload;

    try {
      fs.writeFileSync(CMS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write CMS_FILE:', err.message);
    }

    if (this.connected && this.db) {
      try {
        const col = this.db.collection(`cms_${section}`);
        await col.deleteMany({});
        if (Array.isArray(payload)) {
          if (payload.length > 0) {
            await col.insertMany(payload);
          }
        } else if (payload && typeof payload === 'object') {
          await col.insertOne(payload);
        }
      } catch (err) {
        console.error(`MongoDB CMS sync note for ${section}:`, err.message);
      }
    }

    return data[section];
  }

  // --- Inquiries CRM Methods ---

  async saveInquiry(data) {
    const inquiryId = data.id || `inq_${crypto.randomBytes(5).toString('hex')}`;
    const createdAt = data.created_at || new Date().toISOString();
    const status = data.status || 'New';
    const priority = data.priority || 'Normal';
    const adminNotes = data.admin_notes || '';
    const followUpDate = data.follow_up_date || '';
    const emailStatus = data.email_status || 'Pending';

    const leadSource = String(
      data.lead_source ||
        categorizeLeadSource({
          referrer: data.referrer || '',
          utm_source: data.utm_source || '',
          utm_medium: data.utm_medium || ''
        })
    ).trim().slice(0, 50);

    const referrer = String(data.referrer || '').trim().slice(0, 200);
    const landingPage = String(data.landing_page || '').trim().slice(0, 150);
    const productContext = String(data.product_context || data.equipment_type || '').trim().slice(0, 100);
    const serviceContext = String(data.service_context || data.service_type || '').trim().slice(0, 100);
    const utmSource = String(data.utm_source || '').trim().slice(0, 60);
    const utmMedium = String(data.utm_medium || '').trim().slice(0, 60);
    const utmCampaign = String(data.utm_campaign || '').trim().slice(0, 60);
    const utmTerm = String(data.utm_term || '').trim().slice(0, 60);
    const utmContent = String(data.utm_content || '').trim().slice(0, 60);
    const approxCountry = String(data.approx_country || '').trim().slice(0, 60);
    const approxCity = String(data.approx_city || '').trim().slice(0, 60);
    let approxGeo = String(data.approx_geo || '').trim().slice(0, 100);
    if (!approxGeo && (approxCountry || approxCity)) {
      approxGeo = [approxCity, approxCountry].filter(Boolean).join(', ');
    }
    const device = String(data.device || '').trim().slice(0, 40);
    const deviceType = String(data.device_type || device).trim().slice(0, 40);
    const browser = String(data.browser || '').trim().slice(0, 40);
    const os = String(data.os || '').trim().slice(0, 40);

    const record = {
      id: inquiryId,
      name: String(data.name || '').trim().slice(0, 120),
      email: String(data.email || '').trim().toLowerCase().slice(0, 120),
      phone: String(data.phone || '').trim().slice(0, 30),
      company: String(data.company || '').trim().slice(0, 120),
      subject: String(data.subject || '').trim().slice(0, 150),
      service_type: String(data.service_type || '').trim().slice(0, 80),
      equipment_type: String(data.equipment_type || '').trim().slice(0, 80),
      capacity: String(data.capacity || '').trim().slice(0, 40),
      span: String(data.span || '').trim().slice(0, 40),
      lift: String(data.lift || '').trim().slice(0, 40),
      duty_class: String(data.duty_class || '').trim().slice(0, 40),
      location: String(data.location || '').trim().slice(0, 150),
      message: String(data.message || '').trim().slice(0, 3000),
      source_page: String(data.source_page || 'Website Form').trim().slice(0, 100),
      status,
      priority,
      admin_notes: adminNotes,
      follow_up_date: followUpDate,
      email_status: emailStatus,
      created_at: createdAt,
      lead_source: leadSource,
      referrer,
      landing_page: landingPage,
      product_context: productContext,
      service_context: serviceContext,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_term: utmTerm,
      utm_content: utmContent,
      approx_geo: approxGeo,
      approx_country: approxCountry,
      approx_city: approxCity,
      device,
      device_type: deviceType,
      browser,
      os
    };

    // 1. Primary: Save to MongoDB
    if (await this.ensureConnected()) {
      try {
        await this.db.collection('inquiries').updateOne(
          { id: inquiryId },
          { $set: record },
          { upsert: true }
        );
      } catch (err) {
        console.error('MongoDB Atlas write error:', err.message);
      }
    }

    // 2. Mirror to local JSON
    this.mirrorInquiryToJson(record);

    return record;
  }

  mirrorInquiryToJson(record) {
    try {
      let inquiries = [];
      if (fs.existsSync(JSON_FILE)) {
        try {
          inquiries = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
          if (!Array.isArray(inquiries)) inquiries = [];
        } catch (e) {
          inquiries = [];
        }
      }
      const idx = inquiries.findIndex(i => i.id === record.id);
      if (idx >= 0) {
        inquiries[idx] = { ...inquiries[idx], ...record };
      } else {
        inquiries.unshift(record);
      }
      fs.writeFileSync(JSON_FILE, JSON.stringify(inquiries, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to mirror inquiry to JSON:', err.message);
    }
  }

  async updateInquiryEmailStatus(inquiryId, status) {
    if (await this.ensureConnected()) {
      try {
        await this.db.collection('inquiries').updateOne(
          { id: inquiryId },
          { $set: { email_status: status } }
        );
      } catch (err) {
        // ignore
      }
    }
    // Update local JSON mirror
    try {
      if (fs.existsSync(JSON_FILE)) {
        const inquiries = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
        const item = inquiries.find(i => i.id === inquiryId);
        if (item) {
          item.email_status = status;
          fs.writeFileSync(JSON_FILE, JSON.stringify(inquiries, null, 2), 'utf-8');
        }
      }
    } catch (e) {
      // ignore
    }
  }

  async getInquiries({ search = '', status = '', priority = '', type = '', page = 1, limit = 20 } = {}) {
    page = Math.max(1, parseInt(page, 10) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    if (await this.ensureConnected()) {
      try {
        const q = {};
        if (status && status.toLowerCase() !== 'all') {
          q.status = status;
        }
        if (priority && priority.toLowerCase() !== 'all') {
          q.priority = priority;
        }
        if (type && type.toLowerCase() !== 'all') {
          const t = type.toLowerCase();
          if (t === 'quote') {
            q.$or = [{ equipment_type: { $exists: true, $ne: '' } }, { source_page: { $regex: 'quote', $options: 'i' } }];
          } else if (t === 'service') {
            q.$or = [{ service_type: { $exists: true, $ne: '' } }, { source_page: { $regex: 'service', $options: 'i' } }];
          } else if (t === 'contact') {
            q.$or = [{ source_page: { $regex: 'contact', $options: 'i' } }, { subject: { $regex: 'contact', $options: 'i' } }];
          }
        }
        if (search) {
          const sRegex = new RegExp(search, 'i');
          const searchClause = [
            { id: sRegex },
            { name: sRegex },
            { email: sRegex },
            { phone: sRegex },
            { company: sRegex },
            { subject: sRegex },
            { location: sRegex },
            { message: sRegex },
            { equipment_type: sRegex }
          ];
          if (q.$or) {
            q.$and = [{ $or: q.$or }, { $or: searchClause }];
            delete q.$or;
          } else {
            q.$or = searchClause;
          }
        }

        const total = await this.db.collection('inquiries').countDocuments(q);
        const docs = await this.db.collection('inquiries')
          .find(q, { projection: { _id: 0 } })
          .sort({ created_at: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray();

        return {
          inquiries: docs,
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        };
      } catch (err) {
        console.error('Error querying MongoDB for inquiries:', err.message);
      }
    }

    // Fallback to local JSON
    let list = [];
    if (fs.existsSync(JSON_FILE)) {
      try {
        list = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
      } catch (e) {
        list = [];
      }
    }
    if (status && status.toLowerCase() !== 'all') {
      list = list.filter(i => (i.status || '').toLowerCase() === status.toLowerCase());
    }
    if (priority && priority.toLowerCase() !== 'all') {
      list = list.filter(i => (i.priority || '').toLowerCase() === priority.toLowerCase());
    }
    if (type && type.toLowerCase() !== 'all') {
      const t = type.toLowerCase();
      list = list.filter(i => {
        if (t === 'quote') return Boolean(i.equipment_type || (i.source_page || '').toLowerCase().includes('quote'));
        if (t === 'service') return Boolean(i.service_type || (i.source_page || '').toLowerCase().includes('service'));
        if (t === 'contact') return Boolean((i.source_page || '').toLowerCase().includes('contact') || (i.subject || '').toLowerCase().includes('contact'));
        return true;
      });
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(i =>
        (i.id || '').toLowerCase().includes(s) ||
        (i.name || '').toLowerCase().includes(s) ||
        (i.email || '').toLowerCase().includes(s) ||
        (i.phone || '').includes(s) ||
        (i.company || '').toLowerCase().includes(s) ||
        (i.subject || '').toLowerCase().includes(s) ||
        (i.location || '').toLowerCase().includes(s) ||
        (i.message || '').toLowerCase().includes(s) ||
        (i.equipment_type || '').toLowerCase().includes(s)
      );
    }
    const total = list.length;
    const paginated = list.slice((page - 1) * limit, page * limit);
    return {
      inquiries: paginated,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    };
  }

  async getInquiryById(id) {
    if (await this.ensureConnected()) {
      try {
        const doc = await this.db.collection('inquiries').findOne({ id }, { projection: { _id: 0 } });
        if (doc) return doc;
      } catch (err) {
        // ignore
      }
    }
    if (fs.existsSync(JSON_FILE)) {
      try {
        const list = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
        return list.find(i => i.id === id) || null;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  async updateInquiry(id, updates) {
    const cleanUpdates = {};
    const allowed = ['status', 'priority', 'admin_notes', 'follow_up_date', 'email_status'];
    for (const k of allowed) {
      if (updates[k] !== undefined) {
        cleanUpdates[k] = String(updates[k]).trim();
      }
    }
    cleanUpdates.updated_at = new Date().toISOString();

    let updatedDoc = null;
    if (await this.ensureConnected()) {
      try {
        await this.db.collection('inquiries').updateOne({ id }, { $set: cleanUpdates });
        updatedDoc = await this.db.collection('inquiries').findOne({ id }, { projection: { _id: 0 } });
      } catch (err) {
        console.error('Failed to update inquiry in MongoDB:', err.message);
      }
    }

    // Mirror to JSON
    if (fs.existsSync(JSON_FILE)) {
      try {
        const list = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
        const idx = list.findIndex(i => i.id === id);
        if (idx >= 0) {
          list[idx] = { ...list[idx], ...cleanUpdates };
          fs.writeFileSync(JSON_FILE, JSON.stringify(list, null, 2), 'utf-8');
          if (!updatedDoc) updatedDoc = list[idx];
        }
      } catch (e) {
        // ignore
      }
    }

    return updatedDoc;
  }

  async deleteInquiry(id) {
    let success = false;
    if (await this.ensureConnected()) {
      try {
        const res = await this.db.collection('inquiries').deleteOne({ id });
        success = res.deletedCount > 0;
      } catch (err) {
        console.error('Failed to delete inquiry from MongoDB:', err.message);
      }
    }

    if (fs.existsSync(JSON_FILE)) {
      try {
        const list = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
        const filtered = list.filter(i => i.id !== id);
        if (filtered.length !== list.length) {
          fs.writeFileSync(JSON_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
          success = true;
        }
      } catch (e) {
        // ignore
      }
    }

    return success;
  }

  async getStats({ search = '', status = '', priority = '', type = '' } = {}) {
    let allInquiries = [];
    if (await this.ensureConnected()) {
      try {
        allInquiries = await this.db.collection('inquiries')
          .find({}, { projection: { _id: 0 } })
          .sort({ created_at: -1 })
          .toArray();
      } catch (err) {
        allInquiries = [];
      }
    }

    if (!allInquiries.length && fs.existsSync(JSON_FILE)) {
      try {
        allInquiries = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
      } catch (e) {
        allInquiries = [];
      }
    }

    // Optional active filter support
    let filteredInquiries = allInquiries;
    if (status && status.toLowerCase() !== 'all') {
      filteredInquiries = filteredInquiries.filter(i => (i.status || '').toLowerCase() === status.toLowerCase());
    }
    if (priority && priority.toLowerCase() !== 'all') {
      filteredInquiries = filteredInquiries.filter(i => (i.priority || '').toLowerCase() === priority.toLowerCase());
    }
    if (type && type.toLowerCase() !== 'all') {
      const t = type.toLowerCase();
      filteredInquiries = filteredInquiries.filter(i => {
        if (t === 'quote') return Boolean(i.equipment_type || (i.source_page || '').toLowerCase().includes('quote'));
        if (t === 'service') return Boolean(i.service_type || (i.source_page || '').toLowerCase().includes('service'));
        if (t === 'contact') return Boolean((i.source_page || '').toLowerCase().includes('contact') || (i.subject || '').toLowerCase().includes('contact'));
        return true;
      });
    }
    if (search) {
      const s = search.toLowerCase();
      filteredInquiries = filteredInquiries.filter(i =>
        (i.id || '').toLowerCase().includes(s) ||
        (i.name || '').toLowerCase().includes(s) ||
        (i.email || '').toLowerCase().includes(s) ||
        (i.phone || '').includes(s) ||
        (i.company || '').toLowerCase().includes(s) ||
        (i.subject || '').toLowerCase().includes(s) ||
        (i.location || '').toLowerCase().includes(s) ||
        (i.message || '').toLowerCase().includes(s) ||
        (i.equipment_type || '').toLowerCase().includes(s)
      );
    }

    const hasActiveFilters = Boolean(search || (status && status !== 'all') || (priority && priority !== 'all') || (type && type !== 'all'));
    const targetList = hasActiveFilters ? filteredInquiries : allInquiries;

    const total = targetList.length;
    const grandTotal = allInquiries.length;

    let countNew = 0;
    let countContacted = 0;
    let countQuoted = 0;
    let countInProgress = 0;
    let countCompleted = 0;
    let countClosed = 0;
    let countUrgent = 0;

    const byStatus = {
      New: 0,
      Contacted: 0,
      Quoted: 0,
      'In Progress': 0,
      Completed: 0,
      Closed: 0
    };
    const byPriority = { Normal: 0, Urgent: 0, Important: 0, High: 0, Low: 0 };
    const byEquipment = {};
    const byLeadSource = {};

    for (const inq of targetList) {
      const sRaw = String(inq.status || 'New').trim();
      const sLower = sRaw.toLowerCase();

      if (sLower === 'new' || sLower === 'unread') {
        countNew++;
        byStatus.New = (byStatus.New || 0) + 1;
      } else if (sLower === 'contacted') {
        countContacted++;
        byStatus.Contacted = (byStatus.Contacted || 0) + 1;
      } else if (sLower === 'quoted') {
        countQuoted++;
        byStatus.Quoted = (byStatus.Quoted || 0) + 1;
      } else if (sLower === 'in progress' || sLower === 'in_progress' || sLower === 'in review' || sLower === 'in-progress') {
        countInProgress++;
        byStatus['In Progress'] = (byStatus['In Progress'] || 0) + 1;
      } else if (sLower === 'completed') {
        countCompleted++;
        byStatus.Completed = (byStatus.Completed || 0) + 1;
      } else if (sLower === 'closed') {
        countClosed++;
        byStatus.Closed = (byStatus.Closed || 0) + 1;
      } else {
        countNew++;
        byStatus.New = (byStatus.New || 0) + 1;
      }

      const pRaw = String(inq.priority || 'Normal').trim();
      const pLower = pRaw.toLowerCase();
      if (pLower === 'urgent') {
        countUrgent++;
        byPriority.Urgent = (byPriority.Urgent || 0) + 1;
      } else if (pLower === 'important' || pLower === 'high') {
        byPriority.Important = (byPriority.Important || 0) + 1;
      } else {
        byPriority.Normal = (byPriority.Normal || 0) + 1;
      }

      const eq = inq.equipment_type || inq.service_type || inq.subject || 'Other';
      byEquipment[eq] = (byEquipment[eq] || 0) + 1;

      const ls = inq.lead_source || 'Direct Traffic';
      byLeadSource[ls] = (byLeadSource[ls] || 0) + 1;
    }

    return {
      success: true,
      total,
      total_records: total,
      total_inquiries: total,
      count: total,
      grand_total: grandTotal,
      new: countNew,
      contacted: countContacted,
      quoted: countQuoted,
      in_progress: countInProgress,
      inprogress: countInProgress,
      completed: countCompleted,
      closed: countClosed,
      urgent: countUrgent,
      by_status: byStatus,
      by_priority: byPriority,
      by_equipment: byEquipment,
      by_lead_source: byLeadSource,
      recent: targetList.slice(0, 5)
    };
  }

  // --- Analytics Event Methods ---

  async recordAnalyticsEvent(eventData) {
    try {
      const pathUrl = String(eventData.path || '/index.html').trim().slice(0, 150);
      const eventType = String(eventData.event_type || 'page_view').trim().slice(0, 50);
      const clientIp = String(eventData.client_ip || '127.0.0.1').trim();
      const ua = String(eventData.user_agent || '').trim();
      const referrer = String(eventData.referrer || '').trim().slice(0, 200);
      const sessionId = String(eventData.session_id || '').trim().slice(0, 64);
      const productId = String(eventData.product_id || '').trim().slice(0, 64);
      const productName = String(eventData.product_name || '').trim().slice(0, 100);
      const serviceId = String(eventData.service_id || '').trim().slice(0, 64);
      const serviceName = String(eventData.service_name || '').trim().slice(0, 100);
      const landingPage = String(eventData.landing_page || pathUrl).trim().slice(0, 100);
      const utmSource = String(eventData.utm_source || '').trim().slice(0, 60);
      const utmMedium = String(eventData.utm_medium || '').trim().slice(0, 60);
      const utmCampaign = String(eventData.utm_campaign || '').trim().slice(0, 60);
      const utmTerm = String(eventData.utm_term || '').trim().slice(0, 60);
      const utmContent = String(eventData.utm_content || '').trim().slice(0, 60);

      // Clean location defaults - never fake India/Faridabad when not actually resolved
      let country = String(eventData.country || '').trim().slice(0, 60);
      let city = String(eventData.city || '').trim().slice(0, 60);
      if (!country || country === 'Unknown' || country === 'India') {
        country = 'Unknown / Not Available';
      }
      if (!city || city === 'Unknown' || city === 'Faridabad') {
        city = 'Unknown / Not Available';
      }

      let sourceTag = String(eventData.source || '').trim().slice(0, 100);
      const cleanIp = clientIp.replace(/^::ffff:/, '');
      const isLoopback = ['127.0.0.1', '::1', '0.0.0.0', 'localhost'].includes(cleanIp);
      const uaLower = ua.toLowerCase();

      if (isLoopback) {
        sourceTag = sourceTag || 'dev_local';
      } else if (pathUrl === '/admin.html' || pathUrl.startsWith('/admin')) {
        sourceTag = 'admin';
      } else if (!ua || uaLower.includes('bot') || uaLower.includes('crawl') || uaLower.includes('spider') || uaLower.includes('curl') || uaLower.includes('wget') || uaLower.includes('python') || uaLower.includes('httpie')) {
        sourceTag = 'bot';
      }

      const metaVal = typeof eventData.meta === 'object' ? JSON.stringify(eventData.meta) : String(eventData.meta || '');

      const { device, browser, os } = parseUserAgent(ua);
      const ipHash = crypto.createHash('sha256').update(clientIp + SECRET_KEY).digest('hex').slice(0, 16);
      const nowIso = new Date().toISOString();
      const nowEpoch = Date.now();

      if (sessionId) {
        ACTIVE_SESSIONS.set(sessionId, nowEpoch);
      } else {
        ACTIVE_SESSIONS.set(ipHash, nowEpoch);
      }

      const record = {
        timestamp: nowIso,
        created_at: nowIso,
        path: pathUrl,
        ip_hash: ipHash,
        device,
        browser,
        os,
        referrer,
        event_type: eventType,
        session_id: sessionId,
        product_id: productId,
        product_name: productName,
        service_id: serviceId,
        service_name: serviceName,
        country,
        city,
        landing_page: landingPage,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        utm_term: utmTerm,
        utm_content: utmContent,
        source: sourceTag,
        meta: metaVal
      };

      if (await this.ensureConnected()) {
        try {
          await this.db.collection('analytics_events').insertOne(record);
        } catch (e) {
          // ignore
        }
      }

      // Resilient local mirror / fallback
      try {
        let list = [];
        if (fs.existsSync(ANALYTICS_FILE)) {
          list = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf-8'));
        }
        list.push(record);
        if (list.length > 5000) list = list.slice(-5000);
        fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(list, null, 2), 'utf-8');
      } catch (e) {
        // ignore
      }
    } catch (err) {
      recordAppError('/api/analytics/event', 'POST', 500, err);
      console.error('Analytics event record error:', err.message);
    }
  }

  recordPageView(pathUrl, clientIp, userAgent, referrer, req) {
    let sourceTag = '';
    const uaLower = (userAgent || '').toLowerCase();
    const cleanIp = (clientIp || '').replace(/^::ffff:/, '');
    const isLoopback = ['127.0.0.1', '::1', '0.0.0.0', 'localhost'].includes(cleanIp);

    if (isLoopback) {
      sourceTag = 'dev_local';
    } else if (pathUrl === '/admin.html' || pathUrl.startsWith('/admin')) {
      sourceTag = 'admin';
    } else if (!userAgent || uaLower.includes('python') || uaLower.includes('curl') || uaLower.includes('httpie') || uaLower.includes('wget') || uaLower.includes('bot')) {
      sourceTag = 'bot';
    }

    const geo = resolveApproxGeo(req);
    this.recordAnalyticsEvent({
      path: pathUrl === '/' || !pathUrl ? '/index.html' : pathUrl,
      event_type: 'page_view',
      client_ip: clientIp,
      user_agent: userAgent,
      referrer,
      country: geo.country || 'Unknown / Not Available',
      city: geo.city || 'Unknown / Not Available',
      source: sourceTag
    });
  }

  async getAnalyticsSummary(period = '7d') {
    if (!['today', '7d', '30d', 'all'].includes(period)) {
      period = '7d';
    }

    let cutoffIso = '';
    const now = new Date();
    if (period === 'today') {
      cutoffIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    } else if (period === '7d') {
      cutoffIso = new Date(Date.now() - 7 * 86400000).toISOString();
    } else if (period === '30d') {
      cutoffIso = new Date(Date.now() - 30 * 86400000).toISOString();
    }

    // Filter out internal / dev / bot / test traffic from normal visitor metrics
    const internalSources = ['dev_local', 'admin', 'bot', 'test', 'health_check'];

    let allEvents = [];
    let inquiries = [];

    if (await this.ensureConnected()) {
      try {
        const q = { source: { $nin: internalSources } };
        if (cutoffIso) {
          q.timestamp = { $gte: cutoffIso };
        }
        allEvents = await this.db.collection('analytics_events')
          .find(q, { projection: { _id: 0 } })
          .sort({ timestamp: -1 })
          .toArray();
      } catch (err) {
        allEvents = [];
      }

      try {
        const inqQ = {};
        if (cutoffIso) {
          inqQ.created_at = { $gte: cutoffIso };
        }
        inquiries = await this.db.collection('inquiries')
          .find(inqQ, { projection: { _id: 0 } })
          .sort({ created_at: -1 })
          .toArray();
      } catch (err) {
        inquiries = [];
      }
    }

    // Fallback for inquiries if MongoDB has none
    if (!inquiries.length && fs.existsSync(JSON_FILE)) {
      try {
        const list = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
        inquiries = cutoffIso ? list.filter(i => (i.created_at || '') >= cutoffIso) : list;
      } catch (e) {
        inquiries = [];
      }
    }

    // Fallback for analytics events if MongoDB has none or is offline
    if (!allEvents.length && fs.existsSync(ANALYTICS_FILE)) {
      try {
        const list = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf-8'));
        allEvents = list.filter(e => {
          if (internalSources.includes(e.source)) return false;
          if (cutoffIso && (e.timestamp || '') < cutoffIso) return false;
          return true;
        });
      } catch (e) {
        allEvents = [];
      }
    }

    const totalViews = allEvents.length;
    const uniqueIps = new Set(allEvents.map(e => e.ip_hash || e.session_id).filter(Boolean));
    const uniqueVisitors = uniqueIps.size;

    // Active visitors in last 15 mins
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const activeIps = new Set(
      allEvents
        .filter(e => (e.timestamp || '') >= fifteenMinAgo)
        .map(e => e.ip_hash || e.session_id)
        .filter(Boolean)
    );
    const activeVisitors = activeIps.size;

    // Bounce Rate: sessions with only 1 event / total sessions
    const sessionEventCounts = {};
    for (const ev of allEvents) {
      const sId = ev.session_id || ev.ip_hash;
      if (sId) {
        sessionEventCounts[sId] = (sessionEventCounts[sId] || 0) + 1;
      }
    }
    const sessionValues = Object.values(sessionEventCounts);
    const totalSessions = sessionValues.length;
    const singleEventSessions = sessionValues.filter(c => c === 1).length;
    const bounceRatePct = totalSessions > 0 ? Math.round((singleEventSessions / totalSessions) * 1000) / 10 : 0.0;

    // Conversions
    const periodInquiries = inquiries.length;
    const conversionRatePct = uniqueVisitors > 0 ? Math.round((periodInquiries / uniqueVisitors) * 1000) / 10 : 0.0;

    // Breakdowns
    const pageCounts = {};
    const deviceCounts = {};
    const browserCounts = {};
    const osCounts = {};
    const geoCounts = {};

    for (const ev of allEvents) {
      if (ev.path) pageCounts[ev.path] = (pageCounts[ev.path] || 0) + 1;
      if (ev.device) deviceCounts[ev.device] = (deviceCounts[ev.device] || 0) + 1;
      if (ev.browser) browserCounts[ev.browser] = (browserCounts[ev.browser] || 0) + 1;
      if (ev.os) osCounts[ev.os] = (osCounts[ev.os] || 0) + 1;

      // Approx Geo: format as "City, Country" or "Country", or "Unknown / Not Available"
      let loc = 'Unknown / Not Available';
      const c = (ev.country || '').trim();
      const ci = (ev.city || '').trim();
      if (c && c !== 'Unknown' && c !== 'Unknown / Not Available' && c !== 'India') {
        if (ci && ci !== 'Unknown' && ci !== 'Unknown / Not Available' && ci !== 'Faridabad') {
          loc = `${ci}, ${c}`;
        } else {
          loc = c;
        }
      }
      geoCounts[loc] = (geoCounts[loc] || 0) + 1;
    }

    // Top Pages
    const topPages = Object.entries(pageCounts)
      .map(([path, views]) => ({ path, page: path, views, count: views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    // Approx Geo list
    const approxGeo = Object.entries(geoCounts)
      .map(([location, views]) => ({
        location,
        country: location,
        views,
        hits: views,
        count: views,
        pct: Math.round((views / Math.max(totalViews, 1)) * 1000) / 10
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    // Lead Sources
    const sourceVisits = {
      'Direct': 0,
      'Google Search': 0,
      'Google Ads': 0,
      'Organic Search': 0,
      'Social Media': 0,
      'Referral': 0,
      'WhatsApp': 0,
      'Campaign': 0
    };
    for (const ev of allEvents) {
      const src = categorizeLeadSource({
        referrer: ev.referrer,
        utm_source: ev.utm_source,
        utm_medium: ev.utm_medium
      });
      sourceVisits[src] = (sourceVisits[src] || 0) + 1;
    }

    const inqBySource = {};
    for (const inq of inquiries) {
      const src = inq.lead_source || categorizeLeadSource({
        referrer: inq.referrer || inq.initial_referrer,
        utm_source: inq.utm_source,
        utm_medium: inq.utm_medium
      });
      inqBySource[src] = (inqBySource[src] || 0) + 1;
    }

    const leadSourcesList = Object.entries(sourceVisits)
      .map(([source, visits]) => {
        const inqs = inqBySource[source] || 0;
        return {
          source,
          visits,
          pct_of_total: Math.round((visits / Math.max(totalViews, 1)) * 1000) / 10,
          inquiries: inqs,
          conversion_rate_pct: Math.round((inqs / Math.max(visits, 1)) * 1000) / 10
        };
      })
      .sort((a, b) => b.visits - a.visits);

    // Products Engagement
    const catalogProducts = [
      { id: 'single-girder-eot', name: 'Single Girder EOT Crane' },
      { id: 'double-girder-eot', name: 'Double Girder EOT Crane' },
      { id: 'gantry-crane', name: 'Gantry Crane' },
      { id: 'semi-gantry-crane', name: 'Semi-Gantry Crane' },
      { id: 'jib-crane', name: 'Jib Crane' },
      { id: 'electric-hoist', name: 'Electric Wire Rope Hoist' },
      { id: 'crane-components', name: 'Crane Kits & Components' }
    ];

    const productsData = catalogProducts.map(prod => {
      const pId = prod.id;
      const pName = prod.name;
      const pEvents = allEvents.filter(e =>
        (e.product_id && e.product_id.toLowerCase().includes(pId)) ||
        (e.product_name && e.product_name.toLowerCase().includes(pName.toLowerCase())) ||
        (e.path && e.path.toLowerCase().includes(pId))
      );
      const pViews = pEvents.length;
      const pViewers = pEvents.filter(e => e.event_type === 'viewer_open').length;
      const pBrochures = pEvents.filter(e => e.event_type === 'brochure_click').length;
      const pQuotes = pEvents.filter(e => e.event_type === 'quote_click').length;
      const pInqs = inquiries.filter(i =>
        (i.equipment_type && i.equipment_type.toLowerCase().includes(pName.toLowerCase())) ||
        (i.product_context && i.product_context.toLowerCase().includes(pName.toLowerCase())) ||
        (i.subject && i.subject.toLowerCase().includes(pName.toLowerCase()))
      ).length;

      return {
        id: pId,
        product_id: pId,
        name: pName,
        product_name: pName,
        views: pViews,
        page_views: pViews,
        viewer_opens: pViewers,
        brochure_downloads: pBrochures,
        quote_cta_clicks: pQuotes,
        inquiries_generated: pInqs,
        conversion_rate_pct: Math.round((pInqs / Math.max(pViews, 1)) * 1000) / 10
      };
    });

    // Services Interest
    const catalogServices = [
      { id: 'crane-amc', name: 'Crane Maintenance & AMC' },
      { id: 'crane-modernization', name: 'Modernization & Retrofitting' },
      { id: 'crane-fabrication', name: 'Custom Crane Fabrication' },
      { id: 'load-testing', name: 'Inspection & Load Testing' }
    ];

    const servicesData = catalogServices.map(srv => {
      const sId = srv.id;
      const sName = srv.name;
      const sEvents = allEvents.filter(e =>
        (e.service_id && e.service_id.toLowerCase().includes(sId)) ||
        (e.service_name && e.service_name.toLowerCase().includes(sName.toLowerCase())) ||
        (e.path && e.path.toLowerCase().includes(sId))
      );
      const sViews = sEvents.length;
      const sInqs = inquiries.filter(i =>
        (i.service_type && i.service_type.toLowerCase().includes(sName.toLowerCase())) ||
        (i.service_context && i.service_context.toLowerCase().includes(sName.toLowerCase())) ||
        (i.subject && i.subject.toLowerCase().includes(sName.toLowerCase()))
      ).length;

      return {
        id: sId,
        service_id: sId,
        name: sName,
        service_name: sName,
        views: sViews,
        inquiries_generated: sInqs,
        conversion_rate_pct: Math.round((sInqs / Math.max(sViews, 1)) * 1000) / 10
      };
    });

    // Funnel Calculation (9 stages)
    const stage1Count = Math.max(uniqueVisitors, periodInquiries);

    // Stage 2: Product / Service Viewed
    const prodSrvVisitors = new Set(
      allEvents
        .filter(e =>
          ['product_view', 'service_view'].includes(e.event_type) ||
          (e.product_name && e.product_name !== '') ||
          (e.service_name && e.service_name !== '') ||
          (e.path && (e.path.includes('product') || e.path.includes('service')))
        )
        .map(e => e.ip_hash || e.session_id)
        .filter(Boolean)
    );
    const stage2Count = Math.min(stage1Count, Math.max(prodSrvVisitors.size, periodInquiries));

    // Stage 3: Quote / Contact Intent (CTA clicks)
    const ctaVisitors = new Set(
      allEvents
        .filter(e => ['quote_click', 'contact_click', 'brochure_click', 'viewer_open', 'cta_click'].includes(e.event_type))
        .map(e => e.ip_hash || e.session_id)
        .filter(Boolean)
    );
    const stage3Count = Math.min(stage2Count, Math.max(ctaVisitors.size, periodInquiries));

    // Stage 4: Inquiry Form Started
    const inqStartVisitors = new Set(
      allEvents
        .filter(e => ['inquiry_start', 'inquiry_started'].includes(e.event_type))
        .map(e => e.ip_hash || e.session_id)
        .filter(Boolean)
    );
    const stage4Count = Math.min(stage3Count, Math.max(inqStartVisitors.size, periodInquiries));

    // Stage 5: Inquiries Submitted (Lead)
    const stage5Count = periodInquiries;

    // CRM processing stages (6-9) from inquiries collection:
    const stage6Count = inquiries.filter(i => ['Contacted', 'Quoted', 'In Progress', 'Completed', 'Closed'].includes(i.status)).length;
    const stage7Count = inquiries.filter(i => ['Quoted', 'In Progress', 'Completed', 'Closed'].includes(i.status)).length;
    const stage8Count = inquiries.filter(i => ['In Progress', 'Completed', 'Closed'].includes(i.status)).length;
    const stage9Count = inquiries.filter(i => ['Completed', 'Closed'].includes(i.status)).length;

    const stagesRaw = [
      { stage: 1, name: 'Total Visitors', count: stage1Count },
      { stage: 2, name: 'Product / Service Views', count: stage2Count },
      { stage: 3, name: 'Quote / Contact Intent (CTA clicks)', count: stage3Count },
      { stage: 4, name: 'Inquiry Form Started', count: stage4Count },
      { stage: 5, name: 'Inquiries Submitted (Lead)', count: stage5Count },
      { stage: 6, name: 'Contacted', count: stage6Count },
      { stage: 7, name: 'Quoted', count: stage7Count },
      { stage: 8, name: 'In Progress', count: stage8Count },
      { stage: 9, name: 'Completed / Closed', count: stage9Count }
    ];

    let prevVal = stage1Count;
    const funnelStages = stagesRaw.map(st => {
      const pctOfTop = stage1Count > 0 ? Math.round((st.count / stage1Count) * 1000) / 10 : 0.0;
      const drop = prevVal > 0 ? Math.max(0, Math.round(((prevVal - st.count) / prevVal) * 1000) / 10) : 0.0;
      prevVal = st.count;
      return {
        stage: st.stage,
        name: st.name,
        count: st.count,
        pct_of_visitors: pctOfTop,
        pct_of_top: pctOfTop,
        drop_off_pct: drop,
        dropoff_pct: drop
      };
    });

    return {
      success: true,
      period,
      total_views: totalViews,
      total_page_views: totalViews,
      unique_visitors: uniqueVisitors,
      active_visitors: activeVisitors,
      active_visitors_15m: activeVisitors,
      bounce_rate_pct: bounceRatePct,
      bounce_rate: bounceRatePct,
      conversion_rate_pct: conversionRatePct,
      conversion_rate: conversionRatePct,
      metrics: {
        total_page_views: totalViews,
        total_views: totalViews,
        unique_visitors: uniqueVisitors,
        active_visitors: activeVisitors,
        active_visitors_15m: activeVisitors,
        unique_sessions: totalSessions || uniqueVisitors
      },
      devices: deviceCounts,
      browsers: browserCounts,
      os: osCounts,
      operating_systems: osCounts,
      top_pages: topPages,
      pages: topPages,
      approx_geo: approxGeo,
      geo: approxGeo,
      countries: approxGeo,
      product_engagement: productsData,
      products: productsData,
      service_interest: servicesData,
      services: servicesData,
      lead_sources: leadSourcesList,
      leads: leadSourcesList,
      funnel: {
        stages: funnelStages,
        total_visitors: stage1Count,
        total_inquiries: stage5Count,
        overall_conversion_pct: conversionRatePct
      },
      funnel_stages: funnelStages,
      breakdown: {
        devices: deviceCounts,
        browsers: browserCounts,
        os: osCounts,
        countries: geoCounts,
        referrers: sourceVisits
      },
      recent_events: allEvents.slice(0, 20)
    };
  }

  async getAnalyticsHealth() {
    const uptimeSeconds = Math.round((Date.now() - SERVER_START_TIME) / 1000);
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const uptimeHuman = `${hours}h ${minutes}m ${seconds}s`;

    const samples = [...API_LATENCY_SAMPLES];
    const avgLat = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length * 10) / 10 : 0.0;
    const sorted = [...samples].sort((a, b) => a - b);
    const p95Lat = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : avgLat;

    const errRate = TOTAL_REQUESTS > 0 ? (HTTP_METRICS['5xx'] || 0) / TOTAL_REQUESTS : 0;
    const overallStatus = !this.connected || errRate >= 0.05 ? 'DEGRADED' : 'UP';

    const alerts = await this.getAlerts('unresolved', 20);
    const severityCounts = {
      CRITICAL: alerts.filter(a => a.severity === 'CRITICAL').length,
      HIGH: alerts.filter(a => a.severity === 'HIGH').length,
      MEDIUM: alerts.filter(a => a.severity === 'MEDIUM').length,
      INFO: alerts.filter(a => a.severity === 'INFO').length,
      total_unresolved: alerts.length
    };

    return {
      success: true,
      status: overallStatus,
      api_health: overallStatus,
      server: {
        status: overallStatus,
        uptime_seconds: uptimeSeconds,
        uptime_human: uptimeHuman,
        total_requests: TOTAL_REQUESTS,
        start_time: new Date(SERVER_START_TIME).toISOString()
      },
      latency: {
        avg_ms: avgLat,
        p95_ms: p95Lat,
        samples: samples.length
      },
      latency_ms: {
        avg: avgLat,
        p95: p95Lat
      },
      http_requests: {
        total: TOTAL_REQUESTS,
        by_status_class: HTTP_METRICS
      },
      smtp: {
        status: (SMTP_USER && SMTP_PASS) ? 'Connected' : 'Not Configured',
        configured: Boolean(SMTP_USER && SMTP_PASS),
        host: SMTP_HOST,
        port: SMTP_PORT
      },
      active_alerts_count: severityCounts.total_unresolved,
      database: this.getDbStatus(),
      alerts: severityCounts,
      recent_errors: RECENT_ERRORS.slice(-10)
    };
  }

  // --- Alert Management Methods ---

  async recordAlert(type, message, severity = 'INFO', details = '') {
    const alertRecord = {
      id: `alt_${crypto.randomBytes(4).toString('hex')}`,
      type: String(type || 'GENERAL').trim(),
      message: String(message || '').trim(),
      severity: ['INFO', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(severity) ? severity : 'INFO',
      details: String(details || '').trim(),
      status: 'unresolved',
      created_at: new Date().toISOString()
    };

    if (await this.ensureConnected()) {
      try {
        await this.db.collection('system_alerts').insertOne(alertRecord);
      } catch (e) {
        // ignore
      }
    }
    return alertRecord;
  }

  async getAlerts(status = 'all', limit = 50) {
    limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    if (await this.ensureConnected()) {
      try {
        const q = {};
        if (status && status !== 'all') {
          q.status = status;
        }
        return await this.db.collection('system_alerts')
          .find(q, { projection: { _id: 0 } })
          .sort({ created_at: -1 })
          .limit(limit)
          .toArray();
      } catch (err) {
        return [];
      }
    }
    return [];
  }

  async resolveAlert(id) {
    if (await this.ensureConnected()) {
      try {
        const res = await this.db.collection('system_alerts').updateOne(
          { id },
          { $set: { status: 'resolved', resolved_at: new Date().toISOString() } }
        );
        return res.modifiedCount > 0;
      } catch (err) {
        return false;
      }
    }
    return false;
  }

  async resolveAllAlerts() {
    if (await this.ensureConnected()) {
      try {
        const res = await this.db.collection('system_alerts').updateMany(
          { status: 'unresolved' },
          { $set: { status: 'resolved', resolved_at: new Date().toISOString() } }
        );
        return res.modifiedCount;
      } catch (err) {
        return 0;
      }
    }
    return 0;
  }
}

const dbManager = new DatabaseManager();
module.exports = dbManager;
