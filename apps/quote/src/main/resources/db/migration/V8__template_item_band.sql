-- 템플릿 품목의 구간 단위 (2026-10-30, 사용자 승인)
--
-- SaaS 구간형 서비스(S2C · S2P …)는 인원 구간(USER) / 건수 구간(COUNT)마다 '구간 월 금액' 이 있다.
-- 템플릿에 단위(USER/COUNT)와 기본수량을 정해 두면, 견적 작성에서 그 단위 · 수량의 구간 금액을 바로 채운다.
-- NULL 이면 구간 없이 가격정책 기준가를 쓴다(구간형이 아닌 품목, 예전 템플릿).
-- 개발 DB(test_01)에는 2026-10-30 같은 내용을 수동 적용했다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_template_items`
  ADD COLUMN IF NOT EXISTS `band_key` varchar(10) DEFAULT NULL COMMENT '구간 단위 USER(인원) / COUNT(건수)' AFTER `qty_default`;
