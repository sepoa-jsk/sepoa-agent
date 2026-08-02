# Java 이식 실행계획 (WBS)

> **결정** 서버는 Java/Spring Boot 이식, 프론트엔드는 현행 바닐라 SPA 유지
> **스택** Java 17 · Spring Boot 3.x · JdbcTemplate · Flyway · Thymeleaf(PDF 전용) · Apache POI · Spring Security OAuth2 · Jenkins · Apache Tomcat
> **DB** MariaDB `test_01` (devmariadb) — 스키마 변경 없이 그대로 사용
> **사용법** J0부터 순서대로. 한 단계 = 한 커밋. DoD 통과 후 승인 → 다음 단계
> **작성 기준일** 2026-08-02

---

## 0. 결정 사항

| 항목 | 결정 | 근거 |
|---|---|---|
| 서버 | **Java 17 + Spring Boot 3.x** | 사내 표준 정합 |
| DB 접근 | **JdbcTemplate** | 현행 raw SQL 이 거의 1:1 이식 |
| 마이그레이션 | **Flyway** | 자체 러너 폐기. 013·015 신규 설치 불가 문제 해소 |
| 프론트엔드 | **현행 바닐라 SPA 유지** | 서버 언어 무관. 이식 비용 0, STEP 2~3 자산 전량 보존 |
| PDF 템플릿 | **Thymeleaf** | 서버 렌더링이므로 템플릿 엔진이 적합 |
| Excel | **Apache POI** | exceljs 대체 |
| 패키징 | **WAR** (외부 Tomcat) | 사내 배포 환경 |
| 인증 | **Spring Security OAuth2 Client** (Google) | 현행과 동일 개념 |
| 세션 | **Spring Session JDBC** | 기존 세션 테이블 재사용 검토 |

**빌드 도구는 프론트에 도입하지 않습니다.** 화면이 12개로 늘어 부담이 커지면 그때 Vite 등을 점진 도입할 수 있습니다. 지금 결정할 필요가 없습니다.

---

## 1. 현행 Node 자산 처리

| 자산 | 처리 |
|---|---|
| `quote/public/` 전체 | **그대로 이관** — Spring Boot `src/main/resources/static/` |
| 계산 엔진·PDF HTML·SQL | **참조 구현으로 보존.** 번역 대상 |
| `test/` 70종 | **이식 검수 명세.** JUnit 으로 옮김 |
| `docs/PROGRESS.md` 이슈 로그 | **Java 프로젝트로 이관.** 미해결 항목이 유실되면 안 됨 |
| `docs/baseline-pdf/` | **회귀 방어선으로 계속 사용** |
| `db/migrations/` 25개 | Flyway baseline 으로 대체. 이력만 보존 |
| `tools/` | Node 전용. Java 쪽 대응 도구를 별도 판단 |
| `editor.js` | 이식 안 함. 네고율만 Java 에서 새로 구현 |

**Node 앱은 삭제하지 않습니다.** 전환 완료 후 일정 기간 롤백 대비로 유지하고, 병행 대조(4장)에도 사용합니다.

---

## 2. 목표 프로젝트 구조

**`sepoa-agent` 모노레포 안에 `quote-java/` 로 둡니다.** 같은 레포에 있으면 Node 참조 구현과 나란히 두고 대조하기 쉽고, 게이트웨이도 그대로 씁니다.

