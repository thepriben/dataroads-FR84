/**
 * @file Department-level KPI dashboard (phase 1).
 * @description Full-screen overlay fed by window.dashboardMetrics (patched from app.js).
 */
(function (window) {
    'use strict';

    window.dashboardMetrics = {
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

    const DASHBOARD_SECTIONS = [
        {
            id: 'network',
            title: 'Réseau départemental',
            tiles: [
                { key: 'refs', label: 'Routes uniques' },
                { key: 'lengthKm', label: 'Longueur cumulée' },
                { key: 'hierarchySplit', label: 'Régional / terr. / local', wide: true },
                { key: 'bridges', label: 'Ponts' },
                { key: 'tunnels', label: 'Tunnels' }
            ]
        },
        {
            id: 'traffic',
            title: 'Trafic & comptages',
            tiles: [
                { key: 'stations', label: 'Stations actives' },
                { key: 'mjaRange', label: 'Fourchette MJA', wide: true },
                { key: 'tierSplit', label: 'Fort / moyen / faible', wide: true }
            ]
        },
        {
            id: 'safety',
            title: 'Sécurité routière',
            tiles: [
                { key: 'total', label: 'Accidents recensés' },
                { key: 'fatal', label: 'Accidents mortels' },
                { key: 'hospitalized', label: 'Blessés hospitalisés' },
                { key: 'light', label: 'Blessés légers' }
            ]
        },
        {
            id: 'realtime',
            title: 'Temps réel',
            tiles: [
                { key: 'total', label: 'Événements actifs' },
                { key: 'travaux', label: 'Travaux' },
                { key: 'bouchons', label: 'Bouchons' },
                { key: 'accidents', label: 'Accidents en cours' }
            ]
        },
        {
            id: 'mobility',
            title: 'Véloroutes & chantiers',
            tiles: [
                { key: 'structurantes', label: 'Segments structurants' },
                { key: 'local', label: 'Segments réseau local' },
                { key: 'constructionSplit', label: 'Chantiers / projets', wide: true }
            ]
        },
        {
            id: 'quality',
            title: 'Qualité des données',
            tiles: [
                { key: 'wikidataPct', label: 'Routes liées Wikidata' },
                { key: 'relationPct', label: 'Routes avec relation OSM' },
                { key: 'segments', label: 'Tronçons OSM' }
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
                if (key === 'mjaRange') return section.mjaRange || '—';
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

    function renderDashboard() {
        const container = document.getElementById('dashboardContent');
        if (!container) return;

        const metrics = window.dashboardMetrics;
        const sectionsHtml = DASHBOARD_SECTIONS.map(section => {
            const tilesHtml = section.tiles.map(tile => {
                const value = formatDashboardValue(
                    section.id === 'safety' ? 'accidents'
                        : section.id === 'realtime' ? 'bisonFute'
                            : section.id === 'mobility' && tile.key.startsWith('construction') ? 'construction'
                                : section.id === 'mobility' ? 'bicycle'
                                    : section.id,
                    tile.key,
                    metrics
                );
                const wideClass = tile.wide ? ' dashboard-tile-wide' : '';
                return `
                    <div class="dashboard-tile${wideClass}">
                        <div class="dashboard-tile-value">${value}</div>
                        <div class="dashboard-tile-label">${tile.label}</div>
                    </div>
                `;
            }).join('');

            return `
                <section class="dashboard-section">
                    <h3 class="dashboard-section-title">${section.title}</h3>
                    <div class="dashboard-grid">${tilesHtml}</div>
                </section>
            `;
        }).join('');

        const weather = metrics.weather;
        const weatherBlock = weather ? `
            <section class="dashboard-section dashboard-section-weather">
                <h3 class="dashboard-section-title">Météo · Avignon</h3>
                <div class="dashboard-weather">
                    <span class="dashboard-weather-icon">${weather.icon || '⏳'}</span>
                    <span class="dashboard-weather-temp">${weather.temp != null ? `${weather.temp}°C` : '—'}</span>
                    <span class="dashboard-weather-desc">${weather.desc || ''}</span>
                </div>
            </section>
        ` : '';

        container.innerHTML = `${sectionsHtml}${weatherBlock}`;
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
        if (panel?.classList.contains('active')) {
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
            renderDashboard();
        }
    };

    window.renderDashboard = renderDashboard;
})(window);
