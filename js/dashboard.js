/**
 * @file Department-level KPI dashboard (phase 1).
 * @description Compact panel fed by window.dashboardMetrics (patched from app.js).
 */
(function (window) {
    'use strict';

    const EMPTY_DASHBOARD_METRICS = {
        network: null,
        hierarchy: null,
        traffic: null,
        accidents: null,
        bisonFute: null,
        bicycle: null,
        construction: null,
        quality: null,
        vintages: {}
    };

    window.dashboardMetrics = { ...EMPTY_DASHBOARD_METRICS, vintages: {} };

    const DASHBOARD_SECTIONS = [
        {
            title: 'Réseau',
            theme: 'network',
            shortcut: 'Afficher la hiérarchie du réseau seule sur la carte',
            items: [
                { metricsKey: 'network', key: 'refs', label: 'Routes départementales', unit: 'routes', icon: '🛣️' },
                { metricsKey: 'network', key: 'lengthKm', label: 'Linéaire routier', unit: 'km', icon: '📏' },
                {
                    metricsKey: 'network',
                    key: 'hierarchySplit',
                    label: 'Hiérarchie',
                    icon: '🔀',
                    hint: 'Régionale · Territoriale · Locale',
                    fullWidth: true
                },
                { metricsKey: 'network', key: 'bridges', label: 'Ponts', unit: 'ouvrages', icon: '🌉' },
                { metricsKey: 'network', key: 'tunnels', label: 'Tunnels', unit: 'ouvrages', icon: '🕳️' }
            ]
        },
        {
            title: 'Trafic',
            theme: 'traffic',
            shortcut: 'Afficher les stations de comptage seules sur la carte',
            items: [
                { metricsKey: 'traffic', key: 'stations', label: 'Stations de comptage', unit: 'stations', icon: '📡' },
                {
                    metricsKey: 'traffic',
                    key: 'mjaRange',
                    label: 'MJA (min – max)',
                    icon: '🚗',
                    unit: 'véh/j',
                    fullWidth: true
                },
                {
                    metricsKey: 'traffic',
                    key: 'tierSplit',
                    label: 'Répartition du trafic',
                    icon: '📊',
                    hint: 'Fort · Moyen · Faible',
                    fullWidth: true
                }
            ]
        },
        {
            title: 'Sécurité',
            theme: 'safety',
            shortcut: "Afficher l'accidentologie seule sur la carte",
            vintageKey: 'accidents',
            items: [
                { metricsKey: 'accidents', key: 'total', label: 'Accidents', unit: 'sinistres', icon: '💥' },
                { metricsKey: 'accidents', key: 'fatal', label: 'Dont mortels', unit: 'victimes', icon: '💀' },
                { metricsKey: 'accidents', key: 'hospitalized', label: 'Hospitalisés', unit: 'victimes', icon: '🚑' },
                { metricsKey: 'accidents', key: 'light', label: 'Blessés légers', unit: 'victimes', icon: '⚠️' },
                {
                    metricsKey: 'accidents',
                    key: 'latestTotal',
                    label: 'Dernier millésime',
                    unit: 'sinistres',
                    icon: '🗓️',
                    detailKey: 'latestYear'
                }
            ]
        },
        {
            title: 'Live',
            theme: 'live',
            shortcut: 'Afficher les événements routiers seuls sur la carte',
            vintageKey: 'bisonFute',
            items: [
                { metricsKey: 'bisonFute', key: 'total', label: 'Événements actifs', unit: 'alertes', icon: '📣' },
                { metricsKey: 'bisonFute', key: 'travaux', label: 'Travaux', unit: 'alertes', icon: '🚧' },
                { metricsKey: 'bisonFute', key: 'bouchons', label: 'Bouchons', unit: 'alertes', icon: '🐌' },
                { metricsKey: 'bisonFute', key: 'accidents', label: 'Accidents', unit: 'alertes', icon: '💥' }
            ]
        },
        {
            title: 'Mobilité',
            theme: 'mobility',
            shortcut: 'Afficher les véloroutes et les chantiers seuls sur la carte',
            items: [
                {
                    metricsKey: 'bicycle',
                    key: 'structurantesKm',
                    label: 'Véloroutes structurantes',
                    icon: '🚴',
                    unit: 'km',
                    detailKey: 'structurantesSegments',
                    detailSuffix: 'tronçons OSM',
                    hint: 'EV17 · EV8 · V861',
                    title: 'Linéaire OSM des grands itinéraires cyclables (Via Rhôna, Méditerranée, Via Venaissia)'
                },
                {
                    metricsKey: 'bicycle',
                    key: 'localKm',
                    label: 'Véloroutes locales',
                    icon: '🚲',
                    unit: 'km',
                    detailKey: 'localSegments',
                    detailSuffix: 'tronçons OSM',
                    title: 'Linéaire OSM des autres relations vélo du jeu de données'
                },
                {
                    metricsKey: 'construction',
                    key: 'constructionSplit',
                    label: 'Chantiers routiers',
                    icon: '🏗️',
                    hint: 'En cours · Projetés',
                    unit: 'tronçons OSM',
                    fullWidth: true
                }
            ]
        },
        {
            title: 'Qualité',
            theme: 'quality',
            shortcut: 'Ouvrir le rapport qualité OSM',
            vintageKey: 'osm',
            items: [
                { metricsKey: 'quality', key: 'wikidataPct', label: 'Couverture Wikidata', unit: '%', icon: '🔗' },
                { metricsKey: 'quality', key: 'relationPct', label: 'Relations OSM', unit: '%', icon: '🧩' },
                { metricsKey: 'quality', key: 'segments', label: 'Segments analysés', unit: 'tronçons', icon: '🧮' }
            ]
        }
    ];

    function formatKmValue(km) {
        if (km == null || Number.isNaN(km)) return null;
        if (km < 0.01) return '0';
        if (km >= 10) return Math.round(km).toLocaleString('fr-FR');
        return km.toFixed(1).replace('.', ',');
    }

    function formatCount(value) {
        if (value == null) return null;
        return Number(value).toLocaleString('fr-FR');
    }

    function formatDashboardValue(metricsKey, key, metrics) {
        const section = metrics[metricsKey];
        if (!section) return null;

        switch (metricsKey) {
            case 'network':
                if (key === 'lengthKm') return formatKmValue(section.lengthKm);
                if (key === 'hierarchySplit') {
                    const h = metrics.hierarchy;
                    if (!h || h.regional == null || h.territorial == null || h.local == null) return null;
                    return `${formatCount(h.regional)} · ${formatCount(h.territorial)} · ${formatCount(h.local)}`;
                }
                return formatCount(section[key]);

            case 'traffic':
                if (key === 'mjaRange') {
                    const range = section.mjaRange;
                    if (!range) return null;
                    return range.replace(/\s*v[ée]h\/j/gi, '').trim();
                }
                if (key === 'tierSplit') {
                    if (section.high == null || section.medium == null || section.low == null) return null;
                    return `${formatCount(section.high)} · ${formatCount(section.medium)} · ${formatCount(section.low)}`;
                }
                return formatCount(section[key]);

            case 'accidents':
                // Une année se lit « 2024 » et non « 2 024 ».
                if (key === 'latestYear') {
                    return Number.isFinite(section.latestYear) ? String(section.latestYear) : null;
                }
                return formatCount(section[key]);

            case 'bisonFute':
                return formatCount(section[key]);

            case 'bicycle':
                if (key === 'structurantesKm' || key === 'localKm') return formatKmValue(section[key]);
                if (key === 'structurantesSegments' || key === 'localSegments') return formatCount(section[key]);
                return formatCount(section[key]);

            case 'construction':
                if (key === 'constructionSplit') {
                    if (section.construction == null || section.proposed == null) return null;
                    return `${formatCount(section.construction)} · ${formatCount(section.proposed)}`;
                }
                return formatCount(section[key]);

            case 'quality':
                if (key === 'wikidataPct' || key === 'relationPct') {
                    return section[key] != null ? String(section[key]) : null;
                }
                return formatCount(section[key]);

            default:
                return null;
        }
    }

    function formatDashboardDetail(metricsKey, detailKey, detailSuffix, metrics) {
        const raw = formatDashboardValue(metricsKey, detailKey, metrics);
        if (raw == null) return null;
        return detailSuffix ? `${raw} ${detailSuffix}` : raw;
    }

    function tileHasInlineUnit(item) {
        return item.unit === '%';
    }

    function areAllDashboardFieldsPopulated(metrics) {
        return DASHBOARD_SECTIONS.every(section => section.items.every(item => (
            formatDashboardValue(item.metricsKey, item.key, metrics) != null
        )));
    }

    function isDashboardDataComplete(metrics) {
        return areAllDashboardFieldsPopulated(metrics);
    }

    let dashboardCacheReady = false;
    window.dashboardRefreshInProgress = false;

    window.isDashboardDataComplete = isDashboardDataComplete;
    window.areAllDashboardFieldsPopulated = areAllDashboardFieldsPopulated;

    window.isDashboardDataCached = function isDashboardDataCached() {
        return dashboardCacheReady;
    };

    window.markDashboardCacheReady = function markDashboardCacheReady() {
        dashboardCacheReady = isDashboardDataComplete(window.dashboardMetrics);
    };

    window.clearDashboardCache = function clearDashboardCache() {
        dashboardCacheReady = false;
    };

    window.resetDashboardMetrics = function resetDashboardMetrics() {
        window.dashboardMetrics = {
            ...EMPTY_DASHBOARD_METRICS,
            vintages: {}
        };
        dashboardCacheReady = false;
    };

    window.applyDashboardMetrics = function applyDashboardMetrics(patch) {
        if (!patch || typeof patch !== 'object') return;
        window.dashboardMetrics = {
            ...EMPTY_DASHBOARD_METRICS,
            ...patch,
            vintages: patch.vintages || {}
        };
    };

    window.setDashboardButtonLoading = function setDashboardButtonLoading(isLoading) {
        const btn = document.getElementById('dashboardHeaderBtn');
        if (!btn) return;
        btn.classList.toggle('is-loading', Boolean(isLoading));
        btn.disabled = Boolean(isLoading);
    };

    window.showDashboardSpinner = function showDashboardSpinner(message) {
        const container = document.getElementById('dashboardContent');
        if (!container) return;
        container.innerHTML = `
            <div class="dashboard-loading" role="status" aria-live="polite">
                <div class="dashboard-spinner" aria-hidden="true"></div>
                <p>${message || 'Chargement…'}</p>
            </div>
        `;
    };

    window.showDashboardLoadError = function showDashboardLoadError(message) {
        const container = document.getElementById('dashboardContent');
        if (!container) return;
        container.innerHTML = `
            <div class="dashboard-loading dashboard-loading-error" role="alert">
                <p>${message || 'Impossible de charger tous les indicateurs.'}</p>
                <button type="button" class="dashboard-retry-btn" onclick="toggleDashboardPanel(true)">
                    Réessayer
                </button>
            </div>
        `;
    };

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderDashboard() {
        const container = document.getElementById('dashboardContent');
        if (!container) return;

        const metrics = window.dashboardMetrics;
        const sectionsHtml = DASHBOARD_SECTIONS.map(section => {
            const vintageLabel = section.vintageKey && metrics.vintages?.[section.vintageKey];
            const headingHtml = section.theme
                ? `<button type="button" class="dash-block-link" data-theme="${escapeHtml(section.theme)}"
                        title="${escapeHtml(section.shortcut || '')}">${escapeHtml(section.title)}<span class="dash-block-go" aria-hidden="true">→</span></button>`
                : escapeHtml(section.title);
            const titleHtml = vintageLabel
                ? `${headingHtml}<span class="dash-block-vintage">${escapeHtml(vintageLabel)}</span>`
                : headingHtml;

            const tilesHtml = section.items.map(item => {
                const value = formatDashboardValue(item.metricsKey, item.key, metrics);
                const detail = item.detailKey
                    ? formatDashboardDetail(item.metricsKey, item.detailKey, item.detailSuffix, metrics)
                    : null;
                const fullClass = item.fullWidth ? ' dash-tile-full' : '';
                const valueHtml = tileHasInlineUnit(item) && item.unit
                    ? `${escapeHtml(value)}<span class="dash-tile-unit dash-tile-unit-inline">${escapeHtml(item.unit)}</span>`
                    : escapeHtml(value);
                const unitBlockHtml = item.unit && !tileHasInlineUnit(item)
                    ? `<div class="dash-tile-meta"><span class="dash-tile-unit">${escapeHtml(item.unit)}</span></div>`
                    : '';
                const hintHtml = item.hint
                    ? `<div class="dash-tile-hint">${escapeHtml(item.hint)}</div>`
                    : '';
                const detailHtml = detail
                    ? `<div class="dash-tile-detail">${escapeHtml(detail)}</div>`
                    : '';
                const titleAttr = item.title ? ` title="${escapeHtml(item.title)}"` : '';
                const iconHtml = item.icon
                    ? `<span class="dash-tile-icon" aria-hidden="true">${item.icon}</span>`
                    : '';

                return `
                    <div class="dash-tile${fullClass}"${titleAttr}>
                        ${iconHtml}
                        <div class="dash-tile-body">
                            <div class="dash-tile-value">${valueHtml}</div>
                            ${unitBlockHtml}
                            <div class="dash-tile-label">${escapeHtml(item.label)}</div>
                            ${hintHtml}
                            ${detailHtml}
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <section class="dash-block">
                    <h3 class="dash-block-title">${titleHtml}</h3>
                    <div class="dash-tiles">${tilesHtml}</div>
                </section>
            `;
        }).join('');

        container.innerHTML = `<div class="dashboard-sections">${sectionsHtml}</div>`;
    }

    window.patchDashboardMetrics = function patchDashboardMetrics(partial) {
        if (!partial || typeof partial !== 'object') return;
        if (window.dashboardRefreshInProgress) return;
        // Les millésimes se fusionnent : les extraire d'abord évite qu'Object
        // .assign ne remplace la table entière, laissant la fusion suivante
        // recopier ce qu'elle vient d'écraser.
        const { vintages, ...rest } = partial;
        Object.assign(window.dashboardMetrics, rest);
        if (vintages) {
            window.dashboardMetrics.vintages = {
                ...window.dashboardMetrics.vintages,
                ...vintages
            };
        }
    };

    window.toggleDashboardPanel = async function toggleDashboardPanel(forceOpen) {
        const overlay = document.getElementById('dashboardOverlay');
        const panel = document.getElementById('dashboardPanel');
        const btn = document.getElementById('dashboardHeaderBtn');
        if (!panel || !overlay) return;

        const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !overlay.classList.contains('active');

        function setDashboardOpen(isOpen) {
            overlay.classList.toggle('active', isOpen);
            overlay.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
            panel.classList.toggle('active', isOpen);
            btn?.classList.toggle('is-active', isOpen);
        }

        if (!shouldOpen) {
            setDashboardOpen(false);
            return;
        }

        if (typeof window.isDashboardDataCached === 'function' && window.isDashboardDataCached()) {
            setDashboardOpen(true);
            renderDashboard();
            return;
        }

        setDashboardOpen(false);

        if (typeof window.setDashboardButtonLoading === 'function') {
            window.setDashboardButtonLoading(true);
        }

        try {
            if (typeof window.refreshDashboardData === 'function') {
                await window.refreshDashboardData({ force: Boolean(forceOpen) });
            }

            const hasCache = typeof window.isDashboardDataCached === 'function' && window.isDashboardDataCached();
            setDashboardOpen(true);
            if (hasCache) {
                renderDashboard();
            } else {
                btn?.classList.remove('is-active');
            }
        } finally {
            if (typeof window.setDashboardButtonLoading === 'function') {
                window.setDashboardButtonLoading(false);
            }
        }
    };

    document.addEventListener('click', event => {
        const link = event.target.closest && event.target.closest('.dash-block-link');
        if (!link || !link.dataset.theme) return;
        if (typeof window.focusDashboardTheme === 'function') window.focusDashboardTheme(link.dataset.theme);
    });

    window.renderDashboard = renderDashboard;
})(window);
