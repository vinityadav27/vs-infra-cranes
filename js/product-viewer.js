/**
 * Universal Interactive Product Viewer
 * A vanilla JS component for creating interactive 360-degree image views of products.
 * Includes support for rotation, zooming, fullscreen, and interactive hotspots.
 * Falls back gracefully to a single image zoomable view if only one image is provided.
 */

class ProductViewer {
    /**
     * @param {HTMLElement} containerElement - The DOM element to attach the viewer to.
     * @param {Object} options - Configuration options for the viewer.
     * @param {string[]} options.images - Array of image URLs for the 360 view.
     * @param {Array} options.hotspots - Array of hotspots {x, y, label, description}.
     * @param {string} options.productName - Name of the product (for a11y and UI).
     * @param {boolean} options.autoRotate - Whether to start auto-rotating initially.
     */
    constructor(containerElement, options = {}) {
        if (!containerElement) {
            throw new Error('ProductViewer requires a container element.');
        }

        this.container = containerElement;
        this.options = {
            images: [],
            hotspots: [],
            productName: 'Product',
            autoRotate: false,
            hasAngleAssets: false,
            ...options
        };

        // State
        this.state = {
            imagesLoaded: 0,
            currentIndex: 0,
            isDragging: false,
            startX: 0,
            currentX: 0,
            autoRotateActive: this.options.autoRotate,
            zoomLevel: 1,
            isFullscreen: false,
            hasInteracted: false,
            isSingleImage: this.options.images.length <= 1,
            loadedImages: [],
            error: false,
            activeHotspot: null,
            // Pinch zoom state
            initialPinchDistance: null,
            initialZoomLevel: 1
        };

        // UI Elements
        this.elements = {};

        // Animation frame reference
        this.animationFrame = null;
        this.lastRotateTime = 0;

        // Bound event listeners for cleanup
        this.boundEvents = {
            onMouseDown: this.onMouseDown.bind(this),
            onMouseMove: this.onMouseMove.bind(this),
            onMouseUp: this.onMouseUp.bind(this),
            onTouchStart: this.onTouchStart.bind(this),
            onTouchMove: this.onTouchMove.bind(this),
            onTouchEnd: this.onTouchEnd.bind(this),
            onWheel: this.onWheel.bind(this),
            onFullscreenChange: this.onFullscreenChange.bind(this),
            onResize: this.onResize.bind(this)
        };

        this.init();
    }

    /**
     * Initializes the viewer, injects styles, creates DOM, and starts preloading.
     */
    init() {
        window.currentProductViewer = this;
        this.injectStyles();
        this.createDOM();
        this.attachEvents();
        this.preloadImages();
    }

