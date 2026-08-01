# 견적자동화 시스템 전면 개편 실행계획

> **대상 레포** `sepoa-jsk/sepoa-agent` — `quote/`
> **기준 커밋** `3fded04`
> **설계 근거** 세포아소프트_견적자동화_솔루션_기획서.md · 견적자동화_화면시안.html
> **사용법** Claude Code가 STEP을 위→아래로 처리. 각 항목 `[ ]`를 완료 시 `[x]`. STEP 끝에서 DoD 검증 후 사용자 승인 → 다음 STEP.
> **작성 기준일** 2026-08-01

---

## 0. AS-IS 진단

Phase 5-A~5-D는 사실상 완료 상태입니다. **엔진과 PDF는 실측 재현까지 통과**했으므로 버리지 않고 재배치합니다. 개편 대상은 구조·화면·마스터입니다.

### 0.1 살릴 자산

| 자산 | 위치 | 상태 |
|---|---|---|
| 블록형 계산 엔진 | `lib/quote-engine.js` (165줄) | 소계→특별DC→절사→VAT 순서 고정, 일시불/월 분리 완성 |
| PDF 렌더러 | `lib/quote-pdf.js` + `quote-html.js` (415줄) | 헤드리스 Chrome, 실측 3종 레이아웃 대조 통과 |
| 임금단가 마스터 | `sq_labor_rate_years` / `_lines` | 연도 복제·활성 토글 동작 |
| 템플릿 체계 | `sq_quote_templates` 외 3종 | BUILD 8종 시드 완료 |
| 실측 테스트 | `test/quote-block.test.js` (271줄) | 17종 재현. **개편 중 회귀 방어선** |

### 0.2 개편이 필요한 문제

| # | 문제 | 근거 |
|---|---|---|
| P1 | **루트 오염** — 레포 루트에 일회성 검증 스크립트 14개 산재 | `checkcc.js` `checkdata.js` `checkitems.js` `checkmaster.js` `checknego.js` `checkseed.js` `cleanup.js` `dbtest.js` `forceseed.js` `verify.js` `setadmin.js` `applyschema.js` `initdb.js` `seeddb.js` |
| P2 | **문서 산재** — `quote/` 루트에 계획 문서 8개 | `PLAN.md` `PLAN_PHASE5.md` `PLAN_PHASE5_REV.md` `PROMPT*.md` 3종 등 |
| P3 | **플랫 디렉토리** — `lib/` 8파일, `routes/` 7파일, `views/` 9파일이 모두 평면. 도메인 경계 없음 | 마스터가 12종으로 늘면 유지 불가 |
| P4 | **SQL 번호 충돌** — `042_drop_old_nego.sql` / `042_nego_rates_no_solution.sql` 동일 번호 | 25개 파일 단일 폴더 |
| P5 | **레거시 테이블 병존** — `sq_labor_rates` ↔ `sq_labor_rate_lines`, `sq_quote_sections` ↔ `sq_quote_blocks` | 5-C 마이그레이션이 비파괴로 설계되어 구 테이블 잔존 |
| P6 | **견적 작성 경로 2개** — `editor.js`(541줄, 섹션형) / `quote-block.js`(389줄, 블록형) 병존 | 어느 쪽이 정본인지 화면상 불명확 |
| P7 | **디자인 토큰 불일치** — `--navy #1e2d4e` `--accent #1a56aa` `--radius 8px` | SingleSuite 표준은 `#0F172A` `#0747A6`, ERP 지향 저곡률 |
| P8 | **컨벤션 위반** — 사이드바 이모지 아이콘 `👷` `⚙` `₩` | 그리드 이모지 금지·₩ 기호 금지 규약 위반 |
| P9 | **권한 2단** — `ADMIN`/`USER`뿐 | 기획서 6.8의 6역할 + 발행 한도 + 배율 상한 필요 |
| P10 | **견적번호 불일치** — `SYYYYMMDD###` | 실측 견적서는 `QT20260728_001` |
| P11 | **산정 모델 4종** — FIXED/DISCOUNT/MM/BAND | GRADE·RATE·MD 3종 부재 (등급정가·유지보수요율·MD단가) |
| P12 | **검증 부재** — `validateMonthAlloc` 하나 | 기획서 6.3의 R-01~R-16 미구현 |
| P13 | **미구현 기능** — 발송·열람추적, 승인 워크플로우, 공통코드, 메일템플릿, TCO, AI 계층 | 기획서 신규 범위 |

