package kr.co.sepoasoft.quote.web.support;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Node {@code infra/db.js} 의 {@code query(sql, params)} 자리. SQL 은 Node 원문을 {@code ?} 까지 그대로 쓴다.
 *
 * <p><b>값 모양을 mysql2 에 맞춘다</b>(명세 1-3절). JDBC 가 주는 값을 그대로 JSON 으로 내면 대조가 깨진다.
 * <ul>
 *   <li>DECIMAL → 문자열, 선언 스케일 그대로 ({@code "1000000.00"}) — mysql2 기본</li>
 *   <li>DATE → {@code "2026-08-02"}, DATETIME → {@code "2026-08-02 14:03:11"} — {@code dateStrings: true}</li>
 *   <li>TINYINT(1) 를 드라이버가 불리언으로 주면 1/0 으로 되돌린다 — mysql2 는 숫자다</li>
 * </ul>
 * 행은 {@link LinkedHashMap} 이라 {@code SELECT *} 의 컬럼 순서가 유지된다.
 */
@Component
public class Rows {

    private static final DateTimeFormatter DATETIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public Rows(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** Node {@code query(sql, params)} — 행 목록 */
    public List<Map<String, Object>> query(String sql, Object... params) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : jdbc.queryForList(sql, params)) out.add(normalize(r));
        return out;
    }

    /** Node {@code const [row] = await query(...)} — 없으면 {@code null} */
    public Map<String, Object> first(String sql, Object... params) {
        List<Map<String, Object>> rows = query(sql, params);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Node {@code (await query(...)).affectedRows} — 바뀐 행이 아니라 <b>찾은</b> 행 수다(mysql2·MariaDB JDBC 기본값이 같다) */
    public int update(String sql, Object... params) {
        return jdbc.update(sql, params);
    }

    /** Node {@code (await conn.execute(INSERT ...)).insertId} */
    public long insert(String sql, Object... params) {
        org.springframework.jdbc.support.GeneratedKeyHolder keys = new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbc.update(con -> {
            java.sql.PreparedStatement ps = con.prepareStatement(sql, java.sql.Statement.RETURN_GENERATED_KEYS);
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            return ps;
        }, keys);
        Number key = keys.getKey();
        return key == null ? 0 : key.longValue();
    }

    /** {@code JSON.stringify(v)} — DB 에 JSON 문자열로 넣을 때 */
    public String stringify(Object v) {
        try {
            return json.writeValueAsString(v);
        } catch (Exception e) {
            throw new IllegalArgumentException("JSON 으로 바꿀 수 없습니다: " + e.getMessage(), e);
        }
    }

    /** {@code ?,?,?} — Node {@code ids.map(() => '?').join(',')} */
    public static String placeholders(int n) {
        return String.join(",", java.util.Collections.nCopies(n, "?"));
    }

    static Map<String, Object> normalize(Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : row.entrySet()) out.put(e.getKey(), value(e.getValue()));
        return out;
    }

    static Object value(Object v) {
        if (v instanceof BigDecimal d) return d.toPlainString();
        if (v instanceof java.sql.Date d) return d.toLocalDate().toString();
        if (v instanceof LocalDate d) return d.toString();
        if (v instanceof Timestamp t) return t.toLocalDateTime().format(DATETIME);
        if (v instanceof LocalDateTime t) return t.format(DATETIME);
        if (v instanceof Boolean b) return b ? 1 : 0;
        if (v instanceof byte[] b) return new String(b, StandardCharsets.UTF_8);
        return v;
    }

    /** Node {@code safeJson} — null 이면 null, 파싱 실패도 null */
    public Object safeJson(Object v) {
        if (v == null) return null;
        if (!(v instanceof String s)) return v;
        try {
            return json.readValue(s, Object.class);
        } catch (Exception e) {
            return null;
        }
    }

    /** Node {@code parseCols} — null · 파싱 실패는 빈 배열 */
    public Object parseCols(Object v) {
        if (v == null) return List.of();
        if (v instanceof List<?>) return v;
        try {
            return json.readValue(String.valueOf(v), Object.class);
        } catch (Exception e) {
            return List.of();
        }
    }

    /** JS 참·거짓 — 컬럼 값({@code 0}/{@code 1}/{@code null}/문자열)에 {@code !!v} */
    public static boolean truthy(Object v) {
        if (v == null) return false;
        if (v instanceof Number n) return n.doubleValue() != 0 && !Double.isNaN(n.doubleValue());
        if (v instanceof String s) return !s.isEmpty();
        if (v instanceof Boolean b) return b;
        return true;
    }
}