    /**
     * Injects the necessary CSS for the viewer.
     * Uses the design system colors provided.
     */
    injectStyles() {
        const styleId = 'product-viewer-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .pv-container {
                position: relative;
                width: 100%;
                height: 100%;
                min-height: 300px;
                background: transparent;
                color: #ffffff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                user-select: none;
                -webkit-user-select: none;
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 8px;
            }
            .pv-container.pv-fullscreen {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                z-index: 9999;
                border-radius: 0;
                border: none;
                background: #0F0F1A;
            }
            .pv-header {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                padding: 16px;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                z-index: 10;
                pointer-events: none;
            }
            .pv-badge {
                background: rgba(15, 15, 26, 0.7);
                border: 1px solid rgba(255,255,255,0.08);
                padding: 6px 12px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 600;
                backdrop-filter: blur(4px);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .pv-product-name {
                font-size: 16px;
                font-weight: 500;
                margin: 0;
                text-shadow: 0 1px 3px rgba(0,0,0,0.8);
            }
            .pv-viewer-area {
                flex: 1;
                position: relative;
                width: 100%;
                height: 100%;
                min-height: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                cursor: grab;
                touch-action: none;
            }
            .pv-viewer-area:active {
                cursor: grabbing;
            }
            .pv-image-container {
                position: relative;
                width: 100%;
                height: 100%;
                min-height: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                transform-origin: center center;
                transition: transform 0.1s ease-out;
            }
            .pv-image {
                max-width: 100%;
                max-height: 100%;
                width: auto;
                height: auto;
                object-fit: contain;
                display: none;
                user-select: none;
                -webkit-user-drag: none;
            }
            .pv-image.pv-active {
                display: block;
            }
            .pv-hotspots-layer {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
            }
            .pv-hotspot {
                position: absolute;
                width: 24px;
                height: 24px;
                transform: translate(-50%, -50%);
                background: #E8630A;
                border: 2px solid #fff;
                border-radius: 50%;
                cursor: pointer;
                pointer-events: auto;
                box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                z-index: 20;
                transition: transform 0.2s ease;
            }
            .pv-hotspot:hover, .pv-hotspot.pv-active {
                transform: translate(-50%, -50%) scale(1.2);
            }
            .pv-hotspot::after {
                content: '';
                position: absolute;
                top: -6px;
                left: -6px;
                right: -6px;
                bottom: -6px;
                border-radius: 50%;
                border: 2px solid #E8630A;
                opacity: 0;
                animation: pv-pulse 2s infinite;
            }
            @keyframes pv-pulse {
                0% { transform: scale(0.8); opacity: 0.8; }
                100% { transform: scale(1.5); opacity: 0; }
            }
            .pv-tooltip {
                position: absolute;
                background: #0F0F1A;
                border: 1px solid rgba(255,255,255,0.08);
                padding: 12px;
                border-radius: 6px;
                width: max-content;
                max-width: 200px;
                z-index: 21;
                pointer-events: none;
                opacity: 0;
                transform: translateY(10px);
                transition: opacity 0.2s, transform 0.2s;
                visibility: hidden;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            }
            .pv-hotspot.pv-active .pv-tooltip {
                opacity: 1;
                transform: translateY(0);
                visibility: visible;
            }
            .pv-tooltip-title {
                font-size: 14px;
                font-weight: bold;
                color: #E8630A;
                margin-bottom: 4px;
            }
            .pv-tooltip-desc {
                font-size: 12px;
                color: #ccc;
                line-height: 1.4;
            }
            .pv-controls {
                position: absolute;
                bottom: 16px;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                gap: 12px;
                background: rgba(15, 15, 26, 0.8);
                border: 1px solid rgba(255,255,255,0.08);
                padding: 8px 16px;
                border-radius: 30px;
                backdrop-filter: blur(4px);
                z-index: 10;
            }
            .pv-btn {
                background: transparent;
                border: none;
                color: #ffffff;
                cursor: pointer;
                min-width: 44px;
                min-height: 44px;
                display: flex;
                justify-content: center;
                align-items: center;
                border-radius: 22px;
                transition: background 0.2s;
                padding: 0;
            }
            .pv-btn:hover {
                background: rgba(255,255,255,0.1);
            }
            .pv-btn.pv-active {
                color: #E8630A;
            }
            .pv-btn svg {
                width: 20px;
                height: 20px;
                fill: currentColor;
            }
            .pv-loading {
                position: absolute;
                bottom: 16px;
                right: 16px;
                display: flex;
                align-items: center;
                gap: 8px;
                background: rgba(15, 15, 26, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 20px;
                padding: 6px 12px;
                font-size: 11px;
                color: rgba(255, 255, 255, 0.8);
                z-index: 15;
                pointer-events: none;
            }
            .pv-spinner {
                width: 14px;
                height: 14px;
                border: 2px solid rgba(255,255,255,0.2);
                border-top-color: #E8630A;
                border-radius: 50%;
                animation: pv-spin 1s linear infinite;
                margin-bottom: 0;
            }
            @keyframes pv-spin {
                to { transform: rotate(360deg); }
            }
            .pv-hint {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(15, 15, 26, 0.8);
                border: 1px solid rgba(255,255,255,0.08);
                padding: 12px 24px;
                border-radius: 24px;
                pointer-events: none;
                display: flex;
                align-items: center;
                gap: 12px;
                opacity: 1;
                transition: opacity 0.3s;
                z-index: 5;
            }
            .pv-hint.pv-hidden {
                opacity: 0;
            }
            .pv-hint svg {
                width: 24px;
                height: 24px;
                fill: #E8630A;
                animation: pv-swipe 2s ease-in-out infinite;
            }
            @keyframes pv-swipe {
                0% { transform: translateX(10px); }
                50% { transform: translateX(-10px); }
                100% { transform: translateX(10px); }
            }
            .pv-error {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                background: #0F0F1A;
                z-index: 50;
                color: #ff4444;
                text-align: center;
                padding: 20px;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Builds the necessary DOM structure.
     */
    createDOM() {
        this.container.innerHTML = '';
        this.container.classList.add('pv-container');

        // Header
        const header = document.createElement('div');
        header.className = 'pv-header';
        
        const badge = document.createElement('div');
        badge.className = 'pv-badge';
        const has360 = Boolean(this.options.hasAngleAssets && !this.state.isSingleImage);
        badge.textContent = has360 ? '360° Interactive View' : (this.state.isSingleImage ? 'Zoomable Product View' : 'Interactive Product View');
        
        const title = document.createElement('h2');
        title.className = 'pv-product-name';
        title.textContent = this.options.productName;

        header.appendChild(badge);
        header.appendChild(title);

        // Viewer Area
        const viewerArea = document.createElement('div');
        viewerArea.className = 'pv-viewer-area';

        const imageContainer = document.createElement('div');
        imageContainer.className = 'pv-image-container';

        // Hotspots Layer
        const hotspotsLayer = document.createElement('div');
        hotspotsLayer.className = 'pv-hotspots-layer';

        imageContainer.appendChild(hotspotsLayer);
        viewerArea.appendChild(imageContainer);

        // Controls
        const controls = document.createElement('div');
        controls.className = 'pv-controls';

        // Auto-Rotate Button (only if valid angle assets exist)
        let btnRotate = null;
        if (has360) {
            btnRotate = document.createElement('button');
            btnRotate.className = `pv-btn ${this.state.autoRotateActive ? 'pv-active' : ''}`;
            btnRotate.title = 'Auto Rotate';
            btnRotate.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2v3.08c-4.43.43-8 4.18-8 8.67 0 4.8 3.89 8.68 8.69 8.68s8.69-3.88 8.69-8.68c0-1.81-.56-3.5-1.52-4.88l-2.12 2.12c.59.85.95 1.88.95 2.97 0 3.31-2.69 6-6 6s-6-2.69-6-6c0-3.08 2.33-5.61 5.31-5.96V11l4.5-4.5L12 2z"/></svg>`;
            controls.appendChild(btnRotate);
        }

        // Reset Zoom Button
        const btnResetZoom = document.createElement('button');
        btnResetZoom.className = 'pv-btn';
        btnResetZoom.title = 'Reset Zoom';
        btnResetZoom.innerHTML = \`<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zm-2.5-4h5v-1h-5v1z"/></svg>\`;
        controls.appendChild(btnResetZoom);

        // Fullscreen Button
        const btnFullscreen = document.createElement('button');
        btnFullscreen.className = 'pv-btn';
        btnFullscreen.title = 'Toggle Fullscreen';
        btnFullscreen.innerHTML = \`<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>\`;
        controls.appendChild(btnFullscreen);

        // Loading Overlay
        const loading = document.createElement('div');
        loading.className = 'pv-loading';
        loading.innerHTML = \`<div class="pv-spinner"></div><div class="pv-progress">Loading (0/\${this.options.images.length})</div>\`;

        // Hint Overlay
        const hint = document.createElement('div');
        hint.className = 'pv-hint';
        if (this.state.isSingleImage) {
            hint.innerHTML = \`<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zM9.5 14C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zm2.5-4h-2v2H9v-2H7V9h2V7h1v2h2v1z"/></svg> Pinch/Scroll to zoom\`;
        } else {
            hint.innerHTML = \`<svg viewBox="0 0 24 24"><path d="M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.04.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z"/></svg> Drag to rotate\`;
        }

        // Error Overlay (hidden initially)
        const errorView = document.createElement('div');
        errorView.className = 'pv-error';
        errorView.style.display = 'none';
        errorView.innerHTML = \`<h3>Failed to load product view</h3><p>Please check your connection and try again.</p>\`;

        // Assemble
        this.container.appendChild(header);
        this.container.appendChild(viewerArea);
        this.container.appendChild(controls);
        this.container.appendChild(loading);
        this.container.appendChild(hint);
        this.container.appendChild(errorView);

        // Store references
        this.elements = {
            viewerArea,
            imageContainer,
            hotspotsLayer,
            controls,
            btnRotate,
            btnResetZoom,
            btnFullscreen,
            loading,
            progress: loading.querySelector('.pv-progress'),
            hint,
            errorView,
            images: []
        };
    }

    /**
     * Preloads all images.
     */
    preloadImages() {
        if (!this.options.images || this.options.images.length === 0) {
            this.showError();
            return;
        }

        const totalImages = this.options.images.length;
        let loadedCount = 0;
        let hasError = false;

        this.options.images.forEach((src, index) => {
            const img = new Image();
            img.className = 'pv-image';
            img.draggable = false;
            
            const handleLoad = () => {
                if (img._handled) return;
                img._handled = true;
                if (hasError) return;
                loadedCount++;
                this.state.imagesLoaded++;
                if (this.elements.progress) {
                    this.elements.progress.textContent = `Loading (${loadedCount}/${totalImages})`;
                }
                
                if (loadedCount === totalImages) {
                    this.onAllImagesLoaded();
                }
            };

            img.onload = handleLoad;
            
            img.onerror = () => {
                if (index === 0) {
                    hasError = true;
                    this.showError();
                } else {
                    handleLoad();
                }
            };

            img.src = src;
            this.state.loadedImages[index] = img;
            this.elements.images[index] = img;
            
            // Initially only show first image
            if (index === 0) {
                img.classList.add('pv-active');
            }
            
            this.elements.imageContainer.insertBefore(img, this.elements.hotspotsLayer);

            if (img.complete && img.naturalWidth > 0) {
                handleLoad();
            }
        });
    }

    onAllImagesLoaded() {
        this.elements.loading.style.display = 'none';
        const fallback = this.container.parentElement ? this.container.parentElement.querySelector('#product-main-image') : null;
        if (fallback) fallback.style.display = 'none';
        this.renderHotspots();
        this.updateThumbnails();
        if (this.state.autoRotateActive && !this.state.isSingleImage && this.options.hasAngleAssets) {
            this.startAutoRotate();
        }
    }

    showError() {
        this.state.error = true;
        this.elements.loading.style.display = 'none';
        const fallback = this.container.parentElement ? this.container.parentElement.querySelector('#product-main-image') : null;
        if (fallback) {
            fallback.style.display = 'block';
            this.elements.errorView.style.display = 'none';
        } else {
            this.elements.errorView.style.display = 'flex';
        }
    }

    /**
     * Renders defined hotspots.
     */
    renderHotspots() {
        this.elements.hotspotsLayer.innerHTML = '';
        if (!this.options.hotspots || this.options.hotspots.length === 0) return;
        
        // In a true 360 viewer, hotspots usually attach to a specific frame or interpolate.
        // For simplicity, we just add them and they'll rotate with the image container or stay fixed relative to the container.
        // Here we fix them relative to the image dimensions.
        this.options.hotspots.forEach((hs, index) => {
            const hotspotEl = document.createElement('div');
            hotspotEl.className = 'pv-hotspot';
            // Assuming x and y are percentages (0-100)
            hotspotEl.style.left = \`\${hs.x}%\`;
            hotspotEl.style.top = \`\${hs.y}%\`;
            
            const tooltip = document.createElement('div');
            tooltip.className = 'pv-tooltip';
            tooltip.innerHTML = \`<div class="pv-tooltip-title">\${hs.label}</div><div class="pv-tooltip-desc">\${hs.description}</div>\`;
            
            hotspotEl.appendChild(tooltip);
            
            hotspotEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleHotspot(hotspotEl);
            });
            
            this.elements.hotspotsLayer.appendChild(hotspotEl);
        });
    }

    toggleHotspot(hotspotEl) {
        if (this.state.activeHotspot && this.state.activeHotspot !== hotspotEl) {
            this.state.activeHotspot.classList.remove('pv-active');
        }
        hotspotEl.classList.toggle('pv-active');
        this.state.activeHotspot = hotspotEl.classList.contains('pv-active') ? hotspotEl : null;
    }

    hideHotspots() {
        if (this.state.activeHotspot) {
            this.state.activeHotspot.classList.remove('pv-active');
            this.state.activeHotspot = null;
        }
    }

    /**
     * Attaches interaction events.
     */
    attachEvents() {
        const target = this.elements.viewerArea;
        
        // Mouse Events
        target.addEventListener('mousedown', this.boundEvents.onMouseDown);
        window.addEventListener('mousemove', this.boundEvents.onMouseMove);
        window.addEventListener('mouseup', this.boundEvents.onMouseUp);
        
        // Touch Events
        target.addEventListener('touchstart', this.boundEvents.onTouchStart, { passive: false });
        window.addEventListener('touchmove', this.boundEvents.onTouchMove, { passive: false });
        window.addEventListener('touchend', this.boundEvents.onTouchEnd);
        
        // Zoom Events
        target.addEventListener('wheel', this.boundEvents.onWheel, { passive: false });
        
        // Controls
        if (this.elements.btnRotate) {
            this.elements.btnRotate.addEventListener('click', () => this.toggleAutoRotate());
        }
        this.elements.btnResetZoom.addEventListener('click', () => this.resetZoom());
        this.elements.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
        
        // Fullscreen Change
        document.addEventListener('fullscreenchange', this.boundEvents.onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', this.boundEvents.onFullscreenChange);

        // Click outside hotspot
        target.addEventListener('click', () => this.hideHotspots());
        
        // Resize
        window.addEventListener('resize', this.boundEvents.onResize);
    }

    /**
     * Interaction Handlers
     */
    handleInteractionStart(x, y) {
        this.state.isDragging = true;
        this.state.startX = x;
        this.state.currentX = x;
        
        if (!this.state.hasInteracted) {
            this.state.hasInteracted = true;
            this.elements.hint.classList.add('pv-hidden');
        }
        
        if (this.state.autoRotateActive) {
            this.stopAutoRotate();
            if (this.elements.btnRotate) {
                this.elements.btnRotate.classList.remove('pv-active');
                this.state.autoRotateActive = false;
            }
        }
    }

    handleInteractionMove(x) {
        if (!this.state.isDragging || this.state.isSingleImage || this.state.error) return;
        
        const dx = x - this.state.startX;
        // Adjust sensitivity
        if (Math.abs(dx) > 5) {
            const direction = dx > 0 ? -1 : 1;
            this.changeFrame(direction);
            this.state.startX = x;
        }
    }

    handleInteractionEnd() {
        this.state.isDragging = false;
        this.state.initialPinchDistance = null;
    }

    onMouseDown(e) {
        if (e.button !== 0) return; // Only left click
        e.preventDefault(); // Prevent text selection
        this.handleInteractionStart(e.clientX, e.clientY);
    }

    onMouseMove(e) {
        if (this.state.isDragging) {
            this.handleInteractionMove(e.clientX);
        }
    }

    onMouseUp() {
        this.handleInteractionEnd();
    }

    onTouchStart(e) {
        if (e.touches.length === 1) {
            this.handleInteractionStart(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 2) {
            // Pinch to zoom start
            e.preventDefault();
            this.state.initialPinchDistance = this.getPinchDistance(e.touches);
            this.state.initialZoomLevel = this.state.zoomLevel;
        }
    }

    onTouchMove(e) {
        if (this.state.error) return;
        
        if (e.touches.length === 1 && this.state.isDragging) {
            // On mobile, if we are zooming, we might want to pan instead of rotate.
            // For simplicity, we disable rotation while zoomed in, and enable pan (via scroll if handled, or custom).
            if (this.state.zoomLevel === 1) {
                e.preventDefault();
                this.handleInteractionMove(e.touches[0].clientX);
            }
        } else if (e.touches.length === 2) {
            e.preventDefault();
            if (this.state.initialPinchDistance) {
                const currentDistance = this.getPinchDistance(e.touches);
                const scale = currentDistance / this.state.initialPinchDistance;
                let newZoom = this.state.initialZoomLevel * scale;
                this.setZoom(newZoom);
            }
        }
    }

    onTouchEnd(e) {
        if (e.touches.length < 2) {
            this.handleInteractionEnd();
        }
    }

    getPinchDistance(touches) {
        return Math.hypot(
            touches[0].clientX - touches[1].clientX,
            touches[0].clientY - touches[1].clientY
        );
    }

    onWheel(e) {
        if (this.state.error) return;
        e.preventDefault();
        
        const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
        this.setZoom(this.state.zoomLevel + zoomDelta);
    }

    /**
     * Logic
     */
    changeFrame(direction) {
        const total = this.options.images.length;
        if (total <= 1) return;

        // Hide current
        this.elements.images[this.state.currentIndex].classList.remove('pv-active');
        
        // Calculate new index
        this.state.currentIndex = (this.state.currentIndex + direction + total) % total;
        
        // Show new
        this.elements.images[this.state.currentIndex].classList.add('pv-active');
        this.updateThumbnails();
    }

    showFrame(index) {
        const total = this.options.images.length;
        if (total === 0 || index < 0 || index >= total) return;
        if (this.elements.images[this.state.currentIndex]) {
            this.elements.images[this.state.currentIndex].classList.remove('pv-active');
        }
        this.state.currentIndex = index;
        if (this.elements.images[this.state.currentIndex]) {
            this.elements.images[this.state.currentIndex].classList.add('pv-active');
        }
        this.updateThumbnails();
    }

    updateThumbnails() {
        const thumbs = document.querySelectorAll('.product-thumbs .product-thumb');
        if (!thumbs.length) return;
        thumbs.forEach((t, i) => {
            if (i === this.state.currentIndex) {
                t.classList.add('active');
            } else {
                t.classList.remove('active');
            }
        });
    }

    setZoom(level) {
        const minZoom = 1;
        const maxZoom = 4;
        this.state.zoomLevel = Math.max(minZoom, Math.min(maxZoom, level));
        
        this.elements.imageContainer.style.transform = \`scale(\${this.state.zoomLevel})\`;
        
        // When zoomed, hint disappears
        if (!this.state.hasInteracted && this.state.zoomLevel > 1) {
            this.state.hasInteracted = true;
            this.elements.hint.classList.add('pv-hidden');
        }
    }

    resetZoom() {
        this.setZoom(1);
    }

    toggleAutoRotate() {
        if (this.state.isSingleImage) return;

        this.state.autoRotateActive = !this.state.autoRotateActive;
        this.elements.btnRotate.classList.toggle('pv-active', this.state.autoRotateActive);
        
        if (this.state.autoRotateActive) {
            this.startAutoRotate();
        } else {
            this.stopAutoRotate();
        }
    }

    startAutoRotate() {
        this.lastRotateTime = performance.now();
        const rotate = (timestamp) => {
            if (!this.state.autoRotateActive) return;
            
            // Rotate every 50ms approx
            if (timestamp - this.lastRotateTime > 50) {
                this.changeFrame(1);
                this.lastRotateTime = timestamp;
            }
            this.animationFrame = requestAnimationFrame(rotate);
        };
        this.animationFrame = requestAnimationFrame(rotate);
    }

    stopAutoRotate() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (this.container.requestFullscreen) {
                this.container.requestFullscreen();
            } else if (this.container.webkitRequestFullscreen) {
                this.container.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    }

    onFullscreenChange() {
        this.state.isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
        this.container.classList.toggle('pv-fullscreen', this.state.isFullscreen);
        
        // Update button icon
        const icon = this.state.isFullscreen 
            ? \`<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>\`
            : \`<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>\`;
            
        this.elements.btnFullscreen.innerHTML = \`<svg viewBox="0 0 24 24">\${icon}</svg>\`;
        this.resetZoom();
    }

    onResize() {
        // Adjustments on resize if needed (e.g. recenter)
    }

    /**
     * Cleanup resources and event listeners.
     */
    destroy() {
        this.stopAutoRotate();
        
        const target = this.elements.viewerArea;
        if (target) {
            target.removeEventListener('mousedown', this.boundEvents.onMouseDown);
            target.removeEventListener('touchstart', this.boundEvents.onTouchStart);
            target.removeEventListener('wheel', this.boundEvents.onWheel);
        }
        
        window.removeEventListener('mousemove', this.boundEvents.onMouseMove);
        window.removeEventListener('mouseup', this.boundEvents.onMouseUp);
        window.removeEventListener('touchmove', this.boundEvents.onTouchMove);
        window.removeEventListener('touchend', this.boundEvents.onTouchEnd);
        window.removeEventListener('resize', this.boundEvents.onResize);
        
        document.removeEventListener('fullscreenchange', this.boundEvents.onFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', this.boundEvents.onFullscreenChange);
        
        this.container.innerHTML = '';
        this.container.className = '';
    }
}

// Export for module systems or attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProductViewer;
} else {
    window.ProductViewer = ProductViewer;
}
