package kr.co.sepoasoft.quote.web;

import static kr.co.sepoasoft.quote.web.QuoteHtml.firstNonEmpty;
import static kr.co.sepoasoft.quote.web.QuoteHtml.fixed1;
import static kr.co.sepoasoft.quote.web.QuoteHtml.korDate;
import static kr.co.sepoasoft.quote.web.QuoteHtml.list;
import static kr.co.sepoasoft.quote.web.QuoteHtml.maps;
import static kr.co.sepoasoft.quote.web.QuoteHtml.num;
import static kr.co.sepoasoft.quote.web.QuoteHtml.str;
import static kr.co.sepoasoft.quote.web.QuoteHtml.tag;
import static kr.co.sepoasoft.quote.web.QuoteHtml.won;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.PrintSetup;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.VerticalAlignment;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.ss.util.RegionUtil;
import org.apache.poi.xssf.usermodel.XSSFCellStyle;
import org.apache.poi.xssf.usermodel.XSSFColor;
import org.apache.poi.xssf.usermodel.XSSFFont;
import org.apache.poi.xssf.usermodel.XSSFSheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Component;

/**
 * 견적서 Excel — 견적서 HTML({@link QuoteHtml})과 같은 양식(실측 창성 견적서): 머리 상자 · 블록 표(연두 머리행/소계행) ·
 * 표 안 합계 행 · 결제 방안 · 견적조건. 인력투입계획이 있으면 둘째 시트에 싣는다.
 * 금액 칸은 숫자(#,##0)라 받은 사람이 엑셀에서 그대로 고쳐 쓸 수 있다.
 *
 * <p>Node 의 ExcelJS 판(회색 양식)은 옮기지 않았다 — 견적서 양식이 바뀌어 HTML 과 어긋나기 때문이다.
 * 이미지(로고 · 인감)는 넣지 않는다(Node 도 그리기 오류로 껐다).
 */
@Component
public class QuoteExcel {

    private static final String[] CIRCLED = { "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨" };
    private static final byte[] GREEN = { (byte) 0xAD, (byte) 0xD5, 0x05 };
    private static final byte[] LABEL = { (byte) 0xFC, (byte) 0xEE, (byte) 0xB2 };
    private static final byte[] BLUE = { 0x44, 0x72, (byte) 0xC4 };

    private XSSFWorkbook wb;
    private final Map<String, CellStyle> styles = new LinkedHashMap<>();

    public synchronized byte[] build(Map<String, Object> quote, Map<String, Object> settings, Map<String, Object> masters) {
        wb = new XSSFWorkbook();
        styles.clear();
        try {
            quoteSheet(quote, settings, masters);
            planSheet(quote, masters);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            wb.write(out);
            wb.close();
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Excel 생성 실패", e);
        }
    }

    // ── 견적서 시트 ───────────────────────────────────────────────

