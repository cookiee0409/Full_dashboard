"""Collect AI video-prompt source links: Reddit hot posts + Telegram ai_video channels.
No prompt-body extraction -- links only (기획서 §4.6)."""
from __future__ import annotations

import json
import urllib.request

REDDIT_UA = "InterestHubBriefing/1.0 (by /u/interesthub_dashboard)"


def fetch_reddit_hot(subreddit: str, limit: int = 10) -> list[dict]:
    url = f"https://www.reddit.com/r/{subreddit}/hot.json?limit={limit}"
    request = urllib.request.Request(url, headers={"User-Agent": REDDIT_UA})
    with urllib.request.urlopen(request, timeout=8) as response:
        data = json.loads(response.read().decode("utf-8"))
    children = data.get("data", {}).get("children", [])
    return [{"title": c["data"]["title"], "source": "reddit", "upvotes": c["data"].get("ups", 0),
             "ts": c["data"].get("created_utc"), "link": "https://www.reddit.com" + c["data"]["permalink"]}
            for c in children]


def collect(prompt_config: dict, messages_by_channel: dict) -> dict:
    keywords = [k.lower() for k in prompt_config.get("title_keywords", [])]
    items = []

    for subreddit in prompt_config.get("subreddits", []):
        try:
            posts = fetch_reddit_hot(subreddit)
        except Exception:
            continue
        items += [p for p in posts if not keywords or any(k in p["title"].lower() for k in keywords)]

    for messages in messages_by_channel.values():
        for message in messages:
            if message.get("category") != "ai_video":
                continue
            if keywords and not any(k in message["text"].lower() for k in keywords):
                continue
            items.append({"title": message["text"][:120], "source": "telegram", "upvotes": 0,
                          "ts": message["ts"], "link": message["link"]})

    items.sort(key=lambda item: item.get("upvotes") or 0, reverse=True)
    return {"items": items[:20]}
