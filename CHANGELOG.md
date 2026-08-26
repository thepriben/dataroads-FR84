# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.17.10] - 2026-08-26

### Changed

- **The basemap now stops at Vaucluse, and no longer fetches the rest of the planet.** The demo has only ever spoken about one department, yet the ground beneath it was drawn for the whole world, tile by tile, wherever the view happened to wander. The style's sources are now bounded to the department and its immediate surroundings, so MapLibre asks for nothing beyond — at the default view that is eleven tiles instead of the full viewport, and zooming out no longer pulls in half of France. Bounding the vector source meant resolving its TileJSON ourselves, since the values it carries overwrite anything declared alongside it; that costs no extra request, being the one MapLibre would have made anyway. Whatever still shows past the frontier — the tile rectangle cannot follow a departmental outline — is washed out under a veil laid between the ground and the data layers, pierced by the boundary itself, the Enclave des Papes included. The veil is tinted with the style's own background colour, so the faded surroundings and the emptiness beyond blend into one and the edge of the tile rectangle never shows. Neighbouring municipalities stay faintly legible, which is what you want when reading a road that crosses the boundary.

## [0.17.9] - 2026-08-26

### Changed

- **The basemap has left CARTO for OpenFreeMap, and no longer asks anyone for a key.** CARTO now stamps "API KEY REQUIRED" across its raster tiles — measured on roughly four out of five, at every zoom from 8 to 20, which is why it looked tied to certain zoom levels — and the free key they offer in exchange never arrived. OpenFreeMap serves the same Positron cartography from OpenStreetMap data with no key, no quota, no registration and no cookies, under an MIT licence, and can be self-hosted should the public instance ever stop. It is vector rather than raster, so MapLibre now draws the ground into a single canvas laid on Leaflet's tile pane while every other layer stays where it was; labels stay crisp at zoom 18 where the old PNGs were interpolated. Machines without WebGL fall back to the IGN Plan, keyless as well, rather than being left with a bare map. The 3D bridge viewer paints its ground tile by tile onto a canvas and cannot read a vector style, so it takes the IGN Plan too — which has the CORS headers that painting demands.

## [0.17.8] - 2026-08-25

### Fixed

- **Opening a signpost no longer wipes the layer off the map.** Clicking a directional signpost, then moving the map, left it bare: the panels never came back, at any zoom. Opening a popup recentres the map, and the layer skips the rebuild that would follow so as not to destroy the marker carrying the popup — but it recognised that popup through `map._popup`, which Leaflet leaves pointing at the last popup long after it is closed. The layer was therefore frozen for good from the very first click, and every pan carried it out of view. Opening is now tracked through the popup events themselves. The same fault silenced the stop signs, the agglomeration signs and the webcams. Closing a popup also puts the layer back on the current view, which was missing since the automatic recentring can uncover an area with nothing drawn on it.

## [0.17.7] - 2026-08-25

### Added

- **The key figures themes are shortcuts to their layer.** Reading *1 923 accidents* makes you want to see them, and until now that meant closing the panel, finding the right sidebar family and unfolding it. Clicking a theme title now clears the map and leaves that theme alone on it — Réseau, Trafic, Sécurité, Live, Mobilité — then closes the panel and unfolds the matching legend family so the fine tuning stays one click away. Qualité opens its report instead, having no layer to paint.

### Fixed

- **A vintage label no longer erases its neighbours.** Any layer patching the dashboard sent the other vintage labels with it: `Object.assign` replaced the whole table, and the merge that followed copied back what it had just overwritten. Toggling accidents was enough to lose the Bison Futé and OSM cache dates.

## [0.17.6] - 2026-08-25

### Changed

- **Roads in the latest changes recap are now clickable, and say when they were edited.** The list named the roads but left you to find them by eye on the map, and said nothing about whether a change dated from this morning or from last week — the two questions a recap is there to answer. Clicking a road name frames the map on its changes and thickens them for a couple of seconds, long enough to pick them out among the others. Each line carries the age of its most recent change, *il y a 7 h* or *il y a 6 j*, with the exact date on hover. A contributor name is no longer split across two lines.

## [0.17.5] - 2026-08-25

### Fixed

