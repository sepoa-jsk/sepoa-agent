-- ============================================================
-- quote 마스터 재설계 스키마 (020_master_schema.sql)
-- 기존 테이블 보존. 신규 마스터 추가 + price_items 참조 컬럼 확장.
-- 견적서 3블록(온프): 솔루션/인건비/3rd party. SaaS 별도.
-- 재실행 안전: CREATE IF NOT EXISTS + ALTER는 존재확인 프로시저 사용.
-- ============================================================
SET NAMES utf8mb4;

-- ── 서비스구분 (SaaS 전용) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS sq_service_types (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solution   VARCHAR(20)  NOT NULL,
  code       VARCHAR(30)  NOT NULL,
  name       VARCHAR(150) NOT NULL,
  user_unit  INT          NOT NULL DEFAULT 1,      -- 과금 단위(1 or 5 User)
  min_price  BIGINT       NOT NULL DEFAULT 0,      -- 최소가격
  note       VARCHAR(300) NULL,
  active     TINYINT      NOT NULL DEFAULT 1,
  sort       INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service (solution, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 모듈 (① 솔루션 블록, 온프 DISCOUNT) ────────────────────
CREATE TABLE IF NOT EXISTS sq_modules (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solution   VARCHAR(20)  NOT NULL,
  code       VARCHAR(50)  NOT NULL,
  name       VARCHAR(150) NOT NULL,
  base_price BIGINT       NOT NULL DEFAULT 0,       -- 기준단가(List)
  required   TINYINT      NOT NULL DEFAULT 0,
  note       VARCHAR(300) NULL,
  active     TINYINT      NOT NULL DEFAULT 1,
  sort       INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_module (solution, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 인력구분 (② 인건비 블록, 온프 MM) ──────────────────────
CREATE TABLE IF NOT EXISTS sq_labor_roles (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solution   VARCHAR(20)  NOT NULL,
  code       VARCHAR(50)  NOT NULL,
  name       VARCHAR(150) NOT NULL,
  base_price BIGINT       NOT NULL DEFAULT 0,       -- 표준단가(SW산업협회)
  std_mm     DECIMAL(6,2) NOT NULL DEFAULT 1,       -- 표준 투입 M/M
  required   TINYINT      NOT NULL DEFAULT 0,       -- 1=필수 0=옵션
  note       VARCHAR(300) NULL,
  active     TINYINT      NOT NULL DEFAULT 1,
  sort       INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_labor (solution, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3rd party (③ 블록, 온프 FIXED) ─────────────────────────
CREATE TABLE IF NOT EXISTS sq_thirdparty (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solution   VARCHAR(20)  NOT NULL,
  code       VARCHAR(50)  NOT NULL,
  name       VARCHAR(150) NOT NULL,
  base_price BIGINT       NOT NULL DEFAULT 0,       -- 제안 고정가
  list_price BIGINT       NULL,                     -- 참고 List price
  note       VARCHAR(300) NULL,
  active     TINYINT      NOT NULL DEFAULT 1,
  sort       INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_thirdparty (solution, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 인력 네고율표 (인력 × 기업구분) ────────────────────────
--    인건비 블록의 구분별 네고율을 정식 마스터로.
--    (price_variants로도 가능하나, 마스터에서 일괄관리 위해 분리)
CREATE TABLE IF NOT EXISTS sq_labor_rates (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solution      VARCHAR(20)  NOT NULL,
  company_key   VARCHAR(30)  NOT NULL,   -- sq_company_classes.key
  rate          DECIMAL(5,3) NOT NULL,   -- 네고율
  sort          INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_labor_rate (solution, company_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 기업구분 컬럼 보강 (매출조건/상주여부 정식화) ──────────
-- 기존 sq_company_classes에 컬럼 추가 (없을 때만)
DROP PROCEDURE IF EXISTS _add_col;
DELIMITER //
CREATE PROCEDURE _add_col(IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl VARCHAR(255))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col
  ) THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN ', ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

CALL _add_col('sq_company_classes', 'revenue_cond', "revenue_cond VARCHAR(100) NULL COMMENT '매출조건'");
CALL _add_col('sq_company_classes', 'onsite',       "onsite TINYINT NULL COMMENT '1=상주 0=비상주'");
CALL _add_col('sq_company_classes', 'active',       "active TINYINT NOT NULL DEFAULT 1");

-- ── price_items 참조 컬럼 확장 ─────────────────────────────
CALL _add_col('sq_price_items', 'block',           "block VARCHAR(20) NULL COMMENT 'SOLUTION/LABOR/THIRDPARTY/SAAS_SERVICE/SAAS_ETC'");
CALL _add_col('sq_price_items', 'module_code',     "module_code VARCHAR(50) NULL");
CALL _add_col('sq_price_items', 'labor_role_code', "labor_role_code VARCHAR(50) NULL");
CALL _add_col('sq_price_items', 'thirdparty_code', "thirdparty_code VARCHAR(50) NULL");
CALL _add_col('sq_price_items', 'service_type',    "service_type VARCHAR(30) NULL");

DROP PROCEDURE IF EXISTS _add_col;

-- 참고: 기존 category(한글) 컬럼은 당분간 유지(마이그레이션 안전).
--       신규 block 컬럼으로 점진 전환.