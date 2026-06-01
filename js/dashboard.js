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
        weather: null,
        vintages: {}
    };

    window.dashboardMetrics = { ...EMPTY_DASHBOARD_METRICS, vintages: {} };

    function isDashboardDataComplete(metrics) {
        const accidents = metrics?.accidents;
        const bison = metrics?.bisonFute;
        const bicycle = metrics?.bicycle;
        const construction = metrics?.construction;

        return Boolean(
            metrics?.network
            && metrics?.hierarchy
            && metrics?.traffic
            && accidents && accidents.total != null
            && bison && bison.total != null
            && bicycle && bicycle.structurantes != null
            && construction && construction.construction != null
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
                <button type="button" class="dashboard-retry-btn" onclick="refreshDashboardData({ force: true })">
                    Réessayer
                </button>
            </div>
        `;
    };

    const DASHBOARD_SECTIONS = [
        {
            title: 'Réseau',
            items: [
                { metricsKey: 'network', key: 'refs', label: 'routes' },
                { metricsKey: 'network', key: 'lengthKm', label: 'km' },
                { metricsKey: 'network', key: 'hierarchySplit', label: 'R/T/L' },
                { metricsKey: 'network', key: 'bridges', label: 'ponts' },
                { metricsKey: 'network', key: 'tunnels', label: 'tunnels' }
            ]
        },
        {
            title: 'Trafic',
            items: [
                { metricsKey: 'traffic', key: 'stations', label: 'sta.' },
                { metricsKey: 'traffic', key: 'mjaRange', label: 'MJA' },
                { metricsKey: 'traffic', key: 'tierSplit', label: 'F/M/f' }
            ]
        },
        {
            title: 'Sécurité',
            items: [
                { metricsKey: 'accidents', key: 'total', label: 'acc.' },
                { metricsKey: 'accidents', key: 'fatal', label: 'mortels' },
                { metricsKey: 'accidents', key: 'hospitalized', label: 'hosp.' },
                { metricsKey: 'accidents', key: 'light', label: 'légers' }
            ]
        },
        {
            title: 'Live',
            items: [
                { metricsKey: 'bisonFute', key: 'total', label: 'év.' },
                { metricsKey: 'bisonFute', key: 'travaux', label: 'trav.' },
                { metricsKey: 'bisonFute', key: 'bouchons', label: 'bouch.' },
                { metricsKey: 'bisonFute', key: 'accidents', label: 'acc.' }
            ]
        },
        {
            title: 'Mobilité',
            items: [
                { metricsKey: 'bicycle', key: 'structurantes', label: 'vélo str.' },
                { metricsKey: 'bicycle', key: 'local', label: 'vélo loc.' },
                { metricsKey: 'construction', key: 'constructionSplit', label: 'chant./proj.' }
            ]
        },
        {
            title: 'Qualité',
            items: [
                { metricsKey: 'quality', key: 'wikidataPct', label: 'Wikidata' },
                { metricsKey: 'quality', key: 'relationPct', label: 'relation' },
                { metricsKey: 'quality', key: 'segments', label: 'tronçons' }
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
                        ? Math.round(section.lengthKm).toLocaleString('fr-FR')
                        : null;
                }
                if (key === 'hierarchySplit') {
                    const h = metrics.hierarchy;
                    if (!h) return null;
                    return `${h.regional}/${h.territorial}/${h.local}`;
                }
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : null;

            case 'traffic':
                if (key === 'mjaRange') {
                    const range = section.mjaRange;
                    if (!range) return null;
                    return range.replace(/\s*v[ée]h\/j/i, '').trim();
                }
                if (key === 'tierSplit') {
                    return `${section.high}/${section.medium}/${section.low}`;
                }
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : null;

            case 'accidents':
            case 'bisonFute':
            case 'bicycle':
                return section[key] != null ? Number(section[key]).toLocaleString('fr-FR') : null;

            case 'construction':
                if (key === 'constructionSplit') {
                    return `${section.construction}/${section.proposed}`;
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

    function renderDashboard() {
        const container = document.getElementById('dashboardContent');
        if (!container) return;

        const metrics = window.dashboardMetrics;
        const rowsHtml = DASHBOARD_SECTIONS.map(section => {
            const itemsHtml = section.items.map(item => {
                const value = formatDashboardValue(item.metricsKey, item.key, metrics);
                if (value == null) {
                    return `<span class="dash-item dash-item-missing"><b>—</b> ${item.label}</span>`;
                }
                return `<span class="dash-item"><b>${value}</b> ${item.label}</span>`;
            }).join('<span class="dash-sep">·</span>');

            return `
                <div class="dash-row">
                    <span class="dash-k">${section.title}</span>
                    <div class="dash-v">${itemsHtml}</div>
                </div>
            `;
        }).join('');

        const weather = metrics.weather;
        const weatherRow = weather ? `
            <div class="dash-row dash-row-weather">
                <span class="dash-k">Météo</span>
                <div class="dash-v">
                    <span class="dash-item">
                        ${weather.icon || '⏳'} <b>${weather.temp != null ? `${weather.temp}°C` : '—'}</b>
                        ${(weather.desc || '').replace(/\s*·\s*Avignon/i, '')}
                    </span>
                </div>
            </div>
        ` : '';

        container.innerHTML = `<div class="dashboard-card">${rowsHtml}${weatherRow}</div>`;
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
