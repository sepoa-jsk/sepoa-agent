# 세포아 견적서 자동생성 시스템 (quote)

세포아소프트 SingleSuite 3개 솔루션(경비관리·전자구매·전자인장)의 가격정책을 DB로 관리하고,
웹에서 조건 선택만으로 견적을 자동 계산·저장·Excel 출력하는 사내 시스템.

- 스택: Node.js + Express + MariaDB(mysql2, Prisma 미사용) + 순수 ES-module 프론트(빌드 도구 없음)
- 인증: Google SSO(+ 개발용 dev 로그인) / DB 세션 / 역할(ADMIN·USER)
- 포트: **3100** (sepoa-aidlc-pms와 충돌 방지). 테이블 접두어 **`sq_`**

---

## 1. 빠른 시작 (로컬)

```bash
npm install
cp .env.example .env          # DB 접속정보 입력 (아래 2절)
npm run migrate               # sq_ 스키마 생성
npm run seed                  # 가격정책 시드 투입 (재실행 시 skip, 강제: npm run seed -- --force)
npm start                     # http://localhost:3100
npm test                      # 계산 엔진/서비스/Excel 단위 테스트 (24건)
```

개발 모드(`AUTH_MODE=dev`)에서는 Google 없이 이메일만으로 로그인됩니다.
관리자 권한이 필요하면 `.env`의 `ADMIN_EMAILS`에 본인 이메일을 넣고 최초 로그인하세요.

---

## 2. 환경변수 (.env)

| 키 | 설명 | 예시/기본 |
|---|---|---|
| `PORT` | 서버 포트 | `3100` |
| `NODE_ENV` | 실행 환경 | `development` / `production` |
| `COOKIE_SECURE` | HTTPS 배포 시 `true`. **HTTP 사내배포면 false 유지** (아니면 로그인 쿠키 저장 안 됨) | `false` |
| `TRUST_PROXY` | nginx 등 프록시 뒤면 `true` | `false` |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | MariaDB 접속정보 (aidlc-pms와 동일 인스턴스) | |
| `DB_CONNECTION_LIMIT` | 커넥션 풀 크기 | `10` |
| `AUTH_MODE` | `dev`(개발용 로그인 허용) / `google` | `dev` |
| `SESSION_SECRET` | 세션 서명 키 (운영 시 반드시 변경) | |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID | |
| `ALLOWED_EMAIL_DOMAINS` | 로그인 허용 도메인(쉼표) | `sepoasoft.co.kr` |
| `ADMIN_EMAILS` | 최초 로그인 시 ADMIN 부여 이메일(쉼표) | |
| `API_KEY` | 타시스템 연계용 X-API-Key 값 | |

> `.env`는 커밋 금지(.gitignore 처리됨). 값은 배포 담당자가 서버에서 직접 채웁니다.

---

## 3. Linux 배포 (pm2)

```bash
# 서버에서
git pull                      # 또는 배포 아티팩트 업로드
npm ci --omit=dev             # 운영 의존성만 설치
vi .env                       # 접속정보/시크릿 입력 (COOKIE_SECURE는 HTTPS면 true)
npm run migrate && npm run seed

pm2 start ecosystem.config.js --env production
pm2 save                      # 부팅 시 자동 기동 등록 (pm2 startup 최초 1회)
pm2 logs sepoa-quote
```

nginx 리버스 프록시 예시 (사내 URL → 3100):

```nginx
location / {
  proxy_pass http://127.0.0.1:3100;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $remote_addr;
}
```
프록시 사용 시 `.env`에 `TRUST_PROXY=true`, HTTPS면 `COOKIE_SECURE=true`.

Google SSO 사용 시 Google Cloud Console → 승인된 JavaScript 원본에
`http://localhost:3100` 과 사내 배포 URL을 등록하고 `GOOGLE_CLIENT_ID` 설정.

---

## 4. 가격 계산 로직 (도메인 핵심)

| pricing_type | 계산 |
|---|---|
| `DISCOUNT` | 기업구분(variant.key)별 확정 단가 |
| `BAND` | 수량이 속하는 구간 단가 = **월액(수량 곱하지 않음)** |
| `FIXED` | 기준가(base_price) × 수량 |
| `MM` | 월단가 × 기업구분 적용율(rate) × 수량(M/M) |

- `recurring=1` 항목은 계약개월(months)을 곱한다.
- variant.price가 `NULL`이면 **별도협의** → 자동계산 불가, 단가 수기 입력.
- VAT 10%. **합계 = (공급가액 − 할인) × 1.1**
- 할인은 금액(`AMOUNT`)/비율(`RATE`) 모두 지원.
- 견적 저장 시 품목은 **단가 스냅샷**으로 보존 → 이후 가격정책 변경과 무관하게 과거 견적 불변.

