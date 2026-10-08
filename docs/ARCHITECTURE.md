# 사내 업무 플랫폼 아키텍처

> 결정일 2026-10-08 · 정본. 구조를 바꾸는 결정은 이 문서를 먼저 고친다.

세포아소프트 내부 업무(견적자동화·블로그작성·일일업무관리, 이후 추가 업무)를 하나의 플랫폼에서 운영한다.
**업무 시스템은 Java, AI 판단·생성은 Python** 으로 역할을 나눈다.

---

## 1. 전체 구조

```
직원 브라우저
     │  http://<서버>:8080/<업무경로>/
     ▼
┌──────────────────────── platform/gateway (:8080) ────────────────────────┐
│ 경로별 프록시 · (예정) Google SSO 1회 로그인 · 사용자 헤더 전달          │
└──────┬──────────────────┬───────────────────┬────────────────────────────┘
   /quote            /blog               /work                 /(다음 업무)
       ▼                  ▼                   ▼
 apps/quote :3200    apps/blog :34xx     apps/daily-work :3300     Java 업무 앱
 (Spring Boot)       (Spring Boot)       (Spring Boot)             화면·데이터·권한·흐름
       └──────────────────┴───────────┬───────┘
                                      │ 내부 HTTP (X-Internal-Token) — 외부 비노출
                                      ▼
                       platform/ai-engine :8100 (Python FastAPI)
                       LLM 판단·채점·초안 생성·가드레일
                                      │
                                      ▼
                               Anthropic API

공통 DB: MariaDB — 업무별 테이블 접두어 (sq_ 견적, bl_ 블로그, dw_ 일일업무, pf_ 플랫폼 공통)
외부 연동: 그룹웨어 Oracle(읽기 전용) — Java 일일업무 앱이 담당
```

현재(전환 중) 상태는 6장.

## 2. 역할 분담 — Java 업무 / Python AI 엔진

| | **Java 업무 앱** (`apps/*`) | **Python AI 엔진** (`platform/ai-engine`) |
|---|---|---|
| 한 줄 | 무엇을, 누가, 언제 | 판단하고 써 주기 |
| 화면 | 전부 | **없음** |
| 로그인·권한 | 게이트웨이가 넘긴 사용자로 판단 | 없음. 내부 토큰을 가진 업무 앱만 호출 |
| 업무 데이터 | **주인.** 저장·수정·이력 | 저장하지 않는다. 필요한 데이터는 요청에 담겨 온다 |
| 외부 연동 | 그룹웨어 Oracle, 메일 발송, PDF·Excel | Anthropic API 만 |
| 사람 승인 | 승인 화면·발송 통제 | 초안만 만든다. 스스로 발송·저장하지 않는다 |
| 비용 기록 | 응답의 사용량을 자기 DB 에 저장 | 사용량을 응답·로그로 돌려줌 |

**경계 규칙** — 이 둘을 어기면 Python 쪽에 업무 시스템이 다시 자란다.

1. AI 엔진에 화면·로그인·업무 테이블을 만들지 않는다.
2. AI 엔진은 DB 에 쓰지 않는다. (읽기가 꼭 필요하면 ARCHITECTURE 를 고치고 사유를 남긴다)
3. 브라우저가 AI 엔진을 직접 부르지 않는다. 항상 Java 업무 앱을 거친다.
4. 모델 호출은 AI 엔진 안에서만 한다. Java 에서 Anthropic API 를 직접 부르지 않는다.

## 3. 기술 스택 표준

| 영역 | 표준 | 비고 |
|---|---|---|
| 업무 앱 | **Java 17 · Spring Boot 3.x · Maven(Wrapper) · JdbcTemplate · Flyway** | 견적 앱(`apps/quote`)이 기준 템플릿 |
| 업무 앱 실행 | **내장 Tomcat, 실행 JAR, 앱마다 독립 포트** | 외부 Tomcat WAR 는 쓰지 않는다 (아래) |
| 화면 | 서버 정적 리소스 + 바닐라 ES Module, SingleSuite 디자인 토큰 | 빌드 도구 없음. PDF 는 Thymeleaf |
| AI 엔진 | **Python 3.12 · FastAPI · Uvicorn · uv** | Anthropic SDK |
| DB | MariaDB, 업무별 테이블 접두어 | 공통 테이블 `pf_` |
| 게이트웨이 | 개발: Node 내장 http (`platform/gateway`) / 운영: nginx 또는 동일 게이트웨이 | 규칙은 `platform/ports.json` 하나 |
| CI/CD | Jenkins — 바뀐 폴더만 빌드 | `apps/<업무>/**`, `platform/**` 경로 필터 |

