# 실측 픽스처 — 단일 출처

Node 구현과 Java 이식본(`quote_automation`)이 **같은 파일을 읽는다.**
두 구현이 같은 입력을 공유해야 대조가 성립하므로 어느 쪽에도 값을 복사해 두지 않는다.

```
fixtures/
├─ engine/                 ★실측 재현 20종 — J3 계산 엔진 검수 기준
│  ├─ quote-cases.json         QUOTE 11 — calcQuoteBlocks 전체
│  ├─ block-cases.json         BLOCK  2 — calcBlock 단일 블록
│  ├─ discount-cases.json      DISCOUNT 1 — computeDiscount 5모드
│  ├─ floor-cases.json         FLOOR  1 — floorTo 4경계
│  └─ month-alloc-cases.json   MONTH_ALLOC 5 — validateMonthAlloc + 월별 합계
└─ deals/                  실측 딜 5건 — **J10 용. J3 DoD 아님** (현재 미작성)
```

## 손으로 편집하지 말 것

`engine/*.json` 은 생성물이다. 고치려면 생성기를 다시 돌린다.

```bash
node tools/extract-quote-fixtures.js
```

## 기대값을 어떻게 뽑았나 — 전사하지 않았다

기대값을 손으로 옮겨 적으면 오타가 기준선을 조용히 오염시키고, 그 오염을 검증할
방법이 없다. 그래서 **입력만 정의하고 기대값은 엔진을 실제로 돌려 덤프**했다.

"픽스처 == 실측값" 은 세 고리로 보증된다.

| # | 고리 | 증인 |
|---|---|---|
| ① | 엔진 출력 == 실측 견적서 값 | 추출 직전 구 `quote-block.test.js` 20/20 통과 (하드코딩 assertion) |
| ② | 픽스처 == 엔진 출력 | 생성기가 같은 엔진을 호출해 덤프 |
| ③ | 덤프 == 회귀 방어선 | 생성기의 **TRIPWIRE 6건** — `CLAUDE.md` §7 에서 가져온 독립 근거 |

③ 의 TRIPWIRE 는 테스트 파일이 아니라 **프로젝트 규칙 문서**의 값을 쓴다.
덤프가 어긋나면 생성기가 즉시 종료된다.

```
solbrain-contract.onetime_total  60,000,000
solbrain-seal.onetime_total      80,000,000
sk-pcloud.onetime_total         100,000,000
sk-pcloud.monthly_total           1,275,000
hagendazs-saas.onetime_total              0
hagendazs-saas.monthly_total        100,000
```

## 케이스 구조

```json
{
  "caseId": "solbrain-contract",
  "kind": "QUOTE",
  "description": "…",
  "source": "assets/인장/전자인장_온프레미스.pdf QT20260728_001",
  "input": { },
  "expected": { }
}
```

`kind` 로 어떤 엔진 함수를 부를지 정한다 — `QUOTE` · `BLOCK` · `DISCOUNT` · `FLOOR` · `MONTH_ALLOC`.
필드명은 Node 엔진의 snake_case 를 그대로 쓴다. Java 쪽은 Jackson 이 매핑한다.

## 읽는 쪽

| 구현 | 경로 |
|---|---|
| Node | `test/engine/quote-block.test.js` — `require` 로 직접 읽는다 |
| Java | `quote_automation` — `maven-resources-plugin` 이 빌드 시 `target/test-classes/fixtures/` 로 복사, 클래스패스로 읽는다 |

Java 쪽이 상대경로 대신 빌드 시 복사를 쓰는 이유는 `quote/` 가 J2 완료 후 삭제되기
때문이다. 삭제 시점에 이 디렉터리를 `quote_automation/src/test/resources/fixtures/` 로
옮기고 `pom.xml` 의 복사 설정만 지우면 된다. 테스트 코드는 바뀌지 않는다.

**복사본은 `target/` 안에만 생긴다**(gitignore 대상). 커밋되는 사본은 이 디렉터리 하나뿐이다.
