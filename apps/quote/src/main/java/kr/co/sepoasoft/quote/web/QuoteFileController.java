package kr.co.sepoasoft.quote.web;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import jakarta.servlet.http.HttpServletRequest;
import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.auth.AccessInterceptor;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * {@code /api/quotes/{id}/files} — 견적 첨부파일(2026-11-03 사용자 요청). 표는 V17 sq_quote_files, 파일 내용은 DB 에 그대로.
 * 목록 · 올리기(20MB 까지 — application.yml multipart 와 같다) · 내려받기 · 지우기. V17 전 DB 에서는 503 으로 알린다.
 * {@code kind}(V18) — ATTACH 첨부파일(기본) | CUSTOMER 고객 전달 파일(RFP 등). V18 전 DB 에서는 구분 없이 모두 첨부파일로 본다.
 */
@RestController
@RequestMapping("/api/quotes/{id}/files")
@Access(Level.LOGIN)
public class QuoteFileController {

    static final long MAX_BYTES = 20L * 1024 * 1024;
    static final java.util.Set<String> KINDS = java.util.Set.of("ATTACH", "CUSTOMER");

    private final Rows db;
    private final JdbcTemplate jdbc; // 파일 내용(byte[])은 Rows 의 값 다듬기를 거치지 않고 바로 읽는다

    public QuoteFileController(Rows db, JdbcTemplate jdbc) {
        this.db = db;
        this.jdbc = jdbc;
    }

    @GetMapping
    public Map<String, Object> list(@PathVariable long id, @RequestParam(required = false) String kind) {
        need();
        String k = kindOf(kind);
        if (!hasKind()) {
            // V18 전 — 구분 칸이 없다. 첨부파일 목록에만 모두 보이고 고객 전달 파일은 비어 있다
            if (!"ATTACH".equals(k)) return Map.of("files", List.of());
            return Map.of("files", db.query("SELECT f.id, f.file_name, f.content_type, f.size, f.created_at, u.name AS uploaded_by_name"
                    + " FROM sq_quote_files f LEFT JOIN sq_users u ON u.id = f.uploaded_by WHERE f.quote_id = ? ORDER BY f.id", id));
        }
        return Map.of("files", db.query("SELECT f.id, f.file_name, f.content_type, f.size, f.created_at, u.name AS uploaded_by_name"
                + " FROM sq_quote_files f LEFT JOIN sq_users u ON u.id = f.uploaded_by WHERE f.quote_id = ? AND f.kind = ? ORDER BY f.id", id, k));
    }

    @PostMapping
    public Map<String, Object> upload(@PathVariable long id, @RequestParam(required = false) MultipartFile file,
            @RequestParam(required = false) String kind, HttpServletRequest req) throws IOException {
        need();
        String k = kindOf(kind);
        if (!"ATTACH".equals(k) && !hasKind()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "DB_NOT_READY", "DB 변경(V18 — 파일 구분 칸)이 아직 적용되지 않았습니다.");
        }
        if (file == null || file.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "NO_FILE", "올릴 파일을 고르세요.");
        if (file.getSize() > MAX_BYTES) throw new ApiException(HttpStatus.BAD_REQUEST, "TOO_LARGE", "파일은 20MB 까지 올릴 수 있습니다.");
        if (db.first("SELECT id FROM sq_quotes WHERE id = ?", id) == null) throw ApiException.notFound();
        String name = file.getOriginalFilename() == null || file.getOriginalFilename().isBlank() ? "file" : file.getOriginalFilename();
        var me = AccessInterceptor.currentUser(req);
        long fid = hasKind()
                ? db.insert("INSERT INTO sq_quote_files (quote_id, kind, file_name, content_type, size, data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        id, k, cut(name, 255), cut(file.getContentType(), 100), file.getSize(), file.getBytes(), me == null ? null : me.id())
                : db.insert("INSERT INTO sq_quote_files (quote_id, file_name, content_type, size, data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
                        id, cut(name, 255), cut(file.getContentType(), 100), file.getSize(), file.getBytes(), me == null ? null : me.id());
        return Map.of("file", db.first("SELECT id, file_name, content_type, size, created_at FROM sq_quote_files WHERE id = ?", fid));
    }

    @GetMapping("/{fid}")
    public ResponseEntity<byte[]> download(@PathVariable long id, @PathVariable long fid) {
        need();
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT file_name, content_type, data FROM sq_quote_files WHERE id = ? AND quote_id = ?", fid, id);
        if (rows.isEmpty()) throw ApiException.notFound();
        Map<String, Object> r = rows.get(0);
        String name = String.valueOf(r.get("file_name"));
        String encoded = URLEncoder.encode(name, StandardCharsets.UTF_8).replace("+", "%20");
        String ascii = name.replaceAll("[^\\x20-\\x7E]", "_").replace("\"", "_");
        Object type = r.get("content_type");
        return ResponseEntity.ok()
                .header("Content-Type", type == null ? "application/octet-stream" : String.valueOf(type))
                .header("Content-Disposition", "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encoded)
                .body((byte[]) r.get("data"));
    }

    @DeleteMapping("/{fid}")
    public Map<String, Object> delete(@PathVariable long id, @PathVariable long fid) {
        need();
        int n = db.update("DELETE FROM sq_quote_files WHERE id = ? AND quote_id = ?", fid, id);
        if (n == 0) throw ApiException.notFound();
        return Map.of("ok", true);
    }

    private void need() {
        Map<String, Object> r = db.first("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'sq_quote_files'");
        if (r == null || ((Number) r.get("n")).longValue() == 0) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "DB_NOT_READY", "DB 변경(V17 — 견적 첨부파일 표)이 아직 적용되지 않았습니다.");
        }
    }

    private boolean hasKind() {
        Map<String, Object> r = db.first("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE()"
                + " AND table_name = 'sq_quote_files' AND column_name = 'kind'");
        return r != null && ((Number) r.get("n")).longValue() > 0;
    }

    private static String kindOf(String kind) {
        if (kind == null || kind.isBlank()) return "ATTACH";
        if (!KINDS.contains(kind)) throw new ApiException(HttpStatus.BAD_REQUEST, "BAD_KIND", "파일 구분은 ATTACH 또는 CUSTOMER 입니다.");
        return kind;
    }

    private static String cut(String s, int n) {
        return s == null || s.length() <= n ? s : s.substring(0, n);
    }
}
