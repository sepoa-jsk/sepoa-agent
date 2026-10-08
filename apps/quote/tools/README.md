# tools — 운영·점검 스크립트

레포 루트에 흩어져 있던 스크립트를 용도별로 모았다 (WBS 작업 2).
전부 `quote/.env` 의 DB 설정을 읽는다. 작업 2 이관분은 **로직을 손대지 않았다**(경로만 수정).

대부분은 일회성 점검용이지만, `ops/dbdump.js` · `ops/dbverify.js` 는
**백업 정책이 의존하는 상시 도구**이며 `npm test` 로 검증된다(아래 참조).

## 실행법

레포 루트에서 실행한다. 경로는 파일 위치 기준(`__dirname`)이라 어느 폴더에서 실행해도 동작한다.

```bash
node tools/check/checkdata.js
node tools/db/seeddb.js quote/db/migrations/007_20260715_procure_onprem_seed.sql
```

## 위험도

| 표기 | 의미 |
|---|---|
| **안전** | 조회만 한다. 언제든 실행 가능 |
| **주의** | 데이터를 변경한다. **백업 후에만** 실행 (WBS §1.1 백업 정책) |

---

## tools/check — 조회·검증 (전부 안전)

| 스크립트 | 용도 | 위험도 |
|---|---|---|
| `checkcc.js` | 기업구분(`sq_company_classes`) 목록·구축형태별 분포 확인 | 안전 |
| `checkdata.js` | 마스터 테이블별 행 수 일괄 확인 | 안전 |
| `checkitems.js` | 가격품목(`sq_price_items`) 목록 확인 | 안전 |
| `checkmaster.js` | 모듈·기업구분 등 마스터 내용 덤프 | 안전 |
| `checknego.js` | 모듈 네고율(`sq_module_rates`) 확인 | 안전 (아래 주의) |
| `checkseed.js` | 시드 투입 결과 확인 (SaaS 품목 수 등) | 안전 |
| `verify.js` | 견적 엔진(`calcLine`)으로 구축형태별 단가 산출 검증 | 안전 |

> `checknego.js` 는 `conn.end()` 가 없어 출력 후 프로세스가 종료되지 않는다.
> 결과는 정상 출력되므로 확인 후 `Ctrl+C` 로 끊는다. **이관 전부터 있던 결함**이며
> 작업 20(레거시 정리)에서 처리한다.

## tools/db — 스키마·시드 투입 (전부 주의)

| 스크립트 | 용도 | 위험도 |
|---|---|---|
| `initdb.js` | `quote/db/migrations/001_20260707_schema.sql` 을 적용해 초기 스키마 생성 | **주의** |
| `applyschema.js` | 인자로 받은 SQL 파일 적용 (기본 `quote/db/migrations/009_20260715_master_schema.sql`) | **주의** |
| `seeddb.js` | 인자로 받은 SQL 파일을 다중 구문으로 적용 — `node tools/db/seeddb.js <경로>` | **주의** |
| `forceseed.js` | `quote/db/migrations/008_20260715_procure_saas_seed.sql` 강제 재투입 | **주의** |

> 정규 마이그레이션 경로는 `quote/` 에서 `npm run migrate` 다.
> 이 폴더의 스크립트는 개발 중 부분 적용용이며, 상시 사용하지 않는다.

## tools/ops — 운영 조작

| 스크립트 | 용도 | 위험도 |
|---|---|---|
| `dbtest.js` | DB 접속 확인 (접속 정보 + 연결 성공 여부 출력) | 안전 |
| `dbdump.js` | 스키마 전체 덤프 — **mysqldump 대체** | 안전 (읽기 전용) |
| `dbverify.js` | 덤프를 임시 스키마에 복원해 대조 후 임시 스키마 삭제 | 안전 (원본은 읽기만) |
| `dumpformat.js` | 덤프 파일 포맷 규칙 (모듈 — 직접 실행하지 않는다) | — |
| `setadmin.js` | 특정 사용자의 `sq_users.role` 을 ADMIN 으로 변경 | **주의** |
| `cleanup.js` | `sq_company_classes` 등에서 데이터 삭제 (`DELETE FROM`) | **주의** |

### DB 백업 — dbdump · dbverify

**이 머신에는 `mysqldump` 가 없다.** `mysqldump` · `mariadb-dump` 둘 다 미설치이고
WSL·Docker 도 없다(2026-08-02 확인). 그래서 동등 기능을 `mysql2` 로 구현했다.
WBS §1.1 백업 정책의 2~4차 백업이 이 도구에 의존하며, **4차는 작업 20 DROP 직전**이라
복원되지 않는 백업을 만들면 되돌릴 방법이 없다.

