package kr.co.sepoasoft.quote.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.auth.AccessInterceptor;
import kr.co.sepoasoft.quote.web.auth.SessionUser;
import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * 시스템관리(사용자 · 조직 · 역할·권한)와 발송 이력 — 2026-10-31.
 *
 * <p>사용자 목록은 예전 표(sq_users)만으로 동작한다. 부서 · 직위 · 업무 역할 · 사용 여부 칸과
 * 조직(sq_depts) · 역할(sq_roles, sq_role_menus) · 발송 이력(sq_quote_dispatch)은 V10 을 적용해야 쓴다 —
 * 적용 전에는 그 기능만 503 으로 알린다(나머지 화면은 그대로).
 */
@RestController
@RequestMapping("/api")
@Access(Level.LOGIN)
public class SystemController {

    /** 역할 권한 글자 — 조회 · 등록 · 수정 · 삭제 */
    static final String PERMS = "RCUD";

    private final Rows db;

    public SystemController(Rows db) {
        this.db = db;
    }

    // ── 사용자 ─────────────────────────────────────────────

    @GetMapping("/users")
    @Access(Level.ADMIN)
    public Map<String, Object> users() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("users", db.query("SELECT * FROM sq_users ORDER BY role, name, email"));
        out.put("org", hasColumn("sq_users", "dept_code")); // V10 칸(부서 · 직위 · 역할 · 사용)이 있는가
        return out;
    }

    /** 관리자 여부(role) · 부서 · 직위 · 업무 역할 · 사용 — 보낸 칸만 바꾼다. 자기 계정은 관리자 해제 · 사용 중지를 막는다 */
    @PutMapping("/users/{id}")
    @Access(Level.ADMIN)
    public Map<String, Object> updateUser(@PathVariable long id, @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest req) {
        Map<String, Object> b = body == null ? Map.of() : body;
        SessionUser me = AccessInterceptor.currentUser(req);
        boolean self = me != null && me.id() != null && me.id() == id;
        if (self && b.containsKey("role") && !"ADMIN".equals(b.get("role"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "SELF_ADMIN", "자기 계정의 관리자 권한은 뺄 수 없습니다.");
        }
        if (self && b.containsKey("active") && !Rows.truthy(b.get("active"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "SELF_ACTIVE", "자기 계정은 사용 중지할 수 없습니다.");
        }
        List<String> cols = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (b.containsKey("role")) {
            if (!Set.of("ADMIN", "USER").contains(String.valueOf(b.get("role")))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "BAD_ROLE", "관리자 여부는 ADMIN 또는 USER 입니다.");
            }
            cols.add("role"); params.add(b.get("role"));
        }
        boolean org = hasColumn("sq_users", "dept_code");
        for (String c : List.of("dept_code", "position", "role_code")) {
            if (!b.containsKey(c)) continue;
            if (!org) throw notApplied();
            Object v = b.get(c);
            cols.add(c); params.add(v == null || String.valueOf(v).isBlank() ? null : String.valueOf(v).trim());
        }
        // 핸드폰번호(V19) — 비우면 지운다
        if (b.containsKey("phone")) {
            if (!hasColumn("sq_users", "phone")) {
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "DB_NOT_READY", "DB 변경(V19 — 사용자 핸드폰번호 칸)이 아직 적용되지 않았습니다.");
            }
            Object v = b.get("phone");
            cols.add("phone"); params.add(v == null || String.valueOf(v).isBlank() ? null : String.valueOf(v).trim());
        }
        // 담당 솔루션(V16) — 코드 쉼표 구분. 비우면 미지정
        if (b.containsKey("solutions")) {
            if (!hasColumn("sq_users", "solutions")) {
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "DB_NOT_READY", "DB 변경(V16 — 사용자 담당 솔루션 칸)이 아직 적용되지 않았습니다.");
            }
            Object v = b.get("solutions");
            cols.add("solutions"); params.add(v == null || String.valueOf(v).isBlank() ? null : String.valueOf(v).trim());
        }
        if (b.containsKey("active")) {
            if (!org) throw notApplied();
            cols.add("active"); params.add(Rows.truthy(b.get("active")) ? 1 : 0);
        }
        if (cols.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "NOTHING_TO_UPDATE", null);
        params.add(id);
        int r = db.update("UPDATE sq_users SET " + String.join(", ", cols.stream().map(c -> "`" + c + "` = ?").toList())
                + " WHERE id = ?", params.toArray());
        if (r == 0) throw ApiException.notFound();
        return Map.of("user", db.first("SELECT * FROM sq_users WHERE id = ?", id));
    }

    // ── 조직(부서) ─────────────────────────────────────────

    @GetMapping("/depts")
    public Map<String, Object> depts() {
        need("sq_depts");
        return Map.of("rows", db.query("SELECT d.*, (SELECT COUNT(*) FROM sq_users u WHERE u.dept_code = d.code) AS user_count"
                + " FROM sq_depts d ORDER BY d.sort, d.code"));
    }

    @PostMapping("/depts")
    @Access(Level.ADMIN)
    public Map<String, Object> createDept(@RequestBody(required = false) Map<String, Object> body) {
        need("sq_depts");
        Map<String, Object> b = deptBody(body);
        try {
            long id = db.insert("INSERT INTO sq_depts (code, name, parent_code, note, sort, active) VALUES (?,?,?,?,?,1)",
                    b.get("code"), b.get("name"), b.get("parent_code"), b.get("note"), b.get("sort"));
            return Map.of("row", db.first("SELECT * FROM sq_depts WHERE id = ?", id));
        } catch (DuplicateKeyException e) {
            throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE", "이미 있는 부서 코드입니다: " + b.get("code"));
        }
    }

    /** 코드를 바꾸면 그 부서의 사용자 · 하위 부서도 새 코드로 따라 바꾼다 */
    @PutMapping("/depts/{id}")
    @Access(Level.ADMIN)
    @Transactional
    public Map<String, Object> updateDept(@PathVariable long id, @RequestBody(required = false) Map<String, Object> body) {
        need("sq_depts");
        Map<String, Object> old = db.first("SELECT * FROM sq_depts WHERE id = ?", id);
        if (old == null) throw ApiException.notFound();
        Map<String, Object> b = deptBody(body);
        if (b.get("code").equals(b.get("parent_code"))) throw new ApiException(HttpStatus.BAD_REQUEST, "BAD_PARENT", "자기 자신을 상위 부서로 둘 수 없습니다.");
        try {
            db.update("UPDATE sq_depts SET code = ?, name = ?, parent_code = ?, note = ?, sort = ? WHERE id = ?",
                    b.get("code"), b.get("name"), b.get("parent_code"), b.get("note"), b.get("sort"), id);
        } catch (DuplicateKeyException e) {
            throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE", "이미 있는 부서 코드입니다: " + b.get("code"));
        }
        if (!old.get("code").equals(b.get("code"))) {
            db.update("UPDATE sq_users SET dept_code = ? WHERE dept_code = ?", b.get("code"), old.get("code"));
            db.update("UPDATE sq_depts SET parent_code = ? WHERE parent_code = ?", b.get("code"), old.get("code"));
        }
        return Map.of("row", db.first("SELECT * FROM sq_depts WHERE id = ?", id));
    }

    /** 사용 중지(active=0) — 사람이 남아 있으면 막는다 */
    @DeleteMapping("/depts/{id}")
    @Access(Level.ADMIN)
    public Map<String, Object> deleteDept(@PathVariable long id) {
        need("sq_depts");
        Map<String, Object> d = db.first("SELECT code, name FROM sq_depts WHERE id = ?", id);
        if (d == null) throw ApiException.notFound();
        Map<String, Object> n = db.first("SELECT COUNT(*) AS n FROM sq_users WHERE dept_code = ? AND active = 1", d.get("code"));
        if (n != null && ((Number) n.get("n")).longValue() > 0) {
            throw new ApiException(HttpStatus.CONFLICT, "IN_USE", d.get("name") + " 에 사용자가 있어 사용 중지할 수 없습니다. 사용자 화면에서 부서를 먼저 옮기세요.");
        }
        db.update("UPDATE sq_depts SET active = 0 WHERE id = ?", id);
        return Map.of("ok", true);
    }

    private Map<String, Object> deptBody(Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        String code = Js.string(b.getOrDefault("code", "")).trim().toUpperCase();
        String name = Js.string(b.getOrDefault("name", "")).trim();
        if (!code.matches("[A-Z0-9_]{1,30}")) throw new ApiException(HttpStatus.BAD_REQUEST, "BAD_CODE", "부서 코드는 영문 · 숫자 · _ 로 30자까지입니다.");
        if (name.isEmpty() || "null".equals(name)) throw new ApiException(HttpStatus.BAD_REQUEST, "MISSING", "부서명은 필수입니다.");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("code", code);
        out.put("name", name);
        out.put("parent_code", Rows.truthy(b.get("parent_code")) ? String.valueOf(b.get("parent_code")) : null);
        out.put("note", Rows.truthy(b.get("note")) ? String.valueOf(b.get("note")).trim() : null);
        double s = b.get("sort") == null ? 0 : Js.toNumber(b.get("sort"));
        out.put("sort", Double.isNaN(s) ? 0 : (int) s);
        return out;
    }

    // ── 역할 · 권한 ─────────────────────────────────────────

    @GetMapping("/roles")
    public Map<String, Object> roles() {
        need("sq_roles");
        List<Map<String, Object>> roles = db.query("SELECT r.*, (SELECT COUNT(*) FROM sq_users u WHERE u.role_code = r.code) AS user_count"
                + " FROM sq_roles r ORDER BY r.sort, r.code");
        Map<Object, Map<String, Object>> perms = new LinkedHashMap<>();
        for (Map<String, Object> m : db.query("SELECT role_code, menu, perms FROM sq_role_menus")) {
            perms.computeIfAbsent(m.get("role_code"), k -> new LinkedHashMap<>()).put(String.valueOf(m.get("menu")), m.get("perms"));
        }
        for (Map<String, Object> r : roles) r.put("perms", perms.getOrDefault(r.get("code"), Map.of()));
        return Map.of("roles", roles);
    }

    /** 역할 저장(없으면 생성) — body {name, note, sort, active, perms: {menu: 'RCU'}}. 권한은 통째로 바꾼다 */
    @PutMapping("/roles/{code}")
    @Access(Level.ADMIN)
    @Transactional
    public Map<String, Object> saveRole(@PathVariable String code, @RequestBody(required = false) Map<String, Object> body) {
        need("sq_roles");
        Map<String, Object> b = body == null ? Map.of() : body;
        String c = code.trim().toUpperCase();
        String name = b.get("name") == null ? "" : String.valueOf(b.get("name")).trim();
        if (!c.matches("[A-Z0-9_]{1,30}")) throw new ApiException(HttpStatus.BAD_REQUEST, "BAD_CODE", "역할 코드는 영문 · 숫자 · _ 로 30자까지입니다.");
        if ("ADMIN".equals(c)) throw new ApiException(HttpStatus.BAD_REQUEST, "RESERVED", "ADMIN 은 관리자 여부로 정합니다(사용자 화면).");
        if (name.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "MISSING", "역할명은 필수입니다.");
        Object note = Rows.truthy(b.get("note")) ? String.valueOf(b.get("note")).trim() : null;
        double s = b.get("sort") == null ? 0 : Js.toNumber(b.get("sort"));
        int sort = Double.isNaN(s) ? 0 : (int) s;
        int active = b.containsKey("active") && !Rows.truthy(b.get("active")) ? 0 : 1;
        if (db.first("SELECT code FROM sq_roles WHERE code = ?", c) == null) {
            db.update("INSERT INTO sq_roles (code, name, note, sort, active) VALUES (?,?,?,?,?)", c, name, note, sort, active);
        } else {
            db.update("UPDATE sq_roles SET name = ?, note = ?, sort = ?, active = ? WHERE code = ?", name, note, sort, active, c);
        }
        if (b.get("perms") instanceof Map<?, ?> pm) {
            db.update("DELETE FROM sq_role_menus WHERE role_code = ?", c);
            for (Map.Entry<?, ?> e : pm.entrySet()) {
                String menu = String.valueOf(e.getKey());
                StringBuilder p = new StringBuilder();
                String raw = e.getValue() == null ? "" : String.valueOf(e.getValue()).toUpperCase();
                for (char ch : PERMS.toCharArray()) if (raw.indexOf(ch) >= 0) p.append(ch);
                if (!menu.matches("[a-z\\-]{1,30}") || p.isEmpty()) continue;
                db.update("INSERT INTO sq_role_menus (role_code, menu, perms) VALUES (?,?,?)", c, menu, p.toString());
            }
        }
        return Map.of("ok", true, "code", c);
    }

    @DeleteMapping("/roles/{code}")
    @Access(Level.ADMIN)
    public Map<String, Object> deleteRole(@PathVariable String code) {
        need("sq_roles");
        Map<String, Object> n = db.first("SELECT COUNT(*) AS n FROM sq_users WHERE role_code = ?", code);
        if (n != null && ((Number) n.get("n")).longValue() > 0) {
            throw new ApiException(HttpStatus.CONFLICT, "IN_USE", "이 역할을 가진 사용자가 있어 지울 수 없습니다. 사용자 화면에서 역할을 먼저 바꾸세요.");
        }
        if (db.update("DELETE FROM sq_roles WHERE code = ?", code) == 0) throw ApiException.notFound();
        return Map.of("ok", true);
    }

    /**
     * 로그인한 사람의 메뉴 권한 — 관리자는 {@code admin: true}(모든 메뉴). 업무 역할이 없거나 V10 전이면
     * {@code perms: null} — 화면은 예전처럼(관리자 메뉴만 숨기고) 보여 준다.
     */
    @GetMapping("/roles/mine")
    public Map<String, Object> mine(HttpServletRequest req) {
        SessionUser me = AccessInterceptor.currentUser(req);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("admin", me != null && me.isAdmin());
        out.put("perms", null);
        // 내 정보 — 견적 작성 기본정보의 담당자 · 이메일 기본값(2026-10-31). 직위는 V10 뒤에만 있다
        if (me != null) {
            boolean org = hasColumn("sq_users", "position");
            // 담당 솔루션(V16) — 견적 작성 1단계의 솔루션 기본값
            boolean sol = hasColumn("sq_users", "solutions");
            boolean tel = hasColumn("sq_users", "phone"); // 핸드폰번호(V19) — 견적 작성 '영업 연락처' 기본값
            Map<String, Object> p = db.first("SELECT name, email" + (org ? ", position" : "") + (sol ? ", solutions" : "") + (tel ? ", phone" : "")
                    + " FROM sq_users WHERE id = ?", me.id());
            if (p != null) out.put("profile", p);
        }
        if (me == null || me.isAdmin() || !hasColumn("sq_users", "role_code")) return out;
        Map<String, Object> u = db.first("SELECT role_code FROM sq_users WHERE id = ?", me.id());
        if (u == null || !Rows.truthy(u.get("role_code"))) return out;
        Map<String, Object> perms = new LinkedHashMap<>();
        for (Map<String, Object> m : db.query("SELECT m.menu, m.perms FROM sq_role_menus m JOIN sq_roles r ON r.code = m.role_code"
                + " WHERE m.role_code = ? AND r.active = 1", u.get("role_code"))) {
            perms.put(String.valueOf(m.get("menu")), m.get("perms"));
        }
        out.put("role_code", u.get("role_code"));
        out.put("perms", perms);
        return out;
    }

    // ── 발송 이력 ───────────────────────────────────────────

    /** 메일 발송 이력 — 기간(sent_at 날짜) · 검색어(견적번호 · 수신처 · 받는 사람) */
    @GetMapping("/dispatch")
    public Map<String, Object> dispatch(@RequestParam(required = false) String from, @RequestParam(required = false) String to,
            @RequestParam(required = false) String q) {
        need("sq_quote_dispatch");
        List<String> where = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (from != null && from.matches("\\d{4}-\\d{2}-\\d{2}")) { where.add("d.sent_at >= ?"); params.add(from); }
        if (to != null && to.matches("\\d{4}-\\d{2}-\\d{2}")) { where.add("d.sent_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.add(to); }
        if (q != null && !q.isBlank()) {
            where.add("(d.quote_no LIKE ? OR d.customer_name LIKE ? OR d.to_addrs LIKE ?)");
            String like = "%" + q.trim() + "%";
            params.add(like); params.add(like); params.add(like);
        }
        return Map.of("rows", db.query("SELECT d.*, u.name AS sent_by_name, qt.status AS quote_status FROM sq_quote_dispatch d"
                + " LEFT JOIN sq_users u ON u.id = d.sent_by LEFT JOIN sq_quotes qt ON qt.id = d.quote_id"
                + (where.isEmpty() ? "" : " WHERE " + String.join(" AND ", where))
                + " ORDER BY d.sent_at DESC, d.id DESC LIMIT 1000", params.toArray()));
    }

    /** 발송 한 건을 남긴다 — 표가 없거나(V10 전) 쓰다 실패해도 메일 발송은 그대로 둔다 */
    void logDispatch(Map<String, Object> q, List<String> to, List<String> cc, String subject, List<String> files,
            String result, String error, Long userId) {
        try {
            if (!hasTable("sq_quote_dispatch")) return;
            db.insert("INSERT INTO sq_quote_dispatch (quote_id, quote_no, customer_name, to_addrs, cc_addrs, subject, files, result, error, sent_by)"
                    + " VALUES (?,?,?,?,?,?,?,?,?,?)",
                    q.get("id"), q.get("quote_no"), q.get("customer_name"), cut(String.join(", ", to), 1000),
                    cc.isEmpty() ? null : cut(String.join(", ", cc), 1000), cut(subject, 300),
                    files.isEmpty() ? null : cut(String.join(", ", files), 100), result, error == null ? null : cut(error, 500), userId);
        } catch (RuntimeException ignore) {
            // 이력은 참고용 — 발송 결과를 바꾸지 않는다
        }
    }

    private static String cut(String s, int n) {
        return s == null || s.length() <= n ? s : s.substring(0, n);
    }

    // ── V10 적용 여부 ──────────────────────────────────────

    boolean hasTable(String table) {
        Map<String, Object> r = db.first("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", table);
        return r != null && ((Number) r.get("n")).longValue() > 0;
    }

    boolean hasColumn(String table, String column) {
        Map<String, Object> r = db.first("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE()"
                + " AND table_name = ? AND column_name = ?", table, column);
        return r != null && ((Number) r.get("n")).longValue() > 0;
    }

    private void need(String table) {
        if (!hasTable(table)) throw notApplied();
    }

    private static ApiException notApplied() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "DB_NOT_READY",
                "DB 변경(V10 — 조직 · 역할 · 발송 이력 표)이 아직 적용되지 않았습니다.");
    }
}
