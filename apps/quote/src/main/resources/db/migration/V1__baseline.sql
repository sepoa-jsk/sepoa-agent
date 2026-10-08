-- Flyway baseline — 현재 스키마 스냅샷 (sq_ 테이블만, 데이터 없음)
--
-- 생성: tools/gen-flyway-baseline.js
-- 대상 스키마: test_01   테이블 33종
--
-- db/migrations/ 25개를 재생하지 않는다. 그 경로에는 013·015 결함이 있어
-- 빈 DB 에 순서대로 적용하면 실패한다(작업 10.5). 이 파일이 그 결함을 끊는다.
--
-- AUTO_INCREMENT 시작값은 제거했다. 새 환경은 1 부터 시작한다.
-- FK 를 잠시 끄는 이유는 테이블 생성 순서에 의존하지 않기 위함이다.

SET FOREIGN_KEY_CHECKS = 0;

-- ── sq_blocks ──
DROP TABLE IF EXISTS `sq_blocks`;
CREATE TABLE `sq_blocks` (
  `code` varchar(30) NOT NULL,
  `name` varchar(100) NOT NULL,
  `columns` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`columns`)),
  `calc` varchar(255) DEFAULT NULL,
  `has_subtotal` tinyint(4) NOT NULL DEFAULT 1,
  `recurring` tinyint(4) NOT NULL DEFAULT 0,
  `optional` tinyint(4) NOT NULL DEFAULT 0,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_company_classes ──
DROP TABLE IF EXISTS `sq_company_classes`;
CREATE TABLE `sq_company_classes` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `solution` varchar(20) NOT NULL,
  `deployment` varchar(20) NOT NULL,
  `key` varchar(30) NOT NULL,
  `label` varchar(150) NOT NULL,
  `sort` int(11) NOT NULL DEFAULT 0,
  `revenue_cond` varchar(100) DEFAULT NULL COMMENT '매출조건',
  `onsite` tinyint(4) DEFAULT NULL COMMENT '1=상주 0=비상주',
  `active` tinyint(4) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_class` (`solution`,`deployment`,`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_condition_lines ──