**실행 JAR 을 택한 이유** — 외부 Tomcat 하나에 WAR 여럿을 올리면 모든 업무가 한 프로세스·한 포트를
나눠 써서, 한 업무 재배포가 다른 업무에 영향을 준다. JAR 은 Tomcat 버전(9 javax / 10.1 jakarta)
문제도 없앤다. 서버에서는 Windows 서비스 또는 systemd 로 등록한다.
(견적 앱 `pom.xml` 의 `packaging war` 는 J9 에서 `jar` 로 바꾼다 — ROADMAP 1단계)

## 4. 저장소 구조

```
sepoa-agent/
├─ platform/
│   ├─ ports.json          업무 목록·포트·경로·기동 명령 (단일 출처)
│   ├─ gateway/            경로 프록시 (의존성 0)
│   └─ ai-engine/          Python AI 엔진
├─ apps/
│   ├─ quote/              견적자동화 — Java (주력) + tools/(DB·대조 도구)
│   ├─ quote-legacy/       견적자동화 — Node 참조 구현. J7 후 삭제
│   ├─ blog/               블로그작성 — 현행 Node 콘솔 + Claude Code 하네스. Java 이식 예정
│   └─ daily-work/         일일업무관리 — Java 이식 예정 (현행 Python 은 별도 레포 work_agent)
├─ docs/                   플랫폼 문서 (이 문서 · STANDARDS · ROADMAP)
├─ dev.ps1                 개발용 전체 기동
└─ README.md
```

- 업무 앱끼리 코드를 참조하지 않는다. 공유가 필요하면 `platform/` 으로 올린다.
- 업무별 문서(WBS·진행상태)는 각 앱의 `docs/` 에 둔다.

## 5. 포트·경로

| 대상 | 경로 | 포트 | 스택 |
|---|---|---|---|
| 게이트웨이 | `/` | 8080 | Node |
| 견적자동화 (Node, 전환 전) | `/quote` | 3100 | Node |
| 견적자동화 (Java) | `/quote2` → J9 후 `/quote` | 3200 | Java |
| 일일업무관리 | `/work` | 3300 | Java (예정) |
| 블로그작성 | `/blog` | 4317 → 이식 후 3400 | Node → Java |
| AI 엔진 | (비노출) | 8100 | Python |

규칙: Java 업무 앱은 `3x00` 대역을 100 단위로 배정한다. 내부 서비스는 `81xx`.
실제 값의 정본은 `platform/ports.json` 이다.

## 6. 현재 상태 (2026-10-08)

| 대상 | 상태 |
|---|---|
| 게이트웨이 | 경로 프록시로 재작성 완료. SSO 미적용 |
| AI 엔진 | 골격 완료. ready 2 / planned 13 |
| 견적 | Java 이식 J4 완료, J5~J9 남음. Node 버전이 `/quote` 로 운영 중 |
| 블로그 | Node 콘솔이 직원 PC 의 Claude Code 를 실행. 이식 전 |
| 일일업무 | 별도 레포 `work_agent` (Python FastAPI :8000, 자체 로그인) 로 운영. 이식 전 |

## 7. 결정 기록

| 일자 | 결정 | 사유 |
|---|---|---|
| 2026-08-02 | 견적 서버 Java/Spring Boot 이식 | 사내 표준 정합 |
| 2026-10-08 | 업무 앱은 앱마다 독립 포트, 게이트웨이는 경로 프록시만 | 스택 혼재·독립 배포 |
| 2026-10-08 | **Java 업무 + Python AI 엔진** 구성 | 업무 시스템은 사내 표준으로 통일, AI 는 Python 생태계·프롬프트 실험 속도 활용 |
| 2026-10-08 | 블로그·일일업무를 Java 업무 앱 + AI 엔진 작업으로 이식 | 위 구성 적용 |
| 2026-10-08 | Java 업무 앱은 실행 JAR (내장 Tomcat) | 업무 간 격리, Tomcat 버전 문제 회피 |
