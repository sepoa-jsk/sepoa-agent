# 견적서 자동생성 시스템 (quote) 개발 플랜

> 상태: **승인 완료** — 본 문서 기준으로 구현한다.
> 작성일: 2026-07-07

## 1. 개요

세포아소프트 SingleSuite 3개 솔루션(경비관리, 전자구매, 전자인장)의 가격정책을 DB로 관리하고,
웹 UI에서 조건 선택만으로 견적을 자동 계산·저장·Excel 출력하는 사내 시스템.
sepoa_agent 하위 신규 프로젝트. 사용자: 내부 영업/기획 팀원. Linux 서버 팀 배포.

## 2. 확정된 결정사항

| 항목 | 결정 |
|---|---|
| 기술 스택 | Node.js + Express + **MariaDB** (sepoa-aidlc-pms와 동일 인스턴스/스키마) |
| 테이블 네이밍 | 기존 스키마에 **`sq_` 접두어** 테이블로 추가 |
| 인증 | **Google SSO** (구글 메일 로그인). 최초 로그인 시 sq_users 자동 생성(auto-provisioning). 허용 도메인은 env로 제한(기본 sepoasoft.co.kr). 역할: ADMIN(가격정책 수정) / USER(견적 작성) |
| 견적번호 채번 | `S + YYYYMMDD + 3자리 시퀀스` 예: S20260707001. 일자별 시퀀스, 채번 테이블 + 트랜잭션으로 중복 방지 |
| 복합 견적 | 필요함. **quotes → quote_sections(솔루션×배포형태) → quote_items** 3계층. 섹션별 기업구분/계약개월/소계, Excel에 섹션 소계 + 전체 합계 |
| 특별할인 | 금액/% **둘 다** 지원: discount_type ENUM('AMOUNT','RATE') + discount_value |
| Excel 양식 | 신규 디자인 (기존 사내 양식 파일은 참조용으로 별도 제공 예정) |
| 공급자 정보 | 세포아소프트(주) / 사업자 119-81-95026 / 대표 이희림 / 서울특별시 구로구 디지털로31길 62, 아티스포럼 714~717호. **settings 테이블(key-value)로 관리**, 하드코딩 금지. 인감: assets/seal.png (투명 PNG, 트리밍 완료) |

## 3. 가격 유형 4종 (핵심 도메인 로직)

가격정책 엑셀 3개는 `seed/pricing-seed.json`으로 정규화 완료. 이 파일이 시드 원본이다.

| pricing_type | 계산 방식 | 예 |
|---|---|---|
| DISCOUNT | 기업구분(variant.key)별 확정 단가 | 경비관리 On-Premise 모듈, 전자구매 솔루션, 전자인장 POA Seal |
| BAND | 수량이 속하는 구간(min_qty~max_qty)의 단가. 구간 단가가 곧 월액(수량 곱하지 않음) | SaaS 사용자수/건수 구간, 서비스솔루션 社수 구간 |
| FIXED | 고정 단가(base_price) × 수량 | 셋업비, 옵션 모듈 월액, PKI 툴킷 |
| MM | 월단가(base_price) × 기업구분별 적용율(rate) × 수량(M/M) | 전자구매/전자인장 개발인건비 |

- `recurring=1` 항목은 계약개월(months)을 곱한다.
- variant.price가 NULL이면 "별도협의" → 자동계산 불가, 수기 단가 입력 허용.
- VAT 10%. 합계 = (공급가액 − 할인) × 1.1
- 참고 구현: `lib/quote-engine.js` (검증된 계산 로직 초안, MariaDB 전환 시 그대로 사용 가능)

## 4. DB 스키마 (sq_ 접두어)

