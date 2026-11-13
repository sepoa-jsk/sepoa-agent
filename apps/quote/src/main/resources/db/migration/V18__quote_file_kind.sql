-- 견적 파일 구분 (2026-11-03, 사용자 요청: "RFP 포함 고객사가 전달한 파일을 업로드 하도록 해줘")
--
-- kind  ATTACH   첨부파일 — 견적에 함께 보관하는 파일(2단계 '첨부파일' 카드)
--       CUSTOMER 고객 전달 파일 — RFP · 요청서 등 고객사가 보낸 파일(2단계 '근거 자료' 카드)
-- 이미 올린 파일은 ATTACH 가 된다(기본값).
-- 개발 DB(test_01)에는 같은 내용을 수동 적용한다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_quote_files`
  ADD COLUMN IF NOT EXISTS `kind` varchar(20) NOT NULL DEFAULT 'ATTACH' COMMENT 'ATTACH 첨부파일 | CUSTOMER 고객 전달 파일(RFP 등)' AFTER `quote_id`;
