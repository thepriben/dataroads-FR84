"""Le rendez-vous nocturne : choix du cron selon la saison, et seuil de péremption.

Le verdict de saison est écrit en Python dans le workflow lui-même. Le relire ici
depuis le YAML plutôt que d'en recopier la logique est le seul moyen d'éprouver ce
qui tournera vraiment : une copie resterait verte le jour où le workflow change.
"""

from __future__ import annotations

import json
import os
import sys
import textwrap
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import update_osm_geojson

WORKFLOW = ROOT / ".github" / "workflows" / "update-osm-geojson.yml"

SUMMER_CRON = "0 0 * * *"
WINTER_CRON = "0 1 * * *"
CATCH_UP_CRON = "47 12 * * *"


def gate_source() -> str:
    """Le corps du heredoc qui décide, dans le workflow, si le cron est le bon."""
    lines = WORKFLOW.read_text(encoding="utf-8").splitlines()
    start = next(index for index, line in enumerate(lines) if "<<'PY'" in line)
    end = next(index for index, line in enumerate(lines[start + 1 :], start + 1) if line.strip() == "PY")
    return textwrap.dedent("\n".join(lines[start + 1 : end]))


def gate_verdict(moment: datetime, schedule: str) -> bool:
    """Rejoue le verdict du workflow à un instant donné.

    Seule l'horloge est remplacée : le reste du code exécuté est celui du YAML.
    """
    source = gate_source().replace(
        'datetime.now(ZoneInfo("Europe/Paris"))',
        'datetime.fromisoformat(os.environ["INSTANT"]).astimezone(ZoneInfo("Europe/Paris"))',
    )
    captured: list[str] = []
    environment = {"DECLENCHEUR": schedule, "INSTANT": moment.isoformat()}
    with mock.patch.dict(os.environ, environment, clear=False):
        exec(compile(source, str(WORKFLOW), "exec"), {"print": captured.append})
    return captured == ["poursuivre=true"]


# Un passage retardé doit tourner quand même : le verdict se prend sur le décalage
# horaire de Paris, pas sur l'heure qu'il est. Les deux dernières lignes de chaque
# saison le vérifient avec les retards réellement observés sur ce dépôt.
TRUTH_TABLE = [
    ("Hiver, à l'heure", "2027-01-15T00:00:00+00:00", SUMMER_CRON, False),
    ("Hiver, à l'heure", "2027-01-15T01:00:00+00:00", WINTER_CRON, True),
    ("Hiver, retardé de 7 h", "2027-01-15T08:23:00+00:00", WINTER_CRON, True),
    ("Hiver, retardé de 5 h", "2027-01-15T05:00:00+00:00", SUMMER_CRON, False),
    ("Été, à l'heure", "2027-07-15T00:00:00+00:00", SUMMER_CRON, True),
    ("Été, à l'heure", "2027-07-15T01:00:00+00:00", WINTER_CRON, False),
    ("Été, retardé de 5 h", "2027-07-15T05:30:00+00:00", SUMMER_CRON, True),
    ("Été, retardé de 7 h", "2027-07-15T08:23:00+00:00", WINTER_CRON, False),
    # Nuit du passage à l'heure d'été : 2 h locales n'existent pas, et aucun des
    # deux crons ne se reconnaît dans la saison de son instant. Le passage est
    # sauté ; le rattrapage de midi le reprend le jour même, tous les jeux ayant
    # alors dépassé les trente heures.
    ("Bascule mars, 00:00 UTC", "2027-03-28T00:00:00+00:00", SUMMER_CRON, False),
    ("Bascule mars, 01:00 UTC", "2027-03-28T01:00:00+00:00", WINTER_CRON, False),
    # Nuit du retour à l'heure d'hiver : 2 h locales sonnent deux fois, et chacun
    # des deux crons tombe juste. Une extraction en double, une fois l'an.
    ("Bascule octobre, 00:00 UTC", "2027-10-31T00:00:00+00:00", SUMMER_CRON, True),
    ("Bascule octobre, 01:00 UTC", "2027-10-31T01:00:00+00:00", WINTER_CRON, True),
    # Le rattrapage et le déclenchement manuel ne visent aucune heure locale.
    ("Rattrapage, hiver", "2027-01-15T12:47:00+00:00", CATCH_UP_CRON, True),
    ("Rattrapage, été", "2027-07-15T12:47:00+00:00", CATCH_UP_CRON, True),
    ("Déclenchement manuel, hiver", "2027-01-15T14:00:00+00:00", "", True),
    ("Déclenchement manuel, été", "2027-07-15T14:00:00+00:00", "", True),
]


