# Phase 5 Claude Code 시작 프롬프트

VS Code에서 `cd quote` 후 claude 실행, 아래 붙여넣기.

---

Phase 5(견적서 템플릿 + 개발인건비 + 2단가)를 구현해줘.

## 진행 방식
- PLAN_PHASE5.md를 먼저 읽어. 모든 설계는 이 문서 기준(이미 승인됨).
- 기존 Phase 0~4 구조(quote→sections→items, sq_ 접두어, 스냅샷 원칙) 위에 확장. 기존 001 스키마는 수정 금지, 002_phase5.sql 신규 추가.
- 5-A → 5-B → 5-C → 5-D 순서로. 각 단계 완료 기준 충족을 보고하고 내 확인 후 다음 단계.
- 준비된 시드를 사용(수정 말 것): seed/labor-rates-seed.json, seed/templates-seed.json

## 핵심 원칙 (놓치지 말 것)
1. 공통은 1벌만: 임금단가/블록정의/견적조건은 공통 마스터. 템플릿은 참조만(값 복사 금지).
2. 2단가: 모든 금액행에 기준단가(base_price)+제안단가(proposed_price). 제안금액=제안단가×수량(또는 ×공수).
3. 스냅샷: 견적 저장 시 기준/제안단가 모두 저장 → 임금단가/가격정책 변경돼도 과거 견적 불변.
4. 2단가 마이그레이션은 파괴적: ADD COLUMN → 기존 unit_price를 proposed_price로 복사 → base_price 정가 백필 순. 데이터 손실 없게.

## 첫 작업 (5-A: 공통 마스터)
1. sql/002_phase5.sql — PLAN_PHASE5.md 3번 스키마 중 공통 부분(labor_rate_years, labor_rates, blocks, condition_sets, condition_lines) DDL
2. 시드 로더 확장: labor-rates-seed.json → labor 테이블, templates-seed.json의 blocks_master/condition_sets → blocks/conditions 테이블. 재실행 가능(존재 시 skip/--force)
3. 임금단가 API (GET/POST years, PUT rate, PATCH active) + 권한(ADMIN)
4. 임금단가 관리 화면: 연도 탭, 단가 테이블 편집, "새 연도 만들기(직전 복제)", 활성연도 지정
5. 완료 기준 검증: 2026 단가 조회, 수정, 2027 복제 생성이 화면+API로 동작함을 보고

npm test 통과 확인하고, 변경된 스키마/API/화면을 요약 보고해줘. 그 다음 5-B로 갈지 내가 결정할게.

---

## 참고: 단계별 완료 기준 (PLAN_PHASE5.md 7번)
- 5-A 공통 마스터: 임금단가 관리 화면 동작(조회/수정/연도복제)
- 5-B 템플릿: 솔루션별 템플릿 목록/상세(블록·기본모듈·인건비)
- 5-C 견적 확장: 템플릿선택→블록 자동생성→인건비 공수 입력→소계/절사/할인/VAT, 저장·재조회
- 5-D Excel: 호반/SK바이오텍/SK이터닉스 샘플과 레이아웃 대조 통과
