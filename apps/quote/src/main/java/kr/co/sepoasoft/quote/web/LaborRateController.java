package kr.co.sepoasoft.quote.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/** {@code /api/labor-rates} — Node {@code routes/labor-rates.js} 이식. 명세 2-8절. J5-2 는 조회(#36·#37)만. */
@RestController
@RequestMapping("/api/labor-rates")
@Access(Level.LOGIN)
public class LaborRateController {

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
}
