# 견적 API 명세 — J5 이식 기준

> 작성 2026-10-28 · 출처 `src/web/router.js`, `src/web/routes/*.js`, `src/infra/{auth,db}.js`, `public/js/api.js`
> 용도: Java(`apps/quote`)의 `@RestController` 를 이 표와 **경로·요청·응답·오류 형태까지 똑같이** 만든다.
> 그래야 J6 에서 프론트는 `api.js` 한 파일만 고친다. 다르게 만들 이유가 생기면 이 문서를 먼저 고치고 확인받는다.

---

## 1. 공통 규칙

### 1-1. 권한 (가드 3종 — `src/infra/auth.js`)

| 표기 | 조건 | 실패 응답 |
|---|---|---|
| 공개 | 없음 | — |
| 로그인 | 세션에 `user` 가 있어야 함 | `401 {"error":"UNAUTHENTICATED","message":"로그인이 필요합니다."}` |
| 관리자 | 로그인 + `user.role == "ADMIN"` | 미로그인 401(위와 같음) · 권한 없음 `403 {"error":"FORBIDDEN","message":"관리자 권한이 필요합니다."}` |
| 키/로그인 | `X-API-Key` 헤더 == `API_KEY` 환경변수, 또는 로그인 | `401 {"error":"UNAUTHENTICATED","message":"인증이 필요합니다."}` ← 문구가 위와 다르다 |

J8(인증) 전까지 Java 는 세션을 Node 와 공유하지 않는다. J5 대조는 **dev 로그인 세션을 각 앱에서 따로 만든 뒤** 비교한다.

### 1-2. 오류 응답 형태

- 모든 오류 본문은 `{"error":"코드"}` 또는 `{"error":"코드","message":"문구"}`. **`message` 가 없는 경우가 있다** — 표에 적힌 대로 맞춘다.
- 처리되지 않은 예외: `500 {"error":"INTERNAL","message":"<예외 메시지>"}` (`server.js` 에러 핸들러)
- 없는 `/api` 경로: `404 {"error":"NOT_FOUND","message":"<METHOD> <원래 URL>"}` (`router.js`)
- 중복 키(`ER_DUP_ENTRY`) 는 라우트마다 409 코드가 다르다 — 표 참조.

### 1-3. 값 형태 (mysql2 설정에서 오는 것)

| DB 타입 | Node 응답에 나오는 모양 | Java 에서 맞출 것 |
|---|---|---|
| DATE · DATETIME | 문자열 (`dateStrings: true`) — `"2026-08-02"`, `"2026-08-02 14:03:11"` | `LocalDate` 를 그대로 직렬화하면 같다. DATETIME 은 `T` 없이 공백 구분 |
| DECIMAL | **문자열** (mysql2 기본) — `"1000000.00"` | `BigDecimal` → 문자열로 내보낸다. 숫자로 바꾸면 대조가 깨진다 |
| INT · TINYINT | 숫자 (`active: 1`) | `true/false` 로 바꾸지 않는다. 단, 라우트가 `!!` 로 바꾼 필드는 불리언 — 표에 표시 |
| JSON 컬럼(`columns`, `conditions`, `month_alloc`, `params`) | 라우트가 파싱한 곳만 배열/객체, 나머지는 원문 문자열 | 표에 "파싱" 이라 적힌 곳만 파싱 |
| `SELECT *` | 테이블의 모든 컬럼, 컬럼 순서 그대로 | RowMapper 대신 `queryForList` (Map) 로 받으면 형태가 자동으로 맞는다 |

키 순서는 대조 도구가 무시한다. 키 이름·값 모양만 같으면 된다.

---

## 2. 엔드포인트 (40개 · 실제 도달 39개)

"화면" 열: 현재 프론트(`public/js`)가 부르는지. ✕ 인 것도 이식한다 — 타시스템 연계·관리용이다.

### 2-1. 헬스 (1)

| # | 메서드·경로 | 권한 | 요청 | 성공 응답 | 오류 | 화면 |
|---|---|---|---|---|---|---|
| 1 | `GET /api/health` | 공개 | — | `{"ok":true,"authMode":"dev"}` | DB 실패 `500 {"ok":false,"db":"<메시지>"}` | ○ 로그인 화면이 `authMode` 로 dev 로그인 버튼을 띄운다 |

