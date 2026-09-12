/* ============================================
   VS INFRA & CRANES — Core JavaScript
   Theme, Navigation, Scroll Reveal, Animations
   ============================================ */

// Portable API Base URL Resolution Helper
function getVsApiBase() {
  if (typeof window !== 'undefined' && window.VS_API_BASE) return window.VS_API_BASE.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.__API_BASE__) return window.__API_BASE__.replace(/\/+$/, '');
  if (window.location.protocol === 'file:' || !window.location.origin || window.location.origin === 'null') {
    return 'http://localhost:8080';
  }
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '[::1]';
  if (isLocal && window.location.port && window.location.port !== '8080') {
    return `http://${hostname}:8080`;
  }
  return '';
}
window.getVsApiBase = getVsApiBase;

// ---- Lead Intelligence & Engagement Analytics (Privacy-First) ----
const VSAnalytics = {
  sessionId: '',
  landingPage: '',
  initialReferrer: '',
  leadSource: 'Direct',
  utmParams: {},
  lastProduct: null,
  lastService: null,
  hasStartedInquiry: false,

  init() {
    try {
      // Skip analytics collection on localhost/development environments
      const hostname = window.location.hostname;
      this._isDev = (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '[::1]' || window.location.protocol === 'file:');

      // 1. Anonymous Session ID (sessionStorage only, no tracking cookies)
      let sId = sessionStorage.getItem('vs_session_id');
      if (!sId) {
        sId = 'sess_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        sessionStorage.setItem('vs_session_id', sId);
      }
      this.sessionId = sId;

      // 2. Landing Page
      let lp = sessionStorage.getItem('vs_landing_page');
      if (!lp) {
        lp = window.location.pathname || '/index.html';
        sessionStorage.setItem('vs_landing_page', lp);
      }
      this.landingPage = lp;

      // 3. Initial Referrer
      let ref = sessionStorage.getItem('vs_initial_referrer');
      if (!ref) {
        ref = document.referrer || 'Direct';
        sessionStorage.setItem('vs_initial_referrer', ref);
      }
      this.initialReferrer = ref;

      // 4. UTM Parameters
      const urlParams = new URLSearchParams(window.location.search);
      const utms = {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(k => {
        const val = urlParams.get(k);
        if (val) utms[k] = val.trim();
      });
      if (Object.keys(utms).length > 0) {
        sessionStorage.setItem('vs_utms', JSON.stringify(utms));
        this.utmParams = utms;
      } else {
        try {
          this.utmParams = JSON.parse(sessionStorage.getItem('vs_utms') || '{}');
        } catch (e) {
          this.utmParams = {};
        }
      }

      // 5. Categorize Lead Source
      this.leadSource = this.computeLeadSource();

      // 6. Detect Product / Service Context from Page
      this.detectPageContext();

      // 7. Track initial page view via beacon / fetch
      this.trackEvent('page_view');
      if (this.lastProduct) {
        this.trackEvent('product_view', { productId: this.lastProduct.id, productName: this.lastProduct.name });
      } else if (this.lastService) {
        this.trackEvent('service_view', { serviceId: this.lastService.id, serviceName: this.lastService.name });
      }

      // 8. Bind interaction listeners
      this.bindListeners();
    } catch (e) {
      console.warn('VSAnalytics init notice:', e);
    }
  },

  computeLeadSource() {
    const ref = (this.initialReferrer || '').toLowerCase();
    const utmS = (this.utmParams.utm_source || '').toLowerCase();
    const utmM = (this.utmParams.utm_medium || '').toLowerCase();

    if (utmS === 'whatsapp' || ref.includes('whatsapp') || ref.includes('wa.me')) return 'WhatsApp';
    if (utmS.includes('google') || ref.includes('google')) {
      if (utmM.includes('cpc') || utmM.includes('ads')) return 'Google Ads';
      return 'Google Search';
    }
    if (/bing|yahoo|duckduckgo|ecosia|baidu/.test(ref) || /bing|yahoo|duckduckgo/.test(utmS)) return 'Organic Search';
    if (/facebook|instagram|linkedin|twitter|x\.com|youtube|pinterest|reddit/.test(ref)) return 'Social Media';
    if (utmS || utmM) return 'Campaign';
    if (ref && !/localhost|127\.0\.0\.1|0\.0\.0\.0|vsinfra/.test(ref) && ref !== 'direct') return 'Referral';
    return 'Direct';
  },

  detectPageContext() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('single-girder')) {
      this.lastProduct = { id: 'single-girder-eot', name: 'Single Girder EOT Crane' };
    } else if (path.includes('double-girder')) {
      this.lastProduct = { id: 'double-girder-eot', name: 'Double Girder EOT Crane' };
    } else if (path.includes('semi-gantry')) {
      this.lastProduct = { id: 'semi-gantry-crane', name: 'Semi-Gantry Crane' };
    } else if (path.includes('goliath')) {
      this.lastProduct = { id: 'goliath-crane', name: 'Goliath Crane' };
    } else if (path.includes('gantry')) {
      this.lastProduct = { id: 'gantry-crane', name: 'Gantry Crane' };
    } else if (path.includes('jib')) {
      this.lastProduct = { id: 'jib-crane', name: 'Jib Crane' };
    } else if (path.includes('chain-hoist')) {
      this.lastProduct = { id: 'chain-hoist', name: 'Electric Chain Hoist' };
    } else if (path.includes('hoist')) {
      this.lastProduct = { id: 'electric-hoist', name: 'Electric Wire Rope Hoist' };
    } else if (path.includes('component')) {
      this.lastProduct = { id: 'crane-components', name: 'Crane Kits & Components' };
    }

    if (path.includes('amc') || path.includes('maintenance')) {
      this.lastService = { id: 'crane-amc', name: 'Crane Maintenance & AMC' };
    } else if (path.includes('modern')) {
      this.lastService = { id: 'crane-modernization', name: 'Modernization & Retrofitting' };
    } else if (path.includes('fab')) {
      this.lastService = { id: 'crane-fabrication', name: 'Custom Crane Fabrication' };
    } else if (path.includes('load') || path.includes('inspect')) {
      this.lastService = { id: 'load-testing', name: 'Inspection & Load Testing' };
    }
  },

  trackEvent(eventType, data = {}) {
    try {
      const apiBase = typeof getVsApiBase === 'function' ? getVsApiBase() : '';
      const payload = {
        event_type: eventType,
        session_id: this.sessionId,
        path: window.location.pathname || '/index.html',
        landing_page: this.landingPage,
        referrer: this.initialReferrer,
        lead_source: this.leadSource,
        utm_source: this.utmParams.utm_source || '',
        utm_medium: this.utmParams.utm_medium || '',
        utm_campaign: this.utmParams.utm_campaign || '',
        utm_term: this.utmParams.utm_term || '',
        utm_content: this.utmParams.utm_content || '',
        product_id: data.productId || this.lastProduct?.id || '',
        product_name: data.productName || this.lastProduct?.name || '',
        service_id: data.serviceId || this.lastService?.id || '',
        service_name: data.serviceName || this.lastService?.name || '',
        country: '',
        city: '',
        timezone: Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : '',
        source: this._isDev ? 'dev_local' : (this.leadSource || '')
      };

      const url = `${apiBase}/api/analytics/event`;
      const bodyStr = JSON.stringify(payload);

      if (navigator.sendBeacon) {
        const blob = new Blob([bodyStr], { type: 'application/json' });
        const ok = navigator.sendBeacon(url, blob);
        if (ok) return;
      }

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        keepalive: true
      }).catch(() => {});
    } catch (e) {}
  },

  bindListeners() {
    // 1. 360° / 3D Viewer Opens, Brochure Downloads & CTA Clicks
    document.addEventListener('click', (e) => {
      const target = e.target.closest('button, a, [data-action], [data-viewer]');
      if (!target) return;

      const text = (target.textContent || '').toLowerCase();
      const href = (target.getAttribute('href') || '').toLowerCase();
      const action = (target.getAttribute('data-action') || '').toLowerCase();

      if (action.includes('360') || action.includes('3d') || text.includes('360') || text.includes('3d viewer') || target.hasAttribute('data-viewer')) {
        const prodName = target.getAttribute('data-product') || this.lastProduct?.name || 'Interactive Crane Viewer';
        VSAnalytics.trackEvent('viewer_open', { productName: prodName });
      } else if (href.endsWith('.pdf') || text.includes('brochure') || text.includes('catalog') || target.hasAttribute('data-download')) {
        const prodName = target.getAttribute('data-product') || this.lastProduct?.name || 'Brochure';
        VSAnalytics.trackEvent('brochure_click', { productName: prodName });
      } else if (href.includes('request-quote') || text.includes('get quote') || text.includes('request quote') || text.includes('quote') || target.hasAttribute('data-quote')) {
        const prodName = target.getAttribute('data-product') || this.lastProduct?.name || '';
        VSAnalytics.trackEvent('quote_click', { productName: prodName });
      } else if (href.startsWith('tel:') || href.includes('whatsapp') || href.includes('wa.me')) {
        VSAnalytics.trackEvent('contact_click', { productName: this.lastProduct?.name || '' });
      }
    }, { passive: true });

    // 2. Inquiry Form Focus / Start
    document.addEventListener('focusin', (e) => {
      if (this.hasStartedInquiry) return;
      const input = e.target;
      if (input.matches && input.matches('input, textarea, select')) {
        const form = input.closest('form');
        if (form && (form.id.includes('quote') || form.id.includes('contact') || form.action.includes('inquiries') || form.querySelector('button[type="submit"]'))) {
          this.hasStartedInquiry = true;
          this.trackEvent('inquiry_start', { productName: this.lastProduct?.name || '' });
        }
      }
    }, { passive: true });
  },

  getAttribution() {
    return {
      session_id: this.sessionId,
      lead_source: this.leadSource,
      referrer: this.initialReferrer,
      landing_page: this.landingPage,
      utm_source: this.utmParams.utm_source || '',
      utm_medium: this.utmParams.utm_medium || '',
      utm_campaign: this.utmParams.utm_campaign || '',
      product_context: this.lastProduct?.name || '',
      service_context: this.lastService?.name || '',
      approx_geo: '',
      device: this.getDevice(),
      browser: this.getBrowser(),
      os: this.getOs()
    };
  },

  getLeadPayload() {
    return this.getAttribution();
  },

  getDevice() {
    const ua = navigator.userAgent.toLowerCase();
    if (/tablet|ipad/.test(ua)) return 'Tablet';
    if (/mobile|android|iphone/.test(ua)) return 'Mobile';
    return 'Desktop';
  },

  getBrowser() {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('edg')) return 'Edge';
    if (ua.includes('chrome') && !ua.includes('chromium')) return 'Chrome';
    if (ua.includes('safari') && !ua.includes('chrome')) return 'Safari';
    if (ua.includes('firefox')) return 'Firefox';
    return 'Other';
  },

  getOs() {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) return 'Windows';
    if (ua.includes('android')) return 'Android';
    if (/iphone|ipad|ios/.test(ua)) return 'iOS';
    if (ua.includes('mac')) return 'macOS';
    if (ua.includes('linux')) return 'Linux';
    return 'Other';
  }
};
window.VSAnalytics = VSAnalytics;

