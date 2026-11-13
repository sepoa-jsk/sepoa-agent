package kr.co.sepoasoft.quote.web;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

/**
 * 노임단가표 읽기 — 한국SW산업협회 'SW기술자 평균임금' 표(PDF · 협회 공표 엑셀)에서 직무별 노임단가(M/D)를 뽑는다.
 *
 * <p>문서마다 표 모양이 조금씩 다르다(견적서 끝장의 요약표: 구분 · 전년 M/D · 올해 M/D · M/M · M/H · 비고,
 * 협회 원문: 직무 · M/M · M/D · M/H …). 그래서 칸 위치가 아니라 <b>값의 크기</b>로 노임단가를 고른다:
 * 한 행에서 15만 이상 300만 미만인 정수가 M/D 다(M/M 은 수백만, M/H 는 수만 — 2026년 최고 M/H 61,618).
 * M/D 후보가 둘 이상이면 머리행의 연도(2025년 2026년)와 짝지어 입력한 연도의 칸을 쓴다.
 *
 * <p>나머지는 산정식으로 계산한다 — 문서의 계산표와 같은 식이고, 2026년 값으로 맞춰 봤다.
 * 평균임금(M/M) = 노임×근무일 → 제경비 = 평균임금×110% → 기술료 = (평균임금+제경비)×20% → 적용단가 = 합.
 * 근무일은 해마다 다르다(2026년 20.5일, 2025 · 2024년 20.6일) — 문서의 "월 임금 ÷ 20.5(일)" 문구에서 읽는다.
 */
public final class LaborRateSheet {

    private LaborRateSheet() {
    }

