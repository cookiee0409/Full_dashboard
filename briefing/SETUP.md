# 모닝 브리핑 파이프라인 설정 가이드

텔레그램 브리핑·언급 밈코인·키워드·프롬프트 카드를 채우려면 아래 준비가 필요합니다.
한 번만 설정해두면 그다음부터는 GitHub Actions가 하루 3회(06:30/12:30/18:30 KST) 자동으로 돌립니다.

> ⚠️ **수집 전용 보조 텔레그램 계정을 쓰세요.** 메인 계정으로 하지 마세요.
> 세션 문자열은 곧 "그 계정에 대한 로그인 열쇠" 역할을 하기 때문입니다(→ 3번).

---

## 1. Telegram API_ID / API_HASH 발급

1. 브라우저에서 <https://my.telegram.org> 접속
2. **수집용 보조 계정의 전화번호**로 로그인 → 텔레그램 앱으로 오는 인증코드 입력
3. **API development tools** 클릭
4. 폼 작성 (아무 값이나 가능):
   - App title: `briefing`
   - Short name: `briefing`
   - Platform: `Other` (나머지 URL 등은 비워도 됨)
5. **Create application** → 화면에 나오는 두 값을 복사
   - **App api_id**: 숫자 (예: `1234567`)
   - **App api_hash**: 32자리 영문·숫자 (예: `abcd1234ef56...`)

이 두 값은 나중에 GitHub Secrets에 넣습니다(→ 4번). 노출되면 안 되는 값이니 아무 데나 붙여넣지 마세요.

---

## 2. SESSION(세션 문자열)이란? — 3번 질문 답변

- 텔레그램은 로그인할 때마다 전화번호 → 인증코드(→ 2차 비밀번호) 절차를 거칩니다.
- **세션 문자열(StringSession)** 은 그 로그인 결과를 통째로 저장한 긴 문자열입니다.
  즉 "이 클라이언트는 이미 계정 X에 로그인되어 있다"는 것을 증명하는 **저장된 로그인 토큰**입니다.
- 이 문자열만 있으면 전화번호·인증코드 없이도 그 계정으로 메시지를 읽을 수 있습니다.
  → **로그인 쿠키/비밀번호에 준하는 민감 정보**입니다. 그래서:
  - 절대 코드나 저장소에 커밋하지 않습니다 (`.gitignore`에 `*.session` 이미 등록됨).
  - **GitHub Secrets에만** 저장합니다 (→ 4번). Secrets는 암호화되어 저장되고 로그에도 자동 마스킹됩니다.
  - 수집 전용 보조 계정을 쓰는 이유이기도 합니다(만에 하나 유출돼도 피해가 그 계정에 한정).

---

## 3. 세션 문자열 만들기 — Python 미설치 상태로 (Google Colab) · 2번 질문 답변

로컬에 Python을 깔지 않고 **브라우저만으로** 만들 수 있습니다. 무료인 Google Colab을 씁니다.

1. <https://colab.research.google.com> 접속 → 구글 로그인 → **새 노트북**
2. 아래 코드를 셀에 붙여넣고 실행(▶) — Colab은 셀에서 바로 입력창을 띄워줍니다:

   ```python
   !pip install telethon -q
   from telethon import TelegramClient
   from telethon.sessions import StringSession

   api_id = int(input("API_ID: "))       # 1번에서 받은 숫자
   api_hash = input("API_HASH: ").strip()  # 1번에서 받은 해시

   client = TelegramClient(StringSession(), api_id, api_hash)
   await client.start()   # 전화번호 → 인증코드 → (2차 비번) 순서로 물어봅니다
   print("\n===== 아래 한 줄을 통째로 복사하세요 (SESSION) =====\n")
   print(client.session.save())
   ```

3. 실행하면 순서대로 입력창이 뜹니다:
   - `API_ID`, `API_HASH`
   - `Please enter your phone`: 보조 계정 전화번호 (국가코드 포함, 예: `+8210...`)
   - `Please enter the code`: 텔레그램 앱으로 온 코드
   - (2차 비밀번호를 켜놨다면) 비밀번호
4. 마지막에 출력되는 **긴 한 줄**이 세션 문자열입니다. 이 값을 복사해두세요(→ 4번).
5. 복사 후 **Colab 노트북은 저장하지 말고 닫으세요.** 출력에 세션이 남으니 공유·저장 금지.

> 🚫 "telegram session generator" 같은 **아무 웹사이트에 api_hash·전화번호·코드를 입력하지 마세요.**
> 그건 남에게 계정 접근권을 통째로 넘기는 것과 같습니다. Colab은 텔레그램 공식 라이브러리를
> 본인이 직접 실행하는 것이라 안전합니다.
>
> 참고: 로컬에 Python을 설치할 수 있다면 `pip install telethon` 후 저장소의
> `briefing/generate_session.py`를 실행해도 동일합니다.

---

## 4. GitHub Secrets 등록

발급받은 3개 값을 저장소 Secrets에 넣습니다. (Secrets는 저장소가 public이어도 안전하게 암호화됩니다.)

1. GitHub 저장소 → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret** 을 3번 눌러 각각 등록:

   | Name (정확히 이 이름) | Value |
   |---|---|
   | `TELEGRAM_API_ID` | 1번의 api_id (숫자) |
   | `TELEGRAM_API_HASH` | 1번의 api_hash |
   | `TELEGRAM_SESSION` | 3번에서 복사한 세션 문자열 |