- **One rate-limited dataset no longer freezes the eight others.** An agglomeration sign was reading `name=entrée de Sarrians`, a contributor's slip already corrected in OpenStreetMap that same morning — the layer was showing it because its cache had not been rebuilt since. Monday's scheduled run had been turned away by Overpass with a 429 and stopped there, taking the datasets queued behind it down with it and leaving everything stale until Thursday. Each dataset is now attempted on its own, a refusal costing only the dataset concerned, and the run ends by naming those left stale. Retries also wait twenty then forty seconds instead of five and ten, since a quota does not clear in five seconds, and whatever was fetched before a failure is committed rather than discarded with the runner.

## [0.17.4] - 2026-08-25

### Fixed

- **Moved alignments had lost their authors again, all 99 of them.** The recap listed roads such as D 31 with four changes and no contributor. Crediting a moved alignment takes a second Overpass query, asking who moved the vertices, and that query fired straight after the augmented diff had kept the server busy for forty seconds. It came back with a 504, and where the main query retried three times this one gave up on its first refusal — and gave up on every batch at once, not just the one that failed. The week's moves therefore stayed anonymous until an hour later, when a run happened to get through. Both queries now share the same retry policy, a lost batch no longer costs the others, and the vertex query lets the server breathe first. The run log states how many moves were credited out of how many, so a repeat failure shows up as `0/99` instead of passing silently. All 99 moves of the current week are credited again.

## [0.17.3] - 2026-08-25

### Added

- **The latest changes layer now recaps the roads on screen and who edited them.** A thousand coloured segments say something happened, not on which roads nor by whom, and the answer was only reachable one popup at a time. A panel in the bottom-right corner now lists the most edited ways within the current viewport — structuring axes first, then by number of changes — each with its count and the contributors who worked on it, linked to their OSM profiles. It follows the map on every pan and obeys the axis filters. A departmental road is grouped under its reference rather than the street names it takes through each town, otherwise a single D 900 showed up as two entries; ways with neither reference nor name are counted at the foot of the list. Bounding-box intersection is used to decide what is in view, which was checked to return exactly the same set as testing every vertex at three zoom levels.

## [0.17.2] - 2026-08-25

### Fixed

- **Hiding the counting layer now takes its road trace with it.** Clicking a counting station draws an indigo accent over the matching axis and fills the side panel with its details. Switching the layer off removed the 111 station markers but left the axis drawn — 282 segments of a D975 singled out on the map with nothing left to explain why. The trace and its card are now cleared with the layer. A road opened by clicking the road itself is left alone, since its selection owes nothing to the counting layer.
- **Cache markers were not bumped with the code, so returning visitors kept the previous build.** Scripts are versioned by hand through a `?v=` suffix and the browser caches each URL as it stands; leaving the suffix untouched meant a deployed fix stayed invisible until the cache expired. The four files changed since the last release carry a fresh marker.

## [0.17.1] - 2026-08-25

### Changed

- **Key figure pictograms are about three times bigger, and the panel no longer scrolls.** At 26 px in the corner of a tile the pictograms were decorative at best: too small to be read as a category marker, they only ate into the figure's width. They now hold a 68 px column on the left of each tile, which turns the grid into something closer to a dataviz than a table of numbers. Tiles grew from 88 to 158 px, and the panel from 82 to 94 % of the viewport height so that the six blocks fit without a scrollbar.

### Fixed

- **The key figures no longer label six years of accidents as a single vintage.** The Sécurité block announced *Millésime 2024* above 1 923 casualties, 195 of them fatal — figures that actually sum the whole 2019-2024 BAAC file, 2024 alone accounting for 608. Reading a six-year total as one year overstates the department's road toll more than threefold. The vintage is now derived from the data rather than hardcoded, and reads *Synthèse 2019–2024*. A *Dernier millésime* tile states the most recent year on its own, 608 casualties in 2024, so both readings are available without either being mistaken for the other. The label follows the year slider when the panel updates live, instead of quoting the file's full span next to filtered counts.

## [0.17.0] - 2026-08-25

### Changed

