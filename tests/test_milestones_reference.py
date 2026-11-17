import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import update_milestones_reference as ref  # noqa: E402


def plo(road, pr, lon, lat):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {ref.FIELD_ROAD: road, ref.FIELD_PR: pr}}


def osm(osm_id, road, pr, lon, lat):
    return {"type": "Feature", "id": f"node/{osm_id}",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {"osm_id": osm_id, "road": road, "distance": pr}}


def status(features):
    return {(f["properties"]["road"], f["properties"]["pr"]): f["properties"] for f in features}


class MilestonesReferenceTest(unittest.TestCase):
    def test_same_road_and_number_close_by_is_ok(self):
        out = status(ref.compare([plo("D942", "7", 5.0, 44.0)], [osm(1, "D942", "7", 5.0001, 44.0)]))
        self.assertEqual(out[("D942", "7")]["status"], "ok")
        self.assertEqual(out[("D942", "7")]["osm_id"], "1")

    def test_same_road_and_number_far_away_is_a_gap(self):
        out = status(ref.compare([plo("D942", "7", 5.0, 44.0)], [osm(1, "D942", "7", 5.001, 44.0)]))
        self.assertEqual(out[("D942", "7")]["status"], "ecart")
        self.assertGreater(out[("D942", "7")]["distance"], 25)

    def test_old_road_number_in_osm_is_reported(self):
        out = status(ref.compare([plo("D907", "5", 5.0, 44.0)], [osm(1, "N7", "5", 5.0, 44.00001)]))
        self.assertEqual(out[("D907", "5")]["status"], "route")
        self.assertEqual(out[("D907", "5")]["osm_road"], "N7")

    def test_missing_from_osm(self):
        out = status(ref.compare([plo("EV17", "53", 4.8, 44.0)], [osm(1, "D907", "53", 4.9, 44.0)]))
        self.assertEqual(out[("EV17", "53")]["status"], "absent")

    def test_road_spellings_are_reconciled(self):
        self.assertEqual(ref.normalize_road("D 907g"), "D907G")
        self.assertEqual(ref.normalize_road("D162bis"), "D162B")
        self.assertEqual(ref.road_aliases("D63 - D63a"), ["D63", "D63A"])
        out = status(ref.compare([plo("D63 - D63a", "2", 5.0, 44.0)], [osm(1, "D63A", "2", 5.0, 44.0)]))
        self.assertEqual(out[("D63 - D63a", "2")]["status"], "ok")

    def test_pr_numbers_ignore_leading_zeros(self):
        self.assertEqual(ref.normalize_pr("07"), "7")
        self.assertEqual(ref.normalize_pr("0"), "0")

    def test_summary_counts_every_status(self):
        features = ref.compare(
            [plo("D1", "1", 5.0, 44.0), plo("D1", "2", 5.1, 44.0)],
            [osm(1, "D1", "1", 5.0, 44.0)])
        self.assertEqual(ref.summarize(features), {"ok": 1, "ecart": 0, "route": 0, "absent": 1})


if __name__ == "__main__":
    unittest.main()
