package kr.co.sepoasoft.quote.domain.pricing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockResult;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.Discount;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.ItemRow;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborError;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborRow;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteResult;

/**
 * 계약 불변식 — <b>실측 20종이 덮지 못하는 규칙</b>을 지킨다.
 *
 * <p>J3 에서 변이 주입으로 확인한 결과, 실측 20종은 {@code isLabor} 판정 결함을
 * <b>잡지 못한다</b>. 비-LABOR 블록이 {@code labor} 를 가진 데이터가 실측·기준선
 * 어디에도 없기 때문이다 — Node 이슈 로그가 "미실행 경로였다" 고 적은 그대로다.
 * 규칙은 {@code docs/ENGINE-CONTRACT.md} 에 적혀 있으나 아무것도 강제하지 않았다.
 *
 * <p>여기 있는 것은 <b>실측 재현이 아니라 계약 검사</b>다. 실측값이 없으므로 기대값은
 * 규칙 자체에서 나온다. 20종과 섞지 않으려고 클래스를 분리했다.
 *
 * <p>각 테스트는 {@code docs/LESSONS.md} 의 항목 또는 J2 에서 확정한 계약 조항에 대응한다.
 */
@DisplayName("계약 불변식 — 실측 20종이 덮지 못하는 규칙")
class PricingContractTest {

    private final PricingEngine engine = new BlockPricingEngine();

    private static ItemRow item(String code, String qty, String proposed) {
        return new ItemRow(code, code, null, new BigDecimal(qty), null, new BigDecimal(proposed), null);
    }

    private static LaborRow labor(String role, String mm, String proposed) {
        return new LaborRow(role, role, null, new BigDecimal(mm), null, new BigDecimal(proposed), null, null);
    }

    @Nested
    @DisplayName("인건비 블록 판정 (LESSONS.md 3번)")
    class LaborDetection {

        /**
         * <b>이 테스트가 J3 변이 주입에서 유일하게 비어 있던 방어선이다.</b>
         *
         * <p>{@code isLabor} 에 {@code labor} 비어있지-않음 조건을 넣으면 실측 20종은
         * 전부 통과하지만 이 테스트는 실패한다.
         */
        @Test
        @DisplayName("비-LABOR 블록의 labor 는 금액에 들어가지 않는다 — 부록 전용")
        void nonLaborBlockIgnoresLaborRowsInMoney() {
            BlockInput setup = new BlockInput(
                    "SETUP", 0,
                    List.of(item("MODULE", "1", "1000000")),
                    // 인력투입계획 부록용 공수 배분. 금액이 아니다.
                    List.of(labor("DEV", "2", "5000000")));

            BlockResult r = engine.calcBlock(setup);

            assertThat(r.subtotal())
                    .as("items 만 금액이다. labor 를 더하면 11,000,000 이 되고 이중 계상이다")
                    .isEqualByComparingTo(new BigDecimal("1000000"));
            assertThat(r.lineAmounts()).as("라인은 items 것만").hasSize(1);
            assertThat(r.mmTotal()).as("비-LABOR 블록은 공수 합계를 내지 않는다").isNull();
        }

        @Test
        @DisplayName("labor: [] 만 붙어도 품목 블록이 인건비 블록으로 바뀌지 않는다")
        void emptyLaborArrayDoesNotFlipBlockKind() {
            BlockInput solution = new BlockInput(
                    "SOLUTION", 0,
                    List.of(item("MODULE", "1", "40000000")),
                    List.of()); // 빈 배열

            assertThat(engine.calcBlock(solution).subtotal())
                    .as("빈 labor 에 반응해 소계가 0 이 되면 안 된다")
                    .isEqualByComparingTo(new BigDecimal("40000000"));
        }