---

## 1. 개편 원칙

1. **엔진과 PDF는 건드리지 않는다** — 이동만 하고 로직 변경 금지. `test/quote-block.test.js` 17종이 STEP마다 전부 통과해야 한다.
2. **한 STEP = 한 커밋 = 한 관심사** — 이동과 수정을 같은 커밋에 섞지 않는다. 이동 커밋은 `git mv`로 diff가 rename으로 잡히게 한다.
3. **비파괴 마이그레이션** — 레거시 테이블은 STEP 8에서 사용처가 0임을 확인한 뒤에만 드롭한다.
4. **화면은 시안 우선** — `견적자동화_화면시안.html`이 UI 정본. 임의 변형 금지.
5. **STEP 3까지는 기능 동등** — 구조만 바꾸고 동작은 그대로. 신규 기능은 STEP 4부터.

---

## 2. 목표 디렉토리 구조

```
sepoa-agent/
├─ server.js                     게이트웨이 (유지)
├─ tools/                        ★신설 — 루트 산재 스크립트 이관
│   ├─ db/                       initdb · applyschema · seeddb · migrate
│   ├─ check/                    checkcc · checkdata · checkitems · checkmaster · checknego · checkseed · verify
│   └─ ops/                      setadmin · cleanup · dbtest
├─ blog-automation/              (변경 없음)
└─ quote/
    ├─ server.js                 앱 부트스트랩만 (라우터 등록은 web/router.js로)
    ├─ package.json
    ├─ ecosystem.config.js
    ├─ docs/                     ★신설 — 문서 이관
    │   ├─ archive/              PLAN.md · PLAN_PHASE5*.md · PROMPT*.md (히스토리 보존)
    │   ├─ PLAN.md               현행 기획서 요약 + 링크
    │   └─ WBS.md                이 문서
    ├─ src/                      ★신설 — 모든 서버 코드
    │   ├─ config/               env · constants(디자인토큰·검증코드·역할코드)
    │   ├─ infra/                db.js · auth.js · mailer.js · storage.js
    │   ├─ domain/               ★견적 도메인
    │   │   ├─ quote/            service · repository · numbering
    │   │   ├─ pricing/          engine.js(이관) · models/{fixed,discount,mm,band,grade,rate,md}.js
    │   │   ├─ labor/            공수 산정 + 리스크 계수 적용
    │   │   ├─ validation/       rules/R01~R16.js · runner.js
    │   │   ├─ render/           pdf.js · html.js · excel.js · tco.js
    │   │   └─ dispatch/         mail.js · tracking.js
    │   ├─ master/               ★기준정보 — 마스터별 1폴더
    │   │   ├─ policy/ price/ band/ rule/ risk/ labor-rate/
    │   │   ├─ code/ term/ mail-template/ doc-template/
    │   │   └─ customer/ user/ role/ dept/
    │   ├─ ai/                   rfp-parse · similar-quote · term-suggest · mail-draft
    │   └─ web/
    │       ├─ router.js         라우터 등록 일원화
    │       ├─ middleware/       auth · permission · error
    │       └─ routes/           도메인별 라우터
    ├─ public/
    │   ├─ css/
    │   │   ├─ tokens.css        ★SingleSuite 토큰 단일 출처
    │   │   ├─ base.css          리셋·타이포
    │   │   └─ components.css    card · grid · btn · tag · banner · factor
    │   ├─ js/
    │   │   ├─ app.js            부트스트랩
    │   │   ├─ router.js         해시 라우팅
    │   │   ├─ api.js  ui.js  store.js
    │   │   ├─ layout/           gnb.js · sidebar.js
    │   │   ├─ views/
    │   │   │   ├─ quote/        list · wizard(step1~5) · detail
    │   │   │   ├─ master/       policy · code · term · template · customer · risk · labor-rate
    │   │   │   ├─ system/       user · role · dept
    │   │   │   └─ tool/         tco · dispatch
    │   │   └─ components/       grid · preview · validator-banner · factor-list
    │   └─ index.html
    ├─ db/                       ★sql/ → db/ 개명
    │   ├─ migrations/           NNN_YYYYMMDD_설명.sql (번호 재부여)
    │   └─ seeds/
    ├─ assets/                   (유지)
    └─ test/
        ├─ engine/  validation/  api/  e2e/
```

