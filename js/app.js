        /**
         * @file dataroads-FR84 map application.
         * @description Leaflet-based interactive map for the Vaucluse departmental
         *   road network. Layers, legend, freshness badges, OSM quality panel, and
         *   popups. UI strings are in French (CD84 target audience).
         * @requires APP_CONFIG
         * @requires InforouteApi
         * @see https://github.com/thepriben/dataroads-FR84
         */

        // Global functions exposed to inline HTML handlers

        // Shared eye icons for family (rubrique) and layer (couche) visibility toggles.
        const EYE_OPEN_SVG = '<svg class="eye-glyph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1.5 12s4.6-7.5 10.5-7.5S22.5 12 22.5 12 17.9 19.5 12 19.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>';
        const EYE_PARTIAL_SVG = '<svg class="eye-glyph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1.5 12s4.6-7.5 10.5-7.5S22.5 12 22.5 12 17.9 19.5 12 19.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" opacity="0.45"/><path d="M8 12h8"/></svg>';
        const EYE_CLOSED_SVG = '<svg class="eye-glyph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

        function setToggleIcon(iconElement, visible, options = {}) {
            if (!iconElement) return;
            const { family = false, partial = false } = options;
            const isPartial = partial && visible;
            iconElement.innerHTML = !visible ? EYE_CLOSED_SVG : (isPartial ? EYE_PARTIAL_SVG : EYE_OPEN_SVG);
            iconElement.classList.toggle('is-hidden', !visible);
            iconElement.classList.toggle('is-partial', isPartial);
            iconElement.classList.toggle('is-open', visible && !isPartial);
            iconElement.dataset.visState = !visible ? 'closed' : (isPartial ? 'partial' : 'open');

            const isFamilyEyeGlyph = family && iconElement.classList.contains('family-eye-icon');
            if (iconElement.tagName === 'BUTTON' || isFamilyEyeGlyph) {
                iconElement.removeAttribute('role');
                if (isFamilyEyeGlyph) {
                    iconElement.setAttribute('aria-hidden', 'true');
                }
            } else {
                iconElement.setAttribute('role', family ? 'button' : 'img');
            }

            if (family && !isFamilyEyeGlyph) {
                const stateLabel = isPartial
                    ? 'Rubrique partiellement visible'
                    : (visible ? 'Rubrique visible' : 'Rubrique masquée');
                iconElement.setAttribute('aria-label', `${stateLabel} (cliquer pour ${visible ? 'tout masquer' : 'tout afficher'})`);
            } else if (!family) {
                const stateLabel = isPartial
                    ? 'Couche partiellement visible'
                    : (visible ? 'Couche visible' : 'Couche masquée');
                iconElement.setAttribute('aria-label', stateLabel);
                iconElement.setAttribute('title', visible
                    ? (isPartial ? 'Couche partiellement visible — cliquer pour masquer' : 'Couche visible — cliquer pour masquer')
                    : 'Couche masquée — cliquer pour afficher');
            }
        }

        function initLayerToggleIcons() {
            document.querySelectorAll('.layer-toggle-icon[id]').forEach(icon => {
                setToggleIcon(icon, !icon.classList.contains('is-hidden'));
            });
        }

        // ========== FRESHNESS BADGES (integration date + next refresh) ==========

        const FRESHNESS_SCHEDULES = {
            osm: {
                label: 'Bi-hebdo — lun. & jeu. 03:17 UTC',
                source: 'OpenStreetMap via Overpass',
                cron: '17 3 * * 1,4',
                intervalMs: 4 * 24 * 60 * 60 * 1000
            },
            wikidata: {
                label: 'Bi-hebdo — lun. & jeu. 03:17 UTC',
                source: 'Liens Wikidata issus du cache OSM',
                cron: '17 3 * * 1,4',
                intervalMs: 3.5 * 24 * 60 * 60 * 1000
            },
            external: {
                label: 'Toutes les 3 h — à xx:23 UTC',
                source: 'data.gouv.fr & Bison Futé',
                cron: '23 */3 * * *',
                intervalMs: 3 * 60 * 60 * 1000
            },
            incubator: {
                label: 'Bi-hebdo (lun. & jeu.)',
                source: 'Couche ponts OSM (workflow OSM GeoJSON)',
                cron: '17 3 * * 1,4',
                intervalMs: 3.5 * 24 * 60 * 60 * 1000
            },
            hourly: {
                label: 'Toutes les heures — à xx:41 UTC',
                source: 'Augmented diff OpenStreetMap via Overpass',
                cron: '41 * * * *',
                intervalMs: 60 * 60 * 1000
            },
            static: {
                label: 'Figé dans le dépôt — mise à jour manuelle',
                source: 'Snapshot versionné (BAAC / OSM)'
            },
            live: {
                label: 'Toutes les 10 min — directement dans le navigateur',
                source: 'Open-Meteo (live)',
                intervalMs: 10 * 60 * 1000
            }
        };

        function parseCronField(field, min, max) {
            if (field === '*') {
                const out = [];
                for (let i = min; i <= max; i++) out.push(i);
                return out;
            }
            if (field.startsWith('*/')) {
                const step = Number.parseInt(field.slice(2), 10) || 1;
                const out = [];
                for (let i = min; i <= max; i += step) out.push(i);
                return out;
            }
            return field
                .split(',')
                .map(value => Number.parseInt(value, 10))
                .filter(Number.isFinite);
        }

        // Compute the next UTC occurrence matching a 5-field cron expression.
        // Only supports the patterns we use (`23 */3 * * *`, `17 3 * * 1,4`).
        function nextCronUtc(cronExpr, from = new Date()) {
            const parts = cronExpr.trim().split(/\s+/);
            if (parts.length !== 5) return null;
            const minutes = parseCronField(parts[0], 0, 59);
            const hours = parseCronField(parts[1], 0, 23);
            const doms = parseCronField(parts[2], 1, 31);
            const months = parseCronField(parts[3], 1, 12);
            const dows = parseCronField(parts[4], 0, 6);

            const candidate = new Date(from.getTime() + 60000);
            candidate.setUTCSeconds(0, 0);

            for (let i = 0; i < 366 * 24 * 60; i++) {
                if (
                    minutes.includes(candidate.getUTCMinutes()) &&
                    hours.includes(candidate.getUTCHours()) &&
                    doms.includes(candidate.getUTCDate()) &&
                    months.includes(candidate.getUTCMonth() + 1) &&
                    dows.includes(candidate.getUTCDay())
                ) {
                    return candidate;
                }
                candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
            }
            return null;
        }

        function formatRelativeDuration(ms, opts = {}) {
            const future = !!opts.future;
            if (future && ms <= 0) return 'imminent';
            const abs = Math.abs(ms);
            const prefix = future ? 'dans ' : 'il y a ';
            if (abs < 60000) return future ? 'imminent' : "à l'instant";
            const minutes = Math.round(abs / 60000);
            if (minutes < 60) return `${prefix}${minutes} min`;
            const hours = Math.floor(minutes / 60);
            const remMin = minutes % 60;
            if (hours < 24) return `${prefix}${hours}h${remMin > 0 ? String(remMin).padStart(2, '0') : ''}`;
            const days = Math.floor(hours / 24);
            const remH = hours % 24;
            return `${prefix}${days}j${remH > 0 ? ` ${remH}h` : ''}`;
        }

        function freshnessState(generatedAtMs, scheduleConfig) {
            if (!scheduleConfig.intervalMs) {
                return { status: 'static' };
            }
            if (!generatedAtMs) {
                return { status: 'unknown' };
            }
            const ageMs = Date.now() - generatedAtMs;
            const interval = scheduleConfig.intervalMs;
            if (ageMs <= interval * 1.15) return { status: 'fresh' };
            if (ageMs <= interval * 2) return { status: 'late' };
            return { status: 'stale' };
        }

        const latestCacheByGroup = {};

        function updateRefreshFormulaCell(scheduleKey) {
            const config = FRESHNESS_SCHEDULES[scheduleKey];
            if (!config) return;
            const cellId = 'refreshMeta' + scheduleKey.charAt(0).toUpperCase() + scheduleKey.slice(1);
            const cell = document.getElementById(cellId);
            if (!cell) return;

            const generatedAt = latestCacheByGroup[scheduleKey];
            const lines = [];

            if (scheduleKey === 'osm' || scheduleKey === 'wikidata') {
                lines.push('Bi-hebdo · lun. & jeu. 03:17 UTC');
            } else if (scheduleKey === 'external') {
                lines.push('Toutes les 3 h · xx:23 UTC');
            } else if (scheduleKey === 'incubator') {
                lines.push('Bi-hebdo · lun. & jeu. 03:17 UTC');
            }

            if (config.cron) {
                const next = nextCronUtc(config.cron);
                if (generatedAt) {
                    const age = formatRelativeDuration(Date.now() - new Date(generatedAt).getTime());
                    const nextLabel = next
                        ? `prochain ${formatRelativeDuration(next.getTime() - Date.now(), { future: true })}`
                        : '';
                    lines.push(`${age} · ${nextLabel}`);
                } else if (next) {
                    lines.push(`prochain ${formatRelativeDuration(next.getTime() - Date.now(), { future: true })}`);
                }
            }

            cell.innerHTML = lines.join('<br>');
        }

        function renderFreshnessBadge(element, { generatedAt, scheduleKey, errorMsg, layerVisible } = {}) {
            if (!element) return;
            const config = FRESHNESS_SCHEDULES[scheduleKey] || {};
            const generatedAtMs = generatedAt ? new Date(generatedAt).getTime() : null;
            let status = freshnessState(generatedAtMs, config).status;

            if (generatedAt && config.cron) {
                const current = latestCacheByGroup[scheduleKey];
                if (!current || new Date(generatedAt).getTime() > new Date(current).getTime()) {
                    latestCacheByGroup[scheduleKey] = generatedAt;
                    updateRefreshFormulaCell(scheduleKey);
                }
            }

            const ageText = generatedAtMs
                ? formatRelativeDuration(Date.now() - generatedAtMs)
                : (scheduleKey === 'static' ? 'snapshot' : '—');

            let nextText = '';
            const scheduleAnchorMs = Math.max(Date.now(), generatedAtMs || 0);
            if (config.cron) {
                const next = nextCronUtc(config.cron, new Date(scheduleAnchorMs));
                if (next) {
                    const delta = next.getTime() - Date.now();
                    if (delta > 0) {
                        nextText = ` • prochain ${formatRelativeDuration(delta, { future: true })}`;
                    }
                }
            } else if (config.intervalMs && generatedAtMs) {
                let nextMs = generatedAtMs + config.intervalMs;
                while (nextMs <= Date.now()) {
                    nextMs += config.intervalMs;
                }
                nextText = ` • prochain ${formatRelativeDuration(nextMs - Date.now(), { future: true })}`;
            }

            element.classList.add('freshness-badge');
            element.dataset.scheduleKey = scheduleKey || '';
            if (generatedAt) element.dataset.generatedAt = generatedAt;
            if (errorMsg) element.dataset.errorMsg = errorMsg; else delete element.dataset.errorMsg;

            const tooltipLines = [
                config.label || '',
                config.source ? `Source\u00a0: ${config.source}` : '',
                generatedAt ? `Intégré le ${formatParisDateTime(generatedAt)}` : '',
                errorMsg ? `Erreur\u00a0: ${errorMsg}` : ''
            ].filter(Boolean);
            element.title = tooltipLines.join('\n');

            if (layerVisible === undefined && element.id && typeof isFreshnessBadgeLayerVisible === 'function') {
                layerVisible = isFreshnessBadgeLayerVisible(element.id);
            } else if (layerVisible === undefined) {
                layerVisible = element.dataset.layerVisible !== 'false';
            }

            element.dataset.layerVisible = layerVisible ? 'true' : 'false';
            const layerHidden = !layerVisible;

            if (layerHidden) {
                status = 'hidden';
            } else if (!config.intervalMs && generatedAtMs) {
                status = 'static';
            }

            const errorIcon = errorMsg ? '<span class="freshness-error-icon" aria-hidden="true">⚠</span>' : '';
            const pillClasses = ['freshness-pill', `freshness-pill--${status}`];
            if (errorMsg) pillClasses.push('freshness-pill--error');
            element.classList.toggle('is-layer-hidden', layerHidden);
            element.innerHTML = `<span class="${pillClasses.join(' ')}"><span class="freshness-dot" aria-hidden="true"></span>${ageText}${nextText}${errorIcon}</span>`;
        }

        function refreshAllBadges() {
            document.querySelectorAll('.freshness-badge').forEach(el => {
                const scheduleKey = el.dataset.scheduleKey;
                const generatedAt = el.dataset.generatedAt;
                const errorMsg = el.dataset.errorMsg;
                if (scheduleKey) {
                    renderFreshnessBadge(el, { generatedAt, scheduleKey, errorMsg });
                }
            });
            Object.keys(FRESHNESS_SCHEDULES).forEach(updateRefreshFormulaCell);
            if (typeof syncLegendChrome === 'function') {
                syncLegendChrome();
            }
        }

        window.setInterval(refreshAllBadges, 60000);

        // Initial render so the bottom panel shows the cron formulas right away.
        document.addEventListener('DOMContentLoaded', () => {
            Object.keys(FRESHNESS_SCHEDULES).forEach(updateRefreshFormulaCell);
            document.querySelectorAll('.freshness-badge').forEach(el => {
                const scheduleKey = el.dataset.scheduleKey;
                if (scheduleKey) renderFreshnessBadge(el, { scheduleKey });
            });
        });

        // ========== SIDEBAR SECTION FAMILIES (collapsible) ==========

        function syncFreshnessBadgeVisibility() {
            document.querySelectorAll('.freshness-badge[id]').forEach(element => {
                const layerVisible = isFreshnessBadgeLayerVisible(element.id);
                element.dataset.layerVisible = layerVisible ? 'true' : 'false';
                renderFreshnessBadge(element, {
                    generatedAt: element.dataset.generatedAt,
                    scheduleKey: element.dataset.scheduleKey,
                    errorMsg: element.dataset.errorMsg || undefined
                });
            });
        }

        function syncLayerToggleIconsFromState() {
            const hierarchyIcon = document.getElementById('hierarchyToggleIcon');
            if (hierarchyIcon) {
                const allVisible = hierarchyVisibility.regional
                    && hierarchyVisibility.territorial
                    && hierarchyVisibility.local;
                const anyVisible = hierarchyVisibility.regional
                    || hierarchyVisibility.territorial
                    || hierarchyVisibility.local;
                setToggleIcon(hierarchyIcon, anyVisible, { partial: anyVisible && !allVisible });
            }

            const layerStates = [
                ['constructionToggleIcon', constructionVisible],
                ['bicycleToggleIcon', bicycleVisible],
                ['citiesToggleIcon', citiesVisible],
                ['accidentToggleIcon', accidentsVisible],
                ['trafficToggleIcon', trafficVisible],
                ['weatherStationsToggleIcon', weatherStationsVisible],
                ['bisonFuteToggleIcon', bisonFuteVisible],
                ['bridgesToggleIcon', bridgeVisible],
                ['roadSignsToggleIcon', roadSignsVisible],
                ['guidepostsToggleIcon', guidepostsVisible],
                ['cityLimitsToggleIcon', cityLimitsVisible],
                ['latestChangesToggleIcon', latestChangesVisible],
                ['sensitiveZonesToggleIcon', sensitiveZonesVisible],
                ['inaturalistSensitivesToggleIcon', inaturalistSensitivesVisible],
                ['webcamsToggleIcon', webcamsVisible],
                ['roadsideAreasToggleIcon', roadsideAreasVisible],
                ['oedbEventsToggleIcon', oedbEventsVisible]
            ];

            layerStates.forEach(([id, visible]) => {
                const icon = document.getElementById(id);
                if (icon) {
                    icon.style.opacity = '';
                    setToggleIcon(icon, visible);
                }
            });
        }

        function syncLegendChrome() {
            syncFreshnessBadgeVisibility();
            syncLayerToggleIconsFromState();
            document.querySelectorAll('.legend-family').forEach(refreshFamilyMeta);
            scheduleAppUrlSync();
        }

        function refreshFamilyMeta(fam) {
            if (!fam) return;
            const visBtn = fam.querySelector('.legend-family-vis');
            if (!visBtn) return;

            const counts = getFamilyLayerCounts(fam.dataset.family);
            if (!counts) {
                visBtn.hidden = true;
                return;
            }

            visBtn.hidden = false;
            const { visible, total } = counts;
            const anyVisible = visible > 0;
            const partial = anyVisible && visible < total;
            const label = visible > 1 ? 'couches visibles' : 'couche visible';
            const eye = visBtn.querySelector('.family-eye-icon');
            const countEl = visBtn.querySelector('.family-vis-count');

            setToggleIcon(eye, anyVisible, { family: true, partial });
            if (countEl) {
                countEl.innerHTML = `<strong>${visible}</strong><span class="family-vis-sep">/</span>${total}`;
            }

            const action = anyVisible ? 'tout masquer' : 'tout afficher';
            const stateLabel = partial
                ? 'Rubrique partiellement visible'
                : (anyVisible ? 'Rubrique visible' : 'Rubrique masquée');
            visBtn.setAttribute('title', `${visible} ${label} sur ${total} — cliquer pour ${action}`);
            visBtn.setAttribute('aria-label', `${stateLabel} — ${visible}/${total} — cliquer pour ${action}`);
        }

        function ensureHierarchyVisibility(targetVisible) {
            const allVisible = hierarchyVisibility.regional && hierarchyVisibility.territorial && hierarchyVisibility.local;
            const anyVisible = hierarchyVisibility.regional || hierarchyVisibility.territorial || hierarchyVisibility.local;
            if (targetVisible && !allVisible) {
                hierarchyVisibility.regional = true;
                hierarchyVisibility.territorial = true;
                hierarchyVisibility.local = true;
                if (typeof window.updateHierarchyDisplay === 'function') window.updateHierarchyDisplay();
            } else if (!targetVisible && anyVisible) {
                hierarchyVisibility.regional = false;
                hierarchyVisibility.territorial = false;
                hierarchyVisibility.local = false;
                if (typeof window.updateHierarchyDisplay === 'function') window.updateHierarchyDisplay();
            }
        }

        function ensureLayerToggle(isVisible, toggleFn) {
            if (typeof toggleFn !== 'function' || isVisible === undefined) return;
            if (isVisible) return;
            toggleFn();
        }

        function ensureLayerOff(isVisible, toggleFn) {
            if (typeof toggleFn !== 'function' || isVisible === undefined) return;
            if (!isVisible) return;
            toggleFn();
        }

        function setFamilyVisibility(familyId, targetVisible) {
            switch (familyId) {
                case 'factual':
                    ensureHierarchyVisibility(targetVisible);
                    if (targetVisible) {
                        ensureLayerToggle(constructionVisible, window.toggleConstruction);
                        ensureLayerToggle(bicycleVisible, window.toggleBicycleRoutes);
                        ensureLayerToggle(citiesVisible, window.toggleCities);
                        ensureLayerToggle(roadsideAreasVisible, window.toggleRoadsideAreas);
                        const limitationsLegend = document.getElementById('limitationsLegend');
                        if (limitationsLegend && limitationsLegend.style.display !== 'none') {
                            ensureLayerToggle(limitationsMode, window.toggleLimitationsMode);
                        }
                    } else {
                        ensureLayerOff(constructionVisible, window.toggleConstruction);
                        ensureLayerOff(bicycleVisible, window.toggleBicycleRoutes);
                        ensureLayerOff(citiesVisible, window.toggleCities);
                        ensureLayerOff(roadsideAreasVisible, window.toggleRoadsideAreas);
                        ensureLayerOff(limitationsMode, window.toggleLimitationsMode);
                    }
                    break;
                case 'stats':
                    if (targetVisible) {
                        ensureLayerToggle(accidentsVisible, window.toggleAccidents);
                        ensureLayerToggle(trafficVisible, window.toggleTraffic);
                    } else {
                        ensureLayerOff(accidentsVisible, window.toggleAccidents);
                        ensureLayerOff(trafficVisible, window.toggleTraffic);
                    }
                    break;
                case 'realtime':
                    if (targetVisible) {
                        ensureLayerToggle(bisonFuteVisible, window.toggleBisonFute);
                        ensureLayerToggle(weatherStationsVisible, window.toggleWeatherStations);
                    } else {
                        ensureLayerOff(bisonFuteVisible, window.toggleBisonFute);
                        ensureLayerOff(weatherStationsVisible, window.toggleWeatherStations);
                    }
                    break;
                case 'incubator':
                    if (targetVisible) {
                        ensureLayerToggle(bridgeVisible, window.toggleBridges);
                        ensureLayerToggle(roadSignsVisible, window.toggleRoadSigns);
                        ensureLayerToggle(guidepostsVisible, window.toggleGuideposts);
                        ensureLayerToggle(cityLimitsVisible, window.toggleCityLimits);
                        ensureLayerToggle(latestChangesVisible, window.toggleLatestChanges);
                        ensureLayerToggle(sensitiveZonesVisible, window.toggleSensitiveZones);
                        ensureLayerToggle(inaturalistSensitivesVisible, window.toggleInaturalistSensitives);
                        ensureLayerToggle(webcamsVisible, window.toggleWebcams);
                        ensureLayerToggle(oedbEventsVisible, window.toggleOedbEvents);
                    } else {
                        ensureLayerOff(bridgeVisible, window.toggleBridges);
                        ensureLayerOff(roadSignsVisible, window.toggleRoadSigns);
                        ensureLayerOff(guidepostsVisible, window.toggleGuideposts);
                        ensureLayerOff(cityLimitsVisible, window.toggleCityLimits);
                        ensureLayerOff(latestChangesVisible, window.toggleLatestChanges);
                        ensureLayerOff(sensitiveZonesVisible, window.toggleSensitiveZones);
                        ensureLayerOff(inaturalistSensitivesVisible, window.toggleInaturalistSensitives);
                        ensureLayerOff(webcamsVisible, window.toggleWebcams);
                        ensureLayerOff(oedbEventsVisible, window.toggleOedbEvents);
                    }
                    break;
                default:
                    break;
            }
            syncLegendChrome();
            if (!suppressAppUrlSync) syncAppUrlState();
        }

        function toggleFamilyVisibility(familyId) {
            const counts = getFamilyLayerCounts(familyId);
            if (!counts) return;
            setFamilyVisibility(familyId, counts.visible === 0);
        }

        const LAYER_FAMILIES = ['factual', 'stats', 'realtime', 'incubator'];

        function expandLegendFamily(familyId) {
            const fam = document.querySelector(`.legend-family[data-family="${familyId}"]`);
            if (!fam) return;
            fam.dataset.expanded = 'true';
            fam.querySelector('.legend-family-expand')?.setAttribute('aria-expanded', 'true');
            fam.querySelector('.legend-family-chevron-btn')?.setAttribute('aria-expanded', 'true');
            fam.scrollIntoView({ block: 'nearest' });
        }

        // Chaque thématique des chiffres clés a sa couche : lire « 1 923
        // accidents » donne envie de les voir, autant y aller d'un clic plutôt
        // que de refermer le panneau et de chercher la bonne ligne de légende.
        const DASHBOARD_THEMES = {
            network: {
                family: 'factual',
                show: () => ensureHierarchyVisibility(true)
            },
            traffic: {
                family: 'stats',
                show: () => ensureLayerToggle(trafficVisible, window.toggleTraffic)
            },
            safety: {
                family: 'stats',
                show: () => ensureLayerToggle(accidentsVisible, window.toggleAccidents)
            },
            live: {
                family: 'realtime',
                show: () => ensureLayerToggle(bisonFuteVisible, window.toggleBisonFute)
            },
            mobility: {
                family: 'factual',
                show: () => {
                    ensureLayerToggle(bicycleVisible, window.toggleBicycleRoutes);
                    ensureLayerToggle(constructionVisible, window.toggleConstruction);
                }
            },
            // La qualité ne se peint pas sur la carte : son rapport tient lieu
            // de destination.
            quality: {
                family: 'tools',
                panel: () => {
                    const panel = document.getElementById('qualityPanel');
                    if (panel && !panel.classList.contains('active')) window.toggleQualityPanel();
                }
            }
        };

        window.focusDashboardTheme = function focusDashboardTheme(themeKey) {
            const theme = DASHBOARD_THEMES[themeKey];
            if (!theme) return;

            if (theme.show) {
                // Le raccourci est exclusif : on repart d'une carte nette pour
                // que le thème demandé s'y lise seul.
                suppressAppUrlSync = true;
                LAYER_FAMILIES.forEach(family => setFamilyVisibility(family, false));
                theme.show();
                suppressAppUrlSync = false;
                syncLegendChrome();
                scheduleAppUrlSync();
            }
            if (theme.panel) theme.panel();

            expandLegendFamily(theme.family);
            if (typeof window.toggleDashboardPanel === 'function') window.toggleDashboardPanel(false);
        };

        function setupLegendFamilies() {
            document.querySelectorAll('.legend-family').forEach(fam => {
                refreshFamilyMeta(fam);
                const expandBtn = fam.querySelector('.legend-family-expand');
                const chevronBtn = fam.querySelector('.legend-family-chevron-btn');
                const familyVisBtn = fam.querySelector('.legend-family-vis');

                const toggleExpanded = () => {
                    const isExpanded = fam.dataset.expanded !== 'false';
                    const nextExpanded = !isExpanded;
                    fam.dataset.expanded = nextExpanded ? 'true' : 'false';
                    const expandedValue = String(nextExpanded);
                    expandBtn?.setAttribute('aria-expanded', expandedValue);
                    chevronBtn?.setAttribute('aria-expanded', expandedValue);
                };

                expandBtn?.addEventListener('click', toggleExpanded);
                chevronBtn?.addEventListener('click', toggleExpanded);

                if (familyVisBtn) {
                    familyVisBtn.addEventListener('click', (event) => {
                        event.stopPropagation();
                        toggleFamilyVisibility(fam.dataset.family);
                    });
                }
            });

            // When the "Limitations" section becomes visible/hidden dynamically,
            // refresh the "factual" family counter.
            const limitations = document.getElementById('limitationsLegend');
            if (limitations && typeof MutationObserver !== 'undefined') {
                const observer = new MutationObserver(() => {
                    syncLegendChrome();
                });
                observer.observe(limitations, { attributes: true, attributeFilter: ['style'] });
            }
            const roadInfo = document.getElementById('road-info-section');
            if (roadInfo && typeof MutationObserver !== 'undefined') {
                const observer = new MutationObserver(() => {
                    syncLegendChrome();
                });
                observer.observe(roadInfo, { attributes: true, attributeFilter: ['style'] });
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            initLayerToggleIcons();
            setupLegendFamilies();
            syncLegendChrome();
        });

        // ========== WIKIDATA INFOBOX (dedicated tab in route popup) ==========

        const WIKIDATA_INFOBOX_CACHE = new Map();

        // Wikidata properties highlighted in the infobox, in display order.
        const WIKIDATA_PROPS_TO_DISPLAY = [
            { id: 'P31',   label: 'Nature' },
            { id: 'P17',   label: 'Pays' },
            { id: 'P131',  label: 'Localisation' },
            { id: 'P1813', label: 'Nom abrégé' },
            { id: 'P2043', label: 'Longueur' },
            { id: 'P126',  label: 'Gestionnaire' },
            { id: 'P137',  label: 'Opérateur' },
            { id: 'P16',   label: 'Système routier' },
            { id: 'P1622', label: 'Sens de circulation' },
            { id: 'P571',  label: 'Date de création' },
            { id: 'P729',  label: 'Mise en service' },
            { id: 'P1619', label: 'Date d\'ouverture' }
        ];

        const WIKIDATA_SHIELD_PROPS = ['P1766', 'P154'];
        const WIKIDATA_IMAGE_PROPS = ['P18'];

        function commonsImageUrl(filename, width = 400) {
            return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=${width}`;
        }

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        async function fetchWikidataItem(qid) {
            const url = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`;
            const response = await fetch(url, { credentials: 'omit' });
            if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
            const data = await response.json();
            return data.entities ? data.entities[qid] : null;
        }

        async function fetchWikidataLabels(qids) {
            if (!qids.length) return {};
            const params = new URLSearchParams({
                action: 'wbgetentities',
                ids: qids.slice(0, 50).join('|'),
                format: 'json',
                languages: 'fr|en',
                props: 'labels',
                origin: '*'
            });
            const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`, { credentials: 'omit' });
            if (!response.ok) throw new Error(`Wikidata labels HTTP ${response.status}`);
            const data = await response.json();
            const out = {};
            Object.entries(data.entities || {}).forEach(([id, entity]) => {
                out[id] = entity.labels?.fr?.value || entity.labels?.en?.value || id;
            });
            return out;
        }

        async function fetchWikipediaSummary(title) {
            try {
                const url = `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
                const response = await fetch(url, { credentials: 'omit' });
                if (!response.ok) return null;
                return await response.json();
            } catch {
                return null;
            }
        }

        function extractWikidataValues(entity) {
            const claims = entity.claims || {};
            const out = {};
            Object.keys(claims).forEach(propId => {
                out[propId] = claims[propId]
                    .filter(s => s.rank !== 'deprecated' && s.mainsnak?.snaktype === 'value')
                    .map(s => ({ value: s.mainsnak.datavalue.value, type: s.mainsnak.datavalue.type }));
            });
            return out;
        }

        function formatWikidataValuePlain(item, labels) {
            if (item.type === 'wikibase-entityid' && item.value.id) {
                return escapeHtml(labels[item.value.id] || item.value.id);
            }
            if (item.type === 'quantity') {
                const amount = item.value.amount.replace(/^\+/, '');
                const unitUrl = item.value.unit;
                const unitLabel = unitUrl && unitUrl !== '1' ? ' ' + (labels[unitUrl.split('/').pop()] || '') : '';
                return `${amount}${unitLabel}`;
            }
            if (item.type === 'time') {
                return item.value.time.replace(/^\+/, '').slice(0, 10);
            }
            if (item.type === 'monolingualtext') return escapeHtml(item.value.text);
            if (item.type === 'string') return escapeHtml(item.value);
            if (item.type === 'globecoordinate') {
                return `${item.value.latitude.toFixed(5)}, ${item.value.longitude.toFixed(5)}`;
            }
            return '—';
        }

        function firstCommonsFilename(claims, propIds) {
            for (const propId of propIds) {
                const filename = claims[propId]?.[0]?.value;
                if (typeof filename === 'string' && filename.trim()) return filename.trim();
            }
            return null;
        }

        function attachRoutePopupInfobox(polyline) {
            polyline.on('popupopen', () => {
                const popupEl = polyline.getPopup()?.getElement();
                if (!popupEl) return;
                const host = popupEl.querySelector('.popup-infobox-host');
                if (!host || host.dataset.loaded === '1') return;
                host.dataset.loaded = '1';
                const qid = host.dataset.qid;
                const containerId = host.id;
                if (qid && containerId) loadWikidataInfobox(qid, containerId);
            });
        }

        async function loadWikidataInfobox(qid, containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;

            if (WIKIDATA_INFOBOX_CACHE.has(qid)) {
                container.innerHTML = WIKIDATA_INFOBOX_CACHE.get(qid);
                return;
            }

            container.innerHTML = `<div class="popup-infobox-loading">Chargement de l'infobox…</div>`;

            try {
                const entity = await fetchWikidataItem(qid);
                if (!entity) throw new Error('Entité introuvable');

                const labelFr = entity.labels?.fr?.value || entity.labels?.en?.value || qid;
                const descriptionFr = entity.descriptions?.fr?.value || entity.descriptions?.en?.value || '';
                const claims = extractWikidataValues(entity);

                const entityIds = new Set();
                WIKIDATA_PROPS_TO_DISPLAY.forEach(prop => {
                    (claims[prop.id] || []).forEach(c => {
                        if (c.type === 'wikibase-entityid' && c.value.id) entityIds.add(c.value.id);
                        if (c.type === 'quantity' && c.value.unit && c.value.unit !== '1') {
                            const id = c.value.unit.split('/').pop();
                            if (id?.startsWith('Q')) entityIds.add(id);
                        }
                    });
                });

                const labels = entityIds.size ? await fetchWikidataLabels([...entityIds]).catch(() => ({})) : {};

                const shieldFilename = firstCommonsFilename(claims, WIKIDATA_SHIELD_PROPS);
                const illustrationFilename = shieldFilename
                    ? null
                    : firstCommonsFilename(claims, WIKIDATA_IMAGE_PROPS);
                const shieldUrl = shieldFilename ? commonsImageUrl(shieldFilename, 220) : null;
                const illustrationUrl = illustrationFilename ? commonsImageUrl(illustrationFilename, 480) : null;

                const frWikiTitle = entity.sitelinks?.frwiki?.title;
                const wikipediaSummary = frWikiTitle ? await fetchWikipediaSummary(frWikiTitle) : null;

                const claimsRows = WIKIDATA_PROPS_TO_DISPLAY
                    .filter(prop => claims[prop.id]?.length)
                    .map(prop => {
                        const values = claims[prop.id]
                            .slice(0, 3)
                            .map(c => formatWikidataValuePlain(c, labels))
                            .join('<br>');
                        return `
                            <tr>
                                <td class="infobox-prop-label">${prop.label}</td>
                                <td class="infobox-prop-value">${values}</td>
                            </tr>
                        `;
                    }).join('');

                const html = `
                    <div class="wikidata-infobox">
                        ${shieldUrl ? `
                            <div class="infobox-shield-wrap">
                                <img class="infobox-shield" src="${shieldUrl}" alt="Panneau routier" loading="lazy">
                            </div>
                        ` : ''}
                        <div class="infobox-header">
                            <div class="infobox-header-text">
                                <div class="infobox-title">${escapeHtml(labelFr)}</div>
                                ${descriptionFr ? `<div class="infobox-description">${escapeHtml(descriptionFr)}</div>` : ''}
                            </div>
                            <span class="infobox-qid">${qid}</span>
                        </div>

                        ${illustrationUrl ? `
                            <img class="infobox-illustration" src="${illustrationUrl}" alt="" loading="lazy">
                        ` : ''}

                        ${wikipediaSummary?.extract ? `
                            <div class="infobox-extract">
                                ${escapeHtml(wikipediaSummary.extract.slice(0, 320))}${wikipediaSummary.extract.length > 320 ? '…' : ''}
                            </div>
                        ` : ''}

                        ${claimsRows ? `
                            <table class="infobox-table">
                                ${claimsRows}
                            </table>
                        ` : '<div class="infobox-empty">Aucune propriété structurée renseignée.</div>'}

                        <div class="infobox-source">Données issues de Wikidata</div>
                    </div>
                `;

                WIKIDATA_INFOBOX_CACHE.set(qid, html);
                container.innerHTML = html;
            } catch (error) {
                console.error('Wikidata infobox error:', error);
                container.innerHTML = `
                    <div class="infobox-error">
                        <strong>Infobox indisponible</strong><br>
                        <small>${escapeHtml(error.message)}</small>
                    </div>
                `;
            }
        }

        window.loadWikidataInfobox = loadWikidataInfobox;

        const hierarchyColors = {
            regional: '#E74C3C',
            territorial: '#F39C12',
            local: '#3498DB'
        };

        const hierarchyWeights = {
            regional: 6,
            territorial: 5,
            local: 4
        };

        function geoJsonLineFeatureToWay(feature) {
            if (!feature?.geometry || feature.geometry.type !== 'LineString') return null;

            const properties = { ...(feature.properties || {}) };
            const geometry = feature.geometry.coordinates
                .filter(coord => Array.isArray(coord) && coord.length >= 2)
                .map(([lon, lat]) => ({ lat, lon }));

            if (geometry.length < 2) return null;

            return {
                type: 'way',
                id: properties.osm_id,
                tags: properties,
                geometry,
                hasRelation: properties.has_relation === true,
                relationId: properties.relation_id,
                relationTags: properties.relation_tags || null
            };
        }

        function haversineKm(a, b) {
            const R = 6371;
            const toRad = d => d * Math.PI / 180;
            const dLat = toRad(b.lat - a.lat);
            const dLon = toRad(b.lng - a.lng);
            const lat1 = toRad(a.lat);
            const lat2 = toRad(b.lat);
            const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(h));
        }

        function wayLengthKmFromGeometry(geometry) {
            let total = 0;
            for (let i = 1; i < geometry.length; i++) {
                total += haversineKm(
                    { lat: geometry[i - 1].lat, lng: geometry[i - 1].lon },
                    { lat: geometry[i].lat, lng: geometry[i].lon }
                );
            }
            return total;
        }

        function geoJsonPolygonGeometryToLatLngRings(geometry) {
            if (!geometry) return [];

            if (geometry.type === 'Polygon') {
                const outerRing = geometry.coordinates?.[0] || [];
                return [outerRing.map(([lon, lat]) => [lat, lon])];
            }

            if (geometry.type === 'MultiPolygon') {
                return geometry.coordinates
                    .map(polygon => polygon?.[0] || [])
                    .filter(ring => ring.length > 0)
                    .map(ring => ring.map(([lon, lat]) => [lat, lon]));
            }

            return [];
        }

        function toggleQualityPanel() {
            const panel = document.getElementById('qualityPanel');
            const btn = document.getElementById('qualityBtn');

            panel.classList.toggle('active');

            if (panel.classList.contains('active')) {
                btn?.classList.add('is-active');
                if (!panel.dataset.loaded) {
                    if (typeof window.calculateQualityMetrics === 'function') {
                        window.calculateQualityMetrics();
                    }
                    panel.dataset.loaded = 'true';
                }
            } else {
                btn?.classList.remove('is-active');
            }
        }
        window.toggleQualityPanel = toggleQualityPanel;

        function formatDashboardCacheVintage(generatedAt, prefix) {
            if (!generatedAt) return prefix || '';
            try {
                const date = new Date(generatedAt);
                if (Number.isNaN(date.getTime())) return prefix || '';
                const label = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
                return prefix ? `${prefix} · ${label}` : label;
            } catch (_) {
                return prefix || '';
            }
        }

        function updateBisonFuteLegendCounts(eventsCount) {
            const mapping = [
                ['travaux', eventsCount.travaux],
                ['bouchons', eventsCount.bouchons],
                ['accidents', eventsCount.accidents]
            ];
            mapping.forEach(([key, value]) => {
                const el = document.querySelector(`[data-bison-fute="${key}"] .legend-count`);
                if (el) el.textContent = String(value);
            });
        }

        // === Map toolbar helpers ===
        // Each .map-tool carries data-accent="#xxxxxx" ; we mirror it into the
        // --map-tool-accent CSS var so the hover/active states pick the right hue.
        function setupMapToolbar() {
            document.querySelectorAll('.map-tool[data-accent]').forEach(btn => {
                btn.style.setProperty('--map-tool-accent', btn.dataset.accent);
            });
        }

        function setToolActive(btnId, active, options) {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            btn.classList.toggle('is-active', !!active);
            if (options && Object.prototype.hasOwnProperty.call(options, 'bounce')) {
                btn.classList.toggle('is-bounce', !!active && !!options.bounce);
            }
        }

        document.addEventListener('DOMContentLoaded', setupMapToolbar);

        // === Sidebar resizer (horizontal drag) ===
        // Lets the user widen/narrow the sidebar by dragging the
        // centre divider. Width is persisted in localStorage and
        // Leaflet is notified to redraw the map once dragging ends.
        function setupSidebarResizer() {
            const resizer = document.getElementById('sidebarResizer');
            const mainContent = document.querySelector('.main-content');
            if (!resizer || !mainContent) return;

            const MIN_WIDTH = 220;
            const MAX_WIDTH = 560;
            const COLLAPSE_WIDTH = 150;

            // Restore saved width
            try {
                const saved = Number.parseInt(localStorage.getItem('sidebarWidth') || '', 10);
                if (Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) {
                    mainContent.style.setProperty('--sidebar-width', `${saved}px`);
                }
            } catch (_) { /* localStorage unavailable (private mode) */ }

            let dragging = false;
            let pendingWidth = null;

            const onPointerMove = (event) => {
                if (!dragging) return;
                const rect = mainContent.getBoundingClientRect();
                const raw = event.clientX - rect.left;
                pendingWidth = raw;
                if (raw < COLLAPSE_WIDTH) {
                    mainContent.style.setProperty('--sidebar-width', `${MIN_WIDTH}px`);
                    return;
                }
                const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw));
                mainContent.style.setProperty('--sidebar-width', `${next}px`);
            };

            const onPointerUp = () => {
                if (!dragging) return;
                dragging = false;
                document.body.classList.remove('is-resizing');
                resizer.classList.remove('is-dragging');
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                if (pendingWidth != null && pendingWidth < COLLAPSE_WIDTH) {
                    if (typeof window.collapseSidebarPanel === 'function') {
                        window.collapseSidebarPanel();
                    }
                } else if (pendingWidth != null && pendingWidth >= MIN_WIDTH) {
                    try { localStorage.setItem('sidebarWidth', String(Math.round(Math.min(MAX_WIDTH, pendingWidth)))); } catch (_) {}
                }
                pendingWidth = null;
                if (window.map && typeof window.map.invalidateSize === 'function') {
                    window.map.invalidateSize();
                }
            };

            resizer.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                dragging = true;
                pendingWidth = null;
                document.body.classList.add('is-resizing');
                resizer.classList.add('is-dragging');
                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', onPointerUp);
            });

            // Double-click: toggle full collapse (handled in setupSidebarCollapse when available)
            resizer.addEventListener('dblclick', () => {
                if (typeof window.toggleSidebarPanel === 'function') {
                    window.toggleSidebarPanel();
                    return;
                }
                mainContent.style.removeProperty('--sidebar-width');
                try { localStorage.removeItem('sidebarWidth'); } catch (_) {}
                if (window.map && typeof window.map.invalidateSize === 'function') {
                    window.map.invalidateSize();
                }
            });

            // Arrow keys when the divider has focus
            resizer.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const current = Number.parseInt(getComputedStyle(mainContent).getPropertyValue('--sidebar-width'), 10) || 320;
                const delta = event.key === 'ArrowLeft' ? -20 : 20;
                const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, current + delta));
                mainContent.style.setProperty('--sidebar-width', `${next}px`);
                try { localStorage.setItem('sidebarWidth', String(next)); } catch (_) {}
                if (window.map && typeof window.map.invalidateSize === 'function') {
                    window.map.invalidateSize();
                }
            });
        }

        document.addEventListener('DOMContentLoaded', setupSidebarResizer);

        // === Sidebar collapse (desktop) + drawer (mobile) ===
        function setupSidebarCollapse() {
            const MOBILE_MAX = 900;
            const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`);
            const mainContent = document.getElementById('mainContent') || document.querySelector('.main-content');
            const sidebar = document.getElementById('appSidebar') || document.querySelector('.sidebar');
            const backdrop = document.getElementById('sidebarBackdrop');
            const collapseBtn = document.getElementById('sidebarCollapseBtn');
            const headerLegendBtn = document.getElementById('headerLegendBtn');
            const mapLegendBtn = document.getElementById('mapLegendBtn');
            const gutterBtn = document.getElementById('sidebarGutterBtn');
            const dragHandle = document.getElementById('sidebarDragHandle');
            const resizer = document.getElementById('sidebarResizer');

            if (!mainContent || !sidebar) return;

            let desktopCollapsed = false;
            try {
                desktopCollapsed = localStorage.getItem('sidebarCollapsed') === '1';
            } catch (_) { /* private mode */ }

            let mobileOpen = false;
            let dragOffset = 0;
            let dragActive = false;

            function isMobileSidebar() {
                return mobileQuery.matches;
            }

            function invalidateMapSoon() {
                if (!window.map || typeof window.map.invalidateSize !== 'function') return;
                requestAnimationFrame(() => {
                    window.map.invalidateSize();
                    requestAnimationFrame(() => window.map.invalidateSize());
                });
            }

            function setDragOffset(px) {
                dragOffset = px;
                sidebar.style.setProperty('--sidebar-drag-offset', `${px}px`);
            }

            function clearDragOffset() {
                dragOffset = 0;
                sidebar.classList.remove('is-dragging');
                sidebar.style.removeProperty('--sidebar-drag-offset');
            }

            function updateAria() {
                const mobile = isMobileSidebar();
                const open = mobile ? mobileOpen : !desktopCollapsed;
                collapseBtn?.setAttribute('aria-expanded', String(open));
                headerLegendBtn?.setAttribute('aria-expanded', String(open));
                mapLegendBtn?.setAttribute('aria-expanded', String(open));
                gutterBtn?.setAttribute('aria-expanded', String(open));
                backdrop?.setAttribute('aria-hidden', String(!mobile || !mobileOpen));
                headerLegendBtn?.classList.toggle('is-active', open);
                mapLegendBtn?.classList.toggle('is-active', open);
                document.body.classList.toggle('legend-panel-open', open);
                document.body.classList.toggle('legend-panel-closed', !open);
            }

            function syncSidebarDom() {
                const mobile = isMobileSidebar();
                mainContent.classList.toggle('is-mobile-sidebar', mobile);

                if (mobile) {
                    mainContent.classList.remove('is-sidebar-collapsed');
                    mainContent.classList.toggle('is-sidebar-open', mobileOpen);
                    document.body.classList.toggle('sidebar-mobile-open', mobileOpen);
                    if (!mobileOpen) clearDragOffset();
                } else {
                    mainContent.classList.remove('is-sidebar-open');
                    document.body.classList.remove('sidebar-mobile-open');
                    mainContent.classList.toggle('is-sidebar-collapsed', desktopCollapsed);
                    clearDragOffset();
                }

                if (resizer) {
                    resizer.hidden = mobile || desktopCollapsed;
                }

                updateAria();
                invalidateMapSoon();
            }

            function setDesktopCollapsed(collapsed) {
                desktopCollapsed = collapsed;
                try {
                    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
                } catch (_) { /* private mode */ }
                syncSidebarDom();
            }

            function setMobileOpen(open) {
                mobileOpen = open;
                if (!open) clearDragOffset();
                syncSidebarDom();
            }

            function openSidebar() {
                if (isMobileSidebar()) setMobileOpen(true);
                else setDesktopCollapsed(false);
            }

            function closeSidebar() {
                if (isMobileSidebar()) setMobileOpen(false);
                else setDesktopCollapsed(true);
            }

            window.toggleSidebarPanel = function() {
                if (isMobileSidebar()) setMobileOpen(!mobileOpen);
                else setDesktopCollapsed(!desktopCollapsed);
            };
            window.collapseSidebarPanel = closeSidebar;
            window.openSidebarPanel = openSidebar;

            collapseBtn?.addEventListener('click', closeSidebar);
            headerLegendBtn?.addEventListener('click', () => window.toggleSidebarPanel());
            mapLegendBtn?.addEventListener('click', () => window.toggleSidebarPanel());
            gutterBtn?.addEventListener('click', openSidebar);
            backdrop?.addEventListener('click', () => setMobileOpen(false));

            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                const mobile = isMobileSidebar();
                const open = mobile ? mobileOpen : !desktopCollapsed;
                if (open) closeSidebar();
            });

            mobileQuery.addEventListener('change', () => {
                if (mobileQuery.matches) mobileOpen = false;
                syncSidebarDom();
            });

            // Swipe from left edge of the map to open on mobile
            const mapStage = document.querySelector('.map-stage');
            let edgeStartX = null;
            let edgeStartY = null;

            mapStage?.addEventListener('pointerdown', (event) => {
                if (!isMobileSidebar() || mobileOpen) return;
                if (event.pointerType === 'mouse' && event.button !== 0) return;
                if (event.clientX > 22) return;
                edgeStartX = event.clientX;
                edgeStartY = event.clientY;
            });

            mapStage?.addEventListener('pointerup', (event) => {
                if (edgeStartX == null || edgeStartY == null) return;
                const dx = event.clientX - edgeStartX;
                const dy = Math.abs(event.clientY - edgeStartY);
                if (dx > 56 && dy < 80) setMobileOpen(true);
                edgeStartX = null;
                edgeStartY = null;
            });

            // Drag sidebar horizontally on mobile to dismiss
            const dragSurface = dragHandle || sidebar;
            let dragStartX = 0;
            let dragStartOffset = 0;

            const onDragMove = (event) => {
                if (!dragActive || !isMobileSidebar() || !mobileOpen) return;
                const delta = event.clientX - dragStartX;
                const next = Math.min(0, dragStartOffset + delta);
                setDragOffset(next);
            };

            const onDragEnd = () => {
                if (!dragActive) return;
                dragActive = false;
                window.removeEventListener('pointermove', onDragMove);
                window.removeEventListener('pointerup', onDragEnd);
                window.removeEventListener('pointercancel', onDragEnd);

                if (dragOffset < -72) {
                    setMobileOpen(false);
                } else {
                    clearDragOffset();
                }
            };

            dragSurface?.addEventListener('pointerdown', (event) => {
                if (!isMobileSidebar() || !mobileOpen) return;
                if (dragHandle && event.target !== dragHandle && !dragHandle.contains(event.target)) return;
                dragActive = true;
                dragStartX = event.clientX;
                dragStartOffset = dragOffset;
                sidebar.classList.add('is-dragging');
                event.preventDefault();
                window.addEventListener('pointermove', onDragMove);
                window.addEventListener('pointerup', onDragEnd);
                window.addEventListener('pointercancel', onDragEnd);
            });

            // Also allow dragging from the sidebar toolbar on mobile
            const toolbar = sidebar.querySelector('.sidebar-toolbar');
            toolbar?.addEventListener('pointerdown', (event) => {
                if (!isMobileSidebar() || !mobileOpen) return;
                if (event.target.closest('button')) return;
                dragActive = true;
                dragStartX = event.clientX;
                dragStartOffset = dragOffset;
                sidebar.classList.add('is-dragging');
                window.addEventListener('pointermove', onDragMove);
                window.addEventListener('pointerup', onDragEnd);
                window.addEventListener('pointercancel', onDragEnd);
            });

            syncSidebarDom();
        }

        document.addEventListener('DOMContentLoaded', setupSidebarCollapse);

        let wazeLayer = null;
        let trafficMarkers = [];
        let trafficVisible = false;
        const trafficTypeVisibility = { high: true, medium: true, low: true };
        let accidentMarkers = [];
        let accidentsVisible = false;
        const accidentTypeVisibility = { mortel: true, grave: true, leger: true };
        let convoiMode = false;
        let constructionPolylines = [];
        let constructionVisible = false;
        const constructionTypeVisibility = { highway: true, proposed: true };
        let bicyclePolylines = [];
        let bicycleVisible = false;
        const bicycleTypeVisibility = { EV17: true, EV8: true, V861: true, local: true };
        let bridgeGeometryLayerGroup = null;
        let bridgeGroupMarkerLayerGroup = null;
        let bridgePhotoLayerGroup = null;
        let bridgeDataLoaded = false;
        let bridgeLoadPromise = null;
        let bridgeVisible = false;
        let bridgeOverviewFitted = false;
        let sensitiveZonesLayer = null;
        let sensitiveZonesVisible = false;
        let sensitiveZonesLoaded = false;
        let inaturalistSensitiveLayerGroup = null;
        let inaturalistSensitiveMarkers = [];
        let inaturalistSensitivesVisible = false;
        let inaturalistSensitivesLoaded = false;
        let inaturalistMapZoomHandler = null;
        let inaturalistMapClickHandler = null;
        let incubatorMapSyncHandler = null;
        let webcamsLayerGroup = null;
        let webcamMarkers = [];
        let webcamsVisible = false;
        let webcamsLoaded = false;
        let webcamsZoomHandler = null;
        const webcamTypeVisibility = { traffic: true, mountain: true };
        let oedbEventsLayerGroup = null;
        let oedbEventMarkers = [];
        let oedbEventsVisible = false;
        let oedbEventsLoaded = false;
        const oedbEventTypeVisibility = {
            accident: true,
            roadwork: true,
            jam: true,
            culture: true,
            sport: true,
            other: true
        };
        let roadsideAreasLayerGroup = null;
        const roadsideAreaLayerGroups = {};
        let roadsideAreasVisible = false;
        let roadsideAreasLoaded = false;
        const roadsideAreaTypeVisibility = {
            car_pooling: true,
            rest_area: true,
            park_ride: true,
            layby: true
        };
        let bridgeGroups = [];
        let bridgePhotoMarkers = [];
        let bridgeGroupById = new Map();
        let bridgeFeatureInfoById = new Map();
        let bridgeFeatureLayersById = new Map();
        let activeBridgeGroupId = null;
        let bridgeMapChangeHandler = null;
        let bridgeMapZoomHandler = null;
        let bridgeMapZoomStartHandler = null;
        let bridgeZoomSettleTimer = null;
        let bridgeGeometryLayerShown = false;
        const BRIDGE_PHOTO_MIN_ZOOM = 16;
        const BRIDGE_SCHEMATIC_MIN_ZOOM = 16;
        const BRIDGE_GEOMETRY_MIN_ZOOM = 12;
        const BRIDGE_ZOOM_SETTLE_MS = 110;
        const BRIDGE_GEOMETRY_SHOW_ZOOM = BRIDGE_GEOMETRY_MIN_ZOOM + 0.4;
        const BRIDGE_GEOMETRY_HIDE_ZOOM = BRIDGE_GEOMETRY_MIN_ZOOM - 0.4;
        const BRIDGE_CLUSTER_DISSOLVE_ZOOM = 15;
        const BRIDGE_CLUSTER_MIN_ZOOM = 8;
        const BRIDGE_PHOTO_OUTSIDE_BASE_PX = 34;
        const BRIDGE_PHOTO_OUTSIDE_RING_PX = 15;
        const bridgePhotoProviderVisibility = {
            panoramax: true,
            mapillary: true
        };

        function bridgeProviderLabel(provider) {
            // Délègue au service centralisé StreetPhoto (voir plus bas).
            return StreetPhoto.label(provider);
        }
        let bisonFuteMarkers = [];
        let bisonFuteVisible = false;
        const bisonFuteTypeVisibility = { travaux: true, bouchons: true, accidents: true };

        // Shared behaviour for clickable legend subtype rows. This mirrors the
        // existing network-hierarchy interaction: the whole row is clickable,
        // disabled subtypes are dimmed, and the parent layer can remain partially
        // visible. Single summary rows are intentionally not registered here.
        function updateSubtypeLegendUi(dataAttribute, visibility, layerVisible) {
            document.querySelectorAll(`[data-${dataAttribute}]`).forEach(item => {
                const key = item.dataset[dataAttribute.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())];
                if (!key || key === 'total') return;
                const enabled = visibility[key] !== false;
                item.style.cursor = layerVisible ? 'pointer' : 'default';
                item.style.pointerEvents = layerVisible ? 'auto' : 'none';
                item.style.opacity = layerVisible ? (enabled ? '1' : '0.4') : '0.5';
                item.style.fontWeight = enabled ? '600' : '400';
                item.style.userSelect = 'none';
                item.style.transition = 'opacity 0.2s ease';
                item.tabIndex = layerVisible ? 0 : -1;
                item.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            });
            const iconIds = {
                bicycle: 'bicycleToggleIcon',
                construction: 'constructionToggleIcon',
                'roadside-area': 'roadsideAreasToggleIcon',
                accident: 'accidentToggleIcon',
                traffic: 'trafficToggleIcon',
                'bison-fute': 'bisonFuteToggleIcon',
                'road-sign': 'roadSignsToggleIcon',
                webcam: 'webcamsToggleIcon',
                'oedb-event': 'oedbEventsToggleIcon'
            };
            const icon = document.getElementById(iconIds[dataAttribute]);
            if (icon) {
                const values = Object.values(visibility);
                const partial = layerVisible && !values.every(Boolean);
                setToggleIcon(icon, layerVisible, { partial });
            }
        }
        let cityMarkers = [];
        let citiesVisible = false;
        const WEATHER_STATIONS = [
            { id: 'avignon', name: 'Avignon', lat: 43.9493, lon: 4.8055 },
            { id: 'carpentras', name: 'Carpentras', lat: 44.055, lon: 5.048 },
            { id: 'orange', name: 'Orange', lat: 44.136, lon: 4.809 },
            { id: 'apt', name: 'Apt', lat: 43.876, lon: 5.396 },
            { id: 'cavaillon', name: 'Cavaillon', lat: 43.838, lon: 5.038 },
            { id: 'pertuis', name: 'Pertuis', lat: 43.695, lon: 5.503 }
        ];
        const headerWeatherStation = WEATHER_STATIONS[Math.floor(Math.random() * WEATHER_STATIONS.length)];
        let weatherStationsVisible = false;
        let weatherStationMarkers = [];
        const weatherStationDataById = new Map();
        let limitationsMode = false;
        const dataRefreshState = {};
        
        // Visibility state per hierarchy level
        let hierarchyVisibility = {
            regional: false,
            territorial: false,
            local: false
        };

        // ========== URL STATE (view, families, layers) ==========

        const APP_URL_HIERARCHY_KEYS = {
            hr: 'regional',
            ht: 'territorial',
            hl: 'local'
        };

        const APP_URL_FAMILY_IDS = ['factual', 'stats', 'realtime', 'incubator'];

        const DEFAULT_MAP_VIEW = Object.freeze({
            lat: 44.06,
            lng: 5.20,
            zoom: 11.25
        });

        const DEFAULT_MAP_FRAMING = Object.freeze({
            fitPadding: [28, 28],
            zoomBump: 1,
            maxZoom: 11.75
        });

        let vaucluseDefaultBounds = null;

        function resolveDefaultMapCenterZoom() {
            if (!window.map || !vaucluseDefaultBounds?.isValid()) {
                return {
                    latLng: L.latLng(DEFAULT_MAP_VIEW.lat, DEFAULT_MAP_VIEW.lng),
                    zoom: DEFAULT_MAP_VIEW.zoom
                };
            }

            const snapshot = {
                center: window.map.getCenter(),
                zoom: window.map.getZoom()
            };

            window.map.fitBounds(vaucluseDefaultBounds, {
                padding: DEFAULT_MAP_FRAMING.fitPadding,
                maxZoom: DEFAULT_MAP_FRAMING.maxZoom,
                animate: false
            });

            const target = {
                latLng: window.map.getCenter(),
                zoom: Math.min(
                    window.map.getZoom() + DEFAULT_MAP_FRAMING.zoomBump,
                    DEFAULT_MAP_FRAMING.maxZoom
                )
            };

            window.map.setView(snapshot.center, snapshot.zoom, { animate: false });
            return target;
        }

        function applyDefaultMapView({ animate = false } = {}) {
            if (!window.map) return;

            suppressAppUrlSync = true;

            const finish = () => {
                suppressAppUrlSync = false;
                syncAppUrlState();
            };

            const { latLng, zoom } = resolveDefaultMapCenterZoom();
            window.map.setView(latLng, zoom, { animate });

            if (animate) {
                window.map.once('moveend', finish);
            } else {
                finish();
            }
        }

        function parseAppUrlState() {
            const params = new URLSearchParams(window.location.search);
            const state = { families: [], layers: [], layersExplicit: false };

            const z = Number.parseFloat(params.get('z') || '');
            const lat = Number.parseFloat(params.get('lat') || '');
            const lng = Number.parseFloat(params.get('lng') || '');
            if (Number.isFinite(z) && Number.isFinite(lat) && Number.isFinite(lng)) {
                state.view = { z, lat, lng };
            }

            if (params.has('ly')) {
                state.layersExplicit = true;
                state.layers = params.get('ly')
                    .split(',')
                    .map(value => value.trim())
                    .filter(Boolean);
            }

            const fam = params.get('fam');
            if (fam) {
                state.families = fam
                    .split(',')
                    .map(value => value.trim())
                    .filter(id => APP_URL_FAMILY_IDS.includes(id));
            }

            if (!state.view && !state.layersExplicit && !state.families.length) return null;
            return state;
        }

        function appUrlHasView(state) {
            return !!(state?.view && Number.isFinite(state.view.z));
        }

        const INITIAL_APP_URL_STATE = parseAppUrlState();
        const INITIAL_URL_HAS_VIEW = appUrlHasView(INITIAL_APP_URL_STATE);

        let suppressAppUrlSync = false;
        let appUrlSyncTimer = null;
        let appUrlViewApplied = false;
        let appUrlLayersApplied = false;
        let appUrlLayersPending = null;
        let appUrlFamiliesPending = null;
        // Keys already forced from the URL. Layer data lands over several seconds and
        // each loader retries the pending state, so without this a layer the user just
        // turned off would be switched back on by the next loader that completes.
        const appUrlAppliedKeys = new Set();

        function initAppUrlStateFromLocation() {
            const state = parseAppUrlState();
            appUrlLayersPending = null;
            appUrlFamiliesPending = null;
            appUrlAppliedKeys.clear();
            if (!state) return;
            if (state.layersExplicit) appUrlLayersPending = new Set(state.layers);
            else if (state.families.length) appUrlFamiliesPending = state.families.slice();
        }

        initAppUrlStateFromLocation();

        function collectActiveAppUrlLayers() {
            const active = [];
            Object.entries(APP_URL_HIERARCHY_KEYS).forEach(([key, hierarchy]) => {
                if (hierarchyVisibility[hierarchy]) active.push(key);
            });
            if (constructionVisible) active.push('construction');
            if (bicycleVisible) active.push('bicycle');
            if (citiesVisible) active.push('cities');
            if (roadsideAreasVisible) active.push('aires');
            if (limitationsMode) active.push('limits');
            if (accidentsVisible) active.push('accidents');
            if (trafficVisible) active.push('traffic');
            if (bisonFuteVisible) active.push('bison');
            if (weatherStationsVisible) active.push('weather');
            if (bridgeVisible) {
                active.push('bridges');
                if (bridgePhotoProviderVisibility.panoramax) active.push('pnx');
                if (bridgePhotoProviderVisibility.mapillary) active.push('mly');
            }
            if (roadSignsVisible) active.push('signs');
            if (guidepostsVisible) active.push('guide');
            if (cityLimitsVisible) active.push('agglo');
            if (latestChangesVisible) active.push('osmdiff');
            if (sensitiveZonesVisible) active.push('ens');
            if (inaturalistSensitivesVisible) active.push('inat');
            if (webcamsVisible) active.push('wcam');
            if (oedbEventsVisible) active.push('oedb');
            return active;
        }

        function collectActiveAppUrlFamilies() {
            return APP_URL_FAMILY_IDS.filter(familyId => {
                const counts = getFamilyLayerCounts(familyId);
                return counts && counts.visible > 0;
            });
        }

        function syncAppUrlState() {
            if (suppressAppUrlSync || !window.map) return;

            try {
                const center = window.map.getCenter();
                const params = new URLSearchParams();
                params.set('z', window.map.getZoom().toFixed(2));
                params.set('lat', center.lat.toFixed(4));
                params.set('lng', center.lng.toFixed(4));

                const layers = collectActiveAppUrlLayers();
                params.set('ly', layers.join(','));

                const families = collectActiveAppUrlFamilies();
                if (families.length) params.set('fam', families.join(','));

                const query = params.toString();
                const next = query
                    ? `${window.location.pathname}?${query}${window.location.hash}`
                    : `${window.location.pathname}${window.location.hash}`;
                const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                if (current !== next) {
                    window.history.replaceState(null, '', next);
                }
            } catch (error) {
                console.warn('Synchronisation URL carte:', error);
            }
        }

        function scheduleAppUrlSync() {
            if (suppressAppUrlSync) return;
            clearTimeout(appUrlSyncTimer);
            appUrlSyncTimer = setTimeout(syncAppUrlState, 200);
        }

        function flushAppUrlSync() {
            clearTimeout(appUrlSyncTimer);
            appUrlSyncTimer = null;
            syncAppUrlState();
        }

        window.addEventListener('pagehide', flushAppUrlSync);

        function setHierarchyLevelIfNeeded(hierarchy, desired) {
            if (hierarchyVisibility[hierarchy] === desired) return;
            hierarchyVisibility[hierarchy] = desired;
        }

        function setBooleanLayerIfNeeded(current, desired, toggleFn) {
            if (current === desired || typeof toggleFn !== 'function') return;
            toggleFn();
        }

        function setBridgeProviderIfNeeded(provider, desired) {
            if (bridgePhotoProviderVisibility[provider] === desired) return;
            if (typeof window.toggleBridgePhotoProvider === 'function') {
                window.toggleBridgePhotoProvider(provider);
            }
        }

        function applyAppUrlHierarchyFromSet(wanted) {
            Object.entries(APP_URL_HIERARCHY_KEYS).forEach(([key, hierarchy]) => {
                setHierarchyLevelIfNeeded(hierarchy, wanted.has(key));
            });
            if (typeof window.updateHierarchyDisplay === 'function') {
                window.updateHierarchyDisplay();
            }
        }

        // Applies one URL key and reports whether the layer now sits in the requested
        // state. A key that is already there needs no further pass, so it will not be
        // forced again later — leaving the user free to toggle it.
        function applyAppUrlLayerKey(key, wanted) {
            const desired = wanted.has(key);
            switch (key) {
                case 'hr':
                case 'ht':
                case 'hl':
                    return true;
                case 'construction':
                    setBooleanLayerIfNeeded(constructionVisible, desired, window.toggleConstruction);
                    return constructionVisible === desired;
                case 'bicycle':
                    setBooleanLayerIfNeeded(bicycleVisible, desired, window.toggleBicycleRoutes);
                    return bicycleVisible === desired;
                case 'cities':
                    setBooleanLayerIfNeeded(citiesVisible, desired, window.toggleCities);
                    return citiesVisible === desired;
                case 'aires':
                    setBooleanLayerIfNeeded(roadsideAreasVisible, desired, window.toggleRoadsideAreas);
                    return roadsideAreasVisible === desired;
                case 'limits':
                    setBooleanLayerIfNeeded(limitationsMode, desired, window.toggleLimitationsMode);
                    return limitationsMode === desired;
                case 'accidents':
                    setBooleanLayerIfNeeded(accidentsVisible, desired, window.toggleAccidents);
                    return accidentsVisible === desired;
                case 'traffic':
                case 'waze': {
                    // Two aliases for the same layer: only their union is meaningful,
                    // otherwise the second key would undo the first.
                    const wantsTraffic = wanted.has('traffic') || wanted.has('waze');
                    setBooleanLayerIfNeeded(trafficVisible, wantsTraffic, window.toggleTraffic);
                    return trafficVisible === wantsTraffic;
                }
                case 'weather':
                    setBooleanLayerIfNeeded(weatherStationsVisible, desired, window.toggleWeatherStations);
                    return weatherStationsVisible === desired;
                case 'bison':
                    setBooleanLayerIfNeeded(bisonFuteVisible, desired, window.toggleBisonFute);
                    return bisonFuteVisible === desired;
                case 'bridges':
                    setBooleanLayerIfNeeded(bridgeVisible, desired, window.toggleBridges);
                    return bridgeVisible === desired;
                case 'signs':
                    setBooleanLayerIfNeeded(roadSignsVisible, desired, window.toggleRoadSigns);
                    return roadSignsVisible === desired;
                case 'guide':
                    setBooleanLayerIfNeeded(guidepostsVisible, desired, window.toggleGuideposts);
                    return guidepostsVisible === desired;
                case 'agglo':
                    setBooleanLayerIfNeeded(cityLimitsVisible, desired, window.toggleCityLimits);
                    return cityLimitsVisible === desired;
                case 'osmdiff':
                    setBooleanLayerIfNeeded(latestChangesVisible, desired, window.toggleLatestChanges);
                    return latestChangesVisible === desired;
                case 'pnx':
                    if (desired && !bridgeVisible) setBooleanLayerIfNeeded(bridgeVisible, true, window.toggleBridges);
                    setBridgeProviderIfNeeded('panoramax', desired);
                    return bridgePhotoProviderVisibility.panoramax === desired && (!desired || bridgeVisible);
                case 'mly':
                    if (desired && !bridgeVisible) setBooleanLayerIfNeeded(bridgeVisible, true, window.toggleBridges);
                    setBridgeProviderIfNeeded('mapillary', desired);
                    return bridgePhotoProviderVisibility.mapillary === desired && (!desired || bridgeVisible);
                case 'ens':
                    setBooleanLayerIfNeeded(sensitiveZonesVisible, desired, window.toggleSensitiveZones);
                    return sensitiveZonesVisible === desired;
                case 'inat':
                    setBooleanLayerIfNeeded(inaturalistSensitivesVisible, desired, window.toggleInaturalistSensitives);
                    return inaturalistSensitivesVisible === desired;
                case 'wcam':
                    setBooleanLayerIfNeeded(webcamsVisible, desired, window.toggleWebcams);
                    return webcamsVisible === desired;
                case 'oedb':
                    setBooleanLayerIfNeeded(oedbEventsVisible, desired, window.toggleOedbEvents);
                    return oedbEventsVisible === desired;
                default:
                    return true;
            }
        }

        function applyAppUrlLayersFromSet(wanted) {
            if (!appUrlAppliedKeys.has('hierarchy')) {
                applyAppUrlHierarchyFromSet(wanted);
                appUrlAppliedKeys.add('hierarchy');
            }

            const pendingKeys = [
                'construction', 'bicycle', 'cities', 'aires', 'limits', 'accidents', 'traffic', 'waze',
                'weather', 'bison', 'bridges', 'pnx', 'mly', 'signs', 'guide', 'agglo', 'osmdiff', 'ens', 'inat', 'wcam', 'oedb'
            ];
            let allReady = true;
            pendingKeys.forEach(key => {
                if (appUrlAppliedKeys.has(key)) return;
                if (applyAppUrlLayerKey(key, wanted)) appUrlAppliedKeys.add(key);
                else allReady = false;
            });
            return allReady;
        }

        function applyAppUrlView(state) {
            if (!appUrlHasView(state) || !window.map) return;
            window.map.setView([state.view.lat, state.view.lng], state.view.z, { animate: false });
        }

        function applyAppUrlViewFromLocation() {
            if (appUrlViewApplied || !window.map) return false;

            const state = parseAppUrlState();
            if (!appUrlHasView(state)) return false;

            suppressAppUrlSync = true;
            applyAppUrlView(state);
            appUrlViewApplied = true;
            suppressAppUrlSync = false;
            scheduleAppUrlSync();
            return true;
        }

        function reassertInitialUrlViewIfNeeded() {
            if (!INITIAL_URL_HAS_VIEW || !window.map) return;
            suppressAppUrlSync = true;
            applyAppUrlView(INITIAL_APP_URL_STATE);
            appUrlViewApplied = true;
            suppressAppUrlSync = false;
        }

        function tryApplyAppUrlState() {
            if (!window.map) return;

            applyAppUrlViewFromLocation();
            if (appUrlLayersApplied) return;

            const state = parseAppUrlState();
            if (!state) {
                appUrlLayersApplied = true;
                return;
            }

            suppressAppUrlSync = true;
            try {
                if (appUrlLayersPending) {
                    if (!window.routePolylines) return;
                    const ready = applyAppUrlLayersFromSet(appUrlLayersPending);
                    if (!ready) return;
                    appUrlLayersPending = null;
                } else if (appUrlFamiliesPending?.length) {
                    if (!window.routePolylines) return;
                    appUrlFamiliesPending.forEach(familyId => setFamilyVisibility(familyId, true));
                    appUrlFamiliesPending = null;
                }

                appUrlLayersApplied = true;
            } finally {
                suppressAppUrlSync = false;
                if (appUrlLayersApplied) scheduleAppUrlSync();
            }
        }

        window.addEventListener('popstate', () => {
            appUrlViewApplied = false;
            appUrlLayersApplied = false;
            appUrlLayersPending = null;
            appUrlFamiliesPending = null;
            initAppUrlStateFromLocation();
            tryApplyAppUrlState();
        });

        function getFamilyLayerCounts(familyId) {
            switch (familyId) {
                case 'factual': {
                    let visible = 0;
                    let total = 0;

                    total += 1;
                    if (hierarchyVisibility.regional || hierarchyVisibility.territorial || hierarchyVisibility.local) visible++;

                    total += 1;
                    if (bicycleVisible) visible++;

                    total += 1;
                    if (constructionVisible) visible++;

                    total += 1;
                    if (citiesVisible) visible++;

                    total += 1;
                    if (roadsideAreasVisible) visible++;

                    const limitations = document.getElementById('limitationsLegend');
                    if (limitations && limitations.style.display !== 'none') {
                        total += 1;
                        if (document.getElementById('limitsBtn')?.classList.contains('is-active')) visible++;
                    }
                    return { visible, total };
                }
                case 'stats': {
                    let visible = 0;
                    const total = 2;
                    if (accidentsVisible) visible++;
                    if (trafficVisible) visible++;
                    return { visible, total };
                }
                case 'realtime': {
                    let visible = 0;
                    const total = 2;
                    if (bisonFuteVisible) visible++;
                    if (weatherStationsVisible) visible++;
                    return { visible, total };
                }
                case 'incubator': {
                    let visible = 0;
                    const total = 9;
                    if (bridgeVisible) visible++;
                    if (roadSignsVisible) visible++;
                    if (guidepostsVisible) visible++;
                    if (cityLimitsVisible) visible++;
                    if (latestChangesVisible) visible++;
                    if (sensitiveZonesVisible) visible++;
                    if (inaturalistSensitivesVisible) visible++;
                    if (webcamsVisible) visible++;
                    if (oedbEventsVisible) visible++;
                    return { visible, total };
                }
                default:
                    return null;
            }
        }

        function isFreshnessBadgeLayerVisible(badgeId) {
            switch (badgeId) {
                case 'freshness-boundary':
                case 'freshness-wikidata':
                    return true;
                case 'freshness-hierarchy':
                    return hierarchyVisibility.regional || hierarchyVisibility.territorial || hierarchyVisibility.local;
                case 'freshness-construction':
                    return constructionVisible;
                case 'freshness-bicycle':
                    return bicycleVisible;
                case 'freshness-bridges':
                    return bridgeVisible;
                case 'freshness-road-signs':
                    return roadSignsVisible;
                case 'freshness-guideposts':
                    return guidepostsVisible;
                case 'freshness-latest-changes':
                    return latestChangesVisible;
                case 'freshness-city-limits':
                    return cityLimitsVisible;
                case 'freshness-roadside-areas':
                    return roadsideAreasVisible;
                case 'freshness-accidents':
                    return accidentsVisible;
                case 'freshness-traffic':
                    return trafficVisible;
                case 'freshness-weather-stations':
                    return weatherStationsVisible;
                case 'freshness-oedb-events':
                    return oedbEventsVisible;
                case 'freshness-bison-fute':
                    return bisonFuteVisible;
                default:
                    return true;
            }
        }

        function setSourceText(elementId, value) {
            const element = document.getElementById(elementId);
            if (element) element.textContent = value;
        }

        function formatParisDateTime(value) {
            if (!value) return 'date inconnue';

            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return 'date inconnue';

            return `${new Intl.DateTimeFormat('fr-FR', {
                timeZone: 'Europe/Paris',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }).format(date)} (Paris)`;
        }

        function collectYears(features, propertyNames) {
            const years = new Set();
            const yearPattern = /\b(19|20)\d{2}\b/g;

            (features || []).forEach(feature => {
                const props = feature.properties || {};
                propertyNames.forEach(propertyName => {
                    const value = props[propertyName];
                    if (value === undefined || value === null) return;

                    String(value).match(yearPattern)?.forEach(year => years.add(Number(year)));
                });
            });

            return [...years].filter(Number.isFinite).sort((a, b) => a - b);
        }

        function formatYearRange(years) {
            if (!years.length) return 'millésime inconnu';
            if (years.length === 1) return `${years[0]}`;
            return `${years[0]}-${years[years.length - 1]}`;
        }

        function updateExternalRefreshStatus(sourceName, cache = {}) {
            dataRefreshState[sourceName] = {
                generatedAt: cache.generated_at || null,
                error: cache.error || null
            };

            const statusElement = document.getElementById('externalRefreshStatus');
            if (!statusElement) return;

            const refreshHours = window.APP_CONFIG?.data?.externalRefreshHours || 3;
            const lines = Object.entries(dataRefreshState).map(([name, state]) => {
                const dateLabel = formatParisDateTime(state.generatedAt);
                const errorLabel = state.error ? ' - source indisponible, cache conservé' : '';
                return `${name}: ${dateLabel}${errorLabel}`;
            });

            statusElement.innerHTML = [
                `Données externes\u00a0: cache local rafraîchi toutes les ${refreshHours} h`,
                ...lines
            ].join('<br>');
        }

        // ========== BRIDGES / ENGINEERING STRUCTURES ==========

        function applyBridgesVisibleUi() {
            const icon = document.getElementById('bridgesToggleIcon');
            const title = document.querySelector('.legend-section:has([id="bridgesToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-bridge]');
            setToggleIcon(icon, true);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '700';
            legendItems.forEach(item => {
                item.style.opacity = '1';
                item.style.pointerEvents = 'auto';
            });
            syncBridgeSourceToggleUi();
        }

        function applyBridgesHiddenUi() {
            const icon = document.getElementById('bridgesToggleIcon');
            const title = document.querySelector('.legend-section:has([id="bridgesToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-bridge]');
            setToggleIcon(icon, false);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '600';
            legendItems.forEach(item => {
                item.style.opacity = '0.5';
                item.style.pointerEvents = 'none';
            });
            syncBridgeSourceToggleUi();
            updateBridgeZoomHint(0);
        }

        function syncBridgeSourceToggleUi() {
            [
                ['panoramax', 'bridgeSourcePanoramax'],
                ['mapillary', 'bridgeSourceMapillary']
            ].forEach(([provider, elementId]) => {
                const button = document.getElementById(elementId);
                if (!button) return;
                const active = bridgePhotoProviderVisibility[provider] !== false;
                button.classList.toggle('is-active', active);
                button.classList.toggle('is-disabled-by-layer', !bridgeVisible);
                button.setAttribute('aria-pressed', String(active));
                button.title = active
                    ? `${bridgeProviderLabel(provider)} actif`
                    : `${bridgeProviderLabel(provider)} masqué`;
            });
        }

        function updateBridgeZoomHint(visiblePhotoCount) {
            const hint = document.getElementById('bridgeZoomHint');
            if (!hint || !window.map) return;

            hint.textContent = '';
        }

        function updateBridgePhotoLayerVisibility() {
            if (!bridgePhotoLayerGroup || !window.map) return;
            bridgePhotoLayerGroup.clearLayers();

            if (!bridgeVisible || window.map.getZoom() < BRIDGE_PHOTO_MIN_ZOOM) {
                updateBridgeZoomHint(0);
                return;
            }

            const bounds = window.map.getBounds().pad(0.15);
            let visiblePhotoCount = 0;
            if (typeof window.bridgePhotoMarkerLatLng !== 'function') return;

            bridgePhotoMarkers.forEach(entry => {
                if (bridgePhotoProviderVisibility[entry.photo.provider] === false) return;
                const latlng = window.bridgePhotoMarkerLatLng(entry.photo, entry.group);
                entry.marker.setLatLng(latlng);
                if (!bounds.contains(latlng) && !bounds.intersects(entry.group.bounds)) return;
                entry.marker.addTo(bridgePhotoLayerGroup);
                visiblePhotoCount++;
            });

            updateBridgeZoomHint(visiblePhotoCount);
        }

        function setBridgeMapZoomingState(active) {
            const container = window.map?.getContainer?.();
            if (container) container.classList.toggle('bridge-map-zooming', active);
        }

        function resetBridgeZoomUiState() {
            if (bridgeZoomSettleTimer) {
                clearTimeout(bridgeZoomSettleTimer);
                bridgeZoomSettleTimer = null;
            }
            bridgeGeometryLayerShown = false;
            setBridgeMapZoomingState(false);
        }

        function resolveBridgeGeometryShown(zoom) {
            const z = Number.isFinite(zoom) ? zoom : BRIDGE_CLUSTER_MIN_ZOOM;
            if (!bridgeGeometryLayerShown && z >= BRIDGE_GEOMETRY_SHOW_ZOOM) {
                bridgeGeometryLayerShown = true;
            } else if (bridgeGeometryLayerShown && z < BRIDGE_GEOMETRY_HIDE_ZOOM) {
                bridgeGeometryLayerShown = false;
            }
            return bridgeGeometryLayerShown;
        }

        function refreshBridgeMapLayers() {
            if (!window.map || !bridgeVisible) return;
            updateBridgeGeometryVisibility();
            updateBridgeGroupMarkerLayer();
            updateBridgePhotoLayerVisibility();
            setBridgeMapZoomingState(false);
        }

        function scheduleBridgeMapLayerRefresh() {
            if (!window.map || !bridgeVisible) return;
            setBridgeMapZoomingState(true);
            if (bridgeZoomSettleTimer) clearTimeout(bridgeZoomSettleTimer);
            bridgeZoomSettleTimer = setTimeout(() => {
                bridgeZoomSettleTimer = null;
                refreshBridgeMapLayers();
            }, BRIDGE_ZOOM_SETTLE_MS);
        }

        function bindBridgeMapChangeHandler() {
            if (!window.map || bridgeMapChangeHandler) return;
            bridgeMapZoomStartHandler = () => setBridgeMapZoomingState(true);
            bridgeMapZoomHandler = () => {
                setBridgeMapZoomingState(true);
                updateBridgeGeometryVisibility();
            };
            bridgeMapChangeHandler = () => scheduleBridgeMapLayerRefresh();
            window.map.on('zoomstart', bridgeMapZoomStartHandler);
            window.map.on('zoom', bridgeMapZoomHandler);
            window.map.on('zoomend moveend', bridgeMapChangeHandler);
        }

        function unbindBridgeMapChangeHandler() {
            if (!window.map) return;
            if (bridgeMapZoomStartHandler) {
                window.map.off('zoomstart', bridgeMapZoomStartHandler);
                bridgeMapZoomStartHandler = null;
            }
            if (bridgeMapChangeHandler) {
                window.map.off('zoomend moveend', bridgeMapChangeHandler);
                bridgeMapChangeHandler = null;
            }
            if (bridgeMapZoomHandler) {
                window.map.off('zoom', bridgeMapZoomHandler);
                bridgeMapZoomHandler = null;
            }
            resetBridgeZoomUiState();
        }

        function bridgeClusterRadiusPx(zoom) {
            const z = Number.isFinite(zoom) ? zoom : BRIDGE_CLUSTER_MIN_ZOOM;
            if (z >= BRIDGE_CLUSTER_DISSOLVE_ZOOM) return 0;
            if (z < BRIDGE_GEOMETRY_MIN_ZOOM) {
                return Math.max(16, Math.round(50 * Math.pow(0.72, z - BRIDGE_CLUSTER_MIN_ZOOM)));
            }
            return Math.max(0, Math.round(10 * (BRIDGE_CLUSTER_DISSOLVE_ZOOM - z)));
        }

        function bridgeMarkerZoomScale(zoom) {
            const z = Number.isFinite(zoom) ? zoom : BRIDGE_CLUSTER_MIN_ZOOM;
            return Math.max(0.62, Math.min(1, 1 - (z - 9) * 0.055));
        }

        function bridgeGroupScreenSpanPx(group) {
            if (!window.map || !group?.bounds?.isValid?.()) return 0;
            const sw = window.map.latLngToContainerPoint(group.bounds.getSouthWest());
            const ne = window.map.latLngToContainerPoint(group.bounds.getNorthEast());
            return Math.max(Math.abs(ne.x - sw.x), Math.abs(ne.y - sw.y));
        }

        function bridgePhotoCountsForGroups(groups) {
            return groups.map(group => group.photos.filter(photo => (
                bridgePhotoProviderVisibility[photo.provider] !== false
            )).length);
        }

        function bridgeSoloMarkerDiameter(photoCount, zoom) {
            const scale = bridgeMarkerZoomScale(zoom);
            if (photoCount <= 0) return Math.round(11 * scale);
            return Math.round(Math.min(24, 12 + photoCount * 3) * scale);
        }

        function bridgeClusterMarkerDiameter(cluster, zoom) {
            const scale = bridgeMarkerZoomScale(zoom);
            const maxPhotoCount = cluster.maxPhotoCount || 0;

            if (!cluster.isCluster) {
                return bridgeSoloMarkerDiameter(maxPhotoCount, zoom);
            }

            const zoomBase = zoom < 11 ? 24 : 20;
            const countBump = Math.min(6, Math.sqrt(cluster.bridgeCount) * 1.6);
            const photoBump = cluster.photoCount > 0
                ? Math.min(5, maxPhotoCount + Math.sqrt(cluster.photoCount) * 0.8)
                : 0;
            return Math.round(Math.min(32, zoomBase + countBump + photoBump) * scale);
        }

        function bridgeClusterScreenSpanPx(cluster) {
            if (!window.map || !cluster?.groups?.length) return 0;
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            cluster.groups.forEach(group => {
                if (!group.bounds?.isValid?.()) return;
                const sw = window.map.latLngToContainerPoint(group.bounds.getSouthWest());
                const ne = window.map.latLngToContainerPoint(group.bounds.getNorthEast());
                minX = Math.min(minX, sw.x, ne.x);
                minY = Math.min(minY, sw.y, ne.y);
                maxX = Math.max(maxX, sw.x, ne.x);
                maxY = Math.max(maxY, sw.y, ne.y);
            });
            if (!Number.isFinite(minX)) return 0;
            return Math.max(maxX - minX, maxY - minY);
        }

        function getBridgeGroupsInView() {
            if (!window.map) return [];
            const bounds = window.map.getBounds().pad(0.08);
            return bridgeGroups.filter(group => group.bounds?.isValid?.() && bounds.intersects(group.bounds));
        }

        function buildBridgeClusterDescriptor(groups, isCluster) {
            const photoCounts = bridgePhotoCountsForGroups(groups);
            const photoCount = photoCounts.reduce((sum, count) => sum + count, 0);
            const maxPhotoCount = Math.max(0, ...photoCounts, 0);
            const center = groups.reduce((acc, group) => {
                const groupCenter = group.bounds.getCenter();
                acc.lat += groupCenter.lat;
                acc.lng += groupCenter.lng;
                return acc;
            }, { lat: 0, lng: 0 });

            return {
                groups,
                isCluster,
                bridgeCount: groups.length,
                photoCount,
                maxPhotoCount,
                center: L.latLng(center.lat / groups.length, center.lng / groups.length)
            };
        }

        function clusterBridgeGroupsInView() {
            const zoom = window.map.getZoom();
            const radiusPx = bridgeClusterRadiusPx(zoom);
            const groups = getBridgeGroupsInView();
            if (!groups.length) return [];

            if (radiusPx <= 0) {
                return groups.map(group => buildBridgeClusterDescriptor([group], false));
            }

            const points = groups.map((group, index) => ({
                group,
                index,
                point: window.map.latLngToContainerPoint(group.bounds.getCenter())
            }));
            const parent = points.map((_, index) => index);

            function find(index) {
                if (parent[index] !== index) parent[index] = find(parent[index]);
                return parent[index];
            }

            function union(a, b) {
                parent[find(a)] = find(b);
            }

            for (let i = 0; i < points.length; i += 1) {
                for (let j = i + 1; j < points.length; j += 1) {
                    const distance = Math.hypot(
                        points[i].point.x - points[j].point.x,
                        points[i].point.y - points[j].point.y
                    );
                    const mergeLimit = radiusPx * 0.92;
                    if (distance > mergeLimit) continue;
                    const spanI = bridgeGroupScreenSpanPx(points[i].group);
                    const spanJ = bridgeGroupScreenSpanPx(points[j].group);
                    const minSpan = Math.min(spanI, spanJ);
                    if (minSpan > 14 && distance > minSpan * 0.42) continue;
                    union(i, j);
                }
            }

            const buckets = new Map();
            points.forEach((entry, index) => {
                const root = find(index);
                if (!buckets.has(root)) buckets.set(root, []);
                buckets.get(root).push(entry.group);
            });

            const clusters = [...buckets.values()].map(clusterGroups => (
                buildBridgeClusterDescriptor(clusterGroups, clusterGroups.length > 1)
            ));
            return splitOversizedBridgeClusters(clusters, zoom);
        }

        function splitOversizedBridgeClusters(clusters, zoom) {
            const maxSpan = zoom < 11 ? 78 : 58;
            const expanded = [];
            clusters.forEach(cluster => {
                if (!cluster.isCluster || bridgeClusterScreenSpanPx(cluster) <= maxSpan) {
                    expanded.push(cluster);
                    return;
                }
                cluster.groups.forEach(group => {
                    expanded.push(buildBridgeClusterDescriptor([group], false));
                });
            });
            return expanded;
        }

        function bridgeClusterLabel(cluster, zoom) {
            if (cluster.isCluster) {
                if (cluster.photoCount > 0 && zoom < 13) return String(cluster.photoCount);
                if (cluster.bridgeCount > 1) return String(cluster.bridgeCount);
                return '';
            }
            if (cluster.maxPhotoCount > 0 && zoom >= 12 && zoom < BRIDGE_GEOMETRY_MIN_ZOOM + 1) {
                return String(cluster.maxPhotoCount);
            }
            return '';
        }

        function shouldShowBridgeClusterMarker(cluster, zoom) {
            if (resolveBridgeGeometryShown(zoom)) return false;
            if (!cluster.isCluster) return true;
            if (zoom >= BRIDGE_CLUSTER_DISSOLVE_ZOOM) return false;
            if (bridgeClusterScreenSpanPx(cluster) > (zoom < 11 ? 96 : 72)) return false;
            return true;
        }

        function bridgeClusterTooltip(cluster) {
            if (cluster.isCluster) {
                const bridgeLabel = `${cluster.bridgeCount} pont${cluster.bridgeCount > 1 ? 's' : ''}`;
                if (cluster.photoCount > 0) {
                    return `${bridgeLabel} · ${cluster.photoCount} photo${cluster.photoCount > 1 ? 's' : ''}`;
                }
                return `${bridgeLabel} · zoomez pour détailler`;
            }

            const group = cluster.groups[0];
            if (cluster.photoCount > 0) {
                return `${group.title} · ${cluster.photoCount} photo${cluster.photoCount > 1 ? 's' : ''}`;
            }
            return group.title;
        }

        function updateBridgeGeometryVisibility(zoom = window.map?.getZoom?.()) {
            if (!bridgeGeometryLayerGroup || !window.map) return;
            const showGeometry = bridgeVisible && resolveBridgeGeometryShown(zoom);
            if (showGeometry) {
                if (!window.map.hasLayer(bridgeGeometryLayerGroup)) bridgeGeometryLayerGroup.addTo(window.map);
            } else if (window.map.hasLayer(bridgeGeometryLayerGroup)) {
                window.map.removeLayer(bridgeGeometryLayerGroup);
            }
        }

        function handleBridgeClusterMarkerClick(cluster) {
            if (cluster.isCluster && cluster.bridgeCount > 1) {
                const currentZoom = window.map.getZoom();
                const zoomBump = cluster.bridgeCount > 12 ? 2 : 1;
                const targetZoom = Math.min(Math.max(currentZoom + zoomBump, BRIDGE_GEOMETRY_MIN_ZOOM), 18);

                const validGroups = cluster.groups.filter(group => group.bounds?.isValid?.());
                if (!validGroups.length) {
                    window.map.setView(cluster.center, targetZoom, { animate: true });
                    return;
                }

                const bounds = validGroups.reduce((acc, group) => {
                    acc.extend(group.bounds);
                    return acc;
                }, L.latLngBounds(
                    validGroups[0].bounds.getSouthWest(),
                    validGroups[0].bounds.getNorthEast()
                ));

                if (bounds.isValid()) {
                    const fitZoom = window.map.getBoundsZoom(bounds, false, L.point(56, 56));
                    if (fitZoom > currentZoom + 0.25 && cluster.bridgeCount <= 12) {
                        window.map.fitBounds(bounds, {
                            padding: [56, 56],
                            maxZoom: Math.min(18, Math.max(targetZoom, fitZoom)),
                            animate: true
                        });
                        return;
                    }
                }

                window.map.setView(cluster.center, targetZoom, { animate: true });
                return;
            }
            if (typeof window.openBridgeViewer === 'function') {
                window.openBridgeViewer(cluster.groups[0].id, { fit: true });
            }
        }

        function makeBridgeClusterMarker(cluster) {
            const zoom = window.map.getZoom();
            const diameter = bridgeClusterMarkerDiameter(cluster, zoom);
            const label = bridgeClusterLabel(cluster, zoom);
            const tooltip = bridgeClusterTooltip(cluster);
            const marker = L.marker(cluster.center, {
                icon: L.divIcon({
                    className: 'bridge-group-marker-wrapper',
                    html: `
                        <button
                            type="button"
                            class="bridge-group-marker${cluster.isCluster ? ' is-cluster' : ' is-solo'}${cluster.photoCount ? ' has-photos' : ''}"
                            style="width:${diameter}px;height:${diameter}px;"
                            aria-label="${tooltip.replace(/"/g, '&quot;')}"
                        >
                            ${label ? `<span>${label}</span>` : ''}
                        </button>
                    `,
                    iconSize: [diameter, diameter],
                    iconAnchor: [diameter / 2, diameter / 2]
                }),
                riseOnHover: true,
                interactive: true,
                zIndexOffset: cluster.isCluster ? 1500 : 1400
            });

            marker.bindTooltip(tooltip, {
                direction: 'top',
                offset: [0, -(diameter / 2 + 4)]
            });
            marker.on('click', () => handleBridgeClusterMarkerClick(cluster));
            return marker;
        }

        function ensureBasemapVisible() {
            if (typeof window.ensureBasemapVisible === 'function') {
                window.ensureBasemapVisible();
            }
        }

        function scheduleBasemapRecovery() {
            if (typeof window.scheduleBasemapRecovery === 'function') {
                window.scheduleBasemapRecovery();
            }
        }

        function bringBridgeGroupMarkersToFront() {
            if (!bridgeGroupMarkerLayerGroup || !window.map?.hasLayer(bridgeGroupMarkerLayerGroup)) return;
            // L.layerGroup has no bringToFront — only child layers (paths) may support it.
            bridgeGroupMarkerLayerGroup.eachLayer(layer => {
                if (typeof layer.bringToFront === 'function') {
                    layer.bringToFront();
                }
            });
        }

        function updateBridgeGroupMarkerLayer() {
            if (!bridgeGroupMarkerLayerGroup || !window.map || !bridgeVisible) return;

            const zoom = window.map.getZoom();

            bridgeGroupMarkerLayerGroup.clearLayers();
            clusterBridgeGroupsInView().forEach(cluster => {
                if (!shouldShowBridgeClusterMarker(cluster, zoom)) return;
                makeBridgeClusterMarker(cluster).addTo(bridgeGroupMarkerLayerGroup);
            });
            bringBridgeGroupMarkersToFront();
            requestAnimationFrame(() => setBridgeMapZoomingState(false));
        }

        function fitBridgeOverviewIfNeeded() {
            if (bridgeOverviewFitted) return;
            fitBridgeOverview();
            bridgeOverviewFitted = true;
        }

        function fitBridgeOverview() {
            const validBounds = bridgeGroups
                .map(group => group.bounds)
                .filter(bounds => bounds?.isValid?.());
            if (!validBounds.length || !window.map) return;

            const bounds = validBounds.reduce((acc, item) => {
                acc.extend(item);
                return acc;
            }, L.latLngBounds(validBounds[0].getSouthWest(), validBounds[0].getNorthEast()));

            window.map.fitBounds(bounds, {
                padding: [40, 40],
                maxZoom: 11,
                animate: true
            });
            window.map.once('moveend', scheduleBasemapRecovery);
        }

        function syncBridgeLayersOnMap() {
            if (!window.map) return;

            if (bridgeVisible) {
                if (!bridgeGroupMarkerLayerGroup || !bridgePhotoLayerGroup) return;

                if (!window.map.hasLayer(bridgeGroupMarkerLayerGroup)) {
                    bridgeGroupMarkerLayerGroup.addTo(window.map);
                }
                if (!window.map.hasLayer(bridgePhotoLayerGroup)) bridgePhotoLayerGroup.addTo(window.map);
                bindBridgeMapChangeHandler();
                applyBridgesVisibleUi();
                // Populate cluster markers before geometry/photo layers (geometry toggle used to throw and skip this).
                refreshBridgeMapLayers();
                scheduleBasemapRecovery();
            } else {
                resetBridgeZoomUiState();
                if (!bridgeGeometryLayerGroup || !bridgePhotoLayerGroup) return;
                if (window.map.hasLayer(bridgeGeometryLayerGroup)) window.map.removeLayer(bridgeGeometryLayerGroup);
                if (bridgeGroupMarkerLayerGroup && window.map.hasLayer(bridgeGroupMarkerLayerGroup)) {
                    window.map.removeLayer(bridgeGroupMarkerLayerGroup);
                }
                bridgePhotoLayerGroup.clearLayers();
                if (window.map.hasLayer(bridgePhotoLayerGroup)) window.map.removeLayer(bridgePhotoLayerGroup);
                unbindBridgeMapChangeHandler();
                applyBridgesHiddenUi();
                if (typeof window.closeBridgeViewer === 'function') window.closeBridgeViewer({ keepHighlight: false });
            }

            syncLegendChrome();
        }

        window.toggleBridges = function() {
            bridgeVisible = !bridgeVisible;

            if (!bridgeVisible) {
                syncBridgeLayersOnMap();
                return;
            }

            if (!bridgeDataLoaded) {
                const icon = document.getElementById('bridgesToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                if (typeof window.loadBridges === 'function') {
                    window.loadBridges({ show: true });
                }
                return;
            }

            syncBridgeLayersOnMap();
            fitBridgeOverviewIfNeeded();
        };

        window.toggleBridgePhotoProvider = function(provider) {
            if (!Object.prototype.hasOwnProperty.call(bridgePhotoProviderVisibility, provider)) return;
            bridgePhotoProviderVisibility[provider] = !bridgePhotoProviderVisibility[provider];
            syncBridgeSourceToggleUi();
            updateBridgePhotoLayerVisibility();
            // Cluster size, label and tooltip depend on the number of visible
            // photos: rebuild descriptors after a Panoramax/Mapillary filter.
            updateBridgeGroupMarkerLayer();
            syncLegendChrome();
        };

        // ========== ROAD SIGNS (stop / cédez le passage) ==========
        // Nœuds OSM (highway=stop / give_way), très nombreux (~8600 en 84) : rendu
        // par fenêtre de vue + zoom élevé, anneau vert Mapillary sur les marqueurs
        // couverts (comme les panneaux de vitesse).
        const roadSignsLayer = L.layerGroup();
        let roadSignsVisible = false;
        const roadSignTypeVisibility = { stop: true, yield: true };
        let roadSignsDataLoaded = false;
        let roadSignsFeatures = [];
        let roadSignsZoomHandler = null;
        let roadSignsLoadPromise = null;
        const ROAD_SIGNS_SIGN_ZOOM = 15;        // >= : panneaux individuels ; en dessous : grappes
        const ROAD_SIGNS_CLUSTER_CELL_PX = 58;  // taille de cellule de grappe (px écran)
        const ROAD_SIGNS_MAX_MARKERS = 1500;    // garde-fou pour les panneaux individuels
        const ROAD_SIGN_LABELS = { stop: 'Stop', give_way: 'Cédez le passage' };

        function roadSignDivIcon(kind, hasMapillary) {
            const shapeCls = kind === 'stop' ? 'rs-stop' : 'rs-yield';
            const inner = kind === 'stop' ? '<span class="road-sign-stop-txt">STOP</span>' : '';
            // Anneau vert = forme verte derrière (un box-shadow serait rogné par clip-path).
            const ring = hasMapillary ? `<span class="road-sign-ring ${shapeCls}"></span>` : '';
            return L.divIcon({
                html: `${ring}<span class="road-sign-shape ${shapeCls}">${inner}</span>`,
                className: 'road-sign-wrapper' + (hasMapillary ? ' has-mapillary' : ''),
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });
        }

        function roadSignPopupHtml(kind, img, state) {
            const label = ROAD_SIGN_LABELS[kind] || 'Panneau';
            let body;
            if (state === 'loading') {
                body = `<div class="speed-sign-photo-msg">📷 Recherche d'une photo Mapillary…</div>`;
            } else if (!img || !img.thumb_1024_url) {
                body = `<div class="speed-sign-photo-msg">Pas encore de photo disponible sur Mapillary à proximité.</div>`;
            } else {
                const when = img.captured_at
                    ? new Date(img.captured_at).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short' })
                    : '';
                body = `
                    <a href="${(window.mapillaryPageUrl && window.mapillaryPageUrl(img.id)) || '#'}" target="_blank" rel="noopener noreferrer" class="speed-sign-photo-link">
                        <img class="speed-sign-photo-img" src="${img.thumb_1024_url}" alt="Photo Mapillary à proximité du panneau" loading="lazy">
                    </a>
                    <div class="speed-sign-photo-meta">Mapillary${when ? ' · ' + when : ''} · environnement proche</div>
                `;
            }
            return `
                <div class="route-popup speed-sign-popup">
                    <h3>${label}</h3>
                    <div class="speed-sign-photo">${body}</div>
                </div>
            `;
        }

        function makeRoadSignMarker(lat, lng, kind) {
            const marker = L.marker([lat, lng], {
                icon: roadSignDivIcon(kind, false),
                interactive: true,
                keyboard: false,
                riseOnHover: true,
                zIndexOffset: 350
            });
            marker.bindPopup(roadSignPopupHtml(kind, null, 'loading'), { minWidth: 220, maxWidth: 260 });
            const checkNearby = window.checkMapillaryNearby || (() => Promise.resolve(null));
            checkNearby(lat, lng).then(img => {
                if (img && img.thumb_1024_url) {
                    marker.setIcon(roadSignDivIcon(kind, true));
                    marker.setPopupContent(roadSignPopupHtml(kind, img, 'ok'));
                }
            }).catch(() => {});
            return marker;
        }

        function roadSignClusterIcon(count) {
            const size = count >= 500 ? 48 : count >= 100 ? 42 : count >= 20 ? 36 : 30;
            const label = count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count);
            return L.divIcon({
                html: `<div class="road-sign-cluster" style="width:${size}px;height:${size}px;">${label}</div>`,
                className: 'road-sign-cluster-wrapper',
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2]
            });
        }

        // Agrège les panneaux visibles en grappes par grille d'écran (px) au zoom courant.
        function renderRoadSignClusters(visible, zoom) {
            const cell = ROAD_SIGNS_CLUSTER_CELL_PX;
            const buckets = new Map();
            visible.forEach(sign => {
                const p = window.map.project([sign.lat, sign.lng], zoom);
                const key = `${Math.floor(p.x / cell)}|${Math.floor(p.y / cell)}`;
                let bucket = buckets.get(key);
                if (!bucket) { bucket = { sx: 0, sy: 0, n: 0, stop: 0, yield: 0 }; buckets.set(key, bucket); }
                bucket.sx += p.x; bucket.sy += p.y; bucket.n++;
                if (sign.kind === 'stop') bucket.stop++; else bucket.yield++;
            });
            buckets.forEach(bucket => {
                const center = window.map.unproject([bucket.sx / bucket.n, bucket.sy / bucket.n], zoom);
                const marker = L.marker(center, {
                    icon: roadSignClusterIcon(bucket.n),
                    interactive: true,
                    keyboard: false,
                    zIndexOffset: 330
                });
                marker.bindTooltip(`${bucket.n} panneau${bucket.n > 1 ? 'x' : ''} · ${bucket.stop} stop / ${bucket.yield} cédez — cliquer pour zoomer`, { direction: 'top' });
                marker.on('click', () => {
                    window.map.flyTo(center, Math.min(window.map.getZoom() + 3, ROAD_SIGNS_SIGN_ZOOM + 1), { duration: 0.6 });
                });
                marker.addTo(roadSignsLayer);
            });
        }

        function renderRoadSigns() {
            roadSignsLayer.clearLayers();
            if (!roadSignsVisible || !roadSignsDataLoaded || !window.map) return;
            const zoom = window.map.getZoom();
            const bounds = window.map.getBounds();
            const visible = [];
            for (const feature of roadSignsFeatures) {
                const coords = feature.geometry && feature.geometry.coordinates;
                if (!coords) continue;
                const lng = coords[0], lat = coords[1];
                if (!bounds.contains([lat, lng])) continue;
                const kind = feature.properties && feature.properties.highway;
                const visibilityKey = kind === 'give_way' ? 'yield' : kind;
                if (roadSignTypeVisibility[visibilityKey] === false) continue;
                visible.push({ lat, lng, kind });
            }
            if (zoom >= ROAD_SIGNS_SIGN_ZOOM) {
                // Panneaux individuels (vrais pictogrammes) une fois suffisamment zoomé.
                let count = 0;
                for (const sign of visible) {
                    makeRoadSignMarker(sign.lat, sign.lng, sign.kind).addTo(roadSignsLayer);
                    if (++count >= ROAD_SIGNS_MAX_MARKERS) break;
                }
            } else {
                // Grappes quand c'est dézoomé.
                renderRoadSignClusters(visible, zoom);
            }
        }

        function setRoadSignsLegendCounts(features) {
            let stop = 0, yieldCount = 0;
            (features || []).forEach(feature => {
                const kind = feature.properties && feature.properties.highway;
                if (kind === 'stop') stop++;
                else if (kind === 'give_way') yieldCount++;
            });
            const stopEl = document.getElementById('count-road-signs-stop');
            const yieldEl = document.getElementById('count-road-signs-yield');
            if (stopEl) stopEl.textContent = stop.toLocaleString('fr-FR');
            if (yieldEl) yieldEl.textContent = yieldCount.toLocaleString('fr-FR');
        }

        // Ouvrir un popup fait recentrer la carte pour le rendre visible ; le
        // `moveend` qui suit ne doit pas reconstruire la couche, sinon le marqueur
        // porteur est détruit et le popup se referme dans la foulée.
        // Le suivi passe par les événements plutôt que par `map._popup` : Leaflet
        // 1.9 y laisse le dernier popup ouvert même après fermeture, et la couche
        // resterait gelée pour de bon dès le premier clic — elle se viderait alors
        // au premier déplacement, faute d'être reconstruite sur la nouvelle vue.
        let openPopupSource = null;

        function trackOpenPopupSource(map) {
            map.on('popupopen', event => {
                openPopupSource = (event.popup && event.popup._source) || null;
            });
            // Écouteur posé à la création de la carte, donc avant ceux des couches :
            // leur propre `popupclose` voit bien le popup comme refermé.
            map.on('popupclose', () => { openPopupSource = null; });
        }

        function layerHasOpenPopup(layer) {
            return !!(openPopupSource && layer.hasLayer(openPopupSource));
        }

        // Reconstruction d'une couche filtrée sur la vue. La fermeture du popup
        // sert de rattrapage : tant qu'il était ouvert la couche restait figée,
        // et le recentrage automatique a pu découvrir une zone encore vide.
        // Ce rattrapage est différé, car retirer le marqueur porteur pendant la
        // propagation de `popupclose` referme son popup et relance l'événement.
        function makeViewportRenderHandler(layer, render) {
            return event => {
                if (layerHasOpenPopup(layer)) return;
                if (event && event.type === 'popupclose') setTimeout(render, 0);
                else render();
            };
        }

        function applyRoadSignsVisibleUi() {
            const icon = document.getElementById('roadSignsToggleIcon');
            setToggleIcon(icon, true);
            if (icon) icon.style.opacity = '';
            updateSubtypeLegendUi('road-sign', roadSignTypeVisibility, true);
        }

        function applyRoadSignsHiddenUi() {
            const icon = document.getElementById('roadSignsToggleIcon');
            setToggleIcon(icon, false);
            if (icon) icon.style.opacity = '';
            updateSubtypeLegendUi('road-sign', roadSignTypeVisibility, false);
        }

        window.toggleRoadSignType = function(kind) {
            if (!roadSignsVisible || !Object.prototype.hasOwnProperty.call(roadSignTypeVisibility, kind)) return;
            roadSignTypeVisibility[kind] = !roadSignTypeVisibility[kind];
            renderRoadSigns();
            updateSubtypeLegendUi('road-sign', roadSignTypeVisibility, true);
            syncLegendChrome();
        };

        function syncRoadSignsOnMap() {
            if (roadSignsVisible) {
                if (!window.map.hasLayer(roadSignsLayer)) roadSignsLayer.addTo(window.map);
                if (!roadSignsZoomHandler) {
                    roadSignsZoomHandler = makeViewportRenderHandler(roadSignsLayer, renderRoadSigns);
                    window.map.on('zoomend moveend popupclose', roadSignsZoomHandler);
                }
                renderRoadSigns();
                applyRoadSignsVisibleUi();
            } else {
                roadSignsLayer.clearLayers();
                if (window.map.hasLayer(roadSignsLayer)) window.map.removeLayer(roadSignsLayer);
                if (roadSignsZoomHandler) {
                    window.map.off('zoomend moveend popupclose', roadSignsZoomHandler);
                    roadSignsZoomHandler = null;
                }
                applyRoadSignsHiddenUi();
            }
            syncLegendChrome();
        }

        window.loadRoadSigns = function({ show } = {}) {
            if (roadSignsDataLoaded) {
                if (show) roadSignsVisible = true;
                syncRoadSignsOnMap();
                return Promise.resolve(roadSignsFeatures);
            }
            if (roadSignsLoadPromise) return roadSignsLoadPromise;
            roadSignsLoadPromise = (async () => {
                try {
                    const data = await window.InforouteApi.fetchGeoJson('road-signs');
                    renderFreshnessBadge(document.getElementById('freshness-road-signs'), {
                        generatedAt: data._cache?.generated_at,
                        scheduleKey: 'incubator'
                    });
                    roadSignsFeatures = data.features || [];
                    roadSignsDataLoaded = true;
                    setRoadSignsLegendCounts(roadSignsFeatures);
                    if (show) roadSignsVisible = true;
                    syncRoadSignsOnMap();
                    tryApplyAppUrlState();
                    console.log(`✓ ${roadSignsFeatures.length} panneau(x) stop/cédez chargés`);
                    return roadSignsFeatures;
                } catch (error) {
                    console.error('Erreur chargement panneaux:', error);
                    setRoadSignsLegendCounts([]);
                    renderFreshnessBadge(document.getElementById('freshness-road-signs'), {
                        scheduleKey: 'incubator',
                        errorMsg: error.message
                    });
                    applyRoadSignsHiddenUi();
                    syncLegendChrome();
                    return [];
                } finally {
                    roadSignsLoadPromise = null;
                }
            })();
            return roadSignsLoadPromise;
        };

        window.toggleRoadSigns = function() {
            roadSignsVisible = !roadSignsVisible;
            if (!roadSignsVisible) { syncRoadSignsOnMap(); return; }
            if (!roadSignsDataLoaded) {
                const icon = document.getElementById('roadSignsToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                window.loadRoadSigns({ show: true });
                return;
            }
            syncRoadSignsOnMap();
        };

        // ========== GUIDEPOSTS (panneaux directionnels information=guidepost) ==========
        // Mâts directionnels OSM (information=guidepost, ~2000 en 84) : même rendu que
        // les panneaux stop/cédez — grappes au dézoom, marqueurs au zoom, anneau vert
        // Mapillary + photo de proximité dans le popup quand une couverture existe.
        const guidepostsLayer = L.layerGroup();
        let guidepostsVisible = false;
        let guidepostsDataLoaded = false;
        let guidepostsFeatures = [];
        let guidepostsZoomHandler = null;
        let guidepostsLoadPromise = null;
        const GUIDEPOSTS_SIGN_ZOOM = 15;
        const GUIDEPOSTS_CLUSTER_CELL_PX = 58;
        const GUIDEPOSTS_MAX_MARKERS = 1500;

        // `photoKind` : 'tagged' = photo du panneau référencée dans OSM,
        // 'nearby' = simple couverture Mapillary alentour, null = aucune.
        // Usages d'un mât : un panneau de randonnée et un panneau de véloroute ne
        // servent pas la même lecture de la carte, on peut donc n'afficher que
        // l'un ou l'autre. « Autres » couvre les mâts sans usage déclaré.
        const GUIDEPOST_USAGES = [
            { key: 'hiking', icon: '🚶', name: 'Randonnée', tag: 'hiking' },
            { key: 'bicycle', icon: '🚲', name: 'Vélo', tag: 'bicycle' },
            { key: 'mtb', icon: '🚵', name: 'VTT', tag: 'mtb' },
            { key: 'horse', icon: '🐴', name: 'Équestre', tag: 'horse' }
        ];
        const GUIDEPOST_USAGE_OTHER = { key: 'other', icon: '', name: 'Autres', tag: null };
        const GUIDEPOST_USAGE_OFF = new Set(['no', 'none']);
        const guidepostUsageVisibility = Object.fromEntries(
            GUIDEPOST_USAGES.concat(GUIDEPOST_USAGE_OTHER).map(usage => [usage.key, true])
        );

        function guidepostUsages(props) {
            const p = props || {};
            const found = GUIDEPOST_USAGES.filter(usage => {
                const value = p[usage.tag];
                return value && !GUIDEPOST_USAGE_OFF.has(String(value));
            });
            return found.length ? found : [GUIDEPOST_USAGE_OTHER];
        }

        function guidepostUsageVisible(props) {
            return guidepostUsages(props).some(usage => guidepostUsageVisibility[usage.key]);
        }

        function guidepostDivIcon(photoKind, props) {
            const kind = photoKind === true ? 'nearby' : photoKind;
            const title = kind === 'tagged' ? 'Photo du panneau disponible' : 'Photo Mapillary à proximité';
            const dot = kind ? `<span class="gp-mly" title="${title}"></span>` : '';
            const badges = guidepostUsages(props).filter(usage => usage.icon).slice(0, 2)
                .map(usage => `<span class="gp-use" title="${usage.name}">${usage.icon}</span>`).join('');
            return L.divIcon({
                html: `<span class="gp-post"></span>`
                    + `<span class="gp-blade gp-blade--top"></span>`
                    + `<span class="gp-blade gp-blade--bottom"></span>`
                    + dot
                    + (badges ? `<span class="gp-uses">${badges}</span>` : ''),
                className: 'guidepost-wrapper'
                    + (kind ? ' has-mapillary' : '')
                    + (kind === 'tagged' ? ' has-photo' : ''),
                iconSize: [40, 30],
                iconAnchor: [9, 29]
            });
        }

        function guidepostTitle(props) {
            const p = props || {};
            return p.name || p.ref || p.destination || 'Panneau directionnel';
        }

        // Destinations OSM : "|" sépare les directions, ";" sépare les lieux d'une direction.
        function guidepostDestinationsHtml(props) {
            const raw = props && props.destination;
            if (!raw) return '';
            const directions = String(raw).split('|')
                .map(part => part.split(';').map(s => s.trim()).filter(Boolean).join(', '))
                .filter(Boolean);
            if (!directions.length) return '';
            const items = directions.map(dir => `<li>${escapeHtml(dir)}</li>`).join('');
            return `<ul class="guidepost-dest">${items}</ul>`;
        }

        // Photos portées par le nœud OSM lui-même (`panoramax`, `mapillary`,
        // `wikimedia_commons`, `image`). Elles montrent le panneau, là où la
        // recherche de proximité ne montre que la voirie autour : on les préfère.
        // Les valeurs multiples sont séparées par des « ; ».
        const OSM_NODE_MAX_PHOTOS = 8;

        // Les clés photo se déclinent en variantes suffixées (panoramax:N,
        // mapillary:2017, panoramax:context…) : le suffixe dit l'orientation,
        // l'année ou le cadrage, et sert de légende à la vignette.
        const PHOTO_CARDINALS = {
            N: 'vers le nord', S: 'vers le sud', E: 'vers l’est', W: 'vers l’ouest',
            NE: 'vers le nord-est', NW: 'vers le nord-ouest',
            SE: 'vers le sud-est', SW: 'vers le sud-ouest'
        };

        function photoSuffixLabel(suffix) {
            if (!suffix) return '';
            const key = suffix.toUpperCase();
            if (PHOTO_CARDINALS[key]) return PHOTO_CARDINALS[key];
            if (/^\d{4}$/.test(suffix)) return suffix;
            if (suffix === 'wide') return 'plan large';
            if (suffix === 'context') return 'contexte';
            return suffix;
        }

        function osmNodePhotos(props) {
            const p = props || {};
            const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const photos = [];

            const push = (base, value, note) => {
                if (base === 'panoramax') {
                    if (!UUID_RE.test(value)) return;
                    photos.push({
                        source: 'Panoramax', note,
                        thumb: (window.panoramaxImageUrl && window.panoramaxImageUrl(value, 'thumb')) || null,
                        href: (window.panoramaxPageUrl && window.panoramaxPageUrl(value)) || '#'
                    });
                } else if (base === 'mapillary') {
                    // Terrain OSM : certains tags traînent un fragment de visionneuse
                    // ("<id>&x=…&zoom=…") et d'autres portent encore une clé v3 non
                    // numérique, que l'API Graph refuse — seul le lien reste utile.
                    const id = value.split('&')[0].trim();
                    if (!id) return;
                    photos.push({
                        source: 'Mapillary', note,
                        mapillaryId: /^\d+$/.test(id) ? id : null,
                        thumb: null,
                        href: (window.mapillaryPageUrl && window.mapillaryPageUrl(id)) || '#'
                    });
                } else if (base === 'wikimedia_commons') {
                    const name = value.replace(/^File:/i, '');
                    photos.push({
                        source: 'Wikimedia Commons', note,
                        thumb: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=640`,
                        href: `https://commons.wikimedia.org/wiki/${encodeURIComponent(value)}`
                    });
                } else if (/^https?:\/\//i.test(value)) {
                    photos.push({ source: 'Photo OSM', note, thumb: value, href: value });
                }
            };

            Object.keys(p).forEach(key => {
                const [base, ...rest] = key.split(':');
                if (!['panoramax', 'mapillary', 'wikimedia_commons', 'image'].includes(base)) return;
                const note = photoSuffixLabel(rest.join(':'));
                String(p[key] || '').split(';').map(s => s.trim()).filter(Boolean)
                    .forEach(value => push(base, value, note));
            });

            return photos.slice(0, OSM_NODE_MAX_PHOTOS);
        }

        function osmNodeSlideHtml(photo, index, total) {
            const label = escapeHtml(photo.source);
            const caption = photo.note ? `${label} · ${escapeHtml(photo.note)}` : label;
            // Pas de `loading="lazy"` : les diapositives en attente sont en
            // display:none, le navigateur différerait leur chargement jusqu'à
            // l'affichage et chaque passage à la suivante montrerait un cadre vide.
            const inner = photo.thumb
                ? `<img src="${escapeHtml(photo.thumb)}" alt="Photo du panneau (${caption})">`
                : `<span class="node-photo-pending">${label}</span>`;
            const counter = total > 1 ? `<span class="node-slide-count">${index + 1} / ${total}</span>` : '';
            return `<a class="node-slide${index === 0 ? ' is-active' : ''}" href="${escapeHtml(photo.href)}"
                        target="_blank" rel="noopener noreferrer" title="Ouvrir sur ${label}">
                ${inner}
                <span class="node-slide-bar"><span class="node-slide-src">${caption}</span>${counter}</span>
            </a>`;
        }

        // Bloc photo commun aux panneaux. Au-delà d'une photo, on passe en
        // carrousel : un mât cumule jusqu'à huit prises de vue (une par lame,
        // par orientation ou par millésime), illisibles en vignettes côte à côte.
        function osmNodePhotosHtml(photos) {
            const slides = photos.map((photo, i) => osmNodeSlideHtml(photo, i, photos.length)).join('');
            const nav = photos.length > 1
                ? `<button type="button" class="node-carousel-nav is-prev" data-dir="-1" aria-label="Photo précédente">‹</button>
                   <button type="button" class="node-carousel-nav is-next" data-dir="1" aria-label="Photo suivante">›</button>`
                : '';
            const plural = photos.length > 1 ? 's' : '';
            return `<div class="node-carousel" data-index="0">${slides}${nav}</div>
                <div class="speed-sign-photo-meta">Photo${plural} du panneau · référencée${plural} dans OpenStreetMap</div>`;
        }

        // Lien de contribution : voir la fiche OSM, ou l'ouvrir directement dans iD
        // pour corriger le panneau depuis la carte.
        function osmNodeLinkHtml(props) {
            const id = (props || {}).osm_id;
            if (!id) return '';
            return `<div class="node-osm-link"><span class="node-osm-label">OpenStreetMap</span>
                <a href="https://www.openstreetmap.org/node/${id}" target="_blank" rel="noopener noreferrer">voir</a>
                <span class="node-osm-sep">·</span>
                <a href="https://www.openstreetmap.org/edit?editor=id&node=${id}" target="_blank" rel="noopener noreferrer">compléter</a>
            </div>`;
        }

        // Navigation du carrousel : l'état tient dans le DOM du popup, ce qui
        // survit aux réinjections de contenu et évite un gestionnaire par marqueur.
        document.addEventListener('click', event => {
            const nav = event.target.closest && event.target.closest('.node-carousel-nav');
            if (!nav) return;
            event.preventDefault();
            event.stopPropagation();
            const carousel = nav.closest('.node-carousel');
            const slides = carousel.querySelectorAll('.node-slide');
            if (slides.length < 2) return;
            const step = Number(nav.dataset.dir) || 1;
            const next = (Number(carousel.dataset.index || 0) + step + slides.length) % slides.length;
            carousel.dataset.index = String(next);
            slides.forEach((slide, i) => slide.classList.toggle('is-active', i === next));
        });

        // Les vignettes Mapillary ne se déduisent pas de l'identifiant : on ne les
        // résout qu'à l'ouverture du popup, une seule fois, puis on réinjecte le HTML.
        function resolveMapillaryThumbsOnOpen(marker, photos, rebuild) {
            const pending = photos.filter(photo => photo.mapillaryId && !photo.thumb);
            if (!pending.length) return;
            marker.once('popupopen', () => {
                const resolve = window.fetchMapillaryImageById || (() => Promise.resolve(null));
                Promise.all(pending.map(photo => resolve(photo.mapillaryId)
                    .then(img => { if (img && img.thumb_1024_url) photo.thumb = img.thumb_1024_url; })
                    .catch(() => {})))
                    .then(() => marker.setPopupContent(rebuild()));
            });
        }

        function guidepostPopupHtml(props, photos, state) {
            const title = escapeHtml(guidepostTitle(props));
            const dests = guidepostDestinationsHtml(props);
            let body;
            if (state === 'tagged') {
                body = osmNodePhotosHtml(photos);
            } else if (state === 'loading') {
                body = `<div class="speed-sign-photo-msg">📷 Recherche d'une photo Mapillary…</div>`;
            } else if (!photos || !photos.length) {
                body = `<div class="speed-sign-photo-msg">Pas encore de photo disponible sur Mapillary à proximité.</div>`;
            } else {
                const img = photos[0];
                const when = img.captured_at
                    ? new Date(img.captured_at).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short' })
                    : '';
                body = `
                    <a href="${(window.mapillaryPageUrl && window.mapillaryPageUrl(img.id)) || '#'}" target="_blank" rel="noopener noreferrer" class="speed-sign-photo-link">
                        <img class="speed-sign-photo-img" src="${img.thumb_1024_url}" alt="Photo Mapillary à proximité du panneau directionnel" loading="lazy">
                    </a>
                    <div class="speed-sign-photo-meta">Mapillary${when ? ' · ' + when : ''} · environnement proche</div>
                `;
            }
            const usages = guidepostUsages(props).filter(usage => usage.icon)
                .map(usage => `<span class="guidepost-usage-chip">${usage.icon} ${escapeHtml(usage.name)}</span>`).join('');
            return `
                <div class="route-popup speed-sign-popup guidepost-popup">
                    <h3>${title}</h3>
                    ${usages ? `<div class="guidepost-usage-chips">${usages}</div>` : ''}
                    ${dests}
                    <div class="speed-sign-photo">${body}</div>
                    ${osmNodeLinkHtml(props)}
                </div>
            `;
        }

        function makeGuidepostMarker(lat, lng, props) {
            const tagged = osmNodePhotos(props);
            const marker = L.marker([lat, lng], {
                icon: guidepostDivIcon(tagged.length ? 'tagged' : null, props),
                interactive: true,
                keyboard: false,
                riseOnHover: true,
                zIndexOffset: 340
            });

            if (tagged.length) {
                marker.bindPopup(guidepostPopupHtml(props, tagged, 'tagged'), { minWidth: 220, maxWidth: 300 });
                resolveMapillaryThumbsOnOpen(marker, tagged, () => guidepostPopupHtml(props, tagged, 'tagged'));
                return marker;
            }

            marker.bindPopup(guidepostPopupHtml(props, null, 'loading'), { minWidth: 220, maxWidth: 280 });
            const checkNearby = window.checkMapillaryNearby || (() => Promise.resolve(null));
            checkNearby(lat, lng).then(img => {
                if (img && img.thumb_1024_url) {
                    marker.setIcon(guidepostDivIcon('nearby', props));
                    marker.setPopupContent(guidepostPopupHtml(props, [img], 'nearby'));
                }
            }).catch(() => {});
            return marker;
        }

        function guidepostClusterIcon(count) {
            const size = count >= 500 ? 48 : count >= 100 ? 42 : count >= 20 ? 36 : 30;
            const label = count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count);
            return L.divIcon({
                html: `<div class="guidepost-cluster" style="width:${size}px;height:${size}px;">${label}</div>`,
                className: 'guidepost-cluster-wrapper',
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2]
            });
        }

        function renderGuidepostClusters(visible, zoom) {
            const cell = GUIDEPOSTS_CLUSTER_CELL_PX;
            const buckets = new Map();
            visible.forEach(sign => {
                const p = window.map.project([sign.lat, sign.lng], zoom);
                const key = `${Math.floor(p.x / cell)}|${Math.floor(p.y / cell)}`;
                let bucket = buckets.get(key);
                if (!bucket) { bucket = { sx: 0, sy: 0, n: 0 }; buckets.set(key, bucket); }
                bucket.sx += p.x; bucket.sy += p.y; bucket.n++;
            });
            buckets.forEach(bucket => {
                const center = window.map.unproject([bucket.sx / bucket.n, bucket.sy / bucket.n], zoom);
                const marker = L.marker(center, {
                    icon: guidepostClusterIcon(bucket.n),
                    interactive: true,
                    keyboard: false,
                    zIndexOffset: 320
                });
                marker.bindTooltip(`${bucket.n} panneau${bucket.n > 1 ? 'x' : ''} directionnel${bucket.n > 1 ? 's' : ''} — cliquer pour zoomer`, { direction: 'top' });
                marker.on('click', () => {
                    window.map.flyTo(center, Math.min(window.map.getZoom() + 3, GUIDEPOSTS_SIGN_ZOOM + 1), { duration: 0.6 });
                });
                marker.addTo(guidepostsLayer);
            });
        }

        function renderGuideposts() {
            guidepostsLayer.clearLayers();
            if (!guidepostsVisible || !guidepostsDataLoaded || !window.map) return;
            const zoom = window.map.getZoom();
            const bounds = window.map.getBounds();
            const visible = [];
            for (const feature of guidepostsFeatures) {
                const coords = feature.geometry && feature.geometry.coordinates;
                if (!coords) continue;
                const lng = coords[0], lat = coords[1];
                if (!bounds.contains([lat, lng])) continue;
                const props = feature.properties || {};
                if (!guidepostUsageVisible(props)) continue;
                visible.push({ lat, lng, props });
            }
            if (zoom >= GUIDEPOSTS_SIGN_ZOOM) {
                let count = 0;
                for (const sign of visible) {
                    makeGuidepostMarker(sign.lat, sign.lng, sign.props).addTo(guidepostsLayer);
                    if (++count >= GUIDEPOSTS_MAX_MARKERS) break;
                }
            } else {
                renderGuidepostClusters(visible, zoom);
            }
        }

        function setGuidepostsLegendCounts(features) {
            const el = document.getElementById('count-guideposts');
            if (el) el.textContent = (features || []).length.toLocaleString('fr-FR');
            updateGuidepostUsageLegend();
        }

        // Filtres d'usage : seuls les usages réellement présents dans la donnée
        // sont proposés, un bouton mort n'apprenant rien.
        function updateGuidepostUsageLegend() {
            const container = document.getElementById('guidepostUsages');
            if (!container) return;
            const counts = new Map();
            guidepostsFeatures.forEach(feature => {
                guidepostUsages(feature.properties || {}).forEach(usage => {
                    counts.set(usage.key, (counts.get(usage.key) || 0) + 1);
                });
            });
            container.innerHTML = GUIDEPOST_USAGES.concat(GUIDEPOST_USAGE_OTHER)
                .filter(usage => counts.get(usage.key))
                .map(usage => {
                    const on = guidepostUsageVisibility[usage.key];
                    return `<button type="button" class="guidepost-usage${on ? ' is-on' : ''}" data-usage="${usage.key}" aria-pressed="${on}" title="${usage.name} : ${on ? 'masquer' : 'afficher'}">
                        <span class="guidepost-usage-icon">${usage.icon || '📍'}</span>
                        <span class="guidepost-usage-name">${usage.name}</span>
                        <span class="guidepost-usage-count">${counts.get(usage.key).toLocaleString('fr-FR')}</span>
                    </button>`;
                }).join('');
        }

        document.addEventListener('click', event => {
            const button = event.target.closest && event.target.closest('.guidepost-usage');
            if (!button) return;
            const key = button.dataset.usage;
            if (!(key in guidepostUsageVisibility)) return;
            guidepostUsageVisibility[key] = !guidepostUsageVisibility[key];
            updateGuidepostUsageLegend();
            renderGuideposts();
        });

        function applyGuidepostsVisibleUi() {
            const icon = document.getElementById('guidepostsToggleIcon');
            setToggleIcon(icon, true);
            if (icon) icon.style.opacity = '';
            document.querySelectorAll('[data-guidepost]').forEach(item => {
                item.style.opacity = '1';
                item.style.pointerEvents = 'auto';
            });
        }

        function applyGuidepostsHiddenUi() {
            const icon = document.getElementById('guidepostsToggleIcon');
            setToggleIcon(icon, false);
            if (icon) icon.style.opacity = '';
            document.querySelectorAll('[data-guidepost]').forEach(item => {
                item.style.opacity = '0.5';
                item.style.pointerEvents = 'none';
            });
        }

        function syncGuidepostsOnMap() {
            if (guidepostsVisible) {
                if (!window.map.hasLayer(guidepostsLayer)) guidepostsLayer.addTo(window.map);
                if (!guidepostsZoomHandler) {
                    guidepostsZoomHandler = makeViewportRenderHandler(guidepostsLayer, renderGuideposts);
                    window.map.on('zoomend moveend popupclose', guidepostsZoomHandler);
                }
                renderGuideposts();
                applyGuidepostsVisibleUi();
            } else {
                guidepostsLayer.clearLayers();
                if (window.map.hasLayer(guidepostsLayer)) window.map.removeLayer(guidepostsLayer);
                if (guidepostsZoomHandler) {
                    window.map.off('zoomend moveend popupclose', guidepostsZoomHandler);
                    guidepostsZoomHandler = null;
                }
                applyGuidepostsHiddenUi();
            }
            syncLegendChrome();
        }

        window.loadGuideposts = function({ show } = {}) {
            if (guidepostsDataLoaded) {
                if (show) guidepostsVisible = true;
                syncGuidepostsOnMap();
                return Promise.resolve(guidepostsFeatures);
            }
            if (guidepostsLoadPromise) return guidepostsLoadPromise;
            guidepostsLoadPromise = (async () => {
                try {
                    const data = await window.InforouteApi.fetchGeoJson('guideposts');
                    renderFreshnessBadge(document.getElementById('freshness-guideposts'), {
                        generatedAt: data._cache?.generated_at,
                        scheduleKey: 'incubator'
                    });
                    guidepostsFeatures = data.features || [];
                    guidepostsDataLoaded = true;
                    setGuidepostsLegendCounts(guidepostsFeatures);
                    if (show) guidepostsVisible = true;
                    syncGuidepostsOnMap();
                    tryApplyAppUrlState();
                    console.log(`✓ ${guidepostsFeatures.length} panneau(x) directionnel(s) chargés`);
                    return guidepostsFeatures;
                } catch (error) {
                    console.error('Erreur chargement panneaux directionnels:', error);
                    setGuidepostsLegendCounts([]);
                    renderFreshnessBadge(document.getElementById('freshness-guideposts'), {
                        scheduleKey: 'incubator',
                        errorMsg: error.message
                    });
                    applyGuidepostsHiddenUi();
                    syncLegendChrome();
                    return [];
                } finally {
                    guidepostsLoadPromise = null;
                }
            })();
            return guidepostsLoadPromise;
        };

        window.toggleGuideposts = function() {
            guidepostsVisible = !guidepostsVisible;
            if (!guidepostsVisible) { syncGuidepostsOnMap(); return; }
            if (!guidepostsDataLoaded) {
                const icon = document.getElementById('guidepostsToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                window.loadGuideposts({ show: true });
                return;
            }
            syncGuidepostsOnMap();
        };

        // ========== PANNEAUX D'AGGLOMÉRATION (traffic_sign=city_limit) ==========
        // Entrées / sorties de village (EB10 / EB20, ~470 en 84) : elles marquent le
        // basculement du régime de vitesse, donc le pendant terrain des limitations.
        // Même mécanique que les mâts directionnels : grappes au dézoom, panneaux
        // nominatifs au zoom, photos OSM du panneau dans le popup.
        const cityLimitsLayer = L.layerGroup();
        let cityLimitsVisible = false;
        let cityLimitsDataLoaded = false;
        let cityLimitsFeatures = [];
        let cityLimitsZoomHandler = null;
        let cityLimitsLoadPromise = null;
        const CITY_LIMITS_SIGN_ZOOM = 13;
        const CITY_LIMITS_CLUSTER_CELL_PX = 58;

        function cityLimitName(props) {
            const p = props || {};
            return p.name || p.alt_name || p.ref || 'Agglomération';
        }

        // `city_limit=end` (ou une direction de sortie) = panneau barré de rouge.
        function cityLimitIsExit(props) {
            const p = props || {};
            return p.city_limit === 'end' || /(^|;)end($|;)/.test(String(p['traffic_sign:direction'] || ''));
        }

        function cityLimitDivIcon(props, hasPhoto) {
            const label = escapeHtml(cityLimitName(props));
            const exit = cityLimitIsExit(props);
            const dot = hasPhoto ? `<span class="city-limit-photo" title="Photo du panneau disponible"></span>` : '';
            return L.divIcon({
                html: `<span class="city-limit-plate${exit ? ' is-exit' : ''}">${label}</span>${dot}`,
                className: 'city-limit-wrapper',
                iconSize: null,
                iconAnchor: [0, 10]
            });
        }

        function cityLimitPopupHtml(props, photos) {
            const p = props || {};
            const rows = [];
            if (p.alt_name && p.alt_name !== p.name) rows.push(['Autre nom', p.alt_name]);
            if (p['name:oc']) rows.push(['Occitan', p['name:oc']]);
            if (p.ref) rows.push(['Référence', p.ref]);
            if (p.description) rows.push(['Description', p.description]);
            if (p.operator) rows.push(['Gestionnaire', p.operator]);
            const detailsHtml = rows.length
                ? `<ul class="city-limit-details">${rows.map(([k, v]) => `<li><strong>${k}</strong> : ${escapeHtml(String(v))}</li>`).join('')}</ul>`
                : '';
            const photosHtml = photos && photos.length
                ? `<div class="speed-sign-photo">${osmNodePhotosHtml(photos)}</div>`
                : '';
            const sense = cityLimitIsExit(props) ? 'Sortie d’agglomération' : 'Entrée d’agglomération';
            return `
                <div class="route-popup speed-sign-popup city-limit-popup">
                    <h3>${escapeHtml(cityLimitName(props))}</h3>
                    <div class="city-limit-sense">${sense}</div>
                    ${detailsHtml}
                    ${photosHtml}
                    ${osmNodeLinkHtml(props)}
                </div>
            `;
        }

        function makeCityLimitMarker(lat, lng, props) {
            const photos = osmNodePhotos(props);
            const marker = L.marker([lat, lng], {
                icon: cityLimitDivIcon(props, photos.length > 0),
                interactive: true,
                keyboard: false,
                riseOnHover: true,
                zIndexOffset: 330
            });
            marker.bindPopup(cityLimitPopupHtml(props, photos), { minWidth: 220, maxWidth: 300 });
            resolveMapillaryThumbsOnOpen(marker, photos, () => cityLimitPopupHtml(props, photos));
            return marker;
        }

        function cityLimitClusterIcon(count) {
            const size = count >= 100 ? 42 : count >= 20 ? 36 : 30;
            return L.divIcon({
                html: `<div class="city-limit-cluster" style="width:${size}px;height:${size}px;">${count}</div>`,
                className: 'city-limit-cluster-wrapper',
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2]
            });
        }

        function renderCityLimitClusters(visible, zoom) {
            const cell = CITY_LIMITS_CLUSTER_CELL_PX;
            const buckets = new Map();
            visible.forEach(sign => {
                const p = window.map.project([sign.lat, sign.lng], zoom);
                const key = `${Math.floor(p.x / cell)}|${Math.floor(p.y / cell)}`;
                let bucket = buckets.get(key);
                if (!bucket) { bucket = { sx: 0, sy: 0, n: 0 }; buckets.set(key, bucket); }
                bucket.sx += p.x; bucket.sy += p.y; bucket.n++;
            });
            buckets.forEach(bucket => {
                const center = window.map.unproject([bucket.sx / bucket.n, bucket.sy / bucket.n], zoom);
                const marker = L.marker(center, {
                    icon: cityLimitClusterIcon(bucket.n),
                    interactive: true,
                    keyboard: false,
                    zIndexOffset: 310
                });
                marker.bindTooltip(`${bucket.n} panneau${bucket.n > 1 ? 'x' : ''} d'agglomération — cliquer pour zoomer`, { direction: 'top' });
                marker.on('click', () => {
                    window.map.flyTo(center, Math.min(window.map.getZoom() + 3, CITY_LIMITS_SIGN_ZOOM + 1), { duration: 0.6 });
                });
                marker.addTo(cityLimitsLayer);
            });
        }

        function renderCityLimits() {
            cityLimitsLayer.clearLayers();
            if (!cityLimitsVisible || !cityLimitsDataLoaded || !window.map) return;
            const zoom = window.map.getZoom();
            const bounds = window.map.getBounds();
            const visible = [];
            for (const feature of cityLimitsFeatures) {
                const coords = feature.geometry && feature.geometry.coordinates;
                if (!coords) continue;
                const lng = coords[0], lat = coords[1];
                if (!bounds.contains([lat, lng])) continue;
                visible.push({ lat, lng, props: feature.properties || {} });
            }
            if (zoom >= CITY_LIMITS_SIGN_ZOOM) {
                visible.forEach(sign => makeCityLimitMarker(sign.lat, sign.lng, sign.props).addTo(cityLimitsLayer));
            } else {
                renderCityLimitClusters(visible, zoom);
            }
        }

        function setCityLimitsLegendCounts(features) {
            const el = document.getElementById('count-city-limits');
            if (el) el.textContent = (features || []).length.toLocaleString('fr-FR');
        }

        function applyCityLimitsUi(visible) {
            const icon = document.getElementById('cityLimitsToggleIcon');
            setToggleIcon(icon, visible);
            if (icon) icon.style.opacity = '';
            document.querySelectorAll('[data-city-limit]').forEach(item => {
                item.style.opacity = visible ? '1' : '0.5';
                item.style.pointerEvents = visible ? 'auto' : 'none';
            });
        }

        function syncCityLimitsOnMap() {
            if (cityLimitsVisible) {
                if (!window.map.hasLayer(cityLimitsLayer)) cityLimitsLayer.addTo(window.map);
                if (!cityLimitsZoomHandler) {
                    cityLimitsZoomHandler = makeViewportRenderHandler(cityLimitsLayer, renderCityLimits);
                    window.map.on('zoomend moveend popupclose', cityLimitsZoomHandler);
                }
                renderCityLimits();
            } else {
                cityLimitsLayer.clearLayers();
                if (window.map.hasLayer(cityLimitsLayer)) window.map.removeLayer(cityLimitsLayer);
                if (cityLimitsZoomHandler) {
                    window.map.off('zoomend moveend popupclose', cityLimitsZoomHandler);
                    cityLimitsZoomHandler = null;
                }
            }
            applyCityLimitsUi(cityLimitsVisible);
            syncLegendChrome();
        }

        window.loadCityLimits = function({ show } = {}) {
            if (cityLimitsDataLoaded) {
                if (show) cityLimitsVisible = true;
                syncCityLimitsOnMap();
                return Promise.resolve(cityLimitsFeatures);
            }
            if (cityLimitsLoadPromise) return cityLimitsLoadPromise;
            cityLimitsLoadPromise = (async () => {
                try {
                    const data = await window.InforouteApi.fetchGeoJson('city-limits');
                    renderFreshnessBadge(document.getElementById('freshness-city-limits'), {
                        generatedAt: data._cache?.generated_at,
                        scheduleKey: 'incubator'
                    });
                    cityLimitsFeatures = data.features || [];
                    cityLimitsDataLoaded = true;
                    setCityLimitsLegendCounts(cityLimitsFeatures);
                    if (show) cityLimitsVisible = true;
                    syncCityLimitsOnMap();
                    tryApplyAppUrlState();
                    console.log(`✓ ${cityLimitsFeatures.length} panneau(x) d'agglomération chargés`);
                    return cityLimitsFeatures;
                } catch (error) {
                    console.error('Erreur chargement panneaux d\'agglomération:', error);
                    setCityLimitsLegendCounts([]);
                    renderFreshnessBadge(document.getElementById('freshness-city-limits'), {
                        scheduleKey: 'incubator',
                        errorMsg: error.message
                    });
                    applyCityLimitsUi(false);
                    syncLegendChrome();
                    return [];
                } finally {
                    cityLimitsLoadPromise = null;
                }
            })();
            return cityLimitsLoadPromise;
        };

        window.toggleCityLimits = function() {
            cityLimitsVisible = !cityLimitsVisible;
            if (!cityLimitsVisible) { syncCityLimitsOnMap(); return; }
            if (!cityLimitsDataLoaded) {
                const icon = document.getElementById('cityLimitsToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                window.loadCityLimits({ show: true });
                return;
            }
            syncCityLimitsOnMap();
        };

        // ========== DERNIERS CHANGEMENTS OSM (augmented diff) ==========
        // Trois jours glissants de contributions sur la voirie du Vaucluse,
        // rafraîchis toutes les heures par le workflow. L'augmented diff coûte
        // une trentaine de secondes à Overpass : il tourne en CI, et le
        // navigateur ne lit qu'un GeoJSON, comme pour toutes les autres couches.
        const latestChangesLayer = L.layerGroup();
        let latestChangesVisible = false;
        let latestChangesDataLoaded = false;
        let latestChangesFeatures = [];
        let latestChangesLoadPromise = null;
        let latestChangesWindowDays = 3;

        const LATEST_CHANGE_ACTIONS = {
            create: { label: 'Créé', color: '#1E8449' },
            modify: { label: 'Modifié', color: '#B9770E' },
            delete: { label: 'Supprimé', color: '#922B21' }
        };

        // Classement repris du script d'extraction : c'est lui qui pose la
        // propriété `axis`, la légende ne fait que la nommer.
        const LATEST_CHANGE_AXES = [
            { key: 'main', name: 'Axes principaux', weight: 5, hint: 'motorway, trunk, primary' },
            { key: 'secondary', name: 'Axes secondaires', weight: 4, hint: 'secondary, tertiary' },
            { key: 'local', name: 'Desserte locale', weight: 3, hint: 'residential, unclassified, service' },
            { key: 'path', name: 'Chemins et modes doux', weight: 2, hint: 'track, path, footway, cycleway' },
            { key: 'works', name: 'Travaux', weight: 3, hint: 'construction, proposed' },
            { key: 'other', name: 'Autres', weight: 2, hint: 'autres valeurs de highway' }
        ];
        const latestChangeAxisVisibility = Object.fromEntries(
            LATEST_CHANGE_AXES.map(axis => [axis.key, true])
        );

        function latestChangeAxis(key) {
            return LATEST_CHANGE_AXES.find(axis => axis.key === key) || LATEST_CHANGE_AXES[LATEST_CHANGE_AXES.length - 1];
        }

        function latestChangeTitle(props) {
            const name = props.name || '';
            const ref = props.ref || '';
            if (ref && name) return `${ref} · ${name}`;
            return ref || name || `${props.osm_type} ${props.osm_id}`;
        }

        function latestChangeAgeLabel(timestamp) {
            const when = new Date(timestamp);
            if (Number.isNaN(when.getTime())) return '';
            const hours = Math.round((Date.now() - when.getTime()) / 3600000);
            if (hours < 1) return "à l'instant";
            if (hours < 24) return `il y a ${hours} h`;
            const days = Math.round(hours / 24);
            return `il y a ${days} j`;
        }

        function latestChangeDateLabel(timestamp) {
            const when = new Date(timestamp);
            if (Number.isNaN(when.getTime())) return '';
            return when.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
        }

        function latestChangeTagsHtml(changes, movedOnly) {
            if (!changes || !changes.length) {
                return movedOnly
                    ? `<div class="latest-change-empty">Un sommet du tracé a été déplacé. La voie elle-même n'a pas été rouverte : ses attributs sont inchangés.</div>`
                    : `<div class="latest-change-empty">Tracé retouché, aucun attribut modifié.</div>`;
            }
            const rows = changes.map(change => {
                const before = change.old === null || change.old === undefined
                    ? '<span class="latest-change-void">absent</span>'
                    : `<span class="latest-change-before">${escapeHtml(change.old)}</span>`;
                const after = change.new === null || change.new === undefined
                    ? '<span class="latest-change-void">retiré</span>'
                    : `<span class="latest-change-after">${escapeHtml(change.new)}</span>`;
                return `<tr><th>${escapeHtml(change.k)}</th><td>${before}</td><td>${after}</td></tr>`;
            }).join('');
            return `<table class="latest-change-tags"><tbody>${rows}</tbody></table>`;
        }

        function latestChangeActionLabel(props) {
            const action = LATEST_CHANGE_ACTIONS[props.action] || LATEST_CHANGE_ACTIONS.modify;
            return props.moved_only ? { label: 'Tracé déplacé', color: action.color } : action;
        }

        // Sur un déplacement, l'auteur vient du sommet bougé, pas de la voie : la
        // voie n'a pas été rouverte, et sa dernière édition peut dater d'années.
        function latestChangeAuthorHtml(props) {
            if (!props.user) {
                return `<div class="latest-change-author">Auteur du déplacement non résolu.</div>`;
            }
            const when = new Date(props.timestamp);
            const date = Number.isNaN(when.getTime())
                ? ''
                : `${when.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })} (${latestChangeAgeLabel(props.timestamp)})`;
            const distance = props.moved_metres
                ? ` de ${props.moved_metres.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} m`
                : '';
            const lead = props.moved_only ? `Sommet déplacé${distance} par` : 'Par';
            const version = props.moved_only || !props.version ? '' : ` · v${escapeHtml(props.version)}`;
            return `<div class="latest-change-author">
                ${lead} <a href="https://www.openstreetmap.org/user/${encodeURIComponent(props.user)}" target="_blank" rel="noopener noreferrer">${escapeHtml(props.user)}</a>
                ${date ? ` · ${date}` : ''}${version}
            </div>`;
        }

        function latestChangePopupHtml(props) {
            const action = latestChangeActionLabel(props);
            const axis = latestChangeAxis(props.axis);
            const changesetLink = props.changeset
                ? `<span class="node-osm-sep">·</span>
                    <a href="https://www.openstreetmap.org/changeset/${props.changeset}" target="_blank" rel="noopener noreferrer">changeset</a>`
                : '';
            return `
                <div class="route-popup latest-change-popup">
                    <h3>${escapeHtml(latestChangeTitle(props))}</h3>
                    <div class="latest-change-head">
                        <span class="latest-change-badge" style="background:${action.color};">${action.label}</span>
                        <span class="latest-change-axis">${escapeHtml(axis.name)}</span>
                        ${props.highway ? `<code class="latest-change-hw">highway=${escapeHtml(props.highway)}</code>` : ''}
                    </div>
                    ${latestChangeAuthorHtml(props)}
                    ${latestChangeTagsHtml(props.changes, props.moved_only)}
                    <div class="node-osm-link"><span class="node-osm-label">OpenStreetMap</span>
                        <a href="https://www.openstreetmap.org/way/${props.osm_id}" target="_blank" rel="noopener noreferrer">objet</a>
                        ${changesetLink}
                        <span class="node-osm-sep">·</span>
                        <a href="https://osmlab.github.io/osm-deep-history/#/way/${props.osm_id}" target="_blank" rel="noopener noreferrer">historique</a>
                    </div>
                </div>`;
        }

        function renderLatestChanges() {
            latestChangesLayer.clearLayers();
            if (!latestChangesVisible || !latestChangesDataLoaded || !window.map) return;

            latestChangesFeatures.forEach(feature => {
                const props = feature.properties || {};
                if (!latestChangeAxisVisibility[props.axis]) return;
                const geometry = feature.geometry;
                if (!geometry) return;

                const action = LATEST_CHANGE_ACTIONS[props.action] || LATEST_CHANGE_ACTIONS.modify;
                const axis = latestChangeAxis(props.axis);
                const isGhost = props.state === 'old';

                // Le tracé d'avant n'est là que pour montrer le déplacement : en
                // pointillé et effacé, pour ne pas se disputer la lecture avec
                // le tracé actuel qui, lui, porte l'information.
                const style = {
                    color: isGhost ? '#7f8c8d' : action.color,
                    weight: isGhost ? 2 : axis.weight,
                    opacity: isGhost ? 0.55 : 0.9,
                    dashArray: isGhost ? '4 5' : null,
                    interactive: !isGhost
                };

                const rings = geometry.type === 'Polygon' ? geometry.coordinates : [geometry.coordinates];
                rings.forEach(ring => {
                    const points = ring.map(coord => [coord[1], coord[0]]);
                    const line = geometry.type === 'Polygon'
                        ? L.polygon(points, { ...style, fill: false })
                        : L.polyline(points, style);
                    if (!isGhost) {
                        line.bindPopup(latestChangePopupHtml(props), { minWidth: 250, maxWidth: 330 });
                        line.bindTooltip(`${latestChangeActionLabel(props).label} — ${latestChangeTitle(props)}`, { sticky: true });
                        // Le récapitulatif retrouve par là les tronçons d'une
                        // voie pour les faire ressortir quand on la désigne.
                        line._roadLabel = latestChangeRoadLabel(props);
                        line._baseStyle = style;
                    }
                    line.addTo(latestChangesLayer);
                });
            });
        }

        function setLatestChangesLegendCounts() {
            const el = document.getElementById('count-latest-changes');
            const changes = latestChangesFeatures.filter(feature => (feature.properties || {}).state !== 'old');
            if (el) el.textContent = changes.length.toLocaleString('fr-FR');
            updateLatestChangesLegend();
        }

        // Seules les classes présentes dans la fenêtre sont proposées : un
        // bouton qui ne filtre rien n'apprend rien.
        function updateLatestChangesLegend() {
            const container = document.getElementById('latestChangesAxes');
            if (!container) return;
            const counts = new Map();
            latestChangesFeatures.forEach(feature => {
                const props = feature.properties || {};
                if (props.state === 'old') return;
                counts.set(props.axis, (counts.get(props.axis) || 0) + 1);
            });
            container.innerHTML = LATEST_CHANGE_AXES
                .filter(axis => counts.get(axis.key))
                .map(axis => {
                    const on = latestChangeAxisVisibility[axis.key];
                    return `<button type="button" class="latest-change-axis-chip${on ? ' is-on' : ''}"
                        data-axis="${axis.key}" aria-pressed="${on}" title="${axis.hint}">
                        <span class="latest-change-axis-bar" style="height:${axis.weight}px;"></span>
                        <span class="latest-change-axis-name">${axis.name}</span>
                        <span class="latest-change-axis-count">${counts.get(axis.key).toLocaleString('fr-FR')}</span>
                    </button>`;
                }).join('');
        }

        document.addEventListener('click', event => {
            const button = event.target.closest && event.target.closest('.latest-change-axis-chip');
            if (!button) return;
            const key = button.dataset.axis;
            if (!(key in latestChangeAxisVisibility)) return;
            latestChangeAxisVisibility[key] = !latestChangeAxisVisibility[key];
            updateLatestChangesLegend();
            renderLatestChanges();
            renderLatestChangesRecap();
        });

        // ---------- Récapitulatif de l'emprise affichée ----------
        // Un millier de segments colorés dit qu'il s'est passé quelque chose,
        // pas sur quelles routes ni par qui. Le récapitulatif répond aux deux,
        // pour la seule emprise à l'écran : c'est ce qu'on regarde.
        const LATEST_RECAP_MAX_ROADS = 8;
        const LATEST_RECAP_MAX_USERS = 3;
        let latestRecapDismissed = false;

        // L'emprise d'un tracé ne bouge plus une fois le fichier chargé : on la
        // calcule une fois pour toutes, le panneau se redessinant à chaque
        // déplacement de carte.
        function latestChangeFeatureBounds(feature) {
            if (feature._bounds !== undefined) return feature._bounds;

            const geometry = feature.geometry;
            const rings = !geometry ? []
                : geometry.type === 'Polygon' ? geometry.coordinates
                : geometry.type === 'LineString' ? [geometry.coordinates]
                : [];
            let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
            rings.forEach(ring => ring.forEach(([lon, lat]) => {
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
                if (lon < minLon) minLon = lon;
                if (lon > maxLon) maxLon = lon;
            }));

            feature._bounds = Number.isFinite(minLat)
                ? L.latLngBounds([minLat, minLon], [maxLat, maxLon])
                : null;
            return feature._bounds;
        }

        // La référence prime sur le nom : une même départementale change de nom
        // de rue en traversant les communes, et la lister sous chacun de ces
        // noms la ferait paraître plusieurs routes distinctes. Une voie sans ref
        // ni nom est comptée à part plutôt qu'affichée sous son identifiant OSM,
        // qui ne dirait rien à personne.
        function latestChangeRoadLabel(props) {
            return props.ref || props.name || null;
        }

        function collectLatestChangesInView() {
            const empty = { roads: [], unnamed: 0, total: 0, users: 0 };
            if (!window.map || !latestChangesDataLoaded) return empty;

            const view = window.map.getBounds();
            const roads = new Map();
            const users = new Set();
            let unnamed = 0;
            let total = 0;

            latestChangesFeatures.forEach(feature => {
                const props = feature.properties || {};
                if (props.state === 'old') return;
                if (!latestChangeAxisVisibility[props.axis]) return;

                const bounds = latestChangeFeatureBounds(feature);
                if (!bounds || !view.intersects(bounds)) return;

                total++;
                if (props.user) users.add(props.user);

                const label = latestChangeRoadLabel(props);
                if (!label) { unnamed++; return; }

                if (!roads.has(label)) {
                    roads.set(label, { label, axis: props.axis, count: 0, users: new Map(), latest: null, bounds: null });
                }
                const road = roads.get(label);
                road.count++;
                if (props.user) road.users.set(props.user, (road.users.get(props.user) || 0) + 1);
                // Horodatages ISO : l'ordre lexicographique est l'ordre du temps.
                if (props.timestamp && (!road.latest || props.timestamp > road.latest)) road.latest = props.timestamp;
                road.bounds = road.bounds ? road.bounds.extend(bounds) : L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
                // Un axe traversant plusieurs classes est annoncé par la plus
                // structurante, celle sous laquelle on le cherche.
                if (latestChangeAxisRank(props.axis) < latestChangeAxisRank(road.axis)) road.axis = props.axis;
            });

            const ranked = [...roads.values()].sort((a, b) => (
                latestChangeAxisRank(a.axis) - latestChangeAxisRank(b.axis) || b.count - a.count
                || a.label.localeCompare(b.label, 'fr')
            ));
            return { roads: ranked, unnamed, total, users: users.size };
        }

        function latestChangeAxisRank(key) {
            const index = LATEST_CHANGE_AXES.findIndex(axis => axis.key === key);
            return index === -1 ? LATEST_CHANGE_AXES.length : index;
        }

        function latestChangeUsersHtml(users) {
            const sorted = [...users.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
            const shown = sorted.slice(0, LATEST_RECAP_MAX_USERS).map(([user]) => (
                `<a href="https://www.openstreetmap.org/user/${encodeURIComponent(user)}"
                    target="_blank" rel="noopener noreferrer">${escapeHtml(user)}</a>`
            ));
            const rest = sorted.length - shown.length;
            if (rest > 0) shown.push(`<span class="latest-recap-more">+${rest}</span>`);
            // Même formulation que la fiche : un sommet déplacé dont l'auteur
            // n'a pas pu être retrouvé n'est pas un changement sans auteur.
            return shown.join('<span class="latest-recap-sep">·</span>')
                || '<span class="latest-recap-more">auteur non résolu</span>';
        }

        function renderLatestChangesRecap() {
            const panel = document.getElementById('latestChangesRecap');
            if (!panel) return;

            const open = latestChangesVisible && latestChangesDataLoaded && !latestRecapDismissed;
            panel.classList.toggle('is-open', open);
            if (!open) return;

            const { roads, unnamed, total, users } = collectLatestChangesInView();
            const scope = document.getElementById('latestChangesRecapScope');
            const body = document.getElementById('latestChangesRecapBody');

            if (scope) {
                scope.textContent = total
                    ? `${total.toLocaleString('fr-FR')} changement${total > 1 ? 's' : ''} · ${users} contributeur${users > 1 ? 's' : ''}`
                    : '';
            }
            if (!body) return;

            if (!total) {
                body.innerHTML = `<p class="latest-recap-empty">Aucun changement dans cette emprise. Dézoomez ou déplacez la carte.</p>`;
                return;
            }

            const rows = roads.slice(0, LATEST_RECAP_MAX_ROADS).map(road => {
                const axis = latestChangeAxis(road.axis);
                // La date la plus récente répond à « c'est de quand ? » sans
                // ouvrir chaque tronçon un par un.
                const when = road.latest ? latestChangeAgeLabel(road.latest) : '';
                const whenHtml = when
                    ? `<span class="latest-recap-when" title="${escapeHtml(latestChangeDateLabel(road.latest))}">${escapeHtml(when)}</span>
                       <span class="latest-recap-sep">·</span>`
                    : '';
                return `<li class="latest-recap-road">
                    <span class="latest-recap-bar" style="height:${axis.weight}px;" title="${escapeHtml(axis.name)}"></span>
                    <button type="button" class="latest-recap-name" data-road="${escapeHtml(road.label)}"
                        title="Cadrer la carte sur les changements de ${escapeHtml(road.label)}">${escapeHtml(road.label)}</button>
                    <span class="latest-recap-count">${road.count.toLocaleString('fr-FR')}</span>
                    <span class="latest-recap-users">${whenHtml}${latestChangeUsersHtml(road.users)}</span>
                </li>`;
            }).join('');

            const hidden = roads.length - Math.min(roads.length, LATEST_RECAP_MAX_ROADS);
            const footnotes = [];
            if (hidden > 0) footnotes.push(`${hidden} autre${hidden > 1 ? 's' : ''} voie${hidden > 1 ? 's' : ''} nommée${hidden > 1 ? 's' : ''}`);
            if (unnamed > 0) footnotes.push(`${unnamed.toLocaleString('fr-FR')} changement${unnamed > 1 ? 's' : ''} sur des voies sans nom`);

            body.innerHTML = `
                <ul class="latest-recap-list">${rows}</ul>
                ${footnotes.length ? `<p class="latest-recap-foot">${escapeHtml(footnotes.join(' · '))}</p>` : ''}
            `;
        }

        window.dismissLatestChangesRecap = function dismissLatestChangesRecap() {
            latestRecapDismissed = true;
            renderLatestChangesRecap();
        };

        // Désigner une voie dans la liste doit mener à ses tronçons : la liste
        // dit qu'il s'est passé quelque chose sur la D 938, encore faut-il
        // pouvoir aller y voir sans la chercher à l'œil sur la carte.
        let latestRecapHighlighted = [];
        let latestRecapHighlightTimer = null;

        function clearLatestRecapHighlight() {
            if (latestRecapHighlightTimer) {
                clearTimeout(latestRecapHighlightTimer);
                latestRecapHighlightTimer = null;
            }
            latestRecapHighlighted.forEach(line => {
                if (line._baseStyle && latestChangesLayer.hasLayer(line)) line.setStyle(line._baseStyle);
            });
            latestRecapHighlighted = [];
        }

        function focusLatestChangeRoad(label) {
            const { roads } = collectLatestChangesInView();
            const road = roads.find(entry => entry.label === label);
            if (!road || !road.bounds) return;

            clearLatestRecapHighlight();
            latestChangesLayer.getLayers().forEach(line => {
                if (line._roadLabel !== label || !line._baseStyle) return;
                line.setStyle({ weight: line._baseStyle.weight + 6, opacity: 1 });
                line.bringToFront();
                latestRecapHighlighted.push(line);
            });
            // L'accent s'efface de lui-même : il sert à retrouver la voie, pas
            // à la marquer durablement au milieu des autres changements.
            latestRecapHighlightTimer = setTimeout(clearLatestRecapHighlight, 2600);

            window.map.fitBounds(road.bounds, { padding: [60, 60], maxZoom: 16 });
        }

        document.addEventListener('click', event => {
            const button = event.target.closest && event.target.closest('.latest-recap-name');
            if (!button || !button.dataset.road) return;
            focusLatestChangeRoad(button.dataset.road);
        });

        function applyLatestChangesUi() {
            const icon = document.getElementById('latestChangesToggleIcon');
            setToggleIcon(icon, latestChangesVisible);
            if (icon) icon.style.opacity = '';
            document.querySelectorAll('[data-latest-change]').forEach(item => {
                item.style.opacity = latestChangesVisible ? '1' : '0.5';
                item.style.pointerEvents = latestChangesVisible ? 'auto' : 'none';
            });
        }

        function syncLatestChangesOnMap() {
            if (latestChangesVisible) {
                if (!window.map.hasLayer(latestChangesLayer)) latestChangesLayer.addTo(window.map);
                renderLatestChanges();
            } else {
                latestChangesLayer.clearLayers();
                if (window.map.hasLayer(latestChangesLayer)) window.map.removeLayer(latestChangesLayer);
                // Rallumer la couche doit ramener le récapitulatif : le masquer
                // vaut pour la session en cours, pas pour toujours.
                latestRecapDismissed = false;
            }
            applyLatestChangesUi();
            renderLatestChangesRecap();
            syncLegendChrome();
        }

        window.loadLatestChanges = function({ show } = {}) {
            if (latestChangesDataLoaded) {
                if (show) latestChangesVisible = true;
                syncLatestChangesOnMap();
                return Promise.resolve(latestChangesFeatures);
            }
            if (latestChangesLoadPromise) return latestChangesLoadPromise;
            latestChangesLoadPromise = (async () => {
                try {
                    const data = await window.InforouteApi.fetchGeoJson('latest-changes');
                    renderFreshnessBadge(document.getElementById('freshness-latest-changes'), {
                        generatedAt: data._cache?.generated_at,
                        scheduleKey: 'hourly'
                    });
                    latestChangesFeatures = data.features || [];
                    latestChangesWindowDays = data._cache?.window_days || latestChangesWindowDays;
                    latestChangesDataLoaded = true;
                    setLatestChangesLegendCounts();
                    setLatestChangesWindowHint();
                    if (show) latestChangesVisible = true;
                    syncLatestChangesOnMap();
                    tryApplyAppUrlState();
                    console.log(`✓ ${latestChangesFeatures.length} changement(s) OSM récent(s) chargés`);
                    return latestChangesFeatures;
                } catch (error) {
                    console.error('Erreur chargement des derniers changements OSM:', error);
                    setLatestChangesLegendCounts();
                    renderFreshnessBadge(document.getElementById('freshness-latest-changes'), {
                        scheduleKey: 'hourly',
                        errorMsg: error.message
                    });
                    applyLatestChangesUi();
                    syncLegendChrome();
                    return [];
                } finally {
                    latestChangesLoadPromise = null;
                }
            })();
            return latestChangesLoadPromise;
        };

        function setLatestChangesWindowHint() {
            const el = document.getElementById('latest-changes-window');
            if (el) el.textContent = `${latestChangesWindowDays} derniers jours`;
        }

        window.toggleLatestChanges = function() {
            latestChangesVisible = !latestChangesVisible;
            if (!latestChangesVisible) { syncLatestChangesOnMap(); return; }
            if (!latestChangesDataLoaded) {
                const icon = document.getElementById('latestChangesToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                window.loadLatestChanges({ show: true });
                return;
            }
            syncLatestChangesOnMap();
        };

        // ========== SENSITIVE NATURAL ZONES & iNATURALIST ==========

        const INATURALIST_TAXON_COLORS = {
            Aves: '#1B6CA8',
            Insecta: '#D4A017',
            Plantae: '#2D6A4F',
            Reptilia: '#6A4C93',
            Amphibia: '#588157',
            Mammalia: '#8B4513',
            Arachnida: '#7F5539',
            Mollusca: '#9C6644',
            Fungi: '#BC6C25',
            Animalia: '#40916C',
            unknown: '#40916C'
        };

        const INATURALIST_MARKER_MIN_HIT_PX = 36;
        const ENS_WIKIDATA_CACHE = new Map();
        const ENS_WIKIDATA_LOADING = new Map();

        function getInaturalistMarkerColor(iconicTaxon, qualityGrade) {
            const base = INATURALIST_TAXON_COLORS[iconicTaxon] || INATURALIST_TAXON_COLORS.unknown;
            if (qualityGrade === 'research') return base;
            if (qualityGrade === 'needs_id') return base;
            return base;
        }

        function inaturalistMarkerZoomScale(zoom) {
            const z = Number.isFinite(zoom) ? zoom : 11;
            return Math.max(0.72, Math.min(1.65, 0.72 + (z - 8) * 0.09));
        }

        function inaturalistMarkerVisualSize(qualityGrade, zoom) {
            const base = qualityGrade === 'research' ? 13 : (qualityGrade === 'needs_id' ? 12 : 11);
            return Math.round(base * inaturalistMarkerZoomScale(zoom));
        }

        function inaturalistMarkerHitSize(zoom, visualSize) {
            return Math.round(Math.max(INATURALIST_MARKER_MIN_HIT_PX, visualSize * 2.35));
        }

        function makeInaturalistMarkerIcon(feature, zoom) {
            const props = feature.properties || {};
            const color = getInaturalistMarkerColor(props.iconic_taxon, props.quality_grade);
            const visualSize = inaturalistMarkerVisualSize(props.quality_grade, zoom);
            const qualityClass = props.quality_grade === 'casual'
                ? ' is-casual'
                : (props.quality_grade === 'needs_id' ? ' is-needs-id' : ' is-research');
            const label = props.taxon_name || 'Observation iNaturalist';

            return L.divIcon({
                className: 'inaturalist-sensitive-marker-wrapper',
                html: `
                    <span
                        class="inaturalist-sensitive-marker-dot${qualityClass}"
                        style="--inat-color:${color};width:${visualSize}px;height:${visualSize}px;"
                        aria-label="${String(label).replace(/"/g, '&quot;')}"
                        role="img"
                    ></span>
                `,
                iconSize: [visualSize, visualSize],
                iconAnchor: [visualSize / 2, visualSize / 2]
            });
        }

        function makeInaturalistSensitiveMarker(feature, zoom) {
            const props = feature.properties || {};
            const coords = feature.geometry?.coordinates;
            if (!coords) return null;

            const mapZoom = Number.isFinite(zoom) ? zoom : (window.map?.getZoom?.() ?? 11);
            const marker = L.marker([coords[1], coords[0]], {
                icon: makeInaturalistMarkerIcon(feature, mapZoom),
                pane: 'markerPane',
                riseOnHover: false,
                interactive: false,
                keyboard: false,
                zIndexOffset: 1400
            });

            marker._inatFeature = feature;
            marker._inatProps = props;
            marker.bindPopup(() => buildInaturalistPopup(props), {
                className: 'inat-leaflet-popup',
                autoPan: true,
                closeButton: true,
                maxWidth: 320,
                minWidth: 260
            });
            return marker;
        }

        function inaturalistMarkerTightSnapRadiusPx(zoom) {
            const visual = inaturalistMarkerVisualSize('research', zoom);
            return Math.round(visual / 2 + 5);
        }

        function inaturalistMarkerDistancePx(latlng, marker) {
            if (!window.map || !marker) return Infinity;
            const clickPoint = window.map.latLngToContainerPoint(latlng);
            const markerPoint = window.map.latLngToContainerPoint(marker.getLatLng());
            return Math.hypot(markerPoint.x - clickPoint.x, markerPoint.y - clickPoint.y);
        }

        function findNearestInaturalistMarker(latlng, maxDistancePx) {
            if (!window.map || !inaturalistSensitivesVisible || !inaturalistSensitiveMarkers.length) {
                return null;
            }

            const snapRadius = Number.isFinite(maxDistancePx)
                ? maxDistancePx
                : inaturalistMarkerTightSnapRadiusPx(window.map.getZoom());
            let bestMarker = null;
            let bestDistance = snapRadius;

            inaturalistSensitiveMarkers.forEach(marker => {
                if (!window.map.hasLayer(marker)) return;
                const distance = inaturalistMarkerDistancePx(latlng, marker);
                if (distance <= bestDistance) {
                    bestDistance = distance;
                    bestMarker = marker;
                }
            });

            return bestMarker;
        }

        function findEnsLayerAtLatLng(latlng) {
            if (!window.map || !sensitiveZonesVisible || !sensitiveZonesLayer) return null;

            const layerPoint = window.map.latLngToLayerPoint(latlng);
            let match = null;
            sensitiveZonesLayer.eachLayer(layer => {
                if (match || typeof layer._containsPoint !== 'function') return;
                try {
                    if (layer._containsPoint(layerPoint)) match = layer;
                } catch (_) {
                    // Ignore layers that cannot test point containment.
                }
            });
            return match;
        }

        function handleIncubatorMapClick(event) {
            if (!window.map) return;

            const latlng = event.latlng;
            const zoom = window.map.getZoom();
            const tightSnap = inaturalistMarkerTightSnapRadiusPx(zoom);
            const ensLayer = sensitiveZonesVisible ? findEnsLayerAtLatLng(latlng) : null;
            const marker = inaturalistSensitivesVisible
                ? findNearestInaturalistMarker(latlng, tightSnap)
                : null;

            if (marker) {
                marker.openPopup();
                L.DomEvent.stopPropagation(event);
                return;
            }

            if (ensLayer) {
                ensLayer.openPopup();
                L.DomEvent.stopPropagation(event);
            }
        }

        function refreshInaturalistMarkerSizes() {
            if (!inaturalistSensitivesVisible || !window.map || !inaturalistSensitiveMarkers.length) return;
            const zoom = window.map.getZoom();
            inaturalistSensitiveMarkers.forEach(marker => {
                const feature = marker._inatFeature;
                if (!feature) return;
                marker.setIcon(makeInaturalistMarkerIcon(feature, zoom));
            });
            raiseInaturalistSensitiveMarkers();
        }

        function bindInaturalistMapZoomHandler() {
            if (!window.map || inaturalistMapZoomHandler) return;
            inaturalistMapZoomHandler = () => refreshInaturalistMarkerSizes();
            window.map.on('zoomend', inaturalistMapZoomHandler);
        }

        function applyEnsLayerInteractivity(layer) {
            if (!layer) return;
            const interactive = sensitiveZonesVisible;
            if (layer.options.interactive !== interactive) {
                layer.options.interactive = interactive;
                if (typeof layer._updateInteractive === 'function') {
                    layer._updateInteractive();
                }
            }
            if (layer._path) {
                layer._path.style.pointerEvents = interactive ? 'auto' : 'none';
            }
        }

        function refreshSensitiveZonesInteractivity() {
            if (!sensitiveZonesLayer) return;
            sensitiveZonesLayer.eachLayer(applyEnsLayerInteractivity);
        }

        function bindInaturalistMapClickHandler() {
            if (!window.map || inaturalistMapClickHandler) return;
            inaturalistMapClickHandler = event => {
                if (!inaturalistSensitivesVisible && !sensitiveZonesVisible) return;
                handleIncubatorMapClick(event);
            };
            window.map.on('click', inaturalistMapClickHandler);
        }

        function bindIncubatorLayerSyncHandlers() {
            if (!window.map) return;
            if (!incubatorMapSyncHandler) {
                incubatorMapSyncHandler = () => syncIncubatorMapLayerOrder();
                window.map.on('zoomend moveend', incubatorMapSyncHandler);
            }
            bindInaturalistMapClickHandler();
        }

        function raiseInaturalistSensitiveMarkers() {
            if (!inaturalistSensitivesVisible) return;
            inaturalistSensitiveMarkers.forEach(marker => {
                if (typeof marker.bringToFront === 'function') marker.bringToFront();
            });
        }

        function syncIncubatorMapLayerOrder() {
            if (!window.map) return;
            if (sensitiveZonesVisible && inaturalistSensitivesVisible && sensitiveZonesLayer) {
                if (typeof sensitiveZonesLayer.bringToBack === 'function') {
                    sensitiveZonesLayer.bringToBack();
                }
            }
            refreshSensitiveZonesInteractivity();
            raiseInaturalistSensitiveMarkers();
        }

        function formatInaturalistDate(value) {
            if (!value) return 'date inconnue';
            const parts = String(value).split('-');
            if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
            return value;
        }

        const ENS_TEXT_REPAIRS = [
            ['Communaut\uFFFD d\uFFFDAgglom\uFFFDration', "Communauté d'Agglomération"],
            ['Communaut\uFFFD de communes', 'Communauté de communes'],
            ['d\uFFFDAgglom\uFFFDration', "d'Agglomération"],
            ['Agglom\uFFFDration', 'Agglomération'],
            ['Communaut\uFFFD', 'Communauté'],
            ['D\uFFFDpartement', 'Département'],
            ['g\uFFFDologique', 'géologique'],
            ['Courth\uFFFDzon', 'Courthézon'],
            ['Jonqui\uFFFDres', 'Jonquières'],
            ['Malauc\uFFFDne', 'Malaucène'],
            ['M\uFFFDrindol', 'Mérindol'],
            ['M\uFFFDnerbes', 'Ménerbes'],
            ['Opp\uFFFDde', 'Oppède'],
            ['Priv\uFFFD', 'Privé'],
            ['priv\uFFFD', 'privé'],
            ['Rhone Lez', 'Rhône Lez']
        ];

        function repairEnsFrenchText(value) {
            if (!value) return value;
            let text = String(value).replace(/ï¿½/g, '\uFFFD');
            ENS_TEXT_REPAIRS.forEach(([wrong, right]) => {
                text = text.split(wrong).join(right);
            });
            return text;
        }

        function normalizeEnsSearchName(name) {
            const repaired = repairEnsFrenchText(name || '').trim();
            return repaired.replace(/^(Le|La|Les|L')\s+/i, '').trim();
        }

        function ensNameTokens(name) {
            return normalizeEnsSearchName(name)
                .toLowerCase()
                .normalize('NFD')
                .replace(/\p{Diacritic}/gu, '')
                .split(/[^a-z0-9]+/)
                .filter(token => token.length > 2 && !['des', 'les', 'du', 'de', 'dans', 'pour', 'zone', 'site'].includes(token));
        }

        function scoreEnsWikidataHit(ensName, hit) {
            const tokens = ensNameTokens(ensName);
            if (!tokens.length || !hit?.label) return 0;

            const label = hit.label.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
            const desc = (hit.description || '').toLowerCase();
            let score = 0;

            tokens.forEach(token => {
                if (label.includes(token)) score += 4;
            });
            if (/(protég|naturel|réserve|espace|forêt|parc|inpn|biotope|humide)/.test(desc)) score += 6;
            if (/(commune|mairie|église|gare|route|cantonal)/.test(desc) && !/(nature|protég|forêt)/.test(desc)) score -= 4;
            return score;
        }

        async function wikidataSearchEntities(query, limit = 6) {
            if (!query) return [];
            const params = new URLSearchParams({
                action: 'wbsearchentities',
                search: query,
                language: 'fr',
                uselang: 'fr',
                format: 'json',
                limit: String(limit),
                origin: '*'
            });
            const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`, { credentials: 'omit' });
            if (!response.ok) return [];
            const data = await response.json();
            return data.search || [];
        }

        function formatEnsWikidataArea(claim) {
            if (!claim?.value) return '';
            const amount = String(claim.value.amount || '').replace(/^\+/, '');
            const numeric = Number.parseFloat(amount);
            if (!Number.isFinite(numeric)) return '';
            const unit = String(claim.value.unit || '');
            if (!unit || unit === '1' || unit.includes('Q712226')) {
                return `${numeric.toLocaleString('fr-FR')} ha`;
            }
            return `${numeric.toLocaleString('fr-FR')}`;
        }

        function formatEnsInceptionYear(value) {
            if (!value) return '';
            const match = String(value).match(/(\d{4})/);
            return match ? match[1] : String(value);
        }

        function ensAreasRoughlyEqual(areaHa, wikidataArea) {
            const local = Number.parseFloat(String(areaHa ?? '').replace(',', '.'));
            const remote = Number.parseFloat(String(wikidataArea ?? '').replace(/[^\d.,]/g, '').replace(',', '.'));
            return Number.isFinite(local) && Number.isFinite(remote) && Math.abs(local - remote) < 0.2;
        }

        function ensLabelsRoughlyEqual(ensName, wikidataLabel) {
            const left = normalizeEnsSearchName(ensName).toLowerCase();
            const right = normalizeEnsSearchName(wikidataLabel).toLowerCase();
            return left && right && left === right;
        }

        function buildEnsWikidataEnrichment(searchHit, entity) {
            if (!searchHit?.id) return null;
            const claims = entity ? extractWikidataValues(entity) : {};
            const inpnClaim = claims.P1848?.[0]?.value;
            const websiteClaim = claims.P856?.[0]?.value;
            const inceptionClaim = claims.P571?.[0];
            const areaClaim = claims.P2046?.[0];

            return {
                qid: searchHit.id,
                label: searchHit.label,
                description: entity?.descriptions?.fr?.value || searchHit.description || '',
                inpnCode: typeof inpnClaim === 'string' ? inpnClaim : '',
                website: typeof websiteClaim === 'string' ? websiteClaim : '',
                inception: inceptionClaim ? formatWikidataValuePlain(inceptionClaim, {}) : '',
                area: formatEnsWikidataArea(areaClaim),
                url: `https://www.wikidata.org/wiki/${searchHit.id}`,
                inpnUrl: typeof inpnClaim === 'string' ? `https://inpn.mnhn.fr/espace/protege/${inpnClaim}` : ''
            };
        }

        async function resolveEnsWikidata(ensName) {
            const key = normalizeEnsSearchName(ensName).toLowerCase();
            if (!key) return null;
            if (ENS_WIKIDATA_CACHE.has(key)) return ENS_WIKIDATA_CACHE.get(key);
            if (ENS_WIKIDATA_LOADING.has(key)) return ENS_WIKIDATA_LOADING.get(key);

            const promise = (async () => {
                const queries = [ensName, normalizeEnsSearchName(ensName), `${normalizeEnsSearchName(ensName)} Vaucluse`];
                const seen = new Set();
                let best = null;
                let bestScore = 0;

                for (const query of queries) {
                    const cleaned = String(query || '').trim();
                    if (!cleaned || seen.has(cleaned)) continue;
                    seen.add(cleaned);
                    const hits = await wikidataSearchEntities(cleaned, 6);
                    hits.forEach(hit => {
                        const score = scoreEnsWikidataHit(ensName, hit);
                        if (score > bestScore) {
                            bestScore = score;
                            best = hit;
                        }
                    });
                    if (bestScore >= 12) break;
                }

                if (!best || bestScore < 6) {
                    ENS_WIKIDATA_CACHE.set(key, null);
                    return null;
                }

                const entity = await fetchWikidataItem(best.id).catch(() => null);
                const enrichment = buildEnsWikidataEnrichment(best, entity);
                ENS_WIKIDATA_CACHE.set(key, enrichment);
                return enrichment;
            })().finally(() => ENS_WIKIDATA_LOADING.delete(key));

            ENS_WIKIDATA_LOADING.set(key, promise);
            return promise;
        }

        function prefetchEnsWikidataEnrichment(features = []) {
            const names = [...new Set((features || []).map(feature => feature.properties?.name).filter(Boolean))];
            names.forEach(name => {
                resolveEnsWikidata(name).catch(() => null);
            });
        }

        function incubatorPopupFact(label, value) {
            if (!value) return '';
            return `
                <div class="incubator-popup__fact">
                    <dt>${label}</dt>
                    <dd>${value}</dd>
                </div>
            `;
        }

        function ensCommuneTokens(communes) {
            return String(communes || '')
                .split(',')
                .map(token => token.trim().toLowerCase())
                .filter(Boolean);
        }

        function stripEnsCommuneRedundancy(text, communes) {
            const cleaned = repairEnsFrenchText(text || '').trim();
            if (!cleaned) return '';

            const tokens = ensCommuneTokens(communes);
            const parts = cleaned.split(',').map(part => part.trim()).filter(Boolean);
            const filtered = parts.filter(part => {
                const lower = part.toLowerCase();
                if (tokens.includes(lower)) return false;
                const communeMatch = lower.match(/^communes? d[e']?\s+(.+)$/i);
                if (communeMatch) {
                    const communeName = communeMatch[1].trim().toLowerCase();
                    if (tokens.some(token => communeName === token
                        || communeName.startsWith(`${token} `)
                        || token.startsWith(communeName))) {
                        return false;
                    }
                }
                return true;
            });

            return filtered.join(', ');
        }

        function incubatorPopupLine(label, value) {
            if (!value) return '';
            return `
                <p class="incubator-popup__line">
                    <span class="incubator-popup__line-label">${label}</span>
                    <span class="incubator-popup__line-value">${value}</span>
                </p>
            `;
        }

        function buildEnsWikidataPopupSection(props, wikidata, loading = false) {
            if (loading) {
                return `
                    <footer class="incubator-popup__wd incubator-popup__wd--loading">
                        <span class="incubator-popup__wd-spinner">Wikidata…</span>
                    </footer>
                `;
            }
            if (!wikidata) return '';

            const chips = [];
            if (wikidata.inpnCode) {
                chips.push(`<a class="incubator-popup__wd-chip" href="${escapeHtml(wikidata.inpnUrl)}" target="_blank" rel="noopener noreferrer">INPN ${escapeHtml(wikidata.inpnCode)}</a>`);
            }
            const inceptionYear = formatEnsInceptionYear(wikidata.inception);
            if (inceptionYear) {
                chips.push(`<span class="incubator-popup__wd-chip is-muted">créé ${escapeHtml(inceptionYear)}</span>`);
            }
            if (wikidata.area && !ensAreasRoughlyEqual(props.area_ha, wikidata.area)) {
                chips.push(`<span class="incubator-popup__wd-chip is-muted">${escapeHtml(wikidata.area)}</span>`);
            }

            const description = wikidata.description
                && !ensLabelsRoughlyEqual(props.name, wikidata.label)
                ? wikidata.description
                : (wikidata.description || '');

            const links = [
                `<a class="incubator-popup__wd-link" href="${escapeHtml(wikidata.url)}" target="_blank" rel="noopener noreferrer">Wikidata</a>`
            ];
            if (wikidata.website) {
                links.push(`<a class="incubator-popup__wd-link" href="${escapeHtml(wikidata.website)}" target="_blank" rel="noopener noreferrer">Site</a>`);
            }

            if (!description && !chips.length) return '';

            return `
                <footer class="incubator-popup__wd">
                    ${description ? `<p class="incubator-popup__wd-desc">${escapeHtml(description)}</p>` : ''}
                    <div class="incubator-popup__wd-row">
                        ${chips.join('')}
                        <span class="incubator-popup__wd-links">${links.join('')}</span>
                    </div>
                </footer>
            `;
        }

        function buildSensitiveZonePopup(props = {}, wikidata = null, wikidataLoading = false) {
            const name = repairEnsFrenchText(props.name) || 'Espace naturel sensible';
            const areaText = props.area_ha ? `${props.area_ha.toLocaleString('fr-FR')} ha` : '';
            const communesRaw = repairEnsFrenchText(props.communes || '');
            const communes = communesRaw ? escapeHtml(communesRaw) : '';
            const habitat = props.habitat ? escapeHtml(repairEnsFrenchText(props.habitat)) : '';
            const manager = stripEnsCommuneRedundancy(props.manager, communesRaw);
            const owner = stripEnsCommuneRedundancy(props.owner, communesRaw);
            const heroChips = [
                areaText ? `<span class="incubator-popup__meta-chip">${escapeHtml(areaText)}</span>` : '',
                communes ? `<span class="incubator-popup__meta-chip">${communes}</span>` : ''
            ].filter(Boolean).join('');
            const bodyLines = [
                incubatorPopupLine('Milieu', habitat),
                manager ? incubatorPopupLine('Gestion', escapeHtml(manager)) : '',
                owner ? incubatorPopupLine('Propriété', escapeHtml(owner)) : ''
            ].join('');

            return `
                <div class="incubator-popup incubator-popup--ens">
                    <div class="incubator-popup__hero incubator-popup__hero--ens">
                        <div class="incubator-popup__hero-top">
                            <span class="incubator-popup__badge">ENS</span>
                            ${heroChips}
                        </div>
                        <h3 class="incubator-popup__title">${escapeHtml(name)}</h3>
                    </div>
                    ${bodyLines ? `<div class="incubator-popup__body incubator-popup__body--ens">${bodyLines}</div>` : ''}
                    ${buildEnsWikidataPopupSection(props, wikidata, wikidataLoading)}
                </div>
            `;
        }

        function inaturalistQualityMeta(qualityGrade) {
            if (qualityGrade === 'research') return { label: 'Recherche', className: 'is-research' };
            if (qualityGrade === 'needs_id') return { label: 'À identifier', className: 'is-needs-id' };
            return { label: 'Casual', className: 'is-casual' };
        }

        function buildInaturalistPopup(props = {}) {
            const quality = inaturalistQualityMeta(props.quality_grade);
            const taxonColor = getInaturalistMarkerColor(props.iconic_taxon, props.quality_grade);
            const photoHtml = props.photo_url
                ? `<img src="${escapeHtml(props.photo_url)}" alt="" class="incubator-popup__photo" loading="lazy">`
                : '';
            const facts = [
                incubatorPopupFact('Date', escapeHtml(formatInaturalistDate(props.observed_on))),
                incubatorPopupFact('Qualité', `<span class="incubator-popup__pill ${quality.className}">${quality.label}</span>`),
                props.ens_name ? incubatorPopupFact('ENS', escapeHtml(props.ens_name)) : '',
                props.user_login ? incubatorPopupFact('Obs.', escapeHtml(props.user_login)) : ''
            ].join('');

            return `
                <div class="incubator-popup incubator-popup--inat">
                    ${photoHtml}
                    <div class="incubator-popup__hero incubator-popup__hero--inat">
                        <span class="incubator-popup__badge" style="--inat-color:${taxonColor};">${escapeHtml(props.iconic_taxon || 'Observation')}</span>
                        <h3 class="incubator-popup__title">${escapeHtml(props.taxon_name || 'Observation')}</h3>
                        ${props.scientific_name && props.scientific_name !== props.taxon_name
                            ? `<p class="incubator-popup__subtitle"><em>${escapeHtml(props.scientific_name)}</em></p>`
                            : ''}
                    </div>
                    <dl class="incubator-popup__facts">${facts}</dl>
                    ${props.url ? `<a class="incubator-popup__cta" href="${escapeHtml(props.url)}" target="_blank" rel="noopener noreferrer">Voir sur iNaturalist</a>` : ''}
                </div>
            `;
        }

        function bindSensitiveZonePopup(layer, feature) {
            const props = feature.properties || {};
            layer.on('click', event => {
                L.DomEvent.stopPropagation(event);
            });
            layer.bindPopup(() => {
                const key = normalizeEnsSearchName(props.name).toLowerCase();
                const hasCache = ENS_WIKIDATA_CACHE.has(key);
                const cached = hasCache ? ENS_WIKIDATA_CACHE.get(key) : null;
                const pending = ENS_WIKIDATA_LOADING.has(key);
                return buildSensitiveZonePopup(props, cached, pending && !hasCache);
            }, {
                className: 'ens-leaflet-popup',
                autoPan: true,
                closeButton: true,
                maxWidth: 340,
                minWidth: 280
            });

            layer.on('popupopen', async () => {
                const key = normalizeEnsSearchName(props.name).toLowerCase();
                if (!key || ENS_WIKIDATA_CACHE.has(key)) return;
                layer.setPopupContent(buildSensitiveZonePopup(props, null, true));
                const wikidata = await resolveEnsWikidata(props.name).catch(() => null);
                if (typeof layer.isPopupOpen === 'function' && !layer.isPopupOpen()) return;
                layer.setPopupContent(buildSensitiveZonePopup(props, wikidata, false));
            });
        }

        function applySensitiveZonesVisibleUi() {
            const icon = document.getElementById('sensitiveZonesToggleIcon');
            const title = document.querySelector('.legend-section:has([id="sensitiveZonesToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-sensitive-zone]');
            setToggleIcon(icon, true);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '700';
            legendItems.forEach(item => {
                item.style.opacity = '1';
                item.style.pointerEvents = 'auto';
            });
        }

        function applySensitiveZonesHiddenUi() {
            const icon = document.getElementById('sensitiveZonesToggleIcon');
            const title = document.querySelector('.legend-section:has([id="sensitiveZonesToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-sensitive-zone]');
            setToggleIcon(icon, false);
            if (title) title.style.fontWeight = '600';
            legendItems.forEach(item => {
                item.style.opacity = '0.5';
                item.style.pointerEvents = 'none';
            });
        }

        function applyInaturalistSensitivesVisibleUi() {
            const icon = document.getElementById('inaturalistSensitivesToggleIcon');
            const title = document.querySelector('.legend-section:has([id="inaturalistSensitivesToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-inaturalist]');
            setToggleIcon(icon, true);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '700';
            legendItems.forEach(item => {
                item.style.opacity = '1';
                item.style.pointerEvents = 'auto';
            });
        }

        function applyInaturalistSensitivesHiddenUi() {
            const icon = document.getElementById('inaturalistSensitivesToggleIcon');
            const title = document.querySelector('.legend-section:has([id="inaturalistSensitivesToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-inaturalist]');
            setToggleIcon(icon, false);
            if (title) title.style.fontWeight = '600';
            legendItems.forEach(item => {
                item.style.opacity = '0.5';
                item.style.pointerEvents = 'none';
            });
        }

        function syncSensitiveZonesOnMap() {
            if (!sensitiveZonesLayer || !window.map) return;
            const onMap = window.map.hasLayer(sensitiveZonesLayer);
            if (sensitiveZonesVisible && !onMap) {
                sensitiveZonesLayer.addTo(window.map);
                requestAnimationFrame(() => refreshSensitiveZonesInteractivity());
            }
            if (!sensitiveZonesVisible && onMap) window.map.removeLayer(sensitiveZonesLayer);
            syncIncubatorMapLayerOrder();
        }

        function syncInaturalistSensitivesOnMap() {
            if (!inaturalistSensitiveLayerGroup || !window.map) return;
            const onMap = window.map.hasLayer(inaturalistSensitiveLayerGroup);
            if (inaturalistSensitivesVisible && !onMap) inaturalistSensitiveLayerGroup.addTo(window.map);
            if (!inaturalistSensitivesVisible && onMap) window.map.removeLayer(inaturalistSensitiveLayerGroup);
            syncIncubatorMapLayerOrder();
        }

        window.toggleSensitiveZones = function() {
            sensitiveZonesVisible = !sensitiveZonesVisible;

            if (!sensitiveZonesVisible) {
                syncSensitiveZonesOnMap();
                applySensitiveZonesHiddenUi();
                syncLegendChrome();
                return;
            }

            if (!sensitiveZonesLoaded) {
                const icon = document.getElementById('sensitiveZonesToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                if (typeof window.loadSensitiveZones === 'function') {
                    window.loadSensitiveZones({ show: true });
                }
                return;
            }

            syncSensitiveZonesOnMap();
            applySensitiveZonesVisibleUi();
            syncLegendChrome();
        };

        window.toggleInaturalistSensitives = function() {
            inaturalistSensitivesVisible = !inaturalistSensitivesVisible;

            if (!inaturalistSensitivesVisible) {
                syncInaturalistSensitivesOnMap();
                applyInaturalistSensitivesHiddenUi();
                syncLegendChrome();
                return;
            }

            if (!inaturalistSensitivesLoaded) {
                const icon = document.getElementById('inaturalistSensitivesToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                if (typeof window.loadInaturalistSensitives === 'function') {
                    window.loadInaturalistSensitives({ show: true });
                }
                return;
            }

            syncInaturalistSensitivesOnMap();
            applyInaturalistSensitivesVisibleUi();
            syncLegendChrome();
        };

        function appUrlWantsLayer(key) {
            if (INITIAL_APP_URL_STATE?.layersExplicit && INITIAL_APP_URL_STATE.layers?.includes(key)) {
                return true;
            }
            const state = parseAppUrlState();
            return !!(state?.layersExplicit && state.layers?.includes(key));
        }

        window.loadSensitiveZones = async function(options = {}) {
            const wantVisible = options.show === true || sensitiveZonesVisible || appUrlWantsLayer('ens');
            try {
                const data = await window.InforouteApi.fetchGeoJson('sensitive-natural-zones');
                const features = data.features || [];

                if (sensitiveZonesLayer) {
                    window.map?.removeLayer(sensitiveZonesLayer);
                    sensitiveZonesLayer = null;
                }

                sensitiveZonesLayer = L.geoJSON(data, {
                    style: {
                        color: '#1B4332',
                        weight: 2,
                        opacity: 0.85,
                        fillColor: '#40916C',
                        fillOpacity: 0.18
                    },
                    interactive: true,
                    onEachFeature(feature, layer) {
                        layer.options.interactive = true;
                        bindSensitiveZonePopup(layer, feature);
                        layer.on('add', () => applyEnsLayerInteractivity(layer));
                    }
                });

                prefetchEnsWikidataEnrichment(features);
                bindIncubatorLayerSyncHandlers();

                sensitiveZonesLoaded = true;
                const countEl = document.getElementById('count-sensitive-zones');
                if (countEl) countEl.textContent = features.length.toLocaleString('fr-FR');

                if (wantVisible) {
                    sensitiveZonesVisible = true;
                    syncSensitiveZonesOnMap();
                    applySensitiveZonesVisibleUi();
                } else {
                    sensitiveZonesVisible = false;
                    syncSensitiveZonesOnMap();
                    applySensitiveZonesHiddenUi();
                }

                syncLegendChrome();
                tryApplyAppUrlState();
                console.log(`✓ ${features.length} espaces naturels sensibles chargés`);
            } catch (error) {
                console.error('Erreur chargement ENS:', error);
                if (!wantVisible) applySensitiveZonesHiddenUi();
                sensitiveZonesVisible = false;
                syncLegendChrome();
            }
        };

        window.loadInaturalistSensitives = async function(options = {}) {
            const wantVisible = options.show === true || inaturalistSensitivesVisible || appUrlWantsLayer('inat');
            try {
                const data = await window.InforouteApi.fetchGeoJson('inaturalist-sensitive-zones');
                const features = data.features || [];

                if (inaturalistSensitiveLayerGroup) {
                    window.map?.removeLayer(inaturalistSensitiveLayerGroup);
                    inaturalistSensitiveLayerGroup = null;
                }
                inaturalistSensitiveMarkers = [];

                const mapZoom = window.map?.getZoom?.() ?? 11;
                inaturalistSensitiveLayerGroup = L.layerGroup();
                features.forEach(feature => {
                    const marker = makeInaturalistSensitiveMarker(feature, mapZoom);
                    if (!marker) return;
                    inaturalistSensitiveMarkers.push(marker);
                    inaturalistSensitiveLayerGroup.addLayer(marker);
                });
                bindInaturalistMapZoomHandler();
                bindIncubatorLayerSyncHandlers();

                inaturalistSensitivesLoaded = true;
                const countEl = document.getElementById('count-inaturalist-sensitive');
                if (countEl) countEl.textContent = features.length.toLocaleString('fr-FR');

                if (wantVisible) {
                    inaturalistSensitivesVisible = true;
                    syncInaturalistSensitivesOnMap();
                    applyInaturalistSensitivesVisibleUi();
                } else {
                    inaturalistSensitivesVisible = false;
                    syncInaturalistSensitivesOnMap();
                    applyInaturalistSensitivesHiddenUi();
                }

                syncLegendChrome();
                tryApplyAppUrlState();
                console.log(`✓ ${features.length} observations iNaturalist (ENS) chargées`);
            } catch (error) {
                console.error('Erreur chargement iNaturalist ENS:', error);
                if (!wantVisible) applyInaturalistSensitivesHiddenUi();
                inaturalistSensitivesVisible = false;
                syncLegendChrome();
            }
        };

        const WEBCAM_CATEGORY_COLORS = {
            traffic: '#C0392B',
            mountain: '#0E7490'
        };

        function escapeWebcamHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        let webcamHlsLoaderPromise = null;

        function loadWebcamHlsLibrary() {
            if (window.Hls) return Promise.resolve(window.Hls);
            if (webcamHlsLoaderPromise) return webcamHlsLoaderPromise;
            webcamHlsLoaderPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js';
                script.async = true;
                script.onload = () => resolve(window.Hls);
                script.onerror = () => reject(new Error('Chargement HLS impossible'));
                document.head.appendChild(script);
            });
            return webcamHlsLoaderPromise;
        }

        function buildWebcamEmbedMarkup(props = {}) {
            const embedUrl = props.embed_url || props.url;
            const title = escapeWebcamHtml(props.name || 'Webcam');
            const refreshMs = Number(props.refresh_ms) > 0 ? Number(props.refresh_ms) : 0;
            const fallbackUrl = props.embed_fallback_url ? escapeWebcamHtml(props.embed_fallback_url) : '';

            if (!embedUrl) {
                return '<p class="webcam-popup-unavailable">Flux indisponible.</p>';
            }

            if (props.embed_type === 'image') {
                return `<div class="webcam-popup-frame"><img class="webcam-popup-image" data-embed-url="${escapeWebcamHtml(embedUrl)}" data-refresh-ms="${refreshMs || 8000}" alt="${title}" loading="lazy"></div>`;
            }

            const videoAttrs = [
                'class="webcam-popup-video"',
                `data-embed-url="${escapeWebcamHtml(embedUrl)}"`,
                `data-embed-type="${escapeWebcamHtml(props.embed_type || 'video')}"`,
                `data-refresh-ms="${refreshMs || 0}"`,
                fallbackUrl ? `data-fallback-url="${fallbackUrl}"` : '',
                'autoplay',
                'muted',
                'playsinline',
                'controls'
            ].filter(Boolean).join(' ');

            return `<div class="webcam-popup-frame"><video ${videoAttrs}></video></div>`;
        }

        function buildWebcamPopup(props = {}) {
            return `<div class="route-popup webcam-popup">${buildWebcamEmbedMarkup(props)}</div>`;
        }

        function cacheBustUrl(url) {
            const joiner = url.includes('?') ? '&' : '?';
            return `${url}${joiner}_=${Date.now()}`;
        }

        function getWebcamVideoSourceUrl(video) {
            return video.dataset.fallbackActive === '1'
                ? video.dataset.fallbackUrl
                : video.dataset.embedUrl;
        }

        function reloadWebcamVideo(marker, video) {
            const base = getWebcamVideoSourceUrl(video);
            if (!base) return;
            video.src = cacheBustUrl(base);
            video.load();
            video.play().catch(() => {});
        }

        function bindWebcamLiveVideo(marker, video) {
            video.onended = () => reloadWebcamVideo(marker, video);
        }

        function startWebcamVideoRefresh(marker, video, refreshMs) {
            clearInterval(marker._webcamVideoTimer);
            if (!refreshMs) return;
            marker._webcamVideoTimer = window.setInterval(() => {
                reloadWebcamVideo(marker, video);
            }, refreshMs);
        }

        function activateWebcamImage(marker, image) {
            const refreshMs = Number(image.dataset.refreshMs) || 8000;
            const refreshImage = () => {
                image.src = cacheBustUrl(image.dataset.embedUrl);
            };
            refreshImage();
            clearInterval(marker._webcamImageTimer);
            marker._webcamImageTimer = window.setInterval(refreshImage, refreshMs);
        }

        function activateWebcamVideo(marker, video) {
            const embedType = video.dataset.embedType || 'video';
            const refreshMs = Number(video.dataset.refreshMs) || (embedType === 'video' ? 4000 : 0);

            const playMp4 = (url, { fallback = false } = {}) => {
                video.dataset.fallbackActive = fallback ? '1' : '0';
                bindWebcamLiveVideo(marker, video);
                reloadWebcamVideo(marker, video);
                startWebcamVideoRefresh(marker, video, refreshMs);
            };

            if (embedType === 'hls') {
                loadWebcamHlsLibrary()
                    .then(Hls => {
                        if (Hls.isSupported()) {
                            const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
                            marker._webcamHls = hls;
                            hls.loadSource(video.dataset.embedUrl);
                            hls.attachMedia(video);
                            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                                video.play().catch(() => {});
                            });
                            hls.on(Hls.Events.ERROR, (_event, data) => {
                                if (!data.fatal || !video.dataset.fallbackUrl) return;
                                hls.destroy();
                                marker._webcamHls = null;
                                playMp4(video.dataset.fallbackUrl, { fallback: true });
                            });
                            return;
                        }
                        if (video.canPlayType('application/vnd.apple.mpegurl')) {
                            video.src = video.dataset.embedUrl;
                            video.play().catch(() => {
                                if (video.dataset.fallbackUrl) {
                                    playMp4(video.dataset.fallbackUrl, { fallback: true });
                                }
                            });
                            return;
                        }
                        if (video.dataset.fallbackUrl) {
                            playMp4(video.dataset.fallbackUrl, { fallback: true });
                        }
                    })
                    .catch(() => {
                        if (video.dataset.fallbackUrl) {
                            playMp4(video.dataset.fallbackUrl, { fallback: true });
                        }
                    });
                return;
            }

            playMp4(video.dataset.embedUrl);
        }

        function activateWebcamPopupMedia(marker) {
            const popupEl = marker.getPopup()?.getElement();
            if (!popupEl) return;

            const image = popupEl.querySelector('.webcam-popup-image[data-embed-url]');
            if (image) {
                activateWebcamImage(marker, image);
                return;
            }

            const video = popupEl.querySelector('.webcam-popup-video[data-embed-url]');
            if (video) {
                activateWebcamVideo(marker, video);
            }
        }

        function deactivateWebcamPopupMedia(marker) {
            clearInterval(marker._webcamImageTimer);
            clearInterval(marker._webcamVideoTimer);
            marker._webcamImageTimer = null;
            marker._webcamVideoTimer = null;

            if (marker._webcamHls) {
                marker._webcamHls.destroy();
                marker._webcamHls = null;
            }

            const popupEl = marker.getPopup()?.getElement();
            if (!popupEl) return;

            const video = popupEl.querySelector('.webcam-popup-video');
            if (video) {
                video.onended = null;
                video.pause();
                video.removeAttribute('src');
                video.load();
            }
        }

        function makeWebcamMarker(feature) {
            const props = feature.properties || {};
            const coords = feature.geometry?.coordinates;
            if (!coords) return null;

            const color = WEBCAM_CATEGORY_COLORS[props.category] || '#0E7490';
            const marker = L.marker([coords[1], coords[0]], {
                icon: L.divIcon({
                    className: 'webcam-marker-wrapper',
                    html: `<div class="webcam-marker" data-category="${props.category || ''}" style="--webcam-color:${color};"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg></div>`,
                    iconSize: [26, 26],
                    iconAnchor: [13, 13]
                }),
                zIndexOffset: 420
            });

            marker.bindTooltip(props.name || 'Webcam', { direction: 'top', offset: [0, -10] });
            marker.bindPopup(buildWebcamPopup(props), {
                maxWidth: 440,
                minWidth: 320,
                className: 'webcam-leaflet-popup'
            });
            marker.on('popupopen', () => activateWebcamPopupMedia(marker));
            marker.on('popupclose', () => deactivateWebcamPopupMedia(marker));
            marker.webcamCategory = props.category || 'traffic';
            marker.webcamProps = props;
            return marker;
        }

        // Deux caméras d'un même giratoire ne sont séparées que par quelques mètres :
        // elles resteraient superposées jusqu'au zoom maximal, la seconde étant alors
        // inatteignable. On les regroupe et le popup sert de sélecteur.
        const WEBCAM_CLUSTER_CELL_PX = 34;

        function webcamClusterIcon(count) {
            return L.divIcon({
                className: 'webcam-marker-wrapper',
                html: `<div class="webcam-marker is-cluster"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg><span class="webcam-cluster-count">${count}</span></div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
        }

        function webcamClusterListHtml(markers) {
            const items = markers.map((marker, i) => `
                <button type="button" class="webcam-cluster-item" data-index="${i}">
                    <span class="webcam-cluster-dot" style="--webcam-color:${WEBCAM_CATEGORY_COLORS[marker.webcamCategory] || '#0E7490'};"></span>
                    ${escapeWebcamHtml(marker.webcamProps.name || 'Webcam')}
                </button>`).join('');
            return `<div class="route-popup webcam-popup webcam-cluster-popup">
                <div class="webcam-cluster-title">${markers.length} caméras à cet endroit</div>
                <div class="webcam-cluster-list">${items}</div>
            </div>`;
        }

        function showWebcamFromCluster(cluster, index) {
            const marker = cluster.webcamMembers[index];
            if (!marker) return;
            deactivateWebcamPopupMedia(cluster);
            cluster.setPopupContent(`<div class="route-popup webcam-popup">
                <button type="button" class="webcam-cluster-back">‹ ${cluster.webcamMembers.length} caméras</button>
                <div class="webcam-cluster-title">${escapeWebcamHtml(marker.webcamProps.name || 'Webcam')}</div>
                ${buildWebcamEmbedMarkup(marker.webcamProps)}
            </div>`);
            activateWebcamPopupMedia(cluster);
        }

        function makeWebcamClusterMarker(latlng, markers) {
            const cluster = L.marker(latlng, { icon: webcamClusterIcon(markers.length), zIndexOffset: 430 });
            cluster.webcamMembers = markers;
            cluster.bindTooltip(`${markers.length} caméras — cliquer pour choisir`, { direction: 'top', offset: [0, -10] });
            cluster.bindPopup(webcamClusterListHtml(markers), {
                maxWidth: 440,
                minWidth: 320,
                className: 'webcam-leaflet-popup'
            });
            cluster.on('popupopen', () => {
                const element = cluster.getPopup()?.getElement();
                if (!element || element._webcamClusterBound) return;
                // Délégation : le contenu est remplacé à chaque choix, le conteneur non.
                element._webcamClusterBound = true;
                element.addEventListener('click', event => {
                    const item = event.target.closest('.webcam-cluster-item');
                    const back = event.target.closest('.webcam-cluster-back');
                    if (!item && !back) return;
                    // Remplacer le contenu détache le bouton cliqué : Leaflet ne
                    // retrouve alors plus le popup en remontant le DOM et prend le
                    // clic pour un clic carte, qui referme la fiche.
                    event.preventDefault();
                    event.stopPropagation();
                    if (item) {
                        showWebcamFromCluster(cluster, Number(item.dataset.index));
                        return;
                    }
                    deactivateWebcamPopupMedia(cluster);
                    cluster.setPopupContent(webcamClusterListHtml(cluster.webcamMembers));
                });
            });
            cluster.on('popupclose', () => {
                deactivateWebcamPopupMedia(cluster);
                cluster.setPopupContent(webcamClusterListHtml(cluster.webcamMembers));
            });
            return cluster;
        }

        function renderWebcams() {
            if (!webcamsLayerGroup || !window.map) return;
            webcamsLayerGroup.clearLayers();
            const zoom = window.map.getZoom();
            const clusters = [];
            webcamMarkers.forEach(marker => {
                if (webcamTypeVisibility[marker.webcamCategory] === false) return;
                const point = window.map.project(marker.getLatLng(), zoom);
                const near = clusters.find(cluster =>
                    Math.hypot(cluster.x - point.x, cluster.y - point.y) < WEBCAM_CLUSTER_CELL_PX);
                if (near) {
                    near.markers.push(marker);
                    near.sx += point.x;
                    near.sy += point.y;
                    near.x = near.sx / near.markers.length;
                    near.y = near.sy / near.markers.length;
                } else {
                    clusters.push({ x: point.x, y: point.y, sx: point.x, sy: point.y, markers: [marker] });
                }
            });
            clusters.forEach(cluster => {
                if (cluster.markers.length === 1) {
                    webcamsLayerGroup.addLayer(cluster.markers[0]);
                    return;
                }
                const center = window.map.unproject([cluster.x, cluster.y], zoom);
                makeWebcamClusterMarker(center, cluster.markers).addTo(webcamsLayerGroup);
            });
        }

        function setWebcamLegendCounts(features = []) {
            const counts = { traffic: 0, mountain: 0 };
            features.forEach(feature => {
                const category = feature.properties?.category;
                if (category && Object.prototype.hasOwnProperty.call(counts, category)) {
                    counts[category]++;
                }
            });
            const trafficEl = document.getElementById('count-webcams-traffic');
            const mountainEl = document.getElementById('count-webcams-mountain');
            if (trafficEl) trafficEl.textContent = counts.traffic.toLocaleString('fr-FR');
            if (mountainEl) mountainEl.textContent = counts.mountain.toLocaleString('fr-FR');
        }

        function applyWebcamsVisibleUi() {
            const icon = document.getElementById('webcamsToggleIcon');
            const title = document.querySelector('.legend-section:has([id="webcamsToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-webcam]');
            setToggleIcon(icon, true);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '700';
            updateSubtypeLegendUi('webcam', webcamTypeVisibility, true);
        }

        function applyWebcamsHiddenUi() {
            const icon = document.getElementById('webcamsToggleIcon');
            const title = document.querySelector('.legend-section:has([id="webcamsToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-webcam]');
            setToggleIcon(icon, false);
            if (title) title.style.fontWeight = '600';
            updateSubtypeLegendUi('webcam', webcamTypeVisibility, false);
        }

        function syncWebcamsOnMap() {
            if (!webcamsLayerGroup || !window.map) return;
            renderWebcams();
            const onMap = window.map.hasLayer(webcamsLayerGroup);
            if (webcamsVisible && !onMap) webcamsLayerGroup.addTo(window.map);
            if (!webcamsVisible && onMap) window.map.removeLayer(webcamsLayerGroup);

            if (webcamsVisible && !webcamsZoomHandler) {
                // Un flux vidéo ouvert ne doit pas être détruit par un simple
                // recentrage : on rattrape la vue à la fermeture du popup.
                webcamsZoomHandler = makeViewportRenderHandler(webcamsLayerGroup, renderWebcams);
                window.map.on('zoomend moveend popupclose', webcamsZoomHandler);
            } else if (!webcamsVisible && webcamsZoomHandler) {
                window.map.off('zoomend moveend popupclose', webcamsZoomHandler);
                webcamsZoomHandler = null;
            }
        }

        window.toggleWebcams = function() {
            webcamsVisible = !webcamsVisible;

            if (!webcamsVisible) {
                syncWebcamsOnMap();
                applyWebcamsHiddenUi();
                syncLegendChrome();
                return;
            }

            if (!webcamsLoaded) {
                const icon = document.getElementById('webcamsToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                if (typeof window.loadWebcams === 'function') {
                    window.loadWebcams({ show: true });
                }
                return;
            }

            syncWebcamsOnMap();
            applyWebcamsVisibleUi();
            syncLegendChrome();
        };

        window.toggleWebcamType = function(kind) {
            if (!webcamsVisible || !Object.prototype.hasOwnProperty.call(webcamTypeVisibility, kind)) return;
            webcamTypeVisibility[kind] = !webcamTypeVisibility[kind];
            syncWebcamsOnMap();
            updateSubtypeLegendUi('webcam', webcamTypeVisibility, true);
            syncLegendChrome();
        };

        window.loadWebcams = async function(options = {}) {
            const wantVisible = options.show === true || webcamsVisible || appUrlWantsLayer('wcam');
            try {
                const data = await window.InforouteApi.fetchGeoJson('webcams');
                const features = data.features || [];

                if (webcamsLayerGroup) {
                    window.map?.removeLayer(webcamsLayerGroup);
                    webcamsLayerGroup = null;
                }

                webcamsLayerGroup = L.layerGroup();
                webcamMarkers = [];
                features.forEach(feature => {
                    const marker = makeWebcamMarker(feature);
                    if (marker) webcamMarkers.push(marker);
                });

                webcamsLoaded = true;
                setWebcamLegendCounts(features);

                if (wantVisible) {
                    webcamsVisible = true;
                    syncWebcamsOnMap();
                    applyWebcamsVisibleUi();
                } else {
                    webcamsVisible = false;
                    syncWebcamsOnMap();
                    applyWebcamsHiddenUi();
                }

                syncLegendChrome();
                tryApplyAppUrlState();
                console.log(`✓ ${features.length} webcams chargées`);
            } catch (error) {
                console.error('Erreur chargement webcams:', error);
                if (!wantVisible) applyWebcamsHiddenUi();
                webcamsVisible = false;
                syncLegendChrome();
            }
        };

        // ========== ÉVÉNEMENTS (OEDB, incubateur) ==========
        // Couche alimentée par l'instance OpenEventDatabase statique
        // https://thepriben.github.io/oedb-rs/ (Bison Futé DATEX II filtré FR-84
        // + curation manuelle type Jeudis d'Orange), régénérée toutes les 3 h.

        const OEDB_EVENT_STYLE = {
            accident: { color: '#DC2626', glyph: '💥', label: 'Accident' },
            roadwork: { color: '#F59E0B', glyph: '🚧', label: 'Travaux' },
            jam: { color: '#B91C1C', glyph: '🚗', label: 'Bouchon' },
            culture: { color: '#059669', glyph: '🎪', label: 'Culture' },
            sport: { color: '#2563EB', glyph: '🏉', label: 'Sport' },
            other: { color: '#4B5563', glyph: 'ℹ️', label: 'Autre' }
        };

        // Taxonomie pointée OEDB (`what`) -> catégorie de légende.
        function oedbCategoryForWhat(what) {
            const value = String(what || '');
            if (value === 'traffic.accident') return 'accident';
            if (value === 'traffic.roadwork') return 'roadwork';
            if (value === 'traffic.jam') return 'jam';
            if (value.startsWith('culture.') || value === 'culture') return 'culture';
            if (value.startsWith('sport.') || value === 'sport') return 'sport';
            return 'other';
        }

        function escapeOedbHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function formatOedbDate(iso) {
            if (!iso) return '';
            const date = new Date(iso);
            if (Number.isNaN(date.getTime())) return escapeOedbHtml(iso);
            return date.toLocaleString('fr-FR', {
                day: 'numeric', month: 'short',
                hour: '2-digit', minute: '2-digit'
            });
        }

        // Formate la période d'un événement. Quand début et fin tombent le même
        // jour (typiquement les événements ponctuels — match, marché nocturne),
        // on présente « le <date> · <hh:mm> → <hh:mm> » plutôt que « du … au … ».
        function formatOedbPeriod(startIso, stopIso) {
            const start = startIso ? new Date(startIso) : null;
            const stop = stopIso ? new Date(stopIso) : null;
            const validStart = start && !Number.isNaN(start.getTime());
            const validStop = stop && !Number.isNaN(stop.getTime());

            if (validStart && validStop && start.toDateString() === stop.toDateString()) {
                const day = start.toLocaleDateString('fr-FR', {
                    weekday: 'long', day: 'numeric', month: 'long'
                });
                const from = start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                const to = stop.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                return `<span class="oedb-pop-day">${escapeOedbHtml(day)}</span><span class="oedb-pop-hours">${from} → ${to}</span>`;
            }

            return [
                validStart ? `du ${formatOedbDate(startIso)}` : '',
                validStop ? `au ${formatOedbDate(stopIso)}` : ''
            ].filter(Boolean).join(' ');
        }

        function oedbWikidataLink(qid, label) {
            const clean = String(qid || '').trim();
            if (!/^Q[1-9]\d*$/.test(clean)) return '';
            return `<a href="https://www.wikidata.org/wiki/${clean}" target="_blank" rel="noopener noreferrer">${escapeOedbHtml(label)}</a>`;
        }

        function buildOedbEventPopup(props = {}) {
            const category = oedbCategoryForWhat(props.what);
            const style = OEDB_EVENT_STYLE[category];
            const rows = [];

            if (props.start || props.stop) {
                const period = formatOedbPeriod(props.start, props.stop);
                if (period) rows.push(`<div class="oedb-pop-row oedb-pop-when">📅 ${period}</div>`);
            }
            const place = [props.road, props.commune || props.lieu].filter(Boolean).join(' — ');
            if (place) rows.push(`<div class="oedb-pop-row">📍 ${escapeOedbHtml(place)}</div>`);
            if (props.description && props.description !== props.label) {
                rows.push(`<div class="oedb-pop-row oedb-pop-desc">${escapeOedbHtml(props.description)}</div>`);
            }

            const wdLinks = [
                oedbWikidataLink(props.type_wikidata, 'type'),
                oedbWikidataLink(props.place_wikidata, 'lieu'),
                oedbWikidataLink(props.wikidata, 'événement')
            ].filter(Boolean);
            if (wdLinks.length) {
                rows.push(`<div class="oedb-pop-row oedb-pop-wd">🔗 Wikidata : ${wdLinks.join(' · ')}</div>`);
            }

            const sourceHtml = /^https?:\/\//.test(String(props.source || ''))
                ? `<a href="${escapeOedbHtml(props.source)}" target="_blank" rel="noopener noreferrer">source</a>`
                : escapeOedbHtml(props.source || '');

            return `<div class="route-popup oedb-event-popup" style="--oedb-color:${style.color};">
                <div class="oedb-pop-head" style="--oedb-color:${style.color};">
                    <span class="oedb-pop-glyph">${style.glyph}</span>
                    <strong>${escapeOedbHtml(props.label || style.label)}</strong>
                </div>
                <div class="oedb-pop-what"><code>${escapeOedbHtml(props.what || '')}</code> · ${props.type === 'scheduled' ? 'programmé' : 'imprévu'}</div>
                ${rows.join('')}
                ${sourceHtml ? `<div class="oedb-pop-links">${sourceHtml}</div>` : ''}
            </div>`;
        }

        function makeOedbEventMarker(feature) {
            const coords = feature.geometry?.coordinates;
            if (!coords || feature.geometry.type !== 'Point') return null;
            const props = feature.properties || {};
            const category = oedbCategoryForWhat(props.what);
            const style = OEDB_EVENT_STYLE[category];

            const marker = L.marker([coords[1], coords[0]], {
                icon: L.divIcon({
                    className: 'oedb-event-marker-wrapper',
                    html: `<div class="oedb-event-marker" style="--oedb-color:${style.color};">${style.glyph}</div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                }),
                zIndexOffset: 430
            });
            marker.bindTooltip(props.label || style.label, { direction: 'top', offset: [0, -12] });
            marker.bindPopup(buildOedbEventPopup(props), { maxWidth: 320 });
            marker.oedbCategory = category;
            return marker;
        }

        function setOedbEventsLegendCounts(features = []) {
            const counts = { accident: 0, roadwork: 0, jam: 0, culture: 0, sport: 0, other: 0 };
            features.forEach(feature => {
                counts[oedbCategoryForWhat(feature.properties?.what)] += 1;
            });
            Object.entries(counts).forEach(([category, count]) => {
                const el = document.getElementById(`count-oedb-${category}`);
                if (el) el.textContent = String(count);
            });
        }

        function applyOedbEventsVisibleUi() {
            const icon = document.getElementById('oedbEventsToggleIcon');
            const title = document.querySelector('.legend-section:has([id="oedbEventsToggleIcon"]) .legend-title');
            setToggleIcon(icon, true);
            if (title) title.style.opacity = '1';
            updateSubtypeLegendUi('oedb-event', oedbEventTypeVisibility, true);
        }

        function applyOedbEventsHiddenUi() {
            const icon = document.getElementById('oedbEventsToggleIcon');
            const title = document.querySelector('.legend-section:has([id="oedbEventsToggleIcon"]) .legend-title');
            setToggleIcon(icon, false);
            if (title) title.style.opacity = '';
            updateSubtypeLegendUi('oedb-event', oedbEventTypeVisibility, false);
        }

        // Grappe sobre : pastille ronde teintée de la catégorie dominante des
        // marqueurs regroupés, avec le compte. Regroupe les événements proches
        // (ex. les 4 Jeudis d'Orange étalés sur ~25 m) au dézoom.
        function createOedbClusterIcon(cluster) {
            const markers = cluster.getAllChildMarkers();
            const tally = {};
            markers.forEach(marker => {
                tally[marker.oedbCategory] = (tally[marker.oedbCategory] || 0) + 1;
            });
            const dominant = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
            const color = (OEDB_EVENT_STYLE[dominant] || OEDB_EVENT_STYLE.other).color;
            const count = cluster.getChildCount();
            const size = count >= 100 ? 40 : count >= 10 ? 34 : 30;
            return L.divIcon({
                className: 'oedb-cluster-wrapper',
                html: `<div class="oedb-cluster" style="--oedb-color:${color};width:${size}px;height:${size}px;">${count}</div>`,
                iconSize: [size, size]
            });
        }

        function makeOedbClusterGroup() {
            if (typeof L.markerClusterGroup !== 'function') {
                // Repli si la librairie markercluster n'a pas chargé.
                return L.layerGroup();
            }
            return L.markerClusterGroup({
                maxClusterRadius: 44,
                showCoverageOnHover: false,
                spiderfyOnMaxZoom: true,
                disableClusteringAtZoom: 16,
                iconCreateFunction: createOedbClusterIcon
            });
        }

        function syncOedbEventsOnMap() {
            if (!oedbEventsLayerGroup || !window.map) return;
            oedbEventsLayerGroup.clearLayers();
            const visibleMarkers = oedbEventMarkers.filter(
                marker => oedbEventTypeVisibility[marker.oedbCategory] !== false
            );
            if (typeof oedbEventsLayerGroup.addLayers === 'function') {
                oedbEventsLayerGroup.addLayers(visibleMarkers);
            } else {
                visibleMarkers.forEach(marker => oedbEventsLayerGroup.addLayer(marker));
            }
            const onMap = window.map.hasLayer(oedbEventsLayerGroup);
            if (oedbEventsVisible && !onMap) oedbEventsLayerGroup.addTo(window.map);
            if (!oedbEventsVisible && onMap) window.map.removeLayer(oedbEventsLayerGroup);
        }

        window.toggleOedbEvents = function() {
            oedbEventsVisible = !oedbEventsVisible;

            if (!oedbEventsVisible) {
                syncOedbEventsOnMap();
                applyOedbEventsHiddenUi();
                syncLegendChrome();
                return;
            }

            if (!oedbEventsLoaded) {
                const icon = document.getElementById('oedbEventsToggleIcon');
                if (icon) icon.style.opacity = '0.4';
                if (typeof window.loadOedbEvents === 'function') {
                    window.loadOedbEvents({ show: true });
                }
                return;
            }

            syncOedbEventsOnMap();
            applyOedbEventsVisibleUi();
            syncLegendChrome();
        };

        window.toggleOedbEventType = function(kind) {
            if (!oedbEventsVisible || !Object.prototype.hasOwnProperty.call(oedbEventTypeVisibility, kind)) return;
            oedbEventTypeVisibility[kind] = !oedbEventTypeVisibility[kind];
            syncOedbEventsOnMap();
            updateSubtypeLegendUi('oedb-event', oedbEventTypeVisibility, true);
            syncLegendChrome();
        };

        window.loadOedbEvents = async function(options = {}) {
            const wantVisible = options.show === true || oedbEventsVisible || appUrlWantsLayer('oedb');
            try {
                const data = await window.InforouteApi.fetchGeoJson('oedb-events');
                const features = data.features || [];

                renderFreshnessBadge(document.getElementById('freshness-oedb-events'), {
                    generatedAt: data._cache?.generated_at,
                    scheduleKey: 'external'
                });

                if (oedbEventsLayerGroup) {
                    window.map?.removeLayer(oedbEventsLayerGroup);
                    oedbEventsLayerGroup = null;
                }

                oedbEventsLayerGroup = makeOedbClusterGroup();
                oedbEventMarkers = [];
                features.forEach(feature => {
                    const marker = makeOedbEventMarker(feature);
                    if (marker) oedbEventMarkers.push(marker);
                });

                oedbEventsLoaded = true;
                setOedbEventsLegendCounts(features);

                if (wantVisible) {
                    oedbEventsVisible = true;
                    syncOedbEventsOnMap();
                    applyOedbEventsVisibleUi();
                } else {
                    oedbEventsVisible = false;
                    syncOedbEventsOnMap();
                    applyOedbEventsHiddenUi();
                }

                syncLegendChrome();
                tryApplyAppUrlState();
                console.log(`✓ ${features.length} événements OEDB chargés`);
            } catch (error) {
                console.error('Erreur chargement événements OEDB:', error);
                renderFreshnessBadge(document.getElementById('freshness-oedb-events'), {
                    scheduleKey: 'external',
                    errorMsg: error.message
                });
                if (!wantVisible) applyOedbEventsHiddenUi();
                oedbEventsVisible = false;
                syncLegendChrome();
            }
        };

        // ========== AIRES CONNEXES (covoiturage / repos / parkings-relais) ==========
        // Issue #7 : thématiques connexes valorisant d'autres missions du CD84,
        // intégrées dans la cartographie factuelle (hors incubation).

        const ROADSIDE_AREA_STYLE = {
            car_pooling: { color: '#2E7D32', glyph: '🚗', label: 'Aire de covoiturage' },
            rest_area: { color: '#00897B', glyph: '🌳', label: 'Aire de repos' },
            park_ride: { color: '#3949AB', glyph: '🅿️', label: 'Parking-relais' },
            layby: { color: '#F57C00', glyph: '🅿️', label: "Aire d'arrêt" }
        };

        // Valorisation de la complétude OSM : quelques attributs clés attendus sur
        // une aire, avec un score présent/total pour inciter à la contribution.
        const AREA_COMPLETENESS_FIELDS = [
            { key: 'name', label: 'Nom' },
            { key: 'capacity', label: 'Capacité' },
            { key: 'access', label: 'Accès' },
            { key: 'surface', label: 'Revêtement' },
            { key: 'lit', label: 'Éclairage' },
            { key: 'operator', label: 'Gestionnaire' }
        ];

        function roadsideCompleteness(props) {
            const items = AREA_COMPLETENESS_FIELDS.map(field => {
                const present = field.key === 'operator'
                    ? Boolean(props.operator || props.network)
                    : props[field.key] !== undefined && props[field.key] !== '';
                return { label: field.label, present };
            });
            const score = items.filter(item => item.present).length;
            return { items, score, total: items.length };
        }

        // --- Recherche d'une photo de rue Panoramax à proximité immédiate d'un point ---
        const panoramaxNearbyCache = new Map();

        function haversineMeters(aLat, aLon, bLat, bLon) {
            const R = 6371000;
            const dLat = (bLat - aLat) * Math.PI / 180;
            const dLon = (bLon - aLon) * Math.PI / 180;
            const s = Math.sin(dLat / 2) ** 2
                + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
        }

        async function fetchPanoramaxNearby(lat, lng, radiusM = 130) {
            const key = `${lat.toFixed(4)}|${lng.toFixed(4)}`;
            if (panoramaxNearbyCache.has(key)) return panoramaxNearbyCache.get(key);

            let result = null;
            try {
                const dLat = radiusM / 111320;
                const dLon = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
                const bbox = `${lng - dLon},${lat - dLat},${lng + dLon},${lat + dLat}`;
                const resp = await fetch(`https://api.panoramax.xyz/api/search?bbox=${bbox}&limit=30`, { credentials: 'omit' });
                if (resp.ok) {
                    const data = await resp.json();
                    let best = null;
                    let bestDist = Infinity;
                    (data.features || []).forEach(feature => {
                        const c = feature.geometry?.coordinates;
                        if (!c) return;
                        const dist = haversineMeters(lat, lng, c[1], c[0]);
                        if (dist < bestDist) { bestDist = dist; best = feature; }
                    });
                    if (best && bestDist <= radiusM) {
                        const thumb = best.assets?.thumb?.href || (window.panoramaxImageUrl && window.panoramaxImageUrl(best.id, 'thumb'));
                        const large = best.assets?.sd?.href || (window.panoramaxImageUrl && window.panoramaxImageUrl(best.id, 'sd'));
                        // Le viewer du méta-catalogue (api.panoramax.xyz) ne cible pas
                        // proprement une photo fédérée : on ouvre l'instance d'origine
                        // (lien `via`) qui héberge la photo et a un vrai viewer.
                        const viaLink = (best.links || []).find(l => l && l.rel === 'via' && typeof l.href === 'string');
                        let viewer = viaLink ? viaLink.href.replace(/\/+$/, '') : null;
                        if (!viewer && best.assets?.hd?.href) {
                            try { viewer = new URL(best.assets.hd.href).origin; } catch (e) { viewer = null; }
                        }
                        result = {
                            id: best.id,
                            seq: best.collection || null,
                            viewer: viewer || 'https://panoramax.openstreetmap.fr',
                            thumb,
                            large,
                            datetime: best.properties?.datetime,
                            dist: Math.round(bestDist)
                        };
                    }
                }
            } catch (error) {
                result = null;
            }

            panoramaxNearbyCache.set(key, result);
            return result;
        }

        function roadsidePhotoDate(value) {
            if (!value) return '';
            const d = new Date(value);
            return Number.isNaN(d.getTime())
                ? ''
                : d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short' });
        }

        function roadsidePhotosHtml(photos, state) {
            if (state === 'loading') {
                return `<div class="area-pop-photos-msg">📷 Recherche de photos de rue (Mapillary/Panoramax)…</div>`;
            }

            const cards = [];
            if (photos && photos.panoramax) {
                const when = roadsidePhotoDate(photos.panoramax.datetime);
                const src = (window.panoramaxPageUrl && window.panoramaxPageUrl(photos.panoramax.id, photos.panoramax.seq, photos.panoramax.viewer)) || '#';
                const label = `Panoramax${when ? ' · ' + when : ''}`;
                cards.push(`
                    <a class="area-pop-photo" href="${src}" target="_blank" rel="noopener noreferrer"
                       data-big="${escapeHtml(photos.panoramax.large || photos.panoramax.thumb)}"
                       data-src="${escapeHtml(src)}" data-provider="Panoramax" data-label="${escapeHtml(label)}">
                        <img src="${photos.panoramax.thumb}" alt="Photo Panoramax à proximité" loading="lazy">
                        <span class="area-pop-photo-badge is-panoramax">${label}</span>
                        <span class="area-pop-photo-zoom" aria-hidden="true">↗</span>
                    </a>`);
            }
            if (photos && photos.mapillary && photos.mapillary.thumb_1024_url) {
                const when = roadsidePhotoDate(photos.mapillary.captured_at);
                const src = (window.mapillaryPageUrl && window.mapillaryPageUrl(photos.mapillary.id)) || '#';
                const big = photos.mapillary.thumb_2048_url || photos.mapillary.thumb_1024_url;
                const label = `Mapillary${when ? ' · ' + when : ''}`;
                cards.push(`
                    <a class="area-pop-photo" href="${src}" target="_blank" rel="noopener noreferrer"
                       data-big="${escapeHtml(big)}"
                       data-src="${escapeHtml(src)}" data-provider="Mapillary" data-label="${escapeHtml(label)}">
                        <img src="${photos.mapillary.thumb_1024_url}" alt="Photo Mapillary à proximité" loading="lazy">
                        <span class="area-pop-photo-badge is-mapillary">${label}</span>
                        <span class="area-pop-photo-zoom" aria-hidden="true">↗</span>
                    </a>`);
            }

            if (!cards.length) {
                return `<div class="area-pop-photos-msg">Pas de photo de rue à proximité (Mapillary/Panoramax).</div>`;
            }
            return `<div class="area-pop-photos">${cards.join('')}</div>`;
        }

        // Clic sur une vignette d'aire : ouvrir le viewer source dans un nouvel
        // onglet, sans fermer la popup Leaflet (stopPropagation). On neutralise
        // TOUJOURS le comportement par défaut du lien AVANT tout `return`, sinon
        // un href="#" ouvrirait notre propre site (dataroads) dans un onglet.
        // On n'ouvre que des URLs absolues http(s).
        document.addEventListener('click', event => {
            const photo = event.target.closest && event.target.closest('.area-pop-photo');
            if (!photo) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
            event.preventDefault();
            event.stopPropagation();
            const href = photo.getAttribute('href');
            if (href && /^https?:\/\//i.test(href)) {
                window.open(href, '_blank', 'noopener,noreferrer');
            }
        });

        function buildRoadsideAreaPopup(props, photos, photosState) {
            const style = ROADSIDE_AREA_STYLE[props.area_kind] || { color: '#3949AB', label: 'Aire' };
            const title = props.name || style.label;

            const rows = [];
            const addRow = (label, value) => {
                if (value === undefined || value === null || value === '') return;
                rows.push(`<dt>${label}</dt><dd>${escapeHtml(String(value))}</dd>`);
            };

            addRow('Capacité', props.capacity);
            addRow('Dont PMR', props['capacity:disabled']);
            addRow('Gestion', props.operator || props.network);
            if (props.park_ride && props.area_kind === 'park_ride') {
                addRow('Type', 'Parking-relais (park & ride)');
            }
            if (props.access) addRow('Accès', props.access);
            if (props.fee) addRow('Payant', props.fee === 'yes' ? 'oui' : (props.fee === 'no' ? 'non' : props.fee));
            addRow('Horaires', props.opening_hours);
            addRow('Revêtement', props.surface);
            if (props.description) addRow('Note', props.description);

            const completeness = roadsideCompleteness(props);
            const chips = completeness.items.map(item =>
                `<span class="area-pop-chip ${item.present ? 'is-present' : 'is-missing'}">${item.present ? '✓' : '✗'} ${escapeHtml(item.label)}</span>`
            ).join('');

            const osmType = props.osm_type || 'node';
            const osmId = props.osm_id;
            // Un seul bloc OpenStreetMap avec deux actions compactes (voir / compléter)
            // pour éviter la redondance de deux gros liens « … sur OSM ».
            const osmLine = osmId
                ? `<span class="area-pop-src"><span class="area-pop-src-label">OpenStreetMap</span>
                        <a href="https://www.openstreetmap.org/${osmType}/${osmId}" target="_blank" rel="noopener noreferrer">voir</a>
                        <span class="area-pop-src-sep">·</span>
                        <a href="https://www.openstreetmap.org/edit?${osmType}=${osmId}" target="_blank" rel="noopener noreferrer">compléter</a>
                   </span>`
                : '';

            const wikidataQid = /^Q\d+$/.test(String(props.wikidata || '').trim()) ? props.wikidata.trim() : null;
            const wikidataLine = wikidataQid
                ? `<span class="area-pop-src"><span class="area-pop-src-label">Wikidata</span>
                        <a href="https://www.wikidata.org/wiki/${wikidataQid}" target="_blank" rel="noopener noreferrer">${escapeHtml(wikidataQid)} →</a>
                   </span>`
                : `<span class="area-pop-src is-none"><span class="area-pop-src-label">Wikidata</span> aucun lien</span>`;

            return `
                <div class="area-pop" style="--area-color:${style.color};">
                    <h3>${escapeHtml(title)}</h3>
                    <span class="area-pop-kind">${escapeHtml(style.label)}</span>
                    ${rows.length ? `<dl>${rows.join('')}</dl>` : ''}
                    <div class="area-pop-complete">
                        <div class="area-pop-complete-head">Complétude OSM <strong>${completeness.score}/${completeness.total}</strong></div>
                        <div class="area-pop-chips">${chips}</div>
                    </div>
                    <div class="area-pop-photos-wrap">${roadsidePhotosHtml(photos, photosState)}</div>
                    <div class="area-pop-links">${osmLine}${wikidataLine}</div>
                </div>`;
        }

        function roadsideAreaCenter(feature) {
            const props = feature.properties || {};
            if (Array.isArray(props.center) && props.center.length === 2) {
                return [props.center[1], props.center[0]];
            }
            const geom = feature.geometry || {};
            if (geom.type === 'Point') return [geom.coordinates[1], geom.coordinates[0]];
            if (geom.type === 'LineString' && geom.coordinates.length) {
                const c = geom.coordinates[0];
                return [c[1], c[0]];
            }
            if (geom.type === 'Polygon' && geom.coordinates[0]?.length) {
                const c = geom.coordinates[0][0];
                return [c[1], c[0]];
            }
            return null;
        }

        // Retourne les couches d'une aire : l'emprise surfacique (polygone au
        // remplissage clair coordonné) quand elle existe, + un marqueur central.
        function makeRoadsideAreaLayers(feature) {
            const props = feature.properties || {};
            const style = ROADSIDE_AREA_STYLE[props.area_kind];
            if (!style) return [];

            const center = roadsideAreaCenter(feature);
            if (!center) return [];
            const [lat, lng] = center;

            const layers = [];
            const geom = feature.geometry || {};

            if (geom.type === 'Polygon' || geom.type === 'MultiPolygon' || geom.type === 'LineString') {
                const isLine = geom.type === 'LineString';
                const shape = L.geoJSON(geom, {
                    style: {
                        color: style.color,
                        weight: isLine ? 3 : 1.5,
                        opacity: 0.9,
                        fill: !isLine,
                        fillColor: style.color,
                        fillOpacity: 0.16
                    }
                });
                shape.bindTooltip(props.name || style.label, { sticky: true });
                layers.push(shape);
            }

            const marker = L.marker([lat, lng], {
                icon: L.divIcon({
                    className: 'area-marker-wrapper',
                    html: `<div class="area-marker" data-kind="${props.area_kind}" style="--area-color:${style.color};">${style.glyph}</div>`,
                    iconSize: [26, 26],
                    iconAnchor: [13, 13]
                }),
                zIndexOffset: 300
            });

            marker.bindTooltip(props.name || style.label, { direction: 'top', offset: [0, -12] });
            marker.bindPopup(buildRoadsideAreaPopup(props, null, 'loading'), {
                maxWidth: 340,
                minWidth: 240,
                className: 'area-leaflet-popup'
            });

            // Photos de rue à proximité (Mapillary + Panoramax), chargées à l'ouverture
            // du popup pour ne pas multiplier les appels API au chargement de la couche.
            marker.on('popupopen', () => {
                if (marker._areaPhotosDone) {
                    if (marker._areaPhotos !== undefined) {
                        marker.setPopupContent(buildRoadsideAreaPopup(props, marker._areaPhotos, 'done'));
                    }
                    return;
                }
                marker._areaPhotosDone = true;
                const mlyCheck = window.checkMapillaryNearby
                    ? window.checkMapillaryNearby(lat, lng)
                    : Promise.resolve(null);
                Promise.allSettled([mlyCheck, fetchPanoramaxNearby(lat, lng)]).then(([mly, pnx]) => {
                    const photos = {
                        mapillary: mly.status === 'fulfilled' ? mly.value : null,
                        panoramax: pnx.status === 'fulfilled' ? pnx.value : null
                    };
                    marker._areaPhotos = photos;
                    marker.setPopupContent(buildRoadsideAreaPopup(props, photos, 'done'));
                });
            });

            // Le polygone ouvre le popup du marqueur (photos + complétude).
            if (layers.length) {
                layers[0].on('click', () => marker.openPopup());
            }

            layers.push(marker);
            return layers;
        }

        function setRoadsideAreasLegendCounts(features = []) {
            const counts = { car_pooling: 0, rest_area: 0, park_ride: 0, layby: 0 };
            features.forEach(feature => {
                const kind = feature.properties?.area_kind;
                if (kind && Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind]++;
            });
            const map = {
                'count-roadside-carpooling': counts.car_pooling,
                'count-roadside-restarea': counts.rest_area,
                'count-roadside-parkride': counts.park_ride,
                'count-roadside-layby': counts.layby
            };
            Object.entries(map).forEach(([id, value]) => {
                const el = document.getElementById(id);
                if (el) el.textContent = value.toLocaleString('fr-FR');
            });
        }

        function applyRoadsideAreasVisibleUi() {
            const icon = document.getElementById('roadsideAreasToggleIcon');
            const title = document.querySelector('.legend-section:has([id="roadsideAreasToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-roadside-area]');
            setToggleIcon(icon, true);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '700';
            updateSubtypeLegendUi('roadside-area', roadsideAreaTypeVisibility, true);
        }

        function applyRoadsideAreasHiddenUi() {
            const icon = document.getElementById('roadsideAreasToggleIcon');
            const title = document.querySelector('.legend-section:has([id="roadsideAreasToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-roadside-area]');
            setToggleIcon(icon, false);
            if (title) title.style.fontWeight = '600';
            updateSubtypeLegendUi('roadside-area', roadsideAreaTypeVisibility, false);
        }

        function syncRoadsideAreasOnMap() {
            if (!roadsideAreasLayerGroup || !window.map) return;
            Object.entries(roadsideAreaLayerGroups).forEach(([kind, group]) => {
                const included = roadsideAreasLayerGroup.hasLayer(group);
                if (roadsideAreaTypeVisibility[kind] !== false && !included) {
                    roadsideAreasLayerGroup.addLayer(group);
                } else if (roadsideAreaTypeVisibility[kind] === false && included) {
                    roadsideAreasLayerGroup.removeLayer(group);
                }
            });
            const onMap = window.map.hasLayer(roadsideAreasLayerGroup);
            if (roadsideAreasVisible && !onMap) roadsideAreasLayerGroup.addTo(window.map);
            if (!roadsideAreasVisible && onMap) window.map.removeLayer(roadsideAreasLayerGroup);
        }

        window.toggleRoadsideAreas = function() {
            roadsideAreasVisible = !roadsideAreasVisible;

            if (!roadsideAreasVisible) {
                syncRoadsideAreasOnMap();
                applyRoadsideAreasHiddenUi();
                syncLegendChrome();
                return;
            }

            if (!roadsideAreasLoaded) {
                const icon = document.getElementById('roadsideAreasToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                if (typeof window.loadRoadsideAreas === 'function') {
                    window.loadRoadsideAreas({ show: true });
                }
                return;
            }

            syncRoadsideAreasOnMap();
            applyRoadsideAreasVisibleUi();
            syncLegendChrome();
        };

        window.toggleRoadsideAreaType = function(kind) {
            if (!roadsideAreasVisible || !Object.prototype.hasOwnProperty.call(roadsideAreaTypeVisibility, kind)) return;
            roadsideAreaTypeVisibility[kind] = !roadsideAreaTypeVisibility[kind];
            syncRoadsideAreasOnMap();
            updateSubtypeLegendUi('roadside-area', roadsideAreaTypeVisibility, true);
            syncLegendChrome();
        };

        window.loadRoadsideAreas = async function(options = {}) {
            const wantVisible = options.show === true || roadsideAreasVisible || appUrlWantsLayer('aires');
            try {
                const data = await window.InforouteApi.fetchGeoJson('roadside-areas');
                renderFreshnessBadge(document.getElementById('freshness-roadside-areas'), {
                    generatedAt: data._cache?.generated_at,
                    scheduleKey: 'osm'
                });

                const features = data.features || [];

                if (roadsideAreasLayerGroup) {
                    window.map?.removeLayer(roadsideAreasLayerGroup);
                    roadsideAreasLayerGroup = null;
                }

                roadsideAreasLayerGroup = L.layerGroup();
                Object.keys(roadsideAreaTypeVisibility).forEach(kind => {
                    roadsideAreaLayerGroups[kind] = L.layerGroup();
                });
                features.forEach(feature => {
                    const kind = feature.properties?.area_kind;
                    const group = roadsideAreaLayerGroups[kind];
                    if (!group) return;
                    makeRoadsideAreaLayers(feature).forEach(layer => group.addLayer(layer));
                });

                roadsideAreasLoaded = true;
                setRoadsideAreasLegendCounts(features);

                if (wantVisible) {
                    roadsideAreasVisible = true;
                    syncRoadsideAreasOnMap();
                    applyRoadsideAreasVisibleUi();
                } else {
                    roadsideAreasVisible = false;
                    syncRoadsideAreasOnMap();
                    applyRoadsideAreasHiddenUi();
                }

                syncLegendChrome();
                tryApplyAppUrlState();
                console.log(`✓ ${features.length} aires connexes chargées`);
            } catch (error) {
                console.error('Erreur chargement aires connexes:', error);
                if (!wantVisible) applyRoadsideAreasHiddenUi();
                roadsideAreasVisible = false;
                syncLegendChrome();
            }
        };

        // ========== ROADS UNDER CONSTRUCTION ==========
        
        // Helper that applies the "layer visible" state to UI elements.
        function applyConstructionVisibleUi() {
            const icon = document.getElementById('constructionToggleIcon');
            const title = document.querySelector('.legend-section:has([id="constructionToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-construction]');
            setToggleIcon(icon, true);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '700';
            updateSubtypeLegendUi('construction', constructionTypeVisibility, true);
        }

        function applyConstructionHiddenUi() {
            const icon = document.getElementById('constructionToggleIcon');
            const title = document.querySelector('.legend-section:has([id="constructionToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-construction]');
            setToggleIcon(icon, false);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '600';
            updateSubtypeLegendUi('construction', constructionTypeVisibility, false);
        }

        function clearConstructionPolylines() {
            constructionPolylines.forEach(polyline => {
                if (window.map?.hasLayer(polyline)) window.map.removeLayer(polyline);
            });
            constructionPolylines = [];
        }

        function syncConstructionPolylinesOnMap() {
            constructionPolylines.forEach(polyline => {
                const onMap = window.map?.hasLayer(polyline);
                const typeVisible = constructionTypeVisibility[polyline.constructionType] !== false;
                if (constructionVisible && typeVisible && !onMap) polyline.addTo(window.map);
                if ((!constructionVisible || !typeVisible) && onMap) window.map.removeLayer(polyline);
            });
        }

        function applyConstructionLayerUi() {
            if (constructionVisible) applyConstructionVisibleUi();
            else applyConstructionHiddenUi();
        }

        window.toggleConstruction = function() {
            constructionVisible = !constructionVisible;
            console.log('🔵 toggleConstruction →', constructionVisible);

            if (!constructionVisible) {
                syncConstructionPolylinesOnMap();
                applyConstructionHiddenUi();
                syncLegendChrome();
                console.log('✗ Routes en construction masquées');
                return;
            }

            // To show: if never loaded, start local fetch (instant).
            // No fake 30 s timer: this is just a local GeoJSON read.
            if (constructionPolylines.length === 0) {
                applyConstructionVisibleUi();
                syncLegendChrome();
                window.loadConstructionRoads();
                return;
            }

            syncConstructionPolylinesOnMap();
            applyConstructionVisibleUi();
            syncLegendChrome();
            console.log(`✓ ${constructionPolylines.length} polyline(s) construction affichée(s)`);
        };

        window.toggleConstructionType = function(kind) {
            if (!constructionVisible || !Object.prototype.hasOwnProperty.call(constructionTypeVisibility, kind)) return;
            constructionTypeVisibility[kind] = !constructionTypeVisibility[kind];
            syncConstructionPolylinesOnMap();
            updateSubtypeLegendUi('construction', constructionTypeVisibility, true);
            syncLegendChrome();
        };

        // ========== BIKE ROUTES (OSM route=bicycle relations) ==========

        const BICYCLE_STRUCTURANTES = {
            EV17: { label: 'Via Rhôna', colour: '#DCD431', weight: 6 },
            EV8: { label: 'La route de la Méditerranée', colour: '#9f5723', weight: 6 },
            V861: { label: 'Via Venaissia', colour: '#59D422', weight: 5 }
        };
        const BICYCLE_STRUCTURANTE_PRIORITY = ['EV17', 'EV8', 'V861'];
        const BICYCLE_LOCAL_STYLE = { colour: '#6C5CE7', weight: 4, opacity: 0.88, dashArray: '8, 5' };

        function buildBicycleRelationIdToRef(bicycleWays) {
            const relationIdToRef = new Map();
            bicycleWays.forEach(way => {
                const tags = way.tags || {};
                const relationId = tags.relation_id;
                const ref = (tags.relation_tags?.ref || tags.ref || '').replace(/\s/g, '').toUpperCase();
                if (relationId && ref) {
                    relationIdToRef.set(relationId, ref);
                }
            });
            return relationIdToRef;
        }

        function resolveStructuranteRef(tags, relationIdToRef) {
            const directRef = (tags.structurante_ref || '').replace(/\s/g, '').toUpperCase();
            if (directRef) {
                return directRef;
            }

            const routeRefs = new Set();
            (tags.route_refs || []).forEach(ref => {
                if (ref) routeRefs.add(String(ref).replace(/\s/g, '').toUpperCase());
            });
            (tags.relation_ids || (tags.relation_id ? [tags.relation_id] : [])).forEach(relationId => {
                const ref = relationIdToRef.get(relationId);
                if (ref) routeRefs.add(ref);
            });

            return BICYCLE_STRUCTURANTE_PRIORITY.find(ref => routeRefs.has(ref)) || '';
        }

        function getBicycleRouteStyle(tags, relationIdToRef) {
            const structuranteRef = resolveStructuranteRef(tags, relationIdToRef);
            if (BICYCLE_STRUCTURANTES[structuranteRef]) {
                const structurante = BICYCLE_STRUCTURANTES[structuranteRef];
                return {
                    colour: structurante.colour,
                    weight: structurante.weight,
                    opacity: 0.95,
                    structuranteRef
                };
            }

            return {
                colour: BICYCLE_LOCAL_STYLE.colour,
                weight: BICYCLE_LOCAL_STYLE.weight,
                opacity: BICYCLE_LOCAL_STYLE.opacity,
                dashArray: BICYCLE_LOCAL_STYLE.dashArray,
                structuranteRef: ''
            };
        }

        function formatBicycleKmLabel(km) {
            if (km == null || Number.isNaN(km) || km < 0.005) return '0 km';
            if (km >= 10) return `${Math.round(km).toLocaleString('fr-FR')} km`;
            return `${km.toFixed(1).replace('.', ',')} km`;
        }

        function computeBicycleStatsFromWays(bicycleWays, relationIdToRef) {
            const segmentCounts = { EV17: 0, EV8: 0, V861: 0, local: 0 };
            const lengthKm = { EV17: 0, EV8: 0, V861: 0, local: 0 };
            const relationIds = new Set();

            bicycleWays.forEach(way => {
                const relationId = way.tags?.relation_id;
                if (relationId) relationIds.add(relationId);

                const style = getBicycleRouteStyle(way.tags || {}, relationIdToRef);
                const wayKm = way.geometry?.length ? wayLengthKmFromGeometry(way.geometry) : 0;
                if (style.structuranteRef) {
                    segmentCounts[style.structuranteRef] += 1;
                    lengthKm[style.structuranteRef] += wayKm;
                } else {
                    segmentCounts.local += 1;
                    lengthKm.local += wayKm;
                }
            });

            const structurantesKm = lengthKm.EV17 + lengthKm.EV8 + lengthKm.V861;
            const structurantesSegments = segmentCounts.EV17 + segmentCounts.EV8 + segmentCounts.V861;

            return {
                segmentCounts,
                lengthKm,
                relations: relationIds.size,
                structurantesKm,
                structurantesSegments,
                localKm: lengthKm.local,
                localSegments: segmentCounts.local
            };
        }

        function setBicycleLegendCounts(stats) {
            const lengthKm = stats.lengthKm || {};
            const segmentCounts = stats.segmentCounts || {};
            const totalKm = (stats.structurantesKm ?? 0) + (stats.localKm ?? 0);

            const countElements = {
                'count-bicycle-total': formatBicycleKmLabel(totalKm),
                'count-ev17': formatBicycleKmLabel(lengthKm.EV17),
                'count-ev8': formatBicycleKmLabel(lengthKm.EV8),
                'count-v861': formatBicycleKmLabel(lengthKm.V861),
                'count-bicycle-local': formatBicycleKmLabel(lengthKm.local),
                'count-bicycle-routes': stats.relations ?? 0
            };
            Object.entries(countElements).forEach(([elementId, value]) => {
                const element = document.getElementById(elementId);
                if (element) element.textContent = String(value ?? 0);
            });

            const kmTooltips = {
                'count-bicycle-total': {
                    km: totalKm,
                    segments: (stats.structurantesSegments ?? 0) + (stats.localSegments ?? 0)
                },
                'count-ev17': { km: lengthKm.EV17, segments: segmentCounts.EV17 },
                'count-ev8': { km: lengthKm.EV8, segments: segmentCounts.EV8 },
                'count-v861': { km: lengthKm.V861, segments: segmentCounts.V861 },
                'count-bicycle-local': { km: lengthKm.local, segments: segmentCounts.local }
            };
            Object.entries(kmTooltips).forEach(([elementId, { km, segments }]) => {
                const element = document.getElementById(elementId);
                if (!element) return;
                const seg = Number(segments ?? 0).toLocaleString('fr-FR');
                element.title = `${formatBicycleKmLabel(km)} · ${seg} tronçons OSM`;
            });

            if (typeof window.patchDashboardMetrics === 'function') {
                window.patchDashboardMetrics({
                    bicycle: {
                        structurantesKm: stats.structurantesKm ?? 0,
                        structurantesSegments: stats.structurantesSegments ?? 0,
                        localKm: stats.localKm ?? 0,
                        localSegments: stats.localSegments ?? 0
                    }
                });
            }
        }

        function renderBicycleWayPolyline(way, relationIdToRef) {
            const coords = way.geometry.map(point => [point.lat, point.lon]);
            const tags = way.tags || {};
            const relationTags = tags.relation_tags || {};
            const style = getBicycleRouteStyle(tags, relationIdToRef);
            const structurante = style.structuranteRef ? BICYCLE_STRUCTURANTES[style.structuranteRef] : null;
            const name = structurante?.label
                || tags.name
                || relationTags.name
                || tags.ref
                || relationTags.ref
                || 'Véloroute sans nom';
            const network = tags.network || relationTags.network || '';
            const operator = tags.operator || relationTags.operator || '';
            const relationId = tags.relation_id;
            const refLabel = style.structuranteRef || relationTags.ref || tags.ref || '';
            const segmentKm = way.geometry?.length ? wayLengthKmFromGeometry(way.geometry) : 0;

            const polyline = L.polyline(coords, {
                color: style.colour,
                weight: style.weight,
                opacity: style.opacity,
                dashArray: style.dashArray || null
            });
            polyline.bicycleType = style.structuranteRef || 'local';
            if (bicycleVisible && bicycleTypeVisibility[polyline.bicycleType] !== false) {
                polyline.addTo(window.map);
            }

            bicyclePolylines.push(polyline);

            const popupContent = `
                <div class="route-popup">
                    <h3>🚴 ${escapeHtml(name)}</h3>
                    ${refLabel ? `<div class="detail"><strong>Réf.&nbsp;:</strong> ${escapeHtml(refLabel)}</div>` : ''}
                    <div class="detail"><strong>Longueur&nbsp;:</strong> ${formatBicycleKmLabel(segmentKm)}</div>
                    ${network ? `<div class="detail"><strong>Réseau&nbsp;:</strong> ${escapeHtml(network)}</div>` : ''}
                    ${operator ? `<div class="detail"><strong>Opérateur&nbsp;:</strong> ${escapeHtml(operator)}</div>` : ''}
                    ${relationId ? `
                        <div class="detail" style="margin-top: 10px;">
                            <a href="https://www.openstreetmap.org/relation/${relationId}" target="_blank" rel="noopener noreferrer" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                Voir la relation OSM →
                            </a>
                        </div>
                    ` : ''}
                </div>
            `;

            polyline.bindPopup(popupContent);
            polyline.on('mouseover', function() {
                this.setStyle({
                    weight: style.weight + (style.structuranteRef ? 2 : 2),
                    opacity: 1
                });
            });
            polyline.on('mouseout', function() {
                this.setStyle({
                    weight: style.weight,
                    opacity: style.opacity,
                    dashArray: style.dashArray || null
                });
            });

            return polyline;
        }

        function applyBicycleVisibleUi() {
            const icon = document.getElementById('bicycleToggleIcon');
            const title = document.querySelector('.legend-section:has([id="bicycleToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-bicycle]');
            setToggleIcon(icon, true);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '700';
            updateSubtypeLegendUi('bicycle', bicycleTypeVisibility, true);
        }

        function applyBicycleHiddenUi() {
            const icon = document.getElementById('bicycleToggleIcon');
            const title = document.querySelector('.legend-section:has([id="bicycleToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-bicycle]');
            setToggleIcon(icon, false);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '600';
            updateSubtypeLegendUi('bicycle', bicycleTypeVisibility, false);
        }

        window.toggleBicycleRoutes = function() {
            bicycleVisible = !bicycleVisible;

            if (!bicycleVisible) {
                bicyclePolylines.forEach(polyline => {
                    if (window.map.hasLayer(polyline)) window.map.removeLayer(polyline);
                });
                applyBicycleHiddenUi();
                syncLegendChrome();
                return;
            }

            if (bicyclePolylines.length === 0) {
                const icon = document.getElementById('bicycleToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                window.loadBicycleRoutes();
                return;
            }

            bicyclePolylines.forEach(polyline => {
                if (bicycleTypeVisibility[polyline.bicycleType] !== false && !window.map.hasLayer(polyline)) {
                    polyline.addTo(window.map);
                }
            });
            applyBicycleVisibleUi();
            syncLegendChrome();
        };

        window.toggleBicycleType = function(kind) {
            if (!bicycleVisible || !Object.prototype.hasOwnProperty.call(bicycleTypeVisibility, kind)) return;
            bicycleTypeVisibility[kind] = !bicycleTypeVisibility[kind];
            bicyclePolylines.forEach(polyline => {
                const shouldShow = bicycleVisible && bicycleTypeVisibility[polyline.bicycleType] !== false;
                const onMap = window.map.hasLayer(polyline);
                if (shouldShow && !onMap) polyline.addTo(window.map);
                if (!shouldShow && onMap) window.map.removeLayer(polyline);
            });
            updateSubtypeLegendUi('bicycle', bicycleTypeVisibility, true);
            syncLegendChrome();
        };

        // ========== EXCEPTIONAL CONVOYS ==========
        
        window.toggleConvoisExceptionnels = function() {
            convoiMode = !convoiMode;
            setToolActive('convoiBtn', convoiMode, { bounce: true });

            if (convoiMode) {
                console.log('🚛 Mode Convois Exceptionnels activé');
                // Filter and highlight suitable routes
                filterRoutesForConvois();

                // Small discreet toast (~2.5 s): full legend is in sidebar help
                L.popup({ closeButton: false, autoClose: true, closeOnClick: true })
                    .setLatLng(window.map.getCenter())
                    .setContent(`
                        <div style="padding: 10px 14px; text-align: center; font-size: 0.85rem;">
                            <strong>🚛 Mode Convois Exceptionnels</strong><br>
                            <small style="color:#5b6770;">Réseau régional + territorial mis en évidence,<br>réseau local atténué.</small>
                        </div>
                    `)
                    .openOn(window.map);
                setTimeout(() => window.map.closePopup(), 2500);

            } else {
                console.log('✗ Mode Convois Exceptionnels désactivé');
                // Restore all routes
                restoreAllRoutes();
                window.map.closePopup();
            }
        };

        function filterRoutesForConvois() {
            // Criteria for exceptional convoys:
            // - Regional network: always suitable (main axes, sufficient width)
            // - Territorial network: generally suitable
            // - Local network: avoid (too narrow, tight bends)
            
            Object.keys(window.routePolylines).forEach(ref => {
                const polylines = window.routePolylines[ref];
                
                polylines.forEach(polyline => {
                    const hierarchy = polyline.options.roadHierarchy;
                    
                    if (hierarchy === 'regional') {
                        // Regional routes: OPTIMAL for convoys
                        polyline.setStyle({
                            color: '#27AE60',  // Green = suitable
                            weight: 8,
                            opacity: 1
                        });
                        polyline.bringToFront();
                    } else if (hierarchy === 'territorial') {
                        // Territorial routes: SUITABLE with caution
                        polyline.setStyle({
                            color: '#F39C12',  // Orange = suitable with caution
                            weight: 6,
                            opacity: 0.9
                        });
                    } else if (hierarchy === 'local') {
                        // Local routes: AVOID (hide)
                        polyline.setStyle({
                            opacity: 0.15,
                            weight: 2
                        });
                    }
                });
            });
            
            // Count suitable routes
            const routesRegionales = Object.keys(window.routePolylines).filter(ref => {
                const hierarchy = window.routePolylines[ref][0].options.roadHierarchy;
                return hierarchy === 'regional';
            }).length;
            
            const routesTerritoriales = Object.keys(window.routePolylines).filter(ref => {
                const hierarchy = window.routePolylines[ref][0].options.roadHierarchy;
                return hierarchy === 'territorial';
            }).length;
            
            console.log(`✓ ${routesRegionales} routes régionales (optimales)`);
            console.log(`✓ ${routesTerritoriales} routes territoriales (adaptées)`);
        }

        function restoreAllRoutes() {
            // Restore normal appearance for all routes
            Object.keys(window.routePolylines).forEach(ref => {
                const polylines = window.routePolylines[ref];
                
                polylines.forEach(polyline => {
                    const hierarchy = polyline.options.roadHierarchy;
                    polyline.setStyle({
                        color: hierarchyColors[hierarchy],
                        weight: hierarchyWeights[hierarchy],
                        opacity: 0.8
                    });
                });
            });
        }


        // Toggle entire hierarchy globally
        window.toggleAllHierarchy = function() {
            const allVisible = hierarchyVisibility.regional && hierarchyVisibility.territorial && hierarchyVisibility.local;
            const newState = !allVisible;
            
            // Apply the same state to all levels
            hierarchyVisibility.regional = newState;
            hierarchyVisibility.territorial = newState;
            hierarchyVisibility.local = newState;
            
            // Update display
            updateHierarchyDisplay();
            
            // Icon and title
            const icon = document.getElementById('hierarchyToggleIcon');
            const title = document.querySelector('.legend-section:has([id="hierarchyToggleIcon"]) .legend-title');
            
            if (newState) {
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
                console.log('✓ Toutes les routes affichées');
            } else {
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                console.log('✗ Toutes les routes masquées');
            }
        };

        // Toggle a specific hierarchy level
        window.toggleHierarchy = function(hierarchy) {
            if (!Object.prototype.hasOwnProperty.call(hierarchyVisibility, hierarchy)) {
                console.warn('Hiérarchie inconnue:', hierarchy);
                return;
            }
            
            hierarchyVisibility[hierarchy] = !hierarchyVisibility[hierarchy];
            updateHierarchyDisplay();
            
            const label = {
                regional: 'Réseau régional',
                territorial: 'Réseau territorial',
                local: 'Réseau local'
            }[hierarchy] || hierarchy;
            
            console.log(`${hierarchyVisibility[hierarchy] ? '✓' : '✗'} ${label} ${hierarchyVisibility[hierarchy] ? 'affiché' : 'masqué'}`);
        };

        // Update route display according to hierarchy
        window.updateHierarchyDisplay = function() {
            if (!window.map || !window.routePolylines) return; // Wait until the map is ready
            
            // Iterate over all route polylines
            Object.keys(window.routePolylines).forEach(ref => {
                const polylines = window.routePolylines[ref];
                polylines.forEach(polyline => {
                    const hierarchy = polyline.options.roadHierarchy;
                    
                    if (hierarchyVisibility[hierarchy]) {
                        // Show route
                        if (!window.map.hasLayer(polyline)) {
                            polyline.addTo(window.map);
                        }
                        polyline.setStyle({ opacity: 0.8 });
                    } else {
                        // Hide route
                        if (window.map.hasLayer(polyline)) {
                            window.map.removeLayer(polyline);
                        }
                    }
                });
            });
            
            // Update shadows if a route is selected
            if (window.highlightedRoute && window.shadowPolylines[window.highlightedRoute]) {
                window.shadowPolylines[window.highlightedRoute].forEach(shadow => {
                    const hierarchy = shadow.options.roadHierarchy;
                    if (hierarchyVisibility[hierarchy]) {
                        if (!window.map.hasLayer(shadow)) {
                            shadow.addTo(window.map);
                        }
                    } else {
                        if (window.map.hasLayer(shadow)) {
                            window.map.removeLayer(shadow);
                        }
                    }
                });
            }
            
            // Update legend item styles
            ['regional', 'territorial', 'local'].forEach(hierarchy => {
                const item = document.querySelector(`[data-hierarchy="${hierarchy}"]`);
                if (item) {
                    if (hierarchyVisibility[hierarchy]) {
                        item.style.opacity = '1';
                        item.style.fontWeight = '600';
                    } else {
                        item.style.opacity = '0.4';
                        item.style.fontWeight = '400';
                    }
                }
            });
            
            // Update global icon according to state
            const icon = document.getElementById('hierarchyToggleIcon');
            const title = document.querySelector('.legend-section:has([id="hierarchyToggleIcon"]) .legend-title');
            const allVisible = hierarchyVisibility.regional && hierarchyVisibility.territorial && hierarchyVisibility.local;
            const allHidden = !hierarchyVisibility.regional && !hierarchyVisibility.territorial && !hierarchyVisibility.local;
            
            if (allVisible) {
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
            } else if (allHidden) {
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
            } else {
                setToggleIcon(icon, true, { partial: true });
                if (title) title.style.fontWeight = '700';
            }

            if (typeof window.updateRouteLabels === 'function') {
                window.updateRouteLabels();
            }
            syncLegendChrome();
        };


        // Show/hide accidents
        window.toggleAccidents = function() {
            accidentsVisible = !accidentsVisible;
            
            const icon = document.getElementById('accidentToggleIcon');
            const legendItems = document.querySelectorAll('[data-accident]');
            const title = document.querySelector('.legend-section:has([id="accidentToggleIcon"]) .legend-title');
            
            const timeline = document.getElementById('accidents-timeline');

            if (accidentsVisible) {
                // Show accidents (respecting the current year filter)
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
                updateSubtypeLegendUi('accident', accidentTypeVisibility, true);
                if (timeline) timeline.style.display = '';
            } else {
                // Hide accidents
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                updateSubtypeLegendUi('accident', accidentTypeVisibility, false);
                if (timeline) timeline.style.display = 'none';
                console.log('✗ Accidents masqués');
            }

            // Single source of truth for what is actually painted on the map.
            // The painter lives inside the DOMContentLoaded scope, hence window.
            if (typeof window.applyAccidentVisibility === 'function') window.applyAccidentVisibility();
            syncLegendChrome();
        }

        window.toggleAccidentType = function(kind) {
            if (!accidentsVisible || !Object.prototype.hasOwnProperty.call(accidentTypeVisibility, kind)) return;
            accidentTypeVisibility[kind] = !accidentTypeVisibility[kind];
            if (typeof window.applyAccidentVisibility === 'function') window.applyAccidentVisibility();
            updateSubtypeLegendUi('accident', accidentTypeVisibility, true);
            syncLegendChrome();
        };

        // ========== TRAFFIC COUNTING STATIONS ==========

        // Gamme rouge cerise (fort trafic) → rose clair (faible trafic).
        const TRAFFIC_STYLES = {
            high: { fill: '#A4133C', stroke: '#FFFFFF', size: 12 },
            medium: { fill: '#E5547F', stroke: '#FFFFFF', size: 10 },
            low: { fill: '#FAD2DE', stroke: '#D88AA0', size: 8 }
        };

        function syncTrafficMarkersOnMap() {
            trafficMarkers.forEach(marker => {
                const onMap = window.map.hasLayer(marker);
                const typeVisible = trafficTypeVisibility[marker.trafficCategory] !== false;
                if (trafficVisible && typeVisible && !onMap) marker.addTo(window.map);
                if ((!trafficVisible || !typeVisible) && onMap) window.map.removeLayer(marker);
            });
        }

        window.toggleTraffic = function() {
            trafficVisible = !trafficVisible;

            const icon = document.getElementById('trafficToggleIcon');
            const title = document.querySelector('.legend-section:has([id="trafficToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-traffic]');

            syncTrafficMarkersOnMap();
            setToolActive('wazeBtn', trafficVisible, { bounce: true });

            if (trafficVisible) {
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
                updateSubtypeLegendUi('traffic', trafficTypeVisibility, true);
                console.log(`✓ ${trafficMarkers.length} stations de comptage affichées`);
            } else {
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                updateSubtypeLegendUi('traffic', trafficTypeVisibility, false);
                clearStationSelection();
                console.log('✗ Stations de comptage masquées');
            }
            syncLegendChrome();
        };

        window.toggleTrafficType = function(kind) {
            if (!trafficVisible || !Object.prototype.hasOwnProperty.call(trafficTypeVisibility, kind)) return;
            trafficTypeVisibility[kind] = !trafficTypeVisibility[kind];
            syncTrafficMarkersOnMap();
            updateSubtypeLegendUi('traffic', trafficTypeVisibility, true);
            syncLegendChrome();
        };

        // ========== ROAD EVENTS / BISON FUTÉ ==========

        function applyBisonFuteVisibleUi() {
            const title = document.querySelector('.legend-section:has([id="bisonFuteToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-bison-fute]');
            if (title) title.style.fontWeight = '700';
            updateSubtypeLegendUi('bison-fute', bisonFuteTypeVisibility, true);
        }

        function applyBisonFuteHiddenUi() {
            const title = document.querySelector('.legend-section:has([id="bisonFuteToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-bison-fute]');
            if (title) title.style.fontWeight = '600';
            updateSubtypeLegendUi('bison-fute', bisonFuteTypeVisibility, false);
        }

        function syncBisonFuteMarkersOnMap() {
            bisonFuteMarkers.forEach(marker => {
                const onMap = window.map?.hasLayer(marker);
                const typeVisible = marker.bisonFuteCategory === 'autres'
                    || bisonFuteTypeVisibility[marker.bisonFuteCategory] !== false;
                if (bisonFuteVisible && typeVisible && !onMap) marker.addTo(window.map);
                if ((!bisonFuteVisible || !typeVisible) && onMap) window.map.removeLayer(marker);
            });
        }

        function clearBisonFuteMarkers() {
            bisonFuteMarkers.forEach(marker => {
                if (window.map?.hasLayer(marker)) window.map.removeLayer(marker);
            });
            bisonFuteMarkers = [];
        }

        function applyBisonFuteLayerUi() {
            if (bisonFuteVisible) applyBisonFuteVisibleUi();
            else applyBisonFuteHiddenUi();
        }

        window.toggleBisonFute = function() {
            bisonFuteVisible = !bisonFuteVisible;
            syncBisonFuteMarkersOnMap();
            if (bisonFuteVisible) {
                applyBisonFuteVisibleUi();
                console.log(`✓ ${bisonFuteMarkers.length} événements routiers affichés`);
            } else {
                applyBisonFuteHiddenUi();
                console.log('✗ Événements routiers masqués');
            }
            syncLegendChrome();
        };

        window.toggleBisonFuteType = function(kind) {
            if (!bisonFuteVisible || !Object.prototype.hasOwnProperty.call(bisonFuteTypeVisibility, kind)) return;
            bisonFuteTypeVisibility[kind] = !bisonFuteTypeVisibility[kind];
            syncBisonFuteMarkersOnMap();
            updateSubtypeLegendUi('bison-fute', bisonFuteTypeVisibility, true);
            syncLegendChrome();
        };

        // ========== MAIN CITIES ==========

        window.toggleCities = function() {
            citiesVisible = !citiesVisible;

            const icon = document.getElementById('citiesToggleIcon');
            const title = document.querySelector('.legend-section:has([id="citiesToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-city]');

            if (citiesVisible) {
                cityMarkers.forEach(marker => {
                    if (!window.map.hasLayer(marker)) marker.addTo(window.map);
                });
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
                legendItems.forEach(item => {
                    item.style.opacity = '1';
                });
                console.log(`✓ ${cityMarkers.length} villes principales affichées`);
            } else {
                cityMarkers.forEach(marker => {
                    if (window.map.hasLayer(marker)) window.map.removeLayer(marker);
                });
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                legendItems.forEach(item => {
                    item.style.opacity = '0.5';
                });
                console.log('✗ Villes principales masquées');
            }
            syncLegendChrome();
        };

        // Wait until everything is loaded (DOM + Leaflet)
        window.addEventListener('DOMContentLoaded', function() {
        
        // Initialize map centered on Vaucluse (default view is tighter than full extent)
        const launchCenter = INITIAL_URL_HAS_VIEW
            ? [INITIAL_APP_URL_STATE.view.lat, INITIAL_APP_URL_STATE.view.lng]
            : [DEFAULT_MAP_VIEW.lat, DEFAULT_MAP_VIEW.lng];
        const launchZoom = INITIAL_URL_HAS_VIEW ? INITIAL_APP_URL_STATE.view.z : DEFAULT_MAP_VIEW.zoom;
        window.map = L.map('map').setView(launchCenter, launchZoom);
        if (INITIAL_URL_HAS_VIEW) appUrlViewApplied = true;
        if (window.map.attributionControl) {
            window.map.attributionControl.setPrefix(
                '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>'
            );
        }
        window.map.on('moveend zoomend', scheduleAppUrlSync);
        trackOpenPopupSource(window.map);

        window.resetMapView = function() {
            applyDefaultMapView({ animate: true });
        };

        // Fond Plan IGN, en tuiles raster. Une tuile arrive déjà dessinée et
        // s'affiche seule dès qu'elle est reçue : rien n'attend rien, là où le
        // fond vectoriel demandait de charger MapLibre puis de tout redessiner
        // avant que la première image ne paraisse.
        const basemapConfig = window.APP_CONFIG?.basemap || {};
        const focusConfig = basemapConfig.focus || {};

        let basemapTileRetryTimer = null;
        let basemapRecoveryTimer = null;

        // Aucune tuile n'est demandée hors du cadre : Leaflet ne crée même pas les
        // vignettes dont les coordonnées tombent à côté.
        const focusBounds = Array.isArray(focusConfig.bounds)
            ? L.latLngBounds(
                [focusConfig.bounds[1], focusConfig.bounds[0]],
                [focusConfig.bounds[3], focusConfig.bounds[2]]
            )
            : undefined;

        window.map.setMinZoom(basemapConfig.minZoom || 8);
        window.map.setMaxZoom(basemapConfig.maxZoom || 19);

        window.basemapLayer = L.tileLayer(basemapConfig.url, {
            attribution: basemapConfig.attribution,
            minZoom: basemapConfig.minZoom || 8,
            maxZoom: basemapConfig.maxZoom || 19,
            keepBuffer: 2,
            bounds: focusBounds
        }).addTo(window.map);

        // Désaturation portée par la couche et non par le tilePane, que d'autres
        // couches partagent et qui n'a pas à pâlir avec le fond.
        if (basemapConfig.filter && window.basemapLayer.getContainer()) {
            window.basemapLayer.getContainer().style.filter = basemapConfig.filter;
        }

        window.basemapLayer.on('tileerror', () => {
            if (basemapTileRetryTimer) return;
            basemapTileRetryTimer = window.setTimeout(() => {
                basemapTileRetryTimer = null;
                window.ensureBasemapVisible();
                if (!basemapHasLoadedTiles() && window.map) {
                    window.map.invalidateSize({ pan: false });
                }
            }, 480);
        });

        // Le cadre des tuiles est un rectangle, le département n'en est pas un.
        // Deux traitements pour ce débord : un aplat qui le couvre à l'écran, et
        // un masque qui empêche d'aller chercher les tuiles qu'il recouvre.
        const VEIL_PANE = 'vaucluse-veil';
        const VEIL_WORLD_RING = [[-85, -180], [-85, 180], [85, 180], [85, -180]];
        const FOCUS_MASK_WIDTH = 512;

        function departmentRings(geojson) {
            const rings = [];
            const collect = geometry => {
                if (!geometry) return;
                if (geometry.type === 'GeometryCollection') {
                    (geometry.geometries || []).forEach(collect);
                    return;
                }
                const parts = geometry.type === 'MultiPolygon' ? geometry.coordinates
                    : geometry.type === 'Polygon' ? [geometry.coordinates]
                    : [];
                // Le contour extérieur de chaque partie suffit : rouvrir les
                // anneaux intérieurs raviverait des îlots au milieu de l'aplat.
                parts.forEach(part => rings.push(part[0].map(([lng, lat]) => [lat, lng])));
            };
            (geojson.features || [geojson]).forEach(feature => collect(feature.geometry));
            return rings;
        }

        // La frontière est peinte une fois dans un canvas hors écran, en
        // projection Mercator comme les tuiles. Chaque tuile vient ensuite
        // demander à ce masque si elle a quelque chose à montrer.
        function buildFocusMask(rings) {
            if (!focusBounds) return null;
            const project = ([lat, lng]) => L.Projection.SphericalMercator.project(L.latLng(lat, lng));
            const min = project([focusBounds.getSouth(), focusBounds.getWest()]);
            const max = project([focusBounds.getNorth(), focusBounds.getEast()]);
            const spanX = max.x - min.x;
            const spanY = max.y - min.y;
            if (!(spanX > 0) || !(spanY > 0)) return null;
            const height = Math.max(1, Math.round(FOCUS_MASK_WIDTH * spanY / spanX));
            const canvas = document.createElement('canvas');
            canvas.width = FOCUS_MASK_WIDTH;
            canvas.height = height;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) return null;
            context.fillStyle = '#fff';
            context.beginPath();
            rings.forEach(ring => {
                ring.forEach((latLng, index) => {
                    const point = project(latLng);
                    const x = (point.x - min.x) / spanX * FOCUS_MASK_WIDTH;
                    const y = (max.y - point.y) / spanY * height;
                    if (index === 0) context.moveTo(x, y);
                    else context.lineTo(x, y);
                });
                context.closePath();
            });
            context.fill();
            const pixels = context.getImageData(0, 0, FOCUS_MASK_WIDTH, height).data;
            const covered = new Uint8Array(FOCUS_MASK_WIDTH * height);
            for (let index = 0; index < covered.length; index += 1) {
                covered[index] = pixels[index * 4 + 3] ? 1 : 0;
            }
            return { covered, width: FOCUS_MASK_WIDTH, height, minX: min.x, maxY: max.y, spanX, spanY };
        }

        // Les arrondis élargissent la zone testée plutôt que de la rétrécir : une
        // tuile de trop coûte une requête, une tuile manquante fait un trou.
        function maskCoversTile(mask, bounds) {
            const project = latLng => L.Projection.SphericalMercator.project(latLng);
            const low = project(bounds.getSouthWest());
            const high = project(bounds.getNorthEast());
            const left = Math.max(0, Math.floor((low.x - mask.minX) / mask.spanX * mask.width));
            const right = Math.min(mask.width, Math.ceil((high.x - mask.minX) / mask.spanX * mask.width));
            const top = Math.max(0, Math.floor((mask.maxY - high.y) / mask.spanY * mask.height));
            const bottom = Math.min(mask.height, Math.ceil((mask.maxY - low.y) / mask.spanY * mask.height));
            for (let y = top; y < Math.max(bottom, top + 1) && y < mask.height; y += 1) {
                for (let x = left; x < Math.max(right, left + 1) && x < mask.width; x += 1) {
                    if (mask.covered[y * mask.width + x]) return true;
                }
            }
            return false;
        }

        function restrictBasemapToVaucluse(geojson) {
            const rings = departmentRings(geojson);
            if (!rings.length) return;

            // Entre le fond (200) et les données (400) : l'aplat efface les abords
            // sans jamais toucher aux couches métier.
            if (!window.map.getPane(VEIL_PANE)) {
                const pane = window.map.createPane(VEIL_PANE);
                pane.style.zIndex = 250;
                pane.style.pointerEvents = 'none';
            }
            L.polygon([VEIL_WORLD_RING, ...rings], {
                pane: VEIL_PANE,
                interactive: false,
                stroke: false,
                // Le remplissage pair-impair est ce qui creuse les trous.
                fillRule: 'evenodd',
                fillColor: focusConfig.veilColor,
                fillOpacity: 1
            }).addTo(window.map);

            const mask = buildFocusMask(rings);
            if (!mask || !window.basemapLayer) return;
            const layer = window.basemapLayer;
            const isValidTile = L.TileLayer.prototype._isValidTile;
            layer._isValidTile = function(coords) {
                if (!isValidTile.call(this, coords)) return false;
                return maskCoversTile(mask, this._tileCoordsToBounds(coords));
            };
        }

        function basemapHasLoadedTiles() {
            const pane = window.map?.getPane?.('tilePane');
            return Boolean(pane && pane.querySelector('img.leaflet-tile-loaded'));
        }

        window.ensureBasemapVisible = function() {
            if (!window.map || !window.basemapLayer) return;
            if (!window.map.hasLayer(window.basemapLayer)) {
                window.basemapLayer.addTo(window.map);
            }
        };

        window.scheduleBasemapRecovery = function() {
            if (basemapRecoveryTimer) clearTimeout(basemapRecoveryTimer);
            basemapRecoveryTimer = window.setTimeout(() => {
                basemapRecoveryTimer = null;
                window.ensureBasemapVisible();
                if (!window.map) return;
                if (!basemapHasLoadedTiles()) {
                    window.map.invalidateSize({ pan: false });
                }
            }, 280);
        };

        window.map.whenReady(() => {
            window.ensureBasemapVisible();
            window.map.invalidateSize({ pan: false });
            requestAnimationFrame(() => {
                window.map.invalidateSize({ pan: false });
                window.scheduleBasemapRecovery();
            });
        });

        // Official list of Vaucluse municipalities (for filtering)
        const communesVaucluse = [
            "Althen-des-Paluds", "Ansouis", "Apt", "Aubignan", "Auribeau", "Avignon",
            "Beaumes-de-Venise", "Beaumont-de-Pertuis", "Beaumont-du-Ventoux", "Blauvac",
            "Bollène", "Bonnieux", "Brantes", "Buisson", "Buoux", "Bédarrides", "Bédoin",
            "Cabrières-d'Aigues", "Cabrières-d'Avignon", "Cadenet", "Caderousse", "Cairanne",
            "Camaret-sur-Aigues", "Caromb", "Carpentras", "Caseneuve", "Castellet",
            "Caumont-sur-Durance", "Cavaillon", "Cheval-Blanc", "Châteauneuf-du-Pape",
            "Courthézon", "Crestet", "Crillon-le-Brave", "Cucuron", "Entraigues-sur-la-Sorgue",
            "Entrechaux", "Faucon", "Flassan", "Fontaine-de-Vaucluse", "Gargas", "Gigondas",
            "Gordes", "Goult", "Grambois", "Grillon", "Jonquerettes", "Jonquières", "Joucas",
            "L'Isle-sur-la-Sorgue", "La Bastide-des-Jourdans", "La Roque-sur-Pernes",
            "La Tour-d'Aigues", "Lacoste", "Lafare", "Lagarde-Paréol", "Lagarde-d'Apt",
            "Lagnes", "Lamotte-du-Rhône", "Lauris", "Le Barroux", "Le Beaucet", "Le Pontet",
            "Le Thor", "Lioux", "Loriol-du-Comtat", "Lourmarin", "Malaucène",
            "Malemort-du-Comtat", "Maubec", "Mazan", "Mirabeau", "Mirabel-aux-Baronnies",
            "Modène", "Mondragon", "Monieux", "Monteux", "Montfavet", "Morières-lès-Avignon",
            "Mormoiron", "Mornas", "Murs", "Ménerbes", "Méthamis", "Oppède", "Orange",
            "Pernes", "Pernes-les-Fontaines", "Pertuis", "Piolenc", "Puymeras", "Puyméras",
            "Rasteau", "Richerenches", "Roaix", "Robion", "Roussillon", "Rustrel", "Sablet",
            "Saignon", "Saint-Christol", "Saint-Didier", "Saint-Hippolyte-le-Graveyron",
            "Saint-Léger-du-Ventoux", "Saint-Marcellin-lès-Vaison", "Saint-Pierre-de-Vassols",
            "Saint-Romain-en-Viennois", "Saint-Roman-de-Malegarde", "Saint-Saturnin-lès-Apt",
            "Saint-Trinit", "Sainte-Cécile-les-Vignes", "Sannes", "Sarrians", "Sault",
            "Sivergues", "Sorgues", "Suzette", "Séguret", "Sérignan-du-Comtat", "Taillades",
            "Travaillan", "Uchaux", "Vacqueyras", "Vaison-la-Romaine", "Valréas", "Vaugines",
            "Vedène", "Velleron", "Venasque", "Viens", "Villars", "Villedieu", "Villelaure",
            "Villes-sur-Auzon", "Violès", "Visan", "Vitrolles-en-Lubéron"
        ];

        // Check whether text matches a Vaucluse municipality
        function isValidCommune(text) {
            if (!text || text.length < 3) return false;
            
            // Normaliser le texte
            const normalized = text.trim();
            
            // Check for exact municipality match
            if (communesVaucluse.includes(normalized)) return true;
            
            // Check with partial match (case-insensitive)
            const lowerText = normalized.toLowerCase();
            return communesVaucluse.some(c => 
                c.toLowerCase() === lowerText ||
                c.toLowerCase().includes(lowerText) ||
                lowerText.includes(c.toLowerCase())
            );
        }

        // Load Vaucluse departmental boundary from local static GeoJSON
        async function loadVaucluseBoundary() {
            try {
                const geojsonData = await window.InforouteApi.fetchGeoJson('vaucluse-boundary');
                renderFreshnessBadge(document.getElementById('freshness-boundary'), {
                    generatedAt: geojsonData._cache?.generated_at,
                    scheduleKey: 'static'
                });
                
                // Add departmental boundary with Leaflet
                const boundaryLayer = L.geoJSON(geojsonData, {
                    style: {
                        color: '#2C3E50',
                        weight: 3,
                        opacity: 0.8,
                        dashArray: '8, 4',
                        fillColor: '#667eea',
                        fillOpacity: 0.05
                    }
                }).addTo(window.map);

                restrictBasemapToVaucluse(geojsonData);

                vaucluseDefaultBounds = boundaryLayer.getBounds();

                if (!INITIAL_URL_HAS_VIEW) {
                    applyDefaultMapView({ animate: false });
                } else {
                    reassertInitialUrlViewIfNeeded();
                }
                tryApplyAppUrlState();
                scheduleAppUrlSync();
                
                console.log('✓ Limite départementale chargée depuis le GeoJSON local');
                
            } catch (error) {
                console.error('Erreur lors du chargement de la limite départementale:', error);
                
                L.popup()
                    .setLatLng([44.0, 5.1])
                    .setContent('<div style="padding: 10px;"><strong>⚠️ Limite non disponible</strong><br><small>Erreur de chargement des données</small></div>')
                    .openOn(window.map);
                
                setTimeout(() => window.map.closePopup(), 4000);
            }
        }
        
        // Load departmental boundary first
        loadVaucluseBoundary();

        // Hierarchical classification of Vaucluse departmental roads
        const routeClassification = {
            regional: ['D900', 'D942', 'D950', 'D973', 'D974', 'D975', 'D938', 'D907', 'D225'],
            territorial: ['D901', 'D28', 'D4', 'D2', 'D36', 'D943', 'D22', 'D8', 'D177', 'D108', 'D15', 'D31'],
            local: ['D1', 'D7', 'D6', 'D5', 'D3', 'D10', 'D11', 'D12', 'D13', 'D14', 'D16', 'D17', 'D18', 'D19', 'D20']
        };

        // Load roads by hierarchy category
        let roadLabels = []; // Store labels for zoom management
        let routesByHierarchy = { regional: [], territorial: [], local: [] }; // Store routes by hierarchy
        window.routePolylines = {}; // Store polylines by route ref (global for toggleHierarchy)
        let allRoadsList = []; // Full route list for search
        window.highlightedRoute = null; // Currently highlighted route (global for toggleHierarchy)
        window.stationAxisLayers = []; // Accent trace drawn when a counting station is clicked (issue #9)
        window.shadowPolylines = {}; // Shadow polylines for highlighted routes (by ref, global)

        async function loadDepartmentalRoads() {
            try {
                const data = await window.InforouteApi.fetchGeoJson('departmental-roads');
                const osmGeneratedAt = data._cache?.generated_at;
                renderFreshnessBadge(document.getElementById('freshness-hierarchy'), {
                    generatedAt: osmGeneratedAt,
                    scheduleKey: 'osm'
                });
                renderFreshnessBadge(document.getElementById('freshness-wikidata'), {
                    generatedAt: osmGeneratedAt,
                    scheduleKey: 'wikidata'
                });
                syncLegendChrome();

                if (data.features && data.features.length > 0) {
                    console.log(`✓ ${data.features.length} tronçons chargés depuis le GeoJSON OSM`);

                    const ways = data.features
                        .map(geoJsonLineFeatureToWay)
                        .filter(Boolean);
                    
                    console.log(`  - ${ways.length} ways (tronçons)`);
                    console.log(`  - relations attachées aux propriétés GeoJSON`);

                    // Group routes by reference
                    const routesByRef = {};
                    ways.forEach(way => {
                        if (way.tags && way.tags.ref) {
                            // Normalize reference (strip spaces, uppercase)
                            const ref = way.tags.ref.replace(/\s+/g, '').replace(/^D/, 'D');
                            
                            if (!routesByRef[ref]) {
                                routesByRef[ref] = [];
                            }
                            routesByRef[ref].push(way);
                        }
                    });

                    // Render routes with their hierarchy
                    Object.keys(routesByRef).forEach(ref => {
                        const ways = routesByRef[ref];
                        
                        // Determine this route's hierarchy
                        let hierarchy = 'local'; // Default
                        const refClean = ref.replace(/\s+/g, '');
                        
                        if (routeClassification.regional.some(r => refClean.includes(r.replace('D', '')))) {
                            hierarchy = 'regional';
                        } else if (routeClassification.territorial.some(r => refClean.includes(r.replace('D', '')))) {
                            hierarchy = 'territorial';
                        }

                        // Create a line for each segment
                        ways.forEach(way => {
                            if (way.geometry && way.geometry.length > 0) {
                                const coords = way.geometry.map(point => [point.lat, point.lon]);
                                
                                const polyline = L.polyline(coords, {
                                    color: hierarchyColors[hierarchy],
                                    weight: hierarchyWeights[hierarchy],
                                    opacity: 0.8,
                                    smoothFactor: 1,
                                    roadRef: ref,
                                    roadHierarchy: hierarchy,
                                    wayTags: way.tags || {},
                                    wayId: way.id
                                });

                                if (hierarchyVisibility[hierarchy]) {
                                    polyline.addTo(window.map);
                                }

                                // Store polyline by route reference
                                if (!routePolylines[ref]) {
                                    routePolylines[ref] = [];
                                }
                                routePolylines[ref].push(polyline);

                                // Store reference for labels and info
                                if (!routesByHierarchy[hierarchy].find(r => r.ref === ref)) {
                                    routesByHierarchy[hierarchy].push({
                                        ref: ref,
                                        coords: coords,
                                        hierarchy: hierarchy,
                                        ways: [way],
                                        communes: new Set(),
                                        totalLength: 0,
                                        surfaces: new Set(),
                                        maxspeeds: new Set()
                                    });
                                } else {
                                    const route = routesByHierarchy[hierarchy].find(r => r.ref === ref);
                                    route.ways.push(way);
                                }
                                
                                // Collecter les informations de la route
                                const routeInfo = routesByHierarchy[hierarchy].find(r => r.ref === ref);
                                
                                // Crossed municipalities (parse several sources and filter)
                                // 1. Tag 'destination' (destinations principales)
                                if (way.tags.destination) {
                                    way.tags.destination.split(';').forEach(c => {
                                        const commune = c.trim();
                                        if (isValidCommune(commune)) {
                                            routeInfo.communes.add(commune);
                                        }
                                    });
                                }
                                
                                // 2. Tag 'name' peut contenir le nom avec les communes
                                if (way.tags.name && way.tags.name.includes(' - ')) {
                                    const parts = way.tags.name.split(' - ');
                                    parts.forEach(p => {
                                        const commune = p.replace(/^(Route|Rue|Avenue|Boulevard) (de |d'|des )?/i, '').trim();
                                        if (isValidCommune(commune)) {
                                            routeInfo.communes.add(commune);
                                        }
                                    });
                                }
                                
                                // 3. Tag 'destination:ref' ou 'int_ref'
                                if (way.tags['destination:ref']) {
                                    const commune = way.tags['destination:ref'].trim();
                                    if (isValidCommune(commune)) {
                                        routeInfo.communes.add(commune);
                                    }
                                }
                                
                                // Compute segment length
                                let segmentLength = 0;
                                for (let i = 0; i < coords.length - 1; i++) {
                                    segmentLength += map.distance(coords[i], coords[i + 1]);
                                }
                                routeInfo.totalLength += segmentLength;
                                
                                // Surface
                                if (way.tags.surface) {
                                    routeInfo.surfaces.add(way.tags.surface);
                                }
                                
                                // Vitesse max
                                if (way.tags.maxspeed) {
                                    routeInfo.maxspeeds.add(way.tags.maxspeed);
                                }
                                
                                // Store first/last point to determine endpoint municipalities
                                if (!routeInfo.firstPoint) {
                                    routeInfo.firstPoint = coords[0];
                                }
                                routeInfo.lastPoint = coords[coords.length - 1];

                                // Informations sur la route
                                const roadName = way.tags.name || ref;
                                const hierarchyLabel = 
                                    hierarchy === 'regional' ? 'Réseau d\'intérêt régional' :
                                    hierarchy === 'territorial' ? 'Réseau de développement territorial' :
                                    'Réseau d\'intérêt local';

                                const wikidataQid = way.relationTags?.wikidata || way.tags.wikidata || null;
                                const popupInfoboxContainerId = wikidataQid
                                    ? `infobox-${wikidataQid}-${way.id || Math.random().toString(36).slice(2, 8)}`
                                    : null;
                                const popupContent = `
                                    <div class="route-popup">
                                        <h3>${roadName}</h3>
                                        <div class="detail"><strong>Référence&nbsp;:</strong> ${ref}</div>
                                        <div class="detail"><strong>Type&nbsp;:</strong> ${hierarchyLabel}</div>
                                        
                                        ${way.tags.description || way.relationTags?.description ? `
                                            <div class="detail" style="margin-top: 8px; padding: 8px; background: #f8f9fa; border-radius: 4px; font-style: italic; font-size: 0.9rem;">
                                                ℹ️ ${way.relationTags?.description || way.tags.description}
                                            </div>
                                        ` : ''}
                                        
                                        ${way.tags.surface ? `<div class="detail"><strong>Surface&nbsp;:</strong> ${way.tags.surface}</div>` : ''}
                                        ${(() => {
                                            const speed = resolveWaySpeed(way.tags);
                                            if (speed.kmh === null) return '';
                                            const origin = speed.implicit ? ` <em>(implicite · ${speed.label})</em>` : '';
                                            return `<div class="detail"><strong>Vitesse max&nbsp;:</strong> ${speed.kmh} km/h${origin}</div>`;
                                        })()}
                                        ${way.tags.lanes ? `<div class="detail"><strong>Voies&nbsp;:</strong> ${way.tags.lanes}</div>` : ''}
                                        ${way.tags.oneway === 'yes' ? `<div class="detail"><strong>Sens unique&nbsp;:</strong> ➡️ Oui</div>` : ''}
                                        
                                        ${way.relationTags && way.relationTags.wikidata ? `
                                            <div class="detail" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd;">
                                                <strong>📚 Wikidata&nbsp;:</strong> 
                                                <a href="https://www.wikidata.org/wiki/${way.relationTags.wikidata}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                                    ${way.relationTags.wikidata} →
                                                </a>
                                                <span style="color: #27AE60; font-size: 0.8rem; display: block; margin-top: 3px;">
                                                    ✓ Données structurées disponibles
                                                </span>
                                            </div>
                                        ` : way.tags.wikidata ? `
                                            <div class="detail" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd;">
                                                <strong>📚 Wikidata&nbsp;:</strong> 
                                                <a href="https://www.wikidata.org/wiki/${way.tags.wikidata}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                                    ${way.tags.wikidata} →
                                                </a>
                                                <span style="color: #999; font-size: 0.8rem; display: block; margin-top: 3px;">
                                                    ⚠️ Données sur le tronçon uniquement
                                                </span>
                                            </div>
                                        ` : ''}
                                        
                                        ${way.tags.wikipedia || way.relationTags?.wikipedia ? `
                                            <div class="detail">
                                                <strong>📖 Wikipedia&nbsp;:</strong> 
                                                <a href="https://fr.wikipedia.org/wiki/${encodeURIComponent((way.relationTags?.wikipedia || way.tags.wikipedia).replace('fr:', ''))}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                                    Lire l'article →
                                                </a>
                                            </div>
                                        ` : ''}
                                        
                                        ${way.tags.website || way.relationTags?.website ? `
                                            <div class="detail">
                                                <strong>🌐 Site web&nbsp;:</strong> 
                                                <a href="${way.relationTags?.website || way.tags.website}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                                    Visiter →
                                                </a>
                                            </div>
                                        ` : ''}
                                        
                                        ${way.tags.destination || way.relationTags?.destination ? `
                                            <div class="detail" style="margin-top: 8px;">
                                                <strong>🎯 Destination&nbsp;:</strong> ${way.relationTags?.destination || way.tags.destination}
                                            </div>
                                        ` : ''}
                                        
                                        ${way.hasRelation ? `
                                            <div class="detail" style="margin-top: 8px;">
                                                <strong>Relation OSM&nbsp;:</strong> <span style="color: #27AE60; font-weight: 600;">✓ Complète</span>
                                            </div>
                                        ` : `
                                            <div class="detail" style="margin-top: 8px;">
                                                <strong>Relation OSM&nbsp;:</strong> <span style="color: #E74C3C;">✗ Manquante</span>
                                                <span style="font-size: 0.8rem; color: #999; display: block; margin-top: 3px;">
                                                    💡 Contribuez en créant une relation pour cette route
                                                </span>
                                            </div>
                                        `}
                                        
                                        <div class="detail" style="margin-top: 12px; padding-top: 12px; border-top: 2px solid #e0e0e0;">
                                            <div style="font-size: 0.7rem; font-weight: 700; color: #7f8c8d; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Contribuer / Qualifier</div>
                                            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                                                ${way.id ? `
                                                    <a href="https://www.openstreetmap.org/way/${way.id}" target="_blank" style="color: #3498DB; font-weight: 600; text-decoration: none; padding: 4px 8px; border: 1px solid #3498DB; border-radius: 4px; font-size: 0.78rem;">
                                                        🗺️ Voir tronçon OSM
                                                    </a>
                                                    <a href="https://www.openstreetmap.org/edit?editor=id&way=${way.id}" target="_blank" title="Éditer ce tronçon dans iD" style="color: #2C3E50; font-weight: 600; text-decoration: none; padding: 4px 8px; border: 1px solid #2C3E50; border-radius: 4px; font-size: 0.78rem;">
                                                        ✏️ Éditer dans iD
                                                    </a>
                                                ` : ''}
                                                ${way.hasRelation ? `
                                                    <a href="https://www.openstreetmap.org/relation/${way.relationId}" target="_blank" style="color: #27AE60; font-weight: 600; text-decoration: none; padding: 4px 8px; border: 1px solid #27AE60; border-radius: 4px; font-size: 0.78rem;">
                                                        📋 Voir relation
                                                    </a>
                                                    <a href="https://www.openstreetmap.org/edit?editor=id&relation=${way.relationId}" target="_blank" title="Éditer la relation dans iD" style="color: #16a085; font-weight: 600; text-decoration: none; padding: 4px 8px; border: 1px solid #16a085; border-radius: 4px; font-size: 0.78rem;">
                                                        ✏️ Éditer relation
                                                    </a>
                                                ` : ''}
                                                ${(way.relationTags?.wikidata || way.tags.wikidata) ? `
                                                    <a href="https://www.wikidata.org/wiki/${way.relationTags?.wikidata || way.tags.wikidata}#identifiers" target="_blank" style="color: #9B59B6; font-weight: 600; text-decoration: none; padding: 4px 8px; border: 1px solid #9B59B6; border-radius: 4px; font-size: 0.78rem;">
                                                        📚 Compléter Wikidata
                                                    </a>
                                                ` : `
                                                    <a href="https://www.wikidata.org/wiki/Special:NewItem" target="_blank" title="Créer un nouvel item Wikidata pour cette route" style="color: #E74C3C; font-weight: 600; text-decoration: none; padding: 4px 8px; border: 1px solid #E74C3C; border-radius: 4px; font-size: 0.78rem;">
                                                        ➕ Créer item Wikidata
                                                    </a>
                                                `}
                                            </div>
                                        </div>
                                        ${wikidataQid ? `
                                            <div class="popup-infobox-section">
                                                <div class="popup-infobox-title">Infobox</div>
                                                <div class="popup-infobox-host" id="${popupInfoboxContainerId}" data-qid="${wikidataQid}">
                                                    <div class="popup-infobox-loading">Chargement…</div>
                                                </div>
                                            </div>
                                        ` : ''}
                                    </div>
                                `;

                                polyline.bindPopup(popupContent);
                                if (wikidataQid) attachRoutePopupInfobox(polyline);

                                // Effet de survol
                                polyline.on('mouseover', function() {
                                    this.setStyle({ weight: hierarchyWeights[hierarchy] + 2, opacity: 1 });
                                });

                                polyline.on('mouseout', function() {
                                    if (window.highlightedRoute !== ref) {
                                        this.setStyle({ weight: hierarchyWeights[hierarchy], opacity: 0.8 });
                                    }
                                });
                                
                                // Click to highlight
                                polyline.on('click', function() {
                                    highlightRoute(ref);
                                });
                            }
                        });
                    });

                    // Update legend counters
                    const counts = {
                        regional: new Set(),
                        territorial: new Set(),
                        local: new Set()
                    };

                    Object.keys(routesByRef).forEach(ref => {
                        const refClean = ref.replace(/\s+/g, '');
                        if (routeClassification.regional.some(r => refClean.includes(r.replace('D', '')))) {
                            counts.regional.add(ref);
                        } else if (routeClassification.territorial.some(r => refClean.includes(r.replace('D', '')))) {
                            counts.territorial.add(ref);
                        } else {
                            counts.local.add(ref);
                        }
                    });

                    // Update legend counters
                    const regionalItems = document.querySelectorAll('.legend-item[data-hierarchy="regional"] .legend-count');
                    regionalItems.forEach(item => item.textContent = counts.regional.size);
                    
                    const territorialItems = document.querySelectorAll('.legend-item[data-hierarchy="territorial"] .legend-count');
                    territorialItems.forEach(item => item.textContent = counts.territorial.size);
                    
                    const localItems = document.querySelectorAll('.legend-item[data-hierarchy="local"] .legend-count');
                    localItems.forEach(item => item.textContent = counts.local.size);

                    console.log('Routes chargées:', {
                        regional: counts.regional.size,
                        territorial: counts.territorial.size,
                        local: counts.local.size
                    });

                    if (typeof window.patchDashboardMetrics === 'function') {
                        window.patchDashboardMetrics({
                            hierarchy: {
                                regional: counts.regional.size,
                                territorial: counts.territorial.size,
                                local: counts.local.size
                            },
                            vintages: {
                                osm: formatDashboardCacheVintage(osmGeneratedAt, 'Cache OSM')
                            }
                        });
                    }

                    // Sync map + legend with default hidden layers
                    updateHierarchyDisplay();
                    tryApplyAppUrlState();
                    reassertInitialUrlViewIfNeeded();

                    // Initialize label display
                    updateRouteLabels();
                    
                    // Build route list
                    createRoadList();

                    // Compute OSM/Wikidata quality metrics and feed sidebar summary
                    if (typeof window.calculateQualityMetrics === 'function') {
                        window.calculateQualityMetrics();
                    } else {
                        updateWikidataSummary();
                        updateNetworkStats();
                    }
                }
            } catch (error) {
                console.error('Erreur lors du chargement des routes:', error);

                const detail = error && error.message
                    ? String(error.message).replace(/</g, '&lt;')
                    : 'Erreur inconnue';
                const fileHint = window.location.protocol === 'file:'
                    ? '<br><small>Ouvrez la page via un serveur HTTP (<code>python3 -m http.server 8080</code>), pas en file://.</small>'
                    : '';

                L.popup()
                    .setLatLng([43.95, 5.1])
                    .setContent(`<div style="padding: 10px;"><strong>⚠️ Routes non disponibles</strong><br><small>Impossible de charger le GeoJSON local des routes.</small><br><small style="color:#7f8c8d;">${detail}</small>${fileHint}</div>`)
                    .openOn(window.map);
                
                setTimeout(() => window.map.closePopup(), 4000);
            }
        }

        // --- RD labels: anti-collision + zoom sync ---
        // Panonceaux par niveau hiérarchique : le seuil est le zoom auquel le niveau
        // est *pleinement* lisible, le fondu de 0.75 niveau se joue juste avant.
        // Mise à jour pendant zoom/déplacement ; recadrage viewport pour limiter le bruit.
        // Priority: regional (3) > territorial (2) > local (1) — highest keeps ideal position.
        // Test: Avignon [43.9493, 4.8055] — z10 régional, z12 territorial, z13 local.
        const ROUTE_LABEL_ZOOM_THRESHOLDS = {
            regional: 10,
            territorial: 12,
            local: 13
        };
        const ROUTE_LABEL_ZOOM_FADE_SPAN = 0.75;
        const ROUTE_LABEL_VIEWPORT_PADDING = 0.12;
        const ROUTE_LABEL_PRIORITY = { regional: 3, territorial: 2, local: 1 };
        const ROUTE_HIERARCHY_LABELS = {
            regional: 'Intérêt régional',
            territorial: 'Développement territorial',
            local: 'Intérêt local'
        };
        const ROUTE_LABEL_COLLISION_PADDING = 4;
        const ROUTE_LABEL_SPIRAL_STEP_PX = 10;
        const ROUTE_LABEL_MAX_SPIRAL_STEPS = 24;
        const ROUTE_LABEL_CLUSTER_MIN = 4;
        // Un point sur trois suffit à situer la portion visible d'un itinéraire,
        // et le balayage reste léger sur les longues RD à chaque déplacement.
        const ROUTE_LABEL_POINT_STRIDE = 3;

        // Ancres candidates prises sur la portion de l'itinéraire réellement à
        // l'écran : une étiquette doit suivre la route quand on se déplace le long
        // d'elle, et non rester accrochée à un point fixe qui sort du cadre.
        function getRouteLabelCandidates(route, bounds) {
            const inView = [];
            if (!route.ways) return inView;
            for (const way of route.ways) {
                const geometry = way.geometry;
                if (!geometry || geometry.length === 0) continue;
                for (let i = 0; i < geometry.length; i += ROUTE_LABEL_POINT_STRIDE) {
                    const point = geometry[i];
                    if (bounds.contains([point.lat, point.lon])) {
                        inView.push(L.latLng(point.lat, point.lon));
                    }
                }
            }
            if (inView.length === 0) return inView;

            // Le milieu de la portion visible d'abord, puis deux replis écartés
            // pour laisser de la marge à la résolution des chevauchements.
            const pick = fraction => inView[Math.min(inView.length - 1, Math.round((inView.length - 1) * fraction))];
            const candidates = [pick(0.5)];
            if (inView.length > 2) candidates.push(pick(0.28), pick(0.72));
            return candidates;
        }

        // The fade runs up to the threshold, not from it: a level asked for at zoom 10
        // must be fully readable at zoom 10, not start appearing there.
        function getRouteLabelZoomOpacity(hierarchy, zoom) {
            const threshold = ROUTE_LABEL_ZOOM_THRESHOLDS[hierarchy];
            const fadeStart = threshold - ROUTE_LABEL_ZOOM_FADE_SPAN;
            if (zoom >= threshold) return 1;
            if (zoom <= fadeStart) return 0;
            return (zoom - fadeStart) / ROUTE_LABEL_ZOOM_FADE_SPAN;
        }

        function getRouteLabelZoomScale(zoom) {
            return Math.min(1.2, Math.max(0.88, 0.72 + zoom * 0.025));
        }

        function offsetLatLngByPixels(latlng, dx, dy) {
            const point = map.latLngToContainerPoint(latlng);
            return map.containerPointToLatLng(L.point(point.x + dx, point.y + dy));
        }

        function getRouteLabelScreenRect(marker) {
            const element = marker.getElement();
            if (!element) return null;
            const labelEl = element.querySelector('.route-label, .route-label-cluster, .route-label-cluster-badge');
            return (labelEl || element).getBoundingClientRect();
        }

        function routeLabelRectsOverlap(a, b, padding) {
            return !(
                a.right + padding <= b.left ||
                b.right + padding <= a.left ||
                a.bottom + padding <= b.top ||
                b.bottom + padding <= a.top
            );
        }

        function buildRouteLabelSpiralOffsets(maxSteps, stepPx) {
            const offsets = [[0, 0]];
            for (let ring = 1; ring <= maxSteps; ring += 1) {
                const distance = ring * stepPx;
                offsets.push([distance, 0], [-distance, 0], [0, distance], [0, -distance]);
                offsets.push([distance, distance], [-distance, distance], [distance, -distance], [-distance, -distance]);
            }
            return offsets;
        }

        const routeLabelSpiralOffsets = buildRouteLabelSpiralOffsets(
            ROUTE_LABEL_MAX_SPIRAL_STEPS,
            ROUTE_LABEL_SPIRAL_STEP_PX
        );

        function collectVisibleRouteLabels(zoom) {
            const entries = [];
            const bounds = map.getBounds().pad(ROUTE_LABEL_VIEWPORT_PADDING);
            ['regional', 'territorial', 'local'].forEach(hierarchy => {
                if (!hierarchyVisibility[hierarchy]) return;
                const opacity = getRouteLabelZoomOpacity(hierarchy, zoom);
                if (opacity <= 0) return;
                routesByHierarchy[hierarchy].forEach(route => {
                    const candidates = getRouteLabelCandidates(route, bounds);
                    if (candidates.length === 0) return;
                    entries.push({
                        route,
                        hierarchy,
                        ref: route.ref,
                        priority: ROUTE_LABEL_PRIORITY[hierarchy],
                        opacity,
                        anchor: candidates[0],
                        candidates
                    });
                });
            });
            entries.sort((a, b) => {
                if (b.priority !== a.priority) return b.priority - a.priority;
                return a.ref.localeCompare(b.ref, 'fr');
            });
            return entries;
        }

        function createRouteLabelMarker(entry, html, interactive) {
            return L.marker(entry.anchor, {
                icon: L.divIcon({
                    className: 'route-label-container',
                    html,
                    iconSize: null
                }),
                interactive: !!interactive
            }).addTo(window.map);
        }

        function resolveRouteLabelCollisions(placedEntries) {
            const resolvedRects = [];

            placedEntries.forEach(entry => {
                if (entry.isCluster) {
                    const rect = getRouteLabelScreenRect(entry.marker);
                    if (rect) resolvedRects.push(rect);
                    return;
                }

                const anchorPoints = entry.candidates.length > 0 ? entry.candidates : [entry.anchor];
                let placed = false;

                for (const anchor of anchorPoints) {
                    for (const [dx, dy] of routeLabelSpiralOffsets) {
                        const position = offsetLatLngByPixels(anchor, dx, dy);
                        entry.marker.setLatLng(position);
                        const rect = getRouteLabelScreenRect(entry.marker);
                        if (!rect) continue;

                        const overlaps = resolvedRects.some(other =>
                            routeLabelRectsOverlap(rect, other, ROUTE_LABEL_COLLISION_PADDING)
                        );
                        if (!overlaps) {
                            entry.resolvedLatLng = position;
                            entry.resolvedRect = rect;
                            resolvedRects.push(rect);
                            placed = true;
                            break;
                        }
                    }
                    if (placed) break;
                }

                if (!placed) {
                    const rect = getRouteLabelScreenRect(entry.marker);
                    if (rect) {
                        entry.resolvedLatLng = entry.marker.getLatLng();
                        entry.resolvedRect = rect;
                        entry.unresolved = true;
                        resolvedRects.push(rect);
                    }
                }
            });
        }

        function findRouteLabelOverlapGroups(entries) {
            const unresolved = entries.filter(entry => entry.unresolved && !entry.isCluster);
            const parent = unresolved.map((_, index) => index);

            function find(index) {
                if (parent[index] !== index) parent[index] = find(parent[index]);
                return parent[index];
            }

            function union(a, b) {
                parent[find(a)] = find(b);
            }

            for (let i = 0; i < unresolved.length; i += 1) {
                for (let j = i + 1; j < unresolved.length; j += 1) {
                    if (routeLabelRectsOverlap(
                        unresolved[i].resolvedRect,
                        unresolved[j].resolvedRect,
                        ROUTE_LABEL_COLLISION_PADDING
                    )) {
                        union(i, j);
                    }
                }
            }

            const groups = new Map();
            unresolved.forEach((entry, index) => {
                const root = find(index);
                if (!groups.has(root)) groups.set(root, []);
                groups.get(root).push(entry);
            });
            return [...groups.values()].filter(group => group.length >= ROUTE_LABEL_CLUSTER_MIN);
        }

        function buildRouteLabelHtml(entry, zoom) {
            const opacity = entry.opacity ?? getRouteLabelZoomOpacity(entry.hierarchy, zoom);
            const scale = getRouteLabelZoomScale(zoom);
            return `<div class="route-label ${entry.hierarchy}" style="opacity:${opacity.toFixed(2)};transform:scale(${scale.toFixed(2)})">${entry.ref}</div>`;
        }

        function buildRouteLabelClusterHtml(group, zoom) {
            group.sort((a, b) => {
                if (b.priority !== a.priority) return b.priority - a.priority;
                return a.ref.localeCompare(b.ref, 'fr');
            });
            const labelsHtml = group
                .map(entry => buildRouteLabelHtml(entry, zoom))
                .join('');
            return `<div class="route-label-cluster" title="${group.map(e => e.ref).join(', ')}">${labelsHtml}</div>`;
        }

        function buildRouteLabelClusterPopup(group) {
            const items = group
                .slice()
                .sort((a, b) => {
                    if (b.priority !== a.priority) return b.priority - a.priority;
                    return a.ref.localeCompare(b.ref, 'fr');
                })
                .map(entry => `<li><strong>${entry.ref}</strong> — ${ROUTE_HIERARCHY_LABELS[entry.hierarchy] || entry.hierarchy}</li>`)
                .join('');
            return `<div class="route-popup"><strong>${group.length} routes</strong><ul style="margin:6px 0 0;padding-left:18px;">${items}</ul></div>`;
        }

        function mergeRouteLabelClusters(placedEntries, overlapGroups) {
            overlapGroups.forEach(group => {
                group.forEach(entry => {
                    map.removeLayer(entry.marker);
                    const index = placedEntries.indexOf(entry);
                    if (index !== -1) placedEntries.splice(index, 1);
                });

                const centerLatLng = group.reduce((sum, entry) => {
                    const ll = entry.resolvedLatLng || entry.anchor;
                    return L.latLng(sum.lat + ll.lat, sum.lng + ll.lng);
                }, L.latLng(0, 0));
                centerLatLng.lat /= group.length;
                centerLatLng.lng /= group.length;

                const clusterEntry = {
                    isCluster: true,
                    ref: `+${group.length}`,
                    group,
                    anchor: centerLatLng,
                    candidates: [centerLatLng],
                    priority: Math.max(...group.map(e => e.priority))
                };
                clusterEntry.marker = createRouteLabelMarker(
                    clusterEntry,
                    buildRouteLabelClusterHtml(group, map.getZoom()),
                    true
                );
                clusterEntry.marker.bindPopup(buildRouteLabelClusterPopup(group));
                placedEntries.push(clusterEntry);
            });

            if (overlapGroups.length === 0) return;

            const existingRects = placedEntries
                .filter(entry => !entry.isCluster && entry.resolvedRect)
                .map(entry => entry.resolvedRect);

            placedEntries.filter(entry => entry.isCluster).forEach(entry => {
                let placed = false;
                for (const [dx, dy] of routeLabelSpiralOffsets) {
                    const position = offsetLatLngByPixels(entry.anchor, dx, dy);
                    entry.marker.setLatLng(position);
                    const rect = getRouteLabelScreenRect(entry.marker);
                    if (!rect) continue;
                    const overlaps = existingRects.some(other =>
                        routeLabelRectsOverlap(rect, other, ROUTE_LABEL_COLLISION_PADDING)
                    );
                    if (!overlaps) {
                        entry.resolvedLatLng = position;
                        entry.resolvedRect = rect;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    const rect = getRouteLabelScreenRect(entry.marker);
                    if (rect) {
                        entry.resolvedLatLng = entry.marker.getLatLng();
                        entry.resolvedRect = rect;
                    }
                }
            });
        }

        function updateRouteLabels() {
            roadLabels.forEach(label => map.removeLayer(label));
            roadLabels = [];

            const anyHierarchyVisible = ['regional', 'territorial', 'local']
                .some(hierarchy => hierarchyVisibility[hierarchy]);
            if (!anyHierarchyVisible) return;

            const zoom = map.getZoom();
            const entries = collectVisibleRouteLabels(zoom);
            const placedEntries = entries.map(entry => {
                const placed = {
                    ...entry,
                    marker: createRouteLabelMarker(
                        entry,
                        buildRouteLabelHtml(entry, zoom),
                        false
                    )
                };
                return placed;
            });

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    resolveRouteLabelCollisions(placedEntries);
                    const overlapGroups = findRouteLabelOverlapGroups(placedEntries);
                    if (overlapGroups.length > 0) {
                        mergeRouteLabelClusters(placedEntries, overlapGroups);
                    }
                    roadLabels = placedEntries.map(entry => entry.marker);
                });
            });
        }
        // Reachable from the hierarchy toggles, which live outside DOMContentLoaded.
        window.updateRouteLabels = updateRouteLabels;

        let routeLabelRefreshPending = false;
        function scheduleRouteLabelRefresh() {
            if (routeLabelRefreshPending) return;
            routeLabelRefreshPending = true;
            requestAnimationFrame(() => {
                routeLabelRefreshPending = false;
                updateRouteLabels();
            });
        }

        map.on('zoom', scheduleRouteLabelRefresh);
        map.on('zoomend', scheduleRouteLabelRefresh);
        map.on('moveend', scheduleRouteLabelRefresh);

        map.on('zoomend', renderLatestChangesRecap);
        map.on('moveend', renderLatestChangesRecap);

        // ========== OSM QUALITY MANAGEMENT ==========
        
        let qualityMetrics = {
            totalRoutes: 0,
            withWikidata: 0,
            withRelation: 0,
            totalSegments: 0
        };

        function syncDashboardQualityMetrics() {
            if (typeof window.patchDashboardMetrics !== 'function') return;
            const total = qualityMetrics.totalRoutes || 0;
            const wikidataPct = total ? Math.round((qualityMetrics.withWikidata / total) * 100) : 0;
            const relationPct = total ? Math.round((qualityMetrics.withRelation / total) * 100) : 0;
            window.patchDashboardMetrics({
                quality: {
                    wikidataPct,
                    relationPct,
                    segments: qualityMetrics.totalSegments || 0
                }
            });
        }

        // Update Wikidata mini-summary permanently visible in sidebar
        function updateWikidataSummary() {
            const container = document.getElementById('wikidataSummary');
            if (!container) return;
            const total = qualityMetrics.totalRoutes || 0;
            if (total === 0) {
                container.innerHTML = '<div style="font-size:0.8rem;color:#7f8c8d;">Calcul en cours…</div>';
                return;
            }
            const withWd = qualityMetrics.withWikidata || 0;
            const without = total - withWd;
            const pct = Math.round((withWd / total) * 100);
            const withRel = qualityMetrics.withRelation || 0;
            const withoutRel = total - withRel;

            container.innerHTML = `
                <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">
                    <span style="font-family:'JetBrains Mono', monospace;font-size:1.4rem;font-weight:700;color:#27AE60;">${withWd}</span>
                    <span style="font-size:0.8rem;color:#7f8c8d;">/ ${total} routes liées Wikidata</span>
                    <span style="margin-left:auto;font-family:'JetBrains Mono', monospace;font-weight:700;color:#2C3E50;">${pct}%</span>
                </div>
                <div style="height:6px;border-radius:3px;background:#ecf0f1;overflow:hidden;display:flex;margin-bottom:8px;">
                    <div style="width:${pct}%;background:linear-gradient(90deg,#27AE60,#2ECC71);"></div>
                    <div style="width:${100 - pct}%;background:linear-gradient(90deg,#E74C3C,#C0392B);"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.72rem;margin-bottom:8px;">
                    <div style="padding:6px 8px;background:#fdecea;border-radius:4px;color:#922b21;">
                        <strong>${without}</strong> routes <em>sans Wikidata</em>
                    </div>
                    <div style="padding:6px 8px;background:#fef5e7;border-radius:4px;color:#8a5a00;">
                        <strong>${withoutRel}</strong> routes <em>sans relation</em>
                    </div>
                </div>
                <div style="display:flex;gap:6px;">
                    <button onclick="highlightRoutesByWikidata(false)" style="flex:1;border:1px solid #E74C3C;background:white;color:#E74C3C;border-radius:5px;padding:6px;font-size:0.7rem;font-weight:600;cursor:pointer;">Voir les routes sans Wikidata</button>
                </div>
            `;
        }

        window.updateWikidataSummary = updateWikidataSummary;

        window.calculateQualityMetrics = function() {
            console.log('📊 Calcul des métriques de qualité OSM...');
            
            qualityMetrics = { totalRoutes: 0, withWikidata: 0, withRelation: 0, totalSegments: 0 };

            Object.keys(routePolylines).forEach(ref => {
                qualityMetrics.totalRoutes++;
                qualityMetrics.totalSegments += routePolylines[ref].length;
                
                const routeData = [...routesByHierarchy.regional, ...routesByHierarchy.territorial, ...routesByHierarchy.local]
                    .find(r => r.ref === ref);
                
                if (routeData && routeData.ways) {
                    // Check Wikidata: relation first, otherwise check if ALL ways have it
                    let hasWikidata = false;
                    
                    // 1. Check whether the relation has Wikidata
                    const relationWithWikidata = routeData.ways.find(way => 
                        way.relationTags && way.relationTags.wikidata
                    );
                    
                    if (relationWithWikidata) {
                        hasWikidata = true;
                    } else {
                        // 2. Otherwise check whether all ways have wikidata (rare but possible)
                        const totalWays = routeData.ways.length;
                        const waysWithWikidata = routeData.ways.filter(way => 
                            way.tags && way.tags.wikidata
                        ).length;
                        
                        // If at least 80% of segments have wikidata, consider it OK
                        hasWikidata = waysWithWikidata > 0 && (waysWithWikidata / totalWays) >= 0.8;
                    }
                    
                    // Check relation
                    const hasRelation = routeData.ways.some(way => 
                        way.hasRelation === true || way.relationId
                    );
                    
                    if (hasWikidata) qualityMetrics.withWikidata++;
                    if (hasRelation) qualityMetrics.withRelation++;
                }
            });

            console.log('Métriques calculées:', qualityMetrics);
            displayQualityMetrics();
            updateWikidataSummary();
            updateNetworkStats();
            syncDashboardQualityMetrics();
        }

        // Live computation of "Network Information" stats from loaded polylines.
        function polylineLengthKm(polyline) {
            const pts = polyline.getLatLngs();
            let total = 0;
            for (let i = 1; i < pts.length; i++) total += haversineKm(pts[i - 1], pts[i]);
            return total;
        }

        function collectNetworkStatsData() {
            const refs = Object.keys(window.routePolylines || {});
            let totalSegments = 0;
            let totalKm = 0;
            let bridgeCount = 0;
            let tunnelCount = 0;
            refs.forEach(ref => {
                window.routePolylines[ref].forEach(polyline => {
                    totalSegments++;
                    totalKm += polylineLengthKm(polyline);
                    const tags = polyline.options.wayTags || {};
                    if (tags.bridge && tags.bridge !== 'no') bridgeCount++;
                    if (tags.tunnel === 'yes') tunnelCount++;
                });
            });

            const mjaValues = [];
            (typeof trafficMarkers !== 'undefined' ? trafficMarkers : []).forEach(marker => {
                const num = marker.trafficMja;
                if (Number.isFinite(num) && num > 0) mjaValues.push(num);
            });

            let mjaRange = null;
            if (mjaValues.length) {
                const min = Math.min(...mjaValues);
                const max = Math.max(...mjaValues);
                const fmt = v => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
                mjaRange = `${fmt(min)} – ${fmt(max)} véh/j`;
            }

            return {
                refs: refs.length,
                totalSegments,
                lengthKm: totalKm,
                bridges: bridgeCount,
                tunnels: tunnelCount,
                mjaRange,
                mjaStationCount: mjaValues.length
            };
        }

        function syncDashboardNetworkStats() {
            if (typeof window.patchDashboardMetrics !== 'function') return;
            const stats = collectNetworkStatsData();
            window.patchDashboardMetrics({
                network: {
                    refs: stats.refs,
                    lengthKm: stats.lengthKm,
                    bridges: stats.bridges,
                    tunnels: stats.tunnels
                }
            });
        }

        function updateNetworkStats() {
            const refsEl = document.getElementById('networkStat-refs');
            const segmentsEl = document.getElementById('networkStat-segments');
            const lengthEl = document.getElementById('networkStat-length');
            const trafficEl = document.getElementById('networkStat-traffic');
            const bridgesEl = document.getElementById('networkStat-bridges');
            const tunnelsEl = document.getElementById('networkStat-tunnels');
            if (!refsEl) {
                syncDashboardNetworkStats();
                return;
            }

            const stats = collectNetworkStatsData();

            refsEl.textContent = stats.refs.toLocaleString('fr-FR');
            segmentsEl.textContent = stats.totalSegments.toLocaleString('fr-FR');
            lengthEl.textContent = stats.lengthKm >= 1
                ? `${Math.round(stats.lengthKm).toLocaleString('fr-FR')} km`
                : '—';
            bridgesEl.textContent = stats.bridges.toLocaleString('fr-FR');
            tunnelsEl.textContent = stats.tunnels.toLocaleString('fr-FR');

            const trafficTile = trafficEl ? trafficEl.closest('.network-tile') : null;
            if (stats.mjaRange) {
                trafficEl.textContent = stats.mjaRange;
                if (trafficTile) trafficTile.style.display = '';
            } else {
                if (trafficTile) trafficTile.style.display = 'none';
            }

            syncDashboardNetworkStats();
        }

        window.updateNetworkStats = updateNetworkStats;

        function displayQualityMetrics() {
            const content = document.getElementById('qualityContent');
            
            const wikidataPercent = qualityMetrics.totalRoutes > 0 
                ? Math.round((qualityMetrics.withWikidata / qualityMetrics.totalRoutes) * 100) : 0;
            const relationPercent = qualityMetrics.totalRoutes > 0 
                ? Math.round((qualityMetrics.withRelation / qualityMetrics.totalRoutes) * 100) : 0;

            const wikidataMissing = qualityMetrics.totalRoutes - qualityMetrics.withWikidata;
            const relationMissing = qualityMetrics.totalRoutes - qualityMetrics.withRelation;

            content.innerHTML = `
                <div class="quality-metric">
                    <div class="quality-metric-title">Routes avec Wikidata</div>
                    
                    <!-- Barre de progression interactive -->
                    <div style="display: flex; align-items: center; gap: 10px; margin: 15px 0;">
                        <div style="flex: 1; height: 40px; background: #f0f0f0; border-radius: 8px; overflow: hidden; display: flex; box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);">
                            <div onclick="highlightRoutesByWikidata(true)" 
                                 style="width: ${wikidataPercent}%; background: linear-gradient(135deg, #27AE60 0%, #2ECC71 100%); cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 0.9rem; transition: all 0.3s; position: relative;"
                                 onmouseover="this.style.filter='brightness(1.1)'; this.style.transform='scaleY(1.05)'"
                                 onmouseout="this.style.filter='brightness(1)'; this.style.transform='scaleY(1)'">
                                ${wikidataPercent > 15 ? `${qualityMetrics.withWikidata}` : ''}
                            </div>
                            <div onclick="highlightRoutesByWikidata(false)" 
                                 style="width: ${100-wikidataPercent}%; background: linear-gradient(135deg, #E74C3C 0%, #C0392B 100%); cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 0.9rem; transition: all 0.3s;"
                                 onmouseover="this.style.filter='brightness(1.1)'; this.style.transform='scaleY(1.05)'"
                                 onmouseout="this.style.filter='brightness(1)'; this.style.transform='scaleY(1)'">
                                ${(100-wikidataPercent) > 15 ? `${wikidataMissing}` : ''}
                            </div>
                        </div>
                        <div style="font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 1.3rem; color: #2C3E50; min-width: 60px; text-align: right;">
                            ${wikidataPercent}%
                        </div>
                    </div>
                    
                    <!-- Légende interactive -->
                    <div style="display: flex; gap: 15px; font-size: 0.8rem; margin-top: 10px;">
                        <div style="display: flex; align-items: center; gap: 5px; cursor: pointer;" onclick="highlightRoutesByWikidata(true)">
                            <div style="width: 16px; height: 16px; background: linear-gradient(135deg, #27AE60, #2ECC71); border-radius: 3px;"></div>
                            <span style="color: #27AE60; font-weight: 600;">${qualityMetrics.withWikidata} avec</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; cursor: pointer;" onclick="highlightRoutesByWikidata(false)">
                            <div style="width: 16px; height: 16px; background: linear-gradient(135deg, #E74C3C, #C0392B); border-radius: 3px;"></div>
                            <span style="color: #E74C3C; font-weight: 600;">${wikidataMissing} sans</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; cursor: pointer; margin-left: auto;" onclick="clearHighlight()">
                            <span style="color: #95a5a6; font-weight: 600;">⊗ Réinitialiser</span>
                        </div>
                    </div>
                </div>

                <div class="quality-metric">
                    <div class="quality-metric-title">Routes avec Relation OSM</div>
                    
                    <!-- Barre de progression interactive -->
                    <div style="display: flex; align-items: center; gap: 10px; margin: 15px 0;">
                        <div style="flex: 1; height: 40px; background: #f0f0f0; border-radius: 8px; overflow: hidden; display: flex; box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);">
                            <div onclick="highlightRoutesByRelation(true)" 
                                 style="width: ${relationPercent}%; background: linear-gradient(135deg, #3498DB 0%, #2980B9 100%); cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 0.9rem; transition: all 0.3s;"
                                 onmouseover="this.style.filter='brightness(1.1)'; this.style.transform='scaleY(1.05)'"
                                 onmouseout="this.style.filter='brightness(1)'; this.style.transform='scaleY(1)'">
                                ${relationPercent > 15 ? `${qualityMetrics.withRelation}` : ''}
                            </div>
                            <div onclick="highlightRoutesByRelation(false)" 
                                 style="width: ${100-relationPercent}%; background: linear-gradient(135deg, #E67E22 0%, #D35400 100%); cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 0.9rem; transition: all 0.3s;"
                                 onmouseover="this.style.filter='brightness(1.1)'; this.style.transform='scaleY(1.05)'"
                                 onmouseout="this.style.filter='brightness(1)'; this.style.transform='scaleY(1)'">
                                ${(100-relationPercent) > 15 ? `${relationMissing}` : ''}
                            </div>
                        </div>
                        <div style="font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 1.3rem; color: #2C3E50; min-width: 60px; text-align: right;">
                            ${relationPercent}%
                        </div>
                    </div>
                    
                    <!-- Légende interactive -->
                    <div style="display: flex; gap: 15px; font-size: 0.8rem; margin-top: 10px;">
                        <div style="display: flex; align-items: center; gap: 5px; cursor: pointer;" onclick="highlightRoutesByRelation(true)">
                            <div style="width: 16px; height: 16px; background: linear-gradient(135deg, #3498DB, #2980B9); border-radius: 3px;"></div>
                            <span style="color: #3498DB; font-weight: 600;">${qualityMetrics.withRelation} avec</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; cursor: pointer;" onclick="highlightRoutesByRelation(false)">
                            <div style="width: 16px; height: 16px; background: linear-gradient(135deg, #E67E22, #D35400); border-radius: 3px;"></div>
                            <span style="color: #E67E22; font-weight: 600;">${relationMissing} sans</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; cursor: pointer; margin-left: auto;" onclick="clearHighlight()">
                            <span style="color: #95a5a6; font-weight: 600;">⊗ Réinitialiser</span>
                        </div>
                    </div>
                </div>

                <div class="quality-metric">
                    <div class="quality-metric-title">📊 Statistiques</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 15px; border-radius: 8px; text-align: center; color: white;">
                            <div style="font-size: 1.8rem; font-weight: 700; font-family: 'JetBrains Mono', monospace;">${qualityMetrics.totalRoutes}</div>
                            <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 3px;">Routes totales</div>
                        </div>
                        <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 15px; border-radius: 8px; text-align: center; color: white;">
                            <div style="font-size: 1.8rem; font-weight: 700; font-family: 'JetBrains Mono', monospace;">${qualityMetrics.totalSegments}</div>
                            <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 3px;">Tronçons OSM</div>
                        </div>
                    </div>
                </div>

            `;
        }

        // ========== QUALITY FILTER FUNCTIONS ==========
        
        window.highlightRoutesByWikidata = function(hasWikidata) {
            console.log('🎯 Filtrage routes avec Wikidata:', hasWikidata);
            
            // Reset all routes
            Object.keys(routePolylines).forEach(ref => {
                const polylines = routePolylines[ref];
                polylines.forEach(polyline => {
                    polyline.setStyle({ opacity: 0.2, weight: hierarchyWeights[polyline.options.roadHierarchy] });
                });
            });
            
            // Highlight matching routes
            Object.keys(routePolylines).forEach(ref => {
                const routeData = [...routesByHierarchy.regional, ...routesByHierarchy.territorial, ...routesByHierarchy.local]
                    .find(r => r.ref === ref);
                
                if (routeData && routeData.ways) {
                    // Same logic as calculateQualityMetrics
                    let routeHasWikidata = false;
                    
                    // 1. Check whether the relation has Wikidata
                    const relationWithWikidata = routeData.ways.find(way => 
                        way.relationTags && way.relationTags.wikidata
                    );
                    
                    if (relationWithWikidata) {
                        routeHasWikidata = true;
                    } else {
                        // 2. Otherwise check whether all ways have wikidata
                        const totalWays = routeData.ways.length;
                        const waysWithWikidata = routeData.ways.filter(way => 
                            way.tags && way.tags.wikidata
                        ).length;
                        
                        routeHasWikidata = waysWithWikidata > 0 && (waysWithWikidata / totalWays) >= 0.8;
                    }
                    
                    if (routeHasWikidata === hasWikidata) {
                        const polylines = routePolylines[ref];
                        polylines.forEach(polyline => {
                            const hierarchy = polyline.options.roadHierarchy;
                            polyline.setStyle({ 
                                opacity: 1, 
                                weight: hierarchyWeights[hierarchy] + 2,
                                color: hasWikidata ? '#27AE60' : '#E74C3C'
                            });
                            polyline.bringToFront();
                        });
                    }
                }
            });
            
            // Message dans la console
            const matchingRoutes = Object.keys(routePolylines).filter(ref => {
                const routeData = [...routesByHierarchy.regional, ...routesByHierarchy.territorial, ...routesByHierarchy.local]
                    .find(r => r.ref === ref);
                if (routeData && routeData.ways) {
                    let routeHasWikidata = false;
                    const relationWithWikidata = routeData.ways.find(way => 
                        way.relationTags && way.relationTags.wikidata
                    );
                    if (relationWithWikidata) {
                        routeHasWikidata = true;
                    } else {
                        const totalWays = routeData.ways.length;
                        const waysWithWikidata = routeData.ways.filter(way => 
                            way.tags && way.tags.wikidata
                        ).length;
                        routeHasWikidata = waysWithWikidata > 0 && (waysWithWikidata / totalWays) >= 0.8;
                    }
                    return routeHasWikidata === hasWikidata;
                }
                return false;
            });
            
            console.log(`✓ ${matchingRoutes.length} routes mises en évidence (Wikidata : ${hasWikidata ? 'avec' : 'sans'})`);
        }
        
        window.highlightRoutesByRelation = function(hasRelation) {
            console.log('🎯 Filtrage routes avec Relation:', hasRelation);
            
            // Reset all routes
            Object.keys(routePolylines).forEach(ref => {
                const polylines = routePolylines[ref];
                polylines.forEach(polyline => {
                    polyline.setStyle({ opacity: 0.2, weight: hierarchyWeights[polyline.options.roadHierarchy] });
                });
            });
            
            // Highlight matching routes
            Object.keys(routePolylines).forEach(ref => {
                const routeData = [...routesByHierarchy.regional, ...routesByHierarchy.territorial, ...routesByHierarchy.local]
                    .find(r => r.ref === ref);
                
                if (routeData && routeData.ways) {
                    const routeHasRelation = routeData.ways.some(way => way.hasRelation === true || way.relationId);
                    
                    if (routeHasRelation === hasRelation) {
                        const polylines = routePolylines[ref];
                        polylines.forEach(polyline => {
                            const hierarchy = polyline.options.roadHierarchy;
                            polyline.setStyle({ 
                                opacity: 1, 
                                weight: hierarchyWeights[hierarchy] + 2,
                                color: hasRelation ? '#27AE60' : '#E74C3C'
                            });
                            polyline.bringToFront();
                        });
                    }
                }
            });
            
            const matchingRoutes = Object.keys(routePolylines).filter(ref => {
                const routeData = [...routesByHierarchy.regional, ...routesByHierarchy.territorial, ...routesByHierarchy.local]
                    .find(r => r.ref === ref);
                if (routeData && routeData.ways) {
                    const routeHasRelation = routeData.ways.some(way => way.hasRelation === true || way.relationId);
                    return routeHasRelation === hasRelation;
                }
                return false;
            });
            
            console.log(`✓ ${matchingRoutes.length} routes mises en évidence (Relation : ${hasRelation ? 'avec' : 'sans'})`);
        }
        
        window.clearHighlight = function() {
            console.log('🔄 Réinitialisation de l\'affichage');
            
            // Restore normal appearance for all routes
            Object.keys(routePolylines).forEach(ref => {
                const polylines = routePolylines[ref];
                polylines.forEach(polyline => {
                    const hierarchy = polyline.options.roadHierarchy;
                    polyline.setStyle({ 
                        opacity: 0.8, 
                        weight: hierarchyWeights[hierarchy],
                        color: hierarchyColors[hierarchy]
                    });
                });
            });

            clearStationAxisTrace();
            window.map.closePopup();
        }

        // Axis currently traced from a station click. Remembered so the info
        // panel is only closed when it still describes that selection, and not
        // when it describes a road opened by clicking the road itself.
        let stationAxisRef = null;

        // Remove the accent trace drawn for a clicked counting station.
        function clearStationAxisTrace() {
            if (Array.isArray(window.stationAxisLayers)) {
                window.stationAxisLayers.forEach(layer => {
                    if (window.map && window.map.hasLayer(layer)) window.map.removeLayer(layer);
                });
            }
            window.stationAxisLayers = [];
            stationAxisRef = null;
        }
        window.clearStationAxisTrace = clearStationAxisTrace;

        // Hiding the counting layer must take away what a station click had put
        // on screen, otherwise the map keeps an axis singled out by a station
        // that is no longer there to explain it.
        function clearStationSelection() {
            const ref = stationAxisRef;
            clearStationAxisTrace();
            if (!ref) return;

            const section = document.getElementById('road-info-section');
            const shownRef = document.querySelector('#road-info-panel .road-info-title')?.textContent;
            if (section && shownRef === ref) section.style.display = 'none';
        }
        window.clearStationSelection = clearStationSelection;

        // Draw a distinct accent trace over a road axis when a counting station is
        // clicked (issue #9). A vivid indigo line with a white casing reads clearly
        // as the road, separate from the round count markers, and keeps the current
        // view while filling the side info panel with the axis details.
        function highlightStationAxis(key) {
            clearStationAxisTrace();
            const polylines = window.routePolylines && window.routePolylines[key];
            if (!polylines || !polylines.length) return;

            polylines.forEach(source => {
                const coords = source.getLatLngs();
                const casing = L.polyline(coords, {
                    color: '#ffffff', weight: 11, opacity: 0.85,
                    lineCap: 'round', lineJoin: 'round', interactive: false
                }).addTo(window.map);
                const trace = L.polyline(coords, {
                    color: '#4f46e5', weight: 6, opacity: 0.95,
                    lineCap: 'round', lineJoin: 'round', interactive: false
                }).addTo(window.map);
                window.stationAxisLayers.push(casing, trace);
            });
            window.stationAxisLayers.forEach(layer => layer.bringToFront());

            const hierarchy = polylines[0].options.roadHierarchy;
            displayRoadInfo(key, hierarchy);
            stationAxisRef = key;
        }
        window.highlightStationAxis = highlightStationAxis;

        // Build the route list
        function createRoadList() {
            // Compiler toutes les routes
            allRoadsList = [];
            
            Object.keys(routePolylines).forEach(ref => {
                const refClean = ref.replace(/\s+/g, '');
                let hierarchy = 'local';
                
                if (routeClassification.regional.some(r => refClean.includes(r.replace('D', '')))) {
                    hierarchy = 'regional';
                } else if (routeClassification.territorial.some(r => refClean.includes(r.replace('D', '')))) {
                    hierarchy = 'territorial';
                }
                
                allRoadsList.push({
                    ref: ref,
                    hierarchy: hierarchy,
                    searchText: ref.toLowerCase()
                });
            });
            
            // Sort by hierarchy then number
            allRoadsList.sort((a, b) => {
                const hierarchyOrder = { regional: 0, territorial: 1, local: 2 };
                if (hierarchyOrder[a.hierarchy] !== hierarchyOrder[b.hierarchy]) {
                    return hierarchyOrder[a.hierarchy] - hierarchyOrder[b.hierarchy];
                }
                
                const numA = parseInt(a.ref.replace(/\D/g, '')) || 0;
                const numB = parseInt(b.ref.replace(/\D/g, '')) || 0;
                return numA - numB;
            });
            
            // Afficher la liste
            renderRoadList(allRoadsList);
            
            // Activer la recherche
            const searchInput = document.getElementById('road-search');
            searchInput.addEventListener('input', function() {
                const searchTerm = this.value.toLowerCase().trim();
                
                if (searchTerm === '') {
                    renderRoadList(allRoadsList);
                } else {
                    const filtered = allRoadsList.filter(road => 
                        road.searchText.includes(searchTerm)
                    );
                    renderRoadList(filtered);
                }
            });
        }
        
        // Fonction pour afficher la liste des routes
        function renderRoadList(roads) {
            const listContainer = document.getElementById('road-list');
            
            if (roads.length === 0) {
                listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #999; font-size: 0.85rem;">Aucune route trouvée</div>';
                return;
            }
            
            listContainer.innerHTML = roads.map(road => `
                <div class="road-item ${window.highlightedRoute === road.ref ? 'active' : ''}" data-ref="${road.ref}">
                    <div class="road-badge ${road.hierarchy}">${road.ref}</div>
                    <div class="road-name">${
                        road.hierarchy === 'regional' ? 'Intérêt régional' :
                        road.hierarchy === 'territorial' ? 'Développement territorial' :
                        'Intérêt local'
                    }</div>
                </div>
            `).join('');
            
            // Attach click handlers
            listContainer.querySelectorAll('.road-item').forEach(item => {
                item.addEventListener('click', function() {
                    const ref = this.getAttribute('data-ref');
                    highlightRoute(ref);
                });
            });
        }
        
        // Highlight a route. options.zoom (default true) controls whether the map
        // recentres on the whole axis — disabled when highlighting from a counting
        // station click (issue #9) so the station popup stays in view.
        function highlightRoute(ref, options = {}) {
            const { zoom = true } = options;
            // Clear any station-triggered axis trace so the two highlights never stack.
            if (typeof clearStationAxisTrace === 'function') clearStationAxisTrace();
            // Remove previous shadows
            Object.values(shadowPolylines).forEach(shadows => {
                shadows.forEach(shadow => map.removeLayer(shadow));
            });
            window.shadowPolylines = {};
            
            // Reset previous route
            if (window.highlightedRoute && routePolylines[window.highlightedRoute]) {
                routePolylines[window.highlightedRoute].forEach(polyline => {
                    const hierarchy = polyline.options.roadHierarchy;
                    polyline.setStyle({
                        color: hierarchyColors[hierarchy],
                        weight: hierarchyWeights[hierarchy],
                        opacity: 0.8
                    });
                });
            }
            
            // Highlight the new route
            if (routePolylines[ref]) {
                window.highlightedRoute = ref;
                
                const polylines = routePolylines[ref];
                const hierarchy = polylines[0].options.roadHierarchy;
                
                // Initialiser le tableau d'ombres pour cette route
                if (!window.shadowPolylines[ref]) {
                    window.shadowPolylines[ref] = [];
                }
                
                // Create shadows (3 layers for glow effect)
                polylines.forEach(polyline => {
                    const coords = polyline.getLatLngs();
                    
                    // Ombre externe noire (la plus large)
                    const shadow1 = L.polyline(coords, {
                        color: '#000000',
                        weight: hierarchyWeights[hierarchy] + 12,
                        opacity: 0.3,
                        smoothFactor: 1,
                        interactive: false,
                        roadHierarchy: hierarchy
                    }).addTo(window.map);
                    window.shadowPolylines[ref].push(shadow1);
                    
                    // Middle shadow layer
                    const shadow2 = L.polyline(coords, {
                        color: '#000000',
                        weight: hierarchyWeights[hierarchy] + 8,
                        opacity: 0.4,
                        smoothFactor: 1,
                        interactive: false,
                        roadHierarchy: hierarchy
                    }).addTo(window.map);
                    window.shadowPolylines[ref].push(shadow2);
                    
                    // Halo blanc
                    const shadow3 = L.polyline(coords, {
                        color: '#FFFFFF',
                        weight: hierarchyWeights[hierarchy] + 6,
                        opacity: 0.6,
                        smoothFactor: 1,
                        interactive: false,
                        roadHierarchy: hierarchy
                    }).addTo(window.map);
                    window.shadowPolylines[ref].push(shadow3);
                });
                
                // Highlight the route itself
                polylines.forEach(polyline => {
                    polyline.setStyle({
                        color: hierarchyColors[hierarchy],
                        weight: hierarchyWeights[hierarchy] + 4,
                        opacity: 1
                    });
                    polyline.bringToFront();
                });
                
                // Centrer la carte sur la route (sauf si appelé depuis une station)
                if (zoom) {
                    const bounds = L.latLngBounds(polylines.map(p => p.getBounds()));
                    map.fitBounds(bounds, { padding: [50, 50] });
                }
                
                // Update visual list
                document.querySelectorAll('.road-item').forEach(item => {
                    if (item.getAttribute('data-ref') === ref) {
                        item.classList.add('active');
                        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    } else {
                        item.classList.remove('active');
                    }
                });
                
                // Show detailed route information
                displayRoadInfo(ref, hierarchy);
            }
        }
        
        // Show detailed information for a route
        function displayRoadInfo(ref, hierarchy) {
            // Trouver les informations de la route
            let routeData = null;
            for (const [hier, routes] of Object.entries(routesByHierarchy)) {
                const found = routes.find(r => r.ref === ref);
                if (found) {
                    routeData = found;
                    break;
                }
            }
            
            if (!routeData) return;
            
            // Calculer les statistiques
            const lengthKm = (routeData.totalLength / 1000).toFixed(2);
            const nbSegments = routeData.ways.length;
            
            // Determine hierarchy type
            const hierarchyLabels = {
                regional: { label: 'Intérêt régional', color: '#E74C3C' },
                territorial: { label: 'Développement territorial', color: '#F39C12' },
                local: { label: 'Intérêt local', color: '#3498DB' }
            };
            
            const hierInfo = hierarchyLabels[hierarchy];
            
            // Build information panel HTML
            const infoPanel = document.getElementById('road-info-panel');
            const infoSection = document.getElementById('road-info-section');
            
            infoPanel.innerHTML = `
                <div class="road-info-title">${ref}</div>
                
                <div class="road-info-badge" style="background: ${hierInfo.color}; color: white;">
                    ${hierInfo.label}
                </div>
                
                <div style="margin-top: 15px;">
                    <div class="road-info-item">
                        <span class="road-info-label">Longueur totale</span>
                        <span class="road-info-value">${lengthKm} km</span>
                    </div>
                    
                    <div class="road-info-item">
                        <span class="road-info-label">Segments</span>
                        <span class="road-info-value">${nbSegments}</span>
                    </div>
                    
                    ${routeData.surfaces.size > 0 ? `
                    <div class="road-info-item">
                        <span class="road-info-label">Revêtement</span>
                        <span class="road-info-value">${Array.from(routeData.surfaces).join(', ')}</span>
                    </div>
                    ` : ''}
                    
                    ${routeData.maxspeeds.size > 0 ? `
                    <div class="road-info-item">
                        <span class="road-info-label">Vitesse max</span>
                        <span class="road-info-value">${Array.from(routeData.maxspeeds).sort((a,b) => parseInt(a) - parseInt(b)).join(', ')} km/h</span>
                    </div>
                    ` : ''}
                    
                    ${routeData.communes.size > 0 ? `
                    <div class="road-info-item" style="display: block; padding: 12px 0;">
                        <div class="road-info-label" style="margin-bottom: 8px;">Communes traversées</div>
                        <div class="road-info-value" style="text-align: left; line-height: 1.6; font-size: 0.8rem;">
                            ${formatCommunesList(Array.from(routeData.communes))}
                        </div>
                    </div>
                    ` : ''}
                </div>
            `;
            
            // Afficher la section
            infoSection.style.display = 'block';
            
            // Ajouter les gestionnaires de clic sur les communes
            setTimeout(() => {
                document.querySelectorAll('.commune-link').forEach(link => {
                    link.addEventListener('click', function() {
                        const commune = this.getAttribute('data-commune');
                        zoomToCommune(commune, ref);
                    });
                });
            }, 100);
            
            // Scroll vers le panneau d'informations
            setTimeout(() => {
                infoSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        }
        
        // Zoom to a specific municipality on a route
        let currentCommuneMarker = null; // Stocker le marqueur actuel pour le supprimer
        
        async function zoomToCommune(communeName, roadRef) {
            console.log(`Chargement du tronçon de ${roadRef} sur ${communeName}...`);
            
            // Remove previous marker if any
            if (currentCommuneMarker) {
                map.removeLayer(currentCommuneMarker);
                currentCommuneMarker = null;
            }
            
            try {
                const communeFeature = await window.InforouteApi.fetchCommuneBoundary(communeName);
                
                if (communeFeature) {
                    const communeRings = geoJsonPolygonGeometryToLatLngRings(communeFeature.geometry);
                    
                    if (communeRings.length > 0) {
                        // Create municipality polygon (temporary, invisible)
                        const communePolygon = L.polygon(communeRings, {
                            color: 'transparent',
                            fillOpacity: 0
                        });
                        
                        // Trouver les segments de la route qui intersectent avec la commune
                        const roadPolylines = routePolylines[roadRef];
                        const intersectingSegments = [];
                        
                        if (roadPolylines) {
                            roadPolylines.forEach(polyline => {
                                const coords = polyline.getLatLngs();
                                
                                // Check whether at least one polyline point is in the municipality
                                const hasIntersection = coords.some(coord => {
                                    const point = L.latLng(coord);
                                    return communeRings.some(ring => isPointInPolygon(point, ring));
                                });
                                
                                if (hasIntersection) {
                                    intersectingSegments.push(polyline);
                                }
                            });
                        }
                        
                        if (intersectingSegments.length > 0) {
                            // Calculer les bounds des segments qui traversent la commune
                            const bounds = L.latLngBounds(intersectingSegments.map(p => p.getBounds()));
                            
                            // Zoom to this area
                            map.fitBounds(bounds, { 
                                padding: [80, 80],
                                animate: true,
                                duration: 1
                            });
                            
                            // Flash effect on affected segments
                            const hierarchy = intersectingSegments[0].options.roadHierarchy;
                            const originalColor = hierarchyColors[hierarchy];
                            const originalWeight = hierarchyWeights[hierarchy] + 4; // Highlight weight
                            
                            // Animation flash
                            let flashCount = 0;
                            const flashInterval = setInterval(() => {
                                if (intersectingSegments.length > 0 && intersectingSegments[0]._map) {
                                    intersectingSegments.forEach(seg => {
                                        seg.setStyle({
                                            color: flashCount % 2 === 0 ? '#FFD700' : originalColor,
                                            weight: originalWeight + 2,
                                            opacity: 1
                                        });
                                    });
                                    flashCount++;
                                    
                                    if (flashCount >= 6) {
                                        clearInterval(flashInterval);
                                        // Restore highlight style
                                        intersectingSegments.forEach(seg => {
                                            if (seg._map) {
                                                seg.setStyle({
                                                    color: originalColor,
                                                    weight: originalWeight,
                                                    opacity: 1
                                                });
                                            }
                                        });
                                    }
                                } else {
                                    clearInterval(flashInterval);
                                }
                            }, 200);
                            
                            // Afficher un marqueur avec le nom de la commune
                            const center = bounds.getCenter();
                            currentCommuneMarker = L.marker(center, {
                                icon: L.divIcon({
                                    className: 'commune-marker',
                                    html: `<div style="background: #3498DB; color: white; padding: 8px 12px; border-radius: 20px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-size: 0.9rem; white-space: nowrap;">${communeName}<br><small style="font-weight: normal; opacity: 0.9;">${roadRef}</small></div>`,
                                    iconSize: null
                                })
                            }).addTo(window.map);
                            
                            // Remove marker after 4 seconds
                            setTimeout(() => {
                                if (currentCommuneMarker) {
                                    map.removeLayer(currentCommuneMarker);
                                    currentCommuneMarker = null;
                                }
                            }, 4000);
                            
                            console.log(`✓ Tronçon de ${roadRef} sur ${communeName} affiché (${intersectingSegments.length} segments)`);
                        } else {
                            console.warn(`Aucun segment de ${roadRef} trouvé sur ${communeName}`);
                            // Fallback: zoom to municipality anyway
                            zoomToCommuneFallback(communeName);
                        }
                    }
                } else {
                    // Fallback if municipality not found in GeoJSON
                    console.warn(`Commune ${communeName} non trouvée dans le GeoJSON`);
                    zoomToCommuneFallback(communeName);
                }
            } catch (error) {
                console.error('Erreur lors du chargement de la géométrie:', error);
                // Fallback
                zoomToCommuneFallback(communeName);
            }
        }
        
        // Fonction de secours pour zoomer sur la commune via le GeoJSON local
        async function zoomToCommuneFallback(communeName) {
            try {
                const communeFeature = await window.InforouteApi.fetchCommuneBoundary(communeName);
                const communeRings = geoJsonPolygonGeometryToLatLngRings(communeFeature?.geometry);
                
                if (communeRings.length > 0) {
                    const bounds = L.latLngBounds(communeRings.flat());
                    map.fitBounds(bounds, {
                        padding: [80, 80],
                        animate: true,
                        duration: 1
                    });
                }
            } catch (error) {
                console.error('Erreur lors du zoom GeoJSON commune:', error);
            }
        }
        
        // Point-in-polygon test (ray-casting algorithm)
        function isPointInPolygon(point, polygon) {
            let inside = false;
            const x = point.lat;
            const y = point.lng;
            
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                const xi = polygon[i][0], yi = polygon[i][1];
                const xj = polygon[j][0], yj = polygon[j][1];
                
                const intersect = ((yi > y) !== (yj > y)) && 
                                  (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            
            return inside;
        }
        
        // Format municipality list with endpoints in bold
        function formatCommunesList(communes) {
            if (communes.length === 0) return 'Non disponible';
            if (communes.length === 1) return `<strong>${communes[0]}</strong>`;
            if (communes.length === 2) return `<strong>${communes[0]}</strong>, <strong>${communes[1]}</strong>`;
            
            // Sort municipalities alphabetically
            const sorted = communes.sort((a, b) => a.localeCompare(b, 'fr'));
            
            // Create clickable links for each municipality
            const communeLinks = sorted.map((commune, index) => {
                const isExtremity = index === 0 || index === sorted.length - 1;
                const style = isExtremity ? 'font-weight: bold;' : '';
                return `<span class="commune-link" style="cursor: pointer; color: #3498DB; text-decoration: underline; ${style}" data-commune="${commune}">${commune}</span>`;
            });
            
            return communeLinks.join(', ');
        }

        const BRIDGE_ROLE_STYLES = {
            deck: { label: 'Tablier / ouvrage', color: '#2C3E50', weight: 3, fillOpacity: 0.12 },
            structure: { label: 'Structure', color: '#16A085', weight: 3, fillOpacity: 0.14, dashArray: '8, 5' },
            pillar: { label: 'Pile', color: '#8E44AD', weight: 2, fillOpacity: 0.22 },
            abutment: { label: 'Culée', color: '#E67E22', weight: 2, fillOpacity: 0.22 },
            bridge: { label: 'Élément de pont', color: '#7F8C8D', weight: 2, fillOpacity: 0.14 }
        };

        const BRIDGE_DIRECTION_LABELS = {
            N: 'nord',
            NE: 'nord-est',
            E: 'est',
            SE: 'sud-est',
            S: 'sud',
            SW: 'sud-ouest',
            W: 'ouest',
            NW: 'nord-ouest'
        };

        const BRIDGE_DIRECTION_COMPASS = {
            N: { lat: 1, lng: 0 },
            NE: { lat: 1, lng: 1 },
            E: { lat: 0, lng: 1 },
            SE: { lat: -1, lng: 1 },
            S: { lat: -1, lng: 0 },
            SW: { lat: -1, lng: -1 },
            W: { lat: 0, lng: -1 },
            NW: { lat: 1, lng: -1 }
        };

        function normalizeBridgeRole(rawRole) {
            const role = String(rawRole || '').trim().toLowerCase();
            if (role === 'pier') return 'pillar';
            if (role === 'abutement' || role === 'abutted' || role === 'abucted') return 'abutment';
            if (BRIDGE_ROLE_STYLES[role]) return role;
            return role || 'bridge';
        }

        function bridgeRoleFromTags(tags = {}) {
            if (tags.bridge_role) return normalizeBridgeRole(tags.bridge_role);
            if (tags['bridge:support']) return normalizeBridgeRole(tags['bridge:support']);
            if (tags.man_made === 'bridge') return 'deck';
            if (tags['bridge:structure']) return 'structure';
            return 'bridge';
        }

        function bridgeRoleStyle(role) {
            return BRIDGE_ROLE_STYLES[normalizeBridgeRole(role)] || BRIDGE_ROLE_STYLES.bridge;
        }

        function flattenGeoJsonCoordinatePairs(value, out = []) {
            if (!Array.isArray(value)) return out;
            if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
                out.push(value);
                return out;
            }
            value.forEach(item => flattenGeoJsonCoordinatePairs(item, out));
            return out;
        }

        function bridgeFeatureLatLngs(feature) {
            return flattenGeoJsonCoordinatePairs(feature?.geometry?.coordinates || [])
                .map(([lon, lat]) => L.latLng(lat, lon))
                .filter(latlng => Number.isFinite(latlng.lat) && Number.isFinite(latlng.lng));
        }

        function bridgeFeatureBounds(feature) {
            const latlngs = bridgeFeatureLatLngs(feature);
            return latlngs.length ? L.latLngBounds(latlngs) : null;
        }

        function bridgeFeatureInfo(feature) {
            const props = feature.properties || {};
            const bounds = bridgeFeatureBounds(feature);
            if (!bounds?.isValid()) return null;

            const id = feature.id || props['@id'] || `${props.osm_type || 'osm'}/${props.osm_id || Math.random().toString(36).slice(2)}`;
            const role = bridgeRoleFromTags(props);
            return {
                id,
                feature,
                tags: props,
                role,
                roleLabel: bridgeRoleStyle(role).label,
                color: bridgeRoleStyle(role).color,
                bounds,
                center: bounds.getCenter(),
                isMainBridge: props.man_made === 'bridge',
                photos: [],
                groupId: null
            };
        }

        function bridgeGroupTitle(info) {
            const tags = info?.tags || {};
            if (tags.name) return tags.name;
            if (tags.ref) return `Pont ${tags.ref}`;
            if (tags.wikidata) return `Pont ${tags.wikidata}`;
            return `Pont OSM ${info?.id || ''}`.trim();
        }

        function nearestMainBridge(info, mainInfos) {
            if (!info || info.isMainBridge || mainInfos.length === 0) return info?.isMainBridge ? info : null;

            const spatialMatches = mainInfos.filter(main => (
                main.bounds.intersects(info.bounds) || main.bounds.pad(0.25).contains(info.center)
            ));
            const candidates = spatialMatches.length ? spatialMatches : mainInfos;

            let best = null;
            let bestDistance = Infinity;
            candidates.forEach(main => {
                const distance = window.map.distance(info.center, main.center);
                if (distance < bestDistance) {
                    best = main;
                    bestDistance = distance;
                }
            });

            return bestDistance <= 160 ? best : null;
        }

        function splitBridgePhotoTagValue(value) {
            return String(value || '')
                .split(/[;,]/)
                .map(item => item.trim())
                .filter(item => item && !/^(no|none|fixme)$/i.test(item));
        }

        function normalizeBridgePhotoId(provider, value) {
            const raw = String(value || '').trim();
            if (!raw) return '';

            try {
                const url = new URL(raw);
                const param = url.searchParams.get('pKey') || url.searchParams.get('image_key') || url.searchParams.get('pic');
                if (param) return param;
                const pathId = url.pathname.split('/').filter(Boolean).pop();
                if (pathId) return pathId.replace(/\.(jpg|jpeg|png)$/i, '');
            } catch (_) {
                // Plain OSM tag value.
            }

            if (provider === 'panoramax') {
                const uuid = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
                return uuid ? uuid[0] : raw;
            }

            return raw;
        }

        function parseBridgePhotoTagContext(provider, tagKey) {
            const suffix = tagKey === provider ? '' : tagKey.slice(provider.length + 1);
            const parts = suffix.split(':').filter(Boolean);
            const directionKey = parts
                .map(part => part.toUpperCase())
                .find(part => BRIDGE_DIRECTION_LABELS[part]);
            const year = parts.find(part => /^\d{4}$/.test(part)) || '';
            const detail = parts.some(part => part.toLowerCase() === 'detail');

            return {
                direction: directionKey || '',
                directionLabel: directionKey ? BRIDGE_DIRECTION_LABELS[directionKey] : '',
                year,
                detail
            };
        }

        function collectBridgePhotos(info) {
            const tags = info.tags || {};
            const photos = [];

            Object.entries(tags).forEach(([tagKey, rawValue]) => {
                const provider = tagKey === 'panoramax' || tagKey.startsWith('panoramax:')
                    ? 'panoramax'
                    : tagKey === 'mapillary' || tagKey.startsWith('mapillary:')
                        ? 'mapillary'
                        : null;
                if (!provider) return;

                const context = parseBridgePhotoTagContext(provider, tagKey);
                splitBridgePhotoTagValue(rawValue).forEach(value => {
                    const id = normalizeBridgePhotoId(provider, value);
                    if (!id) return;
                    photos.push({
                        key: `${provider}:${id}`,
                        provider,
                        id,
                        tagKey,
                        context,
                        role: info.role,
                        roleLabel: info.roleLabel,
                        color: info.color,
                        partId: info.id,
                        partLabel: info.roleLabel,
                        center: info.center,
                        groupId: info.groupId
                    });
                });
            });

            return photos;
        }

        function bridgeOffsetLatLngByPixels(latlng, dx, dy) {
            if (!window.map || !latlng) return latlng;
            const point = window.map.latLngToContainerPoint(latlng);
            return window.map.containerPointToLatLng(L.point(point.x + dx, point.y + dy));
        }

        function computeBridgeAxis(group) {
            const latlngs = [];
            group.features.forEach(info => {
                const role = normalizeBridgeRole(info.role);
                if (['deck', 'structure', 'bridge'].includes(role) || info.isMainBridge) {
                    bridgeFeatureLatLngs(info.feature).forEach(latlng => latlngs.push(latlng));
                }
            });
            if (!latlngs.length) {
                group.features.forEach(info => {
                    bridgeFeatureLatLngs(info.feature).forEach(latlng => latlngs.push(latlng));
                });
            }

            const center = group.bounds?.isValid?.() ? group.bounds.getCenter() : latlngs[0];
            if (!latlngs.length) {
                return { start: center, end: center, center, length: 0 };
            }
            if (latlngs.length === 1) {
                return { start: latlngs[0], end: latlngs[0], center: latlngs[0], length: 0 };
            }

            let bestI = 0;
            let bestJ = 1;
            let bestDistance = 0;
            for (let i = 0; i < latlngs.length; i += 1) {
                for (let j = i + 1; j < latlngs.length; j += 1) {
                    const distance = latlngs[i].distanceTo(latlngs[j]);
                    if (distance > bestDistance) {
                        bestDistance = distance;
                        bestI = i;
                        bestJ = j;
                    }
                }
            }

            const start = latlngs[bestI];
            const end = latlngs[bestJ];
            return {
                start,
                end,
                center: L.latLng((start.lat + end.lat) / 2, (start.lng + end.lng) / 2),
                length: bestDistance
            };
        }

        function bridgeAxisPointAt(axis, t) {
            const clamped = Math.min(1, Math.max(0, t));
            return L.latLng(
                axis.start.lat + (axis.end.lat - axis.start.lat) * clamped,
                axis.start.lng + (axis.end.lng - axis.start.lng) * clamped
            );
        }

        function projectOnBridgeAxis(axis, latlng) {
            if (!window.map || !axis || !latlng) return 0.5;
            const start = window.map.latLngToContainerPoint(axis.start);
            const end = window.map.latLngToContainerPoint(axis.end);
            const point = window.map.latLngToContainerPoint(latlng);
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const lengthSquared = (dx * dx) + (dy * dy);
            if (lengthSquared < 1) return 0.5;
            return Math.min(1, Math.max(0, (
                ((point.x - start.x) * dx) + ((point.y - start.y) * dy)
            ) / lengthSquared));
        }

        function isBridgeSpanPhotoRole(role) {
            return ['deck', 'structure', 'bridge'].includes(normalizeBridgeRole(role));
        }

        function defaultBridgePhotoAxisT(photo, group) {
            const part = bridgeFeatureInfoById.get(photo.partId);
            if (part && group.bridgeAxis) return projectOnBridgeAxis(group.bridgeAxis, part.center);
            if (photo.role === 'abutment') return 0.08;
            if (photo.role === 'pillar') return 0.5;
            if (photo.role === 'deck') return 0.5;
            return 0.5;
        }

        function bridgePerpendicularUnitVector(axis) {
            if (!window.map || !axis) return null;
            const start = window.map.latLngToContainerPoint(axis.start);
            const end = window.map.latLngToContainerPoint(axis.end);
            const axisLength = Math.hypot(end.x - start.x, end.y - start.y) || 1;
            return {
                x: -(end.y - start.y) / axisLength,
                y: (end.x - start.x) / axisLength
            };
        }

        function bridgePhotoSideForDirection(axis, along, directionKey) {
            const compass = BRIDGE_DIRECTION_COMPASS[directionKey];
            const perp = bridgePerpendicularUnitVector(axis);
            if (!compass || !perp || !along) return null;

            const testPx = 30;
            const plus = bridgeOffsetLatLngByPixels(along, perp.x * testPx, perp.y * testPx);
            const minus = bridgeOffsetLatLngByPixels(along, -perp.x * testPx, -perp.y * testPx);
            const plusScore = ((plus.lat - along.lat) * compass.lat) + ((plus.lng - along.lng) * compass.lng);
            const minusScore = ((minus.lat - along.lat) * compass.lat) + ((minus.lng - along.lng) * compass.lng);

            if (Math.abs(plusScore - minusScore) < 1e-12) return 1;
            return plusScore > minusScore ? 1 : -1;
        }

        function bridgePhotoSchematicT(photo, group, abutmentParts) {
            const role = normalizeBridgeRole(photo.role);
            const part = bridgeFeatureInfoById.get(photo.partId);

            if (isBridgeSpanPhotoRole(role)) {
                return 0.5;
            }

            if (role === 'pillar') {
                return part && group.bridgeAxis
                    ? projectOnBridgeAxis(group.bridgeAxis, part.center)
                    : 0.5;
            }

            if (role === 'abutment') {
                let t = part && group.bridgeAxis
                    ? projectOnBridgeAxis(group.bridgeAxis, part.center)
                    : 0.08;
                if (abutmentParts.length) {
                    const nearest = abutmentParts.reduce((best, item) => {
                        const distance = Math.abs(item.t - t);
                        return distance < best.distance ? { distance, t: item.t } : best;
                    }, { distance: Infinity, t });
                    if (nearest.distance < 0.2) t = nearest.t;
                }
                return t;
            }

            return part && group.bridgeAxis
                ? projectOnBridgeAxis(group.bridgeAxis, part.center)
                : 0.5;
        }

        function buildBridgePhotoLayout(group) {
            const layout = new Map();
            if (!group?.bridgeAxis) return layout;

            const abutmentParts = group.features
                .filter(info => info.role === 'abutment')
                .map(info => ({ info, t: projectOnBridgeAxis(group.bridgeAxis, info.center) }))
                .sort((a, b) => a.t - b.t);
            const fallbackAbutmentT = (index, total) => (
                total <= 1 ? 0.08 : (index / Math.max(total - 1, 1)) * 0.84 + 0.08
            );

            const slotBuckets = new Map();
            group.photos.forEach(photo => {
                const part = bridgeFeatureInfoById.get(photo.partId);
                let t = bridgePhotoSchematicT(photo, group, abutmentParts);
                if (photo.role === 'abutment' && !part) {
                    const abutmentIndex = group.photos
                        .filter(item => item.role === 'abutment')
                        .findIndex(item => item.key === photo.key);
                    const totalAbutments = group.photos.filter(item => item.role === 'abutment').length;
                    t = fallbackAbutmentT(abutmentIndex, totalAbutments);
                }

                const role = normalizeBridgeRole(photo.role);
                const slotKey = isBridgeSpanPhotoRole(role)
                    ? 'span:center'
                    : `${role}:${photo.partId || 'generic'}:${Math.round(t * 100)}`;
                if (!slotBuckets.has(slotKey)) slotBuckets.set(slotKey, []);
                slotBuckets.get(slotKey).push({ photo, t });
            });

            slotBuckets.forEach(items => {
                items.sort((a, b) => a.photo.key.localeCompare(b.photo.key, 'fr'));

                const directed = [];
                const undirected = [];
                items.forEach(item => {
                    if (item.photo.context?.direction) directed.push(item);
                    else undirected.push(item);
                });

                const ringBySide = new Map();
                directed.forEach(item => {
                    const along = bridgeAxisPointAt(group.bridgeAxis, item.t);
                    const side = bridgePhotoSideForDirection(
                        group.bridgeAxis,
                        along,
                        item.photo.context.direction
                    );
                    if (side === null) {
                        undirected.push(item);
                        return;
                    }
                    const ring = ringBySide.get(side) || 0;
                    ringBySide.set(side, ring + 1);
                    layout.set(item.photo.key, { t: item.t, side, ring });
                });

                undirected.forEach((item, index) => {
                    let side = index % 2 === 0 ? 1 : -1;
                    if (ringBySide.has(side)) side = -side;
                    const ring = ringBySide.get(side) || 0;
                    ringBySide.set(side, ring + 1);
                    layout.set(item.photo.key, { t: item.t, side, ring });
                });
            });

            return layout;
        }

        function enrichBridgeGroupLayouts(groups) {
            groups.forEach(group => {
                group.bridgeAxis = computeBridgeAxis(group);
                group.photoLayout = buildBridgePhotoLayout(group);
            });
        }

        function bridgeGeometryWeightBoost(photoCount) {
            return Math.min(5, Math.floor(Math.sqrt(Math.max(photoCount, 0)) * 1.4));
        }

        function buildBridgeGroups(features) {
            const infos = (features || [])
                .map(bridgeFeatureInfo)
                .filter(Boolean);
            const mainInfos = infos.filter(info => info.isMainBridge);
            const groupsById = new Map();

            bridgeFeatureInfoById = new Map();
            infos.forEach(info => bridgeFeatureInfoById.set(info.id, info));

            function ensureGroup(anchorInfo) {
                const groupId = anchorInfo.id;
                if (!groupsById.has(groupId)) {
                    groupsById.set(groupId, {
                        id: groupId,
                        title: bridgeGroupTitle(anchorInfo),
                        anchorInfo,
                        features: [],
                        photos: [],
                        photoKeys: new Set(),
                        bounds: anchorInfo.bounds,
                        hasMainBridge: anchorInfo.isMainBridge
                    });
                }
                return groupsById.get(groupId);
            }

            infos.forEach(info => {
                const mainInfo = info.isMainBridge ? info : nearestMainBridge(info, mainInfos);
                const group = ensureGroup(mainInfo || info);
                info.groupId = group.id;
                group.features.push(info);
                group.hasMainBridge = group.hasMainBridge || info.isMainBridge;
                group.bounds.extend(info.bounds);
            });

            infos.forEach(info => {
                const group = groupsById.get(info.groupId);
                if (!group) return;
                collectBridgePhotos(info).forEach(photo => {
                    photo.groupId = group.id;
                    if (group.photoKeys.has(photo.key)) return;
                    group.photoKeys.add(photo.key);
                    group.photos.push(photo);
                    info.photos.push(photo);
                });
            });

            const groups = [...groupsById.values()]
                .filter(group => group.hasMainBridge);
            const acceptedFeatureIds = new Set(
                groups.flatMap(group => group.features.map(info => info.id))
            );
            bridgeFeatureInfoById = new Map(
                infos
                    .filter(info => acceptedFeatureIds.has(info.id))
                    .map(info => [info.id, info])
            );

            return groups.sort((a, b) => {
                if (b.photos.length !== a.photos.length) return b.photos.length - a.photos.length;
                return a.title.localeCompare(b.title, 'fr');
            });
        }

        function bridgeFeatureStyle(feature, selected = false) {
            const role = bridgeRoleFromTags(feature.properties || {});
            const style = bridgeRoleStyle(role);
            const isPolygon = /Polygon$/.test(feature.geometry?.type || '');
            const featureId = feature.id || feature.properties?.['@id'];
            const info = bridgeFeatureInfoById.get(featureId);
            const group = info ? bridgeGroupById.get(info.groupId) : null;
            const photoBoost = group ? bridgeGeometryWeightBoost(group.photos.length) : 0;
            const baseWeight = style.weight + photoBoost;

            return {
                color: selected ? '#111827' : style.color,
                weight: selected ? Math.max(baseWeight + 2, 5) : baseWeight,
                opacity: selected ? 1 : 0.9,
                fillColor: style.color,
                fillOpacity: isPolygon ? (selected ? 0.32 : style.fillOpacity) : 0,
                dashArray: selected ? '' : (style.dashArray || ''),
                interactive: true
            };
        }

        // ─────────────────────────────────────────────────────────────────
        // Services photo de rue (Panoramax / Mapillary) — centralisés.
        // Un seul endroit pour construire les URLs d'images, de visionneuses
        // et les libellés, utilisé aussi bien par les ponts que par les aires.
        // ─────────────────────────────────────────────────────────────────
        const StreetPhoto = {
            label(provider) {
                return provider === 'panoramax' ? 'Panoramax' : 'Mapillary';
            },
            panoramax: {
                // Image directe (fiable partout dans le projet).
                imageUrl(id, size = 'sd') {
                    return `https://api.panoramax.xyz/api/pictures/${encodeURIComponent(id)}/${size}.jpg`;
                },
                // Permalien de visionneuse = format exact copié par le widget
                // « Partager » du viewer Panoramax : ${origin}/#focus=pic&pic=<id>
                // (hash, pas query). `base` = instance d'origine (lien `via`).
                pageUrl(id, seq, base) {
                    const host = (base || 'https://panoramax.openstreetmap.fr').replace(/\/+$/, '');
                    let url = `${host}/#focus=pic&pic=${encodeURIComponent(id)}`;
                    if (seq) url += `&seq=${encodeURIComponent(seq)}`;
                    return url;
                }
            },
            mapillary: {
                pageUrl(id) {
                    return `https://www.mapillary.com/app/?pKey=${encodeURIComponent(id)}`;
                },
                embedUrl(id) {
                    return `https://www.mapillary.com/embed?image_key=${encodeURIComponent(id)}&style=photo`;
                }
            },
            externalUrl(provider, id, seq, base) {
                return provider === 'panoramax'
                    ? this.panoramax.pageUrl(id, seq, base)
                    : this.mapillary.pageUrl(id);
            }
        };

        // Wrappers rétro-compatibles (les appelants existants restent inchangés).
        function providerLabel(provider) { return StreetPhoto.label(provider); }
        function panoramaxImageUrl(id, size) { return StreetPhoto.panoramax.imageUrl(id, size); }
        function panoramaxPageUrl(id, seq, base) { return StreetPhoto.panoramax.pageUrl(id, seq, base); }
        function mapillaryPageUrl(id) { return StreetPhoto.mapillary.pageUrl(id); }
        function mapillaryEmbedUrl(id) { return StreetPhoto.mapillary.embedUrl(id); }

        function bridgePhotoExternalUrl(photo) {
            return StreetPhoto.externalUrl(photo.provider, photo.id);
        }

        function bridgePhotoMetaLabel(photo) {
            const bits = [
                providerLabel(photo.provider),
                photo.roleLabel,
                photo.context?.directionLabel ? `côté ${photo.context.directionLabel}` : '',
                photo.context?.year || '',
                photo.context?.detail ? 'détail' : ''
            ].filter(Boolean);
            return bits.join(' · ');
        }

        function bridgePhotoMarkerLatLng(photo, group) {
            const axis = group?.bridgeAxis;
            if (!axis || !window.map) return photo.center;

            const layout = group.photoLayout?.get(photo.key) || {
                t: defaultBridgePhotoAxisT(photo, group),
                side: 1,
                ring: 0
            };
            const along = bridgeAxisPointAt(axis, layout.t);
            const perp = bridgePerpendicularUnitVector(axis);
            const perpX = perp?.x ?? 0;
            const perpY = perp?.y ?? 0;
            const offset = BRIDGE_PHOTO_OUTSIDE_BASE_PX + (layout.ring * BRIDGE_PHOTO_OUTSIDE_RING_PX);
            return bridgeOffsetLatLngByPixels(
                along,
                perpX * layout.side * offset,
                perpY * layout.side * offset
            );
        }
        // Reachable from the bridge photo layer sync, which lives outside DOMContentLoaded.
        window.bridgePhotoMarkerLatLng = bridgePhotoMarkerLatLng;

        function buildBridgePhotoPopup(photo, group) {
            const preview = photo.provider === 'panoramax'
                ? `<img class="bridge-photo-popup-img" src="${panoramaxImageUrl(photo.id, 'thumb')}" alt="" loading="lazy">`
                : `<div class="bridge-photo-popup-placeholder">Mapillary</div>`;

            return `
                <div class="route-popup bridge-popup">
                    <h3>${escapeHtml(providerLabel(photo.provider))}</h3>
                    ${preview}
                    <div class="detail"><strong>Pont&nbsp;:</strong> ${escapeHtml(group.title)}</div>
                    <div class="detail"><strong>Élément&nbsp;:</strong> <span class="bridge-part-pill" style="--bridge-part-color:${photo.color};">${escapeHtml(photo.partLabel)}</span></div>
                    ${photo.context?.directionLabel ? `<div class="detail"><strong>Orientation&nbsp;:</strong> ${escapeHtml(photo.context.directionLabel)}</div>` : ''}
                    ${photo.context?.year ? `<div class="detail"><strong>Année taguée&nbsp;:</strong> ${escapeHtml(photo.context.year)}</div>` : ''}
                    <div class="detail" style="font-size:0.76rem;"><strong>Tag&nbsp;:</strong> ${escapeHtml(photo.tagKey)}=${escapeHtml(photo.id)}</div>
                    <div class="detail" style="margin-top: 10px;">
                        <a href="${bridgePhotoExternalUrl(photo)}" target="_blank" rel="noopener noreferrer" style="color: #3498DB; font-weight: 600; text-decoration: none;">Ouvrir la photo source →</a>
                    </div>
                </div>
            `;
        }

        function makeBridgePhotoMarker(photo, group) {
            const latlng = bridgePhotoMarkerLatLng(photo, group);
            const providerClass = photo.provider === 'panoramax' ? 'is-panoramax' : 'is-mapillary';
            const marker = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'bridge-photo-marker-wrapper',
                    html: `<div class="bridge-photo-marker ${providerClass}" style="--bridge-part-color:${photo.color};"><span>${photo.provider === 'panoramax' ? 'P' : 'M'}</span></div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                }),
                zIndexOffset: 650
            });

            marker.bindTooltip(bridgePhotoMetaLabel(photo), { direction: 'top', offset: [0, -10] });
            marker.bindPopup(buildBridgePhotoPopup(photo, group));
            marker.on('click', () => {
                openBridgeViewer(group.id, { photoKey: photo.key, fit: true });
            });

            return marker;
        }

        function setBridgeLegendCounts(groups) {
            const summary = {
                total: groups.filter(group => group.hasMainBridge).length,
                panoramax: 0,
                mapillary: 0,
                pillar: 0,
                abutment: 0
            };

            groups.forEach(group => {
                group.photos.forEach(photo => {
                    if (photo.provider === 'panoramax') summary.panoramax++;
                    if (photo.provider === 'mapillary') summary.mapillary++;
                });
                group.features.forEach(info => {
                    if (info.role === 'pillar') summary.pillar++;
                    if (info.role === 'abutment') summary.abutment++;
                });
            });

            const mapping = {
                'count-bridges-total': summary.total,
                'count-bridges-panoramax': summary.panoramax,
                'count-bridges-mapillary': summary.mapillary,
                'count-bridges-pillar': summary.pillar,
                'count-bridges-abutment': summary.abutment
            };
            Object.entries(mapping).forEach(([elementId, value]) => {
                const element = document.getElementById(elementId);
                if (element) element.textContent = Number(value || 0).toLocaleString('fr-FR');
            });
        }

        function resetBridgeFeatureHighlight() {
            bridgeFeatureLayersById.forEach((layer, featureId) => {
                const info = bridgeFeatureInfoById.get(featureId);
                if (info && layer.setStyle) layer.setStyle(bridgeFeatureStyle(info.feature, false));
            });
            activeBridgeGroupId = null;
        }

        function highlightBridgeGroup(groupId) {
            resetBridgeFeatureHighlight();
            const group = bridgeGroupById.get(groupId);
            if (!group) return;

            group.features.forEach(info => {
                const layer = bridgeFeatureLayersById.get(info.id);
                if (!layer?.setStyle) return;
                layer.setStyle(bridgeFeatureStyle(info.feature, true));
                if (layer.bringToFront) layer.bringToFront();
            });
            activeBridgeGroupId = groupId;
        }

        function fitBridgeGroup(group) {
            if (!group?.bounds?.isValid()) return;
            window.map.fitBounds(group.bounds, {
                padding: [70, 70],
                maxZoom: 20,
                animate: true
            });
        }

        function bridgeViewerOsmLink(group) {
            const tags = group.anchorInfo?.tags || {};
            const osmType = tags.osm_type || String(group.anchorInfo?.id || group.id).split('/')[0];
            const osmId = tags.osm_id || String(group.anchorInfo?.id || group.id).split('/')[1];
            if (!osmType || !osmId) return '';
            return `https://www.openstreetmap.org/${osmType}/${osmId}`;
        }

        function buildBridgeViewerMetaChips(group) {
            const tags = group.anchorInfo?.tags || {};
            const chips = [];
            if (tags['bridge:structure']) chips.push({ label: 'Structure', value: tags['bridge:structure'] });
            if (tags.material) chips.push({ label: 'Matériau', value: tags.material });
            if (tags.length) chips.push({ label: 'Longueur', value: `${tags.length} m` });
            if (tags.ref) chips.push({ label: 'Réf.', value: tags.ref });
            if (tags.operator || tags.owner) chips.push({ label: 'Gestion', value: tags.operator || tags.owner });

            if (!chips.length) return '';

            return `
                <div class="bridge-viewer-meta">
                    ${chips.map(chip => `
                        <span class="bridge-viewer-meta-chip">
                            <strong>${escapeHtml(chip.label)}</strong>
                            ${escapeHtml(String(chip.value))}
                        </span>
                    `).join('')}
                </div>
            `;
        }

        function buildBridgeViewerStats(group) {
            const pillarCount = group.features.filter(info => info.role === 'pillar').length;
            const abutmentCount = group.features.filter(info => info.role === 'abutment').length;
            const panoramaxCount = group.photos.filter(photo => photo.provider === 'panoramax').length;
            const mapillaryCount = group.photos.filter(photo => photo.provider === 'mapillary').length;

            const stats = [
                ['Photos', group.photos.length],
                ['Éléments', group.features.length],
                ['Piles', pillarCount],
                ['Culées', abutmentCount]
            ].filter(([, value]) => value > 0);

            if (!stats.length) return '';

            return `
                <div class="bridge-viewer-stats">
                    ${stats.map(([label, value]) => `
                        <span class="bridge-viewer-stat">
                            <strong>${value}</strong>
                            <span>${label.toLowerCase()}</span>
                        </span>
                    `).join('')}
                    ${panoramaxCount ? `<span class="bridge-viewer-stat"><strong>${panoramaxCount}</strong><span>panoramax</span></span>` : ''}
                    ${mapillaryCount ? `<span class="bridge-viewer-stat"><strong>${mapillaryCount}</strong><span>mapillary</span></span>` : ''}
                </div>
            `;
        }

        function buildBridgePhotoGrid(group, selectedPhotoKey) {
            if (group.photos.length <= 1) return '';

            return `
                <section class="bridge-viewer-section bridge-viewer-section--gallery">
                    <h3 class="bridge-viewer-section-title">Galerie · ${group.photos.length} clichés</h3>
                    <div class="bridge-photo-grid">
                        ${group.photos.map(photo => `
                            <button
                                type="button"
                                class="bridge-photo-card${selectedPhotoKey === photo.key ? ' is-active' : ''}"
                                data-bridge-photo-key="${escapeHtml(photo.key)}"
                            >
                                ${photo.provider === 'panoramax'
                                    ? `<img src="${panoramaxImageUrl(photo.id, 'thumb')}" alt="" loading="lazy">`
                                    : `<span class="bridge-photo-card-placeholder">Mapillary</span>`}
                                <span class="bridge-photo-card-meta">
                                    <span class="bridge-photo-card-source">${escapeHtml(providerLabel(photo.provider))}</span>
                                    <span class="bridge-photo-card-part">${escapeHtml(photo.partLabel)}</span>
                                </span>
                            </button>
                        `).join('')}
                    </div>
                </section>
            `;
        }

        function buildBridgeViewerHero(photo) {
            if (!photo) {
                return '<div class="bridge-viewer-empty">Aucune photo Panoramax ou Mapillary n\'est taguée sur cet ouvrage.</div>';
            }

            const badgeClass = photo.provider === 'panoramax'
                ? 'bridge-viewer-hero-badge--panoramax'
                : 'bridge-viewer-hero-badge--mapillary';

            if (photo.provider === 'panoramax') {
                return `
                    <div class="bridge-viewer-hero-inner">
                        <a class="bridge-viewer-hero-link" href="${panoramaxPageUrl(photo.id)}" target="_blank" rel="noopener noreferrer">
                            <img class="bridge-viewer-hero-img" src="${panoramaxImageUrl(photo.id, 'sd')}" alt="${escapeHtml(bridgePhotoMetaLabel(photo))}" loading="lazy">
                        </a>
                        <span class="bridge-viewer-hero-badge ${badgeClass}">Panoramax</span>
                    </div>
                `;
            }

            return `
                <div class="bridge-viewer-hero-inner">
                    <iframe class="bridge-viewer-hero-frame" src="${mapillaryEmbedUrl(photo.id)}" title="${escapeHtml(bridgePhotoMetaLabel(photo))}" allowfullscreen loading="lazy"></iframe>
                    <span class="bridge-viewer-hero-badge ${badgeClass}">Mapillary</span>
                </div>
            `;
        }

        function buildBridgeSchematicPhotoButton(photo, group, selectedPhotoKey, vertical) {
            const layout = group.photoLayout?.get(photo.key) || {
                t: defaultBridgePhotoAxisT(photo, group),
                side: 1,
                ring: 0
            };
            const left = `${6 + (layout.t * 88)}%`;
            const offset = 4 + (layout.ring * 10);
            const style = vertical === 'top'
                ? `left:${left}; top:${offset}%;`
                : `left:${left}; bottom:${offset}%;`;
            const isActive = selectedPhotoKey === photo.key;

            return `
                <button
                    type="button"
                    class="bridge-schematic-photo${isActive ? ' is-active' : ''}"
                    data-bridge-photo-key="${escapeHtml(photo.key)}"
                    style="${style} --bridge-part-color:${photo.color};"
                    title="${escapeHtml(bridgePhotoMetaLabel(photo))}"
                >
                    ${photo.provider === 'panoramax'
                        ? `<img src="${panoramaxImageUrl(photo.id, 'thumb')}" alt="" loading="lazy">`
                        : `<span class="bridge-schematic-photo-placeholder">${photo.provider === 'panoramax' ? 'P' : 'M'}</span>`}
                    <span class="bridge-schematic-photo-label">${escapeHtml(photo.partLabel)}</span>
                </button>
            `;
        }

        function buildBridgeSchematicStructure(group) {
            const axis = group.bridgeAxis;
            const abutments = group.features.filter(info => info.role === 'abutment');
            const pillars = group.features
                .filter(info => info.role === 'pillar')
                .map(info => ({
                    info,
                    t: axis ? projectOnBridgeAxis(axis, info.center) : 0.5
                }))
                .sort((a, b) => a.t - b.t);

            const abutmentStart = abutments.length && axis
                ? abutments.reduce((best, info) => (
                    !best || projectOnBridgeAxis(axis, info.center) < projectOnBridgeAxis(axis, best.center) ? info : best
                ), null)
                : null;
            const abutmentEnd = abutments.length && axis
                ? abutments.reduce((best, info) => (
                    !best || projectOnBridgeAxis(axis, info.center) > projectOnBridgeAxis(axis, best.center) ? info : best
                ), null)
                : null;

            const pillarMarkup = pillars.map(({ t }) => `
                <div class="bridge-schematic-pillar" style="left:${6 + (t * 88)}%;" aria-hidden="true"></div>
            `).join('');

            return `
                <div class="bridge-schematic-structure">
                    <div class="bridge-schematic-abutment bridge-schematic-abutment--start" style="--bridge-part-color:${abutmentStart?.color || '#E67E22'};">
                        <span>Culée</span>
                    </div>
                    <div class="bridge-schematic-deck">
                        ${pillarMarkup}
                        <span class="bridge-schematic-deck-label">Tablier</span>
                    </div>
                    <div class="bridge-schematic-abutment bridge-schematic-abutment--end" style="--bridge-part-color:${abutmentEnd?.color || '#E67E22'};">
                        <span>Culée</span>
                    </div>
                </div>
            `;
        }

        function bindBridgeViewerPhotoSelectors(content, group) {
            content.querySelectorAll('[data-bridge-photo-key]').forEach(button => {
                button.addEventListener('click', () => {
                    renderBridgeViewer(group, button.dataset.bridgePhotoKey);
                });
            });
        }

        function renderBridgeViewer(group, selectedPhotoKey) {
            const panel = document.getElementById('bridgeViewerPanel');
            const title = document.getElementById('bridgeViewerTitle');
            const subtitle = document.getElementById('bridgeViewerSubtitle');
            const content = document.getElementById('bridgeViewerContent');
            if (!panel || !title || !subtitle || !content) return;

            const selectedPhoto = group.photos.find(photo => photo.key === selectedPhotoKey) || group.photos[0] || null;
            const roleBadges = group.features
                .map(info => info.role)
                .filter((role, index, roles) => roles.indexOf(role) === index)
                .map(role => bridgeRoleStyle(role))
                .map(style => `<span class="bridge-part-pill" style="--bridge-part-color:${style.color};">${escapeHtml(style.label)}</span>`)
                .join('');

            const osmLink = bridgeViewerOsmLink(group);
            const subtitleBits = [
                `${group.photos.length} photo${group.photos.length > 1 ? 's' : ''}`,
                `${group.features.length} élément${group.features.length > 1 ? 's' : ''} OSM`
            ];
            if (group.anchorInfo?.tags?.['bridge:structure']) {
                subtitleBits.push(String(group.anchorInfo.tags['bridge:structure']).replace(/_/g, ' '));
            }

            title.textContent = group.title;
            subtitle.textContent = subtitleBits.join(' · ');

            const topPhotos = [];
            const bottomPhotos = [];
            group.photos.forEach(photo => {
                const side = group.photoLayout?.get(photo.key)?.side ?? 1;
                if (side > 0) topPhotos.push(photo);
                else bottomPhotos.push(photo);
            });

            const schematicTop = topPhotos
                .map(photo => buildBridgeSchematicPhotoButton(photo, group, selectedPhoto?.key, 'top'))
                .join('');
            const schematicBottom = bottomPhotos
                .map(photo => buildBridgeSchematicPhotoButton(photo, group, selectedPhoto?.key, 'bottom'))
                .join('');

            content.innerHTML = `
                ${buildBridgeViewerStats(group)}
                ${buildBridgeViewerMetaChips(group)}
                <section class="bridge-viewer-section bridge-viewer-section--schematic">
                    <h3 class="bridge-viewer-section-title">Vue schématique</h3>
                    <div class="bridge-schematic">
                        <div class="bridge-schematic-stage">
                            <div class="bridge-schematic-photos bridge-schematic-photos--top">${schematicTop}</div>
                            ${buildBridgeSchematicStructure(group)}
                            <div class="bridge-schematic-photos bridge-schematic-photos--bottom">${schematicBottom}</div>
                        </div>
                    </div>
                </section>
                <section class="bridge-viewer-section bridge-viewer-section--hero">
                    <h3 class="bridge-viewer-section-title">Photo sélectionnée</h3>
                    <div class="bridge-viewer-hero">
                        ${buildBridgeViewerHero(selectedPhoto)}
                    </div>
                    ${selectedPhoto ? `
                        <div class="bridge-viewer-selected">
                            <span class="bridge-part-pill" style="--bridge-part-color:${selectedPhoto.color};">${escapeHtml(selectedPhoto.partLabel)}</span>
                            <span class="bridge-viewer-selected-meta">${escapeHtml(bridgePhotoMetaLabel(selectedPhoto))}</span>
                            <a href="${bridgePhotoExternalUrl(selectedPhoto)}" target="_blank" rel="noopener noreferrer">Ouvrir la source</a>
                        </div>
                    ` : ''}
                </section>
                ${roleBadges ? `
                    <section class="bridge-viewer-section bridge-viewer-section--parts">
                        <h3 class="bridge-viewer-section-title">Composition OSM</h3>
                        <div class="bridge-viewer-parts">${roleBadges}</div>
                    </section>
                ` : ''}
                ${buildBridgePhotoGrid(group, selectedPhoto?.key)}
                ${osmLink ? `
                    <a class="bridge-viewer-osm-link" href="${osmLink}" target="_blank" rel="noopener noreferrer">Voir sur OpenStreetMap →</a>
                ` : ''}
            `;

            bindBridgeViewerPhotoSelectors(content, group);
            panel.classList.add('active');
        }

        // Construit un payload normalisé (découplé des internes) pour la vue 3D.
        function buildBridge3DPayload(group, focusPhotoKey) {
            const tags = group.anchorInfo?.tags || {};
            const pillarCount = group.features.filter(info => info.role === 'pillar').length;
            const widthM = parseFloat(tags.width);
            const lengthM = parseFloat(tags.length);
            const axis = group.bridgeAxis;
            const axisLengthM = (axis && axis.length) || (Number.isFinite(lengthM) ? lengthM : 0);

            // Repère géographique du pont : centre + cap de l'axe (start -> end).
            let centerLat = null, centerLng = null, axisBearingDeg = 0;
            if (axis && axis.center && axis.start && axis.end) {
                centerLat = axis.center.lat;
                centerLng = axis.center.lng;
                const latRad = centerLat * Math.PI / 180;
                const east = (axis.end.lng - axis.start.lng) * Math.cos(latRad) * 111320;
                const north = (axis.end.lat - axis.start.lat) * 111320;
                axisBearingDeg = Math.atan2(east, north) * 180 / Math.PI;
            }

            const metaChips = [];
            if (tags['bridge:structure']) metaChips.push({ label: 'Structure', value: tags['bridge:structure'] });
            if (tags.material) metaChips.push({ label: 'Matériau', value: tags.material });
            if (tags.length) metaChips.push({ label: 'Longueur', value: `${tags.length} m` });
            if (tags.ref) metaChips.push({ label: 'Réf.', value: tags.ref });
            if (tags.operator || tags.owner) metaChips.push({ label: 'Gestion', value: tags.operator || tags.owner });

            const subtitleBits = [];
            if (tags['bridge:structure']) subtitleBits.push(tags['bridge:structure']);
            if (tags.material) subtitleBits.push(tags.material);
            if (group.photos.length) subtitleBits.push(`${group.photos.length} photo${group.photos.length > 1 ? 's' : ''}`);

            // Position de repli (si la géoloc réelle de la photo est indisponible),
            // dérivée de la disposition OSM : conserve seulement t (le long de l'axe)
            // et side (+/- perpendiculaire), sans notion explicite pile/culée.
            const photos = group.photos.map(photo => {
                const layout = (group.photoLayout && group.photoLayout.get(photo.key)) || {};
                const roleStyle = bridgeRoleStyle(photo.role);
                return {
                    key: photo.key,
                    provider: photo.provider,
                    id: photo.id,
                    providerLabel: providerLabel(photo.provider),
                    roleLabel: photo.partLabel || roleStyle.label,
                    roleColor: roleStyle.color,
                    sourceUrl: bridgePhotoExternalUrl(photo),
                    textureUrl: photo.provider === 'panoramax' ? panoramaxImageUrl(photo.id, 'sd') : null,
                    thumbUrl: photo.provider === 'panoramax' ? panoramaxImageUrl(photo.id, 'thumb') : null,
                    fallbackT: typeof layout.t === 'number' ? layout.t : 0.5,
                    fallbackSide: typeof layout.side === 'number' ? layout.side : 1
                };
            });

            const wikidataId = (tags.wikidata && /^Q\d+$/.test(tags.wikidata.trim())) ? tags.wikidata.trim() : null;

            // Indice du nombre d'arches déduit du nom (ex. "pont des 13 arches").
            let spanCountHint = null;
            const archMatch = String(group.title || '').match(/(\d{1,3})\s*arch/i);
            if (archMatch) spanCountHint = parseInt(archMatch[1], 10);

            return {
                id: group.id,
                title: group.title,
                subtitle: subtitleBits.join(' · '),
                axisLengthM,
                centerLat,
                centerLng,
                axisBearingDeg,
                structure: tags['bridge:structure'] || '',
                bridgeTag: tags.bridge || '',
                material: tags.material || '',
                widthM: Number.isFinite(widthM) ? widthM : null,
                pillarCount,
                spanCountHint,
                wikidataId,
                metaChips,
                osmUrl: bridgeViewerOsmLink(group),
                photos,
                focusPhotoKey: focusPhotoKey || null
            };
        }

        function openBridgeViewer(groupId, options = {}) {
            const group = bridgeGroupById.get(groupId);
            if (!group) return;

            if (!bridgeVisible) {
                bridgeVisible = true;
                syncBridgeLayersOnMap();
            }

            highlightBridgeGroup(group.id);

            if (window.BridgeViewer3D && typeof window.BridgeViewer3D.open === 'function') {
                window.BridgeViewer3D.open(buildBridge3DPayload(group, options.photoKey));
            } else {
                // Repli ultime si le module 3D n'a pas chargé : ancien panneau 2D.
                renderBridgeViewer(group, options.photoKey);
            }
        }

        window.openBridgeViewer = openBridgeViewer;

        window.closeBridgeViewer = function(options = {}) {
            if (window.BridgeViewer3D && typeof window.BridgeViewer3D.close === 'function') {
                window.BridgeViewer3D.close();
            }
            const panel = document.getElementById('bridgeViewerPanel');
            if (panel) panel.classList.remove('active');
            if (!options.keepHighlight) resetBridgeFeatureHighlight();
        };

        function createBridgeLayers(data) {
            bridgeFeatureLayersById = new Map();
            const acceptedFeatureIds = new Set(bridgeFeatureInfoById.keys());
            const filteredData = {
                ...data,
                features: (data.features || []).filter(feature => (
                    acceptedFeatureIds.has(feature.id || feature.properties?.['@id'])
                ))
            };

            bridgeGeometryLayerGroup = L.geoJSON(filteredData, {
                style: feature => bridgeFeatureStyle(feature, false),
                onEachFeature: (feature, layer) => {
                    const featureId = feature.id || feature.properties?.['@id'];
                    const info = bridgeFeatureInfoById.get(featureId);
                    if (!info) return;
                    const group = bridgeGroupById.get(info.groupId);
                    if (!group) return;

                    bridgeFeatureLayersById.set(info.id, layer);
                    layer.on('click', () => openBridgeViewer(group.id, { fit: true }));
                    layer.on('mouseover', () => {
                        if (activeBridgeGroupId !== group.id && layer.setStyle) {
                            layer.setStyle(bridgeFeatureStyle(feature, true));
                        }
                    });
                    layer.on('mouseout', () => {
                        if (activeBridgeGroupId !== group.id && layer.setStyle) {
                            layer.setStyle(bridgeFeatureStyle(feature, false));
                        }
                    });
                }
            });

            enrichBridgeGroupLayouts(bridgeGroups);

            bridgeGroupMarkerLayerGroup = L.layerGroup();

            bridgePhotoLayerGroup = L.layerGroup();
            bridgePhotoMarkers = [];
            bridgeGroups.forEach(group => {
                group.photos.forEach(photo => {
                    bridgePhotoMarkers.push({
                        photo,
                        group,
                        marker: makeBridgePhotoMarker(photo, group)
                    });
                });
            });
        }

        window.loadBridges = async function(options = {}) {
            const show = options.show === true;
            if (bridgeDataLoaded) {
                if (show) bridgeVisible = true;
                syncBridgeLayersOnMap();
                if (show) fitBridgeOverviewIfNeeded();
                return bridgeGroups;
            }

            if (bridgeLoadPromise) {
                await bridgeLoadPromise;
                if (show) bridgeVisible = true;
                syncBridgeLayersOnMap();
                if (show) fitBridgeOverviewIfNeeded();
                return bridgeGroups;
            }

            bridgeLoadPromise = (async () => {
                try {
                    const data = await window.InforouteApi.fetchGeoJson('bridges');
                    renderFreshnessBadge(document.getElementById('freshness-bridges'), {
                        generatedAt: data._cache?.generated_at,
                        scheduleKey: 'incubator'
                    });

                    bridgeGroups = buildBridgeGroups(data.features || []);
                    bridgeGroupById = new Map(bridgeGroups.map(group => [group.id, group]));
                    createBridgeLayers(data);
                    setBridgeLegendCounts(bridgeGroups);
                    bridgeDataLoaded = true;

                    if (show) bridgeVisible = true;
                    syncBridgeLayersOnMap();
                    if (show) fitBridgeOverviewIfNeeded();
                    console.log(`✓ ${bridgeGroups.length} groupe(s) de ponts chargés`);
                    tryApplyAppUrlState();
                    return bridgeGroups;
                } catch (error) {
                    console.error('Erreur chargement ponts:', error);
                    setBridgeLegendCounts([]);
                    renderFreshnessBadge(document.getElementById('freshness-bridges'), {
                        scheduleKey: 'incubator',
                        errorMsg: error.message
                    });
                    applyBridgesHiddenUi();
                    syncLegendChrome();
                    return [];
                } finally {
                    bridgeLoadPromise = null;
                }
            })();

            return bridgeLoadPromise;
        };

        // Load routes after a short delay so the map can initialize
        setTimeout(loadDepartmentalRoads, 1000);

        // ========== WEATHER ==========

        const WEATHER_ICONS = {
            0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
            51: '🌦️', 53: '🌦️', 55: '🌧️', 61: '🌧️', 63: '🌧️', 65: '🌧️',
            71: '🌨️', 73: '🌨️', 75: '🌨️', 77: '🌨️', 80: '🌧️', 81: '🌧️',
            82: '🌧️', 85: '🌨️', 86: '🌨️', 95: '⛈️', 96: '⛈️', 99: '⛈️'
        };

        const WEATHER_DESCRIPTIONS = {
            0: 'Ciel dégagé', 1: 'Dégagé', 2: 'Nuageux', 3: 'Couvert',
            45: 'Brouillard', 48: 'Brouillard', 51: 'Bruine', 53: 'Bruine', 55: 'Bruine',
            61: 'Pluie légère', 63: 'Pluie', 65: 'Forte pluie', 71: 'Neige légère',
            73: 'Neige', 75: 'Forte neige', 77: 'Grésil', 80: 'Averses', 81: 'Averses',
            82: 'Fortes averses', 85: 'Averses de neige', 86: 'Averses de neige',
            95: 'Orage', 96: 'Orage', 99: 'Orage violent'
        };

        function formatWeatherTime(value) {
            const match = String(value || '').match(/T(\d{2}:\d{2})/);
            return match ? match[1] : null;
        }

        function getWeatherIcon(code) {
            return WEATHER_ICONS[code] || '🌡️';
        }

        function getWeatherDescription(code) {
            return WEATHER_DESCRIPTIONS[code] || 'Variable';
        }

        function buildWeatherApiUrl(lat, lon) {
            return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=Europe/Paris`;
        }

        async function fetchStationWeather(station) {
            const source = window.InforouteApi.getLiveSource('weather');
            const data = await window.InforouteApi.fetchJson(
                buildWeatherApiUrl(station.lat, station.lon),
                { cache: 'no-store' },
                { timeoutMs: source.timeoutMs || 10000 }
            );
            if (!data.current) throw new Error(`Météo ${station.name}: données indisponibles`);
            return data;
        }

        function renderWeatherStationPopup(station, current) {
            const temp = Math.round(current.temperature_2m);
            const desc = getWeatherDescription(current.weather_code);
            const icon = getWeatherIcon(current.weather_code);
            const updatedAt = formatWeatherTime(current.time);
            const wind = current.wind_speed_10m != null ? `${Math.round(current.wind_speed_10m)} km/h` : '—';
            const humidity = current.relative_humidity_2m != null ? `${Math.round(current.relative_humidity_2m)} %` : '—';

            return `
                <div class="weather-station-popup">
                    <h4>${icon} ${station.name}</h4>
                    <dl>
                        <dt>Température</dt><dd>${temp} °C · ${desc}</dd>
                        <dt>Vent</dt><dd>${wind}</dd>
                        <dt>Humidité</dt><dd>${humidity}</dd>
                        ${updatedAt ? `<dt>Mise à jour</dt><dd>${updatedAt}</dd>` : ''}
                    </dl>
                </div>
            `;
        }

        function updateHeaderWeatherFromCurrent(station, current) {
            const temp = Math.round(current.temperature_2m);
            const desc = getWeatherDescription(current.weather_code);
            const updatedAt = formatWeatherTime(current.time);
            const iconEl = document.getElementById('weatherIcon');
            const tempEl = document.getElementById('weatherTemp');
            const descEl = document.getElementById('weatherDesc');
            const stationEl = document.getElementById('weatherStation');
            if (iconEl) iconEl.textContent = getWeatherIcon(current.weather_code);
            if (tempEl) tempEl.textContent = `${temp}°C`;
            if (descEl) descEl.textContent = updatedAt ? `${desc} · ${updatedAt}` : desc;
            if (stationEl) stationEl.textContent = station.name;
        }

        function refreshWeatherStationMarkerUi(station) {
            const marker = weatherStationMarkers.find(entry => entry.station.id === station.id)?.marker;
            const data = weatherStationDataById.get(station.id);
            if (!marker || !data?.current) return;
            const temp = Math.round(data.current.temperature_2m);
            marker.setTooltipContent(`${station.name} · ${temp}°C`);
            marker.setPopupContent(renderWeatherStationPopup(station, data.current));
        }

        async function loadStationWeather(station, { updateHeader = false } = {}) {
            const data = await fetchStationWeather(station);
            weatherStationDataById.set(station.id, data);
            refreshWeatherStationMarkerUi(station);
            if (updateHeader) updateHeaderWeatherFromCurrent(station, data.current);
            const badge = document.getElementById('freshness-weather-stations');
            if (badge && typeof renderFreshnessBadge === 'function') {
                renderFreshnessBadge(badge, {
                    scheduleKey: 'live',
                    generatedAt: data.current.time
                });
            }
            return data;
        }

        async function loadHeaderWeather() {
            try {
                await loadStationWeather(headerWeatherStation, { updateHeader: true });
            } catch (error) {
                console.error('Erreur météo header:', error);
                const iconEl = document.getElementById('weatherIcon');
                const tempEl = document.getElementById('weatherTemp');
                const descEl = document.getElementById('weatherDesc');
                const stationEl = document.getElementById('weatherStation');
                if (iconEl) iconEl.textContent = '🌡️';
                if (tempEl) tempEl.textContent = '--°C';
                if (descEl) descEl.textContent = 'Non disponible';
                if (stationEl) stationEl.textContent = headerWeatherStation.name;
            }
        }

        async function refreshVisibleWeatherStations() {
            await Promise.all(
                WEATHER_STATIONS.map(station => loadStationWeather(station).catch(error => {
                    console.warn(`Météo ${station.name}:`, error.message);
                    return null;
                }))
            );
        }

        function syncWeatherStationMarkersOnMap() {
            weatherStationMarkers.forEach(({ marker }) => {
                const onMap = window.map.hasLayer(marker);
                if (weatherStationsVisible && !onMap) marker.addTo(window.map);
                if (!weatherStationsVisible && onMap) window.map.removeLayer(marker);
            });
        }

        function setWeatherStationsLegendCounts() {
            const countEl = document.getElementById('count-weather-stations');
            if (countEl) countEl.textContent = String(WEATHER_STATIONS.length);
        }

        window.toggleWeatherStations = function() {
            weatherStationsVisible = !weatherStationsVisible;

            const icon = document.getElementById('weatherStationsToggleIcon');
            const title = document.querySelector('.legend-section:has([id="weatherStationsToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-weather-station]');

            syncWeatherStationMarkersOnMap();

            if (weatherStationsVisible) {
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
                legendItems.forEach(item => { item.style.opacity = '1'; });
                refreshVisibleWeatherStations();
                console.log(`✓ ${WEATHER_STATIONS.length} stations météo affichées`);
            } else {
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                legendItems.forEach(item => { item.style.opacity = '0.5'; });
                console.log('✗ Stations météo masquées');
            }
            syncLegendChrome();
        };

        loadHeaderWeather();
        window.setInterval(
            () => {
                loadHeaderWeather();
                if (weatherStationsVisible) refreshVisibleWeatherStations();
            },
            window.InforouteApi.getLiveSource('weather').refreshMs || (10 * 60 * 1000)
        );

        // Normalise a road reference for matching (drop spaces, upper-case):
        // OSM "D 975" and CD84 "D975" must resolve to the same axis.
        function normalizeRouteRef(value) {
            return String(value ?? '').replace(/\s+/g, '').toUpperCase();
        }

        // Find the routePolylines key matching a counting station's road name
        // (issue #9). Returns null when the axis is not part of the OSM network.
        function findRoutePolylineKey(routeName) {
            const target = normalizeRouteRef(routeName);
            if (!target || !window.routePolylines) return null;
            if (window.routePolylines[routeName]) return routeName;
            return Object.keys(window.routePolylines)
                .find(key => normalizeRouteRef(key) === target) || null;
        }

        // Compact AADT label for a counting badge (issue #15): 22136 → "22k",
        // 5300 → "5,3k", 740 → "740".
        function formatTrafficShort(mja) {
            if (!Number.isFinite(mja) || mja <= 0) return '·';
            if (mja >= 10000) return Math.round(mja / 1000) + 'k';
            if (mja >= 1000) return (mja / 1000).toFixed(1).replace('.', ',') + 'k';
            return String(Math.round(mja));
        }

        // Build a divIcon badge showing the rounded AADT inside the station circle
        // (issue #15). Size stays proportional to the traffic threshold; the value
        // makes the magnitude readable regardless of colour.
        function makeTrafficDivIcon(mja, style, category) {
            const label = formatTrafficShort(mja);
            const diameter = style.size * 2 + 14; // high 38 / medium 34 / low 30 px
            const fontSize = Math.max(10, Math.round(diameter * 0.3));
            const html = `<span class="tcm tcm--${category}" style="width:${diameter}px;height:${diameter}px;`
                + `background:${style.fill};border-color:${style.stroke};font-size:${fontSize}px;">${label}</span>`;
            return L.divIcon({
                className: 'traffic-count-icon',
                html,
                iconSize: [diameter, diameter],
                iconAnchor: [diameter / 2, diameter / 2],
                popupAnchor: [0, -diameter / 2]
            });
        }

        // Build an inline SVG sparkline of the yearly AADT (MJA) history for a
        // counting station, plus a first→last trend indicator (issue #23).
        function buildTrafficHistoryChart(history) {
            const byYear = new Map();
            (history || []).forEach(h => {
                if (!Number.isFinite(h.year) || !Number.isFinite(h.mja)) return;
                const prev = byYear.get(h.year);
                // Keep the highest observation when a year has duplicates.
                if (prev === undefined || h.mja > prev) byYear.set(h.year, h.mja);
            });

            const points = [...byYear.entries()]
                .map(([year, mja]) => ({ year, mja }))
                .sort((a, b) => a.year - b.year);

            if (points.length === 0) return '';

            const fmt = value => Number.isFinite(value) ? value.toLocaleString('fr-FR') : 'N/A';

            if (points.length === 1) {
                return `
                    <div class="detail" style="margin-top:8px;padding-top:8px;border-top:1px solid #ddd;color:#777;font-size:0.75rem;">
                        Un seul millésime disponible (${points[0].year}) — évolution non traçable.
                    </div>`;
            }

            const first = points[0];
            const last = points[points.length - 1];
            const delta = last.mja - first.mja;
            const pct = first.mja ? (delta / first.mja) * 100 : 0;
            const arrow = pct > 2 ? '▲' : (pct < -2 ? '▼' : '▬');
            const trendColor = pct > 2 ? '#c0392b' : (pct < -2 ? '#27ae60' : '#7f8c8d');
            const sign = delta > 0 ? '+' : '';

            const W = 300, H = 78, padL = 6, padR = 6, padT = 12, padB = 16;
            const years = points.map(p => p.year);
            const mjas = points.map(p => p.mja);
            const minYear = Math.min(...years), maxYear = Math.max(...years);
            const minMja = Math.min(...mjas), maxMja = Math.max(...mjas);
            const spanYear = (maxYear - minYear) || 1;
            const spanMja = (maxMja - minMja) || 1;
            const xOf = y => padL + ((y - minYear) / spanYear) * (W - padL - padR);
            const yOf = m => padT + (1 - (m - minMja) / spanMja) * (H - padT - padB);

            const poly = points.map(p => `${xOf(p.year).toFixed(1)},${yOf(p.mja).toFixed(1)}`).join(' ');
            const dots = points
                .map(p => `<circle cx="${xOf(p.year).toFixed(1)}" cy="${yOf(p.mja).toFixed(1)}" r="1.6" fill="#2c3e50"/>`)
                .join('');
            const firstDot = `<circle cx="${xOf(first.year).toFixed(1)}" cy="${yOf(first.mja).toFixed(1)}" r="2.6" fill="#3498db"/>`;
            const lastDot = `<circle cx="${xOf(last.year).toFixed(1)}" cy="${yOf(last.mja).toFixed(1)}" r="2.6" fill="${trendColor}"/>`;

            return `
                <div class="detail" style="margin-top:8px;padding-top:8px;border-top:1px solid #ddd;">
                    <strong>Évolution du trafic (MJA)</strong>
                    <div style="display:flex;align-items:baseline;gap:6px;margin:2px 0 4px;font-size:0.8rem;color:${trendColor};">
                        <span>${arrow}</span>
                        <strong>${sign}${fmt(delta)} véh/j</strong>
                        <span>(${sign}${pct.toFixed(0)}%)</span>
                        <span style="color:#999;">${first.year}→${last.year}</span>
                    </div>
                    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;max-width:100%;overflow:visible;">
                        <polyline points="${poly}" fill="none" stroke="#2c3e50" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
                        ${dots}${firstDot}${lastDot}
                        <text x="${padL}" y="8" font-size="8" fill="#bbb">max ${fmt(maxMja)}</text>
                        <text x="${padL}" y="${H - 4}" font-size="8" fill="#999">${minYear}</text>
                        <text x="${W - padR}" y="${H - 4}" font-size="8" fill="#999" text-anchor="end">${maxYear}</text>
                    </svg>
                    <div style="font-size:0.7rem;color:#999;">${points.length} millésimes · ${fmt(first.mja)} → ${fmt(last.mja)} véh/j</div>
                </div>`;
        }

        // Load counting data from script-updated local GeoJSON
        async function loadTrafficCountingData() {
            console.log('🚦 === DÉBUT CHARGEMENT STATIONS DE COMPTAGE ===');
            
            let geojsonData = null;
            let sourceUsed = null;

            try {
                geojsonData = await window.InforouteApi.fetchGeoJson('traffic-counting');
                sourceUsed = geojsonData._cache?.source_name || 'data.gouv.fr / CD84 (GeoJSON local)';
                updateExternalRefreshStatus('Comptages CD84', geojsonData._cache);
                console.log(`✓ Données chargées depuis ${sourceUsed}`);
                console.log(`   Features: ${geojsonData.features.length}`);
            } catch (error) {
                console.warn('❌ Échec du chargement du GeoJSON local de comptage:', error.message);
            }

            if (!geojsonData || !geojsonData.features) {
                console.error('❌ AUCUN GEOJSON DE COMPTAGE DISPONIBLE');
                console.warn('⚠️ Utilisation de données de démonstration (local)');

                try {
                    geojsonData = await window.InforouteApi.fetchGeoJson('traffic-counting-demo');
                    sourceUsed = 'Données de démonstration (GeoJSON local)';
                    renderFreshnessBadge(document.getElementById('freshness-traffic'), {
                        generatedAt: geojsonData._cache?.generated_at,
                        scheduleKey: 'external',
                        errorMsg: 'Source réelle indisponible, démo affichée'
                    });
                    syncLegendChrome();
                } catch (error) {
                    console.error('❌ Échec du chargement des données de démonstration:', error);
                }
                
                if (geojsonData && geojsonData.features) {
                    L.popup()
                        .setLatLng([44.0, 5.0])
                        .setContent('<div style="padding: 15px; text-align: center;"><strong>⚠️ Stations de comptage</strong><br><small>GeoJSON local indisponible<br><br><strong>5 stations de démonstration affichées</strong><br><br>Lancez scripts/update_external_data.py pour actualiser les données réelles.</small></div>')
                        .openOn(window.map);
                    
                    setTimeout(() => window.map.closePopup(), 6000);
                } else {
                    geojsonData = { type: 'FeatureCollection', features: [] };
                    sourceUsed = 'Aucune donnée disponible';
                }
            }

            console.log(`✓ ${geojsonData.features.length} stations de comptage chargées depuis ${sourceUsed}`);

            // Compteurs pour les statistiques
            const trafficCounts = { high: 0, medium: 0, low: 0 };
            
            // Group every observation per station: keep the full yearly history
            // (issue #23) plus a pointer to the most recent year for marker styling.
            const stationsById = {};
            geojsonData.features.forEach(feature => {
                const props = feature.properties;
                const stationId = props.section_compteur ?? props.section_co ?? props.identifian ?? props.id_station ?? props.id;
                const year = Number.parseInt(props.annee ?? props.year ?? props.an, 10);

                if (!stationId || !Number.isFinite(year)) return;

                let entry = stationsById[stationId];
                if (!entry) {
                    entry = stationsById[stationId] = { feature, year, history: [] };
                }

                entry.history.push({
                    year,
                    mja: Number(props.mja_tv ?? props.mja ?? props.mja_jour),
                    tauxPL: Number(props.taux_pl ?? props.tauxpl ?? props.taux_pl_pc),
                    debitPL: Number(props.debit_pl ?? props.debitpl ?? props.pl_jour)
                });

                if (year > entry.year) {
                    entry.year = year;
                    entry.feature = feature;
                }
            });

            // Afficher les stations de comptage
            Object.values(stationsById).forEach(data => {
                const feature = data.feature;
                const props = feature.properties;
                
                // Station coordinates
                const lat = props.latitude || (feature.geometry ? feature.geometry.coordinates[1] : null);
                const lon = props.longitude || (feature.geometry ? feature.geometry.coordinates[0] : null);
                
                if (!lat || !lon) return;

                // AADT (Annual Average Daily Traffic)
                const mja = Number(props.mja_tv ?? props.mja ?? props.mja_jour ?? 0);
                const tauxPL = Number(props.taux_pl ?? props.tauxpl ?? props.taux_pl_pc ?? 0);
                const debitPL = Number(props.debit_pl ?? props.debitpl ?? props.pl_jour ?? 0);
                
                const routeName = props.nom_route_cd ?? props.nom_route_ ?? props.nom_route ?? props.route ?? props.ref ?? 'N/A';
                const sectionName = props.section_compteur ?? props.section_co ?? props.section ?? props.id_station ?? props.id ?? 'N/A';
                const yearValue = props.annee ?? props.year ?? props.an ?? 'N/A';
                
                const formatNumber = (value, suffix = '') => Number.isFinite(value) ? `${value.toLocaleString()}${suffix}` : 'N/A';

                const historyChart = buildTrafficHistoryChart(data.history);

                // Determine traffic category (light gray → dark gray)
                let style, category;
                if (mja >= 20000) {
                    style = TRAFFIC_STYLES.high;
                    category = 'high';
                    trafficCounts.high++;
                } else if (mja >= 5000) {
                    style = TRAFFIC_STYLES.medium;
                    category = 'medium';
                    trafficCounts.medium++;
                } else {
                    style = TRAFFIC_STYLES.low;
                    category = 'low';
                    trafficCounts.low++;
                }

                // Create marker (hidden by default — see trafficVisible). Uses a
                // divIcon badge so the rounded AADT is printed inside the circle.
                const marker = L.marker([lat, lon], {
                    icon: makeTrafficDivIcon(mja, style, category),
                    keyboard: false
                });
                // Keep the numeric AADT on the marker for stats (avoids parsing HTML).
                marker.trafficMja = Number.isFinite(mja) ? mja : null;
                marker.trafficCategory = category;

                // Store for visibility toggle
                trafficMarkers.push(marker);

                // Popup with counting information (issue #9 / UX): compact header,
                // the multi-year chart first, then a two-column stats grid.
                const classeCell = props.classe
                    ? `<div class="tp-cell"><span class="tp-k">Classe</span><span class="tp-v">${props.classe}</span></div>`
                    : '';
                const axisHint = (routeName && routeName !== 'N/A')
                    ? `<div class="tp-axis">🛣️ Axe <strong>${routeName}</strong> surligné sur la carte</div>`
                    : '';

                const popupContent = `
                    <div class="route-popup traffic-popup">
                        <div class="tp-header">
                            <span class="tp-badge">📊 Station</span>
                            <div class="tp-title">
                                <span class="tp-route">${routeName || 'N/A'}</span>
                                <span class="tp-meta">Section ${sectionName || 'N/A'} · ${yearValue || 'N/A'}</span>
                            </div>
                        </div>
                        ${historyChart}
                        <div class="tp-grid">
                            <div class="tp-cell"><span class="tp-k">MJA (tous véh.)</span><span class="tp-v">${formatNumber(mja, ' véh/j')}</span></div>
                            <div class="tp-cell"><span class="tp-k">Taux PL</span><span class="tp-v">${Number.isFinite(tauxPL) ? tauxPL.toFixed(1) + '%' : 'N/A'}</span></div>
                            <div class="tp-cell"><span class="tp-k">Débit PL</span><span class="tp-v">${formatNumber(debitPL, ' PL/j')}</span></div>
                            ${classeCell}
                        </div>
                        ${axisHint}
                        <div class="tp-source">Source&nbsp;: ${sourceUsed || 'Inconnue'}</div>
                    </div>
                `;

                marker.bindPopup(popupContent, {
                    className: 'traffic-popup-wrap',
                    minWidth: 300,
                    maxWidth: 340,
                    offset: L.point(8, -10),
                    autoPanPadding: L.point(60, 70)
                });

                // Hover feedback is handled in CSS (.traffic-count-icon:hover).

                // Contextualise the count (issue #9): clicking a station draws a
                // distinct accent trace over the matching road axis, without moving
                // the map off the station.
                marker.on('click', function() {
                    const key = findRoutePolylineKey(routeName);
                    if (key) highlightStationAxis(key);
                });
            });

            // Update legend counters
            document.getElementById('count-high').textContent = trafficCounts.high;
            document.getElementById('count-medium').textContent = trafficCounts.medium;
            document.getElementById('count-low').textContent = trafficCounts.low;
            
            console.log(`✓ Marqueurs créés:`, trafficCounts);

            // Update statistics
            const totalStations = trafficCounts.high + trafficCounts.medium + trafficCounts.low;
            const years = Object.values(stationsById).map(d => d.year).filter(Number.isFinite);
            const latestYear = years.length ? Math.max(...years) : 'N/A';
            const sourceYears = formatYearRange(collectYears(geojsonData.features, ['annee', 'year', 'an']));
            renderFreshnessBadge(document.getElementById('freshness-traffic'), {
                generatedAt: geojsonData._cache?.generated_at,
                scheduleKey: 'external',
                errorMsg: geojsonData._cache?.error
            });
            syncLegendChrome();
            
            console.log(`✓ Total stations affichées: ${totalStations} (année max ${latestYear})`);
            console.log('🚦 === FIN CHARGEMENT STATIONS DE COMPTAGE ===');

            if (typeof window.patchDashboardMetrics === 'function') {
                const trafficMetrics = computeTrafficMetricsFromGeoJson(geojsonData);
                window.patchDashboardMetrics({
                    traffic: trafficMetrics.traffic,
                    vintages: trafficMetrics.vintages
                });
            }

            // Refresh "Network Information" stats now that AADT values are known.
            if (typeof updateNetworkStats === 'function') updateNetworkStats();
            tryApplyAppUrlState();
        }

        // ========== ACCIDENTOLOGY (multi-year "cloud", BAAC) ==========
        //
        // Rendering follows a dual encoding (inspired by loicbertrand.eu/accidents):
        //   • colour  = recency  → recent years are vivid/saturated, old years dark
        //   • size    = severity → fatal (tué) largest, then hospitalised, then light
        // Points are drawn on a shared canvas renderer to stay smooth with ~2000 pts,
        // and can be filtered by a year range via the timeline slider in the legend.

        // Severity is read mainly from the black ring (hospitalised & fatal) vs the
        // thin white outline (slight). Hospitalised and slight share the same radius
        // on purpose — the ring is the discriminator; only fatal is enlarged.
        const ACCIDENT_SIZE = { mortel: 6.5, grave: 4.5, leger: 4.5 };
        // Fatal crashes step out of the recency ramp entirely: black reads at a glance
        // against the red-orange cloud, whatever the year.
        const ACCIDENT_FATAL_COLOR = '#111111';

        // Leaflet stacks every canvas renderer below every SVG one
        // (.leaflet-map-pane canvas → z-index 100, svg → 200), so the road polylines
        // covered the crash dots and swallowed their clicks — and crashes sit on roads
        // by definition. A dedicated pane above the overlay pane puts the cloud back on
        // top. See accidentPaneHitTesting below for how road clicks keep working.
        const ACCIDENT_PANE = 'accidentsCloud';
        if (!window.map.getPane(ACCIDENT_PANE)) {
            const pane = window.map.createPane(ACCIDENT_PANE);
            pane.style.zIndex = 450;
            pane.style.pointerEvents = 'none';
        }
        const accidentCanvasRenderer = L.canvas({ pane: ACCIDENT_PANE, padding: 0.4 });
        let accidentYearBounds = { min: null, max: null };   // full data range
        let accidentYearFilter = { min: null, max: null };   // current slider range
        let accidentPerYear = {};                            // {year: count}

        // Recency ramp: t=0 (oldest) → deep dark maroon ; t=1 (newest) → vivid orange-red.
        function accidentRecencyColor(year) {
            const { min, max } = accidentYearBounds;
            let t = 0.5;
            if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
                t = (year - min) / (max - min);
            }
            t = Math.max(0, Math.min(1, t));
            const hue = 4 + t * 24;          // 4° (dark red) → 28° (orange-red)
            const sat = 55 + t * 45;         // 55% → 100%
            const light = 22 + t * 32;       // 22% (dark) → 54% (vivid)
            return `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
        }

        // Load accident data from local static GeoJSON (multi-year BAAC snapshot)
        async function loadAccidentData() {
            try {
                console.log('📊 Chargement des données d\'accidentologie…');

                const dataToUse = await window.InforouteApi.fetchGeoJson('accidents');
                const stats = dataToUse.metadata?.statistiques || {};
                const features = dataToUse.features || [];
                renderFreshnessBadge(document.getElementById('freshness-accidents'), {
                    generatedAt: dataToUse._cache?.generated_at,
                    scheduleKey: 'static'
                });
                syncLegendChrome();

                console.log(`✓ ${features.length} accidents chargés pour le Vaucluse`);

                // Establish the year bounds first (needed by the colour ramp).
                const years = features
                    .map(f => Number.parseInt(f.properties?.annee, 10))
                    .filter(Number.isFinite);
                accidentYearBounds = {
                    min: years.length ? Math.min(...years) : null,
                    max: years.length ? Math.max(...years) : null
                };
                accidentYearFilter = { min: accidentYearBounds.min, max: accidentYearBounds.max };
                accidentPerYear = dataToUse.metadata?.par_annee || {};
                if (!Object.keys(accidentPerYear).length) {
                    features.forEach(f => {
                        const y = Number.parseInt(f.properties?.annee, 10);
                        if (Number.isFinite(y)) accidentPerYear[y] = (accidentPerYear[y] || 0) + 1;
                    });
                }

                accidentMarkers = [];

                features.forEach(feature => {
                    const props = feature.properties || {};
                    const coords = feature.geometry?.coordinates || [];
                    const lat = coords[1];
                    const lon = coords[0];
                    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

                    const year = Number.parseInt(props.annee, 10);
                    const gravite = props.gravite || 'leger';
                    const size = ACCIDENT_SIZE[gravite] || ACCIDENT_SIZE.leger;
                    const label = gravite === 'mortel'
                        ? '💀 Accident mortel'
                        : (gravite === 'grave' ? '🚑 Blessé(s) hospitalisé(s)' : '⚠️ Blessé(s) léger(s)');

                    // Fatal crashes are read first, so they leave the recency ramp and
                    // take a solid black dot ringed in white. The other two keep the
                    // ramp, with a black ring telling hospitalised from slight.
                    const isFatal = gravite === 'mortel';
                    const hasRing = (isFatal || gravite === 'grave');
                    const marker = L.circleMarker([lat, lon], {
                        renderer: accidentCanvasRenderer,
                        radius: size,
                        fillColor: isFatal ? ACCIDENT_FATAL_COLOR : accidentRecencyColor(year),
                        color: isFatal ? '#ffffff' : (hasRing ? '#111111' : '#ffffff'),
                        weight: hasRing ? 1.6 : 0.6,
                        opacity: hasRing ? 0.95 : 0.85,
                        fillOpacity: isFatal ? 1 : 0.85
                    });
                    marker.accidentYear = Number.isFinite(year) ? year : null;
                    marker.accidentGravite = gravite;

                    accidentMarkers.push(marker);

                    const victimesInfo = [];
                    if (props.tues > 0) victimesInfo.push(`${props.tues} tué(s)`);
                    if (props.hospitalises > 0) victimesInfo.push(`${props.hospitalises} hospitalisé(s)`);
                    if (props.legers > 0) victimesInfo.push(`${props.legers} blessé(s) léger(s)`);

                    const popupContent = `
                        <div class="route-popup">
                            <h3>${label}</h3>
                            <div class="detail"><strong>Année&nbsp;:</strong> ${Number.isFinite(year) ? year : 'N/A'}</div>
                            ${victimesInfo.length ? `<div class="detail"><strong>Victimes&nbsp;:</strong> ${victimesInfo.join(', ')}</div>` : ''}
                            <div class="detail"><strong>Date&nbsp;:</strong> ${props.date || 'N/A'}</div>
                            <div class="detail"><strong>Commune&nbsp;:</strong> ${props.commune || 'N/A'}</div>
                            ${props.adresse ? `<div class="detail"><strong>Adresse&nbsp;:</strong> ${props.adresse}</div>` : ''}
                            ${props.milieu ? `<div class="detail"><strong>Milieu&nbsp;:</strong> ${props.milieu}</div>` : ''}
                        </div>
                    `;
                    marker.bindPopup(popupContent);
                });

                console.log('Statistiques:', stats);

                // Wire up the timeline (histogram + range slider) and paint counters.
                setupAccidentTimeline();
                applyAccidentVisibility();

                tryApplyAppUrlState();
            } catch (error) {
                console.error('Erreur lors du chargement de l\'accidentologie:', error);
            }
        }

        // Show/hide accident markers according to the current year filter, refresh
        // the per-severity counters (for the filtered subset) and dashboard metrics.
        function applyAccidentVisibility() {
            const { min, max } = accidentYearFilter;
            const counts = { fatal: 0, hospitalized: 0, light: 0 };
            const perYear = {};

            accidentMarkers.forEach(marker => {
                const y = marker.accidentYear;
                const inRange = !Number.isFinite(min) || !Number.isFinite(max) ||
                    (Number.isFinite(y) && y >= min && y <= max);

                // Counters reflect the year filter even while the layer is hidden.
                if (inRange) {
                    if (marker.accidentGravite === 'mortel') counts.fatal++;
                    else if (marker.accidentGravite === 'grave') counts.hospitalized++;
                    else counts.light++;
                    if (Number.isFinite(y)) perYear[y] = (perYear[y] || 0) + 1;
                }

                const typeVisible = accidentTypeVisibility[marker.accidentGravite] !== false;
                const shouldShow = accidentsVisible && inRange && typeVisible;
                if (shouldShow) {
                    if (!window.map.hasLayer(marker)) marker.addTo(window.map);
                } else if (window.map.hasLayer(marker)) {
                    window.map.removeLayer(marker);
                }
            });

            const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            set('count-fatal', counts.fatal);
            set('count-hospitalized', counts.hospitalized);
            set('count-light', counts.light);

            renderAccidentHistogram();

            if (typeof window.patchDashboardMetrics === 'function') {
                // La légende peut restreindre les années : on étiquette la plage
                // effectivement comptée, pas l'étendue du fichier.
                const counted = Object.keys(perYear).map(Number).filter(Number.isFinite);
                const { latestYear, latestTotal } = latestYearFromCounts(perYear);
                window.patchDashboardMetrics({
                    accidents: {
                        total: counts.fatal + counts.hospitalized + counts.light,
                        fatal: counts.fatal,
                        hospitalized: counts.hospitalized,
                        light: counts.light,
                        latestYear,
                        latestTotal
                    },
                    vintages: {
                        accidents: counted.length
                            ? accidentVintageLabel(Math.min(...counted), Math.max(...counted))
                            : 'BAAC'
                    }
                });
            }
        }
        // Reachable from the legend toggles, which live outside DOMContentLoaded.
        window.applyAccidentVisibility = applyAccidentVisibility;

        // The cloud pane spans the whole viewport, so leaving it clickable would steal
        // every click meant for a road. It is therefore opened only while the cursor
        // actually rests on a crash dot.
        function accidentAtLayerPoint(layerPoint) {
            if (!accidentsVisible || !window.map) return null;
            for (let i = accidentMarkers.length - 1; i >= 0; i--) {
                const marker = accidentMarkers[i];
                if (typeof marker._containsPoint !== 'function') continue;
                if (!window.map.hasLayer(marker)) continue;
                if (marker._containsPoint(layerPoint)) return marker;
            }
            return null;
        }

        window.map.on('mousemove', event => {
            const pane = window.map.getPane(ACCIDENT_PANE);
            if (!pane) return;
            const hit = Boolean(accidentAtLayerPoint(event.layerPoint));
            pane.style.pointerEvents = hit ? 'auto' : 'none';
            pane.style.cursor = hit ? 'pointer' : '';
        });

        // Touch input never sends the hover that opens the pane, so a tap landing next
        // to a road is resolved here instead.
        window.map.on('click', event => {
            const marker = accidentAtLayerPoint(event.layerPoint);
            if (marker && !marker.isPopupOpen()) marker.openPopup();
        });

        // Draw the per-year histogram in the legend, colour-coded by recency, and
        // dim the bars outside the current filter range.
        function renderAccidentHistogram() {
            const host = document.getElementById('accidents-histogram');
            if (!host) return;
            const { min, max } = accidentYearBounds;
            if (!Number.isFinite(min) || !Number.isFinite(max)) { host.innerHTML = ''; return; }

            const years = [];
            for (let y = min; y <= max; y++) years.push(y);
            const maxCount = Math.max(1, ...years.map(y => accidentPerYear[y] || 0));
            const f = accidentYearFilter;

            host.innerHTML = years.map(y => {
                const c = accidentPerYear[y] || 0;
                const h = Math.max(3, Math.round((c / maxCount) * 100));
                const active = (!Number.isFinite(f.min) || !Number.isFinite(f.max)) ||
                    (y >= f.min && y <= f.max);
                const color = accidentRecencyColor(y);
                return `<div class="acc-bar" title="${y} : ${c} accident(s)">
                    <span class="acc-bar-fill" style="height:${h}%;background:${color};opacity:${active ? 1 : 0.25}"></span>
                    <span class="acc-bar-year${active ? ' is-active' : ''}">${String(y).slice(2)}</span>
                </div>`;
            }).join('');
        }

        // Wire the "de / à" year sliders once, after data is loaded.
        let accidentTimelineReady = false;
        function setupAccidentTimeline() {
            renderAccidentHistogram();
            const minEl = document.getElementById('acc-year-min');
            const maxEl = document.getElementById('acc-year-max');
            const label = document.getElementById('acc-year-label');
            const { min, max } = accidentYearBounds;
            if (!minEl || !maxEl || !Number.isFinite(min) || !Number.isFinite(max)) return;

            [minEl, maxEl].forEach(el => {
                el.min = String(min);
                el.max = String(max);
                el.step = '1';
            });
            minEl.value = String(min);
            maxEl.value = String(max);
            if (label) label.textContent = `${min}–${max}`;

            if (accidentTimelineReady) return;
            accidentTimelineReady = true;

            const onChange = () => {
                let lo = Number.parseInt(minEl.value, 10);
                let hi = Number.parseInt(maxEl.value, 10);
                if (lo > hi) {   // keep thumbs from crossing
                    if (document.activeElement === minEl) { hi = lo; maxEl.value = String(hi); }
                    else { lo = hi; minEl.value = String(lo); }
                }
                accidentYearFilter = { min: lo, max: hi };
                if (label) label.textContent = lo === hi ? `${lo}` : `${lo}–${hi}`;
                applyAccidentVisibility();
            };
            minEl.addEventListener('input', onChange);
            maxEl.addEventListener('input', onChange);
        }
        
        // Load counting data after routes
        setTimeout(loadTrafficCountingData, 2000);
        
        // Load accident data after counting
        setTimeout(loadAccidentData, 3000);
        
        // Load Bison Futé data (Info Routière)
        setTimeout(loadBisonFuteData, 4000);

        // Preload bridge metadata for sidebar counters without displaying the layer.
        setTimeout(() => {
            if (window.loadBridges) window.loadBridges({ show: false });
        }, 4500);

        setTimeout(() => {
            if (sensitiveZonesLoaded || sensitiveZonesVisible || appUrlWantsLayer('ens')) return;
            if (window.loadSensitiveZones) window.loadSensitiveZones({ show: false });
        }, 5000);

        setTimeout(() => {
            if (inaturalistSensitivesLoaded || inaturalistSensitivesVisible || appUrlWantsLayer('inat')) return;
            if (window.loadInaturalistSensitives) window.loadInaturalistSensitives({ show: false });
        }, 5500);

        setTimeout(() => {
            if (webcamsLoaded || webcamsVisible || appUrlWantsLayer('wcam')) return;
            if (window.loadWebcams) window.loadWebcams({ show: false });
        }, 6000);

        setTimeout(() => {
            if (roadsideAreasLoaded || roadsideAreasVisible || appUrlWantsLayer('aires')) return;
            if (window.loadRoadsideAreas) window.loadRoadsideAreas({ show: false });
        }, 6500);
        
        // ========== ROADS UNDER CONSTRUCTION ==========

        function classifyConstructionWay(tags) {
            if (!tags) return null;
            if (tags.highway === 'construction' || tags.construction === 'highway' || tags['construction:highway']) {
                return 'construction';
            }
            if (tags.highway === 'proposed' || tags.proposed === 'highway' || tags['proposed:highway']) {
                return 'proposed';
            }
            return tags.road_status === 'construction' || tags.road_status === 'proposed'
                ? tags.road_status
                : null;
        }
        
        window.loadConstructionRoads = async function() {
            try {
                const data = await window.InforouteApi.fetchGeoJson('construction-roads');
                renderFreshnessBadge(document.getElementById('freshness-construction'), {
                    generatedAt: data._cache?.generated_at,
                    scheduleKey: 'osm'
                });

                clearConstructionPolylines();

                const constructionWays = (data.features || [])
                    .map(geoJsonLineFeatureToWay)
                    .filter(Boolean);

                let constructionCount = 0;
                let proposedCount = 0;

                constructionWays.forEach(way => {
                    if (!way.geometry || way.geometry.length === 0) return;

                    const coords = way.geometry.map(point => [point.lat, point.lon]);
                    const tags = way.tags || {};
                    const status = classifyConstructionWay(tags);
                    if (!status) return;

                    const styles = status === 'construction'
                        ? { color: '#FF6B35', weight: 6, dashArray: '15, 10', statusLabel: '🚧 En construction' }
                        : { color: '#9B59B6', weight: 5, dashArray: '10, 15', statusLabel: '📋 En projet' };

                    if (status === 'construction') constructionCount++;
                    else proposedCount++;

                    const polyline = L.polyline(coords, {
                        color: styles.color,
                        weight: styles.weight,
                        opacity: 0.9,
                        dashArray: styles.dashArray
                    });
                    polyline.constructionType = status === 'construction' ? 'highway' : 'proposed';

                    constructionPolylines.push(polyline);

                    const futureType = tags.construction || tags.proposed || tags['construction:highway'] || tags['proposed:highway'] || tags.highway || 'Route';
                    const name = tags.name || tags.ref || 'Sans nom';
                    const startDate = tags.start_date || tags['construction:start_date'] || 'Non renseignée';
                    const endDate = tags.end_date || tags['construction:end_date'] || tags.opening_date || 'Non renseignée';
                    const expectedOpening = tags.opening_date || tags['opening_date:expected'] || 'Non renseignée';

                    polyline.bindPopup(`
                        <div class="route-popup">
                            <h3>${styles.statusLabel}</h3>
                            <div class="detail"><strong>Nom/Réf&nbsp;:</strong> ${escapeHtml(name)}</div>
                            <div class="detail"><strong>Type futur&nbsp;:</strong> ${escapeHtml(String(futureType).replace('_', ' '))}</div>
                            ${tags.description || tags['construction:description'] ? `
                                <div class="detail" style="margin-top: 10px; padding: 10px; background: #fff3cd; border-left: 4px solid #FF6B35; border-radius: 4px; font-style: italic;">
                                    ℹ️ ${escapeHtml(tags.description || tags['construction:description'])}
                                </div>
                            ` : ''}
                            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #ddd;">
                                ${startDate !== 'Non renseignée' ? `<div class="detail"><strong>🗓️ Début&nbsp;:</strong> ${escapeHtml(startDate)}</div>` : ''}
                                ${endDate !== 'Non renseignée' ? `<div class="detail"><strong>🏁 Fin prévue&nbsp;:</strong> ${escapeHtml(endDate)}</div>` : ''}
                                ${expectedOpening !== 'Non renseignée' ? `<div class="detail"><strong>🎉 Ouverture&nbsp;:</strong> ${escapeHtml(expectedOpening)}</div>` : ''}
                            </div>
                            ${tags.operator || tags['construction:operator'] ? `
                                <div class="detail" style="margin-top: 8px;">
                                    <strong>🏗️ Maître d'ouvrage&nbsp;:</strong> ${escapeHtml(tags.operator || tags['construction:operator'])}
                                </div>
                            ` : ''}
                            ${tags.website ? `
                                <div class="detail" style="margin-top: 10px;">
                                    <strong>🌐 Site web&nbsp;:</strong>
                                    <a href="${escapeHtml(tags.website)}" target="_blank" rel="noopener noreferrer" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                        Visiter le site du projet →
                                    </a>
                                </div>
                            ` : ''}
                            <div class="detail" style="margin-top: 12px; padding-top: 12px; border-top: 2px solid #e0e0e0;">
                                <a href="https://www.openstreetmap.org/way/${way.id}" target="_blank" rel="noopener noreferrer" style="color: #3498DB; font-weight: 600; text-decoration: none;">
                                    🗺️ Voir sur OpenStreetMap →
                                </a>
                            </div>
                        </div>
                    `);

                    polyline.on('mouseover', function() {
                        this.setStyle({ weight: styles.weight + 2, opacity: 1 });
                    });
                    polyline.on('mouseout', function() {
                        this.setStyle({ weight: styles.weight, opacity: 0.9 });
                    });
                });

                document.getElementById('count-construction').textContent = String(constructionCount);
                document.getElementById('count-proposed').textContent = String(proposedCount);

                if (typeof window.patchDashboardMetrics === 'function') {
                    window.patchDashboardMetrics({
                        construction: {
                            construction: constructionCount,
                            proposed: proposedCount
                        },
                        vintages: {
                            osm: formatDashboardCacheVintage(data._cache?.generated_at, 'Cache OSM')
                        }
                    });
                }

                syncConstructionPolylinesOnMap();
                applyConstructionLayerUi();
                syncLegendChrome();
                tryApplyAppUrlState();
            } catch (error) {
                console.error('Erreur chargement routes en construction:', error);
                document.getElementById('count-construction').textContent = '0';
                document.getElementById('count-proposed').textContent = '0';
                applyConstructionLayerUi();
                syncLegendChrome();
            }
        };

        window.loadBicycleRoutes = async function() {
            try {
                const data = await window.InforouteApi.fetchGeoJson('bicycle-routes');
                renderFreshnessBadge(document.getElementById('freshness-bicycle'), {
                    generatedAt: data._cache?.generated_at,
                    scheduleKey: 'osm'
                });
                syncLegendChrome();

                const bicycleWays = (data.features || [])
                    .map(geoJsonLineFeatureToWay)
                    .filter(Boolean);

                const relationIdToRef = buildBicycleRelationIdToRef(bicycleWays);

                if (bicycleWays.length === 0) {
                    bicycleVisible = false;
                    applyBicycleHiddenUi();
                    setBicycleLegendCounts(computeBicycleStatsFromWays([], relationIdToRef));
                    return;
                }

                const bikeStats = computeBicycleStatsFromWays(bicycleWays, relationIdToRef);
                const localWays = [];
                const structuranteWays = [];
                bicycleWays.forEach(way => {
                    const style = getBicycleRouteStyle(way.tags || {}, relationIdToRef);
                    if (style.structuranteRef) structuranteWays.push(way);
                    else localWays.push(way);
                });

                setBicycleLegendCounts(bikeStats);

                localWays.forEach(way => {
                    renderBicycleWayPolyline(way, relationIdToRef);
                });

                structuranteWays.forEach(way => {
                    const polyline = renderBicycleWayPolyline(way, relationIdToRef);
                    polyline.bringToFront();
                });

                applyBicycleVisibleUi();
                tryApplyAppUrlState();
            } catch (error) {
                console.error('Erreur chargement véloroutes:', error);
                bicycleVisible = false;
                applyBicycleHiddenUi();
                setBicycleLegendCounts(computeBicycleStatsFromWays([], new Map()));
            }
        };

        // ========== BISON FUTÉ / INFO ROUTIÈRE ==========
        
        async function loadBisonFuteData() {
            try {
                console.log('🚗 Chargement des données Bison Futé / Info Routière...');
                
                const data = await window.InforouteApi.fetchGeoJson('road-events');
                updateExternalRefreshStatus('Info Routière', data._cache);

                renderFreshnessBadge(document.getElementById('freshness-bison-fute'), {
                    generatedAt: data._cache?.generated_at,
                    scheduleKey: 'external',
                    errorMsg: data._cache?.error
                });

                clearBisonFuteMarkers();
                
                if (!data.features || data.features.length === 0) {
                    console.log('ℹ️ Aucun événement Info Routière dans le GeoJSON local');
                    updateBisonFuteLegendCounts({ travaux: 0, bouchons: 0, accidents: 0, autres: 0 });
                    if (typeof window.patchDashboardMetrics === 'function') {
                        window.patchDashboardMetrics({
                            bisonFute: { total: 0, travaux: 0, bouchons: 0, accidents: 0 },
                            vintages: { bisonFute: 'Cache 3 h · Info Routière' }
                        });
                    }
                    applyBisonFuteLayerUi();
                    syncLegendChrome();
                    return;
                }
                
                console.log(`✓ ${data.features.length} événements routiers chargés`);
                
                // Filter events in or near Vaucluse (approximate bbox)
                const vaucluseBbox = {
                    minLat: 43.6,
                    maxLat: 44.5,
                    minLon: 4.6,
                    maxLon: 5.8
                };
                
                let eventsCount = { travaux: 0, bouchons: 0, accidents: 0, autres: 0 };
                
                data.features.forEach(feature => {
                    const geom = feature.geometry;
                    const props = feature.properties;
                    
                    if (!geom || !geom.coordinates) return;
                    
                    // Extract coordinates by geometry type
                    let lat, lon;
                    if (geom.type === 'Point') {
                        lon = geom.coordinates[0];
                        lat = geom.coordinates[1];
                    } else if (geom.type === 'LineString') {
                        // Take midpoint
                        const midIndex = Math.floor(geom.coordinates.length / 2);
                        lon = geom.coordinates[midIndex][0];
                        lat = geom.coordinates[midIndex][1];
                    } else {
                        return; // Ignorer les autres types
                    }
                    
                    // Check whether inside or near Vaucluse
                    if (lat < vaucluseBbox.minLat || lat > vaucluseBbox.maxLat ||
                        lon < vaucluseBbox.minLon || lon > vaucluseBbox.maxLon) {
                        return; // Hors zone
                    }
                    
                    // Determine event type
                    const eventType = props.event_type || props.type || 'autre';
                    let icon, color, category;
                    
                    if (eventType.includes('roadwork') || eventType.includes('travaux')) {
                        icon = '🚧';
                        color = '#F39C12';
                        category = 'travaux';
                        eventsCount.travaux++;
                    } else if (eventType.includes('congestion') || eventType.includes('bouchon')) {
                        icon = '🚗';
                        color = '#E74C3C';
                        category = 'bouchons';
                        eventsCount.bouchons++;
                    } else if (eventType.includes('accident')) {
                        icon = '⚠️';
                        color = '#C0392B';
                        category = 'accidents';
                        eventsCount.accidents++;
                    } else {
                        icon = 'ℹ️';
                        color = '#3498DB';
                        category = 'autres';
                        eventsCount.autres++;
                    }
                    
                    // Create marker (hidden by default — see bisonFuteVisible)
                    const marker = L.marker([lat, lon], {
                        icon: L.divIcon({
                            html: `<div style="font-size: 1.5rem; text-shadow: 0 0 3px white;">${icon}</div>`,
                            className: 'bison-fute-marker',
                            iconSize: [30, 30],
                            iconAnchor: [15, 15]
                        })
                    });
                    marker.bisonFuteCategory = category;

                    // Store for visibility toggle
                    bisonFuteMarkers.push(marker);
                    
                    // Popup with information
                    const startDate = props.start_time ? new Date(props.start_time).toLocaleString('fr-FR') : 'N/A';
                    const endDate = props.end_time ? new Date(props.end_time).toLocaleString('fr-FR') : 'N/A';
                    
                    const popupContent = `
                        <div class="route-popup">
                            <h3>${icon} Bison Futé</h3>
                            <div class="detail"><strong>Type&nbsp;:</strong> ${eventType}</div>
                            ${props.description ? `<div class="detail"><strong>Description&nbsp;:</strong> ${props.description}</div>` : ''}
                            ${props.road_name ? `<div class="detail"><strong>Route&nbsp;:</strong> ${props.road_name}</div>` : ''}
                            <div class="detail"><strong>Début&nbsp;:</strong> ${startDate}</div>
                            ${props.end_time ? `<div class="detail"><strong>Fin prévue&nbsp;:</strong> ${endDate}</div>` : ''}
                            <div class="detail" style="margin-top: 8px; font-size: 0.75rem; color: #999;">
                                <strong>Source&nbsp;:</strong> Bison Futé / Info Routière
                            </div>
                        </div>
                    `;
                    
                    marker.bindPopup(popupContent);
                });
                
                const totalEvents = eventsCount.travaux + eventsCount.bouchons + eventsCount.accidents + eventsCount.autres;
                
                updateBisonFuteLegendCounts(eventsCount);

                if (typeof window.patchDashboardMetrics === 'function') {
                    window.patchDashboardMetrics({
                        bisonFute: {
                            total: totalEvents,
                            travaux: eventsCount.travaux,
                            bouchons: eventsCount.bouchons,
                            accidents: eventsCount.accidents
                        },
                        vintages: {
                            bisonFute: formatDashboardCacheVintage(
                                data._cache?.generated_at,
                                'Cache 3 h · Info Routière'
                            ) || 'Cache 3 h · Info Routière'
                        }
                    });
                }
                
                syncBisonFuteMarkersOnMap();
                applyBisonFuteLayerUi();

                if (totalEvents > 0) {
                    console.log(`✓ Événements Bison Futé affichés:`, eventsCount);
                } else {
                    console.log('ℹ️ Aucun événement Bison Futé dans la zone du Vaucluse actuellement');
                }
                syncLegendChrome();
                tryApplyAppUrlState();
            } catch (error) {
                console.error('❌ Erreur lors du chargement Bison Futé:', error);
                console.log('ℹ️ Bison Futé couvre principalement le RRN (autoroutes, nationales)');
                applyBisonFuteLayerUi();
                syncLegendChrome();
            }
        }


        // Ajouter des marqueurs pour les principales villes
        const cities = [
            { name: 'Avignon', coords: [43.949, 4.805], size: 'large' },
            { name: 'Orange', coords: [44.136, 4.809], size: 'medium' },
            { name: 'Carpentras', coords: [44.055, 5.048], size: 'medium' },
            { name: 'Cavaillon', coords: [43.838, 5.038], size: 'medium' },
            { name: 'Apt', coords: [43.876, 5.396], size: 'medium' },
            { name: 'L\'Isle-sur-la-Sorgue', coords: [43.919, 5.052], size: 'small' },
            { name: 'Pertuis', coords: [43.693, 5.502], size: 'small' }
        ];

        cities.forEach(city => {
            const radius = city.size === 'large' ? 8 : city.size === 'medium' ? 6 : 4;
            const cityMarker = L.circleMarker(city.coords, {
                radius: radius,
                fillColor: '#2C3E50',
                color: 'white',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.9
            }).bindPopup(`<strong>${city.name}</strong>`);

            cityMarkers.push(cityMarker);
            if (citiesVisible) {
                cityMarker.addTo(window.map);
            }
        });

        if (!citiesVisible) {
            document.querySelectorAll('[data-city]').forEach(item => {
                item.style.opacity = '0.5';
            });
        }

        WEATHER_STATIONS.forEach(station => {
            const marker = L.marker([station.lat, station.lon], {
                icon: L.divIcon({
                    className: 'weather-station-marker-wrapper',
                    html: '<span class="weather-station-marker" aria-hidden="true"></span>',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                }),
                riseOnHover: true,
                zIndexOffset: 420
            }).bindTooltip(`${station.name}`, { direction: 'top', offset: [0, -14] });

            marker.on('click', async () => {
                if (!marker.getPopup()) {
                    marker.bindPopup('<div class="weather-station-popup">Chargement…</div>');
                }
                marker.openPopup();
                if (!weatherStationDataById.has(station.id)) {
                    try {
                        await loadStationWeather(station);
                    } catch (error) {
                        marker.setPopupContent('<div class="weather-station-popup">Données indisponibles</div>');
                        return;
                    }
                }
                marker.setPopupContent(
                    renderWeatherStationPopup(station, weatherStationDataById.get(station.id).current)
                );
            });

            weatherStationMarkers.push({ station, marker });
            if (weatherStationsVisible) marker.addTo(window.map);
        });

        setWeatherStationsLegendCounts();
        if (!weatherStationsVisible) {
            document.querySelectorAll('[data-weather-station]').forEach(item => {
                item.style.opacity = '0.5';
            });
        }

        // Legend click handling (hierarchy only, if no inline handler)
        document.querySelectorAll('.legend-item[data-hierarchy]').forEach(item => {
            item.addEventListener('click', function() {
                const hierarchy = this.dataset.hierarchy;
                if (!hierarchy) return;
                if (this.getAttribute('onclick')) return;
                if (typeof window.toggleHierarchy === 'function') {
                    window.toggleHierarchy(hierarchy);
                }
            });
        });

        // All multi-type legend rows follow the same interaction as the network
        // hierarchy: click anywhere on the row to show/hide that subtype.
        const legendSubtypeToggles = {
            bicycle: window.toggleBicycleType,
            construction: window.toggleConstructionType,
            'roadside-area': window.toggleRoadsideAreaType,
            accident: window.toggleAccidentType,
            traffic: window.toggleTrafficType,
            'bison-fute': window.toggleBisonFuteType,
            'road-sign': window.toggleRoadSignType,
            webcam: window.toggleWebcamType,
            'oedb-event': window.toggleOedbEventType
        };
        Object.entries(legendSubtypeToggles).forEach(([dataAttribute, toggle]) => {
            if (typeof toggle !== 'function') return;
            const datasetKey = dataAttribute.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
            document.querySelectorAll(`.legend-item[data-${dataAttribute}]`).forEach(item => {
                const kind = item.dataset[datasetKey];
                if (!kind || kind === 'total') return;
                item.setAttribute('role', 'button');
                const activate = event => {
                    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
                    if (event.type === 'keydown') event.preventDefault();
                    toggle(kind);
                };
                item.addEventListener('click', activate);
                item.addEventListener('keydown', activate);
            });
        });
        
        // ========== LIMITATIONS DE VITESSE & RESTRICTIONS (max*) ==========

        const speedPictoLayer = L.layerGroup();
        const restrictionLayer = L.layerGroup();
        let limitationsZoomHandler = null;
        let limitationsPopupHandler = null;
        const LIMITATIONS_SIGN_ZOOM = 13;        // >= : pictogrammes individuels ; en dessous : dégradé seul

        // Hot/cold color scale for speed limits (km/h).
        // Convention: cold (blue) = slow / safe, hot (red) = fast.
        const SPEED_COLOR_SCALE = [
            { max: 30,  color: '#2980B9', label: '≤30' },
            { max: 50,  color: '#5DADE2', label: '50' },
            { max: 70,  color: '#F4D03F', label: '70' },
            { max: 80,  color: '#F39C12', label: '80' },
            { max: 100, color: '#E67E22', label: '90' },
            { max: 130, color: '#C0392B', label: '≥110' }
        ];
        const SPEED_UNKNOWN_COLOR = '#95A5A6';
        // Couleur des tronçons dont la tranche de vitesse est désactivée dans la légende :
        // ils restent visibles pour garder le réseau lisible, mais s'effacent au second plan.
        const SPEED_MUTED_COLOR = '#CBD5E1';

        // Filtrage par tranche depuis la légende : index dans SPEED_COLOR_SCALE, plus
        // la clé 'unknown' pour les tronçons dépourvus de maxspeed.
        const speedRangeVisibility = SPEED_COLOR_SCALE.map(() => true);
        let speedUnknownVisible = true;

        function speedStepFor(kmh) {
            if (kmh === null || kmh === undefined) return 'unknown';
            for (let i = 0; i < SPEED_COLOR_SCALE.length; i += 1) {
                if (kmh <= SPEED_COLOR_SCALE[i].max) return i;
            }
            return SPEED_COLOR_SCALE.length - 1;
        }

        function isSpeedStepVisible(step) {
            return step === 'unknown' ? speedUnknownVisible : speedRangeVisibility[step] !== false;
        }

        // Convertit une valeur maxspeed chiffrée en km/h, ou null. Les codes de
        // régime (FR:urban…) sont traités à part : ce ne sont pas des panneaux.
        function parseMaxspeed(raw) {
            if (raw === null || raw === undefined) return null;
            const trimmed = String(raw).trim();
            if (!trimmed || trimmed === 'none' || trimmed === 'signals') return null;
            const m = trimmed.match(/^(\d+)(?:\s*(mph|kmh|km\/h))?$/i);
            if (!m) return null;
            const value = Number.parseInt(m[1], 10);
            if (!Number.isFinite(value)) return null;
            if (m[2] && m[2].toLowerCase() === 'mph') return Math.round(value * 1.60934);
            return value;
        }

        // Vitesses implicites : faute de panneau, le régime découle du type de voie
        // — 50 en agglomération, 80 hors agglomération. C'est le pendant
        // réglementaire des panneaux d'entrée et de sortie de village.
        const IMPLICIT_SPEED_CODES = {
            'FR:urban': { kmh: 50, label: 'agglomération' },
            'FR:rural': { kmh: 80, label: 'hors agglomération' },
            'FR:motorway': { kmh: 130, label: 'autoroute' },
            'FR:zone30': { kmh: 30, label: 'zone 30' },
            'FR:zone20': { kmh: 20, label: 'zone 20' },
            'FR:zone50': { kmh: 50, label: 'zone 50' },
            'FR:living_street': { kmh: 20, label: 'zone de rencontre' },
            'FR:walk': { kmh: 20, label: 'zone de rencontre' },
            'FR:30': { kmh: 30, label: 'zone 30' },
            'FR30': { kmh: 30, label: 'zone 30' }
        };

        // `maxspeed` figure dans la liste : quelques tronçons y portent le code de
        // régime au lieu du chiffre, ce qui les rendait « inconnus ».
        const IMPLICIT_SPEED_KEYS = ['maxspeed', 'maxspeed:type', 'source:maxspeed', 'zone:maxspeed'];

        // Vitesse retenue pour un tronçon : le panneau prime, sinon le régime.
        function resolveWaySpeed(tags) {
            const t = tags || {};
            const explicit = parseMaxspeed(t.maxspeed);
            if (explicit !== null) return { kmh: explicit, implicit: false, label: null };
            for (const key of IMPLICIT_SPEED_KEYS) {
                const code = IMPLICIT_SPEED_CODES[String(t[key] || '').trim()];
                if (code) return { kmh: code.kmh, implicit: true, label: code.label };
            }
            return { kmh: null, implicit: false, label: null };
        }

        function colorForSpeed(kmh) {
            if (kmh === null || kmh === undefined) return SPEED_UNKNOWN_COLOR;
            for (const step of SPEED_COLOR_SCALE) {
                if (kmh <= step.max) return step.color;
            }
            return SPEED_COLOR_SCALE[SPEED_COLOR_SCALE.length - 1].color;
        }

        // Repeint toutes les polylines de routes selon leur maxspeed, en estompant
        // les tranches désactivées dans la légende.
        function applySpeedGradient() {
            Object.keys(window.routePolylines).forEach(ref => {
                window.routePolylines[ref].forEach(polyline => {
                    const tags = polyline.options.wayTags || {};
                    const kmh = resolveWaySpeed(tags).kmh;
                    const active = isSpeedStepVisible(speedStepFor(kmh));
                    polyline.setStyle({
                        color: active ? colorForSpeed(kmh) : SPEED_MUTED_COLOR,
                        opacity: active ? (kmh === null ? 0.45 : 0.9) : 0.15,
                        weight: hierarchyWeights[polyline.options.roadHierarchy]
                    });
                });
            });
        }

        // Inverse of applySpeedGradient: restore normal hierarchy colors.
        function restoreHierarchyStyles() {
            Object.keys(window.routePolylines).forEach(ref => {
                window.routePolylines[ref].forEach(polyline => {
                    const hierarchy = polyline.options.roadHierarchy;
                    polyline.setStyle({
                        color: hierarchyColors[hierarchy],
                        weight: hierarchyWeights[hierarchy],
                        opacity: 0.8
                    });
                });
            });
        }

        // Polyline midpoint (used as pictogram anchor).
        function polylineMidLatLng(polyline) {
            const latlngs = polyline.getLatLngs();
            if (!latlngs.length) return null;
            return latlngs[Math.floor(latlngs.length / 2)];
        }

        // Points de repli le long d'un même tronçon, du milieu vers les extrémités.
        // Un panneau de vitesse ne peut pas être déporté hors de la chaussée sans
        // risquer d'être lu sur la route voisine : quand deux valeurs se gênent, on
        // fait glisser l'une le long de sa propre polyline.
        const SPEED_SLIDE_FRACTIONS = [0.5, 0.38, 0.62, 0.26, 0.74, 0.15, 0.85];

        function polylineSlidePositions(polyline) {
            const latlngs = polyline.getLatLngs();
            if (!latlngs.length) return [];
            const last = latlngs.length - 1;
            const seen = new Set();
            const positions = [];
            SPEED_SLIDE_FRACTIONS.forEach(fraction => {
                const index = Math.round(last * fraction);
                if (seen.has(index)) return;
                seen.add(index);
                positions.push(latlngs[index]);
            });
            return positions;
        }

        // ---- Mapillary : recherche d'une photo proche d'un panneau de vitesse ----
        const MAPILLARY_CFG = (window.APP_CONFIG && window.APP_CONFIG.mapillary) || {};
        const MAPILLARY_TOKEN = MAPILLARY_CFG.accessToken || '';
        const MAPILLARY_RADIUS_M = MAPILLARY_CFG.searchRadiusMeters || 50;
        const MAPILLARY_GREEN = '#05CB63';

        // Recherche la meilleure image Mapillary près d'un point via l'Image Radius Search
        // (API "nearby", avril 2026) : tri intégré proximité + récence + 360°.
        // Renvoie l'objet image (ou null si rien / pas de jeton).
        async function fetchMapillaryNearby(lat, lng) {
            if (!MAPILLARY_TOKEN) return null;
            // L'API plafonne le rayon à 50 m.
            const radius = Math.min(MAPILLARY_RADIUS_M, 50);
            const fields = 'id,thumb_1024_url,thumb_2048_url,captured_at,compass_angle,geometry';
            const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(MAPILLARY_TOKEN)}`
                + `&fields=${fields}&lat=${lat}&lng=${lng}&radius=${radius}&limit=1`;
            const resp = await fetch(url, { credentials: 'omit' });
            if (!resp.ok) throw new Error(`Mapillary HTTP ${resp.status}`);
            const data = await resp.json();
            const imgs = (data && data.data) || [];
            // La meilleure image est renvoyée en première position par l'API.
            return imgs.length ? imgs[0] : null;
        }

        // Construit le HTML complet du popup d'un panneau selon l'état.
        // On régénère le contenu entier (et non un sous-noeud) car Leaflet réinjecte
        // la chaîne d'origine à chaque popup.update(), ce qui écraserait une photo
        // posée via innerHTML.
        function speedSignPopupHtml(speed, img, state) {
            const kmh = speed.kmh;
            let body;
            if (state === 'loading') {
                body = `<div class="speed-sign-photo-msg">📷 Recherche d'une photo Mapillary…</div>`;
            } else if (!img || !img.thumb_1024_url) {
                body = `<div class="speed-sign-photo-msg">Pas encore de photo disponible sur Mapillary à proximité.</div>`;
            } else {
                const when = img.captured_at
                    ? new Date(img.captured_at).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short' })
                    : '';
                body = `
                    <a href="${(window.mapillaryPageUrl && window.mapillaryPageUrl(img.id)) || '#'}" target="_blank" rel="noopener noreferrer" class="speed-sign-photo-link">
                        <img class="speed-sign-photo-img" src="${img.thumb_1024_url}" alt="Photo Mapillary à proximité du panneau" loading="lazy">
                    </a>
                    <div class="speed-sign-photo-meta">Mapillary${when ? ' · ' + when : ''} · environnement proche</div>
                `;
            }
            const origin = speed.implicit
                ? `<div class="speed-sign-origin">Vitesse implicite · ${escapeHtml(speed.label)}<span>Aucun panneau <code>maxspeed</code> : le régime découle du type de voie.</span></div>`
                : '';
            return `
                <div class="route-popup speed-sign-popup">
                    <h3>Limitation ${kmh} km/h</h3>
                    ${origin}
                    <div class="speed-sign-photo">${body}</div>
                </div>
            `;
        }

        // --- Cache + file d'attente (concurrence limitée) pour les checks de proximité ---
        const mlyNearbyCache = new Map();   // clé coord -> image (ou null)
        const mlyCheckQueue = [];
        let mlyActiveChecks = 0;
        const MLY_MAX_CONCURRENCY = 5;

        function pumpMlyQueue() {
            while (mlyActiveChecks < MLY_MAX_CONCURRENCY && mlyCheckQueue.length) {
                const task = mlyCheckQueue.shift();
                mlyActiveChecks++;
                Promise.resolve(task()).finally(() => {
                    mlyActiveChecks--;
                    pumpMlyQueue();
                });
            }
        }

        // Vérifie (avec cache) la présence d'une image Mapillary à proximité immédiate
        // d'un point. Renvoie l'image (déjà la meilleure) ou null.
        function checkMapillaryNearby(lat, lng) {
            if (!MAPILLARY_TOKEN) return Promise.resolve(null);
            const key = `${lat.toFixed(4)}|${lng.toFixed(4)}`;
            if (mlyNearbyCache.has(key)) return Promise.resolve(mlyNearbyCache.get(key));
            return new Promise((resolve) => {
                mlyCheckQueue.push(() => fetchMapillaryNearby(lat, lng)
                    .then(img => { mlyNearbyCache.set(key, img || null); resolve(img || null); })
                    .catch(() => { mlyNearbyCache.set(key, null); resolve(null); }));
                pumpMlyQueue();
            });
        }

        // Résolution d'une image Mapillary désignée par son identifiant (tag OSM
        // `mapillary=*`) : contrairement à la recherche de proximité, elle montre
        // l'objet lui-même. Passe par la même file d'attente pour ne pas saturer l'API.
        const mlyByIdCache = new Map();

        function fetchMapillaryImageById(id) {
            if (!MAPILLARY_TOKEN || !id) return Promise.resolve(null);
            const key = String(id);
            if (mlyByIdCache.has(key)) return Promise.resolve(mlyByIdCache.get(key));
            return new Promise(resolve => {
                mlyCheckQueue.push(async () => {
                    try {
                        const url = `https://graph.mapillary.com/${encodeURIComponent(key)}`
                            + `?access_token=${encodeURIComponent(MAPILLARY_TOKEN)}`
                            + `&fields=id,thumb_1024_url,captured_at`;
                        const resp = await fetch(url, { credentials: 'omit' });
                        if (!resp.ok) throw new Error(`Mapillary HTTP ${resp.status}`);
                        const img = await resp.json();
                        const value = img && img.thumb_1024_url ? img : null;
                        mlyByIdCache.set(key, value);
                        resolve(value);
                    } catch (error) {
                        mlyByIdCache.set(key, null);
                        resolve(null);
                    }
                });
                pumpMlyQueue();
            });
        }

        // Exposé pour les couches définies hors de ce bloc DOMContentLoaded (ex. panneaux, aires).
        window.checkMapillaryNearby = checkMapillaryNearby;
        window.fetchMapillaryImageById = fetchMapillaryImageById;
        window.mapillaryPageUrl = mapillaryPageUrl;
        window.panoramaxPageUrl = panoramaxPageUrl;
        window.panoramaxImageUrl = panoramaxImageUrl;

        // Le cercle est pointillé quand la vitesse n'est pas signalée mais déduite
        // du régime : sur le terrain, il n'y a pas de panneau à cet endroit.
        function speedDivIcon(speed, hasMapillary) {
            const implicitClass = speed.implicit ? ' is-implicit' : '';
            return L.divIcon({
                html: `<div class="speed-picto${implicitClass}" style="border-color:${colorForSpeed(speed.kmh)};"
                            title="${speed.implicit ? `Vitesse implicite — ${speed.label}` : 'Limitation signalée'}">${speed.kmh}</div>`,
                className: 'speed-picto-wrapper' + (hasMapillary ? ' has-mapillary' : ''),
                iconSize: [34, 34],
                iconAnchor: [17, 17]
            });
        }

        // Round pictogram in French speed-limit sign style. Cliquable uniquement si une
        // photo Mapillary existe à proximité immédiate (liseret vert + popup photo).
        function makeSpeedPictoMarker(latlng, speed) {
            const marker = L.marker(latlng, {
                icon: speedDivIcon(speed, false),
                interactive: true,      // l'écoute clic est gérée par CSS pointer-events (gate)
                keyboard: false,
                riseOnHover: true,
                zIndexOffset: 400
            });
            marker.bindPopup(speedSignPopupHtml(speed, null, 'loading'), { minWidth: 220, maxWidth: 260 });

            // Gate de proximité : on n'active le panneau que si Mapillary couvre la zone.
            // Le contenu final (photo) est posé via setPopupContent pour survivre aux
            // popup.update() internes de Leaflet.
            checkMapillaryNearby(latlng.lat, latlng.lng).then(img => {
                if (img && img.thumb_1024_url) {
                    marker.setIcon(speedDivIcon(speed, true)); // liseret vert + clic activé (CSS)
                    marker.setPopupContent(speedSignPopupHtml(speed, img, 'ok'));
                }
            });
            return marker;
        }

        // --- Couche couverture Mapillary (traces des séquences, tuiles vectorielles) ---
        let mapillaryCoverageLayer = null;
        let mapillaryCoverageVisible = false;

        function getMapillaryCoverageLayer() {
            if (mapillaryCoverageLayer) return mapillaryCoverageLayer;
            if (!MAPILLARY_TOKEN || !window.L || !L.vectorGrid) return null;
            const url = `https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${encodeURIComponent(MAPILLARY_TOKEN)}`;
            mapillaryCoverageLayer = L.vectorGrid.protobuf(url, {
                rendererFactory: L.canvas.tile,
                interactive: false,
                attribution: '© Mapillary',
                minZoom: 0,
                maxNativeZoom: 14,
                vectorTileLayerStyles: {
                    // Traces des chemins parcourus (lignes) — le cœur de la couverture.
                    sequence: { weight: 2, color: MAPILLARY_GREEN, opacity: 0.75 },
                    // Agrégats basse altitude.
                    overview: () => ({ radius: 2, fill: true, fillColor: MAPILLARY_GREEN, fillOpacity: 0.55, stroke: false }),
                    // Points images au plus fort zoom.
                    image: () => ({ radius: 1.6, fill: true, fillColor: MAPILLARY_GREEN, fillOpacity: 0.5, stroke: false })
                }
            });
            return mapillaryCoverageLayer;
        }

        window.toggleMapillaryCoverage = function() {
            if (!MAPILLARY_TOKEN) {
                console.warn('Mapillary: aucun jeton configuré (js/config.js).');
                return;
            }
            const layer = getMapillaryCoverageLayer();
            if (!layer) {
                console.warn('Mapillary: Leaflet.VectorGrid indisponible.');
                return;
            }
            mapillaryCoverageVisible = !mapillaryCoverageVisible;
            if (mapillaryCoverageVisible) {
                layer.addTo(window.map);
            } else {
                window.map.removeLayer(layer);
            }
            setToolActive('mapillaryBtn', mapillaryCoverageVisible);
        };

        // --- Couche couverture Panoramax (séquences/photos, tuiles vectorielles MVT) ---
        // API publique sans jeton : /api/map/{z}/{x}/{y}.mvt — couches sequences (tous
        // zooms), pictures (>= 15) et grid (< 6, agrégat).
        let panoramaxCoverageLayer = null;
        let panoramaxCoverageVisible = false;
        const PANORAMAX_VIOLET = '#7C3AED';
        const PANORAMAX_TILES_URL = 'https://api.panoramax.xyz/api/map/{z}/{x}/{y}.mvt';

        function getPanoramaxCoverageLayer() {
            if (panoramaxCoverageLayer) return panoramaxCoverageLayer;
            if (!window.L || !L.vectorGrid) return null;
            panoramaxCoverageLayer = L.vectorGrid.protobuf(PANORAMAX_TILES_URL, {
                rendererFactory: L.canvas.tile,
                interactive: false,
                attribution: '© Panoramax',
                minZoom: 0,
                maxNativeZoom: 15,
                vectorTileLayerStyles: {
                    sequences: { weight: 2, color: PANORAMAX_VIOLET, opacity: 0.8 },
                    pictures: () => ({ radius: 1.8, fill: true, fillColor: PANORAMAX_VIOLET, fillOpacity: 0.6, stroke: false }),
                    grid: () => ({ radius: 3, fill: true, fillColor: PANORAMAX_VIOLET, fillOpacity: 0.45, stroke: false })
                }
            });
            return panoramaxCoverageLayer;
        }

        window.togglePanoramaxCoverage = function() {
            const layer = getPanoramaxCoverageLayer();
            if (!layer) {
                console.warn('Panoramax: Leaflet.VectorGrid indisponible.');
                return;
            }
            panoramaxCoverageVisible = !panoramaxCoverageVisible;
            if (panoramaxCoverageVisible) {
                layer.addTo(window.map);
            } else {
                window.map.removeLayer(layer);
            }
            setToolActive('panoramaxBtn', panoramaxCoverageVisible);
        };

        // Gabarits : l'étiquette est déportée hors de la chaussée et reliée à son
        // tronçon par un trait, sinon plusieurs restrictions portées par des
        // tronçons voisins se recouvrent sur la route elle-même.
        const GAUGE_LABEL_HEIGHT = 30;
        const GAUGE_LABEL_PAD = 44;        // icône + espacements + bordures
        const GAUGE_CHAR_WIDTH = 8.2;      // JetBrains Mono à la taille du picto
        const GAUGE_LEADER_STEPS = [30, 50, 72, 96];

        // Positions candidates, du plus lisible au moins : au-dessus d'abord,
        // l'étiquette masque alors moins le tracé.
        const GAUGE_DIRECTIONS = [
            [0, -1], [0.85, -0.85], [-0.85, -0.85], [1, 0], [-1, 0],
            [0.85, 0.85], [-0.85, 0.85], [0, 1]
        ];

        function gaugeLabelWidth(value) {
            return GAUGE_LABEL_PAD + String(value).length * GAUGE_CHAR_WIDTH;
        }

        function boxesOverlap(a, b) {
            return Math.abs(a.x - b.x) * 2 < a.w + b.w + 6
                && Math.abs(a.y - b.y) * 2 < a.h + b.h + 6;
        }

        // Cherche la première position libre autour de l'ancre ; à défaut, la plus
        // éloignée, pour que l'étiquette sorte au moins de la mêlée.
        function placeGaugeLabel(anchorPoint, size, occupied) {
            let fallback = null;
            for (const distance of GAUGE_LEADER_STEPS) {
                for (const [dx, dy] of GAUGE_DIRECTIONS) {
                    const candidate = {
                        x: anchorPoint.x + dx * (distance + size.w / 2),
                        y: anchorPoint.y + dy * (distance + size.h / 2),
                        w: size.w,
                        h: size.h
                    };
                    if (!occupied.some(box => boxesOverlap(candidate, box))) return candidate;
                    fallback = candidate;
                }
            }
            return fallback;
        }

        function makeRestrictionPictoMarker(latlng, entry, width, ctx) {
            const marker = L.marker(latlng, {
                icon: L.divIcon({
                    html: `<div class="restriction-picto" style="border-color:${entry.color};"><span class="restriction-picto-icon">${entry.icon}</span><span>${escapeHtml(String(entry.value))}</span></div>`,
                    className: 'restriction-picto-wrapper',
                    iconSize: [width, GAUGE_LABEL_HEIGHT],
                    iconAnchor: [width / 2, GAUGE_LABEL_HEIGHT / 2]
                }),
                riseOnHover: true,
                zIndexOffset: 380
            });
            marker.bindPopup(restrictionPopupHtml(entry, ctx, null, 'loading'), { minWidth: 230, maxWidth: 280 });
            // Comme pour les panneaux de vitesse, la photo n'arrive qu'après coup :
            // setPopupContent survit aux popup.update() internes de Leaflet.
            marker.on('popupopen', function onOpen() {
                marker.off('popupopen', onOpen);
                checkMapillaryNearby(ctx.anchor.lat, ctx.anchor.lng).then(img => {
                    marker.setPopupContent(restrictionPopupHtml(entry, ctx, img, 'done'));
                });
            });
            return marker;
        }

        // Normalize OSM value like "3.5", "4.0", "3.5 m" or "12 t" to compact string
        // without spaces or trailing zeros ("4.0m" → "4m", "3.50m" → "3.5m").
        function compactUnit(raw, unit) {
            if (raw === null || raw === undefined) return '';
            const trimmed = String(raw).trim();
            // If value already includes a unit, keep it but clean formatting.
            if (/[a-zA-Z]/.test(trimmed)) {
                const m = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z/]+)$/);
                if (m) {
                    const num = Number.parseFloat(m[1]);
                    return `${Number.isFinite(num) ? +num.toFixed(2) : m[1]}${m[2]}`;
                }
                return trimmed.replace(/\s+/g, '');
            }
            const num = Number.parseFloat(trimmed);
            const display = Number.isFinite(num) ? +num.toFixed(2) : trimmed;
            return `${display}${unit}`;
        }

        // Gabarits : chaque type est filtrable indépendamment depuis la légende,
        // au même titre que les tranches de vitesse.
        const RESTRICTION_TYPES = [
            { key: 'height', icon: '↕️', color: '#C0392B', name: 'Hauteur', unit: 'm', tags: ['maxheight'] },
            { key: 'weight', icon: '🚛', color: '#8E44AD', name: 'Poids', unit: 't', tags: ['maxweight', 'maxweightrating'] },
            { key: 'length', icon: '📏', color: '#E67E22', name: 'Longueur', unit: 'm', tags: ['maxlength'] },
            { key: 'width', icon: '↔️', color: '#16A085', name: 'Largeur', unit: 'm', tags: ['maxwidth'] }
        ];
        const RESTRICTION_EMPTY_VALUES = new Set(['no', 'default', 'none']);
        const restrictionVisibility = Object.fromEntries(RESTRICTION_TYPES.map(type => [type.key, true]));

        // Decide which restrictions to render for a given way (height, weight, length, width).
        // `includeHidden` sert au popup : la fiche récapitule tout le gabarit du
        // tronçon, y compris les types décochés dans la légende.
        function restrictionEntriesFromTags(tags, includeHidden) {
            const entries = [];
            RESTRICTION_TYPES.forEach(type => {
                if (!includeHidden && !restrictionVisibility[type.key]) return;
                const tag = type.tags.find(name => tags[name]);
                if (!tag) return;
                const raw = tags[tag];
                if (RESTRICTION_EMPTY_VALUES.has(raw)) return;
                const value = compactUnit(raw, type.unit);
                entries.push({
                    type: type.key,
                    icon: type.icon,
                    value,
                    color: type.color,
                    tag,
                    raw,
                    label: `${type.name} max ${value}`
                });
            });
            return entries;
        }

        // Fiche d'un gabarit : le tronçon porteur, l'ensemble de ses restrictions,
        // une photo Mapillary si la zone est couverte, et de quoi corriger dans OSM.
        function restrictionPopupHtml(entry, ctx, img, state) {
            const road = [ctx.ref, ctx.name].filter(Boolean).map(escapeHtml).join(' · ');
            const rows = (ctx.entries || []).map(other => `
                <div class="restriction-popup-row${other.type === entry.type ? ' is-current' : ''}">
                    <span class="restriction-popup-icon">${other.icon}</span>
                    <span class="restriction-popup-label">${escapeHtml(other.label)}</span>
                    <code class="restriction-popup-tag">${escapeHtml(other.tag)}=${escapeHtml(String(other.raw))}</code>
                </div>`).join('');

            let photo = '';
            if (state === 'loading') {
                photo = `<div class="speed-sign-photo-msg">📷 Recherche d'une photo Mapillary…</div>`;
            } else if (img && img.thumb_1024_url) {
                const when = img.captured_at
                    ? new Date(img.captured_at).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short' })
                    : '';
                photo = `
                    <a href="${(window.mapillaryPageUrl && window.mapillaryPageUrl(img.id)) || '#'}" target="_blank" rel="noopener noreferrer" class="speed-sign-photo-link">
                        <img class="speed-sign-photo-img" src="${img.thumb_1024_url}" alt="Photo Mapillary à proximité de la restriction">
                    </a>
                    <div class="speed-sign-photo-meta">Mapillary${when ? ' · ' + when : ''} · environnement proche</div>`;
            } else {
                photo = `<div class="speed-sign-photo-msg">Pas encore de photo disponible sur Mapillary à proximité.</div>`;
            }

            return `
                <div class="route-popup restriction-popup">
                    <h3>${entry.icon} ${escapeHtml(entry.label)}</h3>
                    ${road ? `<div class="restriction-popup-road">${road}</div>` : ''}
                    ${ctx.suffix ? `<div class="restriction-popup-note">Ouvrage${escapeHtml(ctx.suffix)}</div>` : ''}
                    <div class="restriction-popup-rows">${rows}</div>
                    <div class="speed-sign-photo">${photo}</div>
                    ${osmWayLinkHtml(ctx.wayId)}
                </div>`;
        }

        function osmWayLinkHtml(id) {
            if (!id) return '';
            return `<div class="node-osm-link"><span class="node-osm-label">OpenStreetMap</span>
                <a href="https://www.openstreetmap.org/way/${id}" target="_blank" rel="noopener noreferrer">voir</a>
                <span class="node-osm-sep">·</span>
                <a href="https://www.openstreetmap.org/edit?editor=id&way=${id}" target="_blank" rel="noopener noreferrer">compléter</a>
            </div>`;
        }

        // Affiche les pictos vitesse / restrictions visibles dans la vue actuelle.
        // En dessous de LIMITATIONS_SIGN_ZOOM, seul le dégradé de vitesse porté par
        // les tronçons reste affiché : aucun pictogramme n'est posé.
        function renderPictograms() {
            speedPictoLayer.clearLayers();
            restrictionLayer.clearLayers();
            if (!limitationsMode) return;
            if (window.map.getZoom() < LIMITATIONS_SIGN_ZOOM) return;

            const bounds = window.map.getBounds();
            const speedKeysSeen = new Set();
            const restrictionKeysSeen = new Set();
            const speedItems = [];
            const pendingGauges = [];
            // Les panneaux de vitesse sont posés en premier et servent d'obstacles :
            // c'est de leur empilement avec les gabarits que venait l'illisibilité.
            const occupied = [];

            Object.keys(window.routePolylines).forEach(ref => {
                window.routePolylines[ref].forEach(polyline => {
                    const tags = polyline.options.wayTags || {};
                    const mid = polylineMidLatLng(polyline);
                    if (!mid || !bounds.contains(mid)) return;

                    // Vitesse (dédupliquée par ref + valeur + ~1 km).
                    const speed = resolveWaySpeed(tags);
                    if (speed.kmh !== null && isSpeedStepVisible(speedStepFor(speed.kmh))) {
                        const key = `${ref}|${speed.kmh}|${mid.lat.toFixed(2)}|${mid.lng.toFixed(2)}`;
                        if (!speedKeysSeen.has(key)) {
                            speedKeysSeen.add(key);
                            speedItems.push({ ref, speed, polyline, mid });
                        }
                    }

                    // Restrictions (dédupliquées par type + valeur + ~1 km), comme la vitesse,
                    // pour qu'un même panneau porté par plusieurs tronçons ne s'affiche qu'une fois.
                    const isBridge = tags.bridge && tags.bridge !== 'no';
                    const isTunnel = tags.tunnel === 'yes';
                    const visible = restrictionEntriesFromTags(tags);
                    if (visible.length) {
                        const anchor = L.latLng(mid.lat, mid.lng);
                        const ctx = {
                            ref,
                            name: tags.name || '',
                            wayId: polyline.options.wayId,
                            suffix: isBridge ? ' (pont)' : isTunnel ? ' (tunnel)' : '',
                            entries: restrictionEntriesFromTags(tags, true),
                            anchor
                        };
                        visible.slice(0, 2).forEach(entry => {
                            const key = `${entry.label}|${mid.lat.toFixed(2)}|${mid.lng.toFixed(2)}`;
                            if (restrictionKeysSeen.has(key)) return;
                            restrictionKeysSeen.add(key);
                            pendingGauges.push({ entry, anchor, ctx });
                        });
                    }
                });
            });

            const speedBoxAt = (latlng, kmh) => {
                const point = window.map.latLngToContainerPoint(latlng);
                return { x: point.x, y: point.y, w: 34, h: 34, kmh };
            };
            const placeSpeed = (item, at) => {
                makeSpeedPictoMarker(L.latLng(at.lat, at.lng), item.speed).addTo(speedPictoLayer);
                occupied.push(speedBoxAt(at, item.speed.kmh));
            };

            // Premier temps : chaque panneau cherche une place libre en glissant le
            // long de son propre tronçon. Les tronçons trop courts pour la vue en
            // ressortent sans emplacement.
            const shownSpeeds = new Set();
            const homeless = new Map();
            speedItems.forEach(item => {
                const shownKey = `${item.ref}|${item.speed.kmh}`;
                for (const candidate of polylineSlidePositions(item.polyline)) {
                    if (!bounds.contains(candidate)) continue;
                    if (occupied.some(other => boxesOverlap(speedBoxAt(candidate, item.speed.kmh), other))) continue;
                    placeSpeed(item, candidate);
                    shownSpeeds.add(shownKey);
                    return;
                }
                if (!homeless.has(shownKey)) homeless.set(shownKey, item);
            });

            // Second temps : une limite qui n'a trouvé aucune place nulle part est
            // tout de même posée une fois, quitte à chevaucher — sauf si un panneau
            // identique occupe déjà l'endroit, auquel cas ce serait une répétition.
            homeless.forEach((item, shownKey) => {
                if (shownSpeeds.has(shownKey)) return;
                const box = speedBoxAt(item.mid, item.speed.kmh);
                if (occupied.some(other => other.kmh === item.speed.kmh && boxesOverlap(box, other))) return;
                placeSpeed(item, item.mid);
                shownSpeeds.add(shownKey);
            });

            pendingGauges.forEach(({ entry, anchor, ctx }) => {
                const anchorPoint = window.map.latLngToContainerPoint(anchor);
                const size = { w: gaugeLabelWidth(entry.value), h: GAUGE_LABEL_HEIGHT };
                const box = placeGaugeLabel(anchorPoint, size, occupied);
                occupied.push(box);

                const labelLatLng = window.map.containerPointToLatLng([box.x, box.y]);
                L.polyline([anchor, labelLatLng], {
                    color: entry.color,
                    weight: 1.5,
                    opacity: 0.8,
                    interactive: false
                }).addTo(restrictionLayer);
                L.circleMarker(anchor, {
                    radius: 3,
                    color: entry.color,
                    weight: 1.5,
                    fillColor: '#ffffff',
                    fillOpacity: 1,
                    interactive: false
                }).addTo(restrictionLayer);

                const marker = makeRestrictionPictoMarker(labelLatLng, entry, size.w, ctx);
                marker.bindTooltip(`${entry.label}${ctx.suffix}`);
                marker.addTo(restrictionLayer);
            });
        }

        function updateLimitationsLegend() {
            const container = document.getElementById('limitationsLegend');
            if (!container) return;
            if (!limitationsMode) {
                container.style.display = 'none';
                return;
            }
            container.style.display = 'block';

            const stepButton = (key, color, label, title) => {
                const active = isSpeedStepVisible(key);
                return `<button type="button" class="limitations-legend-step${active ? '' : ' is-off'}"
                    data-speed-step="${key}" aria-pressed="${active ? 'true' : 'false'}"
                    title="${title} — cliquer pour ${active ? 'masquer' : 'afficher'}"
                    style="background:${color};">${label}</button>`;
            };

            const scaleHtml = SPEED_COLOR_SCALE.map((step, index) =>
                stepButton(String(index), step.color, step.label, `Limite ${step.label} km/h`)
            ).join('');

            const gaugesHtml = RESTRICTION_TYPES.map(type => {
                const active = restrictionVisibility[type.key];
                return `<button type="button" class="limitations-legend-gauge${active ? '' : ' is-off'}"
                    data-restriction-type="${type.key}" aria-pressed="${active ? 'true' : 'false'}"
                    title="${type.name} maximale — cliquer pour ${active ? 'masquer' : 'afficher'}"
                    style="border-color:${type.color};">
                    <span class="limitations-legend-gauge-icon">${type.icon}</span>${type.name}
                </button>`;
            }).join('');

            // Bascule globale du bloc : décocher les vitesses d'un geste est le
            // seul moyen praticable de se concentrer sur les seuls gabarits.
            const bulkButton = (scope, anyOn) => `<button type="button" class="limitations-legend-bulk"
                data-bulk-scope="${scope}" title="${anyOn ? 'Tout décocher' : 'Tout cocher'}">${anyOn ? 'Aucun' : 'Tous'}</button>`;

            const anySpeedOn = speedRangeVisibility.some(Boolean) || speedUnknownVisible;
            const anyGaugeOn = RESTRICTION_TYPES.some(type => restrictionVisibility[type.key]);

            container.innerHTML = `
                <div class="limitations-legend-group">Limites de vitesse (km/h)${bulkButton('speed', anySpeedOn)}</div>
                <div class="limitations-legend-scale">${scaleHtml}</div>
                <div class="limitations-legend-unknown">
                    ${stepButton('unknown', SPEED_UNKNOWN_COLOR, '?', 'Vitesse inconnue')}
                    <span>Inconnue (<code>maxspeed</code> absent)</span>
                </div>
                <div class="limitations-legend-implicit">
                    <span class="limitations-legend-implicit-icon">50</span>
                    <span>Cercle pointillé : vitesse <strong>implicite</strong> (<code>maxspeed:type</code>) — 50 en agglomération, 80 hors agglomération</span>
                </div>
                <div class="limitations-legend-group">Gabarits${bulkButton('gauge', anyGaugeOn)}</div>
                <div class="limitations-legend-gauges">${gaugesHtml}</div>
                <div class="limitations-legend-hint"><code>maxheight</code> · <code>maxweight</code> · <code>maxlength</code> · <code>maxwidth</code> — panneaux au zoom ≥ ${LIMITATIONS_SIGN_ZOOM}</div>
            `;
        }

        // « Aucun » tant qu'il reste une case cochée, « Tous » ensuite : un même
        // bouton sert à vider le bloc puis à le remplir de nouveau.
        function toggleSpeedBulk(scope) {
            if (!limitationsMode) return;
            if (scope === 'speed') {
                const next = !(speedRangeVisibility.some(Boolean) || speedUnknownVisible);
                speedRangeVisibility.fill(next);
                speedUnknownVisible = next;
                applySpeedGradient();
            } else {
                const next = !RESTRICTION_TYPES.some(type => restrictionVisibility[type.key]);
                RESTRICTION_TYPES.forEach(type => { restrictionVisibility[type.key] = next; });
            }
            renderPictograms();
            updateLimitationsLegend();
        }

        // Une tranche de vitesse se filtre depuis sa case de légende : les tronçons
        // concernés s'estompent et leurs panneaux disparaissent, ce qui permet
        // d'isoler visuellement un régime de vitesse sur le réseau.
        function toggleSpeedStep(rawKey) {
            if (!limitationsMode) return;
            if (rawKey === 'unknown') {
                speedUnknownVisible = !speedUnknownVisible;
            } else {
                const index = Number.parseInt(rawKey, 10);
                if (!Number.isInteger(index) || index < 0 || index >= speedRangeVisibility.length) return;
                speedRangeVisibility[index] = !speedRangeVisibility[index];
            }
            applySpeedGradient();
            renderPictograms();
            updateLimitationsLegend();
        }

        // Les gabarits ne touchent que les pictogrammes : le dégradé des tronçons
        // reste celui de la vitesse, il n'a pas à être recalculé.
        function toggleRestrictionType(key) {
            if (!limitationsMode || !(key in restrictionVisibility)) return;
            restrictionVisibility[key] = !restrictionVisibility[key];
            renderPictograms();
            updateLimitationsLegend();
        }

        document.getElementById('limitationsLegend')?.addEventListener('click', event => {
            const bulkButton = event.target.closest('[data-bulk-scope]');
            if (bulkButton) {
                toggleSpeedBulk(bulkButton.dataset.bulkScope);
                return;
            }
            const speedButton = event.target.closest('[data-speed-step]');
            if (speedButton) {
                toggleSpeedStep(speedButton.dataset.speedStep);
                return;
            }
            const gaugeButton = event.target.closest('[data-restriction-type]');
            if (gaugeButton) toggleRestrictionType(gaugeButton.dataset.restrictionType);
        });

        function setLimitationsButtonActive(active) {
            setToolActive('limitsBtn', active);
        }

        window.toggleLimitationsMode = function() {
            limitationsMode = !limitationsMode;
            console.log(`🚦 Mode Limitations : ${limitationsMode ? 'ON' : 'OFF'}`);

            if (limitationsMode) {
                applySpeedGradient();
                speedPictoLayer.addTo(window.map);
                restrictionLayer.addTo(window.map);
                renderPictograms();
                if (!limitationsZoomHandler) {
                    // Ouvrir une fiche recentre la carte : le `moveend` qui suit
                    // détruirait le marqueur porteur et refermerait le popup dans
                    // la foulée. On rattrape la vue à la fermeture.
                    limitationsZoomHandler = () => {
                        if (layerHasOpenPopup(restrictionLayer) || layerHasOpenPopup(speedPictoLayer)) return;
                        renderPictograms();
                    };
                    window.map.on('zoomend moveend', limitationsZoomHandler);
                    limitationsPopupHandler = () => renderPictograms();
                    window.map.on('popupclose', limitationsPopupHandler);
                }
                setLimitationsButtonActive(true);
            } else {
                restoreHierarchyStyles();
                speedPictoLayer.clearLayers();
                restrictionLayer.clearLayers();
                window.map.removeLayer(speedPictoLayer);
                window.map.removeLayer(restrictionLayer);
                if (limitationsZoomHandler) {
                    window.map.off('zoomend moveend', limitationsZoomHandler);
                    limitationsZoomHandler = null;
                }
                if (limitationsPopupHandler) {
                    window.map.off('popupclose', limitationsPopupHandler);
                    limitationsPopupHandler = null;
                }
                setLimitationsButtonActive(false);
            }
            updateLimitationsLegend();
            syncLegendChrome();
        };

        // ========== DASHBOARD DATA REFRESH ==========

        function hierarchyForRef(ref) {
            const refClean = String(ref).replace(/\s+/g, '');
            if (routeClassification.regional.some(r => refClean.includes(r.replace('D', '')))) return 'regional';
            if (routeClassification.territorial.some(r => refClean.includes(r.replace('D', '')))) return 'territorial';
            return 'local';
        }

        function computeRouteQualityFlags(routeWays) {
            const relationWithWikidata = routeWays.find(way =>
                way.relationTags && way.relationTags.wikidata
            );
            let hasWikidata = Boolean(relationWithWikidata);
            if (!hasWikidata) {
                const totalWays = routeWays.length;
                const waysWithWikidata = routeWays.filter(way => way.tags && way.tags.wikidata).length;
                hasWikidata = waysWithWikidata > 0 && (waysWithWikidata / totalWays) >= 0.8;
            }
            const hasRelation = routeWays.some(way => way.hasRelation === true || way.relationId);
            return { hasWikidata, hasRelation };
        }

        function formatMjaRange(mjaValues) {
            if (!mjaValues.length) return null;
            const min = Math.min(...mjaValues);
            const max = Math.max(...mjaValues);
            const fmt = v => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
            return `${fmt(min)} – ${fmt(max)} véh/j`;
        }

        function computeNetworkMetricsFromGeoJson(data) {
            const ways = (data.features || []).map(geoJsonLineFeatureToWay).filter(Boolean);
            const routesByRef = {};
            ways.forEach(way => {
                const ref = way.tags?.ref?.replace(/\s+/g, '').replace(/^D/, 'D');
                if (!ref) return;
                if (!routesByRef[ref]) routesByRef[ref] = [];
                routesByRef[ref].push(way);
            });

            const hierarchy = { regional: 0, territorial: 0, local: 0 };
            let totalKm = 0;
            let bridges = 0;
            let tunnels = 0;
            let totalSegments = 0;
            let withWikidata = 0;
            let withRelation = 0;
            const refs = Object.keys(routesByRef);

            refs.forEach(ref => {
                hierarchy[hierarchyForRef(ref)]++;
                const routeWays = routesByRef[ref];
                const quality = computeRouteQualityFlags(routeWays);
                if (quality.hasWikidata) withWikidata++;
                if (quality.hasRelation) withRelation++;

                routeWays.forEach(way => {
                    totalSegments++;
                    if (way.geometry?.length) totalKm += wayLengthKmFromGeometry(way.geometry);
                    const tags = way.tags || {};
                    if (tags.bridge && tags.bridge !== 'no') bridges++;
                    if (tags.tunnel === 'yes') tunnels++;
                });
            });

            return {
                network: { refs: refs.length, lengthKm: totalKm, bridges, tunnels },
                hierarchy,
                quality: {
                    wikidataPct: refs.length ? Math.round((withWikidata / refs.length) * 100) : 0,
                    relationPct: refs.length ? Math.round((withRelation / refs.length) * 100) : 0,
                    segments: totalSegments
                }
            };
        }

        function computeTrafficMetricsFromGeoJson(geojsonData) {
            const trafficCounts = { high: 0, medium: 0, low: 0 };
            const mjaValues = [];
            const latestDataByStation = {};

            (geojsonData.features || []).forEach(feature => {
                const props = feature.properties || {};
                const stationId = props.section_compteur ?? props.section_co ?? props.identifian ?? props.id_station ?? props.id;
                const year = Number.parseInt(props.annee ?? props.year ?? props.an, 10);
                if (!stationId || !Number.isFinite(year)) return;
                if (!latestDataByStation[stationId] || year > latestDataByStation[stationId].year) {
                    latestDataByStation[stationId] = { feature, year };
                }
            });

            Object.values(latestDataByStation).forEach(({ feature }) => {
                const props = feature.properties || {};
                const lat = props.latitude || feature.geometry?.coordinates?.[1];
                const lon = props.longitude || feature.geometry?.coordinates?.[0];
                if (!lat || !lon) return;

                const mja = Number(props.mja_tv ?? props.mja ?? props.mja_jour ?? 0);
                if (mja >= 20000) trafficCounts.high++;
                else if (mja >= 5000) trafficCounts.medium++;
                else trafficCounts.low++;
                if (Number.isFinite(mja) && mja > 0) mjaValues.push(mja);
            });

            const totalStations = trafficCounts.high + trafficCounts.medium + trafficCounts.low;
            const sourceYears = formatYearRange(collectYears(geojsonData.features || [], ['annee', 'year', 'an']));

            return {
                traffic: {
                    stations: totalStations,
                    high: trafficCounts.high,
                    medium: trafficCounts.medium,
                    low: trafficCounts.low,
                    mjaRange: formatMjaRange(mjaValues)
                },
                vintages: {
                    traffic: sourceYears
                        ? `Dernière année par station · ${sourceYears}`
                        : 'Dernière année par station'
                }
            };
        }

        // Le fichier BAAC couvre plusieurs années : les totaux en sont la somme,
        // et l'étiquette doit le dire. Le dernier millésime est isolé à côté,
        // sans quoi on ne saurait pas si le chiffre parle d'une année ou de six.
        function accidentVintageLabel(min, max) {
            if (!Number.isFinite(min) || !Number.isFinite(max)) return 'BAAC';
            return min === max ? `Millésime ${max} · BAAC` : `Synthèse ${min}–${max} · BAAC`;
        }

        function latestYearFromCounts(perYear) {
            const years = Object.keys(perYear).map(Number).filter(Number.isFinite);
            if (!years.length) return { latestYear: null, latestTotal: null };
            const latestYear = Math.max(...years);
            return { latestYear, latestTotal: perYear[latestYear] };
        }

        function computeAccidentsMetricsFromGeoJson(data) {
            const counts = { fatal: 0, hospitalized: 0, light: 0 };
            const perYear = {};
            (data.features || []).forEach(feature => {
                const props = feature.properties || {};
                const gravite = props.gravite;
                if (gravite === 'mortel') counts.fatal++;
                else if (gravite === 'grave') counts.hospitalized++;
                else counts.light++;

                const year = Number(props.annee);
                if (Number.isFinite(year)) perYear[year] = (perYear[year] || 0) + 1;
            });

            const years = Object.keys(perYear).map(Number).filter(Number.isFinite);
            const { latestYear, latestTotal } = latestYearFromCounts(perYear);
            return {
                accidents: {
                    total: counts.fatal + counts.hospitalized + counts.light,
                    fatal: counts.fatal,
                    hospitalized: counts.hospitalized,
                    light: counts.light,
                    latestYear,
                    latestTotal
                },
                vintages: {
                    accidents: years.length
                        ? accidentVintageLabel(Math.min(...years), Math.max(...years))
                        : 'BAAC'
                }
            };
        }

        function computeBisonMetricsFromGeoJson(data) {
            const vaucluseBbox = { minLat: 43.6, maxLat: 44.5, minLon: 4.6, maxLon: 5.8 };
            const eventsCount = { travaux: 0, bouchons: 0, accidents: 0, autres: 0 };

            (data.features || []).forEach(feature => {
                const geom = feature.geometry;
                const props = feature.properties || {};
                if (!geom?.coordinates) return;

                let lat;
                let lon;
                if (geom.type === 'Point') {
                    lon = geom.coordinates[0];
                    lat = geom.coordinates[1];
                } else if (geom.type === 'LineString') {
                    const midIndex = Math.floor(geom.coordinates.length / 2);
                    lon = geom.coordinates[midIndex][0];
                    lat = geom.coordinates[midIndex][1];
                } else {
                    return;
                }

                if (lat < vaucluseBbox.minLat || lat > vaucluseBbox.maxLat
                    || lon < vaucluseBbox.minLon || lon > vaucluseBbox.maxLon) {
                    return;
                }

                const eventType = props.event_type || props.type || 'autre';
                if (eventType.includes('roadwork') || eventType.includes('travaux')) eventsCount.travaux++;
                else if (eventType.includes('congestion') || eventType.includes('bouchon')) eventsCount.bouchons++;
                else if (eventType.includes('accident')) eventsCount.accidents++;
                else eventsCount.autres++;
            });

            const totalEvents = eventsCount.travaux + eventsCount.bouchons + eventsCount.accidents + eventsCount.autres;
            return {
                bisonFute: {
                    total: totalEvents,
                    travaux: eventsCount.travaux,
                    bouchons: eventsCount.bouchons,
                    accidents: eventsCount.accidents
                },
                vintages: {
                    bisonFute: formatDashboardCacheVintage(
                        data._cache?.generated_at,
                        'Cache 3 h · Info Routière'
                    ) || 'Cache 3 h · Info Routière'
                }
            };
        }

        function computeBicycleMetricsFromGeoJson(data) {
            const bicycleWays = (data.features || []).map(geoJsonLineFeatureToWay).filter(Boolean);
            const relationIdToRef = buildBicycleRelationIdToRef(bicycleWays);
            const stats = computeBicycleStatsFromWays(bicycleWays, relationIdToRef);

            return {
                bicycle: {
                    structurantesKm: stats.structurantesKm,
                    structurantesSegments: stats.structurantesSegments,
                    localKm: stats.localKm,
                    localSegments: stats.localSegments
                }
            };
        }

        function computeConstructionMetricsFromGeoJson(data) {
            let constructionCount = 0;
            let proposedCount = 0;

            (data.features || []).forEach(feature => {
                const way = geoJsonLineFeatureToWay(feature);
                if (!way?.geometry?.length) return;
                const status = classifyConstructionWay(way.tags || {});
                if (status === 'construction') constructionCount++;
                else if (status === 'proposed') proposedCount++;
            });

            return {
                construction: { construction: constructionCount, proposed: proposedCount },
                vintages: {
                    osm: formatDashboardCacheVintage(data._cache?.generated_at, 'Cache OSM')
                }
            };
        }

        async function fetchTrafficGeoJsonForDashboard() {
            try {
                return await window.InforouteApi.fetchGeoJson('traffic-counting');
            } catch {
                return window.InforouteApi.fetchGeoJson('traffic-counting-demo');
            }
        }

        let dashboardRefreshPromise = null;

        window.refreshDashboardData = async function refreshDashboardData(options = {}) {
            const forceRefresh = options.force === true;

            if (!forceRefresh && typeof window.isDashboardDataCached === 'function' && window.isDashboardDataCached()) {
                return;
            }

            if (typeof window.resetDashboardMetrics === 'function') {
                window.resetDashboardMetrics();
            }
            if (typeof window.clearDashboardCache === 'function') {
                window.clearDashboardCache();
            }

            if (dashboardRefreshPromise) return dashboardRefreshPromise;

            window.dashboardRefreshInProgress = true;

            dashboardRefreshPromise = (async () => {
                try {
                    const sourceLabels = [
                        'departmental-roads',
                        'traffic-counting',
                        'accidents',
                        'road-events',
                        'bicycle-routes',
                        'construction-roads'
                    ];
                    const [
                        roadsResult,
                        trafficResult,
                        accidentsResult,
                        eventsResult,
                        bicycleResult,
                        constructionResult
                    ] = await Promise.allSettled([
                        window.InforouteApi.fetchGeoJson('departmental-roads'),
                        fetchTrafficGeoJsonForDashboard(),
                        window.InforouteApi.fetchGeoJson('accidents'),
                        window.InforouteApi.fetchGeoJson('road-events'),
                        window.InforouteApi.fetchGeoJson('bicycle-routes'),
                        window.InforouteApi.fetchGeoJson('construction-roads')
                    ]);

                    [
                        roadsResult,
                        trafficResult,
                        accidentsResult,
                        eventsResult,
                        bicycleResult,
                        constructionResult
                    ].forEach((result, index) => {
                        if (result.status === 'rejected') {
                            console.warn(
                                `Tableau de bord — source indisponible (${sourceLabels[index]}):`,
                                result.reason?.message || result.reason
                            );
                        }
                    });

                    const patch = { vintages: {} };

                    if (roadsResult.status === 'fulfilled') {
                        Object.assign(patch, computeNetworkMetricsFromGeoJson(roadsResult.value));
                        if (roadsResult.value._cache?.generated_at) {
                            patch.vintages.osm = formatDashboardCacheVintage(
                                roadsResult.value._cache.generated_at,
                                'Cache OSM'
                            );
                        }
                    }

                    if (trafficResult.status === 'fulfilled') {
                        const trafficPatch = computeTrafficMetricsFromGeoJson(trafficResult.value);
                        patch.traffic = trafficPatch.traffic;
                        Object.assign(patch.vintages, trafficPatch.vintages);
                    }

                    if (accidentsResult.status === 'fulfilled') {
                        const accidentsPatch = computeAccidentsMetricsFromGeoJson(accidentsResult.value);
                        patch.accidents = accidentsPatch.accidents;
                        Object.assign(patch.vintages, accidentsPatch.vintages);
                    }

                    if (eventsResult.status === 'fulfilled') {
                        const bisonPatch = computeBisonMetricsFromGeoJson(eventsResult.value);
                        patch.bisonFute = bisonPatch.bisonFute;
                        Object.assign(patch.vintages, bisonPatch.vintages);
                    }

                    if (bicycleResult.status === 'fulfilled') {
                        patch.bicycle = computeBicycleMetricsFromGeoJson(bicycleResult.value).bicycle;
                    }

                    if (constructionResult.status === 'fulfilled') {
                        const constructionPatch = computeConstructionMetricsFromGeoJson(constructionResult.value);
                        patch.construction = constructionPatch.construction;
                        if (!patch.vintages.osm) {
                            Object.assign(patch.vintages, constructionPatch.vintages);
                        }
                    }

                    window.dashboardRefreshInProgress = false;

                    const fetchResults = [
                        roadsResult,
                        trafficResult,
                        accidentsResult,
                        eventsResult,
                        bicycleResult,
                        constructionResult
                    ];
                    const allSourcesOk = fetchResults.every(result => result.status === 'fulfilled');
                    const mergedMetrics = {
                        network: null,
                        hierarchy: null,
                        traffic: null,
                        accidents: null,
                        bisonFute: null,
                        bicycle: null,
                        construction: null,
                        quality: null,
                        vintages: {},
                        ...patch
                    };
                    const allFieldsOk = typeof window.areAllDashboardFieldsPopulated === 'function'
                        && window.areAllDashboardFieldsPopulated(mergedMetrics);

                    if (allSourcesOk && allFieldsOk) {
                        if (typeof window.applyDashboardMetrics === 'function') {
                            window.applyDashboardMetrics(patch);
                        }
                        if (typeof window.markDashboardCacheReady === 'function') {
                            window.markDashboardCacheReady();
                        }
                    } else {
                        if (typeof window.clearDashboardCache === 'function') {
                            window.clearDashboardCache();
                        }
                        const failedSources = sourceLabels.filter((_, i) => fetchResults[i].status === 'rejected');
                        const detail = failedSources.length
                            ? ` Sources en échec : ${failedSources.join(', ')}.`
                            : '';
                        if (typeof window.showDashboardLoadError === 'function') {
                            window.showDashboardLoadError(
                                `Chargement incomplet.${detail} Réessayez dans un instant.`
                            );
                        }
                    }
                } catch (error) {
                    console.error('Erreur lors du rafraîchissement du tableau de bord:', error);
                    window.dashboardRefreshInProgress = false;
                    if (typeof window.clearDashboardCache === 'function') {
                        window.clearDashboardCache();
                    }
                    if (typeof window.showDashboardLoadError === 'function') {
                        window.showDashboardLoadError('Erreur lors du chargement des indicateurs.');
                    }
                } finally {
                    dashboardRefreshPromise = null;
                }
            })();

            return dashboardRefreshPromise;
        };

        }); // Fin DOMContentLoaded
    
