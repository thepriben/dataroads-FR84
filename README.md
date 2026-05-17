# Demo Inforoute 084

Site statique de démonstration pour visualiser le réseau routier départemental du Vaucluse.

## Donnees statiques

Les donnees OSM utilisees par la carte sont servies en GeoJSON statique dans `data/osm/*.geojson`. Le site ne requete pas Overpass au runtime. Le seul usage d'Overpass est l'outil inclus de rafraichissement:

```bash
python3 scripts/update_osm_geojson.py
```

Le script envoie un `User-Agent` explicite a Overpass:

```text
demo-inforoute-084/0.1.0 (https://github.com/thepriben/demo-inforoute-084)
```

Les donnees qui ne changent pas au fil de la journee sont aussi lues en GeoJSON local:

- `data/static/accidents-vaucluse.geojson`: accidentologie fournie pour le Vaucluse
- `data/demo/traffic-counting-demo.geojson`: fallback de demonstration si la source de comptage manque

Le site reste compatible GitHub Pages: le navigateur lit ces donnees depuis les fichiers versionnes.

## Donnees rafraichies

Les donnees externes qui peuvent evoluer sont materialisees en GeoJSON dans `data/external/` par GitHub Actions:

- `traffic-counting.geojson`: comptages permanents CD84 depuis data.gouv.fr
- `road-events.geojson`: evenements Info Routiere quand la source est disponible

Le rafraichissement se fait avec:

```bash
python3 scripts/update_external_data.py
```

La meteo est la seule donnee appelee directement par le navigateur: elle est demandee a Open-Meteo au chargement de la page, puis toutes les 10 minutes.

## Publication GitHub Pages

1. Creer le depot `thepriben/demo-inforoute-084`.
2. Pousser cette arborescence sur la branche `main`.
3. Dans GitHub, activer Pages avec la source `GitHub Actions`.
4. L'action `Deploy GitHub Pages` publie automatiquement le site.
5. L'action `Update OSM GeoJSON` peut etre lancee manuellement et tourne aussi chaque lundi.
6. L'action `Update External Data` actualise les GeoJSON externes toutes les 3 heures.

## Lancement local

```bash
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.
