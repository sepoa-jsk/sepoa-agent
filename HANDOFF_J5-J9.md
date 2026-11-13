# 견적 자동화 — VS Code 이어받기 가이드 (J5~J9)

> 작성 2026-10-08 · 범위: Java 이식 J5~J9 (현재 기능 동등 이식 + 배포)
> 정본 문서는 레포 안 `apps/quote-legacy/docs/WBS-java.md`, `apps/quote-legacy/docs/PROGRESS.md`. 이 파일은 시작 안내용이다.

> **2026-10-08 갱신 — 플랫폼 재구성 반영.** 작업 브랜치는 `platform/restructure`. 경로가 바뀌었다:
> `quote_automation/` → `apps/quote/` · `quote/` → `apps/quote-legacy/` · `tools/` → `apps/quote/tools/` · 게이트웨이 → `platform/gateway/`.
> J8 은 과도기 구현(사용자 식별을 한 곳에 모을 것), J9 는 WAR 대신 **실행 JAR** — `docs/ROADMAP.md` 1단계.
> 브랜치 받는 법은 `PLATFORM_전환안내.md`.

---

## 0. 현재 상태

- 견적 Java(`apps/quote/`): **J1~J4 완료** (스캐폴딩 · 픽스처 20종 · 계산엔진 · Flyway V1 baseline · 조회 Repository, JUnit 50종)
- 견적 Node(`apps/quote-legacy/`): STEP 3 까지, 동결 태그 `v-node-final`. 운영 화면은 아직 이쪽
- 남은 것: **J5 API → J6 프론트 → J7 PDF/Excel → J8 인증 → J9 실행 JAR·전환**

---

## 1. 실행·기준선 확인

```powershell
cd E:\Project\apps\sepoa-agent
.\dev.ps1 -Only quote,quote2          # 견적 Node(3100) + Java(3200) + 게이트웨이(8080)
# → http://localhost:8080/ 에서 상태 확인

cd apps\quote-legacy; npm test       # 기준선 70 (DB 접속 필요 테스트 포함)
cd ..\quote; .\mvnw.cmd test         # 기준선 50 (DB 환경변수 넣은 터미널에서)
```

- Java 는 `apps/quote/.env` 가 있으면 그것을, 없으면 `apps/quote-legacy/.env` 를 읽는다.
- JDK 17 기준. **JDK 25 업그레이드 도구(appmod)는 실행하지 말 것** — 8/3 미커밋 파일 소실 사고 (PROGRESS.md "사건" 절).

---

## 2. J5~J9 작업 순서와 완료 기준

| 단계 | 할 일 | 완료 기준(DoD) | 꼭 챙길 것 |
|---|---|---|---|
| **J5** API 컨트롤러 | Node 라우트 39개를 `@RestController`+DTO로. 경로·JSON 형태 그대로 유지. `QuoteWriteSql` 실제 연결. `POST /api/quotes/preview` 포함 | Node `/quote` vs Java `/quote2` 응답 동일 (`apps/quote/tools/compare-queries.js` 재사용) | 이슈 #18: GET 결과를 그대로 PUT 하면 500 (`solution` 헤더 미노출) — 여기서 해결. 오류 응답 형태도 Node와 동일하게 |
| **J6** 프론트 이관 | `apps/quote-legacy/public/` → `src/main/resources/static/` 복사 | **수정 파일은 `api.js` 하나** (`BASE='/quote'` 고정 해소) | 두 개 이상 고쳐야 하면 J5 응답이 어긋난 것. 화면 9종 육안 확인 |
| **J7** PDF·Excel | `render/html.js` → Thymeleaf, `ChromeRunner`(ProcessBuilder, `CHROME_PATH`), exceljs → POI | 실측 3종 PDF가 `docs/baseline-pdf/` 와 금액·페이지수·이미지 4개 일치 + 한글 육안 확인 | 레이아웃 새로 만들지 말 것. 이미지 base64 실패는 **예외로** (Node `dataUri()` 무음 실패 반복 금지). 폰트에 `Noto Sans CJK KR`. 기준선 견적 44·45·46 삭제 금지 |
| **J8** 인증·세션 | Spring Security OAuth2(Google), 도메인 `sepoasoft.co.kr` 제한, Spring Session JDBC | Google 로그인 + 세션 유지, HTTPS 뒤에서도 동일 | dev 우회 로그인을 prod 프로파일에 남기지 말 것 |
| **J9** 배포·전환 | `Jenkinsfile` (빌드 → JUnit 게이트 → WAR → Tomcat), 게이트웨이 `/quote` 를 Java로 전환, `docs/DEPLOY.md` | Jenkins 완주 + 영업팀 경로로 Java 응답 | Flyway 자동 실행 금지(수동 승인). WAR 안에 `tomcat-embed-*` 없어야 함. Node 앱은 롤백용으로 유지 |

