package kr.co.sepoasoft.quote.web;

import static kr.co.sepoasoft.quote.web.QuoteCalc.asList;
import static kr.co.sepoasoft.quote.web.QuoteCalc.asMap;
import static kr.co.sepoasoft.quote.web.QuoteCalc.nn;
import static kr.co.sepoasoft.quote.web.QuoteCalc.or;
import static kr.co.sepoasoft.quote.web.QuoteCalc.truthy;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * 견적 저장 — Node {@code routes/quotes.js} 의 {@code persistQuote} · {@code insertSections} · {@code persistQuoteBlocks}
 * · {@code nextQuoteNo} 이식. SQL 과 넣는 값은 Node 그대로다.
 *
 * <p>메서드 하나가 트랜잭션 하나다 — Node 의 {@code beginTransaction} ~ {@code commit}. 예외가 나면 전부 되돌린다.
 * 견적번호 채번도 같은 트랜잭션 안에서 한다(되돌리면 번호도 되돌아간다 — Node 와 같다).
 */
@Component
public class QuoteWriter {

    static final List<String> STATUSES = List.of("DRAFT", "SENT", "WON", "LOST");

    private final Rows db;

    public QuoteWriter(Rows db) {
        this.db = db;
    }

    /** #26 새 견적. {@code header} 는 요청 본문에 {@code quote_date} 를 정해 넣은 것 */
    @Transactional
    public long create(Map<String, Object> header, Map<String, Object> calc, boolean blockMode, Object createdBy) {
        String quoteNo = nextQuoteNo(String.valueOf(header.get("quote_date")));
        return blockMode
                ? persistQuoteBlocks(header, calc, quoteNo, createdBy, null)
                : persistQuote(header, calc, quoteNo, createdBy);
    }

    /** #29 블록형 수정 — 헤더 갱신, 블록·섹션 지우고 다시 넣는다. quote_no·작성자는 그대로 */
    @Transactional
    public void updateBlocks(long id, Map<String, Object> header, Map<String, Object> calc) {
        persistQuoteBlocks(header, calc, null, null, id);
    }

    /** #29 섹션형 수정 — 섹션 삭제(CASCADE 로 품목 삭제) 후 재삽입 */
    @Transactional
    public void updateSections(long id, Map<String, Object> body, Object quoteDate, Map<String, Object> calc) {
        db.update("DELETE FROM sq_quote_sections WHERE quote_id = ?", id);
        db.update("UPDATE sq_quotes SET"
                + " quote_date = ?, valid_until = ?, customer_name = ?, customer_contact = ?,"
                + " discount_type = ?, discount_value = ?, supply_amount = ?, discount_amount = ?,"
                + " vat_amount = ?, total_amount = ?, status = COALESCE(?, status), memo = ?, conditions = ?"
                + " WHERE id = ?",
                quoteDate, body.get("valid_until"), body.get("customer_name"), body.get("customer_contact"),
                calc.get("discount_type"), nn(calc.get("discount_value"), 0), calc.get("supply_amount"),
                calc.get("discount_amount"), calc.get("vat_amount"), calc.get("total_amount"),
                validStatus(body.get("status"), null), body.get("memo"), conditions(body), id);
        insertSections(id, asList(calc.get("sections")));
    }

    // ── 채번 — Node domain/quote/numbering.js nextQuoteNo ────────────

    /**
     * {@code QT{YYYYMMDD}_{NNN}}. 카운터는 형식과 무관한 일자별 하나이며 되돌아가지 않는다.
     * 행 잠금으로 동시 채번 중복을 막는다(INSERT … ON DUPLICATE KEY UPDATE).
     */
    String nextQuoteNo(String quoteDate) {
        String date = quoteDate.length() > 10 ? quoteDate.substring(0, 10) : quoteDate;
        db.update("INSERT INTO sq_quote_seq (seq_date, last_no) VALUES (?, 1)"
                + " ON DUPLICATE KEY UPDATE last_no = last_no + 1", date);
        Object last = db.first("SELECT last_no FROM sq_quote_seq WHERE seq_date = ?", date).get("last_no");
        String seq = String.valueOf(last);
        return "QT" + date.replace("-", "") + "_" + "0".repeat(Math.max(0, 3 - seq.length())) + seq;
    }

    // ── 블록형 — persistQuoteBlocks ──────────────────────────────────

