-- 054_quote_item_base.sql
-- 견적 품목에 기준단가(base_price) 스냅샷 컬럼 추가 → 엑셀에서 기준단가/제안단가
-- 둘 다 출력. (MariaDB: ADD COLUMN IF NOT EXISTS 지원)
ALTER TABLE sq_quote_items
  ADD COLUMN IF NOT EXISTS base_price BIGINT NULL AFTER unit_price;
