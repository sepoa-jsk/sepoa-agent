# apps/quote (견적 Java) — 문서 안내

> 2026-10-08 플랫폼 재구성으로 경로가 바뀌었다: `quote_automation/` → `apps/quote/`, `quote/` → `apps/quote-legacy/`, `tools/` → `apps/quote/tools/`.
> 아래 문서 본문과 PROGRESS.md 의 과거 기록은 옛 경로로 적혀 있다.

이 디렉터리에는 **문서를 보관하지 않는다.** 정본은 전부 `apps/quote-legacy/docs/` 에 있다.

WBS·진행상태·이슈 로그·기준선 PDF 를 두 곳에 두면 반드시 어긋난다.
Java 쪽 작업 중 문서를 고칠 일이 생기면 `apps/quote-legacy/docs/` 의 원본을 고친다.

| 문서 | 경로 | 내용 |
|---|---|---|
| Java 이식 실행계획 | `apps/quote-legacy/docs/WBS-java.md` | **현행 실행계획 정본.** J0~J14 단계와 DoD |
| 개편 설계 | `apps/quote-legacy/docs/WBS.md` | 설계·요구사항 정본. J10~J14 가 참조하는 구 STEP 4~8 설계 |
| 진행 상태 | `apps/quote-legacy/docs/PROGRESS.md` | 진행표 · 반출 목록 · 환경변수 매핑표 · 이슈 로그 51건 재분류 · 결정 기록 |
| 발견 결함 이력 | `apps/quote-legacy/docs/LESSONS.md` | Node 개발 중 결함 5건과 성격. **Java 에서 반복하지 않기 위한 문서** |
| UI 정본 | `apps/quote-legacy/docs/ui-mockup.html` | 화면 구조·간격·컴포넌트 기준 |
| 기준선 PDF | `apps/quote-legacy/docs/baseline-pdf/` | 실측 3종 회귀 방어선. J7 대조 기준 |
| 마이그레이션 이력 | `apps/quote-legacy/db/migrations/README.md` | 25개 파일 · 미실행 등록 사유 · 006 손상 탐지 쿼리 |

> `quote/` 는 **J2(테스트 픽스처 추출) 완료 후 삭제**한다.
> 삭제 시 위 문서는 `quote_automation/docs/` 로 **이동**한다(참조가 아니라 이동).
> 반출 대상 전체 목록은 `apps/quote-legacy/docs/PROGRESS.md` 의 "반출 목록" 13건을 따른다.

---

## 이 프로젝트 (J1 시점)

| 항목 | 값 |
|---|---|
| Spring Boot | 3.5.3 (`start.spring.io` 는 현재 4.x 만 제공해 pom 에 직접 고정) |
| Java | 17 (Temurin 17.0.20) |
| 빌드 | Maven Wrapper — `./mvnw`. Maven 별도 설치 불필요 |
| 패키징 | `war`, `finalName=quote2` → 외부 Tomcat 에서 `/quote2` |
| 의존성 | web · jdbc · validation · mariadb-java-client (J1 최소) |

`security` · `oauth2` · `flyway` · `thymeleaf` · `poi` 는 각각 J8 · J8 · J4 · J7 · J7 에서 추가한다.

### 기동

```bash
cd quote_automation
./mvnw spring-boot:run              # 내장 Tomcat, dev 프로파일
curl http://localhost:3200/quote2/api/health
```

접속 정보는 `application-*.yml` 에 없다. dev 프로파일이 `../quote/.env` 를 properties 로
읽고, 없으면 OS 환경변수를 쓴다. 매핑 근거는 `apps/quote-legacy/docs/PROGRESS.md` 의 환경변수 16종 표다.

### 빌드와 WAR 검증

```bash
./mvnw clean package
jar tf target/quote2.war | grep 'WEB-INF/lib/tomcat-embed'   # 결과가 없어야 정상
```

**`tomcat-embed-*` 가 WAR 안에 들어가면 외부 Tomcat 에서 뜨지 않는다.**
`spring-boot-starter-tomcat` 의 `provided` 스코프가 풀린 것이므로 `pom.xml` 을 확인한다.
WAR 는 정상 생성되고 오류도 없이 배포만 실패하는 유형이라, 빌드마다 이 확인을 거친다.

### 병행 운영

게이트웨이(`sepoa-agent/server.js`)가 `/quote` → Node, `/quote2` → Java(3200) 로 나눈다.
둘을 나란히 띄워 J5 에서 같은 DB 에 대한 응답을 대조한다.

---

## J9 착수 전 확인이 필요한 것 (미확인)

| 항목 | 왜 필요한가 |
|---|---|
| 사내 Jenkins 의 Tomcat 배포 방식 | Manager API / SCP+webapps / SSH+restart 중 무엇인지에 따라 `Jenkinsfile` 이 달라진다 |
| 서버 앞단 httpd·nginx 유무 | 있으면 `forward-headers-strategy` 외에 프록시 경로·헤더 설정이 추가로 필요하다 |
| 외부 Tomcat 버전 | Boot 3.5 는 Tomcat 10.1(Jakarta EE 9+) 기준이다. Tomcat 9 이면 `javax.*` 문제로 뜨지 않는다 |

J1 의 검증은 내장 Tomcat 으로만 했다. **외부 Tomcat WAR 배포 검증은 J9 몫이다.**
