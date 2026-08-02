# CLAUDE.md — 세포아소프트 견적 자동화 시스템

> 이 문서는 Claude Code가 `quote/` 에서 작업할 때 반드시 따라야 하는 **프로젝트 규칙**이다.
> 작업 시작 전 이 파일과 `docs/WBS.md`, `docs/ui-mockup.html` 을 먼저 확인한다.

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 프로젝트명 | 세포아소프트 견적 자동화 시스템 |
| 사용 주체 | 세포아소프트 **영업팀** |
| 목적 | 3솔루션(경비관리·전자구매·전자인장) 견적을 템플릿 선택 → 자동계산 → PDF 로 생성 |
| 산출물 | 견적서 PDF(본문), 임금단가·템플릿·모듈 마스터 관리 화면 |

---

## 2. 기술 스택

| Layer | 선택 |
|---|---|
| Runtime | Node.js (>=18) |
| Server | Express |
| DB | **MariaDB** — 모든 테이블 `sq_` 접두어. mysql2 직접 사용 |
| PDF | **헤드리스 Chrome** (`lib/quote-pdf.js`). 설치된 Chrome/Edge 사용, 경로는 `CHROME_PATH` |
| Front | 정적 ES 모듈(`public/js/views/*.js`) — 빌드 도구 없음 |
| 인증 | Google SSO, `AUTH_MODE=dev` 시 개발용 로그인. 역할 ADMIN / USER |
| Port | 3100 |

Playwright/Puppeteer는 **쓰지 않는다.** Chromium 150MB 다운로드가 폐쇄망 배포에서 문제가 되어
시스템 Chrome 헤드리스로 대체했다.

---

## 3. 정본 문서 (화면 작업 전 필수 확인)

| 문서 | 역할 |
|---|---|
| `docs/WBS.md` | **개편 계획 정본.** 작업 범위·순서는 여기를 따른다 |
| `docs/ui-mockup.html` | **UI 정본.** 화면 구조·간격·컴포넌트는 이 목업을 기준으로 구현한다 |

화면(레이아웃/컴포넌트/스타일)을 만들거나 고치기 전에 **반드시 두 문서를 먼저 읽는다.**
목업과 다르게 구현해야 할 이유가 생기면 임의로 바꾸지 말고 먼저 확인을 받는다.

---

## 4. 디자인 토큰

핵심 값:

| 항목 | 값 |
|---|---|
| Primary | `#0747A6` |
| Sidebar (navy) | `#0F172A` |
| GNB 높이 | `56px` |
| 폰트 | Pretendard (본문 13px) |
| 아이콘 | Lucide, `16px` |
| Radius | `3px` |

전체 토큰은 `docs/ui-mockup.html` 의 `:root` 가 **단일 출처**다. 값을 임의로 만들지 말고 그대로 옮긴다.

```css
--primary:#0747A6; --primary-weak:#E8F0FB; --primary-hover:#063A87;
--navy:#0F172A;    --navy-2:#1E293B;       --navy-3:#334155;
--line:#DFE1E6;    --line-2:#EBECF0;
--text:#172B4D;    --text-2:#5E6C84;       --text-3:#8993A4;
--bg:#F4F5F7;      --white:#fff;
--danger:#DE350B;  --danger-bg:#FFEBE6;
--warn:#FF8B00;    --warn-bg:#FFFAE6;
--ok:#00875A;      --ok-bg:#E3FCEF;
--gnb-h:56px;      --side-w:224px;         --radius:3px;
```

**ERP 지향 고밀도 레이아웃**을 기본으로 한다. 여백을 넓게 잡는 소비자용 디자인이 아니라,
한 화면에 정보가 많이 들어가는 업무 시스템 밀도를 유지한다.

> 현행 `public/css/app.css` 는 아직 구 토큰(`--navy #1e2d4e` / `--accent #1a56aa` / `radius 8px`)을
> 쓴다. 교체는 WBS STEP 2 작업이다.

---

## 5. 금지 규약 (위반 금지)

