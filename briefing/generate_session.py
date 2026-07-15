"""Run this ONCE, locally, by hand: `python briefing/generate_session.py`.

This is an interactive login (Telegram will text you a login code, and ask
for your 2FA password if you have one enabled) -- it cannot be automated or
run on your behalf. It prints a session string at the end; copy that value
into the GitHub Secret named TELEGRAM_SESSION yourself (repo Settings ->
Secrets and variables -> Actions). Nothing here is uploaded or sent anywhere
except to Telegram's own login API.

Use a dedicated/secondary Telegram account for collection, not your main
account (기획서 §8 확정 사항 5).

Requires: pip install telethon
Requires API_ID / API_HASH from https://my.telegram.org/apps (also manual).
"""
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

if __name__ == "__main__":
    api_id = int(input("API_ID: ").strip())
    api_hash = input("API_HASH: ").strip()
    with TelegramClient(StringSession(), api_id, api_hash) as client:
        session_string = client.session.save()
    print("\n로그인 성공. 아래 문자열을 GitHub Secret 'TELEGRAM_SESSION' 값으로 등록하세요:\n")
    print(session_string)
