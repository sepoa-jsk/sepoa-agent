-- 템플릿 품목의 구간 인원 · 건수 (2026-10-30, 사용자 승인)
--
-- SaaS 구간형 서비스는 수량과 따로 '인원 · 건수' 를 넣고, 그 숫자가 들어가는 구간의 월 금액을 단가로 쓴다.
-- band_key(V8) 가 단위(USER 인원 / COUNT 건수), band_qty 가 그 숫자다. NULL 이면 1 로 본다.
-- 개발 DB(test_01)에는 2026-10-30 같은 내용을 수동 적용했다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_template_items`
  ADD COLUMN IF NOT EXISTS `band_qty` decimal(10,2) DEFAULT NULL COMMENT '구간 인원 · 건수' AFTER `band_key`;
