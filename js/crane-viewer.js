/* ============================================
   VS INFRA & CRANES — 3D Interactive Crane Viewer
   Built with Three.js (from CDN)
   
   FEATURES:
   - Procedurally generated EOT crane model
   - Orbit controls (rotate, zoom, pan)
   - Click-to-inspect components with labels
   - Exploded view toggle
   - Auto-rotation when idle
   - Industrial HDRI-like lighting
   - Particle dust effect
   - 60fps target
   - Graceful fallback for low-power devices
   - prefers-reduced-motion support
   
   USAGE:
   Place <div id="crane-viewer-container"></div>
   in any page, then load Three.js + OrbitControls
   + this script. The viewer auto-initializes.
   ============================================ */

(function () {
  'use strict';

  // ---- Guards ----
  if (typeof THREE === 'undefined') {
    console.warn('[CraneViewer] Three.js not loaded. Skipping.');
    return;
  }

  const container = document.getElementById('crane-viewer-container');
  if (!container) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Performance detection ----
  const isLowPower = (function () {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL).toLowerCase();
      // Detect integrated / mobile GPUs
      if (renderer.includes('swiftshader') || renderer.includes('llvmpipe') || renderer.includes('software')) return true;
    }
    return window.innerWidth < 768;
  })();

  // ---- Fallback for low power ----
  if (isLowPower) {
    container.innerHTML = `
      <div style="width:100%;height:100%;background:linear-gradient(135deg,#1A1A2E,#2d1b0e);
        border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;
        color:rgba(255,255,255,0.7);gap:12px;padding:16px 20px;text-align:center;">
        <svg width="56" height="56" viewBox="0 0 100 60" fill="none" stroke="rgba(232,99,10,0.75)" stroke-width="1.5">
          <rect x="10" y="8" width="80" height="5" rx="2"/>
          <rect x="10" y="15" width="80" height="5" rx="2"/>
          <rect x="38" y="20" width="24" height="10"/>
          <line x1="50" y1="30" x2="50" y2="44"/>
          <path d="M44 44 h12 l-2 6 h-8 z"/>
          <circle cx="50" cy="54" r="3"/>
        </svg>
        <p style="font-size:13px;max-width:280px;line-height:1.45;">Interactive 3D viewer is available on desktop devices with WebGL support.</p>
      </div>`;
    return;
  }

  // ---- Configuration ----
  const COLORS = {
    girder: 0xE8630A,       // Brand orange
    girderDark: 0xC45008,
    hoist: 0x3A3A50,
    trolley: 0x2A2A3E,
    hook: 0x888899,
    wire: 0x999999,
    endCarriage: 0x4A4A60,
    motor: 0x44AA44,
    controlPanel: 0x2266CC,
    wheel: 0x555566,
    rail: 0x333344,
    highlight: 0xFF8C42,
    floor: 0x1A1A2E,
  };

  const COMPONENT_INFO = {
    'girder-left': { name: 'Main Girder (Left)', desc: 'Primary load-bearing beam. Made from high-grade structural steel, spanning the full width of the bay.' },
    'girder-right': { name: 'Main Girder (Right)', desc: 'Secondary girder for double-girder configuration, providing additional load capacity and stability.' },
    'trolley': { name: 'Crab / Trolley', desc: 'Traverses along the girders carrying the hoist mechanism. Enables precise lateral positioning of loads.' },
    'hoist': { name: 'Electric Hoist', desc: 'The lifting mechanism housing the motor, gearbox, and drum. Provides vertical lifting via wire rope.' },
    'hook-assembly': { name: 'Hook Block', desc: 'Forged steel hook with safety latch. Load capacity rated and tested per IS:3177 standards.' },
    'wire-rope': { name: 'Wire Rope', desc: '6x36 construction wire rope with fiber core. Regular inspection intervals per IS:2266 standards.' },
    'motor-hoist': { name: 'Hoist Motor', desc: 'Squirrel cage induction motor with class F insulation. Available in single or dual speed configurations.' },
    'control-panel': { name: 'Control Panel', desc: 'NEMA-rated electrical control panel with overload protection, limit switches, and emergency stop.' },
    'end-carriage-left': { name: 'End Carriage (Left)', desc: 'Supports the girder ends and houses the travel wheels. Enables longitudinal crane travel along the runway.' },
    'end-carriage-right': { name: 'End Carriage (Right)', desc: 'Mirror-paired end carriage with independent drive or idler wheels for smooth travel.' },
    'wheel-1': { name: 'Travel Wheel', desc: 'Forged steel wheel running on runway rail. Precision machined for smooth, vibration-free travel.' },
    'wheel-2': { name: 'Travel Wheel', desc: 'Forged steel wheel running on runway rail. Precision machined for smooth, vibration-free travel.' },
    'wheel-3': { name: 'Travel Wheel', desc: 'Forged steel wheel running on runway rail. Precision machined for smooth, vibration-free travel.' },
    'wheel-4': { name: 'Travel Wheel', desc: 'Forged steel wheel running on runway rail. Precision machined for smooth, vibration-free travel.' },
  };

  // ---- State ----
  let scene, camera, renderer, controls;
  let craneParts = {};
  let isExploded = false;
  let originalPositions = {};
  let selectedPart = null;
  let autoRotate = !reducedMotion;
  let idleTimer = null;
  let particles;
  let raycaster, mouse;
  let animFrame;

  // ---- UI Elements ----
  let infoPanel, toggleExplodedBtn, resetBtn;

  // ---- Init ----
  function init() {
    // Renderer
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();
    scene.background = null; // transparent to inherit page bg
    scene.fog = new THREE.Fog(0x1A1A2E, 30, 60);

    // Camera
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(12, 8, 14);

    // Controls
    if (typeof THREE.OrbitControls !== 'undefined') {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 0.8;
      controls.minDistance = 6;
      controls.maxDistance = 30;
      controls.maxPolarAngle = Math.PI * 0.85;
      controls.target.set(0, 2, 0);

      controls.addEventListener('start', () => {
        controls.autoRotate = false;
        clearTimeout(idleTimer);
      });

      controls.addEventListener('end', () => {
        if (!reducedMotion) {
          idleTimer = setTimeout(() => { controls.autoRotate = true; }, 4000);
        }
      });
    }

    // Raycaster for clicking
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Build scene
    setupLighting();
    buildCrane();
    buildFloor();
    if (!reducedMotion) buildParticles();
    buildUI();

    // Events
    container.addEventListener('click', onMouseClick);
    container.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onResize);

    // Start render loop
    animate();
  }

  // ---- Lighting (Industrial HDRI-like) ----
  function setupLighting() {
    // Ambient: soft industrial blue
    const ambient = new THREE.AmbientLight(0x8899BB, 0.4);
    scene.add(ambient);

    // Hemisphere: sky/ground color
    const hemi = new THREE.HemisphereLight(0xB1C6E0, 0x2A2A40, 0.6);
    scene.add(hemi);

    // Main directional (sun-like)
    const dir = new THREE.DirectionalLight(0xFFEEDD, 1.2);
    dir.position.set(8, 12, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.far = 40;
    dir.shadow.camera.left = -12;
    dir.shadow.camera.right = 12;
    dir.shadow.camera.top = 12;
    dir.shadow.camera.bottom = -12;
    dir.shadow.bias = -0.001;
    scene.add(dir);

    // Fill light (warm)
    const fill = new THREE.DirectionalLight(0xFFAA66, 0.3);
    fill.position.set(-6, 4, -4);
    scene.add(fill);

    // Rim light (cool)
    const rim = new THREE.DirectionalLight(0x6688FF, 0.2);
    rim.position.set(0, 6, -10);
    scene.add(rim);

    // Orange accent point light under crane
    const accent = new THREE.PointLight(0xE8630A, 0.4, 15);
    accent.position.set(0, 0.5, 0);
    scene.add(accent);
  }

  // ---- Material Helper ----
  function makeMat(color, metalness, roughness) {
    return new THREE.MeshStandardMaterial({
      color,
      metalness: metalness || 0.6,
      roughness: roughness || 0.4,
    });
  }

  // ---- Build Crane (Procedural Geometry) ----
  function buildCrane() {
    const crane = new THREE.Group();

    // ---- Girders (2 parallel I-beams) ----
    const girderGeo = new THREE.BoxGeometry(12, 0.5, 0.6);
    const girderMat = makeMat(COLORS.girder, 0.7, 0.35);

    const girderL = new THREE.Mesh(girderGeo, girderMat);
    girderL.position.set(0, 5, -1.5);
    girderL.castShadow = true;
    girderL.name = 'girder-left';
    crane.add(girderL);
    craneParts['girder-left'] = girderL;

    const girderR = new THREE.Mesh(girderGeo, girderMat.clone());
    girderR.position.set(0, 5, 1.5);
    girderR.castShadow = true;
    girderR.name = 'girder-right';
    crane.add(girderR);
    craneParts['girder-right'] = girderR;

    // Girder web plates (side details)
    const webGeo = new THREE.BoxGeometry(12, 0.35, 0.05);
    const webMat = makeMat(COLORS.girderDark, 0.7, 0.4);
    [-1.5, 1.5].forEach(z => {
      const web = new THREE.Mesh(webGeo, webMat);
      web.position.set(0, 4.8, z);
      crane.add(web);
    });

    // Cross braces between girders
    for (let i = -5; i <= 5; i += 2.5) {
      const braceGeo = new THREE.BoxGeometry(0.1, 0.1, 3);
      const brace = new THREE.Mesh(braceGeo, makeMat(COLORS.girderDark, 0.5, 0.5));
      brace.position.set(i, 5.2, 0);
      crane.add(brace);
    }

    // ---- End Carriages ----
    const ecGeo = new THREE.BoxGeometry(0.8, 0.6, 4.5);
    const ecMat = makeMat(COLORS.endCarriage, 0.65, 0.4);

    const ecL = new THREE.Mesh(ecGeo, ecMat);
    ecL.position.set(-5.8, 5, 0);
    ecL.castShadow = true;
    ecL.name = 'end-carriage-left';
    crane.add(ecL);
    craneParts['end-carriage-left'] = ecL;

    const ecR = new THREE.Mesh(ecGeo, ecMat.clone());
    ecR.position.set(5.8, 5, 0);
    ecR.castShadow = true;
    ecR.name = 'end-carriage-right';
    crane.add(ecR);
    craneParts['end-carriage-right'] = ecR;

    // ---- Wheels (4 total) ----
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.2, 16);
    const wheelMat = makeMat(COLORS.wheel, 0.8, 0.3);
    const wheelPositions = [
      { x: -5.8, z: -2, name: 'wheel-1' },
      { x: -5.8, z: 2, name: 'wheel-2' },
      { x: 5.8, z: -2, name: 'wheel-3' },
      { x: 5.8, z: 2, name: 'wheel-4' },
    ];
    wheelPositions.forEach(wp => {
      const w = new THREE.Mesh(wheelGeo, wheelMat.clone());
      w.position.set(wp.x, 4.45, wp.z);
      w.rotation.x = Math.PI / 2;
      w.castShadow = true;
      w.name = wp.name;
      crane.add(w);
      craneParts[wp.name] = w;
    });

    // ---- Rails ----
    const railGeo = new THREE.BoxGeometry(16, 0.15, 0.3);
    const railMat = makeMat(COLORS.rail, 0.8, 0.3);
    [-2, 2].forEach(z => {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(0, 4.2, z);
      crane.add(rail);
    });

    // ---- Trolley / Crab ----
    const trolleyGroup = new THREE.Group();
    trolleyGroup.name = 'trolley';

    const trolleyBody = new THREE.BoxGeometry(1.5, 0.5, 3.5);
    const trolleyMesh = new THREE.Mesh(trolleyBody, makeMat(COLORS.trolley, 0.65, 0.4));
    trolleyMesh.position.set(0, 5.5, 0);
    trolleyMesh.castShadow = true;
    trolleyGroup.add(trolleyMesh);

    // Trolley wheels
    const twGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.15, 12);
    [{ z: -1.3 }, { z: 1.3 }].forEach(p => {
      [-0.5, 0.5].forEach(xOff => {
        const tw = new THREE.Mesh(twGeo, wheelMat.clone());
        tw.position.set(xOff, 5.2, p.z);
        tw.rotation.x = Math.PI / 2;
        trolleyGroup.add(tw);
      });
    });

    crane.add(trolleyGroup);
    craneParts['trolley'] = trolleyGroup;

    // ---- Hoist (Motor + Drum) ----
    const hoistGroup = new THREE.Group();
    hoistGroup.name = 'hoist';

    // Hoist body
    const hoistBody = new THREE.BoxGeometry(1.2, 0.8, 1.4);
    const hoistMesh = new THREE.Mesh(hoistBody, makeMat(COLORS.hoist, 0.7, 0.35));
    hoistMesh.position.set(0, 4.6, 0);
    hoistMesh.castShadow = true;
    hoistGroup.add(hoistMesh);

    // Drum
    const drumGeo = new THREE.CylinderGeometry(0.25, 0.25, 1.2, 16);
    const drum = new THREE.Mesh(drumGeo, makeMat(COLORS.wheel, 0.7, 0.3));
    drum.position.set(0, 4.25, 0);
    drum.rotation.z = Math.PI / 2;
    hoistGroup.add(drum);

    crane.add(hoistGroup);
    craneParts['hoist'] = hoistGroup;

    // ---- Motor ----
    const motorGroup = new THREE.Group();
    motorGroup.name = 'motor-hoist';

    const motorBody = new THREE.CylinderGeometry(0.3, 0.3, 0.8, 12);
    const motorMesh = new THREE.Mesh(motorBody, makeMat(COLORS.motor, 0.6, 0.4));
    motorMesh.position.set(0.9, 4.6, 0);
    motorMesh.rotation.z = Math.PI / 2;
    motorMesh.castShadow = true;
    motorGroup.add(motorMesh);

    // Motor fan cover
    const fanGeo = new THREE.CylinderGeometry(0.35, 0.3, 0.15, 12);
    const fan = new THREE.Mesh(fanGeo, makeMat(0x338833, 0.5, 0.5));
    fan.position.set(1.4, 4.6, 0);
    fan.rotation.z = Math.PI / 2;
    motorGroup.add(fan);

    crane.add(motorGroup);
    craneParts['motor-hoist'] = motorGroup;

    // ---- Control Panel ----
    const cpGroup = new THREE.Group();
    cpGroup.name = 'control-panel';

    const cpBody = new THREE.BoxGeometry(0.6, 0.8, 0.4);
    const cpMesh = new THREE.Mesh(cpBody, makeMat(COLORS.controlPanel, 0.5, 0.5));
    cpMesh.position.set(-0.9, 4.6, -1);
    cpMesh.castShadow = true;
    cpGroup.add(cpMesh);

    // Panel face detail
    const panelFace = new THREE.BoxGeometry(0.5, 0.6, 0.05);
    const panelFaceMesh = new THREE.Mesh(panelFace, makeMat(0x3377DD, 0.3, 0.6));
    panelFaceMesh.position.set(-0.9, 4.6, -1.23);
    cpGroup.add(panelFaceMesh);

    crane.add(cpGroup);
    craneParts['control-panel'] = cpGroup;

    // ---- Wire Rope ----
    const wireGroup = new THREE.Group();
    wireGroup.name = 'wire-rope';

    // Multiple rope strands
    const ropeGeo = new THREE.CylinderGeometry(0.02, 0.02, 3, 6);
    const ropeMat = makeMat(COLORS.wire, 0.7, 0.35);
    [-0.08, 0.08].forEach(xOff => {
      const rope = new THREE.Mesh(ropeGeo, ropeMat);
      rope.position.set(xOff, 2.7, 0);
      wireGroup.add(rope);
    });

    crane.add(wireGroup);
    craneParts['wire-rope'] = wireGroup;

    // ---- Hook Assembly ----
    const hookGroup = new THREE.Group();
    hookGroup.name = 'hook-assembly';

    // Hook block
    const blockGeo = new THREE.BoxGeometry(0.5, 0.4, 0.5);
    const block = new THREE.Mesh(blockGeo, makeMat(COLORS.hook, 0.8, 0.3));
    block.position.set(0, 1.3, 0);
    block.castShadow = true;
    hookGroup.add(block);

    // Hook (torus segment + cylinder)
    const hookCurve = new THREE.TorusGeometry(0.25, 0.06, 8, 16, Math.PI * 1.3);
    const hookMesh = new THREE.Mesh(hookCurve, makeMat(COLORS.hook, 0.9, 0.2));
    hookMesh.position.set(0, 0.85, 0);
    hookMesh.rotation.z = Math.PI * 0.15;
    hookMesh.castShadow = true;
    hookGroup.add(hookMesh);

    // Hook stem
    const stemGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8);
    const stem = new THREE.Mesh(stemGeo, makeMat(COLORS.hook, 0.8, 0.25));
    stem.position.set(0, 1.0, 0);
    hookGroup.add(stem);

    // Safety latch
    const latchGeo = new THREE.BoxGeometry(0.15, 0.04, 0.02);
    const latch = new THREE.Mesh(latchGeo, makeMat(0xFF4444, 0.5, 0.5));
    latch.position.set(0.15, 0.85, 0);
    latch.rotation.z = -0.4;
    hookGroup.add(latch);

    crane.add(hookGroup);
    craneParts['hook-assembly'] = hookGroup;

    // ---- Store original positions ----
    Object.entries(craneParts).forEach(([name, part]) => {
      originalPositions[name] = {
        x: part.position.x,
        y: part.position.y,
        z: part.position.z,
      };
    });

    scene.add(crane);
  }

  // ---- Floor ----
  function buildFloor() {
    const floorGeo = new THREE.PlaneGeometry(40, 40);
    const floorMat = new THREE.MeshStandardMaterial({
      color: COLORS.floor,
      metalness: 0.3,
      roughness: 0.8,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    scene.add(floor);

    // Grid helper
    const grid = new THREE.GridHelper(30, 30, 0x333344, 0x222233);
    grid.position.y = 0;
    scene.add(grid);
  }

  // ---- Particles ----
  function buildParticles() {
    const count = 80;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 20;
      positions[i + 1] = Math.random() * 10;
      positions[i + 2] = (Math.random() - 0.5) * 20;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xE8630A,
      size: 0.04,
      transparent: true,
      opacity: 0.4,
    });
    particles = new THREE.Points(geo, mat);
    scene.add(particles);
  }

  // ---- UI Overlay ----
  function buildUI() {
    // Controls bar
    const bar = document.createElement('div');
    bar.style.cssText = `
      position:absolute;bottom:16px;left:50%;transform:translateX(-50%);
      display:flex;gap:8px;z-index:10;
    `;

    const btnStyle = `
      padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;
      font-family:'Inter',sans-serif;cursor:pointer;transition:all 0.2s;
      border:1px solid rgba(255,255,255,0.15);
    `;

    toggleExplodedBtn = document.createElement('button');
    toggleExplodedBtn.textContent = '💥 Exploded View';
    toggleExplodedBtn.style.cssText = btnStyle + 'background:rgba(232,99,10,0.2);color:#FF8C42;backdrop-filter:blur(10px);';
    toggleExplodedBtn.addEventListener('click', toggleExploded);

    resetBtn = document.createElement('button');
    resetBtn.textContent = '🔄 Reset View';
    resetBtn.style.cssText = btnStyle + 'background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7);backdrop-filter:blur(10px);';
    resetBtn.addEventListener('click', resetView);

    bar.appendChild(toggleExplodedBtn);
    bar.appendChild(resetBtn);
    container.style.position = 'relative';
    container.appendChild(bar);

    // Info panel
    infoPanel = document.createElement('div');
    infoPanel.style.cssText = `
      position:absolute;top:16px;right:16px;width:260px;
      background:rgba(26,26,46,0.9);backdrop-filter:blur(12px);
      border:1px solid rgba(232,99,10,0.3);border-radius:12px;
      padding:20px;color:white;z-index:10;
      opacity:0;transform:translateX(20px);transition:all 0.3s ease;
      pointer-events:none;font-family:'Inter',sans-serif;
    `;
    infoPanel.innerHTML = `
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#E8630A;margin-bottom:4px;font-weight:700;">Component</div>
      <div id="info-name" style="font-size:16px;font-weight:700;margin-bottom:8px;font-family:'Space Grotesk',sans-serif;">Click a part</div>
      <div id="info-desc" style="font-size:13px;color:rgba(255,255,255,0.6);line-height:1.6;">Rotate, zoom, and click any crane component to learn about it.</div>
    `;
    container.appendChild(infoPanel);

    // Instruction hint
    const hint = document.createElement('div');
    hint.style.cssText = `
      position:absolute;top:16px;left:16px;
      padding:8px 14px;border-radius:8px;
      background:rgba(255,255,255,0.08);backdrop-filter:blur(8px);
      color:rgba(255,255,255,0.5);font-size:12px;
      font-family:'Inter',sans-serif;z-index:10;
    `;
    hint.textContent = '🖱️ Drag to rotate · Scroll to zoom · Click parts to inspect';
    container.appendChild(hint);

    // Fade hint after 5s
    setTimeout(() => {
      hint.style.transition = 'opacity 1s';
      hint.style.opacity = '0';
      setTimeout(() => hint.remove(), 1000);
    }, 5000);
  }

  // ---- Exploded View ----
  function toggleExploded() {
    isExploded = !isExploded;
    toggleExplodedBtn.textContent = isExploded ? '🔧 Assemble' : '💥 Exploded View';

    const explosionOffsets = {
      'girder-left': { x: 0, y: 1.5, z: -2 },
      'girder-right': { x: 0, y: 1.5, z: 2 },
      'end-carriage-left': { x: -3, y: 1, z: 0 },
      'end-carriage-right': { x: 3, y: 1, z: 0 },
      'trolley': { x: 0, y: 3, z: 0 },
      'hoist': { x: 0, y: 2, z: 2 },
      'motor-hoist': { x: 2, y: 2, z: 2 },
      'control-panel': { x: -2, y: 2, z: -2 },
      'wire-rope': { x: 0, y: -1, z: 0 },
      'hook-assembly': { x: 0, y: -3, z: 0 },
      'wheel-1': { x: -2, y: -1, z: -1 },
      'wheel-2': { x: -2, y: -1, z: 1 },
      'wheel-3': { x: 2, y: -1, z: -1 },
      'wheel-4': { x: 2, y: -1, z: 1 },
    };

    Object.entries(craneParts).forEach(([name, part]) => {
      const orig = originalPositions[name];
      const offset = explosionOffsets[name] || { x: 0, y: 0, z: 0 };

      const targetPos = isExploded
        ? { x: orig.x + offset.x, y: orig.y + offset.y, z: orig.z + offset.z }
        : { x: orig.x, y: orig.y, z: orig.z };

      // Animate with GSAP if available, else direct
      if (typeof gsap !== 'undefined') {
        gsap.to(part.position, {
          x: targetPos.x,
          y: targetPos.y,
          z: targetPos.z,
          duration: 1,
          ease: 'power2.inOut',
        });
      } else {
        part.position.set(targetPos.x, targetPos.y, targetPos.z);
      }
    });
  }

  // ---- Reset View ----
  function resetView() {
    if (controls) {
      if (typeof gsap !== 'undefined') {
        gsap.to(camera.position, { x: 12, y: 8, z: 14, duration: 1, ease: 'power2.inOut' });
        gsap.to(controls.target, { x: 0, y: 2, z: 0, duration: 1, ease: 'power2.inOut' });
      } else {
        camera.position.set(12, 8, 14);
        controls.target.set(0, 2, 0);
      }
    }
    // Deselect
    if (selectedPart) {
      unhighlightPart(selectedPart);
      selectedPart = null;
    }
    // Hide info
    infoPanel.style.opacity = '0';
    infoPanel.style.transform = 'translateX(20px)';
  }

  // ---- Click Detection ----
  function onMouseClick(e) {
    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const clickables = Object.values(craneParts).flatMap(p =>
      p instanceof THREE.Group ? p.children : [p]
    );
    const intersects = raycaster.intersectObjects(clickables, true);

    if (intersects.length > 0) {
      let obj = intersects[0].object;
      // Walk up to find named parent
      while (obj && !COMPONENT_INFO[obj.name]) {
        obj = obj.parent;
      }
      if (obj && COMPONENT_INFO[obj.name]) {
        selectPart(obj);
      }
    } else {
      // Click on empty space = deselect
      if (selectedPart) {
        unhighlightPart(selectedPart);
        selectedPart = null;
        infoPanel.style.opacity = '0';
        infoPanel.style.transform = 'translateX(20px)';
      }
    }
  }

  // ---- Hover cursor change ----
  function onMouseMove(e) {
    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const clickables = Object.values(craneParts).flatMap(p =>
      p instanceof THREE.Group ? p.children : [p]
    );
    const intersects = raycaster.intersectObjects(clickables, true);
    container.style.cursor = intersects.length > 0 ? 'pointer' : 'grab';
  }

  function selectPart(obj) {
    // Deselect previous
    if (selectedPart) unhighlightPart(selectedPart);

    selectedPart = obj;
    highlightPart(obj);

    // Show info
    const info = COMPONENT_INFO[obj.name];
    if (info) {
      document.getElementById('info-name').textContent = info.name;
      document.getElementById('info-desc').textContent = info.desc;
      infoPanel.style.opacity = '1';
      infoPanel.style.transform = 'translateX(0)';
      infoPanel.style.pointerEvents = 'auto';
    }

    // Smooth camera focus
    if (typeof gsap !== 'undefined' && controls) {
      const box = new THREE.Box3().setFromObject(obj);
      const center = new THREE.Vector3();
      box.getCenter(center);
      gsap.to(controls.target, {
        x: center.x, y: center.y, z: center.z,
        duration: 0.8, ease: 'power2.inOut',
      });
    }
  }

  function highlightPart(obj) {
    const traverse = (o) => {
      if (o.isMesh && o.material) {
        o._originalColor = o.material.color.getHex();
        o._originalEmissive = o.material.emissive ? o.material.emissive.getHex() : 0;
        if (o.material.emissive) {
          o.material.emissive.setHex(0xE8630A);
          o.material.emissiveIntensity = 0.3;
        }
      }
      o.children?.forEach(traverse);
    };
    if (obj instanceof THREE.Group) {
      obj.children.forEach(traverse);
    } else {
      traverse(obj);
    }
  }

  function unhighlightPart(obj) {
    const traverse = (o) => {
      if (o.isMesh && o.material && o._originalColor !== undefined) {
        if (o.material.emissive) {
          o.material.emissive.setHex(o._originalEmissive || 0);
          o.material.emissiveIntensity = 0;
        }
      }
      o.children?.forEach(traverse);
    };
    if (obj instanceof THREE.Group) {
      obj.children.forEach(traverse);
    } else {
      traverse(obj);
    }
  }

  // ---- Resize ----
  function onResize() {
    if (!container || !camera || !renderer) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }

  // ---- Render Loop ----
  function animate() {
    animFrame = requestAnimationFrame(animate);

    if (controls) controls.update();

    // Subtle particle drift
    if (particles && !reducedMotion) {
      const positions = particles.geometry.attributes.position.array;
      for (let i = 1; i < positions.length; i += 3) {
        positions[i] += 0.002;
        if (positions[i] > 10) positions[i] = 0;
      }
      particles.geometry.attributes.position.needsUpdate = true;
      particles.rotation.y += 0.0002;
    }

    renderer.render(scene, camera);
  }

  // ---- Cleanup on page leave ----
  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(animFrame);
    if (renderer) renderer.dispose();
  });

  // ---- GO ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
