package kr.co.sepoasoft.quote.web;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
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

/** 블록·견적조건·템플릿 — Node {@code routes/templates.js} 이식. 명세 2-5절. 템플릿 쓰기(#21·#22)는 관리자만. */
@RestController
@RequestMapping("/api")
@Access(Level.LOGIN)
public class TemplateController {

    private final Rows db;

    public TemplateController(Rows db) {
        this.db = db;
    }

    /** #17 블록 정의 — {@code columns} 는 배열로 파싱 */
    @GetMapping("/blocks")
    public Map<String, Object> blocks() {
        List<Map<String, Object>> rows = db.query("SELECT * FROM sq_blocks ORDER BY sort, code");
        for (Map<String, Object> b : rows) b.put("columns", db.parseCols(b.get("columns")));
        return Map.of("blocks", rows);
    }

    /** #18 견적조건 세트 + 문장 목록 */
    @GetMapping("/conditions")
    public Map<String, Object> conditions() {
        List<Map<String, Object>> sets = db.query("SELECT * FROM sq_condition_sets ORDER BY code");
        List<Map<String, Object>> lines = db.query(
                "SELECT set_code, line_no, `text` FROM sq_condition_lines ORDER BY set_code, line_no");
        Map<Object, List<Object>> bySet = new LinkedHashMap<>();
        for (Map<String, Object> l : lines) bySet.computeIfAbsent(l.get("set_code"), k -> new ArrayList<>()).add(l.get("text"));
        for (Map<String, Object> s : sets) s.put("lines", bySet.getOrDefault(s.get("code"), List.of()));
        return Map.of("conditions", sets);
    }

    /** #19 템플릿 목록 — {@code quote_type} · {@code solution} · {@code active} 필터 */
    @GetMapping("/templates")
    public Map<String, Object> templates(@RequestParam(name = "quote_type", required = false) String quoteType,
            @RequestParam(required = false) String solution, @RequestParam(required = false) String active) {
        List<String> conds = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (quoteType != null && !quoteType.isEmpty()) { conds.add("quote_type = ?"); params.add(quoteType); }
        if (solution != null && !solution.isEmpty()) { conds.add("solution = ?"); params.add(solution); }
        if (active != null) { conds.add("active = ?"); params.add(Js.truthy(Js.number(active)) ? 1 : 0); }
        String where = conds.isEmpty() ? "" : "WHERE " + String.join(" AND ", conds);
        List<Map<String, Object>> rows = db.query(
                "SELECT t.*, (SELECT GROUP_CONCAT(tb.block_code ORDER BY tb.sort) FROM sq_template_blocks tb WHERE tb.template_id = t.id) AS block_codes"
                        + " FROM sq_quote_templates t " + where + " ORDER BY t.quote_type, t.solution, t.sort, t.id",
                params.toArray());
        for (Map<String, Object> t : rows) {
            Object codes = t.get("block_codes");
            t.put("block_codes", Rows.truthy(codes) ? Arrays.asList(String.valueOf(codes).split(",", -1)) : List.of());
        }
        return Map.of("templates", rows);
    }

