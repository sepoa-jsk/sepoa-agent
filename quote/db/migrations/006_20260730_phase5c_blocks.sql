-- 005_phase5c_blocks.sql
-- Phase 5-C: 견적을 블록 구조로 승격 + 일시불/월 분리 + 특별DC/절사 파라미터.
-- 근거: PLAN_PHASE5_REV §2·§4.
-- 멱등 원칙: ADD COLUMN IF NOT EXISTS / NOT EXISTS 가드 / WHERE ... IS NULL 백필만 사용.
-- 비파괴 원칙: 기존 sq_quote_sections 와 section_id 는 남긴다(레거시 조회·Excel 경로 보존).
--              블록은 섹션 위에 얹는 구조이며, 기존 데이터는 백필로 승격한다.

-- ── 견적 헤더: 유형/구축형태/템플릿 + 일시불·월 분리 + 절사단위 ──
ALTER TABLE sq_quotes ADD COLUMN IF NOT EXISTS quote_type VARCHAR(10) NOT NULL DEFAULT 'BUILD' AFTER quote_no;
ALTER TABLE sq_quotes ADD COLUMN IF NOT EXISTS deployment VARCHAR(20) NULL AFTER quote_type;
ALTER TABLE sq_quotes ADD COLUMN IF NOT EXISTS template_code VARCHAR(40) NULL AFTER deployment;
-- 일시불/월 합계를 분리 보관(실측: SaaS·PCloud 는 총견적가에 두 금액을 따로 노출)
ALTER TABLE sq_quotes ADD COLUMN IF NOT EXISTS onetime_total BIGINT NOT NULL DEFAULT 0 AFTER total_amount;
ALTER TABLE sq_quotes ADD COLUMN IF NOT EXISTS monthly_total BIGINT NOT NULL DEFAULT 0 AFTER onetime_total;
-- 절사 단위(실측 전부 십만단위). 0 이면 절사 안 함.
ALTER TABLE sq_quotes ADD COLUMN IF NOT EXISTS round_unit INT NOT NULL DEFAULT 100000 AFTER discount_value;
-- 특별DC 유형 확장: 실측 견적서는 "최종 얼마"로 떨어뜨리는 방식(TARGET)이라 값 추가.
-- ENUM 값 추가는 기존 행에 영향 없음(멱등).
ALTER TABLE sq_quotes MODIFY COLUMN discount_type ENUM('AMOUNT','RATE','TARGET') NULL;
-- 월사용료에도 특별DC 가 걸리는 실측이 있다(하겐다즈 SaaS: 월 300,000 → 100,000).
-- 일시불 DC 와 별도로 보관해야 재편집 시 값이 유지된다.
ALTER TABLE sq_quotes ADD COLUMN IF NOT EXISTS monthly_discount_type ENUM('AMOUNT','RATE','TARGET') NULL AFTER round_unit;
ALTER TABLE sq_quotes ADD COLUMN IF NOT EXISTS monthly_discount_value BIGINT NOT NULL DEFAULT 0 AFTER monthly_discount_type;

