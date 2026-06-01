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
                { key: 'refs', label: 'Routes uniques', action: 'hierarchy' },
                { key: 'lengthKm', label: 'Longueur cumulée', action: 'hierarchy' },
                { key: 'hierarchySplit', label: 'Régional / terr. / local', action: 'hierarchy', wide: true },
                { key: 'bridges', label: 'Ponts', action: 'hierarchy' },
                { key: 'tunnels', label: 'Tunnels', action: 'hierarchy' }
            ]
        },
        {
            id: 'traffic',
            title: 'Trafic & comptages',
            tiles: [
                { key: 'stations', label: 'Stations actives', action: 'traffic' },
                { key: 'mjaRange', label: 'Fourchette MJA', action: 'traffic', wide: true },
                { key: 'tierSplit', label: 'Fort / moyen / faible', action: 'traffic', wide: true }
            ]
        },
        {
            id: 'safety',
            title: 'Sécurité routière',
            tiles: [
                { key: 'total', label: 'Accidents recensés', action: 'accidents' },
                { key: 'fatal', label: 'Accidents mortels', action: 'accidents' },
                { key: 'hospitalized', label: 'Blessés hospitalisés', action: 'accidents' },
                { key: 'light', label: 'Blessés légers', action: 'accidents' }
            ]
        },
        {
            id: 'realtime',
            title: 'Temps réel',
            tiles: [
                { key: 'total', label: 'Événements actifs', action: 'bison' },
                { key: 'travaux', label: 'Travaux', action: 'bison' },
                { key: 'bouchons', label: 'Bouchons', action: 'bison' },
                { key: 'accidents', label: 'Accidents en cours', action: 'bison' }
            ]
        },
        {
            id: 'mobility',
            title: 'Véloroutes & chantiers',
            tiles: [
                { key: 'structurantes', label: 'Segments structurants', action: 'bicycle' },
                { key: 'local', label: 'Segments réseau local', action: 'bicycle' },
                { key: 'constructionSplit', label: 'Chantiers / projets', action: 'construction', wide: true }
            ]
        },
        {
            id: 'quality',
            title: 'Qualité des données',
            tiles: [
                { key: 'wikidataPct', label: 'Routes liées Wikidata', action: 'quality' },
                { key: 'relationPct', label: 'Routes avec relation OSM', action: 'quality' },
                { key: 'segments', label: 'Tronçons OSM', action: 'quality' }
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

    function vintageForSection(sectionId, vintages) {
        const map = {
            network: vintages.osm,
            traffic: vintages.traffic,
            safety: vintages.accidents,
            realtime: vintages.bisonFute,
            mobility: vintages.osm,
            quality: vintages.osm
        };
        return map[sectionId] || '';
    }

    function renderDashboard() {
        const container = document.getElementById('dashboardContent');
        if (!container) return;

        const metrics = window.dashboardMetrics;
        const sectionsHtml = DASHBOARD_SECTIONS.map(section => {
            const vintage = vintageForSection(section.id, metrics.vintages || {});
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
                    <button type="button" class="dashboard-tile${wideClass}" data-dashboard-action="${tile.action || ''}" title="Afficher sur la carte">
                        <div class="dashboard-tile-value">${value}</div>
                        <div class="dashboard-tile-label">${tile.label}</div>
                    </button>
                `;
            }).join('');

            return `
                <section class="dashboard-section">
                    <div class="dashboard-section-head">
                        <h3>${section.title}</h3>
                        ${vintage ? `<span class="dashboard-vintage">${vintage}</span>` : ''}
                    </div>
                    <div class="dashboard-grid">${tilesHtml}</div>
                </section>
            `;
        }).join('');

        const weather = metrics.weather;
        const weatherBlock = weather ? `
            <section class="dashboard-section dashboard-section-weather">
                <div class="dashboard-section-head">
                    <h3>Météo · Avignon</h3>
                    <span class="dashboard-vintage">${metrics.vintages.weather || 'Temps réel'}</span>
                </div>
                <div class="dashboard-weather">
                    <span class="dashboard-weather-icon">${weather.icon || '⏳'}</span>
                    <span class="dashboard-weather-temp">${weather.temp != null ? `${weather.temp}°C` : '—'}</span>
                    <span class="dashboard-weather-desc">${weather.desc || ''}</span>
                </div>
            </section>
        ` : '';

        container.innerHTML = `
            <p class="dashboard-intro">
                Synthèse des indicateurs clés du Vaucluse (84). Chaque tuile indique son millésime ou sa fraîcheur.
                Cliquez une tuile pour afficher la couche correspondante sur la carte.
            </p>
            ${sectionsHtml}
            ${weatherBlock}
            <p class="dashboard-footnote">
                Phase 2 prévue&nbsp;: filtres par agence routière, centre routier, EPCI et commune
                (<a href="docs/phase2-territorial-dashboard.md" target="_blank" rel="noopener">spec</a>).
            </p>
        `;

        container.querySelectorAll('[data-dashboard-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                handleDashboardTileClick(btn.dataset.dashboardAction);
            });
        });
    }

    function handleDashboardTileClick(action) {
        if (!action) return;

        window.toggleDashboardPanel(false);

        function layerHidden(iconId) {
            const icon = document.getElementById(iconId);
            return !icon || icon.classList.contains('is-hidden');
        }

        switch (action) {
            case 'hierarchy':
                if (layerHidden('hierarchyToggleIcon') && typeof window.toggleAllHierarchy === 'function') {
                    window.toggleAllHierarchy();
                }
                break;
            case 'traffic':
                if (layerHidden('trafficToggleIcon') && typeof window.toggleTraffic === 'function') {
                    window.toggleTraffic();
                }
                if (!document.getElementById('wazeBtn')?.classList.contains('is-active') && typeof window.toggleWazeTraffic === 'function') {
                    window.toggleWazeTraffic();
                }
                break;
            case 'accidents':
                if (layerHidden('accidentToggleIcon') && typeof window.toggleAccidents === 'function') {
                    window.toggleAccidents();
                }
                break;
            case 'bison':
                if (layerHidden('bisonFuteToggleIcon') && typeof window.toggleBisonFute === 'function') {
                    window.toggleBisonFute();
                }
                break;
            case 'bicycle':
                if (layerHidden('bicycleToggleIcon') && typeof window.toggleBicycleRoutes === 'function') {
                    window.toggleBicycleRoutes();
                }
                break;
            case 'construction':
                if (layerHidden('constructionToggleIcon') && typeof window.toggleConstruction === 'function') {
                    window.toggleConstruction();
                }
                break;
            case 'quality':
                if (typeof window.calculateQualityMetrics === 'function') window.calculateQualityMetrics();
                if (typeof window.toggleQualityPanel === 'function') {
                    const panel = document.getElementById('qualityPanel');
                    if (panel && !panel.classList.contains('active')) window.toggleQualityPanel();
                }
                break;
            default:
                break;
        }
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
