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
        version: '0.17.12',
        repository,
        basemap: {
            // Le Plan IGN de la Géoplateforme, en tuiles raster : libre, sans clé
            // et sans quota, et c'est la carte de référence de l'État — de quoi
            // remplacer le raster CARTO, tamponné « API KEY REQUIRED » depuis que
            // CARTO en exige une clé.
            //
            // Raster et non vectoriel : la tuile arrive déjà dessinée et s'affiche
            // dès reçue, au lieu d'attendre que MapLibre ait tout redessiné. Au
            // dézoom vers 8, mesuré, une tuile vectorielle OpenFreeMap pèse 189 Ko
            // contre 59 ici — c'est ce qui rendait le dézoom interminable — et on
            // se passe du mégaoctet de MapLibre GL. La visionneuse 3D des ponts,
            // qui peint son sol tuile par tuile sur un canvas, prend le même fond.
            url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
                + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png'
                + '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
            attribution: '© <a href="https://www.ign.fr/" target="_blank" rel="noopener noreferrer">IGN</a> — Géoplateforme',
            minZoom: 8,
            maxZoom: 19,
            // Le Plan IGN est bavard en couleurs pour qui ne lui demande qu'un
            // fond : reliefs verts, autoroutes orange, limites de parcs. On le
            // désature au compositeur, qui le fait sans rien coûter, plutôt que de
            // chercher un fournisseur sobre — ils demandent tous une clé.
            filter: 'saturate(0.25) brightness(1.06) contrast(0.96)',
            // La démo ne parle que du Vaucluse : aucune tuile n'est demandée hors
            // de ce cadre, et tout ce qui dépasse de la frontière disparaît sous un
            // aplat. Le conteneur de la carte porte la même couleur, si bien que le
            // bord du rectangle de tuiles ne se voit jamais.
            focus: {
                bounds: [4.64, 43.65, 5.77, 44.44],
                veilColor: '#e9ebe9'
            }
        },
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
                'city-limits': 'data/osm/city-limits.geojson',
                'latest-changes': 'data/osm/latest-changes.geojson',
                'roadside-areas': 'data/osm/roadside-areas.geojson',
                'vaucluse-boundary': 'data/static/vaucluse-boundary.geojson',
                communes: 'data/osm/communes-vaucluse.geojson',
                accidents: 'data/static/accidents-vaucluse.geojson',
                'traffic-counting': 'data/external/traffic-counting.geojson',
                'traffic-counting-demo': 'data/demo/traffic-counting-demo.geojson',
                'road-events': 'data/external/road-events.geojson',
                waze: 'data/external/waze.geojson',
                'sensitive-natural-zones': 'data/external/sensitive-natural-zones.geojson',
                'inaturalist-sensitive-zones': 'data/external/inaturalist-sensitive-zones.geojson',
                webcams: 'data/static/webcams-vaucluse.geojson',
                // Instance OpenEventDatabase statique (repo thepriben/oedb-rs),
                // régénérée toutes les 3 h — URL absolue, CORS ouvert par Pages.
                'oedb-events': 'https://thepriben.github.io/oedb-rs/api/event.json'
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
