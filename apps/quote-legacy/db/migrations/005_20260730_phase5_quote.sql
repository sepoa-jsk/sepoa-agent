-- 004_phase5_quote.sql
-- Phase 5-C: 견적 2단가 확장 + 블록/인건비 수용.
-- ADD COLUMN IF NOT EXISTS + NULL 만 백필(WHERE ... IS NULL) → 멱등·비파괴.
-- 기존 데이터 보존: unit_price/amount 는 그대로, 새 컬럼만 채운다.

-- 섹션: 템플릿/브랜드
ALTER TABLE sq_quote_sections ADD COLUMN IF NOT EXISTS template_code VARCHAR(40) NULL AFTER solution;
ALTER TABLE sq_quote_sections ADD COLUMN IF NOT EXISTS brand VARCHAR(60) NULL AFTER template_code;

-- 품목: 블록코드 + 제안단가(base_price 는 054에서 이미 추가됨)
ALTER TABLE sq_quote_items ADD COLUMN IF NOT EXISTS block_code VARCHAR(30) NULL AFTER category;
ALTER TABLE sq_quote_items ADD COLUMN IF NOT EXISTS proposed_price BIGINT NULL AFTER base_price;

-- 백필(1회): 기존 unit_price 를 proposed_price 로 의미 이관 (NULL 인 것만)
UPDATE sq_quote_items SET proposed_price = unit_price WHERE proposed_price IS NULL;

-- 기준단가 백필: 아직 비어 있는 것만 price_items 정가로 (매칭되는 경우만)
UPDATE sq_quote_items i JOIN sq_price_items p ON p.code = i.item_code
   SET i.base_price = p.base_price
 WHERE i.base_price IS NULL AND p.base_price > 0;

-- 인건비(LABOR) 블록 라인 스냅샷 (기준/제안단가 모두 저장 → 과거 견적 불변)
CREATE TABLE IF NOT EXISTS sq_quote_labor (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  section_id     INT UNSIGNED NOT NULL,
  role_code      VARCHAR(30)  NOT NULL,
  role_name      VARCHAR(100) NULL,
  task           VARCHAR(255) NULL,
  mm             DECIMAL(6,2) NOT NULL DEFAULT 0,
  base_price     BIGINT       NULL,
  proposed_price BIGINT       NULL,
  amount         BIGINT       NOT NULL DEFAULT 0,
  sort           INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_section (section_id),
  CONSTRAINT fk_ql_section FOREIGN KEY (section_id) REFERENCES sq_quote_sections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
