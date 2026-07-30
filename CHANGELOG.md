# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.11.8] - 2026-07-30

### Changed

- **Roadside-area photos open the sequence directly.** Clicking a nearby Mapillary/Panoramax thumbnail now opens the source viewer (playable sequence) in a new tab instead of a lightbox. Removed the intermediate lightbox and the "▶ Séquence" caption link; the thumbnail hover icon is now an external-link arrow (↗).

## [0.11.7] - 2026-07-30

### Fixed

- **Panoramax sequence now opens on the origin instance viewer.** Targeting the federated meta-catalog viewer (`api.panoramax.xyz`) landed on the coverage map instead of the picture. Each photo's origin instance is now derived from its STAC `via` link (e.g. `panoramax.openstreetmap.fr`), which hosts a real picture viewer and shares the same `pic`/`seq` UUIDs, so "▶ Séquence" opens the focused, playable picture. Falls back to `panoramax.openstreetmap.fr` if `via` is absent.

## [0.11.6] - 2026-07-30

### Fixed

- **Panoramax sequence link opened the wrong viewer.** The link pointed to `panoramax.openstreetmap.fr`, but nearby photos are fetched from the federated `api.panoramax.xyz` catalog, whose UUIDs are only resolved by that host's viewer — so it fell back to the map. The "▶ Séquence" link now targets `https://api.panoramax.xyz/?focus=pic&pic=…&seq=…`. Caption shortened to "▶ Séquence".

## [0.11.5] - 2026-07-30

### Fixed

