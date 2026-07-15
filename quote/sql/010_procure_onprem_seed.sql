-- ============================================================
-- 전자구매(PROCURE) 온프레미스(ONPREM) 가격정책 시드
-- 출처: 전자구매_가격정책_202603_v1_0.xlsx / 시트 "On-premise_신규"
-- 기준월: 2026.03
-- 재실행 안전(UPSERT). 기존 데이터는 히스토리 위해 삭제하지 않음.
-- ============================================================
SET NAMES utf8mb4;

-- 마스터: 솔루션/배포형태 보강
INSERT INTO sq_solutions (code, name, source) VALUES
  ('PROCURE', '전자구매', 'SingleSuite')
ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO sq_deployments (code, name) VALUES
  ('ONPREM', '구축형(On-premise)')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- ── 기업구분 6개 (상주/비상주 포함) ─────────────────────────
INSERT INTO sq_company_classes (solution, deployment, `key`, label, sort) VALUES
  ('PROCURE','ONPREM','MID1',   '중견/중소#1 (매출 3,000억 이하·비상주)', 1),
  ('PROCURE','ONPREM','MID2_NR','중견/중소#2 (매출 1조 이하·비상주)',   2),
  ('PROCURE','ONPREM','MID2_R', '중견/중소#2 (매출 1조 이하·상주)',     3),
  ('PROCURE','ONPREM','ENT_NR', '대기업/공공/금융 (매출 1조 이상·비상주)',4),
  ('PROCURE','ONPREM','ENT_R',  '대기업/공공/금융 (매출 1조 이상·상주)', 5),
  ('PROCURE','ONPREM','STRAT',  '전략적제안 (매출 무관·비상주)',        6)
ON DUPLICATE KEY UPDATE label=VALUES(label), sort=VALUES(sort);

-- ============================================================
-- [솔루션] DISCOUNT — variant.price에 구분별 제안가 직접 저장
-- ============================================================
INSERT INTO sq_price_items
  (solution, deployment, category, code, name, spec, pricing_type, base_price, unit, qty_default, required, recurring, note, active, sort) VALUES
  ('PROCURE','ONPREM','솔루션','PRO_ONP_SOURCING','Poa Sourcing™','소싱/견적/입찰','DISCOUNT',80000000,'식',1,1,0,'기준단가 8천만',1,1),
  ('PROCURE','ONPREM','솔루션','PRO_ONP_ORDERING','Poa Ordering™','발주/조달','DISCOUNT',80000000,'식',1,1,0,'기준단가 8천만',1,2),
  ('PROCURE','ONPREM','솔루션','PRO_ONP_CONTRACT','Poa Contract™','계약관리','DISCOUNT',60000000,'식',1,0,0,'기준단가 6천만',1,3),
  ('PROCURE','ONPREM','솔루션','PRO_ONP_EV','Poa EV™','공급사평가','DISCOUNT',60000000,'식',1,0,0,'기준단가 6천만',1,4),
  ('PROCURE','ONPREM','솔루션','PRO_ONP_COMMON','Poa Common™','공통/그리드 병합','DISCOUNT',40000000,'식',1,1,0,'기준단가 4천만',1,5)
ON DUPLICATE KEY UPDATE
  name=VALUES(name), spec=VALUES(spec), pricing_type=VALUES(pricing_type),
  base_price=VALUES(base_price), unit=VALUES(unit), category=VALUES(category),
  note=VALUES(note), sort=VALUES(sort), required=VALUES(required), active=VALUES(active);

-- 솔루션 variants (기존 삭제 후 재삽입)
DELETE v FROM sq_price_variants v JOIN sq_price_items i ON v.item_id=i.id
  WHERE i.code IN ('PRO_ONP_SOURCING','PRO_ONP_ORDERING','PRO_ONP_CONTRACT','PRO_ONP_EV','PRO_ONP_COMMON');

-- Poa Sourcing / Ordering (동일가)
INSERT INTO sq_price_variants (item_id,`key`,label,rate,price,sort)
SELECT id,'MID1','중견/중소#1',0.35,30000000,1 FROM sq_price_items WHERE code='PRO_ONP_SOURCING'
UNION ALL SELECT id,'MID2_NR','중견/중소#2·비상주',0.40,35000000,2 FROM sq_price_items WHERE code='PRO_ONP_SOURCING'
UNION ALL SELECT id,'MID2_R','중견/중소#2·상주',0.45,40000000,3 FROM sq_price_items WHERE code='PRO_ONP_SOURCING'
UNION ALL SELECT id,'ENT_NR','대기업·비상주',0.45,40000000,4 FROM sq_price_items WHERE code='PRO_ONP_SOURCING'
UNION ALL SELECT id,'ENT_R','대기업·상주',0.60,50000000,5 FROM sq_price_items WHERE code='PRO_ONP_SOURCING'
UNION ALL SELECT id,'STRAT','전략적제안',0.30,25000000,6 FROM sq_price_items WHERE code='PRO_ONP_SOURCING';

