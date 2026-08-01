-- 003_phase5_templates.sql
-- Phase 5-B 개별 레이어: 솔루션×구축형태 템플릿(헤더/블록/기본모듈/인건비 기본).
-- 공통(002_phase5)의 sq_blocks / sq_condition_sets 를 참조만 한다(값 복사 금지).
-- 멱등(IF NOT EXISTS). 시드는 seed/phase5.js.

-- 템플릿 헤더 (솔루션×구축형태)
CREATE TABLE IF NOT EXISTS sq_quote_templates (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solution            VARCHAR(30)  NOT NULL,
  code                VARCHAR(40)  NOT NULL,
  name                VARCHAR(120) NOT NULL,
  deployment          VARCHAR(20)  NOT NULL,
  brand               VARCHAR(60)  NULL,
  include_maintenance TINYINT      NOT NULL DEFAULT 0,
  include_component   TINYINT      NOT NULL DEFAULT 0,
  condition_set       VARCHAR(30)  NULL,
  active              TINYINT      NOT NULL DEFAULT 1,
  sort                INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_code (code),
  KEY idx_solution (solution),
  CONSTRAINT fk_tpl_cond FOREIGN KEY (condition_set) REFERENCES sq_condition_sets(code) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 템플릿이 포함하는 블록(순서) → sq_blocks 참조
CREATE TABLE IF NOT EXISTS sq_template_blocks (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_id INT UNSIGNED NOT NULL,
  block_code  VARCHAR(30)  NOT NULL,
  sort        INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_tpl (template_id),
  CONSTRAINT fk_tb_tpl FOREIGN KEY (template_id) REFERENCES sq_quote_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_tb_block FOREIGN KEY (block_code) REFERENCES sq_blocks(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 템플릿 선택 시 자동 편입될 기본 모듈(블록별) → price_items.code 소프트 매핑
CREATE TABLE IF NOT EXISTS sq_template_items (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_id INT UNSIGNED NOT NULL,
  block_code  VARCHAR(30)  NOT NULL,
  item_code   VARCHAR(60)  NOT NULL,
  qty_default DECIMAL(10,2) NOT NULL DEFAULT 1,
  sort        INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_tpl (template_id),
  CONSTRAINT fk_ti_tpl FOREIGN KEY (template_id) REFERENCES sq_quote_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 인건비(LABOR) 블록 기본 투입계획 → labor_rate_lines.role_code 소프트 참조
CREATE TABLE IF NOT EXISTS sq_template_labor (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_id INT UNSIGNED NOT NULL,
  role_code   VARCHAR(30)  NOT NULL,
  label       VARCHAR(120) NULL,
  task        VARCHAR(255) NULL,
  mm_default  DECIMAL(6,2) NOT NULL DEFAULT 0,
  sort        INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_tpl (template_id),
  CONSTRAINT fk_tl_tpl FOREIGN KEY (template_id) REFERENCES sq_quote_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5-B(REV) 보정: 견적유형 + 인력투입계획 플래그 + 인건비 표기/등급 ──
-- PLAN_PHASE5_REV §1·§4 반영. 선행 배포본에 없으므로 멱등 ALTER 로 추가한다.

-- quote_type: BUILD | MAINT | ADDDEV (이번 구현은 BUILD 만, 나머지는 Phase 6 예약)
ALTER TABLE sq_quote_templates ADD COLUMN IF NOT EXISTS quote_type VARCHAR(10) NOT NULL DEFAULT 'BUILD' AFTER id;
-- has_labor_plan: 켜면 인건비 라인에 월별 배분(M/M1/M2…) 입력 + 인력투입계획표 출력
ALTER TABLE sq_quote_templates ADD COLUMN IF NOT EXISTS has_labor_plan TINYINT NOT NULL DEFAULT 0 AFTER condition_set;
ALTER TABLE sq_quote_templates ADD INDEX IF NOT EXISTS idx_type_solution (quote_type, solution);

-- label → role_label 로 통일(REV §4 명칭), 등급 컬럼 추가.
ALTER TABLE sq_template_labor CHANGE COLUMN IF EXISTS label role_label VARCHAR(120) NULL;
ALTER TABLE sq_template_labor ADD COLUMN IF NOT EXISTS grade VARCHAR(40) NULL AFTER role_label;
-- 셋업비를 MM 으로 산정하는 SaaS/PCloud 는 인건비 기본이 SETUP 블록에 붙는다
-- (REV §4 원안에는 없으나, labor_default 와 setup_labor_default 를 구분하려면 필요).
ALTER TABLE sq_template_labor ADD COLUMN IF NOT EXISTS block_code VARCHAR(30) NOT NULL DEFAULT 'LABOR' AFTER template_id;
