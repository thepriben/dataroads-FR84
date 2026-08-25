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
import math
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

# Fenêtre glissante : une semaine de recul sur les contributions. Overpass la
# calcule en une quarantaine de secondes, et le recadrage départemental joint au
# tri des retouches imperceptibles maintient le fichier à une taille raisonnable
# pour un commit horaire.
WINDOW_DAYS = int(os.environ.get("LATEST_CHANGES_DAYS", "7"))

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

# Overpass accepte de longues listes d'identifiants, mais on découpe pour
# garder des requêtes lisibles et des échecs partiels supportables.
NODE_META_BATCH = 400

# Répit laissé au serveur entre l'``adiff`` et la requête des sommets.
NODE_META_PAUSE = float(os.environ.get("LATEST_CHANGES_NODE_PAUSE", "5"))

# Sous ce seuil, le sommet a été recalé de si peu que l'ancien tracé se confond
# avec le nouveau à l'écran : signaler un tel changement ne ferait que noyer
# ceux qui se voient. Ne s'applique qu'aux voies non rééditées par ailleurs.
MIN_MOVE_METRES = float(os.environ.get("LATEST_CHANGES_MIN_MOVE", "1"))

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


def request_overpass_with_retry(query: str, label: str, attempts: int = 3) -> str | None:
    """Interroge Overpass en réessayant : un 504 signe un serveur occupé.

    Toutes les requêtes du script ont besoin de cette patience, pas seulement
    l'``adiff`` : la requête des sommets part juste derrière lui, quand le
    serveur est le plus chargé, et c'est elle qui décide si un déplacement de
    tracé sera crédité à quelqu'un ou restera anonyme.
    """
    for attempt in range(1, attempts + 1):
        try:
            return request_overpass(query)
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == attempts:
                print(f"latest-changes: giving up on {label} after {error}", file=sys.stderr)
                return None
            wait_seconds = attempt * 20
            print(f"latest-changes: retry {label} in {wait_seconds}s after {error}", file=sys.stderr)
            time.sleep(wait_seconds)
    return None


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
    # Pas d'``uid`` : les liens vers un profil se font par nom d'utilisateur.
    return {
        "version": element.get("version"),
        "user": element.get("user"),
        "timestamp": element.get("timestamp"),
        "changeset": element.get("changeset"),
    }


