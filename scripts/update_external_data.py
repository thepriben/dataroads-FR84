#!/usr/bin/env python3
"""Update non-OSM local data files used by the static demo."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from project_meta import read_version, user_agent

DATA_DIR = ROOT / "data" / "external"
APP_VERSION = os.environ.get("APP_VERSION", read_version())
USER_AGENT = os.environ.get("APP_USER_AGENT", user_agent())

TRAFFIC_COUNTING_URL = (
    "https://www.data.gouv.fr/api/1/datasets/r/"
    "a43b0841-856b-44f5-b4a7-74c5275b13a0"
)
# Bison Futé / DIR - aggregated DATEX II XML feed for the non-conceded RRN.
# The previous endpoint (diffusion-numerique.info-routiere.gouv.fr) was retired.
ROAD_EVENTS_URL = (
    "http://tipi.bison-fute.gouv.fr/bison-fute-ouvert/"
    "publicationsDIR/Evenementiel-DIR/grt/RRN/content.xml"
)

DATEX_NS = "http://datex2.eu/schema/2/2_0"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
NS = {"d2": DATEX_NS, "xsi": XSI_NS}

# DATEX II situationRecord xsi:type -> friendly category understood by the JS layer.
TYPE_TO_CATEGORY = {
    "Accident": "accident",
    "ConstructionWorks": "roadwork",
    "MaintenanceWorks": "roadwork",
    "RoadOrCarriagewayOrLaneManagement": "roadwork",
    "SpeedManagement": "roadwork",
    "ReroutingManagement": "roadwork",
    "AbnormalTraffic": "congestion",
    "InfrastructureDamageObstruction": "incident",
    "EnvironmentalObstruction": "incident",
    "VehicleObstruction": "incident",
    "GeneralObstruction": "incident",
    "AnimalPresenceObstruction": "incident",
    "WeatherRelatedRoadConditions": "weather",
    "RoadsideServiceDisruption": "info",
    "GeneralNetworkManagement": "info",
    "GeneralInstructionOrMessageToRoadUsers": "info",
    "PublicEvent": "info",
    "OperatorAction": "info",
}


def fetch_json(url: str, timeout: int = 60) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json, application/geo+json;q=0.9, */*;q=0.1",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_bytes(url: str, timeout: int = 60) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/xml, text/xml, */*;q=0.1",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def metadata(source_name: str, source_url: str) -> dict[str, str]:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_name": source_name,
        "source_url": source_url,
        "user_agent": USER_AGENT,
    }


def as_feature_collection(data: dict[str, Any], source_name: str, source_url: str) -> dict[str, Any]:
    if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
        raise ValueError(f"{source_name}: expected a GeoJSON FeatureCollection")

    data["_cache"] = metadata(source_name, source_url)
    return data


def empty_feature_collection(source_name: str, source_url: str, error: Exception) -> dict[str, Any]:
    data = {
        "type": "FeatureCollection",
        "features": [],
        "_cache": metadata(source_name, source_url),
    }
    data["_cache"]["error"] = str(error)
    return data


def write_json_if_changed(path: Path, data: dict[str, Any]) -> bool:
    content = json.dumps(data, ensure_ascii=True, separators=(",", ":")) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False

    path.write_text(content, encoding="utf-8")
    return True


def _local_xsi_type(element: ET.Element) -> str:
    raw = element.get(f"{{{XSI_NS}}}type", "")
    # xsi:type is a QName like "ns2:Accident"; we only care about the local part.
    return raw.rsplit(":", 1)[-1]


def _text(element: ET.Element | None) -> str:
    if element is None or element.text is None:
        return ""
    return element.text.strip()


def _first_value(parent: ET.Element, xpath: str) -> str:
    node = parent.find(xpath, NS)
    return _text(node)


def _comments_by_type(record: ET.Element) -> dict[str, list[str]]:
    """Group <generalPublicComment> values by their commentType."""
    grouped: dict[str, list[str]] = {}
    for comment in record.findall("d2:generalPublicComment", NS):
        comment_type = _first_value(comment, "d2:commentType") or "other"
        text = _first_value(comment, "d2:comment/d2:values/d2:value")
        if text:
            grouped.setdefault(comment_type, []).append(text)
    return grouped


def _first_point(record: ET.Element) -> tuple[float, float] | None:
    """Return (longitude, latitude) of the first available pointCoordinates."""
    coords = record.find(".//d2:pointCoordinates", NS)
    if coords is None:
        return None
    lat_text = _first_value(coords, "d2:latitude")
    lon_text = _first_value(coords, "d2:longitude")
    if not lat_text or not lon_text:
        return None
    try:
        return float(lon_text), float(lat_text)
    except ValueError:
        return None


def _road_and_town(record: ET.Element) -> tuple[str, str]:
    road = ""
    town = ""
    for name in record.findall(".//d2:name", NS):
        descriptor_type = _first_value(name, "d2:tpegOtherPointDescriptorType")
        value = _first_value(name, "d2:descriptor/d2:values/d2:value")
        if not value:
            continue
        if descriptor_type == "linkName" and not road:
            road = value
        elif descriptor_type == "townName" and not town:
            town = value
    return road, town


def _situation_record_to_feature(record: ET.Element) -> dict[str, Any] | None:
    point = _first_point(record)
    if point is None:
        return None
    lon, lat = point

    record_type = _local_xsi_type(record)
    category = TYPE_TO_CATEGORY.get(record_type, "info")
    comments = _comments_by_type(record)
    road, town = _road_and_town(record)
    source = _first_value(record, "d2:source/d2:sourceIdentification")
    start_time = _first_value(record, "d2:validity/d2:validityTimeSpecification/d2:overallStartTime")
    end_time = _first_value(record, "d2:validity/d2:validityTimeSpecification/d2:overallEndTime")

    description = " ".join(comments.get("description", [])) or " ".join(
        comments.get("locationDescriptor", [])
    )

    return {
        "type": "Feature",
        "id": record.get("id"),
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "event_type": category,
            "datex_type": record_type,
            "description": description,
            "road_name": road,
            "commune": town,
            "start_time": start_time,
            "end_time": end_time,
            "source": source,
            "version": record.get("version"),
        },
    }


def datex_to_geojson(xml_bytes: bytes) -> dict[str, Any]:
    """Convert a DATEX II SOAP/XML payload into a GeoJSON FeatureCollection."""
    root = ET.fromstring(xml_bytes)
    features: list[dict[str, Any]] = []
    for record in root.iter(f"{{{DATEX_NS}}}situationRecord"):
        feature = _situation_record_to_feature(record)
        if feature is not None:
            features.append(feature)

    return {"type": "FeatureCollection", "features": features}


def update_geojson(
    name: str,
    source_name: str,
    source_url: str,
    fetcher: Callable[[str], dict[str, Any]] | None = None,
    allow_empty: bool = False,
) -> bool:
    output_path = DATA_DIR / name
    fetch = fetcher or (lambda url: fetch_json(url))

    try:
        data = as_feature_collection(fetch(source_url), source_name, source_url)
    except Exception as error:
        if not allow_empty:
            raise
        print(f"{name}: source unavailable, writing empty GeoJSON: {error}", file=sys.stderr)
        data = empty_feature_collection(source_name, source_url, error)

    changed = write_json_if_changed(output_path, data)
    state = "updated" if changed else "unchanged"
    print(f"{output_path.relative_to(ROOT)}: {state}, {len(data['features'])} features")
    return changed


def fetch_road_events(source_url: str) -> dict[str, Any]:
    xml_bytes = fetch_bytes(source_url, timeout=90)
    return datex_to_geojson(xml_bytes)


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    update_geojson(
        "traffic-counting.geojson",
        "data.gouv.fr - Comptages permanents CD84",
        TRAFFIC_COUNTING_URL,
    )
    update_geojson(
        "road-events.geojson",
        "Bison Futé / DIR - Evenementiel DATEX II (tipi.bison-fute.gouv.fr)",
        ROAD_EVENTS_URL,
        fetcher=fetch_road_events,
        allow_empty=True,
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