    /** #20 템플릿 상세 — 블록 · 기본모듈(블록별) · 인건비(평면 + 블록별) · 조건 · 미등록 모듈 */
    @GetMapping("/templates/{code}")
    public Map<String, Object> template(@PathVariable String code) {
        Map<String, Object> tpl = db.first("SELECT * FROM sq_quote_templates WHERE code = ?", code);
        if (tpl == null) throw ApiException.notFound();
        Object tid = tpl.get("id");
        List<Map<String, Object>> blocks = db.query(
                "SELECT tb.block_code, tb.sort, b.name, b.`columns`, b.calc, b.has_subtotal, b.recurring, b.optional"
                        + " FROM sq_template_blocks tb JOIN sq_blocks b ON b.code = tb.block_code"
                        + " WHERE tb.template_id = ? ORDER BY tb.sort", tid);
        // 기본모듈은 price_items 소프트 참조 — 마스터에 없는 코드도 그대로 보여주고 registered=false 로 표시한다
        List<Map<String, Object>> items = db.query(
                "SELECT ti.block_code, ti.item_code, ti.qty_default, ti.sort,"
                        + " p.name AS item_name, p.base_price, p.recurring, p.unit,"
                        + " (p.code IS NOT NULL) AS registered"
                        + " FROM sq_template_items ti"
                        + " LEFT JOIN sq_price_items p ON p.code = ti.item_code"
                        + " WHERE ti.template_id = ? ORDER BY ti.block_code, ti.sort", tid);
        // 인건비 기본단가는 active 연도 임금단가에서 끌어온다(스냅샷은 견적 저장 시점에)
        List<Map<String, Object>> labor = db.query(
                "SELECT tl.block_code, tl.role_code, tl.role_label, tl.grade, tl.task, tl.mm_default, tl.sort,"
                        + " r.role_name, r.apply_price AS base_price"
                        + " FROM sq_template_labor tl"
                        + " LEFT JOIN sq_labor_rate_lines r"
                        + " ON r.role_code = tl.role_code"
                        + " AND r.year_id = (SELECT id FROM sq_labor_rate_years WHERE active = 1 LIMIT 1)"
                        + " WHERE tl.template_id = ? ORDER BY tl.sort", tid);
        List<Object> conditions = new ArrayList<>();
        if (Rows.truthy(tpl.get("condition_set"))) {
            for (Map<String, Object> r : db.query(
                    "SELECT `text` FROM sq_condition_lines WHERE set_code = ? ORDER BY line_no", tpl.get("condition_set"))) {
                conditions.add(r.get("text"));
            }
        }
        // JS 객체 키는 문자열이다 — block_code 가 null 이면 "null" 키에 모인다
        Map<String, List<Map<String, Object>>> itemsByBlock = new LinkedHashMap<>();
        Map<String, List<Map<String, Object>>> laborByBlock = new LinkedHashMap<>();
        List<Object> unregistered = new ArrayList<>();
        for (Map<String, Object> it : items) {
            if (!Rows.truthy(it.get("registered"))) unregistered.add(it.get("item_code"));
            Map<String, Object> copy = new LinkedHashMap<>(it);
            copy.put("registered", Rows.truthy(it.get("registered")));
            itemsByBlock.computeIfAbsent(String.valueOf(it.get("block_code")), k -> new ArrayList<>()).add(copy);
        }
        for (Map<String, Object> l : labor) {
            laborByBlock.computeIfAbsent(String.valueOf(l.get("block_code")), k -> new ArrayList<>()).add(l);
        }
        for (Map<String, Object> b : blocks) b.put("columns", db.parseCols(b.get("columns")));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("template", tpl);
        out.put("blocks", blocks);
        out.put("items", itemsByBlock);
        out.put("labor", labor);            // 하위호환(평면 목록)
        out.put("laborByBlock", laborByBlock); // 블록별(LABOR / SETUP)
        out.put("conditions", conditions);
        out.put("unregistered", unregistered);
        return out;
    }

    // ── (ADMIN) 템플릿 생성/수정 — 헤더 + 블록/모듈/인건비 통째 교체 ─

    private static final List<String> TPL_COLS = List.of("quote_type", "solution", "code", "name", "deployment", "brand",
            "include_maintenance", "include_component", "condition_set", "has_labor_plan", "active", "sort");
    private static final Map<String, Object> TPL_DEFAULTS = Map.of("quote_type", "BUILD", "has_labor_plan", 0,
            "include_maintenance", 0, "include_component", 0, "active", 1, "sort", 0);

