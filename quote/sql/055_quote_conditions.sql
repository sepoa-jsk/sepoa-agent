-- 055_quote_conditions.sql
-- 견적조건: 견적별 저장 컬럼(conditions) + 설정 템플릿 기본값(quote_condition_templates).
SET NAMES utf8mb4;

ALTER TABLE sq_quotes ADD COLUMN IF NOT EXISTS conditions TEXT NULL;

-- 견적조건 템플릿 기본 시드 (이미 있으면 관리자 설정 유지 → 덮어쓰지 않음)
INSERT INTO sq_settings (`key`, value) VALUES
  ('quote_condition_templates', '[{"text":"프로젝트 투입공수 및 일정은 세부 업무요건에 따라 변경될 수 있습니다.","auto":false},{"text":"개발단가는 한국SW산업협회 노임 단가 기준 {laborRate}%를 적용하였습니다.","auto":true},{"text":"동일서버 내 Company 추가시 License는 솔루션 공급가의 25%가 적용됩니다.(서버 분리시 50%)","auto":false},{"text":"솔루션 유지보수는 시스템 오픈 후 12개월간 무상유지보수 이후 진행되며, 유상유지보수는 솔루션 공급가의 15%로 제안합니다.","auto":false},{"text":"본 프로젝트는 {onsiteLabel} 제안합니다. 업무 협의, 통합테스트 등 필요시에는 방문 진행합니다.","auto":true},{"text":"PKI툴킷은 서버 이중화 구성시 2식이 필요합니다.","auto":false}]')
ON DUPLICATE KEY UPDATE value = value;
