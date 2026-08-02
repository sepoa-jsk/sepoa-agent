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

> 2026-08-02 (작업 10.5) 변경. 그 전에는 이력을 남기지 않고 매 실행마다 전 파일을 다시 돌렸다.

`db/migrate.js` 는 적용 이력을 **`sq_migrations`** 에 남긴다.

| 컬럼 | 의미 |
|---|---|
| `filename` (PK) | 마이그레이션 파일명 |
| `checksum` | 파일 내용 SHA-256 (개행 정규화 후) |
| `applied_at` | 적용 시각 |
| `note` | 실행 없이 등록한 경우 그 사유 |

- 이력에 없는 파일만 적용한다. 있는 파일은 `skip`.
- 이력에 있으나 **체크섬이 다르면 경고 후 중단**한다. 자동 재적용은 하지 않는다.
- 파일 적용 전후로 그 파일이 건드리는 테이블의 행수를 로그에 남긴다.

```bash
node db/migrate.js                     # 미적용분 순차 적용
node db/migrate.js --status            # 적용/대기 현황
node db/migrate.js --dry-run           # 적용 대상만 출력
node db/migrate.js --schema <이름>     # 대상 스키마 지정 (복제본 예행 적용용)
node db/migrate.js --baseline <파일…> --note "사유"   # 실행 없이 '적용됨'으로 등록
```

**멱등 규칙은 그대로 지킨다** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
`WHERE ... IS NULL` 백필). 이력이 생겼다고 백필을 아무렇게나 써도 되는 것은 아니다 —
복원·재구축 시 파일은 처음부터 다시 돈다.

**체크섬이 있는 이유**: `006` 을 사후 수정한 전례가 있다. 적용 후 파일이 바뀌면
다른 환경과 내용이 어긋나는데, 이력만으로는 그것을 알 수 없다. 체크섬이 그 불일치를 잡는다.
의도한 수정이면 `--baseline` 으로 이력을 현재 내용에 맞춰 갱신한다.

**파일명을 바꾸면 이력이 깨진다.** 이력 키가 파일명이므로, 재번호 시에는
`sq_migrations.filename` 도 함께 갱신해야 한다. (구 러너는 이력이 없어 파일명을 자유롭게
바꿀 수 있었다. 위 대조표의 재번호가 무사했던 이유가 그것이다.)

## 해소된 결함 (2026-08-02, 작업 10.5)

`009_20260715_master_schema.sql` · `021_20260722_labor_role_mapping.sql` 이
`DELIMITER //` + `CREATE PROCEDURE` 로 컬럼 존재확인을 하고 있었다. 러너가 세미콜론으로
구문을 쪼개므로 프로시저 본문이 조각나 `ER_PARSE_ERROR(1064)` 가 났다.

009 는 22문 중 **14문이 실패**했다 — 프로시저 6조각과 `CALL _add_col` 8건 전부.
즉 "여기서 멈춰 010 이후가 안 돌았다" 는 것뿐 아니라 **009 자신의 컬럼 추가 8건도
러너로 적용된 적이 없었다**(운영 DB 에는 수동 적용된 상태였다).

둘 다 MariaDB 의 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 로 치환했다.
프로시저가 필요 없고 멱등이며, 러너의 세미콜론 분리와 충돌하지 않는다.

**새 파일에 `DELIMITER` 를 쓰지 말 것.** 러너가 처리하지 못한다.

## 실행 없이 이력에 등록한 파일 (2026-08-02)

| 파일 | 사유 |
|---|---|
| `001`~`009` | 작업 10.5 이전에 이미 적용된 상태. 재실행하면 백필이 정상 데이터를 덮어쓴다 |
| `013_20260715_company_classes_pure.sql` | `DELETE` 로 기업구분 23행을 지우고 5행만 복구한다. 그중 18행은 `003`/`007`/`008` 이 심은 행이라 이력 도입 후에는 복구되지 않는다. `PROCURE/SAAS` 7행이 사라지면 SaaS 전자구매 견적의 기업구분 선택지가 0 이 된다. 구 러너가 매번 `003`/`007`/`008` 을 재실행해 되살려 놓았기 때문에 지금까지 드러나지 않았다 |
| `015_20260715_nego_rates_seed.sql` | `solution` 컬럼에 INSERT 하는데 `017` 이 그 컬럼 없는 형태로 테이블을 재정의했다. 기존 환경에서는 `ER_BAD_FIELD_ERROR`. `018` 이 같은 20행을 재시드하므로 대체됐다 |

신규 환경에서는 이력이 비어 있으므로 `001`~`025` 가 전부 순서대로 실행된다.
그 경우 `013`·`015` 는 원래 설계대로 동작한다(누적 데이터가 없어 파괴할 것이 없다).

## 배포 점검 — 구버전 006 손상 탐지

구버전 `006_20260730_phase5c_blocks.sql` 의 백필 5 는

```sql
UPDATE sq_quotes SET onetime_total = supply_amount WHERE onetime_total = 0;
```

였다. `onetime_total = 0` 을 "아직 백필 안 됨" 으로 오판해, 특별DC 가 걸린 견적의
일시불 합계를 **할인 전 금액**으로 덮어썼다. 이력이 없어 `migrate` 를 돌릴 때마다 재발했다.

**이 시스템이 배포된 모든 환경에서 아래 쿼리를 실행할 것.**

```sql
SELECT id FROM sq_quotes WHERE onetime_total = supply_amount AND discount_amount > 0;
```

적중 행이 있으면 손상이다. `025_20260802_fix_006_onetime_damage.sql` 이 복구한다
(개발 DB `test_01` 에서 견적 `1` · `4` · `14` 3건이 적중했고 복구했다).

복구 근거는 `total_amount` 다 — 손상된 행은 VAT 포함 총액만 할인 후 금액으로 계산돼 있고
`onetime_total` 만 할인 전 값이다. `025` 는 그 일치를 `WHERE` 조건으로 확인한 행만 고치고,
만족하지 않는 행은 성격이 다르므로 손대지 않는다.
