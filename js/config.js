/**
 * @file dataroads-FR84 application configuration.
 * @description Static web map for the Vaucluse (FR-84) departmental road network.
 *   Centralizes GeoJSON paths, semver, repository URL, and live API endpoints.
 *   Consumed by {@link InforouteApi} and the map bootstrap in app.js.
 * @see https://thepriben.github.io/dataroads-FR84/
 * @see https://github.com/thepriben/dataroads-FR84
 */
(function (window) {
    'use strict';

    const repository = 'https://github.com/thepriben/dataroads-FR84';

    window.APP_CONFIG = Object.freeze({
        appName: 'dataroads-FR84',
        version: '0.5.0',
        repository,
        mapillary: {
            // Jeton d'accès Mapillary (Graph API) pour rechercher une photo près d'un panneau.
            // Laisser vide désactive la recherche : le popup affiche alors "pas de photo".
            // Créer un jeton : https://www.mapillary.com/dashboard/developers (client token "MLY|...").
            accessToken: 'MLY|26158465847163536|0186af2cabb143cd46cccc023e7f0d81',
            // Image Radius Search ("nearby") : rayon en mètres, plafonné à 50 par l'API.
            searchRadiusMeters: 50
        },
        data: {
            externalRefreshHours: 3,
            geojson: {
                'departmental-roads': 'data/osm/departmental-roads.geojson',
                'construction-roads': 'data/osm/construction-roads.geojson',
                'bicycle-routes': 'data/osm/bicycle-routes.geojson',
                bridges: 'data/osm/bridges.geojson',
                'road-signs': 'data/osm/road-signs.geojson',
                guideposts: 'data/osm/guideposts.geojson',
                'vaucluse-boundary': 'data/static/vaucluse-boundary.geojson',
                communes: 'data/osm/communes-vaucluse.geojson',
                accidents: 'data/static/accidents-vaucluse.geojson',
                'traffic-counting': 'data/external/traffic-counting.geojson',
                'traffic-counting-demo': 'data/demo/traffic-counting-demo.geojson',
                'road-events': 'data/external/road-events.geojson',
                'sensitive-natural-zones': 'data/external/sensitive-natural-zones.geojson',
                'inaturalist-sensitive-zones': 'data/external/inaturalist-sensitive-zones.geojson',
                webcams: 'data/static/webcams-vaucluse.geojson'
            }
        },
        live: {
            weather: {
                sourceName: 'Open-Meteo Avignon',
                url: 'https://api.open-meteo.com/v1/forecast?latitude=43.9493&longitude=4.8055&current=temperature_2m,weather_code&timezone=Europe/Paris',
                refreshMs: 10 * 60 * 1000,
                timeoutMs: 10000
            }
        }
    });
})(window);