**전 단계 공통 규칙** (`apps/quote-legacy/CLAUDE.md`, `WBS-java.md` §6)
- 실측 20종 회귀 테스트는 절대 깨뜨리지 않는다. 기대값 수정 금지.
- 개발 DB(`test_01`)는 Node 앱과 공유 중 — **Java 쪽에서 스키마 변경 금지.**
- 한 단계 = 한 커밋, DoD 확인 후 `PROGRESS.md` 진행표 갱신.
- SQL은 Node 문자열 그대로 옮기고 바인딩·RowMapper만 추가 ("개선" 금지 — 대조 불가해짐).

---

## 3. VS Code의 Claude Code에 붙여넣을 시작 프롬프트

```
sepoa-agent 레포의 platform/restructure 브랜치에서 견적 자동화 Java 이식을 이어간다.
먼저 apps/quote-legacy/CLAUDE.md, apps/quote-legacy/docs/WBS-java.md, apps/quote-legacy/docs/PROGRESS.md(진행표·J4 기록·이슈 로그 [이식] 24건),
apps/quote-legacy/docs/LESSONS.md, apps/apps/quote-legacy/docs/ENGINE-CONTRACT.md 를 읽어라.

이번 범위는 J5(API 컨트롤러)다.
1) apps/quote-legacy/src/web/routes/*.js 와 router.js 를 읽어 엔드포인트 39개 명세표(메서드·경로·요청·응답·오류 형태·권한)를
   apps/quote-legacy/docs/API-spec.md 로 먼저 만들고 나에게 보여줘라. 코드 작성은 그 다음이다.
2) 경로와 JSON 형태를 Node와 완전히 동일하게 유지한다. SQL 문자열은 그대로 옮긴다.
3) 이슈 #18(GET→PUT 왕복 500)을 J5에서 해결한다.
4) 검증: .\mvnw.cmd test 전체 통과 + 실측 20종 유지 + apps/quote/tools/compare-queries.js 로 /quote vs /quote2 응답 대조.
5) 개발 DB 스키마는 건드리지 않는다. Flyway 실행 금지. git push 는 하지 말고 커밋까지만.
완료되면 DoD 체크 결과와 변경 요약을 보고하고 PROGRESS.md 의 J5 행을 갱신해라.
```

J6 이후도 같은 형식으로 "이번 범위는 J6" 처럼 바꿔 진행하면 된다.

---

## 4. 진행 전에 정해야 할 것

| 항목 | 상황 | 영향 |
|---|---|---|
| **레포 공개 상태** | `sepoa-jsk/sepoa-agent` 는 **public**이고, `platform/restructure` 가 푸시돼 `apps/quote-legacy/docs/` (등급별 정가, 실측 딜 고객사 실명, 내부 DB 호스트명)와 실측 견적서 PDF가 **현재 익명으로 열람 가능**하다 (2026-10-08 익명 clone으로 확인) | private 전환 권장. 이미 받아 간 사본은 회수 불가 |
| PDF의 `₩` 기호 | 화면은 제거, PDF는 실측 양식대로 남아 있음 | J7 Thymeleaf 이식 시 택일 |
| VAT 포함 견적 필요 여부 | 실측 5종 전부 별도. 영업 확인 필요 | 필요 없으면 폐기, 있으면 J5+J6 |
| 기준 페이지수 | SK이터닉스 기준선 2p / 위저드 3p / 실측 원본 4p | J7 DoD 기준 결정 |

J5~J9 범위 밖이지만 영업이 실제로 쓰려면 필요한 것 (J10 이후):
경비·전자구매 모듈 마스터 34건 미등록 (원본 `quote/assets/무전표_온프레미스.pdf`, `전자구매_온프레미스.pdf`) ·
위저드 편집 모드 · 모듈 선택 모달 · "클라우드서비스 결제 방안" 표 · 네고율 산정.