```
sq_solutions        code PK, name, source
sq_deployments      code PK, name                -- ONPREM/SAAS/PCLOUD/SVC
sq_company_classes  id PK, solution, deployment, key, label, sort
                    UNIQUE(solution, deployment, key)
sq_price_items      id PK, solution, deployment, category, code UNIQUE, name, spec,
                    pricing_type ENUM('DISCOUNT','BAND','FIXED','MM'),
                    base_price BIGINT, unit, qty_default DECIMAL(6,2),
                    required TINYINT, recurring TINYINT, note, active TINYINT, sort
sq_price_variants   id PK, item_id FK CASCADE, key, label,
                    min_qty DECIMAL(12,2), max_qty DECIMAL(12,2),
                    rate DECIMAL(5,3), price BIGINT NULL   -- NULL=별도협의
sq_users            id PK, email UNIQUE, name, picture, role ENUM('ADMIN','USER'),
                    created_at, last_login_at
sq_settings         `key` PK, value TEXT                    -- 공급자정보, 인감경로 등
sq_quote_seq        seq_date DATE PK, last_no INT           -- 채번
sq_quotes           id PK, quote_no UNIQUE, quote_date, valid_until,
                    customer_name, customer_contact,
                    discount_type ENUM('AMOUNT','RATE'), discount_value DECIMAL(12,2),
                    supply_amount, discount_amount, vat_amount, total_amount,
                    status ENUM('DRAFT','SENT','WON','LOST'), memo,
                    created_by FK sq_users, created_at, updated_at
sq_quote_sections   id PK, quote_id FK CASCADE, solution, deployment,
                    company_class, contract_months INT, params JSON,
                    subtotal BIGINT, sort
sq_quote_items      id PK, section_id FK CASCADE, item_code, category, name, spec,
                    qty DECIMAL(8,2), unit, months INT, unit_price BIGINT,
                    amount BIGINT, note, sort
                    -- 단가 스냅샷: 가격정책 변경과 무관하게 과거 견적 보존
```

## 5. REST API

```
[인증]
POST   /api/auth/google            Google ID token 검증 → 세션 발급 (auto-provision)
POST   /api/auth/logout
GET    /api/auth/me

[마스터/가격정책]
GET    /api/master                                솔루션·배포형태·기업구분
GET    /api/pricing?solution=&deployment=          항목+variants
POST   /api/pricing/items                          (ADMIN)
PUT    /api/pricing/items/:id                      (ADMIN)
PUT    /api/pricing/items/:id/variants             (ADMIN) 일괄 교체
DELETE /api/pricing/items/:id                      (ADMIN) soft delete

[견적]
POST   /api/quotes/calculate       조건 → 계산 결과(저장 안 함). 타시스템 연계 핵심
POST   /api/quotes                 생성(채번+저장, 섹션/품목 포함)
GET    /api/quotes?status=&customer=&page=
GET    /api/quotes/:id
PUT    /api/quotes/:id
PATCH  /api/quotes/:id/status
DELETE /api/quotes/:id
GET    /api/quotes/:id/excel       Excel 다운로드

[설정]
GET/PUT /api/settings              (ADMIN) 공급자 정보 등

[연계 인증] 브라우저=세션쿠키, 타시스템=X-API-Key 헤더 (env로 키 관리)
```

## 6. Phase 계획

- **Phase 0** (0.5일): 프로젝트 셋업, `.env` 설계, sq_ 마이그레이션 SQL, 시드 로더 (seed/pricing-seed.json 투입)
  - 완료 기준: 마이그레이션+시드 후 3개 솔루션 가격정책 전체가 DB에서 조회됨
- **Phase 1** (1.5일): Google SSO(google-auth-library, ID token 검증) + 세션(DB 세션 스토어) + 역할, 가격정책 API, 견적 계산 엔진 + 단위 테스트
  - 완료 기준: 테스트 통과 — 전자인장 SaaS 월 200건→500,000원 / 전자구매 ONPREM PM 1M/M LARGE_R→17,500,000원 / BAND 경계값 / 별도협의 NULL 처리
  - 개발 편의: `AUTH_MODE=dev`이면 Google 없이 개발용 로그인 허용
- **Phase 2** (1일): 견적 CRUD(3계층), 채번, 할인(금액/%), ExcelJS 견적서(섹션 소계, 인감 오버레이, 공급자 정보 settings 참조)
  - 완료 기준: 생성→저장→수정→Excel 다운로드 전체 흐름 API 동작
- **Phase 3** (1.5일): 웹 UI — 로그인 게이트, 견적 작성([+ 솔루션 추가] 섹션 누적형, 실시간 계산은 서버 /calculate 호출), 견적 목록/상세/상태변경, 가격정책 관리(ADMIN), 설정(ADMIN). SingleSuite 디자인 토큰(네이비, Pretendard)
  - 완료 기준: 팀원이 매뉴얼 없이 견적 1건 작성→Excel 출력. 가격 수정이 신규 견적에 즉시 반영
- **Phase 4** (0.5일): Linux 배포(pm2), X-API-Key, README/API 문서

## 7. 리스크/주의

- 엑셀 비고란 예외("6개社 이상 5만원/社 추가", "월 10건 미만 정액" 등)는 note로 노출하고 수기 조정 허용
- 전자인장은 2026 신규안 기준으로 시드됨 (기존안 제외)
- 견적은 단가 스냅샷 저장 — "재계산" 버튼은 Phase 3에서 선택 구현
- Google OAuth Client ID는 Google Cloud Console에서 발급 필요 (승인된 JavaScript 원본에 사내 URL 등록)
