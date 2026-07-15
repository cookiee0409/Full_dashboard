"""Incremental Telegram message collector.

Runs only inside GitHub Actions (see ../.github/workflows/briefing.yml) --
never imported by dashboard/server.py, which stays stdlib-only by design.
Requires TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION env vars,
provisioned as GitHub Secrets from a session string generated locally via
generate_session.py.
"""
from __future__ import annotations

import os
import re
from datetime import timezone

from telethon import TelegramClient
from telethon.sessions import StringSession

LINK_ONLY_RE = re.compile(r"^\s*https?://\S+\s*$")


def is_ad(text: str, exclude_keywords: list[str]) -> bool:
    if not text or not text.strip():
        return True
    if LINK_ONLY_RE.match(text.strip()):
        return True
    return any(keyword in text for keyword in exclude_keywords)


async def collect(channels_config: dict, state: dict, per_channel_limit: int = 200):
    api_id = int(os.environ["TELEGRAM_API_ID"])
    api_hash = os.environ["TELEGRAM_API_HASH"]
    session = os.environ["TELEGRAM_SESSION"]

    messages_by_channel: dict[str, list[dict]] = {}
    new_state = dict(state)

    async with TelegramClient(StringSession(session), api_id, api_hash) as client:
        for channel in channels_config.get("channels", []):
            username = channel["username"]
            label = channel.get("label", username)
            exclude_keywords = channel.get("exclude_keywords", [])
            last_id = (state.get(username) or {}).get("last_id", 0)
            collected = []
            max_id_seen = last_id
            async for message in client.iter_messages(username, min_id=last_id, limit=per_channel_limit):
                if not message.text or is_ad(message.text, exclude_keywords):
                    continue
                collected.append({
                    "id": message.id,
                    "text": message.text,
                    "ts": message.date.astimezone(timezone.utc).isoformat(),
                    "link": f"https://t.me/{username}/{message.id}",
                    "category": channel.get("category", "crypto"),
                })
                max_id_seen = max(max_id_seen, message.id)
            if collected:
                messages_by_channel[label] = list(reversed(collected))  # oldest first
            new_state[username] = {"last_id": max_id_seen}

    return messages_by_channel, new_state