구현: [lib/quote-engine.js](lib/quote-engine.js), 공유 계산 서비스 [lib/quote-service.js](lib/quote-service.js).

---

## 5. REST API

인증: 브라우저는 **세션 쿠키**, 타시스템 연계는 **`X-API-Key` 헤더**(`/api/quotes/calculate`).
권한: `(ADMIN)` 표시는 관리자 전용.

### 인증
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/auth/google` | Google ID token 검증 → 세션 발급(auto-provision). body `{ credential }` |
| POST | `/api/auth/dev-login` | 개발용 로그인(AUTH_MODE=dev 전용). body `{ email, name? }` |
| POST | `/api/auth/logout` | 로그아웃 |
| GET | `/api/auth/me` | 현재 사용자 |

### 마스터 / 가격정책
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/master` | 솔루션·배포형태·기업구분 |
| GET | `/api/pricing?solution=&deployment=&all=` | 항목+variants (`all=1`이면 중지항목 포함) |
| POST | `/api/pricing/items` (ADMIN) | 항목 생성 (+variants) |
| PUT | `/api/pricing/items/:id` (ADMIN) | 항목 수정 (+variants 교체) |
| PUT | `/api/pricing/items/:id/variants` (ADMIN) | variants 일괄 교체 |
| DELETE | `/api/pricing/items/:id` (ADMIN) | soft delete(active=0) |

### 견적
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/quotes/calculate` | 조건→계산(저장 안 함). **세션 또는 X-API-Key** |
| POST | `/api/quotes` | 생성(채번+저장, 섹션/품목 포함) |
| GET | `/api/quotes?status=&customer=&page=&size=` | 목록 |
| GET | `/api/quotes/:id` | 상세(섹션/품목 중첩) |
| PUT | `/api/quotes/:id` | 수정(섹션 전체 교체+재계산, quote_no 유지) |
| PATCH | `/api/quotes/:id/status` | 상태 변경 `{ status }` (DRAFT/SENT/WON/LOST) |
| DELETE | `/api/quotes/:id` | 삭제 |
| GET | `/api/quotes/:id/excel` | Excel 다운로드(.xlsx) |

### 설정
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/settings` | 공급자 정보 등 key-value |
| PUT | `/api/settings` (ADMIN) | `{ settings: { key: value } }` 일괄 upsert |

### 계산/생성 요청 예시

```jsonc
// POST /api/quotes/calculate  (또는 /api/quotes 로 저장)
{
  "customer_name": "현대오토에버(주)",
  "discount": { "type": "AMOUNT", "value": 500000 },   // 또는 { "type":"RATE","value":10 }
  "sections": [
    {
      "solution": "ESEAL", "deployment": "ONPREM",
      "companyClass": "ENT", "months": 1,
      "items": [
        { "code": "POA_SEAL", "qty": 1 },
        { "code": "POA_ECONTRACT", "qty": 1, "unit_price": 22000000 }  // 별도협의 단가 수기
      ]
    }
  ]
}
```

### 타시스템 연계 (X-API-Key)

```bash
curl -X POST https://<host>/api/quotes/calculate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"sections":[{"solution":"ESEAL","deployment":"SAAS","months":12,"items":[{"code":"ESEAL_SAAS","qty":200}]}]}'
```

응답에는 섹션별 `subtotal`, 라인별 `unit_price`/`amount`/`need_negotiation`,
그리고 `supply_amount`/`discount_amount`/`vat_amount`/`total_amount`가 포함됩니다.

---

## 6. 견적번호 채번

`S + YYYYMMDD + 3자리 시퀀스` (예: `S20260707001`).
견적일자 기준 일자별 시퀀스, `sq_quote_seq` 행 잠금 + 트랜잭션으로 중복 방지.
구현: [lib/numbering.js](lib/numbering.js).

---

## 7. 디렉토리 구조

```
quote/
├─ server.js                 # Express 부트스트랩
├─ ecosystem.config.js       # pm2
├─ sql/                      # 001_schema.sql, migrate.js
├─ seed/                     # pricing-seed.json(원본), seed.js
├─ lib/                      # db, auth, quote-engine, quote-service, numbering, excel
├─ routes/                   # auth, pricing, quotes, settings
├─ public/                   # 프론트(SPA): index.html, css/, js/(+views)
├─ assets/                   # seal.png (인감)
└─ test/                     # 단위 테스트
```

---

## 8. 참고 / 주의

- 이모지 미사용(사내 표준). 상태는 컬러 뱃지.
- 엑셀 비고란 예외("6개社 이상 5만원/社 추가" 등)는 항목 `note`로 노출, 수기 조정 허용.
- 전자인장은 2026 신규안 기준 시드.
- Excel 견적서: 섹션 소계 + 전체 합계, 공급자 정보는 `sq_settings` 참조(하드코딩 없음), 대표자명 위 인감 오버레이.
