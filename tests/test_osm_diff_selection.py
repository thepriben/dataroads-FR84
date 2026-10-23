"""Le rapprochement « diff OSM → jeux à réextraire », éprouvé sur les cas qui piègent.

Un diff ne dit pas tout, et chacune de ses zones d'ombre a son cas ici : une
suppression n'a plus de tags à reconnaître, un objet peut entrer ou sortir du
périmètre d'un jeu par ses seuls tags, une relation bouge sans ses membres et un
membre bouge sans sa relation, un tracé se déplace sans qu'aucun tag ne change.
Chacun de ces cas, mal traité, afficherait des données fausses sans que rien ne
le signale — c'est précisément ce que la cadence quotidienne garantissait à
coups de onze extractions par nuit.
"""

from __future__ import annotations

import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import osm_diff_selection as selection
from update_osm_geojson import QUERIES

BY_DATASET = selection.dataset_selectors(QUERIES)


def change(osm_type: str, osm_id: str, old: dict, new: dict, action: str = "modify"):
    return selection.Change(osm_type, osm_id, old, new, action)


def affected(*changes, references=None):
    return set(selection.affected_datasets(changes, BY_DATASET, references or {}))


class SelectorParsingTests(unittest.TestCase):
    def test_every_dataset_yields_at_least_one_selector(self):
        """Un jeu sans motif serait réputé jamais affecté, donc jamais relu."""
        for name, selectors in BY_DATASET.items():
            with self.subTest(dataset=name):
                self.assertTrue(selectors, f"{name} n'a produit aucun motif")

    def test_a_semicolon_inside_a_filter_does_not_truncate_it(self):
        """Les routes déclassées se reconnaissent sur ``(^|;) *[Dd]``."""
        keys = {
            key
            for selector in BY_DATASET["declassified-roads"]
            for key, _operator, _value in selector.filters
        }
        self.assertEqual(keys, {"highway", "was:ref", "old_ref"})

    def test_the_merged_query_keeps_every_type_of_a_shared_filter(self):
        """``man_made=bridge`` vaut pour un chemin comme pour une relation."""
        merged = selection.merge_selectors(BY_DATASET)
        bridges = next(
            selector for selector in merged
            if selector.filters == (("man_made", "=", "bridge"),)
        )
        self.assertEqual(bridges.types, ("way", "relation"))
        self.assertTrue(bridges.overpass().startswith("nwr["))


class MatchingTests(unittest.TestCase):
    def test_nominal_night_only_the_road_network_moved(self):
        """Une nuit ordinaire ne doit rapatrier que les jeux concernés."""
        self.assertEqual(
            affected(change("way", "1", {"highway": "secondary", "ref": "D 900"},
                            {"highway": "secondary", "ref": "D 900", "maxspeed": "80"})),
            {"departmental-roads"},
        )

    def test_a_quiet_night_retains_nothing(self):
        """Un commerce retouché ne regarde aucun des jeux publiés."""
        self.assertEqual(
            affected(change("node", "1", {"shop": "bakery"}, {"shop": "bakery", "name": "Chez Paul"})),
            set(),
        )

    def test_a_deletion_is_recognised_on_its_last_known_state(self):
        """L'objet supprimé n'est plus là pour être reconnu : restent ses tags d'avant."""
        self.assertEqual(
            affected(change("node", "42", {"highway": "stop"}, {}, action="delete")),
            {"road-signs"},
        )

    def test_an_object_entering_a_perimeter_is_recognised(self):
        self.assertEqual(
            affected(change("node", "7", {"tourism": "information"},
                            {"tourism": "information", "information": "guidepost"})),
            {"guideposts"},
        )

    def test_an_object_leaving_a_perimeter_is_recognised(self):
        """Sans relecture de l'état d'avant, le jeu continuerait de l'afficher."""
        self.assertEqual(
            affected(change("node", "7", {"tourism": "information", "information": "guidepost"},
                            {"tourism": "information"})),
            {"guideposts"},
        )

    def test_a_relation_moving_without_its_members(self):
        """Les véloroutes sont bâties sur des relations, que le diff voit seules."""
        self.assertEqual(
            affected(change("relation", "11", {"type": "route", "route": "bicycle", "ref": "EV8"},
                            {"type": "route", "route": "bicycle", "ref": "EV 8"})),
            {"bicycle-routes"},
        )

    def test_a_member_moving_without_its_relation(self):
        """Le chemin n'a aucun tag qui trahisse l'itinéraire : c'est le jeu publié qui le sait."""
        member = change("way", "99", {"highway": "track"}, {"highway": "track"})
        self.assertEqual(affected(member), set())
        self.assertEqual(
            affected(member, references={"bicycle-routes": {"way/99"}}),
            {"bicycle-routes"},
        )

    def test_a_geometry_only_change_is_recognised(self):
        """Un sommet déplacé ne change aucun tag : les deux états sont identiques."""
        moved = change("way", "5", {"highway": "secondary", "ref": "D 900"},
                       {"highway": "secondary", "ref": "D 900"})
        self.assertEqual(affected(moved), {"departmental-roads"})

    def test_a_commune_boundary_redraws_the_territorial_sets(self):
        self.assertEqual(
            affected(change("relation", "73928",
                            {"type": "boundary", "boundary": "administrative", "admin_level": "8"},
                            {"type": "boundary", "boundary": "administrative", "admin_level": "8"})),
            {"communes-vaucluse", "cantons-vaucluse"},
        )

    def test_a_boundary_way_without_its_relation_still_counts(self):
        """Le tracé d'une limite est un chemin, qui ne ressemble à aucun jeu."""
        self.assertEqual(
            affected(change("way", "500", {"boundary": "administrative"},
                            {"boundary": "administrative"})),
            {"communes-vaucluse", "cantons-vaucluse"},
        )

    def test_the_department_boundary_puts_every_dataset_in_doubt(self):
        """Dix requêtes sur onze s'ancrent sur cette aire : redéfinie, rien n'est sûr."""
        self.assertEqual(
            affected(change("relation", "7437", {"ISO3166-2": "FR-84", "boundary": "administrative"},
                            {"ISO3166-2": "FR-84", "boundary": "administrative"})),
            set(QUERIES),
        )

    def test_a_roadside_area_mapped_as_a_relation(self):
        """Les aires d'arrêt se cartographient en nœud, en chemin ou en relation."""
        for osm_type in ("node", "way", "relation"):
            with self.subTest(osm_type=osm_type):
                self.assertEqual(
                    affected(change(osm_type, "3", {}, {"amenity": "car_pooling"}, action="create")),
                    {"roadside-areas"},
                )


