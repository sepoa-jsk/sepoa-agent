# tools — 일회성 운영·점검 스크립트

레포 루트에 흩어져 있던 스크립트를 용도별로 모았다 (WBS 작업 2).
전부 `quote/.env` 의 DB 설정을 읽는다. **로직은 이관 시점 그대로이며 수정하지 않았다.**

## 실행법

레포 루트에서 실행한다. 경로는 파일 위치 기준(`__dirname`)이라 어느 폴더에서 실행해도 동작한다.

```bash
node tools/check/checkdata.js
node tools/db/seeddb.js quote/sql/010_procure_onprem_seed.sql
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
| `initdb.js` | `quote/sql/001_schema.sql` 을 적용해 초기 스키마 생성 | **주의** |
| `applyschema.js` | 인자로 받은 SQL 파일 적용 (기본 `quote/sql/020_master_schema.sql`) | **주의** |
| `seeddb.js` | 인자로 받은 SQL 파일을 다중 구문으로 적용 — `node tools/db/seeddb.js <경로>` | **주의** |
| `forceseed.js` | `quote/sql/011_procure_saas_seed.sql` 강제 재투입 | **주의** |

> 정규 마이그레이션 경로는 `quote/` 에서 `npm run migrate` 다.
> 이 폴더의 스크립트는 개발 중 부분 적용용이며, 상시 사용하지 않는다.

## tools/ops — 운영 조작

| 스크립트 | 용도 | 위험도 |
|---|---|---|
| `dbtest.js` | DB 접속 확인 (접속 정보 + 연결 성공 여부 출력) | 안전 |
| `setadmin.js` | 특정 사용자의 `sq_users.role` 을 ADMIN 으로 변경 | **주의** |
| `cleanup.js` | `sq_company_classes` 등에서 데이터 삭제 (`DELETE FROM`) | **주의** |

---

## 이관 시 변경된 것

경로만 새 위치 기준으로 고쳤다. 그 외 로직은 손대지 않았다.

| 항목 | 변경 전 | 변경 후 |
|---|---|---|
| dotenv 경로 (13개) | `{ path: './quote/.env' }` (cwd 상대) | `path.join(__dirname, '../../quote/.env')` |
| dotenv 경로 (`dbtest.js`) | `config()` — 경로 없음, 루트에 `.env` 가 없어 미로드 | 위와 동일하게 지정 |
| `verify.js` 엔진 require | `./quote/lib/quote-engine` | `../../quote/lib/quote-engine` |
| `initdb.js` 스키마 경로 | `__dirname + quote/sql/001_schema.sql` | `__dirname + ../../quote/sql/...` |
| `forceseed.js` 시드 경로 | `'./quote/sql/011_...'` (cwd 상대) | `path.join(__dirname, '../../quote/sql/...')` + `path` import 추가 |