```bash
node tools/ops/dbdump.js D:/Project/_db-backup/test_01_YYYYMMDD_사유.sql
node tools/ops/dbverify.js D:/Project/_db-backup/test_01_YYYYMMDD_사유.sql
```

덤프 파일은 **레포 밖에 두고 커밋하지 않는다.**

#### mysqldump 옵션 대응

| mysqldump 옵션 | 대응 |
|---|---|
| `--single-transaction` | `START TRANSACTION WITH CONSISTENT SNAPSHOT` (단일 커넥션, REPEATABLE READ) |
| `--routines` | `SHOW CREATE PROCEDURE` / `SHOW CREATE FUNCTION` |
| `--triggers` | `SHOW CREATE TRIGGER` |
| `--default-character-set=utf8mb4` | 커넥션 `charset: 'utf8mb4'` + 파일 선두 `SET NAMES utf8mb4` |
| FK 순서 회피 | 파일 선두 `SET FOREIGN_KEY_CHECKS = 0`, 말미 `= 1` |

#### 문장 구분 규칙

값 안의 세미콜론(실제 사례: `sq_blocks.calc` = `"소계합→특별DC→십만절사; VAT별도; 일시불/월 분리"`)이
문장을 잘못 자르는 문제를 없애기 위해, 모든 문장 뒤에 센티넬 주석 한 줄을 둔다.

```sql
INSERT INTO `t` (`a`) VALUES ('세미콜론; 포함');
-- @@SQ-EOS@@
```

읽기는 **센티넬 줄로만** 자르고 세미콜론은 보지 않는다. 값의 개행은 전부 `\n` 으로
이스케이프되므로 값이 한 줄을 통째로 만들 수 없고, 따라서 센티넬과 충돌하지 않는다.
센티넬은 SQL 주석이라 진짜 `mysql` 클라이언트로 읽어도 `;` 기준으로 정상 복원된다.

규칙은 `dumpformat.js` **한 곳에만** 둔다 — 덤퍼와 복원기가 같은 모듈을 쓰지 않으면
반드시 어긋난다(실제로 어긋났었다).

#### 값 직렬화

컬럼 선언 타입(`information_schema.COLUMNS.DATA_TYPE`)별로 쓴다.

| 타입 | 처리 |
|---|---|
| `NULL` | `NULL` 리터럴 — **빈 문자열 `''` 과 구분한다**(혼동하면 복원 시 의미가 바뀐다) |
| 정수·소수·BIT | 따옴표 없이. `BIGINT` 는 `bigNumberStrings` 로 받아 정밀도 손실을 막는다 |
| `DATETIME`·`DATE`·`TIMESTAMP` | `dateStrings` 로 문자열 수신 — 타임존 이동 없음 |
| `JSON` | `JSON.stringify` 후 문자열로. 객체를 그대로 escape 하면 `k = v` 형태로 펼쳐진다 |
| `BINARY`·`BLOB` | `X'hex'` 리터럴 |
| 문자열 | 작은따옴표 · 역슬래시 · 개행 · CR · 탭 · `NUL(\0)` · `Ctrl-Z(\Z)` 이스케이프 |

#### 자체 테스트

`quote/test/ops/dbdump.test.js` (10종). 경계 사례를 담은 임시 스키마를 만들어
덤프 → 복원 → 전 컬럼 값 대조까지 확인하고 임시 스키마를 지운다.
`npm test` 에 포함된다.

---

## 이관 시 변경된 것

경로만 새 위치 기준으로 고쳤다. 그 외 로직은 손대지 않았다.

| 항목 | 변경 전 | 변경 후 |
|---|---|---|
| dotenv 경로 (13개) | `{ path: './quote/.env' }` (cwd 상대) | `path.join(__dirname, '../../quote/.env')` |
| dotenv 경로 (`dbtest.js`) | `config()` — 경로 없음, 루트에 `.env` 가 없어 미로드 | 위와 동일하게 지정 |
| `verify.js` 엔진 require | `./quote/lib/quote-engine` | `../../quote/src/domain/pricing/engine` (작업 4 재조정) |
| `initdb.js` 스키마 경로 | `__dirname + quote/sql/001_schema.sql` | `__dirname + ../../quote/db/migrations/001_...` |
| `forceseed.js` 시드 경로 | `'./quote/sql/011_...'` (cwd 상대) | `path.join(__dirname, '../../quote/db/migrations/008_...')` + `path` import 추가 |