    /** #21 생성 — code·solution·name 필수, code 중복이면 409 */
    @PostMapping("/templates")
    @Access(Level.ADMIN)
    @Transactional
    public ResponseEntity<Map<String, Object>> createTemplate(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        if (!Rows.truthy(b.get("code")) || !Rows.truthy(b.get("solution")) || !Rows.truthy(b.get("name"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "MISSING", "code/solution/name 은 필수입니다.");
        }
        if (db.first("SELECT id FROM sq_quote_templates WHERE code = ?", b.get("code")) != null) {
            throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_CODE", Js.string(b.get("code")) + " 는 이미 존재합니다.");
        }
        long tid = writeTemplate(null, b);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", tid);
        out.put("code", b.get("code"));
        return ResponseEntity.status(HttpStatus.CREATED).body(out);
    }

    /** #22 수정 — 블록·모듈·인건비는 지우고 다시 넣는다 */
    @PutMapping("/templates/{id}")
    @Access(Level.ADMIN)
    @Transactional
    public Map<String, Object> updateTemplate(@PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        double n = Js.number(id);
        if (Double.isNaN(n) || db.first("SELECT id FROM sq_quote_templates WHERE id = ?", Js.json(n)) == null) {
            throw ApiException.notFound();
        }
        writeTemplate((long) n, body == null ? Map.of() : body);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("id", Js.json(n));
        return out;
    }

    /** Node {@code writeTemplate} — 보내지 않은 헤더 필드는 기본값(없으면 null). 보낸 null 은 null 그대로 */
    private long writeTemplate(Long id, Map<String, Object> body) {
        List<Object> vals = new ArrayList<>();
        for (String c : TPL_COLS) vals.add(body.containsKey(c) ? body.get(c) : TPL_DEFAULTS.get(c));
        long tid;
        if (id != null) {
            tid = id;
            vals.add(id);
            db.update("UPDATE sq_quote_templates SET " + String.join(", ", TPL_COLS.stream().map(c -> "`" + c + "` = ?").toList())
                    + " WHERE id = ?", vals.toArray());
            db.update("DELETE FROM sq_template_blocks WHERE template_id = ?", id);
            db.update("DELETE FROM sq_template_items WHERE template_id = ?", id);
            db.update("DELETE FROM sq_template_labor WHERE template_id = ?", id);
        } else {
            tid = db.insert("INSERT INTO sq_quote_templates (" + String.join(", ", TPL_COLS.stream().map(c -> "`" + c + "`").toList())
                    + ") VALUES (" + Rows.placeholders(TPL_COLS.size()).replace(",", ", ") + ")", vals.toArray());
        }
        List<Object> blocks = QuoteCalc.asList(body.get("blocks"));
        for (int i = 0; i < blocks.size(); i++) {
            db.update("INSERT INTO sq_template_blocks (template_id, block_code, sort) VALUES (?, ?, ?)", tid, blocks.get(i), i);
        }
        List<Object> items = QuoteCalc.asList(body.get("items"));
        for (int i = 0; i < items.size(); i++) {
            Map<String, Object> it = QuoteCalc.asMap(items.get(i));
            db.update("INSERT INTO sq_template_items (template_id, block_code, item_code, qty_default, sort) VALUES (?, ?, ?, ?, ?)",
                    tid, it.get("block_code"), it.get("item_code"), QuoteCalc.nn(it.get("qty_default"), 1), i);
        }
        List<Object> labor = QuoteCalc.asList(body.get("labor"));
        for (int i = 0; i < labor.size(); i++) {
            Map<String, Object> l = QuoteCalc.asMap(labor.get(i));
            db.update("INSERT INTO sq_template_labor (template_id, block_code, role_code, role_label, grade, task, mm_default, sort)"
                    + " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    tid, QuoteCalc.or(l.get("block_code"), "LABOR"), l.get("role_code"), l.get("role_label"), l.get("grade"),
                    l.get("task"), QuoteCalc.nn(l.get("mm_default"), 0), i);
        }
        return tid;
    }
}
