#!/usr/bin/env python3
"""Refresh static GeoJSON files from Overpass for the GitHub Pages site."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from project_meta import read_version, user_agent

DATA_DIR = ROOT / "data" / "osm"
ENDPOINT = os.environ.get("OVERPASS_ENDPOINT", "https://overpass-api.de/api/interpreter")
APP_VERSION = os.environ.get("APP_VERSION", read_version())
USER_AGENT = os.environ.get("OVERPASS_USER_AGENT", user_agent())


QUERIES = {
    "departmental-roads": """
        [out:json][timeout:60];
        area["ISO3166-2"="FR-84"]->.dept;
        (
          way(area.dept)["highway"]["ref"~"^D ?[0-9]+$"];
          relation(area.dept)["type"="route"]["route"="road"]["ref"~"^D ?[0-9]+$"];
        );
        out geom;
        out tags;
    """,
    "construction-roads": """
        [out:json][timeout:60];
        area["ISO3166-2"="FR-84"]->.dept;
        (
          way(area.dept)["highway"="construction"];
          way(area.dept)["construction"="highway"];
          way(area.dept)["construction"]["highway"];
          way(area.dept)["construction:highway"];
          way(area.dept)["highway"="proposed"];
          way(area.dept)["proposed"="highway"];
          way(area.dept)["proposed:highway"];
        );
        out geom;
    """,
    "communes-vaucluse": """
        [out:json][timeout:60];
        area["ISO3166-2"="FR-84"]->.dept;
        relation(area.dept)["boundary"="administrative"]["admin_level"="8"];
        out geom;
    """,
    "bicycle-routes": """
        [out:json][timeout:120];
        area["ISO3166-2"="FR-84"]->.dept;
        relation(area.dept)["type"="route"]["route"="bicycle"];
        out body;
        >;
        out geom;
    """,
    "bridges": """
        [out:json][timeout:120];
        area["ISO3166-2"="FR-84"]->.dept;
        (
          way(area.dept)["man_made"="bridge"];
          way(area.dept)["bridge:support"];
          way(area.dept)["bridge:structure"];
          relation(area.dept)["man_made"="bridge"];
        );
        out tags geom;
    """,
    "road-signs": """
        [out:json][timeout:90];
        area["ISO3166-2"="FR-84"]->.dept;
        (
          node(area.dept)["highway"="stop"];
          node(area.dept)["highway"="give_way"];
        );
        out geom;
    """,
    "guideposts": """
        [out:json][timeout:90];
        area["ISO3166-2"="FR-84"]->.dept;
        (
          node(area.dept)["information"="guidepost"];
        );
        out geom;
    """,
    # Panneaux d'entrée / sortie d'agglomération (EB10 / EB20) : ils marquent le
    # basculement du régime de vitesse en traversée de village, donc utiles en
    # regard des limitations.
    "city-limits": """
        [out:json][timeout:90];
        area["ISO3166-2"="FR-84"]->.dept;
        (
          node(area.dept)["traffic_sign"~"city_limit"];
        );
        out geom;
    """,
    # Aires connexes le long des RD (issue #7) : covoiturage, aires de repos et
    # parkings-relais (park&ride). On limite volontairement le stationnement aux
    # parkings-relais pour rester sur les "aires d'arrêt le long des RD" et éviter
    # les ~8000 parkings privés du département.
    "roadside-areas": """
        [out:json][timeout:120];
        area["ISO3166-2"="FR-84"]->.dept;
        (
          node(area.dept)["amenity"="car_pooling"];
          way(area.dept)["amenity"="car_pooling"];
          relation(area.dept)["amenity"="car_pooling"];
          node(area.dept)["highway"="rest_area"];
          way(area.dept)["highway"="rest_area"];
          relation(area.dept)["highway"="rest_area"];
          node(area.dept)["amenity"="parking"]["park_ride"];
          way(area.dept)["amenity"="parking"]["park_ride"];
          relation(area.dept)["amenity"="parking"]["park_ride"];
          node(area.dept)["amenity"="parking"]["parking"="layby"];
          way(area.dept)["amenity"="parking"]["parking"="layby"];
          relation(area.dept)["amenity"="parking"]["parking"="layby"];
        );
        out geom;
    """,
}


def request_overpass(query: str) -> dict[str, Any]:
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_ref(value: str | None) -> str:
    if not value:
        return ""
    return value.replace(" ", "").upper()


def point_key(coord: list[float]) -> tuple[float, float]:
    return round(coord[0], 7), round(coord[1], 7)


def element_properties(element: dict[str, Any]) -> dict[str, Any]:
    properties = dict(element.get("tags") or {})
    properties["osm_type"] = element.get("type")
    properties["osm_id"] = element.get("id")
    properties["@id"] = f"{element.get('type')}/{element.get('id')}"
    return properties


def way_to_feature(element: dict[str, Any], extra_properties: dict[str, Any] | None = None) -> dict[str, Any] | None:
    coordinates = [
        [point["lon"], point["lat"]]
        for point in element.get("geometry", [])
        if "lon" in point and "lat" in point
    ]

    if len(coordinates) < 2:
        return None

    properties = element_properties(element)
    if extra_properties:
        properties.update(extra_properties)

    return {
        "type": "Feature",
        "id": properties["@id"],
        "geometry": {
            "type": "LineString",
            "coordinates": coordinates,
        },
        "properties": properties,
    }


def way_to_area_or_line_feature(element: dict[str, Any], extra_properties: dict[str, Any] | None = None) -> dict[str, Any] | None:
    coordinates = [
        [point["lon"], point["lat"]]
        for point in element.get("geometry", [])
        if "lon" in point and "lat" in point
    ]

    if len(coordinates) < 2:
        return None

    properties = element_properties(element)
    if extra_properties:
        properties.update(extra_properties)

    is_closed = len(coordinates) >= 4 and point_key(coordinates[0]) == point_key(coordinates[-1])
    geometry = {
        "type": "Polygon" if is_closed else "LineString",
        "coordinates": [coordinates] if is_closed else coordinates,
    }

    return {
        "type": "Feature",
        "id": properties["@id"],
        "geometry": geometry,
        "properties": properties,
    }


def assemble_rings(segments: list[list[list[float]]]) -> list[list[list[float]]]:
    pending = [segment[:] for segment in segments if len(segment) >= 2]
    rings: list[list[list[float]]] = []

    while pending:
        ring = pending.pop(0)
        changed = True

        while point_key(ring[0]) != point_key(ring[-1]) and changed:
            changed = False
            for index, segment in enumerate(pending):
                if point_key(ring[-1]) == point_key(segment[0]):
                    ring.extend(segment[1:])
                elif point_key(ring[-1]) == point_key(segment[-1]):
                    ring.extend(reversed(segment[:-1]))
                elif point_key(ring[0]) == point_key(segment[-1]):
                    ring = segment[:-1] + ring
                elif point_key(ring[0]) == point_key(segment[0]):
                    ring = list(reversed(segment[1:])) + ring
                else:
                    continue

                pending.pop(index)
                changed = True
                break

        if point_key(ring[0]) != point_key(ring[-1]):
            ring.append(ring[0])

        if len(ring) >= 4:
            rings.append(ring)

    return rings


def relation_member_segments(relation: dict[str, Any], role: str) -> list[list[list[float]]]:
    segments: list[list[list[float]]] = []

    for member in relation.get("members", []):
        if member.get("role") != role:
            continue

        coordinates = [
            [point["lon"], point["lat"]]
            for point in member.get("geometry", [])
            if "lon" in point and "lat" in point
        ]

        if len(coordinates) >= 2:
            segments.append(coordinates)

    return segments


def relation_to_polygon_feature(
    relation: dict[str, Any],
    extra_properties: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    outer_rings = assemble_rings(relation_member_segments(relation, "outer"))
    inner_rings = assemble_rings(relation_member_segments(relation, "inner"))

    if not outer_rings:
        return None

    properties = element_properties(relation)
    if extra_properties:
        properties.update(extra_properties)

    if len(outer_rings) == 1:
        geometry = {
            "type": "Polygon",
            "coordinates": [outer_rings[0], *inner_rings],
        }
    else:
        geometry = {
            "type": "MultiPolygon",
            "coordinates": [[ring] for ring in outer_rings],
        }

    return {
        "type": "Feature",
        "id": properties["@id"],
        "geometry": geometry,
        "properties": properties,
    }


def collection(features: list[dict[str, Any]], source_elements_count: int) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": features,
        "_cache": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "endpoint": ENDPOINT,
            "user_agent": USER_AGENT,
            "source_format": "overpass-json",
            "source_elements": source_elements_count,
        },
    }


def departmental_roads_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    elements = data.get("elements", [])
    relations_by_ref = {
        normalize_ref(element.get("tags", {}).get("ref")): element
        for element in elements
        if element.get("type") == "relation" and element.get("tags", {}).get("ref")
    }

    features: list[dict[str, Any]] = []
    for element in elements:
        if element.get("type") != "way":
            continue

        ref = normalize_ref(element.get("tags", {}).get("ref"))
        relation = relations_by_ref.get(ref)
        extra_properties: dict[str, Any] = {}

        if relation:
            extra_properties.update(
                {
                    "has_relation": True,
                    "relation_id": relation.get("id"),
                    "relation_tags": relation.get("tags") or {},
                }
            )
        else:
            extra_properties["has_relation"] = False

        feature = way_to_feature(element, extra_properties)
        if feature:
            features.append(feature)

    return collection(features, len(elements))


def construction_road_status(tags: dict[str, Any]) -> str | None:
    if tags.get("highway") == "construction" or tags.get("construction") == "highway" or tags.get("construction:highway"):
        return "construction"
    if tags.get("highway") == "proposed" or tags.get("proposed") == "highway" or tags.get("proposed:highway"):
        return "proposed"
    return None


def construction_roads_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    features = []
    for element in data.get("elements", []):
        if element.get("type") != "way":
            continue
        tags = element.get("tags") or {}
        status = construction_road_status(tags)
        if not status:
            continue
        feature = way_to_feature(element, {"road_status": status})
        if feature:
            features.append(feature)
    return collection(features, len(data.get("elements", [])))


def communes_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    features = [
        feature
        for element in data.get("elements", [])
        if element.get("type") == "relation"
        for feature in [relation_to_polygon_feature(element)]
        if feature
    ]
    return collection(features, len(data.get("elements", [])))


STRUCTURANTE_REFS = ("EV17", "EV8", "V861")


def bicycle_routes_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    elements = data.get("elements", [])
    relations = {
        element["id"]: element
        for element in elements
        if element.get("type") == "relation"
        and element.get("tags", {}).get("route") == "bicycle"
    }

    way_to_relations: dict[int, list[int]] = {}
    for relation_id, relation in relations.items():
        for member in relation.get("members", []):
            if member.get("type") != "way":
                continue
            if member.get("role") not in ("", "forward", "backward"):
                continue
            member_id = member.get("ref") or member.get("id")
            if member_id is None:
                continue
            way_to_relations.setdefault(member_id, []).append(relation_id)

    features: list[dict[str, Any]] = []
    for element in elements:
        if element.get("type") != "way":
            continue

        relation_ids = way_to_relations.get(element.get("id"), [])
        if not relation_ids:
            continue

        primary_relation = relations[relation_ids[0]]
        relation_tags = primary_relation.get("tags") or {}
        route_refs = [
            normalize_ref(relations[relation_id].get("tags", {}).get("ref"))
            for relation_id in relation_ids
            if relation_id in relations
        ]
        route_refs = [route_ref for route_ref in route_refs if route_ref]
        structurante_ref = next(
            (route_ref for route_ref in STRUCTURANTE_REFS if route_ref in route_refs),
            "",
        )
        extra_properties = {
            "has_relation": True,
            "relation_id": primary_relation.get("id"),
            "relation_ids": relation_ids,
            "relation_tags": relation_tags,
            "route_refs": route_refs,
            "structurante_ref": structurante_ref,
        }

        feature = way_to_feature(element, extra_properties)
        if feature:
            features.append(feature)

    return collection(features, len(elements))


def bridge_role(tags: dict[str, Any]) -> str:
    support = tags.get("bridge:support")
    if support:
        normalized = str(support).strip().lower()
        if normalized == "pier":
            return "pillar"
        if normalized in {"abutement", "abutted", "abucted", "abutmentq"}:
            return "abutment"
        return normalized
    if tags.get("man_made") == "bridge":
        return "deck"
    if tags.get("bridge:structure"):
        return "structure"
    return "bridge"


def bridge_features_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    features: list[dict[str, Any]] = []

    for element in data.get("elements", []):
        tags = element.get("tags") or {}
        if not (
            tags.get("man_made") == "bridge"
            or tags.get("bridge:support")
            or tags.get("bridge:structure")
        ):
            continue

        extra_properties = {"bridge_role": bridge_role(tags)}
        if element.get("type") == "way":
            feature = way_to_area_or_line_feature(element, extra_properties)
        elif element.get("type") == "relation" and tags.get("man_made") == "bridge":
            feature = relation_to_polygon_feature(element, extra_properties)
        else:
            feature = None

        if feature:
            features.append(feature)

    return collection(features, len(data.get("elements", [])))


# Panneaux ponctuels : on ne garde que quelques tags pour limiter le poids du
# fichier (plusieurs milliers de noeuds en Vaucluse).
ROAD_SIGN_KEEP = ("highway", "direction", "traffic_sign", "name")


# Les clés photo se déclinent en variantes suffixées qui portent le sens de la
# prise de vue (panoramax:N, mapillary:2017, panoramax:context…) : un même mât en
# aligne ainsi plusieurs, qu'on veut toutes conserver.
PHOTO_KEY_PREFIXES = ("mapillary", "panoramax", "wikimedia_commons", "image")


def keep_tag(key: str, keep: tuple[str, ...]) -> bool:
    if key in keep:
        return True
    base, sep, _suffix = key.partition(":")
    return bool(sep) and base in PHOTO_KEY_PREFIXES and base in keep


def node_to_point_feature(element: dict[str, Any], keep: tuple[str, ...] | None = None) -> dict[str, Any] | None:
    lat = element.get("lat")
    lon = element.get("lon")
    if lat is None or lon is None:
        return None
    tags = element.get("tags") or {}
    properties = (
        {key: value for key, value in tags.items() if keep_tag(key, keep)}
        if keep is not None
        else dict(tags)
    )
    properties["osm_id"] = element.get("id")
    properties["@id"] = f"node/{element.get('id')}"
    return {
        "type": "Feature",
        "id": properties["@id"],
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": properties,
    }


def road_signs_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    for element in data.get("elements", []):
        if element.get("type") != "node":
            continue
        if (element.get("tags") or {}).get("highway") not in ("stop", "give_way"):
            continue
        feature = node_to_point_feature(element, ROAD_SIGN_KEEP)
        if feature:
            features.append(feature)
    return collection(features, len(data.get("elements", [])))


# Panneaux directionnels (information=guidepost) : on conserve les tags utiles à
# l'affichage (nom, destination, réseau) sans alourdir le fichier. Les quatre
# derniers portent une photo du panneau lui-même (plus pertinente que la photo de
# voirie la plus proche) : ~1450 des mâts du Vaucluse en ont au moins une.
GUIDEPOST_KEEP = (
    "information",
    "tourism",
    "name",
    "ref",
    "destination",
    "direction",
    "operator",
    "hiking",
    "bicycle",
    "mtb",
    "horse",
    "mapillary",
    "panoramax",
    "wikimedia_commons",
    "image",
)


def guideposts_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    for element in data.get("elements", []):
        if element.get("type") != "node":
            continue
        if (element.get("tags") or {}).get("information") != "guidepost":
            continue
        feature = node_to_point_feature(element, GUIDEPOST_KEEP)
        if feature:
            features.append(feature)
    return collection(features, len(data.get("elements", [])))


# Panneaux d'agglomération : le nom porté par le panneau, le sens (entrée/sortie)
# et l'orientation suffisent à l'affichage.
CITY_LIMIT_KEEP = (
    "traffic_sign",
    "name",
    "alt_name",
    "name:oc",
    "ref",
    "city_limit",
    "direction",
    "traffic_sign:direction",
    "operator",
    "description",
    "mapillary",
    "panoramax",
    "wikimedia_commons",
    "image",
)


def city_limits_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    for element in data.get("elements", []):
        if element.get("type") != "node":
            continue
        if "city_limit" not in ((element.get("tags") or {}).get("traffic_sign") or ""):
            continue
        feature = node_to_point_feature(element, CITY_LIMIT_KEEP)
        if feature:
            features.append(feature)
    return collection(features, len(data.get("elements", [])))


# Aires connexes : tags conservés pour l'affichage sans alourdir le fichier.
ROADSIDE_AREA_KEEP = (
    "name",
    "alt_name",
    "operator",
    "network",
    "capacity",
    "capacity:disabled",
    "access",
    "fee",
    "opening_hours",
    "maxstay",
    "maxheight",
    "supervised",
    "ref",
    "park_ride",
    "surface",
    "covered",
    "lit",
    "website",
    "description",
    "wikidata",
    "wikimedia_commons",
    "amenity",
    "highway",
)


def roadside_area_kind(tags: dict[str, Any]) -> str | None:
    if tags.get("amenity") == "car_pooling":
        return "car_pooling"
    if tags.get("highway") == "rest_area":
        return "rest_area"
    if tags.get("amenity") == "parking":
        if str(tags.get("parking", "")).strip().lower() == "layby":
            return "layby"
        park_ride = str(tags.get("park_ride", "")).strip().lower()
        if park_ride and park_ride not in ("no", "false", "0"):
            return "park_ride"
    return None


def element_coordinates(element: dict[str, Any]) -> list[list[float]]:
    return [
        [point["lon"], point["lat"]]
        for point in element.get("geometry", [])
        if "lon" in point and "lat" in point
    ]


def ring_centroid(coordinates: list[list[float]]) -> list[float]:
    ring = coordinates[:]
    if len(ring) >= 2 and point_key(ring[0]) == point_key(ring[-1]):
        ring = ring[:-1]
    if not ring:
        return coordinates[0]
    lon = sum(point[0] for point in ring) / len(ring)
    lat = sum(point[1] for point in ring) / len(ring)
    return [round(lon, 7), round(lat, 7)]


def roadside_areas_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    for element in data.get("elements", []):
        tags = element.get("tags") or {}
        kind = roadside_area_kind(tags)
        if not kind:
            continue

        properties = {key: tags[key] for key in ROADSIDE_AREA_KEEP if key in tags}
        properties["area_kind"] = kind
        properties["osm_type"] = element.get("type")
        properties["osm_id"] = element.get("id")
        properties["@id"] = f"{element.get('type')}/{element.get('id')}"

        element_type = element.get("type")
        if element_type == "node":
            lat = element.get("lat")
            lon = element.get("lon")
            if lat is None or lon is None:
                continue
            center = [round(lon, 7), round(lat, 7)]
            geometry = {"type": "Point", "coordinates": center}
        elif element_type == "relation":
            # Aire cartographiée en relation (multipolygone) : les tags sont portés
            # par la relation (ex. parking-relais de l'îlot Piot à Avignon).
            outer_rings = assemble_rings(relation_member_segments(element, "outer"))
            inner_rings = assemble_rings(relation_member_segments(element, "inner"))
            if not outer_rings:
                continue
            if len(outer_rings) == 1:
                geometry = {"type": "Polygon", "coordinates": [outer_rings[0], *inner_rings]}
            else:
                geometry = {"type": "MultiPolygon", "coordinates": [[ring] for ring in outer_rings]}
            center = ring_centroid(outer_rings[0])
        else:
            coordinates = element_coordinates(element)
            if len(coordinates) < 2:
                continue
            is_closed = len(coordinates) >= 4 and point_key(coordinates[0]) == point_key(coordinates[-1])
            if is_closed:
                geometry = {"type": "Polygon", "coordinates": [coordinates]}
                center = ring_centroid(coordinates)
            else:
                geometry = {"type": "LineString", "coordinates": coordinates}
                center = ring_centroid(coordinates)

        # Point de rattachement du marqueur (centre du surfacique le cas échéant).
        properties["center"] = center

        features.append(
            {
                "type": "Feature",
                "id": properties["@id"],
                "geometry": geometry,
                "properties": properties,
            }
        )

    return collection(features, len(data.get("elements", [])))


CONVERTERS = {
    "departmental-roads": departmental_roads_to_geojson,
    "construction-roads": construction_roads_to_geojson,
    "communes-vaucluse": communes_to_geojson,
    "bicycle-routes": bicycle_routes_to_geojson,
    "bridges": bridge_features_to_geojson,
    "road-signs": road_signs_to_geojson,
    "guideposts": guideposts_to_geojson,
    "city-limits": city_limits_to_geojson,
    "roadside-areas": roadside_areas_to_geojson,
}


def write_json_if_changed(path: Path, data: dict[str, Any]) -> bool:
    content = json.dumps(data, ensure_ascii=True, separators=(",", ":")) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False

    path.write_text(content, encoding="utf-8")
    return True


def refresh_cache(name: str, query: str) -> bool:
    last_error: Exception | None = None

    for attempt in range(1, 4):
        try:
            overpass_data = request_overpass(query)
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            if attempt == 3:
                raise
            # Un 429 veut dire que le quota est épuisé : cinq secondes ne
            # suffisent pas à libérer un créneau, et l'échec se solde par un
            # cache figé jusqu'à la prochaine exécution planifiée.
            wait_seconds = attempt * 20
            print(f"{name}: retry in {wait_seconds}s after {error}", file=sys.stderr)
            time.sleep(wait_seconds)
    else:
        raise RuntimeError(f"{name}: {last_error}")

    geojson = CONVERTERS[name](overpass_data)
    output_path = DATA_DIR / f"{name}.geojson"
    changed = write_json_if_changed(output_path, geojson)
    features_count = len(geojson.get("features", []))
    state = "updated" if changed else "unchanged"
    print(f"{output_path.relative_to(ROOT)}: {state}, {features_count} features")
    return changed


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Overpass endpoint: {ENDPOINT}")
    print(f"User-Agent: {USER_AGENT}")

    selected = sys.argv[1:]
    if selected:
        unknown = [name for name in selected if name not in QUERIES]
        if unknown:
            print(f"Unknown dataset(s): {', '.join(unknown)}", file=sys.stderr)
            print(f"Available: {', '.join(QUERIES)}", file=sys.stderr)
            return 2
        queries = {name: QUERIES[name] for name in selected}
    else:
        queries = QUERIES

    changed = False
    failed: list[str] = []
    for name, query in queries.items():
        try:
            changed = refresh_cache(name, query) or changed
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
            # Un jeu refusé ne doit pas emporter les suivants : autrement une
            # limite de débit sur l'un laisse tous les autres inchangés jusqu'à
            # la prochaine exécution planifiée, plusieurs jours plus tard.
            print(f"{name}: left unchanged after {error}", file=sys.stderr)
            failed.append(name)

    if failed:
        print(f"Datasets left stale: {', '.join(failed)}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