// ---- Theme Management ----
const ThemeManager = {
  init() {
    const saved = localStorage.getItem('vs-theme');
    // Fresh visits / when no preference is saved must ALWAYS open in LIGHT / WHITE theme.
    // Never auto-switch to dark mode based on OS prefers-color-scheme.
    const theme = (saved === 'dark') ? 'dark' : 'light';
    this.set(theme);
  },

  set(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    this.updateToggleIcon(theme);
  },

  toggle() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('vs-theme', next);
    this.set(next);
  },

  updateToggleIcon(theme) {
    const toggles = document.querySelectorAll('.theme-toggle');
    toggles.forEach(btn => {
      btn.innerHTML = theme === 'dark'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    });
  }
};

// ---- Navigation ----
const Navigation = {
  init() {
    this.header = document.querySelector('.header');
    this.mobileToggle = document.querySelector('.mobile-toggle');
    this.mobileNav = document.querySelector('.mobile-nav');
    this.overlay = document.querySelector('.mobile-nav-overlay');
    this.lastScroll = 0;

    if (this.mobileToggle) {
      this.mobileToggle.addEventListener('click', () => this.toggleMobile());
    }

    if (this.overlay) {
      this.overlay.addEventListener('click', () => this.closeMobile());
    }

    // Close mobile nav on link click
    document.querySelectorAll('.mobile-nav-link').forEach(link => {
      link.addEventListener('click', () => this.closeMobile());
    });

    window.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.onScroll();

    // Active nav highlighting
    this.highlightCurrentPage();
  },

  onScroll() {
    const scrollY = window.scrollY;

    // Sticky header background
    if (this.header) {
      if (scrollY > 50) {
        this.header.classList.add('header-scrolled');
      } else {
        this.header.classList.remove('header-scrolled');
      }
    }

    // Scroll to top button visibility
    const scrollTopBtn = document.querySelector('.floating-top');
    if (scrollTopBtn) {
      if (scrollY > 500) {
        scrollTopBtn.classList.add('visible');
      } else {
        scrollTopBtn.classList.remove('visible');
      }
    }

    this.lastScroll = scrollY;
  },

  toggleMobile() {
    const isOpen = this.mobileNav?.classList.contains('open');
    if (isOpen) {
      this.closeMobile();
    } else {
      this.openMobile();
    }
  },

  openMobile() {
    this.mobileNav?.classList.add('open');
    this.overlay?.classList.add('open');
    this.mobileToggle?.classList.add('active');
    document.body.style.overflow = 'hidden';
  },

  closeMobile() {
    this.mobileNav?.classList.remove('open');
    this.overlay?.classList.remove('open');
    this.mobileToggle?.classList.remove('active');
    document.body.style.overflow = '';
  },

  highlightCurrentPage() {
    const path = window.location.pathname;
    const filename = path.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(link => {
      const href = link.getAttribute('href');
      if (href === filename || (filename === 'index.html' && (href === '/' || href === 'index.html'))) {
        link.classList.add('active');
      }
    });
  }
};

