# apps/daily-work — 일일업무관리 (경영지원)

**Java 이식 예정 자리.** 아직 코드는 없다 (ROADMAP 3단계).

- 현행 운영: 별도 레포 `work_agent` (`E:\Project\apps\work_agent`) — Python FastAPI, 포트 8000, 자체 로그인.
- 이식 후: 이 폴더의 Spring Boot 앱(`/work`, 포트 3300)이 화면·수집·승인·발송을 맡고,
  채점·판단·초안 생성은 AI 엔진의 `daily_work.*` 작업이 맡는다.
- 역할 분담표와 진행 방식: `docs/ROADMAP.md` 3단계.
- `platform/ports.json` 에 `enabled: false` 로 등록돼 있다. 앱이 생기면 `true` 로 바꾼다.
