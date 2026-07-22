#!/usr/bin/env python3
"""Build a multi-year accident cloud for the Vaucluse (dép. 84) from the BAAC.

Source: "Bases de données annuelles des accidents corporels de la circulation
routière" (ONISR / Ministère de l'Intérieur), published on data.gouv.fr.
https://www.data.gouv.fr/datasets/bases-de-donnees-annuelles-des-accidents-corporels-de-la-circulation-routiere-annees-de-2005-a-2024

The dataset ships 4 CSV files per year (Caractéristiques, Lieux, Véhicules,
Usagers). We only need:
  - Caractéristiques : coordinates (lat/long), date, department, commune, address
  - Usagers          : per-victim severity ("grav"), aggregated per accident

We resolve resource URLs dynamically through the data.gouv API (file names are
inconsistent across years, e.g. the well-known "carcteristiques" typo for
2021/2022), download them, keep only department 84 records with usable
coordinates, join the worst severity per accident, and emit a compact GeoJSON.

Only 2019+ is used by default: the modern schema is homogeneous (";" delimiter,
dep = "84", decimal comma coordinates) and geolocation quality is good. Older
millésimes used dep = 840 and far patchier coordinates.

Usage:
    python3 scripts/build_accidents_vaucluse.py [--start 2019] [--end 2024]

Output: data/static/accidents-vaucluse.geojson
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DATASET_SLUG = (
    "bases-de-donnees-annuelles-des-accidents-corporels-de-la-circulation-"
    "routiere-annees-de-2005-a-2024"
)
API_URL = f"https://www.data.gouv.fr/api/1/datasets/{DATASET_SLUG}/"
COMMUNES_URL = "https://geo.api.gouv.fr/departements/84/communes?fields=nom,code"
USER_AGENT = "dataroads-FR84 (+https://github.com/thepriben/dataroads-FR84)"

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "data" / "static" / "accidents-vaucluse.geojson"

# Vaucluse bounding box (generous) to drop obviously wrong coordinates.
BBOX = {"lat_min": 43.5, "lat_max": 44.6, "lon_min": 4.3, "lon_max": 5.9}

# grav codes in the BAAC usagers file.
GRAV_KILLED = "2"        # tué
GRAV_HOSPITALISED = "3"  # blessé hospitalisé
GRAV_LIGHT = "4"         # blessé léger
GRAV_UNHARMED = "1"      # indemne


def http_get(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def resolve_resources(start: int, end: int) -> dict[int, dict[str, str]]:
    """Return {year: {"carac": url, "usagers": url}} for the requested range."""
    payload = json.loads(http_get(API_URL).decode("utf-8"))
    resources = payload.get("resources", [])
    out: dict[int, dict[str, str]] = {}
    for res in resources:
        title = (res.get("title") or "").lower()
        if (res.get("format") or "").lower() != "csv":
            continue
        year = None
        for y in range(start, end + 1):
            if str(y) in title:
                year = y
                break
        if year is None:
            continue
        kind = None
        # "caracteristiques", "caract", and the "carcteristiques" typo.
        if title.startswith("carac") or title.startswith("carct") or "aracter" in title or "arcter" in title:
            kind = "carac"
        elif "usager" in title:
            kind = "usagers"
        if kind:
            out.setdefault(year, {})[kind] = res.get("url")
    return out


def decode_csv(raw: bytes) -> tuple[list[dict[str, str]], list[str]]:
    """Decode a BAAC CSV, auto-detecting encoding and delimiter."""
    text = None
    for enc in ("utf-8-sig", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = raw.decode("utf-8", errors="replace")

    header = text.split("\n", 1)[0]
    # Pick the delimiter that yields the most columns.
    delimiter = max([";", ",", "\t", "|"], key=lambda d: header.count(d))
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    fieldnames = [normalize_key(k) for k in (reader.fieldnames or [])]
    rows: list[dict[str, str]] = []
    for row in reader:
        rows.append({normalize_key(k): (v or "") for k, v in row.items()})
    return rows, fieldnames


def normalize_key(key: str) -> str:
    return (key or "").strip().strip('"').strip("\ufeff").lower()


def pick(row: dict[str, str], *candidates: str) -> str:
    for cand in candidates:
        if cand in row and row[cand] not in (None, ""):
            return row[cand]
    return ""


def parse_coord(value: str) -> float | None:
    value = (value or "").strip().strip('"').replace(",", ".")
    if not value or value in ("0", "0.0"):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def load_commune_names() -> dict[str, str]:
    try:
        data = json.loads(http_get(COMMUNES_URL).decode("utf-8"))
        return {str(c["code"]): c["nom"] for c in data}
    except Exception as exc:  # pragma: no cover - network best effort
        print(f"⚠️  Impossible de charger les noms de communes: {exc}", file=sys.stderr)
        return {}


def worst_severity(gravs: list[str]) -> str | None:
    if GRAV_KILLED in gravs:
        return "mortel"
    if GRAV_HOSPITALISED in gravs:
        return "grave"
    if GRAV_LIGHT in gravs:
        return "leger"
    return None


def build(start: int, end: int) -> dict:
    resources = resolve_resources(start, end)
    commune_names = load_commune_names()

    features: list[dict] = []
    per_year: dict[int, int] = {}
    counts = {"mortels": 0, "hospitalises": 0, "legers": 0}
    total_tues = 0
    total_blesses = 0

    for year in range(start, end + 1):
        urls = resources.get(year, {})
        carac_url = urls.get("carac")
        usagers_url = urls.get("usagers")
        if not carac_url or not usagers_url:
            print(f"⚠️  {year}: ressources manquantes (carac={bool(carac_url)}, "
                  f"usagers={bool(usagers_url)}) — année ignorée", file=sys.stderr)
            continue

        print(f"→ {year}: téléchargement usagers…", file=sys.stderr)
        usagers_rows, _ = decode_csv(http_get(usagers_url))
        gravs_by_acc: dict[str, list[str]] = {}
        for row in usagers_rows:
            acc = pick(row, "num_acc", "accident_id", "id_accident")
            grav = pick(row, "grav").strip().strip('"')
            if not acc:
                continue
            gravs_by_acc.setdefault(acc, []).append(grav)

        print(f"→ {year}: téléchargement caractéristiques…", file=sys.stderr)
        carac_rows, _ = decode_csv(http_get(carac_url))
        year_count = 0
        for row in carac_rows:
            dep = pick(row, "dep").strip().strip('"')
            if dep not in ("84", "084", "840"):
                continue
            lat = parse_coord(pick(row, "lat"))
            lon = parse_coord(pick(row, "long", "lon"))
            if lat is None or lon is None:
                continue
            if not (BBOX["lat_min"] <= lat <= BBOX["lat_max"] and
                    BBOX["lon_min"] <= lon <= BBOX["lon_max"]):
                continue

            acc = pick(row, "num_acc", "accident_id", "id_accident")
            gravs = gravs_by_acc.get(acc, [])
            severity = worst_severity(gravs)
            if severity is None:
                continue  # no injured victim recorded → skip

            tues = gravs.count(GRAV_KILLED)
            hosp = gravs.count(GRAV_HOSPITALISED)
            legers = gravs.count(GRAV_LIGHT)

            if severity == "mortel":
                counts["mortels"] += 1
            elif severity == "grave":
                counts["hospitalises"] += 1
            else:
                counts["legers"] += 1
            total_tues += tues
            total_blesses += hosp + legers

            jour = pick(row, "jour").zfill(2)
            mois = pick(row, "mois").zfill(2)
            hrmn = pick(row, "hrmn").replace(":", "h")
            date_str = f"{jour}/{mois}/{year}"
            if hrmn:
                date_str += f" - {hrmn}"

            com = pick(row, "com").strip().strip('"')
            commune = commune_names.get(com)
            if commune:
                commune = f"{com} - {commune}"
            else:
                commune = com or "N/A"

            agg = pick(row, "agg").strip().strip('"')
            milieu = "En agglomération" if agg == "2" else "Hors agglomération"

            adr = pick(row, "adr").strip().strip('"')

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(lon, 5), round(lat, 5)],
                },
                "properties": {
                    "annee": year,
                    "gravite": severity,
                    "tues": tues,
                    "hospitalises": hosp,
                    "legers": legers,
                    "total_blesses": hosp + legers,
                    "date": date_str,
                    "commune": commune,
                    "adresse": adr,
                    "milieu": milieu,
                },
            })
            year_count += 1

        per_year[year] = year_count
        print(f"   {year}: {year_count} accidents géolocalisés (dép. 84)", file=sys.stderr)

    total = counts["mortels"] + counts["hospitalises"] + counts["legers"]
    return {
        "type": "FeatureCollection",
        "_cache": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": "BAAC / ONISR (data.gouv.fr)",
        },
        "metadata": {
            "departement": "Vaucluse",
            "code_departement": "84",
            "source": "Fichier BAAC — ONISR / Ministère de l'Intérieur (data.gouv.fr)",
            "licence": "Licence Ouverte / Open Licence",
            "annees": [y for y in range(start, end + 1) if per_year.get(y)],
            "par_annee": per_year,
            "statistiques": {
                "mortels": counts["mortels"],
                "hospitalises": counts["hospitalises"],
                "legers": counts["legers"],
                "total": total,
                "total_tues": total_tues,
                "total_blesses": total_blesses,
            },
        },
        "features": features,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=int, default=2019)
    parser.add_argument("--end", type=int, default=2024)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()

    fc = build(args.start, args.end)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as fh:
        json.dump(fc, fh, ensure_ascii=False, separators=(",", ":"))

    stats = fc["metadata"]["statistiques"]
    size_kb = args.output.stat().st_size / 1024
    print(
        f"\n✓ {len(fc['features'])} accidents écrits dans {args.output} "
        f"({size_kb:.0f} Ko)\n"
        f"  mortels={stats['mortels']} · hospitalisés={stats['hospitalises']} "
        f"· légers={stats['legers']} · tués={stats['total_tues']}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
