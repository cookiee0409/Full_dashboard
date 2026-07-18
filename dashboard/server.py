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
    url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=" + str(per_page) + "&page=1&sparkline=true&price_change_percentage=24h,7d"
    if category and category != "all":
        url += "&category=" + quote(category)
    data = fetch_json(url)
    return {"items": [{"id": c["id"], "rank": c.get("market_cap_rank"), "name": c["name"],
                        "symbol": c["symbol"].upper(), "image": c.get("image"), "price": c.get("current_price"),
                        "change24": c.get("price_change_percentage_24h_in_currency") or c.get("price_change_percentage_24h") or 0,
                        "change7": c.get("price_change_percentage_7d_in_currency") or 0,
                        "marketCap": c.get("market_cap"), "volume": c.get("total_volume"),
                        "twitter": TWITTER_HANDLES.get(c["id"]),
                        "spark": (c.get("sparkline_in_7d") or {}).get("price", [])}
                       for c in data], "updatedAt": int(time.time())}


GMGN_CHAIN_SLUG = {"solana": "sol", "ethereum": "eth", "binance-smart-chain": "bsc",
                   "base": "base", "robinhood": "robinhood"}
# GMGN's public trend board (gmgn.ai/trend?chain=...) exposes these chains
# directly — including Robinhood Chain (verified: rank/robinhood/... returns
# rows and gmgn.ai/robinhood/token/<address> resolves).
MEME_CHAIN_ORDER = [("solana", "Solana"), ("binance-smart-chain", "BSC"),
                    ("base", "Base"), ("ethereum", "Ethereum"), ("robinhood", "Robinhood")]
GMGN_RANK_CHAIN = {"solana": "sol", "binance-smart-chain": "bsc", "base": "base",
                   "ethereum": "eth", "robinhood": "robinhood"}

# GMGN's trend board occasionally carries broken oracle rows (e.g. a $59-
# liquidity token reporting a 2.3e18 market cap). No memecoin is worth $500B;
# treat anything above as garbage so it cannot occupy the top of the board.
MEME_MAX_SANE_MARKET_CAP = 5e11


def _sane_cap(value):
    return value if value is not None and 0 < value < MEME_MAX_SANE_MARKET_CAP else None


def gmgn_link(chain: str | None, address: str | None):
    slug = GMGN_CHAIN_SLUG.get(chain)
    return f"https://gmgn.ai/{slug}/token/{address}" if slug and address else None


def gmgn_rank(chain_id: str, gmgn_chain: str, limit: int = 100):
    """Return sane market-cap entries from GMGN's public trend board. The board
    mixes memecoins with regular trending tokens (LINK, UNI, ...), so callers
    filter the result against CoinGecko's meme-token category before display."""
    url = (f"https://gmgn.ai/defi/quotation/v1/rank/{gmgn_chain}/swaps/24h?"
           "orderby=marketcap&direction=desc&filters[]=not_honeypot&filters[]=verified")
    request = Request(url, headers={"User-Agent": GMGN_UA, "Accept": "application/json, text/plain, */*",
                                    "Accept-Language": "en-US,en;q=0.9", "Referer": "https://gmgn.ai/"})
    with urlopen(request, timeout=6) as response:
        payload = json.loads(response.read().decode("utf-8"))
    rows = [row for row in (payload.get("data") or {}).get("rank") or []
            if _sane_cap(row.get("market_cap"))]
    return [{"id": f"gmgn:{gmgn_chain}:{row.get('address', i)}", "rank": i + 1,
             "name": row.get("name") or row.get("symbol") or "Unknown",
             "symbol": (row.get("symbol") or "—").upper(), "image": row.get("logo") or "",
             "price": row.get("price"), "change24": row.get("price_change_percent") or 0,
             "marketCap": row.get("market_cap"), "volume": row.get("volume"), "spark": [],
             "chain": chain_id, "address": row.get("address"),
             "gmgn": gmgn_link(chain_id, row.get("address"))}
            for i, row in enumerate(rows[:limit])]


