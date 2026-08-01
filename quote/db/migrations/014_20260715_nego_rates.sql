-- 040_nego_rates.sql
-- 네고율 단일 테이블: target(MODULE/LABOR)으로 모듈용/인력용을 구분한다.
-- 기업구분 × 상주여부 조합별, 조합당 2행(모듈/인력).
-- ⚠️ 가격엔진/price_variants 는 건드리지 않음.

CREATE TABLE IF NOT EXISTS sq_nego_rates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solution VARCHAR(20) NOT NULL,
  target VARCHAR(20) NOT NULL,        -- 'MODULE' 또는 'LABOR'
  company_key VARCHAR(30) NOT NULL,   -- ENT/PUBLIC/FINANCE/MID/SMALL
  onsite_key VARCHAR(20) NOT NULL,    -- ONSITE/REMOTE
  rate DECIMAL(5,3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq (solution, target, company_key, onsite_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
