-- 052_labor_role_mapping.sql
-- 인력구분(sq_labor_roles)을 협회 노임단가(sq_labor_standards)와 연결.
-- standard_role_code 로 매핑 → 매년 협회단가만 갱신하면 기준단가 자동 반영.
SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS _addcol;
DELIMITER //
CREATE PROCEDURE _addcol(IN c VARCHAR(64), IN d VARCHAR(255))
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sq_labor_roles' AND COLUMN_NAME=c) THEN
    SET @s=CONCAT('ALTER TABLE sq_labor_roles ADD COLUMN ',d);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;
CALL _addcol('standard_role_code', "standard_role_code VARCHAR(30) NULL COMMENT '협회직군 매핑'");
DROP PROCEDURE _addcol;

-- 기본 매핑 (PDF 견적서 기준)
UPDATE sq_labor_roles SET standard_role_code='IT_PM'      WHERE code='PM';
UPDATE sq_labor_roles SET standard_role_code='DEV'        WHERE code='DEV';
UPDATE sq_labor_roles SET standard_role_code='UIUX'       WHERE code='UIUX';
UPDATE sq_labor_roles SET standard_role_code='ARCHITECT'  WHERE code='TA';
UPDATE sq_labor_roles SET standard_role_code='QAO'        WHERE code='PMO';
UPDATE sq_labor_roles SET standard_role_code='CONSULTANT' WHERE code='PI';
UPDATE sq_labor_roles SET standard_role_code='QAO'        WHERE code='QAO';