-- ── 견적 내 블록 인스턴스 ────────────────────────────────────
-- section_id 는 레거시 섹션과의 연결(백필 추적용). 신규 견적은 NULL 허용.
CREATE TABLE IF NOT EXISTS sq_quote_blocks (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_id   INT UNSIGNED NOT NULL,
  section_id INT UNSIGNED NULL,
  block_code VARCHAR(30)  NOT NULL,
  title      VARCHAR(120) NULL,
  subtotal   BIGINT       NOT NULL DEFAULT 0,
  recurring  TINYINT      NOT NULL DEFAULT 0,
  sort       INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_quote (quote_id),
  KEY idx_section (section_id),
  CONSTRAINT fk_qb_quote FOREIGN KEY (quote_id) REFERENCES sq_quotes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 품목/인건비를 블록에 연결 ────────────────────────────────
ALTER TABLE sq_quote_items ADD COLUMN IF NOT EXISTS block_id INT UNSIGNED NULL AFTER section_id;
ALTER TABLE sq_quote_items ADD INDEX IF NOT EXISTS idx_block (block_id);

ALTER TABLE sq_quote_labor ADD COLUMN IF NOT EXISTS block_id INT UNSIGNED NULL AFTER section_id;
ALTER TABLE sq_quote_labor ADD COLUMN IF NOT EXISTS role_label VARCHAR(120) NULL AFTER role_name;
ALTER TABLE sq_quote_labor ADD COLUMN IF NOT EXISTS grade VARCHAR(40) NULL AFTER role_label;
-- 인력투입계획(옵션): {"M":0.25,"M1":0.25,...}, Σ = mm 이어야 한다(엔진 검증)
ALTER TABLE sq_quote_labor ADD COLUMN IF NOT EXISTS month_alloc TEXT NULL AFTER amount;
ALTER TABLE sq_quote_labor ADD INDEX IF NOT EXISTS idx_block (block_id);

-- ── 백필 1: 기존 섹션×블록코드 조합을 블록 인스턴스로 승격 ──
-- 기존 품목은 block_code 가 NULL(Phase 0~4) → SOLUTION 블록으로 본다.
INSERT INTO sq_quote_blocks (quote_id, section_id, block_code, title, subtotal, recurring, sort)
SELECT s.quote_id, s.id, COALESCE(i.block_code, 'SOLUTION'),
       COALESCE(b.name, '솔루션 견적'), COALESCE(SUM(i.amount), 0), COALESCE(b.recurring, 0), MIN(i.sort)
  FROM sq_quote_sections s
  JOIN sq_quote_items i ON i.section_id = s.id
  LEFT JOIN sq_blocks b ON b.code = COALESCE(i.block_code, 'SOLUTION')
 WHERE NOT EXISTS (SELECT 1 FROM sq_quote_blocks qb WHERE qb.section_id = s.id)
 GROUP BY s.quote_id, s.id, COALESCE(i.block_code, 'SOLUTION'), b.name, b.recurring;

-- ── 백필 2: 품목 → 블록 연결 ────────────────────────────────
UPDATE sq_quote_items i
  JOIN sq_quote_sections s ON s.id = i.section_id
  JOIN sq_quote_blocks qb ON qb.section_id = s.id AND qb.block_code = COALESCE(i.block_code, 'SOLUTION')
   SET i.block_id = qb.id, i.block_code = COALESCE(i.block_code, 'SOLUTION')
 WHERE i.block_id IS NULL;

-- ── 백필 3: 인건비 → LABOR 블록 연결(없으면 생성) ───────────
INSERT INTO sq_quote_blocks (quote_id, section_id, block_code, title, subtotal, recurring, sort)
SELECT s.quote_id, s.id, 'LABOR', '시스템 구축 견적(개발인건비)', COALESCE(SUM(l.amount), 0), 0, 90
  FROM sq_quote_sections s
  JOIN sq_quote_labor l ON l.section_id = s.id
 WHERE NOT EXISTS (SELECT 1 FROM sq_quote_blocks qb WHERE qb.section_id = s.id AND qb.block_code = 'LABOR')
 GROUP BY s.quote_id, s.id;

UPDATE sq_quote_labor l
  JOIN sq_quote_sections s ON s.id = l.section_id
  JOIN sq_quote_blocks qb ON qb.section_id = s.id AND qb.block_code = 'LABOR'
   SET l.block_id = qb.id
 WHERE l.block_id IS NULL;

-- ── 백필 4: 헤더의 구축형태/템플릿을 섹션에서 끌어올림 ───────
UPDATE sq_quotes q
  JOIN (SELECT quote_id, MIN(id) AS sid FROM sq_quote_sections GROUP BY quote_id) f ON f.quote_id = q.id
  JOIN sq_quote_sections s ON s.id = f.sid
   SET q.deployment = s.deployment, q.template_code = s.template_code
 WHERE q.deployment IS NULL;

-- ── 백필 5: 일시불 합계(기존 견적은 전액 일시불로 본다) ──────
UPDATE sq_quotes SET onetime_total = supply_amount WHERE onetime_total = 0 AND supply_amount > 0;
