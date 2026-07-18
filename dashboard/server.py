"""Interest Hub Economy Edition - dependency-free local dashboard server."""
from __future__ import annotations

import json
import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).parent
PROJECT_ROOT = ROOT.parent
CACHE: dict[str, tuple[float, object]] = {}
UA = "InterestHubEconomy/1.0 (+local dashboard)"
NAVER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
GMGN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def cached(key: str, ttl: int, loader):
    item = CACHE.get(key)
    if item and time.time() - item[0] < ttl:
        return item[1]
    try:
        value = loader()
    except Exception:
        if item:
            return item[1]
        raise
    CACHE[key] = (time.time(), value)
    return value


def fetch_json(url: str, ua: str = UA):
    request = Request(url, headers={"User-Agent": ua, "Accept": "application/json"})
    try:
        with urlopen(request, timeout=8) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception:
        time.sleep(0.5)
        with urlopen(request, timeout=8) as response:
            return json.loads(response.read().decode("utf-8"))


def fetch_json_post(url: str, payload: dict, ua: str = UA):
    body = json.dumps(payload).encode("utf-8")
    request = Request(url, data=body, headers={"User-Agent": ua, "Content-Type": "application/json",
                                                "Accept": "application/json"})
    with urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


LAST_GOOD: dict[str, dict] = {}