### 2-2. 인증 `/api/auth` (4)

| # | 메서드·경로 | 권한 | 요청 | 성공 응답 | 오류 | 화면 |
|---|---|---|---|---|---|---|
| 2 | `POST /api/auth/google` | 공개 | `{credential}` 또는 `{id_token}` | `{"user":{id,email,name,picture,role}}` + 세션 생성 | 400 `MISSING_TOKEN` · 403 `DOMAIN_NOT_ALLOWED` · 401 `AUTH_FAILED`(검증 실패 메시지) | ○ |
| 3 | `POST /api/auth/dev-login` | 공개 | `{email, name?}` | 위와 같음. `name` 없으면 이메일 앞부분 | 403 `DEV_LOGIN_DISABLED`(AUTH_MODE≠dev) · 400 `INVALID_EMAIL` · 403 `DOMAIN_NOT_ALLOWED` · 500 `AUTH_FAILED` | ○ |
| 4 | `POST /api/auth/logout` | 공개 | — | `{"ok":true}` · 세션 삭제, 쿠키 `sq_sid` 삭제 | — | ○ |
| 5 | `GET /api/auth/me` | 로그인 | — | `{"user":{...},"authMode":"dev"}` | 401 | ○ |

J5 에서는 2번(Google) 을 **자리만** 만든다(검증은 J8). 3·4·5 는 J5 대조에 필요하므로 실제로 동작시킨다.

### 2-3. 마스터 제네릭 CRUD `/api/master` (5)

대상 12종 — 화이트리스트 밖이면 `404 {"error":"UNKNOWN_MASTER","message":"알 수 없는 마스터: <type>"}`

| type | 테이블 | PK | 정렬 | 편집 컬럼 | 삭제 |
|---|---|---|---|---|---|
| solutions | sq_solutions | code | code | code, name, source | 실삭제 |
| deployments | sq_deployments | code | code | code, name | 실삭제 |
| company_classes | sq_company_classes | id | solution, deployment, sort | solution, deployment, key, label, revenue_cond, onsite, active, sort | active=0 |
| onsite_types | sq_onsite_types | code | sort | code, name, sort | 실삭제 |
| service_types | sq_service_types | id | solution, sort | solution, code, name, user_unit, min_price, note, active, sort | active=0 |
| modules | sq_modules | id | solution, sort | solution, code, name, base_price, required, note, active, sort | active=0 |
| labor_roles | sq_labor_roles | id | solution, sort | solution, code, name, base_price, std_mm, required, note, active, sort, standard_role_code | active=0 |
| labor_rates | sq_labor_rates | id | solution, sort | solution, company_key, rate, sort | 실삭제 |
| thirdparty | sq_thirdparty | id | solution, sort | solution, code, name, base_price, list_price, note, active, sort | active=0 |
| nego_rates | sq_nego_rates | id | target, company_key, onsite_key | target, company_key, onsite_key, rate | 실삭제 |
| maintenance | sq_maintenance_config | id | sort | code, name, calc_type, rate, md_price, md_per_mm, tco_years, free_months, note, active, sort | active=0 |
| labor_standards | sq_labor_standards | id | year DESC, sort | year, role_code, role_name, daily_rate, work_days, overhead_rate, tech_rate, sort | 실삭제 |

| # | 메서드·경로 | 권한 | 요청 | 성공 응답 | 오류 | 화면 |
|---|---|---|---|---|---|---|
| 6 | `GET /api/master` | 로그인 | — | `{solutions:[...], deployments:[...], ... 12종}` 각 `SELECT *` | — | ○ 앱 시작 시 |
| 7 | `GET /api/master/:type` | 로그인 | `?solution=` (그 마스터에 solution 컬럼이 있을 때만 적용) | `{"rows":[...]}` | 404 `UNKNOWN_MASTER` | ○ |
| 8 | `POST /api/master/:type` | 관리자 | 편집 컬럼 중 보낸 것만 | `201 {"row":{...}}` (넣은 행 다시 조회) | 400 `MISSING_FIELDS`(메시지 없음) · 409 `DUPLICATE` "중복된 키입니다." | ○ |
| 9 | `PUT /api/master/:type/:id` | 관리자 | 편집 컬럼 중 보낸 것만(PK 제외) | `{"row":{...}}` | 400 `NOTHING_TO_UPDATE` · 404 `NOT_FOUND` · 409 `DUPLICATE`(메시지 없음) | ○ |
| 10 | `DELETE /api/master/:type/:id` | 관리자 | — | `{"ok":true}` | 404 `NOT_FOUND` | ○ |