- **The latest changes layer now covers seven days instead of three**, taking it from 279 to 1 270 changes: 90 on main axes, 393 on secondary ones, 609 on local access roads. A week is the span that lets a Monday review catch the whole weekend.
- **Vertex moves below one metre are dropped.** At that distance the previous alignment is indistinguishable from the current one on screen — the ghost line is not even drawn — so flagging the change only buries the moves that can actually be seen. 76 such recalibrations were filtered out of the week, leaving 99 real moves ranging from 1 to 44 metres, median 3. Cards now state how far the vertex travelled. Both the window and the threshold are settable through `LATEST_CHANGES_DAYS` and `LATEST_CHANGES_MIN_MOVE`.
- **Trimmed the payload against the wider window.** Previous alignments carry no popup, so repeating their author, tags and version cost 70 kB for nothing; they now keep only what the axis filter needs. Dropping the unused `uid` saved a further 20 kB. Seven days weigh 918 kB where they would have weighed 1 010 kB.

## [0.16.1] - 2026-08-25

### Fixed

- **Moved alignments are credited to whoever moved them, not to an edit from 2018.** Cards in the latest changes layer showed dates as old as 2018 or 2019, which made the layer look broken. A way also changes shape when one of its vertices is dragged, without the way itself being reopened: its own version and author then still describe its last real edit, years back. Such changes now carry a *Tracé déplacé* badge and name the contributor who moved the vertex. Augmented diffs return a way's vertices stripped of any metadata, so the extraction compares the two versions to find which ones moved and asks Overpass separately who moved them — 49 of the 279 current changes, all now dated within the window, for about ten extra seconds per hourly run. A vertex that cannot be resolved leaves the card saying so rather than blaming an unrelated contributor.

## [0.16.0] - 2026-08-25

### Added

- **New incubator layer: latest OSM changes on the road network.** Three rolling days of contributions across the Vaucluse, coloured by what happened — green created, orange modified, red deleted — with the previous alignment drawn as a dashed ghost whenever an edit moved the geometry, which is the quickest way to spot a bend being straightened. A filter per axis class (main, secondary, local, paths, works) with counts leaves only the structuring network on screen once paths and local access are switched off. Each card names the author and date, lists the tag diff with old values struck through in red and new ones in green, and links out to the object, the changeset and OSM Deep History.
- **Hourly refresh workflow for that layer.** An augmented diff rebuilds the whole extent at two dates and compares them, so filtering on `highway` trims what comes back but not the work: roughly thirty seconds for three days over the department, and an out-of-memory failure without the filter. It therefore runs in GitHub Actions every hour and the browser only reads a 230 kB GeoJSON, keeping Overpass out of the page as every other layer does. Augmented diffs need a bounding box rather than an administrative area, so the extraction clips the roughly one quarter of raw changes that fall in the Gard, the Drôme or the Bouches-du-Rhône.

## [0.15.0] - 2026-08-25

### Added

- **Gauge labels are clickable.** Height, weight, length and width restrictions only ever had a tooltip, so there was no way to check them or fix them at source. Clicking one now opens a card with the carrying segment, every restriction it carries with the originating OSM tag, a nearby Mapillary photo where the area is covered, and the usual *voir* / *compléter* OpenStreetMap links.
- **Signposts can be sorted by use.** Each mast now carries a use badge at the foot of its post (hiking, cycling, mountain bike, riding) and the legend offers a filter per use with counts — 1 575 hiking, 120 cycling, 509 with no declared use. Switching hiking off leaves only the rest on screen. A mast carrying two uses stays visible as long as one of them is active. `mtb` and `horse` were added to the extraction keep-list for future refreshes.
- **Webcams too close together are grouped.** The two cameras on the Bonpas roundabout sit twelve metres apart, so they overlapped up to the maximum zoom and the second one could never be clicked. Close markers are now merged into a single badged marker whose popup acts as a picker, with a back button to the list. The group breaks apart on its own once the zoom separates the points.

### Fixed

- **Popups no longer close themselves when the map recentres.** Opening a card autopans the map, and the `moveend` that follows used to rebuild the pictogram and webcam layers, destroying the marker holding the popup. Both layers now skip the rebuild while one of their popups is open and catch up when it closes — the same guard already used by the sign layers.
- **Selecting a camera inside a grouped popup no longer dismisses it.** Replacing the popup content detaches the clicked button, and Leaflet, unable to walk back up to the popup, treated the click as a map click and closed the card.

## [0.14.2] - 2026-08-24

### Changed