    private long persistQuoteBlocks(Map<String, Object> header, Map<String, Object> calc, String quoteNo,
            Object createdBy, Long quoteId) {
        Map<String, Object> cols = new LinkedHashMap<>();
        cols.put("quote_type", or(header.get("quote_type"), "BUILD"));
        cols.put("deployment", header.get("deployment"));
        cols.put("template_code", header.get("template_code"));
        cols.put("quote_date", header.get("quote_date"));
        cols.put("valid_until", header.get("valid_until"));
        cols.put("customer_name", header.get("customer_name"));
        cols.put("customer_contact", header.get("customer_contact"));
        cols.put("discount_type", calc.get("discount_type"));
        cols.put("discount_value", nn(calc.get("discount_value"), 0));
        cols.put("round_unit", nn(calc.get("round_unit"), 100000));
        cols.put("monthly_discount_type", calc.get("monthly_discount_type"));
        cols.put("monthly_discount_value", nn(calc.get("monthly_discount_value"), 0));
        cols.put("supply_amount", calc.get("supply_amount"));
        cols.put("discount_amount", calc.get("discount_amount"));
        cols.put("vat_amount", calc.get("vat_amount"));
        cols.put("total_amount", calc.get("total_amount"));
        cols.put("onetime_total", calc.get("onetime_total"));
        cols.put("monthly_total", calc.get("monthly_total"));
        cols.put("memo", header.get("memo"));
        cols.put("conditions", conditions(header));
        // 견적별 결제 방안(V6) — {enabled, ratio, rows}. 보내지 않으면 NULL = 템플릿 설정 · 기본 문구
        cols.put("pay_plan", header.get("pay_plan") instanceof Map<?, ?> pp ? db.stringify(pp) : null);

        long id;
        if (quoteId != null) {
            id = quoteId;
            List<String> sets = new ArrayList<>();
            for (String k : cols.keySet()) sets.add("`" + k + "` = ?");
            List<Object> vals = new ArrayList<>(cols.values());
            vals.add(validStatus(header.get("status"), null));
            vals.add(id);
            db.update("UPDATE sq_quotes SET " + String.join(", ", sets) + ", status = COALESCE(?, status) WHERE id = ?",
                    vals.toArray());
            db.update("DELETE FROM sq_quote_blocks WHERE quote_id = ?", id);
            db.update("DELETE FROM sq_quote_sections WHERE quote_id = ?", id);
        } else {
            List<String> keys = new ArrayList<>();
            keys.add("quote_no");
            keys.addAll(cols.keySet());
            keys.add("status");
            keys.add("created_by");
            List<Object> vals = new ArrayList<>();
            vals.add(quoteNo);
            vals.addAll(cols.values());
            vals.add(validStatus(header.get("status"), "DRAFT"));
            vals.add(createdBy);
            id = db.insert("INSERT INTO sq_quotes (" + String.join(", ", keys.stream().map(k -> "`" + k + "`").toList())
                    + ") VALUES (" + Rows.placeholders(keys.size()).replace(",", ", ") + ")", vals.toArray());
        }

        // 레거시 호환 우산 섹션(Excel/PDF 경로가 sections 를 읽는다)
        long sectionId = db.insert(
                "INSERT INTO sq_quote_sections (quote_id, solution, template_code, brand, deployment, contract_months, subtotal, sort)"
                        + " VALUES (?,?,?,?,?,?,?,0)",
                id, header.get("solution"), header.get("template_code"), header.get("brand"),
                header.get("deployment"), nn(header.get("contract_months"), 1),
                Js.json(Js.toNumber(calc.get("onetime_subtotal")) + Js.toNumber(calc.get("monthly_subtotal"))));

        List<Object> blocks = asList(calc.get("blocks"));
        for (int bi = 0; bi < blocks.size(); bi++) {
            Map<String, Object> b = asMap(blocks.get(bi));
            long blockId = db.insert(
                    "INSERT INTO sq_quote_blocks (quote_id, section_id, block_code, title, subtotal, recurring, sort)"
                            + " VALUES (?,?,?,?,?,?,?)",
                    id, sectionId, b.get("block_code"), nn(b.get("name"), b.get("title")), b.get("subtotal"),
                    truthy(b.get("recurring")) ? 1 : 0, bi);
            List<Object> items = asList(b.get("items"));
            for (int i = 0; i < items.size(); i++) {
                Map<String, Object> it = asMap(items.get(i));
                Object proposed = Js.json(Js.round(Js.or(Js.toNumber(it.get("proposed_price")), 0)));
                db.update("INSERT INTO sq_quote_items"
                        + " (section_id, block_id, item_code, block_code, category, name, spec, qty, unit, months,"
                        + " unit_price, base_price, proposed_price, amount, note, sort)"
                        + " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        sectionId, blockId, it.get("item_code"), b.get("block_code"), it.get("category"), it.get("name"),
                        it.get("spec"), nn(it.get("qty"), 1), it.get("unit"), nn(it.get("months"), 1),
                        proposed, rounded(it.get("base_price")), proposed, nn(it.get("amount"), 0), it.get("note"), i);
            }
            List<Object> labor = asList(b.get("labor"));
            for (int li = 0; li < labor.size(); li++) {
                Map<String, Object> l = asMap(labor.get(li));
                db.update("INSERT INTO sq_quote_labor"
                        + " (section_id, block_id, role_code, role_name, role_label, grade, task, mm,"
                        + " base_price, proposed_price, amount, month_alloc, sort)"
                        + " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        sectionId, blockId, l.get("role_code"), l.get("role_name"), l.get("role_label"), l.get("grade"),
                        l.get("task"), nn(l.get("mm"), 0), rounded(l.get("base_price")), rounded(l.get("proposed_price")),
                        nn(l.get("amount"), 0), monthAlloc(l.get("month_alloc")), li);
            }
        }
        return id;
    }

