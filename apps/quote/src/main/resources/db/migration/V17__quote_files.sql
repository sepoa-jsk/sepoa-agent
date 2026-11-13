-- 견적 첨부파일 (2026-11-03, 사용자 요청: "첨부파일이 필요한 경우도 있어서 첨부파일 기능은 추가가 필요해")
--
-- 견적 작성 2단계 '근거 자료' 에서 올리는 파일(고객 요청서 · RFP · 참고 문서 등). 파일 내용은 data 에 그대로 넣는다(서버 폴더 설정 없음).
-- 한 파일 20MB 까지(서버가 막는다). 견적을 지우면 첨부도 같이 지운다(서버가 지운다 — 외래키는 두지 않는다, 예전 표들과 같은 방식).
-- 개발 DB(test_01)에는 같은 내용을 수동 적용한다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

CREATE TABLE IF NOT EXISTS `sq_quote_files` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `quote_id` int(10) unsigned NOT NULL COMMENT 'sq_quotes.id',
  `file_name` varchar(255) NOT NULL COMMENT '올린 파일 이름',
  `content_type` varchar(100) DEFAULT NULL,
  `size` int(10) unsigned DEFAULT NULL COMMENT '바이트',
  `data` longblob NOT NULL,
  `uploaded_by` int(10) unsigned DEFAULT NULL COMMENT 'sq_users.id',
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_quote` (`quote_id`)
) COMMENT='견적 첨부파일';
