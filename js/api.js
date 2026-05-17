(function (window) {
    'use strict';

    const config = window.APP_CONFIG || {};
    const overpassConfig = config.overpass || {};
    const responseCache = new Map();

    function createTimeout(timeoutMs) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

        return {
            signal: controller.signal,
            clear: () => window.clearTimeout(timeoutId)
        };
    }

    async function fetchJson(url, options = {}, requestOptions = {}) {
        const timeout = createTimeout(requestOptions.timeoutMs || 30000);

        try {
            const response = await fetch(url, {
                credentials: 'omit',
                ...options,
                signal: options.signal || timeout.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
            }

            return await response.json();
        } finally {
            timeout.clear();
        }
    }

    async function fetchCachedJson(cachePath) {
        if (!cachePath) return null;
        if (responseCache.has(cachePath)) return responseCache.get(cachePath);

        try {
            const data = await fetchJson(cachePath, { cache: 'no-cache' }, { timeoutMs: 15000 });
            responseCache.set(cachePath, data);
            return data;
        } catch (error) {
            console.info(`Cache indisponible (${cachePath})`, error.message);
            return null;
        }
    }

    async function fetchOverpassLive(query) {
        if (!overpassConfig.endpoint) {
            throw new Error('Endpoint Overpass non configure');
        }

        const timeout = createTimeout(overpassConfig.timeoutMs || 90000);

        try {
            // GitHub Pages cannot guarantee a custom User-Agent from browser fetch without CORS issues.
            // The refresh script is the compliant Overpass client; this live path is only a fallback.
            const response = await fetch(overpassConfig.endpoint, {
                method: 'POST',
                credentials: 'omit',
                body: 'data=' + encodeURIComponent(query),
                signal: timeout.signal
            });

            if (!response.ok) {
                const body = await response.text().catch(() => '');
                throw new Error(`Overpass HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
            }

            return await response.json();
        } finally {
            timeout.clear();
        }
    }

    async function fetchOverpass(cacheName, query, options = {}) {
        const cachePath = options.cachePath || overpassConfig.cache?.[cacheName];

        if (overpassConfig.preferCache !== false) {
            const cached = await fetchCachedJson(cachePath);
            if (cached) return cached;
        }

        if (overpassConfig.allowLiveFallback === false) {
            throw new Error(`Cache Overpass manquant: ${cachePath || cacheName}`);
        }

        return fetchOverpassLive(query);
    }

    function normalizeCommuneName(value) {
        return String(value || '')
            .trim()
            .toLocaleLowerCase('fr-FR')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function escapeOverpassString(value) {
        return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    async function fetchCommuneBoundary(communeName) {
        const targetName = normalizeCommuneName(communeName);
        const cached = await fetchCachedJson(overpassConfig.cache?.communes);

        if (cached?.elements) {
            const relation = cached.elements.find((element) => (
                element.type === 'relation' &&
                normalizeCommuneName(element.tags?.name) === targetName
            ));

            if (relation) {
                return { ...cached, elements: [relation] };
            }
        }

        const overpassQuery = `
            [out:json][timeout:25];
            area["ISO3166-2"="FR-84"]->.dept;
            (
              relation(area.dept)["boundary"="administrative"]["admin_level"="8"]["name"="${escapeOverpassString(communeName)}"];
            );
            out geom;
        `;

        return fetchOverpass('commune-boundary', overpassQuery, { cachePath: null });
    }

    window.InforouteApi = Object.freeze({
        fetchJson,
        fetchOverpass,
        fetchCommuneBoundary,
        getOverpassUserAgent: () => overpassConfig.userAgent
    });
})(window);
