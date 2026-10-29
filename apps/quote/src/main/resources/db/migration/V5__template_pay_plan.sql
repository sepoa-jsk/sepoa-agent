-- 견적 템플릿 '결제 방안 포함' (2026-10-29, 사용자 승인)
--
-- SaaS · Private Cloud 견적서 하단의 '클라우드서비스 결제 방안' 표(셋업비용 계약체결 후 50% / 구축완료 후 50%,
-- 월 사용료 매월 말)를 템플릿마다 켜고 끈다. 견적서 렌더러는 견적의 template_code 로 이 값을 읽는다.
-- 실측 근거: 창성 전자구매 SaaS(2026-08-04), SK이터닉스 전자인장 Private Cloud.
-- 개발 DB(test_01)에는 2026-10-29 같은 내용을 수동 적용했다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

ALTER TABLE `sq_quote_templates`
  ADD COLUMN IF NOT EXISTS `has_pay_plan` tinyint(4) NOT NULL DEFAULT 0 COMMENT '견적서에 클라우드서비스 결제 방안 표' AFTER `has_labor_plan`;

-- 값이 아직 0 인 SaaS · Private Cloud 템플릿만 켠다(이미 끈 것을 다시 켜지 않도록 조건을 좁힌다 — 의미적 멱등은 아니므로 새 환경 첫 적용용)
UPDATE `sq_quote_templates` SET `has_pay_plan` = 1
 WHERE `deployment` IN ('SAAS', 'PCLOUD') AND `has_pay_plan` = 0
   AND `code` IN ('ESEAL_SAAS', 'ESEAL_PCLOUD', 'EPRO_SAAS', 'EXPENSE_SAAS');
