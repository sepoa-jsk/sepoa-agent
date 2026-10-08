-- ============================================================
-- 전자구매(PROCURE) SaaS 가격정책 시드
-- 출처: 전자구매_가격정책_202603_v1_0.xlsx / 시트 "SaaS_신규"
-- 기준월: 2026.03
-- 서비스 4종(S2C/S2P/P2P/Sourcing) = 별도 BAND 품목
-- User 구간별 총액(월). 1~5명 인원별 정밀 반영. S2C 2명=50만(사용자 확정)
-- 재실행 안전(UPSERT).
-- ============================================================
SET NAMES utf8mb4;

INSERT INTO sq_deployments (code, name) VALUES ('SAAS','SaaS')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- ── 서비스 구분 (company_classes 재활용: 서비스 선택용) ──────
INSERT INTO sq_company_classes (solution, deployment, `key`, label, sort) VALUES
  ('PROCURE','SAAS','S2C',     'S2C (Sourcing to Contract)', 1),
  ('PROCURE','SAAS','S2P',     'S2P (Sourcing to Pay)',      2),
  ('PROCURE','SAAS','P2P',     'P2P (Procure to Pay)',       3),
  ('PROCURE','SAAS','SOURCING','Sourcing (Sourcing only)',   4)
ON DUPLICATE KEY UPDATE label=VALUES(label), sort=VALUES(sort);

-- ============================================================
-- 서비스 이용료 (BAND) — 4개 품목. recurring=1(월 이용료)
--   base_price는 참고용(1User 단가), 실제 금액은 variant 구간 총액.
-- ============================================================
INSERT INTO sq_price_items
  (solution, deployment, category, code, name, spec, pricing_type, base_price, unit, qty_default, required, recurring, note, active, sort) VALUES
  ('PROCURE','SAAS','서비스이용료','PRO_SAAS_S2C','S2C 서비스 이용료','견적/입찰/계약관리','BAND',200000,'User/월',1,1,1,'1User 단위 구간',1,1),
  ('PROCURE','SAAS','서비스이용료','PRO_SAAS_S2P','S2P 서비스 이용료','견적~조달/AP마감','BAND',300000,'User/월',1,1,1,'5User 단위 구간',1,2),
  ('PROCURE','SAAS','서비스이용료','PRO_SAAS_P2P','P2P 서비스 이용료','조달/발주/마감','BAND',500000,'5User/월',1,1,1,'5User 단위 구간',1,3),
  ('PROCURE','SAAS','서비스이용료','PRO_SAAS_SOURCING','Sourcing 서비스 이용료','소싱(입찰) 전용','BAND',100000,'User/월',1,1,1,'월10건미만 30만정액',1,4)
ON DUPLICATE KEY UPDATE
  name=VALUES(name), spec=VALUES(spec), pricing_type=VALUES(pricing_type),
  base_price=VALUES(base_price), unit=VALUES(unit), category=VALUES(category),
  note=VALUES(note), sort=VALUES(sort), recurring=VALUES(recurring),
  required=VALUES(required), active=VALUES(active);

-- variants 재삽입
DELETE v FROM sq_price_variants v JOIN sq_price_items i ON v.item_id=i.id
  WHERE i.code IN ('PRO_SAAS_S2C','PRO_SAAS_S2P','PRO_SAAS_P2P','PRO_SAAS_SOURCING');

-- S2C: 1~5명 인원별(1·2명=50만,3명=60만,4명=80만,5명=100만), 이후 5명단위 구간
INSERT INTO sq_price_variants (item_id,label,min_qty,max_qty,price,sort)
SELECT id,'1명',1,1,500000,1  FROM sq_price_items WHERE code='PRO_SAAS_S2C'
UNION ALL SELECT id,'2명',2,2,500000,2   FROM sq_price_items WHERE code='PRO_SAAS_S2C'
UNION ALL SELECT id,'3명',3,3,600000,3   FROM sq_price_items WHERE code='PRO_SAAS_S2C'
UNION ALL SELECT id,'4명',4,4,800000,4   FROM sq_price_items WHERE code='PRO_SAAS_S2C'
UNION ALL SELECT id,'5명',5,5,1000000,5  FROM sq_price_items WHERE code='PRO_SAAS_S2C'
UNION ALL SELECT id,'6~10명',6,10,1500000,6   FROM sq_price_items WHERE code='PRO_SAAS_S2C'
UNION ALL SELECT id,'11~15명',11,15,2000000,7 FROM sq_price_items WHERE code='PRO_SAAS_S2C'
UNION ALL SELECT id,'16~20명',16,20,2500000,8 FROM sq_price_items WHERE code='PRO_SAAS_S2C'
UNION ALL SELECT id,'21~25명',21,25,3000000,9 FROM sq_price_items WHERE code='PRO_SAAS_S2C'
UNION ALL SELECT id,'26~30명',26,30,3500000,10 FROM sq_price_items WHERE code='PRO_SAAS_S2C';