- **Panoramax "open source" link now reaches the playable sequence instead of the world map.** The viewer URL used the legacy v3 hash format (`#focus=pic&pic=…`); Panoramax v4 reads parameters from the query part (`?focus=pic&pic=…`), so the old link silently fell back to the map. Switched to the `?` format and added the sequence id (`&seq=…`, from the picture's `collection`) so the picture opens focused and playable. Lightbox caption updated to "▶ ouvrir la séquence jouable".

## [0.11.4] - 2026-07-30

### Added

- **Laybys (`parking=layby`) as a fourth roadside-area category.** Roadside stopping areas along departmental roads (`amenity=parking` + `parking=layby`) now have their own legend row, counter and orange marker ("Aires d'arrêt"), fulfilling the first bullet of issue #7. Dataset grows to 213 areas (rest_area 109, layby 50, car_pooling 32, park_ride 22).

## [0.11.3] - 2026-07-30

### Fixed

- **Roadside areas mapped as relations are now included.** Parkings/rest areas/car-pooling tagged on a multipolygon **relation** (e.g. the *Parking de l'Île Piot* P+R in Avignon, `relation/6543907`) were missing: the Overpass query only fetched nodes/ways, and `out tags geom;` did not expand relation members. Switched to `out geom;` and added `relation(...)` for all three area types, assembling outer/inner rings into Polygon/MultiPolygon.
- **Wikidata link preserved on areas.** The `wikidata` (and `wikimedia_commons`) tag was being dropped by the converter, so the popup wrongly showed "aucun lien" even when present (Île Piot carries `Q113994752`). It is now kept, along with `alt_name`, `maxstay`, `maxheight`, `supervised`.

## [0.11.2] - 2026-07-25

### Added

- **Surfacic footprint for roadside areas.** When the OSM object is an area (149/160 features), the actual footprint is now drawn as a polygon with a light fill coordinated with the category colour, plus a centred marker; clicking the polygon opens the marker popup.
- **Photo lightbox.** Clicking a nearby Mapillary/Panoramax thumbnail now opens it enlarged in an in-app lightbox (Esc / click to close, link to the source), instead of leaving straight to the provider site.
- **Wikidata signalling.** Roadside-area popups now show the Wikidata link when present (`Qxxx →`) and explicitly flag "aucun lien" when missing.

### Changed

- Merged the two redundant "… sur OSM" buttons into a single OpenStreetMap line with compact *voir* / *compléter* actions.
- Panoramax accent aligned to the project's violet (`#7C3AED`).

## [0.11.1] - 2026-07-25

### Added

- **Completeness & street-level photos on roadside areas.** Each roadside-area popup now shows an **OSM completeness** indicator (present/missing key attributes: name, capacity, access, surface, lit, operator — with a score) plus **nearby street-level photos** from both **Mapillary** and **Panoramax**, fetched on popup open around the area (e.g. coverage exists on RD 950). Added *View* / *Improve in OSM* links to invite contribution. New Panoramax proximity search (`/api/search` by bbox, nearest picture within ~130 m).

## [0.11.0] - 2026-07-25

### Added

- **Roadside areas & car-pooling layer (issue #7).** A new "Aires d'arrêt & covoiturage" section in the *factual cartography* family (not the incubator) surfaces related CD84 themes along departmental roads, sourced from OpenStreetMap: car-pooling areas 🚗 (`amenity=car_pooling`), rest areas 🌳 (`highway=rest_area`) and park-and-ride 🅿️ (`amenity=parking` + `park_ride`). One toggle, three legend swatches with per-category counters, distinct map markers and click-through popups (type, capacity, operator, access, OSM link). URL layer code `aires`.
- **`roadside-areas` Overpass dataset.** `scripts/update_osm_geojson.py` now builds `data/osm/roadside-areas.geojson` (160 points), refreshed on the usual twice-weekly OSM schedule. Parking is deliberately restricted to park-and-ride sites (excluding `park_ride=no`) to stay on roadside stopping areas rather than the ~8,000 private car parks of the department.

## [0.10.0] - 2026-07-22

### Added

- **Native Waze traffic layer (issue #10).** The "W" button can now render community Waze traffic as a real Leaflet layer instead of only the iframe: jam lines coloured by severity (level/speed) and incident markers (💥 accident, ⚠️ hazard, 🚧 roadworks, ⛔ road closed, 👮 police), with click-through popups (road, speed, delay, freshness). It activates automatically when a **Waze for Cities** partner feed is configured.
- **`WAZE_FEED_URL` secret + `data/external/waze.geojson` pipeline.** `scripts/update_external_data.py` now fetches the official partner feed (alerts + jams) and converts it to GeoJSON on the usual 3 h schedule. Without the secret it writes a `configured:false` placeholder and the front-end keeps the Live Map iframe as a fallback.

### Changed

- The Waze toolbar button dynamically chooses native layer vs. iframe fallback; tooltip updated accordingly.

### Notes

- The unofficial Waze live-map endpoint returns HTTP 403 to datacenter IPs (GitHub Actions included) and cannot be scraped server-side, so the native layer is fed by the legal, server-reachable Waze for Cities feed. See README ("Activer la couche Waze native").

## [0.9.1] - 2026-07-22

### Changed

- **Accident severity is now read from a black ring rather than size.** Hospitalised injuries and slight injuries share the same dot radius (they were hard to tell apart); hospitalised and fatal crashes get a black ring, slight injuries keep a thin white outline. Only fatal crashes stay slightly enlarged. Legend and guides updated accordingly.

## [0.9.0] - 2026-07-22

### Added

- **Multi-year accidentology cloud (BAAC / ONISR):** the road-safety layer now shows 2019→2024 injury crashes geolocated across the Vaucluse (1,923 points) instead of the single 2024 vintage. Inspired by [loicbertrand.eu/accidents](https://www.loicbertrand.eu/accidents/), it uses a dual visual encoding — **colour = recency** (recent crashes vivid/saturated orange, older ones dark red) and **size = severity** (fatal > hospitalised > slight). Points are drawn on a Leaflet canvas renderer for smoothness.
- **Temporal dataviz in the legend:** an old→recent colour scale, a **per-year histogram** of crash counts (colour-coded by recency), and a **year-range slider** (from / to) that filters the cloud live; per-severity counters update to the selected range.
- **`scripts/build_accidents_vaucluse.py`:** reproducible builder that resolves the BAAC resource URLs via the data.gouv API (handling the inconsistent file names, incl. the `carcteristiques` typo), downloads Caractéristiques + Usagers per year, filters department 84, joins the worst per-accident severity, resolves commune names via `geo.api.gouv.fr`, and emits a compact `data/static/accidents-vaucluse.geojson`.

### Notes

- BAAC geolocation is patchier for older millésimes, so the cloud is denser on recent years — which also reinforces the "evolution over time" reading.

## [0.8.2] - 2026-07-21

### Changed

- Waze Live Map embed now uses the French locale (`/fr/` → French UI and kilometres) and drops a pin at the centre, making the recentring on the current dataroads view explicit. (The embed already opened centred on the map's current position and zoom; confirmed against the official Waze iFrame parameters `lat`/`lon`/`zoom`.)

### Documentation

- User guide refreshed (FR `guide.html` from `docs/guide.wiki`, and EN `guide.en.html` by hand) for the recent counting features: value badges (e.g. `22k`), multi-vintage evolution chart, station → road-axis highlight, and the new Waze "W" toolbar button. README (FR/EN) clarified: the FR guide is generated from the wiki, the EN guide is maintained by hand.

## [0.8.1] - 2026-07-21

### Changed

- Waze toolbar button is now a compact "W" glyph button (matching the Mapillary "M" and Panoramax "P" buttons), placed to the left of the "M" button; its active state turns cyan while the live-map modal is open.

## [0.8.0] - 2026-07-21

### Added

- **Traffic-count value badges (issue #15):** counting stations now display the rounded AADT inside the circle (e.g. `22k` for 22,136 véh/j, `5,3k`, or the raw number below 1000), so the magnitude is readable at a glance without relying on colour. Circles remain sized by traffic threshold.

### Fixed

- Network-stats AADT range no longer depends on parsing popup HTML (which broke when the popup label changed to `véh/j`): the numeric AADT is now stored on each station marker.

### Changed

- Counting stations are rendered as `divIcon` badges instead of plain SVG circles; hover feedback moved to CSS.

## [0.7.1] - 2026-07-21

### Changed

- **Counting station UX (issue #9 follow-up):** clicking a station now draws a distinct indigo accent trace (with a white casing) over the road axis instead of reusing the hierarchy glow, so the road reads clearly as a line and no longer blends with the round count markers.
- Counting-station popup redesigned: wider and offset, with a compact header, the multi-year evolution chart moved to the top, and a two-column stats grid (MJA, taux PL, débit PL, classe) for better use of space.

## [0.7.0] - 2026-07-21

### Added

- **Counting station → road axis highlight (issue #9):** clicking a traffic-counting station now highlights the matching departmental road axis on the map (glow effect) and shows the axis details in the side panel, contextualising the count. Route matching is space/case-insensitive so CD84 `D975` resolves to OSM `D 975`.

### Changed

- `highlightRoute()` accepts an `options.zoom` flag; highlighting from a station click keeps the current view (no auto-recentre) so the station popup stays visible.

## [0.6.0] - 2026-07-21

### Added

- **Real-time Waze traffic layer (issue #10):** new "Waze" toolbar button opening the official Waze Live Map embed in a modal, showing community-reported jams and incidents in real time. The iframe is lazy-loaded and centred on the current map view when opened, and unloaded on close so it never polls in the background. Waze exposes no open data API for arbitrary areas, so this is the embed-based approach (no credentials); a Waze for Cities (CCP) feed could later add native markers if the department obtains one.

## [0.5.0] - 2026-07-21

### Added

- **Traffic evolution per counting station (issue #23):** counting-station popups now embed an inline SVG sparkline of the yearly AADT (MJA) history using the full multi-vintage data.gouv.fr / DataSud series (1996–2025), instead of only the latest year. A first→last trend indicator shows the absolute and percentage change over the period (▲/▼/▬ with cherry-red for increase, green for decrease), plus the number of vintages and the first→last values.

### Changed

- Traffic-count loading keeps the complete yearly history per station (`stationsById`) while still styling the marker by the most recent vintage.

## [0.4.0] - 2026-06-21

### Added

- New compact Panoramax "P" toolbar button (vector-tile coverage traces), next to the Mapillary "M".
- New "Panneaux directionnels" layer (OSM `information=guidepost`, ~2000 nodes in Vaucluse): clustered when zoomed out, real signposts at zoom ≥ 15, destination list in the popup, and a nearby Mapillary photo (green ring) when coverage exists — same behaviour as the stop/give-way layer.
- `update_osm_geojson.py` now accepts dataset name arguments to refresh a single cache (e.g. `python scripts/update_osm_geojson.py guideposts`).

### Changed

- Mapillary toolbar button shrunk to a compact stylised "M" to save toolbar space.
- Guidepost markers redesigned as real fingerposts (post + pointed direction blades, green dot for nearby Mapillary coverage) so they no longer look like speed/size limitation signs.
- Limitations: speed pictograms are now clustered when zoomed out (click a cluster to zoom in) and shown individually at zoom ≥ 13, so they are visible from the base zoom without cluttering the map.
- Limitations: size/weight restriction pictograms (height, width, weight, length) are now included in the same clusters as speed signs, and de-duplicated by type + value + ~1 km (like speed) so a sign carried by several overlapping way-segments no longer escapes the clusters as a stray picto.
- Limitations: dimension icons made semantically consistent — max width is now a horizontal arrow (↔️), max height a vertical arrow (↕️) and max length a ruler (📏).
- "Comptages CD84" toolbar button renamed to "Comptages"; "Panneaux directionnels" legend title now stacks "directionnels" as a smaller grey subtitle.
- Comptages (traffic-count stations) recoloured on a cherry-red (high traffic) → light-pink (low traffic) gradient.
- Panoramax accent colour switched to violet across the bridge viewer, photo markers and source dots.
- Left-column legend sections are now clearly delimited cards with a dark contour, so each feature's start/end is obvious at a glance.
- Removed the bridge hint text entirely ("Activez la couche, puis cliquez un pont." / "Cliquez un pont pour ouvrir la vue 3D.").

### Removed

- "Convois exceptionnels" toolbar button hidden and disconnected (redundant with the road-hierarchy filters, little added value).
- "Sources photo" section (Panoramax 84 / Mapillary) removed from the left column to reduce clutter.

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

[Unreleased]: https://github.com/thepriben/dataroads-FR84/compare/v0.8.2...HEAD
[0.8.2]: https://github.com/thepriben/dataroads-FR84/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/thepriben/dataroads-FR84/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/thepriben/dataroads-FR84/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/thepriben/dataroads-FR84/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/thepriben/dataroads-FR84/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/thepriben/dataroads-FR84/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/thepriben/dataroads-FR84/compare/v0.4.0...v0.5.0
[0.3.1]: https://github.com/thepriben/dataroads-FR84/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/thepriben/dataroads-FR84/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/thepriben/dataroads-FR84/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/thepriben/dataroads-FR84/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/thepriben/dataroads-FR84/releases/tag/v0.1.0
