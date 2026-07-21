/**
 * Waze Live Map layer (issue #10).
 *
 * Waze has no open data API for arbitrary areas, so real-time community traffic
 * (jams + incidents) is surfaced through the official Waze Live Map embed inside
 * a modal. The iframe is lazy-loaded when the panel opens (and re-centred on the
 * current Leaflet view) and unloaded when it closes, so the live map never polls
 * in the background.
 */
(function (window, document) {
    'use strict';

    // Fallback centre = Vaucluse department, matching DEFAULT_MAP_VIEW in app.js.
    const FALLBACK = { lat: 44.06, lon: 5.20, zoom: 11 };

    function buildWazeUrl() {
        let { lat, lon, zoom } = FALLBACK;

        try {
            if (window.map && typeof window.map.getCenter === 'function') {
                const center = window.map.getCenter();
                lat = center.lat;
                lon = center.lng;
                zoom = Math.round(window.map.getZoom());
            }
        } catch (error) {
            // Ignore and keep the department fallback.
        }

        // Waze embed zoom is the same slippy-map scale as Leaflet; clamp to the
        // range the live map supports (official docs: 3–17).
        zoom = Math.max(8, Math.min(16, Number.isFinite(zoom) ? zoom : FALLBACK.zoom));

        // /fr/ → French UI and kilometres; pin=1 marks the dataroads view centre.
        return `https://embed.waze.com/fr/iframe?zoom=${zoom}` +
            `&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&pin=1`;
    }

    function setOpen(isOpen) {
        const overlay = document.getElementById('wazeOverlay');
        const panel = document.getElementById('wazePanel');
        const frame = document.getElementById('wazeFrame');
        const btn = document.getElementById('wazeLiveBtn');
        if (!overlay || !panel || !frame) return;

        overlay.classList.toggle('active', isOpen);
        overlay.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        panel.classList.toggle('active', isOpen);
        if (btn) btn.classList.toggle('is-active', isOpen);

        if (isOpen) {
            frame.src = buildWazeUrl();
        } else {
            // Drop the src so the embedded live map stops running once hidden.
            frame.removeAttribute('src');
        }
    }

    window.toggleWazePanel = function toggleWazePanel(forceOpen) {
        const overlay = document.getElementById('wazeOverlay');
        if (!overlay) return;
        const shouldOpen = typeof forceOpen === 'boolean'
            ? forceOpen
            : !overlay.classList.contains('active');
        setOpen(shouldOpen);
    };

    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        const overlay = document.getElementById('wazeOverlay');
        if (overlay && overlay.classList.contains('active')) {
            setOpen(false);
        }
    });
})(window, document);