- **금액에 `₩` 기호 금지.** 숫자만 표기하고 단위는 **컬럼 헤더**에 쓴다. (예: 헤더 `제안금액(원)`)
- **그리드 내 이모지 금지.** 상태 표시는 텍스트 또는 색상으로 한다.
- **Excel 내보내기 버튼 배치 금지.** 그리드 우측 상단 등 어디에도 두지 않는다.
- **배지형 건수 표시 금지.** (예: 탭 옆 `12` 알약 배지)

---

## 6. 계산 규약 (고정)

계산 순서는 **고정이며 바꾸지 않는다.**

```
블록 소계 합  →  특별DC  →  십만단위 절사  →  VAT 별도
```

- **일시불 / 월(recurring) 을 분리**해 산출한다. 월 금액은 절사하지 않는다(밴드 금액이 깨진다).
- 특별DC는 일시불과 월에 **각각 별도로** 걸 수 있다 (`discount` / `monthly_discount`).
- 구현: `lib/quote-engine.js` 의 `calcQuoteBlocks()`. 엔진과 PDF 양쪽이 같은 순서를 쓴다.
- 블록 7종: `SOLUTION` / `SETUP` / `LICENSE` / `LABOR` / `SERVICE` / `DATASVC` / `SUMMARY`
  (`SERVICE`·`DATASVC` 는 recurring)

---

## 7. 회귀 방어선

`test/quote-block.test.js` (**20종**) 은 실측 견적서를 재현하는 회귀 테스트다.
**어떤 작업에서도 깨뜨리지 않는다.** 하나라도 실패하면 진행을 멈춘다.

| 사례 | 검증값 |
|---|---|
| 솔브레인 전자계약 | 솔루션 50,000,000 + 인건비 36,600,000 = 86,600,000 → 특별DC → **60,000,000** |
| 솔브레인 전자인장계약 | 솔루션 70,000,000 → 106,600,000 → **80,000,000** |
| SK이터닉스 PCloud | 일시납 104,400,000 → **100,000,000** / 월 **1,275,000** |
| 하겐다즈 SaaS | 셋업 2,000,000 → **무상제공(0)** / 월 300,000 → **100,000** |

근거 원본은 `assets/인장/*.pdf`. 이 숫자가 바뀌면 **코드가 아니라 실측이 바뀐 것**이므로,
테스트를 고치기 전에 반드시 원본 PDF와 대조하고 확인을 받는다.

테스트를 통과시키려고 기대값을 수정하는 것은 금지한다.

---

## 8. 자주 쓰는 명령

```bash
npm start                 # 서버 실행 (3100)
npm run dev               # --watch
npm test                  # 전체 테스트
npm run migrate           # db/migrations/NNN_YYYYMMDD_*.sql 순차 적용 (전부 멱등이어야 함)
npm run seed:phase5       # 마스터 시드 (존재 시 skip)
node db/seeds/phase5.js --force=labor,blocks,conditions,modules,templates   # 섹션 지정 재투입
```

- 마이그레이션 파일명은 `NNN_YYYYMMDD_설명.sql`. **NNN 이 실행 순서**이고 날짜는 정보용이다.
  구번호 대조표는 `db/migrations/README.md`.
- 러너는 적용 이력을 **`sq_migrations`**(`filename` PK / `checksum` / `applied_at` / `note`)에
  남긴다. 이력에 없는 파일만 적용하고, **이력에 있으나 체크섬이 다르면 경고 후 중단**한다
  (자동 재적용 금지). 적용 전후 행수를 로그로 남긴다.
- 마이그레이션 파일은 **항상 멱등**으로 쓴다 (`ADD COLUMN IF NOT EXISTS`, `NOT EXISTS` 가드,
  `WHERE ... IS NULL` 백필). 이력이 생겨도 복원·재구축 시 파일은 처음부터 다시 돈다.
  **문법적 멱등과 의미적 멱등은 다르다** — `006` 백필이 "onetime_total = 0" 을 미적용으로
  오판해 무상제공 견적을 매 실행마다 손상시킨 전례가 있다. 조건 없는 `UPDATE`·`DELETE` 금지.
- **`DELIMITER` 를 쓰지 말 것.** 러너가 세미콜론으로 구문을 쪼개므로 프로시저 본문이 파열된다
  (`009`·`021` 이 이것으로 실패했고 2026-08-02 에 `ADD COLUMN IF NOT EXISTS` 로 치환했다).