```
sepoa-agent/
├─ server.js                게이트웨이 — /quote → Node, /quote2 → Java(병행 대조용)
├─ tools/                   Node 전용 도구 (유지)
├─ blog-automation/         (변경 없음)
├─ quote/                   ★Node 참조 구현 — 삭제하지 않음
│   ├─ docs/                WBS · PROGRESS · ui-mockup · baseline-pdf
│   ├─ src/  public/  db/  test/
└─ quote-java/              ★신규
    ├─ build.gradle         (또는 pom.xml)
    ├─ Jenkinsfile
    ├─ docs/                → quote/docs 를 참조. 중복 보관하지 말 것
    └─ src/
        ├─ main/
        │   ├─ java/kr/co/sepoasoft/quote/
        │   │   ├─ QuoteApplication.java
        │   │   ├─ config/          SecurityConfig · SessionConfig · WebConfig · FlywayConfig
        │   │   ├─ domain/
        │   │   │   ├─ quote/       Quote · Block · Item · Labor · Service · Repository · Numbering
        │   │   │   ├─ pricing/     PricingEngine · models/{Fixed,Discount,Mm,Band,Grade,Rate,Md}
        │   │   │   ├─ labor/       LaborCalculator · RiskFactor
        │   │   │   ├─ validation/  rules/R01~R16 · ValidationRunner
        │   │   │   ├─ render/      PdfRenderer · HtmlRenderer · ExcelRenderer · TcoRenderer
        │   │   │   └─ dispatch/    MailSender · OpenTracker
        │   │   ├─ master/          policy · price · band · rule · risk · laborRate
        │   │   │                   code · term · mailTemplate · docTemplate · customer
        │   │   │                   user · role · dept
        │   │   ├─ web/             controller/ · dto/ · advice/
        │   │   └─ infra/           ChromeRunner · DbHealth
        │   └─ resources/
        │       ├─ application.yml · application-{dev,prod}.yml
        │       ├─ db/migration/    V1__baseline.sql · V2__... (Flyway)
        │       ├─ templates/quote/ PDF 용 Thymeleaf
        │       └─ static/          ★quote/public/ 을 J6 에서 이관
        └─ test/
            ├─ java/.../            JUnit 5
            └─ resources/fixtures/  실측 픽스처 JSON (Node 와 공유)
```

**문서는 `quote/docs/` 하나만 유지합니다.** WBS·PROGRESS·이슈 로그·기준선 PDF 를 두 곳에 두면 반드시 어긋납니다. `quote-java/docs/README.md` 에 참조 경로만 남기세요.

**픽스처도 단일 출처입니다.** `quote/test/fixtures/` 를 정본으로 두고 Java 쪽이 상대경로로 읽거나, Gradle 빌드 시 복사하는 방식 중 하나를 J2 에서 정합니다.

**모노레포 주의점**
- `.gitignore` 에 `quote-java/build/`, `quote-java/target/`, `quote-java/.gradle/` 추가
- Jenkins 는 `quote-java/` 변경 시에만 빌드하도록 경로 필터
- 게이트웨이 `server.js` 에 `/quote2` → Java 포트 프록시를 추가해 4장의 병행 대조에 사용

## 3. 이식 단계

### J0 — 착수 준비 (0.5일)

- [ ] Node 브랜치 `refactor/restructure` 푸시 후 태그 `v-node-final`
- [ ] `docs/PROGRESS.md` 이슈 로그 12건을 Java 프로젝트 이슈로 이관
- [ ] 발견 결함 이력 정리 (006 백필 손상 · 009/021 DELIMITER · isLabor 판정 · dataUri 침묵 실패)
- [ ] Node 개편 STEP 4~8 중단 명시. 해당 설계는 Java 에서 구현
- [ ] 레포 공개 상태 결정 (가격정책·실측 견적서 노출 건)

**DoD** Node 자산이 태그로 고정되고, 미해결 이슈가 하나도 유실되지 않았다.

---

### J1 — 프로젝트 스캐폴딩 (1일)

- [ ] Spring Boot 3.x + Java 17, WAR 패키징
- [ ] `SpringBootServletInitializer` 상속, `spring-boot-starter-tomcat` 을 `provided`
- [ ] DataSource 설정 (MariaDB, HikariCP)
- [ ] `/api/health` 엔드포인트
- [ ] 프로파일 분리 — `dev`(로컬) / `prod`(서버)
- [ ] 외부 Tomcat 에 WAR 배포해 헬스체크 통과 확인

**DoD** 외부 Tomcat 에서 WAR 가 뜨고 `/quote/api/health` 가 200 을 반환한다.
**주의** DB 는 개발 DB 공유다. 이 단계에서 스키마를 건드리지 말 것.

---

### J2 — 테스트 픽스처와 JUnit 명세 (1주)

**코드보다 테스트를 먼저 옮깁니다.** 이 단계 산출물이 이식 검수 기준입니다.

- [ ] Node `test/engine/quote-block.test.js` 실측 20종의 입력·기대값을 JSON 픽스처로 분리
- [ ] 같은 픽스처를 Node 테스트도 읽도록 수정 — **두 구현이 같은 입력을 공유**
- [ ] JUnit 5 + AssertJ 로 20종 작성 (전부 실패 상태)
- [ ] 실측 딜 5건(K뱅크·삼정·삼성생명·한화투자증권·교보생명) 케이스도 픽스처화

**DoD** JUnit 20종이 "전부 실패"로 실행되고, Node 테스트는 픽스처 분리 후에도 20/20 통과.

