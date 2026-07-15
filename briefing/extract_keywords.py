"""Rule-based trending keyword extraction (Telegram text + Google News headlines).

No LLM involved (기획서 §4.5 확정 사항). Score = today_count * (today_count / avg_last_7_days).
"""
from __future__ import annotations

import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from urllib.parse import quote

UA = "InterestHubBriefing/1.0 (+local pipeline)"
NEWS_QUERIES = ["암호화폐 비트코인", "한국 증시 주식"]

_kiwi = None


def nouns(text: str, stopwords: set[str]) -> list[str]:
    """Korean noun extraction (kiwipiepy) + uppercase ticker/acronym tokens.
    Shared with build.py's highlight clustering so both use the same tokenization."""
    global _kiwi
    tokens = [m.upper() for m in re.findall(r"\b[A-Z]{2,10}\b", text)]
    try:
        from kiwipiepy import Kiwi
    except ImportError:
        return tokens
    if _kiwi is None:
        _kiwi = Kiwi()
    for token in _kiwi.tokenize(text):
        if token.tag.startswith("NN") and len(token.form) >= 2 and token.form not in stopwords:
            tokens.append(token.form)
    return tokens


def fetch_news_documents(limit: int = 15) -> list[dict]:
    documents = []
    for query in NEWS_QUERIES:
        url = "https://news.google.com/rss/search?q=" + quote(query) + "&hl=ko&gl=KR&ceid=KR:ko"
        request = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                root = ET.fromstring(response.read())
            for item in root.findall("./channel/item")[:limit]:
                title = re.sub(r"\s+-\s+[^-]+$", "", item.findtext("title", ""))
                documents.append({"text": title, "type": "news", "link": item.findtext("link", "#")})
        except Exception:
            continue
    return documents


def extract(messages_by_channel: dict, history: dict, stopwords: set[str], top_n: int = 10):
    documents = [{"text": m["text"], "type": "telegram", "link": m["link"]}
                 for messages in messages_by_channel.values() for m in messages]
    documents += fetch_news_documents()

    today_counts: dict[str, int] = {}
    evidence: dict[str, list[dict]] = {}
    for doc in documents:
        for word in set(nouns(doc["text"], stopwords)):
            today_counts[word] = today_counts.get(word, 0) + 1
            evidence.setdefault(word, []).append({"type": doc["type"], "text": doc["text"][:200], "link": doc["link"]})

    today = date.today().isoformat()
    cutoff_ordinal = date.today().toordinal() - 7
    new_history: dict[str, list[dict]] = {}
    for word, entries in history.items():
        kept = [e for e in entries if date.fromisoformat(e["date"]).toordinal() >= cutoff_ordinal]
        if kept:
            new_history[word] = kept
    for word, count in today_counts.items():
        prior = [e for e in new_history.get(word, []) if e["date"] != today]
        new_history[word] = prior + [{"date": today, "count": count}]

    items = []
    for word, count in today_counts.items():
        past_counts = [e["count"] for e in new_history.get(word, []) if e["date"] != today]
        avg_past = (sum(past_counts) / len(past_counts)) if past_counts else 0
        score = count * (count / max(avg_past, 1))
        trend = "new" if not past_counts else ("rising" if count > avg_past * 1.3 else "steady")
        items.append({"word": word, "count": count, "trend": trend, "score": round(score, 2),
                      "evidence": evidence.get(word, [])[:3]})
    items.sort(key=lambda item: item["score"], reverse=True)
    return {"items": items[:top_n]}, new_history