class ReferencesTests(unittest.TestCase):
    def test_relation_ids_of_a_published_dataset_are_collected(self):
        """Une véloroute retouchée doit être reconnue par son identifiant de relation."""
        with TemporaryDirectory() as directory:
            path = Path(directory) / "bicycle-routes.geojson"
            path.write_text(json.dumps({
                "features": [
                    {"properties": {"@id": "way/12", "relation_ids": [34, 56]}},
                    {"properties": {"@id": "way/13", "relation_id": 34}},
                ]
            }), encoding="utf-8")
            self.assertEqual(
                selection.dataset_references(path),
                {"way/12", "way/13", "relation/34", "relation/56"},
            )

    def test_an_unreadable_dataset_yields_no_reference(self):
        """L'absence de repères ne doit pas faire échouer le rapprochement."""
        with TemporaryDirectory() as directory:
            path = Path(directory) / "absent.geojson"
            self.assertEqual(selection.dataset_references(path), set())


class WindowTests(unittest.TestCase):
    now = datetime(2027, 1, 15, 2, 0, tzinfo=timezone.utc)

    def test_the_window_starts_before_the_oldest_verification(self):
        verified = {
            "a": self.now - timedelta(hours=24),
            "b": self.now - timedelta(hours=26),
        }
        self.assertEqual(
            selection.window_start(verified, self.now),
            self.now - timedelta(hours=26) - selection.DIFF_WINDOW_MARGIN,
        )

    def test_a_dataset_never_verified_hands_back_to_the_full_pass(self):
        """Aucun diff ne peut rien affirmer d'un jeu dont on ignore la date."""
        verified = {"a": self.now - timedelta(hours=24), "b": None}
        self.assertIsNone(selection.window_start(verified, self.now))

    def test_a_window_wider_than_the_ceiling_hands_back_to_the_full_pass(self):
        verified = {"a": self.now - selection.MAX_DIFF_WINDOW}
        self.assertIsNone(selection.window_start(verified, self.now))


class FallbackTests(unittest.TestCase):
    """Perdre la source du diff ne doit pas se traduire par une nuit blanche."""

    def setUp(self):
        import update_osm_geojson

        self.module = update_osm_geojson
        self.now = datetime(2027, 1, 15, 2, 0, tzinfo=timezone.utc)
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        data_dir = Path(self.directory.name)
        original = self.module.DATA_DIR
        self.module.DATA_DIR = data_dir
        self.addCleanup(setattr, self.module, "DATA_DIR", original)
        for name in QUERIES:
            (data_dir / f"{name}.geojson").write_text(json.dumps({
                "features": [],
                "_cache": {"verified_at": (self.now - timedelta(hours=24)).isoformat()},
            }), encoding="utf-8")

    def selection_with(self, answer):
        original = self.module.fetch
        self.module.fetch = answer
        self.addCleanup(setattr, self.module, "fetch", original)
        return self.module.diff_selection(dict(QUERIES), self.now)

    def test_an_unavailable_diff_retains_every_dataset(self):
        def refused(_query, **_kwargs):
            raise RuntimeError("Overpass 504")

        verdict, verified_at = self.selection_with(refused)
        self.assertEqual(set(verdict), set(QUERIES))
        # Aucune vérification ne doit être horodatée sur la foi d'un diff perdu.
        self.assertIsNone(verified_at)

    def test_a_diff_without_an_announced_cut_off_retains_every_dataset(self):
        """Sans coupure, rien ne dit jusqu'à quand un jeu épargné serait exact."""
        verdict, verified_at = self.selection_with(lambda _query, **_kwargs: "<osm></osm>")
        self.assertEqual(set(verdict), set(QUERIES))
        self.assertIsNone(verified_at)

    def test_a_quiet_night_spares_every_dataset_and_dates_the_check(self):
        answer = '<osm><meta osm_base="2027-01-15T01:30:00Z"/></osm>'
        verdict, verified_at = self.selection_with(lambda _query, **_kwargs: answer)
        self.assertEqual(verdict, {})
        self.assertEqual(verified_at, "2027-01-15T01:30:00Z")


if __name__ == "__main__":
    unittest.main()
