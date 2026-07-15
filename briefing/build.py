"""Briefing pipeline orchestrator -- runs only in GitHub Actions
(.github/workflows/briefing.yml), never imported by dashboard/server.py.

Each section runs independently: a failure in one leaves the others intact
and marks only that section "status": "error" (기획서 §2 설계 원칙).
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import collect_prompts
import collect_telegram
import extract_keywords
import extract_memecoins

ROOT = Path(__file__).parent
DATA = ROOT.parent / "data"
CONFIG = ROOT / "config"
KST = timezone(timedelta(hours=9))

# Reserved for §8-1's option (b): LLM summary of cluster representatives.
# Not wired up -- (a) rule-based first-sentence extraction is used instead.
USE_LLM_SUMMARY = False


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_stopwords() -> set[str]:
    try:
        return {w.strip() for w in (CONFIG / "stopwords.txt").read_text(encoding="utf-8").splitlines() if w.strip()}
    except FileNotFoundError:
        return set()


def cluster_highlights(messages_by_channel: dict, stopwords: set[str], top_n: int = 8) -> dict:
    """Group messages by their single most globally-frequent shared token, then
    rank clusters by size. A deliberately simple v1 (기획서 §8-1: 규칙 기반 (a))."""
    all_messages = [{**m, "channel": channel} for channel, msgs in messages_by_channel.items() for m in msgs]
    token_counts: dict[str, int] = {}
    message_tokens = []
    for message in all_messages:
        tokens = set(extract_keywords.nouns(message["text"], stopwords))
        message_tokens.append(tokens)
        for token in tokens:
            token_counts[token] = token_counts.get(token, 0) + 1

    clusters: dict[str, list[dict]] = {}
    for message, tokens in zip(all_messages, message_tokens):
        if not tokens:
            continue
        top_token = max(tokens, key=lambda t: token_counts[t])
        clusters.setdefault(top_token, []).append(message)

    ranked = sorted(clusters.values(), key=len, reverse=True)[:top_n]
    highlights = []
    for cluster in ranked:
        representative = cluster[0]
        first_sentence = re.split(r"(?<=[.!?\n])\s+", representative["text"].strip())[0][:140]
        highlights.append({"text": first_sentence, "channel": representative["channel"],
                           "link": representative["link"], "ts": representative["ts"],
                           "cluster_size": len(cluster)})

    raw_by_channel = {channel: [{"text": m["text"], "link": m["link"], "ts": m["ts"]} for m in msgs]
                      for channel, msgs in messages_by_channel.items()}
    return {"highlights": highlights, "raw_by_channel": raw_by_channel}


def main():
    state = load_json(DATA / "state.json", {})
    history = load_json(DATA / "keyword_history.json", {})
    channels_config = load_json(CONFIG / "channels.json", {"channels": []})
    filter_config = load_json(CONFIG / "memecoin_filter.json", {"blacklist": [], "whitelist": []})
    prompt_config = load_json(CONFIG / "prompt_sources.json", {"subreddits": [], "title_keywords": []})
    stopwords = load_stopwords()

    messages_by_channel, new_state = {}, state
    try:
        messages_by_channel, new_state = asyncio.run(collect_telegram.collect(channels_config, state))
    except Exception as error:
        print(f"[briefing] collect_telegram failed: {error}", file=sys.stderr)

    briefing = {"generated_at": datetime.now(KST).isoformat()}

    try:
        briefing["crypto_brief"] = {"status": "ok", **cluster_highlights(messages_by_channel, stopwords)}
    except Exception as error:
        print(f"[briefing] crypto_brief failed: {error}", file=sys.stderr)
        briefing["crypto_brief"] = {"status": "error", "highlights": [], "raw_by_channel": {}}

    try:
        briefing["meme_mentions"] = {"status": "ok", **extract_memecoins.extract(messages_by_channel, filter_config)}
    except Exception as error:
        print(f"[briefing] meme_mentions failed: {error}", file=sys.stderr)
        briefing["meme_mentions"] = {"status": "error", "tickers": []}

    try:
        keywords_result, history = extract_keywords.extract(messages_by_channel, history, stopwords)
        briefing["keywords"] = {"status": "ok", **keywords_result}
    except Exception as error:
        print(f"[briefing] keywords failed: {error}", file=sys.stderr)
        briefing["keywords"] = {"status": "error", "items": []}

    try:
        briefing["prompt_sources"] = {"status": "ok", **collect_prompts.collect(prompt_config, messages_by_channel)}
    except Exception as error:
        print(f"[briefing] prompt_sources failed: {error}", file=sys.stderr)
        briefing["prompt_sources"] = {"status": "error", "items": []}

    DATA.mkdir(exist_ok=True)
    save_json(DATA / "briefing.json", briefing)
    save_json(DATA / "state.json", new_state)
    save_json(DATA / "keyword_history.json", history)
    print(f"[briefing] wrote {DATA / 'briefing.json'}")


if __name__ == "__main__":
    main()
