package kr.co.sepoasoft.quote.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.time.LocalDate;
import java.time.ZoneOffset;

import org.springframework.beans.factory.ObjectProvider;
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
 * <p>Excel·PDF(#32·#33) — 견적서 HTML({@link QuoteHtml})을 Chrome 으로 인쇄한 PDF, 같은 양식의 Excel({@link QuoteExcel}).
 * 블록이 없는 구 섹션형 견적은 지원하지 않는다(400 LEGACY_QUOTE).
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
    private final QuoteHtml html;
    private final QuotePdf pdf;
    private final QuoteExcel excel;
    private final QuoteMailer mailer;
    private final ObjectProvider<SystemController> system; // 메일 발송 이력(V10 sq_quote_dispatch) — 없으면(단위 시험 등) 남기지 않는다

    public QuoteController(Rows db, QuoteLoader loader, QuoteCalc calc, QuoteWriter writer, QuoteHtml html,
            QuotePdf pdf, QuoteExcel excel, QuoteMailer mailer, ObjectProvider<SystemController> system) {
        this.db = db;
        this.loader = loader;
        this.calc = calc;
        this.writer = writer;
        this.html = html;
        this.pdf = pdf;
        this.excel = excel;
        this.mailer = mailer;
        this.system = system;
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

    /**
     * 견적 복사 — 같은 내용으로 새 견적을 만든다. 새 번호 · 작성중 · 견적일 오늘 · 유효일 +30일.
     * 단가는 원본 견적의 스냅샷을 그대로 쓴다(지금 가격정책으로 다시 계산하지 않는다).
     * 블록형만 된다 — 구 섹션형 견적은 위저드로 고칠 수 없어서 복사본도 쓸 데가 없다.
     */
    @PostMapping("/{id}/copy")
    public ResponseEntity<Map<String, Object>> copy(@PathVariable String id, HttpServletRequest req) {
        Map<String, Object> q = loader.load(Js.number(id));
        if (q == null) throw ApiException.notFound();
        List<Map<String, Object>> blocks = maps(q.get("blocks"));
        if (blocks.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "LEGACY_QUOTE", "구 견적(섹션형)은 복사할 수 없습니다.");
        }
        Map<String, Object> b = new LinkedHashMap<>();
        for (String k : List.of("quote_type", "deployment", "template_code", "solution", "brand",
                "customer_name", "customer_contact", "memo", "conditions", "pay_plan")) b.put(k, q.get(k));
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        b.put("quote_date", today.toString());
        b.put("valid_until", today.plusDays(30).toString());
        List<Object> outBlocks = new ArrayList<>();
        for (Map<String, Object> blk : blocks) {
            boolean isLabor = "LABOR".equals(blk.get("block_code"));
            Map<String, Object> ob = new LinkedHashMap<>();
            ob.put("block_code", blk.get("block_code"));
            ob.put("name", blk.get("title"));
            ob.put("recurring", Rows.truthy(blk.get("recurring")) ? 1 : 0);
            List<Object> items = new ArrayList<>();
            for (Map<String, Object> it : maps(blk.get("items"))) {
                Map<String, Object> o = new LinkedHashMap<>();
                for (String k : List.of("item_code", "category", "name", "spec", "qty", "unit", "months", "note",
                        "base_price", "proposed_price", "amount")) o.put(k, it.get(k));
                items.add(o);
            }
            List<Object> labor = new ArrayList<>();
            for (Map<String, Object> l : maps(blk.get("labor"))) {
                Map<String, Object> o = new LinkedHashMap<>();
                for (String k : List.of("role_code", "role_name", "role_label", "grade", "task", "mm", "month_alloc")) o.put(k, l.get(k));
                // 비-LABOR 블록의 인력은 공수 배분용이다 — 단가를 싣지 않는다(위저드 저장과 같은 규칙)
                if (isLabor) for (String k : List.of("base_price", "proposed_price", "amount")) o.put(k, l.get(k));
                labor.add(o);
            }
            // 빈 labor 배열을 함께 보내면 인건비 블록으로 오인된다 — 값이 있는 쪽만 싣는다
            if (!items.isEmpty()) ob.put("items", items);
            if (!labor.isEmpty()) ob.put("labor", labor);
            if (items.isEmpty() && labor.isEmpty()) ob.put("items", items);
            outBlocks.add(ob);
        }
        b.put("blocks", outBlocks);
        b.put("discount", dc(q.get("discount_type"), q.get("discount_value")));
        b.put("monthly_discount", dc(q.get("monthly_discount_type"), q.get("monthly_discount_value")));
        b.put("round_unit", q.get("round_unit"));
        Map<String, Object> result = calcFor(b, true);
        long newId = writer.create(b, result, true, AccessInterceptor.currentUser(req).id());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("quote", loader.load(newId)));
    }

    /** 저장된 특별DC → 계산 입력. 할인 없음은 type 이 null 로 남는다 */
    private static Map<String, Object> dc(Object type, Object value) {
        if (!Rows.truthy(type)) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", type);
        m.put("value", Js.json(Js.toNumber(value)));
        return m;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> maps(Object v) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (v instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> m) out.add((Map<String, Object>) m);
        return out;
    }

    /** 저장된 견적의 견적서 HTML — 상세 화면의 '견적서 보기'. PDF(#33)도 이 HTML 을 인쇄하게 된다 */
    @GetMapping("/{id}/html")
    public Map<String, Object> html(@PathVariable String id, @RequestParam(required = false) String cover) {
        Map<String, Object> q = loader.load(Js.number(id));
        if (q == null) throw ApiException.notFound();
        if (maps(q.get("blocks")).isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "LEGACY_QUOTE", "구 견적(섹션형)은 견적서 보기를 지원하지 않습니다.");
        }
        return Map.of("html", html.render(q, html.settings(), html.masters(q, null), !"0".equals(cover)));
    }

    /** #32 Excel — 견적서와 같은 양식. 금액 칸은 숫자라 엑셀에서 고쳐 쓸 수 있다 */
    @GetMapping("/{id}/excel")
    public ResponseEntity<byte[]> excel(@PathVariable String id) {
        Map<String, Object> q = blockQuote(id);
        byte[] body = excel.build(q, html.settings(), html.masters(q, null));
        return download(body, q, "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }

    /** #33 PDF — 견적서 보기와 같은 HTML 을 인쇄한다. {@code ?cover=0} 이면 표지를 뺀다 */
    @GetMapping("/{id}/pdf")
    public ResponseEntity<byte[]> pdf(@PathVariable String id, @RequestParam(required = false) String cover) {
        Map<String, Object> q = blockQuote(id);
        byte[] body = pdf.toPdf(html.render(q, html.settings(), html.masters(q, null), !"0".equals(cover)));
        return download(body, q, "pdf", "application/pdf");
    }

    /** 메일 발송 설정 — 화면이 시험 모드 · 허용 목록을 알리는 데 쓴다(비밀번호 · 계정은 내보내지 않는다) */
    @GetMapping("/mail-config")
    public Map<String, Object> mailConfig() {
        return mailer.info();
    }

    /**
     * 견적서 메일 발송 — PDF(표지 포함)를 붙이고, 원하면 Excel 도. 보낸 사람은 시스템 주소(MAIL_FROM),
     * 답장은 로그인한 담당자에게(Reply-To). 실제로 보냈으면 작성중 견적을 발송 상태로 바꾼다.
     * 시험 모드(MAIL_DRY_RUN)에서는 보내지 않고 상태도 그대로 둔다.
     */
    @PostMapping("/{id}/mail")
    public Map<String, Object> mail(@PathVariable String id, @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest req) {
        Map<String, Object> b = body == null ? Map.of() : body;
        List<String> to = QuoteMailer.split(b.get("to") == null ? "" : String.valueOf(b.get("to")));
        List<String> cc = QuoteMailer.split(b.get("cc") == null ? "" : String.valueOf(b.get("cc")));
        String subject = b.get("subject") == null ? "" : String.valueOf(b.get("subject")).trim();
        String text = b.get("body") == null ? "" : String.valueOf(b.get("body"));
        if (to.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "NO_RECIPIENT", "받는 사람을 입력하세요.");
        for (String a : concatList(to, cc)) {
            if (!QuoteMailer.validEmail(a)) throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_EMAIL", "메일 주소가 올바르지 않습니다: " + a);
        }
        if (subject.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "NO_SUBJECT", "제목을 입력하세요.");
        Map<String, Object> q = blockQuote(id);

        List<QuoteMailer.Attachment> files = new ArrayList<>();
        String base = attachName(q);
        Map<String, Object> masters = html.masters(q, null);
        if (!Boolean.FALSE.equals(b.get("attach_pdf"))) {
            files.add(new QuoteMailer.Attachment(base + ".pdf",
                    pdf.toPdf(html.render(q, html.settings(), masters, true)), "application/pdf"));
        }
        if (Boolean.TRUE.equals(b.get("attach_excel"))) {
            files.add(new QuoteMailer.Attachment(base + ".xlsx", excel.build(q, html.settings(), masters),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
        }
        var user = AccessInterceptor.currentUser(req);
        List<String> kinds = files.stream().map(f -> f.name().endsWith(".pdf") ? "PDF" : "Excel").toList();
        Long uid = user == null ? null : user.id();
        Map<String, Object> out;
        try {
            out = new LinkedHashMap<>(mailer.send(to, cc, subject, text, files,
                    user == null ? null : user.email(), user == null ? null : user.name()));
        } catch (RuntimeException e) {
            // 보내다 실패한 것도 발송 이력에 남긴다(허용 목록에 막힌 것 포함)
            system.ifAvailable(s -> s.logDispatch(q, to, cc, subject, kinds, "FAILED", e.getMessage(), uid));
            throw e;
        }
        String result = Boolean.TRUE.equals(out.get("dry_run")) ? "DRY_RUN" : "SENT";
        system.ifAvailable(s -> s.logDispatch(q, to, cc, subject, kinds, result, null, uid));
        Object status = q.get("status");
        if (Boolean.FALSE.equals(out.get("dry_run")) && "DRAFT".equals(status)) {
            db.update("UPDATE sq_quotes SET status = 'SENT' WHERE id = ? AND status = 'DRAFT'", q.get("id"));
            status = "SENT";
        }
        out.put("status", status);
        return out;
    }

    private static List<String> concatList(List<String> a, List<String> b) {
        List<String> out = new ArrayList<>(a);
        out.addAll(b);
        return out;
    }

    /** 첨부 이름 — 견적번호_고객사 (파일 이름에 못 쓰는 글자는 뺀다) */
    private static String attachName(Map<String, Object> q) {
        String no = String.valueOf(q.get("quote_no"));
        String cust = q.get("customer_name") == null ? "" : String.valueOf(q.get("customer_name")).replaceAll("[\\\\/:*?\"<>|]", "");
        return no + (cust.isBlank() ? "" : "_" + cust);
    }

    private Map<String, Object> blockQuote(String id) {
        Map<String, Object> q = loader.load(Js.number(id));
        if (q == null) throw ApiException.notFound();
        if (maps(q.get("blocks")).isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "LEGACY_QUOTE", "구 견적(섹션형)은 내려받기를 지원하지 않습니다.");
        }
        return q;
    }

    /** 파일 이름 — 견적번호_고객사.확장자. 한글 이름은 RFC 5987 filename* 로, 옛 브라우저용 filename 은 견적번호만 */
    private static ResponseEntity<byte[]> download(byte[] body, Map<String, Object> q, String ext, String type) {
        String no = String.valueOf(q.get("quote_no"));
        String cust = q.get("customer_name") == null ? "" : String.valueOf(q.get("customer_name")).replaceAll("[\\\\/:*?\"<>|]", "");
        String name = no + (cust.isBlank() ? "" : "_" + cust) + "." + ext;
        String encoded = java.net.URLEncoder.encode(name, java.nio.charset.StandardCharsets.UTF_8).replace("+", "%20");
        String ascii = no.replaceAll("[^A-Za-z0-9_.-]", "") + "." + ext;
        return ResponseEntity.ok()
                .header("Content-Type", type)
                .header("Content-Disposition", "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encoded)
                .body(body);
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