### 2.1 파일 이동 매핑

| AS-IS | TO-BE |
|---|---|
| `quote/lib/db.js` | `src/infra/db.js` |
| `quote/lib/auth.js` | `src/infra/auth.js` |
| `quote/lib/quote-engine.js` | `src/domain/pricing/engine.js` |
| `quote/lib/quote-service.js` | `src/domain/quote/service.js` |
| `quote/lib/numbering.js` | `src/domain/quote/numbering.js` |
| `quote/lib/quote-pdf.js` / `quote-html.js` | `src/domain/render/pdf.js` / `html.js` |
| `quote/lib/excel.js` | `src/domain/render/excel.js` |
| `quote/lib/labor-standard.js` | `src/domain/labor/standard.js` |
| `quote/routes/*.js` | `src/web/routes/*.js` |
| `quote/sql/*.sql` | `db/migrations/` (번호 재부여) |
| `quote/seed/*` | `db/seeds/` |
| `quote/PLAN*.md` `PROMPT*.md` | `docs/archive/` |
| 루트 `check*.js` `verify.js` | `tools/check/` |
| 루트 `initdb.js` `applyschema.js` `seeddb.js` | `tools/db/` |
| 루트 `setadmin.js` `cleanup.js` `dbtest.js` `forceseed.js` | `tools/ops/` |

---

## 3. 화면 구성 개편

### 3.1 라우트 매핑

| AS-IS 라우트 | TO-BE 라우트 | 처리 |
|---|---|---|
| `#/quotes` | `#/quotes` | 개편 — 통계 카드 4종, 인건비 배율 컬럼, 열람 상태 추가 |
| `#/quotes/new` (editor.js) | — | **폐기** — 섹션형 레거시 |
| `#/quotes/new-template` (quote-block.js) | `#/quotes/new` → 위저드 5단계 | 전환 — 블록형 로직을 위저드 STEP③④로 분해 |
| `#/quotes/:id` | `#/quotes/:id` | 유지 + 발송·열람 이력 탭 추가 |
| `#/master` | `#/master/customer` 외 분리 | 분해 — 마스터별 개별 화면 |
| `#/pricing` | `#/master/policy` | 개편 — 정책 버전 관리 추가 |
| `#/labor-rates` | `#/master/labor-rate` | 유지 (경로만) |
| `#/templates` | `#/master/doc-template` | 개편 — 메일 템플릿 통합 |
| `#/settings` | `#/system/settings` | 유지 |
| — | `#/master/code` | 신규 — 공통코드 |
| — | `#/master/term` | 신규 — 견적조건 문구 |
| — | `#/master/risk` | 신규 — 리스크 계수 |
| — | `#/system/user` `#/system/role` `#/system/dept` | 신규 |
| — | `#/dispatch` | 신규 — 발송·열람 현황 |
| — | `#/tco` | 신규 — TCO 비교 |
| — | `#/approvals` | 신규 — 승인 요청함 |

### 3.2 사이드바 (시안 기준)

