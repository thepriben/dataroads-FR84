#!/usr/bin/env python3
"""Update sensitive natural zones (ENS) and iNaturalist observations for the demo."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from project_meta import read_version, user_agent
from update_external_data import DATA_DIR, metadata, write_json_if_changed

APP_VERSION = read_version()
USER_AGENT = user_agent()

ENS_DATASET_URL = (
    "https://www.data.gouv.fr/api/1/datasets/r/"
    "6730af2d-1cd0-4d2c-aa20-057700147408"
)
INATURALIST_API = "https://api.inaturalist.org/v1/observations"

VAUCLUSE_BBOX = {
    "swlat": 43.65,
    "swlng": 4.65,
    "nelat": 44.35,
    "nelng": 5.85,
}

# Source shapefile DBF labels are mojibaked on DataSud; keep canonical French names by record order.
CANONICAL_ENS_NAMES = (
    "Les zones humides du Calavon",
    "Le site des platrières",
    "La forêt de la Plate",
    "La forêt des cèdres du petit Luberon",
    "Le vallon de l'Aiguebrun",
    "Les marnes Aptiennes de la Tuilière",
    "L'arboretum départemental de Beauregard",
    "La zone humide des Confines",
    "La forêt départementale de Venasque",
    "La forêt de la Pérégine et du ravin du Défend",
    "La forêt départementale de Sivergues",
    "L'étang salé",
    "La colline de Piécaud",
    "Les collines du lac du Paty",
    "La Garrigue",
    "Les mares de la Pavouyère",
    "La zone humide de Belle-ile",
    "La colline de la Buyère",
    "Les prés des Poulivets",
    "Les Salettes et Vallat de Marquetton",
    "Le Marais de l'Ile Vieille",
    "La forêt départementale du Groseau",
)


def fetch_bytes(url: str, timeout: int = 120) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/zip, application/octet-stream, */*;q=0.1",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def fetch_json(url: str, timeout: int = 60, retries: int = 4) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in (403, 429, 500, 502, 503, 504):
                raise
            time.sleep(1.5 * (attempt + 1))
        except urllib.error.URLError as error:
            last_error = error
            time.sleep(1.5 * (attempt + 1))
    if last_error is not None:
        raise last_error
    raise RuntimeError("fetch_json failed without error")


def _ring_contains_point(ring: list[list[float]], lon: float, lat: float) -> bool:
    inside = False
    count = len(ring)
    if count < 3:
        return False

    j = count - 1
    for i in range(count):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersects = ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def geometry_contains_point(geometry: dict[str, Any], lon: float, lat: float) -> bool:
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if not coords:
        return False

    if geom_type == "Polygon":
        if not _ring_contains_point(coords[0], lon, lat):
            return False
        for hole in coords[1:]:
            if _ring_contains_point(hole, lon, lat):
                return False
        return True

    if geom_type == "MultiPolygon":
        for polygon in coords:
            if not _ring_contains_point(polygon[0], lon, lat):
                continue
            in_hole = any(_ring_contains_point(hole, lon, lat) for hole in polygon[1:])
            if not in_hole:
                return True
        return False

    return False


def find_zone_for_point(
    zones: list[dict[str, Any]], lon: float, lat: float
) -> dict[str, Any] | None:
    for feature in zones:
        geometry = feature.get("geometry")
        if geometry and geometry_contains_point(geometry, lon, lat):
            return feature
    return None


def _decode_dbf_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        for encoding in ("utf-8", "cp1252", "latin-1"):
            try:
                return value.decode(encoding).strip()
            except UnicodeDecodeError:
                continue
        return value.decode("latin-1", errors="replace").strip()
    return normalize_french_text(str(value))


def normalize_french_text(value: str) -> str:
    text = value.strip()
    if not text or "\ufffd" not in text and "ï¿½" not in text:
        return text

    for encoding in ("latin-1", "cp1252"):
        try:
            repaired = text.encode(encoding).decode("utf-8").strip()
            if repaired and "\ufffd" not in repaired:
                return repaired
        except (UnicodeDecodeError, UnicodeEncodeError):
            continue

    return text


def shapefile_zip_to_geojson(zip_bytes: bytes) -> dict[str, Any]:
    try:
        import shapefile  # pyshp
        from pyproj import Transformer
    except ImportError as error:
        raise RuntimeError(
            "pyshp and pyproj are required: pip install pyshp pyproj"
        ) from error

    transformer = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        shp_name = next(
            (name for name in archive.namelist() if name.lower().endswith(".shp")),
            None,
        )
        if not shp_name:
            raise ValueError("No .shp file found in ENS archive")

        base = shp_name[:-4]
        shx_name = f"{base}.shx"
        dbf_name = f"{base}.dbf"
        if shx_name not in archive.namelist() or dbf_name not in archive.namelist():
            raise ValueError("Incomplete shapefile in ENS archive")

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            for suffix in (".shp", ".shx", ".dbf"):
                member = f"{base}{suffix}"
                target = tmp_path / member
                target.write_bytes(archive.read(member))

            reader = shapefile.Reader(str(tmp_path / shp_name))
            field_names = [field[0] for field in reader.fields[1:]]

            def field_value(record: list[Any], *candidates: str) -> str:
                lowered = {name.lower(): name for name in field_names}
                for candidate in candidates:
                    key = lowered.get(candidate.lower())
                    if key is None:
                        continue
                    index = field_names.index(key)
                    return _decode_dbf_text(record[index])
                return ""

            features: list[dict[str, Any]] = []
            for index, shape_record in enumerate(reader.shapeRecords(), start=1):
                shape = shape_record.shape
                record = shape_record.record

                if shape.shapeType not in (shapefile.POLYGON, shapefile.POLYGONM, shapefile.POLYGONZ):
                    continue

                parts = list(shape.parts) + [len(shape.points)]
                polygons: list[list[list[float]]] = []
                for part_index in range(len(shape.parts)):
                    start = shape.parts[part_index]
                    end = parts[part_index + 1]
                    ring = []
                    for x, y in shape.points[start:end]:
                        lon, lat = transformer.transform(x, y)
                        ring.append([lon, lat])
                    if len(ring) >= 4 and ring[0] != ring[-1]:
                        ring.append(ring[0])
                    if len(ring) >= 4:
                        polygons.append(ring)

                if not polygons:
                    continue

                geometry = {"type": "Polygon", "coordinates": polygons}

                raw_name = field_value(record, "nom_site", "NOM_SITE", "name")
                name = (
                    CANONICAL_ENS_NAMES[index - 1]
                    if index - 1 < len(CANONICAL_ENS_NAMES)
                    else normalize_french_text(raw_name)
                )
                area_raw = field_value(record, "superficie", "SUPERFICIE", "area")
                try:
                    area_m2 = float(area_raw.replace(",", ".")) if area_raw else 0.0
                except ValueError:
                    area_m2 = 0.0

                features.append(
                    {
                        "type": "Feature",
                        "id": f"ens-{index}",
                        "geometry": geometry,
                        "properties": {
                            "zone_type": "ens",
                            "name": name or f"ENS {index}",
                            "area_ha": round(area_m2 / 10_000, 1) if area_m2 else None,
                            "communes": normalize_french_text(
                                field_value(record, "communes", "COMMUNES")
                            ),
                            "owner": normalize_french_text(
                                field_value(record, "proprietai", "PROPRIETAI")
                            ),
                            "manager": normalize_french_text(
                                field_value(record, "gestionnai", "GESTIONNAI")
                            ),
                            "habitat": normalize_french_text(
                                field_value(record, "type_milie", "TYPE_MILIE")
                            ),
                            "source": "CD84 / DataSud",
                        },
                    }
                )

    return {"type": "FeatureCollection", "features": features}


def build_ens_geojson() -> dict[str, Any]:
    source_name = "data.gouv.fr - Espaces naturels sensibles Vaucluse (CD84)"
    zip_bytes = fetch_bytes(ENS_DATASET_URL)
    data = shapefile_zip_to_geojson(zip_bytes)
    data["_cache"] = metadata(source_name, ENS_DATASET_URL)
    return data


def geometry_bbox(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    coords = geometry.get("coordinates") or []
    geom_type = geometry.get("type")
    points: list[tuple[float, float]] = []

    def collect(ring: list[list[float]]) -> None:
        for lon, lat in ring:
            points.append((lon, lat))

    if geom_type == "Polygon":
        for ring in coords:
            collect(ring)
    elif geom_type == "MultiPolygon":
        for polygon in coords:
            for ring in polygon:
                collect(ring)

    if not points:
        raise ValueError("Empty geometry bbox")

    lons = [point[0] for point in points]
    lats = [point[1] for point in points]
    return min(lons), min(lats), max(lons), max(lats)


def fetch_inaturalist_page(bbox: dict[str, float], page: int) -> dict[str, Any]:
    params = {
        **bbox,
        "geo": "true",
        "per_page": 200,
        "page": page,
        "order": "desc",
        "order_by": "observed_on",
    }
    url = f"{INATURALIST_API}?{urllib.parse.urlencode(params)}"
    return fetch_json(url)


def observation_to_feature(
    observation: dict[str, Any], zone_feature: dict[str, Any]
) -> dict[str, Any] | None:
    location = observation.get("location") or ""
    if not location or "," not in location:
        return None

    try:
        lat_str, lon_str = location.split(",", 1)
        lat = float(lat_str)
        lon = float(lon_str)
    except ValueError:
        return None

    taxon = observation.get("taxon") or {}
    taxon_name = (
        taxon.get("preferred_common_name")
        or taxon.get("name")
        or observation.get("species_guess")
        or "Observation"
    )
    iconic_taxon = taxon.get("iconic_taxon_name") or observation.get("iconic_taxon_name")
    photos = observation.get("photos") or []
    photo_url = photos[0].get("url") if photos else None
    if photo_url:
        photo_url = photo_url.replace("/square.", "/medium.")

    obs_id = observation.get("id")
    zone_props = zone_feature.get("properties") or {}

    return {
        "type": "Feature",
        "id": f"inat-{obs_id}",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "observation_id": obs_id,
            "uuid": observation.get("uuid"),
            "taxon_name": taxon_name,
            "scientific_name": taxon.get("name"),
            "iconic_taxon": iconic_taxon,
            "quality_grade": observation.get("quality_grade"),
            "observed_on": observation.get("observed_on"),
            "user_login": (observation.get("user") or {}).get("login"),
            "photo_url": photo_url,
            "url": f"https://www.inaturalist.org/observations/{obs_id}",
            "ens_name": zone_props.get("name"),
            "ens_id": zone_feature.get("id"),
            "source": "iNaturalist API v1",
        },
    }


def fetch_zone_observations(
    zone_feature: dict[str, Any],
    seen_ids: set[int],
) -> list[dict[str, Any]]:
    geometry = zone_feature.get("geometry") or {}
    min_lon, min_lat, max_lon, max_lat = geometry_bbox(geometry)
    bbox = {
        "swlat": min_lat,
        "swlng": min_lon,
        "nelat": max_lat,
        "nelng": max_lon,
    }
    zone_name = (zone_feature.get("properties") or {}).get("name", zone_feature.get("id"))
    features: list[dict[str, Any]] = []
    page = 1
    total_results = None

    while page <= 100:
        payload = fetch_inaturalist_page(bbox, page)
        if total_results is None:
            total_results = payload.get("total_results", 0)
        results = payload.get("results") or []
        if not results:
            break

        for observation in results:
            obs_id = observation.get("id")
            if obs_id in seen_ids:
                continue

            feature = observation_to_feature(observation, zone_feature)
            if feature is None:
                continue

            lon, lat = feature["geometry"]["coordinates"]
            if not geometry_contains_point(geometry, lon, lat):
                continue

            seen_ids.add(obs_id)
            features.append(feature)

        if len(results) < 200:
            break
        if total_results and page * 200 >= total_results:
            break

        page += 1
        time.sleep(0.6)

    print(
        f"iNaturalist {zone_name}: {len(features)} observations "
        f"({total_results or 0} in bbox)",
        file=sys.stderr,
    )
    return features


def build_inaturalist_geojson(zones: list[dict[str, Any]]) -> dict[str, Any]:
    source_name = "iNaturalist - Observations dans les ENS du Vaucluse"
    source_url = (
        f"{INATURALIST_API}?{urllib.parse.urlencode({**VAUCLUSE_BBOX, 'geo': 'true'})}"
    )

    features: list[dict[str, Any]] = []
    seen_ids: set[int] = set()

    for zone_feature in zones:
        try:
            zone_features = fetch_zone_observations(zone_feature, seen_ids)
        except Exception as error:
            zone_name = (zone_feature.get("properties") or {}).get("name", "?")
            print(
                f"iNaturalist {zone_name}: source unavailable ({error})",
                file=sys.stderr,
            )
            continue
        features.extend(zone_features)
        time.sleep(0.4)

    data = {
        "type": "FeatureCollection",
        "features": features,
        "_cache": metadata(source_name, source_url),
    }
    data["_cache"]["observations_in_ens"] = str(len(features))
    return data


def sync_inaturalist_ens_names(ens_features: list[dict[str, Any]]) -> bool:
    """Refresh ens_name labels in the cached iNaturalist layer after ENS renames."""
    path = DATA_DIR / "inaturalist-sensitive-zones.geojson"
    if not path.exists():
        return False

    names_by_id = {
        feature.get("id"): (feature.get("properties") or {}).get("name")
        for feature in ens_features
    }
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = False
    for feature in data.get("features", []):
        props = feature.setdefault("properties", {})
        ens_id = props.get("ens_id")
        next_name = names_by_id.get(ens_id)
        if next_name and props.get("ens_name") != next_name:
            props["ens_name"] = next_name
            changed = True

    if not changed:
        return False
    return write_json_if_changed(path, data)


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    ens_data = build_ens_geojson()
    ens_changed = write_json_if_changed(DATA_DIR / "sensitive-natural-zones.geojson", ens_data)
    ens_state = "updated" if ens_changed else "unchanged"
    print(
        f"data/external/sensitive-natural-zones.geojson: {ens_state}, "
        f"{len(ens_data['features'])} features"
    )

    inat_names_changed = sync_inaturalist_ens_names(ens_data["features"])
    if inat_names_changed:
        print("data/external/inaturalist-sensitive-zones.geojson: updated ENS labels")

    inat_data = build_inaturalist_geojson(ens_data["features"])
    inat_changed = write_json_if_changed(
        DATA_DIR / "inaturalist-sensitive-zones.geojson", inat_data
    )
    inat_state = "updated" if inat_changed else "unchanged"
    print(
        f"data/external/inaturalist-sensitive-zones.geojson: {inat_state}, "
        f"{len(inat_data['features'])} features"
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