        @Test
        @DisplayName("LABOR 블록은 items 가 있어도 labor 로 계산한다")
        void laborBlockUsesLaborRows() {
            BlockInput laborBlock = new BlockInput(
                    "LABOR", 0,
                    List.of(item("STRAY", "1", "999999999")), // 들어오면 안 되는 행
                    List.of(labor("PM", "1.5", "10000000")));

            BlockResult r = engine.calcBlock(laborBlock);
            assertThat(r.subtotal()).isEqualByComparingTo(new BigDecimal("15000000"));
            assertThat(r.mmTotal()).isEqualByComparingTo(new BigDecimal("1.5"));
        }

        @Test
        @DisplayName("비-LABOR 블록의 labor 도 월별 배분 검증은 받는다 — 부록으로 인쇄되므로")
        void nonLaborBlockStillValidatesAllocation() {
            BlockInput setup = new BlockInput(
                    "SETUP", 0,
                    List.of(item("MODULE", "1", "1000000")),
                    List.of(new LaborRow("DEV", "개발", null, new BigDecimal("2"), null,
                            new BigDecimal("5000000"), null, Map.of("M1", new BigDecimal("0.5")))));

            QuoteResult r = engine.calcQuoteBlocks(
                    new QuoteInput(List.of(setup), null, null, new BigDecimal("100000")));

            assertThat(r.onetimeSubtotal()).as("금액은 items 만").isEqualByComparingTo(new BigDecimal("1000000"));
            assertThat(r.laborErrors()).as("배분 0.5 != 공수 2.0 → 오류").hasSize(1);
        }
    }

    @Nested
    @DisplayName("특별DC (LESSONS.md 1번 계열)")
    class DiscountRules {

        @Test
        @DisplayName("TARGET 의 0 은 유효한 값이다 — 무상제공. 미입력으로 오판하면 안 된다")
        void targetZeroIsValid() {
            BigDecimal d = engine.computeDiscount(
                    new Discount("TARGET", BigDecimal.ZERO), new BigDecimal("2000000"));
            assertThat(d).as("전액 할인").isEqualByComparingTo(new BigDecimal("2000000"));
        }

        @Test
        @DisplayName("value 가 null 이면 할인 없음 — 0 과 구분한다")
        void nullValueMeansNoDiscount() {
            assertThat(engine.computeDiscount(new Discount("TARGET", null), new BigDecimal("2000000")))
                    .isEqualByComparingTo(BigDecimal.ZERO);
        }

        @Test
        @DisplayName("알 수 없는 DC 유형은 조용히 0 으로 넘기지 않고 예외로 표면화한다")
        void unknownDiscountTypeThrows() {
            assertThatThrownBy(() ->
                    engine.computeDiscount(new Discount("PERCENT_OFF", BigDecimal.TEN), new BigDecimal("1000")))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("PERCENT_OFF");
        }
    }

    @Nested
    @DisplayName("음수 금액 거부 (J2 계약 §2)")
    class NegativeAmounts {

        @Test
        @DisplayName("음수 제안단가는 예외")
        void negativeProposedPriceThrows() {
            BlockInput b = new BlockInput("SOLUTION", 0, List.of(item("X", "1", "-1000")), null);
            assertThatThrownBy(() -> engine.calcBlock(b))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("제안단가");
        }

        @Test
        @DisplayName("음수 수량은 예외")
        void negativeQuantityThrows() {
            BlockInput b = new BlockInput("SOLUTION", 0, List.of(item("X", "-1", "1000")), null);
            assertThatThrownBy(() -> engine.calcBlock(b))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("수량");
        }

        @Test
        @DisplayName("음수 특별DC 는 예외 — 할인이 금액을 늘리면 안 된다")
        void negativeDiscountThrows() {
            assertThatThrownBy(() ->
                    engine.computeDiscount(new Discount("AMOUNT", new BigDecimal("-500")), new BigDecimal("1000")))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("특별DC");
        }
    }

    @Nested
    @DisplayName("월별 배분 파싱 — 조용한 실패 금지 (LESSONS.md 공통 패턴)")
    class AllocationParsing {