// ---- Scroll Reveal ----
const ScrollReveal = {
  init() {
    this.elements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale, .stagger-children');

    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            this.observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

      this.elements.forEach(el => this.observer.observe(el));
    } else {
      // Fallback: show everything
      this.elements.forEach(el => el.classList.add('revealed'));
    }
  }
};

// ---- Animated Counter ----
const CounterAnimation = {
  init() {
    const counters = document.querySelectorAll('[data-counter]');
    if (!counters.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this.animate(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    counters.forEach(el => observer.observe(el));
  },

  animate(el) {
    const target = parseInt(el.getAttribute('data-counter'));
    const suffix = el.getAttribute('data-suffix') || '';
    const prefix = el.getAttribute('data-prefix') || '';
    const duration = 2000;
    const start = performance.now();

    const update = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = Math.round(target * eased);
      el.textContent = prefix + current.toLocaleString() + suffix;

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    };

    requestAnimationFrame(update);
  }
};

// ---- Accordion ----
const Accordion = {
  init() {
    document.querySelectorAll('.accordion-trigger').forEach(trigger => {
      trigger.addEventListener('click', () => {
        const item = trigger.closest('.accordion-item');
        const content = item.querySelector('.accordion-content');
        const isOpen = item.classList.contains('open');

        // Close others in same group
        const group = item.closest('.accordion-group');
        if (group) {
          group.querySelectorAll('.accordion-item.open').forEach(openItem => {
            if (openItem !== item) {
              openItem.classList.remove('open');
              openItem.querySelector('.accordion-content').style.maxHeight = '0';
            }
          });
        }

        if (isOpen) {
          item.classList.remove('open');
          content.style.maxHeight = '0';
        } else {
          item.classList.add('open');
          content.style.maxHeight = content.scrollHeight + 'px';
        }
      });
    });
  }
};

// ---- Tabs ----
const Tabs = {
  init() {
    document.querySelectorAll('[data-tabs]').forEach(tabGroup => {
      const buttons = tabGroup.querySelectorAll('.tab-btn');
      const panels = tabGroup.querySelectorAll('.tab-panel');

      buttons.forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-tab');

          buttons.forEach(b => b.classList.remove('active'));
          panels.forEach(p => p.classList.remove('active'));

          btn.classList.add('active');
          tabGroup.querySelector(`#${target}`)?.classList.add('active');
        });
      });
    });
  }
};

