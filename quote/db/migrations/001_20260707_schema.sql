-- ============================================================
-- quote 견적서 자동생성 시스템 — MariaDB 스키마 (sq_ 접두어)
-- PLAN.md 4번 스키마 기준. 기존 sepoa-aidlc-pms와 동일 DB 인스턴스에 추가.
-- 문자셋: utf8mb4 / 엔진: InnoDB
-- ============================================================

SET NAMES utf8mb4;

-- ── 마스터: 솔루션 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sq_solutions (
  code   VARCHAR(20)  NOT NULL,
  name   VARCHAR(100) NOT NULL,
  source VARCHAR(150) NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 마스터: 배포형태 (ONPREM/SAAS/PCLOUD/SVC) ───────────────
CREATE TABLE IF NOT EXISTS sq_deployments (
  code VARCHAR(20)  NOT NULL,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 마스터: 기업구분 (솔루션×배포형태별) ────────────────────
CREATE TABLE IF NOT EXISTS sq_company_classes (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solution   VARCHAR(20)  NOT NULL,
  deployment VARCHAR(20)  NOT NULL,
  `key`      VARCHAR(30)  NOT NULL,
  label      VARCHAR(150) NOT NULL,
  sort       INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_class (solution, deployment, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 가격정책: 품목 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sq_price_items (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solution     VARCHAR(20)  NOT NULL,
  deployment   VARCHAR(20)  NOT NULL,
  category     VARCHAR(50)  NULL,
  code         VARCHAR(50)  NOT NULL,
  name         VARCHAR(150) NOT NULL,
  spec         VARCHAR(300) NULL,
  pricing_type ENUM('DISCOUNT','BAND','FIXED','MM') NOT NULL,
  base_price   BIGINT       NOT NULL DEFAULT 0,
  unit         VARCHAR(20)  NULL,
  qty_default  DECIMAL(6,2) NOT NULL DEFAULT 1,
  required     TINYINT      NOT NULL DEFAULT 0,
  recurring    TINYINT      NOT NULL DEFAULT 0,
  note         VARCHAR(300) NULL,
  active       TINYINT      NOT NULL DEFAULT 1,
  sort         INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_code (code),
  KEY idx_item_sol_dep (solution, deployment, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 가격정책: 변형(기업구분단가/수량구간/적용율) ────────────
CREATE TABLE IF NOT EXISTS sq_price_variants (
  id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_id INT UNSIGNED NOT NULL,
  `key`   VARCHAR(30)  NULL,
  label   VARCHAR(150) NULL,
  min_qty DECIMAL(12,2) NULL,
  max_qty DECIMAL(12,2) NULL,
  rate    DECIMAL(5,3)  NULL,
  price   BIGINT        NULL,          -- NULL = 별도협의
  sort    INT           NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_variant_item (item_id),
  CONSTRAINT fk_variant_item FOREIGN KEY (item_id)
    REFERENCES sq_price_items (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 사용자 (Google SSO auto-provisioning) ───────────────────
CREATE TABLE IF NOT EXISTS sq_users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(150) NOT NULL,
  name          VARCHAR(100) NULL,
  picture       VARCHAR(500) NULL,
  role          ENUM('ADMIN','USER') NOT NULL DEFAULT 'USER',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 설정 (key-value: 공급자정보, 인감경로 등) ───────────────
CREATE TABLE IF NOT EXISTS sq_settings (
  `key`  VARCHAR(50) NOT NULL,
  value  TEXT        NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 견적번호 채번 (일자별 시퀀스) ───────────────────────────
CREATE TABLE IF NOT EXISTS sq_quote_seq (
  seq_date DATE NOT NULL,
  last_no  INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (seq_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 견적 (헤더) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sq_quotes (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_no         VARCHAR(20)  NOT NULL,
  quote_date       DATE         NOT NULL,
  valid_until      DATE         NULL,
  customer_name    VARCHAR(150) NULL,
  customer_contact VARCHAR(150) NULL,
  discount_type    ENUM('AMOUNT','RATE') NULL,
  discount_value   DECIMAL(12,2) NOT NULL DEFAULT 0,
  supply_amount    BIGINT       NOT NULL DEFAULT 0,
  discount_amount  BIGINT       NOT NULL DEFAULT 0,
  vat_amount       BIGINT       NOT NULL DEFAULT 0,
  total_amount     BIGINT       NOT NULL DEFAULT 0,
  status           ENUM('DRAFT','SENT','WON','LOST') NOT NULL DEFAULT 'DRAFT',
  memo             TEXT         NULL,
  created_by       INT UNSIGNED NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quote_no (quote_no),
  KEY idx_quote_status (status),
  KEY idx_quote_customer (customer_name),
  CONSTRAINT fk_quote_user FOREIGN KEY (created_by)
    REFERENCES sq_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 견적 섹션 (솔루션×배포형태) ─────────────────────────────
CREATE TABLE IF NOT EXISTS sq_quote_sections (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_id        INT UNSIGNED NOT NULL,
  solution        VARCHAR(20)  NOT NULL,
  deployment      VARCHAR(20)  NOT NULL,
  company_class   VARCHAR(30)  NULL,
  contract_months INT          NOT NULL DEFAULT 1,
  params          JSON         NULL,
  subtotal        BIGINT       NOT NULL DEFAULT 0,
  sort            INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_section_quote (quote_id),
  CONSTRAINT fk_section_quote FOREIGN KEY (quote_id)
    REFERENCES sq_quotes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 견적 품목 (단가 스냅샷 저장) ────────────────────────────
CREATE TABLE IF NOT EXISTS sq_quote_items (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  section_id INT UNSIGNED NOT NULL,
  item_code  VARCHAR(50)  NULL,
  category   VARCHAR(50)  NULL,
  name       VARCHAR(150) NOT NULL,
  spec       VARCHAR(300) NULL,
  qty        DECIMAL(8,2) NOT NULL DEFAULT 1,
  unit       VARCHAR(20)  NULL,
  months     INT          NOT NULL DEFAULT 1,
  unit_price BIGINT       NOT NULL DEFAULT 0,
  amount     BIGINT       NOT NULL DEFAULT 0,
  note       VARCHAR(300) NULL,
  sort       INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_qitem_section (section_id),
  CONSTRAINT fk_qitem_section FOREIGN KEY (section_id)
    REFERENCES sq_quote_sections (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