- **Speed signs slide along their own segment to avoid each other.** 0.14.1 only removed identical overlapping signs, leaving two different limits stacked on top of one another where the information mattered most. A sign cannot be pushed off the carriageway without being read against the neighbouring road, so it now slides along its own polyline until it finds room. Where nothing is free, the limit is still drawn at least once per road in view and the further overlapping occurrences are dropped. Overlaps fall from 6 to 2 around Orange at zoom 14, 8 to 0 at Cavaillon, and 22 to 10 across L'Isle-sur-la-Sorgue at zoom 13, while showing more signs than the previous pass did.

## [0.14.1] - 2026-08-24

### Changed

- **Gauge restrictions drawn large**, at the same visual weight as a speed sign (30 px box, bigger figure and pictogram). There are few enough of them across the department that being loud is what makes them findable.
- **Gauge labels pushed off the carriageway and tied to their segment by a leader line** ending in a dot on the road. Through built-up areas, several restrictions carried by neighbouring segments used to stack on the road itself; the position is now picked among candidates around the anchor, skipping anything already placed — speed signs included.
- **Repeated speed signs no longer overlap.** Deduplication worked on a ~1 km grid, so the same value in two adjacent cells still produced two overlapping discs. Identical overlapping signs collapse to one; two different values are always kept, since a change of limit has to stay visible.

## [0.14.0] - 2026-08-24

### Added

- **Implicit speed limits from the road regime.** Many segments carry no `maxspeed` sign but do state their regime (`maxspeed:type`, `source:maxspeed`, `zone:maxspeed`): `FR:urban` is 50 km/h inside a built-up area, `FR:rural` 80 km/h outside it, plus the 30 km/h zones. Those 120 segments used to fall into "unknown"; they now take their band colour and get a sign drawn as a **dashed circle**, since the limit applies without a physical sign carrying it — the regulatory counterpart of the town-boundary signs, whose popup states the regime. A few segments carrying the regime code inside `maxspeed` itself are resolved along the way.
- **"None / All" bulk toggle on each limitations block.** Clearing the six speed bands one by one was the only way to look at the gauges alone; a single button now empties a block and flips to restore it.
- **Carousel for signpost photos.** One mast gathers up to eight photos (one per blade, bearing or year), unreadable as a row of thumbnails. The popup now shows one at a time with arrows and a counter, each view captioned with its provenance and the tag suffix (`panoramax:N` → "facing north", `mapillary:2017` → the year).
- **Suffixed photo tags are read.** Only the bare `panoramax` / `mapillary` / `wikimedia_commons` / `image` keys were extracted, so directional or dated variants were silently dropped — including on the mast used as the reference example. The dataset keeps every suffixed variant now.
- **OpenStreetMap links in the signpost and town-boundary popups** — *voir* the node, or *compléter* to open it straight in the iD editor, so a sign can be fixed from the map.

### Changed

- **Key-figures pictograms set in a badge**, large enough to scan the grid at a glance rather than sitting as a faint corner watermark.

### Fixed

- **Carousel photos no longer flash blank when navigating.** Pending slides are `display:none`, where `loading="lazy"` defers the download until the slide is shown; photos are now fetched when the popup opens.

## [0.13.0] - 2026-08-24

### Added

- **Town-boundary sign layer (`traffic_sign=city_limit`).** A new incubator layer maps the 468 EB10 / EB20 signs of the department (446 named): red clusters when zoomed out, and from zoom 13 the real plate — place name on white with a red border, crossed by a red diagonal for an exit (`city_limit=end`). The popup gives the direction, alternative names (including Occitan), reference, operator and the photos referenced in OSM. New `city-limits` Overpass dataset on the usual twice-weekly schedule; URL layer code `agglo`.
- **Photos of the signpost itself in guidepost popups.** About 1,450 of the department's 2,170 masts carry a photo in OSM (`panoramax`, `mapillary`, `wikimedia_commons`, `image`); those are now extracted and shown as thumbnails with their provenance, a violet dot on the mast flagging the case. The previous "nearest street-level photo" lookup remains as a fallback and keeps its green dot — it shows the surroundings, not the sign. Mapillary thumbnails are resolved by image id on popup open, and contributor-mangled tag values (viewer fragments, legacy v3 keys) degrade to a plain link instead of a failed request.
- **Clickable speed bands and gauges in the limitations legend.** The legend now splits into two filter blocks: the six speed bands plus "unknown", and the four gauges (height, weight, length, width). Clicking a cell fades the matching segments to grey and removes their signs, which isolates a speed regime or a type of constraint across the network.
- **Pictograms on the key-figures tiles**, one per indicator, set as a corner watermark so the number stays dominant.

