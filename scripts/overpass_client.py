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

# Il n'existe plus de miroir public en état de servir. Mesuré le 24 septembre
# 2026 : private.coffee et kumi.systems ne répondent pas en moins d'une minute,
# osm.jp présente un certificat invalide, osm.ch renvoie un autre format et
# rambler.ru n'a plus d'enregistrement DNS. Un repli muet coûte plus qu'il ne
# rapporte — il consommait une tentative sur deux — et celui-ci, quand il
# répondait, annonçait une base vieille de quatre mois, prête à remplacer nos
# données par de plus anciennes. OVERPASS_FALLBACK_ENDPOINTS reste là pour en
# déclarer un le jour où il en existera un qui tienne.
FALLBACK = ""

# Retard toléré sur la réplique interrogée. Le serveur principal répartit la
# charge sur plusieurs répliques dont certaines traînent d'un jour ou deux ; le
# seuil d'un jour les refusait, et cinq des six dernières exécutions planifiées
# ont échoué pour cette raison. Or un refus ne conserve pas des données
# fraîches, il conserve celles du disque : refuser deux jours de retard nous
# laissait avec deux semaines. Le seuil n'a donc à écarter que les répliques
# franchement décrochées, de plusieurs mois. La fraîcheur au jour près ne
# concerne que le diff horaire, qui la réclame explicitement.
DEFAULT_MAX_LAG = timedelta(days=7)


def _pick_endpoint(endpoints, stale, attempt):
    # Une réplique déjà surprise en retard pendant cette requête ne mérite pas
    # les tentatives qui restent : sans cela un miroir décroché les épuisait à
    # lui seul, en alternance avec le serveur qui répondait.
    usable = [url for url in endpoints if url not in stale] or endpoints
    return usable[attempt % len(usable)]


def fetch(query, *, endpoint, user_agent, output="json", timeout=180, attempts=4,
          max_lag=DEFAULT_MAX_LAG):
    # An empty override disables failover (e.g. for a private Overpass server).
    endpoints = list(dict.fromkeys([endpoint, *filter(None, (
        value.strip() for value in os.environ.get("OVERPASS_FALLBACK_ENDPOINTS", FALLBACK).split(",")
    ))]))
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    stale: set[str] = set()
    for attempt in range(attempts):
        current = _pick_endpoint(endpoints, stale, attempt)
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
            if base_timestamp and max_lag is not None:
                base = datetime.fromisoformat(base_timestamp.replace("Z", "+00:00"))
                lag = datetime.now(timezone.utc) - base
                if lag > max_lag:
                    stale.add(current)
                    raise ValueError(
                        f"Overpass replica is stale by {lag.days} d "
                        f"(limit {max_lag.days} d): {base_timestamp}"
                    )
            print(f"Overpass response from {current} (base {base_timestamp})", flush=True)
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
