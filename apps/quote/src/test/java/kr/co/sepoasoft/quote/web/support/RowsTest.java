package kr.co.sepoasoft.quote.web.support;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;

/** J5-2 값 모양 — JDBC 값을 mysql2 모양으로 바꾸는 규칙(명세 1-3절)과 JS {@code Number()} 해석. DB 를 쓰지 않는다. */
@DisplayName("J5-2 값 모양")
class RowsTest {

    private final Rows rows = new Rows(null, new ObjectMapper());

    @Test
    @DisplayName("DECIMAL 은 선언 스케일 그대로 문자열, 날짜는 dateStrings 모양, 불리언은 1/0")
    void normalize() {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("amount", new BigDecimal("1000000.00"));
        r.put("big", new BigDecimal("1E+3"));
        r.put("d", java.sql.Date.valueOf("2026-08-02"));
        r.put("ts", Timestamp.valueOf(LocalDateTime.of(2026, 8, 2, 14, 3, 11)));
        r.put("flag", Boolean.TRUE);
        r.put("n", 7L);
        r.put("nul", null);
        Map<String, Object> out = Rows.normalize(r);
        assertThat(out.keySet()).containsExactly("amount", "big", "d", "ts", "flag", "n", "nul");
        assertThat(out.get("amount")).isEqualTo("1000000.00");
        assertThat(out.get("big")).isEqualTo("1000");
        assertThat(out.get("d")).isEqualTo("2026-08-02");
        assertThat(out.get("ts")).isEqualTo("2026-08-02 14:03:11");
        assertThat(out.get("flag")).isEqualTo(1);
        assertThat(out.get("n")).isEqualTo(7L);
        assertThat(out.get("nul")).isNull();
    }

    @Test
    @DisplayName("safeJson 은 실패하면 null, parseCols 는 실패하면 빈 배열")
    void json() {
        assertThat(rows.safeJson("[\"a\",1]")).isEqualTo(List.of("a", 1));
        assertThat(rows.safeJson("{깨짐")).isNull();
        assertThat(rows.safeJson(null)).isNull();
        assertThat(rows.parseCols("{깨짐")).isEqualTo(List.of());
        assertThat(rows.parseCols(null)).isEqualTo(List.of());
    }

    @Test
    @DisplayName("Js.number 는 JS Number() 와 같다 — 빈 값 0, 숫자 아님 NaN")
    void jsNumber() {
        assertThat(Js.number("2")).isEqualTo(2);
        assertThat(Js.number(" 2.5 ")).isEqualTo(2.5);
        assertThat(Js.number("")).isZero();
        assertThat(Js.number(null)).isNaN();
        assertThat(Js.number("abc")).isNaN();
        assertThat(Js.number("1d")).isNaN();
        assertThat(Js.json(2.0)).isEqualTo(2L);
        assertThat(Js.json(2.5)).isEqualTo(2.5);
    }
}
