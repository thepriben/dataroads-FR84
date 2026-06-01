/**
 * @file Department-level KPI dashboard (phase 1).
 * @description Compact centered panel fed by window.dashboardMetrics (patched from app.js).
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
                { metricsKey: 'network', key: 'refs', label: 'Routes' },
                { metricsKey: 'network', key: 'lengthKm', label: 'Longueur' },
                { metricsKey: 'network', key: 'hierarchySplit', label: 'R · T · L' },
                { metricsKey: 'network', key: 'bridges', label: 'Ponts' },
                { metricsKey: 'network', key: 'tunnels', label: 'Tunnels' }
            ]
        },
        {
            title: 'Trafic',
            items: [
                { metricsKey: 'traffic', key: 'stations', label: 'Stations' },
                { metricsKey: 'traffic', key: 'mjaRange', label: 'MJA' },
                { metricsKey: 'traffic', key: 'tierSplit', label: 'F · M · f' }
            ]
        },
        {
            title: 'Sécurité',
            items: [
                { metricsKey: 'accidents', key: 'total', label: 'Accidents' },
                { metricsKey: 'accidents', key: 'fatal', label: 'Mortels' },
                { metricsKey: 'accidents', key: 'hospitalized', label: 'Hosp.' },
                { metricsKey: 'accidents', key: 'light', label: 'Légers' }
            ]
        },
        {
            title: 'Live',
            items: [
                { metricsKey: 'bisonFute', key: 'total', label: 'Événements' },
                { metricsKey: 'bisonFute', key: 'travaux', label: 'Travaux' },
                { metricsKey: 'bisonFute', key: 'bouchons', label: 'Bouchons' },
                { metricsKey: 'bisonFute', key: 'accidents', label: 'Accidents' }
            ]
        },
        {
            title: 'Mobilité',
            items: [
                { metricsKey: 'bicycle', key: 'structurantes', label: 'Vélo str.' },
                { metricsKey: 'bicycle', key: 'local', label: 'Vélo loc.' },
                { metricsKey: 'construction', key: 'constructionSplit', label: 'Chantiers' }
            ]
        },
        {
            title: 'Qualité',
            items: [
                { metricsKey: 'quality', key: 'wikidataPct', label: 'Wikidata' },
                { metricsKey: 'quality', key: 'relationPct', label: 'Relations' },
                { metricsKey: 'quality', key: 'segments', label: 'Tronçons' }
            ]
        }
    ];

    function formatDashboardValue(metricsKey, key, metrics) {
        const section = metrics[metricsKey];
        if (!section) return null;

        switch (metricsKey) {
            case 'network':
                if (key === 'lengthKm') {
                    return section.lengthKm >= 1
                        ? `${Math.round(section.lengthKm).toLocaleString('fr-FR')} km`
                        : null;
                }
                if (key === 'hierarchySplit') {
                    const h = metrics.hierarchy;
                    if (!h || h.regional == null || h.territorial == null || h.local == null) return null;
                    return `${h.regional} · ${h.territorial} · ${h.local}`;
                }
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : null;

            case 'traffic':
                if (key === 'mjaRange') {
                    const range = section.mjaRange;
                    if (!range) return null;
                    return range.replace(/\s*v[ée]h\/j/i, '').trim();
                }
                if (key === 'tierSplit') {
                    if (section.high == null || section.medium == null || section.low == null) return null;
                    return `${section.high} · ${section.medium} · ${section.low}`;
                }
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : null;

            case 'accidents':
            case 'bisonFute':
            case 'bicycle':
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : null;

            case 'construction':
                if (key === 'constructionSplit') {
                    if (section.construction == null || section.proposed == null) return null;
                    return `${section.construction} · ${section.proposed}`;
                }
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : null;

            case 'quality':
                if (key === 'wikidataPct' || key === 'relationPct') {
                    return section[key] != null ? `${section[key]}%` : null;
                }
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : null;

            default:
                return null;
        }
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

    const FULL_WIDTH_TILE_KEYS = new Set(['hierarchySplit', 'mjaRange', 'tierSplit', 'constructionSplit']);

    function renderDashboard() {
        const container = document.getElementById('dashboardContent');
        if (!container) return;

        const metrics = window.dashboardMetrics;
        const sectionsHtml = DASHBOARD_SECTIONS.map(section => {
            const tilesHtml = section.items.map(item => {
                const value = formatDashboardValue(item.metricsKey, item.key, metrics);
                const fullClass = FULL_WIDTH_TILE_KEYS.has(item.key) ? ' dash-tile-full' : '';
                return `
                    <div class="dash-tile${fullClass}">
                        <div class="dash-tile-value">${value}</div>
                        <div class="dash-tile-label">${item.label}</div>
                    </div>
                `;
            }).join('');

            return `
                <section class="dash-block">
                    <h3 class="dash-block-title">${section.title}</h3>
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
