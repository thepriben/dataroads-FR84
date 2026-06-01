/**
 * @file Department-level KPI dashboard (phase 1).
 * @description Compact floating panel fed by window.dashboardMetrics (patched from app.js).
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
        weather: null,
        vintages: {}
    };

    window.dashboardMetrics = { ...EMPTY_DASHBOARD_METRICS, vintages: {} };

    function isDashboardDataComplete(metrics) {
        return Boolean(
            metrics?.network
            && metrics?.hierarchy
            && metrics?.traffic
            && metrics?.accidents
            && metrics?.bisonFute
            && metrics?.bicycle
            && metrics?.construction
            && metrics?.quality
            && metrics?.weather
        );
    }

    let dashboardCacheReady = false;
    window.dashboardRefreshInProgress = false;

    window.isDashboardDataComplete = isDashboardDataComplete;

    window.isDashboardDataCached = function isDashboardDataCached() {
        return dashboardCacheReady;
    };

    window.markDashboardCacheReady = function markDashboardCacheReady() {
        if (!isDashboardDataComplete(window.dashboardMetrics)) {
            dashboardCacheReady = false;
            return;
        }
        dashboardCacheReady = true;
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

    window.showDashboardSpinner = function showDashboardSpinner(message) {
        const container = document.getElementById('dashboardContent');
        if (!container) return;
        container.innerHTML = `
            <div class="dashboard-loading" role="status" aria-live="polite">
                <div class="dashboard-spinner" aria-hidden="true"></div>
                <p>${message || 'Chargement des indicateurs…'}</p>
            </div>
        `;
    };

    window.showDashboardLoadError = function showDashboardLoadError(message) {
        const container = document.getElementById('dashboardContent');
        if (!container) return;
        container.innerHTML = `
            <div class="dashboard-loading dashboard-loading-error" role="alert">
                <p>${message || 'Impossible de charger tous les indicateurs.'}</p>
                <button type="button" class="dashboard-retry-btn" onclick="refreshDashboardData({ force: true })">
                    Réessayer
                </button>
            </div>
        `;
    };

    const DASHBOARD_SECTIONS = [
        {
            id: 'network',
            title: 'Réseau',
            tiles: [
                { key: 'refs', label: 'routes' },
                { key: 'lengthKm', label: 'km' },
                { key: 'hierarchySplit', label: 'R/T/L' },
                { key: 'bridges', label: 'ponts' },
                { key: 'tunnels', label: 'tunnels' }
            ]
        },
        {
            id: 'traffic',
            title: 'Trafic',
            tiles: [
                { key: 'stations', label: 'sta.' },
                { key: 'mjaRange', label: 'MJA' },
                { key: 'tierSplit', label: 'F/M/f' }
            ]
        },
        {
            id: 'safety',
            title: 'Sécurité',
            tiles: [
                { key: 'total', label: 'acc.' },
                { key: 'fatal', label: 'mortels' },
                { key: 'hospitalized', label: 'hosp.' },
                { key: 'light', label: 'légers' }
            ]
        },
        {
            id: 'realtime',
            title: 'Live',
            tiles: [
                { key: 'total', label: 'év.' },
                { key: 'travaux', label: 'trav.' },
                { key: 'bouchons', label: 'bouch.' },
                { key: 'accidents', label: 'acc.' }
            ]
        },
        {
            id: 'mobility',
            title: 'Mobilité',
            tiles: [
                { key: 'structurantes', label: 'vélo str.' },
                { key: 'local', label: 'vélo loc.' },
                { key: 'constructionSplit', label: 'chant./proj.' }
            ]
        },
        {
            id: 'quality',
            title: 'Qualité',
            tiles: [
                { key: 'wikidataPct', label: 'Wikidata' },
                { key: 'relationPct', label: 'relation' },
                { key: 'segments', label: 'tronçons' }
            ]
        }
    ];

    function formatDashboardValue(sectionId, key, metrics) {
        const section = metrics[sectionId];
        if (!section) return '…';

        switch (sectionId) {
            case 'network':
                if (key === 'lengthKm') {
                    return section.lengthKm >= 1
                        ? `${Math.round(section.lengthKm).toLocaleString('fr-FR')} km`
                        : '—';
                }
                if (key === 'hierarchySplit') {
                    const h = metrics.hierarchy;
                    if (!h) return '…';
                    return `${h.regional} / ${h.territorial} / ${h.local}`;
                }
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : '—';

            case 'traffic':
                if (key === 'mjaRange') {
                    return (section.mjaRange || '—').replace(/\s*v[ée]h\/j/i, '');
                }
                if (key === 'tierSplit') {
                    return `${section.high} / ${section.medium} / ${section.low}`;
                }
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : '—';

            case 'safety':
            case 'realtime':
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : '—';

            case 'mobility':
                if (key === 'constructionSplit') {
                    const c = metrics.construction;
                    if (!c) return '…';
                    return `${c.construction} / ${c.proposed}`;
                }
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : '—';

            case 'quality':
                if (key === 'wikidataPct' || key === 'relationPct') {
                    return section[key] != null ? `${section[key]} %` : '…';
                }
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : '—';

            default:
                return '—';
        }
    }

    function resolveSectionMetricsKey(sectionId, tileKey) {
        if (sectionId === 'safety') return 'accidents';
        if (sectionId === 'realtime') return 'bisonFute';
        if (sectionId === 'mobility' && tileKey.startsWith('construction')) return 'construction';
        if (sectionId === 'mobility') return 'bicycle';
        return sectionId;
    }

    function renderDashboard() {
        const container = document.getElementById('dashboardContent');
        if (!container) return;

        const metrics = window.dashboardMetrics;
        const sectionsHtml = DASHBOARD_SECTIONS.map(section => {
            const statsHtml = section.tiles.map(tile => {
                const value = formatDashboardValue(
                    resolveSectionMetricsKey(section.id, tile.key),
                    tile.key,
                    metrics
                );
                return `<span class="dashboard-stat"><strong>${value}</strong> ${tile.label}</span>`;
            }).join('');

            return `
                <section class="dashboard-row">
                    <span class="dashboard-row-label">${section.title}</span>
                    <div class="dashboard-row-values">${statsHtml}</div>
                </section>
            `;
        }).join('');

        const weather = metrics.weather;
        const weatherBlock = weather ? `
            <section class="dashboard-row dashboard-row-weather">
                <span class="dashboard-row-label">Météo</span>
                <div class="dashboard-row-values">
                    <span class="dashboard-stat">
                        <span class="dashboard-weather-icon">${weather.icon || '⏳'}</span>
                        <strong>${weather.temp != null ? `${weather.temp}°C` : '—'}</strong>
                        ${weather.desc || ''}
                    </span>
                </div>
            </section>
        ` : '';

        container.innerHTML = `<div class="dashboard-dense">${sectionsHtml}${weatherBlock}</div>`;
    }

    window.patchDashboardMetrics = function patchDashboardMetrics(partial) {
        if (!partial || typeof partial !== 'object') return;
        Object.assign(window.dashboardMetrics, partial);
        if (partial.vintages) {
            window.dashboardMetrics.vintages = {
                ...window.dashboardMetrics.vintages,
                ...partial.vintages
            };
        }
        const panel = document.getElementById('dashboardPanel');
        if (panel?.classList.contains('active') && !window.dashboardRefreshInProgress) {
            renderDashboard();
        }
    };

    window.toggleDashboardPanel = function toggleDashboardPanel(forceOpen) {
        const panel = document.getElementById('dashboardPanel');
        const btn = document.getElementById('dashboardBtn');
        if (!panel) return;

        const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !panel.classList.contains('active');
        panel.classList.toggle('active', shouldOpen);
        btn?.classList.toggle('is-active', shouldOpen);

        if (shouldOpen) {
            if (typeof window.refreshDashboardData === 'function') {
                window.refreshDashboardData();
            } else {
                renderDashboard();
            }
        }
    };

    window.renderDashboard = renderDashboard;
})(window);
