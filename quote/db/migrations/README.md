# 마이그레이션 — 번호 재부여 대조표

> 2026-08-01 (WBS 작업 3). 파일명 규칙: `NNN_YYYYMMDD_설명.sql`
> **NNN 이 실행 순서를 정한다.** 날짜는 최초 커밋일이며 정보용이다.

## 왜 바꿨나

- 번호가 중복돼 실행 순서가 파일명 사전순에 의존했다 — `002` 2건, `042` 2건
- 재부여 시 **기존 실행 순서를 그대로 보존**했다. 순서 변경 없음.

## 대조표

| 순서 | 구번호 | 신번호 |
|---:|---|---|
| 1 | `001_schema.sql` | `001_20260707_schema.sql` |
| 2 | `002_phase5.sql` | `002_20260730_phase5.sql` |
| 3 | `002_seed.sql` | `003_20260715_seed.sql` |
| 4 | `003_phase5_templates.sql` | `004_20260730_phase5_templates.sql` |
| 5 | `004_phase5_quote.sql` | `005_20260730_phase5_quote.sql` |
| 6 | `005_phase5c_blocks.sql` | `006_20260730_phase5c_blocks.sql` |
| 7 | `010_procure_onprem_seed.sql` | `007_20260715_procure_onprem_seed.sql` |
| 8 | `011_procure_saas_seed.sql` | `008_20260715_procure_saas_seed.sql` |
| 9 | `020_master_schema.sql` | `009_20260715_master_schema.sql` |
| 10 | `021_procure_master_seed.sql` | `010_20260715_procure_master_seed.sql` |
| 11 | `022_procure_items_link.sql` | `011_20260715_procure_items_link.sql` |
| 12 | `030_onsite_master.sql` | `012_20260715_onsite_master.sql` |
| 13 | `031_company_classes_pure.sql` | `013_20260715_company_classes_pure.sql` |
| 14 | `040_nego_rates.sql` | `014_20260715_nego_rates.sql` |
| 15 | `041_nego_rates_seed.sql` | `015_20260715_nego_rates_seed.sql` |
| 16 | `042_drop_old_nego.sql` | `016_20260722_drop_old_nego.sql` |
| 17 | `042_nego_rates_no_solution.sql` | `017_20260722_nego_rates_no_solution.sql` |
| 18 | `043_nego_rates_seed.sql` | `018_20260722_nego_rates_seed.sql` |
| 19 | `050_labor_standards.sql` | `019_20260722_labor_standards.sql` |
| 20 | `051_labor_standards_seed.sql` | `020_20260722_labor_standards_seed.sql` |
| 21 | `052_labor_role_mapping.sql` | `021_20260722_labor_role_mapping.sql` |
| 22 | `053_maintenance.sql` | `022_20260722_maintenance.sql` |
| 23 | `054_quote_item_base.sql` | `023_20260722_quote_item_base.sql` |
| 24 | `055_quote_conditions.sql` | `024_20260722_quote_conditions.sql` |

중복이던 번호:

| 구번호 | 파일 | 신번호 |
|---|---|---|
| `002` | `002_phase5.sql` | `002_20260730_phase5.sql` |
| `002` | `002_seed.sql` | `003_20260715_seed.sql` |
| `042` | `042_drop_old_nego.sql` | `016_20260722_drop_old_nego.sql` |
| `042` | `042_nego_rates_no_solution.sql` | `017_20260722_nego_rates_no_solution.sql` |

## 러너 동작 (중요)

`db/migrate.js` 는 **적용 이력을 기록하지 않는다.** 실행할 때마다 전 파일을 다시 돌린다.
따라서 모든 구문이 멱등이어야 한다 — `CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, `WHERE ... IS NULL` 백필 등. 새 파일도 같은 규칙을 지킬 것.

파일명을 바꿔도 적용 이력이 깨지지 않는 이유가 이것이다(추적하는 이력 자체가 없다).

## 알려진 결함

`009_20260715_master_schema.sql` 은 `DELIMITER //` 구문 때문에 러너에서 실패한다.
러너가 세미콜론으로 구문을 쪼개기 때문이다. **여기서 멈추므로 010 이후 파일은 실행되지 않는다.**
해당 테이블은 이미 DB 에 존재해 현재는 무해하나, **신규 환경 배포 시 걸린다.**
이관 전부터 있던 문제이며 작업 20(레거시 정리)에서 처리한다.
