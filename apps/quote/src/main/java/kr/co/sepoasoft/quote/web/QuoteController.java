package kr.co.sepoasoft.quote.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.time.LocalDate;
import java.time.ZoneOffset;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.auth.AccessInterceptor;
import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * {@code /api/quotes} — Node {@code routes/quotes.js} 이식. 명세 2-6절 (#26~#33).
 * 계산 창구(#23~#25)는 {@link QuoteCalcController}, 견적 읽기는 {@link QuoteLoader}.
 *
 * <p>Excel·PDF(#32·#33) 는 렌더러(J7) 전까지 {@code 501 NOT_IMPLEMENTED} 다(명세 3장 F).
 */
@RestController
@RequestMapping("/api/quotes")
@Access(Level.LOGIN)
public class QuoteController {

    private static final List<String> STATUSES = QuoteWriter.STATUSES;

    private final Rows db;
    private final QuoteLoader loader;
    private final QuoteCalc calc;
    private final QuoteWriter writer;

    public QuoteController(Rows db, QuoteLoader loader, QuoteCalc calc, QuoteWriter writer) {
        this.db = db;
        this.loader = loader;
        this.calc = calc;
        this.writer = writer;
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
        Map<String, Object> quote = loader.load(Js.number(id));
        if (quote == null) throw ApiException.notFound();
        return Map.of("quote", quote);
    }

    /** #26 생성 — 블록형({@code blocks}) 또는 레거시 섹션형({@code sections}). 견적번호를 채번한다 */
    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest req) {
        Map<String, Object> b = body == null ? Map.of() : body;
        boolean blockMode = isBlocksBody(b);
        requireBlocksOrSections(b, blockMode);
        Map<String, Object> result = calcFor(b, blockMode);
        String quoteDate = Rows.truthy(b.get("quote_date")) ? date10(b.get("quote_date"))
                : LocalDate.now(ZoneOffset.UTC).toString(); // Node: new Date().toISOString() — UTC 날짜
        Map<String, Object> header = new LinkedHashMap<>(b);
        header.put("quote_date", quoteDate);
        long id = writer.create(header, result, blockMode, AccessInterceptor.currentUser(req).id());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("quote", loader.load(id)));
    }

    /** #29 수정 — 섹션/블록 전체 교체 + 재계산, quote_no 유지 */
    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        boolean blockMode = isBlocksBody(b);
        requireBlocksOrSections(b, blockMode);
        double n = Js.number(id);
        Map<String, Object> existing = Double.isNaN(n) ? null
                : db.first("SELECT id, quote_date FROM sq_quotes WHERE id = ?", Js.json(n));
        if (existing == null) throw ApiException.notFound();
        long qid = ((Number) existing.get("id")).longValue();
        Map<String, Object> result = calcFor(b, blockMode);
        Object quoteDate = Rows.truthy(b.get("quote_date")) ? date10(b.get("quote_date")) : existing.get("quote_date");
        if (blockMode) {
            Map<String, Object> header = new LinkedHashMap<>(b);
            header.put("quote_date", quoteDate);
            writer.updateBlocks(qid, header, result);
        } else {
            writer.updateSections(qid, b, quoteDate, result);
        }
        return Map.of("quote", loader.load(qid));
    }

    /** #30 상태 변경 */
    @PatchMapping("/{id}/status")
    public Map<String, Object> status(@PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Object status = body == null ? null : body.get("status");
        if (!(status instanceof String s) || !STATUSES.contains(s)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_STATUS",
                    "status는 " + String.join("/", STATUSES) + " 중 하나여야 합니다.");
        }
        double n = Js.number(id);
        int r = Double.isNaN(n) ? 0 : db.update("UPDATE sq_quotes SET status = ? WHERE id = ?", status, Js.json(n));
        if (r == 0) throw ApiException.notFound();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("status", status);
        return out;
    }

    /** #31 삭제 — 섹션·블록·품목·인건비는 FK CASCADE 로 함께 지워진다 */
    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable String id) {
        double n = Js.number(id);
        int r = Double.isNaN(n) ? 0 : db.update("DELETE FROM sq_quotes WHERE id = ?", Js.json(n));
        if (r == 0) throw ApiException.notFound();
        return Map.of("ok", true);
    }

    /** #32 Excel — J7 */
    @GetMapping("/{id}/excel")
    public Map<String, Object> excel(@PathVariable String id) {
        return notYet(id, "Excel");
    }

    /** #33 PDF — J7 */
    @GetMapping("/{id}/pdf")
    public Map<String, Object> pdf(@PathVariable String id) {
        return notYet(id, "PDF");
    }

    private Map<String, Object> notYet(String id, String what) {
        if (loader.load(Js.number(id)) == null) throw ApiException.notFound();
        throw new ApiException(HttpStatus.NOT_IMPLEMENTED, "NOT_IMPLEMENTED", what + " 출력은 Java 이식 J7 에서 연결됩니다.");
    }

    // ── 공통 ───────────────────────────────────────────────────────

    /** Node {@code isBlocksBody} — blocks 가 비어 있지 않은 배열 */
    private static boolean isBlocksBody(Map<String, Object> b) {
        return b.get("blocks") instanceof List<?> l && !l.isEmpty();
    }

    private static void requireBlocksOrSections(Map<String, Object> b, boolean blockMode) {
        if (!blockMode && !(b.get("sections") instanceof List<?> l && !l.isEmpty())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "NO_SECTIONS", "최소 1개 섹션 또는 블록이 필요합니다.");
        }
    }

    private Map<String, Object> calcFor(Map<String, Object> b, boolean blockMode) {
        return blockMode
                ? calc.calcBlocks((List<?>) b.get("blocks"), b.get("discount"), b.get("monthly_discount"), b.get("round_unit"))
                : calc.calcSections((List<?>) b.get("sections"), b.get("discount"));
    }

    /** {@code String(v).slice(0, 10)} */
    private static String date10(Object v) {
        String s = v instanceof Number n ? String.valueOf(Js.json(n.doubleValue())) : String.valueOf(v);
        return s.length() > 10 ? s.substring(0, 10) : s;
    }
}