def meme_chains():
    """Build GMGN-style chain boards, with the first 20 tokens per chain."""
    key = "meme-chains"
    cached_item = CACHE.get(key)
    if cached_item and time.time() - cached_item[0] < 600:
        return cached_item[1]

    platform_list = cached("coin-platforms", 86400,
                           lambda: fetch_json("https://api.coingecko.com/api/v3/coins/list?include_platform=true"))
    platforms = {coin["id"]: coin.get("platforms") or {} for coin in platform_list}
    fallback_items = coins_market("meme-token", 250)["items"]

    def coingecko_fallback(chain_id: str):
        # Check every platform, instead of only CoinGecko's first platform, so
        # bridged tokens are visible in the chain where users trade them.
        chain_items = []
        for coin in fallback_items:
            address = platforms.get(coin["id"], {}).get(chain_id)
            if address:
                chain_items.append({**coin, "chain": chain_id, "gmgn": gmgn_link(chain_id, address)})
        return chain_items[:20]

    # CoinGecko's meme-token category is the memecoin whitelist: GMGN's trend
    # board also carries regular trending tokens (LINK, UNI, stables...), which
    # must not appear on a memecoin board. Matched by address first, symbol as
    # a fallback for bridged/wrapped listings. Robinhood Chain is exempt --
    # CoinGecko barely indexes it, and its board is meme-native anyway.
    meme_symbols = {coin["symbol"] for coin in fallback_items}
    meme_addresses = {address.lower()
                      for coin in fallback_items
                      for address in (platforms.get(coin["id"]) or {}).values() if address}

    def is_meme(row):
        if row["chain"] == "robinhood":
            return True
        address = (row.get("address") or "").lower()
        return address in meme_addresses or row["symbol"] in meme_symbols

    with ThreadPoolExecutor(max_workers=len(MEME_CHAIN_ORDER)) as executor:
        futures = {chain_id: executor.submit(gmgn_rank, chain_id, GMGN_RANK_CHAIN[chain_id])
                   for chain_id, _ in MEME_CHAIN_ORDER}
        chain_rows = {}
        for chain_id, _ in MEME_CHAIN_ORDER:
            try:
                filtered = [row for row in futures[chain_id].result() if is_meme(row)]
                chain_rows[chain_id] = [{**row, "rank": i + 1} for i, row in enumerate(filtered[:20])]
            except Exception:
                # GMGN's Cloudflare edge can deny server-side requests.  The
                # fallback preserves a useful, non-empty board in that case.
                chain_rows[chain_id] = coingecko_fallback(chain_id)

    chains = [{"id": chain_id, "name": label, "count": len(chain_rows[chain_id]),
               "items": chain_rows[chain_id]}
              for chain_id, label in MEME_CHAIN_ORDER]
    # The "all" board is a single cross-chain market-cap ranking (not a
    # concatenation of per-chain boards, which put a mid-cap Solana token at #1).
    merged = [coin for chain_id, _ in MEME_CHAIN_ORDER for coin in chain_rows[chain_id]]
    merged.sort(key=lambda coin: coin.get("marketCap") or 0, reverse=True)
    all_items = [{**coin, "rank": i + 1} for i, coin in enumerate(merged[:80])]
    radar_pool = [coin for coin in all_items if (coin.get("marketCap") or 0) >= 5_000_000]
    result = {"items": all_items,
              "radar": sorted(radar_pool, key=lambda coin: abs(coin.get("change24") or 0), reverse=True)[:10],
              "chains": chains, "updatedAt": int(time.time())}
    CACHE[key] = (time.time(), result)
    return result


