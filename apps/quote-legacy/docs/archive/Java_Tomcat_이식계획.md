# 견적자동화 시스템 Java/Tomcat 이식 계획

> **현행** Node.js 18 + Express 4 + MariaDB (raw SQL) · 커밋 20개, STEP 1~3 완료
> **대상** Java/Tomcat — SingleSuite 사내 표준 스택
> **작성 기준일** 2026-08-02

---

## 0. 확정된 스택

| 항목 | 확정값 | 이식에 미치는 영향 |
|---|---|---|
| JDK | **Java 17** | Spring Boot 3.x 사용 가능. record·switch expression 등 현대 문법 가용 |
| 프레임워크 | **Spring Boot** | 표준 구조. 3.x 권장(Java 17 최소 요구, Boot 2.7은 2023년 지원 종료) |
| DB 접근 | **JDBC** | `JdbcTemplate` / `NamedParameterJdbcTemplate`. **현행 raw SQL 이 거의 1:1 이식된다 — 가장 큰 이득** |
| CI/CD | **Jenkins** | Gradle/Maven 빌드 → WAR → Tomcat 배포 파이프라인 |
| WAS | **Apache Tomcat** | 외부 Tomcat 배포 전제 → WAR 패키징 + `SpringBootServletInitializer` |
| 인증 | **Google SSO** | `spring-boot-starter-oauth2-client`. 현행과 동일 방식이라 개념 이식 없음 |
| 화면 UI | **미정 — 아래 추천** | |

**JDBC 선택이 이식 난이도를 크게 낮춥니다.** JPA였다면 엔티티 모델링부터 다시 해야 하지만, `JdbcTemplate`은 현행 `mysql2` 쿼리를 그대로 옮기면 됩니다. 파라미터 바인딩 방식(`?` → `?` 또는 `:name`)만 맞추면 SQL 문자열 자체는 변경이 거의 없습니다.

---

## 0.1 화면 UI 추천 — 현행 SPA 유지

**결론: 지금 프론트엔드를 그대로 씁니다. 이식하지 마세요.**

### 선택지 비교

| 안 | 공수 | STEP 2~3 자산 | 평가 |
|---|---|---|---|
| **① 현행 SPA 유지** | **0** | **전량 보존** | **권장** |
| ② Thymeleaf 서버 렌더 | 3~4주 | 폐기 | 위저드 상태 관리를 서버 왕복으로 다시 설계해야 함 |
| ③ React/Vue 재작성 | 4~5주 | 폐기 | 빌드 체인·번들러 도입. Jenkins 파이프라인도 복잡해짐 |
| ④ JSP | 4주+ | 폐기 | 레거시. 신규 도입 근거 없음 |

### ①을 권하는 이유

현행 프론트는 **빌드 스텝 없는 순수 ES Module SPA**입니다. `<script type="module">` 하나로 브라우저가 직접 로드하므로 서버 언어와 완전히 무관합니다. Spring Boot의 `src/main/resources/static/`에 그대로 넣으면 끝입니다.

수정할 곳은 `api.js`의 `API_BASE = '/quote/api'` 한 줄뿐입니다.

보존되는 것:
- SingleSuite 디자인 토큰(`#0747A6`·`#0F172A`·56px GNB·Pretendard·Lucide)
- GNB·사이드바 레이아웃 (작업 7)
- 견적 작성 5단계 위저드 + 실시간 미리보기 (작업 8~10)
- 화면 9종

②~④를 고르면 이 전부를 다시 만들어야 합니다. 이식 전체가 6.5주인데 화면 재작성만 3~5주라, **선택 하나로 공수가 두 배가 됩니다.**

### 다만 두 가지는 함께 조정합니다

**PDF 템플릿은 Thymeleaf로.** `quote-html.js`가 문자열 조립으로 HTML을 만드는데, 서버 렌더링이므로 템플릿 엔진이 맞습니다. **앱 화면은 SPA, PDF 템플릿은 Thymeleaf** — 역할이 다르니 섞이지 않습니다.

**빌드 스텝은 화면이 12개로 늘어난 뒤 판단합니다.** 현재 9화면에서 `master.js`가 이미 603줄이었고 STEP 5에서 마스터 화면이 분해됩니다. 그 시점에 부담이 커지면 Vite만 얹으면 되고, 이건 나중에 점진적으로 가능합니다 — 지금 결정할 필요가 없습니다.

---

## 1. 지금 당장 해야 할 결정

**STEP 4~8을 JavaScript로 진행하지 마세요.**

남은 작업은 산정 모델 확장(11~12), 마스터 재편(13~15), 검증 엔진(16), 권한·승인·발송(17~19)입니다. 전부 서버 로직이고, 이식하면 **그대로 버려집니다.** 지금이 갈림길입니다.

| 현재 상태 | 이식 시 |
|---|---|
| STEP 1~3 (구조·화면) | 프론트는 살고, 서버 구조는 Java 패키지 설계의 참고자료로 |
| STEP 4~8 (미착수) | **Java로 처음부터 구현** — JS로 하면 100% 폐기 |
| 실측 재현 테스트 70종 | **가장 중요한 자산.** 이식 검수 기준이 됨 |

