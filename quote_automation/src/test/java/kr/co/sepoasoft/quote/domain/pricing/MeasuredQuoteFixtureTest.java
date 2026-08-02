package kr.co.sepoasoft.quote.domain.pricing;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockResult;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockSubtotal;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.DiscountExpect;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.DiscountProbe;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.ExpectedBlock;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.ExpectedMonthAlloc;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.ExpectedQuote;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.FloorExpect;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.FloorProbe;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.Fixture;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborError;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborRow;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteResult;

/**
 * 실측 견적서 재현 20종 — 이식 검수 명세.
 *
 * <p>입력·기대값은 {@code quote/test/fixtures/engine/} 의 JSON 이며 <b>Node 구현과 같은
 * 파일</b>이다. maven-resources-plugin 이 빌드 시 {@code target/test-classes/fixtures/} 로
 * 복사하므로 클래스패스에서 읽는다. 사본을 커밋하지 않는다.
 *
 * <p><b>J2 시점에는 20종 전부 실패가 정상이다.</b> {@link BlockPricingEngine} 이 아직
 * 비어 있고 모든 메서드가 {@code UnsupportedOperationException} 을 던진다.
 * J3 에서 구현하면서 하나씩 초록으로 바꾼다.
 *
 * <p><b>기대값을 고쳐서 통과시키는 것은 금지한다.</b> 픽스처는 실측 견적서에서 나온
 * 값이다. 숫자가 바뀌어야 한다면 코드가 아니라 실측이 바뀐 것이므로 원본 PDF 와
 * 대조하고 확인을 받는다.
 *
 * <p>{@code BigDecimal} 비교는 반드시 {@code isEqualByComparingTo} 를 쓴다.
 * {@code equals} 는 scale 까지 비교해 {@code 3.7} 과 {@code 3.70} 을 다르게 본다.
 */
