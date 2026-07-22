"""Regression tests for news ranking metadata and intraday chart intervals."""
from __future__ import annotations

import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard"))

import server  # noqa: E402


class DashboardFeatureTests(unittest.TestCase):
    def test_news_preserves_google_rank_for_popular_sort(self):
        feed = ET.fromstring("""
            <rss><channel>
              <item><title>첫 기사 - 매체A</title><link>https://example.com/1</link><source>매체A</source><pubDate>Mon, 20 Jul 2026 01:00:00 GMT</pubDate></item>
              <item><title>둘째 기사 - 매체B</title><link>https://example.com/2</link><source>매체B</source><pubDate>Mon, 20 Jul 2026 03:00:00 GMT</pubDate></item>
            </channel></rss>
        """)
        with patch.object(server, "fetch_xml", return_value=feed):
            result = server.news("테스트")

        self.assertEqual([item["popularRank"] for item in result["items"]], [1, 2])
        self.assertEqual(result["items"][0]["title"], "첫 기사")

    def test_yahoo_short_history_uses_supported_ranges(self):
        payload = {"chart": {"result": [{
            "timestamp": [1784512800],
            "indicators": {"quote": [{"open": [10], "high": [12], "low": [9],
                                        "close": [11], "volume": [100]}]}
        }]}}
        for interval, query in (("1m", "range=5d&interval=1m"),
                                ("15m", "range=1mo&interval=15m")):
            with self.subTest(interval=interval), \
                 patch.object(server, "fetch_json", return_value=payload) as fetch:
                history = server.yahoo_history("AAPL", interval)

            self.assertIn(query, fetch.call_args.args[0])
            self.assertIn(" ", history["dates"][0])
            self.assertEqual(history["close"], [11])

    def test_short_intervals_are_available_for_crypto_sources(self):
        self.assertEqual(server.BINANCE_INTERVAL["1m"], "1m")
        self.assertEqual(server.BINANCE_INTERVAL["15m"], "15m")


if __name__ == "__main__":
    unittest.main()
