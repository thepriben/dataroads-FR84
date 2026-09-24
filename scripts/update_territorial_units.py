#!/usr/bin/env python3
"""Attribuer chaque tronçon OSM à ses unités territoriales.

Le Département publie ses limites d'exploitation sur DataSud sous forme
linéaire — un tronçon de voirie par entité, portant son agence routière, son
centre d'exploitation et son canton. Les fiches « zones de compétences » du
même portail sont vides : ces emprises surfaciques n'existent pas, et ne se
reconstituent pas depuis les communes puisque 57 d'entre elles relèvent de
plusieurs CEER.

Plutôt que d'embarquer les 5,6 Mo de géométrie départementale à côté des
tracés OSM que l'application dessine déjà, ce script fait la jointure une fois
pour toutes, hors ligne. Il en sort une table d'indices : à chaque tronçon OSM,
cinq numéros d'unité.

Trois appariements, selon la nature de l'information cherchée :

- L'agence, le centre et le canton se lisent sur la section CD84 la plus
  proche. Apparier d'abord par référence de route paraissait plus sûr, mais sa
  queue de distribution est mauvaise — la D118 d'OSM et celle du CD84 sont à
  1,8 km l'une de l'autre. Or le secteur d'exploitation est une propriété du
  lieu et non du numéro : le centre de la voirie départementale la plus proche
  est la meilleure réponse disponible. La référence ne sert qu'à départager
  deux sections également proches, dans les carrefours denses.

- La commune se lit par inclusion dans les limites communales, que
  l'application extrait déjà d'OSM sans les avoir jamais exploitées. Le
  résultat est exact et porte le code INSEE.

- L'EPCI se déduit de ce code INSEE via l'API Découpage administratif de
  l'État. Aucune géométrie supplémentaire n'est nécessaire.
"""

from __future__ import annotations

import json
import math
import os
import sys
import unicodedata
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

APP_VERSION = os.environ.get("APP_VERSION", read_version())
USER_AGENT = os.environ.get("APP_USER_AGENT", user_agent())

WFS_BASE = "https://www.datasud.fr/fr/geoserv/conseil-departemental-de-vaucluse/ows"
WFS_LAYER = "conseil-departemental-de-vaucluse:limites-exploitation-voirie-departementale"
WFS_SOURCE = "Limites exploitation voirie départementale — Département de Vaucluse (DataSud)"
WFS_PAGE = ("https://www.datasud.fr/explorer/fr/jeux-de-donnees/"
            "limites-exploitation-voirie-departementale/info")

EPCI_URL = ("https://geo.api.gouv.fr/departements/84/communes"
            "?fields=nom,code,codeEpci,epci&format=json")
EPCI_SOURCE = "Découpage administratif — API Géo (Etalab)"

ROADS = ROOT / "data" / "osm" / "departmental-roads.geojson"
COMMUNES = ROOT / "data" / "osm" / "communes-vaucluse.geojson"
OUTPUT = ROOT / "data" / "external" / "territorial-units.json"

# Du plus large au plus fin. `field` désigne l'attribut CD84 à lire, doublé
# parce que le jeu porte deux millésimes de la même information ; `None` marque
# les échelles qui ne viennent pas du CD84.
SCALES: list[tuple[str, str, tuple[str, ...] | None]] = [
    ("ard", "Agence routière", ("ARD_EXPL", "AGENC_2024")),
    ("ceer", "Centre d'exploitation", ("CEER_EXPL", "CENTR_2024")),
    ("canton", "Canton", ("CANTON",)),
    ("epci", "Intercommunalité", None),
    ("commune", "Commune", None),
]
CD84_SCALES = [key for key, _, field in SCALES if field]

# Une section CD84 plus éloignée que cela du tronçon n'apprend plus rien de son
# secteur. Le 98e centile des distances mesurées est à 1,1 km.
MAX_MATCH_METERS = 2500.0

# Valeurs de remplissage du jeu départemental, à ne pas présenter comme unités.
PLACEHOLDERS = {"AUTRE", "NONE", "NULL", ""}

