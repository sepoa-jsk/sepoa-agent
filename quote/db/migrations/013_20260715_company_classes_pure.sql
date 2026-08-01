-- 031_company_classes_pure.sql
-- 기업구분을 "순수 5종 고정"으로 재정의 (상주/비상주는 030 의 sq_onsite_types 로 분리).
-- 화면에서는 드롭다운(ENT/PUBLIC/FINANCE/MID/SMALL)으로만 선택한다.
-- onsite 컬럼은 미사용(NULL) 유지. deployment 는 기업구분 개념상 ONPREM 고정.
-- ⚠️ price_variants / 가격엔진은 절대 건드리지 않음. 가격 재매핑은 다음 단계.

DELETE FROM sq_company_classes WHERE solution='PROCURE';

INSERT INTO sq_company_classes (solution, deployment, `key`, label, revenue_cond, onsite, active, sort) VALUES
  ('PROCURE','ONPREM','ENT',    '대기업',   '매출 1조 이상',   NULL, 1, 1),
  ('PROCURE','ONPREM','PUBLIC', '공공기관', '매출 무관',       NULL, 1, 2),
  ('PROCURE','ONPREM','FINANCE','금융',     '매출 무관',       NULL, 1, 3),
  ('PROCURE','ONPREM','MID',    '중견기업', '매출 1조 이하',   NULL, 1, 4),
  ('PROCURE','ONPREM','SMALL',  '중소기업', '매출 3천억 이하', NULL, 1, 5);

-- 잔재 제거 (다른 솔루션의 LARGE 샘플)
DELETE FROM sq_company_classes WHERE `key`='LARGE';
