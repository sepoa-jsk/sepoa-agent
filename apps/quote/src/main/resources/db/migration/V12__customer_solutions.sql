-- 고객사 사용 솔루션 (2026-10-31, 사용자 요청: "동일한 고객이 솔루션을 여러 개 사용하는 경우도 있어")
--
-- solutions  고객사가 쓰는(또는 견적 대상인) 솔루션 코드를 쉼표로 이어 쓴다. 예) 'PROCURE,SEAL'
--            sq_solutions.code. 비어 있으면 미지정. 한 고객사 = 한 행 그대로(솔루션마다 행을 늘리지 않는다).
-- 개발 DB(test_01)에는 같은 내용을 수동 적용한다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_mst_customer`
  ADD COLUMN IF NOT EXISTS `solutions` varchar(200) DEFAULT NULL COMMENT '사용 솔루션 코드(쉼표 구분)' AFTER `name`;