        @Test
        @DisplayName("깨진 JSON 은 빈 배분으로 삼키지 않고 예외로 표면화한다")
        void brokenJsonThrows() {
            List<LaborRow> labor = List.of(new LaborRow(
                    "PM", "PM", null, BigDecimal.ONE, null, null, null, "{\"M\":0.5,"));

            assertThatThrownBy(() -> engine.validateMonthAlloc(labor))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("month_alloc");
        }

        @Test
        @DisplayName("배분 없음은 검증 대상이 아니다 — 오류가 아니다")
        void absentAllocationIsNotAnError() {
            List<LaborRow> labor = List.of(
                    new LaborRow("PM", "PM", null, BigDecimal.ONE, null, null, null, null));
            assertThat(engine.validateMonthAlloc(labor)).isEmpty();
        }

        @Test
        @DisplayName("월별 합계는 여러 행을 합산한다")
        void monthlyTotalsAggregateAcrossRows() {
            List<LaborRow> labor = List.of(
                    new LaborRow("PM", "PM", null, new BigDecimal("1.0"), null, null, null,
                            Map.of("M1", new BigDecimal("0.5"), "M2", new BigDecimal("0.5"))),
                    new LaborRow("DEV", "개발", null, new BigDecimal("1.0"), null, null, null,
                            Map.of("M1", new BigDecimal("0.25"), "M2", new BigDecimal("0.75"))));

            Map<String, BigDecimal> totals = engine.monthlyAllocationTotals(labor);
            assertThat(totals.get("M1")).isEqualByComparingTo(new BigDecimal("0.75"));
            assertThat(totals.get("M2")).isEqualByComparingTo(new BigDecimal("1.25"));
            assertThat(engine.validateMonthAlloc(labor)).as("각 행의 배분 합은 공수와 일치").isEmpty();
        }
    }

    @Nested
    @DisplayName("계산 순서·절사")
    class OrderAndFloor {

        @Test
        @DisplayName("절사는 내림이다 — 반올림하면 안 된다")
        void floorIsNotRound() {
            assertThat(engine.floorTo(new BigDecimal("60099999"), new BigDecimal("100000")))
                    .as("반올림이면 60,100,000 이 된다")
                    .isEqualByComparingTo(new BigDecimal("60000000"));
        }

        @Test
        @DisplayName("월 금액은 절사하지 않는다 — 밴드가 깨진다")
        void monthlyIsNotFloored() {
            BlockInput service = new BlockInput("SERVICE", 1,
                    List.of(item("BAND", "1", "150000")), null);

            QuoteResult r = engine.calcQuoteBlocks(
                    new QuoteInput(List.of(service), null, null, new BigDecimal("100000")));

            assertThat(r.monthlyTotal())
                    .as("십만절사되면 100,000 이 되어 밴드 금액이 깨진다")
                    .isEqualByComparingTo(new BigDecimal("150000"));
        }

        @Test
        @DisplayName("일시불 DC 와 월 DC 는 각각 자기 소계에만 걸린다")
        void onetimeAndMonthlyDiscountsAreIndependent() {
            BlockInput setup = new BlockInput("SETUP", 0, List.of(item("S", "1", "1000000")), null);
            BlockInput service = new BlockInput("SERVICE", 1, List.of(item("V", "1", "300000")), null);

            QuoteResult r = engine.calcQuoteBlocks(new QuoteInput(
                    List.of(setup, service),
                    new Discount("TARGET", BigDecimal.ZERO),          // 일시불 무상
                    new Discount("TARGET", new BigDecimal("100000")), // 월 300,000 → 100,000
                    new BigDecimal("100000")));

            assertThat(r.onetimeTotal()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(r.monthlyTotal()).isEqualByComparingTo(new BigDecimal("100000"));
            assertThat(r.discountAmount()).isEqualByComparingTo(new BigDecimal("1000000"));
            assertThat(r.monthlyDiscountAmount()).isEqualByComparingTo(new BigDecimal("200000"));
        }
    }
}