```
견적관리   견적 목록 · 견적 작성 · 승인 요청함 · 발송·열람 현황
시뮬레이션 TCO 비교
기준정보   가격정책 · 고객사 · 리스크 계수 · 노임단가 · 공통코드 · 견적조건 문구 · 메일·문서 템플릿
시스템관리 사용자 · 역할·권한 · 조직
```

이모지 아이콘 전부 제거하고 Lucide 16px 인라인 SVG로 교체합니다.

---

## 4. DB 재편

### 4.1 신규 테이블 (기획서 6.4)

```
승인·발송    sq_quote_approval · sq_quote_send · sq_quote_open_log · sq_quote_version
정책         sq_mst_policy · sq_mst_grade_price · sq_mst_rule · sq_mst_risk_factor
코드·문구    sq_mst_code · sq_mst_code_item · sq_mst_term_template
템플릿       sq_mst_mail_template · sq_mst_doc_template
조직·권한    sq_mst_dept · sq_mst_role · sq_mst_role_menu · sq_mst_role_limit
```

`sq_users`는 `dept_id` `role_id` `emp_no` `status` `last_login_at` 컬럼을 확장합니다.

### 4.2 정리 대상 (STEP 8)

| 테이블 | 처리 | 선행 조건 |
|---|---|---|
| `sq_labor_rates` | DROP | `sq_labor_rate_lines`로 완전 대체 확인 |
| `sq_quote_sections` | DROP | `sq_quote_blocks` 마이그레이션 완료 확인 (5-C에서 12블록 생성, 금액 불일치 0건) |
| `sq_nego_rates` | 검토 후 결정 | `042_drop_old_nego.sql` 이력 확인 필요 |

---

## 5. STEP별 작업

### STEP 0 — 기준선 고정 (0.5일)

- [ ] 현행 브랜치에서 `refactor/restructure` 분기
- [ ] `npm test` 전체 통과 확인 → **기준선 로그를 `docs/baseline-test.log`로 저장**
- [ ] 실측 PDF 3종(하겐다즈·솔브레인·SK이터닉스) 생성 → `docs/baseline-pdf/`에 보관
- [ ] DB 스키마 덤프 → `docs/baseline-schema.sql`
- [ ] 운영 DB 백업 (5-C 때와 달리 이번엔 파괴적 변경 있음 — 생략 금지)

**DoD** 기준선 3종(테스트 로그·PDF·스키마)이 보관되고, 이후 모든 STEP에서 비교 가능하다.

---

### STEP 1 — 디렉토리 재배치 (1일) · 순수 이동

로직 수정 금지. `git mv`만 사용합니다.

- [ ] `tools/{db,check,ops}/` 생성 후 루트 스크립트 14개 이관
- [ ] 이관 스크립트의 `require` 경로 수정 (`./quote/lib/db` → `../../quote/src/infra/db`)
- [ ] `quote/docs/archive/` 생성 후 `PLAN*.md` `PROMPT*.md` 이관
- [ ] `quote/src/` 트리 생성 후 §2.1 매핑대로 이동
- [ ] `quote/sql/` → `quote/db/migrations/`, `quote/seed/` → `quote/db/seeds/`
- [ ] SQL 파일 번호 재부여 (042 충돌 해소, `NNN_YYYYMMDD_설명.sql`)
- [ ] `quote/db/migrations/README.md`에 구번호↔신번호 대조표 기록
- [ ] `server.js`에서 라우터 등록을 `src/web/router.js`로 분리
- [ ] `test/` 하위 폴더 분류 (engine/validation/api/e2e)
- [ ] 전체 `require` 경로 정리 후 `npm test`

**DoD** `npm test` 결과가 STEP 0 기준선과 **동일**. PDF 3종이 기준선과 바이트 단위 동일하지 않더라도 레이아웃 육안 대조 통과.
**커밋** `refactor(quote): 디렉토리 구조 재배치 — 로직 변경 없음`
**리스크** 경로 누락으로 런타임 오류. → 이동 후 `grep -rn "require('\.\./lib" src/`로 잔존 참조 확인.

