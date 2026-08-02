-- 052_labor_role_mapping.sql
-- 인력구분(sq_labor_roles)을 협회 노임단가(sq_labor_standards)와 연결.
-- standard_role_code 로 매핑 → 매년 협회단가만 갱신하면 기준단가 자동 반영.
SET NAMES utf8mb4;

-- 2026-08-02 수정: 009 와 동일한 DELIMITER 결함이 있었다. 러너가 세미콜론으로 쪼개
--   프로시저 본문이 파열되고 ER_PARSE_ERROR 로 죽는다. ADD COLUMN IF NOT EXISTS 로 치환.
ALTER TABLE sq_labor_roles
  ADD COLUMN IF NOT EXISTS standard_role_code VARCHAR(30) NULL COMMENT '협회직군 매핑';

-- 기본 매핑 (PDF 견적서 기준)
UPDATE sq_labor_roles SET standard_role_code='IT_PM'      WHERE code='PM';
UPDATE sq_labor_roles SET standard_role_code='DEV'        WHERE code='DEV';
UPDATE sq_labor_roles SET standard_role_code='UIUX'       WHERE code='UIUX';
UPDATE sq_labor_roles SET standard_role_code='ARCHITECT'  WHERE code='TA';
UPDATE sq_labor_roles SET standard_role_code='QAO'        WHERE code='PMO';
UPDATE sq_labor_roles SET standard_role_code='CONSULTANT' WHERE code='PI';
UPDATE sq_labor_roles SET standard_role_code='QAO'        WHERE code='QAO';
