# Dashboard KPI spec — Phase 1 (Vaucluse department)

## UX pattern (decision)

**Full-screen overlay panel** toggled from the map toolbar (same interaction model as `#qualityPanel`, wider layout). Keeps the single-page architecture; a dedicated `dashboard.html` is deferred to a later iteration if the dashboard becomes the primary entry point.

## Vintage display (decision)

No global “current year” filter — each tile shows its own data vintage because sources are heterogeneous:

| Theme | Vintage label |
| --- | --- |
| Network / quality / véloroutes / construction | OSM cache date (relative badge text) |
| Traffic counting | “Dernière année par station” + year range when known |
| Accidentology | “Millésime 2024” (BAAC static file) |
| Road events | “Cache 3 h” (Info Routière / Bison Futé) |
| Weather | “Temps réel · Avignon” |

## Phase 1 KPI tiles (validated for MVP)

### Réseau
- Unique departmental routes (`refs`)
- Cumulative network length (km)
- Hierarchy split: regional / territorial / local route counts

### Trafic
- Active counting stations (latest year per station)
- AADT range (min – max véh/j)
- Stations by tier (high / medium / low)

### Sécurité
- Accidents 2024: total, fatal, hospitalized, light

### Temps réel
- Active road events in Vaucluse bbox: works, congestion, accidents

### Véloroutes & chantiers
- Structurante segments (EV17 + EV8 + V861)
- Construction + proposed road segments

### Qualité données
- Wikidata coverage (%)
- OSM relation coverage (%)

## Tile interaction

Clicking a tile closes the dashboard and activates the related map layer (or opens the OSM quality panel for quality tiles).