---

### J3 — 계산 엔진 (1주)

`quote-engine.js` 165줄을 POJO 로 옮깁니다. DB·HTTP 의존이 없어 가장 쉽고 가장 중요합니다.

- [ ] `PricingEngine` — 계산 순서 고정: 블록소계 합 → 특별DC → 십만단위 절사 → VAT 별도
- [ ] 일시불/월(recurring) 분리
- [ ] **`BigDecimal` 사용, 반올림 모드 명시** — JS `Number` 와 결과가 달라질 수 있음
- [ ] `isLabor` 판정은 `blockCode == "LABOR"` 만 (Node 작업 9 수정분 반영)
- [ ] 특별DC TARGET/RATE/AMOUNT 모드
- [ ] `validateMonthAlloc` 상당 검증

**DoD** J2 의 JUnit 20종 전부 통과. 하나라도 실패하면 진행 중단.

---

### J4 — Flyway 및 데이터 계층 (1주)

- [ ] Flyway 도입. **현재 스키마를 `V1__baseline.sql` 로 스냅샷**
      → 013·015 의 신규 DB 설치 불가 문제가 여기서 해소된다
- [ ] `sq_migrations` 이력을 `flyway_schema_history` 로 이관 (또는 baseline 버전 지정)
- [ ] `@Repository` + `NamedParameterJdbcTemplate`
- [ ] 현행 SQL 문자열을 그대로 옮기고 바인딩 표기와 `RowMapper` 만 추가
- [ ] 견적 조회·저장·블록/품목/인건비 CRUD

**DoD** 견적 11건을 Java 로 조회한 결과가 Node 조회 결과와 필드 단위로 일치.
**주의** Flyway 를 개발 DB 에 자동 실행하지 말 것. `baseline-on-migrate` 로 기존 스키마를 인정만 하고, 신규 마이그레이션은 수동 승인 후 적용.

---

### J5 — API 컨트롤러 (1.5주)

**엔드포인트 경로와 요청·응답 JSON 형태를 그대로 유지합니다.** 그래야 프론트를 수정하지 않습니다.

- [ ] Node 라우트 39개 · 마운트 6개를 명세로 사용 (작업 5 검증 결과)
      `/api/auth` 4 · `/api/master` 6 · `/api/quotes` 10 · `/api/settings` 2 · `/api/labor-rates` 5 · 기타
- [ ] `@RestController` + DTO
- [ ] 전역 예외 처리 (`@RestControllerAdvice`) — 현행 오류 응답 형태 유지
- [ ] `POST /api/quotes/preview` (Node 작업 9 에서 추가한 미리보기 API) 포함

**DoD** 39개 엔드포인트가 Node 와 같은 응답을 반환. 4장의 병행 대조로 검증.

---

### J6 — 프론트엔드 이관 (0.5일)

- [ ] `quote/public/` 전체를 `src/main/resources/static/` 으로 복사
- [ ] `api.js` 의 `API_BASE` 를 Java 앱 경로에 맞게 조정
- [ ] 정적 리소스 캐싱·MIME 설정 확인 (`.js` 를 `text/javascript` 로)
- [ ] 화면 9종 육안 확인 — 레이아웃·라우팅·API 호출

**DoD** 로그인 없이 접근 가능한 화면이 렌더되고, API 호출이 Java 백엔드로 나간다.
**변경 파일은 `api.js` 한 개여야 한다.** 다른 파일을 고쳐야 한다면 J5 의 응답 형태가 어긋난 것이다.

---

### J7 — PDF · Excel (1주)

- [ ] `quote-html.js` 415줄을 Thymeleaf 템플릿으로 이식
      → **레이아웃을 다시 만들지 말 것.** 실측 3종을 재현하는 HTML 이 이미 검증돼 있다
- [ ] 폰트 스택에 `Noto Sans CJK KR` 추가 (리눅스 한글 두부 방지)
- [ ] `ChromeRunner` — `ProcessBuilder` 로 헤드리스 Chrome 호출
      플랫폼별 경로 후보, `CHROME_PATH` 우선, `--no-sandbox` 토글
- [ ] 로고·직인 이미지 base64 임베드. **실패를 삼키지 말고 예외로 표면화할 것**
      (Node `dataUri()` 가 try/catch 로 null 을 반환해 그림만 빠진 PDF 가 조용히 나왔다)
- [ ] Excel — exceljs → Apache POI