    private void quoteSheet(Map<String, Object> q, Map<String, Object> settings, Map<String, Object> masters) {
        XSSFSheet ws = wb.createSheet("견적서");
        int[] widths = { 2, 16, 20, 40, 11, 15, 15, 16 }; // A 여백, B~H 내용
        for (int i = 0; i < widths.length; i++) ws.setColumnWidth(i, widths[i] * 256);
        PrintSetup ps = ws.getPrintSetup();
        ps.setPaperSize(PrintSetup.A4_PAPERSIZE);
        ws.setFitToPage(true);
        ps.setFitWidth((short) 1);
        ps.setFitHeight((short) 0);

        String memo = str(q.get("memo"));
        String purpose = tag(memo, "견적용도");
        String payTerms = tag(memo, "결제조건");
        if (payTerms.isEmpty()) payTerms = "고객사 결제조건";
        // 설정이 비어 있으면(빈 문자열 포함) 견적서 HTML 과 같은 기본값
        String supplier = QuoteHtml.or(settings.get("supplier_name"), "(주)세포아소프트");
        String ceo = QuoteHtml.or(settings.get("supplier_ceo"), "이 희 림");
        String addr = QuoteHtml.or(settings.get("supplier_addr"), "서울시 구로구 디지털로31길 62, 아티스포럼 714~717호");
        String tel = QuoteHtml.or(settings.get("supplier_tel"), "02-6242-3094");
        String customer = str(q.get("customer_name"));

        List<Map<String, Object>> blocks = maps(q.get("blocks"));
        double onetimeSub = 0, monthlySub = 0;
        int lastOnetime = -1, lastMonthly = -1, onetimeCount = 0;
        for (int i = 0; i < blocks.size(); i++) {
            Map<String, Object> b = blocks.get(i);
            if (QuoteCalc.truthy(b.get("recurring"))) { monthlySub += num(b.get("subtotal")); lastMonthly = i; }
            else { onetimeSub += num(b.get("subtotal")); lastOnetime = i; onetimeCount++; }
        }
        double onetimeTotal = num(q.get("onetime_total")), monthlyTotal = num(q.get("monthly_total"));
        boolean cloud = monthlyTotal != 0 || monthlySub != 0;

        int r = 0;
        text(ws, r, 1, addr + " ☎:" + tel, style("addr"));
        merge(ws, r, r, 1, 7);
        r += 1;
        Row t = ws.createRow(r);
        t.setHeightInPoints(40);
        text(ws, r, 1, "Quotation", style("title"));
        merge(ws, r, r, 1, 7);
        r += 2;

        // 머리 상자 — 왼쪽 B(라벨) C:E(값), 오른쪽 F(라벨) G:H(값)
        List<String[]> left = new ArrayList<>();
        left.add(new String[] { "수    신", customer.isEmpty() ? "" : customer + " 귀중" });
        left.add(new String[] { "견 적 용 도", purpose });
        left.add(new String[] { "결 제 조 건", payTerms });
        String[][] right = {
                { "견 적 번 호", str(q.get("quote_no")) }, { "견 적 일 자", korDate(q.get("quote_date")) },
                { "견적유효일", QuoteCalc.truthy(q.get("valid_until")) ? korDate(q.get("valid_until")) : "견적일로부터 30일" },
                { "상    호", supplier }, { "대 표 이 사", ceo + " (인)" } };
        int top = r;
        for (int i = 0; i < 3; i++) hdrLeft(ws, r + i, left.get(i)[0], left.get(i)[1]);
        r += 3;
        // 총견적가 — 클라우드는 셋업비용 · 월사용료 두 줄
        int grandRows = cloud ? 2 : 1;
        for (int i = 0; i < grandRows; i++) {
            boolean mon = i == 1;
            double v = mon ? monthlyTotal : onetimeTotal;
            cell(ws, r + i, 1, i == 0 ? "총 견 적 가" : "", style("label"));
            cell(ws, r + i, 2, v == 0 && !mon ? "무상제공" : "₩" + won(v), style("amt"));
            cell(ws, r + i, 3, cloud ? (mon ? "클라우드서비스 월사용료(단위 : 원, 부가세 별도)" : "클라우드서비스 셋업비용(단위 : 원, 부가세 별도)")
                    : "(단위 : 원, 부가세 별도)", style("unit"));
            cell(ws, r + i, 4, "", style("unit"));
            merge(ws, r + i, r + i, 3, 4);
        }
        if (grandRows == 2) merge(ws, r, r + 1, 1, 1);
        r += grandRows;
        hdrLeft(ws, r, "설 치 완 료", "협의된 프로젝트 기간");
        for (int i = 0; i < right.length; i++) {
            cell(ws, top + i, 5, right[i][0], style("label"));
            cell(ws, top + i, 6, right[i][1], style("val"));
            cell(ws, top + i, 7, "", style("val"));
            merge(ws, top + i, top + i, 6, 7);
        }
        r += 2;
        text(ws, r, 1, "하기와 같이 견적하오니 참조 바랍니다.", style("plain"));
        r += 2;

        // 블록 표
        @SuppressWarnings("unchecked")
        Map<String, Object> defs = masters.get("blockDefs") instanceof Map<?, ?> d ? (Map<String, Object>) d : Map.of();
        int seq = 0;
        List<String> marks = new ArrayList<>();
        for (int i = 0; i < blocks.size(); i++) {
            Map<String, Object> b = blocks.get(i);
            boolean rec = QuoteCalc.truthy(b.get("recurring"));
            String mark = !rec && onetimeCount >= 2 && seq < CIRCLED.length ? CIRCLED[seq++] : "";
            if (!mark.isEmpty()) marks.add(mark);
            r = blockTable(ws, r, b, defs, mark, masters);
            if (i == lastOnetime) {
                if (onetimeCount >= 2) r = sumRow(ws, r, "구축금액 Total (" + String.join("+", marks) + ")", null, onetimeSub);
                if (onetimeSub - onetimeTotal > 0) {
                    if (onetimeTotal == 0) r = sumRowText(ws, r, "제안금액(특별 DC 적용)", "무상제공");
                    else r = sumRow(ws, r, "제안금액(특별 DC 적용)", null, onetimeTotal);
                }
            }
            if (i == lastMonthly && monthlySub - monthlyTotal > 0) r = sumRow(ws, r, "월 사용료(특별 DC 적용)", null, monthlyTotal);
            r += 1;
        }

        // 결제 방안 — 견적서 HTML 과 같은 규칙(QuoteHtml.payPlanOn · payPlanRows)
        if (QuoteHtml.payPlanOn(q, masters)) {
            String sol = str(masters.get("solutionName"));
            text(ws, r, 1, "▣ " + (sol.isEmpty() ? "" : sol + " ") + "클라우드서비스 결제 방안", style("sec"));
            r += 1;
            head(ws, r, new String[] { "구분", "지급시점", "비용", "", "내역", "", "" });
            merge(ws, r, r, 3, 4);
            merge(ws, r, r, 5, 7);
            r += 1;
            for (String[] v : QuoteHtml.payPlanRows(q, onetimeTotal, monthlyTotal)) {
                Row row = ws.createRow(r);
                int lines = 1;
                for (String x : v) lines = Math.max(lines, x.split("\n").length);
                row.setHeightInPoints(Math.max(20, 15 * lines));
                cell(ws, r, 1, v[0], style("cwrap"));
                cell(ws, r, 2, v[1], style("wrap"));
                cell(ws, r, 3, v[2], style("wrap"));
                cell(ws, r, 4, "", style("wrap"));
                cell(ws, r, 5, v[3], style("wrap"));
                cell(ws, r, 6, "", style("wrap"));
                cell(ws, r, 7, "", style("wrap"));
                merge(ws, r, r, 3, 4);
                merge(ws, r, r, 5, 7);
                r += 1;
            }
            r += 1;
        }

        // 견적조건 — 견적서 HTML 과 같은 규칙(뺀 견적은 싣지 않는다)
        List<String> conds = QuoteHtml.conditionLines(q, masters);
        if (conds.isEmpty()) return;
        text(ws, r, 1, "▣ 견적조건", style("sec"));
        r += 1;
        // 바깥 테두리만 실선 — 줄마다 선은 긋지 않는다(견적서 HTML 과 같다, 2026-11-04 사용자 요청)
        int first = r;
        for (String c : conds) {
            cell(ws, r, 1, "-. " + c, style("condL"));
            for (int col = 2; col <= 7; col++) cell(ws, r, col, "", style("condL"));
            merge(ws, r, r, 1, 7);
            r += 1;
        }
        CellRangeAddress box = new CellRangeAddress(first, r - 1, 1, 7);
        RegionUtil.setBorderTop(BorderStyle.THIN, box, ws);
        RegionUtil.setBorderBottom(BorderStyle.THIN, box, ws);
        RegionUtil.setBorderLeft(BorderStyle.THIN, box, ws);
        RegionUtil.setBorderRight(BorderStyle.THIN, box, ws);
    }