- 기존 마이그레이션 파일은 수정하지 말고 새 번호 파일을 추가한다. 부득이 수정하면 체크섬이
  어긋나 러너가 멈추므로 `--baseline` 으로 이력을 갱신해야 한다.
- **파일명을 바꾸면 이력이 깨진다**(이력 키가 파일명). 재번호 시 `sq_migrations.filename` 도 갱신.

---

## 9. 커밋 규칙

- **작업 단위로 하나씩 커밋한다.**
- **이동(rename)과 로직 수정을 같은 커밋에 섞지 않는다.** 파일을 옮겼으면 이동만 커밋하고,
  내용 수정은 다음 커밋으로 분리한다. (diff 가 rename 으로 인식되어야 리뷰가 가능하다)
- 영역 prefix 필수: `feat/fix/docs/refactor`
- 이모지 사용 금지. 한글 본문 허용.

```
feat(5-C): 블록형 견적 계산 — 일시불/월 분리
fix(quote): 특별DC TARGET 0 을 할인 없음으로 처리하던 버그 수정
refactor(quote): 견적 뷰를 views/quote/ 로 이동
docs: WBS 3장 보완
```

---

## 10. 데이터 모델 요약

```
sq_quotes            견적 헤더 (quote_type, deployment, template_code,
                     onetime_total, monthly_total, discount_*, round_unit)
  └ sq_quote_blocks  견적 내 블록 인스턴스 (block_code, subtotal, recurring)
       ├ sq_quote_items   2단가 스냅샷 (base_price=기준단가, proposed_price=제안단가)
       └ sq_quote_labor   인건비 (mm, base/proposed, month_alloc JSON)

sq_quote_templates   솔루션×구축형태 프리셋 (+ _blocks / _items / _labor)
sq_blocks            블록 정의    sq_condition_sets/_lines  견적조건
sq_labor_rate_years / _lines      연도별 임금단가 (apply_price = 인건비 기준단가)
sq_price_items / _variants        모듈 마스터 + 건수 밴드
```

**스냅샷 원칙**: 저장된 견적은 임금단가·가격정책이 나중에 바뀌어도 값이 변하지 않는다.
기준단가·제안단가를 견적 행에 그대로 복사해 둔다.

---

## 11. 개편 진행 중 주의 (WBS STEP 1~8)

현재 구조는 `docs/WBS.md` 의 목표 구조로 이동하는 중이다. 작업 전 WBS 의 해당 STEP 을 읽는다.

- **STEP 1 은 순수 이동이다.** `git mv` 만 쓰고 로직은 건드리지 않는다.
  이동 중 발견한 버그는 고치지 말고 기록만 하고 STEP 8 에서 처리한다.
- **엔진과 PDF 는 이동만 한다** — `lib/quote-engine.js` → `src/domain/pricing/engine.js`,
  `lib/quote-*.js` → `src/domain/render/`. 로직 변경 금지.
- 견적 작성 정본은 **`quote-block.js`(블록형)** 이다. `editor.js`(섹션형)는 STEP 3 에서 폐기한다.
  둘 다 살아 있는 동안 새 기능을 `editor.js` 에 넣지 않는다.
- 레거시 테이블(`sq_labor_rates`, `sq_quote_sections`)은 STEP 8 전까지 **드롭하지 않는다.**
- 견적번호는 STEP 3 에서 `SYYYYMMDD###` → `QT{YYYYMMDD}_{NNN}` 로 바뀐다. 기존 레코드는 유지한다.

## 12. 알려진 미완 사항

- 경비(EXPENSE)·전자구매(PROCURE) 모듈 마스터 34건 미등록 → 해당 템플릿은 견적 작성 불가.
  추출 원본은 `assets/무전표_온프레미스.pdf`, `assets/전자구매_온프레미스.pdf`.
- PDF 에 "클라우드서비스 결제 방안" 표 미구현 (실측 SaaS/PCloud 하단에 존재).
- 견적 작성 화면의 필수/COMMON 모듈 뱃지 토글 미구현.
- 금액 `₩` 기호가 PDF 상단 총견적가에 남아 있다(실측 양식을 따른 것). 5절 규약을 PDF 에도
  적용할지 미결 — 화면에만 적용하고 PDF 는 실측 유지가 현재 상태.
