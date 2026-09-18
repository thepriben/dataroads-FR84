"""Bounded retries and failover for the two scheduled Overpass exports."""
from __future__ import annotations

import http.client
from datetime import datetime, timedelta, timezone
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

FALLBACK = "https://overpass.private.coffee/api/interpreter"


def fetch(query, *, endpoint, user_agent, output="json", timeout=180, attempts=4):
    # An empty override disables failover (e.g. for a private Overpass server).
    endpoints = list(dict.fromkeys([endpoint, *filter(None, (
        value.strip() for value in os.environ.get("OVERPASS_FALLBACK_ENDPOINTS", FALLBACK).split(",")
    ))]))
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    for attempt in range(attempts):
        current = endpoints[attempt % len(endpoints)]
        request = urllib.request.Request(current, data=payload, headers={
            "Accept": "application/json" if output == "json" else "application/xml",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": user_agent,
        }, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                text = response.read().decode("utf-8")
            if output == "json":
                result = json.loads(text)
                if not isinstance(result, dict) or not isinstance(result.get("elements"), list):
                    raise ValueError("Invalid Overpass JSON response")
                base_timestamp = result.get("osm3s", {}).get("timestamp_osm_base")
                if result.get("remark"):
                    raise ValueError(f"Overpass incomplete response: {result['remark']}")
            else:
                root = ET.fromstring(text)
                if root.tag not in {"osm", "osmAugmentedDiff"}:
                    raise ValueError(f"Unexpected Overpass XML root: {root.tag}")
                remark = root.find(".//remark")
                if remark is not None:
                    raise ValueError(f"Overpass incomplete response: {remark.text}")
                meta = root.find("meta")
                base_timestamp = meta.get("osm_base") if meta is not None else None
                # A week across the entire department cannot safely be replaced
                # by an empty diff from an unhealthy/lagging replica.
                if "[adiff:" in query and root.find("action") is None:
                    raise ValueError("Suspicious empty Overpass augmented diff")
                result = text
            if base_timestamp:
                base = datetime.fromisoformat(base_timestamp.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) - base > timedelta(days=1):
                    raise ValueError(f"Overpass replica is stale: {base_timestamp}")
            print(f"Overpass response from {current}", flush=True)
            return result
        except (OSError, http.client.HTTPException, ValueError, ET.ParseError) as error:
            # Bad queries and authorization failures must not be retried.
            if isinstance(error, urllib.error.HTTPError) and error.code not in {408, 429, 500, 502, 503, 504}:
                raise RuntimeError(f"Overpass request rejected: {error}") from error
            if attempt == attempts - 1:
                raise RuntimeError(f"Overpass failed after {attempts} attempts: {error}") from error
            delay = 20 * (attempt + 1)
            if isinstance(error, urllib.error.HTTPError):
                retry_after = error.headers.get("Retry-After", "") if error.headers else ""
                if retry_after.isdigit():
                    delay = max(delay, min(int(retry_after), 300))
            print(f"Overpass {current}: {error}; retry in {delay}s using "
                  f"{endpoints[(attempt + 1) % len(endpoints)]}", file=sys.stderr, flush=True)
            time.sleep(delay)
    raise ValueError("attempts must be positive")
