package kr.co.sepoasoft.quote.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * 가격정책 품목 — Node {@code routes/pricing.js} 이식. 명세 2-4절 (#12~#16).
 *
 * <p>Node 의 {@code GET /api/master}(#11) 는 마스터 라우터에 가려 한 번도 실행되지 않으므로 옮기지 않는다(명세 3장 A).
 * 가격정책 화면의 '견적 품목' 탭(pricing.js)이 목록 · 생성 · 수정 · 사용 중지에 쓴다. 코드는 수정 대상이 아니다(템플릿이 참조).
 */
@RestController
@RequestMapping("/api/pricing")
@Access(Level.LOGIN)
public class PricingController {

    private static final List<String> PRICING_TYPES = List.of("DISCOUNT", "BAND", "FIXED", "MM");
    private static final List<String> ALLOWED = List.of("solution", "deployment", "category", "name", "spec", "pricing_type",
            "base_price", "unit", "qty_default", "required", "recurring", "note", "active", "sort");

    private final Rows db;

    public PricingController(Rows db) {
        this.db = db;
    }

    /** #12 품목 + variants. {@code all} 이 없으면 active=1 만 */
    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String solution,
            @RequestParam(required = false) String deployment, @RequestParam(required = false) String all) {
        List<String> conds = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (all == null || all.isEmpty()) conds.add("active = 1");
        if (solution != null && !solution.isEmpty()) { conds.add("solution = ?"); params.add(solution); }
        if (deployment != null && !deployment.isEmpty()) { conds.add("deployment = ?"); params.add(deployment); }
        String where = conds.isEmpty() ? "" : "WHERE " + String.join(" AND ", conds);
        List<Map<String, Object>> items = db.query("SELECT * FROM sq_price_items " + where + " ORDER BY sort, id", params.toArray());
        if (!items.isEmpty()) {
            Object[] ids = items.stream().map(i -> i.get("id")).toArray();
            Map<Long, List<Map<String, Object>>> byItem = new LinkedHashMap<>();
            for (Object id : ids) byItem.put(((Number) id).longValue(), new ArrayList<>());
            for (Map<String, Object> v : db.query("SELECT * FROM sq_price_variants WHERE item_id IN ("
                    + Rows.placeholders(ids.length) + ") ORDER BY sort, id", ids)) {
                List<Map<String, Object>> bucket = byItem.get(((Number) v.get("item_id")).longValue());
                if (bucket != null) bucket.add(v);
            }
            for (Map<String, Object> it : items) it.put("variants", byItem.get(((Number) it.get("id")).longValue()));
        }
        return Map.of("items", items);
    }

    /** #13 품목 생성 + variants */
    @PostMapping("/items")
    @Access(Level.ADMIN)
    @Transactional
    public ResponseEntity<Map<String, Object>> create(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        for (String f : List.of("code", "name", "solution", "deployment", "pricing_type")) {
            if (!Rows.truthy(b.get(f))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "MISSING_FIELDS", "solution, deployment, code, name, pricing_type는 필수입니다.");
            }
        }
        if (!PRICING_TYPES.contains(b.get("pricing_type"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PRICING_TYPE",
                    "pricing_type은 " + String.join("/", PRICING_TYPES) + " 중 하나여야 합니다.");
        }
        long itemId;
        try {
            itemId = db.insert("INSERT INTO sq_price_items"
                    + " (solution, deployment, category, code, name, spec, pricing_type,"
                    + " base_price, unit, qty_default, required, recurring, note, active, sort)"
                    + " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    b.get("solution"), b.get("deployment"), b.get("category"), b.get("code"), b.get("name"), b.get("spec"),
                    b.get("pricing_type"), nn(b.get("base_price"), 0), b.get("unit"), nn(b.get("qty_default"), 1),
                    nn(b.get("required"), 0), nn(b.get("recurring"), 0), b.get("note"), nn(b.get("active"), 1), nn(b.get("sort"), 0));
        } catch (DuplicateKeyException e) {
            throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_CODE", "이미 존재하는 품목 코드입니다.");
        }
        replaceVariants(itemId, b.get("variants"));
        return ResponseEntity.status(HttpStatus.CREATED).body(item(itemId));
    }

    /** #14 품목 수정 — {@code variants} 를 주면 통째 교체 */
    @PutMapping("/items/{id}")
    @Access(Level.ADMIN)
    @Transactional
    public Map<String, Object> update(@PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        List<String> fields = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        for (String f : ALLOWED) {
            if (!b.containsKey(f)) continue;
            if (f.equals("pricing_type") && !PRICING_TYPES.contains(b.get(f))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PRICING_TYPE", null);
            }
            fields.add(f + " = ?");
            params.add(b.get(f));
        }
        boolean hasVariants = b.containsKey("variants");
        if (fields.isEmpty() && !hasVariants) throw new ApiException(HttpStatus.BAD_REQUEST, "NOTHING_TO_UPDATE", null);
        double n = Js.number(id);
        Object idVal = Js.json(n);
        if (!fields.isEmpty()) {
            params.add(idVal);
            int r = Double.isNaN(n) ? 0 : db.update("UPDATE sq_price_items SET " + String.join(", ", fields) + " WHERE id = ?", params.toArray());
            if (r == 0) throw ApiException.notFound();
        }
        if (hasVariants) replaceVariants(idVal, b.get("variants"));
        return item(idVal);
    }

    /** #15 variants 일괄 교체 */
    @PutMapping("/items/{id}/variants")
    @Access(Level.ADMIN)
    @Transactional
    public Map<String, Object> variants(@PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Object variants = body == null ? null : body.get("variants");
        if (!(variants instanceof List<?>)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_VARIANTS", "variants 배열이 필요합니다.");
        }
        double n = Js.number(id);
        if (Double.isNaN(n) || db.first("SELECT id FROM sq_price_items WHERE id = ?", Js.json(n)) == null) {
            throw ApiException.notFound();
        }
        replaceVariants(Js.json(n), variants);
        return Map.of("variants", db.query("SELECT * FROM sq_price_variants WHERE item_id = ? ORDER BY sort, id", Js.json(n)));
    }

    /** #16 품목 soft delete */
    @DeleteMapping("/items/{id}")
    @Access(Level.ADMIN)
    public Map<String, Object> delete(@PathVariable String id) {
        double n = Js.number(id);
        int r = Double.isNaN(n) ? 0 : db.update("UPDATE sq_price_items SET active = 0 WHERE id = ?", Js.json(n));
        if (r == 0) throw ApiException.notFound();
        return Map.of("ok", true);
    }

    /** variants 전체 삭제 후 재삽입. 배열이 아니면 지우기만 한다(Node 그대로) */
    private void replaceVariants(Object itemId, Object variants) {
        db.update("DELETE FROM sq_price_variants WHERE item_id = ?", itemId);
        List<Object> list = QuoteCalc.asList(variants);
        boolean step = hasStepPrice(); // V20 — 추가 1단위당 금액
        for (int i = 0; i < list.size(); i++) {
            Map<String, Object> v = QuoteCalc.asMap(list.get(i));
            if (step) {
                db.update("INSERT INTO sq_price_variants (item_id, `key`, label, min_qty, max_qty, rate, price, step_price, sort)"
                        + " VALUES (?,?,?,?,?,?,?,?,?)",
                        itemId, v.get("key"), v.get("label"), v.get("min_qty"), v.get("max_qty"), v.get("rate"), v.get("price"),
                        v.get("step_price"), nn(v.get("sort"), i));
            } else {
                db.update("INSERT INTO sq_price_variants (item_id, `key`, label, min_qty, max_qty, rate, price, sort)"
                        + " VALUES (?,?,?,?,?,?,?,?)",
                        itemId, v.get("key"), v.get("label"), v.get("min_qty"), v.get("max_qty"), v.get("rate"), v.get("price"),
                        nn(v.get("sort"), i));
            }
        }
    }

    private Boolean stepPrice;
    /** V20 sq_price_variants.step_price 가 있는가 — 한 번 확인하면 기억한다(없으면 매번 다시 본다: SQL 을 실행하면 바로 쓴다) */
    private boolean hasStepPrice() {
        if (Boolean.TRUE.equals(stepPrice)) return true;
        Map<String, Object> r = db.first("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE()"
                + " AND table_name = 'sq_price_variants' AND column_name = 'step_price'");
        stepPrice = r != null && r.get("n") instanceof Number n && n.longValue() > 0;
        return stepPrice;
    }

    /** {@code {item: rows[0]}} — 행이 없으면 키가 빠진다 */
    private Map<String, Object> item(Object id) {
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> r = db.first("SELECT * FROM sq_price_items WHERE id = ?", id);
        if (r != null) out.put("item", r);
        return out;
    }

    private static Object nn(Object a, Object b) {
        return QuoteCalc.nn(a, b);
    }
}
