package kr.co.sepoasoft.quote.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * 견적조건 문구 관리(기준정보 / 견적조건 문구) — 2026-10-31.
 *
 * <p>문구 세트({@code sq_condition_sets}) 와 세트의 문장({@code sq_condition_lines}) 을 이 화면에서만 고친다.
 * 템플릿은 {@code condition_set} 으로, 가격정책(SaaS)은 정책 내용의 {@code cond_set} 으로 세트를 가져다 쓴다.
 * 표 구조는 그대로다(V1) — 새 표 없음.
 */
@RestController
@RequestMapping("/api/condition-sets")
@Access(Level.LOGIN)
public class ConditionController {

    private final Rows db;

    public ConditionController(Rows db) {
        this.db = db;
    }

    /** 세트 목록 — 문장 · 쓰는 곳(템플릿 코드 · 가격정책) 포함 */
    @GetMapping
    public Map<String, Object> list() {
        List<Map<String, Object>> sets = db.query("SELECT * FROM sq_condition_sets ORDER BY code");
        Map<Object, List<Object>> lines = new LinkedHashMap<>();
        for (Map<String, Object> l : db.query("SELECT set_code, `text` FROM sq_condition_lines ORDER BY set_code, line_no")) {
            lines.computeIfAbsent(l.get("set_code"), k -> new ArrayList<>()).add(l.get("text"));
        }
        Map<Object, List<Object>> tpls = new LinkedHashMap<>();
        for (Map<String, Object> t : db.query("SELECT code, condition_set FROM sq_quote_templates WHERE condition_set IS NOT NULL ORDER BY code")) {
            tpls.computeIfAbsent(t.get("condition_set"), k -> new ArrayList<>()).add(t.get("code"));
        }
        Map<Object, List<Object>> policies = new LinkedHashMap<>();
        for (Map<String, Object> p : latestPolicies()) {
            if (db.safeJson(p.get("content")) instanceof Map<?, ?> c && Rows.truthy(c.get("cond_set"))) {
                policies.computeIfAbsent(c.get("cond_set"), k -> new ArrayList<>())
                        .add(p.get("solution") + " · " + p.get("deployment") + " " + p.get("version"));
            }
        }
        for (Map<String, Object> s : sets) {
            s.put("lines", lines.getOrDefault(s.get("code"), List.of()));
            s.put("templates", tpls.getOrDefault(s.get("code"), List.of()));
            s.put("policies", policies.getOrDefault(s.get("code"), List.of()));
        }
        return Map.of("sets", sets);
    }

    /**
     * 세트 저장 — 없으면 만들고, 있으면 이름과 문장 전체를 바꾼다. body {@code {name, lines: [text]}}.
     * 문장은 지우고 다시 넣는다(순서 = line_no).
     */
    @PutMapping("/{code}")
    @Access(Level.ADMIN)
    @Transactional
    public Map<String, Object> save(@PathVariable String code, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        String c = code.trim();
        String name = Js.string(b.get("name")).trim();
        if (!c.matches("[A-Za-z0-9_]{1,30}")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "BAD_CODE", "코드는 영문 · 숫자 · _ 로 30자까지입니다.");
        }
        if (name.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "MISSING", "이름은 필수입니다.");
        List<String> lines = new ArrayList<>();
        if (b.get("lines") instanceof List<?> ls) {
            for (Object o : ls) {
                String t = o == null ? "" : String.valueOf(o).trim();
                if (t.length() > 500) throw new ApiException(HttpStatus.BAD_REQUEST, "TOO_LONG", "문장은 500자까지입니다.");
                if (!t.isEmpty()) lines.add(t);
            }
        }
        if (db.first("SELECT code FROM sq_condition_sets WHERE code = ?", c) == null) {
            db.update("INSERT INTO sq_condition_sets (code, name) VALUES (?, ?)", c, name);
        } else {
            db.update("UPDATE sq_condition_sets SET name = ? WHERE code = ?", name, c);
        }
        db.update("DELETE FROM sq_condition_lines WHERE set_code = ?", c);
        for (int i = 0; i < lines.size(); i++) {
            db.update("INSERT INTO sq_condition_lines (set_code, line_no, `text`) VALUES (?, ?, ?)", c, i + 1, lines.get(i));
        }
        return Map.of("ok", true, "code", c, "count", lines.size());
    }

    /** 세트 삭제 — 템플릿이나 현재 가격정책이 쓰고 있으면 막는다(문장은 FK CASCADE 로 같이 지워진다) */
    @DeleteMapping("/{code}")
    @Access(Level.ADMIN)
    public Map<String, Object> delete(@PathVariable String code) {
        Map<String, Object> used = db.first("SELECT code FROM sq_quote_templates WHERE condition_set = ? LIMIT 1", code);
        if (used != null) throw new ApiException(HttpStatus.CONFLICT, "IN_USE", "템플릿 " + used.get("code") + " 이(가) 쓰고 있어 지울 수 없습니다.");
        for (Map<String, Object> p : latestPolicies()) {
            if (db.safeJson(p.get("content")) instanceof Map<?, ?> c && code.equals(c.get("cond_set"))) {
                throw new ApiException(HttpStatus.CONFLICT, "IN_USE", "가격정책(" + p.get("solution") + ")이 쓰고 있어 지울 수 없습니다.");
            }
        }
        if (db.update("DELETE FROM sq_condition_sets WHERE code = ?", code) == 0) throw ApiException.notFound();
        return Map.of("ok", true);
    }

    /** 솔루션 · 구축형태마다 가장 최근 가격정책 버전 */
    private List<Map<String, Object>> latestPolicies() {
        return db.query("SELECT v.solution, v.deployment, v.version, v.content FROM sq_price_policy_versions v"
                + " WHERE v.id = (SELECT MAX(x.id) FROM sq_price_policy_versions x WHERE x.solution = v.solution AND x.deployment = v.deployment)");
    }

    /**
     * 가격정책 내용의 견적조건 — {@code cond_set} 이 있으면 그 문구 세트의 지금 문장, 없으면 예전처럼 내용에 적힌 {@code conds}.
     * 가격정책 화면 · 템플릿 · 견적 작성(apply-template)이 모두 이 규칙으로 읽는다.
     */
    static List<Object> policyConds(Rows db, Object content) {
        List<Object> out = new ArrayList<>();
        if (!(content instanceof Map<?, ?> c)) return out;
        if (Rows.truthy(c.get("cond_set"))) {
            for (Map<String, Object> r : db.query("SELECT `text` FROM sq_condition_lines WHERE set_code = ? ORDER BY line_no", c.get("cond_set"))) {
                out.add(r.get("text"));
            }
            return out;
        }
        if (c.get("conds") instanceof List<?> pc) {
            for (Object o : pc) {
                String t = o == null ? "" : String.valueOf(o).trim();
                if (!t.isEmpty() && !out.contains(t)) out.add(t);
            }
        }
        return out;
    }
}
