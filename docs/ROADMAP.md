# 플랫폼 로드맵

> 2026-10-08 수립. 순서: 기반 → 견적 → 블로그 → 일일업무. 한 번에 한 업무씩.
> 각 단계는 완료기준(DoD) 확인 후 다음으로 넘어간다.

| 단계 | 내용 | 기간(추정) | 상태 |
|---|---|---|---|
| **0** | 플랫폼 기반 — 폴더 재구성, 게이트웨이 경로 프록시, ports.json, AI 엔진 골격, 표준 문서 | 1주 | **완료 (2026-10-08)** |
| **1** | 견적 Java 이식 J5~J9 | 약 5주 | 다음 |
| **2** | 블로그 — Java 업무 앱 + AI 엔진 `blog.*` 작업 | 3~5주 | 대기 |
| **3** | 일일업무 — Java 업무 앱 + AI 엔진 `daily_work.*` 작업 | 3~4개월 | 대기 |
| **4** | 공통 인증·포털 — 게이트웨이 SSO, `pf_user_roles`, 업무 메뉴 | 2~3주 | 2단계와 병행 가능 |

---

## 0단계 — 플랫폼 기반 (완료)

- [x] `quote_automation/` → `apps/quote/`, `quote/` → `apps/quote-legacy/`, `tools/` → `apps/quote/tools/`, `blog-automation/` → `apps/blog/`
- [x] 게이트웨이: 앱 mount 방식 폐기 → `ports.json` 기반 경로 프록시 (테스트 4종)
- [x] AI 엔진 골격: 작업 계약·토큰·LLM 계층·planned 작업 13종 (테스트 10종)
- [x] ARCHITECTURE · STANDARDS · ROADMAP, `dev.ps1`
- [ ] PC 에서 확인: 견적 Java `mvnw test` 50/50, Node `npm test`, 게이트웨이 경유 화면

## 1단계 — 견적 J5~J9

정본: `apps/quote-legacy/docs/WBS-java.md`. 플랫폼 결정에 따라 아래를 조정한다.

| J | 원래 계획 | 조정 |
|---|---|---|
| J5 | API 39개 | 변경 없음 |
| J6 | 프론트 이관, `api.js` 만 수정 | 변경 없음 |
| J7 | PDF·Excel | 변경 없음 |
| J8 | Spring Security OAuth2 (Google) | **과도기 구현**: 앱 자체 Google SSO 로 우선 동작시키되, 사용자 식별을 `CurrentUser` 한 곳으로 모아 4단계에서 `X-Auth-*` 헤더 방식으로 바꿀 때 한 파일만 고치게 한다 |
| J9 | WAR → 외부 Tomcat | **실행 JAR + 서비스 등록**으로 변경 (`packaging jar`). 게이트웨이 `ports.json` 에서 `/quote` 를 3200 으로 전환, Node 앱은 롤백용으로 `enabled:false` 보관 |

DoD: 영업팀이 `/quote` 로 Java 앱을 쓰고, 실측 20종·PDF 3종 대조 통과.

## 2단계 — 블로그

현행: `apps/blog/web-console`(Node) 가 직원 PC 에서 `claude -p` 로 `apps/blog/backend` 하네스를 실행.

| 대상 | 이식 후 |
|---|---|
| 화면·작업 이력·STOP 3곳 승인 | **Java** `apps/blog` (Spring Boot, `/blog`, :3400) |
| 제목·키워드·본문·이미지 프롬프트·검증 | **AI 엔진** `blog.suggest_titles` · `blog.suggest_keywords` · `blog.write_draft` · `blog.image_prompts` · `blog.evaluate` |
| 규칙 문서 (CLAUDE.md·DESIGN.md·스킬) | AI 엔진이 프롬프트 자료로 읽는다 (`platform/ai-engine/prompts/blog/`) |
| 워드(.docx) 원문 읽기 | Java (Apache POI) — 텍스트만 AI 엔진에 넘긴다 |
| 초안·이미지 파일 | Java 앱이 저장 (`bl_` 테이블 + 파일 저장소) |

결과: 직원 PC 의 Claude Code 로그인 의존이 사라지고 서버 운영이 가능해진다.
DoD: 기존 하네스로 만든 글 3건과 같은 입력으로 품질 비교 → 마케팅 확인.

## 3단계 — 일일업무

현행: `E:\Project\apps\work_agent` (Python FastAPI :8000, 자체 로그인, 테스트 55파일).

| 대상 | 이식 후 | 원본 |
|---|---|---|
| 화면 30여 개, 로그인, 사원정보·대상자 지정 | **Java** `apps/daily-work` | `web/`, `auth/`, `core/employees.py` |
| 그룹웨어 수집(Oracle), 휴가·공휴일·영업일 | **Java** | `integrations/oracle.py`, `leave_oracle.py`, `core/holidays.py`, `calendar.py` |
| 수집 이력·저장 (`dw_` 테이블) | **Java** + Flyway | `db/models.py`, `alembic` |
| 승인 → 메일 발송, 발송이력 | **Java** | `integrations/mailer.py`, `modules/history/` |
| 1차 규칙 탐지 (결정적 규칙) | **Java** | `modules/daily_work/detection_rules.md`, `modules/diag/rules` 계열 |
| 품질 채점·이상 판단·업무량·피드백/리포트 초안·가드레일·질의응답 | **AI 엔진** `daily_work.*` 8종 | `modules/diag/{judge,scoring,rubric}`, `core/{llm,guardrails}`, `modules/chat/` |

진행 방식 (견적 이식에서 검증된 방식):

1. **테스트 먼저** — pytest 55파일 중 업무 규칙 테스트를 픽스처(JSON)로 분리해 Java·Python 이 함께 읽게 한다.
2. **AI 작업부터 이관** — AI 엔진 `daily_work.*` 를 work_agent 코드로 채운다. 이 단계에서 work_agent 가 AI 엔진을 부르도록 바꾸면 운영 중에 검증된다.
3. Java 앱을 모듈 단위로 이식 (인증·사원 → 수집 → 탐지 → 승인·발송 → 화면) 하며 Python 과 병행 대조.
4. 전환 후 work_agent 는 읽기 전용 보관.

**work_agent 의 기능 개발** — 화면·수집·발송 쪽은 이식 착수 시점부터 동결(긴급 수정만).
AI 판단 쪽(프롬프트·루브릭)은 AI 엔진으로 옮긴 뒤 계속 개선한다.

## 4단계 — 공통 인증·포털

- 게이트웨이에 Google Workspace SSO (도메인 `sepoasoft.co.kr`), 세션 1회.
- `pf_users`(사원 원천: 그룹웨어 사원정보), `pf_user_roles(email, app, role)`.
- 업무 앱에 `X-Auth-User-*` 헤더 전달 (STANDARDS 3장), 업무 앱 포트는 외부 차단.
- 게이트웨이 홈을 포털로: 권한 있는 업무만 메뉴에 표시.
- 블로그는 이 단계부터 로그인이 생긴다.

## 선결 과제

| 항목 | 필요 시점 | 상태 |
|---|---|---|
| GitHub 레포 private 전환 (현재 public — 견적 정가·고객사 실명 노출) | **즉시** | 미결 |
| 운영 서버 결정 (대수·OS, 서비스 등록 방식) | 1단계 J9 | 미정 |
| Anthropic API 키 (AI 엔진 운영용) | 2단계 | 미정 |
| 그룹웨어 Oracle 접속 정보의 Java 이관 | 3단계 | 미정 |