---

## 2. 이식 대상과 비대상

### 이식하지 않는 것

**프론트엔드 전체.** 빌드 스텝 없는 순수 ES Module SPA라 서버 언어와 무관합니다. Tomcat의 정적 리소스로 그대로 서빙하면 됩니다. 지금까지 STEP 2~3에서 만든 디자인 토큰·GNB·사이드바·위저드가 **손실 없이 살아남습니다.**

단, `api.js`의 `API_BASE = '/quote/api'` 경로만 맞추면 됩니다.

> 0.1의 추천대로 현행 SPA를 유지할 때의 이야기입니다. Thymeleaf·JSP·React 중 하나를 고르면 프론트도 전량 재작성이고 공수가 두 배가 됩니다.

**DB 스키마.** MariaDB 40개 테이블을 그대로 씁니다. 이식 중에는 Node와 Java가 같은 DB를 보게 되므로, 병행 운영이 가능합니다.

**견적서 HTML 템플릿과 PDF 생성 방식.** `quote-html.js`가 만드는 HTML은 문자열입니다. 템플릿 엔진(Thymeleaf·Mustache)으로 옮기면 되고, 헤드리스 Chrome 호출은 `ProcessBuilder`로 대체합니다. **레이아웃을 다시 만들 필요는 없습니다** — 실측 3종을 재현하는 HTML이 이미 검증돼 있습니다.

### 이식하는 것 — 실제 분량은 크지 않습니다

| 대상 | 현행 | Java 대응 |
|---|---|---|
| 계산 엔진 | `pricing/engine.js` 165줄 | POJO. 외부 의존 없음 |
| 견적 서비스 | `quote/service.js` | `@Service` + `@Repository`(JdbcTemplate) |
| PDF 렌더 | `render/pdf.js` + `html.js` 415줄 | **Thymeleaf** + `ProcessBuilder`(헤드리스 Chrome) |
| Excel | `render/excel.js` (exceljs) | **Apache POI** |
| 라우터 7종 | `web/routes/*.js` | `@RestController` |
| 인증·세션 | google-auth-library + express-mysql-session | `spring-boot-starter-oauth2-client` + Spring Session JDBC |
| 마이그레이션 | 자체 러너 + `sq_migrations` | **Flyway** — 자체 러너 폐기 |
| SQL | mysql2 raw query | **`JdbcTemplate` — 쿼리 문자열 거의 그대로** |

서버 로직 총량은 2,500~3,000줄 수준입니다. 재작성이라기보다 **번역에 가깝습니다.**

---

## 3. 이식 순서 — 엔진 우선

테스트가 있는 것부터 옮깁니다. 검수 기준이 이미 존재하기 때문입니다.

### 1단계 — 테스트 이식 (1주)

**코드보다 테스트를 먼저 옮깁니다.** `test/engine/quote-block.test.js`의 실측 재현 20종을 JUnit 5로 옮기고, 전부 실패하는 상태에서 시작합니다.

- 실측 데이터(하겐다즈·솔브레인·SK이터닉스 및 딜 5건)를 JSON 픽스처로 분리
- 이 픽스처는 Node와 Java 양쪽이 공유 — 두 구현이 같은 입력에 같은 값을 내는지 대조 가능
- 산출물: 실패하는 JUnit 테스트 20종 = **이식 검수 명세서**

### 2단계 — 계산 엔진 (1주)

`engine.js` 165줄을 POJO로 옮깁니다. DB도 HTTP도 안 타는 순수 함수라 가장 쉽고, 가장 중요합니다.

- 계산 순서 고정: 블록소계 합 → 특별DC → 십만단위 절사 → VAT 별도
- 일시불/월(recurring) 분리
- `BigDecimal` 사용 — JS `Number`의 부동소수점 오차와 결과가 달라질 수 있으니 반올림 모드를 명시
- **1단계 테스트 20종 전부 통과가 완료 조건**

### 3단계 — 데이터 계층 (1주)

- Flyway 도입, 현재 스키마를 baseline으로 등록
- `sq_migrations` → `flyway_schema_history` 이관
- **013·015 신규 DB 설치 불가 문제가 여기서 해소됩니다** — 현재 스키마 스냅샷을 V1으로 삼으면 과거 마이그레이션의 결함을 물려받지 않습니다
- `@Repository` + `NamedParameterJdbcTemplate` 작성
- **현행 SQL 문자열을 그대로 옮긴다.** 바인딩 표기(`?` → `:name`)와 `RowMapper`만 추가하면 되므로, 이식 중 가장 기계적인 구간이다

### 4단계 — API (1.5주)

라우터 7종을 컨트롤러로 옮깁니다. **엔드포인트 경로와 요청·응답 JSON 형태를 그대로 유지**하면 프론트를 수정하지 않아도 됩니다.

작업 5에서 확인한 라우트 39개·마운트 6개 목록이 그대로 명세가 됩니다.

### 5단계 — PDF·Excel (1주)

