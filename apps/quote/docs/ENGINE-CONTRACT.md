# 계산 엔진 계약 — 시그니처와 반올림 정책 (J2 확정, J3 구현)

Node `quote/src/domain/pricing/engine.js` 를 Java 로 옮기기 위한 계약이다.
**J2 에서 인터페이스만 정하고 구현은 J3 에서 한다.**

---

## 1. 계산 순서 — 고정이며 바꾸지 않는다

```
블록 소계 합  →  특별DC  →  절사(십만단위)  →  VAT 별도
```

- **일시불 / 월(recurring) 을 분리**해 산출한다.
- **월 금액은 절사하지 않는다.** 밴드 금액이 깨진다(150,000 → 십만절사 시 100,000).
- 특별DC 는 일시불과 월에 **각각 별도로** 걸 수 있다.
- 순서를 바꾸면 값이 달라진다. 픽스처 `calc-order-fixed` 가 이것을 잡는다
  (98,765,432 − 1,234,567 = 97,530,865 → 절사 → **97,500,000**).

---

## 2. 반올림 정책 — **`BigDecimal` + `RoundingMode.HALF_UP`, scale 0**

### 결정

| 지점 | 연산 | 정책 |
|---|---|---|
| 라인 금액 | `제안단가 × (mm\|qty)` | `HALF_UP`, scale 0 |
| RATE 할인 | `base × value / 100` | `HALF_UP`, scale 0 |
| AMOUNT 할인 | `value` | `HALF_UP`, scale 0 |
| VAT | `총액 × 0.1` | `HALF_UP`, scale 0 |
| 절사 | `floor(amount / unit) × unit` | **`FLOOR`** — 반올림이 아니다 |
| 공수(MM)·월별 배분 | 합산·비교 | 반올림하지 않는다. scale 2 로 비교 |

### 왜 이것이 위험한 지점인가

**십만단위 절사가 있어 1원 차이가 최종 금액에 드러난다.**
`60,099,999` 과 `60,100,000` 은 절사 후 `60,000,000` 과 `60,100,000` 으로 **10만원** 벌어진다.
라인 금액에서 1원이 틀리면 그 차이가 그대로 최종 견적가를 바꾼다.

### JS 와 갈리는 지점 — 음수 반값

Node 는 `Math.round` 를 쓰는데 이것은 **+∞ 방향 half-up** 이다.

| 값 | JS `Math.round` | Java `HALF_UP` | 일치 |
|---:|---:|---:|:---:|
| `2.5` | `3` | `3` | O |
| `0.5` | `1` | `1` | O |
| `-2.5` | **`-2`** | **`-3`** | **X** |
| `-3.5` | **`-3`** | **`-4`** | **X** |

**양수에서는 완전히 일치하고, 음수 반값에서만 갈린다.**

이 도메인에서 음수 금액은 계약 위반이다 — 단가·수량·공수·할인액 모두 0 이상이다.
따라서 `HALF_UP` 을 쓰되, **음수 입력을 검증에서 막는다.** JS 동작을 흉내내려고
`HALF_CEILING` 을 손으로 구현하지 않는다. Java 에 그 모드가 없는 데는 이유가 있고,
음수를 정상 입력으로 인정하는 순간 "할인이 금액을 늘리는" 견적이 가능해진다.

> J12 검증 엔진에 **음수 금액 거부 규칙**을 넣을 것. 그 전까지는 엔진이 `IllegalArgumentException` 을 던진다.

### 부동소수 → BigDecimal 전환

Node 는 IEEE 754 double 로 계산한다. 픽스처는 그 결과를 덤프한 것이므로,
JS 에 부동소수 오차가 있었다면 그 오차까지 픽스처에 굳어 있을 수 있다.

**실측 20종에 대해 확인한 결과 오차 0 이다.**

| 연산 | JS 결과 | 정확값과의 차이 |
|---|---|---|
| `12,000,000 × 3.7` | `44,400,000` | `0` |
| `5,000,000 × 0.4` | `2,000,000` | `0` |
| `10,500,000 × 0.2` | `2,100,000` | `0` |
| 공수 합 `1.00+1.50+1.00+0.20` | `3.7` | 정확 |
| 배분 합 `0.25+0.50+0.25+0.20` | `1.2` | 정확 |

즉 **BigDecimal 로 바꿔도 20종의 기대값은 변하지 않는다.** 단가가 정수이고 공수가
소수 2자리라 곱이 정수로 떨어지기 때문이다. 앞으로 단가에 소수가 들어오면 이 전제가
깨지므로, 그때는 픽스처를 다시 뽑는 것이 아니라 **실측 견적서와 대조**해야 한다.

### BigDecimal 비교 주의

