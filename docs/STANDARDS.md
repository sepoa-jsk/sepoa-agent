# 업무 앱 표준 — 플랫폼에 붙기 위한 계약

> 새 업무를 만들거나 기존 업무를 이식할 때 이 문서의 항목을 모두 지킨다.
> 언어가 달라도(예외 승인된 경우) 1~5장은 동일하게 적용한다.

---

## 1. 경로

- 업무 앱은 **자기 경로 아래에서만** 동작한다. 예: 견적은 `/quote/...`.
- Java: `server.servlet.context-path: /<경로>` — 게이트웨이는 접두어를 떼지 않고 넘긴다 (`stripPrefix: false`).
- 화면의 API 호출·정적 자원은 **상대 경로** 또는 context path 기준으로 쓴다. `/api/...` 처럼 루트 절대경로를 하드코딩하지 않는다.
- 리다이렉트는 context path 를 포함해야 한다 (`server.forward-headers-strategy: framework`).

## 2. 상태 확인

`GET /<경로>/api/health` → 200

```json
{ "status": "UP", "db": "UP", "time": "2026-10-08T11:22:03+09:00" }
```

DB 등 필수 의존이 죽으면 503 과 `"status": "DOWN"`. 게이트웨이 홈(`/`)과 `/__gateway/status` 가 이 값을 쓴다.

## 3. 사용자 식별 (공통 인증 적용 후)

- 로그인은 게이트웨이가 한다 (Google Workspace SSO, `sepoasoft.co.kr` 도메인 한정).
- 업무 앱은 게이트웨이가 넘기는 헤더로 사용자를 안다.

| 헤더 | 값 |
|---|---|
| `X-Auth-User-Email` | `hong@sepoasoft.co.kr` |
| `X-Auth-User-Name` | 홍길동 (URL 인코딩) |
| `X-Auth-Roles` | `quote:ADMIN,blog:USER` |

- 업무 앱 포트는 서버 방화벽에서 외부 접근을 막는다 (게이트웨이만 접근). 그래야 헤더 위조가 불가능하다.
- 업무 앱이 자체 로그인 화면을 만들지 않는다. 적용 전 과도기에는 각 앱의 기존 로그인을 유지한다.
- 업무별 세부 권한은 공통 테이블 `pf_user_roles(email, app, role)` 에 둔다.

## 4. DB

- 공용 MariaDB. **업무별 테이블 접두어**: `sq_` 견적 · `bl_` 블로그 · `dw_` 일일업무 · `pf_` 플랫폼 공통.
- 다른 업무의 테이블에 쓰지 않는다. 읽기가 필요하면 그 업무 앱의 API 를 부른다.
- 스키마 변경은 Flyway(`db/migration/V{n}__*.sql`). 공유 개발 DB 에서 자동 실행 금지 — 수동 승인 후 적용.
- 시각 저장은 `DATETIME` + KST 로 통일한다 (업무 화면이 KST 로만 쓰인다).

## 5. 오류 응답

```json
{ "error": "InvalidInput", "message": "사람이 읽을 설명", "requestId": "..." }
```

- `error` 는 영문 코드, `message` 는 한국어.
- 4xx 는 호출자 문제, 5xx 는 서버 문제. 실패를 200 + 빈 값으로 감추지 않는다 (조용한 실패 금지).

## 6. 새 업무 추가 절차

1. `apps/<업무>/` 생성 — `apps/quote` 의 `pom.xml`·`application*.yml`·`HealthController` 를 복사해 시작.
2. `platform/ports.json` 에 항목 추가 (`id`·`name`·`dept`·`path`·`port`·`stack`·`dir`·`start`·`health`).
3. context path, `/api/health`, 테이블 접두어 확정 — 이 문서 1·2·4장.
4. AI 가 필요한 기능은 `platform/ai-engine/app/tasks/<업무>.py` 에 작업으로 등록하고, Java 에서는 6.1 의 클라이언트로 부른다.
5. `docs/ARCHITECTURE.md` 5장 포트표와 7장 결정 기록, `README.md` 업무 목록 갱신.
6. Jenkins 경로 필터에 `apps/<업무>/**` 추가.

### 6.1 Java 에서 AI 엔진 부르기

```java
// 설정: app.ai-engine.url=http://127.0.0.1:8100 , app.ai-engine.token=${AI_ENGINE_TOKEN}
RestClient ai = RestClient.builder().baseUrl(aiUrl)
        .defaultHeader("X-Internal-Token", aiToken).build();

Map<String, Object> res = ai.post().uri("/v1/tasks/{id}", "common.summarize")
        .header("X-Request-Id", requestId)
        .body(Map.of("input", Map.of("text", text, "max_sentences", 3),
                     "context", Map.of("app", "quote", "user", userEmail)))
        .retrieve().body(new ParameterizedTypeReference<>() {});
// res.output → 결과, res.usage → 토큰 사용량 (업무 DB 에 기록)
```

공통 클라이언트(`AiEngineClient`)는 첫 사용 업무에서 만들고 `platform/` 공용 모듈로 올린다.

## 7. 화면

- SingleSuite 디자인 토큰 (`apps/quote-legacy/docs/ui-mockup.html` 의 `:root` 가 현재 정본):
  Primary `#0747A6`, Pretendard 13px, Lucide 16px, radius 3px, ERP 고밀도 레이아웃.
- 금지: 금액 `₩` 기호(단위는 헤더에), 그리드 내 이모지, 배지형 건수 표시.

## 8. 커밋

- 영역 prefix: `feat/fix/docs/refactor/chore(<업무>)` — 예: `feat(quote): ...`, `feat(platform): ...`
- 이동(rename)과 로직 수정을 같은 커밋에 섞지 않는다.
- 이모지 금지, 한글 본문 허용.