    private void hdrLeft(XSSFSheet ws, int r, String label, String value) {
        cell(ws, r, 1, label, style("label"));
        cell(ws, r, 2, value, style("val"));
        cell(ws, r, 3, "", style("val"));
        cell(ws, r, 4, "", style("val"));
        merge(ws, r, r, 2, 4);
    }

    /** 블록 1개 — 머리행 · 품목/인력 행(같은 구분은 세로로 묶는다) · 소계 행. 다음 줄 번호를 돌려준다 */
    private int blockTable(XSSFSheet ws, int r, Map<String, Object> b, Map<String, Object> defs, String mark, Map<String, Object> masters) {
        String code = str(b.get("block_code"));
        boolean isLabor = "LABOR".equals(code);
        boolean rec = QuoteCalc.truthy(b.get("recurring"));
        Map<?, ?> def = defs.get(code) instanceof Map<?, ?> d ? d : Map.of();
        String title = firstNonEmpty(b.get("title"), def.get("name"), code);
        // SaaS 서비스 비용 모듈 묶음 — 견적서(QuoteHtml)와 같은 규칙: 서비스 이용료 행(note 'BAND:…') 뒤 모듈 행(…_SAAS_M01, 수량 0)에 수량 · 단가 · 금액을 합친다
        List<Map<String, Object>> items = new ArrayList<>(maps(b.get("items")));
        int bundleAt = -1, bundleN = 0;
        String bundleTitle = null, bQty = null;
        double bBase = 0, bProposed = 0, bAmount = 0;
        for (int i = 0; !isLabor && i < items.size(); i++) {
            String note = str(items.get(i).get("note"));
            if (!note.startsWith("BAND:")) continue;
            int n = 0;
            while (i + 1 + n < items.size() && str(items.get(i + 1 + n).get("item_code")).matches(".*_SAAS_M\\d+$") && num(items.get(i + 1 + n).get("qty")) == 0) n++;
            if (n == 0) continue;
            String[] parts = note.split(":");
            boolean count = parts.length > 1 && "COUNT".equals(parts[1]);
            double bq = parts.length > 2 ? num(parts[2]) : 0;
            Map<String, Object> svc = items.get(i);
            bAmount = num(svc.get("amount"));
            Object ub = masters.get("saasUnitBase") instanceof Map<?, ?> m ? m.get(str(svc.get("item_code"))) : null;
            bBase = ub == null ? 0 : num(ub);
            bProposed = bq > 0 ? Math.round(bAmount / bq) : num(svc.get("proposed_price"));
            bQty = bq > 0 ? QuoteHtml.numText(bq) + (count ? " 건" : " 계정") : QuoteHtml.qtyText(num(svc.get("qty")), str(svc.get("unit")), false);
            if (bq > 0) bundleTitle = count ? "월 " + QuoteHtml.numText(bq) + "건 이하"
                    : ("PROCURE".equals(str(masters.get("solution"))) ? "구매담당자 " : "사용자 ") + QuoteHtml.numText(bq) + "계정 이하";
            items.remove(i);
            bundleAt = i;
            bundleN = n;
            break;
        }
        String brand = bundleAt >= 0 ? str(masters.get("brand")) : "";
        text(ws, r, 1, "▣ " + (bundleTitle != null ? "서비스 비용 (" + bundleTitle + ")" : title), style("sec"));
        cell(ws, r, 7, "(단위 : 원)", style("unitR"));
        r += 1;
        head(ws, r, new String[] { "구분", isLabor ? "역할" : rec ? "시스템" : "모듈", isLabor ? "세부내역" : "세부기능",
                isLabor ? "공수(MM)" : "수량", "기준단가", rec ? "제안단가(월)" : "제안단가", rec ? "제안금액(월)" : "제안금액" });
        r += 1;

        List<Object[]> rows = new ArrayList<>(); // gubun, name, spec, qty, unit, base, proposed, amount, labor
        for (Map<String, Object> it : items) {
            rows.add(new Object[] { brand.isEmpty() ? firstNonEmpty(it.get("category"), title) : brand, str(it.get("name")), str(it.get("spec")), num(it.get("qty")),
                    str(it.get("unit")), it.get("base_price"), it.get("proposed_price") != null ? it.get("proposed_price") : it.get("unit_price"),
                    num(it.get("amount")), false });
        }
        double mmSum = 0;
        if (isLabor) for (Map<String, Object> l : maps(b.get("labor"))) {
            rows.add(new Object[] { firstNonEmpty(l.get("category"), "시스템구축 개발인건비"), firstNonEmpty(l.get("role_label"), l.get("role_name"), l.get("role_code")),
                    str(l.get("task")), num(l.get("mm")), "MM", l.get("base_price"), l.get("proposed_price"), num(l.get("amount")), true });
            mmSum += num(l.get("mm"));
        }
        // 금액 0 행 합치기 — 견적서(QuoteHtml.zeroSpans)와 같은 규칙. 기준단가 · 제안단가 · 제안금액 칸을 위 행과 한 칸으로
        int[] zs = new int[rows.size()];
        java.util.Arrays.fill(zs, 1);
        if (!isLabor && bundleAt < 0) {
            List<Object> gubuns = new ArrayList<>();
            List<Double> amounts = new ArrayList<>(), qtys = new ArrayList<>();
            for (Object[] v : rows) { gubuns.add(v[0]); qtys.add((double) v[3]); amounts.add((double) v[7]); }
            zs = QuoteHtml.zeroSpans(gubuns, amounts, qtys);
        }
        int start = r;
        for (int i = 0; i < rows.size(); i++) {
            Object[] v = rows.get(i);
            double qty = (double) v[3];
            Row row = ws.createRow(r);
            row.setHeightInPoints(Math.max(18, 15 * Math.min(4, 1 + str(v[2]).length() / 30)));
            cell(ws, r, 1, (String) v[0], style("cwrap"));
            cell(ws, r, 2, (String) v[1], style("cwrap"));
            cell(ws, r, 3, (String) v[2], style("wrap"));
            if (i == bundleAt) { // 모듈 묶음 첫 행 — 합친 칸
                cell(ws, r, 4, bQty, style("center"));
                if (bBase > 0) money(ws, r, 5, bBase, style("money")); else cell(ws, r, 5, "", style("val"));
                money(ws, r, 6, bProposed, style("money"));
                money(ws, r, 7, bAmount, style("money"));
            } else if (zs[i] == 0) { // 위 행과 합친 금액 칸 — 수량만
                cell(ws, r, 4, qty == 0 ? "" : QuoteHtml.qtyText(qty, (String) v[4], (boolean) v[8]), style("center"));
                for (int c = 5; c <= 7; c++) cell(ws, r, c, "", style("val"));
            } else if (bundleAt >= 0 && i > bundleAt && i < bundleAt + bundleN) {
                for (int c = 4; c <= 7; c++) cell(ws, r, c, "", style("val"));
            } else if (qty == 0) { // 묶음에 포함된 참고 행 — 수량 · 단가 · 금액을 비운다
                for (int c = 4; c <= 7; c++) cell(ws, r, c, "", style("val"));
            } else {
                cell(ws, r, 4, QuoteHtml.qtyText(qty, (String) v[4], (boolean) v[8]), style("center"));
                if (v[5] != null && num(v[5]) > 0) money(ws, r, 5, num(v[5]), style("money")); else cell(ws, r, 5, "", style("val"));
                money(ws, r, 6, num(v[6]), style("money"));
                money(ws, r, 7, (double) v[7], style("money"));
            }
            r += 1;
        }
        // 같은 구분이 이어지면 세로로 묶는다
        for (int i = 0; i < rows.size(); ) {
            int j = i;
            while (j + 1 < rows.size() && rows.get(j + 1)[0].equals(rows.get(i)[0])) j++;
            if (j > i) merge(ws, start + i, start + j, 1, 1);
            i = j + 1;
        }
        if (bundleN > 1) for (int c = 4; c <= 7; c++) merge(ws, start + bundleAt, start + bundleAt + bundleN - 1, c, c);
        for (int i = 0; i < zs.length; i++) if (zs[i] > 1) for (int c = 5; c <= 7; c++) merge(ws, start + i, start + i + zs[i] - 1, c, c);
        if (rows.isEmpty()) {
            cell(ws, r, 1, "(항목 없음)", style("center"));
            for (int c = 2; c <= 7; c++) cell(ws, r, c, "", style("val"));
            merge(ws, r, r, 1, 7);
            r += 1;
        }
        String subLabel = isLabor ? "인건비 소계" : bundleTitle != null ? "서비스 사용료 소계" : title.endsWith("소계") ? title : title + " 소계";
        return sumRow(ws, r, subLabel + (mark.isEmpty() ? "" : "(" + mark + ")"), isLabor ? fixed1(mmSum) : null, num(b.get("subtotal")));
    }