// ---- Smooth Scroll ----
const SmoothScroll = {
  init() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', (e) => {
        const targetId = link.getAttribute('href');
        if (targetId === '#') return;

        const target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          const headerHeight = document.querySelector('.header')?.offsetHeight || 80;
          const targetPos = target.offsetTop - headerHeight;
          window.scrollTo({ top: targetPos, behavior: 'smooth' });
        }
      });
    });
  }
};

// ---- Preloader ----
const Preloader = {
  init() {
    const preloader = document.querySelector('.preloader');
    if (!preloader) return;

    window.addEventListener('load', () => {
      setTimeout(() => {
        preloader.classList.add('loaded');
        setTimeout(() => preloader.remove(), 600);
      }, 800);
    });
  }
};

// ---- Scroll to Top ----
const ScrollToTop = {
  init() {
    const btn = document.querySelector('.floating-top');
    if (!btn) return;

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
};

// ---- Form Validation & Database Submission ----
const FormHandler = {
  init() {
    document.querySelectorAll('form[data-validate]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (this.validate(form)) {
          await this.handleSubmit(form);
        }
      });
    });
  },

  validate(form) {
    let valid = true;
    form.querySelectorAll('[required]').forEach(field => {
      const group = field.closest('.form-group');
      const error = group?.querySelector('.form-error');

      if (!field.value.trim()) {
        field.style.borderColor = 'var(--color-error)';
        if (error) {
          error.style.display = 'block';
        }
        valid = false;
      } else if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value)) {
        field.style.borderColor = 'var(--color-error)';
        if (error) {
          error.textContent = 'Please enter a valid email address';
          error.style.display = 'block';
        }
        valid = false;
      } else {
        field.style.borderColor = '';
        if (error) error.style.display = 'none';
      }
    });
    return valid;
  },

  async handleSubmit(form) {
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : 'Submit';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Sending Message...</span>';
    }

    const formData = new FormData(form);
    const attr = window.VSAnalytics ? (window.VSAnalytics.getLeadPayload ? window.VSAnalytics.getLeadPayload() : window.VSAnalytics.getAttribution()) : {};
    const payload = Object.assign({
      name: formData.get('name') || '',
      email: formData.get('email') || '',
      phone: formData.get('phone') || '',
      company: formData.get('company') || '',
      subject: formData.get('subject') || 'General Inquiry',
      message: formData.get('message') || '',
      source_page: document.title || window.location.pathname,
      created_at: new Date().toISOString()
    }, attr);

    let saved = false;

    // 1. Submit to Backend API / MongoDB
    try {
      const apiBase = typeof getVsApiBase === 'function' ? getVsApiBase() : '';
      const res = await fetch(`${apiBase}/api/inquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        saved = true;
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save submission');
      }
    } catch (err) {
      console.warn('API submission notice:', err);
      if (window.showToast) {
        window.showToast(err.message || 'Unable to submit inquiry at this moment. Please try again or call us directly.', 'error');
      }
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }

    if (saved) {
      if (window.VSAnalytics && typeof window.VSAnalytics.trackEvent === 'function') {
        window.VSAnalytics.trackEvent('inquiry_submitted', {
          productName: payload.equipment_type || payload.subject || '',
          productId: payload.equipment_type || ''
        });
      }
      const successMsg = form.parentElement.querySelector('.form-success-message');
      if (successMsg) {
        form.style.display = 'none';
        successMsg.style.display = 'flex';
      } else {
        window.location.href = 'thank-you.html';
      }
    } else {
      alert('We encountered an error saving your message. Please call us directly at +91 99901 91859.');
    }
  }
};

// ---- Lightbox ----
const Lightbox = {
  init() {
    document.querySelectorAll('[data-lightbox]').forEach(trigger => {
      trigger.addEventListener('click', () => {
        const src = trigger.getAttribute('data-lightbox') || trigger.querySelector('img')?.src;
        const alt = trigger.querySelector('img')?.alt || '';
        if (src) this.open(src, alt);
      });
    });
  },

  open(src, alt) {
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = `
      <div class="lightbox-content">
        <button class="lightbox-close" aria-label="Close lightbox">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
        <img src="${src}" alt="${alt}" class="lightbox-image"/>
        ${alt ? `<p class="lightbox-caption">${alt}</p>` : ''}
      </div>
    `;

    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.9);
      z-index: 9999; display: flex; align-items: center; justify-content: center;
      padding: 2rem; cursor: pointer; animation: fadeIn 0.3s ease;
    `;

    const content = overlay.querySelector('.lightbox-content');
    content.style.cssText = 'position: relative; max-width: 90vw; max-height: 90vh; cursor: default;';

    const img = overlay.querySelector('.lightbox-image');
    img.style.cssText = 'max-width: 100%; max-height: 85vh; object-fit: contain; border-radius: 8px;';

    const closeBtn = overlay.querySelector('.lightbox-close');
    closeBtn.style.cssText = `
      position: absolute; top: -40px; right: 0; width: 36px; height: 36px;
      border-radius: 50%; background: rgba(255,255,255,0.1); color: white;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      border: none; transition: background 0.2s;
    `;

    const caption = overlay.querySelector('.lightbox-caption');
    if (caption) {
      caption.style.cssText = 'text-align: center; color: rgba(255,255,255,0.7); margin-top: 1rem; font-size: 0.875rem;';
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close(overlay);
    });
    closeBtn.addEventListener('click', () => this.close(overlay));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close(overlay);
    }, { once: true });

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
  },

  close(overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.remove();
      document.body.style.overflow = '';
    }, 300);
  }
};

