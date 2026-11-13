package kr.co.sepoasoft.quote.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
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
 * 가격정책 버전 이력(V7 {@code sq_price_policy_versions}) — 2026-10-30.
 *
 * <p>가격정책 화면(SaaS 탭)이 저장할 때마다 정책 전체(기본정보 표 · 서비스 · 인원/건수 구간)를 새 버전으로 남긴다.
 * 행은 고치거나 지우지 않는다 — 가장 최근 행이 현재 버전이고, 나머지는 이력이다.
 */
@RestController
@RequestMapping("/api/pricing/policy")
@Access(Level.LOGIN)
public class PricePolicyController {

    private final Rows db;

    public PricePolicyController(Rows db) {
        this.db = db;
    }

    /** 현재 버전(내용 포함) + 이력 목록(내용 없이, 최근 순) */
    @GetMapping
    public Map<String, Object> current(@RequestParam String solution, @RequestParam(defaultValue = "SAAS") String deployment) {
        List<Map<String, Object>> history = db.query(
                "SELECT v.id, v.version, v.note, v.created_at, u.name AS created_by_name"
                        + " FROM sq_price_policy_versions v LEFT JOIN sq_users u ON u.id = v.created_by"
                        + " WHERE v.solution = ? AND v.deployment = ? ORDER BY v.id DESC", solution, deployment);
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> cur = history.isEmpty() ? null : one(history.get(0).get("id"));
        // 현재 버전의 견적조건은 고른 문구 세트(cond_set)의 지금 문장으로 채운다 — 이력 버전은 저장 때 사본(conds) 그대로
        if (cur != null && cur.get("content") instanceof Map<?, ?> c && Rows.truthy(c.get("cond_set"))) {
            @SuppressWarnings("unchecked") Map<String, Object> content = (Map<String, Object>) c;
            content.put("conds", ConditionController.policyConds(db, content));
        }
        out.put("current", cur);
        out.put("history", history);
        return out;
    }

    /** 한 버전 — 이력 보기 */
    @GetMapping("/{id}")
    public Map<String, Object> version(@PathVariable String id) {
        double n = Js.number(id);
        Map<String, Object> v = Double.isNaN(n) ? null : one(Js.json(n));
        if (v == null) throw ApiException.notFound();
        return Map.of("version", v);
    }

    /** 새 버전 — {solution, deployment, version, note, content}. 같은 버전 번호가 있으면 409 */
    @PostMapping
    @Access(Level.ADMIN)
    public ResponseEntity<Map<String, Object>> create(@RequestBody(required = false) Map<String, Object> body, HttpServletRequest req) {
        Map<String, Object> b = body == null ? Map.of() : body;
        String version = Js.string(b.get("version")).trim();
        if (!Rows.truthy(b.get("solution")) || version.isEmpty() || !(b.get("content") instanceof Map<?, ?>)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "MISSING", "solution · version · content 는 필수입니다.");
        }
        String note = Rows.truthy(b.get("note")) ? Js.string(b.get("note")).trim() : null;
        SessionUser user = AccessInterceptor.currentUser(req);
        // 같은 버전 번호가 있으면 그 버전을 덮어쓴다 — 프로젝트 완료 전까지 v1.0 하나로 유지(2026-11-04 사용자 요청)
        Map<String, Object> same = db.first("SELECT id FROM sq_price_policy_versions WHERE solution = ? AND deployment = ? AND version = ?",
                b.get("solution"), Rows.truthy(b.get("deployment")) ? b.get("deployment") : "SAAS", version);
        if (same != null) {
            db.update("UPDATE sq_price_policy_versions SET content = ?, note = COALESCE(?, note), created_by = ?, created_at = NOW() WHERE id = ?",
                    db.stringify(b.get("content")), note == null || note.isEmpty() ? null : note, user == null ? null : user.id(), same.get("id"));
            return ResponseEntity.ok(Map.of("version", one(same.get("id"))));
        }
        long id;
        try {
            id = db.insert("INSERT INTO sq_price_policy_versions (solution, deployment, version, note, content, created_by) VALUES (?,?,?,?,?,?)",
                    b.get("solution"), Rows.truthy(b.get("deployment")) ? b.get("deployment") : "SAAS", version,
                    note == null || note.isEmpty() ? null : note, db.stringify(b.get("content")), user == null ? null : user.id());
        } catch (DuplicateKeyException e) {
            throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_VERSION", version + " 버전이 이미 있습니다.");
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("version", one(id)));
    }

    private Map<String, Object> one(Object id) {
        Map<String, Object> v = db.first("SELECT v.*, u.name AS created_by_name FROM sq_price_policy_versions v"
                + " LEFT JOIN sq_users u ON u.id = v.created_by WHERE v.id = ?", id);
        if (v != null) v.put("content", db.safeJson(v.get("content")));
        return v;
    }
}
