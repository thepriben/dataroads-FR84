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
- Les aires d'arrêt le long des routes départementales (issue #7) : aires de covoiturage, aires de repos et parkings-relais issues d'OpenStreetMap, avec un indicateur de complétude OSM et les photos de rue à proximité (Mapillary / Panoramax).
- Une météo actuelle sur Avignon, utile comme signal opérationnel rapide.
- Le trafic Waze communautaire (bouchons et incidents) : couche native (tracés de bouchons + marqueurs d'incidents) si le flux partenaire *Waze for Cities* est configuré, sinon la carte Waze Live Map intégrée en repli.
- Une couche incubateur « Événements (OEDB) » : accidents, travaux et bouchons Bison Futé, plus des événements culturels curés (ex. Jeudis d'Orange), servis par notre instance [OpenEventDatabase](https://github.com/openeventdatabase/backend) statique [oedb-rs](https://github.com/thepriben/oedb-rs) (Rust + GitHub Pages, régénérée toutes les 3 h).
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
- Donnée rafraîchie toutes les heures : les derniers changements OSM sur la voirie, produits par un *augmented diff* Overpass en intégration continue.
- Donnée dynamique directe : météo Open-Meteo, demandée par le navigateur au chargement puis toutes les 10 minutes.
- Overpass API : jamais appelé par le navigateur. Il sert uniquement dans les scripts d'actualisation OSM — d'autant plus nécessaire pour l'*augmented diff*, qui demande une trentaine de secondes par requête.

## Cohérence des millésimes

État du jeu de données versionné dans ce dépôt :

| Donnée | Source | Millésime ou fraîcheur | Commentaire |
| --- | --- | --- | --- |
| Routes départementales | OpenStreetMap | cache du 2026-05-17 22:52 UTC | Données réseau, pas un millésime administratif CD84. |
| Routes en construction | OpenStreetMap | cache du 2026-05-17 22:53 UTC | Quelques ouvertures indiquées entre 2025 et 2027 selon les tags OSM. |
| Communes | OpenStreetMap | cache du 2026-05-17 22:53 UTC | 151 communes ; les tags de population pointent vers 2021. |
| Aires d'arrêt & covoiturage | OpenStreetMap | cache bi-hebdo (lun. & jeu.) | 213 aires : covoiturage, aires de repos, parkings-relais et aires d'arrêt (layby) le long des RD (issue #7), nœuds / contours / relations, générées par `scripts/update_osm_geojson.py`. |
| Panneaux directionnels & agglomération | OpenStreetMap | cache bi-hebdo (lun. & jeu.) | 2 167 mâts directionnels (`information=guidepost`, dont ~1 450 avec photo référencée) et 468 panneaux d'agglomération (`traffic_sign=city_limit`), générés par `scripts/update_osm_geojson.py`. |
| Derniers changements OSM | OpenStreetMap (*augmented diff*) | cache horaire (xx:41 UTC) | 3 jours glissants de contributions sur `way[highway]`, recadrés sur la limite départementale, générés par `scripts/update_osm_latest_changes.py`. Les tracés déplacés par un sommet sont recrédités à l'auteur du déplacement. |
| Limite du Vaucluse | OpenStreetMap | GeoJSON local | Limite départementale 84, figée dans `data/static/`. |
| Accidentologie | BAAC / ONISR (data.gouv.fr) | 2019-2024 | 1 923 accidents corporels géolocalisés (dép. 84), généré par `scripts/build_accidents_vaucluse.py`. |
| Comptages CD84 | data.gouv.fr | 1996-2025 | 3 098 observations ; la carte affiche la dernière année disponible par station. |
| Événements routiers | Info Routière | cache toutes les 3 h | |
| Événements (OEDB) | Bison Futé + curation, via [oedb-rs](https://github.com/thepriben/oedb-rs) | toutes les 3 h | Instance OpenEventDatabase statique (Rust, GitHub Pages), lue en direct par le navigateur. |
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

Trois scripts Python maintiennent les données :

```bash
python3 scripts/update_osm_geojson.py
python3 scripts/update_external_data.py
python3 scripts/update_osm_latest_changes.py
```

`scripts/update_osm_geojson.py` interroge Overpass avec un `User-Agent` explicite :

```text
dataroads-FR84/<version> (https://github.com/thepriben/dataroads-FR84)
```

`scripts/update_external_data.py` matérialise les données data.gouv.fr et Info Routière dans `data/external/`. Si Info Routière est indisponible, le script conserve un GeoJSON vide avec l'erreur dans `_cache`.

`scripts/update_osm_latest_changes.py` produit `data/osm/latest-changes.geojson` à partir d'un *augmented diff* Overpass. Ce mode n'existe qu'en XML et n'accepte pas de filtre par zone administrative : le script interroge donc une boîte englobante, puis écarte les tronçons hors Vaucluse. La fenêtre par défaut couvre 3 jours et se règle par `LATEST_CHANGES_DAYS`.

### Activer la couche Waze native

Waze n'expose pas d'API ouverte par zone (l'endpoint de la live-map renvoie un HTTP 403 aux IP de datacenter, donc inexploitable en CI). La couche native s'appuie donc sur le **flux partenaire officiel [Waze for Cities](https://www.waze.com/wazeforcities/)** (gratuit, sur inscription). Une fois l'URL du flux obtenue, ajoutez-la en **secret de dépôt** `WAZE_FEED_URL` : le workflow *Update External Data* génère alors `data/external/waze.geojson` (alertes + bouchons) toutes les 3 h, et le front bascule automatiquement sur la couche native. Sans secret, le bouton **W** ouvre la carte Waze Live Map en repli.

## Articles & présentations

- [Structuring Road Information in Open Data: A Nested Wikidata – OSM – BD TOPO (IGN) Architecture Co-produced by Territorial Authorities](https://2026.stateofthemap.org/sessions/VS9YKN/) — Jean-Louis Zimmermann, State of the Map 2026, Paris.

## Inspirations

- La dataviz de l'accidentologie (nuage multi-millésimes, couleur selon l'ancienneté, gravité signalée par un anneau, filtre par années) s'inspire beaucoup de [« Victimes de la route » de Loïc Bertrand](https://www.loicbertrand.eu/accidents/). Merci à lui.
