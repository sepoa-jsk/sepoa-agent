# Phase 5 — 견적서 템플릿 + 개발인건비 + 2단가 확장

> 상태: **승인 대기 → 승인 시 구현**
> PLAN.md의 후속 단계. 기존 Phase 0~4 구조(quote→sections→items, sq_ 접두어) 위에 확장한다.
> 작성일: 2026-07 기준. 3솔루션 실제 견적서(링네트/호반/SK바이오텍/CJ올리브/SK이터닉스) 역산 반영.

## 0. 배경 — 실제 견적서에서 확인된 사실

모든 솔루션 견적서가 **동일한 뼈대**를 공유한다. 공통은 1벌로 관리하고, 템플릿은 차이(delta)만 갖는다.

- 견적 = 여러 **블록**의 조합: 솔루션견적 / 셋업비용 / 시스템구축(인건비) / 서비스이용료(월) / 데이터서비스(월) / 유지보수
- 모든 금액행은 **기준단가 · 제안단가(네고가) · 제안금액** 2단 구조. (기존 단가 1개 구조를 확장)
- 개발인건비는 **한국SW산업협회 노임단가** 공통 마스터를 역할×공수(MM)로 계산. 매년 갱신.
- 구축형태(ONPREM 일시불/분납, PCLOUD, SAAS)마다 블록 구성·유지보수/컴포넌트 포함여부·하단 견적조건 문구가 다름 → **템플릿**으로 프리셋.

## 1. 공통 레이어 (전 솔루션 1벌, 여기만 고치면 전체 반영)

- **sq_labor_rate_years / sq_labor_rates** — 임금단가 연도별 이력. 연도별 active 플래그. **전용 관리 화면**에서 매년 갱신.
- **sq_blocks** — 블록 정의(컬럼구성/계산방식/소계/recurring 여부). 시드: templates-seed.json의 blocks_master.
- **sq_condition_sets / sq_condition_lines** — 구축형태별 견적조건 문구 세트.
- **공통 모듈** — 기존 solution='COMMON' 재사용(Common, PKI 등).
- **표지·공급자정보** — 기존 sq_settings 재사용.

## 2. 개별 레이어 (솔루션×구축형태)

- **sq_quote_templates** — 템플릿 헤더: solution, code, name, deployment, brand, include_maintenance, include_component, condition_set, sort
- **sq_template_blocks** — 템플릿이 포함하는 블록 목록(순서) → sq_blocks 참조
- **sq_template_items** — 템플릿 선택 시 자동 편입될 기본 모듈(default_items/setup/service/datasvc) → price_items.code 매핑
- **sq_template_labor** — 인건비 블록 기본 투입계획(역할/세부내역/기본 MM) → labor_rates.role_code 참조

시드: templates-seed.json의 templates (경비 2 / 전자구매 2 / 전자인장 4 = 8종 초안).

## 3. 스키마 (sq_ 접두어, 신규 마이그레이션 파일 002_phase5.sql)

```
sq_labor_rate_years   id PK, year INT UNIQUE, source, active TINYINT, created_at
sq_labor_rates        id PK, year_id FK CASCADE, role_code, role_name, grade,
                      wage_md BIGINT, wage_mm BIGINT, apply_price BIGINT, note
                      UNIQUE(year_id, role_code)
sq_blocks             code PK, name, columns JSON, calc, has_subtotal TINYINT,
                      recurring TINYINT, optional TINYINT, sort
sq_condition_sets     code PK, name
sq_condition_lines    id PK, set_code FK CASCADE, line_no INT, text
sq_quote_templates    id PK, solution, code UNIQUE, name, deployment, brand,
                      include_maintenance TINYINT, include_component TINYINT,
                      condition_set FK sq_condition_sets, active TINYINT, sort
sq_template_blocks    id PK, template_id FK CASCADE, block_code FK sq_blocks, sort
sq_template_items     id PK, template_id FK CASCADE, block_code, item_code, qty_default, sort
sq_template_labor     id PK, template_id FK CASCADE, role_code, label, task, mm_default, sort

-- 견적 확장 (2단가 + 블록/인건비 수용)
sq_quote_sections     + template_code, brand 컬럼 추가
sq_quote_items        + block_code, base_price(기준단가), proposed_price(제안단가) 추가
                        (기존 unit_price는 proposed_price로 의미 이관, amount=proposed_price*qty)
sq_quote_labor        id PK, section_id FK CASCADE, role_code, role_name, task,
                      mm DECIMAL(5,2), base_price BIGINT, proposed_price BIGINT,
                      amount BIGINT, sort   -- 인건비 블록 라인(스냅샷)
```

**2단가 마이그레이션 주의**: 기존 sq_quote_items.unit_price 데이터는 proposed_price로 복사하고 base_price는 해당 price_item의 정가로 백필. 파괴적 변경이므로 002에서 ADD COLUMN → UPDATE 백필 → (NOT NULL 필요시) 순으로.

