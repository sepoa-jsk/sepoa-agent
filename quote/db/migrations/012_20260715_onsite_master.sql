-- 030_onsite_master.sql
-- 상주여부 마스터 신규 생성 (기업구분에서 상주/비상주를 분리하기 위한 별도 마스터).
-- ⚠️ 이 단계는 "마스터 분리"까지만. 가격 재매핑/엔진은 다음 단계에서 별도 진행.

CREATE TABLE IF NOT EXISTS sq_onsite_types (
  code   VARCHAR(20) NOT NULL,
  name   VARCHAR(50) NOT NULL,
  sort   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO sq_onsite_types (code, name, sort) VALUES
  ('ONSITE',  '상주',   1),
  ('REMOTE',  '비상주', 2)
ON DUPLICATE KEY UPDATE name=VALUES(name), sort=VALUES(sort);
