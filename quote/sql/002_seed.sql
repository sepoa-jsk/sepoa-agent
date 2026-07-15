-- ============================================================
-- quote 견적서 시스템 — 시드 데이터 (002_seed.sql)
-- ⚠️ 가격은 동작 확인용 샘플값입니다. 실제 단가로 교체하세요.
--    (가격정책 관리 화면 또는 이 파일 재실행으로 수정)
-- 재실행 안전: 마스터는 INSERT ... ON DUPLICATE KEY UPDATE,
--             가격품목은 code UNIQUE 기준 UPSERT.
-- ============================================================

SET NAMES utf8mb4;

-- ── 솔루션 3종 ──────────────────────────────────────────────
INSERT INTO sq_solutions (code, name, source) VALUES
  ('EXPENSE', '경비관리', 'SingleSuite'),
  ('PROCURE', '전자구매', 'SingleSuite'),
  ('SEAL',    '전자인장', 'SingleSuite')
ON DUPLICATE KEY UPDATE name=VALUES(name), source=VALUES(source);

-- ── 배포형태 ────────────────────────────────────────────────
INSERT INTO sq_deployments (code, name) VALUES
  ('ONPREM', '구축형'),
  ('SAAS',   'SaaS')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- ── 기업구분 (솔루션 × 배포형태 × 규모) ─────────────────────
--    각 솔루션/배포 조합마다 대/중견/중소 3단계
INSERT INTO sq_company_classes (solution, deployment, `key`, label, sort) VALUES
  ('EXPENSE','ONPREM','LARGE','대기업 (500인 이상)',1),
  ('EXPENSE','ONPREM','MID',  '중견기업 (100~499인)',2),
  ('EXPENSE','ONPREM','SMALL','중소기업 (100인 미만)',3),
  ('EXPENSE','SAAS',  'LARGE','대기업 (500인 이상)',1),
  ('EXPENSE','SAAS',  'MID',  '중견기업 (100~499인)',2),
  ('EXPENSE','SAAS',  'SMALL','중소기업 (100인 미만)',3),
  ('PROCURE','ONPREM','LARGE','대기업 (500인 이상)',1),
  ('PROCURE','ONPREM','MID',  '중견기업 (100~499인)',2),
  ('PROCURE','ONPREM','SMALL','중소기업 (100인 미만)',3),
  ('PROCURE','SAAS',  'LARGE','대기업 (500인 이상)',1),
  ('PROCURE','SAAS',  'MID',  '중견기업 (100~499인)',2),
  ('PROCURE','SAAS',  'SMALL','중소기업 (100인 미만)',3),
  ('SEAL',   'ONPREM','LARGE','대기업 (500인 이상)',1),
  ('SEAL',   'ONPREM','MID',  '중견기업 (100~499인)',2),
  ('SEAL',   'ONPREM','SMALL','중소기업 (100인 미만)',3),
  ('SEAL',   'SAAS',  'LARGE','대기업 (500인 이상)',1),
  ('SEAL',   'SAAS',  'MID',  '중견기업 (100~499인)',2),
  ('SEAL',   'SAAS',  'SMALL','중소기업 (100인 미만)',3)
ON DUPLICATE KEY UPDATE label=VALUES(label), sort=VALUES(sort);

-- ── 가격품목 ────────────────────────────────────────────────
-- code 기준 UPSERT. variant 재삽입을 위해 기존 variant는 품목 삭제 없이 유지되도록
-- variant는 아래에서 item_id 조회 후 별도 처리.

-- EXPENSE / SAAS
INSERT INTO sq_price_items
  (solution, deployment, category, code, name, spec, pricing_type, base_price, unit, qty_default, required, recurring, note, active, sort) VALUES
  ('EXPENSE','SAAS','사용료','EXP_SAAS_USER','경비관리 SaaS 사용료','사용자당 월 이용료','BAND',15000,'user/월',1,1,1,'수량구간별 단가',1,1),
  ('EXPENSE','SAAS','구축','EXP_SAAS_SETUP','초기 셋업비','환경설정/기초데이터 이관','FIXED',3000000,'식',1,1,0,NULL,1,2),
  ('EXPENSE','SAAS','추가','EXP_SAAS_CUSTOM','커스터마이징','요건별 개발','MM',7000000,'M/M',0,0,0,'별도 협의',1,3),
