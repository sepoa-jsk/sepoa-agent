# 견적 자동화 시스템 상세 작업계획서 (BUILD)

> 대상: quote 프로젝트 / 범위: BUILD(구축·서비스) 견적 자동화
> 설계 근거: PLAN_PHASE5_REV.md (승인됨). 이 문서는 그 플랜을 **실행 단위 체크리스트**로 분해한 것.
> 사용법: Claude Code가 작업 항목(WBS)을 위→아래로 처리. 각 항목 [ ]를 완료 시 [x]. 단계(5-A~5-D) 끝에서 완료기준(DoD) 검증 후 다음 단계.
> 작성 기준일: 2026-07

---

## 0. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 목적 | 3솔루션(경비/전자구매/전자인장) BUILD 견적을 템플릿 선택→자동계산→PDF로 생성 |
| 스택 | Node.js + Express + MariaDB(sq_ 접두어) + Playwright(PDF) |
| 인증 | Google SSO(기존), ADMIN/USER 역할 |
| 산출물 | 견적 PDF(본문), 임금단가·템플릿 관리 화면 |
| 비범위 | MAINT(유지보수)·ADDDEV(추가개발) → Phase 6, 커버 페이지(외부) |

## 1. 견적 유형·블록 체계 (구현 대상 확정)

- quote_type: **BUILD**만. (스키마엔 MAINT/ADDDEV 값 예약)
- deployment: ONPREM_LUMP / ONPREM_INSTALL / SAAS / PCLOUD
- 블록 7종: SOLUTION / SETUP / LICENSE / LABOR / SERVICE / DATASVC / SUMMARY
- 계산 순서(고정): 블록소계 합 → 특별DC(금액/%) → 십만단위 절사 → VAT 별도. 일시불/월(recurring) 분리.

---

## 2. WBS — 단계별 작업 항목

### 5-A. 공통 마스터 + 임금단가 (예상 1일)

DB
- [x] sql/002_phase5.sql: sq_labor_rate_years, sq_labor_rates, sq_blocks, sq_condition_sets, sq_condition_lines DDL (001 수정 금지)
      → 테이블명은 sq_labor_rate_lines (레거시 sq_labor_rates 와 충돌 회피). overhead/tech_fee 컬럼 멱등 추가.
- [x] 시드 로더: labor-rates-seed.json → labor 테이블 / templates-seed.json의 blocks_master·condition_sets → blocks·conditions
- [x] 시드 재실행 가능(존재 시 skip, --force 재투입) → `--force=labor,blocks,conditions` 섹션 지정 지원.
      blocks/conditions 는 외부 FK 때문에 삭제 대신 UPSERT.

API (ADMIN 권한)
- [x] GET /api/labor-rates/years (active 표시)
- [x] GET /api/labor-rates?year=
- [x] POST /api/labor-rates/years (직전 연도 복제 옵션)
- [x] PUT /api/labor-rates/:id
- [x] PATCH /api/labor-rates/years/:id/active
- [x] GET /api/blocks, GET /api/conditions

UI
- [x] 임금단가 관리 화면: 연도 탭 / 단가 테이블(노임단가·평균임금·제경비·기술료·적용단가 표시) / 인라인 편집
- [x] "새 연도 만들기(직전 복제)" 버튼
- [x] 활성 연도 지정 토글

DoD(완료기준)
- [x] 2026 단가 조회·수정, 2027 복제 생성이 화면+API로 동작 (API 스모크 17/17 PASS, 2027 복제 7건)
- [x] npm test 통과 (30/30), 변경 요약 보고

### 5-B. 템플릿 (예상 1일)

DB
- [x] 002에 sq_quote_templates, sq_template_blocks, sq_template_items, sq_template_labor 추가
      → 003_phase5_templates.sql 에 존재. quote_type/has_labor_plan, label→role_label, grade,
        block_code(LABOR/SETUP 구분) 멱등 ALTER 추가.
- [x] templates-seed.json의 templates(BUILD 8종) 투입 (블록 27 / 모듈 49 / 인건비 19)

API
- [x] GET /api/templates?quote_type=BUILD&solution= (active 필터·블록구성 요약 포함)
- [x] GET /api/templates/:code (블록·기본모듈·인건비 기본 포함, 미등록 모듈 표시)
- [x] POST/PUT /api/templates (ADMIN)

UI
- [x] 템플릿 관리 화면(ADMIN): 목록 / 상세(블록 구성·기본 모듈세트·인건비 기본·조건세트)

DoD
- [x] 솔루션별 BUILD 템플릿 목록 노출, 상세에서 블록·기본모듈·인건비 확인 (API 스모크 22/22 PASS)
- [x] npm test 통과 (40/40), 요약 보고
- [ ] **미해결**: 기본모듈 49건이 전부 가격마스터(sq_price_items) 미등록 → 5-C 실측 재현 불가.
      모듈 마스터 구축 필요(5-C 선행). 상세 화면에 경고로 노출 중.

### 5-C. 견적 작성·계산 (예상 2일) — ★ 데이터 마이그레이션 주의

사전
- [x] **DB 백업** — 사용자가 "백업 불필요" 결정(2026-07-30). 대신 영향 테이블 JSON 스냅샷을
      스크래치패드에 덤프 후 진행. 마이그레이션은 비파괴로 설계(기존 섹션/품목 보존).

모듈 마스터 (WBS 외 선행작업 — 5-C DoD 달성에 필수)
- [x] seed/modules-seed.json: 전자인장 15종을 실측 PDF에서 역산 투입 (온프레미스/PCloud/SaaS)
- [ ] 경비(EXPENSE)·전자구매(PROCURE) 모듈 34건은 여전히 미등록 → 해당 템플릿 견적 불가