def _parse_yahoo_history(result: dict):
    """Turns a Yahoo chart response into null-free, index-aligned OHLCV series
    for the candlestick chart (dates use the exchange's local calendar day)."""
    timestamps = result.get("timestamp") or []
    quote_data = (result.get("indicators", {}).get("quote") or [{}])[0]
    closes_raw = quote_data.get("close", [])
    opens_raw = quote_data.get("open", [])
    highs_raw = quote_data.get("high", [])
    lows_raw = quote_data.get("low", [])
    volumes_raw = quote_data.get("volume", [])
    dates, opens, highs, lows, closes, volumes = [], [], [], [], [], []
    for i, ts in enumerate(timestamps):
        close = closes_raw[i] if i < len(closes_raw) else None
        if close is None:
            continue
        dates.append(datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d"))
        opens.append(opens_raw[i] if i < len(opens_raw) else None)
        highs.append(highs_raw[i] if i < len(highs_raw) else None)
        lows.append(lows_raw[i] if i < len(lows_raw) else None)
        closes.append(close)
        volumes.append(volumes_raw[i] if i < len(volumes_raw) else None)
    return {"dates": dates, "open": opens, "high": highs, "low": lows, "close": closes, "volume": volumes}


def yahoo_history_full(symbol: str, range_: str = "1y"):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + quote(symbol) + f"?range={range_}&interval=1d"
    result = fetch_json(url)["chart"]["result"][0]
    return _parse_yahoo_history(result)


def yahoo(symbol: str):
    # One year supplies the 1/3/6 month and full-period chart controls without
    # a second network request every time a visitor changes the period.
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + quote(symbol) + "?range=1y&interval=1d"
    result = fetch_json(url)["chart"]["result"][0]
    meta = result["meta"]
    history = _parse_yahoo_history(result)
    closes = history["close"]
    price = meta.get("regularMarketPrice") or (closes[-1] if closes else 0)
    previous = (meta.get("regularMarketPreviousClose") or meta.get("previousClose")
                or (closes[-2] if len(closes) > 1 else None) or price)
    change = price - previous
    item = {"symbol": symbol, "name": meta.get("shortName") or symbol, "price": price,
            "change": change, "changePct": (change / previous * 100) if previous else 0,
            "currency": meta.get("currency", "USD"), "spark": closes[-7:], "history": history,
            "marketState": meta.get("marketState", ""), "marketCap": market_cap(symbol)}
    LAST_GOOD[symbol] = item
    return item


KR_STOCK_RE = re.compile(r"^(\d{6})\.(KS|KQ)$")
NAVER_INDEX_NAME = {"^KS11": "KOSPI", "^KQ11": "KOSDAQ"}


def naver_num(value):
    if value is None or value == "" or value == "N/A":
        return None
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return None


def naver_quote_from_payload(payload: dict, symbol: str):
    """Yahoo's KR previous-close metadata is wrong (see market_data/1-A finding),
    so KR price/change/market-cap comes from Naver; only the close-price history
    (for sparklines/charts) still comes from Yahoo, which is accurate."""
    sign = {"RISING": 1, "FALLING": -1}.get((payload.get("compareToPreviousPrice") or {}).get("name"), 0)
    change_abs = naver_num(payload.get("compareToPreviousClosePrice")) or 0
    pct_abs = naver_num(payload.get("fluctuationsRatio")) or 0
    market_value = naver_num(payload.get("marketValue"))
    try:
        history = yahoo_history_full(symbol)
    except Exception:
        history = {"dates": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
    item = {"symbol": symbol, "name": payload.get("stockName") or symbol,
            "price": naver_num(payload.get("closePrice")),
            "change": change_abs * sign, "changePct": pct_abs * sign, "currency": "KRW",
            "spark": history["close"][-7:], "history": history, "marketState": payload.get("marketStatus", ""),
            "marketCap": market_value * 1e8 if market_value is not None else None,
            "marketCapText": payload.get("marketValueHangeul")}
    LAST_GOOD[symbol] = item
    return item


KR_WON_UNIT = {"조": 1e12, "억": 1e8, "만": 1e4}


def parse_kr_won(text: str | None):
    if not text:
        return None
    parts = re.findall(r"([\d,.]+)\s*(조|억|만)", text)
    if not parts:
        return naver_num(text.replace("원", ""))
    return sum(float(num.replace(",", "")) * KR_WON_UNIT[unit] for num, unit in parts)


def naver_stock(symbol: str):
    """The /basic endpoint has no market-cap field (only Naver's marketValue *list*
    endpoint does, used by kr_top10); individual lookups need /integration instead."""
    code = KR_STOCK_RE.match(symbol).group(1)
    payload = fetch_json(f"https://m.stock.naver.com/api/stock/{code}/basic", NAVER_UA)
    item = naver_quote_from_payload(payload, symbol)
    if item.get("marketCap") is None:
        try:
            info = fetch_json(f"https://m.stock.naver.com/api/stock/{code}/integration", NAVER_UA)
            market_text = next((t["value"] for t in info.get("totalInfos", []) if t.get("code") == "marketValue"), None)
            item["marketCap"] = parse_kr_won(market_text)
            item["marketCapText"] = market_text + "원" if market_text and not market_text.endswith("원") else market_text
            LAST_GOOD[symbol] = item
        except Exception:
            pass
    return item


def naver_index(symbol: str):
    payload = fetch_json(f"https://m.stock.naver.com/api/index/{NAVER_INDEX_NAME[symbol]}/basic", NAVER_UA)
    return naver_quote_from_payload(payload, symbol)


def kr_top10():
    kospi = fetch_json("https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=1&pageSize=10", NAVER_UA)["stocks"]
    kosdaq = fetch_json("https://m.stock.naver.com/api/stocks/marketValue/KOSDAQ?page=1&pageSize=10", NAVER_UA)["stocks"]
    pool = [(s, ".KS") for s in kospi] + [(s, ".KQ") for s in kosdaq]
    pool.sort(key=lambda pair: naver_num(pair[0].get("marketValue")) or 0, reverse=True)
    items = [naver_quote_from_payload(stock, stock["itemCode"] + suffix) for stock, suffix in pool[:10]]
    return {"items": items, "updatedAt": int(time.time())}


def safe_quote(symbol: str, label: str | None = None):
    try:
        if symbol in NAVER_INDEX_NAME:
            item = naver_index(symbol)
        elif KR_STOCK_RE.match(symbol):
            item = naver_stock(symbol)
        else:
            item = yahoo(symbol)
    except Exception as error:
        stale = LAST_GOOD.get(symbol)
        item = {**stale, "stale": True} if stale else {"symbol": symbol, "name": label or symbol, "error": str(error)}
    if label:
        item["name"] = label
    return item


def market_cap(symbol: str):
    """Yahoo's chart response omits market cap; fundamentals is public and more stable."""
    if symbol.startswith("^") or symbol.endswith("=X") or symbol.endswith("=F"):
        return None
    key = "market-cap:" + symbol
    cached_item = CACHE.get(key)
    if cached_item and time.time() - cached_item[0] < 21600:
        return cached_item[1]
    try:
        url = ("https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/"
               + quote(symbol) + "?symbol=" + quote(symbol)
               + "&type=trailingMarketCap&period1=1700000000&period2=" + str(int(time.time()) + 86400))
        series = fetch_json(url)["timeseries"]["result"][0].get("trailingMarketCap", [])
        value = series[-1]["reportedValue"]["raw"] if series else None
    except Exception:
        value = None
    CACHE[key] = (time.time(), value)
    return value


# HIP-3 builder-deployed perps live on separate "dex" instances; confirmed by
# querying /info directly (see plan doc) rather than guessing symbol names.
HYPERLIQUID_ASSETS = {
    "HYPE": {"coin": "HYPE", "dex": "", "name": "HYPE"},
    "SAMSUNG": {"coin": "xyz:SMSN", "dex": "xyz", "name": "Samsung (SMSN)"},
    "SKHYNIX": {"coin": "xyz:SKHX", "dex": "xyz", "name": "SK Hynix (SKHX)"},
    # Lighter (the perp-dex token), listed on Hyperliquid's MAIN dex as "LIT"
    # (verified against CoinGecko id "lighter": main-dex mid 2.365 vs CG 2.37,
    # while the hyna:LIT HIP-3 market was off by ~40%).
    "LIT": {"coin": "LIT", "dex": "", "name": "Lighter (LIT)"},
}
HYPERLIQUID_COINGECKO_FALLBACK = {"HYPE": "hyperliquid", "LIT": "lighter"}


def hyperliquid_candles(coin: str, days: int = 365):
    end = int(time.time() * 1000)
    start = end - days * 86400000
    rows = fetch_json_post("https://api.hyperliquid.xyz/info",
                            {"type": "candleSnapshot", "req": {"coin": coin, "interval": "1d",
                                                                "startTime": start, "endTime": end}})
    dates, opens, highs, lows, closes, volumes = [], [], [], [], [], []
    for row in rows or []:
        dates.append(datetime.fromtimestamp(row["t"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d"))
        opens.append(float(row["o"])); highs.append(float(row["h"]))
        lows.append(float(row["l"])); closes.append(float(row["c"])); volumes.append(float(row["v"]))
    return {"dates": dates, "open": opens, "high": highs, "low": lows, "close": closes, "volume": volumes}


def hyperliquid_quote(label: str):
    asset = HYPERLIQUID_ASSETS[label]
    key = "hl:" + label
    try:
        mids = fetch_json_post("https://api.hyperliquid.xyz/info",
                                {"type": "allMids", **({"dex": asset["dex"]} if asset["dex"] else {})})
        price = float(mids[asset["coin"]])
        try:
            history = hyperliquid_candles(asset["coin"])
        except Exception:
            history = {"dates": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
        closes = history["close"]
        previous = closes[-2] if len(closes) > 1 else price
        change = price - previous
        item = {"symbol": label, "name": asset["name"], "price": price, "change": change,
                "changePct": (change / previous * 100) if previous else 0, "currency": "USD",
                "spark": closes[-7:], "history": history}
        LAST_GOOD[key] = item
        return item
    except Exception:
        gecko_id = HYPERLIQUID_COINGECKO_FALLBACK.get(label)
        if gecko_id:
            try:
                data = fetch_json("https://api.coingecko.com/api/v3/simple/price?ids=" + gecko_id
                                   + "&vs_currencies=usd&include_24hr_change=true")
                empty_history = {"dates": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
                item = {"symbol": label, "name": asset["name"], "price": data[gecko_id]["usd"], "change": 0,
                        "changePct": data[gecko_id].get("usd_24h_change", 0), "currency": "USD",
                        "spark": [], "history": empty_history}
                LAST_GOOD[key] = item
                return item
            except Exception:
                pass
        stale = LAST_GOOD.get(key)
        return {**stale, "stale": True} if stale else {"symbol": label, "name": asset["name"], "error": "no data"}


def market_data():
    definitions = [("KOSPI", "^KS11"), ("KOSDAQ", "^KQ11"), ("S&P 500", "^GSPC"),
                   ("NASDAQ", "^IXIC"), ("USD/KRW", "KRW=X"), ("Gold", "GC=F")]
    items = [safe_quote(symbol, label) for label, symbol in definitions]
    for label in HYPERLIQUID_ASSETS:
        items.append(hyperliquid_quote(label))
    try:
        coins = fetch_json("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,krw&include_24hr_change=true")
        for coin, label in (("bitcoin", "BTC"), ("ethereum", "ETH")):
            item = {"name": label, "symbol": coin, "price": coins[coin]["usd"], "currency": "USD",
                     "changePct": coins[coin].get("usd_24h_change", 0), "change": 0}
            LAST_GOOD["coin:" + coin] = item
            items.append(item)
    except Exception as error:
        for coin, label in (("bitcoin", "BTC"), ("ethereum", "ETH")):
            stale = LAST_GOOD.get("coin:" + coin)
            items.append({**stale, "stale": True} if stale else {"name": label, "error": str(error)})
    return {"items": items, "updatedAt": int(time.time())}


def _load_json_asset(name: str) -> dict:
    path = ROOT / name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


TWITTER_HANDLES = _load_json_asset("twitter_handles.json")


def coins_market(category: str | None = None, per_page: int = 30):