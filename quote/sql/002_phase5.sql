-- 002_phase5.sql
-- Phase 5 공통 마스터 (전 솔루션 1벌): 임금단가(연도별) + 블록정의 + 견적조건 세트.
-- 여기만 고치면 전체 반영. 멱등(IF NOT EXISTS) — migrate 재실행 안전.
-- 기존 001 스키마는 건드리지 않는다. 시드 값은 seed/phase5.js 가 투입.

-- 임금단가 연도 헤더 (연도별 이력 + active 플래그)
CREATE TABLE IF NOT EXISTS sq_labor_rate_years (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `year`     INT          NOT NULL,
  source     VARCHAR(255) NULL,
  active     TINYINT      NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_year (`year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 임금단가 라인 (역할별 노임/적용가). apply_price = 기준단가로 사용.
-- ⚠️ 이름은 sq_labor_rate_lines. (레거시 sq_labor_rates = 구 네고 테이블과 충돌 회피.
--    header(sq_labor_rate_years)+lines 패턴 — sq_condition_sets/lines 와 동일 규칙.)
CREATE TABLE IF NOT EXISTS sq_labor_rate_lines (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  year_id     INT UNSIGNED NOT NULL,
  role_code   VARCHAR(30)  NOT NULL,
  role_name   VARCHAR(100) NOT NULL,
  grade       VARCHAR(40)  NULL,
  wage_md     BIGINT       NULL,
  wage_mm     BIGINT       NULL,
  apply_price BIGINT       NULL,
  note        VARCHAR(255) NULL,
  sort        INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_year_role (year_id, role_code),
  CONSTRAINT fk_labor_rate_year FOREIGN KEY (year_id) REFERENCES sq_labor_rate_years(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 블록 정의 (컬럼구성/계산방식/소계·recurring 여부)
CREATE TABLE IF NOT EXISTS sq_blocks (
  code         VARCHAR(30)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  `columns`    JSON         NULL,
  calc         VARCHAR(255) NULL,
  has_subtotal TINYINT      NOT NULL DEFAULT 1,
  recurring    TINYINT      NOT NULL DEFAULT 0,
  optional     TINYINT      NOT NULL DEFAULT 0,
  sort         INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 견적조건 세트 (구축형태별 하단 문구 세트)
CREATE TABLE IF NOT EXISTS sq_condition_sets (
  code VARCHAR(30)  NOT NULL,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 견적조건 라인
CREATE TABLE IF NOT EXISTS sq_condition_lines (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  set_code VARCHAR(30)  NOT NULL,
  line_no  INT          NOT NULL,
  `text`   VARCHAR(500) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_set (set_code),
  CONSTRAINT fk_cond_set FOREIGN KEY (set_code) REFERENCES sq_condition_sets(code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