# Le Vaucluse tient dans un carré de 90 km : une projection plate suffit pour
# comparer des distances de quelques mètres, et évite une dépendance à pyproj.
LAT_METERS = 111_320.0
GRID_DEGREES = 0.02


def lon_meters(lat: float) -> float:
    return LAT_METERS * math.cos(math.radians(lat))


def fetch_json(url: str, timeout: int = 180) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_wfs() -> dict[str, Any]:
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": WFS_LAYER,
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
    }
    payload = fetch_json(f"{WFS_BASE}?{urllib.parse.urlencode(params)}")
    if payload.get("type") != "FeatureCollection":
        raise ValueError("WFS : FeatureCollection attendue")
    return payload


def normalize_ref(value: Any) -> str:
    return str(value or "").replace(" ", "").upper()


def normalize_name(value: Any) -> str:
    stripped = unicodedata.normalize("NFD", str(value or ""))
    ascii_only = stripped.encode("ascii", "ignore").decode()
    return "".join(c for c in ascii_only.upper() if c.isalnum())


NORMALIZED_PLACEHOLDERS = {normalize_name(p) for p in PLACEHOLDERS}


def first_attribute(props: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = props.get(key)
        if value not in (None, ""):
            return str(value).strip()
    return ""


def flatten_line(geometry: dict[str, Any] | None) -> list[tuple[float, float]]:
    """Réduit LineString et MultiLineString à une suite de points (lon, lat)."""
    if not geometry:
        return []
    kind = geometry.get("type")
    raw = geometry.get("coordinates") or []
    parts = [raw] if kind == "LineString" else raw if kind == "MultiLineString" else []
    points: list[tuple[float, float]] = []
    for part in parts:
        for point in part:
            if isinstance(point, (list, tuple)) and len(point) >= 2:
                points.append((float(point[0]), float(point[1])))
    return points


def point_to_segment_m(px: float, py: float,
                       ax: float, ay: float,
                       bx: float, by: float) -> float:
    scale = lon_meters((ay + by) / 2.0)
    pxm, axm, bxm = px * scale, ax * scale, bx * scale
    pym, aym, bym = py * LAT_METERS, ay * LAT_METERS, by * LAT_METERS
    dx, dy = bxm - axm, bym - aym
    if dx == 0.0 and dy == 0.0:
        return math.hypot(pxm - axm, pym - aym)
    t = ((pxm - axm) * dx + (pym - aym) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(pxm - (axm + t * dx), pym - (aym + t * dy))


def distance_to_line_m(point: tuple[float, float],
                       line: list[tuple[float, float]]) -> float:
    if not line:
        return math.inf
    if len(line) == 1:
        return point_to_segment_m(point[0], point[1], line[0][0], line[0][1],
                                  line[0][0], line[0][1])
    return min(
        point_to_segment_m(point[0], point[1],
                           line[index][0], line[index][1],
                           line[index + 1][0], line[index + 1][1])
        for index in range(len(line) - 1)
    )


def line_length_m(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for index in range(len(points) - 1):
        (ax, ay), (bx, by) = points[index], points[index + 1]
        scale = lon_meters((ay + by) / 2.0)
        total += math.hypot((bx - ax) * scale, (by - ay) * LAT_METERS)
    return total


class SectionIndex:
    """Les sections CD84 dans une grille, pour ne comparer que le voisinage.

    Sans elle, chacun des 9 000 tronçons serait confronté aux 2 543 sections et
    à leurs sommets : le quart d'heure de calcul rendait le script inutilisable
    dans une action planifiée.
    """

    def __init__(self, features: list[dict[str, Any]]) -> None:
        self.lines: list[list[tuple[float, float]]] = []
        self.labels: list[dict[str, str]] = []
        self.refs: list[str] = []
        self.cells: dict[tuple[int, int], list[int]] = {}

        for feature in features:
            points = flatten_line(feature.get("geometry"))
            if len(points) < 2:
                continue
            props = feature.get("properties") or {}
            position = len(self.lines)
            self.lines.append(points)
            self.labels.append({
                key: first_attribute(props, field)
                for key, _, field in SCALES if field
            })
            self.refs.append(normalize_ref(props.get("NOM_ROU_CD")))
            for cell in self._cells_of(points):
                self.cells.setdefault(cell, []).append(position)

    @staticmethod
    def _cell(lon: float, lat: float) -> tuple[int, int]:
        return (int(math.floor(lon / GRID_DEGREES)),
                int(math.floor(lat / GRID_DEGREES)))

    def _cells_of(self, points: list[tuple[float, float]]) -> set[tuple[int, int]]:
        lons = [p[0] for p in points]
        lats = [p[1] for p in points]
        x0, y0 = self._cell(min(lons), min(lats))
        x1, y1 = self._cell(max(lons), max(lats))
        return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}

    def nearest(self, point: tuple[float, float], ref: str) -> tuple[int, float] | None:
        """La section la plus proche, la référence départageant les ex æquo."""
        cx, cy = self._cell(point[0], point[1])
        cell_meters = GRID_DEGREES * lon_meters(point[1])
        best: tuple[int, float] | None = None
        radius = 0
        while True:
            for x in range(cx - radius, cx + radius + 1):
                for y in range(cy - radius, cy + radius + 1):
                    # Les anneaux déjà parcourus ne sont pas revisités.
                    if radius and max(abs(x - cx), abs(y - cy)) != radius:
                        continue
                    for position in self.cells.get((x, y), ()):
                        distance = distance_to_line_m(point, self.lines[position])
                        if best is None or distance < best[1] - 1.0:
                            best = (position, distance)
                        elif abs(distance - best[1]) <= 1.0 and ref and self.refs[position] == ref:
                            best = (position, distance)
            # Rien de plus proche ne peut se cacher au-delà de l'anneau exploré.
            if best is not None and best[1] <= radius * cell_meters:
                break
            radius += 1
            if radius * cell_meters > MAX_MATCH_METERS:
                break
        if best is None or best[1] > MAX_MATCH_METERS:
            return None
        return best


class CommuneIndex:
    """Limites communales OSM, interrogées par inclusion du point."""

    def __init__(self, features: list[dict[str, Any]]) -> None:
        self.entries: list[tuple[list[list[tuple[float, float]]],
                                 tuple[float, float, float, float],
                                 str, str]] = []
        for feature in features:
            geometry = feature.get("geometry") or {}
            kind = geometry.get("type")
            raw = geometry.get("coordinates") or []
            polygons = [raw] if kind == "Polygon" else raw if kind == "MultiPolygon" else []
            rings: list[list[tuple[float, float]]] = []
            for polygon in polygons:
                for ring in polygon:
                    rings.append([(float(p[0]), float(p[1])) for p in ring
                                  if isinstance(p, (list, tuple)) and len(p) >= 2])
            if not rings:
                continue
            lons = [p[0] for ring in rings for p in ring]
            lats = [p[1] for ring in rings for p in ring]
            props = feature.get("properties") or {}
            self.entries.append((
                rings,
                (min(lons), min(lats), max(lons), max(lats)),
                str(props.get("name") or ""),
                str(props.get("ref:INSEE") or ""),
            ))

    @staticmethod
    def _in_ring(point: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
        x, y = point
        inside = False
        count = len(ring)
        for index in range(count):
            x1, y1 = ring[index]
            x2, y2 = ring[(index + 1) % count]
            if (y1 > y) != (y2 > y):
                if y2 != y1 and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                    inside = not inside
        return inside

    def locate(self, point: tuple[float, float]) -> tuple[str, str] | None:
        for rings, (minx, miny, maxx, maxy), name, insee in self.entries:
            if not (minx <= point[0] <= maxx and miny <= point[1] <= maxy):
                continue
            # Le premier anneau porte le contour, les suivants les enclaves.
            if not self._in_ring(point, rings[0]):
                continue
            if any(self._in_ring(point, hole) for hole in rings[1:]):
                continue
            return name, insee
        return None


class ScaleBuilder:
    """Accumule les unités d'une échelle et ce que chacune porte de réseau."""

    def __init__(self, key: str, label: str) -> None:
        self.key = key
        self.label = label
        self.index: dict[str, int] = {}
        self.units: list[dict[str, Any]] = []

    def resolve(self, name: str, code: str = "") -> int | None:
        if normalize_name(name) in NORMALIZED_PLACEHOLDERS:
            return None
        if name not in self.index:
            self.index[name] = len(self.units)
            self.units.append({
                "name": name,
                "code": code,
                "ways": 0,
                "meters": 0.0,
                "refs": set(),
                "bounds": [180.0, 90.0, -180.0, -90.0],
            })
        return self.index[name]

    def add(self, position: int, ref: str, meters: float,
            points: list[tuple[float, float]]) -> None:
        unit = self.units[position]
        unit["ways"] += 1
        unit["meters"] += meters
        if ref:
            unit["refs"].add(ref)
        bounds = unit["bounds"]
        for lon, lat in points:
            bounds[0] = min(bounds[0], lon)
            bounds[1] = min(bounds[1], lat)
            bounds[2] = max(bounds[2], lon)
            bounds[3] = max(bounds[3], lat)

    def finish(self) -> tuple[dict[str, Any], dict[int, int]]:
        built = []
        for unit in self.units:
            entry: dict[str, Any] = {
                "name": unit["name"],
                "ways": unit["ways"],
                "km": round(unit["meters"] / 1000.0, 1),
                "refs": sorted(unit["refs"], key=lambda r: (len(r), r)),
                "bounds": [round(v, 5) for v in unit["bounds"]],
            }
            if unit["code"]:
                entry["code"] = unit["code"]
            built.append(entry)
        # Le plus long réseau d'abord : c'est l'ordre dans lequel on cherche son
        # secteur parmi onze centres, et plus encore parmi cent cinquante communes.
        order = sorted(range(len(built)), key=lambda i: (-built[i]["km"], built[i]["name"]))
        remap = {old: new for new, old in enumerate(order)}
        return {"label": self.label, "units": [built[i] for i in order]}, remap


def build(wfs: dict[str, Any], roads: dict[str, Any],
          communes: dict[str, Any], epci_by_insee: dict[str, dict[str, str]]) -> dict[str, Any]:
    sections = SectionIndex(wfs.get("features") or [])
    towns = CommuneIndex(communes.get("features") or [])
    builders = {key: ScaleBuilder(key, label) for key, label, _ in SCALES}
    order = [key for key, _, _ in SCALES]

    ways: dict[str, list[int | None]] = {}
    stats = {"total": 0, "cd84": 0, "commune": 0, "epci": 0}
    distances: list[float] = []

    for feature in roads.get("features") or []:
        props = feature.get("properties") or {}
        way_id = props.get("osm_id")
        points = flatten_line(feature.get("geometry"))
        if way_id is None or not points:
            continue
        centre = points[len(points) // 2]
        ref = normalize_ref(props.get("ref"))
        meters = line_length_m(points)
        stats["total"] += 1

        labels: dict[str, tuple[str, str]] = {}
        found = sections.nearest(centre, ref)
        if found is not None:
            position, distance = found
            distances.append(distance)
            stats["cd84"] += 1
            for key in CD84_SCALES:
                labels[key] = (sections.labels[position].get(key, ""), "")

        town = towns.locate(centre)
        if town is not None:
            name, insee = town
            labels["commune"] = (name, insee)
            stats["commune"] += 1
            epci = epci_by_insee.get(insee)
            if epci:
                labels["epci"] = (epci["nom"], epci["code"])
                stats["epci"] += 1

        row: list[int | None] = []
        for key in order:
            name, code = labels.get(key, ("", ""))
            position = builders[key].resolve(name, code)
            row.append(position)
            if position is not None:
                builders[key].add(position, ref, meters, points)
        if any(value is not None for value in row):
            ways[str(way_id)] = row

    scales: dict[str, Any] = {}
    remaps: dict[str, dict[int, int]] = {}
    for key in order:
        scales[key], remaps[key] = builders[key].finish()

    # Les unités ont été reclassées par linéaire : les indices des tronçons
    # doivent suivre, sinon chacun désignerait le voisin de son secteur.
    for way_id, row in ways.items():
        ways[way_id] = [
            None if value is None else remaps[order[column]][value]
            for column, value in enumerate(row)
        ]

    distances.sort()
    def centile(value: int) -> float:
        if not distances:
            return 0.0
        return round(distances[min(len(distances) - 1, int(len(distances) * value / 100))], 1)

    return {
        "_cache": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source_name": WFS_SOURCE,
            "source_url": WFS_PAGE,
            "source_service": f"{WFS_BASE}?service=WFS&typeNames={WFS_LAYER}",
            "epci_source_name": EPCI_SOURCE,
            "epci_source_url": EPCI_URL,
            "user_agent": USER_AGENT,
            "cd84_sections": len(sections.lines),
            "osm_ways": stats["total"],
            "matched_cd84": stats["cd84"],
            "matched_commune": stats["commune"],
            "matched_epci": stats["epci"],
            "match_distance_m": {"p50": centile(50), "p90": centile(90), "p99": centile(99)},
        },
        "order": order,
        "scales": scales,
        "ways": ways,
    }


def write_json_if_changed(path: Path, data: dict[str, Any]) -> bool:
    content = json.dumps(data, ensure_ascii=True, separators=(",", ":")) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def main() -> int:
    for required in (ROADS, COMMUNES):
        if not required.exists():
            print(f"Jeu OSM absent : {required}", file=sys.stderr)
            return 1

    try:
        wfs = fetch_wfs()
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError) as error:
        print(f"::warning title=DataSud injoignable::{error}")
        print(f"WFS unreachable, {OUTPUT.name} left in place: {error}", file=sys.stderr)
        return 0 if OUTPUT.exists() else 1

    epci_by_insee: dict[str, dict[str, str]] = {}
    try:
        for entry in fetch_json(EPCI_URL, timeout=60):
            epci = entry.get("epci") or {}
            if entry.get("code") and epci.get("nom"):
                epci_by_insee[str(entry["code"])] = {
                    "nom": str(epci["nom"]),
                    "code": str(epci.get("code") or ""),
                }
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError) as error:
        # Une échelle en moins vaut mieux qu'un jeu absent : les quatre autres
        # ne dépendent pas de l'API Géo.
        print(f"::warning title=API Géo injoignable::{error}")

    roads = json.loads(ROADS.read_text(encoding="utf-8"))
    communes = json.loads(COMMUNES.read_text(encoding="utf-8"))
    payload = build(wfs, roads, communes, epci_by_insee)

    cache = payload["_cache"]
    if cache["matched_cd84"] == 0 and cache["matched_commune"] == 0:
        print("Aucun tronçon apparié : jointure abandonnée.", file=sys.stderr)
        return 1

    changed = write_json_if_changed(OUTPUT, payload)
    total = max(cache["osm_ways"], 1)
    print(f"{OUTPUT.relative_to(ROOT)} : {cache['osm_ways']} tronçons, "
          f"{cache['cd84_sections']} sections CD84")
    print(f"   secteur CD84 {cache['matched_cd84']:5d} "
          f"({100.0 * cache['matched_cd84'] / total:.1f} %) · "
          f"distances p50 {cache['match_distance_m']['p50']} m, "
          f"p90 {cache['match_distance_m']['p90']} m, "
          f"p99 {cache['match_distance_m']['p99']} m")
    print(f"   commune     {cache['matched_commune']:5d} "
          f"({100.0 * cache['matched_commune'] / total:.1f} %)")
    print(f"   EPCI        {cache['matched_epci']:5d} "
          f"({100.0 * cache['matched_epci'] / total:.1f} %)")
    for key, _, _ in SCALES:
        print(f"   {key:8s} {len(payload['scales'][key]['units']):4d} unités")
    print("inchangé" if not changed else "écrit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
