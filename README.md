# dataroads-FR84 — Démo Inforoute 084

🇫🇷 Français · [🇬🇧 English](README.en.md)

> Concepteur du projet : Jean-Louis Zimmermann [@JLZIMMERMANN](https://github.com/JLZIMMERMANN), chargé de mission outils digitaux routiers au sein du CD84 en 2026.

Prototype de carte web pour explorer le réseau routier départemental du Vaucluse.
Ce démonstrateur, incubé au sein du Bureau de l'Information Routière (Conseil Départemental du Vaucluse), fait converger plusieurs fonctionnalités dans un outil léger et intuitif : lecture rapide du réseau, croisement avec l'accidentologie, repérage des points de comptage et première vérification de la qualité des données OpenStreetMap.

## Ce que montre la carte

- Le réseau départemental du Vaucluse, avec une hiérarchie simple : réseau régional, territorial et local.
- La limite du département et les communes, pour replacer les routes dans leur contexte territorial.
- Les stations de comptage CD84, classées par niveau de trafic.
- L'accidentologie multi-millésimes (BAAC, 2019-2024) sous forme de nuage : couleur selon l'ancienneté, gravité signalée par un anneau noir (blessés hospitalisés et mortels), histogramme et curseur d'années pour explorer l'évolution.
- Les routes en construction ou en projet issues du cache OSM.
- Une météo actuelle sur Avignon, utile comme signal opérationnel rapide.
- Le trafic temps réel Waze (bouchons et incidents communautaires), via la carte Waze Live Map intégrée à la demande.
- Un panneau de qualité OSM pour repérer les tronçons qui ont ou non une relation OSM exploitable.

## Intérêt pour le CD84

Le prototype sert surtout à rendre les données routières lisibles dans une interface unique. Pour un agent ou un responsable métier, il permet de répondre rapidement à des questions simples :

- Où sont les routes départementales les plus structurantes ?
- Quelles routes portent les plus forts trafics selon les comptages disponibles ?
- Où et quand les accidents se concentrent-ils, et comment évoluent-ils depuis 2019 ?
- Quelles communes sont concernées par une route ou un axe ?
- Quels tronçons OSM sont bien documentés, et lesquels méritent une correction ?
- Est-ce qu'un fichier publié sur data.gouv.fr ou une extraction OSM peut être exploité sans appeler des API à chaque visite ?

## Fraîcheur des données

La page indique les données externes rafraîchies toutes les 3 heures. Le navigateur lit des fichiers GeoJSON locaux, et les scripts de mise à jour régénèrent ces fichiers.

- Données statiques : routes, limite départementale, communes, accidentologie et fallback de démonstration.
- Données rafraîchies toutes les 3 h : comptages CD84 depuis data.gouv.fr et événements Info Routière.
- Donnée dynamique directe : météo Open-Meteo, demandée par le navigateur au chargement puis toutes les 10 minutes.
- Overpass API : jamais appelé par le navigateur. Il sert uniquement dans le script d'actualisation OSM.

## Cohérence des millésimes

État du jeu de données versionné dans ce dépôt :

| Donnée | Source | Millésime ou fraîcheur | Commentaire |
| --- | --- | --- | --- |
| Routes départementales | OpenStreetMap | cache du 2026-05-17 22:52 UTC | Données réseau, pas un millésime administratif CD84. |
| Routes en construction | OpenStreetMap | cache du 2026-05-17 22:53 UTC | Quelques ouvertures indiquées entre 2025 et 2027 selon les tags OSM. |
| Communes | OpenStreetMap | cache du 2026-05-17 22:53 UTC | 151 communes ; les tags de population pointent vers 2021. |
| Limite du Vaucluse | OpenStreetMap | GeoJSON local | Limite départementale 84, figée dans `data/static/`. |
| Accidentologie | BAAC / ONISR (data.gouv.fr) | 2019-2024 | 1 923 accidents corporels géolocalisés (dép. 84), généré par `scripts/build_accidents_vaucluse.py`. |
| Comptages CD84 | data.gouv.fr | 1996-2025 | 3 098 observations ; la carte affiche la dernière année disponible par station. |
| Événements routiers | Info Routière | cache toutes les 3 h | |
| Météo | Open-Meteo | temps courant | Appel direct, non versionné. |

## Lancer la démo en local

```bash
python3 -m http.server 8080
```

Puis ouvrir :

```text
http://localhost:8080/
```

## Guide utilisateur

Le guide FR (`guide.html`) est généré depuis `docs/guide.wiki` (syntaxe Wiki, style MediaWiki) :

```bash
python3 scripts/build_guide.py
```

Après modification du Wiki, régénérer la page puis committer `docs/guide.wiki` et `guide.html` ensemble. Le guide EN (`guide.en.html`) est maintenu à la main : pensez à y reporter les changements équivalents.

## Topo technique

L'architecture des données est séparée par usage :

- `data/osm/` : GeoJSON issus d'OpenStreetMap et générés par Overpass via un script.
- `data/static/` : GeoJSON figés, comme la limite du Vaucluse et l'accidentologie 2019-2024.
- `data/external/` : GeoJSON rafraîchis automatiquement depuis des sources externes.
- `data/demo/` : données de secours pour garder une carte exploitable si une source manque.

`js/config.js` centralise les chemins de fichiers et les sources dynamiques. `js/api.js` fournit un chargeur JSON/GeoJSON avec cache navigateur. `js/app.js` lit les fichiers déclarés dans la configuration.

Deux scripts Python maintiennent les données :

```bash
python3 scripts/update_osm_geojson.py
python3 scripts/update_external_data.py
```

`scripts/update_osm_geojson.py` interroge Overpass avec un `User-Agent` explicite :

```text
dataroads-FR84/<version> (https://github.com/thepriben/dataroads-FR84)
```

`scripts/update_external_data.py` matérialise les données data.gouv.fr et Info Routière dans `data/external/`. Si Info Routière est indisponible, le script conserve un GeoJSON vide avec l'erreur dans `_cache`.

## Articles & présentations

- [Structuring Road Information in Open Data: A Nested Wikidata – OSM – BD TOPO (IGN) Architecture Co-produced by Territorial Authorities](https://2026.stateofthemap.org/sessions/VS9YKN/) — Jean-Louis Zimmermann, State of the Map 2026, Paris.

## Inspirations

- La dataviz de l'accidentologie (nuage multi-millésimes, couleur selon l'ancienneté, gravité signalée par un anneau, filtre par années) s'inspire beaucoup de [« Victimes de la route » de Loïc Bertrand](https://www.loicbertrand.eu/accidents/). Merci à lui.
