"""Interest Hub Economy Edition - dependency-free local dashboard server."""
from __future__ import annotations

import json
import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).parent
CACHE: dict[str, tuple[float, object]] = {}
UA = "InterestHubEconomy/1.0 (+local dashboard)"


def cached(key: str, ttl: int, loader):
    item = CACHE.get(key)
    if item and time.time() - item[0] < ttl:
        return item[1]
    value = loader()
    CACHE[key] = (time.time(), value)
    return value


def fetch_json(url: str):
    request = Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urlopen(request, timeout=12) as response:
        return json.loads(response.read().decode("utf-8"))


def yahoo(symbol: str):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + quote(symbol) + "?range=8d&interval=1d"
    result = fetch_json(url)["chart"]["result"][0]
    meta, quote_data = result["meta"], result["indicators"]["quote"][0]
    closes = [v for v in quote_data.get("close", []) if v is not None]
    price = meta.get("regularMarketPrice") or (closes[-1] if closes else 0)
    previous = meta.get("chartPreviousClose") or meta.get("previousClose") or price
    change = price - previous
    return {"symbol": symbol, "name": meta.get("shortName") or symbol, "price": price,
            "change": change, "changePct": (change / previous * 100) if previous else 0,
            "currency": meta.get("currency", "USD"), "spark": closes[-7:],
            "marketState": meta.get("marketState", ""), "marketCap": market_cap(symbol)}


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
               + "&type=trailingMarketCap&period1=1700000000&period2=1800000000")
        series = fetch_json(url)["timeseries"]["result"][0].get("trailingMarketCap", [])
        value = series[-1]["reportedValue"]["raw"] if series else None
    except Exception:
        value = None
    CACHE[key] = (time.time(), value)
    return value


def market_data():
    definitions = [("KOSPI", "^KS11"), ("KOSDAQ", "^KQ11"), ("S&P 500", "^GSPC"),
                   ("NASDAQ", "^IXIC"), ("USD/KRW", "KRW=X"), ("Gold", "GC=F")]
    items = []
    for label, symbol in definitions:
        try:
            item = yahoo(symbol)
            item["name"] = label
            items.append(item)
        except Exception as error:
            items.append({"name": label, "symbol": symbol, "error": str(error)})
    try:
        coins = fetch_json("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,krw&include_24hr_change=true")
        for coin, label in (("bitcoin", "BTC"), ("ethereum", "ETH")):
            items.append({"name": label, "symbol": coin, "price": coins[coin]["usd"], "currency": "USD",
                          "changePct": coins[coin].get("usd_24h_change", 0), "change": 0})
    except Exception as error:
        items.extend([{"name": "BTC", "error": str(error)}, {"name": "ETH", "error": str(error)}])
    return {"items": items, "updatedAt": int(time.time())}


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
                        "spark": (c.get("sparkline_in_7d") or {}).get("price", [])[-30:]}
                       for c in data], "updatedAt": int(time.time())}


def meme_chains():
    """Group the top meme-token universe by every CoinGecko platform (chain)."""
    key = "meme-chains"
    item = CACHE.get(key)
    if item and time.time() - item[0] < 600:
        return item[1]
    platforms = cached("coin-platforms", 86400, lambda: fetch_json("https://api.coingecko.com/api/v3/coins/list?include_platform=true"))
    platform_by_id = {coin["id"]: list((coin.get("platforms") or {}).keys()) for coin in platforms}
    items = coins_market("meme-token", 250)["items"]
    groups: dict[str, list[dict]] = {}
    top_chain_ids = set()
    for index, coin in enumerate(items):
        chains = platform_by_id.get(coin["id"], [])
        if index < 30:
            top_chain_ids.update(chains)
        for chain in chains:
            groups.setdefault(chain, []).append(coin)
    chain_names = sorted(top_chain_ids, key=lambda chain: (-len(groups.get(chain, [])), chain))
    result = {"items": items[:30], "chains": [{"id": chain, "name": chain.replace("-", " ").title(),
                                                   "count": len(groups.get(chain, [])),
                                                   "items": groups.get(chain, [])[:20]}
                                                for chain in chain_names], "updatedAt": int(time.time())}
    CACHE[key] = (time.time(), result)
    return result