## 4. 계산 규칙 (공통, lib/quote-engine.js 확장)

- 솔루션/셋업 블록: 제안금액 = 제안단가 × 수량
- 인건비(LABOR) 블록: 기준단가 = labor_rates.apply_price(해당연도 active), 제안금액 = 제안단가 × 공수(MM)
- 서비스(SERVICE): 사용료(년) = 사용료(월) × 12
- 유지보수/데이터서비스: recurring, 제안금액(월) = 제안단가(월) × 수량
- 십만단위 이하 절사 옵션(구축금액 계산 시). 특별할인(금액/%) 기존 로직 재사용. VAT 10% 별도.
- 견적 저장 시 전 라인 **스냅샷**(기준/제안단가 모두) → 임금단가·가격정책 변경과 무관하게 과거 견적 보존.

## 5. REST API 추가

```
[임금단가 — 전용 관리 화면]
GET    /api/labor-rates?year=            연도별 단가 목록
GET    /api/labor-rates/years            연도 목록(active 표시)
POST   /api/labor-rates/years            (ADMIN) 새 연도 생성(직전 연도 복제 옵션)
PUT    /api/labor-rates/:id              (ADMIN) 단가 수정
PATCH  /api/labor-rates/years/:id/active (ADMIN) 활성 연도 지정

[블록/조건/템플릿]
GET    /api/blocks
GET    /api/conditions
GET    /api/templates?solution=          솔루션별 템플릿 목록
GET    /api/templates/:code              템플릿 상세(블록/기본모듈/인건비 기본)
POST   /api/templates                    (ADMIN)
PUT    /api/templates/:id                (ADMIN)

[견적 — 템플릿 적용]
POST   /api/quotes/apply-template        {template_code, ...} → 블록/기본모듈/인건비 기본이 채워진 견적 초안 반환(미저장)
POST   /api/quotes/calculate             (확장) 블록별 소계 + 인건비 + 절사 + 할인 + VAT
```

## 6. UI

- **견적 작성**: [솔루션 → 템플릿] 선택 시 apply-template 호출 → 블록 카드들이 자동 생성(솔루션견적/인건비/유지보수 등). 각 블록에 기준단가/제안단가 2열. 인건비 블록은 역할·공수(MM) 편집, 기준단가는 active 연도 자동. 유지보수/컴포넌트 체크박스로 포함여부 토글.
- **임금단가 관리(신규 화면)**: 연도 탭 + 단가 테이블 편집 + "새 연도 만들기(직전 복제)" + 활성연도 지정.
- **템플릿 관리(ADMIN)**: 템플릿 목록/편집(블록 구성, 기본 모듈세트, 인건비 기본, 조건세트 지정).
- 디자인 토큰(네이비, Pretendard) 기존 유지.

## 7. Phase 진행 (완료 기준)

- **5-A 공통 마스터** (1일): 002 마이그레이션 + labor/blocks/conditions 시드. 임금단가 API + 관리 화면.
  - 완료: 임금단가 관리 화면에서 2026 단가 조회/수정, 새 연도(2027) 복제 생성 가능.
- **5-B 템플릿** (1일): 템플릿 스키마+시드(8종), 템플릿 API, 템플릿 관리 화면.
  - 완료: 솔루션별 템플릿 목록 노출, 상세에서 블록/기본모듈/인건비 확인.
- **5-C 견적 확장** (1.5일): 2단가 마이그레이션+백필, apply-template, calculate 확장, 견적 작성 UI 블록화.
  - 완료: 템플릿 선택→블록 자동생성→인건비 공수 입력→소계/절사/할인/VAT 반영. 저장·재조회 정상.
- **5-D Excel** (1일): 블록형 견적서 Excel 재현(표지/블록별 표/소계/견적조건/인감). 구축형·SaaS·PCloud 양식 분기.
  - 완료: 호반(경비구축)/SK바이오텍(전자구매구축)/SK이터닉스(전자인장 PCloud) 샘플과 레이아웃 대조 통과.

## 8. 준비된 시드 파일

- seed/labor-rates-seed.json — 2026 임금단가(확정값) + 2025(이력 골격)
- seed/templates-seed.json — blocks_master 6종, condition_sets 4종, templates 8종

## 9. 결정 필요/리스크

- 인건비 apply_price(제경비110%+기술료20% 가산값)는 견적서 실측값으로 시드했으나, 등급별(고급/중급/초급) 세분이 필요하면 role_code에 grade 추가 검토.
- SaaS 초기개발비를 LABOR로 볼지 SETUP으로 볼지 솔루션마다 상이 → 템플릿별 blocks로 흡수함(경비SaaS=LABOR, 전자구매SaaS=SETUP).
- 십만단위 절사 규칙의 적용 지점(블록 소계 vs 최종합계) 확정 필요 — 실측은 최종 구축금액에서 절사.