-- EXPENSE / ONPREM
  ('EXPENSE','ONPREM','라이선스','EXP_ONP_LIC','경비관리 서버 라이선스','기업구분별 단가','DISCOUNT',30000000,'식',1,1,0,NULL,1,1),
  ('EXPENSE','ONPREM','구축','EXP_ONP_SETUP','구축비','설치/구축','FIXED',10000000,'식',1,1,0,NULL,1,2),
  ('EXPENSE','ONPREM','유지보수','EXP_ONP_MAINT','연간 유지보수','라이선스 대비율','FIXED',3000000,'년',1,0,1,'통상 라이선스의 10%',1,3),
  ('EXPENSE','ONPREM','추가','EXP_ONP_CUSTOM','커스터마이징','요건별 개발','MM',8000000,'M/M',0,0,0,'별도 협의',1,4),

-- PROCURE / SAAS
  ('PROCURE','SAAS','사용료','PRO_SAAS_USER','전자구매 SaaS 사용료','사용자당 월 이용료','BAND',20000,'user/월',1,1,1,'수량구간별 단가',1,1),
  ('PROCURE','SAAS','구축','PRO_SAAS_SETUP','초기 셋업비','환경설정/기초데이터 이관','FIXED',5000000,'식',1,1,0,NULL,1,2),
  ('PROCURE','SAAS','추가','PRO_SAAS_CUSTOM','커스터마이징','요건별 개발','MM',7000000,'M/M',0,0,0,'별도 협의',1,3),
-- PROCURE / ONPREM
  ('PROCURE','ONPREM','라이선스','PRO_ONP_LIC','전자구매 서버 라이선스','기업구분별 단가','DISCOUNT',50000000,'식',1,1,0,NULL,1,1),
  ('PROCURE','ONPREM','구축','PRO_ONP_SETUP','구축비','설치/구축/SRM 연동','FIXED',20000000,'식',1,1,0,NULL,1,2),
  ('PROCURE','ONPREM','유지보수','PRO_ONP_MAINT','연간 유지보수','라이선스 대비율','FIXED',5000000,'년',1,0,1,'통상 라이선스의 10%',1,3),
  ('PROCURE','ONPREM','추가','PRO_ONP_CUSTOM','커스터마이징','요건별 개발','MM',8000000,'M/M',0,0,0,'별도 협의',1,4),

-- SEAL / SAAS
  ('SEAL','SAAS','사용료','SEAL_SAAS_USER','전자인장 SaaS 사용료','사용자당 월 이용료','BAND',5000,'user/월',1,1,1,'수량구간별 단가',1,1),
  ('SEAL','SAAS','구축','SEAL_SAAS_SETUP','초기 셋업비','인감 등록/환경설정','FIXED',2000000,'식',1,1,0,NULL,1,2),
-- SEAL / ONPREM
  ('SEAL','ONPREM','라이선스','SEAL_ONP_LIC','전자인장 서버 라이선스','기업구분별 단가','DISCOUNT',15000000,'식',1,1,0,NULL,1,1),
  ('SEAL','ONPREM','구축','SEAL_ONP_SETUP','구축비','설치/구축','FIXED',5000000,'식',1,1,0,NULL,1,2),
  ('SEAL','ONPREM','유지보수','SEAL_ONP_MAINT','연간 유지보수','라이선스 대비율','FIXED',1500000,'년',1,0,1,'통상 라이선스의 10%',1,3)
ON DUPLICATE KEY UPDATE
  name=VALUES(name), spec=VALUES(spec), pricing_type=VALUES(pricing_type),
  base_price=VALUES(base_price), unit=VALUES(unit), category=VALUES(category),
  note=VALUES(note), sort=VALUES(sort), active=VALUES(active),
  required=VALUES(required), recurring=VALUES(recurring), qty_default=VALUES(qty_default);

-- ── 가격 변형 (variants) ────────────────────────────────────
-- 기존 variant 정리 후 재삽입 (샘플 대상 품목만)
DELETE v FROM sq_price_variants v
  JOIN sq_price_items i ON v.item_id = i.id
  WHERE i.code IN (
    'EXP_SAAS_USER','PRO_SAAS_USER','SEAL_SAAS_USER',
    'EXP_ONP_LIC','PRO_ONP_LIC','SEAL_ONP_LIC'
  );

