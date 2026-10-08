package kr.co.sepoasoft.quote.domain.pricing;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 계산 엔진의 입출력 타입. 전부 불변 record 다.
 *
 * <p>필드명은 픽스처 JSON(= Node 엔진의 snake_case)에 맞춰 {@code @JsonProperty} 로 매핑한다.
 * 픽스처는 Node 와 Java 가 공유하는 단일 출처이므로 어느 쪽에 맞출지 정해야 했고,
 * 이미 존재하는 Node 쪽 이름을 유지하는 편이 픽스처를 손대지 않아 안전하다.
 *
 * <p>금액은 전부 {@link BigDecimal} 이다. 십만단위 절사가 있어 1원 차이가 최종 금액에
 * 그대로 드러나므로 double 을 쓰지 않는다. 반올림 정책은 {@code docs/ENGINE-CONTRACT.md} §2.
 */
public final class PricingModels {

    private PricingModels() {}

    // ── 입력 ────────────────────────────────────────────────────────

    /** 특별DC. {@code TARGET} 의 value 0 은 유효하다(무상제공). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Discount(String type, BigDecimal value) {}

    /** 품목 라인. LABOR 이 아닌 블록이 쓴다. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ItemRow(
            @JsonProperty("item_code") String itemCode,
            String name,
            String category,
            BigDecimal qty,
            @JsonProperty("base_price") BigDecimal basePrice,
            @JsonProperty("proposed_price") BigDecimal proposedPrice,
            /** 스냅샷 재조회 시 이미 계산된 금액. 있으면 그 값을 신뢰한다. */
            BigDecimal amount) {}

    /**
     * 인건비 라인.
     *
     * <p>{@code monthAlloc} 은 DB 에 JSON 문자열로 저장돼 있을 수 있어 {@link Object} 로 받는다
     * ({@code Map} 또는 {@code String}). 파싱은 엔진이 한다.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record LaborRow(
            @JsonProperty("role_code") String roleCode,
            @JsonProperty("role_label") String roleLabel,
            String task,
            BigDecimal mm,
            @JsonProperty("base_price") BigDecimal basePrice,
            @JsonProperty("proposed_price") BigDecimal proposedPrice,
            BigDecimal amount,
            @JsonProperty("month_alloc") Object monthAlloc) {}

    /**
     * 블록 1개.
     *
     * <p><b>인건비 블록 판정은 {@code "LABOR".equals(blockCode)} 하나로 한다.</b>
     * {@code labor} 컬렉션의 존재·크기로 판정하지 않는다 — 빈 배열에 반응해 품목 블록이
     * 인건비 블록으로 오인되는 결함이 Node 에 있었다(docs/LESSONS.md 3번).
     * 비-LABOR 블록의 {@code labor} 는 인력투입계획 부록 전용이며 금액에 관여하지 않는다.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record BlockInput(
            @JsonProperty("block_code") String blockCode,
            Integer recurring,
            List<ItemRow> items,
            List<LaborRow> labor) {

        public boolean isLabor() {
            return "LABOR".equals(blockCode);
        }

        public boolean isRecurring() {
            return recurring != null && recurring != 0;
        }
    }

    /** 견적 전체 입력. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record QuoteInput(
            List<BlockInput> blocks,
            Discount discount,
            @JsonProperty("monthly_discount") Discount monthlyDiscount,
            @JsonProperty("round_unit") BigDecimal roundUnit) {}

    // ── 출력 ────────────────────────────────────────────────────────

    /** 블록별 소계 — 픽스처 {@code expected.block_subtotals} 와 대조한다. */
    public record BlockSubtotal(
            @JsonProperty("block_code") String blockCode,
            Integer recurring,
            BigDecimal subtotal) {}

    /** {@code calcBlock} 결과. */
    public record BlockResult(
            String blockCode,
            int recurring,
            BigDecimal subtotal,
            /** 라인별 금액. 입력 순서를 그대로 유지한다. */
            List<BigDecimal> lineAmounts,
            /** LABOR 블록의 공수 합계. 그 외 블록은 null. */
            BigDecimal mmTotal) {}

    /** 인력투입계획 검증 오류. */
    public record LaborError(
            @JsonProperty("role_code") String roleCode,
            BigDecimal mm,
            @JsonProperty("alloc_sum") BigDecimal allocSum,
            String message) {}

    /** {@code calcQuoteBlocks} 결과. 픽스처 {@code expected} 와 1:1 대응한다. */
    public record QuoteResult(
            List<BlockSubtotal> blockSubtotals,
            BigDecimal onetimeSubtotal,
            BigDecimal monthlySubtotal,
            BigDecimal discountAmount,
            BigDecimal monthlyDiscountAmount,
            BigDecimal roundUnit,
            /** 절사로 깎인 금액. */
            BigDecimal roundingAdjustment,
            BigDecimal onetimeTotal,
            BigDecimal monthlyTotal,
            BigDecimal vatAmount,
            BigDecimal monthlyVat,
            /** 일시불 기준 VAT 포함 총액. */
            BigDecimal totalAmount,
            /** 하위호환 — 공급가액 = 일시불 소계합. */
            BigDecimal supplyAmount,
            List<LaborError> laborErrors) {}

    /** 픽스처 파일 1건. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Fixture<I, E>(
            @JsonProperty("caseId") String caseId,
            String kind,
            String description,
            String source,
            I input,
            E expected) {

        @Override
        public String toString() {
            // JUnit 파라미터화 테스트의 표시 이름으로 쓰인다.
            return caseId + " — " + description;
        }
    }

    /** 픽스처 {@code expected} — QUOTE 종. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ExpectedQuote(
            @JsonProperty("block_subtotals") List<BlockSubtotal> blockSubtotals,
            @JsonProperty("onetime_subtotal") BigDecimal onetimeSubtotal,
            @JsonProperty("monthly_subtotal") BigDecimal monthlySubtotal,
            @JsonProperty("discount_amount") BigDecimal discountAmount,
            @JsonProperty("monthly_discount_amount") BigDecimal monthlyDiscountAmount,
            @JsonProperty("round_unit") BigDecimal roundUnit,
            @JsonProperty("rounding_adjustment") BigDecimal roundingAdjustment,
            @JsonProperty("onetime_total") BigDecimal onetimeTotal,
            @JsonProperty("monthly_total") BigDecimal monthlyTotal,
            @JsonProperty("vat_amount") BigDecimal vatAmount,
            @JsonProperty("monthly_vat") BigDecimal monthlyVat,
            @JsonProperty("total_amount") BigDecimal totalAmount,
            @JsonProperty("supply_amount") BigDecimal supplyAmount,
            @JsonProperty("labor_errors") List<LaborError> laborErrors) {}

    /** 픽스처 {@code expected} — BLOCK 종. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ExpectedBlock(
            @JsonProperty("block_code") String blockCode,
            Integer recurring,
            BigDecimal subtotal,
            @JsonProperty("line_amounts") List<BigDecimal> lineAmounts,
            @JsonProperty("mm_total") BigDecimal mmTotal) {}

    /** 픽스처 {@code input} 한 줄 — DISCOUNT 종. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record DiscountProbe(String label, Discount discount, BigDecimal base) {}

    /** 픽스처 {@code expected} 한 줄 — DISCOUNT 종. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record DiscountExpect(String label, BigDecimal amount) {}

    /** 픽스처 {@code input} 한 줄 — FLOOR 종. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record FloorProbe(String label, BigDecimal amount, BigDecimal unit) {}

    /** 픽스처 {@code expected} 한 줄 — FLOOR 종. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record FloorExpect(String label, BigDecimal result) {}

    /** 픽스처 {@code expected} — MONTH_ALLOC 종. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ExpectedMonthAlloc(
            List<LaborError> errors,
            @JsonProperty("error_count") int errorCount,
            @JsonProperty("mm_total") BigDecimal mmTotal,
            @JsonProperty("month_totals") Map<String, BigDecimal> monthTotals) {}
}
