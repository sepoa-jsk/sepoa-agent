package kr.co.sepoasoft.quote.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import java.util.ArrayList;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
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
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * {@code /api/master} — Node {@code routes/master.js} 이식. 명세 2-3절 (#6~#10). 쓰기(#8~#10)는 관리자만.
 *
 * <p>테이블 이름·정렬은 {@link #TABLES} 화이트리스트에서만 온다. 요청 값이 SQL 문자열에 들어가지 않는다.
 */
@RestController
@RequestMapping("/api/master")
@Access(Level.LOGIN)
public class MasterController {

    /** pk: {@code id} = AUTO_INCREMENT, {@code code} = 문자열 PK */
    record Meta(String table, String pk, String order, List<String> cols) {
    }

    /** Node {@code TABLES} — 순서가 #6 응답의 키 순서다 */
    static final Map<String, Meta> TABLES = new LinkedHashMap<>();
    static {
        // 솔루션 · 구축형태는 V2 에서 sort 를 추가했다 (Node 는 아직 code 순 — API-spec 차이 J 참조)
        TABLES.put("solutions", new Meta("sq_solutions", "code", "sort, code", List.of("code", "name", "source", "sort")));
        TABLES.put("deployments", new Meta("sq_deployments", "code", "sort, code", List.of("code", "name", "sort")));
        TABLES.put("company_classes", new Meta("sq_company_classes", "id", "solution, deployment, sort",
                List.of("solution", "deployment", "key", "label", "revenue_cond", "onsite", "active", "sort")));
        TABLES.put("onsite_types", new Meta("sq_onsite_types", "code", "sort", List.of("code", "name", "sort")));
        TABLES.put("service_types", new Meta("sq_service_types", "id", "solution, sort",
                List.of("solution", "code", "name", "user_unit", "min_price", "note", "active", "sort")));
        TABLES.put("modules", new Meta("sq_modules", "id", "solution, sort",
                List.of("solution", "code", "name", "base_price", "required", "note", "active", "sort")));
        TABLES.put("labor_roles", new Meta("sq_labor_roles", "id", "solution, sort",
                List.of("solution", "code", "name", "base_price", "std_mm", "required", "note", "active", "sort",
                        "standard_role_code")));
        TABLES.put("labor_rates", new Meta("sq_labor_rates", "id", "solution, sort",
                List.of("solution", "company_key", "rate", "sort")));
        TABLES.put("thirdparty", new Meta("sq_thirdparty", "id", "solution, sort",
                List.of("solution", "code", "name", "base_price", "list_price", "note", "active", "sort")));
        // 네고율은 V3 에서 sort 를 추가했다 (Node 는 target, company_key, onsite_key 순 — API-spec 3절 J ③)
        TABLES.put("nego_rates", new Meta("sq_nego_rates", "id", "sort, onsite_key, company_key, target",
                List.of("target", "company_key", "onsite_key", "rate", "sort")));
        TABLES.put("maintenance", new Meta("sq_maintenance_config", "id", "sort",
                List.of("code", "name", "calc_type", "rate", "md_price", "md_per_mm", "tco_years", "free_months",
                        "note", "active", "sort")));
        TABLES.put("labor_standards", new Meta("sq_labor_standards", "id", "year DESC, sort",
                List.of("year", "role_code", "role_name", "daily_rate", "work_days", "overhead_rate", "tech_rate",
                        "sort")));
    }

    private final Rows db;

    public MasterController(Rows db) {
        this.db = db;
    }

    static Meta meta(String type) {
        Meta m = TABLES.get(type);
        if (m == null) throw new ApiException(HttpStatus.NOT_FOUND, "UNKNOWN_MASTER", "알 수 없는 마스터: " + type);
        return m;
    }

    /** #6 전체 마스터 한 번에 (화면 초기 로드용) */
    @GetMapping
    public Map<String, Object> all() {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Meta> e : TABLES.entrySet()) {
            Meta m = e.getValue();
            out.put(e.getKey(), db.query("SELECT * FROM " + m.table() + " ORDER BY " + m.order()));
        }
        return out;
    }

    /** #7 특정 마스터 목록 — {@code solution} 컬럼이 있는 마스터만 필터가 걸린다 */
    @GetMapping("/{type}")
    public Map<String, Object> list(@PathVariable String type, @RequestParam(required = false) String solution) {
        Meta m = meta(type);
        String where = "";
        Object[] params = {};
        if (solution != null && !solution.isEmpty() && m.cols().contains("solution")) {
            where = "WHERE solution = ?";
            params = new Object[] { solution };
        }
        return Map.of("rows", db.query("SELECT * FROM " + m.table() + " " + where + " ORDER BY " + m.order(), params));
    }

    /** #8 생성 — 편집 컬럼 중 보낸 것만 넣고, 넣은 행을 다시 읽어 돌려준다 */
    @PostMapping("/{type}")
    @Access(Level.ADMIN)
    public ResponseEntity<Map<String, Object>> create(@PathVariable String type,
            @RequestBody(required = false) Map<String, Object> body) {
        Meta m = meta(type);
        Map<String, Object> b = body == null ? Map.of() : body;
        List<String> cols = m.cols().stream().filter(b::containsKey).toList();
        if (cols.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "MISSING_FIELDS", null);
        Object idVal;
        try {
            long insertId = db.insert("INSERT INTO " + m.table() + " (" + String.join(",", cols.stream().map(MasterController::bt).toList())
                    + ") VALUES (" + Rows.placeholders(cols.size()) + ")", cols.stream().map(b::get).toArray());
            idVal = "id".equals(m.pk()) ? insertId : b.get(m.pk());
        } catch (DuplicateKeyException e) {
            throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE", "중복된 키입니다.");
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(row(m, idVal));
    }

    /**
     * #9 수정. 코드가 PK 인 마스터(솔루션·구축형태·상주여부)는 body 의 코드가 경로의 코드와 다르면
     * 코드도 바꾼다(2026-10-28 화면 요청 — Node 는 PK 를 바꾸지 않는다, API-spec 3절 J).
     * 다른 테이블에 남은 옛 코드는 따라 바꾸지 않는다. 같은 코드면 예전처럼 PK 는 건드리지 않는다.
     */
    @PutMapping("/{type}/{id}")
    @Access(Level.ADMIN)
    public Map<String, Object> update(@PathVariable String type, @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> body) {
        Meta m = meta(type);
        Map<String, Object> b = body == null ? Map.of() : body;
        Object newPk = b.get(m.pk());
        boolean renamePk = m.cols().contains(m.pk()) && newPk != null && !String.valueOf(newPk).isBlank()
                && !String.valueOf(newPk).equals(id);
        List<String> editable = m.cols().stream()
                .filter(c -> (renamePk || !c.equals(m.pk())) && b.containsKey(c)).toList();
        if (editable.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "NOTHING_TO_UPDATE", null);
        List<Object> params = new ArrayList<>();
        for (String c : editable) params.add(b.get(c));
        params.add(id);
        int r;
        try {
            r = db.update("UPDATE " + m.table() + " SET " + String.join(", ", editable.stream().map(c -> bt(c) + " = ?").toList())
                    + " WHERE " + bt(m.pk()) + " = ?", params.toArray());
        } catch (DuplicateKeyException e) {
            throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE", null);
        }
        if (r == 0) throw ApiException.notFound();
        return row(m, renamePk ? newPk : id);
    }

    /** #10 삭제 — active 컬럼이 있으면 active=0, 없으면 실삭제 */
    @DeleteMapping("/{type}/{id}")
    @Access(Level.ADMIN)
    public Map<String, Object> delete(@PathVariable String type, @PathVariable String id) {
        Meta m = meta(type);
        int r = m.cols().contains("active")
                ? db.update("UPDATE " + m.table() + " SET active = 0 WHERE " + bt(m.pk()) + " = ?", id)
                : db.update("DELETE FROM " + m.table() + " WHERE " + bt(m.pk()) + " = ?", id);
        if (r == 0) throw ApiException.notFound();
        return Map.of("ok", true);
    }

    /** {@code {row: rows[0]}} — 행이 없으면 Node 는 {@code row: undefined} 라 키 자체가 빠진다 */
    private Map<String, Object> row(Meta m, Object idVal) {
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> r = db.first("SELECT * FROM " + m.table() + " WHERE " + bt(m.pk()) + " = ?", idVal);
        if (r != null) out.put("row", r);
        return out;
    }

    /** 백틱 컬럼 (예약어 key 등) */
    private static String bt(String c) {
        return "`" + c + "`";
    }
}
