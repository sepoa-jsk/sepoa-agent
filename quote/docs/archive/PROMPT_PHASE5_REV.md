# Phase 5 (재설계판) Claude Code 시작 프롬프트

VS Code에서 `cd quote` 후 claude 실행. 아래 붙여넣기.
(기존 quote-phase5.zip으로 받은 초안 PLAN_PHASE5.md/PROMPT_PHASE5.md/seed는 폐기. 이 재설계판으로 대체)

---

Phase 5(재설계판: 견적 유형·블록·인건비·PDF)를 구현해줘.

## 진행 방식
- PLAN_PHASE5_REV.md를 먼저 읽어. 모든 설계는 이 문서 기준(승인 완료). 기존 PLAN_PHASE5.md는 폐기됐으니 무시하고 REV 문서를 따른다.
- 이번 범위는 BUILD(구축/서비스)만. MAINT(유지보수)/ADDDEV(추가개발)는 Phase 6이므로 지금 구현하지 마. 단 스키마의 quote_type 컬럼은 지금 넣어 확장 대비.
- 5-A → 5-B → 5-C → 5-D 순서. 각 단계 완료 기준 보고 후 내 확인받고 다음 단계.
- 준비된 시드 사용(수정 말 것): seed/labor-rates-seed.json, seed/templates-seed.json

## 핵심 원칙
1. 견적 유형(quote_type) 최상위: BUILD/MAINT/ADDDEV. 이번엔 BUILD. deployment=ONPREM_LUMP/ONPREM_INSTALL/SAAS/PCLOUD.
2. 블록 7종(SOLUTION/SETUP/LICENSE/LABOR/SERVICE/DATASVC/SUMMARY) 조합으로 견적 구성. 템플릿이 어떤 블록을 쓰는지 지정.
3. 2단가: 모든 금액행 기준단가(base)+제안단가(proposed). 제안금액=제안단가×수량(또는 ×공수).
4. 인건비(LABOR): base_price=임금단가 apply_price(해당연도 active, 스냅샷). 월별공수배분(month_alloc)은 옵션(has_labor_plan).
5. 합계: 소계합 → 특별DC → 십만단위 절사 순서 고정. 일시불/월(recurring) 분리 표기. VAT 별도.
6. 스냅샷: 견적 저장 시 기준/제안단가 모두 저장. 임금단가/가격정책 변경돼도 과거 견적 불변.
7. 최종 출력은 PDF(커버 제외 본문). 커버는 범위 외지만 앞에 병합할 훅만 남겨둬.

## 첫 작업 (5-A: 공통 마스터)
1. sql/002_phase5.sql — REV 4번 스키마 중 공통부(labor_rate_years, labor_rates[wage_md/wage_mm/overhead/tech_fee/apply_price], blocks, condition_sets, condition_lines)
2. 시드 로더 확장: labor-rates-seed.json→labor 테이블, templates-seed.json의 blocks_master/condition_sets→blocks/conditions. 재실행 가능(존재시 skip/--force)
3. 임금단가 API(GET years·rates, POST years[직전연도 복제], PUT rate, PATCH active) + ADMIN 권한
4. 임금단가 관리 화면: 연도 탭, 단가 테이블 편집(산정식 분해 표시), "새 연도 만들기(직전 복제)", 활성연도 지정
5. 완료 기준 검증: 2026 단가 조회/수정, 2027 복제 생성이 화면+API로 동작함을 보고

npm test 통과 확인하고 변경된 스키마/API/화면 요약 보고. 그 다음 5-B로 갈지 내가 결정한다.

## 5-C 진입 전 주의
블록 구조 마이그레이션은 기존 견적 데이터 파괴 가능. 5-C 시작 전 DB 백업하라고 나에게 먼저 알려줘.

---

## 단계별 완료 기준 (REV 8번)
- 5-A: 임금단가 관리 화면(조회/수정/연도복제/활성지정)
- 5-B: BUILD 템플릿 목록/상세(블록·기본모듈·인건비 기본)
- 5-C: 템플릿선택→블록 자동생성→모듈·인건비 입력→일시불/월 합계 정확, 저장·재조회.
       검증: SK이터닉스 PCloud(일시납 1억/월 1,275,000), 솔브레인 온프레미스(솔루션 5천만+인건비 3,660만→특별DC 6천만)
- 5-D: 하겐다즈 SaaS/솔브레인 온프레미스/SK이터닉스 PCloud 3종 PDF가 실물과 레이아웃 대조 통과
