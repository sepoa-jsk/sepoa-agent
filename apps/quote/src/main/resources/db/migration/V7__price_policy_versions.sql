-- 가격정책 버전 이력 (2026-10-30, 사용자 요청: "버전관리가 중요하니 최종 업데이트 날짜와 버전을 추가해주고 이력을 남겨줘")
--
-- 가격정책 화면에서 저장할 때마다 그 시점의 정책 전체를 한 행으로 남긴다(지우지 않는다 — 가장 최근 행이 현재 버전).
--   solution · deployment — 어느 정책인가(지금은 SaaS 만: deployment = 'SAAS')
--   version               — 'v1.0', 'v1.1' … 솔루션 · 구축형태 안에서 겹치지 않는다
--   note                  — 무엇을 바꿨는지 한 줄
--   content               — JSON {"info": {"columns": [{code,label}], "rows": [{label, sub, values: {code: text}}]},
--                                  "services": [{code, name, unit, ranges: {USER: [[min,max,price]], COUNT: [...]}}]}
--     info     — SaaS 정책 기본정보 표(서비스구분 · 기본 제공 기능 · 사용자당 가격 · 셋업비용 · 옵션 기능 …)
--     services — 저장 시점의 서비스와 인원 · 건수 구간(실제 단가는 sq_price_items · sq_price_variants 에 있고, 여기는 그 사본)
-- 개발 DB(test_01)에는 사용자 승인 후 같은 내용을 수동 적용한다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

CREATE TABLE IF NOT EXISTS `sq_price_policy_versions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `solution` varchar(20) NOT NULL,
  `deployment` varchar(20) NOT NULL,
  `version` varchar(20) NOT NULL,
  `note` varchar(300) DEFAULT NULL,
  `content` longtext NOT NULL COMMENT '정책 전체(JSON)',
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_policy_version` (`solution`, `deployment`, `version`),
  KEY `idx_policy_latest` (`solution`, `deployment`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