// ---- Verified Product Brochure Visibility ----
// ---- Verified Product Brochure, Catalog & Media Visibility ----
const ProductBrochureManager = {
  async init() {
    const brochureBtns = document.querySelectorAll('#btn-brochure, .btn-brochure, [data-brochure-btn]');
    const catalogBtns = document.querySelectorAll('#btn-catalog, .btn-catalog, [data-catalog-btn]');
    const videoBtns = document.querySelectorAll('#btn-video, .btn-video, [data-video-btn]');

    // 1. Ensure "View Catalog" buttons are always active and point to the real catalog page
    const isProductsDir = window.location.pathname.includes('/products/');
    const catalogHref = isProductsDir ? '../catalog.html' : 'catalog.html';
    catalogBtns.forEach(btn => {
      if (!btn.getAttribute('href') || btn.getAttribute('href') === '#' || btn.getAttribute('href') === '') {
        btn.href = catalogHref;
      }
      btn.style.display = 'inline-flex';
    });

    // 2. Default brochure & video buttons to hidden until verified real assets exist
    brochureBtns.forEach(btn => btn.style.display = 'none');
    videoBtns.forEach(btn => btn.style.display = 'none');

    // 3. Product Gallery thumbnail click to preview
    document.querySelectorAll('.product-thumbs .product-thumb').forEach((thumb, idx) => {
      thumb.addEventListener('click', () => {
        if (thumb.getAttribute('onclick') && thumb.getAttribute('onclick').includes('showDgView')) {
          return;
        }
        if (window.currentProductViewer && typeof window.currentProductViewer.showFrame === 'function') {
          window.currentProductViewer.showFrame(idx);
        } else {
          const img = thumb.querySelector('img');
          if (img) {
            const mainImg = document.querySelector('.product-main-img img#product-main-image') || document.querySelector('.product-main-img img:not(.logo)');
            if (mainImg) {
              mainImg.src = img.src;
              mainImg.alt = img.alt || 'Product View';
            }
          }
        }
        document.querySelectorAll('.product-thumbs .product-thumb').forEach(t => t.classList.remove('active'));
        thumb.classList.add('active');
      });
    });

    try {
      const apiBase = typeof getVsApiBase === 'function' ? getVsApiBase() : '';
      const pathParts = window.location.pathname.split('/');
      const filename = pathParts[pathParts.length - 1] || '';
      const slug = filename.replace('.html', '');

      let verifiedBrochureUrl = null;
      let verifiedVideoUrl = null;

      // Query CMS for product content if available
      try {
        const res = await fetch(`${apiBase}/api/content/products`);
        if (res.ok) {
          const json = await res.json();
          const items = json.data || [];
          const match = items.find(p => {
            if (p.link && p.link.includes(filename)) return true;
            if (p.id && (p.id.includes(slug.replace(/-/g, '_')) || slug.includes(p.id.replace('prod_', '').replace(/_/g, '-')))) return true;
            return false;
          });
          if (match) {
            // Check brochure in CMS
            if (match.brochure && typeof match.brochure === 'string' && match.brochure.trim()) {
              let cand = match.brochure.trim();
              if (!cand.startsWith('http://') && !cand.startsWith('https://') && !cand.startsWith('/')) {
                cand = (isProductsDir ? '../' : '') + cand;
              }
              try {
                const headRes = await fetch(cand, { method: 'HEAD' });
                if (headRes.ok) {
                  verifiedBrochureUrl = cand;
                }
              } catch (_) {
                if (cand.startsWith('http')) verifiedBrochureUrl = cand;
              }
            }

            // Check video in CMS
            const videoCand = match.video_url || match.video;
            if (videoCand && typeof videoCand === 'string' && videoCand.trim()) {
              let candV = videoCand.trim();
              if (!candV.startsWith('http://') && !candV.startsWith('https://') && !candV.startsWith('/')) {
                candV = (isProductsDir ? '../' : '') + candV;
              }
              try {
                const headRes = await fetch(candV, { method: 'HEAD' });
                if (headRes.ok) {
                  verifiedVideoUrl = candV;
                }
              } catch (_) {
                if (candV.startsWith('http')) verifiedVideoUrl = candV;
              }
            }
          }
        }
      } catch (_) {}

      // If CMS has no video, check static video candidates
      // Note: 3 separate videos supported: chain-hoist, electric-wire-rope-hoist, gantry-crane. No video for goliath, jib, etc.
      const allowedVideoSlugs = ['chain-hoist', 'electric-wire-rope-hoist', 'gantry-crane'];
      if (!verifiedVideoUrl && slug && allowedVideoSlugs.includes(slug)) {
        const videoCandidates = [
          isProductsDir ? `../assets/videos/${slug}.mp4` : `assets/videos/${slug}.mp4`,
          isProductsDir ? `../assets/videos/${slug}-video.mp4` : `assets/videos/${slug}-video.mp4`,
          isProductsDir ? `../assets/videos/${slug}.webm` : `assets/videos/${slug}.webm`
        ];

        for (const cand of videoCandidates) {
          try {
            const headRes = await fetch(cand, { method: 'HEAD' });
            if (headRes.ok) {
              verifiedVideoUrl = cand;
              break;
            }
          } catch (_) {}
        }
        if (!verifiedVideoUrl) {
          verifiedVideoUrl = isProductsDir ? `../assets/videos/${slug}.mp4` : `assets/videos/${slug}.mp4`;
        }
      }

      if (!allowedVideoSlugs.includes(slug)) {
        verifiedVideoUrl = null;
      }

      // If CMS has no brochure, check static file fallback path
      if (!verifiedBrochureUrl && slug) {
        const staticCandidate = isProductsDir
          ? `../assets/docs/${slug}-brochure.pdf`
          : `assets/docs/${slug}-brochure.pdf`;
        try {
          const headRes = await fetch(staticCandidate, { method: 'HEAD' });
          if (headRes.ok) {
            const ct = (headRes.headers.get('content-type') || '').toLowerCase();
            const cl = parseInt(headRes.headers.get('content-length') || '0', 10);
            if (ct.includes('pdf') || cl > 1000) {
              verifiedBrochureUrl = staticCandidate;
            }
          }
        } catch (_) {}
      }

      // If brochure verified, display button; otherwise keep hidden
      brochureBtns.forEach(btn => {
        if (verifiedBrochureUrl) {
          btn.href = verifiedBrochureUrl;
          btn.setAttribute('target', '_blank');
          btn.setAttribute('rel', 'noopener noreferrer');
          btn.setAttribute('download', '');
          btn.style.display = 'inline-flex';
        } else {
          btn.style.display = 'none';
        }
      });

      // If video verified, display button & video container; otherwise keep hidden
      const videoContainer = document.getElementById('product-video-container');
      const videoPlayer = document.getElementById('product-video-player');

      videoBtns.forEach(btn => {
        if (verifiedVideoUrl) {
          btn.href = '#product-video-container';
          btn.style.display = 'inline-flex';
          btn.onclick = (e) => {
            e.preventDefault();
            if (videoContainer) {
              videoContainer.style.display = 'block';
              videoContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            if (videoPlayer) {
              videoPlayer.play().catch(() => {});
            }
          };
        } else {
          btn.style.display = 'none';
        }
      });

      if (videoContainer && videoPlayer) {
        if (verifiedVideoUrl) {
          videoContainer.style.display = 'block';
          if (!videoPlayer.src || !videoPlayer.src.includes(verifiedVideoUrl)) {
            videoPlayer.src = verifiedVideoUrl;
          }
        } else {
          videoContainer.style.display = 'none';
        }
      }
    } catch (_) {
      brochureBtns.forEach(btn => btn.style.display = 'none');
      videoBtns.forEach(btn => btn.style.display = 'none');
    }
  }
};

// ---- Initialize Everything ----
document.addEventListener('DOMContentLoaded', () => {
  VSAnalytics.init();
  ThemeManager.init();
  Navigation.init();
  Preloader.init();
  ScrollReveal.init();
  CounterAnimation.init();
  Accordion.init();
  Tabs.init();
  SmoothScroll.init();
  ScrollToTop.init();
  FormHandler.init();
  Lightbox.init();
  ProductBrochureManager.init();
});
