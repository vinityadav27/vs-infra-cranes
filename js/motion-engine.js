/* ============================================
   VS INFRA & CRANES — Premium Motion Engine
   GSAP ScrollTrigger + Advanced Animations
   
   This file transforms the entire site from
   "basic reveals" into an Awwwards-tier
   premium scroll experience.
   
   REQUIRES: GSAP 3.12+ and ScrollTrigger plugin
   loaded BEFORE this script.
   ============================================ */

(function () {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) return; // Graceful no-op for accessibility

  // Wait for GSAP
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
    console.warn('[MotionEngine] GSAP or ScrollTrigger not loaded. Skipping premium animations.');
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  // =========================================
  // 1. PARALLAX DEPTH LAYERS
  //    Creates real depth by moving bg elements
  //    at different speeds on scroll.
  // =========================================
  function initParallaxLayers() {
    // Hero section: multi-speed parallax
    const heroEl = document.querySelector('.hero, .page-hero');
    if (heroEl) {
      // Background moves slower (depth illusion)
      const heroBg = heroEl.querySelector('.hero-bg, .page-hero-bg');
      if (heroBg) {
        gsap.to(heroBg, {
          y: '20%',
          ease: 'none',
          scrollTrigger: {
            trigger: heroEl,
            start: 'top top',
            end: 'bottom top',
            scrub: 0.5,
          }
        });
      }
      // Pattern layer moves at different speed
      const pattern = heroEl.querySelector('.hero-pattern, .page-hero-pattern');
      if (pattern) {
        gsap.to(pattern, {
          y: '30%',
          ease: 'none',
          scrollTrigger: {
            trigger: heroEl,
            start: 'top top',
            end: 'bottom top',
            scrub: 0.3,
          }
        });
      }
      // Grid lines even slower
      const grid = heroEl.querySelector('.hero-grid-lines');
      if (grid) {
        gsap.to(grid, {
          y: '15%',
          ease: 'none',
          scrollTrigger: {
            trigger: heroEl,
            start: 'top top',
            end: 'bottom top',
            scrub: 0.8,
          }
        });
      }
      // Hero content fades + rises on scroll-out
      const heroContent = heroEl.querySelector('.hero-content, .page-hero-content');
      if (heroContent) {
        gsap.to(heroContent, {
          y: -60,
          opacity: 0.3,
          ease: 'none',
          scrollTrigger: {
            trigger: heroEl,
            start: 'top top',
            end: 'bottom top',
            scrub: 0.3,
          }
        });
      }
    }

    // Generic parallax elements: add data-parallax-speed="0.1" to any element
    document.querySelectorAll('[data-parallax-speed]').forEach(el => {
      const speed = parseFloat(el.dataset.parallaxSpeed) || 0.1;
      gsap.to(el, {
        y: () => speed * 200,
        ease: 'none',
        scrollTrigger: {
          trigger: el.closest('section') || el,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.5,
        }
      });
    });
  }

  // =========================================
  // 2. PREMIUM SECTION REVEALS
  //    Replace basic CSS reveals with GSAP
  //    for butter-smooth, staggered entrances.
  // =========================================
  function initSectionReveals() {
    // Upgrade section labels with clip/slide reveal
    document.querySelectorAll('.section-label').forEach(label => {
      gsap.from(label, {
        x: -30,
        opacity: 0,
        duration: 0.6,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: label,
          start: 'top 88%',
          toggleActions: 'play none none none',
        }
      });
    });

    // Upgrade section titles with split-word reveal
    document.querySelectorAll('.section-title').forEach(title => {
      // Split into words
      const text = title.textContent;
      const words = text.split(' ');
      title.innerHTML = words.map(w => `<span style="display:inline-block;overflow:hidden;"><span class="word-inner" style="display:inline-block;">${w}</span></span>`).join(' ');

      gsap.from(title.querySelectorAll('.word-inner'), {
        y: '110%',
        rotateX: -15,
        opacity: 0,
        duration: 0.8,
        stagger: 0.05,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: title,
          start: 'top 85%',
          toggleActions: 'play none none none',
        }
      });
    });

    // Section subtitles: smooth fade up
    document.querySelectorAll('.section-subtitle').forEach(sub => {
      gsap.from(sub, {
        y: 30,
        opacity: 0,
        duration: 0.8,
        delay: 0.3,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: sub,
          start: 'top 88%',
          toggleActions: 'play none none none',
        }
      });
    });
  }

  // =========================================
  // 3. CARD DEPTH EFFECTS
  //    Cards gain real 3D depth: subtle tilt
  //    on hover, elevation change, border glow.
  // =========================================
  function initCardDepth() {
    const cards = document.querySelectorAll('.card, .stat-card, .why-card, .testimonial-card, .value-card, .mv-card, .contact-card, .cert-badge, .industry-item');

    cards.forEach(card => {
      // Staggered scroll-in with scale + opacity
      gsap.from(card, {
        y: 60,
        opacity: 0,
        scale: 0.95,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: card,
          start: 'top 90%',
          toggleActions: 'play none none none',
        }
      });

      // 3D tilt on mouse move (desktop only)
      if (window.innerWidth > 768) {
        card.addEventListener('mousemove', (e) => {
          const rect = card.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          const rotateX = (y - centerY) / centerY * -4; // max 4 degrees
          const rotateY = (x - centerX) / centerX * 4;

          gsap.to(card, {
            rotateX: rotateX,
            rotateY: rotateY,
            transformPerspective: 800,
            duration: 0.4,
            ease: 'power2.out',
          });
        });

        card.addEventListener('mouseleave', () => {
          gsap.to(card, {
            rotateX: 0,
            rotateY: 0,
            duration: 0.6,
            ease: 'elastic.out(1, 0.5)',
          });
        });
      }
    });
  }

  // =========================================
  // 4. MAGNETIC BUTTONS
  //    Buttons that subtly follow cursor,
  //    giving a magnetic/attracted feel.
  // =========================================
  function initMagneticButtons() {
    if (window.innerWidth <= 768) return; // Mobile: skip

    const buttons = document.querySelectorAll('.btn-primary, .btn-outline, .btn-secondary');

    buttons.forEach(btn => {
      const strength = 0.3; // Pull strength (0-1)

      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;

        gsap.to(btn, {
          x: x * strength,
          y: y * strength,
          duration: 0.4,
          ease: 'power2.out',
        });
      });

      btn.addEventListener('mouseleave', () => {
        gsap.to(btn, {
          x: 0,
          y: 0,
          duration: 0.7,
          ease: 'elastic.out(1, 0.4)',
        });
      });
    });
  }

  // =========================================
  // 5. ANIMATED STAT COUNTERS (GSAP version)
  //    Replaces the basic JS counter with
  //    smooth GSAP-powered count-up.
  // =========================================
  function initGSAPCounters() {
    document.querySelectorAll('[data-counter]').forEach(el => {
      const target = parseInt(el.getAttribute('data-counter'));
      const suffix = el.getAttribute('data-suffix') || '';
      const prefix = el.getAttribute('data-prefix') || '';
      if (isNaN(target)) return;

      const obj = { val: 0 };

      ScrollTrigger.create({
        trigger: el,
        start: 'top 85%',
        once: true,
        onEnter: () => {
          gsap.to(obj, {
            val: target,
            duration: 2,
            ease: 'power2.out',
            onUpdate: () => {
              el.textContent = prefix + Math.round(obj.val).toLocaleString() + suffix;
            }
          });
        }
      });
    });
  }

  // =========================================
  // 6. PINNED MANUFACTURING TIMELINE
  //    The process section pins in viewport
  //    while steps animate one at a time.
  // =========================================
  function initPinnedTimeline() {
    const timeline = document.getElementById('process-timeline');
    if (!timeline) return;

    const steps = timeline.querySelectorAll('.process-step');
    const fill = document.getElementById('process-line-fill');
    if (!steps.length) return;

    // Create a scroll-linked animation
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: timeline.closest('section') || timeline,
        start: 'top 60%',
        end: 'bottom 40%',
        scrub: 0.5,
      }
    });

    // Animate progress line fill
    if (fill) {
      tl.to(fill, { width: '100%', duration: 1, ease: 'none' }, 0);
    }

    // Each step activates sequentially
    steps.forEach((step, i) => {
      const num = step.querySelector('.process-num');
      const title = step.querySelector('.process-step-title');
      const desc = step.querySelector('.process-step-desc');

      tl.to(step, { className: '+=active', duration: 0.01 }, i / steps.length);
      if (num) {
        tl.from(num, { scale: 0.5, opacity: 0.3, duration: 0.3, ease: 'back.out(2)' }, i / steps.length);
      }
      if (title) {
        tl.from(title, { y: 10, opacity: 0, duration: 0.3 }, i / steps.length + 0.05);
      }
      if (desc) {
        tl.from(desc, { y: 10, opacity: 0, duration: 0.3 }, i / steps.length + 0.1);
      }
    });
  }

  // =========================================
  // 7. IMAGE / GALLERY REVEAL MASKS
  //    Images and gallery items reveal with
  //    a cinematic clip-path wipe.
  // =========================================
  function initImageReveals() {
    const images = document.querySelectorAll('.product-card-img, .service-visual, .gallery-item, .img-placeholder, .project-card-img');

    images.forEach(img => {
      gsap.fromTo(img,
        { clipPath: 'inset(0 100% 0 0)' },
        {
          clipPath: 'inset(0 0% 0 0)',
          duration: 1,
          ease: 'power3.inOut',
          scrollTrigger: {
            trigger: img,
            start: 'top 85%',
            toggleActions: 'play none none none',
          }
        }
      );
    });
  }

  // =========================================
  // 8. SMOOTH HEADER MORPH
  //    Header background transitions smoothly
  //    with GSAP instead of CSS class toggle.
  // =========================================
  function initHeaderMorph() {
    const header = document.querySelector('.header');
    if (!header) return;

    ScrollTrigger.create({
      start: 50,
      onUpdate: (self) => {
        if (self.direction === 1 && window.scrollY > 50) {
          header.classList.add('header-scrolled');
        } else if (window.scrollY <= 50) {
          header.classList.remove('header-scrolled');
        }
      }
    });
  }

  // =========================================
  // 9. CTA BANNER GLOW PULSE
  //    The final CTA section glow orb pulses
  //    gently when in view.
  // =========================================
  function initCTAGlow() {
    const banner = document.querySelector('.cta-banner');
    if (!banner) return;
    const glow = banner.querySelector('::before') || banner;

    gsap.to(banner, {
      '--glow-scale': 1.3,
      duration: 3,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
      scrollTrigger: {
        trigger: banner,
        start: 'top 80%',
        toggleActions: 'play pause play pause',
      }
    });
  }

  // =========================================
  // 10. CUSTOM CURSOR (Desktop Only)
  //     Dot + ring cursor that scales on
  //     interactive elements.
  // =========================================
  function initCustomCursor() {
    if (window.innerWidth <= 1024) return;
    if ('ontouchstart' in window) return;

    // Create cursor elements
    const dot = document.createElement('div');
    const ring = document.createElement('div');
    dot.className = 'cursor-dot';
    ring.className = 'cursor-ring';

    const cursorStyle = document.createElement('style');
    cursorStyle.textContent = `
      .cursor-dot {
        position: fixed;
        top: 0; left: 0;
        width: 8px; height: 8px;
        background: #E8630A;
        border-radius: 50%;
        pointer-events: none;
        z-index: 99999;
        mix-blend-mode: difference;
        transform: translate(-50%, -50%);
        transition: width 0.2s, height 0.2s, opacity 0.2s;
      }
      .cursor-ring {
        position: fixed;
        top: 0; left: 0;
        width: 36px; height: 36px;
        border: 1.5px solid rgba(232, 99, 10, 0.4);
        border-radius: 50%;
        pointer-events: none;
        z-index: 99998;
        transform: translate(-50%, -50%);
        transition: width 0.3s, height 0.3s, border-color 0.3s;
      }
      .cursor-dot.hover {
        width: 40px; height: 40px;
        background: rgba(232, 99, 10, 0.15);
        mix-blend-mode: normal;
      }
      .cursor-ring.hover {
        width: 50px; height: 50px;
        border-color: #E8630A;
      }
      body { cursor: none !important; }
      a, button, [role="button"], input, textarea, select, .card, .accordion-trigger, .nav-link, .mobile-toggle, .tab-btn, .gallery-item {
        cursor: none !important;
      }
    `;
    document.head.appendChild(cursorStyle);
    document.body.appendChild(dot);
    document.body.appendChild(ring);

    let mouseX = 0, mouseY = 0;

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      // Dot follows immediately
      gsap.set(dot, { x: mouseX, y: mouseY });
      // Ring follows with slight lag
      gsap.to(ring, { x: mouseX, y: mouseY, duration: 0.15, ease: 'power2.out' });
    });

    // Scale up on interactive elements
    const interactives = 'a, button, [role="button"], input, textarea, select, .card, .accordion-trigger, .nav-link, .gallery-item';
    document.querySelectorAll(interactives).forEach(el => {
      el.addEventListener('mouseenter', () => {
        dot.classList.add('hover');
        ring.classList.add('hover');
      });
      el.addEventListener('mouseleave', () => {
        dot.classList.remove('hover');
        ring.classList.remove('hover');
      });
    });

    // Hide when leaving window
    document.addEventListener('mouseleave', () => {
      gsap.to([dot, ring], { opacity: 0, duration: 0.2 });
    });
    document.addEventListener('mouseenter', () => {
      gsap.to([dot, ring], { opacity: 1, duration: 0.2 });
    });
  }

  // =========================================
  // 11. SMOOTH SCROLL SPEED ADJUSTMENT
  //     Lenis-like smooth scroll feel using
  //     GSAP ScrollSmoother concept.
  // =========================================
  function initSmoothPageTransitions() {
    // Fade-in on page load
    gsap.from('main', {
      opacity: 0,
      y: 20,
      duration: 0.6,
      ease: 'power2.out',
      delay: 0.1,
    });

    // Stagger grid children on scroll
    document.querySelectorAll('.grid').forEach(grid => {
      const children = grid.children;
      if (children.length < 2) return;

      gsap.from(children, {
        y: 50,
        opacity: 0,
        scale: 0.97,
        duration: 0.6,
        stagger: 0.1,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: grid,
          start: 'top 85%',
          toggleActions: 'play none none none',
        }
      });
    });
  }

  // =========================================
  // 12. HORIZONTAL SCROLL SECTIONS
  //     Utility: pin a section and scroll
  //     its children horizontally. Apply to
  //     any element with data-horizontal-scroll.
  // =========================================
  function initHorizontalScroll() {
    document.querySelectorAll('[data-horizontal-scroll]').forEach(container => {
      const inner = container.querySelector('[data-horizontal-inner]');
      if (!inner) return;

      const totalWidth = inner.scrollWidth - container.offsetWidth;

      gsap.to(inner, {
        x: -totalWidth,
        ease: 'none',
        scrollTrigger: {
          trigger: container,
          start: 'top top',
          end: () => `+=${totalWidth}`,
          scrub: 1,
          pin: true,
          anticipatePin: 1,
        }
      });
    });
  }

  // =========================================
  // 13. TEXT HIGHLIGHT ON SCROLL
  //     Large text blocks progressively
  //     highlight words as user scrolls.
  // =========================================
  function initTextHighlight() {
    document.querySelectorAll('[data-text-highlight]').forEach(el => {
      const words = el.textContent.split(' ');
      el.innerHTML = words.map(w => `<span class="highlight-word" style="color:var(--color-text-tertiary);transition:color 0.1s;">${w}</span>`).join(' ');

      const wordEls = el.querySelectorAll('.highlight-word');
      gsap.to(wordEls, {
        color: 'var(--color-text)',
        stagger: 0.02,
        ease: 'none',
        scrollTrigger: {
          trigger: el,
          start: 'top 75%',
          end: 'bottom 50%',
          scrub: 1,
        }
      });
    });
  }

  // =========================================
  // INIT ALL
  // =========================================
  function init() {
    // Wait a tick for DOM to be fully ready
    requestAnimationFrame(() => {
      initParallaxLayers();
      initSectionReveals();
      initCardDepth();
      initMagneticButtons();
      initGSAPCounters();
      initPinnedTimeline();
      initImageReveals();
      initHeaderMorph();
      initCTAGlow();
      initCustomCursor();
      initSmoothPageTransitions();
      initHorizontalScroll();
      initTextHighlight();

      // Refresh ScrollTrigger after all setup
      ScrollTrigger.refresh();
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
