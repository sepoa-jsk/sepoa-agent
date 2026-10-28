package kr.co.sepoasoft.quote.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * {@code /api/quotes} — Node {@code routes/quotes.js} 이식. 명세 2-6절. J5-2 는 목록·상세(#27·#28)만.
 *
 * <p>{@code domain.quote.QuoteRepository} 도 같은 SQL 로 견적을 읽지만 타입이 정해진 레코드라
 * {@code SELECT *} 의 모든 컬럼을 내지 못한다. API 응답은 Node 와 키까지 같아야 하므로 여기서는
 * 행을 Map 그대로 다룬다. 레코드 쪽은 계산·렌더(J7)가 쓴다.
 */
@RestController
@RequestMapping("/api/quotes")
@Access(Level.LOGIN)
public class QuoteController {

    private static final List<String> STATUSES = List.of("DRAFT", "SENT", "WON", "LOST");

    private final Rows db;

    public QuoteController(Rows db) {
        this.db = db;
    }

    /** #27 목록 — 최신순, {@code size} 최대 100 */
    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String status,
            @RequestParam(required = false) String customer,
            @RequestParam(name = "quote_no", required = false) String quoteNo,
            @RequestParam(required = false) String page, @RequestParam(required = false) String size) {
        double p = Js.number(page), s = Js.number(size);
        double pageN = Math.max(1, Js.truthy(p) ? p : 1);
        double sizeN = Math.min(100, Math.max(1, Js.truthy(s) ? s : 20));
        List<String> conds = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (status != null && STATUSES.contains(status)) { conds.add("status = ?"); params.add(status); }
        if (customer != null && !customer.isEmpty()) { conds.add("customer_name LIKE ?"); params.add("%" + customer + "%"); }
        // 견적번호는 신형식(QT20260802_001)과 구형식(S20260802001)을 모두 찾는다.
        if (quoteNo != null && !quoteNo.isEmpty()) {
            String c = quoteNoSearchClause(quoteNo, params);
            if (c != null) conds.add(c);
        }
        String where = conds.isEmpty() ? "" : "WHERE " + String.join(" AND ", conds);
        Object cnt = db.first("SELECT COUNT(*) AS cnt FROM sq_quotes " + where, params.toArray()).get("cnt");
        List<Object> pageParams = new ArrayList<>(params);
        pageParams.add(Js.json(sizeN));
        pageParams.add(Js.json((pageN - 1) * sizeN));
        List<Map<String, Object>> rows = db.query(
                "SELECT q.*, u.name AS created_by_name"
                        + " FROM sq_quotes q LEFT JOIN sq_users u ON u.id = q.created_by "
                        + where + " ORDER BY q.id DESC LIMIT ? OFFSET ?",
                pageParams.toArray());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("total", cnt);
        out.put("page", Js.json(pageN));
        out.put("size", Js.json(sizeN));
        out.put("quotes", rows);
        return out;
    }

    /** Node {@code numbering.js} {@code quoteNoSearchClause} — 입력 그대로 OR 접두어·구분자 뗀 숫자열 */
    static String quoteNoSearchClause(String term, List<Object> params) {
        String raw = term.strip();
        if (raw.isEmpty()) return null;
        String digits = raw.replaceFirst("(?i)^(QT|S)", "").replaceAll("[^0-9]", "");
        List<String> like = new ArrayList<>();
        like.add("quote_no LIKE ?");
        params.add("%" + raw + "%");
        if (!digits.isEmpty()) {
            like.add("REPLACE(REPLACE(REPLACE(quote_no, 'QT', ''), 'S', ''), '_', '') LIKE ?");
            params.add("%" + digits + "%");
        }
        return "(" + String.join(" OR ", like) + ")";
    }

    /** #28 상세 */
    @GetMapping("/{id}")
    public Map<String, Object> detail(@PathVariable String id) {
        Map<String, Object> quote = loadQuote(Js.number(id));
        if (quote == null) throw ApiException.notFound();
        return Map.of("quote", quote);
    }

    /**
     * Node {@code loadQuote} — 헤더 + 섹션(레거시) + 블록. 정렬·묶는 방식이 Node 와 같아야 배열 순서가 같다.
     *
     * <p>품목·인건비는 <b>섹션 id 로만</b> 읽는다. 섹션이 없는 견적은 블록이 있어도 품목이 비어 나온다 —
     * Node 동작 그대로다.
     */
    Map<String, Object> loadQuote(double id) {
        if (Double.isNaN(id)) return null; // Number('abc') — 어떤 견적과도 맞지 않는다
        Map<String, Object> quote = db.first("SELECT * FROM sq_quotes WHERE id = ?", Js.json(id));
        if (quote == null) return null;
        Object qid = quote.get("id");
        quote.put("conditions", db.safeJson(quote.get("conditions")));
        List<Map<String, Object>> sections = db.query(
                "SELECT * FROM sq_quote_sections WHERE quote_id = ? ORDER BY sort, id", qid);
        List<Map<String, Object>> items = List.of();
        List<Map<String, Object>> laborRows = List.of();
        if (!sections.isEmpty()) {
            Object[] ids = sections.stream().map(sec -> sec.get("id")).toArray();
            String ph = Rows.placeholders(ids.length);
            items = db.query("SELECT * FROM sq_quote_items WHERE section_id IN (" + ph + ") ORDER BY sort, id", ids);
            laborRows = db.query("SELECT * FROM sq_quote_labor WHERE section_id IN (" + ph + ") ORDER BY sort, id", ids);
        }
        Map<Object, List<Map<String, Object>>> bySection = buckets(sections);
        Map<Object, List<Map<String, Object>>> laborBySection = buckets(sections);
        for (Map<String, Object> it : items) add(bySection, it.get("section_id"), it);
        for (Map<String, Object> l : laborRows) add(laborBySection, l.get("section_id"), l);
        List<Map<String, Object>> outSections = new ArrayList<>();
        for (Map<String, Object> s : sections) {
            Map<String, Object> o = new LinkedHashMap<>(s);
            o.put("params", Rows.truthy(s.get("params")) ? db.safeJson(s.get("params")) : null);
            o.put("items", bySection.get(key(s.get("id"))));
            o.put("labor", laborBySection.get(key(s.get("id"))));
            outSections.add(o);
        }
        quote.put("sections", outSections);

        // 블록 구조(5-C) — 블록별 품목/인건비는 block_id 로 묶는다
        List<Map<String, Object>> blockRows = db.query(
                "SELECT * FROM sq_quote_blocks WHERE quote_id = ? ORDER BY sort, id", qid);
        Map<Object, List<Map<String, Object>>> itemsByBlock = buckets(blockRows);
        Map<Object, List<Map<String, Object>>> laborByBlock = buckets(blockRows);
        for (Map<String, Object> it : items) if (it.get("block_id") != null) add(itemsByBlock, it.get("block_id"), it);
        for (Map<String, Object> l : laborRows) {
            if (l.get("block_id") == null) continue;
            Map<String, Object> copy = new LinkedHashMap<>(l);
            copy.put("month_alloc", db.safeJson(l.get("month_alloc")));
            add(laborByBlock, l.get("block_id"), copy);
        }
        List<Map<String, Object>> outBlocks = new ArrayList<>();
        for (Map<String, Object> b : blockRows) {
            Map<String, Object> o = new LinkedHashMap<>(b);
            o.put("recurring", Rows.truthy(b.get("recurring")));
            o.put("items", itemsByBlock.get(key(b.get("id"))));
            o.put("labor", laborByBlock.get(key(b.get("id"))));
            outBlocks.add(o);
        }
        quote.put("blocks", outBlocks);
        return quote;
    }

    /** 부모 id 마다 빈 목록 — Node {@code new Map(parents.map((p) => [p.id, []]))} */
    private static Map<Object, List<Map<String, Object>>> buckets(List<Map<String, Object>> parents) {
        Map<Object, List<Map<String, Object>>> m = new LinkedHashMap<>();
        for (Map<String, Object> p : parents) m.put(key(p.get("id")), new ArrayList<>());
        return m;
    }

    /** 부모 목록에 없는 id 의 자식은 버린다 — Node {@code map.get(id)?.push(...)} */
    private static void add(Map<Object, List<Map<String, Object>>> m, Object parentId, Map<String, Object> row) {
        List<Map<String, Object>> bucket = m.get(key(parentId));
        if (bucket != null) bucket.add(row);
    }

    /** id 를 숫자 종류(Integer/Long/BigInteger)와 무관하게 비교한다 */
    private static Object key(Object id) {
        return id instanceof Number n ? (Object) n.longValue() : id;
    }
}
