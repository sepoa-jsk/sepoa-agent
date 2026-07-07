# Claude Code 시작 프롬프트

아래 프롬프트를 VS Code Claude Code에서 그대로 붙여넣어 시작하세요.
(플랜 모드가 아닌 일반 모드 — 플랜은 이미 PLAN.md로 승인 완료 상태입니다)

---

quote 견적서 자동생성 시스템을 구현해줘.

## 진행 방식
- PLAN.md를 먼저 읽어. 모든 설계 결정은 이 문서가 기준이야 (이미 승인된 플랜).
- Phase 0부터 순서대로 진행하고, 각 Phase 완료 시 완료 기준 충족 여부를 보고한 뒤
  내 확인을 받고 다음 Phase로 넘어가.
- 이미 준비된 파일을 활용해:
  - seed/pricing-seed.json : 가격정책 3개 엑셀에서 추출·정규화 완료된 시드 데이터 (수정하지 말 것)
  - lib/quote-engine.js    : 가격 유형 4종 계산 로직 초안 (테스트 후 재사용)
  - assets/seal.png        : 투명 처리된 인감 이미지 (Excel 오버레이용)

## 환경
- MariaDB 접속 정보는 .env로 관리해. 값은 내가 직접 채울 테니 .env.example만 만들어.
  (기존 sepoa-aidlc-pms와 동일 DB, 테이블은 sq_ 접두어)
- Google OAuth Client ID도 .env로. 발급 전이므로 AUTH_MODE=dev로 개발 진행.
- 포트는 3100 (aidlc-pms와 충돌 방지).

## 첫 작업 (Phase 0)
1. 프로젝트 구조 생성 (package.json, .env.example, sql/, lib/, public/, seed/, assets/)
2. sql/001_schema.sql — PLAN.md 4번 스키마를 MariaDB DDL로 작성
3. seed/seed.js — pricing-seed.json을 sq_ 테이블에 투입 (재실행 가능하게: 기존 시드 데이터 존재 시 skip 또는 --force 옵션)
4. npm run migrate / npm run seed 스크립트 등록
5. 완료 기준 검증: 시드 후 항목 수를 솔루션×배포형태별로 집계해서 보고

시작해.

---

## 참고: Phase 1 진입 전에 내가 준비할 것
- [ ] .env에 MariaDB 접속 정보 입력
- [ ] Google Cloud Console에서 OAuth 2.0 Client ID 발급 (Phase 1 후반까지면 됨)
      - 승인된 JavaScript 원본: http://localhost:3100 + 사내 배포 URL
- [ ] 기존 견적서 양식 파일을 프로젝트에 넣고 Claude Code에 참조 지시 (Phase 2 전까지)
