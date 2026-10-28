package kr.co.sepoasoft.quote.web;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import kr.co.sepoasoft.quote.domain.pricing.PricingEngine;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.Discount;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.ItemRow;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborError;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborRow;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteResult;
import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * 견적 계산 — Node {@code routes/quotes.js} 의 apply-template · calculate · preview 이식. 명세 2-6절 (#23~#25).
 *
 * <p><b>금액은 J3 엔진({@link PricingEngine})이 낸다.</b> 여기서는 요청 JSON 을 엔진 입력으로 바꾸고,
 * 엔진 결과를 Node 응답 모양(입력 블록을 되돌려 주며 라인마다 금액을 채운 것)으로 다시 감싼다.
 * 요청 값은 Node {@code num()} 규칙으로 읽는다 — 빈 값·숫자 아닌 값은 0.
 *
 * <p>Node 와 다르게 답하는 곳 (명세 3장 H):
 * <ul>
 *   <li>음수 금액·알 수 없는 특별DC 유형 — 엔진이 거부한다(ENGINE-CONTRACT 2절). 400 {@code INVALID_INPUT}</li>
 *   <li>레거시 섹션형 중 가격정책 4모델 경로({@code calcQuote}) — 이식 대상 아님(J10 대체). 501</li>
 *   <li>{@code preview} 의 {@code html} — 렌더러(J7) 전까지 빈 문자열</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/quotes")
@Access(Level.LOGIN)
public class QuoteCalcController {

    private static final double DEFAULT_ROUND_UNIT = 100000;

    private final Rows db;
    private final PricingEngine engine;

    public QuoteCalcController(Rows db, PricingEngine engine) {
        this.db = db;
        this.engine = engine;
    }

    // ── #23 템플릿 적용 ─────────────────────────────────────────────

    /**
     * 블록/기본모듈/인건비 기본이 채워진 견적 초안(미저장). 기준단가 프리필: 모듈=price_items 정가,
     * 인건비=active 연도 apply_price. 제안단가는 null(사용자 네고 입력).
     */
    @PostMapping("/apply-template")
    public Map<String, Object> applyTemplate(@RequestBody(required = false) Map<String, Object> body) {
        Object code = body == null ? null : body.get("template_code");
        Map<String, Object> tpl = db.first("SELECT * FROM sq_quote_templates WHERE code = ?", code);
        if (tpl == null) throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "템플릿을 찾을 수 없습니다.");
        Object tid = tpl.get("id");

        List<Map<String, Object>> blocks = db.query(
                "SELECT tb.block_code, tb.sort, b.name, b.`columns`, b.recurring, b.optional, b.has_subtotal"
                        + " FROM sq_template_blocks tb JOIN sq_blocks b ON b.code = tb.block_code"
                        + " WHERE tb.template_id = ? ORDER BY tb.sort", tid);
        List<Map<String, Object>> titems = db.query(
                "SELECT block_code, item_code, qty_default FROM sq_template_items WHERE template_id = ? ORDER BY block_code, sort", tid);
        List<Map<String, Object>> tlabor = db.query(
                "SELECT block_code, role_code, role_label, grade, task, mm_default FROM sq_template_labor WHERE template_id = ? ORDER BY sort", tid);

        // 모듈 정가 조회
        Set<Object> codes = new LinkedHashSet<>();
        for (Map<String, Object> t : titems) codes.add(t.get("item_code"));
        Map<Object, Map<String, Object>> priceMap = new LinkedHashMap<>();
        if (!codes.isEmpty()) {
            for (Map<String, Object> p : db.query(
                    "SELECT code, name, spec, category, base_price, unit, recurring FROM sq_price_items WHERE code IN ("
                            + Rows.placeholders(codes.size()) + ")", codes.toArray())) {
                priceMap.put(p.get("code"), p);
            }
        }
        // 활성 연도 인건비 기준단가(apply_price)
        Map<String, Object> ly = db.first("SELECT id, `year` FROM sq_labor_rate_years WHERE active = 1 LIMIT 1");
        Map<Object, Map<String, Object>> laborMap = new LinkedHashMap<>();
        if (ly != null) {
            for (Map<String, Object> r : db.query(
                    "SELECT role_code, role_name, apply_price FROM sq_labor_rate_lines WHERE year_id = ?", ly.get("id"))) {
                laborMap.put(r.get("role_code"), r);
            }
        }

        // 블록별 모듈/인건비를 함께 채운다. SETUP 은 모듈과 인건비(MM 산정)가 동시에 붙을 수 있다.
        boolean laborPlan = Rows.truthy(tpl.get("has_labor_plan"));
        List<Map<String, Object>> draftBlocks = new ArrayList<>();
        for (Map<String, Object> b : blocks) {
            Object blockCode = b.get("block_code");
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("block_code", blockCode);
            out.put("name", b.get("name"));
            out.put("columns", db.parseCols(b.get("columns")));
            out.put("recurring", Rows.truthy(b.get("recurring")));
            out.put("optional", Rows.truthy(b.get("optional")));
            out.put("has_subtotal", Rows.truthy(b.get("has_subtotal")));

            List<Map<String, Object>> items = new ArrayList<>();
            for (Map<String, Object> t : titems) {
                if (!eq(t.get("block_code"), blockCode)) continue;
                Map<String, Object> p = priceMap.getOrDefault(t.get("item_code"), Map.of());
                Map<String, Object> it = new LinkedHashMap<>();
                it.put("item_code", t.get("item_code"));
                it.put("category", or(p.get("category"), null));
                it.put("name", or(p.get("name"), t.get("item_code")));
                it.put("spec", or(p.get("spec"), null));
                it.put("qty", t.get("qty_default") == null ? (Object) 1 : Js.json(Js.toNumber(t.get("qty_default"))));
                it.put("base_price", p.get("base_price") != null ? Js.json(Js.toNumber(p.get("base_price"))) : null);
                it.put("proposed_price", null);
                it.put("amount", 0);
                it.put("unit", or(p.get("unit"), null));
                it.put("recurring", Rows.truthy(p.get("recurring")));
                it.put("registered", priceMap.containsKey(t.get("item_code")));
                items.add(it);
            }
            List<Map<String, Object>> labor = new ArrayList<>();
            for (Map<String, Object> l : tlabor) {
                if (!eq(or(l.get("block_code"), "LABOR"), blockCode)) continue;
                Map<String, Object> r = laborMap.getOrDefault(l.get("role_code"), Map.of());
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("role_code", l.get("role_code"));
                row.put("role_name", or(r.get("role_name"), l.get("role_code")));
                row.put("role_label", or(l.get("role_label"), or(r.get("role_name"), l.get("role_code"))));
                row.put("grade", or(l.get("grade"), null));
                row.put("task", or(l.get("task"), ""));
                row.put("mm", Js.json(Js.or(Js.toNumber(l.get("mm_default")), 0)));
                row.put("base_price", r.get("apply_price") != null ? Js.json(Js.toNumber(r.get("apply_price"))) : null);
                row.put("proposed_price", null);
                row.put("amount", 0);
                row.put("month_alloc", laborPlan ? new LinkedHashMap<>() : null);
                labor.add(row);
            }
            out.put("items", items);
            out.put("labor", labor);
            out.put("subtotal", 0);
            draftBlocks.add(out);
        }

        List<Object> conditions = new ArrayList<>();
        if (Rows.truthy(tpl.get("condition_set"))) {
            for (Map<String, Object> r : db.query(
                    "SELECT `text` FROM sq_condition_lines WHERE set_code = ? ORDER BY line_no", tpl.get("condition_set"))) {
                conditions.add(r.get("text"));
            }
        }
        Set<Object> unregistered = new LinkedHashSet<>();
        for (Map<String, Object> t : titems) if (!priceMap.containsKey(t.get("item_code"))) unregistered.add(t.get("item_code"));

        Map<String, Object> template = new LinkedHashMap<>();
        template.put("code", tpl.get("code"));
        template.put("name", tpl.get("name"));
        template.put("quote_type", or(tpl.get("quote_type"), "BUILD"));
        template.put("solution", tpl.get("solution"));
        template.put("deployment", tpl.get("deployment"));
        template.put("brand", tpl.get("brand"));
        template.put("condition_set", tpl.get("condition_set"));
        template.put("has_labor_plan", laborPlan);
        template.put("include_maintenance", Rows.truthy(tpl.get("include_maintenance")));
        template.put("include_component", Rows.truthy(tpl.get("include_component")));

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("template", template);
        res.put("blocks", draftBlocks);
        res.put("labor_year", ly != null ? ly.get("year") : null);
        res.put("round_unit", 100000);
        res.put("conditions", conditions);
        res.put("unregistered", unregistered); // 가격마스터에 없는 모듈 — 기준단가가 비어 있음을 화면에서 알린다
        return res;
    }

    // ── #24 계산 전용 (저장 안 함, 타시스템 연계) ─────────────────────

    /** 블록형 {@code {blocks, discount, monthly_discount, round_unit}} 또는 레거시 {@code {sections, discount}} */
    @PostMapping("/calculate")
    @Access(Level.KEY_OR_LOGIN)
    public Map<String, Object> calculate(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        if (b.get("blocks") instanceof List<?> blocks) {
            if (blocks.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "NO_BLOCKS", "최소 1개 블록이 필요합니다.");
            return calcBlocks(blocks, b.get("discount"), b.get("monthly_discount"), b.get("round_unit"));
        }
        if (!(b.get("sections") instanceof List<?> sections) || sections.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "NO_SECTIONS", "최소 1개 섹션 또는 블록이 필요합니다.");
        }
        if (!isBlockMode(sections)) {
            throw new ApiException(HttpStatus.NOT_IMPLEMENTED, "NOT_IMPLEMENTED",
                    "구 가격정책(4모델) 섹션 계산은 Java 로 옮기지 않습니다. blocks 로 보내 주세요.");
        }
        return snapshotCalc(sections, b.get("discount"));
    }

    // ── #25 미리보기 (저장 안 함) ────────────────────────────────────

    /** {@code calc} 는 #24 블록형과 같다. {@code html} 은 J7(렌더러) 에서 채운다. */
    @PostMapping("/preview")
    public Map<String, Object> preview(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        if (!(b.get("blocks") instanceof List<?> blocks)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "NO_BLOCKS", "blocks 가 필요합니다.");
        }
        Map<String, Object> calc = calcBlocks(blocks, b.get("discount"), b.get("monthly_discount"), b.get("round_unit"));
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("html", "");
        res.put("calc", calc);
        return res;
    }

    // ── 블록형 계산 — Node engine.js calcQuoteBlocks 의 응답 모양 ──────

    Map<String, Object> calcBlocks(List<?> rawBlocks, Object rawDiscount, Object rawMonthly, Object rawRoundUnit) {
        // Node: req.body.round_unit ?? 100000 → num()
        double roundUnit = rawRoundUnit == null ? DEFAULT_ROUND_UNIT : num(rawRoundUnit);
        List<BlockInput> inputs = new ArrayList<>();
        for (Object o : rawBlocks) inputs.add(toBlockInput(asMap(o)));
        QuoteResult r;
        try {
            r = engine.calcQuoteBlocks(new QuoteInput(inputs, toDiscount(rawDiscount), toDiscount(rawMonthly), dec(roundUnit)));
        } catch (IllegalArgumentException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_INPUT", e.getMessage());
        }

        // 입력 블록을 되돌려 주며 금액 라인·소계·recurring 을 덮어쓴다 — Node {...block, items|labor: lines, subtotal, recurring}
        List<Map<String, Object>> outBlocks = new ArrayList<>();
        for (int i = 0; i < rawBlocks.size(); i++) {
            Map<String, Object> block = asMap(rawBlocks.get(i));
            boolean isLabor = "LABOR".equals(block.get("block_code"));
            String rowsKey = isLabor ? "labor" : "items";
            List<BigDecimal> amounts = engine.calcBlock(inputs.get(i)).lineAmounts();
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
    // JS 실수 연산을 그대로 따른다(엔진을 거치지 않는 경로). 특별DC 는 service.js computeDiscountAmount.

    /** 섹션에 labor 배열이 있거나 품목에 block_code 가 있으면 스냅샷 경로 */
    static boolean isBlockMode(List<?> sections) {
        for (Object o : sections) {
            Map<String, Object> s = asMap(o);
            if (s.get("labor") instanceof List<?>) return true;
            if (s.get("items") instanceof List<?> items) {
                for (Object i : items) if (truthy(asMap(i).get("block_code"))) return true;
            }
        }
        return false;
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
                            : Js.round(proposed * Js.or(qtyNumber(it.get("qty"), it.containsKey("qty")), 1));
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
                            : Js.round(proposed * Js.or(qtyNumber(lr.get("mm"), lr.containsKey("mm")), 0));
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

    /** {@code Number(x)} — 키가 없으면(undefined) NaN, null 이면 0 */
    private static double qtyNumber(Object v, boolean present) {
        return present ? Js.toNumber(v) : Double.NaN;
    }

    // ── JS 값 규칙 ──────────────────────────────────────────────────

    /** Node engine.js {@code num} — null·'' 은 0, 숫자가 아니면 0 */
    private static double num(Object v) {
        if (v == null || "".equals(v)) return 0;
        return Js.or(Js.toNumber(v), 0);
    }

    private static BigDecimal dec(double d) {
        return BigDecimal.valueOf(d);
    }

    private static boolean truthy(Object v) {
        if (v instanceof Map<?, ?> || v instanceof List<?>) return true;
        return Rows.truthy(v);
    }

    /** JS {@code a || b} */
    private static Object or(Object a, Object b) {
        return truthy(a) ? a : b;
    }

    /** JS {@code ===} — 숫자 종류가 달라도 같은 값이면 같다 */
    private static boolean eq(Object a, Object b) {
        if (a instanceof Number x && b instanceof Number y) return x.doubleValue() == y.doubleValue();
        return a == null ? b == null : a.equals(b);
    }

    private static String str(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o) {
        return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
    }
}