    private int sumRow(XSSFSheet ws, int r, String label, String qty, double amount) {
        sumLabel(ws, r, label, qty);
        money(ws, r, 7, amount, style("sumMoney"));
        return r + 1;
    }

    private int sumRowText(XSSFSheet ws, int r, String label, String value) {
        sumLabel(ws, r, label, null);
        cell(ws, r, 7, value, style("sumR"));
        return r + 1;
    }

    private void sumLabel(XSSFSheet ws, int r, String label, String qty) {
        cell(ws, r, 1, label, style("sum"));
        cell(ws, r, 2, "", style("sum"));
        cell(ws, r, 3, "", style("sum"));
        merge(ws, r, r, 1, 3);
        cell(ws, r, 4, qty == null ? "" : qty, style("sum"));
        cell(ws, r, 5, "", style("sum"));
        cell(ws, r, 6, "", style("sum"));
    }

    private void head(XSSFSheet ws, int r, String[] labels) {
        Row row = ws.createRow(r);
        row.setHeightInPoints(20);
        for (int i = 0; i < labels.length; i++) cell(ws, r, i + 1, labels[i], style("head"));
    }

    // ── 인력투입계획 시트 ────────────────────────────────────────────

    private void planSheet(Map<String, Object> q, Map<String, Object> masters) {
        List<Map<String, Object>> plan = new ArrayList<>();
        for (Map<String, Object> b : maps(q.get("blocks"))) for (Map<String, Object> l : maps(b.get("labor"))) {
            if (l.get("month_alloc") instanceof Map<?, ?> a && !a.isEmpty()) plan.add(l);
        }
        if (plan.isEmpty()) return;
        XSSFSheet ws = wb.createSheet("인력투입계획");
        Set<String> keySet = new TreeSet<>((a, b) -> a.equals("M") ? (b.equals("M") ? 0 : -1) : b.equals("M") ? 1
                : Integer.compare(parse(a.substring(1)), parse(b.substring(1))) != 0 ? Integer.compare(parse(a.substring(1)), parse(b.substring(1))) : a.compareTo(b));
        for (Map<String, Object> l : plan) for (Object k : ((Map<?, ?>) l.get("month_alloc")).keySet()) keySet.add(String.valueOf(k));
        List<String> keys = new ArrayList<>(keySet);
        Map<String, Object> roleNames = new LinkedHashMap<>();
        for (Map<String, Object> rr : maps(masters.get("laborRates"))) roleNames.put(str(rr.get("role_code")), rr.get("role_name"));
        ws.setColumnWidth(0, 2 * 256);
        ws.setColumnWidth(1, 12 * 256);
        ws.setColumnWidth(2, 22 * 256);
        ws.setColumnWidth(3, 40 * 256);
        for (int i = 0; i <= keys.size(); i++) ws.setColumnWidth(4 + i, 9 * 256);
        String dep = QuoteHtml.DEP_LABEL.getOrDefault(str(q.get("deployment")), "");
        text(ws, 0, 1, "#. 인력투입계획" + (dep.isEmpty() ? "" : " (" + dep + ")"), style("sec"));
        List<String> heads = new ArrayList<>(List.of("역할", "등급", "내역"));
        heads.addAll(keys);
        heads.add("합계");
        head(ws, 2, heads.toArray(String[]::new));
        int r = 3;
        double[] col = new double[keys.size()];
        double grand = 0;
        for (Map<String, Object> l : plan) {
            Map<?, ?> a = (Map<?, ?>) l.get("month_alloc");
            cell(ws, r, 1, firstNonEmpty(l.get("role_label"), l.get("role_name"), l.get("role_code")), style("center"));
            cell(ws, r, 2, firstNonEmpty(l.get("role_name"), roleNames.get(str(l.get("role_code")))), style("center"));
            cell(ws, r, 3, str(l.get("task")), style("wrap"));
            for (int i = 0; i < keys.size(); i++) {
                double v = num(a.get(keys.get(i)));
                col[i] += v;
                if (v != 0) number(ws, r, 4 + i, v, style("mm")); else cell(ws, r, 4 + i, "", style("val"));
            }
            grand += num(l.get("mm"));
            number(ws, r, 4 + keys.size(), num(l.get("mm")), style("mm"));
            r += 1;
        }
        cell(ws, r, 1, "합계(M/M)", style("sum"));
        cell(ws, r, 2, "", style("sum"));
        cell(ws, r, 3, "", style("sum"));
        merge(ws, r, r, 1, 3);
        for (int i = 0; i < keys.size(); i++) number(ws, r, 4 + i, col[i], style("sumMm"));
        number(ws, r, 4 + keys.size(), grand, style("sumMm"));
    }

