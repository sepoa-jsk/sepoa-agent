-- 050_labor_standards.sql
-- SW협회 노임단가 마스터 (연도별). 노임단가(M/D)만 입력하면 기준단가는
-- calcStandardRate(lib/labor-standard.js)로 산정한다.
CREATE TABLE IF NOT EXISTS sq_labor_standards (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  year INT NOT NULL,
  role_code VARCHAR(30) NOT NULL,
  role_name VARCHAR(100) NOT NULL,
  daily_rate BIGINT NOT NULL,
  work_days DECIMAL(4,1) NOT NULL DEFAULT 20.5,
  overhead_rate DECIMAL(4,3) NOT NULL DEFAULT 1.100,
  tech_rate DECIMAL(4,3) NOT NULL DEFAULT 0.200,
  sort INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq (year, role_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