- HTML 템플릿 이식 → 헤드리스 Chrome 호출
- **검수: 기준선 PDF 3종과 금액·페이지수·이미지 임베드 대조**
- Excel은 exceljs → Apache POI

### 6단계 — 인증·세션 (0.5주)

- Spring Security + OAuth2 Client (Google)
- Spring Session JDBC — 기존 세션 테이블 재사용 가능한지 확인
- 도메인 제한(`sepoasoft.co.kr`) 유지

### 7단계 — 빌드·배포 파이프라인 (0.5주)

- WAR 패키징: `SpringBootServletInitializer` 상속, `spring-boot-starter-tomcat`을 `provided`로
- Jenkins 파이프라인: 체크아웃 → 빌드 → 테스트(JUnit 20종 게이트) → WAR → Tomcat 배포
- **Flyway를 Jenkins에서 자동 실행하지 말 것.** 개발 DB를 로컬과 공유하는 동안은 수동 승인 단계를 둔다
- 게이트웨이에서 `/quote`를 Java 앱으로 전환
- Node 앱은 롤백 대비로 일정 기간 유지
- 프론트는 `API_BASE`만 확인

**합계 6.5주** — 여기까지가 현재 기능의 동등 이식입니다. 신규 기능(STEP 4~8)은 그 위에 얹습니다.

---

## 4. 병행 전략 — 두 구현을 동시에 검증

같은 DB를 보므로 **Node와 Java를 나란히 띄워 같은 요청을 보내고 응답을 비교**할 수 있습니다.

```
견적 데이터(DB) ─┬─→ Node /quote/api/...  ─→ 응답 A
                 └─→ Java /quote2/api/... ─→ 응답 B
                                              A == B ?
```

특히 계산 엔진과 PDF는 이 방식으로 전수 대조가 가능합니다. 견적 11건 전부에 대해 금액이 일치하면 이식 정확도를 실증할 수 있습니다.

이 대조 스크립트를 2단계에서 만들어두면 이후 모든 단계에서 재사용됩니다.

---

## 5. 이식 중 손실 위험

| 항목 | 위험 | 대응 |
|---|---|---|
| `BigDecimal` 반올림 | JS `Number`와 절사·반올림 결과가 미세하게 다를 수 있음 | 실측 20종으로 검출. 반올림 모드 명시 |
| PDF 폰트·레이아웃 | 서버 환경이 바뀌면 한글 두부(□) 위험 | 리눅스 폰트 설치 + 육안 확인 필수 |
| 이슈 로그 12건 | 미해결 항목이 이식 과정에서 유실 | `docs/PROGRESS.md` 이슈 로그를 Java 프로젝트로 이관 |
| 발견된 결함 이력 | 006 백필 손상·009 DELIMITER 등 | 같은 실수를 반복하지 않도록 문서로 넘길 것 |
| 편집 기능 부재 | `editor.js`가 이미 어떤 견적도 못 엶 | 이식 대상에서 제외하고 Java에서 새로 구현 |
| Tomcat 세션 | 외부 Tomcat + Spring Session JDBC 조합에서 세션 테이블 스키마 불일치 | 기존 세션 테이블 재사용 가능 여부를 6단계 착수 전 확인 |
| Jenkins가 Flyway 자동 실행 | 개발 DB 공유 중 배포 시 스키마 변경이 로컬에 즉시 반영 | 파이프라인에서 수동 승인 단계 분리 |

---

## 6. 지금 무엇을 할 것인가

**Java 전환이 확정이라면**

1. STEP 4~8 중단. 작업 10.6(배포 준비)도 중단 — Node 앱을 리눅스에 올리는 작업은 버려집니다
2. Spring Boot 버전 확정(3.x 권장) 및 프로젝트 스캐폴딩
3. 현재 브랜치 커밋 20개를 푸시하고 태그 (`v-node-final`) — 참조 구현으로 보존
4. 1단계(테스트 이식)부터 시작

**미확정이라면**

작업 10.6 배포 준비까지만 하고 멈추세요. 배포해서 영업팀이 실물을 보고 판단하는 게, 스택 논의를 추상적으로 이어가는 것보다 낫습니다. STEP 4~8은 결정 후에 착수합니다.

**전환하지 않기로 한다면**

STEP 4~8을 계속하되, 마이그레이션 러너만은 검토 대상입니다. 자체 구현이 006 손상·009 침묵 실패·013·015 설치 불가를 만들었고, Node 진영에도 Knex migrate 같은 대안이 있습니다.

---

## 7. 판단에 참고할 것

이식의 이득은 기술적인 게 아니라 조직적인 것입니다.

- 유지보수 인력 — Java 개발자가 이 시스템을 손볼 수 있는가
- 배포 파이프라인 — SingleSuite와 같은 절차로 배포·모니터링되는가
- 보안 점검 — 사내 표준 점검 도구가 Node 앱을 커버하는가
- 제품 편입 — 향후 SingleSuite 라인업에 넣을 계획이 있는가

이 넷 중 둘 이상이 걸리면 이식이 맞습니다. 하나도 안 걸리면 Node 유지가 낫습니다 — 6.5주는 STEP 4~8을 두 번 할 수 있는 시간입니다.
