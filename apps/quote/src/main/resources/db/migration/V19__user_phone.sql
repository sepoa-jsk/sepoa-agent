-- 사용자 핸드폰번호 (2026-11-03, 사용자 요청: "사용자정보 전화번호 필드 추가하고 핸드폰번호로 입력")
--
-- phone  핸드폰번호 — 예) 010-1234-5678. 사용자관리 화면에서 넣고, 견적 작성 2단계의 '영업 연락처' 기본값이 된다.
-- 개발 DB(test_01)에는 같은 내용을 수동 적용한다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_users`
  ADD COLUMN IF NOT EXISTS `phone` varchar(30) DEFAULT NULL COMMENT '핸드폰번호' AFTER `position`;
