-- 053_maintenance.sql
-- 유지보수 요율·단가 마스터. 운영 유지보수는 M/D 단가 기준.
SET NAMES utf8mb4;
CREATE TABLE IF NOT EXISTS sq_maintenance_config (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(30) NOT NULL,          -- SOLUTION_MAINT / OPERATION_MAINT
  name VARCHAR(150) NOT NULL,
  calc_type VARCHAR(20) NOT NULL,     -- RATE(공급가×율) / MD(공수×M-D단가)
  rate DECIMAL(5,3) NULL,             -- RATE형: 0.150 (15%)
  md_price BIGINT NULL,               -- MD형: 700,000 (1 M/D 단가)
  md_per_mm INT NULL,                 -- M/M 환산 일수: 20
  tco_years INT NULL,                 -- TCO 표시용 (4년/5년)
  free_months INT NULL,               -- 무상 개월수 (12)
  note VARCHAR(300) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  sort INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 시드
INSERT INTO sq_maintenance_config
  (code,name,calc_type,rate,md_price,md_per_mm,tco_years,free_months,note,sort) VALUES
  ('SOLUTION_MAINT','솔루션 유지보수','RATE',0.150,NULL,NULL,4,12,
   '12개월 무상지원 이후 솔루션공급가의 15%',1),
  ('OPERATION_MAINT','운영 유지보수','MD',NULL,700000,20,5,NULL,
   '원격 지원. M/D 또는 M/M(20일 환산) 선택',2)
ON DUPLICATE KEY UPDATE
  rate=VALUES(rate), md_price=VALUES(md_price), md_per_mm=VALUES(md_per_mm),
  tco_years=VALUES(tco_years), free_months=VALUES(free_months),
  note=VALUES(note), name=VALUES(name);
