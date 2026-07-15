"""Rule-based memecoin ticker extraction from collected Telegram messages."""
from __future__ import annotations

import re

CASHTAG_RE = re.compile(r"\$([A-Za-z]{2,10})\b")
UPPER_TOKEN_RE = re.compile(r"\b([A-Z]{2,10})\b")


def extract(messages_by_channel: dict, filter_config: dict, min_mentions: int = 2) -> dict:
    blacklist = {t.upper() for t in filter_config.get("blacklist", [])}
    whitelist = {t.upper() for t in filter_config.get("whitelist", [])}

    counts: dict[str, dict] = {}
    for messages in messages_by_channel.values():
        for message in messages:
            text = message["text"]
            tickers = {m.group(1).upper() for m in CASHTAG_RE.finditer(text)}
            tickers |= {m.group(1) for m in UPPER_TOKEN_RE.finditer(text)}
            for ticker in tickers:
                if ticker in blacklist and ticker not in whitelist:
                    continue
                entry = counts.setdefault(ticker, {"ticker": ticker, "mentions": 0,
                                                     "sample_text": text[:200], "sample_link": message["link"]})
                entry["mentions"] += 1

    tickers = [entry for entry in counts.values() if entry["mentions"] >= min_mentions]
    tickers.sort(key=lambda entry: entry["mentions"], reverse=True)
    return {"tickers": tickers}