---

### STEP 2 — 디자인 토큰 통일 (1일)

- [ ] `public/css/tokens.css` 신설 — SingleSuite 표준값으로 교체

```css
--primary:#0747A6; --primary-weak:#E8F0FB; --navy:#0F172A;
--line:#DFE1E6; --text:#172B4D; --gnb-h:56px; --side-w:224px;
--radius:3px;   /* 8px → 3px, ERP 지향 */
```

- [ ] `app.css` 174줄을 `base.css` + `components.css`로 분리
- [ ] 시안의 컴포넌트 클래스 이식: `.card` `.grid` `.btn` `.tag` `.banner` `.factor` `.steps` `.calc` `.pv`
- [ ] 사이드바 이모지(`👷` `⚙` `₩` `▤` `▦` `＋`) → Lucide 16px 인라인 SVG
- [ ] GNB 56px 상단바 신설 (현재 사이드바만 존재)
- [ ] 금액 표기에서 `₩` 제거, 단위는 컬럼 헤더로 이동
- [ ] 기존 9개 화면이 신 토큰에서 깨지지 않는지 육안 점검

**DoD** 기존 전 화면이 SingleSuite 토큰으로 렌더되고, 이모지·₩ 기호가 0건.
**커밋** `style(quote): SingleSuite 디자인 토큰 통일`

---

### STEP 3 — 견적 작성 위저드 전환 (2일)

`editor.js`(레거시 섹션형)를 폐기하고 `quote-block.js` 로직을 5단계 위저드로 분해합니다.

- [ ] `public/js/views/quote/wizard/` 신설, `step1~step5.js` 생성
- [ ] `quote-block.js` 389줄을 STEP③(구성)·STEP④(인건비)로 분해
- [ ] STEP① 기본정보 — 고객사 선택 시 기업구분 자동 로드, 회사정보 읽기전용 블록
- [ ] STEP② 유형 선택 — 5종 카드 + 유효 정책 버전 표시
- [ ] STEP③ 구성 — 좌 입력 / 우 실시간 미리보기 분할, 옵션 선택 시 라인 자동 생성
- [ ] STEP⑤ 검토·발행 — 검증 배너 + 미리보기 + 산출물 버튼
- [ ] `components/preview.js` — 견적서 레이아웃 실시간 미리보기 (PDF HTML 재사용)
- [ ] `#/quotes/new` 라우트를 위저드로 교체, `new-template` 라우트 제거
- [ ] `editor.js` 삭제 + `renderEditor` 참조 제거
- [ ] 견적번호 `SYYYYMMDD###` → `QT{YYYYMMDD}_{NNN}` 변경, 기존 번호는 조회 호환 유지

**DoD** 실측 3종을 위저드로 재작성했을 때 STEP 0 기준선 PDF와 금액·레이아웃 일치. `editor.js` 참조 0건.
**커밋** `feat(quote): 견적 작성 5단계 위저드 전환, 레거시 에디터 폐기`
**리스크** 견적번호 변경이 기존 데이터 조회를 깬다. → 채번 로직만 교체하고 기존 레코드는 그대로 둔다.

---

### STEP 4 — 산정 엔진 확장 (1.5일)

- [ ] `src/domain/pricing/models/` 신설, 기존 4모델을 파일 분리
- [ ] `grade.js` — 기업구분 → 등급정가 조회 (대기업군 60,000,000 / 공공 45,000,000 / 중견중소 40,000,000)
- [ ] `rate.js` — 기준금액 × 요율 (유지보수 15%, 이중화 50%, 계열사 25%)
- [ ] `md.js` — MD 단가 × 공수 (추가개발, Percall)
- [ ] `src/domain/labor/risk-factor.js` — 리스크 계수 적용 (원격불가 ×1.8, 금융권 ×1.4, 인터페이스 +0.5MM/건 …)
- [ ] 인건비 배율 산출 — 정책 기준 대비 배수 반환
- [ ] `engine.js`는 모델 디스패처로만 남기고 계산은 모델 파일로 위임
- [ ] 실측 딜 5건(K뱅크·삼정·삼성생명·한화투자증권·교보생명) 테스트 케이스 추가

