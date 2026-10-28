package kr.co.sepoasoft.quote.web;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import kr.co.sepoasoft.quote.domain.pricing.PricingEngine;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.Discount;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.ItemRow;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborError;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborRow;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteResult;
import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * 요청 JSON 을 계산해 Node 응답 모양으로 돌려준다 — 계산(#24)·미리보기(#25)·저장(#26)·수정(#29)이 함께 쓴다.
 *
 * <p><b>블록형 금액은 J3 엔진({@link PricingEngine})이 낸다.</b> 여기서는 요청 값을 Node {@code num()} 규칙으로
 * 읽어 엔진 입력으로 바꾸고, 결과를 Node {@code calcQuoteBlocks} 응답(입력 블록을 되돌려 주며 라인마다 금액을 채운 것)으로
 * 다시 감싼다. 레거시 섹션 스냅샷({@link #snapshotCalc})은 엔진을 거치지 않는 Node 경로라 JS 실수 연산을 그대로 따른다.
 *
 * <p>Node 와 다르게 답하는 곳은 명세 3장 H.
 */
@Component
public class QuoteCalc {

    static final double DEFAULT_ROUND_UNIT = 100000;

    private final PricingEngine engine;

    public QuoteCalc(PricingEngine engine) {
        this.engine = engine;
    }

    // ── 블록형 — Node engine.js calcQuoteBlocks ──────────────────────

    /** {@code rawRoundUnit} 은 요청 값 그대로 — Node: {@code body.round_unit ?? 100000} 을 {@code num()} */
    public Map<String, Object> calcBlocks(List<?> rawBlocks, Object rawDiscount, Object rawMonthly, Object rawRoundUnit) {
        double roundUnit = rawRoundUnit == null ? DEFAULT_ROUND_UNIT : num(rawRoundUnit);
        List<BlockInput> inputs = new ArrayList<>();
        for (Object o : rawBlocks) inputs.add(toBlockInput(asMap(o)));
        QuoteResult r;
        List<List<BigDecimal>> lineAmounts = new ArrayList<>();
        try {
            r = engine.calcQuoteBlocks(new QuoteInput(inputs, toDiscount(rawDiscount), toDiscount(rawMonthly), dec(roundUnit)));
            for (BlockInput in : inputs) lineAmounts.add(engine.calcBlock(in).lineAmounts());
        } catch (IllegalArgumentException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_INPUT", e.getMessage());
        }

        // 입력 블록을 되돌려 주며 금액 라인·소계·recurring 을 덮어쓴다 — Node {...block, items|labor: lines, subtotal, recurring}
        List<Map<String, Object>> outBlocks = new ArrayList<>();
        for (int i = 0; i < rawBlocks.size(); i++) {
            Map<String, Object> block = asMap(rawBlocks.get(i));
            boolean isLabor = "LABOR".equals(block.get("block_code"));
            String rowsKey = isLabor ? "labor" : "items";
            List<BigDecimal> amounts = lineAmounts.get(i);
            List<Map<String, Object>> lines = new ArrayList<>();
            List<?> rows = block.get(rowsKey) instanceof List<?> l ? l : List.of();
            for (int k = 0; k < rows.size(); k++) {
                Map<String, Object> row = new LinkedHashMap<>(asMap(rows.get(k)));
                row.put("proposed_price", Js.json(num(row.get("proposed_price"))));
                if (isLabor) row.put("mm", Js.json(num(row.get("mm"))));
                else row.put("qty", row.get("qty") == null ? (Object) 1 : Js.json(num(row.get("qty"))));
                row.put("amount", Js.json(amounts.get(k)));
                lines.add(row);
            }
            Map<String, Object> out = new LinkedHashMap<>(block);
            out.put(rowsKey, lines);
            out.put("subtotal", Js.json(r.blockSubtotals().get(i).subtotal()));
            out.put("recurring", truthy(block.get("recurring")));
            outBlocks.add(out);
        }

        Map<String, Object> d = asMap(rawDiscount), md = asMap(rawMonthly);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("blocks", outBlocks);
        out.put("onetime_subtotal", Js.json(r.onetimeSubtotal()));
        out.put("monthly_subtotal", Js.json(r.monthlySubtotal()));
        out.put("discount_type", or(d.get("type"), null));
        out.put("discount_value", Js.json(num(d.get("value"))));
        out.put("discount_amount", Js.json(r.discountAmount()));
        out.put("monthly_discount_type", or(md.get("type"), null));
        out.put("monthly_discount_value", Js.json(num(md.get("value"))));
        out.put("monthly_discount_amount", Js.json(r.monthlyDiscountAmount()));
        out.put("round_unit", Js.json(roundUnit));
        out.put("rounding_adjustment", Js.json(r.roundingAdjustment()));
        out.put("onetime_total", Js.json(r.onetimeTotal()));
        out.put("monthly_total", Js.json(r.monthlyTotal()));
        out.put("vat_amount", Js.json(r.vatAmount()));
        out.put("monthly_vat", Js.json(r.monthlyVat()));
        out.put("total_amount", Js.json(r.totalAmount()));
        out.put("supply_amount", Js.json(r.supplyAmount()));
        List<Map<String, Object>> errors = new ArrayList<>();
        for (LaborError e : r.laborErrors()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("role_code", e.roleCode());
            m.put("mm", Js.json(e.mm()));
            m.put("alloc_sum", Js.json(e.allocSum()));
            m.put("message", e.message());
            errors.add(m);
        }
        out.put("labor_errors", errors);
        return out;
    }

    /** 요청 블록 → 엔진 입력. 값은 Node {@code num()} 으로 읽는다. */
    private static BlockInput toBlockInput(Map<String, Object> b) {
        List<ItemRow> items = new ArrayList<>();
        if (b.get("items") instanceof List<?> l) {
            for (Object o : l) {
                Map<String, Object> r = asMap(o);
                items.add(new ItemRow(str(r.get("item_code")), str(r.get("name")), str(r.get("category")),
                        r.get("qty") == null ? null : dec(num(r.get("qty"))),
                        null, dec(num(r.get("proposed_price"))),
                        r.get("amount") == null ? null : dec(Js.round(num(r.get("amount"))))));
            }
        }
        List<LaborRow> labor = new ArrayList<>();
        if (b.get("labor") instanceof List<?> l) {
            for (Object o : l) {
                Map<String, Object> r = asMap(o);
                Object alloc = r.get("month_alloc");
                labor.add(new LaborRow(str(r.get("role_code")),
                        truthy(r.get("role_label")) ? str(r.get("role_label")) : null,
                        str(r.get("task")), dec(num(r.get("mm"))), null, dec(num(r.get("proposed_price"))),
                        r.get("amount") == null ? null : dec(Js.round(num(r.get("amount")))),
                        truthy(alloc) ? alloc : null));
            }
        }
        return new BlockInput(str(b.get("block_code")), truthy(b.get("recurring")) ? 1 : 0, items, labor);
    }

    /** Node: {@code type || null} 이면 할인 없음, {@code value} 가 null·'' 이면 0 */
    private static Discount toDiscount(Object raw) {
        Map<String, Object> d = asMap(raw);
        Object type = d.get("type");
        if (!truthy(type)) return null;
        Object v = d.get("value");
        return new Discount(String.valueOf(type), v == null || "".equals(v) ? null : dec(num(v)));
    }

    // ── 레거시 섹션형(블록 스냅샷) — Node quotes.js snapshotCalc ──────
    // JS 실수 연산을 그대로 따른다. 특별DC 는 service.js computeDiscountAmount (TARGET 도 AMOUNT 로 본다).

    /** Node {@code isBlockMode} — 섹션에 labor 배열이 있거나 품목에 block_code 가 있으면 스냅샷 경로 */
    public static boolean isBlockMode(List<?> sections) {
        for (Object o : sections) {
            Map<String, Object> s = asMap(o);
            if (s.get("labor") instanceof List<?>) return true;
            if (s.get("items") instanceof List<?> items) {
                for (Object i : items) if (truthy(asMap(i).get("block_code"))) return true;
            }
        }
        return false;
    }

    /** Node {@code calcFor} — 스냅샷이 아니면 구 가격정책 4모델 경로(이식 대상 아님, J10 대체)라 501 */
    public Map<String, Object> calcSections(List<?> sections, Object rawDiscount) {
        if (!isBlockMode(sections)) {
            throw new ApiException(HttpStatus.NOT_IMPLEMENTED, "NOT_IMPLEMENTED",
                    "구 가격정책(4모델) 섹션 계산은 Java 로 옮기지 않습니다. blocks 로 보내 주세요.");
        }
        return snapshotCalc(sections, rawDiscount);
    }

    Map<String, Object> snapshotCalc(List<?> rawSections, Object rawDiscount) {
        List<Map<String, Object>> sections = new ArrayList<>();
        double supply = 0;
        for (Object o : rawSections) {
            Map<String, Object> sec = asMap(o);
            List<Map<String, Object>> items = new ArrayList<>();
            double subtotal = 0;
            if (sec.get("items") instanceof List<?> l) {
                for (Object x : l) {
                    Map<String, Object> it = new LinkedHashMap<>(asMap(x));
                    Object p = it.get("proposed_price") != null ? it.get("proposed_price") : it.get("unit_price");
                    double proposed = Js.toNumber(p);
                    double amount = it.get("amount") != null ? Js.round(Js.toNumber(it.get("amount")))
                            : Js.round(proposed * Js.or(jsNumber(it, "qty"), 1));
                    it.put("proposed_price", Js.json(proposed));
                    it.put("amount", Js.json(amount));
                    subtotal += Js.or(amount, 0);
                    items.add(it);
                }
            }
            List<Map<String, Object>> labor = new ArrayList<>();
            if (sec.get("labor") instanceof List<?> l) {
                for (Object x : l) {
                    Map<String, Object> lr = new LinkedHashMap<>(asMap(x));
                    double proposed = Js.toNumber(lr.get("proposed_price"));
                    double amount = lr.get("amount") != null ? Js.round(Js.toNumber(lr.get("amount")))
                            : Js.round(proposed * Js.or(jsNumber(lr, "mm"), 0));
                    lr.put("proposed_price", Js.json(proposed));
                    lr.put("amount", Js.json(amount));
                    subtotal += Js.or(amount, 0);
                    labor.add(lr);
                }
            }
            Map<String, Object> out = new LinkedHashMap<>(sec);
            out.put("items", items);
            out.put("labor", labor);
            out.put("subtotal", Js.json(subtotal));
            sections.add(out);
            supply += subtotal;
        }
        // body.discount || { type: null, value: 0 }
        Map<String, Object> discount = truthy(rawDiscount) ? asMap(rawDiscount) : Map.of("value", 0);
        double discountAmount = 0;
        if (truthy(discount.get("type"))) {
            double value = Js.or(Js.toNumber(discount.get("value")), 0);
            discountAmount = "RATE".equals(discount.get("type")) ? Js.round(supply * value / 100) : Js.round(value);
        }
        double afterDiscount = supply - discountAmount;
        double vat = Js.round(afterDiscount * 0.1);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sections", sections);
        out.put("supply_amount", Js.json(supply));
        out.put("discount_type", or(discount.get("type"), null));
        out.put("discount_value", discount.get("value") != null ? discount.get("value") : 0);
        out.put("discount_amount", Js.json(discountAmount));
        out.put("vat_amount", Js.json(vat));
        out.put("total_amount", Js.json(afterDiscount + vat));
        return out;
    }

    // ── JS 값 규칙 ──────────────────────────────────────────────────

    /** {@code Number(o[k])} — 키가 없으면(undefined) NaN, null 이면 0 */
    static double jsNumber(Map<String, Object> o, String k) {
        return o.containsKey(k) ? Js.toNumber(o.get(k)) : Double.NaN;
    }

    /** Node engine.js {@code num} — null·'' 은 0, 숫자가 아니면 0 */
    static double num(Object v) {
        if (v == null || "".equals(v)) return 0;
        return Js.or(Js.toNumber(v), 0);
    }

    static BigDecimal dec(double d) {
        return BigDecimal.valueOf(d);
    }

    static boolean truthy(Object v) {
        if (v instanceof Map<?, ?> || v instanceof List<?>) return true;
        return Rows.truthy(v);
    }

    /** JS {@code a || b} */
    static Object or(Object a, Object b) {
        return truthy(a) ? a : b;
    }

    /** JS {@code a ?? b} — Map 에서는 키 없음과 null 이 같다 */
    static Object nn(Object a, Object b) {
        return a != null ? a : b;
    }

    /** JS {@code ===} — 숫자 종류가 달라도 같은 값이면 같다 */
    static boolean eq(Object a, Object b) {
        if (a instanceof Number x && b instanceof Number y) return x.doubleValue() == y.doubleValue();
        return a == null ? b == null : a.equals(b);
    }

    static String str(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> asMap(Object o) {
        return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
    }

    @SuppressWarnings("unchecked")
    static List<Object> asList(Object o) {
        return o instanceof List<?> l ? (List<Object>) l : List.of();
    }
}
