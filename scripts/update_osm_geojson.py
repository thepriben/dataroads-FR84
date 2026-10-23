#!/usr/bin/env python3
"""Refresh static GeoJSON files from Overpass for the GitHub Pages site."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from project_meta import read_version, user_agent
from overpass_client import fetch
import osm_diff_selection

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
    # Deux clés disent la même chose et il faut les lire ensemble : `was:ref`
    # porte l'essentiel des déclassements relevés dans le Vaucluse, `old_ref`
    # quelques autres. Mais `old_ref` sert aussi, sur 734 tronçons, à garder la
    # trace du transfert des nationales au département en 2006 — mouvement
    # inverse. Ne retenir que les valeurs en « D » suffit à les séparer : une
    # ancienne nationale s'écrit « N 7 ».
    "declassified-roads": """
        [out:json][timeout:90];
        area["ISO3166-2"="FR-84"]->.dept;
        (
          way(area.dept)["highway"]["was:ref"~"(^|;) *[Dd] ?[0-9]"];
          way(area.dept)["highway"]["old_ref"~"(^|;) *[Dd] ?[0-9]"];
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
    # Les cantons ne sont pas des limites administratives mais un découpage
    # électoral : ils portent boundary=political et non boundary=administrative.
    # On les filtre sur leur propre code INSEE plutôt que par appartenance au
    # département, car area["ref:INSEE"="84"] désigne la région
    # Auvergne-Rhône-Alpes et non le Vaucluse.
    "cantons-vaucluse": """
        [out:json][timeout:60];
        relation["boundary"="political"]["political_division"="canton"]
                ["ref:INSEE"~"^84[0-9][0-9]$"];
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
    return fetch(query, endpoint=ENDPOINT, user_agent=USER_AGENT)


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


DEPARTMENTAL_REF = re.compile(r"^\s*[Dd]\s*0*(\d+)\s*(.*)$")
HISTORIC_REF_KEYS = ("was:ref", "old_ref")


def former_departmental_refs(tags: dict[str, Any]) -> list[str]:
    """Les numéros départementaux qu'un tronçon a portés et ne porte plus.

    Un tronçon qui porte encore un numéro départemental est écarté : il n'a pas
    été déclassé mais renuméroté, et son tracé figure déjà au réseau affiché.
    """
    if DEPARTMENTAL_REF.match(str(tags.get("ref") or "")):
        return []
    refs: list[str] = []
    for key in HISTORIC_REF_KEYS:
        for value in str(tags.get(key) or "").split(";"):
            found = DEPARTMENTAL_REF.match(value)
            if not found:
                continue
            # « D 900 » et « D900 » désignent la même route : la forme retenue
            # est celle du réseau affiché, pour que la jointure se fasse côté app.
            ref = "D" + found.group(1) + found.group(2).strip().replace(" ", "")
            if ref not in refs:
                refs.append(ref)
    return refs


def declassified_roads_to_geojson(data: dict[str, Any]) -> dict[str, Any]:
    features = []
    for element in data.get("elements", []):
        if element.get("type") != "way":
            continue
        refs = former_departmental_refs(element.get("tags") or {})
        if not refs:
            continue
        feature = way_to_feature(element, {"former_refs": refs})
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
    "declassified-roads": declassified_roads_to_geojson,
    "construction-roads": construction_roads_to_geojson,
    "communes-vaucluse": communes_to_geojson,
    "cantons-vaucluse": communes_to_geojson,
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
    overpass_data = request_overpass(query)

    geojson = CONVERTERS[name](overpass_data)
    # L'heure d'écriture ne dit rien de l'âge des données, seulement de l'âge du
    # fichier : une réplique en retard produit un fichier tout neuf rempli de
    # faits périmés. On retient donc la coupure annoncée par le serveur, la
    # seule qui permette de savoir jusqu'à quand OSM a été lu.
    base_timestamp = (overpass_data.get("osm3s") or {}).get("timestamp_osm_base")
    if isinstance(geojson.get("_cache"), dict):
        if base_timestamp:
            geojson["_cache"]["source_timestamp"] = base_timestamp
        # Une extraction vaut vérification : le jeu colle à OSM jusqu'à la
        # coupure annoncée. Porter la date sous la même clé que les jeux
        # seulement confrontés au diff évite au navigateur d'avoir à distinguer
        # les deux pour savoir si un retard est réel.
        geojson["_cache"]["verified_at"] = base_timestamp or geojson["_cache"]["generated_at"]

    output_path = DATA_DIR / f"{name}.geojson"
    changed = write_json_if_changed(output_path, geojson)
    features_count = len(geojson.get("features", []))
    state = "updated" if changed else "unchanged"
    print(f"{output_path.relative_to(ROOT)}: {state}, {features_count} features"
          f"{f', OSM lu jusqu au {base_timestamp}' if base_timestamp else ''}")
    return changed


# Le passage complet a rendez-vous chaque nuit à 2 h, heure de France : le plus
# long intervalle légitime entre deux extractions est donc de vingt-quatre
# heures. Au-delà du battement, un jeu n'a pas attendu son tour, il l'a manqué.
# Six heures de battement, et non l'heure qui suffisait à une cadence de quatre
# jours : GitHub Actions a déjà fait partir avec plus de cinq heures de retard un
# cron prévu à 03:17. Une marge plus courte signalerait un retard chaque matin où
# l'ordonnanceur traîne, et un signal qui se déclenche sans motif cesse d'être lu.
# La pastille du navigateur raisonne sur la même borne.
STALE_AFTER = timedelta(days=1, hours=6)


def parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def read_cache(name: str) -> dict[str, Any] | None:
    path = DATA_DIR / f"{name}.geojson"
    try:
        cache = json.loads(path.read_text(encoding="utf-8")).get("_cache")
    except (OSError, json.JSONDecodeError):
        return None
    return cache if isinstance(cache, dict) else None


def verified_through(name: str) -> datetime | None:
    """Jusqu'à quand OSM a été lu en tenant ce jeu pour exact.

    Une nuit pilotée par le diff laisse volontairement dix jeux sur onze en
    place : leur contenu date d'avant, mais il vient d'être confronté aux
    contributions de la nuit et déclaré intact. Confondre les deux dates, c'est
    déclarer périmée une donnée vérifiée — et un signal qui crie à tort cesse
    d'être lu.
    """
    cache = read_cache(name)
    if cache is None:
        return None
    stamps = [
        parse_timestamp(cache.get(key))
        for key in ("verified_at", "source_timestamp", "generated_at")
    ]
    readable = [moment for moment in stamps if moment]
    return max(readable) if readable else None


def cache_age(name: str, now: datetime) -> timedelta | None:
    """L'âge de ce qu'on sait d'un jeu, ou None quand il n'a pas d'âge lisible.

    L'âge compté est celui de la dernière vérification, et non celui du contenu :
    un jeu que la nuit a confronté au diff sans rien trouver à y changer n'a pas
    manqué son rendez-vous, il l'a tenu. Un fichier absent ou illisible n'a pas
    d'âge mesurable mais réclame quand même une extraction, d'où le None que
    l'appelant traite comme un retard.
    """
    moment = verified_through(name)
    return now - moment if moment else None


def mark_verified(name: str, verified_at: str) -> bool:
    """Horodate la vérification d'un jeu que le diff a trouvé intact.

    Rien n'est réécrit du contenu : seule avance la date jusqu'à laquelle on
    peut affirmer qu'il colle à OSM. C'est la contrepartie du jeu non réextrait
    — sans elle, l'application le dirait en retard dès le lendemain matin.
    """
    path = DATA_DIR / f"{name}.geojson"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    cache = payload.get("_cache")
    if not isinstance(cache, dict):
        return False
    cache["verified_at"] = verified_at
    return write_json_if_changed(path, payload)


def stale_datasets(names: list[str] | None = None, now: datetime | None = None) -> list[str]:
    now = now or datetime.now(timezone.utc)
    overdue = []
    for name in names if names is not None else list(QUERIES):
        age = cache_age(name, now)
        if age is None or age > STALE_AFTER:
            overdue.append(name)
    return overdue


def diff_selection(queries: dict[str, str], now: datetime) -> tuple[dict[str, str], str | None]:
    """Les jeux à relire d'après le diff OSM, et jusqu'à quand OSM a été lu.

    Un verdict vide est un verdict : la nuit n'a touché aucun des onze jeux, et
    l'unique requête du diff remplace les onze extractions. Mais perdre la
    source d'information ne doit jamais se traduire par une nuit blanche
    silencieuse : toute incertitude — diff indisponible, illisible, fenêtre trop
    large, jeu sans date de vérification — rend la main à l'extraction complète,
    signalée ici par un second membre nul.
    """
    verified = {name: verified_through(name) for name in queries}
    since = osm_diff_selection.window_start(verified, now)
    if since is None:
        print("Diff hors de portée (jeu jamais vérifié ou fenêtre trop large) : extraction complète.")
        return dict.fromkeys(queries, "extraction complète"), None

    by_dataset = osm_diff_selection.dataset_selectors(queries)
    selectors = osm_diff_selection.merge_selectors(by_dataset)
    query = osm_diff_selection.adiff_query(since, selectors)
    print(f"Diff OSM depuis {since:%Y-%m-%dT%H:%M:%SZ} ({len(selectors)} motifs)")
    try:
        payload = fetch(query, endpoint=ENDPOINT, user_agent=USER_AGENT, output="xml",
                        timeout=600, attempts=3, max_lag=timedelta(days=1))
        changes, osm_base = osm_diff_selection.parse_adiff(payload)
    except (urllib.error.URLError, TimeoutError, RuntimeError, ET.ParseError) as error:
        print(f"Diff OSM indisponible ({error}) : repli sur l'extraction complète.", file=sys.stderr)
        return dict.fromkeys(queries, "diff indisponible"), None
    if not osm_base:
        print("Diff OSM sans coupure annoncée : repli sur l'extraction complète.", file=sys.stderr)
        return dict.fromkeys(queries, "diff sans coupure"), None

    references = {
        name: osm_diff_selection.dataset_references(DATA_DIR / f"{name}.geojson")
        for name in queries
    }
    verdict = osm_diff_selection.affected_datasets(changes, by_dataset, references)
    print(f"Diff OSM : {len(changes)} objets touchés, OSM lu jusqu'au {osm_base}")
    for name in queries:
        reason = verdict.get(name)
        print(f"  {name}: {'à relire — ' + reason if reason else 'inchangé'}")
    return verdict, osm_base


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Overpass endpoint: {ENDPOINT}")
    print(f"User-Agent: {USER_AGENT}")

    arguments = sys.argv[1:]
    stale_only = "--stale-only" in arguments
    since_diff = "--since-diff" in arguments
    selected = [
        argument for argument in arguments
        if argument not in ("--stale-only", "--since-diff")
    ]
    if selected:
        unknown = [name for name in selected if name not in QUERIES]
        if unknown:
            print(f"Unknown dataset(s): {', '.join(unknown)}", file=sys.stderr)
            print(f"Available: {', '.join(QUERIES)}", file=sys.stderr)
            return 2
        queries = {name: QUERIES[name] for name in selected}
    else:
        queries = dict(QUERIES)

    if stale_only:
        # Le rattrapage ne rejoue que les rendez-vous manqués. Refaire les onze
        # jeux à midi coûterait un quart d'heure d'Overpass quelques heures après
        # que le passage nocturne les a déjà relus, et ce service public est
        # gratuit : on ne lui demande que ce que la nuit a laissé en arrière.
        overdue = set(stale_datasets(list(queries)))
        queries = {name: query for name, query in queries.items() if name in overdue}
        if not queries:
            print("Aucun jeu périmé : rien à rattraper.")
            return 0
        print(f"Jeux périmés à rattraper : {', '.join(queries)}")

    verified_at: str | None = None
    spared: list[str] = []
    if since_diff:
        verdict, verified_at = diff_selection(queries, datetime.now(timezone.utc))
        # Un jeu qui a manqué son tour se reprend quoi qu'en dise le diff : son
        # fichier est vieux pour une autre raison que l'absence de contributions,
        # et aucun diff ne peut le rajeunir.
        for name in stale_datasets(list(queries)):
            verdict.setdefault(name, "jeu périmé")
        spared = [name for name in queries if name not in verdict]
        queries = {name: query for name, query in queries.items() if name in verdict}
        print(f"Extractions retenues : {len(queries)}/{len(queries) + len(spared)}")

    changed = False
    rewritten: list[str] = []
    failed: list[str] = []
    for name, query in queries.items():
        try:
            if refresh_cache(name, query):
                rewritten.append(name)
                changed = True
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
            # Un jeu refusé ne doit pas emporter les suivants : autrement une
            # limite de débit sur l'un laisse tous les autres inchangés jusqu'à
            # la prochaine exécution planifiée, plusieurs jours plus tard.
            print(f"{name}: left unchanged after {error}", file=sys.stderr)
            failed.append(name)

    if spared and verified_at:
        for name in spared:
            changed = mark_verified(name, verified_at) or changed
        print(f"Jeux vérifiés inchangés jusqu'au {verified_at} : {', '.join(spared)}")

    # Les étapes suivantes du workflow ont besoin de savoir ce qui a réellement
    # été réécrit, et non ce que ``git diff`` voit : une nuit pilotée par le diff
    # touche les onze fichiers, ne serait-ce que pour horodater la vérification
    # des jeux épargnés. S'en remettre au diff reviendrait à recalculer chaque
    # matin une table territoriale que rien n'a bougée.
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as handle:
            handle.write(f"refreshed={' '.join(rewritten)}\n")

    if failed:
        # Un jeu qui manque son tour n'est pas une panne du rendez-vous : les
        # autres sont à jour et seront poussés. Peindre toute l'exécution en
        # échec pour un 504 sur la requête la plus lourde a mis cinq des six
        # dernières au rouge, et un voyant rouge en permanence ne prévient plus
        # de rien — c'est ainsi que les extraits ont vieilli de deux semaines
        # sans que personne s'en alarme. L'avertissement reste visible dans le
        # résumé de l'exécution ; seul un échec total, où rien n'a pu être lu,
        # mérite encore d'être une erreur.
        summary = ", ".join(failed)
        print(f"::warning title=Overpass incomplet::Jeux laissés en place : {summary}")
        print(f"Datasets left stale: {summary}", file=sys.stderr)
        if len(failed) == len(queries):
            print("Aucun jeu n'a pu être lu.", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
