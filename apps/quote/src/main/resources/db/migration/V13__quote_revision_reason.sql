-- 견적 차수 추가 사유 (2026-10-31, 사용자 요청: "차수추가인 경우 추가사유를 입력기능을 추가해줘")
--
-- revision_reason  [차수 추가] 때 넣은 사유(예: 고객 네고 요청 — 월 사용료 10% 인하). 1차는 NULL.
-- 개발 DB(test_01)에는 같은 내용을 수동 적용한다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_quotes`
  ADD COLUMN IF NOT EXISTS `revision_reason` varchar(500) DEFAULT NULL COMMENT '차수 추가 사유' AFTER `base_quote_id`;
