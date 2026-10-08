package kr.co.sepoasoft.quote.domain.pricing;

import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockResult;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockSubtotal;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.DiscountProbe;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.FloorProbe;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.Fixture;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborError;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborRow;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteResult;

/**
 * 픽스처 20종을 Java 엔진에 넣어 산출값을 JSON 으로 덤프한다.
 *
 * <p>병행 대조({@code tools/compare-engines.js})가 이 출력을 Node 엔진 산출값과 비교한다.
 * 테스트가 아니라 도구이므로 {@code src/test} 에 두되 {@code *Test} 이름을 피해
 * surefire 가 잡지 않게 했다.
 *
 * <p>사용: {@code java -cp <test-classpath> kr.co.sepoasoft.quote.domain.pricing.FixtureDumpMain <출력경로>}
 *
 * <p>덤프 형식은 Node 쪽 생성기가 만드는 {@code expected} 와 <b>같은 구조·같은 키</b>다.
 * 그래야 대조가 필드 단위로 성립한다. 숫자는 {@code toPlainString()} 으로 낸다 —
 * 지수 표기(1.0E+8)가 섞이면 문자열 비교가 어긋난다.
 */
public final class FixtureDumpMain {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final PricingEngine ENGINE = new BlockPricingEngine();

    private FixtureDumpMain() {}

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("사용: FixtureDumpMain <출력경로.json>");
            System.exit(1);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("quote", dumpQuote());
        out.put("block", dumpBlock());
        out.put("discount", dumpDiscount());
        out.put("floor", dumpFloor());
        out.put("monthAlloc", dumpMonthAlloc());

        Path path = Path.of(args[0]);
        if (path.getParent() != null) {
            Files.createDirectories(path.getParent());
        }
        Files.writeString(path, MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(out));
        System.out.println("Java 산출값 덤프: " + path.toAbsolutePath());
    }

    private static <T> List<T> load(String file, TypeReference<List<T>> type) {
        String p = "/fixtures/engine/" + file;
        try (InputStream in = FixtureDumpMain.class.getResourceAsStream(p)) {
            if (in == null) {
                throw new IllegalStateException("픽스처를 찾을 수 없다: " + p);
            }
            return MAPPER.readValue(in, type);
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("픽스처 파싱 실패: " + p, e);
        }
    }

    /** BigDecimal 을 문자열로. 지수 표기를 피하고 뒤따르는 0 을 떼어 Node 와 형태를 맞춘다. */
    private static String s(BigDecimal v) {
        return v == null ? null : v.stripTrailingZeros().toPlainString();
    }

    private static List<Map<String, Object>> dumpQuote() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Fixture<QuoteInput, Object> f
                : load("quote-cases.json", new TypeReference<List<Fixture<QuoteInput, Object>>>() {})) {
            QuoteResult r = ENGINE.calcQuoteBlocks(f.input());
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("caseId", f.caseId());
            List<Map<String, Object>> subs = new ArrayList<>();
            for (BlockSubtotal b : r.blockSubtotals()) {
                Map<String, Object> bs = new LinkedHashMap<>();
                bs.put("block_code", b.blockCode());
                bs.put("recurring", b.recurring());
                bs.put("subtotal", s(b.subtotal()));
                subs.add(bs);
            }
            m.put("block_subtotals", subs);
            m.put("onetime_subtotal", s(r.onetimeSubtotal()));
            m.put("monthly_subtotal", s(r.monthlySubtotal()));
            m.put("discount_amount", s(r.discountAmount()));
            m.put("monthly_discount_amount", s(r.monthlyDiscountAmount()));
            m.put("round_unit", s(r.roundUnit()));
            m.put("rounding_adjustment", s(r.roundingAdjustment()));
            m.put("onetime_total", s(r.onetimeTotal()));
            m.put("monthly_total", s(r.monthlyTotal()));
            m.put("vat_amount", s(r.vatAmount()));
            m.put("monthly_vat", s(r.monthlyVat()));
            m.put("total_amount", s(r.totalAmount()));
            m.put("supply_amount", s(r.supplyAmount()));
            m.put("labor_errors", laborErrors(r.laborErrors()));
            out.add(m);
        }
        return out;
    }

    private static List<Map<String, Object>> laborErrors(List<LaborError> errs) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (LaborError e : errs) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("role_code", e.roleCode());
            m.put("mm", s(e.mm()));
            m.put("alloc_sum", s(e.allocSum()));
            m.put("message", e.message());
            out.add(m);
        }
        return out;
    }

    private static List<Map<String, Object>> dumpBlock() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Fixture<BlockInput, Object> f
                : load("block-cases.json", new TypeReference<List<Fixture<BlockInput, Object>>>() {})) {
            BlockResult r = ENGINE.calcBlock(f.input());
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("caseId", f.caseId());
            m.put("block_code", r.blockCode());
            m.put("recurring", r.recurring());
            m.put("subtotal", s(r.subtotal()));
            m.put("line_amounts", r.lineAmounts().stream().map(FixtureDumpMain::s).toList());
            m.put("mm_total", s(r.mmTotal()));
            out.add(m);
        }
        return out;
    }

    private static List<Map<String, Object>> dumpDiscount() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Fixture<List<DiscountProbe>, Object> f
                : load("discount-cases.json", new TypeReference<List<Fixture<List<DiscountProbe>, Object>>>() {})) {
            List<Map<String, Object>> rows = new ArrayList<>();
            for (DiscountProbe p : f.input()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("label", p.label());
                m.put("amount", s(ENGINE.computeDiscount(p.discount(), p.base())));
                rows.add(m);
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("caseId", f.caseId());
            m.put("rows", rows);
            out.add(m);
        }
        return out;
    }

    private static List<Map<String, Object>> dumpFloor() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Fixture<List<FloorProbe>, Object> f
                : load("floor-cases.json", new TypeReference<List<Fixture<List<FloorProbe>, Object>>>() {})) {
            List<Map<String, Object>> rows = new ArrayList<>();
            for (FloorProbe p : f.input()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("label", p.label());
                m.put("result", s(ENGINE.floorTo(p.amount(), p.unit())));
                rows.add(m);
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("caseId", f.caseId());
            m.put("rows", rows);
            out.add(m);
        }
        return out;
    }

    private static List<Map<String, Object>> dumpMonthAlloc() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Fixture<List<LaborRow>, Object> f
                : load("month-alloc-cases.json", new TypeReference<List<Fixture<List<LaborRow>, Object>>>() {})) {
            List<LaborRow> labor = f.input();
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("caseId", f.caseId());
            m.put("errors", laborErrors(ENGINE.validateMonthAlloc(labor)));
            m.put("error_count", ENGINE.validateMonthAlloc(labor).size());
            BigDecimal mmTotal = labor.stream()
                    .map(l -> l.mm() == null ? BigDecimal.ZERO : l.mm())
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            m.put("mm_total", s(mmTotal));
            Map<String, String> totals = new LinkedHashMap<>();
            ENGINE.monthlyAllocationTotals(labor).forEach((k, v) -> totals.put(k, s(v)));
            m.put("month_totals", totals);
            out.add(m);
        }
        return out;
    }
}
