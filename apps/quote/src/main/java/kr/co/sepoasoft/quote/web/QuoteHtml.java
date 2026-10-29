package kr.co.sepoasoft.quote.web;

import java.io.IOException;
import java.io.InputStream;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * 견적서 HTML 렌더러 (J7 1차) — Node {@code src/domain/render/html.js} 의 블록형 경로 이식.
 * 미리보기(#25)·템플릿 미리보기가 쓰고, PDF(#33)도 같은 HTML 을 인쇄하게 된다.
 *
 * <p>레이아웃·문구·CSS 는 Node 원문을 그대로 옮겼다. 화면과 PDF 가 어긋나지 않도록 렌더러는 하나만 둔다.
 * 레거시 섹션형 본문(블록 없는 견적)은 아직 옮기지 않았다 — 그런 견적은 미리보기 대상이 아니다.
 *
 * <p>{@code masters} 는 Node {@code buildMasters} 의 블록형에 필요한 부분이다:
 * 임금단가표(부록) · 견적조건 · 건수 밴드표 · 블록 정의.
 */
@Component
public class QuoteHtml {

    private final Rows db;

    public QuoteHtml(Rows db) {
        this.db = db;
    }

    // ── 렌더 재료 ─────────────────────────────────────────────────

    /** {@code sq_settings} 전량 — Node {@code loadSettings} */
    public Map<String, Object> settings() {
        Map<String, Object> m = new LinkedHashMap<>();
        for (Map<String, Object> r : db.query("SELECT `key`, value FROM sq_settings")) m.put(String.valueOf(r.get("key")), r.get("value"));
        return m;
    }

    /**
     * Node {@code buildMasters} 의 블록형 부분.
     *
     * @param conditionSet 견적조건 세트를 직접 지정한다(템플릿 화면 — 저장 전 값). null 이면 템플릿 코드로 찾는다.
     */
    public Map<String, Object> masters(Map<String, Object> quote, Object conditionSet) {
        Map<String, Object> m = new LinkedHashMap<>();
        // 임금단가표 — 견적일 연도 우선, 없으면 active 연도
        String qd = str(quote.get("quote_date"));
        Integer wantYear = qd.length() >= 4 && qd.substring(0, 4).matches("\\d{4}") ? Integer.valueOf(qd.substring(0, 4)) : null;
        Map<String, Object> yr = wantYear == null ? null : db.first("SELECT * FROM sq_labor_rate_years WHERE `year` = ?", wantYear);
        if (yr == null) yr = db.first("SELECT * FROM sq_labor_rate_years WHERE active = 1 LIMIT 1");
        if (yr != null) {
            m.put("laborRateYear", yr.get("year"));
            m.put("laborRateSource", yr.get("source"));
            m.put("laborRates", db.query("SELECT role_code, role_name, grade, wage_md, wage_mm, overhead, tech_fee, apply_price, note"
                    + " FROM sq_labor_rate_lines WHERE year_id = ? ORDER BY sort, id", yr.get("id")));
        }
        // 견적조건 — 저장된 conditions 가 없을 때 쓴다
        Object set = conditionSet;
        if (!Rows.truthy(set) && Rows.truthy(quote.get("template_code"))) {
            Map<String, Object> tpl = db.first("SELECT condition_set FROM sq_quote_templates WHERE code = ?", quote.get("template_code"));
            set = tpl == null ? null : tpl.get("condition_set");
        }
        if (Rows.truthy(set)) {
            List<Object> lines = new ArrayList<>();
            for (Map<String, Object> r : db.query("SELECT `text` FROM sq_condition_lines WHERE set_code = ? ORDER BY line_no", set)) lines.add(r.get("text"));
            m.put("conditionLines", lines);
        }
        // 건수 밴드표 — 견적에 담긴 모듈 중 밴드가 있는 것만
        Set<Object> codes = new LinkedHashSet<>();
        for (Map<String, Object> b : maps(quote.get("blocks"))) for (Map<String, Object> it : maps(b.get("items"))) {
            if (Rows.truthy(it.get("item_code"))) codes.add(it.get("item_code"));
        }
        if (!codes.isEmpty()) {
            Map<String, List<Map<String, Object>>> bands = new LinkedHashMap<>();
            for (Map<String, Object> r : db.query("SELECT p.code, v.label, v.min_qty, v.max_qty, v.price"
                    + " FROM sq_price_variants v JOIN sq_price_items p ON p.id = v.item_id"
                    + " WHERE p.code IN (" + Rows.placeholders(codes.size()) + ") ORDER BY v.sort", codes.toArray())) {
                bands.computeIfAbsent(String.valueOf(r.get("code")), k -> new ArrayList<>()).add(r);
            }
            m.put("bands", bands);
        }
        // 블록 정의
        Map<String, Object> defs = new LinkedHashMap<>();
        for (Map<String, Object> b : db.query("SELECT code, name, `columns`, recurring, has_subtotal, sort FROM sq_blocks ORDER BY sort")) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("name", b.get("name"));
            Object cols = db.parseCols(b.get("columns"));
            d.put("columns", cols instanceof List<?> ? cols : List.of());
            defs.put(String.valueOf(b.get("code")), d);
        }
        m.put("blockDefs", defs);
        return m;
    }

    // ── 렌더 ─────────────────────────────────────────────────────

    /** Node {@code renderQuoteHtml} — 블록형. {@code withCover=false} 면 표지를 생략한다 */
    public String render(Map<String, Object> quote, Map<String, Object> settings, Map<String, Object> masters, boolean withCover) {
        String memo = str(quote.get("memo"));
        String purpose = tag(memo, "견적용도");
        String payTerms = tag(memo, "결제조건");
        if (payTerms.isEmpty()) payTerms = "고객사 결제조건";

        String logo = dataUri("logo.png"), seal = dataUri("seal.png"), bandTop = dataUri("band_top.png"), bandBot = dataUri("band_bottom.png");
        String supplier = or(settings.get("supplier_name"), "㈜세포아소프트");
        String ceo = or(settings.get("supplier_ceo"), "이 희 림");
        String addr = or(settings.get("supplier_addr"), "서울특별시 구로구 디지털로31길 62, 아티스포럼 714~717호");

        // 견적조건: 저장값 → 템플릿의 condition_set(마스터) → 일반 문구
        List<String> conds = new ArrayList<>();
        for (Object c : list(quote.get("conditions"))) {
            Object t = c instanceof Map<?, ?> cm ? cm.get("text") : c;
            if (Rows.truthy(t)) conds.add(String.valueOf(t));
        }
        if (conds.isEmpty()) for (Object c : list(masters.get("conditionLines"))) conds.add(String.valueOf(c));
        if (conds.isEmpty()) {
            conds.add("프로젝트 투입공수 및 일정은 세부 업무요건에 따라 변경될 수 있습니다.");
            conds.add("개발단가는 한국SW산업협회 노임 단가 기준 100%를 적용하였습니다.");
            conds.add("솔루션 유지보수는 시스템 오픈 후 12개월간 무상유지보수 이후 진행되며, 유상유지보수는 솔루션 공급가의 15%로 제안합니다.");
            conds.add("본 프로젝트는 상주로 진행합니다.");
        }

        List<Map<String, Object>> blocks = maps(quote.get("blocks"));
        double onetimeSub = 0, monthlySub = 0;
        for (Map<String, Object> b : blocks) {
            if (Rows.truthy(b.get("recurring"))) monthlySub += num(b.get("subtotal"));
            else onetimeSub += num(b.get("subtotal"));
        }
        double onetimeTotal = num(quote.get("onetime_total"));
        double monthlyTotal = num(quote.get("monthly_total"));
        double onetimeDc = onetimeSub - onetimeTotal;
        double monthlyDc = monthlySub - monthlyTotal;
        double vat = num(quote.get("vat_amount"));

        @SuppressWarnings("unchecked")
        Map<String, Object> blockDefs = masters.get("blockDefs") instanceof Map<?, ?> d ? (Map<String, Object>) d : Map.of();
        StringBuilder body = new StringBuilder();
        for (Map<String, Object> b : blocks) {
            if (body.length() > 0) body.append('\n');
            body.append(blockTable(b, blockDefs));
        }

        // 합계: 일시불(소계합→특별DC→절사) / 월(소계→특별DC) 분리
        String totals = "<table class=\"tot\">"
                + "\n      <tr><td class=\"r\">일시납 합계</td><td class=\"r b\" style=\"width:150px\">" + won(onetimeSub) + "</td></tr>"
                + "\n      " + (onetimeDc > 0 ? "<tr><td class=\"r\">특별 DC</td><td class=\"r\">-" + won(onetimeDc) + "</td></tr>" : "")
                + "\n      <tr><td class=\"r b\">최종견적금액 (특별DC 적용)</td><td class=\"r b\">" + freeText(onetimeTotal) + "</td></tr>"
                + "\n      <tr><td class=\"r\">부가세 (별도, 10%)</td><td class=\"r\">" + won(vat) + "</td></tr>"
                + "\n      " + (monthlySub != 0
                        ? "<tr><td class=\"r\" style=\"padding-top:8px\">월 사용료 소계</td><td class=\"r b\" style=\"padding-top:8px\">" + won(monthlySub) + "</td></tr>"
                                + "\n      " + (monthlyDc > 0 ? "<tr><td class=\"r\">월 특별 DC</td><td class=\"r\">-" + won(monthlyDc) + "</td></tr>" : "")
                                + "\n      <tr><td class=\"r b\">월 사용료 (특별DC 적용)</td><td class=\"r b\">" + won(monthlyTotal) + "</td></tr>"
                        : "")
                + "\n      <tr><td class=\"r grand\">총 견적가" + (monthlySub != 0 ? " (일시납)" : "") + "</td><td class=\"r grand\">"
                + freeText(onetimeTotal) + (onetimeTotal != 0 ? " 원" : "") + "</td></tr>"
                + "\n      " + (monthlySub != 0 ? "<tr><td class=\"r grand\">총 견적가 (월)</td><td class=\"r grand\">" + won(monthlyTotal) + " 원</td></tr>" : "")
                + "\n      </table>"
                + "\n      <div class=\"muted\" style=\"margin-top:4px\">※ 부가세 별도"
                + (num(quote.get("round_unit")) > 0 ? " · " + won(num(quote.get("round_unit"))) + "단위 절사 적용" : "") + "</div>";

        String appendix = appendix(quote, masters);

        // 상단 총견적가 — SaaS/PCloud 는 셋업비용과 월사용료를 두 줄로 나눠 표기한다
        String right = "<td class=\"lbl\">상 호</td><td colspan=\"2\" class=\"c b\">" + esc(supplier) + "</td>";
        String oneTxt = onetimeTotal == 0 ? "무상제공" : "₩" + won(onetimeTotal);
        boolean sealOnGrandRow = monthlyTotal != 0;
        String sealImg = seal != null ? "<img src=\"" + seal + "\">" : "";
        String grandRows = !sealOnGrandRow
                ? "<tr><td class=\"lbl\">총견적가</td><td colspan=\"2\" class=\"r b\">" + oneTxt + "</td>" + right + "</tr>"
                : "<tr><td class=\"lbl\">총견적가</td><td colspan=\"2\" class=\"r b\">" + oneTxt + " <span class=\"u\">셋업비용(부가세 별도)</span></td>" + right + "</tr>"
                        + "<tr><td class=\"lbl\"></td><td colspan=\"2\" class=\"r b\">₩" + won(monthlyTotal) + " <span class=\"u\">월사용료(부가세 별도)</span></td><td class=\"lbl\">대표이사</td>"
                        + "<td colspan=\"2\" class=\"c b seal\">" + esc(ceo) + " (인)" + sealImg + "</td></tr>";

        String bandFallbackTop = "<div style=\"background:#A6CE39\"></div><div style=\"background:#F5C400\"></div><div style=\"background:#EC008C\"></div><div style=\"background:#404040;flex:5\"></div>";
        String bandFallbackBot = "<div style=\"background:#404040;flex:5\"></div><div style=\"background:#EC008C\"></div><div style=\"background:#F5C400\"></div><div style=\"background:#A6CE39\"></div>";
        String customer = str(quote.get("customer_name"));

        String cover = withCover
                ? "<div class=\"page cover\">\n  <div class=\"band\">" + (bandTop != null ? "<img src=\"" + bandTop + "\">" : bandFallbackTop) + "</div>"
                        + "\n  <div class=\"cover-body\">"
                        + "\n    <h1>" + esc(!purpose.isEmpty() ? purpose : (customer.isEmpty() ? "" : customer + " ") + "시스템 구축") + "</h1>"
                        + "\n    <div class=\"sub\">가 격 제 안 서</div>"
                        + "\n    " + (logo != null ? "<img class=\"logo\" src=\"" + logo + "\">" : "<div style=\"font-size:16px;font-weight:700;color:#7AA324\">" + esc(supplier) + "</div>")
                        + "\n    <div class=\"cust-box\">"
                        + "\n      <div>고객사 : " + esc(customer) + "</div>"
                        + "\n      <div>담당자 : " + esc(str(quote.get("customer_contact"))) + "</div>"
                        + "\n      <div>연락처 : " + esc(tag(memo, "연락처")) + "</div>"
                        + "\n      <div>이메일 : " + esc(tag(memo, "이메일")) + "</div>"
                        + "\n    </div>\n  </div>"
                        + "\n  <div class=\"band\">" + (bandBot != null ? "<img src=\"" + bandBot + "\">" : bandFallbackBot) + "</div>\n</div>"
                : "<!-- 커버 생략(withCover=false) — 외부에서 제작한 커버 PDF 를 앞에 병합하세요 -->";

        StringBuilder condHtml = new StringBuilder();
        for (String c : conds) condHtml.append("<div>-. ").append(esc(c)).append("</div>");

        return "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><style>\n" + CSS + "</style></head><body>\n\n"
                + cover + "\n\n<div class=\"page\">"
                + "\n  <div class=\"addr\">" + esc(addr) + "　☎ 02-6242-3094</div>"
                + "\n  <h2 class=\"qt\">Quotation</h2>"
                + "\n  <table class=\"hdrbox\">"
                + "\n    <tr><td class=\"lbl\">수 신</td><td colspan=\"2\">" + esc(customer.isEmpty() ? "" : customer + " 귀중")
                + "</td><td class=\"lbl\">견적번호</td><td colspan=\"2\">" + esc(str(quote.get("quote_no"))) + "</td></tr>"
                + "\n    <tr><td class=\"lbl\">견적용도</td><td colspan=\"2\">" + esc(purpose) + "</td><td class=\"lbl\">견적일자</td><td colspan=\"2\">"
                + fmtDate(quote.get("quote_date")) + "</td></tr>"
                + "\n    <tr><td class=\"lbl\">결제조건</td><td colspan=\"2\">" + esc(payTerms) + "</td><td class=\"lbl\">견적유효일</td><td colspan=\"2\">"
                + (Rows.truthy(quote.get("valid_until")) ? fmtDate(quote.get("valid_until")) : "견적일로부터 30일") + "</td></tr>"
                + "\n    " + grandRows
                + "\n    <tr><td class=\"lbl\">설치완료</td><td colspan=\"2\">협의된 프로젝트 기간</td>" + (sealOnGrandRow
                        ? "<td class=\"lbl\"></td><td colspan=\"2\"></td>"
                        : "<td class=\"lbl\">대표이사</td><td colspan=\"2\" class=\"c seal\">" + esc(ceo) + " (인)" + sealImg + "</td>") + "</tr>"
                + "\n  </table>"
                + "\n  <div class=\"note\">하기와 같이 견적하오니 참조 바랍니다.<span class=\"u\">(단위: 원, 부가세 별도)</span></div>"
                + "\n\n  " + body
                + "\n\n  " + totals
                + "\n\n  <div class=\"sec\">▣ 견적조건</div>"
                + "\n  <div class=\"conds\">" + condHtml + "</div>"
                + "\n\n  " + appendix
                + "\n</div>\n\n</body></html>";
    }

    /** 블록 1개 — 같은 '구분'(category) 이 연속되는 행은 rowspan 으로 묶는다 */
    private String blockTable(Map<String, Object> b, Map<String, Object> blockDefs) {
        String code = str(b.get("block_code"));
        Map<?, ?> def = blockDefs.get(code) instanceof Map<?, ?> d ? d : Map.of();
        boolean isLabor = "LABOR".equals(code);
        String title = firstNonEmpty(b.get("title"), def.get("name"), code);
        boolean recurring = Rows.truthy(b.get("recurring"));
        // 7열=구분·모듈·세부기능·… / 6열=구분·세부기능·… (6열은 모듈명과 세부기능을 한 칸에)
        boolean wide = list(def.get("columns")).size() >= 7 || isLabor;

        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> it : maps(b.get("items"))) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("gubun", firstNonEmpty(it.get("category"), title));
            r.put("name", str(it.get("name")));
            r.put("spec", str(it.get("spec")));
            r.put("qty", num(it.get("qty")));
            r.put("unit", str(it.get("unit")));
            r.put("base", it.get("base_price"));
            r.put("proposed", it.get("proposed_price") != null ? it.get("proposed_price") : it.get("unit_price"));
            r.put("amount", num(it.get("amount")));
            rows.add(r);
        }
        // 금액표에는 LABOR 블록만 인건비 행을 싣는다(비-LABOR 의 labor 는 인력투입계획 부록용 공수 배분)
        if (isLabor) for (Map<String, Object> l : maps(b.get("labor"))) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("gubun", firstNonEmpty(l.get("category"), "개발인건비"));
            r.put("name", firstNonEmpty(l.get("role_label"), l.get("role_name"), l.get("role_code"))
                    + (Rows.truthy(l.get("grade")) ? " (" + l.get("grade") + ")" : ""));
            r.put("spec", str(l.get("task")));
            r.put("qty", num(l.get("mm")));
            r.put("unit", "MM");
            r.put("base", l.get("base_price"));
            r.put("proposed", l.get("proposed_price"));
            r.put("amount", num(l.get("amount")));
            r.put("isLabor", true);
            rows.add(r);
        }
        int[] spans = new int[rows.size()];
        for (int i = 0; i < rows.size(); ) {
            int j = i;
            while (j + 1 < rows.size() && rows.get(j + 1).get("gubun").equals(rows.get(i).get("gubun"))) j++;
            spans[i] = j - i + 1;
            i = j + 1;
        }
        int nCols = wide ? 7 : 6;
        StringBuilder body = new StringBuilder();
        if (rows.isEmpty()) body.append("<tr><td colspan=\"").append(nCols).append("\" class=\"c muted\">(항목 없음)</td></tr>");
        boolean hasLaborRow = false;
        for (int i = 0; i < rows.size(); i++) {
            Map<String, Object> r = rows.get(i);
            if (r.containsKey("isLabor")) hasLaborRow = true;
            double qty = (double) r.get("qty");
            String spec = (String) r.get("spec");
            body.append("<tr>");
            if (spans[i] > 0) body.append("<td class=\"gubun\" rowspan=\"").append(spans[i]).append("\">").append(esc(r.get("gubun"))).append("</td>");
            if (wide) body.append("<td>").append(esc(r.get("name"))).append("</td><td>").append(esc(spec)).append("</td>");
            else body.append("<td>").append(esc(r.get("name")))
                    .append(spec.isEmpty() ? "" : "<div class=\"muted\" style=\"margin-top:1px\">" + esc(spec) + "</div>").append("</td>");
            body.append("<td class=\"c\">").append(numText(qty)).append("MM".equals(r.get("unit")) ? " MM" : "").append("</td>");
            Object base = r.get("base");
            body.append("<td class=\"r\">").append(base != null && num(base) > 0 ? won(num(base)) : "").append("</td>");
            body.append("<td class=\"r\">").append(won(num(r.get("proposed")))).append("</td>");
            // 수량 0 인 참고라인은 금액을 '-' 로 표기
            body.append("<td class=\"r b\">").append(qty == 0 ? "-" : won((double) r.get("amount"))).append("</td></tr>");
        }
        String col2 = isLabor || hasLaborRow ? "역할(등급)" : (wide ? "모듈" : "세부기능");
        return "<div class=\"sec\">▣ " + esc(title) + (recurring ? " <span style=\"font-weight:400;color:#888\">(월)</span>" : "") + "</div>"
                + "<table class=\"grid\"><tr><th>구분</th><th>" + col2 + "</th>" + (wide ? "<th>세부내역</th>" : "")
                + "<th>" + (isLabor ? "공수(MM)" : "수량") + "</th><th>기준단가</th>"
                + "<th>" + (recurring ? "제안단가(월)" : "제안단가") + "</th><th>" + (recurring ? "제안금액(월)" : "제안금액") + "</th></tr>"
                + body + "<tr class=\"subrow\"><td colspan=\"" + (nCols - 1) + "\" class=\"r\">" + esc(title) + " 소계" + (recurring ? "(월)" : "")
                + "</td><td class=\"r\">" + won(num(b.get("subtotal"))) + "</td></tr></table>";
    }

    /** 부속 페이지 — 인력투입계획표 · 임금단가표 · 건수 밴드표 (Node {@code buildAppendix}) */
    private String appendix(Map<String, Object> quote, Map<String, Object> masters) {
        List<String> parts = new ArrayList<>();
        List<Map<String, Object>> laborRows = new ArrayList<>();
        for (Map<String, Object> b : maps(quote.get("blocks"))) laborRows.addAll(maps(b.get("labor")));
        List<Map<String, Object>> planRows = new ArrayList<>();
        for (Map<String, Object> l : laborRows) if (l.get("month_alloc") instanceof Map<?, ?> a && !a.isEmpty()) planRows.add(l);
        if (!planRows.isEmpty()) {
            // 월 키를 M, M1, M2 … 순서로
            Set<String> keySet = new TreeSet<>((a, b) -> a.equals("M") ? (b.equals("M") ? 0 : -1) : b.equals("M") ? 1
                    : Double.compare(Js.number(a.substring(1)), Js.number(b.substring(1))) != 0
                            ? Double.compare(Js.number(a.substring(1)), Js.number(b.substring(1))) : a.compareTo(b));
            for (Map<String, Object> l : planRows) for (Object k : ((Map<?, ?>) l.get("month_alloc")).keySet()) keySet.add(String.valueOf(k));
            List<String> keys = new ArrayList<>(keySet);
            Map<String, Double> colTotal = new LinkedHashMap<>();
            for (String k : keys) colTotal.put(k, 0.0);
            double grandMM = 0;
            StringBuilder body = new StringBuilder();
            for (Map<String, Object> l : planRows) {
                double mm = num(l.get("mm"));
                grandMM += mm;
                Map<?, ?> alloc = (Map<?, ?>) l.get("month_alloc");
                StringBuilder cells = new StringBuilder();
                for (String k : keys) {
                    double v = num(alloc.get(k));
                    colTotal.put(k, colTotal.get(k) + v);
                    cells.append("<td class=\"c\">").append(v != 0 ? fixed2(v) : "").append("</td>");
                }
                body.append("<tr><td>").append(esc(firstNonEmpty(l.get("role_label"), l.get("role_name"), l.get("role_code")))).append("</td><td>")
                        .append(esc(str(l.get("task")))).append("</td>").append(cells).append("<td class=\"c b\">").append(fixed2(mm)).append("</td></tr>");
            }
            StringBuilder head = new StringBuilder(), foot = new StringBuilder();
            for (String k : keys) {
                head.append("<th>").append(esc(k)).append("</th>");
                foot.append("<td class=\"c\">").append(fixed2(colTotal.get(k))).append("</td>");
            }
            parts.add("<div class=\"page-break\"></div>\n      <div class=\"sec\">#. 인력투입계획</div>\n      <table class=\"grid\">"
                    + "\n        <tr><th>역할</th><th>상세업무내역</th>" + head + "<th>합계(MM)</th></tr>\n        " + body
                    + "\n        <tr class=\"subrow\"><td colspan=\"2\" class=\"r\">합계(M/M)</td>" + foot + "<td class=\"c b\">" + fixed2(grandMM) + "</td></tr>\n      </table>");
        }

        List<Map<String, Object>> rates = maps(masters.get("laborRates"));
        if (!rates.isEmpty() && !laborRows.isEmpty()) {
            StringBuilder body = new StringBuilder();
            for (Map<String, Object> r : rates) {
                body.append("<tr>\n      <td>").append(esc(r.get("role_name"))).append("</td><td class=\"c\">").append(esc(str(r.get("grade"))))
                        .append("</td>\n      <td class=\"r\">").append(won(num(r.get("wage_md")))).append("</td><td class=\"r\">").append(won(num(r.get("wage_mm"))))
                        .append("</td>\n      <td class=\"r\">").append(won(num(r.get("overhead")))).append("</td><td class=\"r\">").append(won(num(r.get("tech_fee"))))
                        .append("</td>\n      <td class=\"r b\">").append(won(num(r.get("apply_price")))).append("</td><td>").append(esc(str(r.get("note")))).append("</td></tr>");
            }
            parts.add("<div class=\"page-break\"></div>\n      <div class=\"sec\">#. 한국SW산업협회 기준 SW기술자 평균임금 (" + esc(str(masters.get("laborRateYear"))) + "년)</div>"
                    + "\n      <div class=\"muted\" style=\"margin-bottom:4px\">SW기술자비용 = 직접인건비(노임단가×근무일수 20.5) + 제경비(직접인건비×110%) + 기술료((직접인건비+제경비)×20%)</div>"
                    + "\n      <table class=\"grid\">\n        <tr><th>구분</th><th>등급</th><th>노임단가(M/D)</th><th>평균임금(M/M)</th><th>제경비</th><th>기술료</th><th>적용단가</th><th>비고</th></tr>\n        "
                    + body + "\n      </table>\n      "
                    + (Rows.truthy(masters.get("laborRateSource")) ? "<div class=\"muted\" style=\"margin-top:4px\">출처: " + esc(masters.get("laborRateSource")) + "</div>" : ""));
        }

        if (masters.get("bands") instanceof Map<?, ?> bands && !bands.isEmpty()) {
            StringBuilder sb = new StringBuilder();
            for (Object v : bands.values()) {
                StringBuilder rows = new StringBuilder();
                for (Map<String, Object> r : maps(v)) {
                    rows.append("<tr><td class=\"c\">").append(numText(num(r.get("min_qty")))).append("</td><td class=\"c\">")
                            .append(numText(num(r.get("max_qty")))).append("</td><td class=\"r\">").append(won(num(r.get("price")))).append("</td></tr>");
                }
                sb.append("\n      <div class=\"sec\" style=\"margin-top:10px\">▣ 건수별 제안금액</div>\n      <table class=\"grid\" style=\"width:60%\">"
                        + "\n        <tr><th>월 건수</th><th>년 건수</th><th>제안 금액</th></tr>\n        " + rows + "\n      </table>");
            }
            parts.add(sb.toString());
        }
        return String.join("\n", parts);
    }

    // ── 도우미 ───────────────────────────────────────────────────

    private static final Map<String, String> IMAGES = new java.util.concurrent.ConcurrentHashMap<>();

    /** 로고·인감·띠 이미지 — 없으면 null(대체 표기로 그린다) */
    private static String dataUri(String file) {
        return IMAGES.computeIfAbsent(file, f -> {
            try (InputStream in = new ClassPathResource("render/" + f).getInputStream()) {
                return "data:image/png;base64," + Base64.getEncoder().encodeToString(in.readAllBytes());
            } catch (IOException e) {
                return "";
            }
        }).isEmpty() ? null : IMAGES.get(file);
    }

    /** JS {@code toLocaleString('ko-KR')} — 3자리 콤마, 소수 최대 3자리 */
    static String won(double n) {
        if (Double.isNaN(n)) n = 0;
        DecimalFormat f = new DecimalFormat("#,##0.###", DecimalFormatSymbols.getInstance(Locale.KOREA));
        return f.format(n == 0 ? 0 : n);
    }

    private static String freeText(double v) {
        return v == 0 ? "무상제공" : won(v);
    }

    private static String fixed2(double v) {
        return String.format(Locale.ROOT, "%.2f", v);
    }

    /** JS 숫자 → 문자열 (0.4, 1, 12) */
    private static String numText(double v) {
        return Js.string(v);
    }

    private static double num(Object v) {
        if (v == null) return 0;
        double d = Js.toNumber(v);
        return Double.isNaN(d) ? 0 : d;
    }

    private static String str(Object v) {
        return v == null ? "" : String.valueOf(v);
    }

    private static String or(Object v, String fallback) {
        return Rows.truthy(v) ? String.valueOf(v) : fallback;
    }

    private static String firstNonEmpty(Object... vs) {
        for (Object v : vs) if (Rows.truthy(v)) return String.valueOf(v);
        return "";
    }

    private static String fmtDate(Object d) {
        String s = str(d);
        return s.length() > 10 ? s.substring(0, 10) : s;
    }

    private static String esc(Object s) {
        String v = str(s);
        StringBuilder sb = new StringBuilder(v.length());
        for (char c : v.toCharArray()) {
            switch (c) {
                case '&' -> sb.append("&amp;");
                case '<' -> sb.append("&lt;");
                case '>' -> sb.append("&gt;");
                case '"' -> sb.append("&quot;");
                default -> sb.append(c);
            }
        }
        return sb.toString();
    }

    private static String tag(String memo, String t) {
        Matcher m = Pattern.compile("\\[" + Pattern.quote(t) + "\\]\\s*(.+)").matcher(memo);
        return m.find() ? m.group(1).trim() : "";
    }

    private static List<?> list(Object v) {
        return v instanceof List<?> l ? l : List.of();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> maps(Object v) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : list(v)) if (o instanceof Map<?, ?> m) out.add((Map<String, Object>) m);
        return out;
    }

    private static final String CSS = """
            @page { size: A4; margin: 11mm 9mm; }
            * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
            body { font-family: 'Malgun Gothic','맑은 고딕','Noto Sans KR',sans-serif; color:#222; font-size:10px; margin:0; }
            .page { page-break-after: always; }
            .page:last-child { page-break-after: auto; }
            /* 부속 페이지(인력투입계획표·임금단가표)는 새 장에서 시작 */
            .page-break { page-break-before: always; height: 0; }
            table.grid { page-break-inside: auto; }
            table.grid tr { page-break-inside: avoid; }
            .cover { height: 268mm; display:flex; flex-direction:column; }
            .band { height: 9mm; display:flex; overflow:hidden; }
            .band > div { flex:1; } .band img { width:100%; height:100%; object-fit:fill; }
            .cover-body { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16mm; }
            .cover h1 { font-size:28px; margin:0; text-align:center; }
            .cover .sub { font-size:24px; letter-spacing:8px; font-weight:700; }
            .cover img.logo { height:66px; }
            .cust-box { border:1px solid #ccc; border-radius:4px; padding:10px 18px; font-size:12px; color:#555; line-height:1.9; min-width:230px; }
            .addr { text-align:right; font-size:8px; color:#888; }
            h2.qt { text-align:center; font-size:30px; letter-spacing:8px; color:#0747A6; margin:2px 0 8px; text-decoration:underline; }
            table { width:100%; border-collapse:collapse; }
            .hdrbox td { border:1px solid #999; padding:4px 7px; font-size:10px; }
            .hdrbox .lbl { background:#eee; font-weight:700; text-align:center; white-space:nowrap; width:64px; }
            .note { margin:6px 0; font-size:9px; } .note .u { float:right; color:#888; }
            .sec { font-weight:700; color:#0747A6; margin:11px 0 3px; font-size:11px; }
            table.grid td, table.grid th { border:1px solid #aaa; padding:3px 6px; }
            table.grid th { background:#ddd; font-weight:700; text-align:center; }
            .c{text-align:center}.r{text-align:right}.b{font-weight:700}.muted{color:#999}
            .gubun{background:#f2f2f2;font-weight:700;text-align:center;vertical-align:middle}
            .subrow td{background:#f2f2f2;font-weight:700}
            .tot{margin-top:8px}.tot td{border:1px solid #aaa;padding:4px 8px}
            .tot .grand{background:#0747A6;color:#fff;font-weight:700;font-size:13px}
            .conds{border:1px solid #999;border-radius:3px;padding:8px 11px;margin-top:6px;font-size:9.5px;line-height:1.7}
            .seal{position:relative}.seal img{position:absolute;right:8px;top:-4px;width:40px;height:40px;opacity:.9}
            """;
}
