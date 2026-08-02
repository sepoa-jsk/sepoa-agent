-- ============================================================
-- 006 백필 손상 복구 — onetime_total 이 할인을 반영하지 않은 견적
--
-- 구버전 006_20260730_phase5c_blocks.sql 의 백필 5 는
--   UPDATE sq_quotes SET onetime_total = supply_amount WHERE onetime_total = 0
-- 이었다. onetime_total = 0 을 "아직 백필 안 됨"으로 오판해, 특별DC 가 걸린 견적의
-- 일시불 합계를 할인 전 금액(supply_amount)으로 덮어썼다. 이력이 없어 migrate 를
-- 돌릴 때마다 재발했다.
--
-- 작업 9 에서 기준선 견적 44 만 복구했고, 작업 10.5 에서 같은 손상 3건이 더 발견됐다
-- (개발 DB 기준 견적 1 · 4 · 14). 006 자체는 조건을 고쳤으므로 재발하지 않지만,
-- 이미 난 손상은 남아 있다. 이 파일이 그것을 되돌린다.
--
-- 판정 근거: total_amount 가 정답을 독립적으로 증언한다. 손상된 행은
--   total_amount = ROUND((supply_amount - discount_amount) * 1.1)
-- 을 만족한다 — 즉 VAT 포함 총액은 할인 후 금액으로 계산돼 있는데 onetime_total 만
-- 할인 전 값이다. 이 조건을 WHERE 에 넣어, 근거가 확인되는 행만 고친다.
-- 조건을 만족하지 않는 행은 성격이 다르므로 손대지 않고 수동 검토 대상으로 남긴다.
--
-- 신규 환경에서는 대상 0행이다(손상이 애초에 없다).
-- ============================================================
SET NAMES utf8mb4;

UPDATE sq_quotes
   SET onetime_total = supply_amount - discount_amount
 WHERE onetime_total = supply_amount
   AND discount_amount > 0
   AND total_amount = ROUND((supply_amount - discount_amount) * 1.1);