    // ── 섹션형 — persistQuote · insertSections ──────────────────────

    private long persistQuote(Map<String, Object> header, Map<String, Object> calc, String quoteNo, Object createdBy) {
        long quoteId = db.insert("INSERT INTO sq_quotes"
                + " (quote_no, quote_date, valid_until, customer_name, customer_contact,"
                + " discount_type, discount_value, supply_amount, discount_amount, vat_amount, total_amount,"
                + " status, memo, conditions, created_by)"
                + " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                quoteNo, header.get("quote_date"), header.get("valid_until"),
                header.get("customer_name"), header.get("customer_contact"),
                calc.get("discount_type"), nn(calc.get("discount_value"), 0),
                calc.get("supply_amount"), calc.get("discount_amount"), calc.get("vat_amount"), calc.get("total_amount"),
                validStatus(header.get("status"), "DRAFT"), header.get("memo"), conditions(header), createdBy);
        insertSections(quoteId, asList(calc.get("sections")));
        return quoteId;
    }

    private void insertSections(long quoteId, List<Object> sections) {
        for (int si = 0; si < sections.size(); si++) {
            Map<String, Object> sec = asMap(sections.get(si));
            long sectionId = db.insert("INSERT INTO sq_quote_sections"
                    + " (quote_id, solution, template_code, brand, deployment, company_class, contract_months, params, subtotal, sort)"
                    + " VALUES (?,?,?,?,?,?,?,?,?,?)",
                    quoteId, sec.get("solution"), sec.get("template_code"), sec.get("brand"), sec.get("deployment"),
                    nn(sec.get("companyClass"), sec.get("company_class")), nn(sec.get("contract_months"), 1),
                    truthy(sec.get("params")) ? db.stringify(sec.get("params")) : null, sec.get("subtotal"), si);
            List<Object> items = asList(sec.get("items"));
            for (int ii = 0; ii < items.size(); ii++) {
                Map<String, Object> it = asMap(items.get(ii));
                // 2단가: proposed_price(제안단가)를 unit_price 와 함께 저장(unit_price=제안단가로 의미 이관)
                Object proposed = it.get("proposed_price") != null ? rounded(it.get("proposed_price"))
                        : it.get("unit_price") != null ? rounded(it.get("unit_price")) : null;
                db.update("INSERT INTO sq_quote_items"
                        + " (section_id, item_code, block_code, category, name, spec, qty, unit, months, unit_price, base_price, proposed_price, amount, note, sort)"
                        + " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        sectionId, it.get("item_code"), it.get("block_code"), it.get("category"), it.get("name"),
                        it.get("spec"), nn(it.get("qty"), 1), it.get("unit"), nn(it.get("months"), 1), nn(proposed, 0),
                        rounded(it.get("base_price")), proposed, nn(it.get("amount"), 0), it.get("note"), ii);
            }
            // 인건비(LABOR) 블록 라인 스냅샷
            List<Object> labor = asList(sec.get("labor"));
            for (int li = 0; li < labor.size(); li++) {
                Map<String, Object> l = asMap(labor.get(li));
                db.update("INSERT INTO sq_quote_labor"
                        + " (section_id, role_code, role_name, task, mm, base_price, proposed_price, amount, sort)"
                        + " VALUES (?,?,?,?,?,?,?,?,?)",
                        sectionId, l.get("role_code"), l.get("role_name"), l.get("task"), nn(l.get("mm"), 0),
                        rounded(l.get("base_price")), rounded(l.get("proposed_price")), nn(l.get("amount"), 0), li);
            }
        }
    }

    // ── 값 규칙 ─────────────────────────────────────────────────────

    /** {@code v != null ? Math.round(Number(v)) : null} */
    private static Object rounded(Object v) {
        return v == null ? null : Js.json(Js.round(Js.toNumber(v)));
    }

    /** {@code header.status && STATUSES.includes(header.status) ? header.status : fallback} */
    static Object validStatus(Object status, Object fallback) {
        return status instanceof String s && STATUSES.contains(s) ? s : fallback;
    }

    /** {@code Array.isArray(h.conditions) ? JSON.stringify(h.conditions) : null} */
    private String conditions(Map<String, Object> h) {
        return h.get("conditions") instanceof List<?> l ? db.stringify(l) : null;
    }

    /** {@code l.month_alloc && Object.keys(l.month_alloc).length ? JSON.stringify(l.month_alloc) : null} */
    private String monthAlloc(Object v) {
        boolean hasKeys = v instanceof Map<?, ?> m ? !m.isEmpty()
                : v instanceof List<?> l ? !l.isEmpty()
                : v instanceof String s && !s.isEmpty(); // 문자열도 글자 인덱스가 키다 — Node 는 따옴표째 다시 감싼다
        return hasKeys ? db.stringify(v) : null;
    }
}
