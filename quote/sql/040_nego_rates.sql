-- 040_nego_rates.sql
-- 가격정책용 네고율 테이블 (기업구분 × 상주여부 조합별). 모듈용/인력용 2개.
-- 이번 단계는 테이블 생성 + API 추가까지만. 값 채우기(시드)는 다음 단계.

-- 모듈용 네고율
CREATE TABLE IF NOT EXISTS sq_module_rates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solution VARCHAR(20) NOT NULL,
  company_key VARCHAR(30) NOT NULL,   -- ENT/PUBLIC/FINANCE/MID/SMALL
  onsite_key VARCHAR(20) NOT NULL,    -- ONSITE/REMOTE
  rate DECIMAL(5,3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq (solution, company_key, onsite_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 인력용 네고율 (기존 sq_labor_rates 를 이 구조로 교체하거나 신규)
CREATE TABLE IF NOT EXISTS sq_labor_rates_v2 (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solution VARCHAR(20) NOT NULL,
  company_key VARCHAR(30) NOT NULL,
  onsite_key VARCHAR(20) NOT NULL,
  rate DECIMAL(5,3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq (solution, company_key, onsite_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
