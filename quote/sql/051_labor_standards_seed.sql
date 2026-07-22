-- 051_labor_standards_seed.sql
-- SW협회 노임단가 시드 (2025/2026). work_days/overhead_rate/tech_rate 는 기본값.
SET NAMES utf8mb4;
INSERT INTO sq_labor_standards (year,role_code,role_name,daily_rate,sort) VALUES
(2026,'CONSULTANT','IT 컨설턴트',522340,1),
(2026,'IT_PM','IT PM',492039,2),
(2026,'DEV','응용소프트웨어 개발자',378250,3),
(2026,'UIUX','UI/UX 개발자',336666,4),
(2026,'QAO','IT 품질관리자',538638,5),
(2026,'ARCHITECT','IT 아키텍트',541621,6),
(2026,'OPERATOR','정보시스템 운용자',519469,7),
(2025,'CONSULTANT','IT 컨설턴트',471166,1),
(2025,'IT_PM','IT PM',443955,2),
(2025,'DEV','응용소프트웨어 개발자',337061,3),
(2025,'UIUX','UI/UX 개발자',326566,4),
(2025,'QAO','IT 품질관리자',470490,5),
(2025,'ARCHITECT','IT 아키텍트',492609,6),
(2025,'OPERATOR','정보시스템 운용자',492943,7)
ON DUPLICATE KEY UPDATE daily_rate=VALUES(daily_rate), role_name=VALUES(role_name);