class SeasonGateTests(unittest.TestCase):
    def test_truth_table(self):
        for title, instant, schedule, expected in TRUTH_TABLE:
            with self.subTest(title=title, cron=schedule or "workflow_dispatch"):
                moment = datetime.fromisoformat(instant)
                self.assertEqual(gate_verdict(moment, schedule), expected)

    def test_declared_crons_match_the_gate(self):
        """Un cron déclaré que le verdict ne connaît pas tournerait deux fois."""
        declared = {
            line.split("cron:", 1)[1].strip().strip('"')
            for line in WORKFLOW.read_text(encoding="utf-8").splitlines()
            if line.strip().startswith("- cron:")
        }
        self.assertEqual(declared, {SUMMER_CRON, WINTER_CRON, CATCH_UP_CRON})

    def test_paris_offsets_are_what_the_table_assumes(self):
        paris = ZoneInfo("Europe/Paris")
        for instant, hours in (
            ("2027-01-15T01:00:00+00:00", 1),
            ("2027-07-15T01:00:00+00:00", 2),
            ("2027-03-28T00:00:00+00:00", 1),
            ("2027-03-28T01:00:00+00:00", 2),
            ("2027-10-31T00:00:00+00:00", 2),
            ("2027-10-31T01:00:00+00:00", 1),
        ):
            with self.subTest(instant=instant):
                moment = datetime.fromisoformat(instant).astimezone(paris)
                self.assertEqual(moment.utcoffset(), timedelta(hours=hours))


class StaleThresholdTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.data_dir = Path(self.directory.name)
        original = update_osm_geojson.DATA_DIR
        update_osm_geojson.DATA_DIR = self.data_dir
        self.addCleanup(setattr, update_osm_geojson, "DATA_DIR", original)
        self.now = datetime(2027, 1, 15, 12, 0, tzinfo=timezone.utc)

    def write(self, name: str, age: timedelta):
        payload = {
            "type": "FeatureCollection",
            "features": [],
            "_cache": {"source_timestamp": (self.now - age).isoformat()},
        }
        (self.data_dir / f"{name}.geojson").write_text(json.dumps(payload), encoding="utf-8")

    def test_threshold_is_the_nightly_cadence_plus_its_grace(self):
        self.assertEqual(update_osm_geojson.STALE_AFTER, timedelta(hours=30))

    def test_just_under_the_threshold_is_fresh(self):
        self.write("bridges", update_osm_geojson.STALE_AFTER - timedelta(minutes=1))
        self.assertEqual(update_osm_geojson.stale_datasets(["bridges"], self.now), [])

    def test_just_over_the_threshold_is_overdue(self):
        self.write("bridges", update_osm_geojson.STALE_AFTER + timedelta(minutes=1))
        self.assertEqual(update_osm_geojson.stale_datasets(["bridges"], self.now), ["bridges"])

    def test_a_night_merely_delayed_is_not_overdue(self):
        """Extraction de la veille partie avec cinq heures de retard : 29 h d'âge."""
        self.write("bridges", timedelta(hours=29))
        self.assertEqual(update_osm_geojson.stale_datasets(["bridges"], self.now), [])

    def test_a_missed_night_is_overdue_by_midday(self):
        """Nuit sautée : à 12:47 UTC le jeu a 35 h, le rattrapage le reprend."""
        self.write("bridges", timedelta(hours=35))
        self.assertEqual(update_osm_geojson.stale_datasets(["bridges"], self.now), ["bridges"])

    def test_an_unreadable_file_is_overdue(self):
        (self.data_dir / "bridges.geojson").write_text("{", encoding="utf-8")
        self.assertEqual(update_osm_geojson.stale_datasets(["bridges"], self.now), ["bridges"])


if __name__ == "__main__":
    width = max(len(title) for title, *_ in TRUTH_TABLE)
    for title, instant, schedule, expected in TRUTH_TABLE:
        verdict = gate_verdict(datetime.fromisoformat(instant), schedule)
        print(
            f"{title:<{width}}  cron {schedule or 'workflow_dispatch':<16}"
            f"  {instant}  ->  {'POURSUIT' if verdict else 'sort':<9}"
            f"  {'ok' if verdict == expected else 'ATTENDU ' + str(expected)}"
        )
