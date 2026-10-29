package kr.co.sepoasoft.quote.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/** {@code /api/labor-rates} — Node {@code routes/labor-rates.js} 이식. 명세 2-8절. 쓰기(#38~#40)는 관리자만. */
@RestController
@RequestMapping("/api/labor-rates")
@Access(Level.LOGIN)
public class LaborRateController {

    private static final List<String> RATE_COLS = List.of(
            "role_name", "grade", "wage_md", "wage_mm", "overhead", "tech_fee", "apply_price", "note");

    private final Rows db;

    public LaborRateController(Rows db) {
        this.db = db;
    }

    /** #36 연도 목록 (active 표시 + 라인 수) */
    @GetMapping("/years")
    public Map<String, Object> years() {
        return Map.of("years", db.query(
                "SELECT y.id, y.`year`, y.source, y.active,"
                        + " (SELECT COUNT(*) FROM sq_labor_rate_lines r WHERE r.year_id = y.id) AS rate_count"
                        + " FROM sq_labor_rate_years y"
                        + " ORDER BY y.`year` DESC"));
    }

    /**
     * #37 특정 연도 단가 목록 — {@code year} 가 없으면 active 연도, 그것도 없으면 최신 연도.
     * Node 는 {@code Number(year)} 로 찾으므로 숫자가 아닌 값은 어떤 연도와도 맞지 않는다.
     */
    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String year) {
        Map<String, Object> yearRow;
        if (year != null && !year.isEmpty()) {
            double y = Js.number(year);
            yearRow = Double.isNaN(y) ? null
                    : db.first("SELECT * FROM sq_labor_rate_years WHERE `year` = ?", Js.json(y));
        } else {
            yearRow = db.first("SELECT * FROM sq_labor_rate_years WHERE active = 1 LIMIT 1");
            if (yearRow == null) yearRow = db.first("SELECT * FROM sq_labor_rate_years ORDER BY `year` DESC LIMIT 1");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        if (yearRow == null) {
            out.put("year", null);
            out.put("rates", List.of());
            return out;
        }
        out.put("year", yearRow.get("year"));
        out.put("year_id", yearRow.get("id"));
        out.put("source", yearRow.get("source"));
        out.put("active", yearRow.get("active"));
        out.put("rates", db.query("SELECT * FROM sq_labor_rate_lines WHERE year_id = ? ORDER BY sort, id", yearRow.get("id")));
        return out;
    }

    /** #38 새 연도 — {@code clone_from_year} 를 주면 그 연도 단가를 복제한다. 새 연도는 비활성으로 만든다 */
    @PostMapping("/years")
    @Access(Level.ADMIN)
    @Transactional
    public ResponseEntity<Map<String, Object>> createYear(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        double year = Js.toNumber(b.containsKey("year") ? b.get("year") : "x");
        Object source = b.get("source");
        Double cloneFrom = QuoteCalc.truthy(b.get("clone_from_year")) ? Js.toNumber(b.get("clone_from_year")) : null;
        if (!Js.truthy(year) || year < 2000 || year > 2100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_YEAR", "연도가 올바르지 않습니다.");
        }
        Number y = Js.json(year);
        if (db.first("SELECT id FROM sq_labor_rate_years WHERE `year` = ?", y) != null) {
            throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_YEAR", y + "년은 이미 존재합니다.");
        }
        long newId = db.insert("INSERT INTO sq_labor_rate_years (`year`, source, active) VALUES (?, ?, 0)", y, source);
        int cloned = 0;
        if (cloneFrom != null && Js.truthy(cloneFrom)) {
            Map<String, Object> src = db.first("SELECT id FROM sq_labor_rate_years WHERE `year` = ?", Js.json(cloneFrom));
            if (src != null) {
                cloned = db.update("INSERT INTO sq_labor_rate_lines (year_id, role_code, role_name, grade, wage_md, wage_mm, overhead, tech_fee, apply_price, note, sort)"
                        + " SELECT ?, role_code, role_name, grade, wage_md, wage_mm, overhead, tech_fee, apply_price, note, sort"
                        + " FROM sq_labor_rate_lines WHERE year_id = ?", newId, src.get("id"));
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", newId);
        out.put("year", y);
        out.put("cloned", cloned);
        return ResponseEntity.status(HttpStatus.CREATED).body(out);
    }

    /** #39 단가 라인 수정 — 8개 필드 중 보낸 것만. {@code ""} 은 null 로 저장 */
    @PutMapping("/{id}")
    @Access(Level.ADMIN)
    public Map<String, Object> updateRate(@PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        List<String> sets = new ArrayList<>();
        List<Object> vals = new ArrayList<>();
        for (String c : RATE_COLS) {
            if (b.containsKey(c)) {
                sets.add("`" + c + "` = ?");
                vals.add("".equals(b.get(c)) ? null : b.get(c));
            }
        }
        if (sets.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "NO_FIELDS", "수정할 항목이 없습니다.");
        double n = Js.number(id);
        if (Double.isNaN(n)) throw ApiException.notFound();
        vals.add(Js.json(n));
        int r = db.update("UPDATE sq_labor_rate_lines SET " + String.join(", ", sets) + " WHERE id = ?", vals.toArray());
        if (r == 0) throw ApiException.notFound();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rate", db.first("SELECT * FROM sq_labor_rate_lines WHERE id = ?", Js.json(n)));
        return out;
    }

    // ── 단가표 업로드 ───────────────────────────────────────────────

    /**
     * 단가표 읽기(저장 안 함) — 한국SW산업협회 SW기술자 평균임금 PDF 에서 직무별 노임단가를 읽어 산정식으로 채운다.
     * 직무는 이름으로 기존 직무코드와 짝짓는다(그 연도 → 없으면 가장 최근 연도의 직무). 짝이 없으면 role_code 가 null.
     * 등급·비고는 기존 값을 쓰고, 새 직무만 문서의 비고를 쓴다.
     */
    @PostMapping("/parse")
    @Access(Level.ADMIN)
    public Map<String, Object> parse(@RequestParam(required = false) MultipartFile file, @RequestParam(required = false) String year) {
        int y = validYear(year);
        if (file == null || file.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "NO_FILE", "단가표 파일을 선택하세요.");
        String text;
        try {
            text = LaborRateSheet.text(file.getBytes());
        } catch (IOException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_FILE", "PDF 파일을 읽을 수 없습니다. 한국SW산업협회 단가표 PDF 인지 확인하세요.");
        }
        Map<String, Object> out = LaborRateSheet.parse(text, y);

        Map<String, Object> yr = db.first("SELECT * FROM sq_labor_rate_years WHERE `year` = ?", y);
        Map<String, Object> base = yr != null && db.first("SELECT id FROM sq_labor_rate_lines WHERE year_id = ? LIMIT 1", yr.get("id")) != null ? yr
                : db.first("SELECT y.* FROM sq_labor_rate_years y WHERE EXISTS (SELECT 1 FROM sq_labor_rate_lines l WHERE l.year_id = y.id) ORDER BY y.`year` DESC LIMIT 1");
        Map<String, Map<String, Object>> known = new LinkedHashMap<>();
        if (base != null) {
            for (Map<String, Object> l : db.query("SELECT role_code, role_name, grade, note, sort FROM sq_labor_rate_lines WHERE year_id = ? ORDER BY sort, id", base.get("id"))) {
                known.put(key(l.get("role_name")), l);
            }
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) out.get("rows");
        for (Map<String, Object> r : rows) {
            Map<String, Object> k = known.get(key(r.get("role_name")));
            r.put("role_code", k == null ? null : k.get("role_code"));
            r.put("grade", k == null ? null : k.get("grade"));
            r.put("note", k != null && QuoteCalc.truthy(k.get("note")) ? k.get("note") : r.get("doc_note"));
            r.put("sort", k == null ? null : k.get("sort"));
        }
        Map<String, Object> exist = new LinkedHashMap<>();
        exist.put("exists", yr != null);
        if (yr != null) {
            exist.put("active", yr.get("active"));
            exist.put("source", yr.get("source"));
            exist.put("rate_count", db.first("SELECT COUNT(*) AS n FROM sq_labor_rate_lines WHERE year_id = ?", yr.get("id")).get("n"));
        }
        out.put("existing", exist);
        out.put("base_year", base == null ? null : base.get("year"));
        out.put("file_name", file.getOriginalFilename());
        return out;
    }

    /**
     * 읽은 단가 등록 — 연도가 없으면 만들고(비활성), 있으면 직무코드가 같은 줄을 덮어쓴다. 문서에 없는 기존 직무는 그대로 둔다.
     * 금액은 보낸 노임단가(wage_md)로 서버가 다시 계산한다.
     * 활성 연도 지정은 따로 한다 — 등록만으로 견적 단가가 바뀌지 않는다.
     */
    @PostMapping("/import")
    @Access(Level.ADMIN)
    @Transactional
    public Map<String, Object> importRates(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        int y = validYear(b.get("year") == null ? null : String.valueOf(b.get("year")));
        List<?> rows = b.get("rows") instanceof List<?> l ? l : List.of();
        if (rows.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "NO_ROWS", "등록할 직무가 없습니다.");
        Set<String> codes = new HashSet<>();
        for (int i = 0; i < rows.size(); i++) {
            Map<?, ?> r = rows.get(i) instanceof Map<?, ?> m ? m : Map.of();
            String code = r.get("role_code") == null ? "" : String.valueOf(r.get("role_code")).trim();
            double md = Js.toNumber(r.get("wage_md"));
            if (code.isEmpty() || !QuoteCalc.truthy(r.get("role_name")) || Double.isNaN(md) || md <= 0) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ROW", (i + 1) + "번째 행: 직무코드 · 직무명 · 노임단가를 확인하세요.");
            }
            if (!codes.add(code)) throw new ApiException(HttpStatus.BAD_REQUEST, "DUPLICATE_CODE", "직무코드가 겹칩니다: " + code);
        }
        Map<String, Object> yr = db.first("SELECT id FROM sq_labor_rate_years WHERE `year` = ?", y);
        boolean created = yr == null;
        Object source = QuoteCalc.truthy(b.get("source")) ? b.get("source") : "한국SW산업협회 " + y + "년 SW기술자 평균임금";
        Object yearId = created
                ? db.insert("INSERT INTO sq_labor_rate_years (`year`, source, active) VALUES (?, ?, 0)", y, source)
                : yr.get("id");
        if (!created) db.update("UPDATE sq_labor_rate_years SET source = ? WHERE id = ?", source, yearId);
        int inserted = 0, updated = 0;
        for (Object o : rows) {
            Map<?, ?> r = (Map<?, ?>) o;
            String code = String.valueOf(r.get("role_code")).trim();
            Map<String, Object> v = LaborRateSheet.compute(Math.round(Js.toNumber(r.get("wage_md"))));
            Object grade = blankToNull(r.get("grade")), note = blankToNull(r.get("note"));
            Map<String, Object> ex = db.first("SELECT id FROM sq_labor_rate_lines WHERE year_id = ? AND role_code = ?", yearId, code);
            if (ex != null) {
                updated += db.update("UPDATE sq_labor_rate_lines SET role_name = ?, grade = ?, wage_md = ?, wage_mm = ?, overhead = ?,"
                        + " tech_fee = ?, apply_price = ?, note = ? WHERE id = ?", r.get("role_name"), grade, v.get("wage_md"),
                        v.get("wage_mm"), v.get("overhead"), v.get("tech_fee"), v.get("apply_price"), note, ex.get("id"));
            } else {
                Object sort = r.get("sort") instanceof Number n ? n
                        : db.first("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM sq_labor_rate_lines WHERE year_id = ?", yearId).get("s");
                db.insert("INSERT INTO sq_labor_rate_lines (year_id, role_code, role_name, grade, wage_md, wage_mm, overhead, tech_fee, apply_price, note, sort)"
                        + " VALUES (?,?,?,?,?,?,?,?,?,?,?)", yearId, code, r.get("role_name"), grade, v.get("wage_md"), v.get("wage_mm"),
                        v.get("overhead"), v.get("tech_fee"), v.get("apply_price"), note, sort);
                inserted++;
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("year", y);
        out.put("created", created);
        out.put("inserted", inserted);
        out.put("updated", updated);
        return out;
    }

    private static int validYear(String year) {
        double y = year == null ? Double.NaN : Js.number(year.trim());
        if (Double.isNaN(y) || y != Math.rint(y) || y < 2000 || y > 2100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_YEAR", "연도가 올바르지 않습니다.");
        }
        return (int) y;
    }

    private static String key(Object name) {
        return name == null ? "" : String.valueOf(name).replaceAll("\\s+", "");
    }

    private static Object blankToNull(Object v) {
        return v == null || String.valueOf(v).isBlank() ? null : v;
    }

    /** #40 활성 연도 지정 — 나머지는 모두 해제 */
    @PatchMapping("/years/{id}/active")
    @Access(Level.ADMIN)
    @Transactional
    public Map<String, Object> activate(@PathVariable String id) {
        double n = Js.number(id);
        if (Double.isNaN(n) || db.first("SELECT id FROM sq_labor_rate_years WHERE id = ?", Js.json(n)) == null) {
            throw ApiException.notFound();
        }
        db.update("UPDATE sq_labor_rate_years SET active = 0");
        db.update("UPDATE sq_labor_rate_years SET active = 1 WHERE id = ?", Js.json(n));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("active_id", Js.json(n));
        return out;
    }
}
