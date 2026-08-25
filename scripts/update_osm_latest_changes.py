#!/usr/bin/env python3
"""Refresh the "derniers changements OSM" GeoJSON from an Overpass augmented diff.

Kept apart from ``update_osm_geojson.py`` because everything differs: the query
runs in ``adiff`` mode (XML only — the JSON writer refuses it), the cadence is
hourly rather than twice a week, and the output describes *changes* rather than
objects. Running it in CI is what keeps Overpass out of the browser: an
augmented diff over the whole department takes the better part of a minute,
which no visitor should ever wait for.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from project_meta import read_version, user_agent
from update_osm_geojson import write_json_if_changed

DATA_DIR = ROOT / "data" / "osm"
OUTPUT = DATA_DIR / "latest-changes.geojson"
ENDPOINT = os.environ.get("OVERPASS_ENDPOINT", "https://overpass-api.de/api/interpreter")
USER_AGENT = os.environ.get("OVERPASS_USER_AGENT", user_agent())
APP_VERSION = os.environ.get("APP_VERSION", read_version())

# Fenêtre glissante. Le serveur suivrait jusqu'à sept jours (une quarantaine de
# secondes), mais le fichier atteint alors 1,5 Mo, ce qui est beaucoup à
# committer toutes les heures. Trois jours couvrent un week-end pour ~400 ko.
WINDOW_DAYS = int(os.environ.get("LATEST_CHANGES_DAYS", "3"))

# Emprise du Vaucluse. L'``adiff`` n'accepte pas de filtre par zone
# administrative — il lui faut une boîte englobante, qui déborde largement sur
# le Gard, la Drôme et les Bouches-du-Rhône. On recadre donc sur la limite
# départementale après coup.
BBOX = (43.67, 4.64, 44.29, 5.76)
BOUNDARY = ROOT / "data" / "static" / "vaucluse-boundary.geojson"

# Classement des voies par importance, pour le filtre de la légende. L'ordre
# compte : la première classe qui reconnaît la valeur l'emporte.
AXIS_CLASSES = (
    ("main", {"motorway", "trunk", "primary", "motorway_link", "trunk_link", "primary_link"}),
    ("secondary", {"secondary", "tertiary", "secondary_link", "tertiary_link"}),
    ("local", {"residential", "unclassified", "living_street", "service", "road"}),
    ("path", {"track", "path", "footway", "cycleway", "bridleway", "steps", "pedestrian", "corridor"}),
    ("works", {"construction", "proposed"}),
)

# Tags d'identité, toujours conservés pour titrer la fiche même s'ils n'ont pas
# bougé. Le reste n'est gardé que s'il a changé.
IDENTITY_TAGS = ("highway", "name", "ref", "surface", "maxspeed")

MAX_TAG_CHANGES = 14
MAX_TAG_VALUE = 120


def load_boundary_rings() -> list[tuple[list[list[float]], tuple[float, float, float, float]]]:
    """Anneaux extérieurs du département, chacun avec sa boîte englobante.

    Les anneaux intérieurs sont ignorés : le Vaucluse n'a pas d'enclave d'un
    autre département, et une voie posée sur un trou serait de toute façon
    limitrophe donc digne d'être montrée.
    """
    if not BOUNDARY.exists():
        return []
    data = json.loads(BOUNDARY.read_text(encoding="utf-8"))
    geometries = [
        feature.get("geometry") or {}
        for feature in (data.get("features") or [{"geometry": data.get("geometry")}])
    ]
    rings: list[tuple[list[list[float]], tuple[float, float, float, float]]] = []
    for geometry in geometries:
        kind = geometry.get("type")
        if kind == "Polygon":
            polygons = [geometry.get("coordinates") or []]
        elif kind == "MultiPolygon":
            polygons = geometry.get("coordinates") or []
        else:
            continue
        for polygon in polygons:
            if not polygon:
                continue
            outer = polygon[0]
            if len(outer) < 4:
                continue
            lons = [point[0] for point in outer]
            lats = [point[1] for point in outer]
            rings.append((outer, (min(lons), min(lats), max(lons), max(lats))))
    return rings


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    """Lancer de rayon, sans dépendance externe (la CI n'installe rien ici)."""
    inside = False
    count = len(ring)
    j = count - 1
    for i in range(count):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < x_cross:
                inside = not inside
        j = i
    return inside


def geometry_touches_department(geometry: dict[str, Any], rings) -> bool:
    """Une voie est retenue dès qu'un de ses points tombe dans le département.

    Tester chaque sommet serait inutilement coûteux ; un échantillon suffit à
    trancher, et une voie frontalière mérite de toute façon d'être montrée.
    """
    if not rings:
        return True
    if geometry["type"] == "Point":
        samples = [geometry["coordinates"]]
    else:
        line = geometry["coordinates"][0] if geometry["type"] == "Polygon" else geometry["coordinates"]
        if not line:
            return False
        indexes = {0, len(line) - 1, len(line) // 2, len(line) // 4, 3 * len(line) // 4}
        samples = [line[i] for i in sorted(indexes)]

    for lon, lat in samples:
        for ring, (min_lon, min_lat, max_lon, max_lat) in rings:
            if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
                continue
            if point_in_ring(lon, lat, ring):
                return True
    return False


def build_query(since: datetime) -> str:
    south, west, north, east = BBOX
    return (
        f'[adiff:"{since.strftime("%Y-%m-%dT%H:%M:%SZ")}"]'
        f"[bbox:{south},{west},{north},{east}]"
        f"[out:xml][timeout:280];"
        f'way["highway"];'
        f"out geom meta;"
    )


def request_overpass(query: str) -> str:
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={
            "Accept": "application/xml",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read().decode("utf-8")


def axis_class(highway: str | None) -> str:
    if not highway:
        return "other"
    for name, values in AXIS_CLASSES:
        if highway in values:
            return name
    return "other"


def first_element(parent: ET.Element | None) -> ET.Element | None:
    if parent is None:
        return None
    return next((child for child in parent if child.tag in ("node", "way")), None)


def element_tags(element: ET.Element | None) -> dict[str, str]:
    if element is None:
        return {}
    return {tag.get("k"): tag.get("v") for tag in element.findall("tag") if tag.get("k")}


def element_geometry(element: ET.Element | None) -> dict[str, Any] | None:
    """Build a GeoJSON geometry from an ``out geom`` element.

    Ways carry their coordinates on each ``<nd>``; a way whose nodes were not
    all resolved yields holes, and a line with a hole cannot be drawn at all, so
    such a way is dropped rather than shown truncated.
    """
    if element is None:
        return None

    if element.tag == "node":
        lat, lon = element.get("lat"), element.get("lon")
        if lat is None or lon is None:
            return None
        return {"type": "Point", "coordinates": [round(float(lon), 5), round(float(lat), 5)]}

    if element.tag != "way":
        return None

    nodes = element.findall("nd")
    if not nodes:
        return None
    coordinates = []
    for node in nodes:
        lat, lon = node.get("lat"), node.get("lon")
        if lat is None or lon is None:
            return None
        coordinates.append([round(float(lon), 5), round(float(lat), 5)])
    if len(coordinates) < 2:
        return None

    if coordinates[0] == coordinates[-1] and len(coordinates) >= 4:
        return {"type": "Polygon", "coordinates": [coordinates]}
    return {"type": "LineString", "coordinates": coordinates}


def clip_value(value: str | None) -> str | None:
    if value is None:
        return None
    value = str(value)
    return value if len(value) <= MAX_TAG_VALUE else value[: MAX_TAG_VALUE - 1] + "…"


def tag_changes(old: dict[str, str], new: dict[str, str]) -> list[dict[str, Any]]:
    """Only what moved: storing both full tag sets would triple the file."""
    changes = []
    for key in sorted(set(old) | set(new)):
        before, after = old.get(key), new.get(key)
        if before == after:
            continue
        changes.append({"k": key, "old": clip_value(before), "new": clip_value(after)})
    return changes[:MAX_TAG_CHANGES]


def meta_properties(element: ET.Element) -> dict[str, Any]:
    return {
        "version": element.get("version"),
        "user": element.get("user"),
        "uid": element.get("uid"),
        "timestamp": element.get("timestamp"),
        "changeset": element.get("changeset"),
    }


def action_feature(
    action: str,
    element: ET.Element,
    meta: ET.Element,
    tags: dict[str, str],
    changes: list[dict[str, Any]],
    state: str,
) -> dict[str, Any] | None:
    geometry = element_geometry(element)
    if geometry is None:
        return None

    highway = tags.get("highway")
    properties: dict[str, Any] = {
        "action": action,
        "state": state,
        "osm_type": element.tag,
        "osm_id": element.get("id"),
        "highway": highway,
        "axis": axis_class(highway),
        **meta_properties(meta),
    }
    for key in IDENTITY_TAGS:
        if key != "highway" and tags.get(key):
            properties[key] = clip_value(tags[key])
    if state == "new" and changes:
        properties["changes"] = changes

    return {"type": "Feature", "geometry": geometry, "properties": properties}


def parse_actions(xml_text: str) -> tuple[list[dict[str, Any]], int, int]:
    root = ET.fromstring(xml_text)
    remark = root.find("remark")
    if remark is not None and remark.text:
        raise RuntimeError(f"Overpass remark: {remark.text.strip()}")

    features: list[dict[str, Any]] = []
    actions = root.findall("action")
    rings = load_boundary_rings()
    outside = 0
    kept_ids: set[str] = set()

    def keep(feature: dict[str, Any] | None) -> bool:
        nonlocal outside
        if feature is None:
            return False
        props = feature["properties"]
        # Le tracé d'avant suit le sort du tracé d'après : le recadrage doit
        # décider de l'objet, pas de chacune de ses deux géométries.
        if props["state"] == "old":
            if props["osm_id"] not in kept_ids:
                return False
        elif not geometry_touches_department(feature["geometry"], rings):
            outside += 1
            return False
        else:
            kept_ids.add(props["osm_id"])
        features.append(feature)
        return True

    for action in actions:
        kind = action.get("type")

        if kind == "create":
            element = first_element(action)
            if element is None:
                continue
            tags = element_tags(element)
            keep(action_feature("create", element, element, tags, tag_changes({}, tags), "new"))
            continue

        if kind not in ("modify", "delete"):
            continue

        # `or` est proscrit ici : un Element sans enfant est falsy, et c'est
        # exactement la forme du <new> d'une suppression (`visible="false"`).
        old_element = first_element(action.find("old"))
        new_element = first_element(action.find("new"))
        if old_element is None or new_element is None:
            continue

        old_tags = element_tags(old_element)
        new_tags = element_tags(new_element)

        if kind == "delete":
            # L'élément supprimé n'a plus ni géométrie ni tags : on affiche son
            # dernier état connu, mais crédité à qui l'a supprimé.
            keep(action_feature("delete", old_element, new_element, old_tags, tag_changes(old_tags, {}), "new"))
            continue

        changes = tag_changes(old_tags, new_tags)
        feature = action_feature("modify", new_element, new_element, new_tags, changes, "new")
        if not keep(feature):
            continue

        # Le tracé d'avant n'est conservé que s'il a réellement bougé : sur une
        # simple retouche de tags, il ferait doublon avec le nouveau.
        old_geometry = element_geometry(old_element)
        if old_geometry and old_geometry != feature["geometry"]:
            keep(action_feature("modify", old_element, new_element, old_tags, [], "old"))

    return features, len(actions), outside


def collection(features: list[dict[str, Any]], actions: int, since: datetime) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": features,
        "_cache": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "endpoint": ENDPOINT,
            "user_agent": USER_AGENT,
            "source_format": "overpass-adiff-xml",
            "source_elements": actions,
            "window_days": WINDOW_DAYS,
            "since": since.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "bbox": list(BBOX),
        },
    }


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    since = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)
    query = build_query(since)
    print(f"Overpass endpoint: {ENDPOINT}")
    print(f"Window: {WINDOW_DAYS} day(s), since {since:%Y-%m-%dT%H:%M:%SZ}")

    last_error: Exception | None = None
    xml_text = ""
    for attempt in range(1, 4):
        try:
            xml_text = request_overpass(query)
            break
        except (urllib.error.URLError, TimeoutError, ET.ParseError) as error:
            last_error = error
            if attempt == 3:
                print(f"latest-changes: giving up after {error}", file=sys.stderr)
                return 1
            wait_seconds = attempt * 20
            print(f"latest-changes: retry in {wait_seconds}s after {error}", file=sys.stderr)
            time.sleep(wait_seconds)

    try:
        features, actions, outside = parse_actions(xml_text)
    except (ET.ParseError, RuntimeError) as error:
        print(f"latest-changes: {error}", file=sys.stderr)
        return 1

    geojson = collection(features, actions, since)
    changed = write_json_if_changed(OUTPUT, geojson)
    state = "updated" if changed else "unchanged"
    size_kb = OUTPUT.stat().st_size / 1024
    print(
        f"{OUTPUT.relative_to(ROOT)}: {state}, {len(features)} features "
        f"from {actions} actions ({outside} hors Vaucluse), {size_kb:.0f} kB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