### 2-4. 가격정책 `/api` (6)

| # | 메서드·경로 | 권한 | 요청 | 성공 응답 | 오류 | 화면 |
|---|---|---|---|---|---|---|
| 11 | ~~`GET /api/master`~~ | — | — | **도달 불가.** 6번이 먼저 등록돼 가로챈다 | — | — |
| 12 | `GET /api/pricing` | 로그인 | `?solution=&deployment=&all=` (`all` 없으면 active=1 만) | `{"items":[{...품목, "variants":[...]}]}` 정렬 sort, id | — | ✕ |
| 13 | `POST /api/pricing/items` | 관리자 | 품목 필드 + `variants[]` | `201 {"item":{...}}` | 400 `MISSING_FIELDS` · 400 `INVALID_PRICING_TYPE`(DISCOUNT/BAND/FIXED/MM) · 409 `DUPLICATE_CODE` | ✕ |
| 14 | `PUT /api/pricing/items/:id` | 관리자 | 바꿀 필드 + `variants?` (주면 통째 교체) | `{"item":{...}}` | 400 `INVALID_PRICING_TYPE`(메시지 없음) · 400 `NOTHING_TO_UPDATE` · 404 | ✕ |
| 15 | `PUT /api/pricing/items/:id/variants` | 관리자 | `{variants:[...]}` | `{"variants":[...]}` | 400 `INVALID_VARIANTS` · 404 | ✕ |
| 16 | `DELETE /api/pricing/items/:id` | 관리자 | — | `{"ok":true}` (active=0) | 404 | ✕ |

### 2-5. 블록·조건·템플릿 `/api` (6)

| # | 메서드·경로 | 권한 | 요청 | 성공 응답 | 오류 | 화면 |
|---|---|---|---|---|---|---|
| 17 | `GET /api/blocks` | 로그인 | — | `{"blocks":[...]}` · `columns` 파싱(배열) | — | ○ |
| 18 | `GET /api/conditions` | 로그인 | — | `{"conditions":[{...세트, "lines":["문장",...]}]}` | — | ○ |
| 19 | `GET /api/templates` | 로그인 | `?quote_type=&solution=&active=` | `{"templates":[{...,"block_codes":["SOLUTION",...]}]}` | — | ○ |
| 20 | `GET /api/templates/:code` | 로그인 | — | `{template, blocks, items(블록별 묶음, registered 불리언), labor(평면), laborByBlock, conditions, unregistered}` | 404 `NOT_FOUND` | ○ |
| 21 | `POST /api/templates` | 관리자 | 헤더 12필드 + `blocks[] items[] labor[]` | `201 {"id":..,"code":".."}` | 400 `MISSING` · 409 `DUPLICATE_CODE` | ○ |
| 22 | `PUT /api/templates/:id` | 관리자 | 위와 같음 (블록·모듈·인건비 통째 교체) | `{"ok":true,"id":..}` | 404 | ○ |

### 2-6. 견적 `/api/quotes` (11)