@DisplayName("실측 견적서 재현 20종 (J3 검수 기준)")
class MeasuredQuoteFixtureTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** J3 에서 실제 구현으로 바뀐다. 지금은 전부 예외를 던진다. */
    private final PricingEngine engine = new BlockPricingEngine();

    // ── 픽스처 로딩 ─────────────────────────────────────────────────

    private static <T> List<T> load(String file, TypeReference<List<T>> type) {
        String path = "/fixtures/engine/" + file;
        try (InputStream in = MeasuredQuoteFixtureTest.class.getResourceAsStream(path)) {
            if (in == null) {
                // 실패를 삼키지 않는다 — 픽스처가 없으면 테스트가 조용히 0건으로 통과한다.
                throw new IllegalStateException(
                        "픽스처를 찾을 수 없다: " + path
                        + " — pom.xml 의 copy-measured-fixtures 실행과 measured.fixtures.dir 경로를 확인할 것");
            }
            return MAPPER.readValue(in, type);
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("픽스처 파싱 실패: " + path, e);
        }
    }

    static Stream<Fixture<QuoteInput, ExpectedQuote>> quoteCases() {
        return load("quote-cases.json", new TypeReference<List<Fixture<QuoteInput, ExpectedQuote>>>() {}).stream();
    }

    static Stream<Fixture<BlockInput, ExpectedBlock>> blockCases() {
        return load("block-cases.json", new TypeReference<List<Fixture<BlockInput, ExpectedBlock>>>() {}).stream();
    }

    static Stream<Fixture<List<DiscountProbe>, List<DiscountExpect>>> discountCases() {
        return load("discount-cases.json",
                new TypeReference<List<Fixture<List<DiscountProbe>, List<DiscountExpect>>>>() {}).stream();
    }

    static Stream<Fixture<List<FloorProbe>, List<FloorExpect>>> floorCases() {
        return load("floor-cases.json",
                new TypeReference<List<Fixture<List<FloorProbe>, List<FloorExpect>>>>() {}).stream();
    }

    static Stream<Fixture<List<LaborRow>, ExpectedMonthAlloc>> monthAllocCases() {
        return load("month-alloc-cases.json",
                new TypeReference<List<Fixture<List<LaborRow>, ExpectedMonthAlloc>>>() {}).stream();
    }

    // ── QUOTE 11종 ─────────────────────────────────────────────────

    @ParameterizedTest(name = "[QUOTE] {0}")
    @MethodSource("quoteCases")
    void quote(Fixture<QuoteInput, ExpectedQuote> f) {
        QuoteResult r = engine.calcQuoteBlocks(f.input());
        ExpectedQuote e = f.expected();

        assertThat(r.blockSubtotals())
                .as("블록별 소계")
                .hasSameSizeAs(e.blockSubtotals());
        for (int i = 0; i < e.blockSubtotals().size(); i++) {
            BlockSubtotal got = r.blockSubtotals().get(i);
            BlockSubtotal want = e.blockSubtotals().get(i);
            assertThat(got.blockCode()).as("블록 %d 코드", i).isEqualTo(want.blockCode());
            assertThat(got.recurring()).as("블록 %d recurring", i).isEqualTo(want.recurring());
            assertThat(got.subtotal()).as("블록 %d 소계", i).isEqualByComparingTo(want.subtotal());
        }

        assertThat(r.onetimeSubtotal()).as("일시불 소계합").isEqualByComparingTo(e.onetimeSubtotal());
        assertThat(r.monthlySubtotal()).as("월 소계합").isEqualByComparingTo(e.monthlySubtotal());
        assertThat(r.discountAmount()).as("특별DC 금액").isEqualByComparingTo(e.discountAmount());
        assertThat(r.monthlyDiscountAmount()).as("월 특별DC 금액").isEqualByComparingTo(e.monthlyDiscountAmount());
        assertThat(r.roundUnit()).as("절사 단위").isEqualByComparingTo(e.roundUnit());
        assertThat(r.roundingAdjustment()).as("절사로 깎인 금액").isEqualByComparingTo(e.roundingAdjustment());
        assertThat(r.onetimeTotal()).as("최종 일시불 금액").isEqualByComparingTo(e.onetimeTotal());
        assertThat(r.monthlyTotal()).as("최종 월 금액").isEqualByComparingTo(e.monthlyTotal());
        assertThat(r.vatAmount()).as("VAT (일시불)").isEqualByComparingTo(e.vatAmount());
        assertThat(r.monthlyVat()).as("VAT (월)").isEqualByComparingTo(e.monthlyVat());
        assertThat(r.totalAmount()).as("VAT 포함 총액").isEqualByComparingTo(e.totalAmount());
        assertThat(r.supplyAmount()).as("공급가액").isEqualByComparingTo(e.supplyAmount());

        assertThat(r.laborErrors()).as("인력투입계획 검증 오류 건수").hasSameSizeAs(e.laborErrors());
        for (int i = 0; i < e.laborErrors().size(); i++) {
            LaborError got = r.laborErrors().get(i);
            LaborError want = e.laborErrors().get(i);
            assertThat(got.roleCode()).as("오류 %d role_code", i).isEqualTo(want.roleCode());
            assertThat(got.mm()).as("오류 %d mm", i).isEqualByComparingTo(want.mm());
            assertThat(got.allocSum()).as("오류 %d alloc_sum", i).isEqualByComparingTo(want.allocSum());
        }
    }

    // ── BLOCK 2종 ──────────────────────────────────────────────────

    @ParameterizedTest(name = "[BLOCK] {0}")
    @MethodSource("blockCases")
    void block(Fixture<BlockInput, ExpectedBlock> f) {
        BlockResult r = engine.calcBlock(f.input());
        ExpectedBlock e = f.expected();

        assertThat(r.blockCode()).as("블록 코드").isEqualTo(e.blockCode());
        assertThat(r.recurring()).as("recurring").isEqualTo(e.recurring());
        assertThat(r.subtotal()).as("블록 소계").isEqualByComparingTo(e.subtotal());

        assertThat(r.lineAmounts()).as("라인 개수").hasSameSizeAs(e.lineAmounts());
        for (int i = 0; i < e.lineAmounts().size(); i++) {
            assertThat(r.lineAmounts().get(i)).as("라인 %d 금액", i)
                    .isEqualByComparingTo(e.lineAmounts().get(i));
        }

        if (e.mmTotal() == null) {
            assertThat(r.mmTotal()).as("비-LABOR 블록은 공수 합계가 없다").isNull();
        } else {
            assertThat(r.mmTotal()).as("공수 합계").isEqualByComparingTo(e.mmTotal());
        }
    }

    // ── DISCOUNT 1종 (5모드) ───────────────────────────────────────

    @ParameterizedTest(name = "[DISCOUNT] {0}")
    @MethodSource("discountCases")
    void discount(Fixture<List<DiscountProbe>, List<DiscountExpect>> f) {
        List<DiscountProbe> probes = f.input();
        List<DiscountExpect> expects = f.expected();
        assertThat(probes).as("입력/기대 개수").hasSameSizeAs(expects);

        for (int i = 0; i < probes.size(); i++) {
            DiscountProbe p = probes.get(i);
            BigDecimal got = engine.computeDiscount(p.discount(), p.base());
            assertThat(got).as("%s", p.label()).isEqualByComparingTo(expects.get(i).amount());
        }
    }

    // ── FLOOR 1종 (4경계) ──────────────────────────────────────────

    @ParameterizedTest(name = "[FLOOR] {0}")
    @MethodSource("floorCases")
    void floor(Fixture<List<FloorProbe>, List<FloorExpect>> f) {
        List<FloorProbe> probes = f.input();
        List<FloorExpect> expects = f.expected();
        assertThat(probes).as("입력/기대 개수").hasSameSizeAs(expects);

        for (int i = 0; i < probes.size(); i++) {
            FloorProbe p = probes.get(i);
            BigDecimal got = engine.floorTo(p.amount(), p.unit());
            assertThat(got).as("%s", p.label()).isEqualByComparingTo(expects.get(i).result());
        }
    }

    // ── MONTH_ALLOC 5종 ────────────────────────────────────────────

    @ParameterizedTest(name = "[MONTH_ALLOC] {0}")
    @MethodSource("monthAllocCases")
    void monthAlloc(Fixture<List<LaborRow>, ExpectedMonthAlloc> f) {
        List<LaborRow> labor = f.input();
        ExpectedMonthAlloc e = f.expected();

        List<LaborError> errors = engine.validateMonthAlloc(labor);
        assertThat(errors).as("검증 오류 건수").hasSize(e.errorCount());
        for (int i = 0; i < e.errors().size(); i++) {
            LaborError got = errors.get(i);
            LaborError want = e.errors().get(i);
            assertThat(got.roleCode()).as("오류 %d role_code", i).isEqualTo(want.roleCode());
            assertThat(got.mm()).as("오류 %d mm", i).isEqualByComparingTo(want.mm());
            assertThat(got.allocSum()).as("오류 %d alloc_sum", i).isEqualByComparingTo(want.allocSum());
        }

        BigDecimal mmTotal = labor.stream()
                .map(l -> l.mm() == null ? BigDecimal.ZERO : l.mm())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(mmTotal).as("공수 합계").isEqualByComparingTo(e.mmTotal());

        Map<String, BigDecimal> got = engine.monthlyAllocationTotals(labor);
        assertThat(got).as("월별 배분 합계 — 키 집합").containsOnlyKeys(e.monthTotals().keySet().toArray(new String[0]));
        e.monthTotals().forEach((month, want) ->
                assertThat(got.get(month)).as("월별 합계 %s", month).isEqualByComparingTo(want));
    }
}
