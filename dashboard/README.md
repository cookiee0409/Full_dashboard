# Interest Hub — Economy Edition

외부 시세와 RSS는 브라우저 CORS 제한을 피하기 위해 로컬 프록시 서버를 통해 가져옵니다.

```powershell
cd C:\Users\USER\Desktop\Code\Full\dashboard
python server.py
```

브라우저에서 `http://127.0.0.1:8787`을 여세요. Python 표준 라이브러리만 사용하므로 별도 설치는 없습니다.

- CoinGecko: 밈코인·크립토 순위, 체인별 밈코인 목록
- Alternative.me: 공포·탐욕 지수
- Yahoo Finance: 주요 지수·환율·개별 주식
- Google News RSS: 국문 경제·코인·세계정세 뉴스

기본 관심 종목은 삼성전자·SK하이닉스·현대차·코스피·코스닥과 나스닥·애플·마이크로소프트·엔비디아·마이크론·테슬라입니다. 설정에서 종목 이름으로 검색해 추가할 수 있으며, 관심 종목·테마·등락 색상은 브라우저 `localStorage`에 저장됩니다.

공모주 캘린더는 현재 범위에서 제외했습니다.