def metres_between(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Approximation équirectangulaire : à l'échelle d'un sommet, elle suffit."""
    mean_lat = math.radians((lat1 + lat2) / 2)
    dx = (lon2 - lon1) * 111320 * math.cos(mean_lat)
    dy = (lat2 - lat1) * 110540
    return math.hypot(dx, dy)


def moved_node_ids(old_element: ET.Element, new_element: ET.Element) -> tuple[list[str], float]:
    """Nœuds communs aux deux versions dont la position a changé, et de combien.

    C'est la seule trace du déplacement : l'``adiff`` renvoie les sommets d'une
    voie sans la moindre métadonnée, juste ``ref``, ``lat`` et ``lon``. La
    distance se calcule ici, sur les coordonnées brutes — l'arrondi appliqué à
    la sortie effacerait justement les déplacements que l'on veut mesurer.
    """
    before = {
        node.get("ref"): (node.get("lat"), node.get("lon"))
        for node in old_element.findall("nd")
        if node.get("ref")
    }
    moved: list[str] = []
    largest = 0.0
    for node in new_element.findall("nd"):
        ref = node.get("ref")
        if not ref or ref not in before:
            continue
        old_lat, old_lon = before[ref]
        new_lat, new_lon = node.get("lat"), node.get("lon")
        if (old_lat, old_lon) == (new_lat, new_lon):
            continue
        moved.append(ref)
        if None in (old_lat, old_lon, new_lat, new_lon):
            continue
        largest = max(
            largest,
            metres_between(float(old_lat), float(old_lon), float(new_lat), float(new_lon)),
        )
    return moved, largest


def fetch_node_meta(node_ids: list[str]) -> dict[str, dict[str, str]]:
    """Qui a déplacé ces nœuds, et quand.

    Requête ordinaire par identifiants, sans ``adiff`` : elle ne coûte presque
    rien puisqu'on ne demande que les métadonnées de la dernière version, qui
    est justement le déplacement recherché.
    """
    meta: dict[str, dict[str, str]] = {}
    if not node_ids:
        return meta

    # L'``adiff`` vient de mobiliser le serveur une quarantaine de secondes :
    # enchaîner sans reprendre son souffle, c'est se faire refouler.
    time.sleep(NODE_META_PAUSE)

    for start in range(0, len(node_ids), NODE_META_BATCH):
        batch = node_ids[start : start + NODE_META_BATCH]
        label = f"node metadata {start // NODE_META_BATCH + 1}"
        query = f'[out:xml][timeout:180];node(id:{",".join(batch)});out meta;'
        payload = request_overpass_with_retry(query, label)
        # Un lot perdu ne doit pas coûter les autres : chaque sommet résolu est
        # un déplacement de plus qui portera le nom de son auteur.
        if payload is None:
            continue
        try:
            root = ET.fromstring(payload)
        except ET.ParseError as error:
            print(f"latest-changes: unreadable {label} ({error})", file=sys.stderr)
            continue
        for node in root.findall("node"):
            node_id = node.get("id")
            if node_id:
                meta[node_id] = meta_properties(node)
    return meta


def attribute_geometry_moves(features: list[dict[str, Any]]) -> tuple[int, int]:
    """Recrédite les voies dont seul le tracé a bougé.

    Sans cela, la fiche affiche la dernière retouche de la voie elle-même, qui
    peut remonter à des années alors que le déplacement date de cette semaine.
    """
    pending = [
        feature
        for feature in features
        if feature["properties"].get("_geometry_only")
    ]
    wanted = sorted({
        node_id for feature in pending for node_id in feature["properties"].get("_moved") or []
    })
    meta = fetch_node_meta(wanted)

    attributed = 0
    for feature in pending:
        moved = feature["properties"].get("_moved")
        # Le sommet déplacé le plus récemment porte la date du changement vu.
        candidates = [meta[node_id] for node_id in (moved or []) if node_id in meta]
        newest = max(candidates, key=lambda item: item.get("timestamp") or "", default=None)
        feature["properties"]["moved_only"] = True
        if newest:
            feature["properties"].update(
                {
                    "user": newest.get("user"),
                    "timestamp": newest.get("timestamp"),
                    "changeset": newest.get("changeset"),
                    "via_node": True,
                }
            )
            attributed += 1
        else:
            # Mieux vaut ne rien affirmer qu'attribuer le déplacement à
            # l'auteur d'une édition sans rapport, vieille de plusieurs années.
            for key in ("user", "timestamp", "changeset"):
                feature["properties"][key] = None

    for feature in features:
        feature["properties"].pop("_geometry_only", None)
        feature["properties"].pop("_moved", None)
    return attributed, len(pending)


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
    axis = axis_class(highway)

    # Le tracé d'avant n'est qu'un repère visuel : il n'ouvre pas de fiche, et
    # ne porte donc que de quoi être filtré comme le tracé actuel. Répéter
    # l'auteur et les tags y coûterait 70 ko par fichier pour rien.
    if state == "old":
        return {
            "type": "Feature",
            "geometry": geometry,
            "properties": {"state": "old", "osm_id": element.get("id"), "axis": axis},
        }

    properties: dict[str, Any] = {
        "action": action,
        "state": state,
        "osm_type": element.tag,
        "osm_id": element.get("id"),
        "highway": highway,
        "axis": axis,
        **meta_properties(meta),
    }
    for key in IDENTITY_TAGS:
        if key != "highway" and tags.get(key):
            properties[key] = clip_value(tags[key])
    if changes:
        properties["changes"] = changes

    return {"type": "Feature", "geometry": geometry, "properties": properties}


def parse_actions(xml_text: str) -> tuple[list[dict[str, Any]], int, int, int]:
    root = ET.fromstring(xml_text)
    remark = root.find("remark")
    if remark is not None and remark.text:
        raise RuntimeError(f"Overpass remark: {remark.text.strip()}")

    features: list[dict[str, Any]] = []
    actions = root.findall("action")
    rings = load_boundary_rings()
    outside = 0
    negligible = 0
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

        # Version inchangée : la voie n'a pas été éditée, ce sont ses sommets
        # qui ont bougé. Ses métadonnées ne disent donc rien du changement vu.
        geometry_only = old_element.get("version") == new_element.get("version")
        moved: list[str] = []
        shift = 0.0
        if geometry_only:
            moved, shift = moved_node_ids(old_element, new_element)
            if shift < MIN_MOVE_METRES:
                negligible += 1
                continue

        feature = action_feature("modify", new_element, new_element, new_tags, changes, "new")
        if not keep(feature):
            continue
        if geometry_only:
            feature["properties"]["_geometry_only"] = True
            feature["properties"]["_moved"] = moved
            feature["properties"]["moved_metres"] = round(shift, 1)

        # Le tracé d'avant n'est conservé que s'il a réellement bougé : sur une
        # simple retouche de tags, il ferait doublon avec le nouveau.
        old_geometry = element_geometry(old_element)
        if old_geometry and old_geometry != feature["geometry"]:
            keep(action_feature("modify", old_element, new_element, old_tags, [], "old"))

    return features, len(actions), outside, negligible


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

    xml_text = request_overpass_with_retry(query, "augmented diff")
    if xml_text is None:
        return 1

    try:
        features, actions, outside, negligible = parse_actions(xml_text)
    except (ET.ParseError, RuntimeError) as error:
        print(f"latest-changes: {error}", file=sys.stderr)
        return 1

    attributed, moves = attribute_geometry_moves(features)
    if moves:
        # Le manque se lit dans le journal : une attribution tombée à zéro est
        # une panne de la requête des sommets, pas une semaine sans déplacement.
        print(f"Geometry-only moves credited to their node author: {attributed}/{moves}")
        if attributed < moves:
            print(
                f"latest-changes: {moves - attributed} move(s) left without an author",
                file=sys.stderr,
            )

    geojson = collection(features, actions, since)
    changed = write_json_if_changed(OUTPUT, geojson)
    state = "updated" if changed else "unchanged"
    size_kb = OUTPUT.stat().st_size / 1024
    print(
        f"{OUTPUT.relative_to(ROOT)}: {state}, {len(features)} features "
        f"from {actions} actions ({outside} hors Vaucluse, "
        f"{negligible} recalages < {MIN_MOVE_METRES:g} m), {size_kb:.0f} kB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
