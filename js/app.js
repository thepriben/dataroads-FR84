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
                intervalMs: 3.5 * 24 * 60 * 60 * 1000
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
            } else if (scheduleKey === 'external') lines.push('Toutes les 3 h · xx:23 UTC');

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
            if (config.cron) {
                const next = nextCronUtc(config.cron);
                if (next) {
                    nextText = ` • prochain ${formatRelativeDuration(next.getTime() - Date.now(), { future: true })}`;
                }
            } else if (config.intervalMs && generatedAtMs) {
                const nextMs = generatedAtMs + config.intervalMs;
                if (nextMs > Date.now()) {
                    nextText = ` • prochain ${formatRelativeDuration(nextMs - Date.now(), { future: true })}`;
                }
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
                document.querySelectorAll('.legend-family').forEach(refreshFamilyMeta);
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

        function syncLegendChrome() {
            syncFreshnessBadgeVisibility();
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
                        const limitationsLegend = document.getElementById('limitationsLegend');
                        if (limitationsLegend && limitationsLegend.style.display !== 'none') {
                            ensureLayerToggle(limitationsMode, window.toggleLimitationsMode);
                        }
                    } else {
                        ensureLayerOff(constructionVisible, window.toggleConstruction);
                        ensureLayerOff(bicycleVisible, window.toggleBicycleRoutes);
                        ensureLayerOff(citiesVisible, window.toggleCities);
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
                        ensureLayerToggle(sensitiveZonesVisible, window.toggleSensitiveZones);
                        ensureLayerToggle(inaturalistSensitivesVisible, window.toggleInaturalistSensitives);
                    } else {
                        ensureLayerOff(bridgeVisible, window.toggleBridges);
                        ensureLayerOff(sensitiveZonesVisible, window.toggleSensitiveZones);
                        ensureLayerOff(inaturalistSensitivesVisible, window.toggleInaturalistSensitives);
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
                const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, event.clientX - rect.left));
                pendingWidth = next;
                mainContent.style.setProperty('--sidebar-width', `${next}px`);
            };

            const onPointerUp = () => {
                if (!dragging) return;
                dragging = false;
                document.body.classList.remove('is-resizing');
                resizer.classList.remove('is-dragging');
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                if (pendingWidth != null) {
                    try { localStorage.setItem('sidebarWidth', String(Math.round(pendingWidth))); } catch (_) {}
                }
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

            // Double-click: reset to default width
            resizer.addEventListener('dblclick', () => {
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

        let wazeLayer = null;
        let trafficMarkers = [];
        let trafficVisible = false;
        let accidentMarkers = [];
        let accidentsVisible = false;
        let convoiMode = false;
        let constructionPolylines = [];
        let constructionVisible = false;
        let bicyclePolylines = [];
        let bicycleVisible = false;
        let bridgeGeometryLayerGroup = null;
        let bridgeGroupMarkerLayerGroup = null;
        let bridgePhotoLayerGroup = null;
        let bridgeDataLoaded = false;
        let bridgeLoadPromise = null;
        let bridgeVisible = false;
        let sensitiveZonesLayer = null;
        let sensitiveZonesVisible = false;
        let sensitiveZonesLoaded = false;
        let inaturalistSensitiveLayerGroup = null;
        let inaturalistSensitiveMarkers = [];
        let inaturalistSensitivesVisible = false;
        let inaturalistSensitivesLoaded = false;
        let bridgeGroups = [];
        let bridgePhotoMarkers = [];
        let bridgeGroupById = new Map();
        let bridgeFeatureInfoById = new Map();
        let bridgeFeatureLayersById = new Map();
        let activeBridgeGroupId = null;
        let bridgeMapChangeHandler = null;
        const BRIDGE_PHOTO_MIN_ZOOM = 16;
        const BRIDGE_SCHEMATIC_MIN_ZOOM = 16;
        const BRIDGE_GEOMETRY_MIN_ZOOM = 14;
        const BRIDGE_PHOTO_OUTSIDE_BASE_PX = 34;
        const BRIDGE_PHOTO_OUTSIDE_RING_PX = 15;
        const bridgePhotoProviderVisibility = {
            panoramax: true,
            mapillary: true
        };

        function bridgeProviderLabel(provider) {
            return provider === 'panoramax' ? 'Panoramax' : 'Mapillary';
        }
        let bisonFuteMarkers = [];
        let bisonFuteVisible = false;
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

        let suppressAppUrlSync = false;
        let appUrlSyncTimer = null;
        let appUrlStateApplied = false;
        let appUrlLayersPending = null;
        let appUrlFamiliesPending = null;

        function initAppUrlStateFromLocation() {
            const state = parseAppUrlState();
            appUrlLayersPending = null;
            appUrlFamiliesPending = null;
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
            if (sensitiveZonesVisible) active.push('ens');
            if (inaturalistSensitivesVisible) active.push('inat');
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
            appUrlSyncTimer = setTimeout(syncAppUrlState, 350);
        }

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

        function applyAppUrlLayerKey(key, wanted) {
            const desired = wanted.has(key);
            switch (key) {
                case 'hr':
                case 'ht':
                case 'hl':
                    return true;
                case 'construction':
                    setBooleanLayerIfNeeded(constructionVisible, desired, window.toggleConstruction);
                    return !desired || constructionPolylines.length > 0;
                case 'bicycle':
                    setBooleanLayerIfNeeded(bicycleVisible, desired, window.toggleBicycleRoutes);
                    return !desired || bicyclePolylines.length > 0;
                case 'cities':
                    setBooleanLayerIfNeeded(citiesVisible, desired, window.toggleCities);
                    return true;
                case 'limits':
                    setBooleanLayerIfNeeded(limitationsMode, desired, window.toggleLimitationsMode);
                    return true;
                case 'accidents':
                    setBooleanLayerIfNeeded(accidentsVisible, desired, window.toggleAccidents);
                    return !desired || accidentMarkers.length > 0;
                case 'traffic':
                case 'waze':
                    setBooleanLayerIfNeeded(trafficVisible, desired, window.toggleTraffic);
                    return !desired || trafficMarkers.length > 0;
                case 'weather':
                    setBooleanLayerIfNeeded(weatherStationsVisible, desired, window.toggleWeatherStations);
                    return true;
                case 'bison':
                    setBooleanLayerIfNeeded(bisonFuteVisible, desired, window.toggleBisonFute);
                    return !desired || bisonFuteMarkers.length > 0;
                case 'bridges':
                    setBooleanLayerIfNeeded(bridgeVisible, desired, window.toggleBridges);
                    return !desired || bridgeDataLoaded;
                case 'pnx':
                    if (desired && !bridgeVisible) setBooleanLayerIfNeeded(bridgeVisible, true, window.toggleBridges);
                    setBridgeProviderIfNeeded('panoramax', desired);
                    return !desired || bridgeDataLoaded;
                case 'mly':
                    if (desired && !bridgeVisible) setBooleanLayerIfNeeded(bridgeVisible, true, window.toggleBridges);
                    setBridgeProviderIfNeeded('mapillary', desired);
                    return !desired || bridgeDataLoaded;
                case 'ens':
                    setBooleanLayerIfNeeded(sensitiveZonesVisible, desired, window.toggleSensitiveZones);
                    return !desired || sensitiveZonesLoaded;
                case 'inat':
                    setBooleanLayerIfNeeded(inaturalistSensitivesVisible, desired, window.toggleInaturalistSensitives);
                    return !desired || inaturalistSensitivesLoaded;
                default:
                    return true;
            }
        }

        function applyAppUrlLayersFromSet(wanted) {
            applyAppUrlHierarchyFromSet(wanted);

            const pendingKeys = [
                'construction', 'bicycle', 'cities', 'limits', 'accidents', 'traffic', 'waze',
                'weather', 'bison', 'bridges', 'pnx', 'mly', 'ens', 'inat'
            ];
            let allReady = true;
            pendingKeys.forEach(key => {
                if (!applyAppUrlLayerKey(key, wanted)) allReady = false;
            });
            return allReady;
        }

        function applyAppUrlView(state) {
            if (!appUrlHasView(state) || !window.map) return;
            window.map.setView([state.view.lat, state.view.lng], state.view.z, { animate: false });
        }

        function tryApplyAppUrlState() {
            if (appUrlStateApplied || !window.map) return;

            const state = parseAppUrlState();
            if (!state) {
                appUrlStateApplied = true;
                return;
            }

            suppressAppUrlSync = true;
            try {
                if (appUrlHasView(state)) applyAppUrlView(state);

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

                appUrlStateApplied = true;
            } finally {
                suppressAppUrlSync = false;
                if (appUrlStateApplied) scheduleAppUrlSync();
            }
        }

        window.addEventListener('popstate', () => {
            appUrlStateApplied = false;
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
                    const total = 3;
                    if (bridgeVisible) visible++;
                    if (sensitiveZonesVisible) visible++;
                    if (inaturalistSensitivesVisible) visible++;
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
                case 'freshness-sensitive-zones':
                    return sensitiveZonesVisible;
                case 'freshness-inaturalist-sensitive':
                    return inaturalistSensitivesVisible;
                case 'freshness-accidents':
                    return accidentsVisible;
                case 'freshness-traffic':
                    return trafficVisible;
                case 'freshness-weather-stations':
                    return weatherStationsVisible;
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

            if (!bridgeVisible) {
                hint.textContent = `Activez la couche, puis zoomez au niveau ${BRIDGE_PHOTO_MIN_ZOOM}+ pour afficher les photos.`;
                return;
            }

            const zoom = window.map.getZoom();
            if (zoom < BRIDGE_PHOTO_MIN_ZOOM) {
                hint.textContent = `Photos masquées à ce zoom · zoomez au niveau ${BRIDGE_PHOTO_MIN_ZOOM}+ près d'un pont.`;
                return;
            }

            const providers = Object.entries(bridgePhotoProviderVisibility)
                .filter(([, active]) => active)
                .map(([provider]) => bridgeProviderLabel(provider))
                .join(' + ');
            hint.textContent = visiblePhotoCount > 0
                ? `${visiblePhotoCount} photo${visiblePhotoCount > 1 ? 's' : ''} visible${visiblePhotoCount > 1 ? 's' : ''} · ${providers || 'aucune source active'}`
                : `Aucune photo visible dans l'emprise actuelle · ${providers || 'aucune source active'}`;
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
            bridgePhotoMarkers.forEach(entry => {
                if (bridgePhotoProviderVisibility[entry.photo.provider] === false) return;
                const latlng = bridgePhotoMarkerLatLng(entry.photo, entry.group);
                entry.marker.setLatLng(latlng);
                if (!bounds.contains(latlng) && !bounds.intersects(entry.group.bounds)) return;
                entry.marker.addTo(bridgePhotoLayerGroup);
                visiblePhotoCount++;
            });

            updateBridgeZoomHint(visiblePhotoCount);
        }

        function bindBridgeMapChangeHandler() {
            if (!window.map || bridgeMapChangeHandler) return;
            bridgeMapChangeHandler = () => {
                updateBridgeGeometryVisibility();
                updateBridgeGroupMarkerLayer();
                updateBridgePhotoLayerVisibility();
            };
            window.map.on('zoomend moveend', bridgeMapChangeHandler);
        }

        function unbindBridgeMapChangeHandler() {
            if (!window.map || !bridgeMapChangeHandler) return;
            window.map.off('zoomend moveend', bridgeMapChangeHandler);
            bridgeMapChangeHandler = null;
        }

        function bridgeClusterRadiusPx(zoom) {
            if (zoom >= 15) return 0;
            if (zoom <= 10) return 72;
            // Rayon qui décroît progressivement : les ponts se séparent de proche en proche.
            return Math.max(0, Math.round(72 * (15 - zoom) / 5));
        }

        function bridgePhotoCountsForGroups(groups) {
            return groups.map(group => group.photos.length);
        }

        function bridgeSoloMarkerDiameter(photoCount) {
            if (photoCount <= 0) return 11;
            return Math.min(42, 18 + photoCount * 8);
        }

        function bridgeClusterMarkerDiameter(cluster, zoom) {
            const photoCounts = bridgePhotoCountsForGroups(cluster.groups);
            const maxPhotoCount = Math.max(0, ...photoCounts, 0);
            const totalPhotos = cluster.photoCount;

            if (!cluster.isCluster) {
                return bridgeSoloMarkerDiameter(maxPhotoCount);
            }

            const zoomBase = zoom < 11 ? 48 : zoom < 13 ? 36 : 24;
            if (totalPhotos > 0) {
                // Priorité au pont le plus riche en photos, puis agrégat du groupe.
                return Math.min(78, zoomBase + maxPhotoCount * 9 + totalPhotos * 3);
            }
            return Math.min(58, zoomBase + Math.sqrt(cluster.bridgeCount) * 4);
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
                    if (distance <= radiusPx * 1.35) union(i, j);
                }
            }

            const buckets = new Map();
            points.forEach((entry, index) => {
                const root = find(index);
                if (!buckets.has(root)) buckets.set(root, []);
                buckets.get(root).push(entry.group);
            });

            return [...buckets.values()].map(clusterGroups => (
                buildBridgeClusterDescriptor(clusterGroups, clusterGroups.length > 1)
            ));
        }

        function bridgeClusterLabel(cluster, zoom) {
            if (cluster.isCluster) {
                if (cluster.photoCount > 0) return String(cluster.photoCount);
                if (cluster.bridgeCount > 1) return String(cluster.bridgeCount);
                return '';
            }
            if (cluster.maxPhotoCount > 0 && zoom >= 13) return String(cluster.maxPhotoCount);
            return '';
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

        function updateBridgeGeometryVisibility() {
            if (!bridgeGeometryLayerGroup || !window.map) return;
            const showGeometry = bridgeVisible && window.map.getZoom() >= BRIDGE_GEOMETRY_MIN_ZOOM;
            if (showGeometry) {
                if (!window.map.hasLayer(bridgeGeometryLayerGroup)) bridgeGeometryLayerGroup.addTo(window.map);
            } else if (window.map.hasLayer(bridgeGeometryLayerGroup)) {
                window.map.removeLayer(bridgeGeometryLayerGroup);
            }
            bringBridgeGroupMarkersToFront();
        }

        function handleBridgeClusterMarkerClick(cluster) {
            if (cluster.isCluster && cluster.bridgeCount > 1) {
                const bounds = cluster.groups.reduce((acc, group) => {
                    acc.extend(group.bounds);
                    return acc;
                }, L.latLngBounds(cluster.groups[0].bounds.getSouthWest(), cluster.groups[0].bounds.getNorthEast()));
                window.map.fitBounds(bounds, {
                    padding: [72, 72],
                    maxZoom: Math.min(20, window.map.getZoom() + 2),
                    animate: true
                });
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

        function bringBridgeGroupMarkersToFront() {
            if (bridgeGroupMarkerLayerGroup && window.map?.hasLayer(bridgeGroupMarkerLayerGroup)) {
                bridgeGroupMarkerLayerGroup.bringToFront();
            }
        }

        function updateBridgeGroupMarkerLayer() {
            if (!bridgeGroupMarkerLayerGroup || !window.map || !bridgeVisible) return;

            bridgeGroupMarkerLayerGroup.clearLayers();
            clusterBridgeGroupsInView().forEach(cluster => {
                makeBridgeClusterMarker(cluster).addTo(bridgeGroupMarkerLayerGroup);
            });
            bringBridgeGroupMarkersToFront();
        }

        function fitBridgeOverview() {
            const validBounds = bridgeGroups
                .map(group => group.bounds)
                .filter(bounds => bounds?.isValid?.());
            if (!validBounds.length) return;

            const bounds = validBounds.reduce((acc, item) => {
                acc.extend(item);
                return acc;
            }, L.latLngBounds(validBounds[0].getSouthWest(), validBounds[0].getNorthEast()));

            window.map.fitBounds(bounds, {
                padding: [40, 40],
                maxZoom: 12,
                animate: true
            });
        }

        function syncBridgeLayersOnMap() {
            if (!window.map || !bridgeGeometryLayerGroup || !bridgePhotoLayerGroup) return;

            if (bridgeVisible) {
                if (bridgeGroupMarkerLayerGroup && !window.map.hasLayer(bridgeGroupMarkerLayerGroup)) {
                    bridgeGroupMarkerLayerGroup.addTo(window.map);
                }
                if (!window.map.hasLayer(bridgePhotoLayerGroup)) bridgePhotoLayerGroup.addTo(window.map);
                bindBridgeMapChangeHandler();
                applyBridgesVisibleUi();
                updateBridgeGeometryVisibility();
                updateBridgeGroupMarkerLayer();
                updateBridgePhotoLayerVisibility();
            } else {
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
            fitBridgeOverview();
        };

        window.toggleBridgePhotoProvider = function(provider) {
            if (!Object.prototype.hasOwnProperty.call(bridgePhotoProviderVisibility, provider)) return;
            bridgePhotoProviderVisibility[provider] = !bridgePhotoProviderVisibility[provider];
            syncBridgeSourceToggleUi();
            updateBridgePhotoLayerVisibility();
            syncLegendChrome();
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

        function getInaturalistMarkerColor(iconicTaxon, qualityGrade) {
            const base = INATURALIST_TAXON_COLORS[iconicTaxon] || INATURALIST_TAXON_COLORS.unknown;
            if (qualityGrade === 'research') return base;
            if (qualityGrade === 'needs_id') return base;
            return base;
        }

        function formatInaturalistDate(value) {
            if (!value) return 'date inconnue';
            const parts = String(value).split('-');
            if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
            return value;
        }

        function buildSensitiveZonePopup(props = {}) {
            const areaText = props.area_ha ? `${props.area_ha.toLocaleString('fr-FR')} ha` : '—';
            return `
                <div class="route-popup sensitive-zone-popup">
                    <h3>${props.name || 'Espace naturel sensible'}</h3>
                    <div class="detail"><strong>Superficie&nbsp;:</strong> ${areaText}</div>
                    ${props.communes ? `<div class="detail"><strong>Communes&nbsp;:</strong> ${props.communes}</div>` : ''}
                    ${props.habitat ? `<div class="detail"><strong>Milieu&nbsp;:</strong> ${props.habitat}</div>` : ''}
                    ${props.manager ? `<div class="detail"><strong>Gestionnaire&nbsp;:</strong> ${props.manager}</div>` : ''}
                    ${props.owner ? `<div class="detail"><strong>Propriétaires&nbsp;:</strong> ${props.owner}</div>` : ''}
                </div>
            `;
        }

        function buildInaturalistPopup(props = {}) {
            const photoHtml = props.photo_url
                ? `<img src="${props.photo_url}" alt="" class="inaturalist-popup-photo" loading="lazy">`
                : '';
            const qualityLabel = props.quality_grade === 'research'
                ? 'Recherche'
                : (props.quality_grade === 'needs_id' ? 'À identifier' : 'Casual');
            return `
                <div class="route-popup inaturalist-popup">
                    ${photoHtml}
                    <h3>${props.taxon_name || 'Observation'}</h3>
                    ${props.scientific_name && props.scientific_name !== props.taxon_name
                        ? `<div class="detail"><strong>Nom scientifique&nbsp;:</strong> <em>${props.scientific_name}</em></div>`
                        : ''}
                    <div class="detail"><strong>Date&nbsp;:</strong> ${formatInaturalistDate(props.observed_on)}</div>
                    <div class="detail"><strong>Qualité&nbsp;:</strong> ${qualityLabel}</div>
                    ${props.ens_name ? `<div class="detail"><strong>ENS&nbsp;:</strong> ${props.ens_name}</div>` : ''}
                    ${props.user_login ? `<div class="detail"><strong>Observateur&nbsp;:</strong> ${props.user_login}</div>` : ''}
                    ${props.url ? `<div class="detail"><a href="${props.url}" target="_blank" rel="noopener noreferrer">Voir sur iNaturalist</a></div>` : ''}
                </div>
            `;
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
            if (sensitiveZonesVisible && !onMap) sensitiveZonesLayer.addTo(window.map);
            if (!sensitiveZonesVisible && onMap) window.map.removeLayer(sensitiveZonesLayer);
        }

        function syncInaturalistSensitivesOnMap() {
            if (!inaturalistSensitiveLayerGroup || !window.map) return;
            const onMap = window.map.hasLayer(inaturalistSensitiveLayerGroup);
            if (inaturalistSensitivesVisible && !onMap) inaturalistSensitiveLayerGroup.addTo(window.map);
            if (!inaturalistSensitivesVisible && onMap) window.map.removeLayer(inaturalistSensitiveLayerGroup);
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

        window.loadSensitiveZones = async function(options = {}) {
            const show = options.show !== false;
            try {
                const data = await window.InforouteApi.fetchGeoJson('sensitive-natural-zones');
                const features = data.features || [];
                renderFreshnessBadge(document.getElementById('freshness-sensitive-zones'), {
                    generatedAt: data._cache?.generated_at,
                    scheduleKey: 'external',
                    errorMsg: data._cache?.error
                });

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
                    onEachFeature(feature, layer) {
                        layer.bindPopup(buildSensitiveZonePopup(feature.properties || {}));
                    }
                });

                sensitiveZonesLoaded = true;
                const countEl = document.getElementById('count-sensitive-zones');
                if (countEl) countEl.textContent = features.length.toLocaleString('fr-FR');

                if (show) {
                    sensitiveZonesVisible = true;
                    syncSensitiveZonesOnMap();
                    applySensitiveZonesVisibleUi();
                } else {
                    applySensitiveZonesHiddenUi();
                }

                syncLegendChrome();
                tryApplyAppUrlState();
                console.log(`✓ ${features.length} espaces naturels sensibles chargés`);
            } catch (error) {
                console.error('Erreur chargement ENS:', error);
                renderFreshnessBadge(document.getElementById('freshness-sensitive-zones'), {
                    scheduleKey: 'external',
                    errorMsg: error.message
                });
                if (!show) applySensitiveZonesHiddenUi();
                sensitiveZonesVisible = false;
                syncLegendChrome();
            }
        };

        window.loadInaturalistSensitives = async function(options = {}) {
            const show = options.show !== false;
            try {
                const data = await window.InforouteApi.fetchGeoJson('inaturalist-sensitive-zones');
                const features = data.features || [];
                renderFreshnessBadge(document.getElementById('freshness-inaturalist-sensitive'), {
                    generatedAt: data._cache?.generated_at,
                    scheduleKey: 'external',
                    errorMsg: data._cache?.error
                });

                if (inaturalistSensitiveLayerGroup) {
                    window.map?.removeLayer(inaturalistSensitiveLayerGroup);
                    inaturalistSensitiveLayerGroup = null;
                }
                inaturalistSensitiveMarkers = [];

                inaturalistSensitiveLayerGroup = L.layerGroup();
                features.forEach(feature => {
                    const props = feature.properties || {};
                    const coords = feature.geometry?.coordinates;
                    if (!coords) return;

                    const color = getInaturalistMarkerColor(props.iconic_taxon, props.quality_grade);
                    const marker = L.circleMarker([coords[1], coords[0]], {
                        radius: props.quality_grade === 'research' ? 6 : 5,
                        fillColor: color,
                        color: '#ffffff',
                        weight: 1.5,
                        opacity: 0.9,
                        fillOpacity: props.quality_grade === 'casual' ? 0.55 : 0.8
                    });
                    marker.bindPopup(buildInaturalistPopup(props));
                    inaturalistSensitiveMarkers.push(marker);
                    inaturalistSensitiveLayerGroup.addLayer(marker);
                });

                inaturalistSensitivesLoaded = true;
                const countEl = document.getElementById('count-inaturalist-sensitive');
                if (countEl) countEl.textContent = features.length.toLocaleString('fr-FR');

                if (show) {
                    inaturalistSensitivesVisible = true;
                    syncInaturalistSensitivesOnMap();
                    applyInaturalistSensitivesVisibleUi();
                } else {
                    applyInaturalistSensitivesHiddenUi();
                }

                syncLegendChrome();
                tryApplyAppUrlState();
                console.log(`✓ ${features.length} observations iNaturalist (ENS) chargées`);
            } catch (error) {
                console.error('Erreur chargement iNaturalist ENS:', error);
                renderFreshnessBadge(document.getElementById('freshness-inaturalist-sensitive'), {
                    scheduleKey: 'external',
                    errorMsg: error.message
                });
                if (!show) applyInaturalistSensitivesHiddenUi();
                inaturalistSensitivesVisible = false;
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
            legendItems.forEach(item => {
                item.style.opacity = '1';
                item.style.pointerEvents = 'auto';
            });
        }

        function applyConstructionHiddenUi() {
            const icon = document.getElementById('constructionToggleIcon');
            const title = document.querySelector('.legend-section:has([id="constructionToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-construction]');
            setToggleIcon(icon, false);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '600';
            legendItems.forEach(item => {
                item.style.opacity = '0.5';
                item.style.pointerEvents = 'none';
            });
        }

        window.toggleConstruction = function() {
            constructionVisible = !constructionVisible;
            console.log('🔵 toggleConstruction →', constructionVisible);

            if (!constructionVisible) {
                constructionPolylines.forEach(polyline => {
                    if (window.map.hasLayer(polyline)) window.map.removeLayer(polyline);
                });
                applyConstructionHiddenUi();
                syncLegendChrome();
                console.log('✗ Routes en construction masquées');
                return;
            }

            // To show: if never loaded, start local fetch (instant).
            // No fake 30 s timer: this is just a local GeoJSON read.
            if (constructionPolylines.length === 0) {
                const icon = document.getElementById('constructionToggleIcon');
                if (icon) icon.style.opacity = '0.5';
                window.loadConstructionRoads();
                return;
            }

            constructionPolylines.forEach(polyline => {
                if (!window.map.hasLayer(polyline)) polyline.addTo(window.map);
            });
            applyConstructionVisibleUi();
            syncLegendChrome();
            console.log(`✓ ${constructionPolylines.length} polyline(s) construction affichée(s)`);
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
            }).addTo(window.map);

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
            legendItems.forEach(item => {
                item.style.opacity = '1';
                item.style.pointerEvents = 'auto';
            });
        }

        function applyBicycleHiddenUi() {
            const icon = document.getElementById('bicycleToggleIcon');
            const title = document.querySelector('.legend-section:has([id="bicycleToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-bicycle]');
            setToggleIcon(icon, false);
            if (icon) icon.style.opacity = '';
            if (title) title.style.fontWeight = '600';
            legendItems.forEach(item => {
                item.style.opacity = '0.5';
                item.style.pointerEvents = 'none';
            });
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
                if (!window.map.hasLayer(polyline)) polyline.addTo(window.map);
            });
            applyBicycleVisibleUi();
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

            if (typeof updateRouteLabels === 'function') {
                updateRouteLabels();
            }
            syncLegendChrome();
        };


        // Show/hide accidents
        window.toggleAccidents = function() {
            accidentsVisible = !accidentsVisible;
            
            const icon = document.getElementById('accidentToggleIcon');
            const legendItems = document.querySelectorAll('[data-accident]');
            const title = document.querySelector('.legend-section:has([id="accidentToggleIcon"]) .legend-title');
            
            if (accidentsVisible) {
                // Show accidents
                accidentMarkers.forEach(marker => marker.addTo(window.map));
                setToggleIcon(icon, true);
                
                // Bold title
                if (title) title.style.fontWeight = '700';
                
                // Visually activate legend items
                legendItems.forEach(item => {
                    item.style.opacity = '1';
                    item.style.pointerEvents = 'auto';
                });
                
                console.log(`✓ ${accidentMarkers.length} accidents affichés`);
            } else {
                // Hide accidents
                accidentMarkers.forEach(marker => window.map.removeLayer(marker));
                setToggleIcon(icon, false);
                
                // Normal-weight title
                if (title) title.style.fontWeight = '600';
                
                // Visually deactivate legend items
                legendItems.forEach(item => {
                    item.style.opacity = '0.5';
                    item.style.pointerEvents = 'none';
                });
                
                console.log('✗ Accidents masqués');
            }
            syncLegendChrome();
        }

        // ========== TRAFFIC COUNTING STATIONS ==========

        const TRAFFIC_STYLES = {
            high: { fill: '#34495E', stroke: '#FFFFFF', size: 12 },
            medium: { fill: '#95A5A6', stroke: '#FFFFFF', size: 10 },
            low: { fill: '#D5DBDB', stroke: '#7F8C8D', size: 8 }
        };

        function syncTrafficMarkersOnMap() {
            trafficMarkers.forEach(marker => {
                const onMap = window.map.hasLayer(marker);
                if (trafficVisible && !onMap) marker.addTo(window.map);
                if (!trafficVisible && onMap) window.map.removeLayer(marker);
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
                legendItems.forEach(item => {
                    item.style.opacity = '1';
                });
                console.log(`✓ ${trafficMarkers.length} stations de comptage affichées`);
            } else {
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                legendItems.forEach(item => {
                    item.style.opacity = '0.5';
                });
                console.log('✗ Stations de comptage masquées');
            }
            syncLegendChrome();
        };

        // ========== ROAD EVENTS / BISON FUTÉ ==========

        window.toggleBisonFute = function() {
            bisonFuteVisible = !bisonFuteVisible;

            const icon = document.getElementById('bisonFuteToggleIcon');
            const title = document.querySelector('.legend-section:has([id="bisonFuteToggleIcon"]) .legend-title');
            const legendItems = document.querySelectorAll('[data-bison-fute]');

            if (bisonFuteVisible) {
                bisonFuteMarkers.forEach(marker => {
                    if (!window.map.hasLayer(marker)) marker.addTo(window.map);
                });
                setToggleIcon(icon, true);
                if (title) title.style.fontWeight = '700';
                legendItems.forEach(item => {
                    item.style.opacity = '1';
                });
                console.log(`✓ ${bisonFuteMarkers.length} événements routiers affichés`);
            } else {
                bisonFuteMarkers.forEach(marker => {
                    if (window.map.hasLayer(marker)) window.map.removeLayer(marker);
                });
                setToggleIcon(icon, false);
                if (title) title.style.fontWeight = '600';
                legendItems.forEach(item => {
                    item.style.opacity = '0.5';
                });
                console.log('✗ Événements routiers masqués');
            }
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
        
        // Initialize map centered on Vaucluse (refined after boundary load)
        const launchUrlState = parseAppUrlState();
        const launchCenter = appUrlHasView(launchUrlState)
            ? [launchUrlState.view.lat, launchUrlState.view.lng]
            : [44.05, 5.15];
        const launchZoom = appUrlHasView(launchUrlState) ? launchUrlState.view.z : 13;
        window.map = L.map('map').setView(launchCenter, launchZoom);
        if (window.map.attributionControl) {
            window.map.attributionControl.setPrefix(
                '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>'
            );
        }
        window.map.on('moveend zoomend', scheduleAppUrlSync);

        // Plain CartoDB Positron basemap
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap contributors © CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(window.map);

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
                
                // Fit view to the department unless the URL already defines the viewport
                if (!appUrlHasView(parseAppUrlState())) {
                    map.fitBounds(boundaryLayer.getBounds(), { padding: [6, 6], maxZoom: 13 });
                    map.setZoom(Math.min(map.getZoom() + 1, 13));
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
                                        ${way.tags.maxspeed ? `<div class="detail"><strong>Vitesse max&nbsp;:</strong> ${way.tags.maxspeed} km/h</div>` : ''}
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
        // Panonceaux par niveau hiérarchique (seuils + fondu 0.75 niveau de zoom).
        // Mise à jour pendant zoom/déplacement ; recadrage viewport pour limiter le bruit.
        // Priority: regional (3) > territorial (2) > local (1) — highest keeps ideal position.
        // Test: Avignon [43.9493, 4.8055] — z10 régional, z12 territorial, z14 local.
        const ROUTE_LABEL_ZOOM_THRESHOLDS = {
            regional: 10,
            territorial: 12,
            local: 14
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

        function getRouteLabelCandidates(route) {
            const candidates = [];
            if (!route.ways || route.ways.length === 0) return candidates;
            const way = route.ways[0];
            if (!way.geometry || way.geometry.length === 0) return candidates;

            const len = way.geometry.length;
            const fractions = len === 1 ? [0] : [0.25, 0.5, 0.75];
            fractions.forEach(fraction => {
                const index = Math.min(len - 1, Math.max(0, Math.round((len - 1) * fraction)));
                const point = way.geometry[index];
                candidates.push(L.latLng(point.lat, point.lon));
            });
            return candidates;
        }

        function getRouteLabelAnchor(route) {
            const candidates = getRouteLabelCandidates(route);
            return candidates.length > 0 ? candidates[Math.floor(candidates.length / 2)] : null;
        }

        function getRouteLabelZoomOpacity(hierarchy, zoom) {
            const threshold = ROUTE_LABEL_ZOOM_THRESHOLDS[hierarchy];
            if (zoom < threshold) return 0;
            if (zoom >= threshold + ROUTE_LABEL_ZOOM_FADE_SPAN) return 1;
            return (zoom - threshold) / ROUTE_LABEL_ZOOM_FADE_SPAN;
        }

        function getRouteLabelZoomScale(zoom) {
            return Math.min(1.2, Math.max(0.88, 0.72 + zoom * 0.025));
        }

        function routeIntersectsViewport(route) {
            const bounds = map.getBounds().pad(ROUTE_LABEL_VIEWPORT_PADDING);
            if (route.ways) {
                for (const way of route.ways) {
                    if (!way.geometry) continue;
                    for (const point of way.geometry) {
                        if (bounds.contains([point.lat, point.lon])) return true;
                    }
                }
            }
            const anchor = getRouteLabelAnchor(route);
            return !!(anchor && bounds.contains(anchor));
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
            ['regional', 'territorial', 'local'].forEach(hierarchy => {
                if (!hierarchyVisibility[hierarchy]) return;
                const opacity = getRouteLabelZoomOpacity(hierarchy, zoom);
                if (opacity <= 0) return;
                routesByHierarchy[hierarchy].forEach(route => {
                    if (!routeIntersectsViewport(route)) return;
                    const anchor = getRouteLabelAnchor(route);
                    if (!anchor) return;
                    entries.push({
                        route,
                        hierarchy,
                        ref: route.ref,
                        priority: ROUTE_LABEL_PRIORITY[hierarchy],
                        opacity,
                        anchor,
                        candidates: getRouteLabelCandidates(route)
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
                const popup = marker.getPopup && marker.getPopup();
                if (!popup) return;
                const html = popup.getContent ? popup.getContent() : '';
                const match = String(html).match(/MJA[^:]*:[^>]*?([\d\u00a0\u202f,. ]+)\s*v[ée]h\/jour/i);
                if (match) {
                    const num = Number.parseInt(match[1].replace(/[^0-9]/g, ''), 10);
                    if (Number.isFinite(num) && num > 0) mjaValues.push(num);
                }
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
            
            window.map.closePopup();
        }

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
        
        // Highlight a route
        function highlightRoute(ref) {
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
                
                // Centrer la carte sur la route
                const bounds = L.latLngBounds(polylines.map(p => p.getBounds()));
                map.fitBounds(bounds, { padding: [50, 50] });
                
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

        function defaultBridgePhotoAxisT(photo, group) {
            const part = bridgeFeatureInfoById.get(photo.partId);
            if (part && group.bridgeAxis) return projectOnBridgeAxis(group.bridgeAxis, part.center);
            if (photo.role === 'abutment') return 0.08;
            if (photo.role === 'pillar') return 0.5;
            if (photo.role === 'deck') return 0.5;
            return 0.5;
        }

        function buildBridgePhotoLayout(group) {
            const layout = new Map();
            if (!group?.bridgeAxis) return layout;

            const abutmentParts = group.features
                .filter(info => info.role === 'abutment')
                .map(info => ({ info, t: projectOnBridgeAxis(group.bridgeAxis, info.center) }))
                .sort((a, b) => a.t - b.t);
            const abutmentTs = abutmentParts.map(item => item.t);
            const fallbackAbutmentT = (index, total) => (
                total <= 1 ? 0.08 : (index / Math.max(total - 1, 1)) * 0.84 + 0.08
            );

            const slotBuckets = new Map();
            group.photos.forEach(photo => {
                const part = bridgeFeatureInfoById.get(photo.partId);
                let t = defaultBridgePhotoAxisT(photo, group);
                if (photo.role === 'abutment' && !part) {
                    const abutmentIndex = group.photos
                        .filter(item => item.role === 'abutment')
                        .findIndex(item => item.key === photo.key);
                    const totalAbutments = group.photos.filter(item => item.role === 'abutment').length;
                    t = fallbackAbutmentT(abutmentIndex, totalAbutments);
                }
                if (photo.role === 'abutment' && abutmentTs.length) {
                    const nearest = abutmentParts.reduce((best, item) => {
                        const distance = Math.abs(item.t - t);
                        return distance < best.distance ? { distance, t: item.t } : best;
                    }, { distance: Infinity, t });
                    if (nearest.distance < 0.2) t = nearest.t;
                }

                const slotKey = `${photo.role}:${photo.partId || 'generic'}:${Math.round(t * 100)}`;
                if (!slotBuckets.has(slotKey)) slotBuckets.set(slotKey, []);
                slotBuckets.get(slotKey).push({ photo, t });
            });

            slotBuckets.forEach(items => {
                items.sort((a, b) => a.photo.key.localeCompare(b.photo.key, 'fr'));
                items.forEach((item, index) => {
                    layout.set(item.photo.key, {
                        t: item.t,
                        side: index % 2 === 0 ? 1 : -1,
                        ring: Math.floor(index / 2)
                    });
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

        function providerLabel(provider) {
            return provider === 'panoramax' ? 'Panoramax' : 'Mapillary';
        }

        function panoramaxImageUrl(id, size = 'sd') {
            return `https://api.panoramax.xyz/api/pictures/${encodeURIComponent(id)}/${size}.jpg`;
        }

        function panoramaxPageUrl(id) {
            return `https://panoramax.openstreetmap.fr/#focus=pic&pic=${encodeURIComponent(id)}`;
        }

        function mapillaryPageUrl(id) {
            return `https://www.mapillary.com/app/?pKey=${encodeURIComponent(id)}`;
        }

        function mapillaryEmbedUrl(id) {
            return `https://www.mapillary.com/embed?image_key=${encodeURIComponent(id)}&style=photo`;
        }

        function bridgePhotoExternalUrl(photo) {
            return photo.provider === 'panoramax' ? panoramaxPageUrl(photo.id) : mapillaryPageUrl(photo.id);
        }

        function bridgePhotoMetaLabel(photo) {
            const bits = [
                providerLabel(photo.provider),
                photo.roleLabel,
                photo.context?.directionLabel ? `vue ${photo.context.directionLabel}` : '',
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
            const start = window.map.latLngToContainerPoint(axis.start);
            const end = window.map.latLngToContainerPoint(axis.end);
            const axisLength = Math.hypot(end.x - start.x, end.y - start.y) || 1;
            const perpX = -(end.y - start.y) / axisLength;
            const perpY = (end.x - start.x) / axisLength;
            const offset = BRIDGE_PHOTO_OUTSIDE_BASE_PX + (layout.ring * BRIDGE_PHOTO_OUTSIDE_RING_PX);
            return bridgeOffsetLatLngByPixels(
                along,
                perpX * layout.side * offset,
                perpY * layout.side * offset
            );
        }

        function buildBridgePopup(group, info) {
            const tags = info.tags || {};
            const photosLabel = group.photos.length
                ? `${group.photos.length} photo${group.photos.length > 1 ? 's' : ''}`
                : 'aucune photo taguée';
            const osmType = tags.osm_type || String(info.id).split('/')[0];
            const osmId = tags.osm_id || String(info.id).split('/')[1];
            const osmLink = osmType && osmId ? `https://www.openstreetmap.org/${osmType}/${osmId}` : '';

            return `
                <div class="route-popup bridge-popup">
                    <h3>Ouvrage d'art</h3>
                    <div class="detail"><strong>Groupe&nbsp;:</strong> ${escapeHtml(group.title)}</div>
                    <div class="detail"><strong>Élément&nbsp;:</strong> <span class="bridge-part-pill" style="--bridge-part-color:${info.color};">${escapeHtml(info.roleLabel)}</span></div>
                    ${tags['bridge:structure'] ? `<div class="detail"><strong>Structure&nbsp;:</strong> ${escapeHtml(tags['bridge:structure'])}</div>` : ''}
                    ${tags.material ? `<div class="detail"><strong>Matériau&nbsp;:</strong> ${escapeHtml(tags.material)}</div>` : ''}
                    ${tags.operator || tags.owner ? `<div class="detail"><strong>Gestionnaire&nbsp;:</strong> ${escapeHtml(tags.operator || tags.owner)}</div>` : ''}
                    <div class="detail"><strong>Photos&nbsp;:</strong> ${photosLabel}</div>
                    ${osmLink ? `
                        <div class="detail" style="margin-top: 10px;">
                            <a href="${osmLink}" target="_blank" rel="noopener noreferrer" style="color: #3498DB; font-weight: 600; text-decoration: none;">Voir l'élément OSM →</a>
                        </div>
                    ` : ''}
                </div>
            `;
        }

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

        function buildBridgeViewerHero(photo) {
            if (!photo) {
                return '<div class="bridge-viewer-empty">Aucune photo Panoramax ou Mapillary n\'est taguée sur cet ouvrage.</div>';
            }

            if (photo.provider === 'panoramax') {
                return `
                    <a class="bridge-viewer-hero-link" href="${panoramaxPageUrl(photo.id)}" target="_blank" rel="noopener noreferrer">
                        <img class="bridge-viewer-hero-img" src="${panoramaxImageUrl(photo.id, 'sd')}" alt="${escapeHtml(bridgePhotoMetaLabel(photo))}" loading="lazy">
                    </a>
                `;
            }

            return `
                <iframe class="bridge-viewer-hero-frame" src="${mapillaryEmbedUrl(photo.id)}" title="${escapeHtml(bridgePhotoMetaLabel(photo))}" allowfullscreen loading="lazy"></iframe>
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

            title.textContent = group.title;
            subtitle.textContent = `${group.photos.length} photo${group.photos.length > 1 ? 's' : ''} · ${group.features.length} élément${group.features.length > 1 ? 's' : ''} OSM · vue en plan`;

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
                <div class="bridge-schematic">
                    <div class="bridge-schematic-stage">
                        <div class="bridge-schematic-photos bridge-schematic-photos--top">${schematicTop}</div>
                        ${buildBridgeSchematicStructure(group)}
                        <div class="bridge-schematic-photos bridge-schematic-photos--bottom">${schematicBottom}</div>
                    </div>
                </div>
                <div class="bridge-viewer-hero">
                    ${buildBridgeViewerHero(selectedPhoto)}
                </div>
                ${selectedPhoto ? `
                    <div class="bridge-viewer-selected">
                        <span class="bridge-part-pill" style="--bridge-part-color:${selectedPhoto.color};">${escapeHtml(selectedPhoto.partLabel)}</span>
                        <span>${escapeHtml(bridgePhotoMetaLabel(selectedPhoto))}</span>
                        <a href="${bridgePhotoExternalUrl(selectedPhoto)}" target="_blank" rel="noopener noreferrer">Source →</a>
                    </div>
                ` : ''}
                <div class="bridge-viewer-parts">${roleBadges}</div>
            `;

            content.querySelectorAll('[data-bridge-photo-key]').forEach(button => {
                button.addEventListener('click', () => {
                    renderBridgeViewer(group, button.dataset.bridgePhotoKey);
                });
            });

            panel.classList.add('active');
        }

        function openBridgeViewer(groupId, options = {}) {
            const group = bridgeGroupById.get(groupId);
            if (!group) return;

            if (!bridgeVisible) {
                bridgeVisible = true;
                syncBridgeLayersOnMap();
            }

            highlightBridgeGroup(group.id);
            if (options.fit !== false && window.map) {
                if (window.map.getZoom() < BRIDGE_SCHEMATIC_MIN_ZOOM) {
                    window.map.fitBounds(group.bounds, {
                        padding: [90, 90],
                        maxZoom: BRIDGE_SCHEMATIC_MIN_ZOOM,
                        animate: true
                    });
                } else {
                    fitBridgeGroup(group);
                }
            }
            renderBridgeViewer(group, options.photoKey);
        }

        window.openBridgeViewer = openBridgeViewer;

        window.closeBridgeViewer = function(options = {}) {
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
                    layer.bindPopup(buildBridgePopup(group, info));
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
                if (show) fitBridgeOverview();
                return bridgeGroups;
            }

            if (bridgeLoadPromise) {
                await bridgeLoadPromise;
                if (show) bridgeVisible = true;
                syncBridgeLayersOnMap();
                if (show) fitBridgeOverview();
                return bridgeGroups;
            }

            bridgeLoadPromise = (async () => {
                try {
                    const data = await window.InforouteApi.fetchGeoJson('bridges');
                    renderFreshnessBadge(document.getElementById('freshness-bridges'), {
                        generatedAt: data._cache?.generated_at,
                        scheduleKey: 'osm'
                    });

                    bridgeGroups = buildBridgeGroups(data.features || []);
                    bridgeGroupById = new Map(bridgeGroups.map(group => [group.id, group]));
                    createBridgeLayers(data);
                    setBridgeLegendCounts(bridgeGroups);
                    bridgeDataLoaded = true;

                    if (show) bridgeVisible = true;
                    syncBridgeLayersOnMap();
                    if (show) fitBridgeOverview();
                    console.log(`✓ ${bridgeGroups.length} groupe(s) de ponts chargés`);
                    tryApplyAppUrlState();
                    return bridgeGroups;
                } catch (error) {
                    console.error('Erreur chargement ponts:', error);
                    setBridgeLegendCounts([]);
                    renderFreshnessBadge(document.getElementById('freshness-bridges'), {
                        scheduleKey: 'osm',
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
            
            // Filter to most recent data per station
            const latestDataByStation = {};
            geojsonData.features.forEach(feature => {
                const props = feature.properties;
                const stationId = props.section_compteur ?? props.section_co ?? props.identifian ?? props.id_station ?? props.id;
                const year = Number.parseInt(props.annee ?? props.year ?? props.an, 10);

                if (!stationId || !Number.isFinite(year)) return;
                
                if (!latestDataByStation[stationId] || year > latestDataByStation[stationId].year) {
                    latestDataByStation[stationId] = {
                        feature: feature,
                        year: year
                    };
                }
            });

            // Afficher les stations de comptage
            Object.values(latestDataByStation).forEach(data => {
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

                // Create marker (hidden by default — see trafficVisible)
                const marker = L.circleMarker([lat, lon], {
                    radius: style.size,
                    fillColor: style.fill,
                    color: style.stroke,
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.9,
                    stationType: 'counting'  // For identification when toggling traffic
                });

                // Store for visibility toggle
                trafficMarkers.push(marker);

                // Popup with counting information
                const popupContent = `
                    <div class="route-popup">
                        <h3>📊 Station de comptage</h3>
                        <div class="detail"><strong>Route&nbsp;:</strong> ${routeName || 'N/A'}</div>
                        <div class="detail"><strong>Section&nbsp;:</strong> ${sectionName || 'N/A'}</div>
                        <div class="detail"><strong>Année&nbsp;:</strong> ${yearValue || 'N/A'}</div>
                        <div class="detail" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd;">
                            <strong>MJA (tous véhicules)&nbsp;:</strong> ${formatNumber(mja, ' véh/jour')}
                        </div>
                        <div class="detail"><strong>Taux PL&nbsp;:</strong> ${Number.isFinite(tauxPL) ? tauxPL.toFixed(1) + '%' : 'N/A'}</div>
                        <div class="detail"><strong>Débit PL&nbsp;:</strong> ${formatNumber(debitPL, ' PL/jour')}</div>
                        ${props.classe ? `<div class="detail"><strong>Classification&nbsp;:</strong> ${props.classe}</div>` : ''}
                        <div class="detail" style="margin-top: 8px; font-size: 0.75rem; color: #999;">
                            <strong>Source&nbsp;:</strong> ${sourceUsed || 'Inconnue'}
                        </div>
                    </div>
                `;

                marker.bindPopup(popupContent);

                // Effet de survol
                marker.on('mouseover', function() {
                    this.setStyle({
                        radius: style.size + 3,
                        weight: 3,
                        fillOpacity: 1
                    });
                });

                marker.on('mouseout', function() {
                    this.setStyle({
                        radius: style.size,
                        weight: 2,
                        fillOpacity: 0.9
                    });
                });
            });

            // Update legend counters
            document.getElementById('count-high').textContent = trafficCounts.high;
            document.getElementById('count-medium').textContent = trafficCounts.medium;
            document.getElementById('count-low').textContent = trafficCounts.low;
            
            console.log(`✓ Marqueurs créés:`, trafficCounts);

            // Update statistics
            const totalStations = trafficCounts.high + trafficCounts.medium + trafficCounts.low;
            const years = Object.values(latestDataByStation).map(d => d.year).filter(Number.isFinite);
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

        // Load accident data from local static GeoJSON
        async function loadAccidentData() {
            try {
                console.log('📊 Chargement des données d\'accidentologie...');

                const dataToUse = await window.InforouteApi.fetchGeoJson('accidents');
                const stats = dataToUse.metadata?.statistiques || {};
                const features = dataToUse.features;
                renderFreshnessBadge(document.getElementById('freshness-accidents'), {
                    generatedAt: dataToUse._cache?.generated_at,
                    scheduleKey: 'static'
                });
                syncLegendChrome();
                
                console.log(`✓ ${features.length} accidents chargés pour le Vaucluse`);
                console.log('Statistiques:', stats);
                
                // Counters by category
                const counts = { fatal: 0, hospitalized: 0, light: 0 };
                
                // Afficher chaque accident sur la carte
                features.forEach(feature => {
                    const props = feature.properties;
                    const coords = feature.geometry.coordinates;
                    const lat = coords[1];
                    const lon = coords[0];
                    
                    // Determine color and size by severity
                    let color, size, category, label;
                    if (props.gravite === 'mortel') {
                        color = '#000000';
                        size = 12;
                        category = 'fatal';
                        label = '💀 Accident mortel';
                        counts.fatal++;
                    } else if (props.gravite === 'grave') {
                        color = '#E74C3C';
                        size = 10;
                        category = 'hospitalized';
                        label = '🚑 Blessés hospitalisés';
                        counts.hospitalized++;
                    } else {
                        color = '#F39C12';
                        size = 8;
                        category = 'light';
                        label = '⚠️ Blessés légers';
                        counts.light++;
                    }
                    
                    // Create marker (do NOT add to map by default)
                    const marker = L.circleMarker([lat, lon], {
                        radius: size,
                        fillColor: color,
                        color: 'white',
                        weight: 2,
                        opacity: 0.9,
                        fillOpacity: 0.7
                    });
                    
                    // Stocker le marqueur pour le toggle
                    accidentMarkers.push(marker);
                    
                    // Popup with information
                    const victimesInfo = [];
                    if (props.tues > 0) victimesInfo.push(`${props.tues} tué(s)`);
                    if (props.hospitalises > 0) victimesInfo.push(`${props.hospitalises} hospitalisé(s)`);
                    if (props.legers > 0) victimesInfo.push(`${props.legers} blessé(s) léger(s)`);
                    
                    const popupContent = `
                        <div class="route-popup">
                            <h3>${label}</h3>
                            <div class="detail"><strong>Victimes&nbsp;:</strong> ${victimesInfo.join(', ')}</div>
                            <div class="detail"><strong>Date&nbsp;:</strong> ${props.date}</div>
                            <div class="detail"><strong>Commune&nbsp;:</strong> ${props.commune}</div>
                            ${props.adresse ? `<div class="detail"><strong>Adresse&nbsp;:</strong> ${props.adresse}</div>` : ''}
                            <div class="detail"><strong>Milieu&nbsp;:</strong> ${props.milieu}</div>
                            ${props.resume ? `<div class="detail" style="margin-top: 8px; font-size: 0.85rem; font-style: italic;">${props.resume}</div>` : ''}
                        </div>
                    `;
                    
                    marker.bindPopup(popupContent);
                    
                    // Effet de survol
                    marker.on('mouseover', function() {
                        this.setStyle({ 
                            radius: size + 3,
                            weight: 3,
                            fillOpacity: 1
                        });
                    });
                    
                    marker.on('mouseout', function() {
                        this.setStyle({ 
                            radius: size,
                            weight: 2,
                            fillOpacity: 0.7
                        });
                    });
                });
                
                // Update counters
                document.getElementById('count-fatal').textContent = counts.fatal;
                document.getElementById('count-hospitalized').textContent = counts.hospitalized;
                document.getElementById('count-light').textContent = counts.light;
                
                console.log('Répartition:', counts);

                if (typeof window.patchDashboardMetrics === 'function') {
                    window.patchDashboardMetrics({
                        accidents: {
                            total: counts.fatal + counts.hospitalized + counts.light,
                            fatal: counts.fatal,
                            hospitalized: counts.hospitalized,
                            light: counts.light
                        },
                        vintages: {
                            accidents: 'Millésime 2024 · BAAC'
                        }
                    });
                }
                tryApplyAppUrlState();
            } catch (error) {
                console.error('Erreur lors du chargement de l\'accidentologie:', error);
            }
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
            if (window.loadSensitiveZones) window.loadSensitiveZones({ show: false });
        }, 5000);

        setTimeout(() => {
            if (window.loadInaturalistSensitives) window.loadInaturalistSensitives({ show: false });
        }, 5500);
        
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
                syncLegendChrome();

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
                    }).addTo(window.map);

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

                applyConstructionVisibleUi();
                tryApplyAppUrlState();
            } catch (error) {
                console.error('Erreur chargement routes en construction:', error);
                document.getElementById('count-construction').textContent = '0';
                document.getElementById('count-proposed').textContent = '0';
                applyConstructionVisibleUi();
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
                syncLegendChrome();
                
                if (!data.features || data.features.length === 0) {
                    console.log('ℹ️ Aucun événement Info Routière dans le GeoJSON local');
                    updateBisonFuteLegendCounts({ travaux: 0, bouchons: 0, accidents: 0, autres: 0 });
                    if (typeof window.patchDashboardMetrics === 'function') {
                        window.patchDashboardMetrics({
                            bisonFute: { total: 0, travaux: 0, bouchons: 0, accidents: 0 },
                            vintages: { bisonFute: 'Cache 3 h · Info Routière' }
                        });
                    }
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
                
                if (totalEvents > 0) {
                    console.log(`✓ Événements Bison Futé affichés:`, eventsCount);
                } else {
                    console.log('ℹ️ Aucun événement Bison Futé dans la zone du Vaucluse actuellement');
                }
                tryApplyAppUrlState();
            } catch (error) {
                console.error('❌ Erreur lors du chargement Bison Futé:', error);
                console.log('ℹ️ Bison Futé couvre principalement le RRN (autoroutes, nationales)');
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
            const marker = L.circleMarker([station.lat, station.lon], {
                radius: 8,
                fillColor: '#5d6d7e',
                color: '#ffffff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.9
            }).bindTooltip(`${station.name}`, { direction: 'top', offset: [0, -8] });

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
        
        // ========== LIMITATIONS DE VITESSE & RESTRICTIONS (max*) ==========

        const speedPictoLayer = L.layerGroup();
        const restrictionLayer = L.layerGroup();
        let limitationsZoomHandler = null;

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

        // Convertit la valeur maxspeed OSM en nombre (km/h), ou null si inconnu.
        function parseMaxspeed(raw) {
            if (raw === null || raw === undefined) return null;
            const trimmed = String(raw).trim();
            if (!trimmed || trimmed === 'none' || trimmed === 'signals') return null;
            // OSM convention en France : "FR:rural" = 80, "FR:urban" = 50, "FR:motorway" = 130
            if (trimmed === 'FR:rural') return 80;
            if (trimmed === 'FR:urban') return 50;
            if (trimmed === 'FR:motorway') return 130;
            if (trimmed === 'FR:zone30') return 30;
            const m = trimmed.match(/^(\d+)(?:\s*(mph|kmh|km\/h))?$/i);
            if (!m) return null;
            const value = Number.parseInt(m[1], 10);
            if (!Number.isFinite(value)) return null;
            if (m[2] && m[2].toLowerCase() === 'mph') return Math.round(value * 1.60934);
            return value;
        }

        function colorForSpeed(kmh) {
            if (kmh === null || kmh === undefined) return SPEED_UNKNOWN_COLOR;
            for (const step of SPEED_COLOR_SCALE) {
                if (kmh <= step.max) return step.color;
            }
            return SPEED_COLOR_SCALE[SPEED_COLOR_SCALE.length - 1].color;
        }

        // Repeint toutes les polylines de routes selon leur maxspeed.
        function applySpeedGradient() {
            Object.keys(window.routePolylines).forEach(ref => {
                window.routePolylines[ref].forEach(polyline => {
                    const tags = polyline.options.wayTags || {};
                    const kmh = parseMaxspeed(tags.maxspeed);
                    polyline.setStyle({
                        color: colorForSpeed(kmh),
                        opacity: kmh === null ? 0.45 : 0.9,
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

        // Round pictogram in French speed-limit sign style.
        function makeSpeedPictoMarker(latlng, kmh) {
            return L.marker(latlng, {
                icon: L.divIcon({
                    html: `<div class="speed-picto" style="border-color:${colorForSpeed(kmh)};">${kmh}</div>`,
                    className: 'speed-picto-wrapper',
                    iconSize: [22, 22],
                    iconAnchor: [11, 11]
                }),
                interactive: false,
                keyboard: false
            });
        }

        // Pictogramme rectangulaire pour les restrictions (hauteur, poids, longueur, largeur).
        // Wide enough box (90px) for "🚛 12.5t" without clipping, center-anchored.
        function makeRestrictionPictoMarker(latlng, icon, value, color) {
            return L.marker(latlng, {
                icon: L.divIcon({
                    html: `<div class="restriction-picto" style="border-color:${color};"><span class="restriction-picto-icon">${icon}</span><span>${value}</span></div>`,
                    className: 'restriction-picto-wrapper',
                    iconSize: [90, 22],
                    iconAnchor: [45, 11]
                })
            });
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

        // Decide which restrictions to render for a given way (height, weight, length, width).
        function restrictionEntriesFromTags(tags) {
            const entries = [];
            const heightRaw = tags.maxheight;
            if (heightRaw && heightRaw !== 'no' && heightRaw !== 'default' && heightRaw !== 'none') {
                const v = compactUnit(heightRaw, 'm');
                entries.push({ icon: '🏔️', value: v, color: '#C0392B', label: `Hauteur max ${v}` });
            }
            const weightRaw = tags.maxweight || tags.maxweightrating;
            if (weightRaw && weightRaw !== 'no' && weightRaw !== 'default' && weightRaw !== 'none') {
                const v = compactUnit(weightRaw, 't');
                entries.push({ icon: '🚛', value: v, color: '#8E44AD', label: `Poids max ${v}` });
            }
            const lengthRaw = tags.maxlength;
            if (lengthRaw && lengthRaw !== 'no' && lengthRaw !== 'default') {
                const v = compactUnit(lengthRaw, 'm');
                entries.push({ icon: '↔️', value: v, color: '#E67E22', label: `Longueur max ${v}` });
            }
            const widthRaw = tags.maxwidth;
            if (widthRaw && widthRaw !== 'no' && widthRaw !== 'default') {
                const v = compactUnit(widthRaw, 'm');
                entries.push({ icon: '↕️', value: v, color: '#16A085', label: `Largeur max ${v}` });
            }
            return entries;
        }

        // Affiche les pictos vitesse / restrictions visibles dans la vue actuelle.
        // Zoom strategy:
        //   - zoom <  11: gradient only, no pictograms (carto overview)
        //   - zoom 11-12: restrictions des ponts/PL seulement
        //   - zoom ≥ 13 : pictos vitesse + restrictions
        function renderPictograms() {
            speedPictoLayer.clearLayers();
            restrictionLayer.clearLayers();
            if (!limitationsMode) return;

            const zoom = window.map.getZoom();
            const bounds = window.map.getBounds();
            const showSpeed = zoom >= 13;
            const showRestrictions = zoom >= 11;
            if (!showSpeed && !showRestrictions) return;

            // Avoid overload: skip duplicate speed pictograms for the same route
            // identified by maxspeed value within a small radius.
            const speedKeysSeen = new Set();

            Object.keys(window.routePolylines).forEach(ref => {
                window.routePolylines[ref].forEach(polyline => {
                    const tags = polyline.options.wayTags || {};
                    const mid = polylineMidLatLng(polyline);
                    if (!mid || !bounds.contains(mid)) return;

                    if (showSpeed) {
                        const kmh = parseMaxspeed(tags.maxspeed);
                        if (kmh !== null) {
                            // Approximate key (ref + speed + 0.005° ~ 500 m) to limit duplicates.
                            const key = `${ref}|${kmh}|${mid.lat.toFixed(2)}|${mid.lng.toFixed(2)}`;
                            if (!speedKeysSeen.has(key)) {
                                speedKeysSeen.add(key);
                                makeSpeedPictoMarker(mid, kmh).addTo(speedPictoLayer);
                            }
                        }
                    }

                    if (showRestrictions) {
                        // Limit visual restrictions to "notable" segments
                        // for readability: bridges, tunnels, or restricted segments in wide view.
                        const isBridge = tags.bridge && tags.bridge !== 'no';
                        const isTunnel = tags.tunnel === 'yes';
                        const entries = restrictionEntriesFromTags(tags);
                        const interestingZoom = zoom >= 13;
                        if (entries.length > 0 && (isBridge || isTunnel || interestingZoom)) {
                            entries.slice(0, 2).forEach((entry, i) => {
                                const offsetLatLng = L.latLng(mid.lat, mid.lng + i * 0.0006);
                                const marker = makeRestrictionPictoMarker(offsetLatLng, entry.icon, entry.value, entry.color);
                                marker.bindTooltip(`${entry.label}${isBridge ? ' (pont)' : isTunnel ? ' (tunnel)' : ''}`);
                                marker.addTo(restrictionLayer);
                            });
                        }
                    }
                });
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
            const scaleHtml = SPEED_COLOR_SCALE.map(step =>
                `<div class="limitations-legend-step" style="background:${step.color};">${step.label}</div>`
            ).join('');
            container.innerHTML = `
                <div style="font-size:0.78rem; color:#5b6770; font-weight:600; margin-bottom:4px;">Limites de vitesse (km/h)</div>
                <div class="limitations-legend-scale">${scaleHtml}</div>
                <div style="font-size:0.7rem; color:#7f8c8d; margin-top:6px;">Inconnue&nbsp;: <span style="display:inline-block;width:14px;height:8px;border-radius:2px;background:${SPEED_UNKNOWN_COLOR};vertical-align:middle;"></span></div>
                <div style="font-size:0.7rem; color:#7f8c8d; margin-top:8px; padding-top:6px; border-top:1px solid #ecf0f1;">
                    Pictogrammes <strong style="color:#2C3E50;">vitesse</strong> au zoom ≥ 13.<br>
                    Restrictions <strong style="color:#C0392B;">🏔️ hauteur</strong> · <strong style="color:#8E44AD;">🚛 poids</strong> sur ponts et tronçons remarquables au zoom ≥ 11.
                </div>
            `;
        }

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
                    limitationsZoomHandler = () => renderPictograms();
                    window.map.on('zoomend moveend', limitationsZoomHandler);
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

        function computeAccidentsMetricsFromGeoJson(data) {
            const counts = { fatal: 0, hospitalized: 0, light: 0 };
            (data.features || []).forEach(feature => {
                const gravite = feature.properties?.gravite;
                if (gravite === 'mortel') counts.fatal++;
                else if (gravite === 'grave') counts.hospitalized++;
                else counts.light++;
            });
            return {
                accidents: {
                    total: counts.fatal + counts.hospitalized + counts.light,
                    fatal: counts.fatal,
                    hospitalized: counts.hospitalized,
                    light: counts.light
                },
                vintages: { accidents: 'Millésime 2024 · BAAC' }
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
    
