-- 견적별 결제 방안 (2026-10-29, 사용자 승인)
--
-- 견적서의 '클라우드서비스 결제 방안' 표를 견적마다 고친다. JSON:
--   {"enabled": true|false, "ratio": 50, "rows": [["구분","지급시점","비용","내역"], ...] | null}
--   enabled — 견적서에 넣을지(없으면 템플릿 has_pay_plan 을 따른다)
--   ratio   — 셋업비용 계약체결 시 비율(%) — 나머지는 구축완료 후
--   rows    — 직접 고친 표. null 이면 견적 금액과 ratio 로 기본 문구를 만든다
-- 값이 NULL 이면 예전처럼 템플릿 설정 · 기본 문구를 쓴다.
-- 개발 DB(test_01)에는 2026-10-29 같은 내용을 수동 적용했다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_quotes`
  ADD COLUMN IF NOT EXISTS `pay_plan` longtext DEFAULT NULL COMMENT '견적별 결제 방안(JSON)' AFTER `conditions`;