    /** PDF → 글자. 위치 순으로 정렬해 표의 한 행이 한 줄로 나오게 한다 */
    public static String text(byte[] pdf) throws IOException {
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            PDFTextStripper s = new PDFTextStripper();
            s.setSortByPosition(true);
            return s.getText(doc);
        }
    }

    // 행: 이름(한글·영문·공백·/) + 숫자 3개 이상 + (비고)
    private static final Pattern ROW = Pattern.compile("^\\s*([가-힣A-Za-z][가-힣A-Za-z/ ]*?)\\s+((?:[\\d,.]+\\s+){2,}[\\d,.]+)(?:\\s+(.*))?$");
    private static final Pattern YEAR = Pattern.compile("(20\\d{2})\\s*년");
    private static final Set<String> NOT_ROLE = Set.of("계", "합계", "항목", "구분", "제경비", "기술료", "평균임금");

    /**
     * 산정식 — 협회 문서의 계산표와 같은 방식: 중간값은 반올림하지 않고, 각 칸은 보여 줄 때만 반올림하며,
     * 적용단가는 반올림 전 세 값의 합을 반올림한다. 문서에 계가 찍힌 4종(컨설턴트·PM·응용SW·UI/UX)과 원 단위까지 같다.
     * (IT PM: 10,086,799.5 + 11,095,479.45 + 4,236,455.79 = 25,418,734.74 → 25,418,735.
     *  칸을 먼저 반올림해 더하면 25,418,736 이 된다.)
     */
    public static Map<String, Object> compute(long md, BigDecimal workDays) {
        BigDecimal mm = BigDecimal.valueOf(md).multiply(workDays);
        BigDecimal overhead = mm.multiply(new BigDecimal("1.1"));
        BigDecimal tech = mm.add(overhead).multiply(new BigDecimal("0.2"));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("wage_md", md);
        m.put("wage_mm", won(mm));
        m.put("overhead", won(overhead));
        m.put("tech_fee", won(tech));
        long apply = won(mm.add(overhead).add(tech));
        m.put("apply_price", apply);
        m.put("company_price", floorMillion(apply)); // 회사 기준단가 — 백만원 미만 절사(화면에서 고칠 수 있다)
        return m;
    }

    /**
     * 협회 공표 엑셀(2026년_적용_SW기술자_평균임금_공표.xlsx) → 시트마다 글자. 첫 시트가 결과 표(구분 · M/M · M/D · M/H · 포함직무)다.
     * 한 행 = 한 줄, 칸 사이는 공백. 직무 앞 번호(⑤)는 떼고 칸 안 줄바꿈은 공백으로 — PDF 와 같은 {@link #parse} 로 읽는다.
     */
    public static List<String> xlsxSheets(byte[] xlsx) throws IOException {
        List<String> out = new ArrayList<>();
        DataFormatter fmt = new DataFormatter();
        try (Workbook wb = new XSSFWorkbook(new java.io.ByteArrayInputStream(xlsx))) {
            for (Sheet sh : wb) {
                StringBuilder sb = new StringBuilder();
                for (Row row : sh) {
                    List<String> cells = new ArrayList<>();
                    for (Cell c : row) {
                        CellType t = c.getCellType() == CellType.FORMULA ? c.getCachedFormulaResultType() : c.getCellType();
                        double n = t == CellType.NUMERIC ? c.getNumericCellValue() : 0;
                        String v = t == CellType.NUMERIC
                                ? (n == Math.rint(n) ? String.valueOf((long) n) : BigDecimal.valueOf(n).toPlainString())
                                : t == CellType.STRING ? c.getStringCellValue() : fmt.formatCellValue(c);
                        v = v.replaceAll("[\\u2460-\\u2473]", "").replaceAll("\\s+", " ").trim();
                        if (!v.isEmpty() && (cells.isEmpty() || !cells.get(cells.size() - 1).equals(v))) cells.add(v); // 병합 칸 반복은 한 번만
                    }
                    if (!cells.isEmpty()) sb.append(String.join(" ", cells)).append('\n');
                }
                out.add(sb.toString());
            }
        }
        return out;
    }

    // "일 임금 = 월 임금 ÷ 20.5(일)" — 협회 문서의 근무일
    private static final Pattern WORK_DAYS = Pattern.compile("÷\\s*(\\d{2}(?:\\.\\d)?)\\s*\\(\\s*일");

    /** 문서 글자에서 근무일을 찾는다(15~25일). 없으면 null */
    public static BigDecimal workDays(String text) {
        Matcher m = WORK_DAYS.matcher(text);
        if (!m.find()) return null;
        BigDecimal d = new BigDecimal(m.group(1));
        return d.compareTo(new BigDecimal("15")) >= 0 && d.compareTo(new BigDecimal("25")) <= 0 ? d : null;
    }

    /** 백만원 미만 절사 — 회사 기준단가 자동값 */
    public static long floorMillion(double v) {
        return (long) Math.floor(v / 1_000_000d) * 1_000_000L;
    }

    private static long won(BigDecimal v) {
        return v.setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    /**
     * 글자 → 직무 행. {@code rows} 는 [{role_name, wage_md, doc_note}] 이고 {@code warnings} 에 확인할 점을 담는다.
     */
    public static Map<String, Object> parse(String text, int year, BigDecimal workDays) {
        List<String> warnings = new ArrayList<>();
        // 머리행 연도 — 한 줄에 연도가 둘 이상 나오는 첫 줄 (예: "2025년 2026년")
        List<Integer> headerYears = new ArrayList<>();
        Set<Integer> mentioned = new LinkedHashSet<>();
        for (String line : text.split("\\R")) {
            Matcher y = YEAR.matcher(line);
            List<Integer> ys = new ArrayList<>();
            while (y.find()) ys.add(Integer.valueOf(y.group(1)));
            mentioned.addAll(ys);
            if (headerYears.isEmpty() && ys.size() >= 2 && !line.contains("월")) headerYears.addAll(ys);
        }

        List<Map<String, Object>> rows = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        boolean yearMismatch = false;
        for (String line : text.split("\\R")) {
            Matcher m = ROW.matcher(line);
            if (!m.matches()) continue;
            String name = m.group(1).trim().replaceAll("\\s+", " ");
            if (NOT_ROLE.contains(name.replace(" ", "")) || name.length() < 2) continue;
            List<Long> nums = new ArrayList<>();
            boolean decimal = false;
            for (String tok : m.group(2).trim().split("\\s+")) {
                if (tok.contains(".")) { decimal = true; break; }
                String d = tok.replace(",", "");
                if (d.isEmpty()) continue;
                nums.add(Long.valueOf(d));
            }
            if (decimal) continue; // 계산표(요율 20.5 · 1.1) 행은 건너뛴다
            List<Long> md = new ArrayList<>();
            for (long n : nums) if (n >= 150_000 && n < 3_000_000) md.add(n);
            if (md.isEmpty()) continue;
            long pick;
            if (md.size() >= 2 && headerYears.size() == md.size()) {
                int i = headerYears.indexOf(year);
                if (i < 0) { i = md.size() - 1; yearMismatch = true; }
                pick = md.get(i);
            } else {
                pick = md.get(md.size() - 1);
            }
            String key = name.replace(" ", "");
            if (!seen.add(key)) continue;
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("role_name", name);
            r.putAll(compute(pick, workDays));
            r.put("doc_note", m.group(3) == null ? "" : m.group(3).trim());
            rows.add(r);
        }
        if (rows.isEmpty()) warnings.add("문서에서 노임단가 표를 찾지 못했습니다. 한국SW산업협회 SW기술자 평균임금 표가 들어 있는 PDF 인지 확인하세요.");
        if (yearMismatch) warnings.add("문서 표의 연도(" + headerYears + ")에 " + year + "년이 없어 가장 최근 연도 칸을 읽었습니다.");
        else if (!mentioned.isEmpty() && !mentioned.contains(year)) warnings.add("문서에 " + year + "년 표기가 없습니다. 연도를 확인하세요.");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("year", year);
        out.put("header_years", headerYears);
        out.put("work_days", workDays);
        out.put("rows", rows);
        out.put("warnings", warnings);
        return out;
    }
}
