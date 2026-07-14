"""Builds dashboard/twitter_handles.json: {coin_id: twitter_screen_name}.

CoinGecko's list/markets endpoints don't include social links, and the free
tier rate-limits hard enough (a handful of requests per minute) that fetching
per-coin detail live from the dashboard is not viable. So this runs offline,
covers only the coins that actually appear in the "크립토 프로젝트 순위"
widget's tabs (전체/L1/L2/DeFi/Robinhood, top 20 each), and its output is
committed. Re-run occasionally (e.g. monthly) to pick up ranking changes.
"""
from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path

UA = "InterestHubEconomy/1.0 (+local dashboard)"
CATEGORIES = [None, "smart-contract-platform", "layer-2", "decentralized-finance-defi", "robinhood-ecosystem"]
OUTPUT = Path(__file__).resolve().parents[1] / "dashboard" / "twitter_handles.json"
IDS_CACHE = Path(__file__).resolve().parent / "_twitter_map_ids_cache.json"


def fetch(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_with_retry(url: str, attempts: int = 5, backoff: float = 25.0):
    for attempt in range(attempts):
        try:
            return fetch(url)
        except Exception as error:
            if "429" in str(error) and attempt < attempts - 1:
                time.sleep(backoff)
                continue
            raise


def collect_ids() -> list[str]:
    if IDS_CACHE.exists():
        return json.loads(IDS_CACHE.read_text(encoding="utf-8"))
    ids: set[str] = set()
    for category in CATEGORIES:
        url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1"
        if category:
            url += "&category=" + category
        for coin in fetch_with_retry(url):
            ids.add(coin["id"])
        time.sleep(7)
    result = sorted(ids)
    IDS_CACHE.write_text(json.dumps(result), encoding="utf-8")
    return result


def main():
    ids = collect_ids()
    print(f"collected {len(ids)} unique coin ids")
    handles: dict[str, str] = dict(json.loads(OUTPUT.read_text(encoding="utf-8"))) if OUTPUT.exists() else {}
    pending = [i for i in ids if i not in handles]
    print(f"{len(handles)} already cached, {len(pending)} left to fetch")
    for index, coin_id in enumerate(pending):
        try:
            detail = fetch_with_retry(
                f"https://api.coingecko.com/api/v3/coins/{coin_id}"
                "?localization=false&tickers=false&market_data=false"
                "&community_data=false&developer_data=false"
            )
            handle = (detail.get("links") or {}).get("twitter_screen_name")
            if handle:
                handles[coin_id] = handle
            print(f"[{index + 1}/{len(pending)}] {coin_id} -> {handle}")
        except Exception as error:
            print(f"[{index + 1}/{len(pending)}] {coin_id} -> skip ({error})")
        OUTPUT.write_text(json.dumps(handles, ensure_ascii=False, indent=1), encoding="utf-8")
        time.sleep(7)
    print(f"wrote {len(handles)} handles to {OUTPUT}")


if __name__ == "__main__":
    main()
