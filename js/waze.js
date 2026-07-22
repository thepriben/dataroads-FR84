/**
 * Waze traffic layer (issue #10).
 *
 * Two modes, decided automatically at load time from data/external/waze.geojson:
 *
 *  • NATIVE  — when an official "Waze for Cities" partner feed is configured
 *              (`_cache.configured === true`), incidents (alerts) and traffic
 *              jams are drawn as a real Leaflet layer: coloured jam lines and
 *              emoji incident markers, toggled by the "W" toolbar button.
 *              The feed is refreshed by scripts/update_external_data.py on the
 *              usual 3 h schedule (near-real-time snapshot, not truly live).
 *
 *  • IFRAME  — fallback used when no feed is configured. Opens the official
 *              Waze Live Map embed in a modal, centred on the current view.
 *
 * Rationale: the unofficial live-map endpoint returns HTTP 403 to datacenter
 * IPs (so it cannot be scraped from GitHub Actions), and Waze offers no open
 * area API. The partner feed is the only server-side-legal source; until the
 * department provides its URL, the iframe keeps the feature usable.
 */
(function (window, document) {
    'use strict';

    const FALLBACK = { lat: 44.06, lon: 5.20, zoom: 11 };

    let mode = 'iframe';        // 'native' once a configured feed is detected
    let loaded = false;         // native data fetch attempted
    let wazeLayer = null;       // L.layerGroup in native mode
    let nativeVisible = false;
    let generatedAt = null;     // freshness of the native snapshot

    /* ------------------------------------------------------------------ *
     *  Native layer                                                       *
     * ------------------------------------------------------------------ */

    // Incident styling by Waze alert type.
    const ALERT_STYLE = {
        ACCIDENT:      { glyph: '💥', color: '#e53935', label: 'Accident' },
        ROAD_CLOSED:   { glyph: '⛔', color: '#455a64', label: 'Route fermée' },
        HAZARD:        { glyph: '⚠️', color: '#fb8c00', label: 'Danger' },
        WEATHERHAZARD: { glyph: '🌧️', color: '#fb8c00', label: 'Danger météo' },
        JAM:           { glyph: '🐌', color: '#d81b60', label: 'Bouchon' },
        POLICE:        { glyph: '👮', color: '#1e88e5', label: 'Contrôle' },
        CONSTRUCTION:  { glyph: '🚧', color: '#fdd835', label: 'Travaux' },
        MISC:          { glyph: '📍', color: '#6d4c41', label: 'Signalement' }
    };

    function alertStyle(type) {
        return ALERT_STYLE[type] || ALERT_STYLE.MISC;
    }

    // Jam colour: prefer Waze "level" (0=fluid … 5=standstill), else derive from speed.
    function jamColor(level, speed) {
        let l = Number.isFinite(level) ? level : null;
        if (l === null) {
            const s = Number(speed);
            l = !Number.isFinite(s) ? 3 : s < 10 ? 5 : s < 25 ? 4 : s < 45 ? 3 : 2;
        }
        return l >= 5 ? '#7f0000'
             : l >= 4 ? '#c62828'
             : l >= 3 ? '#ef6c00'
             : l >= 2 ? '#f9a825'
             : '#fdd835';
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function freshnessText() {
        if (!generatedAt) return '';
        const t = Date.parse(generatedAt);
        if (!Number.isFinite(t)) return '';
        const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
        if (mins < 60) return `relevé il y a ${mins} min`;
        const h = Math.round(mins / 60);
        return `relevé il y a ${h} h`;
    }

    function buildNativeLayer(data) {
        wazeLayer = L.layerGroup();
        const feats = (data && data.features) || [];
        const fresh = freshnessText();
        const footer = `<div class="waze-pop-src">Source&nbsp;: Waze for Cities${fresh ? ' · ' + fresh : ''}</div>`;

        feats.forEach(function (f) {
            const p = f.properties || {};
            const g = f.geometry || {};

            if (p.kind === 'jam' && g.type === 'LineString' && Array.isArray(g.coordinates)) {
                const latlngs = g.coordinates
                    .filter(c => Array.isArray(c) && c.length >= 2)
                    .map(c => [c[1], c[0]]);
                if (latlngs.length < 2) return;
                const color = jamColor(p.level, p.speedKMH);
                const line = L.polyline(latlngs, {
                    color, weight: 6, opacity: 0.85, lineCap: 'round'
                });
                const delayMin = Number.isFinite(p.delay) ? Math.round(p.delay / 60) : null;
                line.bindPopup(
                    `<div class="route-popup waze-pop">
                        <h3>🐌 Bouchon</h3>
                        <div class="detail"><strong>Axe&nbsp;:</strong> ${escapeHtml(p.street || 'N/A')}${p.city ? ' · ' + escapeHtml(p.city) : ''}</div>
                        ${Number.isFinite(p.speedKMH) ? `<div class="detail"><strong>Vitesse&nbsp;:</strong> ${Math.round(p.speedKMH)} km/h</div>` : ''}
                        ${delayMin !== null ? `<div class="detail"><strong>Retard&nbsp;:</strong> ~${delayMin} min</div>` : ''}
                        ${Number.isFinite(p.length) ? `<div class="detail"><strong>Longueur&nbsp;:</strong> ${p.length} m</div>` : ''}
                        ${footer}
                    </div>`
                );
                line.addTo(wazeLayer);
                return;
            }

            if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
                const st = alertStyle(p.type);
                const icon = L.divIcon({
                    className: 'waze-alert-icon',
                    html: `<span style="--wz:${st.color}">${st.glyph}</span>`,
                    iconSize: [26, 26],
                    iconAnchor: [13, 13],
                    popupAnchor: [0, -12]
                });
                const marker = L.marker([g.coordinates[1], g.coordinates[0]], { icon });
                marker.bindPopup(
                    `<div class="route-popup waze-pop">
                        <h3>${st.glyph} ${escapeHtml(st.label)}</h3>
                        <div class="detail"><strong>Lieu&nbsp;:</strong> ${escapeHtml(p.street || 'N/A')}${p.city ? ' · ' + escapeHtml(p.city) : ''}</div>
                        ${p.description ? `<div class="detail">${escapeHtml(p.description)}</div>` : ''}
                        ${footer}
                    </div>`
                );
                marker.addTo(wazeLayer);
            }
        });

        return wazeLayer;
    }

    async function ensureLoaded() {
        if (loaded) return mode === 'native';
        loaded = true;
        try {
            if (!window.InforouteApi || typeof window.InforouteApi.fetchGeoJson !== 'function') {
                return false;
            }
            const data = await window.InforouteApi.fetchGeoJson('waze');
            const configured = !!(data && data._cache && data._cache.configured);
            if (configured) {
                mode = 'native';
                generatedAt = data._cache && data._cache.generated_at;
                buildNativeLayer(data);
            }
        } catch (error) {
            // Stay in iframe fallback mode.
        }
        return mode === 'native';
    }

    function setNativeVisible(show) {
        const btn = document.getElementById('wazeLiveBtn');
        if (!wazeLayer || !window.map) return;
        if (show) {
            wazeLayer.addTo(window.map);
        } else {
            window.map.removeLayer(wazeLayer);
        }
        nativeVisible = show;
        if (btn) btn.classList.toggle('is-active', show);
    }

    /* ------------------------------------------------------------------ *
     *  Iframe fallback (official Waze Live Map embed)                     *
     * ------------------------------------------------------------------ */

    function buildWazeUrl() {
        let { lat, lon, zoom } = FALLBACK;
        try {
            if (window.map && typeof window.map.getCenter === 'function') {
                const center = window.map.getCenter();
                lat = center.lat;
                lon = center.lng;
                zoom = Math.round(window.map.getZoom());
            }
        } catch (error) { /* keep department fallback */ }
        zoom = Math.max(8, Math.min(16, Number.isFinite(zoom) ? zoom : FALLBACK.zoom));
        return `https://embed.waze.com/fr/iframe?zoom=${zoom}` +
            `&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&pin=1`;
    }

    function setIframeOpen(isOpen) {
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
            frame.removeAttribute('src');
        }
    }

    /* ------------------------------------------------------------------ *
     *  Public entry point (wired on the "W" toolbar button)              *
     * ------------------------------------------------------------------ */

    window.toggleWazePanel = function toggleWazePanel(forceOpen) {
        ensureLoaded().then(function (isNative) {
            if (isNative) {
                const want = typeof forceOpen === 'boolean' ? forceOpen : !nativeVisible;
                setNativeVisible(want);
            } else {
                const overlay = document.getElementById('wazeOverlay');
                const shouldOpen = typeof forceOpen === 'boolean'
                    ? forceOpen
                    : !(overlay && overlay.classList.contains('active'));
                setIframeOpen(shouldOpen);
            }
        });
    };

    // Close the iframe modal with Escape.
    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        const overlay = document.getElementById('wazeOverlay');
        if (overlay && overlay.classList.contains('active')) {
            setIframeOpen(false);
        }
    });

    // Preload the feed once the map/API are ready so the first click is instant.
    (function preload() {
        let tries = 0;
        const timer = setInterval(function () {
            tries += 1;
            if (window.map && window.InforouteApi) {
                clearInterval(timer);
                ensureLoaded();
            } else if (tries > 40) {
                clearInterval(timer);
            }
        }, 300);
    })();
})(window, document);
