-- 041_nego_rates_seed.sql
-- 네고율 값 시드 (전자구매 PROCURE, 기업구분 5 × 상주여부 2 = 각 10건).
-- ON DUPLICATE KEY UPDATE 라 재실행해도 안전(idempotent).

SET NAMES utf8mb4;

-- 모듈용 네고율 (기업구분 5 × 상주 2 = 10)
INSERT INTO sq_module_rates (solution, company_key, onsite_key, rate) VALUES
  ('PROCURE','ENT','REMOTE',0.45),    ('PROCURE','ENT','ONSITE',0.60),
  ('PROCURE','PUBLIC','REMOTE',0.45), ('PROCURE','PUBLIC','ONSITE',0.60),
  ('PROCURE','FINANCE','REMOTE',0.45),('PROCURE','FINANCE','ONSITE',0.60),
  ('PROCURE','MID','REMOTE',0.40),    ('PROCURE','MID','ONSITE',0.45),
  ('PROCURE','SMALL','REMOTE',0.35),  ('PROCURE','SMALL','ONSITE',0.35)
ON DUPLICATE KEY UPDATE rate=VALUES(rate);

-- 인력용 네고율 (기업구분 5 × 상주 2 = 10)
INSERT INTO sq_labor_rates_v2 (solution, company_key, onsite_key, rate) VALUES
  ('PROCURE','ENT','REMOTE',0.65),    ('PROCURE','ENT','ONSITE',0.70),
  ('PROCURE','PUBLIC','REMOTE',0.65), ('PROCURE','PUBLIC','ONSITE',0.70),
  ('PROCURE','FINANCE','REMOTE',0.65),('PROCURE','FINANCE','ONSITE',0.70),
  ('PROCURE','MID','REMOTE',0.60),    ('PROCURE','MID','ONSITE',0.65),
  ('PROCURE','SMALL','REMOTE',0.55),  ('PROCURE','SMALL','ONSITE',0.55)
ON DUPLICATE KEY UPDATE rate=VALUES(rate);
