"""Regression tests for Telegram recency and highlight selection."""
from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "briefing"))
sys.path.insert(0, str(ROOT / "dashboard"))

import collect_telegram  # noqa: E402
import build  # noqa: E402
import server  # noqa: E402


def message(message_id: int, timestamp: datetime, text: str = "recent post") -> dict:
    return {"id": message_id, "text": text, "ts": timestamp.isoformat(),
            "link": f"https://t.me/example/{message_id}"}


class TelegramBriefingTests(unittest.TestCase):
    def test_collector_filters_the_page_that_crosses_the_lookback_cutoff(self):
        now = datetime.now(timezone.utc)
        page = [
            message(2, now - timedelta(hours=1)),
            message(1, now - timedelta(hours=27)),
        ]
        with patch.object(collect_telegram, "fetch_channel_html", return_value="<html>"), \
             patch.object(collect_telegram, "parse_messages", return_value=page):
            result = collect_telegram.fetch_recent_messages("example", max_pages=1)

        self.assertEqual([item["id"] for item in result], [2])

    def test_latest_feed_uses_all_messages_not_cluster_representatives(self):
        old = {**message(1, datetime(2026, 7, 17, tzinfo=timezone.utc), "old $BTC post"), "channel": "A"}
        new = {**message(2, datetime(2026, 7, 18, tzinfo=timezone.utc), "new $BTC post"), "channel": "B"}

        latest = server._latest_briefing_messages([old, new])

        self.assertEqual([item["link"] for item in latest], [new["link"], old["link"]])

    def test_highlight_representative_is_the_newest_post_in_its_cluster(self):
        old = {**message(1, datetime(2026, 7, 17, tzinfo=timezone.utc), "$BTC outlook"), "channel": "A"}
        new = {**message(2, datetime(2026, 7, 18, tzinfo=timezone.utc), "$BTC update"), "channel": "B"}

        highlights = server._cluster_highlights([old, new])

        self.assertEqual(highlights[0]["link"], new["link"])
        self.assertEqual(highlights[0]["cluster_size"], 2)

    def test_scheduled_snapshot_exposes_a_separate_latest_feed(self):
        old = message(1, datetime(2026, 7, 17, tzinfo=timezone.utc), "BTC outlook")
        new = message(2, datetime(2026, 7, 18, tzinfo=timezone.utc), "BTC update")

        result = build.cluster_highlights({"A": [old], "B": [new]}, set())

        self.assertEqual(result["latest"][0]["link"], new["link"])
        self.assertEqual(result["highlights"][0]["link"], new["link"])


if __name__ == "__main__":
    unittest.main()