### Changed

- **Road-number shields now honour their zoom threshold.** The fade ran *from* the threshold, so a level requested at zoom 10 only started appearing at 10.01 and local roads (threshold 14) were never drawn at their own zoom. The fade now runs *up to* the threshold: red is fully readable at zoom 10, orange at 12, and local roads move from 14 to **13**.
- **Road-number shields follow the visible part of the road.** Each shield was anchored to the midpoint of the route's first way, a fixed point that left the screen as soon as you panned along the road. Anchors are now picked among the geometry points actually in view, so shields stay on screen and travel with the axis.
- **Fatal crashes are drawn in black.** They leave the recency ramp entirely for a solid black dot ringed in white, readable at a glance against the red-orange cloud whatever the year; hospitalised and slight injuries keep the ramp and their ring/outline distinction.

### Fixed

- **Sign popups no longer close on their own.** Opening a popup makes Leaflet pan the map to fit it, and the resulting `moveend` rebuilt the layer, destroying the very marker carrying the popup. Stop/give-way, guidepost and town-boundary layers now skip the rebuild while one of their popups is open.
- **The `guide` URL code restores the guidepost layer.** The key was written to the URL but missing from the list of keys replayed on load, so sharing a view with signposts enabled never brought them back.

## [0.12.2] - 2026-08-24

### Fixed

- **The accidentology layer can be shown and hidden again.** `toggleAccidents()` and the severity legend rows live outside the `DOMContentLoaded` scope where the painter `applyAccidentVisibility()` is declared, so the eye only ever repainted the legend: the crash cloud appeared or vanished at the mercy of the year slider, and could no longer be switched off without reloading the page. Clicking a severity row even threw a `ReferenceError`. Two neighbours suffered from the same scope leak and are fixed alongside: route labels were not refreshed when toggling the network hierarchy, and bridge photo markers crashed while being positioned at zoom ≥ 16.
- **Crash popups open again when clicking a dot.** Leaflet always stacks canvas renderers under SVG ones, so the road polylines covered the crash cloud and swallowed its clicks — and crashes sit on roads by definition. The cloud now lives in a dedicated pane above the overlay pane; the pane only becomes clickable while the cursor rests on a dot, leaving road clicks untouched.
- **A layer switched off no longer comes back on its own.** Layer data lands over several seconds and every loader replays the pending URL state, which re-forced layers the user had toggled in the meantime. Each key is now applied at most once, and the `traffic` / `waze` aliases no longer cancel each other out.

### Removed

- **Speed-limit clusters.** Below zoom 13 the limitations mode now shows only the speed gradient carried by the segments, instead of grouping speed and size restrictions into count bubbles.

## [0.12.1] - 2026-08-06

### Added

