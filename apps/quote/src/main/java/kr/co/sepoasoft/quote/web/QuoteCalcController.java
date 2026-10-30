package kr.co.sepoasoft.quote.web;

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

import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * 견적 계산 — Node {@code routes/quotes.js} 의 apply-template · calculate · preview 이식. 명세 2-6절 (#23~#25).
 *
 * <p>금액 계산은 {@link QuoteCalc}(J3 엔진을 감싼 것)가 한다.
 *
 * <p>Node 와 다르게 답하는 곳 (명세 3장 H):
 * <ul>
 *   <li>음수 금액·알 수 없는 특별DC 유형 — 엔진이 거부한다(ENGINE-CONTRACT 2절). 400 {@code INVALID_INPUT}</li>
 *   <li>레거시 섹션형 중 가격정책 4모델 경로({@code calcQuote}) — 이식 대상 아님(J10 대체). 501</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/quotes")
@Access(Level.LOGIN)
public class QuoteCalcController {

    private final Rows db;
    private final QuoteCalc calc;
    private final QuoteHtml html;

    public QuoteCalcController(Rows db, QuoteCalc calc, QuoteHtml html) {
        this.db = db;
        this.calc = calc;
        this.html = html;
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
                "SELECT block_code, item_code, qty_default, band_key, band_qty FROM sq_template_items WHERE template_id = ? ORDER BY block_code, sort", tid);
        List<Map<String, Object>> tlabor = db.query(
                "SELECT block_code, role_code, role_label, grade, task, mm_default FROM sq_template_labor WHERE template_id = ? ORDER BY sort", tid);

        // 모듈 정가 조회
        Set<Object> codes = new LinkedHashSet<>();
        for (Map<String, Object> t : titems) codes.add(t.get("item_code"));
        Map<Object, Map<String, Object>> priceMap = new LinkedHashMap<>();
        if (!codes.isEmpty()) {
            for (Map<String, Object> p : db.query(
                    "SELECT id, code, name, spec, category, base_price, unit, recurring, pricing_type FROM sq_price_items WHERE code IN ("
                            + Rows.placeholders(codes.size()) + ")", codes.toArray())) {
                priceMap.put(p.get("code"), p);
            }
        }
        // SaaS 구간형 서비스(pricing_type BAND)의 구간 — 품목 id → variants. 구간 단위 · 수량으로 구간 월 금액을 고른다
        Map<Object, List<Map<String, Object>>> bandMap = new LinkedHashMap<>();
        List<Object> bandIds = priceMap.values().stream().filter(p -> "BAND".equals(p.get("pricing_type"))).map(p -> p.get("id")).toList();
        if (!bandIds.isEmpty()) {
            for (Map<String, Object> v : db.query("SELECT item_id, `key`, min_qty, max_qty, price FROM sq_price_variants WHERE item_id IN ("
                    + Rows.placeholders(bandIds.size()) + ") ORDER BY sort, id", bandIds.toArray())) {
                bandMap.computeIfAbsent(v.get("item_id"), k -> new ArrayList<>()).add(v);
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
                applyBand(it, t.get("band_key"), t.get("band_qty"), bandMap.get(p.get("id")));
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
        // 구조만 템플릿(기본 모듈 · 인력 없음)도 견적조건 문구는 채워서 시작한다 — 표(셋업 · 서비스)만 비어 있다(2026-10-30 사용자 결정)
        boolean structOnly = titems.isEmpty() && tlabor.isEmpty();
        if (Rows.truthy(tpl.get("condition_set"))) {
            for (Map<String, Object> r : db.query(
                    "SELECT `text` FROM sq_condition_lines WHERE set_code = ? ORDER BY line_no", tpl.get("condition_set"))) {
                conditions.add(r.get("text"));
            }
        }
        // SaaS 는 가격정책(SaaS) 현재 버전의 견적조건을 뒤에 덧붙인다 — 이미 같은 문장이 있으면 빼고(2026-10-30 사용자 결정)
        if ("SAAS".equals(tpl.get("deployment")) && Rows.truthy(tpl.get("condition_set"))) {
            Map<String, Object> pv = db.first("SELECT content FROM sq_price_policy_versions WHERE solution = ? AND deployment = 'SAAS'"
                    + " ORDER BY id DESC LIMIT 1", tpl.get("solution"));
            if (pv != null && db.safeJson(pv.get("content")) instanceof Map<?, ?> content && content.get("conds") instanceof List<?> pc) {
                for (Object c : pc) {
                    String t = c == null ? "" : String.valueOf(c).trim();
                    if (!t.isEmpty() && !conditions.contains(t)) conditions.add(t);
                }
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
        template.put("has_pay_plan", Rows.truthy(tpl.get("has_pay_plan")));
        template.put("has_conditions", Rows.truthy(tpl.get("condition_set"))); // 견적조건 블록을 넣는가 — 문구가 비어도 블록은 있다
        template.put("kind", structOnly ? "STRUCT" : "DATA"); // 결제 방안 포함(V5) — 견적 작성 3단계가 결제 방안 칸을 보여 준다

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
            return calc.calcBlocks(blocks, b.get("discount"), b.get("monthly_discount"), b.get("round_unit"));
        }
        if (!(b.get("sections") instanceof List<?> sections) || sections.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "NO_SECTIONS", "최소 1개 섹션 또는 블록이 필요합니다.");
        }
        return calc.calcSections(sections, b.get("discount"));
    }

    // ── #25 미리보기 (저장 안 함) ────────────────────────────────────

    /**
     * {@code calc} 는 #24 블록형과 같다. {@code html} 은 PDF 와 같은 렌더러({@link QuoteHtml})로 그린다.
     *
     * <p>{@code header.blank = true} (견적 템플릿 화면) — 견적번호·견적일자를 채우지 않고 비워 둔다.
     * {@code header.condition_set} 이 있으면 저장 전 템플릿의 견적조건 세트로 조건을 채운다.
     * {@code header.pay_plan} 이 있으면 저장 전 템플릿의 '결제 방안 포함' 값을 쓴다(없으면 template_code 의 설정).
     */
    @PostMapping("/preview")
    public Map<String, Object> preview(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        if (!(b.get("blocks") instanceof List<?> blocks)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "NO_BLOCKS", "blocks 가 필요합니다.");
        }
        Map<String, Object> result = calc.calcBlocks(blocks, b.get("discount"), b.get("monthly_discount"), b.get("round_unit"));
        @SuppressWarnings("unchecked")
        Map<String, Object> header = b.get("header") instanceof Map<?, ?> h ? (Map<String, Object>) h : Map.of();
        boolean blank = truthy(header.get("blank"));
        Map<String, Object> quote = new LinkedHashMap<>(header);
        // 저장 전이라 견적번호가 없다. 실제 채번은 저장 시점에 일어난다.
        quote.put("quote_no", truthy(header.get("quote_no")) ? header.get("quote_no") : blank ? "" : "(저장 시 채번)");
        quote.put("quote_date", truthy(header.get("quote_date")) ? header.get("quote_date")
                : blank ? "" : java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString());
        List<Map<String, Object>> rblocks = new ArrayList<>();
        if (result.get("blocks") instanceof List<?> cb) for (Object o : cb) {
            if (!(o instanceof Map<?, ?> m)) continue;
            @SuppressWarnings("unchecked")
            Map<String, Object> rb = new LinkedHashMap<>((Map<String, Object>) m);
            rb.put("title", rb.get("name") != null ? rb.get("name") : rb.get("title"));
            rblocks.add(rb);
        }
        quote.put("blocks", rblocks);
        for (String k : List.of("onetime_total", "monthly_total", "supply_amount", "discount_amount", "vat_amount", "total_amount", "round_unit")) {
            quote.put(k, result.get(k));
        }
        quote.put("conditions", header.get("conditions") instanceof List<?> c ? c : null);
        String page = html.render(quote, html.settings(), html.masters(quote, header.get("condition_set"),
                header.containsKey("pay_plan") && !(header.get("pay_plan") instanceof Map<?, ?>) ? header.get("pay_plan") : null), false);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("html", page);
        res.put("calc", result);
        return res;
    }

    private static boolean truthy(Object v) {
        return QuoteCalc.truthy(v);
    }

    private static Object or(Object a, Object b) {
        return QuoteCalc.or(a, b);
    }

    private static boolean eq(Object a, Object b) {
        return QuoteCalc.eq(a, b);
    }

    /**
     * SaaS 구간형 서비스 행 — 구간 단위(USER 인원 / COUNT 건수)와 인원 · 건수(band_qty)가 들어가는 구간의 '구간 월 금액' 을 기준단가로 넣는다.
     * 수량 · 단위는 그대로다: 금액 = 단가 × 수량(다른 행과 같다).
     * 템플릿에 단위가 없으면 인원, 숫자가 없으면 1 로 본다. 구간이 없는 품목은 그대로 둔다(band 키도 넣지 않는다).
     * 예전에 넣은 인원 구간은 key 가 비어 있다 — 가격정책 화면처럼 COUNT 가 아니면 인원이다.
     */
    private static void applyBand(Map<String, Object> it, Object bandKey, Object bandQty, List<Map<String, Object>> variants) {
        if (variants == null || variants.isEmpty()) return;
        String band = "COUNT".equals(bandKey) ? "COUNT" : "USER";
        double n = bandQty == null ? 1 : Js.toNumber(bandQty);
        it.put("band", band);
        it.put("band_qty", Js.json(n));
        Object price = null;
        for (Map<String, Object> v : variants) {
            String k = "COUNT".equals(v.get("key")) ? "COUNT" : "USER";
            if (!k.equals(band) || n < Js.toNumber(v.get("min_qty"))) continue;
            if (v.get("max_qty") != null && n > Js.toNumber(v.get("max_qty"))) continue;
            price = Js.json(Js.toNumber(v.get("price")));
            break;
        }
        it.put("base_price", price);
    }
}
