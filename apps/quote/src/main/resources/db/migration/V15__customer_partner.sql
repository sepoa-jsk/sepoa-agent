-- 고객사 종류 · 경유 업체 (2026-11-02, 사용자 요청: "JW 고객, BSG 중간 컨설팅펌 인 경우 입력 필드 보완")
--
-- kind      CUSTOMER 고객 | PARTNER 중간업체(컨설팅펌 · SI 등). 중간업체도 고객사관리에 한 줄로 둔다(담당자 · 연락처를 한 번만 입력).
-- via_code  채널이 간접(AGENCY)인 고객의 경유 업체 — 중간업체 행의 code. 예) JW 행의 via_code = BSG 행의 code
--           견적 [고객사 선택] 에서 JW 를 고르면 수신처 = BSG(담당자 · 연락처 · 이메일), 최종 고객사 = JW 로 채운다.
-- 개발 DB(test_01)에는 같은 내용을 수동 적용한다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_mst_customer`
  ADD COLUMN IF NOT EXISTS `kind` varchar(10) NOT NULL DEFAULT 'CUSTOMER' COMMENT '종류 CUSTOMER 고객 | PARTNER 중간업체' AFTER `name`,
  ADD COLUMN IF NOT EXISTS `via_code` varchar(20) DEFAULT NULL COMMENT '경유 업체(중간업체 code) — 간접 채널' AFTER `channel`;