DB
- [x] sq_quotes 확장: quote_type, deployment, template_code, onetime_total, monthly_total, discount_type, discount_value, round_unit(기본100000)
- [x] sq_quote_blocks(견적 내 블록 인스턴스) 신설
- [x] sq_quote_items 확장: block_id, base_price, proposed_price (004에서 백필 완료)
- [x] sq_quote_labor 신설(+ block_id, role_label, grade, month_alloc)
- [x] 기존 sections/items → blocks 구조 마이그레이션 (블록 12개 생성, 금액 불일치 0건)

엔진(lib/quote-engine.js 확장)
- [x] 블록별 계산: SOLUTION/SETUP/LICENSE(=proposed×qty), LABOR(amount=proposed×mm), SERVICE/DATASVC(월, recurring)
- [x] SUMMARY: 소계합 → 특별DC(금액/%/최종금액) → 십만절사 → VAT. 일시불/월 분리 산출
- [x] 인건비 month_alloc 검증(Σ=mm)
- [x] 단위 테스트: 실측 재현 17종 (test/quote-block.test.js)

API
- [x] POST /api/quotes/apply-template (블록·기본모듈·인건비 기본 채운 초안 반환, 미저장)
- [x] POST /api/quotes/calculate (블록 소계+인건비+일시불/월 분리+특별DC+절사+VAT)
- [x] POST/GET/PUT/PATCH/DELETE /api/quotes(:id) — blocks 페이로드 저장/재조회

UI (견적 작성)
- [x] 템플릿 선택 → apply-template 호출 → 블록 카드 자동 생성
- [~] 블록별 모듈 선택기 — 행 추가/삭제·수량 편집은 되나 "필수 고정/COMMON 뱃지" 토글 미구현
- [x] 인건비 블록: 역할·공수(MM)·제안단가 편집, 기준단가 자동(active 연도)
- [x] (옵션) 인력투입계획: has_labor_plan이면 월별(M/M1/M2/M3…) 배분 입력 + Σ검증 경고
- [x] 실시간 합계(일시불/월) 표시, 특별DC 입력(금액/%/최종금액) + 절사단위 선택
- [x] 엑셀 붙여넣기 입력(모듈 코드/수량)

DoD (실측 재현)
- [x] SK이터닉스 PCloud: 일시납 100,000,000 / 월 1,275,000
- [x] 솔브레인 온프레미스: 솔루션 50,000,000 + 인건비 36,600,000 → 특별DC → 60,000,000
- [x] 솔브레인 전자인장계약: 솔루션 70,000,000 → 106,600,000 → 80,000,000 (추가 검증)
- [x] 저장·재조회 정상 (E2E 23/23 PASS), npm test 통과 (57/57), 요약 보고

### 5-D. PDF 출력 (예상 2일)

환경
- [ ] Playwright + Chromium 설치(사내 배포 시 오프라인 경로 확인 메모)

템플릿(HTML→PDF)
- [ ] 본문 상단표: 수신/견적용도/결제조건/총견적가(일시불·월 분리)/설치완료 + 견적번호/일자/유효일/상호/대표이사/인감
- [ ] 블록별 표 렌더(SOLUTION/SETUP/LICENSE/LABOR/SERVICE/DATASVC) + 소계
- [ ] SUMMARY: Total→특별DC→최종견적금액(절사), VAT별도 표기
- [ ] 견적조건(condition_set) 출력
- [ ] (옵션) 인력투입계획표 부속 페이지
- [ ] 임금단가표 첨부 페이지(공통 마스터 출력)
- [ ] 인감 이미지 오버레이, 연두색 헤더 밴드 등 실측 스타일
- [ ] 커버 병합 훅(앞 페이지 자리)만 열어둠

API
- [ ] GET /api/quotes/:id/pdf

DoD (레이아웃 대조)
- [ ] 하겐다즈 SaaS / 솔브레인 온프레미스 / SK이터닉스 PCloud 3종 PDF가 실물과 대조 통과
- [ ] npm test 통과, 요약 보고

---

## 3. 실측 검증 데이터 (테스트 기준값)

| 사례 | 유형 | 핵심 검증값 |
|---|---|---|
| SK이터닉스 | PCLOUD | 일시납 합계 100,000,000 / 월사용료 1,275,000 (API 200k+Server 700k+유지보수 375k) |
| 솔브레인(전자계약) | ONPREM_LUMP | 솔루션 50,000,000 + 인건비 36,600,000 = Total 86,600,000 → 최종 60,000,000 |
| 솔브레인(전자인장계약) | ONPREM_LUMP | 솔루션 70,000,000(+Poa Seal 20,000,000) → 최종 80,000,000 |
| 하겐다즈 | SAAS | 셋업 무상 / 월 100,000(360건 밴드) |
| 임금단가 IT PM | LABOR | apply_price 25,418,735 (제안단가 네고 가능) |

## 4. 리스크·주의 (진행 중 계속 확인)

- **5-C 마이그레이션 파괴적** → 반드시 사전 백업, 사용자 확인 후 진행
- Playwright Chromium(~150MB) → 폐쇄망 배포 시 설치 경로 사전 확보
- 특별DC/절사 순서 고정(소계합→DC→절사). 엔진·PDF 양쪽 동일 적용
- SaaS 건수 밴드는 pricing-seed BAND variant 재사용, 하단 밴드표 출력
- 스냅샷 원칙: 저장 견적은 임금단가/가격정책 변경에 불변

## 5. 진행 관리

- 단계 완료 시: 완료기준 체크 + npm test + 변경 요약 보고 → 사용자 승인 → 다음 단계
- 각 단계는 별도 커밋(예: `feat(5-A): 임금단가 마스터/관리화면`)
- 5-C 진입 전 커밋+DB 백업 태그
