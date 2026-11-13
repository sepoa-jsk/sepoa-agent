-- 가격 구간의 '추가 1단위당 금액' (2026-11-04, 사용자 요청: 경비관리 데이터서비스 Card · DocsCV '6社 이상 1社당 +50,000')
--
-- step_price  마지막(끝이 없는) 구간에서 시작 수를 넘는 1단위(1社 · 1건 · 1명)마다 더하는 금액.
--             금액 = price + step_price × (수 − min_qty). 예) 6社 이상 · price 650,000 · step 50,000 → 8社 = 750,000
--             NULL 이면 예전처럼 구간 금액 그대로.
-- 개발 DB(test_01)에는 같은 내용을 수동 적용한다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_price_variants`
  ADD COLUMN IF NOT EXISTS `step_price` bigint(20) DEFAULT NULL COMMENT '추가 1단위당 금액(끝 없는 구간)' AFTER `price`;
