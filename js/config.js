(function (window) {
    'use strict';

    const repository = 'https://github.com/thepriben/demo-inforoute-084';

    window.APP_CONFIG = Object.freeze({
        appName: 'demo-inforoute-084',
        version: '0.1.0',
        repository,
        data: {
            geojson: {
                'departmental-roads': 'data/osm/departmental-roads.geojson',
                'construction-roads': 'data/osm/construction-roads.geojson',
                'vaucluse-boundary': 'data/static/vaucluse-boundary.geojson',
                communes: 'data/osm/communes-vaucluse.geojson',
                accidents: 'data/static/accidents-vaucluse.geojson',
                'traffic-counting': 'data/external/traffic-counting.geojson',
                'traffic-counting-demo': 'data/demo/traffic-counting-demo.geojson',
                'road-events': 'data/external/road-events.geojson'
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
