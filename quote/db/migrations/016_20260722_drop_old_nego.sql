-- 042_drop_old_nego.sql
-- 네고율을 단일 sq_nego_rates(040) 로 통합함에 따라, 분리형 (구) 테이블 제거.
-- ⚠️ 가격엔진/price_variants 와 무관. 이 두 테이블은 어디서도 참조되지 않는다.

DROP TABLE IF EXISTS sq_module_rates;
DROP TABLE IF EXISTS sq_labor_rates_v2;
