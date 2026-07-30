# Phase 5 (재설계판) — 견적 유형 · 블록 · 인건비 · PDF 전면 개편

> 상태: **승인 대기**. 기존 Phase 5 초안(quote-phase5.zip)은 **폐기**하고 이 문서로 대체한다.
> 근거: 전자인장 견적서 실물 5종(하겐다즈 SaaS / 솔브레인 온프레미스 2건 / 강원랜드 유지보수 / 교보AXA 추가개발 / SK이터닉스 Private Cloud) 분석.
> 이번 범위: **BUILD(구축/서비스)만**. 유지보수·추가개발은 Phase 6으로 분리.

## 0. 확정 결정사항

| 항목 | 결정 |
|---|---|
| 이번 구현 범위 | **BUILD**(온프레미스 일시불/분납, SaaS, Private Cloud)만. MAINT/ADDDEV는 Phase 6 |
| 커버 페이지 | 시스템에서 만들지 않음(별도 구성). 견적 본문 PDF만 생성 |
| 인력투입계획표(월별 공수) | **옵션**. 켜면 인건비 라인에 월별 배분(M/M1/M2/M3…) 입력 + 부속표 출력 |
| 최종 출력 | **PDF** (Excel은 후순위/선택) |
| 임금단가 | 한국SW산업협회 연도별. 산정식(평균임금×20.5 → 제경비110% → 기술료20%) 재현 검증 완료. 표의 확정 apply_price 저장 |

## 1. 견적 유형 체계 (신규 최상위 개념)

```
quote_type: BUILD | MAINT | ADDDEV   (이번엔 BUILD만)
  └ BUILD 내부 deployment: ONPREM_LUMP | ONPREM_INSTALL | SAAS | PCLOUD
       └ template (솔루션×deployment 프리셋)
            └ blocks (아래 블록의 조합)
```

MAINT(유지보수)·ADDDEV(추가개발)는 계산·양식이 근본적으로 달라 별도 유형으로 Phase 6에서 구현. 스키마에는 quote_type 컬럼을 지금 넣어 확장 대비.

## 2. 블록 종류 (실측 확정 — 7종)

| block_code | 이름 | 컬럼 | 계산 | 등장 |
|---|---|---|---|---|
| SOLUTION | 솔루션 견적 | 구분·모듈·세부기능·수량·기준단가·제안단가·제안금액 | 제안금액=제안단가×수량 | 온프레미스 |
| SETUP | 셋업비용 | 구분·세부기능·수량·기준단가·제안단가·제안금액 | =제안단가×수량 | SaaS/PCloud |
| LICENSE | 라이선스비용 | 구분·세부기능·수량·기준단가·제안단가·제안금액 | =제안단가×수량 | PCloud |
| LABOR | 시스템 구축(개발인건비) | 구분·역할(등급)·세부내역·공수(MM)·기준단가·제안단가·제안금액 | 기준단가=임금단가 apply_price, 제안금액=제안단가×공수 | 온프레미스 |
| SERVICE | 서비스 이용료(월) | 구분·모듈/기능·수량·기준단가·제안단가·제안금액(월) | =제안단가×수량, recurring | SaaS/PCloud |
| DATASVC | 데이터서비스(월) | 구분·모듈·세부기능·수량·기준단가(월)·제안단가(월)·제안금액(월) | =제안단가×수량, recurring, optional | 경비 등 |
| SUMMARY | 합계/절사 | — | 소계 합산, 특별DC, 십만단위 절사, VAT별도 | 전체 |

**소계/합계 규칙 (실측):**
- 각 블록 소계 = Σ제안금액
- 온프레미스: 솔루션소계(①) + 인건비소계(②) = Total → **특별DC 적용** → 최종견적금액(십만단위 절사)
- SaaS/PCloud: 셋업(일시납) 합계와 월사용료(SERVICE) 합계를 **분리 표기**. PCloud는 셋업+라이선스=일시납합계 → 최종셋업비(특별DC)
- 표지 상단 "총견적가"에 일시불/월 금액 별도 노출

