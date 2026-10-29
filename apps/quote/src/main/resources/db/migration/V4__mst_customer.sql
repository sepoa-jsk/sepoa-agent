-- 고객사 마스터 (2026-10-29, 기준정보 > 고객사 화면 — WBS 4.1 sq_mst_customer)
--
-- 사명 · 기업구분 · 채널(직거래|에이전시) · 담당자 · 연락처 · 이메일 · 결제조건.
-- 수신처는 따로 두지 않는다 — 견적서 수신처 = 고객사명(사용자 확인).
-- 견적(sq_quotes.customer_name 자유 텍스트)과의 연결(customer_id)은 견적 작성 화면 차례에 한다.
-- 개발 DB(test_01)에는 2026-10-29 사용자 승인 후 같은 내용을 수동 적용했다.
-- Flyway 는 dev/기본 프로파일에서 꺼져 있다 — 이 파일은 새 환경용 기록이다.

CREATE TABLE IF NOT EXISTS `sq_mst_customer` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(30) NOT NULL,
  `name` varchar(150) NOT NULL COMMENT '고객사명 (견적서 수신처)',
  `company_key` varchar(30) DEFAULT NULL COMMENT '기업구분 — sq_company_classes.key',
  `channel` varchar(20) DEFAULT NULL COMMENT 'DIRECT=직거래 AGENCY=에이전시',
  `contact_name` varchar(100) DEFAULT NULL COMMENT '담당자',
  `contact_phone` varchar(50) DEFAULT NULL,
  `contact_email` varchar(150) DEFAULT NULL,
  `payment_terms` varchar(200) DEFAULT NULL COMMENT '결제조건',
  `note` varchar(500) DEFAULT NULL,
  `active` tinyint(4) NOT NULL DEFAULT 1,
  `sort` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
