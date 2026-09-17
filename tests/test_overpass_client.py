import io
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import overpass_client as client
import update_osm_geojson as geo
import update_osm_latest_changes as latest


class OverpassTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict('os.environ', {'OVERPASS_FALLBACK_ENDPOINTS': client.FALLBACK})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.sleep = patch.object(client.time, 'sleep').start()
        self.addCleanup(patch.stopall)

    def fetch(self, **kwargs):
        return client.fetch('query', endpoint='https://primary.test/api', user_agent='test', **kwargs)

    def test_429_fails_over_and_respects_retry_after(self):
        error = urllib.error.HTTPError('url', 429, 'busy', {'Retry-After': '90'}, None)
        with patch.object(client.urllib.request, 'urlopen', side_effect=[error, io.BytesIO(b'{"elements": []}')]) as request:
            self.assertEqual(self.fetch(), {'elements': []})
            self.assertEqual(request.call_args_list[1].args[0].full_url, client.FALLBACK)
            self.sleep.assert_called_once_with(90)

    def test_incomplete_json_is_retried(self):
        bad = b'{"elements": [], "remark": "runtime error: timeout"}'
        good = b'{"elements": [{"id": 1}]}'
        with patch.object(client.urllib.request, 'urlopen', side_effect=[io.BytesIO(bad), io.BytesIO(good)]):
            self.assertEqual(self.fetch()['elements'], [{'id': 1}])

    def test_malformed_json_and_504_recover(self):
        error = urllib.error.HTTPError('url', 504, 'timeout', {}, None)
        with patch.object(client.urllib.request, 'urlopen', side_effect=[error, io.BytesIO(b'<html/>'), io.BytesIO(b'{"elements": []}')]):
            self.assertEqual(self.fetch(), {'elements': []})

    def test_xml_remark_is_retried(self):
        with patch.object(client.urllib.request, 'urlopen', side_effect=[io.BytesIO(b'<osm><remark>timeout</remark></osm>'), io.BytesIO(b'<osmAugmentedDiff/>')]):
            self.assertEqual(self.fetch(output='xml'), '<osmAugmentedDiff/>')

    def test_permanent_error_is_not_retried(self):
        error = urllib.error.HTTPError('url', 400, 'bad query', {}, None)
        with patch.object(client.urllib.request, 'urlopen', side_effect=error) as request:
            with self.assertRaises(RuntimeError):
                self.fetch()
            self.assertEqual(request.call_count, 1)
            self.sleep.assert_not_called()

    def test_exhaustion_preserves_cache_and_main_reports_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'road-signs.geojson'
            path.write_text('{"previous": true}')
            with patch.object(geo, 'DATA_DIR', Path(tmp)), patch.object(sys, 'argv', ['update', 'road-signs']), patch.object(client.urllib.request, 'urlopen', side_effect=TimeoutError('timeout')) as request:
                self.assertEqual(geo.main(), 1)
                self.assertEqual(path.read_text(), '{"previous": true}')
                self.assertEqual(request.call_count, 4)

    def test_latest_changes_exhaustion_reports_failure_without_writing(self):
        with patch.object(client.urllib.request, 'urlopen', side_effect=TimeoutError('timeout')), patch.object(latest, 'write_json_if_changed') as write:
            self.assertEqual(latest.main(), 1)
            write.assert_not_called()


if __name__ == '__main__':
    unittest.main()
