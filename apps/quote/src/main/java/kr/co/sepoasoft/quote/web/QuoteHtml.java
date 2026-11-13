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
        return masters(quote, conditionSet, null);
    }

    /**
     * @param payPlan 결제 방안 표를 넣을지 직접 지정한다(템플릿 화면 — 저장 전 값). null 이면 견적의 템플릿 설정(has_pay_plan)을 따른다.
     */
    public Map<String, Object> masters(Map<String, Object> quote, Object conditionSet, Object payPlan) {
        Map<String, Object> m = new LinkedHashMap<>();
        // 임금단가표 — 견적일 연도 우선, 없으면 active 연도
        String qd = str(quote.get("quote_date"));
        Integer wantYear = qd.length() >= 4 && qd.substring(0, 4).matches("\\d{4}") ? Integer.valueOf(qd.substring(0, 4)) : null;
        Map<String, Object> yr = wantYear == null ? null : db.first("SELECT * FROM sq_labor_rate_years WHERE `year` = ?", wantYear);
        if (yr == null) yr = db.first("SELECT * FROM sq_labor_rate_years WHERE active = 1 LIMIT 1");
        if (yr != null) {
            m.put("laborRateYear", yr.get("year"));
            m.put("laborRateSource", yr.get("source"));
            m.put("laborWorkDays", yr.get("work_days"));
            m.put("laborRates", db.query("SELECT role_code, role_name, grade, wage_md, wage_mm, overhead, tech_fee, apply_price, note"
                    + " FROM sq_labor_rate_lines WHERE year_id = ? ORDER BY sort, id", yr.get("id")));
        }
        // 전년도 노임단가(M/D) — 협회 양식의 '전년 · 올해' 두 칸
        if (yr != null) {
            Map<String, Object> py = db.first("SELECT id, `year` FROM sq_labor_rate_years WHERE `year` = ?", (long) num(yr.get("year")) - 1);
            if (py != null) {
                Map<String, Object> prev = new LinkedHashMap<>();
                for (Map<String, Object> l : db.query("SELECT role_code, wage_md FROM sq_labor_rate_lines WHERE year_id = ?", py.get("id"))) prev.put(str(l.get("role_code")), l.get("wage_md"));
                if (!prev.isEmpty()) {
                    m.put("prevRateYear", py.get("year"));
                    m.put("prevRates", prev);
                }
            }
        }
        // 솔루션 이름 — 표지 제목('창성 전자구매시스템') · 결제 방안 제목
        if (Rows.truthy(quote.get("solution"))) {
            Map<String, Object> sol = db.first("SELECT name FROM sq_solutions WHERE code = ?", quote.get("solution"));
            if (sol != null) m.put("solutionName", sol.get("name"));
        }
        // 템플릿 설정 — 견적조건 세트 · 결제 방안 포함
        Map<String, Object> tpl = Rows.truthy(quote.get("template_code"))
                ? db.first("SELECT condition_set, has_pay_plan, brand FROM sq_quote_templates WHERE code = ?", quote.get("template_code")) : null;
        // SaaS 서비스 비용 모듈 묶음(2026-11-04) — 구분 칸은 템플릿 브랜드, 기준단가는 서비스 품목의 1계정(1건) 단가
        if (tpl != null && Rows.truthy(tpl.get("brand"))) m.put("brand", tpl.get("brand"));
        if ("SAAS".equals(str(quote.get("deployment"))) && Rows.truthy(quote.get("solution"))) {
            Map<String, Object> unitBase = new LinkedHashMap<>();
            for (Map<String, Object> p : db.query("SELECT code, base_price FROM sq_price_items WHERE solution = ? AND deployment = 'SAAS' AND pricing_type = 'BAND'",
                    quote.get("solution"))) unitBase.put(str(p.get("code")), p.get("base_price"));
            m.put("saasUnitBase", unitBase);
            m.put("solution", quote.get("solution"));
        }
        m.put("payPlan", payPlan != null ? Rows.truthy(payPlan) : tpl != null && Rows.truthy(tpl.get("has_pay_plan")));
        // 견적조건 — 저장된 conditions 가 없을 때 쓴다
        Object set = conditionSet;
        if (!Rows.truthy(set) && tpl != null) set = tpl.get("condition_set");
        if (Rows.truthy(set)) {
            List<Object> lines = new ArrayList<>();
            for (Map<String, Object> r : db.query("SELECT `text` FROM sq_condition_lines WHERE set_code = ? ORDER BY line_no", set)) lines.add(r.get("text"));
            m.put("conditionLines", lines);
        }
        // 건수 밴드표(건수별 제안금액)는 싣지 않는다 — 실측 양식(창성)에 없고 견적서 틀 밖에 따로 붙어 보였다(2026-10-29 사용자 요청).
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

    static final Map<String, String> DEP_LABEL = Map.of(
            "ONPREM_LUMP", "온프레미스", "ONPREM_INSTALL", "온프레미스", "ONPREM", "온프레미스", "SAAS", "SaaS", "PCLOUD", "Private Cloud");
    private static final String[] CIRCLED = { "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨" };

    /**
     * 견적서 HTML — 표지 + 견적서(블록 표 · 결제 방안 · 견적조건) + 부록(인력투입계획 · 노임단가표 · 건수 밴드표).
     * 양식은 실측 견적서(창성 전자구매 2026-08-04, SaaS · 온프레미스)를 따른다: 테두리 틀 · 노란 라벨 · 연두 머리행/소계행 ·
     * 합계는 표 안의 행(구축금액 Total · 제안금액(특별 DC 적용)) · 상단 총견적가는 ₩ 표기(실측 양식).
     */
    public String render(Map<String, Object> quote, Map<String, Object> settings, Map<String, Object> masters, boolean withCover) {
        String memo = str(quote.get("memo"));
        String purpose = tag(memo, "견적용도");
        String payTerms = tag(memo, "결제조건");
        // 담당자 정보(우리 영업 담당, 2026-11-02 사용자 요청) — 오른쪽 자사 표 아래 줄. 메모에 없으면(옛 견적) 줄도 없다
        String repName = tag(memo, "영업담당"), repPhone = tag(memo, "영업연락처"), repEmail = tag(memo, "영업이메일");
        String repLine = String.join(" / ", java.util.stream.Stream.of(repName, repPhone).filter(v -> !v.isEmpty()).toList());
        String repRows = (repLine.isEmpty() ? "" : "<tr><td class=\"lbl\">담 당 자</td><td>" + esc(repLine) + "</td></tr>")
                + (repEmail.isEmpty() ? "" : "<tr><td class=\"lbl\">이 메 일</td><td>" + esc(repEmail) + "</td></tr>");
        if (payTerms.isEmpty()) payTerms = "고객사 결제조건";

        String logo = dataUri("logo.png"), bandTop = dataUri("band_top.png"), bandBot = dataUri("band_bottom.png");
        String supplier = or(settings.get("supplier_name"), "(주)세포아소프트");
        String ceo = or(settings.get("supplier_ceo"), "이 희 림");
        String addr = or(settings.get("supplier_addr"), "서울시 구로구 디지털로31길 62, 아티스포럼 714~717호");
        String tel = or(settings.get("supplier_tel"), "02-6242-3094");
        String solName = str(masters.get("solutionName"));
        String depLabel = DEP_LABEL.getOrDefault(str(quote.get("deployment")), "");

        // 견적조건: 저장값 → 템플릿의 condition_set(마스터) → 일반 문구.
        // 저장값이 빈 목록이면 견적조건 블록을 뺀 견적이다 — 견적조건 칸을 싣지 않는다(conditionsOff).
        List<String> conds = conditionLines(quote, masters);
        if (conds.isEmpty() && !conditionsOff(quote)) {
            conds.add("프로젝트 투입공수 및 일정은 세부 업무요건에 따라 변경될 수 있습니다.");
            conds.add("개발단가는 한국SW산업협회 노임 단가 기준 100%를 적용하였습니다.");
            conds.add("솔루션 유지보수는 시스템 오픈 후 12개월간 무상유지보수 이후 진행되며, 유상유지보수는 솔루션 공급가의 15%로 제안합니다.");
            conds.add("본 프로젝트는 상주로 진행합니다.");
        }

        List<Map<String, Object>> blocks = maps(quote.get("blocks"));
        double onetimeSub = 0, monthlySub = 0;
        int lastOnetime = -1, lastMonthly = -1, onetimeCount = 0;
        for (int i = 0; i < blocks.size(); i++) {
            Map<String, Object> b = blocks.get(i);
            if (Rows.truthy(b.get("recurring"))) { monthlySub += num(b.get("subtotal")); lastMonthly = i; }
            else { onetimeSub += num(b.get("subtotal")); lastOnetime = i; onetimeCount++; }
        }
        double onetimeTotal = num(quote.get("onetime_total"));
        double monthlyTotal = num(quote.get("monthly_total"));

        @SuppressWarnings("unchecked")
        Map<String, Object> blockDefs = masters.get("blockDefs") instanceof Map<?, ?> d ? (Map<String, Object>) d : Map.of();
        StringBuilder body = new StringBuilder();
        int seq = 0;
        List<String> marks = new ArrayList<>();
        for (int i = 0; i < blocks.size(); i++) {
            Map<String, Object> b = blocks.get(i);
            boolean rec = Rows.truthy(b.get("recurring"));
            // 일시불 블록이 둘 이상이면 소계에 ①② 를 달고 '구축금액 Total (①+②)' 행을 붙인다 (실측 온프레미스)
            String mark = !rec && onetimeCount >= 2 && seq < CIRCLED.length ? CIRCLED[seq++] : "";
            if (!mark.isEmpty()) marks.add(mark);
            List<String> extra = new ArrayList<>();
            if (i == lastOnetime) {
                if (onetimeCount >= 2) extra.add(sumRow("구축금액 Total (" + String.join("+", marks) + ")", "", won(onetimeSub)));
                if (onetimeSub - onetimeTotal > 0) extra.add(sumRow("제안금액(특별 DC 적용)", "", freeText(onetimeTotal)));
            }
            if (i == lastMonthly && monthlySub - monthlyTotal > 0) extra.add(sumRow("월 사용료(특별 DC 적용)", "", won(monthlyTotal)));
            body.append(blockTable(b, blockDefs, mark, extra, masters)).append('\n');
        }

        // 클라우드서비스 결제 방안 — 견적에서 넣기로 했거나(견적별 설정) 템플릿에서 켠 견적 (실측 SaaS · Private Cloud 하단)
        String payPlan = payPlanOn(quote, masters) ? payPlan(solName, payPlanRows(quote, onetimeTotal, monthlyTotal)) : "";

        StringBuilder condHtml = new StringBuilder();
        for (String c : conds) condHtml.append("<tr><td>-. ").append(esc(c)).append("</td></tr>");

        // ── 머리 상자 ──
        String customer = str(quote.get("customer_name"));
        // 인감 도장은 찍지 않는다(2026-11-02 사용자 요청) — 도장은 인장시스템 결재 완료 후 인장시스템에서 찍힌다.
        // 자리(.seal · .sealimg 스타일, 이미지 seal.png)는 남겨 둔다
        String sealImg = "";
        String grand;
        if (monthlyTotal != 0 || monthlySub != 0) {
            grand = "<tr><td class=\"lbl\" rowspan=\"2\">총 견 적 가</td><td class=\"amt\">" + wonSign(onetimeTotal) + "</td>"
                    + "<td class=\"unit\">클라우드서비스 셋업비용(단위 : 원, 부가세 별도)</td></tr>"
                    + "<tr><td class=\"amt\">₩" + won(monthlyTotal) + "</td><td class=\"unit\">클라우드서비스 월사용료(단위 : 원, 부가세 별도)</td></tr>";
        } else {
            grand = "<tr><td class=\"lbl\">총 견 적 가</td><td class=\"amt\">" + wonSign(onetimeTotal) + "</td>"
                    + "<td class=\"unit\">(단위 : 원, 부가세 별도)</td></tr>";
        }
        String validUntil = Rows.truthy(quote.get("valid_until")) ? korDate(quote.get("valid_until")) : "견적일로부터 30일";

        String bandFallbackTop = "<div class=\"bandfb\"><div style=\"background:#A6CE39\"></div><div style=\"background:#F5C400\"></div><div style=\"background:#EC008C\"></div><div style=\"background:#404040;flex:5\"></div></div>";
        String bandFallbackBot = "<div class=\"bandfb\"><div style=\"background:#404040;flex:5\"></div><div style=\"background:#EC008C\"></div><div style=\"background:#F5C400\"></div><div style=\"background:#A6CE39\"></div></div>";
        String coverTitle = !customer.isEmpty() && !solName.isEmpty() ? customer + " " + solName + "시스템"
                : !purpose.isEmpty() ? purpose : (customer.isEmpty() ? "" : customer + " ") + "시스템 구축";

        String cover = withCover
                ? "<div class=\"page cover\">\n  <div class=\"band\">" + (bandTop != null ? "<img src=\"" + bandTop + "\">" : bandFallbackTop) + "</div>"
                        + "\n  <div class=\"cover-title\"><div>" + esc(coverTitle) + "</div><div>가격제안서</div></div>"
                        + "\n  <div class=\"cust\">"
                        + "<div>고객사 : " + esc(customer) + "</div>"
                        + "<div>담당자 : " + esc(str(quote.get("customer_contact"))) + "</div>"
                        + "<div>연락처 : " + esc(tag(memo, "연락처")) + "</div>"
                        + "<div>이메일 : " + esc(tag(memo, "이메일")) + "</div></div>"
                        + "\n  <div class=\"cover-logo\">" + (logo != null ? "<img src=\"" + logo + "\">" : "") + "<div>" + esc(supplier) + "</div></div>"
                        + "\n  <div class=\"band\">" + (bandBot != null ? "<img src=\"" + bandBot + "\">" : bandFallbackBot) + "</div>\n</div>"
                : "<!-- 커버 생략(withCover=false) — 외부에서 제작한 커버 PDF 를 앞에 병합하세요 -->";

        return "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><style>\n" + CSS + "</style></head><body>\n\n"
                + cover
                + "\n\n<div class=\"page\"><div class=\"frame\">"
                + "\n  <div class=\"top\">" + (logo != null ? "<img src=\"" + logo + "\">" : "<b>" + esc(supplier) + "</b>")
                + "<div class=\"addr\">" + esc(addr) + " ☎:" + esc(tel) + "</div></div>"
                + "\n  <h2 class=\"qt\"><span>Quotation</span></h2>"
                + "\n  <div class=\"hdr\">"
                + "\n    <table class=\"hbox hl\">"
                + "<tr><td class=\"lbl\">수 신</td><td colspan=\"2\">" + (customer.isEmpty() ? "" : "<b>" + esc(customer) + "</b> 귀중") + "</td></tr>"
                + "<tr><td class=\"lbl\">견 적 용 도</td><td colspan=\"2\"><b>" + esc(purpose) + "</b></td></tr>"
                + "<tr><td class=\"lbl\">결 제 조 건</td><td colspan=\"2\">" + esc(payTerms) + "</td></tr>"
                + grand
                + "<tr><td class=\"lbl\">설 치 완 료</td><td colspan=\"2\">협의된 프로젝트 기간</td></tr></table>"
                + "\n    <table class=\"hbox hr\">"
                + "<tr><td class=\"lbl\">견 적 번 호</td><td>" + esc(str(quote.get("quote_no"))) + "</td></tr>"
                + "<tr><td class=\"lbl\">견 적 일 자</td><td>" + korDate(quote.get("quote_date")) + "</td></tr>"
                + "<tr><td class=\"lbl\">견적유효일</td><td>" + esc(validUntil) + "</td></tr>"
                + "<tr><td class=\"lbl\">상 호</td><td>" + esc(supplier) + "</td></tr>"
                + "<tr><td class=\"lbl\">대 표 이 사</td><td class=\"seal\">" + esc(ceo) + sealImg + "</td></tr>"
                + repRows + "</table>"
                + "\n  </div>"
                + "\n  <div class=\"note\">하기와 같이 견적하오니 참조 바랍니다.</div>"
                + "\n\n  " + body
                + payPlan
                + (conds.isEmpty() ? "" : "\n  <div class=\"sec\">▣ 견적조건</div>"
                        + "\n  <table class=\"conds\">" + condHtml + "</table>")
                + "\n</div></div>"
                + "\n\n" + appendix(quote, masters, depLabel)
                + "\n\n</body></html>";
    }

    /** 표 안의 합계 행 — 앞 세 칸을 묶은 라벨 · 수량 칸 · (빈 두 칸) · 금액 */
    private static String sumRow(String label, String qty, String amount) {
        return "<tr class=\"sum\"><td colspan=\"3\" class=\"c\">" + esc(label) + "</td><td class=\"c\">" + qty + "</td><td></td><td></td>"
                + "<td class=\"r\">" + amount + "</td></tr>";
    }

    /** 블록 1개 — 같은 '구분'(category) 이 연속되는 행은 rowspan 으로 묶는다. {@code extra} 는 표 끝에 붙는 합계 행 */
    private String blockTable(Map<String, Object> b, Map<String, Object> blockDefs, String mark, List<String> extra, Map<String, Object> masters) {
        String code = str(b.get("block_code"));
        Map<?, ?> def = blockDefs.get(code) instanceof Map<?, ?> d ? d : Map.of();
        boolean isLabor = "LABOR".equals(code);
        String title = firstNonEmpty(b.get("title"), def.get("name"), code);
        boolean recurring = Rows.truthy(b.get("recurring"));

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
        double mmSum = 0;
        if (isLabor) for (Map<String, Object> l : maps(b.get("labor"))) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("gubun", firstNonEmpty(l.get("category"), "시스템구축 개발인건비"));
            r.put("name", firstNonEmpty(l.get("role_label"), l.get("role_name"), l.get("role_code")));
            r.put("spec", str(l.get("task")));
            r.put("qty", num(l.get("mm")));
            r.put("unit", "MM");
            r.put("base", l.get("base_price"));
            r.put("proposed", l.get("proposed_price"));
            r.put("amount", num(l.get("amount")));
            r.put("isLabor", true);
            mmSum += num(l.get("mm"));
            rows.add(r);
        }
        // SaaS 서비스 비용 모듈 묶음(2026-11-04 사용자 요청 — 실측 양식) — 서비스 이용료 행(구간형, note 'BAND:USER:10') 바로 뒤에
        // 모듈 행(코드 …_SAAS_M01, 수량 0)이 이어지면 서비스 이용료 행은 찍지 않고, 그 수량 · 단가 · 금액을 모듈 행들에 한 칸으로 합쳐 싣는다.
        //   수량 '10 계정'(건수면 '10 건') · 기준단가 = 서비스 품목 1계정 단가 · 제안단가 = 금액 ÷ 수량 · 구분은 블록 전체를 템플릿 브랜드로
        List<Map<String, Object>> src = maps(b.get("items"));
        String bundleTitle = null;
        for (int i = 0; !isLabor && i < src.size() && i < rows.size(); i++) {
            String note = str(src.get(i).get("note"));
            if (!note.startsWith("BAND:")) continue;
            int n = 0;
            while (i + 1 + n < src.size() && str(src.get(i + 1 + n).get("item_code")).matches(".*_SAAS_M\\d+$") && num(src.get(i + 1 + n).get("qty")) == 0) n++;
            if (n == 0) continue;
            String[] parts = note.split(":");
            boolean count = parts.length > 1 && "COUNT".equals(parts[1]);
            double bq = parts.length > 2 ? num(parts[2]) : 0;
            Map<String, Object> svc = rows.get(i);
            double amount = (double) svc.get("amount");
            Object unitBase = masters.get("saasUnitBase") instanceof Map<?, ?> ub ? ub.get(str(src.get(i).get("item_code"))) : null;
            Map<String, Object> first = rows.get(i + 1);
            first.put("bundleSpan", n);
            first.put("bundleQty", bq > 0 ? numText(bq) + (count ? " 건" : " 계정") : qtyText((double) svc.get("qty"), (String) svc.get("unit"), false));
            first.put("bundleBase", unitBase != null && num(unitBase) > 0 ? won(num(unitBase)) : "");
            first.put("bundleProposed", bq > 0 ? won(Math.round(amount / bq)) : won(num(svc.get("proposed"))));
            first.put("bundleAmount", won(amount));
            for (int k = 2; k <= n; k++) rows.get(i + k).put("bundled", true);
            rows.remove(i);
            src = new ArrayList<>(src);
            src.remove(i);
            String brand = str(masters.get("brand"));
            if (!brand.isEmpty()) for (Map<String, Object> r : rows) r.put("gubun", brand);
            if (bq > 0) bundleTitle = count ? "월 " + numText(bq) + "건 이하"
                    : ("PROCURE".equals(str(masters.get("solution"))) ? "구매담당자 " : "사용자 ") + numText(bq) + "계정 이하";
            break;
        }
        int[] spans = new int[rows.size()];
        for (int i = 0; i < rows.size(); ) {
            int j = i;
            while (j + 1 < rows.size() && rows.get(j + 1).get("gubun").equals(rows.get(i).get("gubun"))) j++;
            spans[i] = j - i + 1;
            i = j + 1;
        }
        // 금액 0 행 합치기(2026-11-07 사용자 요청) — 금액 있는 행 뒤로 같은 구분의 금액 0 행이 이어지면 기준단가 · 제안단가 · 제안금액 칸을 위 행과 한 칸으로
        if (!isLabor && bundleTitle == null) {
            List<Double> amounts = new ArrayList<>(), qtys = new ArrayList<>();
            List<Object> gubuns = new ArrayList<>();
            for (Map<String, Object> r : rows) { amounts.add((double) r.get("amount")); qtys.add((double) r.get("qty")); gubuns.add(r.get("gubun")); }
            int[] zs = zeroSpans(gubuns, amounts, qtys);
            for (int i = 0; i < rows.size(); i++) {
                if (zs[i] > 1) rows.get(i).put("zeroSpan", zs[i]);
                else if (zs[i] == 0) rows.get(i).put("zeroMerged", true);
            }
        }
        StringBuilder body = new StringBuilder();
        if (rows.isEmpty()) body.append("<tr><td colspan=\"7\" class=\"c muted\">(항목 없음)</td></tr>");
        for (int i = 0; i < rows.size(); i++) {
            Map<String, Object> r = rows.get(i);
            double qty = (double) r.get("qty");
            boolean labor = r.containsKey("isLabor");
            body.append("<tr>");
            if (spans[i] > 0) body.append("<td class=\"gubun\" rowspan=\"").append(spans[i]).append("\">").append(esc(r.get("gubun"))).append("</td>");
            body.append("<td class=\"c\">").append(esc(r.get("name"))).append("</td><td class=\"spec\">").append(esc(r.get("spec"))).append("</td>");
            if (r.containsKey("bundleSpan")) {
                String rs = " rowspan=\"" + r.get("bundleSpan") + "\"";
                body.append("<td class=\"c\"").append(rs).append(">").append(esc(r.get("bundleQty"))).append("</td>")
                        .append("<td class=\"r\"").append(rs).append(">").append(r.get("bundleBase")).append("</td>")
                        .append("<td class=\"r\"").append(rs).append(">").append(r.get("bundleProposed")).append("</td>")
                        .append("<td class=\"r\"").append(rs).append(">").append(r.get("bundleAmount")).append("</td></tr>");
                continue;
            }
            if (r.containsKey("bundled")) { body.append("</tr>"); continue; }
            if (r.containsKey("zeroMerged")) { // 위 행과 합친 금액 칸 — 수량만
                body.append("<td class=\"c\">").append(qty == 0 ? "" : qtyText(qty, (String) r.get("unit"), labor)).append("</td></tr>");
                continue;
            }
            // 수량 0 은 묶음에 포함된 참고 행이다 — 수량·단가·금액 칸을 비운다 (실측: Poa Ordering™ · Poa EV™)
            if (qty == 0) {
                body.append("<td></td><td></td><td></td><td></td></tr>");
                continue;
            }
            Object base = r.get("base");
            String zr = r.containsKey("zeroSpan") ? " rowspan=\"" + r.get("zeroSpan") + "\"" : "";
            body.append("<td class=\"c\">").append(qtyText(qty, (String) r.get("unit"), labor)).append("</td>")
                    .append("<td class=\"r\"").append(zr).append(">").append(base != null && num(base) > 0 ? won(num(base)) : "").append("</td>")
                    .append("<td class=\"r\"").append(zr).append(">").append(won(num(r.get("proposed")))).append("</td>")
                    .append("<td class=\"r\"").append(zr).append(">").append(won((double) r.get("amount"))).append("</td></tr>");
        }
        String subLabel = isLabor ? "인건비 소계" : bundleTitle != null ? "서비스 사용료 소계" : title.endsWith("소계") ? title : title + " 소계";
        body.append(sumRow(subLabel + (mark.isEmpty() ? "" : "(" + mark + ")"), isLabor ? fixed1(mmSum) : "", won(num(b.get("subtotal")))));
        for (String e : extra) body.append(e);

        String col2 = isLabor ? "역할" : recurring ? "시스템" : "모듈";
        String col3 = isLabor ? "세부내역" : "세부기능";
        String col4 = isLabor ? "공수(MM)" : "수량";
        String head = bundleTitle != null ? "서비스 비용 <span style=\"color:#E53935\">(" + esc(bundleTitle) + ")</span>" : esc(title);
        return "<div class=\"sec\">▣ " + head + "<span class=\"u\">(단위 : 원)</span></div>"
                + "<table class=\"grid\"><colgroup><col style=\"width:13%\"><col style=\"width:15%\"><col style=\"width:27%\"><col style=\"width:9%\">"
                + "<col style=\"width:12%\"><col style=\"width:12%\"><col style=\"width:12%\"></colgroup>"
                + "<tr><th>구분</th><th>" + col2 + "</th><th>" + col3 + "</th><th>" + col4 + "</th><th>기준단가</th>"
                + "<th>" + (recurring ? "제안단가(월)" : "제안단가") + "</th><th>" + (recurring ? "제안금액(월)" : "제안금액") + "</th></tr>"
                + body + "</table>";
    }

    /** 견적조건을 뺀 견적인가 — 저장된 conditions 가 빈 목록(null 은 '정하지 않음' → 템플릿 문구 · 일반 문구) */
    static boolean conditionsOff(Map<String, Object> quote) {
        return quote.get("conditions") instanceof List<?> l && l.stream().noneMatch(c -> Rows.truthy(c instanceof Map<?, ?> m ? m.get("text") : c));
    }

    /** 견적서에 찍을 견적조건 문장 — 저장값, 저장값이 없으면(null) 템플릿 세트 문장. 뺀 견적이면 빈 목록 */
    static List<String> conditionLines(Map<String, Object> quote, Map<String, Object> masters) {
        List<String> conds = new ArrayList<>();
        for (Object c : list(quote.get("conditions"))) {
            Object t = c instanceof Map<?, ?> cm ? cm.get("text") : c;
            if (Rows.truthy(t)) conds.add(String.valueOf(t));
        }
        if (conds.isEmpty() && !conditionsOff(quote)) for (Object c : list(masters.get("conditionLines"))) conds.add(String.valueOf(c));
        return conds;
    }

    /** 결제 방안을 넣는가 — 견적별 설정(pay_plan.enabled)이 있으면 그것, 없으면 템플릿(has_pay_plan) */
    static boolean payPlanOn(Map<String, Object> quote, Map<String, Object> masters) {
        if (quote.get("pay_plan") instanceof Map<?, ?> pp && pp.containsKey("enabled")) return Rows.truthy(pp.get("enabled"));
        return Rows.truthy(masters.get("payPlan"));
    }

    /**
     * 결제 방안 표의 행 — [구분, 지급시점, 비용, 내역]. 견적에서 직접 고친 행(pay_plan.rows)이 있으면 그대로,
     * 없으면 금액과 계약체결 비율(pay_plan.ratio, 기본 50%)로 기본 문구를 만든다(실측 창성 SaaS 문구).
     * 견적 작성 화면(step3 payPlanDefault)도 같은 문구를 만든다 — 바꾸면 둘 다 바꾼다.
     */
    static List<String[]> payPlanRows(Map<String, Object> quote, double onetime, double monthly) {
        Map<?, ?> pp = quote.get("pay_plan") instanceof Map<?, ?> m ? m : Map.of();
        List<String[]> out = new ArrayList<>();
        if (pp.get("rows") instanceof List<?> rows && !rows.isEmpty()) {
            for (Object r : rows) {
                List<?> c = r instanceof List<?> l ? l : List.of();
                String[] v = new String[4];
                for (int i = 0; i < 4; i++) v[i] = i < c.size() && c.get(i) != null ? String.valueOf(c.get(i)) : "";
                out.add(v);
            }
            return out;
        }
        double ratio = pp.get("ratio") == null ? 50 : num(pp.get("ratio"));
        if (ratio <= 0 || ratio > 100) ratio = 50;
        String r1 = numText(ratio), r2 = numText(100 - ratio);
        long first = Math.round(onetime * ratio / 100);
        if (onetime == 0) {
            out.add(new String[] { "서비스\n셋업비용", "1. 무상제공", "1. 셋업비용 : 무상제공", "-" });
        } else if (ratio >= 100) {
            out.add(new String[] { "서비스\n셋업비용", "1. 일시불\n  -. 계약체결 후 100%", "1. 일시불 비용 : ₩" + won(onetime) + "원",
                    "-. 서비스계약 체결 후 7일 이내 세금계산서 발행\n-. 결제조건 : 계약체결 후 100%" });
        } else {
            out.add(new String[] { "서비스\n셋업비용", "1. 일시불\n  -. 계약체결 후 " + r1 + "%\n  -. 구축완료 후 " + r2 + "%",
                    "1. 일시불 비용 : ₩" + won(onetime) + "원\n   계약체결 후 " + r1 + "% : ₩" + won(first) + "원\n   구축완료 후 " + r2 + "% : ₩" + won(onetime - first) + "원",
                    "-. 서비스계약 체결 후 7일 이내 세금계산서 발행\n-. 검수완료 후 7일 이내 세금계산서 발행\n-. 결제조건 : 계약체결 후 " + r1 + "% / 구축완료 후 " + r2 + "%" });
        }
        out.add(new String[] { "서비스\n월 사용료", "1. 매월 말", "1. 서비스 사용료 : ₩" + won(monthly) + "원/매월", "-. 서비스 착수 후 월별로 세금계산서 발행" });
        return out;
    }

    /** 클라우드서비스 결제 방안 표 */
    private static String payPlan(String solName, List<String[]> rows) {
        StringBuilder body = new StringBuilder();
        for (String[] r : rows) {
            body.append("<tr><td class=\"c\">").append(br(r[0])).append("</td><td>").append(br(r[1])).append("</td><td>").append(br(r[2]))
                    .append("</td><td>").append(br(r[3])).append("</td></tr>");
        }
        return "<div class=\"sec\">▣ " + esc(solName.isEmpty() ? "" : solName + " ") + "클라우드서비스 결제 방안</div>"
                + "<table class=\"grid\"><colgroup><col style=\"width:13%\"><col style=\"width:20%\"><col style=\"width:31%\"><col style=\"width:36%\"></colgroup>"
                + "<tr><th>구분</th><th>지급시점</th><th>비용</th><th>내역</th></tr>" + body + "</table>\n";
    }

    /** 글자를 그대로 싣되 줄바꿈 · 앞 공백을 살린다 */
    private static String br(String s) {
        return esc(s).replace("\n", "<br>").replace("  ", "&nbsp;&nbsp;");
    }

    /** 부속 페이지 — 인력투입계획표 · 노임단가표(협회 양식) */
    private String appendix(Map<String, Object> quote, Map<String, Object> masters, String depLabel) {
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
            // 빈 달도 칸을 둔다 — M1 ~ Mn 전부(n = 메모 [투입개월] 과 배분된 마지막 달 중 큰 값). 옛 'M' 칸은 값이 있을 때만 앞에(2026-11-03)
            String memo = str(quote.get("memo"));
            int n = (int) Js.number(tag(memo, "투입개월"));
            for (String k : keySet) if (!k.equals("M")) n = Math.max(n, (int) Js.number(k.substring(1)));
            List<String> keys = new ArrayList<>();
            if (keySet.contains("M")) keys.add("M");
            for (int i = 1; i <= n; i++) keys.add("M" + i);
            // 실제 투입월(선택) — 메모 [투입시작] 2026-11 이 있으면 Mk 아래 줄에 26.11 · 26.12 …
            Matcher sm = Pattern.compile("(\\d{4})-(\\d{2})").matcher(tag(memo, "투입시작"));
            int startYm = sm.find() ? Integer.parseInt(sm.group(1)) * 12 + Integer.parseInt(sm.group(2)) - 1 : -1;
            // 등급 칸 = 노임단가표의 직무명(IT PM · 응용소프트웨어 개발자). 저장된 행에 이름이 없으면 직무코드로 찾는다
            Map<String, Object> roleNames = new LinkedHashMap<>();
            for (Map<String, Object> r : maps(masters.get("laborRates"))) roleNames.put(str(r.get("role_code")), r.get("role_name"));
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
                    cells.append("<td class=\"r pm\">").append(v != 0 ? fixed1(v) : "").append("</td>");
                }
                body.append("<tr><td class=\"c\">").append(esc(firstNonEmpty(l.get("role_label"), l.get("role_name"), l.get("role_code"))))
                        .append("</td><td class=\"c\">").append(esc(firstNonEmpty(l.get("role_name"), roleNames.get(str(l.get("role_code")))))).append("</td><td>").append(esc(str(l.get("task"))))
                        .append("</td>").append(cells).append("<td class=\"r\">").append(fixed1(mm)).append("</td></tr>");
            }
            // 칸 너비 — 역할 8% · 등급 11% · 내역 20% · 합계 5% 를 먼저 잡고, 남은 56% 를 달 칸이 똑같이 나눈다.
            // table-layout:fixed 라 달이 많아도 내역 칸이 세로로 찌그러지지 않는다(2026-11-03 미리보기 깨짐)
            String mw = String.format("%.2f%%", 56.0 / Math.max(1, keys.size()));
            boolean dates = startYm >= 0;
            StringBuilder head = new StringBuilder(), dateRow = new StringBuilder(), foot = new StringBuilder();
            for (String k : keys) {
                head.append("<th class=\"pm\" style=\"width:").append(mw).append("\">").append(esc(k)).append("</th>");
                if (dates) {
                    int idx = k.equals("M") ? 0 : (int) Js.number(k.substring(1));
                    int ym = startYm + idx - 1;
                    dateRow.append("<th class=\"pm pd\">").append(idx < 1 ? "" : String.format("%02d.%02d", (ym / 12) % 100, ym % 12 + 1)).append("</th>");
                }
                foot.append("<td class=\"r pm\">").append(fixed1(colTotal.get(k))).append("</td>");
            }
            String rs = dates ? " rowspan=\"2\"" : "";
            parts.add("<div class=\"page-break\"></div>\n<div class=\"apx\">#. 인력투입계획" + (depLabel.isEmpty() ? "" : " (" + esc(depLabel) + ")") + "</div>"
                    + "\n<table class=\"grid plan\"><tr><th" + rs + " style=\"width:8%\">역할</th><th" + rs + " style=\"width:11%\">등급</th><th" + rs + " style=\"width:20%\">내역</th>" + head
                    + "<th" + rs + " style=\"width:5%\">합계</th></tr>\n" + (dates ? "<tr>" + dateRow + "</tr>\n" : "") + body
                    + "<tr class=\"sum\"><td colspan=\"3\" class=\"c\">합계(M/M)</td>" + foot + "<td class=\"r\">" + fixed1(grandMM) + "</td></tr></table>");
        }

        List<Map<String, Object>> rates = maps(masters.get("laborRates"));
        if (!rates.isEmpty() && !laborRows.isEmpty()) {
            String year = str(masters.get("laborRateYear"));
            // 산정 근거표의 근무일 — 연도마다 다르다(2026년 20.5, 2025년 20.6)
            String days = masters.get("laborWorkDays") == null ? "20.5"
                    : new java.math.BigDecimal(str(masters.get("laborWorkDays"))).stripTrailingZeros().toPlainString();
            Object prevYear = masters.get("prevRateYear");
            @SuppressWarnings("unchecked")
            Map<String, Object> prev = masters.get("prevRates") instanceof Map<?, ?> p ? (Map<String, Object>) p : Map.of();
            StringBuilder body = new StringBuilder();
            for (Map<String, Object> r : rates) {
                body.append("<tr><td class=\"c\">").append(esc(r.get("role_name"))).append("</td>");
                if (prevYear != null) {
                    Object pv = prev.get(str(r.get("role_code")));
                    body.append("<td class=\"r\">").append(pv == null ? "" : won(num(pv))).append("</td>");
                }
                body.append("<td class=\"r\">").append(won(num(r.get("wage_md")))).append("</td><td class=\"r\">").append(won(num(r.get("wage_mm"))))
                        .append("</td><td class=\"r b\">").append(won(num(r.get("apply_price")))).append("</td><td>").append(esc(str(r.get("note")))).append("</td></tr>");
            }
            // 이 견적에 쓴 직무만 산정 근거표를 붙인다
            Set<String> used = new LinkedHashSet<>();
            for (Map<String, Object> l : laborRows) used.add(str(l.get("role_code")));
            StringBuilder calc = new StringBuilder();
            for (Map<String, Object> r : rates) {
                if (!used.contains(str(r.get("role_code")))) continue;
                double md = num(r.get("wage_md")), mm = num(r.get("wage_mm")), oh = num(r.get("overhead"));
                calc.append("<table class=\"grid calc\"><colgroup><col style=\"width:22%\"><col style=\"width:15%\"><col style=\"width:15%\">"
                        + "<col style=\"width:9%\"><col style=\"width:15%\"><col></colgroup>")
                        .append("<tr><td class=\"gubun g\" rowspan=\"5\">").append(esc(r.get("role_name"))).append("</td>")
                        .append("<th>항목</th><th>기준금액</th><th>요율</th><th>산정금액</th><th>산정근거</th></tr>")
                        .append("<tr><td class=\"c\">평균임금(M/M)</td><td class=\"r\">").append(won(md)).append("</td><td class=\"c\">").append(esc(days)).append("</td><td class=\"r\">")
                        .append(won(mm)).append("</td><td>평균임금(M/D)*근무일</td></tr>")
                        .append("<tr><td class=\"c\">제경비</td><td class=\"r\">").append(won(mm)).append("</td><td class=\"c\">1.1</td><td class=\"r\">")
                        .append(won(oh)).append("</td><td>평균임금(M/M)*110%</td></tr>")
                        .append("<tr><td class=\"c\">기술료</td><td class=\"r\">").append(won(mm + oh)).append("</td><td class=\"c\">0.2</td><td class=\"r\">")
                        .append(won(num(r.get("tech_fee")))).append("</td><td>(평균임금(M/M)+제경비)*20%</td></tr>")
                        .append("<tr><td colspan=\"3\" class=\"c b\">계</td><td class=\"r b\">").append(won(num(r.get("apply_price")))).append("</td><td></td></tr></table>");
            }
            parts.add("<div class=\"page-break\"></div>\n<div class=\"kosa\">한국SW산업협회 기준 SW기술자 평균임금</div>"
                    + "\n<div class=\"formula\"><table><tr><td class=\"b\">SW기술자비용 :</td><td class=\"c b\">직접인건비</td><td class=\"c\">+</td><td class=\"c b\">제경비</td>"
                    + "<td class=\"c\">+</td><td class=\"c b\">기술료</td></tr><tr><td></td><td class=\"c\">(노임단가*근무일수)</td><td></td><td class=\"c\">(직접인건비*110%)</td>"
                    + "<td></td><td class=\"c\">(직접인건비+제경비)*20%</td></tr></table></div>"
                    + "\n<table class=\"grid\"><tr><th rowspan=\"2\">구분</th><th colspan=\"" + (prevYear != null ? 2 : 1) + "\">노임단가(M/D)</th>"
                    + "<th rowspan=\"2\">평균임금<br>(M/M)</th><th rowspan=\"2\">적용단가<br>(제경비·기술료 포함)</th><th rowspan=\"2\">비고</th></tr><tr>"
                    + (prevYear != null ? "<th>" + esc(str(prevYear)) + "년</th>" : "") + "<th>" + esc(year) + "년</th></tr>" + body + "</table>"
                    + calc
                    + (Rows.truthy(masters.get("laborRateSource")) ? "<div class=\"muted\" style=\"margin-top:6px\">출처: " + esc(masters.get("laborRateSource")) + "</div>" : ""));
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

    /** 상단 총견적가 — 실측 양식대로 ₩ 를 붙인다. 0 은 무상제공 */
    static String wonSign(double v) {
        return v == 0 ? "무상제공" : "₩" + won(v);
    }

    /** 2026-08-04 → 2026년 08월 04일 */
    static String korDate(Object d) {
        String s = fmtDate(d);
        return s.matches("\\d{4}-\\d{2}-\\d{2}") ? s.substring(0, 4) + "년 " + s.substring(5, 7) + "월 " + s.substring(8, 10) + "일" : s;
    }

    static String fixed1(double v) {
        return String.format(Locale.ROOT, "%.1f", v);
    }

    /** 수량 — 인건비 공수는 2.0, 품목은 단위를 붙인다(1 식 · 2.0 MM · 10 계정). 단위가 비어 있으면 '식' */
    static String qtyText(double qty, String unit, boolean labor) {
        if (labor) return fixed1(qty);
        if ("MM".equalsIgnoreCase(unit)) return fixed1(qty) + " MM";
        return numText(qty) + " " + (unit == null || unit.isEmpty() ? "식" : esc(unit)); // 단위가 없으면 실측처럼 '식'
    }

    static String freeText(double v) {
        return v == 0 ? "무상제공" : won(v);
    }

    /**
     * 금액 0 행 합치기 — 행마다 1(따로), n&gt;1(금액 있는 행: 아래 n-1 행과 금액 칸을 합친다), 0(위 행에 합쳐짐).
     * 금액 있는 행(수량 &gt; 0) 바로 뒤로 같은 구분의 금액 0 행이 이어질 때만 합친다. Excel 도 같은 규칙
     */
    static int[] zeroSpans(List<Object> gubun, List<Double> amount, List<Double> qty) {
        int n = amount.size();
        int[] out = new int[n];
        java.util.Arrays.fill(out, 1);
        for (int i = 0; i < n; i++) {
            if (amount.get(i) == 0 || qty.get(i) == 0) continue;
            int j = i;
            while (j + 1 < n && amount.get(j + 1) == 0 && java.util.Objects.equals(gubun.get(j + 1), gubun.get(i))) j++;
            if (j == i) continue;
            out[i] = j - i + 1;
            for (int k = i + 1; k <= j; k++) out[k] = 0;
            i = j;
        }
        return out;
    }

    /** JS 숫자 → 문자열 (0.4, 1, 12) */
    static String numText(double v) {
        return Js.string(v);
    }

    static double num(Object v) {
        if (v == null) return 0;
        double d = Js.toNumber(v);
        return Double.isNaN(d) ? 0 : d;
    }

    static String str(Object v) {
        return v == null ? "" : String.valueOf(v);
    }

    static String or(Object v, String fallback) {
        return Rows.truthy(v) ? String.valueOf(v) : fallback;
    }

    static String firstNonEmpty(Object... vs) {
        for (Object v : vs) if (Rows.truthy(v)) return String.valueOf(v);
        return "";
    }

    static String fmtDate(Object d) {
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

    static String tag(String memo, String t) {
        Matcher m = Pattern.compile("\\[" + Pattern.quote(t) + "\\]\\s*(.+)").matcher(memo);
        return m.find() ? m.group(1).trim() : "";
    }

    static List<?> list(Object v) {
        return v instanceof List<?> l ? l : List.of();
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> maps(Object v) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : list(v)) if (o instanceof Map<?, ?> m) out.add((Map<String, Object>) m);
        return out;
    }

    private static final String CSS = """
            @page { size: A4; margin: 10mm 9mm; }
            * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
            body { font-family: 'Malgun Gothic','맑은 고딕','Noto Sans KR',sans-serif; color:#000; font-size:9.7px; margin:0; }
            .page { page-break-after: always; }
            .page:last-child { page-break-after: auto; }
            .page-break { page-break-before: always; height: 0; }
            table { width:100%; border-collapse:collapse; }
            table.grid { page-break-inside: auto; margin-bottom:2px; }
            table.grid tr { page-break-inside: avoid; }
            .c{text-align:center}.r{text-align:right}.b{font-weight:700}.muted{color:#888}
            /* 표지 */
            .cover { height: 275mm; display:flex; flex-direction:column; }
            .band img { width:100%; display:block; }
            .bandfb { height:9mm; display:flex; } .bandfb > div { flex:1; }
            .cover-title { margin-top:62mm; text-align:center; font-size:30px; font-weight:700; line-height:2.1; }
            .cust { margin:auto 0 0 48%; font-size:14px; font-weight:500; line-height:2; }
            .cover-logo { margin:22mm 2mm 4mm auto; text-align:right; font-size:11px; font-weight:700; }
            .cover-logo img { height:38px; display:block; margin-bottom:4px; }
            /* 견적서 틀 */
            .frame { border:1.5px solid #000; padding:5mm 4mm 4mm; }
            .top { display:flex; align-items:flex-end; gap:6px; }
            .top img { height:28px; }
            .top .addr { flex:1; text-align:right; font-size:10px; border-bottom:1.5px solid #5B9B2A; padding-bottom:3px; margin-bottom:6px; }
            h2.qt { text-align:center; font-family:Calibri,'Malgun Gothic',sans-serif; font-size:44px; font-weight:700; margin:8px 0 12px; line-height:1.25; }
            /* 밑줄은 글자 아래 선으로 — text-decoration 밑줄은 PDF 에서 아래가 잘린다(2026-11-04) */
            h2.qt span { display:inline-block; border-bottom:3px solid #000; line-height:1.1; padding-bottom:1px; }
            .hdr { display:flex; justify-content:space-between; align-items:flex-start; }
            .hbox td { border:1px solid #000; padding:3px 5px; height:22px; }
            .hbox.hl { width:62%; } .hbox.hr { width:30%; }
            .hbox .lbl { background:#FCEEB2; text-align:center; white-space:nowrap; width:76px; letter-spacing:2px; }
            .hbox.hr .lbl { width:64px; letter-spacing:1px; }
            .hbox .amt { color:#4472C4; font-weight:700; text-align:right; width:110px; }
            .hbox .unit { color:#4472C4; font-weight:700; font-size:8.5px; }
            .seal { position:relative; }
            .sealimg { position:absolute; left:28px; top:-22px; width:62px; height:62px; opacity:.9; }
            .note { margin:12px 0 4px; }
            .sec { font-weight:700; margin:14px 0 4px; font-size:10.5px; }
            .sec .u { float:right; font-weight:400; }
            table.grid td, table.grid th { border:1px solid #000; padding:3px 5px; vertical-align:middle; }
            table.grid th { background:#ADD505; font-weight:700; text-align:center; }
            .gubun { text-align:center; }
            .spec { white-space:pre-line; }
            tr.sum td { background:#ADD505; font-weight:700; }
            /* 견적조건 — 바깥 테두리만 실선, 줄마다 선은 긋지 않는다(2026-11-04 사용자 요청) */
            table.conds { border:1px solid #000; }
            table.conds td { border:0; padding:3px 8px; }
            table.conds tr:first-child td { padding-top:6px; }
            table.conds tr:last-child td { padding-bottom:6px; }
            /* 부록 */
            .apx { font-size:16px; font-weight:700; margin:6mm 0 4mm; }
            table.plan { table-layout:fixed; width:100%; }
            table.plan td { word-break:keep-all; overflow-wrap:anywhere; }
            table.plan .pm { padding:3px 1px; font-size:9px; text-align:center; }
            table.plan .pd { font-weight:400; font-size:8px; }
            .kosa { text-align:center; font-size:22px; font-weight:700; margin:4mm 0 5mm; }
            .formula { border:1px solid #000; border-radius:8px; padding:6px 10px; margin-bottom:6mm; font-size:10.5px; }
            .formula td { padding:1px 4px; }
            table.calc { margin-top:5mm; }
            .gubun.g { background:#ADD505; font-weight:700; }
            """;
}