## 3. 인건비(LABOR) 모델 — 핵심

```
견적 인건비 라인:
  role_code    → 임금단가 마스터 참조 (PM/DEV/UIUX/QA/CONSULTANT/ARCHITECT/SUPPORT)
  role_label   → "PM", "개발", "기술지원" 등 표기명
  grade        → 등급(고급/중급/초급) 표기용
  task         → 세부내역
  base_price   → 임금단가 apply_price (해당 연도 active 자동, 스냅샷)
  proposed_price → 제안단가(네고가, 수기)
  mm           → 총 공수(MM)
  amount       → proposed_price × mm
  월별배분(옵션): month_alloc JSON = {"M":0.25,"M1":0.25,"M2":0.25,"M3":0.25}
                 Σ배분 = mm 여야 함(검증). 인력투입계획표 부속 출력용
```

임금단가 산정식(참고, 표의 확정값을 우선 저장):
`평균임금(M/M)=노임단가(M/D)×20.5 → 제경비=평균임금×1.1 → 기술료=(평균임금+제경비)×0.2 → apply=합`

## 4. 스키마 (sq_ 접두어, 신규 002_phase5.sql — 초안 폐기 후 재작성)

```
-- 공통 마스터
sq_labor_rate_years   id, year UNIQUE, source, active, note
sq_labor_rates        id, year_id FK, role_code, role_name, grade, wage_md,
                      wage_mm, overhead, tech_fee, apply_price, note
                      UNIQUE(year_id, role_code)
sq_blocks             code PK, name, columns JSON, calc, recurring, optional, sort
sq_condition_sets     code PK, name
sq_condition_lines    id, set_code FK, line_no, text

-- 템플릿
sq_quote_templates    id, quote_type, solution, code UNIQUE, name, deployment,
                      brand, condition_set FK, has_labor_plan TINYINT, active, sort
sq_template_blocks    id, template_id FK, block_code FK, sort
sq_template_items     id, template_id FK, block_code, item_code, qty_default, sort
sq_template_labor     id, template_id FK, role_code, role_label, grade, task, mm_default, sort

-- 견적 (유형/블록/2단가/인건비 수용)
sq_quotes             (기존) + quote_type, deployment, template_code,
                      onetime_total, monthly_total,   -- 일시불/월 분리
                      discount_type, discount_value, round_unit(기본100000)
sq_quote_blocks       id, quote_id FK, block_code, title, subtotal, sort  -- 견적 내 블록 인스턴스
sq_quote_items        id, block_id FK, item_code, category, name, spec, qty, unit,
                      base_price, proposed_price, amount, note, sort  -- 2단가 스냅샷
sq_quote_labor        id, block_id FK, role_code, role_label, grade, task, mm,
                      base_price, proposed_price, amount, month_alloc JSON, sort
```

기존 Phase 0~4의 sq_quote_sections/items는 이 구조로 마이그레이션(블록 개념으로 승격). 데이터 있으면 백필, 없으면 재생성.

## 5. REST API

```
[임금단가] (전용 화면)
GET  /api/labor-rates?year= / GET /api/labor-rates/years
POST /api/labor-rates/years (직전연도 복제) / PUT /api/labor-rates/:id / PATCH years/:id/active

[블록/조건/템플릿]
GET  /api/blocks  GET /api/conditions
GET  /api/templates?quote_type=BUILD&solution=   GET /api/templates/:code
POST/PUT (ADMIN)

[견적]
POST /api/quotes/apply-template   {template_code,...} → 블록/기본모듈/인건비 기본 채운 초안(미저장)
POST /api/quotes/calculate        블록 소계 + 인건비 + 일시불/월 분리 + 특별DC + 절사 + VAT
POST /api/quotes  GET /api/quotes  GET/PUT/PATCH/DELETE /api/quotes/:id
GET  /api/quotes/:id/pdf          PDF 생성(본문, 커버 제외)
```

