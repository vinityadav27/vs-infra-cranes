/* ============================================
   VS INFRA & CRANES — AI Product Consultant
   
   A client-side knowledge-based chatbot that:
   - Answers product/service questions from
     a built-in knowledge base
   - Recommends cranes based on user inputs
   - Escalates to human/WhatsApp when stuck
   - Uses fuzzy keyword matching (no API needed)
   
   ARCHITECTURE:
   All logic is client-side. The "AI" is a
   sophisticated pattern-matching engine with
   a structured knowledge graph. No external
   API calls required — works offline.
   
   For a production version, replace the
   matchQuery() function with an actual LLM
   API call (OpenAI, Gemini, etc.)
   ============================================ */

(function () {
  'use strict';

  // =========================================
  // KNOWLEDGE BASE
  // =========================================
  const PRODUCTS = [
    {
      id: 'single-girder-eot',
      name: 'Single Girder EOT Crane',
      category: 'EOT Crane',
      capacityRange: '1–20 Ton',
      capacityMin: 1, capacityMax: 20,
      spanMax: 25,
      bestFor: ['workshops', 'warehouses', 'light manufacturing', 'assembly lines', 'small factories'],
      industries: ['automobile', 'textile', 'warehouse', 'engineering', 'food', 'pharmaceutical'],
      keywords: ['single girder', 'single beam', 'overhead', 'eot', 'light duty', 'workshop crane', 'cheap crane', 'budget', 'small crane', 'single'],
      price: 'Budget-friendly',
      link: 'products/single-girder-eot-crane.html',
      summary: 'Cost-effective overhead crane for light to medium duty. Single beam design, capacity 1-20T, spans up to 25m. Ideal for workshops and warehouses.',
    },
    {
      id: 'double-girder-eot',
      name: 'Double Girder EOT Crane',
      category: 'EOT Crane',
      capacityRange: '5–50 Ton',
      capacityMin: 5, capacityMax: 50,
      spanMax: 35,
      bestFor: ['heavy manufacturing', 'steel plants', 'foundries', 'power plants', 'large factories'],
      industries: ['steel', 'power', 'construction', 'infrastructure', 'heavy engineering'],
      keywords: ['double girder', 'double beam', 'heavy duty', 'eot', 'high capacity', 'large crane', '50 ton', '30 ton', '20 ton', 'double', 'heavy'],
      price: 'Mid-range',
      link: 'products/double-girder-eot-crane.html',
      summary: 'Heavy-duty overhead crane for demanding applications. Double beam construction, capacity 5-50T, spans up to 35m. Best for steel plants and heavy industry.',
    },
    {
      id: 'gantry',
      name: 'Gantry Crane',
      category: 'Gantry Crane',
      capacityRange: '5–50 Ton',
      capacityMin: 5, capacityMax: 50,
      spanMax: 30,
      bestFor: ['outdoor yards', 'shipping yards', 'construction sites', 'open areas', 'rail yards'],
      industries: ['construction', 'infrastructure', 'railway', 'shipping', 'steel'],
      keywords: ['gantry', 'outdoor', 'yard', 'ground', 'rail', 'freestanding', 'open area', 'outside'],
      price: 'Mid-to-high',
      link: 'products/gantry-crane.html',
      summary: 'Freestanding crane running on ground-level rails. Capacity 5-50T. Ideal for outdoor yards and areas without building support structures.',
    },
    {
      id: 'goliath',
      name: 'Goliath Crane',
      category: 'Gantry Crane',
      capacityRange: '10–50 Ton',
      capacityMin: 10, capacityMax: 50,
      spanMax: 40,
      bestFor: ['heavy outdoor lifting', 'steel yards', 'precast yards', 'shipyards'],
      industries: ['steel', 'infrastructure', 'construction', 'heavy engineering'],
      keywords: ['goliath', 'extra heavy', 'massive', 'large gantry', 'steel yard', 'precast'],
      price: 'Premium',
      link: 'products/goliath-crane.html',
      summary: 'Extra-heavy-duty gantry crane for the most demanding outdoor operations. Capacity 10-50T, spans up to 40m.',
    },
    {
      id: 'semi-gantry',
      name: 'Semi-Gantry Crane',
      category: 'Gantry Crane',
      capacityRange: '5–30 Ton',
      capacityMin: 5, capacityMax: 30,
      spanMax: 20,
      bestFor: ['facilities with one wall support', 'space-constrained areas', 'hybrid setups'],
      industries: ['warehouse', 'engineering', 'automobile', 'construction'],
      keywords: ['semi gantry', 'half gantry', 'wall mounted', 'one side', 'hybrid', 'space saving', 'semi'],
      price: 'Mid-range',
      link: 'products/semi-gantry-crane.html',
      summary: 'Hybrid crane — one end on elevated runway, one on ground rail. Capacity 5-30T. Maximizes floor space utilization.',
    },
    {
      id: 'jib',
      name: 'Jib Crane',
      category: 'Jib Crane',
      capacityRange: '0.5–10 Ton',
      capacityMin: 0.5, capacityMax: 10,
      spanMax: 6,
      bestFor: ['workstations', 'loading bays', 'assembly areas', 'individual machines', 'small areas'],
      industries: ['automobile', 'engineering', 'warehouse', 'textile', 'food'],
      keywords: ['jib', 'swing', 'arm', 'pillar', 'workstation', 'small area', 'loading', '360', 'rotation', 'compact'],
      price: 'Budget-friendly',
      link: 'products/jib-crane.html',
      summary: 'Versatile workstation crane with 360° rotation. Capacity 0.5-10T. Perfect for precision lifting at individual workstations and loading bays.',
    },
    {
      id: 'wire-rope-hoist',
      name: 'Electric Wire Rope Hoist',
      category: 'Hoist',
      capacityRange: '1–20 Ton',
      capacityMin: 1, capacityMax: 20,
      spanMax: 0,
      bestFor: ['EOT crane hoisting', 'vertical lifting', 'integrated systems'],
      industries: ['all'],
      keywords: ['hoist', 'wire rope', 'electric hoist', 'lifting mechanism', 'motor', 'rope', 'wire'],
      price: 'Component',
      link: 'products/electric-wire-rope-hoist.html',
      summary: 'High-performance electric hoist for EOT cranes. Capacity 1-20T. Multiple speed options, low headroom design available.',
    },
    {
      id: 'chain-hoist',
      name: 'Chain Hoist',
      category: 'Hoist',
      capacityRange: '0.5–5 Ton',
      capacityMin: 0.5, capacityMax: 5,
      spanMax: 0,
      bestFor: ['light lifting', 'portable use', 'maintenance', 'small loads'],
      industries: ['all'],
      keywords: ['chain', 'chain hoist', 'manual', 'portable', 'light', 'small hoist', 'hand'],
      price: 'Budget',
      link: 'products/chain-hoist.html',
      summary: 'Compact lifting solution for lighter loads. Capacity 0.5-5T. Available in manual and electric variants. Portable and economical.',
    },
    {
      id: 'goods-lift',
      name: 'Goods Lift',
      category: 'Lifting Equipment',
      capacityRange: '0.5–5 Ton',
      capacityMin: 0.5, capacityMax: 5,
      spanMax: 0,
      bestFor: ['multi-floor material movement', 'warehouses', 'factories', 'mezzanine floors'],
      industries: ['warehouse', 'textile', 'food', 'pharmaceutical', 'automobile'],
      keywords: ['goods lift', 'elevator', 'lift', 'vertical transport', 'floor', 'mezzanine', 'material lift'],
      price: 'Mid-range',
      link: 'products/goods-lift.html',
      summary: 'Industrial goods elevator for moving materials between floors. Capacity 0.5-5T. Safety interlocks on all levels.',
    },
  ];

  const SERVICES_KB = [
    { keywords: ['installation', 'install', 'setup', 'commissioning', 'erection'], answer: 'We provide complete installation and commissioning services, including site survey, structural assessment, crane erection, load testing, and safety verification. Our trained team handles everything on-site.' },
    { keywords: ['amc', 'maintenance', 'annual', 'service contract', 'preventive'], answer: 'Our Annual Maintenance Contracts (AMC) include scheduled preventive maintenance, priority breakdown support, genuine spare parts, and detailed inspection reports. We manage 200+ active AMC contracts.' },
    { keywords: ['breakdown', 'emergency', 'repair', 'urgent', 'not working', 'stuck'], answer: '🚨 For breakdown/emergency: Call us at +91 99901 91859 — we offer 24/7 emergency breakdown service with rapid-response technicians and fully equipped service vehicles.' },
    { keywords: ['spare', 'parts', 'component', 'replacement'], answer: 'We stock genuine spare parts for all crane types — wire ropes, hooks, motors, brakes, contactors, wheels, and more. Quick delivery to minimize your downtime.' },
    { keywords: ['inspection', 'testing', 'load test', 'check', 'safety audit'], answer: 'We provide thorough crane inspection services: load testing, structural assessment, wire rope examination, electrical checks, and IS-standard compliance verification with detailed reports.' },
    { keywords: ['modernization', 'upgrade', 'retrofit', 'old crane', 'update'], answer: 'We modernize existing cranes with VFD drives, modern controls, enhanced safety features, and new hoisting mechanisms — extending equipment life at a fraction of replacement cost.' },
  ];

  const GENERAL_KB = [
    { keywords: ['price', 'cost', 'how much', 'rate', 'budget', 'quotation', 'quote', 'get a quote', 'get a quotation'], answer: 'Pricing depends on crane type, capacity, span, and customization. For an accurate quotation, please share your requirements:\n\n• <a href="request-quote.html" class="chat-link">📝 Request Quote Form</a>\n• <a href="tel:+919990191859" class="chat-link">📞 Call Sales (+91 99901 91859)</a>\n• <a href="https://wa.me/919990191859" target="_blank" class="chat-link">💬 WhatsApp (+91 99901 91859)</a>\n\nWe typically provide detailed technical quotes within 24-48 hours.' },
    { keywords: ['talk to engineer', 'engineer', 'human', 'specialist', 'technician', 'call engineer', 'speak to engineer'], answer: 'Our engineering team is ready to assist you directly with technical specifications, site feasibility, and custom sizing:\n\n• <a href="https://wa.me/919990191859" target="_blank" class="chat-link">💬 Chat on WhatsApp (+91 99901 91859)</a>\n• <a href="tel:+919990191859" class="chat-link">📞 Call Direct (+91 99901 91859)</a>\n• <a href="contact.html" class="chat-link">✉️ Send a Message</a>' },
    { keywords: ['products', 'view products', 'range', 'catalog', 'what do you make', 'all cranes'], answer: 'Explore our full manufacturing range:\n\n• <a href="products/single-girder-eot-crane.html" class="chat-link">Single Girder EOT Crane (1–20T)</a>\n• <a href="products/double-girder-eot-crane.html" class="chat-link">Double Girder EOT Crane (5–50T)</a>\n• <a href="products/gantry-crane.html" class="chat-link">Gantry Crane (5–50T)</a>\n• <a href="products/goliath-crane.html" class="chat-link">Goliath Crane (10–50T)</a>\n• <a href="products/semi-gantry-crane.html" class="chat-link">Semi-Gantry Crane (5–30T)</a>\n• <a href="products/jib-crane.html" class="chat-link">Jib Crane (0.5–5T)</a>\n• <a href="products/electric-wire-rope-hoist.html" class="chat-link">Electric Wire Rope Hoist (1–20T)</a>\n• <a href="products/chain-hoist.html" class="chat-link">Electric Chain Hoist (0.5–10T)</a>\n\n<a href="products.html" class="chat-link">🏭 View All Products →</a>' },
    { keywords: ['services info', 'all services'], answer: 'We provide end-to-end crane lifecycle services:\n\n• Custom Engineering & Fabrication\n• Installation & Commissioning\n• Annual Maintenance Contracts (AMC)\n• Crane Modernization & Upgrades\n• IS-Standard Load Testing & Certification\n\n<a href="services.html" class="chat-link">🛠️ View All Services →</a>' },
    { keywords: ['delivery', 'timeline', 'how long', 'time', 'lead time', 'when'], answer: 'Manufacturing typically takes 4-8 weeks depending on crane type and specs. Installation adds 1-2 weeks. We provide exact timelines during consultation.' },
    { keywords: ['location', 'where', 'address', 'office', 'factory', 'faridabad'], answer: 'We\'re based in Sector 6, IMT Faridabad, Haryana 121006. We serve industries across India and are expanding internationally.' },
    { keywords: ['area', 'service area', 'city', 'state', 'delhi', 'ncr', 'india', 'serve'], answer: 'We serve industries across India — Delhi NCR, Haryana, Rajasthan, UP, Punjab, Maharashtra, and beyond. For larger projects, we deliver and install pan-India.' },
    { keywords: ['certification', 'iso', 'standard', 'compliant', 'quality'], answer: 'We are ISO certified, MSME registered, GST compliant, and manufacture to IS:3177 & IS:807 standards. All cranes undergo rigorous load testing before delivery.' },
    { keywords: ['warranty', 'guarantee'], answer: 'We provide warranty on all our cranes and components. Specific warranty terms vary by product type — please contact our sales team for details.' },
    { keywords: ['custom', 'customize', 'special', 'bespoke', 'tailor'], answer: 'Absolutely! Every crane we manufacture is custom-engineered to your specifications — capacity, span, lift height, control type, duty class, and special features like anti-sway or tandem operation.' },
    { keywords: ['about', 'company', 'who', 'history', 'founded'], answer: 'VS Infra & Cranes is a leading crane manufacturer based in Faridabad, Haryana. Founded in 2021, we\'ve completed 500+ installations for 200+ clients across diverse industries. <a href="about.html" class="chat-link">Learn more about us →</a>' },
    { keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'], answer: 'Hello! 👋 I\'m the VS Infra & Cranes assistant. How can I help you today? I can help you with:\n\n• Finding the right crane for your needs\n• Product specifications\n• Service information\n• Getting a quote\n\nJust ask!' },
    { keywords: ['thank', 'thanks', 'bye', 'goodbye'], answer: 'You\'re welcome! If you need anything else, feel free to ask. You can also reach us at +91 99901 91859 or <a href="contact.html" class="chat-link">Contact Us</a>. Have a great day! 🙏' },
  ];

  // =========================================
  // RECOMMENDATION ENGINE
  // =========================================
  function recommendProduct(capacity, span, industry, environment) {
    const results = [];
    const cap = parseFloat(capacity) || 0;
    const sp = parseFloat(span) || 0;
    const ind = (industry || '').toLowerCase();
    const env = (environment || '').toLowerCase();

    PRODUCTS.forEach(p => {
      let score = 0;

      // Capacity fit
      if (cap > 0 && cap >= p.capacityMin && cap <= p.capacityMax) score += 40;
      else if (cap > 0 && cap <= p.capacityMax * 1.1) score += 20;

      // Span fit
      if (sp > 0 && p.spanMax > 0 && sp <= p.spanMax) score += 20;

      // Industry match
      if (ind && (p.industries.includes('all') || p.industries.some(i => ind.includes(i)))) score += 15;

      // Environment (outdoor = gantry/goliath)
      if (env.includes('outdoor') || env.includes('yard') || env.includes('open')) {
        if (p.category === 'Gantry Crane') score += 25;
        if (p.category === 'EOT Crane') score -= 10;
      }
      if (env.includes('indoor') || env.includes('factory') || env.includes('workshop')) {
        if (p.category === 'EOT Crane') score += 15;
        if (p.category === 'Gantry Crane') score -= 5;
      }
      if (env.includes('workstation') || env.includes('small') || env.includes('individual')) {
        if (p.id === 'jib') score += 30;
      }
      if (env.includes('floor') || env.includes('mezzanine') || env.includes('elevator')) {
        if (p.id === 'goods-lift') score += 40;
      }

      // Best-for match
      p.bestFor.forEach(bf => {
        if (ind.includes(bf) || env.includes(bf)) score += 10;
      });

      if (score > 0) results.push({ product: p, score });
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 3);
  }

  // =========================================
  // QUERY MATCHING
  // =========================================
  function matchQuery(query) {
    const q = query.toLowerCase().trim();

    // 1. Check if asking for recommendation
    const recPatterns = [
      /(?:which|what|suggest|recommend|best|right|suitable|need|want).*(?:crane|hoist|lift)/,
      /(?:crane|hoist|lift).*(?:for|need|want|suit)/,
      /(?:i need|i want|looking for|searching for)/,
    ];
    if (recPatterns.some(p => p.test(q))) {
      return {
        type: 'recommend',
        message: 'I\'d love to help you find the right crane! Let me ask a few questions:',
      };
    }

    // 2. Check products
    for (const p of PRODUCTS) {
      const matches = p.keywords.filter(kw => q.includes(kw));
      if (matches.length >= 1) {
        return {
          type: 'product',
          product: p,
          message: `**${p.name}** — ${p.summary}\n\n• Capacity: ${p.capacityRange}\n• Best for: ${p.bestFor.slice(0, 3).join(', ')}\n• Price range: ${p.price}\n\n<a href="${p.link}" class="chat-link">View Full Details →</a>`,
        };
      }
    }

    // 3. Check services
    for (const s of SERVICES_KB) {
      if (s.keywords.some(kw => q.includes(kw))) {
        return { type: 'service', message: s.answer };
      }
    }

    // 4. Check general
    for (const g of GENERAL_KB) {
      if (g.keywords.some(kw => q.includes(kw))) {
        return { type: 'general', message: g.answer };
      }
    }

    // 5. Fallback — escalate
    return {
      type: 'escalate',
      message: 'I\'m not sure I have the answer to that specific question. Let me connect you with our team:\n\n<a href="https://wa.me/919990191859" target="_blank" class="chat-link">💬 Chat on WhatsApp</a>\n<a href="tel:+919990191859" class="chat-link">📞 Call an Engineer</a>\n<a href="contact.html" class="chat-link">✉️ Send us a message</a>',
    };
  }

  // =========================================
  // CHAT UI
  // =========================================
  function buildChatUI() {
    // Avoid double injection
    if (document.getElementById('ai-chat-window')) return;

    // ----- Chat Window -----
    const chatWindow = document.createElement('div');
    chatWindow.id = 'ai-chat-window';
    chatWindow.style.cssText = `
      position: fixed;
      bottom: 95px;
      right: 24px;
      width: min(390px, calc(100vw - 32px));
      max-height: 540px;
      background: #1A1A2E;
      border: 1.5px solid rgba(232, 99, 10, 0.6);
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.65), 0 0 25px rgba(232,99,10,0.2);
      z-index: 10005;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: 'Inter', sans-serif;
    `;

    chatWindow.innerHTML = `
      <div style="padding: 14px 16px; background: linear-gradient(135deg, #1A1A2E 0%, #291508 100%); color: white; display: flex; align-items: center; gap: 12px; flex-shrink: 0; border-bottom: 1px solid rgba(232,99,10,0.25);">
        <!-- Dedicated AI Robot Avatar Icon (Distinct from Company Logo) -->
        <div style="width: 38px; height: 38px; border-radius: 50%; background: rgba(232,99,10,0.18); display: flex; align-items: center; justify-content: center; border: 1.5px solid #E8630A; color: #E8630A; flex-shrink: 0; position: relative;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v2"></path>
            <rect x="4" y="4" width="16" height="12" rx="3"></rect>
            <circle cx="9" cy="10" r="1.5" fill="currentColor"></circle>
            <circle cx="15" cy="10" r="1.5" fill="currentColor"></circle>
            <path d="M9 14h6"></path>
            <path d="M2 10h2"></path>
            <path d="M20 10h2"></path>
            <path d="M8 16v3"></path>
            <path d="M16 16v3"></path>
          </svg>
          <span style="position: absolute; bottom: 0; right: 0; width: 8px; height: 8px; background: #22c55e; border-radius: 50%; border: 1.5px solid #1A1A2E;"></span>
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 700; font-size: 13.5px; font-family: 'Space Grotesk', sans-serif; color: #fff; display: flex; align-items: center; gap: 6px;">
            VS Crane AI Assistant
            <span style="font-size: 9px; background: #E8630A; color: #fff; padding: 1px 5px; border-radius: 8px; font-weight: 700;">BOT</span>
          </div>
          <div style="font-size: 11px; color: rgba(255,255,255,0.6);">Technical Advisor • Online</div>
        </div>
        <!-- Close Button (X) with large hit target -->
        <button id="chat-close" type="button" aria-label="Close chat" style="
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.2);
          color: #ffffff;
          cursor: pointer;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all 0.2s ease;
        ">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <!-- Messages container -->
      <div id="chat-messages" style="flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; max-height: 350px;"></div>

      <!-- Input area -->
      <div style="padding: 10px 14px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; gap: 8px; flex-shrink: 0; background: #141424;">
        <input id="chat-input" type="text" placeholder="Ask about cranes, capacity, services..."
          style="flex: 1; padding: 10px 14px; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px;
          font-size: 13px; outline: none; background: #0d0d18; color: #fff;
          font-family: 'Inter', sans-serif;" />
        <button id="chat-send" type="button" style="width: 40px; height: 40px; border-radius: 10px; background: #E8630A; color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.2s;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    `;

    // ----- 3D-Style Smart AI Engagement Popup -----
    const smartPopup = document.createElement('div');
    smartPopup.id = 'ai-smart-popup';
    smartPopup.setAttribute('role', 'dialog');
    smartPopup.setAttribute('aria-label', 'AI Crane Consultant');
    smartPopup.innerHTML = `
      <button id="ai-popup-close" class="ai-popup-close-btn" type="button" aria-label="Dismiss AI Help">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      <div class="ai-card-content">
        <!-- 3D-Style Polished AI Avatar -->
        <div class="ai-avatar-wrapper">
          <div class="ai-avatar-orb">
            <svg class="ai-3d-avatar-svg" viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="aiOrbGrad" cx="35%" cy="30%" r="70%">
                  <stop offset="0%" stop-color="#3d3d63"/>
                  <stop offset="55%" stop-color="#1e1e36"/>
                  <stop offset="100%" stop-color="#0e0e1c"/>
                </radialGradient>
                <linearGradient id="aiVisorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#22d3ee"/>
                  <stop offset="100%" stop-color="#0284c7"/>
                </linearGradient>
                <linearGradient id="aiGoldAccent" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#ff9d54"/>
                  <stop offset="100%" stop-color="#E8630A"/>
                </linearGradient>
                <filter id="aiGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#E8630A" flood-opacity="0.45"/>
                </filter>
              </defs>
              <circle cx="27" cy="27" r="25" fill="url(#aiOrbGrad)" stroke="url(#aiGoldAccent)" stroke-width="1.8" filter="url(#aiGlow)"/>
              <circle cx="27" cy="27" r="22" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
              <rect x="14" y="15" width="26" height="21" rx="7" fill="#151528" stroke="url(#aiGoldAccent)" stroke-width="1.6"/>
              <rect x="11" y="21" width="3" height="9" rx="1.5" fill="#E8630A"/>
              <rect x="40" y="21" width="3" height="9" rx="1.5" fill="#E8630A"/>
              <path d="M27 15V8" stroke="#ff9d54" stroke-width="2" stroke-linecap="round"/>
              <circle cx="27" cy="7" r="3" fill="#ff7700"/>
              <rect x="18" y="20" width="18" height="7" rx="3.5" fill="url(#aiVisorGrad)"/>
              <circle cx="22.5" cy="23.5" r="1.8" fill="#ffffff"/>
              <circle cx="31.5" cy="23.5" r="1.8" fill="#ffffff"/>
              <path d="M23 30Q27 33 31 30" stroke="#ff9d54" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </div>
          <span class="ai-status-pulse" title="AI Crane Consultant Online"></span>
        </div>

        <div class="ai-text-area">
          <div class="ai-badge-row">
            <span class="ai-badge-label">✨ AI Help</span>
          </div>
          <h4 class="ai-popup-headline">Need Help?</h4>
          <p class="ai-popup-message">Looking for the right crane or need a quotation?</p>
          <button id="ai-popup-cta" class="ai-popup-btn" type="button">
            <span>Get AI Help</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        </div>
      </div>
    `;

    // ----- Original Floating AI Button (ALWAYS VISIBLE) -----
    // Placed directly inside .floating-cta above WhatsApp button
    const aiBtn = document.createElement('button');
    aiBtn.id = 'ai-chat-toggle';
    aiBtn.className = 'floating-btn floating-ai';
    aiBtn.setAttribute('aria-label', 'Ask AI Assistant');
    aiBtn.setAttribute('title', 'Get AI Help for your queries');
    aiBtn.type = 'button';
    aiBtn.style.cssText = `
      position: relative;
      background: linear-gradient(135deg, #1A1A2E 0%, #2a1506 100%);
      border: 2px solid #E8630A;
      color: #E8630A;
      box-shadow: 0 6px 20px rgba(0,0,0,0.45), 0 0 14px rgba(232,99,10,0.3);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: all 0.25s ease;
      outline: none;
      z-index: 10000;
    `;
    aiBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#E8630A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
        <path d="M12 2v2"></path>
        <rect x="4" y="4" width="16" height="12" rx="3"></rect>
        <circle cx="9" cy="10" r="1.5" fill="#E8630A"></circle>
        <circle cx="15" cy="10" r="1.5" fill="#E8630A"></circle>
        <path d="M9 14h6"></path>
        <path d="M2 10h2"></path>
        <path d="M20 10h2"></path>
        <path d="M8 16v3"></path>
        <path d="M16 16v3"></path>
      </svg>
      <span style="font-size: 8px; font-weight: 700; color: #E8630A; font-family: 'Space Grotesk', sans-serif; letter-spacing: 0.5px; margin-top: 1px; line-height: 1; pointer-events: none;">AI HELP</span>
    `;

    // Place the AI button DIRECTLY ABOVE WhatsApp inside .floating-cta
    let floatingCta = document.querySelector('.floating-cta');
    if (floatingCta) {
      floatingCta.insertBefore(aiBtn, floatingCta.firstChild);
    } else {
      floatingCta = document.createElement('div');
      floatingCta.className = 'floating-cta';
      floatingCta.appendChild(aiBtn);
      document.body.appendChild(floatingCta);
    }

    // Inject CSS for smart popup, animations, and responsiveness
    const style = document.createElement('style');
    style.textContent = `
      #ai-smart-popup {
        position: fixed;
        bottom: 235px;
        right: 24px;
        width: 300px;
        max-width: calc(100vw - 32px);
        background: linear-gradient(145deg, rgba(30, 30, 50, 0.97) 0%, rgba(18, 18, 32, 0.98) 100%);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1.5px solid rgba(232, 99, 10, 0.5);
        border-radius: 20px;
        box-shadow: 0 16px 45px rgba(0, 0, 0, 0.6), 0 0 28px rgba(232, 99, 10, 0.25);
        z-index: 10001;
        padding: 16px 18px 18px 18px;
        cursor: pointer;
        display: none;
        opacity: 0;
        transform: perspective(700px) rotateY(-5deg) rotateX(3deg) translateX(40px) scale(0.95);
        transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease, border-color 0.3s ease;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: #ffffff;
        user-select: none;
      }
      #ai-smart-popup.ai-popup-visible {
        opacity: 1;
        transform: perspective(700px) rotateY(-4deg) rotateX(2deg) translateX(0) scale(1);
        animation: aiFloatBob 4s ease-in-out infinite alternate;
      }
      #ai-smart-popup:hover {
        transform: perspective(700px) rotateY(0deg) rotateX(0deg) translateY(-4px) scale(1.02);
        border-color: #ff7700;
        box-shadow: 0 22px 55px rgba(0, 0, 0, 0.7), 0 0 38px rgba(232, 99, 10, 0.38);
      }
      @keyframes aiFloatBob {
        0% { transform: perspective(700px) rotateY(-4deg) rotateX(2deg) translateY(0); }
        100% { transform: perspective(700px) rotateY(-4deg) rotateX(2deg) translateY(-6px); }
      }
      .ai-popup-close-btn {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: rgba(255, 255, 255, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        z-index: 10;
      }
      .ai-popup-close-btn:hover {
        background: #ef4444;
        border-color: #ef4444;
        color: #ffffff;
        transform: scale(1.1);
      }
      .ai-card-content {
        display: flex;
        align-items: flex-start;
        gap: 14px;
      }
      .ai-avatar-wrapper {
        position: relative;
        flex-shrink: 0;
        width: 52px;
        height: 52px;
        margin-top: 2px;
      }
      .ai-avatar-orb {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        filter: drop-shadow(0 4px 12px rgba(232, 99, 10, 0.45));
        transition: transform 0.3s ease;
      }
      #ai-smart-popup:hover .ai-avatar-orb {
        transform: scale(1.08) rotate(-4deg);
      }
      .ai-3d-avatar-svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      .ai-status-pulse {
        position: absolute;
        bottom: 2px;
        right: 2px;
        width: 11px;
        height: 11px;
        background: #22c55e;
        border: 2px solid #141424;
        border-radius: 50%;
        box-shadow: 0 0 8px #22c55e;
        animation: aiPulse 2s infinite;
      }
      @keyframes aiPulse {
        0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
        70% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
        100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
      }
      .ai-text-area {
        flex: 1;
        min-width: 0;
      }
      .ai-badge-row {
        display: flex;
        align-items: center;
        margin-bottom: 4px;
      }
      .ai-badge-label {
        font-size: 10.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #ff9d54;
        background: rgba(232, 99, 10, 0.15);
        padding: 2px 7px;
        border-radius: 6px;
        border: 1px solid rgba(232, 99, 10, 0.3);
      }
      .ai-popup-headline {
        margin: 0 0 4px 0;
        font-size: 16px;
        font-weight: 800;
        font-family: 'Space Grotesk', -apple-system, sans-serif;
        color: #ffffff;
        letter-spacing: -0.2px;
      }
      .ai-popup-message {
        margin: 0 0 12px 0;
        font-size: 12.5px;
        color: rgba(255, 255, 255, 0.78);
        line-height: 1.45;
      }
      .ai-popup-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 9px 14px;
        background: linear-gradient(135deg, #E8630A 0%, #ff7700 100%);
        color: #ffffff;
        font-weight: 700;
        font-size: 13px;
        font-family: 'Space Grotesk', -apple-system, sans-serif;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(232, 99, 10, 0.4);
        transition: all 0.25s ease;
      }
      .ai-popup-btn:hover {
        background: linear-gradient(135deg, #ff7700 0%, #ff9433 100%);
        box-shadow: 0 6px 20px rgba(232, 99, 10, 0.6);
        transform: translateY(-1px);
      }

      #chat-close:hover {
        background: #ef4444 !important;
        border-color: #ef4444 !important;
        color: white !important;
        transform: scale(1.08);
      }
      .chat-msg { max-width: 85%; padding: 10px 14px; border-radius: 14px; font-size: 13px; line-height: 1.6; animation: chatMsgIn 0.25s ease; word-break: break-word; }
      .chat-msg a { color: #E8630A; text-decoration: underline; font-weight: 600; }
      .chat-msg strong { font-weight: 600; color: #fff; }
      @keyframes chatMsgIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      .chat-bot { background: #232338; color: #e2e8f0; border-bottom-left-radius: 4px; align-self: flex-start; border: 1px solid rgba(255,255,255,0.06); }
      .chat-user { background: #E8630A; color: white; border-bottom-right-radius: 4px; align-self: flex-end; }
      .chat-link { display: inline-block; margin: 3px 3px 3px 0; padding: 4px 10px; background: rgba(232,99,10,0.18); color: #E8630A !important; text-decoration: none !important; border-radius: 6px; font-size: 11.5px; font-weight: 600; }
      .chat-link:hover { background: rgba(232,99,10,0.3); color: #fff !important; }
      .chat-quick-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
      .chat-quick-btn { padding: 6px 12px; background: rgba(232,99,10,0.12); color: #E8630A; border: 1px solid rgba(232,99,10,0.35); border-radius: 8px; font-size: 11.5px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
      .chat-quick-btn:hover { background: #E8630A; color: white; }

      @media (max-width: 768px) {
        #ai-smart-popup {
          bottom: 210px;
          right: 12px;
          width: 270px;
          padding: 14px 14px 14px 14px;
          border-radius: 16px;
        }
        .ai-avatar-wrapper {
          width: 44px;
          height: 44px;
        }
        .ai-popup-headline {
          font-size: 14.5px;
        }
        .ai-popup-message {
          font-size: 11.5px;
          margin-bottom: 10px;
        }
        .ai-popup-btn {
          padding: 8px 12px;
          font-size: 12px;
        }
        #ai-chat-window {
          bottom: 80px !important;
          right: 12px !important;
          left: 12px !important;
          width: auto !important;
          max-height: calc(100vh - 120px) !important;
        }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(chatWindow);
    document.body.appendChild(smartPopup);

    // State
    let isOpen = false;
    let recState = null;

    function openChat() {
      isOpen = true;
      if (smartPopup) {
        smartPopup.classList.remove('ai-popup-visible');
        smartPopup.style.display = 'none';
      }
      chatWindow.style.setProperty('display', 'flex', 'important');
      const msgs = document.getElementById('chat-messages');
      if (msgs && msgs.children.length === 0) {
        addBotMsg('Hello! 👋 I\'m the VS Crane AI Assistant. I can help you:\n\n• Find the right crane for your needs\n• Answer product & service questions\n• Sizing and technical specs\n• Request a quick quotation\n\nWhat would you like to know?');
        addQuickButtons(['Recommend a crane', 'View products', 'Get a quote', 'Services info', '3D Catalog']);
      }
      setTimeout(() => {
        const inp = document.getElementById('chat-input');
        if (inp) inp.focus();
      }, 100);
    }

    function closeChat() {
      isOpen = false;
      chatWindow.style.setProperty('display', 'none', 'important');
    }

    function showSmartPopup() {
      if (isNegativeContext() || isDismissed() || isOpen) return;
      smartPopup.style.display = 'block';
      void smartPopup.offsetWidth; // Force CSS reflow for smooth animation
      smartPopup.classList.add('ai-popup-visible');
    }

    function hideSmartPopup(isDismissal) {
      if (!smartPopup) return;
      smartPopup.classList.remove('ai-popup-visible');
      setTimeout(() => {
        if (!smartPopup.classList.contains('ai-popup-visible')) {
          smartPopup.style.display = 'none';
        }
      }, 350);

      if (isDismissal) {
        sessionStorage.setItem('vs_ai_popup_dismissed', 'true');
      }
    }

    // 1. Original AI button click: toggles chat
    aiBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isOpen) {
        closeChat();
      } else {
        hideSmartPopup(false);
        openChat();
      }
    });

    // 2. Popup CTA button click: opens chat
    const popupCta = document.getElementById('ai-popup-cta');
    if (popupCta) {
      popupCta.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideSmartPopup(false);
        openChat();
      });
    }

    // 3. Popup card click (opens chat if not clicking close)
    smartPopup.addEventListener('click', (e) => {
      if (e.target.closest('#ai-popup-close')) return;
      e.preventDefault();
      e.stopPropagation();
      hideSmartPopup(false);
      openChat();
    });

    // 4. Close button on popup (X)
    const popupCloseBtn = document.getElementById('ai-popup-close');
    if (popupCloseBtn) {
      popupCloseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideSmartPopup(true);
      });
    }

    // 5. Close button (X) inside chat window
    const closeBtn = document.getElementById('chat-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeChat();
      });
    }

    // Stop propagation on clicks inside chatWindow so internal clicks never bubble to document
    chatWindow.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // 6. Close when clicking outside chat window
    document.addEventListener('click', (e) => {
      if (!isOpen) return;
      // If clicked element was detached/removed during click handling (e.g. quick reply buttons), ignore
      if (e.target && !e.target.isConnected) return;
      if (chatWindow && chatWindow.contains(e.target)) return;
      if (aiBtn && aiBtn.contains(e.target)) return;
      if (smartPopup && smartPopup.contains(e.target)) return;
      closeChat();
    });

    // 7. Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        closeChat();
      }
    });

    // =========================================
    // SMART ENGAGEMENT DETECTION ENGINE
    // =========================================
    function isNegativeContext() {
      const p = (window.location.pathname || '').toLowerCase();
      if (p.includes('request-quote') || p.includes('contact') || p.includes('thank-you') || p.includes('admin')) {
        return true;
      }
      if (sessionStorage.getItem('vs_inquiry_submitted') === 'true') return true;
      if (sessionStorage.getItem('vs_quote_cta_clicked') === 'true') return true;
      return false;
    }

    function isDismissed() {
      return sessionStorage.getItem('vs_ai_popup_dismissed') === 'true';
    }

    // Global listener: If user clicks Request Quote or Contact links/buttons outside the chat, do not interrupt them
    document.addEventListener('click', (e) => {
      if (chatWindow && chatWindow.contains(e.target)) return;
      const target = e.target.closest('a, button');
      if (!target) return;
      const href = (target.getAttribute('href') || '').toLowerCase();
      const txt = (target.textContent || '').toLowerCase();
      if (href.includes('request-quote') || href.includes('contact') || txt.includes('request quote') || txt.includes('get a quote')) {
        sessionStorage.setItem('vs_quote_cta_clicked', 'true');
        hideSmartPopup(false);
      }
    }, { capture: true, passive: true });

    // Track active presence vs idle
    let activeSeconds = parseInt(sessionStorage.getItem('vs_ai_active_secs') || '0', 10);
    let lastActivityTime = Date.now();
    let isUserActive = true;
    let hasScrolledMeaningfully = false;
    let interactionCount = 0;
    let popupTriggered = false;

    // Track page views in this session
    let pageViews = parseInt(sessionStorage.getItem('vs_ai_pvs') || '0', 10) + 1;
    sessionStorage.setItem('vs_ai_pvs', pageViews.toString());

    // Page contextual signals
    const pathStr = (window.location.pathname || '').toLowerCase();
    const isProductPage = pathStr.includes('/products/') || pathStr.includes('products.html');
    const isServiceOrCatalog = pathStr.includes('services.html') || pathStr.includes('catalog.html');
    const isHighIntentPage = isProductPage || isServiceOrCatalog;

    function recordActivity() {
      lastActivityTime = Date.now();
      isUserActive = true;
    }

    ['mousemove', 'scroll', 'mousedown', 'touchstart', 'keydown'].forEach(evt => {
      window.addEventListener(evt, recordActivity, { passive: true });
    });

    window.addEventListener('scroll', () => {
      const sy = window.scrollY || window.pageYOffset;
      if (sy > 350) hasScrolledMeaningfully = true;
    }, { passive: true });

    document.addEventListener('click', (e) => {
      const el = e.target.closest('.spec-item, .thumb-item, .tab-btn, .service-card, .interactive-view, video, [data-angle], .model-card');
      if (el) interactionCount++;
    }, { passive: true });

    // Engagement Loop: checks every 1 second
    const engagementInterval = setInterval(() => {
      if (popupTriggered || isOpen) return;
      if (isNegativeContext() || isDismissed()) return;

      const now = Date.now();
      // If idle for more than 15 seconds or tab not active/visible, pause counting active time
      if (now - lastActivityTime > 15000 || document.visibilityState !== 'visible') {
        isUserActive = false;
        return;
      }

      activeSeconds++;
      sessionStorage.setItem('vs_ai_active_secs', activeSeconds.toString());

      // Meaningful exploration conditions:
      // Active scroll OR product/service detail page OR multi-page visit OR interacted with product media
      const hasExplored = hasScrolledMeaningfully || isHighIntentPage || pageViews >= 2 || interactionCount >= 1;

      // Must have spent ~60-90s of active engagement (activeSeconds >= 60), be currently active, and have explored
      if (activeSeconds >= 60 && hasExplored && isUserActive) {
        popupTriggered = true;
        clearInterval(engagementInterval);
        showSmartPopup();
      }
    }, 1000);

    // Send button & input handlers
    const sendBtn = document.getElementById('chat-send');
    const inputEl = document.getElementById('chat-input');

    if (sendBtn) {
      sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleSend();
      });
    }
    if (inputEl) {
      inputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSend();
      });
    }

    function handleSend() {
      const input = document.getElementById('chat-input');
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';

      addUserMsg(text);

      // Check if user asked about catalog
      if (/catalog|brochure|catalogue|pdf|notebook/i.test(text)) {
        setTimeout(() => {
          addBotMsg('You can view our interactive 3D digital company catalog right now:\n\n<a href="catalog.html" class="chat-link">📖 Open 3D Catalog →</a>');
        }, 400);
        return;
      }

      // Check if in recommendation flow
      if (recState) {
        handleRecFlow(text);
        return;
      }

      // Normal query matching
      const result = matchQuery(text);

      if (result.type === 'recommend') {
        recState = { step: 0, data: {} };
        addBotMsg('Let\'s find the perfect crane for you! First question:');
        setTimeout(() => {
          addBotMsg('**What capacity (in tons) do you need?**\n\nFor example: 5, 10, 20, 50');
        }, 500);
        return;
      }

      setTimeout(() => {
        addBotMsg(result.message);
        if (result.type === 'product') {
          addQuickButtons(['Get a quote for this', 'View 3D Catalog', 'Talk to engineer']);
        }
      }, 350 + Math.random() * 300);
    }

    function handleRecFlow(text) {
      switch (recState.step) {
        case 0:
          recState.data.capacity = text;
          recState.step = 1;
          setTimeout(() => {
            addBotMsg('**What span (distance between rails) in meters?**\n\nIf not sure, type "not sure".');
          }, 400);
          break;

        case 1:
          recState.data.span = text.toLowerCase().includes('sure') ? '' : text;
          recState.step = 2;
          setTimeout(() => {
            addBotMsg('**What industry are you in?**');
            addQuickButtons(['Steel', 'Automobile', 'Warehouse', 'Construction', 'Engineering', 'Other']);
          }, 400);
          break;

        case 2:
          recState.data.industry = text;
          recState.step = 3;
          setTimeout(() => {
            addBotMsg('**Will this be used indoors or outdoors?**');
            addQuickButtons(['Indoor / Factory', 'Outdoor / Yard', 'Both', 'Not sure']);
          }, 400);
          break;

        case 3:
          recState.data.environment = text;
          const recs = recommendProduct(
            recState.data.capacity,
            recState.data.span,
            recState.data.industry,
            recState.data.environment
          );
          recState = null;

          setTimeout(() => {
            if (recs.length === 0) {
              addBotMsg('Based on your requirements, I\'d recommend speaking directly with our engineering team for a custom solution.\n\n<a href="contact.html" class="chat-link">📞 Talk to an Engineer</a>');
            } else {
              let msg = '🎯 **Based on your requirements, here are my top recommendations:**\n\n';
              recs.forEach((r, i) => {
                msg += `**${i + 1}. ${r.product.name}**\n`;
                msg += `Capacity: ${r.product.capacityRange} · ${r.product.price}\n`;
                msg += `<a href="${r.product.link}" class="chat-link">View Details</a>\n\n`;
              });
              msg += 'Want a detailed quote for any of these? 👇';
              addBotMsg(msg);
              addQuickButtons(['Get a quote', 'View 3D Catalog', 'Talk to engineer']);
            }
          }, 700);
          break;
      }
    }

    function addBotMsg(text) {
      const msgs = document.getElementById('chat-messages');
      if (!msgs) return;
      const div = document.createElement('div');
      div.className = 'chat-msg chat-bot';
      div.innerHTML = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br/>');
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }

    function addUserMsg(text) {
      const msgs = document.getElementById('chat-messages');
      if (!msgs) return;
      const div = document.createElement('div');
      div.className = 'chat-msg chat-user';
      div.textContent = text;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }

    function addQuickButtons(options) {
      const msgs = document.getElementById('chat-messages');
      if (!msgs) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'chat-quick-btns';
      options.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chat-quick-btn';
        btn.textContent = opt;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          wrapper.remove();
          const inp = document.getElementById('chat-input');
          if (inp) inp.value = opt;
          handleSend();
        });
        wrapper.appendChild(btn);
      });
      msgs.appendChild(wrapper);
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  // ---- Init ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildChatUI);
  } else {
    buildChatUI();
  }

})();
