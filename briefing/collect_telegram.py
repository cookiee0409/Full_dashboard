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
from datetime import datetime, timedelta, timezone

UA = "Mozilla/5.0 (compatible; InterestHubBriefing/1.0; +public preview scraper)"
# Pull back far enough to fully cover the dashboard's last-24h channel view even
# for busy channels; t.me/s serves ~20 messages per page via ?before=<id>.
LOOKBACK = timedelta(hours=26)
MAX_PAGES = 6

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


def fetch_channel_html(username: str, before: int | None = None) -> str:
    url = "https://t.me/s/" + username + (f"?before={before}" if before else "")
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_recent_messages(username: str) -> list[dict]:
    """Page backwards through t.me/s until messages fall outside LOOKBACK (or the
    page cap), so a channel's full recent-24h window is captured, not just the
    ~20 newest. Dedupes by id across pages."""
    cutoff = datetime.now(timezone.utc) - LOOKBACK
    by_id: dict[int, dict] = {}
    before = None
    for _ in range(MAX_PAGES):
        page = parse_messages(fetch_channel_html(username, before))
        if not page:
            break
        for message in page:
            by_id[message["id"]] = message
        oldest = min(page, key=lambda m: m["id"])
        oldest_ts = _parse_ts(oldest["ts"])
        if oldest_ts and oldest_ts < cutoff:
            break            # went back far enough
        before = oldest["id"]
    return list(by_id.values())


def _parse_ts(ts: str):
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


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
    """Returns (messages_by_channel, new_state). Each channel yields ALL of its
    currently-public messages (t.me/s shows ~the last 20), so the dashboard's
    채널별 view can show a real recent-24h list and highlights reflect the current
    snapshot rather than an incremental diff. state keeps the max id seen."""
    messages_by_channel: dict[str, list[dict]] = {}
    new_state = dict(state)

    for channel in channels_config.get("channels", []):
        username = channel["username"]
        label = channel.get("label", username)
        exclude_keywords = channel.get("exclude_keywords", [])
        category = channel.get("category", "crypto")

        try:
            parsed = fetch_recent_messages(username)
        except Exception as error:
            print(f"[collect] {username} failed: {error}")
            continue

        collected, max_id_seen = [], (state.get(username) or {}).get("last_id", 0)
        for message in sorted(parsed, key=lambda m: m["id"]):
            max_id_seen = max(max_id_seen, message["id"])
            if is_ad(message["text"], exclude_keywords):
                continue
            collected.append({**message, "category": category})
        if collected:
            messages_by_channel[label] = collected
        new_state[username] = {"last_id": max_id_seen}

    return messages_by_channel, new_state
