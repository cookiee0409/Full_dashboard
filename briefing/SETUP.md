# 모닝 브리핑 파이프라인 설정 가이드 (공개 채널 방식)

이 파이프라인은 **공개 텔레그램 채널의 웹 페이지(`t.me/s/<채널>`)를 긁어오는 방식**입니다.
따라서 **API 키·로그인·세션 문자열·GitHub Secrets가 전혀 필요 없습니다.** 준비물은 딱 하나 —
**볼 채널들의 username 목록**뿐입니다. 설정해두면 GitHub Actions가 하루 3회
(06:30/12:30/18:30 KST) 자동으로 수집합니다.

---

## 1. 준비물: 공개 채널 username 목록뿐

- 이 방식은 **공개 채널만** 됩니다. 확인법: 브라우저 주소창에 `https://t.me/s/<채널이름>` 을 쳤을 때
  **최근 글 목록이 그대로 보이면 공개 채널**입니다. (아무것도 안 보이거나 앱으로 튕기면 비공개 → 이 방식 불가)
- 채널의 username 찾는 법: 텔레그램에서 채널을 열면 링크가 `t.me/durov` 형태입니다. 뒤의 `durov`가 username(앞의 `@`는 뺍니다).
- 로그인·구독 여부와 무관하게 공개 페이지만 읽으므로, **당신 계정은 전혀 관여하지 않습니다.**

> 비공개(초대링크 전용) 채널을 꼭 넣어야 한다면 그 채널만은 로그인 세션 방식이 필요합니다.
> 그런 경우가 생기면 알려주세요 — 공개 채널은 이 방식, 비공개만 별도 처리하는 하이브리드로 확장할 수 있습니다.

---

## 2. `briefing/config/channels.json` 채우기 — 이게 핵심 설정

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

- **username**: `t.me/durov` 의 `durov` 부분 (`@` 제외).
- **label**: 대시보드에 표시될 이름 (자유).
- **category**:
  - `crypto` → 텔레그램 브리핑·언급 밈코인·키워드 카드에 사용
  - `ai_video` → 영상 프롬프트 카드에 사용
- **exclude_keywords**: 이 단어가 들어간 메시지는 광고로 보고 건너뜁니다. (링크만 있는 메시지는 자동 제외)

여러 채널을 넣으려면 `channels` 배열에 객체를 계속 추가하면 됩니다.

---

## 3. (선택) 영상 프롬프트 소스 — `briefing/config/prompt_sources.json`

```json
{
  "subreddits": ["aivideo", "StableDiffusion", "runwayml"],
  "title_keywords": ["prompt", "veo", "sora", "workflow", "comfyui"]
}
```

- **subreddits**: 레딧 `reddit.com/r/aivideo` 의 `aivideo` 부분만. (이미 합리적 기본값 있음)
- **title_keywords**: 제목에 이 단어가 든 글만 가져옵니다. 비우면 전체.

## (참고) 밈 티커 오탐 관리 — `briefing/config/memecoin_filter.json`

- **blacklist**: 밈으로 세지 않을 티커(BTC·ETH 등, 이미 채워져 있음).
- **whitelist**: 블랙리스트에 있어도 강제 포함할 티커.
- 엉뚱한 단어가 밈으로 잡히면 blacklist에 추가하세요.

---

## 4. 실행

1. 위 `channels.json`을 실제 채널로 교체해 커밋(push)합니다.
2. GitHub 저장소 → **Actions** 탭 → **Briefing pipeline** → **Run workflow** 로 수동 실행해 테스트.
3. 성공하면 `data/*.json`이 자동 커밋되고, Vercel이 재배포하며, 대시보드 카드가 채워집니다.
4. 이후 하루 3회(06:30/12:30/18:30 KST) 자동 실행됩니다. (최대 15분 안팎 지연 가능)

> 뉴스 기반 카드("오늘의 키워드")는 채널 설정과 무관하게 구글뉴스에서 바로 수집되므로,
> channels.json을 비워두거나 예시 그대로 둬도 키워드 카드는 채워집니다.

---

## 참고: 동작·한계

- **자격증명 0개** — API 키, 세션, 시크릿 전부 불필요. 표준 라이브러리(urllib)만 사용.
- **public 저장소로 운영해도 안전** — 남길 데이터가 애초에 공개 채널의 공개 글이라 새로운 노출이 없습니다.
  (원문 아카이브를 git 히스토리에 남기고 싶지 않으면 `.github/workflows/briefing.yml`의
  `BRIEFING_PUBLIC_SAFE`를 `"1"`로 바꾸세요 — 요약 하이라이트만 남고 "채널별 전체 보기"는 비게 됩니다.)
- **최근 글 위주** — 공개 페이지는 채널당 최근 약 20개만 노출합니다. 하루 3회 실행 사이에
  한 채널이 20개 넘게 올리면 일부는 놓칠 수 있습니다(대부분의 채널엔 충분).
- **증분 수집** — `data/state.json`에 채널별 마지막 메시지 ID를 기록해, 다음 실행 때 새 글만 가져옵니다.
