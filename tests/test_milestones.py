"""Les points de repère (PR) : rattachés à leur route, repris par le diff nocturne."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import osm_diff_selection as selection
from update_osm_geojson import QUERIES, milestones_to_geojson

BY_DATASET = selection.dataset_selectors(QUERIES)


def node(osm_id: int, tags: dict) -> dict:
    return {"type": "node", "id": osm_id, "lat": 44.0, "lon": 5.0, "tags": tags}


class MilestoneConversionTests(unittest.TestCase):
    def test_road_is_joined_in_the_form_the_network_displays(self):
        data = {"elements": [
            node(1, {"highway": "milestone", "distance": "7", "ref:highway": "D 942", "note": "Please do not move."}),
            node(2, {"highway": "milestone", "distance": "8", "ref": "D 26"}),
            node(3, {"highway": "milestone", "distance": "160"}),
        ]}
        features = {f["properties"]["osm_id"]: f["properties"] for f in milestones_to_geojson(data)["features"]}

        self.assertEqual(features[1]["road"], "D942")
        self.assertEqual(features[1]["distance"], "7")
        self.assertNotIn("note", features[1])
        self.assertEqual(features[2]["road"], "D26")
        self.assertNotIn("road", features[3])


class MilestoneDiffSelectionTests(unittest.TestCase):
    def test_moving_a_milestone_reextracts_the_layer(self):
        tags = {"highway": "milestone", "distance": "7"}
        changes = [selection.Change("node", "1", tags, dict(tags, check_date="2026-11-16"), "modify")]
        self.assertIn("milestones", selection.affected_datasets(changes, BY_DATASET, {}))


if __name__ == "__main__":
    unittest.main()
