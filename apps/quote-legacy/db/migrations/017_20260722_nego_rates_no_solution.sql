-- 042_nego_rates_no_solution.sql
-- 네고율을 "전 솔루션 공통"으로 변경 → solution 컬럼 제거.
-- 기존 sq_nego_rates(솔루션 포함) 를 버리고 재정의한다.
-- ⚠️ 가격엔진/price_variants 와 무관.

DROP TABLE IF EXISTS sq_nego_rates;

CREATE TABLE sq_nego_rates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  target VARCHAR(20) NOT NULL,        -- MODULE / LABOR
  company_key VARCHAR(30) NOT NULL,   -- ENT/PUBLIC/FINANCE/MID/SMALL
  onsite_key VARCHAR(20) NOT NULL,    -- ONSITE/REMOTE
  rate DECIMAL(5,3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq (target, company_key, onsite_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