**DoD** 실측 3종 PDF 가 `docs/baseline-pdf/` 와 금액·페이지수·이미지 4개 임베드 일치. 한글 표시 육안 확인 필수.

---

### J8 — 인증 · 세션 (0.5주)

- [ ] `spring-boot-starter-oauth2-client` — Google SSO
- [ ] 도메인 제한 (`sepoasoft.co.kr`)
- [ ] Spring Session JDBC — 기존 세션 테이블 재사용 가능 여부 먼저 확인
- [ ] `TRUST_PROXY` 상당: `server.forward-headers-strategy=framework`
- [ ] HTTPS 환경에서 세션 쿠키 `secure` 설정

**DoD** Google 계정으로 로그인되고 세션이 유지된다. HTTPS 뒤에서도 동일.
**주의** dev 우회 로그인 경로를 운영 프로파일에 남기지 말 것.

---

### J9 — Jenkins 파이프라인 및 전환 (0.5주)

- [ ] `Jenkinsfile` — 체크아웃 → 빌드 → **JUnit 게이트(실측 20종)** → WAR → Tomcat 배포
- [ ] **Flyway 자동 실행 금지.** 개발 DB 공유 중에는 수동 승인 단계 분리
- [ ] 게이트웨이에서 `/quote` 를 Java 앱으로 전환
- [ ] Node 앱 유지 (롤백 대비)
- [ ] 배포 문서 `docs/DEPLOY.md`

**DoD** Jenkins 에서 배포가 완주하고, 영업팀이 쓰는 경로로 Java 앱이 응답한다.

---

### J10 이후 — 신규 기능 (구 STEP 4~8)

이식 완료 후 Java 에서 구현합니다. 설계는 기존 기획서와 WBS 를 그대로 사용합니다.

| 순서 | 내용 | 근거 문서 |
|---|---|---|
| J10 | 산정 모델 GRADE·RATE·MD + 리스크 계수 | 기획서 4.3, 구 STEP 4 |
| J11 | 마스터 재편 (정책·코드·문구·템플릿·고객사) | 기획서 6.9~6.10, 구 STEP 5 |
| J12 | 검증 엔진 R-01~R-16 | 기획서 6.3, 구 STEP 6 |
| J13 | 권한·승인·발송·열람추적 | 기획서 6.8, 구 STEP 7 |
| J14 | TCO 비교 · AI 계층 | 기획서 5장, 구 STEP 9 |

---

## 4. 병행 대조 — 이식 정확도 실증

Node 와 Java 가 같은 DB 를 보므로, 나란히 띄워 응답을 비교할 수 있습니다.

```
DB(test_01) ─┬─→ Node  /quote/api/...   → 응답 A
             └─→ Java  /quote2/api/...  → 응답 B     A == B ?
```

- J3 에서 대조 스크립트를 만들어 이후 전 단계에서 재사용
- 견적 11건 전부에 대해 금액·필드 일치 확인
- PDF 는 금액·페이지수·이미지 개수로 대조

---

## 5. 일정

| 단계 | 내용 | 기간 | 누적 |
|---|---|---|---|
| J0 | 착수 준비 | 0.5일 | 0.5 |
| J1 | 스캐폴딩 | 1일 | 1.5 |
| J2 | 테스트 픽스처 | 1주 | 6.5 |
| J3 | 계산 엔진 | 1주 | 11.5 |
| J4 | Flyway·데이터 계층 | 1주 | 16.5 |
| J5 | API 컨트롤러 | 1.5주 | 24 |
| J6 | 프론트 이관 | 0.5일 | 24.5 |
| J7 | PDF·Excel | 1주 | 29.5 |
| J8 | 인증·세션 | 0.5주 | 32 |
| J9 | Jenkins·전환 | 0.5주 | 34.5 |

**약 7주(35 영업일)** — 여기까지가 현재 기능의 동등 이식입니다.

---

## 6. 진행 규칙

- 단계 완료 시 DoD 체크 + 테스트 + 변경 요약 보고 → 승인 → 다음 단계
- **실측 20종이 회귀 방어선.** J3 이후 모든 단계에서 통과해야 한다
- J6 에서 프론트 변경 파일이 `api.js` 하나를 넘으면 J5 를 다시 본다
- 개발 DB 공유 중이므로 **Java 쪽에서 스키마를 바꾸지 않는다.** J4 의 Flyway 는 baseline 인정만
- Node 앱은 J9 이후에도 일정 기간 유지. 삭제 시점은 별도 판단