INSERT INTO sq_price_variants (item_id,`key`,label,rate,price,sort)
SELECT id,'MID1','중견/중소#1',0.35,30000000,1 FROM sq_price_items WHERE code='PRO_ONP_ORDERING'
UNION ALL SELECT id,'MID2_NR','중견/중소#2·비상주',0.40,35000000,2 FROM sq_price_items WHERE code='PRO_ONP_ORDERING'
UNION ALL SELECT id,'MID2_R','중견/중소#2·상주',0.45,40000000,3 FROM sq_price_items WHERE code='PRO_ONP_ORDERING'
UNION ALL SELECT id,'ENT_NR','대기업·비상주',0.45,40000000,4 FROM sq_price_items WHERE code='PRO_ONP_ORDERING'
UNION ALL SELECT id,'ENT_R','대기업·상주',0.60,50000000,5 FROM sq_price_items WHERE code='PRO_ONP_ORDERING'
UNION ALL SELECT id,'STRAT','전략적제안',0.30,25000000,6 FROM sq_price_items WHERE code='PRO_ONP_ORDERING';

-- Poa Contract / EV (동일가)
INSERT INTO sq_price_variants (item_id,`key`,label,rate,price,sort)
SELECT id,'MID1','중견/중소#1',0.35,15000000,1 FROM sq_price_items WHERE code='PRO_ONP_CONTRACT'
UNION ALL SELECT id,'MID2_NR','중견/중소#2·비상주',0.40,20000000,2 FROM sq_price_items WHERE code='PRO_ONP_CONTRACT'
UNION ALL SELECT id,'MID2_R','중견/중소#2·상주',0.45,30000000,3 FROM sq_price_items WHERE code='PRO_ONP_CONTRACT'
UNION ALL SELECT id,'ENT_NR','대기업·비상주',0.45,30000000,4 FROM sq_price_items WHERE code='PRO_ONP_CONTRACT'
UNION ALL SELECT id,'ENT_R','대기업·상주',0.60,40000000,5 FROM sq_price_items WHERE code='PRO_ONP_CONTRACT'
UNION ALL SELECT id,'STRAT','전략적제안',0.30,15000000,6 FROM sq_price_items WHERE code='PRO_ONP_CONTRACT';

INSERT INTO sq_price_variants (item_id,`key`,label,rate,price,sort)
SELECT id,'MID1','중견/중소#1',0.35,15000000,1 FROM sq_price_items WHERE code='PRO_ONP_EV'
UNION ALL SELECT id,'MID2_NR','중견/중소#2·비상주',0.40,20000000,2 FROM sq_price_items WHERE code='PRO_ONP_EV'
UNION ALL SELECT id,'MID2_R','중견/중소#2·상주',0.45,30000000,3 FROM sq_price_items WHERE code='PRO_ONP_EV'
UNION ALL SELECT id,'ENT_NR','대기업·비상주',0.45,30000000,4 FROM sq_price_items WHERE code='PRO_ONP_EV'
UNION ALL SELECT id,'ENT_R','대기업·상주',0.60,40000000,5 FROM sq_price_items WHERE code='PRO_ONP_EV'
UNION ALL SELECT id,'STRAT','전략적제안',0.30,15000000,6 FROM sq_price_items WHERE code='PRO_ONP_EV';

-- Poa Common (전 구분 1천만 균일)
INSERT INTO sq_price_variants (item_id,`key`,label,rate,price,sort)
SELECT id,'MID1','중견/중소#1',0.35,10000000,1 FROM sq_price_items WHERE code='PRO_ONP_COMMON'
UNION ALL SELECT id,'MID2_NR','중견/중소#2·비상주',0.40,10000000,2 FROM sq_price_items WHERE code='PRO_ONP_COMMON'
UNION ALL SELECT id,'MID2_R','중견/중소#2·상주',0.45,10000000,3 FROM sq_price_items WHERE code='PRO_ONP_COMMON'
UNION ALL SELECT id,'ENT_NR','대기업·비상주',0.45,10000000,4 FROM sq_price_items WHERE code='PRO_ONP_COMMON'
UNION ALL SELECT id,'ENT_R','대기업·상주',0.60,10000000,5 FROM sq_price_items WHERE code='PRO_ONP_COMMON'
UNION ALL SELECT id,'STRAT','전략적제안',0.30,10000000,6 FROM sq_price_items WHERE code='PRO_ONP_COMMON';