3. 등록 후 **Actions** 탭 → **Briefing pipeline** → **Run workflow** 로 수동 실행해 테스트할 수 있습니다.

---

## 5. 저장소를 public으로 유지하는 방법 — 4번 질문 답변

기획서는 private를 권장했지만, **public으로도 안전하게 운영할 수 있습니다.** 핵심 사실:

- **세션·API 키는 public이어도 유출되지 않습니다.** GitHub Secrets는 암호화 저장되고,
  로그에 나와도 자동 마스킹되며, 외부인이 올린 Pull Request 워크플로에는 Secrets가 전달되지 않습니다.
  예약(schedule)·수동(dispatch) 실행은 **내 기본 브랜치의 워크플로 파일**만 돌기 때문에 남이 빼갈 수 없습니다.
- public에서 실제로 공개되는 것은 **커밋되는 파일**뿐입니다:
  `channels.json`(내가 보는 채널 목록)과 `data/briefing.json` + 그 커밋 히스토리(메시지 발췌).

### public 유지 시 권장 대책 (이미 적용해둠)

1. **`BRIEFING_PUBLIC_SAFE=1`** — 워크플로에 기본 적용되어 있습니다.
   → `briefing.json`에 **요약 하이라이트 문장만** 남기고, "채널별 전체 보기"용 **원문 전체 아카이브는 커밋에서 제외**합니다.
   (즉 전체 메시지가 git 히스토리에 영구 저장되는 일이 없습니다. 대신 대시보드의 "채널별 전체 보기" 목록은 비게 됩니다.)
   원문 아카이브까지 보고 싶고 private로 바꿀 거라면 `.github/workflows/briefing.yml`에서 이 값을 `"0"`으로 바꾸세요.
2. **공개 브로드캐스트 채널만 모니터링** — 어차피 누구나 볼 수 있는 채널이면 발췌 공개도 새로운 노출이 아닙니다.
   비공개/민감 채널을 넣을 거라면 그때는 private를 쓰세요.
3. **채널 목록을 숨기고 싶다면** → private가 확실합니다. (`gh repo edit cookiee0409/Full_dashboard --visibility private --accept-visibility-change-consequences`)

### 덤: public이 오히려 유리한 점
- GitHub Actions 실행 시간이 **public 저장소는 무제한 무료**입니다(private는 월 2,000분).

---

## 6. channels.json / prompt_sources.json 채우기 — 5번 질문 답변

수집기가 "어디를" 볼지 알려주는 설정 파일입니다. 지금은 예시값이라 실제 값으로 교체해야 데이터가 찹니다.

### `briefing/config/channels.json` — 볼 텔레그램 채널 목록

```json
{
  "channels": [
    { "username": "durov", "label": "채널 표시이름", "category": "crypto",
      "exclude_keywords": ["광고", "구독", "제휴 문의"] },
    { "username": "some_ai_channel", "label": "AI 영상 채널", "category": "ai_video",
      "exclude_keywords": ["광고"] }
  ]
}
```

- **username**: 채널 링크 `https://t.me/durov` 에서 `durov` 부분(맨 뒤 이름). `@`는 빼고 적습니다.
- **label**: 대시보드에 표시될 이름 (자유롭게).
- **category**: `crypto`(브리핑·밈·키워드용) 또는 `ai_video`(영상 프롬프트 카드용).
- **exclude_keywords**: 이 단어가 들어간 메시지는 광고로 보고 건너뜁니다.
- 채널을 찾는 법: 텔레그램에서 해당 채널을 열면 상단/정보에 `t.me/이름` 링크가 있습니다. 그 `이름`이 username.
- **수집 계정이 그 채널에 가입(구독)되어 있어야** 안전하게 읽힙니다. 보조 계정으로 볼 채널들을 미리 구독해두세요.
- 초대링크만 있는 비공개 채널(`t.me/+...`)은 공개 username이 없어 이 방식으로는 어렵습니다. 공개 채널부터 시작하세요.

### `briefing/config/prompt_sources.json` — 영상 프롬프트 소스

```json
{
  "subreddits": ["aivideo", "StableDiffusion", "runwayml"],
  "title_keywords": ["prompt", "veo", "sora", "workflow", "comfyui"]
}
```

- **subreddits**: 레딧 주소 `reddit.com/r/aivideo` 에서 `aivideo` 부분만 적습니다. (이미 합리적 기본값이 들어있음)
- **title_keywords**: 제목에 이 단어가 든 글만 가져옵니다. 비우면 전체를 가져옵니다.

### (참고) `briefing/config/memecoin_filter.json` — 밈 티커 오탐 관리

- **blacklist**: 밈으로 세지 않을 티커(BTC·ETH 등 주요 코인, 일반 영어단어). 이미 채워져 있음.
- **whitelist**: 블랙리스트에 있더라도 강제로 포함할 티커.
- 운영하다 엉뚱한 단어가 밈으로 잡히면 blacklist에 추가하세요.

---

## 7. 실행

- 설정을 마치면 **Actions 탭 → Briefing pipeline → Run workflow** 로 한 번 수동 실행해 결과를 확인하세요.
- 성공하면 `data/*.json`이 자동 커밋되고, Vercel이 재배포하며, 대시보드 카드에 데이터가 채워집니다.
- 이후에는 하루 3회(06:30/12:30/18:30 KST) 자동 실행됩니다. (최대 15분 안팎 지연 가능)