| # | 메서드·경로 | 권한 | 요청 | 성공 응답 | 오류 | 화면 |
|---|---|---|---|---|---|---|
| 23 | `POST /api/quotes/apply-template` | 로그인 | `{template_code}` | `{template, blocks(초안), labor_year, round_unit:100000, conditions, unregistered}` · 저장 안 함 | 404 `NOT_FOUND` "템플릿을 찾을 수 없습니다." | ○ |
| 24 | `POST /api/quotes/calculate` | 키/로그인 | 블록형 `{blocks, discount, monthly_discount, round_unit}` 또는 레거시 `{sections, discount}` | 엔진 결과 그대로 | 400 `NO_BLOCKS`(빈 blocks) · 400 `NO_SECTIONS` | ○ |
| 25 | `POST /api/quotes/preview` | 로그인 | `{header, blocks, discount, monthly_discount, round_unit}` | `{"html":"…","calc":{…}}` | 400 `NO_BLOCKS` | ○ ※ html 은 J7 |
| 26 | `POST /api/quotes` | 로그인 | 블록형(`blocks`) 또는 레거시(`sections`) + 헤더 | `201 {"quote":{…상세와 같은 모양}}` · 견적번호 채번 | 400 `NO_SECTIONS` | ○ |
| 27 | `GET /api/quotes` | 로그인 | `?status=&customer=&quote_no=&page=1&size=20`(최대 100) | `{total, page, size, quotes:[{...sq_quotes, created_by_name}]}` 최신순 | — | ○ |
| 28 | `GET /api/quotes/:id` | 로그인 | — | `{"quote":{...헤더, conditions(파싱), sections:[{…, params(파싱), items, labor}], blocks:[{…, recurring(불리언), items, labor(month_alloc 파싱)}]}}` | 404 `NOT_FOUND` | ○ |
| 29 | `PUT /api/quotes/:id` | 로그인 | 26번과 같음. quote_no 유지 | `{"quote":{…}}` | 400 `NO_SECTIONS` · 404 | ○ |
| 30 | `PATCH /api/quotes/:id/status` | 로그인 | `{status}` DRAFT/SENT/WON/LOST | `{"ok":true,"status":".."}` | 400 `INVALID_STATUS` · 404 | ○ |
| 31 | `DELETE /api/quotes/:id` | 로그인 | — | `{"ok":true}` | 404 | ○ |
| 32 | `GET /api/quotes/:id/excel` | 로그인 | — | xlsx 파일 | 404 | ○ ※ J7 |
| 33 | `GET /api/quotes/:id/pdf` | 로그인 | `?cover=0` 표지 생략 | pdf 파일 | 404 | ○ ※ J7 |

### 2-7. 설정 `/api/settings` (2)

| # | 메서드·경로 | 권한 | 요청 | 성공 응답 | 오류 | 화면 |
|---|---|---|---|---|---|---|
| 34 | `GET /api/settings` | 로그인 | — | `{"settings":{"키":"값",...}}` | — | ○ |
| 35 | `PUT /api/settings` | 관리자 | `{settings:{...}}` 일괄 upsert, null 허용 | 위와 같음(저장 후 전체) | 400 `INVALID_BODY` | ○ |

### 2-8. 임금단가 `/api/labor-rates` (5)

| # | 메서드·경로 | 권한 | 요청 | 성공 응답 | 오류 | 화면 |
|---|---|---|---|---|---|---|
| 36 | `GET /api/labor-rates/years` | 로그인 | — | `{"years":[{id,year,source,active,rate_count}]}` 최신 연도순 | — | ○ |
| 37 | `GET /api/labor-rates` | 로그인 | `?year=` 없으면 active 연도, 그것도 없으면 최신 | `{year, year_id, source, active, rates:[...]}` · 연도 없으면 `{"year":null,"rates":[]}` | — | ○ |
| 38 | `POST /api/labor-rates/years` | 관리자 | `{year, source?, clone_from_year?}` | `201 {"id":..,"year":..,"cloned":N}` | 400 `INVALID_YEAR`(2000~2100) · 409 `DUPLICATE_YEAR` | ○ |
| 39 | `PUT /api/labor-rates/:id` | 관리자 | 8개 필드 중 보낸 것(`""` → null) | `{"rate":{...}}` | 400 `NO_FIELDS` · 404 | ○ |
| 40 | `PATCH /api/labor-rates/years/:id/active` | 관리자 | — | `{"ok":true,"active_id":..}` | 404 | ○ |

---

## 3. 이식하며 발견한 것 (정해야 할 것 포함)