DROP TABLE IF EXISTS `sq_condition_lines`;
CREATE TABLE `sq_condition_lines` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `set_code` varchar(30) NOT NULL,
  `line_no` int(11) NOT NULL,
  `text` varchar(500) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_set` (`set_code`),
  CONSTRAINT `fk_cond_set` FOREIGN KEY (`set_code`) REFERENCES `sq_condition_sets` (`code`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_condition_sets ──
DROP TABLE IF EXISTS `sq_condition_sets`;
CREATE TABLE `sq_condition_sets` (
  `code` varchar(30) NOT NULL,
  `name` varchar(100) NOT NULL,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_deployments ──
DROP TABLE IF EXISTS `sq_deployments`;
CREATE TABLE `sq_deployments` (
  `code` varchar(20) NOT NULL,
  `name` varchar(100) NOT NULL,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_labor_rates ──
DROP TABLE IF EXISTS `sq_labor_rates`;
CREATE TABLE `sq_labor_rates` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `solution` varchar(20) NOT NULL,
  `company_key` varchar(30) NOT NULL,
  `rate` decimal(5,3) NOT NULL,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_labor_rate` (`solution`,`company_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_labor_rate_lines ──
DROP TABLE IF EXISTS `sq_labor_rate_lines`;
CREATE TABLE `sq_labor_rate_lines` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `year_id` int(10) unsigned NOT NULL,
  `role_code` varchar(30) NOT NULL,
  `role_name` varchar(100) NOT NULL,
  `grade` varchar(40) DEFAULT NULL,
  `wage_md` bigint(20) DEFAULT NULL,
  `wage_mm` bigint(20) DEFAULT NULL,
  `overhead` bigint(20) DEFAULT NULL,
  `tech_fee` bigint(20) DEFAULT NULL,
  `apply_price` bigint(20) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_year_role` (`year_id`,`role_code`),
  CONSTRAINT `fk_labor_rate_year` FOREIGN KEY (`year_id`) REFERENCES `sq_labor_rate_years` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_labor_rate_years ──
DROP TABLE IF EXISTS `sq_labor_rate_years`;
CREATE TABLE `sq_labor_rate_years` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `year` int(11) NOT NULL,
  `source` varchar(255) DEFAULT NULL,
  `active` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_year` (`year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_labor_roles ──
DROP TABLE IF EXISTS `sq_labor_roles`;
CREATE TABLE `sq_labor_roles` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `solution` varchar(20) NOT NULL,
  `code` varchar(50) NOT NULL,
  `name` varchar(150) NOT NULL,
  `base_price` bigint(20) NOT NULL DEFAULT 0,
  `std_mm` decimal(6,2) NOT NULL DEFAULT 1.00,
  `required` tinyint(4) NOT NULL DEFAULT 0,
  `note` varchar(300) DEFAULT NULL,
  `active` tinyint(4) NOT NULL DEFAULT 1,
  `sort` int(11) NOT NULL DEFAULT 0,
  `standard_role_code` varchar(30) DEFAULT NULL COMMENT '협회직군 매핑',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_labor` (`solution`,`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_labor_standards ──
DROP TABLE IF EXISTS `sq_labor_standards`;
CREATE TABLE `sq_labor_standards` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `year` int(11) NOT NULL,
  `role_code` varchar(30) NOT NULL,
  `role_name` varchar(100) NOT NULL,
  `daily_rate` bigint(20) NOT NULL,
  `work_days` decimal(4,1) NOT NULL DEFAULT 20.5,
  `overhead_rate` decimal(4,3) NOT NULL DEFAULT 1.100,
  `tech_rate` decimal(4,3) NOT NULL DEFAULT 0.200,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq` (`year`,`role_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_maintenance_config ──
DROP TABLE IF EXISTS `sq_maintenance_config`;
CREATE TABLE `sq_maintenance_config` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(30) NOT NULL,
  `name` varchar(150) NOT NULL,
  `calc_type` varchar(20) NOT NULL,
  `rate` decimal(5,3) DEFAULT NULL,
  `md_price` bigint(20) DEFAULT NULL,
  `md_per_mm` int(11) DEFAULT NULL,
  `tco_years` int(11) DEFAULT NULL,
  `free_months` int(11) DEFAULT NULL,
  `note` varchar(300) DEFAULT NULL,
  `active` tinyint(4) NOT NULL DEFAULT 1,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_migrations ──
DROP TABLE IF EXISTS `sq_migrations`;
CREATE TABLE `sq_migrations` (
  `filename` varchar(190) NOT NULL,
  `checksum` char(64) NOT NULL,
  `applied_at` datetime NOT NULL DEFAULT current_timestamp(),
  `note` varchar(255) DEFAULT NULL COMMENT '실행 없이 등록한 경우 그 사유',
  PRIMARY KEY (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_modules ──
DROP TABLE IF EXISTS `sq_modules`;
CREATE TABLE `sq_modules` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `solution` varchar(20) NOT NULL,
  `code` varchar(50) NOT NULL,
  `name` varchar(150) NOT NULL,
  `base_price` bigint(20) NOT NULL DEFAULT 0,
  `required` tinyint(4) NOT NULL DEFAULT 0,
  `note` varchar(300) DEFAULT NULL,
  `active` tinyint(4) NOT NULL DEFAULT 1,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_module` (`solution`,`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_nego_rates ──
DROP TABLE IF EXISTS `sq_nego_rates`;
CREATE TABLE `sq_nego_rates` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `target` varchar(20) NOT NULL,
  `company_key` varchar(30) NOT NULL,
  `onsite_key` varchar(20) NOT NULL,
  `rate` decimal(5,3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq` (`target`,`company_key`,`onsite_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_onsite_types ──
DROP TABLE IF EXISTS `sq_onsite_types`;
CREATE TABLE `sq_onsite_types` (
  `code` varchar(20) NOT NULL,
  `name` varchar(50) NOT NULL,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_price_items ──
DROP TABLE IF EXISTS `sq_price_items`;
CREATE TABLE `sq_price_items` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `solution` varchar(20) NOT NULL,
  `deployment` varchar(20) NOT NULL,
  `category` varchar(50) DEFAULT NULL,
  `code` varchar(50) NOT NULL,
  `name` varchar(150) NOT NULL,
  `spec` varchar(300) DEFAULT NULL,
  `pricing_type` enum('DISCOUNT','BAND','FIXED','MM') NOT NULL,
  `base_price` bigint(20) NOT NULL DEFAULT 0,
  `unit` varchar(20) DEFAULT NULL,
  `qty_default` decimal(6,2) NOT NULL DEFAULT 1.00,
  `required` tinyint(4) NOT NULL DEFAULT 0,
  `recurring` tinyint(4) NOT NULL DEFAULT 0,
  `note` varchar(300) DEFAULT NULL,
  `active` tinyint(4) NOT NULL DEFAULT 1,
  `sort` int(11) NOT NULL DEFAULT 0,
  `block` varchar(20) DEFAULT NULL COMMENT 'SOLUTION/LABOR/THIRDPARTY/SAAS_SERVICE/SAAS_ETC',
  `module_code` varchar(50) DEFAULT NULL,
  `labor_role_code` varchar(50) DEFAULT NULL,
  `thirdparty_code` varchar(50) DEFAULT NULL,
  `service_type` varchar(30) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_item_code` (`code`),
  KEY `idx_item_sol_dep` (`solution`,`deployment`,`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_price_variants ──
DROP TABLE IF EXISTS `sq_price_variants`;
CREATE TABLE `sq_price_variants` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `item_id` int(10) unsigned NOT NULL,
  `key` varchar(30) DEFAULT NULL,
  `label` varchar(150) DEFAULT NULL,
  `min_qty` decimal(12,2) DEFAULT NULL,
  `max_qty` decimal(12,2) DEFAULT NULL,
  `rate` decimal(5,3) DEFAULT NULL,
  `price` bigint(20) DEFAULT NULL,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_variant_item` (`item_id`),
  CONSTRAINT `fk_variant_item` FOREIGN KEY (`item_id`) REFERENCES `sq_price_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_quotes ──
DROP TABLE IF EXISTS `sq_quotes`;
CREATE TABLE `sq_quotes` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `quote_no` varchar(20) NOT NULL,
  `quote_type` varchar(10) NOT NULL DEFAULT 'BUILD',
  `deployment` varchar(20) DEFAULT NULL,
  `template_code` varchar(40) DEFAULT NULL,
  `quote_date` date NOT NULL,
  `valid_until` date DEFAULT NULL,
  `customer_name` varchar(150) DEFAULT NULL,
  `customer_contact` varchar(150) DEFAULT NULL,
  `discount_type` enum('AMOUNT','RATE','TARGET') DEFAULT NULL,
  `discount_value` decimal(12,2) NOT NULL DEFAULT 0.00,
  `round_unit` int(11) NOT NULL DEFAULT 100000,
  `monthly_discount_type` enum('AMOUNT','RATE','TARGET') DEFAULT NULL,
  `monthly_discount_value` bigint(20) NOT NULL DEFAULT 0,
  `supply_amount` bigint(20) NOT NULL DEFAULT 0,
  `discount_amount` bigint(20) NOT NULL DEFAULT 0,
  `vat_amount` bigint(20) NOT NULL DEFAULT 0,
  `total_amount` bigint(20) NOT NULL DEFAULT 0,
  `onetime_total` bigint(20) NOT NULL DEFAULT 0,
  `monthly_total` bigint(20) NOT NULL DEFAULT 0,
  `status` enum('DRAFT','SENT','WON','LOST') NOT NULL DEFAULT 'DRAFT',
  `memo` text DEFAULT NULL,
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `conditions` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quote_no` (`quote_no`),
  KEY `idx_quote_status` (`status`),
  KEY `idx_quote_customer` (`customer_name`),
  KEY `fk_quote_user` (`created_by`),
  CONSTRAINT `fk_quote_user` FOREIGN KEY (`created_by`) REFERENCES `sq_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_quote_blocks ──
DROP TABLE IF EXISTS `sq_quote_blocks`;
CREATE TABLE `sq_quote_blocks` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `quote_id` int(10) unsigned NOT NULL,
  `section_id` int(10) unsigned DEFAULT NULL,
  `block_code` varchar(30) NOT NULL,
  `title` varchar(120) DEFAULT NULL,
  `subtotal` bigint(20) NOT NULL DEFAULT 0,
  `recurring` tinyint(4) NOT NULL DEFAULT 0,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_quote` (`quote_id`),
  KEY `idx_section` (`section_id`),
  CONSTRAINT `fk_qb_quote` FOREIGN KEY (`quote_id`) REFERENCES `sq_quotes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_quote_items ──
DROP TABLE IF EXISTS `sq_quote_items`;
CREATE TABLE `sq_quote_items` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `section_id` int(10) unsigned NOT NULL,
  `block_id` int(10) unsigned DEFAULT NULL,
  `item_code` varchar(50) DEFAULT NULL,
  `category` varchar(50) DEFAULT NULL,
  `block_code` varchar(30) DEFAULT NULL,
  `name` varchar(150) NOT NULL,
  `spec` varchar(300) DEFAULT NULL,
  `qty` decimal(8,2) NOT NULL DEFAULT 1.00,
  `unit` varchar(20) DEFAULT NULL,
  `months` int(11) NOT NULL DEFAULT 1,
  `unit_price` bigint(20) NOT NULL DEFAULT 0,
  `base_price` bigint(20) DEFAULT NULL,
  `proposed_price` bigint(20) DEFAULT NULL,
  `amount` bigint(20) NOT NULL DEFAULT 0,
  `note` varchar(300) DEFAULT NULL,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_qitem_section` (`section_id`),
  KEY `idx_block` (`block_id`),
  CONSTRAINT `fk_qitem_section` FOREIGN KEY (`section_id`) REFERENCES `sq_quote_sections` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_quote_labor ──
DROP TABLE IF EXISTS `sq_quote_labor`;
CREATE TABLE `sq_quote_labor` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `section_id` int(10) unsigned NOT NULL,
  `block_id` int(10) unsigned DEFAULT NULL,
  `role_code` varchar(30) NOT NULL,
  `role_name` varchar(100) DEFAULT NULL,
  `role_label` varchar(120) DEFAULT NULL,
  `grade` varchar(40) DEFAULT NULL,
  `task` varchar(255) DEFAULT NULL,
  `mm` decimal(6,2) NOT NULL DEFAULT 0.00,
  `base_price` bigint(20) DEFAULT NULL,
  `proposed_price` bigint(20) DEFAULT NULL,
  `amount` bigint(20) NOT NULL DEFAULT 0,
  `month_alloc` text DEFAULT NULL,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_section` (`section_id`),
  KEY `idx_block` (`block_id`),
  CONSTRAINT `fk_ql_section` FOREIGN KEY (`section_id`) REFERENCES `sq_quote_sections` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_quote_sections ──
DROP TABLE IF EXISTS `sq_quote_sections`;
CREATE TABLE `sq_quote_sections` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `quote_id` int(10) unsigned NOT NULL,
  `solution` varchar(20) NOT NULL,
  `template_code` varchar(40) DEFAULT NULL,
  `brand` varchar(60) DEFAULT NULL,
  `deployment` varchar(20) NOT NULL,
  `company_class` varchar(30) DEFAULT NULL,
  `contract_months` int(11) NOT NULL DEFAULT 1,
  `params` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`params`)),
  `subtotal` bigint(20) NOT NULL DEFAULT 0,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_section_quote` (`quote_id`),
  CONSTRAINT `fk_section_quote` FOREIGN KEY (`quote_id`) REFERENCES `sq_quotes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_quote_seq ──
DROP TABLE IF EXISTS `sq_quote_seq`;
CREATE TABLE `sq_quote_seq` (
  `seq_date` date NOT NULL,
  `last_no` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`seq_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_quote_templates ──
DROP TABLE IF EXISTS `sq_quote_templates`;
CREATE TABLE `sq_quote_templates` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `quote_type` varchar(10) NOT NULL DEFAULT 'BUILD',
  `solution` varchar(30) NOT NULL,
  `code` varchar(40) NOT NULL,
  `name` varchar(120) NOT NULL,
  `deployment` varchar(20) NOT NULL,
  `brand` varchar(60) DEFAULT NULL,
  `include_maintenance` tinyint(4) NOT NULL DEFAULT 0,
  `include_component` tinyint(4) NOT NULL DEFAULT 0,
  `condition_set` varchar(30) DEFAULT NULL,
  `has_labor_plan` tinyint(4) NOT NULL DEFAULT 0,
  `active` tinyint(4) NOT NULL DEFAULT 1,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_code` (`code`),
  KEY `idx_solution` (`solution`),
  KEY `fk_tpl_cond` (`condition_set`),
  KEY `idx_type_solution` (`quote_type`,`solution`),
  CONSTRAINT `fk_tpl_cond` FOREIGN KEY (`condition_set`) REFERENCES `sq_condition_sets` (`code`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_service_types ──
DROP TABLE IF EXISTS `sq_service_types`;
CREATE TABLE `sq_service_types` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `solution` varchar(20) NOT NULL,
  `code` varchar(30) NOT NULL,
  `name` varchar(150) NOT NULL,
  `user_unit` int(11) NOT NULL DEFAULT 1,
  `min_price` bigint(20) NOT NULL DEFAULT 0,
  `note` varchar(300) DEFAULT NULL,
  `active` tinyint(4) NOT NULL DEFAULT 1,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_service` (`solution`,`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_sessions ──
DROP TABLE IF EXISTS `sq_sessions`;
CREATE TABLE `sq_sessions` (
  `session_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` int(11) unsigned NOT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- ── sq_settings ──
DROP TABLE IF EXISTS `sq_settings`;
CREATE TABLE `sq_settings` (
  `key` varchar(50) NOT NULL,
  `value` text DEFAULT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_solutions ──
DROP TABLE IF EXISTS `sq_solutions`;
CREATE TABLE `sq_solutions` (
  `code` varchar(20) NOT NULL,
  `name` varchar(100) NOT NULL,
  `source` varchar(150) DEFAULT NULL,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_template_blocks ──
DROP TABLE IF EXISTS `sq_template_blocks`;
CREATE TABLE `sq_template_blocks` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `template_id` int(10) unsigned NOT NULL,
  `block_code` varchar(30) NOT NULL,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tpl` (`template_id`),
  KEY `fk_tb_block` (`block_code`),
  CONSTRAINT `fk_tb_block` FOREIGN KEY (`block_code`) REFERENCES `sq_blocks` (`code`),
  CONSTRAINT `fk_tb_tpl` FOREIGN KEY (`template_id`) REFERENCES `sq_quote_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_template_items ──
DROP TABLE IF EXISTS `sq_template_items`;
CREATE TABLE `sq_template_items` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `template_id` int(10) unsigned NOT NULL,
  `block_code` varchar(30) NOT NULL,
  `item_code` varchar(60) NOT NULL,
  `qty_default` decimal(10,2) NOT NULL DEFAULT 1.00,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tpl` (`template_id`),
  CONSTRAINT `fk_ti_tpl` FOREIGN KEY (`template_id`) REFERENCES `sq_quote_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_template_labor ──
DROP TABLE IF EXISTS `sq_template_labor`;
CREATE TABLE `sq_template_labor` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `template_id` int(10) unsigned NOT NULL,
  `block_code` varchar(30) NOT NULL DEFAULT 'LABOR',
  `role_code` varchar(30) NOT NULL,
  `role_label` varchar(120) DEFAULT NULL,
  `grade` varchar(40) DEFAULT NULL,
  `task` varchar(255) DEFAULT NULL,
  `mm_default` decimal(6,2) NOT NULL DEFAULT 0.00,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tpl` (`template_id`),
  CONSTRAINT `fk_tl_tpl` FOREIGN KEY (`template_id`) REFERENCES `sq_quote_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_thirdparty ──
DROP TABLE IF EXISTS `sq_thirdparty`;
CREATE TABLE `sq_thirdparty` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `solution` varchar(20) NOT NULL,
  `code` varchar(50) NOT NULL,
  `name` varchar(150) NOT NULL,
  `base_price` bigint(20) NOT NULL DEFAULT 0,
  `list_price` bigint(20) DEFAULT NULL,
  `note` varchar(300) DEFAULT NULL,
  `active` tinyint(4) NOT NULL DEFAULT 1,
  `sort` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_thirdparty` (`solution`,`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sq_users ──
DROP TABLE IF EXISTS `sq_users`;
CREATE TABLE `sq_users` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(150) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `picture` varchar(500) DEFAULT NULL,
  `role` enum('ADMIN','USER') NOT NULL DEFAULT 'USER',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_login_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