-- BAND: SaaS 사용료 수량구간별 단가 (user 수 구간)
INSERT INTO sq_price_variants (item_id, `key`, label, min_qty, max_qty, rate, price, sort)
SELECT id, NULL, '1~50인', 1, 50, NULL, 15000, 1 FROM sq_price_items WHERE code='EXP_SAAS_USER'
UNION ALL SELECT id, NULL, '51~200인', 51, 200, NULL, 12000, 2 FROM sq_price_items WHERE code='EXP_SAAS_USER'
UNION ALL SELECT id, NULL, '201인 이상', 201, NULL, NULL, 10000, 3 FROM sq_price_items WHERE code='EXP_SAAS_USER'
UNION ALL SELECT id, NULL, '1~50인', 1, 50, NULL, 20000, 1 FROM sq_price_items WHERE code='PRO_SAAS_USER'
UNION ALL SELECT id, NULL, '51~200인', 51, 200, NULL, 17000, 2 FROM sq_price_items WHERE code='PRO_SAAS_USER'
UNION ALL SELECT id, NULL, '201인 이상', 201, NULL, NULL, 14000, 3 FROM sq_price_items WHERE code='PRO_SAAS_USER'
UNION ALL SELECT id, NULL, '1~50인', 1, 50, NULL, 5000, 1 FROM sq_price_items WHERE code='SEAL_SAAS_USER'
UNION ALL SELECT id, NULL, '51~200인', 51, 200, NULL, 4000, 2 FROM sq_price_items WHERE code='SEAL_SAAS_USER'
UNION ALL SELECT id, NULL, '201인 이상', 201, NULL, NULL, 3000, 3 FROM sq_price_items WHERE code='SEAL_SAAS_USER';

-- DISCOUNT: ONPREM 라이선스 기업구분별 적용율 (base_price × rate)
INSERT INTO sq_price_variants (item_id, `key`, label, min_qty, max_qty, rate, price, sort)
SELECT id, 'LARGE', '대기업', NULL, NULL, 1.000, NULL, 1 FROM sq_price_items WHERE code='EXP_ONP_LIC'
UNION ALL SELECT id, 'MID', '중견기업', NULL, NULL, 0.800, NULL, 2 FROM sq_price_items WHERE code='EXP_ONP_LIC'
UNION ALL SELECT id, 'SMALL', '중소기업', NULL, NULL, 0.600, NULL, 3 FROM sq_price_items WHERE code='EXP_ONP_LIC'
UNION ALL SELECT id, 'LARGE', '대기업', NULL, NULL, 1.000, NULL, 1 FROM sq_price_items WHERE code='PRO_ONP_LIC'
UNION ALL SELECT id, 'MID', '중견기업', NULL, NULL, 0.800, NULL, 2 FROM sq_price_items WHERE code='PRO_ONP_LIC'
UNION ALL SELECT id, 'SMALL', '중소기업', NULL, NULL, 0.600, NULL, 3 FROM sq_price_items WHERE code='PRO_ONP_LIC'
UNION ALL SELECT id, 'LARGE', '대기업', NULL, NULL, 1.000, NULL, 1 FROM sq_price_items WHERE code='SEAL_ONP_LIC'
UNION ALL SELECT id, 'MID', '중견기업', NULL, NULL, 0.800, NULL, 2 FROM sq_price_items WHERE code='SEAL_ONP_LIC'
UNION ALL SELECT id, 'SMALL', '중소기업', NULL, NULL, 0.600, NULL, 3 FROM sq_price_items WHERE code='SEAL_ONP_LIC';

-- ── 기본 설정값 (공급자 정보) ───────────────────────────────
INSERT INTO sq_settings (`key`, value) VALUES
  ('supplier_name', '세포아소프트(주)'),
  ('supplier_regno', '119-81-95026'),
  ('supplier_ceo', '이희림'),
  ('supplier_addr', ''),
  ('seal_image_path', ''),
  ('vat_rate', '0.10'),
  ('default_valid_days', '30')
ON DUPLICATE KEY UPDATE value=VALUES(value);