# Phase 2 — Territorial dashboard scales

Phase 1 delivers department-level KPIs for Vaucluse (84). Phase 2 adds territorial filtering and aggregation aligned with road-management units.

## Missing data sources (to ingest)

| Territory | Source | URL |
| --- | --- | --- |
| Agences routières | DataSud | https://www.datasud.fr/explorer/fr/jeux-de-donnees/zones-competences-des-agences-routieres/info |
| Centres routiers | DataSud | https://www.datasud.fr/explorer/fr/jeux-de-donnees/zones-competences-des-centres-routiers/info |
| Communes | Already in repo | `data/osm/communes-vaucluse.geojson` (151 features) |
| Cantons | To add | admin-express / data.gouv.fr INSEE contours |
| EPCI | To add | admin-express / data.gouv.fr intercommunal boundaries |

## Proposed ingestion pipeline

```text
scripts/update_territorial_data.py
  → fetch DataSud WFS/API (agences + centres)
  → fetch canton/EPCI GeoJSON (IGN or data.gouv.fr)
  → write data/static/territorial/*.geojson
  → attach _cache metadata (same pattern as external data)
```

Optional GitHub Actions workflow: monthly refresh (territorial boundaries change rarely).

## Spatial join strategy

1. **Routes × territory**: for each departmental road polyline, compute midpoint (or majority of length) and point-in-polygon against territory layers.
2. **Accidents × commune**: use existing `commune` property; enrich with spatial join to EPCI/canton lookup table.
3. **Traffic stations × territory**: point-in-polygon on station coordinates.
4. **Events × territory**: filter Bison Futé markers by territory bbox/polygon.

## UI evolution

- Territory selector in dashboard header (department → agence → centre → EPCI → commune).
- KPI tiles recalculate from `dashboardMetrics` filtered by selected polygon.
- Map highlights selected territory boundary; optional choropleth for one KPI (e.g. accidents per commune).

## Dependencies

- Phase 1 `window.dashboardMetrics` store and `renderDashboard()` — extend with `territoryId` filter parameter.
- Commune layer currently load-on-demand only; phase 2 should preload boundaries for spatial joins (client-side Turf.js or precomputed lookup in Python script).

## Out of scope for phase 2 MVP slice

- obserVaucluse demographic indicators (population economy) — different data domain unless explicitly requested.
- PDF export / printable reports.