- **Sport category** in the Events (OEDB) layer, with its own legend row, colour and 🏉 marker — first entries are two Fédérale 2 rugby matches (Avignon Le Pontet, Cavaillon) served by [oedb-rs](https://github.com/thepriben/oedb-rs).
- **Wikidata links in event popups**: when an event carries `type_wikidata`, `place_wikidata` or `wikidata` QIDs, the popup shows them as links to wikidata.org.
- **Marker clustering** on the Events layer (Leaflet.markercluster): nearby events (e.g. the four spread-out Jeudis d'Orange evenings) group into a category-coloured count badge that splits apart on zoom.
- **"Ajouter événement"** shortcut under the Events legend, deep-linking to the submission form on the oedb-rs site.

### Changed

- Single-day events now render a compact "weekday day month · HH:MM → HH:MM" period in their popup instead of the verbose "du … au …" range.

## [0.12.0] - 2026-08-06

### Added

- **"Events (OEDB)" incubator layer**, fed by a brand-new companion repository: [oedb-rs](https://github.com/thepriben/oedb-rs), a static [OpenEventDatabase](https://github.com/openeventdatabase/backend)-compatible instance written in Rust and served by GitHub Pages. It ingests the Bison Futé DATEX II feed filtered on Vaucluse (`traffic.accident`, `traffic.roadwork`, `traffic.jam`, …) plus manually curated events (the Jeudis d'Orange night markets, `culture.market.night`), purges expired events, and rebuilds every 3 hours.
- **Read API compatible with OEDB**: `GET /api/event.json` (GeoJSON FeatureCollection with OEDB properties), `GET /api/event/{id}.json`, `GET /api/stats.json`; sector queries (`bbox`, `what`, `when`) are provided client-side by `oedb-client.js`.
- **Write path via GitHub issues** (on the companion repository): a form on the oedb-rs Pages site (map click to pick the position) pre-fills a GitHub issue form; adding the `approved` label triggers a rebuild that validates, persists and publishes the event.
- The dataroads layer follows the standard incubator pattern: per-category legend rows (Accidents, Travaux, Bouchons, Culture, Autres) with clickable subtype filtering, freshness chip (3-hour schedule), URL state (`oedb`), and category-coloured emoji markers with detailed popups (dates, place, source).

## [0.11.14] - 2026-07-30

### Fixed

- **Clusters are rebuilt after filtering their contents.** Stop/give-way filtering already clears and recomputes its screen-grid clusters; network hierarchy likewise rebuilds route-label clusters. Bridge clusters now also recompute their size, label and tooltip after toggling Panoramax or Mapillary, using only photos from providers that remain visible.

## [0.11.13] - 2026-07-30

### Added

- **Clickable legend subtype rows, matching the network hierarchy.** A complete row now hides or shows its subtype independently, dims when disabled, supports keyboard activation, and puts the parent layer eye in a partial state. This applies to roadside areas, bicycle routes, construction/proposed roads, accident severity, traffic levels, current road-event types, stop/give-way signs, and webcam categories.

### Changed

- **Roadside-area filtering is now genuinely cartographic.** Car-pooling areas, rest areas, park-and-ride and laybys are stored in separate Leaflet subgroups, so clicking a legend row hides both the marker and any mapped footprint.
- **User guides updated** in French and English with the three visibility levels (family, layer, subtype).

## [0.11.12] - 2026-07-30

### Fixed

- **Real root cause of the Panoramax link opening our own map.** `roadsidePhotosHtml` runs outside the main `DOMContentLoaded` block, so it can only reach helpers exposed on `window` (as Mapillary already was). `panoramaxPageUrl`/`panoramaxImageUrl` were never exposed, so the reference resolved to `undefined` and the thumbnail href fell back to `#` — clicking then opened dataroads itself (its map) in a new tab. Now `window.panoramaxPageUrl`/`window.panoramaxImageUrl` are exposed and used, so the Panoramax thumbnail opens the real picture, symmetrically to Mapillary.

## [0.11.11] - 2026-07-30

### Changed

- **Centralised the Panoramax/Mapillary street-photo services.** All image URLs, viewer permalinks and provider labels now live in a single `StreetPhoto` service used by both the bridges and the roadside-area layers (backward-compatible wrappers kept), removing the previously duplicated helpers (`providerLabel`/`bridgeProviderLabel`, scattered URL builders).

### Fixed

- **Panoramax viewer link uses the app's own canonical permalink.** Following the format produced by the Panoramax viewer's own "Share" button — `${origin}/#focus=pic&pic=<id>` (hash, not query) — instead of the earlier query-string guesses that fell back to the map.

## [0.11.10] - 2026-07-30

### Fixed

- **Clicking a roadside-area photo no longer closes the popup.** The thumbnail now opens the source viewer in a new tab via an explicit handler that stops event propagation (keeps the Leaflet popup open) and opens exactly one tab.

### Changed

- **Legend label simplified.** "Aires d'arrêt (layby)" is now just "Aires d'arrêt".

## [0.11.9] - 2026-07-30

### Fixed

- **Panoramax photo link now really opens the picture (not the map).** Root cause found in the Panoramax web viewer: it decides the initial focus with `href.includes("&focus=pic")`, so `focus=pic` must be preceded by `&`. Our URL started with `?focus=pic&…`, so the check failed and it fell back to the map. Reordered to `?pic=…&seq=…&focus=pic`, making Panoramax behave symmetrically to the Mapillary link.

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