    private static int parse(String s) {
        try { return Integer.parseInt(s); } catch (NumberFormatException e) { return 0; }
    }

    // ── 칸 · 모양 ────────────────────────────────────────────────

    private static Cell at(XSSFSheet ws, int r, int c) {
        Row row = ws.getRow(r) == null ? ws.createRow(r) : ws.getRow(r);
        return row.getCell(c) == null ? row.createCell(c) : row.getCell(c);
    }

    private static void cell(XSSFSheet ws, int r, int c, String v, CellStyle s) {
        Cell cell = at(ws, r, c);
        cell.setCellValue(v);
        cell.setCellStyle(s);
    }

    private static void text(XSSFSheet ws, int r, int c, String v, CellStyle s) {
        cell(ws, r, c, v, s);
    }

    private static void money(XSSFSheet ws, int r, int c, double v, CellStyle s) {
        Cell cell = at(ws, r, c);
        cell.setCellValue(v);
        cell.setCellStyle(s);
    }

    private static void number(XSSFSheet ws, int r, int c, double v, CellStyle s) {
        money(ws, r, c, v, s);
    }

    private static void merge(XSSFSheet ws, int r1, int r2, int c1, int c2) {
        if (r1 == r2 && c1 == c2) return;
        CellRangeAddress a = new CellRangeAddress(r1, r2, c1, c2);
        ws.addMergedRegion(a);
        if (hasBorder(ws, r1, c1)) { // 테두리 있는 칸을 합치면 합친 영역 바깥선을 다시 긋는다
            RegionUtil.setBorderTop(BorderStyle.THIN, a, ws);
            RegionUtil.setBorderBottom(BorderStyle.THIN, a, ws);
            RegionUtil.setBorderLeft(BorderStyle.THIN, a, ws);
            RegionUtil.setBorderRight(BorderStyle.THIN, a, ws);
        }
    }

