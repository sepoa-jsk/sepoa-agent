package kr.co.sepoasoft.quote.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import java.util.ArrayList;

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