-- Sourcing: 1~5명 인원별(30/40/50/60/70만), 이후 구간. 26+ 300만
INSERT INTO sq_price_variants (item_id,label,min_qty,max_qty,price,sort)
SELECT id,'1명',1,1,300000,1  FROM sq_price_items WHERE code='PRO_SAAS_SOURCING'
UNION ALL SELECT id,'2명',2,2,400000,2   FROM sq_price_items WHERE code='PRO_SAAS_SOURCING'
UNION ALL SELECT id,'3명',3,3,500000,3   FROM sq_price_items WHERE code='PRO_SAAS_SOURCING'
UNION ALL SELECT id,'4명',4,4,600000,4   FROM sq_price_items WHERE code='PRO_SAAS_SOURCING'
UNION ALL SELECT id,'5명',5,5,700000,5   FROM sq_price_items WHERE code='PRO_SAAS_SOURCING'
UNION ALL SELECT id,'6~10명',6,10,1000000,6   FROM sq_price_items WHERE code='PRO_SAAS_SOURCING'
UNION ALL SELECT id,'11~15명',11,15,1500000,7 FROM sq_price_items WHERE code='PRO_SAAS_SOURCING'
UNION ALL SELECT id,'16~20명',16,20,2000000,8 FROM sq_price_items WHERE code='PRO_SAAS_SOURCING'
UNION ALL SELECT id,'21~25명',21,25,2500000,9 FROM sq_price_items WHERE code='PRO_SAAS_SOURCING'
UNION ALL SELECT id,'26명 이상',26,NULL,3000000,10 FROM sq_price_items WHERE code='PRO_SAAS_SOURCING';

-- P2P: 5User 단위 구간
INSERT INTO sq_price_variants (item_id,label,min_qty,max_qty,price,sort)
SELECT id,'1~5명',1,5,500000,1  FROM sq_price_items WHERE code='PRO_SAAS_P2P'
UNION ALL SELECT id,'6~10명',6,10,1000000,2   FROM sq_price_items WHERE code='PRO_SAAS_P2P'
UNION ALL SELECT id,'11~20명',11,20,1500000,3 FROM sq_price_items WHERE code='PRO_SAAS_P2P'
UNION ALL SELECT id,'21~30명',21,30,2000000,4 FROM sq_price_items WHERE code='PRO_SAAS_P2P'
UNION ALL SELECT id,'31~40명',31,40,2500000,5 FROM sq_price_items WHERE code='PRO_SAAS_P2P'
UNION ALL SELECT id,'41~50명',41,50,3000000,6 FROM sq_price_items WHERE code='PRO_SAAS_P2P';

-- S2P: 5User 단위 구간
INSERT INTO sq_price_variants (item_id,label,min_qty,max_qty,price,sort)
SELECT id,'1~5명',1,5,1500000,1  FROM sq_price_items WHERE code='PRO_SAAS_S2P'
UNION ALL SELECT id,'6~10명',6,10,2000000,2   FROM sq_price_items WHERE code='PRO_SAAS_S2P'
UNION ALL SELECT id,'11~20명',11,20,2500000,3 FROM sq_price_items WHERE code='PRO_SAAS_S2P'
UNION ALL SELECT id,'21~30명',21,30,3000000,4 FROM sq_price_items WHERE code='PRO_SAAS_S2P'
UNION ALL SELECT id,'31~40명',31,40,3500000,5 FROM sq_price_items WHERE code='PRO_SAAS_S2P'
UNION ALL SELECT id,'41~50명',41,50,4000000,6 FROM sq_price_items WHERE code='PRO_SAAS_S2P';

-- ============================================================
-- SaaS 공통/부가 항목 (FIXED)
-- ============================================================
INSERT INTO sq_price_items
  (solution, deployment, category, code, name, spec, pricing_type, base_price, unit, qty_default, required, recurring, note, active, sort) VALUES
  ('PROCURE','SAAS','기본','PRO_SAAS_SETUP','기본 셋업비','초기 환경설정','FIXED',3000000,'식',1,1,0,NULL,1,11),
  ('PROCURE','SAAS','부가','PRO_SAAS_BIA','Poa-BiA 비용','인터페이스 모듈','FIXED',200000,'월',1,0,1,NULL,1,12),
  ('PROCURE','SAAS','부가','PRO_SAAS_INFRA_S2C','독립인프라(S2C)','서버/DBMS','FIXED',600000,'월',1,0,1,'S2C 기준',1,13),
  ('PROCURE','SAAS','부가','PRO_SAAS_INFRA_S2P','독립인프라(S2P)','서버/DBMS','FIXED',800000,'월',1,0,1,'S2P 기준',1,14)
ON DUPLICATE KEY UPDATE
  name=VALUES(name), spec=VALUES(spec), pricing_type=VALUES(pricing_type),
  base_price=VALUES(base_price), unit=VALUES(unit), category=VALUES(category),
  note=VALUES(note), sort=VALUES(sort), recurring=VALUES(recurring),
  required=VALUES(required), active=VALUES(active);

-- ============================================================
-- SaaS 옵션 모듈 (FIXED, 월정액·사용자수 무관)
-- ============================================================
INSERT INTO sq_price_items
  (solution, deployment, category, code, name, spec, pricing_type, base_price, unit, qty_default, required, recurring, note, active, sort) VALUES
  ('PROCURE','SAAS','옵션모듈','PRO_SAAS_OPT_EVAL','협력사평가','옵션','FIXED',200000,'월',1,0,1,'S2P는 30만',1,21),
  ('PROCURE','SAAS','옵션모듈','PRO_SAAS_OPT_BUDGET','예산관리','옵션','FIXED',200000,'월',1,0,1,NULL,1,22),
  ('PROCURE','SAAS','옵션모듈','PRO_SAAS_OPT_QUALITY','품질모듈','옵션','FIXED',200000,'월',1,0,1,NULL,1,23),
  ('PROCURE','SAAS','옵션모듈','PRO_SAAS_OPT_STOCK','재고관리모듈','옵션','FIXED',200000,'월',1,0,1,NULL,1,24)
ON DUPLICATE KEY UPDATE
  name=VALUES(name), spec=VALUES(spec), pricing_type=VALUES(pricing_type),
  base_price=VALUES(base_price), unit=VALUES(unit), category=VALUES(category),
  note=VALUES(note), sort=VALUES(sort), recurring=VALUES(recurring),
  required=VALUES(required), active=VALUES(active);