**DoD** 기존 17종 + 신규 5종 = 22종 실측 재현 통과.
**커밋** `feat(pricing): GRADE·RATE·MD 모델 및 리스크 계수 엔진 추가`

---

### STEP 5 — 마스터 재편 (2일)

- [ ] `db/migrations/` 신규 DDL — §4.1 테이블 전부
- [ ] `sq_mst_policy` 시드 — 기존안/신규안/2026년안 3버전, 2026년안만 활성
- [ ] `sq_mst_grade_price` 시드 — 등급별 정가 + 툴킷
- [ ] `sq_mst_rule` 시드 — 이중화 0.5 / 계열사 0.25 / 유지보수 0.15 / PC유지보수 0.5
- [ ] `sq_mst_risk_factor` 시드 — 리스크 팩터 6종
- [ ] `sq_mst_code` / `_item` 시드 — 기업구분·견적유형·견적상태·채널·역할등급·리스크팩터·결제조건·부가세구분
- [ ] `sq_mst_term_template` 시드 — 유형별 필수/조건부 문구, 치환변수 포함
- [ ] `sq_mst_mail_template` 시드 — 발송 4종
- [ ] `sq_mst_doc_template` 시드 — 유형별 섹션 구성 5종
- [ ] `src/master/*` CRUD 서비스 + `src/web/routes/master/*`
- [ ] 화면: `#/master/policy` `#/master/code` `#/master/term` `#/master/risk` `#/master/doc-template`
- [ ] 정책 버전 전환 시 작성중 견적에 "반영하시겠습니까?" 프롬프트

**DoD** 시안의 가격정책 마스터·공통코드·문구·템플릿 4화면이 실데이터로 동작. 밴드 2종 병존 상태가 화면에 노출된다.
**커밋** `feat(master): 정책·코드·문구·템플릿 마스터 신설`
**선결** 기획서 10장 1~4번(유효 정책 버전, 밴드 단일화, SaaS 최소건수·셋업비, 리스크 계수 초기값) 확정 필요. **미확정 시 STEP 5 착수 불가.**

---

### STEP 6 — 검증 엔진 (1일)

- [ ] `src/domain/validation/rules/` — R-01~R-16 규칙 파일 16개
- [ ] `runner.js` — 규칙 실행 후 `{level, code, message, target}` 배열 반환
- [ ] ERROR 존재 시 발행 API 차단 (서버 측 강제, 프론트 비활성화만으로는 부족)
- [ ] `components/validator-banner.js` — 배너에서 해당 입력 위치로 이동
- [ ] R-08~R-11(정책 정합) 우선 구현 — 하겐다즈 사례 재현 테스트
- [ ] R-12 인건비 배율 임계 → 승인 요청 전환

**DoD** 하겐다즈 견적을 그대로 입력하면 ERROR 2건(R-10 셋업비 0원, R-11 최소밴드 미달)으로 발행이 막힌다.
**커밋** `feat(validation): 발행 전 검증 규칙 R-01~R-16`

---

### STEP 7 — 권한·승인·발송 (2일)