`BigDecimal.equals()` 는 **scale 까지 비교한다.** `3.7` 과 `3.70` 은 `equals` 로 다르다.
테스트는 반드시 `compareTo` 기반으로 비교한다 — AssertJ 의 `isEqualByComparingTo`.

---

## 3. 시그니처

패키지 `kr.co.sepoasoft.quote.domain.pricing`.
입력·출력은 `record` 로 두어 불변으로 만든다.

```java
public interface PricingEngine {

    /** 견적 전체 계산. 계산 순서 §1 을 따른다. */
    QuoteResult calcQuoteBlocks(QuoteInput input);

    /** 블록 1개의 라인별 금액과 소계. */
    BlockResult calcBlock(BlockInput block);

    /** 특별DC — AMOUNT(할인액) / RATE(%) / TARGET(최종 목표금액). */
    BigDecimal computeDiscount(Discount discount, BigDecimal base);

    /** 절사 — unit 단위 내림. unit 이 0 이하면 절사하지 않는다. */
    BigDecimal floorTo(BigDecimal amount, BigDecimal unit);

    /** 인력투입계획 검증 — Σ month_alloc = mm (허용오차 0.001). */
    List<LaborError> validateMonthAlloc(List<LaborRow> labor);

    /** 인력투입계획 부록의 월별 합계행. 표시용 집계다. */
    Map<String, BigDecimal> monthlyAllocationTotals(List<LaborRow> labor);
}
```

### 대응표

| Node | Java |
|---|---|
| `calcQuoteBlocks(body)` | `calcQuoteBlocks(QuoteInput)` |
| `calcBlock(block)` | `calcBlock(BlockInput)` |
| `computeDiscount(discount, base)` | `computeDiscount(Discount, BigDecimal)` |
| `floorTo(amount, unit)` | `floorTo(BigDecimal, BigDecimal)` |
| `validateMonthAlloc(labor)` | `validateMonthAlloc(List<LaborRow>)` |
| *(테스트 쪽 헬퍼였음)* | `monthlyAllocationTotals(List<LaborRow>)` |

`monthlyAllocationTotals` 는 Node 에서 테스트 안의 헬퍼였다. 인력투입계획 부록(J7)의
합계행에 실제로 필요하므로 엔진 계약으로 승격했다.

`resolveUnitPrice` · `calcLine` · `calcTotals`(구 4모델 경로)는 이식 대상이 아니다.
J10 의 GRADE·RATE·MD 모델이 그 자리를 대체한다.

---

## 4. 블록 판정 규칙 — 옮길 때 반드시 지킬 것

```java
boolean isLabor = "LABOR".equals(block.blockCode());
```

**컬렉션의 존재·크기로 판정하지 않는다.** Node 에 `Array.isArray(block.labor)` 를
판정에 넣었다가 `labor: []` 만 붙어도 품목 블록이 인건비 블록으로 오인돼 소계가 0 이
되는 결함이 있었다(`docs/LESSONS.md` 3번).

**비-LABOR 블록의 `labor` 는 인력투입계획 부록 전용이며 금액에 관여하지 않는다.**
PCloud 셋업이 `3.7MM × 12,000,000`(모듈 단가) = 44,400,000 인데, 같은 3.7MM 을 인건비
단가로 한 번 더 곱하면 이중 계상이 된다.

> 프론트엔드(`public/js/`)가 그대로 이관되므로 위저드의 클라이언트 계산
> (`recalcBlocks`)과 **판정이 일치해야 한다.** 갈라지면 미리보기와 PDF 금액이 어긋난다.

---

## 5. 특별DC 규칙

| type | 계산 | 주의 |
|---|---|---|
| `AMOUNT` | `value` | 할인액 그대로 |
| `RATE` | `base × value / 100` | `HALF_UP` |
| `TARGET` | `max(0, base − value)` | **`value = 0` 은 유효하다** — 하겐다즈 "무상제공" |
| (없음/`null`) | `0` | |

**`TARGET` 의 `0` 을 "미입력" 으로 처리하면 안 된다.** 미입력(`null`/빈 문자열)만 걸러낸다.
같은 오판이 마이그레이션 `006` 에서 실제 데이터 손상을 냈다(`docs/LESSONS.md` 1번).

목표가가 소계보다 크면 할인은 `0` 이다(음수 할인 금지).

---

## 6. 검수 기준

`quote/test/fixtures/engine/` 의 **20종 전부 통과**가 J3 DoD 다.
하나라도 실패하면 진행을 멈춘다.

픽스처는 실측 견적서에서 나온 값이다. **테스트를 통과시키려고 기대값을 고치는 것은 금지한다.**
숫자가 바뀌어야 한다면 코드가 아니라 실측이 바뀐 것이므로, 원본 PDF와 대조하고 확인을 받는다.

실측 딜 5건(`fixtures/deals/`)은 **J10 검수용이며 J3 DoD 가 아니다.**
