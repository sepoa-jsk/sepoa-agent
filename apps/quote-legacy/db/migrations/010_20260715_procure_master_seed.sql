-- ============================================================
-- 전자구매 마스터 시드 (021_procure_master_seed.sql)
-- 출처: 전자구매_가격정책_202603_v1_0.xlsx
-- 마스터 테이블에 정규화: 기업구분/서비스구분/모듈/인력/3rd party/네고율
-- 재실행 안전(UPSERT).
-- ============================================================
SET NAMES utf8mb4;

-- ── 솔루션/구축형태 ─────────────────────────────────────────
INSERT INTO sq_solutions (code, name, source) VALUES
  ('PROCURE','전자구매','SingleSuite')
ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO sq_deployments (code, name) VALUES
  ('ONPREM','구축형(On-premise)'), ('SAAS','SaaS')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- ── 기업구분 (온프 6구분, 매출조건·상주여부 정식화) ────────
INSERT INTO sq_company_classes
  (solution, deployment, `key`, label, revenue_cond, onsite, active, sort) VALUES
  ('PROCURE','ONPREM','MID1',   '중견/중소#1',        '매출 3,000억 이하', 0, 1, 1),
  ('PROCURE','ONPREM','MID2_NR','중견/중소#2 (비상주)','매출 1조 이하',     0, 1, 2),
  ('PROCURE','ONPREM','MID2_R', '중견/중소#2 (상주)',  '매출 1조 이하',     1, 1, 3),
  ('PROCURE','ONPREM','ENT_NR', '대기업/공공/금융 (비상주)','매출 1조 이상', 0, 1, 4),
  ('PROCURE','ONPREM','ENT_R',  '대기업/공공/금융 (상주)',  '매출 1조 이상', 1, 1, 5),
  ('PROCURE','ONPREM','STRAT',  '전략적제안',          '매출 무관',         0, 1, 6)
ON DUPLICATE KEY UPDATE
  label=VALUES(label), revenue_cond=VALUES(revenue_cond),
  onsite=VALUES(onsite), active=VALUES(active), sort=VALUES(sort);

-- ── 서비스구분 (SaaS 4서비스) ──────────────────────────────
INSERT INTO sq_service_types
  (solution, code, name, user_unit, min_price, note, active, sort) VALUES
  ('PROCURE','S2C',     'S2C (Sourcing to Contract)', 1, 500000, '견적/입찰/계약관리',       1, 1),
  ('PROCURE','S2P',     'S2P (Sourcing to Pay)',      5, 500000, '견적~조달/AP마감',         1, 2),
  ('PROCURE','P2P',     'P2P (Procure to Pay)',       5, 500000, '조달/발주/마감',           1, 3),
  ('PROCURE','SOURCING','Sourcing (Sourcing only)',   1, 300000, '소싱 전용·월10건미만 정액', 1, 4)
ON DUPLICATE KEY UPDATE
  name=VALUES(name), user_unit=VALUES(user_unit), min_price=VALUES(min_price),
  note=VALUES(note), active=VALUES(active), sort=VALUES(sort);

-- ── 모듈 (① 솔루션 블록, DISCOUNT) ─────────────────────────
INSERT INTO sq_modules
  (solution, code, name, base_price, required, note, active, sort) VALUES
  ('PROCURE','SOURCING','Poa Sourcing™', 80000000, 1, '소싱/견적/입찰', 1, 1),
  ('PROCURE','ORDERING','Poa Ordering™', 80000000, 1, '발주/조달',      1, 2),
  ('PROCURE','CONTRACT','Poa Contract™', 60000000, 0, '계약관리',       1, 3),
  ('PROCURE','EV',      'Poa EV™',       60000000, 0, '공급사평가',     1, 4),
  ('PROCURE','COMMON',  'Poa Common™',   40000000, 1, '공통/그리드 병합', 1, 5)
ON DUPLICATE KEY UPDATE
  name=VALUES(name), base_price=VALUES(base_price), required=VALUES(required),
  note=VALUES(note), active=VALUES(active), sort=VALUES(sort);

-- ── 인력구분 (② 인건비 블록, MM) ───────────────────────────
INSERT INTO sq_labor_roles
  (solution, code, name, base_price, std_mm, required, note, active, sort) VALUES
  ('PROCURE','PI',   '컨설턴트(PI)',       25000000, 0.2, 0, '옵션·상주시', 1, 1),
  ('PROCURE','PMO',  'PMO(사업관리)',      25000000, 0.5, 0, '옵션·상주시', 1, 2),
  ('PROCURE','PM',   'PM',                 25000000, 1.0, 1, NULL,          1, 3),
  ('PROCURE','DEV',  '응용소프트웨어 개발', 19000000, 1.0, 1, NULL,          1, 4),
  ('PROCURE','UIUX', 'UI/UX개발',          17000000, 1.0, 1, NULL,          1, 5),
  ('PROCURE','TA',   'IT 아키텍트(TA)',    25000000, 1.0, 1, NULL,          1, 6),
  ('PROCURE','QAO',  'QAO(품질관리자)',    25000000, 0.5, 0, '옵션·상주시', 1, 7)
ON DUPLICATE KEY UPDATE
  name=VALUES(name), base_price=VALUES(base_price), std_mm=VALUES(std_mm),
  required=VALUES(required), note=VALUES(note), active=VALUES(active), sort=VALUES(sort);

-- ── 인력 네고율표 (인력 공통 × 기업구분) ───────────────────
INSERT INTO sq_labor_rates (solution, company_key, rate, sort) VALUES
  ('PROCURE','MID1',    0.55, 1),
  ('PROCURE','MID2_NR', 0.60, 2),
  ('PROCURE','MID2_R',  0.65, 3),
  ('PROCURE','ENT_NR',  0.65, 4),
  ('PROCURE','ENT_R',   0.70, 5),
  ('PROCURE','STRAT',   0.50, 6)
ON DUPLICATE KEY UPDATE rate=VALUES(rate), sort=VALUES(sort);

-- ── 3rd party (③ 블록, FIXED) ──────────────────────────────
INSERT INTO sq_thirdparty
  (solution, code, name, base_price, list_price, note, active, sort) VALUES
  ('PROCURE','PKI',     'PKI툴킷',          10000000, 15000000, '서버이중화시 2식', 1, 1),
  ('PROCURE','PKI_EASY','PKI툴킷(간편인증)', 15000000, 20000000, NULL,               1, 2)
ON DUPLICATE KEY UPDATE
  name=VALUES(name), base_price=VALUES(base_price), list_price=VALUES(list_price),
  note=VALUES(note), active=VALUES(active), sort=VALUES(sort);