def stock_search(query: str):
    if len(query.strip()) < 2:
        return {"items": []}
    url = "https://query1.finance.yahoo.com/v1/finance/search?q=" + quote(query) + "&quotesCount=12&newsCount=0"
    quotes = fetch_json(url).get("quotes", [])
    return {"items": [{"symbol": q.get("symbol"), "name": q.get("longname") or q.get("shortname") or q.get("symbol"),
                        "exchange": q.get("exchDisp") or q.get("exchange", ""), "type": q.get("quoteType", "")}
                       for q in quotes if q.get("quoteType") in ("EQUITY", "ETF", "MUTUALFUND", "INDEX") and q.get("symbol")]}


def stocks_data(symbols: list[str]):
    with ThreadPoolExecutor(max_workers=min(8, len(symbols) or 1)) as executor:
        items = list(executor.map(yahoo, symbols))
    return {"items": items, "updatedAt": int(time.time())}


def fear_greed():
    data = fetch_json("https://api.alternative.me/fng/?limit=1&format=json")["data"][0]
    return {"value": int(data["value"]), "label": data["value_classification"], "updatedAt": int(time.time())}


def news(query: str, limit: int = 9):
    url = "https://news.google.com/rss/search?q=" + quote(query) + "&hl=ko&gl=KR&ceid=KR:ko"
    request = Request(url, headers={"User-Agent": UA})
    with urlopen(request, timeout=12) as response:
        root = ET.fromstring(response.read())
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

    def json(self, data, status=200):
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            return super().do_GET()
        params = parse_qs(parsed.query)
        try:
            if parsed.path == "/api/market": data = cached("market", 300, market_data)
            elif parsed.path == "/api/coins":
                category = params.get("category", ["all"])[0]
                per_page = min(max(int(params.get("limit", [30])[0]), 1), 100)
                data = cached(f"coins:{category}:{per_page}", 60 if category == "meme-token" else 300,
                              lambda: coins_market(category, per_page))
            elif parsed.path == "/api/fear-greed": data = cached("fear", 3600, fear_greed)
            elif parsed.path == "/api/meme-chains": data = meme_chains()
            elif parsed.path == "/api/stocks":
                symbols = [x.upper() for x in params.get("symbols", [""])[0].split(",") if x][:12]
                data = cached("stocks:" + ",".join(symbols), 60, lambda: stocks_data(symbols))
            elif parsed.path == "/api/search-stocks":
                query = params.get("q", [""])[0]
                data = cached("search:" + query.lower(), 300, lambda: stock_search(query))
            elif parsed.path == "/api/news":
                kind = params.get("kind", ["stocks"])[0]
                queries = {"stocks": "한국 증시 주식", "crypto": "암호화폐 비트코인", "world": "세계 경제 지정학 금리 유가"}
                if kind not in queries: raise ValueError("Unknown news kind")
                data = cached("news:" + kind, 600, lambda: news(queries[kind]))
            elif parsed.path == "/api/ipo":
                data = {"items": [], "updatedAt": int(time.time()), "notice": "공모주 수집기는 Phase 1.5에서 연결됩니다."}
            else: return self.json({"error": "Not found"}, 404)
            self.json(data)
        except Exception as error:
            self.json({"error": "데이터를 불러오지 못했습니다.", "detail": str(error)}, 502)


# Vercel Python runtime entrypoint. Locally, the same Handler remains a normal
# threaded HTTP server; on Vercel it serves both static assets and /api/*.
class handler(Handler):
    pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8787), Handler)
    print("Interest Hub running at http://127.0.0.1:8787")
    try: server.serve_forever()
    except KeyboardInterrupt: print("\nStopped.")