- [ ] `sq_mst_dept` / `_role` / `_role_menu` / `_role_limit` DDL + 시드(6역할)
- [ ] `sq_users` 확장 및 기존 ADMIN/USER → 신규 역할 매핑
- [ ] `src/web/middleware/permission.js` — 메뉴 권한 + 발행 한도 + 배율 상한
- [ ] 화면: `#/system/user` `#/system/role` `#/system/dept`
- [ ] 승인 워크플로우 — `sq_quote_approval`, `#/approvals` 화면
- [ ] `sq_quote_version` — 발행 시 스냅샷 저장 (마스터 변경이 기발행 견적에 영향 없음)
- [ ] 발송 — `src/domain/dispatch/mail.js`, 메일 템플릿 치환
- [ ] 열람 추적 — `sq_quote_send` / `sq_quote_open_log`, 링크 클릭 기준 토큰
- [ ] 화면: `#/dispatch` 발송·열람 현황 + 타임라인
- [ ] 자동 리마인드 3종 (미열람 7일 / 유효일 5일 전 / 재열람 2회)

**DoD** 영업담당 계정으로 3억 견적 발행 시 승인 요청으로 전환된다. 발송 후 링크 클릭이 열람 로그에 기록된다.
**커밋** `feat(system): 역할·권한·승인 워크플로우 및 발송 열람추적`
**선결** 발신 도메인 SPF/DKIM 설정 확인 (기획서 10장 8번)

---

### STEP 8 — 레거시 정리 (0.5일)

- [ ] `sq_labor_rates` 사용처 grep → 0건 확인 후 DROP
- [ ] `sq_quote_sections` 사용처 확인 후 DROP (`sq_quote_items.section_id` 처리 포함)
- [ ] `sq_nego_rates` 존치 여부 판단
- [ ] `views/master.js`(603줄) 분해 잔여분 정리
- [ ] `routes/pricing.js`(201줄) → 마스터 라우터로 흡수
- [ ] 미사용 시드 파일 정리
- [ ] `docs/PLAN.md` 갱신 — 현행 구조 반영

**DoD** 데드코드 0건, 전체 테스트 통과, 스키마 덤프가 §4 목표와 일치.
**커밋** `chore(quote): 레거시 테이블·코드 정리`

---

### STEP 9 — TCO·AI 계층 (별도 판단)

기획서 5.4에 따라 **데이터 축적 후** 착수합니다. STEP 8까지 완료하고 파일럿 운영 이후 재검토.

- [ ] `#/tco` — Summary·TCO 시트 화면화 (5개 구축형태 5년/10년)
- [ ] AI ⑤ 정합성 설명 — 검증 결과 자연어화
- [ ] AI ③ 문구 생성
- [ ] AI ① RFP 분석
- [ ] AI ② 유사 견적 RAG — 견적 50건 이상 축적 후

---

## 6. 일정 요약

| STEP | 내용 | 기간 | 누적 |
|---|---|---|---|
| 0 | 기준선 고정 | 0.5일 | 0.5 |
| 1 | 디렉토리 재배치 | 1일 | 1.5 |
| 2 | 디자인 토큰 통일 | 1일 | 2.5 |
| 3 | 위저드 전환 | 2일 | 4.5 |
| 4 | 산정 엔진 확장 | 1.5일 | 6 |
| 5 | 마스터 재편 | 2일 | 8 |
| 6 | 검증 엔진 | 1일 | 9 |
| 7 | 권한·승인·발송 | 2일 | 11 |
| 8 | 레거시 정리 | 0.5일 | 11.5 |
| 9 | TCO·AI | 별도 | — |

**STEP 0~3(4.5일)이 구조 개편, STEP 4~8(7일)이 기능 확장**입니다. STEP 3까지 마치면 기능은 그대로인 채 구조와 화면만 새것이 되므로, 여기서 한 번 끊어 배포해도 무방합니다.

## 7. 진행 규칙

- STEP 완료 시: DoD 체크 + `npm test` + 변경 요약 보고 → 사용자 승인 → 다음 STEP
- STEP 1은 **로직 수정 절대 금지**. 이동 중 발견한 버그는 이슈로만 기록하고 STEP 8에서 처리
- STEP 3·5·7 진입 전 커밋 + DB 백업 태그
- 매 STEP에서 `test/engine/quote-block.test.js` 17종이 회귀 방어선. 하나라도 깨지면 진행 중단