| # | 내용 | 제안 |
|---|---|---|
| A | **11번 `GET /api/master`(가격정책 쪽) 는 한 번도 실행되지 않는다.** 6번이 같은 경로를 먼저 잡는다 | Java 에는 만들지 않는다. "39개" 의 정체가 이것 |
| B | **헬스 응답이 다르다.** Node `{ok, authMode}` / Java(J1) `{status, db, time}`. 로그인 화면이 `authMode` 를 읽는다 | Java 응답에 `ok`·`authMode` 를 **더한다**(기존 키는 유지 — 게이트웨이·dev.ps1 이 쓴다) |
| C | **이슈 #18** — `GET` 결과를 그대로 `PUT` 하면 500. `sq_quote_sections.solution` 이 NOT NULL 인데 상세 헤더에 `solution` 이 없다 | WBS 대로 J5 에서 해결. 상세 응답 헤더에 우산 섹션의 `solution`·`brand`·`contract_months` 를 노출 — **Node 와 응답이 달라지는 유일한 곳**이므로 대조 도구에 예외로 등록 |
| D | 12~16번(가격정책 품목 관리) 을 지금 화면이 쓰지 않는다 | 이식은 한다(WBS 39개 기준). 우선순위는 맨 뒤 |
| E | Node 38번은 중복 연도일 때 DB 연결을 두 번 반납한다(무해한 경고) | Java 는 트랜잭션 관리를 Spring 에 맡기므로 저절로 사라진다. 응답은 같다 |
| F | 25번 `preview` 의 `html` 과 32·33번 파일 출력은 렌더러(J7) 가 필요하다 | J5 에서는 `calc` 만 맞추고 `html` 은 빈 문자열, 32·33 은 `501 {"error":"NOT_IMPLEMENTED"}`. J7 에서 채운다 |
| G | 레거시 섹션형 견적(`sections` 경로) 저장 — `service.js` 의 `calcQuote` 는 Java 에 아직 없다 | 기존 11건 중 섹션형이 있는지 확인 후 결정. 새 화면(위저드)은 블록형만 쓴다 |
| I | **(J5-4 확인)** ① #18 해결 — Java 상세는 헤더에 우산 섹션의 `solution`·`brand`·`contract_months` 를 싣고, GET 결과를 그대로 PUT 하면 Node 는 500, Java 는 200. ② 단 **할인은 왕복되지 않는다** — 상세는 `discount_type`/`discount_value`(평면)로 내고 저장은 `discount:{type,value}`(객체)로 받는다. 그대로 되돌리면 할인이 빠진 금액으로 저장된다(Node 도 같은 구조). ③ `sections` 의 가격정책 4모델 저장은 Node 도 500(`Bind parameters must not contain undefined`), Java 는 501 | ②는 위저드 편집 모드(PROGRESS 이월 19) 가 `discount`·`monthly_discount` 를 객체로 다시 담아 보낼 것. 응답 모양은 바꾸지 않는다 |
| H | **(J5-3 확인)** 24번 `calculate` 에서 Node 와 일부러 다르게 답하는 곳. ① 음수 단가·수량·금액, 알 수 없는 특별DC 유형 → Node 는 계산(유형은 AMOUNT 로 취급), Java 는 `400 INVALID_INPUT` — 엔진 계약(ENGINE-CONTRACT 2절)이 거부한다. ② `sections` 중 블록 스냅샷이 아닌 것(가격정책 4모델 `calcQuote`) → `501 NOT_IMPLEMENTED` — 엔진 계약 3절 "이식 대상 아님, J10 대체". 화면은 24번을 부르지 않는다. ③ `month_alloc: {}`(빈 객체) + 공수>0 → Node 는 배분 오류를 내고 Java 엔진은 "배분 없음" 으로 건너뛴다. 위저드는 빈 배분을 `null` 로 보내므로 화면에는 영향이 없다 | 그대로 둔다. 기존 견적 11건·템플릿 8종으로 만든 정상 요청 139건은 Node 와 같다 |

---

## 4. J5 작업 순서 (제안)

한 묶음 = 한 커밋. 묶음마다 `/quote` vs `/quote2` 대조 통과 후 다음으로.

1. **공통 뼈대** — 오류 응답 형태(1-2), 권한 가드 3종, dev 로그인 세션(3·4·5), 헬스 보완(B)
2. **조회 전용** — 6·7, 17~20, 27·28, 34, 36·37 (DB 를 바꾸지 않아 대조가 가장 쉽다)
3. **계산** — 23·24·25(calc 만) — J3 계산 엔진 연결
4. **견적 쓰기** — 26·29·30·31 + 이슈 #18(C)
5. **관리 쓰기** — 8·9·10, 21·22, 35, 38·39·40, 12~16

쓰기 대조(4·5) 는 개발 DB `test_01` 을 Node 와 공유하므로 **테스트용 견적을 새로 만들어 쓰고 지운다.** 기준선 견적 44·45·46 은 건드리지 않는다.
