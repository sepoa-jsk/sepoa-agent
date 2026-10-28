-- 솔루션 · 구축형태에 정렬 칸 추가 (2026-10-28, 마스터 관리 화면 요청)
--
-- 다른 마스터 테이블과 같은 int(11) NOT NULL DEFAULT 0.
-- 기존 행은 지금 보이던 순서(코드 오름차순)대로 1, 2, 3… 을 넣는다.
--
-- 개발 DB(test_01)에는 2026-10-28 사용자 승인 후 같은 SQL 을 수동 적용했다.
-- Flyway 는 dev/기본 프로파일에서 꺼져 있다(application-dev.yml) — 이 파일은 새 환경용 기록이다.

ALTER TABLE `sq_solutions`   ADD COLUMN `sort` int(11) NOT NULL DEFAULT 0;
ALTER TABLE `sq_deployments` ADD COLUMN `sort` int(11) NOT NULL DEFAULT 0;

UPDATE `sq_solutions` s
  JOIN (SELECT `code`, ROW_NUMBER() OVER (ORDER BY `code`) AS n FROM `sq_solutions`) o ON o.`code` = s.`code`
   SET s.`sort` = o.n;
UPDATE `sq_deployments` d
  JOIN (SELECT `code`, ROW_NUMBER() OVER (ORDER BY `code`) AS n FROM `sq_deployments`) o ON o.`code` = d.`code`
   SET d.`sort` = o.n;
