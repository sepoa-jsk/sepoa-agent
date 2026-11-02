package kr.co.sepoasoft.quote.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * Node {@code loadQuote} — 견적 1건을 헤더 + 섹션(레거시) + 블록으로 읽는다. 상세(#28)와 저장·수정 응답(#26·#29)이 쓴다.
 *
 * <p>{@code domain.quote.QuoteRepository} 도 같은 SQL 로 견적을 읽지만 타입이 정해진 레코드라
 * {@code SELECT *} 의 모든 컬럼을 내지 못한다. API 응답은 Node 와 키까지 같아야 하므로 여기서는
 * 행을 Map 그대로 다룬다. 레코드 쪽은 계산·렌더(J7)가 쓴다.
 */
@Component
public class QuoteLoader {

    private final Rows db;

    public QuoteLoader(Rows db) {
        this.db = db;
    }

    /**
     * 정렬·묶는 방식이 Node 와 같아야 배열 순서가 같다.
     *
     * <p>품목·인건비는 <b>섹션 id 로만</b> 읽는다. 섹션이 없는 견적은 블록이 있어도 품목이 비어 나온다 —
     * Node 동작 그대로다.
     *
     * <p><b>이슈 #18 (Node 와 다른 유일한 곳, 명세 3장 C)</b> — 첫 섹션(블록형의 우산 섹션)의
     * {@code solution} · {@code brand} · {@code contract_months} 를 헤더에도 싣는다. 그래야 이 응답을
     * 그대로 {@code PUT} 해도 우산 섹션의 {@code solution}(NOT NULL) 이 비지 않는다.
     */
    public Map<String, Object> load(double id) {
        if (Double.isNaN(id)) return null; // Number('abc') — 어떤 견적과도 맞지 않는다
        Map<String, Object> quote = db.first("SELECT * FROM sq_quotes WHERE id = ?", Js.json(id));
        if (quote == null) return null;
        Object qid = quote.get("id");
        quote.put("conditions", db.safeJson(quote.get("conditions")));
        quote.put("pay_plan", db.safeJson(quote.get("pay_plan"))); // 견적별 결제 방안(V6) — 없으면 null
        if (quote.containsKey("source_mail")) quote.put("source_mail", db.safeJson(quote.get("source_mail"))); // 근거 메일(V14)
        List<Map<String, Object>> sections = db.query(
                "SELECT * FROM sq_quote_sections WHERE quote_id = ? ORDER BY sort, id", qid);
        if (!sections.isEmpty()) {
            Map<String, Object> umbrella = sections.get(0);
            for (String k : List.of("solution", "brand", "contract_months")) quote.putIfAbsent(k, umbrella.get(k));
        }
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
