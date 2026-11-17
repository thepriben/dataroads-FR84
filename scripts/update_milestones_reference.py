#!/usr/bin/env python3
"""Compare les PR d'OpenStreetMap au référentiel du Département (DataSud).

Le CD84 publie sur DataSud ses points de localisation (PLO) : un point par PR
du réseau qu'il gère, avec la route et le numéro. Les bornes d'OSM viennent en
grande partie d'un import CRIGE plus ancien. On rapproche les deux par route et
numéro, et l'on écrit une collection des PR du référentiel, chacun portant le
verdict de la comparaison :

- ``ok`` : la borne OSM de même route et même numéro est à moins de
  ``MATCH_METERS``.
- ``ecart`` : elle existe mais plus loin — l'une des deux positions est fausse.
- ``route`` : aucune borne OSM de cette route, mais une borne de même numéro se
  tient à l'emplacement, rattachée à une autre route (souvent l'ancien numéro
  d'une nationale déclassée).
- ``absent`` : rien dans OSM.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from project_meta import read_version, user_agent  # noqa: E402

APP_VERSION = os.environ.get("APP_VERSION", read_version())
USER_AGENT = os.environ.get("APP_USER_AGENT", user_agent())

WFS_BASE = "https://www.datasud.fr/fr/geoserv/conseil-departemental-de-vaucluse/ows"
WFS_LAYER = ("conseil-departemental-de-vaucluse:"
             "points-de-localisation-plo-du-reseau-routier-departemental-de-vaucluse")
SOURCE_NAME = "Points de Localisation (PLO) — Département de Vaucluse (DataSud)"
SOURCE_PAGE = ("https://www.datasud.fr/explorer/fr/jeux-de-donnees/"
               "points-de-localisation-plo-du-reseau-routier-departemental-de-vaucluse/info")

MILESTONES = ROOT / "data" / "osm" / "milestones.geojson"
OUTPUT = ROOT / "data" / "external" / "milestones-reference.geojson"

# Le 95e centile des écarts entre bornes appariées est à 16 m : au-delà de 25 m,
# l'écart ne tient plus à la précision du relevé.
MATCH_METERS = 25.0

COORD_DIGITS = 6

FIELD_ROAD = "voie_informations_nom_route_cd"
FIELD_PR = "plos_-_nom"


def normalize_road(value: Any) -> str | None:
    """« D 907g », « d907G » et « D907G » désignent la même route, comme
    « D162bis » du référentiel et « D162B » d'OSM."""
    if value is None:
        return None
    text = re.sub(r"\s+", "", str(value)).upper()
    text = re.sub(r"(\d)BIS$", r"\1B", text)
    return text or None


def road_aliases(value: Any) -> list[str]:
    """Le référentiel note parfois deux routes sur un même PR (« D63 - D63a »)."""
    if value is None:
        return []
    parts = [normalize_road(part) for part in str(value).split(" - ")]
    return [part for part in parts if part]


def normalize_pr(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text.lstrip("0") or ("0" if text else None)


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance plane en mètres entre deux couples (lon, lat) proches."""
    dx = (a[0] - b[0]) * math.cos(math.radians((a[1] + b[1]) / 2)) * 111_320
    dy = (a[1] - b[1]) * 110_540
    return math.hypot(dx, dy)


def _point(feature: dict[str, Any]) -> tuple[float, float] | None:
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates")
    if geometry.get("type") != "Point" or not coords or len(coords) < 2:
        return None
    return float(coords[0]), float(coords[1])


def compare(reference: Iterable[dict[str, Any]],
            milestones: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    osm: list[tuple[str | None, str | None, tuple[float, float], str]] = []
    by_key: dict[tuple[str, str], list[int]] = {}
    for feature in milestones:
        point = _point(feature)
        if not point:
            continue
        props = feature.get("properties") or {}
        road = normalize_road(props.get("road"))
        pr = normalize_pr(props.get("distance"))
        osm_id = str(props.get("osm_id") or feature.get("id") or "")
        osm.append((road, pr, point, osm_id))
        if road and pr:
            by_key.setdefault((road, pr), []).append(len(osm) - 1)

    by_pr: dict[str, list[int]] = {}
    for index, (_, pr, _, _) in enumerate(osm):
        if pr:
            by_pr.setdefault(pr, []).append(index)

    features = []
    for feature in reference:
        point = _point(feature)
        if not point:
            continue
        props = feature.get("properties") or {}
        roads = road_aliases(props.get(FIELD_ROAD))
        pr = normalize_pr(props.get(FIELD_PR))
        if not roads or not pr:
            continue

        out: dict[str, Any] = {"road": str(props.get(FIELD_ROAD)).strip(), "pr": pr}
        candidates = [i for road in roads for i in by_key.get((road, pr), [])]
        if candidates:
            best = min(candidates, key=lambda i: distance_m(osm[i][2], point))
            gap = distance_m(osm[best][2], point)
            out.update(status="ok" if gap <= MATCH_METERS else "ecart",
                       distance=round(gap), osm_id=osm[best][3])
        else:
            near = [i for i in by_pr.get(pr, []) if distance_m(osm[i][2], point) <= MATCH_METERS]
            if near:
                best = min(near, key=lambda i: distance_m(osm[i][2], point))
                out.update(status="route", distance=round(distance_m(osm[best][2], point)),
                           osm_id=osm[best][3], osm_road=osm[best][0])
            else:
                out["status"] = "absent"

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point",
                         "coordinates": [round(point[0], COORD_DIGITS), round(point[1], COORD_DIGITS)]},
            "properties": out,
        })

    features.sort(key=lambda f: (f["properties"]["road"], int(f["properties"]["pr"])
                                 if f["properties"]["pr"].isdigit() else 0, f["properties"]["pr"]))
    return features


def summarize(features: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"ok": 0, "ecart": 0, "route": 0, "absent": 0}
    for feature in features:
        counts[feature["properties"]["status"]] += 1
    return counts


def fetch_reference() -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeNames": WFS_LAYER, "outputFormat": "application/json", "srsName": "EPSG:4326",
    })
    request = urllib.request.Request(f"{WFS_BASE}?{query}", headers={
        "Accept": "application/json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = json.loads(response.read().decode("utf-8"))
    features = data.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("DataSud : collection PLO vide ou invalide")
    return features


def main() -> int:
    try:
        reference = fetch_reference()
    except Exception as error:  # noqa: BLE001
        # Le fichier précédent reste valable : le référentiel bouge peu.
        print(f"::warning title=DataSud injoignable::{error}")
        return 0

    milestones = json.loads(MILESTONES.read_text(encoding="utf-8")).get("features", [])
    features = compare(reference, milestones)
    counts = summarize(features)

    # Horodater seulement quand la comparaison change, sinon chaque passage
    # réécrirait le fichier pour rien.
    if OUTPUT.exists():
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        if previous.get("features") == features:
            print(f"milestones-reference: inchangé {counts}")
            return 0

    data = {
        "type": "FeatureCollection",
        "features": features,
        "_cache": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source_name": SOURCE_NAME,
            "source_url": SOURCE_PAGE,
            "match_meters": MATCH_METERS,
            "counts": counts,
            "user_agent": USER_AGENT,
        },
    }
    OUTPUT.write_text(json.dumps(data, ensure_ascii=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"milestones-reference: {len(features)} PR {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