def load_briefing() -> dict:
    """Reads the briefing pipeline's output (see ../briefing/build.py). Returns
    {} before the pipeline has ever run so callers can degrade gracefully."""
    try:
        return json.loads((PROJECT_ROOT / "data" / "briefing.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


# ---- Live Telegram briefing: scrape public t.me/s pages on demand so the
# dashboard's refresh button pulls fresh posts (the Actions pipeline only runs
# 3x/day). The scraper (briefing/collect_telegram.py) is standard-library only,
# so it is safe to import into this stdlib-only server. ----
KST = timezone(timedelta(hours=9))
# Serverless requests are capped at ~10s, so a live scrape must finish well
# inside that even when one channel is unresponsive.
LIVE_SCRAPE_TIMEOUT = 6
LIVE_BRIEFING_TTL = 60
_COLLECTOR = None
_BRIEF_TOKEN_RE = re.compile(r"\$[A-Za-z]{2,10}|[A-Z]{2,10}|[가-힣]{2,}")
_BRIEF_STOP = {"입니다", "있습니다", "하는", "그리고", "합니다", "때문", "정도", "관련",
               "https", "www", "com", "LIVE", "AI"}


def _collector():
    global _COLLECTOR
    if _COLLECTOR is None:
        import importlib.util
        path = PROJECT_ROOT / "briefing" / "collect_telegram.py"
        spec = importlib.util.spec_from_file_location("collect_telegram", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _COLLECTOR = module
    return _COLLECTOR


def _briefing_message(message: dict) -> dict:
    return {key: message[key] for key in ("text", "link", "ts", "channel")}


def _latest_briefing_messages(messages: list[dict], limit: int = 50) -> list[dict]:
    """Return newest posts independently from popularity/topic clustering."""
    return [_briefing_message(message) for message in
            sorted(messages, key=lambda message: message["ts"], reverse=True)[:limit]]


def _cluster_highlights(messages: list[dict], top_n: int = 8) -> list[dict]:
    """Lightweight, kiwipiepy-free clustering: group messages by their single
    most globally-frequent shared token, rank clusters by size."""
    freq, tokens_per = {}, []
    for message in messages:
        tokens = {t.upper() for t in _BRIEF_TOKEN_RE.findall(message["text"])
                  if t.upper() not in _BRIEF_STOP and len(t) >= 2}
        tokens_per.append(tokens)
        for token in tokens:
            freq[token] = freq.get(token, 0) + 1
    clusters: dict[str, list[dict]] = {}
    for message, tokens in zip(messages, tokens_per):
        if not tokens:
            continue
        clusters.setdefault(max(tokens, key=lambda t: (freq[t], t)), []).append(message)
    highlights = []
    for cluster in sorted(clusters.values(),
                          key=lambda cluster: (len(cluster), max(message["ts"] for message in cluster)),
                          reverse=True)[:top_n]:
        rep = max(cluster, key=lambda message: message["ts"])
        sentence = re.split(r"(?<=[.!?\n])\s+", rep["text"].strip())[0][:140]
        highlights.append({"text": sentence, "channel": rep["channel"], "link": rep["link"],
                           "ts": rep["ts"], "cluster_size": len(cluster)})
    return highlights


def live_briefing():
    collector = _collector()
    channels = load_channels_config().get("channels", [])

    def scrape(channel):
        try:
            messages = collector.fetch_recent_messages(channel["username"], max_pages=1,
                                                       timeout=LIVE_SCRAPE_TIMEOUT)
        except Exception as error:
            return channel, [], f"{type(error).__name__}: {error}"[:160]
        excludes = channel.get("exclude_keywords", [])
        good = [m for m in messages if not collector.is_ad(m["text"], excludes)]
        good.sort(key=lambda m: m["ts"])
        return channel, good, None

    # Every channel is fetched in a single wave: t.me handles ~20 concurrent
    # requests easily, and batching them instead multiplied the wall time by the
    # number of waves, which is what pushed this past the serverless timeout and
    # made the refresh button return partial (and therefore shifting) results.
    with ThreadPoolExecutor(max_workers=max(len(channels), 1)) as executor:
        results = list(executor.map(scrape, channels))

    raw_by_channel, all_messages, failed_channels = {}, [], []
    for channel, messages, error in results:
        label = channel.get("label", channel["username"])
        if error:
            failed_channels.append({"channel": label, "error": error})
            continue
        if not messages:
            continue
        raw_by_channel[label] = [{"text": m["text"], "link": m["link"], "ts": m["ts"]} for m in messages]
        all_messages.extend({**m, "channel": label} for m in messages)

    status = "error" if not raw_by_channel else "partial" if failed_channels else "ok"
    return {"generated_at": datetime.now(KST).isoformat(),
            "crypto_brief": {"status": status,
                             "highlights": _cluster_highlights(all_messages),
                             "latest": _latest_briefing_messages(all_messages),
                             "raw_by_channel": raw_by_channel,
                             "failed_channels": failed_channels,
                             "latest_source_ts": max((message["ts"] for message in all_messages), default=None)}}


def load_channels_config() -> dict:
    try:
        return json.loads((PROJECT_ROOT / "briefing" / "config" / "channels.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {"channels": []}


# DEX Screener's chainId strings differ from this file's CoinGecko-style chain
# ids (used by GMGN_CHAIN_SLUG); map them so gmgn_link() keeps working.
DEXSCREENER_CHAIN_MAP = {"solana": "solana", "base": "base", "bsc": "binance-smart-chain",
                         "ethereum": "ethereum", "robinhood": "robinhood"}


def _pair_liquidity(pair):
    return float((pair.get("liquidity") or {}).get("usd") or 0)


def dexscreener_token(address: str):
    """Resolve a contract address to its highest-liquidity pair where the CA is
    the BASE token (so quote-side matches like SOL/USDC pools don't hijack it)."""
    data = fetch_json("https://api.dexscreener.com/latest/dex/tokens/" + quote(address))
    pairs = [p for p in (data.get("pairs") or [])
             if (p.get("baseToken", {}).get("address") or "").lower() == address.lower()]
    return max(pairs, key=_pair_liquidity) if pairs else None


def _mention_blacklist() -> set:
    """Majors/stables that are never memecoins, shared with the pipeline config."""
    config = _load_briefing_config("memecoin_filter.json")
    return {s.upper() for s in config.get("blacklist", [])}


def _load_briefing_config(name: str) -> dict:
    try:
        return json.loads((PROJECT_ROOT / "briefing" / "config" / name).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def meme_mentions():
    """Rows for the '텔레그램 언급' tab. The pipeline now emits CONTRACT
    ADDRESSES found in messages (not word-shaped tickers), and each address is
    verified against DEX Screener before display -- an entry that doesn't
    resolve to a real DEX-traded token is dropped, which is what keeps AMA-type
    word noise off the board."""
    briefing = load_briefing()
    section = briefing.get("meme_mentions") or {}
    entries = section.get("tickers") or []
    blacklist = _mention_blacklist()

    def build(entry):
        address = entry.get("address")
        if not address:
            return None  # legacy word-based entry from an old briefing.json
        try:
            pair = dexscreener_token(address)
        except Exception:
            pair = None
        if not pair:
            return None  # unverified CA -- not a tradable token
        token = pair.get("baseToken") or {}
        symbol = (token.get("symbol") or "?").upper()
        if symbol in blacklist:
            return None  # a major/stable CA is not a memecoin mention
        chain_id = DEXSCREENER_CHAIN_MAP.get(pair.get("chainId"), pair.get("chainId"))
        return {"id": f"mention:{address}", "symbol": symbol, "name": token.get("name") or symbol,
                "mentions": entry.get("mentions"), "sample_text": entry.get("sample_text"),
                "sample_link": entry.get("sample_link"), "x_search": "https://x.com/search?q=%24" + quote(symbol),
                "price": float(pair["priceUsd"]) if pair.get("priceUsd") else None,
                "change24": (pair.get("priceChange") or {}).get("h24") or 0,
                "marketCap": _sane_cap(pair.get("fdv") or pair.get("marketCap")),
                "chain": chain_id, "address": token.get("address") or address,
                "gmgn": gmgn_link(chain_id, token.get("address") or address),
                "image": (pair.get("info") or {}).get("imageUrl", "")}

    with ThreadPoolExecutor(max_workers=min(8, len(entries) or 1)) as executor:
        items = [item for item in executor.map(build, entries) if item]
    items.sort(key=lambda item: item.get("mentions") or 0, reverse=True)
    return {"items": items, "status": section.get("status", "pending"), "updatedAt": int(time.time())}


# --- Unified OHLC history so every asset (stock, index, hyperliquid, coin,
# DEX memecoin) feeds the SAME candlestick chart, at 1h / 4h / 1d resolution.
# 1w / 1M are aggregated on the client from 1d. ---
GECKOTERMINAL_NETWORK = {"solana": "solana", "ethereum": "eth", "binance-smart-chain": "bsc",
                         "base": "base", "robinhood": "robinhood"}
INTRADAY_FMT = "%Y-%m-%d %H:%M"  # a space in the label marks an intraday bar (client keys off it)
DAILY_FMT = "%Y-%m-%d"


def _emit_ts(seconds, intraday):
    return datetime.fromtimestamp(seconds, tz=timezone.utc).strftime(INTRADAY_FMT if intraday else DAILY_FMT)


def _aggregate_seconds(series: dict, seconds: int) -> dict:
    """Bucket an epoch-keyed OHLCV series into fixed-width candles (e.g. 60m -> 4h)."""
    buckets, order = {}, []
    for i, ts in enumerate(series["t"]):
        key = int(ts) // seconds
        if key not in buckets:
            buckets[key] = {"t": key * seconds, "open": series["open"][i], "high": series["high"][i],
                            "low": series["low"][i], "close": series["close"][i], "volume": series["volume"][i] or 0}
            order.append(key)
        else:
            b = buckets[key]
            b["high"] = max(b["high"] if b["high"] is not None else b["close"], series["high"][i] if series["high"][i] is not None else series["close"][i])
            b["low"] = min(b["low"] if b["low"] is not None else b["close"], series["low"][i] if series["low"][i] is not None else series["close"][i])
            b["close"] = series["close"][i]
            b["volume"] += series["volume"][i] or 0
    out = {"t": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
    for key in order:
        for field in out:
            out[field].append(buckets[key][field])
    return out


def _finalize(series: dict, intraday: bool) -> dict:
    return {"dates": [_emit_ts(ts, intraday) for ts in series["t"]],
            "open": series["open"], "high": series["high"], "low": series["low"],
            "close": series["close"], "volume": series["volume"]}


def yahoo_history(symbol: str, interval: str):
    """Yahoo chart for stocks/indices/FX. Intraday uses 60m bars (4h aggregated x4)."""
    iv, rng = {"1h": ("60m", "6mo"), "4h": ("60m", "1y"), "1d": ("1d", "2y")}[interval]
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + quote(symbol) + f"?range={rng}&interval={iv}"
    result = fetch_json(url)["chart"]["result"][0]
    timestamps = result.get("timestamp") or []
    q = (result.get("indicators", {}).get("quote") or [{}])[0]
    series = {"t": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
    for i, ts in enumerate(timestamps):
        close = q.get("close", [])[i] if i < len(q.get("close", [])) else None
        if close is None:
            continue
        series["t"].append(ts)
        series["open"].append(q.get("open", [None])[i]); series["high"].append(q.get("high", [None])[i])
        series["low"].append(q.get("low", [None])[i]); series["close"].append(close)
        series["volume"].append(q.get("volume", [0])[i] or 0)
    if interval == "4h":
        series = _aggregate_seconds(series, 14400)
    return _finalize(series, interval != "1d")


def hyperliquid_history(label: str, interval: str):
    asset = HYPERLIQUID_ASSETS[label]
    span_ms = {"1h": 60 * 86400000, "4h": 240 * 86400000, "1d": 365 * 86400000}[interval]
    end = int(time.time() * 1000)
    rows = fetch_json_post("https://api.hyperliquid.xyz/info",
                            {"type": "candleSnapshot", "req": {"coin": asset["coin"], "interval": interval,
                                                                "startTime": end - span_ms, "endTime": end}})
    series = {"t": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
    for row in rows or []:
        series["t"].append(row["t"] / 1000)
        series["open"].append(float(row["o"])); series["high"].append(float(row["h"]))
        series["low"].append(float(row["l"])); series["close"].append(float(row["c"])); series["volume"].append(float(row["v"]))
    return _finalize(series, interval != "1d")


BINANCE_INTERVAL = {"1h": "1h", "4h": "4h", "1d": "1d"}


def binance_klines(ticker: str, interval: str):
    url = ("https://api.binance.com/api/v3/klines?symbol=" + quote(ticker.upper()) + "USDT"
           + "&interval=" + BINANCE_INTERVAL[interval] + "&limit=500")
    rows = fetch_json(url)
    series = {"t": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
    for row in rows:
        series["t"].append(row[0] / 1000)
        series["open"].append(float(row[1])); series["high"].append(float(row[2]))
        series["low"].append(float(row[3])); series["close"].append(float(row[4])); series["volume"].append(float(row[5]))
    return _finalize(series, interval != "1d")


def coingecko_ohlc(coin_id: str, interval: str = "1d"):
    """Fallback coin OHLC when Binance has no USDT pair. Free tier has no true
    1h; day counts pick the finest granularity CoinGecko offers per range."""
    days = {"1h": 1, "4h": 7, "1d": 365}[interval]
    rows = fetch_json("https://api.coingecko.com/api/v3/coins/" + quote(coin_id)
                      + f"/ohlc?vs_currency=usd&days={days}")
    intraday = interval != "1d"
    history = {"dates": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
    for ts, open_, high, low, close in rows:
        history["dates"].append(_emit_ts(ts / 1000, intraday))
        history["open"].append(open_); history["high"].append(high)
        history["low"].append(low); history["close"].append(close); history["volume"].append(0)
    return history


def coin_history(coin_id: str, ticker: str, interval: str):
    try:
        return binance_klines(ticker or coin_id, interval)
    except Exception:
        return coingecko_ohlc(coin_id, interval)


def geckoterminal_history(chain: str, address: str, interval: str = "1d"):
    """OHLCV for a DEX token via GeckoTerminal: top pool by liquidity, then its candles."""
    network = GECKOTERMINAL_NETWORK.get(chain)
    if not network:
        raise ValueError("Unsupported chain: " + str(chain))
    timeframe, aggregate = {"1h": ("hour", 1), "4h": ("hour", 4), "1d": ("day", 1)}[interval]
    pools = fetch_json(f"https://api.geckoterminal.com/api/v2/networks/{network}/tokens/"
                       + quote(address) + "/pools?page=1")
    pool_rows = pools.get("data") or []
    if not pool_rows:
        raise ValueError("No pools for token")
    pool_address = pool_rows[0]["attributes"]["address"]
    ohlcv = fetch_json(f"https://api.geckoterminal.com/api/v2/networks/{network}/pools/"
                       + quote(pool_address) + f"/ohlcv/{timeframe}?aggregate={aggregate}&limit=500")
    candles = sorted((ohlcv.get("data") or {}).get("attributes", {}).get("ohlcv_list") or [])
    intraday = interval != "1d"
    history = {"dates": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
    for ts, open_, high, low, close, volume in candles:
        history["dates"].append(_emit_ts(ts, intraday))
        history["open"].append(open_); history["high"].append(high)
        history["low"].append(low); history["close"].append(close); history["volume"].append(volume)
    return history


def asset_history(interval: str, params: dict) -> dict:
    hl = params.get("hl", [None])[0]
    chain = params.get("chain", [None])[0]
    address = params.get("address", [None])[0]
    stock = params.get("stock", [None])[0]
    coin = params.get("coin", [None])[0]
    ticker = params.get("sym", [None])[0]
    if hl in HYPERLIQUID_ASSETS:
        return {"history": hyperliquid_history(hl, interval)}
    if chain and address:
        return {"history": geckoterminal_history(chain, address, interval)}
    if coin:
        return {"history": coin_history(coin, ticker, interval)}
    if stock:
        return {"history": yahoo_history(stock, interval)}
    raise ValueError("자산 식별 파라미터가 필요합니다.")


NAVER_MARKET_SUFFIX = {"KOSPI": ".KS", "KOSDAQ": ".KQ"}


def stock_search_kr(query: str):
    """Yahoo's search endpoint rejects Hangul queries with 400; Naver's autocomplete handles them."""
    url = "https://ac.stock.naver.com/ac?q=" + quote(query) + "&target=stock,index"
    items = fetch_json(url, NAVER_UA).get("items", [])
    return {"items": [{"symbol": it["code"] + NAVER_MARKET_SUFFIX.get(it.get("typeCode", ""), ""),
                        "name": it.get("name", it["code"]), "exchange": it.get("typeName", ""), "type": "EQUITY"}
                       for it in items if it.get("code")]}


def stock_search(query: str):
    if len(query.strip()) < 2:
        return {"items": []}
    if re.search(r"[가-힣]", query):
        return stock_search_kr(query)
    url = "https://query1.finance.yahoo.com/v1/finance/search?q=" + quote(query) + "&quotesCount=12&newsCount=0"
    quotes = fetch_json(url).get("quotes", [])
    return {"items": [{"symbol": q.get("symbol"), "name": q.get("longname") or q.get("shortname") or q.get("symbol"),
                        "exchange": q.get("exchDisp") or q.get("exchange", ""), "type": q.get("quoteType", "")}
                       for q in quotes if q.get("quoteType") in ("EQUITY", "ETF", "MUTUALFUND", "INDEX") and q.get("symbol")]}


def stocks_data(symbols: list[str]):
    with ThreadPoolExecutor(max_workers=min(8, len(symbols) or 1)) as executor:
        items = list(executor.map(safe_quote, symbols))
    return {"items": items, "updatedAt": int(time.time())}


FEAR_GREED_LABELS_KO = {"Extreme Fear": "극공포", "Fear": "공포", "Neutral": "중립",
                         "Greed": "탐욕", "Extreme Greed": "극탐욕"}


def fear_greed():
    data = fetch_json("https://api.alternative.me/fng/?limit=1&format=json")["data"][0]
    label = data["value_classification"]
    return {"value": int(data["value"]), "label": FEAR_GREED_LABELS_KO.get(label, label), "updatedAt": int(time.time())}


def fetch_xml(url: str):
    request = Request(url, headers={"User-Agent": UA})
    try:
        with urlopen(request, timeout=8) as response:
            return ET.fromstring(response.read())
    except Exception:
        time.sleep(0.5)
        with urlopen(request, timeout=8) as response:
            return ET.fromstring(response.read())


def news(query: str, limit: int = 9):
    url = "https://news.google.com/rss/search?q=" + quote(query) + "&hl=ko&gl=KR&ceid=KR:ko"
    root = fetch_xml(url)
    items = []
    for item in root.findall("./channel/item")[:limit]:
        title = item.findtext("title", "")
        source = item.find("source")
        items.append({"title": re.sub(r"\s+-\s+[^-]+$", "", title), "url": item.findtext("link", "#"),
                      "source": source.text if source is not None else "Google News",
                      "published": item.findtext("pubDate", "")})
    return {"items": items, "updatedAt": int(time.time())}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print("[hub] " + fmt % args)

    def end_headers(self):
        # Force browsers to revalidate static assets (html/js/css) so a redeploy
        # or local edit is picked up instead of a stale cached copy. API/data
        # responses set their own Cache-Control via json().
        if not self.path.startswith(("/api/", "/data/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def json(self, data, status=200, ttl=0):
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        cache_control = (f"public, max-age=0, s-maxage={ttl}, stale-while-revalidate=86400"
                         if ttl and status == 200 else "no-store")
        self.send_header("Cache-Control", cache_control)
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/data/"):
            return self.serve_data_file(parsed.path)
        if not parsed.path.startswith("/api/"):
            return super().do_GET()
        params = parse_qs(parsed.query)
        try:
            if parsed.path == "/api/market": data, ttl = cached("market", 300, market_data), 60
            elif parsed.path == "/api/coins":
                category = params.get("category", ["all"])[0]
                per_page = min(max(int(params.get("limit", [30])[0]), 1), 100)
                ttl = 60 if category == "meme-token" else 300
                data = cached(f"coins:{category}:{per_page}", ttl, lambda: coins_market(category, per_page))
            elif parsed.path == "/api/fear-greed": data, ttl = cached("fear", 3600, fear_greed), 3600
            elif parsed.path == "/api/meme-chains": data, ttl = meme_chains(), 300
            elif parsed.path == "/api/meme-mentions": data, ttl = cached("meme-mentions", 60, meme_mentions), 60
            elif parsed.path == "/api/briefing":
                # A user-triggered refresh (fresh=1) must bypass every cache and
                # re-scrape. Ordinary page loads are served from the CDN for a
                # minute: previously *every* load re-scraped t.me, which was slow
                # enough to hit the serverless timeout and returned a slightly
                # different set of channels each time, so the briefing appeared
                # to reshuffle on every refresh.
                fresh = params.get("fresh", ["0"])[0] == "1"
                if fresh:
                    data, ttl = live_briefing(), 0
                else:
                    data = cached("briefing-live", LIVE_BRIEFING_TTL, live_briefing)
                    ttl = LIVE_BRIEFING_TTL
            elif parsed.path == "/api/kr-top10": data, ttl = cached("kr-top10", 300, kr_top10), 300
            elif parsed.path == "/api/stocks":
                symbols = [x.upper() for x in params.get("symbols", [""])[0].split(",") if x][:12]
                data, ttl = cached("stocks:" + ",".join(symbols), 60, lambda: stocks_data(symbols)), 60
            elif parsed.path == "/api/search-stocks":
                query = params.get("q", [""])[0]
                data, ttl = cached("search:" + query.lower(), 300, lambda: stock_search(query)), 300
            elif parsed.path == "/api/news":
                kind = params.get("kind", ["stocks"])[0]
                queries = {"stocks": "한국 증시 주식", "crypto": "암호화폐 비트코인", "world": "세계 경제 지정학 금리 유가"}
                if kind not in queries: raise ValueError("Unknown news kind")
                data, ttl = cached("news:" + kind, 600, lambda: news(queries[kind])), 600
            elif parsed.path == "/api/ipo":
                data, ttl = {"items": [], "updatedAt": int(time.time()), "notice": "공모주 수집기는 Phase 1.5에서 연결됩니다."}, 3600
            elif parsed.path == "/api/hyperliquid":
                symbol = params.get("symbol", [None])[0]
                labels = [symbol] if symbol in HYPERLIQUID_ASSETS else list(HYPERLIQUID_ASSETS)
                data, ttl = {"items": [hyperliquid_quote(l) for l in labels], "updatedAt": int(time.time())}, 60
            elif parsed.path == "/api/history":
                interval = params.get("interval", ["1d"])[0]
                if interval not in ("1h", "4h", "1d"):
                    interval = "1d"
                key = "hist:" + interval + ":" + "|".join(params.get(k, [""])[0]
                                                           for k in ("hl", "chain", "address", "stock", "coin"))
                data, ttl = cached(key, 300, lambda: asset_history(interval, params)), 300
            else: return self.json({"error": "Not found"}, 404)
            self.json(data, ttl=ttl)
        except Exception as error:
            self.json({"error": "데이터를 불러오지 못했습니다.", "detail": str(error)}, 502)

    def serve_data_file(self, path: str):
        # Local-dev-only convenience: on Vercel, /data/*.json is served as a
        # plain static asset directly (no rewrite touches it), so this path
        # never executes in production — see plan doc §1.
        target = (PROJECT_ROOT / path.lstrip("/")).resolve()
        if PROJECT_ROOT.resolve() not in target.parents or not target.is_file():
            return self.json({"error": "Not found"}, 404)
        try:
            data = json.loads(target.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return self.json({"error": "Not found"}, 404)
        # ttl=0 -> no-store: the stale-while-revalidate header the API routes
        # use made the browser paint a stale briefing on first load. Local-dev
        # only; on Vercel these files are static assets with their own caching.
        self.json(data, ttl=0)


# Vercel Python runtime entrypoint. Locally, the same Handler remains a normal
# threaded HTTP server; on Vercel it serves both static assets and /api/*.
class handler(Handler):
    pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8787), Handler)
    print("Interest Hub running at http://127.0.0.1:8787")
    try: server.serve_forever()
    except KeyboardInterrupt: print("\nStopped.")
