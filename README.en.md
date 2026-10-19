# dataroads-FR84 — Inforoute 084 Demo

[🇫🇷 Français](README.md) · 🇬🇧 English

> Project designer: Jean-Louis Zimmermann [@JLZIMMERMANN](https://github.com/JLZIMMERMANN), digital road tools officer at CD84 in 2026.

Web map prototype for exploring the departmental road network of Vaucluse (France).
This demonstrator, incubated within the Road Information Bureau (Vaucluse Departmental Council), brings several features together in a lightweight, intuitive tool: quick reading of the network, cross-referencing with accident data, locating traffic counting stations, and a first check of OpenStreetMap data quality.

## What the map shows

- The Vaucluse departmental road network, with a simple hierarchy: regional, territorial and local networks.
- The department boundary and the municipalities, to put roads in their territorial context.
- A territorial scale that narrows the displayed network to one sector (issues #21 and #37): road agency, maintenance centre, canton, intercommunality or municipality. The maintenance sectors come from the operating limits the Department publishes on DataSud, which are attached to road sections rather than drawn as areas — 57 municipalities are served by more than one centre, so no official area exists to overlay. The selection is carried in the URL, so a centre manager or a partner municipality can open straight onto its own perimeter. Every unit of the chosen scale has its outline drawn on the map, clickable to pick a sector. Selecting one fades out everything around it — a translucent veil pierced to the shape of the perimeter, putting the sector in relief without tinting it — and opens, on the right, a digest of what is known about it: mileage, sections, routes and municipalities crossed, then the split by network level, by speed limit, and the routes carrying the most kilometres. A single colour for every boundary, only the stroke pattern distinguishing them: solid for a constituency, whose perimeter is exact; dotted for a maintenance sector, whose perimeter is rebuilt by attaching each municipality to the sector maintaining the most mileage within it — the discrepancy this shortcut introduces is stated on screen, 2.1 % of the mileage for agencies and 5.8 % for centres. An intercommunality's outline is reassembled from the boundaries of its member municipalities, no source publishing it, and stops at the department boundary for the six that extend beyond it.
- CD84 traffic counting stations, classified by traffic level.
- Multi-year accident data (BAAC, 2019-2024) rendered as a cloud: colour by recency, severity shown by a black ring (hospitalised and fatal), with a per-year histogram and a year slider to explore the trend.
- Roads under construction or planned, from the OSM cache.
- Roadside stopping areas along departmental roads (issue #7): car-pooling areas, rest areas and park-and-ride from OpenStreetMap, with an OSM completeness indicator and nearby street-level photos (Mapillary / Panoramax).
- Current weather over Avignon, useful as a quick operational signal.
- Community Waze traffic (jams and incidents): a native layer (coloured jam lines + incident markers) when the *Waze for Cities* partner feed is configured, otherwise the embedded Waze Live Map as a fallback.
- An "Events (OEDB)" real-time layer: Bison Futé accidents, roadworks and jams, plus curated cultural events (e.g. the Jeudis d'Orange night markets), served by our static [OpenEventDatabase](https://github.com/openeventdatabase/backend) instance [oedb-rs](https://github.com/thepriben/oedb-rs) (Rust + GitHub Pages, rebuilt every 3 hours).
- An OSM quality panel to spot road sections that do or do not have a usable OSM relation.

## Value for CD84

The prototype's main purpose is to make road data readable in a single interface. For a field agent or a business manager, it helps answer simple questions quickly:

- Where are the most structuring departmental roads?
- Which roads carry the heaviest traffic according to available counts?
- Where and when do accidents concentrate, and how have they evolved since 2019?
- Which municipalities are affected by a road or an axis?
- Which OSM road sections are well documented, and which deserve a correction?
- Can a file published on data.gouv.fr or an OSM extract be used without calling APIs on every visit?

## Data freshness

The page indicates external data refreshed every 3 hours. The browser reads local GeoJSON files, and the update scripts regenerate those files.

- Static data: roads, department boundary, municipalities, accident data, and demo fallback.
- Data refreshed every 3 hours: CD84 traffic counts from data.gouv.fr and Info Routière events.
- Direct dynamic data: Open-Meteo weather, requested by the browser at load time and then every 10 minutes.
- Overpass API: never called by the browser. It is only used by the OSM refresh script.

OSM caches (and their Wikidata links) are refreshed on Mondays and Thursdays. A
dataset refused by Overpass keeps its previous file rather than writing a truncated
one, and the run stays green as long as at least one dataset could be read — a
permanently red light warns of nothing any more.

**Daily catch-up.** An extra pass runs every day at 04:47 UTC and takes back only
the datasets that are genuinely overdue
(`python3 scripts/update_osm_geojson.py --stale-only`). A dataset is overdue when
its cache is older than **four days and an hour**: four days is the longest
legitimate gap between two extractions (Thursday to Monday), and the hour absorbs
GitHub Actions scheduling delays. The timestamp consulted is the OSM cut-off
announced by Overpass (`_cache.source_timestamp`), falling back to the write time;
a missing or unreadable file counts as overdue. When nothing is late the catch-up
issues no Overpass request at all and exits in under a second — the full pass makes
twelve and takes a quarter of an hour. If Overpass stays broken the catch-up remains
one attempt a day: the selection is read from the files on disk, so a failed
catch-up cannot feed itself. The same pass can be triggered by hand through the
workflow's `stale_only` input.

**Freshness pills.** Under each layer, a pill announces the age of the data and the
next due date. When a dataset has missed its appointment — age greater than its
announced period plus an hour of grace — the pill says so explicitly, "en retard",
and turns amber, the single colour departure in an otherwise grey series. The
*Formule de rafraîchissement* section follows, qualified by the oldest dataset of
its group. A pill fades out when its layer is switched off, unless it is late:
since most layers start switched off, muting it would mean waiting for someone to
turn on the right one to discover the delay.

## Vintage consistency

State of the dataset versioned in this repository:

| Data | Source | Vintage or freshness | Comment |
| --- | --- | --- | --- |
| Departmental roads | OpenStreetMap | cache from 2026-05-17 22:52 UTC | Network data, not a CD84 administrative vintage. |
| Roads under construction | OpenStreetMap | cache from 2026-05-17 22:53 UTC | Some openings indicated between 2025 and 2027 according to OSM tags. |
| Declassified sections | OpenStreetMap | twice-weekly cache (Mon. & Thu.) | 1,386 sections, 179 km, 92 former numbers: roads that once carried a departmental number and no longer do (issue #38), read from `was:ref` and `old_ref` while excluding the national roads transferred to the department in 2006. Volunteer survey, with no official source and no date; never counted with the network. |
| Municipalities | OpenStreetMap | cache from 2026-05-17 22:53 UTC | 151 municipalities; population tags point to 2021. |
| Roadside areas & car-pooling | OpenStreetMap | twice-weekly cache (Mon & Thu) | 213 areas: car-pooling, rest areas, park-and-ride and laybys along departmental roads (issue #7), nodes / ways / relations, generated by `scripts/update_osm_geojson.py`. |
| Signposts & town-boundary signs | OpenStreetMap | twice-weekly cache (Mon & Thu) | 2,167 direction masts (`information=guidepost`, ~1,450 with a referenced photo) and 468 town-boundary signs (`traffic_sign=city_limit`), generated by `scripts/update_osm_geojson.py`. |
| Vaucluse boundary | OpenStreetMap | local GeoJSON | Department 84 boundary, frozen in `data/static/`. |
| Accident data | BAAC / ONISR (data.gouv.fr) | 2019-2024 | 1,923 geolocated injury crashes (dept. 84), generated by `scripts/build_accidents_vaucluse.py`. |
| CD84 traffic counts | data.gouv.fr | 1996-2025 | 3,098 observations; the map displays the latest available year per station. |
| Road events | Info Routière | 3-hour cache | |
| Events (OEDB) | Bison Futé + curation, via [oedb-rs](https://github.com/thepriben/oedb-rs) | every 3 hours | Static OpenEventDatabase instance (Rust, GitHub Pages), read directly by the browser. |
| Weather | Open-Meteo | current conditions | Direct call, not versioned. |

## Running the demo locally

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080/
```

## User guide

The FR guide (`guide.html`) is generated from `docs/guide.wiki` (Wiki syntax, MediaWiki style):

```bash
python3 scripts/build_guide.py
```

After editing the Wiki, regenerate the page and commit `docs/guide.wiki` and `guide.html` together. The EN guide (`guide.en.html`) is maintained by hand: mirror the equivalent changes there.

## Technical overview

The data architecture is separated by usage:

- `data/osm/`: GeoJSON derived from OpenStreetMap, generated via Overpass by a script.
- `data/static/`: frozen GeoJSON, such as the Vaucluse boundary and the 2019-2024 accident data.
- `data/external/`: GeoJSON automatically refreshed from external sources.
- `data/demo/`: fallback data to keep the map usable if a source is missing.

`js/config.js` centralises file paths and dynamic sources. `js/api.js` provides a JSON/GeoJSON loader with browser cache. `js/app.js` reads the files declared in the configuration.

The basemap is the Géoplateforme **IGN Plan**, in **raster** tiles, keyless and quota-free. Raster rather than vector: a tile arrives already drawn and shows as soon as it lands, where a vector basemap means loading MapLibre GL (1 MB of JavaScript) and redrawing everything before the first image appears — zooming out, a vector tile weighs 189 KB against 59 KB here. The IGN Plan is talkative in colour for something meant to sit behind data, so it is desaturated by a CSS filter (`basemap.filter`), which the compositor applies for free.

The basemap **exists over Vaucluse only**. `basemap.focus.bounds` bounds the layer to the department's extent, and the boundary is painted once into an offscreen canvas to serve as a mask: every tile asks it whether it has anything to show, so corner tiles are never even requested. Beyond that, a sober flat colour (`basemap.focus.veilColor`, echoed as the container background) covers whatever spills out. The 3D bridge viewer takes the same IGN Plan, which carries the CORS headers that painting tiles onto a canvas demands.

The map **opens at its final framing**, worked out from that same extent before any tile layer exists. It used to open at a zoom written into the source and reframe itself once the boundary arrived, loading two levels of tiles where only one is read: 31 tiles in a 1440-wide window against 16, and 17 on a phone against 6. The `preconnect` declared in the head also opens the connection to the Géoplateforme while the page is still parsing, without which the name lookup and TLS handshake would not begin until the map had been built.

**Five basemaps are offered** (`basemaps` in `js/config.js`), the IGN Plan remaining the default: the IGN's BD ORTHO and Esri imagery for aerial views, OpenStreetMap and OpenStreetMap France to see the data as contributors see it. All raster, free and keyless. Switching replaces the layer rather than stacking a second one, and the new layer inherits the clipping mask — without which a switch would send requests across the whole tile rectangle again, Drôme and Gard included. Desaturation belongs to the entry rather than to the map: plans get one, aerial views none. The active basemap is written into the URL (`bg=`), except when it is the default one. The 3D bridge viewer keeps the IGN Plan whichever basemap is shown: it paints its tiles onto a canvas, which demands CORS headers not every provider grants.

**Each entry shows a thumbnail** rather than just its name: a real tile of the department, Avignon at zoom 13, served by the provider itself and wearing the entry's own filter — desaturated for a plan, plain for an aerial view. None of it is requested at startup: the five tiles leave only when the panel is first opened, and the elements are kept and moved from one render to the next rather than copied, so later openings ask the network for nothing. Measured in Chrome: 0 requests before the first opening, 5 requests and 178 kB on it, 0 afterwards. Zoom 13 rather than 12 costs six kilobytes more and keeps a tile shrunk to fifty pixels from mashing the city into a pulp in which the three plans look alike.

The panel **behaves like the radio group it declares**: arrows with wrap-around, `Home` and `End`, `Escape` to close while handing focus back to the button, and focus placed on the basemap in force when it opens. The arrows move focus without choosing, space or enter confirms: choosing replaces the tile layer, and walking through the five basemaps to reach the last would have ordered five sets of tiles. Only the basemap in force is in the tab order. A click anywhere outside closes the panel, not just a click on the map. Its vertical offset is derived from the toolbar's measured bottom edge, the toolbar's height varying with the window width: the gap is 8 pixels at every size, where a hard-coded offset grazed it.

**No place-name overlay on the aerial views**, for want of a clean source. All 870 WMTS layers of the Géoplateforme were listed: none is a transparent labels-only raster. CARTO's `light_only_labels` answers 200 without a key but returns the same bytes at every zoom — the "API KEY REQUIRED" stamp already documented here for Positron. Stadia, which inherited the Stamen basemaps, answers 401. Esri's two world reference layers are genuinely free and keyless, but overlaid on the orthophoto they place only one or two toponyms per tile up to zoom 14 and then nothing: they go quiet exactly where an aerial view earns its keep, on the junction being examined at zoom 16.

A lighter basemap was looked for and does not exist on these terms. Against the IGN Plan's 87 KB and 0.65 s per tile, CARTO Positron comes in at 10 KB and 0.09 s and Esri Light Gray at 3.5 KB — but CARTO stamps "API KEY REQUIRED" across tiles served without a key, and Esri has required an account since April 2022. Asking the Géoplateforme for JPEG rather than PNG, which would have cut the weight without changing anything else, returns HTTP 400: the layer is PNG only.

Two Python scripts maintain the data:

```bash
python3 scripts/update_osm_geojson.py
python3 scripts/update_external_data.py
```

`scripts/update_osm_geojson.py` queries Overpass with an explicit `User-Agent`:

```text
dataroads-FR84/<version> (https://github.com/thepriben/dataroads-FR84)
```

With no argument it processes all twelve datasets. It also accepts dataset names as
positional arguments (`python3 scripts/update_osm_geojson.py declassified-roads`)
and the `--stale-only` option, which restricts the pass to overdue datasets and
exits without asking Overpass for anything when there are none.

`scripts/update_external_data.py` materialises data.gouv.fr and Info Routière data into `data/external/`. If Info Routière is unavailable, the script keeps an empty GeoJSON with the error recorded in `_cache`.

### Enabling the native Waze layer

Waze exposes no open per-area API (the live-map endpoint returns HTTP 403 to datacenter IPs, so it cannot be used in CI). The native layer therefore relies on the official **[Waze for Cities](https://www.waze.com/wazeforcities/)** partner feed (free, on registration). Once you have the feed URL, add it as the `WAZE_FEED_URL` **repository secret**: the *Update External Data* workflow then generates `data/external/waze.geojson` (alerts + jams) every 3 h, and the front-end automatically switches to the native layer. Without the secret, the **W** button opens the Waze Live Map embed as a fallback.

## Articles & presentations

- [Structuring Road Information in Open Data: A Nested Wikidata – OSM – BD TOPO (IGN) Architecture Co-produced by Territorial Authorities](https://2026.stateofthemap.org/sessions/VS9YKN/) — Jean-Louis Zimmermann, State of the Map 2026, Paris.

## Inspirations

- The accident-data visualisation (multi-year cloud, colour by recency, severity shown by a ring, year filter) draws heavily on [Loïc Bertrand's "Victimes de la route"](https://www.loicbertrand.eu/accidents/). Many thanks to him.
