-- 견적 차수 (2026-10-31, 사용자 요청: "1차로 진행되다가 네고 요청이 오는 경우 1차의 데이터를 가져다가 2차로 다시 만들어야 해")
--
-- revision       차수. 처음 만든 견적은 1. 네고로 다시 만든 견적은 2, 3 …
-- base_quote_id  1차 견적(sq_quotes.id). 1차 자신은 NULL. 같은 건의 차수는 모두 같은 1차를 가리킨다.
-- 2차부터 견적번호는 1차 번호 + '-차수' (예: QT20261031_001-2). 채번 카운터는 쓰지 않는다.
-- 1차를 지워도 2차 이후는 남는다(FK 없음) — 목록에서는 같은 base_quote_id 끼리 붙어 나온다.
-- 개발 DB(test_01)에는 같은 내용을 수동 적용한다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_quotes`
  ADD COLUMN IF NOT EXISTS `revision` int(11) NOT NULL DEFAULT 1 COMMENT '차수(1차 = 1)' AFTER `quote_no`,
  ADD COLUMN IF NOT EXISTS `base_quote_id` int(10) unsigned DEFAULT NULL COMMENT '1차 견적 id(1차 자신은 NULL)' AFTER `revision`,
  ADD KEY IF NOT EXISTS `idx_quote_base` (`base_quote_id`);
