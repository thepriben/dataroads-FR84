# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.7] - 2026-06-13

### Fixed

- iNaturalist clicks still missed intermittently with ENS visible: map snap-to-nearest observation, ENS pointer-events re-applied after pan/zoom, and explicit popup on marker click.

## [0.3.6] - 2026-06-13

### Changed

- iNaturalist markers scale with zoom (48px+ hit area); ENS polygons are non-interactive while observations are shown.

## [0.3.5] - 2026-06-13

### Changed

- iNaturalist markers use a 40px hit target on the marker pane (above ENS polygons); visual dots are 14–16px.
- Incubator bridge freshness label aligned with the real bi-weekly OSM GeoJSON workflow (Mon & Thu).
- User guide and bridge zoom hint updated for current cluster/geometry behaviour.

### Fixed

- iNaturalist observations were hard to click when ENS zones were visible: enlarged targets and correct layer stacking.

## [0.3.4] - 2026-06-13

### Fixed

- Blank basemap after page refresh with bridges active: stop clearing Carto tiles on every zoom end; recover with a soft layout check instead of `redraw()`.

## [0.3.3] - 2026-06-13

### Changed

- Bridge clusters: smaller markers, tighter merge radius, and no cluster blobs once the OSM geometry profile is visible.

### Fixed

- Blank basemap when toggling or zooming the bridges layer: Carto tiles are kept at the back with retry on load errors.
- Ugly bridge rendering during rapid zoom +/-: markers hidden while zooming, debounced refresh, and geometry hysteresis.
- Redundant bridge geometry popup removed; click opens the analysis viewer directly.

## [0.3.2] - 2026-06-12

### Added

- Collapsible legend sidebar on desktop; slide-out drawer on mobile (swipe and drag to dismiss).

### Changed

- Bridge analysis panel: schematic view, photo gallery, and OSM metadata.

### Fixed

- Layer visibility icons no longer disappear after refreshing Bison Futé or construction data.
- Bridge clusters remain clickable at zoom 12+ when the geometry profile is shown.

## [0.3.1] - 2026-06-06

### Added

- **Incubateur — Webcams:** curated static layer (Bonpas traffic CD84, Mont Serein, Chalet Reynard) with map markers and external stream links.
- **Guide utilisateur:** incubator section for webcams; URL layer code `wcam`.

## [0.3.0] - 2026-06-12

### Added

- **Incubateur:** bridges (OSM clusters, schematic viewer, Panoramax/Mapillary), ENS zones, and iNaturalist observations.
- **Chiffres clés** KPI dashboard; weather stations in Temps réel.
- Map URL state (viewport and layers) and home button to reset the department view.

### Changed

- More compact header and sidebar; fixed repo link and version in the sidebar foot.
- Véloroutes hierarchy colours (EV17, EV8, V861); unified family and layer visibility controls.

### Fixed

- Bridge cluster markers, layer sync, and cluster click zoom.
- URL zoom and layer persistence; ENS/iNaturalist no longer dropped by background preload.
- GitHub Actions data workflows: rebase before push on concurrent updates.

## [0.2.1] - 2026-05-30

### Changed

- **Documentation fully translated to English:** README, CHANGELOG, HTML meta tags, and JavaScript module headers.
- Polished GitHub README with live-demo badge, dataset table, and repository layout.

## [0.2.0] - 2026-05-30

### Added

- **Bicycle routes** layer: OSM `route=bicycle` relations for Vaucluse, weekly cache.
- `VERSION` file and `scripts/project_meta.py` / `scripts/bump_version.py` for centralized semver.
- `CHANGELOG.md`.

### Changed

- Repository references aligned with `dataroads-FR84`; footer redesigned (README credit + discreet repo link + version number).
- Source freshness badges restyled to neutral gray pills.
- Bicycle routes placed before construction roads in the legend.
- Construction-roads Overpass query fixed (department 84 filter); Python script and map display criteria harmonized.
- Construction layer UX: no popup when empty; zero counts are sufficient.

### Fixed

- Empty `construction-roads.geojson` cache caused by an invalid Overpass query (administrative area misplaced inside a union).

## [0.1.0] - 2026-05-17

### Added

- Web map prototype: Vaucluse departmental network, communes, department boundary, 2024 crash data, CD84 traffic counts, Info Routière events, Avignon weather, OSM quality panel.
- Data refresh scripts `update_osm_geojson.py` and `update_external_data.py`.
- GitHub Pages deployment and automated data-refresh workflows.

[Unreleased]: https://github.com/thepriben/dataroads-FR84/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/thepriben/dataroads-FR84/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/thepriben/dataroads-FR84/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/thepriben/dataroads-FR84/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/thepriben/dataroads-FR84/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/thepriben/dataroads-FR84/releases/tag/v0.1.0
