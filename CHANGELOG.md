# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versionnement sémantique : [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

## [0.2.0] - 2026-05-30

### Added

- Couche **véloroutes** : relations OSM `route=bicycle` du Vaucluse, cache hebdomadaire.
- Fichier `VERSION` et scripts `scripts/project_meta.py` / `scripts/bump_version.py` pour centraliser la version.
- `CHANGELOG.md`.

### Changed

- Références dépôt alignées sur `dataroads-FR84` ; footer repensé (crédit README + lien repo discret + numéro de version).
- Badges de fraîcheur des sources en style neutre (gris, liseret discret).
- Véloroutes placées avant les routes en construction dans la légende.
- Requête Overpass des routes en construction corrigée (filtre département 84) ; critères harmonisés script Python / affichage carte.
- UX couche construction : plus de popup quand la couche est vide ; compteurs à 0 suffisent.

### Fixed

- Cache `construction-roads.geojson` vide à cause d'une requête Overpass invalide (aire administrative mal placée).

## [0.1.0] - 2026-05-17

### Added

- Prototype carte web : réseau départemental Vaucluse, communes, limite 84, accidentologie 2024, comptages CD84, événements Info Routière, météo Avignon, qualité OSM.
- Scripts de mise à jour `update_osm_geojson.py` et `update_external_data.py`.
- Déploiement GitHub Pages et workflows de rafraîchissement automatique des données.

[Unreleased]: https://github.com/thepriben/dataroads-FR84/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/thepriben/dataroads-FR84/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/thepriben/dataroads-FR84/releases/tag/v0.1.0
