-- 네고율: 구분(모듈/인력) 없이 상주구분 × 기업구분마다 네고율 하나 (2026-10-28, 마스터 관리 화면 요청)
--
-- 행은 지우지 않는다. 견적 작성 화면이 target(MODULE/LABOR)별로 네고율을 찾으므로 두 행을 그대로 두고
-- 값만 같게 맞춘다 — 인력(LABOR) 값을 같은 상주구분·기업구분의 모듈(MODULE) 값으로(사용자 승인).
-- 화면은 두 행을 한 줄로 보여주고, 저장하면 두 행에 같은 값을 쓴다.
--
-- 정렬(sort)은 상주 → 비상주, 그 안에서 기업구분 마스터의 정렬 순. 같은 줄의 두 행은 같은 값.
-- 개발 DB(test_01)에는 2026-10-28 사용자 승인 후 같은 내용을 수동 적용했다(scratchpad/nego_merge.js).
-- Flyway 는 dev/기본 프로파일에서 꺼져 있다 — 이 파일은 새 환경용 기록이다.

ALTER TABLE `sq_nego_rates` ADD COLUMN `sort` int(11) NOT NULL DEFAULT 0;

UPDATE `sq_nego_rates` l
  JOIN `sq_nego_rates` m
    ON m.`target` = 'MODULE' AND m.`onsite_key` = l.`onsite_key` AND m.`company_key` = l.`company_key`
   SET l.`rate` = m.`rate`
 WHERE l.`target` = 'LABOR';

UPDATE `sq_nego_rates` n
  JOIN (SELECT `key`, ROW_NUMBER() OVER (ORDER BY `sort`) AS k,
               COUNT(*) OVER () AS cnt
          FROM `sq_company_classes`
         WHERE `solution` = 'PROCURE' AND `deployment` = 'ONPREM' AND `active` = 1) c
    ON c.`key` = n.`company_key`
   SET n.`sort` = CASE n.`onsite_key` WHEN 'ONSITE' THEN 0 ELSE 1 END * c.cnt + c.k;
