#!/usr/bin/env python3
"""Refresh static Overpass cache files for the GitHub Pages site."""

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


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "osm"
ENDPOINT = os.environ.get("OVERPASS_ENDPOINT", "https://overpass-api.de/api/interpreter")
APP_NAME = os.environ.get("APP_NAME", "demo-inforoute-084")
APP_VERSION = os.environ.get("APP_VERSION", "0.1.0")
REPOSITORY = os.environ.get("APP_REPOSITORY", "https://github.com/thepriben/demo-inforoute-084")
USER_AGENT = os.environ.get("OVERPASS_USER_AGENT", f"{APP_NAME}/{APP_VERSION} ({REPOSITORY})")


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
        (
          area["ISO3166-2"="FR-84"]->.dept;
          way(area.dept)["highway"="construction"];
          way(area.dept)["construction"="highway"];
          way(area.dept)["construction"]["highway"];
          way(area.dept)["construction:highway"];
          way(area.dept)["highway"="proposed"];
          way(area.dept)["proposed"="highway"];
          way(area.dept)["proposed:highway"];
          way(43.6,4.5,44.4,5.9)["highway"="construction"];
          way(43.6,4.5,44.4,5.9)["construction"]["highway"];
          way(43.6,4.5,44.4,5.9)["highway"="proposed"];
        );
        out geom;
    """,
    "communes-vaucluse": """
        [out:json][timeout:60];
        area["ISO3166-2"="FR-84"]->.dept;
        relation(area.dept)["boundary"="administrative"]["admin_level"="8"];
        out geom;
    """,
}


def request_overpass(query: str) -> dict:
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


def write_json_if_changed(path: Path, data: dict) -> bool:
    content = json.dumps(data, ensure_ascii=True, separators=(",", ":")) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False

    path.write_text(content, encoding="utf-8")
    return True


def refresh_cache(name: str, query: str) -> bool:
    last_error: Exception | None = None

    for attempt in range(1, 4):
        try:
            data = request_overpass(query)
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            if attempt == 3:
                raise
            wait_seconds = attempt * 5
            print(f"{name}: retry in {wait_seconds}s after {error}", file=sys.stderr)
            time.sleep(wait_seconds)
    else:
        raise RuntimeError(f"{name}: {last_error}")

    data["_cache"] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": ENDPOINT,
        "user_agent": USER_AGENT,
    }

    output_path = DATA_DIR / f"{name}.json"
    changed = write_json_if_changed(output_path, data)
    elements_count = len(data.get("elements", []))
    state = "updated" if changed else "unchanged"
    print(f"{output_path.relative_to(ROOT)}: {state}, {elements_count} elements")
    return changed


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Overpass endpoint: {ENDPOINT}")
    print(f"User-Agent: {USER_AGENT}")

    changed = False
    for name, query in QUERIES.items():
        changed = refresh_cache(name, query) or changed

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