    private static boolean hasBorder(XSSFSheet ws, int r, int c) {
        Row row = ws.getRow(r);
        Cell cell = row == null ? null : row.getCell(c);
        return cell != null && cell.getCellStyle().getBorderTop() == BorderStyle.THIN;
    }

    private CellStyle style(String key) {
        return styles.computeIfAbsent(key, k -> {
            XSSFCellStyle s = wb.createCellStyle();
            XSSFFont f = wb.createFont();
            f.setFontName("맑은 고딕");
            f.setFontHeightInPoints((short) 9);
            s.setVerticalAlignment(VerticalAlignment.CENTER);
            boolean boxed = !Set.of("addr", "title", "plain", "sec", "unitR", "condL").contains(k);
            if (boxed) {
                s.setBorderTop(BorderStyle.THIN);
                s.setBorderBottom(BorderStyle.THIN);
                s.setBorderLeft(BorderStyle.THIN);
                s.setBorderRight(BorderStyle.THIN);
            }
            switch (k) {
                case "addr" -> s.setAlignment(HorizontalAlignment.RIGHT);
                case "title" -> {
                    f.setFontName("Calibri");
                    f.setFontHeightInPoints((short) 28);
                    f.setBold(true);
                    f.setUnderline(Font.U_SINGLE);
                    s.setAlignment(HorizontalAlignment.CENTER);
                }
                case "sec" -> { f.setBold(true); f.setFontHeightInPoints((short) 10); }
                case "unitR" -> s.setAlignment(HorizontalAlignment.RIGHT);
                case "label" -> { fill(s, LABEL); s.setAlignment(HorizontalAlignment.CENTER); }
                case "amt" -> { f.setBold(true); f.setColor(new XSSFColor(BLUE, null)); s.setAlignment(HorizontalAlignment.RIGHT); }
                case "unit" -> { f.setBold(true); f.setFontHeightInPoints((short) 8); f.setColor(new XSSFColor(BLUE, null)); }
                case "head" -> { fill(s, GREEN); f.setBold(true); s.setAlignment(HorizontalAlignment.CENTER); s.setWrapText(true); }
                case "sum" -> { fill(s, GREEN); f.setBold(true); s.setAlignment(HorizontalAlignment.CENTER); }
                case "sumR" -> { fill(s, GREEN); f.setBold(true); s.setAlignment(HorizontalAlignment.RIGHT); }
                case "sumMoney" -> { fill(s, GREEN); f.setBold(true); s.setDataFormat(wb.createDataFormat().getFormat("#,##0")); }
                case "sumMm" -> { fill(s, GREEN); f.setBold(true); s.setDataFormat(wb.createDataFormat().getFormat("0.0")); }
                case "money" -> s.setDataFormat(wb.createDataFormat().getFormat("#,##0"));
                case "mm" -> s.setDataFormat(wb.createDataFormat().getFormat("0.0"));
                case "center" -> s.setAlignment(HorizontalAlignment.CENTER);
                case "cwrap" -> { s.setAlignment(HorizontalAlignment.CENTER); s.setWrapText(true); }
                case "wrap", "wrapL", "condL" -> s.setWrapText(true);
                default -> { }
            }
            s.setFont(f);
            return s;
        });
    }

    private static void fill(XSSFCellStyle s, byte[] rgb) {
        s.setFillForegroundColor(new XSSFColor(rgb, null));
        s.setFillPattern(FillPatternType.SOLID_FOREGROUND);
    }
}
