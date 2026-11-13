# 플랫폼 재구성 브랜치로 전환하기

> 대상: `E:\Project\apps\sepoa-agent` · 새 브랜치 `platform/restructure` (커밋 5개, `refactor/restructure` 위에 쌓임)
> GitHub 계정이 Claude 에 연결돼 있지 않아 푸시 대신 번들 파일(`platform-restructure.bundle`)로 전달했다.

## 1. 준비 — 실행 중인 서버를 모두 끈다

- 게이트웨이·Java·Node 터미널에서 Ctrl+C.
- **VS Code 를 닫거나 폴더를 닫는다.** Java 언어 서버가 `quote_automation\target` 을 잡고 있으면 폴더 이동이 실패한다.
  아래 명령은 일반 PowerShell 창에서 실행한다.

## 2. 브랜치 받기

```powershell
cd E:\Project\apps\sepoa-agent
git status                                    # 커밋 안 된 변경이 없어야 한다 (미추적 .md 파일은 괜찮다)
git fetch .\platform-restructure.bundle platform/restructure:platform/restructure
git switch platform/restructure
git log --oneline -6                          # 맨 위 5fe2ef2 docs(platform): ...
```

## 3. 미추적 파일 옮기기 (.env · node_modules · target · 개인 작업 파일)

git 은 추적 파일만 옮긴다. `.env` 같은 파일은 옛 폴더(`quote\`, `quote_automation\`, `blog-automation\`)에 남으므로 스크립트로 옮긴다.

```powershell
.\migrate-to-platform.ps1 -WhatIf              # 무엇을 옮길지 먼저 확인
.\migrate-to-platform.ps1                      # 실제 이동 (덮어쓰기·삭제 없음, 빈 옛 폴더만 정리)
```

## 4. 확인

```powershell
cd apps\quote\tools; npm install; cd ..\..\..   # 견적 DB 도구용 (최초 1회)
.\dev.ps1 -Only quote,quote2                    # 견적 Node + Java + 게이트웨이가 각각 새 창으로 뜬다
```

| 확인 | 기대 |
|---|---|
| http://localhost:8080/ | 업무 목록 표, 견적자동화·견적자동화(Java) **실행중** |
| http://localhost:8080/quote/ | 기존 견적 화면 그대로 |
| http://localhost:8080/quote2/api/health | `"status":"UP","db":"UP"` |
| `cd apps\quote; .\mvnw.cmd test` (DB 환경변수 넣은 터미널) | **50 통과** — 픽스처 경로가 바뀌었으므로 반드시 확인 |
| `cd apps\quote-legacy; npm test` | 70 통과 |

AI 엔진까지 띄우려면 uv 설치 후 `cd platform\ai-engine; uv sync; copy .env.example .env` 를 한 번 하고 `.\dev.ps1`.

## 5. GitHub 에 올리기

레포가 **public** 이라 새 문서(아키텍처·로드맵)까지 공개된다. 가능하면 먼저 private 으로 전환한 뒤:

```powershell
git push -u origin platform/restructure
```

## 무엇이 바뀌었나

| 커밋 | 내용 |
|---|---|
| `da196af` | 폴더 이동만 — `apps/quote`(Java) · `apps/quote-legacy`(Node) · `apps/quote/tools` · `apps/blog` · `platform/gateway` |
| `fe1b900` | 상대 경로 수정 (pom 픽스처, Java `.env`, 도구 22개) |
| `ccf3234` | 게이트웨이: 앱을 한 프로세스에 넣던 방식 → `platform/ports.json` 기반 경로 프록시 (의존성 0) |
| `596449a` | Python AI 엔진 골격 `platform/ai-engine` (작업 계약·토큰·LLM 계층, ready 2 / planned 13) |
| `5fe2ef2` | `docs/ARCHITECTURE.md` · `STANDARDS.md` · `ROADMAP.md`, `dev.ps1`, README |

클라우드에서 확인한 것: 견적 Node 테스트(DB 필요 1건 제외 60/60), 게이트웨이 테스트 4종 + 실제 프록시 스모크,
AI 엔진 테스트 10종 + uvicorn 기동. **Java 빌드와 PowerShell 스크립트는 여기서 실행할 수 없어 PC 확인이 필요하다.**
