"""Credential-free Telegram PUBLIC-channel collector.

Scrapes https://t.me/s/<username> (the public web preview) with the standard
library only -- no API_ID/HASH, no login, no session string. Works for public
channels (those viewable at t.me/s/...). Private/invite-only channels are not
reachable this way; those would require an authenticated user session instead.

Runs in GitHub Actions (.github/workflows/briefing.yml) and is never imported
by dashboard/server.py.
"""
from __future__ import annotations

import html
import re
import urllib.request

UA = "Mozilla/5.0 (compatible; InterestHubBriefing/1.0; +public preview scraper)"

POST_RE = re.compile(r'data-post="([^"]+)"')
TEXT_RE = re.compile(r'tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', re.S)
TIME_RE = re.compile(r'<time[^>]*datetime="([^"]+)"')
LINK_ONLY_RE = re.compile(r"^\s*https?://\S+\s*$")


def clean_text(raw: str) -> str:
    raw = re.sub(r"<br\s*/?>", "\n", raw)
    raw = re.sub(r"<[^>]+>", "", raw)
    return html.unescape(raw).strip()


def is_ad(text: str, exclude_keywords: list[str]) -> bool:
    if not text or not text.strip() or LINK_ONLY_RE.match(text.strip()):
        return True
    return any(keyword in text for keyword in exclude_keywords)


def fetch_channel_html(username: str) -> str:
    request = urllib.request.Request("https://t.me/s/" + username, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.read().decode("utf-8", errors="replace")


def parse_messages(page_html: str) -> list[dict]:
    """Each message wrapper starts with 'tgme_widget_message_wrap'; split on it
    and pull the post id, text, and timestamp out of every chunk."""
    messages = []
    for chunk in page_html.split("tgme_widget_message_wrap")[1:]:
        post = POST_RE.search(chunk)
        text = TEXT_RE.search(chunk)
        times = TIME_RE.findall(chunk)
        if not post or not text:
            continue
        try:
            message_id = int(post.group(1).rsplit("/", 1)[-1])
        except ValueError:
            continue
        messages.append({
            "id": message_id,
            "text": clean_text(text.group(1)),
            "ts": times[-1] if times else "",  # footer date is the last <time> in the chunk
            "link": "https://t.me/" + post.group(1),
        })
    return messages


def collect(channels_config: dict, state: dict):
    """Returns (messages_by_channel, new_state). Incremental via state's last_id,
    so each run only surfaces messages newer than the previous run."""
    messages_by_channel: dict[str, list[dict]] = {}
    new_state = dict(state)

    for channel in channels_config.get("channels", []):
        username = channel["username"]
        label = channel.get("label", username)
        exclude_keywords = channel.get("exclude_keywords", [])
        category = channel.get("category", "crypto")
        last_id = (state.get(username) or {}).get("last_id", 0)

        try:
            parsed = parse_messages(fetch_channel_html(username))
        except Exception as error:
            print(f"[collect] {username} failed: {error}")
            continue

        collected, max_id_seen = [], last_id
        for message in sorted(parsed, key=lambda m: m["id"]):
            max_id_seen = max(max_id_seen, message["id"])
            if message["id"] <= last_id or is_ad(message["text"], exclude_keywords):
                continue
            collected.append({**message, "category": category})
        if collected:
            messages_by_channel[label] = collected
        new_state[username] = {"last_id": max_id_seen}

    return messages_by_channel, new_state
