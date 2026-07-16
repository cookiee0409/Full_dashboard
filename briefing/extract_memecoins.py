"""Contract-address (CA) extraction from collected Telegram messages.

Word-shaped ticker matching ($TICKER / uppercase tokens) produced far too much
noise -- ordinary words like AMA, GM, or KOL names showed up as "memecoins".
Degen channels share actual contract addresses when they call a coin, so the
signal now is: extract CAs, and let the dashboard server verify each one
against DEX Screener before it is ever displayed (dashboard/server.py
meme_mentions). Anything that doesn't resolve to a real DEX-traded token is
silently dropped there.
"""
from __future__ import annotations

import re

# EVM: 0x + 40 hex chars. Solana: base58 (no 0,O,I,l), 32-44 chars.
EVM_CA_RE = re.compile(r"\b0x[0-9a-fA-F]{40}\b")
SOL_CA_RE = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")


def extract(messages_by_channel: dict, min_mentions: int = 1) -> dict:
    counts: dict[str, dict] = {}
    for messages in messages_by_channel.values():
        for message in messages:
            text = message["text"]
            addresses = set(EVM_CA_RE.findall(text)) | set(SOL_CA_RE.findall(text))
            for address in addresses:
                # EVM addresses are case-insensitive; Solana base58 is not.
                key = address.lower() if address.startswith("0x") else address
                entry = counts.setdefault(key, {"address": address, "mentions": 0,
                                                 "sample_text": text[:200],
                                                 "sample_link": message["link"]})
                entry["mentions"] += 1

    entries = [entry for entry in counts.values() if entry["mentions"] >= min_mentions]
    entries.sort(key=lambda entry: entry["mentions"], reverse=True)
    return {"tickers": entries}
