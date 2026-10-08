# sepoa-agent — 세포아 사내 업무 플랫폼

세포아소프트 내부 업무를 시스템화하는 플랫폼. **업무 시스템은 Java(Spring Boot), AI 판단·생성은 Python AI 엔진**으로 나눈다.
업무가 늘 때마다 `apps/` 에 하나씩 더한다.

| 업무 | 부서 | 경로 | 위치 | 상태 |
|---|---|---|---|---|
| 견적자동화 | 영업 | `/quote` | `apps/quote` (Java) · `apps/quote-legacy` (Node, 운영 중) | Java 이식 J5~J9 진행 |
| 블로그작성 | 마케팅 | `/blog` | `apps/blog` (Node + Claude Code 하네스) | Java 이식 예정 |
| 일일업무관리 | 경영지원 | `/work` | `apps/daily-work` (예정) · 현행 별도 레포 `work_agent` | Java 이식 예정 |
| AI 엔진 | (내부) | 비노출 | `platform/ai-engine` (Python) | 골격 |

## 문서

| 문서 | 내용 |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 전체 구조, Java/Python 역할 분담, 스택 표준, 포트표, 결정 기록 |
| [docs/STANDARDS.md](docs/STANDARDS.md) | 업무 앱이 지킬 계약 (경로·health·인증·DB·오류), 새 업무 추가 절차 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 단계별 계획 (기반 → 견적 → 블로그 → 일일업무 → 공통 인증) |
| `platform/ports.json` | 업무 목록·포트·경로·기동 명령의 단일 출처 |

## 개발 환경 기동 (Windows)

```powershell
.\dev.ps1                 # ports.json 의 활성 업무 + AI 엔진 + 게이트웨이를 각각 새 창으로 기동
.\dev.ps1 -Only quote2    # 일부만 (게이트웨이는 항상 기동)
.\dev.ps1 -List           # 기동하지 않고 목록만
```

→ http://localhost:8080/ 에서 업무 목록과 실행 상태를 본다.

최초 1회 준비:

| 대상 | 명령 |
|---|---|
| 견적 Node | `cd apps\quote-legacy; npm install` · `.env` 필요 |
| 견적 Java | JDK 17. `.env` 는 `apps/quote/.env` 또는 `apps/quote-legacy/.env` |
| 견적 도구 | `cd apps\quote\tools; npm install` |
| 블로그 | `cd apps\blog\web-console; npm install` · `.env` |
| AI 엔진 | `cd platform\ai-engine; uv sync; copy .env.example .env` |
| 게이트웨이 | 설치 없음 (의존성 0) |

## 저장소 구조

```
platform/  ports.json · gateway/ · ai-engine/
apps/      quote/ · quote-legacy/ · blog/ · daily-work/
docs/      ARCHITECTURE · STANDARDS · ROADMAP
dev.ps1
```