## 6. PDF 출력 (핵심 산출물)

- 스택: **Playwright(Chromium) HTML→PDF** 권장. HTML 템플릿으로 실측 양식 재현(연두색 헤더 밴드, 표 테두리, 우측 공급자정보, 인감 오버레이). Puppeteer 대안 가능.
- 페이지 구성: [Quotation 본문(블록 순서대로)] + (옵션)[인력투입계획표] + [임금단가표 첨부]
- 상단 표: 수신/견적용도/결제조건/총견적가(일시불·월 분리)/설치완료 + 견적번호/일자/유효일/상호/대표이사/인감
- 하단: 견적조건(condition_set) + 건수별 제안금액 표(SaaS 밴드) 등 템플릿별 부속
- A4 세로, 십만단위 절사·VAT별도 표기.

## 7. 시드

- **labor-rates-seed.json** (재사용, 산정식 컬럼 추가): 2026 확정값 + wage_mm/overhead/tech_fee/apply_price 분해값
- **templates-seed.json** (재작성): quote_type=BUILD, 전자인장 4종(ONPREM_LUMP/ONPREM_INSTALL/SAAS/PCLOUD) 실측 반영. blocks_master 7종, condition_sets(온프레미스/분납/PCloud/SaaS). 경비·전자구매는 기존 실물 기준 각 구축/서비스 1~2종.
- 전자인장 템플릿 블록 매핑(실측):
  - ONPREM_LUMP: SOLUTION + LABOR (+has_labor_plan 옵션)
  - ONPREM_INSTALL: SOLUTION(무상) + LABOR + SERVICE
  - SAAS: SETUP + SERVICE (+건수밴드표)
  - PCLOUD: SETUP + LICENSE + SERVICE

## 8. Phase 분할 (완료 기준)

- **5-A 공통 마스터** (1일): 002 스키마(공통부) + labor/blocks/conditions 시드. 임금단가 API + 전용 관리 화면(연도 복제/활성지정).
  - 완료: 2026 임금단가 조회·수정, 2027 복제 생성 동작.
- **5-B 템플릿** (1일): 템플릿 스키마+시드(BUILD), 템플릿 API/관리 화면.
  - 완료: quote_type=BUILD, 솔루션별 템플릿 목록/상세(블록·기본모듈·인건비 기본).
- **5-C 견적 작성/계산** (2일): 블록 구조 마이그레이션, apply-template, calculate(일시불/월 분리·특별DC·절사·VAT), 인건비 월별배분(옵션), 견적 작성 UI(블록 카드).
  - 완료: 템플릿 선택→블록 자동생성→모듈 선택·인건비 공수 입력→일시불/월 합계 정확. 저장·재조회. 검증: SK이터닉스 PCloud(일시납 1억/월 1,275,000), 솔브레인 온프레미스(솔루션 5천만+인건비 3,660만→특별DC 6천만) 재현.
- **5-D PDF** (2일): Playwright HTML→PDF, 실측 양식 재현, 인력투입계획표·임금단가표 첨부, 블록/유형별 분기.
  - 완료: 하겐다즈 SaaS / 솔브레인 온프레미스 / SK이터닉스 PCloud 3종 PDF가 실물과 레이아웃 대조 통과.

## 9. 리스크/주의

- 블록 구조 마이그레이션은 기존 견적 데이터 파괴 가능 → 5-C 진입 전 **DB 백업 필수**.
- Playwright는 Chromium 다운로드(약 150MB) 필요 → 사내 Linux 서버 오프라인이면 배포 시 별도 설치 경로 확인.
- 특별DC와 십만단위 절사 순서: 실측은 (소계합 → 특별DC → 절사). calculate에서 이 순서 고정.
- SaaS 건수밴드표는 pricing-seed의 BAND variant를 그대로 출력에 재사용.
- 커버는 범위 외지만 PDF 1페이지 앞에 붙일 수 있게 자리(빈 페이지 or 외부 PDF 병합 훅)만 열어둠.