-- ============================================================
-- [개발인건비] MM — base_price×rate×qty. rate=구분별 네고율
--   qty_default = 표준 투입 M/M (엑셀 수량 컬럼)
-- ============================================================
INSERT INTO sq_price_items
  (solution, deployment, category, code, name, spec, pricing_type, base_price, unit, qty_default, required, recurring, note, active, sort) VALUES
  ('PROCURE','ONPREM','개발인건비','PRO_ONP_PI',   '컨설턴트(PI)','SW산업협회 표준단가','MM',25000000,'M/M',0.2,0,0,'옵션·상주시 투입',1,11),
  ('PROCURE','ONPREM','개발인건비','PRO_ONP_PMO',  'PMO(사업관리)','SW산업협회 표준단가','MM',25000000,'M/M',0.5,0,0,'옵션·상주시 투입',1,12),
  ('PROCURE','ONPREM','개발인건비','PRO_ONP_PM',   'PM','SW산업협회 표준단가','MM',25000000,'M/M',1,1,0,NULL,1,13),
  ('PROCURE','ONPREM','개발인건비','PRO_ONP_DEV',  '응용소프트웨어 개발','SW산업협회 표준단가','MM',19000000,'M/M',1,1,0,NULL,1,14),
  ('PROCURE','ONPREM','개발인건비','PRO_ONP_UIUX', 'UI/UX개발','SW산업협회 표준단가','MM',17000000,'M/M',1,1,0,NULL,1,15),
  ('PROCURE','ONPREM','개발인건비','PRO_ONP_TA',   'IT 아키텍트(TA)','SW산업협회 표준단가','MM',25000000,'M/M',1,1,0,NULL,1,16),
  ('PROCURE','ONPREM','개발인건비','PRO_ONP_QAO',  'QAO(품질관리자)','SW산업협회 표준단가','MM',25000000,'M/M',0.5,0,0,'옵션·상주시 투입',1,17)
ON DUPLICATE KEY UPDATE
  name=VALUES(name), spec=VALUES(spec), pricing_type=VALUES(pricing_type),
  base_price=VALUES(base_price), unit=VALUES(unit), qty_default=VALUES(qty_default),
  category=VALUES(category), note=VALUES(note), sort=VALUES(sort),
  required=VALUES(required), active=VALUES(active);

-- 인건비 variants: rate만 구분별로 (모든 인건비 품목 동일 네고율 테이블)
DELETE v FROM sq_price_variants v JOIN sq_price_items i ON v.item_id=i.id
  WHERE i.code IN ('PRO_ONP_PI','PRO_ONP_PMO','PRO_ONP_PM','PRO_ONP_DEV','PRO_ONP_UIUX','PRO_ONP_TA','PRO_ONP_QAO');

INSERT INTO sq_price_variants (item_id,`key`,label,rate,price,sort)
SELECT i.id, c.k, c.lbl, c.rate, NULL, c.srt
FROM sq_price_items i
JOIN (
  SELECT 'MID1' k,'중견/중소#1' lbl,0.55 rate,1 srt UNION ALL
  SELECT 'MID2_NR','중견/중소#2·비상주',0.60,2 UNION ALL
  SELECT 'MID2_R','중견/중소#2·상주',0.65,3 UNION ALL
  SELECT 'ENT_NR','대기업·비상주',0.65,4 UNION ALL
  SELECT 'ENT_R','대기업·상주',0.70,5 UNION ALL
  SELECT 'STRAT','전략적제안',0.50,6
) c
WHERE i.code IN ('PRO_ONP_PI','PRO_ONP_PMO','PRO_ONP_PM','PRO_ONP_DEV','PRO_ONP_UIUX','PRO_ONP_TA','PRO_ONP_QAO');

-- ============================================================
-- [3rd party] FIXED — 전 구분 동일가
-- ============================================================
INSERT INTO sq_price_items
  (solution, deployment, category, code, name, spec, pricing_type, base_price, unit, qty_default, required, recurring, note, active, sort) VALUES
  ('PROCURE','ONPREM','3rd party','PRO_ONP_PKI',    'PKI툴킷','전자서명 툴킷','FIXED',10000000,'식',1,0,0,'서버이중화시 2식',1,21),
  ('PROCURE','ONPREM','3rd party','PRO_ONP_PKI_EASY','PKI툴킷(간편인증)','간편인증 툴킷','FIXED',15000000,'식',1,0,0,NULL,1,22)
ON DUPLICATE KEY UPDATE
  name=VALUES(name), spec=VALUES(spec), pricing_type=VALUES(pricing_type),
  base_price=VALUES(base_price), unit=VALUES(unit), category=VALUES(category),
  note=VALUES(note), sort=VALUES(sort), active=VALUES(active);
-- 참고: PKI 기준단가(List)는 15,000,000/20,000,000이나 전 구분 제안가가 10,000,000/15,000,000 균일.
--       FIXED는 base_price를 그대로 단가로 쓰므로 base_price에 제안가를 넣음.
