-- 사용자 담당 솔루션 (2026-11-03, 사용자 요청: "사용자정보에서 담당 솔루션을 선택하게 해주고 견적서 작성시 담당 솔루션을 기본으로 자동 선택")
--
-- solutions  담당 솔루션 코드를 쉼표로 이어 쓴다. 예) 'PROCURE,SEAL' — sq_solutions.code. 비어 있으면 미지정.
--            고객사 사용 솔루션(V12 sq_mst_customer.solutions)과 같은 방식. 견적 작성 1단계는 첫 번째 코드를 기본으로 고른다.
-- 개발 DB(test_01)에는 같은 내용을 수동 적용한다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_users`
  ADD COLUMN IF NOT EXISTS `solutions` varchar(200) DEFAULT NULL COMMENT '담당 솔루션 코드(쉼표 구분)' AFTER `role_code`;
