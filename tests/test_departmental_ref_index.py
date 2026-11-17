"""Les tronçons indicés (« D 975 A ») rattachés à leur voie.

Une voie garde un seul numéro et de multiples rattachements avec indices : un
tronçon « D 975 A » doit s'afficher avec la D 975 et sa relation, l'indice porté
à part. Le filtre d'extraction les écartait tous, faute d'admettre la lettre.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import osm_diff_selection as selection
from update_osm_geojson import QUERIES, departmental_roads_to_geojson, split_ref_index

BY_DATASET = selection.dataset_selectors(QUERIES)


def way(osm_id: int, ref: str) -> dict:
    return {
        "type": "way",
        "id": osm_id,
        "tags": {"highway": "tertiary", "ref": ref},
        "geometry": [{"lat": 44.0, "lon": 5.0}, {"lat": 44.001, "lon": 5.001}],
    }


class SplitRefIndexTests(unittest.TestCase):
    def test_every_spelling_found_in_vaucluse(self):
        for value in ("D 975 A", "D 975A", "D975A", "D 975a", "d 975 a"):
            with self.subTest(value=value):
                self.assertEqual(split_ref_index(value), ("D 975", "A"))

    def test_plain_ref_has_no_index(self):
        self.assertEqual(split_ref_index("D 975"), ("D 975", None))

    def test_two_letters_are_not_an_index(self):
        self.assertEqual(split_ref_index("D 975 AB"), ("D 975 AB", None))


class DepartmentalConversionTests(unittest.TestCase):
    def test_indexed_way_joins_its_route_and_relation(self):
        relation = {"type": "relation", "id": 1, "tags": {"ref": "D 975", "wikidata": "Q1"}}
        data = {"elements": [way(10, "D 975"), way(11, "D 975 A"), relation]}
        features = {f["properties"]["osm_id"]: f["properties"] for f in departmental_roads_to_geojson(data)["features"]}

        indexed = features[11]
        self.assertEqual(indexed["ref"], "D 975")
        self.assertEqual(indexed["ref_index"], "A")
        self.assertEqual(indexed["osm_ref"], "D 975 A")
        self.assertTrue(indexed["has_relation"])
        self.assertEqual(indexed["relation_id"], 1)
        self.assertNotIn("ref_index", features[10])


class DiffSelectionTests(unittest.TestCase):
    def test_editing_an_indexed_way_reextracts_the_network(self):
        tags = {"highway": "tertiary", "ref": "D 975 A"}
        changes = [selection.Change("way", "11", tags, dict(tags, surface="asphalt"), "modify")]
        self.assertIn("departmental-roads", selection.affected_datasets(changes, BY_DATASET, {}))


if __name__ == "__main__":
    unittest.main()
