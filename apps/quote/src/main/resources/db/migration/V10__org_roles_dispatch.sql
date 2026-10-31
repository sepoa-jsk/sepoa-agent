-- 조직 · 역할·권한 · 사용자 칸 · 메일 발송 이력 (2026-10-31, 사용자 요청: "미구현 화면 구현 — 물어보지 말고 전체 진행")
--
-- 1) sq_depts        조직(부서). 상위 부서는 parent_code 로 잇는다(없으면 최상위). 지우지 않고 active=0(사용 중지).
-- 2) sq_roles        업무 역할(영업담당 · 영업팀장 …). sq_users.role(ADMIN/USER)은 그대로 '관리자 여부'로 둔다.
-- 3) sq_role_menus   역할별 메뉴 권한. perms = 'R' 조회 · 'C' 등록 · 'U' 수정 · 'D' 삭제 를 붙여 쓴다(예: 'RCU').
--                    menu 는 화면 메뉴 키(layout/sidebar.js 의 nav). 관리자(ADMIN)는 권한표와 상관없이 모든 메뉴.
-- 4) sq_users        dept_code(부서) · position(직위) · role_code(업무 역할) · active(사용 여부 — 0 이면 로그인 불가) 칸 추가.
-- 5) sq_quote_dispatch  견적 메일 발송 이력 — 보낼 때마다 한 행(성공 · 실패 · 시험 발송 모두). 열람 추적은 아직 없다.
-- 개발 DB(test_01)에는 같은 내용을 수동 적용한다. Flyway 는 dev/기본 프로파일에서 꺼져 있다.

CREATE TABLE IF NOT EXISTS `sq_depts` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(30) NOT NULL,
  `name` varchar(100) NOT NULL,
  `parent_code` varchar(30) DEFAULT NULL,
  `note` varchar(300) DEFAULT NULL,
  `sort` int(11) NOT NULL DEFAULT 0,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dept_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sq_roles` (
  `code` varchar(30) NOT NULL,
  `name` varchar(100) NOT NULL,
  `note` varchar(300) DEFAULT NULL,
  `sort` int(11) NOT NULL DEFAULT 0,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sq_role_menus` (
  `role_code` varchar(30) NOT NULL,
  `menu` varchar(30) NOT NULL,
  `perms` varchar(10) NOT NULL DEFAULT '',
  PRIMARY KEY (`role_code`, `menu`),
  CONSTRAINT `fk_role_menu_role` FOREIGN KEY (`role_code`) REFERENCES `sq_roles` (`code`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `sq_users`
  ADD COLUMN IF NOT EXISTS `dept_code` varchar(30) DEFAULT NULL COMMENT '부서(sq_depts.code)' AFTER `role`,
  ADD COLUMN IF NOT EXISTS `position` varchar(50) DEFAULT NULL COMMENT '직위' AFTER `dept_code`,
  ADD COLUMN IF NOT EXISTS `role_code` varchar(30) DEFAULT NULL COMMENT '업무 역할(sq_roles.code)' AFTER `position`,
  ADD COLUMN IF NOT EXISTS `active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '0 이면 로그인 불가' AFTER `role_code`;

CREATE TABLE IF NOT EXISTS `sq_quote_dispatch` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `quote_id` int(10) unsigned DEFAULT NULL,
  `quote_no` varchar(20) DEFAULT NULL,
  `customer_name` varchar(150) DEFAULT NULL,
  `to_addrs` varchar(1000) NOT NULL,
  `cc_addrs` varchar(1000) DEFAULT NULL,
  `subject` varchar(300) DEFAULT NULL,
  `files` varchar(100) DEFAULT NULL COMMENT '붙인 파일 종류(PDF, Excel)',
  `result` enum('SENT','FAILED','DRY_RUN') NOT NULL,
  `error` varchar(500) DEFAULT NULL,
  `sent_by` int(10) unsigned DEFAULT NULL,
  `sent_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_dispatch_quote` (`quote_id`),
  KEY `idx_dispatch_sent` (`sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 기본 역할(화면 시안 기준) — 이미 있으면 건드리지 않는다
INSERT IGNORE INTO `sq_roles` (`code`, `name`, `note`, `sort`) VALUES
  ('SALES', '영업담당', '견적 작성 · 발송', 1),
  ('SALES_LEAD', '영업팀장', '영업담당 + 기준정보 조회', 2),
  ('EXEC', '임원', '조회 중심', 3),
  ('PLAN', '기획', '견적 작성 · 기준정보 조회', 4),
  ('VIEWER', '조회전용', '견적 조회만', 5);

INSERT IGNORE INTO `sq_role_menus` (`role_code`, `menu`, `perms`) VALUES
  ('SALES', 'quotes', 'RCUD'), ('SALES', 'new', 'RCU'), ('SALES', 'dispatch', 'R'), ('SALES', 'tco', 'RC'),
  ('SALES_LEAD', 'quotes', 'RCUD'), ('SALES_LEAD', 'new', 'RCU'), ('SALES_LEAD', 'dispatch', 'R'), ('SALES_LEAD', 'tco', 'RC'),
  ('SALES_LEAD', 'pricing', 'R'), ('SALES_LEAD', 'risk', 'R'),
  ('EXEC', 'quotes', 'R'), ('EXEC', 'new', 'R'), ('EXEC', 'dispatch', 'R'), ('EXEC', 'tco', 'R'), ('EXEC', 'pricing', 'R'),
  ('PLAN', 'quotes', 'RCUD'), ('PLAN', 'new', 'RCU'), ('PLAN', 'dispatch', 'R'), ('PLAN', 'tco', 'RC'),
  ('PLAN', 'pricing', 'R'), ('PLAN', 'risk', 'R'), ('PLAN', 'term', 'R'),
  ('VIEWER', 'quotes', 'R');
