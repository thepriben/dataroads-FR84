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
            items: [
                { metricsKey: 'network', key: 'refs', label: 'Routes départementales', unit: 'routes' },
                { metricsKey: 'network', key: 'lengthKm', label: 'Linéaire routier', unit: 'km' },
                {
                    metricsKey: 'network',
                    key: 'hierarchySplit',
                    label: 'Hiérarchie',
                    hint: 'Régionale · Territoriale · Locale',
                    fullWidth: true
                },
                { metricsKey: 'network', key: 'bridges', label: 'Ponts', unit: 'ouvrages' },
                { metricsKey: 'network', key: 'tunnels', label: 'Tunnels', unit: 'ouvrages' }
            ]
        },
        {
            title: 'Trafic',
            items: [
                { metricsKey: 'traffic', key: 'stations', label: 'Stations de comptage', unit: 'stations' },
                {
                    metricsKey: 'traffic',
                    key: 'mjaRange',
                    label: 'MJA (min – max)',
                    unit: 'véh/j',
                    fullWidth: true
                },
                {
                    metricsKey: 'traffic',
                    key: 'tierSplit',
                    label: 'Répartition du trafic',
                    hint: 'Fort · Moyen · Faible',
                    fullWidth: true
                }
            ]
        },
        {
            title: 'Sécurité',
            vintageKey: 'accidents',
            items: [
                { metricsKey: 'accidents', key: 'total', label: 'Accidents', unit: 'sinistres' },
                { metricsKey: 'accidents', key: 'fatal', label: 'Dont mortels', unit: 'victimes' },
                { metricsKey: 'accidents', key: 'hospitalized', label: 'Hospitalisés', unit: 'victimes' },
                { metricsKey: 'accidents', key: 'light', label: 'Blessés légers', unit: 'victimes' }
            ]
        },
        {
            title: 'Live',
            vintageKey: 'bisonFute',
            items: [
                { metricsKey: 'bisonFute', key: 'total', label: 'Événements actifs', unit: 'alertes' },
                { metricsKey: 'bisonFute', key: 'travaux', label: 'Travaux', unit: 'alertes' },
                { metricsKey: 'bisonFute', key: 'bouchons', label: 'Bouchons', unit: 'alertes' },
                { metricsKey: 'bisonFute', key: 'accidents', label: 'Accidents', unit: 'alertes' }
            ]
        },
        {
            title: 'Mobilité',
            items: [
                {
                    metricsKey: 'bicycle',
                    key: 'structurantesKm',
                    label: 'Véloroutes structurantes',
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
                    unit: 'km',
                    detailKey: 'localSegments',
                    detailSuffix: 'tronçons OSM',
                    title: 'Linéaire OSM des autres relations vélo du jeu de données'
                },
                {
                    metricsKey: 'construction',
                    key: 'constructionSplit',
                    label: 'Chantiers routiers',
                    hint: 'En cours · Projetés',
                    unit: 'tronçons OSM',
                    fullWidth: true
                }
            ]
        },
        {
            title: 'Qualité',
            vintageKey: 'osm',
            items: [
                { metricsKey: 'quality', key: 'wikidataPct', label: 'Couverture Wikidata', unit: '%' },
                { metricsKey: 'quality', key: 'relationPct', label: 'Relations OSM', unit: '%' },
                { metricsKey: 'quality', key: 'segments', label: 'Segments analysés', unit: 'tronçons' }
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
        const btn = document.getElementById('dashboardBtn');
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
            const titleHtml = vintageLabel
                ? `${section.title}<span class="dash-block-vintage">${escapeHtml(vintageLabel)}</span>`
                : section.title;

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

                return `
                    <div class="dash-tile${fullClass}"${titleAttr}>
                        <div class="dash-tile-value">${valueHtml}</div>
                        ${unitBlockHtml}
                        <div class="dash-tile-label">${escapeHtml(item.label)}</div>
                        ${hintHtml}
                        ${detailHtml}
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
        Object.assign(window.dashboardMetrics, partial);
        if (partial.vintages) {
            window.dashboardMetrics.vintages = {
                ...window.dashboardMetrics.vintages,
                ...partial.vintages
            };
        }
    };

    window.toggleDashboardPanel = async function toggleDashboardPanel(forceOpen) {
        const panel = document.getElementById('dashboardPanel');
        const btn = document.getElementById('dashboardBtn');
        if (!panel) return;

        const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !panel.classList.contains('active');

        if (!shouldOpen) {
            panel.classList.remove('active');
            btn?.classList.remove('is-active');
            return;
        }

        if (typeof window.isDashboardDataCached === 'function' && window.isDashboardDataCached()) {
            panel.classList.add('active');
            btn?.classList.add('is-active');
            renderDashboard();
            return;
        }

        panel.classList.remove('active');
        btn?.classList.remove('is-active');

        if (typeof window.setDashboardButtonLoading === 'function') {
            window.setDashboardButtonLoading(true);
        }

        try {
            if (typeof window.refreshDashboardData === 'function') {
                await window.refreshDashboardData({ force: Boolean(forceOpen) });
            }

            if (typeof window.isDashboardDataCached === 'function' && window.isDashboardDataCached()) {
                panel.classList.add('active');
                btn?.classList.add('is-active');
                renderDashboard();
            } else {
                panel.classList.add('active');
                btn?.classList.remove('is-active');
            }
        } finally {
            if (typeof window.setDashboardButtonLoading === 'function') {
                window.setDashboardButtonLoading(false);
            }
        }
    };

    window.renderDashboard = renderDashboard;
})(window);
